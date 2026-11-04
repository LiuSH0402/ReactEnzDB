import { releasePath } from "@/lib/paths";
import fs from "node:fs";
import path from "node:path";
import { querySqlite, querySqliteParams } from "@/lib/sqlite";

const ANALYSIS_DB = releasePath("candidate_diversity_analysis.sqlite");

export type CandidateDiversityThreshold = {
  threshold: number;
  cluster_count: number;
  enzyme_record_count: number;
  unique_sequence_memberships: number;
  compression_fraction_vs_enzyme_records: number;
  clusters_with_experimental_support: number;
  clusters_with_kinetic_support: number;
  clusters_with_pdb_support: number;
  clusters_with_alphafold_support: number;
  clusters_with_active_site_support: number;
  representatives_with_experimental_support: number;
  representatives_with_kinetic_support: number;
  representatives_with_pdb_support: number;
  representatives_with_alphafold_support: number;
  representatives_with_active_site_support: number;
  kinetic_supported_cluster_representative_retention: number;
  pdb_supported_cluster_representative_retention: number;
  active_site_cluster_representative_retention: number;
  reaction_count: number;
  mean_clusters_per_reaction: number;
  median_clusters_per_reaction: number;
  p90_clusters_per_reaction: number;
  reactions_with_multiple_clusters: number;
};

export type CandidateDiversityDistribution = {
  metric: string;
  reaction_count: number;
  zero_count: number;
  mean: number;
  minimum: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  maximum: number;
  interpretation: string;
};

export type HighEvidenceTaxonomy = {
  phylum: string;
  enzyme_candidate_count: number;
  reaction_association_count: number;
  reaction_count: number;
  species_count: number;
  candidates_with_pdb: number;
  candidates_with_alphafold: number;
  candidates_with_active_site: number;
};

export type ReactionCandidateDiversity = {
  reaction_id: string;
  reactenz_reaction_id: string;
  enzyme_candidate_count: number;
  unique_sequence_count: number;
  duplicate_sequence_record_count: number;
  nr100_cluster_count: number;
  nr90_cluster_count: number;
  nr70_cluster_count: number;
  nr50_cluster_count: number;
  nr90_reduction_fraction_vs_records: number;
  nr90_reduction_fraction_vs_unique_sequences: number;
  nr70_reduction_fraction_vs_records: number;
  nr50_reduction_fraction_vs_records: number;
  multiple_nr70_clusters: number;
  multiple_nr50_clusters: number;
  species_count: number;
  genus_count: number;
  phylum_count: number;
  species_shannon: number;
  experimental_candidate_count: number;
  any_kinetic_candidate_count: number;
  reaction_kinetic_candidate_count: number;
  exact_external_kinetic_candidate_count: number;
  pdb_candidate_count: number;
  alphafold_candidate_count: number;
  structure_candidate_count: number;
  active_site_candidate_count: number;
  reaction_supported_candidate_count: number;
  multimodal_candidate_count: number;
  kinetic_snapshot_status: string;
};

export type CandidateDiversityOverview = {
  metadata: Record<string, string>;
  thresholds: CandidateDiversityThreshold[];
  distributions: Record<string, CandidateDiversityDistribution>;
  taxonomy: HighEvidenceTaxonomy[];
  counts: {
    reactions: number;
    multipleNr70: number;
    multipleNr50: number;
    reactionSupported: number;
    multimodal: number;
    exactSubstrateProduct: number;
  };
};

export function candidateDiversityAvailable(): boolean {
  return fs.existsSync(ANALYSIS_DB);
}

export function getCandidateDiversityOverview(): CandidateDiversityOverview | null {
  if (!candidateDiversityAvailable()) return null;
  const metadata = Object.fromEntries(querySqlite<{ key: string; value: string }>(ANALYSIS_DB, "SELECT key,value FROM metadata").map((row) => [row.key, row.value]));
  const thresholds = querySqlite<CandidateDiversityThreshold>(ANALYSIS_DB, "SELECT * FROM threshold_coverage_summary ORDER BY threshold DESC");
  const distributionRows = querySqlite<CandidateDiversityDistribution>(ANALYSIS_DB, "SELECT * FROM reaction_metric_distributions ORDER BY metric");
  const distributions = Object.fromEntries(distributionRows.map((row) => [row.metric, row]));
  const taxonomy = querySqlite<HighEvidenceTaxonomy>(ANALYSIS_DB, "SELECT * FROM high_evidence_taxonomy_summary ORDER BY enzyme_candidate_count DESC LIMIT 12");
  const countRows = querySqlite<{ reactions: number; multiple_nr70: number; multiple_nr50: number; reaction_supported: number; multimodal: number; exact_substrate_product: number }>(ANALYSIS_DB, `
    SELECT COUNT(*) reactions,SUM(multiple_nr70_clusters) multiple_nr70,SUM(multiple_nr50_clusters) multiple_nr50,
           SUM(reaction_supported_candidate_count>0) reaction_supported,SUM(multimodal_candidate_count>0) multimodal,
           (SELECT value FROM final_evidence_summary WHERE metric='reactions_with_exact_substrate_product_candidates') exact_substrate_product
    FROM reaction_candidate_diversity
  `);
  const counts = countRows[0];
  return {
    metadata,
    thresholds,
    distributions,
    taxonomy,
    counts: {
      reactions: counts.reactions,
      multipleNr70: counts.multiple_nr70,
      multipleNr50: counts.multiple_nr50,
      reactionSupported: counts.reaction_supported,
      multimodal: counts.multimodal,
      exactSubstrateProduct: counts.exact_substrate_product,
    },
  };
}

export function getReactionCandidateDiversity(reactionId: string): ReactionCandidateDiversity | null {
  if (!candidateDiversityAvailable()) return null;
  return querySqliteParams<ReactionCandidateDiversity>(ANALYSIS_DB, `
    SELECT * FROM reaction_candidate_diversity
    WHERE reaction_id=? OR reactenz_reaction_id=?
    LIMIT 1
  `, [reactionId, reactionId])[0] ?? null;
}

export function listCandidateDiversityReactions(limit = 100): ReactionCandidateDiversity[] {
  if (!candidateDiversityAvailable()) return [];
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 100, 1), 500);
  return querySqlite<ReactionCandidateDiversity>(ANALYSIS_DB, `
    SELECT * FROM reaction_candidate_diversity
    ORDER BY multimodal_candidate_count DESC,reaction_supported_candidate_count DESC,
             nr70_cluster_count DESC,reaction_id
    LIMIT ${safeLimit}
  `);
}
