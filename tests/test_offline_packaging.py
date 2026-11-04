"""Boundary controls for the extracted offline processors (synthetic identities only)."""
import ast
import json
import sqlite3
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))
from processing.scope_filter import sets, hidden_value, row_hidden
from processing.protein_domains import set_local_isoform_sequences, cached_isoform_sequence
from check_runtime_inputs import inspect

class OfflineBoundaries(unittest.TestCase):
    def setUp(self):
        self.scope = sets({"hidden_reactions": [{"reaction_id": "SYNTH_RX_HIDDEN", "public_id": "SYNTH_PUBLIC_HIDDEN"}],
            "held_identifier_pairs": [{"biopart_id": "SYNTH_ENZ_HELD", "accession": "SYNTH_ACC"}]})

    def test_source_identifier_namespace_does_not_become_internal_reaction_identity(self):
        self.assertTrue(hidden_value("reaction_id", "SYNTH_RX_HIDDEN", self.scope))
        self.assertFalse(hidden_value("source_reaction_id", "SYNTH_RX_HIDDEN", self.scope))

    def test_held_accession_is_scoped_to_its_protein_not_every_protein(self):
        self.assertTrue(row_hidden({"biopart_id":"SYNTH_ENZ_HELD","accession":"SYNTH_ACC"},self.scope))
        self.assertFalse(row_hidden({"biopart_id":"SYNTH_OTHER","accession":"SYNTH_ACC"},self.scope))

    def test_missing_isoform_stays_unresolved_and_never_uses_a_guess(self):
        set_local_isoform_sequences({"SYNTH_REF-2": "AAAACCCC"})
        self.assertEqual(cached_isoform_sequence("SYNTH_REF-2"), "AAAACCCC")
        self.assertEqual(cached_isoform_sequence("SYNTH_REF-3"), "")
        set_local_isoform_sequences({})
        self.assertEqual(cached_isoform_sequence("SYNTH_REF-2"), "")

    def test_missing_runtime_data_are_not_accepted_as_complete_inputs(self):
        result = inspect(ROOT / "data" / "SYNTH_ABSENT_CORE.db")
        self.assertFalse(result["full_evidence_workflow_inputs_present"])
        self.assertFalse(result["core_compatible"])

    def test_offline_processing_contains_no_collection_clients(self):
        forbidden = {"requests", "httpx", "paramiko", "urllib.request"}
        for path in (ROOT / "processing").rglob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                modules = []
                if isinstance(node, ast.Import):
                    modules = [a.name for a in node.names]
                elif isinstance(node, ast.ImportFrom):
                    modules = [node.module or ""]
                self.assertFalse(set(modules) & forbidden, str(path))

if __name__ == "__main__":
    unittest.main()
