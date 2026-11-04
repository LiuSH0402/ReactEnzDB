import Link from "next/link";
import type { Metadata } from "next";
import { ParentBackLink } from "@/components/ReactEnz/ParentBackLink";
import { getHostRegistryPreview, type HostRegistryPreviewRow } from "@/lib/hostRegistryPreview";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Compare host model records · staging preview",
  description: "Side-by-side host identity and selected model records; no reaction coverage or host suitability comparison.",
  alternates: { canonical: "/hosts/compare" },
};

type PageProps = { searchParams: Promise<{ a?: string | string[]; b?: string | string[] }> };

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function display(value: string | number | null): string {
  if (value === null || value === "") return "Not recorded";
  return typeof value === "number" ? value.toLocaleString() : value.replaceAll("_", " ");
}

function recordName(row: HostRegistryPreviewRow): string {
  return `${row.scientific_name} · ${row.strain}`;
}

export default async function HostModelComparePage({ searchParams }: PageProps) {
  const registry = getHostRegistryPreview();
  const params = await searchParams;
  const aId = one(params.a);
  const bId = one(params.b);
  const a = registry?.find((row) => row.host_id === aId);
  const b = registry?.find((row) => row.host_id === bId);
  const selected = a && b && a.host_id !== b.host_id;
  const fields: Array<{ label: string; value: (row: HostRegistryPreviewRow) => string | number | null }> = [
    { label: "Strain", value: (row) => row.strain },
    { label: "Model", value: (row) => row.model_name },
    { label: "Version / snapshot", value: (row) => row.version_ref },
    { label: "Model scope", value: (row) => row.model_scope },
    { label: "Model reactions", value: (row) => row.reactions },
    { label: "Model metabolites", value: (row) => row.metabolites },
    { label: "Model genes", value: (row) => row.genes },
    { label: "License review", value: (row) => row.license_review_status },
  ];

  return (
    <main className="reactenz-container reactenz-page">
      <ParentBackLink href="/hosts" label="Hosts" />
      <section className="reactenz-page-intro reactenz-page-compact-hero">
        <p className="reactenz-eyebrow">Host Context · staging preview</p>
        <h1>Compare model records</h1>
        <p className="reactenz-page-copy">Compare two selected host identities and collected model records. Reaction overlap, native coverage, Jaccard similarity and host suitability are not available here.</p>
      </section>

      <div className="mb-9 border-l-4 border-amber-500 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100" role="status">
        <strong>Interpretation boundary.</strong> Larger models are not evidence that a host can implement a specific reaction or pathway.
      </div>

      {registry ? (
        <>
          <form action="/hosts/compare" className="mb-8 grid gap-4 border-b border-border pb-7 dark:border-dark_border lg:grid-cols-[1fr_1fr_auto] lg:items-end" method="get">
            <HostSelect label="First host" name="a" options={registry} selected={aId} />
            <HostSelect label="Second host" name="b" options={registry} selected={bId} />
            <button className="rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#173552] focus:outline-none focus:ring-2 focus:ring-primary/30" type="submit">Compare records</button>
          </form>
          {selected ? (
            <section aria-label="Side-by-side host model metadata" className="mb-10 overflow-x-auto">
              <table className="w-full min-w-[620px] border-t border-border text-left text-sm dark:border-dark_border">
                <thead><tr className="border-b border-border dark:border-dark_border"><th className="w-[180px] py-4 pr-5 text-xs uppercase tracking-[0.1em] text-muted">Model field</th><th className="py-4 pr-5"><Link className="font-bold text-primary hover:underline" href={`/hosts/${a.host_id}`}>{recordName(a)}</Link></th><th className="py-4"><Link className="font-bold text-primary hover:underline" href={`/hosts/${b.host_id}`}>{recordName(b)}</Link></th></tr></thead>
                <tbody>{fields.map(({ label, value }) => <tr className="border-b border-border align-top dark:border-dark_border" key={label}><th className="py-4 pr-5 font-semibold text-midnight_text dark:text-white">{label}</th><td className="py-4 pr-5 text-muted dark:text-white/70">{display(value(a))}</td><td className="py-4 text-muted dark:text-white/70">{display(value(b))}</td></tr>)}</tbody>
              </table>
            </section>
          ) : <p className="mb-10 text-sm text-muted" role="status">{aId || bId ? "Select two different records from the list above." : "Select two hosts to inspect their model metadata side by side."}</p>}
        </>
      ) : <section className="mb-10 border-y border-border py-7 dark:border-dark_border" role="status"><h2 className="text-2xl font-black text-midnight_text dark:text-white">Host registry not mounted</h2><p className="mt-2 text-sm text-muted">No model comparison is available in this environment.</p></section>}

    </main>
  );
}

function HostSelect({ label, name, options, selected }: { label: string; name: string; options: HostRegistryPreviewRow[]; selected: string }) {
  return <label className="block text-sm font-bold text-midnight_text dark:text-white">{label}<select className="mt-2 w-full rounded-lg border border-border bg-white px-4 py-2.5 font-normal text-midnight_text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-dark_border dark:bg-darkmode dark:text-white" defaultValue={selected} name={name}><option value="">Choose a host</option>{options.map((row) => <option key={row.host_id} value={row.host_id}>{recordName(row)} · {row.model_name}</option>)}</select></label>;
}
