from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from data_semantics import normalize_kinetic_source


ROOT = Path(__file__).resolve().parents[1]
CORE_DB = ROOT / "web_release" / "reactenzdb_web.db"
WORK_DIR = ROOT / "evidence_work"
OUTPUT_DB = WORK_DIR / "enzyme_reaction_evidence.sqlite"
SUMMARY = WORK_DIR / "enzyme_reaction_evidence.summary.json"
SOURCE_STATUS_DB = WORK_DIR / "source_fetch_status.sqlite"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_pmids(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        payload = json.loads(value)
    except json.JSONDecodeError:
        payload = [part.strip() for part in value.replace(";", ",").split(",")]
    if isinstance(payload, dict):
        payload = list(payload.values())
    if not isinstance(payload, list):
        payload = [payload]
    return sorted({str(item).strip() for item in payload if str(item).strip().isdigit()})


def sequence_hash(sequence: str | None) -> str | None:
    if not sequence:
        return None
    normalized = "".join(str(sequence).split()).upper()
    return hashlib.sha256(normalized.encode("ascii", errors="ignore")).hexdigest()


def normalize_core_source(value: str | None) -> str:
    """Normalize the historically overloaded web_kinetics.source_db field.

    Some legacy rows contain a MetaCyc compound token or numeric identifier in
    this column.  The raw value remains in mapping_details_json for audit.
    """
    normalized, _ = normalize_kinetic_source(value)
    names = {"brenda": "BRENDA", "sabio-rk": "SABIO-RK", "uniprot": "UniProt", "metacyc": "MetaCyc", "rdbsb": "RDBSB"}
    labels = [names[token] for token in normalized.split(",") if token in names]
    return "ReactEnzDB-core:" + ("+".join(labels) if labels else "legacy-unresolved")


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA foreign_keys=ON;
        CREATE TABLE metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE evidence_class_definitions (
          evidence_class TEXT PRIMARY KEY,
          rank_order INTEGER NOT NULL,
          definition TEXT NOT NULL,
          minimum_requirements_json TEXT NOT NULL,
          interpretation_boundary TEXT NOT NULL
        );
        CREATE TABLE outcome_definitions (
          outcome_class TEXT PRIMARY KEY,
          definition TEXT NOT NULL
        );
        CREATE TABLE source_fetch_files (
          source TEXT NOT NULL,
          ec_number TEXT NOT NULL,
          operation TEXT NOT NULL,
          status TEXT NOT NULL,
          item_count INTEGER NOT NULL,
          relative_path TEXT,
          sha256 TEXT,
          completed_at TEXT,
          PRIMARY KEY(source, ec_number, operation)
        );
        CREATE TABLE reactions (
          reaction_id TEXT PRIMARY KEY,
          reactenz_reaction_id TEXT NOT NULL,
          equation TEXT,
          direction TEXT,
          ec_number TEXT,
          rhea_id TEXT,
          kegg_reaction_id TEXT,
          metacyc_reaction_id TEXT,
          participant_count INTEGER NOT NULL,
          all_participants_have_smiles INTEGER NOT NULL
        );
        CREATE INDEX idx_evidence_reactions_public_id ON reactions(reactenz_reaction_id);
        CREATE TABLE reaction_compounds (
          reaction_id TEXT NOT NULL,
          compound_id TEXT NOT NULL,
          role TEXT,
          side TEXT,
          position_index INTEGER,
          stoichiometry TEXT,
          compound_name TEXT,
          chebi_id TEXT,
          pubchem_id TEXT,
          smiles TEXT,
          inchi TEXT,
          inchikey TEXT,
          structure_status TEXT,
          PRIMARY KEY(reaction_id, compound_id, side, position_index),
          FOREIGN KEY(reaction_id) REFERENCES reactions(reaction_id)
        );
        CREATE INDEX idx_evidence_reaction_compounds_compound ON reaction_compounds(compound_id);
        CREATE TABLE enzymes (
          biopart_id TEXT PRIMARY KEY,
          reactenz_enzyme_id TEXT NOT NULL,
          protein_id TEXT,
          enzyme_name TEXT,
          gene_name TEXT,
          organism TEXT,
          taxonomy_id TEXT,
          uniprot_accession TEXT,
          sequence_sha256 TEXT,
          sequence_length INTEGER,
          evidence_label TEXT
        );
        CREATE INDEX idx_evidence_enzymes_public_id ON enzymes(reactenz_enzyme_id);
        CREATE INDEX idx_evidence_enzymes_uniprot ON enzymes(uniprot_accession);
        CREATE INDEX idx_evidence_enzymes_sequence ON enzymes(sequence_sha256);
        CREATE TABLE enzyme_forms (
          enzyme_form_id TEXT PRIMARY KEY,
          biopart_id TEXT,
          source_db TEXT NOT NULL,
          source_record_id TEXT,
          organism TEXT,
          wild_type_status TEXT NOT NULL,
          mutation_text TEXT,
          normalized_mutations_json TEXT NOT NULL,
          accession TEXT,
          sequence_sha256 TEXT,
          identity_status TEXT NOT NULL,
          FOREIGN KEY(biopart_id) REFERENCES enzymes(biopart_id)
        );
        CREATE INDEX idx_enzyme_forms_biopart ON enzyme_forms(biopart_id);
        CREATE TABLE experimental_assertions (
          assertion_id TEXT PRIMARY KEY,
          source_db TEXT NOT NULL,
          source_record_id TEXT NOT NULL,
          source_ec_number TEXT,
          reaction_id TEXT,
          biopart_id TEXT,
          enzyme_form_id TEXT,
          evidence_class TEXT NOT NULL,
          display_evidence_label TEXT NOT NULL,
          outcome_class TEXT NOT NULL,
          is_experimental INTEGER NOT NULL,
          enzyme_identity_status TEXT NOT NULL,
          reaction_identity_status TEXT NOT NULL,
          substrate_identity_status TEXT NOT NULL,
          product_identity_status TEXT NOT NULL,
          mapping_score REAL,
          curation_status TEXT NOT NULL,
          pmid_count INTEGER NOT NULL,
          has_quantitative_measurement INTEGER NOT NULL,
          has_assay_conditions INTEGER NOT NULL,
          source_url TEXT,
          raw_cache_path TEXT,
          mapping_details_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY(reaction_id) REFERENCES reactions(reaction_id),
          FOREIGN KEY(biopart_id) REFERENCES enzymes(biopart_id),
          FOREIGN KEY(enzyme_form_id) REFERENCES enzyme_forms(enzyme_form_id),
          FOREIGN KEY(evidence_class) REFERENCES evidence_class_definitions(evidence_class),
          FOREIGN KEY(outcome_class) REFERENCES outcome_definitions(outcome_class)
        );
        CREATE INDEX idx_assertions_reaction ON experimental_assertions(reaction_id, evidence_class);
        CREATE INDEX idx_assertions_enzyme ON experimental_assertions(biopart_id, evidence_class);
        CREATE INDEX idx_assertions_curation ON experimental_assertions(curation_status);
        CREATE TABLE assertion_compounds (
          assertion_id TEXT NOT NULL,
          participant_role TEXT NOT NULL,
          raw_name TEXT,
          compound_id TEXT,
          canonical_smiles TEXT,
          inchikey TEXT,
          mapping_method TEXT NOT NULL,
          structure_similarity REAL,
          is_exact_structure_match INTEGER NOT NULL,
          PRIMARY KEY(assertion_id, participant_role, raw_name, compound_id),
          FOREIGN KEY(assertion_id) REFERENCES experimental_assertions(assertion_id)
        );
        CREATE TABLE measurements (
          measurement_id TEXT PRIMARY KEY,
          assertion_id TEXT NOT NULL,
          parameter_type TEXT NOT NULL,
          raw_value_text TEXT,
          raw_value_numeric REAL,
          raw_unit TEXT,
          normalized_value REAL,
          normalized_unit TEXT,
          normalization_status TEXT NOT NULL,
          subject_name TEXT,
          FOREIGN KEY(assertion_id) REFERENCES experimental_assertions(assertion_id)
        );
        CREATE INDEX idx_measurements_assertion ON measurements(assertion_id);
        CREATE TABLE assay_conditions (
          condition_id TEXT PRIMARY KEY,
          assertion_id TEXT NOT NULL,
          ph REAL,
          temperature_c REAL,
          buffer_text TEXT,
          cofactor_text TEXT,
          condition_text TEXT,
          extraction_method TEXT NOT NULL,
          FOREIGN KEY(assertion_id) REFERENCES experimental_assertions(assertion_id)
        );
        CREATE TABLE citations (
          assertion_id TEXT NOT NULL,
          pmid TEXT,
          doi TEXT,
          title TEXT,
          journal TEXT,
          year INTEGER,
          source_url TEXT,
          full_text_status TEXT NOT NULL DEFAULT 'not_checked',
          verification_status TEXT NOT NULL DEFAULT 'not_checked',
          PRIMARY KEY(assertion_id, pmid, doi),
          FOREIGN KEY(assertion_id) REFERENCES experimental_assertions(assertion_id)
        );
        CREATE INDEX idx_citations_pmid ON citations(pmid);
        CREATE TABLE curation_audit (
          audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
          assertion_id TEXT NOT NULL,
          action TEXT NOT NULL,
          previous_value TEXT,
          new_value TEXT,
          rule_id TEXT,
          reviewer TEXT NOT NULL,
          evidence_note TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY(assertion_id) REFERENCES experimental_assertions(assertion_id)
        );
        CREATE TABLE qa_results (
          check_name TEXT PRIMARY KEY,
          passed INTEGER NOT NULL,
          observed_value TEXT NOT NULL,
          expected_value TEXT,
          checked_at TEXT NOT NULL
        );
        """
    )


def seed_definitions(conn: sqlite3.Connection) -> None:
    boundary = "Evidence identity and experimental outcome are separate; sequence/EC similarity must not be presented as exact catalytic proof."
    rows = [
        (
            "exact_substrate_product_experimental_evidence", 1,
            "The specific enzyme form was experimentally tested on the exact canonical substrate/product set.",
            json.dumps({"enzyme_form": "exact", "substrates": "exact_structure_set", "products": "exact_structure_set", "provenance": "experimental_publication_or_primary_record"}), boundary,
        ),
        (
            "same_reaction_identifier_evidence", 2,
            "The enzyme and assay are linked to the same curated reaction identifier, but exact assay substrate/product structures are incomplete.",
            json.dumps({"enzyme": "specific_record", "reaction": "same_identifier", "provenance": "experimental_or_source_record"}), boundary,
        ),
        (
            "same_ec_different_substrate", 3,
            "The evidence concerns the same EC class but a different or unresolved substrate/product set.",
            json.dumps({"ec": "same", "substrate_product": "different_or_unresolved"}), boundary,
        ),
        (
            "similar_substrate_activity", 4,
            "Experimental activity was reported for a structurally similar, not identical, substrate.",
            json.dumps({"substrate_similarity": "reported_with_numeric_score", "provenance": "experimental"}), boundary,
        ),
        (
            "inferred_from_sequence_annotation", 5,
            "The connection is inferred from a sequence or protein annotation without assay-level support for this reaction.",
            json.dumps({"basis": "sequence_or_annotation"}), boundary,
        ),
        (
            "predicted_only", 6,
            "The connection is produced only by a computational model or rule.",
            json.dumps({"basis": "prediction"}), boundary,
        ),
    ]
    conn.executemany("INSERT INTO evidence_class_definitions VALUES (?,?,?,?,?)", rows)
    conn.executemany(
        "INSERT INTO outcome_definitions VALUES (?,?)",
        [
            ("quantitative_activity", "A numerical kinetic or activity measurement was reported."),
            ("qualitative_active", "Activity was reported without a comparable numerical measurement."),
            ("inactive", "The tested enzyme/substrate combination was explicitly reported inactive."),
            ("negative_or_below_detection", "A negative result or activity below the reported detection threshold was reported."),
            ("not_reported", "The experimental outcome is not stated in the available record."),
            ("predicted", "The outcome is computational rather than experimental."),
        ],
    )


def load_source_fetch_status(conn: sqlite3.Connection) -> int:
    if not SOURCE_STATUS_DB.exists():
        return 0
    source = sqlite3.connect(SOURCE_STATUS_DB)
    rows = source.execute(
        "SELECT source,ec_number,operation,status,item_count,relative_path,sha256,completed_at FROM fetch_status"
    ).fetchall()
    source.close()
    conn.executemany("INSERT OR REPLACE INTO source_fetch_files VALUES (?,?,?,?,?,?,?,?)", rows)
    return len(rows)


def build_core() -> dict[str, int]:
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    if OUTPUT_DB.exists():
        OUTPUT_DB.unlink()
    conn = sqlite3.connect(OUTPUT_DB)
    create_schema(conn)
    seed_definitions(conn)
    conn.execute("ATTACH DATABASE ? AS core", (str(CORE_DB),))
    conn.executemany(
        "INSERT INTO metadata VALUES (?,?)",
        [
            ("release", "ReactEnzDB enzyme-substrate-product evidence work layer 2026.08"),
            ("generated_at_utc", utc_now()),
            ("core_database", CORE_DB.name),
            ("status", "working layer; exact-evidence promotion requires full source and literature validation"),
            ("raw_source_policy", "internal provenance cache; not automatically a public redistributable artifact"),
        ],
    )
    conn.execute(
        """
        INSERT INTO reactions
        SELECT r.reaction_id, i.reactenz_reaction_id, r.reaction_equation_display,
               r.reaction_direction, r.ec_number, r.rhea_id, r.kegg_reaction_id,
               r.metacyc_reaction_id, r.participant_count, r.all_participants_have_smiles
        FROM core.web_reactions r JOIN core.web_reaction_ids i USING(reaction_id)
        """
    )
    conn.execute(
        """
        INSERT INTO reaction_compounds
        SELECT reaction_id,compound_id,role,side,position_index,stoichiometry,
               compound_name,chebi_id,pubchem_id,smiles,inchi,inchikey,structure_status
        FROM core.web_reaction_compounds
        """
    )
    enzyme_rows = conn.execute(
        """
        SELECT e.biopart_id,i.reactenz_enzyme_id,e.protein_id,e.enzyme_name,
               e.gene_name_primary,e.organism,e.taxonomy_id,u.uniprot_accession,
               e.protein_sequence,e.sequence_length,e.evidence_label
        FROM core.web_enzymes e JOIN core.web_enzyme_ids i USING(biopart_id)
        LEFT JOIN core.web_enzyme_uniprot u ON u.biopart_id=e.biopart_id
        """
    ).fetchall()
    conn.executemany(
        "INSERT INTO enzymes VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [row[:8] + (sequence_hash(row[8]), row[9], row[10]) for row in enzyme_rows],
    )
    conn.executemany(
        "INSERT INTO enzyme_forms VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [
            (
                f"core:{row[0]}:unspecified_form", row[0], "ReactEnzDB-core", row[0],
                row[5], "not_reported", None, "[]", row[7], sequence_hash(row[8]),
                "exact_internal_biopart_unspecified_form",
            )
            for row in enzyme_rows
        ],
    )
    # The conservative web enzyme table contains sequence-bearing candidates,
    # while some retained kinetic rows point to older source bioparts outside
    # that public candidate subset. Preserve those identifiers explicitly as
    # unresolved placeholders instead of dropping their measurements.
    missing_bioparts = [
        row[0]
        for row in conn.execute(
            """
            SELECT DISTINCT k.biopart_id FROM core.web_kinetics k
            LEFT JOIN core.web_enzymes e ON e.biopart_id=k.biopart_id
            WHERE e.biopart_id IS NULL
            """
        )
    ]
    conn.executemany(
        "INSERT INTO enzymes VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [(item, f"UNMAPPED:{item}", None, None, None, None, None, None, None, None, "not_in_web_enzyme_release") for item in missing_bioparts],
    )
    conn.executemany(
        "INSERT INTO enzyme_forms VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [
            (
                f"core:{item}:unspecified_form", item, "ReactEnzDB-core", item,
                None, "not_reported", None, "[]", None, None,
                "internal_biopart_not_in_web_enzyme_release",
            )
            for item in missing_bioparts
        ],
    )
    kinetics = conn.execute(
        """
        SELECT k.kinetic_id,k.reaction_id,k.biopart_id,k.compound_id,
               k.parameter_type,k.value_text,k.value_numeric,k.unit,k.subject_name,
               k.condition_text,k.source_db,k.reaction_assignment_status,
               k.reaction_assignment_method,k.evidence_text,k.pmids_json,r.ec_number
        FROM core.web_kinetics k JOIN core.web_reactions r USING(reaction_id)
        """
    ).fetchall()
    assertions = []
    measurements = []
    compounds = []
    citations = []
    conditions = []
    now = utc_now()
    provenance = {}
    if conn.execute("SELECT 1 FROM core.sqlite_master WHERE name='web_kinetics_source_provenance'").fetchone():
        provenance = dict(conn.execute("SELECT kinetic_id,source_db_raw FROM core.web_kinetics_source_provenance"))
    reference_repairs = {}
    if conn.execute("SELECT 1 FROM core.sqlite_master WHERE name='web_kinetics_reference_repairs'").fetchone():
        reference_repairs = dict(conn.execute("SELECT kinetic_id,original_biopart_id FROM core.web_kinetics_reference_repairs"))
    for row in kinetics:
        kinetic_id, reaction_id, biopart_id, compound_id = map(lambda x: x, row[:4])
        pmids = parse_pmids(row[14])
        has_condition = int(bool(row[9] and str(row[9]).strip()))
        substrate_status = "exact_internal_compound_id" if compound_id else "subject_name_only" if row[8] else "not_reported"
        details = {
            "rule_id": "CORE_KINETIC_SAME_REACTION_V1",
            "source_db_raw": provenance.get(kinetic_id, row[10]),
            "source_db_normalized": row[10],
            "original_biopart_id": reference_repairs.get(kinetic_id, biopart_id),
            "source_db_normalization_rule": "CORE_SOURCE_NORMALIZATION_V2",
            "reaction_assignment_status": row[11],
            "reaction_assignment_method": row[12],
            "exact_promotion_blockers": [
                "assay-level complete substrate set not verified",
                "assay-level product set not verified",
                "wild-type/mutant form not verified",
            ],
        }
        assertion_id = f"core-kinetic:{kinetic_id}"
        assertions.append((
            assertion_id, normalize_core_source(row[10]), kinetic_id, row[15], reaction_id,
            biopart_id, f"core:{biopart_id}:unspecified_form",
            "same_reaction_identifier_evidence", "Same reaction identifier evidence",
            "quantitative_activity", 1, "exact_internal_biopart_unspecified_form",
            "same_internal_reaction_id", substrate_status, "not_reported", None,
            "needs_literature_review", len(pmids), 1, has_condition, None, None,
            json.dumps(details, ensure_ascii=False), now,
        ))
        measurements.append((
            f"measurement:{kinetic_id}", assertion_id, row[4], row[5], row[6], row[7],
            None, None, "pending_unit_normalization", row[8],
        ))
        if compound_id:
            compound = conn.execute(
                """
                SELECT compound_name,smiles,inchikey FROM reaction_compounds
                WHERE reaction_id=? AND compound_id=? LIMIT 1
                """,
                (reaction_id, compound_id),
            ).fetchone()
            compounds.append((
                assertion_id, "tested_subject", row[8] or (compound[0] if compound else None),
                compound_id, compound[1] if compound else None, compound[2] if compound else None,
                "exact_internal_compound_id", None, 1,
            ))
        for pmid in pmids:
            citations.append((assertion_id, pmid, None, None, None, None, f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/", "not_checked", "not_checked"))
        if has_condition:
            conditions.append((f"condition:{kinetic_id}", assertion_id, None, None, None, None, row[9], "source_condition_text"))
    conn.executemany("INSERT INTO experimental_assertions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", assertions)
    conn.executemany("INSERT INTO measurements VALUES (?,?,?,?,?,?,?,?,?,?)", measurements)
    conn.executemany("INSERT INTO assertion_compounds VALUES (?,?,?,?,?,?,?,?,?)", compounds)
    conn.executemany("INSERT OR IGNORE INTO citations VALUES (?,?,?,?,?,?,?,?,?)", citations)
    conn.executemany("INSERT INTO assay_conditions VALUES (?,?,?,?,?,?,?,?)", conditions)
    source_files = load_source_fetch_status(conn)
    checks = [
        ("no_exact_claims_before_external_validation", conn.execute("SELECT COUNT(*) FROM experimental_assertions WHERE evidence_class='exact_substrate_product_experimental_evidence'").fetchone()[0] == 0),
        ("all_assertions_have_measurement", conn.execute("SELECT COUNT(*) FROM experimental_assertions a LEFT JOIN measurements m USING(assertion_id) WHERE m.measurement_id IS NULL").fetchone()[0] == 0),
        ("no_orphan_reaction", conn.execute("SELECT COUNT(*) FROM experimental_assertions a LEFT JOIN reactions r USING(reaction_id) WHERE r.reaction_id IS NULL").fetchone()[0] == 0),
        ("no_orphan_enzyme", conn.execute("SELECT COUNT(*) FROM experimental_assertions a LEFT JOIN enzymes e USING(biopart_id) WHERE e.biopart_id IS NULL").fetchone()[0] == 0),
    ]
    conn.executemany(
        "INSERT INTO qa_results VALUES (?,?,?,?,?)",
        [(name, int(passed), str(passed), "True", utc_now()) for name, passed in checks],
    )
    conn.commit()
    result = {
        "reactions": conn.execute("SELECT COUNT(*) FROM reactions").fetchone()[0],
        "reaction_compounds": conn.execute("SELECT COUNT(*) FROM reaction_compounds").fetchone()[0],
        "enzymes": conn.execute("SELECT COUNT(*) FROM enzymes").fetchone()[0],
        "core_kinetic_assertions": len(assertions),
        "assertions_with_pmids": conn.execute("SELECT COUNT(*) FROM experimental_assertions WHERE pmid_count>0").fetchone()[0],
        "assertions_with_exact_subject_compound": conn.execute("SELECT COUNT(DISTINCT assertion_id) FROM assertion_compounds WHERE is_exact_structure_match=1").fetchone()[0],
        "source_fetch_status_rows": source_files,
        "qa_passed": sum(passed for _, passed in checks),
        "qa_total": len(checks),
    }
    conn.close()
    SUMMARY.write_text(json.dumps({"generated_at_utc": utc_now(), **result}, indent=2, ensure_ascii=False), encoding="utf-8")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the conservative ReactEnzDB enzyme-substrate-product evidence work layer.")
    parser.add_argument("--stage", choices=("core",), default="core")
    parser.parse_args()
    result = build_core()
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
