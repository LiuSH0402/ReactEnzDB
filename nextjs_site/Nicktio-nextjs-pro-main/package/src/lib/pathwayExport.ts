import { releasePath } from "@/lib/paths";
import fs from "node:fs";
import path from "node:path";
import { querySqlite } from "@/lib/sqlite";
import { QUALITY_SEMANTICS } from "@/lib/qualitySemantics";

const MODEL_READY_DB_PATH = releasePath("model_ready_dataset.sqlite");
const HOST_CONTEXT_DB_PATH = releasePath("host_context_chassis.sqlite");

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlIn(values: string[]): string {
  return values.map(sqlString).join(", ");
}

function queryModel<T>(sql: string): T[] {
  return querySqlite<T>(MODEL_READY_DB_PATH, sql);
}

function queryHost<T>(sql: string): T[] {
  // Legacy host link provenance mixes KEGG identifiers; hold this derived layer.
  return [];
  return querySqlite<T>(HOST_CONTEXT_DB_PATH, sql);
}

export const PATHWAY_EXPORT_HOST_KEYS = [
  "any",
  "ecoli",
  "yeast",
  "bacillus",
  "corynebacterium",
  "pseudomonas",
  "pichia",
  "streptomyces",
  "yarrowia",
  "cupriavidus",
] as const;

export type HostKey = (typeof PATHWAY_EXPORT_HOST_KEYS)[number];

export type PathwayReactionRow = {
  reaction_id: string;
  reactenz_reaction_id: string;
  ec_number: string | null;
  rhea_id: string | null;
  kegg_reaction_id: string | null;
  metacyc_reaction_id: string | null;
  mnx_reaction_ids: string | null;
  reaction_equation_display: string | null;
  canonical_reaction_smiles: string | null;
  currency_compound_count: number;
  only_currency_transformation: number;
  formula_balance_status: string;
  charge_balance_status: string;
  enzyme_candidate_count: number;
  organism_count: number;
  chassis_count: number;
  kinetics_count: number;
  evidence_score: number;
  evidence_tier: string | null;
  quality_flags: string;
};

export type PathwayCandidateRow = {
  candidate_id: string;
  reaction_id: string;
  reactenz_reaction_id: string;
  biopart_id: string;
  reactenz_enzyme_id: string | null;
  enzyme_name: string | null;
  gene_name_primary: string | null;
  organism: string | null;
  taxonomy_id: string | null;
  protein_id: string | null;
  uniprot_accession: string | null;
  uniprot_entry_name: string | null;
  source_db: string | null;
  evidence_level: string | null;
  enzyme_evidence_score: number;
  enzyme_evidence_tier: string | null;
  has_sequence: number;
  sequence_length: number | null;
  chassis_labels: string | null;
  chassis_count: number;
  kinetic_record_count: number;
  km_count: number;
  kcat_count: number;
  kcat_km_count: number;
  vmax_count: number;
  kinetic_subjects: string | null;
  optimum_ph_values: string | null;
  optimum_temperature_values: string | null;
  interpro_count: number;
  pfam_count: number;
  active_site_count: number;
  binding_site_count: number;
  conserved_site_count: number;
  best_structure_type: string | null;
  best_structure_id: string | null;
  structure_confidence_score: number;
  structure_confidence_tier: string | null;
  catalytic_site_support_level: string | null;
};

export type RankedPathwayCandidate = PathwayCandidateRow & {
  host_suitability_score: number;
  host_suitability_tier: "recommended" | "plausible" | "weak" | "unknown";
  score_explanation: string[];
};

export type HostReactionContext = {
  reactenz_reaction_id: string;
  host_id: string | null;
  host_scope: HostKey;
  host_ids: string | null;
  host_name: string;
  host_model_count: number;
  native_model_reaction_count: number;
  high_confidence_link_count: number;
  low_confidence_link_count: number;
  bigg_reaction_ids: string | null;
  subsystems: string | null;
  has_exchange_context: number;
  has_transport_context: number;
};

export type HostFeasibilitySummary = {
  host_id: string;
  host_name: string;
  model_id: string;
  model_source: string;
  mapping_readiness: "available" | "limited_identifier_coverage" | "unavailable_no_reaction_mapping";
  exact_native_step_count: number;
  ec_class_context_step_count: number;
  heterologous_step_count: number;
  missing_reaction_count: number;
  not_evaluated_step_count: number;
  linked_precursor_metabolite_count: number;
  total_participant_count: number;
  linked_participant_count: number;
  participant_coverage: number;
  feasibility_score: number;
  recommendation_tier: "recommended" | "plausible" | "limited" | "weak";
};

export type CofactorBurdenRow = {
  category: string;
  label: string;
  left_count: number;
  right_count: number;
  net_count: number;
  reaction_count: number;
  example_compounds: string;
  interpretation: string;
};

export type HostNativeNeighborRow = {
  host_id: string;
  host_name: string;
  model_id: string;
  model_source: string;
  bigg_reaction_id: string;
  reaction_name: string | null;
  subsystem: string | null;
  ec_numbers: string | null;
  link_type: string | null;
  confidence: string | null;
  matched_identifier: string | null;
};

export type GapFillingCandidate = RankedPathwayCandidate & {
  gap_fill_score: number;
  gap_fill_notes: string[];
};

export type GapFillingReport = {
  gap_status: "native_exact" | "ec_class_only" | "missing" | "not_evaluated";
  reason: string;
  suggested_heterologous_enzymes: GapFillingCandidate[];
  neighboring_native_reactions: HostNativeNeighborRow[];
};

export type ReactionHostContextRow = {
  host_id: string;
  host_name: string;
  model_id: string;
  model_source: string;
  model_reaction_count: number;
  high_confidence_link_count: number;
  low_confidence_link_count: number;
  model_reaction_ids: string | null;
  subsystems: string | null;
  has_exchange_context: number;
  has_transport_context: number;
};

