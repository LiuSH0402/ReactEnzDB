from __future__ import annotations
import os

import argparse
import csv
import json
import sqlite3
import sys
import time
from pathlib import Path

from protein_reference_inheritance import install_plan, restore_inherited_references, validated_selection
from uniprot_alias_inheritance import install_alias_plan, recorded_aliases, restore_aliases, validate_records as validate_alias_records


ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = Path(os.environ.get("REACTENZDB_INPUT_ROOT", ROOT / "inputs"))
DEFAULT_EXPORTS = DATA_ROOT / "rdbsb_v2" / "exports_v2"
DEFAULT_SOURCE_DB = DATA_ROOT / "rdbsb_v2" / "rdbsb_biosyn_v2.db"
DEFAULT_WEB_DB = ROOT / "web_release" / "reactenzdb_web.db"
BATCH_SIZE = 10_000


def connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA temp_store = MEMORY")
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn


def column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    return any(row["name"] == column for row in conn.execute(f"PRAGMA table_info({table})"))


def log(message: str) -> None:
    print(message, flush=True)


def load_release_keys(conn: sqlite3.Connection) -> tuple[set[str], set[str], set[str]]:
    reaction_ids = {row["reaction_id"] for row in conn.execute("SELECT reaction_id FROM web_reactions")}
    biopart_ids = {row["biopart_id"] for row in conn.execute("SELECT biopart_id FROM web_enzymes")}
    relation_ids = {
        f"{row['biopart_id']}::{row['reaction_id']}"
        for row in conn.execute("SELECT biopart_id, reaction_id FROM web_reaction_enzymes")
    }
    return reaction_ids, biopart_ids, relation_ids


def add_kinetic_pmids(conn: sqlite3.Connection, source_db: Path) -> None:
    if not column_exists(conn, "web_kinetics", "evidence_text"):
        conn.execute("ALTER TABLE web_kinetics ADD COLUMN evidence_text TEXT")
    if not column_exists(conn, "web_kinetics", "pmids_json"):
        conn.execute("ALTER TABLE web_kinetics ADD COLUMN pmids_json TEXT")
    conn.commit()

    source = str(source_db).replace("'", "''")
    conn.execute(f"ATTACH DATABASE '{source}' AS src")
    start = time.time()
    log("[evidence] kinetic PMID evidence ...")
    conn.executescript(
        """
        UPDATE web_kinetics
        SET
            evidence_text = (
                SELECT k.evidence_text
                FROM src.kinetics k
                WHERE k.kinetic_id = web_kinetics.kinetic_id
            ),
            pmids_json = (
                SELECT k.pmids_json
                FROM src.kinetics k
                WHERE k.kinetic_id = web_kinetics.kinetic_id
            );
        """
    )
    conn.commit()
    conn.execute("DETACH DATABASE src")
    log(f"[evidence] kinetic PMID evidence done in {time.time() - start:.1f}s")


def insert_batch(conn: sqlite3.Connection, sql: str, rows: list[tuple]) -> int:
    if not rows:
        return 0
    conn.executemany(sql, rows)
    conn.commit()
    n = len(rows)
    rows.clear()
    return n


def build_references(conn: sqlite3.Connection, exports: Path, reaction_ids: set[str], biopart_ids: set[str], inheritance_plan: list[dict] | None = None) -> None:
    start = time.time()
    # A reused identifier must not silently inherit the old protein's papers.
    # Validate before the destructive rebuild; the provenance table is retained.
    validated_selection(conn)
    log("[evidence] publication references from CSV ...")
    conn.executescript(
        """
        DROP TABLE IF EXISTS web_entity_references;
        CREATE TABLE web_entity_references (
            reference_id INTEGER,
            entity_type TEXT,
            entity_id TEXT,
            pmid TEXT,
            citation_text TEXT,
            reference_url TEXT,
            source_db TEXT
        );
        """
    )
    insert_sql = """
        INSERT INTO web_entity_references(
            reference_id, entity_type, entity_id, pmid, citation_text, reference_url, source_db
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    """
    rows: list[tuple] = []
    inserted = 0
    with (exports / "entity_references.csv").open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for i, row in enumerate(reader, 1):
            entity_type = row["entity_type"]
            entity_id = row["entity_id"]
            if entity_type == "reaction":
                if entity_id not in reaction_ids:
                    continue
                web_type = "reaction"
            elif entity_type == "biopart":
                if entity_id not in biopart_ids:
                    continue
                web_type = "enzyme"
            else:
                continue
            pmid = (row.get("pmid") or "").strip()
            if not pmid:
                continue
            rows.append((
                int(row["reference_id"]) if row.get("reference_id") else None,
                web_type,
                entity_id,
                pmid,
                row.get("citation_text"),
                row.get("reference_url"),
                row.get("source_db"),
            ))
            if len(rows) >= BATCH_SIZE:
                inserted += insert_batch(conn, insert_sql, rows)
            if i % 500_000 == 0:
                log(f"[evidence] scanned {i:,} reference rows; inserted {inserted:,}")
    inserted += insert_batch(conn, insert_sql, rows)
    conn.executescript(
        """
        CREATE INDEX idx_web_entity_references_entity ON web_entity_references(entity_type, entity_id);
        CREATE INDEX idx_web_entity_references_pmid ON web_entity_references(pmid);
        """
    )
    conn.commit()
    with conn:
        restored = install_plan(conn, inheritance_plan) if inheritance_plan is not None else restore_inherited_references(conn)
    log(f"[evidence] replayed {restored:,} audited inherited protein references")
    log(f"[evidence] publication references inserted {inserted:,} in {time.time() - start:.1f}s")


