#!/usr/bin/env python3
"""Build the reaction-specific advanced enzyme candidate-selection layer.

This derived release combines three immutable inputs:
  * the ReactEnzDB web release (sequences and enzyme metadata),
  * the NR100/90/70/50 sequence-family release, and
  * the reaction-specific evidence release.

"Known active" is deliberately strict: the enzyme must have catalytic evidence
for the same normalized reaction at evidence rank 1 or 2.  Sequence distance is
computed with a Smith-Waterman local protein alignment (BLOSUM62, gap open 10,
gap extension 1).  Similarity helps rank candidates; it is not activity proof.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "external" / "python_packages"))

import parasail  # type: ignore  # locally frozen binary dependency


CORE_DB = ROOT / "web_release" / "reactenzdb_web.db"
CLUSTER_DB = ROOT / "web_release" / "enzyme_sequence_clusters.sqlite"
EVIDENCE_DB = ROOT / "evidence_work" / "release_candidate" / "reactenzdb_evidence_rc.sqlite"
OUTPUT_DB = ROOT / "web_release" / "advanced_candidate_selection.sqlite"
SUMMARY_JSON = ROOT / "web_release" / "advanced_candidate_selection.summary.json"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def qmark(count: int) -> str:
    return ",".join("?" for _ in range(count))


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=NORMAL;
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE reaction_candidate_selection (
          reaction_id TEXT NOT NULL,
          reactenz_reaction_id TEXT NOT NULL,
          biopart_id TEXT NOT NULL,
          reactenz_enzyme_id TEXT NOT NULL,
          enzyme_name TEXT,
          organism TEXT,
          taxonomy_id TEXT,
          protein_id TEXT,
          sequence_length INTEGER NOT NULL,
          nr100_cluster_id TEXT NOT NULL,
          nr90_cluster_id TEXT NOT NULL,
          nr70_cluster_id TEXT NOT NULL,
          nr50_cluster_id TEXT NOT NULL,
          is_known_active INTEGER NOT NULL,
          best_evidence_class TEXT,
          best_evidence_rank INTEGER,
          catalytic_assertion_count INTEGER NOT NULL,
          citation_count INTEGER NOT NULL,
          reaction_kinetic_count INTEGER NOT NULL,
          reaction_exact_external_count INTEGER NOT NULL,
          pdb_count INTEGER NOT NULL,
          alphafold_count INTEGER NOT NULL,
          active_site_count INTEGER NOT NULL,
          mcsa_count INTEGER NOT NULL,
          species TEXT,
          genus TEXT,
          phylum TEXT,
          nearest_active_biopart_id TEXT,
          nearest_active_enzyme_id TEXT,
          nearest_active_identity REAL,
          nearest_active_query_coverage REAL,
          nearest_active_target_coverage REAL,
          nearest_active_alignment_score INTEGER,
          nearest_active_evidence_class TEXT,
          nearest_active_evidence_rank INTEGER,
          nearest_active_shared_level INTEGER,
          novelty_class TEXT NOT NULL,
          novelty_label TEXT NOT NULL,
          PRIMARY KEY (reaction_id, biopart_id)
        );
        CREATE INDEX idx_candidate_reaction_public ON reaction_candidate_selection(reactenz_reaction_id);
        CREATE INDEX idx_candidate_reaction_internal ON reaction_candidate_selection(reaction_id);
        CREATE INDEX idx_candidate_modes ON reaction_candidate_selection(reaction_id, novelty_class, nr90_cluster_id, nr50_cluster_id);
        CREATE INDEX idx_candidate_enzyme ON reaction_candidate_selection(reactenz_enzyme_id);
        CREATE TABLE reaction_candidate_summary (
          reaction_id TEXT PRIMARY KEY,
          reactenz_reaction_id TEXT NOT NULL,
          candidate_count INTEGER NOT NULL,
          known_active_count INTEGER NOT NULL,
          nr90_family_count INTEGER NOT NULL,
          nr50_family_count INTEGER NOT NULL,
          structured_candidate_count INTEGER NOT NULL,
          outside_supported_nr50_count INTEGER NOT NULL,
          no_supported_neighbour_count INTEGER NOT NULL
        );
        """
    )


def aligned_metrics(query: str, target: str) -> tuple[float, float, float, int]:
    result = parasail.sw_trace_striped_16(query, target, 10, 1, parasail.blosum62)
    query_aligned = result.traceback.query
    target_aligned = result.traceback.ref
    columns = max(len(query_aligned), 1)
    matches = sum(
        left == right
        for left, right in zip(query_aligned, target_aligned)
        if left != "-" and right != "-"
    )
    query_residues = sum(char != "-" for char in query_aligned)
    target_residues = sum(char != "-" for char in target_aligned)
    return (
        round(100.0 * matches / columns, 3),
        round(100.0 * query_residues / max(len(query), 1), 3),
        round(100.0 * target_residues / max(len(target), 1), 3),
        int(result.score),
    )


