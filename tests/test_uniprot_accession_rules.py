import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from protein_reference_inheritance import identity
from uniprot_accession_rules import classify,resolve


class AccessionRulesTests(unittest.TestCase):
    def setUp(self):
        seq,tax=identity('ACDEFG','9606')
        protein=dict(identity_state='explicit_sequence_taxonomy',sequence_sha256=seq,taxonomy_id=tax)
        self.lineage=dict(accession='P12345',source_origins=[dict(protein)],current_targets=[dict(protein)],other_baseline_identity_keys=[])
        self.active=dict(entryType='UniProtKB reviewed (Swiss-Prot)',primaryAccession='P12345',sequence={'value':'ACDEFG'},organism={'taxonId':9606})

    def test_primary_requires_exact_full_sequence_and_taxonomy(self):
        result=classify(self.lineage,{'P12345':self.active})
        self.assertTrue(result['approved']);self.assertEqual(result['status'],'verified_current_primary_accession')

    def test_explicit_merge_chain_permits_secondary_alias(self):
        entries={'P12345':dict(entryType='Inactive',inactiveReason={'inactiveReasonType':'MERGED','mergeDemergeTo':['Q12345']}),
                 'Q12345':dict(self.active,primaryAccession='Q12345')}
        result=classify(self.lineage,entries)
        self.assertTrue(result['approved']);self.assertEqual(result['current_primary'],'Q12345')
        self.assertEqual(result['status'],'verified_merged_secondary_accession')

    def test_same_taxonomy_with_different_sequence_is_rejected(self):
        result=classify(self.lineage,{'P12345':dict(self.active,sequence={'value':'ACDEFA'})})
        self.assertFalse(result['approved']);self.assertEqual(result['status'],'current_sequence_conflict')

    def test_same_sequence_with_different_taxonomy_is_rejected(self):
        result=classify(self.lineage,{'P12345':dict(self.active,organism={'taxonId':10090})})
        self.assertFalse(result['approved']);self.assertEqual(result['status'],'current_taxonomy_conflict')

    def test_official_taxonomy_merge_is_distinguished_from_taxon_conflict(self):
        entries={'P12345':dict(self.active,organism={'taxonId':10090})}
        result=classify(self.lineage,entries,{'9606':'10090'})
        self.assertTrue(result['approved']);self.assertTrue(result['taxonomy_equivalent_after_verified_merge'])
        self.assertEqual(result['status'],'verified_current_primary_accession_taxonomy_merged')

    def test_split_not_accepted_even_with_matching_descendant(self):
        entries={'P12345':dict(entryType='Inactive',inactiveReason={'inactiveReasonType':'DEMERGED','mergeDemergeTo':['Q12345','Q12346']}),
                 'Q12345':self.active}
        self.assertEqual(classify(self.lineage,entries)['status'],'official_split_requires_review')
        self.assertFalse(classify(self.lineage,entries)['approved'])
        self.assertEqual(classify(self.lineage,entries)['matching_descendants'],['Q12345'])

    def test_deleted_not_inferred_to_be_active(self):
        entries={'P12345':dict(entryType='Inactive',inactiveReason={'inactiveReasonType':'DELETED'})}
        self.assertEqual(classify(self.lineage,entries)['status'],'official_deleted_record')

    def test_not_returned_is_not_called_deleted(self):
        self.assertEqual(classify(self.lineage,{})['status'],'official_record_not_returned')

    def test_missing_explicit_local_taxonomy_not_filled_by_name(self):
        self.lineage['current_targets'][0]['identity_state']='missing_explicit_taxonomy'
        self.assertEqual(classify(self.lineage,{'P12345':self.active})['status'],'local_explicit_taxonomy_or_sequence_missing')

    def test_cycle_is_not_followed_indefinitely(self):
        entries={a:dict(entryType='Inactive',inactiveReason={'inactiveReasonType':'MERGED','mergeDemergeTo':[b]}) for a,b in [('P12345','Q12345'),('Q12345','P12345')]}
        self.assertEqual(resolve('P12345',entries)['state'],'official_resolution_cycle')

    def test_unresolved_merge_target_not_called_verified(self):
        entries={'P12345':dict(entryType='Inactive',inactiveReason={'inactiveReasonType':'MERGED','mergeDemergeTo':['Q12345']})}
        self.assertFalse(classify(self.lineage,entries)['approved'])

    def test_ambiguous_official_residue_not_accepted(self):
        result=classify(self.lineage,{'P12345':dict(self.active,sequence={'value':'ACXEFG'})})
        self.assertEqual(result['status'],'official_sequence_or_taxonomy_invalid')

    def test_conflicting_original_local_identity_rejected(self):
        self.lineage['source_origins'][0]['taxonomy_id']='10090'
        self.assertEqual(classify(self.lineage,{'P12345':self.active})['status'],'source_target_identity_conflict')


if __name__=='__main__':unittest.main()
