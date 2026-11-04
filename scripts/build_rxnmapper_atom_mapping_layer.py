#!/usr/bin/env python3
"""Build a resumable, audited RXNMapper prediction layer for ReactEnzDB.

The script deliberately keeps predicted atom maps separate from matched
EnzymeMap maps until they pass explicit quality gates.  It supports five
repeatable phases:

  prepare    snapshot calibration and unmatched inputs into a progress DB
  run        run RXNMapper for one cohort, committing every batch
  calibrate  compare predictions with EnzymeMap and derive QA thresholds
  validate   apply the calibrated QA gates to prediction rows
  promote    copy publishable predictions/centres into the working DB
  report     write JSON/Markdown audit reports

Use the isolated ``.rxnmapper-venv`` Python for ``run``.  The other phases can
also be run with the project Python environment.
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import hashlib
import json
import math
import sqlite3
import statistics
import time
from pathlib import Path
from typing import Any, Iterable, Sequence

from rdkit import Chem, RDLogger

# Standalone mapped protons are valid reaction participants in this dataset.
# RDKit otherwise emits one warning per parse, obscuring the progress log.
RDLogger.DisableLog("rdApp.warning")


ROOT = Path(__file__).resolve().parents[1]
WORK_DB = ROOT / "reaction_standardization_work" / "reaction_standardization.sqlite"
PROGRESS_DB = ROOT / "reaction_standardization_work" / "rxnmapper_progress.sqlite"
REPORT_JSON = ROOT / "reaction_standardization_work" / "rxnmapper_audit_report.json"
REPORT_MD = ROOT / "reaction_standardization_work" / "rxnmapper_audit_report.md"
RULE_VERSION = "reactenzdb_rxnmapper_qa_v1"
MODEL_NAME = "RXNMapper"
MODEL_VERSION = "0.4.3"


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def stable_id(prefix: str, *parts: str) -> str:
    return prefix + hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()[:24]


def json_dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def connect(path: Path, readonly: bool = False) -> sqlite3.Connection:
    if readonly:
        db = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(path)
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA synchronous=NORMAL")
    db.row_factory = sqlite3.Row
    return db


def init_progress(db: sqlite3.Connection) -> None:
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS run_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS prediction_inputs (
            reaction_id TEXT PRIMARY KEY,
            reactenz_reaction_id TEXT,
            cohort TEXT NOT NULL CHECK(cohort IN ('calibration','unmatched')),
            canonical_reaction_smiles TEXT,
            source_atom_mapped_reaction_smiles TEXT,
            source_mapping_source TEXT,
            source_mass_balance_status TEXT,
            source_charge_balance_status TEXT,
            input_status TEXT NOT NULL,
            input_sha256 TEXT,
            prepared_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_prediction_inputs_cohort
            ON prediction_inputs(cohort, input_status, reaction_id);
        CREATE TABLE IF NOT EXISTS predictions (
            reaction_id TEXT PRIMARY KEY,
            cohort TEXT NOT NULL,
            mapped_reaction_smiles TEXT,
            rxnmapper_confidence REAL,
            prediction_status TEXT NOT NULL,
            error_type TEXT,
            error_text TEXT,
            runtime_ms REAL,
            model_name TEXT NOT NULL,
            model_version TEXT NOT NULL,
            input_sha256 TEXT,
            predicted_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_predictions_cohort_status
            ON predictions(cohort, prediction_status);
        CREATE TABLE IF NOT EXISTS validations (
            reaction_id TEXT PRIMARY KEY,
            parse_status TEXT NOT NULL,
            duplicate_map_numbers_left INTEGER NOT NULL,
            duplicate_map_numbers_right INTEGER NOT NULL,
            left_only_map_count INTEGER NOT NULL,
            right_only_map_count INTEGER NOT NULL,
            element_mismatch_count INTEGER NOT NULL,
            mapped_atom_count INTEGER NOT NULL,
            unmapped_atom_count INTEGER NOT NULL,
            mapped_element_balance_status TEXT NOT NULL,
            mapped_formula_mass_balance_status TEXT NOT NULL,
            source_mass_balance_status TEXT,
            source_charge_balance_status TEXT,
            broken_bond_count INTEGER NOT NULL,
            formed_bond_count INTEGER NOT NULL,
            changed_bond_count INTEGER NOT NULL,
            changed_atom_count INTEGER NOT NULL,
            changed_atom_fraction REAL,
            large_rearrangement_flag INTEGER NOT NULL,
            reaction_centre_status TEXT NOT NULL,
            quality_tier TEXT NOT NULL,
            publishable INTEGER NOT NULL,
            validation_flags_json TEXT NOT NULL,
            validation_details_json TEXT NOT NULL,
            rule_version TEXT NOT NULL,
            validated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS calibration_comparisons (
            reaction_id TEXT PRIMARY KEY,
            source_orientation TEXT NOT NULL,
            rxnmapper_pair_count INTEGER NOT NULL,
            enzymemap_pair_count INTEGER NOT NULL,
            correspondence_intersection INTEGER NOT NULL,
            correspondence_union INTEGER NOT NULL,
            correspondence_jaccard REAL,
            centre_signature_jaccard REAL,
            centre_status_agreement INTEGER NOT NULL,
            agreement_status TEXT NOT NULL,
            details_json TEXT NOT NULL,
            compared_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS promotion_log (
            reaction_id TEXT PRIMARY KEY,
            atom_mapping_id TEXT NOT NULL,
            reaction_centre_id TEXT,
            quality_tier TEXT NOT NULL,
            promoted_at TEXT NOT NULL
        );
        """
    )
    set_meta(db, "rule_version", RULE_VERSION)
    set_meta(db, "model_name", MODEL_NAME)
    set_meta(db, "model_version", MODEL_VERSION)
    set_meta(db, "progress_db_created_at", get_meta(db, "progress_db_created_at") or now())
    db.commit()


def set_meta(db: sqlite3.Connection, key: str, value: Any) -> None:
    db.execute(
        "INSERT OR REPLACE INTO run_metadata(key,value,updated_at) VALUES (?,?,?)",
        (key, json_dump(value) if not isinstance(value, str) else value, now()),
    )


def get_meta(db: sqlite3.Connection, key: str) -> str | None:
    row = db.execute("SELECT value FROM run_metadata WHERE key=?", (key,)).fetchone()
    return row[0] if row else None