def shared_level(candidate: dict, active: dict) -> int | None:
    for threshold in (100, 90, 70, 50):
        if candidate[f"nr{threshold}"] == active[f"nr{threshold}"]:
            return threshold
    return None


def novelty(candidate: dict, active_rows: list[dict]) -> tuple[str, str]:
    if not active_rows:
        return "no_supported_neighbour", "No experimentally supported neighbour"
    if any(candidate["nr90"] == active["nr90"] for active in active_rows):
        return "within_supported_cluster", "Within an experimentally supported NR90 cluster"
    if any(candidate["nr50"] == active["nr50"] for active in active_rows):
        return "same_supported_nr50_family", "Same NR50 family as a supported enzyme"
    return "outside_supported_nr50_families", "Outside all experimentally supported NR50 families"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit-reactions", type=int, default=0, help="QA-only partial build")
    args = parser.parse_args()

    source = sqlite3.connect(CLUSTER_DB)
    source.row_factory = sqlite3.Row
    source.execute("ATTACH DATABASE ? AS core", (str(CORE_DB),))
    source.execute("ATTACH DATABASE ? AS evidence", (str(EVIDENCE_DB),))

    rows = source.execute(
        """
        SELECT m.reaction_id, m.reactenz_reaction_id, m.biopart_id, m.reactenz_enzyme_id,
               core.web_enzymes.enzyme_name, core.web_enzymes.organism,
               core.web_enzymes.taxonomy_id, core.web_enzymes.protein_id,
               core.web_enzymes.protein_sequence, e.sequence_length,
               e.pdb_count, e.alphafold_count, e.active_site_count, e.mcsa_count,
               e.species, e.genus, e.phylum,
               m.reaction_kinetic_count, m.reaction_exact_external_count,
               ev.best_evidence_class, ev.best_evidence_rank,
               COALESCE(ev.catalytic_assertion_count, 0) AS catalytic_assertion_count,
               COALESCE(ev.citation_count, 0) AS citation_count
        FROM reaction_cluster_members m
        JOIN enzyme_sequence_records e ON e.biopart_id=m.biopart_id
        JOIN core.web_enzymes ON core.web_enzymes.biopart_id=m.biopart_id
        LEFT JOIN evidence.reaction_enzyme_summary ev
          ON ev.reaction_id=m.reaction_id AND ev.biopart_id=m.biopart_id
        WHERE m.threshold=90 AND core.web_enzymes.protein_sequence IS NOT NULL
        ORDER BY m.reaction_id, m.biopart_id
        """
    ).fetchall()

    memberships: dict[str, dict[int, str]] = defaultdict(dict)
    for row in source.execute("SELECT threshold, biopart_id, cluster_id FROM sequence_cluster_members"):
        memberships[str(row["biopart_id"])][int(row["threshold"])] = str(row["cluster_id"])

    grouped: dict[str, list[dict]] = defaultdict(list)
    public_ids: dict[str, str] = {}
    for row in rows:
        member = memberships[str(row["biopart_id"])]
        item = dict(row)
        item.update({f"nr{threshold}": member[threshold] for threshold in (100, 90, 70, 50)})
        item["is_known_active"] = int(
            row["best_evidence_rank"] is not None
            and int(row["best_evidence_rank"]) <= 2
            and int(row["catalytic_assertion_count"]) > 0
        )
        grouped[str(row["reaction_id"])].append(item)
        public_ids[str(row["reaction_id"])] = str(row["reactenz_reaction_id"])

    reaction_ids = sorted(grouped)
    if args.limit_reactions > 0:
        reaction_ids = reaction_ids[: args.limit_reactions]

    if OUTPUT_DB.exists():
        OUTPUT_DB.unlink()
    output = sqlite3.connect(OUTPUT_DB)
    create_schema(output)
    generated = utc_now()
    output.executemany(
        "INSERT INTO metadata VALUES (?,?)",
        [
            ("release", "ReactEnzDB advanced reaction candidate selection 2026.08"),
            ("generated_at_utc", generated),
            ("known_active_definition", "Same normalized reaction; evidence rank 1 or 2; catalytic assertion count > 0."),
            ("alignment_method", "Parasail Smith-Waterman local alignment; BLOSUM62; gap open 10; gap extension 1."),
            ("novelty_boundary", "Novelty is relative to experimentally supported enzymes for the same normalized reaction, not global biochemical novelty."),
            ("functional_boundary", "Sequence similarity and family membership prioritize candidates but do not establish catalytic activity or substrate specificity."),
        ],
    )

    insert_sql = f"INSERT INTO reaction_candidate_selection VALUES ({qmark(38)})"
    summary_rows: list[tuple] = []
    total_alignments = 0
    for index, reaction_id in enumerate(reaction_ids, start=1):
        candidates = grouped[reaction_id]
        active_rows = [row for row in candidates if row["is_known_active"]]
        active_nr90 = {row["nr90"] for row in active_rows}
        active_nr50 = {row["nr50"] for row in active_rows}
        output_rows = []
        for candidate in candidates:
            nearest = None
            identity = query_coverage = target_coverage = None
            alignment_score = None
            if active_rows:
                if candidate["is_known_active"]:
                    nearest = candidate
                    identity = query_coverage = target_coverage = 100.0
                    alignment_score = int(len(candidate["protein_sequence"]))
                else:
                    best_score = -1
                    for active in active_rows:
                        result = parasail.sw_stats_striped_16(
                            candidate["protein_sequence"], active["protein_sequence"],
                            10, 1, parasail.blosum62,
                        )
                        total_alignments += 1
                        if int(result.score) > best_score:
                            best_score = int(result.score)
                            nearest = active
                    if nearest is not None:
                        identity, query_coverage, target_coverage, alignment_score = aligned_metrics(
                            candidate["protein_sequence"], nearest["protein_sequence"]
                        )
            novelty_class, novelty_label = novelty(candidate, active_rows)
            nearest_level = shared_level(candidate, nearest) if nearest is not None else None
            output_rows.append((
                candidate["reaction_id"], candidate["reactenz_reaction_id"],
                candidate["biopart_id"], candidate["reactenz_enzyme_id"],
                candidate["enzyme_name"], candidate["organism"], candidate["taxonomy_id"],
                candidate["protein_id"], candidate["sequence_length"],
                candidate["nr100"], candidate["nr90"], candidate["nr70"], candidate["nr50"],
                candidate["is_known_active"], candidate["best_evidence_class"], candidate["best_evidence_rank"],
                candidate["catalytic_assertion_count"], candidate["citation_count"],
                candidate["reaction_kinetic_count"], candidate["reaction_exact_external_count"],
                candidate["pdb_count"], candidate["alphafold_count"], candidate["active_site_count"], candidate["mcsa_count"],
                candidate["species"], candidate["genus"], candidate["phylum"],
                nearest["biopart_id"] if nearest else None,
                nearest["reactenz_enzyme_id"] if nearest else None,
                identity, query_coverage, target_coverage, alignment_score,
                nearest["best_evidence_class"] if nearest else None,
                nearest["best_evidence_rank"] if nearest else None,
                nearest_level, novelty_class, novelty_label,
            ))
        output.executemany(insert_sql, output_rows)
        summary_rows.append((
            reaction_id, public_ids[reaction_id], len(candidates), len(active_rows),
            len({row["nr90"] for row in candidates}), len({row["nr50"] for row in candidates}),
            sum(int(row["pdb_count"] > 0 or row["active_site_count"] > 0 or row["mcsa_count"] > 0) for row in candidates),
            sum(int(row["nr50"] not in active_nr50) for row in candidates) if active_rows else 0,
            len(candidates) if not active_rows else 0,
        ))
        if index % 250 == 0:
            output.commit()
            print(f"[{index:,}/{len(reaction_ids):,}] reactions; {total_alignments:,} pairwise screens", flush=True)

    output.executemany("INSERT INTO reaction_candidate_summary VALUES (?,?,?,?,?,?,?,?,?)", summary_rows)
    output.commit()
    stats = {
        "release": "ReactEnzDB advanced reaction candidate selection 2026.08",
        "generated_at_utc": generated,
        "reaction_count": len(reaction_ids),
        "candidate_rows": output.execute("SELECT COUNT(*) FROM reaction_candidate_selection").fetchone()[0],
        "reactions_with_known_active": output.execute("SELECT COUNT(*) FROM reaction_candidate_summary WHERE known_active_count>0").fetchone()[0],
        "known_active_rows": output.execute("SELECT COUNT(*) FROM reaction_candidate_selection WHERE is_known_active=1").fetchone()[0],
        "pairwise_alignment_screens": total_alignments,
        "novelty_counts": dict(output.execute("SELECT novelty_class,COUNT(*) FROM reaction_candidate_selection GROUP BY novelty_class").fetchall()),
    }
    SUMMARY_JSON.write_text(json.dumps(stats, indent=2, ensure_ascii=False), encoding="utf-8")
    output.close()
    source.close()
    print(json.dumps(stats, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