export type PathwayExportStep = {
  query: string;
  found: boolean;
  reaction: PathwayReactionRow | null;
  host_context: HostReactionContext | null;
  candidates: RankedPathwayCandidate[];
  gap_filling: GapFillingReport | null;
};

export type PathwayExportResult = {
  host: HostKey;
  host_label: string;
  limit_per_reaction: number;
  host_feasibility: HostFeasibilitySummary[];
  host_model_coverage_score_semantics: string;
  cofactor_burden: CofactorBurdenRow[];
  steps: PathwayExportStep[];
  boundary_note: string;
};

const HOSTS: Record<HostKey, { label: string; aliases: string[]; ph: [number, number] | null; temp: [number, number] | null; hostIds?: string[]; hostIdPrefix?: string }> = {
  any: { label: "Any host", aliases: [], ph: null, temp: null },
  ecoli: { label: "Escherichia coli", aliases: ["escherichia coli", "e. coli", "coli"], ph: [6.2, 7.8], temp: [25, 42], hostIdPrefix: "ecoli_" },
  yeast: { label: "Saccharomyces cerevisiae", aliases: ["saccharomyces cerevisiae", "s. cerevisiae", "yeast"], ph: [4, 7.5], temp: [20, 35], hostIds: ["scerevisiae_s288c"] },
  bacillus: { label: "Bacillus subtilis", aliases: ["bacillus subtilis", "b. subtilis"], ph: [5.5, 8.5], temp: [25, 45], hostIds: ["bsubtilis_168"] },
  corynebacterium: { label: "Corynebacterium glutamicum", aliases: ["corynebacterium glutamicum", "c. glutamicum"], ph: [6, 8], temp: [25, 35], hostIds: ["cglutamicum_atcc13032"] },
  pseudomonas: { label: "Pseudomonas putida KT2440", aliases: ["pseudomonas putida", "p. putida", "kt2440"], ph: [6, 8], temp: [25, 34], hostIds: ["pputida_kt2440"] },
  pichia: { label: "Pichia pastoris / Komagataella phaffii", aliases: ["pichia pastoris", "komagataella phaffii", "k. phaffii"], ph: [4, 7], temp: [20, 32], hostIds: ["kphaffii_pichia_pastoris"] },
  streptomyces: { label: "Streptomyces coelicolor", aliases: ["streptomyces coelicolor", "s. coelicolor", "streptomyces"], ph: [6, 8], temp: [25, 34], hostIds: ["scoelicolor_a3_2"] },
  yarrowia: { label: "Yarrowia lipolytica", aliases: ["yarrowia lipolytica", "y. lipolytica"], ph: [4, 7], temp: [20, 32], hostIds: ["ylipolytica"] },
  cupriavidus: { label: "Cupriavidus necator H16", aliases: ["cupriavidus necator", "ralstonia eutropha", "c. necator", "r. eutropha"], ph: [6, 8], temp: [25, 35], hostIds: ["cnecator_h16"] },
};

export function hostOptions() {
  return Object.entries(HOSTS).map(([key, value]) => ({ key, label: value.label }));
}

export function acceptedHosts(): HostKey[] {
  return [...PATHWAY_EXPORT_HOST_KEYS];
}

function hostWhereClause(host: HostKey, tableAlias = "l"): string {
  const profile = HOSTS[host];
  const clauses: string[] = [];
  if (profile.hostIdPrefix) clauses.push(`${tableAlias}.host_id LIKE ${sqlString(`${profile.hostIdPrefix}%`)}`);
  if (profile.hostIds?.length) clauses.push(`${tableAlias}.host_id IN (${sqlIn(profile.hostIds)})`);
  return clauses.length ? `AND (${clauses.join(" OR ")})` : "";
}

export function normalizeHost(value: string | null | undefined): HostKey {
  const normalized = value == null ? "any" : value.trim().toLowerCase();
  if (isAcceptedHost(normalized)) return normalized;
  throw new Error(`Unsupported host "${value ?? ""}". Accepted hosts: ${PATHWAY_EXPORT_HOST_KEYS.join(", ")}.`);
}

export function isAcceptedHost(value: string): value is HostKey {
  return (PATHWAY_EXPORT_HOST_KEYS as readonly string[]).includes(value);
}

export function parseReactionQueries(value: string): string[] {
  return Array.from(new Set(value.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean))).slice(0, 30);
}

function numericValues(value: string | null): number[] {
  if (!value) return [];
  return value
    .split(/[;,|]/)
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item));
}

function hasAlias(value: string | null, aliases: string[]): boolean {
  if (!value || !aliases.length) return false;
  const lower = value.toLowerCase();
  return aliases.some((alias) => lower.includes(alias));
}

function inRange(values: number[], range: [number, number] | null): boolean {
  if (!range || !values.length) return false;
  return values.some((value) => value >= range[0] && value <= range[1]);
}

function tier(score: number): RankedPathwayCandidate["host_suitability_tier"] {
  if (score >= 70) return "recommended";
  if (score >= 50) return "plausible";
  if (score >= 30) return "weak";
  return "unknown";
}

