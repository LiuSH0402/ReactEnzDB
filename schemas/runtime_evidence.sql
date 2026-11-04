-- Reference schema extracted from the actual runtime database; NO DATA ROWS.
-- This is documentation, not an initializer that recreates the scientific dataset.

CREATE TABLE assay_conditions(
          condition_id TEXT PRIMARY KEY,assertion_id TEXT NOT NULL,ph REAL,temperature_c REAL,
          buffer_text TEXT,cofactor_text TEXT,condition_text TEXT,extraction_method TEXT NOT NULL,
          FOREIGN KEY(assertion_id) REFERENCES assertions(assertion_id)
        );

CREATE TABLE assertion_compounds(
          assertion_id TEXT NOT NULL,participant_role TEXT NOT NULL,raw_name TEXT,
          compound_id TEXT,compound_name TEXT,canonical_smiles TEXT,inchikey TEXT,
          mapping_method TEXT NOT NULL,structure_similarity REAL,is_exact_structure_match INTEGER NOT NULL,
          PRIMARY KEY(assertion_id,participant_role,raw_name,compound_id),
          FOREIGN KEY(assertion_id) REFERENCES assertions(assertion_id)
        );

CREATE TABLE assertion_enzyme_links(
          assertion_id TEXT NOT NULL,biopart_id TEXT NOT NULL,reactenz_enzyme_id TEXT,
          link_method TEXT NOT NULL,source_accession TEXT,is_primary INTEGER NOT NULL,
          PRIMARY KEY(assertion_id,biopart_id,link_method),
          FOREIGN KEY(assertion_id) REFERENCES assertions(assertion_id)
        );

CREATE TABLE assertions(
          assertion_id TEXT PRIMARY KEY,source_db TEXT NOT NULL,source_record_id TEXT NOT NULL,
          source_ec_number TEXT,reaction_id TEXT,reactenz_reaction_id TEXT,
          primary_biopart_id TEXT,primary_reactenz_enzyme_id TEXT,enzyme_form_id TEXT,
          wild_type_status TEXT,mutation_text TEXT,form_accession TEXT,
          evidence_class TEXT NOT NULL,evidence_rank INTEGER NOT NULL,display_evidence_label TEXT NOT NULL,
          outcome_class TEXT NOT NULL,is_experimental INTEGER NOT NULL,
          enzyme_identity_status TEXT NOT NULL,reaction_identity_status TEXT NOT NULL,
          substrate_identity_status TEXT NOT NULL,product_identity_status TEXT NOT NULL,
          mapping_score REAL,curation_status TEXT NOT NULL,pmid_count INTEGER NOT NULL,
          has_quantitative_measurement INTEGER NOT NULL,has_assay_conditions INTEGER NOT NULL,
          source_url TEXT,rule_id TEXT,duplicate_group_id TEXT,is_canonical INTEGER NOT NULL,
          duplicate_group_member_count INTEGER NOT NULL,created_at TEXT NOT NULL
        );

CREATE TABLE brenda_context_records(
          context_id TEXT PRIMARY KEY,operation TEXT NOT NULL,context_type TEXT NOT NULL,
          ec_number TEXT NOT NULL,organism TEXT,value_text TEXT,value_max_text TEXT,
          commentary_available INTEGER NOT NULL,literature_ids_json TEXT NOT NULL,
          ligand_structure_id TEXT,linkage_boundary TEXT NOT NULL
        );

CREATE TABLE citations(
          assertion_id TEXT NOT NULL,pmid TEXT,doi TEXT,title TEXT,journal TEXT,year INTEGER,
          source_url TEXT,full_text_status TEXT NOT NULL,verification_status TEXT NOT NULL,
          PRIMARY KEY(assertion_id,pmid,doi),FOREIGN KEY(assertion_id) REFERENCES assertions(assertion_id)
        );

