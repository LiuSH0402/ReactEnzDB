import { releasePath } from "@/lib/paths";
import path from "node:path";
import { querySqlite, querySqliteParams } from "@/lib/sqlite";

const DB_PATH = process.env.REACTENZDB_REACTION_STANDARDIZATION_DB
  ? path.resolve(process.env.REACTENZDB_REACTION_STANDARDIZATION_DB)
  : releasePath("reaction_standardization.sqlite");

export type ReactionStandardizationSummary = {
  reaction_id: string;
  reactenz_reaction_id: string;
  source_equation: string | null;
  source_direction: string | null;
  canonical_reactants_smiles: string | null;
  canonical_products_smiles: string | null;
  canonical_reaction_smiles: string | null;
  directionless_reaction_key: string | null;
  directional_reaction_key: string | null;
  directionless_reaction_key_no_stereo: string | null;
  directional_reaction_key_no_stereo: string | null;
  normalized_direction: string;
  reversibility_status: string;
  direction_normalization_rule: string;
  structure_completeness_status: string;
  stereo_completeness_status: string;
  participant_role_status: string;
  standardization_status: string;
  standardization_rule_version: string;
  updated_at: string;
};

export type StandardizedParticipant = {
  participant_id: string;
  reaction_id: string;
  side: "left" | "right";
  position_index: number;
  source_compound_id: string | null;
  source_name: string | null;
  source_stoichiometry_text: string | null;
  stoichiometric_coefficient: number | null;
  stoichiometry_status: string;
  chebi_id: string | null;
  mnx_compound_id: string | null;
  canonical_smiles: string | null;
  standard_inchi: string | null;
  standard_inchikey: string | null;
  molecular_formula: string | null;
  formal_charge: number | null;
  structure_source: string | null;
  structure_status: string;
  stereo_status: string;
  participant_role: string;
  role_rule_id: string | null;
  role_confidence: number | null;
};

export type ReactionBalance = {
  balance_result_id: string;
  reaction_id: string;
  balance_context: "full_explicit" | "core_transformation";
  mass_balance_status: string;
  element_delta_json: string;
  element_delta: Record<string, number>;
  charge_balance_status: string;
  charge_delta: number | null;
  proton_delta: number | null;
  water_delta: number | null;
  electron_delta: number | null;
  missing_participants_json: string;
  missing_participants: string[];
  calculation_method: string;
  interpretation_boundary: string;
};

export type CrossDatabaseMapping = {
  mapping_id: string;
  reaction_id: string;
  target_db: string;
  target_reaction_id: string;
  mapping_basis: string;
  identifier_relation: string;
  direction_relation: string;
  participant_relation: string;
  stoichiometry_relation: string;
  charge_relation: string;
  stereo_relation: string;
  chemistry_equivalence: string;
  mapping_confidence: number;
  confidence_tier: string;
  evidence_json: string;
  evidence: Record<string, unknown>;
  conflict_explanation: string | null;
  review_status: string;
  created_at: string;
};

export type MappingConflict = {
  conflict_id: string;
  reaction_id: string;
  mapping_id: string | null;
  conflict_type: string;
  conflict_severity: string;
  reactenz_value: string | null;
  external_value: string | null;
  explanation: string;
  resolution_status: string;
  resolution_rule: string | null;
  requires_manual_review: number;
  created_at: string;
};

export type ReactionCentre = {
  reaction_centre_id: string;
  atom_mapping_id: string;
  changed_atom_maps_json: string;
  changed_atom_maps: number[];
  broken_bonds_json: string;
  broken_bonds: unknown[];
  formed_bonds_json: string;
  formed_bonds: unknown[];
  changed_bonds_json: string;
  changed_bonds: unknown[];
  reaction_centre_smarts: string | null;
  core_transformation_smarts: string | null;
  extraction_method: string;
  extraction_status: string;
};

export type AtomMapping = {
  atom_mapping_id: string;
  reaction_id: string;
  atom_mapped_reaction_smiles: string | null;
  mapping_method: string;
  mapping_source: string;
  mapped_atom_count: number | null;
  unmapped_atom_count: number | null;
  conserved_atom_fraction: number | null;
  mapping_confidence: number | null;
  mapping_status: string;
  validation_flags_json: string;
  validation_flags: Record<string, unknown>;
  source_external_reaction_key: string | null;
  created_at: string;
  public_structure_detail: number;
  reaction_centre: ReactionCentre | null;
};

export type ReactionStandardizationBundle = {
  release: Record<string, string>;
  standardization: ReactionStandardizationSummary;
  participants: StandardizedParticipant[];
  balances: ReactionBalance[];
  cross_database_mappings: CrossDatabaseMapping[];
  conflicts: MappingConflict[];
  atom_mappings: AtomMapping[];
};

