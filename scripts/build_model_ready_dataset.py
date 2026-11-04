from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import re
import sqlite3
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from data_semantics import add_model_direction_fields

from rdkit import Chem, RDLogger

RDLogger.DisableLog("rdApp.*")


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MAIN_DB = ROOT / "web_release" / "reactenzdb_web.db"
DEFAULT_OUTPUT_DB = ROOT / "web_release" / "model_ready_dataset.sqlite"
DEFAULT_DOWNLOAD_DIR = ROOT / "web_release" / "downloads"
DEFAULT_SUMMARY = ROOT / "web_release" / "model_ready_dataset.summary.json"

CURRENCY_PATTERNS = [
    "h2o",
    "water",
    "h+",
    "proton",
    "atp",
    "adp",
    "amp",
    "gtp",
    "gdp",
    "udp",
    "utp",
    "ctp",
    "cdp",
    "nad",
    "nadh",
    "nadp",
    "nadph",
    "coa",
    "co-a",
    "coenzyme a",
    "phosphate",
    "diphosphate",
    "pyrophosphate",
    "ppi",
    "pi",
    "orthophosphate",
    "oxygen",
    "o2",
    "carbon dioxide",
    "co2",
    "ammonia",
    "nh3",
    "s-adenosyl-l-methionine",
    "s-adenosylmethionine",
    "sam",
    "s-adenosyl-l-homocysteine",
    "s-adenosylhomocysteine",
    "sah",
]

FORMULA_TOKEN = re.compile(r"([A-Z][a-z]?)(\d*)")
LEADING_COEFF = re.compile(r"^\s*([0-9]+(?:\.[0-9]+)?)\b")


def log(message: str) -> None:
    print(message, flush=True)


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA temp_store = MEMORY")
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_smiles(smiles: str | None) -> str | None:
    if not smiles:
        return None
    try:
        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            return None
        return Chem.MolToSmiles(mol, canonical=True, isomericSmiles=True)
    except Exception:
        return None


def parse_formula(formula: str | None) -> dict[str, float] | None:
    if not formula:
        return None
    formula = formula.strip()
    # RDKit/ChEBI append formal charge (e.g. H+, C10H16N5O13P3-4).
    # Atom counts remain usable for mass balance; this does not check charge.
    formula = re.sub(r"[+-]\d*$", "", formula)
    if not formula or any(ch in formula for ch in "().[]+-"):
        return None
    counts: dict[str, float] = defaultdict(float)
    consumed = ""
    for element, amount in FORMULA_TOKEN.findall(formula):
        counts[element] += float(amount or 1)
        consumed += f"{element}{amount}"
    if not counts or consumed != formula:
        return None
    return dict(counts)


def stoich_coeff(value: str | None) -> float:
    if not value:
        return 1.0
    match = LEADING_COEFF.match(value)
    if not match:
        return 1.0
    try:
        parsed = float(match.group(1))
        return parsed if parsed > 0 else 1.0
    except ValueError:
        return 1.0


def currency_match(row: sqlite3.Row) -> tuple[int, str | None]:
    haystack = " ".join(
        str(row[key] or "").lower()
        for key in ("compound_id", "compound_name", "chebi_id", "pubchem_id", "formula", "smiles", "inchikey")
    )
    for pattern in CURRENCY_PATTERNS:
        if pattern in haystack:
            return 1, pattern
    return 0, None


def joined(values: list[str | None]) -> str | None:
    filtered = [str(value) for value in values if value not in (None, "")]
    return ";".join(filtered) if filtered else None


def json_dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def side_smiles(compounds: list[dict[str, Any]], side: str, canonical: bool) -> str | None:
    values = []
    for compound in compounds:
        if compound["side"] != side:
            continue
        value = compound["canonical_smiles"] if canonical else compound["smiles"]
        if value:
            coefficient = stoich_coeff(compound.get("stoichiometry"))
            if not coefficient.is_integer() or coefficient > 100:
                return None  # An unscaled fractional reaction cannot be serialized exactly.
            values.extend([value] * int(coefficient))
    values.sort()
    return ".".join(values) if values else None


