import Link from "next/link";
import type { Metadata } from "next";
import { getHostRegistryPreview, type HostRegistryPreviewRow } from "@/lib/hostRegistryPreview";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Hosts · model registry",
  description: "Host identity and selected genome-scale model releases in ReactEnzDB 2026.09.1. Mapping is a model lookup, not a host recommendation.",
  alternates: { canonical: "/hosts" },
};

type PageProps = { searchParams: Promise<{ q?: string | string[] }> };

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value ?? "").trim();
}

function hostLabel(host: HostRegistryPreviewRow): string {
  return `${host.scientific_name} · ${host.strain}`;
}

export default async function HostsPage({ searchParams }: PageProps) {
  const registry = getHostRegistryPreview();
  const params = await searchParams;
  const query = one(params.q).slice(0, 100);
  const filtered = registry?.filter((host) => {
    const haystack = `${hostLabel(host)} ${host.host_id} ${host.model_name}`.toLocaleLowerCase();
    return !query || haystack.includes(query.toLocaleLowerCase());
  }) ?? [];

  return (
    <main className="reactenz-container reactenz-page">
      <section className="reactenz-page-intro reactenz-page-compact-hero">
        <p className="reactenz-eyebrow">Host records</p>
        <h1>Hosts</h1>
        <p className="reactenz-page-copy">
          Browse 30 host-model identities and their selected genome-scale releases in freeze 2026.09.1. These records are for inspecting whether a reaction is present in a frozen model. They are not curated production hosts and not a ranking. Mapping states are retained; human review of the mapping sample is still empty.
        </p>
      </section>

      {registry ? (
        <>
          <details className="mb-4 rounded-2xl border border-border bg-white p-4 dark:border-dark_border dark:bg-darkmode" open={Boolean(query) || undefined}>
            <summary className="cursor-pointer list-none text-sm font-semibold uppercase tracking-[0.14em] text-primary">▾ Filter hosts</summary>
            <form action="/hosts" className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end" method="get">
              <label className="text-sm font-bold">Search host or model
                <input className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b dark:text-white" defaultValue={query} maxLength={100} name="q" placeholder="Species, strain, model ID…" type="search" />
              </label>
              <button className="rounded-xl bg-primary px-5 py-3 font-bold text-white" type="submit">Apply</button>
              <a className="rounded-xl border border-border px-5 py-3 text-center font-bold dark:border-dark_border" href="/hosts">Reset</a>
            </form>
          </details>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="font-semibold text-midnight_text dark:text-white">
              {filtered.length.toLocaleString()} shown
              <span className="font-normal text-muted"> · {registry.length.toLocaleString()} host identities</span>
            </p>
            <Link className="font-bold text-primary hover:underline" href="/hosts/compare">Compare model records →</Link>
          </div>

          <section aria-label="Host model records" className="mb-8 overflow-hidden rounded-2xl border border-border bg-white dark:border-dark_border dark:bg-darkmode">
            <div className="hidden grid-cols-[minmax(240px,1.4fr)_minmax(180px,1fr)_120px_28px] gap-5 border-b border-border bg-hero-bg px-5 py-4 text-sm text-muted dark:border-dark_border dark:bg-dark_b lg:grid">
              <span>Host identity</span><span>Selected model</span><span>Release</span><span className="sr-only">Open</span>
            </div>
            {filtered.length ? filtered.map((host) => (
              <Link className="group grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 border-b border-border px-5 py-5 last:border-b-0 transition-colors hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-primary dark:border-dark_border dark:hover:bg-white/5 lg:grid-cols-[minmax(240px,1.4fr)_minmax(180px,1fr)_120px_28px] lg:items-center lg:gap-5" href={`/hosts/${encodeURIComponent(host.host_id)}`} key={host.host_id}>
                <div className="min-w-0"><span className="break-words font-bold text-midnight_text group-hover:text-primary dark:text-white"><i>{host.scientific_name}</i> · {host.strain}</span><span className="mt-1 block break-all font-mono text-xs text-muted">{host.host_id}</span></div>
                <div className="min-w-0"><span className="font-mono text-sm font-semibold text-midnight_text dark:text-white">{host.model_name}</span><span className="mt-1 block truncate text-xs text-muted" title={host.version_ref}>{host.version_ref}</span></div>
                <div className="text-xs font-semibold text-muted">2026.09.1</div>
                <span aria-hidden="true" className="hidden text-primary transition-transform group-hover:translate-x-1 lg:block">→</span>
              </Link>
            )) : <p className="px-5 py-10 text-sm text-muted">No host records match these filters.</p>}
          </section>
        </>
      ) : (
        <section className="mb-8 overflow-hidden rounded-2xl border border-border bg-white px-5 py-7 dark:border-dark_border dark:bg-darkmode" role="status">
          <h2 className="text-2xl font-black text-midnight_text dark:text-white">Host registry not mounted</h2>
          <p className="mt-2 text-sm leading-6 text-muted dark:text-white/60">No candidate records are shown in this environment. The released database is not used as a fallback.</p>
        </section>
      )}

    </main>
  );
}
