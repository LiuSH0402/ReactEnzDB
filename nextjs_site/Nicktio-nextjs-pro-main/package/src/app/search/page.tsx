import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SearchClearButton } from "@/components/ReactEnz/SearchClearButton";
import { SearchResultsJump } from "@/components/ReactEnz/SearchResultsJump";
import { StructureSearchField } from "@/components/ReactEnz/StructureSearchField";
import { getHostRegistryPreview, type HostRegistryPreviewRow } from "@/lib/hostRegistryPreview";
import { findEnzymeCandidates, parseSearchQuery, searchEnzymesPage, searchReactionsPage } from "@/lib/reactenzdb";
import { structureResultsHref } from "@/lib/transformationSearch";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Search",
  description: "Search ReactEnzDB reactions, enzymes, and staging host models from one identifier box, or match a substrate and product.",
  alternates: { canonical: "/search" },
};

type SearchPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

const inputClass = "w-full rounded-xl border border-border bg-hero-bg px-4 py-3 text-sm text-dark outline-none transition focus:border-primary dark:border-dark_border dark:bg-dark_b dark:text-white";
const labelClass = "mb-2 block text-xs font-black uppercase tracking-[0.16em] text-dark/60 dark:text-white/55";
const buttonClass = "rounded-xl bg-primary px-6 py-3 text-sm font-extrabold text-white transition hover:bg-primary/90";