function rankCandidate(candidate: PathwayCandidateRow, host: HostKey): RankedPathwayCandidate {
  const profile = HOSTS[host];
  const explanation: string[] = [];
  let score = 0;

  if (host === "any") {
    if (candidate.chassis_count > 0) {
      score += 15;
      explanation.push(`+15 chassis evidence (${candidate.chassis_count} label${candidate.chassis_count === 1 ? "" : "s"})`);
    }
  } else if (hasAlias(candidate.chassis_labels, profile.aliases)) {
    score += 30;
    explanation.push(`+30 direct chassis evidence for ${profile.label}`);
  } else if (candidate.chassis_count > 0) {
    score += 12;
    explanation.push("+12 expression chassis evidence exists, but not the selected host");
  }

  if (host !== "any" && hasAlias(candidate.organism, profile.aliases)) {
    score += 10;
    explanation.push(`+10 source organism matches ${profile.label}`);
  }

  if (candidate.kinetic_record_count > 0) {
    const kineticScore = Math.min(15, 5 + candidate.kinetic_record_count);
    score += kineticScore;
    explanation.push(`+${kineticScore} kinetic support (${candidate.kinetic_record_count} records)`);
  }

  const evidenceScore = Math.round(Math.min(15, Math.max(0, candidate.enzyme_evidence_score) * 0.15));
  if (evidenceScore > 0) {
    score += evidenceScore;
    explanation.push(`+${evidenceScore} annotation-richness contribution (${candidate.enzyme_evidence_score}/100; not an activity probability)`);
  }

  const structureScore = Math.round(Math.min(15, Math.max(0, candidate.structure_confidence_score) * 0.15));
  if (structureScore > 0) {
    score += structureScore;
    explanation.push(`+${structureScore} structure confidence contribution (${candidate.structure_confidence_score}/100)`);
  }

  if (candidate.interpro_count > 0 || candidate.pfam_count > 0) {
    score += 5;
    explanation.push("+5 InterPro/Pfam annotation");
  }

  const siteCount = candidate.active_site_count + candidate.binding_site_count + candidate.conserved_site_count;
  if (siteCount > 0) {
    score += 10;
    explanation.push(`+10 functional-site annotation (${siteCount} sites)`);
  }

  if (candidate.has_sequence) {
    score += 7;
    explanation.push("+7 protein sequence available");
  }

  if (candidate.sequence_length && candidate.sequence_length > 1500) {
    score -= 8;
    explanation.push("-8 very long protein sequence");
  }

  if (host !== "any") {
    if (inRange(numericValues(candidate.optimum_ph_values), profile.ph)) {
      score += 4;
      explanation.push("+4 pH optimum compatible with selected host profile");
    }
    if (inRange(numericValues(candidate.optimum_temperature_values), profile.temp)) {
      score += 4;
      explanation.push("+4 temperature optimum compatible with selected host profile");
    }
  }

  const bounded = Math.max(0, Math.min(100, Math.round(score)));
  if (!explanation.length) explanation.push("No positive host-ranking evidence available in ReactEnzDB.");

  return {
    ...candidate,
    host_suitability_score: bounded,
    host_suitability_tier: tier(bounded),
    score_explanation: explanation,
  };
}

function getHostReactionContexts(reactions: PathwayReactionRow[], host: HostKey): Map<string, HostReactionContext> {
  if (!reactions.length) return new Map();
  const ids = Array.from(new Set(reactions.map((reaction) => reaction.reaction_id).filter(Boolean)));
  if (!ids.length) return new Map();
  const hostWhere = hostWhereClause(host, "l");
  const singleHostId = HOSTS[host].hostIds?.length === 1 ? HOSTS[host].hostIds[0] : null;
  const rows = queryHost<HostReactionContext>(`
    SELECT l.reactenz_reaction_id,
           ${singleHostId ? sqlString(singleHostId) : "NULL"} AS host_id,
           ${sqlString(host)} AS host_scope,
           GROUP_CONCAT(DISTINCT l.host_id) AS host_ids,
           GROUP_CONCAT(DISTINCT m.host_name) AS host_name,
           COUNT(DISTINCT l.host_id) AS host_model_count,
           COUNT(DISTINCT l.host_id || ':' || l.bigg_reaction_id) AS native_model_reaction_count,
           SUM(CASE WHEN l.confidence = 'high' THEN 1 ELSE 0 END) AS high_confidence_link_count,
           SUM(CASE WHEN l.confidence = 'low' THEN 1 ELSE 0 END) AS low_confidence_link_count,
           GROUP_CONCAT(DISTINCT l.host_id || ':' || l.bigg_reaction_id) AS bigg_reaction_ids,
           GROUP_CONCAT(DISTINCT r.subsystem) AS subsystems,
           MAX(r.is_exchange) AS has_exchange_context,
           MAX(r.is_transport) AS has_transport_context
    FROM host_reaction_links l
    LEFT JOIN host_native_reactions r
      ON r.host_id = l.host_id AND r.bigg_reaction_id = l.bigg_reaction_id
    LEFT JOIN host_models m
      ON m.host_id = l.host_id
    WHERE l.reactenz_reaction_id IN (${sqlIn(ids)})
      ${hostWhere}
    GROUP BY l.reactenz_reaction_id
  `);
  return new Map(rows.map((row) => [row.reactenz_reaction_id, row]));
}

function recommendationTier(score: number): HostFeasibilitySummary["recommendation_tier"] {
  if (score >= 75) return "recommended";
  if (score >= 55) return "plausible";
  if (score >= 35) return "limited";
  return "weak";
}