def formula_balance(compounds: list[dict[str, Any]]) -> tuple[str, str]:
    totals = {"left": defaultdict(float), "right": defaultdict(float)}
    unknown = False
    for compound in compounds:
        formula_counts = parse_formula(compound.get("formula"))
        if not formula_counts:
            unknown = True
            continue
        side = compound.get("side")
        if side not in totals:
            unknown = True
            continue
        coeff = stoich_coeff(compound.get("stoichiometry"))
        for element, amount in formula_counts.items():
            totals[side][element] += amount * coeff

    elements = sorted(set(totals["left"]) | set(totals["right"]))
    delta = {
        element: round(totals["right"].get(element, 0.0) - totals["left"].get(element, 0.0), 6)
        for element in elements
        if abs(totals["right"].get(element, 0.0) - totals["left"].get(element, 0.0)) > 1e-6
    }
    if not elements or unknown:
        return "unknown_missing_or_unparsed_formula", json_dump(delta)
    if not delta:
        return "formula_balanced", json_dump({})
    return "formula_unbalanced", json_dump(delta)


def setup_output(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        DROP TABLE IF EXISTS model_ready_reactions;
        DROP TABLE IF EXISTS model_ready_reaction_compounds;
        DROP TABLE IF EXISTS model_ready_enzyme_candidates;
        DROP VIEW IF EXISTS model_ready_trainable_reactions;
        DROP VIEW IF EXISTS model_ready_trainable_enzyme_candidates;

        CREATE TABLE model_ready_reactions (
          reaction_id TEXT PRIMARY KEY,
          reactenz_reaction_id TEXT NOT NULL,
          dataset_level TEXT,
          ec_number TEXT,
          ec_class TEXT,
          ec_subclass TEXT,
          ec_subsubclass TEXT,
          rhea_id TEXT,
          kegg_reaction_id TEXT,
          metacyc_reaction_id TEXT,
          mnx_reaction_ids TEXT,
          reaction_equation_display TEXT,
          reactants_smiles TEXT,
          products_smiles TEXT,
          reaction_smiles TEXT,
          canonical_reactants_smiles TEXT,
          canonical_products_smiles TEXT,
          canonical_reaction_smiles TEXT,
          reactant_compound_ids TEXT,
          product_compound_ids TEXT,
          reactant_inchikeys TEXT,
          product_inchikeys TEXT,
          currency_compound_ids TEXT,
          currency_compound_names TEXT,
          currency_compound_count INTEGER NOT NULL,
          non_currency_reactant_count INTEGER NOT NULL,
          non_currency_product_count INTEGER NOT NULL,
          only_currency_transformation INTEGER NOT NULL,
          participant_count INTEGER,
          smiles_count INTEGER,
          missing_smiles_count INTEGER,
          all_participants_have_smiles INTEGER,
          formula_balance_status TEXT NOT NULL,
          formula_balance_delta_json TEXT NOT NULL,
          charge_balance_status TEXT NOT NULL,
          enzyme_candidate_count INTEGER,
          organism_count INTEGER,
          chassis_count INTEGER,
          kinetics_count INTEGER,
          evidence_score INTEGER,
          evidence_tier TEXT,
          model_ready_status TEXT NOT NULL,
          quality_flags TEXT NOT NULL
        );

        CREATE TABLE model_ready_reaction_compounds (
          reaction_id TEXT NOT NULL,
          compound_id TEXT NOT NULL,
          side TEXT,
          role TEXT,
          position_index INTEGER,
          stoichiometry TEXT,
          compound_name TEXT,
          formula TEXT,
          smiles TEXT,
          canonical_smiles TEXT,
          inchi TEXT,
          inchikey TEXT,
          chebi_id TEXT,
          pubchem_id TEXT,
          mnx_compound_ids TEXT,
          is_currency INTEGER NOT NULL,
          currency_reason TEXT,
          structure_status TEXT,
          PRIMARY KEY (reaction_id, compound_id, side, position_index)
        );
        CREATE INDEX idx_model_ready_reaction_compounds_reaction ON model_ready_reaction_compounds(reaction_id);
        CREATE INDEX idx_model_ready_reaction_compounds_smiles ON model_ready_reaction_compounds(canonical_smiles);

        CREATE TABLE model_ready_enzyme_candidates (
          candidate_id TEXT PRIMARY KEY,
          reaction_id TEXT NOT NULL,
          reactenz_reaction_id TEXT NOT NULL,
          biopart_id TEXT NOT NULL,
          reactenz_enzyme_id TEXT,
          enzyme_name TEXT,
          gene_name_primary TEXT,
          organism TEXT,
          taxonomy_id TEXT,
          protein_id TEXT,
          uniprot_accession TEXT,
          uniprot_entry_name TEXT,
          source_db TEXT,
          evidence_level TEXT,
          enzyme_evidence_score INTEGER,
          enzyme_evidence_tier TEXT,
          has_sequence INTEGER,
          sequence_length INTEGER,
          chassis_labels TEXT,
          chassis_count INTEGER,
          kinetic_record_count INTEGER,
          km_count INTEGER,
          kcat_count INTEGER,
          kcat_km_count INTEGER,
          vmax_count INTEGER,
          kinetic_subjects TEXT,
          brenda_exact_kinetic_count INTEGER NOT NULL DEFAULT 0,
          sabio_rk_exact_kinetic_count INTEGER NOT NULL DEFAULT 0,
          external_exact_kinetic_count INTEGER NOT NULL DEFAULT 0,
          external_validation_status TEXT NOT NULL,
          optimum_ph_values TEXT,
          optimum_temperature_values TEXT,
          interpro_count INTEGER,
          pfam_count INTEGER,
          active_site_count INTEGER,
          binding_site_count INTEGER,
          conserved_site_count INTEGER,
          best_structure_type TEXT,
          best_structure_id TEXT,
          structure_confidence_score INTEGER,
          structure_confidence_tier TEXT,
          catalytic_site_support_level TEXT,
          host_suitability_features_json TEXT
        );
        CREATE INDEX idx_model_ready_candidates_reaction ON model_ready_enzyme_candidates(reaction_id);
        CREATE INDEX idx_model_ready_candidates_biopart ON model_ready_enzyme_candidates(biopart_id);
        CREATE INDEX idx_model_ready_candidates_chassis ON model_ready_enzyme_candidates(chassis_count);
        CREATE INDEX idx_model_ready_candidates_external_validation ON model_ready_enzyme_candidates(external_validation_status);

        -- Conservative default for direct reaction-model training. Charge balance is
        -- not included because the source release has no structured charge field.
        CREATE VIEW model_ready_trainable_reactions AS
        SELECT *
        FROM model_ready_reactions
        WHERE model_ready_status = 'default_trainable';

        CREATE VIEW model_ready_trainable_enzyme_candidates AS
        SELECT candidate.*
        FROM model_ready_enzyme_candidates AS candidate
        JOIN model_ready_trainable_reactions AS reaction
          ON reaction.reaction_id = candidate.reaction_id;
        """
    )


def build_reaction_tables(main: sqlite3.Connection, out: sqlite3.Connection) -> None:
    reactions = main.execute(
        """
        SELECT rid.reactenz_reaction_id, wr.*,
               COALESCE(es.evidence_score, 0) AS evidence_score,
               es.evidence_tier,
               (SELECT GROUP_CONCAT(DISTINCT m.mnx_reaction_id)
                FROM web_mnx_reaction_mappings m
                WHERE m.reaction_id = wr.reaction_id) AS mnx_reaction_ids,
               (SELECT COUNT(DISTINCT re.organism)
                FROM web_reaction_enzymes re
                WHERE re.reaction_id = wr.reaction_id AND re.organism IS NOT NULL) AS organism_count,
               (SELECT COUNT(DISTINCT cr.chassis_label)
                FROM web_chassis_records cr
                WHERE cr.reaction_id = wr.reaction_id) AS chassis_count,
               (SELECT COUNT(*)
                FROM web_reaction_qc_flags q
                WHERE q.reaction_id = wr.reaction_id
                  AND q.risk_type IN ('no_uniprot_overlap', 'local_has_no_uniprot'))
                  AS qc_enzyme_link_risk_count
        FROM web_reactions wr
        JOIN web_reaction_ids rid ON rid.reaction_id = wr.reaction_id
        LEFT JOIN web_evidence_scores es ON es.entity_type = 'reaction' AND es.entity_id = wr.reaction_id
        ORDER BY wr.reaction_id
        """
    ).fetchall()

    compound_rows = main.execute(
        """
        SELECT c.*,
               (SELECT GROUP_CONCAT(DISTINCT m.mnx_compound_id)
                FROM web_mnx_compound_mappings m
                WHERE m.compound_id = c.compound_id) AS mnx_compound_ids
        FROM web_reaction_compounds c
        ORDER BY c.reaction_id, c.side, c.position_index
        """
    )
    compounds_by_reaction: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in compound_rows:
        is_currency, reason = currency_match(row)
        canonical = canonical_smiles(row["smiles"])
        record = dict(row)
        record["canonical_smiles"] = canonical
        record["is_currency"] = is_currency
        record["currency_reason"] = reason
        compounds_by_reaction[row["reaction_id"]].append(record)
        out.execute(
            """
            INSERT INTO model_ready_reaction_compounds VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row["reaction_id"],
                row["compound_id"],
                row["side"],
                row["role"],
                row["position_index"],
                row["stoichiometry"],
                row["compound_name"],
                row["formula"],
                row["smiles"],
                canonical,
                row["inchi"],
                row["inchikey"],
                row["chebi_id"],
                row["pubchem_id"],
                row["mnx_compound_ids"],
                is_currency,
                reason,
                row["structure_status"],
            ),
        )

    insert_sql = """
        INSERT INTO model_ready_reactions VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
    """
    for reaction in reactions:
        compounds = compounds_by_reaction.get(reaction["reaction_id"], [])
        reactants = [item for item in compounds if item.get("side") == "left"]
        products = [item for item in compounds if item.get("side") == "right"]
        reactants_smiles = side_smiles(compounds, "left", canonical=False)
        products_smiles = side_smiles(compounds, "right", canonical=False)
        canonical_reactants = side_smiles(compounds, "left", canonical=True)
        canonical_products = side_smiles(compounds, "right", canonical=True)
        reaction_smiles = f"{reactants_smiles}>>{products_smiles}" if reactants_smiles and products_smiles else None
        canonical_reaction = f"{canonical_reactants}>>{canonical_products}" if canonical_reactants and canonical_products else None
        currency = [item for item in compounds if item["is_currency"]]
        non_currency_reactants = [item for item in reactants if not item["is_currency"]]
        non_currency_products = [item for item in products if not item["is_currency"]]
        only_currency = int(bool(compounds) and not non_currency_reactants and not non_currency_products)
        balance_status, balance_delta = formula_balance(compounds)
        flags = []
        if not canonical_reaction:
            flags.append("no_reaction_smiles")
        if reaction["missing_smiles_count"]:
            flags.append("missing_participant_smiles")
        if only_currency:
            flags.append("only_currency_transformation")
        if balance_status != "formula_balanced":
            flags.append(balance_status)
        if not reaction["enzyme_count"]:
            flags.append("no_enzyme_candidate")
        if reaction["qc_enzyme_link_risk_count"]:
            flags.append("unresolved_reaction_enzyme_qc_risk")

        ec_parts = (reaction["ec_number"] or "").split(";")[0].replace("EC:", "").replace("EC-", "").split(".")
        out.execute(
            insert_sql,
            (
                reaction["reaction_id"],
                reaction["reactenz_reaction_id"],
                reaction["dataset_level"],
                reaction["ec_number"],
                ec_parts[0] if len(ec_parts) > 0 and ec_parts[0] else None,
                ".".join(ec_parts[:2]) if len(ec_parts) > 1 else None,
                ".".join(ec_parts[:3]) if len(ec_parts) > 2 else None,
                reaction["rhea_id"],
                reaction["kegg_reaction_id"],
                reaction["metacyc_reaction_id"],
                reaction["mnx_reaction_ids"],
                reaction["reaction_equation_display"],
                reactants_smiles,
                products_smiles,
                reaction_smiles,
                canonical_reactants,
                canonical_products,
                canonical_reaction,
                joined([item.get("compound_id") for item in reactants]),
                joined([item.get("compound_id") for item in products]),
                joined([item.get("inchikey") for item in reactants]),
                joined([item.get("inchikey") for item in products]),
                joined([item.get("compound_id") for item in currency]),
                joined([item.get("compound_name") for item in currency]),
                len(currency),
                len(non_currency_reactants),
                len(non_currency_products),
                only_currency,
                reaction["participant_count"],
                reaction["smiles_count"],
                reaction["missing_smiles_count"],
                reaction["all_participants_have_smiles"],
                balance_status,
                balance_delta,
                "not_computed_no_structured_charge_field",
                reaction["enzyme_count"],
                reaction["organism_count"],
                reaction["chassis_count"],
                reaction["kinetics_count"],
                reaction["evidence_score"],
                reaction["evidence_tier"],
                "default_trainable" if canonical_reaction and not reaction["missing_smiles_count"] and balance_status == "formula_balanced" and not only_currency and reaction["enzyme_count"] and not reaction["qc_enzyme_link_risk_count"] else "use_with_filters",
                ";".join(flags) if flags else "none",
            ),
        )
    out.commit()


