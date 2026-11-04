#!/usr/bin/env python3
"""Refresh sequence-family evidence without rerunning sequence clustering.

The NR100/90/70/50 memberships remain frozen. Final standardized BRENDA,
SABIO-RK, and ReactEnzDB-core assertions are projected from the evidence release
candidate onto sequence-bearing reaction-enzyme pairs. Evidence counts and
representatives are rebuilt atomically in a temporary copy of the cluster DB.
"""

from __future__ import annotations

import csv
import gzip
import hashlib
import json
import os
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RELEASE = ROOT / "web_release"
CLUSTER_DB = RELEASE / "enzyme_sequence_clusters.sqlite"
EVIDENCE_DB = ROOT / "evidence_work" / "release_candidate" / "reactenzdb_evidence_rc.sqlite"
EVIDENCE_QA = ROOT / "evidence_work" / "release_candidate" / "qa_report.json"
CORE_DB = RELEASE / "reactenzdb_web.db"
SUMMARY = RELEASE / "enzyme_sequence_clusters.summary.json"
README = RELEASE / "ENZYME_SEQUENCE_CLUSTERS.md"
DOWNLOADS = RELEASE / "downloads"
THRESHOLDS = (100, 90, 70, 50)
NOW = datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def create_overlay_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        DROP TABLE IF EXISTS final_reaction_enzyme_evidence;
        DROP TABLE IF EXISTS final_enzyme_evidence;
        DROP TABLE IF EXISTS final_sequence_cluster_evidence;
        DROP TABLE IF EXISTS final_reaction_cluster_evidence;
        DROP TABLE IF EXISTS final_evidence_qa;

        CREATE TABLE final_reaction_enzyme_evidence (
          reaction_id TEXT NOT NULL,
          reactenz_reaction_id TEXT NOT NULL,
          biopart_id TEXT NOT NULL,
          reactenz_enzyme_id TEXT NOT NULL,
          best_evidence_class TEXT NOT NULL,
          best_evidence_rank INTEGER NOT NULL,
          assertion_count INTEGER NOT NULL,
          exact_assertion_count INTEGER NOT NULL,
          catalytic_assertion_count INTEGER NOT NULL,
          non_catalytic_assertion_count INTEGER NOT NULL,
          inactive_or_negative_count INTEGER NOT NULL,
          measurement_count INTEGER NOT NULL,
          citation_count INTEGER NOT NULL,
          condition_count INTEGER NOT NULL,
          literature_verified_count INTEGER NOT NULL,
          literature_discrepancy_count INTEGER NOT NULL,
          source_count INTEGER NOT NULL,
          source_labels TEXT NOT NULL,
          PRIMARY KEY (reaction_id, biopart_id)
        );
        CREATE INDEX idx_final_pair_enzyme ON final_reaction_enzyme_evidence(biopart_id);
        CREATE INDEX idx_final_pair_rank ON final_reaction_enzyme_evidence(best_evidence_rank);

        CREATE TABLE final_enzyme_evidence (
          biopart_id TEXT PRIMARY KEY,
          reactenz_enzyme_id TEXT NOT NULL,
          assertion_count INTEGER NOT NULL,
          exact_reaction_count INTEGER NOT NULL,
          supported_reaction_count INTEGER NOT NULL,
          catalytic_assertion_count INTEGER NOT NULL,
          inactive_or_negative_count INTEGER NOT NULL,
          measurement_count INTEGER NOT NULL,
          citation_count INTEGER NOT NULL,
          condition_count INTEGER NOT NULL,
          best_evidence_rank INTEGER,
          best_evidence_class TEXT,
          source_labels TEXT
        );

        CREATE TABLE final_sequence_cluster_evidence (
          threshold INTEGER NOT NULL,
          cluster_id TEXT NOT NULL,
          final_evidence_supported_count INTEGER NOT NULL,
          exact_reaction_supported_count INTEGER NOT NULL,
          reaction_supported_count INTEGER NOT NULL,
          measurement_supported_count INTEGER NOT NULL,
          inactive_or_negative_count INTEGER NOT NULL,
          representative_biopart_id TEXT NOT NULL,
          representative_enzyme_id TEXT NOT NULL,
          representative_score REAL NOT NULL,
          representative_has_exact_evidence INTEGER NOT NULL,
          representative_has_reaction_evidence INTEGER NOT NULL,
          representative_has_measurement INTEGER NOT NULL,
          PRIMARY KEY (threshold, cluster_id)
        );

        CREATE TABLE final_reaction_cluster_evidence (
          threshold INTEGER NOT NULL,
          reaction_id TEXT NOT NULL,
          reactenz_reaction_id TEXT NOT NULL,
          cluster_id TEXT NOT NULL,
          exact_substrate_product_supported_count INTEGER NOT NULL,
          same_reaction_identifier_supported_count INTEGER NOT NULL,
          reaction_supported_count INTEGER NOT NULL,
          measurement_supported_count INTEGER NOT NULL,
          inactive_or_negative_count INTEGER NOT NULL,
          representative_biopart_id TEXT NOT NULL,
          representative_enzyme_id TEXT NOT NULL,
          representative_score REAL NOT NULL,
          representative_evidence_class TEXT,
          representative_source_labels TEXT,
          PRIMARY KEY (threshold, reaction_id, cluster_id)
        );

        CREATE TABLE final_evidence_qa (
          check_name TEXT PRIMARY KEY,
          passed INTEGER NOT NULL,
          observed_value TEXT NOT NULL,
          expected_value TEXT NOT NULL,
          checked_at TEXT NOT NULL
        );
        """
    )


def add_qa(conn: sqlite3.Connection, name: str, passed: bool, observed, expected) -> None:
    conn.execute(
        "INSERT INTO final_evidence_qa VALUES (?,?,?,?,?)",
        (name, int(passed), str(observed), str(expected), NOW),
    )


def refresh_database(temp_db: Path, source_sha: str) -> dict[str, object]:
    conn = sqlite3.connect(temp_db)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("ATTACH DATABASE ? AS evidence", (str(EVIDENCE_DB),))
    create_overlay_schema(conn)

    before_counts = {
        table: conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        for table in ("enzyme_sequence_records", "sequence_clusters", "sequence_cluster_members", "reaction_sequence_clusters", "reaction_cluster_members")
    }

    conn.execute(
        """
        INSERT INTO final_reaction_enzyme_evidence
        SELECT r.reaction_id, r.reactenz_reaction_id, r.biopart_id, r.reactenz_enzyme_id,
               r.best_evidence_class, r.best_evidence_rank, r.assertion_count,
               r.exact_assertion_count, r.catalytic_assertion_count,
               r.non_catalytic_assertion_count, r.inactive_or_negative_count,
               r.measurement_count, r.citation_count, r.condition_count,
               r.literature_verified_count, r.literature_discrepancy_count,
               r.source_count, r.source_labels
        FROM evidence.reaction_enzyme_summary r
        WHERE EXISTS (
          SELECT 1 FROM reaction_cluster_members m
          WHERE m.threshold=100 AND m.reaction_id=r.reaction_id AND m.biopart_id=r.biopart_id
        )
        """
    )

    conn.execute(
        """
        INSERT INTO final_enzyme_evidence
        WITH pair_agg AS (
          SELECT biopart_id,
                 SUM(assertion_count) AS assertion_count,
                 SUM(exact_assertion_count>0 AND catalytic_assertion_count>0) AS exact_reaction_count,
                 SUM(best_evidence_rank<=2 AND catalytic_assertion_count>0) AS supported_reaction_count,
                 SUM(catalytic_assertion_count) AS catalytic_assertion_count,
                 SUM(inactive_or_negative_count) AS inactive_or_negative_count,
                 SUM(measurement_count) AS measurement_count,
                 SUM(citation_count) AS citation_count,
                 SUM(condition_count) AS condition_count,
                 MIN(best_evidence_rank) AS best_evidence_rank,
                 GROUP_CONCAT(DISTINCT source_labels) AS source_labels
          FROM final_reaction_enzyme_evidence GROUP BY biopart_id
        )
        SELECT e.biopart_id, e.reactenz_enzyme_id,
               COALESCE(a.assertion_count,0), COALESCE(a.exact_reaction_count,0),
               COALESCE(a.supported_reaction_count,0), COALESCE(a.catalytic_assertion_count,0),
               COALESCE(a.inactive_or_negative_count,0), COALESCE(a.measurement_count,0),
               COALESCE(a.citation_count,0), COALESCE(a.condition_count,0),
               a.best_evidence_rank,
               CASE a.best_evidence_rank
                 WHEN 1 THEN 'exact_substrate_product_experimental_evidence'
                 WHEN 2 THEN 'same_reaction_identifier_evidence'
                 ELSE NULL END,
               a.source_labels
        FROM enzyme_sequence_records e LEFT JOIN pair_agg a USING(biopart_id)
        """
    )

    # Refresh legacy kinetic fields so the existing family browser and downloads
    # transparently use the final standardized evidence projection.
    conn.execute(
        """
        UPDATE enzyme_sequence_records
        SET kinetic_count=(SELECT measurement_count FROM final_enzyme_evidence f WHERE f.biopart_id=enzyme_sequence_records.biopart_id),
            kinetic_pmids=(SELECT citation_count FROM final_enzyme_evidence f WHERE f.biopart_id=enzyme_sequence_records.biopart_id),
            exact_external_kinetics=(SELECT exact_reaction_count FROM final_enzyme_evidence f WHERE f.biopart_id=enzyme_sequence_records.biopart_id),
            experimental_support=MAX(experimental_support,
              (SELECT CAST(assertion_count>0 AS INTEGER) FROM final_enzyme_evidence f WHERE f.biopart_id=enzyme_sequence_records.biopart_id))
        """
    )
    conn.execute(
        """
        UPDATE reaction_cluster_members
        SET reaction_kinetic_count=COALESCE((SELECT measurement_count FROM final_reaction_enzyme_evidence f
              WHERE f.reaction_id=reaction_cluster_members.reaction_id AND f.biopart_id=reaction_cluster_members.biopart_id),0),
            reaction_kinetic_pmid_count=COALESCE((SELECT citation_count FROM final_reaction_enzyme_evidence f
              WHERE f.reaction_id=reaction_cluster_members.reaction_id AND f.biopart_id=reaction_cluster_members.biopart_id),0),
            reaction_exact_external_count=COALESCE((SELECT exact_assertion_count FROM final_reaction_enzyme_evidence f
              WHERE f.reaction_id=reaction_cluster_members.reaction_id AND f.biopart_id=reaction_cluster_members.biopart_id),0)
        """
    )

    conn.execute(
        """
        INSERT INTO final_sequence_cluster_evidence
        WITH scored AS (
          SELECT m.threshold, m.cluster_id, m.biopart_id, m.reactenz_enzyme_id,
                 f.assertion_count, f.exact_reaction_count, f.supported_reaction_count,
                 f.inactive_or_negative_count, f.measurement_count, f.citation_count,
                 (
                   f.exact_reaction_count * 1000000000.0 +
                   f.supported_reaction_count * 10000000.0 +
                   MIN(f.measurement_count,9999) * 1000.0 +
                   MIN(f.citation_count,9999) * 100.0 +
                   e.pdb_count * 10000.0 + e.active_site_count * 1000.0 +
                   e.structure_confidence_score * 10.0 + e.evidence_score
                 ) AS score
          FROM sequence_cluster_members m
          JOIN enzyme_sequence_records e USING(biopart_id)
          JOIN final_enzyme_evidence f USING(biopart_id)
        ), ranked AS (
          SELECT *, ROW_NUMBER() OVER(
            PARTITION BY threshold,cluster_id
            ORDER BY exact_reaction_count DESC, supported_reaction_count DESC,
                     measurement_count DESC, citation_count DESC, score DESC,
                     reactenz_enzyme_id
          ) AS rn FROM scored
        ), stats AS (
          SELECT threshold,cluster_id,
                 SUM(assertion_count>0) AS evidence_count,
                 SUM(exact_reaction_count>0) AS exact_count,
                 SUM(supported_reaction_count>0) AS supported_count,
                 SUM(measurement_count>0) AS measurement_count,
                 SUM(inactive_or_negative_count>0) AS inactive_count
          FROM scored GROUP BY threshold,cluster_id
        )
        SELECT s.threshold,s.cluster_id,s.evidence_count,s.exact_count,s.supported_count,
               s.measurement_count,s.inactive_count,r.biopart_id,r.reactenz_enzyme_id,r.score,
               CAST(r.exact_reaction_count>0 AS INTEGER),
               CAST(r.supported_reaction_count>0 AS INTEGER),
               CAST(r.measurement_count>0 AS INTEGER)
        FROM stats s JOIN ranked r USING(threshold,cluster_id) WHERE r.rn=1
        """
    )

    conn.execute(
        """
        INSERT INTO final_reaction_cluster_evidence
        WITH scored AS (
          SELECT m.threshold,m.reaction_id,m.reactenz_reaction_id,m.cluster_id,
                 m.biopart_id,m.reactenz_enzyme_id,
                 COALESCE(f.best_evidence_rank,99) AS best_rank,
                 f.best_evidence_class,f.source_labels,
                 COALESCE(f.exact_assertion_count,0) AS exact_assertions,
                 COALESCE(f.catalytic_assertion_count,0) AS catalytic_assertions,
                 COALESCE(f.inactive_or_negative_count,0) AS inactive_count,
                 COALESCE(f.measurement_count,0) AS measurement_count,
                 COALESCE(f.citation_count,0) AS citation_count,
                 (
                   COALESCE(f.exact_assertion_count,0) * 1000000000.0 +
                   CAST(COALESCE(f.best_evidence_rank,99)<=2 AND COALESCE(f.catalytic_assertion_count,0)>0 AS INTEGER) * 100000000.0 +
                   COALESCE(f.catalytic_assertion_count,0) * 1000000.0 +
                   MIN(COALESCE(f.measurement_count,0),9999) * 1000.0 +
                   MIN(COALESCE(f.citation_count,0),9999) * 100.0 +
                   e.pdb_count * 10000.0 + e.active_site_count * 1000.0 +
                   e.structure_confidence_score * 10.0 + e.evidence_score
                 ) AS score
          FROM reaction_cluster_members m
          JOIN enzyme_sequence_records e USING(biopart_id)
          LEFT JOIN final_reaction_enzyme_evidence f
            ON f.reaction_id=m.reaction_id AND f.biopart_id=m.biopart_id
        ), ranked AS (
          SELECT *, ROW_NUMBER() OVER(
            PARTITION BY threshold,reaction_id,cluster_id
            ORDER BY exact_assertions DESC,
                     CAST(best_rank<=2 AND catalytic_assertions>0 AS INTEGER) DESC,
                     catalytic_assertions DESC,measurement_count DESC,citation_count DESC,
                     score DESC,reactenz_enzyme_id
          ) AS rn FROM scored
        ), stats AS (
          SELECT threshold,reaction_id,reactenz_reaction_id,cluster_id,
                 SUM(exact_assertions>0 AND catalytic_assertions>0) AS exact_count,
                 SUM(best_rank=2 AND catalytic_assertions>0) AS same_reaction_count,
                 SUM(best_rank<=2 AND catalytic_assertions>0) AS supported_count,
                 SUM(measurement_count>0) AS measurement_count,
                 SUM(inactive_count>0) AS inactive_count
          FROM scored GROUP BY threshold,reaction_id,reactenz_reaction_id,cluster_id
        )
        SELECT s.threshold,s.reaction_id,s.reactenz_reaction_id,s.cluster_id,
               s.exact_count,s.same_reaction_count,s.supported_count,s.measurement_count,s.inactive_count,
               r.biopart_id,r.reactenz_enzyme_id,r.score,r.best_evidence_class,r.source_labels
        FROM stats s JOIN ranked r USING(threshold,reaction_id,reactenz_reaction_id,cluster_id)
        WHERE r.rn=1
        """
    )

    conn.execute(
        """
        UPDATE sequence_clusters
        SET experimental_supported_count=(SELECT final_evidence_supported_count FROM final_sequence_cluster_evidence f WHERE f.threshold=sequence_clusters.threshold AND f.cluster_id=sequence_clusters.cluster_id),
            kinetic_supported_count=(SELECT measurement_supported_count FROM final_sequence_cluster_evidence f WHERE f.threshold=sequence_clusters.threshold AND f.cluster_id=sequence_clusters.cluster_id),
            global_representative_biopart_id=(SELECT representative_biopart_id FROM final_sequence_cluster_evidence f WHERE f.threshold=sequence_clusters.threshold AND f.cluster_id=sequence_clusters.cluster_id),
            global_representative_enzyme_id=(SELECT representative_enzyme_id FROM final_sequence_cluster_evidence f WHERE f.threshold=sequence_clusters.threshold AND f.cluster_id=sequence_clusters.cluster_id),
            representative_score=(SELECT representative_score FROM final_sequence_cluster_evidence f WHERE f.threshold=sequence_clusters.threshold AND f.cluster_id=sequence_clusters.cluster_id),
            underexplored=CAST(
              (SELECT reaction_supported_count FROM final_sequence_cluster_evidence f WHERE f.threshold=sequence_clusters.threshold AND f.cluster_id=sequence_clusters.cluster_id)=0
              AND pdb_supported_count=0 AND active_site_supported_count=0 AS INTEGER)
        """
    )
    conn.execute("UPDATE sequence_cluster_members SET is_global_representative=0")
    conn.execute(
        """
        UPDATE sequence_cluster_members SET is_global_representative=1
        WHERE EXISTS (SELECT 1 FROM final_sequence_cluster_evidence f
          WHERE f.threshold=sequence_cluster_members.threshold
            AND f.cluster_id=sequence_cluster_members.cluster_id
            AND f.representative_biopart_id=sequence_cluster_members.biopart_id)
        """
    )
    conn.execute(
        """
        UPDATE reaction_sequence_clusters
        SET experimental_supported_count=(SELECT reaction_supported_count FROM final_reaction_cluster_evidence f WHERE f.threshold=reaction_sequence_clusters.threshold AND f.reaction_id=reaction_sequence_clusters.reaction_id AND f.cluster_id=reaction_sequence_clusters.cluster_id),
            kinetic_supported_count=(SELECT measurement_supported_count FROM final_reaction_cluster_evidence f WHERE f.threshold=reaction_sequence_clusters.threshold AND f.reaction_id=reaction_sequence_clusters.reaction_id AND f.cluster_id=reaction_sequence_clusters.cluster_id),
            representative_biopart_id=(SELECT representative_biopart_id FROM final_reaction_cluster_evidence f WHERE f.threshold=reaction_sequence_clusters.threshold AND f.reaction_id=reaction_sequence_clusters.reaction_id AND f.cluster_id=reaction_sequence_clusters.cluster_id),
            representative_enzyme_id=(SELECT representative_enzyme_id FROM final_reaction_cluster_evidence f WHERE f.threshold=reaction_sequence_clusters.threshold AND f.reaction_id=reaction_sequence_clusters.reaction_id AND f.cluster_id=reaction_sequence_clusters.cluster_id),
            representative_score=(SELECT representative_score FROM final_reaction_cluster_evidence f WHERE f.threshold=reaction_sequence_clusters.threshold AND f.reaction_id=reaction_sequence_clusters.reaction_id AND f.cluster_id=reaction_sequence_clusters.cluster_id),
            underexplored=CAST(
              (SELECT reaction_supported_count FROM final_reaction_cluster_evidence f WHERE f.threshold=reaction_sequence_clusters.threshold AND f.reaction_id=reaction_sequence_clusters.reaction_id AND f.cluster_id=reaction_sequence_clusters.cluster_id)=0
              AND pdb_supported_count=0 AND active_site_supported_count=0 AS INTEGER)
        """
    )

    metadata = {
        "final_evidence_refresh_status": "complete_standardized_brenda_sabio_core",
        "final_evidence_refreshed_at_utc": NOW,
        "final_evidence_source": str(EVIDENCE_DB.relative_to(ROOT)).replace("\\", "/"),
        "final_evidence_source_sha256": sha256(EVIDENCE_DB),
        "pre_refresh_cluster_database_sha256": source_sha,
        "final_reaction_support_definition": "best evidence rank <=2, catalytic assertion present, and exact reaction-enzyme identity mapping",
        "final_exact_support_definition": "exact substrate/product experimental assertion with catalytic outcome",
        "final_context_boundary": "EC-only and BRENDA contextual records do not establish reaction-specific candidate support",
        "clustering_membership_refresh_policy": "NR100/90/70/50 memberships unchanged; evidence counts and representatives refreshed only",
    }
    conn.executemany("INSERT OR REPLACE INTO metadata VALUES (?,?)", metadata.items())

    after_counts = {
        table: conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        for table in before_counts
    }
    source_pairs = conn.execute(
        """
        SELECT COUNT(*) FROM evidence.reaction_enzyme_summary r WHERE EXISTS (
          SELECT 1 FROM reaction_cluster_members m
          WHERE m.threshold=100 AND m.reaction_id=r.reaction_id AND m.biopart_id=r.biopart_id)
        """
    ).fetchone()[0]
    copied_pairs = conn.execute("SELECT COUNT(*) FROM final_reaction_enzyme_evidence").fetchone()[0]
    add_qa(conn, "source_evidence_release_qa", json.loads(EVIDENCE_QA.read_text(encoding="utf-8"))["passed"], "passed", "passed")
    add_qa(conn, "cluster_table_counts_unchanged", before_counts == after_counts, after_counts, before_counts)
    add_qa(conn, "matched_evidence_pairs_complete", copied_pairs == source_pairs, copied_pairs, source_pairs)
    orphan_global_reps = conn.execute(
        """
        SELECT COUNT(*) FROM final_sequence_cluster_evidence f
        LEFT JOIN sequence_cluster_members m ON m.threshold=f.threshold AND m.cluster_id=f.cluster_id AND m.biopart_id=f.representative_biopart_id
        WHERE m.biopart_id IS NULL
        """
    ).fetchone()[0]
    add_qa(conn, "global_representatives_are_members", orphan_global_reps == 0, orphan_global_reps, 0)
    orphan_reaction_reps = conn.execute(
        """
        SELECT COUNT(*) FROM final_reaction_cluster_evidence f
        LEFT JOIN reaction_cluster_members m ON m.threshold=f.threshold AND m.reaction_id=f.reaction_id AND m.cluster_id=f.cluster_id AND m.biopart_id=f.representative_biopart_id
        WHERE m.biopart_id IS NULL
        """
    ).fetchone()[0]
    add_qa(conn, "reaction_representatives_are_members", orphan_reaction_reps == 0, orphan_reaction_reps, 0)
    four_memberships = conn.execute(
        "SELECT COUNT(*) FROM (SELECT biopart_id FROM sequence_cluster_members GROUP BY biopart_id HAVING COUNT(*)<>4)"
    ).fetchone()[0]
    add_qa(conn, "four_cluster_memberships_preserved", four_memberships == 0, four_memberships, 0)
    evidence_reactions = conn.execute(
        "SELECT COUNT(DISTINCT reaction_id) FROM final_reaction_enzyme_evidence WHERE best_evidence_rank<=2 AND catalytic_assertion_count>0"
    ).fetchone()[0]
    exact_reactions = conn.execute(
        "SELECT COUNT(DISTINCT reaction_id) FROM final_reaction_enzyme_evidence WHERE exact_assertion_count>0 AND catalytic_assertion_count>0"
    ).fetchone()[0]
    representative_changes = conn.execute(
        """
        SELECT COUNT(*) FROM final_reaction_cluster_evidence f JOIN reaction_sequence_clusters r
          ON r.threshold=f.threshold AND r.reaction_id=f.reaction_id AND r.cluster_id=f.cluster_id
        WHERE r.representative_biopart_id=f.representative_biopart_id
        """
    ).fetchone()[0]
    # After updating, this is an equality count; retained for a complete row check.
    add_qa(conn, "reaction_representative_projection_complete", representative_changes == before_counts["reaction_sequence_clusters"], representative_changes, before_counts["reaction_sequence_clusters"])

    conn.commit()
    qa = [dict(row) for row in conn.execute("SELECT * FROM final_evidence_qa ORDER BY check_name")]
    counts = {
        "matched_reaction_enzyme_pairs": copied_pairs,
        "reactions_with_reaction_supported_sequence_candidates": evidence_reactions,
        "reactions_with_exact_substrate_product_sequence_candidates": exact_reactions,
        "sequence_enzymes_with_final_evidence": conn.execute("SELECT COUNT(*) FROM final_enzyme_evidence WHERE assertion_count>0").fetchone()[0],
        "sequence_enzymes_with_measurements": conn.execute("SELECT COUNT(*) FROM final_enzyme_evidence WHERE measurement_count>0").fetchone()[0],
        "sequence_enzymes_with_exact_reaction_evidence": conn.execute("SELECT COUNT(*) FROM final_enzyme_evidence WHERE exact_reaction_count>0").fetchone()[0],
    }
    conn.execute("DETACH DATABASE evidence")
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.execute("PRAGMA journal_mode=DELETE")
    integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
    conn.close()
    if integrity != "ok":
        raise RuntimeError(f"Cluster database integrity check failed: {integrity}")
    if any(not row["passed"] for row in qa):
        raise RuntimeError(f"Final evidence refresh QA failed: {qa}")
    return {"generated_at_utc": NOW, "source_sha256": metadata["final_evidence_source_sha256"], "counts": counts, "qa": qa}


def export_table(conn: sqlite3.Connection, table: str, filename: str) -> dict[str, object]:
    path = DOWNLOADS / filename
    cursor = conn.execute(f"SELECT * FROM {table}")
    columns = [item[0] for item in cursor.description]
    rows = 0
    with gzip.open(path, "wt", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(columns)
        for row in cursor:
            writer.writerow(row)
            rows += 1
    return {"file": f"downloads/{filename}", "table": table, "rows": rows, "columns": len(columns), "size": path.stat().st_size, "sha256": sha256(path)}


def export_representatives(conn: sqlite3.Connection, threshold: int) -> dict[str, object]:
    filename = f"enzyme_representatives_nr{threshold}.fasta.gz"
    path = DOWNLOADS / filename
    rows = conn.execute(
        """
        SELECT c.cluster_id,c.global_representative_enzyme_id,c.global_representative_biopart_id,
               e.protein_sequence,c.enzyme_record_count,c.species_count,c.experimental_supported_count
        FROM sequence_clusters c JOIN core.web_enzymes e ON e.biopart_id=c.global_representative_biopart_id
        WHERE c.threshold=? ORDER BY c.cluster_id
        """,
        (threshold,),
    )
    count = 0
    with gzip.open(path, "wt", encoding="utf-8", newline="\n") as handle:
        for cluster_id, enzyme_id, biopart_id, sequence, members, species, experimental in rows:
            if not sequence:
                continue
            handle.write(f">{enzyme_id} cluster={cluster_id} biopart={biopart_id} members={members} species={species} experimental={experimental}\n")
            sequence = str(sequence).strip().upper()
            handle.write("\n".join(sequence[index:index + 80] for index in range(0, len(sequence), 80)) + "\n")
            count += 1
    return {"file": f"downloads/{filename}", "format": "FASTA.GZ", "rows": count, "size": path.stat().st_size, "sha256": sha256(path)}


def refresh_exports_and_docs(refresh: dict[str, object]) -> None:
    conn = sqlite3.connect(CLUSTER_DB)
    conn.execute("ATTACH DATABASE ? AS core", (str(CORE_DB),))
    files = [
        export_table(conn, "sequence_clusters", "enzyme_sequence_clusters.tsv.gz"),
        export_table(conn, "sequence_cluster_members", "enzyme_cluster_members.tsv.gz"),
        export_table(conn, "reaction_sequence_clusters", "reaction_enzyme_clusters.tsv.gz"),
        export_table(conn, "reaction_cluster_members", "reaction_cluster_members.tsv.gz"),
        export_table(conn, "enzyme_sequence_records", "enzyme_cluster_taxonomy.tsv.gz"),
    ]
    files.extend(export_representatives(conn, threshold) for threshold in THRESHOLDS)
    conn.close()
    summary = json.loads(SUMMARY.read_text(encoding="utf-8"))
    summary["generated_at_utc"] = NOW
    summary["files"] = files
    summary["final_evidence_refresh"] = refresh
    notes = [note for note in summary.get("notes", []) if "Strict reaction-cluster" not in note]
    notes.extend([
        "Final standardized BRENDA, SABIO-RK, and ReactEnzDB-core evidence was projected onto frozen sequence memberships without rerunning MMseqs2.",
        "Reaction-supported candidates require best evidence rank <=2 plus a catalytic assertion; EC-only and contextual BRENDA records are excluded from this claim.",
        "Exact substrate/product support remains separate from same-reaction-identifier support.",
    ])
    summary["notes"] = list(dict.fromkeys(notes))
    SUMMARY.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    README.write_text(
        f"""# ReactEnzDB enzyme sequence clusters

