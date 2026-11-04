"""Offline extraction from ReactEnzDB/scripts/enrich_compounds_pubchem.py.
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

from rdkit import Chem

ROOT = Path(__file__).resolve().parents[1]

DEFAULT_DB = ROOT / "web_release" / "reactenzdb_web.db"

DEFAULT_REPORT = ROOT / "web_release" / "compound_pubchem_enrichment_report.json"

PUG = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"

PROPERTY_FIELDS = "CanonicalSMILES,IsomericSMILES,MolecularFormula,InChI,InChIKey"

def connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn

def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS web_compound_pubchem_enrichment (
            compound_id TEXT PRIMARY KEY,
            chebi_id TEXT,
            pubchem_cid TEXT,
            canonical_smiles TEXT,
            isomeric_smiles TEXT,
            formula TEXT,
            inchi TEXT,
            inchikey TEXT,
            status TEXT NOT NULL,
            reason TEXT,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_web_compound_pubchem_status "
        "ON web_compound_pubchem_enrichment(status)"
    )

def normalize_chebi(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip()
    if not value:
        return None
    if value.upper().startswith("CHEBI:"):
        return "CHEBI:" + value.split(":", 1)[1]
    if value.isdigit():
        return f"CHEBI:{value}"
    return value

def valid_smiles(value: str | None) -> bool:
    if not value or not value.strip():
        return False
    return Chem.MolFromSmiles(value.strip()) is not None

def select_candidates(conn: sqlite3.Connection, force: bool, repair_only: bool, limit: int | None) -> list[sqlite3.Row]:
    cache_filter = "" if force else """
        AND NOT EXISTS (
            SELECT 1 FROM web_compound_pubchem_enrichment e
            WHERE e.compound_id = c.compound_id
              AND e.status IN ('found', 'not_found')
        )
    """
    having = """
        HAVING chebi_id IS NOT NULL
           AND trim(chebi_id) <> ''
           AND (
                pubchem_id IS NULL OR trim(pubchem_id) = ''
                OR smiles IS NULL OR trim(smiles) = ''
                OR image_status IN ('invalid_smiles', 'render_error')
           )
    """
    if repair_only:
        having = """
        HAVING chebi_id IS NOT NULL
           AND trim(chebi_id) <> ''
           AND (
                smiles IS NULL OR trim(smiles) = ''
                OR image_status IN ('invalid_smiles', 'render_error')
           )
        """
    limit_sql = f"LIMIT {int(limit)}" if limit else ""
    return conn.execute(
        f"""
        WITH c AS (
            SELECT
                wrc.compound_id,
                MAX(wrc.compound_name) AS compound_name,
                MAX(wrc.chebi_id) AS chebi_id,
                MAX(wrc.pubchem_id) AS pubchem_id,
                MAX(wrc.smiles) AS smiles,
                MAX(wci.image_status) AS image_status
            FROM web_reaction_compounds wrc
            LEFT JOIN web_compound_images wci ON wci.compound_id = wrc.compound_id
            GROUP BY wrc.compound_id
            {having}
        )
        SELECT *
        FROM c
        WHERE 1 = 1
        {cache_filter}
        ORDER BY compound_id
        {limit_sql}
        """
    ).fetchall()

def get_cached_found(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute(
        """
        SELECT *
        FROM web_compound_pubchem_enrichment
        WHERE status = 'found' AND pubchem_cid IS NOT NULL AND trim(pubchem_cid) <> ''
        """
    ).fetchall()

def upsert_cache(conn: sqlite3.Connection, row: dict[str, Any]) -> None:
    conn.execute(
        """
        INSERT INTO web_compound_pubchem_enrichment(
            compound_id, chebi_id, pubchem_cid, canonical_smiles, isomeric_smiles,
            formula, inchi, inchikey, status, reason
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(compound_id) DO UPDATE SET
            chebi_id = excluded.chebi_id,
            pubchem_cid = excluded.pubchem_cid,
            canonical_smiles = excluded.canonical_smiles,
            isomeric_smiles = excluded.isomeric_smiles,
            formula = excluded.formula,
            inchi = excluded.inchi,
            inchikey = excluded.inchikey,
            status = excluded.status,
            reason = excluded.reason,
            updated_at = CURRENT_TIMESTAMP
        """,
        (
            row.get("compound_id"),
            row.get("chebi_id"),
            row.get("pubchem_cid"),
            row.get("canonical_smiles"),
            row.get("isomeric_smiles"),
            row.get("formula"),
            row.get("inchi"),
            row.get("inchikey"),
            row.get("status"),
            row.get("reason"),
        ),
    )

def apply_enrichment(conn: sqlite3.Connection) -> dict[str, int]:
    rows = conn.execute(
        """
        SELECT e.*, c.smiles AS current_smiles
        FROM web_compound_pubchem_enrichment e
        JOIN (
            SELECT compound_id, MAX(smiles) AS smiles
            FROM web_reaction_compounds
            GROUP BY compound_id
        ) c ON c.compound_id = e.compound_id
        WHERE e.status = 'found'
        """
    ).fetchall()
    stats = {"pubchem_updated": 0, "smiles_updated": 0, "formula_updated": 0, "inchi_updated": 0}
    for row in rows:
        current_valid = valid_smiles(row["current_smiles"])
        replacement = row["isomeric_smiles"] if valid_smiles(row["isomeric_smiles"]) else row["canonical_smiles"]
        replacement_valid = valid_smiles(replacement)
        params = {
            "compound_id": row["compound_id"],
            "pubchem_id": row["pubchem_cid"],
            "smiles": replacement if replacement_valid else None,
            "formula": row["formula"],
            "inchi": row["inchi"],
            "inchikey": row["inchikey"],
        }
        before = conn.total_changes
        conn.execute(
            """
            UPDATE web_reaction_compounds
            SET pubchem_id = CASE
                    WHEN (pubchem_id IS NULL OR trim(pubchem_id) = '') THEN :pubchem_id
                    ELSE pubchem_id
                END,
                formula = CASE
                    WHEN (formula IS NULL OR trim(formula) = '') THEN :formula
                    ELSE formula
                END,
                inchi = CASE
                    WHEN (inchi IS NULL OR trim(inchi) = '') THEN :inchi
                    ELSE inchi
                END,
                inchikey = CASE
                    WHEN (inchikey IS NULL OR trim(inchikey) = '') THEN :inchikey
                    ELSE inchikey
                END,
                smiles = CASE
                    WHEN :smiles IS NOT NULL
                     AND (smiles IS NULL OR trim(smiles) = '' OR :current_valid = 0)
                    THEN :smiles
                    ELSE smiles
                END,
                structure_status = CASE
                    WHEN :smiles IS NOT NULL
                     AND (smiles IS NULL OR trim(smiles) = '' OR :current_valid = 0)
                    THEN 'pubchem_xref_smiles'
                    ELSE structure_status
                END
            WHERE compound_id = :compound_id
            """,
            {**params, "current_valid": 1 if current_valid else 0},
        )
        changed = conn.total_changes - before
        if changed:
            stats["pubchem_updated"] += 1
            if replacement_valid and not current_valid:
                stats["smiles_updated"] += 1
            if row["formula"]:
                stats["formula_updated"] += 1
            if row["inchi"] or row["inchikey"]:
                stats["inchi_updated"] += 1
    return stats

def rebuild_compound_xrefs(conn: sqlite3.Connection) -> dict[str, int]:
    conn.execute("DELETE FROM web_xrefs WHERE entity_type = 'compound'")
    conn.execute(
        """
        INSERT INTO web_xrefs(entity_type, entity_id, xref_db, xref_value, xref_url, source_db)
        SELECT DISTINCT
            'compound',
            compound_id,
            'chebi',
            chebi_id,
            'https://www.ebi.ac.uk/chebi/searchId.do?chebiId=' || chebi_id,
            'ReactEnzDB'
        FROM web_reaction_compounds
        WHERE chebi_id IS NOT NULL AND trim(chebi_id) <> ''
        """
    )
    conn.execute(
        """
        INSERT INTO web_xrefs(entity_type, entity_id, xref_db, xref_value, xref_url, source_db)
        SELECT DISTINCT
            'compound',
            compound_id,
            'pubchem_compound',
            pubchem_id,
            'https://pubchem.ncbi.nlm.nih.gov/compound/' || pubchem_id,
            'PubChem via ChEBI RegistryID'
        FROM web_reaction_compounds
        WHERE pubchem_id IS NOT NULL AND trim(pubchem_id) <> ''
        """
    )
    counts = dict(
        conn.execute(
            """
            SELECT xref_db, COUNT(*) AS n
            FROM web_xrefs
            WHERE entity_type = 'compound'
            GROUP BY xref_db
            """
        ).fetchall()
    )
    return {str(k): int(v) for k, v in counts.items()}
