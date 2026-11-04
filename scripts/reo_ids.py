from __future__ import annotations

import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


REO_ID_PATTERN = re.compile(r"^REO(\d{6,})$")


def connect_registry(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = FULL")
    conn.execute("PRAGMA busy_timeout = 30000")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS reo_ids (
            reo_id TEXT PRIMARY KEY,
            reaction_id TEXT NOT NULL,
            biopart_id TEXT NOT NULL,
            organism_key TEXT NOT NULL,
            organism TEXT,
            created_release TEXT,
            created_at TEXT NOT NULL,
            UNIQUE (reaction_id, biopart_id, organism_key)
        );
        CREATE TABLE IF NOT EXISTS metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        """
    )
    conn.execute(
        "INSERT OR REPLACE INTO metadata(key, value) VALUES ('id_policy', ?)",
        ("Permanent monotonic REO identifiers; retired identifiers are never reassigned.",),
    )
    conn.commit()
    return conn


def _has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    return any(str(row[1]) == column for row in conn.execute(f'PRAGMA table_info("{table}")'))


def _numeric_id(reo_id: str) -> int:
    match = REO_ID_PATTERN.fullmatch(reo_id)
    if not match:
        raise ValueError(f"Invalid permanent R-E-O identifier in registry: {reo_id}")
    return int(match.group(1))


def seed_registry_from_release(release_db: Path, registry_path: Path, release_version: str | None = None) -> int:
    """Preserve the identifiers from an existing release before it is rebuilt.

    Legacy releases are seeded from their then-public rowid-derived identifiers once.
    After this migration, rowid is never consulted again.
    """
    if not release_db.exists():
        return 0
    release = sqlite3.connect(f"file:{release_db.as_posix()}?mode=ro", uri=True)
    try:
        table_exists = release.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='web_reaction_enzymes'"
        ).fetchone()
        if not table_exists:
            return 0
        id_expression = "reo_id" if _has_column(release, "web_reaction_enzymes", "reo_id") else "printf('REO%06d', rowid)"
        rows = list(release.execute(
            f"""
            SELECT {id_expression} AS reo_id, reaction_id, biopart_id,
                   COALESCE(organism, '') AS organism_key, organism
            FROM web_reaction_enzymes
            ORDER BY rowid
            """
        ))
        registry = connect_registry(registry_path)
        try:
            now = datetime.now(timezone.utc).isoformat()
            by_key = {
                (row["reaction_id"], row["biopart_id"], row["organism_key"]): row["reo_id"]
                for row in registry.execute("SELECT reo_id, reaction_id, biopart_id, organism_key FROM reo_ids")
            }
            by_id = {value: key for key, value in by_key.items()}
            pending = []
            for row in rows:
                reo_id, reaction_id, biopart_id, organism_key, organism = row
                key = (reaction_id, biopart_id, organism_key)
                if key in by_key and by_key[key] != reo_id:
                    raise RuntimeError(f"Relation {key!r} is already assigned to {by_key[key]}, not {reo_id}")
                if reo_id in by_id and by_id[reo_id] != key:
                    raise RuntimeError(f"{reo_id} is already assigned to {by_id[reo_id]!r}, not {key!r}")
                if key not in by_key:
                    pending.append((reo_id, reaction_id, biopart_id, organism_key, organism, release_version, now))
                    by_key[key] = reo_id
                    by_id[reo_id] = key
            registry.executemany(
                """
                INSERT OR IGNORE INTO reo_ids(
                    reo_id, reaction_id, biopart_id, organism_key, organism, created_release, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                pending,
            )
            registry.commit()
            return len(pending)
        finally:
            registry.close()
    finally:
        release.close()


def assign_reo_ids(
    release: sqlite3.Connection,
    registry_path: Path,
    release_version: str | None = None,
) -> dict[str, int]:
    """Assign registry-backed IDs to every current relation and persist them in the release table."""
    registry = connect_registry(registry_path)
    try:
        existing = {
            (row["reaction_id"], row["biopart_id"], row["organism_key"]): row["reo_id"]
            for row in registry.execute(
                "SELECT reo_id, reaction_id, biopart_id, organism_key FROM reo_ids"
            )
        }
        max_number = max((_numeric_id(value) for value in existing.values()), default=0)
        current = [
            (str(row[0]), str(row[1]), str(row[2] or ""), row[3])
            for row in release.execute(
                """
                SELECT reaction_id, biopart_id, COALESCE(organism, '') AS organism_key, organism
                FROM web_reaction_enzymes
                ORDER BY reaction_id, biopart_id, organism_key
                """
            )
        ]
        now = datetime.now(timezone.utc).isoformat()
        new_rows: list[tuple[str, str, str, str, object, str | None, str]] = []
        for reaction_id, biopart_id, organism_key, organism in current:
            key = (reaction_id, biopart_id, organism_key)
            if key in existing:
                continue
            max_number += 1
            reo_id = f"REO{max_number:06d}"
            existing[key] = reo_id
            new_rows.append((reo_id, reaction_id, biopart_id, organism_key, organism, release_version, now))
        if new_rows:
            registry.executemany(
                """
                INSERT INTO reo_ids(
                    reo_id, reaction_id, biopart_id, organism_key, organism, created_release, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                new_rows,
            )
            registry.commit()
    finally:
        registry.close()

    if not _has_column(release, "web_reaction_enzymes", "reo_id"):
        release.execute("ALTER TABLE web_reaction_enzymes ADD COLUMN reo_id TEXT")
    release.executescript(
        """
        DROP TABLE IF EXISTS temp.reo_assignment;
        CREATE TEMP TABLE reo_assignment (
            reo_id TEXT PRIMARY KEY,
            reaction_id TEXT NOT NULL,
            biopart_id TEXT NOT NULL,
            organism_key TEXT NOT NULL,
            UNIQUE (reaction_id, biopart_id, organism_key)
        );
        """
    )
    release.executemany(
        """
        INSERT INTO reo_assignment(reo_id, reaction_id, biopart_id, organism_key)
        VALUES (?, ?, ?, ?)
        """,
        ((existing[(reaction_id, biopart_id, organism_key)], reaction_id, biopart_id, organism_key)
         for reaction_id, biopart_id, organism_key, _organism in current),
    )
    release.execute(
        """
        UPDATE web_reaction_enzymes AS re
        SET reo_id = (
            SELECT a.reo_id
            FROM reo_assignment a
            WHERE a.reaction_id = re.reaction_id
              AND a.biopart_id = re.biopart_id
              AND a.organism_key = COALESCE(re.organism, '')
        )
        """
    )
    release.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_web_reaction_enzymes_reo_id ON web_reaction_enzymes(reo_id)"
    )
    release.commit()

    total, missing, distinct_ids = release.execute(
        """
        SELECT COUNT(*),
               SUM(CASE WHEN reo_id IS NULL OR substr(reo_id, 1, 3) <> 'REO'
                         OR length(reo_id) < 9 OR substr(reo_id, 4) GLOB '*[^0-9]*'
                        THEN 1 ELSE 0 END),
               COUNT(DISTINCT reo_id)
        FROM web_reaction_enzymes
        """
    ).fetchone()
    if missing or total != distinct_ids:
        raise RuntimeError(
            f"R-E-O assignment validation failed: total={total}, missing_or_invalid={missing}, distinct={distinct_ids}"
        )
    return {"current": int(total), "new": len(new_rows), "registry": len(existing)}
