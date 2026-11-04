"""Replay audited protein-level reference inheritance after evidence rebuilds.

Only complete, unambiguous sequences with the same explicit taxonomy ID qualify.
This module never creates reaction/assay/kinetic evidence or UniProt mappings.
The caller owns the transaction. Source references remain inherited annotations,
not independently verified experimental support.
"""
from __future__ import annotations

import hashlib
import re
import sqlite3

TABLE = "web_protein_reference_inheritance"
SCOPE = "inherited_protein_reference_not_reaction_or_measurement_evidence"


def identity(sequence: str | None, taxonomy_id: object) -> tuple[str, str]:
    sequence = re.sub(r"\s+", "", sequence or "").upper()
    tax = str(taxonomy_id or "").strip()
    if not re.fullmatch(r"[ACDEFGHIKLMNPQRSTVWYOU]+", sequence):
        raise ValueError("Missing or ambiguous full protein sequence")
    if not re.fullmatch(r"[1-9][0-9]*", tax):
        raise ValueError("An explicit positive taxonomy ID is required")
    return hashlib.sha256(sequence.encode()).hexdigest(), tax


def create_audit_table(conn: sqlite3.Connection) -> None:
    conn.execute(f"""CREATE TABLE IF NOT EXISTS {TABLE} (
        target_biopart_id TEXT NOT NULL,
        pmid TEXT NOT NULL,
        source_snapshot TEXT NOT NULL,
        source_biopart_id TEXT NOT NULL,
        source_reference_id INTEGER NOT NULL,
        source_db TEXT,
        citation_text TEXT,
        reference_url TEXT,
        sequence_sha256 TEXT NOT NULL,
        taxonomy_id TEXT NOT NULL,
        canonical_protein_key TEXT NOT NULL,
        evidence_scope TEXT NOT NULL,
        source_reference_json TEXT NOT NULL,
        recovery_revision TEXT NOT NULL,
        PRIMARY KEY(target_biopart_id, pmid, source_snapshot, source_reference_id)
    )""")


def validated_selection(conn: sqlite3.Connection) -> dict:
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (TABLE,)).fetchone():
        return {}
    records = conn.execute(f"SELECT target_biopart_id,pmid,sequence_sha256,taxonomy_id,"
                           f"evidence_scope,citation_text,reference_url,source_db FROM {TABLE} "
                           "ORDER BY target_biopart_id,pmid,source_reference_id").fetchall()
    # Validate the whole replay before inserting anything. Changed identity fails
    # closed instead of transferring evidence to a repurposed identifier.
    target_identity = {}
    selected = {}
    for eid, pmid, seq, tax, scope, citation, url, source in records:
        if eid not in target_identity:
            row = conn.execute("SELECT protein_sequence,taxonomy_id FROM web_enzymes WHERE biopart_id=?", (eid,)).fetchone()
            if row is None:
                raise ValueError(f"Inherited reference target absent: {eid}")
            target_identity[eid] = identity(*row)
        if target_identity[eid] != (seq, tax) or scope != SCOPE:
            raise ValueError(f"Inherited reference identity/scope mismatch: {eid}")
        if not re.fullmatch(r"[1-9][0-9]*", pmid):
            raise ValueError(f"Invalid PMID: {pmid}")
        selected.setdefault((eid, pmid), (citation, url, source))
    return selected


def restore_inherited_references(conn: sqlite3.Connection) -> int:
    selected = validated_selection(conn)
    existing = {tuple(row) for row in conn.execute("SELECT entity_id,trim(pmid) FROM web_entity_references WHERE entity_type='enzyme'")}
    next_id = int(conn.execute("SELECT COALESCE(MAX(reference_id),0) FROM web_entity_references").fetchone()[0])
    inserted = 0
    for (eid, pmid), (citation, url, source) in selected.items():
        if (eid, pmid) in existing:
            continue
        next_id += 1
        conn.execute("INSERT INTO web_entity_references VALUES (?, 'enzyme', ?, ?, ?, ?, ?)",
                     (next_id, eid, pmid, citation, url or f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/", source))
        inserted += 1
    return inserted


def install_plan(conn: sqlite3.Connection, records: list[dict]) -> int:
    create_audit_table(conn)
    columns = [row[1] for row in conn.execute(f"PRAGMA table_info({TABLE})")]
    for record in records:
        if record['evidence_scope'] != SCOPE:
            raise ValueError("Incorrect evidence scope")
        # Prevent silent replacement of existing provenance with different data.
        values = tuple(record[c] for c in columns)
        old = conn.execute(f"SELECT * FROM {TABLE} WHERE target_biopart_id=? AND pmid=? "
                           "AND source_snapshot=? AND source_reference_id=?", values[:3] + (record['source_reference_id'],)).fetchone()
        if old is not None and tuple(old) != values:
            raise ValueError("Conflicting existing inheritance provenance")
        if old is None:
            conn.execute(f"INSERT INTO {TABLE} VALUES ({','.join('?' for _ in columns)})", values)
    return restore_inherited_references(conn)
