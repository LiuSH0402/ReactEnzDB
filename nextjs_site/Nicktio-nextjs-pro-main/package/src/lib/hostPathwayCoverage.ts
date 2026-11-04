import { releasePath } from "@/lib/paths";
import fs from "node:fs";
import path from "node:path";
import { querySqlite } from "@/lib/sqlite";

const DB_PATH = releasePath("host_pathway_coverage_analysis.sqlite");
const SUMMARY_PATH = releasePath("host_pathway_coverage_analysis.summary.json");

export type HostCoverageRow = {
  host_id: string;
  host_name: string;
  model_id: string;
  model_source: string;
  mapping_readiness: "available" | "limited_identifier_coverage" | "unavailable_no_reaction_mapping";
  mapping_boundary: string;
  native_model_reaction_count: number;
  reactenz_reaction_count: number;
  exact_native_reaction_count: number;
  exact_native_fraction_all: number;
  exact_native_fraction_mapped_universe: number;
  ec_context_only_reaction_count: number;
  heterologous_candidate_reaction_count: number | null;
  unresolved_reaction_count: number | null;
  not_evaluated_reaction_count: number;
  precursor_panel_count: number;
  cofactor_panel_count: number;
  fully_native_pathway_count: number;
};

export type ReactionClassHostCoverageRow = {
  host_id: string;
  ec_class: string;
  ec_class_label: string;
  mapping_readiness: string;
  reaction_count: number;
  exact_native_count: number;
  exact_native_fraction: number;
  ec_context_only_count: number;
  heterologous_candidate_count: number;
  unresolved_count: number;
  not_evaluated_count: number;
};

export type PathwayHostCoverageRow = {
  source_db: string;
  pathway_id: string;
  pathway_name: string | null;
  host_id: string;
  mapping_readiness: string;
  step_count: number;
  exact_native_step_count: number;
  exact_native_fraction: number;
  ec_context_only_step_count: number;
  heterologous_candidate_step_count: number;
  unresolved_step_count: number;
  not_evaluated_step_count: number;
  all_steps_exact_native: number;
};

export type HostCoverageCounts = {
  hosts: number;
  analysis_ready_hosts: number;
  limited_mapping_hosts: number;
  unavailable_mapping_hosts: number;
  reactenz_reactions: number;
  exact_mapped_reaction_universe: number;
  pathway_membership_sets: number;
  reaction_pathway_memberships: number;
};

type SummaryFile = {
  counts: HostCoverageCounts;
  reaction_implementation_classes: Record<string, number>;
  native_definition: string;
  ec_context_definition: string;
  heterologous_definition: string;
  unresolved_definition: string;
  pathway_boundary: string;
  cofactor_boundary: string;
};

function available(): boolean {
  // This legacy layer derives coverage from KEGG pathway membership.
  return false;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function getHostPathwayCoverageOverview() {
  if (!available()) return null;
  const summary = JSON.parse(fs.readFileSync(SUMMARY_PATH, "utf8")) as SummaryFile;
  const hosts = querySqlite<HostCoverageRow>(DB_PATH, `
    SELECT h.*,
           (SELECT COUNT(*) FROM pathway_host_coverage p
            WHERE p.host_id=h.host_id AND p.all_steps_exact_native=1) AS fully_native_pathway_count
    FROM host_coverage_summary h
    ORDER BY CASE h.mapping_readiness WHEN 'available' THEN 0 WHEN 'limited_identifier_coverage' THEN 1 ELSE 2 END,
             h.exact_native_reaction_count DESC
  `);
  const classCoverage = querySqlite<ReactionClassHostCoverageRow>(DB_PATH, `
    SELECT * FROM reaction_class_host_coverage
    ORDER BY host_id, CASE ec_class WHEN 'unclassified' THEN 8 ELSE CAST(ec_class AS INTEGER) END
  `);
  return {
    counts: summary.counts,
    reactionImplementationClasses: summary.reaction_implementation_classes,
    definitions: {
      native: summary.native_definition,
      ecContext: summary.ec_context_definition,
      heterologous: summary.heterologous_definition,
      unresolved: summary.unresolved_definition,
      pathwayBoundary: summary.pathway_boundary,
      cofactorBoundary: summary.cofactor_boundary,
    },
    hosts,
    classCoverage,
  };
}

export function getHostPathwayCoverage(hostId: string) {
  if (!available()) return null;
  const host = querySqlite<HostCoverageRow>(DB_PATH, `
    SELECT h.*,
           (SELECT COUNT(*) FROM pathway_host_coverage p
            WHERE p.host_id=h.host_id AND p.all_steps_exact_native=1) AS fully_native_pathway_count
    FROM host_coverage_summary h WHERE h.host_id=${sqlString(hostId)} LIMIT 1
  `)[0];
  if (!host) return null;
  const reactionClasses = querySqlite<ReactionClassHostCoverageRow>(DB_PATH, `
    SELECT * FROM reaction_class_host_coverage
    WHERE host_id=${sqlString(hostId)}
    ORDER BY CASE ec_class WHEN 'unclassified' THEN 8 ELSE CAST(ec_class AS INTEGER) END
  `);
  const pathways = querySqlite<PathwayHostCoverageRow>(DB_PATH, `
    SELECT * FROM pathway_host_coverage
    WHERE host_id=${sqlString(hostId)}
    ORDER BY exact_native_fraction DESC, step_count DESC, pathway_name
  `);
  return { host, reactionClasses, pathways };
}

export function getReactionHostCoverage(reactionId: string) {
  if (!available()) return null;
  const summary = querySqlite<Record<string, string | number | null>>(DB_PATH, `
    SELECT * FROM reaction_host_requirement_summary
    WHERE reaction_id=${sqlString(reactionId)} OR reactenz_reaction_id=${sqlString(reactionId)}
    LIMIT 1
  `)[0];
  if (!summary) return null;
  const rows = querySqlite<Record<string, string | number | null>>(DB_PATH, `
    SELECT r.*, h.host_name, h.model_id, h.mapping_readiness
    FROM reaction_host_coverage r JOIN host_coverage_summary h USING(host_id)
    WHERE r.reaction_id=${sqlString(String(summary.reaction_id))}
    ORDER BY CASE r.implementation_status WHEN 'native_exact' THEN 0 WHEN 'heterologous_candidate' THEN 1 ELSE 2 END,
             h.host_name
  `);
  return { summary, hosts: rows };
}
