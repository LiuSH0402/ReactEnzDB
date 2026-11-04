import { releasePath } from "@/lib/paths";
import { execFileSync } from "node:child_process";
import { isUniProtAccession } from "./uniprotAccessions";
import fs from "node:fs";
import path from "node:path";
import { querySqlite, querySqliteStable, sqliteFts5Available } from "@/lib/sqlite";
import {
  getReactionIdsByStandardizationFilters,
  getReactionStandardizationFacets,
  type ReactionStandardizationFilters,
} from "@/lib/reaction-standardization";

export type StatMap = Record<string, number>;

export type MethodologyQaStats = {
  reactions: number;
  gold: number;
  silver: number;
  smilesComplete: number;
  relations: number;
  references: number;
  referencesWithPmid: number;
  attributeEvidence: number;
  attributeEvidenceWithPmid: number;
  kinetics: number;
  kineticsWithPmid: number;
  integrityFailures: number;
  tiers: Array<{ entity_type: string; evidence_tier: string; count: number }>;
};

export type PagedResult<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type ReactionRow = {
  reactenz_reaction_id: string;
  reaction_id?: string;
  dataset_level?: string;
  reaction_direction: string | null;
  reaction_equation_display: string | null;
  enzyme_count: number;
  enzyme_pair_count: number;
  kinetics_count: number;
  all_participants_have_smiles: number;
  participant_count?: number;
  smiles_count?: number;
  missing_smiles_count?: number;
  ec_number?: string | null;
  rhea_id?: string | null;
  kegg_reaction_id?: string | null;
  metacyc_reaction_id?: string | null;
  mnx_reaction_ids?: string | null;
  pdb_enzyme_count?: number;
  alphafold_enzyme_count?: number;
  structured_enzyme_count?: number;
  evidence_score?: number;
  evidence_tier?: string | null;
  evidence_level?: string | null;
  source_db?: string | null;
  standardization_status?: string | null;
  standardized_structure_status?: string | null;
  stereo_completeness_status?: string | null;
  full_mass_balance_status?: string | null;
  full_charge_balance_status?: string | null;
  exact_rhea_identity?: number;
  atom_mapping_available?: number;
  mapping_conflict_count?: number;
};

export type ReactionDetail = ReactionRow & {
  reaction_id: string;
  dataset_level?: string;
  reaction_equation_raw: string | null;
  ec_number: string | null;
  rhea_id: string | null;
  kegg_reaction_id: string | null;
  metacyc_reaction_id: string | null;
  evidence_level?: string | null;
  source_db?: string | null;
  participant_count: number;
  smiles_count: number;
  missing_smiles_count: number;
};

export type EnzymeDetail = EnzymeRow & {
  biopart_id: string;
  protein_sequence: string | null;
  lineage: string | null;
};

export type CompoundParticipant = {
  reaction_id: string;
  compound_id: string;
  role: string | null;
  side: string | null;
  position_index: number | null;
  compound_name: string | null;
  formula: string | null;
  smiles: string | null;
  chebi_id: string | null;
  pubchem_id: string | null;
  mnx_compound_ids?: string | null;
  structure_status: string | null;
  image_path: string | null;
  image_status: string | null;
};

export type EnzymeLink = {
  reactenz_enzyme_id: string;
  reactenz_organism_id?: string | null;
  reaction_id?: string;
  biopart_id?: string;
  enzyme_name: string | null;
  gene_name_primary: string | null;
  organism: string | null;
  taxonomy_id?: string | null;
  protein_id: string | null;
  uniprot_accession?: string | null;
  uniprot_entry_name?: string | null;
  uniprot_url?: string | null;
  uniprot_mapping_method?: string | null;
  sequence_length: number | null;
  has_sequence: number;
  evidence_level?: string | null;
  source_db?: string | null;
};

export type EnzymeRow = {
  reactenz_enzyme_id: string;
  reactenz_organism_id?: string | null;
  biopart_id?: string;
  protein_id: string | null;
  uniprot_accession?: string | null;
  uniprot_entry_name?: string | null;
  uniprot_url?: string | null;
  uniprot_mapping_method?: string | null;
  enzyme_name: string | null;
  gene_name_primary: string | null;
  organism: string | null;
  taxonomy_id: string | null;
  protein_sequence: string | null;
  has_sequence: number;
  sequence_length: number | null;
  reaction_count: number;
  pdb_count?: number;
  alphafold_count?: number;
  structure_count?: number;
  kinetic_count?: number;
  chassis_count?: number;
  evidence_label?: string | null;
  evidence_score?: number;
  evidence_tier?: string | null;
  interpro_count?: number;
  pfam_count?: number;
  domain_feature_count?: number;
  active_site_count?: number;
  binding_site_count?: number;
  conserved_site_count?: number;
  structure_confidence_score?: number;
  structure_confidence_tier?: string | null;
  has_high_confidence_structure?: number;
  catalytic_site_support_level?: string | null;
};

export type KineticRow = {
  kinetic_id: string;
  biopart_id: string | null;
  reactenz_enzyme_id?: string | null;
  parameter_type: string;
  value_text: string | null;
  value_numeric: number | null;
  unit: string | null;
  subject_name: string | null;
  condition_text: string | null;
  source_db: string | null;
  evidence_text?: string | null;
  pmids_json?: string | null;
  reaction_assignment_status: string | null;
  reaction_assignment_method?: string | null;
};

export function formatKineticParameterType(value: string | null | undefined) {
  if (value === "km") return "Km";
  if (value === "kcat") return "kcat";
  if (value === "kcat_km") return "kcat/Km";
  if (value === "vmax") return "Vmax";
  return (value || "not curated").replaceAll("_", " ");
}

export type KineticExternalCheckRow = {
  check_id: number;
  kinetic_id: string;
  source_db: string;
  match_status: string;
  match_score: number;
  match_reason: string | null;
  external_kinetic_id: string | null;
  external_entry_id: string | null;
  ec_number: string | null;
  external_parameter_type: string | null;
  external_value_numeric: number | null;
  external_unit: string | null;
  external_normalized_value: number | null;
  external_normalized_unit: string | null;
  external_substrate: string | null;
  external_organism: string | null;
  external_ph: number | null;
  external_temperature: number | null;
  external_pubmed_id: string | null;
  source_url: string | null;
  updated_at: string;
};

export type XrefRow = {
  xref_db: string;
  xref_value: string;
  xref_url: string | null;
  source_db: string | null;
};

export type MnxReactionMappingRow = {
  reaction_id: string;
  mnx_reaction_id: string;
  source_db: string;
  source_xref: string;
  source_value: string;
  source_equation: string | null;
  mapping_method: string;
  mnxref_version: string;
  source_url: string | null;
};

export type MnxCompoundMappingRow = {
  compound_id: string;
  mnx_compound_id: string;
  source_db: string;
  source_xref: string;
  source_value: string;
  source_description: string | null;
  mapping_method: string;
  mnxref_version: string;
  source_url: string | null;
};

export type McsaEntryRow = {
  mcsa_id: number;
  enzyme_name: string | null;
  reference_uniprot_id: string | null;
  is_reference_uniprot_id: number;
  entry_url: string | null;
  description: string | null;
  all_ecs_json: string | null;
  mechanism_count: number;
  detailed_mechanism_count: number;
  residue_count: number;
  compound_count: number;
  pmids_json: string | null;
  dois_json: string | null;
  match_type?: string | null;
  matched_uniprot?: string | null;
  matched_ec?: string | null;
};

export type McsaResidueRow = {
  mcsa_residue_id: string;
  mcsa_id: number;
  residue_index: number;
  roles_summary: string | null;
  main_annotation: string | null;
  function_location_abv: string | null;
  ptm: string | null;
  roles_json: string | null;
  uniprot_id: string | null;
  uniprot_residue_code: string | null;
  uniprot_residue_position: number | null;
  residue_sequence_is_reference: number;
  pdb_id: string | null;
  pdb_chain: string | null;
  pdb_assembly_chain: string | null;
  pdb_assembly: number | null;
  pdb_residue_code: string | null;
  pdb_residue_position: number | null;
  pdb_auth_residue_position: number | null;
  pdb_residue_is_reference: number;
  domain_name: string | null;
  domain_cath_id: string | null;
};

export type McsaMechanismRow = {
  mcsa_id: number;
  mechanism_id: number;
  is_detailed: number;
  mechanism_text: string | null;
  rating: number | null;
  components_summary: string | null;
};

export type McsaMechanismStepRow = {
  mcsa_id: number;
  mechanism_id: number;
  step_id: number;
  description: string | null;
  is_product: number;
  figure_url: string | null;
  marvin_xml_url: string | null;
};

export type McsaCompoundRow = {
  mcsa_compound_id: string;
  mcsa_id: number;
  compound_index: number;
  compound_type: string | null;
  compound_count: number | null;
  chebi_id: string | null;
  compound_name: string | null;
  mol_file_url: string | null;
};

export type McsaReferenceRow = {
  mcsa_reference_id: string;
  mcsa_id: number;
  mechanism_id: number | null;
  pubmed_id: string | null;
  doi: string | null;
  title: string | null;
  evidence_types_json: string | null;
};

export type ReferenceRow = {
  reference_id: number;
  entity_type: string;
  entity_id: string;
  pmid: string;
  citation_text: string | null;
  reference_url: string | null;
  source_db: string | null;
};

export type AttributeEvidenceRow = {
  attribute_evidence_id: string;
  entity_type: string;
  entity_id: string;
  attribute_name: string;
  value_text: string | null;
  value_numeric: number | null;
  unit: string | null;
  source_label: string | null;
  source_db: string | null;
  external_id: string | null;
  external_url: string | null;
  pmids_json: string | null;
  citations_json: string | null;
  related_reactenz_id?: string | null;
  related_name?: string | null;
};

export type AttributeExternalCheckRow = {
  check_id: number;
  attribute_evidence_id: string;
  source_db: string;
  match_status: string;
  match_score: number;
  match_reason: string | null;
  external_attribute_id: string | null;
  ec_number: string | null;
  external_attribute_name: string | null;
  external_value_numeric: number | null;
  external_value_maximum: number | null;
  external_unit: string | null;
  external_organism: string | null;
  external_literature_ids: string | null;
  external_commentary: string | null;
  source_url: string | null;
  updated_at: string;
};

export type ProteinAnnotationSummary = {
  biopart_id: string;
  uniprot_accession: string | null;
  protein_name: string | null;
  interpro_count: number;
  pfam_count: number;
  domain_feature_count: number;
  active_site_count: number;
  binding_site_count: number;
  conserved_site_count: number;
  source_db: string | null;
  updated_at: string | null;
};

export type ProteinDomainRow = {
  domain_id: number;
  biopart_id: string;
  uniprot_accession: string | null;
  annotation_db: string;
  entry_id: string;
  entry_name: string | null;
  entry_type: string | null;
  source_db: string | null;
  entry_url: string | null;
};

export type ProteinFeatureRow = {
  feature_id: number;
  biopart_id: string;
  uniprot_accession: string | null;
  feature_type: string;
  position_start: number | null;
  position_end: number | null;
  note: string | null;
  ligand: string | null;
  evidence: string | null;
  feature_text: string | null;
  source_db: string | null;
  source_uniprot_accession?: string | null;
  source_position_start?: number | null;
  source_position_end?: number | null;
  coordinate_status?: string | null;
  coordinate_note?: string | null;
};

export type PathwayRow = {
  source_db: string;
  pathway_id: string;
  pathway_name: string | null;
  pathway_url: string | null;
  source_reaction_id: string | null;
  mapping_method: string | null;
  evidence_source?: string | null;
  release_date?: string | null;
};

export type PdbRow = {
  uniprot_id: string | null;
  pdb_id: string;
  chain_id: string | null;
  experimental_method: string | null;
  resolution: number | null;
  coverage: number | null;
  source_db: string | null;
  evidence_url: string | null;
};

export type AlphaFoldRow = {
  uniprot_accession: string;
  status: string;
  model_entity_id: string | null;
  latest_version: number | null;
  global_metric_value: number | null;
  sequence_start: number | null;
  sequence_end: number | null;
  cif_url: string | null;
  pdb_url: string | null;
  bcif_url: string | null;
  pae_image_url: string | null;
  plddt_doc_url: string | null;
  pae_doc_url: string | null;
  source: string | null;
};

export type StructureConfidenceRow = {
  biopart_id: string;
  reactenz_enzyme_id: string;
  uniprot_accession: string | null;
  best_structure_type: string | null;
  best_structure_id: string | null;
  structure_confidence_score: number;
  structure_confidence_tier: string;
  has_high_confidence_structure: number;
  catalytic_site_support_level: string;
  alphafold_model_count: number;
  best_alphafold_model_id: string | null;
  best_alphafold_plddt: number | null;
  high_confidence_alphafold_count: number;
  very_high_confidence_alphafold_count: number;
  alphafold_residue_coverage_start: number | null;
  alphafold_residue_coverage_end: number | null;
  pdb_structure_count: number;
  best_pdb_id: string | null;
  best_pdb_chain: string | null;
  best_pdb_coverage: number | null;
  best_pdb_resolution: number | null;
  high_coverage_pdb_count: number;
  mcsa_entry_count: number;
  mcsa_residue_count: number;
  mcsa_residues_with_uniprot_position: number;
  mcsa_residues_in_alphafold_coverage: number;
  mcsa_residues_with_pdb_coordinates: number;
  active_site_count: number;
  active_sites_in_alphafold_coverage: number;
  binding_site_count: number;
  binding_sites_in_alphafold_coverage: number;
  conserved_site_count: number;
  conserved_sites_in_alphafold_coverage: number;
  feature_site_count: number;
  feature_sites_in_alphafold_coverage: number;
  pocket_status: string;
  proximity_status: string;
  source_note: string;
  updated_at: string;
};

export type OrganismRow = {
  reactenz_organism_id: string;
  organism: string;
  enzyme_count: number;
  reaction_count: number;
  relation_count: number;
  chassis_count: number;
  pdb_enzyme_count?: number;
  alphafold_enzyme_count?: number;
  structured_enzyme_count?: number;
  evidence_score?: number;
  evidence_tier?: string | null;
};

export type OrganismProvenanceProfile = {
  taxonomy_ids: string[];
  lineages: string[];
  enzymes_with_sequence: number;
  literature_references: number;
  kinetic_records: number;
};

export type ChassisRow = {
  reactenz_chassis_id: string;
  label: string;
  record_count: number;
  reaction_count: number;
  enzyme_count: number;
  organism_count: number;
  pdb_enzyme_count?: number;
  alphafold_enzyme_count?: number;
  structured_enzyme_count?: number;
  evidence_score?: number;
  evidence_tier?: string | null;
};

export type ChassisSourceOrganismRow = {
  reactenz_organism_id: string | null;
  organism: string;
  record_count: number;
  reaction_count: number;
  enzyme_count: number;
};

export type RelationRecordRow = {
  reactenz_reaction_id: string;
  reactenz_enzyme_id: string;
  reactenz_organism_id: string | null;
  reactenz_chassis_id: string | null;
  reaction_id?: string;
  biopart_id?: string;
  enzyme_name: string | null;
  gene_name_primary: string | null;
  organism: string | null;
  protein_id: string | null;
  has_sequence: number;
  sequence_length: number | null;
  chassis_label?: string | null;
};

export type ReoBrowseRow = {
  reo_id: string;
  reactenz_reaction_id: string;
  reactenz_enzyme_id: string;
  reactenz_organism_id: string | null;
  reaction_id: string;
  biopart_id: string;
  reaction_equation_display: string | null;
  reaction_direction: string | null;
  ec_number: string | null;
  enzyme_name: string | null;
  gene_name_primary: string | null;
  organism: string | null;
  taxonomy_id: string | null;
  protein_id: string | null;
  has_sequence: number;
  sequence_length: number | null;
  evidence_level: string | null;
  source_db: string | null;
  kinetic_count: number;
  reference_count: number;
};

type ReoSearchParams = {
  q?: string;
  reaction?: string;
  enzyme?: string;
  organism?: string;
  hasSequence?: string;
  sort?: string;
  dir?: string;
  page?: number;
  pageSize?: number;
};

export type EnzymeCandidateRow = {
  reactenz_reaction_id: string;
  reactenz_enzyme_id: string;
  reactenz_organism_id: string | null;
  biopart_id: string;
  enzyme_name: string | null;
  gene_name_primary: string | null;
  organism: string | null;
  taxonomy_id: string | null;
  protein_id: string | null;
  uniprot_accession: string | null;
  uniprot_entry_name: string | null;
  uniprot_url: string | null;
  has_sequence: number;
  sequence_length: number | null;
  kinetic_count: number;
  pdb_count: number;
  alphafold_count: number;
  structure_count: number;
  chassis_count: number;
  preferred_chassis_count: number;
  chassis_labels: string | null;
  evidence_level: string | null;
  source_db: string | null;
  evidence_score: number;
};

export type SimilarReactionRow = {
  reactenz_reaction_id: string;
  reaction_id: string;
  reaction_direction: string | null;
  reaction_equation_display: string | null;
  enzyme_count: number;
  kinetics_count: number;
  all_participants_have_smiles: number;
  shared_feature_count: number;
  target_feature_count: number;
  candidate_feature_count: number;
  similarity_score: number;
  shared_compounds: string | null;
};

export type StructureSimilarReactionRow = {
  reactenz_reaction_id: string;
  reaction_id: string;
  reaction_direction: string | null;
  reaction_equation_display: string | null;
  enzyme_count: number;
  kinetics_count: number;
  all_participants_have_smiles: number;
  ec_number: string | null;
  rhea_id: string | null;
  kegg_reaction_id: string | null;
  metacyc_reaction_id: string | null;
  smiles_similarity_score: number;
  matched_query_count: number;
  query_count: number;
  matched_compounds: string | null;
  match_methods: string | null;
};

export type EnzymeCandidateResult = {
  target: ReactionDetail | null;
  targetMatchMode: "exact" | "text_fallback" | "structure_fallback" | "none";
  alternatives: ReactionRow[];
  candidates: EnzymeCandidateRow[];
  similarReactions: SimilarReactionRow[];
  structureSimilarReactions: StructureSimilarReactionRow[];
  structureMatchTotal: number;
  ecClassReactions: ReactionRow[];
};

export type ExactRetrosynthesisReactionMatch = {
  reaction_id: string;
  reactenz_reaction_id: string;
  matched_left_count: number;
  matched_right_count: number;
  query_left_count: number;
  query_right_count: number;
};

