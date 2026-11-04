#!/usr/bin/env python3
"""Build the ReactEnzDB candidate-enzyme redundancy and diversity analysis.

The analysis is derived from the released NR100/90/70/50 MMseqs2 views.  It
does not rerun clustering and does not treat sequence similarity as evidence
of identical substrate specificity. Kinetic and reaction-support fields use
the final standardized BRENDA, SABIO-RK, and ReactEnzDB-core evidence projection.
"""

from __future__ import annotations

import csv
import datetime as dt
import gzip
import hashlib
import json
import math
import os
import sqlite3
import statistics
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable, Sequence


ROOT = Path(__file__).resolve().parents[1]
RELEASE_ROOT = ROOT / "web_release"
SOURCE_DB = ROOT / "web_release" / "enzyme_sequence_clusters.sqlite"
OUTPUT_DB = ROOT / "web_release" / "candidate_diversity_analysis.sqlite"
SUMMARY_JSON = ROOT / "web_release" / "candidate_diversity_analysis.summary.json"
README_MD = ROOT / "web_release" / "CANDIDATE_DIVERSITY_ANALYSIS.md"
DOWNLOAD_DIR = ROOT / "web_release" / "downloads"
RULE_VERSION = "candidate_redundancy_diversity_v2_final_evidence"
THRESHOLDS = (100, 90, 70, 50)


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def quantile(values: Sequence[float], q: float) -> float:
    ordered = sorted(float(value) for value in values)
    if not ordered:
        return 0.0
    position = (len(ordered) - 1) * q
    lower, upper = math.floor(position), math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] * (upper - position) + ordered[upper] * (position - lower)


def distribution(values: Sequence[float]) -> dict[str, float | int]:
    return {
        "n": len(values),
        "zero_count": sum(float(value) == 0 for value in values),
        "mean": statistics.fmean(values) if values else 0.0,
        "minimum": min(values, default=0),
        "p25": quantile(values, 0.25),
        "median": quantile(values, 0.50),
        "p75": quantile(values, 0.75),
        "p90": quantile(values, 0.90),
        "p95": quantile(values, 0.95),
        "p99": quantile(values, 0.99),
        "maximum": max(values, default=0),
    }


def write_tsv(path: Path, rows: Iterable[sqlite3.Row], fields: Sequence[str], gzip_output: bool = False) -> int:
    opener = gzip.open if gzip_output else open
    kwargs: dict[str, Any] = {"mode": "wt", "encoding": "utf-8", "newline": ""}
    count = 0
    with opener(path, **kwargs) as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, delimiter="\t", extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(dict(row))
            count += 1
    return count


