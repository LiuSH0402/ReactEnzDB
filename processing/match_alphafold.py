"""Offline extraction from ReactEnzDB/scripts/match_alphafold.py.
Acquisition functions and the original acquisition CLI are omitted.
Local processing rules are retained; see docs/PROCESSING.md.
"""
from __future__ import annotations

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import argparse

import json

import sqlite3

import time

from pathlib import Path

from typing import Any

ROOT = Path(__file__).resolve().parents[1]

DEFAULT_WEB_DB = ROOT / "web_release" / "reactenzdb_web.db"

DEFAULT_REPORT = ROOT / "web_release" / "alphafold_match_report.json"

DEFAULT_SRC_DB = ROOT.parent / "rdbsb_v2" / "rdbsb_biosyn_v2.db"

API = "https://alphafold.ebi.ac.uk/api/prediction"

def connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn

def ensure_schema(conn: sqlite3.Connection, *, prefix: str = "web") -> None:
    accession_table = f"{prefix}_alphafold_accessions" if prefix == "web" else "external_alphafold_accessions"
    mapping_table = f"{prefix}_alphafold_mappings" if prefix == "web" else "external_alphafold_mappings"
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {accession_table} (
            uniprot_accession TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            model_entity_id TEXT,
            latest_version INTEGER,
            global_metric_value REAL,
            fraction_plddt_very_low REAL,
            fraction_plddt_low REAL,
            fraction_plddt_confident REAL,
            fraction_plddt_very_high REAL,
            sequence_start INTEGER,
            sequence_end INTEGER,
            uniprot_start INTEGER,
            uniprot_end INTEGER,
            model_created_date TEXT,
            cif_url TEXT,
            pdb_url TEXT,
            bcif_url TEXT,
            pae_image_url TEXT,
            plddt_doc_url TEXT,
            pae_doc_url TEXT,
            uniprot_id TEXT,
            gene TEXT,
            organism_scientific_name TEXT,
            tax_id TEXT,
            reason TEXT,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {mapping_table} (
            biopart_id TEXT PRIMARY KEY,
            uniprot_accession TEXT NOT NULL,
            status TEXT NOT NULL,
            model_entity_id TEXT,
            latest_version INTEGER,
            global_metric_value REAL,
            sequence_start INTEGER,
            sequence_end INTEGER,
            cif_url TEXT,
            pdb_url TEXT,
            bcif_url TEXT,
            pae_image_url TEXT,
            plddt_doc_url TEXT,
            pae_doc_url TEXT,
            source TEXT NOT NULL DEFAULT 'AlphaFold DB',
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.execute(f"CREATE INDEX IF NOT EXISTS idx_{accession_table}_status ON {accession_table}(status)")
    conn.execute(f"CREATE INDEX IF NOT EXISTS idx_{mapping_table}_accession ON {mapping_table}(uniprot_accession)")

def select_accessions(conn: sqlite3.Connection, limit: int | None, force: bool, retry_errors: bool) -> list[str]:
    cache_filter = ""
    if not force:
        cache_filter = """
        AND NOT EXISTS (
            SELECT 1
            FROM web_alphafold_accessions a
            WHERE a.uniprot_accession = eu.uniprot_accession
              AND a.status IN ('found', 'not_found')
        )
        """
    if retry_errors:
        cache_filter = """
        AND EXISTS (
            SELECT 1
            FROM web_alphafold_accessions a
            WHERE a.uniprot_accession = eu.uniprot_accession
              AND a.status = 'error'
        )
        """
    limit_sql = f"LIMIT {int(limit)}" if limit else ""
    rows = conn.execute(
        f"""
        SELECT DISTINCT eu.uniprot_accession
        FROM web_enzyme_uniprot eu
        WHERE eu.uniprot_accession IS NOT NULL
          AND trim(eu.uniprot_accession) <> ''
        {cache_filter}
        ORDER BY eu.uniprot_accession
        {limit_sql}
        """
    ).fetchall()
    return [row["uniprot_accession"] for row in rows]

def upsert_accession(conn: sqlite3.Connection, row: dict[str, Any], *, prefix: str = "web") -> None:
    table = f"{prefix}_alphafold_accessions" if prefix == "web" else "external_alphafold_accessions"
    conn.execute(
        f"""
        INSERT INTO {table}(
            uniprot_accession, status, model_entity_id, latest_version, global_metric_value,
            fraction_plddt_very_low, fraction_plddt_low, fraction_plddt_confident,
            fraction_plddt_very_high, sequence_start, sequence_end, uniprot_start, uniprot_end,
            model_created_date, cif_url, pdb_url, bcif_url, pae_image_url, plddt_doc_url,
            pae_doc_url, uniprot_id, gene, organism_scientific_name, tax_id, reason
        )
        VALUES (
            :uniprot_accession, :status, :model_entity_id, :latest_version, :global_metric_value,
            :fraction_plddt_very_low, :fraction_plddt_low, :fraction_plddt_confident,
            :fraction_plddt_very_high, :sequence_start, :sequence_end, :uniprot_start, :uniprot_end,
            :model_created_date, :cif_url, :pdb_url, :bcif_url, :pae_image_url, :plddt_doc_url,
            :pae_doc_url, :uniprot_id, :gene, :organism_scientific_name, :tax_id, :reason
        )
        ON CONFLICT(uniprot_accession) DO UPDATE SET
            status = excluded.status,
            model_entity_id = excluded.model_entity_id,
            latest_version = excluded.latest_version,
            global_metric_value = excluded.global_metric_value,
            fraction_plddt_very_low = excluded.fraction_plddt_very_low,
            fraction_plddt_low = excluded.fraction_plddt_low,
            fraction_plddt_confident = excluded.fraction_plddt_confident,
            fraction_plddt_very_high = excluded.fraction_plddt_very_high,
            sequence_start = excluded.sequence_start,
            sequence_end = excluded.sequence_end,
            uniprot_start = excluded.uniprot_start,
            uniprot_end = excluded.uniprot_end,
            model_created_date = excluded.model_created_date,
            cif_url = excluded.cif_url,
            pdb_url = excluded.pdb_url,
            bcif_url = excluded.bcif_url,
            pae_image_url = excluded.pae_image_url,
            plddt_doc_url = excluded.plddt_doc_url,
            pae_doc_url = excluded.pae_doc_url,
            uniprot_id = excluded.uniprot_id,
            gene = excluded.gene,
            organism_scientific_name = excluded.organism_scientific_name,
            tax_id = excluded.tax_id,
            reason = excluded.reason,
            updated_at = CURRENT_TIMESTAMP
        """,
        {
            "model_entity_id": None,
            "latest_version": None,
            "global_metric_value": None,
            "fraction_plddt_very_low": None,
            "fraction_plddt_low": None,
            "fraction_plddt_confident": None,
            "fraction_plddt_very_high": None,
            "sequence_start": None,
            "sequence_end": None,
            "uniprot_start": None,
            "uniprot_end": None,
            "model_created_date": None,
            "cif_url": None,
            "pdb_url": None,
            "bcif_url": None,
            "pae_image_url": None,
            "plddt_doc_url": None,
            "pae_doc_url": None,
            "uniprot_id": None,
            "gene": None,
            "organism_scientific_name": None,
            "tax_id": None,
            **row,
        },
    )

def rebuild_web_mappings(conn: sqlite3.Connection) -> dict[str, int]:
    conn.execute("DELETE FROM web_alphafold_mappings")
    conn.execute(
        """
        INSERT INTO web_alphafold_mappings(
            biopart_id, uniprot_accession, status, model_entity_id, latest_version,
            global_metric_value, sequence_start, sequence_end, cif_url, pdb_url,
            bcif_url, pae_image_url, plddt_doc_url, pae_doc_url, source
        )
        SELECT
            eu.biopart_id,
            eu.uniprot_accession,
            a.status,
            a.model_entity_id,
            a.latest_version,
            a.global_metric_value,
            a.sequence_start,
            a.sequence_end,
            a.cif_url,
            a.pdb_url,
            a.bcif_url,
            a.pae_image_url,
            a.plddt_doc_url,
            a.pae_doc_url,
            'AlphaFold DB'
        FROM web_enzyme_uniprot eu
        JOIN web_alphafold_accessions a ON a.uniprot_accession = eu.uniprot_accession
        WHERE a.status = 'found'
        """
    )
    return {
        row["status"]: row["n"]
        for row in conn.execute(
            "SELECT status, COUNT(*) AS n FROM web_alphafold_accessions GROUP BY status"
        ).fetchall()
    }

def mirror_to_source(web_conn: sqlite3.Connection, src_path: Path | None) -> dict[str, int] | None:
    if not src_path or not src_path.exists():
        return None
    src_conn = connect(src_path)
    ensure_schema(src_conn, prefix="external")
    src_conn.execute("DELETE FROM external_alphafold_accessions")
    src_conn.execute("DELETE FROM external_alphafold_mappings")
    accessions = web_conn.execute("SELECT * FROM web_alphafold_accessions").fetchall()
    mappings = web_conn.execute("SELECT * FROM web_alphafold_mappings").fetchall()
    for row in accessions:
        upsert_accession(src_conn, dict(row), prefix="external")
    for row in mappings:
        src_conn.execute(
            """
            INSERT INTO external_alphafold_mappings(
                biopart_id, uniprot_accession, status, model_entity_id, latest_version,
                global_metric_value, sequence_start, sequence_end, cif_url, pdb_url,
                bcif_url, pae_image_url, plddt_doc_url, pae_doc_url, source
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row["biopart_id"],
                row["uniprot_accession"],
                row["status"],
                row["model_entity_id"],
                row["latest_version"],
                row["global_metric_value"],
                row["sequence_start"],
                row["sequence_end"],
                row["cif_url"],
                row["pdb_url"],
                row["bcif_url"],
                row["pae_image_url"],
                row["plddt_doc_url"],
                row["pae_doc_url"],
                row["source"],
            ),
        )
    src_conn.commit()
    counts = {
        "source_accession_rows": src_conn.execute("SELECT COUNT(*) FROM external_alphafold_accessions").fetchone()[0],
        "source_mapping_rows": src_conn.execute("SELECT COUNT(*) FROM external_alphafold_mappings").fetchone()[0],
    }
    src_conn.close()
    return counts
