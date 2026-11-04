import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ParentBackLink } from "@/components/ReactEnz/ParentBackLink";
import { getHostPapers, getHostRegistryPreviewById, safeModelSourceUrl } from "@/lib/hostRegistryPreview";

export const dynamic = "force-dynamic";
type PageProps = { params: Promise<{ hostId: string }> };

function readable(value: string | null): string {
  return value ? value.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase()) : "Not recorded";
}

function identityEvidenceLabel(status: string): string {
  if (status === "PASS_WITH_MODEL_SCOPE_WARNING") return "Identity recorded; model used in this strain context";
  return readable(status);
}

function count(value: number | null): string {
  return value === null ? "Not recorded" : value.toLocaleString();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { hostId } = await params;
  const host = getHostRegistryPreviewById(hostId);
  if (!host) notFound();
  return {
    title: `${host.scientific_name} ${host.strain} · host model preview`,
    description: `Staging host identity and selected model for ${host.scientific_name} ${host.strain}; no reaction–host coverage claim.`,
    alternates: { canonical: `/hosts/${encodeURIComponent(host.host_id)}` },
  };
}

export default async function HostRegistryDetailPage({ params }: PageProps) {
  const { hostId } = await params;
  const host = getHostRegistryPreviewById(hostId);
  if (!host) notFound();
  const sourceUrl = safeModelSourceUrl(host.source_url);
  const papers = getHostPapers(host.host_id);

  return (
    <main className="reactenz-container reactenz-page">
      <ParentBackLink href="/hosts" label="Hosts" />
      <section className="reactenz-page-intro reactenz-page-compact-hero">
        <p className="reactenz-eyebrow">Host model · staging preview</p>
        <h1><i>{host.scientific_name}</i> <span className="not-italic">{host.strain}</span></h1>
        <p className="reactenz-page-copy">Identity, the selected genome-scale model, and recorded publication links. This page does not claim that a ReactEnzDB reaction is native to this host.</p>
      </section>

      <div className="mb-9 border-l-4 border-amber-500 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100" role="status">
        <strong>Not a final curated comparison.</strong> Reaction mapping, host breadth, native coverage and pathway suitability are withheld pending source adjudication and independent review.
      </div>

      <section className="mb-10 grid gap-7 lg:grid-cols-[minmax(200px,.6fr)_minmax(0,1.4fr)] lg:gap-12">
        <div><p className="reactenz-eyebrow">Identity</p><h2 className="mt-1 text-2xl font-black text-midnight_text dark:text-white">Host record</h2></div>
        <div>
        <dl className="border-t border-border dark:border-dark_border">
          <Field label="Scientific name"><i>{host.scientific_name}</i></Field>
          <Field label="Strain">{host.strain}</Field>
          <Field label="Host ID"><code className="font-mono text-xs">{host.host_id}</code></Field>
          <Field label="Identity scope">{readable(host.identity_scope)}</Field>
          <Field label="Identity evidence">{identityEvidenceLabel(host.identity_status)}</Field>
        </dl>
        {host.identity_status.includes("WARNING") ? (
          <p className="mt-4 text-sm leading-7 text-muted">
            The selected model is a species-consensus reconstruction placed in this strain context. It is not a strain-specific genome-scale model of this isolate.
            {host.host_id === "kphaffii_x33" ? " GS115 is the parental strain of X-33 and is recorded as related, not as the same host." : null}
          </p>
        ) : null}
        </div>
      </section>

      <section className="mb-10 grid gap-7 lg:grid-cols-[minmax(200px,.6fr)_minmax(0,1.4fr)] lg:gap-12">
        <div><p className="reactenz-eyebrow">Model provenance</p><h2 className="mt-1 text-2xl font-black text-midnight_text dark:text-white">Selected release</h2><p className="mt-2 text-sm leading-6 text-muted dark:text-white/60">The source model file is not redistributed from this preview. Counts describe the collected model, not matching ReactEnzDB reactions.</p></div>
        <dl className="border-t border-border dark:border-dark_border">
          <Field label="Model"><code className="font-mono text-sm">{host.model_name}</code></Field>
          <Field label="Model scope">{readable(host.model_scope)}</Field>
          <Field label="Version / snapshot">{host.version_ref}</Field>
          <Field label="Source">{sourceUrl ? <a className="font-semibold text-primary hover:underline" href={sourceUrl} rel="noopener noreferrer" target="_blank">Open model file ↗</a> : "Source link unavailable"}</Field>
          <Field label="Acquisition">{readable(host.acquisition_status)}</Field>
          <Field label="Reactions">{count(host.reactions)}</Field>
          <Field label="Metabolites">{count(host.metabolites)}</Field>
          <Field label="Genes">{count(host.genes)}</Field>
          <Field label="Compartments">{count(host.compartments)}</Field>
        </dl>
      </section>

      <section className="mb-10 grid gap-7 lg:grid-cols-[minmax(200px,.6fr)_minmax(0,1.4fr)] lg:gap-12">
        <div>
          <p className="reactenz-eyebrow">Literature</p>
          <h2 className="mt-1 text-2xl font-black text-midnight_text dark:text-white">Recorded papers</h2>
          <p className="mt-2 text-sm leading-6 text-muted dark:text-white/60">Links use the DOI and PubMed identifiers stored with this host model. Opening a paper is not a reaction–host mapping claim.</p>
        </div>
        {papers.length ? (
          <ul className="border-t border-border dark:border-dark_border">
            {papers.map((paper) => (
              <li className="border-b border-border py-4 dark:border-dark_border" key={paper.key}>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{paper.role}</p>
                {paper.hrefs.some((item) => item.label === paper.title) ? null : (
                  <p className="mt-1 text-sm font-semibold leading-6 text-midnight_text dark:text-white">{paper.title}</p>
                )}
                <p className="mt-2 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-sm">
                  {paper.hrefs.map((item) => (
                    <a className="break-all font-semibold text-primary hover:underline" href={item.href} key={item.href} rel="noopener noreferrer" target="_blank">{item.label} ↗</a>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm leading-6 text-muted">No DOI or PubMed identifier is recorded for this host model.</p>}
      </section>

      <section className="mb-10 grid gap-7 border-t border-border pt-7 dark:border-dark_border lg:grid-cols-[minmax(200px,.6fr)_minmax(0,1.4fr)] lg:gap-12">
        <div><p className="reactenz-eyebrow">Rights boundary</p><h2 className="mt-1 text-2xl font-black text-midnight_text dark:text-white">License review</h2></div>
        <div className="text-sm leading-7 text-muted dark:text-white/60"><p>Recorded review status: <strong className="text-midnight_text dark:text-white">{readable(host.license_review_status)}</strong>.</p><p>Commercial-use evidence: {readable(host.commercial_use_status)}. These are evidence labels, not legal permission or authorization to redistribute the model.</p></div>
      </section>

    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid gap-1 border-b border-border py-4 text-sm sm:grid-cols-[170px_1fr] sm:gap-5 dark:border-dark_border"><dt className="font-bold text-midnight_text dark:text-white">{label}</dt><dd className="min-w-0 text-muted dark:text-white/70">{children}</dd></div>;
}
