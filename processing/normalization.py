"""Offline functions extracted from rdbsb_v1/scripts/normalize_working_fields.py.
Provide a connection to a working source-schema database. No collection is performed.
"""
from __future__ import annotations
from processing.source_parser.utils import stable_json

import argparse

import re

from pathlib import Path

import sys

NORMALIZATION_SCHEMA = """
CREATE TABLE IF NOT EXISTS reaction_ec_numbers (
    reaction_ec_id INTEGER PRIMARY KEY AUTOINCREMENT,
    reaction_id TEXT NOT NULL,
    ec_number_clean TEXT NOT NULL,
    ec_text_raw TEXT,
    source_field TEXT NOT NULL DEFAULT 'reactions.ec_number',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(reaction_id, ec_number_clean, source_field),
    FOREIGN KEY (reaction_id) REFERENCES reactions(reaction_id)
);

CREATE TABLE IF NOT EXISTS compound_normalization (
    compound_id TEXT PRIMARY KEY,
    compound_class TEXT NOT NULL,
    structure_status TEXT NOT NULL,
    has_smiles INTEGER NOT NULL DEFAULT 0,
    has_inchi INTEGER NOT NULL DEFAULT 0,
    has_inchikey INTEGER NOT NULL DEFAULT 0,
    is_model_structure_capable INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (compound_id) REFERENCES compounds(compound_id)
);

CREATE INDEX IF NOT EXISTS idx_reaction_ec_clean
ON reaction_ec_numbers(reaction_id, ec_number_clean);

CREATE INDEX IF NOT EXISTS idx_compound_normalization_class
ON compound_normalization(compound_class, structure_status);

CREATE TABLE IF NOT EXISTS cleaning_flags (
    cleaning_flag_id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    rule_set TEXT NOT NULL DEFAULT 'v1',
    layer_name TEXT NOT NULL,
    flag_type TEXT NOT NULL,
    status TEXT NOT NULL,
    details_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(entity_type, entity_id, rule_set, layer_name, flag_type)
);

CREATE INDEX IF NOT EXISTS idx_cleaning_flags_entity
ON cleaning_flags(entity_type, entity_id, rule_set, layer_name);
"""

EC_RE = re.compile(r"(?:EC:?\s*)?(\d+\.(?:\d+|-)\.(?:\d+|-)\.(?:\d+|-))", re.IGNORECASE)

def ensure_schema(conn) -> None:
    conn.executescript(NORMALIZATION_SCHEMA)
    conn.commit()

def extract_ec_numbers(text: str | None) -> list[str]:
    if not text:
        return []
    values: list[str] = []
    seen: set[str] = set()
    for match in EC_RE.finditer(text):
        value = match.group(1)
        if value not in seen:
            seen.add(value)
            values.append(value)
    return values

def compound_class(compound_id: str) -> str:
    if compound_id.startswith("CHEBI:"):
        return "CHEBI"
    if compound_id.startswith("SMILES:"):
        return "SMILES"
    if compound_id.startswith("PUBCHEM:"):
        return "PUBCHEM"
    if compound_id.startswith("SUBSTANCE:"):
        return "SUBSTANCE"
    if compound_id.startswith("GENERIC:"):
        return "GENERIC"
    if compound_id.startswith("POLYMER:"):
        return "POLYMER"
    if "::cmp" in compound_id:
        return "PLACEHOLDER"
    return "OTHER"

def structure_status(has_smiles: bool, has_inchi: bool, has_inchikey: bool) -> str:
    if has_smiles and has_inchi and has_inchikey:
        return "complete_structure"
    if has_smiles and not (has_inchi and has_inchikey):
        return "smiles_only"
    if has_inchi or has_inchikey:
        return "partial_structure"
    return "missing_structure"

def normalize_ec(conn, rule_set: str, commit_every: int) -> int:
    conn.execute("DELETE FROM reaction_ec_numbers")
    conn.commit()
    rows = conn.execute(
        """
        SELECT reaction_id, ec_number
        FROM reactions
        WHERE coalesce(trim(ec_number), '') <> ''
        """
    ).fetchall()
    inserted = 0
    for idx, row in enumerate(rows, start=1):
        for ec in extract_ec_numbers(row["ec_number"]):
            conn.execute(
                """
                INSERT OR IGNORE INTO reaction_ec_numbers (
                    reaction_id, ec_number_clean, ec_text_raw, source_field
                ) VALUES (?, ?, ?, 'reactions.ec_number')
                """,
                (row["reaction_id"], ec, row["ec_number"]),
            )
            inserted += 1
        if idx % max(commit_every, 1) == 0:
            conn.commit()
            print({"stage": "normalizing_ec", "processed": idx, "selected": len(rows), "inserted": inserted})
    conn.commit()

    conn.execute(
        """
        INSERT INTO cleaning_flags (
            entity_type, entity_id, rule_set, layer_name, flag_type, status, details_json
        )
        SELECT
            'reaction',
            r.reaction_id,
            ?,
            'normalized',
            'ec_text_without_parseable_ec',
            'review',
            json_object('ec_number_raw', r.ec_number)
        FROM reactions r
        WHERE coalesce(trim(r.ec_number), '') <> ''
          AND NOT EXISTS (
              SELECT 1
              FROM reaction_ec_numbers e
              WHERE e.reaction_id = r.reaction_id
          )
        ON CONFLICT(entity_type, entity_id, rule_set, layer_name, flag_type) DO UPDATE SET
            status = excluded.status,
            details_json = excluded.details_json,
            updated_at = CURRENT_TIMESTAMP
        """,
        (rule_set,),
    )
    conn.commit()
    return inserted

