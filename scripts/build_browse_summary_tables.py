from __future__ import annotations

import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "web_release" / "reactenzdb_web.db"


def scalar(connection: sqlite3.Connection, sql: str) -> int:
    return int(connection.execute(sql).fetchone()[0])


def main() -> None:
    connection = sqlite3.connect(DB_PATH)
    try:
        connection.executescript(
            """
            DROP TABLE IF EXISTS web_enzyme_browse_summary;
            DROP TABLE IF EXISTS web_organism_browse_summary;

            CREATE TABLE web_enzyme_browse_summary (
              biopart_id TEXT PRIMARY KEY,
              pdb_count INTEGER NOT NULL,
              alphafold_count INTEGER NOT NULL,
              kinetic_count INTEGER NOT NULL,
              chassis_count INTEGER NOT NULL,
              browse_completeness INTEGER NOT NULL
            );

            INSERT INTO web_enzyme_browse_summary
            SELECT we.biopart_id,
                   COALESCE(pdb.pdb_count, 0),
                   COALESCE(af.alphafold_count, 0),
                   COALESCE(kin.kinetic_count, 0),
                   COALESCE(cha.chassis_count, 0),
                   (
                     CASE WHEN we.has_sequence = 1 THEN 8 ELSE 0 END +
                     CASE WHEN we.protein_sequence IS NOT NULL AND trim(we.protein_sequence) <> '' THEN 3 ELSE 0 END +
                     CASE WHEN we.protein_id IS NOT NULL AND trim(we.protein_id) <> '' THEN 2 ELSE 0 END +
                     CASE WHEN eu.uniprot_accession IS NOT NULL AND trim(eu.uniprot_accession) <> '' THEN 3 ELSE 0 END +
                     CASE WHEN we.enzyme_name IS NOT NULL AND trim(we.enzyme_name) <> '' THEN 2 ELSE 0 END +
                     CASE WHEN we.gene_name_primary IS NOT NULL AND trim(we.gene_name_primary) <> '' THEN 1 ELSE 0 END +
                     CASE WHEN we.organism IS NOT NULL AND trim(we.organism) <> '' THEN 1 ELSE 0 END +
                     CASE WHEN we.taxonomy_id IS NOT NULL AND trim(we.taxonomy_id) <> '' THEN 1 ELSE 0 END +
                     CASE WHEN we.lineage IS NOT NULL AND trim(we.lineage) <> '' THEN 1 ELSE 0 END +
                     CASE WHEN we.evidence_label IS NOT NULL AND trim(we.evidence_label) <> '' THEN 1 ELSE 0 END +
                     CASE WHEN COALESCE(pdb.pdb_count, 0) > 0 THEN 2 ELSE 0 END +
                     CASE WHEN COALESCE(af.alphafold_count, 0) > 0 THEN 2 ELSE 0 END +
                     CASE WHEN COALESCE(kin.kinetic_count, 0) > 0 THEN 2 ELSE 0 END +
                     CASE WHEN COALESCE(cha.chassis_count, 0) > 0 THEN 1 ELSE 0 END +
                     CASE WHEN COALESCE(we.reaction_count, 0) > 0 THEN 2 ELSE 0 END
                   ) AS browse_completeness
            FROM web_enzymes we
            LEFT JOIN web_enzyme_uniprot eu ON eu.biopart_id = we.biopart_id
            LEFT JOIN (
              SELECT biopart_id, COUNT(DISTINCT pdb_id) AS pdb_count
              FROM web_pdb_mappings
              GROUP BY biopart_id
            ) pdb ON pdb.biopart_id = we.biopart_id
            LEFT JOIN (
              SELECT biopart_id, COUNT(*) AS alphafold_count
              FROM web_alphafold_mappings
              GROUP BY biopart_id
            ) af ON af.biopart_id = we.biopart_id
            LEFT JOIN (
              SELECT biopart_id, COUNT(*) AS kinetic_count
              FROM web_kinetics
              GROUP BY biopart_id
            ) kin ON kin.biopart_id = we.biopart_id
            LEFT JOIN (
              SELECT biopart_id, COUNT(DISTINCT chassis_label) AS chassis_count
              FROM web_chassis_records
              GROUP BY biopart_id
            ) cha ON cha.biopart_id = we.biopart_id;

            CREATE INDEX idx_web_enzyme_browse_summary_completeness
              ON web_enzyme_browse_summary(browse_completeness DESC, biopart_id);

            CREATE TABLE web_organism_browse_summary (
              organism TEXT PRIMARY KEY,
              enzyme_count INTEGER NOT NULL,
              reaction_count INTEGER NOT NULL,
              relation_count INTEGER NOT NULL,
              chassis_count INTEGER NOT NULL,
              pdb_enzyme_count INTEGER NOT NULL,
              alphafold_enzyme_count INTEGER NOT NULL,
              structured_enzyme_count INTEGER NOT NULL,
              evidence_score INTEGER NOT NULL,
              evidence_tier TEXT,
              browse_completeness INTEGER NOT NULL
            );

            INSERT INTO web_organism_browse_summary
            SELECT re.organism,
                   COUNT(DISTINCT re.biopart_id),
                   COUNT(DISTINCT re.reaction_id),
                   COUNT(*),
                   COUNT(DISTINCT cr.chassis_label),
                   COUNT(DISTINCT pdb.biopart_id),
                   COUNT(DISTINCT af.biopart_id),
                   COUNT(DISTINCT CASE WHEN pdb.biopart_id IS NOT NULL OR af.biopart_id IS NOT NULL THEN re.biopart_id END),
                   COALESCE(MAX(es.evidence_score), 0),
                   MAX(es.evidence_tier),
                   (
                     2 + 2 + 2 + 2 +
                     CASE WHEN COUNT(DISTINCT CASE WHEN pdb.biopart_id IS NOT NULL OR af.biopart_id IS NOT NULL THEN re.biopart_id END) > 0 THEN 2 ELSE 0 END +
                     CASE WHEN COUNT(DISTINCT cr.chassis_label) > 0 THEN 1 ELSE 0 END
                   )
            FROM web_reaction_enzymes re
            LEFT JOIN web_chassis_records cr
              ON cr.reaction_id = re.reaction_id AND cr.biopart_id = re.biopart_id
            LEFT JOIN (SELECT DISTINCT biopart_id FROM web_pdb_mappings) pdb ON pdb.biopart_id = re.biopart_id
            LEFT JOIN (SELECT DISTINCT biopart_id FROM web_alphafold_mappings) af ON af.biopart_id = re.biopart_id
            LEFT JOIN web_evidence_scores es ON es.entity_type = 'organism' AND es.entity_id = re.organism
            WHERE re.organism IS NOT NULL AND trim(re.organism) <> ''
            GROUP BY re.organism;

            CREATE INDEX idx_web_organism_browse_summary_completeness
              ON web_organism_browse_summary(browse_completeness DESC, organism);
            CREATE INDEX idx_web_organism_browse_summary_evidence
              ON web_organism_browse_summary(evidence_score DESC, organism);
            """
        )
        connection.commit()
        print(f"Built web_enzyme_browse_summary: {scalar(connection, 'SELECT COUNT(*) FROM web_enzyme_browse_summary'):,}")
        print(f"Built web_organism_browse_summary: {scalar(connection, 'SELECT COUNT(*) FROM web_organism_browse_summary'):,}")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