function matchHosts(hosts: HostRegistryPreviewRow[] | null, query: string): HostRegistryPreviewRow[] {
  if (!hosts || !query) return [];
  const needle = query.toLocaleLowerCase();
  return hosts.filter((host) => `${host.scientific_name} ${host.strain} ${host.host_id} ${host.model_name}`.toLocaleLowerCase().includes(needle)).slice(0, 8);
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = (await searchParams) ?? {};
  const q = (single(params.q) || single(params.reaction) || single(params.enzyme) || single(params.host)).trim();
  const substrates = single(params.substrates).trim();
  const products = single(params.products).trim();
  const parsed = parseSearchQuery(q);
  const structureLookup = Boolean(substrates || products);
  const matchMode = single(params.structureMatch) === "related" ? "related" : "complete";
  const requestedPage = Number(single(params.page));
  const structurePage = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 125_000) : 1;
  const structurePageSize = 8;
  const useTransformation = structureLookup;
  const transformation = useTransformation
    ? findEnzymeCandidates({
        target: "",
        substrates,
        products,
        limit: 24,
        structureOffset: (structurePage - 1) * structurePageSize,
        structureLimit: structurePageSize,
        structureMatchMode: matchMode,
      })
    : null;
  const transformationCandidates = matchMode === "complete" ? transformation?.candidates ?? [] : [];
  const enzymeTarget = matchMode === "complete" ? transformation?.target : null;
  const resultsHref = (page: number, mode: "complete" | "related" = matchMode) =>
    structureResultsHref({ substrates, products, q, matchMode: mode, page });
  const transformationReactions = transformation?.structureSimilarReactions ?? [];
  const transformationReactionTotal = transformation
    ? (structureLookup ? transformation.structureMatchTotal : transformationReactions.length)
    : 0;
  const recordQuery = !useTransformation && q ? q : "";
  const enzymeHits = recordQuery
    ? searchEnzymesPage({
        q: recordQuery,
        uniprot: parsed.kind === "uniprot" ? parsed.value : undefined,
        sort: "completeness",
        dir: "desc",
        limit: 8,
      })
    : null;
  const reactionHits = recordQuery
    ? searchReactionsPage({
        q: parsed.kind !== "empty" ? recordQuery : "",
        sort: "completeness",
        dir: "desc",
        limit: 8,
      })
    : null;
  const enzymeTotal = enzymeHits?.total ?? 0;
  const reactionTotal = reactionHits?.total ?? 0;
  const enzymeNoun = ["reaction_id", "rhea", "kegg", "metacyc"].includes(parsed.kind)
    ? { one: "reaction-linked enzyme", many: "reaction-linked enzymes" }
    : parsed.kind === "ec"
    ? { one: "EC-linked enzyme", many: "EC-linked enzymes" }
    : parsed.kind === "uniprot"
      ? { one: "UniProt match", many: "UniProt matches" }
      : parsed.kind === "chebi"
        ? { one: "ChEBI-linked enzyme", many: "ChEBI-linked enzymes" }
        : { one: "name match", many: "name matches" };
  const reactionNoun = parsed.kind === "reaction_id"
    ? { one: "reaction ID match", many: "reaction ID matches" }
    : parsed.kind === "ec"
    ? { one: "EC-linked reaction", many: "EC-linked reactions" }
    : parsed.kind === "chebi"
      ? { one: "ChEBI-linked reaction", many: "ChEBI-linked reactions" }
      : { one: "text match", many: "text matches" };
  const stagingHosts = getHostRegistryPreview();
  const hostNeedle = !structureLookup ? q : "";
  const hostHits = matchHosts(stagingHosts, hostNeedle);
  const hostHref = hostNeedle ? `/hosts?q=${encodeURIComponent(hostNeedle)}` : "/hosts";
  const hasQuery = Boolean(q || substrates || products);
  const lookupTargets = [
    { title: "Reactions", href: `/reactions?q=${encodeURIComponent(recordQuery)}`, note: "IDs, equations, EC, Rhea, KEGG" },
    { title: "Enzymes", href: `/enzymes?q=${encodeURIComponent(recordQuery)}`, note: "Names, genes, UniProt" },
    {
      title: "Hosts",
      href: hostHref,
      note: "Host candidates. These are not curated metabolic hosts.",
    },
  ];

  const results = (
    <div className="scroll-mt-28" id="search-results">
      {hasQuery ? <SearchResultsJump /> : null}
      {recordQuery ? (
        <section className="mt-9 border-t border-border pt-8 dark:border-dark_border" id="record-results">
          <p className="reactenz-eyebrow">Look up “{recordQuery}”</p>
          <h2 className="mt-2 text-[28px]">Matching records</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {lookupTargets.map((target) => (
              <Link className="group rounded-2xl border border-border bg-white p-4 transition hover:-translate-y-0.5 hover:border-primary dark:border-dark_border dark:bg-darkmode" href={target.href} key={target.title}>
                <div className="font-black text-midnight_text group-hover:text-primary dark:text-white">{target.title}</div>
                <div className="mt-1 text-sm leading-6 text-muted">{target.note}</div>
              </Link>
            ))}
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <ResultCard
              eyebrow="Reactions"
              title={reactionTotal
                ? `${reactionTotal.toLocaleString()} ${reactionTotal === 1 ? reactionNoun.one : reactionNoun.many}`
                : "No reaction match"}
              extra={reactionTotal > (reactionHits?.rows.length ?? 0) ? `Showing ${reactionHits?.rows.length} of ${reactionTotal.toLocaleString()}` : null}
              href={`/reactions?q=${encodeURIComponent(recordQuery)}`}
              hrefLabel="Open reaction list"
            >
              {reactionHits?.rows.length ? (
                <ul className="divide-y divide-border text-sm dark:divide-dark_border">
                  {reactionHits.rows.map((reaction) => (
                    <li className="py-3" key={reaction.reactenz_reaction_id}>
                      <Link className="font-mono font-black text-primary hover:underline" href={`/reactions/${reaction.reactenz_reaction_id}`}>{reaction.reactenz_reaction_id}</Link>
                      <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{reaction.reaction_equation_display ?? "Equation not available"}</div>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm leading-6 text-muted">{parsed.kind === "ec" ? "No reaction is annotated with this EC number or class." : "No reaction record matched this identifier. Use a canonical ID such as R00001."}</p>}
            </ResultCard>
            <ResultCard
              eyebrow="Enzymes"
              title={enzymeTotal
                ? `${enzymeTotal.toLocaleString()} ${enzymeTotal === 1 ? enzymeNoun.one : enzymeNoun.many}`
                : "No enzyme match"}
              extra={enzymeTotal > (enzymeHits?.rows.length ?? 0) ? `Showing ${enzymeHits?.rows.length} of ${enzymeTotal.toLocaleString()}` : null}
              href={`/enzymes?q=${encodeURIComponent(recordQuery)}`}
              hrefLabel="Open enzyme list"
            >
              {enzymeHits?.rows.length ? (
                <ul className="divide-y divide-border text-sm dark:divide-dark_border">
                  {enzymeHits.rows.map((enzyme) => (
                    <li className="py-3" key={enzyme.reactenz_enzyme_id}>
                      <Link className="font-black text-primary hover:underline" href={`/enzymes/${enzyme.reactenz_enzyme_id}`}>{enzyme.reactenz_enzyme_id}</Link>
                      <div className="mt-1 text-midnight_text dark:text-white">{enzyme.enzyme_name ?? "Unnamed enzyme"}</div>
                      <div className="mt-1 text-xs text-muted">{enzyme.gene_name_primary ?? "Gene not reported"}</div>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm leading-6 text-muted">{parsed.kind === "ec" ? "No enzyme is linked to this EC number or class." : "No enzyme record matched this query. Try the enzyme list or a UniProt accession."}</p>}
            </ResultCard>
            <HostResultCard hosts={hostHits} query={hostNeedle} href={hostHref} mounted={Boolean(stagingHosts)} />
          </div>
        </section>
      ) : null}

      {transformation ? (
        <section className="mt-9 border-t border-border pt-8 dark:border-dark_border" id="transformation-results">
          <p className="reactenz-eyebrow">{structureLookup ? "Look up substrate / product" : `Look up “${q}”`}</p>
          <h2 className="mt-2 text-[28px]">Matching records</h2>
          <nav className="mt-4 flex flex-wrap gap-3" aria-label="Structure match mode">
            <Link className="rounded-lg border border-border px-4 py-2 font-bold" aria-current={matchMode === "complete" ? "page" : undefined} href={resultsHref(1, "complete")}>Complete matches</Link>
            <Link className="rounded-lg border border-border px-4 py-2 font-bold" aria-current={matchMode === "related" ? "page" : undefined} href={resultsHref(1, "related")}>Partial or similar candidates</Link>
          </nav>
          <p className="mt-3 text-sm leading-6 text-muted">{matchMode === "complete"
            ? "Every submitted compound must match an exact name, identifier or structure on its specified side. Additional participants may occur; this is not proof of catalysis."
            : "These reactions match only some submitted compounds, a partial name, or a similar structure. They do not establish the submitted transformation or an enzyme assignment."}</p>
          {q ? <p className="mt-2 text-sm text-muted">Structure search uses the substrate and product fields. Clear them to search by the identifier box.</p> : null}
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <ResultCard
              eyebrow="Reactions"
              title={transformationReactionTotal
                ? `${transformationReactionTotal.toLocaleString()} ${matchMode === "complete" ? "complete matches" : "related reactions"}`
                : "No reaction match"}
              extra={transformationReactionTotal ? `Showing ${(structurePage - 1) * structurePageSize + (transformationReactions.length ? 1 : 0)}–${(structurePage - 1) * structurePageSize + transformationReactions.length} of ${transformationReactionTotal.toLocaleString()}` : null}
              href={resultsHref(1)}
              hrefLabel="View matching reactions"
            >
              {transformationReactions.length ? (
                <ul className="divide-y divide-border text-sm dark:divide-dark_border">
                  {transformationReactions.slice(0, 8).map((reaction) => (
                    <li className="py-3" key={reaction.reactenz_reaction_id}>
                      <Link className="font-mono font-black text-primary hover:underline" href={`/reactions/${reaction.reactenz_reaction_id}`}>{reaction.reactenz_reaction_id}</Link>
                      <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{reaction.reaction_equation_display ?? "Equation not available"}</div>
                      <div className="mt-1 text-xs text-muted">{reaction.matched_query_count}/{reaction.query_count} submitted compounds · {reaction.match_methods}</div>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm leading-6 text-muted">No reactions in this match mode. Try the other mode or refine the input.</p>}
              <nav className="mt-4 flex justify-between gap-3 text-sm font-bold" aria-label="Structure result pages">
                {structurePage > 1 ? <Link href={resultsHref(structurePage - 1)}>Previous matches</Link> : <span />}
                {structurePage * structurePageSize < transformationReactionTotal ? <Link href={resultsHref(structurePage + 1)}>Next matches</Link> : null}
              </nav>
            </ResultCard>
            <ResultCard
              eyebrow="Enzymes"
              title={enzymeTarget?.enzyme_count
                ? `${Number(enzymeTarget.enzyme_count).toLocaleString()} linked ${Number(enzymeTarget.enzyme_count) === 1 ? "enzyme" : "enzymes"}`
                : "No enzyme assignment"}
              extra={enzymeTarget ? `From ${enzymeTarget.reactenz_reaction_id}${Number(enzymeTarget.enzyme_count) > transformationCandidates.slice(0, 8).length ? ` · Showing ${transformationCandidates.slice(0, 8).length} of ${Number(enzymeTarget.enzyme_count).toLocaleString()}` : ""}` : null}
              href={enzymeTarget ? `/enzymes?reactionId=${encodeURIComponent(enzymeTarget.reactenz_reaction_id)}&sequence=false` : "/enzymes"}
              hrefLabel="Open enzyme list"
            >
              {transformationCandidates.length ? (
                <ul className="divide-y divide-border text-sm dark:divide-dark_border">
                  {transformationCandidates.slice(0, 8).map((enzyme) => (
                    <li className="py-3" key={enzyme.reactenz_enzyme_id}>
                      <Link className="font-black text-primary hover:underline" href={`/enzymes/${enzyme.reactenz_enzyme_id}`}>{enzyme.reactenz_enzyme_id}</Link>
                      <div className="mt-1 text-midnight_text dark:text-white">{enzyme.enzyme_name ?? "Unnamed enzyme"}</div>
                      <div className="mt-1 text-xs text-muted">{enzyme.gene_name_primary ?? "Gene not reported"}</div>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm leading-6 text-muted">Linked enzymes appear after a reaction match. Open a reaction from the list to see its enzymes.</p>}
            </ResultCard>
            <HostResultCard hosts={hostHits} query={hostNeedle} href={hostHref} mounted={Boolean(stagingHosts)} />
          </div>
          <p className="mt-4 text-sm leading-6 text-muted">{matchMode === "complete" ? "Enzyme names in this panel belong to the first complete match on this page. Open a reaction record to inspect its linked enzymes." : "Partial and similar candidates are shown for exploration only; no enzymes are assigned to the submitted transformation."}</p>
        </section>
      ) : null}
    </div>
  );

  return (
    <main className="reactenz-container reactenz-page">
      {hasQuery ? <h1 className="sr-only">Search results</h1> : null}
      {hasQuery ? null : (
        <section className="reactenz-page-compact-hero overflow-hidden lg:p-8">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_92%_18%,rgba(23,196,167,0.15),transparent_29%),linear-gradient(110deg,rgba(47,115,242,0.09),transparent_48%)]" />
          <div className="relative">
            <p className="reactenz-eyebrow">ReactEnzDB search</p>
            <h1 className="reactenz-search-hero-title">
              <span>Search reactions, enzymes, and hosts</span>
            </h1>
            <p className="reactenz-page-copy reactenz-search-hero-lede">
              The top box searches reactions, enzymes, and staging host models. Open substrate and product fields for a structure search.
            </p>
          </div>
        </section>
      )}

      <section className="mt-9 scroll-mt-28" id="transformation-search">
        <div className={`grid items-stretch gap-7 ${hasQuery ? "" : "lg:grid-cols-[0.7fr_1.3fr]"}`}>
          {hasQuery ? null : (
            <div>
              <p className="reactenz-eyebrow">Search by identifier or structure</p>
              <h2 className="reactenz-search-form-title mt-2">Look up a record</h2>
              <p className="mt-3 text-sm leading-7 text-muted dark:text-white/60">
                Type a reaction ID, EC, enzyme name, UniProt accession, or host-model name in the same box. Names, ChEBI, PubChem, SMILES, and drawn structures are accepted below.
              </p>
              <div className="mt-5 rounded-2xl bg-hero-bg p-4 text-xs leading-6 text-muted dark:bg-dark_b dark:text-white/55">
                Draw or load a chemical file for an exact structure. Pictures of molecules are not converted. Source-organism and chassis-annotation filters stay on those list pages, not in this search box.
              </div>
              <p className="mt-4 text-sm leading-7 text-muted dark:text-white/60">
                If you already have ordered ReactEnzDB reaction IDs and want unreviewed host-model context, open{" "}
                <Link className="font-black text-primary hover:underline" href="/tools/pathway-host-context">Pathway Host Context</Link>
                {" "}under Tools. That page is not a record search.
              </p>
            </div>
          )}
          <form action="/search#search-results" className="flex h-full flex-col gap-4 rounded-[24px] border border-border bg-white p-5 shadow-sm dark:border-dark_border dark:bg-darkmode" key={`${q}|${substrates}|${products}`}>
            <input name="mode" type="hidden" value="transformation" />
            <label className="block">
              <span className={labelClass}>Reaction, enzyme, or host</span>
              <input className={inputClass} defaultValue={q} name="q" placeholder="Reaction ID or EC; enzyme name, gene or UniProt; host or model name" />
            </label>
            <details className="rounded-2xl border border-border px-4 py-3 dark:border-dark_border" open={Boolean(substrates || products) || !q}>
              <summary className="cursor-pointer text-sm font-black text-midnight_text dark:text-white">Match substrate and product</summary>
              <div className="mt-4 grid min-h-0 flex-1 gap-4 md:grid-cols-2">
                <StructureSearchField
                  name="substrates"
                  label="Substrate(s)"
                  defaultValue={substrates}
                  placeholder="Name, ChEBI, PubChem, SMILES, or draw / load a structure"
                />
                <StructureSearchField
                  name="products"
                  label="Product(s)"
                  defaultValue={products}
                  placeholder="Name, ChEBI, PubChem, SMILES, or draw / load a structure"
                />
              </div>
            </details>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 dark:border-dark_border">
              <SearchClearButton className="text-sm font-black text-muted hover:text-primary" />
              <button className={buttonClass} type="submit">Search records</button>
            </div>
          </form>
        </div>
      </section>

      {results}
    </main>
  );
}

function ResultCard({
  eyebrow,
  title,
  extra,
  href,
  hrefLabel,
  children,
}: {
  eyebrow: string;
  title: string;
  extra: string | null;
  href: string;
  hrefLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[24px] border border-border bg-white p-5 dark:border-dark_border dark:bg-darkmode">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="reactenz-eyebrow">{eyebrow}</p>
          <h3 className="mt-1 text-[21px]">{title}</h3>
          {extra ? <p className="mt-1 text-xs text-muted">{extra}</p> : null}
        </div>
        <Link className="text-sm font-black text-primary hover:underline" href={href}>{hrefLabel}</Link>
      </div>
      {children}
    </div>
  );
}

function HostResultCard({
  hosts,
  query,
  href,
  mounted,
}: {
  hosts: HostRegistryPreviewRow[];
  query: string;
  href: string;
  mounted: boolean;
}) {
  return (
    <ResultCard
      eyebrow="Hosts"
      title={!mounted ? "Host registry not mounted" : hosts.length ? `${hosts.length} host-model ${hosts.length === 1 ? "match" : "matches"}` : "No host-model match"}
      extra="Staging identities, not a curated-host catalog"
      href={href}
      hrefLabel="Open host registry"
    >
      {!mounted ? (
        <p className="text-sm leading-6 text-muted">The staging host-model registry is not mounted in this environment.</p>
      ) : hosts.length ? (
        <ul className="divide-y divide-border text-sm dark:divide-dark_border">
          {hosts.map((host) => (
            <li className="py-3" key={host.host_id}>
              <Link className="font-black text-primary hover:underline" href={`/hosts/${encodeURIComponent(host.host_id)}`}>
                <i>{host.scientific_name}</i> · {host.strain}
              </Link>
              <div className="mt-1 font-mono text-xs text-muted">{host.model_name}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm leading-6 text-muted">{query ? "No staging host model matched this text." : "Host-model names are searched from the same top box."}</p>
      )}
    </ResultCard>
  );
}