function getHostFeasibilitySummary(reactions: PathwayReactionRow[]): HostFeasibilitySummary[] {
  if (!reactions.length) return [];
  const reactionIds = Array.from(new Set(reactions.map((reaction) => reaction.reaction_id)));
  const reactionCount = reactionIds.length;
  const hostRows = queryHost<{
    host_id: string;
    host_name: string;
    model_id: string;
    model_source: string;
    exact_native_step_count: number;
    ec_class_context_step_count: number;
    mapping_readiness: HostFeasibilitySummary["mapping_readiness"];
  }>(`
    SELECT m.host_id,
           m.host_name,
           m.model_id,
           m.model_source,
           CASE
             WHEN NOT EXISTS (
               SELECT 1 FROM host_reaction_links any_link WHERE any_link.host_id=m.host_id
             ) THEN 'unavailable_no_reaction_mapping'
             WHEN (
               SELECT COUNT(DISTINCT exact_host.reactenz_reaction_id) * 1.0
               FROM host_reaction_links exact_host
               WHERE exact_host.host_id=m.host_id AND exact_host.link_type='reaction_identifier_exact'
             ) / NULLIF((
               SELECT COUNT(DISTINCT exact_any.reactenz_reaction_id)
               FROM host_reaction_links exact_any
               WHERE exact_any.link_type='reaction_identifier_exact'
             ), 0) < 0.01 THEN 'limited_identifier_coverage'
             ELSE 'available'
           END AS mapping_readiness,
           COUNT(DISTINCT CASE WHEN l.confidence = 'high' THEN l.reactenz_reaction_id END) AS exact_native_step_count,
           COUNT(DISTINCT CASE
             WHEN l.confidence = 'low'
              AND NOT EXISTS (
                SELECT 1
                FROM host_reaction_links exact_link
                WHERE exact_link.host_id = l.host_id
                  AND exact_link.reactenz_reaction_id = l.reactenz_reaction_id
                  AND exact_link.confidence = 'high'
              )
             THEN l.reactenz_reaction_id
           END) AS ec_class_context_step_count
    FROM host_models m
    LEFT JOIN host_reaction_links l
      ON l.host_id = m.host_id AND l.reactenz_reaction_id IN (${sqlIn(reactionIds)})
    GROUP BY m.host_id, m.host_name, m.model_id, m.model_source
  `);

  const participantRows = queryModel<{ reaction_id: string; compound_id: string; is_currency: number }>(`
    SELECT reaction_id, compound_id, is_currency
    FROM model_ready_reaction_compounds
    WHERE reaction_id IN (${sqlIn(reactionIds)})
  `);
  const totalParticipantIds = Array.from(new Set(participantRows.map((row) => row.compound_id).filter(Boolean)));
  const precursorParticipantIds = Array.from(new Set(participantRows.filter((row) => !Number(row.is_currency)).map((row) => row.compound_id).filter(Boolean)));

  const linkedByHost = new Map<string, { linked: Set<string>; precursor: Set<string> }>();
  if (totalParticipantIds.length) {
    const compoundLinkRows = queryHost<{ host_id: string; reactenz_compound_id: string }>(`
      SELECT DISTINCT host_id, reactenz_compound_id
      FROM host_compound_links
      WHERE reactenz_compound_id IN (${sqlIn(totalParticipantIds)})
    `);
    const precursorSet = new Set(precursorParticipantIds);
    for (const row of compoundLinkRows) {
      const current = linkedByHost.get(row.host_id) ?? { linked: new Set<string>(), precursor: new Set<string>() };
      current.linked.add(row.reactenz_compound_id);
      if (precursorSet.has(row.reactenz_compound_id)) current.precursor.add(row.reactenz_compound_id);
      linkedByHost.set(row.host_id, current);
    }
  }

  return hostRows.map((row) => {
    const linked = linkedByHost.get(row.host_id);
    const linkedParticipantCount = linked?.linked.size ?? 0;
    const participantCoverage = totalParticipantIds.length ? linkedParticipantCount / totalParticipantIds.length : 0;
    const exactCoverage = reactionCount ? Number(row.exact_native_step_count) / reactionCount : 0;
    const ecContextCount = Number(row.ec_class_context_step_count);
    const ecCoverage = reactionCount ? ecContextCount / reactionCount : 0;
    const precursorCoverage = precursorParticipantIds.length ? (linked?.precursor.size ?? 0) / precursorParticipantIds.length : 0;
    const isAnalysisReady = row.mapping_readiness === "available";
    // Exact identifier links establish model-native coverage. EC matches are only
    // contextual evidence and receive a deliberately small contribution.
    const score = isAnalysisReady
      ? Math.round(Math.min(100, (exactCoverage * 85) + (ecCoverage * 5) + (participantCoverage * 7) + (precursorCoverage * 3)))
      : 0;
    return {
      host_id: row.host_id,
      host_name: row.host_name,
      model_id: row.model_id,
      model_source: row.model_source,
      mapping_readiness: row.mapping_readiness,
      exact_native_step_count: Number(row.exact_native_step_count),
      ec_class_context_step_count: ecContextCount,
      // Only analysis-ready host maps support absence-based heterologous inference.
      // Same-EC context never changes exact native status.
      heterologous_step_count: isAnalysisReady ? Math.max(0, reactionCount - Number(row.exact_native_step_count)) : 0,
      missing_reaction_count: isAnalysisReady ? Math.max(0, reactionCount - Number(row.exact_native_step_count) - ecContextCount) : 0,
      not_evaluated_step_count: isAnalysisReady ? 0 : Math.max(0, reactionCount - Number(row.exact_native_step_count)),
      linked_precursor_metabolite_count: linked?.precursor.size ?? 0,
      total_participant_count: totalParticipantIds.length,
      linked_participant_count: linkedParticipantCount,
      participant_coverage: Number(participantCoverage.toFixed(3)),
      feasibility_score: score,
      recommendation_tier: recommendationTier(score),
    };
  }).sort((a, b) =>
    b.feasibility_score - a.feasibility_score ||
    b.exact_native_step_count - a.exact_native_step_count ||
    a.heterologous_step_count - b.heterologous_step_count ||
    a.host_name.localeCompare(b.host_name),
  );
}

