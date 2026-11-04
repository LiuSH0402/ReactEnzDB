#!/usr/bin/env python3
"""Synchronize corrected source metadata into the standardization release.

Participant structures and atom mappings are preserved because the QC audit
confirmed that the row-alignment defect affected display equation/direction/EC
fields, not structured reaction participants.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from data_semantics import direction_fields


ROOT = Path(__file__).resolve().parents[1]
CORE = ROOT / "web_release" / "reactenzdb_web.db"
STANDARD = ROOT / "web_release" / "reaction_standardization.sqlite"
SUMMARY = ROOT / "web_release" / "reaction_standardization.summary.json"


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    if not CORE.exists() or not STANDARD.exists():
        raise FileNotFoundError("Core or standardization release is missing")
    core = sqlite3.connect(f"file:{CORE.resolve().as_posix()}?mode=ro", uri=True)
    core.row_factory = sqlite3.Row
    standard = sqlite3.connect(str(STANDARD), timeout=60)
    standard.row_factory = sqlite3.Row
    standard.execute("PRAGMA busy_timeout=60000")

    core_count = core.execute("SELECT COUNT(*) FROM web_reactions").fetchone()[0]
    standard_count = standard.execute("SELECT COUNT(*) FROM reaction_inputs").fetchone()[0]
    if core_count != 19623 or standard_count != core_count:
        raise RuntimeError(f"Reaction scope mismatch: core={core_count}, standard={standard_count}")
    participant_mismatches = core.execute(
        """
        SELECT COUNT(*) FROM web_reactions r
        JOIN web_reaction_ids ids USING(reaction_id)
        """
    ).fetchone()[0] - core_count
    if participant_mismatches:
        raise RuntimeError("Stable reaction IDs are incomplete")

    rows = core.execute(
        """
        SELECT r.*, ids.reactenz_reaction_id,
               (SELECT GROUP_CONCAT(mnx_reaction_id, ';')
                FROM web_mnx_reaction_mappings m
                WHERE m.reaction_id=r.reaction_id) AS mnx_reaction_ids
        FROM web_reactions r
        JOIN web_reaction_ids ids USING(reaction_id)
        ORDER BY r.reaction_id
        """
    ).fetchall()
    timestamp = now()
    input_updates = []
    direction_updates = []
    for row in rows:
        payload = json.dumps(dict(row), ensure_ascii=False, sort_keys=True, default=str)
        input_updates.append(
            (
                row["reactenz_reaction_id"], row["reaction_equation_display"],
                row["reaction_direction"], row["ec_number"], row["rhea_id"],
                row["kegg_reaction_id"], row["metacyc_reaction_id"],
                row["mnx_reaction_ids"], row["participant_count"],
                int(bool(row["all_participants_have_smiles"])),
                hashlib.sha256(payload.encode("utf-8")).hexdigest(), timestamp,
                row["reaction_id"],
            )
        )
        direction_updates.append((*direction_fields(row["reaction_direction"]), timestamp, row["reaction_id"]))

    standard.execute("BEGIN IMMEDIATE")
    try:
        standard.executemany(
            """
            UPDATE reaction_inputs SET
                reactenz_reaction_id=?, source_equation=?, source_direction=?,
                ec_number=?, rhea_id=?, kegg_reaction_id=?, metacyc_reaction_id=?,
                mnx_reaction_ids=?, participant_count=?, complete_structure=?,
                input_snapshot_sha256=?, imported_at=?
            WHERE reaction_id=?
            """,
            input_updates,
        )
        standard.executemany(
            """
            UPDATE standardized_reactions SET
                normalized_direction=?, reversibility_status=?,
                direction_normalization_rule=?, updated_at=?
            WHERE reaction_id=?
            """,
            direction_updates,
        )
        standard.execute(
            "INSERT INTO release_metadata(key,value) VALUES ('release_version','2026.08.1') ON CONFLICT(key) DO UPDATE SET value=excluded.value"
        )
        standard.execute(
            "INSERT INTO release_metadata(key,value) VALUES ('source_core_qc_release','2026.08-qc') ON CONFLICT(key) DO UPDATE SET value=excluded.value"
        )
        standard.execute(
            "INSERT INTO release_metadata(key,value) VALUES ('source_metadata_synced_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (timestamp,),
        )
        standard.commit()
    except Exception:
        standard.rollback()
        raise

    checks = {
        "reaction_inputs": standard.execute("SELECT COUNT(*) FROM reaction_inputs").fetchone()[0],
        "standardized_reactions": standard.execute("SELECT COUNT(*) FROM standardized_reactions").fetchone()[0],
        "identity_rows_matching_core": standard.execute(
            """
            SELECT COUNT(*) FROM reaction_inputs i
            WHERE EXISTS (
                SELECT 1 FROM reaction_inputs i2
                WHERE i2.reaction_id=i.reaction_id
            )
            """
        ).fetchone()[0],
        "integrity": standard.execute("PRAGMA integrity_check").fetchone()[0],
    }
    tables = {
        row[0]: standard.execute(f"SELECT COUNT(*) FROM {row[0]}").fetchone()[0]
        for row in standard.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    }
    standard.close()
    core.close()
    summary = {
        "release_version": "2026.08.1",
        "generated_at": timestamp,
        "source_core": CORE.name,
        "source_core_sha256": sha256(CORE),
        "standardization_sha256": sha256(STANDARD),
        "metadata_sync_policy": "Corrected source equation/direction/EC synchronized; structured participants and atom mappings preserved after scope validation.",
        "checks": checks,
        "tables": tables,
    }
    SUMMARY.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary["checks"], ensure_ascii=False))
    if checks["integrity"] != "ok" or checks["reaction_inputs"] != 19623 or checks["standardized_reactions"] != 19623:
        raise SystemExit("Standardization synchronization failed")


if __name__ == "__main__":
    main()
