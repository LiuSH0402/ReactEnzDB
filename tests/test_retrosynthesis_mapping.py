"""Small chemical controls for the production matcher; no release writes."""
import importlib.util
from pathlib import Path
import sqlite3
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "nextjs_site/Nicktio-nextjs-pro-main/package/scripts/retrosynthesis_mapping.py"
spec = importlib.util.spec_from_file_location("mapping", SCRIPT)
mapping = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mapping)


class MappingControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = ROOT / "nextjs_site/Nicktio-nextjs-pro-main/package/runtime" / ("mapping-test-" + uuid.uuid4().hex)
        cls.folder.mkdir(parents=True)
        cls.source, cls.index = cls.folder / "source.sqlite", cls.folder / "lookup.sqlite"
        conn = sqlite3.connect(cls.source)
        conn.executescript("""
          CREATE TABLE web_reactions(reaction_id TEXT,reaction_direction TEXT,reaction_equation_display TEXT,all_participants_have_smiles INTEGER);
          CREATE TABLE web_reaction_compounds(reaction_id TEXT,side TEXT,smiles TEXT,compound_name TEXT,stoichiometry TEXT);
        """)
        cls.amino = "N[C@@H](Cc1ccccc1)C(=O)O"
        cls.acid = "O=C(O)/C=C/c1ccccc1"
        charged_amino = "[NH3+][C@@H](Cc1ccccc1)C(=O)[O-]"
        charged_acid = "O=C([O-])/C=C/c1ccccc1"
        fixtures = [
            ("pal", "=>", [("left", charged_amino), ("right", charged_acid), ("right", "[NH4+]")]),
            ("pal_reverse_only", "<=", [("left", charged_amino), ("right", charged_acid)]),
            ("pal_unknown", "=", [("left", charged_amino), ("right", charged_acid)]),
            ("adh", "<=", [("left", "CCO"), ("right", "CC=O")]),
            ("exchange", "<=>", [("left", "CCO"), ("left", "CC=O"), ("right", "CC=O"), ("right", "CCO")]),
            ("unequal_coefficients", "=>", [("left", "CCC"), ("left", "CC=C"), ("right", "CCC"), ("right", "CC=C")]),
        ]
        for rid, direction, participants in fixtures:
            conn.execute("INSERT INTO web_reactions VALUES (?,?,?,1)", (rid, direction, rid))
            conn.executemany("INSERT INTO web_reaction_compounds VALUES (?,?,?,?,NULL)", ((rid, side, smiles, smiles) for side, smiles in participants))
        conn.execute("UPDATE web_reaction_compounds SET stoichiometry='2' WHERE reaction_id='unequal_coefficients' AND side='left' AND smiles='CCC'")
        conn.commit()
        conn.close()
        mapping.build_index(cls.source, cls.index)

    @classmethod
    def tearDownClass(cls):
        for file in cls.folder.iterdir():
            file.unlink()
        cls.folder.rmdir()

    def query(self, left, right, limit=5):
        return mapping.match(self.index, {"precursors": left, "product": right}, limit)

    def test_protonation_and_missing_participants_are_explicit(self):
        result = self.query(self.amino, self.acid)
        row = next(row for row in result["matches"] if row["reaction_id"] == "pal")
        self.assertEqual(row["match_basis"], "protonation_normalized")
        self.assertEqual(row["additional_participants"]["products"][0]["smiles"], "[NH4+]")
        self.assertFalse(row["accepted_reaction_identity"])
        self.assertIn({"reaction_id": "pal_reverse_only", "reason": "opposes_reference_direction"}, result["excluded"])
        unknown = next(row for row in result["matches"] if row["reaction_id"] == "pal_unknown")
        self.assertEqual(unknown["direction_status"], "unspecified")

    def test_stereochemistry_and_isotopes_are_not_inferred(self):
        self.assertFalse(self.query(self.amino.replace("@@", "@"), self.acid)["matches"])
        self.assertFalse(self.query(self.amino.replace("[C@@H]", "C"), self.acid)["matches"])
        self.assertFalse(self.query("[13CH3]C=O", "CCO")["matches"])

    def test_reverse_direction_and_transport(self):
        result = self.query("CC=O", "CCO")
        self.assertEqual([row["reaction_id"] for row in result["matches"]], ["adh"])
        self.assertEqual(result["matches"][0]["orientation"], "reversed")
        self.assertIn({"reaction_id": "exchange", "reason": "no_net_chemical_change_transport_or_exchange"}, result["excluded"])
        self.assertFalse(self.query("CCO", "CC=O")["matches"])

    def test_invalid_wildcard_and_unchanged_queries(self):
        for value in ("not-smiles!", "*CC", "CC."):
            self.assertEqual(self.query(value, "CCO")["status"], "invalid_or_wildcard_structure")
        self.assertEqual(self.query("CC(=O)[O-]", "CC(=O)O")["status"], "no_net_query_transformation")

    def test_truncation_keeps_true_ambiguity_count(self):
        result = self.query(self.amino, self.acid, limit=1)
        self.assertEqual(result["total_matches"], 2)
        self.assertTrue(result["truncated"])
        self.assertEqual(len(result["matches"]), 1)

    def test_equal_structure_sets_with_unequal_coefficients_are_not_transport(self):
        result = self.query("CCC", "CC=C")
        self.assertEqual([row["reaction_id"] for row in result["matches"]], ["unequal_coefficients"])


if __name__ == "__main__":
    unittest.main()