function cofactorCategory(name: string, compoundId: string): { category: string; label: string } | null {
  const text = `${name} ${compoundId}`.toLowerCase();
  if (/\batp\b/.test(text) || text.includes("adenosine triphosphate")) return { category: "energy_atp", label: "ATP" };
  if (/\badp\b/.test(text) || text.includes("adenosine diphosphate")) return { category: "energy_adp", label: "ADP" };
  if (/\bamp\b/.test(text) || text.includes("adenosine monophosphate")) return { category: "energy_amp", label: "AMP" };
  if (text.includes("nadph")) return { category: "redox_nadph", label: "NADPH" };
  if (text.includes("nadp") || text.includes("nicotinamide adenine dinucleotide phosphate")) return { category: "redox_nadp", label: "NADP+" };
  if (text.includes("nadh")) return { category: "redox_nadh", label: "NADH" };
  if (/\bnad\b/.test(text) || text.includes("nicotinamide adenine dinucleotide")) return { category: "redox_nad", label: "NAD+" };
  if (text.includes("s-adenosyl-l-methionine") || text.includes("s-adenosylmethionine") || /\bsam\b/.test(text)) return { category: "methyl_sam", label: "SAM" };
  if (text.includes("s-adenosyl-l-homocysteine") || text.includes("s-adenosylhomocysteine") || /\bsah\b/.test(text)) return { category: "methyl_sah", label: "SAH" };
  if (text.includes("acetyl-coa")) return { category: "coa_acetyl", label: "acetyl-CoA" };
  if (text.includes("malonyl") && text.includes("coa")) return { category: "coa_malonyl", label: "malonyl-CoA" };
  if (text.includes("coa") || text.includes("coenzyme a")) return { category: "coa_pool", label: "CoA/acyl-CoA" };
  if (text.includes("oxygen") || /\bo2\b/.test(text)) return { category: "gas_o2", label: "O2" };
  if (text.includes("carbon dioxide") || /\bco2\b/.test(text)) return { category: "gas_co2", label: "CO2" };
  if (text.includes("water") || /\bh2o\b/.test(text)) return { category: "water", label: "H2O" };
  if (text.includes("h(+)") || text.includes("proton") || /\bh\+\b/.test(text)) return { category: "proton", label: "H+" };
  if (text.includes("phosphate") || /\bpi\b/.test(text)) return { category: "phosphate", label: "phosphate" };
  return null;
}

function burdenInterpretation(category: string, net: number): string {
  if (category.startsWith("redox_")) return net > 0 ? "net produced/oxidized cofactor signal" : net < 0 ? "net consumed/reduced cofactor demand" : "balanced redox cofactor occurrence";
  if (category.startsWith("energy_")) return net < 0 ? "net energy-currency demand" : net > 0 ? "net energy-currency product" : "balanced energy-currency occurrence";
  if (category.startsWith("methyl_")) return net < 0 ? "methyl-donor demand" : net > 0 ? "methyl-cycle product" : "balanced methyl-cycle occurrence";
  if (category.startsWith("coa_")) return net < 0 ? "CoA/acyl-CoA input demand" : net > 0 ? "CoA/acyl-CoA product" : "balanced CoA occurrence";
  return net < 0 ? "net input demand" : net > 0 ? "net product/release" : "balanced occurrence";
}

function getCofactorBurden(reactions: PathwayReactionRow[]): CofactorBurdenRow[] {
  if (!reactions.length) return [];
  const reactionIds = Array.from(new Set(reactions.map((reaction) => reaction.reaction_id)));
  const rows = queryModel<{
    reaction_id: string;
    compound_id: string;
    side: string | null;
    compound_name: string | null;
  }>(`
    SELECT reaction_id, compound_id, side, compound_name
    FROM model_ready_reaction_compounds
    WHERE reaction_id IN (${sqlIn(reactionIds)})
  `);
  const stats = new Map<string, { label: string; left: number; right: number; reactions: Set<string>; examples: Set<string> }>();
  for (const row of rows) {
    const category = cofactorCategory(row.compound_name ?? "", row.compound_id);
    if (!category) continue;
    const current = stats.get(category.category) ?? { label: category.label, left: 0, right: 0, reactions: new Set<string>(), examples: new Set<string>() };
    if (row.side === "left") current.left += 1;
    if (row.side === "right") current.right += 1;
    current.reactions.add(row.reaction_id);
    current.examples.add(row.compound_name || row.compound_id);
    stats.set(category.category, current);
  }
  return Array.from(stats.entries()).map(([category, row]) => {
    const net = row.right - row.left;
    return {
      category,
      label: row.label,
      left_count: row.left,
      right_count: row.right,
      net_count: net,
      reaction_count: row.reactions.size,
      example_compounds: Array.from(row.examples).slice(0, 5).join("; "),
      interpretation: burdenInterpretation(category, net),
    };
  }).sort((a, b) => Math.abs(b.net_count) - Math.abs(a.net_count) || b.reaction_count - a.reaction_count || a.label.localeCompare(b.label));
}

function ecNumbers(value: string | null | undefined): string[] {
  if (!value) return [];
  return Array.from(new Set(value.split(/[;,| ]+/).map((item) => item.trim()).filter((item) => /^\d+\.\d+\.\d+\.\d+$/.test(item))));
}

function getHostNativeNeighbors(reaction: PathwayReactionRow, host: HostKey, limit = 8): HostNativeNeighborRow[] {
  if (host === "any") return [];
  const hostWhere = hostWhereClause(host, "l");
  const linkedRows = queryHost<HostNativeNeighborRow>(`
    SELECT l.host_id,
           m.host_name,
           m.model_id,
           m.model_source,
           l.bigg_reaction_id,
           r.reaction_name,
           r.subsystem,
           r.ec_numbers,
           l.link_type,
           l.confidence,
           l.matched_identifier
    FROM host_reaction_links l
    JOIN host_models m ON m.host_id = l.host_id
    LEFT JOIN host_native_reactions r
      ON r.host_id = l.host_id AND r.bigg_reaction_id = l.bigg_reaction_id
    WHERE l.reactenz_reaction_id = ${sqlString(reaction.reaction_id)}
      ${hostWhere}
    ORDER BY CASE l.confidence WHEN 'high' THEN 0 ELSE 1 END, m.host_name, l.bigg_reaction_id
    LIMIT ${Math.max(1, Math.min(Math.floor(limit), 20))}
  `);

  const seen = new Set(linkedRows.map((row) => `${row.host_id}:${row.bigg_reaction_id}`));
  const ecs = ecNumbers(reaction.ec_number);
  if (!ecs.length || linkedRows.length >= limit) return linkedRows;

  const nativeHostWhere = hostWhereClause(host, "r");
  const ecClauses = ecs.map((ec) => `(';' || COALESCE(r.ec_numbers, '') || ';') LIKE ${sqlString(`%;${ec};%`)}`);
  const ecRows = queryHost<HostNativeNeighborRow>(`
    SELECT r.host_id,
           m.host_name,
           m.model_id,
           m.model_source,
           r.bigg_reaction_id,
           r.reaction_name,
           r.subsystem,
           r.ec_numbers,
           'same_ec_native' AS link_type,
           'low' AS confidence,
           r.ec_numbers AS matched_identifier
    FROM host_native_reactions r
    JOIN host_models m ON m.host_id = r.host_id
    WHERE (${ecClauses.join(" OR ")})
      ${nativeHostWhere}
    ORDER BY r.is_exchange ASC, r.is_transport ASC, m.host_name, r.bigg_reaction_id
    LIMIT ${Math.max(1, Math.min(Math.floor(limit * 2), 40))}
  `);

  for (const row of ecRows) {
    const key = `${row.host_id}:${row.bigg_reaction_id}`;
    if (seen.has(key)) continue;
    linkedRows.push(row);
    seen.add(key);
    if (linkedRows.length >= limit) break;
  }
  return linkedRows;
}

