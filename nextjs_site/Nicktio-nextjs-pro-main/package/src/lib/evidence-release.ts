import { releasePath } from "@/lib/paths";
import fs from "node:fs";
import { getPairLiterature, getTargetLiterature, type PairLiteratureRecord } from "@/lib/pairLiterature";
import path from "node:path";
import { querySqlite, querySqliteParams } from "@/lib/sqlite";

export const EVIDENCE_RELEASE_DIR = path.resolve(
  process.env.REACTENZDB_EVIDENCE_RELEASE_DIR ?? releasePath("evidence"),
);
export const EVIDENCE_DB_PATH = path.resolve(
  process.env.REACTENZDB_EVIDENCE_DB ?? path.join(EVIDENCE_RELEASE_DIR, "reactenzdb_evidence_rc.sqlite"),
);
const EVIDENCE_SUMMARY_PATH = path.join(EVIDENCE_RELEASE_DIR, "reactenzdb_evidence_rc.summary.json");

export type EvidenceTarget = "reaction" | "enzyme";

export type EvidenceReleaseStats = {
  assertions: number;
  canonical_assertions?: number;
  measurements: number;
  measurements_release_normalized: number;
  citations: number;
  reaction_enzyme_pairs: number;
  reactions_with_evidence: number;
  enzymes_with_evidence: number;
  automatic_exact_assertions: number;
  literature_discrepancies: number;
  duplicate_groups_with_multiple_assertions: number;
  brenda_context_records?: number;
  qa_passed: number;
  qa_total: number;
};

export type EvidenceReleaseStatus = {
  available: boolean;
  database_filename: string;
  database_size_bytes: number;
  metadata: Record<string, string>;
  stats: EvidenceReleaseStats | null;
  evidence_classes: Array<{
    evidence_class: string;
    rank_order: number;
    definition: string;
    minimum_requirements_json: string;
    interpretation_boundary: string;
  }>;
  outcomes: Array<{ outcome_class: string; definition: string }>;
};

export type ReactionEvidenceSummary = {
  reaction_id: string;
  reactenz_reaction_id: string;
  enzyme_count: number;
  assertion_count: number;
  exact_enzyme_count: number;
  catalytic_assertion_count: number;
  inactive_or_negative_count: number;
  citation_count: number;
  best_evidence_rank: number | null;
  best_evidence_class: string | null;
};

export type EnzymeEvidenceSummary = {
  biopart_id: string;
  reactenz_enzyme_id: string;
  reaction_count: number;
  assertion_count: number;
  exact_reaction_count: number;
  catalytic_assertion_count: number;
  inactive_or_negative_count: number;
  citation_count: number;
  best_evidence_rank: number | null;
  best_evidence_class: string | null;
};

export type ReactionEnzymeEvidenceSummary = {
  reaction_id: string;
  reactenz_reaction_id: string;
  biopart_id: string;
  reactenz_enzyme_id: string;
  best_evidence_class: string;
  best_evidence_rank: number;
  assertion_count: number;
  exact_assertion_count: number;
  catalytic_assertion_count: number;
  non_catalytic_assertion_count: number;
  inactive_or_negative_count: number;
  measurement_count: number;
  citation_count: number;
  condition_count: number;
  literature_verified_count: number;
  literature_discrepancy_count: number;
  source_count: number;
  source_labels: string;
};

export type EvidenceAssertion = {
  assertion_id: string;
  source_db: string;
  source_record_id: string;
  source_ec_number: string | null;
  reaction_id: string | null;
  reactenz_reaction_id: string | null;
  primary_biopart_id: string | null;
  primary_reactenz_enzyme_id: string | null;
  enzyme_form_id: string | null;
  wild_type_status: string | null;
  mutation_text: string | null;
  form_accession: string | null;
  evidence_class: string;
  evidence_rank: number;
  display_evidence_label: string;
  outcome_class: string;
  is_experimental: number;
  enzyme_identity_status: string;
  reaction_identity_status: string;
  substrate_identity_status: string;
  product_identity_status: string;
  mapping_score: number | null;
  curation_status: string;
  pmid_count: number;
  has_quantitative_measurement: number;
  has_assay_conditions: number;
  source_url: string | null;
  rule_id: string | null;
  duplicate_group_id: string | null;
  is_canonical: number;
  duplicate_group_member_count: number;
  created_at: string;
};

