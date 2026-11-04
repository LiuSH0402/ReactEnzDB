import Link from "next/link";
import type { Metadata } from "next";
import { REACTENZDB_RELEASE } from "@/lib/release";
import { getLocalReleaseRevision } from "@/lib/localReleaseRevision";
import { getModelReadySummary } from "@/lib/retrosynthesis";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Help", description: "How to search, browse, interpret, download, and report issues in ReactEnzDB.", alternates: { canonical: "/help" } };

const searchModes = [
  {
    title: "Identifier search",
    text: "Type a reaction ID, EC, enzyme name, gene, UniProt accession, or host/model name in the same top box on Search. One box covers reactions, enzymes, and hosts.",
    href: "/search#search-results",
  },
  {
    title: "Structure search",
    text: "Open Match substrate and product on Search, then type a name or ID, Draw structure, or Load MOL/SDF. Pictures of molecules are not converted.",
    href: "/search#transformation-search",
  },
  {
    title: "Browse reactions",
    text: "Use the reaction list when you want filters, sorting, and the full table rather than a one-box lookup.",
    href: "/reactions",
  },
  {
    title: "Browse enzymes",
    text: "Use the enzyme list for sequence, structure, kinetics, gene, and source-organism filters.",
    href: "/enzymes",
  },
  {
    title: "Browse hosts",
    text: "Open the 30 staging host-model identities. These are not curated metabolic hosts.",
    href: "/hosts",
  },
];

const workflow = [
  {
    title: "1. Search or browse",
    text: "Start from Search for a reaction ID, EC, enzyme, UniProt, or host. Browse opens the reaction, enzyme, and host lists.",
  },
  {
    title: "2. Choose a planning tool when needed",
    text: "Use Tools to compare GSETRetro, READRetro, BioNavi-NP, RetroBioCat, and SubNetX by task, input, output, planning level, and access. ReactEnzDB does not benchmark them.",
  },
  {
    title: "3. Open a detail page",
    text: "Detail pages use left-side navigation to separate overview, connected entities, structures, kinetics, evidence, and links.",
  },
  {
    title: "4. Follow entity links",
    text: "Open reaction IDs, enzyme IDs, source-organism IDs, chassis-annotation IDs, UniProt, Rhea, KEGG, MetaCyc, ChEBI, PubChem, PDB, and AlphaFold links to trace evidence.",
  },
  {
    title: "5. Download selected data",
    text: "Use row selection and column selection in list pages for targeted downloads, or use Downloads for full release files.",
  },
  {
    title: "6. Programmatic access",
    text: "Use the REST API documentation for JSON search endpoints, detail endpoints, OpenAPI metadata, and curl/Python/R examples.",
  },
  {
    title: "7. Report issues",
    text: "Use the Maintenance page for maintainer contact, bug report requirements, version archive policy, and the five-year support commitment.",
  },
];

const terms = [
  ["Reaction–Enzyme Association", "A stable ReactEnzDB association between a biochemical reaction and an enzyme record, with source-organism provenance retained."],
  ["Reaction", "A biochemical transformation with substrates, products, direction, compound structure status, and external reaction identifiers when available."],
  ["Enzyme", "A catalytic protein or biopart linked to reactions, sequence, source-organism provenance, UniProt, kinetics, and structure mappings when available."],
  ["Source organism", "The biological origin of the enzyme. This is not necessarily the expression host."],
  ["Chassis Annotation", "A source-retained expression-host, strain, cell-line, or other biological-context annotation connected through association records."],
  ["Host-model context", "Staging genome-scale model records and reaction × model mapping. This is not the chassis-annotation layer and not a curated-host catalog."],
  ["SMILES complete", "All curated reaction participants have usable SMILES strings in the web release."],
  ["PDB / AlphaFold", "Experimental or predicted structure links mapped mainly through UniProt-associated identifiers."],
];

