from __future__ import annotations

import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "web_release" / "reactenzdb_web.db"


def tier(score: int, has_structure: bool) -> str:
    if not has_structure:
        return "no_structure"
    if score >= 75:
        return "strong"
    if score >= 45:
        return "moderate"
    return "limited"


def score_row(row: sqlite3.Row) -> tuple[int, str, int, str | None, str | None]:
    best_af = row["best_alphafold_plddt"]
    best_pdb_coverage = row["best_pdb_coverage"]
    best_pdb_resolution = row["best_pdb_resolution"]
    af_count = int(row["alphafold_model_count"] or 0)
    pdb_count = int(row["pdb_structure_count"] or 0)
    has_structure = af_count > 0 or pdb_count > 0

    score = 0
    if best_af is not None:
        if best_af >= 90:
            score += 30
        elif best_af >= 70:
            score += 22
        elif best_af >= 50:
            score += 10
        else:
            score += 4

    if best_pdb_coverage is not None:
        if best_pdb_coverage >= 0.8:
            score += 26
        elif best_pdb_coverage >= 0.5:
            score += 18
        elif best_pdb_coverage > 0:
            score += 8

    if best_pdb_resolution is not None:
        if best_pdb_resolution <= 2.5:
            score += 10
        elif best_pdb_resolution <= 3.5:
            score += 6

    mcsa_in_af = int(row["mcsa_residues_in_alphafold_coverage"] or 0)
    mcsa_in_pdb = int(row["mcsa_residues_with_pdb_coordinates"] or 0)
    active_in_af = int(row["active_sites_in_alphafold_coverage"] or 0)
    binding_in_af = int(row["binding_sites_in_alphafold_coverage"] or 0)
    conserved_in_af = int(row["conserved_sites_in_alphafold_coverage"] or 0)
    mcsa_entries = int(row["mcsa_entry_count"] or 0)

    if mcsa_in_pdb:
        score += 20
    elif mcsa_in_af:
        score += 16
    elif mcsa_entries:
        score += 8

    if active_in_af:
        score += 8
    if binding_in_af:
        score += 5
    if conserved_in_af:
        score += 3

    score = min(100, score)

    high_confidence = int(
        (best_af is not None and best_af >= 70)
        or (
            best_pdb_coverage is not None
            and best_pdb_coverage >= 0.5
            and (best_pdb_resolution is None or best_pdb_resolution <= 3.5)
        )
    )

    catalytic_support = "none"
    if mcsa_in_pdb:
        catalytic_support = "pdb_catalytic_residue_coordinates"
    elif mcsa_in_af:
        catalytic_support = "alphafold_catalytic_residue_coverage"
    elif active_in_af:
        catalytic_support = "uniprot_active_site_coverage"
    elif binding_in_af:
        catalytic_support = "uniprot_binding_site_coverage"
    elif mcsa_entries:
        catalytic_support = "mcsa_context_without_structure_position"

    af_quality = best_af or 0
    pdb_quality = 0.0
    if best_pdb_coverage is not None:
        pdb_quality = best_pdb_coverage * 100
        if best_pdb_resolution is not None and best_pdb_resolution <= 2.5:
            pdb_quality += 8
        elif best_pdb_resolution is not None and best_pdb_resolution <= 3.5:
            pdb_quality += 4

    if pdb_count and (pdb_quality >= af_quality or not af_count):
        best_type = "PDB"
        best_id = row["best_pdb_id"]
    elif af_count:
        best_type = "AlphaFold"
        best_id = row["best_alphafold_model_id"] or row["uniprot_accession"]
    else:
        best_type = None
        best_id = None

    return score, tier(score, has_structure), high_confidence, catalytic_support, best_type, best_id


