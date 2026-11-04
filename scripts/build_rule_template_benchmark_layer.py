from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import sqlite3
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RETRO_DB = ROOT / "web_release" / "retrosynthesis_resources.sqlite"
DEFAULT_MODEL_DB = ROOT / "web_release" / "model_ready_dataset.sqlite"
DEFAULT_OUTPUT_DB = ROOT / "web_release" / "rule_template_benchmark.sqlite"
DEFAULT_DOWNLOAD_DIR = ROOT / "web_release" / "downloads"
DEFAULT_SUMMARY = ROOT / "web_release" / "rule_template_benchmark.summary.json"


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


def attach(conn: sqlite3.Connection, alias: str, path: Path) -> None:
    escaped = str(path).replace("'", "''")
    conn.execute(f"ATTACH DATABASE '{escaped}' AS {alias}")


def setup(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        DROP TABLE IF EXISTS rule_templates;
        DROP TABLE IF EXISTS rule_template_reaction_links;
        DROP TABLE IF EXISTS rule_template_enzyme_candidate_links;
        DROP TABLE IF EXISTS benchmark_task_reaction_to_enzyme;
        DROP TABLE IF EXISTS benchmark_task_substrate_product_to_reaction;
        DROP TABLE IF EXISTS benchmark_task_enzyme_ranking;
        DROP TABLE IF EXISTS benchmark_baselines;
        DROP TABLE IF EXISTS benchmark_evaluation_reaction_to_enzyme;
        DROP TABLE IF EXISTS benchmark_split_summary;
        DROP TABLE IF EXISTS benchmark_baseline_metrics;

        CREATE TABLE rule_templates (
          template_id TEXT PRIMARY KEY,
          source_name TEXT NOT NULL,
          source_rule_id TEXT NOT NULL,
          source_template_id TEXT,
          rule_source TEXT,
          rule_type TEXT,
          reaction_name TEXT,
          reaction_type TEXT,
          smarts TEXT,
          broad_specific_label TEXT NOT NULL,
          reference_reaction_count INTEGER NOT NULL DEFAULT 0,
          reference_molecule_count INTEGER NOT NULL DEFAULT 0,
          reference_enzyme_count INTEGER NOT NULL DEFAULT 0,
          positive_test_count INTEGER NOT NULL DEFAULT 0,
          negative_test_count INTEGER NOT NULL DEFAULT 0,
          enzyme_type_labels TEXT,
          cofactors_minus TEXT,
          cofactors_plus TEXT,
          support_note TEXT NOT NULL
        );
        CREATE INDEX idx_rule_templates_source ON rule_templates(source_name, rule_source);
        CREATE INDEX idx_rule_templates_label ON rule_templates(broad_specific_label);

        CREATE TABLE rule_template_reaction_links (
          link_id TEXT PRIMARY KEY,
          template_id TEXT NOT NULL,
          reaction_id TEXT NOT NULL,
          reactenz_reaction_id TEXT NOT NULL,
          link_method TEXT NOT NULL,
          external_db TEXT,
          external_id TEXT,
          ec_number TEXT,
          rhea_id TEXT,
          kegg_reaction_id TEXT,
          metacyc_reaction_id TEXT,
          mnx_reaction_ids TEXT,
          reaction_equation_display TEXT,
          canonical_reaction_smiles TEXT,
          formula_balance_status TEXT,
          quality_flags TEXT
        );
        CREATE INDEX idx_template_reaction_template ON rule_template_reaction_links(template_id);
        CREATE INDEX idx_template_reaction_reaction ON rule_template_reaction_links(reaction_id);

        CREATE TABLE rule_template_enzyme_candidate_links (
          template_id TEXT NOT NULL,
          reaction_id TEXT NOT NULL,
          reactenz_reaction_id TEXT NOT NULL,
          biopart_id TEXT NOT NULL,
          reactenz_enzyme_id TEXT,
          enzyme_name TEXT,
          organism TEXT,
          chassis_labels TEXT,
          kinetic_record_count INTEGER,
          enzyme_evidence_score INTEGER,
          structure_confidence_score INTEGER,
          interpro_count INTEGER,
          pfam_count INTEGER,
          active_site_count INTEGER,
          binding_site_count INTEGER,
          conserved_site_count INTEGER,
          baseline_rank_score REAL,
          PRIMARY KEY (template_id, reaction_id, biopart_id)
        );
        CREATE INDEX idx_template_candidate_template ON rule_template_enzyme_candidate_links(template_id);
        CREATE INDEX idx_template_candidate_reaction ON rule_template_enzyme_candidate_links(reaction_id);

        CREATE TABLE benchmark_task_reaction_to_enzyme (
          task_entry_id TEXT PRIMARY KEY,
          task_name TEXT NOT NULL,
          query_reaction_id TEXT NOT NULL,
          query_reactenz_reaction_id TEXT NOT NULL,
          query_ec_number TEXT,
          query_rhea_id TEXT,
          query_mnx_reaction_ids TEXT,
          query_canonical_reaction_smiles TEXT,
          positive_biopart_id TEXT NOT NULL,
          positive_reactenz_enzyme_id TEXT,
          enzyme_name TEXT,
          organism TEXT,
          chassis_labels TEXT,
          evidence_score INTEGER,
          kinetic_record_count INTEGER,
          structure_confidence_score INTEGER,
          baseline_rank_score REAL,
          label TEXT NOT NULL DEFAULT 'positive_reaction_enzyme_link'
        );
        CREATE INDEX idx_bench_rxn_enzyme_reaction ON benchmark_task_reaction_to_enzyme(query_reaction_id);

        CREATE TABLE benchmark_task_substrate_product_to_reaction (
          task_entry_id TEXT PRIMARY KEY,
          task_name TEXT NOT NULL,
          query_reactants_smiles TEXT,
          query_products_smiles TEXT,
          query_canonical_reaction_smiles TEXT,
          gold_reaction_id TEXT NOT NULL,
          gold_reactenz_reaction_id TEXT NOT NULL,
          ec_number TEXT,
          ec_class TEXT,
          rhea_id TEXT,
          mnx_reaction_ids TEXT,
          formula_balance_status TEXT,
          quality_flags TEXT,
          evidence_score INTEGER,
          label TEXT NOT NULL DEFAULT 'positive_reaction_match'
        );
        CREATE INDEX idx_bench_subprod_reaction ON benchmark_task_substrate_product_to_reaction(gold_reaction_id);

        CREATE TABLE benchmark_task_enzyme_ranking (
          task_entry_id TEXT PRIMARY KEY,
          task_name TEXT NOT NULL,
          query_reaction_id TEXT NOT NULL,
          query_reactenz_reaction_id TEXT NOT NULL,
          candidate_biopart_id TEXT NOT NULL,
          candidate_reactenz_enzyme_id TEXT,
          enzyme_name TEXT,
          organism TEXT,
          chassis_labels TEXT,
          enzyme_evidence_score INTEGER,
          kinetic_record_count INTEGER,
          structure_confidence_score INTEGER,
          interpro_count INTEGER,
          pfam_count INTEGER,
          active_site_count INTEGER,
          binding_site_count INTEGER,
          conserved_site_count INTEGER,
          baseline_rank_score REAL,
          baseline_rank INTEGER,
          label TEXT NOT NULL DEFAULT 'candidate_for_reaction'
        );
        CREATE INDEX idx_bench_rank_reaction ON benchmark_task_enzyme_ranking(query_reaction_id, baseline_rank);

        CREATE TABLE benchmark_baselines (
          task_name TEXT PRIMARY KEY,
          baseline_name TEXT NOT NULL,
          baseline_description TEXT NOT NULL,
          input_table TEXT NOT NULL,
          output_table TEXT NOT NULL,
          metric_suggestion TEXT NOT NULL
        );

        CREATE TABLE benchmark_evaluation_reaction_to_enzyme (
          task_entry_id TEXT PRIMARY KEY,
          task_name TEXT NOT NULL,
          split_name TEXT NOT NULL,
          split_policy TEXT NOT NULL,
          query_reaction_id TEXT NOT NULL,
          query_reactenz_reaction_id TEXT NOT NULL,
          query_ec_class TEXT,
          query_canonical_reaction_smiles TEXT NOT NULL,
          candidate_biopart_id TEXT NOT NULL,
          candidate_reactenz_enzyme_id TEXT,
          enzyme_name TEXT,
          organism TEXT,
          evidence_score INTEGER,
          kinetic_record_count INTEGER,
          structure_confidence_score INTEGER,
          chassis_count INTEGER,
          interpro_count INTEGER,
          pfam_count INTEGER,
          active_site_count INTEGER,
          binding_site_count INTEGER,
          conserved_site_count INTEGER,
          baseline_rank_score REAL NOT NULL,
          baseline_rank INTEGER NOT NULL,
          label INTEGER NOT NULL,
          label_description TEXT NOT NULL,
          candidate_partition TEXT NOT NULL
        );
        CREATE INDEX idx_eval_r2e_split_query ON benchmark_evaluation_reaction_to_enzyme(split_name, query_reaction_id, baseline_rank);
        CREATE INDEX idx_eval_r2e_candidate ON benchmark_evaluation_reaction_to_enzyme(candidate_biopart_id);

        CREATE TABLE benchmark_split_summary (
          task_name TEXT NOT NULL,
          split_name TEXT NOT NULL,
          split_policy TEXT NOT NULL,
          query_count INTEGER NOT NULL,
          candidate_rows INTEGER NOT NULL,
          positive_rows INTEGER NOT NULL,
          sampled_decoy_rows INTEGER NOT NULL,
          PRIMARY KEY (task_name, split_name)
        );

        CREATE TABLE benchmark_baseline_metrics (
          task_name TEXT NOT NULL,
          split_name TEXT NOT NULL,
          baseline_name TEXT NOT NULL,
          metric_name TEXT NOT NULL,
          metric_value REAL NOT NULL,
          query_count INTEGER NOT NULL,
          notes TEXT NOT NULL,
          PRIMARY KEY (task_name, split_name, baseline_name, metric_name)
        );
        """
    )


def baseline_score_sql(alias: str = "c") -> str:
    return f"""(
      COALESCE({alias}.enzyme_evidence_score, 0) * 0.35 +
      COALESCE({alias}.structure_confidence_score, 0) * 0.25 +
      CASE WHEN COALESCE({alias}.kinetic_record_count, 0) > 0 THEN 12 ELSE 0 END +
      CASE WHEN COALESCE({alias}.chassis_count, 0) > 0 THEN 8 ELSE 0 END +
      CASE WHEN COALESCE({alias}.interpro_count, 0) + COALESCE({alias}.pfam_count, 0) > 0 THEN 5 ELSE 0 END +
      CASE WHEN COALESCE({alias}.active_site_count, 0) + COALESCE({alias}.binding_site_count, 0) + COALESCE({alias}.conserved_site_count, 0) > 0 THEN 10 ELSE 0 END
    )"""


def build_rule_templates(conn: sqlite3.Connection) -> None:
    log("Building rule templates")
    conn.executescript(
        """
        INSERT INTO rule_templates
        SELECT
          'BN_' || r.rule_id AS template_id,
          'BioNavi' AS source_name,
          r.rule_id AS source_rule_id,
          r.rule_id AS source_template_id,
          r.rule_source,
          r.rule_type,
          NULL AS reaction_name,
          NULL AS reaction_type,
          r.smarts,
          CASE
            WHEN r.rule_source = 'uspto_organic_or_hybrid' THEN 'broad'
            WHEN r.reference_reaction_count >= 100 THEN 'broad'
            WHEN r.reference_reaction_count <= 3 THEN 'specific'
            ELSE 'medium'
          END AS broad_specific_label,
          r.reference_reaction_count,
          r.reference_molecule_count,
          r.reference_enzyme_count,
          0 AS positive_test_count,
          0 AS negative_test_count,
          NULL AS enzyme_type_labels,
          NULL AS cofactors_minus,
          NULL AS cofactors_plus,
          'BioNavi reaction SMARTS retained from upstream rule files; ReactEnzDB links use exact external identifiers only.' AS support_note
        FROM retro.bionavi_reaction_rules r;

        INSERT INTO rule_templates
        SELECT
          'RBC_' || s.smarts_id AS template_id,
          'RetroBioCat' AS source_name,
          r.rule_id AS source_rule_id,
          s.smarts_id AS source_template_id,
          'retrobiocat_biocatalytic_rule' AS rule_source,
          NULL AS rule_type,
          r.reaction_name,
          r.reaction_type,
          s.smarts,
          CASE
            WHEN r.positive_test_count + r.negative_test_count >= 8 THEN 'medium'
            ELSE 'specific'
          END AS broad_specific_label,
          r.smarts_count AS reference_reaction_count,
          0 AS reference_molecule_count,
          r.enzyme_count AS reference_enzyme_count,
          r.positive_test_count,
          r.negative_test_count,
          enz.enzyme_type_labels,
          enz.cofactors_minus,
          enz.cofactors_plus,
          'RetroBioCat reaction SMARTS and enzyme-type labels are retained as rule metadata; not forced onto UniProt-level enzyme records without direct identifiers.' AS support_note
        FROM retro.retrobiocat_rule_smarts s
        JOIN retro.retrobiocat_reaction_rules r ON r.rule_id = s.rule_id
        LEFT JOIN (
          SELECT rule_id,
                 GROUP_CONCAT(DISTINCT enzyme_type) AS enzyme_type_labels,
                 GROUP_CONCAT(DISTINCT cofactors_minus) AS cofactors_minus,
                 GROUP_CONCAT(DISTINCT cofactors_plus) AS cofactors_plus
          FROM retro.retrobiocat_rule_enzymes
          GROUP BY rule_id
        ) enz ON enz.rule_id = r.rule_id;
        """
    )
    conn.commit()


def build_template_reaction_links(conn: sqlite3.Connection) -> None:
    log("Linking templates to ReactEnzDB reactions")
    conn.executescript(
        """
        DROP TABLE IF EXISTS temp_model_external_refs;
        DROP TABLE IF EXISTS temp_bionavi_refs;
        CREATE TEMP TABLE temp_model_external_refs (
          external_db TEXT NOT NULL,
          external_id_norm TEXT NOT NULL,
          reaction_id TEXT NOT NULL,
          reactenz_reaction_id TEXT NOT NULL,
          ec_number TEXT,
          rhea_id TEXT,
          kegg_reaction_id TEXT,
          metacyc_reaction_id TEXT,
          mnx_reaction_ids TEXT,
          reaction_equation_display TEXT,
          canonical_reaction_smiles TEXT,
          formula_balance_status TEXT,
          quality_flags TEXT
        );
        """
    )
    rows = conn.execute(
        """
        SELECT reaction_id, reactenz_reaction_id, ec_number, rhea_id, kegg_reaction_id, metacyc_reaction_id,
               mnx_reaction_ids, reaction_equation_display, canonical_reaction_smiles, formula_balance_status, quality_flags
        FROM model.model_ready_reactions
        """
    ).fetchall()
    external_rows: list[tuple[Any, ...]] = []
    for row in rows:
        base = (
            row["reaction_id"],
            row["reactenz_reaction_id"],
            row["ec_number"],
            row["rhea_id"],
            row["kegg_reaction_id"],
            row["metacyc_reaction_id"],
            row["mnx_reaction_ids"],
            row["reaction_equation_display"],
            row["canonical_reaction_smiles"],
            row["formula_balance_status"],
            row["quality_flags"],
        )
        for ec in str(row["ec_number"] or "").replace("EC:", "").replace("EC-", "").split(";"):
            ec = ec.strip()
            if ec:
                external_rows.append(("BRENDA_EC", ec, *base))
        rhea = str(row["rhea_id"] or "").replace("RHEA:", "").replace("RHEA-", "").strip()
        if rhea:
            external_rows.append(("Rhea", rhea, *base))
        if row["kegg_reaction_id"]:
            external_rows.append(("KEGG", row["kegg_reaction_id"], *base))
        if row["metacyc_reaction_id"]:
            external_rows.append(("MetaCyc", row["metacyc_reaction_id"], *base))

    conn.executemany(
        """
        INSERT INTO temp_model_external_refs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        external_rows,
    )
    conn.executescript(
        """
        CREATE INDEX idx_temp_model_refs ON temp_model_external_refs(external_db, external_id_norm);
        CREATE TEMP TABLE temp_bionavi_refs AS
        SELECT reference_id,
               rule_id,
               external_db,
               external_id,
               CASE
                 WHEN external_db = 'BRENDA_EC' THEN replace(replace(external_id, 'EC:', ''), 'EC-', '')
                 WHEN external_db = 'Rhea' THEN replace(replace(external_id, 'RHEA:', ''), 'RHEA-', '')
                 ELSE external_id
               END AS external_id_norm
        FROM retro.bionavi_rule_references
        WHERE external_db IN ('BRENDA_EC', 'Rhea', 'KEGG', 'MetaCyc') AND external_id IS NOT NULL;
        CREATE INDEX idx_temp_bionavi_refs ON temp_bionavi_refs(external_db, external_id_norm);

        INSERT OR IGNORE INTO rule_template_reaction_links
        SELECT DISTINCT
          'BNREF_' || ref.reference_id || '_' || mr.reaction_id AS link_id,
          'BN_' || ref.rule_id AS template_id,
          mr.reaction_id,
          mr.reactenz_reaction_id,
          'exact_external_identifier' AS link_method,
          ref.external_db,
          ref.external_id,
          mr.ec_number,
          mr.rhea_id,
          mr.kegg_reaction_id,
          mr.metacyc_reaction_id,
          mr.mnx_reaction_ids,
          mr.reaction_equation_display,
          mr.canonical_reaction_smiles,
          mr.formula_balance_status,
          mr.quality_flags
        FROM temp_bionavi_refs ref
        JOIN temp_model_external_refs mr
          ON mr.external_db = ref.external_db
         AND mr.external_id_norm = ref.external_id_norm;
        """
    )
    conn.commit()


