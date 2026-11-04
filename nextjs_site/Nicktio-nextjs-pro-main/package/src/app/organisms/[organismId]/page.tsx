import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import DataStatus from "@/components/ReactEnz/DataStatus";
import { ParentBackLink } from "@/components/ReactEnz/ParentBackLink";
import { displayValue, type DataStatusKind } from "@/components/ReactEnz/DataStatus";
import DetailDownloadLink from "@/components/ReactEnz/DetailDownloadLink";
import EnzymeTable from "@/components/ReactEnz/EnzymeTable";
import ExperimentalExpressionEvidence from "@/components/ReactEnz/ExperimentalExpressionEvidence";
import ReactionTable from "@/components/ReactEnz/ReactionTable";
import { getExpressionEvidenceForOrganism } from "@/lib/expressionEvidence";
import {
  getOrganism,
  getOrganismChassis,
  getOrganismProvenanceProfile,
  getOrganismRecords,
  searchEnzymes,
  searchReactions,
} from "@/lib/reactenzdb";

export const revalidate = 60;

type PageProps = {
  params: Promise<{ organismId: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { organismId } = await params;
  const organism = getOrganism(decodeURIComponent(organismId));
  if (!organism) notFound();
  return {
    title: `${organism.organism} source organism`,
    description: `${organism.organism} source-organism record with ${organism.enzyme_count.toLocaleString()} enzymes and ${organism.reaction_count.toLocaleString()} reactions in ReactEnzDB.`,
    alternates: { canonical: `/organisms/${encodeURIComponent(organism.reactenz_organism_id)}` },
  };
}

const sections = [
  ["overview", "Overview"],
  ["enzymes", "Enzymes"],
  ["reactions", "Associated reactions"],
  ["evidence", "Evidence summary"],
  ["reported-expression", "Reported expression context"],
  ["records", "Association records"],
  ["links", "Related views"],
] as const;

export default async function OrganismDetailPage({ params }: PageProps) {
  const { organismId } = await params;
  const organism = getOrganism(decodeURIComponent(organismId));
  if (!organism) notFound();

  const reactions = searchReactions({
    organism: organism.organism,
    complete: false,
    exactContext: true,
    skipTotal: true,
    limit: 30,
  });
  const enzymes = searchEnzymes({
    organism: organism.organism,
    sequenceOnly: false,
    exactContext: true,
    skipTotal: true,
    limit: 30,
  });
  const records = getOrganismRecords(organism.organism, 50);
  const chassis = getOrganismChassis(organism.organism, 30);
  const provenance = getOrganismProvenanceProfile(organism.organism);
  const experimentalExpression = getExpressionEvidenceForOrganism(organism.organism, 12);
  const structureCoverage = organism.enzyme_count
    ? Math.round(((organism.structured_enzyme_count ?? 0) / organism.enzyme_count) * 100)
    : 0;

  return (
    <main className="reactenz-detail reactenz-container py-10">
      <div className="grid gap-8 lg:grid-cols-[230px_1fr]">
        <aside className="h-fit border-border text-sm dark:border-dark_border lg:sticky lg:top-[88px] lg:border-r lg:pr-5">
          <ParentBackLink href="/organisms" label="Source organisms" />
          <div className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-muted">Source-organism record</div>
          <nav className="space-y-1">
            {sections.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="block border-l-2 border-transparent px-3 py-2 font-semibold text-muted transition hover:border-primary hover:text-primary">
                {label}
              </a>
            ))}
          </nav>
        </aside>

        <div className="min-w-0">
          <section id="overview" className="reactenz-detail-overview scroll-mt-8 border-b border-border pb-8 dark:border-dark_border">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">Enzyme provenance</p>
              <DetailDownloadLink type="organism-detail" id={organism.reactenz_organism_id} />
            </div>
            <h1 className="mb-3">{organism.organism}</h1>
            <p className="max-w-3xl text-sm leading-7 text-muted">
              Biological source associated with enzyme records in ReactEnzDB. This provenance record is distinct from curated metabolic hosts used for pathway context analysis.
            </p>
            <dl className="mt-7 grid gap-x-8 gap-y-5 text-sm md:grid-cols-2">
              <Meta label="ReactEnzDB source-organism ID" value={organism.reactenz_organism_id} />
              <Meta label="Taxonomy ID" value={provenance.taxonomy_ids.length ? provenance.taxonomy_ids.join(", ") : null} />
              <Meta label="Taxonomic lineage" value={provenance.lineages.length ? provenance.lineages.join("; ") : null} />
              <Meta label="Annotation richness" value={`${organism.evidence_tier ?? "limited"} · ${organism.evidence_score ?? 0}/100`} />
            </dl>
            <div className="mt-7 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <ConnectionCard href="#enzymes" label="Enzymes" value={organism.enzyme_count} />
              <ConnectionCard href="#reactions" label="Associated reactions" value={organism.reaction_count} />
              <ConnectionCard href="#evidence" label="Structured enzymes" value={organism.structured_enzyme_count ?? 0} />
              <ConnectionCard href="#reported-expression" label="Chassis annotations" value={organism.chassis_count} />
            </div>
          </section>

          <Section id="enzymes" title="Enzymes From This Source Organism">
            <p className="mb-4 text-sm leading-7 text-muted">
              Enzyme records carrying this source-organism provenance. Open an enzyme to inspect sequence, identifiers, associated reactions, structures, kinetics, and annotation context.
            </p>
            <EnzymeTable enzymes={enzymes} tableId="organism-enzymes-table" />
          </Section>

          <Section id="reactions" title="Associated Reactions">
            <p className="mb-4 text-sm leading-7 text-muted">
              Reactions associated with enzymes from this biological source. Open a reaction to inspect compounds, external identifiers, kinetics, and candidate enzymes.
            </p>
            <ReactionTable reactions={reactions} tableId="organism-reactions-table" />
          </Section>

          <Section id="evidence" title="Evidence Summary">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Stat value={organism.enzyme_count} label="Total enzymes" />
              <Stat value={provenance.enzymes_with_sequence} label="Sequence available" />
              <Stat value={organism.structured_enzyme_count ?? 0} label="PDB or AlphaFold" />
              <Stat value={provenance.literature_references} label="Literature references" />
              <Stat value={provenance.kinetic_records} label="Kinetic records" />
              <Stat value={organism.evidence_score ?? 0} label="Annotation richness" suffix="/100" />
            </div>
            <p className="mt-4 text-sm leading-7 text-muted">
              {structureCoverage}% of the enzymes have a PDB or AlphaFold mapping ({(organism.pdb_enzyme_count ?? 0).toLocaleString()} PDB-mapped; {(organism.alphafold_enzyme_count ?? 0).toLocaleString()} AlphaFold-mapped). Annotation richness summarizes available fields and links; it is not a measure of biological correctness or host compatibility.
            </p>
          </Section>

          <Section id="reported-expression" title="Reported Expression Context">
            <p className="mb-5 text-sm leading-7 text-muted">
              These source-retained annotations describe reported or database-linked expression context. They are distinct from curated metabolic-host models and should not be interpreted as automatic confirmation of expression performance or host compatibility.
            </p>
            <ExperimentalExpressionEvidence bundles={experimentalExpression} title={`Expression evidence linked to enzymes from ${organism.organism}`} />

            <h3 className="mb-4 mt-8 text-lg font-semibold text-midnight_text dark:text-white">Chassis annotations</h3>
            {chassis.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {chassis.map((item) => (
                  <Link
                    className="rounded-2xl border border-border p-4 transition hover:border-primary dark:border-dark_border"
                    href={`/chassis/${item.reactenz_chassis_id}`}
                    key={item.reactenz_chassis_id}
                  >
                    <div className="font-semibold text-primary">{item.reactenz_chassis_id}</div>
                    <div className="mt-1 font-semibold text-midnight_text dark:text-white">{item.label}</div>
                    <div className="mt-2 text-sm text-muted">
                      {item.record_count.toLocaleString()} association records; {item.reaction_count.toLocaleString()} reactions; {item.enzyme_count.toLocaleString()} enzymes
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-muted">No chassis annotation connected to this source organism in the web release.</p>
            )}
          </Section>

          <Section id="records" title="Stable Association Records">
            <p className="mb-4 text-sm leading-7 text-muted">
              Stable reaction–enzyme associations for enzymes carrying this source-organism provenance. Chassis annotations are auxiliary context and do not constitute a curated host assignment.
            </p>
            <RelationRecordsTable records={records} />
          </Section>

          <Section id="links" title="Related Views">
            <div className="flex flex-wrap gap-3">
              <Link className="rounded-xl bg-primary px-4 py-3 font-semibold text-white" href={`/reactions?organism=${encodeURIComponent(organism.organism)}&complete=false`}>
                Browse all reactions
              </Link>
              <Link className="rounded-xl border border-primary px-4 py-3 font-semibold text-primary" href={`/enzymes?organism=${encodeURIComponent(organism.organism)}&sequence=false`}>
                Browse all enzymes
              </Link>
            </div>
          </Section>
        </div>
      </div>
    </main>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="reactenz-detail-section scroll-mt-8 border-b border-border py-8 last:border-b-0 dark:border-dark_border">
      <h2 className="mb-5">{title}</h2>
      {children}
    </section>
  );
}

function Meta({ label, value, status = "not_reported" }: { label: string; value: React.ReactNode; status?: DataStatusKind }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className="mt-1 font-semibold text-midnight_text dark:text-white">{displayValue(value, status)}</dd>
    </div>
  );
}

