from __future__ import annotations

import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from reo_ids import assign_reo_ids  # noqa: E402


def create_relations(conn: sqlite3.Connection, rows: list[tuple[str, str, str | None]]) -> None:
    conn.execute(
        "CREATE TABLE web_reaction_enzymes (reaction_id TEXT, biopart_id TEXT, organism TEXT)"
    )
    conn.executemany(
        "INSERT INTO web_reaction_enzymes(reaction_id, biopart_id, organism) VALUES (?, ?, ?)", rows
    )


class PermanentReoIdTests(unittest.TestCase):
    def test_ids_survive_row_reordering_and_are_never_reassigned(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            registry = Path(tmp) / "reo_id_registry.sqlite"
            conn = sqlite3.connect(":memory:")
            create_relations(conn, [("R2", "E2", "Org B"), ("R1", "E1", "Org A")])
            assign_reo_ids(conn, registry, "v1")
            first = {
                tuple(row[:3]): row[3]
                for row in conn.execute(
                    "SELECT reaction_id, biopart_id, organism, reo_id FROM web_reaction_enzymes"
                )
            }

            conn.execute("DROP TABLE web_reaction_enzymes")
            create_relations(
                conn,
                [("R0", "E0", None), ("R1", "E1", "Org A"), ("R2", "E2", "Org B")],
            )
            result = assign_reo_ids(conn, registry, "v2")
            second = {
                tuple(row[:3]): row[3]
                for row in conn.execute(
                    "SELECT reaction_id, biopart_id, organism, reo_id FROM web_reaction_enzymes"
                )
            }

            self.assertEqual(second[("R1", "E1", "Org A")], first[("R1", "E1", "Org A")])
            self.assertEqual(second[("R2", "E2", "Org B")], first[("R2", "E2", "Org B")])
            self.assertEqual(second[("R0", "E0", None)], "REO000003")
            self.assertEqual(result["new"], 1)

            conn.execute("DROP TABLE web_reaction_enzymes")
            create_relations(conn, [("R1", "E1", "Org A")])
            assign_reo_ids(conn, registry, "v3")
            registry_db = sqlite3.connect(registry)
            try:
                self.assertEqual(registry_db.execute("SELECT COUNT(*) FROM reo_ids").fetchone()[0], 3)
            finally:
                registry_db.close()
            conn.close()


if __name__ == "__main__":
    unittest.main()
