from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "evidence_work"
DB = WORK / "enzyme_reaction_evidence.sqlite"
FETCH_DB = WORK / "source_fetch_status.sqlite"
REPORT = WORK / "qa" / "evidence_qa_report.json"
FAILURES = WORK / "qa" / "evidence_qa_failures.tsv"
SEQUENCE_CATALOG = WORK / "brenda_sequence_catalog.sqlite"
RAW_BRENDA = WORK / "raw" / "brenda"


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def scalar(conn: sqlite3.Connection, sql: str, args: tuple = ()) -> int:
    return int(conn.execute(sql, args).fetchone()[0])


def directory_snapshot_key(ec_dir: Path) -> str:
    files = sorted((path.name, path.stat().st_size) for path in ec_dir.glob("*.json.gz"))
    digest = hashlib.sha256(json.dumps(files, separators=(",", ":")).encode()).hexdigest()[:16]
    return f"{ec_dir.relative_to(WORK).as_posix()}@snapshot:{digest}"


def main() -> None:
    parser = argparse.ArgumentParser(description="Independent QA for the ReactEnzDB assay evidence work layer.")
    parser.add_argument("--verify-all-raw-hashes", action="store_true")
    args = parser.parse_args()
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    checks: list[dict] = []
    failures: list[dict[str, str]] = []

    def check(name: str, observed: int | str, expected: int | str, passed: bool, detail: str = "") -> None:
        checks.append({"check": name, "passed": bool(passed), "observed": observed, "expected": expected, "detail": detail})
        if not passed:
            failures.append({"check": name, "observed": str(observed), "expected": str(expected), "detail": detail})

    integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
    check("sqlite_integrity", integrity, "ok", integrity == "ok")
    fk = list(conn.execute("PRAGMA foreign_key_check"))
    check("foreign_key_violations", len(fk), 0, len(fk) == 0, str([tuple(x) for x in fk[:5]]))
    orphan_compounds = scalar(conn, "SELECT count(1) FROM assertion_compounds c LEFT JOIN experimental_assertions a USING(assertion_id) WHERE a.assertion_id IS NULL")
    check("orphan_assertion_compounds", orphan_compounds, 0, orphan_compounds == 0)
    orphan_measurements = scalar(conn, "SELECT count(1) FROM measurements m LEFT JOIN experimental_assertions a USING(assertion_id) WHERE a.assertion_id IS NULL")
    check("orphan_measurements", orphan_measurements, 0, orphan_measurements == 0)
    missing_raw = scalar(conn, "SELECT count(1) FROM experimental_assertions WHERE raw_cache_path IS NOT NULL AND raw_cache_path<>''")
    missing_paths = []
    for row in conn.execute("SELECT DISTINCT raw_cache_path FROM experimental_assertions WHERE raw_cache_path IS NOT NULL AND raw_cache_path<>''"):
        if not (WORK / row[0]).exists():
            missing_paths.append(row[0])
    check("assertion_raw_cache_paths_exist", len(missing_paths), 0, len(missing_paths) == 0, str(missing_paths[:10]))
    exact_bad = scalar(conn, """
      SELECT count(1) FROM experimental_assertions
      WHERE evidence_class='exact_substrate_product_experimental_evidence'
        AND (is_experimental<>1 OR reaction_id IS NULL OR biopart_id IS NULL OR pmid_count<1
          OR substrate_identity_status<>'exact_structure_set' OR product_identity_status<>'exact_structure_set')
    """)
    check("strict_exact_minimum_requirements", exact_bad, 0, exact_bad == 0)
    exact_without_both_roles = scalar(conn, """
      SELECT count(1) FROM experimental_assertions a
      WHERE evidence_class='exact_substrate_product_experimental_evidence'
        AND (NOT EXISTS (SELECT 1 FROM assertion_compounds c WHERE c.assertion_id=a.assertion_id AND c.participant_role='substrate' AND c.is_exact_structure_match=1)
          OR NOT EXISTS (SELECT 1 FROM assertion_compounds c WHERE c.assertion_id=a.assertion_id AND c.participant_role='product' AND c.is_exact_structure_match=1))
    """)
    check("strict_exact_has_both_compound_roles", exact_without_both_roles, 0, exact_without_both_roles == 0)
    exact_without_catalytic = scalar(conn, """
      SELECT count(1) FROM experimental_assertions a
      WHERE evidence_class='exact_substrate_product_experimental_evidence'
        AND NOT EXISTS (SELECT 1 FROM measurements m WHERE m.assertion_id=a.assertion_id
          AND lower(m.parameter_type) IN ('kcat','km','vmax','specific activity','specific_activity','turnover number','kcat/km','vmax/km'))
    """)
    check("strict_exact_has_catalytic_parameter", exact_without_catalytic, 0, exact_without_catalytic == 0)
    # Cryosolvent enzyme spectroscopy/kinetics can legitimately be below
    # -30 C (the full SABIO corpus contains -33.15 C assays).  Keep a broad
    # physical plausibility guard here; unusual-but-valid conditions remain
    # visible to downstream review rather than being rewritten.
    invalid_conditions = scalar(conn, "SELECT count(1) FROM assay_conditions WHERE (ph IS NOT NULL AND (ph<0 OR ph>14)) OR (temperature_c IS NOT NULL AND (temperature_c<-100 OR temperature_c>200))")
    check("condition_plausibility", invalid_conditions, 0, invalid_conditions == 0)
    quantitative_without_measurement = scalar(conn, """
      SELECT count(1) FROM experimental_assertions a
      WHERE has_quantitative_measurement=1 AND NOT EXISTS (SELECT 1 FROM measurements m WHERE m.assertion_id=a.assertion_id)
    """)
    check("quantitative_flag_has_measurement", quantitative_without_measurement, 0, quantitative_without_measurement == 0)
    duplicate_assertions = scalar(conn, "SELECT count(1)-count(DISTINCT assertion_id) FROM experimental_assertions")
    check("duplicate_assertion_ids", duplicate_assertions, 0, duplicate_assertions == 0)
    brenda_sentinels = scalar(conn, """
      SELECT count(1) FROM measurements m JOIN experimental_assertions a USING(assertion_id)
      WHERE a.source_db='BRENDA' AND (m.raw_value_numeric=-999 OR trim(coalesce(m.raw_value_text,''))='-999')
    """)
    check("brenda_missing_value_sentinels_removed", brenda_sentinels, 0, brenda_sentinels == 0)
    brenda_strict_exact = scalar(conn, "SELECT count(1) FROM experimental_assertions WHERE source_db='BRENDA' AND evidence_class='exact_substrate_product_experimental_evidence'")
    check("brenda_unique_name_mapping_not_strict_exact", brenda_strict_exact, 0, brenda_strict_exact == 0)
    context_count = scalar(conn, "SELECT count(1) FROM brenda_context_records")
    check("brenda_context_records_ingested", context_count, ">0", context_count > 0)
    current_snapshot_keys = [directory_snapshot_key(path) for path in sorted(RAW_BRENDA.glob("EC_*"))]
    completed_snapshot_keys = {
        row[0] for row in conn.execute("SELECT source_file FROM source_ingestion_status WHERE source='BRENDA' AND status='done'")
    }
    missing_current_snapshots = [key for key in current_snapshot_keys if key not in completed_snapshot_keys]
    check("brenda_current_snapshots_ingested", len(missing_current_snapshots), 0, len(missing_current_snapshots) == 0, str(missing_current_snapshots[:10]))

    if SEQUENCE_CATALOG.exists():
        catalog = sqlite3.connect(SEQUENCE_CATALOG)
        catalog_files = scalar(catalog, "SELECT count(1) FROM processed_files")
        catalog_qa_failures = scalar(catalog, "SELECT count(1) FROM qa_results WHERE passed<>1")
        mapped_enzymes = scalar(catalog, "SELECT count(DISTINCT biopart_id) FROM reactenz_exact_mappings")
        catalog.close()
        check("brenda_sequence_catalog_complete", catalog_files, len(current_snapshot_keys), catalog_files == len(current_snapshot_keys))
        check("brenda_sequence_catalog_qa", catalog_qa_failures, 0, catalog_qa_failures == 0)
        check("brenda_sequence_catalog_has_exact_mappings", mapped_enzymes, ">0", mapped_enzymes > 0)
    else:
        check("brenda_sequence_catalog_exists", 0, 1, False)

    raw_audit = {"done_files": 0, "missing_files": 0, "hash_mismatches": 0, "hashes_checked": 0}
    if FETCH_DB.exists():
        source = sqlite3.connect(FETCH_DB)
        rows = source.execute("SELECT source,ec_number,operation,relative_path,sha256 FROM fetch_status WHERE status='done' AND relative_path IS NOT NULL").fetchall()
        fetch_errors = source.execute("SELECT count(1) FROM fetch_status WHERE status='error'").fetchone()[0]
        brenda_fetch_rows = source.execute("SELECT count(1) FROM fetch_status WHERE source='BRENDA' AND status='done'").fetchone()[0]
        sabio_fetch_rows = source.execute("SELECT count(1) FROM fetch_status WHERE source='SABIO-RK' AND status='done'").fetchone()[0]
        source.close()
        check("fetch_status_errors", fetch_errors, 0, fetch_errors == 0)
        check("brenda_fetch_matrix_complete", brenda_fetch_rows, len(current_snapshot_keys) * 23, brenda_fetch_rows == len(current_snapshot_keys) * 23)
        check("sabio_complete_entries_fetched", sabio_fetch_rows, len(current_snapshot_keys), sabio_fetch_rows == len(current_snapshot_keys))
        raw_audit["done_files"] = len(rows)
        for index, (source_name, ec, operation, relative, expected_hash) in enumerate(rows):
            path = WORK / relative
            if not path.exists():
                raw_audit["missing_files"] += 1
                failures.append({"check": "fetch_raw_file_exists", "observed": relative, "expected": "existing file", "detail": f"{source_name} {ec} {operation}"})
                continue
            if args.verify_all_raw_hashes or index < 25:
                raw_audit["hashes_checked"] += 1
                if expected_hash and file_sha256(path) != expected_hash:
                    raw_audit["hash_mismatches"] += 1
        check("fetch_raw_files_exist", raw_audit["missing_files"], 0, raw_audit["missing_files"] == 0)
        check("fetch_raw_sha256", raw_audit["hash_mismatches"], 0, raw_audit["hash_mismatches"] == 0, f"checked {raw_audit['hashes_checked']}")

    counts = {
        "assertions": scalar(conn, "SELECT count(1) FROM experimental_assertions"),
        "measurements": scalar(conn, "SELECT count(1) FROM measurements"),
        "assay_conditions": scalar(conn, "SELECT count(1) FROM assay_conditions"),
        "citations": scalar(conn, "SELECT count(1) FROM citations"),
        "enzyme_forms": scalar(conn, "SELECT count(1) FROM enzyme_forms"),
        "exact_automatic": scalar(conn, "SELECT count(1) FROM experimental_assertions WHERE evidence_class='exact_substrate_product_experimental_evidence'"),
        "literature_verified": scalar(conn, "SELECT count(1) FROM experimental_assertions WHERE curation_status='literature_verified'"),
        "inactive_or_negative": scalar(conn, "SELECT count(1) FROM experimental_assertions WHERE outcome_class IN ('inactive','negative_or_below_detection')"),
    }
    by_source = [dict(row) for row in conn.execute("SELECT source_db,count(1) assertions,sum(has_quantitative_measurement) quantitative,sum(pmid_count>0) with_pmid FROM experimental_assertions GROUP BY source_db ORDER BY source_db")]
    report = {"generated_at": now(), "passed": all(x["passed"] for x in checks), "counts": counts, "by_source": by_source, "raw_audit": raw_audit, "checks": checks}
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    with FAILURES.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["check", "observed", "expected", "detail"], delimiter="\t")
        writer.writeheader()
        writer.writerows(failures)
    conn.execute("DELETE FROM qa_results WHERE check_name LIKE 'evidence_v1:%'")
    conn.executemany("INSERT INTO qa_results VALUES (?,?,?,?,?)", [("evidence_v1:" + x["check"], int(x["passed"]), str(x["observed"]), str(x["expected"]), report["generated_at"]) for x in checks])
    conn.commit()
    conn.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report["passed"] else 1)


if __name__ == "__main__":
    main()
