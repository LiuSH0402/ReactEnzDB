import Link from "next/link";
import type { Metadata } from "next";
import {
  candidateModeDescriptions,
  candidateModeLabels,
  candidateModes,
  getCandidateReactionSummary,
  getCandidateSelectionExample,
  getCandidateSet,
  type CandidateMode,
  type CandidateSelectionRow,
} from "@/lib/candidateSelection";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Reaction-specific enzyme candidate sets",
  description: "Build evidence-aware, non-redundant enzyme candidate sets for a ReactEnzDB reaction.",
  alternates: { canonical: "/sequence-families/candidates" },
};

type Props = { searchParams: Promise<{ reactionId?: string; mode?: string; limit?: string }> };

export default async function CandidateSelectionPage({ searchParams }: Props) {
  const params = await searchParams;
  const example = getCandidateSelectionExample();
  const reactionId = params.reactionId?.trim() ?? "";
  const mode: CandidateMode = candidateModes.includes(params.mode as CandidateMode)
    ? params.mode as CandidateMode
    : "best-supported";
  const limit = Math.min(Math.max(Number(params.limit) || 100, 10), 500);
  const summary = reactionId ? getCandidateReactionSummary(reactionId) : null;
  const rows = summary ? getCandidateSet(reactionId, mode, limit) : [];

  return (
    <main className="reactenz-container reactenz-page">
      <section className="relative overflow-hidden rounded-[30px] bg-[#10233f] px-6 py-10 text-white shadow-[0_28px_70px_rgba(16,35,63,0.18)] sm:px-10 lg:px-14 lg:py-14">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_82%_18%,rgba(48,126,255,0.32),transparent_31%),linear-gradient(120deg,transparent_30%,rgba(255,255,255,0.035)_30.5%,transparent_31%)]" />
        <div className="relative grid gap-8 lg:grid-cols-[1fr_360px] lg:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-300">Reaction-specific candidate workspace</p>
            <h1 className="mt-4 !text-white" style={{ color: "#ffffff" }}>From a crowded enzyme list to an experimental shortlist</h1>
            <p className="mt-4 text-base leading-8 text-slate-200">
              Select a reaction and build one of five downloadable candidate sets. Every row reports family novelty and its nearest enzyme with exact-reaction catalytic evidence.
            </p>
            <p className="mt-3 text-sm leading-7 text-slate-300">This selector was rebuilt on 2026-10-16 using all current sequence-bearing reaction–enzyme pairs. Records without a sequence cannot enter sequence comparison; similarity does not establish catalytic activity.</p>
          </div>
          <div className="border-l border-white/20 pl-5 text-sm leading-6 text-slate-300">
            <div className="font-black text-white">Strict known-active definition</div>
            Same normalized reaction, evidence rank 1 or 2, and at least one catalytic assertion. EC-only annotation is not counted as known activity.
          </div>
        </div>
      </section>

      <section className="mt-8 rounded-[24px] border border-border bg-white p-5 shadow-sm dark:border-dark_border dark:bg-darkmode sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="reactenz-eyebrow">Step 1</p>
            <h2>Choose a reaction</h2>
            <p className="mt-2 text-sm leading-6 text-muted">Use a public ReactEnzDB reaction ID (R…) or an internal reaction ID (OENA…).</p>
          </div>
          <Link href="/sequence-families" className="text-sm font-black text-primary">Browse global sequence families →</Link>
        </div>
        <form className="mt-5 grid gap-3 sm:grid-cols-[minmax(260px,1fr)_150px_auto]">
          <input type="hidden" name="mode" value={mode} />
          <input name="reactionId" defaultValue={reactionId} placeholder={example?.reactenz_reaction_id ?? "R00001"} className="rounded-xl border border-border bg-white px-4 py-3 text-sm font-bold text-midnight_text outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 dark:border-dark_border dark:bg-dark_b dark:text-white" />
          <select name="limit" defaultValue={String(limit)} className="rounded-xl border border-border bg-white px-4 py-3 text-sm font-bold text-midnight_text dark:border-dark_border dark:bg-dark_b dark:text-white">
            <option value="50">Up to 50</option><option value="100">Up to 100</option><option value="200">Up to 200</option><option value="500">Up to 500</option>
          </select>
          <button className="rounded-xl bg-primary px-6 py-3 text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">Build set</button>
        </form>
        {!reactionId && example ? <p className="mt-3 text-xs text-muted">Need a working example? <Link className="font-black text-primary" href={`/sequence-families/candidates?reactionId=${encodeURIComponent(example.reactenz_reaction_id)}&mode=best-supported`}>Open {example.reactenz_reaction_id}</Link>.</p> : null}
        {reactionId && !summary ? <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">No sequence-bearing candidates were found for “{reactionId}”. Check the reaction ID or open a reaction detail page first.</div> : null}
      </section>

      {summary ? <>
        <section className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><p className="reactenz-eyebrow">Step 2</p><h2>Select the experimental intent</h2></div>
            <div className="text-sm text-muted">Reaction <Link className="font-black text-primary" href={`/reactions/${encodeURIComponent(summary.reactenz_reaction_id)}`}>{summary.reactenz_reaction_id}</Link></div>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {candidateModes.map((candidateMode, index) => (
              <Link key={candidateMode} href={`/sequence-families/candidates?reactionId=${encodeURIComponent(summary.reactenz_reaction_id)}&mode=${candidateMode}&limit=${limit}`} className={`group min-h-[168px] rounded-2xl border p-5 transition ${mode === candidateMode ? "border-primary bg-primary text-white shadow-lg" : "border-border bg-white hover:-translate-y-1 hover:border-primary dark:border-dark_border dark:bg-darkmode"}`}>
                <div className={`text-xs font-black uppercase tracking-[0.16em] ${mode === candidateMode ? "text-cyan-100" : "text-primary"}`}>0{index + 1}</div>
                <div className="mt-3 text-base font-black leading-6">{candidateModeLabels[candidateMode]}</div>
                <div className={`mt-2 text-xs leading-5 ${mode === candidateMode ? "text-blue-100" : "text-muted"}`}>{candidateModeDescriptions[candidateMode]}</div>
              </Link>
            ))}
          </div>
        </section>

        <section className="mt-8 border-y border-border py-6 dark:border-dark_border">
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-6 xl:divide-x xl:divide-border dark:xl:divide-dark_border">
            <Metric label="Sequence candidates" value={summary.candidate_count} />
            <Metric label="Known active" value={summary.known_active_count} />
            <Metric label="NR90 families" value={summary.nr90_family_count} />
            <Metric label="NR50 families" value={summary.nr50_family_count} />
            <Metric label="Experimentally structured" value={summary.structured_candidate_count} />
            <Metric label="Selected now" value={rows.length} accent />
          </div>
        </section>

        <section className="mt-9 rounded-[24px] border border-border bg-white p-5 dark:border-dark_border dark:bg-darkmode sm:p-7">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="reactenz-eyebrow">Step 3 · selected output</p>
              <h2>{candidateModeLabels[mode]}</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{candidateModeDescriptions[mode]} Ranked identity and coverage come from Smith–Waterman protein alignment to the nearest strict known-active enzyme for this reaction.</p>
            </div>
            <a href={`/api/reactenzdb/candidate-set?reactionId=${encodeURIComponent(summary.reactenz_reaction_id)}&mode=${mode}&limit=${limit}&format=tsv`} className="rounded-xl bg-[#10233f] px-5 py-3 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-primary">Download this set (.tsv)</a>
          </div>

          {rows.length ? <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[1460px] text-left text-sm">
              <thead className="border-y border-border bg-hero-bg text-xs uppercase tracking-wider text-muted dark:border-dark_border dark:bg-dark_b">
                <tr><th className="px-4 py-3">Candidate</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">Why selected</th><th className="px-4 py-3">Novelty relative to evidence</th><th className="px-4 py-3">Nearest known active</th><th className="px-4 py-3">Identity / coverage</th><th className="px-4 py-3">Shared family</th><th className="px-4 py-3">Direct evidence</th><th className="px-4 py-3">Structure / sites</th></tr>
              </thead>
              <tbody className="divide-y divide-border dark:divide-dark_border">
                {rows.map((row) => <CandidateRow key={row.biopart_id} row={row} />)}
              </tbody>
            </table>
          </div> : <div className="mt-6 rounded-2xl bg-hero-bg p-6 text-sm leading-7 text-muted dark:bg-dark_b">No candidate meets this mode’s strict definition. This is a valid result, not missing data. Try another selection mode to inspect the available candidates.</div>}
        </section>

        <section className="mt-8 grid gap-5 border-l-2 border-primary py-2 pl-5 text-sm leading-7 text-muted lg:grid-cols-2 dark:text-white/60">
          <p><strong className="text-midnight_text dark:text-white">How novelty is assigned.</strong> “Within supported cluster” means shared NR90 membership with a rank 1–2 catalytic enzyme; “same supported NR50 family” is broader; “outside” means no supported enzyme for this reaction occurs in that NR50 family.</p>
          <p><strong className="text-midnight_text dark:text-white">Interpretation boundary.</strong> These categories measure distance from current experimental support. They do not prove new function, activity, specificity, solubility or expression success.</p>
        </section>
      </> : null}
    </main>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return <div className="xl:px-5 first:xl:pl-0"><div className={`text-3xl font-black ${accent ? "text-primary" : "text-midnight_text dark:text-white"}`}>{value.toLocaleString()}</div><div className="mt-1 text-xs font-black uppercase tracking-[0.12em] text-muted">{label}</div></div>;
}