const DB_PATH = releasePath("reactenzdb_web.db");
const RETROSYNTHESIS_LOOKUP_DB_PATH = releasePath("retrosynthesis_reaction_lookup.sqlite");
const PYTHON_PATH = process.env.REACTENZDB_PYTHON ?? "python";
const SMILES_SEARCH_SCRIPT = path.resolve(process.cwd(), "scripts/reaction_smiles_search.py");
const FTS_SEARCH_SCRIPT = path.resolve(process.cwd(), "scripts/sqlite_fts_search.py");

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function ftsQuery(value: string): string {
  const tokens = value.match(/[A-Za-z][A-Za-z0-9_]*|[0-9]{2,}/g)?.slice(0, 8) ?? [];
  return tokens.map((token) => `${token.replaceAll('"', "")}*`).join(" AND ");
}

export type ParsedSearchKind =
  | "empty"
  | "reaction_id"
  | "enzyme_id"
  | "association_id"
  | "ec"
  | "rhea"
  | "kegg"
  | "uniprot"
  | "chebi"
  | "metacyc"
  | "pmid"
  | "structure"
  | "text";

export type ParsedSearchQuery = {
  raw: string;
  kind: ParsedSearchKind;
  value: string;
};

export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const text = raw.trim();
  if (!text) return { raw: text, kind: "empty", value: "" };
  if (/^REO\d+/i.test(text)) return { raw: text, kind: "association_id", value: text.toUpperCase() };
  if (/^E\d{4,}$/i.test(text)) return { raw: text, kind: "enzyme_id", value: text.toUpperCase() };
  if (/^R\d{3,}$/i.test(text)) return { raw: text, kind: "reaction_id", value: text.toUpperCase() };
  const ecLabeled = text.match(/^EC[:\s]*(\d+(?:\.(?:\d+|-)){0,3})$/i);
  if (ecLabeled?.[1]) return { raw: text, kind: "ec", value: ecLabeled[1] };
  const ec = text.match(/^(\d+(?:\.(?:\d+|-)){1,3})$/);
  if (ec?.[1]) return { raw: text, kind: "ec", value: ec[1] };
  const rhea = text.match(/^(?:RHEA[:\s-]+)(\d+)$/i);
  if (rhea?.[1]) return { raw: text, kind: "rhea", value: rhea[1] };
  const kegg = text.match(/^(?:KEGG[:\s]*)(R\d{5})$/i);
  if (kegg?.[1]) return { raw: text, kind: "kegg", value: kegg[1].toUpperCase() };
  const chebi = text.match(/^(?:CHEBI[:\s]+)(\d+)$/i);
  if (chebi?.[1]) return { raw: text, kind: "chebi", value: chebi[1] };
  const pmid = text.match(/^(?:PMID[:\s]+)(\d{5,8})$/i);
  if (pmid?.[1]) return { raw: text, kind: "pmid", value: pmid[1] };
  const metacyc = text.match(/^(?:METACYC[:\s]*)([A-Z0-9]+(?:-[A-Z0-9]+)+)$/i);
  if (metacyc?.[1]) return { raw: text, kind: "metacyc", value: metacyc[1].toUpperCase() };
  if (isUniProtAccession(text)) {
    return { raw: text, kind: "uniprot", value: text.toUpperCase() };
  }
  if (looksLikeStructureQuery(text)) return { raw: text, kind: "structure", value: text };
  return { raw: text, kind: "text", value: text };
}

function reactionEcClause(ec: string): string {
  const exact = sqlString(ec);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ec)) {
    return `(
      wr.reaction_id IN (SELECT reaction_id FROM web_reaction_ec_numbers WHERE ec_number_clean = ${exact})
      OR wr.ec_number = ${exact}
    )`;
  }
  const like = sqlString(`${ec}.%`);
  return `(
    wr.reaction_id IN (
      SELECT reaction_id FROM web_reaction_ec_numbers
      WHERE ec_number_clean = ${exact} OR ec_number_clean LIKE ${like}
    )
    OR wr.ec_number = ${exact}
    OR wr.ec_number LIKE ${like}
  )`;
}

function enzymeEcClause(ec: string): string {
  const exact = sqlString(ec);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ec)) {
    return `we.biopart_id IN (
      SELECT DISTINCT re.biopart_id
      FROM web_reaction_enzymes re
      JOIN web_reaction_ec_numbers ec ON ec.reaction_id = re.reaction_id
      WHERE ec.ec_number_clean = ${exact}
    )`;
  }
  const like = sqlString(`${ec}.%`);
  return `we.biopart_id IN (
    SELECT DISTINCT re.biopart_id
    FROM web_reaction_enzymes re
    JOIN web_reaction_ec_numbers ec ON ec.reaction_id = re.reaction_id
    WHERE ec.ec_number_clean = ${exact} OR ec.ec_number_clean LIKE ${like}
  )`;
}

function enzymesLinkedToReactionClause(predicate: string): string {
  return `we.biopart_id IN (
    SELECT DISTINCT re.biopart_id
    FROM web_reaction_enzymes re
    JOIN web_reactions wr ON wr.reaction_id = re.reaction_id
    JOIN web_reaction_ids rid ON rid.reaction_id = wr.reaction_id
    WHERE ${predicate}
  )`;
}

function chebiIdValues(id: string): string[] {
  const num = id.replace(/^CHEBI:/i, "");
  return Array.from(new Set([num, `CHEBI:${num}`, `chebi:${num}`]));
}

function reactionChebiClause(id: string): string {
  const values = chebiIdValues(id).map(sqlString).join(", ");
  return `wr.reaction_id IN (
    SELECT reaction_id FROM web_reaction_compounds
    WHERE chebi_id IN (${values})
  )`;
}

function enzymeChebiClause(id: string): string {
  const values = chebiIdValues(id).map(sqlString).join(", ");
  return `we.biopart_id IN (
    SELECT DISTINCT re.biopart_id
    FROM web_reaction_enzymes re
    JOIN web_reaction_compounds c ON c.reaction_id = re.reaction_id
    WHERE c.chebi_id IN (${values})
  )`;
}

function reactionMetacycClause(id: string): string {
  const exact = sqlString(id);
  return `(wr.metacyc_reaction_id = ${exact})`;
}

function reactionPmidClause(pmid: string): string {
  const value = sqlString(pmid);
  return `wr.reaction_id IN (
    SELECT entity_id FROM web_entity_references
    WHERE entity_type = 'reaction' AND CAST(pmid AS TEXT) = ${value}
  )`;
}

function enzymePmidClause(pmid: string): string {
  const value = sqlString(pmid);
  return `we.biopart_id IN (
    SELECT entity_id FROM web_entity_references
    WHERE entity_type = 'enzyme' AND CAST(pmid AS TEXT) = ${value}
  )`;
}

function catalogNameClause(rawQuery: string, nameColumn: string, idColumn: string): string {
  const parsed = parseSearchQuery(rawQuery);
  if (parsed.kind === "empty") return "";
  if (parsed.kind === "text") {
    const like = likeTokenClause([nameColumn], parsed.value);
    return like
      ? `(${like} OR ${idColumn} = ${sqlString(rawQuery)})`
      : `(${nameColumn} LIKE ${sqlString(`%${parsed.value}%`)} OR ${idColumn} = ${sqlString(rawQuery)})`;
  }
  if (parsed.kind === "uniprot") return `${idColumn} = ${sqlString(rawQuery)}`;
  return "1 = 0";
}

function exactFilterValue(raw: string, prefix: RegExp): string {
  return raw.trim().replace(prefix, "");
}

function likeTokenClause(columns: string[], value: string): string {
  const tokens = value.match(/[A-Za-z][A-Za-z0-9_]*|[0-9]{2,}/g)?.slice(0, 8) ?? [];
  if (!tokens.length) return "";
  return tokens
    .map((token) => {
      const like = sqlString(`%${token}%`);
      return `(${columns.map((column) => `${column} LIKE ${like}`).join(" OR ")})`;
    })
    .join(" AND ");
}