def initialize(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=NORMAL;
        DROP TABLE IF EXISTS metadata;
        DROP TABLE IF EXISTS final_evidence_summary;
        DROP TABLE IF EXISTS reaction_candidate_diversity;
        DROP TABLE IF EXISTS threshold_coverage_summary;
        DROP TABLE IF EXISTS reaction_metric_distributions;
        DROP TABLE IF EXISTS high_evidence_taxonomy_summary;
        DROP TABLE IF EXISTS qa_results;

        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE final_evidence_summary (
          metric TEXT PRIMARY KEY,
          value INTEGER NOT NULL,
          definition TEXT NOT NULL
        );
        CREATE TABLE reaction_candidate_diversity (
          reaction_id TEXT PRIMARY KEY,
          reactenz_reaction_id TEXT NOT NULL,
          enzyme_candidate_count INTEGER NOT NULL,
          unique_sequence_count INTEGER NOT NULL,
          duplicate_sequence_record_count INTEGER NOT NULL,
          nr100_cluster_count INTEGER NOT NULL,
          nr90_cluster_count INTEGER NOT NULL,
          nr70_cluster_count INTEGER NOT NULL,
          nr50_cluster_count INTEGER NOT NULL,
          nr90_reduction_fraction_vs_records REAL NOT NULL,
          nr90_reduction_fraction_vs_unique_sequences REAL NOT NULL,
          nr70_reduction_fraction_vs_records REAL NOT NULL,
          nr50_reduction_fraction_vs_records REAL NOT NULL,
          multiple_nr70_clusters INTEGER NOT NULL,
          multiple_nr50_clusters INTEGER NOT NULL,
          species_count INTEGER NOT NULL,
          genus_count INTEGER NOT NULL,
          phylum_count INTEGER NOT NULL,
          species_shannon REAL NOT NULL,
          experimental_candidate_count INTEGER NOT NULL,
          any_kinetic_candidate_count INTEGER NOT NULL,
          reaction_kinetic_candidate_count INTEGER NOT NULL,
          exact_external_kinetic_candidate_count INTEGER NOT NULL,
          pdb_candidate_count INTEGER NOT NULL,
          alphafold_candidate_count INTEGER NOT NULL,
          structure_candidate_count INTEGER NOT NULL,
          active_site_candidate_count INTEGER NOT NULL,
          reaction_supported_candidate_count INTEGER NOT NULL,
          multimodal_candidate_count INTEGER NOT NULL,
          kinetic_snapshot_status TEXT NOT NULL
        );
        CREATE INDEX idx_candidate_diversity_nr90 ON reaction_candidate_diversity(nr90_cluster_count);
        CREATE INDEX idx_candidate_diversity_nr70 ON reaction_candidate_diversity(nr70_cluster_count);
        CREATE INDEX idx_candidate_diversity_multimodal ON reaction_candidate_diversity(multimodal_candidate_count);

        CREATE TABLE threshold_coverage_summary (
          threshold INTEGER PRIMARY KEY,
          cluster_count INTEGER NOT NULL,
          enzyme_record_count INTEGER NOT NULL,
          unique_sequence_memberships INTEGER NOT NULL,
          compression_fraction_vs_enzyme_records REAL NOT NULL,
          clusters_with_experimental_support INTEGER NOT NULL,
          clusters_with_kinetic_support INTEGER NOT NULL,
          clusters_with_pdb_support INTEGER NOT NULL,
          clusters_with_alphafold_support INTEGER NOT NULL,
          clusters_with_active_site_support INTEGER NOT NULL,
          representatives_with_experimental_support INTEGER NOT NULL,
          representatives_with_kinetic_support INTEGER NOT NULL,
          representatives_with_pdb_support INTEGER NOT NULL,
          representatives_with_alphafold_support INTEGER NOT NULL,
          representatives_with_active_site_support INTEGER NOT NULL,
          kinetic_supported_cluster_representative_retention REAL NOT NULL,
          pdb_supported_cluster_representative_retention REAL NOT NULL,
          active_site_cluster_representative_retention REAL NOT NULL,
          reaction_count INTEGER NOT NULL,
          mean_clusters_per_reaction REAL NOT NULL,
          median_clusters_per_reaction REAL NOT NULL,
          p90_clusters_per_reaction REAL NOT NULL,
          reactions_with_multiple_clusters INTEGER NOT NULL
        );

        CREATE TABLE reaction_metric_distributions (
          metric TEXT PRIMARY KEY,
          reaction_count INTEGER NOT NULL,
          zero_count INTEGER NOT NULL,
          mean REAL NOT NULL,
          minimum REAL NOT NULL,
          p25 REAL NOT NULL,
          median REAL NOT NULL,
          p75 REAL NOT NULL,
          p90 REAL NOT NULL,
          p95 REAL NOT NULL,
          p99 REAL NOT NULL,
          maximum REAL NOT NULL,
          interpretation TEXT NOT NULL
        );

        CREATE TABLE high_evidence_taxonomy_summary (
          phylum TEXT PRIMARY KEY,
          enzyme_candidate_count INTEGER NOT NULL,
          reaction_association_count INTEGER NOT NULL,
          reaction_count INTEGER NOT NULL,
          species_count INTEGER NOT NULL,
          candidates_with_pdb INTEGER NOT NULL,
          candidates_with_alphafold INTEGER NOT NULL,
          candidates_with_active_site INTEGER NOT NULL
        );

        CREATE TABLE qa_results (
          check_name TEXT PRIMARY KEY,
          passed INTEGER NOT NULL,
          observed_value TEXT NOT NULL,
          expected_value TEXT NOT NULL,
          details_json TEXT NOT NULL,
          checked_at TEXT NOT NULL
        );
        """
    )


def load_reaction_analysis(conn: sqlite3.Connection) -> None:
    conn.execute("ATTACH DATABASE ? AS cluster", (str(SOURCE_DB),))
    base_rows = conn.execute(
        """
        WITH candidates AS (
          SELECT m.reaction_id,m.reactenz_reaction_id,m.biopart_id,e.sequence_key,
                 e.species,e.genus,e.phylum,e.experimental_support,e.kinetic_count,
                 e.pdb_count,e.alphafold_count,e.active_site_count,
                 m.reaction_kinetic_count,m.reaction_exact_external_count,
                 COALESCE(f.best_evidence_rank,99) final_evidence_rank,
                 COALESCE(f.catalytic_assertion_count,0) final_catalytic_assertion_count
          FROM cluster.reaction_cluster_members m
          JOIN cluster.enzyme_sequence_records e USING(biopart_id)
          LEFT JOIN cluster.final_reaction_enzyme_evidence f
            ON f.reaction_id=m.reaction_id AND f.biopart_id=m.biopart_id
          WHERE m.threshold=100
        ), cluster_counts AS (
          SELECT reaction_id,
                 SUM(threshold=100) nr100_count,
                 SUM(threshold=90) nr90_count,
                 SUM(threshold=70) nr70_count,
                 SUM(threshold=50) nr50_count
          FROM cluster.reaction_sequence_clusters
          GROUP BY reaction_id
        )
        SELECT c.reaction_id,MIN(c.reactenz_reaction_id) reactenz_reaction_id,
               COUNT(DISTINCT c.biopart_id) enzyme_candidate_count,
               COUNT(DISTINCT c.sequence_key) unique_sequence_count,
               COUNT(DISTINCT c.species) species_count,
               COUNT(DISTINCT c.genus) genus_count,
               COUNT(DISTINCT c.phylum) phylum_count,
               SUM(c.experimental_support>0) experimental_candidate_count,
               SUM(c.kinetic_count>0) any_kinetic_candidate_count,
               SUM(c.reaction_kinetic_count>0) reaction_kinetic_candidate_count,
               SUM(c.reaction_exact_external_count>0) exact_external_kinetic_candidate_count,
               SUM(c.pdb_count>0) pdb_candidate_count,
               SUM(c.alphafold_count>0) alphafold_candidate_count,
               SUM(c.pdb_count>0 OR c.alphafold_count>0) structure_candidate_count,
               SUM(c.active_site_count>0) active_site_candidate_count,
               SUM(c.final_evidence_rank<=2 AND c.final_catalytic_assertion_count>0) reaction_supported_candidate_count,
               SUM(c.final_evidence_rank<=2 AND c.final_catalytic_assertion_count>0
                   AND (c.pdb_count>0 OR c.alphafold_count>0)) multimodal_candidate_count,
               cc.nr100_count,cc.nr90_count,cc.nr70_count,cc.nr50_count
        FROM candidates c JOIN cluster_counts cc USING(reaction_id)
        GROUP BY c.reaction_id
        ORDER BY c.reaction_id
        """
    ).fetchall()

    species_counts: dict[str, Counter[str]] = defaultdict(Counter)
    for row in conn.execute(
        """
        SELECT m.reaction_id,COALESCE(e.species,e.organism,'Unresolved') species,COUNT(*) n
        FROM cluster.reaction_cluster_members m
        JOIN cluster.enzyme_sequence_records e USING(biopart_id)
        WHERE m.threshold=100
        GROUP BY m.reaction_id,COALESCE(e.species,e.organism,'Unresolved')
        """
    ):
        species_counts[row[0]][row[1]] = row[2]

    inserts = []
    for row in base_rows:
        values = dict(row)
        total = values["enzyme_candidate_count"]
        unique = values["unique_sequence_count"]
        counts = species_counts[values["reaction_id"]]
        shannon = -sum((n / sum(counts.values())) * math.log(n / sum(counts.values())) for n in counts.values()) if counts else 0.0
        inserts.append(
            (
                values["reaction_id"], values["reactenz_reaction_id"], total, unique, total - unique,
                values["nr100_count"], values["nr90_count"], values["nr70_count"], values["nr50_count"],
                1.0 - values["nr90_count"] / max(total, 1),
                1.0 - values["nr90_count"] / max(unique, 1),
                1.0 - values["nr70_count"] / max(total, 1),
                1.0 - values["nr50_count"] / max(total, 1),
                int(values["nr70_count"] >= 2), int(values["nr50_count"] >= 2),
                values["species_count"], values["genus_count"], values["phylum_count"], shannon,
                values["experimental_candidate_count"], values["any_kinetic_candidate_count"],
                values["reaction_kinetic_candidate_count"], values["exact_external_kinetic_candidate_count"],
                values["pdb_candidate_count"], values["alphafold_candidate_count"],
                values["structure_candidate_count"], values["active_site_candidate_count"],
                values["reaction_supported_candidate_count"], values["multimodal_candidate_count"],
                "final_standardized_brenda_sabio_core_evidence",
            )
        )
    conn.executemany(
        "INSERT INTO reaction_candidate_diversity VALUES (" + ",".join("?" for _ in range(30)) + ")",
        inserts,
    )


def load_final_evidence_summary(conn: sqlite3.Connection) -> None:
    rows = [
        (
            "matched_reaction_enzyme_pairs",
            conn.execute("SELECT COUNT(*) FROM cluster.final_reaction_enzyme_evidence").fetchone()[0],
            "Final evidence pairs that also have a sequence-bearing ReactEnzDB reaction-enzyme association.",
        ),
        (
            "reactions_with_exact_substrate_product_candidates",
            conn.execute("SELECT COUNT(DISTINCT reaction_id) FROM cluster.final_reaction_enzyme_evidence WHERE exact_assertion_count>0 AND catalytic_assertion_count>0").fetchone()[0],
            "Reactions with at least one sequence candidate supported by exact substrate/product experimental evidence.",
        ),
        (
            "sequence_enzymes_with_final_evidence",
            conn.execute("SELECT COUNT(*) FROM cluster.final_enzyme_evidence WHERE assertion_count>0").fetchone()[0],
            "Sequence-bearing enzymes with a final reaction-specific evidence assertion.",
        ),
        (
            "sequence_enzymes_with_exact_reaction_evidence",
            conn.execute("SELECT COUNT(*) FROM cluster.final_enzyme_evidence WHERE exact_reaction_count>0").fetchone()[0],
            "Sequence-bearing enzymes with at least one exact substrate/product supported reaction.",
        ),
    ]
    conn.executemany("INSERT INTO final_evidence_summary VALUES (?,?,?)", rows)


def load_threshold_summary(conn: sqlite3.Connection) -> None:
    for threshold in THRESHOLDS:
        aggregate = conn.execute(
            """
            SELECT COUNT(*) cluster_count,SUM(c.enzyme_record_count) enzyme_record_count,
                   SUM(c.unique_sequence_count) unique_sequence_memberships,
                   SUM(c.experimental_supported_count>0) clusters_experimental,
                   SUM(c.kinetic_supported_count>0) clusters_kinetic,
                   SUM(c.pdb_supported_count>0) clusters_pdb,
                   SUM(c.alphafold_supported_count>0) clusters_alphafold,
                   SUM(c.active_site_supported_count>0) clusters_active,
                   SUM(e.experimental_support>0) reps_experimental,
                   SUM(e.kinetic_count>0) reps_kinetic,
                   SUM(e.pdb_count>0) reps_pdb,
                   SUM(e.alphafold_count>0) reps_alphafold,
                   SUM(e.active_site_count>0) reps_active
            FROM cluster.sequence_clusters c
            JOIN cluster.enzyme_sequence_records e
              ON e.biopart_id=c.global_representative_biopart_id
            WHERE c.threshold=?
            """, (threshold,),
        ).fetchone()
        reaction_counts = [
            row[0] for row in conn.execute(
                "SELECT COUNT(*) FROM cluster.reaction_sequence_clusters WHERE threshold=? GROUP BY reaction_id",
                (threshold,),
            )
        ]
        conn.execute(
            "INSERT INTO threshold_coverage_summary VALUES (" + ",".join("?" for _ in range(23)) + ")",
            (
                threshold, aggregate[0], aggregate[1], aggregate[2], 1.0 - aggregate[0] / max(aggregate[1], 1),
                aggregate[3], aggregate[4], aggregate[5], aggregate[6], aggregate[7],
                aggregate[8], aggregate[9], aggregate[10], aggregate[11], aggregate[12],
                aggregate[9] / max(aggregate[4], 1), aggregate[10] / max(aggregate[5], 1),
                aggregate[12] / max(aggregate[7], 1), len(reaction_counts),
                statistics.fmean(reaction_counts), quantile(reaction_counts, 0.5), quantile(reaction_counts, 0.9),
                sum(value >= 2 for value in reaction_counts),
            ),
        )


def load_distributions(conn: sqlite3.Connection) -> None:
    definitions = {
        "enzyme_candidate_count": "Raw sequence-bearing enzyme records associated with a reaction.",
        "unique_sequence_count": "Exact unique sequences associated with a reaction.",
        "nr90_cluster_count": "Non-redundant representatives at at least 90% sequence identity.",
        "nr70_cluster_count": "Broader sequence families at at least 70% identity.",
        "nr50_cluster_count": "Remote sequence families at at least 50% identity.",
        "species_count": "Distinct resolved species represented among reaction candidates.",
        "phylum_count": "Distinct resolved phyla represented among reaction candidates.",
        "reaction_supported_candidate_count": "Candidates with experimental support and reaction-specific kinetic or exact external kinetic evidence.",
        "multimodal_candidate_count": "Reaction-supported candidates also having PDB or AlphaFold structure coverage.",
    }
    for metric, interpretation in definitions.items():
        values = [row[0] for row in conn.execute(f"SELECT {metric} FROM reaction_candidate_diversity")]
        stats = distribution(values)
        conn.execute(
            "INSERT INTO reaction_metric_distributions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                metric, stats["n"], stats["zero_count"], stats["mean"], stats["minimum"], stats["p25"],
                stats["median"], stats["p75"], stats["p90"], stats["p95"], stats["p99"], stats["maximum"],
                interpretation,
            ),
        )


def load_taxonomy_summary(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        INSERT INTO high_evidence_taxonomy_summary
        SELECT COALESCE(e.phylum,'Unresolved') phylum,
               COUNT(DISTINCT e.biopart_id) enzyme_candidate_count,
               COUNT(*) reaction_association_count,
               COUNT(DISTINCT m.reaction_id) reaction_count,
               COUNT(DISTINCT COALESCE(e.species,e.organism)) species_count,
               COUNT(DISTINCT CASE WHEN e.pdb_count>0 THEN e.biopart_id END) candidates_with_pdb,
               COUNT(DISTINCT CASE WHEN e.alphafold_count>0 THEN e.biopart_id END) candidates_with_alphafold,
               COUNT(DISTINCT CASE WHEN e.active_site_count>0 THEN e.biopart_id END) candidates_with_active_site
        FROM cluster.reaction_cluster_members m
        JOIN cluster.enzyme_sequence_records e USING(biopart_id)
        JOIN cluster.final_reaction_enzyme_evidence f
          ON f.reaction_id=m.reaction_id AND f.biopart_id=m.biopart_id
        WHERE m.threshold=100 AND f.best_evidence_rank<=2
          AND f.catalytic_assertion_count>0
        GROUP BY COALESCE(e.phylum,'Unresolved')
        ORDER BY enzyme_candidate_count DESC
        """
    )


