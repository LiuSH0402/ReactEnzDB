import Link from "next/link";
import type { Metadata } from "next";
import { getModelReadySummary, getRetrosynthesisSources, getRetrosynthesisStats } from "@/lib/retrosynthesis";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Biosynthesis planning datasets",
  description: "Model-ready reactions, enzyme-candidate features, and source-attributed external planning resources.",
  alternates: { canonical: "/retrosynthesis" },
};

function number(value: number | undefined): string {
  return Number(value ?? 0).toLocaleString();
}

function Stat({ value, label }: { value: number | undefined; label: string }) {
  return (
    <div className="border-l-2 border-primary pl-4">
      <div className="text-2xl font-black text-midnight_text dark:text-white">{number(value)}</div>
      <div className="mt-1 text-xs font-black uppercase tracking-wider text-muted">{label}</div>
    </div>
  );
}

export default function PlanningDatasetsPage() {
  const model = getModelReadySummary();
  const external = getRetrosynthesisStats();
  const sources = getRetrosynthesisSources();
  const modelTables = model.tables ?? {};

  return (
    <main className="reactenz-container reactenz-page">
      <section className="reactenz-page-compact-hero overflow-hidden lg:p-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_88%_20%,rgba(23,196,167,0.15),transparent_28%),linear-gradient(110deg,rgba(47,115,242,0.09),transparent_46%)]" />
        <div className="relative">
          <p className="reactenz-eyebrow">Downloadable datasets</p>
          <h1>Biosynthesis planning data, kept in clear layers</h1>
          <p className="reactenz-page-copy">
            ReactEnzDB provides model-ready reaction data and enzyme-candidate features. External tool resources remain source-attributed and separate from the curated core.
          </p>
        </div>
      </section>

      <section className="mt-9 grid gap-6 lg:grid-cols-3">
        <article className="border-t-4 border-primary bg-white px-1 py-6 dark:bg-darkmode">
          <p className="reactenz-eyebrow">Model-ready</p>
          <h2 className="mt-2 text-[25px]">Canonical reactions</h2>
          <p className="mt-3 text-sm leading-7 text-muted dark:text-white/60">Reaction structures, quality flags, and linked enzyme-candidate features for downstream model construction.</p>
        </article>
        <article className="border-t-4 border-green bg-white px-1 py-6 dark:bg-darkmode">
          <p className="reactenz-eyebrow">Host context</p>
          <h2 className="mt-2 text-[25px]">Staging host-model records</h2>
          <p className="mt-3 text-sm leading-7 text-muted dark:text-white/60">Current host-model work lives under Hosts. It is a staging 30-model registry, not a curated-host catalog.</p>
        </article>
        <article className="border-t-4 border-midnight_text bg-white px-1 py-6 dark:bg-darkmode">
          <p className="reactenz-eyebrow">External resources</p>
          <h2 className="mt-2 text-[25px]">Rules and route cases</h2>
          <p className="mt-3 text-sm leading-7 text-muted dark:text-white/60">Source-attributed rules, building blocks, and published route cases retained without treating them as new ReactEnzDB evidence.</p>
        </article>
      </section>

      <section className="mt-10 grid gap-7 border-t border-border pt-9 dark:border-dark_border lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <p className="reactenz-eyebrow">Model-ready dataset</p>
          <h2 className="mt-2">Reaction and enzyme-candidate matrices</h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-muted dark:text-white/60">
            The default trainable view uses complete canonical structures, formula-balance checks, non-currency-only transformations, and at least one linked enzyme candidate. These filters describe data preparation, not tool performance.
          </p>
          <div className="mt-7 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <Stat value={modelTables.model_ready_reactions} label="model reactions" />
            <Stat value={modelTables.model_ready_trainable_reactions} label="default trainable" />
            <Stat value={modelTables.model_ready_reaction_compounds} label="reaction compounds" />
            <Stat value={modelTables.model_ready_enzyme_candidates} label="enzyme candidates" />
          </div>
        </div>
        <div className="rounded-[22px] bg-hero-bg p-6 dark:bg-dark_b">
          <h3 className="text-xl font-black text-midnight_text dark:text-white">Access the dataset</h3>
          <div className="mt-5 grid gap-3">
            <a className="rounded-xl bg-primary px-4 py-3 text-center text-sm font-black text-white" href="/api/reactenzdb/release-file?file=model_ready_db">Download model-ready SQLite</a>
            <a className="rounded-xl border border-primary px-4 py-3 text-center text-sm font-black text-primary" href="/api/reactenzdb/model-ready">Query default model-ready view</a>
            <Link className="text-center text-sm font-black text-muted hover:text-primary" href="/downloads">See TSV.GZ files and schema</Link>
          </div>
        </div>
      </section>

      <section className="mt-11 grid gap-7 border-t border-border pt-9 dark:border-dark_border lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <p className="reactenz-eyebrow">External planning resources</p>
          <h2 className="mt-2">Source-attributed, not merged evidence</h2>
          <p className="mt-3 text-sm leading-7 text-muted dark:text-white/60">
            External resources support tool interoperability and model construction. They do not change the evidence status of a ReactEnzDB reaction or enzyme unless an exact identifier or defensible structure match is available.
          </p>
        </div>
        <div>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <Stat value={external.retrobiocat_rules} label="RetroBioCat rules" />
            <Stat value={external.bionavi_rules} label="BioNavi rules" />
            <Stat value={external.bionavi_building_blocks} label="building blocks" />
            <Stat value={external.subnetx_cases} label="SubNetX cases" />
          </div>
          <div className="mt-7 flex flex-wrap gap-2">
            {sources.map((source) => <span className="rounded-full bg-hero-bg px-3 py-1.5 text-xs font-bold text-muted dark:bg-dark_b" key={source.source_name}>{source.source_name}</span>)}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link className="rounded-xl bg-primary px-5 py-3 text-sm font-black text-white" href="/downloads">Download source-attributed files</Link>
            <Link className="rounded-xl border border-primary px-5 py-3 text-sm font-black text-primary" href="/tools">Compare associated tools</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