function getFaqs(trainableReactions: number | undefined) { return [
  {
    q: "What happens when I match a tool prediction in ReactEnzDB?",
    a: "On a single-step result or an individual RetroBioCat route step, click Match in ReactEnzDB. The matcher compares precursor-to-product structures, allowing supported protonation normalization while retaining chirality and isotopes. It checks both orientations against the reference direction and excludes complete no-net-change transport/exchange records. Direction-unspecified records remain candidates. Additional reference participants are shown for cofactor and co-substrate review; this is query-side coverage, not confirmation of a full balanced reaction or an experimentally feasible route.",
  },
  {
    q: "How do I check the evidence for a predicted enzyme candidate?",
    a: "In the matched reaction's enzyme table, open View pair evidence. Source assertions, protein form, outcomes, measurements, assay conditions, literature links and curation states are restricted to that reaction–enzyme pair. Exact-source assertions are automatically mapped source records; the literature-verified count is separate. Negative outcomes and discrepancies remain visible. Pair-linked literature notes may additionally provide original-paper locations, measurements, protein identity and explicit limits; these AI-assisted checks are separate from source-assertion counts and independent expert review. Separate evidence for each step does not validate a combined cascade. No mapped assay evidence means missing mapping, not inactivity. Annotation richness measures record completeness and is not a probability of catalytic activity. Review the reaction and its evidence before choosing its ID for a pathway; candidate mappings are not imported automatically.",
  },
  {
    q: "Why does ReactEnzDB preserve source-organism provenance on associations?",
    a: "A reaction can be catalyzed by many enzymes from different biological sources. Retaining source-organism provenance on each reaction–enzyme association supports enzyme candidate discovery without treating the source as an engineering host.",
  },
  {
    q: "Are Source Organism and Chassis Annotation the same?",
    a: "No. Source Organism describes where the enzyme record comes from. Chassis Annotation preserves source-derived expression-host or biological-context labels; neither automatically defines a curated metabolic host.",
  },
  {
    q: "Are chassis annotations and host-model records the same?",
    a: "No. Chassis annotations are source-retained biological-context labels. Host-model records are staging genome-scale models used for reaction × model mapping; they are not curated metabolic hosts.",
  },
  {
    q: "Does ReactEnzDB evaluate which planning tool is best?",
    a: "No. The Tools page compares scope, input, output, planning level, access, and database connection points. It does not compare model accuracy or rank tool performance.",
  },
  {
    q: "Can I use all records for machine learning?",
    a: `Use the conservative model_ready_trainable_reactions view for the default structure-based training subset (${trainableReactions === undefined ? "count unavailable" : `${trainableReactions.toLocaleString()} reactions in the current model-ready layer`}). SMILES completeness alone does not establish formula balance, a non-currency transformation, an enzyme candidate, experimental validity, or permission to reuse a record.`,
  },
  {
    q: "Why are some fields marked unresolved or not mapped?",
    a: "ReactEnzDB keeps explicit data states instead of silently removing uncertain information. This helps distinguish missing, not reported, not mapped, and unresolved annotations.",
  },
  {
    q: "How do I download only selected records?",
    a: "Open a list page, select rows using the checkbox column, choose visible columns with Select columns, then click Download. Without selected rows, the download uses the current filtered table.",
  },
  {
    q: "Can I search from a drawn molecule or a ChemDraw file?",
    a: "Yes. On Search and on each Tools runner, use Draw structure or Load MOL/SDF. The editor converts that structure to SMILES for the existing match or predictor input. Pictures of molecules (PNG, JPEG, SVG screenshots) are not converted, because that step is optical recognition and can lose chirality. From ChemDraw, use Save As MDL Molfile or Copy As SMILES.",
  },
  {
    q: "Where can I find release files and API examples?",
    a: "Use Downloads for release files and /documentation/api for REST API routes, OpenAPI metadata, and curl/Python/R examples.",
  },
  {
    q: "How do I reproduce a download or view all kinetic rows?",
    a: "Record the snapshot identifier, data revision, access date and file SHA256. Check the release manifest and each layer's recorded inputs. R05221 has 372 kinetic rows on two pages (200 and 172); use Next kinetics page for the remaining rows or download the full kinetics table. Detail API limits also cap returned rows.",
  },
  {
    q: "Are the licence, HTTPS and long-term DOI archive complete?",
    a: "Read the dated release-governance record on Downloads. A downloadable file does not establish an open licence, a server backup is not a DOI archive, and the current recorded HTTPS check is unsuccessful. Pending states are retained until actual approval or verification is recorded.",
  },
  {
    q: "Who maintains ReactEnzDB?",
    a: "ReactEnzDB is maintained by the LinDing Group at UESTC. Current contact for questions and correction requests is hlin@uestc.edu.cn.",
  },
]; }

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="reactenz-card">
      <h2 className="reactenz-tools-section-title mb-4">{title}</h2>
      {children}
    </section>
  );
}