def add_qa(conn: sqlite3.Connection) -> None:
    stamp = now()
    reaction_source = conn.execute(
        "SELECT COUNT(DISTINCT reaction_id) FROM cluster.reaction_cluster_members WHERE threshold=100"
    ).fetchone()[0]
    reaction_output = conn.execute("SELECT COUNT(*) FROM reaction_candidate_diversity").fetchone()[0]
    nonmonotonic_independent_views = conn.execute(
        """
        SELECT COUNT(*) FROM reaction_candidate_diversity
        WHERE nr100_cluster_count<nr90_cluster_count OR nr90_cluster_count<nr70_cluster_count
           OR nr70_cluster_count<nr50_cluster_count
        """
    ).fetchone()[0]
    invalid_cluster_bounds = conn.execute(
        """
        SELECT COUNT(*) FROM reaction_candidate_diversity
        WHERE nr100_cluster_count<1 OR nr90_cluster_count<1 OR nr70_cluster_count<1 OR nr50_cluster_count<1
           OR nr100_cluster_count>unique_sequence_count OR nr90_cluster_count>unique_sequence_count
           OR nr70_cluster_count>unique_sequence_count OR nr50_cluster_count>unique_sequence_count
        """
    ).fetchone()[0]
    conn.execute(
        "INSERT OR REPLACE INTO metadata VALUES (?,?)",
        ("nonmonotonic_independent_view_reaction_count", str(nonmonotonic_independent_views)),
    )
    checks = [
        ("reaction_coverage", reaction_output == reaction_source, reaction_output, reaction_source, {}),
        ("nonnegative_candidate_counts", conn.execute("SELECT COUNT(*) FROM reaction_candidate_diversity WHERE enzyme_candidate_count<1 OR unique_sequence_count<1").fetchone()[0] == 0,
         conn.execute("SELECT COUNT(*) FROM reaction_candidate_diversity WHERE enzyme_candidate_count<1 OR unique_sequence_count<1").fetchone()[0], 0, {}),
        ("unique_sequences_not_above_records", conn.execute("SELECT COUNT(*) FROM reaction_candidate_diversity WHERE unique_sequence_count>enzyme_candidate_count").fetchone()[0] == 0,
         conn.execute("SELECT COUNT(*) FROM reaction_candidate_diversity WHERE unique_sequence_count>enzyme_candidate_count").fetchone()[0], 0, {}),
        ("cluster_counts_within_unique_sequence_bounds", invalid_cluster_bounds == 0, invalid_cluster_bounds, 0,
         {"nonmonotonic_independent_view_reactions": nonmonotonic_independent_views,
          "boundary": "Views are independently clustered and are not claimed to be nested or strictly monotonic."}),
        ("four_threshold_summaries", conn.execute("SELECT COUNT(*) FROM threshold_coverage_summary").fetchone()[0] == 4,
         conn.execute("SELECT COUNT(*) FROM threshold_coverage_summary").fetchone()[0], 4, {}),
        ("foreign_key_like_reaction_members", conn.execute("SELECT COUNT(*) FROM cluster.reaction_cluster_members m LEFT JOIN cluster.enzyme_sequence_records e USING(biopart_id) WHERE e.biopart_id IS NULL").fetchone()[0] == 0,
         conn.execute("SELECT COUNT(*) FROM cluster.reaction_cluster_members m LEFT JOIN cluster.enzyme_sequence_records e USING(biopart_id) WHERE e.biopart_id IS NULL").fetchone()[0], 0, {}),
    ]
    conn.executemany(
        "INSERT INTO qa_results VALUES (?,?,?,?,?,?)",
        [(name, int(passed), str(observed), str(expected), json.dumps(details, sort_keys=True), stamp) for name, passed, observed, expected, details in checks],
    )


