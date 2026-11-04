import fs from "node:fs";
import path from "node:path";
import { querySqlite, querySqliteParams } from "@/lib/sqlite";

function resolveHostContextDb(): string {
  if (process.env.HOST_CONTEXT_STAGING_DB_PATH) {
    return path.resolve(process.env.HOST_CONTEXT_STAGING_DB_PATH);
  }
  const freeze = path.resolve(process.cwd(), "../../../staging/releases/2026.09.1/host_context_v1.sqlite");
  if (fs.existsSync(freeze)) return freeze;
  return path.resolve(
    process.cwd(),
    "../../../staging/host-context/2026.09.1/host_context_v1_staging.sqlite",
  );
}

const DB_PATH = resolveHostContextDb();

type RegistryMetadataRow = { key: string; value: string };

export type HostRegistryPreviewRow = {
  host_id: string;
  scientific_name: string;
  strain: string;
  identity_scope: string;
  identity_status: string;
  model_name: string;
  model_scope: string;
  release_id: string;
  version_ref: string;
  artifact_sha256: string;
  source_url: string;
  acquisition_status: string;
  qc_verdict: string | null;
  parse_status: string | null;
  objective_status: string | null;
  medium_status: string | null;
  reactions: number | null;
  metabolites: number | null;
  genes: number | null;
  compartments: number | null;
  memote_score: number | null;
  license_review_status: string | null;
  commercial_use_status: string | null;
  quality_warnings: string | null;
  fatal_gates: string | null;
};

function hostContextOptOut(): boolean {
  return process.env.HOST_CONTEXT_ENABLED === "0";
}

function stagingRegistryAvailable(): boolean {
  if (hostContextOptOut()) return false;
  if (!fs.existsSync(DB_PATH)) return false;
  try {
    const metadata = querySqlite<RegistryMetadataRow>(
      DB_PATH,
      "SELECT key, value FROM registry_metadata WHERE key IN ('database_role', 'publication_status', 'schema_version', 'release_version')",
    );
    const values = Object.fromEntries(metadata.map(({ key, value }) => [key, value]));
    const schemaOk = String(values.schema_version || "").startsWith("reactenzdb-host-context-v1");
    const released = values.publication_status === "RELEASED_IN_2026.09.1"
      && (values.database_role === "RELEASE_HOST_CONTEXT_2026_09_1" || values.release_version === "2026.09.1");
    const legacyPreview = values.database_role === "STAGING_ONLY_NOT_PRODUCTION"
      && values.publication_status === "NOT_PUBLISHED_AWAITING_HUMAN_SIGN_OFF"
      && (process.env.HOST_CONTEXT_PREVIEW_ENABLED === "1" || process.env.NODE_ENV !== "production");
    return schemaOk && (released || legacyPreview);
  } catch {
    return false;
  }
}

export function hostContextLayerAvailable(): boolean {
  return stagingRegistryAvailable();
}

export function getHostRegistryPreview(): HostRegistryPreviewRow[] | null {
  if (!stagingRegistryAvailable()) return null;
  return querySqlite<HostRegistryPreviewRow>(DB_PATH, `
    SELECT h.host_id, h.scientific_name, h.strain, h.identity_scope,
           h.identity_status, m.model_name, m.model_scope, r.release_id,
           r.version_ref, r.artifact_sha256, r.source_url,
           r.acquisition_status,
           MAX(CASE WHEN q.metric_name = 'comparison_qc_verdict' THEN q.metric_value_text END) AS qc_verdict,
           MAX(CASE WHEN q.metric_name = 'parse_status' THEN q.metric_value_text END) AS parse_status,
           MAX(CASE WHEN q.metric_name = 'objective_status' THEN q.metric_value_text END) AS objective_status,
           MAX(CASE WHEN q.metric_name = 'declared_medium_status' THEN q.metric_value_text END) AS medium_status,
           MAX(CASE WHEN q.metric_name = 'reactions' THEN q.metric_value_num END) AS reactions,
           MAX(CASE WHEN q.metric_name = 'metabolites' THEN q.metric_value_num END) AS metabolites,
           MAX(CASE WHEN q.metric_name = 'genes' THEN q.metric_value_num END) AS genes,
           MAX(CASE WHEN q.metric_name = 'compartments' THEN q.metric_value_num END) AS compartments,
           MAX(CASE WHEN q.metric_name = 'memote_total_score' THEN q.metric_value_num END) AS memote_score,
           MAX(CASE WHEN q.metric_name = 'comparison_quality_warnings' THEN q.metric_value_text END) AS quality_warnings,
           MAX(CASE WHEN q.metric_name = 'comparison_fatal_gates' THEN q.metric_value_text END) AS fatal_gates,
           l.review_status AS license_review_status,
           l.commercial_use_status
    FROM curated_hosts h
    JOIN host_models m ON m.host_id = h.host_id AND m.preferred_release_id IS NOT NULL
    JOIN host_model_releases r ON r.release_id = m.preferred_release_id
    LEFT JOIN host_model_qc q ON q.release_id = r.release_id
    LEFT JOIN host_licenses l ON l.release_id = r.release_id
    GROUP BY h.host_id, m.model_id, r.release_id, l.license_id
    ORDER BY h.ordinal
  `);
}

export function getHostRegistryPreviewById(hostId: string): HostRegistryPreviewRow | null {
  if (!/^[a-z0-9_]+$/.test(hostId)) return null;
  return getHostRegistryPreview()?.find((row) => row.host_id === hostId) ?? null;
}

