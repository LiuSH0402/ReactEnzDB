import Link from "next/link";
import type { Metadata } from "next";
import Badge from "@/components/ReactEnz/Badge";
import { expressionTierTone } from "@/components/ReactEnz/ExperimentalExpressionEvidence";
import {
  getExpressionEvidenceOverview,
  getExpressionHosts,
  searchExpressionArticles,
  type ExpressionArticleSearch,
} from "@/lib/expressionEvidence";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Expression evidence explorer",
  description: "Search literature-linked heterologous-expression candidates for enzymes, reactions, hosts, solubility, activity, and experimental conditions in ReactEnzDB.",
  alternates: { canonical: "/expression-evidence" },
};

type QueryValue = string | string[] | undefined;
type PageProps = { searchParams: Promise<Record<string, QueryValue>> };

function single(value: QueryValue): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function numberValue(value: QueryValue, fallback: number): number {
  const parsed = Number(single(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function statusLabel(status: string): string {
  return ({
    full_text_parsed_with_expression_candidates: "candidates extracted",
    full_text_parsed_no_expression_candidate: "parsed · no candidate",
    full_text_available_text_recovery_needed: "text recovery needed",
    full_text_unavailable: "full text unavailable",
  } as Record<string, string>)[status] ?? status.replaceAll("_", " ");
}

function queryHref(params: Record<string, QueryValue>, changes: Record<string, string | number>) {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const selected = single(value);
    if (selected) next.set(key, selected);
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value === "") next.delete(key);
    else next.set(key, String(value));
  }
  return `/expression-evidence?${next.toString()}`;
}

function Metric({ value, label, note }: { value: number; label: string; note: string }) {
  return (
    <div className="border-l border-border pl-5 first:border-l-0 first:pl-0 dark:border-dark_border">
      <div className="text-3xl font-black tracking-tight text-midnight_text dark:text-white">{Number(value ?? 0).toLocaleString()}</div>
      <div className="mt-1 text-sm font-black text-midnight_text dark:text-white">{label}</div>
      <div className="mt-1 text-xs leading-5 text-muted">{note}</div>
    </div>
  );
}

function SelectField({ label, name, value, children }: { label: string; name: string; value: string; children: React.ReactNode }) {
  return (
    <label className="text-sm font-bold text-midnight_text dark:text-white">
      {label}
      <select className="mt-2 block w-full border border-border bg-hero-bg px-3 py-3 dark:border-dark_border dark:bg-dark_b" defaultValue={value} name={name}>
        {children}
      </select>
    </label>
  );
}

export default async function ExpressionEvidencePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filters: ExpressionArticleSearch = {
    q: single(params.q), fulltext: single(params.fulltext), tier: single(params.tier), host: single(params.host),
    activity: single(params.activity), solubility: single(params.solubility), review: single(params.review),
    sort: single(params.sort) || "candidates", dir: single(params.dir) || "desc",
    page: numberValue(params.page, 1), pageSize: numberValue(params.pageSize, 20),
  };
  const overview = getExpressionEvidenceOverview();
  const result = searchExpressionArticles(filters);
  const hosts = getExpressionHosts();

  if (!overview) return <main className="reactenz-container py-12">Experimental expression evidence is not mounted on this server.</main>;

  const tiers = [
    ["E1", overview.e1_count, "Active, soluble and exact enzyme"],
    ["E2", overview.e2_count, "Active and exact enzyme"],
    ["E3", overview.e3_count, "Expressed or purified exact enzyme"],
    ["E4", overview.e4_count, "Host–paper link pending identity review"],
  ] as const;

  return (
    <main className="reactenz-container reactenz-page">
      <section className="reactenz-page-intro reactenz-page-compact-hero">
        <p className="reactenz-eyebrow">Literature-linked candidate layer</p>
        <h1>Expression evidence explorer</h1>
        <p className="reactenz-page-copy">
          Search machine-extracted candidates linking an enzyme to a host, then inspect solubility, activity, purification, construct and induction conditions with article-level provenance.
        </p>
      </section>

      <section className="grid gap-5 border-y border-border py-7 dark:border-dark_border md:grid-cols-3 xl:grid-cols-6">
        <Metric value={overview.candidate_articles} label="candidate papers" note="legacy citation-derived screening corpus" />
        <Metric value={overview.fulltext_available} label="full texts" note="identity-verified local copies" />
        <Metric value={overview.articles_with_candidates} label="articles with candidates" note="rule-based extraction" />
        <Metric value={overview.total_candidates} label="expression candidates" note="pending human review" />
        <Metric value={overview.exact_enzyme_candidates} label="exact-enzyme candidates" note="enzyme identity resolved" />
        <Metric value={overview.critical_flagged_candidates} label="critical review flags" note="correction queue" />
      </section>

      <section className="mt-9 grid gap-0 overflow-hidden border-y border-border dark:border-dark_border md:grid-cols-4">
        {tiers.map(([tier, count, description]) => (
          <Link className="group border-b border-border px-5 py-5 transition-colors hover:bg-hero-bg dark:border-dark_border dark:hover:bg-dark_b md:border-b-0 md:border-r md:last:border-r-0" href={queryHref(params, { tier, page: 1 })} key={tier}>
            <div className="flex items-center justify-between gap-3"><Badge tone={expressionTierTone(tier)}>{tier}</Badge><span className="text-2xl font-black text-midnight_text group-hover:text-primary dark:text-white">{count.toLocaleString()}</span></div>
            <p className="mt-3 text-sm leading-6 text-muted">{description}</p>
          </Link>
        ))}
      </section>

      <section className="mt-10" id="articles">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div><p className="reactenz-eyebrow">Article correspondence</p><h2>Search evidence-bearing literature</h2></div>
          <p className="max-w-2xl text-sm leading-6 text-muted">A paper with no extracted candidate is not negative expression evidence. E1–E4 are extraction classes, not success probabilities.</p>
        </div>

        <details className="mb-4 border-y border-border bg-white py-4 dark:border-dark_border dark:bg-darkmode" open={Boolean(filters.q || filters.host || filters.tier || filters.activity || filters.solubility || filters.review)}>
          <summary className="cursor-pointer list-none text-sm font-black uppercase tracking-[0.14em] text-primary">Filter articles and evidence</summary>
          <form action="/expression-evidence" className="mt-5 grid gap-4 lg:grid-cols-4">
            <label className="text-sm font-bold text-midnight_text dark:text-white lg:col-span-2">Article, PMID, DOI, enzyme or reaction
              <input className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b" defaultValue={filters.q} name="q" placeholder="PMID, DOI, title, RHEA/ReactEnz ID, enzyme or host" />
            </label>
            <SelectField label="Article/full-text state" name="fulltext" value={filters.fulltext ?? ""}>
              <option value="">All articles</option><option value="available">Full text available</option><option value="candidates">Candidates extracted</option><option value="no_candidates">Parsed without candidate</option><option value="recovery">Text recovery needed</option><option value="unavailable">Full text unavailable</option>
            </SelectField>
            <SelectField label="Evidence class" name="tier" value={filters.tier ?? ""}>
              <option value="">All classes</option>{["E1", "E2", "E3", "E4"].map((tier) => <option key={tier} value={tier}>{tier}</option>)}
            </SelectField>
            <SelectField label="Expression host" name="host" value={filters.host ?? ""}>
              <option value="">All hosts</option>{hosts.map((host) => <option key={host.host_name} value={host.host_name}>{host.host_name} ({host.candidate_count})</option>)}
            </SelectField>
            <SelectField label="Activity" name="activity" value={filters.activity ?? ""}>
              <option value="">Any activity state</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="unknown">Unknown</option>
            </SelectField>
            <SelectField label="Solubility" name="solubility" value={filters.solubility ?? ""}>
              <option value="">Any solubility state</option><option value="soluble">Soluble</option><option value="insoluble">Insoluble</option><option value="unknown">Unknown</option>
            </SelectField>
            <SelectField label="Review queue" name="review" value={filters.review ?? ""}>
              <option value="">All review states</option><option value="critical">Critical correction</option><option value="high">High/critical flags</option>
            </SelectField>
            <input type="hidden" name="sort" value={filters.sort} /><input type="hidden" name="dir" value={filters.dir} /><input type="hidden" name="pageSize" value={result.pageSize} />
            <div className="flex items-end gap-3 lg:col-span-4"><button className="rounded-xl bg-primary px-5 py-3 font-bold text-white">Apply filters</button><Link className="rounded-xl border border-border px-5 py-3 font-bold dark:border-dark_border" href="/expression-evidence">Reset</Link></div>
          </form>
        </details>

        <div className="mb-3 flex items-center justify-between gap-3 text-sm text-muted"><span>{result.total.toLocaleString()} matching articles</span><span>Page {result.page} of {result.totalPages}</span></div>
        <div className="overflow-x-auto border-y border-border dark:border-dark_border">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="bg-hero-bg text-xs uppercase tracking-[0.1em] text-muted dark:bg-dark_b">
              <tr><th className="px-4 py-4">Article</th><th className="px-4 py-4">Full text</th><th className="px-4 py-4">E1–E4</th><th className="px-4 py-4">Candidates</th><th className="px-4 py-4">Linked records</th><th className="px-4 py-4">Review</th></tr>
            </thead>
            <tbody className="divide-y divide-border dark:divide-dark_border">
              {result.rows.map((article) => (
                <tr className="align-top transition-colors hover:bg-hero-bg/60 dark:hover:bg-dark_b/60" key={article.pmid}>
                  <td className="max-w-xl px-4 py-4"><Link className="font-black leading-6 text-midnight_text hover:text-primary dark:text-white" href={`/expression-evidence/${article.pmid}`}>{article.title || `PMID ${article.pmid}`}</Link><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted"><span>PMID {article.pmid}</span>{article.doi ? <span>{article.doi}</span> : null}<span>{article.journal || "journal not mapped"}</span></div></td>
                  <td className="px-4 py-4"><Badge tone={article.fulltext_status.includes("with_expression") ? "green" : article.fulltext_available ? "amber" : "slate"}>{statusLabel(article.fulltext_status)}</Badge><div className="mt-2 text-xs text-muted">{article.fulltext_source_channel.replaceAll("_", " ")}</div></td>
                  <td className="px-4 py-4"><div className="flex flex-wrap gap-1">{(["E1", "E2", "E3", "E4"] as const).map((tier) => { const value = article[`${tier.toLowerCase()}_count` as "e1_count"]; return value ? <Badge key={tier} tone={expressionTierTone(tier)}>{tier} {value}</Badge> : null; })}</div></td>
                  <td className="px-4 py-4"><div className="text-xl font-black text-midnight_text dark:text-white">{article.expression_candidate_count}</div><div className="mt-1 text-xs text-muted">{article.active_candidate_count} active · {article.soluble_candidate_count} soluble</div></td>
                  <td className="px-4 py-4"><div>{article.reactenz_enzyme_count} enzymes</div><div className="mt-1">{article.reaction_count} reactions</div><div className="mt-1 text-muted">{article.legacy_host_count} hosts</div></td>
                  <td className="px-4 py-4">{article.critical_flagged_candidate_count ? <Badge tone="amber">{article.critical_flagged_candidate_count} critical</Badge> : <Badge tone="slate">pending review</Badge>}<div className="mt-2 text-xs text-muted">{article.qc_flag_count} QC flags</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!result.rows.length ? <p className="border-b border-border py-10 text-center text-muted dark:border-dark_border">No articles match the selected filters.</p> : null}

        <nav className="mt-6 flex items-center justify-between gap-4 text-sm font-black">
          {result.page > 1 ? <Link className="rounded-xl border border-border px-4 py-2.5 hover:border-primary hover:text-primary dark:border-dark_border" href={queryHref(params, { page: result.page - 1 })}>Previous</Link> : <span />}
          <div className="flex items-center gap-2">{[...new Set([1, result.page - 1, result.page, result.page + 1, result.totalPages])].filter((page) => page >= 1 && page <= result.totalPages).map((page) => <Link className={`min-w-10 rounded-xl px-3 py-2.5 text-center ${page === result.page ? "bg-primary text-white" : "border border-border dark:border-dark_border"}`} href={queryHref(params, { page })} key={page}>{page}</Link>)}</div>
          {result.page < result.totalPages ? <Link className="rounded-xl border border-border px-4 py-2.5 hover:border-primary hover:text-primary dark:border-dark_border" href={queryHref(params, { page: result.page + 1 })}>Next</Link> : <span />}
        </nav>
      </section>

      <section className="mt-12 grid gap-8 border-t border-border pt-8 dark:border-dark_border lg:grid-cols-[1fr_340px]">
        <div><p className="reactenz-eyebrow">Interpretation boundary</p><h2 className="mt-2">Evidence, context and prediction stay separate</h2><p className="mt-4 max-w-3xl leading-8 text-muted">Experimental expression evidence records what a publication reports. Host-model context is a separate staging layer for reaction × model mapping. Predicted compatibility is a separate future inference layer. A missing candidate is never displayed as biological failure.</p></div>
        <div className="border-l-2 border-primary pl-5 text-sm leading-7 text-muted"><b className="text-midnight_text dark:text-white">Current release state:</b> machine-extracted candidates are searchable for review and traceability, but none is promoted to a verified experimental assertion until human curation is recorded.</div>
      </section>
    </main>
  );
}