def write_outputs(conn: sqlite3.Connection) -> dict[str, Any]:
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    conn.row_factory = sqlite3.Row
    reaction_fields = [row[1] for row in conn.execute("PRAGMA table_info(reaction_candidate_diversity)")]
    threshold_fields = [row[1] for row in conn.execute("PRAGMA table_info(threshold_coverage_summary)")]
    taxonomy_fields = [row[1] for row in conn.execute("PRAGMA table_info(high_evidence_taxonomy_summary)")]
    reaction_file = DOWNLOAD_DIR / "candidate_diversity_by_reaction.tsv.gz"
    threshold_file = DOWNLOAD_DIR / "candidate_diversity_threshold_summary.tsv"
    taxonomy_file = DOWNLOAD_DIR / "candidate_diversity_high_evidence_taxonomy.tsv"
    reaction_rows = write_tsv(reaction_file, conn.execute("SELECT * FROM reaction_candidate_diversity ORDER BY reaction_id"), reaction_fields, True)
    threshold_rows = write_tsv(threshold_file, conn.execute("SELECT * FROM threshold_coverage_summary ORDER BY threshold DESC"), threshold_fields)
    taxonomy_rows = write_tsv(taxonomy_file, conn.execute("SELECT * FROM high_evidence_taxonomy_summary ORDER BY enzyme_candidate_count DESC"), taxonomy_fields)

    summary = {
        "release": "ReactEnzDB candidate enzyme redundancy and diversity analysis 2026.08",
        "generated_at": now(),
        "rule_version": RULE_VERSION,
        "source_database": SOURCE_DB.name,
        "source_database_sha256": sha256_file(SOURCE_DB),
        "analysis_database": OUTPUT_DB.name,
        "definitions": {
            "reaction_supported_candidate": "Final evidence rank 1 or 2 with a catalytic assertion for the exact reaction-enzyme identity.",
            "multimodal_candidate": "A reaction-supported candidate also having PDB or AlphaFold structure coverage.",
            "distant_families": "Two or more independent NR70 or NR50 clusters for the same reaction.",
            "kinetic_snapshot": "Final standardized BRENDA, SABIO-RK, and ReactEnzDB-core evidence projection.",
        },
        "counts": {
            "reactions": conn.execute("SELECT COUNT(*) FROM reaction_candidate_diversity").fetchone()[0],
            "reactions_with_multiple_nr70_clusters": conn.execute("SELECT SUM(multiple_nr70_clusters) FROM reaction_candidate_diversity").fetchone()[0],
            "reactions_with_multiple_nr50_clusters": conn.execute("SELECT SUM(multiple_nr50_clusters) FROM reaction_candidate_diversity").fetchone()[0],
            "reactions_with_reaction_supported_candidates": conn.execute("SELECT COUNT(*) FROM reaction_candidate_diversity WHERE reaction_supported_candidate_count>0").fetchone()[0],
            "reactions_with_multimodal_candidates": conn.execute("SELECT COUNT(*) FROM reaction_candidate_diversity WHERE multimodal_candidate_count>0").fetchone()[0],
            "reactions_with_exact_substrate_product_candidates": conn.execute("SELECT value FROM final_evidence_summary WHERE metric='reactions_with_exact_substrate_product_candidates'").fetchone()[0],
        },
        "thresholds": [dict(row) for row in conn.execute("SELECT * FROM threshold_coverage_summary ORDER BY threshold DESC")],
        "distributions": {row["metric"]: dict(row) for row in conn.execute("SELECT * FROM reaction_metric_distributions")},
        "top_high_evidence_phyla": [dict(row) for row in conn.execute("SELECT * FROM high_evidence_taxonomy_summary ORDER BY enzyme_candidate_count DESC LIMIT 15")],
        "qa": [dict(row) for row in conn.execute("SELECT * FROM qa_results ORDER BY check_name")],
        "files": [],
        "interpretation_boundaries": [
            "Sequence identity clusters are candidate-compression views, not claims of identical catalytic activity or substrate specificity.",
            "NR100/90/70/50 are independent MMseqs2 views with at least 80% bidirectional coverage; they are not asserted to be nested phylogenies.",
            "AlphaFold coverage is predicted structure availability and remains separate from experimental PDB support.",
            "Reaction-specific support uses the final standardized evidence projection; EC-only and BRENDA contextual records are excluded.",
            "Taxonomic diversity reflects available annotated candidates and is not a census of natural enzyme diversity.",
        ],
    }
    for path, rows in ((reaction_file, reaction_rows), (threshold_file, threshold_rows), (taxonomy_file, taxonomy_rows), (OUTPUT_DB, None)):
        summary["files"].append({"file": str(path.relative_to(RELEASE_ROOT)).replace("\\", "/"), "rows": rows, "size": path.stat().st_size, "sha256": sha256_file(path)})
    SUMMARY_JSON.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return summary


