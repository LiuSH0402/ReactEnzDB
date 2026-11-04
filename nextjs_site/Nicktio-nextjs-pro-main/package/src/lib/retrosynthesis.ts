import { releasePath } from "@/lib/paths";
import fs from "node:fs";
import path from "node:path";
import type { ReactionDetail } from "@/lib/reactenzdb";
import { querySqlite } from "@/lib/sqlite";

const RETROSYNTHESIS_DB_PATH = releasePath("retrosynthesis_resources.sqlite");
const RULE_TEMPLATE_BENCHMARK_DB_PATH = releasePath("rule_template_benchmark.sqlite");
const MAPPING_REPORT_PATH = releasePath("retrosynthesis_reactenzdb_mapping_assessment.json");
const MODEL_READY_SUMMARY_PATH = releasePath("model_ready_dataset.summary.json");
const RULE_TEMPLATE_BENCHMARK_SUMMARY_PATH = releasePath("rule_template_benchmark.summary.json");
const HOST_CONTEXT_SUMMARY_PATH = releasePath("host_context_chassis.summary.json");
const DATA_LAYER_REGISTRY_PATH = releasePath("DATA_LAYER_REGISTRY.json");

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlIn(values: string[]): string {
  return values.map(sqlString).join(", ");
}

function queryRetrosynthesis<T>(sql: string): T[] {
  if (!fs.existsSync(RETROSYNTHESIS_DB_PATH)) return [];
  return querySqlite<T>(RETROSYNTHESIS_DB_PATH, sql);
}

function queryRuleBenchmark<T>(sql: string): T[] {
  if (!fs.existsSync(RULE_TEMPLATE_BENCHMARK_DB_PATH)) return [];
  return querySqlite<T>(RULE_TEMPLATE_BENCHMARK_DB_PATH, sql);
}

function safeJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function splitIds(value?: string | null): string[] {
  if (!value) return [];
  return value
    .split(/[;,|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export type RetrosynthesisStats = Record<string, number>;

export type DataLayerRegistryLayer = {
  layer_id: string;
  authority: "canonical" | "derived" | "canonical_for_host_model_mapping" | "deprecated_legacy_snapshot";
  kind: string;
  database: { file: string; size?: number; sha256?: string; available: boolean };
  scope: string;
  source_or_derivation: string;
  upstream_layers?: string[];
  canonical_replacement?: string;
  join_keys?: string[];
};

export type DataLayerRegistry = {
  registry_version?: string;
  release_version?: string;
  policy?: {
    retrosynthesis_authority?: string;
    legacy_core_retrosynthesis_policy?: string;
    mapping_policy?: string;
  };
  layers: DataLayerRegistryLayer[];
};

export type RetrosynthesisSourceSummary = {
  source_name: string;
  files: number;
  size_bytes: number;
  imported_at: string | null;
  source_url: string | null;
};

export type RetrosynthesisDistributionRow = {
  label: string;
  count: number;
};

export type RetrosynthesisBenchmarkSet = {
  benchmark_id: string;
  dataset_name: string;
  task_type: string;
  split_name: string;
  record_count: number;
  reaction_format: string | null;
  license_note: string | null;
};

export type RetrosynthesisResourceFile = {
  resource_id: string;
  source_name: string;
  source_url: string | null;
  file_name: string;
  file_size_bytes: number;
  sha256: string;
  license_note: string | null;
};

export type SubnetxCase = {
  case_id: string;
  target_name: string;
  reaction_count: number | null;
  compound_count: number | null;
  nicepathway_count: number | null;
  minimal_subnet_count: number | null;
};

export type RetrosynthesisRuleMatch = {
  rule_id: string;
  rule_source: string;
  rule_type: string | null;
  smarts: string | null;
  reference_reaction_count: number;
  reference_molecule_count: number;
  reference_enzyme_count: number;
  matched_reference_count: number;
  matched_references: string | null;
};

export type RetrosynthesisMappingReport = {
  main_identifier_maps?: Record<string, number>;
  bionavi_rule_matches_by_db_ec_normalized?: Record<string, { matched_refs: number; matched_rules: number; matched_reactions: number }>;
  bionavi_rule_matches_by_source_ec_normalized?: Record<string, { total_rules: number; matched_rules: number; matched_reactions: number }>;
  smiles_overlap?: Record<string, { distinct: number; exact_overlap: number }>;
  retrobiocat_enzyme_name_text_overlap_weak?: {
    retrobiocat_distinct_enzyme_names: number;
    exact_text_overlap: number;
  };
};

export type ModelReadySummary = {
  release?: string;
  generated_at_utc?: string;
  tables?: Record<string, number>;
  reaction_quality?: Record<string, number>;
  candidate_quality?: Record<string, number>;
  files?: Array<{ file: string; size: number; sha256: string }>;
  notes?: string[];
};

export type RuleTemplateBenchmarkSummary = {
  release?: string;
  generated_at_utc?: string;
  tables?: Record<string, number>;
  rule_templates_by_source?: Record<string, number>;
  rule_templates_by_specificity?: Record<string, number>;
  mapped_rule_templates?: number;
  mapped_reactions?: number;
  baseline_count?: number;
  evaluation?: {
    split_policy?: string;
    split_summary?: Record<string, { queries: number; rows: number; positives: number; sampled_decoys: number }>;
    test_metrics?: Record<string, number>;
  };
  files?: Array<{ file: string; size: number; sha256: string }>;
  notes?: string[];
};

export type BenchmarkBaselineRow = {
  task_name: string;
  baseline_name: string;
  baseline_description: string;
  input_table: string;
  output_table: string;
  metric_suggestion: string;
};

export type BenchmarkTaskOverviewRow = {
  task_name: string;
  task_label: string;
  input_type: string;
  output_type: string;
  rows: number;
  query_count: number;
  candidate_count: number;
  positive_count: number;
  download_file: string;
};

export type BenchmarkExampleRow = {
  task_name: string;
  query_id: string;
  query_display: string | null;
  positive_id: string;
  positive_display: string | null;
  baseline_rank_score: number | null;
  baseline_rank: number | null;
  evidence_score: number | null;
  kinetic_record_count: number | null;
  structure_confidence_score: number | null;
};

export type BenchmarkEvaluationSplitRow = {
  split_name: string;
  split_policy: string;
  query_count: number;
  candidate_rows: number;
  positive_rows: number;
  sampled_decoy_rows: number;
};

export type BenchmarkMetricRow = {
  metric_name: string;
  metric_value: number;
  query_count: number;
  notes: string;
};

export type HostContextSummary = {
  release?: string;
  generated_at_utc?: string;
  host_count?: number;
  host_id?: string;
  host_name?: string;
  hosts?: Array<{
    host_id: string;
    host_name: string;
    model_id: string;
    model_source: string;
    source_url: string;
    native_reactions: number;
    native_metabolites: number;
    gene_count: number;
    high_reaction_links: number;
    low_ec_links: number;
    compound_links: number;
  }>;
  source_model?: string;
  source_models?: string;
  source_url?: string;
  source_cache_sha256?: string;
  tables?: Record<string, number>;
  reaction_link_confidence?: Record<string, number>;
  reaction_context?: Record<string, number>;
  metabolite_context?: Record<string, number>;
  files?: Array<{ file: string; table?: string; rows?: number; columns?: number; size: number; sha256: string }>;
  notes?: string[];
};

export function getRetrosynthesisStats(): RetrosynthesisStats {
  const rows = queryRetrosynthesis<{ metric: string; value: number }>(`
    SELECT 'retrobiocat_rules' AS metric, COUNT(*) AS value FROM retrobiocat_reaction_rules
    UNION ALL SELECT 'retrobiocat_activity', COUNT(*) FROM retrobiocat_activity_evidence
    UNION ALL SELECT 'bionavi_rules', COUNT(*) FROM bionavi_reaction_rules
    UNION ALL SELECT 'bionavi_references', COUNT(*) FROM bionavi_rule_references
    UNION ALL SELECT 'bionavi_building_blocks', COUNT(*) FROM bionavi_building_blocks
    UNION ALL SELECT 'benchmark_reactions', COUNT(*) FROM retrosynthesis_benchmark_reactions
    UNION ALL SELECT 'route_targets', COUNT(*) FROM retrosynthesis_route_targets
    UNION ALL SELECT 'readretro_compounds', COUNT(*) FROM readretro_compounds
    UNION ALL SELECT 'subnetx_cases', COUNT(*) FROM subnetx_cases
    UNION ALL SELECT 'resource_files', COUNT(*) FROM resource_files
  `);
  return Object.fromEntries(rows.map((row) => [row.metric, Number(row.value)]));
}

export function getDataLayerRegistry(): DataLayerRegistry {
  return safeJson<DataLayerRegistry>(DATA_LAYER_REGISTRY_PATH, { layers: [] });
}

export function getRetrosynthesisSources(): RetrosynthesisSourceSummary[] {
  return queryRetrosynthesis<RetrosynthesisSourceSummary>(`
    SELECT source_name,
           COUNT(*) AS files,
           SUM(file_size_bytes) AS size_bytes,
           MAX(imported_at) AS imported_at,
           MAX(source_url) AS source_url
    FROM resource_files
    GROUP BY source_name
    ORDER BY size_bytes DESC
  `);
}

export function getRetrosynthesisResourceFiles(limit = 40): RetrosynthesisResourceFile[] {
  return queryRetrosynthesis<RetrosynthesisResourceFile>(`
    SELECT resource_id, source_name, source_url, file_name, file_size_bytes, sha256, license_note
    FROM resource_files
    ORDER BY source_name, file_name
    LIMIT ${Math.max(1, Math.min(Math.floor(limit), 200))}
  `);
}

export function getRetrobiocatReactionTypes(): RetrosynthesisDistributionRow[] {
  return queryRetrosynthesis<RetrosynthesisDistributionRow>(`
    SELECT COALESCE(reaction_type, 'not classified') AS label, COUNT(*) AS count
    FROM retrobiocat_reaction_rules
    GROUP BY COALESCE(reaction_type, 'not classified')
    ORDER BY count DESC, label
  `);
}

export function getRetrobiocatEnzymeTypes(limit = 12): RetrosynthesisDistributionRow[] {
  return queryRetrosynthesis<RetrosynthesisDistributionRow>(`
    SELECT enzyme_type AS label, COUNT(*) AS count
    FROM retrobiocat_rule_enzymes
    GROUP BY enzyme_type
    ORDER BY count DESC, label
    LIMIT ${Math.max(1, Math.min(Math.floor(limit), 50))}
  `);
}

export function getBionaviRuleSources(): RetrosynthesisDistributionRow[] {
  return queryRetrosynthesis<RetrosynthesisDistributionRow>(`
    SELECT rule_source AS label, COUNT(*) AS count
    FROM bionavi_reaction_rules
    GROUP BY rule_source
    ORDER BY count DESC, label
  `);
}

export function getRetrosynthesisBenchmarkSets(): RetrosynthesisBenchmarkSet[] {
  return queryRetrosynthesis<RetrosynthesisBenchmarkSet>(`
    SELECT benchmark_id, dataset_name, task_type, split_name, record_count, reaction_format, license_note
    FROM retrosynthesis_benchmark_sets
    ORDER BY dataset_name, split_name
  `);
}

export function getSubnetxCases(limit = 8): SubnetxCase[] {
  return queryRetrosynthesis<SubnetxCase>(`
    SELECT case_id, target_name, reaction_count, compound_count, nicepathway_count, minimal_subnet_count
    FROM subnetx_cases
    ORDER BY target_name
    LIMIT ${Math.max(1, Math.min(Math.floor(limit), 50))}
  `);
}

export function getRetrosynthesisMappingReport(): RetrosynthesisMappingReport {
  return safeJson<RetrosynthesisMappingReport>(MAPPING_REPORT_PATH, {});
}

export function getModelReadySummary(): ModelReadySummary {
  return safeJson<ModelReadySummary>(MODEL_READY_SUMMARY_PATH, {});
}

export function getRuleTemplateBenchmarkSummary(): RuleTemplateBenchmarkSummary {
  return safeJson<RuleTemplateBenchmarkSummary>(RULE_TEMPLATE_BENCHMARK_SUMMARY_PATH, {});
}

export function getBenchmarkBaselines(): BenchmarkBaselineRow[] {
  return queryRuleBenchmark<BenchmarkBaselineRow>(`
    SELECT task_name,
           baseline_name,
           baseline_description,
           input_table,
           output_table,
           metric_suggestion
    FROM benchmark_baselines
    ORDER BY task_name
  `);
}

export function getBenchmarkTaskOverview(): BenchmarkTaskOverviewRow[] {
  return queryRuleBenchmark<BenchmarkTaskOverviewRow>(`
    SELECT 'reaction_to_enzyme_retrieval' AS task_name,
           'Reaction to enzyme retrieval' AS task_label,
           'reaction ID / EC / Rhea / MNX / canonical reaction SMILES' AS input_type,
           'linked enzyme candidates' AS output_type,
           COUNT(*) AS rows,
           COUNT(DISTINCT query_reaction_id) AS query_count,
           COUNT(DISTINCT positive_biopart_id) AS candidate_count,
           COUNT(*) AS positive_count,
           'benchmark_task_reaction_to_enzyme.tsv.gz' AS download_file
    FROM benchmark_task_reaction_to_enzyme
    UNION ALL
    SELECT 'substrate_product_to_reaction_retrieval',
           'Substrate/product to reaction retrieval',
           'reactant/product canonical SMILES',
           'gold ReactEnzDB reaction',
           COUNT(*),
           COUNT(DISTINCT query_canonical_reaction_smiles),
           COUNT(DISTINCT gold_reaction_id),
           COUNT(*),
           'benchmark_task_substrate_product_to_reaction.tsv.gz'
    FROM benchmark_task_substrate_product_to_reaction
    UNION ALL
    SELECT 'enzyme_candidate_ranking',
           'Enzyme candidate ranking',
           'reaction ID with candidate pool',
           'ranked enzyme candidates',
           COUNT(*),
           COUNT(DISTINCT query_reaction_id),
           COUNT(DISTINCT candidate_biopart_id),
           COUNT(*),
           'benchmark_task_enzyme_ranking.tsv.gz'
    FROM benchmark_task_enzyme_ranking
    ORDER BY task_name
  `);
}

export function getBenchmarkEvaluationSplits(): BenchmarkEvaluationSplitRow[] {
  return queryRuleBenchmark<BenchmarkEvaluationSplitRow>(`
    SELECT split_name, split_policy, query_count, candidate_rows, positive_rows, sampled_decoy_rows
    FROM benchmark_split_summary
    WHERE task_name = 'reaction_to_enzyme_retrieval_evaluation'
    ORDER BY CASE split_name WHEN 'train' THEN 1 WHEN 'validation' THEN 2 ELSE 3 END
  `);
}

export function getBenchmarkMetrics(): BenchmarkMetricRow[] {
  return queryRuleBenchmark<BenchmarkMetricRow>(`
    SELECT metric_name, metric_value, query_count, notes
    FROM benchmark_baseline_metrics
    WHERE task_name = 'reaction_to_enzyme_retrieval_evaluation'
      AND split_name = 'test'
      AND baseline_name = 'evidence_structure_kinetics_baseline_v1'
    ORDER BY CASE metric_name
      WHEN 'Recall@1' THEN 1 WHEN 'Recall@5' THEN 2 WHEN 'Recall@10' THEN 3 WHEN 'MRR' THEN 4 ELSE 5 END
  `);
}

export function getBenchmarkExamples(limitPerTask = 3): BenchmarkExampleRow[] {
  const limit = Math.max(1, Math.min(Math.floor(limitPerTask), 10));
  return queryRuleBenchmark<BenchmarkExampleRow>(`
    WITH examples AS (
      SELECT task_name,
             query_reactenz_reaction_id AS query_id,
             COALESCE(query_ec_number, query_rhea_id, query_mnx_reaction_ids, query_canonical_reaction_smiles) AS query_display,
             COALESCE(positive_reactenz_enzyme_id, positive_biopart_id) AS positive_id,
             COALESCE(enzyme_name, organism, chassis_labels) AS positive_display,
             baseline_rank_score,
             NULL AS baseline_rank,
             evidence_score,
             kinetic_record_count,
             structure_confidence_score,
             ROW_NUMBER() OVER (PARTITION BY task_name ORDER BY baseline_rank_score DESC, query_reactenz_reaction_id) AS rn
      FROM benchmark_task_reaction_to_enzyme
      UNION ALL
      SELECT task_name,
             COALESCE(query_canonical_reaction_smiles, query_reactants_smiles || '>>' || query_products_smiles) AS query_id,
             ec_number AS query_display,
             gold_reactenz_reaction_id AS positive_id,
             COALESCE(rhea_id, mnx_reaction_ids, formula_balance_status) AS positive_display,
             NULL AS baseline_rank_score,
             NULL AS baseline_rank,
             evidence_score,
             NULL AS kinetic_record_count,
             NULL AS structure_confidence_score,
             ROW_NUMBER() OVER (PARTITION BY task_name ORDER BY evidence_score DESC, gold_reactenz_reaction_id) AS rn
      FROM benchmark_task_substrate_product_to_reaction
      UNION ALL
      SELECT task_name,
             query_reactenz_reaction_id AS query_id,
             enzyme_name AS query_display,
             COALESCE(candidate_reactenz_enzyme_id, candidate_biopart_id) AS positive_id,
             organism AS positive_display,
             baseline_rank_score,
             baseline_rank,
             enzyme_evidence_score AS evidence_score,
             kinetic_record_count,
             structure_confidence_score,
             ROW_NUMBER() OVER (PARTITION BY task_name ORDER BY baseline_rank ASC, baseline_rank_score DESC, query_reactenz_reaction_id) AS rn
      FROM benchmark_task_enzyme_ranking
    )
    SELECT task_name,
           query_id,
           query_display,
           positive_id,
           positive_display,
           baseline_rank_score,
           baseline_rank,
           evidence_score,
           kinetic_record_count,
           structure_confidence_score
    FROM examples
    WHERE rn <= ${limit}
    ORDER BY task_name, rn
  `);
}

export function getHostContextSummary(): HostContextSummary {
  // The legacy host analysis includes KEGG-dependent mappings.
  return {};
}

export function getReactionRetrosynthesisLinks(reaction: ReactionDetail, limit = 40): RetrosynthesisRuleMatch[] {
  const clauses: string[] = [];
  const ecValues = unique(splitIds(reaction.ec_number).flatMap((id) => {
    const normalized = id.replace(/^EC[-:\s]*/i, "");
    return normalized ? [`EC-${normalized}`, normalized] : [];
  }));
  const rheaValues = unique(splitIds(reaction.rhea_id).flatMap((id) => {
    const normalized = id.replace(/^RHEA[:\s-]*/i, "");
    return normalized ? [normalized, `RHEA:${normalized}`] : [];
  }));
  const metacycValues = unique(splitIds(reaction.metacyc_reaction_id));

  if (ecValues.length) clauses.push(`(ref.external_db = 'BRENDA_EC' AND ref.external_id IN (${sqlIn(ecValues)}))`);
  if (rheaValues.length) clauses.push(`(ref.external_db = 'Rhea' AND ref.external_id IN (${sqlIn(rheaValues)}))`);
  if (metacycValues.length) clauses.push(`(ref.external_db = 'MetaCyc' AND ref.external_id IN (${sqlIn(metacycValues)}))`);

  if (!clauses.length) return [];

  return queryRetrosynthesis<RetrosynthesisRuleMatch>(`
    SELECT r.rule_id,
           r.rule_source,
           r.rule_type,
           r.smarts,
           r.reference_reaction_count,
           r.reference_molecule_count,
           r.reference_enzyme_count,
           COUNT(DISTINCT ref.reference_id) AS matched_reference_count,
           GROUP_CONCAT(DISTINCT ref.external_db || ':' || ref.external_id) AS matched_references
    FROM bionavi_rule_references ref
    JOIN bionavi_reaction_rules r ON r.rule_id = ref.rule_id
    WHERE (${clauses.join(" OR ")})
    GROUP BY r.rule_id
    ORDER BY CASE r.rule_source WHEN 'enzymatic_metabolic' THEN 0 ELSE 1 END,
             matched_reference_count DESC,
             r.reference_reaction_count DESC,
             r.rule_id
    LIMIT ${Math.max(1, Math.min(Math.floor(limit), 100))}
  `);
}
