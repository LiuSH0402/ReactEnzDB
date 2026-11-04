from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import sqlite3
import textwrap
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "web_release" / "reactenzdb_web.db"
DEFAULT_RELEASE_DIR = ROOT / "web_release"
DEFAULT_DOWNLOAD_DIR = DEFAULT_RELEASE_DIR / "downloads"
RELEASE_VERSION = "2026.09.1"
RELEASE_DATE = "2026-09-22"
RELEASE_NAME = "ReactEnzDB web release 2026-09.1"

EXTRA_RELEASE_FILES = [
    "reo_id_registry.sqlite",
    "reaction_standardization.sqlite",
    "reaction_standardization.summary.json",
    "enzyme_sequence_clusters.sqlite",
    "enzyme_sequence_clusters.summary.json",
    "ENZYME_SEQUENCE_CLUSTERS.md",
    "advanced_candidate_selection.sqlite",
    "advanced_candidate_selection.summary.json",
    "DATA_LAYER_REGISTRY.json",
    "DATA_LAYER_REGISTRY.md",
    "RETROSYNTHESIS_TOOL_REGISTRY.json",
    "RETROSYNTHESIS_TOOL_REGISTRY.md",
    "retrosynthesis_resources.sqlite",
    "retrosynthesis_resources.summary.json",
    "RETROSYNTHESIS_RESOURCES.md",
    "retrosynthesis_reactenzdb_mapping_assessment.md",
    "retrosynthesis_reactenzdb_mapping_assessment.json",
    "retrosynthesis_reaction_lookup.sqlite",
    "model_ready_dataset.sqlite",
    "model_ready_dataset.summary.json",
    "rule_template_benchmark.sqlite",
    "rule_template_benchmark.summary.json",
    "BENCHMARK_EVALUATION_PROTOCOL.md",
    "host_context_v1.sqlite",
    "host_context_v1.summary.json",
    "HOST_CONTEXT_V1.md",
    "downloads/host_context_v1_hosts.tsv",
    "host_context_chassis.sqlite",
    "host_context_chassis.summary.json",
    "HOST_CONTEXT_CHASSIS.md",
    "host_context_ecoli.sqlite",
    "host_context_ecoli.summary.json",
    "HOST_CONTEXT_ECOLI.md",
    "candidate_diversity_analysis.sqlite",
    "candidate_diversity_analysis.summary.json",
    "CANDIDATE_DIVERSITY_ANALYSIS.md",
    "host_pathway_coverage_analysis.sqlite",
    "host_pathway_coverage_analysis.summary.json",
    "HOST_PATHWAY_COVERAGE_ANALYSIS.md",
    "downloads/model_ready_reactions.tsv.gz",
    "downloads/enzyme_sequence_clusters.tsv.gz",
    "downloads/model_ready_enzyme_candidates.tsv.gz",
    "downloads/model_ready_trainable_reactions.tsv.gz",
    "downloads/rule_templates.tsv.gz",
    "downloads/rule_template_reaction_links.tsv.gz",
    "downloads/benchmark_task_reaction_to_enzyme.tsv.gz",
    "downloads/benchmark_task_substrate_product_to_reaction.tsv.gz",
    "downloads/benchmark_task_enzyme_ranking.tsv.gz",
    "downloads/benchmark_evaluation_reaction_to_enzyme.tsv.gz",
    "downloads/host_chassis_native_reactions.tsv.gz",
    "downloads/host_chassis_native_metabolites.tsv.gz",
    "downloads/host_chassis_reaction_links.tsv.gz",
    "downloads/host_chassis_compound_links.tsv.gz",
    "downloads/candidate_diversity_by_reaction.tsv.gz",
    "downloads/candidate_diversity_threshold_summary.tsv",
    "downloads/candidate_diversity_high_evidence_taxonomy.tsv",
    "downloads/host_pathway_coverage_by_host.tsv",
    "downloads/host_pathway_coverage_reaction_requirements.tsv.gz",
    "downloads/host_pathway_coverage_pathways.tsv.gz",
    "downloads/host_pathway_coverage_reaction_classes.tsv",
    "downloads/host_pathway_coverage_cofactors.tsv",
    "downloads/expression_evidence_release.summary.json",
    "downloads/EXPERIMENTAL_EXPRESSION_EVIDENCE.md",
    "downloads/expression_article_correspondence.tsv.gz",
    "downloads/experimental_expression_candidates.tsv.gz",
    "downloads/experimental_expression_qc_flags.tsv.gz",
    "downloads/experimental_expression_source_trace.tsv.gz",
]

# These historical snapshots remain in the core database for reproducibility, but
# are not a public source for retrosynthesis workflows. Their canonical replacement
# is the standalone resource layer listed in DATA_LAYER_REGISTRY.json.
LEGACY_RETROSYNTHESIS_TABLES = (
    "web_retrosynthesis_benchmark_reactions",
    "web_retrosynthesis_benchmark_sets",
    "web_retrosynthesis_building_blocks",
    "web_retrosynthesis_routes",
    "web_retrosynthesis_rule_links",
    "web_retrosynthesis_rules",
    "web_retrosynthesis_sources",
)

EXPORT_TABLES = [
    "web_reactions",
    "web_reaction_compounds",
    "web_reaction_enzymes",
    "web_enzymes",
    "web_kinetics",
    "web_kinetics_source_provenance",
    "web_kinetics_reference_repairs",
    "web_xrefs",
    "web_entity_references",
    "web_attribute_evidences",
    "web_evidence_scores",
    "web_protein_annotations",
    "web_protein_domains",
    "web_protein_features",
    "web_pdb_mappings",
    "web_alphafold_mappings",
    "web_structure_confidence",
    "web_chassis_labels",
    "web_chassis_records",
    "web_pathways",
    "web_reaction_pathways",
    "web_compound_images",
    "web_compound_pubchem_enrichment",
    "web_mnx_reaction_mappings",
    "web_mnx_compound_mappings",
    "web_external_kinetics",
    "web_kinetic_external_checks",
    "web_external_attribute_values",
    "web_attribute_external_checks",
    "web_mcsa_entries",
    "web_mcsa_enzyme_mappings",
    "web_mcsa_reaction_mappings",
    "web_mcsa_residues",
    "web_mcsa_mechanisms",
    "web_mcsa_mechanism_steps",
    "web_mcsa_compounds",
    "web_mcsa_references",
    "web_stats",
]

TABLE_DESCRIPTIONS = {
    "web_reactions": "Reaction-level records with equations, external reaction identifiers, structural completeness, and summary counts.",
    "web_reaction_compounds": "Reaction participants with substrate/product role, compound identifiers, SMILES, and structure-image metadata.",
    "web_reaction_enzymes": "Core reaction-enzyme-organism relation records with permanent registry-backed reo_id values used by the website and API.",
    "web_enzymes": "Enzyme/biopart records with source organism, sequence, UniProt, structure, kinetic, chassis, and annotation summary fields.",
    "web_kinetics": "Assigned kinetic and condition records linked to reaction/enzyme context.",
    "web_kinetics_source_provenance": "Original and controlled kinetic database labels, removed non-database tokens, and normalization rule; numeric labels remain unresolved.",
    "web_kinetics_reference_repairs": "Kinetic ID-level reference repairs backed by upstream reaction/sequence/organism dedup logs, preserving original enzyme IDs and original rows.",
    "web_xrefs": "External database cross references for reactions, enzymes, compounds, and related entities.",
    "web_entity_references": "Literature references mapped to reaction/enzyme entities when source evidence is available.",
    "web_attribute_evidences": "Attribute-level evidence links connecting values to references or source annotations.",
    "web_evidence_scores": "Annotation richness score per reaction, enzyme, organism, and chassis entity; not a correctness probability or activity prediction.",
    "web_enzyme_browse_summary": "Materialized per-enzyme browse statistics for PDB, AlphaFold, kinetics, chassis coverage, and default completeness sorting.",
    "web_organism_browse_summary": "Materialized per-organism browse statistics for reaction, enzyme, chassis, structure, evidence, and default completeness sorting.",
    "web_protein_annotations": "Protein annotation summary generated from UniProt/InterPro-derived functional annotation.",
    "web_protein_domains": "Protein family/domain annotations including InterPro and Pfam signatures.",
    "web_protein_features": "Protein active-site, binding-site, conserved-site, and related functional feature annotations.",
    "web_pdb_mappings": "Experimental structure mappings from enzyme records to PDB entries.",
    "web_alphafold_mappings": "Predicted structure mappings from enzyme records to AlphaFold DB models.",
    "web_structure_confidence": "Per-enzyme structural confidence and sequence-position catalytic/functional-site coverage features derived from AlphaFold, PDB, M-CSA, and UniProt feature annotations.",
    "web_chassis_labels": "Expression host/chassis label summary table.",
    "web_chassis_records": "Reaction-enzyme-organism records linked to expression chassis labels.",
    "web_pathways": "Pathway records used by pathway-linked reaction views.",
    "web_reaction_pathways": "Reaction-to-pathway mapping table.",
    "web_compound_images": "Local compound structure image generation status.",
    "web_compound_pubchem_enrichment": "PubChem compound enrichment and resolution status.",
    "web_mnx_reaction_mappings": "MetaNetX MNXref reaction reconciliation mappings.",
    "web_mnx_compound_mappings": "MetaNetX MNXref compound reconciliation mappings.",
    "web_external_kinetics": "External kinetic records collected from validation sources such as BRENDA and SABIO-RK.",
    "web_kinetic_external_checks": "Per-kinetic-record external validation status.",
    "web_external_attribute_values": "External pH and temperature attribute values collected from validation sources.",
    "web_attribute_external_checks": "Per-attribute external validation status for pH/temperature values.",
    "web_mcsa_entries": "M-CSA catalytic mechanism entries mapped into ReactEnzDB.",
    "web_mcsa_enzyme_mappings": "Exact UniProt-based enzyme-to-M-CSA mappings.",
    "web_mcsa_reaction_mappings": "EC-context reaction-to-M-CSA mappings.",
    "web_mcsa_residues": "M-CSA catalytic residues, residue roles, and residue-level annotations.",
    "web_mcsa_mechanisms": "M-CSA mechanism summaries linked to mapped entries.",
    "web_mcsa_mechanism_steps": "Step-level M-CSA catalytic mechanism descriptions.",
    "web_mcsa_compounds": "M-CSA reactant, product, cofactor, and intermediate compound annotations.",
    "web_mcsa_references": "M-CSA literature references with PMID/DOI where available.",
    "web_stats": "Release-level count metrics used by the web interface.",
}

