"""Create local data views and physical, lossless source-label partitions.

Source labels identify collection records, not necessarily the original upstream
rights holder. Unlabelled/derived rows stay unresolved. No public release is made.
"""
from __future__ import annotations

import argparse
import collections
import concurrent.futures
import functools
import hashlib
import heapq
import json
import pickle
import re
import sqlite3
from pathlib import Path
from urllib.parse import urlparse

from prepare_data_display_exports import OMIT, RENAME, project_cell

ROOT = Path(__file__).resolve().parents[1]
ORIGIN_FIELDS = {"source_db", "source_db_raw", "source_db_normalized", "source_name",
                 "model_source", "structure_source", "mapping_source", "source"}
ALIASES = {
    "kegg": r"\bkegg\b", "rdbsb": r"\brdbsb\b", "uniprot": r"\buniprot(?:kb)?\b",
    "brenda": r"\bbrenda\b", "rhea": r"\brhea(?:\d+)?\b", "sabio": r"\bsabio(?:-rk)?\b",
    "pubchem": r"\bpubchem\b", "metanetx": r"\b(?:metanetx|mnxref)\b",
    "metacyc": r"\bmetacyc\b", "interpro": r"\binterpro\b", "pdb": r"\b(?:pdb|pdbe)\b",
    "alphafold": r"\balphafold\b", "chebi": r"\bchebi\b", "bigg": r"\bbigg\b",
    "retrobiocat": r"\bretrobiocat\b", "bionavi": r"\bbionavi(?:-np)?\b",
    "readretro": r"\breadretro\b", "subnetx": r"\bsubnetx\b",
    "mcsa": r"\bm-csa\b",
    "reactenzdb_derived": r"\breactenzdb\b",
}
GENERIC = {"", "unknown", "evidence", "annotation", "not reported", "none", "null"}
PRIVATE = {"web_source_imports", "web_source_records", "web_kinetics_source_provenance",
           "web_qc_metadata", "web_data_repair_metadata", "web_kinetic_external_source_status",
           "web_protein_reference_inheritance", "web_uniprot_alias_inheritance"}
VIEW_OMIT = OMIT | {"mapping_source", "local_path", "license_note"}
MODULUS = 1 << 256


def q(name):
    return '"' + name.replace('"', '""') + '"'