function ConnectionCard({ href, label, value }: { href: string; label: string; value: React.ReactNode }) {
  return (
    <Link className="min-w-0 overflow-hidden rounded-2xl border border-border bg-white p-4 transition hover:border-primary hover:shadow-sm dark:border-dark_border dark:bg-darkmode" href={href}>
      <div className="break-words text-2xl font-black leading-7 text-primary [overflow-wrap:anywhere]">{displayValue(value, "not_reported")}</div>
      <div className="mt-1 text-xs font-black uppercase tracking-[0.12em] text-muted">{label}</div>
    </Link>
  );
}

function Stat({ value, label, suffix = "" }: { value: number; label: string; suffix?: string }) {
  return (
    <div className="rounded-2xl border border-border p-5 dark:border-dark_border">
      <div className="text-3xl font-black text-midnight_text dark:text-white">{Number(value ?? 0).toLocaleString()}{suffix}</div>
      <div className="mt-2 text-xs font-black uppercase tracking-[0.12em] text-muted">{label}</div>
    </div>
  );
}

function RelationRecordsTable({
  records,
}: {
  records: Array<{
    reactenz_reaction_id: string;
    reactenz_enzyme_id: string;
    reactenz_chassis_id: string | null;
    chassis_label?: string | null;
    enzyme_name: string | null;
    gene_name_primary: string | null;
    has_sequence: number;
    sequence_length: number | null;
  }>;
}) {
  if (!records.length) return <p className="text-muted">No stable association records available.</p>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-border dark:border-dark_border">
      <table className="w-full min-w-[1080px] text-left text-sm">
        <thead className="bg-hero-bg text-muted dark:bg-dark_b">
          <tr>
            <th className="px-4 py-3">Reaction</th>
            <th className="px-4 py-3">Enzyme</th>
            <th className="px-4 py-3">Gene</th>
            <th className="px-4 py-3">Chassis annotation</th>
            <th className="px-4 py-3">Sequence</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border dark:divide-dark_border">
          {records.map((row, index) => (
            <tr className="align-top hover:bg-hero-bg/60 dark:hover:bg-dark_b" key={`${row.reactenz_reaction_id}-${row.reactenz_enzyme_id}-${row.chassis_label ?? "none"}-${index}`}>
              <td className="px-4 py-3 font-bold text-primary">
                <Link href={`/reactions/${row.reactenz_reaction_id}`}>{row.reactenz_reaction_id}</Link>
              </td>
              <td className="px-4 py-3">
                <Link className="font-bold text-primary hover:underline" href={`/enzymes/${row.reactenz_enzyme_id}`}>
                  {row.reactenz_enzyme_id}
                </Link>
                <div className="mt-1 text-muted">{row.enzyme_name ?? <DataStatus status="not_curated" />}</div>
              </td>
              <td className="px-4 py-3">{row.gene_name_primary ?? <DataStatus status="not_reported" />}</td>
              <td className="px-4 py-3">
                {row.reactenz_chassis_id && row.chassis_label ? (
                  <Link className="font-semibold text-primary hover:underline" href={`/chassis/${row.reactenz_chassis_id}`}>
                    {row.chassis_label}
                  </Link>
                ) : (
                  <DataStatus status="no_annotation" />
                )}
              </td>
              <td className="px-4 py-3">{row.has_sequence ? `${row.sequence_length ?? 0} aa` : <DataStatus status="sequence_not_available" />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
