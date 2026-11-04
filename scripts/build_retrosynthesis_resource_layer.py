from __future__ import annotations
import os

import argparse
import csv
import hashlib
import json
import pickle
import sqlite3
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RETRO_ROOT = Path(os.environ.get("RETROSYNTHESIS_DATA_ROOT", ROOT / "inputs" / "retrosynthesis"))
DEFAULT_OUTPUT_DB = ROOT / "web_release" / "retrosynthesis_resources.sqlite"


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


def row_hash(*parts: Any, prefix: str) -> str:
    text = "|".join("" if part is None else str(part) for part in parts)
    return f"{prefix}_{hashlib.sha1(text.encode('utf-8', errors='replace')).hexdigest()[:16]}"


def table_count(path: Path, table: str) -> int:
    conn = sqlite3.connect(path)
    try:
        return int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
    finally:
        conn.close()


def table_columns(path: Path, table: str) -> list[str]:
    conn = sqlite3.connect(path)
    try:
        return [row[1] for row in conn.execute(f"PRAGMA table_info({table})")]
    finally:
        conn.close()


def find_dir(parent: Path, prefix: str) -> Path:
    matches = [path for path in parent.iterdir() if path.is_dir() and path.name.startswith(prefix)]
    if not matches:
        raise FileNotFoundError(f"Cannot find directory starting with {prefix!r} under {parent}")
    return matches[0]


def line_count(path: Path) -> int:
    with path.open("rb") as handle:
        return sum(1 for _ in handle)


