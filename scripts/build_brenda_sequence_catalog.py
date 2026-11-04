from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "evidence_work"
RAW_ROOT = WORK / "raw" / "brenda"
EVIDENCE_DB = WORK / "enzyme_reaction_evidence.sqlite"
FETCH_DB = WORK / "source_fetch_status.sqlite"
OUTPUT_DB = WORK / "brenda_sequence_catalog.sqlite"
SUMMARY = WORK / "brenda_sequence_catalog.summary.json"


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def clean_sequence(value: Any) -> str:
    return "".join(str(value or "").split()).upper()


def sequence_hash(value: Any) -> tuple[str | None, int]:
    sequence = clean_sequence(value)
    if not sequence:
        return None, 0
    return hashlib.sha256(sequence.encode("ascii", errors="ignore")).hexdigest(), len(sequence)


def text(value: Any) -> str | None:
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def identity_key(ec: str, item: dict[str, Any], seqhash: str | None) -> str:
    brenda_id = text(item.get("id"))
    if brenda_id:
        return f"BRENDA:{brenda_id}"
    canonical = json.dumps(
        {
            "ec": ec,
            "accession": text(item.get("firstAccessionCode")),
            "sequence_sha256": seqhash,
            "organism": text(item.get("organism")),
        },
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return "BRENDA:FALLBACK:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:24]


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=NORMAL;
        PRAGMA temp_store=MEMORY;
        CREATE TABLE IF NOT EXISTS metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS processed_files (
          source_file TEXT PRIMARY KEY,
          ec_number TEXT NOT NULL,
          expected_sha256 TEXT,
          expected_items INTEGER,
          observed_items INTEGER NOT NULL,
          new_identities INTEGER NOT NULL,
          mapped_occurrences INTEGER NOT NULL,
          unmapped_occurrences INTEGER NOT NULL,
          status TEXT NOT NULL,
          error_text TEXT,
          completed_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS brenda_identities (
          identity_key TEXT PRIMARY KEY,
          brenda_protein_id TEXT,
          first_accession TEXT,
          source_label TEXT,
          organism TEXT,
          sequence_sha256 TEXT,
          sequence_length INTEGER,
          first_ec_number TEXT NOT NULL,
          occurrence_count INTEGER NOT NULL DEFAULT 1,
          accession_conflict INTEGER NOT NULL DEFAULT 0,
          sequence_conflict INTEGER NOT NULL DEFAULT 0,
          first_raw_path TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_brenda_identity_accession ON brenda_identities(first_accession);
        CREATE INDEX IF NOT EXISTS idx_brenda_identity_sequence ON brenda_identities(sequence_sha256);
        CREATE TABLE IF NOT EXISTS reactenz_exact_mappings (
          identity_key TEXT NOT NULL,
          biopart_id TEXT NOT NULL,
          ec_number TEXT NOT NULL,
          match_method TEXT NOT NULL,
          source_accession TEXT,
          sequence_sha256 TEXT,
          raw_path TEXT NOT NULL,
          PRIMARY KEY(identity_key, biopart_id, ec_number, match_method),
          FOREIGN KEY(identity_key) REFERENCES brenda_identities(identity_key)
        );
        CREATE INDEX IF NOT EXISTS idx_brenda_mapping_biopart ON reactenz_exact_mappings(biopart_id, ec_number);
        CREATE TABLE IF NOT EXISTS qa_results (
          check_name TEXT PRIMARY KEY,
          passed INTEGER NOT NULL,
          observed_value TEXT NOT NULL,
          expected_value TEXT,
          checked_at TEXT NOT NULL
        );
        """
    )
    conn.executemany(
        "INSERT OR REPLACE INTO metadata VALUES (?,?)",
        [
            ("catalog_version", "BRENDA_SEQUENCE_CATALOG_V1"),
            ("identity_policy", "BRENDA protein id; deterministic fallback only when id absent"),
            ("mapping_policy", "exact ReactEnzDB UniProt accession and/or exact SHA-256 amino-acid sequence"),
            ("sequence_storage_policy", "Only records exactly mapped to existing ReactEnzDB enzymes are catalogued; hash and length only; unmatched full sequences remain in checksummed raw cache"),
            ("updated_at", now()),
        ],
    )


def core_indexes() -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    accession: dict[str, set[str]] = defaultdict(set)
    seqhash: dict[str, set[str]] = defaultdict(set)
    with sqlite3.connect(EVIDENCE_DB) as conn:
        for biopart_id, acc, sha in conn.execute(
            "SELECT biopart_id,uniprot_accession,sequence_sha256 FROM enzymes WHERE reactenz_enzyme_id NOT LIKE 'UNMAPPED:%'"
        ):
            if acc:
                accession[str(acc).strip().upper()].add(str(biopart_id))
            if sha:
                seqhash[str(sha)].add(str(biopart_id))
    return accession, seqhash


def fetch_expectations() -> dict[str, tuple[str | None, int | None]]:
    result: dict[str, tuple[str | None, int | None]] = {}
    with sqlite3.connect(FETCH_DB) as conn:
        for relative, sha, count in conn.execute(
            "SELECT relative_path,sha256,item_count FROM fetch_status WHERE source='BRENDA' AND operation='getSequence' AND status='done'"
        ):
            if relative:
                result[Path(relative).as_posix()] = (sha, int(count))
    return result


def ingest_file(
    conn: sqlite3.Connection,
    path: Path,
    accession_index: dict[str, set[str]],
    sequence_index: dict[str, set[str]],
    expected_sha: str | None,
    expected_items: int | None,
) -> Counter:
    relative = path.relative_to(WORK).as_posix()
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        payload = json.load(handle)
    ec = str(payload.get("ec_number") or path.parent.name.removeprefix("EC_"))
    items = payload.get("items") or []
    if expected_items is not None and len(items) != expected_items:
        raise ValueError(f"item count mismatch: observed={len(items)} expected={expected_items}")
    stats = Counter(observed=len(items))
    for item in items:
        seqhash, seqlen = sequence_hash(item.get("sequence"))
        acc = text(item.get("firstAccessionCode"))
        acc_upper = acc.upper() if acc else None
        accession_matches = accession_index.get(acc_upper or "", set())
        sequence_matches = sequence_index.get(seqhash or "", set())
        candidates = accession_matches | sequence_matches
        if not candidates:
            stats["unmapped_occurrences"] += 1
            continue
        key = identity_key(ec, item, seqhash)
        existed = conn.execute("SELECT 1 FROM brenda_identities WHERE identity_key=?", (key,)).fetchone()
        conn.execute(
            """
            INSERT INTO brenda_identities(
              identity_key,brenda_protein_id,first_accession,source_label,organism,
              sequence_sha256,sequence_length,first_ec_number,occurrence_count,
              accession_conflict,sequence_conflict,first_raw_path
            ) VALUES (?,?,?,?,?,?,?,?,1,0,0,?)
            ON CONFLICT(identity_key) DO UPDATE SET
              occurrence_count=brenda_identities.occurrence_count+1,
              accession_conflict=max(brenda_identities.accession_conflict,
                CASE WHEN coalesce(brenda_identities.first_accession,'')<>coalesce(excluded.first_accession,'') THEN 1 ELSE 0 END),
              sequence_conflict=max(brenda_identities.sequence_conflict,
                CASE WHEN coalesce(brenda_identities.sequence_sha256,'')<>coalesce(excluded.sequence_sha256,'') THEN 1 ELSE 0 END)
            """,
            (
                key, text(item.get("id")), acc_upper, text(item.get("source")), text(item.get("organism")),
                seqhash, seqlen or text(item.get("noOfAminoAcids")), ec, relative,
            ),
        )
        stats["new_identities"] += int(not existed)
        for biopart_id in candidates:
            by_acc = biopart_id in accession_matches
            by_seq = biopart_id in sequence_matches
            method = "exact_accession_and_sequence" if by_acc and by_seq else "exact_accession" if by_acc else "exact_sequence_sha256"
            conn.execute(
                "INSERT OR IGNORE INTO reactenz_exact_mappings VALUES (?,?,?,?,?,?,?)",
                (key, biopart_id, ec, method, acc_upper, seqhash, relative),
            )
        stats["mapped_occurrences"] += int(bool(candidates))
        stats["mapping_rows"] += len(candidates)
    conn.execute(
        "INSERT OR REPLACE INTO processed_files VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (relative, ec, expected_sha, expected_items, len(items), stats["new_identities"], stats["mapped_occurrences"], stats["unmapped_occurrences"], "done", None, now()),
    )
    return stats


def finalize(conn: sqlite3.Connection, expected_files: int) -> dict[str, int]:
    observed_files = conn.execute("SELECT count(1) FROM processed_files WHERE status='done'").fetchone()[0]
    checks = [
        ("all_sequence_files_processed", observed_files == expected_files, observed_files, expected_files),
        ("no_identity_sequence_conflicts", conn.execute("SELECT count(1) FROM brenda_identities WHERE sequence_conflict=1").fetchone()[0] == 0, conn.execute("SELECT count(1) FROM brenda_identities WHERE sequence_conflict=1").fetchone()[0], 0),
        ("no_orphan_mappings", conn.execute("SELECT count(1) FROM reactenz_exact_mappings m LEFT JOIN brenda_identities b USING(identity_key) WHERE b.identity_key IS NULL").fetchone()[0] == 0, conn.execute("SELECT count(1) FROM reactenz_exact_mappings m LEFT JOIN brenda_identities b USING(identity_key) WHERE b.identity_key IS NULL").fetchone()[0], 0),
    ]
    conn.executemany(
        "INSERT OR REPLACE INTO qa_results VALUES (?,?,?,?,?)",
        [(name, int(passed), str(observed), str(expected), now()) for name, passed, observed, expected in checks],
    )
    result = {
        "processed_files": observed_files,
        "source_occurrences": conn.execute("SELECT coalesce(sum(observed_items),0) FROM processed_files WHERE status='done'").fetchone()[0],
        "mapped_brenda_identities": conn.execute("SELECT count(1) FROM brenda_identities").fetchone()[0],
        "unique_accessions": conn.execute("SELECT count(DISTINCT first_accession) FROM brenda_identities WHERE first_accession IS NOT NULL").fetchone()[0],
        "unique_sequence_hashes": conn.execute("SELECT count(DISTINCT sequence_sha256) FROM brenda_identities WHERE sequence_sha256 IS NOT NULL").fetchone()[0],
        "unmapped_source_occurrences": conn.execute("SELECT coalesce(sum(unmapped_occurrences),0) FROM processed_files WHERE status='done'").fetchone()[0],
        "mapped_reactenz_enzymes": conn.execute("SELECT count(DISTINCT biopart_id) FROM reactenz_exact_mappings").fetchone()[0],
        "mapping_rows": conn.execute("SELECT count(1) FROM reactenz_exact_mappings").fetchone()[0],
        "qa_passed": sum(int(row[1]) for row in checks),
        "qa_total": len(checks),
    }
    conn.execute("INSERT OR REPLACE INTO metadata VALUES ('updated_at',?)", (now(),))
    conn.commit()
    SUMMARY.write_text(json.dumps({"generated_at": now(), **result}, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a resumable, deduplicated BRENDA sequence identity catalog.")
    parser.add_argument("--limit-files", type=int)
    parser.add_argument("--reprocess", action="store_true")
    args = parser.parse_args()
    accession_index, sequence_index = core_indexes()
    expectations = fetch_expectations()
    paths = sorted(RAW_ROOT.glob("EC_*/getSequence.json.gz"))
    if args.limit_files:
        paths = paths[: max(0, args.limit_files)]
    conn = sqlite3.connect(OUTPUT_DB)
    create_schema(conn)
    totals = Counter()
    for index, path in enumerate(paths, 1):
        relative = path.relative_to(WORK).as_posix()
        expected_sha, expected_items = expectations.get(relative, (None, None))
        done = conn.execute("SELECT status,expected_sha256 FROM processed_files WHERE source_file=?", (relative,)).fetchone()
        if done and done[0] == "done" and done[1] == expected_sha and not args.reprocess:
            continue
        try:
            stats = ingest_file(conn, path, accession_index, sequence_index, expected_sha, expected_items)
            conn.commit()
            totals.update(stats)
            totals["files"] += 1
        except Exception as exc:
            conn.rollback()
            ec = path.parent.name.removeprefix("EC_")
            conn.execute(
                "INSERT OR REPLACE INTO processed_files VALUES (?,?,?,?,0,0,0,0,'error',?,?)",
                (relative, ec, expected_sha, expected_items, str(exc)[:1000], now()),
            )
            conn.commit()
            print(f"[brenda-sequence-catalog] ERROR {relative}: {exc}", flush=True)
        if index == 1 or index % 25 == 0:
            print(
                f"[brenda-sequence-catalog] {index:,}/{len(paths):,} files; "
                f"occurrences={totals['observed']:,} new_identities={totals['new_identities']:,} "
                f"mapped_occurrences={totals['mapped_occurrences']:,}",
                flush=True,
            )
    result = finalize(conn, len(paths))
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
    print("integrity:", conn.execute("PRAGMA integrity_check").fetchone()[0], flush=True)
    conn.close()


if __name__ == "__main__":
    main()
