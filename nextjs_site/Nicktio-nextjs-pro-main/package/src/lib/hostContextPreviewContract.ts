import { createHash } from "node:crypto";
import { keggAccessPolicy } from "./keggSourcePolicy.mjs";

export const previewContractVersion = "2026.09.1-host-context-v1";
export const previewManifestPath = "/api/reactenzdb/host-context-preview/manifest";
export const previewSourceReferences = {
  reactenzdb_web_db: "353EAEF60E30773908B3A1A647EDE33B0E45926EABE124F3029BFD2CA420FE8A",
  reaction_standardization_sqlite: "E890B611B892A5D2CE2F041D7443D6E32F939196E79D656376E45EF2C4867B4E",
  host_context_v1_staging_sqlite: "E5C2FF07642E7B2B7DDBB8D7B983F488151169D8E7D0FF4C209106CC14FBEEA0",
  advanced_candidate_selection_sqlite: "64C2C0DCCAB88E1CD73C24D8DD071CB480F1E5FAC09AC502D550B00F68AB6B0B",
} as const;

export const hostFields = ["host_id", "scientific_name", "strain", "release_id", "model_name", "version_ref", "artifact_sha256", "qc_verdict", "license_review_status", "commercial_use_status"] as const;
export const reactionHostFields = ["reactenz_reaction_id", "reaction_id", "host_id", "release_id", "mapping_status", "model_reaction_id", "identity_basis", "direction_relation", "compartment_relation", "mapping_version", "qc_flags_json"] as const;
export const pathwayStepFields = ["step", "reactenz_reaction_id", "requested_direction", "coefficient_status", "host_id", "release_id", "mapping_status", "model_reaction_id", "direction_check", "model_gap_check"] as const;
export const resourceFields = ["ledger_type", "status", "resource", "gross_consumption", "gross_production", "net_requirement", "net_production", "step_multipliers", "compartment_check"] as const;