def build_template_candidate_links(conn: sqlite3.Connection) -> None:
    log("Linking templates to enzyme candidates")
    score = baseline_score_sql("c")
    conn.executescript(
        f"""
        INSERT OR IGNORE INTO rule_template_enzyme_candidate_links
        SELECT DISTINCT
          l.template_id,
          c.reaction_id,
          c.reactenz_reaction_id,
          c.biopart_id,
          c.reactenz_enzyme_id,
          c.enzyme_name,
          c.organism,
          c.chassis_labels,
          c.kinetic_record_count,
          c.enzyme_evidence_score,
          c.structure_confidence_score,
          c.interpro_count,
          c.pfam_count,
          c.active_site_count,
          c.binding_site_count,
          c.conserved_site_count,
          {score} AS baseline_rank_score
        FROM rule_template_reaction_links l
        JOIN model.model_ready_enzyme_candidates c ON c.reaction_id = l.reaction_id;
        """
    )
    conn.commit()


def build_benchmark_tasks(conn: sqlite3.Connection) -> None:
    log("Building benchmark tasks")
    score = baseline_score_sql("c")
    conn.executescript(
        f"""
        INSERT INTO benchmark_task_reaction_to_enzyme
        SELECT
          'RXN2ENZ_' || c.reaction_id || '_' || c.biopart_id AS task_entry_id,
          'reaction_to_enzyme_retrieval' AS task_name,
          r.reaction_id AS query_reaction_id,
          r.reactenz_reaction_id AS query_reactenz_reaction_id,
          r.ec_number AS query_ec_number,
          r.rhea_id AS query_rhea_id,
          r.mnx_reaction_ids AS query_mnx_reaction_ids,
          r.canonical_reaction_smiles AS query_canonical_reaction_smiles,
          c.biopart_id AS positive_biopart_id,
          c.reactenz_enzyme_id AS positive_reactenz_enzyme_id,
          c.enzyme_name,
          c.organism,
          c.chassis_labels,
          c.enzyme_evidence_score AS evidence_score,
          c.kinetic_record_count,
          c.structure_confidence_score,
          {score} AS baseline_rank_score,
          'positive_reaction_enzyme_link' AS label
        FROM model.model_ready_reactions r
        JOIN model.model_ready_enzyme_candidates c ON c.reaction_id = r.reaction_id
        WHERE r.canonical_reaction_smiles IS NOT NULL;

        INSERT INTO benchmark_task_substrate_product_to_reaction
        SELECT
          'SUBPROD2RXN_' || r.reaction_id AS task_entry_id,
          'substrate_product_to_reaction_retrieval' AS task_name,
          r.canonical_reactants_smiles AS query_reactants_smiles,
          r.canonical_products_smiles AS query_products_smiles,
          r.canonical_reaction_smiles AS query_canonical_reaction_smiles,
          r.reaction_id AS gold_reaction_id,
          r.reactenz_reaction_id AS gold_reactenz_reaction_id,
          r.ec_number,
          r.ec_class,
          r.rhea_id,
          r.mnx_reaction_ids,
          r.formula_balance_status,
          r.quality_flags,
          r.evidence_score,
          'positive_reaction_match' AS label
        FROM model.model_ready_reactions r
        WHERE r.canonical_reaction_smiles IS NOT NULL
          AND r.non_currency_reactant_count > 0
          AND r.non_currency_product_count > 0
          AND r.only_currency_transformation = 0;

        WITH ranked AS (
          SELECT
            c.*,
            {score} AS baseline_rank_score,
            ROW_NUMBER() OVER (
              PARTITION BY c.reaction_id
              ORDER BY {score} DESC, c.enzyme_evidence_score DESC, c.structure_confidence_score DESC, c.biopart_id
            ) AS baseline_rank
          FROM model.model_ready_enzyme_candidates c
        )
        INSERT INTO benchmark_task_enzyme_ranking
        SELECT
          'ENZRANK_' || reaction_id || '_' || biopart_id AS task_entry_id,
          'enzyme_candidate_ranking' AS task_name,
          reaction_id AS query_reaction_id,
          reactenz_reaction_id AS query_reactenz_reaction_id,
          biopart_id AS candidate_biopart_id,
          reactenz_enzyme_id AS candidate_reactenz_enzyme_id,
          enzyme_name,
          organism,
          chassis_labels,
          enzyme_evidence_score,
          kinetic_record_count,
          structure_confidence_score,
          interpro_count,
          pfam_count,
          active_site_count,
          binding_site_count,
          conserved_site_count,
          baseline_rank_score,
          baseline_rank,
          'candidate_for_reaction' AS label
        FROM ranked;

        INSERT INTO benchmark_baselines VALUES
          (
            'reaction_to_enzyme_retrieval',
            'evidence_structure_kinetics_baseline',
            'Rank linked enzyme candidates by weighted evidence score, structure confidence, kinetic support, chassis evidence, InterPro/Pfam annotation, and functional-site annotation.',
            'benchmark_task_reaction_to_enzyme',
            'positive_biopart_id ordered by baseline_rank_score',
            'Recall@K, MRR, nDCG; report reaction-level grouped evaluation.'
          ),
          (
            'substrate_product_to_reaction_retrieval',
            'exact_canonical_reaction_smiles_baseline',
            'Use exact RDKit-canonical reactants>>products string matching as a transparent lower-bound retrieval baseline.',
            'benchmark_task_substrate_product_to_reaction',
            'gold_reaction_id',
            'Top-1 exact match rate, Recall@K for candidate reaction search.'
          ),
          (
            'enzyme_candidate_ranking',
            'evidence_structure_kinetics_baseline',
            'Rank all candidates for each reaction using the same weighted evidence/structure/kinetics/chassis/domain/site score.',
            'benchmark_task_enzyme_ranking',
            'candidate_biopart_id ordered by baseline_rank',
            'nDCG, MRR, precision@K against curated positives or evidence-tier labels.'
          );
        """
    )
    conn.commit()


