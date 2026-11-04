-- Reference schema extracted from the actual runtime database; NO DATA ROWS.
-- This is documentation, not an initializer that recreates the scientific dataset.

CREATE TABLE web_alphafold_accessions (
            uniprot_accession TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            model_entity_id TEXT,
            latest_version INTEGER,
            global_metric_value REAL,
            fraction_plddt_very_low REAL,
            fraction_plddt_low REAL,
            fraction_plddt_confident REAL,
            fraction_plddt_very_high REAL,
            sequence_start INTEGER,
            sequence_end INTEGER,
            uniprot_start INTEGER,
            uniprot_end INTEGER,
            model_created_date TEXT,
            cif_url TEXT,
            pdb_url TEXT,
            bcif_url TEXT,
            pae_image_url TEXT,
            plddt_doc_url TEXT,
            pae_doc_url TEXT,
            uniprot_id TEXT,
            gene TEXT,
            organism_scientific_name TEXT,
            tax_id TEXT,
            reason TEXT,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

CREATE TABLE web_alphafold_mappings (
            biopart_id TEXT PRIMARY KEY,
            uniprot_accession TEXT NOT NULL,
            status TEXT NOT NULL,
            model_entity_id TEXT,
            latest_version INTEGER,
            global_metric_value REAL,
            sequence_start INTEGER,
            sequence_end INTEGER,
            cif_url TEXT,
            pdb_url TEXT,
            bcif_url TEXT,
            pae_image_url TEXT,
            plddt_doc_url TEXT,
            pae_doc_url TEXT,
            source TEXT NOT NULL DEFAULT 'AlphaFold DB',
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

CREATE TABLE web_assay_source_evidence (
 assay_id TEXT PRIMARY KEY,source_db TEXT,source_entry_id TEXT,biopart_id TEXT,uniprot_accession TEXT,reaction_id TEXT,
 source_organism TEXT,source_taxonomy_id TEXT,enzyme_form_status TEXT,wild_type_status TEXT,mutation_or_construct_text TEXT,
 source_pmids_json TEXT,ph REAL,ph_end REAL,temperature REAL,temperature_end REAL,temperature_unit TEXT,buffer_text TEXT,
 source_url TEXT,mapping_status TEXT,mapping_details_json TEXT,source_record_json TEXT);

CREATE TABLE web_attribute_evidences (
            attribute_evidence_id TEXT,
            entity_type TEXT,
            entity_id TEXT,
            attribute_name TEXT,
            value_text TEXT,
            value_numeric REAL,
            unit TEXT,
            source_label TEXT,
            source_db TEXT,
            external_id TEXT,
            external_url TEXT,
            pmids_json TEXT,
            citations_json TEXT
        );

CREATE TABLE web_attribute_external_checks (
          check_id INTEGER PRIMARY KEY AUTOINCREMENT,
          attribute_evidence_id TEXT NOT NULL,
          source_db TEXT NOT NULL,
          match_status TEXT NOT NULL,
          match_score INTEGER NOT NULL DEFAULT 0,
          match_reason TEXT,
          external_attribute_id TEXT,
          ec_number TEXT,
          external_attribute_name TEXT,
          external_value_numeric REAL,
          external_value_maximum REAL,
          external_unit TEXT,
          external_organism TEXT,
          external_literature_ids TEXT,
          external_commentary TEXT,
          source_url TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

CREATE TABLE web_chassis_ids(
  label TEXT,
  reactenz_chassis_id
);

CREATE TABLE web_chassis_labels(
  label TEXT,
  record_count,
  reaction_count,
  enzyme_count,
  organism_count
);

CREATE TABLE web_chassis_records(
  chassis_label TEXT,
  reaction_id TEXT,
  biopart_id TEXT,
  enzyme_name TEXT,
  gene_name_primary TEXT,
  organism TEXT,
  protein_id TEXT,
  has_sequence INT,
  sequence_length INT
);

CREATE TABLE web_compound_images (
            compound_id TEXT PRIMARY KEY,
            image_path TEXT,
            image_status TEXT NOT NULL,
            reason TEXT,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

CREATE TABLE web_compound_physicochemical_properties (
 compound_id TEXT PRIMARY KEY,pubchem_cid TEXT,inchikey TEXT,property_kind TEXT,method TEXT,source_url TEXT,
 molecular_weight REAL,exact_mass REAL,xlogp REAL,tpsa REAL,hbond_donor_count INTEGER,hbond_acceptor_count INTEGER,
 rotatable_bond_count INTEGER,heavy_atom_count INTEGER,formal_charge INTEGER,properties_json TEXT,local_rdkit_properties_json TEXT,scope TEXT);

CREATE TABLE web_compound_pubchem_enrichment (
            compound_id TEXT PRIMARY KEY,
            chebi_id TEXT,
            pubchem_cid TEXT,
            canonical_smiles TEXT,
            isomeric_smiles TEXT,
            formula TEXT,
            inchi TEXT,
            inchikey TEXT,
            status TEXT NOT NULL,
            reason TEXT,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

CREATE TABLE web_compound_reported_property_values (
 property_id TEXT PRIMARY KEY,compound_id TEXT,pubchem_cid TEXT,property_name TEXT,property_kind TEXT,value_text TEXT,value_numeric REAL,
 unit TEXT,source_name TEXT,source_url TEXT,pubchem_url TEXT,citations_json TEXT,source_value_json TEXT,conditions_status TEXT,verification_status TEXT);

CREATE TABLE web_data_completion_audit (change_id TEXT PRIMARY KEY,entity_type TEXT,entity_id TEXT,field_name TEXT,old_value_json TEXT,new_value_json TEXT,verification_method TEXT,record_url TEXT,evidence_json TEXT);

CREATE TABLE web_data_repair_metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);

CREATE TABLE web_entity_references (
            reference_id INTEGER,
            entity_type TEXT,
            entity_id TEXT,
            pmid TEXT,
            citation_text TEXT,
            reference_url TEXT,
            source_db TEXT
        );

CREATE TABLE web_enzyme_browse_summary (
              biopart_id TEXT PRIMARY KEY,
              pdb_count INTEGER NOT NULL,
              alphafold_count INTEGER NOT NULL,
              kinetic_count INTEGER NOT NULL,
              chassis_count INTEGER NOT NULL,
              browse_completeness INTEGER NOT NULL
            );

CREATE TABLE web_enzyme_counts(
  reaction_id TEXT,
  enzyme_pair_count,
  enzyme_count
);

CREATE TABLE web_enzyme_ids(
  biopart_id TEXT,
  reactenz_enzyme_id
);

CREATE TABLE web_enzyme_source_fields(
  biopart_id TEXT,
  protein_id TEXT,
  name TEXT,
  enzyme_name TEXT,
  synonyms_json TEXT,
  gene_name_primary TEXT,
  gene_names_json TEXT,
  protein_sequence TEXT,
  nt_ids_json TEXT,
  nt_sequences_json TEXT,
  cds_sequence TEXT,
  organism TEXT,
  enzyme_organism TEXT,
  source_organism TEXT,
  taxonomy_id TEXT,
  lineage TEXT,
  chassis_json TEXT,
  source_tissues_json TEXT,
  subcellular_localizations_json TEXT,
  pathway_annotations_json TEXT,
  optimum_ph_json TEXT,
  optimum_temperature_json TEXT,
  temperature_stability_json TEXT,
  ph_stability_json TEXT,
  molecular_weight_json TEXT,
  protein_families_json TEXT,
  subunit_structure_json TEXT,
  evidence_label TEXT,
  raw_general_json TEXT,
  raw_organism_json TEXT,
  raw_sequence_json TEXT,
  extraction_version TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE web_enzyme_uniprot(
  biopart_id TEXT,
  uniprot_accession,
  uniprot_entry_name,
  uniprot_url,
  uniprot_xref_count
, uniprot_mapping_method TEXT);

CREATE TABLE web_enzymes(
  biopart_id TEXT,
  protein_id TEXT,
  enzyme_name,
  gene_name_primary TEXT,
  organism TEXT,
  taxonomy_id TEXT,
  lineage TEXT,
  protein_sequence TEXT,
  has_sequence,
  sequence_length,
  evidence_label TEXT,
  reaction_count
);

CREATE VIRTUAL TABLE web_enzymes_fts USING fts5(
            biopart_id,
            enzyme_name,
            gene_name_primary,
            organism,
            protein_id,
            content='web_enzymes',
            content_rowid='rowid'
        );

CREATE TABLE web_evidence_scores (
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          evidence_score INTEGER NOT NULL,
          evidence_tier TEXT NOT NULL,
          publication_pmids INTEGER NOT NULL DEFAULT 0,
          field_evidences INTEGER NOT NULL DEFAULT 0,
          field_pmids INTEGER NOT NULL DEFAULT 0,
          kinetic_pmids INTEGER NOT NULL DEFAULT 0,
          xref_databases INTEGER NOT NULL DEFAULT 0,
          sequence_supported INTEGER NOT NULL DEFAULT 0,
          structure_supported INTEGER NOT NULL DEFAULT 0,
          context_supported INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (entity_type, entity_id)
        );

CREATE TABLE web_experimental_coordinate_files (
 biopart_id TEXT,pdb_id TEXT,chain_id TEXT,uniprot_accession TEXT,file TEXT,sha256 TEXT,bytes INTEGER,source_url TEXT,validation TEXT,
 PRIMARY KEY(biopart_id,pdb_id,chain_id));

CREATE TABLE web_experimental_structure_source_mappings (
 mapping_id TEXT PRIMARY KEY,biopart_id TEXT,uniprot_accession TEXT,pdb_id TEXT,chain_id TEXT,experimental_method TEXT,
 resolution REAL,coverage REAL,uniprot_start INTEGER,uniprot_end INTEGER,pdb_start INTEGER,pdb_end INTEGER,taxonomy_id TEXT,
 mapping_method TEXT,source_url TEXT,source_record_json TEXT);

CREATE TABLE web_expression_source_observations (
 expression_id TEXT PRIMARY KEY,biopart_id TEXT,reaction_id TEXT,uniprot_accession TEXT,gene_name TEXT,source_organism TEXT,
 source_db TEXT,source_entry_id TEXT,source_candidate_id TEXT,host_name TEXT,strain_or_cell_line TEXT,
 expression_status TEXT,solubility_status TEXT,activity_status TEXT,yield_text TEXT,yield_lower_g_l REAL,yield_upper_g_l REAL,
 yield_basis TEXT,enzyme_identity_status TEXT,enzyme_form_status TEXT,construct_note TEXT,source_pmid TEXT,source_url TEXT,
 verification_status TEXT,source_span_ids_json TEXT,source_span_sha256_json TEXT,evidence_scope TEXT);

CREATE TABLE web_external_attribute_values (
          external_attribute_id TEXT PRIMARY KEY,
          source_db TEXT NOT NULL,
          ec_number TEXT,
          attribute_name TEXT,
          value_numeric REAL,
          value_maximum REAL,
          unit TEXT,
          organism TEXT,
          literature_ids TEXT,
          commentary TEXT,
          source_url TEXT,
          raw_json TEXT
        );

CREATE TABLE web_external_kinetics (
          external_kinetic_id TEXT PRIMARY KEY,
          source_db TEXT NOT NULL,
          external_entry_id TEXT NOT NULL,
          ec_number TEXT,
          parameter_type TEXT,
          parameter_name TEXT,
          value_numeric REAL,
          value_end REAL,
          unit TEXT,
          normalized_value REAL,
          normalized_unit TEXT,
          substrate TEXT,
          organism TEXT,
          taxonomy_id TEXT,
          ph REAL,
          temperature REAL,
          pubmed_id TEXT,
          title TEXT,
          source_url TEXT,
          raw_json TEXT
        );

CREATE TABLE web_import_compound_conflicts (compound_id TEXT PRIMARY KEY,source_release TEXT NOT NULL,source_structure_json TEXT NOT NULL,review_status TEXT NOT NULL,note TEXT NOT NULL);

CREATE TABLE web_import_field_status (
 entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,field_name TEXT NOT NULL,status TEXT NOT NULL,source_db TEXT,source_release TEXT,reason TEXT,PRIMARY KEY(entity_type,entity_id,field_name));

CREATE TABLE web_kinetic_assay_links (kinetic_id TEXT PRIMARY KEY,assay_id TEXT,source_entry_id TEXT,source_parameter_json TEXT);

CREATE TABLE web_kinetic_external_checks (
          check_id INTEGER PRIMARY KEY AUTOINCREMENT,
          kinetic_id TEXT NOT NULL,
          source_db TEXT NOT NULL,
          match_status TEXT NOT NULL,
          match_score INTEGER NOT NULL DEFAULT 0,
          match_reason TEXT,
          external_kinetic_id TEXT,
          external_entry_id TEXT,
          ec_number TEXT,
          external_parameter_type TEXT,
          external_value_numeric REAL,
          external_unit TEXT,
          external_normalized_value REAL,
          external_normalized_unit TEXT,
          external_substrate TEXT,
          external_organism TEXT,
          external_ph REAL,
          external_temperature REAL,
          external_pubmed_id TEXT,
          source_url TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

CREATE TABLE web_kinetic_external_source_status (
          source_db TEXT NOT NULL,
          ec_number TEXT NOT NULL,
          status TEXT NOT NULL,
          fetched_entries INTEGER NOT NULL DEFAULT 0,
          error_text TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (source_db, ec_number)
        );

CREATE TABLE web_kinetic_literature_reviews (kinetic_id TEXT PRIMARY KEY, review_status TEXT NOT NULL, pmids_json TEXT NOT NULL, matched_accessions_json TEXT NOT NULL, review_date TEXT NOT NULL, review_scope TEXT NOT NULL);

CREATE TABLE web_kinetics(
  kinetic_id TEXT,
  reaction_id TEXT,
  biopart_id TEXT,
  compound_id TEXT,
  parameter_type TEXT,
  value_text TEXT,
  value_numeric REAL,
  unit TEXT,
  subject_name TEXT,
  condition_text TEXT,
  source_db TEXT,
  reaction_assignment_status TEXT,
  reaction_assignment_method TEXT
, evidence_text TEXT, pmids_json TEXT);

CREATE TABLE web_kinetics_counts(
  reaction_id TEXT,
  kinetics_count
);

CREATE TABLE web_kinetics_excluded_qc(
  kinetic_id TEXT,
  reaction_id TEXT,
  biopart_id TEXT,
  parameter_type TEXT,
  value_text TEXT,
  value_numeric REAL,
  unit TEXT,
  reaction_assignment_status TEXT,
  reaction_assignment_method TEXT,
  exclusion_reason
);

CREATE TABLE web_kinetics_reference_repairs (
        kinetic_id TEXT PRIMARY KEY, original_biopart_id TEXT NOT NULL,
        representative_biopart_id TEXT NOT NULL, reaction_id TEXT NOT NULL,
        evidence_json TEXT NOT NULL, original_row_json TEXT NOT NULL, repaired_at_utc TEXT NOT NULL);

CREATE TABLE web_kinetics_source_provenance (
        kinetic_id TEXT PRIMARY KEY, source_db_raw TEXT,
        source_db_normalized TEXT NOT NULL, non_database_tokens_json TEXT NOT NULL,
        normalization_rule TEXT NOT NULL, recorded_at_utc TEXT NOT NULL);

CREATE TABLE web_kinetics_unit_recovery_applied_20260921(
  kinetic_id TEXT,
  parameter_type TEXT,
  value_numeric REAL,
  recovered_unit TEXT,
  confidence TEXT,
  unit_source TEXT,
  pmids TEXT,
  reaction_id TEXT,
  biopart_id TEXT,
  applied_at_utc
);

CREATE TABLE web_mcsa_compounds (
          mcsa_compound_id TEXT PRIMARY KEY,
          mcsa_id INTEGER NOT NULL,
          compound_index INTEGER NOT NULL,
          compound_type TEXT,
          compound_count REAL,
          chebi_id TEXT,
          compound_name TEXT,
          mol_file_url TEXT
        );

CREATE TABLE web_mcsa_entries (
          mcsa_id INTEGER PRIMARY KEY,
          enzyme_name TEXT,
          reference_uniprot_id TEXT,
          is_reference_uniprot_id INTEGER,
          entry_url TEXT,
          description TEXT,
          all_ecs_json TEXT,
          mechanism_count INTEGER NOT NULL DEFAULT 0,
          detailed_mechanism_count INTEGER NOT NULL DEFAULT 0,
          residue_count INTEGER NOT NULL DEFAULT 0,
          compound_count INTEGER NOT NULL DEFAULT 0,
          pmids_json TEXT,
          dois_json TEXT,
          source_db TEXT NOT NULL DEFAULT 'M-CSA'
        );

CREATE TABLE web_mcsa_entry_uniprots (
          mcsa_id INTEGER NOT NULL,
          uniprot_id TEXT NOT NULL,
          is_reference INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (mcsa_id, uniprot_id)
        );

CREATE TABLE web_mcsa_enzyme_mappings (
          biopart_id TEXT NOT NULL,
          uniprot_accession TEXT NOT NULL,
          mcsa_id INTEGER NOT NULL,
          match_type TEXT NOT NULL,
          source_db TEXT NOT NULL DEFAULT 'M-CSA',
          PRIMARY KEY (biopart_id, uniprot_accession, mcsa_id)
        );

CREATE TABLE web_mcsa_mechanism_steps (
          mcsa_id INTEGER NOT NULL,
          mechanism_id INTEGER NOT NULL,
          step_id INTEGER NOT NULL,
          description TEXT,
          is_product INTEGER NOT NULL DEFAULT 0,
          figure_url TEXT,
          marvin_xml_url TEXT,
          PRIMARY KEY (mcsa_id, mechanism_id, step_id)
        );

CREATE TABLE web_mcsa_mechanisms (
          mcsa_id INTEGER NOT NULL,
          mechanism_id INTEGER NOT NULL,
          is_detailed INTEGER NOT NULL DEFAULT 0,
          mechanism_text TEXT,
          rating INTEGER,
          components_summary TEXT,
          PRIMARY KEY (mcsa_id, mechanism_id)
        );

CREATE TABLE web_mcsa_reaction_mappings (
          reaction_id TEXT NOT NULL,
          ec_number TEXT NOT NULL,
          mcsa_id INTEGER NOT NULL,
          match_type TEXT NOT NULL,
          source_db TEXT NOT NULL DEFAULT 'M-CSA',
          PRIMARY KEY (reaction_id, ec_number, mcsa_id)
        );

CREATE TABLE web_mcsa_references (
          mcsa_reference_id TEXT PRIMARY KEY,
          mcsa_id INTEGER NOT NULL,
          mechanism_id INTEGER,
          pubmed_id TEXT,
          doi TEXT,
          title TEXT,
          evidence_types_json TEXT
        );

CREATE TABLE web_mcsa_residues (
          mcsa_residue_id TEXT PRIMARY KEY,
          mcsa_id INTEGER NOT NULL,
          residue_index INTEGER NOT NULL,
          roles_summary TEXT,
          main_annotation TEXT,
          function_location_abv TEXT,
          ptm TEXT,
          roles_json TEXT,
          uniprot_id TEXT,
          uniprot_residue_code TEXT,
          uniprot_residue_position INTEGER,
          residue_sequence_is_reference INTEGER,
          pdb_id TEXT,
          pdb_chain TEXT,
          pdb_assembly_chain TEXT,
          pdb_assembly INTEGER,
          pdb_residue_code TEXT,
          pdb_residue_position INTEGER,
          pdb_auth_residue_position INTEGER,
          pdb_residue_is_reference INTEGER,
          domain_name TEXT,
          domain_cath_id TEXT
        );

CREATE TABLE web_mnx_compound_mappings (
          compound_id TEXT NOT NULL,
          mnx_compound_id TEXT NOT NULL,
          source_db TEXT NOT NULL,
          source_xref TEXT NOT NULL,
          source_value TEXT NOT NULL,
          source_description TEXT,
          mapping_method TEXT NOT NULL,
          mnxref_version TEXT NOT NULL,
          source_url TEXT,
          PRIMARY KEY (compound_id, mnx_compound_id, source_xref)
        );

CREATE TABLE web_mnx_reaction_mappings (
          reaction_id TEXT NOT NULL,
          mnx_reaction_id TEXT NOT NULL,
          source_db TEXT NOT NULL,
          source_xref TEXT NOT NULL,
          source_value TEXT NOT NULL,
          source_equation TEXT,
          mapping_method TEXT NOT NULL,
          mnxref_version TEXT NOT NULL,
          source_url TEXT,
          PRIMARY KEY (reaction_id, mnx_reaction_id, source_xref)
        );

CREATE TABLE web_organism_browse_summary (
              organism TEXT PRIMARY KEY,
              enzyme_count INTEGER NOT NULL,
              reaction_count INTEGER NOT NULL,
              relation_count INTEGER NOT NULL,
              chassis_count INTEGER NOT NULL,
              pdb_enzyme_count INTEGER NOT NULL,
              alphafold_enzyme_count INTEGER NOT NULL,
              structured_enzyme_count INTEGER NOT NULL,
              evidence_score INTEGER NOT NULL,
              evidence_tier TEXT,
              browse_completeness INTEGER NOT NULL
            );

CREATE TABLE web_organism_ids(
  organism TEXT,
  reactenz_organism_id
);

CREATE TABLE web_participant_status(
  reaction_id TEXT,
  participant_count,
  smiles_count,
  missing_smiles_count
);

CREATE TABLE web_pathways(
              source_db TEXT NOT NULL,
              pathway_id TEXT NOT NULL,
              pathway_name TEXT,
              pathway_url TEXT,
              evidence_source TEXT,
              release_date TEXT,
              PRIMARY KEY(source_db, pathway_id)
            );

CREATE TABLE web_pdb_mappings(
  biopart_id TEXT,
  uniprot_id TEXT,
  pdb_id TEXT,
  chain_id TEXT,
  experimental_method TEXT,
  coverage REAL,
  resolution REAL,
  source_db TEXT,
  evidence_url TEXT
);

CREATE TABLE web_protein_annotation_status (
          biopart_id TEXT PRIMARY KEY,
          uniprot_accession TEXT,
          status TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          error_text TEXT
        );

CREATE TABLE web_protein_annotations (
          biopart_id TEXT PRIMARY KEY,
          uniprot_accession TEXT,
          protein_name TEXT,
          interpro_count INTEGER NOT NULL DEFAULT 0,
          pfam_count INTEGER NOT NULL DEFAULT 0,
          domain_feature_count INTEGER NOT NULL DEFAULT 0,
          active_site_count INTEGER NOT NULL DEFAULT 0,
          binding_site_count INTEGER NOT NULL DEFAULT 0,
          conserved_site_count INTEGER NOT NULL DEFAULT 0,
          source_db TEXT NOT NULL DEFAULT 'UniProtKB/InterPro',
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

CREATE TABLE web_protein_domains (
          domain_id INTEGER PRIMARY KEY AUTOINCREMENT,
          biopart_id TEXT NOT NULL,
          uniprot_accession TEXT,
          annotation_db TEXT NOT NULL,
          entry_id TEXT NOT NULL,
          entry_name TEXT,
          entry_type TEXT,
          source_db TEXT NOT NULL DEFAULT 'UniProtKB/InterPro',
          entry_url TEXT
        );

CREATE TABLE web_protein_features (
          feature_id INTEGER PRIMARY KEY AUTOINCREMENT,
          biopart_id TEXT NOT NULL,
          uniprot_accession TEXT,
          feature_type TEXT NOT NULL,
          position_start INTEGER,
          position_end INTEGER,
          note TEXT,
          ligand TEXT,
          evidence TEXT,
          feature_text TEXT,
          source_db TEXT NOT NULL DEFAULT 'UniProtKB'
        , source_uniprot_accession TEXT, source_position_start INTEGER, source_position_end INTEGER, coordinate_status TEXT, coordinate_note TEXT);

CREATE TABLE web_protein_reference_inheritance (
        target_biopart_id TEXT NOT NULL,
        pmid TEXT NOT NULL,
        source_snapshot TEXT NOT NULL,
        source_biopart_id TEXT NOT NULL,
        source_reference_id INTEGER NOT NULL,
        source_db TEXT,
        citation_text TEXT,
        reference_url TEXT,
        sequence_sha256 TEXT NOT NULL,
        taxonomy_id TEXT NOT NULL,
        canonical_protein_key TEXT NOT NULL,
        evidence_scope TEXT NOT NULL,
        source_reference_json TEXT NOT NULL,
        recovery_revision TEXT NOT NULL,
        PRIMARY KEY(target_biopart_id, pmid, source_snapshot, source_reference_id)
    );

CREATE TABLE web_protein_stability_observations (observation_id TEXT PRIMARY KEY,biopart_id TEXT,uniprot_accession TEXT,property_kind TEXT,value_text TEXT,value_numeric REAL,unit TEXT,source_pmids_json TEXT,source_evidence_json TEXT,source_release TEXT,verification_status TEXT);

CREATE TABLE web_qc_metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE web_reaction_compounds(
  reaction_id TEXT,
  compound_id TEXT,
  role TEXT,
  side TEXT,
  position_index INT,
  stoichiometry TEXT,
  compound_name,
  chebi_id TEXT,
  pubchem_id TEXT,
  formula TEXT,
  smiles TEXT,
  inchi TEXT,
  inchikey TEXT,
  structure_status
);

CREATE TABLE web_reaction_ec_numbers(
  reaction_id TEXT,
  ec_number_clean TEXT,
  ec_text_raw TEXT,
  source_field TEXT
);

CREATE TABLE web_reaction_enzymes(
  reaction_id TEXT,
  biopart_id TEXT,
  enzyme_name,
  gene_name_primary TEXT,
  organism TEXT,
  taxonomy_id TEXT,
  protein_id TEXT,
  has_sequence,
  sequence_length,
  evidence_level TEXT,
  source_db TEXT
, reo_id TEXT);

CREATE TABLE web_reaction_ids(
  reaction_id TEXT,
  reactenz_reaction_id
);

CREATE TABLE web_reaction_pathways(
              reaction_id TEXT NOT NULL,
              reactenz_reaction_id TEXT NOT NULL,
              source_db TEXT NOT NULL,
              pathway_id TEXT NOT NULL,
              source_reaction_id TEXT,
              pathway_name TEXT,
              mapping_method TEXT,
              PRIMARY KEY(reaction_id, source_db, pathway_id)
            );

CREATE TABLE web_reaction_qc_flags (
                reaction_id TEXT NOT NULL,
                rhea_id TEXT,
                risk_type TEXT NOT NULL,
                details TEXT,
                qc_release TEXT NOT NULL,
                PRIMARY KEY(reaction_id, risk_type)
            );

CREATE TABLE web_reaction_qc_reviews (reaction_id TEXT,rhea_id TEXT,original_risk_type TEXT,review_status TEXT,local_accessions_json TEXT,rhea_accessions_json TEXT,overlap_json TEXT,review_date TEXT, chemistry_review_status TEXT, chemical_matches_json TEXT,PRIMARY KEY(reaction_id,rhea_id,original_risk_type));

CREATE TABLE web_reactions(
  reaction_id TEXT,
  dataset_level TEXT,
  reaction_equation_display TEXT,
  reaction_equation_raw TEXT,
  reaction_direction TEXT,
  ec_number TEXT,
  rhea_id TEXT,
  kegg_reaction_id TEXT,
  metacyc_reaction_id TEXT,
  evidence_level TEXT,
  source_db TEXT,
  participant_count,
  smiles_count,
  missing_smiles_count,
  all_participants_have_smiles,
  enzyme_pair_count,
  enzyme_count,
  kinetics_count
);

CREATE VIRTUAL TABLE web_reactions_fts USING fts5(
            reaction_id,
            reaction_equation_display,
            reaction_equation_raw,
            ec_number,
            rhea_id,
            kegg_reaction_id,
            metacyc_reaction_id,
            content='web_reactions',
            content_rowid='rowid'
        );

CREATE TABLE web_reserved_public_ids (kind TEXT,internal_id TEXT,public_id TEXT,reason TEXT,PRIMARY KEY(kind,internal_id));

CREATE TABLE web_retrosynthesis_benchmark_reactions (
          benchmark_entry_id TEXT PRIMARY KEY,
          benchmark_id TEXT NOT NULL,
          source_id TEXT NOT NULL,
          entry_index INTEGER NOT NULL,
          reaction_smiles TEXT,
          reactants_smiles TEXT,
          product_smiles TEXT,
          mapped_reaction_smiles TEXT,
          reaction_class TEXT,
          target_name TEXT,
          target_smiles TEXT,
          source_file TEXT NOT NULL,
          FOREIGN KEY (benchmark_id) REFERENCES web_retrosynthesis_benchmark_sets(benchmark_id),
          FOREIGN KEY (source_id) REFERENCES web_retrosynthesis_sources(source_id)
        );

CREATE TABLE web_retrosynthesis_benchmark_sets (
          benchmark_id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL,
          dataset_name TEXT NOT NULL,
          task_type TEXT NOT NULL,
          split_name TEXT NOT NULL,
          record_count INTEGER NOT NULL,
          source_file TEXT NOT NULL,
          reaction_format TEXT,
          license_note TEXT,
          FOREIGN KEY (source_id) REFERENCES web_retrosynthesis_sources(source_id)
        );

CREATE TABLE web_retrosynthesis_building_blocks (
          block_id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL,
          block_set TEXT NOT NULL,
          block_type TEXT NOT NULL,
          smiles TEXT,
          external_id TEXT,
          inchi TEXT,
          name TEXT,
          source_file TEXT NOT NULL,
          source_index INTEGER NOT NULL,
          license_note TEXT,
          FOREIGN KEY (source_id) REFERENCES web_retrosynthesis_sources(source_id)
        );

CREATE TABLE web_retrosynthesis_routes (
          route_id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL,
          route_set TEXT NOT NULL,
          target_name TEXT,
          target_class TEXT,
          target_smiles TEXT NOT NULL,
          route_text TEXT,
          step_count INTEGER NOT NULL DEFAULT 0,
          source_file TEXT NOT NULL,
          source_index INTEGER NOT NULL,
          license_note TEXT,
          FOREIGN KEY (source_id) REFERENCES web_retrosynthesis_sources(source_id)
        );

CREATE TABLE web_retrosynthesis_rule_links (
          link_id TEXT PRIMARY KEY,
          rule_id TEXT NOT NULL,
          link_type TEXT NOT NULL,
          external_db TEXT NOT NULL,
          external_id TEXT NOT NULL,
          reactenz_reaction_id TEXT,
          mapping_method TEXT NOT NULL,
          source_id TEXT NOT NULL,
          FOREIGN KEY (rule_id) REFERENCES web_retrosynthesis_rules(rule_id),
          FOREIGN KEY (source_id) REFERENCES web_retrosynthesis_sources(source_id)
        );

CREATE TABLE web_retrosynthesis_rules (
          rule_id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL,
          rule_family TEXT NOT NULL,
          rule_type TEXT NOT NULL,
          rule_smarts TEXT,
          product_id TEXT,
          substrates_id TEXT,
          ec_number TEXT,
          product_smiles TEXT,
          substrates_smiles TEXT,
          reference_reaction_count INTEGER NOT NULL DEFAULT 0,
          reference_enzyme_count INTEGER NOT NULL DEFAULT 0,
          mapped_reactenz_reaction_count INTEGER NOT NULL DEFAULT 0,
          source_file TEXT,
          source_index INTEGER NOT NULL,
          license_note TEXT,
          FOREIGN KEY (source_id) REFERENCES web_retrosynthesis_sources(source_id)
        );

CREATE TABLE web_retrosynthesis_sources (
          source_id TEXT PRIMARY KEY,
          source_name TEXT NOT NULL,
          source_type TEXT NOT NULL,
          publication_year INTEGER,
          title TEXT,
          local_path TEXT,
          license TEXT,
          source_url TEXT,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

CREATE TABLE web_set_reactions (
            reaction_id TEXT PRIMARY KEY,
            dataset_level TEXT NOT NULL
        );

CREATE TABLE web_source_imports (
 import_id TEXT PRIMARY KEY,source_db TEXT NOT NULL,source_release TEXT NOT NULL,imported_at_utc TEXT NOT NULL,source_manifest_json TEXT NOT NULL);

CREATE TABLE web_source_kinetics_unassigned (source_measurement_id TEXT PRIMARY KEY,biopart_id TEXT NOT NULL,uniprot_accession TEXT NOT NULL,parameter_type TEXT NOT NULL,source_release TEXT NOT NULL,assignment_status TEXT NOT NULL,source_value_json TEXT NOT NULL,source_scope TEXT);

CREATE TABLE web_source_records (
 source_db TEXT NOT NULL,source_id TEXT NOT NULL,source_release TEXT NOT NULL,payload_json TEXT NOT NULL,PRIMARY KEY(source_db,source_id,source_release));

CREATE TABLE web_stats (metric TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE web_structure_confidence (
          biopart_id TEXT PRIMARY KEY,
          reactenz_enzyme_id TEXT NOT NULL,
          uniprot_accession TEXT,
          best_structure_type TEXT,
          best_structure_id TEXT,
          structure_confidence_score INTEGER NOT NULL,
          structure_confidence_tier TEXT NOT NULL,
          has_high_confidence_structure INTEGER NOT NULL,
          catalytic_site_support_level TEXT NOT NULL,
          alphafold_model_count INTEGER NOT NULL DEFAULT 0,
          best_alphafold_model_id TEXT,
          best_alphafold_plddt REAL,
          high_confidence_alphafold_count INTEGER NOT NULL DEFAULT 0,
          very_high_confidence_alphafold_count INTEGER NOT NULL DEFAULT 0,
          alphafold_residue_coverage_start INTEGER,
          alphafold_residue_coverage_end INTEGER,
          pdb_structure_count INTEGER NOT NULL DEFAULT 0,
          best_pdb_id TEXT,
          best_pdb_chain TEXT,
          best_pdb_coverage REAL,
          best_pdb_resolution REAL,
          high_coverage_pdb_count INTEGER NOT NULL DEFAULT 0,
          mcsa_entry_count INTEGER NOT NULL DEFAULT 0,
          mcsa_residue_count INTEGER NOT NULL DEFAULT 0,
          mcsa_residues_with_uniprot_position INTEGER NOT NULL DEFAULT 0,
          mcsa_residues_in_alphafold_coverage INTEGER NOT NULL DEFAULT 0,
          mcsa_residues_with_pdb_coordinates INTEGER NOT NULL DEFAULT 0,
          active_site_count INTEGER NOT NULL DEFAULT 0,
          active_sites_in_alphafold_coverage INTEGER NOT NULL DEFAULT 0,
          binding_site_count INTEGER NOT NULL DEFAULT 0,
          binding_sites_in_alphafold_coverage INTEGER NOT NULL DEFAULT 0,
          conserved_site_count INTEGER NOT NULL DEFAULT 0,
          conserved_sites_in_alphafold_coverage INTEGER NOT NULL DEFAULT 0,
          feature_site_count INTEGER NOT NULL DEFAULT 0,
          feature_sites_in_alphafold_coverage INTEGER NOT NULL DEFAULT 0,
          pocket_status TEXT NOT NULL DEFAULT 'not_computed',
          proximity_status TEXT NOT NULL DEFAULT 'sequence_coverage_proxy',
          source_note TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

CREATE TABLE web_uniprot_alias_inheritance (
      target_biopart_id TEXT NOT NULL, old_accession TEXT NOT NULL,
      current_primary TEXT NOT NULL, xref_db TEXT NOT NULL,
      sequence_sha256 TEXT NOT NULL, taxonomy_id TEXT NOT NULL,
      canonical_protein_key TEXT NOT NULL, source_biopart_id TEXT NOT NULL,
      source_xref_id INTEGER NOT NULL, source_xref_json TEXT NOT NULL,
      source_snapshot_xref_sha256 TEXT NOT NULL, verification_status TEXT NOT NULL,
      official_release TEXT NOT NULL, official_resolution_path TEXT NOT NULL,
      official_sequence_sha256 TEXT NOT NULL, official_taxonomy_id TEXT NOT NULL,
      official_cache_files TEXT NOT NULL, scope TEXT NOT NULL,
      taxonomy_resolution_path TEXT NOT NULL,
      official_taxonomy_merge_evidence_sha256 TEXT NOT NULL,
      PRIMARY KEY(target_biopart_id,old_accession,source_snapshot_xref_sha256,source_xref_id)
    );

CREATE TABLE web_xrefs(
  entity_type TEXT,
  entity_id TEXT,
  xref_db TEXT,
  xref_value TEXT,
  xref_url TEXT,
  source_db TEXT
);

CREATE INDEX idx_web_alphafold_accessions_status ON web_alphafold_accessions(status);

CREATE INDEX idx_web_alphafold_mappings_accession ON web_alphafold_mappings(uniprot_accession);

CREATE INDEX idx_web_assay_source_enzyme ON web_assay_source_evidence(biopart_id);

CREATE INDEX idx_web_assay_source_reaction ON web_assay_source_evidence(reaction_id);

CREATE INDEX idx_web_attribute_evidences_attr_entity ON web_attribute_evidences(attribute_name, entity_type, entity_id);

CREATE INDEX idx_web_attribute_evidences_attribute ON web_attribute_evidences(attribute_name);

CREATE INDEX idx_web_attribute_evidences_entity ON web_attribute_evidences(entity_type, entity_id);

CREATE INDEX idx_web_attribute_external_checks_attr ON web_attribute_external_checks(attribute_evidence_id);

CREATE INDEX idx_web_attribute_external_checks_status ON web_attribute_external_checks(source_db, match_status);

CREATE UNIQUE INDEX idx_web_chassis_ids_label ON web_chassis_ids(label);

CREATE UNIQUE INDEX idx_web_chassis_ids_local ON web_chassis_ids(reactenz_chassis_id);

CREATE INDEX idx_web_chassis_labels_count ON web_chassis_labels(record_count DESC);

CREATE UNIQUE INDEX idx_web_chassis_labels_label ON web_chassis_labels(label);

CREATE INDEX idx_web_chassis_records_biopart ON web_chassis_records(biopart_id);

CREATE INDEX idx_web_chassis_records_label ON web_chassis_records(chassis_label);

CREATE INDEX idx_web_chassis_records_organism ON web_chassis_records(organism);

CREATE UNIQUE INDEX idx_web_chassis_records_pk ON web_chassis_records(chassis_label,reaction_id,biopart_id);

CREATE INDEX idx_web_chassis_records_reaction ON web_chassis_records(reaction_id);

CREATE INDEX idx_web_compound_images_status ON web_compound_images(image_status);

CREATE INDEX idx_web_compound_pubchem_status ON web_compound_pubchem_enrichment(status);

CREATE INDEX idx_web_entity_references_entity ON web_entity_references(entity_type, entity_id);

CREATE INDEX idx_web_entity_references_pmid ON web_entity_references(pmid);

CREATE INDEX idx_web_enzyme_browse_summary_completeness
              ON web_enzyme_browse_summary(browse_completeness DESC, biopart_id);

CREATE INDEX idx_web_enzyme_counts_reaction ON web_enzyme_counts(reaction_id);

CREATE UNIQUE INDEX idx_web_enzyme_ids_external ON web_enzyme_ids(biopart_id);

CREATE UNIQUE INDEX idx_web_enzyme_ids_local ON web_enzyme_ids(reactenz_enzyme_id);

CREATE UNIQUE INDEX idx_web_enzyme_source_fields_id ON web_enzyme_source_fields(biopart_id);

CREATE UNIQUE INDEX idx_web_enzyme_uniprot_biopart ON web_enzyme_uniprot(biopart_id);

CREATE INDEX idx_web_enzymes_biopart ON web_enzymes(biopart_id);

CREATE INDEX idx_web_enzymes_name ON web_enzymes(enzyme_name);

CREATE INDEX idx_web_enzymes_organism ON web_enzymes(organism);

CREATE INDEX idx_web_evidence_scores_score ON web_evidence_scores(entity_type, evidence_score);

CREATE INDEX idx_web_exp_structure_source_enzyme ON web_experimental_structure_source_mappings(biopart_id);

CREATE INDEX idx_web_expression_source_enzyme ON web_expression_source_observations(biopart_id);

CREATE INDEX idx_web_external_attribute_values_ec_attr ON web_external_attribute_values(source_db, ec_number, attribute_name);

CREATE INDEX idx_web_external_kinetics_ec_param ON web_external_kinetics(source_db, ec_number, parameter_type);

CREATE INDEX idx_web_external_kinetics_pubmed ON web_external_kinetics(source_db, pubmed_id);

CREATE INDEX idx_web_kinetic_external_checks_kinetic ON web_kinetic_external_checks(kinetic_id);

CREATE INDEX idx_web_kinetic_external_checks_status ON web_kinetic_external_checks(source_db, match_status);

CREATE INDEX idx_web_kinetics_biopart ON web_kinetics(biopart_id);

CREATE INDEX idx_web_kinetics_counts_reaction ON web_kinetics_counts(reaction_id);

CREATE INDEX idx_web_kinetics_excluded_reaction ON web_kinetics_excluded_qc(reaction_id);

CREATE INDEX idx_web_kinetics_excluded_reason ON web_kinetics_excluded_qc(exclusion_reason);

CREATE INDEX idx_web_kinetics_param ON web_kinetics(parameter_type);

CREATE INDEX idx_web_kinetics_reaction ON web_kinetics(reaction_id);

CREATE UNIQUE INDEX idx_web_kinetics_unique_id ON web_kinetics(kinetic_id);

CREATE INDEX idx_web_mcsa_compounds_mcsa ON web_mcsa_compounds(mcsa_id);

CREATE INDEX idx_web_mcsa_enzyme_mappings_biopart ON web_mcsa_enzyme_mappings(biopart_id);

CREATE INDEX idx_web_mcsa_mechanisms_mcsa ON web_mcsa_mechanisms(mcsa_id);

CREATE INDEX idx_web_mcsa_reaction_mappings_reaction ON web_mcsa_reaction_mappings(reaction_id);

CREATE INDEX idx_web_mcsa_references_mcsa ON web_mcsa_references(mcsa_id);

CREATE INDEX idx_web_mcsa_residues_mcsa ON web_mcsa_residues(mcsa_id);

CREATE INDEX idx_web_mnx_compound_mappings_compound ON web_mnx_compound_mappings(compound_id);

CREATE INDEX idx_web_mnx_reaction_mappings_reaction ON web_mnx_reaction_mappings(reaction_id);

CREATE INDEX idx_web_organism_browse_summary_completeness
              ON web_organism_browse_summary(browse_completeness DESC, organism);

CREATE INDEX idx_web_organism_browse_summary_evidence
              ON web_organism_browse_summary(evidence_score DESC, organism);

CREATE UNIQUE INDEX idx_web_organism_ids_local ON web_organism_ids(reactenz_organism_id);

CREATE UNIQUE INDEX idx_web_organism_ids_name ON web_organism_ids(organism);

CREATE INDEX idx_web_participant_status_reaction ON web_participant_status(reaction_id);

CREATE INDEX idx_web_pathways_source ON web_pathways(source_db);

CREATE INDEX idx_web_pdb_biopart ON web_pdb_mappings(biopart_id);

CREATE INDEX idx_web_protein_domains_biopart ON web_protein_domains(biopart_id);

CREATE INDEX idx_web_protein_domains_entry ON web_protein_domains(annotation_db, entry_id);

CREATE INDEX idx_web_protein_features_biopart ON web_protein_features(biopart_id);

CREATE INDEX idx_web_protein_status_status ON web_protein_annotation_status(status);

CREATE INDEX idx_web_reaction_compounds_compound ON web_reaction_compounds(compound_id);

CREATE INDEX idx_web_reaction_compounds_reaction ON web_reaction_compounds(reaction_id);

CREATE INDEX idx_web_reaction_ec_reaction ON web_reaction_ec_numbers(reaction_id);

CREATE INDEX idx_web_reaction_enzymes_biopart ON web_reaction_enzymes(biopart_id);

CREATE INDEX idx_web_reaction_enzymes_name ON web_reaction_enzymes(enzyme_name);

CREATE INDEX idx_web_reaction_enzymes_reaction ON web_reaction_enzymes(reaction_id);

CREATE UNIQUE INDEX idx_web_reaction_enzymes_reo_id ON web_reaction_enzymes(reo_id);

CREATE INDEX idx_web_reaction_enzymes_sequence ON web_reaction_enzymes(has_sequence, sequence_length);

CREATE UNIQUE INDEX idx_web_reaction_ids_external ON web_reaction_ids(reaction_id);

CREATE UNIQUE INDEX idx_web_reaction_ids_local ON web_reaction_ids(reactenz_reaction_id);

CREATE INDEX idx_web_reaction_pathways_pathway ON web_reaction_pathways(source_db, pathway_id);

CREATE INDEX idx_web_reaction_pathways_reaction ON web_reaction_pathways(reaction_id);

CREATE INDEX idx_web_reaction_qc_flags_type ON web_reaction_qc_flags(risk_type);

CREATE INDEX idx_web_reactions_complete ON web_reactions(all_participants_have_smiles);

CREATE INDEX idx_web_reactions_direction ON web_reactions(reaction_direction);

CREATE INDEX idx_web_reactions_id ON web_reactions(reaction_id);

CREATE INDEX idx_web_reactions_level ON web_reactions(dataset_level);

CREATE INDEX idx_web_reactions_pair_count ON web_reactions(enzyme_pair_count DESC);

CREATE INDEX idx_web_reported_property_compound ON web_compound_reported_property_values(compound_id,property_name);

CREATE INDEX idx_web_retrosynthesis_benchmarks_product ON web_retrosynthesis_benchmark_reactions(product_smiles);

CREATE INDEX idx_web_retrosynthesis_benchmarks_source ON web_retrosynthesis_benchmark_reactions(source_id);

CREATE INDEX idx_web_retrosynthesis_blocks_smiles ON web_retrosynthesis_building_blocks(smiles);

CREATE INDEX idx_web_retrosynthesis_routes_target ON web_retrosynthesis_routes(target_smiles);

CREATE INDEX idx_web_retrosynthesis_rule_links_external ON web_retrosynthesis_rule_links(external_db, external_id);

CREATE INDEX idx_web_retrosynthesis_rule_links_reaction ON web_retrosynthesis_rule_links(reactenz_reaction_id);

CREATE INDEX idx_web_retrosynthesis_rules_ec ON web_retrosynthesis_rules(ec_number);

CREATE INDEX idx_web_retrosynthesis_rules_source ON web_retrosynthesis_rules(source_id);

CREATE INDEX idx_web_set_reactions_level ON web_set_reactions(dataset_level);

CREATE INDEX idx_web_structure_confidence_high ON web_structure_confidence(has_high_confidence_structure);

CREATE INDEX idx_web_structure_confidence_score ON web_structure_confidence(structure_confidence_score DESC);

CREATE INDEX idx_web_structure_confidence_support ON web_structure_confidence(catalytic_site_support_level);

CREATE INDEX idx_web_xrefs_db ON web_xrefs(xref_db);

CREATE INDEX idx_web_xrefs_entity ON web_xrefs(entity_type, entity_id);

CREATE TRIGGER web_kinetics_reference_insert
        BEFORE INSERT ON web_kinetics BEGIN
        SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM web_reactions WHERE reaction_id=NEW.reaction_id)
          OR NOT EXISTS (SELECT 1 FROM web_enzymes WHERE biopart_id=NEW.biopart_id)
          OR NOT EXISTS (SELECT 1 FROM web_reaction_enzymes WHERE reaction_id=NEW.reaction_id AND biopart_id=NEW.biopart_id)
          OR (NEW.compound_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM web_reaction_compounds WHERE compound_id=NEW.compound_id))
        THEN RAISE(ABORT, 'kinetic reference must resolve to published reaction/enzyme/pair/compound') END;
        END;

CREATE TRIGGER web_kinetics_reference_update
        BEFORE UPDATE OF reaction_id,biopart_id,compound_id ON web_kinetics BEGIN
        SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM web_reactions WHERE reaction_id=NEW.reaction_id)
          OR NOT EXISTS (SELECT 1 FROM web_enzymes WHERE biopart_id=NEW.biopart_id)
          OR NOT EXISTS (SELECT 1 FROM web_reaction_enzymes WHERE reaction_id=NEW.reaction_id AND biopart_id=NEW.biopart_id)
          OR (NEW.compound_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM web_reaction_compounds WHERE compound_id=NEW.compound_id))
        THEN RAISE(ABORT, 'kinetic reference must resolve to published reaction/enzyme/pair/compound') END;
        END;
