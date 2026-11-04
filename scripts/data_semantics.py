"""Shared source and direction semantics; source sides never imply reversibility."""
from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime, timezone

SOURCE_RULE = "KINETIC_SOURCE_TOKENS_V1"
DIRECTION_RULE = "SOURCE_DIRECTION_V2"
SOURCES = frozenset({"brenda", "uniprot", "metacyc", "sabio-rk", "rdbsb"})


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def direction_fields(value: str | None) -> tuple[str, str, str]:
    # Bidirectional is a source annotation, not a thermodynamic measurement.
    if value == "=":
        return "unspecified", "unknown", "preserve_source_sides_unspecified_v2"
    if value in {"<=>", "<-->"}:
        return "bidirectional", "source_bidirectional", "preserve_source_sides_bidirectional_v2"
    if value == "=>":
        return "left_to_right", "directional", "preserve_source_sides_forward_v2"
    if value == "<=":
        return "right_to_left", "directional", "preserve_source_sides_reverse_v2"
    return "unknown", "unknown", "preserve_source_sides_unknown_v2"


def normalize_kinetic_source(value: str | None) -> tuple[str, list[str]]:
    tokens = [v.strip() for v in str(value or "").split(",") if v.strip()]
    aliases = {"uniprotkb": "uniprot", "uniprotkb/swiss-prot": "uniprot"}
    normalized = {v: aliases.get(v.casefold(), v.casefold()) for v in tokens}
    labels = sorted({name for name in normalized.values() if name in SOURCES})
    removed = [v for v, name in normalized.items() if name not in SOURCES]
    return ",".join(labels) if labels else "unknown", removed


def normalize_kinetic_sources(conn: sqlite3.Connection) -> int:
    conn.execute("""CREATE TABLE IF NOT EXISTS web_kinetics_source_provenance (
        kinetic_id TEXT PRIMARY KEY, source_db_raw TEXT,
        source_db_normalized TEXT NOT NULL, non_database_tokens_json TEXT NOT NULL,
        normalization_rule TEXT NOT NULL, recorded_at_utc TEXT NOT NULL)""")
    changed = 0
    for kid, current in conn.execute("SELECT kinetic_id,source_db FROM web_kinetics").fetchall():
        prior = conn.execute("SELECT source_db_raw FROM web_kinetics_source_provenance WHERE kinetic_id=?", (kid,)).fetchone()
        raw = prior[0] if prior else current
        normalized, removed = normalize_kinetic_source(raw)
        if prior is None:
            conn.execute("INSERT INTO web_kinetics_source_provenance VALUES (?,?,?,?,?,?)",
                         (kid, raw, normalized, json.dumps(removed, ensure_ascii=False), SOURCE_RULE, utc_now()))
        if current != normalized:
            conn.execute("UPDATE web_kinetics SET source_db=? WHERE kinetic_id=?", (normalized, kid))
            changed += 1
    return changed


def canonical_kinetic_biopart(conn: sqlite3.Connection, source: sqlite3.Connection,
                             biopart_id: str, reaction_id: str) -> tuple[str, dict]:
    """Only use an explicit upstream dedup representative, with independent checks."""
    if conn.execute("SELECT 1 FROM web_enzymes e JOIN web_reaction_enzymes re USING(biopart_id) WHERE e.biopart_id=? AND re.reaction_id=?", (biopart_id, reaction_id)).fetchone():
        return biopart_id, {}
    mappings = source.execute("""SELECT g.representative_biopart_id,g.sequence_hash,g.organism_key
        FROM temp_dedup_organism_stats t JOIN report_dedup_group_stats g
        ON g.reaction_id=t.reaction_id AND g.sequence_hash=t.sequence_hash AND g.organism_key=t.organism_key
        WHERE t.biopart_id=? AND t.reaction_id=?""", (biopart_id, reaction_id)).fetchall()
    if len(mappings) != 1:
        raise ValueError(f"No unique logged representative: {biopart_id}/{reaction_id}")
    representative, logged_hash, organism_key = mappings[0]
    original = source.execute("SELECT protein_sequence,organism,taxonomy_id FROM bioparts WHERE biopart_id=?", (biopart_id,)).fetchone()
    target = conn.execute("SELECT protein_sequence,organism,taxonomy_id FROM web_enzymes WHERE biopart_id=?", (representative,)).fetchone()
    if not original or not target or not original[0] or original[0] != target[0]:
        raise ValueError(f"Sequence mismatch: {biopart_id}/{representative}")
    digest = hashlib.sha256(original[0].encode("utf-8")).hexdigest()
    if digest != logged_hash or original[1].strip().casefold() != organism_key or target[1].strip().casefold() != organism_key:
        raise ValueError(f"Dedup hash/organism mismatch: {biopart_id}/{representative}")
    if original[2] and target[2] and original[2] != target[2]:
        raise ValueError(f"Taxonomy mismatch: {biopart_id}/{representative}")
    if not conn.execute("SELECT 1 FROM web_reaction_enzymes WHERE reaction_id=? AND biopart_id=?", (reaction_id, representative)).fetchone():
        raise ValueError(f"Representative pair not published: {reaction_id}/{representative}")
    return representative, {"rule": "UPSTREAM_DEDUP_EXACT_REACTION_SEQUENCE_ORGANISM_V1",
        "source_tables": ["temp_dedup_organism_stats", "report_dedup_group_stats"],
        "reaction_id": reaction_id, "sequence_sha256": digest, "organism_key": organism_key,
        "original_taxonomy_id": original[2], "representative_taxonomy_id": target[2]}


