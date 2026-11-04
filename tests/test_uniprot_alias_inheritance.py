import io,json,sqlite3,sys,unittest
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from protein_reference_inheritance import identity
from uniprot_alias_inheritance import install_alias_plan,restore_aliases,SCOPE
from enrich_web_evidence import build_xrefs
from build_evidence_scores import enzyme_xref_database_counts


class AliasInheritanceTests(unittest.TestCase):
    def setUp(self):
        self.conn=sqlite3.connect(':memory:');self.conn.row_factory=sqlite3.Row
        self.conn.executescript('''CREATE TABLE web_enzymes(biopart_id TEXT,protein_sequence TEXT,taxonomy_id TEXT);
          INSERT INTO web_enzymes VALUES ('kept','ACDEFG','9606');
          CREATE TABLE web_xrefs(entity_type TEXT,entity_id TEXT,xref_db TEXT,xref_value TEXT,xref_url TEXT,source_db TEXT);
          INSERT INTO web_xrefs VALUES ('enzyme','kept','UniProt','P12345','original','RDBSB');''')
        seq,tax=identity('ACDEFG','9606')
        self.row=dict(target_biopart_id='kept',old_accession='Q12345',current_primary='P12345',xref_db='UniProt_secondary',
          sequence_sha256=seq,taxonomy_id=tax,canonical_protein_key='key',source_biopart_id='omitted',source_xref_id=123,
          source_xref_json='{}',source_snapshot_xref_sha256='snapshot',verification_status='verified_merged_secondary_accession',
          official_release='2026_03',official_resolution_path=json.dumps(['Q12345','P12345']),
          official_sequence_sha256=seq,official_taxonomy_id=tax,official_cache_files='[]',scope=SCOPE,
          taxonomy_resolution_path=json.dumps([tax]),official_taxonomy_merge_evidence_sha256='')
    def tearDown(self):self.conn.close()

    def test_secondary_role_and_existing_primary_preserved(self):
        self.assertEqual(install_alias_plan(self.conn,[self.row]),1)
        added=self.conn.execute("SELECT xref_db,xref_value FROM web_xrefs WHERE xref_value='Q12345'").fetchone()
        self.assertEqual(tuple(added),('UniProt_secondary','Q12345'))
        self.assertEqual(tuple(self.conn.execute("SELECT * FROM web_xrefs WHERE xref_value='P12345'").fetchone()),
                         ('enzyme','kept','UniProt','P12345','original','RDBSB'))

    def test_duplicate_plan_and_replay_are_idempotent(self):
        self.assertEqual(install_alias_plan(self.conn,[self.row]),1)
        self.assertEqual(install_alias_plan(self.conn,[self.row]),0)
        self.assertEqual(restore_aliases(self.conn),0)

    def test_current_sequence_change_rejected(self):
        install_alias_plan(self.conn,[self.row]);self.conn.execute("UPDATE web_enzymes SET protein_sequence='ACDEFA'")
        with self.assertRaises(ValueError):restore_aliases(self.conn)

    def test_taxonomy_and_official_identity_mismatch_rejected(self):
        for change in [{'taxonomy_id':'10090'},{'official_taxonomy_id':'10090'}]:
            with self.assertRaises(ValueError):install_alias_plan(self.conn,[dict(self.row,**change)])

    def test_split_unverified_cannot_be_installed(self):
        with self.assertRaises(ValueError):install_alias_plan(self.conn,[dict(self.row,verification_status='official_split_requires_review')])

    def test_secondary_cannot_be_presented_as_current_primary(self):
        with self.assertRaises(ValueError):install_alias_plan(self.conn,[dict(self.row,xref_db='UniProt')])

    def test_wrong_resolution_path_rejected(self):
        with self.assertRaises(ValueError):install_alias_plan(self.conn,[dict(self.row,official_resolution_path='["P12345"]')])

    def test_official_taxonomy_merge_keeps_original_local_taxon(self):
        row=dict(self.row,verification_status='verified_merged_secondary_accession_taxonomy_merged',
                 official_taxonomy_id='10090',taxonomy_resolution_path='["9606","10090"]',
                 official_taxonomy_merge_evidence_sha256='a'*64)
        self.assertEqual(install_alias_plan(self.conn,[row]),1)
        self.assertEqual(self.conn.execute('SELECT taxonomy_id FROM web_enzymes').fetchone()[0],'9606')

    def test_taxonomy_merge_label_without_proof_rejected(self):
        row=dict(self.row,verification_status='verified_merged_secondary_accession_taxonomy_merged',official_taxonomy_id='10090')
        with self.assertRaises(ValueError):install_alias_plan(self.conn,[row])

    def test_existing_alias_in_different_case_not_duplicated(self):
        self.conn.execute("INSERT INTO web_xrefs VALUES ('enzyme','kept','uniprot','Q12345','original','RDBSB')")
        self.assertEqual(install_alias_plan(self.conn,[self.row]),0)

    def test_evidence_rebuild_loads_and_replays_external_alias_plan(self):
        data='entity_type,entity_id,xref_db,xref_value,xref_url,source_db\n'
        with patch.object(Path,'open',side_effect=lambda *args,**kwargs:io.StringIO(data)):
            build_xrefs(self.conn,Path('unused'),set(),{'kept'},[self.row])
            build_xrefs(self.conn,Path('unused'),set(),{'kept'})
        self.assertEqual(self.conn.execute('SELECT count(*) FROM web_xrefs').fetchone()[0],2)

    def test_alias_roles_do_not_increase_independent_database_count(self):
        install_alias_plan(self.conn,[self.row])
        self.conn.execute("INSERT INTO web_xrefs VALUES ('enzyme','kept','uniprot','Q12346','url','source')")
        self.conn.execute("INSERT INTO web_xrefs VALUES ('enzyme','kept','PDB','1AAA','url','source')")
        self.assertEqual(enzyme_xref_database_counts(self.conn.cursor()),{'kept':2})


if __name__=='__main__':unittest.main()
