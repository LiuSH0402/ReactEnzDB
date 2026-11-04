import { releasePath } from "@/lib/paths";
import fs from "node:fs";
import path from "node:path";
import { querySqlite } from "@/lib/sqlite";

const CLUSTER_DB = releasePath("enzyme_sequence_clusters.sqlite");
export const clusterThresholds = [100, 90, 70, 50] as const;
export type ClusterThreshold = (typeof clusterThresholds)[number];

export type SequenceClusterRow = {
  threshold: number;
  cluster_id: string;
  unique_sequence_count: number;
  enzyme_record_count: number;
  species_count: number;
  genus_count: number;
  family_count: number;
  phylum_count: number;
  taxonomy_shannon: number;
  experimental_supported_count: number;
  kinetic_supported_count: number;
  pdb_supported_count: number;
  alphafold_supported_count: number;
  active_site_supported_count: number;
  mcsa_supported_count: number;
  representative_biopart_id: string;
  representative_enzyme_id: string;
  representative_score: number;
  underexplored: number;
};

export type ReactionSequenceClusterRow = Omit<SequenceClusterRow, "family_count" | "mcsa_supported_count"> & {
  reaction_id: string;
  reactenz_reaction_id: string;
  member_enzyme_count: number;
};

export type EnzymeClusterMembership = SequenceClusterRow & {
  biopart_id: string;
  reactenz_enzyme_id: string;
  is_representative: number;
};

function validThreshold(value: number): ClusterThreshold {
  return clusterThresholds.includes(value as ClusterThreshold) ? (value as ClusterThreshold) : 90;
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function sequenceClustersAvailable(): boolean {
  return fs.existsSync(CLUSTER_DB);
}

export function getSequenceClusterOverview(): Array<{ threshold: number; clusters: number; enzyme_records: number; unique_sequences: number; supported_clusters: number; underexplored_clusters: number }> {
  if (!sequenceClustersAvailable()) return [];
  return querySqlite(CLUSTER_DB, `
    SELECT threshold, COUNT(*) AS clusters,
           SUM(enzyme_record_count) AS enzyme_records,
           SUM(unique_sequence_count) AS unique_sequences,
           SUM(CASE WHEN experimental_supported_count > 0 THEN 1 ELSE 0 END) AS supported_clusters,
           SUM(underexplored) AS underexplored_clusters
    FROM sequence_clusters GROUP BY threshold ORDER BY threshold DESC
  `);
}

export function listSequenceClusters(options: { threshold?: number; support?: "all" | "experimental" | "structure" | "diverse" | "underexplored"; limit?: number } = {}): SequenceClusterRow[] {
  if (!sequenceClustersAvailable()) return [];
  const threshold = validThreshold(options.threshold ?? 90);
  const support = options.support ?? "all";
  const filters: Record<string, string> = {
    all: "1=1",
    experimental: "experimental_supported_count > 0",
    structure: "pdb_supported_count > 0",
    diverse: "species_count >= 5",
    underexplored: "underexplored = 1",
  };
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  return querySqlite(CLUSTER_DB, `
    SELECT *, global_representative_biopart_id AS representative_biopart_id,
              global_representative_enzyme_id AS representative_enzyme_id
    FROM sequence_clusters
    WHERE threshold = ${threshold} AND ${filters[support] ?? filters.all}
    ORDER BY experimental_supported_count DESC, kinetic_supported_count DESC,
             species_count DESC, enzyme_record_count DESC, cluster_id
    LIMIT ${limit}
  `);
}

export function getReactionSequenceClusters(reactionId: string, threshold = 90, limit = 80): ReactionSequenceClusterRow[] {
  if (!sequenceClustersAvailable()) return [];
  return querySqlite(CLUSTER_DB, `
    SELECT r.*, c.family_count, c.mcsa_supported_count
    FROM reaction_sequence_clusters r
    JOIN sequence_clusters c ON c.threshold=r.threshold AND c.cluster_id=r.cluster_id
    WHERE r.threshold=${validThreshold(threshold)}
      AND ${/^R\d{5}$/.test(reactionId) ? "r.reactenz_reaction_id" : "r.reaction_id"}=${quote(reactionId)}
    ORDER BY r.experimental_supported_count DESC, r.kinetic_supported_count DESC,
             r.pdb_supported_count DESC, r.species_count DESC, r.member_enzyme_count DESC
    LIMIT ${Math.min(Math.max(limit, 1), 500)}
  `);
}

export function getEnzymeClusterMemberships(biopartId: string, exactBiopartId = false): EnzymeClusterMembership[] {
  if (!sequenceClustersAvailable()) return [];
  const identityFilter = exactBiopartId
    ? `m.biopart_id=${quote(biopartId)}`
    : `(m.biopart_id=${quote(biopartId)} OR m.reactenz_enzyme_id=${quote(biopartId)})`;
  return querySqlite(CLUSTER_DB, `
    SELECT m.biopart_id, m.reactenz_enzyme_id,
           m.is_global_representative AS is_representative, c.*,
           c.global_representative_biopart_id AS representative_biopart_id,
           c.global_representative_enzyme_id AS representative_enzyme_id
    FROM sequence_cluster_members m
    JOIN sequence_clusters c ON c.threshold=m.threshold AND c.cluster_id=m.cluster_id
    WHERE ${identityFilter}
    ORDER BY m.threshold DESC
  `);
}
