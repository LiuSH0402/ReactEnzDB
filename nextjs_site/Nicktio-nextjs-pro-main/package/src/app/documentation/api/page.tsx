import type { Metadata } from "next";
import { localMappingPreviewAvailable } from "@/lib/hostMappingLocalPreview";
import { REACTENZDB_RELEASE } from "@/lib/release";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "REST API documentation", description: "ReactEnzDB REST API routes, OpenAPI metadata, pagination, exports, and curl, Python, and R examples.", alternates: { canonical: "/documentation/api" } };

const callNotes = [
  {
    eyebrow: "Pagination",
    title: "List endpoints",
    text: (
      <>
        Use <code>page</code> and <code>pageSize</code>. The current API caps <code>pageSize</code> at 100 to keep interactive queries stable.
      </>
    ),
  },
  {
    eyebrow: "Related data",
    title: "Detail endpoints",
    text: (
      <>
        Use <code>include=...</code> to request related sections. Use <code>include=all</code> for all supported sections and <code>limit</code> to cap each section.
      </>
    ),
  },
  {
    eyebrow: "Bulk access",
    title: "Release files, not pagination",
    text: (
      <>
        Verified data-only packages and filtered list/detail exports are available. Current file checksums and scope are on the <a className="font-bold text-primary hover:underline" href="/downloads">Downloads</a> page.
      </>
    ),
  },
  {
    eyebrow: "Rate limit",
    title: "Interactive routes only",
    text: (
      <>
        Interactive routes apply a best-effort limit of 120 requests per client per minute and return <code>X-RateLimit-*</code> headers. Versioned release-file downloads are excluded.
      </>
    ),
  },
];

const compatibilityTerms = [
  ["Reaction–Enzyme Association", "/relations · reo_id · relation", "Stable route, identifier, and response key retained from the original R-E-O data model."],
  ["Source Organism", "/organisms · organism · reactenz_organism_id", "The organism field describes enzyme provenance; it is not a curated metabolic host."],
  ["Chassis Annotation", "/chassis · chassis · chassis_label · reactenz_chassis_id", "Source-retained biological-context annotation; it is not automatically expression-validated or host-curated."],
  ["Annotation Richness", "evidence_score · minEvidenceScore", "Legacy field names remain stable; the value measures annotation coverage, not correctness or activity probability."],
];

type EndpointRow = [method: string, route: string, use: string];

