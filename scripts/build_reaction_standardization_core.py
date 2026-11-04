from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import re
import sqlite3
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from data_semantics import direction_fields

from rdkit import Chem, RDLogger
from rdkit.Chem import rdMolDescriptors


RDLogger.DisableLog("rdApp.*")
csv.field_size_limit(min(sys.maxsize, 2_147_483_647))

ROOT = Path(__file__).resolve().parents[1]
WORK_DB = ROOT / "reaction_standardization_work" / "reaction_standardization.sqlite"
WEB_DB = ROOT / "web_release" / "reactenzdb_web.db"
MODEL_DB = ROOT / "web_release" / "model_ready_dataset.sqlite"
SOURCE_ROOT = ROOT / "external" / "reaction_standardization"
RULE_VERSION = "REACTENZ_REACTION_STANDARDIZATION_CORE_V1"

CONNECTORS = ["<=>", "<-->", "=>", "<=", "="]
COEFFICIENT = re.compile(r"^\s*(\d+(?:\.\d+)?)\s+(.+?)\s*$")
FORMULA_TOKEN = re.compile(r"([A-Z][a-z]?)(\d*)")

EXACT_ROLE_BY_CHEBI = {
    "15378": "proton",
    "15377": "water",
    "10545": "electron",
    "15379": "small_molecule_currency",  # dioxygen
    "16526": "small_molecule_currency",  # carbon dioxide
    "16134": "small_molecule_currency",  # ammonia
    "15422": "energy_cofactor",  # ATP
    "16761": "energy_cofactor",  # ADP
    "16027": "energy_cofactor",  # AMP
    "15996": "energy_cofactor",  # GTP
    "17552": "energy_cofactor",  # GDP
    "15713": "energy_cofactor",  # UTP
    "17659": "energy_cofactor",  # UDP
    "15846": "redox_cofactor",  # NAD+
    "16908": "redox_cofactor",  # NADH
    "18009": "redox_cofactor",  # NADP+
    "16474": "redox_cofactor",  # NADPH
    "16238": "redox_cofactor",  # FAD
    "17621": "redox_cofactor",  # FMN
    "15346": "group_transfer_cofactor",  # CoA
    "15414": "group_transfer_cofactor",  # SAM
    "16680": "group_transfer_cofactor",  # SAH
    "18367": "small_molecule_currency",  # phosphate
    "18361": "small_molecule_currency",  # diphosphate
}

EXACT_ROLE_BY_NAME = {
    "h+": "proton",
    "proton": "proton",
    "water": "water",
    "h2o": "water",
    "electron": "electron",
    "e-": "electron",
    "oxygen": "small_molecule_currency",
    "o2": "small_molecule_currency",
    "carbon dioxide": "small_molecule_currency",
    "co2": "small_molecule_currency",
    "ammonia": "small_molecule_currency",
    "nh3": "small_molecule_currency",
    "atp": "energy_cofactor",
    "adp": "energy_cofactor",
    "amp": "energy_cofactor",
    "gtp": "energy_cofactor",
    "gdp": "energy_cofactor",
    "utp": "energy_cofactor",
    "udp": "energy_cofactor",
    "nad+": "redox_cofactor",
    "nadh": "redox_cofactor",
    "nadp+": "redox_cofactor",
    "nadph": "redox_cofactor",
    "fad": "redox_cofactor",
    "fadh2": "redox_cofactor",
    "fmn": "redox_cofactor",
    "coenzyme a": "group_transfer_cofactor",
    "coa": "group_transfer_cofactor",
    "s-adenosyl-l-methionine": "group_transfer_cofactor",
    "s-adenosylmethionine": "group_transfer_cofactor",
    "sam": "group_transfer_cofactor",
    "s-adenosyl-l-homocysteine": "group_transfer_cofactor",
    "s-adenosylhomocysteine": "group_transfer_cofactor",
    "sah": "group_transfer_cofactor",
    "phosphate": "small_molecule_currency",
    "orthophosphate": "small_molecule_currency",
    "diphosphate": "small_molecule_currency",
    "pyrophosphate": "small_molecule_currency",
}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_chebi(value: str | None) -> str | None:
    if not value:
        return None
    match = re.search(r"(\d+)", value)
    return match.group(1) if match else None