export type ReactionStandardizationFilters = {
  massBalance?: string;
  chargeBalance?: string;
  stereoStatus?: string;
  structureStatus?: string;
  exactRhea?: boolean;
  atomMapped?: boolean;
  conflictFree?: boolean;
};

export type ReactionStandardizationFacet = {
  reaction_id: string;
  standardization_status: string;
  structure_completeness_status: string;
  stereo_completeness_status: string;
  full_mass_balance_status: string | null;
  full_charge_balance_status: string | null;
  exact_rhea_identity: number;
  atom_mapping_available: number;
  mapping_conflict_count: number;
};

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

const MASS_STATUSES = new Set(["balanced", "hydrogen_only_imbalance", "unbalanced", "unknown_missing_structure"]);
const CHARGE_STATUSES = new Set(["balanced", "unbalanced", "unknown_missing_structure"]);
const STEREO_STATUSES = new Set(["complete_or_not_applicable", "incomplete_unspecified", "unknown_missing_structure"]);
const STRUCTURE_STATUSES = new Set(["complete", "partial_generic_structure", "partial_missing_structure", "missing"]);

export function getReactionIdsByStandardizationFilters(filters: ReactionStandardizationFilters): string[] | null {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filters.massBalance && MASS_STATUSES.has(filters.massBalance)) {
    clauses.push("EXISTS (SELECT 1 FROM balance_results b WHERE b.reaction_id=i.reaction_id AND b.balance_context='full_explicit' AND b.mass_balance_status=?)");
    params.push(filters.massBalance);
  }
  if (filters.chargeBalance && CHARGE_STATUSES.has(filters.chargeBalance)) {
    clauses.push("EXISTS (SELECT 1 FROM balance_results b WHERE b.reaction_id=i.reaction_id AND b.balance_context='full_explicit' AND b.charge_balance_status=?)");
    params.push(filters.chargeBalance);
  }
  if (filters.stereoStatus && STEREO_STATUSES.has(filters.stereoStatus)) {
    clauses.push("s.stereo_completeness_status=?");
    params.push(filters.stereoStatus);
  }
  if (filters.structureStatus && STRUCTURE_STATUSES.has(filters.structureStatus)) {
    clauses.push("s.structure_completeness_status=?");
    params.push(filters.structureStatus);
  }
  if (filters.exactRhea !== undefined) {
    clauses.push(`${filters.exactRhea ? "" : "NOT "}EXISTS (SELECT 1 FROM cross_database_mappings m WHERE m.reaction_id=i.reaction_id AND m.target_db='Rhea' AND m.chemistry_equivalence='exact_normalized_identity')`);
  }
  if (filters.atomMapped !== undefined) {
    clauses.push(`${filters.atomMapped ? "" : "NOT "}EXISTS (SELECT 1 FROM atom_mappings a WHERE a.reaction_id=i.reaction_id AND a.mapping_status IN ('valid','valid_with_warnings','validated_predicted'))`);
  }
  if (filters.conflictFree !== undefined) {
    clauses.push(`${filters.conflictFree ? "NOT " : ""}EXISTS (SELECT 1 FROM mapping_conflicts c WHERE c.reaction_id=i.reaction_id)`);
  }
  if (!clauses.length) return null;
  return querySqliteParams<{ reaction_id: string }>(DB_PATH, `
    SELECT i.reaction_id
    FROM reaction_inputs i JOIN standardized_reactions s USING(reaction_id)
    WHERE ${clauses.join(" AND ")}
    ORDER BY i.reaction_id
  `, params).map((row) => row.reaction_id);
}

export function getReactionStandardizationFacets(reactionIds: string[]): Map<string, ReactionStandardizationFacet> {
  const ids = Array.from(new Set(reactionIds.filter(Boolean)));
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  const rows = querySqliteParams<ReactionStandardizationFacet>(DB_PATH, `
    SELECT i.reaction_id,s.standardization_status,s.structure_completeness_status,s.stereo_completeness_status,
           (SELECT b.mass_balance_status FROM balance_results b WHERE b.reaction_id=i.reaction_id AND b.balance_context='full_explicit') AS full_mass_balance_status,
           (SELECT b.charge_balance_status FROM balance_results b WHERE b.reaction_id=i.reaction_id AND b.balance_context='full_explicit') AS full_charge_balance_status,
           EXISTS(SELECT 1 FROM cross_database_mappings m WHERE m.reaction_id=i.reaction_id AND m.target_db='Rhea' AND m.chemistry_equivalence='exact_normalized_identity') AS exact_rhea_identity,
           EXISTS(SELECT 1 FROM atom_mappings a WHERE a.reaction_id=i.reaction_id AND a.mapping_status IN ('valid','valid_with_warnings','validated_predicted')) AS atom_mapping_available,
           (SELECT COUNT(*) FROM mapping_conflicts c WHERE c.reaction_id=i.reaction_id) AS mapping_conflict_count
    FROM reaction_inputs i JOIN standardized_reactions s USING(reaction_id)
    WHERE i.reaction_id IN (${placeholders})
  `, ids);
  return new Map(rows.map((row) => [row.reaction_id, row]));
}