const endpointGroups: { eyebrow: string; title: string; note?: string; rows: EndpointRow[] }[] = [
  {
    eyebrow: "Core records",
    title: "Associations, reactions, enzymes, and provenance",
    rows: [
      ["GET", "/api/reactenzdb/relations", "Search permanent Reaction–Enzyme Associations by Association ID (stable reo_id), reaction, enzyme, source organism, sequence availability, sorting, and pagination filters."],
      ["GET", "/api/reactenzdb/relations/{reo_id}", "Retrieve one permanent Reaction–Enzyme Association together with its reaction, enzyme, and source-organism summaries."],
      ["GET", "/api/reactenzdb/reactions", "Search reactions with identifiers, source-organism (organism) and chassis-annotation (chassis) filters, annotation richness, mass/charge balance, stereo/structure completeness, exact Rhea identity, atom mapping, conflicts, and pagination filters."],
      ["GET", "/api/reactenzdb/reactions/{id}", "Retrieve one reaction and optional standardization, compounds, enzymes, kinetics, xrefs, MNXref, M-CSA, and references."],
      ["GET", "/api/reactenzdb/enzymes", "Search enzymes by name, UniProt, gene, source organism, reaction, sequence, structures, kinetics, InterPro, chassis annotation, and annotation richness."],
      ["GET", "/api/reactenzdb/enzymes/{id}", "Retrieve one enzyme and optional reactions, kinetics, protein domains/features, structures, M-CSA, references, chassis annotations, and xrefs."],
      ["GET", "/api/reactenzdb/organisms", "Search source organisms."],
      ["GET", "/api/reactenzdb/organisms/{id}", "Retrieve one source organism and optional association records, reactions, enzymes, and chassis annotations."],
      ["GET", "/api/reactenzdb/chassis", "Search source-retained chassis annotations."],
      ["GET", "/api/reactenzdb/chassis/{id}", "Retrieve one chassis annotation and optional association records, reactions, and enzymes."],
    ],
  },
  {
    eyebrow: "Evidence",
    title: "Assay, expression, and standardization layers",
    rows: [
      ["GET", "/api/reactenzdb/reactions/{id}/standardization", "Retrieve normalized reaction identities, stoichiometry, balance, cross-database mappings, atom mapping, reaction centre, and explicit conflicts."],
      ["GET", "/api/reactenzdb/reactions/{id}/evidence", "Retrieve ranked enzyme evidence, assay assertions, measurements, conditions, citations, negative records, and review state for one reaction."],
      ["GET", "/api/reactenzdb/enzymes/{id}/evidence", "Retrieve reaction-specific assay evidence and tested reaction links for one enzyme."],
      ["GET", "/api/reactenzdb/evidence/status", "Inspect the mounted evidence release version, included/pending sources, QA counts, and interpretation boundary."],
      ["GET", "/api/reactenzdb/expression-evidence", "Search article-level heterologous-expression candidates. Machine-extracted rows remain pending human review; they are not verified expression assertions."],
      ["GET", "/api/reactenzdb/expression-evidence/{pmid}", "Retrieve one article's expression candidates, condition fields, mappings, and QC flags."],
    ],
  },
  {
    eyebrow: "Derived analysis",
    title: "Families, candidates, and published host-related routes",
    note: "These routes are documented by the current OpenAPI endpoint; legacy parameter names remain compatible. They are not the unpublished Host Context v1 preview. Sequence similarity and model coverage are prioritization evidence, not activity or host-performance proof.",
    rows: [
      ["GET", "/api/reactenzdb/sequence-clusters", "Query NR100/90/70/50 sequence families, reaction-specific representatives, or one enzyme's four memberships. Sequence similarity is not evidence of identical catalytic activity."],
      ["GET", "/api/reactenzdb/candidate-set", "Build one of five reaction-specific enzyme candidate sets with evidence-relative novelty and nearest known-active sequence distance; optionally download TSV."],
      ["GET", "/api/reactenzdb/candidate-diversity", "Retrieve redundancy, distant-family, taxonomy, structure, kinetic-snapshot, and representative-retention analyses globally or for one reaction."],
      ["GET", "/api/reactenzdb/model-ready", "Query the conservative trainable-reaction view, with optional exact BRENDA/SABIO-RK kinetic confirmation filters. Weak and EC-only matches are excluded."],
      ["GET", "/api/reactenzdb/pathway-export", "Export reaction-level enzyme candidates as JSON or CSV. Legacy host model coverage is currently unavailable."],
      ["GET", "/api/reactenzdb/host-pathway-coverage", "Currently unavailable (HTTP 410): legacy host pathway coverage."],
    ],
  },
  {
    eyebrow: "Downloads",
    title: "Filtered tables and the current-release contract",
    rows: [
      ["GET", "/api/reactenzdb/export", "Download filtered list rows as XLS or TSV.GZ, or a record-detail workbook; collection-source descriptions are omitted."],
      ["GET", "/api/reactenzdb/release-file", "Download allowed release metadata, license and citation files. Mixed data files return HTTP 410."],
      ["GET", "/api/reactenzdb/openapi", "Download the current machine-readable OpenAPI 3.1 document; record the base release and data revision separately."],
    ],
  },
];

const examples = [
  {
    title: "Set the public API base URL",
    code: `# Linux/macOS
export REACTENZDB_BASE_URL="http://reactenzdb.lin-group.cn"

# PowerShell
$env:REACTENZDB_BASE_URL="http://reactenzdb.lin-group.cn"`,
  },
  {
    title: "Python: verify downloaded bytes against the current manifest",
    code: `import hashlib, json, os, urllib.request

base = os.environ["REACTENZDB_BASE_URL"].rstrip("/")
route = base + "/api/reactenzdb/release-file?file="
with urllib.request.urlopen(route + "catalog", timeout=60) as response:
    manifest = json.load(response)
name = "download_bundle/tables/web_kinetics_reference_repairs.tsv.gz"
expected = next(item for item in manifest["files"] if item["path"] == name)
with urllib.request.urlopen(route + "download:" + name.split("/")[-1], timeout=60) as response:
    content = response.read()
assert len(content) == expected["size"]
assert hashlib.sha256(content).hexdigest() == expected["sha256"]
print(manifest["revision"], manifest["source_snapshot"])
print(name, expected["sha256"])`,
  },
  {
    title: "curl: search reactions",
    code: `curl "$REACTENZDB_BASE_URL/api/reactenzdb/reactions?q=alcohol%20dehydrogenase&pageSize=5"`,
  },
  {
    title: "curl: retrieve one reaction with related layers",
    code: `curl "$REACTENZDB_BASE_URL/api/reactenzdb/reactions/R05309?include=compounds,enzymes,kinetics,evidence_rc,mnx,mcsa,references&limit=50"`,
  },
  {
    title: "curl: search and retrieve permanent associations",
    code: `curl "$REACTENZDB_BASE_URL/api/reactenzdb/relations?organism=Escherichia%20coli&hasSequence=true&pageSize=5"
curl "$REACTENZDB_BASE_URL/api/reactenzdb/relations/REO000001"`,
  },
  {
    title: "Python: query enzymes",
    code: `import os
import requests

base = os.environ["REACTENZDB_BASE_URL"].rstrip("/") + "/api/reactenzdb"
params = {
    "q": "methylisocitrate lyase",
    "hasInterPro": "true",
    "hasStructure": "true",
    "pageSize": 10,
}
response = requests.get(f"{base}/enzymes", params=params, timeout=30)
response.raise_for_status()
payload = response.json()
print(payload["meta"])
for enzyme in payload["data"]:
    print(enzyme["reactenz_enzyme_id"], enzyme.get("uniprot_accession"), enzyme["enzyme_name"])`,
  },
  {
    title: "R: search reactions",
    code: `library(httr2)
library(jsonlite)

base <- Sys.getenv("REACTENZDB_BASE_URL")
req <- request(paste0(sub("/$", "", base), "/api/reactenzdb/reactions")) |>
  req_url_query(q = "ATP", complete = "true", pageSize = 10)

payload <- req_perform(req) |> resp_body_json(simplifyVector = TRUE)
print(payload$meta)
print(payload$data[, c("reactenz_reaction_id", "reaction_equation_display", "enzyme_count")])`,
  },
  {
    title: "Bulk download: CSV.GZ",
    code: `curl -L -o web_reactions.csv.gz \\
  "$REACTENZDB_BASE_URL/api/reactenzdb/release-file?file=download:web_reactions.csv.gz"`,
  },
];

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="overflow-x-auto rounded-2xl bg-[#0b1526] p-5 text-sm leading-6 text-white">
      <code>{code}</code>
    </pre>
  );
}