COLUMN_DESCRIPTIONS = {
    "reo_id": "Permanent ReactEnzDB reaction-enzyme-organism relation identifier. Registry-backed, independent of SQLite rowid, and never reassigned.",
    "reactenz_reaction_id": "Stable ReactEnzDB reaction identifier used by the website.",
    "reactenz_enzyme_id": "Stable ReactEnzDB enzyme identifier used by the website.",
    "reactenz_organism_id": "Stable ReactEnzDB source organism identifier used by the website.",
    "reactenz_chassis_id": "Stable ReactEnzDB chassis identifier used by the website.",
    "reaction_id": "Internal source reaction identifier retained for joins.",
    "biopart_id": "Internal enzyme/biopart identifier retained for joins.",
    "reaction_equation_display": "Human-readable reaction equation.",
    "reaction_direction": "Reaction direction annotation.",
    "dataset_level": "Internal structure-coverage code: gold = ChEBI-complete structure set; silver = non-overlapping structure-capable set. This is not a correctness label.",
    "evidence_score": "Annotation richness score computed from source and enrichment coverage; not a correctness probability or activity prediction.",
    "evidence_tier": "Internal annotation-coverage band derived from evidence_score: strong, moderate, or limited. This is not a confidence class.",
    "ec_number": "Enzyme Commission number.",
    "rhea_id": "Rhea reaction identifier.",
    "kegg_reaction_id": "KEGG reaction identifier.",
    "metacyc_reaction_id": "MetaCyc reaction identifier.",
    "mnx_id": "MetaNetX MNXref identifier.",
    "uniprot_accession": "UniProt accession linked to the enzyme record.",
    "organism": "Source organism name.",
    "taxonomy_id": "NCBI taxonomy identifier when available.",
    "protein_sequence": "Protein sequence when available.",
    "sequence_length": "Protein sequence length.",
    "parameter_type": "Kinetic or condition parameter type.",
    "parameter_value": "Numeric or textual reported parameter value.",
    "pmid": "PubMed identifier.",
    "doi": "Digital Object Identifier.",
    "source": "Source database or evidence source.",
    "match_status": "External validation match status.",
    "mcsa_id": "M-CSA entry identifier.",
    "residue": "Catalytic or functional residue annotation.",
    "role": "Functional role assigned to a residue or compound.",
    "pfam": "Pfam signature identifier or count.",
    "interpro": "InterPro entry identifier or count.",
    "structure_confidence_score": "Integrated per-enzyme structural support score based on AlphaFold confidence, PDB coverage/resolution, and catalytic/functional site structural coverage.",
    "structure_confidence_tier": "Categorical structural support tier derived from the structure confidence score.",
    "has_high_confidence_structure": "Boolean flag indicating at least one high-confidence AlphaFold or sufficiently covered PDB structure.",
    "catalytic_site_support_level": "Best available catalytic/functional-site structural support category.",
    "best_alphafold_plddt": "Highest AlphaFold global pLDDT-like model confidence value for the enzyme.",
    "best_pdb_coverage": "Best mapped PDB chain coverage for the enzyme.",
    "best_pdb_resolution": "Resolution of the best mapped PDB structure when reported.",
    "pocket_status": "Pocket computation status; not computed in the current release.",
    "proximity_status": "Proximity computation status; current release uses sequence-position structural coverage as a proxy.",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def dict_rows(cur: sqlite3.Cursor, rows: Iterable[sqlite3.Row]) -> Iterable[dict[str, object]]:
    names = [description[0] for description in cur.description or []]
    for row in rows:
        yield {name: row[index] for index, name in enumerate(names)}


def write_delimited(
    conn: sqlite3.Connection,
    table: str,
    output_dir: Path,
    delimiter: str,
    suffix: str,
    chunksize: int,
) -> dict[str, object]:
    output = output_dir / f"{table}.{suffix}.gz"
    if output.exists():
        output.unlink()

    cur = conn.execute(f'SELECT * FROM "{table}"')
    columns = [description[0] for description in cur.description or []]
    row_count = 0
    with output.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0, compresslevel=9) as gz:
            with io.TextIOWrapper(gz, encoding="utf-8", newline="", write_through=True) as handle:
                writer = csv.writer(handle, delimiter=delimiter, lineterminator="\n")
                writer.writerow(columns)
                while True:
                    rows = cur.fetchmany(chunksize)
                    if not rows:
                        break
                    writer.writerows(rows)
                    row_count += len(rows)

    return {
        "table": table,
        "file": f"downloads/{output.name}",
        "format": f"{suffix.upper()}.GZ",
        "rows": row_count,
        "columns": len(columns),
        "size": output.stat().st_size,
        "sha256": sha256(output),
        "description": TABLE_DESCRIPTIONS.get(table, ""),
    }


def write_tsv(path: Path, rows: list[dict[str, object]], columns: list[str]) -> dict[str, object]:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, delimiter="\t", lineterminator="\n")
        writer.writeheader()
        for row in rows:
            writer.writerow({column: row.get(column, "") for column in columns})
    return artifact(path)


def artifact(path: Path, relative_to: Path = DEFAULT_RELEASE_DIR) -> dict[str, object]:
    return {
        "file": path.relative_to(relative_to).as_posix(),
        "size": path.stat().st_size,
        "sha256": sha256(path),
    }


def schema_table_names(conn: sqlite3.Connection) -> list[str]:
    tables = [
        str(row[0])
        for row in conn.execute(
            """
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
              AND name LIKE 'web_%'
              AND name NOT LIKE '%_fts'
              AND name NOT LIKE '%_fts_%'
            ORDER BY name
            """
        )
    ]
    return [table for table in tables if table not in LEGACY_RETROSYNTHESIS_TABLES]


def read_json_file(path: Path) -> dict[str, object]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def sqlite_table_counts(path: Path, tables: tuple[str, ...] | None = None) -> dict[str, int]:
    if not path.exists():
        return {}
    connection = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    try:
        if tables is None:
            rows = connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            ).fetchall()
            tables = tuple(str(row[0]) for row in rows)
        return {
            table: int(connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])
            for table in tables
        }
    finally:
        connection.close()


def layer_file(path: Path, release_dir: Path) -> dict[str, object]:
    try:
        relative = path.relative_to(release_dir).as_posix()
    except ValueError:
        relative = path.name
    if not path.exists():
        return {"file": relative, "available": False}
    return {
        "file": relative,
        "size": path.stat().st_size,
        "sha256": sha256(path),
        "available": True,
    }