def write_readme(summary: dict[str, Any]) -> None:
    distributions = summary["distributions"]
    thresholds = summary["thresholds"]
    lines = [
        "# ReactEnzDB candidate enzyme redundancy and diversity analysis", "",
        f"Generated: {summary['generated_at']}", "",
        "This release quantifies how sequence redundancy, remote-family diversity, taxonomy, kinetics, structures, and functional-site evidence change across NR100/90/70/50 candidate views.", "",
        "## Main results", "",
        f"- Reactions with sequence-bearing candidates: **{summary['counts']['reactions']:,}**",
        f"- Mean raw enzyme candidates per reaction: **{distributions['enzyme_candidate_count']['mean']:.2f}** (median {distributions['enzyme_candidate_count']['median']:.0f})",
        f"- Mean NR90 representatives per reaction: **{distributions['nr90_cluster_count']['mean']:.2f}** (median {distributions['nr90_cluster_count']['median']:.0f})",
        f"- Reactions with at least two NR70 families: **{summary['counts']['reactions_with_multiple_nr70_clusters']:,}**",
        f"- Reactions with at least two NR50 families: **{summary['counts']['reactions_with_multiple_nr50_clusters']:,}**",
        f"- Reactions with reaction-supported candidates: **{summary['counts']['reactions_with_reaction_supported_candidates']:,}**",
        f"- Reactions with multimodal sequence + reaction evidence + structure candidates: **{summary['counts']['reactions_with_multimodal_candidates']:,}**", "",
        "## Threshold comparison", "",
        "| View | Families | Compression vs enzyme records | Kinetic-supported families | PDB-supported families | AlphaFold-supported families | Mean families/reaction |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for row in thresholds:
        lines.append(
            f"| NR{row['threshold']} | {row['cluster_count']:,} | {row['compression_fraction_vs_enzyme_records']:.1%} | "
            f"{row['clusters_with_kinetic_support']:,} | {row['clusters_with_pdb_support']:,} | "
            f"{row['clusters_with_alphafold_support']:,} | {row['mean_clusters_per_reaction']:.2f} |"
        )
    lines += ["", "## Interpretation boundaries", ""]
    lines.extend(f"- {item}" for item in summary["interpretation_boundaries"])
    lines += ["", "## Files", "", "- `candidate_diversity_analysis.sqlite`: complete analysis and QA database", "- `candidate_diversity_analysis.summary.json`: machine-readable summary", "- `downloads/candidate_diversity_by_reaction.tsv.gz`: one row per reaction", "- `downloads/candidate_diversity_threshold_summary.tsv`: threshold comparison", "- `downloads/candidate_diversity_high_evidence_taxonomy.tsv`: reaction-supported candidate taxonomy", ""]
    README_MD.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    if not SOURCE_DB.exists():
        raise FileNotFoundError(SOURCE_DB)
    temporary = OUTPUT_DB.with_suffix(".sqlite.tmp")
    for path in (temporary, Path(str(temporary) + "-wal"), Path(str(temporary) + "-shm")):
        if path.exists():
            path.unlink()
    conn = sqlite3.connect(temporary)
    conn.row_factory = sqlite3.Row
    initialize(conn)
    metadata = {
        "release": "ReactEnzDB candidate enzyme redundancy and diversity analysis 2026.08",
        "generated_at": now(), "rule_version": RULE_VERSION,
        "source_database": SOURCE_DB.name, "source_database_sha256": sha256_file(SOURCE_DB),
        "kinetic_snapshot_status": "final_standardized_brenda_sabio_core_evidence",
    }
    conn.executemany("INSERT INTO metadata VALUES (?,?)", metadata.items())
    load_reaction_analysis(conn)
    load_final_evidence_summary(conn)
    load_threshold_summary(conn)
    load_distributions(conn)
    load_taxonomy_summary(conn)
    add_qa(conn)
    conn.commit()
    failed = conn.execute("SELECT COUNT(*) FROM qa_results WHERE passed=0").fetchone()[0]
    if failed:
        failures = [dict(row) for row in conn.execute("SELECT * FROM qa_results WHERE passed=0")]
        raise RuntimeError(f"Candidate diversity QA failed: {failures}")
    conn.execute("DETACH DATABASE cluster")
    conn.execute("PRAGMA journal_mode=DELETE")
    integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
    conn.close()
    if integrity != "ok":
        raise RuntimeError(f"Output integrity check failed: {integrity}")
    os.replace(temporary, OUTPUT_DB)
    final = sqlite3.connect(OUTPUT_DB)
    final.row_factory = sqlite3.Row
    summary = write_outputs(final)
    final.close()
    # Refresh summary after the database checksum is stable.
    summary["analysis_database_sha256"] = sha256_file(OUTPUT_DB)
    SUMMARY_JSON.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    write_readme(summary)
    print(json.dumps({"database": str(OUTPUT_DB), "counts": summary["counts"], "qa_passed": True}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