def build_xrefs(conn: sqlite3.Connection, exports: Path, reaction_ids: set[str], biopart_ids: set[str], alias_plan: list[dict] | None = None) -> None:
    start = time.time()
    validate_alias_records(conn, recorded_aliases(conn))
    if alias_plan is not None:
        validate_alias_records(conn, alias_plan)
    log("[evidence] expanded cross references from CSV ...")
    existing = {
        tuple(row)
        for row in conn.execute("SELECT entity_type, entity_id, xref_db, xref_value, COALESCE(xref_url, ''), COALESCE(source_db, '') FROM web_xrefs")
    }
    insert_sql = """
        INSERT INTO web_xrefs(entity_type, entity_id, xref_db, xref_value, xref_url, source_db)
        VALUES (?, ?, ?, ?, ?, ?)
    """
    rows: list[tuple] = []
    inserted = 0
    with (exports / "xrefs.csv").open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for i, row in enumerate(reader, 1):
            entity_type = row["entity_type"]
            entity_id = row["entity_id"]
            if entity_type == "reaction":
                if entity_id not in reaction_ids:
                    continue
                web_type = "reaction"
            elif entity_type == "biopart":
                if entity_id not in biopart_ids:
                    continue
                web_type = "enzyme"
            else:
                continue
            value = (row.get("xref_value") or "").strip()
            if not value:
                continue
            item = (
                web_type,
                entity_id,
                row.get("xref_db") or "",
                value,
                row.get("xref_url") or "",
                row.get("source_db") or "",
            )
            if item in existing:
                continue
            existing.add(item)
            rows.append(item)
            if len(rows) >= BATCH_SIZE:
                inserted += insert_batch(conn, insert_sql, rows)
            if i % 500_000 == 0:
                log(f"[evidence] scanned {i:,} xref rows; inserted {inserted:,}")
    inserted += insert_batch(conn, insert_sql, rows)
    conn.executescript(
        """
        CREATE INDEX IF NOT EXISTS idx_web_xrefs_entity ON web_xrefs(entity_type, entity_id);
        DROP INDEX IF EXISTS idx_web_xrefs_db;
        CREATE INDEX idx_web_xrefs_db ON web_xrefs(xref_db);
        """
    )
    conn.commit()
    with conn:
        restored = install_alias_plan(conn, alias_plan) if alias_plan is not None else restore_aliases(conn)
    log(f"[evidence] replayed {restored:,} identity-verified UniProt aliases")
    log(f"[evidence] cross references inserted {inserted:,} in {time.time() - start:.1f}s")


