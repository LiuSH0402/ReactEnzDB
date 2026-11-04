import { keggAccessPolicy } from "@/lib/keggAccessPolicy";
import { PATHWAY_EXPORT_HOST_KEYS } from "@/lib/pathwayExport";

export const dynamic = "force-dynamic";

const pagedParameters = [
  { name: "q", in: "query", schema: { type: "string" }, description: "Text search query." },
  { name: "page", in: "query", schema: { type: "integer", default: 1, minimum: 1 } },
  { name: "pageSize", in: "query", schema: { type: "integer", default: 20, minimum: 1, maximum: 100 } },
  { name: "sort", in: "query", schema: { type: "string" } },
  { name: "dir", in: "query", schema: { type: "string", enum: ["asc", "desc"], default: "desc" } },
  { name: "minEvidenceScore", in: "query", schema: { type: "integer", minimum: 0, maximum: 100 }, description: "Minimum annotation-richness value. The legacy parameter name is retained for compatibility; this is not a correctness or activity probability." },
];

const detailParameters = [
  {
    name: "include",
    in: "query",
    schema: { type: "string" },
    description:
      "Comma-separated related sections to include. Use all for all supported sections. Supported values depend on the endpoint.",
  },
  {
    name: "limit",
    in: "query",
    schema: { type: "integer", default: 120, minimum: 1, maximum: 1000 },
    description: "Maximum rows returned per included related section.",
  },
];

const evidenceParameters = [
  { name: "evidenceClass", in: "query", schema: { type: "string" }, description: "Exact evidence-class identifier, such as exact_substrate_product_experimental_evidence." },
  { name: "outcome", in: "query", schema: { type: "string" }, description: "Exact outcome class, including quantitative_activity, inactive, or negative_or_below_detection." },
  { name: "curationStatus", in: "query", schema: { type: "string" }, description: "Exact curation status." },
  { name: "parameter", in: "query", schema: { type: "string" }, description: "Canonical measurement type, such as Km, kcat, or kcat/Km." },
  { name: "limit", in: "query", schema: { type: "integer", default: 40, minimum: 1, maximum: 250 } },
  { name: "offset", in: "query", schema: { type: "integer", default: 0, minimum: 0 } },
  { name: "pairLimit", in: "query", schema: { type: "integer", default: 80, minimum: 1, maximum: 250 }, description: "Maximum ranked reaction–enzyme summary rows." },
];

const okResponse = {
  description: "Successful ReactEnzDB JSON response.",
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: {
          meta: { type: "object" },
          data: {},
        },
      },
    },
  },
};