def build_candidate_table(out: sqlite3.Connection, main_db: Path) -> None:
    escaped = str(main_db).replace("'", "''")
    out.execute(f"ATTACH DATABASE '{escaped}' AS main_db")
    out.executescript(
        """
        INSERT INTO model_ready_enzyme_candidates
        SELECT
          re.reaction_id || '|' || re.biopart_id AS candidate_id,
          re.reaction_id,
          rid.reactenz_reaction_id,
          re.biopart_id,
          eid.reactenz_enzyme_id,
          re.enzyme_name,
          re.gene_name_primary,
          re.organism,
          re.taxonomy_id,
          re.protein_id,
          eu.uniprot_accession,
          eu.uniprot_entry_name,
          re.source_db,
          re.evidence_level,
          COALESCE(es.evidence_score, 0) AS enzyme_evidence_score,
          es.evidence_tier AS enzyme_evidence_tier,
          re.has_sequence,
          re.sequence_length,
          ch.chassis_labels,
          COALESCE(ch.chassis_count, 0) AS chassis_count,
          COALESCE(kin.kinetic_record_count, 0) AS kinetic_record_count,
          COALESCE(kin.km_count, 0) AS km_count,
          COALESCE(kin.kcat_count, 0) AS kcat_count,
          COALESCE(kin.kcat_km_count, 0) AS kcat_km_count,
          COALESCE(kin.vmax_count, 0) AS vmax_count,
          kin.kinetic_subjects,
          COALESCE(ext.brenda_exact_kinetic_count, 0) AS brenda_exact_kinetic_count,
          COALESCE(ext.sabio_rk_exact_kinetic_count, 0) AS sabio_rk_exact_kinetic_count,
          COALESCE(ext.brenda_exact_kinetic_count, 0) + COALESCE(ext.sabio_rk_exact_kinetic_count, 0) AS external_exact_kinetic_count,
          CASE
            WHEN COALESCE(ext.brenda_exact_kinetic_count, 0) > 0 AND COALESCE(ext.sabio_rk_exact_kinetic_count, 0) > 0 THEN 'brenda_and_sabio_rk_exact'
            WHEN COALESCE(ext.brenda_exact_kinetic_count, 0) > 0 THEN 'brenda_exact'
            WHEN COALESCE(ext.sabio_rk_exact_kinetic_count, 0) > 0 THEN 'sabio_rk_exact'
            ELSE 'not_externally_confirmed'
          END AS external_validation_status,
          attr.optimum_ph_values,
          attr.optimum_temperature_values,
          COALESCE(pa.interpro_count, 0) AS interpro_count,
          COALESCE(pa.pfam_count, 0) AS pfam_count,
          COALESCE(pa.active_site_count, 0) AS active_site_count,
          COALESCE(pa.binding_site_count, 0) AS binding_site_count,
          COALESCE(pa.conserved_site_count, 0) AS conserved_site_count,
          sc.best_structure_type,
          sc.best_structure_id,
          COALESCE(sc.structure_confidence_score, 0) AS structure_confidence_score,
          sc.structure_confidence_tier,
          sc.catalytic_site_support_level,
          json_object(
            'has_chassis_evidence', CASE WHEN COALESCE(ch.chassis_count, 0) > 0 THEN 1 ELSE 0 END,
            'has_kinetic_evidence', CASE WHEN COALESCE(kin.kinetic_record_count, 0) > 0 THEN 1 ELSE 0 END,
            'has_sequence', COALESCE(re.has_sequence, 0),
            'has_structure_support', CASE WHEN COALESCE(sc.structure_confidence_score, 0) > 0 THEN 1 ELSE 0 END,
            'has_functional_site_annotation', CASE WHEN COALESCE(pa.active_site_count, 0) + COALESCE(pa.binding_site_count, 0) + COALESCE(pa.conserved_site_count, 0) > 0 THEN 1 ELSE 0 END
          ) AS host_suitability_features_json
        FROM main_db.web_reaction_enzymes re
        JOIN main_db.web_reaction_ids rid ON rid.reaction_id = re.reaction_id
        LEFT JOIN main_db.web_enzyme_ids eid ON eid.biopart_id = re.biopart_id
        LEFT JOIN main_db.web_enzyme_uniprot eu ON eu.biopart_id = re.biopart_id
        LEFT JOIN main_db.web_evidence_scores es ON es.entity_type = 'enzyme' AND es.entity_id = re.biopart_id
        LEFT JOIN main_db.web_protein_annotations pa ON pa.biopart_id = re.biopart_id
        LEFT JOIN main_db.web_structure_confidence sc ON sc.biopart_id = re.biopart_id
        LEFT JOIN (
          SELECT reaction_id, biopart_id,
                 GROUP_CONCAT(DISTINCT chassis_label) AS chassis_labels,
                 COUNT(DISTINCT chassis_label) AS chassis_count
          FROM main_db.web_chassis_records
          GROUP BY reaction_id, biopart_id
        ) ch ON ch.reaction_id = re.reaction_id AND ch.biopart_id = re.biopart_id
        LEFT JOIN (
          SELECT reaction_id, biopart_id,
                 COUNT(*) AS kinetic_record_count,
                 SUM(CASE WHEN parameter_type = 'km' THEN 1 ELSE 0 END) AS km_count,
                 SUM(CASE WHEN parameter_type = 'kcat' THEN 1 ELSE 0 END) AS kcat_count,
                 SUM(CASE WHEN parameter_type = 'kcat_km' THEN 1 ELSE 0 END) AS kcat_km_count,
                 SUM(CASE WHEN parameter_type = 'vmax' THEN 1 ELSE 0 END) AS vmax_count,
                 GROUP_CONCAT(DISTINCT subject_name) AS kinetic_subjects
          FROM main_db.web_kinetics
          GROUP BY reaction_id, biopart_id
        ) kin ON kin.reaction_id = re.reaction_id AND kin.biopart_id = re.biopart_id
        LEFT JOIN (
          SELECT k.reaction_id,
                 k.biopart_id,
                 COUNT(DISTINCT CASE WHEN c.source_db = 'BRENDA' AND c.match_status = 'matched' THEN k.kinetic_id END) AS brenda_exact_kinetic_count,
                 COUNT(DISTINCT CASE WHEN c.source_db = 'SABIO-RK' AND c.match_status = 'matched' THEN k.kinetic_id END) AS sabio_rk_exact_kinetic_count
          FROM main_db.web_kinetics k
          JOIN main_db.web_kinetic_external_checks c ON c.kinetic_id = k.kinetic_id
          GROUP BY k.reaction_id, k.biopart_id
        ) ext ON ext.reaction_id = re.reaction_id AND ext.biopart_id = re.biopart_id
        LEFT JOIN (
          SELECT entity_id AS biopart_id,
                 GROUP_CONCAT(DISTINCT CASE WHEN attribute_name = 'optimum_ph' THEN COALESCE(CAST(value_numeric AS TEXT), value_text) END) AS optimum_ph_values,
                 GROUP_CONCAT(DISTINCT CASE WHEN attribute_name = 'optimum_temperature' THEN COALESCE(CAST(value_numeric AS TEXT), value_text) END) AS optimum_temperature_values
          FROM main_db.web_attribute_evidences
          WHERE entity_type = 'enzyme' AND attribute_name IN ('optimum_ph', 'optimum_temperature')
          GROUP BY entity_id
        ) attr ON attr.biopart_id = re.biopart_id
        ORDER BY re.reaction_id, re.biopart_id;
        """
    )
    out.commit()
    out.execute("DETACH DATABASE main_db")