function gapFillScore(candidate: RankedPathwayCandidate): number {
  const evidence = Math.min(25, Math.max(0, candidate.enzyme_evidence_score) * 0.25);
  const host = Math.min(20, Math.max(0, candidate.host_suitability_score) * 0.2);
  const kinetics = Math.min(20, candidate.kinetic_record_count * 4 + candidate.km_count + candidate.kcat_count * 1.5 + candidate.kcat_km_count * 1.5);
  const structure = Math.min(18, Math.max(0, candidate.structure_confidence_score) * 0.18);
  const annotation = Math.min(
    12,
    (candidate.interpro_count > 0 ? 3 : 0) +
      (candidate.pfam_count > 0 ? 3 : 0) +
      Math.min(6, (candidate.active_site_count + candidate.binding_site_count + candidate.conserved_site_count) * 2),
  );
  const sequence = candidate.has_sequence ? 5 : 0;
  const longProteinPenalty = candidate.sequence_length && candidate.sequence_length > 1500 ? 5 : 0;
  return Math.max(0, Math.min(100, Math.round(evidence + host + kinetics + structure + annotation + sequence - longProteinPenalty)));
}

function gapFillNotes(candidate: RankedPathwayCandidate): string[] {
  const notes: string[] = [];
  if (candidate.organism) notes.push(`source organism: ${candidate.organism}`);
  if (candidate.kinetic_record_count > 0) notes.push(`${candidate.kinetic_record_count} kinetic records`);
  if (candidate.structure_confidence_score > 0) notes.push(`structure ${candidate.structure_confidence_score}/100 (${candidate.structure_confidence_tier ?? "tier not reported"})`);
  if (candidate.interpro_count || candidate.pfam_count) notes.push(`InterPro/Pfam ${candidate.interpro_count}/${candidate.pfam_count}`);
  const siteCount = candidate.active_site_count + candidate.binding_site_count + candidate.conserved_site_count;
  if (siteCount) notes.push(`${siteCount} functional-site annotations`);
  if (candidate.chassis_count) notes.push(`${candidate.chassis_count} chassis labels`);
  if (candidate.sequence_length && candidate.sequence_length > 1500) notes.push("long sequence may complicate heterologous expression");
  if (!notes.length) notes.push("limited supporting evidence");
  return notes.slice(0, 6);
}

function getGapFillingReport(
  reaction: PathwayReactionRow,
  host: HostKey,
  hostContext: HostReactionContext | null,
  candidates: RankedPathwayCandidate[],
): GapFillingReport | null {
  if (host === "any") {
    return {
      gap_status: "not_evaluated",
      reason: "Select a target host to evaluate host-specific gap filling.",
      suggested_heterologous_enzymes: [],
      neighboring_native_reactions: [],
    };
  }

  const exactCount = Number(hostContext?.high_confidence_link_count ?? 0);
  const ecClassCount = Number(hostContext?.low_confidence_link_count ?? 0);
  const gapStatus: GapFillingReport["gap_status"] =
    exactCount > 0 ? "native_exact" : ecClassCount > 0 ? "ec_class_only" : "missing";
  const reason =
    gapStatus === "native_exact"
      ? "The selected host already has an exact native model reaction link for this step."
      : gapStatus === "ec_class_only"
        ? "No exact native reaction link was found, but the selected host has same-EC native model context."
        : "No exact or EC-class native model reaction link was found for the selected host.";

  if (gapStatus === "native_exact") {
    return {
      gap_status: gapStatus,
      reason,
      suggested_heterologous_enzymes: [],
      neighboring_native_reactions: getHostNativeNeighbors(reaction, host, 5),
    };
  }

  const suggestions = candidates
    .map((candidate) => ({
      ...candidate,
      gap_fill_score: gapFillScore(candidate),
      gap_fill_notes: gapFillNotes(candidate),
    }))
    .sort((a, b) =>
      b.gap_fill_score - a.gap_fill_score ||
      b.kinetic_record_count - a.kinetic_record_count ||
      b.structure_confidence_score - a.structure_confidence_score ||
      String(a.reactenz_enzyme_id ?? "").localeCompare(String(b.reactenz_enzyme_id ?? "")),
    )
    .slice(0, 5);

  return {
    gap_status: gapStatus,
    reason,
    suggested_heterologous_enzymes: suggestions,
    neighboring_native_reactions: getHostNativeNeighbors(reaction, host, 8),
  };
}

