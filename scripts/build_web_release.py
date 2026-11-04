from __future__ import annotations
import os

import argparse
import json
import re
import sqlite3
import time
from pathlib import Path

from reo_ids import assign_reo_ids, seed_registry_from_release
from data_semantics import repair_kinetic_references, normalize_kinetic_sources, install_kinetic_reference_guards


ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = Path(os.environ.get("REACTENZDB_INPUT_ROOT", ROOT / "inputs"))
DEFAULT_SOURCE_DB = DATA_ROOT / "rdbsb_v2" / "rdbsb_biosyn_v2.db"
DEFAULT_OUTPUT_DB = ROOT / "web_release" / "reactenzdb_web.db"
DEFAULT_MANIFEST = ROOT / "web_release" / "manifest.json"
DEFAULT_REO_REGISTRY = ROOT / "web_release" / "reo_id_registry.sqlite"


def connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA temp_store = MEMORY")
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn


def run(conn: sqlite3.Connection, label: str, sql: str) -> None:
    start = time.time()
    print(f"[build] {label} ...", flush=True)
    conn.executescript(sql)
    conn.commit()
    print(f"[build] {label} done in {time.time() - start:.1f}s", flush=True)


def scalar(conn: sqlite3.Connection, sql: str) -> int:
    return int(conn.execute(sql).fetchone()[0])


def source_structure_value(field: str, fallback: str) -> str:
    """Keep verified source-specific chemistry separate from legacy compound rows."""
    return (
        "CASE WHEN rc.verified_structure_payload IS NOT NULL THEN "
        f"json_extract(rc.verified_structure_payload, '$.{field}') ELSE {fallback} END"
    )


CHASSIS_SPLITTER = re.compile(r"\s*,\s*")
CHASSIS_PLACEHOLDERS = {"-", "NA", "N/A", "none", "None", "null", "Null"}