Release: 2026.08  
Evidence refreshed: {NOW}

This derived layer provides frozen NR100 exact-identity and independent MMseqs2
NR90, NR70, and NR50 sequence-family views. The sequence memberships were not
recomputed during the final evidence refresh.

## Final evidence projection

Final standardized BRENDA, SABIO-RK, and ReactEnzDB-core assertions are projected
only when both the reaction and the specific sequence-bearing enzyme identity match.
Reaction-supported candidates require evidence rank 1 or 2 and a catalytic assertion.
Exact substrate/product evidence (rank 1) remains separate from same-reaction-identifier
evidence (rank 2). EC-only and BRENDA contextual records do not establish candidate support.

- Sequence-bearing supported reaction-enzyme pairs: {refresh['counts']['matched_reaction_enzyme_pairs']:,}
- Reactions with supported sequence candidates: {refresh['counts']['reactions_with_reaction_supported_sequence_candidates']:,}
- Reactions with exact substrate/product sequence candidates: {refresh['counts']['reactions_with_exact_substrate_product_sequence_candidates']:,}

## Representative policy

Representatives are reselected within each unchanged cluster. Exact reaction evidence,
reaction-specific catalytic support, quantitative measurements, citations, experimental
PDB/functional-site coverage, and annotation richness are prioritized in that order.

