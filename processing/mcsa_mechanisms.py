"""Offline extraction from ReactEnzDB/scripts/enrich_mcsa_mechanisms.py.
Acquisition functions and the original acquisition CLI are omitted.
Local processing rules are retained; see docs/PROCESSING.md.
"""
from __future__ import annotations

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import argparse

import json

import sqlite3

import time

from pathlib import Path

from urllib.parse import urljoin

ROOT = Path(__file__).resolve().parents[1]

DEFAULT_WEB_DB = ROOT / "web_release" / "reactenzdb_web.db"

DEFAULT_CACHE = ROOT / "external" / "mcsa_entries.json"

MCSA_ENTRIES_URL = "https://www.ebi.ac.uk/thornton-srv/m-csa/api/entries/?format=json"

MCSA_BASE = "https://www.ebi.ac.uk/thornton-srv/m-csa/"

def connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA temp_store = MEMORY")
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn

def log(message: str) -> None:
    print(message, flush=True)

def setup_tables(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS web_mcsa_entries (
          mcsa_id INTEGER PRIMARY KEY,
          enzyme_name TEXT,
          reference_uniprot_id TEXT,
          is_reference_uniprot_id INTEGER,
          entry_url TEXT,
          description TEXT,
          all_ecs_json TEXT,
          mechanism_count INTEGER NOT NULL DEFAULT 0,
          detailed_mechanism_count INTEGER NOT NULL DEFAULT 0,
          residue_count INTEGER NOT NULL DEFAULT 0,
          compound_count INTEGER NOT NULL DEFAULT 0,
          pmids_json TEXT,
          dois_json TEXT,
          source_db TEXT NOT NULL DEFAULT 'M-CSA'
        );

        CREATE TABLE IF NOT EXISTS web_mcsa_entry_uniprots (
          mcsa_id INTEGER NOT NULL,
          uniprot_id TEXT NOT NULL,
          is_reference INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (mcsa_id, uniprot_id)
        );

        CREATE TABLE IF NOT EXISTS web_mcsa_enzyme_mappings (
          biopart_id TEXT NOT NULL,
          uniprot_accession TEXT NOT NULL,
          mcsa_id INTEGER NOT NULL,
          match_type TEXT NOT NULL,
          source_db TEXT NOT NULL DEFAULT 'M-CSA',
          PRIMARY KEY (biopart_id, uniprot_accession, mcsa_id)
        );

        CREATE TABLE IF NOT EXISTS web_mcsa_reaction_mappings (
          reaction_id TEXT NOT NULL,
          ec_number TEXT NOT NULL,
          mcsa_id INTEGER NOT NULL,
          match_type TEXT NOT NULL,
          source_db TEXT NOT NULL DEFAULT 'M-CSA',
          PRIMARY KEY (reaction_id, ec_number, mcsa_id)
        );

        CREATE TABLE IF NOT EXISTS web_mcsa_residues (
          mcsa_residue_id TEXT PRIMARY KEY,
          mcsa_id INTEGER NOT NULL,
          residue_index INTEGER NOT NULL,
          roles_summary TEXT,
          main_annotation TEXT,
          function_location_abv TEXT,
          ptm TEXT,
          roles_json TEXT,
          uniprot_id TEXT,
          uniprot_residue_code TEXT,
          uniprot_residue_position INTEGER,
          residue_sequence_is_reference INTEGER,
          pdb_id TEXT,
          pdb_chain TEXT,
          pdb_assembly_chain TEXT,
          pdb_assembly INTEGER,
          pdb_residue_code TEXT,
          pdb_residue_position INTEGER,
          pdb_auth_residue_position INTEGER,
          pdb_residue_is_reference INTEGER,
          domain_name TEXT,
          domain_cath_id TEXT
        );

        CREATE TABLE IF NOT EXISTS web_mcsa_mechanisms (
          mcsa_id INTEGER NOT NULL,
          mechanism_id INTEGER NOT NULL,
          is_detailed INTEGER NOT NULL DEFAULT 0,
          mechanism_text TEXT,
          rating INTEGER,
          components_summary TEXT,
          PRIMARY KEY (mcsa_id, mechanism_id)
        );

        CREATE TABLE IF NOT EXISTS web_mcsa_mechanism_steps (
          mcsa_id INTEGER NOT NULL,
          mechanism_id INTEGER NOT NULL,
          step_id INTEGER NOT NULL,
          description TEXT,
          is_product INTEGER NOT NULL DEFAULT 0,
          figure_url TEXT,
          marvin_xml_url TEXT,
          PRIMARY KEY (mcsa_id, mechanism_id, step_id)
        );

        CREATE TABLE IF NOT EXISTS web_mcsa_compounds (
          mcsa_compound_id TEXT PRIMARY KEY,
          mcsa_id INTEGER NOT NULL,
          compound_index INTEGER NOT NULL,
          compound_type TEXT,
          compound_count REAL,
          chebi_id TEXT,
          compound_name TEXT,
          mol_file_url TEXT
        );

        CREATE TABLE IF NOT EXISTS web_mcsa_references (
          mcsa_reference_id TEXT PRIMARY KEY,
          mcsa_id INTEGER NOT NULL,
          mechanism_id INTEGER,
          pubmed_id TEXT,
          doi TEXT,
          title TEXT,
          evidence_types_json TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_web_mcsa_enzyme_mappings_biopart ON web_mcsa_enzyme_mappings(biopart_id);
        CREATE INDEX IF NOT EXISTS idx_web_mcsa_reaction_mappings_reaction ON web_mcsa_reaction_mappings(reaction_id);
        CREATE INDEX IF NOT EXISTS idx_web_mcsa_residues_mcsa ON web_mcsa_residues(mcsa_id);
        CREATE INDEX IF NOT EXISTS idx_web_mcsa_mechanisms_mcsa ON web_mcsa_mechanisms(mcsa_id);
        CREATE INDEX IF NOT EXISTS idx_web_mcsa_compounds_mcsa ON web_mcsa_compounds(mcsa_id);
        CREATE INDEX IF NOT EXISTS idx_web_mcsa_references_mcsa ON web_mcsa_references(mcsa_id);
        """
    )
    conn.commit()

def full_url(value: str | None) -> str | None:
    if not value:
        return None
    if value.startswith("http://") or value.startswith("https://"):
        return value
    return urljoin("https://", value) if value.startswith("www.") else urljoin(MCSA_BASE, value)

def safe_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)

def unique_sorted(values: list[str | None]) -> list[str]:
    return sorted({str(value).strip() for value in values if value and str(value).strip()})

def entry_uniprots(entry: dict) -> list[tuple[int, str, int]]:
    mcsa_id = int(entry["mcsa_id"])
    reference = entry.get("reference_uniprot_id")
    values = []
    for seq in ((entry.get("protein") or {}).get("sequences") or []):
        uniprot_id = seq.get("uniprot_id")
        if uniprot_id:
            values.append((mcsa_id, uniprot_id, 1 if uniprot_id == reference else 0))
    if reference and not any(item[1] == reference for item in values):
        values.append((mcsa_id, reference, 1))
    return values

def parse_entries(entries: list[dict]) -> dict[str, list[tuple]]:
    rows: dict[str, list[tuple]] = {
        "entries": [],
        "entry_uniprots": [],
        "residues": [],
        "mechanisms": [],
        "steps": [],
        "compounds": [],
        "references": [],
    }
    for entry in entries:
        mcsa_id = int(entry["mcsa_id"])
        reaction = entry.get("reaction") or {}
        mechanisms = reaction.get("mechanisms") or []
        residues = entry.get("residues") or []
        compounds = reaction.get("compounds") or []
        references = []
        for mechanism in mechanisms:
            references.extend(mechanism.get("references") or [])
        rows["entries"].append(
            (
                mcsa_id,
                entry.get("enzyme_name"),
                entry.get("reference_uniprot_id"),
                1 if entry.get("is_reference_uniprot_id") else 0,
                full_url(entry.get("url")),
                entry.get("description"),
                safe_json(unique_sorted(entry.get("all_ecs") or [])),
                len(mechanisms),
                sum(1 for mechanism in mechanisms if mechanism.get("is_detailed")),
                len(residues),
                len(compounds),
                safe_json(unique_sorted([ref.get("pubmed_id") for ref in references])),
                safe_json(unique_sorted([ref.get("doi") for ref in references])),
            )
        )
        rows["entry_uniprots"].extend(entry_uniprots(entry))
        for residue_index, residue in enumerate(residues, start=1):
            roles_json = safe_json(residue.get("roles") or [])
            seqs = residue.get("residue_sequences") or [{}]
            chains = residue.get("residue_chains") or [{}]
            for seq_index, seq in enumerate(seqs or [{}], start=1):
                for chain_index, chain in enumerate(chains or [{}], start=1):
                    residue_id = f"{mcsa_id}:{residue_index}:{seq_index}:{chain_index}"
                    rows["residues"].append(
                        (
                            residue_id,
                            mcsa_id,
                            residue_index,
                            residue.get("roles_summary"),
                            residue.get("main_annotation"),
                            residue.get("function_location_abv"),
                            residue.get("ptm"),
                            roles_json,
                            seq.get("uniprot_id"),
                            seq.get("code"),
                            seq.get("resid"),
                            1 if seq.get("is_reference") else 0,
                            str(chain.get("pdb_id")).upper() if chain.get("pdb_id") else None,
                            chain.get("chain_name"),
                            chain.get("assembly_chain_name"),
                            chain.get("assembly"),
                            chain.get("code"),
                            chain.get("resid"),
                            chain.get("auth_resid"),
                            1 if chain.get("is_reference") else 0,
                            chain.get("domain_name"),
                            chain.get("domain_cath_id"),
                        )
                    )
        for mechanism in mechanisms:
            mechanism_id = int(mechanism["mechanism_id"])
            rows["mechanisms"].append(
                (
                    mcsa_id,
                    mechanism_id,
                    1 if mechanism.get("is_detailed") else 0,
                    mechanism.get("mechanism_text"),
                    mechanism.get("rating"),
                    mechanism.get("components_summary"),
                )
            )
            for step in mechanism.get("steps") or []:
                rows["steps"].append(
                    (
                        mcsa_id,
                        mechanism_id,
                        int(step["step_id"]),
                        step.get("description"),
                        1 if step.get("is_product") else 0,
                        full_url(step.get("figure")),
                        full_url(step.get("marvin_xml")),
                    )
                )
            for ref_index, ref in enumerate(mechanism.get("references") or [], start=1):
                pubmed_id = str(ref.get("pubmed_id") or "").strip() or None
                doi = str(ref.get("doi") or "").strip() or None
                ref_id = f"{mcsa_id}:{mechanism_id}:{ref_index}:{pubmed_id or doi or 'na'}"
                rows["references"].append(
                    (
                        ref_id,
                        mcsa_id,
                        mechanism_id,
                        pubmed_id,
                        doi,
                        ref.get("title"),
                        safe_json(ref.get("evidence_types") or []),
                    )
                )
        for compound_index, compound in enumerate(compounds, start=1):
            compound_id = f"{mcsa_id}:{compound_index}:{compound.get('type') or 'compound'}:{compound.get('chebi_id') or compound.get('name') or 'na'}"
            rows["compounds"].append(
                (
                    compound_id,
                    mcsa_id,
                    compound_index,
                    compound.get("type"),
                    compound.get("count"),
                    compound.get("chebi_id"),
                    compound.get("name"),
                    full_url(compound.get("mol_file")),
                )
            )
    # Preserve verified coordinate corrections when rebuilding from the same upstream records.
    override_path = ROOT / "external" / "mcsa_coordinate_overrides.json"
    if override_path.exists():
        overrides = {item["mcsa_residue_id"]: item for item in json.loads(override_path.read_text(encoding="utf-8"))}
        for index, record in enumerate(rows["residues"]):
            item = overrides.get(record[0])
            if not item:
                continue
            before = item["before"]
            if (record[8], record[9], record[10], record[12], record[13], record[18]) != (before["uniprot_id"], before["uniprot_residue_code"], before["uniprot_residue_position"], before["pdb_id"], before["pdb_chain"], before["pdb_auth_residue_position"]):
                continue
            corrected = list(record)
            corrected[10] = item["after"]["uniprot_residue_position"]
            corrected[4] = item["after"]["main_annotation"]
            rows["residues"][index] = tuple(corrected)
    return rows

def local_ec_index(conn: sqlite3.Connection) -> dict[str, list[str]]:
    index: dict[str, list[str]] = {}
    for row in conn.execute("SELECT reaction_id, ec_number FROM web_reactions WHERE ec_number IS NOT NULL AND trim(ec_number) <> ''"):
        ecs = str(row["ec_number"]).replace(",", ";").split(";")
        for ec in ecs:
            ec = ec.strip().replace("EC:", "")
            if ec:
                index.setdefault(ec, []).append(row["reaction_id"])
    return index

def build_mappings(conn: sqlite3.Connection, entries: list[dict]) -> tuple[list[tuple], list[tuple]]:
    enzyme_rows = []
    reaction_rows = []
    for row in conn.execute(
        """
        SELECT eu.biopart_id, eu.uniprot_accession, m.mcsa_id, m.reference_uniprot_id
        FROM web_enzyme_uniprot eu
        JOIN web_mcsa_entry_uniprots u ON u.uniprot_id = eu.uniprot_accession
        JOIN web_mcsa_entries m ON m.mcsa_id = u.mcsa_id
        WHERE eu.uniprot_accession IS NOT NULL AND trim(eu.uniprot_accession) <> ''
        """
    ):
        match_type = "reference_uniprot_exact" if row["uniprot_accession"] == row["reference_uniprot_id"] else "entry_uniprot_exact"
        enzyme_rows.append((row["biopart_id"], row["uniprot_accession"], row["mcsa_id"], match_type))

    ec_index = local_ec_index(conn)
    for entry in entries:
        mcsa_id = int(entry["mcsa_id"])
        for ec in unique_sorted(entry.get("all_ecs") or []):
            for reaction_id in ec_index.get(ec, []):
                reaction_rows.append((reaction_id, ec, mcsa_id, "ec_exact_context"))
    return enzyme_rows, reaction_rows

def replace_data(conn: sqlite3.Connection, rows: dict[str, list[tuple]], entries: list[dict]) -> None:
    conn.executescript(
        """
        DELETE FROM web_mcsa_references;
        DELETE FROM web_mcsa_compounds;
        DELETE FROM web_mcsa_mechanism_steps;
        DELETE FROM web_mcsa_mechanisms;
        DELETE FROM web_mcsa_residues;
        DELETE FROM web_mcsa_enzyme_mappings;
        DELETE FROM web_mcsa_reaction_mappings;
        DELETE FROM web_mcsa_entry_uniprots;
        DELETE FROM web_mcsa_entries;
        """
    )
    conn.executemany(
        """
        INSERT INTO web_mcsa_entries (
          mcsa_id, enzyme_name, reference_uniprot_id, is_reference_uniprot_id, entry_url,
          description, all_ecs_json, mechanism_count, detailed_mechanism_count, residue_count,
          compound_count, pmids_json, dois_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows["entries"],
    )
    conn.executemany("INSERT OR REPLACE INTO web_mcsa_entry_uniprots VALUES (?, ?, ?)", rows["entry_uniprots"])
    conn.executemany(
        """
        INSERT INTO web_mcsa_residues (
          mcsa_residue_id, mcsa_id, residue_index, roles_summary, main_annotation, function_location_abv,
          ptm, roles_json, uniprot_id, uniprot_residue_code, uniprot_residue_position,
          residue_sequence_is_reference, pdb_id, pdb_chain, pdb_assembly_chain, pdb_assembly,
          pdb_residue_code, pdb_residue_position, pdb_auth_residue_position, pdb_residue_is_reference,
          domain_name, domain_cath_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows["residues"],
    )
    conn.executemany("INSERT INTO web_mcsa_mechanisms VALUES (?, ?, ?, ?, ?, ?)", rows["mechanisms"])
    conn.executemany("INSERT INTO web_mcsa_mechanism_steps VALUES (?, ?, ?, ?, ?, ?, ?)", rows["steps"])
    conn.executemany("INSERT INTO web_mcsa_compounds VALUES (?, ?, ?, ?, ?, ?, ?, ?)", rows["compounds"])
    conn.executemany("INSERT OR REPLACE INTO web_mcsa_references VALUES (?, ?, ?, ?, ?, ?, ?)", rows["references"])
    conn.commit()

    enzyme_rows, reaction_rows = build_mappings(conn, entries)
    conn.executemany("INSERT OR REPLACE INTO web_mcsa_enzyme_mappings VALUES (?, ?, ?, ?, 'M-CSA')", enzyme_rows)
    conn.executemany("INSERT OR REPLACE INTO web_mcsa_reaction_mappings VALUES (?, ?, ?, ?, 'M-CSA')", reaction_rows)
    conn.commit()
