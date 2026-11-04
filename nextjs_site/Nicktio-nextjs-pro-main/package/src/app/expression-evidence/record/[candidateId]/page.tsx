import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Badge from "@/components/ReactEnz/Badge";
import { ParentBackLink } from "@/components/ReactEnz/ParentBackLink";
import { expressionTier, expressionTierLabel, expressionTierTone } from "@/components/ReactEnz/ExperimentalExpressionEvidence";
import { getExpressionEvidenceRecord } from "@/lib/expressionEvidence";
import { getEnzyme, getOrganism, getReaction, getReactionCompounds } from "@/lib/reactenzdb";

export const dynamic = "force-dynamic";
type PageProps = { params: Promise<{ candidateId: string }> };

function human(value: string | null | undefined): string {
  return value ? value.replaceAll("_", " ") : "not reported";
}

function outcomeTone(value: string | null | undefined): "green" | "amber" | "slate" {
  if (["active", "soluble", "purified", "detected", "expressed", "yes"].includes(value ?? "")) return "green";
  if (["inactive", "insoluble", "not_detected", "no"].includes(value ?? "")) return "amber";
  return "slate";
}

function excerpt(text: string, limit = 360): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit).trimEnd()}…` : clean;
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><dt className="text-xs font-black uppercase tracking-[0.12em] text-muted">{label}</dt><dd className="mt-1 break-words font-semibold text-midnight_text dark:text-white">{value || "not reported"}</dd></div>;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="border-t border-border py-3 first:border-t-0 dark:border-dark_border"><dt className="text-xs font-black uppercase tracking-[0.12em] text-muted">{label}</dt><dd className="mt-1 leading-6 text-midnight_text dark:text-white">{value || "not reported"}</dd></div>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { candidateId } = await params;
  const record = getExpressionEvidenceRecord(decodeURIComponent(candidateId));
  if (!record) notFound();
  const enzyme = record.links.find((link) => link.is_primary)?.enzyme_name ?? record.links[0]?.enzyme_name;
  return {
    title: `${enzyme || "Enzyme"} in ${record.candidate.host_name} · expression evidence`,
    alternates: { canonical: `/expression-evidence/record/${encodeURIComponent(candidateId)}` },
  };
}

export default async function ExpressionEvidenceRecordPage({ params }: PageProps) {
  const { candidateId } = await params;
  const record = getExpressionEvidenceRecord(decodeURIComponent(candidateId));
  if (!record) notFound();

  const { article, candidate, links, spans, qcFlags, sourceOrganisms } = record;
  const tier = expressionTier(candidate);
  const primaryLink = links.find((link) => link.is_primary) ?? links[0];
  const primaryEnzyme = primaryLink ? getEnzyme(primaryLink.reactenz_enzyme_id || primaryLink.biopart_id) : null;
  const enzymeLabel = primaryEnzyme?.enzyme_name || primaryLink?.enzyme_name || primaryLink?.reactenz_enzyme_id || "Enzyme identity pending review";
  const sourceNames = [...new Set([
    ...sourceOrganisms.map((row) => row.source_organism),
    ...(candidate.source_organism ? [candidate.source_organism] : []),
  ])];
  const sourceRecords = sourceNames.map((name) => ({ name, record: getOrganism(name) }));
  const reactionViews = [...new Map(links.filter((link) => link.reaction_id).map((link) => [link.reaction_id, link])).values()]
    .slice(0, 8)
    .map((link) => ({
      link,
      reaction: getReaction(link.reactenz_reaction_id || link.reaction_id || ""),
      compounds: link.reaction_id ? getReactionCompounds(link.reaction_id) : [],
    }));
  const sections = [
    ["identity", "Identity"], ["expression", "Expression system"], ["outcome", "Outcome"],
    ["reaction", "Catalytic mapping"], ["source", "Source trace"], ["review", "Review status"],
  ] as const;

  return (
    <main className="reactenz-detail reactenz-container py-10">
      <div className="grid gap-8 lg:grid-cols-[230px_1fr]">
        <aside className="h-fit border-border text-sm dark:border-dark_border lg:sticky lg:top-[88px] lg:border-r lg:pr-5">
          <ParentBackLink href="/expression-evidence" label="Expression evidence" />
          <div className="mb-4 text-xs font-black uppercase tracking-[0.16em] text-muted">Expression evidence record</div>
          <nav className="space-y-1">{sections.map(([id, label]) => <a className="block border-l-2 border-transparent px-3 py-2 font-semibold text-muted transition hover:border-primary hover:text-primary" href={`#${id}`} key={id}>{label}</a>)}</nav>
          <Link className="mt-5 block border-t border-border pt-4 font-black text-primary dark:border-dark_border" href={`/expression-evidence/${article.pmid}`}>← Source article</Link>
        </aside>

        <div className="min-w-0">
          <section className="reactenz-detail-overview border-b border-border pb-8 dark:border-dark_border">
            <div className="mb-4 flex flex-wrap gap-2">
              <Badge tone={expressionTierTone(tier)}>{tier}</Badge>
              <Badge tone="slate">machine extracted · pending review</Badge>
              <Badge tone="blue">{Math.round(candidate.confidence * 100)}% extraction confidence</Badge>
            </div>
            <p className="text-sm font-black uppercase tracking-[0.16em] text-primary">Expression evidence candidate</p>
            <h1 className="mt-3 max-w-5xl text-[clamp(2rem,4vw,3.5rem)] leading-[1.08]">{enzymeLabel} in {candidate.host_name}</h1>
            <p className="mt-4 font-mono text-xs text-muted">{candidate.candidate_id}</p>
          </section>

          <section className="reactenz-detail-section scroll-mt-8 border-b border-border py-8 dark:border-dark_border" id="identity">
            <p className="reactenz-eyebrow">What this record connects</p><h2 className="mt-2">Enzyme, source and host identity</h2>
            <dl className="mt-6 grid gap-x-8 gap-y-5 text-sm md:grid-cols-2 xl:grid-cols-4">
              <Meta label="Enzyme" value={primaryLink?.reactenz_enzyme_id ? <Link className="text-primary hover:underline" href={`/enzymes/${primaryLink.reactenz_enzyme_id}`}>{enzymeLabel}</Link> : enzymeLabel} />
              <Meta label="UniProt" value={primaryEnzyme?.uniprot_accession ? <a className="text-primary hover:underline" href={primaryEnzyme.uniprot_url || `https://www.uniprot.org/uniprotkb/${primaryEnzyme.uniprot_accession}`} rel="noreferrer" target="_blank">{primaryEnzyme.uniprot_accession}</a> : null} />
              <Meta label="Source organism" value={sourceRecords.length ? <span className="flex flex-wrap gap-x-2">{sourceRecords.map(({ name, record: organism }) => organism ? <Link className="text-primary hover:underline" href={`/organisms/${organism.reactenz_organism_id}`} key={name}>{name}</Link> : <span key={name}>{name}</span>)}</span> : null} />
              <Meta label="Expression host" value={<Link className="text-primary hover:underline" href={`/chassis?q=${encodeURIComponent(candidate.host_name)}`}>{candidate.host_name}</Link>} />
              <Meta label="Host strain / cell line" value={candidate.strain_or_cell_line} />
              <Meta label="PMID" value={<Link className="text-primary hover:underline" href={`/expression-evidence/${article.pmid}`}>{article.pmid}</Link>} />
              <Meta label="DOI" value={article.doi ? <a className="text-primary hover:underline" href={`https://doi.org/${article.doi}`} rel="noreferrer" target="_blank">{article.doi}</a> : null} />
              <Meta label="Evidence class" value={`${tier} · ${expressionTierLabel(tier)}`} />
            </dl>
          </section>

          <section className="reactenz-detail-section scroll-mt-8 border-b border-border py-8 dark:border-dark_border" id="expression">
            <p className="reactenz-eyebrow">Reported or rule-extracted fields</p><h2 className="mt-2">Expression system and conditions</h2>
            <dl className="mt-5 grid gap-x-8 md:grid-cols-2">
              <Field label="Expression mode" value={human(candidate.expression_mode)} /><Field label="Vector" value={candidate.vector} />
              <Field label="Promoter" value={candidate.promoter} /><Field label="Tag" value={candidate.tag} />
              <Field label="Inducer" value={candidate.inducer} /><Field label="Induction condition" value={candidate.induction_condition} />
              <Field label="Expression temperature" value={candidate.expression_temperature_c != null ? `${candidate.expression_temperature_c} °C` : null} /><Field label="Expression time" value={candidate.expression_time_text} />
              <Field label="Localization" value={candidate.localization} /><Field label="Cofactor supplementation" value={candidate.cofactor_supplementation} />
            </dl>
          </section>

          <section className="reactenz-detail-section scroll-mt-8 border-b border-border py-8 dark:border-dark_border" id="outcome">
            <p className="reactenz-eyebrow">Observed expression result</p><h2 className="mt-2">Solubility, purification and activity</h2>
            <div className="mt-5 flex flex-wrap gap-2">
              <Badge tone={outcomeTone(candidate.expression_detected)}>expression: {human(candidate.expression_detected)}</Badge>
              <Badge tone={outcomeTone(candidate.solubility)}>solubility: {human(candidate.solubility)}</Badge>
              <Badge tone={outcomeTone(candidate.purification)}>purification: {human(candidate.purification)}</Badge>
              <Badge tone={outcomeTone(candidate.activity)}>activity: {human(candidate.activity)}</Badge>
            </div>
            <dl className="mt-6 grid gap-x-8 md:grid-cols-2">
              <Field label="Yield" value={candidate.yield_text} /><Field label="Conversion" value={candidate.conversion_text} />
              <Field label="Negative result" value={candidate.negative_result_text} /><Field label="Machine interpretation" value={human(candidate.success_interpretation)} />
            </dl>
          </section>

          <section className="reactenz-detail-section scroll-mt-8 border-b border-border py-8 dark:border-dark_border" id="reaction">
            <p className="reactenz-eyebrow">ReactEnzDB cross-reference</p><h2 className="mt-2">Mapped enzymes, substrates and products</h2>
            {!reactionViews.length ? <p className="mt-4 text-sm text-muted">No reaction mapping is resolved for this candidate.</p> : null}
            <div className="mt-5 divide-y divide-border border-y border-border dark:divide-dark_border dark:border-dark_border">
              {reactionViews.map(({ link, reaction, compounds }) => {
                const substrates = compounds.filter((compound) => compound.side === "left").map((compound) => compound.compound_name || compound.compound_id);
                const products = compounds.filter((compound) => compound.side === "right").map((compound) => compound.compound_name || compound.compound_id);
                return <div className="grid gap-5 py-5 lg:grid-cols-[220px_1fr]" key={`${link.candidate_id}-${link.reaction_id}`}>
                  <div><Link className="font-black text-primary hover:underline" href={`/reactions/${link.reactenz_reaction_id || link.reaction_id}`}>{link.reactenz_reaction_id || link.reaction_id}</Link><div className="mt-2 text-xs text-muted">{human(link.link_method)} · {Math.round(link.match_score * 100)}% mapping score</div></div>
                  <div className="text-sm"><div className="font-semibold text-midnight_text dark:text-white">{reaction?.reaction_equation_raw || "Reaction equation not available"}</div><div className="mt-2 text-muted"><b>Substrates:</b> {substrates.join(" + ") || "not mapped"}</div><div className="mt-1 text-muted"><b>Products:</b> {products.join(" + ") || "not mapped"}</div></div>
                </div>;
              })}
            </div>
          </section>

          <section className="reactenz-detail-section scroll-mt-8 border-b border-border py-8 dark:border-dark_border" id="source">
            <p className="reactenz-eyebrow">Article provenance</p><h2 className="mt-2">Source trace</h2>
            <div className="mt-5 divide-y divide-border border-y border-border dark:divide-dark_border dark:border-dark_border">
              {spans.slice(0, 5).map((span) => <blockquote className="py-5 text-sm leading-7 text-muted" key={span.span_id}><div className="mb-2 text-xs font-black uppercase tracking-[0.1em] text-midnight_text dark:text-white">{span.section || "article text"}{span.page_or_table ? ` · ${span.page_or_table}` : ""}</div>“{excerpt(span.evidence_text)}”<div className="mt-2 font-mono text-[11px]">trace {span.evidence_text_sha256.slice(0, 16)}</div></blockquote>)}
              {!spans.length ? <p className="py-5 text-sm text-muted">No source span is available for this candidate.</p> : null}
            </div>
          </section>

          <section className="reactenz-detail-section scroll-mt-8 py-8" id="review">
            <p className="reactenz-eyebrow">Interpretation boundary</p><h2 className="mt-2">Candidate evidence, not yet a curated assertion</h2>
            <p className="mt-4 leading-8 text-muted">This record was extracted from article text and linked to ReactEnzDB entities by rules. It must not be treated as a verified expression success, exact substrate claim or laboratory recommendation until a curator confirms the enzyme form, host, experiment and source passage.</p>
            <div className="mt-5 flex flex-wrap gap-2"><Badge tone="slate">{human(candidate.curation_status)}</Badge>{qcFlags.map((flag) => <Badge key={`${flag.flag_code}-${flag.severity}`} tone={flag.severity === "critical" || flag.severity === "high" ? "amber" : "slate"}>{flag.severity}: {human(flag.flag_code)}</Badge>)}</div>
          </section>
        </div>
      </div>
    </main>
  );
}