function CandidateRow({ row }: { row: CandidateSelectionRow }) {
  const noveltyTone = row.novelty_class === "within_supported_cluster"
    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
    : row.novelty_class === "same_supported_nr50_family"
      ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200"
      : row.novelty_class === "outside_supported_nr50_families"
        ? "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200"
        : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200";
  return <tr className="align-top transition hover:bg-primary/[0.025]">
    <td className="px-4 py-4"><Link className="font-black text-primary hover:underline" href={`/enzymes/${encodeURIComponent(row.reactenz_enzyme_id)}`}>{row.reactenz_enzyme_id}</Link><div className="mt-1 max-w-[220px] text-xs leading-5 text-muted">{row.enzyme_name || "Unnamed enzyme"}</div></td>
    <td className="px-4 py-4"><div className="max-w-[180px] font-semibold">{row.organism || "Not reported"}</div><div className="mt-1 text-xs text-muted">{row.phylum || "Taxonomy unavailable"}</div></td>
    <td className="px-4 py-4"><div className="max-w-[230px] text-xs leading-5 text-muted">{row.recommendation_reason}</div></td>
    <td className="px-4 py-4"><span className={`inline-block max-w-[220px] rounded-xl px-3 py-2 text-xs font-black leading-5 ${noveltyTone}`}>{row.novelty_label}</span></td>
    <td className="px-4 py-4">{row.nearest_active_enzyme_id ? <><Link className="font-black text-primary" href={`/enzymes/${encodeURIComponent(row.nearest_active_enzyme_id)}`}>{row.nearest_active_enzyme_id}</Link><div className="mt-1 text-xs text-muted">rank {row.nearest_active_evidence_rank} · {prettyEvidence(row.nearest_active_evidence_class)}</div></> : <span className="text-xs text-muted">No strict known-active enzyme for this reaction</span>}</td>
    <td className="px-4 py-4">{row.nearest_active_identity != null ? <><div className="font-black">{row.nearest_active_identity.toFixed(1)}% identity</div><div className="mt-1 text-xs text-muted">Q {row.nearest_active_query_coverage?.toFixed(1)}% · T {row.nearest_active_target_coverage?.toFixed(1)}%</div></> : <span className="text-muted">—</span>}</td>
    <td className="px-4 py-4">{row.nearest_active_shared_level ? <><span className="font-black text-primary">NR{row.nearest_active_shared_level}</span><div className="mt-1 max-w-[160px] truncate font-mono text-xs text-muted">{row.nearest_active_shared_level === 50 ? row.nr50_cluster_id : row.nearest_active_shared_level === 70 ? row.nr70_cluster_id : row.nearest_active_shared_level === 90 ? row.nr90_cluster_id : row.nr100_cluster_id}</div></> : <span className="text-xs text-muted">Outside shared NR50 family</span>}</td>
    <td className="px-4 py-4">{row.is_known_active ? <><span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">known active</span><div className="mt-2 text-xs text-muted">{row.catalytic_assertion_count} catalytic · {row.citation_count} citations</div></> : <span className="text-xs text-muted">No rank 1–2 catalytic assertion</span>}</td>
    <td className="px-4 py-4"><div className="font-semibold">{row.pdb_count} PDB · {row.alphafold_count} AF</div><div className="mt-1 text-xs text-muted">{row.active_site_count} sites · {row.mcsa_count} M-CSA</div></td>
  </tr>;
}

function prettyEvidence(value: string | null) {
  return value ? value.replaceAll("_", " ") : "not reported";
}
