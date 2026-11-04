import Link from "next/link";
import type { Metadata } from "next";
import Badge from "@/components/ReactEnz/Badge";
import DataListControls from "@/components/ReactEnz/DataListControls";
import EnzymeTable from "@/components/ReactEnz/EnzymeTable";
import ReactionTable from "@/components/ReactEnz/ReactionTable";
import RowSelectAll from "@/components/ReactEnz/RowSelectAll";
import SortableHeader from "@/components/ReactEnz/SortableHeader";
import { getOrganism, searchEnzymes, searchOrganismsPage, searchReactions } from "@/lib/reactenzdb";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Source organisms",
  description: "Browse biological source organisms associated with enzyme records in ReactEnzDB. Source-organism provenance is distinct from curated metabolic hosts.",
  alternates: { canonical: "/organisms" },
};

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

function evidenceTone(score = 0): "green" | "blue" | "amber" | "slate" {
  if (score >= 75) return "green";
  if (score >= 45) return "blue";
  if (score > 0) return "amber";
  return "slate";
}

export default async function OrganismsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = single(params.q) ?? "";
  const selectedOrganism = single(params.organism) ?? "";
  const sort = single(params.sort) ?? "completeness";
  const dir = single(params.dir) ?? "desc";
  const page = intParam(single(params.page), 1);
  const pageSize = intParam(single(params.pageSize), 20);
  const minEvidenceScore = single(params.minEvidenceScore) ?? "";
  const result = searchOrganismsPage({ q, sort, dir, page, pageSize, minEvidenceScore });
  const organisms = result.rows;
  const selected = selectedOrganism ? getOrganism(selectedOrganism) : null;
  const selectedOrganismName = selected?.organism ?? selectedOrganism;
  const selectedEnzymes = selected ? searchEnzymes({ organism: selected.organism, sequenceOnly: false, limit: 80 }) : [];
  const selectedReactions = selected ? searchReactions({ organism: selected.organism, complete: false, limit: 80 }) : [];
  const sortConfig = { pathname: "/organisms", searchParams: params, currentSort: sort, currentDir: dir };

  return (
    <main className="reactenz-container reactenz-page">
      <div className="reactenz-page-intro reactenz-page-compact-hero">
        <p className="reactenz-eyebrow">Enzyme provenance</p>
        <h1>Source Organisms</h1>
        <p className="reactenz-page-copy">
          Browse biological source organisms associated with enzyme records in ReactEnzDB.
          Source-organism information describes enzyme provenance and is distinct from curated
          metabolic hosts used for pathway context analysis.
        </p>
      </div>

      <details className="mb-4 rounded-2xl border border-border bg-white p-4 dark:border-dark_border dark:bg-darkmode">
        <summary className="cursor-pointer list-none text-sm font-semibold uppercase tracking-[0.14em] text-primary">▾ Filter source organisms</summary>
        <form action="/organisms" className="mt-4 grid gap-3 md:grid-cols-[1fr_220px_auto]">
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="dir" value={dir} />
          <input type="hidden" name="pageSize" value={result.pageSize} />
          <label className="text-sm font-bold">Source organism
            <input name="q" defaultValue={q} placeholder="Source-organism name or ReactEnzDB ID" className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b" />
          </label>
          <label className="text-sm font-bold">Min annotation richness
            <input name="minEvidenceScore" defaultValue={minEvidenceScore} type="number" min="0" max="100" placeholder="0-100" className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b" />
          </label>
          <div className="flex items-end gap-3">
            <button className="rounded-xl bg-primary px-5 py-3 font-bold text-white">Apply</button>
            <a href="/organisms" className="rounded-xl border border-border px-5 py-3 font-bold dark:border-dark_border">Reset</a>
          </div>
        </form>
      </details>

      <DataListControls
        tableId="organisms-table"
        exportType="organisms"
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        totalPages={result.totalPages}
        columns={[
          { id: "reactenz_id", label: "ReactEnzDB ID" },
          { id: "organism", label: "Source Organism" },
          { id: "enzymes", label: "Enzymes" },
          { id: "reactions", label: "Associated Reactions" },
          { id: "structure", label: "Structured enzymes" },
          { id: "evidence_score", label: "Annotation richness" },
          { id: "relations", label: "Association records", defaultVisible: false },
          { id: "chassis", label: "Chassis annotations", defaultVisible: false },
          { id: "pdb", label: "PDB enzymes", defaultVisible: false },
          { id: "alphafold", label: "AlphaFold enzymes", defaultVisible: false },
        ]}
      />

      {selectedOrganism ? (
        <section className="mb-10 rounded-[28px] border border-border bg-white p-6 dark:border-dark_border dark:bg-darkmode">
          <p className="reactenz-eyebrow">Selected source organism</p>
          <h2 className="mb-4">{selectedOrganismName}</h2>
          <p className="mb-5 text-sm leading-6 text-muted">
            This is enzyme provenance information, not a curated metabolic-host assignment.
          </p>
          {selected ? (
            <div className="mb-6 grid gap-4 md:grid-cols-4">
              <Stat value={selected.enzyme_count} label="Enzymes" />
              <Stat value={selected.reaction_count} label="Associated reactions" />
              <Stat value={selected.structured_enzyme_count ?? 0} label="Structured enzymes" />
              <Stat value={selected.evidence_score ?? 0} label="Annotation richness" suffix="/100" />
            </div>
          ) : (
            <p className="mb-6 text-muted">No exact organism match in the web release.</p>
          )}
          <div className="mb-6 flex flex-wrap gap-3 text-sm font-bold">
            <Link className="rounded-full bg-primary px-4 py-2 text-white" href={`/reactions?organism=${encodeURIComponent(selectedOrganismName)}&complete=false`}>
              View related reactions
            </Link>
            <Link className="rounded-full border border-primary px-4 py-2 text-primary" href={`/enzymes?organism=${encodeURIComponent(selectedOrganismName)}&sequence=false`}>
              View related enzymes
            </Link>
          </div>
          <div className="grid gap-8">
            <div>
              <h3 className="mb-4">Representative reactions</h3>
              <ReactionTable reactions={selectedReactions} />
            </div>
            <div>
              <h3 className="mb-4">Representative enzymes</h3>
              <EnzymeTable enzymes={selectedEnzymes} />
            </div>
          </div>
        </section>
      ) : null}

      <div data-table="organisms-table" className="overflow-hidden rounded-[24px] border border-border bg-white dark:border-dark_border dark:bg-darkmode">
        <table className="w-full min-w-[1160px] text-left">
          <thead className="bg-hero-bg text-sm uppercase tracking-wider text-muted dark:bg-dark_b">
            <tr>
              <th className="w-14 px-5 py-4 text-center"><RowSelectAll tableId="organisms-table" /></th>
              <th data-col="reactenz_id" className="px-5 py-4"><SortableHeader column="reactenz_id" label="ReactEnzDB ID" {...sortConfig} /></th>
              <th data-col="organism" className="px-5 py-4"><SortableHeader column="organism" label="Source Organism" {...sortConfig} /></th>
              <th data-col="enzymes" className="px-5 py-4"><SortableHeader column="enzymes" label="Enzymes" {...sortConfig} /></th>
              <th data-col="reactions" className="px-5 py-4"><SortableHeader column="reactions" label="Associated Reactions" {...sortConfig} /></th>
              <th data-col="structure" className="px-5 py-4"><SortableHeader column="structure" label="Structured enzymes" {...sortConfig} /></th>
              <th data-col="evidence_score" className="px-5 py-4"><SortableHeader column="evidence_score" label="Annotation richness" {...sortConfig} /></th>
              <th data-col="relations" className="px-5 py-4"><SortableHeader column="relations" label="Association records" {...sortConfig} /></th>
              <th data-col="chassis" className="px-5 py-4"><SortableHeader column="chassis" label="Chassis annotations" {...sortConfig} /></th>
              <th data-col="pdb" className="px-5 py-4"><SortableHeader column="pdb" label="PDB enzymes" {...sortConfig} /></th>
              <th data-col="alphafold" className="px-5 py-4"><SortableHeader column="alphafold" label="AlphaFold enzymes" {...sortConfig} /></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border dark:divide-dark_border">
            {organisms.map((row) => (
              <tr key={row.organism}>
                <td className="px-5 py-4 text-center">
                  <input
                    type="checkbox"
                    data-row-select
                    value={row.reactenz_organism_id}
                    aria-label={`Select ${row.reactenz_organism_id}`}
                    className="h-4 w-4 accent-primary"
                  />
                </td>
                <td data-col="reactenz_id" className="px-5 py-4 font-bold text-primary">
                  <Link href={`/organisms/${row.reactenz_organism_id}`}>{row.reactenz_organism_id}</Link>
                </td>
                <td data-col="organism" className="px-5 py-4 font-semibold text-midnight_text dark:text-white">
                  <Link href={`/organisms/${row.reactenz_organism_id}`}>{row.organism}</Link>
                </td>
                <td data-col="enzymes" className="px-5 py-4">
                  <Link className="font-semibold text-primary hover:underline" href={`/enzymes?organism=${encodeURIComponent(row.organism)}&sequence=false`}>
                    {row.enzyme_count.toLocaleString()}
                  </Link>
                </td>
                <td data-col="reactions" className="px-5 py-4">{row.reaction_count.toLocaleString()}</td>
                <td data-col="structure" className="px-5 py-4">
                  <Link className="font-semibold text-primary hover:underline" href={`/enzymes?organism=${encodeURIComponent(row.organism)}&hasStructure=yes&sequence=false`}>
                    {(row.structured_enzyme_count ?? 0).toLocaleString()}
                  </Link>
                </td>
                <td data-col="evidence_score" className="px-5 py-4">
                  <Badge tone={evidenceTone(row.evidence_score)}>
                    {row.evidence_tier ?? "limited"} · {row.evidence_score ?? 0}/100
                  </Badge>
                </td>
                <td data-col="relations" className="px-5 py-4">{row.relation_count.toLocaleString()}</td>
                <td data-col="chassis" className="px-5 py-4">{row.chassis_count.toLocaleString()}</td>
                <td data-col="pdb" className="px-5 py-4">
                  <Link className="font-semibold text-primary hover:underline" href={`/enzymes?organism=${encodeURIComponent(row.organism)}&hasPdb=yes&sequence=false`}>
                    {(row.pdb_enzyme_count ?? 0).toLocaleString()}
                  </Link>
                </td>
                <td data-col="alphafold" className="px-5 py-4">
                  <Link className="font-semibold text-primary hover:underline" href={`/enzymes?organism=${encodeURIComponent(row.organism)}&hasAlphaFold=yes&sequence=false`}>
                    {(row.alphafold_enzyme_count ?? 0).toLocaleString()}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function Stat({ value, label, suffix = "" }: { value: number; label: string; suffix?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-5 dark:border-dark_border dark:bg-darkmode">
      <div className="text-3xl font-black text-midnight_text dark:text-white">{Number(value ?? 0).toLocaleString()}{suffix}</div>
      <div className="mt-2 text-sm font-bold uppercase tracking-wider text-muted">{label}</div>
    </div>
  );
}