def stable_split(value: str) -> str:
    bucket = int(hashlib.sha256(value.encode("utf-8")).hexdigest()[:8], 16) % 100
    if bucket < 80:
        return "train"
    if bucket < 90:
        return "validation"
    return "test"


def candidate_baseline_score(candidate: dict[str, Any]) -> float:
    return (
        float(candidate["evidence_score"] or 0) * 0.35
        + float(candidate["structure_confidence_score"] or 0) * 0.25
        + (12 if int(candidate["kinetic_record_count"] or 0) > 0 else 0)
        + (8 if int(candidate["chassis_count"] or 0) > 0 else 0)
        + (5 if int(candidate["interpro_count"] or 0) + int(candidate["pfam_count"] or 0) > 0 else 0)
        + (10 if int(candidate["active_site_count"] or 0) + int(candidate["binding_site_count"] or 0) + int(candidate["conserved_site_count"] or 0) > 0 else 0)
    )


def dcg_at_k(labels: list[int], k: int) -> float:
    return sum(label / __import__("math").log2(index + 2) for index, label in enumerate(labels[:k]))


def build_evaluation_split(conn: sqlite3.Connection) -> dict[str, Any]:
    """Create a deterministic candidate-retrieval evaluation set with explicit decoys."""
    log("Building leakage-aware reaction-to-enzyme evaluation split")
    split_policy = "canonical_reaction_grouped_and_exact_biopart_disjoint_v1"
    reactions = {
        row["reaction_id"]: {
            "reaction_id": row["reaction_id"],
            "reactenz_reaction_id": row["reactenz_reaction_id"],
            "ec_class": row["ec_class"] or "unclassified",
            "canonical_reaction_smiles": row["canonical_reaction_smiles"],
            "split_name": stable_split(row["canonical_reaction_smiles"]),
        }
        for row in conn.execute(
            """
            SELECT reaction_id, reactenz_reaction_id, ec_class, canonical_reaction_smiles
            FROM model.model_ready_reactions
            WHERE canonical_reaction_smiles IS NOT NULL
              AND trim(canonical_reaction_smiles) <> ''
              AND COALESCE(only_currency_transformation, 0) = 0
            """
        )
    }
    candidates_by_reaction: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    decoy_pool: dict[tuple[str, str], dict[str, dict[str, Any]]] = defaultdict(dict)
    candidate_partitions: dict[str, str] = {}
    query = """
        SELECT c.reaction_id, c.biopart_id, c.reactenz_enzyme_id, c.enzyme_name, c.organism,
               c.enzyme_evidence_score, c.kinetic_record_count, c.structure_confidence_score,
               c.chassis_count, c.interpro_count, c.pfam_count, c.active_site_count,
               c.binding_site_count, c.conserved_site_count
        FROM model.model_ready_enzyme_candidates c
    """
    for row in conn.execute(query):
        reaction = reactions.get(row["reaction_id"])
        if reaction is None:
            continue
        partition = candidate_partitions.setdefault(row["biopart_id"], stable_split(row["biopart_id"]))
        # Both reaction identity and exact enzyme identity must belong to the same split.
        if partition != reaction["split_name"]:
            continue
        candidate = {
            "biopart_id": row["biopart_id"],
            "reactenz_enzyme_id": row["reactenz_enzyme_id"],
            "enzyme_name": row["enzyme_name"],
            "organism": row["organism"],
            "evidence_score": row["enzyme_evidence_score"],
            "kinetic_record_count": row["kinetic_record_count"],
            "structure_confidence_score": row["structure_confidence_score"],
            "chassis_count": row["chassis_count"],
            "interpro_count": row["interpro_count"],
            "pfam_count": row["pfam_count"],
            "active_site_count": row["active_site_count"],
            "binding_site_count": row["binding_site_count"],
            "conserved_site_count": row["conserved_site_count"],
            "candidate_partition": partition,
        }
        candidate["baseline_rank_score"] = candidate_baseline_score(candidate)
        candidates_by_reaction[row["reaction_id"]][row["biopart_id"]] = candidate
        pool_key = (reaction["ec_class"], reaction["split_name"])
        previous = decoy_pool[pool_key].get(row["biopart_id"])
        if previous is None or candidate["baseline_rank_score"] > previous["baseline_rank_score"]:
            decoy_pool[pool_key][row["biopart_id"]] = candidate

    entries: list[tuple[Any, ...]] = []
    grouped_labels: dict[tuple[str, str], list[int]] = defaultdict(list)
    for reaction_id in sorted(reactions):
        reaction = reactions[reaction_id]
        positives = list(candidates_by_reaction.get(reaction_id, {}).values())
        if not positives:
            continue
        positive_ids = {candidate["biopart_id"] for candidate in positives}
        pool = decoy_pool[(reaction["ec_class"], reaction["split_name"])]
        decoys = [candidate for biopart_id, candidate in pool.items() if biopart_id not in positive_ids]
        decoys.sort(key=lambda candidate: hashlib.sha256(f"{reaction_id}|{candidate['biopart_id']}".encode("utf-8")).hexdigest())
        decoy_limit = min(50, max(20, len(positives) * 5))
        ranked_candidates = [(candidate, 1, "observed_reaction_enzyme_link") for candidate in positives]
        ranked_candidates.extend((candidate, 0, "sampled_same_ec_unlinked_decoy") for candidate in decoys[:decoy_limit])
        ranked_candidates.sort(key=lambda item: (-float(item[0]["baseline_rank_score"]), item[0]["biopart_id"]))
        for rank, (candidate, label, label_description) in enumerate(ranked_candidates, start=1):
            entries.append(
                (
                    f"EVAL_R2E_{reaction['split_name']}_{reaction_id}_{candidate['biopart_id']}",
                    "reaction_to_enzyme_retrieval_evaluation",
                    reaction["split_name"],
                    split_policy,
                    reaction_id,
                    reaction["reactenz_reaction_id"],
                    reaction["ec_class"],
                    reaction["canonical_reaction_smiles"],
                    candidate["biopart_id"],
                    candidate["reactenz_enzyme_id"],
                    candidate["enzyme_name"],
                    candidate["organism"],
                    candidate["evidence_score"],
                    candidate["kinetic_record_count"],
                    candidate["structure_confidence_score"],
                    candidate["chassis_count"],
                    candidate["interpro_count"],
                    candidate["pfam_count"],
                    candidate["active_site_count"],
                    candidate["binding_site_count"],
                    candidate["conserved_site_count"],
                    candidate["baseline_rank_score"],
                    rank,
                    label,
                    label_description,
                    candidate["candidate_partition"],
                )
            )
            grouped_labels[(reaction["split_name"], reaction_id)].append(label)

    conn.executemany(
        """
        INSERT INTO benchmark_evaluation_reaction_to_enzyme VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
        """,
        entries,
    )
    split_rows = []
    for split_name in ("train", "validation", "test"):
        rows = [entry for entry in entries if entry[2] == split_name]
        queries = {entry[4] for entry in rows}
        split_rows.append(
            (
                "reaction_to_enzyme_retrieval_evaluation",
                split_name,
                split_policy,
                len(queries),
                len(rows),
                sum(1 for entry in rows if entry[23] == 1),
                sum(1 for entry in rows if entry[23] == 0),
            )
        )
    conn.executemany("INSERT INTO benchmark_split_summary VALUES (?, ?, ?, ?, ?, ?, ?)", split_rows)

    test_labels = [labels for (split, _), labels in grouped_labels.items() if split == "test" and labels]
    if test_labels:
        metrics = {
            "Recall@1": sum(1 for labels in test_labels if any(labels[:1])) / len(test_labels),
            "Recall@5": sum(1 for labels in test_labels if any(labels[:5])) / len(test_labels),
            "Recall@10": sum(1 for labels in test_labels if any(labels[:10])) / len(test_labels),
            "MRR": sum(1 / (labels.index(1) + 1) for labels in test_labels if 1 in labels) / len(test_labels),
            "nDCG@10": sum(
                dcg_at_k(labels, 10) / dcg_at_k([1] * min(sum(labels), 10), 10)
                for labels in test_labels
                if sum(labels) > 0
            ) / len(test_labels),
        }
        metric_note = (
            "Test split only. Positives are observed ReactEnzDB reaction-enzyme links; decoys are same-EC unlinked candidates and are not experimentally confirmed negatives. "
            "Canonical reaction strings and exact biopart IDs are disjoint across splits; sequence-homology clustering is not performed."
        )
        conn.executemany(
            "INSERT INTO benchmark_baseline_metrics VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    "reaction_to_enzyme_retrieval_evaluation",
                    "test",
                    "evidence_structure_kinetics_baseline_v1",
                    metric,
                    value,
                    len(test_labels),
                    metric_note,
                )
                for metric, value in metrics.items()
            ],
        )
    conn.commit()
    return {
        "split_policy": split_policy,
        "split_summary": {row[1]: {"queries": row[3], "rows": row[4], "positives": row[5], "sampled_decoys": row[6]} for row in split_rows},
        "test_metrics": {
            row[3]: row[4]
            for row in conn.execute(
                "SELECT * FROM benchmark_baseline_metrics WHERE task_name = 'reaction_to_enzyme_retrieval_evaluation' AND split_name = 'test'"
            )
        },
    }