CREATE TABLE enzyme_summary(
          biopart_id TEXT PRIMARY KEY,reactenz_enzyme_id TEXT NOT NULL,
          reaction_count INTEGER NOT NULL,assertion_count INTEGER NOT NULL,
          exact_reaction_count INTEGER NOT NULL,catalytic_assertion_count INTEGER NOT NULL,
          inactive_or_negative_count INTEGER NOT NULL,citation_count INTEGER NOT NULL,
          best_evidence_rank INTEGER,best_evidence_class TEXT
        );

CREATE TABLE evidence_class_definitions(
          evidence_class TEXT PRIMARY KEY,rank_order INTEGER NOT NULL,definition TEXT NOT NULL,
          minimum_requirements_json TEXT NOT NULL,interpretation_boundary TEXT NOT NULL
        );

CREATE TABLE measurements(
          measurement_id TEXT PRIMARY KEY,assertion_id TEXT NOT NULL,
          parameter_type_raw TEXT NOT NULL,parameter_type_canonical TEXT NOT NULL,
          raw_value_text TEXT,raw_value_numeric REAL,raw_unit TEXT,
          source_normalized_value REAL,source_normalized_unit TEXT,source_normalization_status TEXT NOT NULL,
          release_normalized_value REAL,release_normalized_unit TEXT,release_normalization_status TEXT NOT NULL,
          subject_name TEXT,FOREIGN KEY(assertion_id) REFERENCES assertions(assertion_id)
        );

CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);

CREATE TABLE outcome_definitions(outcome_class TEXT PRIMARY KEY,definition TEXT NOT NULL);

CREATE TABLE qa_results(
          check_name TEXT PRIMARY KEY,passed INTEGER NOT NULL,observed_value TEXT NOT NULL,
          expected_value TEXT,checked_at TEXT NOT NULL
        );

CREATE TABLE reaction_enzyme_summary(
          reaction_id TEXT NOT NULL,reactenz_reaction_id TEXT NOT NULL,
          biopart_id TEXT NOT NULL,reactenz_enzyme_id TEXT NOT NULL,
          best_evidence_class TEXT NOT NULL,best_evidence_rank INTEGER NOT NULL,
          assertion_count INTEGER NOT NULL,exact_assertion_count INTEGER NOT NULL,
          catalytic_assertion_count INTEGER NOT NULL,non_catalytic_assertion_count INTEGER NOT NULL,
          inactive_or_negative_count INTEGER NOT NULL,measurement_count INTEGER NOT NULL,
          citation_count INTEGER NOT NULL,condition_count INTEGER NOT NULL,
          literature_verified_count INTEGER NOT NULL,literature_discrepancy_count INTEGER NOT NULL,
          source_count INTEGER NOT NULL,source_labels TEXT NOT NULL,
          PRIMARY KEY(reaction_id,biopart_id)
        );

CREATE TABLE reaction_summary(
          reaction_id TEXT PRIMARY KEY,reactenz_reaction_id TEXT NOT NULL,
          enzyme_count INTEGER NOT NULL,assertion_count INTEGER NOT NULL,
          exact_enzyme_count INTEGER NOT NULL,catalytic_assertion_count INTEGER NOT NULL,
          inactive_or_negative_count INTEGER NOT NULL,citation_count INTEGER NOT NULL,
          best_evidence_rank INTEGER,best_evidence_class TEXT
        );

CREATE INDEX idx_release_assertion_canonical ON assertions(is_canonical,reaction_id,evidence_rank);

CREATE INDEX idx_release_assertion_duplicate ON assertions(duplicate_group_id);

CREATE INDEX idx_release_assertion_enzyme ON assertions(primary_biopart_id,evidence_rank);

CREATE INDEX idx_release_assertion_reaction ON assertions(reaction_id,evidence_rank);

CREATE INDEX idx_release_brenda_context_ec ON brenda_context_records(ec_number,context_type);

CREATE INDEX idx_release_citation_pmid ON citations(pmid);

CREATE INDEX idx_release_measurement_assertion ON measurements(assertion_id,parameter_type_canonical);

CREATE INDEX idx_release_re_summary_public ON reaction_enzyme_summary(reactenz_reaction_id,best_evidence_rank);