def export_tsv(conn: sqlite3.Connection, table: str, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    cursor = conn.execute(f"SELECT * FROM {table}")
    columns = [desc[0] for desc in cursor.description]
    with gzip.open(path, "wt", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(columns)
        for row in cursor:
            writer.writerow(["" if value is None else value for value in row])


def summarize(conn: sqlite3.Connection, files: list[Path], artifact_root: Path | None = None) -> dict[str, Any]:
    artifact_root = (artifact_root or ROOT / "web_release").resolve()
    def scalar(sql: str) -> int:
        return int(conn.execute(sql).fetchone()[0] or 0)

    summary = {
        "release": "ReactEnzDB model-ready dataset",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "tables": {
            "model_ready_reactions": scalar("SELECT COUNT(*) FROM model_ready_reactions"),
            "model_ready_reaction_compounds": scalar("SELECT COUNT(*) FROM model_ready_reaction_compounds"),
            "model_ready_enzyme_candidates": scalar("SELECT COUNT(*) FROM model_ready_enzyme_candidates"),
            "model_ready_trainable_reactions": scalar("SELECT COUNT(*) FROM model_ready_trainable_reactions"),
            "model_ready_trainable_enzyme_candidates": scalar("SELECT COUNT(*) FROM model_ready_trainable_enzyme_candidates"),
        },
        "reaction_quality": {
            "canonical_reaction_smiles": scalar("SELECT COUNT(*) FROM model_ready_reactions WHERE canonical_reaction_smiles IS NOT NULL"),
            "all_participants_have_smiles": scalar("SELECT COUNT(*) FROM model_ready_reactions WHERE all_participants_have_smiles = 1"),
            "formula_balanced": scalar("SELECT COUNT(*) FROM model_ready_reactions WHERE formula_balance_status = 'formula_balanced'"),
            "formula_unbalanced": scalar("SELECT COUNT(*) FROM model_ready_reactions WHERE formula_balance_status = 'formula_unbalanced'"),
            "formula_unknown": scalar("SELECT COUNT(*) FROM model_ready_reactions WHERE formula_balance_status = 'unknown_missing_or_unparsed_formula'"),
            "contains_currency_metabolite": scalar("SELECT COUNT(*) FROM model_ready_reactions WHERE currency_compound_count > 0"),
            "only_currency_transformation": scalar("SELECT COUNT(*) FROM model_ready_reactions WHERE only_currency_transformation = 1"),
            "default_trainable_gold": scalar("SELECT COUNT(*) FROM model_ready_trainable_reactions WHERE dataset_level = 'gold'"),
            "default_trainable_silver": scalar("SELECT COUNT(*) FROM model_ready_trainable_reactions WHERE dataset_level = 'silver'"),
        },
        "candidate_quality": {
            "with_chassis_evidence": scalar("SELECT COUNT(*) FROM model_ready_enzyme_candidates WHERE chassis_count > 0"),
            "with_kinetic_evidence": scalar("SELECT COUNT(*) FROM model_ready_enzyme_candidates WHERE kinetic_record_count > 0"),
            "with_sequence": scalar("SELECT COUNT(*) FROM model_ready_enzyme_candidates WHERE has_sequence = 1"),
            "with_structure_score": scalar("SELECT COUNT(*) FROM model_ready_enzyme_candidates WHERE structure_confidence_score > 0"),
            "with_active_site_annotation": scalar("SELECT COUNT(*) FROM model_ready_enzyme_candidates WHERE active_site_count > 0"),
            "with_brenda_exact_kinetics": scalar("SELECT COUNT(*) FROM model_ready_enzyme_candidates WHERE brenda_exact_kinetic_count > 0"),
            "with_sabio_rk_exact_kinetics": scalar("SELECT COUNT(*) FROM model_ready_enzyme_candidates WHERE sabio_rk_exact_kinetic_count > 0"),
            "with_any_external_exact_kinetics": scalar("SELECT COUNT(*) FROM model_ready_enzyme_candidates WHERE external_exact_kinetic_count > 0"),
            "with_both_external_exact_kinetics": scalar("SELECT COUNT(*) FROM model_ready_enzyme_candidates WHERE brenda_exact_kinetic_count > 0 AND sabio_rk_exact_kinetic_count > 0"),
        },
        "files": [
            {
                "file": str(path.resolve().relative_to(artifact_root)).replace("\\", "/"),
                "size": path.stat().st_size,
                "sha256": sha256(path),
            }
            for path in files
            if path.exists()
        ],
        "notes": [
            "model_ready_trainable_reactions is the default conservative training view: canonical reaction SMILES, complete participant SMILES, formula-balanced, non-currency-only, and at least one enzyme candidate.",
            "No train/validation/test split is assigned in this release per current curation scope.",
            "External kinetic confirmation counts include only match_status = matched. weak_match and EC-only statuses are retained in the core checks but do not qualify for this filter.",
            "Formula balance is computed from elemental formulae and leading numeric stoichiometry; terminal formal-charge notation is excluded from elemental counts. Charge balance is not computed in this layer.",
            "Reaction SMILES repeats participants according to positive integer stoichiometry. Unscaled fractional or excessive coefficients are not serialized as a complete reaction.",
            "Currency metabolite labels are rule-based and intended as model-training filters, not biochemical ontology assertions.",
            "Reaction SMILES preserves source left/right sides. The >> serialization does not assert irreversibility; use source_direction and normalized_direction. '=' is unspecified; bidirectional arrows retain source_bidirectional status.",
        ],
    }
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Build model-ready ReactEnzDB derived datasets.")
    parser.add_argument("--main-db", type=Path, default=DEFAULT_MAIN_DB)
    parser.add_argument("--output-db", type=Path, default=DEFAULT_OUTPUT_DB)
    parser.add_argument("--download-dir", type=Path, default=DEFAULT_DOWNLOAD_DIR)
    parser.add_argument("--summary", type=Path, default=DEFAULT_SUMMARY)
    args = parser.parse_args()

    if args.output_db.exists():
        args.output_db.unlink()
    for suffix in ("-wal", "-shm"):
        sidecar = Path(str(args.output_db) + suffix)
        if sidecar.exists():
            sidecar.unlink()

    log(f"Reading {args.main_db}")
    main_conn = connect(args.main_db)
    out_conn = connect(args.output_db)
    try:
        setup_output(out_conn)
        log("Building reaction-level model-ready tables")
        build_reaction_tables(main_conn, out_conn)
        log("Building enzyme-candidate model-ready table")
        build_candidate_table(out_conn, args.main_db)
        add_model_direction_fields(main_conn, out_conn)
        out_conn.commit()
        out_conn.execute("VACUUM")
        out_conn.commit()
        reaction_tsv = args.download_dir / "model_ready_reactions.tsv.gz"
        candidate_tsv = args.download_dir / "model_ready_enzyme_candidates.tsv.gz"
        trainable_reaction_tsv = args.download_dir / "model_ready_trainable_reactions.tsv.gz"
        log("Exporting TSV.GZ files")
        export_tsv(out_conn, "model_ready_reactions", reaction_tsv)
        export_tsv(out_conn, "model_ready_enzyme_candidates", candidate_tsv)
        export_tsv(out_conn, "model_ready_trainable_reactions", trainable_reaction_tsv)
        files = [args.output_db, reaction_tsv, candidate_tsv, trainable_reaction_tsv]
        summary = summarize(out_conn, files, args.output_db.resolve().parent)
        args.summary.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        log(json.dumps(summary["tables"], ensure_ascii=False))
        log(f"Wrote {args.output_db}")
        log(f"Wrote {args.summary}")
    finally:
        main_conn.close()
        out_conn.close()


if __name__ == "__main__":
    main()