def export_tsv(conn: sqlite3.Connection, table: str, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    cursor = conn.execute(f"SELECT * FROM {table}")
    columns = [desc[0] for desc in cursor.description]
    with gzip.open(path, "wt", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(columns)
        for row in cursor:
            writer.writerow(["" if value is None else value for value in row])


def summarize(conn: sqlite3.Connection, files: list[Path], evaluation: dict[str, Any]) -> dict[str, Any]:
    def scalar(sql: str) -> int:
        return int(conn.execute(sql).fetchone()[0] or 0)

    by_source = {
        row["source_name"]: row["count"]
        for row in conn.execute("SELECT source_name, COUNT(*) AS count FROM rule_templates GROUP BY source_name")
    }
    by_specificity = {
        row["broad_specific_label"]: row["count"]
        for row in conn.execute("SELECT broad_specific_label, COUNT(*) AS count FROM rule_templates GROUP BY broad_specific_label")
    }
    summary = {
        "release": "ReactEnzDB rule/template and benchmark task layer",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "tables": {
            "rule_templates": scalar("SELECT COUNT(*) FROM rule_templates"),
            "rule_template_reaction_links": scalar("SELECT COUNT(*) FROM rule_template_reaction_links"),
            "rule_template_enzyme_candidate_links": scalar("SELECT COUNT(*) FROM rule_template_enzyme_candidate_links"),
            "benchmark_task_reaction_to_enzyme": scalar("SELECT COUNT(*) FROM benchmark_task_reaction_to_enzyme"),
            "benchmark_task_substrate_product_to_reaction": scalar("SELECT COUNT(*) FROM benchmark_task_substrate_product_to_reaction"),
            "benchmark_task_enzyme_ranking": scalar("SELECT COUNT(*) FROM benchmark_task_enzyme_ranking"),
            "benchmark_evaluation_reaction_to_enzyme": scalar("SELECT COUNT(*) FROM benchmark_evaluation_reaction_to_enzyme"),
        },
        "rule_templates_by_source": by_source,
        "rule_templates_by_specificity": by_specificity,
        "mapped_rule_templates": scalar("SELECT COUNT(DISTINCT template_id) FROM rule_template_reaction_links"),
        "mapped_reactions": scalar("SELECT COUNT(DISTINCT reaction_id) FROM rule_template_reaction_links"),
        "baseline_count": scalar("SELECT COUNT(*) FROM benchmark_baselines"),
        "evaluation": evaluation,
        "files": [
            {
                "file": str(path.relative_to(ROOT / "web_release")).replace("\\", "/"),
                "size": path.stat().st_size,
                "sha256": sha256(path),
            }
            for path in files
            if path.exists()
        ],
        "notes": [
            "ReactEnzDB reactions are not automatically converted into reaction templates unless source atom-mapped rules/templates already exist.",
            "BioNavi templates are linked to ReactEnzDB reactions only through exact EC/Rhea/KEGG/MetaCyc identifier matches.",
            "RetroBioCat templates are retained as rule metadata and are not forced onto UniProt-level enzyme candidates without direct identifiers.",
            "The original three task tables remain positive-link resources. The reaction-to-enzyme evaluation table adds deterministic train/validation/test partitions, exact biopart disjointness, same-EC sampled decoys, and baseline metrics.",
            "Sampled decoys are unlinked candidates, not experimentally confirmed inactive enzymes. Sequence-homology clustering is not performed in this release and must be added for sequence-model claims.",
        ],
    }
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Build rule/template and benchmark task layer.")
    parser.add_argument("--retro-db", type=Path, default=DEFAULT_RETRO_DB)
    parser.add_argument("--model-db", type=Path, default=DEFAULT_MODEL_DB)
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

    conn = connect(args.output_db)
    try:
        attach(conn, "retro", args.retro_db)
        attach(conn, "model", args.model_db)
        setup(conn)
        build_rule_templates(conn)
        build_template_reaction_links(conn)
        build_template_candidate_links(conn)
        build_benchmark_tasks(conn)
        evaluation = build_evaluation_split(conn)
        conn.execute("VACUUM")
        conn.commit()

        export_files = [
            args.output_db,
            args.download_dir / "rule_templates.tsv.gz",
            args.download_dir / "rule_template_reaction_links.tsv.gz",
            args.download_dir / "benchmark_task_reaction_to_enzyme.tsv.gz",
            args.download_dir / "benchmark_task_substrate_product_to_reaction.tsv.gz",
            args.download_dir / "benchmark_task_enzyme_ranking.tsv.gz",
            args.download_dir / "benchmark_evaluation_reaction_to_enzyme.tsv.gz",
        ]
        log("Exporting TSV.GZ files")
        export_tsv(conn, "rule_templates", export_files[1])
        export_tsv(conn, "rule_template_reaction_links", export_files[2])
        export_tsv(conn, "benchmark_task_reaction_to_enzyme", export_files[3])
        export_tsv(conn, "benchmark_task_substrate_product_to_reaction", export_files[4])
        export_tsv(conn, "benchmark_task_enzyme_ranking", export_files[5])
        export_tsv(conn, "benchmark_evaluation_reaction_to_enzyme", export_files[6])

        protocol_path = ROOT / "web_release" / "BENCHMARK_EVALUATION_PROTOCOL.md"
        protocol_path.write_text(
            "# ReactEnzDB reaction-to-enzyme evaluation protocol\n\n"
            "The evaluation table uses a stable SHA256-based partition of canonical reaction SMILES (80% train, 10% validation, 10% test). "
            "Each biopart ID is independently assigned to the same partition, and a reaction-enzyme pair is retained only when both partitions agree. "
            "This prevents exact canonical-reaction and exact biopart overlap across splits.\n\n"
            "For each query reaction, positives are observed ReactEnzDB reaction-enzyme links. Decoys are candidates linked to other reactions in the same EC class and partition but not linked to the query reaction. "
            "They are sampled decoys, not experimentally confirmed inactive enzymes. The provided baseline ranks candidates by evidence, structure, kinetics, chassis, domain, and functional-site features.\n\n"
            "Report Recall@1/5/10, MRR, and nDCG@10 on the fixed test split. The release does not perform sequence-homology clustering; do not claim homology-controlled generalization without an additional sequence-cluster split.\n",
            encoding="utf-8",
        )
        export_files.append(protocol_path)
        summary = summarize(conn, export_files, evaluation)
        args.summary.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        log(json.dumps(summary["tables"], ensure_ascii=False))
        log(f"Wrote {args.output_db}")
        log(f"Wrote {args.summary}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
