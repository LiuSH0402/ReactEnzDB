import Link from "next/link";
import type { Metadata } from "next";
import { clusterThresholds, getSequenceClusterOverview, listSequenceClusters } from "@/lib/sequenceClusters";
import { getCandidateDiversityOverview } from "@/lib/candidateDiversity";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Non-redundant enzyme sequence families",
  description: "Browse ReactEnzDB enzyme candidates as NR100, NR90, NR70, and NR50 sequence clusters with evidence, structure, and taxonomy coverage.",
  alternates: { canonical: "/sequence-families" },
};

type Props = { searchParams: Promise<{ threshold?: string; support?: string }> };

export default async function SequenceFamiliesPage({ searchParams }: Props) {
  const params = await searchParams;
  const threshold = clusterThresholds.includes(Number(params.threshold) as never) ? Number(params.threshold) : 90;
  const allowed = ["all", "experimental", "structure", "diverse", "underexplored"] as const;
  const support = allowed.includes(params.support as never) ? params.support as (typeof allowed)[number] : "all";
  const overview = getSequenceClusterOverview();
  const analysis = getCandidateDiversityOverview();
  const rows = listSequenceClusters({ threshold, support, limit: 150 });
  const rawCandidates = analysis?.distributions.enzyme_candidate_count;
  const nr90Candidates = analysis?.distributions.nr90_cluster_count;

  return (
    <main className="reactenz-container reactenz-page">
      <section className="reactenz-page-panel overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(47,111,239,0.13),transparent_34%),radial-gradient(circle_at_85%_10%,rgba(25,180,160,0.13),transparent_30%)]" />
        <div className="relative">
          <p className="reactenz-eyebrow">Candidate compression layer</p>
          <h1 className="mb-4">Non-redundant enzyme sequence families</h1>
          <p className="reactenz-page-copy">
            The 2026-10-16 clustering rebuild covers {overview[0]?.enzyme_records.toLocaleString() ?? "an unavailable number of"} sequence-bearing enzyme records from the current expanded core. Choose an identity view, inspect its representative, and retain taxonomic or structural diversity without scrolling through hundreds of near-identical proteins.
          </p>
          <div className="mt-6 rounded-2xl border border-amber-300/70 bg-amber-50 p-4 text-sm leading-6 text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
            Sequence similarity is a candidate-selection aid, not proof of identical substrate specificity or catalytic activity. NR90/70/50 use at least 80% bidirectional alignment coverage and are independent views, not a nested hierarchy.
          </div>
        </div>
      </section>

      <section className="mt-8 grid gap-5 rounded-[24px] border border-primary/25 bg-gradient-to-r from-blue-50 to-cyan-50 p-6 dark:from-blue-950/30 dark:to-cyan-950/20 lg:grid-cols-[1fr_auto] lg:items-center lg:p-8">
        <div>
          <p className="reactenz-eyebrow">New · reaction-specific selection</p>
          <h2>Build an experimental enzyme shortlist</h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-muted dark:text-white/60">Choose a reaction, switch among five candidate-selection modes, compare every candidate with its nearest exact-reaction known-active enzyme, inspect evidence-relative novelty, and download the selected set.</p>
        </div>
        <Link href="/sequence-families/candidates" className="rounded-xl bg-[#10233f] px-6 py-3 text-center text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-primary hover:shadow-lg">Open candidate selector →</Link>
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-4">
        {overview.map((item) => (
          <Link key={item.threshold} href={`/sequence-families?threshold=${item.threshold}&support=${support}`} className={`rounded-2xl border p-5 transition ${threshold === item.threshold ? "border-primary bg-primary text-white shadow-lg" : "border-border bg-white hover:border-primary dark:border-dark_border dark:bg-darkmode"}`}>
            <div className="text-xs font-black uppercase tracking-[0.16em] opacity-70">NR{item.threshold}</div>
            <div className="mt-2 text-3xl font-black">{item.clusters.toLocaleString()}</div>
            <div className="mt-1 text-sm font-semibold opacity-75">sequence families</div>
          </Link>
        ))}
      </section>

      {analysis && rawCandidates && nr90Candidates ? <>
        <section className="mt-10 border-y border-border py-7 dark:border-dark_border">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-3xl">
              <p className="reactenz-eyebrow">Redundancy and diversity analysis</p>
              <h2>What candidate compression changes</h2>
              <p className="mt-2 text-sm leading-7 text-muted dark:text-white/60">Reaction-level summaries distinguish raw enzyme records, exact sequences, distant families, reaction-specific evidence, and structure-supported candidates.</p>
            </div>
            <Link className="text-sm font-black text-primary" href="/api/reactenzdb/release-file?file=candidate_diversity_summary">Download analysis summary →</Link>
          </div>
          <div className="mt-7 grid gap-6 sm:grid-cols-2 xl:grid-cols-5 xl:divide-x xl:divide-border dark:xl:divide-dark_border">
            <AnalysisMetric label="Raw candidates / reaction" value={rawCandidates.mean.toFixed(2)} note={`median ${rawCandidates.median.toFixed(0)}; p90 ${rawCandidates.p90.toFixed(0)}`} />
            <AnalysisMetric label="NR90 families / reaction" value={nr90Candidates.mean.toFixed(2)} note={`median ${nr90Candidates.median.toFixed(0)}; p90 ${nr90Candidates.p90.toFixed(0)}`} />
            <AnalysisMetric label="Multiple NR70 families" value={analysis.counts.multipleNr70.toLocaleString()} note={`${percent(analysis.counts.multipleNr70 / analysis.counts.reactions)} of sequence-covered reactions`} />
            <AnalysisMetric label="Exact reaction evidence" value={analysis.counts.exactSubstrateProduct.toLocaleString()} note="exact substrate/product experimental support" />
            <AnalysisMetric label="Multimodal reactions" value={analysis.counts.multimodal.toLocaleString()} note="reaction evidence plus PDB or AlphaFold coverage" />
          </div>
        </section>

        <section className="mt-10 grid gap-10 2xl:grid-cols-[1.45fr_0.55fr]">
          <div>
            <p className="reactenz-eyebrow">Identity threshold comparison</p>
            <h2>Compression retains evidence unevenly</h2>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-muted dark:text-white/60">Each row is an independent MMseqs2 view. Representative retention reports whether the selected family representative itself retains the evidence available somewhere in that family.</p>
            <div className="mt-5 overflow-x-auto border-y border-border dark:border-dark_border">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-hero-bg text-xs uppercase tracking-wider text-muted dark:bg-dark_b"><tr><th className="px-4 py-3">View</th><th className="px-4 py-3">Families</th><th className="px-4 py-3">Compression</th><th className="px-4 py-3">Mean / median per reaction</th><th className="px-4 py-3">Kinetic families</th><th className="px-4 py-3">PDB families</th><th className="px-4 py-3">AlphaFold families</th><th className="px-4 py-3">Representative retention, kinetic / PDB</th></tr></thead>
                <tbody className="divide-y divide-border dark:divide-dark_border">
                  {analysis.thresholds.map((row) => <tr key={row.threshold} className="align-top transition hover:bg-primary/[0.025]">
                    <td className="px-4 py-4 font-black text-primary">NR{row.threshold}</td>
                    <td className="px-4 py-4 font-bold">{row.cluster_count.toLocaleString()}</td>
                    <td className="px-4 py-4"><div className="font-bold">{percent(row.compression_fraction_vs_enzyme_records)}</div><div className="mt-2 h-1.5 w-28 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10"><div className="h-full rounded-full bg-primary transition-all" style={{ width: percent(row.compression_fraction_vs_enzyme_records) }} /></div></td>
                    <td className="px-4 py-4">{row.mean_clusters_per_reaction.toFixed(2)} / {row.median_clusters_per_reaction.toFixed(0)}</td>
                    <td className="px-4 py-4">{row.clusters_with_kinetic_support.toLocaleString()}</td>
                    <td className="px-4 py-4">{row.clusters_with_pdb_support.toLocaleString()}</td>
                    <td className="px-4 py-4">{row.clusters_with_alphafold_support.toLocaleString()}</td>
                    <td className="px-4 py-4">{percent(row.kinetic_supported_cluster_representative_retention)} / {percent(row.pdb_supported_cluster_representative_retention)}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>
          </div>

          <aside>
            <p className="reactenz-eyebrow">Reaction-supported taxonomy</p>
            <h2>Candidate evidence spans multiple phyla</h2>
            <p className="mt-2 text-sm leading-7 text-muted dark:text-white/60">Counts require experimental support plus reaction-specific kinetic or exact external kinetic evidence.</p>
            <div className="mt-5 divide-y divide-border border-y border-border dark:divide-dark_border dark:border-dark_border">
              {analysis.taxonomy.slice(0, 8).map((row) => <div key={row.phylum} className="grid grid-cols-[1fr_auto] gap-4 py-3 text-sm">
                <div><div className="font-black text-midnight_text dark:text-white">{row.phylum}</div><div className="mt-1 text-xs text-muted">{row.species_count.toLocaleString()} species · {row.reaction_count.toLocaleString()} reactions</div></div>
                <div className="text-right"><div className="font-black text-primary">{row.enzyme_candidate_count.toLocaleString()}</div><div className="mt-1 text-xs text-muted">candidates</div></div>
              </div>)}
            </div>
          </aside>
        </section>

        <section className="mt-8 border-l-2 border-amber-500 py-2 pl-5 text-sm leading-7 text-muted dark:text-white/60">
          Reaction and kinetic coverage use the final standardized BRENDA, SABIO-RK, and ReactEnzDB-core evidence projection. EC-only and contextual BRENDA records are excluded from reaction-supported claims. AlphaFold coverage indicates predicted structure availability and remains separate from experimental PDB evidence. The four identity views are independent and are not interpreted as a nested phylogeny.
        </section>
      </> : null}

      <section className="mt-8 rounded-[24px] border border-border bg-white p-6 dark:border-dark_border dark:bg-darkmode">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="reactenz-eyebrow">NR{threshold} representative table</p>
            <h2>Choose the candidate set you need</h2>
          </div>
          <form className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="threshold" value={threshold} />
            <label className="text-xs font-black uppercase tracking-wider text-muted">Selection intent
              <select name="support" defaultValue={support} className="mt-2 block rounded-xl border border-border bg-white px-4 py-3 text-sm font-bold text-midnight_text dark:border-dark_border dark:bg-dark_b dark:text-white">
                <option value="all">Best-supported representatives</option>
                <option value="experimental">Experimental support</option>
                <option value="structure">Structurally characterized</option>
                <option value="diverse">Taxonomically diverse</option>
                <option value="underexplored">Underexplored families</option>
              </select>
            </label>
            <button className="rounded-xl bg-primary px-5 py-3 text-sm font-black text-white">Apply</button>
          </form>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[1120px] text-left text-sm">
            <thead className="border-y border-border bg-hero-bg text-xs uppercase tracking-wider text-muted dark:border-dark_border dark:bg-dark_b">
              <tr><th className="px-4 py-3">Representative</th><th className="px-4 py-3">Enzymes / sequences</th><th className="px-4 py-3">Species / phyla</th><th className="px-4 py-3">Experimental</th><th className="px-4 py-3">Kinetics</th><th className="px-4 py-3">PDB / AlphaFold</th><th className="px-4 py-3">Functional sites</th><th className="px-4 py-3">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-border dark:divide-dark_border">
              {rows.map((row) => (
                <tr key={row.cluster_id} className="align-top hover:bg-primary/[0.025]">
                  <td className="px-4 py-4"><Link className="font-black text-primary hover:underline" href={`/enzymes/${encodeURIComponent(row.representative_enzyme_id)}`}>{row.representative_enzyme_id}</Link><div className="mt-1 max-w-[220px] truncate font-mono text-xs text-muted">{row.cluster_id}</div></td>
                  <td className="px-4 py-4 font-semibold">{row.enzyme_record_count.toLocaleString()} / {row.unique_sequence_count.toLocaleString()}</td>
                  <td className="px-4 py-4">{row.species_count.toLocaleString()} / {row.phylum_count.toLocaleString()}<div className="mt-1 text-xs text-muted">Shannon {row.taxonomy_shannon.toFixed(2)}</div></td>
                  <td className="px-4 py-4 font-bold">{row.experimental_supported_count.toLocaleString()}</td>
                  <td className="px-4 py-4">{row.kinetic_supported_count.toLocaleString()}</td>
                  <td className="px-4 py-4">{row.pdb_supported_count.toLocaleString()} / {row.alphafold_supported_count.toLocaleString()}</td>
                  <td className="px-4 py-4">{row.active_site_supported_count.toLocaleString()}</td>
                  <td className="px-4 py-4"><span className={`rounded-full px-3 py-1 text-xs font-black ${row.underexplored ? "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"}`}>{row.underexplored ? "underexplored" : "supported"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm text-muted"><span>Showing the first {rows.length.toLocaleString()} ranked families.</span><Link className="font-black text-primary" href="/downloads#sequence-clusters">Download complete cluster and member tables →</Link></div>
      </section>
    </main>
  );
}

function AnalysisMetric({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="xl:px-6 first:xl:pl-0"><div className="text-xs font-black uppercase tracking-[0.12em] text-muted">{label}</div><div className="mt-2 text-3xl font-black text-midnight_text dark:text-white">{value}</div><div className="mt-2 text-xs leading-5 text-muted">{note}</div></div>;
}

function percent(value: number) { return `${(value * 100).toFixed(1)}%`; }