def normalize_compounds(conn) -> int:
    conn.execute("DELETE FROM compound_normalization")
    conn.commit()
    cur = conn.execute(
        """
        INSERT INTO compound_normalization (
            compound_id, compound_class, structure_status, has_smiles,
            has_inchi, has_inchikey, is_model_structure_capable
        )
        SELECT
            compound_id,
            CASE
                WHEN compound_id LIKE 'CHEBI:%' THEN 'CHEBI'
                WHEN compound_id LIKE 'SMILES:%' THEN 'SMILES'
                WHEN compound_id LIKE 'PUBCHEM:%' THEN 'PUBCHEM'
                WHEN compound_id LIKE 'SUBSTANCE:%' THEN 'SUBSTANCE'
                WHEN compound_id LIKE 'GENERIC:%' THEN 'GENERIC'
                WHEN compound_id LIKE 'POLYMER:%' THEN 'POLYMER'
                WHEN compound_id LIKE '%::cmp%' THEN 'PLACEHOLDER'
                ELSE 'OTHER'
            END AS compound_class,
            CASE
                WHEN coalesce(trim(smiles), '') <> ''
                 AND coalesce(trim(inchi), '') <> ''
                 AND coalesce(trim(inchikey), '') <> '' THEN 'complete_structure'
                WHEN coalesce(trim(smiles), '') <> '' THEN 'smiles_only'
                WHEN coalesce(trim(inchi), '') <> ''
                  OR coalesce(trim(inchikey), '') <> '' THEN 'partial_structure'
                ELSE 'missing_structure'
            END AS structure_status,
            coalesce(trim(smiles), '') <> '',
            coalesce(trim(inchi), '') <> '',
            coalesce(trim(inchikey), '') <> '',
            CASE
                WHEN (
                    compound_id LIKE 'CHEBI:%'
                    OR compound_id LIKE 'SMILES:%'
                    OR compound_id LIKE 'PUBCHEM:%'
                    OR compound_id LIKE 'SUBSTANCE:%'
                )
                AND (
                    coalesce(trim(smiles), '') <> ''
                    OR coalesce(trim(inchi), '') <> ''
                    OR coalesce(trim(inchikey), '') <> ''
                )
                THEN 1
                ELSE 0
            END
        FROM compounds
        """
    )
    conn.commit()
    return cur.rowcount

def flag_placeholder_attributes(conn, rule_set: str) -> int:
    cur = conn.execute(
        """
        INSERT INTO cleaning_flags (
            entity_type, entity_id, rule_set, layer_name, flag_type, status, details_json
        )
        SELECT
            entity_type,
            attribute_evidence_id,
            ?,
            'normalized',
            'placeholder_attribute_value',
            'exclude',
            json_object(
                'source_entity_id', entity_id,
                'attribute_name', attribute_name,
                'value_text', value_text
            )
        FROM attribute_evidences
        WHERE trim(coalesce(value_text, '')) IN ('-', '?')
        ON CONFLICT(entity_type, entity_id, rule_set, layer_name, flag_type) DO UPDATE SET
            status = excluded.status,
            details_json = excluded.details_json,
            updated_at = CURRENT_TIMESTAMP
        """,
        (rule_set,),
    )
    conn.commit()
    return cur.rowcount

def refresh_views(conn) -> None:
    conn.executescript(
        """
        DROP VIEW IF EXISTS v1_silver_structure_reactions;

        CREATE VIEW v1_silver_structure_reactions AS
        SELECT rv.*
        FROM v1_reactions_valid rv
        WHERE NOT EXISTS (
            SELECT 1
            FROM reaction_compounds rc
            LEFT JOIN compound_normalization cn
              ON cn.compound_id = rc.compound_id
            WHERE rc.reaction_id = rv.reaction_id
              AND coalesce(cn.is_model_structure_capable, 0) = 0
        );
        """
    )
