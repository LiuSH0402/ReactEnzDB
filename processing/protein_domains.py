"""Offline extraction from ReactEnzDB/scripts/enrich_protein_domains.py.
Acquisition functions and the original acquisition CLI are omitted.
Local processing rules are retained; see docs/PROCESSING.md.
"""
from __future__ import annotations

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import argparse

import csv

import re

import sqlite3

import time

from functools import lru_cache

from protein_coordinate_mapping import parse_location, map_interval

from io import StringIO

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

DEFAULT_WEB_DB = ROOT / "web_release" / "reactenzdb_web.db"

INTERPRO_ENTRY_LIST_URL = "https://ftp.ebi.ac.uk/pub/databases/interpro/current_release/entry.list"

UNIPROT_ACCESSIONS_URL = "https://rest.uniprot.org/uniprotkb/accessions"

FIELDS = "accession,xref_interpro,xref_pfam,ft_domain,ft_act_site,ft_binding,ft_site,protein_name,sequence"

FEATURE_SPLIT_RE = re.compile(r";\s+(?=(?:DOMAIN|ACT_SITE|BINDING|SITE)\s+)")

NOTE_RE = re.compile(r'/note="([^"]+)"')

EVIDENCE_RE = re.compile(r'/evidence="([^"]+)"')

LIGAND_RE = re.compile(r'/ligand="([^"]+)"')

def connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
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
        CREATE TABLE IF NOT EXISTS web_protein_annotation_status (
          biopart_id TEXT PRIMARY KEY,
          uniprot_accession TEXT,
          status TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          error_text TEXT
        );

        CREATE TABLE IF NOT EXISTS web_protein_annotations (
          biopart_id TEXT PRIMARY KEY,
          uniprot_accession TEXT,
          protein_name TEXT,
          interpro_count INTEGER NOT NULL DEFAULT 0,
          pfam_count INTEGER NOT NULL DEFAULT 0,
          domain_feature_count INTEGER NOT NULL DEFAULT 0,
          active_site_count INTEGER NOT NULL DEFAULT 0,
          binding_site_count INTEGER NOT NULL DEFAULT 0,
          conserved_site_count INTEGER NOT NULL DEFAULT 0,
          source_db TEXT NOT NULL DEFAULT 'UniProtKB/InterPro',
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS web_protein_domains (
          domain_id INTEGER PRIMARY KEY AUTOINCREMENT,
          biopart_id TEXT NOT NULL,
          uniprot_accession TEXT,
          annotation_db TEXT NOT NULL,
          entry_id TEXT NOT NULL,
          entry_name TEXT,
          entry_type TEXT,
          source_db TEXT NOT NULL DEFAULT 'UniProtKB/InterPro',
          entry_url TEXT
        );

        CREATE TABLE IF NOT EXISTS web_protein_features (
          feature_id INTEGER PRIMARY KEY AUTOINCREMENT,
          biopart_id TEXT NOT NULL,
          uniprot_accession TEXT,
          feature_type TEXT NOT NULL,
          position_start INTEGER,
          position_end INTEGER,
          note TEXT,
          ligand TEXT,
          evidence TEXT,
          feature_text TEXT,
          source_db TEXT NOT NULL DEFAULT 'UniProtKB'
        );

        CREATE INDEX IF NOT EXISTS idx_web_protein_domains_biopart ON web_protein_domains(biopart_id);
        CREATE INDEX IF NOT EXISTS idx_web_protein_domains_entry ON web_protein_domains(annotation_db, entry_id);
        CREATE INDEX IF NOT EXISTS idx_web_protein_features_biopart ON web_protein_features(biopart_id);
        CREATE INDEX IF NOT EXISTS idx_web_protein_status_status ON web_protein_annotation_status(status);
        """
    )
    columns = {row[1] for row in conn.execute("PRAGMA table_info(web_protein_features)")}
    for name, dtype in (("source_uniprot_accession", "TEXT"), ("source_position_start", "INTEGER"), ("source_position_end", "INTEGER"), ("coordinate_status", "TEXT"), ("coordinate_note", "TEXT")):
        if name not in columns:
            conn.execute(f"ALTER TABLE web_protein_features ADD COLUMN {name} {dtype}")
    conn.commit()

def chunks(items: list, size: int):
    for start in range(0, len(items), size):
        yield items[start : start + size]

def get_targets(conn: sqlite3.Connection, limit: int | None, refresh: bool) -> list[tuple[str, str]]:
    where = ""
    if not refresh:
        where = """
        AND NOT EXISTS (
          SELECT 1 FROM web_protein_annotation_status s
          WHERE s.biopart_id = eu.biopart_id AND s.status = 'done'
        )
        """
    sql = f"""
        SELECT eu.biopart_id, eu.uniprot_accession
        FROM web_enzyme_uniprot eu
        WHERE eu.uniprot_accession IS NOT NULL AND trim(eu.uniprot_accession) <> ''
        {where}
        ORDER BY eu.biopart_id
    """
    if limit:
        sql += f" LIMIT {int(limit)}"
    return [(row[0], row[1]) for row in conn.execute(sql)]

def split_ids(value: str | None) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in value.split(";") if part.strip()]

def parse_features(value: str | None, feature_type: str, accession: str | None = None) -> list[dict[str, object]]:
    if not value:
        return []
    rows: list[dict[str, object]] = []
    for item in FEATURE_SPLIT_RE.split(value):
        item = item.strip().rstrip(";")
        if not item:
            continue
        location = parse_location(item, accession)
        start, end = location["start"], location["end"]
        rows.append(
            {
                "feature_type": feature_type,
                "position_start": start,
                "position_end": end,
                "note": first_match(NOTE_RE, item),
                "ligand": first_match(LIGAND_RE, item),
                "evidence": first_match(EVIDENCE_RE, item),
                "feature_text": item,
                "source_uniprot_accession": location["accession"],
                "source_position_start": start,
                "source_position_end": end,
            }
        )
    return rows

def first_match(pattern: re.Pattern[str], text: str) -> str | None:
    match = pattern.search(text)
    return match.group(1) if match else None

def entry_url(annotation_db: str, entry_id: str) -> str:
    if annotation_db == "InterPro":
        return f"https://www.ebi.ac.uk/interpro/entry/InterPro/{entry_id}/"
    if annotation_db == "Pfam":
        return f"https://www.ebi.ac.uk/interpro/entry/pfam/{entry_id}/"
    return "https://www.ebi.ac.uk/interpro/"

def save_batch(
    conn: sqlite3.Connection,
    rows: list[dict[str, str]],
    accession_to_biopart: dict[str, str],
    interpro_entries: dict[str, tuple[str, str]],
) -> None:
    annotation_rows = []
    domain_rows = []
    feature_rows = []
    status_rows = []
    seen_bioparts: set[str] = set()

    for row in rows:
        accession = row["Entry"].strip()
        biopart_id = accession_to_biopart.get(accession.upper())
        if not biopart_id:
            continue
        seen_bioparts.add(biopart_id)
        interpro_ids = split_ids(row.get("InterPro"))
        pfam_ids = split_ids(row.get("Pfam"))
        domain_features = parse_features(row.get("Domain [FT]"), "domain", accession)
        active_sites = parse_features(row.get("Active site"), "active_site", accession)
        binding_sites = parse_features(row.get("Binding site"), "binding_site", accession)
        conserved_sites = parse_features(row.get("Site"), "conserved_site", accession)
        features = domain_features + active_sites + binding_sites + conserved_sites
        stored_row = conn.execute("SELECT protein_sequence FROM web_enzymes WHERE biopart_id=?", (biopart_id,)).fetchone()
        stored_sequence = (stored_row[0] or "") if stored_row else ""
        for feature in features:
            source_accession = feature["source_uniprot_accession"]
            source_sequence = (row.get("Sequence") or "") if source_accession == accession else cached_isoform_sequence(str(source_accession))
            start, end, status = map_interval(source_sequence, stored_sequence, feature["source_position_start"], feature["source_position_end"])
            feature["position_start"], feature["position_end"] = start, end
            feature["coordinate_status"] = status
            source_position = f"{source_accession}:{feature['source_position_start']}..{feature['source_position_end']}"
            feature["coordinate_note"] = (f"Coordinate QC: mapped to stored sequence using {status.replace('_', ' ')}; source {source_position}." if start is not None else f"Coordinate QC: not mapped to stored sequence ({status.replace('_', ' ')}); source {source_position} retained for reference only.")

        annotation_rows.append(
            (
                biopart_id,
                accession,
                row.get("Protein names") or None,
                len(interpro_ids),
                len(pfam_ids),
                len(domain_features),
                len(active_sites),
                len(binding_sites),
                len(conserved_sites),
            )
        )
        for entry_id in interpro_ids:
            name, entry_type = interpro_entries.get(entry_id, ("", ""))
            domain_rows.append(
                (
                    biopart_id,
                    accession,
                    "InterPro",
                    entry_id,
                    name or None,
                    entry_type or None,
                    entry_url("InterPro", entry_id),
                )
            )
        for entry_id in pfam_ids:
            domain_rows.append(
                (
                    biopart_id,
                    accession,
                    "Pfam",
                    entry_id,
                    None,
                    "Pfam signature",
                    entry_url("Pfam", entry_id),
                )
            )
        for feature in features:
            feature_rows.append(
                (
                    biopart_id,
                    accession,
                    feature["feature_type"],
                    feature["position_start"],
                    feature["position_end"],
                    feature["note"],
                    feature["ligand"],
                    feature["evidence"],
                    feature["feature_text"],
                    feature["source_uniprot_accession"],
                    feature["source_position_start"],
                    feature["source_position_end"],
                    feature["coordinate_status"],
                    feature["coordinate_note"],
                )
            )
        status_rows.append((biopart_id, accession, "done", None))

    requested_bioparts = set(accession_to_biopart.values())
    for biopart_id in sorted(requested_bioparts - seen_bioparts):
        accession = next(acc for acc, bp in accession_to_biopart.items() if bp == biopart_id)
        status_rows.append((biopart_id, accession, "not_returned", "UniProt did not return this accession"))

    conn.executemany("DELETE FROM web_protein_domains WHERE biopart_id = ?", [(row[0],) for row in status_rows])
    conn.executemany("DELETE FROM web_protein_features WHERE biopart_id = ?", [(row[0],) for row in status_rows])
    conn.executemany(
        """
        INSERT OR REPLACE INTO web_protein_annotations (
          biopart_id, uniprot_accession, protein_name, interpro_count, pfam_count,
          domain_feature_count, active_site_count, binding_site_count, conserved_site_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        annotation_rows,
    )
    conn.executemany(
        """
        INSERT INTO web_protein_domains (
          biopart_id, uniprot_accession, annotation_db, entry_id, entry_name, entry_type, entry_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        domain_rows,
    )
    conn.executemany(
        """
        INSERT INTO web_protein_features (
          biopart_id, uniprot_accession, feature_type, position_start, position_end,
          note, ligand, evidence, feature_text, source_uniprot_accession,
          source_position_start, source_position_end, coordinate_status, coordinate_note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        feature_rows,
    )
    conn.executemany(
        """
        INSERT OR REPLACE INTO web_protein_annotation_status (
          biopart_id, uniprot_accession, status, error_text
        ) VALUES (?, ?, ?, ?)
        """,
        status_rows,
    )
    conn.commit()
_LOCAL_ISOFORM_SEQUENCES = {}

def set_local_isoform_sequences(sequences):
    """Supply already obtained accession-to-sequence mappings; performs no HTTP."""
    _LOCAL_ISOFORM_SEQUENCES.clear()
    _LOCAL_ISOFORM_SEQUENCES.update(sequences)

def cached_isoform_sequence(accession):
    """An absent local sequence remains unresolved, as a failed original fetch did."""
    return _LOCAL_ISOFORM_SEQUENCES.get(accession, "")