function looksLikeStructureQuery(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (/<=>|=>|->|→/.test(text)) return true;
  if (/[=\(\[\]#@\\]/.test(text)) return true;
  if (/\s/.test(text)) return false;
  if (/^(R\d{3,}|E\d{4,}|REO\d+|EC[:\s]?\d|CHEBI[:\s]|PMID[:\s]|METACYC[:\s])/i.test(text)) return false;
  if (/^[A-Za-z][A-Za-z0-9'\-]*$/.test(text) && text.length > 6) return false;
  return true;
}

function ftsMatchRowids(table: "web_reactions_fts" | "web_enzymes_fts", rawQuery: string): number[] | null {
  const fts = ftsQuery(rawQuery);
  if (!fts) return [];
  if (sqliteFts5Available(DB_PATH)) {
    return query<{ rowid: number }>(`SELECT rowid FROM ${table} WHERE ${table} MATCH ${sqlString(fts)} LIMIT 2000`).map((row) => Number(row.rowid));
  }
  if (!fs.existsSync(FTS_SEARCH_SCRIPT) || !fs.existsSync(PYTHON_PATH)) return null;
  try {
    const output = execFileSync(
      PYTHON_PATH,
      [FTS_SEARCH_SCRIPT, "--db", DB_PATH, "--table", table, "--query", fts, "--limit", "2000"],
      { encoding: "utf8", timeout: 8000, maxBuffer: 1024 * 1024 },
    );
    return safeJsonParse<{ rowids?: number[] }>(output, { rowids: [] }).rowids ?? [];
  } catch {
    return null;
  }
}

function rowidInClause(aliasRowid: string, rowids: number[]): string {
  if (!rowids.length) return "0";
  return `${aliasRowid} IN (${rowids.join(", ")})`;
}

function reactionTextSearchClause(rawQuery: string): string {
  const parsed = parseSearchQuery(rawQuery);
  if (parsed.kind === "empty") return "";
  if (parsed.kind === "ec") return reactionEcClause(parsed.value);
  if (parsed.kind === "reaction_id") {
    const id = sqlString(parsed.value);
    return `(rid.reactenz_reaction_id = ${id} OR wr.reaction_id = ${id} OR wr.kegg_reaction_id = ${id})`;
  }
  if (parsed.kind === "rhea") {
    const id = sqlString(parsed.value);
    const tagged = sqlString(`RHEA:${parsed.value}`);
    return `(wr.rhea_id = ${id} OR wr.rhea_id = ${tagged})`;
  }
  if (parsed.kind === "kegg") {
    const id = sqlString(parsed.value);
    return `(wr.kegg_reaction_id = ${id} OR rid.reactenz_reaction_id = ${id})`;
  }
  if (parsed.kind === "chebi") return reactionChebiClause(parsed.value);
  if (parsed.kind === "metacyc") return reactionMetacycClause(parsed.value);
  if (parsed.kind === "pmid") return reactionPmidClause(parsed.value);
  if (parsed.kind === "enzyme_id" || parsed.kind === "uniprot" || parsed.kind === "association_id") return "";
  if (parsed.kind === "structure") return "";
  const fts = ftsQuery(parsed.value);
  if (!fts) return "";
  const exact = `rid.reactenz_reaction_id = ${sqlString(rawQuery)} OR wr.reaction_id = ${sqlString(rawQuery)}`;
  const rowids = ftsMatchRowids("web_reactions_fts", parsed.value);
  // web_reactions is a TEMP VIEW under the KEGG projection, so it has no rowid;
  // resolve FTS rowids to reaction_id first and let the view filter the result.
  if (rowids) return `(wr.reaction_id IN (SELECT reaction_id FROM main.web_reactions WHERE ${rowidInClause("rowid", rowids)}) OR ${exact})`;
  const like = likeTokenClause([
    "rid.reactenz_reaction_id",
    "wr.reaction_id",
    "wr.reaction_equation_display",
    "wr.reaction_equation_raw",
    "wr.ec_number",
    "wr.rhea_id",
    "wr.kegg_reaction_id",
    "wr.metacyc_reaction_id",
  ], parsed.value);
  return like ? `(${like} OR ${exact})` : `(${exact})`;
}

function enzymeTextSearchClause(rawQuery: string): string {
  const parsed = parseSearchQuery(rawQuery);
  if (parsed.kind === "empty") return "";
  if (parsed.kind === "ec") return enzymeEcClause(parsed.value);
  if (parsed.kind === "enzyme_id") {
    const id = sqlString(parsed.value);
    return `(eid.reactenz_enzyme_id = ${id} OR we.biopart_id = ${id})`;
  }
  if (parsed.kind === "uniprot") {
    const id = sqlString(parsed.value);
    return `(eu.uniprot_accession = ${id} OR eu.uniprot_entry_name = ${id} OR we.biopart_id IN (
      SELECT entity_id FROM web_xrefs WHERE entity_type = 'enzyme'
        AND xref_db IN ('UniProt', 'UniProt_secondary') AND xref_value = ${id}
    ))`;
  }
  if (parsed.kind === "reaction_id") {
    const id = sqlString(parsed.value);
    return enzymesLinkedToReactionClause(`rid.reactenz_reaction_id = ${id} OR wr.reaction_id = ${id} OR wr.kegg_reaction_id = ${id}`);
  }
  if (parsed.kind === "rhea") {
    const id = sqlString(parsed.value);
    const tagged = sqlString(`RHEA:${parsed.value}`);
    return enzymesLinkedToReactionClause(`wr.rhea_id = ${id} OR wr.rhea_id = ${tagged}`);
  }
  if (parsed.kind === "kegg") {
    const id = sqlString(parsed.value);
    return enzymesLinkedToReactionClause(`wr.kegg_reaction_id = ${id} OR rid.reactenz_reaction_id = ${id}`);
  }
  if (parsed.kind === "chebi") return enzymeChebiClause(parsed.value);
  if (parsed.kind === "metacyc") return enzymesLinkedToReactionClause(reactionMetacycClause(parsed.value));
  if (parsed.kind === "pmid") return enzymePmidClause(parsed.value);
  if (parsed.kind === "association_id" || parsed.kind === "structure") return "";
  const fts = ftsQuery(parsed.value);
  if (!fts) return "";
  const exact = `eid.reactenz_enzyme_id = ${sqlString(rawQuery)} OR we.biopart_id = ${sqlString(rawQuery)} OR eu.uniprot_accession = ${sqlString(rawQuery)} OR eu.uniprot_entry_name = ${sqlString(rawQuery)}`;
  const rowids = ftsMatchRowids("web_enzymes_fts", parsed.value);
  if (rowids) return `(${rowidInClause("we.rowid", rowids)} OR ${exact})`;
  const like = likeTokenClause([
    "eid.reactenz_enzyme_id",
    "we.biopart_id",
    "we.enzyme_name",
    "we.gene_name_primary",
    "we.organism",
    "we.protein_id",
    "eu.uniprot_accession",
    "eu.uniprot_entry_name",
  ], parsed.value);
  return like ? `(${like} OR ${exact})` : `(${exact})`;
}

function sortDirection(value?: string): "ASC" | "DESC" {
  return value?.toLowerCase() === "asc" ? "ASC" : "DESC";
}

function sortExpression(value: string | undefined, allowed: Record<string, string>, fallback: string): string {
  return value && allowed[value] ? allowed[value] : fallback;
}

function normalizedPage(value?: number): number {
  return Math.max(1, Math.floor(value ?? 1));
}

function normalizedPageSize(value?: number): number {
  if (!Number.isFinite(value)) return 20;
  return Math.max(1, Math.min(100, Math.floor(value as number)));
}

function normalizedExportLimit(value?: number): number {
  return Math.max(1, Math.min(Math.floor(value ?? 250000), 250000));
}

function normalizedEvidenceScore(value?: string): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(100, Math.floor(parsed)));
}

function normalizedNonNegativeInt(value?: string): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor(parsed));
}

function paged<T>(rows: T[], total: number, page: number, pageSize: number): PagedResult<T> {
  return {
    rows,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function count(sql: string): number {
  return Number(querySqliteStable<{ total: number }>(DB_PATH, sql)[0]?.total ?? 0);
}

function query<T>(sql: string): T[] {
  return querySqlite<T>(DB_PATH, sql);
}

export function getReportedExperimentalObservations(biopartId: string) {
  const expression = query<{ expression_id: string; host_name: string; strain_or_cell_line: string | null; yield_text: string; yield_basis: string; construct_note: string | null; solubility_status: string; activity_status: string; source_pmid: string | null }>(`
    SELECT expression_id,host_name,strain_or_cell_line,yield_text,yield_basis,construct_note,solubility_status,activity_status,source_pmid
    FROM web_expression_source_observations WHERE biopart_id=${sqlString(biopartId)} AND yield_lower_g_l IS NOT NULL ORDER BY expression_id
  `);
  const stability = query<{ observation_id: string; property_kind: string; value_text: string; source_pmids_json: string | null }>(`
    SELECT observation_id,property_kind,value_text,source_pmids_json FROM web_protein_stability_observations
    WHERE biopart_id=${sqlString(biopartId)} ORDER BY property_kind,observation_id
  `).map(row => ({ ...row, pmids: safeJsonParse<string[]>(row.source_pmids_json || "[]", []) }));
  return { expression, stability };
}

function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function imageUrl(imagePath: string | null): string | null {
  if (!imagePath) return null;
  const filename = imagePath.split("/").pop();
  return filename ? `/compound_images/${filename}` : null;
}

export function getStats(): StatMap {
  const rows = querySqliteStable<{ metric: string; value: string }>(DB_PATH, "SELECT metric, value FROM web_stats");
  return Object.fromEntries(rows.map((row) => [row.metric, Number(row.value)]));
}

export function getMethodologyQaStats(): MethodologyQaStats {
  const base = querySqliteStable<{
    reactions: number;
    gold: number;
    silver: number;
    smiles_complete: number;
    relations: number;
    references_total: number;
    references_with_pmid: number;
    attribute_evidence: number;
    attribute_evidence_with_pmid: number;
    kinetics: number;
    kinetics_with_pmid: number;
    integrity_failures: number;
  }>(DB_PATH, `
    SELECT
      (SELECT COUNT(*) FROM web_reactions) AS reactions,
      (SELECT COUNT(*) FROM web_reactions WHERE dataset_level = 'gold') AS gold,
      (SELECT COUNT(*) FROM web_reactions WHERE dataset_level = 'silver') AS silver,
      (SELECT COUNT(*) FROM web_reactions WHERE all_participants_have_smiles = 1) AS smiles_complete,
      (SELECT COUNT(*) FROM web_reaction_enzymes) AS relations,
      (SELECT COUNT(*) FROM web_entity_references) AS references_total,
      (SELECT COUNT(*) FROM web_entity_references WHERE pmid IS NOT NULL AND trim(pmid) <> '') AS references_with_pmid,
      (SELECT COUNT(*) FROM web_attribute_evidences) AS attribute_evidence,
      (SELECT COUNT(*) FROM web_attribute_evidences WHERE pmids_json IS NOT NULL AND trim(pmids_json) NOT IN ('', '[]')) AS attribute_evidence_with_pmid,
      (SELECT COUNT(*) FROM web_kinetics) AS kinetics,
      (SELECT COUNT(*) FROM web_kinetics WHERE pmids_json IS NOT NULL AND trim(pmids_json) NOT IN ('', '[]')) AS kinetics_with_pmid,
      (SELECT COUNT(*) FROM web_reaction_enzymes re LEFT JOIN web_reactions r ON r.reaction_id = re.reaction_id WHERE r.reaction_id IS NULL)
        + (SELECT COUNT(*) FROM web_reaction_enzymes re LEFT JOIN web_enzymes e ON e.biopart_id = re.biopart_id WHERE e.biopart_id IS NULL)
        + (SELECT COALESCE(SUM(n - 1), 0) FROM (SELECT COUNT(*) AS n FROM web_reaction_enzymes GROUP BY reaction_id, biopart_id, COALESCE(organism, '') HAVING COUNT(*) > 1))
        AS integrity_failures
  `)[0];
  const tiers = querySqliteStable<{ entity_type: string; evidence_tier: string; count: number }>(DB_PATH, `
    SELECT entity_type, evidence_tier, COUNT(*) AS count
    FROM web_evidence_scores
    GROUP BY entity_type, evidence_tier
    ORDER BY entity_type, CASE evidence_tier WHEN 'strong' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END
  `);
  return {
    reactions: Number(base?.reactions ?? 0),
    gold: Number(base?.gold ?? 0),
    silver: Number(base?.silver ?? 0),
    smilesComplete: Number(base?.smiles_complete ?? 0),
    relations: Number(base?.relations ?? 0),
    references: Number(base?.references_total ?? 0),
    referencesWithPmid: Number(base?.references_with_pmid ?? 0),
    attributeEvidence: Number(base?.attribute_evidence ?? 0),
    attributeEvidenceWithPmid: Number(base?.attribute_evidence_with_pmid ?? 0),
    kinetics: Number(base?.kinetics ?? 0),
    kineticsWithPmid: Number(base?.kinetics_with_pmid ?? 0),
    integrityFailures: Number(base?.integrity_failures ?? 0),
    tiers,
  };
}

export function searchReactions(params: {
  q?: string;
  dataset?: string;
  direction?: string;
  complete?: boolean;
  organism?: string;
  chassis?: string;
  sort?: string;
  dir?: string;
  limit?: number;
  page?: number;
  pageSize?: number;
  ec?: string;
  rhea?: string;
  kegg?: string;
  metacyc?: string;
  mnx?: string;
  minEnzymes?: string;
  maxEnzymes?: string;
  minParticipants?: string;
  maxParticipants?: string;
  minPairs?: string;
  maxPairs?: string;
  minKinetics?: string;
  maxKinetics?: string;
  minEvidenceScore?: string;
  maxEvidenceScore?: string;
  massBalance?: string;
  chargeBalance?: string;
  stereoStatus?: string;
  structureStatus?: string;
  exactRhea?: boolean;
  atomMapped?: boolean;
  conflictFree?: boolean;
  localPreviewReactionIds?: string[];
  chassisLabels?: string[];
  exactContext?: boolean;
  skipTotal?: boolean;
}): ReactionRow[] {
  return searchReactionsPage(params).rows;
}

export function searchReactionsPage(params: {
  q?: string;
  dataset?: string;
  direction?: string;
  complete?: boolean;
  organism?: string;
  chassis?: string;
  sort?: string;
  dir?: string;
  limit?: number;
  page?: number;
  pageSize?: number;
  ec?: string;
  rhea?: string;
  kegg?: string;
  metacyc?: string;
  mnx?: string;
  minEnzymes?: string;
  maxEnzymes?: string;
  minParticipants?: string;
  maxParticipants?: string;
  minPairs?: string;
  maxPairs?: string;
  minKinetics?: string;
  maxKinetics?: string;
  minEvidenceScore?: string;
  maxEvidenceScore?: string;
  massBalance?: string;
  chargeBalance?: string;
  stereoStatus?: string;
  structureStatus?: string;
  exactRhea?: boolean;
  atomMapped?: boolean;
  conflictFree?: boolean;
  localPreviewReactionIds?: string[];
  chassisLabels?: string[];
  exactContext?: boolean;
  skipTotal?: boolean;
}): PagedResult<ReactionRow> {
  const clauses: string[] = [];
  const rawQuery = params.q?.trim() ?? "";
  const textClause = rawQuery ? reactionTextSearchClause(rawQuery) : "";
  if (textClause) clauses.push(textClause);
  if (params.dataset === "gold") clauses.push("wr.dataset_level = 'gold'");
  if (params.dataset === "silver") clauses.push("wr.dataset_level = 'silver'");
  if (params.direction && params.direction !== "all") clauses.push(`wr.reaction_direction = ${sqlString(params.direction)}`);
  if (params.complete === true) clauses.push("wr.all_participants_have_smiles = 1");
  if (params.complete === false) clauses.push("wr.all_participants_have_smiles = 0");
  if (params.ec) clauses.push(reactionEcClause(String(params.ec).replace(/^(?:EC[:\s]*)/i, "")));
  if (params.rhea) {
    const rhea = exactFilterValue(String(params.rhea), /^(?:RHEA[:\s-]+)/i);
    const id = sqlString(rhea);
    clauses.push(`(wr.rhea_id = ${id} OR wr.rhea_id = ${sqlString(`RHEA:${rhea}`)})`);
  }
  if (params.kegg) {
    const kegg = exactFilterValue(String(params.kegg), /^(?:KEGG[:\s]*)/i).toUpperCase();
    clauses.push(`wr.kegg_reaction_id = ${sqlString(kegg)}`);
  }
  if (params.metacyc) {
    const metacyc = exactFilterValue(String(params.metacyc), /^(?:METACYC[:\s]*)/i);
    clauses.push(reactionMetacycClause(metacyc));
  }
  if (params.mnx) {
    const mnx = exactFilterValue(String(params.mnx), /^(?:MNXR[:\s]*)/i);
    clauses.push(`EXISTS (
      SELECT 1 FROM web_mnx_reaction_mappings mnx
      WHERE mnx.reaction_id = wr.reaction_id
        AND (mnx.mnx_reaction_id = ${sqlString(mnx)} OR mnx.mnx_reaction_id = ${sqlString(`MNXR${mnx.replace(/^MNXR/i, "")}`)})
    )`);
  }
  const reactionRanges: Array<[string, string | undefined, ">=" | "<="]> = [
    ["wr.enzyme_count", params.minEnzymes, ">="],
    ["wr.enzyme_count", params.maxEnzymes, "<="],
    ["wr.participant_count", params.minParticipants, ">="],
    ["wr.participant_count", params.maxParticipants, "<="],
    ["wr.enzyme_pair_count", params.minPairs, ">="],
    ["wr.enzyme_pair_count", params.maxPairs, "<="],
    ["wr.kinetics_count", params.minKinetics, ">="],
    ["wr.kinetics_count", params.maxKinetics, "<="],
  ];
  for (const [column, value, operator] of reactionRanges) {
    const parsed = normalizedNonNegativeInt(value);
    if (parsed !== null) clauses.push(`${column} ${operator} ${parsed}`);
  }
  const minEvidenceScore = normalizedEvidenceScore(params.minEvidenceScore);
  if (minEvidenceScore !== null) clauses.push(`COALESCE(es.evidence_score, 0) >= ${minEvidenceScore}`);
  const maxEvidenceScore = normalizedEvidenceScore(params.maxEvidenceScore);
  if (maxEvidenceScore !== null) clauses.push(`COALESCE(es.evidence_score, 0) <= ${maxEvidenceScore}`);
  if (params.organism) {
    const organismMatch = params.exactContext
      ? `= ${sqlString(params.organism)}`
      : `LIKE ${sqlString(`%${params.organism}%`)}`;
    clauses.push(`wr.reaction_id IN (
      SELECT DISTINCT reaction_id FROM web_reaction_enzymes
      WHERE organism ${organismMatch}
    )`);
  }
  if (params.chassis) {
    const chassisMatch = params.exactContext
      ? `= ${sqlString(params.chassis)}`
      : `LIKE ${sqlString(`%${params.chassis}%`)}`;
    clauses.push(`wr.reaction_id IN (
      SELECT DISTINCT reaction_id FROM web_chassis_records
      WHERE chassis_label ${chassisMatch}
    )`);
  }
  if (params.chassisLabels?.length) {
    clauses.push(`wr.reaction_id IN (
      SELECT DISTINCT reaction_id FROM web_chassis_records
      WHERE chassis_label IN (SELECT value FROM json_each(${sqlString(JSON.stringify(params.chassisLabels))}))
    )`);
  }
  if (params.localPreviewReactionIds) {
    // This list is produced by the local-only staging reader. Keep it separate
    // from public search/API parameters and preserve count/pagination semantics.
    clauses.push(params.localPreviewReactionIds.length
      ? `wr.reaction_id IN (SELECT value FROM json_each(${sqlString(JSON.stringify(params.localPreviewReactionIds))}))`
      : "1 = 0");
  }
  const standardizationFilters: ReactionStandardizationFilters = {
    massBalance: params.massBalance,
    chargeBalance: params.chargeBalance,
    stereoStatus: params.stereoStatus,
    structureStatus: params.structureStatus,
    exactRhea: params.exactRhea,
    atomMapped: params.atomMapped,
    conflictFree: params.conflictFree,
  };
  const standardizedReactionIds = getReactionIdsByStandardizationFilters(standardizationFilters);
  if (standardizedReactionIds) {
    clauses.push(standardizedReactionIds.length
      ? `wr.reaction_id IN (${standardizedReactionIds.map(sqlString).join(",")})`
      : "1 = 0");
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const pageSize = params.limit ? normalizedExportLimit(params.limit) : normalizedPageSize(params.pageSize);
  const page = normalizedPage(params.page);
  const offset = (page - 1) * pageSize;
  const completenessOrder = `(
    CASE WHEN wr.all_participants_have_smiles = 1 THEN 8 ELSE 0 END +
    CASE WHEN COALESCE(wr.smiles_count, 0) > 0 THEN 2 ELSE 0 END +
    CASE WHEN COALESCE(wr.missing_smiles_count, 0) = 0 THEN 2 ELSE 0 END +
    CASE WHEN COALESCE(wr.enzyme_count, 0) > 0 THEN 2 ELSE 0 END +
    CASE WHEN COALESCE(wr.kinetics_count, 0) > 0 THEN 2 ELSE 0 END +
    CASE WHEN wr.ec_number IS NOT NULL AND trim(wr.ec_number) <> '' THEN 1 ELSE 0 END +
    CASE WHEN wr.rhea_id IS NOT NULL AND trim(wr.rhea_id) <> '' THEN 1 ELSE 0 END +
    CASE WHEN wr.kegg_reaction_id IS NOT NULL AND trim(wr.kegg_reaction_id) <> '' THEN 1 ELSE 0 END +
    CASE WHEN wr.metacyc_reaction_id IS NOT NULL AND trim(wr.metacyc_reaction_id) <> '' THEN 1 ELSE 0 END +
    CASE WHEN wr.evidence_level IS NOT NULL AND trim(wr.evidence_level) <> '' THEN 1 ELSE 0 END +
    CASE WHEN wr.source_db IS NOT NULL AND trim(wr.source_db) <> '' THEN 1 ELSE 0 END
  )`;
  const orderBy = sortExpression(params.sort, {
    completeness: completenessOrder,
    reactenz_id: "rid.reactenz_reaction_id",
    equation: "wr.reaction_equation_display",
    direction: "wr.reaction_direction",
    enzymes: "wr.enzyme_count",
    pairs: "wr.enzyme_pair_count",
    kinetics: "wr.kinetics_count",
    structure: "wr.all_participants_have_smiles",
    enzyme_structure: "stru.structured_enzyme_count",
    pdb: "stru.pdb_enzyme_count",
    alphafold: "stru.alphafold_enzyme_count",
    evidence_score: "COALESCE(es.evidence_score, 0)",
    participants: "wr.participant_count",
    smiles: "wr.smiles_count",
    missing_smiles: "wr.missing_smiles_count",
    ec: "wr.ec_number",
    rhea: "wr.rhea_id",
  }, completenessOrder);
  const dir = sortDirection(params.dir);
  const total = params.skipTotal ? 0 : count(`
      SELECT COUNT(*) AS total
      FROM web_reactions wr
      JOIN web_reaction_ids rid ON rid.reaction_id = wr.reaction_id
      LEFT JOIN web_evidence_scores es ON es.entity_type = 'reaction' AND es.entity_id = wr.reaction_id
      ${where}
    `);
  const columns = `
    SELECT rid.reactenz_reaction_id,wr.reaction_id,wr.dataset_level,wr.reaction_direction,wr.reaction_equation_display,
           wr.enzyme_count, wr.enzyme_pair_count, wr.kinetics_count, wr.all_participants_have_smiles,
           wr.participant_count, wr.smiles_count, wr.missing_smiles_count,
           wr.ec_number, wr.rhea_id, wr.kegg_reaction_id, wr.metacyc_reaction_id,
           (
             SELECT GROUP_CONCAT(DISTINCT mnx.mnx_reaction_id)
             FROM web_mnx_reaction_mappings mnx
             WHERE mnx.reaction_id = wr.reaction_id
           ) AS mnx_reaction_ids,
           COALESCE(stru.pdb_enzyme_count, 0) AS pdb_enzyme_count,
           COALESCE(stru.alphafold_enzyme_count, 0) AS alphafold_enzyme_count,
           COALESCE(stru.structured_enzyme_count, 0) AS structured_enzyme_count,
           COALESCE(es.evidence_score, 0) AS evidence_score,
           es.evidence_tier,
           wr.evidence_level,
           wr.source_db`;
  const structureCounts = (filter: string) => `
    LEFT JOIN (
      SELECT
        re.reaction_id,
        COUNT(DISTINCT p.biopart_id) AS pdb_enzyme_count,
        COUNT(DISTINCT af.biopart_id) AS alphafold_enzyme_count,
        COUNT(DISTINCT CASE WHEN p.biopart_id IS NOT NULL OR af.biopart_id IS NOT NULL THEN re.biopart_id END) AS structured_enzyme_count
      FROM web_reaction_enzymes re
      LEFT JOIN (SELECT DISTINCT biopart_id FROM web_pdb_mappings) p ON p.biopart_id = re.biopart_id
      LEFT JOIN (SELECT DISTINCT biopart_id FROM web_alphafold_mappings) af ON af.biopart_id = re.biopart_id
      ${filter}
      GROUP BY re.reaction_id
    ) stru ON stru.reaction_id = wr.reaction_id`;
  // Structure counts aggregate every reaction-enzyme pair, so unless the sort
  // needs them, pick the page first and aggregate only its reactions.
  const rows = orderBy.includes("stru.") ? query<ReactionRow>(`
    ${columns}
    FROM web_reactions wr
    JOIN web_reaction_ids rid ON rid.reaction_id = wr.reaction_id
    LEFT JOIN web_evidence_scores es ON es.entity_type = 'reaction' AND es.entity_id = wr.reaction_id
    ${structureCounts("")}
    ${where}
    ORDER BY ${orderBy} ${dir}, wr.reaction_id ASC
    LIMIT ${pageSize} OFFSET ${offset}
  `) : query<ReactionRow>(`
    WITH page AS (
      SELECT wr.reaction_id, ${orderBy} AS sort_key
      FROM web_reactions wr
      JOIN web_reaction_ids rid ON rid.reaction_id = wr.reaction_id
      LEFT JOIN web_evidence_scores es ON es.entity_type = 'reaction' AND es.entity_id = wr.reaction_id
      ${where}
      ORDER BY ${orderBy} ${dir}, wr.reaction_id ASC
      LIMIT ${pageSize} OFFSET ${offset}
    )
    ${columns}
    FROM page
    JOIN web_reactions wr ON wr.reaction_id = page.reaction_id
    JOIN web_reaction_ids rid ON rid.reaction_id = wr.reaction_id
    LEFT JOIN web_evidence_scores es ON es.entity_type = 'reaction' AND es.entity_id = wr.reaction_id
    ${structureCounts("WHERE re.reaction_id IN (SELECT reaction_id FROM page)")}
    ORDER BY page.sort_key ${dir}, page.reaction_id ASC
  `);
  const standardizationFacets = getReactionStandardizationFacets(rows.map((row) => row.reaction_id ?? ""));
  const enrichedRows = rows.map((row) => {
    const facet = row.reaction_id ? standardizationFacets.get(row.reaction_id) : null;
    return facet ? {
      ...row,
      standardization_status: facet.standardization_status,
      standardized_structure_status: facet.structure_completeness_status,
      stereo_completeness_status: facet.stereo_completeness_status,
      full_mass_balance_status: facet.full_mass_balance_status,
      full_charge_balance_status: facet.full_charge_balance_status,
      exact_rhea_identity: facet.exact_rhea_identity,
      atom_mapping_available: facet.atom_mapping_available,
      mapping_conflict_count: facet.mapping_conflict_count,
    } : row;
  });
  return paged(enrichedRows, params.skipTotal ? enrichedRows.length : total, page, pageSize);
}

// Public IDs whose detail pages resolve, using the same joins as getReaction / getEnzyme.
export function listSitemapReactionIds(): string[] {
  return querySqliteStable<{ id: string }>(DB_PATH, `
    SELECT rid.reactenz_reaction_id AS id
    FROM web_reactions wr
    JOIN web_reaction_ids rid ON rid.reaction_id = wr.reaction_id
    ORDER BY rid.reactenz_reaction_id
  `).map((row) => row.id);
}

export function listSitemapEnzymeIds(): string[] {
  return querySqliteStable<{ id: string }>(DB_PATH, `
    SELECT eid.reactenz_enzyme_id AS id
    FROM web_enzymes we
    JOIN web_enzyme_ids eid ON eid.biopart_id = we.biopart_id
    JOIN web_enzyme_browse_summary bs ON bs.biopart_id = we.biopart_id
    ORDER BY eid.reactenz_enzyme_id
  `).map((row) => row.id);
}

export function getReaction(reactionId: string): ReactionDetail | null {
  const rows = query<ReactionDetail>(`
    SELECT rid.reactenz_reaction_id, wr.*,
           COALESCE(es.evidence_score, 0) AS evidence_score,
           es.evidence_tier
    FROM web_reactions wr
    JOIN web_reaction_ids rid ON rid.reaction_id = wr.reaction_id
    LEFT JOIN web_evidence_scores es ON es.entity_type = 'reaction' AND es.entity_id = wr.reaction_id
    WHERE wr.reaction_id = ${sqlString(reactionId)} OR rid.reactenz_reaction_id = ${sqlString(reactionId)}
    LIMIT 1
  `);
  return rows[0] ?? null;
}

export function getReactionCompounds(reactionId: string): CompoundParticipant[] {
  return query<CompoundParticipant>(`
    SELECT c.compound_id, c.role, c.side, c.position_index, c.compound_name, c.formula,
           c.smiles, c.chebi_id, c.pubchem_id,
           (
             SELECT GROUP_CONCAT(DISTINCT m.mnx_compound_id)
             FROM web_mnx_compound_mappings m
             WHERE m.compound_id = c.compound_id
           ) AS mnx_compound_ids,
           c.structure_status, i.image_path, i.image_status
    FROM web_reaction_compounds c
    LEFT JOIN web_compound_images i ON i.compound_id = c.compound_id
    WHERE c.reaction_id = ${sqlString(reactionId)}
    ORDER BY c.side, c.position_index
  `);
}

export function getReactionEnzymes(reactionId: string, limit = 120): EnzymeLink[] {
  return query<EnzymeLink>(`
    SELECT eid.reactenz_enzyme_id, oid.reactenz_organism_id, re.biopart_id, re.enzyme_name, re.gene_name_primary, re.organism,
           re.taxonomy_id, re.protein_id, eu.uniprot_accession, eu.uniprot_entry_name, eu.uniprot_url, eu.uniprot_mapping_method,
           re.sequence_length, re.has_sequence,
           re.evidence_level, re.source_db
    FROM web_reaction_enzymes re
    JOIN web_enzyme_ids eid ON eid.biopart_id = re.biopart_id
    LEFT JOIN web_enzyme_uniprot eu ON eu.biopart_id = re.biopart_id
    LEFT JOIN web_organism_ids oid ON oid.organism = re.organism
    WHERE re.reaction_id = ${sqlString(reactionId)}
    ORDER BY re.has_sequence DESC, re.organism, eid.reactenz_enzyme_id
    LIMIT ${normalizedExportLimit(limit)}
  `);
}

export function getReactionKinetics(reactionId: string, limit = 120, offset = 0): KineticRow[] {
  return query<KineticRow>(`
    SELECT k.kinetic_id, k.biopart_id, eid.reactenz_enzyme_id, k.parameter_type, k.value_text, k.value_numeric, k.unit,
           k.subject_name, k.condition_text, k.source_db, k.reaction_assignment_status,
           k.reaction_assignment_method, k.evidence_text, k.pmids_json
    FROM web_kinetics k
    LEFT JOIN web_enzyme_ids eid ON eid.biopart_id = k.biopart_id
    WHERE k.reaction_id = ${sqlString(reactionId)}
    ORDER BY CASE k.parameter_type WHEN 'kcat' THEN 0 WHEN 'kcat_km' THEN 1 WHEN 'km' THEN 2 ELSE 3 END, k.biopart_id, k.kinetic_id
    LIMIT ${normalizedExportLimit(limit)}
    OFFSET ${Number.isSafeInteger(offset) && offset >= 0 ? offset : 0}
  `);
}

export function getReactionKineticExternalChecks(reactionId: string, limit = 500): KineticExternalCheckRow[] {
  return query<KineticExternalCheckRow>(`
    SELECT c.check_id, c.kinetic_id, c.source_db, c.match_status, c.match_score, c.match_reason,
           c.external_kinetic_id, c.external_entry_id, c.ec_number, c.external_parameter_type,
           c.external_value_numeric, c.external_unit, c.external_normalized_value, c.external_normalized_unit,
           c.external_substrate, c.external_organism, c.external_ph, c.external_temperature,
           c.external_pubmed_id, c.source_url, c.updated_at
    FROM web_kinetic_external_checks c
    JOIN web_kinetics k ON k.kinetic_id = c.kinetic_id
    WHERE k.reaction_id = ${sqlString(reactionId)}
    ORDER BY CASE c.match_status
      WHEN 'matched' THEN 0
      WHEN 'weak_match' THEN 1
      WHEN 'ec_parameter_only' THEN 2
      ELSE 3
    END, c.match_score DESC, c.kinetic_id
    LIMIT ${normalizedExportLimit(limit)}
  `);
}

export function getReactionReferences(reactionId: string, limit = 40): ReferenceRow[] {
  return query<ReferenceRow>(`
    SELECT reference_id, entity_type, entity_id, pmid, citation_text, reference_url, source_db
    FROM web_entity_references
    WHERE entity_type = 'reaction' AND entity_id = ${sqlString(reactionId)}
    ORDER BY pmid
    LIMIT ${normalizedExportLimit(limit)}
  `);
}

export function getReactionAttributeEvidences(reactionId: string, limit = 80): AttributeEvidenceRow[] {
  return query<AttributeEvidenceRow>(`
    SELECT ae.attribute_evidence_id, ae.entity_type, ae.entity_id, ae.attribute_name,
           ae.value_text, ae.value_numeric, ae.unit, ae.source_label, ae.source_db,
           ae.external_id, ae.external_url, ae.pmids_json, ae.citations_json,
           eid.reactenz_enzyme_id AS related_reactenz_id,
           re.enzyme_name AS related_name
    FROM web_attribute_evidences ae
    JOIN web_reaction_enzymes re
      ON ae.entity_type = 'biopart_reaction'
     AND ae.entity_id = re.biopart_id || '::' || re.reaction_id
    JOIN web_enzyme_ids eid ON eid.biopart_id = re.biopart_id
    WHERE re.reaction_id = ${sqlString(reactionId)}
    ORDER BY ae.attribute_name, eid.reactenz_enzyme_id, ae.value_text
    LIMIT ${normalizedExportLimit(limit)}
  `);
}

export function getReactionAttributeExternalChecks(reactionId: string, limit = 500): AttributeExternalCheckRow[] {
  return query<AttributeExternalCheckRow>(`
    SELECT c.check_id, c.attribute_evidence_id, c.source_db, c.match_status, c.match_score, c.match_reason,
           c.external_attribute_id, c.ec_number, c.external_attribute_name, c.external_value_numeric,
           c.external_value_maximum, c.external_unit, c.external_organism, c.external_literature_ids,
           c.external_commentary, c.source_url, c.updated_at
    FROM web_attribute_external_checks c
    JOIN web_attribute_evidences ae ON ae.attribute_evidence_id = c.attribute_evidence_id
    WHERE ae.entity_type = 'biopart_reaction'
      AND substr(ae.entity_id, instr(ae.entity_id, '::') + 2) = ${sqlString(reactionId)}
    ORDER BY CASE c.match_status
      WHEN 'matched' THEN 0
      WHEN 'weak_match' THEN 1
      WHEN 'ec_attribute_only' THEN 2
      ELSE 3
    END, c.match_score DESC, c.attribute_evidence_id
    LIMIT ${normalizedExportLimit(limit)}
  `);
}

export function getReactionXrefs(reactionId: string): XrefRow[] {
  return query<XrefRow>(`
    SELECT xref_db, xref_value, xref_url, source_db
    FROM web_xrefs
    WHERE entity_type = 'reaction' AND entity_id = ${sqlString(reactionId)}
    ORDER BY xref_db, xref_value
  `);
}

export function getReactionMnxMappings(reactionId: string): MnxReactionMappingRow[] {
  return query<MnxReactionMappingRow>(`
    SELECT reaction_id, mnx_reaction_id, source_db, source_xref, source_value,
           source_equation, mapping_method, mnxref_version, source_url
    FROM web_mnx_reaction_mappings
    WHERE reaction_id = ${sqlString(reactionId)}
    ORDER BY mnx_reaction_id, source_db, source_xref
  `);
}

export function getReactionCompoundMnxMappings(reactionId: string): MnxCompoundMappingRow[] {
  return query<MnxCompoundMappingRow>(`
    SELECT DISTINCT m.compound_id, m.mnx_compound_id, m.source_db, m.source_xref, m.source_value,
           m.source_description, m.mapping_method, m.mnxref_version, m.source_url
    FROM web_reaction_compounds c
    JOIN web_mnx_compound_mappings m ON m.compound_id = c.compound_id
    WHERE c.reaction_id = ${sqlString(reactionId)}
    ORDER BY m.compound_id, m.mnx_compound_id, m.source_db
  `);
}

export function getReactionMcsaEntries(reactionId: string, limit = 20): McsaEntryRow[] {
  return query<McsaEntryRow>(`
    SELECT DISTINCT e.mcsa_id, e.enzyme_name, e.reference_uniprot_id, e.is_reference_uniprot_id,
           e.entry_url, e.description, e.all_ecs_json, e.mechanism_count, e.detailed_mechanism_count,
           e.residue_count, e.compound_count, e.pmids_json, e.dois_json,
           m.match_type, NULL AS matched_uniprot, m.ec_number AS matched_ec
    FROM web_mcsa_reaction_mappings m
    JOIN web_mcsa_entries e ON e.mcsa_id = m.mcsa_id
    WHERE m.reaction_id = ${sqlString(reactionId)}
    ORDER BY e.detailed_mechanism_count DESC, e.residue_count DESC, e.mcsa_id
    LIMIT ${normalizedExportLimit(limit)}
  `);
}

export function getReactionMcsaResidues(reactionId: string, limit = 120): McsaResidueRow[] {
  return query<McsaResidueRow>(`
    SELECT DISTINCT r.*
    FROM web_mcsa_residues r
    JOIN web_mcsa_reaction_mappings m ON m.mcsa_id = r.mcsa_id
    WHERE m.reaction_id = ${sqlString(reactionId)}
    ORDER BY r.mcsa_id, r.residue_index, r.uniprot_residue_position, r.pdb_id
    LIMIT ${normalizedExportLimit(limit)}
  `);
}

export function getReactionMcsaMechanisms(reactionId: string, limit = 20): McsaMechanismRow[] {
  return query<McsaMechanismRow>(`
    SELECT DISTINCT mech.*
    FROM web_mcsa_mechanisms mech
    JOIN web_mcsa_reaction_mappings m ON m.mcsa_id = mech.mcsa_id
    WHERE m.reaction_id = ${sqlString(reactionId)}
    ORDER BY mech.mcsa_id, mech.mechanism_id
    LIMIT ${normalizedExportLimit(limit)}
  `);
}

export function getReactionMcsaMechanismSteps(reactionId: string, limit = 160): McsaMechanismStepRow[] {
  return query<McsaMechanismStepRow>(`
    SELECT DISTINCT s.*
    FROM web_mcsa_mechanism_steps s
    JOIN web_mcsa_reaction_mappings m ON m.mcsa_id = s.mcsa_id
    WHERE m.reaction_id = ${sqlString(reactionId)}
    ORDER BY s.mcsa_id, s.mechanism_id, s.step_id
    LIMIT ${normalizedExportLimit(limit)}
  `);
}

export function getReactionMcsaCompounds(reactionId: string, limit = 120): McsaCompoundRow[] {
  return query<McsaCompoundRow>(`
    SELECT DISTINCT c.*
    FROM web_mcsa_compounds c
    JOIN web_mcsa_reaction_mappings m ON m.mcsa_id = c.mcsa_id
    WHERE m.reaction_id = ${sqlString(reactionId)}
    ORDER BY c.mcsa_id, c.compound_type, c.compound_index
    LIMIT ${normalizedExportLimit(limit)}
  `);
}

export function getReactionMcsaReferences(reactionId: string, limit = 120): McsaReferenceRow[] {
  return query<McsaReferenceRow>(`
    SELECT DISTINCT ref.*
    FROM web_mcsa_references ref
    JOIN web_mcsa_reaction_mappings m ON m.mcsa_id = ref.mcsa_id
    WHERE m.reaction_id = ${sqlString(reactionId)}
    ORDER BY ref.mcsa_id, ref.mechanism_id, ref.pubmed_id
    LIMIT ${normalizedExportLimit(limit)}
  `);
}

export function getReactionPathways(reactionId: string): PathwayRow[] {
  return query<PathwayRow>(`
    SELECT rp.source_db, rp.pathway_id, COALESCE(rp.pathway_name, p.pathway_name) AS pathway_name,
           p.pathway_url, rp.source_reaction_id, rp.mapping_method,
           p.evidence_source, p.release_date
    FROM web_reaction_pathways rp
    LEFT JOIN web_pathways p ON p.source_db = rp.source_db AND p.pathway_id = rp.pathway_id
    WHERE rp.reaction_id = ${sqlString(reactionId)}
    ORDER BY rp.source_db, rp.pathway_id
  `);
}

export function getSimilarReactions(reactionId: string, limit = 10): SimilarReactionRow[] {
  const reaction = getReaction(reactionId);
  if (!reaction) return [];

  const rows = query<SimilarReactionRow>(`
    WITH raw_features AS (
      SELECT reaction_id, compound_name, 'compound:' || compound_id AS feature
      FROM web_reaction_compounds
      WHERE compound_id IS NOT NULL AND trim(compound_id) <> ''
      UNION ALL
      SELECT reaction_id, compound_name, 'chebi:' || chebi_id AS feature
      FROM web_reaction_compounds
      WHERE chebi_id IS NOT NULL AND trim(chebi_id) <> ''
      UNION ALL
      SELECT reaction_id, compound_name, 'pubchem:' || pubchem_id AS feature
      FROM web_reaction_compounds
      WHERE pubchem_id IS NOT NULL AND trim(pubchem_id) <> ''
      UNION ALL
      SELECT reaction_id, compound_name, 'smiles:' || smiles AS feature
      FROM web_reaction_compounds
      WHERE smiles IS NOT NULL AND trim(smiles) <> ''
    ),
    feature_frequency AS (
      SELECT feature, COUNT(DISTINCT reaction_id) AS reaction_frequency
      FROM raw_features
      GROUP BY feature
    ),
    target_features AS (
      SELECT DISTINCT rf.feature, rf.compound_name
      FROM raw_features rf
      JOIN feature_frequency ff ON ff.feature = rf.feature
      WHERE rf.reaction_id = ${sqlString(reaction.reaction_id)}
        AND ff.reaction_frequency <= 500
    ),
    target_count AS (
      SELECT COUNT(DISTINCT feature) AS n FROM target_features
    ),
    candidate_counts AS (
      SELECT rf.reaction_id, COUNT(DISTINCT rf.feature) AS n
      FROM raw_features rf
      JOIN feature_frequency ff ON ff.feature = rf.feature
      WHERE ff.reaction_frequency <= 500
      GROUP BY rf.reaction_id
    ),
    matches AS (
      SELECT
        rf.reaction_id,
        COUNT(DISTINCT tf.feature) AS shared_feature_count,
        GROUP_CONCAT(DISTINCT tf.compound_name) AS shared_compounds
      FROM target_features tf
      JOIN raw_features rf ON rf.feature = tf.feature
      WHERE rf.reaction_id <> ${sqlString(reaction.reaction_id)}
      GROUP BY rf.reaction_id
    )
    SELECT
      rid.reactenz_reaction_id,
      wr.reaction_id,
      wr.reaction_direction,
      wr.reaction_equation_display,
      wr.enzyme_count,
      wr.kinetics_count,
      wr.all_participants_have_smiles,
      m.shared_feature_count,
      tc.n AS target_feature_count,
      cc.n AS candidate_feature_count,
      ROUND(1.0 * m.shared_feature_count / NULLIF(tc.n + cc.n - m.shared_feature_count, 0), 4) AS similarity_score,
      m.shared_compounds
    FROM matches m
    JOIN target_count tc
    JOIN candidate_counts cc ON cc.reaction_id = m.reaction_id
    JOIN web_reactions wr ON wr.reaction_id = m.reaction_id
    JOIN web_reaction_ids rid ON rid.reaction_id = wr.reaction_id
    WHERE m.shared_feature_count > 0
    ORDER BY similarity_score DESC, m.shared_feature_count DESC, wr.enzyme_count DESC, rid.reactenz_reaction_id
    LIMIT ${Math.min(normalizedExportLimit(limit), 50)}
  `);

  return rows;
}

export function searchReactionsByStructureInput(params: {
  substrates?: string;
  products?: string;
  query?: string;
  limit?: number;
  offset?: number;
  matchMode?: "complete" | "related";
}): { rows: StructureSimilarReactionRow[]; total: number } {
  const substrates = params.substrates?.trim() ?? "";
  const products = params.products?.trim() ?? "";
  const query = params.query?.trim() ?? "";
  const hasSides = Boolean(substrates || products);
  const queryForStructure = hasSides || looksLikeStructureQuery(query) ? query : "";
  const hasInput = Boolean(substrates || products || queryForStructure);
  if (!hasInput) return { rows: [], total: 0 };
  try {
    const output = execFileSync(
      PYTHON_PATH,
      [
        SMILES_SEARCH_SCRIPT,
        "--db",
        DB_PATH,
        "--substrates",
        substrates,
        "--products",
        products,
        "--query",
        queryForStructure,
        "--limit",
        String(Math.min(normalizedExportLimit(params.limit ?? 12), 50)),
        "--offset", String(Math.max(0, Math.min(1_000_000, Math.floor(params.offset ?? 0)))),
        "--match-mode", params.matchMode ?? "complete",
      ],
      {
        encoding: "utf8",
        timeout: 15000,
        maxBuffer: 1024 * 1024 * 32,
      },
    );
    const parsed = safeJsonParse<{ rows?: StructureSimilarReactionRow[]; total?: number }>(output, { rows: [], total: 0 });
    const rows = parsed.rows ?? [];
    return { rows, total: parsed.total ?? rows.length };
  } catch {
    return { rows: [], total: 0 };
  }
}

function exactSmilesTerms(value: string): string[] {
  return Array.from(new Set(value.split(".").map((item) => item.trim()).filter(Boolean)));
}

function canonicalizeSmilesTerms(value: string): string[] {
  const raw = exactSmilesTerms(value);
  if (!raw.length) return [];
  if (!fs.existsSync(SMILES_SEARCH_SCRIPT) || !fs.existsSync(PYTHON_PATH)) return raw;
  try {
    const output = execFileSync(PYTHON_PATH, [SMILES_SEARCH_SCRIPT, "--canonicalize"], {
      input: JSON.stringify(raw),
      encoding: "utf8",
      timeout: 8000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    const parsed = safeJsonParse<{ canonical?: string[]; invalid?: boolean }>(output, { canonical: [], invalid: true });
    if (parsed.invalid || !Array.isArray(parsed.canonical) || !parsed.canonical.length) return [];
    return parsed.canonical;
  } catch {
    return raw;
  }
}

export function findExactRetrosynthesisReactionMatches(params: {
  substrates: string;
  products: string;
  limit?: number;
}): ExactRetrosynthesisReactionMatch[] {
  if (!fs.existsSync(RETROSYNTHESIS_LOOKUP_DB_PATH)) return [];
  const left = canonicalizeSmilesTerms(params.substrates);
  const right = canonicalizeSmilesTerms(params.products);
  if (!left.length || !right.length) return [];
  const leftSql = left.map(sqlString).join(", ");
  const rightSql = right.map(sqlString).join(", ");
  const rows = querySqlite<{ reaction_id: string; side: "left" | "right"; canonical_smiles: string }>(
    RETROSYNTHESIS_LOOKUP_DB_PATH,
    `
      SELECT reaction_id, side, canonical_smiles
      FROM reaction_participants
      WHERE (side = 'left' AND canonical_smiles IN (${leftSql}))
         OR (side = 'right' AND canonical_smiles IN (${rightSql}))
    `,
  );
  const grouped = new Map<string, { left: Set<string>; right: Set<string> }>();
  for (const row of rows) {
    const entry = grouped.get(row.reaction_id) ?? { left: new Set<string>(), right: new Set<string>() };
    entry[row.side].add(row.canonical_smiles);
    grouped.set(row.reaction_id, entry);
  }
  const matches: ExactRetrosynthesisReactionMatch[] = [];
  for (const [reaction_id, matched] of grouped) {
    if (!left.every((value) => matched.left.has(value)) || !right.every((value) => matched.right.has(value))) continue;
    const reaction = getReaction(reaction_id);
    if (!reaction) continue;
    matches.push({
      reaction_id,
      reactenz_reaction_id: reaction.reactenz_reaction_id,
      matched_left_count: matched.left.size,
      matched_right_count: matched.right.size,
      query_left_count: left.length,
      query_right_count: right.length,
    });
  }
  return matches
    .sort((a, b) => (b.matched_left_count + b.matched_right_count) - (a.matched_left_count + a.matched_right_count) || a.reactenz_reaction_id.localeCompare(b.reactenz_reaction_id))
    .slice(0, Math.min(Math.max(1, params.limit ?? 8), 20));
}

function ecPrefix(ec: string | null | undefined): string {
  if (!ec) return "";
  const first = ec.split(/[;,|]/)[0]?.trim() ?? "";
  const match = first.match(/(\d+)(?:\.(\d+|-))?(?:\.(\d+|-))?(?:\.(\d+|-))?/);
  if (!match) return "";
  const parts = [match[1], match[2], match[3]].filter((part) => part && part !== "-");
  return parts.length ? parts.join(".") : "";
}

function ecFromText(value: string): string {
  const match = value.match(/(?:EC[:\s]*)?(\d+\.(?:\d+|-)\.(?:\d+|-)\.(?:\d+|-))/i);
  return match?.[1] ?? "";
}

export function getEcClassReactions(ecNumber: string | null | undefined, excludeReactionId?: string, limit = 12): ReactionRow[] {
  const prefix = ecPrefix(ecNumber);
  if (!prefix) return [];
  const clauses = [`wr.ec_number LIKE ${sqlString(`${prefix}.%`)}`];
  if (excludeReactionId) clauses.push(`wr.reaction_id <> ${sqlString(excludeReactionId)}`);
  return query<ReactionRow>(`
    SELECT rid.reactenz_reaction_id, wr.reaction_id, wr.reaction_direction, wr.reaction_equation_display,
           wr.enzyme_count, wr.enzyme_pair_count, wr.kinetics_count, wr.all_participants_have_smiles,
           wr.participant_count, wr.smiles_count, wr.missing_smiles_count,
           wr.ec_number, wr.rhea_id, wr.kegg_reaction_id, wr.metacyc_reaction_id,
           (
             SELECT GROUP_CONCAT(DISTINCT mnx.mnx_reaction_id)
             FROM web_mnx_reaction_mappings mnx
             WHERE mnx.reaction_id = wr.reaction_id
           ) AS mnx_reaction_ids
    FROM web_reactions wr
    JOIN web_reaction_ids rid ON rid.reaction_id = wr.reaction_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY wr.enzyme_count DESC, wr.kinetics_count DESC, rid.reactenz_reaction_id
    LIMIT ${Math.min(normalizedExportLimit(limit), 50)}
  `);
}

export function searchEnzymes(params: {
  q?: string;
  sequenceOnly?: boolean;
  organism?: string;
  reactionId?: string;
  chassis?: string;
  sort?: string;
  dir?: string;
  limit?: number;
  page?: number;
  pageSize?: number;
  sequence?: string;
  gene?: string;
  taxonomy?: string;
  proteinId?: string;
  uniprot?: string;
  minLength?: string;
  maxLength?: string;
  minReactions?: string;
  maxReactions?: string;
  minPdb?: string;
  maxPdb?: string;
  minAlphaFold?: string;
  maxAlphaFold?: string;
  minKinetics?: string;
  maxKinetics?: string;
  minChassis?: string;
  maxChassis?: string;
  hasPdb?: string;
  hasAlphaFold?: string;
  hasStructure?: string;
  hasKinetics?: string;
  minEvidenceScore?: string;
  maxEvidenceScore?: string;
  hasInterPro?: string;
  hasHighConfidenceStructure?: string;
  hasCatalyticSiteSupport?: string;
  minStructureConfidenceScore?: string;
  chassisLabels?: string[];
  exactContext?: boolean;
  skipTotal?: boolean;
}): EnzymeRow[] {
  return searchEnzymesPage(params).rows;
}

export function searchEnzymesPage(params: {
  q?: string;
  sequenceOnly?: boolean;
  organism?: string;
  reactionId?: string;
  chassis?: string;
  sort?: string;
  dir?: string;
  limit?: number;
  page?: number;
  pageSize?: number;
  sequence?: string;
  gene?: string;
  taxonomy?: string;
  proteinId?: string;
  uniprot?: string;
  minLength?: string;
  maxLength?: string;
  minReactions?: string;
  maxReactions?: string;
  minPdb?: string;
  maxPdb?: string;
  minAlphaFold?: string;
  maxAlphaFold?: string;
  minKinetics?: string;
  maxKinetics?: string;
  minChassis?: string;
  maxChassis?: string;
  hasPdb?: string;
  hasAlphaFold?: string;
  hasStructure?: string;
  hasKinetics?: string;
  minEvidenceScore?: string;
  maxEvidenceScore?: string;
  hasInterPro?: string;
  hasHighConfidenceStructure?: string;
  hasCatalyticSiteSupport?: string;
  minStructureConfidenceScore?: string;
  chassisLabels?: string[];
  exactContext?: boolean;
  skipTotal?: boolean;
}): PagedResult<EnzymeRow> {
  const clauses: string[] = [];
  const rawQuery = params.q?.trim() ?? "";
  const textClause = rawQuery ? enzymeTextSearchClause(rawQuery) : "";
  if (textClause) clauses.push(textClause);
  if (params.sequenceOnly) clauses.push("we.has_sequence = 1");
  if (params.sequence === "yes") clauses.push("we.has_sequence = 1");
  if (params.sequence === "no") clauses.push("we.has_sequence = 0");
  if (params.organism) {
    clauses.push(params.exactContext
      ? `we.organism = ${sqlString(params.organism)}`
      : `we.organism LIKE ${sqlString(`%${params.organism}%`)}`);
  }
  if (params.gene) {
    const gene = params.gene.trim();
    clauses.push(/^[A-Za-z][A-Za-z0-9._-]{0,24}$/.test(gene)
      ? `we.gene_name_primary LIKE ${sqlString(gene)}`
      : `we.gene_name_primary LIKE ${sqlString(`%${gene}%`)}`);
  }
  if (params.taxonomy) {
    const taxonomy = params.taxonomy.trim();
    clauses.push(/^\d{2,}$/.test(taxonomy)
      ? `we.taxonomy_id = ${sqlString(taxonomy)}`
      : `we.taxonomy_id LIKE ${sqlString(`%${taxonomy}%`)}`);
  }
  if (params.proteinId) {
    const proteinId = params.proteinId.trim();
    clauses.push(/^[A-Za-z0-9._-]{4,20}$/.test(proteinId)
      ? `we.protein_id LIKE ${sqlString(proteinId)}`
      : `we.protein_id LIKE ${sqlString(`%${proteinId}%`)}`);
  }
  if (params.uniprot) {
    const uniprot = params.uniprot.trim().toUpperCase();
    clauses.push(`(eu.uniprot_accession = ${sqlString(uniprot)} OR eu.uniprot_entry_name = ${sqlString(uniprot)})`);
  }
  if (params.minLength && Number.isFinite(Number(params.minLength))) clauses.push(`we.sequence_length >= ${Math.max(0, Math.floor(Number(params.minLength)))}`);
  if (params.maxLength && Number.isFinite(Number(params.maxLength))) clauses.push(`we.sequence_length <= ${Math.max(0, Math.floor(Number(params.maxLength)))}`);
  if (params.minReactions && Number.isFinite(Number(params.minReactions))) clauses.push(`we.reaction_count >= ${Math.max(0, Math.floor(Number(params.minReactions)))}`);
  const enzymeRanges: Array<[string, string | undefined, ">=" | "<="]> = [
    ["we.reaction_count", params.maxReactions, "<="],
    ["bs.pdb_count", params.minPdb, ">="],
    ["bs.pdb_count", params.maxPdb, "<="],
    ["bs.alphafold_count", params.minAlphaFold, ">="],
    ["bs.alphafold_count", params.maxAlphaFold, "<="],
    ["bs.kinetic_count", params.minKinetics, ">="],
    ["bs.kinetic_count", params.maxKinetics, "<="],
    ["bs.chassis_count", params.minChassis, ">="],
    ["bs.chassis_count", params.maxChassis, "<="],
  ];
  for (const [column, value, operator] of enzymeRanges) {
    const parsed = normalizedNonNegativeInt(value);
    if (parsed !== null) clauses.push(`${column} ${operator} ${parsed}`);
  }
  if (params.reactionId) {
    clauses.push(`we.biopart_id IN (
      SELECT DISTINCT re.biopart_id
      FROM web_reaction_enzymes re
      JOIN web_reaction_ids rid ON rid.reaction_id = re.reaction_id
      WHERE re.reaction_id = ${sqlString(params.reactionId)}
         OR rid.reactenz_reaction_id = ${sqlString(params.reactionId)}
    )`);
  }
  if (params.chassis) {
    const chassisMatch = params.exactContext
      ? `= ${sqlString(params.chassis)}`
      : `LIKE ${sqlString(`%${params.chassis}%`)}`;
    clauses.push(`we.biopart_id IN (
      SELECT DISTINCT biopart_id FROM web_chassis_records
      WHERE chassis_label ${chassisMatch}
    )`);
  }
  if (params.chassisLabels?.length) {
    clauses.push(`we.biopart_id IN (
      SELECT DISTINCT biopart_id FROM web_chassis_records
      WHERE chassis_label IN (SELECT value FROM json_each(${sqlString(JSON.stringify(params.chassisLabels))}))
    )`);
  }
  if (params.hasPdb === "yes") clauses.push("bs.pdb_count > 0");
  if (params.hasPdb === "no") clauses.push("bs.pdb_count = 0");
  if (params.hasAlphaFold === "yes") clauses.push("bs.alphafold_count > 0");
  if (params.hasAlphaFold === "no") clauses.push("bs.alphafold_count = 0");
  if (params.hasStructure === "yes") clauses.push("(bs.pdb_count > 0 OR bs.alphafold_count > 0)");
  if (params.hasStructure === "no") clauses.push("(bs.pdb_count = 0 AND bs.alphafold_count = 0)");
  if (params.hasKinetics === "yes") clauses.push("bs.kinetic_count > 0");
  if (params.hasKinetics === "no") clauses.push("bs.kinetic_count = 0");
  if (params.hasInterPro === "yes") clauses.push("COALESCE(pa.interpro_count, 0) > 0");
  if (params.hasInterPro === "no") clauses.push("COALESCE(pa.interpro_count, 0) = 0");
  if (params.hasHighConfidenceStructure === "yes") clauses.push("COALESCE(sc.has_high_confidence_structure, 0) = 1");
  if (params.hasHighConfidenceStructure === "no") clauses.push("COALESCE(sc.has_high_confidence_structure, 0) = 0");
  if (params.hasCatalyticSiteSupport === "yes") clauses.push("COALESCE(sc.catalytic_site_support_level, 'none') <> 'none'");
  if (params.hasCatalyticSiteSupport === "no") clauses.push("COALESCE(sc.catalytic_site_support_level, 'none') = 'none'");
  if (params.minStructureConfidenceScore && Number.isFinite(Number(params.minStructureConfidenceScore))) {
    clauses.push(`COALESCE(sc.structure_confidence_score, 0) >= ${Math.max(0, Math.min(100, Math.floor(Number(params.minStructureConfidenceScore))))}`);
  }
  const minEvidenceScore = normalizedEvidenceScore(params.minEvidenceScore);
  if (minEvidenceScore !== null) clauses.push(`COALESCE(es.evidence_score, 0) >= ${minEvidenceScore}`);
  const maxEvidenceScore = normalizedEvidenceScore(params.maxEvidenceScore);
  if (maxEvidenceScore !== null) clauses.push(`COALESCE(es.evidence_score, 0) <= ${maxEvidenceScore}`);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const pageSize = params.limit ? normalizedExportLimit(params.limit) : normalizedPageSize(params.pageSize);
  const page = normalizedPage(params.page);
  const offset = (page - 1) * pageSize;
  const completenessOrder = "bs.browse_completeness";
  const orderBy = sortExpression(params.sort, {
    completeness: completenessOrder,
    reactenz_id: "eid.reactenz_enzyme_id",
    uniprot: "eu.uniprot_accession",
    enzyme: "we.enzyme_name",
    gene: "we.gene_name_primary",
    organism: "we.organism",
    taxonomy: "we.taxonomy_id",
    sequence: "we.sequence_length",
    sequence_status: "we.has_sequence",
    reactions: "we.reaction_count",
    pdb: "bs.pdb_count",
    alphafold: "bs.alphafold_count",
    structure: "(bs.pdb_count + bs.alphafold_count)",
    kinetics: "bs.kinetic_count",
    chassis: "bs.chassis_count",
    evidence_score: "COALESCE(es.evidence_score, 0)",
    interpro: "pa.interpro_count",
    pfam: "pa.pfam_count",
    protein_sites: "(COALESCE(pa.active_site_count, 0) + COALESCE(pa.binding_site_count, 0) + COALESCE(pa.conserved_site_count, 0))",
    structure_confidence: "COALESCE(sc.structure_confidence_score, 0)",
    catalytic_site_support: "CASE WHEN COALESCE(sc.catalytic_site_support_level, 'none') <> 'none' THEN 1 ELSE 0 END",
  }, completenessOrder);
  const dir = sortDirection(params.dir);
  const from = `
    SELECT eid.reactenz_enzyme_id, oid.reactenz_organism_id, we.biopart_id, we.protein_id, eu.uniprot_accession, eu.uniprot_entry_name, eu.uniprot_url, eu.uniprot_mapping_method,
           we.enzyme_name, we.gene_name_primary, we.organism,
           we.taxonomy_id, NULL as protein_sequence, we.has_sequence, we.sequence_length, we.reaction_count,
           bs.pdb_count,
           bs.alphafold_count,
           bs.pdb_count + bs.alphafold_count AS structure_count,
           bs.kinetic_count,
           bs.chassis_count,
           we.evidence_label,
           COALESCE(es.evidence_score, 0) AS evidence_score,
           es.evidence_tier,
           COALESCE(pa.interpro_count, 0) AS interpro_count,
           COALESCE(pa.pfam_count, 0) AS pfam_count,
           COALESCE(pa.domain_feature_count, 0) AS domain_feature_count,
           COALESCE(pa.active_site_count, 0) AS active_site_count,
           COALESCE(pa.binding_site_count, 0) AS binding_site_count,
           COALESCE(pa.conserved_site_count, 0) AS conserved_site_count,
           COALESCE(sc.structure_confidence_score, 0) AS structure_confidence_score,
           sc.structure_confidence_tier,
           COALESCE(sc.has_high_confidence_structure, 0) AS has_high_confidence_structure,
           sc.catalytic_site_support_level
    FROM web_enzyme_browse_summary bs
    JOIN web_enzymes we ON we.biopart_id = bs.biopart_id
    JOIN web_enzyme_ids eid ON eid.biopart_id = we.biopart_id
    LEFT JOIN web_enzyme_uniprot eu ON eu.biopart_id = we.biopart_id
    LEFT JOIN web_organism_ids oid ON oid.organism = we.organism
    LEFT JOIN web_evidence_scores es ON es.entity_type = 'enzyme' AND es.entity_id = we.biopart_id
    LEFT JOIN web_protein_annotations pa ON pa.biopart_id = we.biopart_id
    LEFT JOIN web_structure_confidence sc ON sc.biopart_id = we.biopart_id
  `;
  // Each optional table has at most one row per enzyme, so joining only the
  // ones the filter or sort references leaves the row set unchanged.
  const optionalJoins: Record<string, string> = {
    eu: "LEFT JOIN web_enzyme_uniprot eu ON eu.biopart_id = we.biopart_id",
    oid: "LEFT JOIN web_organism_ids oid ON oid.organism = we.organism",
    es: "LEFT JOIN web_evidence_scores es ON es.entity_type = 'enzyme' AND es.entity_id = we.biopart_id",
    pa: "LEFT JOIN web_protein_annotations pa ON pa.biopart_id = we.biopart_id",
    sc: "LEFT JOIN web_structure_confidence sc ON sc.biopart_id = we.biopart_id",
  };
  const referenced = `${where} ${orderBy}`;
  const filterJoins = `
    FROM web_enzyme_browse_summary bs
    JOIN web_enzymes we ON we.biopart_id = bs.biopart_id
    JOIN web_enzyme_ids eid ON eid.biopart_id = we.biopart_id
    ${Object.entries(optionalJoins).filter(([alias]) => new RegExp(`\\b${alias}\\.`).test(referenced)).map(([, join]) => join).join("\n    ")}
  `;
  const total = params.skipTotal ? 0 : count(`SELECT COUNT(*) AS total ${filterJoins} ${where}`);
  const rows = query<EnzymeRow>(`
    WITH page AS (
      SELECT we.biopart_id, ${orderBy} AS sort_key
      ${filterJoins}
      ${where}
      ORDER BY ${orderBy} ${dir}, we.biopart_id ASC
      LIMIT ${pageSize} OFFSET ${offset}
    )
    ${from.replace("FROM web_enzyme_browse_summary bs", "FROM page\n    JOIN web_enzyme_browse_summary bs ON bs.biopart_id = page.biopart_id")}
    ORDER BY page.sort_key ${dir}, page.biopart_id ASC
  `);
  return paged(rows, params.skipTotal ? rows.length : total, page, pageSize);
}

export function getEnzyme(biopartId: string): EnzymeDetail | null {
  const rows = query<EnzymeDetail>(`
    SELECT eid.reactenz_enzyme_id, oid.reactenz_organism_id, we.biopart_id, we.protein_id,
           eu.uniprot_accession, eu.uniprot_entry_name, eu.uniprot_url, eu.uniprot_mapping_method,
           we.enzyme_name, we.gene_name_primary,
           we.organism, we.taxonomy_id, we.lineage, we.protein_sequence, we.has_sequence, we.sequence_length,
           we.evidence_label, we.reaction_count,
           bs.pdb_count,
           bs.kinetic_count,
           bs.chassis_count,
           COALESCE(es.evidence_score, 0) AS evidence_score,
           es.evidence_tier
    FROM web_enzymes we
    JOIN web_enzyme_ids eid ON eid.biopart_id = we.biopart_id
    JOIN web_enzyme_browse_summary bs ON bs.biopart_id = we.biopart_id
    LEFT JOIN web_enzyme_uniprot eu ON eu.biopart_id = we.biopart_id
    LEFT JOIN web_organism_ids oid ON oid.organism = we.organism
    LEFT JOIN web_evidence_scores es ON es.entity_type = 'enzyme' AND es.entity_id = we.biopart_id
    WHERE we.biopart_id = ${sqlString(biopartId)} OR eid.reactenz_enzyme_id = ${sqlString(biopartId)}
    LIMIT 1
  `);
  return rows[0] ?? null;
}

export function getEnzymeReactions(biopartId: string, limit = 120): ReactionRow[] {
  return query<ReactionRow>(`
    SELECT rid.reactenz_reaction_id, wr.reaction_direction, wr.reaction_equation_display,
           wr.enzyme_count, wr.enzyme_pair_count, wr.kinetics_count, wr.all_participants_have_smiles
    FROM web_reaction_enzymes re
    JOIN web_reactions wr ON wr.reaction_id = re.reaction_id
    JOIN web_reaction_ids rid ON rid.reaction_id = wr.reaction_id
    WHERE re.biopart_id = ${sqlString(biopartId)}
    ORDER BY wr.dataset_level, rid.reactenz_reaction_id
    LIMIT ${normalizedExportLimit(limit)}
  `);
}

export function getPdbMappings(biopartId: string): PdbRow[] {
  return query<PdbRow>(`
    SELECT uniprot_id, pdb_id, chain_id, experimental_method, resolution,
           coverage, source_db, evidence_url
    FROM web_pdb_mappings
    WHERE biopart_id = ${sqlString(biopartId)}
    ORDER BY coverage DESC, resolution ASC
    LIMIT 200
  `);
}

export function getAlphaFoldMappings(biopartId: string): AlphaFoldRow[] {
  return query<AlphaFoldRow>(`
    SELECT uniprot_accession, status, model_entity_id, latest_version, global_metric_value,
           sequence_start, sequence_end, cif_url, pdb_url, bcif_url, pae_image_url,
           plddt_doc_url, pae_doc_url, source
    FROM web_alphafold_mappings
    WHERE biopart_id = ${sqlString(biopartId)}
    ORDER BY global_metric_value DESC, model_entity_id
    LIMIT 20
  `);
}

export function getEnzymeStructureConfidence(biopartId: string): StructureConfidenceRow | null {
  const rows = query<StructureConfidenceRow>(`
    SELECT sc.*
    FROM web_structure_confidence sc
    WHERE sc.biopart_id = ${sqlString(biopartId)}
    LIMIT 1
  `);
  return rows[0] ?? null;
}

export function getEnzymeKinetics(biopartId: string, limit = 160): KineticRow[] {
  return query<KineticRow>(`
    SELECT k.kinetic_id, k.biopart_id, eid.reactenz_enzyme_id, k.parameter_type, k.value_text, k.value_numeric, k.unit,
           k.subject_name, k.condition_text, k.source_db, k.reaction_assignment_status,
           k.reaction_assignment_method, k.evidence_text, k.pmids_json
    FROM web_kinetics k
    JOIN web_enzyme_ids eid ON eid.biopart_id = k.biopart_id
    WHERE k.biopart_id = ${sqlString(biopartId)}
    ORDER BY CASE k.parameter_type WHEN 'kcat' THEN 0 WHEN 'kcat_km' THEN 1 WHEN 'km' THEN 2 ELSE 3 END, k.reaction_id, k.subject_name
    LIMIT ${normalizedExportLimit(limit)}
  `);
}

export function getEnzymeKineticExternalChecks(biopartId: string, limit = 500): KineticExternalCheckRow[] {
  return query<KineticExternalCheckRow>(`
    SELECT c.check_id, c.kinetic_id, c.source_db, c.match_status, c.match_score, c.match_reason,
           c.external_kinetic_id, c.external_entry_id, c.ec_number, c.external_parameter_type,
           c.external_value_numeric, c.external_unit, c.external_normalized_value, c.external_normalized_unit,
           c.external_substrate, c.external_organism, c.external_ph, c.external_temperature,
           c.external_pubmed_id, c.source_url, c.updated_at
    FROM web_kinetic_external_checks c
    JOIN web_kinetics k ON k.kinetic_id = c.kinetic_id
    WHERE k.biopart_id = ${sqlString(biopartId)}
    ORDER BY CASE c.match_status
      WHEN 'matched' THEN 0
      WHEN 'weak_match' THEN 1
      WHEN 'ec_parameter_only' THEN 2
      ELSE 3
    END, c.match_score DESC, c.kinetic_id
    LIMIT ${normalizedExportLimit(limit)}
  `);
}

export function getEnzymeReferences(biopartId: string, limit = 60): ReferenceRow[] {
  return query<ReferenceRow>(`
    SELECT er.reference_id, er.entity_type, er.entity_id, er.pmid, er.citation_text, er.reference_url, er.source_db
    FROM web_entity_references er
    WHERE er.entity_type = 'enzyme'
      AND er.entity_id = ${sqlString(biopartId)}
    ORDER BY er.pmid
    LIMIT ${normalizedExportLimit(limit)}
  `);
}

export function getEnzymeAttributeEvidences(biopartId: string, limit = 80): AttributeEvidenceRow[] {
  return query<AttributeEvidenceRow>(`
    SELECT ae.attribute_evidence_id, ae.entity_type, ae.entity_id, ae.attribute_name,
           ae.value_text, ae.value_numeric, ae.unit, ae.source_label, ae.source_db,
           ae.external_id, ae.external_url, ae.pmids_json, ae.citations_json,
           NULL AS related_reactenz_id,
           NULL AS related_name
    FROM web_attribute_evidences ae
    WHERE ae.entity_type = 'enzyme'
      AND ae.entity_id = ${sqlString(biopartId)}
    ORDER BY ae.attribute_name, ae.value_text
    LIMIT ${normalizedExportLimit(limit)}
  `);
}

export function getEnzymeAttributeExternalChecks(biopartId: string, limit = 500): AttributeExternalCheckRow[] {
  return query<AttributeExternalCheckRow>(`
    SELECT c.check_id, c.attribute_evidence_id, c.source_db, c.match_status, c.match_score, c.match_reason,
           c.external_attribute_id, c.ec_number, c.external_attribute_name, c.external_value_numeric,
           c.external_value_maximum, c.external_unit, c.external_organism, c.external_literature_ids,
           c.external_commentary, c.source_url, c.updated_at
    FROM web_attribute_external_checks c
    JOIN web_attribute_evidences ae ON ae.attribute_evidence_id = c.attribute_evidence_id
    WHERE ae.entity_type = 'biopart_reaction'
      AND ae.entity_id LIKE ${sqlString(`${biopartId}::%`)}
    ORDER BY CASE c.match_status
      WHEN 'matched' THEN 0
      WHEN 'weak_match' THEN 1
      WHEN 'ec_attribute_only' THEN 2
      ELSE 3
    END, c.match_score DESC, c.attribute_evidence_id
    LIMIT ${normalizedExportLimit(limit)}
  `);
}

export function getEnzymeXrefs(biopartId: string): XrefRow[] {
  return query<XrefRow>(`
    SELECT x.xref_db, x.xref_value, x.xref_url, x.source_db
    FROM web_xrefs x
    WHERE x.entity_type = 'enzyme'
      AND x.entity_id = ${sqlString(biopartId)}
    ORDER BY x.xref_db, x.xref_value
  `);
}

export function getEnzymeProteinAnnotation(biopartId: string): ProteinAnnotationSummary | null {
  const rows = query<ProteinAnnotationSummary>(`
    SELECT pa.*
    FROM web_protein_annotations pa
    WHERE pa.biopart_id = ${sqlString(biopartId)}
    LIMIT 1
  `);
  return rows[0] ?? null;
}

export function getEnzymeProteinDomains(biopartId: string, limit = 120): ProteinDomainRow[] {
  return query<ProteinDomainRow>(`
    SELECT pd.domain_id, pd.biopart_id, pd.uniprot_accession, pd.annotation_db,
           pd.entry_id, pd.entry_name, pd.entry_type, pd.source_db, pd.entry_url
    FROM web_protein_domains pd
    WHERE pd.biopart_id = ${sqlString(biopartId)}
    ORDER BY CASE pd.annotation_db WHEN 'InterPro' THEN 0 WHEN 'Pfam' THEN 1 ELSE 2 END, pd.entry_type, pd.entry_id
    LIMIT ${normalizedExportLimit(limit)}
  `);
}

export function getEnzymeProteinFeatures(biopartId: string, limit = 120): ProteinFeatureRow[] {
  return query<ProteinFeatureRow>(`
    SELECT pf.*
    FROM web_protein_features pf
    WHERE pf.biopart_id = ${sqlString(biopartId)}
    ORDER BY pf.feature_type, pf.position_start, pf.position_end
    LIMIT ${normalizedExportLimit(limit)}
  `);
}

export function getEnzymeMcsaEntries(biopartId: string, limit = 20): McsaEntryRow[] {
  return query<McsaEntryRow>(`
    SELECT DISTINCT e.mcsa_id, e.enzyme_name, e.reference_uniprot_id, e.is_reference_uniprot_id,
           e.entry_url, e.description, e.all_ecs_json, e.mechanism_count, e.detailed_mechanism_count,
           e.residue_count, e.compound_count, e.pmids_json, e.dois_json,
           m.match_type, m.uniprot_accession AS matched_uniprot, NULL AS matched_ec
    FROM web_mcsa_enzyme_mappings m
    JOIN web_mcsa_entries e ON e.mcsa_id = m.mcsa_id
    WHERE m.biopart_id = ${sqlString(biopartId)}
    ORDER BY CASE m.match_type WHEN 'reference_uniprot_exact' THEN 0 ELSE 1 END,
             e.detailed_mechanism_count DESC, e.residue_count DESC, e.mcsa_id
    LIMIT ${normalizedExportLimit(limit)}
  `);
}

export function getEnzymeMcsaResidues(biopartId: string, limit = 120): McsaResidueRow[] {
  return query<McsaResidueRow>(`
    SELECT DISTINCT r.*
    FROM web_mcsa_residues r
    JOIN web_mcsa_enzyme_mappings m ON m.mcsa_id = r.mcsa_id
    WHERE m.biopart_id = ${sqlString(biopartId)}
    ORDER BY r.mcsa_id, r.residue_index, r.uniprot_residue_position, r.pdb_id
    LIMIT ${normalizedExportLimit(limit)}
  `);
}

export function getEnzymeMcsaMechanisms(biopartId: string, limit = 20): McsaMechanismRow[] {
  return query<McsaMechanismRow>(`
    SELECT DISTINCT mech.*
    FROM web_mcsa_mechanisms mech
    JOIN web_mcsa_enzyme_mappings m ON m.mcsa_id = mech.mcsa_id
    WHERE m.biopart_id = ${sqlString(biopartId)}
    ORDER BY mech.mcsa_id, mech.mechanism_id
    LIMIT ${normalizedExportLimit(limit)}
  `);
}

export function getEnzymeMcsaMechanismSteps(biopartId: string, limit = 160): McsaMechanismStepRow[] {
  return query<McsaMechanismStepRow>(`
    SELECT DISTINCT s.*
    FROM web_mcsa_mechanism_steps s
    JOIN web_mcsa_enzyme_mappings m ON m.mcsa_id = s.mcsa_id
    WHERE m.biopart_id = ${sqlString(biopartId)}
    ORDER BY s.mcsa_id, s.mechanism_id, s.step_id
    LIMIT ${normalizedExportLimit(limit)}
  `);
}

export function getEnzymeMcsaCompounds(biopartId: string, limit = 120): McsaCompoundRow[] {
  return query<McsaCompoundRow>(`
    SELECT DISTINCT c.*
    FROM web_mcsa_compounds c
    JOIN web_mcsa_enzyme_mappings m ON m.mcsa_id = c.mcsa_id
    WHERE m.biopart_id = ${sqlString(biopartId)}
    ORDER BY c.mcsa_id, c.compound_type, c.compound_index
    LIMIT ${normalizedExportLimit(limit)}
  `);
}

export function getEnzymeMcsaReferences(biopartId: string, limit = 120): McsaReferenceRow[] {
  return query<McsaReferenceRow>(`
    SELECT DISTINCT ref.*
    FROM web_mcsa_references ref
    JOIN web_mcsa_enzyme_mappings m ON m.mcsa_id = ref.mcsa_id
    WHERE m.biopart_id = ${sqlString(biopartId)}
    ORDER BY ref.mcsa_id, ref.mechanism_id, ref.pubmed_id
    LIMIT ${normalizedExportLimit(limit)}
  `);
}

type OrganismSearchParams = {
  q?: string; sort?: string; dir?: string; limit?: number; page?: number; pageSize?: number;
  minEnzymes?: string; maxEnzymes?: string; minReactions?: string; maxReactions?: string;
  minRelations?: string; maxRelations?: string; minChassis?: string; maxChassis?: string;
  hasStructure?: string; minEvidenceScore?: string; maxEvidenceScore?: string;
};

export function searchOrganisms(params: OrganismSearchParams = {}): OrganismRow[] {
  return searchOrganismsPage(params).rows;
}

export function searchOrganismsPage(params: OrganismSearchParams = {}): PagedResult<OrganismRow> {
  const clauses: string[] = [];
  const rawQuery = params.q?.trim() ?? "";
  if (rawQuery) {
    const clause = catalogNameClause(rawQuery, "org.organism", "oid.reactenz_organism_id");
    if (clause) clauses.push(clause);
  }
  const minEvidenceScore = normalizedEvidenceScore(params.minEvidenceScore);
  if (minEvidenceScore !== null) clauses.push(`org.evidence_score >= ${minEvidenceScore}`);
  const maxEvidenceScore = normalizedEvidenceScore(params.maxEvidenceScore);
  if (maxEvidenceScore !== null) clauses.push(`org.evidence_score <= ${maxEvidenceScore}`);
  const organismRanges: Array<[string, string | undefined, ">=" | "<="]> = [
    ["org.enzyme_count", params.minEnzymes, ">="], ["org.enzyme_count", params.maxEnzymes, "<="],
    ["org.reaction_count", params.minReactions, ">="], ["org.reaction_count", params.maxReactions, "<="],
    ["org.relation_count", params.minRelations, ">="], ["org.relation_count", params.maxRelations, "<="],
    ["org.chassis_count", params.minChassis, ">="], ["org.chassis_count", params.maxChassis, "<="],
  ];
  for (const [column, value, operator] of organismRanges) {
    const parsed = normalizedNonNegativeInt(value);
    if (parsed !== null) clauses.push(`${column} ${operator} ${parsed}`);
  }
  if (params.hasStructure === "yes") clauses.push("org.structured_enzyme_count > 0");
  if (params.hasStructure === "no") clauses.push("org.structured_enzyme_count = 0");
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const completenessOrder = "org.browse_completeness";
  const orderBy = sortExpression(params.sort, {
    completeness: completenessOrder,
    reactenz_id: "oid.reactenz_organism_id",
    organism: "org.organism",
    enzymes: "org.enzyme_count",
    reactions: "org.reaction_count",
    relations: "org.relation_count",
    chassis: "org.chassis_count",
    structure: "org.structured_enzyme_count",
    pdb: "org.pdb_enzyme_count",
    alphafold: "org.alphafold_enzyme_count",
    evidence_score: "org.evidence_score",
  }, completenessOrder);
  const dir = sortDirection(params.dir);
  const base = "FROM web_organism_browse_summary org JOIN web_organism_ids oid ON oid.organism = org.organism";
  const pageSize = params.limit ? normalizedExportLimit(params.limit) : normalizedPageSize(params.pageSize);
  const page = normalizedPage(params.page);
  const offset = (page - 1) * pageSize;
  const total = count(`SELECT COUNT(*) AS total ${base} ${where}`);
  const rows = query<OrganismRow>(`
    SELECT
      oid.reactenz_organism_id,
      org.organism,
      org.enzyme_count,
      org.reaction_count,
      org.relation_count,
      org.chassis_count,
      org.pdb_enzyme_count,
      org.alphafold_enzyme_count,
      org.structured_enzyme_count,
      org.evidence_score,
      org.evidence_tier
    ${base}
    ${where}
    ORDER BY ${orderBy} ${dir}, org.organism ASC
    LIMIT ${pageSize} OFFSET ${offset}
  `);
  return paged(rows, total, page, pageSize);
}

export function getTopOrganisms(limit = 120): OrganismRow[] {
  return searchOrganisms({ limit });
}

type ChassisSearchParams = {
  q?: string; sort?: string; dir?: string; limit?: number; page?: number; pageSize?: number;
  minRecords?: string; maxRecords?: string; minReactions?: string; maxReactions?: string;
  minEnzymes?: string; maxEnzymes?: string; minOrganisms?: string; maxOrganisms?: string;
  hasStructure?: string; minEvidenceScore?: string; maxEvidenceScore?: string;
};

export function searchChassis(params: ChassisSearchParams = {}): ChassisRow[] {
  return searchChassisPage(params).rows;
}

export function searchChassisPage(params: ChassisSearchParams = {}): PagedResult<ChassisRow> {
  const clauses: string[] = [];
  const rawQuery = params.q?.trim() ?? "";
  if (rawQuery) {
    const clause = catalogNameClause(rawQuery, "cl.label", "cid.reactenz_chassis_id");
    if (clause) clauses.push(clause);
  }
  const minEvidenceScore = normalizedEvidenceScore(params.minEvidenceScore);
  if (minEvidenceScore !== null) clauses.push(`COALESCE(es.evidence_score, 0) >= ${minEvidenceScore}`);
  const maxEvidenceScore = normalizedEvidenceScore(params.maxEvidenceScore);
  if (maxEvidenceScore !== null) clauses.push(`COALESCE(es.evidence_score, 0) <= ${maxEvidenceScore}`);
  const chassisRanges: Array<[string, string | undefined, ">=" | "<="]> = [
    ["cl.record_count", params.minRecords, ">="], ["cl.record_count", params.maxRecords, "<="],
    ["cl.reaction_count", params.minReactions, ">="], ["cl.reaction_count", params.maxReactions, "<="],
    ["cl.enzyme_count", params.minEnzymes, ">="], ["cl.enzyme_count", params.maxEnzymes, "<="],
    ["cl.organism_count", params.minOrganisms, ">="], ["cl.organism_count", params.maxOrganisms, "<="],
  ];
  for (const [column, value, operator] of chassisRanges) {
    const parsed = normalizedNonNegativeInt(value);
    if (parsed !== null) clauses.push(`${column} ${operator} ${parsed}`);
  }
  if (params.hasStructure === "yes") clauses.push(`EXISTS (
    SELECT 1 FROM web_chassis_records cr
    LEFT JOIN web_pdb_mappings p ON p.biopart_id = cr.biopart_id
    LEFT JOIN web_alphafold_mappings af ON af.biopart_id = cr.biopart_id
    WHERE cr.chassis_label = cl.label AND (p.biopart_id IS NOT NULL OR af.biopart_id IS NOT NULL)
  )`);
  if (params.hasStructure === "no") clauses.push(`NOT EXISTS (
    SELECT 1 FROM web_chassis_records cr
    LEFT JOIN web_pdb_mappings p ON p.biopart_id = cr.biopart_id
    LEFT JOIN web_alphafold_mappings af ON af.biopart_id = cr.biopart_id
    WHERE cr.chassis_label = cl.label AND (p.biopart_id IS NOT NULL OR af.biopart_id IS NOT NULL)
  )`);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const completenessOrder = `(
    CASE WHEN cl.label IS NOT NULL AND trim(cl.label) <> '' THEN 2 ELSE 0 END +
    CASE WHEN cl.record_count > 0 THEN 2 ELSE 0 END +
    CASE WHEN cl.reaction_count > 0 THEN 2 ELSE 0 END +
    CASE WHEN cl.enzyme_count > 0 THEN 2 ELSE 0 END +
    CASE WHEN COALESCE(stru.structured_enzyme_count, 0) > 0 THEN 2 ELSE 0 END +
    CASE WHEN cl.organism_count > 0 THEN 1 ELSE 0 END
  )`;
  const orderBy = sortExpression(params.sort, {
    completeness: completenessOrder,
    reactenz_id: "cid.reactenz_chassis_id",
    label: "cl.label",
    records: "cl.record_count",
    reactions: "cl.reaction_count",
    enzymes: "cl.enzyme_count",
    organisms: "cl.organism_count",
    structure: "stru.structured_enzyme_count",
    pdb: "stru.pdb_enzyme_count",
    alphafold: "stru.alphafold_enzyme_count",
    evidence_score: "COALESCE(es.evidence_score, 0)",
  }, completenessOrder);
  const dir = sortDirection(params.dir);
  const pageSize = params.limit ? normalizedExportLimit(params.limit) : normalizedPageSize(params.pageSize);
  const page = normalizedPage(params.page);
  const offset = (page - 1) * pageSize;
  const total = count(`
    SELECT COUNT(*) AS total
    FROM web_chassis_labels cl
    JOIN web_chassis_ids cid ON cid.label = cl.label
    LEFT JOIN web_evidence_scores es ON es.entity_type = 'chassis' AND es.entity_id = cl.label
    ${where}
  `);
  const rows = query<ChassisRow>(`
    SELECT cid.reactenz_chassis_id, cl.label, cl.record_count, cl.reaction_count, cl.enzyme_count, cl.organism_count,
           COALESCE(stru.pdb_enzyme_count, 0) AS pdb_enzyme_count,
           COALESCE(stru.alphafold_enzyme_count, 0) AS alphafold_enzyme_count,
           COALESCE(stru.structured_enzyme_count, 0) AS structured_enzyme_count,
           COALESCE(es.evidence_score, 0) AS evidence_score,
           es.evidence_tier
    FROM web_chassis_labels cl
    JOIN web_chassis_ids cid ON cid.label = cl.label
    LEFT JOIN web_evidence_scores es ON es.entity_type = 'chassis' AND es.entity_id = cl.label
    LEFT JOIN (
      SELECT
        cr.chassis_label,
        COUNT(DISTINCT p.biopart_id) AS pdb_enzyme_count,
        COUNT(DISTINCT af.biopart_id) AS alphafold_enzyme_count,
        COUNT(DISTINCT CASE WHEN p.biopart_id IS NOT NULL OR af.biopart_id IS NOT NULL THEN cr.biopart_id END) AS structured_enzyme_count
      FROM web_chassis_records cr
      LEFT JOIN (SELECT DISTINCT biopart_id FROM web_pdb_mappings) p ON p.biopart_id = cr.biopart_id
      LEFT JOIN (SELECT DISTINCT biopart_id FROM web_alphafold_mappings) af ON af.biopart_id = cr.biopart_id
      GROUP BY cr.chassis_label
    ) stru ON stru.chassis_label = cl.label
    ${where}
    ORDER BY ${orderBy} ${dir}, cl.label ASC
    LIMIT ${pageSize} OFFSET ${offset}
  `);
  return paged(rows, total, page, pageSize);
}

export function getTopChassis(limit = 120): ChassisRow[] {
  return searchChassis({ limit });
}

export function getOrganismProvenanceProfile(organism: string): OrganismProvenanceProfile {
  const taxonomyIds = query<{ value: string }>(`
    SELECT DISTINCT trim(taxonomy_id) AS value
    FROM web_enzymes
    WHERE organism = ${sqlString(organism)}
      AND taxonomy_id IS NOT NULL
      AND trim(taxonomy_id) <> ''
    ORDER BY value
  `).map((row) => row.value);
  const lineages = query<{ value: string }>(`
    SELECT DISTINCT trim(lineage) AS value
    FROM web_enzymes
    WHERE organism = ${sqlString(organism)}
      AND lineage IS NOT NULL
      AND trim(lineage) <> ''
    ORDER BY value
  `).map((row) => row.value);
  const evidenceSummary = query<{ enzymes_with_sequence: number; kinetic_records: number }>(`
    SELECT
      COUNT(DISTINCT CASE WHEN we.has_sequence = 1 THEN we.biopart_id END) AS enzymes_with_sequence,
      COALESCE(SUM(bs.kinetic_count), 0) AS kinetic_records
    FROM web_enzymes we
    JOIN web_enzyme_browse_summary bs ON bs.biopart_id = we.biopart_id
    WHERE we.organism = ${sqlString(organism)}
  `)[0];
  const literatureSummary = query<{ literature_references: number }>(`
    SELECT COUNT(DISTINCT er.reference_id) AS literature_references
    FROM web_entity_references er
    JOIN web_enzymes we ON we.biopart_id = er.entity_id
    WHERE er.entity_type = 'enzyme'
      AND we.organism = ${sqlString(organism)}
  `)[0];

  return {
    taxonomy_ids: taxonomyIds,
    lineages,
    enzymes_with_sequence: Number(evidenceSummary?.enzymes_with_sequence ?? 0),
    literature_references: Number(literatureSummary?.literature_references ?? 0),
    kinetic_records: Number(evidenceSummary?.kinetic_records ?? 0),
  };
}

export function getOrganism(organism: string): OrganismRow | null {
  const rows = query<OrganismRow>(`
    SELECT
      oid.reactenz_organism_id,
      org.organism,
      org.enzyme_count,
      org.reaction_count,
      org.relation_count,
      org.chassis_count,
      org.pdb_enzyme_count,
      org.alphafold_enzyme_count,
      org.structured_enzyme_count,
      org.evidence_score,
      org.evidence_tier
    FROM web_organism_browse_summary org
    JOIN web_organism_ids oid ON oid.organism = org.organism
    WHERE org.organism = ${sqlString(organism)} OR oid.reactenz_organism_id = ${sqlString(organism)}
    LIMIT 1
  `);
  return rows[0] ?? null;
}

export function getChassis(label: string): ChassisRow | null {
  const row = query<ChassisRow>(`
    SELECT cid.reactenz_chassis_id, cl.label, cl.record_count, cl.reaction_count, cl.enzyme_count, cl.organism_count,
           COALESCE(es.evidence_score, 0) AS evidence_score, es.evidence_tier
    FROM web_chassis_labels cl
    JOIN web_chassis_ids cid ON cid.label = cl.label
    LEFT JOIN web_evidence_scores es ON es.entity_type = 'chassis' AND es.entity_id = cl.label
    WHERE cl.label = ${sqlString(label)} OR cid.reactenz_chassis_id = ${sqlString(label)}
    LIMIT 1
  `)[0];
  if (!row) return null;

  // Detail pages need one chassis only. Restrict the structure aggregation to
  // that exact label instead of regrouping the full chassis relation table.
  const structure = query<{
    pdb_enzyme_count: number;
    alphafold_enzyme_count: number;
    structured_enzyme_count: number;
  }>(`
    SELECT
      COUNT(DISTINCT p.biopart_id) AS pdb_enzyme_count,
      COUNT(DISTINCT af.biopart_id) AS alphafold_enzyme_count,
      COUNT(DISTINCT CASE WHEN p.biopart_id IS NOT NULL OR af.biopart_id IS NOT NULL THEN cr.biopart_id END) AS structured_enzyme_count
    FROM web_chassis_records cr
    LEFT JOIN (SELECT DISTINCT biopart_id FROM web_pdb_mappings) p ON p.biopart_id = cr.biopart_id
    LEFT JOIN (SELECT DISTINCT biopart_id FROM web_alphafold_mappings) af ON af.biopart_id = cr.biopart_id
    WHERE cr.chassis_label = ${sqlString(row.label)}
  `)[0];

  return {
    ...row,
    pdb_enzyme_count: Number(structure?.pdb_enzyme_count ?? 0),
    alphafold_enzyme_count: Number(structure?.alphafold_enzyme_count ?? 0),
    structured_enzyme_count: Number(structure?.structured_enzyme_count ?? 0),
  };
}

export function getChassisSourceOrganisms(label: string, limit = 80): ChassisSourceOrganismRow[] {
  return query<ChassisSourceOrganismRow>(`
    SELECT
      oid.reactenz_organism_id,
      cr.organism,
      COUNT(*) AS record_count,
      COUNT(DISTINCT cr.reaction_id) AS reaction_count,
      COUNT(DISTINCT cr.biopart_id) AS enzyme_count
    FROM web_chassis_records cr
    LEFT JOIN web_organism_ids oid ON oid.organism = cr.organism
    WHERE cr.chassis_label = ${sqlString(label)}
      AND cr.organism IS NOT NULL
      AND trim(cr.organism) <> ''
    GROUP BY oid.reactenz_organism_id, cr.organism
    ORDER BY enzyme_count DESC, reaction_count DESC, cr.organism ASC
    LIMIT ${normalizedExportLimit(limit)}
  `);
}

function reoTextSearchClause(rawQuery: string): string {
  const parsed = parseSearchQuery(rawQuery);
  if (parsed.kind === "empty") return "";
  if (parsed.kind === "association_id") return `re.reo_id = ${sqlString(parsed.value)}`;
  if (parsed.kind === "reaction_id") {
    const id = sqlString(parsed.value);
    return `(rid.reactenz_reaction_id = ${id} OR re.reaction_id = ${id})`;
  }
  if (parsed.kind === "enzyme_id") {
    const id = sqlString(parsed.value);
    return `(eid.reactenz_enzyme_id = ${id} OR re.biopart_id = ${id})`;
  }
  if (parsed.kind === "ec") {
    const exact = sqlString(parsed.value);
    if (/^\d+\.\d+\.\d+\.\d+$/.test(parsed.value)) {
      return `(re.reaction_id IN (SELECT reaction_id FROM web_reaction_ec_numbers WHERE ec_number_clean = ${exact}) OR r.ec_number = ${exact})`;
    }
    const like = sqlString(`${parsed.value}.%`);
    return `(re.reaction_id IN (SELECT reaction_id FROM web_reaction_ec_numbers WHERE ec_number_clean = ${exact} OR ec_number_clean LIKE ${like}) OR r.ec_number = ${exact} OR r.ec_number LIKE ${like})`;
  }
  if (parsed.kind === "rhea") {
    const id = sqlString(parsed.value);
    return `(r.rhea_id = ${id} OR r.rhea_id = ${sqlString(`RHEA:${parsed.value}`)})`;
  }
  if (parsed.kind === "kegg") return `r.kegg_reaction_id = ${sqlString(parsed.value)}`;
  if (parsed.kind === "uniprot") {
    const id = sqlString(parsed.value);
    return `re.biopart_id IN (
      SELECT biopart_id FROM web_enzyme_uniprot
      WHERE uniprot_accession = ${id} OR uniprot_entry_name = ${id}
    )`;
  }
  if (parsed.kind === "chebi") {
    const values = chebiIdValues(parsed.value).map(sqlString).join(", ");
    return `re.reaction_id IN (SELECT reaction_id FROM web_reaction_compounds WHERE chebi_id IN (${values}))`;
  }
  if (parsed.kind === "metacyc") return `r.metacyc_reaction_id = ${sqlString(parsed.value)}`;
  if (parsed.kind === "pmid") {
    const value = sqlString(parsed.value);
    return `(
      re.reaction_id IN (SELECT entity_id FROM web_entity_references WHERE entity_type = 'reaction' AND CAST(pmid AS TEXT) = ${value})
      OR re.biopart_id IN (SELECT entity_id FROM web_entity_references WHERE entity_type = 'enzyme' AND CAST(pmid AS TEXT) = ${value})
    )`;
  }
  if (parsed.kind === "structure") return "1 = 0";
  const like = likeTokenClause([
    "re.reo_id",
    "rid.reactenz_reaction_id",
    "r.reaction_equation_display",
    "eid.reactenz_enzyme_id",
    "re.enzyme_name",
    "re.gene_name_primary",
    "re.organism",
  ], parsed.value);
  return like || `re.enzyme_name LIKE ${sqlString(`%${parsed.value}%`)}`;
}

export function searchReoRecordsPage(params: ReoSearchParams = {}): PagedResult<ReoBrowseRow> {
  const clauses: string[] = [];
  const rawQuery = params.q?.trim() ?? "";
  if (rawQuery) {
    const clause = reoTextSearchClause(rawQuery);
    if (clause) clauses.push(clause);
  }
  const reactionQuery = params.reaction?.trim() ?? "";
  if (reactionQuery) {
    const parsed = parseSearchQuery(reactionQuery);
    if (parsed.kind === "reaction_id" || parsed.kind === "ec" || parsed.kind === "rhea" || parsed.kind === "kegg" || parsed.kind === "chebi" || parsed.kind === "metacyc") {
      clauses.push(reoTextSearchClause(reactionQuery));
    } else if (parsed.kind === "text") {
      const like = likeTokenClause(["rid.reactenz_reaction_id", "re.reaction_id", "r.reaction_equation_display"], parsed.value);
      if (like) clauses.push(like);
    } else {
      clauses.push(`(rid.reactenz_reaction_id = ${sqlString(reactionQuery)} OR re.reaction_id = ${sqlString(reactionQuery)})`);
    }
  }
  const enzymeQuery = params.enzyme?.trim() ?? "";
  if (enzymeQuery) {
    const parsed = parseSearchQuery(enzymeQuery);
    if (parsed.kind === "enzyme_id" || parsed.kind === "uniprot") {
      clauses.push(reoTextSearchClause(enzymeQuery));
    } else if (parsed.kind === "text") {
      const like = likeTokenClause(["eid.reactenz_enzyme_id", "re.biopart_id", "re.enzyme_name", "re.gene_name_primary"], parsed.value);
      if (like) clauses.push(like);
    } else {
      clauses.push(`(eid.reactenz_enzyme_id = ${sqlString(enzymeQuery)} OR re.biopart_id = ${sqlString(enzymeQuery)})`);
    }
  }
  const organismQuery = params.organism?.trim() ?? "";
  if (organismQuery) {
    const parsed = parseSearchQuery(organismQuery);
    if (parsed.kind === "text") {
      const like = likeTokenClause(["oid.reactenz_organism_id", "re.organism", "re.taxonomy_id"], parsed.value);
      if (like) clauses.push(like);
    } else {
      clauses.push(`(oid.reactenz_organism_id = ${sqlString(organismQuery)} OR re.taxonomy_id = ${sqlString(organismQuery)})`);
    }
  }
  if (params.hasSequence === "yes") clauses.push("re.has_sequence = 1");
  if (params.hasSequence === "no") clauses.push("COALESCE(re.has_sequence, 0) = 0");
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const orderBy = sortExpression(params.sort, {
    reaction: "rid.reactenz_reaction_id",
    enzyme: "COALESCE(re.enzyme_name, eid.reactenz_enzyme_id)",
    organism: "COALESCE(re.organism, '')",
    sequence: "COALESCE(re.sequence_length, 0)",
    source: "COALESCE(re.source_db, '')",
  }, "reaction");
  const dir = sortDirection(params.dir);
  const pageSize = normalizedPageSize(params.pageSize);
  const page = normalizedPage(params.page);
  const offset = (page - 1) * pageSize;
  const base = `
    FROM web_reaction_enzymes re
    JOIN web_reaction_ids rid ON rid.reaction_id = re.reaction_id
    JOIN web_enzyme_ids eid ON eid.biopart_id = re.biopart_id
    JOIN web_reactions r ON r.reaction_id = re.reaction_id
    LEFT JOIN web_organism_ids oid ON oid.organism = re.organism
  `;
  const total = count(`SELECT COUNT(*) AS total ${base} ${where}`);
  const rows = query<ReoBrowseRow>(`
    SELECT page.*,
           (SELECT COUNT(*) FROM web_kinetics k
             WHERE k.reaction_id = page.reaction_id AND k.biopart_id = page.biopart_id) AS kinetic_count,
           (SELECT COUNT(DISTINCT er.pmid) FROM web_entity_references er
             WHERE (er.entity_type = 'reaction' AND er.entity_id = page.reaction_id)
                OR (er.entity_type = 'enzyme' AND er.entity_id = page.biopart_id)) AS reference_count
    FROM (
      SELECT re.reo_id, rid.reactenz_reaction_id, eid.reactenz_enzyme_id, oid.reactenz_organism_id,
             re.reaction_id, re.biopart_id, r.reaction_equation_display, r.reaction_direction,
             r.ec_number, re.enzyme_name, re.gene_name_primary, re.organism, re.taxonomy_id,
             re.protein_id, re.has_sequence, re.sequence_length, re.evidence_level, re.source_db
      ${base}
      ${where}
      ORDER BY ${orderBy} ${dir}, eid.reactenz_enzyme_id ASC, COALESCE(oid.reactenz_organism_id, '') ASC
      LIMIT ${pageSize} OFFSET ${offset}
    ) page
  `);
  return paged(rows, total, page, pageSize);
}

export function getReoRecord(reactionId: string, enzymeId: string, organismId: string): ReoBrowseRow | null {
  const organismClause = organismId === "unassigned"
    ? "oid.reactenz_organism_id IS NULL"
    : `oid.reactenz_organism_id = ${sqlString(organismId)}`;
  return query<ReoBrowseRow>(`
    SELECT re.reo_id, rid.reactenz_reaction_id, eid.reactenz_enzyme_id, oid.reactenz_organism_id,
           re.reaction_id, re.biopart_id, r.reaction_equation_display, r.reaction_direction,
           r.ec_number, re.enzyme_name, re.gene_name_primary, re.organism, re.taxonomy_id,
           re.protein_id, re.has_sequence, re.sequence_length, re.evidence_level, re.source_db,
           (SELECT COUNT(*) FROM web_kinetics k
             WHERE k.reaction_id = re.reaction_id AND k.biopart_id = re.biopart_id) AS kinetic_count,
           (SELECT COUNT(DISTINCT er.pmid) FROM web_entity_references er
             WHERE (er.entity_type = 'reaction' AND er.entity_id = re.reaction_id)
                OR (er.entity_type = 'enzyme' AND er.entity_id = re.biopart_id)) AS reference_count
    FROM web_reaction_enzymes re
    JOIN web_reaction_ids rid ON rid.reaction_id = re.reaction_id
    JOIN web_enzyme_ids eid ON eid.biopart_id = re.biopart_id
    JOIN web_reactions r ON r.reaction_id = re.reaction_id
    LEFT JOIN web_organism_ids oid ON oid.organism = re.organism
    WHERE rid.reactenz_reaction_id = ${sqlString(reactionId)}
      AND eid.reactenz_enzyme_id = ${sqlString(enzymeId)}
      AND ${organismClause}
    LIMIT 1
  `)[0] ?? null;
}

export function getReoRecordById(reoId: string): ReoBrowseRow | null {
  const normalizedId = reoId.trim().toUpperCase();
  if (!/^REO\d{6,}$/.test(normalizedId)) return null;
  return query<ReoBrowseRow>(`
    SELECT re.reo_id, rid.reactenz_reaction_id, eid.reactenz_enzyme_id, oid.reactenz_organism_id,
           re.reaction_id, re.biopart_id, r.reaction_equation_display, r.reaction_direction,
           r.ec_number, re.enzyme_name, re.gene_name_primary, re.organism, re.taxonomy_id,
           re.protein_id, re.has_sequence, re.sequence_length, re.evidence_level, re.source_db,
           (SELECT COUNT(*) FROM web_kinetics k
             WHERE k.reaction_id = re.reaction_id AND k.biopart_id = re.biopart_id) AS kinetic_count,
           (SELECT COUNT(DISTINCT er.pmid) FROM web_entity_references er
             WHERE (er.entity_type = 'reaction' AND er.entity_id = re.reaction_id)
                OR (er.entity_type = 'enzyme' AND er.entity_id = re.biopart_id)) AS reference_count
    FROM web_reaction_enzymes re
    JOIN web_reaction_ids rid ON rid.reaction_id = re.reaction_id
    JOIN web_enzyme_ids eid ON eid.biopart_id = re.biopart_id
    JOIN web_reactions r ON r.reaction_id = re.reaction_id
    LEFT JOIN web_organism_ids oid ON oid.organism = re.organism
    WHERE re.reo_id = ${sqlString(normalizedId)}
    LIMIT 1
  `)[0] ?? null;
}

export function getOrganismRecords(organism: string, limit = 120): RelationRecordRow[] {
  return query<RelationRecordRow>(`
    SELECT rid.reactenz_reaction_id, eid.reactenz_enzyme_id, oid.reactenz_organism_id, cid.reactenz_chassis_id,
           re.enzyme_name, re.gene_name_primary, re.organism,
           re.protein_id, re.has_sequence, re.sequence_length, cr.chassis_label
    FROM web_reaction_enzymes re
    JOIN web_reaction_ids rid ON rid.reaction_id = re.reaction_id
    JOIN web_enzyme_ids eid ON eid.biopart_id = re.biopart_id
    LEFT JOIN web_organism_ids oid ON oid.organism = re.organism
    LEFT JOIN web_chassis_records cr
      ON cr.reaction_id = re.reaction_id AND cr.biopart_id = re.biopart_id
    LEFT JOIN web_chassis_ids cid ON cid.label = cr.chassis_label
    WHERE re.organism = ${sqlString(organism)} OR oid.reactenz_organism_id = ${sqlString(organism)}
    ORDER BY rid.reactenz_reaction_id, re.enzyme_name, eid.reactenz_enzyme_id
    LIMIT ${normalizedExportLimit(limit)}
  `);
}

export function getOrganismChassis(organism: string, limit = 80): ChassisRow[] {
  return query<ChassisRow>(`
    SELECT
      cid.reactenz_chassis_id,
      cr.chassis_label AS label,
      COUNT(*) AS record_count,
      COUNT(DISTINCT cr.reaction_id) AS reaction_count,
      COUNT(DISTINCT cr.biopart_id) AS enzyme_count,
      COUNT(DISTINCT cr.organism) AS organism_count,
      COUNT(DISTINCT p.biopart_id) AS pdb_enzyme_count,
      COUNT(DISTINCT af.biopart_id) AS alphafold_enzyme_count,
      COUNT(DISTINCT CASE WHEN p.biopart_id IS NOT NULL OR af.biopart_id IS NOT NULL THEN cr.biopart_id END) AS structured_enzyme_count
    FROM web_chassis_records cr
    JOIN web_chassis_ids cid ON cid.label = cr.chassis_label
    LEFT JOIN (SELECT DISTINCT biopart_id FROM web_pdb_mappings) p ON p.biopart_id = cr.biopart_id
    LEFT JOIN (SELECT DISTINCT biopart_id FROM web_alphafold_mappings) af ON af.biopart_id = cr.biopart_id
    WHERE cr.organism = ${sqlString(organism)}
    GROUP BY cr.chassis_label
    ORDER BY record_count DESC, cr.chassis_label
    LIMIT ${normalizedExportLimit(limit)}
  `);
}

export function getChassisRecords(label: string, limit = 120): RelationRecordRow[] {
  return query<RelationRecordRow>(`
    SELECT rid.reactenz_reaction_id, eid.reactenz_enzyme_id, oid.reactenz_organism_id, cid.reactenz_chassis_id,
           cr.enzyme_name, cr.gene_name_primary, cr.organism,
           NULL AS protein_id, cr.has_sequence, cr.sequence_length, cr.chassis_label
    FROM web_chassis_records cr
    JOIN web_reaction_ids rid ON rid.reaction_id = cr.reaction_id
    JOIN web_enzyme_ids eid ON eid.biopart_id = cr.biopart_id
    LEFT JOIN web_organism_ids oid ON oid.organism = cr.organism
    LEFT JOIN web_chassis_ids cid ON cid.label = cr.chassis_label
    WHERE cr.chassis_label = ${sqlString(label)} OR cid.reactenz_chassis_id = ${sqlString(label)}
    ORDER BY cr.organism, cr.enzyme_name, rid.reactenz_reaction_id, eid.reactenz_enzyme_id
    LIMIT ${normalizedExportLimit(limit)}
  `);
}

export function getReactionChassis(reactionId: string): RelationRecordRow[] {
  return query<RelationRecordRow>(`
    SELECT rid.reactenz_reaction_id, eid.reactenz_enzyme_id, oid.reactenz_organism_id, cid.reactenz_chassis_id,
           cr.enzyme_name, cr.gene_name_primary, cr.organism,
           NULL AS protein_id, cr.has_sequence, cr.sequence_length, cr.chassis_label
    FROM web_chassis_records cr
    JOIN web_reaction_ids rid ON rid.reaction_id = cr.reaction_id
    JOIN web_enzyme_ids eid ON eid.biopart_id = cr.biopart_id
    LEFT JOIN web_organism_ids oid ON oid.organism = cr.organism
    LEFT JOIN web_chassis_ids cid ON cid.label = cr.chassis_label
    WHERE cr.reaction_id = ${sqlString(reactionId)} OR rid.reactenz_reaction_id = ${sqlString(reactionId)}
    ORDER BY cr.chassis_label, cr.organism, eid.reactenz_enzyme_id
  `);
}

export function findEnzymeCandidates(params: {
  target?: string;
  substrates?: string;
  products?: string;
  preferredChassis?: string;
  preferredOrganism?: string;
  requireSequence?: boolean;
  requireKinetics?: boolean;
  requireStructure?: boolean;
  requireChassis?: boolean;
  limit?: number;
  structureOffset?: number;
  structureLimit?: number;
  structureMatchMode?: "complete" | "related";
}): EnzymeCandidateResult {
  const targetText = params.target?.trim() ?? "";
  const substrates = params.substrates?.trim() ?? "";
  const products = params.products?.trim() ?? "";
  const exactTarget = targetText ? getReaction(targetText) : null;
  const structureSearch = substrates || products
    ? searchReactionsByStructureInput({ substrates, products, limit: params.structureLimit ?? 12, offset: params.structureOffset, matchMode: params.structureMatchMode })
    : { rows: [] as StructureSimilarReactionRow[], total: 0 };
  const structureSimilarReactions = structureSearch.rows;
  const structureMatchTotal = structureSearch.total;

  if (params.structureMatchMode === "related") {
    return { target: null, targetMatchMode: "none", alternatives: [], candidates: [],
      similarReactions: [], structureSimilarReactions, structureMatchTotal, ecClassReactions: [] };
  }

  if (!targetText && !substrates && !products) {
    return {
      target: null,
      targetMatchMode: "none",
      alternatives: [],
      candidates: [],
      similarReactions: [],
      structureSimilarReactions: [],
      structureMatchTotal: 0,
      ecClassReactions: [],
    };
  }

  const alternatives = exactTarget
    ? []
    : targetText
      ? searchReactionsPage({ q: targetText, sort: "completeness", dir: "desc", limit: 8, skipTotal: true }).rows
      : [];
  const structureTarget = structureSimilarReactions[0] ? getReaction(structureSimilarReactions[0].reactenz_reaction_id) : null;
  const target = exactTarget ?? (alternatives[0] ? getReaction(alternatives[0].reactenz_reaction_id) : null) ?? structureTarget;
  const targetMatchMode = exactTarget
    ? "exact"
    : alternatives[0]
      ? "text_fallback"
      : structureTarget
        ? "structure_fallback"
        : "none";

  if (!target) {
    return {
      target: null,
      targetMatchMode,
      alternatives,
      candidates: [],
      similarReactions: [],
      structureSimilarReactions,
      structureMatchTotal,
      ecClassReactions: [],
    };
  }

  const preferredChassis = params.preferredChassis?.trim() ?? "";
  const preferredOrganism = params.preferredOrganism?.trim() ?? "";
  const filters: string[] = [];
  if (params.requireSequence) filters.push("base.has_sequence = 1");
  if (params.requireKinetics) filters.push("base.kinetic_count > 0");
  if (params.requireStructure) filters.push("base.structure_count > 0");
  if (params.requireChassis) filters.push("base.preferred_chassis_count > 0");
  if (preferredOrganism) filters.push(`base.organism LIKE ${sqlString(`%${preferredOrganism}%`)}`);
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const limit = Math.min(normalizedExportLimit(params.limit ?? 80), 200);
  const preferredChassisExpr = preferredChassis
    ? `SUM(CASE WHEN cr.chassis_label LIKE ${sqlString(`%${preferredChassis}%`)} THEN 1 ELSE 0 END)`
    : "0";
  const preferredOrganismScore = preferredOrganism
    ? `CASE WHEN base.organism LIKE ${sqlString(`%${preferredOrganism}%`)} THEN 6 ELSE 0 END +`
    : "";
  const scoreExpr = `(
    50 +
    CASE WHEN base.has_sequence = 1 THEN 12 ELSE 0 END +
    CASE WHEN base.kinetic_count > 0 THEN 10 ELSE 0 END +
    CASE WHEN base.pdb_count > 0 THEN 8 ELSE 0 END +
    CASE WHEN base.alphafold_count > 0 THEN 6 ELSE 0 END +
    CASE WHEN base.preferred_chassis_count > 0 THEN 8 ELSE 0 END +
    CASE WHEN base.chassis_count > 0 THEN 3 ELSE 0 END +
    CASE WHEN base.uniprot_accession IS NOT NULL AND trim(base.uniprot_accession) <> '' THEN 3 ELSE 0 END +
    ${preferredOrganismScore}
    CASE WHEN base.evidence_level IS NOT NULL AND trim(base.evidence_level) <> '' THEN 2 ELSE 0 END
  )`;

  const candidates = query<EnzymeCandidateRow>(`
    SELECT
      base.*,
      ${scoreExpr} AS evidence_score
    FROM (
      SELECT
        rid.reactenz_reaction_id,
        eid.reactenz_enzyme_id,
        oid.reactenz_organism_id,
        re.biopart_id,
        re.enzyme_name,
        re.gene_name_primary,
        re.organism,
        re.taxonomy_id,
        re.protein_id,
        eu.uniprot_accession,
        eu.uniprot_entry_name,
        eu.uniprot_url,
        re.has_sequence,
        re.sequence_length,
        COALESCE(kin.kinetic_count, 0) AS kinetic_count,
        COALESCE(pdb.pdb_count, 0) AS pdb_count,
        COALESCE(af.alphafold_count, 0) AS alphafold_count,
        COALESCE(pdb.pdb_count, 0) + COALESCE(af.alphafold_count, 0) AS structure_count,
        COUNT(DISTINCT cr.chassis_label) AS chassis_count,
        ${preferredChassisExpr} AS preferred_chassis_count,
        GROUP_CONCAT(DISTINCT cr.chassis_label) AS chassis_labels,
        re.evidence_level,
        re.source_db
      FROM web_reaction_enzymes re
      JOIN web_reaction_ids rid ON rid.reaction_id = re.reaction_id
      JOIN web_enzyme_ids eid ON eid.biopart_id = re.biopart_id
      LEFT JOIN web_organism_ids oid ON oid.organism = re.organism
      LEFT JOIN web_enzyme_uniprot eu ON eu.biopart_id = re.biopart_id
      LEFT JOIN (
        SELECT reaction_id, biopart_id, COUNT(*) AS kinetic_count
        FROM web_kinetics
        GROUP BY reaction_id, biopart_id
      ) kin ON kin.reaction_id = re.reaction_id AND kin.biopart_id = re.biopart_id
      LEFT JOIN (
        SELECT biopart_id, COUNT(DISTINCT pdb_id) AS pdb_count
        FROM web_pdb_mappings
        GROUP BY biopart_id
      ) pdb ON pdb.biopart_id = re.biopart_id
      LEFT JOIN (
        SELECT biopart_id, COUNT(*) AS alphafold_count
        FROM web_alphafold_mappings
        GROUP BY biopart_id
      ) af ON af.biopart_id = re.biopart_id
      LEFT JOIN web_chassis_records cr
        ON cr.reaction_id = re.reaction_id AND cr.biopart_id = re.biopart_id
      WHERE re.reaction_id = ${sqlString(target.reaction_id)}
      GROUP BY re.reaction_id, re.biopart_id, re.organism
    ) base
    ${where}
    ORDER BY evidence_score DESC, base.kinetic_count DESC, base.structure_count DESC, base.has_sequence DESC, base.reactenz_enzyme_id
    LIMIT ${limit}
  `);

  return {
    target,
    targetMatchMode,
    alternatives,
    candidates,
    similarReactions: [],
    structureSimilarReactions,
    structureMatchTotal,
    ecClassReactions: [],
  };
}

export function getEnzymeChassis(biopartId: string): ChassisRow[] {
  return query<ChassisRow>(`
    SELECT
      cid.reactenz_chassis_id,
      cr.chassis_label AS label,
      COUNT(*) AS record_count,
      COUNT(DISTINCT cr.reaction_id) AS reaction_count,
      1 AS enzyme_count,
      COUNT(DISTINCT cr.organism) AS organism_count
    FROM web_chassis_records cr
    JOIN web_chassis_ids cid ON cid.label = cr.chassis_label
    WHERE cr.biopart_id = ${sqlString(biopartId)}
    GROUP BY cr.chassis_label
    ORDER BY record_count DESC, cr.chassis_label
  `);
}