export type EvidenceMeasurement = {
  measurement_id: string;
  assertion_id: string;
  parameter_type_raw: string;
  parameter_type_canonical: string;
  raw_value_text: string | null;
  raw_value_numeric: number | null;
  raw_unit: string | null;
  source_normalized_value: number | null;
  source_normalized_unit: string | null;
  source_normalization_status: string;
  release_normalized_value: number | null;
  release_normalized_unit: string | null;
  release_normalization_status: string;
  subject_name: string | null;
};

export type EvidenceCitation = {
  assertion_id: string;
  pmid: string | null;
  doi: string | null;
  title: string | null;
  journal: string | null;
  year: number | null;
  source_url: string | null;
  full_text_status: string;
  verification_status: string;
};

export type EvidenceAssayCondition = {
  condition_id: string;
  assertion_id: string;
  ph: number | null;
  temperature_c: number | null;
  buffer_text: string | null;
  cofactor_text: string | null;
  condition_text: string | null;
  extraction_method: string;
};

export type BrendaContextRecord = {
  context_id: string;
  operation: string;
  context_type: string;
  ec_number: string;
  organism: string | null;
  value_text: string | null;
  value_max_text: string | null;
  commentary_available: number;
  literature_ids_json: string;
  ligand_structure_id: string | null;
  linkage_boundary: string;
};

export type EvidenceQueryOptions = {
  evidenceClass?: string;
  outcome?: string;
  curationStatus?: string;
  parameter?: string;
  limit?: number;
  offset?: number;
  pairLimit?: number;
};

export type EvidenceBundle = {
  release: EvidenceReleaseStatus;
  target: EvidenceTarget;
  requested_id: string;
  assertion_scope: "target_association" | "same_ec_background";
  literature_records: PairLiteratureRecord[];
  summary: ReactionEvidenceSummary | EnzymeEvidenceSummary | null;
  reaction_enzyme_summaries: ReactionEnzymeEvidenceSummary[];
  assertions: EvidenceAssertion[];
  measurements: EvidenceMeasurement[];
  citations: EvidenceCitation[];
  assay_conditions: EvidenceAssayCondition[];
  brenda_context_records: BrendaContextRecord[];
  pagination: { total: number; limit: number; offset: number };
};

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

export function getEvidenceReleaseStatus(): EvidenceReleaseStatus {
  if (!fs.existsSync(EVIDENCE_DB_PATH)) {
    return {
      available: false,
      database_filename: path.basename(EVIDENCE_DB_PATH),
      database_size_bytes: 0,
      metadata: {},
      stats: null,
      evidence_classes: [],
      outcomes: [],
    };
  }
  const metadataRows = querySqlite<{ key: string; value: string }>(EVIDENCE_DB_PATH, "SELECT key,value FROM metadata ORDER BY key");
  return {
    available: true,
    database_filename: path.basename(EVIDENCE_DB_PATH),
    database_size_bytes: fs.statSync(EVIDENCE_DB_PATH).size,
    metadata: Object.fromEntries(metadataRows.map((row) => [row.key, row.value])),
    stats: readJson<EvidenceReleaseStats>(EVIDENCE_SUMMARY_PATH),
    evidence_classes: querySqlite(EVIDENCE_DB_PATH, "SELECT * FROM evidence_class_definitions ORDER BY rank_order"),
    outcomes: querySqlite(EVIDENCE_DB_PATH, "SELECT * FROM outcome_definitions ORDER BY outcome_class"),
  };
}

function clamp(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value as number)));
}