def build_data_layer_registry(
    core_db: Path,
    release_dir: Path,
    generated_at: str,
) -> tuple[dict[str, object], dict[str, object]]:
    retrosynthesis_db = release_dir / "retrosynthesis_resources.sqlite"
    retrosynthesis_lookup_db = release_dir / "retrosynthesis_reaction_lookup.sqlite"
    model_ready_db = release_dir / "model_ready_dataset.sqlite"
    benchmark_db = release_dir / "rule_template_benchmark.sqlite"
    host_context_db = release_dir / "host_context_chassis.sqlite"
    host_context_v1_db = release_dir / "host_context_v1.sqlite"
    candidate_diversity_db = release_dir / "candidate_diversity_analysis.sqlite"
    host_pathway_coverage_db = release_dir / "host_pathway_coverage_analysis.sqlite"
    expression_summary_file = release_dir / "downloads" / "expression_evidence_release.summary.json"
    retrosynthesis_summary = read_json_file(release_dir / "retrosynthesis_resources.summary.json")
    benchmark_summary = read_json_file(release_dir / "rule_template_benchmark.summary.json")
    model_summary = read_json_file(release_dir / "model_ready_dataset.summary.json")
    host_summary = read_json_file(release_dir / "host_context_chassis.summary.json")
    host_v1_summary = read_json_file(release_dir / "host_context_v1.summary.json")
    candidate_diversity_summary = read_json_file(
        release_dir / "candidate_diversity_analysis.summary.json"
    )
    host_pathway_coverage_summary = read_json_file(
        release_dir / "host_pathway_coverage_analysis.summary.json"
    )
    expression_summary = read_json_file(expression_summary_file)
    tool_registry = read_json_file(release_dir / "RETROSYNTHESIS_TOOL_REGISTRY.json")
    core_connection = sqlite3.connect(f"file:{core_db.as_posix()}?mode=ro", uri=True)
    try:
        public_core_table_count = len(schema_table_names(core_connection))
    finally:
        core_connection.close()

    layers = [
        {
            "layer_id": "reactenzdb_core",
            "authority": "canonical",
            "kind": "curated_core",
            "database": layer_file(core_db, release_dir),
            "scope": "Curated reaction, enzyme, organism, kinetics, literature, cross-reference, protein annotation, and core evidence records.",
            "source_or_derivation": "RDBSB-derived source records plus ReactEnzDB curation and enrichment.",
            "join_keys": ["reaction_id", "biopart_id", "reactenz_reaction_id", "reactenz_enzyme_id", "EC", "Rhea", "KEGG", "MNXref"],
            "table_counts": {"public_core_tables": public_core_table_count},
        },
        {
            "layer_id": "interactive_retrosynthesis_lookup",
            "authority": "derived",
            "kind": "interactive_direction_aware_structure_index",
            "database": layer_file(retrosynthesis_lookup_db, release_dir),
            "scope": "Derived exact and protonation-normalized query-side lookup with retained stereochemistry, reference-direction checks and no-net-change exclusions. Candidate retrieval does not verify complete reaction identity or catalysis.",
            "source_or_derivation": "Generated from the canonical ReactEnzDB core by scripts/build_retrosynthesis_reaction_lookup.py. It is not an independent source dataset and does not add evidence.",
            "upstream_layers": ["reactenzdb_core"],
            "join_keys": ["reaction_id", "canonical SMILES", "normalized SMILES", "side"],
            "table_counts": sqlite_table_counts(retrosynthesis_lookup_db),
        },
        {
            "layer_id": "retrosynthesis_tool_registry",
            "authority": "canonical_for_tool_identity",
            "kind": "tool_identity_and_deployment_policy",
            "database": layer_file(release_dir / "RETROSYNTHESIS_TOOL_REGISTRY.json", release_dir),
            "scope": "Per-release identity, capability class, citation, license, checkpoint hash, output semantics, and deployment restrictions for the five exposed retrosynthesis resources.",
            "source_or_derivation": "Generated by scripts/build_retrosynthesis_tool_registry.py from audited local artifacts and authoritative upstream records.",
            "tool_count": len(tool_registry.get("tools", [])),
            "join_keys": ["tool_id"],
        },
        {
            "layer_id": "retrosynthesis_external_resources",
            "authority": "canonical",
            "kind": "external_retrosynthesis_resource",
            "database": layer_file(retrosynthesis_db, release_dir),
            "scope": "Externally sourced retrosynthesis rules, rule references, building blocks, benchmark reactions, route targets, READRetro compounds, and SubNetX cases.",
            "source_or_derivation": "Imported source-attributed RetroBioCat, BioNavi, BioNavi-NP, READRetro, and SubNetX resources.",
            "join_keys": ["rule_id", "benchmark_id", "source_name", "EC", "Rhea", "KEGG", "MNXref", "canonical SMILES"],
            "table_counts": sqlite_table_counts(retrosynthesis_db),
            "summary_counts": {key: value for key, value in retrosynthesis_summary.items() if isinstance(value, int)},
        },
        {
            "layer_id": "model_ready_dataset",
            "authority": "derived",
            "kind": "model_training_projection",
            "database": layer_file(model_ready_db, release_dir),
            "scope": "Canonical reaction/compound matrices and reaction-enzyme candidate features for model training and pathway design, including the conservative model_ready_trainable_reactions default view and exact BRENDA/SABIO-RK kinetic confirmation fields.",
            "source_or_derivation": "Generated from the canonical ReactEnzDB core by scripts/build_model_ready_dataset.py.",
            "upstream_layers": ["reactenzdb_core"],
            "join_keys": ["reaction_id", "reactenz_reaction_id", "biopart_id", "compound_id"],
            "table_counts": sqlite_table_counts(model_ready_db),
            "summary_counts": model_summary.get("tables", {}),
        },
        {
            "layer_id": "rule_template_benchmark",
            "authority": "derived",
            "kind": "rule_link_and_evaluation_projection",
            "database": layer_file(benchmark_db, release_dir),
            "scope": "Rule templates, exact template-reaction links, template-enzyme candidate links, task tables, and evaluation splits.",
            "source_or_derivation": "Generated from canonical external retrosynthesis resources and the model-ready projection by scripts/build_rule_template_benchmark_layer.py.",
            "upstream_layers": ["retrosynthesis_external_resources", "model_ready_dataset"],
            "join_keys": ["rule_id", "reaction_id", "biopart_id", "canonical_reaction_smiles"],
            "table_counts": sqlite_table_counts(benchmark_db),
            "summary_counts": benchmark_summary.get("tables", {}),
        },
        {
            "layer_id": "experimental_expression_evidence",
            "authority": "candidate_release_pending_human_review",
            "kind": "article_level_heterologous_expression_evidence",
            "database": layer_file(expression_summary_file, release_dir),
            "scope": "Public-safe article correspondence, heterologous-expression candidates, host/condition fields, enzyme-reaction mappings, review flags, and source locators.",
            "source_or_derivation": "Generated from identity-verified publisher and lawful-open full text by scripts/extract_fulltext_expression_evidence.py and scripts/build_expression_evidence_web_release.py.",
            "upstream_layers": ["reactenzdb_core"],
            "join_keys": ["PMID", "DOI", "biopart_id", "reactenz_enzyme_id", "reaction_id", "reactenz_reaction_id", "host_id"],
            "summary_counts": expression_summary.get("counts", {}),
            "release_status": expression_summary.get("status"),
            "interpretation_boundary": expression_summary.get("interpretation_boundary"),
            "public_release_boundary": expression_summary.get("public_release_boundary"),
        },
        {
            "layer_id": "host_context_v1",
            "authority": "lookup_not_recommendation",
            "kind": "genome_scale_host_context",
            "database": layer_file(host_context_v1_db, release_dir),
            "scope": "Thirty host genome-scale models and reaction-host mapping lookup for ReactEnzDB 2026.09.1. This is not host recommendation, FBA, expression success, or a completed mapping audit.",
            "source_or_derivation": "Frozen from staging/host-context/2026.09.1 into host_context_v1.sqlite. Human mapping review remains empty.",
            "upstream_layers": ["reactenzdb_core"],
            "join_keys": ["reactenz_reaction_id", "reaction_id", "host_id", "release_id"],
            "table_counts": sqlite_table_counts(host_context_v1_db, ("curated_hosts", "host_model_releases", "reaction_host_mapping")),
            "summary_counts": host_v1_summary.get("counts", {}),
            "interpretation_boundary": "MODEL_NO_EXACT_MATCH is a follow-up question, not biological absence.",
        },
        {
            "layer_id": "host_context_chassis",
            "authority": "canonical_for_host_model_mapping",
            "kind": "host_model_context",
            "database": layer_file(host_context_db, release_dir),
            "scope": "Host metabolic-model reaction and compound context, with exact identifier and EC-class contextual links kept distinct.",
            "source_or_derivation": "Built from source metabolic models by scripts/build_ecoli_host_context_layer.py.",
            "join_keys": ["host_id", "bigg_reaction_id", "reactenz_reaction_id", "reactenz_compound_id"],
            "table_counts": sqlite_table_counts(host_context_db),
            "summary_counts": host_summary.get("tables", {}),
        },
        {
            "layer_id": "candidate_enzyme_diversity_analysis",
            "authority": "derived",
            "kind": "reaction_level_candidate_compression_analysis",
            "database": layer_file(candidate_diversity_db, release_dir),
            "scope": "Reaction-level candidate redundancy, distant sequence-family diversity, final standardized reaction evidence, evidence-refreshed representative retention, taxonomy diversity, and structure/kinetic coverage across NR100, NR90, NR70, and NR50 views.",
            "source_or_derivation": "Generated from the sequence-cluster release by scripts/analyze_candidate_redundancy_diversity.py.",
            "upstream_layers": ["reactenzdb_core"],
            "join_keys": ["reaction_id", "reactenz_reaction_id", "threshold"],
            "table_counts": sqlite_table_counts(candidate_diversity_db),
            "summary_counts": candidate_diversity_summary.get("counts", {}),
            "evidence_boundary": candidate_diversity_summary.get("definitions", {}).get(
                "kinetic_snapshot"
            ),
        },
        {
            "layer_id": "host_pathway_coverage_analysis",
            "authority": "derived",
            "kind": "host_model_reaction_and_pathway_coverage_analysis",
            "database": layer_file(host_pathway_coverage_db, release_dir),
            "scope": "Exact-native, heterologous-candidate, unresolved, reaction-class, KEGG pathway-membership, precursor, and cofactor-occurrence context across 12 host genome-scale models, with mapping readiness declared per host.",
            "source_or_derivation": "Generated by scripts/analyze_host_pathway_coverage.py from the canonical core, model-ready reaction projection, and host model context layer.",
            "upstream_layers": ["reactenzdb_core", "model_ready_dataset", "host_context_chassis"],
            "join_keys": ["reaction_id", "reactenz_reaction_id", "host_id", "pathway_id"],
            "table_counts": sqlite_table_counts(host_pathway_coverage_db),
            "summary_counts": host_pathway_coverage_summary.get("counts", {}),
            "interpretation_boundaries": {
                "pathway": host_pathway_coverage_summary.get("pathway_boundary"),
                "cofactor": host_pathway_coverage_summary.get("cofactor_boundary"),
            },
        },
        {
            "layer_id": "legacy_core_retrosynthesis_snapshot",
            "authority": "deprecated_legacy_snapshot",
            "kind": "compatibility_only",
            "database": {"file": core_db.name, "available": True},
            "scope": "Historical compact retrosynthesis copies retained only for reproducibility of earlier local builds.",
            "source_or_derivation": "Do not use for new analysis, download, or website queries. Use retrosynthesis_external_resources instead.",
            "canonical_replacement": "retrosynthesis_external_resources",
            "tables": list(LEGACY_RETROSYNTHESIS_TABLES),
            "table_counts": sqlite_table_counts(core_db, LEGACY_RETROSYNTHESIS_TABLES),
        },
    ]
    registry = {
        "registry_version": "1.0",
        "release": RELEASE_NAME,
        "release_version": RELEASE_VERSION,
        "release_date": RELEASE_DATE,
        "generated_at_utc": generated_at,
        "policy": {
            "one_authoritative_source_per_data_class": True,
            "retrosynthesis_authority": "retrosynthesis_external_resources",
            "legacy_core_retrosynthesis_policy": "retained_in_database_but_excluded_from_public_schema_bulk_exports_and_web_queries",
            "mapping_policy": "Only exact identifiers or exact canonical-SMILES overlaps establish cross-layer mappings; EC-class matches remain contextual.",
        },
        "layers": layers,
    }
    registry_file = write_json(release_dir / "DATA_LAYER_REGISTRY.json", registry)
    layer_lines = []
    for layer in layers:
        database = layer["database"]
        layer_lines.append(
            f"- **{layer['layer_id']}** (`{layer['authority']}`): {database['file']} - {layer['scope']}"
        )
    registry_markdown = write_text(
        release_dir / "DATA_LAYER_REGISTRY.md",
        textwrap.dedent(f"""
        # ReactEnzDB data-layer registry

        Release: {RELEASE_VERSION} ({RELEASE_DATE})

        This registry defines the authoritative source for each ReactEnzDB data class. Do not merge similarly named tables across layers without following the declared join and mapping policy.

        ## Authority policy

        - External retrosynthesis rules, building blocks, route targets, and imported benchmark reactions are authoritative only in `retrosynthesis_resources.sqlite`.
        - `model_ready_dataset.sqlite` and `rule_template_benchmark.sqlite` are reproducible derived layers, not independent source datasets.
        - Experimental expression candidates remain pending human review and are separate from host-model lookup.
        - `host_context_v1.sqlite` is the 2026.09.1 host-model lookup layer. It is not a host recommendation or a completed mapping audit.
        - `web_retrosynthesis_*` tables remain in `reactenzdb_web.db` as deprecated historical snapshots and are intentionally excluded from public schema and bulk exports.
        - Exact identifier or exact canonical-SMILES matches establish cross-layer mappings. EC-class matches are contextual and do not establish identity.

        ## Registered layers
        """).strip()
        + "\n\n"
        + "\n".join(layer_lines)
        + "\n\nMachine-readable details, table counts, join keys, and checksums are in `DATA_LAYER_REGISTRY.json`.\n",
    )
    return registry_file, registry_markdown


