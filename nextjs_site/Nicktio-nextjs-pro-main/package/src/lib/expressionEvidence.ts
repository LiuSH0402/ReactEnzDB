import { releasePath } from "@/lib/paths";
import fs from "node:fs";
import path from "node:path";
import { parseSearchQuery } from "@/lib/reactenzdb";
import { querySqliteParams, querySqliteStable } from "@/lib/sqlite";

export const EXPRESSION_EVIDENCE_DB = path.resolve(
  process.env.REACTENZDB_EXPRESSION_EVIDENCE_DB ?? releasePath("expression/expression_evidence.sqlite"),
);

export type ExpressionEvidenceOverview = {
  candidate_articles: number;
  fulltext_available: number;
  fulltext_unavailable: number;
  text_recovery_needed: number;
  articles_with_candidates: number;
  total_candidates: number;
  exact_enzyme_candidates: number;
  active_candidates: number;
  soluble_candidates: number;
  critical_flagged_candidates: number;
  e1_count: number;
  e2_count: number;
  e3_count: number;
  e4_count: number;
};

export type ExpressionArticleRow = {
  pmid: string;
  doi: string | null;
  pmcid: string | null;
  title: string | null;
  journal: string | null;
  publisher_group: string | null;
  fulltext_status: string;
  fulltext_available: number;
  fulltext_source_channel: string;
  extraction_status: string;
  legacy_annotation_count: number;
  reactenz_enzyme_count: number;
  reaction_count: number;
  legacy_host_count: number;
  expression_candidate_count: number;
  e1_count: number;
  e2_count: number;
  e3_count: number;
  e4_count: number;
  active_candidate_count: number;
  inactive_candidate_count: number;
  soluble_candidate_count: number;
  insoluble_candidate_count: number;
  max_candidate_confidence: number | null;
  qc_flag_count: number;
  critical_flagged_candidate_count: number;
  high_flagged_candidate_count: number;
  evidence_interpretation: string;
};

export type ExpressionCandidateRow = {
  candidate_id: string;
  document_id: string;
  pmid: string;
  doi: string | null;
  host_id: string | null;
  host_name: string;
  host_match_text: string | null;
  source_organism: string | null;
  expression_mode: string;
  enzyme_identity_status: string;
  evidence_type_candidate: string;
  confidence: number;
  expression_detected: string;
  solubility: string;
  activity: string;
  purification: string;
  localization: string | null;
  vector: string | null;
  promoter: string | null;
  tag: string | null;
  strain_or_cell_line: string | null;
  inducer: string | null;
  induction_condition: string | null;
  expression_temperature_c: number | null;
  expression_time_text: string | null;
  cofactor_supplementation: string | null;
  yield_text: string | null;
  conversion_text: string | null;
  negative_result_text: string | null;
  success_interpretation: string;
  curation_status: string;
  primary_span_id: string | null;
};

export type ExpressionCandidateLink = {
  candidate_id: string;
  biopart_id: string;
  reactenz_enzyme_id: string | null;
  protein_id: string | null;
  gene_name: string | null;
  enzyme_name: string | null;
  reaction_id: string | null;
  reactenz_reaction_id: string | null;
  link_method: string;
  match_score: number;
  is_primary: number;
};

export type ExpressionCandidateSpan = {
  span_id: string;
  candidate_id: string;
  section: string | null;
  page_or_table: string | null;
  paragraph_or_locator: string | null;
  evidence_text: string;
  evidence_text_sha256: string;
  extraction_method: string;
};

export type ExpressionQcFlag = {
  candidate_id: string;
  flag_code: string;
  severity: string;
  details_json: string;
};

export type ExpressionArticleBundle = {
  article: ExpressionArticleRow;
  candidates: ExpressionCandidateRow[];
  links: ExpressionCandidateLink[];
  spans: ExpressionCandidateSpan[];
  qcFlags: ExpressionQcFlag[];
};

export type ExpressionSourceOrganismLink = {
  source_organism: string;
  biopart_id: string;
};

export type ExpressionEvidenceRecord = {
  article: ExpressionArticleRow;
  candidate: ExpressionCandidateRow;
  links: ExpressionCandidateLink[];
  spans: ExpressionCandidateSpan[];
  qcFlags: ExpressionQcFlag[];
  sourceOrganisms: ExpressionSourceOrganismLink[];
};