function relatedRows(assertionIds: string[]) {
  if (!assertionIds.length) return { measurements: [], citations: [], assay_conditions: [] };
  const placeholders = assertionIds.map(() => "?").join(",");
  return {
    measurements: querySqliteParams<EvidenceMeasurement>(EVIDENCE_DB_PATH, `
      SELECT * FROM measurements WHERE assertion_id IN (${placeholders})
      ORDER BY assertion_id, parameter_type_canonical, measurement_id`, assertionIds),
    citations: querySqliteParams<EvidenceCitation>(EVIDENCE_DB_PATH, `
      SELECT * FROM citations WHERE assertion_id IN (${placeholders})
      ORDER BY assertion_id, year DESC, pmid`, assertionIds),
    // assay_conditions has no assertion_id index; every condition_id is
    // "<assertion_id>:...", so a prefix range uses the primary-key index.
    assay_conditions: querySqliteParams<EvidenceAssayCondition>(EVIDENCE_DB_PATH, `
      SELECT * FROM assay_conditions
      WHERE ${assertionIds.map(() => "(condition_id >= ? AND condition_id < ? AND assertion_id = ?)").join(" OR ")}
      ORDER BY assertion_id, condition_id`, assertionIds.flatMap((id) => [`${id}:`, `${id};`, id])),
  };
}