function EndpointTable({ rows }: { rows: EndpointRow[] }) {
  return (
    <div className="overflow-hidden rounded-[24px] border border-border bg-white dark:border-dark_border dark:bg-darkmode">
      <table className="w-full min-w-[980px] text-left">
        <thead className="bg-hero-bg text-xs uppercase tracking-wider text-muted dark:bg-dark_b">
          <tr>
            <th className="px-5 py-3">Method</th>
            <th className="px-5 py-3">Route</th>
            <th className="px-5 py-3">Use</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border dark:divide-dark_border">
          {rows.map(([method, route, description]) => (
            <tr key={route}>
              <td className="px-5 py-3.5">
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-black text-primary">{method}</span>
              </td>
              <td className="px-5 py-3.5">
                <code className="break-all font-mono text-sm font-black text-midnight_text dark:text-white">{route}</code>
              </td>
              <td className="px-5 py-3.5 text-sm leading-6 text-muted dark:text-white/60">{description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ApiDocumentationPage() {
  const localPreview = localMappingPreviewAvailable();
  return (
    <main className="reactenz-container reactenz-page">
      <section className="reactenz-page-panel overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(47,111,239,0.12),transparent_34%),radial-gradient(circle_at_80%_0%,rgba(25,180,160,0.12),transparent_32%)]" />
        <div className="relative">
          <p className="reactenz-eyebrow">Programmatic access</p>
          <h1>ReactEnzDB REST API</h1>
          <p className="reactenz-page-copy">
            Use the REST API for programmatic search, record retrieval, and reproducible data download.
            Responses use a stable JSON envelope: <code className="rounded bg-white/70 px-2 py-1 text-primary">{"{ meta, data }"}</code>.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <a className="rounded-xl bg-primary px-4 py-2.5 text-sm font-black text-white hover:bg-primary/90" href="/api/reactenzdb/openapi">
              OpenAPI JSON
            </a>
            <a className="rounded-xl border border-border bg-white px-4 py-2.5 text-sm font-black text-midnight_text hover:border-primary dark:border-dark_border dark:bg-darkmode dark:text-white" href="/downloads">
              Downloads
            </a>
          </div>
        </div>
      </section>

      <section className="mb-10">
        <p className="reactenz-eyebrow">Calling convention</p>
        <h2 className="reactenz-tools-section-title mb-5">How to call the current-release API</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {callNotes.map((note) => (
            <article className="rounded-[20px] border border-border bg-white px-5 py-4 dark:border-dark_border dark:bg-darkmode" key={note.title}>
              <p className="reactenz-eyebrow">{note.eyebrow}</p>
              <h3 className="reactenz-api-example-title mt-1">{note.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted dark:text-white/60">{note.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mb-10">
        <p className="reactenz-eyebrow">Terminology and compatibility</p>
        <h2 className="reactenz-tools-section-title mb-3">Display names changed; the wire contract did not</h2>
        <p className="mb-4 text-sm leading-7 text-muted dark:text-white/60">
          Current documentation describes base release {REACTENZDB_RELEASE.version} and retains legacy routes, query parameters, response keys,
          identifiers, and historical download schemas remain available exactly as named for reproducible clients.
        </p>
        <div className="overflow-hidden rounded-[24px] border border-border bg-white dark:border-dark_border dark:bg-darkmode">
          <table className="w-full min-w-[780px] text-left">
            <thead className="bg-hero-bg text-xs uppercase tracking-wider text-muted dark:bg-dark_b">
              <tr>
                <th className="px-5 py-3">Current display term</th>
                <th className="px-5 py-3">Stable API names</th>
                <th className="px-5 py-3">Interpretation boundary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border dark:divide-dark_border">
              {compatibilityTerms.map(([term, names, boundary]) => (
                <tr key={term}>
                  <td className="px-5 py-3.5 font-black text-midnight_text dark:text-white">{term}</td>
                  <td className="px-5 py-3.5"><code className="text-sm text-primary">{names}</code></td>
                  <td className="px-5 py-3.5 text-sm leading-6 text-muted dark:text-white/60">{boundary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-10">
        <p className="reactenz-eyebrow">Endpoints</p>
        <h2 className="reactenz-tools-section-title mb-3">Available routes</h2>
        <p className="mb-6 text-sm leading-7 text-muted dark:text-white/60">
          Parameter names, response keys, and path templates are defined in the{" "}
          <a className="font-bold text-primary hover:underline" href="/api/reactenzdb/openapi">OpenAPI 3.1 document</a>.
          Host Context v1 lookup uses a separately versioned preview contract; it is not validated host-performance evidence.
        </p>
        <div className="grid gap-8">
          {endpointGroups.map((group) => (
            <div key={group.title}>
              <p className="reactenz-eyebrow">{group.eyebrow}</p>
              <h3 className="reactenz-api-example-title mb-2 mt-1">{group.title}</h3>
              {group.note ? <p className="mb-3 text-sm leading-6 text-muted dark:text-white/60">{group.note}</p> : null}
              <EndpointTable rows={group.rows} />
            </div>
          ))}
        </div>
      </section>

      {localPreview ? (
        <section className="mb-10 rounded-[20px] border border-amber-300 bg-amber-50 px-5 py-5 text-sm leading-6 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100">
          <p className="text-xs font-black uppercase tracking-wider">2026.09.1 model lookup · separate preview contract</p>
          <h2 className="reactenz-api-example-title mt-2">Host Context preview API</h2>
          <p className="mt-2">
            Lookup GET routes: <code>/api/reactenzdb/hosts/preview</code>, <code>/hosts/preview/&#123;hostId&#125;</code>, and <code>/reactions/&#123;reactionId&#125;/hosts/preview</code>.
            POST <code>/api/reactenzdb/pathway/host-context/preview</code> accepts 1–30 steps and 1–30 fixed <code>release_ids</code>.
          </p>
          <p className="mt-2">
            <a className="font-bold underline" href="/api/reactenzdb/host-context-preview/openapi">Preview OpenAPI</a>
            {" · "}
            <a className="font-bold underline" href="/api/reactenzdb/host-context-preview/manifest">manifest and field dictionary</a>
            . Model NOT_MAPPED is not biological absence. The preview is separate from the core data repair and does not establish host-model validation.
          </p>
        </section>
      ) : (
        <section className="mb-10 border-l-4 border-amber-500 pl-5 text-sm text-muted">
          <h2 className="reactenz-api-example-title">Host Context v1 uses a separate lookup contract</h2>
          <p className="mt-2">Inspect the preview OpenAPI and manifest for available model lookups. Independent review and original GEM redistribution remain pending; an exposed lookup endpoint is not an experimentally validated host recommendation.</p>
        </section>
      )}

      <section className="mb-10">
        <p className="reactenz-eyebrow">Examples</p>
        <h2 className="reactenz-tools-section-title mb-3">curl, Python, and R</h2>
        <p className="mb-5 text-sm leading-7 text-muted dark:text-white/60">
          These examples cover the common path: set a base URL, search, retrieve one record with <code>include</code>, and download a bulk file. Additional query parameters are listed in OpenAPI.
        </p>
        <div className="grid gap-4">
          {examples.map((example) => (
            <article className="rounded-[20px] border border-border bg-white p-5 dark:border-dark_border dark:bg-darkmode" key={example.title}>
              <h3 className="reactenz-api-example-title mb-3">{example.title}</h3>
              <CodeBlock code={example.code} />
            </article>
          ))}
        </div>
      </section>

      <section className="reactenz-card">
        <h2 className="reactenz-tools-section-title mb-4">Recommended citation practice</h2>
        <p className="text-sm leading-7 text-muted dark:text-white/60">
          When using the API in a publication or workflow, report the ReactEnzDB release version, access date,
          endpoint or downloaded artifact, and SHA256 checksum for bulk files. Source database identifiers and
          annotations should still cite their original providers where applicable.
        </p>
      </section>
    </main>
  );
}
