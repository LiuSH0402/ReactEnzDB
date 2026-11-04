import type { Metadata } from "next";
import DataListControls from "@/components/ReactEnz/DataListControls";
import ReactionTable from "@/components/ReactEnz/ReactionTable";
import { reactionListColumns } from "@/components/ReactEnz/listColumnOptions";
import { searchReactionsPage } from "@/lib/reactenzdb";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reactions", description: "Browse biochemical reactions with enzyme candidates, compound structures, kinetics, host context, and evidence.", alternates: { canonical: "/reactions" } };

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

function triState(value: string): boolean | undefined {
  return value === "true" ? true : value === "false" ? false : undefined;
}

export default async function ReactionsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = single(params.q) ?? "";
  const direction = single(params.direction) ?? "all";
  const completeValue = single(params.complete) ?? "all";
  const complete = completeValue === "true" ? true : completeValue === "false" ? false : undefined;
  const organism = single(params.organism) ?? "";
  const chassis = single(params.chassis) ?? "";
  const sort = single(params.sort) ?? "completeness";
  const dir = single(params.dir) ?? "desc";
  const page = intParam(single(params.page), 1);
  const pageSize = intParam(single(params.pageSize), 20);
  const ec = single(params.ec) ?? "";
  const rhea = single(params.rhea) ?? "";
  const kegg = single(params.kegg) ?? "";
  const metacyc = single(params.metacyc) ?? "";
  const mnx = single(params.mnx) ?? "";
  const minEnzymes = single(params.minEnzymes) ?? "";
  const minKinetics = single(params.minKinetics) ?? "";
  const minEvidenceScore = single(params.minEvidenceScore) ?? "";
  const massBalance = single(params.massBalance) ?? "all";
  const chargeBalance = single(params.chargeBalance) ?? "all";
  const stereoStatus = single(params.stereoStatus) ?? "all";
  const structureStatus = single(params.structureStatus) ?? "all";
  const exactRheaValue = single(params.exactRhea) ?? "all";
  const atomMappedValue = single(params.atomMapped) ?? "all";
  const conflictFreeValue = single(params.conflictFree) ?? "all";
  const result = searchReactionsPage({
    q, direction, complete, organism, chassis, sort, dir, page, pageSize, ec, rhea, kegg, metacyc, mnx,
    minEnzymes, minKinetics, minEvidenceScore,
    massBalance: massBalance === "all" ? undefined : massBalance,
    chargeBalance: chargeBalance === "all" ? undefined : chargeBalance,
    stereoStatus: stereoStatus === "all" ? undefined : stereoStatus,
    structureStatus: structureStatus === "all" ? undefined : structureStatus,
    exactRhea: triState(exactRheaValue), atomMapped: triState(atomMappedValue), conflictFree: triState(conflictFreeValue),
  });
  const reactions = result.rows;
  const sortConfig = { pathname: "/reactions", searchParams: params, currentSort: sort, currentDir: dir };
  const activeQualityFilters = [
    massBalance !== "all" ? `Mass: ${massBalance.replaceAll("_", " ")}` : null,
    chargeBalance !== "all" ? `Charge: ${chargeBalance.replaceAll("_", " ")}` : null,
    stereoStatus !== "all" ? `Stereo: ${stereoStatus.replaceAll("_", " ")}` : null,
    structureStatus !== "all" ? `Structure: ${structureStatus.replaceAll("_", " ")}` : null,
    exactRheaValue !== "all" ? (exactRheaValue === "true" ? "Exact Rhea identity" : "Without exact Rhea identity") : null,
    atomMappedValue !== "all" ? (atomMappedValue === "true" ? "Atom mapping available" : "No atom mapping") : null,
    conflictFreeValue !== "all" ? (conflictFreeValue === "true" ? "Conflict-free" : "Has recorded conflicts") : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <main className="reactenz-container reactenz-page">
      <section className="reactenz-page-intro reactenz-page-compact-hero">
        <p className="reactenz-eyebrow">Reaction records</p>
        <h1>Reactions</h1>
        <p className="reactenz-page-copy">
          Browse ReactEnzDB reaction records and connect each reaction to enzyme candidates, source-organism provenance, chassis annotations, structures, and evidence links.
        </p>
      </section>

      <details className="mb-4 rounded-2xl border border-border bg-white p-4 dark:border-dark_border dark:bg-darkmode">
        <summary className="cursor-pointer list-none text-sm font-semibold uppercase tracking-[0.14em] text-primary">▾ Filter reactions</summary>
        <form action="/reactions" className="mt-4 grid gap-3 md:grid-cols-3">
          {q ? <input type="hidden" name="q" value={q} /> : null}
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="dir" value={dir} />
          <input type="hidden" name="pageSize" value={result.pageSize} />
          <label className="text-sm font-bold">Direction
            <select name="direction" defaultValue={direction} className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b dark:text-white">
              <option value="all">All</option>
              <option value="=&gt;">=&gt;</option>
              <option value="=">=</option>
              <option value="&lt;=&gt;">&lt;=&gt;</option>
              <option value="&lt;=">&lt;=</option>
              <option value="&lt;--&gt;">&lt;--&gt;</option>
            </select>
          </label>
          <label className="text-sm font-bold">Structure
            <select name="complete" defaultValue={completeValue} className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b dark:text-white">
              <option value="all">All</option>
              <option value="true">SMILES-complete</option>
              <option value="false">Unresolved participants</option>
            </select>
          </label>
          <label className="text-sm font-bold">Source organism
            <input name="organism" defaultValue={organism} placeholder="e.g. Escherichia coli" className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b" />
          </label>
          <label className="text-sm font-bold">Chassis annotation
            <input name="chassis" defaultValue={chassis} placeholder="e.g. BL21(DE3)" className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b" />
          </label>
          <label className="text-sm font-bold">EC number
            <input name="ec" defaultValue={ec} placeholder="e.g. 1.1.1.1" className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b" />
          </label>
          <label className="text-sm font-bold">Rhea
            <input name="rhea" defaultValue={rhea} placeholder="RHEA identifier" className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b" />
          </label>
          <label className="text-sm font-bold">KEGG
            <input name="kegg" defaultValue={kegg} placeholder="KEGG reaction" className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b" />
          </label>
          <label className="text-sm font-bold">MetaCyc
            <input name="metacyc" defaultValue={metacyc} placeholder="MetaCyc reaction" className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b" />
          </label>
          <label className="text-sm font-bold">MNXref
            <input name="mnx" defaultValue={mnx} placeholder="MNXR identifier" className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b" />
          </label>
          <label className="text-sm font-bold">Min enzymes
            <input name="minEnzymes" defaultValue={minEnzymes} type="number" min="0" className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b" />
          </label>
          <label className="text-sm font-bold">Min kinetics
            <input name="minKinetics" defaultValue={minKinetics} type="number" min="0" className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b" />
          </label>
          <label className="text-sm font-bold">Min annotation richness
            <input name="minEvidenceScore" defaultValue={minEvidenceScore} type="number" min="0" max="100" placeholder="0-100" className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b" />
          </label>
          <div className="md:col-span-3 mt-2 border-t border-border pt-5 dark:border-dark_border">
            <div className="text-xs font-black uppercase tracking-[0.16em] text-primary">Standardization quality</div>
            <p className="mt-2 text-sm leading-6 text-muted dark:text-white/60">Filter by the normalized reaction identity layer. These controls select existing evidence; they do not create new mappings or infer missing chemistry.</p>
          </div>
          <label className="text-sm font-bold">Full mass balance
            <select name="massBalance" defaultValue={massBalance} className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b dark:text-white">
              <option value="all">Any status</option><option value="balanced">Balanced</option><option value="hydrogen_only_imbalance">Hydrogen-only imbalance</option><option value="unbalanced">Unbalanced</option><option value="unknown_missing_structure">Unknown: generic or missing structure</option>
            </select>
          </label>
          <label className="text-sm font-bold">Full charge balance
            <select name="chargeBalance" defaultValue={chargeBalance} className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b dark:text-white">
              <option value="all">Any status</option><option value="balanced">Balanced</option><option value="unbalanced">Unbalanced</option><option value="unknown_missing_structure">Unknown: generic or missing structure</option>
            </select>
          </label>
          <label className="text-sm font-bold">Stereo completeness
            <select name="stereoStatus" defaultValue={stereoStatus} className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b dark:text-white">
              <option value="all">Any status</option><option value="complete_or_not_applicable">Complete or not applicable</option><option value="incomplete_unspecified">Incomplete / unspecified</option><option value="unknown_missing_structure">Unknown: missing structure</option>
            </select>
          </label>
          <label className="text-sm font-bold">Standardized structure
            <select name="structureStatus" defaultValue={structureStatus} className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b dark:text-white">
              <option value="all">Any status</option><option value="complete">Complete concrete structures</option><option value="partial_generic_structure">Contains generic/R-group structures</option><option value="partial_missing_structure">Missing participant structures</option>
            </select>
          </label>
          <label className="text-sm font-bold">Exact Rhea identity
            <select name="exactRhea" defaultValue={exactRheaValue} className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b dark:text-white">
              <option value="all">Any status</option><option value="true">Required</option><option value="false">Not available</option>
            </select>
          </label>
          <label className="text-sm font-bold">Atom mapping
            <select name="atomMapped" defaultValue={atomMappedValue} className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b dark:text-white">
              <option value="all">Any status</option><option value="true">Mapping available</option><option value="false">No validated mapping</option>
            </select>
          </label>
          <label className="text-sm font-bold">Cross-database conflicts
            <select name="conflictFree" defaultValue={conflictFreeValue} className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b dark:text-white">
              <option value="all">Any status</option><option value="true">No recorded conflicts</option><option value="false">Has recorded conflicts</option>
            </select>
          </label>
          <div className="flex items-end gap-3">
            <button className="rounded-xl bg-primary px-5 py-3 font-bold text-white">Apply</button>
            <a href="/reactions" className="rounded-xl border border-border px-5 py-3 font-bold dark:border-dark_border">Reset</a>
          </div>
        </form>
      </details>

      <DataListControls
        tableId="reactions-table"
        exportType="reactions"
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        totalPages={result.totalPages}
        columns={reactionListColumns}
        storageVersion="compact-core-v3"
      />

      <div>
        {activeQualityFilters.length ? (
          <div className="mb-4 border-y border-border py-3 dark:border-dark_border">
            <div className="flex flex-wrap items-center gap-2 text-sm"><span className="mr-1 font-black text-midnight_text dark:text-white">Quality filters</span>{activeQualityFilters.map((filter) => <span className="rounded-full bg-primary/10 px-3 py-1.5 font-semibold text-primary" key={filter}>{filter}</span>)}</div>
          </div>
        ) : null}
        {(organism || chassis) ? (
          <div className="mb-4 flex flex-wrap gap-3 text-sm font-semibold">
            {organism ? (
              <span className="rounded-full bg-hero-bg px-4 py-2 text-primary dark:bg-dark_b">
                Source organism: {organism}
              </span>
            ) : null}
            {chassis ? (
              <span className="rounded-full bg-hero-bg px-4 py-2 text-primary dark:bg-dark_b">
                Chassis: {chassis}
              </span>
            ) : null}
          </div>
        ) : null}
        <ReactionTable reactions={reactions} tableId="reactions-table" sort={sortConfig} />
      </div>
    </main>
  );
}