def schema_rows(conn: sqlite3.Connection, tables: list[str]) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for table in tables:
        count = int(conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])
        for col in conn.execute(f'PRAGMA table_info("{table}")'):
            name = str(col[1])
            rows.append(
                {
                    "table": table,
                    "table_description": TABLE_DESCRIPTIONS.get(
                        table,
                        "Internal ReactEnzDB relational table retained for reproducible identifiers, joins, counts, or status tracking.",
                    ),
                    "rows": count,
                    "column": name,
                    "type": col[2],
                    "not_null": bool(col[3]),
                    "default_value": col[4],
                    "primary_key": bool(col[5]),
                    "description": COLUMN_DESCRIPTIONS.get(name, ""),
                }
            )
    return rows


def write_json(path: Path, data: object) -> dict[str, object]:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    return artifact(path)


def write_text(path: Path, text: str) -> dict[str, object]:
    path.write_text(textwrap.dedent(text).strip() + "\n", encoding="utf-8")
    return artifact(path)


def sample_query(conn: sqlite3.Connection, sql: str) -> list[dict[str, object]]:
    cur = conn.execute(sql)
    return list(dict_rows(cur, cur.fetchall()))


def scalar_int(conn: sqlite3.Connection, sql: str) -> int:
    return int(conn.execute(sql).fetchone()[0])