def file_hash(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def encoded(row):
    return pickle.dumps(tuple(row), protocol=4)


class Fingerprint:
    def __init__(self):
        self.count = self.total = self.xor = 0

    def add(self, row):
        n = int.from_bytes(hashlib.sha256(encoded(row)).digest(), "big")
        self.count += 1
        self.total = (self.total + n) % MODULUS
        self.xor ^= n

    def result(self):
        return {"rows": self.count, "sum_sha256": f"{self.total:064x}", "xor_sha256": f"{self.xor:064x}"}


def ordinary_tables(db):
    virtuals = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND upper(coalesce(sql,'')) LIKE 'CREATE VIRTUAL TABLE%'")]
    rows = db.execute("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()
    return [(name, sql) for name, sql in rows if name not in virtuals and not any(name.startswith(v + '_') for v in virtuals)]


def view_skip(table):
    return table in PRIVATE or table.startswith("qc_web_") or table.startswith("web_retrosynthesis_")


def projection(table, info):
    kept, names = [], []
    for i, col in enumerate(info):
        name = col[1]
        if name == "source_name" and table == "normalized_participants":
            alias = "compound_name"
        elif name in VIEW_OMIT or (name == "source" and table == "web_alphafold_mappings"):
            continue
        else:
            alias = RENAME.get(name, name)
        kept.append(i)
        names.append(alias)
    assert len(set(names)) == len(names), table
    return kept, names


def create_table(db, table, info, kept, names, *, partition=False, foreign_keys=()):
    definitions = []
    for i, alias in zip(kept, names):
        col = info[i]
        datatype = col[2] or "BLOB"
        assert re.fullmatch(r"[A-Za-z0-9_ (),]+", datatype), datatype
        definitions.append(f"{q(alias)} {datatype}" + (" NOT NULL" if col[3] else ""))
    if partition:
        assert "_separation_order" not in names
        definitions.append('"_separation_order" INTEGER NOT NULL UNIQUE')
    pks = sorted(((info[i][5], alias) for i, alias in zip(kept, names) if info[i][5]))
    # Removing an origin column must not tighten a composite key and collapse
    # two otherwise identical observations collected from different sources.
    if pks and len(pks) == sum(bool(c[5]) for c in info):
        definitions.append("PRIMARY KEY (" + ",".join(q(alias) for _, alias in pks) + ")")
    definitions.extend(foreign_keys)
    db.execute(f"CREATE TABLE {q(table)} ({','.join(definitions)})")


def connect_output(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    assert not path.exists(), path
    db = sqlite3.connect(path)
    db.execute("PRAGMA journal_mode=DELETE")
    db.execute("PRAGMA synchronous=NORMAL")
    db.execute("PRAGMA cache_size=-32000")
    return db


@functools.lru_cache(maxsize=10000)
def label_names(value):
    if not isinstance(value, str) or value.strip().lower() in GENERIC:
        return set()
    return {name for name, pattern in ALIASES.items() if re.search(pattern, value, re.I)}


def endpoint_names(value):
    if not isinstance(value, str):
        return set()
    parsed = urlparse(value)
    host = (parsed.hostname or "").lower()
    for domain, name in (("uniprot.org", "uniprot"), ("rhea-db.org", "rhea"), ("kegg.jp", "kegg"),
                         ("brenda-enzymes.org", "brenda"), ("sabiork.h-its.org", "sabio"),
                         ("pubchem.ncbi.nlm.nih.gov", "pubchem"), ("pdb.org", "pdb"),
                         ("alphafold.ebi.ac.uk", "alphafold")):
        if host == domain or host.endswith("." + domain):
            return {name}
    if host.endswith("ebi.ac.uk"):
        if "m-csa" in parsed.path:
            return {"mcsa"}
        if "pdbe" in parsed.path:
            return {"pdb"}
        if "chebi" in parsed.path:
            return {"chebi"}
    return set()


def bucket(names):
    if "kegg" in names:
        return "kegg_labelled"
    if len(names) > 1:
        return "mixed_labelled"
    return next(iter(names)) if names else "unresolved"


def policy_parent_maps(db, available):
    affected = {}
    for table, id_col in (("bionavi_reaction_rules", "rule_id"), ("rule_templates", "template_id")):
        if table in available:
            affected[id_col] = {r[0] for r in db.execute(f"SELECT {q(id_col)} FROM {q(table)} WHERE rule_source='enzymatic_metabolic'")}
    if "cross_database_mappings" in available:
        affected["mapping_id"] = {r[0] for r in db.execute("SELECT mapping_id FROM cross_database_mappings WHERE instr(lower(coalesce(target_db,'')),'kegg')>0")}
    return affected


def classifier(table, columns, parent_maps, resource_labels):
    positions = {name: i for i, name in enumerate(columns)}
    fields = [(name, i) for name, i in positions.items() if name in ORIGIN_FIELDS and not (table == "normalized_participants" and name == "source_name")]
    def classify(row):
        # These are known *mixed/dependent pools*, not a claim that every row is KEGG.
        if positions.get("rule_source") is not None and row[positions["rule_source"]] == "enzymatic_metabolic":
            return "kegg_related_or_mixed", "existing_policy_mixed_rule_pool"
        for key, ids in parent_maps.items():
            if key in positions and row[positions[key]] in ids and table not in {"rule_templates", "bionavi_reaction_rules"}:
                return "kegg_related_or_mixed", "explicit_parent_id_in_policy_withheld_pool"
        if table == "reaction_host_mapping" and "identity_basis" in positions and "kegg" in str(row[positions["identity_basis"]]).lower():
            return "kegg_related_or_mixed", "explicit_kegg_identity_basis"
        if table in {"cross_database_mappings", "rule_template_reaction_links", "bionavi_rule_references"}:
            for key in ("target_db", "external_db"):
                if key in positions and "kegg" in str(row[positions[key]]).lower():
                    return "kegg_related_or_mixed", "kegg_comparison_or_reference_content"
        names = set()
        for _, i in fields:
            names.update(label_names(row[i]))
        if names:
            return bucket(names), "explicit_collection_label"
        for key in ("source_resource_id", "source_id"):
            if key in positions and row[positions[key]] in resource_labels:
                return resource_labels[row[positions[key]]], "declared_source_resource_id"
        if "source_url" in positions:
            names = endpoint_names(row[positions["source_url"]])
            if names:
                return bucket(names), "explicit_record_endpoint_only"
        if any(isinstance(row[i], str) and row[i].strip().lower() not in GENERIC for _, i in fields):
            return "other_labelled", "uncontrolled_collection_label_needs_review"
        return "unresolved", "missing_or_generic_provenance_not_inferred_from_identifiers"
    return classify


def foreign_key_lineage(db, table_info, parent_maps, resource_labels):
    """Only declared FK edges supply collection lineage; IDs alone do not."""
    edges = {}
    targets = set()
    for table in table_info:
        groups = collections.defaultdict(list)
        for fk in db.execute(f"PRAGMA foreign_key_list({q(table)})"):
            groups[fk[0]].append(fk)
        edges[table] = []
        for group in groups.values():
            group.sort(key=lambda x: x[1]); parent = group[0][2]
            if parent not in table_info or any(r[4] is None for r in group):
                continue
            target = (parent, tuple(r[4] for r in group))
            targets.add(target)
            edges[table].append((tuple(r[3] for r in group), target))
    maps = {}
    def inherited(table, columns, row):
        positions = {name: i for i, name in enumerate(columns)}
        categories = set()
        for children, target in edges.get(table, []):
            key = tuple(row[positions[c]] for c in children)
            if any(v is None for v in key):
                continue
            category = maps.get(target, {}).get(key, "unresolved")
            if category != "unresolved":
                categories.add(category)
        if categories & {"kegg_labelled", "kegg_related_or_mixed"}:
            return "kegg_related_or_mixed"
        return next(iter(categories)) if len(categories) == 1 else "mixed_labelled" if categories else "unresolved"
    for _ in range(len(table_info)):
        changed = False
        for parent, keys in sorted(targets):
            columns = [r[1] for r in table_info[parent]]
            classify = classifier(parent, columns, parent_maps, resource_labels)
            positions = [columns.index(k) for k in keys]
            values = {}
            for row in db.execute(f"SELECT * FROM {q(parent)}"):
                category, _ = classify(row)
                if category == "unresolved":
                    category = inherited(parent, columns, row)
                values[tuple(row[i] for i in positions)] = category
            if maps.get((parent, keys)) != values:
                maps[parent, keys] = values; changed = True
        if not changed:
            break
    return inherited


def indexes(db, original, table, names, aliases):
    kept = set(aliases)
    for item in original.execute(f"PRAGMA index_list({q(table)})").fetchall():
        index_name, unique, origin, partial = item[1:5]
        if origin == "pk" or partial:
            continue
        info = original.execute(f"PRAGMA index_info({q(index_name)})").fetchall()
        cols = [r[2] for r in info]
        if not cols or any(c is None or c not in kept for c in cols):
            continue
        target = "idx_view_" + hashlib.sha256((table + index_name).encode()).hexdigest()[:20]
        db.execute(f"CREATE {'UNIQUE ' if unique else ''}INDEX {q(target)} ON {q(table)} ({','.join(q(aliases[c]) for c in cols)})")


def run_database(input_path, output_root):
    before = file_hash(input_path)
    src = sqlite3.connect('file:' + input_path.resolve().as_posix() + '?mode=ro', uri=True)
    src.execute("BEGIN")
    tables = ordinary_tables(src)
    table_info = {t: src.execute(f"PRAGMA table_info({q(t)})").fetchall() for t, _ in tables}
    selected = {t: projection(t, table_info[t]) for t, _ in tables if not view_skip(t)}
    view_path = output_root / "data_view" / input_path.name
    view = connect_output(view_path)
    parts = {}
    report = {"input": input_path.name, "input_sha256": before, "status": "local_candidate",
              "public_release_authorised": False, "source_groups_are_collection_labels": True,
              "tables": [], "view_omitted_tables": [t for t, _ in tables if t not in selected]}
    parent_maps = policy_parent_maps(src, table_info)
    resource_labels = {}
    for parent, key in (("resource_files", "resource_id"), ("web_retrosynthesis_sources", "source_id")):
        if parent in table_info:
            for identifier, label in src.execute(f"SELECT {q(key)},source_name FROM {q(parent)}"):
                resource_labels[identifier] = bucket(label_names(label))
    inherited = foreign_key_lineage(src, table_info, parent_maps, resource_labels)
    # Create all view tables first, preserving foreign keys whose endpoints survive.
    for table, (kept, names) in selected.items():
        aliases = dict(zip((table_info[table][i][1] for i in kept), names))
        fks = collections.defaultdict(list)
        for fk in src.execute(f"PRAGMA foreign_key_list({q(table)})"):
            fks[fk[0]].append(fk)
        clauses = []
        for group in fks.values():
            group.sort(key=lambda r: r[1]); parent = group[0][2]
            if parent not in selected or any(r[3] not in aliases for r in group):
                continue
            pk, pn = selected[parent]
            parent_aliases = dict(zip((table_info[parent][i][1] for i in pk), pn))
            if any(r[4] not in parent_aliases for r in group):
                continue
            clauses.append(f"FOREIGN KEY ({','.join(q(aliases[r[3]]) for r in group)}) REFERENCES {q(parent)} ({','.join(q(parent_aliases[r[4]]) for r in group)})")
        create_table(view, table, table_info[table], kept, names, foreign_keys=clauses)
    view.commit()
    for table, _ in tables:
        info = table_info[table]; columns = [c[1] for c in info]
        classify = classifier(table, columns, parent_maps, resource_labels)
        expected_chain = hashlib.sha256(); counts = collections.Counter(); reasons = collections.Counter()
        projected_expected = Fingerprint(); omitted_metadata = 0; n = 0
        view_batch = []; part_batches = collections.defaultdict(list)
        kept, names = selected.get(table, ([], []))
        view_insert = f"INSERT INTO {q(table)} VALUES ({','.join('?' for _ in names)})" if names else None
        raw_insert = f"INSERT INTO {q(table)} VALUES ({','.join('?' for _ in range(len(columns)+1))})"
        made_tables = set()
        for row in src.execute(f"SELECT * FROM {q(table)}"):
            n += 1; expected_chain.update(encoded(row)); category, reason = classify(row)
            if category == "unresolved":
                traced = inherited(table, columns, row)
                if traced != "unresolved":
                    category, reason = traced, "declared_foreign_key_collection_lineage"
            counts[category] += 1; reasons[reason] += 1
            if category not in parts:
                parts[category] = connect_output(output_root / "source_parts" / category / input_path.name)
            if category not in made_tables:
                create_table(parts[category], table, info, list(range(len(info))), columns, partition=True)
                made_tables.add(category)
            part_batches[category].append(tuple(row) + (n,))
            if names:
                # Operational key/value provenance is outside the business data view.
                if columns == ["key", "value"] and ("source" in str(row[0]).lower() or str(row[0]).endswith(("_database", "_database_sha256")) or row[0] == "core_database"):
                    omitted_metadata += 1
                else:
                    values = tuple(project_cell(info[i][1], row[i]) if isinstance(row[i], str) else row[i] for i in kept)
                    projected_expected.add(values); view_batch.append(values)
            if n % 2500 == 0:
                if view_batch:
                    view.executemany(view_insert, view_batch); view_batch.clear()
                for cat, batch in part_batches.items():
                    if batch:
                        parts[cat].executemany(raw_insert, batch); batch.clear()
        if view_batch:
            view.executemany(view_insert, view_batch)
        for cat, batch in part_batches.items():
            if batch:
                parts[cat].executemany(raw_insert, batch)
        view.commit()
        for cat in made_tables:
            parts[cat].commit()
        # Reconstruct original iteration order from the physical shards; byte-for-
        # byte typed row equality is verified, including BLOB/null/float values.
        streams = (parts[cat].execute(f"SELECT * FROM {q(table)} ORDER BY _separation_order") for cat in sorted(made_tables))
        actual_chain = hashlib.sha256(); count = 0
        for row in heapq.merge(*streams, key=lambda r: r[-1]):
            count += 1; assert row[-1] == count, (table, "duplicate or missing partition row")
            actual_chain.update(encoded(row[:-1]))
        assert count == n and actual_chain.digest() == expected_chain.digest(), (input_path.name, table)
        if names:
            observed = Fingerprint()
            for row in view.execute(f"SELECT * FROM {q(table)}"):
                observed.add(row)
            assert observed.result() == projected_expected.result(), (table, "view value/type mismatch")
            aliases = dict(zip((info[i][1] for i in kept), names))
            indexes(view, src, table, names, aliases); view.commit()
        report["tables"].append({"table": table, "input_rows": n, "source_parts": dict(counts),
            "assignment_reasons": dict(reasons), "partition_reassembly_sha256": expected_chain.hexdigest(),
            "partition_lossless_verified": True, "original_columns": columns,
            "view_columns": names, "view_fingerprint": projected_expected.result() if names else None,
            "view_omitted_metadata_rows": omitted_metadata})
        print('TABLE_VERIFIED', input_path.name, table, n, flush=True)
    view.commit()
    # A data-view FK error must not be hidden by dropping the relationship.
    violations = view.execute("PRAGMA foreign_key_check").fetchall()
    assert not violations, (input_path.name, "view foreign key errors", violations[:5])
    assert view.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    report["data_view"] = {"file": str(view_path), "foreign_key_check": "passed", "integrity_check": "ok"}
    view.close()
    report["data_view"]["sha256"] = file_hash(view_path)
    report["part_files"] = []
    for cat, db in parts.items():
        assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok", (cat, input_path.name)
        db.close(); path = output_root / "source_parts" / cat / input_path.name
        report["part_files"].append({"category": cat, "file": str(path), "size": path.stat().st_size,
                                     "sha256": file_hash(path), "foreign_keys": "cross-shard references retained as columns; reassemble/join before use"})
    src.close()
    assert file_hash(input_path) == before, "Original database bytes changed"
    report["input_bytes_unchanged"] = True
    out = output_root / "audit" / (input_path.name + ".json")
    out.parent.mkdir(exist_ok=True);out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print('DATABASE_COMPLETE', input_path.name, len(report["tables"]), flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-dir", type=Path, default=ROOT / "web_release")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--file", action="append")
    parser.add_argument("--workers", type=int, default=2)
    args = parser.parse_args()
    root = args.release_dir.resolve(); out = args.output_dir.resolve()
    assert not out.is_relative_to(root) and not (out / "manifest.json").exists()
    out.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((root / "downloads/release_files_manifest.json").read_text(encoding="utf-8"))
    files = [root / r["file"] for r in manifest["artifacts"] if r["file"].endswith((".db", ".sqlite"))]
    if args.file:
        files = [f for f in files if f.name in args.file]
        assert len(files) == len(set(args.file))
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        reports = list(pool.map(lambda p: run_database(p, out), files))
    result = {"kind": "physical_collection_source_partitions_and_data_views", "status": "local_candidate",
        "public_download_enabled": False, "licence_clearance": False,
        "upstream_field_provenance_complete": False, "input_databases": len(reports),
        "tables": sum(len(r["tables"]) for r in reports), "source_categories": {},
        "data_views": [r["data_view"] for r in reports]}
    for r in reports:
        for t in r["tables"]:
            for cat, n in t["source_parts"].items():
                result["source_categories"][cat] = result["source_categories"].get(cat, 0) + n
    (out / "manifest.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    (out / "README.txt").write_text(
        "LOCAL CANDIDATE. data_view contains typed SQLite presentation copies; source_parts "
        "contains physical collection-label shards, keeping original values and provenance. "
        "_separation_order allows lossless reassembly in input row order. Do not treat shards "
        "as standalone relational databases: referenced records may be in other shards. "
        "kegg_related_or_mixed means a known mixed/dependent pool, not proven KEGG origin "
        "for each row. unresolved includes unlabelled and derived records. RDBSB is a "
        "collection label with incomplete field-level upstream lineage. Source names, "
        "identifiers, papers and apparent non-KEGG labels do not establish redistribution "
        "clearance. Original inputs remain unchanged. Public downloads remain closed.\n", encoding="utf-8")
    print('COMPLETE', len(reports), result["tables"], flush=True)


if __name__ == "__main__":
    main()
