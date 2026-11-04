import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Badge from "@/components/ReactEnz/Badge";
import { ParentBackLink } from "@/components/ReactEnz/ParentBackLink";
import { expressionTier, expressionTierLabel, expressionTierTone } from "@/components/ReactEnz/ExperimentalExpressionEvidence";
import { getExpressionArticle, type ExpressionCandidateRow } from "@/lib/expressionEvidence";

export const dynamic = "force-dynamic";
type PageProps = { params: Promise<{ pmid: string }> };

function human(value: string | null | undefined): string {
  return value ? value.replaceAll("_", " ") : "not reported";
}

function valueTone(value: string): "green" | "amber" | "slate" {
  if (["active", "soluble", "purified", "detected", "expressed"].includes(value)) return "green";
  if (["inactive", "insoluble", "not_detected"].includes(value)) return "amber";
  return "slate";
}

function excerpt(text: string, limit = 520): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit).trimEnd()}…` : clean;
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><dt className="text-xs font-black uppercase tracking-[0.12em] text-muted">{label}</dt><dd className="mt-1 break-words font-semibold text-midnight_text dark:text-white">{value || "not reported"}</dd></div>;
}

function Condition({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="border-t border-border py-3 first:border-t-0 dark:border-dark_border"><dt className="text-xs font-black uppercase tracking-[0.12em] text-muted">{label}</dt><dd className="mt-1 leading-6 text-midnight_text dark:text-white">{value || "not reported"}</dd></div>;
}

function CandidateOutcome({ candidate }: { candidate: ExpressionCandidateRow }) {
  return <div className="flex flex-wrap gap-2"><Badge tone={valueTone(candidate.expression_detected)}>{human(candidate.expression_detected)}</Badge><Badge tone={valueTone(candidate.solubility)}>{human(candidate.solubility)}</Badge><Badge tone={valueTone(candidate.activity)}>{human(candidate.activity)}</Badge><Badge tone={valueTone(candidate.purification)}>{human(candidate.purification)}</Badge></div>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { pmid } = await params;
  const bundle = getExpressionArticle(pmid);
  if (!bundle) notFound();
  return { title: bundle.article.title ? `${bundle.article.title} · expression evidence` : `PMID ${pmid} · expression evidence`, alternates: { canonical: `/expression-evidence/${pmid}` } };
}

export default async function ExpressionEvidenceArticlePage({ params }: PageProps) {
  const { pmid } = await params;
  const bundle = getExpressionArticle(decodeURIComponent(pmid));
  if (!bundle) notFound();
  const { article, candidates, links, spans, qcFlags } = bundle;
  const sections = [["overview", "Article"], ["candidates", "Expression candidates"], ["boundary", "Interpretation"]] as const;

  return (
    <main className="reactenz-detail reactenz-container py-10">
      <div className="grid gap-8 lg:grid-cols-[230px_1fr]">
        <aside className="h-fit border-border text-sm dark:border-dark_border lg:sticky lg:top-[88px] lg:border-r lg:pr-5">
          <ParentBackLink href="/expression-evidence" label="Expression evidence" />
          <div className="mb-4 text-xs font-black uppercase tracking-[0.16em] text-muted">Expression evidence</div>
          <nav className="space-y-1">{sections.map(([id, label]) => <a className="block border-l-2 border-transparent px-3 py-2 font-semibold text-muted transition hover:border-primary hover:text-primary" href={`#${id}`} key={id}>{label}</a>)}</nav>
        </aside>

        <div className="min-w-0">
          <section className="reactenz-detail-overview scroll-mt-8 border-b border-border pb-8 dark:border-dark_border" id="overview">
            <div className="mb-4 flex flex-wrap gap-2"><Badge tone={article.expression_candidate_count ? "green" : article.fulltext_available ? "amber" : "slate"}>{human(article.fulltext_status)}</Badge><Badge tone="slate">machine extracted · pending review</Badge>{article.critical_flagged_candidate_count ? <Badge tone="amber">critical review required</Badge> : null}</div>
            <p className="text-sm font-black uppercase tracking-[0.16em] text-primary">PMID {article.pmid}</p>
            <h1 className="mt-3 max-w-5xl text-[clamp(2rem,4vw,3.5rem)] leading-[1.08]">{article.title || `Article ${article.pmid}`}</h1>
            <dl className="mt-8 grid gap-x-8 gap-y-5 text-sm md:grid-cols-2 xl:grid-cols-4">
              <Meta label="Journal" value={article.journal} /><Meta label="Publisher" value={article.publisher_group} />
              <Meta label="DOI" value={article.doi ? <a className="text-primary hover:underline" href={`https://doi.org/${article.doi}`} rel="noreferrer" target="_blank">{article.doi}</a> : null} />
              <Meta label="PubMed" value={<a className="text-primary hover:underline" href={`https://pubmed.ncbi.nlm.nih.gov/${article.pmid}/`} rel="noreferrer" target="_blank">Open record</a>} />
              <Meta label="Full-text channel" value={human(article.fulltext_source_channel)} /><Meta label="Extraction state" value={human(article.extraction_status)} />
              <Meta label="Linked enzymes" value={article.reactenz_enzyme_count.toLocaleString()} /><Meta label="Linked reactions" value={article.reaction_count.toLocaleString()} />
            </dl>
            <div className="mt-8 grid gap-4 border-y border-border py-5 dark:border-dark_border md:grid-cols-4">
              <Meta label="Expression candidates" value={article.expression_candidate_count.toLocaleString()} /><Meta label="Active candidates" value={article.active_candidate_count.toLocaleString()} /><Meta label="Soluble candidates" value={article.soluble_candidate_count.toLocaleString()} /><Meta label="QC flags" value={article.qc_flag_count.toLocaleString()} />
            </div>
          </section>

          <section className="reactenz-detail-section scroll-mt-8 border-b border-border py-8 dark:border-dark_border" id="candidates">
            <div className="mb-6"><p className="reactenz-eyebrow">Extracted records</p><h2>Expression candidates</h2><p className="mt-2 max-w-3xl text-sm leading-7 text-muted">Experimental fields are displayed as reported or rule-extracted. Open the publication before using a candidate for laboratory decisions.</p></div>
            {!candidates.length ? <div className="border-l-2 border-amber-400 pl-5 text-sm leading-7 text-muted">No rule-based expression candidate was extracted from this article. This state is not interpreted as inactive, insoluble or failed expression.</div> : null}
            <div className="divide-y divide-border border-y border-border dark:divide-dark_border dark:border-dark_border">
              {candidates.map((candidate, index) => {
                const tier = expressionTier(candidate);
                const candidateLinks = links.filter((row) => row.candidate_id === candidate.candidate_id);
                const candidateSpans = spans.filter((row) => row.candidate_id === candidate.candidate_id);
                const candidateFlags = qcFlags.filter((row) => row.candidate_id === candidate.candidate_id);
                return (
                  <article className="py-8" id={candidate.candidate_id} key={candidate.candidate_id}>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div><div className="flex flex-wrap items-center gap-2"><Badge tone={expressionTierTone(tier)}>{tier}</Badge><span className="text-xs font-black uppercase tracking-[0.12em] text-muted">candidate {index + 1}</span></div><h3 className="mt-3 text-24">{candidate.host_name}</h3><p className="mt-1 text-sm text-muted">{expressionTierLabel(tier)} · {Math.round(candidate.confidence * 100)}% extraction confidence</p></div>
                      <div className="flex flex-col items-end gap-3"><CandidateOutcome candidate={candidate} /><Link className="text-sm font-black text-primary hover:underline" href={`/expression-evidence/record/${candidate.candidate_id}`}>Open evidence record →</Link></div>
                    </div>

                    <div className="mt-6 grid gap-8 lg:grid-cols-[1.25fr_0.75fr]">
                      <div>
                        <h4 className="text-sm font-black uppercase tracking-[0.12em] text-primary">Construct and induction</h4>
                        <dl className="mt-3 grid gap-x-7 md:grid-cols-2">
                          <Condition label="Source organism" value={candidate.source_organism} /><Condition label="Host strain / cell line" value={candidate.strain_or_cell_line} />
                          <Condition label="Vector" value={candidate.vector} /><Condition label="Promoter" value={candidate.promoter} />
                          <Condition label="Tag" value={candidate.tag} /><Condition label="Inducer" value={candidate.inducer} />
                          <Condition label="Induction condition" value={candidate.induction_condition} /><Condition label="Temperature" value={candidate.expression_temperature_c != null ? `${candidate.expression_temperature_c} °C` : null} />
                          <Condition label="Expression time" value={candidate.expression_time_text} /><Condition label="Cofactor supplementation" value={candidate.cofactor_supplementation} />
                          <Condition label="Localization" value={candidate.localization} /><Condition label="Purification" value={human(candidate.purification)} />
                          <Condition label="Yield" value={candidate.yield_text} /><Condition label="Conversion" value={candidate.conversion_text} />
                          <Condition label="Negative result" value={candidate.negative_result_text} /><Condition label="Interpretation" value={human(candidate.success_interpretation)} />
                        </dl>
                      </div>
                      <div>
                        <h4 className="text-sm font-black uppercase tracking-[0.12em] text-primary">ReactEnzDB mapping</h4>
                        <div className="mt-3 divide-y divide-border border-y border-border text-sm dark:divide-dark_border dark:border-dark_border">
                          {candidateLinks.map((link) => <div className="py-4" key={`${link.biopart_id}-${link.reaction_id}-${link.link_method}`}><div className="font-black text-midnight_text dark:text-white">{link.enzyme_name || link.reactenz_enzyme_id || link.biopart_id}</div><div className="mt-2 flex flex-wrap gap-3">{link.reactenz_enzyme_id ? <Link className="font-black text-primary hover:underline" href={`/enzymes/${link.reactenz_enzyme_id}`}>{link.reactenz_enzyme_id}</Link> : null}{link.reactenz_reaction_id ? <Link className="font-black text-primary hover:underline" href={`/reactions/${link.reactenz_reaction_id}`}>{link.reactenz_reaction_id}</Link> : null}</div><div className="mt-2 text-xs text-muted">{human(link.link_method)} · {Math.round(link.match_score * 100)}% mapping score</div></div>)}
                          {!candidateLinks.length ? <div className="py-4 text-muted">No exact enzyme mapping is currently resolved.</div> : null}
                        </div>
                      </div>
                    </div>

                    {candidateSpans.length ? <div className="mt-7"><h4 className="text-sm font-black uppercase tracking-[0.12em] text-primary">Source trace</h4><div className="mt-3 divide-y divide-border border-y border-border dark:divide-dark_border dark:border-dark_border">{candidateSpans.slice(0, 3).map((span) => <blockquote className="py-4 text-sm leading-7 text-muted" key={span.span_id}><div className="mb-2 text-xs font-black uppercase tracking-[0.1em] text-midnight_text dark:text-white">{span.section || "article text"}{span.page_or_table ? ` · ${span.page_or_table}` : ""}</div>“{excerpt(span.evidence_text)}”<div className="mt-2 font-mono text-[11px] text-muted">trace {span.evidence_text_sha256.slice(0, 16)}</div></blockquote>)}</div><p className="mt-2 text-xs leading-5 text-muted">Short source excerpts are shown for verification; consult the publisher or repository version for full context.</p></div> : null}

                    {candidateFlags.length ? <div className="mt-6 flex flex-wrap gap-2">{candidateFlags.map((flag) => <Badge key={flag.flag_code} tone={flag.severity === "critical" || flag.severity === "high" ? "amber" : "slate"}>{flag.severity}: {human(flag.flag_code)}</Badge>)}</div> : null}
                  </article>
                );
              })}
            </div>
          </section>

          <section className="reactenz-detail-section scroll-mt-8 py-8" id="boundary">
            <p className="reactenz-eyebrow">Interpretation boundary</p><h2>How to use this record</h2>
            <div className="mt-5 grid gap-7 lg:grid-cols-3"><Boundary title="Experimental expression evidence">Reports a publication-linked expression observation or candidate and retains its conditions.</Boundary><Boundary title="Host-model context">Staging genome-scale model records and reaction × model mapping; it is not curated-host status.</Boundary><Boundary title="Predicted compatibility">Must remain explicitly labelled as inference and is not part of this experimental layer.</Boundary></div>
            <p className="mt-7 border-l-2 border-primary pl-5 text-sm leading-7 text-muted">This article is currently interpreted as <b className="text-midnight_text dark:text-white">{human(article.evidence_interpretation)}</b>. Machine-extracted candidates remain pending human review.</p>
          </section>
        </div>
      </div>
    </main>
  );
}

function Boundary({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><h3 className="text-20">{title}</h3><p className="mt-2 text-sm leading-7 text-muted">{children}</p></div>;
}
