"""Build separate data-facing CSV/TSV copies; never modify scientific inputs.

Database identifiers and links are retained. Collection-source descriptions are
omitted, including explicit provenance keys nested in JSON. This is a presentation
projection, not source exclusion, licence clearance, or a release authorisation.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OMIT = {
    "source_db", "source_db_raw", "source_db_normalized", "source_label",
    "source_labels", "source_name", "source_description", "source_note",
    "source_release", "source_manifest_json", "source_manifest", "included_sources",
    "evidence_source", "model_source", "fulltext_source_channel", "structure_source",
    "imported_at_utc", "provenance", "source_database", "database_source",
}
# These tables contain only collection history, rather than biological observations.
OMIT_TABLES = {"web_source_imports", "web_kinetics_source_provenance",
               "reactenzdb_schema", "reactenzdb_field_dictionary"}
RENAME = {"source_url": "record_url", "source_entry_id": "external_record_id"}


def digest(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def project_json(value):
    if isinstance(value, dict):
        result = {}
        for k, v in value.items():
            # source_name can denote a compound in nested participant records.
            if k == "source_name" and any(x in value for x in ("source_compound_id", "smiles", "compound_id")):
                result["compound_name"] = project_json(v)
            elif k.lower() in OMIT:
                continue
            elif k == "source" and isinstance(v, str):
                if value.get("id"):
                    result["identifier_namespace"] = v
                elif any(db in v.lower() for db in ("kegg", "rdbsb", "brenda", "uniprot", "alphafold", "sabi", "pubchem", "m-csa", "rhea", "metacyc", "chebi", "interpro", "bigg")):
                    continue
                else:
                    result[k] = v
            else:
                result[RENAME.get(k, k)] = project_json(v)
        return result
    if isinstance(value, list):
        return [project_json(v) for v in value]
    return value


def project_cell(key, value):
    if value and (key.endswith("_json") or value.lstrip().startswith(("{", "["))):
        try:
            original = json.loads(value)
        except (ValueError, TypeError):
            return value
        projected = project_json(original)
        if original != projected:
            return json.dumps(projected, ensure_ascii=False, separators=(",", ":"))
    return value


def project_file(input_path, output_path):
    delimiter = "\t" if ".tsv" in input_path.name else ","
    opener = gzip.open if input_path.suffix == ".gz" else open
    options = {"compresslevel": 6} if input_path.suffix == ".gz" else {}
    before = digest(input_path)
    # xref_db is the actual external-ID namespace. source_db is the collection
    # origin even in web_xrefs; retaining it would leak (and mislabel) provenance.
    with opener(input_path, "rt", encoding="utf-8-sig", newline="") as src:
        reader = csv.DictReader(src, delimiter=delimiter)
        header = reader.fieldnames or []
        kept = [k for k in header if k.lower() not in OMIT and not (k == "source" and input_path.name.startswith("web_alphafold_mappings."))]
        renames = {k: RENAME.get(k, k) for k in kept}
        assert len(set(renames.values())) == len(kept), input_path.name
        rows = changed_cells = 0
        content = hashlib.sha256()
        with opener(output_path, "wt", encoding="utf-8", newline="", **options) as dst:
            writer = csv.DictWriter(dst, fieldnames=list(renames.values()), delimiter=delimiter)
            writer.writeheader()
            for row in reader:
                assert None not in row, (input_path.name, rows, "malformed row")
                projected = {renames[k]: project_cell(k, row[k]) for k in kept}
                changed_cells += sum(projected[renames[k]] != row[k] for k in kept)
                content.update(json.dumps(projected, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
                content.update(b"\n")
                writer.writerow(projected)
                rows += 1
    # Read back the actual compressed output and verify every projected cell.
    observed = hashlib.sha256()
    with opener(output_path, "rt", encoding="utf-8", newline="") as handle:
        reread = csv.DictReader(handle, delimiter=delimiter)
        assert reread.fieldnames == list(renames.values())
        actual_rows = 0
        for row in reread:
            observed.update(json.dumps(row, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
            observed.update(b"\n")
            actual_rows += 1
    assert actual_rows == rows and observed.digest() == content.digest(), input_path.name
    assert digest(input_path) == before, "Input changed during export"
    return {"file": output_path.name, "rows": rows, "columns": list(renames.values()),
            "sha256": digest(output_path), "size": output_path.stat().st_size,
            "input_sha256": before, "omitted_columns": [k for k in header if k not in kept],
            "renamed_columns": {k: v for k, v in renames.items() if k != v},
            "json_cells_projected": changed_cells, "roundtrip_verified": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-dir", type=Path, default=ROOT / "web_release")
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    csv.field_size_limit(100_000_000)
    source = args.release_dir.resolve()
    out = args.output_dir.resolve()
    assert out != source and not out.is_relative_to(source), "Use an independent output directory"
    out.mkdir(parents=True, exist_ok=True)
    assert not (out / "manifest.json").exists(), "Use a fresh output directory"
    manifest = json.loads((source / "downloads/release_files_manifest.json").read_text(encoding="utf-8"))
    audit = {"kind": "presentation_projection", "public_download_enabled": False,
             "source_content_exclusion": False, "licence_clearance": False,
             "files": [], "omitted_collection_history": []}
    for item in manifest["artifacts"]:
        name = item["file"]
        if not name.endswith((".csv", ".tsv", ".csv.gz", ".tsv.gz")):
            continue
        input_path = (source / name).resolve()
        assert input_path.is_relative_to(source) and input_path.is_file()
        table = input_path.name.split(".")[0]
        if table in OMIT_TABLES:
            audit["omitted_collection_history"].append(name)
            continue
        result = project_file(input_path, out / input_path.name)
        audit["files"].append(result)
        print("VERIFIED", result["file"], result["rows"], flush=True)
    dictionary = out / "data_dictionary.tsv"
    with dictionary.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t")
        writer.writerow(["file", "field", "field_position"])
        for result in audit["files"]:
            for index, column in enumerate(result["columns"], 1):
                writer.writerow([result["file"], column, index])
    public_manifest = {"format": "data-and-literature-view-v1", "status": "local_candidate",
                       "files": [{k: r[k] for k in ("file", "rows", "columns", "sha256", "size")}
                                 for r in audit["files"]]}
    (out / "manifest.json").write_text(json.dumps(public_manifest, indent=2), encoding="utf-8")
    (out / "README.txt").write_text(
        "Local candidate data view. External identifiers, links, literature, organism, "
        "sequences, structures, experimental values and conditions are retained. "
        "Collection-source descriptions are omitted. This transformation does not remove "
        "third-party-derived content or grant redistribution rights. Original release "
        "licence and citation requirements remain applicable. Native SQLite databases "
        "and original release packages are unchanged.\n", encoding="utf-8")
    # Keep required release notices separate from the data rows.
    for name in ("LICENSE_DATA.txt", "CITATION.cff"):
        if (source / name).exists():
            (out / name).write_bytes((source / name).read_bytes())
    zip_path = out.parent / (out.name + ".zip")
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
        for file in sorted(out.iterdir()):
            archive.write(file, file.name)
    audit["archive"] = {"file": str(zip_path), "size": zip_path.stat().st_size,
                        "sha256": digest(zip_path)}
    (out.parent / (out.name + ".audit.json")).write_text(json.dumps(audit, indent=2), encoding="utf-8")
    print("COMPLETE", len(audit["files"]), "files", flush=True)


if __name__ == "__main__":
    main()
