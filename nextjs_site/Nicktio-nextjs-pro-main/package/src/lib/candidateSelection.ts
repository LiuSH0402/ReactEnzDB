import { releasePath } from "@/lib/paths";
import fs from "node:fs";
import path from "node:path";
import { querySqlite, querySqliteParams } from "@/lib/sqlite";

const CANDIDATE_DB = releasePath("advanced_candidate_selection.sqlite");

export const candidateModes = [
  "best-supported",
  "taxonomically-diverse",
  "low-redundancy",
  "structurally-characterized",
  "outside-supported-families",
] as const;

export type CandidateMode = (typeof candidateModes)[number];

export const candidateModeLabels: Record<CandidateMode, string> = {
  "best-supported": "Best-supported representatives",
  "taxonomically-diverse": "Taxonomically diverse candidates",
  "low-redundancy": "Low-redundancy set",
  "structurally-characterized": "Structurally characterized candidates",
  "outside-supported-families": "Outside experimentally supported families",
};

export const candidateModeDescriptions: Record<CandidateMode, string> = {
  "best-supported": "One evidence-ranked representative per NR90 family.",
  "taxonomically-diverse": "Prioritizes distinct genera, species and NR90 families.",
  "low-redundancy": "One representative per broad NR50 family.",
  "structurally-characterized": "PDB, curated active-site or M-CSA supported candidates, compressed at NR90.",
  "outside-supported-families": "One candidate per NR50 family outside every experimentally supported NR50 family for this reaction.",
};

export type CandidateSelectionRow = {
  reaction_id: string;
  reactenz_reaction_id: string;
  biopart_id: string;
  reactenz_enzyme_id: string;
  enzyme_name: string | null;
  organism: string | null;
  taxonomy_id: string | null;
  protein_id: string | null;
  sequence_length: number;
  nr100_cluster_id: string;
  nr90_cluster_id: string;
  nr70_cluster_id: string;
  nr50_cluster_id: string;
  is_known_active: number;
  best_evidence_class: string | null;
  best_evidence_rank: number | null;
  catalytic_assertion_count: number;
  citation_count: number;
  reaction_kinetic_count: number;
  reaction_exact_external_count: number;
  pdb_count: number;
  alphafold_count: number;
  active_site_count: number;
  mcsa_count: number;
  species: string | null;
  genus: string | null;
  phylum: string | null;
  nearest_active_biopart_id: string | null;
  nearest_active_enzyme_id: string | null;
  nearest_active_identity: number | null;
  nearest_active_query_coverage: number | null;
  nearest_active_target_coverage: number | null;
  nearest_active_alignment_score: number | null;
  nearest_active_evidence_class: string | null;
  nearest_active_evidence_rank: number | null;
  nearest_active_shared_level: number | null;
  novelty_class: string;
  novelty_label: string;
  recommendation_reason?: string;
};

export type CandidateReactionSummary = {
  reaction_id: string;
  reactenz_reaction_id: string;
  candidate_count: number;
  known_active_count: number;
  nr90_family_count: number;
  nr50_family_count: number;
  structured_candidate_count: number;
  outside_supported_nr50_count: number;
  no_supported_neighbour_count: number;
};

export function candidateSelectionAvailable(): boolean {
  return fs.existsSync(CANDIDATE_DB);
}

function rankRows(rows: CandidateSelectionRow[]): CandidateSelectionRow[] {
  return [...rows].sort((left, right) => {
    const leftRank = left.best_evidence_rank ?? 99;
    const rightRank = right.best_evidence_rank ?? 99;
    return (
      right.is_known_active - left.is_known_active ||
      leftRank - rightRank ||
      right.catalytic_assertion_count - left.catalytic_assertion_count ||
      right.reaction_exact_external_count - left.reaction_exact_external_count ||
      right.reaction_kinetic_count - left.reaction_kinetic_count ||
      right.pdb_count - left.pdb_count ||
      right.active_site_count - left.active_site_count ||
      (right.nearest_active_identity ?? -1) - (left.nearest_active_identity ?? -1) ||
      left.reactenz_enzyme_id.localeCompare(right.reactenz_enzyme_id)
    );
  });
}

function distinct(rows: CandidateSelectionRow[], key: (row: CandidateSelectionRow) => string, limit: number) {
  const seen = new Set<string>();
  const selected: CandidateSelectionRow[] = [];
  for (const row of rows) {
    const value = key(row);
    if (seen.has(value)) continue;
    seen.add(value);
    selected.push(row);
    if (selected.length >= limit) break;
  }
  return selected;
}

