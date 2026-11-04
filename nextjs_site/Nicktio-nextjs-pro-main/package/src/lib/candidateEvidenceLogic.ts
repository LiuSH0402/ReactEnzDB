import type { CandidateSelectionRow } from "./candidateSelection";

export const evidenceLevels = ["all", "nr100", "nr90", "nr70", "nr50"] as const;
export type EvidenceLevel = (typeof evidenceLevels)[number];

export type CandidateEvidenceFlags = {
  pfam: boolean;
  interpro: boolean;
  site: boolean;
  literature: boolean;
};

export function evidenceCompleteness(row: CandidateSelectionRow, flags: CandidateEvidenceFlags): number {
  return Number(row.is_known_active > 0 || row.reaction_exact_external_count > 0)
    + Number(row.sequence_length > 0)
    + Number(row.reaction_kinetic_count > 0)
    + Number(flags.pfam || flags.interpro)
    + Number(row.pdb_count > 0 || row.alphafold_count > 0)
    + Number(row.active_site_count > 0 || row.mcsa_count > 0 || flags.site)
    + Number(row.citation_count > 0 || flags.literature)
    + Number(Boolean(row.organism || row.taxonomy_id));
}

export function selectEvidenceRepresentatives<T extends CandidateSelectionRow>(
  rows: T[], level: EvidenceLevel, flagsByBiopart: Map<string, CandidateEvidenceFlags>, limit = 30,
): Array<T & { evidence_completeness: number }> {
  const ranked = rows.map((row) => ({ ...row, evidence_completeness: evidenceCompleteness(row, flagsByBiopart.get(row.biopart_id) ?? { pfam: false, interpro: false, site: false, literature: false }) }))
    .sort((a, b) => b.evidence_completeness - a.evidence_completeness
      || a.reactenz_enzyme_id.localeCompare(b.reactenz_enzyme_id));
  if (level === "all") return ranked.slice(0, limit);
  const clusterField = `${level}_cluster_id` as "nr100_cluster_id" | "nr90_cluster_id" | "nr70_cluster_id" | "nr50_cluster_id";
  const seen = new Set<string>();
  return ranked.filter((row) => {
    const id = row[clusterField];
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, limit);
}

export function diversityCounts(rows: CandidateSelectionRow[]) {
  const distinct = (field: "nr100_cluster_id" | "nr90_cluster_id" | "nr70_cluster_id" | "nr50_cluster_id") => new Set(rows.map((row) => row[field]).filter(Boolean)).size;
  return { sequence_candidates: rows.length, nr100: distinct("nr100_cluster_id"), nr90: distinct("nr90_cluster_id"), nr70: distinct("nr70_cluster_id"), nr50: distinct("nr50_cluster_id") };
}