export function getReactionHostContexts(reactionId: string): ReactionHostContextRow[] {
  if (!reactionId) return [];
  return queryHost<ReactionHostContextRow>(`
    SELECT m.host_id,
           m.host_name,
           m.model_id,
           m.model_source,
           COUNT(DISTINCT l.bigg_reaction_id) AS model_reaction_count,
           SUM(CASE WHEN l.confidence = 'high' THEN 1 ELSE 0 END) AS high_confidence_link_count,
           SUM(CASE WHEN l.confidence = 'low' THEN 1 ELSE 0 END) AS low_confidence_link_count,
           GROUP_CONCAT(DISTINCT l.bigg_reaction_id) AS model_reaction_ids,
           GROUP_CONCAT(DISTINCT r.subsystem) AS subsystems,
           MAX(r.is_exchange) AS has_exchange_context,
           MAX(r.is_transport) AS has_transport_context
    FROM host_reaction_links l
    JOIN host_models m ON m.host_id = l.host_id
    LEFT JOIN host_native_reactions r
      ON r.host_id = l.host_id AND r.bigg_reaction_id = l.bigg_reaction_id
    WHERE l.reactenz_reaction_id = ${sqlString(reactionId)}
    GROUP BY m.host_id, m.host_name, m.model_id, m.model_source
    ORDER BY high_confidence_link_count DESC, low_confidence_link_count DESC, m.host_name
  `);
}

export function getReactionCandidateComparison(reactionId: string, limit = 80): RankedPathwayCandidate[] {
  if (!reactionId) return [];
  const rows = queryModel<PathwayCandidateRow>(`
    SELECT *
    FROM model_ready_enzyme_candidates
    WHERE ${/^R\d{5}$/.test(reactionId) ? "reactenz_reaction_id" : "reaction_id"} = ${sqlString(reactionId)}
    ORDER BY enzyme_evidence_score DESC,
             kinetic_record_count DESC,
             structure_confidence_score DESC,
             interpro_count DESC,
             pfam_count DESC,
             active_site_count DESC,
             reactenz_enzyme_id
    LIMIT ${Math.max(1, Math.min(Math.floor(limit), 180))}
  `);
  return rows.map((row) => rankCandidate(row, "any"));
}

export function getPathwayExport(params: { reactions: string[]; host?: string; limitPerReaction?: number }): PathwayExportResult {
  const reactions = params.reactions.slice(0, 30);
  const host = normalizeHost(params.host);
  const limit = Math.max(1, Math.min(Math.floor(params.limitPerReaction ?? 10), 50));
  if (!reactions.length) {
    return {
      host,
      host_label: HOSTS[host].label,
      limit_per_reaction: limit,
      host_feasibility: [],
      host_model_coverage_score_semantics: QUALITY_SEMANTICS.hostCoverageScoreNote,
      cofactor_burden: [],
      steps: [],
      boundary_note: boundaryNote(),
    };
  }

  const reactionRows = queryModel<PathwayReactionRow>(`
    SELECT *
    FROM model_ready_reactions
    WHERE reaction_id IN (${sqlIn(reactions)}) OR reactenz_reaction_id IN (${sqlIn(reactions)})
  `);
  const byQuery = new Map<string, PathwayReactionRow>();
  for (const query of reactions) {
    const match = reactionRows.find((row) => row.reaction_id === query || row.reactenz_reaction_id === query);
    if (match) byQuery.set(query, match);
  }
  const internalIds = Array.from(new Set(Array.from(byQuery.values()).map((row) => row.reaction_id)));
  const hostContexts = getHostReactionContexts(Array.from(byQuery.values()), host);
  const hostFeasibility = getHostFeasibilitySummary(Array.from(byQuery.values()));
  const cofactorBurden = getCofactorBurden(Array.from(byQuery.values()));
  const candidateRows = internalIds.length
    ? queryModel<PathwayCandidateRow>(`
        SELECT *
        FROM model_ready_enzyme_candidates
        WHERE reaction_id IN (${sqlIn(internalIds)})
      `)
    : [];
  const candidatesByReaction = new Map<string, RankedPathwayCandidate[]>();
  for (const candidate of candidateRows) {
    const ranked = rankCandidate(candidate, host);
    const rows = candidatesByReaction.get(candidate.reaction_id) ?? [];
    rows.push(ranked);
    candidatesByReaction.set(candidate.reaction_id, rows);
  }

  for (const [reactionId, rows] of candidatesByReaction.entries()) {
    rows.sort((a, b) =>
      b.host_suitability_score - a.host_suitability_score ||
      b.enzyme_evidence_score - a.enzyme_evidence_score ||
      b.structure_confidence_score - a.structure_confidence_score ||
      String(a.reactenz_enzyme_id ?? "").localeCompare(String(b.reactenz_enzyme_id ?? "")),
    );
    candidatesByReaction.set(reactionId, rows.slice(0, limit));
  }

  return {
    host,
    host_label: HOSTS[host].label,
    limit_per_reaction: limit,
    host_feasibility: hostFeasibility,
    host_model_coverage_score_semantics: QUALITY_SEMANTICS.hostCoverageScoreNote,
    cofactor_burden: cofactorBurden,
    steps: reactions.map((query) => {
      const reaction = byQuery.get(query) ?? null;
      const candidates = reaction ? candidatesByReaction.get(reaction.reaction_id) ?? [] : [];
      const hostContext = reaction ? hostContexts.get(reaction.reaction_id) ?? null : null;
      return {
        query,
        found: Boolean(reaction),
        reaction,
        host_context: hostContext,
        candidates,
        gap_filling: reaction ? getGapFillingReport(reaction, host, hostContext, candidates) : null,
      };
    }),
    boundary_note: boundaryNote(),
  };
}

function boundaryNote(): string {
  return "Exact identifier links are model-native evidence; same-EC links are contextual only. Mapping-limited hosts remain not evaluated. This ranking supports inspection, not expression or flux prediction.";
}

