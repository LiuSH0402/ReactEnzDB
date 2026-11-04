import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { diversityCounts, evidenceCompleteness, selectEvidenceRepresentatives } from "../src/lib/candidateEvidenceLogic.ts";

const candidate = (id, clusters, extra = {}) => ({
  biopart_id: id, reactenz_enzyme_id: id, best_evidence_rank: null,
  is_known_active: 0, reaction_exact_external_count: 0, sequence_length: 200,
  reaction_kinetic_count: 0, pdb_count: 0, alphafold_count: 0,
  active_site_count: 0, mcsa_count: 0, citation_count: 0,
  organism: "Source", taxonomy_id: null,
  nr100_cluster_id: clusters[0], nr90_cluster_id: clusters[1],
  nr70_cluster_id: clusters[2], nr50_cluster_id: clusters[3], ...extra,
});
const noFlags = { pfam: false, interpro: false, site: false, literature: false };

test("completeness counts evidence presence, not host identity or suitability", () => {
  const row = candidate("A", ["a", "b", "c", "d"], { is_known_active: 1, reaction_kinetic_count: 1, pdb_count: 1, citation_count: 2 });
  assert.equal(evidenceCompleteness(row, { ...noFlags, pfam: true, site: true }), 8);
  assert.equal(evidenceCompleteness(row, noFlags), 6);
});

test("each NR level independently chooses the most complete representative", () => {
  const rows = [
    candidate("A", ["100a", "90a", "70a", "50a"]),
    candidate("B", ["100b", "90a", "70a", "50a"], { pdb_count: 1 }),
    candidate("C", ["100c", "90b", "70a", "50a"], { reaction_kinetic_count: 1 }),
    candidate("D", ["100d", "90c", "70b", "50b"]),
  ];
  assert.deepEqual(diversityCounts(rows), { sequence_candidates: 4, nr100: 4, nr90: 3, nr70: 2, nr50: 2 });
  const flags = new Map();
  assert.deepEqual(selectEvidenceRepresentatives(rows, "nr90", flags).map((row) => row.biopart_id), ["B", "C", "D"]);
  assert.deepEqual(selectEvidenceRepresentatives(rows, "nr70", flags).map((row) => row.biopart_id), ["B", "D"]);
  assert.deepEqual(selectEvidenceRepresentatives(rows, "nr50", flags).map((row) => row.biopart_id), ["B", "D"]);
  assert.equal(selectEvidenceRepresentatives(rows, "all", flags).length, 4);
});

test("the local board keeps model mapping context separate from enzyme evidence", () => {
  const page = fs.readFileSync(path.join(import.meta.dirname, "../src/app/tools/pathway-host-context/evidence/page.tsx"), "utf8");
  const board = fs.readFileSync(path.join(import.meta.dirname, "../src/lib/candidateEvidenceBoard.ts"), "utf8");
  assert.match(page, /localMappingPreviewAvailable\(\)/);
  assert.match(page, /not biological absence or candidate–host compatibility/);
  assert.match(page, /getReactionKinetics\(reaction\.reaction_id/);
  assert.match(board, /COUNT\(DISTINCT biopart_id\)/);
  assert.doesNotMatch(board, /host.suitability|feasibility_score|Recommended chassis/i);
});