export type HostPaperLink = {
  key: string;
  title: string;
  role: string;
  dois: string[];
  pmids: string[];
  hrefs: Array<{ label: string; href: string }>;
};

type HostReferenceRow = {
  doi: string | null;
  pmid: string | null;
  citation: string | null;
  url: string | null;
  link_role: string;
};

const PAPER_ROLE_LABELS: Record<string, string> = {
  MODEL_PRIMARY_PUBLICATION: "Model publication",
  MEDIUM_EVIDENCE: "Source evidence",
  MODEL_VALIDATION_PAPER: "Validation paper",
  PRIMARY_PAPER_SUPPLEMENT: "Paper supplement",
  STRAIN_RELATION_PAPER: "Strain relationship",
  HOST_IDENTITY_EVIDENCE: "Identity evidence",
  MULTI_ROLE: "Recorded source",
};

function tokensFrom(...values: Array<string | null | undefined>): string[] {
  return values
    .flatMap((value) => (value ?? "").split(/[;,]/))
    .map((item) => item.trim())
    .filter(Boolean);
}

function collectPaperIds(doi: string | null, pmid: string | null, url: string | null): { dois: string[]; pmids: string[] } {
  const dois = new Set<string>();
  const pmids = new Set<string>();
  for (const token of tokensFrom(doi, pmid, url)) {
    const value = token.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").trim();
    const pmidValue = token.replace(/^https?:\/\/(www\.)?pubmed\.ncbi\.nlm\.nih\.gov\//i, "").replace(/^pmid:\s*/i, "").replace(/\/$/, "").trim();
    if (/^10\.\d{4,}\/\S+$/i.test(value)) dois.add(value.toLowerCase().replace(/\/+$/, ""));
    else if (/^\d{5,9}$/.test(pmidValue)) pmids.add(pmidValue);
  }
  return { dois: [...dois], pmids: [...pmids] };
}

function paperTitle(citation: string | null, dois: string[], pmids: string[]): string | null {
  const text = (citation ?? "").trim();
  if (/\bet al\b/i.test(text) || /\b(19|20)\d{2}\b/.test(text)) return text;
  if (pmids[0]) return `PubMed ${pmids[0]}`;
  if (dois[0]) return `DOI ${dois[0]}`;
  return text || null;
}

export function getHostPapers(hostId: string): HostPaperLink[] {
  if (!/^[a-z0-9_]+$/.test(hostId) || !stagingRegistryAvailable()) return [];
  const rows = querySqliteParams<HostReferenceRow>(DB_PATH, `
    SELECT r.doi, r.pmid, r.citation, r.url, l.link_role
    FROM host_reference_links l
    JOIN host_references r ON r.reference_id = l.reference_id
    WHERE l.host_id = ?
    ORDER BY CASE l.link_role
      WHEN 'MODEL_PRIMARY_PUBLICATION' THEN 0
      WHEN 'MODEL_VALIDATION_PAPER' THEN 1
      WHEN 'PRIMARY_PAPER_SUPPLEMENT' THEN 2
      WHEN 'MEDIUM_EVIDENCE' THEN 3
      ELSE 4
    END, r.citation
  `, [hostId]);
  const papers: HostPaperLink[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const { dois, pmids } = collectPaperIds(row.doi, row.pmid, row.url);
    if (!dois.length && !pmids.length) continue;
    const keys = [...dois.map((id) => `doi:${id}`), ...pmids.map((id) => `pmid:${id}`)];
    if (keys.some((key) => seen.has(key))) continue;
    for (const key of keys) seen.add(key);
    const title = paperTitle(row.citation, dois, pmids);
    if (!title) continue;
    papers.push({
      key: keys[0],
      title,
      role: PAPER_ROLE_LABELS[row.link_role] ?? "Recorded source",
      dois,
      pmids,
      hrefs: [
        ...dois.map((id) => ({ label: `DOI ${id}`, href: `https://doi.org/${id}` })),
        ...pmids.map((id) => ({ label: `PubMed ${id}`, href: `https://pubmed.ncbi.nlm.nih.gov/${id}/` })),
      ],
    });
  }
  return papers;
}

export function safeModelSourceUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

const QC_WARNING_LABELS: Record<string, string> = {
  CHARGE_COVERAGE: "charge coverage",
  MASS_BALANCE: "mass balance",
  FORMULA_COVERAGE: "formula coverage",
  BLOCKED_FRACTION: "blocked-reaction fraction",
  REACTION_ANNOTATION: "reaction annotation coverage",
  METABOLITE_ANNOTATION: "metabolite annotation coverage",
  MEMOTE_TOTAL: "MEMOTE total score",
  MODEL_SCOPE_SPECIES_CONSENSUS_IN_STRAIN_CONTEXT: "species-consensus model used in a strain context",
  CONDITION_CONSISTENCY: "condition-consistency check",
};

function splitCodes(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter((item) => item && item !== "NOT_REPORTED");
}

export function qcWarningLabels(value: string | null | undefined): string[] {
  return splitCodes(value).map((code) => QC_WARNING_LABELS[code] ?? code.replaceAll("_", " ").toLowerCase());
}

export function qcFatalLabels(value: string | null | undefined): string[] {
  return splitCodes(value).map((code) => QC_WARNING_LABELS[code] ?? code.replaceAll("_", " ").toLowerCase());
}
