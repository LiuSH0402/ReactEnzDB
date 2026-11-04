import { releasePath } from "@/lib/paths";
import fs from "node:fs";
import path from "node:path";
import { querySqliteParams } from "@/lib/sqlite";
import type { CandidateSelectionRow } from "@/lib/candidateSelection";
import { diversityCounts, selectEvidenceRepresentatives, type CandidateEvidenceFlags, type EvidenceLevel } from "@/lib/candidateEvidenceLogic";

const candidateDb = releasePath("advanced_candidate_selection.sqlite");
const coreDb = releasePath("reactenzdb_web.db");

type CoreFlagRow = { biopart_id: string; pfam: number; interpro: number; site: number; literature: number; source_db: string | null; evidence_level: string | null };
type CountRow = { count: number };

export function getCandidateEvidenceBoard(reactionId: string, level: EvidenceLevel, page = 1, pageSize = 30) {
  if (!fs.existsSync(candidateDb) || !fs.existsSync(coreDb)) return null;
  const rows = querySqliteParams<CandidateSelectionRow>(candidateDb,
    "SELECT * FROM reaction_candidate_selection WHERE reaction_id=? ORDER BY biopart_id", [reactionId]);
  const flags = querySqliteParams<CoreFlagRow>(coreDb, `
    SELECT re.biopart_id, re.source_db, re.evidence_level,
      EXISTS(SELECT 1 FROM web_protein_domains d WHERE d.biopart_id=re.biopart_id AND d.annotation_db='Pfam') AS pfam,
      EXISTS(SELECT 1 FROM web_protein_domains d WHERE d.biopart_id=re.biopart_id AND d.annotation_db='InterPro') AS interpro,
      EXISTS(SELECT 1 FROM web_protein_features f WHERE f.biopart_id=re.biopart_id AND f.feature_type='active_site') AS site,
      EXISTS(SELECT 1 FROM web_entity_references r WHERE r.entity_type='enzyme' AND r.entity_id=re.biopart_id) AS literature
    FROM web_reaction_enzymes re WHERE re.reaction_id=?`, [reactionId]);
  const flagMap = new Map<string, CandidateEvidenceFlags & { source_db: string | null; evidence_level: string | null }>(flags.map((row) => [row.biopart_id,
    { pfam: Boolean(row.pfam), interpro: Boolean(row.interpro), site: Boolean(row.site), literature: Boolean(row.literature), source_db: row.source_db, evidence_level: row.evidence_level }]));
  const total = querySqliteParams<CountRow>(coreDb,
    "SELECT COUNT(DISTINCT biopart_id) AS count FROM web_reaction_enzymes WHERE reaction_id=?", [reactionId])[0]?.count ?? 0;
  const selected = selectEvidenceRepresentatives(rows, level, flagMap, rows.length);
  const pageCount = Math.max(1, Math.ceil(selected.length / pageSize));
  const safePage = Math.min(Math.max(Math.floor(page) || 1, 1), pageCount);
  return { total_associated_enzymes: total, diversity: diversityCounts(rows), total_view_candidates: selected.length,
    page: safePage, page_count: pageCount, representatives: selected.slice((safePage - 1) * pageSize, safePage * pageSize), flags: flagMap };
}
