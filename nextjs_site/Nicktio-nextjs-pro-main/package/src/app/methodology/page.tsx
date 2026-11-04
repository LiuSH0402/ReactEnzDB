import type { Metadata } from "next";
import Link from "next/link";
import { getMethodologyQaStats } from "@/lib/reactenzdb";
import { getExpressionEvidenceOverview } from "@/lib/expressionEvidence";
import { getHostRegistryPreview } from "@/lib/hostRegistryPreview";
import { REACTENZDB_RELEASE } from "@/lib/release";
import { getLocalReleaseRevision } from "@/lib/localReleaseRevision";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Methodology and quality assurance",
  description: "ReactEnzDB record construction, structure-coverage sets, annotation richness, provenance, automated QA, and known limitations.",
  alternates: { canonical: "/methodology" },
};

const comparison = [
  ["RDBSB", "Source reactions, bioparts, source organisms, chassis annotations, kinetics, literature, and field-level evidence", "Reaction-centered web release with stable associations, structure tiers, mapping confidence, and staging host-model context; original records remain source-labelled and are not treated as fully reviewed"],
  ["BRENDA", "Enzyme function, source organism, kinetics, literature", "Reaction-first candidate comparison with linked kinetics, structures, and field-level evidence"],
  ["SABIO-RK", "Curated biochemical reaction kinetics", "External kinetic cross-checks embedded in reaction–enzyme associations"],
  ["M-CSA", "Catalytic mechanisms, steps, catalytic residues, and linked literature", "Mechanism records linked to reaction–enzyme candidates only where identifiers support a match; coverage is limited and is not extrapolated to unmapped enzymes"],
  ["Rhea", "Expert-curated reaction ontology", "Rhea-linked reactions connected to enzyme candidates and design context"],
  ["KEGG", "External record links", "View linked identifiers at the original website"],
  ["MetaCyc", "Source-linked reaction and organism context", "Upstream source terms remain applicable"],
  ["RetroBioCat", "Biocatalytic retrosynthesis rules and workflows", "Source-separated rule/template resources linked to ReactEnzDB only where identifiers support a defensible match"],
  ["OED", "Open enzyme records and sequence-linked annotation", "Reaction-centered organization with structure tiers, kinetics, model-ready tables, and staging host-model context"],
];

const mappingLevels = [
  ["Exact identifier", "Shared UniProt, Rhea, MetaCyc, ChEBI, PubChem, MNXref, PDB, or other eligible explicit identifier", "Use as direct cross-database evidence"],
  ["Record-context match", "Compatible identifiers plus source-organism, substrate, parameter, or literature context", "Use as supporting evidence; inspect the linked source"],
  ["EC-class context", "Shared EC class without an exact reaction or protein identifier", "Use for candidate expansion, not as proof of equivalence"],
  ["Unresolved / not mapped", "Insufficient evidence for a defensible link", "Retained explicitly rather than forced into a match"],
];

function n(value: number): string {
  return value.toLocaleString();
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="border-l-2 border-primary pl-4">
      <div className="text-3xl font-black text-midnight_text dark:text-white">{n(value)}</div>
      <div className="mt-1 text-xs font-black uppercase tracking-[0.13em] text-muted">{label}</div>
    </div>
  );
}