def balance_lookup(work: sqlite3.Connection) -> dict[str, tuple[str, str]]:
    return {
        row["reaction_id"]: (row["mass_balance_status"], row["charge_balance_status"])
        for row in work.execute(
            "SELECT reaction_id,mass_balance_status,charge_balance_status "
            "FROM balance_results WHERE balance_context='full_explicit'"
        )
    }


def prepare_inputs(work_path: Path, progress_path: Path) -> None:
    work = connect(work_path, readonly=True)
    progress = connect(progress_path)
    init_progress(progress)
    balances = balance_lookup(work)
    rows = work.execute(
        """
        SELECT s.reaction_id,i.reactenz_reaction_id,s.canonical_reaction_smiles,
               a.atom_mapped_reaction_smiles,a.mapping_source
        FROM standardized_reactions s
        JOIN reactenz_reaction_inputs i USING(reaction_id)
        LEFT JOIN atom_mappings a USING(reaction_id)
        WHERE s.structure_completeness_status='complete'
        ORDER BY s.reaction_id
        """
    ).fetchall()
    calibration = unmatched = missing = 0
    stamp = now()
    for row in rows:
        cohort = "calibration" if row["atom_mapped_reaction_smiles"] else "unmatched"
        smiles = row["canonical_reaction_smiles"]
        input_status = "ready" if smiles and ">>" in smiles else "missing_canonical_reaction_smiles"
        mass, charge = balances.get(row["reaction_id"], ("unknown", "unknown"))
        progress.execute(
            """
            INSERT OR REPLACE INTO prediction_inputs VALUES (?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                row["reaction_id"], row["reactenz_reaction_id"], cohort, smiles,
                row["atom_mapped_reaction_smiles"], row["mapping_source"], mass, charge,
                input_status, sha256_text(smiles) if smiles else None, stamp,
            ),
        )
        calibration += cohort == "calibration"
        unmatched += cohort == "unmatched"
        missing += input_status != "ready"
    set_meta(progress, "source_work_db", str(work_path.resolve()))
    set_meta(progress, "prepared_at", stamp)
    set_meta(progress, "prepared_complete_reactions", len(rows))
    set_meta(progress, "prepared_calibration_count", calibration)
    set_meta(progress, "prepared_unmatched_count", unmatched)
    set_meta(progress, "prepared_missing_input_count", missing)
    progress.commit()
    print(
        f"Prepared {len(rows):,} complete reactions: calibration={calibration:,}, "
        f"unmatched={unmatched:,}, missing_input={missing:,}", flush=True,
    )


def chunks(rows: Sequence[sqlite3.Row], size: int) -> Iterable[Sequence[sqlite3.Row]]:
    for start in range(0, len(rows), size):
        yield rows[start : start + size]


def save_prediction(
    db: sqlite3.Connection,
    row: sqlite3.Row,
    status: str,
    mapped: str | None = None,
    confidence: float | None = None,
    runtime_ms: float | None = None,
    error: Exception | None = None,
    model_name: str = MODEL_NAME,
) -> None:
    db.execute(
        "INSERT OR REPLACE INTO predictions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            row["reaction_id"], row["cohort"], mapped, confidence, status,
            type(error).__name__ if error else None, str(error)[:4000] if error else None,
            runtime_ms, model_name, MODEL_VERSION, row["input_sha256"], now(),
        ),
    )


def stereo_stripped_reaction(reaction_smiles: str) -> str:
    sides: list[str] = []
    for raw_side in reaction_smiles.split(">>"):
        fragments: list[str] = []
        for raw in filter(None, raw_side.split(".")):
            mol = Chem.MolFromSmiles(raw)
            if mol is None:
                raise ValueError("Cannot parse a fragment while stripping stereochemistry")
            Chem.RemoveStereochemistry(mol)
            for atom in mol.GetAtoms():
                atom.SetAtomMapNum(0)
            fragments.append(Chem.MolToSmiles(mol, canonical=True, isomericSmiles=False))
        sides.append(".".join(sorted(fragments)))
    if len(sides) != 2:
        raise ValueError("Expected a two-sided reaction")
    return ">>".join(sides)


def nonisomeric_key(mol: Chem.Mol) -> str:
    copy = Chem.Mol(mol)
    Chem.RemoveStereochemistry(copy)
    for atom in copy.GetAtoms():
        atom.SetAtomMapNum(0)
    return Chem.MolToSmiles(copy, canonical=True, isomericSmiles=False)


def restore_stereo_and_maps(original_reaction: str, mapped_nonisomeric: str) -> str:
    """Transfer maps from a stereo-stripped mapping back to original molecules."""
    output_sides: list[str] = []
    for original_side, mapped_side in zip(original_reaction.split(">>"), mapped_nonisomeric.split(">>")):
        originals: list[Chem.Mol] = []
        mapped_by_key: dict[str, list[Chem.Mol]] = collections.defaultdict(list)
        for raw in filter(None, original_side.split(".")):
            mol = Chem.MolFromSmiles(raw)
            if mol is None:
                raise ValueError("Cannot parse original fragment while restoring stereochemistry")
            originals.append(mol)
        for raw in filter(None, mapped_side.split(".")):
            mol = Chem.MolFromSmiles(raw)
            if mol is None:
                raise ValueError("Cannot parse mapped fragment while restoring stereochemistry")
            mapped_by_key[nonisomeric_key(mol)].append(mol)
        restored: list[str] = []
        for original in originals:
            key = nonisomeric_key(original)
            candidates = mapped_by_key.get(key)
            if not candidates:
                raise ValueError(f"No mapped non-isomeric fragment matches original key {key[:120]}")
            mapped = candidates.pop()
            query = Chem.Mol(mapped)
            Chem.RemoveStereochemistry(query)
            for atom in query.GetAtoms():
                atom.SetAtomMapNum(0)
            target = Chem.Mol(original)
            Chem.RemoveStereochemistry(target)
            for atom in target.GetAtoms():
                atom.SetAtomMapNum(0)
            match = target.GetSubstructMatch(query, useChirality=False)
            if len(match) != query.GetNumAtoms():
                raise ValueError("Failed exact atom alignment while restoring stereochemistry")
            for query_idx, target_idx in enumerate(match):
                original.GetAtomWithIdx(target_idx).SetAtomMapNum(mapped.GetAtomWithIdx(query_idx).GetAtomMapNum())
            restored.append(Chem.MolToSmiles(original, canonical=True, isomericSmiles=True))
        if any(mapped_by_key.values()):
            raise ValueError("Mapped output contains unmatched fragments after stereo restoration")
        output_sides.append(".".join(sorted(restored)))
    if len(output_sides) != 2:
        raise ValueError("Expected two reaction sides while restoring stereochemistry")
    restored_reaction = ">>".join(output_sides)
    original_keys = tuple(side_key(side) for side in original_reaction.split(">>"))
    restored_keys = tuple(side_key(side) for side in restored_reaction.split(">>"))
    if original_keys != restored_keys:
        raise ValueError("Stereo-restored mapping does not reproduce the original reaction identity")
    return restored_reaction


def try_stereo_stripped_mapping(mapper: Any, row: sqlite3.Row) -> tuple[str, float]:
    stripped = stereo_stripped_reaction(row["canonical_reaction_smiles"])
    output = mapper.get_attention_guided_atom_maps([stripped])[0]
    restored = restore_stereo_and_maps(row["canonical_reaction_smiles"], output["mapped_rxn"])
    return restored, float(output["confidence"])


def compact_nonisomeric_reaction(mapper: Any, reaction_smiles: str, variants: int = 64) -> str:
    """Choose deterministic low-token non-isomeric SMILES for each fragment."""
    output_sides: list[str] = []
    for raw_side in reaction_smiles.split(">>"):
        compact_fragments: list[str] = []
        for raw in filter(None, raw_side.split(".")):
            mol = Chem.MolFromSmiles(raw)
            if mol is None:
                raise ValueError("Cannot parse fragment for compact non-isomeric representation")
            Chem.RemoveStereochemistry(mol)
            for atom in mol.GetAtoms():
                atom.SetAtomMapNum(0)
            candidates = [Chem.MolToSmiles(mol, canonical=True, isomericSmiles=False)]
            candidates.extend(
                Chem.MolToRandomSmilesVect(mol, variants, randomSeed=0x5EED, isomericSmiles=False)
            )
            best = min(
                candidates,
                key=lambda value: (len(mapper.tokenizer.basic_tokenizer.tokenize(value)), len(value), value),
            )
            compact_fragments.append(best)
        output_sides.append(".".join(sorted(compact_fragments)))
    if len(output_sides) != 2:
        raise ValueError("Expected a two-sided reaction")
    return ">>".join(output_sides)


def try_compact_nonisomeric_mapping(mapper: Any, row: sqlite3.Row) -> tuple[str, float]:
    compact = compact_nonisomeric_reaction(mapper, row["canonical_reaction_smiles"])
    output = mapper.get_attention_guided_atom_maps([compact], canonicalize_rxns=False)[0]
    restored = restore_stereo_and_maps(row["canonical_reaction_smiles"], output["mapped_rxn"])
    return restored, float(output["confidence"])


def run_batch_resilient(mapper: Any, db: sqlite3.Connection, batch: Sequence[sqlite3.Row]) -> None:
    started = time.perf_counter()
    try:
        outputs = mapper.get_attention_guided_atom_maps([row["canonical_reaction_smiles"] for row in batch])
        if len(outputs) != len(batch):
            raise RuntimeError(f"RXNMapper returned {len(outputs)} outputs for {len(batch)} inputs")
        elapsed = (time.perf_counter() - started) * 1000.0
        per_row = elapsed / max(len(batch), 1)
        for row, output in zip(batch, outputs):
            save_prediction(
                db, row, "success", output.get("mapped_rxn"),
                float(output.get("confidence")) if output.get("confidence") is not None else None,
                per_row,
            )
    except Exception as exc:
        if len(batch) > 1:
            mid = len(batch) // 2
            run_batch_resilient(mapper, db, batch[:mid])
            run_batch_resilient(mapper, db, batch[mid:])
        else:
            row = batch[0]
            if "at most 512" in str(exc) or "maximum sequence length" in str(exc):
                try:
                    mapped, confidence = try_stereo_stripped_mapping(mapper, row)
                    save_prediction(
                        db, row, "success", mapped=mapped, confidence=confidence,
                        runtime_ms=(time.perf_counter() - started) * 1000.0,
                        model_name="RXNMapper-stereo-stripped-stereo-restored",
                    )
                    return
                except Exception as fallback_exc:
                    try:
                        mapped, confidence = try_compact_nonisomeric_mapping(mapper, row)
                        save_prediction(
                            db, row, "success", mapped=mapped, confidence=confidence,
                            runtime_ms=(time.perf_counter() - started) * 1000.0,
                            model_name="RXNMapper-compact-nonisomeric-stereo-restored",
                        )
                        return
                    except Exception as compact_exc:
                        exc = RuntimeError(
                            f"direct={exc}; stereo_stripped_fallback={fallback_exc}; "
                            f"compact_nonisomeric_fallback={compact_exc}"
                        )
            save_prediction(db, row, "error", runtime_ms=(time.perf_counter() - started) * 1000.0, error=exc)


def run_predictions(
    progress_path: Path,
    cohort: str,
    batch_size: int,
    limit: int | None,
    retry_errors: bool = False,
) -> None:
    from rxnmapper import RXNMapper

    db = connect(progress_path)
    init_progress(db)
    error_clause = " OR p.prediction_status='error'" if retry_errors else ""
    query = f"""
        SELECT i.* FROM prediction_inputs i
        LEFT JOIN predictions p USING(reaction_id)
        WHERE i.cohort=? AND i.input_status='ready'
          AND (p.reaction_id IS NULL OR p.input_sha256<>i.input_sha256{error_clause})
        ORDER BY LENGTH(i.canonical_reaction_smiles),i.reaction_id
    """
    rows = db.execute(query, (cohort,)).fetchall()
    if limit is not None:
        rows = rows[:limit]
    if not rows:
        print(f"No pending {cohort} inputs.", flush=True)
        return
    mapper = RXNMapper()
    print(f"Running {len(rows):,} pending {cohort} inputs (batch_size={batch_size})", flush=True)
    completed_before = db.execute(
        "SELECT COUNT(*) FROM predictions WHERE cohort=? AND prediction_status='success'", (cohort,)
    ).fetchone()[0]
    t0 = time.perf_counter()
    for batch_no, batch in enumerate(chunks(rows, batch_size), 1):
        run_batch_resilient(mapper, db, batch)
        db.commit()
        done = min(batch_no * batch_size, len(rows))
        if batch_no == 1 or batch_no % 20 == 0 or done == len(rows):
            rate = done / max(time.perf_counter() - t0, 1e-6)
            errors = db.execute(
                "SELECT COUNT(*) FROM predictions WHERE cohort=? AND prediction_status='error'", (cohort,)
            ).fetchone()[0]
            print(f"[{cohort}] this_run={done:,}/{len(rows):,}; rate={rate:.2f}/s; errors={errors:,}", flush=True)
    success = db.execute(
        "SELECT COUNT(*) FROM predictions WHERE cohort=? AND prediction_status='success'", (cohort,)
    ).fetchone()[0]
    set_meta(db, f"{cohort}_last_run_at", now())
    set_meta(db, f"{cohort}_success_count", success)
    set_meta(db, f"{cohort}_added_in_last_run", success - completed_before)
    db.commit()


def parse_side(raw: str) -> dict[str, Any]:
    atoms: dict[int, tuple[int, int]] = {}
    bonds: dict[tuple[int, int], str] = {}
    duplicate: set[int] = set()
    unnumbered = 0
    element_counts: collections.Counter[str] = collections.Counter()
    formula_counts: collections.Counter[str] = collections.Counter()
    parse_errors: list[str] = []
    mols: list[Chem.Mol] = []
    for frag in filter(None, raw.split(".")):
        mol = Chem.MolFromSmiles(frag)
        if mol is None:
            parse_errors.append(frag[:200])
            continue
        mols.append(mol)
        for atom in mol.GetAtoms():
            symbol = atom.GetSymbol()
            element_counts[symbol] += 1
            formula_counts[symbol] += 1
            if symbol != "H":
                formula_counts["H"] += int(atom.GetTotalNumHs(includeNeighbors=False))
            amap = atom.GetAtomMapNum()
            if not amap:
                unnumbered += 1
            elif amap in atoms:
                duplicate.add(amap)
            else:
                atoms[amap] = (atom.GetAtomicNum(), atom.GetFormalCharge())
        for bond in mol.GetBonds():
            a = bond.GetBeginAtom().GetAtomMapNum()
            b = bond.GetEndAtom().GetAtomMapNum()
            if a and b:
                bonds[tuple(sorted((a, b)))] = str(bond.GetBondType())
    return {
        "atoms": atoms, "bonds": bonds, "duplicate": duplicate, "unnumbered": unnumbered,
        "element_counts": element_counts, "formula_counts": formula_counts,
        "parse_errors": parse_errors, "mols": mols,
    }


def delta_status(left: collections.Counter[str], right: collections.Counter[str]) -> tuple[str, dict[str, int]]:
    delta = {key: int(right[key] - left[key]) for key in sorted(set(left) | set(right)) if right[key] != left[key]}
    if not delta:
        return "balanced", {}
    if set(delta) <= {"H"}:
        return "hydrogen_only_imbalance", delta
    return "unbalanced", delta


def mapped_validation(mapped: str | None) -> dict[str, Any]:
    blank = {
        "parse_status": "invalid", "duplicate_left": 0, "duplicate_right": 0,
        "left_only": 0, "right_only": 0, "element_mismatch": 0,
        "mapped": 0, "unmapped": 0, "mapped_element_balance_status": "not_computable",
        "mapped_formula_mass_balance_status": "not_computable", "broken": [], "formed": [],
        "changed_bonds": [], "changed_atoms": [], "changed_atom_fraction": None,
        "reaction_centre_status": "not_computable", "flags": [], "details": {},
    }
    if not mapped or ">>" not in mapped:
        blank["flags"] = ["missing_mapped_reaction_or_separator"]
        return blank
    left_raw, right_raw = mapped.split(">>", 1)
    left, right = parse_side(left_raw), parse_side(right_raw)
    if left["parse_errors"] or right["parse_errors"]:
        blank["flags"] = ["mapped_smiles_parse_failure"]
        blank["details"] = {"left_parse_errors": left["parse_errors"], "right_parse_errors": right["parse_errors"]}
        return blank
    la, ra = left["atoms"], right["atoms"]
    lb, rb = left["bonds"], right["bonds"]
    common = set(la) & set(ra)
    left_only, right_only = set(la) - set(ra), set(ra) - set(la)
    mismatches = sorted(n for n in common if la[n][0] != ra[n][0])
    broken = [[*pair, bond] for pair, bond in lb.items() if pair not in rb]
    formed = [[*pair, bond] for pair, bond in rb.items() if pair not in lb]
    changed_bonds = [[*pair, lb[pair], rb[pair]] for pair in set(lb) & set(rb) if lb[pair] != rb[pair]]
    changed_atoms = {n for row in broken + formed + changed_bonds for n in row[:2]}
    atom_state_changes = sorted(n for n in common if la[n] != ra[n])
    changed_atoms.update(atom_state_changes)
    element_status, element_delta = delta_status(left["element_counts"], right["element_counts"])
    formula_status, formula_delta = delta_status(left["formula_counts"], right["formula_counts"])
    flags: list[str] = []
    if left["duplicate"] or right["duplicate"]:
        flags.append("duplicate_atom_map_numbers")
    if left_only or right_only:
        flags.append("side_specific_atom_map_numbers")
    if mismatches:
        flags.append("mapped_element_type_mismatch")
    if element_status != "balanced":
        flags.append("mapped_explicit_element_imbalance")
    if formula_status != "balanced":
        flags.append("mapped_formula_mass_imbalance")
    if left["unnumbered"] or right["unnumbered"]:
        flags.append("unnumbered_atoms")
    if not changed_atoms:
        flags.append("no_reaction_centre_detected")
    structural_ok = bool(common) and not left["duplicate"] and not right["duplicate"] and not mismatches
    parse_status = "valid" if structural_ok and not left_only and not right_only else "valid_with_warnings" if common else "invalid"
    return {
        "parse_status": parse_status,
        "duplicate_left": len(left["duplicate"]), "duplicate_right": len(right["duplicate"]),
        "left_only": len(left_only), "right_only": len(right_only), "element_mismatch": len(mismatches),
        "mapped": len(common), "unmapped": left["unnumbered"] + right["unnumbered"] + len(left_only) + len(right_only),
        "mapped_element_balance_status": element_status,
        "mapped_formula_mass_balance_status": formula_status,
        "broken": broken, "formed": formed, "changed_bonds": changed_bonds,
        "changed_atoms": sorted(changed_atoms),
        "changed_atom_fraction": len(changed_atoms) / max(len(common), 1),
        "reaction_centre_status": "extracted" if changed_atoms else "no_change_detected",
        "flags": flags,
        "details": {
            "left_only_maps": sorted(left_only), "right_only_maps": sorted(right_only),
            "element_mismatch_maps": mismatches, "mapped_element_delta": element_delta,
            "mapped_formula_delta": formula_delta, "atom_state_change_maps": atom_state_changes,
            "left_duplicate_maps": sorted(left["duplicate"]), "right_duplicate_maps": sorted(right["duplicate"]),
            "left_only_elements": sorted(la[n][0] for n in left_only),
            "right_only_elements": sorted(ra[n][0] for n in right_only),
        },
    }


def side_key(raw: str) -> str | None:
    values: list[str] = []
    for frag in filter(None, raw.split(".")):
        mol = Chem.MolFromSmiles(frag)
        if mol is None:
            return None
        for atom in mol.GetAtoms():
            atom.SetAtomMapNum(0)
        values.append(Chem.MolToSmiles(mol, canonical=True, isomericSmiles=True))
    return ".".join(sorted(values))


def orient_mapping(mapped: str, reference: str) -> tuple[str, str]:
    if ">>" not in mapped or ">>" not in reference:
        return mapped, "not_computable"
    ml, mr = mapped.split(">>", 1)
    rl, rr = reference.split(">>", 1)
    mk = (side_key(ml), side_key(mr))
    rk = (side_key(rl), side_key(rr))
    if mk == rk:
        return mapped, "same"
    if mk == (rk[1], rk[0]):
        return f"{mr}>>{ml}", "reversed"
    return mapped, "structure_order_unresolved"


def canonical_atom_ranks(raw: str) -> tuple[list[tuple[int, int, int]], dict[int, tuple[int, int]]]:
    """Return (rank, atomic number, map number) and map->(rank,atomic number)."""
    mol = Chem.MolFromSmiles(raw)
    if mol is None:
        return [], {}
    maps = [atom.GetAtomMapNum() for atom in mol.GetAtoms()]
    for atom in mol.GetAtoms():
        atom.SetAtomMapNum(0)
    ranks = list(Chem.CanonicalRankAtoms(mol, breakTies=True, includeChirality=True))
    triples = [(int(rank), atom.GetAtomicNum(), int(amap)) for rank, atom, amap in zip(ranks, mol.GetAtoms(), maps)]
    return triples, {amap: (rank, z) for rank, z, amap in triples if amap}


def correspondence_pairs(mapped: str) -> set[tuple[int, int, int]]:
    if ">>" not in mapped:
        return set()
    left_raw, right_raw = mapped.split(">>", 1)
    _, left = canonical_atom_ranks(left_raw)
    _, right = canonical_atom_ranks(right_raw)
    return {(left[n][0], right[n][0], left[n][1]) for n in set(left) & set(right) if left[n][1] == right[n][1]}


def centre_signature(mapped: str) -> set[tuple[Any, ...]]:
    """Mapping-number-independent, element/bond-level reaction-centre signature."""
    if ">>" not in mapped:
        return set()
    left_raw, right_raw = mapped.split(">>", 1)
    left, right = parse_side(left_raw), parse_side(right_raw)
    if left["parse_errors"] or right["parse_errors"]:
        return set()
    la, ra, lb, rb = left["atoms"], right["atoms"], left["bonds"], right["bonds"]
    result: set[tuple[Any, ...]] = set()
    for pair, bond in lb.items():
        if pair not in rb and pair[0] in la and pair[1] in la:
            zs = tuple(sorted((la[pair[0]][0], la[pair[1]][0])))
            result.add(("broken", *zs, bond))
    for pair, bond in rb.items():
        if pair not in lb and pair[0] in ra and pair[1] in ra:
            zs = tuple(sorted((ra[pair[0]][0], ra[pair[1]][0])))
            result.add(("formed", *zs, bond))
    for pair in set(lb) & set(rb):
        if lb[pair] != rb[pair] and pair[0] in la and pair[1] in la:
            zs = tuple(sorted((la[pair[0]][0], la[pair[1]][0])))
            result.add(("order", *zs, lb[pair], rb[pair]))
    return result


def jaccard(a: set[Any], b: set[Any]) -> float | None:
    union = a | b
    if not union:
        return 1.0 if not a and not b else None
    return len(a & b) / len(union)


def quantile(values: Sequence[float], q: float) -> float:
    clean = sorted(float(v) for v in values if v is not None and math.isfinite(float(v)))
    if not clean:
        raise ValueError("Cannot calculate a quantile from an empty sequence")
    pos = (len(clean) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    if lo == hi:
        return clean[lo]
    return clean[lo] * (hi - pos) + clean[hi] * (pos - lo)


def compare_calibration(db: sqlite3.Connection) -> None:
    rows = db.execute(
        """
        SELECT i.reaction_id,i.canonical_reaction_smiles,i.source_atom_mapped_reaction_smiles,
               p.mapped_reaction_smiles
        FROM prediction_inputs i JOIN predictions p USING(reaction_id)
        WHERE i.cohort='calibration' AND p.prediction_status='success'
        """
    ).fetchall()
    for row in rows:
        source, orientation = orient_mapping(row["source_atom_mapped_reaction_smiles"], row["canonical_reaction_smiles"])
        predicted, _ = orient_mapping(row["mapped_reaction_smiles"], row["canonical_reaction_smiles"])
        source_pairs, predicted_pairs = correspondence_pairs(source), correspondence_pairs(predicted)
        source_centre, predicted_centre = centre_signature(source), centre_signature(predicted)
        pair_j = jaccard(source_pairs, predicted_pairs)
        centre_j = jaccard(source_centre, predicted_centre)
        centre_agreement = int(bool(source_centre) == bool(predicted_centre))
        if pair_j is not None and pair_j >= 0.95 and (centre_j is None or centre_j >= 0.95):
            status = "strong_agreement"
        elif centre_j is not None and centre_j >= 0.8:
            status = "centre_agreement_mapping_ambiguity"
        elif not source_centre and not predicted_centre:
            status = "agrees_no_detectable_centre"
        else:
            status = "disagreement_review_required"
        db.execute(
            "INSERT OR REPLACE INTO calibration_comparisons VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                row["reaction_id"], orientation, len(predicted_pairs), len(source_pairs),
                len(predicted_pairs & source_pairs), len(predicted_pairs | source_pairs), pair_j,
                centre_j, centre_agreement, status,
                json_dump({"rxnmapper_centre_signature": sorted(predicted_centre), "enzymemap_centre_signature": sorted(source_centre)}),
                now(),
            ),
        )
    db.commit()


def derive_thresholds(db: sqlite3.Connection) -> dict[str, float]:
    good = db.execute(
        """
        SELECT p.rxnmapper_confidence,v.changed_atom_fraction,
               (v.broken_bond_count+v.formed_bond_count+v.changed_bond_count) AS bond_changes
        FROM predictions p JOIN validations v USING(reaction_id)
        JOIN calibration_comparisons c USING(reaction_id)
        WHERE p.cohort='calibration' AND p.prediction_status='success'
          AND c.agreement_status IN ('strong_agreement','centre_agreement_mapping_ambiguity','agrees_no_detectable_centre')
          AND v.parse_status IN ('valid','valid_with_warnings')
        """
    ).fetchall()
    confidences = [r["rxnmapper_confidence"] for r in good if r["rxnmapper_confidence"] is not None]
    fractions = [r["changed_atom_fraction"] for r in good if r["changed_atom_fraction"] is not None]
    bonds = [float(r["bond_changes"]) for r in good]
    # RXNMapper confidence is not linearly calibrated across reaction sizes.
    # Select the lowest coarse threshold whose cumulative EnzymeMap agreement
    # precision reaches 88% while retaining at least 25% of the calibration set.
    # Coarse bins prevent a single record from overfitting the threshold.
    target_precision = 0.88
    minimum_coverage = 0.25
    confidence_min = 0.80
    selected_precision = 0.0
    selected_coverage = 0.0
    calibration_total = db.execute(
        "SELECT COUNT(*) FROM predictions WHERE cohort='calibration' AND prediction_status='success'"
    ).fetchone()[0]
    for candidate in (0.50, 0.60, 0.70, 0.80, 0.90, 0.95):
        aggregate = db.execute(
            """
            SELECT COUNT(*),
                   SUM(c.agreement_status!='disagreement_review_required')
            FROM predictions p JOIN calibration_comparisons c USING(reaction_id)
            WHERE p.cohort='calibration' AND p.prediction_status='success'
              AND p.rxnmapper_confidence>=?
            """, (candidate,),
        ).fetchone()
        retained, agrees = int(aggregate[0] or 0), int(aggregate[1] or 0)
        precision = agrees / max(retained, 1)
        coverage = retained / max(calibration_total, 1)
        if precision >= target_precision and coverage >= minimum_coverage:
            confidence_min = candidate
            selected_precision = precision
            selected_coverage = coverage
            break
    thresholds = {
        "confidence_min": confidence_min,
        "confidence_calibration_target_precision": target_precision,
        "confidence_calibration_observed_precision": selected_precision,
        "confidence_calibration_observed_coverage": selected_coverage,
        "large_rearrangement_changed_atom_fraction": max(0.35, quantile(fractions, 0.99)) if fractions else 0.50,
        "large_rearrangement_bond_changes": max(12.0, quantile(bonds, 0.99)) if bonds else 12.0,
        "calibration_good_count": float(len(good)),
    }
    set_meta(db, "calibrated_thresholds", thresholds)
    set_meta(db, "calibrated_at", now())
    db.commit()
    return thresholds


def load_thresholds(db: sqlite3.Connection, allow_default: bool = False) -> dict[str, float]:
    raw = get_meta(db, "calibrated_thresholds")
    if raw:
        return {k: float(v) for k, v in json.loads(raw).items()}
    if allow_default:
        return {
            "confidence_min": 0.80,
            "large_rearrangement_changed_atom_fraction": 0.50,
            "large_rearrangement_bond_changes": 12.0,
        }
    raise RuntimeError("Calibration thresholds are missing; run calibration first.")


def validate_predictions(progress_path: Path, cohort: str, allow_default_thresholds: bool = False) -> None:
    db = connect(progress_path)
    init_progress(db)
    thresholds = load_thresholds(db, allow_default=allow_default_thresholds)
    rows = db.execute(
        """
        SELECT i.*,p.mapped_reaction_smiles,p.rxnmapper_confidence,p.prediction_status,p.model_name
        FROM prediction_inputs i JOIN predictions p USING(reaction_id)
        WHERE i.cohort=? AND p.prediction_status='success'
        ORDER BY i.reaction_id
        """, (cohort,),
    ).fetchall()
    for n, row in enumerate(rows, 1):
        val = mapped_validation(row["mapped_reaction_smiles"])
        bond_change_count = len(val["broken"]) + len(val["formed"]) + len(val["changed_bonds"])
        fraction = val["changed_atom_fraction"] or 0.0
        large = int(
            (len(val["changed_atoms"]) >= 8 and fraction > thresholds["large_rearrangement_changed_atom_fraction"])
            or bond_change_count > thresholds["large_rearrangement_bond_changes"]
        )
        flags = list(val["flags"])
        side_only_atomic_numbers = val["details"].get("left_only_elements", []) + val["details"].get("right_only_elements", [])
        side_only_hydrogen_only = bool(side_only_atomic_numbers) and set(side_only_atomic_numbers) <= {1}
        side_only_heavy_atom_count = sum(atomic_number != 1 for atomic_number in side_only_atomic_numbers)
        if side_only_hydrogen_only:
            flags.append("side_specific_hydrogen_map_only")
        if row["model_name"] in {
            "RXNMapper-stereo-stripped-stereo-restored",
            "RXNMapper-compact-nonisomeric-stereo-restored",
        }:
            flags.append("stereo_stripped_for_model_then_original_stereo_restored")
        if row["model_name"] == "RXNMapper-compact-nonisomeric-stereo-restored":
            flags.append("compact_noncanonical_model_input")
        if large:
            flags.append("abnormal_large_scale_atom_rearrangement")
        source_mass = row["source_mass_balance_status"] or "unknown"
        source_charge = row["source_charge_balance_status"] or "unknown"
        structural_failure = (
            val["parse_status"] == "invalid" or val["duplicate_left"] or val["duplicate_right"]
            or side_only_heavy_atom_count or val["element_mismatch"]
        )
        if structural_failure:
            quality, publishable = "rejected_structural_mapping", 0
        elif val["mapped_formula_mass_balance_status"] not in {"balanced", "hydrogen_only_imbalance"}:
            quality, publishable = "review_mapped_mass_imbalance", 0
        elif source_mass not in {"balanced", "hydrogen_only_imbalance"}:
            quality, publishable = "review_source_mass_imbalance", 0
            flags.append("source_reaction_not_mass_balanced")
        elif large:
            quality, publishable = "review_large_rearrangement", 0
        elif val["reaction_centre_status"] != "extracted":
            quality, publishable = "review_no_explicit_reaction_centre", 0
        elif row["rxnmapper_confidence"] is None or row["rxnmapper_confidence"] < thresholds["confidence_min"]:
            quality, publishable = "review_low_model_confidence", 0
        elif (
            source_mass == "hydrogen_only_imbalance"
            or val["mapped_formula_mass_balance_status"] == "hydrogen_only_imbalance"
            or side_only_hydrogen_only
        ):
            quality, publishable = "accepted_with_hydrogen_mapping_or_balance_warning", 1
        else:
            quality, publishable = "accepted_high_confidence", 1
        details = dict(val["details"])
        details.update({
            "confidence_threshold": thresholds["confidence_min"],
            "large_rearrangement_fraction_threshold": thresholds["large_rearrangement_changed_atom_fraction"],
            "large_rearrangement_bond_threshold": thresholds["large_rearrangement_bond_changes"],
            "side_specific_heavy_atom_count": side_only_heavy_atom_count,
            "side_specific_hydrogen_only": side_only_hydrogen_only,
            "prediction_variant": row["model_name"],
        })
        db.execute(
            "INSERT OR REPLACE INTO validations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                row["reaction_id"], val["parse_status"], val["duplicate_left"], val["duplicate_right"],
                val["left_only"], val["right_only"], val["element_mismatch"], val["mapped"], val["unmapped"],
                val["mapped_element_balance_status"], val["mapped_formula_mass_balance_status"], source_mass,
                source_charge, len(val["broken"]), len(val["formed"]), len(val["changed_bonds"]),
                len(val["changed_atoms"]), val["changed_atom_fraction"], large, val["reaction_centre_status"],
                quality, publishable, json_dump(sorted(set(flags))), json_dump(details), RULE_VERSION, now(),
            ),
        )
        if n % 1000 == 0:
            db.commit()
            print(f"Validated {n:,}/{len(rows):,} {cohort}", flush=True)
    db.commit()
    print(f"Validated {len(rows):,} {cohort} predictions.", flush=True)


def calibrate(progress_path: Path) -> dict[str, float]:
    db = connect(progress_path)
    init_progress(db)
    # First-pass metrics use conservative defaults; final thresholds are then
    # derived exclusively from records agreeing with EnzymeMap.
    validate_predictions(progress_path, "calibration", allow_default_thresholds=True)
    compare_calibration(db)
    thresholds = derive_thresholds(db)
    validate_predictions(progress_path, "calibration")
    print("Calibrated thresholds:", json.dumps(thresholds, indent=2), flush=True)
    return thresholds


def promote(work_path: Path, progress_path: Path) -> None:
    progress = connect(progress_path, readonly=True)
    work = connect(work_path)
    work.execute("PRAGMA foreign_keys=ON")
    rows = progress.execute(
        """
        SELECT i.reaction_id,p.mapped_reaction_smiles,p.rxnmapper_confidence,
               v.*,p.model_version
        FROM prediction_inputs i JOIN predictions p USING(reaction_id)
        JOIN validations v USING(reaction_id)
        WHERE i.cohort='unmatched' AND p.prediction_status='success' AND v.publishable=1
        ORDER BY i.reaction_id
        """
    ).fetchall()
    promoted = connect(progress_path)
    for n, row in enumerate(rows, 1):
        val = mapped_validation(row["mapped_reaction_smiles"])
        mapping_id = f"atommap:{row['reaction_id']}:rxnmapper"
        centre_id = f"centre:{row['reaction_id']}:rxnmapper" if val["changed_atoms"] else None
        flags = json.loads(row["validation_flags_json"])
        work.execute(
            "INSERT OR REPLACE INTO atom_mappings VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                mapping_id, row["reaction_id"], row["mapped_reaction_smiles"],
                "attention_guided_atom_mapping", "ReactEnzDB-RXNMapper-predicted",
                row["mapped_atom_count"], row["unmapped_atom_count"],
                row["mapped_atom_count"] / max(row["mapped_atom_count"] + row["unmapped_atom_count"], 1),
                row["rxnmapper_confidence"], "validated_predicted",
                json_dump({"flags": flags, "quality_tier": row["quality_tier"], "rule_version": RULE_VERSION,
                           "prediction_model": f"RXNMapper {row['model_version']}"}),
                None, now(),
            ),
        )
        if centre_id:
            centre_smarts = ".".join(f"[*:{number}]" for number in val["changed_atoms"])
            work.execute(
                "INSERT OR REPLACE INTO reaction_centres VALUES (?,?,?,?,?,?,?,?,?,?)",
                (
                    centre_id, mapping_id, json_dump(val["changed_atoms"]), json_dump(val["broken"]),
                    json_dump(val["formed"]), json_dump(val["changed_bonds"]), centre_smarts, None,
                    "rxnmapper_bond_and_atom_state_difference_v1", "extracted",
                ),
            )
        promoted.execute(
            "INSERT OR REPLACE INTO promotion_log VALUES (?,?,?,?,?)",
            (row["reaction_id"], mapping_id, centre_id, row["quality_tier"], now()),
        )
        if n % 1000 == 0:
            work.commit(); promoted.commit(); print(f"Promoted {n:,}/{len(rows):,}", flush=True)
    work.execute("INSERT OR REPLACE INTO metadata(key,value) VALUES (?,?)", ("rxnmapper_prediction_rule_version", RULE_VERSION))
    work.execute("INSERT OR REPLACE INTO metadata(key,value) VALUES (?,?)", ("rxnmapper_prediction_promoted_at", now()))
    work.execute("INSERT OR REPLACE INTO metadata(key,value) VALUES (?,?)", ("rxnmapper_prediction_promoted_count", str(len(rows))))
    calibration_count = progress.execute("SELECT COUNT(*) FROM calibration_comparisons").fetchone()[0]
    unmatched_total = progress.execute("SELECT COUNT(*) FROM prediction_inputs WHERE cohort='unmatched'").fetchone()[0]
    unmatched_success = progress.execute(
        "SELECT COUNT(*) FROM predictions WHERE cohort='unmatched' AND prediction_status='success'"
    ).fetchone()[0]
    unmatched_error = progress.execute(
        "SELECT COUNT(*) FROM predictions WHERE cohort='unmatched' AND prediction_status='error'"
    ).fetchone()[0]
    unmatched_missing = progress.execute(
        "SELECT COUNT(*) FROM prediction_inputs WHERE cohort='unmatched' AND input_status!='ready'"
    ).fetchone()[0]
    publishable_validation_failures = progress.execute(
        """
        SELECT COUNT(*) FROM validations
        WHERE publishable=1 AND (
          duplicate_map_numbers_left>0 OR duplicate_map_numbers_right>0 OR element_mismatch_count>0
          OR reaction_centre_status!='extracted' OR large_rearrangement_flag>0
        )
        """
    ).fetchone()[0]
    qa_checks = [
        ("rxnmapper_calibration_coverage", calibration_count == 1844, calibration_count, 1844,
         {"meaning": "Every existing EnzymeMap mapping has an RXNMapper calibration comparison."}),
        ("rxnmapper_unmatched_accounting", unmatched_total == unmatched_success + unmatched_error + unmatched_missing,
         unmatched_success + unmatched_error + unmatched_missing, unmatched_total,
         {"success": unmatched_success, "model_error": unmatched_error, "missing_input": unmatched_missing}),
        ("rxnmapper_publishable_validation_gate", publishable_validation_failures == 0,
         publishable_validation_failures, 0,
         {"meaning": "Published predictions have no duplicate maps, element mismatch, large rearrangement, or missing centre."}),
        ("rxnmapper_promotion_count", len(rows) == promoted.execute("SELECT COUNT(*) FROM promotion_log").fetchone()[0],
         promoted.execute("SELECT COUNT(*) FROM promotion_log").fetchone()[0], len(rows), {}),
    ]
    for check_name, passed, observed, expected, details in qa_checks:
        work.execute(
            "INSERT OR REPLACE INTO qa_results VALUES (?,?,?,?,?,?,?)",
            (check_name, int(passed), str(observed), str(expected), "error", now(), json_dump(details)),
        )
    work.commit(); promoted.commit()
    print(f"Promoted {len(rows):,} publishable RXNMapper predictions.", flush=True)


def grouped_counts(db: sqlite3.Connection, sql: str, params: tuple[Any, ...] = ()) -> dict[str, int]:
    return {str(row[0]): int(row[1]) for row in db.execute(sql, params)}


def build_report(progress_path: Path, json_path: Path, md_path: Path) -> dict[str, Any]:
    db = connect(progress_path, readonly=True)
    report: dict[str, Any] = {
        "generated_at": now(), "rule_version": RULE_VERSION, "model": f"{MODEL_NAME} {MODEL_VERSION}",
        "inputs": grouped_counts(db, "SELECT cohort||':'||input_status,COUNT(*) FROM prediction_inputs GROUP BY 1"),
        "predictions": grouped_counts(db, "SELECT cohort||':'||prediction_status,COUNT(*) FROM predictions GROUP BY 1"),
        "quality_tiers": grouped_counts(db, "SELECT quality_tier,COUNT(*) FROM validations GROUP BY quality_tier ORDER BY COUNT(*) DESC"),
        "unmatched_quality_tiers": grouped_counts(db, "SELECT v.quality_tier,COUNT(*) FROM validations v JOIN prediction_inputs i USING(reaction_id) WHERE i.cohort='unmatched' GROUP BY v.quality_tier ORDER BY COUNT(*) DESC"),
        "calibration_quality_tiers": grouped_counts(db, "SELECT v.quality_tier,COUNT(*) FROM validations v JOIN prediction_inputs i USING(reaction_id) WHERE i.cohort='calibration' GROUP BY v.quality_tier ORDER BY COUNT(*) DESC"),
        "validation_flags": {},
        "calibration_agreement": grouped_counts(db, "SELECT agreement_status,COUNT(*) FROM calibration_comparisons GROUP BY agreement_status"),
        "thresholds": json.loads(get_meta(db, "calibrated_thresholds") or "{}"),
        "promotion_count": db.execute("SELECT COUNT(*) FROM promotion_log").fetchone()[0],
    }
    flags: collections.Counter[str] = collections.Counter()
    for row in db.execute("SELECT validation_flags_json FROM validations"):
        flags.update(json.loads(row[0]))
    report["validation_flags"] = dict(flags.most_common())
    calibration = db.execute(
        """
        SELECT AVG(correspondence_jaccard),AVG(centre_signature_jaccard),
               SUM(centre_status_agreement),COUNT(*)
        FROM calibration_comparisons
        """
    ).fetchone()
    report["calibration_summary"] = {
        "mean_correspondence_jaccard": calibration[0], "mean_centre_signature_jaccard": calibration[1],
        "centre_status_agreement_count": calibration[2] or 0, "comparison_count": calibration[3],
    }
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        "# ReactEnzDB RXNMapper atom-mapping audit", "", f"Generated: {report['generated_at']}", "",
        "Predictions are labelled **ReactEnzDB-RXNMapper predicted** and are not presented as EnzymeMap records.", "",
        "## Coverage", "", "| Group | Count |", "|---|---:|",
    ]
    for key, count in sorted(report["inputs"].items()):
        lines.append(f"| {key} | {count:,} |")
    lines += ["", "## Quality tiers", "", "| Tier | Count |", "|---|---:|"]
    for key, count in report["unmatched_quality_tiers"].items():
        lines.append(f"| {key} | {count:,} |")
    lines += ["", "## EnzymeMap calibration agreement", "", "| Status | Count |", "|---|---:|"]
    for key, count in report["calibration_agreement"].items():
        lines.append(f"| {key} | {count:,} |")
    lines += ["", "## Calibrated thresholds", "", "```json", json.dumps(report["thresholds"], indent=2), "```", ""]
    lines += ["## Validation flags", "", "| Flag | Count |", "|---|---:|"]
    for key, count in report["validation_flags"].items():
        lines.append(f"| {key} | {count:,} |")
    lines += ["", f"Promoted publishable predictions: **{report['promotion_count']:,}**", ""]
    md_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {json_path}\nWrote {md_path}", flush=True)
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=["prepare", "run", "calibrate", "validate", "promote", "report"])
    parser.add_argument("--cohort", choices=["calibration", "unmatched"], default="unmatched")
    parser.add_argument("--work-db", type=Path, default=WORK_DB)
    parser.add_argument("--progress-db", type=Path, default=PROGRESS_DB)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--retry-errors", action="store_true", help="Retry rows already recorded as errors")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.phase == "prepare":
        prepare_inputs(args.work_db, args.progress_db)
    elif args.phase == "run":
        run_predictions(args.progress_db, args.cohort, args.batch_size, args.limit, args.retry_errors)
    elif args.phase == "calibrate":
        calibrate(args.progress_db)
    elif args.phase == "validate":
        validate_predictions(args.progress_db, args.cohort)
    elif args.phase == "promote":
        promote(args.work_db, args.progress_db)
    elif args.phase == "report":
        build_report(args.progress_db, REPORT_JSON, REPORT_MD)


if __name__ == "__main__":
    main()