export function getReactionStandardizationBundle(reactionId: string): ReactionStandardizationBundle | null {
  const summaries = querySqliteParams<ReactionStandardizationSummary>(DB_PATH, `
    SELECT i.reaction_id,i.reactenz_reaction_id,i.source_equation,i.source_direction,
           s.canonical_reactants_smiles,s.canonical_products_smiles,s.canonical_reaction_smiles,
           s.directionless_reaction_key,s.directional_reaction_key,
           s.directionless_reaction_key_no_stereo,s.directional_reaction_key_no_stereo,
           s.normalized_direction,s.reversibility_status,s.direction_normalization_rule,
           s.structure_completeness_status,s.stereo_completeness_status,s.participant_role_status,
           s.standardization_status,s.standardization_rule_version,s.updated_at
    FROM reaction_inputs i JOIN standardized_reactions s USING(reaction_id)
    WHERE i.reaction_id=? OR i.reactenz_reaction_id=?
    LIMIT 1
  `, [reactionId, reactionId]);
  const standardization = summaries[0];
  if (!standardization) return null;
  const internalId = standardization.reaction_id;

  const participants = querySqliteParams<StandardizedParticipant>(DB_PATH, `
    SELECT * FROM normalized_participants WHERE reaction_id=? ORDER BY side,position_index,participant_id
  `, [internalId]);
  const balances = querySqliteParams<Omit<ReactionBalance, "element_delta" | "missing_participants">>(DB_PATH, `
    SELECT * FROM balance_results WHERE reaction_id=?
    ORDER BY CASE balance_context WHEN 'full_explicit' THEN 0 ELSE 1 END
  `, [internalId]).map((row) => ({
    ...row,
    element_delta: parseJson<Record<string, number>>(row.element_delta_json, {}),
    missing_participants: parseJson<string[]>(row.missing_participants_json, []),
  }));
  const crossDatabaseMappings = querySqliteParams<Omit<CrossDatabaseMapping, "evidence">>(DB_PATH, `
    SELECT * FROM cross_database_mappings WHERE reaction_id=?
    ORDER BY CASE confidence_tier WHEN 'A' THEN 0 WHEN 'B' THEN 1 WHEN 'C' THEN 2 ELSE 3 END,
             mapping_confidence DESC,target_db,target_reaction_id
  `, [internalId]).map((row) => ({ ...row, evidence: parseJson<Record<string, unknown>>(row.evidence_json, {}) }));
  const conflicts = querySqliteParams<MappingConflict>(DB_PATH, `
    SELECT * FROM mapping_conflicts WHERE reaction_id=?
    ORDER BY requires_manual_review DESC,CASE conflict_severity WHEN 'error' THEN 0 ELSE 1 END,conflict_type
  `, [internalId]);
  const centres = querySqliteParams<Omit<ReactionCentre, "changed_atom_maps" | "broken_bonds" | "formed_bonds" | "changed_bonds">>(DB_PATH, `
    SELECT c.* FROM reaction_centres c JOIN atom_mappings a USING(atom_mapping_id) WHERE a.reaction_id=?
  `, [internalId]).map((row) => ({
    ...row,
    changed_atom_maps: parseJson<number[]>(row.changed_atom_maps_json, []),
    broken_bonds: parseJson<unknown[]>(row.broken_bonds_json, []),
    formed_bonds: parseJson<unknown[]>(row.formed_bonds_json, []),
    changed_bonds: parseJson<unknown[]>(row.changed_bonds_json, []),
  }));
  const centreByMapping = new Map(centres.map((centre) => [centre.atom_mapping_id, centre]));
  const atomMappings = querySqliteParams<Omit<AtomMapping, "validation_flags" | "reaction_centre">>(DB_PATH, `
    SELECT * FROM atom_mappings WHERE reaction_id=? ORDER BY mapping_confidence DESC,mapping_source
  `, [internalId]).map((row) => ({
    ...row,
    validation_flags: parseJson<Record<string, unknown>>(row.validation_flags_json, {}),
    reaction_centre: centreByMapping.get(row.atom_mapping_id) ?? null,
  }));
  const release = Object.fromEntries(querySqlite<{ key: string; value: string }>(DB_PATH, "SELECT key,value FROM release_metadata").map((row) => [row.key, row.value]));

  return {
    release,
    standardization,
    participants,
    balances,
    cross_database_mappings: crossDatabaseMappings,
    conflicts,
    atom_mappings: atomMappings,
  };
}