export function pathwayExportCsv(result: PathwayExportResult): string {
  const columns = [
    "step",
    "query",
    "host",
    "reactenz_reaction_id",
    "reaction_id",
    "reaction_equation_display",
    "canonical_reaction_smiles",
    "formula_balance_status",
    "quality_flags",
    "host_native_model_reaction_count",
    "host_exact_identifier_link_count",
    "host_ec_class_context_link_count",
    "host_bigg_reaction_ids",
    "host_subsystems",
    "gap_status",
    "gap_reason",
    "gap_neighboring_native_reactions",
    "gap_top_suggestion_id",
    "gap_top_suggestion_organism",
    "gap_top_suggestion_score",
    "gap_top_suggestion_kinetics",
    "gap_top_suggestion_structure_score",
    "host_model_coverage_rank",
    "comparison_host_id",
    "comparison_host_name",
    "comparison_model_id",
    "comparison_mapping_readiness",
    "comparison_exact_native_steps",
    "comparison_ec_class_context_steps",
    "comparison_heterologous_design_steps",
    "comparison_missing_reactions",
    "comparison_not_evaluated_steps",
    "comparison_participant_coverage",
    "comparison_host_model_coverage_score",
    "cofactor_burden_summary",
    "cofactor_net_atp",
    "cofactor_net_nadph",
    "cofactor_net_nadh",
    "cofactor_net_sam",
    "cofactor_net_coa",
    "rank",
    "reactenz_enzyme_id",
    "biopart_id",
    "enzyme_name",
    "gene_name_primary",
    "organism",
    "chassis_labels",
    "host_suitability_score",
    "host_suitability_tier",
    "score_explanation",
    "enzyme_evidence_score",
    "kinetic_record_count",
    "structure_confidence_score",
    "structure_confidence_tier",
    "interpro_count",
    "pfam_count",
    "active_site_count",
    "binding_site_count",
    "conserved_site_count",
    "uniprot_accession",
  ];
  const rows = [columns.join(",")];
  result.steps.forEach((step, stepIndex) => {
    if (!step.reaction) {
      const missingRow: unknown[] = Array(columns.length).fill("");
      missingRow[columns.indexOf("step")] = stepIndex + 1;
      missingRow[columns.indexOf("query")] = step.query;
      missingRow[columns.indexOf("host")] = result.host_label;
      missingRow[columns.indexOf("quality_flags")] = "NOT_FOUND";
      rows.push(missingRow.map(csvCell).join(","));
      return;
    }
    const comparison = result.host_feasibility[0] ?? null;
    const cofactorSummary = summarizeCofactorBurden(result.cofactor_burden);
    const cofactorNet = cofactorNetByLabel(result.cofactor_burden);
    const topGapSuggestion = step.gap_filling?.suggested_heterologous_enzymes[0] ?? null;
    const candidates: Array<RankedPathwayCandidate | null> = step.candidates.length ? step.candidates : [null];
    candidates.forEach((candidate, rankIndex) => {
      rows.push([
        stepIndex + 1,
        step.query,
        result.host_label,
        step.reaction?.reactenz_reaction_id,
        step.reaction?.reaction_id,
        step.reaction?.reaction_equation_display,
        step.reaction?.canonical_reaction_smiles,
        step.reaction?.formula_balance_status,
        step.reaction?.quality_flags,
        step.host_context?.native_model_reaction_count,
        step.host_context?.high_confidence_link_count,
        step.host_context?.low_confidence_link_count,
        step.host_context?.bigg_reaction_ids,
        step.host_context?.subsystems,
        step.gap_filling?.gap_status,
        step.gap_filling?.reason,
        summarizeNativeNeighbors(step.gap_filling?.neighboring_native_reactions ?? []),
        topGapSuggestion?.reactenz_enzyme_id ?? topGapSuggestion?.biopart_id,
        topGapSuggestion?.organism,
        topGapSuggestion?.gap_fill_score,
        topGapSuggestion?.kinetic_record_count,
        topGapSuggestion?.structure_confidence_score,
        comparison ? 1 : "",
        comparison?.host_id,
        comparison?.host_name,
        comparison?.model_id,
        comparison?.mapping_readiness,
        comparison?.exact_native_step_count,
        comparison?.ec_class_context_step_count,
        comparison?.heterologous_step_count,
        comparison?.missing_reaction_count,
        comparison?.not_evaluated_step_count,
        comparison?.participant_coverage,
        comparison?.feasibility_score,
        cofactorSummary,
        cofactorNet.atp,
        cofactorNet.nadph,
        cofactorNet.nadh,
        cofactorNet.sam,
        cofactorNet.coa,
        candidate ? rankIndex + 1 : "",
        candidate?.reactenz_enzyme_id,
        candidate?.biopart_id,
        candidate?.enzyme_name,
        candidate?.gene_name_primary,
        candidate?.organism,
        candidate?.chassis_labels,
        candidate?.host_suitability_score,
        candidate?.host_suitability_tier,
        candidate?.score_explanation.join("; "),
        candidate?.enzyme_evidence_score,
        candidate?.kinetic_record_count,
        candidate?.structure_confidence_score,
        candidate?.structure_confidence_tier,
        candidate?.interpro_count,
        candidate?.pfam_count,
        candidate?.active_site_count,
        candidate?.binding_site_count,
        candidate?.conserved_site_count,
        candidate?.uniprot_accession,
      ].map(csvCell).join(","));
    });
  });
  return `${rows.join("\n")}\n`;
}

function summarizeCofactorBurden(rows: CofactorBurdenRow[]): string {
  return rows
    .slice(0, 8)
    .map((row) => `${row.label}:${row.net_count > 0 ? "+" : ""}${row.net_count}`)
    .join("; ");
}

function cofactorNetByLabel(rows: CofactorBurdenRow[]): { atp: number; nadph: number; nadh: number; sam: number; coa: number } {
  const net = { atp: 0, nadph: 0, nadh: 0, sam: 0, coa: 0 };
  for (const row of rows) {
    if (row.label === "ATP") net.atp += row.net_count;
    if (row.label === "NADPH") net.nadph += row.net_count;
    if (row.label === "NADH") net.nadh += row.net_count;
    if (row.label === "SAM") net.sam += row.net_count;
    if (row.label.includes("CoA")) net.coa += row.net_count;
  }
  return net;
}

function summarizeNativeNeighbors(rows: HostNativeNeighborRow[]): string {
  return rows
    .slice(0, 5)
    .map((row) => `${row.host_id}:${row.bigg_reaction_id}${row.confidence ? `(${row.confidence})` : ""}`)
    .join("; ");
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