export type ExpressionArticleSearch = {
  q?: string;
  fulltext?: string;
  tier?: string;
  host?: string;
  activity?: string;
  solubility?: string;
  review?: string;
  sort?: string;
  dir?: string;
  page?: number;
  pageSize?: number;
};

export type ExpressionArticleSearchResult = {
  rows: ExpressionArticleRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export function expressionEvidenceAvailable(): boolean {
  return fs.existsSync(EXPRESSION_EVIDENCE_DB);
}

export function getExpressionEvidenceOverview(): ExpressionEvidenceOverview | null {
  if (!expressionEvidenceAvailable()) return null;
  return querySqliteStable<ExpressionEvidenceOverview>(EXPRESSION_EVIDENCE_DB, `
    SELECT
      COUNT(*) candidate_articles,
      SUM(fulltext_available) fulltext_available,
      SUM(fulltext_available=0) fulltext_unavailable,
      SUM(fulltext_status='full_text_available_text_recovery_needed') text_recovery_needed,
      SUM(expression_candidate_count>0) articles_with_candidates,
      SUM(expression_candidate_count) total_candidates,
      SUM(exact_enzyme_candidate_count) exact_enzyme_candidates,
      SUM(active_candidate_count) active_candidates,
      SUM(soluble_candidate_count) soluble_candidates,
      SUM(critical_flagged_candidate_count) critical_flagged_candidates,
      SUM(e1_count) e1_count,SUM(e2_count) e2_count,SUM(e3_count) e3_count,SUM(e4_count) e4_count
    FROM article_master_correspondence
  `)[0] ?? null;
}

export function getExpressionHosts(limit = 80): Array<{ host_name: string; article_count: number; candidate_count: number }> {
  if (!expressionEvidenceAvailable()) return [];
  return querySqliteParams(EXPRESSION_EVIDENCE_DB, `
    SELECT host_name,COUNT(DISTINCT pmid) article_count,COUNT(*) candidate_count
    FROM expression_evidence_candidates
    GROUP BY host_name ORDER BY candidate_count DESC,host_name LIMIT ?
  `, [Math.max(1, Math.min(limit, 500))]);
}

function candidateExistsClause(filters: ExpressionArticleSearch, params: Array<string | number>): string {
  const clauses: string[] = [];
  if (filters.tier) {
    clauses.push("c.evidence_type_candidate LIKE ?");
    params.push(`${filters.tier.toUpperCase()}_%`);
  }
  if (filters.host) {
    clauses.push("LOWER(c.host_name)=LOWER(?)");
    params.push(filters.host);
  }
  if (filters.activity) {
    clauses.push("c.activity=?");
    params.push(filters.activity);
  }
  if (filters.solubility) {
    clauses.push("c.solubility=?");
    params.push(filters.solubility);
  }
  if (filters.review === "critical") clauses.push("EXISTS(SELECT 1 FROM expression_evidence_candidate_qc_flags f WHERE f.candidate_id=c.candidate_id AND f.severity='critical')");
  if (filters.review === "high") clauses.push("EXISTS(SELECT 1 FROM expression_evidence_candidate_qc_flags f WHERE f.candidate_id=c.candidate_id AND f.severity IN ('critical','high'))");
  return clauses.length
    ? `EXISTS(SELECT 1 FROM expression_evidence_candidates c WHERE c.pmid=a.pmid AND ${clauses.join(" AND ")})`
    : "";
}

export function searchExpressionArticles(filters: ExpressionArticleSearch = {}): ExpressionArticleSearchResult {
  if (!expressionEvidenceAvailable()) return { rows: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };
  const where: string[] = [];
  const params: Array<string | number> = [];
  const q = filters.q?.trim();
  if (q) {
    const parsed = parseSearchQuery(q);
    if (parsed.kind === "pmid") {
      where.push("CAST(a.pmid AS TEXT) = ?");
      params.push(parsed.value);
    } else if (parsed.kind === "enzyme_id") {
      where.push(`EXISTS(SELECT 1 FROM expression_evidence_candidate_enzyme_links l JOIN expression_evidence_candidates c USING(candidate_id) WHERE c.pmid=a.pmid AND l.reactenz_enzyme_id = ?)`);
      params.push(parsed.value);
    } else if (parsed.kind === "reaction_id") {
      where.push(`EXISTS(SELECT 1 FROM expression_evidence_candidate_enzyme_links l JOIN expression_evidence_candidates c USING(candidate_id) WHERE c.pmid=a.pmid AND l.reactenz_reaction_id = ?)`);
      params.push(parsed.value);
    } else if (parsed.kind === "uniprot" || parsed.kind === "ec" || parsed.kind === "chebi" || parsed.kind === "structure" || parsed.kind === "kegg" || parsed.kind === "rhea" || parsed.kind === "metacyc" || parsed.kind === "association_id") {
      where.push("1 = 0");
    } else {
      const like = `%${parsed.value}%`;
      where.push(`(
        CAST(a.pmid AS TEXT) = ? OR a.doi LIKE ? OR a.title LIKE ? OR a.journal LIKE ? OR
        EXISTS(SELECT 1 FROM expression_evidence_candidates c WHERE c.pmid=a.pmid AND (c.host_name LIKE ? OR c.source_organism LIKE ?)) OR
        EXISTS(SELECT 1 FROM expression_evidence_candidate_enzyme_links l JOIN expression_evidence_candidates c USING(candidate_id)
               WHERE c.pmid=a.pmid AND (l.reactenz_enzyme_id LIKE ? OR l.reactenz_reaction_id LIKE ? OR l.enzyme_name LIKE ?))
      )`);
      params.push(parsed.value, like, like, like, like, like, like, like, like);
    }
  }
  if (filters.fulltext === "available") where.push("a.fulltext_available=1");
  if (filters.fulltext === "unavailable") where.push("a.fulltext_available=0");
  if (filters.fulltext === "candidates") where.push("a.expression_candidate_count>0");
  if (filters.fulltext === "no_candidates") where.push("a.fulltext_status='full_text_parsed_no_expression_candidate'");
  if (filters.fulltext === "recovery") where.push("a.fulltext_status='full_text_available_text_recovery_needed'");
  const candidateClause = candidateExistsClause(filters, params);
  if (candidateClause) where.push(candidateClause);
  const sqlWhere = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = Number(querySqliteParams<{ count: number }>(EXPRESSION_EVIDENCE_DB, `SELECT COUNT(*) count FROM article_master_correspondence a ${sqlWhere}`, params)[0]?.count ?? 0);
  const pageSize = Math.max(1, Math.min(Number(filters.pageSize) || 20, 100));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.max(1, Math.min(Number(filters.page) || 1, totalPages));
  const sortMap: Record<string, string> = {
    pmid: "CAST(a.pmid AS INTEGER)", title: "a.title", journal: "a.journal",
    candidates: "a.expression_candidate_count", confidence: "a.max_candidate_confidence",
    enzymes: "a.reactenz_enzyme_count", reactions: "a.reaction_count", qc: "a.qc_flag_count",
  };
  const orderBy = sortMap[filters.sort ?? "candidates"] ?? sortMap.candidates;
  const dir = filters.dir === "asc" ? "ASC" : "DESC";
  const rows = querySqliteParams<ExpressionArticleRow>(EXPRESSION_EVIDENCE_DB, `
    SELECT a.pmid,a.doi,a.pmcid,a.title,a.journal,a.publisher_group,a.fulltext_status,a.fulltext_available,
           a.fulltext_source_channel,a.extraction_status,a.legacy_annotation_count,a.reactenz_enzyme_count,
           a.reaction_count,a.legacy_host_count,a.expression_candidate_count,a.e1_count,a.e2_count,a.e3_count,a.e4_count,
           a.active_candidate_count,a.inactive_candidate_count,a.soluble_candidate_count,a.insoluble_candidate_count,
           a.max_candidate_confidence,a.qc_flag_count,a.critical_flagged_candidate_count,a.high_flagged_candidate_count,
           a.evidence_interpretation
    FROM article_master_correspondence a ${sqlWhere}
    ORDER BY ${orderBy} ${dir},CAST(a.pmid AS INTEGER) DESC LIMIT ? OFFSET ?
  `, [...params, pageSize, (page - 1) * pageSize]);
  return { rows, total, page, pageSize, totalPages };
}

export function getExpressionArticle(pmid: string): ExpressionArticleBundle | null {
  if (!expressionEvidenceAvailable()) return null;
  const article = querySqliteParams<ExpressionArticleRow>(EXPRESSION_EVIDENCE_DB, `
    SELECT pmid,doi,pmcid,title,journal,publisher_group,fulltext_status,fulltext_available,fulltext_source_channel,
           extraction_status,legacy_annotation_count,reactenz_enzyme_count,reaction_count,legacy_host_count,
           expression_candidate_count,e1_count,e2_count,e3_count,e4_count,active_candidate_count,inactive_candidate_count,
           soluble_candidate_count,insoluble_candidate_count,max_candidate_confidence,qc_flag_count,
           critical_flagged_candidate_count,high_flagged_candidate_count,evidence_interpretation
    FROM article_master_correspondence WHERE pmid=?
  `, [pmid])[0];
  if (!article) return null;
  const candidates = querySqliteParams<ExpressionCandidateRow>(EXPRESSION_EVIDENCE_DB, "SELECT * FROM expression_evidence_candidates WHERE pmid=? ORDER BY confidence DESC,candidate_id", [pmid]);
  const ids = candidates.map((row) => row.candidate_id);
  if (!ids.length) return { article, candidates, links: [], spans: [], qcFlags: [] };
  const placeholders = ids.map(() => "?").join(",");
  return {
    article,
    candidates,
    links: querySqliteParams<ExpressionCandidateLink>(EXPRESSION_EVIDENCE_DB, `SELECT * FROM expression_evidence_candidate_enzyme_links WHERE candidate_id IN (${placeholders}) ORDER BY candidate_id,is_primary DESC,match_score DESC`, ids),
    spans: querySqliteParams<ExpressionCandidateSpan>(EXPRESSION_EVIDENCE_DB, `SELECT span_id,candidate_id,section,page_or_table,paragraph_or_locator,evidence_text,evidence_text_sha256,extraction_method FROM expression_evidence_candidate_spans WHERE candidate_id IN (${placeholders}) ORDER BY candidate_id,span_id`, ids),
    qcFlags: querySqliteParams<ExpressionQcFlag>(EXPRESSION_EVIDENCE_DB, `SELECT candidate_id,flag_code,severity,details_json FROM expression_evidence_candidate_qc_flags WHERE candidate_id IN (${placeholders}) ORDER BY candidate_id,CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,flag_code`, ids),
  };
}

export function getExpressionEvidenceRecord(candidateId: string): ExpressionEvidenceRecord | null {
  if (!expressionEvidenceAvailable()) return null;
  const candidate = querySqliteParams<ExpressionCandidateRow>(
    EXPRESSION_EVIDENCE_DB,
    "SELECT * FROM expression_evidence_candidates WHERE candidate_id=? LIMIT 1",
    [candidateId],
  )[0];
  if (!candidate) return null;
  const bundle = getExpressionArticle(candidate.pmid);
  if (!bundle) return null;
  return {
    article: bundle.article,
    candidate,
    links: bundle.links.filter((link) => link.candidate_id === candidateId),
    spans: bundle.spans.filter((span) => span.candidate_id === candidateId),
    qcFlags: bundle.qcFlags.filter((flag) => flag.candidate_id === candidateId),
    sourceOrganisms: querySqliteParams<ExpressionSourceOrganismLink>(EXPRESSION_EVIDENCE_DB, `
      SELECT DISTINCT l.source_organism,el.biopart_id
      FROM expression_evidence_candidate_enzyme_links el
      JOIN legacy_host_annotations l ON l.biopart_id=el.biopart_id
      WHERE el.candidate_id=? AND l.source_organism IS NOT NULL AND TRIM(l.source_organism)<>''
      ORDER BY l.source_organism,el.biopart_id
    `, [candidateId]),
  };
}

type ContextCandidate = { pmid: string; candidate_id: string };

function getContextBundles(rows: ContextCandidate[]): ExpressionArticleBundle[] {
  const candidateIdsByPmid = new Map<string, Set<string>>();
  for (const row of rows) {
    const ids = candidateIdsByPmid.get(row.pmid) ?? new Set<string>();
    ids.add(row.candidate_id);
    candidateIdsByPmid.set(row.pmid, ids);
  }

  return [...candidateIdsByPmid.entries()].flatMap(([pmid, candidateIds]) => {
    const bundle = getExpressionArticle(pmid);
    if (!bundle) return [];
    return [{
      ...bundle,
      candidates: bundle.candidates.filter((candidate) => candidateIds.has(candidate.candidate_id)),
      links: bundle.links.filter((link) => candidateIds.has(link.candidate_id)),
      spans: bundle.spans.filter((span) => candidateIds.has(span.candidate_id)),
      qcFlags: bundle.qcFlags.filter((flag) => candidateIds.has(flag.candidate_id)),
    }];
  });
}

export function getExpressionEvidenceForEnzyme(biopartId: string, reactenzEnzymeId: string, limit = 12): ExpressionArticleBundle[] {
  if (!expressionEvidenceAvailable()) return [];
  const rows = querySqliteParams<ContextCandidate>(EXPRESSION_EVIDENCE_DB, `
    SELECT DISTINCT c.pmid,c.candidate_id FROM expression_evidence_candidate_enzyme_links l
    JOIN expression_evidence_candidates c USING(candidate_id)
    WHERE l.biopart_id=? OR l.reactenz_enzyme_id=?
    ORDER BY c.confidence DESC LIMIT ?
  `, [biopartId, reactenzEnzymeId, limit]);
  return getContextBundles(rows);
}

export function getExpressionEvidenceForReaction(reactionId: string, reactenzReactionId: string, limit = 12): ExpressionArticleBundle[] {
  if (!expressionEvidenceAvailable()) return [];
  const rows = querySqliteParams<ContextCandidate>(EXPRESSION_EVIDENCE_DB, `
    SELECT DISTINCT c.pmid,c.candidate_id FROM expression_evidence_candidate_enzyme_links l
    JOIN expression_evidence_candidates c USING(candidate_id)
    WHERE l.reaction_id=? OR l.reactenz_reaction_id=?
    ORDER BY c.confidence DESC LIMIT ?
  `, [reactionId, reactenzReactionId, limit]);
  return getContextBundles(rows);
}

export function getExpressionEvidenceForHost(hostName: string, limit = 12): ExpressionArticleBundle[] {
  if (!expressionEvidenceAvailable()) return [];
  const rows = querySqliteParams<ContextCandidate>(EXPRESSION_EVIDENCE_DB, `
    SELECT DISTINCT c.pmid,c.candidate_id
    FROM expression_evidence_candidates c
    JOIN host_aliases a ON a.host_id=c.host_id
    JOIN legacy_host_annotations l ON LOWER(l.raw_host_label)=LOWER(a.raw_label)
    JOIN legacy_annotation_citations lc
      ON lc.legacy_annotation_id=l.legacy_annotation_id AND lc.pmid=c.pmid
    WHERE (LOWER(a.raw_label)=LOWER(?) OR LOWER(a.clean_label)=LOWER(?))
      AND LOWER(l.raw_host_label)=LOWER(?)
    ORDER BY c.confidence DESC LIMIT ?
  `, [hostName, hostName, hostName, limit]);
  return getContextBundles(rows);
}

export function getExpressionEvidenceForOrganism(organismName: string, limit = 12): ExpressionArticleBundle[] {
  if (!expressionEvidenceAvailable()) return [];
  const rows = querySqliteParams<ContextCandidate>(EXPRESSION_EVIDENCE_DB, `
    SELECT DISTINCT c.pmid,c.candidate_id
    FROM expression_evidence_candidates c
    JOIN expression_evidence_candidate_enzyme_links el USING(candidate_id)
    JOIN legacy_host_annotations l ON l.biopart_id=el.biopart_id
    WHERE LOWER(l.source_organism)=LOWER(?)
    ORDER BY c.confidence DESC LIMIT ?
  `, [organismName, limit]);
  return getContextBundles(rows);
}
