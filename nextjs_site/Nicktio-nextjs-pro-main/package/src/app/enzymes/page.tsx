import type { Metadata } from "next";
import DataListControls from "@/components/ReactEnz/DataListControls";
import EnzymeTable from "@/components/ReactEnz/EnzymeTable";
import { enzymeListColumns } from "@/components/ReactEnz/listColumnOptions";
import { searchEnzymesPage } from "@/lib/reactenzdb";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Enzymes", description: "Browse enzyme candidates with source organisms, sequences, kinetics, domains, active sites, and structures.", alternates: { canonical: "/enzymes" } };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function intParam(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default async function EnzymesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = single(params.q) ?? "";
  const sequence = single(params.sequence) ?? "all";
  const sequenceOnly = single(params.sequence) === "true";
  const organism = single(params.organism) ?? "";
  const reactionId = single(params.reactionId) ?? "";
  const chassis = single(params.chassis) ?? "";
  const sort = single(params.sort) ?? "completeness";
  const dir = single(params.dir) ?? "desc";
  const page = intParam(single(params.page), 1);
  const pageSize = intParam(single(params.pageSize), 20);
  const gene = single(params.gene) ?? "";
  const taxonomy = single(params.taxonomy) ?? "";
  const minLength = single(params.minLength) ?? "";
  const maxLength = single(params.maxLength) ?? "";
  const minReactions = single(params.minReactions) ?? "";
  const hasPdb = single(params.hasPdb) ?? "all";
  const hasAlphaFold = single(params.hasAlphaFold) ?? "all";
  const hasStructure = single(params.hasStructure) ?? "all";
  const hasKinetics = single(params.hasKinetics) ?? "all";
  const hasInterPro = single(params.hasInterPro) ?? "all";
  const hasHighConfidenceStructure = single(params.hasHighConfidenceStructure) ?? "all";
  const hasCatalyticSiteSupport = single(params.hasCatalyticSiteSupport) ?? "all";
  const minEvidenceScore = single(params.minEvidenceScore) ?? "";
  const minStructureConfidenceScore = single(params.minStructureConfidenceScore) ?? "";
  const result = searchEnzymesPage({
    q,
    sequenceOnly,
    sequence,
    organism,
    reactionId,
    chassis,
    sort,
    dir,
    page,
    pageSize,
    gene,
    taxonomy,
    minLength,
    maxLength,
    minReactions,
    hasPdb,
    hasAlphaFold,
    hasStructure,
    hasKinetics,
    hasInterPro,
    hasHighConfidenceStructure,
    hasCatalyticSiteSupport,
    minEvidenceScore,
    minStructureConfidenceScore,
  });
  const enzymes = result.rows;
  const sortConfig = { pathname: "/enzymes", searchParams: params, currentSort: sort, currentDir: dir };

  return (
    <main className="reactenz-container reactenz-page">
      <section className="reactenz-page-intro reactenz-page-compact-hero">
        <p className="reactenz-eyebrow">Enzyme records</p>
        <h1>Enzymes</h1>
        <p className="reactenz-page-copy">
          Browse enzyme and biopart records with sequence availability, source organisms, protein identifiers, and linked reactions.
        </p>
      </section>

      <details className="mb-4 rounded-2xl border border-border bg-white p-4 dark:border-dark_border dark:bg-darkmode">
        <summary className="cursor-pointer list-none text-sm font-semibold uppercase tracking-[0.14em] text-primary">▾ Filter enzymes</summary>
        <form action="/enzymes" className="mt-4 grid gap-3 md:grid-cols-3">
          {q ? <input type="hidden" name="q" value={q} /> : null}
          {reactionId ? <input type="hidden" name="reactionId" value={reactionId} /> : null}
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="dir" value={dir} />
          <input type="hidden" name="pageSize" value={result.pageSize} />
          <label className="text-sm font-bold">Sequence
            <select name="sequence" defaultValue={sequence} className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b dark:text-white">
              <option value="all">All</option>
              <option value="yes">Available</option>
              <option value="no">Missing</option>
            </select>
          </label>
          <label className="text-sm font-bold">Any structure
            <select name="hasStructure" defaultValue={hasStructure} className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b dark:text-white">
              <option value="all">All</option>
              <option value="yes">Has PDB or AlphaFold</option>
              <option value="no">No mapped structure</option>
            </select>
          </label>
          <label className="text-sm font-bold">PDB
            <select name="hasPdb" defaultValue={hasPdb} className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b dark:text-white">
              <option value="all">All</option>
              <option value="yes">Has PDB mapping</option>
              <option value="no">No PDB mapping</option>
            </select>
          </label>
          <label className="text-sm font-bold">AlphaFold
            <select name="hasAlphaFold" defaultValue={hasAlphaFold} className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b dark:text-white">
              <option value="all">All</option>
              <option value="yes">Has AlphaFold model</option>
              <option value="no">No AlphaFold model</option>
            </select>
          </label>
          <label className="text-sm font-bold">Kinetics
            <select name="hasKinetics" defaultValue={hasKinetics} className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b dark:text-white">
              <option value="all">All</option>
              <option value="yes">Has kinetic parameters</option>
              <option value="no">No kinetic parameters</option>
            </select>
          </label>
          <label className="text-sm font-bold">InterPro annotation
            <select name="hasInterPro" defaultValue={hasInterPro} className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b dark:text-white">
              <option value="all">All</option>
              <option value="yes">Has InterPro/Pfam</option>
              <option value="no">No InterPro annotation</option>
            </select>
          </label>
          <label className="text-sm font-bold">High-confidence structure
            <select name="hasHighConfidenceStructure" defaultValue={hasHighConfidenceStructure} className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b dark:text-white">
              <option value="all">All</option>
              <option value="yes">High-confidence structure</option>
              <option value="no">No high-confidence structure</option>
            </select>
          </label>
          <label className="text-sm font-bold">Catalytic-site support
            <select name="hasCatalyticSiteSupport" defaultValue={hasCatalyticSiteSupport} className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b dark:text-white">
              <option value="all">All</option>
              <option value="yes">Has structural site support</option>
              <option value="no">No structural site support</option>
            </select>
          </label>
          <label className="text-sm font-bold">Source organism
            <input name="organism" defaultValue={organism} placeholder="e.g. Escherichia coli" className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b" />
          </label>
          <label className="text-sm font-bold">Gene
            <input name="gene" defaultValue={gene} placeholder="e.g. adh" className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b" />
          </label>
          <label className="text-sm font-bold">Taxonomy
            <input name="taxonomy" defaultValue={taxonomy} placeholder="NCBI taxonomy ID" className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b" />
          </label>
          <label className="text-sm font-bold">Chassis annotation
            <input name="chassis" defaultValue={chassis} placeholder="e.g. BL21(DE3)" className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b" />
          </label>
          <label className="text-sm font-bold">Min length
            <input name="minLength" defaultValue={minLength} type="number" min="0" className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b" />
          </label>
          <label className="text-sm font-bold">Max length
            <input name="maxLength" defaultValue={maxLength} type="number" min="0" className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b" />
          </label>
          <label className="text-sm font-bold">Min reactions
            <input name="minReactions" defaultValue={minReactions} type="number" min="0" className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b" />
          </label>
          <label className="text-sm font-bold">Min annotation richness
            <input name="minEvidenceScore" defaultValue={minEvidenceScore} type="number" min="0" max="100" placeholder="0-100" className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b" />
          </label>
          <label className="text-sm font-bold">Min structure score
            <input name="minStructureConfidenceScore" defaultValue={minStructureConfidenceScore} type="number" min="0" max="100" placeholder="0-100" className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b" />
          </label>
          <div className="flex items-end gap-3">
            <button className="rounded-xl bg-primary px-5 py-3 font-bold text-white">Apply</button>
            <a href="/enzymes" className="rounded-xl border border-border px-5 py-3 font-bold dark:border-dark_border">Reset</a>
          </div>
        </form>
      </details>

      <DataListControls
        tableId="enzymes-table"
        exportType="enzymes"
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        totalPages={result.totalPages}
        columns={enzymeListColumns}
        storageVersion="compact-core-v3"
      />

      <div>
        {(organism || reactionId || chassis) ? (
          <div className="mb-4 flex flex-wrap gap-3 text-sm font-semibold">
            {reactionId ? <span className="rounded-full bg-hero-bg px-4 py-2 text-primary dark:bg-dark_b">Reaction: {reactionId}</span> : null}
            {organism ? <span className="rounded-full bg-hero-bg px-4 py-2 text-primary dark:bg-dark_b">Source organism: {organism}</span> : null}
            {chassis ? <span className="rounded-full bg-hero-bg px-4 py-2 text-primary dark:bg-dark_b">Chassis: {chassis}</span> : null}
          </div>
        ) : null}
        <EnzymeTable enzymes={enzymes} tableId="enzymes-table" sort={sortConfig} />
      </div>
    </main>
  );
}