## Boundaries

Sequence similarity does not prove identical substrate specificity or catalytic activity.
AlphaFold coverage indicates predicted structure availability, not experimental structure.
See `enzyme_sequence_clusters.summary.json` for source checksums, QA, and export checksums.
""",
        encoding="utf-8",
    )


def main() -> None:
    if not CLUSTER_DB.exists() or not EVIDENCE_DB.exists() or not EVIDENCE_QA.exists():
        raise FileNotFoundError("Required cluster or final evidence release file is missing")
    evidence_qa = json.loads(EVIDENCE_QA.read_text(encoding="utf-8"))
    if not evidence_qa.get("passed"):
        raise RuntimeError("Final evidence release QA is not passing")
    source_sha = sha256(CLUSTER_DB)
    temp_db = CLUSTER_DB.with_suffix(".evidence-refresh.tmp.sqlite")
    if temp_db.exists():
        temp_db.unlink()
    try:
        shutil.copy2(CLUSTER_DB, temp_db)
        refresh = refresh_database(temp_db, source_sha)
        try:
            os.replace(temp_db, CLUSTER_DB)
        except PermissionError:
            # Windows may deny atomic replacement while the Next.js process has
            # a read handle open. SQLite's online backup API safely replaces the
            # database contents while coordinating with concurrent readers.
            source = sqlite3.connect(temp_db)
            target = sqlite3.connect(CLUSTER_DB)
            try:
                source.backup(target, pages=4096, sleep=0.05)
                target.commit()
            finally:
                target.close()
                source.close()
        refresh_exports_and_docs(refresh)
        print(json.dumps(refresh, indent=2, ensure_ascii=False))
    finally:
        if temp_db.exists():
            temp_db.unlink()


if __name__ == "__main__":
    main()
