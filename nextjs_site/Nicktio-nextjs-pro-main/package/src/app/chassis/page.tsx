import Link from "next/link";
import type { Metadata } from "next";
import Badge from "@/components/ReactEnz/Badge";
import DataListControls from "@/components/ReactEnz/DataListControls";
import DataStatus from "@/components/ReactEnz/DataStatus";
import RowSelectAll from "@/components/ReactEnz/RowSelectAll";
import SortableHeader from "@/components/ReactEnz/SortableHeader";
import { getChassis, getChassisRecords, searchChassisPage } from "@/lib/reactenzdb";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Chassis annotations",
  description: "Browse source-retained expression-host, strain, cell-line, and biological-context annotations associated with enzyme records in ReactEnzDB.",
  alternates: { canonical: "/chassis" },
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

export default async function ChassisPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = single(params.q) ?? "";
  const selectedLabel = single(params.label) ?? "";
  const sort = single(params.sort) ?? "completeness";
  const dir = single(params.dir) ?? "desc";
  const page = intParam(single(params.page), 1);
  const pageSize = intParam(single(params.pageSize), 20);
  const minEvidenceScore = single(params.minEvidenceScore) ?? "";
  const result = searchChassisPage({ q, sort, dir, page, pageSize, minEvidenceScore });
  const chassis = result.rows;
  const selected = selectedLabel ? getChassis(selectedLabel) : null;
  const selectedRecords = selectedLabel ? getChassisRecords(selectedLabel, 120) : [];
  const selectedChassisName = selected?.label ?? selectedLabel;
  const sortConfig = { pathname: "/chassis", searchParams: params, currentSort: sort, currentDir: dir };

  return (
    <main className="reactenz-container reactenz-page">
      <div className="reactenz-page-intro reactenz-page-compact-hero">
        <p className="reactenz-eyebrow">Expression &amp; chassis annotations</p>
        <h1>Chassis Annotations</h1>
        <p className="reactenz-page-copy">
          Browse source-retained expression-host, strain, cell-line, and biological-context annotations associated with enzyme records in ReactEnzDB. These annotations are distinct from curated metabolic hosts used for pathway context analysis.
        </p>
      </div>

      <details className="mb-4 rounded-2xl border border-border bg-white p-4 dark:border-dark_border dark:bg-darkmode">
        <summary className="cursor-pointer list-none text-sm font-semibold uppercase tracking-[0.14em] text-primary">▾ Filter chassis annotations</summary>
        <form action="/chassis" className="mt-4 grid gap-3 md:grid-cols-[1fr_220px_auto]">
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="dir" value={dir} />
          <input type="hidden" name="pageSize" value={result.pageSize} />
          <label className="text-sm font-bold">Chassis annotation
            <input name="q" defaultValue={q} placeholder="Annotation label or ReactEnzDB chassis annotation ID" className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b" />
          </label>
          <label className="text-sm font-bold">Min annotation richness
            <input name="minEvidenceScore" defaultValue={minEvidenceScore} type="number" min="0" max="100" placeholder="0-100" className="mt-2 block w-full border border-border bg-hero-bg px-4 py-3 dark:border-dark_border dark:bg-dark_b" />
          </label>
          <div className="flex items-end gap-3">
            <button className="rounded-xl bg-primary px-5 py-3 font-bold text-white">Apply</button>
            <a href="/chassis" className="rounded-xl border border-border px-5 py-3 font-bold dark:border-dark_border">Reset</a>
          </div>
        </form>
      </details>

      <DataListControls
        tableId="chassis-table"
        exportType="chassis"
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        totalPages={result.totalPages}
        storageVersion="chassis-annotations-v1"
        columns={[
          { id: "reactenz_id", label: "ReactEnzDB ID" },
          { id: "label", label: "Chassis Annotation" },
          { id: "enzymes", label: "Enzymes" },
          { id: "reactions", label: "Associated Reactions" },
          { id: "organisms", label: "Source Organisms" },
          { id: "evidence_score", label: "Annotation richness" },
          { id: "records", label: "Association records", defaultVisible: false },
          { id: "structure", label: "Structured enzymes", defaultVisible: false },
          { id: "pdb", label: "PDB enzymes", defaultVisible: false },
          { id: "alphafold", label: "AlphaFold enzymes", defaultVisible: false },
        ]}
      />

      {selectedLabel ? (
        <section className="mb-10 rounded-[28px] border border-border bg-white p-6 dark:border-dark_border dark:bg-darkmode">
          <p className="reactenz-eyebrow">Selected chassis annotation</p>
          <h2 className="mb-4">{selectedChassisName}</h2>
          <p className="mb-5 text-sm leading-6 text-muted">
            This source-retained label is not a curated metabolic-host assignment and does not, by itself, establish experimentally validated expression.
          </p>
          {selected ? (
            <div className="mb-6 grid gap-4 md:grid-cols-4">
              <Stat value={selected.enzyme_count} label="Enzymes" />
              <Stat value={selected.reaction_count} label="Associated reactions" />
              <Stat value={selected.organism_count} label="Source organisms" />
              <Stat value={selected.evidence_score ?? 0} label="Annotation richness" suffix="/100" />
            </div>
          ) : (
            <p className="mb-6 text-muted">No exact chassis annotation match in the web release.</p>
          )}
          <div className="mb-6 flex flex-wrap gap-3 text-sm font-bold">
            <Link className="rounded-full bg-primary px-4 py-2 text-white" href={`/reactions?chassis=${encodeURIComponent(selectedChassisName)}&complete=false`}>
              View related reactions
            </Link>
            <Link className="rounded-full border border-primary px-4 py-2 text-primary" href={`/enzymes?chassis=${encodeURIComponent(selectedChassisName)}&sequence=false`}>
              View related enzymes
            </Link>
          </div>

          <div className="mb-8 overflow-hidden rounded-2xl border border-border dark:border-dark_border">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-hero-bg text-muted dark:bg-dark_b">
                <tr>
                  <th className="px-4 py-3">Reaction</th>
                  <th className="px-4 py-3">Enzyme ID</th>
                  <th className="px-4 py-3">Source Organism ID</th>
                  <th className="px-4 py-3">Enzyme</th>
                  <th className="px-4 py-3">Source Organism</th>
                  <th className="px-4 py-3">Sequence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border dark:divide-dark_border">
                {selectedRecords.map((row) => (
                  <tr key={`${row.chassis_label}-${row.reactenz_reaction_id}-${row.reactenz_enzyme_id}`}>
                    <td className="px-4 py-3 font-bold text-primary"><Link href={`/reactions/${row.reactenz_reaction_id}`}>{row.reactenz_reaction_id}</Link></td>
                    <td className="px-4 py-3 font-bold text-primary"><Link href={`/enzymes/${row.reactenz_enzyme_id}`}>{row.reactenz_enzyme_id}</Link></td>
                    <td className="px-4 py-3">{row.reactenz_organism_id ?? <DataStatus status="not_curated" />}</td>
                    <td className="px-4 py-3">{row.enzyme_name ?? <DataStatus status="not_curated" />}</td>
                    <td className="px-4 py-3">
                      {row.organism ? (
                        <Link
                          className="font-semibold text-primary hover:underline"
                          href={row.reactenz_organism_id
                            ? `/organisms/${row.reactenz_organism_id}`
                            : `/organisms?q=${encodeURIComponent(row.organism)}`}
                        >
                          {row.organism}
                        </Link>
                      ) : <DataStatus status="not_curated" />}
                    </td>
                    <td className="px-4 py-3">{row.has_sequence ? `${row.sequence_length ?? 0} aa` : <DataStatus status="sequence_not_available" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </section>
      ) : null}

      <div data-table="chassis-table" className="overflow-hidden rounded-[24px] border border-border bg-white dark:border-dark_border dark:bg-darkmode">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1240px] text-left">
          <thead className="bg-hero-bg text-sm uppercase tracking-wider text-muted dark:bg-dark_b">
            <tr>
              <th className="w-14 px-5 py-4 text-center"><RowSelectAll tableId="chassis-table" /></th>
              <th data-col="reactenz_id" className="px-5 py-4"><SortableHeader column="reactenz_id" label="ReactEnzDB ID" {...sortConfig} /></th>
              <th data-col="label" className="px-5 py-4"><SortableHeader column="label" label="Chassis Annotation" {...sortConfig} /></th>
              <th data-col="enzymes" className="px-5 py-4"><SortableHeader column="enzymes" label="Enzymes" {...sortConfig} /></th>
              <th data-col="reactions" className="px-5 py-4"><SortableHeader column="reactions" label="Associated Reactions" {...sortConfig} /></th>
              <th data-col="organisms" className="px-5 py-4"><SortableHeader column="organisms" label="Source Organisms" {...sortConfig} /></th>
              <th data-col="evidence_score" className="px-5 py-4"><SortableHeader column="evidence_score" label="Annotation richness" {...sortConfig} /></th>
              <th data-col="records" className="px-5 py-4"><SortableHeader column="records" label="Association records" {...sortConfig} /></th>
              <th data-col="structure" className="px-5 py-4"><SortableHeader column="structure" label="Structured enzymes" {...sortConfig} /></th>
              <th data-col="pdb" className="px-5 py-4"><SortableHeader column="pdb" label="PDB enzymes" {...sortConfig} /></th>
              <th data-col="alphafold" className="px-5 py-4"><SortableHeader column="alphafold" label="AlphaFold enzymes" {...sortConfig} /></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border dark:divide-dark_border">
            {chassis.map((row) => (
              <tr key={row.label}>
                <td className="px-5 py-4 text-center">
                  <input
                    type="checkbox"
                    data-row-select
                    value={row.reactenz_chassis_id}
                    aria-label={`Select ${row.reactenz_chassis_id}`}
                    className="h-4 w-4 accent-primary"
                  />
                </td>
                <td data-col="reactenz_id" className="px-5 py-4 font-bold text-primary">
                  <Link href={`/chassis/${row.reactenz_chassis_id}`}>{row.reactenz_chassis_id}</Link>
                </td>
                <td data-col="label" className="px-5 py-4 font-semibold text-midnight_text dark:text-white">
                  <Link href={`/chassis/${row.reactenz_chassis_id}`}>{row.label}</Link>
                </td>
                <td data-col="enzymes" className="px-5 py-4">
                  <Link className="font-semibold text-primary hover:underline" href={`/enzymes?chassis=${encodeURIComponent(row.label)}&sequence=false`}>
                    {row.enzyme_count.toLocaleString()}
                  </Link>
                </td>
                <td data-col="reactions" className="px-5 py-4">
                  <Link className="font-semibold text-primary hover:underline" href={`/reactions?chassis=${encodeURIComponent(row.label)}&complete=false`}>
                    {row.reaction_count.toLocaleString()}
                  </Link>
                </td>
                <td data-col="organisms" className="px-5 py-4">{row.organism_count.toLocaleString()}</td>
                <td data-col="evidence_score" className="px-5 py-4">
                  <Badge tone={evidenceTone(row.evidence_score)}>
                    {row.evidence_tier ?? "limited"} · {row.evidence_score ?? 0}/100
                  </Badge>
                </td>
                <td data-col="records" className="px-5 py-4">{row.record_count.toLocaleString()}</td>
                <td data-col="structure" className="px-5 py-4">
                  <Link className="font-semibold text-primary hover:underline" href={`/enzymes?chassis=${encodeURIComponent(row.label)}&hasStructure=yes&sequence=false`}>
                    {(row.structured_enzyme_count ?? 0).toLocaleString()}
                  </Link>
                </td>
                <td data-col="pdb" className="px-5 py-4">
                  <Link className="font-semibold text-primary hover:underline" href={`/enzymes?chassis=${encodeURIComponent(row.label)}&hasPdb=yes&sequence=false`}>
                    {(row.pdb_enzyme_count ?? 0).toLocaleString()}
                  </Link>
                </td>
                <td data-col="alphafold" className="px-5 py-4">
                  <Link className="font-semibold text-primary hover:underline" href={`/enzymes?chassis=${encodeURIComponent(row.label)}&hasAlphaFold=yes&sequence=false`}>
                    {(row.alphafold_enzyme_count ?? 0).toLocaleString()}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
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
