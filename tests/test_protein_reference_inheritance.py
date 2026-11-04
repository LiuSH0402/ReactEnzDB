import csv
import json
import io
import sqlite3
import sys
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from protein_reference_inheritance import identity, install_plan, restore_inherited_references, SCOPE
from enrich_web_evidence import build_references


class InheritanceTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript('''
          CREATE TABLE web_enzymes(biopart_id TEXT PRIMARY KEY,protein_sequence TEXT,taxonomy_id TEXT);
          INSERT INTO web_enzymes VALUES ('kept','ACDEFG','9606');
          CREATE TABLE web_entity_references(reference_id INTEGER,entity_type TEXT,entity_id TEXT,
            pmid TEXT,citation_text TEXT,reference_url TEXT,source_db TEXT);
          INSERT INTO web_entity_references VALUES (1,'enzyme','kept','123','Existing',NULL,'RDBSB');
        ''')
        seq, tax = identity('ACDEFG', '9606')
        self.record = dict(target_biopart_id='kept',pmid='456',source_snapshot='archive',
            source_biopart_id='omitted',source_reference_id=22,source_db='RDBSB',citation_text='Original citation',
            reference_url='https://pubmed.ncbi.nlm.nih.gov/456/',sequence_sha256=seq,taxonomy_id=tax,
            canonical_protein_key='key',evidence_scope=SCOPE,source_reference_json=json.dumps({'reference_id':22}),
            recovery_revision='test')

    def tearDown(self):
        self.conn.close()

    def test_preserves_existing_and_is_idempotent_with_row_factory(self):
        self.assertEqual(install_plan(self.conn,[self.record]),1)
        self.assertEqual(install_plan(self.conn,[self.record]),0)
        self.assertEqual(restore_inherited_references(self.conn),0)
        self.assertEqual(self.conn.execute('SELECT count(*) FROM web_entity_references').fetchone()[0],2)
        self.assertEqual(tuple(self.conn.execute('SELECT * FROM web_entity_references WHERE reference_id=1').fetchone()),
                         (1,'enzyme','kept','123','Existing',None,'RDBSB'))

    def test_multiple_old_origins_do_not_duplicate_link(self):
        other = dict(self.record,source_reference_id=23,source_biopart_id='omitted2')
        self.assertEqual(install_plan(self.conn,[self.record,other]),1)
        self.assertEqual(self.conn.execute('SELECT count(*) FROM web_protein_reference_inheritance').fetchone()[0],2)

    def test_existing_pmid_keeps_original_citation(self):
        self.assertEqual(install_plan(self.conn,[dict(self.record,pmid='123')]),0)
        self.assertEqual(self.conn.execute('SELECT citation_text FROM web_entity_references').fetchone()[0],'Existing')

    def test_taxonomy_change_rejected_before_rebuild(self):
        install_plan(self.conn,[self.record])
        self.conn.execute("UPDATE web_enzymes SET taxonomy_id='10090'")
        with self.assertRaises(ValueError):build_references(self.conn,Path('unused'),set(),{'kept'})
        self.assertEqual(self.conn.execute('SELECT count(*) FROM web_entity_references').fetchone()[0],2)

    def test_sequence_change_rejected(self):
        install_plan(self.conn,[self.record])
        self.conn.execute("UPDATE web_enzymes SET protein_sequence='ACDEFA'")
        with self.assertRaises(ValueError):restore_inherited_references(self.conn)

    def test_no_partial_install_when_transaction_rolled_back(self):
        self.conn.commit()
        with self.assertRaises(ValueError):
            with self.conn:install_plan(self.conn,[dict(self.record,taxonomy_id='10090')])
        self.assertEqual(self.conn.execute('SELECT count(*) FROM web_entity_references').fetchone()[0],1)

    def test_provenance_conflict_rejected(self):
        install_plan(self.conn,[self.record])
        with self.assertRaises(ValueError):install_plan(self.conn,[dict(self.record,citation_text='Changed')])

    def test_scope_and_invalid_pmid_rejected(self):
        for change in [{'evidence_scope':'reaction_evidence'},{'pmid':'not-a-pmid'}]:
            with self.assertRaises(ValueError):
                with self.conn:install_plan(self.conn,[dict(self.record,**change)])

    def test_ambiguous_sequence_or_missing_taxonomy_rejected(self):
        for seq,tax in [('ACX','9606'),('ACD',''),('ACD','human'),('ACD','0')]:
            with self.assertRaises(ValueError):identity(seq,tax)

    def test_rebuild_replays_audited_inheritance(self):
        install_plan(self.conn,[self.record])
        data=io.StringIO()
        writer=csv.DictWriter(data,fieldnames=['reference_id','entity_type','entity_id','pmid','citation_text','reference_url','source_db'])
        writer.writeheader();writer.writerow(dict(reference_id=1,entity_type='biopart',entity_id='kept',pmid='123',citation_text='Existing',source_db='RDBSB'))
        with patch.object(Path,'open',side_effect=lambda *args,**kwargs:io.StringIO(data.getvalue())):
            build_references(self.conn,Path('unused'),set(),{'kept'})
            build_references(self.conn,Path('unused'),set(),{'kept'})
        self.assertEqual({r[0] for r in self.conn.execute('SELECT pmid FROM web_entity_references')},{'123','456'})
        self.assertEqual(self.conn.execute('SELECT count(*) FROM web_entity_references').fetchone()[0],2)

    def test_fresh_build_can_load_external_recovery_plan(self):
        csv_data='reference_id,entity_type,entity_id,pmid,citation_text,reference_url,source_db\n1,biopart,kept,123,Existing,,RDBSB\n'
        with patch.object(Path,'open',side_effect=lambda *args,**kwargs:io.StringIO(csv_data)):
            build_references(self.conn,Path('unused'),set(),{'kept'},[self.record])
        self.assertEqual({r[0] for r in self.conn.execute('SELECT pmid FROM web_entity_references')},{'123','456'})


if __name__=='__main__':unittest.main()