def build_qa_summary(conn: sqlite3.Connection, generated_at: str) -> dict[str, object]:
    checks = [
        {
            "check": "reaction identifiers are non-null and unique",
            "failures": scalar_int(
                conn,
                "SELECT COUNT(*) - COUNT(DISTINCT reaction_id) + SUM(CASE WHEN reaction_id IS NULL OR trim(reaction_id) = '' THEN 1 ELSE 0 END) FROM web_reactions",
            ),
        },
        {
            "check": "enzyme identifiers are non-null and unique",
            "failures": scalar_int(
                conn,
                "SELECT COUNT(*) - COUNT(DISTINCT biopart_id) + SUM(CASE WHEN biopart_id IS NULL OR trim(biopart_id) = '' THEN 1 ELSE 0 END) FROM web_enzymes",
            ),
        },
        {
            "check": "R-E-O identifiers are explicit, valid, non-null, and unique",
            "failures": scalar_int(
                conn,
                "SELECT COUNT(*) - COUNT(DISTINCT reo_id) + SUM(CASE WHEN reo_id IS NULL OR substr(reo_id, 1, 3) <> 'REO' OR length(reo_id) < 9 OR substr(reo_id, 4) GLOB '*[^0-9]*' THEN 1 ELSE 0 END) FROM web_reaction_enzymes",
            ),
        },
        {
            "check": "reaction-enzyme links reference released reactions",
            "failures": scalar_int(
                conn,
                "SELECT COUNT(*) FROM web_reaction_enzymes re LEFT JOIN web_reactions r ON r.reaction_id = re.reaction_id WHERE r.reaction_id IS NULL",
            ),
        },
        {
            "check": "reaction-enzyme links reference released enzymes",
            "failures": scalar_int(
                conn,
                "SELECT COUNT(*) FROM web_reaction_enzymes re LEFT JOIN web_enzymes e ON e.biopart_id = re.biopart_id WHERE e.biopart_id IS NULL",
            ),
        },
        {
            "check": "reaction-enzyme-organism relation keys are unique",
            "failures": scalar_int(
                conn,
                "SELECT COALESCE(SUM(n - 1), 0) FROM (SELECT COUNT(*) AS n FROM web_reaction_enzymes GROUP BY reaction_id, biopart_id, COALESCE(organism, '') HAVING COUNT(*) > 1)",
            ),
        },
        {
            "check": "released reactions contain at least one participant",
            "failures": scalar_int(conn, "SELECT COUNT(*) FROM web_reactions WHERE participant_count < 1"),
        },
    ]

    evidence_tiers = {
        row[0]: {tier: count for tier, count in conn.execute(
            "SELECT evidence_tier, COUNT(*) FROM web_evidence_scores WHERE entity_type = ? GROUP BY evidence_tier",
            (row[0],),
        )}
        for row in conn.execute("SELECT DISTINCT entity_type FROM web_evidence_scores ORDER BY entity_type")
    }
    coverage = {
        "reactions": scalar_int(conn, "SELECT COUNT(*) FROM web_reactions"),
        "gold_structure_tier_reactions": scalar_int(conn, "SELECT COUNT(*) FROM web_reactions WHERE dataset_level = 'gold'"),
        "silver_structure_tier_reactions": scalar_int(conn, "SELECT COUNT(*) FROM web_reactions WHERE dataset_level = 'silver'"),
        "smiles_complete_reactions": scalar_int(conn, "SELECT COUNT(*) FROM web_reactions WHERE all_participants_have_smiles = 1"),
        "reaction_enzyme_organism_records": scalar_int(conn, "SELECT COUNT(*) FROM web_reaction_enzymes"),
        "enzymes": scalar_int(conn, "SELECT COUNT(*) FROM web_enzymes"),
        "enzymes_with_sequence": scalar_int(conn, "SELECT COUNT(*) FROM web_enzymes WHERE has_sequence = 1"),
        "kinetic_records": scalar_int(conn, "SELECT COUNT(*) FROM web_kinetics"),
        "kinetic_records_with_pmid": scalar_int(
            conn,
            "SELECT COUNT(*) FROM web_kinetics WHERE pmids_json IS NOT NULL AND trim(pmids_json) NOT IN ('', '[]')",
        ),
        "entity_references": scalar_int(conn, "SELECT COUNT(*) FROM web_entity_references"),
        "entity_references_with_pmid": scalar_int(
            conn,
            "SELECT COUNT(*) FROM web_entity_references WHERE pmid IS NOT NULL AND trim(pmid) <> ''",
        ),
        "attribute_evidence_records": scalar_int(conn, "SELECT COUNT(*) FROM web_attribute_evidences"),
        "attribute_evidence_records_with_pmid": scalar_int(
            conn,
            "SELECT COUNT(*) FROM web_attribute_evidences WHERE pmids_json IS NOT NULL AND trim(pmids_json) NOT IN ('', '[]')",
        ),
        "protein_annotations": scalar_int(conn, "SELECT COUNT(*) FROM web_protein_annotations"),
        "protein_annotations_with_interpro": scalar_int(conn, "SELECT COUNT(*) FROM web_protein_annotations WHERE interpro_count > 0"),
        "protein_annotations_with_pfam": scalar_int(conn, "SELECT COUNT(*) FROM web_protein_annotations WHERE pfam_count > 0"),
        "protein_annotations_with_functional_site": scalar_int(
            conn,
            "SELECT COUNT(*) FROM web_protein_annotations WHERE active_site_count > 0 OR binding_site_count > 0 OR conserved_site_count > 0",
        ),
        "logical_web_tables": len(schema_table_names(conn)),
    }
    return {
        "release": RELEASE_NAME,
        "version": RELEASE_VERSION,
        "release_date": RELEASE_DATE,
        "generated_at_utc": generated_at,
        "structure_coverage_sets": {
            "gold_internal_code": "ChEBI-complete structure set: all reaction participants map to ChEBI-normalized compounds with complete_structure status.",
            "silver_internal_code": "Structure-capable set: all reaction participants are model-structure-capable; the ChEBI-complete set is assigned first, so this set excludes overlap.",
            "interpretation": "The internal gold and silver codes are retained for API and file compatibility. They describe structure availability, not biological correctness or manual-review status.",
        },
        "relation_deduplication": {
            "released_key": "reaction_id + biopart_id + organism",
            "source_identity_note": "The source curation also uses protein sequence and organism context when consolidating biopart records.",
        },
        "reo_identifiers": {
            "field": "web_reaction_enzymes.reo_id",
            "policy": "Permanent monotonic identifiers backed by reo_id_registry.sqlite; identifiers are independent of SQLite rowid and retired identifiers are never reassigned.",
        },
        "annotation_richness_score": {
            "machine_field": "evidence_score",
            "purpose": "Ranks annotation richness for browsing and candidate comparison; it is not a probability of correctness or catalytic activity.",
            "tiers": {"strong": ">=75", "moderate": "45-74", "limited": "<45"},
            "inputs": [
                "publication and field-level PMID coverage",
                "kinetic PMID coverage",
                "independent cross-reference database count",
                "sequence and reaction-structure completeness",
                "chassis/context support",
                "protein domain, functional-site, structure, and M-CSA support where applicable",
            ],
            "counts": evidence_tiers,
        },
        "coverage": coverage,
        "automated_integrity_checks": [
            {**check, "status": "pass" if check["failures"] == 0 else "fail"} for check in checks
        ],
        "manual_review": {
            "status": "audit_sample_prepared_pending_human_review",
            "statement": "A deterministic stratified audit worksheet is released with this version. No independent blinded manual audit result, adjudicated error rate, or reviewer agreement statistic is claimed until completed worksheets are versioned with reviewer decisions.",
        },
        "known_limitations": [
            "External links and mappings differ in confidence; exact identifier links are stronger than EC-class or heuristic context links.",
            "Missing does not mean biologically absent; it can mean not reported, not mapped, not licensed for redistribution, or not yet integrated.",
            "Evidence scores measure annotation richness and should not be interpreted as calibrated correctness probabilities.",
            "AlphaFold coverage is predicted structural support; PDB coverage is experimental structural support. Neither alone proves catalytic activity.",
            "Benchmark tables currently contain positive links and transparent baselines, not final leakage-controlled blind test splits.",
            "846 Rhea-linked reactions retain an enzyme-link QC flag because the local UniProt candidate set has no exact overlap with the current Rhea2UniProt set (837) or lacks a local UniProt accession (9); these records are excluded from the default trainable reaction view pending manual adjudication.",
        ],
    }