def build_attribute_evidence(conn: sqlite3.Connection, exports: Path, biopart_ids: set[str], relation_ids: set[str]) -> None:
    start = time.time()
    log("[evidence] field-level PMID evidence from CSV ...")
    conn.executescript(
        """
        DROP TABLE IF EXISTS web_attribute_evidences;
        CREATE TABLE web_attribute_evidences (
            attribute_evidence_id TEXT,
            entity_type TEXT,
            entity_id TEXT,
            attribute_name TEXT,
            value_text TEXT,
            value_numeric REAL,
            unit TEXT,
            source_label TEXT,
            source_db TEXT,
            external_id TEXT,
            external_url TEXT,
            pmids_json TEXT,
            citations_json TEXT
        );
        """
    )
    insert_sql = """
        INSERT INTO web_attribute_evidences(
            attribute_evidence_id, entity_type, entity_id, attribute_name, value_text,
            value_numeric, unit, source_label, source_db, external_id, external_url,
            pmids_json, citations_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
    rows: list[tuple] = []
    inserted = 0
    with (exports / "attribute_evidences.csv").open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for i, row in enumerate(reader, 1):
            pmids = (row.get("pmids_json") or "").strip()
            if not pmids or pmids == "[]":
                continue
            entity_type = row["entity_type"]
            entity_id = row["entity_id"]
            if entity_type == "biopart_reaction":
                if entity_id not in relation_ids:
                    continue
                web_type = "biopart_reaction"
            elif entity_type == "biopart":
                if entity_id not in biopart_ids:
                    continue
                web_type = "enzyme"
            else:
                continue
            value_numeric = row.get("value_numeric")
            rows.append((
                row.get("attribute_evidence_id"),
                web_type,
                entity_id,
                row.get("attribute_name"),
                row.get("value_text"),
                float(value_numeric) if value_numeric not in (None, "") else None,
                row.get("unit"),
                row.get("source_label"),
                row.get("source_db"),
                row.get("external_id"),
                row.get("external_url"),
                pmids,
                row.get("citations_json"),
            ))
            if len(rows) >= BATCH_SIZE:
                inserted += insert_batch(conn, insert_sql, rows)
            if i % 500_000 == 0:
                log(f"[evidence] scanned {i:,} evidence rows; inserted {inserted:,}")
    inserted += insert_batch(conn, insert_sql, rows)
    conn.executescript(
        """
        CREATE INDEX idx_web_attribute_evidences_entity ON web_attribute_evidences(entity_type, entity_id);
        CREATE INDEX idx_web_attribute_evidences_attribute ON web_attribute_evidences(attribute_name);
        """
    )
    conn.commit()
    log(f"[evidence] field-level PMID evidence inserted {inserted:,} in {time.time() - start:.1f}s")


def update_stats(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        INSERT OR REPLACE INTO web_stats(metric, value)
        VALUES
          ('publication_references', (SELECT CAST(COUNT(*) AS TEXT) FROM web_entity_references)),
          ('field_level_evidences', (SELECT CAST(COUNT(*) AS TEXT) FROM web_attribute_evidences)),
          ('kinetics_with_pmids', (SELECT CAST(COUNT(*) AS TEXT) FROM web_kinetics WHERE pmids_json IS NOT NULL AND trim(pmids_json) NOT IN ('', '[]'))),
          ('enzyme_xrefs', (SELECT CAST(COUNT(*) AS TEXT) FROM web_xrefs WHERE entity_type = 'enzyme'));
        """
    )
    conn.commit()


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--exports", type=Path, default=DEFAULT_EXPORTS)
    parser.add_argument("--source-db", type=Path, default=DEFAULT_SOURCE_DB)
    parser.add_argument("--web-db", type=Path, default=DEFAULT_WEB_DB)
    parser.add_argument("--skip-evidence", action="store_true")
    parser.add_argument("--reference-inheritance-plan", type=Path,
                        help="Audited JSONL source-reference plan to retain inheritance in a completely new build")
    parser.add_argument("--uniprot-alias-plan", type=Path,
                        help="Official-identity-verified JSONL alias plan; secondary accessions retain their role")
    args = parser.parse_args()
    inheritance_plan = None
    if args.reference_inheritance_plan:
        inheritance_plan = [json.loads(line) for line in args.reference_inheritance_plan.read_text(encoding="utf-8").splitlines() if line.strip()]
    alias_plan = None
    if args.uniprot_alias_plan:
        alias_plan = [json.loads(line) for line in args.uniprot_alias_plan.read_text(encoding="utf-8").splitlines() if line.strip()]

    if not args.exports.exists():
        raise FileNotFoundError(args.exports)
    if not args.source_db.exists():
        raise FileNotFoundError(args.source_db)
    if not args.web_db.exists():
        raise FileNotFoundError(args.web_db)

    conn = connect(args.web_db)
    reaction_ids, biopart_ids, relation_ids = load_release_keys(conn)
    log(f"[evidence] release keys: {len(reaction_ids):,} reactions, {len(biopart_ids):,} enzymes, {len(relation_ids):,} reaction-enzyme links")

    add_kinetic_pmids(conn, args.source_db)
    build_references(conn, args.exports, reaction_ids, biopart_ids, inheritance_plan)
    build_xrefs(conn, args.exports, reaction_ids, biopart_ids, alias_plan)
    if not args.skip_evidence:
        build_attribute_evidence(conn, args.exports, biopart_ids, relation_ids)
    update_stats(conn)
    conn.close()


if __name__ == "__main__":
    main()