export default function HelpPage() {
  const revision = getLocalReleaseRevision();
  const faqs = getFaqs(getModelReadySummary().tables?.model_ready_trainable_reactions);
  return (
    <main className="reactenz-container reactenz-page">
      <section className="reactenz-page-panel">
        <p className="reactenz-eyebrow">Help</p>
        <h1>How to use ReactEnzDB</h1>
        <p className="reactenz-page-copy">
          ReactEnzDB is organized around reactions and stable reaction–enzyme associations with
          source-organism provenance and chassis-annotation context. This guide explains how to search, browse, interpret
          detail pages, and download data.
        </p>
      </section>

      <section className="mb-10">
        <p className="reactenz-eyebrow">Search modes</p>
        <h2 className="reactenz-tools-section-title mb-5">Choose the right starting point</h2>
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {searchModes.map((mode) => (
            <Link className="rounded-[22px] border border-border bg-white p-5 transition hover:border-primary hover:shadow-sm dark:border-dark_border dark:bg-darkmode" href={mode.href} key={mode.title}>
              <h3 className="mb-3 text-20">{mode.title}</h3>
              <p className="text-sm leading-7 text-muted dark:text-white/60">{mode.text}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="mb-10 grid gap-5 lg:grid-cols-2">
        <Card title="Recommended workflow">
          <div className="grid gap-4">
            {workflow.map((item) => (
              <div className="rounded-2xl bg-hero-bg p-4 dark:bg-dark_b" key={item.title}>
                <div className="font-black text-midnight_text dark:text-white">{item.title}</div>
                <p className="mt-2 text-sm leading-7 text-muted dark:text-white/60">{item.text}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Main data concepts">
          <dl className="grid gap-4">
            {terms.map(([term, definition]) => (
              <div key={term}>
                <dt className="font-black text-midnight_text dark:text-white">{term}</dt>
                <dd className="mt-1 text-sm leading-7 text-muted dark:text-white/60">{definition}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </section>

      <section className="mb-10">
        <p className="reactenz-eyebrow">Page guide</p>
        <h2 className="reactenz-tools-section-title mb-5">What each page is for</h2>
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          <Link className="rounded-[22px] border border-border bg-white p-5 hover:border-primary dark:border-dark_border dark:bg-darkmode" href="/search">
            <h3 className="mb-3 text-20">Search</h3>
            <p className="text-sm leading-7 text-muted dark:text-white/60">Search reactions, enzymes, and hosts from one identifier box, or match a substrate and product with Draw structure or Load MOL/SDF.</p>
          </Link>
          <Link className="rounded-[22px] border border-border bg-white p-5 hover:border-primary dark:border-dark_border dark:bg-darkmode" href="/browse">
            <h3 className="mb-3 text-20">Browse</h3>
            <p className="text-sm leading-7 text-muted dark:text-white/60">Reactions, enzymes, and hosts.</p>
          </Link>
          <Link className="rounded-[22px] border border-border bg-white p-5 hover:border-primary dark:border-dark_border dark:bg-darkmode" href="/tools">
            <h3 className="mb-3 text-20">Tools</h3>
            <p className="text-sm leading-7 text-muted dark:text-white/60">Five-tool selection guide with objective input, output, scope, access, and ReactEnzDB connection information.</p>
          </Link>
          <Link className="rounded-[22px] border border-border bg-white p-5 hover:border-primary dark:border-dark_border dark:bg-darkmode" href="/statistics">
            <h3 className="mb-3 text-20">Statistics</h3>
            <p className="text-sm leading-7 text-muted dark:text-white/60">Release-level statistics and figure-ready data summaries.</p>
          </Link>
          <Link className="rounded-[22px] border border-border bg-white p-5 hover:border-primary dark:border-dark_border dark:bg-darkmode" href="/downloads">
            <h3 className="mb-3 text-20">Downloads</h3>
            <p className="text-sm leading-7 text-muted dark:text-white/60">Full release files, table exports, field dictionary, license, and API endpoints.</p>
          </Link>
          <Link className="rounded-[22px] border border-border bg-white p-5 hover:border-primary dark:border-dark_border dark:bg-darkmode" href="/documentation/api">
            <h3 className="mb-3 text-20">API docs</h3>
            <p className="text-sm leading-7 text-muted dark:text-white/60">REST API endpoints, OpenAPI JSON, and curl/Python/R examples for programmatic access.</p>
          </Link>
          <Link className="rounded-[22px] border border-border bg-white p-5 hover:border-primary dark:border-dark_border dark:bg-darkmode" href="/maintenance">
            <h3 className="mb-3 text-20">Maintenance</h3>
            <p className="text-sm leading-7 text-muted dark:text-white/60">Maintainer contact, update schedule, version archive strategy, and issue-reporting policy.</p>
          </Link>
          <Link className="rounded-[22px] border border-border bg-white p-5 hover:border-primary dark:border-dark_border dark:bg-darkmode" href="/methodology">
            <h3 className="mb-3 text-20">Methodology and QA</h3>
            <p className="text-sm leading-7 text-muted dark:text-white/60">Structure-coverage definitions, annotation-richness interpretation, provenance, mapping confidence, automated checks, and limitations.</p>
          </Link>
        </div>
      </section>

      <section className="mb-10">
        <p className="reactenz-eyebrow">FAQ</p>
        <h2 className="reactenz-tools-section-title mb-5">Common questions</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {faqs.map((item) => (
            <details className="rounded-2xl border border-border bg-white p-5 dark:border-dark_border dark:bg-darkmode" key={item.q}>
              <summary className="cursor-pointer text-base font-black text-midnight_text dark:text-white">{item.q}</summary>
              <p className="mt-3 text-sm leading-7 text-muted dark:text-white/60">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="reactenz-card">
        <h2 className="reactenz-tools-section-title mb-4">Contact and feedback</h2>
        <p className="text-sm leading-7 text-muted dark:text-white/60">
          For data corrections, collaboration requests, or citation questions, contact the ReactEnzDB maintainers at <a className="font-black text-primary hover:underline" href="mailto:hlin@uestc.edu.cn">hlin@uestc.edu.cn</a>. Include the record ID, release version, affected page or API route, and supporting PMID/DOI or database identifier. Until the database manuscript is published, cite base release {REACTENZDB_RELEASE.version}{revision ? `, revision ${revision.revision}` : ""}, the exact snapshot identifier and file SHA256. Use the matching downloadable <code>CITATION.cff</code> metadata; local working files and frozen public files have separate identities.
        </p>
      </section>
    </main>
  );
}
