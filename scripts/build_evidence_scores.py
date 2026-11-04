from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "web_release" / "reactenzdb_web.db"


def capped_points(count: int, cap: int, weight: int) -> int:
    return min(count, cap) * weight


def tier(score: int) -> str:
    if score >= 75:
        return "strong"
    if score >= 45:
        return "moderate"
    return "limited"


def json_pmids(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [str(item).strip() for item in parsed if str(item).strip()]


def one_to_int(rows: list[tuple[str, int]]) -> dict[str, int]:
    return {key: int(value or 0) for key, value in rows}


def one_to_set(rows: list[tuple[str, str]]) -> dict[str, set[str]]:
    result: dict[str, set[str]] = defaultdict(set)
    for key, value in rows:
        if value:
            result[key].add(str(value))
    return result


def enzyme_xref_database_counts(cur: sqlite3.Cursor) -> dict[str, int]:
    # Primary and secondary UniProt accession roles are one source, regardless
    # of alias count/capitalization. An inherited alias is not new evidence.
    return one_to_int(cur.execute(
        """SELECT entity_id, COUNT(DISTINCT CASE
             WHEN lower(trim(xref_db)) IN ('uniprot', 'uniprot_secondary') THEN 'uniprot'
             ELSE xref_db END)
           FROM web_xrefs WHERE entity_type='enzyme' GROUP BY entity_id"""
    ).fetchall())


def build_scores() -> None:
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    cur.execute("DROP TABLE IF EXISTS web_evidence_scores")
    cur.execute(
        """
        CREATE TABLE web_evidence_scores (
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          evidence_score INTEGER NOT NULL,
          evidence_tier TEXT NOT NULL,
          publication_pmids INTEGER NOT NULL DEFAULT 0,
          field_evidences INTEGER NOT NULL DEFAULT 0,
          field_pmids INTEGER NOT NULL DEFAULT 0,
          kinetic_pmids INTEGER NOT NULL DEFAULT 0,
          xref_databases INTEGER NOT NULL DEFAULT 0,
          sequence_supported INTEGER NOT NULL DEFAULT 0,
          structure_supported INTEGER NOT NULL DEFAULT 0,
          context_supported INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (entity_type, entity_id)
        )
        """
    )

    reaction_refs = one_to_int(
        cur.execute(
            """
            SELECT entity_id, COUNT(DISTINCT pmid)
            FROM web_entity_references
            WHERE entity_type = 'reaction' AND pmid IS NOT NULL AND trim(pmid) <> ''
            GROUP BY entity_id
            """
        ).fetchall()
    )
    enzyme_refs = one_to_int(
        cur.execute(
            """
            SELECT entity_id, COUNT(DISTINCT pmid)
            FROM web_entity_references
            WHERE entity_type = 'enzyme' AND pmid IS NOT NULL AND trim(pmid) <> ''
            GROUP BY entity_id
            """
        ).fetchall()
    )
    reaction_xrefs = one_to_int(
        cur.execute(
            """
            SELECT entity_id, COUNT(DISTINCT xref_db)
            FROM web_xrefs
            WHERE entity_type = 'reaction'
            GROUP BY entity_id
            """
        ).fetchall()
    )
    enzyme_xrefs = enzyme_xref_database_counts(cur)
    reaction_field_rows: dict[str, int] = defaultdict(int)
    reaction_field_pmids: dict[str, set[str]] = defaultdict(set)
    for entity_id, pmids_json in cur.execute(
        """
        SELECT entity_id, pmids_json
        FROM web_attribute_evidences
        WHERE entity_type = 'biopart_reaction'
        """
    ):
        if not entity_id or "::" not in entity_id:
            continue
        _, reaction_id = entity_id.split("::", 1)
        reaction_field_rows[reaction_id] += 1
        reaction_field_pmids[reaction_id].update(json_pmids(pmids_json))

    enzyme_field_rows = one_to_int(
        cur.execute(
            """
            SELECT entity_id, COUNT(*)
            FROM web_attribute_evidences
            WHERE entity_type = 'enzyme'
            GROUP BY entity_id
            """
        ).fetchall()
    )

    enzyme_field_pmids: dict[str, set[str]] = defaultdict(set)
    for biopart_id, pmids_json in cur.execute(
        """
        SELECT entity_id, pmids_json
        FROM web_attribute_evidences
        WHERE entity_type = 'enzyme' AND pmids_json IS NOT NULL AND trim(pmids_json) <> ''
        """
    ):
        enzyme_field_pmids[biopart_id].update(json_pmids(pmids_json))

    reaction_kinetic_pmids: dict[str, set[str]] = defaultdict(set)
    enzyme_kinetic_pmids: dict[str, set[str]] = defaultdict(set)
    for reaction_id, biopart_id, pmids_json in cur.execute(
        """
        SELECT reaction_id, biopart_id, pmids_json
        FROM web_kinetics
        WHERE pmids_json IS NOT NULL AND trim(pmids_json) <> ''
        """
    ):
        pmids = json_pmids(pmids_json)
        reaction_kinetic_pmids[reaction_id].update(pmids)
        if biopart_id:
            enzyme_kinetic_pmids[biopart_id].update(pmids)

    reaction_sequence = one_to_int(
        cur.execute(
            """
            SELECT reaction_id, COUNT(DISTINCT biopart_id)
            FROM web_reaction_enzymes
            WHERE has_sequence = 1
            GROUP BY reaction_id
            """
        ).fetchall()
    )
    reaction_chassis = one_to_int(
        cur.execute(
            """
            SELECT reaction_id, COUNT(*)
            FROM web_chassis_records
            GROUP BY reaction_id
            """
        ).fetchall()
    )
    enzyme_chassis = one_to_int(
        cur.execute(
            """
            SELECT biopart_id, COUNT(DISTINCT chassis_label)
            FROM web_chassis_records
            GROUP BY biopart_id
            """
        ).fetchall()
    )
    enzyme_structures = one_to_int(
        cur.execute(
            """
            SELECT biopart_id, COUNT(*)
            FROM (
              SELECT DISTINCT biopart_id, pdb_id AS structure_id FROM web_pdb_mappings
              UNION
              SELECT DISTINCT biopart_id, model_entity_id AS structure_id FROM web_alphafold_mappings
            )
            GROUP BY biopart_id
            """
        ).fetchall()
    )
    protein_annotations = {
        row[0]: {
            "interpro": int(row[1] or 0),
            "pfam": int(row[2] or 0),
            "sites": int(row[3] or 0) + int(row[4] or 0) + int(row[5] or 0),
        }
        for row in cur.execute(
            """
            SELECT biopart_id, interpro_count, pfam_count,
                   active_site_count, binding_site_count, conserved_site_count
            FROM web_protein_annotations
            """
        )
    }
    enzyme_mcsa = one_to_int(
        cur.execute(
            """
            SELECT biopart_id, COUNT(DISTINCT mcsa_id)
            FROM web_mcsa_enzyme_mappings
            GROUP BY biopart_id
            """
        ).fetchall()
    )
    structure_confidence = {
        row[0]: {
            "score": int(row[1] or 0),
            "high": int(row[2] or 0),
            "site_support": 0 if row[3] == "none" else 1,
        }
        for row in cur.execute(
            """
            SELECT biopart_id, structure_confidence_score, has_high_confidence_structure,
                   catalytic_site_support_level
            FROM web_structure_confidence
            """
        )
    } if cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='web_structure_confidence'").fetchone() else {}
    reaction_mcsa = one_to_int(
        cur.execute(
            """
            SELECT reaction_id, COUNT(DISTINCT mcsa_id)
            FROM web_mcsa_reaction_mappings
            GROUP BY reaction_id
            """
        ).fetchall()
    )

    score_rows: list[tuple[object, ...]] = []
    reaction_scores: dict[str, int] = {}
    for row in cur.execute(
        """
        SELECT reaction_id, all_participants_have_smiles, enzyme_count
        FROM web_reactions
        """
    ).fetchall():
        reaction_id, all_smiles, enzyme_count = row
        refs = reaction_refs.get(reaction_id, 0)
        field_rows = reaction_field_rows.get(reaction_id, 0)
        field_pmids = len(reaction_field_pmids.get(reaction_id, set()))
        kinetic_pmids = len(reaction_kinetic_pmids.get(reaction_id, set()))
        xrefs = reaction_xrefs.get(reaction_id, 0)
        sequence_supported = reaction_sequence.get(reaction_id, 0)
        context_supported = reaction_chassis.get(reaction_id, 0)
        mechanism_supported = reaction_mcsa.get(reaction_id, 0)
        score = min(
            100,
            capped_points(refs, 6, 6)
            + capped_points(field_pmids or field_rows, 8, 3)
            + capped_points(kinetic_pmids, 4, 4)
            + capped_points(xrefs, 4, 4)
            + (5 if sequence_supported else 0)
            + (6 if all_smiles else 0)
            + (3 if context_supported else 0)
            + (4 if mechanism_supported else 0),
        )
        reaction_scores[reaction_id] = score
        score_rows.append(
            (
                "reaction",
                reaction_id,
                score,
                tier(score),
                refs,
                field_rows,
                field_pmids,
                kinetic_pmids,
                xrefs,
                sequence_supported,
                int(bool(all_smiles)),
                context_supported,
            )
        )

    enzyme_scores: dict[str, int] = {}
    for row in cur.execute(
        """
        SELECT we.biopart_id, we.has_sequence, we.reaction_count
        FROM web_enzymes we
        """
    ).fetchall():
        biopart_id, has_sequence, reaction_count = row
        refs = enzyme_refs.get(biopart_id, 0)
        field_rows = enzyme_field_rows.get(biopart_id, 0)
        field_pmids = len(enzyme_field_pmids.get(biopart_id, set()))
        kinetic_pmids = len(enzyme_kinetic_pmids.get(biopart_id, set()))
        xrefs = enzyme_xrefs.get(biopart_id, 0)
        structure_supported = enzyme_structures.get(biopart_id, 0)
        # Context support is deliberately limited to an explicit expression-chassis
        # annotation. Every enzyme has a linked reaction, so reaction_count is not
        # independent host-context evidence and must not inflate this score.
        context_supported = int(bool(enzyme_chassis.get(biopart_id, 0)))
        protein_annotation = protein_annotations.get(biopart_id, {"interpro": 0, "pfam": 0, "sites": 0})
        mechanism_supported = enzyme_mcsa.get(biopart_id, 0)
        structure_profile = structure_confidence.get(biopart_id, {"score": 0, "high": 0, "site_support": 0})
        score = min(
            100,
            capped_points(refs, 6, 6)
            + capped_points(field_pmids or field_rows, 8, 3)
            + capped_points(kinetic_pmids, 4, 4)
            + capped_points(xrefs, 3, 4)
            + (5 if has_sequence else 0)
            + (7 if structure_supported else 0)
            + (4 if context_supported else 0)
            + (4 if protein_annotation["interpro"] else 0)
            + (2 if protein_annotation["pfam"] else 0)
            + (4 if protein_annotation["sites"] else 0)
            + (8 if mechanism_supported else 0)
            + (4 if structure_profile["high"] else 0)
            + (4 if structure_profile["site_support"] else 0)
            + (2 if structure_profile["score"] >= 75 else 0),
        )
        enzyme_scores[biopart_id] = score
        score_rows.append(
            (
                "enzyme",
                biopart_id,
                score,
                tier(score),
                refs,
                field_rows,
                field_pmids,
                kinetic_pmids,
                xrefs,
                int(bool(has_sequence)),
                structure_supported,
                context_supported,
            )
        )

    organism_links: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for organism, reaction_id, biopart_id in cur.execute(
        """
        SELECT organism, reaction_id, biopart_id
        FROM web_reaction_enzymes
        WHERE organism IS NOT NULL AND trim(organism) <> ''
        """
    ):
        organism_links[organism].append((reaction_id, biopart_id))

    for organism, links in organism_links.items():
        reaction_ids = {reaction_id for reaction_id, _ in links}
        enzyme_ids = {biopart_id for _, biopart_id in links}
        avg_reaction = sum(reaction_scores.get(item, 0) for item in reaction_ids) / max(1, len(reaction_ids))
        avg_enzyme = sum(enzyme_scores.get(item, 0) for item in enzyme_ids) / max(1, len(enzyme_ids))
        structure_supported = sum(1 for item in enzyme_ids if enzyme_structures.get(item, 0))
        score = min(
            100,
            round(
                avg_enzyme * 0.45
                + avg_reaction * 0.25
                + min(len(links), 200) * 0.03
                + min(len(enzyme_ids), 100) * 0.08
                + min(len(reaction_ids), 100) * 0.08
                + (6 if structure_supported else 0)
            ),
        )
        score_rows.append(
            (
                "organism",
                organism,
                score,
                tier(score),
                0,
                0,
                0,
                0,
                0,
                len(enzyme_ids),
                structure_supported,
                len(links),
            )
        )

    chassis_links: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for label, reaction_id, biopart_id in cur.execute(
        """
        SELECT chassis_label, reaction_id, biopart_id
        FROM web_chassis_records
        WHERE chassis_label IS NOT NULL AND trim(chassis_label) <> ''
        """
    ):
        chassis_links[label].append((reaction_id, biopart_id))

    for label, links in chassis_links.items():
        reaction_ids = {reaction_id for reaction_id, _ in links}
        enzyme_ids = {biopart_id for _, biopart_id in links}
        avg_reaction = sum(reaction_scores.get(item, 0) for item in reaction_ids) / max(1, len(reaction_ids))
        avg_enzyme = sum(enzyme_scores.get(item, 0) for item in enzyme_ids) / max(1, len(enzyme_ids))
        structure_supported = sum(1 for item in enzyme_ids if enzyme_structures.get(item, 0))
        score = min(
            100,
            round(
                avg_enzyme * 0.45
                + avg_reaction * 0.25
                + min(len(links), 200) * 0.03
                + min(len(enzyme_ids), 100) * 0.08
                + min(len(reaction_ids), 100) * 0.08
                + (6 if structure_supported else 0)
            ),
        )
        score_rows.append(
            (
                "chassis",
                label,
                score,
                tier(score),
                0,
                0,
                0,
                0,
                0,
                len(enzyme_ids),
                structure_supported,
                len(links),
            )
        )

    cur.executemany(
        """
        INSERT INTO web_evidence_scores VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        score_rows,
    )
    cur.execute("CREATE INDEX idx_web_evidence_scores_score ON web_evidence_scores(entity_type, evidence_score)")
    con.commit()
    counts = dict(cur.execute("SELECT entity_type, COUNT(*) FROM web_evidence_scores GROUP BY entity_type").fetchall())
    con.close()
    print(f"Built web_evidence_scores in {DB_PATH}")
    print(counts)


if __name__ == "__main__":
    build_scores()
