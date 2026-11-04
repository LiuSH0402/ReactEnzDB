from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "reaction_standardization_work" / "release_2026-07-14" / "reaction_standardization.sqlite"
TARGET = ROOT / "web_release" / "reaction_standardization.sqlite"
SUMMARY = ROOT / "web_release" / "reaction_standardization.summary.json"


SCHEMA = """
CREATE TABLE release_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE reaction_inputs (
  reaction_id TEXT PRIMARY KEY, reactenz_reaction_id TEXT NOT NULL UNIQUE, source_equation TEXT,
  source_direction TEXT, ec_number TEXT, rhea_id TEXT, kegg_reaction_id TEXT,
  metacyc_reaction_id TEXT, mnx_reaction_ids TEXT, participant_count INTEGER,
  complete_structure INTEGER NOT NULL, input_snapshot_sha256 TEXT, imported_at TEXT NOT NULL
);
CREATE TABLE standardized_reactions (
  reaction_id TEXT PRIMARY KEY, canonical_reactants_smiles TEXT, canonical_products_smiles TEXT,
  canonical_reaction_smiles TEXT, directionless_reaction_key TEXT, directional_reaction_key TEXT,
  directionless_reaction_key_no_stereo TEXT, directional_reaction_key_no_stereo TEXT,
  normalized_direction TEXT NOT NULL, reversibility_status TEXT NOT NULL,
  direction_normalization_rule TEXT NOT NULL, structure_completeness_status TEXT NOT NULL,
  stereo_completeness_status TEXT NOT NULL, participant_role_status TEXT NOT NULL,
  standardization_status TEXT NOT NULL, standardization_rule_version TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE normalized_participants (
  participant_id TEXT PRIMARY KEY, reaction_id TEXT NOT NULL, side TEXT NOT NULL, position_index INTEGER NOT NULL,
  source_compound_id TEXT, source_name TEXT, source_stoichiometry_text TEXT, stoichiometric_coefficient REAL,
  stoichiometry_status TEXT NOT NULL, chebi_id TEXT, mnx_compound_id TEXT, canonical_smiles TEXT,
  standard_inchi TEXT, standard_inchikey TEXT, molecular_formula TEXT, formal_charge INTEGER,
  structure_source TEXT, structure_status TEXT NOT NULL, stereo_status TEXT NOT NULL,
  participant_role TEXT NOT NULL, role_rule_id TEXT, role_confidence REAL
);
CREATE TABLE balance_results (
  balance_result_id TEXT PRIMARY KEY, reaction_id TEXT NOT NULL, balance_context TEXT NOT NULL,
  mass_balance_status TEXT NOT NULL, element_delta_json TEXT NOT NULL, charge_balance_status TEXT NOT NULL,
  charge_delta REAL, proton_delta REAL, water_delta REAL, electron_delta REAL,
  missing_participants_json TEXT NOT NULL, calculation_method TEXT NOT NULL, interpretation_boundary TEXT NOT NULL
);
CREATE TABLE cross_database_mappings (
  mapping_id TEXT PRIMARY KEY, reaction_id TEXT NOT NULL, target_db TEXT NOT NULL, target_reaction_id TEXT NOT NULL,
  mapping_basis TEXT NOT NULL, identifier_relation TEXT NOT NULL, direction_relation TEXT NOT NULL,
  participant_relation TEXT NOT NULL, stoichiometry_relation TEXT NOT NULL, charge_relation TEXT NOT NULL,
  stereo_relation TEXT NOT NULL, chemistry_equivalence TEXT NOT NULL, mapping_confidence REAL NOT NULL,
  confidence_tier TEXT NOT NULL, evidence_json TEXT NOT NULL, conflict_explanation TEXT,
  review_status TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE mapping_conflicts (
  conflict_id TEXT PRIMARY KEY, reaction_id TEXT NOT NULL, mapping_id TEXT, conflict_type TEXT NOT NULL,
  conflict_severity TEXT NOT NULL, reactenz_value TEXT, external_value TEXT, explanation TEXT NOT NULL,
  resolution_status TEXT NOT NULL, resolution_rule TEXT, requires_manual_review INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE atom_mappings (
  atom_mapping_id TEXT PRIMARY KEY, reaction_id TEXT NOT NULL, atom_mapped_reaction_smiles TEXT,
  mapping_method TEXT NOT NULL, mapping_source TEXT NOT NULL, mapped_atom_count INTEGER,
  unmapped_atom_count INTEGER, conserved_atom_fraction REAL, mapping_confidence REAL,
  mapping_status TEXT NOT NULL, validation_flags_json TEXT NOT NULL, source_external_reaction_key TEXT,
  created_at TEXT NOT NULL, public_structure_detail INTEGER NOT NULL
);
CREATE TABLE reaction_centres (
  reaction_centre_id TEXT PRIMARY KEY, atom_mapping_id TEXT NOT NULL, changed_atom_maps_json TEXT NOT NULL,
  broken_bonds_json TEXT NOT NULL, formed_bonds_json TEXT NOT NULL, changed_bonds_json TEXT NOT NULL,
  reaction_centre_smarts TEXT, core_transformation_smarts TEXT, extraction_method TEXT NOT NULL,
  extraction_status TEXT NOT NULL
);
CREATE INDEX idx_reaction_inputs_public ON reaction_inputs(reactenz_reaction_id);
CREATE INDEX idx_participants_reaction ON normalized_participants(reaction_id,side,position_index);
CREATE INDEX idx_balance_reaction ON balance_results(reaction_id,balance_context);
CREATE INDEX idx_mapping_reaction ON cross_database_mappings(reaction_id,confidence_tier);
CREATE INDEX idx_conflict_reaction ON mapping_conflicts(reaction_id,conflict_severity);
CREATE INDEX idx_atom_mapping_reaction ON atom_mappings(reaction_id,mapping_status);
CREATE INDEX idx_centre_mapping ON reaction_centres(atom_mapping_id);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def copy_table(source: sqlite3.Connection, target: sqlite3.Connection, table: str, columns: list[str] | None = None) -> int:
    selected = columns or [row[1] for row in source.execute(f"PRAGMA table_info({table})")]
    placeholders = ",".join("?" for _ in selected)
    target.executemany(
        f"INSERT INTO {table} ({','.join(selected)}) VALUES ({placeholders})",
        source.execute(f"SELECT {','.join(selected)} FROM {table}"),
    )
    return target.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(SOURCE)
    temporary = TARGET.with_suffix(".sqlite.tmp")
    for path in (temporary, Path(str(temporary) + "-wal"), Path(str(temporary) + "-shm")):
        if path.exists():
            path.unlink()

    source = sqlite3.connect(SOURCE)
    source.row_factory = sqlite3.Row
    target = sqlite3.connect(temporary)
    target.executescript("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;" + SCHEMA)

    counts: dict[str, int] = {}
    input_columns = [row[1] for row in target.execute("PRAGMA table_info(reaction_inputs)")]
    target.executemany(
        f"INSERT INTO reaction_inputs VALUES ({','.join('?' for _ in input_columns)})",
        source.execute(f"SELECT {','.join(input_columns)} FROM reactenz_reaction_inputs"),
    )
    counts["reaction_inputs"] = target.execute("SELECT COUNT(*) FROM reaction_inputs").fetchone()[0]
    for table in ("standardized_reactions", "normalized_participants", "balance_results", "reaction_centres"):
        counts[table] = copy_table(source, target, table)

    mapping_columns = [row[1] for row in source.execute("PRAGMA table_info(cross_database_mappings)")]
    mapping_insert = f"INSERT INTO cross_database_mappings VALUES ({','.join('?' for _ in mapping_columns)})"
    mapping_rows = []
    for row in source.execute("SELECT * FROM cross_database_mappings"):
        values = dict(row)
        evidence = json.loads(values["evidence_json"] or "{}")
        if values["target_db"] in {"KEGG", "MetaCyc"}:
            had_structure = bool(evidence.pop("external_reaction_smiles", None))
            evidence["external_structure_compared_in_internal_workflow"] = had_structure
            evidence["public_raw_structure_redacted"] = had_structure
        values["evidence_json"] = json.dumps(evidence, ensure_ascii=False, sort_keys=True)
        mapping_rows.append(tuple(values[column] for column in mapping_columns))
    target.executemany(mapping_insert, mapping_rows)
    counts["cross_database_mappings"] = len(mapping_rows)

    conflict_columns = [row[1] for row in source.execute("PRAGMA table_info(mapping_conflicts)")]
    conflict_rows = []
    for row in source.execute(
        """
        SELECT c.*,m.target_db FROM mapping_conflicts c
        LEFT JOIN cross_database_mappings m USING(mapping_id)
        """
    ):
        values = dict(row)
        if values.get("target_db") in {"KEGG", "MetaCyc"}:
            values["external_value"] = None
        conflict_rows.append(tuple(values[column] for column in conflict_columns))
    target.executemany(
        f"INSERT INTO mapping_conflicts VALUES ({','.join('?' for _ in conflict_columns)})",
        conflict_rows,
    )
    counts["mapping_conflicts"] = len(conflict_rows)

    atom_columns = [row[1] for row in source.execute("PRAGMA table_info(atom_mappings)")]
    atom_rows = []
    redacted_atom_maps = 0
    for row in source.execute("SELECT * FROM atom_mappings"):
        values = dict(row)
        public_detail = int(values["mapping_source"] not in {"EnzymeMap-KEGG", "EnzymeMap-MetaCyc"})
        if not public_detail:
            values["atom_mapped_reaction_smiles"] = None
            redacted_atom_maps += 1
        atom_rows.append(tuple(values[column] for column in atom_columns) + (public_detail,))
    target.executemany(
        f"INSERT INTO atom_mappings ({','.join(atom_columns)},public_structure_detail) VALUES ({','.join('?' for _ in range(len(atom_columns) + 1))})",
        atom_rows,
    )
    counts["atom_mappings"] = len(atom_rows)

    metadata = {
        "release_version": "2026-07-14",
        "generated_at": now(),
        "source_snapshot_sha256": sha256(SOURCE),
        "standardization_rule_version": source.execute("SELECT value FROM metadata WHERE key='core_rule_version'").fetchone()[0],
        "cross_database_rule_version": source.execute("SELECT value FROM metadata WHERE key='cross_database_rule_version'").fetchone()[0],
        "rxnmapper_prediction_rule_version": source.execute("SELECT value FROM metadata WHERE key='rxnmapper_prediction_rule_version'").fetchone()[0],
        "rxnmapper_prediction_promoted_count": source.execute("SELECT value FROM metadata WHERE key='rxnmapper_prediction_promoted_count'").fetchone()[0],
        "atom_mapping_scope": "EnzymeMap source-matched mappings and separately labelled ReactEnzDB-RXNMapper quality-gated predictions.",
        "publication_scope": "Derived ReactEnzDB standardization and conflict annotations; upstream source terms remain applicable.",
        "redacted_atom_mapping_records": str(redacted_atom_maps),
    }
    target.executemany("INSERT INTO release_metadata VALUES (?,?)", metadata.items())
    target.commit()
    target.execute("PRAGMA journal_mode=DELETE")
    integrity = target.execute("PRAGMA integrity_check").fetchone()[0]
    target.close()
    source.close()
    if integrity != "ok":
        raise RuntimeError(f"Published database failed integrity check: {integrity}")

    os.replace(temporary, TARGET)
    target_hash = sha256(TARGET)
    summary = {
        "release_version": metadata["release_version"], "generated_at": metadata["generated_at"],
        "source_snapshot_sha256": metadata["source_snapshot_sha256"], "published_database_sha256": target_hash,
        "counts": counts, "redacted_atom_mapping_records": redacted_atom_maps,
        "integrity_check": integrity,
        "interpretation_boundary": metadata["publication_scope"],
    }
    SUMMARY.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
