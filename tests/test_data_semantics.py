import hashlib
import json
import sqlite3
import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from data_semantics import (add_model_direction_fields, canonical_kinetic_biopart,
    direction_fields, install_kinetic_reference_guards, normalize_kinetic_source,
    normalize_kinetic_sources, repair_kinetic_references)
from repair_confirmed_data_defects import refresh_kinetic_scores
from collections import defaultdict


class SemanticsTests(unittest.TestCase):
    def setUp(self):
        self.core=sqlite3.connect(':memory:')
        self.source=sqlite3.connect(':memory:')
        self.core.executescript('''
            CREATE TABLE web_reactions(reaction_id TEXT,reaction_direction TEXT);
            CREATE TABLE web_enzymes(biopart_id TEXT,protein_sequence TEXT,organism TEXT,taxonomy_id TEXT);
            CREATE TABLE web_reaction_enzymes(reaction_id TEXT,biopart_id TEXT);
            CREATE TABLE web_reaction_compounds(compound_id TEXT);
            CREATE TABLE web_kinetics(kinetic_id TEXT,reaction_id TEXT,biopart_id TEXT,compound_id TEXT,source_db TEXT);
            INSERT INTO web_reactions VALUES ('r','=');
            INSERT INTO web_enzymes VALUES ('representative','ABC','Species','1');
            INSERT INTO web_reaction_enzymes VALUES ('r','representative');
            INSERT INTO web_kinetics VALUES ('k','r','old',NULL,'CPD-123,MetaCyc');
        ''')
        self.source.executescript('''
            CREATE TABLE bioparts(biopart_id TEXT,protein_sequence TEXT,organism TEXT,taxonomy_id TEXT);
            CREATE TABLE temp_dedup_organism_stats(biopart_id TEXT,reaction_id TEXT,sequence_hash TEXT,organism_key TEXT);
            CREATE TABLE report_dedup_group_stats(reaction_id TEXT,sequence_hash TEXT,organism_key TEXT,representative_biopart_id TEXT);
            INSERT INTO bioparts VALUES ('old','ABC','Species','1');
        ''')
        h=hashlib.sha256(b'ABC').hexdigest()
        self.source.execute('INSERT INTO temp_dedup_organism_stats VALUES (?,?,?,?)',('old','r',h,'species'))
        self.source.execute('INSERT INTO report_dedup_group_stats VALUES (?,?,?,?)',('r',h,'species','representative'))

    def tearDown(self):
        self.core.close();self.source.close()

    def test_unspecified_and_bidirectional_are_distinct(self):
        self.assertEqual(direction_fields('=')[:2],('unspecified','unknown'))
        for arrow in ['<=>','<-->']:
            self.assertEqual(direction_fields(arrow)[:2],('bidirectional','source_bidirectional'))
        self.assertEqual(direction_fields('=>')[:2],('left_to_right','directional'))
        self.assertEqual(direction_fields('<=')[:2],('right_to_left','directional'))
        self.assertEqual(direction_fields(None)[:2],('unknown','unknown'))

    def test_source_tokens_do_not_invent_a_database_or_pmid(self):
        self.assertEqual(normalize_kinetic_source('UniProtKB/Swiss-Prot,UniProtKB'),('uniprot',[]))
        self.assertEqual(normalize_kinetic_source('CPD-123,MetaCyc'),('metacyc',['CPD-123']))
        self.assertEqual(normalize_kinetic_source('BRENDA,metacyc,brenda'),('brenda,metacyc',[]))
        self.assertEqual(normalize_kinetic_source('6918840'),('unknown',['6918840']))
        self.assertEqual(normalize_kinetic_source('not_brenda'),('unknown',['not_brenda']))

    def test_logged_alias_repairs_preserve_original_and_are_idempotent(self):
        self.assertEqual(repair_kinetic_references(self.core,self.source),1)
        self.assertEqual(repair_kinetic_references(self.core,self.source),0)
        audit=self.core.execute('SELECT original_biopart_id,representative_biopart_id,original_row_json FROM web_kinetics_reference_repairs').fetchone()
        self.assertEqual(audit[:2],('old','representative'))
        self.assertEqual(json.loads(audit[2])['biopart_id'],'old')

    def test_exact_sequence_without_dedup_log_is_rejected(self):
        self.source.execute('DELETE FROM report_dedup_group_stats')
        with self.assertRaisesRegex(ValueError,'No unique logged representative'):
            canonical_kinetic_biopart(self.core,self.source,'old','r')
        self.assertEqual(self.core.execute('SELECT biopart_id FROM web_kinetics').fetchone()[0],'old')

    def test_species_mismatch_is_rejected(self):
        self.core.execute("UPDATE web_enzymes SET organism='Other species'")
        with self.assertRaisesRegex(ValueError,'organism mismatch'):
            canonical_kinetic_biopart(self.core,self.source,'old','r')

    def test_reference_guards_reject_new_orphans(self):
        repair_kinetic_references(self.core,self.source)
        install_kinetic_reference_guards(self.core)
        for rid,bid,compound in [('missing','representative',None),('r','missing',None),('r','representative','missing')]:
            with self.assertRaises(sqlite3.IntegrityError):
                self.core.execute('INSERT INTO web_kinetics VALUES (?,?,?,?,?)',('new',rid,bid,compound,'brenda'))
        with self.assertRaises(sqlite3.IntegrityError):
            self.core.execute("UPDATE web_kinetics SET biopart_id='missing'")

    def test_normalization_keeps_raw_value_on_repeated_runs(self):
        self.assertEqual(normalize_kinetic_sources(self.core),1)
        first=self.core.execute('SELECT * FROM web_kinetics_source_provenance').fetchone()
        self.assertEqual(first[1],'CPD-123,MetaCyc')
        self.assertEqual(normalize_kinetic_sources(self.core),0)
        self.assertEqual(first,self.core.execute('SELECT * FROM web_kinetics_source_provenance').fetchone())

    def test_model_directions_preserve_features(self):
        m=sqlite3.connect(':memory:')
        m.executescript("CREATE TABLE model_ready_reactions(reaction_id TEXT,kinetics_count INTEGER,model_ready_status TEXT); INSERT INTO model_ready_reactions VALUES ('r',7,'default_trainable');")
        self.assertEqual(add_model_direction_fields(self.core,m),1)
        self.assertEqual(add_model_direction_fields(self.core,m),0)
        self.assertEqual(m.execute('SELECT kinetics_count,model_ready_status,source_direction,normalized_direction,reversibility_status FROM model_ready_reactions').fetchone(),(7,'default_trainable','=','unspecified','unknown'))
        m.close()

    def test_score_refresh_changes_only_kinetic_contribution(self):
        self.core.executescript('''
            ALTER TABLE web_reaction_enzymes ADD COLUMN organism TEXT;
            CREATE TABLE web_chassis_records(chassis_label TEXT,reaction_id TEXT,biopart_id TEXT);
            CREATE TABLE web_evidence_scores(entity_type TEXT,entity_id TEXT,evidence_score INTEGER,evidence_tier TEXT,
                publication_pmids INTEGER,field_evidences INTEGER,field_pmids INTEGER,kinetic_pmids INTEGER,
                xref_databases INTEGER,sequence_supported INTEGER,structure_supported INTEGER,context_supported INTEGER);
            INSERT INTO web_evidence_scores VALUES ('reaction','r',32,'limited',2,3,4,1,2,1,1,0);
            INSERT INTO web_evidence_scores VALUES ('enzyme','representative',100,'strong',2,3,4,1,2,1,1,0);
        ''')
        before=list(self.core.execute('SELECT * FROM web_evidence_scores'))
        expected=defaultdict(set,{('reaction','r'):{'1','2'},('enzyme','representative'):{'1','2'}})
        self.assertEqual(refresh_kinetic_scores(self.core,expected),2)
        after=list(self.core.execute('SELECT * FROM web_evidence_scores'))
        self.assertEqual(after[0][2],36)
        self.assertEqual(after[1][2],100)
        for a,b in zip(before,after):self.assertEqual(a[4:7]+a[8:],b[4:7]+b[8:])
        self.assertEqual(refresh_kinetic_scores(self.core,expected),0)


if __name__=='__main__':unittest.main()