def chassis_labels_from_json(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        data = json.loads(value)
    except Exception:
        return []
    labels: list[str] = []
    items = data if isinstance(data, list) else [data]
    for item in items:
        if isinstance(item, dict):
            text = (item.get("value_text") or item.get("display_text") or "").strip()
        else:
            text = str(item).strip()
        text = text.replace(" evidence", "").strip()
        for part in CHASSIS_SPLITTER.split(text):
            label = part.strip().strip(";")
            if label and label not in CHASSIS_PLACEHOLDERS:
                labels.append(label)
    return labels


def populate_chassis_tables(conn: sqlite3.Connection) -> None:
    start = time.time()
    print("[build] chassis relationships ...", flush=True)
    conn.executescript(
        """
        DROP TABLE IF EXISTS web_chassis_records;
        CREATE TABLE web_chassis_records (
            chassis_label TEXT NOT NULL,
            reaction_id TEXT NOT NULL,
            biopart_id TEXT NOT NULL,
            enzyme_name TEXT,
            gene_name_primary TEXT,
            organism TEXT,
            protein_id TEXT,
            has_sequence INTEGER,
            sequence_length INTEGER,
            PRIMARY KEY (chassis_label, reaction_id, biopart_id)
        );
        """
    )
    release = {row["reaction_id"] for row in conn.execute("SELECT reaction_id FROM web_set_reactions")}
    meta = {
        (row["reaction_id"], row["biopart_id"]): row
        for row in conn.execute(
            """
            SELECT reaction_id, biopart_id, enzyme_name, gene_name_primary,
                   organism, protein_id, has_sequence, sequence_length
            FROM web_reaction_enzymes
            """
        )
    }
    rows: list[tuple[str, str, str, str | None, str | None, str | None, str | None, int | None, int | None]] = []
    for row in conn.execute(
        """
        SELECT reaction_id, biopart_id, chassis_json
        FROM src.biopart_reactions
        WHERE chassis_json IS NOT NULL AND trim(chassis_json) <> ''
        """
    ):
        reaction_id = row["reaction_id"]
        if reaction_id not in release:
            continue
        biopart_id = row["biopart_id"]
        relation = meta.get((reaction_id, biopart_id))
        if not relation:
            continue
        seen: set[str] = set()
        for label in chassis_labels_from_json(row["chassis_json"]):
            if label in seen:
                continue
            seen.add(label)
            rows.append(
                (
                    label,
                    reaction_id,
                    biopart_id,
                    relation["enzyme_name"],
                    relation["gene_name_primary"],
                    relation["organism"],
                    relation["protein_id"],
                    relation["has_sequence"],
                    relation["sequence_length"],
                )
            )

    conn.executemany(
        """
        INSERT OR IGNORE INTO web_chassis_records(
            chassis_label, reaction_id, biopart_id, enzyme_name, gene_name_primary,
            organism, protein_id, has_sequence, sequence_length
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    conn.executescript(
        """
        DROP TABLE IF EXISTS web_chassis_labels;
        CREATE TABLE web_chassis_labels AS
        SELECT
            chassis_label AS label,
            COUNT(*) AS record_count,
            COUNT(DISTINCT reaction_id) AS reaction_count,
            COUNT(DISTINCT biopart_id) AS enzyme_count,
            COUNT(DISTINCT organism) AS organism_count
        FROM web_chassis_records
        GROUP BY chassis_label;

        CREATE UNIQUE INDEX idx_web_chassis_labels_label ON web_chassis_labels(label);
        CREATE INDEX idx_web_chassis_labels_count ON web_chassis_labels(record_count DESC);
        CREATE INDEX idx_web_chassis_records_label ON web_chassis_records(chassis_label);
        CREATE INDEX idx_web_chassis_records_reaction ON web_chassis_records(reaction_id);
        CREATE INDEX idx_web_chassis_records_biopart ON web_chassis_records(biopart_id);
        CREATE INDEX idx_web_chassis_records_organism ON web_chassis_records(organism);
        """
    )
    conn.commit()
    print(f"[build] chassis relationships done in {time.time() - start:.1f}s", flush=True)


def populate_accession_tables(conn: sqlite3.Connection) -> None:
    run(
        conn,
        "ReactEnzDB accession IDs",
        """
        DROP TABLE IF EXISTS web_reaction_ids;
        CREATE TABLE web_reaction_ids AS
        SELECT reaction_id, printf('R%05d', ROW_NUMBER() OVER (ORDER BY reaction_id)) AS reactenz_reaction_id
        FROM web_reactions;
        CREATE UNIQUE INDEX idx_web_reaction_ids_external ON web_reaction_ids(reaction_id);
        CREATE UNIQUE INDEX idx_web_reaction_ids_local ON web_reaction_ids(reactenz_reaction_id);

        DROP TABLE IF EXISTS web_enzyme_ids;
        CREATE TABLE web_enzyme_ids AS
        SELECT biopart_id, printf('E%06d', ROW_NUMBER() OVER (ORDER BY biopart_id)) AS reactenz_enzyme_id
        FROM web_enzymes;
        CREATE UNIQUE INDEX idx_web_enzyme_ids_external ON web_enzyme_ids(biopart_id);
        CREATE UNIQUE INDEX idx_web_enzyme_ids_local ON web_enzyme_ids(reactenz_enzyme_id);

        DROP TABLE IF EXISTS web_organism_ids;
        CREATE TABLE web_organism_ids AS
        SELECT organism, printf('O%04d', ROW_NUMBER() OVER (ORDER BY organism)) AS reactenz_organism_id
        FROM (
            SELECT DISTINCT organism
            FROM web_reaction_enzymes
            WHERE organism IS NOT NULL AND trim(organism) <> ''
        );
        CREATE UNIQUE INDEX idx_web_organism_ids_name ON web_organism_ids(organism);
        CREATE UNIQUE INDEX idx_web_organism_ids_local ON web_organism_ids(reactenz_organism_id);

        DROP TABLE IF EXISTS web_chassis_ids;
        CREATE TABLE web_chassis_ids AS
        SELECT label, printf('C%04d', ROW_NUMBER() OVER (ORDER BY label)) AS reactenz_chassis_id
        FROM web_chassis_labels;
        CREATE UNIQUE INDEX idx_web_chassis_ids_label ON web_chassis_ids(label);
        CREATE UNIQUE INDEX idx_web_chassis_ids_local ON web_chassis_ids(reactenz_chassis_id);
        """,
    )
    # Imported accessions are permanent: sorting newly added source IDs must
    # never renumber an existing release or reuse an explicitly retired ID.
    has_registry = conn.execute(
        "SELECT 1 FROM src.sqlite_master WHERE name='local_public_id_registry'"
    ).fetchone()
    if has_registry:
        for table, key, column, kind, prefix, width in [
            ("web_reaction_ids", "reaction_id", "reactenz_reaction_id", "reaction", "R", 5),
            ("web_enzyme_ids", "biopart_id", "reactenz_enzyme_id", "enzyme", "E", 6),
            ("web_organism_ids", "organism", "reactenz_organism_id", "organism", "O", 4),
        ]:
            registry = dict(conn.execute(
                "SELECT internal_id, public_id FROM src.local_public_id_registry WHERE kind=?", (kind,)
            ))
            identities = [row[0] for row in conn.execute(f"SELECT {key} FROM {table} ORDER BY {key}")]
            maximum = max((int(value[1:]) for value in registry.values()), default=0)
            assigned = []
            for identity in identities:
                public_id = registry.get(identity)
                if public_id is None:
                    maximum += 1
                    public_id = f"{prefix}{maximum:0{width}d}"
                    conn.execute(
                        "INSERT INTO src.local_public_id_registry(kind,internal_id,public_id) VALUES (?,?,?)",
                        (kind, identity, public_id),
                    )
                assigned.append((public_id, identity))
            conn.execute(f"UPDATE {table} SET {column}='__pending__' || {key}")
            conn.executemany(f"UPDATE {table} SET {column}=? WHERE {key}=?", assigned)
        conn.commit()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-db", type=Path, default=DEFAULT_SOURCE_DB)
    parser.add_argument("--output-db", type=Path, default=DEFAULT_OUTPUT_DB)
    parser.add_argument(
        "--membership-db",
        type=Path,
        help="Optional prior release whose reaction IDs/levels define the frozen public set",
    )
    parser.add_argument("--reo-id-registry", type=Path, default=DEFAULT_REO_REGISTRY)
    parser.add_argument("--release-version", default="2026.08")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    if not args.source_db.exists():
        raise FileNotFoundError(args.source_db)
    if args.output_db.exists():
        if args.force:
            seed_registry_from_release(args.output_db, args.reo_id_registry, args.release_version)
            args.output_db.unlink()
        else:
            raise FileExistsError(f"{args.output_db} exists; pass --force to rebuild")

    args.output_db.parent.mkdir(parents=True, exist_ok=True)
    conn = connect(args.output_db)
    source = str(args.source_db).replace("'", "''")
    conn.execute(f"ATTACH DATABASE '{source}' AS src")
    source_columns = {row[1] for row in conn.execute("PRAGMA src.table_info(reaction_compounds)")}
    source_payload = "rc.source_structure_json" if "source_structure_json" in source_columns else "NULL"
    conn.execute(
        "CREATE TEMP VIEW source_reaction_compounds AS SELECT rc.*, "
        + source_payload + " AS verified_structure_payload FROM src.reaction_compounds rc"
    )

    if args.membership_db:
        if not args.membership_db.exists():
            raise FileNotFoundError(args.membership_db)
        membership = str(args.membership_db.resolve()).replace("'", "''")
        conn.execute(f"ATTACH DATABASE '{membership}' AS membership")

    run(
        conn,
        "set membership",
        """
        CREATE TABLE web_set_reactions (
            reaction_id TEXT PRIMARY KEY,
            dataset_level TEXT NOT NULL
        );
        """
        + (
            """
            INSERT INTO web_set_reactions(reaction_id, dataset_level)
            SELECT reaction_id, dataset_level FROM membership.web_reactions;
            """
            if args.membership_db
            else
            """
            INSERT INTO web_set_reactions(reaction_id, dataset_level)
            SELECT reaction_id, 'gold'
            FROM src.v2_gold_chebi_complete_reactions;

            INSERT OR IGNORE INTO web_set_reactions(reaction_id, dataset_level)
            SELECT reaction_id, 'silver'
            FROM src.v2_silver_structure_supported_reactions;
            """
        )
        + """
        CREATE INDEX idx_web_set_reactions_level ON web_set_reactions(dataset_level);
        """,
    )

    run(
        conn,
        "reaction participant status",
        f"""
        CREATE TABLE web_participant_status AS
        SELECT
            rc.reaction_id,
            COUNT(*) AS participant_count,
            SUM(CASE WHEN {source_structure_value('smiles', 'c.smiles')} IS NOT NULL AND trim({source_structure_value('smiles', 'c.smiles')}) != '' THEN 1 ELSE 0 END) AS smiles_count,
            SUM(CASE WHEN {source_structure_value('smiles', 'c.smiles')} IS NULL OR trim({source_structure_value('smiles', 'c.smiles')}) = '' THEN 1 ELSE 0 END) AS missing_smiles_count
        FROM source_reaction_compounds rc
        JOIN web_set_reactions ws ON ws.reaction_id = rc.reaction_id
        JOIN src.compounds c ON c.compound_id = rc.compound_id
        WHERE coalesce(rc.role, '') IN ('substrate', 'product')
           OR coalesce(rc.side, '') IN ('left', 'right')
        GROUP BY rc.reaction_id;

        CREATE INDEX idx_web_participant_status_reaction ON web_participant_status(reaction_id);
        """,
    )

    run(
        conn,
        "counts",
        """
        CREATE TABLE web_enzyme_counts AS
        SELECT br.reaction_id, COUNT(*) AS enzyme_pair_count, COUNT(DISTINCT br.biopart_id) AS enzyme_count
        FROM src.biopart_reactions br
        JOIN web_set_reactions ws ON ws.reaction_id = br.reaction_id
        GROUP BY br.reaction_id;
        CREATE INDEX idx_web_enzyme_counts_reaction ON web_enzyme_counts(reaction_id);

        CREATE TABLE web_kinetics_counts AS
        SELECT k.reaction_id, COUNT(*) AS kinetics_count
        FROM src.kinetics k
        JOIN web_set_reactions ws ON ws.reaction_id = k.reaction_id
        WHERE k.reaction_id IS NOT NULL
          AND k.reaction_assignment_method IN ('single_reaction_page', 'reaction_text_match', 'exact_accession_substrate_reaction_citation', 'exact_accession_assay_reaction_substrate')
          AND k.value_numeric IS NOT NULL
          AND k.value_numeric >= 0
          AND instr(COALESCE(k.value_text, ''), '-999') = 0
          AND k.unit IS NOT NULL
          AND trim(k.unit) <> ''
        GROUP BY k.reaction_id;
        CREATE INDEX idx_web_kinetics_counts_reaction ON web_kinetics_counts(reaction_id);
        """,
    )

    run(
        conn,
        "reactions",
        """
        CREATE TABLE web_reactions AS
        SELECT
            r.reaction_id,
            ws.dataset_level,
            r.reaction_equation_display,
            r.reaction_equation_raw,
            r.reaction_direction,
            r.ec_number,
            r.rhea_id,
            r.kegg_reaction_id,
            r.metacyc_reaction_id,
            r.evidence_level,
            r.source_db,
            COALESCE(ps.participant_count, 0) AS participant_count,
            COALESCE(ps.smiles_count, 0) AS smiles_count,
            COALESCE(ps.missing_smiles_count, 0) AS missing_smiles_count,
            CASE WHEN COALESCE(ps.participant_count, 0) > 0 AND ps.participant_count = ps.smiles_count THEN 1 ELSE 0 END AS all_participants_have_smiles,
            COALESCE(ec.enzyme_pair_count, 0) AS enzyme_pair_count,
            COALESCE(ec.enzyme_count, 0) AS enzyme_count,
            COALESCE(kc.kinetics_count, 0) AS kinetics_count
        FROM web_set_reactions ws
        JOIN src.reactions r ON r.reaction_id = ws.reaction_id
        LEFT JOIN web_participant_status ps ON ps.reaction_id = r.reaction_id
        LEFT JOIN web_enzyme_counts ec ON ec.reaction_id = r.reaction_id
        LEFT JOIN web_kinetics_counts kc ON kc.reaction_id = r.reaction_id;

        CREATE INDEX idx_web_reactions_id ON web_reactions(reaction_id);
        CREATE INDEX idx_web_reactions_level ON web_reactions(dataset_level);
        CREATE INDEX idx_web_reactions_direction ON web_reactions(reaction_direction);
        CREATE INDEX idx_web_reactions_complete ON web_reactions(all_participants_have_smiles);

        CREATE TABLE web_reaction_ec_numbers AS
        SELECT ren.reaction_id, ren.ec_number_clean, ren.ec_text_raw, ren.source_field
        FROM src.reaction_ec_numbers ren
        JOIN web_reactions wr ON wr.reaction_id = ren.reaction_id
        WHERE ren.ec_number_clean IS NOT NULL AND trim(ren.ec_number_clean) <> '';

        CREATE INDEX idx_web_reaction_ec_reaction ON web_reaction_ec_numbers(reaction_id);

        UPDATE web_reactions
        SET ec_number = (
            SELECT group_concat(ec_number_clean, '; ')
            FROM (
                SELECT DISTINCT ec_number_clean
                FROM web_reaction_ec_numbers ren
                WHERE ren.reaction_id = web_reactions.reaction_id
                ORDER BY ec_number_clean
            )
        )
        WHERE reaction_id IN (SELECT DISTINCT reaction_id FROM web_reaction_ec_numbers);
        """,
    )

    run(
        conn,
        "reaction compounds",
        f"""
        CREATE TABLE web_reaction_compounds AS
        SELECT
            rc.reaction_id,
            rc.compound_id,
            rc.role,
            rc.side,
            rc.position_index,
            rc.stoichiometry,
            {source_structure_value('compound_name', 'COALESCE(c.compound_name, rc.compound_name_raw)')} AS compound_name,
            {source_structure_value('chebi_id', 'c.chebi_id')} AS chebi_id,
            {source_structure_value('pubchem_id', 'c.pubchem_id')} AS pubchem_id,
            {source_structure_value('formula', 'c.formula')} AS formula,
            {source_structure_value('smiles', 'c.smiles')} AS smiles,
            {source_structure_value('inchi', 'c.inchi')} AS inchi,
            {source_structure_value('inchikey', 'c.inchikey')} AS inchikey,
            CASE WHEN rc.verified_structure_payload IS NOT NULL THEN json_extract(rc.verified_structure_payload, '$.structure_status') ELSE COALESCE(css.structure_status,
                CASE WHEN c.smiles IS NOT NULL AND trim(c.smiles) != '' THEN 'exact_smiles' ELSE 'unclassified' END
            ) END AS structure_status
        FROM source_reaction_compounds rc
        JOIN web_set_reactions ws ON ws.reaction_id = rc.reaction_id
        LEFT JOIN src.compounds c ON c.compound_id = rc.compound_id
        LEFT JOIN src.compound_structure_status css ON css.compound_id = rc.compound_id;

        CREATE INDEX idx_web_reaction_compounds_reaction ON web_reaction_compounds(reaction_id);
        CREATE INDEX idx_web_reaction_compounds_compound ON web_reaction_compounds(compound_id);

        CREATE TABLE web_compound_images (
            compound_id TEXT PRIMARY KEY,
            image_path TEXT,
            image_status TEXT NOT NULL,
            reason TEXT,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX idx_web_compound_images_status ON web_compound_images(image_status);
        """,
    )

    run(
        conn,
        "reaction-enzyme links",
        """
        CREATE TABLE web_reaction_enzymes AS
        SELECT
            br.reaction_id,
            br.biopart_id,
            COALESCE(b.name, b.enzyme_name) AS enzyme_name,
            b.gene_name_primary,
            b.organism,
            b.taxonomy_id,
            b.protein_id,
            CASE WHEN b.protein_sequence IS NOT NULL AND trim(b.protein_sequence) != '' THEN 1 ELSE 0 END AS has_sequence,
            length(b.protein_sequence) AS sequence_length,
            br.evidence_level,
            br.source_db
        FROM src.biopart_reactions br
        JOIN web_set_reactions ws ON ws.reaction_id = br.reaction_id
        JOIN src.bioparts b ON b.biopart_id = br.biopart_id;

        CREATE INDEX idx_web_reaction_enzymes_reaction ON web_reaction_enzymes(reaction_id);
        CREATE INDEX idx_web_reaction_enzymes_biopart ON web_reaction_enzymes(biopart_id);
        CREATE INDEX idx_web_reaction_enzymes_name ON web_reaction_enzymes(enzyme_name);
        """,
    )
    reo_id_stats = assign_reo_ids(conn, args.reo_id_registry, args.release_version)
    print(f"[build] permanent R-E-O identifiers: {reo_id_stats}", flush=True)

    run(
        conn,
        "enzymes",
        """
        CREATE TABLE web_enzymes AS
        SELECT
            b.biopart_id,
            b.protein_id,
            COALESCE(b.name, b.enzyme_name) AS enzyme_name,
            b.gene_name_primary,
            b.organism,
            b.taxonomy_id,
            b.lineage,
            b.protein_sequence,
            CASE WHEN b.protein_sequence IS NOT NULL AND trim(b.protein_sequence) != '' THEN 1 ELSE 0 END AS has_sequence,
            length(b.protein_sequence) AS sequence_length,
            b.evidence_label,
            COUNT(DISTINCT re.reaction_id) AS reaction_count
        FROM src.bioparts b
        JOIN (SELECT DISTINCT biopart_id, reaction_id FROM web_reaction_enzymes) re ON re.biopart_id = b.biopart_id
        GROUP BY b.biopart_id;

        CREATE INDEX idx_web_enzymes_biopart ON web_enzymes(biopart_id);
        CREATE INDEX idx_web_enzymes_name ON web_enzymes(enzyme_name);
        CREATE INDEX idx_web_enzymes_organism ON web_enzymes(organism);
        """,
    )

    run(
        conn,
        "kinetics and evidence",
        """
        CREATE TABLE web_kinetics AS
        SELECT
            k.kinetic_id,
            k.reaction_id,
            k.biopart_id,
            k.compound_id,
            k.parameter_type,
            k.value_text,
            k.value_numeric,
            k.unit,
            k.subject_name,
            k.condition_text,
            k.source_db,
            k.evidence_text,
            k.pmids_json,
            k.reaction_assignment_status,
            k.reaction_assignment_method
        FROM src.kinetics k
        JOIN web_set_reactions ws ON ws.reaction_id = k.reaction_id
        WHERE k.reaction_assignment_method IN ('single_reaction_page', 'reaction_text_match', 'exact_accession_substrate_reaction_citation', 'exact_accession_assay_reaction_substrate')
          AND k.value_numeric IS NOT NULL
          AND k.value_numeric >= 0
          AND instr(COALESCE(k.value_text, ''), '-999') = 0
          AND k.unit IS NOT NULL
          AND trim(k.unit) <> '';

        CREATE INDEX idx_web_kinetics_reaction ON web_kinetics(reaction_id);
        CREATE INDEX idx_web_kinetics_biopart ON web_kinetics(biopart_id);

        CREATE TABLE web_kinetics_excluded_qc AS
        SELECT
            k.kinetic_id,
            k.reaction_id,
            k.biopart_id,
            k.parameter_type,
            k.value_text,
            k.value_numeric,
            k.unit,
            k.reaction_assignment_status,
            k.reaction_assignment_method,
            CASE
                WHEN k.value_numeric IS NULL THEN 'missing_numeric_value'
                WHEN k.value_numeric < 0 OR instr(COALESCE(k.value_text, ''), '-999') > 0 THEN 'invalid_sentinel_value'
                WHEN k.reaction_assignment_method = 'compound_membership' THEN 'compound_only_assignment'
                WHEN k.reaction_assignment_method NOT IN ('single_reaction_page', 'reaction_text_match', 'exact_accession_substrate_reaction_citation', 'exact_accession_assay_reaction_substrate') THEN 'unsupported_assignment_method'
                WHEN k.unit IS NULL OR trim(k.unit) = '' THEN 'missing_unit'
                ELSE 'other_qc_exclusion'
            END AS exclusion_reason
        FROM src.kinetics k
        JOIN web_set_reactions ws ON ws.reaction_id = k.reaction_id
        WHERE NOT (
            k.reaction_assignment_method IN ('single_reaction_page', 'reaction_text_match', 'exact_accession_substrate_reaction_citation', 'exact_accession_assay_reaction_substrate')
            AND k.value_numeric IS NOT NULL
            AND k.value_numeric >= 0
            AND instr(COALESCE(k.value_text, ''), '-999') = 0
            AND k.unit IS NOT NULL
            AND trim(k.unit) <> ''
        );

        CREATE INDEX idx_web_kinetics_excluded_reaction
            ON web_kinetics_excluded_qc(reaction_id);
        CREATE INDEX idx_web_kinetics_excluded_reason
            ON web_kinetics_excluded_qc(exclusion_reason);

        CREATE TABLE web_xrefs AS
        SELECT x.entity_type, x.entity_id, x.xref_db, x.xref_value, x.xref_url, x.source_db
        FROM src.xrefs x
        JOIN web_set_reactions ws ON x.entity_type = 'reaction' AND x.entity_id = ws.reaction_id
        UNION
        SELECT 'enzyme' AS entity_type, x.entity_id, x.xref_db, x.xref_value, x.xref_url, x.source_db
        FROM src.xrefs x
        JOIN web_enzymes we ON x.entity_type = 'biopart' AND x.entity_id = we.biopart_id
        WHERE lower(x.xref_db) = 'uniprot'
        UNION
        SELECT DISTINCT 'compound' AS entity_type, wrc.compound_id AS entity_id,
            'chebi' AS xref_db, wrc.chebi_id AS xref_value,
            'https://www.ebi.ac.uk/chebi/searchId.do?chebiId=' || wrc.chebi_id AS xref_url,
            'ReactEnzDB' AS source_db
        FROM web_reaction_compounds wrc
        WHERE wrc.chebi_id IS NOT NULL AND trim(wrc.chebi_id) != ''
        UNION
        SELECT DISTINCT 'compound' AS entity_type, wrc.compound_id AS entity_id,
            'pubchem_compound' AS xref_db, wrc.pubchem_id AS xref_value,
            'https://pubchem.ncbi.nlm.nih.gov/compound/' || wrc.pubchem_id AS xref_url,
            'ReactEnzDB/PubChem' AS source_db
        FROM web_reaction_compounds wrc
        WHERE wrc.pubchem_id IS NOT NULL AND trim(wrc.pubchem_id) != '';

        CREATE INDEX idx_web_xrefs_entity ON web_xrefs(entity_type, entity_id);

        CREATE TABLE web_enzyme_uniprot AS
        SELECT
            entity_id AS biopart_id,
            MIN(CASE WHEN instr(xref_value, '_') = 0 THEN xref_value END) AS uniprot_accession,
            MIN(CASE WHEN instr(xref_value, '_') > 0 THEN xref_value END) AS uniprot_entry_name,
            MIN(CASE WHEN instr(xref_value, '_') = 0 THEN xref_url END) AS uniprot_url,
            COUNT(*) AS uniprot_xref_count,
            'direct_xref' AS uniprot_mapping_method
        FROM web_xrefs
        WHERE entity_type = 'enzyme' AND lower(xref_db) = 'uniprot'
        GROUP BY entity_id;

        CREATE UNIQUE INDEX idx_web_enzyme_uniprot_biopart ON web_enzyme_uniprot(biopart_id);

        INSERT OR IGNORE INTO web_enzyme_uniprot(
            biopart_id, uniprot_accession, uniprot_entry_name, uniprot_url,
            uniprot_xref_count, uniprot_mapping_method
        )
        WITH missing AS (
            SELECT we.biopart_id, we.protein_sequence
            FROM web_enzymes we
            LEFT JOIN web_enzyme_uniprot eu ON eu.biopart_id = we.biopart_id
            WHERE eu.uniprot_accession IS NULL
              AND we.has_sequence = 1
              AND we.protein_sequence IS NOT NULL
              AND trim(we.protein_sequence) <> ''
        ),
        candidates AS (
            SELECT
                m.biopart_id AS missing_biopart,
                eu.uniprot_accession,
                eu.uniprot_entry_name,
                eu.uniprot_url
            FROM missing m
            JOIN web_enzymes e ON e.protein_sequence = m.protein_sequence
            JOIN web_enzyme_uniprot eu ON eu.biopart_id = e.biopart_id
            WHERE eu.uniprot_accession IS NOT NULL
        ),
        ranked AS (
            SELECT
                *,
                ROW_NUMBER() OVER (PARTITION BY missing_biopart ORDER BY uniprot_accession) AS rn
            FROM candidates
        )
        SELECT
            missing_biopart,
            uniprot_accession,
            uniprot_entry_name,
            uniprot_url,
            0 AS uniprot_xref_count,
            'exact_sequence_match' AS uniprot_mapping_method
        FROM ranked
        WHERE rn = 1;
        """,
    )

    run(
        conn,
        "PDB mappings",
        """
        CREATE TABLE web_pdb_mappings AS
        SELECT
            epm.biopart_id,
            epm.uniprot_id,
            epm.pdb_id,
            epm.chain_id,
            epm.experimental_method,
            epm.coverage,
            epm.resolution,
            epm.source_db,
            epm.evidence_url
        FROM src.external_pdb_mappings epm
        JOIN web_enzymes we ON we.biopart_id = epm.biopart_id;

        CREATE INDEX idx_web_pdb_biopart ON web_pdb_mappings(biopart_id);
        """,
    )

    run(
        conn,
        "AlphaFold mappings",
        """
        CREATE TABLE web_alphafold_mappings AS
        SELECT
            eam.biopart_id,
            eam.uniprot_accession,
            eam.status,
            eam.model_entity_id,
            eam.latest_version,
            eam.global_metric_value,
            eam.sequence_start,
            eam.sequence_end,
            eam.cif_url,
            eam.pdb_url,
            eam.bcif_url,
            eam.pae_image_url,
            eam.plddt_doc_url,
            eam.pae_doc_url,
            eam.source
        FROM src.external_alphafold_mappings eam
        JOIN web_enzymes we ON we.biopart_id = eam.biopart_id
        WHERE eam.status = 'found';

        CREATE INDEX idx_web_alphafold_biopart ON web_alphafold_mappings(biopart_id);
        CREATE INDEX idx_web_alphafold_accession ON web_alphafold_mappings(uniprot_accession);
        """,
    )

    populate_chassis_tables(conn)
    populate_accession_tables(conn)

    source_conn = sqlite3.connect(args.source_db.resolve().as_uri() + "?mode=ro", uri=True)
    try:
        repair_kinetic_references(conn, source_conn)
        normalize_kinetic_sources(conn)
        install_kinetic_reference_guards(conn)
        conn.commit()
    finally:
        source_conn.close()

    run(
        conn,
        "stats",
        """
        CREATE TABLE web_stats (metric TEXT PRIMARY KEY, value TEXT NOT NULL);
        """,
    )

    stats = {
        "reactions": scalar(conn, "SELECT COUNT(*) FROM web_reactions"),
        "gold_reactions": scalar(conn, "SELECT COUNT(*) FROM web_reactions WHERE dataset_level='gold'"),
        "silver_reactions": scalar(conn, "SELECT COUNT(*) FROM web_reactions WHERE dataset_level='silver'"),
        "structure_complete_reactions": scalar(conn, "SELECT COUNT(*) FROM web_reactions WHERE all_participants_have_smiles=1"),
        "reaction_enzyme_pairs": scalar(conn, "SELECT COUNT(*) FROM web_reaction_enzymes"),
        "enzymes": scalar(conn, "SELECT COUNT(*) FROM web_enzymes"),
        "enzymes_with_sequence": scalar(conn, "SELECT COUNT(*) FROM web_enzymes WHERE has_sequence=1"),
        "kinetics": scalar(conn, "SELECT COUNT(*) FROM web_kinetics"),
        "kinetics_excluded_by_qc": scalar(conn, "SELECT COUNT(*) FROM web_kinetics_excluded_qc"),
        "kinetics_excluded_compound_only": scalar(conn, "SELECT COUNT(*) FROM web_kinetics_excluded_qc WHERE exclusion_reason='compound_only_assignment'"),
        "kinetics_excluded_invalid_sentinel": scalar(conn, "SELECT COUNT(*) FROM web_kinetics_excluded_qc WHERE exclusion_reason='invalid_sentinel_value'"),
        "kinetics_excluded_missing_unit": scalar(conn, "SELECT COUNT(*) FROM web_kinetics_excluded_qc WHERE exclusion_reason='missing_unit'"),
        "pdb_mapped_enzymes": scalar(conn, "SELECT COUNT(DISTINCT biopart_id) FROM web_pdb_mappings"),
        "alphafold_mapped_enzymes": scalar(conn, "SELECT COUNT(DISTINCT biopart_id) FROM web_alphafold_mappings"),
        "source_organisms": scalar(conn, "SELECT COUNT(DISTINCT organism) FROM web_enzymes WHERE organism IS NOT NULL AND trim(organism) != ''"),
        "chassis_annotated_records": scalar(conn, "SELECT COUNT(*) FROM web_chassis_records"),
        "chassis_labels": scalar(conn, "SELECT COUNT(*) FROM web_chassis_labels"),
    }
    conn.executemany("INSERT INTO web_stats(metric, value) VALUES (?, ?)", [(k, str(v)) for k, v in stats.items()])
    conn.commit()

    conn.execute("DETACH DATABASE src")
    if args.membership_db:
        conn.execute("DETACH DATABASE membership")
    conn.close()

    manifest = {
        "source_db": str(args.source_db.resolve()),
        "output_db": str(args.output_db.resolve()),
        "reo_id_registry": str(args.reo_id_registry.resolve()),
        "reo_id_policy": "Permanent monotonic identifiers; retired identifiers are never reassigned.",
        "reo_id_stats": reo_id_stats,
        "stats": stats,
    }
    DEFAULT_MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
