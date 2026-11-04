"""Offline functions extracted from rdbsb_v1/scripts/apply_cleaning_v1.py.
Provide a connection to a working source-schema database. No collection is performed.
"""
from __future__ import annotations
from processing.source_parser.utils import stable_json

import argparse

from pathlib import Path

import sys

CLEANING_SCHEMA = """
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

CREATE INDEX IF NOT EXISTS idx_raw_pages_lookup
ON raw_pages(item_type, item_id, stage);
"""

def ensure_cleaning_schema(conn) -> None:
    conn.executescript(CLEANING_SCHEMA)
    conn.commit()

def refresh_rule_set(conn, rule_set: str, html_length_threshold: int) -> dict[str, int]:
    cur = conn.cursor()
    cur.execute("BEGIN")
    cur.execute("DELETE FROM cleaning_flags WHERE rule_set = ?", (rule_set,))

    cur.execute(
        """
        INSERT INTO cleaning_flags (
            entity_type, entity_id, rule_set, layer_name, flag_type, status, details_json
        )
        SELECT
            'biopart',
            b.biopart_id,
            ?,
            'working',
            'blank_stub_candidate',
            'exclude',
            json_object(
                'threshold_html_length', ?,
                'reason', 'empty_core_fields'
            )
        FROM bioparts b
        WHERE coalesce(trim(b.enzyme_name), '') = ''
          AND coalesce(trim(b.name), '') = ''
          AND coalesce(trim(b.organism), '') = ''
          AND coalesce(trim(b.protein_sequence), '') = ''
        """,
        (rule_set, html_length_threshold),
    )
    blank_stub_count = cur.rowcount

    cur.execute(
        """
        INSERT INTO cleaning_flags (
            entity_type, entity_id, rule_set, layer_name, flag_type, status, details_json
        )
        SELECT
            'biopart',
            b.biopart_id,
            ?,
            'working',
            'low_info_biopart',
            'review',
            json_object(
                'missing_name', coalesce(trim(b.enzyme_name), '') = '' AND coalesce(trim(b.name), '') = '',
                'missing_organism', coalesce(trim(b.organism), '') = '',
                'missing_gene_name', coalesce(trim(b.gene_name_primary), '') = '',
                'missing_taxonomy', coalesce(trim(b.taxonomy_id), '') = ''
            )
        FROM bioparts b
        WHERE coalesce(trim(b.enzyme_name), '') = ''
          AND coalesce(trim(b.name), '') = ''
          AND coalesce(trim(b.organism), '') = ''
        """,
        (rule_set,),
    )
    low_info_biopart_count = cur.rowcount

    cur.execute(
        """
        INSERT INTO cleaning_flags (
            entity_type, entity_id, rule_set, layer_name, flag_type, status, details_json
        )
        SELECT
            'reaction',
            reaction_id,
            ?,
            'working',
            'reaction_missing_ec',
            'review',
            json_object(
                'has_rhea', coalesce(trim(rhea_id), '') <> '',
                'has_kegg_reaction', coalesce(trim(kegg_reaction_id), '') <> '',
                'has_metacyc_reaction', coalesce(trim(metacyc_reaction_id), '') <> ''
            )
        FROM reactions
        WHERE coalesce(trim(ec_number), '') = ''
        """,
        (rule_set,),
    )
    reaction_missing_ec_count = cur.rowcount

    compound_rules = [
        ("CHEBI:%", "compound_class_chebi", "standardizable_primary"),
        ("SMILES:%", "compound_class_smiles", "standardizable_primary"),
        ("PUBCHEM:%", "compound_class_pubchem", "standardizable_secondary"),
        ("SUBSTANCE:%", "compound_class_substance", "standardizable_secondary"),
        ("GENERIC:%", "compound_class_generic", "nonstandard"),
        ("POLYMER:%", "compound_class_polymer", "nonstandard"),
    ]
    compound_rule_counts: dict[str, int] = {}
    for like_pattern, flag_type, status in compound_rules:
        cur.execute(
            """
            INSERT INTO cleaning_flags (
                entity_type, entity_id, rule_set, layer_name, flag_type, status, details_json
            )
            SELECT
                'compound',
                compound_id,
                ?,
                'working',
                ?,
                ?,
                json_object(
                    'compound_id', compound_id,
                    'chebi_id', chebi_id,
                    'compound_name', compound_name
                )
            FROM compounds
            WHERE compound_id LIKE ?
            """,
            (rule_set, flag_type, status, like_pattern),
        )
        compound_rule_counts[flag_type] = cur.rowcount

    cur.execute(
        """
        INSERT INTO cleaning_flags (
            entity_type, entity_id, rule_set, layer_name, flag_type, status, details_json
        )
        SELECT
            'compound',
            compound_id,
            ?,
            'working',
            'compound_class_placeholder',
            'nonstandard',
            json_object(
                'compound_id', compound_id,
                'compound_name', compound_name,
                'reason', 'reaction_local_placeholder'
            )
        FROM compounds
        WHERE compound_id LIKE 'OENA%::cmp%'
        """,
        (rule_set,),
    )
    compound_rule_counts["compound_class_placeholder"] = cur.rowcount

    cur.execute(
        """
        INSERT INTO cleaning_flags (
            entity_type, entity_id, rule_set, layer_name, flag_type, status, details_json
        )
        SELECT
            'compound',
            compound_id,
            ?,
            'working',
            'compound_missing_structure',
            CASE
                WHEN compound_id LIKE 'CHEBI:%' OR compound_id LIKE 'SMILES:%' THEN 'review'
                ELSE 'review'
            END,
            json_object(
                'smiles_missing', coalesce(trim(smiles), '') = '',
                'inchi_missing', coalesce(trim(inchi), '') = '',
                'inchikey_missing', coalesce(trim(inchikey), '') = ''
            )
        FROM compounds
        WHERE coalesce(trim(smiles), '') = ''
           OR coalesce(trim(inchi), '') = ''
           OR coalesce(trim(inchikey), '') = ''
        """,
        (rule_set,),
    )
    compound_missing_structure_count = cur.rowcount

    cur.execute("COMMIT")
    return {
        "blank_stub_candidates": blank_stub_count,
        "low_info_bioparts": low_info_biopart_count,
        "missing_ec_reactions": reaction_missing_ec_count,
        "compound_missing_structure": compound_missing_structure_count,
        **compound_rule_counts,
    }