def setup(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        DROP TABLE IF EXISTS resource_files;
        DROP TABLE IF EXISTS retrobiocat_reaction_rules;
        DROP TABLE IF EXISTS retrobiocat_rule_enzymes;
        DROP TABLE IF EXISTS retrobiocat_rule_smarts;
        DROP TABLE IF EXISTS retrobiocat_rule_tests;
        DROP TABLE IF EXISTS retrobiocat_activity_evidence;
        DROP TABLE IF EXISTS retrobiocat_metabolites;
        DROP TABLE IF EXISTS retrobiocat_external_building_block_sources;
        DROP TABLE IF EXISTS bionavi_reaction_rules;
        DROP TABLE IF EXISTS bionavi_rule_references;
        DROP TABLE IF EXISTS bionavi_building_blocks;
        DROP TABLE IF EXISTS retrosynthesis_benchmark_sets;
        DROP TABLE IF EXISTS retrosynthesis_benchmark_reactions;
        DROP TABLE IF EXISTS retrosynthesis_route_targets;
        DROP TABLE IF EXISTS readretro_compounds;
        DROP TABLE IF EXISTS subnetx_cases;

        CREATE TABLE resource_files (
          resource_id TEXT PRIMARY KEY,
          source_name TEXT NOT NULL,
          source_url TEXT,
          local_path TEXT NOT NULL,
          file_name TEXT NOT NULL,
          file_size_bytes INTEGER NOT NULL,
          sha256 TEXT NOT NULL,
          license_note TEXT,
          imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE retrobiocat_reaction_rules (
          rule_id TEXT PRIMARY KEY,
          reaction_name TEXT NOT NULL,
          reaction_type TEXT,
          two_step INTEGER NOT NULL DEFAULT 0,
          smarts_count INTEGER NOT NULL DEFAULT 0,
          enzyme_count INTEGER NOT NULL DEFAULT 0,
          positive_test_count INTEGER NOT NULL DEFAULT 0,
          negative_test_count INTEGER NOT NULL DEFAULT 0,
          source_resource_id TEXT NOT NULL,
          source_index INTEGER NOT NULL,
          source_note TEXT,
          FOREIGN KEY (source_resource_id) REFERENCES resource_files(resource_id)
        );

        CREATE TABLE retrobiocat_rule_smarts (
          smarts_id TEXT PRIMARY KEY,
          rule_id TEXT NOT NULL,
          smarts_index INTEGER NOT NULL,
          smarts TEXT NOT NULL,
          FOREIGN KEY (rule_id) REFERENCES retrobiocat_reaction_rules(rule_id)
        );

        CREATE TABLE retrobiocat_rule_enzymes (
          rule_enzyme_id TEXT PRIMARY KEY,
          rule_id TEXT NOT NULL,
          enzyme_type TEXT NOT NULL,
          cofactors_minus TEXT,
          cofactors_plus TEXT,
          FOREIGN KEY (rule_id) REFERENCES retrobiocat_reaction_rules(rule_id)
        );

        CREATE TABLE retrobiocat_rule_tests (
          test_id TEXT PRIMARY KEY,
          rule_id TEXT NOT NULL,
          test_type TEXT NOT NULL,
          smiles TEXT NOT NULL,
          FOREIGN KEY (rule_id) REFERENCES retrobiocat_reaction_rules(rule_id)
        );

        CREATE TABLE retrobiocat_activity_evidence (
          evidence_id TEXT PRIMARY KEY,
          reaction_name TEXT,
          enzyme_type TEXT,
          enzyme_name TEXT,
          short_citation TEXT,
          doi_url TEXT,
          substrate_1_smiles TEXT,
          substrate_2_smiles TEXT,
          product_1_smiles TEXT,
          temperature TEXT,
          ph TEXT,
          solvent TEXT,
          other_conditions TEXT,
          notes TEXT,
          formulation TEXT,
          kcat TEXT,
          km TEXT,
          substrate_1_conc TEXT,
          substrate_2_conc TEXT,
          specific_activity TEXT,
          conversion TEXT,
          conversion_time TEXT,
          categorical TEXT,
          binary TEXT,
          selectivity TEXT,
          auto_generated TEXT,
          source_resource_id TEXT NOT NULL,
          source_row INTEGER NOT NULL,
          FOREIGN KEY (source_resource_id) REFERENCES resource_files(resource_id)
        );

        CREATE TABLE retrobiocat_metabolites (
          metabolite_id TEXT PRIMARY KEY,
          smiles TEXT NOT NULL,
          ecmdb_id TEXT,
          source_resource_id TEXT NOT NULL,
          source_row INTEGER NOT NULL,
          FOREIGN KEY (source_resource_id) REFERENCES resource_files(resource_id)
        );

        CREATE TABLE retrobiocat_external_building_block_sources (
          source_table_id TEXT PRIMARY KEY,
          source_resource_id TEXT NOT NULL,
          source_table TEXT NOT NULL,
          row_count INTEGER NOT NULL,
          columns_json TEXT NOT NULL,
          local_path TEXT NOT NULL,
          integration_mode TEXT NOT NULL,
          notes TEXT,
          FOREIGN KEY (source_resource_id) REFERENCES resource_files(resource_id)
        );

        CREATE TABLE bionavi_reaction_rules (
          rule_id TEXT PRIMARY KEY,
          source_resource_id TEXT NOT NULL,
          rule_source TEXT NOT NULL,
          rule_type TEXT,
          smarts TEXT,
          reference_reaction_count INTEGER NOT NULL DEFAULT 0,
          reference_molecule_count INTEGER NOT NULL DEFAULT 0,
          reference_enzyme_count INTEGER NOT NULL DEFAULT 0,
          source_index INTEGER NOT NULL,
          source_note TEXT,
          FOREIGN KEY (source_resource_id) REFERENCES resource_files(resource_id)
        );

        CREATE TABLE bionavi_rule_references (
          reference_id TEXT PRIMARY KEY,
          rule_id TEXT NOT NULL,
          reference_type TEXT NOT NULL,
          external_db TEXT,
          external_id TEXT,
          raw_reference TEXT NOT NULL,
          FOREIGN KEY (rule_id) REFERENCES bionavi_reaction_rules(rule_id)
        );

        CREATE TABLE bionavi_building_blocks (
          block_id TEXT PRIMARY KEY,
          source_resource_id TEXT NOT NULL,
          block_set TEXT NOT NULL,
          block_type TEXT NOT NULL,
          smiles TEXT NOT NULL,
          source_row INTEGER NOT NULL,
          FOREIGN KEY (source_resource_id) REFERENCES resource_files(resource_id)
        );

        CREATE TABLE retrosynthesis_benchmark_sets (
          benchmark_id TEXT PRIMARY KEY,
          source_resource_id TEXT NOT NULL,
          dataset_name TEXT NOT NULL,
          task_type TEXT NOT NULL,
          split_name TEXT NOT NULL,
          record_count INTEGER NOT NULL,
          reaction_format TEXT,
          license_note TEXT,
          FOREIGN KEY (source_resource_id) REFERENCES resource_files(resource_id)
        );

        CREATE TABLE retrosynthesis_benchmark_reactions (
          benchmark_entry_id TEXT PRIMARY KEY,
          benchmark_id TEXT NOT NULL,
          source_resource_id TEXT NOT NULL,
          entry_index INTEGER NOT NULL,
          reaction_smiles TEXT,
          reactants_smiles TEXT,
          product_smiles TEXT,
          mapped_reaction_smiles TEXT,
          reaction_class TEXT,
          target_name TEXT,
          target_smiles TEXT,
          FOREIGN KEY (benchmark_id) REFERENCES retrosynthesis_benchmark_sets(benchmark_id),
          FOREIGN KEY (source_resource_id) REFERENCES resource_files(resource_id)
        );

        CREATE TABLE retrosynthesis_route_targets (
          route_id TEXT PRIMARY KEY,
          source_resource_id TEXT NOT NULL,
          route_set TEXT NOT NULL,
          target_name TEXT,
          target_class TEXT,
          target_smiles TEXT NOT NULL,
          route_text TEXT,
          step_count INTEGER NOT NULL DEFAULT 0,
          source_row INTEGER NOT NULL,
          FOREIGN KEY (source_resource_id) REFERENCES resource_files(resource_id)
        );

        CREATE TABLE readretro_compounds (
          compound_id TEXT PRIMARY KEY,
          source_resource_id TEXT NOT NULL,
          external_id TEXT,
          inchi TEXT,
          smiles TEXT NOT NULL,
          source_row INTEGER NOT NULL,
          FOREIGN KEY (source_resource_id) REFERENCES resource_files(resource_id)
        );

        CREATE TABLE subnetx_cases (
          case_id TEXT PRIMARY KEY,
          source_resource_id TEXT NOT NULL,
          target_name TEXT NOT NULL,
          reaction_count INTEGER,
          compound_count INTEGER,
          nicepathway_count INTEGER,
          minimal_subnet_count INTEGER,
          pthws_info_count INTEGER,
          stats_json TEXT,
          local_path TEXT NOT NULL,
          FOREIGN KEY (source_resource_id) REFERENCES resource_files(resource_id)
        );

        CREATE INDEX idx_retrobiocat_rules_type ON retrobiocat_reaction_rules(reaction_type);
        CREATE INDEX idx_retrobiocat_smarts_rule ON retrobiocat_rule_smarts(rule_id);
        CREATE INDEX idx_retrobiocat_rule_enzymes_type ON retrobiocat_rule_enzymes(enzyme_type);
        CREATE INDEX idx_retrobiocat_activity_reaction ON retrobiocat_activity_evidence(reaction_name);
        CREATE INDEX idx_retrobiocat_activity_enzyme ON retrobiocat_activity_evidence(enzyme_type, enzyme_name);
        CREATE INDEX idx_retrobiocat_activity_doi ON retrobiocat_activity_evidence(doi_url);
        CREATE INDEX idx_retrobiocat_metabolites_smiles ON retrobiocat_metabolites(smiles);
        CREATE INDEX idx_bionavi_rules_source ON bionavi_reaction_rules(rule_source);
        CREATE INDEX idx_bionavi_rule_refs_external ON bionavi_rule_references(external_db, external_id);
        CREATE INDEX idx_bionavi_blocks_smiles ON bionavi_building_blocks(smiles);
        CREATE INDEX idx_benchmark_reactions_product ON retrosynthesis_benchmark_reactions(product_smiles);
        CREATE INDEX idx_benchmark_reactions_benchmark ON retrosynthesis_benchmark_reactions(benchmark_id);
        CREATE INDEX idx_route_targets_smiles ON retrosynthesis_route_targets(target_smiles);
        CREATE INDEX idx_readretro_compounds_external ON readretro_compounds(external_id);
        CREATE INDEX idx_readretro_compounds_smiles ON readretro_compounds(smiles);
        """
    )
    conn.commit()


def register_file(
    conn: sqlite3.Connection,
    resource_id: str,
    source_name: str,
    source_url: str,
    path: Path,
    license_note: str,
) -> None:
    conn.execute(
        """
        INSERT INTO resource_files (
          resource_id, source_name, source_url, local_path, file_name,
          file_size_bytes, sha256, license_note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (resource_id, source_name, source_url, str(path), path.name, path.stat().st_size, sha256(path), license_note),
    )
    conn.commit()


def load_yaml(path: Path) -> dict[str, Any]:
    try:
        import yaml
    except ImportError as exc:
        raise RuntimeError("PyYAML is required to parse RetroBioCat rxns_yaml.yaml") from exc
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        data = yaml.safe_load(handle)
    if not isinstance(data, dict):
        raise ValueError(f"Expected YAML mapping in {path}")
    return data


def import_rules(conn: sqlite3.Connection, yaml_path: Path) -> dict[str, int]:
    data = load_yaml(yaml_path)
    rules = []
    smarts_rows = []
    enzyme_rows = []
    test_rows = []
    for idx, (reaction_name, item) in enumerate(sorted(data.items()), start=1):
        if not isinstance(item, dict):
            continue
        smarts = [str(v).strip().strip("\u2018\u2019'\"") for v in (item.get("smarts") or []) if str(v).strip()]
        enzymes = item.get("enzymes") or {}
        positive_tests = [str(v) for v in (item.get("positive_tests") or []) if str(v).strip()]
        negative_tests = [str(v) for v in (item.get("negative_tests") or []) if str(v).strip()]
        rule_id = row_hash("retrobiocat_rule", reaction_name, idx, prefix="RBC_RULE")
        rules.append(
            (
                rule_id,
                reaction_name,
                item.get("type"),
                1 if item.get("two_step") else 0,
                len(smarts),
                len(enzymes),
                len(positive_tests),
                len(negative_tests),
                "retrobiocat_rxns_yaml",
                idx,
                "RetroBioCat reaction SMARTS rule imported from Figshare rxns_yaml.yaml.",
            )
        )
        for smarts_idx, smarts_text in enumerate(smarts, start=1):
            smarts_rows.append((row_hash(rule_id, smarts_idx, smarts_text, prefix="RBC_SMARTS"), rule_id, smarts_idx, smarts_text))
        for enzyme_type, enzyme_info in sorted(enzymes.items()):
            enzyme_info = enzyme_info or {}
            enzyme_rows.append(
                (
                    row_hash(rule_id, enzyme_type, prefix="RBC_ENZ"),
                    rule_id,
                    str(enzyme_type),
                    json.dumps(enzyme_info.get("cofactors_minus") or [], ensure_ascii=False),
                    json.dumps(enzyme_info.get("cofactors_plus") or [], ensure_ascii=False),
                )
            )
        for test_type, tests in [("positive", positive_tests), ("negative", negative_tests)]:
            for test_idx, smiles in enumerate(tests, start=1):
                test_rows.append((row_hash(rule_id, test_type, test_idx, smiles, prefix="RBC_TEST"), rule_id, test_type, smiles))

    conn.executemany(
        """
        INSERT INTO retrobiocat_reaction_rules (
          rule_id, reaction_name, reaction_type, two_step, smarts_count, enzyme_count,
          positive_test_count, negative_test_count, source_resource_id, source_index, source_note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rules,
    )
    conn.executemany("INSERT INTO retrobiocat_rule_smarts (smarts_id, rule_id, smarts_index, smarts) VALUES (?, ?, ?, ?)", smarts_rows)
    conn.executemany(
        "INSERT INTO retrobiocat_rule_enzymes (rule_enzyme_id, rule_id, enzyme_type, cofactors_minus, cofactors_plus) VALUES (?, ?, ?, ?, ?)",
        enzyme_rows,
    )
    conn.executemany("INSERT INTO retrobiocat_rule_tests (test_id, rule_id, test_type, smiles) VALUES (?, ?, ?, ?)", test_rows)
    conn.commit()
    return {"rules": len(rules), "smarts": len(smarts_rows), "rule_enzymes": len(enzyme_rows), "rule_tests": len(test_rows)}


def text_value(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, float) and value != value:
        return None
    return str(value)


def import_activity_evidence(conn: sqlite3.Connection, xlsx_path: Path) -> int:
    import pandas as pd

    df = pd.read_excel(xlsx_path, sheet_name=0)
    cols = {
        "reaction": "reaction_name",
        "enzyme_type": "enzyme_type",
        "enzyme_name": "enzyme_name",
        "short_citation": "short_citation",
        "html_doi": "doi_url",
        "substrate_1_smiles": "substrate_1_smiles",
        "substrate_2_smiles": "substrate_2_smiles",
        "product_1_smiles": "product_1_smiles",
        "temperature": "temperature",
        "ph": "ph",
        "solvent": "solvent",
        "other_conditions": "other_conditions",
        "notes": "notes",
        "formulation": "formulation",
        "kcat": "kcat",
        "km": "km",
        "substrate_1_conc": "substrate_1_conc",
        "substrate_2_conc": "substrate_2_conc",
        "specific_activity": "specific_activity",
        "conversion": "conversion",
        "conversion_time": "conversion_time",
        "categorical": "categorical",
        "binary": "binary",
        "selectivity": "selectivity",
        "auto_generated": "auto_generated",
    }
    rows = []
    for idx, row in df.iterrows():
        source_row = int(idx) + 2
        values = {target: text_value(row.get(source)) for source, target in cols.items()}
        evidence_id = row_hash("retrobiocat_activity", source_row, values.get("reaction_name"), values.get("enzyme_name"), values.get("substrate_1_smiles"), values.get("product_1_smiles"), prefix="RBC_ACT")
        rows.append(
            (
                evidence_id,
                values.get("reaction_name"),
                values.get("enzyme_type"),
                values.get("enzyme_name"),
                values.get("short_citation"),
                values.get("doi_url"),
                values.get("substrate_1_smiles"),
                values.get("substrate_2_smiles"),
                values.get("product_1_smiles"),
                values.get("temperature"),
                values.get("ph"),
                values.get("solvent"),
                values.get("other_conditions"),
                values.get("notes"),
                values.get("formulation"),
                values.get("kcat"),
                values.get("km"),
                values.get("substrate_1_conc"),
                values.get("substrate_2_conc"),
                values.get("specific_activity"),
                values.get("conversion"),
                values.get("conversion_time"),
                values.get("categorical"),
                values.get("binary"),
                values.get("selectivity"),
                values.get("auto_generated"),
                "retrobiocat_trial_activity",
                source_row,
            )
        )
    conn.executemany(
        """
        INSERT INTO retrobiocat_activity_evidence (
          evidence_id, reaction_name, enzyme_type, enzyme_name, short_citation, doi_url,
          substrate_1_smiles, substrate_2_smiles, product_1_smiles, temperature, ph,
          solvent, other_conditions, notes, formulation, kcat, km, substrate_1_conc,
          substrate_2_conc, specific_activity, conversion, conversion_time, categorical,
          binary, selectivity, auto_generated, source_resource_id, source_row
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    conn.commit()
    return len(rows)


def import_metabolites(conn: sqlite3.Connection, source_mols_db: Path) -> int:
    src = sqlite3.connect(source_mols_db)
    try:
        rows = []
        for idx, (source_idx, smiles, ecmdb_id) in enumerate(src.execute("SELECT rowid, smiles, ecmdb_id FROM metabolites"), start=1):
            rows.append((row_hash("retrobiocat_metabolite", source_idx, smiles, ecmdb_id, prefix="RBC_MET"), smiles, ecmdb_id, "retrobiocat_source_mols", int(source_idx)))
        conn.executemany(
            """
            INSERT INTO retrobiocat_metabolites (
              metabolite_id, smiles, ecmdb_id, source_resource_id, source_row
            ) VALUES (?, ?, ?, ?, ?)
            """,
            rows,
        )
        conn.commit()
        return len(rows)
    finally:
        src.close()


def register_external_block_sources(conn: sqlite3.Connection, building_blocks_db: Path, source_mols_db: Path) -> int:
    sources = []
    for resource_id, db_path, table, mode, notes in [
        (
            "retrobiocat_buyable_db",
            building_blocks_db,
            "BUYABLE",
            "external_sqlite_reference",
            "Large buyable molecule table kept in source SQLite to avoid duplicating 8M+ rows. Query by attaching this database when needed.",
        ),
        (
            "retrobiocat_source_mols",
            source_mols_db,
            "building_blocks",
            "external_sqlite_reference",
            "Large vendor/source building-block table kept in source SQLite to avoid duplicating 2M+ rows. Query by attaching this database when needed.",
        ),
        (
            "retrobiocat_source_mols",
            source_mols_db,
            "metabolites",
            "imported_small_table",
            "Small metabolite table imported into retrobiocat_metabolites.",
        ),
    ]:
        count = table_count(db_path, table)
        cols = table_columns(db_path, table)
        sources.append(
            (
                row_hash(resource_id, table, prefix="RBC_EXTSRC"),
                resource_id,
                table,
                count,
                json.dumps(cols, ensure_ascii=False),
                str(db_path),
                mode,
                notes,
            )
        )
    conn.executemany(
        """
        INSERT INTO retrobiocat_external_building_block_sources (
          source_table_id, source_resource_id, source_table, row_count, columns_json,
          local_path, integration_mode, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        sources,
    )
    conn.commit()
    return len(sources)


def parse_bionavi_reference(raw: str) -> tuple[str | None, str | None]:
    if raw.startswith("MetaCyc_"):
        return "MetaCyc", raw.removeprefix("MetaCyc_")
    if raw.startswith("KEGG_"):
        return "KEGG", raw.removeprefix("KEGG_")
    if raw.startswith("RHEA_"):
        return "Rhea", raw.removeprefix("RHEA_")
    if raw.startswith("BRENDA_"):
        return "BRENDA_EC", raw.removeprefix("BRENDA_")
    if raw.startswith("uspto_"):
        return "USPTO", raw
    return None, None


def import_bionavi_rules(conn: sqlite3.Connection, path: Path, resource_id: str, rule_source: str) -> dict[str, int]:
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        data = json.load(handle)
    rule_rows = []
    ref_rows = []
    for idx, item in enumerate(data, start=1):
        if not isinstance(item, dict):
            continue
        smarts = item.get("smarts")
        ref_rxn = item.get("ref_rxn") or []
        ref_mol = item.get("ref_mol") or []
        ref_enz = item.get("ref_enz") or []
        rule_id = row_hash(resource_id, idx, smarts, prefix="BN_RULE")
        rule_rows.append(
            (
                rule_id,
                resource_id,
                rule_source,
                item.get("type"),
                smarts,
                len(ref_rxn),
                len(ref_mol),
                len(ref_enz),
                idx,
                f"Imported from {path.name}; external database references are retained as provenance.",
            )
        )
        for ref_type, refs in [("reaction", ref_rxn), ("molecule", ref_mol), ("enzyme_reaction", ref_enz)]:
            for ref_idx, raw in enumerate(refs, start=1):
                raw = str(raw)
                external_db, external_id = parse_bionavi_reference(raw)
                ref_rows.append((row_hash(rule_id, ref_type, ref_idx, raw, prefix="BN_REF"), rule_id, ref_type, external_db, external_id, raw))
    conn.executemany(
        """
        INSERT INTO bionavi_reaction_rules (
          rule_id, source_resource_id, rule_source, rule_type, smarts,
          reference_reaction_count, reference_molecule_count, reference_enzyme_count,
          source_index, source_note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rule_rows,
    )
    conn.executemany(
        """
        INSERT INTO bionavi_rule_references (
          reference_id, rule_id, reference_type, external_db, external_id, raw_reference
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        ref_rows,
    )
    conn.commit()
    return {"rules": len(rule_rows), "references": len(ref_rows)}


def import_bionavi_building_blocks(conn: sqlite3.Connection, path: Path, resource_id: str, block_set: str, block_type: str, has_header: bool = False) -> int:
    rows = []
    with path.open("r", encoding="utf-8", errors="replace", newline="") as handle:
        reader = csv.reader(handle)
        for idx, row in enumerate(reader, start=1):
            if not row:
                continue
            if idx == 1 and has_header:
                continue
            smiles = row[0].strip()
            if not smiles or smiles.lower() == "mol":
                continue
            rows.append((row_hash(resource_id, block_set, idx, smiles, prefix="BN_BB"), resource_id, block_set, block_type, smiles, idx))
    conn.executemany(
        """
        INSERT OR IGNORE INTO bionavi_building_blocks (
          block_id, source_resource_id, block_set, block_type, smiles, source_row
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    conn.commit()
    return len(rows)


def split_reaction_smiles(reaction: str | None) -> tuple[str | None, str | None]:
    if not reaction or ">>" not in reaction:
        return None, None
    left, right = reaction.split(">>", 1)
    return left.strip() or None, right.strip() or None


def add_benchmark_set(
    conn: sqlite3.Connection,
    benchmark_id: str,
    resource_id: str,
    dataset_name: str,
    task_type: str,
    split_name: str,
    record_count: int,
    reaction_format: str,
    license_note: str,
) -> None:
    conn.execute(
        """
        INSERT INTO retrosynthesis_benchmark_sets (
          benchmark_id, source_resource_id, dataset_name, task_type, split_name,
          record_count, reaction_format, license_note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (benchmark_id, resource_id, dataset_name, task_type, split_name, record_count, reaction_format, license_note),
    )


def import_txt_benchmark(
    conn: sqlite3.Connection,
    path: Path,
    resource_id: str,
    dataset_name: str,
    split_name: str,
    task_type: str,
) -> int:
    benchmark_id = row_hash(resource_id, dataset_name, split_name, path.name, prefix="BM_SET")
    records = []
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for idx, line in enumerate(handle, start=1):
            reaction = line.strip()
            if not reaction:
                continue
            reactants, product = split_reaction_smiles(reaction)
            records.append(
                (
                    row_hash(benchmark_id, idx, reaction, prefix="BM_RXN"),
                    benchmark_id,
                    resource_id,
                    idx,
                    reaction,
                    reactants,
                    product,
                    None,
                    None,
                    None,
                    None,
                )
            )
    add_benchmark_set(conn, benchmark_id, resource_id, dataset_name, task_type, split_name, len(records), "reactants>>product SMILES", "External model benchmark split; cite original source.")
    conn.executemany(
        """
        INSERT INTO retrosynthesis_benchmark_reactions (
          benchmark_entry_id, benchmark_id, source_resource_id, entry_index, reaction_smiles,
          reactants_smiles, product_smiles, mapped_reaction_smiles, reaction_class,
          target_name, target_smiles
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        records,
    )
    conn.commit()
    return len(records)


def import_raw_csv_benchmark(
    conn: sqlite3.Connection,
    path: Path,
    resource_id: str,
    dataset_name: str,
    split_name: str,
) -> int:
    benchmark_id = row_hash(resource_id, dataset_name, split_name, path.name, prefix="BM_SET")
    records = []
    with path.open("r", encoding="utf-8", errors="replace", newline="") as handle:
        for idx, row in enumerate(csv.DictReader(handle), start=1):
            reaction = (row.get("origin_SMILES") or "").strip()
            mapped = (row.get("reactants>reagents>production") or "").strip()
            reactants, product = split_reaction_smiles(reaction)
            records.append(
                (
                    row_hash(benchmark_id, idx, reaction, mapped, prefix="BM_RXN"),
                    benchmark_id,
                    resource_id,
                    idx,
                    reaction,
                    reactants,
                    product,
                    mapped,
                    row.get("class"),
                    None,
                    None,
                )
            )
    add_benchmark_set(conn, benchmark_id, resource_id, dataset_name, "single_step_model_ready", split_name, len(records), "mapped reaction CSV plus origin_SMILES", "READRetro model-ready split; cite original source.")
    conn.executemany(
        """
        INSERT INTO retrosynthesis_benchmark_reactions (
          benchmark_entry_id, benchmark_id, source_resource_id, entry_index, reaction_smiles,
          reactants_smiles, product_smiles, mapped_reaction_smiles, reaction_class,
          target_name, target_smiles
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        records,
    )
    conn.commit()
    return len(records)


def count_route_steps(route_text: str | None) -> int:
    if not route_text:
        return 0
    return sum(1 for part in route_text.split("|") if ">>" in part)


def import_route_targets(conn: sqlite3.Connection, path: Path, resource_id: str, route_set: str, parser_name: str) -> int:
    rows = []
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for idx, line in enumerate(handle, start=1):
            parts = line.rstrip("\n").split("\t")
            if parser_name == "bionavi_biosynthetic":
                if not parts or not parts[0]:
                    continue
                target_smiles = parts[0]
                route_text = parts[1] if len(parts) > 1 else None
                target_name = None
                target_class = None
            elif parser_name == "bionavi_drugs":
                if len(parts) < 2:
                    continue
                target_smiles, target_name = parts[0], parts[1]
                target_class = "drug"
                route_text = None
            elif parser_name == "readretro_test":
                if len(parts) < 3:
                    continue
                target_name, target_class, target_smiles = parts[0], parts[1], parts[2]
                route_text = None
            elif parser_name == "bionavi_np_targets":
                if len(parts) < 2:
                    continue
                target_name, target_smiles = parts[0], parts[1]
                target_class = None
                route_text = None
            else:
                raise ValueError(parser_name)
            rows.append((row_hash(resource_id, route_set, idx, target_name, target_smiles, prefix="RT_TARGET"), resource_id, route_set, target_name, target_class, target_smiles, route_text, count_route_steps(route_text), idx))
    conn.executemany(
        """
        INSERT OR IGNORE INTO retrosynthesis_route_targets (
          route_id, source_resource_id, route_set, target_name, target_class,
          target_smiles, route_text, step_count, source_row
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    conn.commit()
    return len(rows)


def import_readretro_compounds(conn: sqlite3.Connection, path: Path, resource_id: str) -> int:
    rows = []
    with path.open("r", encoding="utf-8", errors="replace", newline="") as handle:
        for idx, row in enumerate(csv.DictReader(handle), start=1):
            smiles = (row.get("SMILES") or "").strip()
            if not smiles:
                continue
            external_id = row.get("ID")
            rows.append((row_hash(resource_id, idx, external_id, smiles, prefix="RR_CMP"), resource_id, external_id, row.get("InChI"), smiles, idx))
    conn.executemany(
        """
        INSERT OR IGNORE INTO readretro_compounds (
          compound_id, source_resource_id, external_id, inchi, smiles, source_row
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    conn.commit()
    return len(rows)


def csv_data_rows(path: Path) -> int | None:
    if not path.exists():
        return None
    return max(0, line_count(path) - 1)


def import_subnetx_cases(conn: sqlite3.Connection, epfl_root: Path, resource_id: str) -> int:
    rows = []
    for case_dir in sorted(path for path in epfl_root.iterdir() if path.is_dir()):
        target = case_dir.name
        reaction_count = csv_data_rows(case_dir / "output_optimization_input" / "reactions.tsv")
        compound_count = csv_data_rows(case_dir / "output_optimization_input" / "compounds.tsv")
        nice = case_dir / "auxilary_output" / "NICEpathways_linear.txt"
        nice_count = line_count(nice) if nice.exists() else None
        minimal_count = csv_data_rows(case_dir / "minimal_subnets_1_production.csv")
        pthws_count = csv_data_rows(case_dir / "pthws_info_1_min.csv")
        stats = {}
        stats_path = case_dir / "stats" / "converged_graph_stats.csv"
        if stats_path.exists():
            with stats_path.open("r", encoding="utf-8", errors="replace") as handle:
                for line in handle:
                    parts = line.rstrip("\n").split(",", 1)
                    if len(parts) == 2:
                        stats[parts[0]] = parts[1]
        rows.append(
            (
                row_hash(resource_id, target, prefix="SNX_CASE"),
                resource_id,
                target,
                reaction_count,
                compound_count,
                nice_count,
                minimal_count,
                pthws_count,
                json.dumps(stats, ensure_ascii=False),
                str(case_dir),
            )
        )
    conn.executemany(
        """
        INSERT OR IGNORE INTO subnetx_cases (
          case_id, source_resource_id, target_name, reaction_count, compound_count,
          nicepathway_count, minimal_subnet_count, pthws_info_count, stats_json, local_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    conn.commit()
    return len(rows)


def register_project_reference(conn: sqlite3.Connection, resource_id: str, source_name: str, source_url: str, path: Path, license_note: str) -> None:
    if path.is_file():
        register_file(conn, resource_id, source_name, source_url, path, license_note)
        return
    # Directory resources are registered with a deterministic pseudo checksum over immediate file names.
    names = []
    for item in sorted(path.rglob("*")):
        if item.is_file():
            try:
                names.append(f"{item.relative_to(path)}:{item.stat().st_size}")
            except OSError:
                continue
    digest = hashlib.sha256("\n".join(names).encode("utf-8", errors="replace")).hexdigest()
    conn.execute(
        """
        INSERT INTO resource_files (
          resource_id, source_name, source_url, local_path, file_name,
          file_size_bytes, sha256, license_note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (resource_id, source_name, source_url, str(path), path.name, sum((p.stat().st_size for p in path.rglob("*") if p.is_file()), 0), digest, license_note),
    )
    conn.commit()


def write_summary(conn: sqlite3.Connection, output_db: Path) -> Path:
    summary = {
        "output_db": str(output_db),
        "resource_files": conn.execute("SELECT COUNT(*) FROM resource_files").fetchone()[0],
        "retrobiocat_rules": conn.execute("SELECT COUNT(*) FROM retrobiocat_reaction_rules").fetchone()[0],
        "retrobiocat_smarts": conn.execute("SELECT COUNT(*) FROM retrobiocat_rule_smarts").fetchone()[0],
        "retrobiocat_rule_enzymes": conn.execute("SELECT COUNT(*) FROM retrobiocat_rule_enzymes").fetchone()[0],
        "retrobiocat_rule_tests": conn.execute("SELECT COUNT(*) FROM retrobiocat_rule_tests").fetchone()[0],
        "retrobiocat_activity_evidence": conn.execute("SELECT COUNT(*) FROM retrobiocat_activity_evidence").fetchone()[0],
        "retrobiocat_metabolites": conn.execute("SELECT COUNT(*) FROM retrobiocat_metabolites").fetchone()[0],
        "bionavi_rules": conn.execute("SELECT COUNT(*) FROM bionavi_reaction_rules").fetchone()[0],
        "bionavi_rule_references": conn.execute("SELECT COUNT(*) FROM bionavi_rule_references").fetchone()[0],
        "bionavi_building_blocks": conn.execute("SELECT COUNT(*) FROM bionavi_building_blocks").fetchone()[0],
        "benchmark_sets": conn.execute("SELECT COUNT(*) FROM retrosynthesis_benchmark_sets").fetchone()[0],
        "benchmark_reactions": conn.execute("SELECT COUNT(*) FROM retrosynthesis_benchmark_reactions").fetchone()[0],
        "route_targets": conn.execute("SELECT COUNT(*) FROM retrosynthesis_route_targets").fetchone()[0],
        "readretro_compounds": conn.execute("SELECT COUNT(*) FROM readretro_compounds").fetchone()[0],
        "subnetx_cases": conn.execute("SELECT COUNT(*) FROM subnetx_cases").fetchone()[0],
        "external_building_block_sources": [dict(row) for row in conn.execute("SELECT source_table, row_count, integration_mode, local_path FROM retrobiocat_external_building_block_sources ORDER BY source_table")],
        "rules_by_type": [dict(row) for row in conn.execute("SELECT reaction_type, COUNT(*) AS count FROM retrobiocat_reaction_rules GROUP BY reaction_type ORDER BY count DESC")],
        "top_rule_enzyme_types": [dict(row) for row in conn.execute("SELECT enzyme_type, COUNT(*) AS count FROM retrobiocat_rule_enzymes GROUP BY enzyme_type ORDER BY count DESC, enzyme_type LIMIT 25")],
        "activity_by_reaction": [dict(row) for row in conn.execute("SELECT reaction_name, COUNT(*) AS count FROM retrobiocat_activity_evidence GROUP BY reaction_name ORDER BY count DESC, reaction_name LIMIT 25")],
        "bionavi_rules_by_source": [dict(row) for row in conn.execute("SELECT rule_source, COUNT(*) AS count FROM bionavi_reaction_rules GROUP BY rule_source ORDER BY count DESC")],
        "benchmark_sets_detail": [dict(row) for row in conn.execute("SELECT dataset_name, split_name, record_count FROM retrosynthesis_benchmark_sets ORDER BY dataset_name, split_name")],
    }
    path = output_db.with_suffix(".summary.json")
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a standalone retrosynthesis resource SQLite layer.")
    parser.add_argument("--retro-root", type=Path, default=DEFAULT_RETRO_ROOT)
    parser.add_argument("--output-db", type=Path, default=DEFAULT_OUTPUT_DB)
    args = parser.parse_args()

    retro_root = args.retro_root
    retrobiocat_dir = retro_root / "_external_downloads" / "retrobiocat_db_figshare_12696482"
    if not retrobiocat_dir.exists():
        raise FileNotFoundError(retrobiocat_dir)

    yaml_path = retrobiocat_dir / "rxns_yaml.yaml"
    xlsx_path = retrobiocat_dir / "trial_activity_data.xlsx"
    building_blocks_db = retrobiocat_dir / "building_blocks.db"
    source_mols_db = retrobiocat_dir / "source_mols.db"

    if args.output_db.exists():
        args.output_db.unlink()
    for suffix in ["-wal", "-shm"]:
        sidecar = Path(str(args.output_db) + suffix)
        if sidecar.exists():
            sidecar.unlink()

    conn = connect(args.output_db)
    setup(conn)

    license_note = "RetroBioCat Figshare data; cite original paper and Figshare records. Keep source-specific database/license notes in downstream exports."
    register_file(conn, "retrobiocat_rxns_yaml", "RetroBioCat database files", "https://doi.org/10.6084/m9.figshare.12696482.v4", yaml_path, license_note)
    register_file(conn, "retrobiocat_trial_activity", "RetroBioCat database files", "https://doi.org/10.6084/m9.figshare.12696482.v4", xlsx_path, license_note)
    register_file(conn, "retrobiocat_buyable_db", "RetroBioCat database files", "https://doi.org/10.6084/m9.figshare.12696482.v4", building_blocks_db, license_note)
    register_file(conn, "retrobiocat_source_mols", "RetroBioCat database files", "https://doi.org/10.6084/m9.figshare.12696482.v4", source_mols_db, license_note)

    log("[rules] importing RetroBioCat reaction rules")
    rule_stats = import_rules(conn, yaml_path)
    log(f"[rules] {rule_stats}")

    log("[activity] importing RetroBioCat trial activity evidence")
    activity_count = import_activity_evidence(conn, xlsx_path)
    log(f"[activity] {activity_count:,} rows")

    log("[metabolites] importing RetroBioCat metabolites")
    metabolite_count = import_metabolites(conn, source_mols_db)
    log(f"[metabolites] {metabolite_count:,} rows")

    log("[building-blocks] registering large external building-block sources")
    source_count = register_external_block_sources(conn, building_blocks_db, source_mols_db)
    log(f"[building-blocks] {source_count} source tables registered")

    log("[bionavi] importing BioNavi rules, building blocks, and route targets")
    bionavi_root = find_dir(retro_root, "BioNavi-main") / "BioNavi-main"
    bionavi_license = "BioNavi repository is MIT; upstream KEGG/MetaCyc/BRENDA/Rhea/USPTO references remain source-specific."
    bionavi_enz_rules = bionavi_root / "dataset" / "rxn_data" / "enzymatic_rule.json"
    bionavi_uspto_rules = bionavi_root / "dataset" / "rxn_data" / "uspto_rule.json"
    bionavi_bio_blocks = bionavi_root / "dataset" / "building_block" / "bio_building_block.csv"
    bionavi_chemo_blocks = bionavi_root / "dataset" / "building_block" / "chemo_building_block.csv"
    bionavi_all_blocks = bionavi_root / "dataset" / "building_block" / "all_building_block.csv"
    bionavi_biosynthetic_routes = bionavi_root / "dataset" / "test_data" / "biosynthetic_set.txt"
    bionavi_drugs = bionavi_root / "dataset" / "test_data" / "drugs.txt"
    register_file(conn, "bionavi_enzymatic_rules", "BioNavi", "https://github.com/zengtsysu/BioNavi", bionavi_enz_rules, bionavi_license)
    register_file(conn, "bionavi_uspto_rules", "BioNavi", "https://github.com/zengtsysu/BioNavi", bionavi_uspto_rules, bionavi_license)
    register_file(conn, "bionavi_bio_building_blocks", "BioNavi", "https://github.com/zengtsysu/BioNavi", bionavi_bio_blocks, bionavi_license)
    register_file(conn, "bionavi_chemo_building_blocks", "BioNavi", "https://github.com/zengtsysu/BioNavi", bionavi_chemo_blocks, bionavi_license)
    register_file(conn, "bionavi_all_building_blocks", "BioNavi", "https://github.com/zengtsysu/BioNavi", bionavi_all_blocks, bionavi_license)
    register_file(conn, "bionavi_biosynthetic_routes", "BioNavi", "https://github.com/zengtsysu/BioNavi", bionavi_biosynthetic_routes, bionavi_license)
    register_file(conn, "bionavi_drug_targets", "BioNavi", "https://github.com/zengtsysu/BioNavi", bionavi_drugs, bionavi_license)
    bionavi_stats = {
        "enzymatic_rules": import_bionavi_rules(conn, bionavi_enz_rules, "bionavi_enzymatic_rules", "enzymatic_metabolic"),
        "uspto_rules": import_bionavi_rules(conn, bionavi_uspto_rules, "bionavi_uspto_rules", "uspto_organic_or_hybrid"),
        "bio_blocks": import_bionavi_building_blocks(conn, bionavi_bio_blocks, "bionavi_bio_building_blocks", "BioNavi bio building blocks", "bio"),
        "chemo_blocks": import_bionavi_building_blocks(conn, bionavi_chemo_blocks, "bionavi_chemo_building_blocks", "BioNavi chemo building blocks", "chemo"),
        "all_blocks": import_bionavi_building_blocks(conn, bionavi_all_blocks, "bionavi_all_building_blocks", "BioNavi all building blocks", "mixed"),
        "biosynthetic_routes": import_route_targets(conn, bionavi_biosynthetic_routes, "bionavi_biosynthetic_routes", "BioNavi biosynthetic_set", "bionavi_biosynthetic"),
        "drug_targets": import_route_targets(conn, bionavi_drugs, "bionavi_drug_targets", "BioNavi drug targets", "bionavi_drugs"),
    }
    log(f"[bionavi] {bionavi_stats}")

    log("[bionavi-np] importing BioNavi-NP benchmark reactions and targets")
    bionavi_np_root = find_dir(retro_root, "BioNavi-NP-main")
    bionavi_np_data = next(path for path in bionavi_np_root.iterdir() if path.is_dir() and path.name.startswith("BioNavi-NP") and path.name != "BioNavi-NP-main")
    bionavi_np_license = "BioNavi-NP data derived from KEGG/MetaCyc/MetaNetX and model-ready processed splits; cite original paper and source databases."
    for split in ["train", "valid", "test"]:
        resource_id = f"bionavi_np_biochem_{split}"
        path = bionavi_np_data / "biochem" / f"{split}.txt"
        register_file(conn, resource_id, "BioNavi-NP", "https://github.com/prokia/BioNavi-NP", path, bionavi_np_license)
        imported = import_txt_benchmark(conn, path, resource_id, "BioNavi-NP biochem", split, "single_step_retrosynthesis")
        log(f"[bionavi-np] biochem {split}: {imported:,}")
    bnp_uspto = bionavi_np_data / "USPTO_NPL.txt"
    bnp_targets = bionavi_np_data / "Multi-step test set.txt"
    register_file(conn, "bionavi_np_uspto_npl", "BioNavi-NP", "https://github.com/prokia/BioNavi-NP", bnp_uspto, bionavi_np_license)
    register_file(conn, "bionavi_np_multistep_targets", "BioNavi-NP", "https://github.com/prokia/BioNavi-NP", bnp_targets, bionavi_np_license)
    log(f"[bionavi-np] USPTO_NPL: {import_txt_benchmark(conn, bnp_uspto, 'bionavi_np_uspto_npl', 'BioNavi-NP USPTO_NPL', 'all', 'single_step_hybrid_retrosynthesis'):,}")
    log(f"[bionavi-np] multistep targets: {import_route_targets(conn, bnp_targets, 'bionavi_np_multistep_targets', 'BioNavi-NP multistep targets', 'bionavi_np_targets'):,}")

    log("[readretro] importing READRetro model-ready splits, compounds, building blocks, and targets")
    readretro_root = find_dir(retro_root, "RE_data")
    readretro_license = "READRetro data from Zenodo/GitHub; cite READRetro and upstream BioNavi/BioChem/USPTO_NPL sources."
    raw_base = readretro_root / "data" / "model_train_data" / "Retroformer" / "BioChem_USPTO_NPL_clean"
    for split in ["train", "val", "test"]:
        resource_id = f"readretro_raw_{split}"
        path = raw_base / f"raw_{split}.csv"
        register_file(conn, resource_id, "READRetro", "https://zenodo.org/records/11530384", path, readretro_license)
        imported = import_raw_csv_benchmark(conn, path, resource_id, "READRetro BioChem_USPTO_NPL_clean Retroformer", split)
        log(f"[readretro] raw {split}: {imported:,}")
    rr_multistep_train = readretro_root / "data" / "multistep_data" / "train_canonicalized.txt"
    rr_multistep_test = readretro_root / "data" / "multistep_data" / "test.txt"
    rr_compounds = readretro_root / "data" / "multistep_data" / "kegg_neutral_iso_smi.csv"
    rr_blocks = readretro_root / "data" / "multistep_data" / "building_block.csv"
    rr_pathways = readretro_root / "data" / "multistep_data" / "pathways.pickle"
    register_file(conn, "readretro_multistep_train", "READRetro", "https://zenodo.org/records/11530384", rr_multistep_train, readretro_license)
    register_file(conn, "readretro_multistep_test", "READRetro", "https://zenodo.org/records/11530384", rr_multistep_test, readretro_license)
    register_file(conn, "readretro_kegg_compounds", "READRetro", "https://zenodo.org/records/11530384", rr_compounds, readretro_license)
    register_file(conn, "readretro_building_blocks", "READRetro", "https://zenodo.org/records/11530384", rr_blocks, readretro_license)
    register_file(conn, "readretro_pathways_pickle", "READRetro", "https://zenodo.org/records/11530384", rr_pathways, readretro_license)
    log(f"[readretro] multistep train: {import_txt_benchmark(conn, rr_multistep_train, 'readretro_multistep_train', 'READRetro multistep canonicalized', 'train', 'single_step_from_multistep_training'):,}")
    log(f"[readretro] multistep targets: {import_route_targets(conn, rr_multistep_test, 'readretro_multistep_test', 'READRetro multistep test targets', 'readretro_test'):,}")
    log(f"[readretro] KEGG compounds: {import_readretro_compounds(conn, rr_compounds, 'readretro_kegg_compounds'):,}")
    log(f"[readretro] amino-acid building blocks: {import_bionavi_building_blocks(conn, rr_blocks, 'readretro_building_blocks', 'READRetro amino acid building blocks', 'bio', has_header=True):,}")

    log("[subnetx] importing SubNetX/EPFL case summaries")
    epfl_root = find_dir(retro_root, "EPFL") / "EPFL"
    register_project_reference(conn, "subnetx_epfl_cases", "SubNetX EPFL cases", "https://zenodo.org/records/15119707", epfl_root, "SubNetX/EPFL extracted subnetworks and models; cite SubNetX Zenodo and paper.")
    log(f"[subnetx] cases: {import_subnetx_cases(conn, epfl_root, 'subnetx_epfl_cases'):,}")

    log("[external-projects] registering GSETRetro and ChemEnzyRetroPlanner project references")
    register_project_reference(conn, "gsetretro_project", "GSETRetro", "https://github.com/momozhangcn/GSETRetro", find_dir(retro_root, "GSETRetro-main"), "GSETRetro repository is MIT; data are derived from BioNavi/READRetro and should be treated as benchmark/model resources.")
    register_project_reference(conn, "chemenzyretroplanner_project", "ChemEnzyRetroPlanner", "https://github.com/wangxr0526/ChemEnzyRetroPlanner", find_dir(retro_root, "ChemEnzyRetroPlanner-main"), "ChemEnzyRetroPlanner repository is MIT; use as external tool reference unless model-weight package is installed.")

    summary_path = write_summary(conn, args.output_db)
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()
    log(f"[done] {args.output_db}")
    log(f"[summary] {summary_path}")


if __name__ == "__main__":
    main()