export default function MethodologyPage() {
  const revision = getLocalReleaseRevision();
  const qa = getMethodologyQaStats();
  const expression = getExpressionEvidenceOverview();
  const hosts = getHostRegistryPreview();
  const hostCount = hosts?.length ?? 0;
  const tierEntities = [...new Set(qa.tiers.map((row) => row.entity_type))];

  return (
    <main className="reactenz-container reactenz-page">
      <section className="reactenz-page-panel overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(125deg,rgba(47,111,239,0.12),transparent_42%),radial-gradient(circle_at_86%_12%,rgba(25,180,160,0.14),transparent_30%)]" />
        <div className="relative">
          <p className="reactenz-eyebrow">Methods and release QA</p>
          <h1>How ReactEnzDB records are constructed and qualified</h1>
          <p className="reactenz-page-copy">
            This page defines provenance, structure-availability tiers, association identity, evidence scoring,
            mapping confidence, automated integrity checks, and limitations for base release {REACTENZDB_RELEASE.version} ({REACTENZDB_RELEASE.date}).
            Staging host models are listed as identities, not as a curated-host catalog.
          </p>
        </div>
      </section>

      <section className="mb-10 text-sm leading-7 text-muted dark:text-white/60" aria-label="Release provenance">
        {revision ? <p>Current data revision: {revision.revision}, updated {revision.date}. The earlier reference repair closed 12 orphan kinetic references while preserving kinetic IDs, values, units and PMIDs; it also aligned direction semantics and retained original source labels.</p> : null}
        <p>Equation equality means unspecified direction. A source bidirectional arrow is not a thermodynamic reversibility measurement.</p>
        <p>Derived layers retain their recorded source versions and input metadata. Model-ready subsets, sequence clusters, diversity and candidate selection were rebuilt from the expanded core on 2026-10-16. Host mappings retain their recorded model versions and input populations. Read the <Link className="font-bold text-primary hover:underline" href="/downloads">snapshot and data-layer lineage records</Link> before combining them. Independent dual review and adjudication remain separate from automated release acceptance.</p>
      </section>

      <section className="mb-10">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Stat value={qa.reactions} label="Released reactions" />
          <Stat value={hostCount} label="Staging host models" />
          <Stat value={qa.references} label="Entity references" />
          <Stat value={qa.integrityFailures} label="Core integrity failures" />
        </div>
        <p className="mt-4 text-sm leading-6 text-muted dark:text-white/60 lg:whitespace-nowrap">
          Staging genome-scale model identities for unpublished Host Context preview. These are not association records, source organisms, or chassis annotations.{" "}
          {hostCount ? <Link className="font-bold text-primary hover:underline" href="/hosts">Open host registry</Link> : "The staging registry is not mounted in this environment."}
        </p>
      </section>

      <section className="mb-12 grid gap-8 lg:grid-cols-[0.82fr_1.18fr]">
        <div>
          <p className="reactenz-eyebrow">Record construction</p>
          <h2 className="reactenz-tools-section-title mb-5">From source records to the web release</h2>
          <ol className="grid gap-5 text-sm leading-7 text-muted dark:text-white/60">
            <li><strong className="text-midnight_text dark:text-white">1. Normalize.</strong> Reaction, compound, protein, source-organism, literature, and external identifiers are normalized while source identifiers are retained.</li>
            <li><strong className="text-midnight_text dark:text-white">2. Select structure-capable reactions.</strong> Reactions enter one of the explicit structure-coverage sets shown here.</li>
            <li><strong className="text-midnight_text dark:text-white">3. Build stable association records.</strong> The operational key remains reaction ID + biopart ID + source organism. Source biopart consolidation also considers sequence and source-organism context.</li>
            <li><strong className="text-midnight_text dark:text-white">4. Enrich without overwriting provenance.</strong> Literature, kinetics, UniProt/InterPro/Pfam, structures, MNXref, M-CSA, staging host-model identities, and external validation results remain source-labelled and separate from chassis annotations.</li>
          </ol>
        </div>
        <div className="overflow-hidden rounded-[24px] border border-border bg-white dark:border-dark_border dark:bg-darkmode">
          <div className="border-b border-border p-6 dark:border-dark_border">
            <p className="reactenz-eyebrow">Structure tiers</p>
            <h2 className="reactenz-tools-section-title">Structure coverage does not mean biological correctness</h2>
          </div>
          <div className="grid md:grid-cols-2">
            <div className="p-6 md:border-r md:border-border dark:md:border-dark_border">
              <div className="text-3xl font-black text-primary">{n(qa.gold)}</div>
              <h3 className="mt-2 text-xl">ChEBI-complete structure set</h3>
              <p className="mt-3 text-sm leading-7 text-muted dark:text-white/60">Every participant maps to a ChEBI-normalized compound whose normalization status is <code>complete_structure</code>.</p>
            </div>
            <div className="border-t border-border p-6 md:border-t-0 dark:border-dark_border">
              <div className="text-3xl font-black text-green">{n(qa.silver)}</div>
              <h3 className="mt-2 text-xl">Structure-capable set</h3>
              <p className="mt-3 text-sm leading-7 text-muted dark:text-white/60">Every participant is marked model-structure-capable. The ChEBI-complete set is assigned first, so these records exclude that overlap.</p>
            </div>
          </div>
          <div className="border-t border-border bg-amber-50 px-6 py-4 text-sm leading-6 text-amber-900 dark:border-dark_border dark:bg-amber-950/20 dark:text-amber-100">
            These tiers describe compound-structure usability. They do not assert that a reaction was independently reproduced or manually validated as biologically correct.
          </div>
        </div>
      </section>

      <section className="mb-12 scroll-mt-8 border-y border-border py-8 dark:border-dark_border" id="expression-evidence">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="reactenz-eyebrow">Experimental expression evidence</p>
            <h2 className="reactenz-tools-section-title mb-4">Article-level extraction with explicit review boundaries</h2>
            <p className="text-sm leading-7 text-muted dark:text-white/60">
              Literature is linked to enzymes, reactions, and literature-reported expression hosts, then screened for expression, solubility, activity, purification, construct and induction fields. Those literature hosts are not the staging genome-scale host models. E1–E4 describe the specificity of the extracted candidate; they are not calibrated success probabilities.
            </p>
            <Link className="mt-5 inline-flex rounded-xl bg-primary px-4 py-3 text-sm font-black text-white" href="/expression-evidence">Open expression evidence</Link>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Stat value={expression?.candidate_articles ?? 0} label="Linked articles" />
            <Stat value={expression?.fulltext_available ?? 0} label="Identity-verified full texts" />
            <Stat value={expression?.articles_with_candidates ?? 0} label="Articles with candidates" />
            <Stat value={expression?.total_candidates ?? 0} label="Machine-extracted candidates" />
          </div>
        </div>
        <div className="mt-7 grid gap-5 text-sm leading-7 text-muted dark:text-white/60 lg:grid-cols-3">
          <p><b className="text-midnight_text dark:text-white">Experimental evidence</b><br />A publication-linked observation with retained conditions and source trace.</p>
          <p><b className="text-midnight_text dark:text-white">Host metabolic context</b><br />Staging genome-scale model records and reaction × model mapping; not a curated-host conclusion.</p>
          <p><b className="text-midnight_text dark:text-white">Predicted compatibility</b><br />A future inference layer that must remain explicitly labelled and separate.</p>
        </div>
        <p className="mt-6 border-l-2 border-amber-400 pl-5 text-sm leading-7 text-muted">
          Machine-extracted candidates are provided for traceability and review, not as verified experimental assertions. All candidates await human curation; public downloads exclude PDFs, local paths and bulk verbatim source paragraphs.
        </p>
      </section>

      <section className="mb-12">
        <p className="reactenz-eyebrow">Annotation richness score</p>
        <h2 className="reactenz-tools-section-title mb-3">Annotation richness, not correctness probability</h2>
        <p className="mb-6 text-sm leading-7 text-muted dark:text-white/60">
          Scores combine capped contributions from publication and field PMIDs, kinetic PMIDs, independent cross-reference databases,
          sequence/structure completeness, source-retained chassis annotations, protein annotations, and mechanism evidence. A linked reaction alone does not count as host-context evidence. Strong is &gt;=75, moderate is 45-74,
          and limited is &lt;45. Use the score to prioritize records for inspection, never as a calibrated probability.
        </p>
        <div className="overflow-x-auto rounded-[24px] border border-border bg-white dark:border-dark_border dark:bg-darkmode">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-hero-bg text-xs uppercase tracking-wider text-muted dark:bg-dark_b">
              <tr><th className="px-5 py-4">Entity</th><th className="px-5 py-4">Strong &gt;=75</th><th className="px-5 py-4">Moderate 45-74</th><th className="px-5 py-4">Limited &lt;45</th></tr>
            </thead>
            <tbody className="divide-y divide-border dark:divide-dark_border">
              {tierEntities.map((entity) => (
                <tr key={entity}>
                  <td className="px-5 py-4 font-black capitalize text-midnight_text dark:text-white">{entity}</td>
                  {(["strong", "moderate", "limited"] as const).map((tier) => <td className="px-5 py-4" key={tier}>{n(qa.tiers.find((row) => row.entity_type === entity && row.evidence_tier === tier)?.count ?? 0)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-12 grid gap-8 lg:grid-cols-2">
        <div>
          <p className="reactenz-eyebrow">Traceability</p>
          <h2 className="reactenz-tools-section-title mb-5">Evidence coverage in this release</h2>
          <dl className="divide-y divide-border border-y border-border text-sm dark:divide-dark_border dark:border-dark_border">
            <div className="flex justify-between gap-4 py-4"><dt>Entity references with PMID</dt><dd className="font-black">{n(qa.referencesWithPmid)} / {n(qa.references)}</dd></div>
            <div className="flex justify-between gap-4 py-4"><dt>Attribute evidence with PMID</dt><dd className="font-black">{n(qa.attributeEvidenceWithPmid)} / {n(qa.attributeEvidence)}</dd></div>
            <div className="flex justify-between gap-4 py-4"><dt>Public kinetic records with PMID</dt><dd className="font-black">{n(qa.kineticsWithPmid)} / {n(qa.kinetics)}</dd></div>
            <div className="flex justify-between gap-4 py-4"><dt>SMILES-complete reactions</dt><dd className="font-black">{n(qa.smilesComplete)} / {n(qa.reactions)}</dd></div>
          </dl>
        </div>
        <div>
          <p className="reactenz-eyebrow">Mapping confidence</p>
          <h2 className="reactenz-tools-section-title mb-5">Exact, contextual, and unresolved links stay distinct</h2>
          <div className="divide-y divide-border border-y border-border text-sm dark:divide-dark_border dark:border-dark_border">
            {mappingLevels.map(([level, basis, use]) => (
              <div className="grid gap-2 py-4 sm:grid-cols-[150px_1fr]" key={level}>
                <div className="font-black text-midnight_text dark:text-white">{level}</div>
                <div><p className="leading-6 text-muted dark:text-white/60">{basis}</p><p className="mt-1 font-semibold text-primary">{use}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mb-12">
        <p className="reactenz-eyebrow">Resource positioning</p>
        <h2 className="reactenz-tools-section-title mb-5">What ReactEnzDB adds</h2>
        <div className="overflow-x-auto rounded-[24px] border border-border bg-white dark:border-dark_border dark:bg-darkmode">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="bg-hero-bg text-xs uppercase tracking-wider text-muted dark:bg-dark_b"><tr><th className="px-5 py-4">Resource</th><th className="px-5 py-4">Primary emphasis</th><th className="px-5 py-4">ReactEnzDB distinction</th></tr></thead>
            <tbody className="divide-y divide-border dark:divide-dark_border">
              {comparison.map(([resource, focus, distinction]) => <tr key={resource}><td className="px-5 py-4 font-black text-midnight_text dark:text-white">{resource}</td><td className="px-5 py-4 leading-6 text-muted dark:text-white/60">{focus}</td><td className="px-5 py-4 leading-6 text-muted dark:text-white/60">{distinction}</td></tr>)}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm leading-7 text-muted dark:text-white/60">
          UniProt, ChEBI, PubChem, MNXref, PDB, AlphaFold, InterPro, and Pfam are retained as source-labelled identifiers or structure/family annotations. They appear in mapping confidence and record construction, not as peer databases in this table.
        </p>
      </section>

      <section className="rounded-[24px] border border-amber-200 bg-amber-50 p-6 dark:border-amber-900/50 dark:bg-amber-950/20">
        <p className="reactenz-eyebrow">Declared limitations</p>
        <h2 className="reactenz-tools-section-title mb-4">What this release does not claim</h2>
        <div className="grid gap-3 text-sm leading-7 text-amber-950 dark:text-amber-100 lg:grid-cols-2">
          <p>A deterministic stratified manual-audit worksheet and protocol are downloadable, but the release does not yet report completed blinded review results or an empirical error rate. Completed review must be versioned separately.</p>
          <p>Missing values do not prove biological absence. They may mean not reported, not mapped, not redistributable under source terms, or not yet integrated.</p>
          <p>Predicted or experimental structure support does not by itself prove catalytic activity, host expression, or pathway performance.</p>
          <p>ReactEnzDB does not compare or rank the performance of external planning tools. Tool descriptions are limited to scope, input, output, access, and database connection points.</p>
          <p>Staging host models are identities for unpublished Host Context preview. They are not a curated-host catalog. Model NOT_MAPPED is not biological absence, and ReactEnzDB does not report host FBA, supply, or expression-success scores.</p>
        </div>
      </section>
    </main>
  );
}