function reason(row: CandidateSelectionRow, mode: CandidateMode): string {
  if (mode === "best-supported") {
    if (row.is_known_active) return "Exact-reaction catalytic evidence; selected as the strongest NR90 representative.";
    if (row.reaction_kinetic_count) return "Reaction-linked kinetics; selected as the strongest NR90 representative.";
    return "Highest available evidence and annotation coverage in its NR90 family.";
  }
  if (mode === "taxonomically-diverse") return `Adds ${row.genus || row.species || row.organism || "an unclassified lineage"} while limiting repeated NR90 families.`;
  if (mode === "low-redundancy") return "Top-ranked representative of a distinct NR50 family.";
  if (mode === "structurally-characterized") return `${row.pdb_count} PDB, ${row.active_site_count} curated site and ${row.mcsa_count} M-CSA links; one per NR90 family.`;
  return "Representative of an NR50 family containing no rank 1–2 catalytic enzyme for this reaction.";
}

export function getCandidateReactionSummary(reactionId: string): CandidateReactionSummary | null {
  if (!candidateSelectionAvailable() || !reactionId.trim()) return null;
  const rows = querySqliteParams<CandidateReactionSummary>(CANDIDATE_DB, `
    SELECT * FROM reaction_candidate_summary
    WHERE reaction_id=? OR reactenz_reaction_id=? LIMIT 1
  `, [reactionId.trim(), reactionId.trim()]);
  return rows[0] ?? null;
}

export function getCandidateSelectionExample(): CandidateReactionSummary | null {
  if (!candidateSelectionAvailable()) return null;
  return querySqlite<CandidateReactionSummary>(CANDIDATE_DB, `
    SELECT * FROM reaction_candidate_summary
    WHERE known_active_count > 0 AND structured_candidate_count > 0
      AND outside_supported_nr50_count > 0 AND candidate_count BETWEEN 12 AND 180
    ORDER BY outside_supported_nr50_count DESC, candidate_count DESC LIMIT 1
  `)[0] ?? null;
}

export function getCandidateSet(reactionId: string, mode: CandidateMode, limit = 100): CandidateSelectionRow[] {
  if (!candidateSelectionAvailable() || !reactionId.trim()) return [];
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 500);
  const rows = querySqliteParams<CandidateSelectionRow>(CANDIDATE_DB, `
    SELECT * FROM reaction_candidate_selection
    WHERE reaction_id=? OR reactenz_reaction_id=?
  `, [reactionId.trim(), reactionId.trim()]);
  const ranked = rankRows(rows);
  let selected: CandidateSelectionRow[];

  if (mode === "best-supported") {
    selected = distinct(ranked, (row) => row.nr90_cluster_id, safeLimit);
  } else if (mode === "low-redundancy") {
    selected = distinct(ranked, (row) => row.nr50_cluster_id, safeLimit);
  } else if (mode === "structurally-characterized") {
    selected = distinct(
      ranked.filter((row) => row.pdb_count > 0 || row.active_site_count > 0 || row.mcsa_count > 0),
      (row) => row.nr90_cluster_id,
      safeLimit,
    );
  } else if (mode === "outside-supported-families") {
    selected = distinct(
      ranked.filter((row) => row.novelty_class === "outside_supported_nr50_families"),
      (row) => row.nr50_cluster_id,
      safeLimit,
    );
  } else {
    const byLineage = distinct(
      ranked,
      (row) => `${row.genus || row.species || row.organism || row.taxonomy_id || row.biopart_id}|${row.nr90_cluster_id}`,
      ranked.length,
    );
    selected = distinct(byLineage, (row) => row.genus || row.species || row.organism || row.biopart_id, safeLimit);
    if (selected.length < safeLimit) {
      const selectedIds = new Set(selected.map((row) => row.biopart_id));
      for (const row of distinct(ranked, (item) => item.nr90_cluster_id, safeLimit)) {
        if (!selectedIds.has(row.biopart_id)) selected.push(row);
        if (selected.length >= safeLimit) break;
      }
    }
  }

  return selected.slice(0, safeLimit).map((row) => ({ ...row, recommendation_reason: reason(row, mode) }));
}

export function candidateSetTsv(rows: CandidateSelectionRow[], mode: CandidateMode): string {
  const columns: Array<keyof CandidateSelectionRow | "selection_mode"> = [
    "selection_mode", "reactenz_reaction_id", "reaction_id", "reactenz_enzyme_id", "biopart_id",
    "enzyme_name", "organism", "taxonomy_id", "protein_id", "sequence_length", "is_known_active",
    "best_evidence_class", "best_evidence_rank", "catalytic_assertion_count", "citation_count",
    "nr90_cluster_id", "nr50_cluster_id", "novelty_class", "novelty_label",
    "nearest_active_enzyme_id", "nearest_active_identity", "nearest_active_query_coverage",
    "nearest_active_target_coverage", "nearest_active_shared_level", "nearest_active_evidence_class",
    "nearest_active_evidence_rank", "reaction_kinetic_count", "pdb_count", "alphafold_count",
    "active_site_count", "mcsa_count", "species", "genus", "phylum", "recommendation_reason",
  ];
  const clean = (value: unknown) => String(value ?? "").replaceAll("\t", " ").replaceAll("\r", " ").replaceAll("\n", " ");
  return [
    columns.join("\t"),
    ...rows.map((row) => columns.map((column) => clean(column === "selection_mode" ? mode : row[column])).join("\t")),
  ].join("\n");
}
