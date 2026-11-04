from __future__ import annotations

import csv
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RELEASE = ROOT / "evidence_work" / "release_candidate"
DB = RELEASE / "reactenzdb_evidence_rc.sqlite"
SUMMARY = RELEASE / "reactenzdb_evidence_rc.summary.json"
MANIFEST = RELEASE / "manifest.json"
REPORT = RELEASE / "qa_report.json"
FAILURES = RELEASE / "qa_failures.tsv"


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    summary = json.loads(SUMMARY.read_text(encoding="utf-8"))
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    conn = sqlite3.connect(DB)
    checks: list[dict] = []

    def check(name: str, observed, expected, passed: bool) -> None:
        checks.append({"check": name, "passed": bool(passed), "observed": observed, "expected": expected})

    integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
    check("sqlite_integrity", integrity, "ok", integrity == "ok")
    fk = len(list(conn.execute("PRAGMA foreign_key_check")))
    check("foreign_keys", fk, 0, fk == 0)
    metadata = dict(conn.execute("SELECT key,value FROM metadata"))
    check("release_version", metadata.get("release_version"), "EVIDENCE_RC_V2", metadata.get("release_version") == "EVIDENCE_RC_V2")
    check("brenda_declared_in_sources", "BRENDA" in metadata.get("included_sources", ""), True, "BRENDA" in metadata.get("included_sources", ""))
    failed_embedded_qa = conn.execute("SELECT count(1) FROM qa_results WHERE passed<>1").fetchone()[0]
    check("embedded_qa", failed_embedded_qa, 0, failed_embedded_qa == 0)

    count_queries = {
        "assertions": "SELECT count(1) FROM assertions",
        "canonical_assertions": "SELECT count(1) FROM assertions WHERE is_canonical=1",
        "measurements": "SELECT count(1) FROM measurements",
        "citations": "SELECT count(1) FROM citations",
        "reaction_enzyme_pairs": "SELECT count(1) FROM reaction_enzyme_summary",
        "reactions_with_evidence": "SELECT count(1) FROM reaction_summary",
        "enzymes_with_evidence": "SELECT count(1) FROM enzyme_summary",
        "brenda_context_records": "SELECT count(1) FROM brenda_context_records",
    }
    for key, sql in count_queries.items():
        observed = conn.execute(sql).fetchone()[0]
        check(f"summary_count:{key}", observed, summary.get(key), observed == summary.get(key))

    brenda_assertions = conn.execute("SELECT count(1) FROM assertions WHERE source_db='BRENDA'").fetchone()[0]
    check("brenda_assertions_present", brenda_assertions, ">0", brenda_assertions > 0)
    duplicate_group_errors = conn.execute(
        "SELECT count(1) FROM (SELECT duplicate_group_id FROM assertions GROUP BY duplicate_group_id HAVING sum(is_canonical)<>1 OR max(duplicate_group_member_count)<>count(1))"
    ).fetchone()[0]
    check("duplicate_group_invariants", duplicate_group_errors, 0, duplicate_group_errors == 0)
    sentinels = conn.execute(
        "SELECT count(1) FROM measurements m JOIN assertions a USING(assertion_id) WHERE a.source_db='BRENDA' AND (m.raw_value_numeric=-999 OR trim(coalesce(m.raw_value_text,'')) IN ('-999','-999.0'))"
    ).fetchone()[0]
    check("brenda_missing_value_sentinels", sentinels, 0, sentinels == 0)
    exact_bad = conn.execute(
        """
        SELECT count(1) FROM assertions
        WHERE evidence_class='exact_substrate_product_experimental_evidence'
          AND (is_experimental<>1 OR reaction_id IS NULL OR primary_biopart_id IS NULL
            OR substrate_identity_status<>'exact_structure_set' OR product_identity_status<>'exact_structure_set')
        """
    ).fetchone()[0]
    check("strict_exact_identity_requirements", exact_bad, 0, exact_bad == 0)
    context_bad = conn.execute(
        "SELECT count(1) FROM brenda_context_records WHERE linkage_boundary IS NULL OR trim(linkage_boundary)='' OR trim(coalesce(value_text,'')) IN ('-999','-999.0')"
    ).fetchone()[0]
    check("brenda_context_boundaries", context_bad, 0, context_bad == 0)
    assertion_columns = {row[1] for row in conn.execute("PRAGMA table_info(assertions)")}
    context_columns = {row[1] for row in conn.execute("PRAGMA table_info(brenda_context_records)")}
    check("no_raw_cache_path_in_public_tables", bool({"raw_cache_path", "raw_path"} & (assertion_columns | context_columns)), False, not ({"raw_cache_path", "raw_path"} & (assertion_columns | context_columns)))
    check("raw_commentary_not_redistributed", "commentary" in context_columns, False, "commentary" not in context_columns)

    for artifact in manifest.get("artifacts", []):
        path = RELEASE / artifact["file"]
        exists = path.exists()
        check(f"artifact_exists:{artifact['file']}", exists, True, exists)
        if exists:
            size = path.stat().st_size
            check(f"artifact_size:{artifact['file']}", size, artifact["size"], size == artifact["size"])
            digest = sha256(path)
            check(f"artifact_sha256:{artifact['file']}", digest, artifact["sha256"], digest == artifact["sha256"])

    conn.close()
    report = {
        "generated_at": now(),
        "passed": all(item["passed"] for item in checks),
        "checks_passed": sum(item["passed"] for item in checks),
        "checks_total": len(checks),
        "checks": checks,
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    with FAILURES.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["check", "observed", "expected"], delimiter="\t")
        writer.writeheader()
        writer.writerows({key: row[key] for key in writer.fieldnames} for row in checks if not row["passed"])

    artifacts = [item for item in manifest.get("artifacts", []) if item.get("file") != REPORT.name]
    artifacts.append({"file": REPORT.name, "size": REPORT.stat().st_size, "sha256": sha256(REPORT)})
    manifest["artifacts"] = artifacts
    manifest["qa_passed"] = report["passed"]
    manifest["qa_checks"] = f"{report['checks_passed']}/{report['checks_total']}"
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report["passed"] else 1)


if __name__ == "__main__":
    main()