def build_manual_audit_assets(conn: sqlite3.Connection, downloads_dir: Path) -> tuple[dict[str, dict[str, object]], int]:
    rows = sample_query(
        conn,
        """
        WITH reference_counts AS (
          SELECT entity_id AS reaction_id, COUNT(*) AS reference_count
          FROM web_entity_references
          WHERE entity_type = 'reaction'
          GROUP BY entity_id
        ),
        ranked AS (
          SELECT
            rid.reactenz_reaction_id,
            r.reaction_id,
            r.dataset_level,
            COALESCE(es.evidence_tier, 'limited') AS evidence_tier,
            COALESCE(es.evidence_score, 0) AS evidence_score,
            r.reaction_equation_display,
            r.ec_number,
            r.rhea_id,
            r.kegg_reaction_id,
            r.metacyc_reaction_id,
            r.participant_count,
            r.all_participants_have_smiles,
            r.enzyme_pair_count,
            r.kinetics_count,
            COALESCE(rc.reference_count, 0) AS reference_count,
            ROW_NUMBER() OVER (
              PARTITION BY r.dataset_level, COALESCE(es.evidence_tier, 'limited')
              ORDER BY hex(r.reaction_id)
            ) AS sample_rank
          FROM web_reactions r
          JOIN web_reaction_ids rid ON rid.reaction_id = r.reaction_id
          LEFT JOIN web_evidence_scores es ON es.entity_type = 'reaction' AND es.entity_id = r.reaction_id
          LEFT JOIN reference_counts rc ON rc.reaction_id = r.reaction_id
        )
        SELECT * FROM ranked
        WHERE sample_rank <= 25
        ORDER BY dataset_level, evidence_tier, sample_rank
        """,
    )
    master_columns = [
        "reactenz_reaction_id",
        "reaction_id",
        "dataset_level",
        "evidence_tier",
        "evidence_score",
        "reaction_equation_display",
        "ec_number",
        "rhea_id",
        "kegg_reaction_id",
        "metacyc_reaction_id",
        "participant_count",
        "all_participants_have_smiles",
        "enzyme_pair_count",
        "kinetics_count",
        "reference_count",
        "sample_rank",
    ]
    worksheet = write_tsv(downloads_dir / "reactenzdb_manual_audit_sample.tsv", rows, master_columns)
    review_columns = [
        "reactenz_reaction_id",
        "reaction_id",
        "reaction_equation_display",
        "ec_number",
        "rhea_id",
        "kegg_reaction_id",
        "metacyc_reaction_id",
        "reaction_identity",
        "participant_identity",
        "reaction_direction",
        "enzyme_link",
        "organism_link",
        "literature_link",
        "kinetics_assignment",
        "cross_reference_mapping",
        "overall_decision",
        "issue_type",
        "audit_notes",
        "reviewer_id",
        "reviewed_on",
    ]
    review_rows = []
    for row in rows:
        review_rows.append({
            **{column: row.get(column, "") for column in review_columns},
            "reaction_identity": "",
            "participant_identity": "",
            "reaction_direction": "",
            "enzyme_link": "",
            "organism_link": "",
            "literature_link": "",
            "kinetics_assignment": "",
            "cross_reference_mapping": "",
            "overall_decision": "",
            "issue_type": "",
            "audit_notes": "",
            "reviewer_id": "",
            "reviewed_on": "",
        })
    reviewer_a = write_tsv(downloads_dir / "reactenzdb_manual_audit_reviewer_a.tsv", review_rows, review_columns)
    reviewer_b = write_tsv(downloads_dir / "reactenzdb_manual_audit_reviewer_b.tsv", review_rows, review_columns)
    protocol = write_text(
        downloads_dir / "reactenzdb_manual_audit_protocol.md",
        """
        # ReactEnzDB manual audit protocol

        The master worksheet is a deterministic stratified sample of up to 25 reactions from each
        structure-coverage-code x annotation-coverage-band stratum. The internal `gold` and `silver`
        codes are sampling variables only; they are not correctness labels. Reviewer forms omit those
        sampling variables and scores to reduce expectation bias. This is not a completed audit result.

        ## Files and blinding

        - Keep `reactenzdb_manual_audit_sample.tsv` with the audit coordinator.
        - Give reviewer A only `reactenzdb_manual_audit_reviewer_a.tsv`.
        - Give reviewer B only `reactenzdb_manual_audit_reviewer_b.tsv`.
        - Reviewers must work independently and must not compare decisions before both forms are frozen.
        - Run `python summarize_manual_audit.py --reviewer-a ... --reviewer-b ... --master ... --output-dir ...` after both forms are complete.

        ## Reviewer procedure

        1. Open each ReactEnzDB reaction page and linked source records.
        2. Check reaction identity, participant identity, and direction against primary source records.
        3. Check at least one linked enzyme candidate and its source organism where available.
        4. Where present, check literature PMID, kinetic assignment, and external cross-reference context.
        5. For each component, record `pass`, `minor_issue`, `major_issue`, `not_applicable`, or `not_assessable`.
        6. Record the overall decision as `pass`, `minor_issue`, `major_issue`, or `not_assessable`.
        7. Use a controlled issue type: `reaction_identity`, `participant_identity`, `direction`, `enzyme_link`,
           `organism_link`, `literature_link`, `kinetics_assignment`, `cross_reference`, `multiple`, or `none`.
        8. Add concise source-grounded notes, a reviewer ID, and an ISO date (`YYYY-MM-DD`).

        A minor issue does not change the biological interpretation or principal entity mapping. A major issue
        changes the reaction identity/direction, a principal participant, or the claimed reaction-enzyme-organism link.
        Use not-assessable when available evidence cannot support a decision; do not convert missing evidence into pass.

        ## Reporting after review

        The summary script validates controlled values, reports reviewer completeness, raw agreement, Cohen's kappa,
        decision counts, issue counts, and Wilson 95% confidence intervals. It also emits a disagreement queue.
        A third domain expert must adjudicate every disagreement before a release-level error rate is reported.
        Archive both frozen reviewer forms, the adjudicated decisions, generated report, and script version.
        """,
    )
    return {
        "master": worksheet,
        "reviewer_a": reviewer_a,
        "reviewer_b": reviewer_b,
        "protocol": protocol,
    }, len(rows)


def scan_existing_exports(conn: sqlite3.Connection, downloads_dir: Path) -> list[dict[str, object]]:
    exports: list[dict[str, object]] = []
    for table in EXPORT_TABLES:
        row_count = int(conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])
        column_count = len(conn.execute(f'PRAGMA table_info("{table}")').fetchall())
        for suffix in ("csv", "tsv"):
            path = downloads_dir / f"{table}.{suffix}.gz"
            if not path.exists():
                continue
            exports.append(
                {
                    "table": table,
                    "file": f"downloads/{path.name}",
                    "format": f"{suffix.upper()}.GZ",
                    "rows": row_count,
                    "columns": column_count,
                    "size": path.stat().st_size,
                    "sha256": sha256(path),
                    "description": TABLE_DESCRIPTIONS.get(table, ""),
                }
            )
    return exports