def ensure_reference_audit(conn: sqlite3.Connection) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS web_kinetics_reference_repairs (
        kinetic_id TEXT PRIMARY KEY, original_biopart_id TEXT NOT NULL,
        representative_biopart_id TEXT NOT NULL, reaction_id TEXT NOT NULL,
        evidence_json TEXT NOT NULL, original_row_json TEXT NOT NULL, repaired_at_utc TEXT NOT NULL)""")


def repair_kinetic_references(conn: sqlite3.Connection, source: sqlite3.Connection) -> int:
    ensure_reference_audit(conn)
    cur = conn.execute("""SELECT k.* FROM web_kinetics k WHERE NOT EXISTS (
        SELECT 1 FROM web_enzymes e JOIN web_reaction_enzymes re USING(biopart_id)
        WHERE e.biopart_id=k.biopart_id AND re.reaction_id=k.reaction_id)""")
    columns = [d[0] for d in cur.description]
    changes = 0
    for values in cur.fetchall():
        row = dict(zip(columns, values))
        target, evidence = canonical_kinetic_biopart(conn, source, row["biopart_id"], row["reaction_id"])
        conn.execute("INSERT INTO web_kinetics_reference_repairs VALUES (?,?,?,?,?,?,?)",
            (row["kinetic_id"], row["biopart_id"], target, row["reaction_id"],
             json.dumps(evidence, ensure_ascii=False, sort_keys=True), json.dumps(row, ensure_ascii=False, sort_keys=True), utc_now()))
        conn.execute("UPDATE web_kinetics SET biopart_id=? WHERE kinetic_id=?", (target, row["kinetic_id"]))
        changes += 1
    return changes


def install_kinetic_reference_guards(conn: sqlite3.Connection) -> None:
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_web_kinetics_unique_id ON web_kinetics(kinetic_id)")
    for event, suffix in [("INSERT", "insert"), ("UPDATE OF reaction_id,biopart_id,compound_id", "update")]:
        conn.execute(f"""CREATE TRIGGER IF NOT EXISTS web_kinetics_reference_{suffix}
        BEFORE {event} ON web_kinetics BEGIN
        SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM web_reactions WHERE reaction_id=NEW.reaction_id)
          OR NOT EXISTS (SELECT 1 FROM web_enzymes WHERE biopart_id=NEW.biopart_id)
          OR NOT EXISTS (SELECT 1 FROM web_reaction_enzymes WHERE reaction_id=NEW.reaction_id AND biopart_id=NEW.biopart_id)
          OR (NEW.compound_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM web_reaction_compounds WHERE compound_id=NEW.compound_id))
        THEN RAISE(ABORT, 'kinetic reference must resolve to published reaction/enzyme/pair/compound') END;
        END""")


def add_model_direction_fields(main: sqlite3.Connection, model: sqlite3.Connection, schema: str = "main") -> int:
    if schema not in {"main", "model"}:
        raise ValueError("Unsupported model schema")
    table = f"{schema}.model_ready_reactions"
    columns = {r[1] for r in model.execute(f"PRAGMA {schema}.table_info(model_ready_reactions)")}
    for col in ("source_direction", "normalized_direction", "reversibility_status", "direction_normalization_rule"):
        if col not in columns:
            model.execute(f"ALTER TABLE {table} ADD COLUMN {col} TEXT")
    changes = 0
    for rid, arrow in main.execute("SELECT reaction_id,reaction_direction FROM web_reactions"):
        expected = (arrow, *direction_fields(arrow))
        prior = model.execute(f"SELECT source_direction,normalized_direction,reversibility_status,direction_normalization_rule FROM {table} WHERE reaction_id=?", (rid,)).fetchone()
        if prior is None:
            raise ValueError(f"Missing model reaction: {rid}")
        if tuple(prior) != expected:
            model.execute(f"UPDATE {table} SET source_direction=?,normalized_direction=?,reversibility_status=?,direction_normalization_rule=? WHERE reaction_id=?", (*expected, rid))
            changes += 1
    return changes
