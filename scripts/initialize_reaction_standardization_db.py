from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = ROOT / "external" / "reaction_standardization"
MANIFEST_PATH = SOURCE_ROOT / "SOURCE_MANIFEST.json"
SUMMARY_PATH = SOURCE_ROOT / "SOURCE_CATALOG.summary.json"
DEFAULT_OUTPUT = ROOT / "reaction_standardization_work" / "reaction_standardization.sqlite"


SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_files (
  source_file_id TEXT PRIMARY KEY,
  source_group TEXT NOT NULL,
  source_name TEXT NOT NULL,
  relative_path TEXT NOT NULL UNIQUE,
  source_url TEXT NOT NULL,
  resolved_url TEXT,
  upstream_last_modified TEXT,
  retrieved_or_verified_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  expected_md5 TEXT,
  purpose TEXT NOT NULL,
  license_scope TEXT NOT NULL,
  redistribution_status TEXT NOT NULL,
  immutable_raw INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS processing_runs (
  run_id TEXT PRIMARY KEY,
  stage_name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  software_versions_json TEXT NOT NULL,
  parameters_json TEXT NOT NULL,
  input_manifest_sha256 TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS reactenz_reaction_inputs (
  reaction_id TEXT PRIMARY KEY,
  reactenz_reaction_id TEXT NOT NULL UNIQUE,
  source_equation TEXT,
  source_direction TEXT,
  ec_number TEXT,
  rhea_id TEXT,
  kegg_reaction_id TEXT,
  metacyc_reaction_id TEXT,
  mnx_reaction_ids TEXT,
  participant_count INTEGER,
  complete_structure INTEGER NOT NULL DEFAULT 0,
  input_snapshot_sha256 TEXT,
  imported_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS external_reactions (
  external_reaction_key TEXT PRIMARY KEY,
  source_db TEXT NOT NULL,
  source_reaction_id TEXT NOT NULL,
  source_direction TEXT,
  source_equation TEXT,
  source_reaction_smiles TEXT,
  source_atom_mapped_smiles TEXT,
  source_rule_smarts TEXT,
  source_quality REAL,
  source_version TEXT,
  source_file_id TEXT NOT NULL,
  source_row_locator TEXT,
  publication_scope TEXT NOT NULL,
  UNIQUE(source_db, source_reaction_id, source_direction, source_row_locator),
  FOREIGN KEY(source_file_id) REFERENCES source_files(source_file_id)
);

CREATE INDEX IF NOT EXISTS idx_external_reactions_source ON external_reactions(source_db, source_reaction_id);

CREATE TABLE IF NOT EXISTS normalized_participants (
  participant_id TEXT PRIMARY KEY,
  reaction_id TEXT NOT NULL,
  side TEXT NOT NULL,
  position_index INTEGER NOT NULL,
  source_compound_id TEXT,
  source_name TEXT,
  source_stoichiometry_text TEXT,
  stoichiometric_coefficient REAL,
  stoichiometry_status TEXT NOT NULL,
  chebi_id TEXT,
  mnx_compound_id TEXT,
  canonical_smiles TEXT,
  standard_inchi TEXT,
  standard_inchikey TEXT,
  molecular_formula TEXT,
  formal_charge INTEGER,
  structure_source TEXT,
  structure_status TEXT NOT NULL,
  stereo_status TEXT NOT NULL,
  participant_role TEXT NOT NULL,
  role_rule_id TEXT,
  role_confidence REAL,
  FOREIGN KEY(reaction_id) REFERENCES reactenz_reaction_inputs(reaction_id)
);

CREATE INDEX IF NOT EXISTS idx_normalized_participants_reaction ON normalized_participants(reaction_id, side, position_index);

CREATE TABLE IF NOT EXISTS standardized_reactions (
  reaction_id TEXT PRIMARY KEY,
  canonical_reactants_smiles TEXT,
  canonical_products_smiles TEXT,
  canonical_reaction_smiles TEXT,
  directionless_reaction_key TEXT,
  directional_reaction_key TEXT,
  directionless_reaction_key_no_stereo TEXT,
  directional_reaction_key_no_stereo TEXT,
  normalized_direction TEXT NOT NULL,
  reversibility_status TEXT NOT NULL,
  direction_normalization_rule TEXT NOT NULL,
  structure_completeness_status TEXT NOT NULL,
  stereo_completeness_status TEXT NOT NULL,
  participant_role_status TEXT NOT NULL,
  standardization_status TEXT NOT NULL,
  standardization_rule_version TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(reaction_id) REFERENCES reactenz_reaction_inputs(reaction_id)
);

CREATE INDEX IF NOT EXISTS idx_standardized_directionless ON standardized_reactions(directionless_reaction_key);
CREATE INDEX IF NOT EXISTS idx_standardized_directional ON standardized_reactions(directional_reaction_key);
CREATE INDEX IF NOT EXISTS idx_standardized_directionless_no_stereo ON standardized_reactions(directionless_reaction_key_no_stereo);
CREATE INDEX IF NOT EXISTS idx_standardized_directional_no_stereo ON standardized_reactions(directional_reaction_key_no_stereo);

CREATE TABLE IF NOT EXISTS atom_mappings (
  atom_mapping_id TEXT PRIMARY KEY,
  reaction_id TEXT NOT NULL,
  atom_mapped_reaction_smiles TEXT,
  mapping_method TEXT NOT NULL,
  mapping_source TEXT NOT NULL,
  mapped_atom_count INTEGER,
  unmapped_atom_count INTEGER,
  conserved_atom_fraction REAL,
  mapping_confidence REAL,
  mapping_status TEXT NOT NULL,
  validation_flags_json TEXT NOT NULL,
  source_external_reaction_key TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(reaction_id) REFERENCES reactenz_reaction_inputs(reaction_id),
  FOREIGN KEY(source_external_reaction_key) REFERENCES external_reactions(external_reaction_key)
);

CREATE INDEX IF NOT EXISTS idx_atom_mappings_reaction ON atom_mappings(reaction_id, mapping_status);

CREATE TABLE IF NOT EXISTS reaction_centres (
  reaction_centre_id TEXT PRIMARY KEY,
  atom_mapping_id TEXT NOT NULL,
  changed_atom_maps_json TEXT NOT NULL,
  broken_bonds_json TEXT NOT NULL,
  formed_bonds_json TEXT NOT NULL,
  changed_bonds_json TEXT NOT NULL,
  reaction_centre_smarts TEXT,
  core_transformation_smarts TEXT,
  extraction_method TEXT NOT NULL,
  extraction_status TEXT NOT NULL,
  FOREIGN KEY(atom_mapping_id) REFERENCES atom_mappings(atom_mapping_id)
);

CREATE TABLE IF NOT EXISTS balance_results (
  balance_result_id TEXT PRIMARY KEY,
  reaction_id TEXT NOT NULL,
  balance_context TEXT NOT NULL,
  mass_balance_status TEXT NOT NULL,
  element_delta_json TEXT NOT NULL,
  charge_balance_status TEXT NOT NULL,
  charge_delta REAL,
  proton_delta REAL,
  water_delta REAL,
  electron_delta REAL,
  missing_participants_json TEXT NOT NULL,
  calculation_method TEXT NOT NULL,
  interpretation_boundary TEXT NOT NULL,
  UNIQUE(reaction_id, balance_context),
  FOREIGN KEY(reaction_id) REFERENCES reactenz_reaction_inputs(reaction_id)
);

CREATE TABLE IF NOT EXISTS cross_database_mappings (
  mapping_id TEXT PRIMARY KEY,
  reaction_id TEXT NOT NULL,
  target_db TEXT NOT NULL,
  target_reaction_id TEXT NOT NULL,
  mapping_basis TEXT NOT NULL,
  identifier_relation TEXT NOT NULL,
  direction_relation TEXT NOT NULL,
  participant_relation TEXT NOT NULL,
  stoichiometry_relation TEXT NOT NULL,
  charge_relation TEXT NOT NULL,
  stereo_relation TEXT NOT NULL,
  chemistry_equivalence TEXT NOT NULL,
  mapping_confidence REAL NOT NULL,
  confidence_tier TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  conflict_explanation TEXT,
  review_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(reaction_id, target_db, target_reaction_id, mapping_basis),
  FOREIGN KEY(reaction_id) REFERENCES reactenz_reaction_inputs(reaction_id)
);

CREATE INDEX IF NOT EXISTS idx_cross_mapping_reaction ON cross_database_mappings(reaction_id, confidence_tier);
CREATE INDEX IF NOT EXISTS idx_cross_mapping_target ON cross_database_mappings(target_db, target_reaction_id);

CREATE TABLE IF NOT EXISTS mapping_conflicts (
  conflict_id TEXT PRIMARY KEY,
  reaction_id TEXT NOT NULL,
  mapping_id TEXT,
  conflict_type TEXT NOT NULL,
  conflict_severity TEXT NOT NULL,
  reactenz_value TEXT,
  external_value TEXT,
  explanation TEXT NOT NULL,
  resolution_status TEXT NOT NULL,
  resolution_rule TEXT,
  requires_manual_review INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(reaction_id) REFERENCES reactenz_reaction_inputs(reaction_id),
  FOREIGN KEY(mapping_id) REFERENCES cross_database_mappings(mapping_id)
);

CREATE INDEX IF NOT EXISTS idx_mapping_conflicts_reaction ON mapping_conflicts(reaction_id, conflict_severity);

CREATE TABLE IF NOT EXISTS enzyme_assignment_boundaries (
  reaction_id TEXT NOT NULL,
  biopart_id TEXT NOT NULL,
  evidence_assertion_id TEXT,
  reaction_identity_requirement TEXT NOT NULL,
  directional_match_status TEXT NOT NULL,
  substrate_product_match_status TEXT NOT NULL,
  assignment_status TEXT NOT NULL,
  assignment_explanation TEXT NOT NULL,
  PRIMARY KEY(reaction_id, biopart_id, evidence_assertion_id),
  FOREIGN KEY(reaction_id) REFERENCES reactenz_reaction_inputs(reaction_id)
);

CREATE TABLE IF NOT EXISTS qa_results (
  check_name TEXT PRIMARY KEY,
  passed INTEGER NOT NULL,
  observed_value TEXT NOT NULL,
  expected_value TEXT NOT NULL,
  severity TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  details_json TEXT NOT NULL
);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def redistribution_status(relative_path: str, source_group: str) -> str:
    lower = relative_path.lower()
    if "metacyc/data/raw_reactions" in lower:
        return "internal_only_upstream_license_required"
    if "kegg/data/raw_reactions" in lower:
        return "internal_only_upstream_terms_apply"
    if source_group == "enzymemap" and "/data/raw_reactions" in lower:
        return "internal_analysis_only_source_terms_apply"
    if source_group in {"rhea", "chebi"}:
        return "derived_results_with_attribution; consult_downloaded_license_for_raw_redistribution"
    if source_group == "metanetx":
        return "derived_results_with_attribution; component_source_terms_apply"
    return "derived_results_only_unless_upstream_terms_are_confirmed"


def source_file_id(relative_path: str) -> str:
    import hashlib

    return "srcfile:" + hashlib.sha256(relative_path.encode("utf-8")).hexdigest()[:20]


def main() -> None:
    parser = argparse.ArgumentParser(description="Initialize the independent ReactEnzDB reaction-standardization work database.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    summary = json.loads(SUMMARY_PATH.read_text(encoding="utf-8"))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(args.output)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.executescript(SCHEMA)

    metadata = {
        "schema_version": "REACTION_STANDARDIZATION_V1",
        "created_or_updated_at": now(),
        "core_policy": "Normalized reaction identity prevents incorrect enzyme assignment and connects pathway steps to exact enzyme evidence.",
        "direction_policy": "Store both directional and direction-independent identities; never collapse enzyme evidence across direction without an explicit equivalence rule.",
        "mapping_policy": "Identifier xrefs are candidates; chemical equivalence requires participant, stoichiometry, charge, direction and stereo reconciliation.",
        "source_manifest": MANIFEST_PATH.relative_to(ROOT).as_posix(),
        "source_catalog_summary": SUMMARY_PATH.relative_to(ROOT).as_posix(),
        "configured_source_files": str(summary["verification"]["configured_assets"]),
        "rhea_release": str(summary["rhea"]["release"].get("rhea.release.number")),
        "enzymemap_commit": str(summary["enzymemap"].get("commit")),
    }
    conn.executemany("INSERT OR REPLACE INTO metadata(key,value) VALUES (?,?)", metadata.items())

    rows = []
    for relative_path, record in sorted(manifest["assets"].items()):
        rows.append(
            (
                source_file_id(relative_path),
                record["group"],
                record["source"],
                record["local_path"],
                record["url"],
                record.get("resolved_url"),
                record.get("last_modified"),
                record["verified_at"],
                record["size_bytes"],
                record["sha256"],
                record.get("expected_md5"),
                record["purpose"],
                record["license_scope"],
                redistribution_status(relative_path, record["group"]),
                1,
            )
        )
    conn.executemany(
        """
        INSERT OR REPLACE INTO source_files(
          source_file_id,source_group,source_name,relative_path,source_url,resolved_url,
          upstream_last_modified,retrieved_or_verified_at,size_bytes,sha256,expected_md5,
          purpose,license_scope,redistribution_status,immutable_raw
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        rows,
    )

    checks = [
        (
            "configured_source_assets_present",
            int(summary["verification"]["all_verified"]),
            str(summary["verification"]["manifest_assets"]),
            str(summary["verification"]["configured_assets"]),
            "error",
            now(),
            json.dumps(summary["verification"], ensure_ascii=False, sort_keys=True),
        ),
        (
            "rhea_release_pinned",
            int(bool(summary["rhea"]["release"].get("rhea.release.number"))),
            str(summary["rhea"]["release"].get("rhea.release.number")),
            "non-empty release number",
            "error",
            now(),
            "{}",
        ),
        (
            "enzymemap_commit_pinned",
            int(len(str(summary["enzymemap"].get("commit", ""))) == 40),
            str(summary["enzymemap"].get("commit")),
            "40-character Git commit",
            "error",
            now(),
            "{}",
        ),
        (
            "licensed_bulk_scraping_disabled",
            int(manifest.get("policy", {}).get("direct_kegg_or_metacyc_bulk_scraping") is False),
            str(manifest.get("policy", {}).get("direct_kegg_or_metacyc_bulk_scraping")),
            "False",
            "error",
            now(),
            "{}",
        ),
    ]
    conn.executemany("INSERT OR REPLACE INTO qa_results VALUES (?,?,?,?,?,?,?)", checks)
    conn.commit()
    source_count = conn.execute("SELECT COUNT(*) FROM source_files").fetchone()[0]
    table_count = conn.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'").fetchone()[0]
    qa_passed = conn.execute("SELECT COUNT(*) FROM qa_results WHERE passed=1").fetchone()[0]
    qa_total = conn.execute("SELECT COUNT(*) FROM qa_results").fetchone()[0]
    conn.close()
    print(json.dumps({"database": str(args.output), "tables": table_count, "source_files": source_count, "qa": f"{qa_passed}/{qa_total}"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