def build_assets(
    db: Path,
    release_dir: Path,
    downloads_dir: Path,
    chunksize: int,
    skip_exports: bool,
    export_tables: list[str] | None = None,
    keep_manual_audit: bool = True,
) -> None:
    release_dir.mkdir(parents=True, exist_ok=True)
    downloads_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row

    generated_at = datetime.now(timezone.utc).isoformat()
    flat_exports: list[dict[str, object]] = []
    if not skip_exports:
        for table in export_tables or EXPORT_TABLES:
            print(f"[export] {table} CSV.GZ", flush=True)
            write_delimited(conn, table, downloads_dir, ",", "csv", chunksize)
            print(f"[export] {table} TSV.GZ", flush=True)
            write_delimited(conn, table, downloads_dir, "\t", "tsv", chunksize)
    flat_exports = scan_existing_exports(conn, downloads_dir)

    schema_tables = schema_table_names(conn)
    schema = schema_rows(conn, schema_tables)
    schema_json = write_json(downloads_dir / "reactenzdb_schema.json", schema)
    schema_tsv = write_tsv(
        downloads_dir / "reactenzdb_schema.tsv",
        schema,
        ["table", "table_description", "rows", "column", "type", "not_null", "default_value", "primary_key", "description"],
    )
    field_dict = write_tsv(
        downloads_dir / "reactenzdb_field_dictionary.tsv",
        schema,
        ["table", "column", "type", "description", "table_description"],
    )

    samples: list[dict[str, object]] = []
    sample_specs = {
        "sample_reactions.tsv": (
            "SELECT reaction_id, reaction_equation_display, ec_number, rhea_id, kegg_reaction_id, "
            "enzyme_pair_count, kinetics_count, dataset_level FROM web_reactions "
            "ORDER BY enzyme_pair_count DESC, kinetics_count DESC LIMIT 50"
        ),
        "sample_enzymes.tsv": (
            "SELECT e.biopart_id, e.enzyme_name, u.uniprot_accession, e.organism, e.sequence_length, "
            "e.reaction_count, COALESCE(k.kinetic_count, 0) AS kinetic_count, "
            "COALESCE(p.pdb_count, 0) + COALESCE(a.alphafold_count, 0) AS structure_count "
            "FROM web_enzymes e "
            "LEFT JOIN web_enzyme_uniprot u ON u.biopart_id = e.biopart_id "
            "LEFT JOIN (SELECT biopart_id, COUNT(*) AS kinetic_count FROM web_kinetics GROUP BY biopart_id) k ON k.biopart_id = e.biopart_id "
            "LEFT JOIN (SELECT biopart_id, COUNT(*) AS pdb_count FROM web_pdb_mappings GROUP BY biopart_id) p ON p.biopart_id = e.biopart_id "
            "LEFT JOIN (SELECT biopart_id, COUNT(*) AS alphafold_count FROM web_alphafold_mappings GROUP BY biopart_id) a ON a.biopart_id = e.biopart_id "
            "ORDER BY e.reaction_count DESC, kinetic_count DESC LIMIT 50"
        ),
        "sample_kinetics.tsv": (
            "SELECT kinetic_id, reaction_id, biopart_id, parameter_type, value_text, value_numeric, unit, "
            "evidence_text, pmids_json FROM web_kinetics LIMIT 50"
        ),
        "sample_protein_domains.tsv": (
            "SELECT biopart_id, uniprot_accession, annotation_db, entry_id, entry_name, entry_type, entry_url "
            "FROM web_protein_domains LIMIT 50"
        ),
        "sample_mcsa_mechanisms.tsv": (
            "SELECT mcsa_id, enzyme_name, reference_uniprot_id, all_ecs_json, description, "
            "mechanism_count, detailed_mechanism_count, residue_count, compound_count, pmids_json "
            "FROM web_mcsa_entries ORDER BY residue_count DESC LIMIT 50"
        ),
    }
    for filename, sql in sample_specs.items():
        rows = sample_query(conn, sql)
        columns = list(rows[0].keys()) if rows else []
        samples.append(write_tsv(downloads_dir / filename, rows, columns))

    sample_sql = write_text(
        downloads_dir / "reactenzdb_sample_queries.sql",
        """
        -- ReactEnzDB sample SQL queries for the SQLite release.

        -- 1. Find reactions with complete compound structures and many enzyme candidates.
        SELECT reactenz_reaction_id, reaction_equation_display, enzyme_pair_count, kinetics_count
        FROM web_reactions
        WHERE all_participants_have_smiles = 1
        ORDER BY enzyme_pair_count DESC
        LIMIT 25;

        -- 2. Retrieve enzymes for one reaction.
        SELECT re.reo_id, re.reaction_id, e.biopart_id, e.enzyme_name, u.uniprot_accession, e.organism
        FROM web_reaction_enzymes re
        JOIN web_enzymes e ON e.biopart_id = re.biopart_id
        LEFT JOIN web_enzyme_uniprot u ON u.biopart_id = e.biopart_id
        WHERE re.reaction_id = 'OENA15936'
        LIMIT 100;

        -- 3. Inspect kinetic evidence and external validation status.
        SELECT k.reaction_id, k.biopart_id, k.parameter_type, k.value_text, k.value_numeric, c.source, c.match_status
        FROM web_kinetics k
        LEFT JOIN web_kinetic_external_checks c ON c.kinetic_id = k.kinetic_id
        WHERE k.reaction_id = 'OENA15936'
        LIMIT 100;

        -- 4. Retrieve protein family/domain annotations for one enzyme.
        SELECT e.biopart_id, d.annotation_db, d.entry_id, d.entry_name, d.entry_type
        FROM web_enzymes e
        JOIN web_protein_domains d ON d.biopart_id = e.biopart_id
        WHERE e.biopart_id = 'OENC72257';

        -- 5. Retrieve mapped M-CSA catalytic residues and mechanism context.
        SELECT m.biopart_id, r.mcsa_id, r.uniprot_residue_code, r.uniprot_residue_position,
               r.function_location_abv, r.roles_summary, r.main_annotation
        FROM web_mcsa_enzyme_mappings m
        JOIN web_mcsa_residues r ON r.mcsa_id = m.mcsa_id
        WHERE m.biopart_id = 'OENC72257';
        """,
    )

    qa_summary = build_qa_summary(conn, generated_at)
    existing_audit = {
        "master": downloads_dir / "reactenzdb_manual_audit_sample.tsv",
        "reviewer_a": downloads_dir / "reactenzdb_manual_audit_reviewer_a.tsv",
        "reviewer_b": downloads_dir / "reactenzdb_manual_audit_reviewer_b.tsv",
        "protocol": downloads_dir / "reactenzdb_manual_audit_protocol.md",
    }
    if keep_manual_audit and all(path.exists() for path in existing_audit.values()):
        print("[audit] keeping existing 150-reaction worksheets", flush=True)
        sample_size = max(sum(1 for _ in existing_audit["master"].open(encoding="utf-8")) - 1, 0)
        manual_audit_assets = {key: artifact(path) for key, path in existing_audit.items()}
        manual_audit_sample_size = sample_size
    else:
        manual_audit_assets, manual_audit_sample_size = build_manual_audit_assets(conn, downloads_dir)
    audit_summary_script = write_text(
        downloads_dir / "summarize_manual_audit.py",
        (ROOT / "scripts" / "summarize_manual_audit.py").read_text(encoding="utf-8"),
    )
    qa_summary["manual_review"]["audit_sample_file"] = manual_audit_assets["master"]["file"]
    qa_summary["manual_review"]["reviewer_a_file"] = manual_audit_assets["reviewer_a"]["file"]
    qa_summary["manual_review"]["reviewer_b_file"] = manual_audit_assets["reviewer_b"]["file"]
    qa_summary["manual_review"]["audit_protocol_file"] = manual_audit_assets["protocol"]["file"]
    qa_summary["manual_review"]["audit_sample_size"] = manual_audit_sample_size
    qa_json = write_json(downloads_dir / "reactenzdb_qa_summary.json", qa_summary)
    qa = qa_summary["coverage"]
    qa_checks = qa_summary["automated_integrity_checks"]
    qa_markdown = write_text(
        downloads_dir / "reactenzdb_qa_report.md",
        f"""
        # ReactEnzDB {RELEASE_VERSION} quality assurance report

        Generated: {generated_at}

        ## Release scope

        - Reactions: {qa['reactions']:,}
        - ChEBI-complete structure set (internal code `gold`): {qa['gold_structure_tier_reactions']:,}
        - Structure-capable set (internal code `silver`): {qa['silver_structure_tier_reactions']:,}
        - SMILES-complete reactions: {qa['smiles_complete_reactions']:,}
        - Reaction-enzyme-organism records: {qa['reaction_enzyme_organism_records']:,}
        - Enzymes: {qa['enzymes']:,}
        - Kinetic records: {qa['kinetic_records']:,}
        - Entity references: {qa['entity_references']:,}

        ## Structure-coverage sets

        The **ChEBI-complete structure set** (internal code `gold`) requires every reaction participant
        to map to a ChEBI-normalized compound with `complete_structure` status. The **structure-capable
        set** (internal code `silver`) requires every participant to be model-structure-capable and
        excludes the first set. The legacy machine codes are retained for compatibility. They describe
        structure availability and are not an independently audited biological truth standard.

        ## Automated integrity checks

        {chr(10).join(f"- [{'PASS' if item['status'] == 'pass' else 'FAIL'}] {item['check']}: {item['failures']} failure(s)" for item in qa_checks)}

        ## Annotation richness score interpretation

        The machine field `evidence_score` summarizes annotation richness. Strong is >=75, moderate is
        45-74, and limited is <45. These are internal coverage bands, not confidence classes. The score
        is not a calibrated probability of correctness or catalytic activity. Inputs include
        publication/field PMIDs, kinetic PMIDs, cross-database references, sequence and structure
        completeness, context annotations, and protein/mechanism evidence where applicable.

        ## Manual review status

        A deterministic stratified master sample ({manual_audit_sample_size} rows), two score-blinded reviewer
        forms, and an audit protocol are included in this release. The current release does not report an independent
        manual audit result or empirical error rate. Both reviews and third-reviewer adjudication must be completed
        before those statistics are generated; they must not be inferred from structure coverage or annotation richness.

        ## Known limitations

        - Exact identifier mappings and EC-class/heuristic mappings are displayed separately and must not be treated as equivalent.
        - Missing values can mean not reported, not mapped, not redistributable, or not yet integrated; they do not prove biological absence.
        - AlphaFold and PDB evidence support structural assessment but do not alone prove catalytic activity.
        - Current benchmark tables contain positive links and transparent baselines, not final leakage-controlled blind test splits.
        """,
    )

    data_layer_registry_file, data_layer_registry_markdown = build_data_layer_registry(db, release_dir, generated_at)

    license_file = write_text(
        release_dir / "LICENSE_DATA.txt",
        f"""
        ReactEnzDB data release license

        ReactEnzDB-added curation, identifiers, schema documentation, and derived summary tables are released under the Creative Commons Attribution 4.0 International License (CC BY 4.0), unless otherwise stated.

        External identifiers and annotations from source databases remain subject to the terms of their original providers. Users should cite ReactEnzDB and the relevant source resources represented in the records they use, including RDBSB, UniProt, InterPro, Pfam, ChEBI, PubChem, Rhea, KEGG, MetaCyc, BRENDA, SABIO-RK, PDB, AlphaFold DB, MetaNetX, and M-CSA where applicable.

        Release scope: ReactEnzDB {RELEASE_VERSION}, released {RELEASE_DATE}. Source-specific terms take precedence for externally derived records and identifiers.
        """,
    )
    citation_file = write_text(
        release_dir / "CITATION.cff",
        f"""
        cff-version: 1.2.0
        message: "If you use ReactEnzDB, please cite the ReactEnzDB database paper and the specific data release."
        title: "ReactEnzDB: Reaction-centered Enzyme Evidence and Implementation Database, release {RELEASE_VERSION}"
        type: dataset
        version: "{RELEASE_VERSION}"
        date-released: "{RELEASE_DATE}"
        authors:
          - family-names: "Liu"
            given-names: "Shanghua"
            affiliation: "University of Electronic Science and Technology of China"
        keywords:
          - enzyme
          - reaction
          - biosynthesis
          - database
          - biocatalysis
        """,
    )
    readme_file = write_text(
        release_dir / "README_RELEASE.md",
        f"""
        # {RELEASE_NAME}

        **Reaction-centered Enzyme Evidence and Implementation Database**

        *From biochemical reactions to evidence-ranked enzymes and host implementation context*

        Version: {RELEASE_VERSION}

        Release date: {RELEASE_DATE}

        This release contains the complete ReactEnzDB SQLite database, compressed CSV/TSV table exports, schema documentation, a field dictionary, example records, sample SQL queries, license text, citation metadata, model-ready data, retrosynthesis resources, experimental-expression candidate evidence, and host-context layers.

        ## Data-layer authority

        Read `DATA_LAYER_REGISTRY.json` before combining data layers. `reactenzdb_web.db` is authoritative for curated core records. `retrosynthesis_resources.sqlite` is the sole authoritative source for externally imported retrosynthesis rules, building blocks, route targets, and benchmark reactions. `model_ready_dataset.sqlite`, `rule_template_benchmark.sqlite`, and `host_context_chassis.sqlite` are derived layers with declared upstream sources. Historical `web_retrosynthesis_*` tables in the core database are retained only for compatibility and are excluded from public schema and bulk exports.

        Recommended reproducible workflow:

        1. Download `reactenzdb_web.db` for complete relational analysis.
        2. Verify downloaded files against SHA256 checksums in `downloads/release_files_manifest.json`.
        3. Use `downloads/reactenzdb_schema.tsv` and `downloads/reactenzdb_field_dictionary.tsv` to inspect table and column definitions.
        4. Use `downloads/sample_*.tsv` and `downloads/reactenzdb_sample_queries.sql` as starting examples.
        5. Cite the exact release version and access date in downstream work.
        """,
    )

    csv_manifest_path = downloads_dir / "csv_exports_manifest.json"
    csv_manifest = {
        "release": RELEASE_NAME,
        "version": RELEASE_VERSION,
        "release_date": RELEASE_DATE,
        "created_at_utc": generated_at,
        "source_db": db.name,
        "exports": flat_exports,
    }
    write_json(csv_manifest_path, csv_manifest)

    db_artifact = {
        "file": "reactenzdb_web.db",
        "size": db.stat().st_size,
        "sha256": sha256(db),
    }
    release_artifacts = [
        db_artifact,
        artifact(release_dir / "alphafold_match_report.json") if (release_dir / "alphafold_match_report.json").exists() else None,
        artifact(release_dir / "compound_pubchem_enrichment_report.json") if (release_dir / "compound_pubchem_enrichment_report.json").exists() else None,
        artifact(release_dir / "compound_svg_report.json") if (release_dir / "compound_svg_report.json").exists() else None,
        license_file,
        citation_file,
        readme_file,
        data_layer_registry_file,
        data_layer_registry_markdown,
        schema_json,
        schema_tsv,
        field_dict,
        qa_json,
        qa_markdown,
        *manual_audit_assets.values(),
        audit_summary_script,
        sample_sql,
        *samples,
        artifact(csv_manifest_path),
    ]
    release_artifacts.extend(
        {
            "file": export["file"],
            "size": export["size"],
            "sha256": export["sha256"],
            "table": export["table"],
            "format": export["format"],
            "rows": export["rows"],
            "columns": export["columns"],
            "description": export.get("description", ""),
        }
        for export in csv_manifest["exports"]
    )
    existing_artifact_names = {str(item["file"]) for item in release_artifacts if item is not None}
    for relative_path in EXTRA_RELEASE_FILES:
        path = release_dir / relative_path
        if path.exists() and relative_path not in existing_artifact_names:
            release_artifacts.append(artifact(path))
            existing_artifact_names.add(relative_path)
    release_artifacts = [item for item in release_artifacts if item is not None]

    release_manifest = {
        "release": RELEASE_NAME,
        "version": RELEASE_VERSION,
        "release_date": RELEASE_DATE,
        "generated_at_utc": generated_at,
        "license": "CC BY 4.0 for ReactEnzDB-added curation and derived summary tables; source database terms remain applicable.",
        "citation": "Cite the ReactEnzDB manuscript, this release version, access date, and relevant source databases.",
        "data_layer_registry": "DATA_LAYER_REGISTRY.json",
        "artifacts": release_artifacts,
        "schema": {
            "tables": len(schema_tables),
            "fields": len(schema),
        },
        "qa": {
            "report": "downloads/reactenzdb_qa_report.md",
            "summary": "downloads/reactenzdb_qa_summary.json",
            "automated_checks_passed": sum(1 for item in qa_checks if item["status"] == "pass"),
            "automated_checks_total": len(qa_checks),
            "formal_manual_error_rate_reported": False,
        },
    }
    release_manifest_file = write_json(downloads_dir / "release_files_manifest.json", release_manifest)
    release_artifacts.append(release_manifest_file)

    base_manifest = {
        "release": RELEASE_NAME,
        "version": RELEASE_VERSION,
        "release_date": RELEASE_DATE,
        "source_db": "rdbsb_biosyn_v2.db",
        "output_db": db.name,
        "artifacts": {item["file"]: {"size": item["size"], "sha256": item["sha256"]} for item in release_artifacts},
        "stats": {row["metric"]: row["value"] for row in sample_query(conn, "SELECT metric, value FROM web_stats")},
        "schema_files": [
            "downloads/reactenzdb_schema.json",
            "downloads/reactenzdb_schema.tsv",
            "downloads/reactenzdb_field_dictionary.tsv",
        ],
        "sample_files": [item["file"] for item in samples] + ["downloads/reactenzdb_sample_queries.sql"],
        "qa_files": ["downloads/reactenzdb_qa_report.md", "downloads/reactenzdb_qa_summary.json"],
        "data_layer_registry": "DATA_LAYER_REGISTRY.json",
        "canonical_dedup": {
            "key": "reaction_id + protein_sequence + organism",
            "note": "Non-redundant reaction-enzyme-organism records are used as the operational ReactEnzDB browsing layer.",
        },
        "data_use_notes": [
            "Use the SQLite file for complete reproducible relational analysis.",
            "Use CSV.GZ/TSV.GZ files for bulk table-level imports.",
            "Use schema and field dictionary files to interpret columns and joins.",
            "Verify downloaded artifacts using SHA256 checksums before downstream analysis.",
        ],
    }
    write_json(release_dir / "manifest.json", base_manifest)
    print(
        json.dumps(
            {
                "release": RELEASE_NAME,
                "exports": len(csv_manifest["exports"]),
                "schema_fields": len(schema),
                "manifest": str(downloads_dir / "release_files_manifest.json"),
            },
            indent=2,
            ensure_ascii=False,
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare FAIR release downloads for ReactEnzDB.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--release-dir", type=Path, default=DEFAULT_RELEASE_DIR)
    parser.add_argument("--downloads-dir", type=Path, default=DEFAULT_DOWNLOAD_DIR)
    parser.add_argument("--chunksize", type=int, default=25000)
    parser.add_argument("--skip-exports", action="store_true", help="Regenerate docs/manifests without rewriting CSV/TSV tables.")
    parser.add_argument(
        "--export-table",
        action="append",
        choices=EXPORT_TABLES,
        help="Rewrite only the selected table export(s), then refresh all schemas and manifests.",
    )
    parser.add_argument(
        "--rebuild-manual-audit",
        action="store_true",
        help="Regenerate the 150-reaction audit worksheets. Default is to keep the existing frozen sample.",
    )
    args = parser.parse_args()
    if not args.db.exists():
        raise FileNotFoundError(args.db)
    build_assets(
        args.db,
        args.release_dir,
        args.downloads_dir,
        args.chunksize,
        args.skip_exports,
        args.export_table,
        keep_manual_audit=not args.rebuild_manual_audit,
    )


if __name__ == "__main__":
    main()