def normalize_name(value: str | None) -> str:
    if not value:
        return ""
    text = value.strip().lower().replace("−", "-").replace("＋", "+")
    text = re.sub(r"\s+", " ", text)
    return text


def canonical_smiles(value: str | None, isomeric: bool = True) -> tuple[str | None, Chem.Mol | None]:
    if not value:
        return None, None
    try:
        mol = Chem.MolFromSmiles(value)
        if mol is None:
            return None, None
        return Chem.MolToSmiles(mol, canonical=True, isomericSmiles=isomeric), mol
    except Exception:
        return None, None


def split_equation(equation: str | None) -> tuple[list[tuple[float, str, bool]], list[tuple[float, str, bool]], str | None]:
    if not equation:
        return [], [], None
    connector = next((item for item in CONNECTORS if item in equation), None)
    if not connector:
        return [], [], None
    left_text, right_text = equation.split(connector, 1)

    def parse_side(text: str) -> list[tuple[float, str, bool]]:
        rows = []
        for token in re.split(r"\s+\+\s+", text.strip()):
            token = token.strip()
            if not token:
                continue
            match = COEFFICIENT.match(token)
            if match:
                rows.append((float(match.group(1)), match.group(2).strip(), True))
            else:
                rows.append((1.0, token, False))
        return rows

    return parse_side(left_text), parse_side(right_text), connector


def numeric_stoichiometry(value: str | None) -> float | None:
    if not value:
        return None
    text = value.strip()
    if not re.fullmatch(r"\d+(?:\.\d+)?", text):
        return None
    parsed = float(text)
    return parsed if parsed > 0 else None


def token_assignments(tokens: list[tuple[float, str, bool]], participants: list[sqlite3.Row]) -> dict[int, tuple[float, str]]:
    assignments: dict[int, tuple[float, str]] = {}
    unused = set(range(len(tokens)))
    by_name: dict[str, list[int]] = defaultdict(list)
    for index, (_, name, _) in enumerate(tokens):
        by_name[normalize_name(name)].append(index)
    for index, participant in enumerate(participants):
        name = normalize_name(participant["compound_name"])
        matches = [item for item in by_name.get(name, []) if item in unused]
        if matches:
            token_index = matches[0]
            coefficient, _, explicit = tokens[token_index]
            assignments[index] = (coefficient, "equation_explicit" if explicit else "equation_implicit_one")
            unused.remove(token_index)
    if len(tokens) == len(participants):
        for index in range(len(participants)):
            if index in assignments:
                continue
            coefficient, _, explicit = tokens[index]
            assignments[index] = (coefficient, "equation_order_explicit" if explicit else "equation_order_implicit_one")
    return assignments


