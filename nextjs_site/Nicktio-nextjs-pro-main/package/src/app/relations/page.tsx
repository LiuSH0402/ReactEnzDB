import Link from "next/link";
import type { Metadata } from "next";
import Badge from "@/components/ReactEnz/Badge";
import { getStats, searchReoRecordsPage } from "@/lib/reactenzdb";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Reaction–Enzyme Associations",
  description: "Browse source-attributed reaction–enzyme associations in ReactEnzDB.",
  alternates: { canonical: "/relations" },
};

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function positiveInt(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function pageHref(params: URLSearchParams, page: number): string {
  const next = new URLSearchParams(params);
  next.set("page", String(page));
  return `/relations?${next.toString()}`;
}

export default async function RelationsPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const q = single(raw.q);
  const reaction = single(raw.reaction);
  const enzyme = single(raw.enzyme);
  const organism = single(raw.organism);
  const hasSequence = single(raw.hasSequence) || "all";
  const sort = single(raw.sort) || "reaction";
  const dir = single(raw.dir) || "asc";
  const page = positiveInt(single(raw.page), 1);
  const pageSize = positiveInt(single(raw.pageSize), 20);
  const result = searchReoRecordsPage({ q, reaction, enzyme, organism, hasSequence, sort, dir, page, pageSize });
  const stats = getStats();
  const current = new URLSearchParams();
  if (q) current.set("q", q);
  if (reaction) current.set("reaction", reaction);
  if (enzyme) current.set("enzyme", enzyme);
  if (organism) current.set("organism", organism);
  if (hasSequence !== "all") current.set("hasSequence", hasSequence);
  if (sort !== "reaction") current.set("sort", sort);
  if (dir !== "asc") current.set("dir", dir);
  current.set("pageSize", String(result.pageSize));
  const first = result.total ? (result.page - 1) * result.pageSize + 1 : 0;
  const last = Math.min(result.total, result.page * result.pageSize);

  return (
    <main className="reactenz-container reactenz-page">
      <section className="reactenz-page-intro reactenz-page-compact-hero">
        <p className="reactenz-eyebrow">Association records</p>
        <h1 className="xl:whitespace-nowrap xl:!text-[52px] 2xl:!text-[58px]">Reaction–Enzyme Associations</h1>
        <p className="reactenz-page-copy">
          Browse {Number(stats.reaction_enzyme_pairs ?? result.total).toLocaleString()} source-attributed links between reactions and enzyme records. Source organism is retained as enzyme provenance, not treated as an engineering host.
        </p>
      </section>

      <section className="mb-6 border-y border-border bg-[linear-gradient(90deg,rgba(237,244,250,0.8),rgba(247,251,253,0.96))] px-5 py-6 dark:border-dark_border dark:bg-dark_b">
        <form action="/relations">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="text-sm font-bold text-midnight_text dark:text-white">Association ID<input className="mt-2 block w-full border border-border bg-white px-4 py-3 dark:border-dark_border dark:bg-darkmode" defaultValue={q} name="q" placeholder="e.g. REO000001" /></label>
            <label className="text-sm font-bold text-midnight_text dark:text-white">Reaction<input className="mt-2 block w-full border border-border bg-white px-4 py-3 dark:border-dark_border dark:bg-darkmode" defaultValue={reaction} name="reaction" placeholder="ID, equation or EC number" /></label>
            <label className="text-sm font-bold text-midnight_text dark:text-white">Enzyme<input className="mt-2 block w-full border border-border bg-white px-4 py-3 dark:border-dark_border dark:bg-darkmode" defaultValue={enzyme} name="enzyme" placeholder="ID, name, gene or protein" /></label>
            <label className="text-sm font-bold text-midnight_text dark:text-white">Source organism<input className="mt-2 block w-full border border-border bg-white px-4 py-3 dark:border-dark_border dark:bg-darkmode" defaultValue={organism} name="organism" placeholder="ID, name or taxonomy" /></label>
          </div>
          <div className="mt-4 grid gap-3 border-t border-primary/10 pt-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_0.7fr_1.3fr] lg:items-end">
          <label className="text-sm font-bold text-midnight_text dark:text-white">
            Sequence
            <select className="mt-2 block w-full border border-border bg-white px-4 py-3 dark:border-dark_border dark:bg-darkmode" defaultValue={hasSequence} name="hasSequence">
              <option value="all">All records</option><option value="yes">Sequence available</option><option value="no">No sequence</option>
            </select>
          </label>
          <label className="text-sm font-bold text-midnight_text dark:text-white">
            Sort by
            <select className="mt-2 block w-full border border-border bg-white px-4 py-3 dark:border-dark_border dark:bg-darkmode" defaultValue={sort} name="sort">
              <option value="reaction">Reaction</option><option value="enzyme">Enzyme</option><option value="organism">Source organism</option><option value="sequence">Sequence length</option>
            </select>
          </label>
          <label className="text-sm font-bold text-midnight_text dark:text-white">
            Rows
            <select className="mt-2 block w-full border border-border bg-white px-4 py-3 dark:border-dark_border dark:bg-darkmode" defaultValue={String(result.pageSize)} name="pageSize">
              <option value="20">20</option><option value="50">50</option><option value="100">100</option>
            </select>
          </label>
          <div className="flex min-h-[72px] items-end justify-between gap-4 border-l border-primary/15 pl-5">
            <div className="hidden pb-1 xl:block">
              <strong className="block text-xl text-midnight_text dark:text-white">{result.total.toLocaleString()}</strong>
              <span className="text-xs font-bold uppercase tracking-[0.12em] text-muted">matched associations</span>
            </div>
            <div className="flex gap-2">
              <button className="rounded-xl bg-primary px-6 py-3 font-bold text-white transition hover:-translate-y-0.5 hover:shadow-lg">Search</button>
              <Link className="rounded-xl border border-border bg-white px-5 py-3 font-bold transition hover:border-primary hover:text-primary dark:border-dark_border dark:bg-darkmode" href="/relations">Reset</Link>
            </div>
          </div>
          </div>
        </form>
      </section>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 dark:border-dark_border">
        <div><strong className="text-sm text-midnight_text dark:text-white">Showing {first.toLocaleString()}–{last.toLocaleString()} of {result.total.toLocaleString()} records</strong><p className="mt-1 text-sm text-muted">Page {result.page.toLocaleString()} of {result.totalPages.toLocaleString()}</p></div>
        <div className="flex gap-2">
          {result.page > 1 ? <Link className="rounded-lg border border-border px-4 py-2 text-sm font-bold dark:border-dark_border" href={pageHref(current, result.page - 1)}>Previous</Link> : <span className="rounded-lg border border-border px-4 py-2 text-sm font-bold opacity-40 dark:border-dark_border">Previous</span>}
          {result.page < result.totalPages ? <Link className="rounded-lg border border-border px-4 py-2 text-sm font-bold dark:border-dark_border" href={pageHref(current, result.page + 1)}>Next</Link> : <span className="rounded-lg border border-border px-4 py-2 text-sm font-bold opacity-40 dark:border-dark_border">Next</span>}
        </div>
      </div>

      <div className="overflow-x-auto rounded-[20px] border border-border bg-white dark:border-dark_border dark:bg-darkmode">
        <table className="w-full min-w-[1440px] text-left text-sm">
          <thead className="bg-hero-bg text-xs uppercase tracking-[0.12em] text-muted dark:bg-dark_b"><tr><th className="px-5 py-4">Association ID</th><th className="px-5 py-4">Reaction</th><th className="px-5 py-4">Enzyme</th><th className="px-5 py-4">Source organism</th><th className="px-5 py-4">Evidence</th><th className="px-5 py-4">Kinetics</th><th className="px-5 py-4">References</th><th className="w-20 px-5 py-4"><span className="sr-only">Open association</span></th></tr></thead>
          <tbody className="divide-y divide-border dark:divide-dark_border">
            {result.rows.map((row) => {
              const organismId = row.reactenz_organism_id ?? "unassigned";
              const detailHref = `/relations/${row.reo_id}`;
              return (
                <tr className="transition-colors hover:bg-primary/[0.035]" key={`${row.reactenz_reaction_id}:${row.reactenz_enzyme_id}:${organismId}`}>
                  <td className="px-5 py-4"><Link className="font-mono font-black text-primary hover:underline" href={detailHref}>{row.reo_id}</Link></td>
                  <td className="px-5 py-4"><span className="font-black text-primary">{row.reactenz_reaction_id}</span><div className="mt-1 max-w-[360px] leading-6 text-muted">{row.reaction_equation_display ?? row.reaction_id}</div>{row.ec_number ? <div className="mt-1 text-xs text-muted">EC {row.ec_number}</div> : null}</td>
                  <td className="px-5 py-4"><span className="font-black text-primary">{row.enzyme_name || row.reactenz_enzyme_id}</span><div className="mt-1 text-muted">{row.gene_name_primary || row.reactenz_enzyme_id}</div></td>
                  <td className="px-5 py-4">{row.reactenz_organism_id ? <span className="font-bold text-midnight_text dark:text-white">{row.organism}</span> : <span className="text-muted">Not assigned</span>}<div className="mt-1 text-xs text-muted">{row.reactenz_organism_id ?? "No source-organism identifier"}</div></td>
                  <td className="px-5 py-4"><Badge tone={row.evidence_level ? "blue" : "slate"}>{row.evidence_level ?? row.source_db ?? "Not curated"}</Badge><div className="mt-1 text-xs text-muted">{row.source_db ?? "Source not reported"}</div></td>
                  <td className="px-5 py-4"><strong className="text-midnight_text dark:text-white">{row.kinetic_count.toLocaleString()}</strong><div className="mt-1 text-xs text-muted">pair-linked records</div></td>
                  <td className="px-5 py-4"><strong className="text-midnight_text dark:text-white">{row.reference_count.toLocaleString()}</strong><div className="mt-1 text-xs text-muted">reaction/enzyme PMIDs</div></td>
                  <td className="px-5 py-4"><Link aria-label={`Open association ${row.reo_id}`} className="reactenz-host-model-arrow" href={detailHref}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6.5 12h11m-4.25-4.25L17.5 12l-4.25 4.25" /></svg></Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
