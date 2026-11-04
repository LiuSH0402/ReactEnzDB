from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "web_release" / "reactenzdb_web.db"
DEFAULT_OUTPUT = ROOT / "web_release" / "downloads"

EXPORT_TABLES = [
    "web_reactions",
    "web_reaction_compounds",
    "web_reaction_enzymes",
    "web_enzymes",
    "web_kinetics",
    "web_kinetics_source_provenance",
    "web_kinetics_reference_repairs",
    "web_xrefs",
    "web_pdb_mappings",
    "web_chassis_labels",
    "web_pathways",
    "web_reaction_pathways",
    "web_stats",
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def export_table(conn: sqlite3.Connection, table: str, output_dir: Path, chunksize: int) -> dict[str, object]:
    output_path = output_dir / f"{table}.csv.gz"
    if output_path.exists():
        output_path.unlink()

    row_count = int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
    first_chunk = True
    with gzip.open(output_path, "wt", encoding="utf-8", newline="") as handle:
        for chunk in pd.read_sql_query(f"SELECT * FROM {table}", conn, chunksize=chunksize):
            chunk.to_csv(handle, index=False, header=first_chunk)
            first_chunk = False

    return {
        "table": table,
        "file": output_path.name,
        "rows": row_count,
        "size": output_path.stat().st_size,
        "sha256": sha256(output_path),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Export ReactEnzDB web release tables as CSV.GZ files.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--chunksize", type=int, default=25000)
    args = parser.parse_args()

    if not args.db.exists():
        raise FileNotFoundError(args.db)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(f"file:{args.db.as_posix()}?mode=ro", uri=True)
    manifest = {
        "release": "ReactEnzDB web release 2026-08.1",
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "source_db": args.db.name,
        "exports": [],
    }
    for table in EXPORT_TABLES:
        print(f"[export] {table}", flush=True)
        manifest["exports"].append(export_table(conn, table, args.output_dir, args.chunksize))

    manifest_path = args.output_dir / "csv_exports_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"manifest": str(manifest_path), "exports": len(manifest["exports"])}, indent=2))


if __name__ == "__main__":
    main()