def chebi_maps(relevant: set[str]) -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
    properties: dict[str, dict[str, Any]] = {}
    structures: dict[str, tuple[int, dict[str, Any]]] = {}
    with gzip.open(SOURCE_ROOT / "chebi" / "flat_files" / "chemical_data.tsv.gz", "rt", encoding="utf-8", errors="replace", newline="") as handle:
        for row in csv.DictReader(handle, delimiter="\t"):
            cid = row.get("compound_id")
            if cid not in relevant:
                continue
            current = properties.setdefault(cid, {})
            for key in ("formula", "charge", "mass", "monoisotopic_mass"):
                if row.get(key) and not current.get(key):
                    current[key] = row[key]
    with gzip.open(SOURCE_ROOT / "chebi" / "flat_files" / "structures.tsv.gz", "rt", encoding="utf-8", errors="replace", newline="") as handle:
        for row in csv.DictReader(handle, delimiter="\t"):
            cid = row.get("compound_id")
            if cid not in relevant or not row.get("smiles"):
                continue
            priority = 2 if str(row.get("default_structure", "")).lower() == "true" else 1
            if cid not in structures or priority > structures[cid][0]:
                structures[cid] = (priority, row)
    rhea_smiles: dict[str, str] = {}
    with (SOURCE_ROOT / "rhea" / "tsv" / "rhea-chebi-smiles.tsv").open("r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            parts = line.rstrip("\n").split("\t", 1)
            if len(parts) == 2:
                cid = normalize_chebi(parts[0])
                if cid in relevant:
                    rhea_smiles[cid] = parts[1]
    for cid, (_, row) in structures.items():
        properties.setdefault(cid, {}).update(
            {
                "smiles": row.get("smiles"),
                "inchi": row.get("standard_inchi"),
                "inchikey": row.get("standard_inchi_key"),
            }
        )
    return properties, rhea_smiles


def classify_role(chebi_id: str | None, name: str | None, side: str) -> tuple[str, str, float]:
    cid = normalize_chebi(chebi_id)
    if cid and cid in EXACT_ROLE_BY_CHEBI:
        return EXACT_ROLE_BY_CHEBI[cid], "exact_chebi_role_v1", 0.98
    normalized = normalize_name(name)
    if normalized in EXACT_ROLE_BY_NAME:
        return EXACT_ROLE_BY_NAME[normalized], "exact_normalized_name_role_v1", 0.88
    return ("main_substrate" if side == "left" else "main_product"), "default_side_role_v1", 0.55


def stereo_profile(mol: Chem.Mol | None) -> tuple[str, int, int]:
    if mol is None:
        return "unknown_missing_structure", 0, 0
    try:
        entries = Chem.FindPotentialStereo(mol)
        specified = sum(str(entry.specified) != "Unspecified" for entry in entries)
        unspecified = len(entries) - specified
        return ("incomplete_unspecified" if unspecified else "complete_or_not_applicable"), specified, unspecified
    except Exception:
        return "unknown_stereo_parse_error", 0, 0


def mol_counts(mol: Chem.Mol | None) -> tuple[dict[str, float] | None, int | None, str | None]:
    if mol is None:
        return None, None, None
    formula = rdMolDescriptors.CalcMolFormula(mol)
    # RDKit appends an overall ionic charge (for example C6H7O6- or C6H6O6-2)
    # to some formulae.  It is not an elemental token and must be removed before
    # checking whether the full formula was parsed.
    formula_without_charge = re.sub(r"[+-]\d*$", "", formula)
    counts: dict[str, float] = defaultdict(float)
    consumed = ""
    for element, amount in FORMULA_TOKEN.findall(formula_without_charge):
        counts[element] += float(amount or 1)
        consumed += element + amount
    if consumed != formula_without_charge:
        return None, sum(atom.GetFormalCharge() for atom in mol.GetAtoms()), formula
    return dict(counts), sum(atom.GetFormalCharge() for atom in mol.GetAtoms()), formula


def coeff_text(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else f"{value:.8g}"


def identity_payload(participants: list[dict[str, Any]], isomeric: bool) -> tuple[str | None, str | None, str | None, str | None, str | None]:
    if not participants or any(not item.get("canonical_smiles") for item in participants):
        return None, None, None, None, None

    def side(side_name: str) -> list[tuple[str, str]]:
        values = []
        for item in participants:
            if item["side"] != side_name:
                continue
            smiles = item["canonical_smiles"] if isomeric else item["canonical_smiles_no_stereo"]
            values.append((smiles, coeff_text(item["coefficient"])))
        return sorted(values)

    left = side("left")
    right = side("right")
    if not left or not right:
        return None, None, None, None, None
    left_smiles = ".".join(item[0] for item in left)
    right_smiles = ".".join(item[0] for item in right)
    reaction_smiles = f"{left_smiles}>>{right_smiles}"
    forward = json.dumps({"left": left, "right": right}, separators=(",", ":"), ensure_ascii=False)
    reverse = json.dumps({"left": right, "right": left}, separators=(",", ":"), ensure_ascii=False)
    directional = hashlib.sha256(forward.encode("utf-8")).hexdigest()
    directionless = hashlib.sha256(min(forward, reverse).encode("utf-8")).hexdigest()
    return left_smiles, right_smiles, reaction_smiles, directional, directionless


def balance(participants: list[dict[str, Any]], core_only: bool) -> dict[str, Any]:
    excluded_roles = {"proton", "water", "electron", "small_molecule_currency", "energy_cofactor", "redox_cofactor", "group_transfer_cofactor"}
    totals = {"left": defaultdict(float), "right": defaultdict(float)}
    charges = {"left": 0.0, "right": 0.0}
    missing = []
    included = 0
    for item in participants:
        if core_only and item["participant_role"] in excluded_roles:
            continue
        included += 1
        if item["atom_counts"] is None or item["formal_charge"] is None:
            missing.append(item["participant_id"])
            continue
        coefficient = item["coefficient"]
        for element, amount in item["atom_counts"].items():
            totals[item["side"]][element] += amount * coefficient
        charges[item["side"]] += item["formal_charge"] * coefficient
    elements = sorted(set(totals["left"]) | set(totals["right"]))
    delta = {
        element: round(totals["right"].get(element, 0.0) - totals["left"].get(element, 0.0), 8)
        for element in elements
        if abs(totals["right"].get(element, 0.0) - totals["left"].get(element, 0.0)) > 1e-8
    }
    charge_delta = round(charges["right"] - charges["left"], 8)
    if not included:
        mass_status = "not_applicable_no_participants"
        charge_status = "not_applicable_no_participants"
    elif missing:
        mass_status = "unknown_missing_structure"
        charge_status = "unknown_missing_structure"
    else:
        mass_status = "balanced" if not delta else "hydrogen_only_imbalance" if set(delta) == {"H"} else "unbalanced"
        charge_status = "balanced" if abs(charge_delta) <= 1e-8 else "unbalanced"
    return {
        "mass_status": mass_status,
        "charge_status": charge_status,
        "delta": delta,
        "charge_delta": charge_delta,
        "missing": missing,
    }


def normalized_direction(source_direction: str | None) -> tuple[str, str]:
    normalized, _, rule = direction_fields(source_direction)
    return normalized, rule


def main() -> None:
    parser = argparse.ArgumentParser(description="Build ReactEnzDB core reaction identities, participant roles, stereo and balance results.")
    parser.add_argument("--work-db", type=Path, default=WORK_DB)
    parser.add_argument("--batch-size", type=int, default=500)
    args = parser.parse_args()
    web = sqlite3.connect(f"file:{WEB_DB.as_posix()}?mode=ro", uri=True)
    web.row_factory = sqlite3.Row
    model = sqlite3.connect(f"file:{MODEL_DB.as_posix()}?mode=ro", uri=True)
    model.row_factory = sqlite3.Row
    work = sqlite3.connect(args.work_db)
    work.execute("PRAGMA foreign_keys=ON")
    work.execute("PRAGMA journal_mode=WAL")
    work.execute("PRAGMA synchronous=NORMAL")
    standardized_columns = {row[1] for row in work.execute("PRAGMA table_info(standardized_reactions)")}
    for column in ("directionless_reaction_key_no_stereo", "directional_reaction_key_no_stereo"):
        if column not in standardized_columns:
            work.execute(f"ALTER TABLE standardized_reactions ADD COLUMN {column} TEXT")
    work.execute(
        "CREATE INDEX IF NOT EXISTS idx_standardized_directionless_no_stereo "
        "ON standardized_reactions(directionless_reaction_key_no_stereo)"
    )
    work.execute(
        "CREATE INDEX IF NOT EXISTS idx_standardized_directional_no_stereo "
        "ON standardized_reactions(directional_reaction_key_no_stereo)"
    )

    reaction_rows = web.execute(
        """
        SELECT r.*, ids.reactenz_reaction_id,
               (SELECT GROUP_CONCAT(mnx_reaction_id, ';') FROM web_mnx_reaction_mappings m WHERE m.reaction_id=r.reaction_id) mnx_reaction_ids
        FROM web_reactions r JOIN web_reaction_ids ids USING(reaction_id)
        ORDER BY r.reaction_id
        """
    ).fetchall()
    compound_rows = model.execute("SELECT * FROM model_ready_reaction_compounds ORDER BY reaction_id,side,position_index").fetchall()
    compounds_by_reaction: dict[str, list[sqlite3.Row]] = defaultdict(list)
    relevant_chebi: set[str] = set()
    for row in compound_rows:
        compounds_by_reaction[row["reaction_id"]].append(row)
        cid = normalize_chebi(row["chebi_id"])
        if cid:
            relevant_chebi.add(cid)
    print(f"[input] reactions={len(reaction_rows):,}; participants={len(compound_rows):,}; ChEBI ids={len(relevant_chebi):,}", flush=True)
    chebi, rhea_chebi_smiles = chebi_maps(relevant_chebi)
    print(f"[ChEBI] matched properties={len(chebi):,}; Rhea structures={len(rhea_chebi_smiles):,}", flush=True)

    work.execute("DELETE FROM qa_results WHERE check_name LIKE 'core_%'")
    # Delete child tables as well so a full rebuild remains safe after the
    # external-mapping layer has already been generated.
    for table in (
        "enzyme_assignment_boundaries", "mapping_conflicts", "cross_database_mappings",
        "reaction_centres", "atom_mappings", "balance_results", "normalized_participants",
        "standardized_reactions", "reactenz_reaction_inputs",
    ):
        work.execute(f"DELETE FROM {table}")
    work.commit()

    counters = Counter()
    for reaction_index, reaction in enumerate(reaction_rows, start=1):
        imported_at = now()
        snapshot_payload = json.dumps(dict(reaction), ensure_ascii=False, sort_keys=True, default=str)
        work.execute(
            """
            INSERT INTO reactenz_reaction_inputs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                reaction["reaction_id"], reaction["reactenz_reaction_id"], reaction["reaction_equation_display"], reaction["reaction_direction"],
                reaction["ec_number"], reaction["rhea_id"], reaction["kegg_reaction_id"], reaction["metacyc_reaction_id"], reaction["mnx_reaction_ids"],
                reaction["participant_count"], int(bool(reaction["all_participants_have_smiles"])), hashlib.sha256(snapshot_payload.encode("utf-8")).hexdigest(), imported_at,
            ),
        )
        rows = compounds_by_reaction.get(reaction["reaction_id"], [])
        left_tokens, right_tokens, connector = split_equation(reaction["reaction_equation_display"])
        side_rows = {"left": [row for row in rows if row["side"] == "left"], "right": [row for row in rows if row["side"] == "right"]}
        assignments = {"left": token_assignments(left_tokens, side_rows["left"]), "right": token_assignments(right_tokens, side_rows["right"])}
        processed: list[dict[str, Any]] = []
        for side in ("left", "right"):
            for side_index, row in enumerate(side_rows[side]):
                direct_coefficient = numeric_stoichiometry(row["stoichiometry"])
                if direct_coefficient is not None:
                    coefficient, stoich_status = direct_coefficient, "structured_numeric"
                elif side_index in assignments[side]:
                    coefficient, stoich_status = assignments[side][side_index]
                else:
                    coefficient, stoich_status = 1.0, "assumed_one_unmatched_equation"
                cid = normalize_chebi(row["chebi_id"])
                external = chebi.get(cid or "", {})
                raw_smiles = row["canonical_smiles"] or row["smiles"] or external.get("smiles") or rhea_chebi_smiles.get(cid or "")
                canonical, mol = canonical_smiles(raw_smiles, isomeric=True)
                canonical_no_stereo, _ = canonical_smiles(raw_smiles, isomeric=False)
                structure_source = "ReactEnzDB" if row["canonical_smiles"] or row["smiles"] else "ChEBI" if external.get("smiles") else "Rhea-ChEBI" if rhea_chebi_smiles.get(cid or "") else "none"
                stereo_status, stereo_specified, stereo_unspecified = stereo_profile(mol)
                atom_counts, formal_charge, calculated_formula = mol_counts(mol)
                structure_is_generic = bool(mol is not None and any(atom.GetAtomicNum() == 0 for atom in mol.GetAtoms()))
                if formal_charge is None and external.get("charge") not in (None, ""):
                    try:
                        formal_charge = int(float(external["charge"]))
                    except ValueError:
                        pass
                role, role_rule, role_confidence = classify_role(row["chebi_id"], row["compound_name"], side)
                participant_id = f"participant:{reaction['reaction_id']}:{side}:{row['position_index']}:{row['compound_id']}"
                item = {
                    "participant_id": participant_id,
                    "side": side,
                    "coefficient": coefficient,
                    "canonical_smiles": canonical,
                    "canonical_smiles_no_stereo": canonical_no_stereo,
                    "mol": mol,
                    "atom_counts": atom_counts,
                    "formal_charge": formal_charge,
                    "participant_role": role,
                    "stereo_status": stereo_status,
                    "structure_is_generic": structure_is_generic,
                }
                processed.append(item)
                work.execute(
                    """
                    INSERT INTO normalized_participants VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        participant_id, reaction["reaction_id"], side, row["position_index"], row["compound_id"], row["compound_name"], row["stoichiometry"],
                        coefficient, stoich_status, row["chebi_id"], row["mnx_compound_ids"], canonical, row["inchi"] or external.get("inchi"),
                        row["inchikey"] or external.get("inchikey"), calculated_formula or row["formula"] or external.get("formula"), formal_charge,
                        structure_source,
                        "generic_variable_structure" if structure_is_generic else "complete" if canonical else "missing_or_invalid",
                        stereo_status, role, role_rule, role_confidence,
                    ),
                )
                counters[f"stoich:{stoich_status}"] += 1
                counters[f"role:{role}"] += 1
                counters[f"stereo:{stereo_status}"] += 1

        left_smiles, right_smiles, reaction_smiles, directional_key, directionless_key = identity_payload(processed, isomeric=True)
        _, _, _, directional_no_stereo, directionless_no_stereo = identity_payload(processed, isomeric=False)
        direction_status, direction_rule = normalized_direction(reaction["reaction_direction"])
        missing_structures = sum(not item["canonical_smiles"] for item in processed)
        generic_structures = sum(item["structure_is_generic"] for item in processed)
        unspecified_stereo = sum(item["stereo_status"] == "incomplete_unspecified" for item in processed)
        structure_status = (
            "complete"
            if not missing_structures and not generic_structures and processed
            else "partial_generic_structure"
            if generic_structures and not missing_structures
            else "partial_missing_structure"
            if processed
            else "missing"
        )
        stereo_status = "unknown_missing_structure" if missing_structures else "incomplete_unspecified" if unspecified_stereo else "complete_or_not_applicable"
        standardization_status = "complete" if structure_status == "complete" and directional_key else "partial"
        work.execute(
            """
            INSERT INTO standardized_reactions(
              reaction_id,canonical_reactants_smiles,canonical_products_smiles,canonical_reaction_smiles,
              directionless_reaction_key,directional_reaction_key,
              directionless_reaction_key_no_stereo,directional_reaction_key_no_stereo,
              normalized_direction,reversibility_status,
              direction_normalization_rule,structure_completeness_status,stereo_completeness_status,
              participant_role_status,standardization_status,standardization_rule_version,updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                reaction["reaction_id"], left_smiles, right_smiles, reaction_smiles, directionless_key, directional_key,
                directionless_no_stereo, directional_no_stereo,
                direction_status, direction_fields(reaction["reaction_direction"])[1],
                direction_rule, structure_status, stereo_status, "classified_exact_rules_plus_side_default", standardization_status, RULE_VERSION, now(),
            ),
        )
        # Non-stereo identity is retained in metadata-like QA through a conflict-ready synthetic mapping evidence field later.
        for context, core_only in (("full_explicit", False), ("core_transformation", True)):
            result = balance(processed, core_only)
            work.execute(
                """
                INSERT INTO balance_results VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    f"balance:{reaction['reaction_id']}:{context}", reaction["reaction_id"], context,
                    result["mass_status"], json.dumps(result["delta"], sort_keys=True), result["charge_status"], result["charge_delta"],
                    result["delta"].get("H", 0.0), result["delta"].get("O", 0.0), 0.0, json.dumps(result["missing"], sort_keys=True),
                    "RDKit_formula_and_formal_charge_with_reparsed_stoichiometry_v1",
                    "Formal-charge balance reflects the represented protonation state; core context excludes explicitly classified cofactors/currency participants.",
                ),
            )
            counters[f"mass:{context}:{result['mass_status']}"] += 1
            counters[f"charge:{context}:{result['charge_status']}"] += 1
        counters[f"structure:{structure_status}"] += 1
        counters[f"reaction_stereo:{stereo_status}"] += 1
        if directional_key:
            counters["directional_identity"] += 1
        if directionless_key:
            counters["directionless_identity"] += 1
        if directionless_no_stereo:
            counters["directionless_identity_no_stereo"] += 1
        if reaction_index % args.batch_size == 0:
            work.commit()
            print(f"[core] {reaction_index:,}/{len(reaction_rows):,} reactions", flush=True)
    work.commit()

    eligible_identity_count = work.execute(
        """
        SELECT COUNT(*) FROM (
          SELECT reaction_id FROM normalized_participants GROUP BY reaction_id
          HAVING SUM(side='left') > 0 AND SUM(side='right') > 0
             AND SUM(canonical_smiles IS NULL) = 0
        )
        """
    ).fetchone()[0]
    checks = [
        ("core_reaction_count", len(reaction_rows), 19623, "error"),
        ("core_participant_count", len(compound_rows), 91604, "error"),
        ("core_directional_identity_count", counters["directional_identity"], eligible_identity_count, "error"),
        ("core_balance_rows", work.execute("SELECT COUNT(*) FROM balance_results").fetchone()[0], len(reaction_rows) * 2, "error"),
        ("core_invalid_side_count", work.execute("SELECT COUNT(*) FROM normalized_participants WHERE side NOT IN ('left','right')").fetchone()[0], 0, "error"),
    ]
    for name, observed, expected, severity in checks:
        passed = observed == expected
        work.execute(
            "INSERT OR REPLACE INTO qa_results VALUES (?,?,?,?,?,?,?)",
            (name, int(passed), str(observed), str(expected), severity, now(), "{}"),
        )
    work.execute("INSERT OR REPLACE INTO metadata VALUES (?,?)", ("core_build_summary_json", json.dumps(counters, ensure_ascii=False, sort_keys=True)))
    work.execute("INSERT OR REPLACE INTO metadata VALUES (?,?)", ("core_rule_version", RULE_VERSION))
    work.commit()
    print(json.dumps(dict(counters), ensure_ascii=False, indent=2, sort_keys=True), flush=True)
    web.close(); model.close(); work.close()


if __name__ == "__main__":
    main()