export function getEvidenceBundle(
  target: EvidenceTarget,
  requestedId: string,
  options: EvidenceQueryOptions = {},
): EvidenceBundle {
  const release = getEvidenceReleaseStatus();
  const literatureRecords = getTargetLiterature(target, requestedId);
  const limit = clamp(options.limit, 40, 1, 250);
  const offset = clamp(options.offset, 0, 0, 10_000_000);
  const pairLimit = clamp(options.pairLimit, 80, 1, 250);
  const backgroundOnly = options.evidenceClass === "same_ec_different_substrate";
  const assertionScope = backgroundOnly ? "same_ec_background" : "target_association";
  if (!release.available) {
    return {
      release,
      target,
      requested_id: requestedId,
      assertion_scope: assertionScope,
      literature_records: literatureRecords,
      summary: null,
      reaction_enzyme_summaries: [],
      assertions: [],
      measurements: [],
      citations: [],
      assay_conditions: [],
      brenda_context_records: [],
      pagination: { total: 0, limit, offset },
    };
  }

  const isReaction = target === "reaction";
  const summaryTable = isReaction ? "reaction_summary" : "enzyme_summary";
  const internalColumn = isReaction ? "reaction_id" : "biopart_id";
  const publicColumn = isReaction ? "reactenz_reaction_id" : "reactenz_enzyme_id";
  const assertionColumn = isReaction ? "reaction_id" : "primary_biopart_id";
  let summary = querySqliteParams<ReactionEvidenceSummary | EnzymeEvidenceSummary>(EVIDENCE_DB_PATH, `
    SELECT * FROM ${summaryTable} WHERE ${publicColumn} = ? OR ${internalColumn} = ? LIMIT 1`, [requestedId, requestedId])[0] ?? null;

  const internalId = summary ? String((summary as unknown as Record<string, unknown>)[internalColumn]) : null;
  if (!internalId) {
    return {
      release,
      target,
      requested_id: requestedId,
      assertion_scope: assertionScope,
      literature_records: literatureRecords,
      summary: null,
      reaction_enzyme_summaries: [],
      assertions: [],
      measurements: [],
      citations: [],
      assay_conditions: [],
      brenda_context_records: [],
      pagination: { total: 0, limit, offset },
    };
  }

  const canonicalFilter = release.metadata.release_version === "EVIDENCE_RC_V2" ? "a.is_canonical = 1" : "1 = 1";
  // Reaction summaries sum per-enzyme links, so shared assertions can appear
  // more than once. Count distinct source assertions from the list's own scope.
  // Enzyme detail must include secondary linked proteins, not just the primary.
  const targetIdentity = isReaction ? "a.reaction_id = ?" : `
    a.reaction_id IN (SELECT reaction_id FROM reaction_enzyme_summary WHERE biopart_id = ?)
    AND EXISTS (SELECT 1 FROM assertion_enzyme_links l
                WHERE l.assertion_id = a.assertion_id AND l.biopart_id = ?)`;
  const targetParams: Array<string | number> = isReaction ? [internalId] : [internalId, internalId];
  const targetWhere = `${canonicalFilter} AND ${targetIdentity} AND a.evidence_class <> 'same_ec_different_substrate'`;
  const counts = querySqliteParams<{
    assertion_count: number; catalytic_assertion_count: number;
    inactive_or_negative_count: number; citation_count: number;
  }>(EVIDENCE_DB_PATH, `
    WITH scoped AS (SELECT a.assertion_id, a.outcome_class FROM assertions a WHERE ${targetWhere})
    SELECT COUNT(*) AS assertion_count,
      COALESCE(SUM(outcome_class = 'quantitative_activity'), 0) AS catalytic_assertion_count,
      COALESCE(SUM(outcome_class IN ('inactive', 'negative_or_below_detection')), 0) AS inactive_or_negative_count,
      (SELECT COUNT(DISTINCT COALESCE(c.pmid,c.doi)) FROM citations c
       WHERE c.assertion_id IN (SELECT assertion_id FROM scoped)) AS citation_count
    FROM scoped`, targetParams)[0];
  if (counts) summary = { ...summary!, ...counts };
  // Same-EC/different-substrate assertions remain accessible only through an
  // explicit background-class filter; they are never counted as target support.
  const filters = backgroundOnly
    ? [canonicalFilter, `a.${assertionColumn} = ?`]
    : [targetWhere];
  const filterParams: Array<string | number> = backgroundOnly ? [internalId] : [...targetParams];
  if (options.evidenceClass) {
    filters.push("a.evidence_class = ?");
    filterParams.push(options.evidenceClass);
  }
  if (options.outcome) {
    filters.push("a.outcome_class = ?");
    filterParams.push(options.outcome);
  }
  if (options.curationStatus) {
    filters.push("a.curation_status = ?");
    filterParams.push(options.curationStatus);
  }
  if (options.parameter) {
    filters.push("EXISTS (SELECT 1 FROM measurements m WHERE m.assertion_id = a.assertion_id AND m.parameter_type_canonical = ?)");
    filterParams.push(options.parameter);
  }
  const where = filters.join(" AND ");
  const hasAssertionFilters = Boolean(options.evidenceClass || options.outcome || options.curationStatus || options.parameter);
  // The unfiltered count above and every filtered count use the same WHERE
  // predicate as the paginated list; never reuse pair-summed release totals.
  const total = hasAssertionFilters
    ? querySqliteParams<{ count: number }>(EVIDENCE_DB_PATH, `SELECT COUNT(*) AS count FROM assertions a WHERE ${where}`, filterParams)[0]?.count ?? 0
    : Number(counts?.assertion_count ?? 0);
  const assertions = querySqliteParams<EvidenceAssertion>(EVIDENCE_DB_PATH, `
    SELECT a.* FROM assertions a WHERE ${where}
    ORDER BY a.evidence_rank, a.has_quantitative_measurement DESC, a.pmid_count DESC,
             COALESCE(a.mapping_score, -1) DESC, a.assertion_id
    LIMIT ? OFFSET ?`, [...filterParams, limit, offset]);

  const pairWhere = isReaction ? "reaction_id = ?" : "biopart_id = ?";
  const pairOrder = isReaction
    ? "best_evidence_rank, exact_assertion_count DESC, literature_verified_count DESC, citation_count DESC, measurement_count DESC"
    : "best_evidence_rank, exact_assertion_count DESC, literature_verified_count DESC, citation_count DESC, measurement_count DESC";
  const reactionEnzymeSummaries = querySqliteParams<ReactionEnzymeEvidenceSummary>(EVIDENCE_DB_PATH, `
    SELECT * FROM reaction_enzyme_summary WHERE ${pairWhere}
    ORDER BY ${pairOrder}, reactenz_reaction_id, reactenz_enzyme_id LIMIT ?`, [internalId, pairLimit]);
  const related = relatedRows(assertions.map((row) => row.assertion_id));
  let brendaContextRecords: BrendaContextRecord[] = [];
  if (release.metadata.release_version === "EVIDENCE_RC_V2") {
    const ecRows = querySqliteParams<{ source_ec_number: string }>(EVIDENCE_DB_PATH, `
      SELECT DISTINCT a.source_ec_number FROM assertions a
      WHERE ${where} AND a.source_ec_number IS NOT NULL AND trim(a.source_ec_number)<>''
      LIMIT 40`, filterParams);
    const ecNumbers = ecRows.map((row) => row.source_ec_number);
    if (ecNumbers.length) {
      const placeholders = ecNumbers.map(() => "?").join(",");
      brendaContextRecords = querySqliteParams<BrendaContextRecord>(EVIDENCE_DB_PATH, `
        SELECT * FROM brenda_context_records WHERE ec_number IN (${placeholders})
        ORDER BY context_type,organism,context_id LIMIT 100`, ecNumbers);
    }
  }

  return {
    release,
    target,
    requested_id: requestedId,
    assertion_scope: assertionScope,
    literature_records: literatureRecords,
    summary,
    reaction_enzyme_summaries: reactionEnzymeSummaries,
    assertions,
    ...related,
    brenda_context_records: brendaContextRecords,
    pagination: { total, limit, offset },
  };
}

