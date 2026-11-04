"""Reconcile metadata against actual runtime and reviewed-download bytes.

Scientific SQLite files are opened read-only. Published source files are never
modified: an amended local download tree shares unchanged data by hard link.
"""
from __future__ import annotations

import argparse
import csv
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import zipfile

ROOT = Path(__file__).resolve().parents[1]
RELEASE = ROOT / "web_release"
DEFAULT_WORK = ROOT / "work" / "release_metadata"
AMENDMENT = "metadata-consistency-20261101-v1"
GATE_SQL = """SELECT COUNT(*) FROM reaction_inputs i
 WHERE EXISTS (SELECT 1 FROM balance_results b WHERE b.reaction_id=i.reaction_id AND b.balance_context='full_explicit' AND b.mass_balance_status='balanced')
 AND EXISTS (SELECT 1 FROM balance_results b WHERE b.reaction_id=i.reaction_id AND b.balance_context='full_explicit' AND b.charge_balance_status='balanced')
 AND EXISTS (SELECT 1 FROM cross_database_mappings m WHERE m.reaction_id=i.reaction_id AND m.target_db='Rhea' AND m.chemistry_equivalence='exact_normalized_identity')
 AND EXISTS (SELECT 1 FROM atom_mappings a WHERE a.reaction_id=i.reaction_id AND a.mapping_status IN ('valid','valid_with_warnings','validated_predicted'))
 AND NOT EXISTS (SELECT 1 FROM mapping_conflicts c WHERE c.reaction_id=i.reaction_id)"""
HASH_CACHE = {}


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".metadata-incoming")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def write_text(path, value):
    temporary = path.with_name(path.name + ".metadata-incoming")
    temporary.write_text(value, encoding="utf-8")
    os.replace(temporary, path)


def sha(path):
    stat = path.stat()
    key = (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns)
    if key not in HASH_CACHE:
        result = hashlib.sha256()
        with path.open("rb") as source:
            for block in iter(lambda: source.read(8 * 1024 * 1024), b""):
                result.update(block)
        HASH_CACHE[key] = result.hexdigest()
    return HASH_CACHE[key]


def info(path):
    return {"size": path.stat().st_size, "sha256": sha(path)}


def ro(path):
    conn = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only=ON")
    return conn


def rows(conn, sql):
    return [dict(row) for row in conn.execute(sql)]


def counts(conn):
    return {row[0]: conn.execute('SELECT count(*) FROM "' + row[0].replace('"', '""') + '"').fetchone()[0]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}


def backup(path, work):
    output = work / "before" / path.relative_to(RELEASE)
    if not output.exists():
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, output)


def amend_citation(path, snapshot, date):
    import re
    text = path.read_text(encoding="utf-8")
    text = re.sub(r'^message:.*$', 'message: "Cite this exact data snapshot and the SHA256 of the downloaded file. Metadata corrections do not add experimental evidence or establish a manuscript or archive DOI."', text, flags=re.M)
    text = re.sub(r'^version:.*$', f'version: "{snapshot}"', text, flags=re.M)
    text = re.sub(r'^date-released:.*\n?', '', text, flags=re.M)
    text += f'date-released: "{date}"\n'
    write_text(path, text)