def main() -> None:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    cur.execute("DROP TABLE IF EXISTS web_structure_confidence")
    cur.execute(
        """
        CREATE TABLE web_structure_confidence (
          biopart_id TEXT PRIMARY KEY,
          reactenz_enzyme_id TEXT NOT NULL,
          uniprot_accession TEXT,
          best_structure_type TEXT,
          best_structure_id TEXT,
          structure_confidence_score INTEGER NOT NULL,
          structure_confidence_tier TEXT NOT NULL,
          has_high_confidence_structure INTEGER NOT NULL,
          catalytic_site_support_level TEXT NOT NULL,
          alphafold_model_count INTEGER NOT NULL DEFAULT 0,
          best_alphafold_model_id TEXT,
          best_alphafold_plddt REAL,
          high_confidence_alphafold_count INTEGER NOT NULL DEFAULT 0,
          very_high_confidence_alphafold_count INTEGER NOT NULL DEFAULT 0,
          alphafold_residue_coverage_start INTEGER,
          alphafold_residue_coverage_end INTEGER,
          pdb_structure_count INTEGER NOT NULL DEFAULT 0,
          best_pdb_id TEXT,
          best_pdb_chain TEXT,
          best_pdb_coverage REAL,
          best_pdb_resolution REAL,
          high_coverage_pdb_count INTEGER NOT NULL DEFAULT 0,
          mcsa_entry_count INTEGER NOT NULL DEFAULT 0,
          mcsa_residue_count INTEGER NOT NULL DEFAULT 0,
          mcsa_residues_with_uniprot_position INTEGER NOT NULL DEFAULT 0,
          mcsa_residues_in_alphafold_coverage INTEGER NOT NULL DEFAULT 0,
          mcsa_residues_with_pdb_coordinates INTEGER NOT NULL DEFAULT 0,
          active_site_count INTEGER NOT NULL DEFAULT 0,
          active_sites_in_alphafold_coverage INTEGER NOT NULL DEFAULT 0,
          binding_site_count INTEGER NOT NULL DEFAULT 0,
          binding_sites_in_alphafold_coverage INTEGER NOT NULL DEFAULT 0,
          conserved_site_count INTEGER NOT NULL DEFAULT 0,
          conserved_sites_in_alphafold_coverage INTEGER NOT NULL DEFAULT 0,
          feature_site_count INTEGER NOT NULL DEFAULT 0,
          feature_sites_in_alphafold_coverage INTEGER NOT NULL DEFAULT 0,
          pocket_status TEXT NOT NULL DEFAULT 'not_computed',
          proximity_status TEXT NOT NULL DEFAULT 'sequence_coverage_proxy',
          source_note TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    rows = cur.execute(
        """
        WITH af_ranked AS (
          SELECT
            biopart_id, uniprot_accession, model_entity_id, global_metric_value,
            sequence_start, sequence_end,
            ROW_NUMBER() OVER (
              PARTITION BY biopart_id
              ORDER BY global_metric_value DESC, latest_version DESC, model_entity_id
            ) AS rn
          FROM web_alphafold_mappings
        ),
        af_summary AS (
          SELECT
            biopart_id,
            COUNT(*) AS alphafold_model_count,
            SUM(CASE WHEN global_metric_value >= 70 THEN 1 ELSE 0 END) AS high_confidence_alphafold_count,
            SUM(CASE WHEN global_metric_value >= 90 THEN 1 ELSE 0 END) AS very_high_confidence_alphafold_count,
            MIN(sequence_start) AS alphafold_residue_coverage_start,
            MAX(sequence_end) AS alphafold_residue_coverage_end
          FROM web_alphafold_mappings
          GROUP BY biopart_id
        ),
        pdb_ranked AS (
          SELECT
            biopart_id, pdb_id, chain_id, coverage, resolution,
            ROW_NUMBER() OVER (
              PARTITION BY biopart_id
              ORDER BY coverage DESC, CASE WHEN resolution IS NULL THEN 999 ELSE resolution END ASC, pdb_id, chain_id
            ) AS rn
          FROM web_pdb_mappings
        ),
        pdb_summary AS (
          SELECT
            biopart_id,
            COUNT(DISTINCT pdb_id || COALESCE(':' || chain_id, '')) AS pdb_structure_count,
            SUM(CASE WHEN coverage >= 0.8 THEN 1 ELSE 0 END) AS high_coverage_pdb_count
          FROM web_pdb_mappings
          GROUP BY biopart_id
        ),
        mcsa_summary AS (
          SELECT
            m.biopart_id,
            COUNT(DISTINCT m.mcsa_id) AS mcsa_entry_count,
            COUNT(DISTINCT r.mcsa_residue_id) AS mcsa_residue_count,
            COUNT(DISTINCT CASE WHEN r.uniprot_residue_position IS NOT NULL THEN r.mcsa_residue_id END) AS mcsa_residues_with_uniprot_position,
            COUNT(DISTINCT CASE WHEN r.pdb_id IS NOT NULL AND r.pdb_residue_position IS NOT NULL THEN r.mcsa_residue_id END) AS mcsa_residues_with_pdb_coordinates,
            COUNT(DISTINCT CASE
              WHEN r.uniprot_residue_position IS NOT NULL
               AND EXISTS (
                 SELECT 1 FROM web_alphafold_mappings af
                 WHERE af.biopart_id = m.biopart_id
                   AND af.uniprot_accession = r.uniprot_id
                   AND r.uniprot_residue_position BETWEEN COALESCE(af.sequence_start, 1) AND COALESCE(af.sequence_end, 1000000)
               )
              THEN r.mcsa_residue_id END
            ) AS mcsa_residues_in_alphafold_coverage
          FROM web_mcsa_enzyme_mappings m
          LEFT JOIN web_mcsa_residues r ON r.mcsa_id = m.mcsa_id AND r.uniprot_id = m.uniprot_accession
          GROUP BY m.biopart_id
        ),
        feature_summary AS (
          SELECT
            pf.biopart_id,
            SUM(CASE WHEN pf.feature_type = 'active_site' THEN 1 ELSE 0 END) AS active_site_count,
            SUM(CASE WHEN pf.feature_type = 'binding_site' THEN 1 ELSE 0 END) AS binding_site_count,
            SUM(CASE WHEN pf.feature_type = 'conserved_site' THEN 1 ELSE 0 END) AS conserved_site_count,
            COUNT(*) AS feature_site_count,
            SUM(CASE WHEN pf.feature_type = 'active_site' AND pf.position_start IS NOT NULL
               AND EXISTS (
                 SELECT 1 FROM web_alphafold_mappings af
                 WHERE af.biopart_id = pf.biopart_id
                   AND af.uniprot_accession = pf.uniprot_accession
                   AND (pf.coordinate_status IS NULL OR pf.source_uniprot_accession = af.uniprot_accession)
                   AND COALESCE(pf.source_position_start, pf.position_start) >= COALESCE(af.sequence_start, 1)
                   AND COALESCE(pf.source_position_end, pf.position_end) <= COALESCE(af.sequence_end, 1000000)
               )
              THEN 1 ELSE 0 END) AS active_sites_in_alphafold_coverage,
            SUM(CASE WHEN pf.feature_type = 'binding_site' AND pf.position_start IS NOT NULL
               AND EXISTS (
                 SELECT 1 FROM web_alphafold_mappings af
                 WHERE af.biopart_id = pf.biopart_id
                   AND af.uniprot_accession = pf.uniprot_accession
                   AND (pf.coordinate_status IS NULL OR pf.source_uniprot_accession = af.uniprot_accession)
                   AND COALESCE(pf.source_position_start, pf.position_start) >= COALESCE(af.sequence_start, 1)
                   AND COALESCE(pf.source_position_end, pf.position_end) <= COALESCE(af.sequence_end, 1000000)
               )
              THEN 1 ELSE 0 END) AS binding_sites_in_alphafold_coverage,
            SUM(CASE WHEN pf.feature_type = 'conserved_site' AND pf.position_start IS NOT NULL
               AND EXISTS (
                 SELECT 1 FROM web_alphafold_mappings af
                 WHERE af.biopart_id = pf.biopart_id
                   AND af.uniprot_accession = pf.uniprot_accession
                   AND (pf.coordinate_status IS NULL OR pf.source_uniprot_accession = af.uniprot_accession)
                   AND COALESCE(pf.source_position_start, pf.position_start) >= COALESCE(af.sequence_start, 1)
                   AND COALESCE(pf.source_position_end, pf.position_end) <= COALESCE(af.sequence_end, 1000000)
               )
              THEN 1 ELSE 0 END) AS conserved_sites_in_alphafold_coverage,
            SUM(CASE WHEN pf.position_start IS NOT NULL
               AND EXISTS (
                 SELECT 1 FROM web_alphafold_mappings af
                 WHERE af.biopart_id = pf.biopart_id
                   AND af.uniprot_accession = pf.uniprot_accession
                   AND (pf.coordinate_status IS NULL OR pf.source_uniprot_accession = af.uniprot_accession)
                   AND COALESCE(pf.source_position_start, pf.position_start) >= COALESCE(af.sequence_start, 1)
                   AND COALESCE(pf.source_position_end, pf.position_end) <= COALESCE(af.sequence_end, 1000000)
               )
              THEN 1 ELSE 0 END) AS feature_sites_in_alphafold_coverage
          FROM web_protein_features pf
          WHERE pf.feature_type IN ('active_site', 'binding_site', 'conserved_site')
          GROUP BY pf.biopart_id
        )
        SELECT
          e.biopart_id,
          eid.reactenz_enzyme_id,
          COALESCE(eu.uniprot_accession, af_best.uniprot_accession) AS uniprot_accession,
          COALESCE(af_summary.alphafold_model_count, 0) AS alphafold_model_count,
          af_best.model_entity_id AS best_alphafold_model_id,
          af_best.global_metric_value AS best_alphafold_plddt,
          COALESCE(af_summary.high_confidence_alphafold_count, 0) AS high_confidence_alphafold_count,
          COALESCE(af_summary.very_high_confidence_alphafold_count, 0) AS very_high_confidence_alphafold_count,
          af_summary.alphafold_residue_coverage_start,
          af_summary.alphafold_residue_coverage_end,
          COALESCE(pdb_summary.pdb_structure_count, 0) AS pdb_structure_count,
          pdb_best.pdb_id AS best_pdb_id,
          pdb_best.chain_id AS best_pdb_chain,
          pdb_best.coverage AS best_pdb_coverage,
          pdb_best.resolution AS best_pdb_resolution,
          COALESCE(pdb_summary.high_coverage_pdb_count, 0) AS high_coverage_pdb_count,
          COALESCE(mcsa_summary.mcsa_entry_count, 0) AS mcsa_entry_count,
          COALESCE(mcsa_summary.mcsa_residue_count, 0) AS mcsa_residue_count,
          COALESCE(mcsa_summary.mcsa_residues_with_uniprot_position, 0) AS mcsa_residues_with_uniprot_position,
          COALESCE(mcsa_summary.mcsa_residues_in_alphafold_coverage, 0) AS mcsa_residues_in_alphafold_coverage,
          COALESCE(mcsa_summary.mcsa_residues_with_pdb_coordinates, 0) AS mcsa_residues_with_pdb_coordinates,
          COALESCE(feature_summary.active_site_count, 0) AS active_site_count,
          COALESCE(feature_summary.active_sites_in_alphafold_coverage, 0) AS active_sites_in_alphafold_coverage,
          COALESCE(feature_summary.binding_site_count, 0) AS binding_site_count,
          COALESCE(feature_summary.binding_sites_in_alphafold_coverage, 0) AS binding_sites_in_alphafold_coverage,
          COALESCE(feature_summary.conserved_site_count, 0) AS conserved_site_count,
          COALESCE(feature_summary.conserved_sites_in_alphafold_coverage, 0) AS conserved_sites_in_alphafold_coverage,
          COALESCE(feature_summary.feature_site_count, 0) AS feature_site_count,
          COALESCE(feature_summary.feature_sites_in_alphafold_coverage, 0) AS feature_sites_in_alphafold_coverage
        FROM web_enzymes e
        JOIN web_enzyme_ids eid ON eid.biopart_id = e.biopart_id
        LEFT JOIN web_enzyme_uniprot eu ON eu.biopart_id = e.biopart_id
        LEFT JOIN af_summary ON af_summary.biopart_id = e.biopart_id
        LEFT JOIN af_ranked af_best ON af_best.biopart_id = e.biopart_id AND af_best.rn = 1
        LEFT JOIN pdb_summary ON pdb_summary.biopart_id = e.biopart_id
        LEFT JOIN pdb_ranked pdb_best ON pdb_best.biopart_id = e.biopart_id AND pdb_best.rn = 1
        LEFT JOIN mcsa_summary ON mcsa_summary.biopart_id = e.biopart_id
        LEFT JOIN feature_summary ON feature_summary.biopart_id = e.biopart_id
        """
    ).fetchall()

    out_rows = []
    for row in rows:
        score, score_tier, high_confidence, catalytic_support, best_type, best_id = score_row(row)
        out_rows.append(
            (
                row["biopart_id"],
                row["reactenz_enzyme_id"],
                row["uniprot_accession"],
                best_type,
                best_id,
                score,
                score_tier,
                high_confidence,
                catalytic_support,
                row["alphafold_model_count"],
                row["best_alphafold_model_id"],
                row["best_alphafold_plddt"],
                row["high_confidence_alphafold_count"],
                row["very_high_confidence_alphafold_count"],
                row["alphafold_residue_coverage_start"],
                row["alphafold_residue_coverage_end"],
                row["pdb_structure_count"],
                row["best_pdb_id"],
                row["best_pdb_chain"],
                row["best_pdb_coverage"],
                row["best_pdb_resolution"],
                row["high_coverage_pdb_count"],
                row["mcsa_entry_count"],
                row["mcsa_residue_count"],
                row["mcsa_residues_with_uniprot_position"],
                row["mcsa_residues_in_alphafold_coverage"],
                row["mcsa_residues_with_pdb_coordinates"],
                row["active_site_count"],
                row["active_sites_in_alphafold_coverage"],
                row["binding_site_count"],
                row["binding_sites_in_alphafold_coverage"],
                row["conserved_site_count"],
                row["conserved_sites_in_alphafold_coverage"],
                row["feature_site_count"],
                row["feature_sites_in_alphafold_coverage"],
                "AlphaFold/PDB quality metrics plus sequence-position coverage of M-CSA and UniProt functional sites; no 3D pocket detection has been computed in this release.",
            )
        )

    cur.executemany(
        """
        INSERT INTO web_structure_confidence (
          biopart_id, reactenz_enzyme_id, uniprot_accession, best_structure_type, best_structure_id,
          structure_confidence_score, structure_confidence_tier, has_high_confidence_structure,
          catalytic_site_support_level, alphafold_model_count, best_alphafold_model_id,
          best_alphafold_plddt, high_confidence_alphafold_count, very_high_confidence_alphafold_count,
          alphafold_residue_coverage_start, alphafold_residue_coverage_end, pdb_structure_count,
          best_pdb_id, best_pdb_chain, best_pdb_coverage, best_pdb_resolution, high_coverage_pdb_count,
          mcsa_entry_count, mcsa_residue_count, mcsa_residues_with_uniprot_position,
          mcsa_residues_in_alphafold_coverage, mcsa_residues_with_pdb_coordinates,
          active_site_count, active_sites_in_alphafold_coverage, binding_site_count,
          binding_sites_in_alphafold_coverage, conserved_site_count, conserved_sites_in_alphafold_coverage,
          feature_site_count, feature_sites_in_alphafold_coverage, source_note
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
        """,
        out_rows,
    )
    cur.execute("CREATE INDEX idx_web_structure_confidence_score ON web_structure_confidence(structure_confidence_score DESC)")
    cur.execute("CREATE INDEX idx_web_structure_confidence_high ON web_structure_confidence(has_high_confidence_structure)")
    cur.execute("CREATE INDEX idx_web_structure_confidence_support ON web_structure_confidence(catalytic_site_support_level)")
    con.commit()

    summary = {
        "rows": cur.execute("SELECT COUNT(*) FROM web_structure_confidence").fetchone()[0],
        "with_high_confidence_structure": cur.execute(
            "SELECT COUNT(*) FROM web_structure_confidence WHERE has_high_confidence_structure = 1"
        ).fetchone()[0],
        "with_catalytic_site_support": cur.execute(
            "SELECT COUNT(*) FROM web_structure_confidence WHERE catalytic_site_support_level <> 'none'"
        ).fetchone()[0],
        "with_mcsa_residue_in_alphafold": cur.execute(
            "SELECT COUNT(*) FROM web_structure_confidence WHERE mcsa_residues_in_alphafold_coverage > 0"
        ).fetchone()[0],
        "with_mcsa_residue_in_pdb": cur.execute(
            "SELECT COUNT(*) FROM web_structure_confidence WHERE mcsa_residues_with_pdb_coordinates > 0"
        ).fetchone()[0],
    }
    print(summary)


if __name__ == "__main__":
    main()