export function getReactionEvidenceBundle(reactionId: string, options: EvidenceQueryOptions = {}) {
  return getEvidenceBundle("reaction", reactionId, options);
}

export function getEnzymeEvidenceBundle(enzymeId: string, options: EvidenceQueryOptions = {}) {
  return getEvidenceBundle("enzyme", enzymeId, options);
}

// Narrow both IDs. Protein-level bibliography must not become reaction-specific proof.
export function getReactionCandidateEvidence(reactionId: string, enzymeIds: string[]) {
  const available = fs.existsSync(EVIDENCE_DB_PATH);
  if (!available || !enzymeIds.length) return { available, summaries: [] as ReactionEnzymeEvidenceSummary[] };
  const summaries = querySqliteParams<ReactionEnzymeEvidenceSummary>(EVIDENCE_DB_PATH, `
    SELECT * FROM reaction_enzyme_summary
    WHERE reaction_id = ? AND biopart_id IN (${enzymeIds.map(() => "?").join(",")})`, [reactionId, ...enzymeIds]);
  return { available, summaries };
}

export type ReactionEnzymeEvidenceDetail = ReturnType<typeof getReactionEnzymeEvidenceDetail>;

export function getReactionEnzymeEvidenceDetail(reactionId: string, enzymeId: string, offset = 0) {
  const available = fs.existsSync(EVIDENCE_DB_PATH);
  const limit = 10;
  const empty = { available, literature_records: getPairLiterature(reactionId, enzymeId),
    summary: null as ReactionEnzymeEvidenceSummary | null,
    assertions: [] as EvidenceAssertion[], measurements: [] as EvidenceMeasurement[],
    citations: [] as EvidenceCitation[], assay_conditions: [] as EvidenceAssayCondition[],
    pagination: { total: 0, limit, offset } };
  if (!available) return empty;
  const summary = getReactionCandidateEvidence(reactionId, [enzymeId]).summaries[0];
  if (!summary) return empty;
  const release = getEvidenceReleaseStatus();
  const canonical = release.metadata.release_version === "EVIDENCE_RC_V2" ? "a.is_canonical = 1" : "1=1";
  const where = `a.reaction_id = ? AND ${canonical} AND
    EXISTS (SELECT 1 FROM assertion_enzyme_links l WHERE l.assertion_id = a.assertion_id AND l.biopart_id = ?)`;
  const params = [reactionId, enzymeId];
  const total = querySqliteParams<{ total: number }>(EVIDENCE_DB_PATH, `SELECT COUNT(*) AS total FROM assertions a WHERE ${where}`, params)[0]?.total ?? 0;
  const assertions = querySqliteParams<EvidenceAssertion>(EVIDENCE_DB_PATH, `
    SELECT a.* FROM assertions a WHERE ${where}
    ORDER BY a.evidence_rank, a.assertion_id LIMIT ? OFFSET ?`, [...params, limit, offset]);
  return { available, literature_records: empty.literature_records, summary, assertions, ...relatedRows(assertions.map((row) => row.assertion_id)), pagination: { total, limit, offset } };
}