const openapi = {
  openapi: "3.1.0",
  info: {
    title: "ReactEnzDB REST API",
    version: "2026.09.1",
    description:
      "Programmatic access to permanent Reaction–Enzyme Associations, reactions, enzymes, reaction-specific activity evidence, source organisms, chassis annotations, 30 host-model identities, bulk exports, and release files. Release 2026.08.1 routes and field names are retained for compatibility. Host Context mapping uses the companion /host-context-preview contract included in freeze 2026.09.1; it is a model lookup, not a host recommendation.",
    license: {
      name: "See ReactEnzDB Downloads page; source database terms remain applicable.",
    },
  },
  servers: [{ url: "/api/reactenzdb" }],
  paths: {
    "/relations": {
      get: {
        summary: "Search Reaction–Enzyme Associations",
        description: "Returns first-class association records with permanent reo_id values. The /relations route and legacy response keys are retained for release compatibility. IDs are registry-backed, never derived from SQLite rowid, and never reassigned.",
        parameters: [
          { name: "q", in: "query", schema: { type: "string" }, description: "Association ID (reo_id) or text across reaction, enzyme, and source-organism fields." },
          { name: "reaction", in: "query", schema: { type: "string" } },
          { name: "enzyme", in: "query", schema: { type: "string" } },
          { name: "organism", in: "query", schema: { type: "string" }, description: "Source organism associated with the enzyme record; the parameter name is retained for compatibility." },
          { name: "hasSequence", in: "query", schema: { type: "boolean" } },
          { name: "sort", in: "query", schema: { type: "string", enum: ["reaction", "enzyme", "organism", "sequence", "source"], default: "reaction" } },
          { name: "dir", in: "query", schema: { type: "string", enum: ["asc", "desc"], default: "asc" } },
          { name: "page", in: "query", schema: { type: "integer", default: 1, minimum: 1 } },
          { name: "pageSize", in: "query", schema: { type: "integer", default: 20, minimum: 1, maximum: 100 } },
        ],
        responses: { "200": okResponse },
      },
    },
    "/relations/{reo_id}": {
      get: {
        summary: "Get one permanent Reaction–Enzyme Association",
        description: "Returns the association in the legacy relation response key, plus its reaction, enzyme, and source-organism entity summaries.",
        parameters: [
          { name: "reo_id", in: "path", required: true, schema: { type: "string", pattern: "^REO[0-9]{6,}$", example: "REO000001" }, description: "Stable association identifier retained from the original R-E-O data model for release compatibility." },
        ],
        responses: { "200": okResponse, "404": { description: "Reaction–Enzyme Association not found." } },
      },
    },
    "/reactions": {
      get: {
        summary: "Search reactions",
        parameters: [
          ...pagedParameters,
          { name: "dataset", in: "query", schema: { type: "string", enum: ["gold", "silver"] } },
          { name: "direction", in: "query", schema: { type: "string" } },
          { name: "complete", in: "query", schema: { type: "boolean" } },
          { name: "organism", in: "query", schema: { type: "string" }, description: "Source-organism filter; the parameter name is retained for compatibility." },
          { name: "chassis", in: "query", schema: { type: "string" }, description: "Chassis-annotation filter; not a curated-host filter. The parameter name is retained for compatibility." },
          { name: "ec", in: "query", schema: { type: "string" } },
          { name: "rhea", in: "query", schema: { type: "string" } },
          { name: "kegg", in: "query", schema: { type: "string" } },
          { name: "metacyc", in: "query", schema: { type: "string" } },
          { name: "mnx", in: "query", schema: { type: "string" } },
          { name: "minEnzymes", in: "query", schema: { type: "integer" } },
          { name: "minKinetics", in: "query", schema: { type: "integer" } },
          { name: "massBalance", in: "query", schema: { type: "string", enum: ["balanced", "hydrogen_only_imbalance", "unbalanced", "unknown_missing_structure"] }, description: "Full explicit reaction mass-balance status." },
          { name: "chargeBalance", in: "query", schema: { type: "string", enum: ["balanced", "unbalanced", "unknown_missing_structure"] }, description: "Full explicit reaction charge-balance status." },
          { name: "stereoStatus", in: "query", schema: { type: "string", enum: ["complete_or_not_applicable", "incomplete_unspecified", "unknown_missing_structure"] } },
          { name: "structureStatus", in: "query", schema: { type: "string", enum: ["complete", "partial_generic_structure", "partial_missing_structure"] } },
          { name: "exactRhea", in: "query", schema: { type: "boolean" }, description: "Require or exclude an exact normalized Rhea identity." },
          { name: "atomMapped", in: "query", schema: { type: "boolean" }, description: "Require or exclude a validated source-matched or quality-gated predicted atom mapping." },
          { name: "conflictFree", in: "query", schema: { type: "boolean" }, description: "Require zero conflicts, or require at least one recorded conflict when false." },
        ],
        responses: { "200": okResponse },
      },
    },
    "/reactions/{id}": {
      get: {
        summary: "Get one reaction with optional related sections",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          ...detailParameters,
        ],
        responses: { "200": okResponse, "404": { description: "Reaction not found." } },
      },
    },
    "/reactions/{id}/evidence": {
      get: {
        summary: "Get reaction-specific enzyme evidence",
        description: "Returns ranked reaction–enzyme summaries, canonical assay assertions, measurements, conditions, citations, and separately bounded BRENDA EC-level context. Automatic exact matching is not equivalent to literature verification.",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          ...evidenceParameters,
        ],
        responses: { "200": okResponse, "404": { description: "Reaction not found." } },
      },
    },
    "/reactions/{id}/standardization": {
      get: {
        summary: "Get normalized reaction identity, balance, atom mapping, reaction centre, and cross-database conflicts",
        description: "Returns dual reaction identities, normalized participants and stoichiometry, full/core mass and charge balance, confidence-scored cross-database mappings, public atom-mapping details, reaction centres, and explicit conflict records.",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": okResponse, "404": { description: "Reaction standardization record not found." } },
      },
    },
    "/enzymes": {
      get: {
        summary: "Search enzymes",
        parameters: [
          ...pagedParameters,
          { name: "organism", in: "query", schema: { type: "string" }, description: "Source-organism filter; the parameter name is retained for compatibility." },
          { name: "reactionId", in: "query", schema: { type: "string" } },
          { name: "chassis", in: "query", schema: { type: "string" }, description: "Chassis-annotation filter; not a curated-host filter. The parameter name is retained for compatibility." },
          { name: "gene", in: "query", schema: { type: "string" } },
          { name: "taxonomy", in: "query", schema: { type: "string" } },
          { name: "sequence", in: "query", schema: { type: "string", enum: ["all", "true", "false"] } },
          { name: "hasPdb", in: "query", schema: { type: "string", enum: ["all", "yes", "no"] } },
          { name: "hasAlphaFold", in: "query", schema: { type: "string", enum: ["all", "yes", "no"] } },
          { name: "hasStructure", in: "query", schema: { type: "string", enum: ["all", "yes", "no"] } },
          { name: "hasKinetics", in: "query", schema: { type: "string", enum: ["all", "yes", "no"] } },
          { name: "hasInterPro", in: "query", schema: { type: "string", enum: ["all", "yes", "no"] } },
          { name: "hasHighConfidenceStructure", in: "query", schema: { type: "string", enum: ["all", "yes", "no"] } },
          { name: "hasCatalyticSiteSupport", in: "query", schema: { type: "string", enum: ["all", "yes", "no"] } },
          { name: "minStructureConfidenceScore", in: "query", schema: { type: "integer", minimum: 0, maximum: 100 } },
        ],
        responses: { "200": okResponse },
      },
    },
    "/enzymes/{id}": {
      get: {
        summary: "Get one enzyme with optional related sections",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          ...detailParameters,
        ],
        responses: { "200": okResponse, "404": { description: "Enzyme not found." } },
      },
    },
    "/enzymes/{id}/evidence": {
      get: {
        summary: "Get reaction-specific evidence for one enzyme",
        description: "Returns tested reaction links, assay assertions, quantitative measurements, conditions, citations, negative records, and curation state.",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          ...evidenceParameters,
        ],
        responses: { "200": okResponse, "404": { description: "Enzyme not found." } },
      },
    },
    "/evidence/status": {
      get: {
        summary: "Get reaction-specific evidence release status and counts",
        responses: { "200": okResponse },
      },
    },
    "/expression-evidence": {
      get: {
        summary: "Search experimental expression evidence candidates",
        description: "Search article-level heterologous-expression candidates by full-text state, E1-E4 class, host, activity, solubility and review status. Candidates remain pending human review.",
        parameters: [
          ...pagedParameters,
          { name: "fulltext", in: "query", schema: { type: "string" } },
          { name: "tier", in: "query", schema: { type: "string", enum: ["E1", "E2", "E3", "E4"] } },
          { name: "host", in: "query", schema: { type: "string" } },
          { name: "activity", in: "query", schema: { type: "string" } },
          { name: "solubility", in: "query", schema: { type: "string" } },
          { name: "review", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": okResponse },
      },
    },
    "/expression-evidence/{pmid}": {
      get: {
        summary: "Get one article's experimental expression candidates",
        description: "Returns article correspondence, candidate conditions, enzyme/reaction mappings, shortened source-trace excerpts and QC flags.",
        parameters: [{ name: "pmid", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": okResponse, "404": { description: "Expression-evidence article not found." } },
      },
    },
    "/organisms": {
      get: {
        summary: "Search source organisms",
        parameters: pagedParameters,
        responses: { "200": okResponse },
      },
    },
    "/organisms/{id}": {
      get: {
        summary: "Get one source organism with optional related records",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          ...detailParameters,
        ],
        responses: { "200": okResponse, "404": { description: "Source organism not found." } },
      },
    },
    "/chassis": {
      get: {
        summary: "Search chassis annotations",
        description: "Search source-retained expression-host, strain, cell-line, and biological-context annotations. These records are not automatically curated metabolic hosts.",
        parameters: pagedParameters,
        responses: { "200": okResponse },
      },
    },
    "/chassis/{id}": {
      get: {
        summary: "Get one chassis annotation with optional related records",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          ...detailParameters,
        ],
        responses: { "200": okResponse, "404": { description: "Chassis annotation not found." } },
      },
    },
    "/export": {
      get: { summary: "Download filtered list or record-detail exports", parameters: [
        { name: "type", in: "query", required: true, schema: { type: "string", enum: ["reactions", "enzymes", "organisms", "chassis", "reaction-detail", "enzyme-detail", "organism-detail", "chassis-detail"] } },
        { name: "format", in: "query", schema: { type: "string", enum: ["xls", "tsv.gz"] } },
        { name: "id", in: "query", schema: { type: "string" } },
        { name: "ids", in: "query", schema: { type: "string" } },
        { name: "columns", in: "query", schema: { type: "string" } },
      ], responses: { "200": { description: "XLS workbook or compressed TSV." }, "400": { description: "Unsupported export type or missing record." } } },
    },
    "/release-file": {
      get: {
        summary: "Download verified ZIP, SQLite, CSV/TSV files or release metadata; supports HEAD and byte ranges",
        parameters: [{ name: "file", in: "query", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Requested release file, with checksum and download revision." }, "206": { description: "Requested byte range." }, "416": { description: "Invalid byte range." }, "410": { description: "Unreviewed historical mixed file." } },
      },
    },
    "/pathway-export": {
      get: {
        summary: "Export pathway-level enzyme candidates with legacy host-context heuristic fields",
        description:
          "Given multiple ReactEnzDB reaction IDs, returns ranked enzyme candidates for each pathway step. Compatibility fields such as feasibility_score and recommendation labels are retained. They describe a preliminary model-coverage heuristic, not a curated-host recommendation or expression, flux, growth, yield, or production-feasibility prediction.",
        parameters: [
          { name: "reactions", in: "query", required: true, schema: { type: "string" }, description: "Comma, semicolon, or whitespace separated reaction IDs such as R00001,R00002." },
          { name: "host", in: "query", schema: { type: "string", enum: PATHWAY_EXPORT_HOST_KEYS, default: "any" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 10, minimum: 1, maximum: 50 }, description: "Top candidates returned per reaction." },
          { name: "format", in: "query", schema: { type: "string", enum: ["json", "csv"], default: "json" } },
        ],
        responses: { "200": okResponse },
      },
    },
    "/sequence-clusters": {
      get: {
        summary: "Query non-redundant enzyme sequence families",
        description: "Returns an identity-threshold family table, reaction-specific family representatives, or the four memberships of one enzyme. Sequence similarity is not evidence of identical catalytic activity.",
        parameters: [
          { name: "threshold", in: "query", schema: { type: "integer", enum: [100, 90, 70, 50], default: 90 } },
          { name: "reactionId", in: "query", schema: { type: "string" } },
          { name: "enzymeId", in: "query", schema: { type: "string" } },
          { name: "support", in: "query", schema: { type: "string", enum: ["all", "experimental", "structure", "diverse", "underexplored"], default: "all" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 100, minimum: 1, maximum: 500 } },
        ],
        responses: { "200": okResponse },
      },
    },
    "/candidate-set": {
      get: {
        summary: "Build a reaction-specific enzyme candidate set",
        description: "Returns evidence-ranked candidates, evidence-relative family novelty, and Smith-Waterman identity/coverage to the nearest same-reaction enzyme with rank 1-2 catalytic evidence. Sequence similarity is prioritization evidence, not activity proof.",
        parameters: [
          { name: "reactionId", in: "query", required: true, schema: { type: "string" } },
          { name: "mode", in: "query", schema: { type: "string", enum: ["best-supported", "taxonomically-diverse", "low-redundancy", "structurally-characterized", "outside-supported-families"], default: "best-supported" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 100, minimum: 1, maximum: 500 } },
          { name: "format", in: "query", schema: { type: "string", enum: ["json", "tsv"], default: "json" } },
        ],
        responses: { "200": okResponse, "404": { description: "No sequence-bearing reaction candidates found." } },
      },
    },
    "/candidate-diversity": {
      get: {
        summary: "Query candidate-enzyme redundancy and diversity analysis",
        description: "Returns global NR100/90/70/50 compression, evidence-refreshed representative retention and taxonomy summaries, or one reaction-level diversity record. Reaction support uses final standardized BRENDA, SABIO-RK, and ReactEnzDB-core evidence; EC-only and contextual records are excluded.",
        parameters: [
          { name: "reactionId", in: "query", schema: { type: "string" }, description: "Return one reaction-level diversity record by internal or ReactEnzDB reaction ID." },
          { name: "limit", in: "query", schema: { type: "integer", default: 100, minimum: 1, maximum: 500 }, description: "Number of ranked reaction records returned with the global overview." },
        ],
        responses: { "200": okResponse, "404": { description: "Reaction diversity record not found." } },
      },
    },
    "/host-pathway-coverage": {
      get: { summary: "Legacy host pathway coverage unavailable", responses: { "410": { description: "This legacy coverage resource is currently unavailable." } } },
    },
    "/source-policy": {
      get: { summary: "Current source availability metadata", responses: { "200": okResponse } },
    },
    "/model-ready": {
      get: {
        summary: "Query default-trainable reactions with optional external kinetic confirmation filters",
        description:
          "Defaults to the conservative trainable reaction view. Exact external confirmation requires web_kinetic_external_checks.match_status = matched; weak and EC-only matches are excluded.",
        parameters: [
          { name: "view", in: "query", schema: { type: "string", enum: ["default", "all"], default: "default" } },
          { name: "externalValidation", in: "query", schema: { type: "string", enum: ["any", "brenda_exact", "sabio_rk_exact", "either_exact", "both_exact"], default: "any" } },
          { name: "q", in: "query", schema: { type: "string" }, description: "Reaction ID, EC, or Rhea search text." },
          { name: "page", in: "query", schema: { type: "integer", default: 1, minimum: 1 } },
          { name: "pageSize", in: "query", schema: { type: "integer", default: 20, minimum: 1, maximum: 100 } },
        ],
        responses: { "200": okResponse },
      },
    },
    "/openapi": {
      get: {
        summary: "Return this OpenAPI document",
        responses: { "200": okResponse },
      },
    },
  },
};

export async function GET() {
  return Response.json({ ...openapi, "x-kegg-access-policy": keggAccessPolicy }, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