def main(work):
    work = work.resolve()
    assert work.is_relative_to(ROOT.parent.resolve())
    work.mkdir(parents=True, exist_ok=True)
    pointer = read(RELEASE / "PUBLIC_DOWNLOAD_POINTER.json")
    source = Path(pointer["root"]).resolve()
    target = work / "published"
    if source == target:
        raise RuntimeError("This amendment is already active; validate it rather than rebuilding the source snapshot")
    catalog = read(source / "catalog_public.json")
    assert catalog["availability"] == "published" and catalog["identified_kegg_content_excluded"]
    print("VERIFYING_ORIGINAL_PUBLIC_CATALOG", flush=True)
    for item in catalog["files"]:
        path = (source / item["path"]).resolve()
        assert path.is_relative_to(source) and info(path) == {key: item[key] for key in ("size", "sha256")}, item["path"]
    write(work / "source_catalog_verified.json", {"root": str(source), "catalog_sha256": sha(source / "catalog_public.json"), "artifacts": len(catalog["files"]), "all_hashes_match": True})

    # The new tree preserves the old data bytes and old publication metadata.
    for file in (source / "download_bundle").rglob("*"):
        if not file.is_file():
            continue
        destination = target / file.relative_to(source)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists():
            os.link(file, destination)
    bundle = target / "download_bundle"
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    governance = read(RELEASE / "PUBLIC_RELEASE_GOVERNANCE.json")
    core = ro(RELEASE / "reactenzdb_web.db")
    core_counts = {table: core.execute("SELECT count(*) FROM " + table).fetchone()[0]
                   for table in ("web_reactions", "web_enzymes", "web_reaction_enzymes", "web_kinetics")}
    assert core_counts == governance["local_core"]["counts"]
    assert sha(RELEASE / "reactenzdb_web.db") == governance["local_core"]["sha256"]
    amendment = {"revision": AMENDMENT, "amended_at_utc": now, "status": "local_verified_pending_deployment",
                 "data_snapshot_unchanged": True, "scientific_sqlite_bytes_changed": False}
    for name in ("PUBLIC_RELEASE_GOVERNANCE.json", "manifest.json", "CITATION.cff", "host_pathway_coverage_analysis.summary.json", "reaction_standardization.summary.json", "DATA_LAYER_REGISTRY.json"):
        backup(RELEASE / name, work)

    governance["public_snapshot"]["counts"] = core_counts
    governance["metadata_amendment"] = amendment
    write(RELEASE / "PUBLIC_RELEASE_GOVERNANCE.json", governance)
    snapshot = governance["snapshot_id"]
    released_date = governance["public_snapshot"]["frozen_at_utc"][:10]
    amend_citation(RELEASE / "CITATION.cff", snapshot, released_date)
    amend_citation(bundle / "CITATION.cff", snapshot, released_date)

    runtime = {}
    for name in ("reactenzdb_web.db", "model_ready_dataset.sqlite", "reaction_standardization.sqlite", "candidate_diversity_analysis.sqlite", "enzyme_sequence_clusters.sqlite", "host_pathway_coverage_analysis.sqlite"):
        conn = ro(RELEASE / name)
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
        assert integrity == "ok", name
        runtime[name] = {**info(RELEASE / name), "tables": counts(conn), "integrity": integrity}
        conn.close()

    # Reconstruct the host summary from the actual analysis, including its
    # ORIGINAL recorded input hashes, rather than replacing them by current hashes.
    host = ro(RELEASE / "host_pathway_coverage_analysis.sqlite")
    host_meta = dict(host.execute("SELECT key,value FROM metadata"))
    previous_host = read(RELEASE / "host_pathway_coverage_analysis.summary.json")
    host_rows = rows(host, "SELECT * FROM host_coverage_summary ORDER BY exact_native_reaction_count DESC,host_id")
    host_count = len(host_rows)
    reaction_count = host.execute("SELECT count(*) FROM reaction_host_requirement_summary").fetchone()[0]
    assert reaction_count == core_counts["web_reactions"]
    host_summary = {**host_meta, "analysis_database": "host_pathway_coverage_analysis.sqlite",
        "analysis_database_sha256": runtime["host_pathway_coverage_analysis.sqlite"]["sha256"],
        "counts": {"hosts": host_count, "analysis_ready_hosts": sum(row["mapping_readiness"] == "available" for row in host_rows),
            "limited_mapping_hosts": sum(row["mapping_readiness"] == "limited_identifier_coverage" for row in host_rows),
            "unavailable_mapping_hosts": sum(row["mapping_readiness"] == "unavailable_no_reaction_mapping" for row in host_rows),
            "reactenz_reactions": reaction_count,
            "exact_mapped_reaction_universe": host.execute("SELECT count(*) FROM reaction_host_requirement_summary WHERE exact_native_host_count>0").fetchone()[0],
            "pathway_membership_sets": host.execute("SELECT count(*) FROM (SELECT DISTINCT source_db,pathway_id FROM pathway_host_coverage)").fetchone()[0],
            "reaction_pathway_memberships": runtime["host_pathway_coverage_analysis.sqlite"]["tables"]["pathway_step_host_status"] // host_count},
        "host_coverage": host_rows,
        "reaction_implementation_classes": dict(host.execute("SELECT implementation_class,count(*) FROM reaction_host_requirement_summary GROUP BY implementation_class")),
        "qa": rows(host, "SELECT * FROM qa_results ORDER BY check_name"),
        "metadata_amendment": amendment, "public_scope_revision": governance["public_scope"]["revision"],
        "historical_summary_generated_at_utc": previous_host["generated_at_utc"],
        "table_counts": runtime["host_pathway_coverage_analysis.sqlite"]["tables"],
        "exports": {}, "export_boundary": "Legacy web_release/downloads host exports are historical. Public downloads use the separately projected, catalogued download tree."}
    assert not any(not row["passed"] for row in host_summary["qa"])
    write(RELEASE / "host_pathway_coverage_analysis.summary.json", host_summary)
    host.close()

    standard = read(RELEASE / "reaction_standardization.summary.json")
    conn = ro(RELEASE / "reaction_standardization.sqlite")
    standard.update(standardization_sha256=runtime["reaction_standardization.sqlite"]["sha256"],
        checks={"integrity": "ok"}, tables=runtime["reaction_standardization.sqlite"]["tables"],
        quality_gates={"balanced_exact_rhea_atom_mapping_no_conflict": conn.execute(GATE_SQL).fetchone()[0]},
        recorded_build_metadata=dict(conn.execute("SELECT key,value FROM release_metadata")), metadata_amendment=amendment)
    conn.close()
    write(RELEASE / "reaction_standardization.summary.json", standard)

    # Runtime schema is distinct from the physically redacted download schema.
    runtime_schema = []
    for row in core.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'web_%' AND name NOT LIKE 'web_retrosynthesis_%' AND name NOT LIKE '%_fts' AND name NOT LIKE '%_fts_%' ORDER BY name"):
        table = row[0]
        for column in core.execute('PRAGMA table_info("' + table + '")'):
            runtime_schema.append({"table": table, "column": column["name"], "type": column["type"], "not_null": column["notnull"], "primary_key_order": column["pk"]})
    write(RELEASE / "runtime_schema.json", runtime_schema)
    core.close()

    spec = importlib.util.spec_from_file_location("fair_metadata", ROOT / "scripts/prepare_fair_release_assets.py")
    fair = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fair)
    conn = ro(RELEASE / "reactenzdb_web.db")
    qa = fair.build_qa_summary(conn, now)
    qa["known_limitations"] = [text for text in qa["known_limitations"] if "846 Rhea-linked" not in text]
    qa.update(snapshot_id=snapshot, metadata_amendment=amendment)
    qa["manual_review"] = {"status": "pending_human_review", "statement": "No independent blinded manual audit result, adjudicated error rate or reviewer agreement statistic is established for this snapshot by these technical checks. No new manual-review sample was prepared by this metadata amendment."}
    qa["manual_review"]["historical_materials_boundary"] = "Old audit worksheets are retained in the historical downloads folder; they are not a completed review of this current snapshot."
    assert all(item["status"] == "pass" for item in qa["automated_integrity_checks"])
    write(RELEASE / "runtime_qa_summary.json", qa)
    conn.close()

    manifest = read(bundle / "manifest.json")
    amended_revision = catalog["source_snapshot"] + "-metadata-20261101"
    manifest.update(revision=amended_revision, data_snapshot=catalog["source_snapshot"], metadata_amendment=amendment, core_counts=core_counts)
    # Regenerate every schema field from the ACTUAL downloadable SQLite files.
    schema_lines = ["file\ttable\tfield\ttype\tnot_null\tprimary_key_order"]
    published = {}
    for item in manifest["sqlite_files"]:
        database = bundle / item["file"]
        assert info(database) == {key: item[key] for key in ("size", "sha256")}, item["file"]
        conn = ro(database)
        published[database.name] = {**info(database), "tables": counts(conn)}
        for table in conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
            for column in conn.execute('PRAGMA table_info("' + table[0].replace('"', '""') + '")'):
                schema_lines.append("\t".join(str(value) for value in (database.name, table[0], column["name"], column["type"], column["notnull"], column["pk"])))
        conn.close()
    write_text(bundle / "sqlite_fields.tsv", "\n".join(schema_lines) + "\n")
    field_lines = ["file\tfield\tfield_position"]
    for table in manifest["tabular_files"]:
        field_lines.extend(f'{table["file"]}\t{field}\t{index}' for index, field in enumerate(table["columns"], 1))
    write_text(bundle / "table_fields.tsv", "\n".join(field_lines) + "\n")
    manifest["schema"] = {"sqlite_fields": len(schema_lines) - 1, "table_fields": len(field_lines) - 1,
                          "sqlite_tables": sum(len(item["tables"]) for item in published.values())}
    write(bundle / "manifest.json", manifest)
    text = (bundle / "README.txt").read_text(encoding="utf-8")
    text += f"\nMetadata amendment {AMENDMENT}: citation snapshot and field dictionaries reconciled against these exact data files. Scientific SQLite and table bytes are unchanged. Metadata changes await separate server deployment.\n"
    write_text(bundle / "README.txt", text)

    print("BUILDING_AMENDED_DOWNLOAD_ARCHIVE", flush=True)
    archive_item = next(item for item in catalog["files"] if item["group"] == "bundle")
    archive = target / archive_item["path"]
    archive.parent.mkdir(parents=True, exist_ok=True)
    incoming = archive.with_name(archive.name + ".metadata-incoming")
    with zipfile.ZipFile(incoming, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=1, allowZip64=True) as output:
        for file in sorted(bundle.rglob("*")):
            if file.is_file():
                output.write(file, file.relative_to(bundle).as_posix())
    os.replace(incoming, archive)
    with zipfile.ZipFile(archive) as output:
        assert output.testzip() is None
    for item in catalog["files"]:
        item.update(info(target / item["path"]))
    catalog.update(revision=amended_revision, metadata_amendment=amendment)
    write(target / "catalog_public.json", catalog)

    # Keep the declared runtime catalog in sync without rewriting recorded inputs.
    registry = read(RELEASE / "DATA_LAYER_REGISTRY.json")
    for layer in registry["layers"]:
        name = layer.get("database", {}).get("file")
        if name in runtime:
            layer["database"].update({key: runtime[name][key] for key in ("size", "sha256")})
            layer["summary_counts"] = runtime[name]["tables"]
            if name == "reactenzdb_web.db":
                layer["table_counts"]["public_core_tables"] = len({row["table"] for row in runtime_schema})
    registry["metadata_amendment"] = amendment
    write(RELEASE / "DATA_LAYER_REGISTRY.json", registry)
    base = read(RELEASE / "manifest.json")
    base.update(metadata_amendment=amendment)
    for name in ("release_files_manifest.json", "csv_exports_manifest.json"):
        legacy_path = RELEASE / "downloads" / name
        backup(legacy_path, work)
        legacy = read(legacy_path)
        legacy.update(manifest_status="superseded_metadata_not_an_active_snapshot",
            current_catalog_pointer="PUBLIC_DOWNLOAD_POINTER.json",
            scope_note="Preserved legacy metadata. Its counts and hashes do not describe the current public download tree; resolve the active reviewed catalog through PUBLIC_DOWNLOAD_POINTER.json.")
        write(legacy_path, legacy)
        if "downloads/" + name in base["artifacts"]:
            base["artifacts"]["downloads/" + name] = info(legacy_path)
    base.update(active_download_catalog_pointer="PUBLIC_DOWNLOAD_POINTER.json",
        runtime_schema_file="runtime_schema.json", runtime_qa_file="runtime_qa_summary.json")
    if "current_public_snapshot" in base:
        base["current_public_snapshot"]["counts"] = core_counts
    for name in ("PUBLIC_RELEASE_GOVERNANCE.json", "CITATION.cff", "host_pathway_coverage_analysis.summary.json", "reaction_standardization.summary.json", "DATA_LAYER_REGISTRY.json", "runtime_schema.json", "runtime_qa_summary.json"):
        base["artifacts"][name] = info(RELEASE / name)
    write(RELEASE / "manifest.json", base)
    report = {"metadata_amendment": amendment, "snapshot_id": snapshot, "core_counts": core_counts,
        "runtime": runtime, "published": published, "published_root": str(target),
        "source_download_root": str(source), "catalog": info(target / "catalog_public.json"),
        "runtime_schema": {"file": "runtime_schema.json", "tables": len({row["table"] for row in runtime_schema}), "fields": len(runtime_schema), **info(RELEASE / "runtime_schema.json")},
        "runtime_qa": {"file": "runtime_qa_summary.json", **info(RELEASE / "runtime_qa_summary.json")},
        "original_data_files_unchanged": True, "online_deployed": False}
    write(RELEASE / "release_integrity.summary.json", report)
    backup(RELEASE / "PUBLIC_DOWNLOAD_POINTER.json", work)
    write(RELEASE / "PUBLIC_DOWNLOAD_POINTER.json", {"root": target.as_posix(), "revision": amended_revision,
        "data_snapshot": catalog["source_snapshot"], "metadata_amendment": amendment})
    write(work / "reconciliation.json", report)
    print("METADATA_RECONCILED", json.dumps({"core_counts": core_counts, "artifacts": len(catalog["files"]), "runtime_schema_tables": report["runtime_schema"]["tables"]}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work", type=Path, default=DEFAULT_WORK)
    args = parser.parse_args()
    main(args.work)