def refresh_views(conn, rule_set: str) -> None:
    if rule_set != "v1":
        return
    cur = conn.cursor()
    cur.executescript(
        """
        DROP VIEW IF EXISTS v1_bioparts_valid;
        DROP VIEW IF EXISTS v1_reactions_valid;
        DROP VIEW IF EXISTS v1_compounds_standardizable;
        DROP VIEW IF EXISTS v1_compounds_nonstandard;
        DROP VIEW IF EXISTS v1_gold_chebi_reactions;

        CREATE VIEW v1_bioparts_valid AS
        SELECT b.*
        FROM bioparts b
        WHERE (coalesce(trim(b.enzyme_name), '') <> ''
            OR coalesce(trim(b.name), '') <> ''
            OR coalesce(trim(b.organism), '') <> ''
            OR coalesce(trim(b.protein_sequence), '') <> '')
          AND NOT EXISTS (
            SELECT 1
            FROM cleaning_flags cf
            WHERE cf.entity_type = 'biopart'
              AND cf.entity_id = b.biopart_id
              AND cf.rule_set = 'v1'
              AND cf.layer_name = 'working'
              AND cf.flag_type = 'blank_stub_candidate'
              AND cf.status = 'exclude'
        );

        CREATE VIEW v1_reactions_valid AS
        SELECT DISTINCT r.*
        FROM reactions r
        JOIN biopart_reactions br
          ON br.reaction_id = r.reaction_id
        JOIN v1_bioparts_valid b
          ON b.biopart_id = br.biopart_id
        WHERE coalesce(trim(r.reaction_equation_raw), '') <> '';

        CREATE VIEW v1_compounds_standardizable AS
        SELECT c.*
        FROM compounds c
        WHERE c.compound_id LIKE 'CHEBI:%'
           OR c.compound_id LIKE 'SMILES:%'
           OR c.compound_id LIKE 'PUBCHEM:%'
           OR c.compound_id LIKE 'SUBSTANCE:%';

        CREATE VIEW v1_compounds_nonstandard AS
        SELECT c.*
        FROM compounds c
        WHERE c.compound_id LIKE 'GENERIC:%'
           OR c.compound_id LIKE 'POLYMER:%'
           OR c.compound_id LIKE 'OENA%::cmp%';

        CREATE VIEW v1_gold_chebi_reactions AS
        SELECT rv.*
        FROM v1_reactions_valid rv
        WHERE NOT EXISTS (
            SELECT 1
            FROM reaction_compounds rc
            WHERE rc.reaction_id = rv.reaction_id
              AND rc.compound_id NOT LIKE 'CHEBI:%'
        );
        """
    )
    conn.commit()