export const previewManifest = {
  kegg_access_policy: keggAccessPolicy,
  contract_version: previewContractVersion,
  publication_status: "RELEASED_IN_2026.09.1",
  scope: "RELEASE_2026.09.1_HOST_CONTEXT",
  source_sha256_reference_only: previewSourceReferences,
  source_hash_verification: "NOT_RECHECKED_PER_REQUEST; these are audit reference hashes, not a new freeze or a current-state attestation",
  download_integrity: "X-Content-SHA256 hashes the exact UTF-8 response body. Dynamic exports must be verified against that header; no fixed file SHA is implied.",
  limits: { pathway_steps: 30, selected_releases: 3, reaction_host_releases: 30 },
  schemas: {
    host_registry_tsv: { content_type: "text/tab-separated-values", fields: hostFields },
    host_registry_json: { content_type: "application/json", required: ["contract_version", "publication_status", "manifest", "data"], data_shape: "array of staging registry rows; fields include the host TSV columns and source/QC context" },
    host_detail_json: { content_type: "application/json", required: ["contract_version", "publication_status", "manifest", "data"], data_shape: "one staging registry row" },
    reaction_hosts_tsv: { content_type: "text/tab-separated-values", fields: reactionHostFields },
    reaction_hosts_json: { content_type: "application/json", required: ["contract_version", "publication_status", "manifest", "reaction_id", "data"], data_shape: "array of frozen reaction × release mapping rows" },
    pathway_steps_tsv: { content_type: "text/tab-separated-values", fields: pathwayStepFields },
    pathway_resources_tsv: { content_type: "text/tab-separated-values", fields: resourceFields },
    pathway_json: { content_type: "application/json", required: ["schema_version", "staging_only", "reviewed", "publication_status", "selected_releases", "summaries", "steps", "adjacent_links", "pathway_resource_requirements", "note"] },
  },
  field_dictionary: {
    host_id: "Staging host identity; strain/scope is distinct from a model release.",
    scientific_name: "Recorded source species name for the host identity.",
    strain: "Specific host strain or identity scope in the staging registry.",
    release_id: "Fixed GEM release key; mapping joins must use reaction_id × release_id.",
    model_name: "Source GEM name attached to the release.",
    version_ref: "Source model tag, version, commit or documented reference as recorded in staging.",
    qc_verdict: "Model QC category from staging, not permission to publish or proof of comparability.",
    reactenz_reaction_id: "Stable public reaction ID R00001 format.",
    reaction_id: "Internal reaction key OENA… retained for staging joins.",
    step: "One-based input order; repeated reaction IDs are retained.",
    requested_direction: "User-declared forward/reverse/unspecified relative to displayed ReactEnzDB equation.",
    mapping_status: "Public model-release mapping category; KEGG-dependent rows are UNRESOLVED with WITHHELD_KEGG_POLICY. NOT_MAPPED is not biological absence.",
    model_reaction_id: "Fixed GEM reaction ID when a mapping row retains one; null otherwise.",
    identity_basis: "Recorded exact-ID or normalized-chemistry basis; consult frozen mapping policy.",
    direction_relation: "Frozen mapping relation in ReactEnzDB equation frame; REVERSE is not user pathway reverse.",
    compartment_relation: "Recorded single-reaction compartment relation, not cross-step transport feasibility.",
    mapping_version: "Frozen reaction × release mapping version.",
    direction_check: "Bounded model-record direction assessment; not flux feasibility.",
    model_gap_check: "Fixed-model mapping gap category, not heterologous-expression success.",
    coefficient_status: "SOURCE_NAME_CONFIRMED means the source-name coefficient reconciles with the current displayed equation; not full chemical identity validation.",
    gross_consumption: "Sum of positive stoichiometric input coefficients after declared step direction and optional step multipliers.",
    gross_production: "Sum of positive stoichiometric output coefficients after declared step direction and optional step multipliers.",
    net_requirement: "max(0, gross_consumption - gross_production); descriptive, not host supply.",
    net_production: "max(0, gross_production - gross_consumption); descriptive, not host production feasibility.",
    ledger_type: "UNIT_STEP: each step once; SINGLE_CHAIN_PROVISIONAL: unique-intermediate coefficient scaling with first step=1.",
    status: "Resource calculation state SINGLE_CHAIN_PROVISIONAL, UNIT_STEP_ONLY or INSUFFICIENT; not experimental feasibility.",
    resource: "One whitelisted cofactor/resource identity pool; null/absent if evidence is insufficient.",
    step_multipliers: "Colon-separated relative reaction counts in pathway step order; empty for UNIT_STEP or when scaling is unavailable.",
    compartment_check: "UNVERIFIED throughout this local preview.",
    qc_flags_json: "JSON-encoded fixed-matrix quality-control flags; not a validated absence statement.",
    artifact_sha256: "Source GEM artifact SHA-256 from staging registry; model publication permission is separate.",
    license_review_status: "Recorded review state; does not grant a new license.",
    commercial_use_status: "Recorded permission-review state; not legal advice or permission confirmation.",
  },
  omissions: ["No full-matrix bulk export before independent review and permission sign-off.", "No persistent analysis_id.", "No host suitability, growth, flux, compartment transport or expression claim."],
} as const;

function safeCell(value: unknown): string {
  const cell = String(value ?? "").replaceAll("\t", " ").replaceAll("\r", " ").replaceAll("\n", " ");
  return /^[=+@-]/.test(cell) ? `'${cell}` : cell;
}

export function previewTsv(fields: readonly string[], rows: Array<Record<string, unknown>>): string {
  return [fields.join("\t"), ...rows.map((row) => fields.map((field) => safeCell(row[field])).join("\t"))].join("\n") + "\n";
}

export function previewResponse(body: string, type: "json" | "tsv", filename?: string): Response {
  const digest = createHash("sha256").update(body, "utf8").digest("hex");
  const headers = new Headers({
    "Content-Type": type === "json" ? "application/json; charset=utf-8" : "text/tab-separated-values; charset=utf-8",
    "Cache-Control": "no-store", "X-Content-SHA256": digest,
    "X-ReactEnzDB-Source-Policy": keggAccessPolicy.policy_version,
    "X-Contract-Version": previewContractVersion, "X-Contract-Manifest": previewManifestPath,
    "X-Publication-Status": "RELEASED_IN_2026.09.1", "X-Robots-Tag": "noindex, nofollow",
  });
  if (filename) headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  return new Response(body, { headers });
}
