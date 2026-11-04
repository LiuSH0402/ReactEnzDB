import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import DataStatus, { displayValue, type DataStatusKind } from "@/components/ReactEnz/DataStatus";
import { ParentBackLink } from "@/components/ReactEnz/ParentBackLink";
import DetailDownloadLink from "@/components/ReactEnz/DetailDownloadLink";
import EnzymeTable from "@/components/ReactEnz/EnzymeTable";
import ExperimentalExpressionEvidence from "@/components/ReactEnz/ExperimentalExpressionEvidence";
import ReactionTable from "@/components/ReactEnz/ReactionTable";
import {
  getChassis,
  getChassisRecords,
  getChassisSourceOrganisms,
  searchEnzymes,
  searchReactions,
  type ChassisSourceOrganismRow,
} from "@/lib/reactenzdb";
import { getExpressionEvidenceForHost } from "@/lib/expressionEvidence";

export const revalidate = 60;

type PageProps = {
  params: Promise<{ chassisId: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { chassisId } = await params;
  const chassis = getChassis(decodeURIComponent(chassisId));
  if (!chassis) notFound();
  return {
    title: `${chassis.label} chassis annotation`,
    description: `Source-retained chassis annotation ${chassis.label}, associated with ${chassis.enzyme_count.toLocaleString()} enzymes and ${chassis.reaction_count.toLocaleString()} reactions in ReactEnzDB.`,
    alternates: { canonical: `/chassis/${encodeURIComponent(chassis.reactenz_chassis_id)}` },
  };
}

const sections = [
  ["overview", "Overview"],
  ["enzymes", "Enzymes"],
  ["reactions", "Associated reactions"],
  ["source-organisms", "Source organisms"],
  ["evidence", "Evidence & annotation"],
  ["records", "Association records"],
  ["links", "Related views"],
] as const;

export default async function ChassisDetailPage({ params }: PageProps) {
  const { chassisId } = await params;
  const chassis = getChassis(decodeURIComponent(chassisId));
  if (!chassis) notFound();

  const records = getChassisRecords(chassis.label, 60);
  const sourceOrganisms = getChassisSourceOrganisms(chassis.label, 80);
  const experimentalExpression = getExpressionEvidenceForHost(chassis.label, 12);
  const reactions = searchReactions({
    chassis: chassis.label,
    complete: false,
    exactContext: true,
    skipTotal: true,
    limit: 40,
  });
  const enzymes = searchEnzymes({
    chassis: chassis.label,
    sequenceOnly: false,
    exactContext: true,
    skipTotal: true,
    limit: 40,
  });
  const structureCoverage = chassis.enzyme_count
    ? Math.round(((chassis.structured_enzyme_count ?? 0) / chassis.enzyme_count) * 100)
    : 0;

  return (
    <main className="reactenz-detail reactenz-container py-10">
      <div className="grid gap-8 lg:grid-cols-[230px_1fr]">
        <aside className="h-fit border-border text-sm dark:border-dark_border lg:sticky lg:top-[88px] lg:border-r lg:pr-5">
          <ParentBackLink href="/chassis" label="Chassis annotations" />
          <div className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-muted">Chassis annotation details</div>
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
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">Expression &amp; chassis annotations</p>
              <DetailDownloadLink type="chassis-detail" id={chassis.reactenz_chassis_id} />
            </div>
            <h1 className="mb-3">{chassis.label}</h1>
            <p className="max-w-3xl text-sm leading-7 text-muted">
              This record is a source-retained annotation and does not represent a curated metabolic host model. The label alone does not establish experimentally validated expression.
            </p>
            <dl className="mt-7 grid gap-x-8 gap-y-5 text-sm md:grid-cols-2">
              <Meta label="ReactEnzDB chassis annotation ID" value={chassis.reactenz_chassis_id} />
              <Meta label="Original annotation" value={chassis.label} />
              <Meta label="Per-label source metadata" value={null} />
              <Meta label="Review status" value={null} />
              <Meta label="Annotation richness" value={`${chassis.evidence_tier ?? "limited"} · ${chassis.evidence_score ?? 0}/100`} />
            </dl>
            <div className="mt-7 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <ConnectionCard href="#enzymes" label="Enzymes" value={chassis.enzyme_count} />
              <ConnectionCard href="#reactions" label="Associated reactions" value={chassis.reaction_count} />
              <ConnectionCard href="#source-organisms" label="Source organisms" value={chassis.organism_count} />
              <ConnectionCard href="#records" label="Association records" value={chassis.record_count} />
            </div>
          </section>

          <Section id="enzymes" title="Associated Enzymes">
            <p className="mb-4 text-sm leading-7 text-muted">
              Enzyme records associated with this source-retained annotation. Open an enzyme to inspect its source organism, sequence, structures, kinetics, and evidence context.
            </p>
            <EnzymeTable enzymes={enzymes} tableId="chassis-enzymes-table" />
          </Section>

          <Section id="reactions" title="Associated Reactions">
            <p className="mb-4 text-sm leading-7 text-muted">
              Reaction records connected through enzymes carrying this annotation. The association does not imply compatibility with a curated metabolic host.
            </p>
            <ReactionTable reactions={reactions} tableId="chassis-reactions-table" />
          </Section>

          <Section id="source-organisms" title="Source Organisms">
            <p className="mb-4 text-sm leading-7 text-muted">
              Biological sources of the associated enzyme records. Source organism describes enzyme provenance; it is not the chassis annotation or a curated host assignment.
            </p>
            <SourceOrganismTable rows={sourceOrganisms} />
            {chassis.organism_count > sourceOrganisms.length ? (
              <p className="mt-3 text-xs text-muted">Showing the first {sourceOrganisms.length.toLocaleString()} of {chassis.organism_count.toLocaleString()} source organisms.</p>
            ) : null}
          </Section>

          <Section id="evidence" title="Evidence &amp; Annotation Context">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Stat value={chassis.enzyme_count} label="Total enzymes" />
              <Stat value={chassis.structured_enzyme_count ?? 0} label="PDB or AlphaFold" />
              <Stat value={structureCoverage} label="Structure coverage" suffix="%" />
              <Stat value={chassis.evidence_score ?? 0} label="Annotation richness" suffix="/100" />
            </div>
            <p className="my-5 text-sm leading-7 text-muted">
              The core chassis record does not expose a per-label source, annotation type, PMID, or review status. The literature panel below contains separately derived candidate matches pending human review; it is not proof that the chassis label is an experimentally validated expression host.
            </p>
            <ExperimentalExpressionEvidence bundles={experimentalExpression} title={`Expression evidence candidates matching ${chassis.label}`} />
          </Section>

          <Section id="records" title="Stable Association Records">
            <p className="mb-4 text-sm leading-7 text-muted">
              Stable reaction–enzyme associations carrying this chassis annotation, with source-organism provenance retained for compatibility.
            </p>
            <AssociationRecordsTable records={records} />
          </Section>

          <Section id="links" title="Related Views">
            <div className="flex flex-wrap gap-3">
              <Link className="rounded-xl bg-primary px-4 py-3 font-semibold text-white" href={`/reactions?chassis=${encodeURIComponent(chassis.label)}&complete=false`}>
                Browse all reactions
              </Link>
              <Link className="rounded-xl border border-primary px-4 py-3 font-semibold text-primary" href={`/enzymes?chassis=${encodeURIComponent(chassis.label)}&sequence=false`}>
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

function SourceOrganismTable({ rows }: { rows: ChassisSourceOrganismRow[] }) {
  if (!rows.length) return <p className="text-muted">No source organism assigned to the associated enzyme records.</p>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-border dark:border-dark_border">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-hero-bg text-muted dark:bg-dark_b">
          <tr>
            <th className="px-4 py-3">Source Organism</th>
            <th className="px-4 py-3">Enzymes</th>
            <th className="px-4 py-3">Associated Reactions</th>
            <th className="px-4 py-3">Association Records</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border dark:divide-dark_border">
          {rows.map((row) => (
            <tr className="hover:bg-hero-bg/60 dark:hover:bg-dark_b" key={`${row.reactenz_organism_id ?? "unassigned"}-${row.organism}`}>
              <td className="px-4 py-3 font-semibold">
                {row.reactenz_organism_id ? (
                  <Link className="text-primary hover:underline" href={`/organisms/${row.reactenz_organism_id}`}>{row.organism}</Link>
                ) : row.organism}
                <div className="mt-1 text-xs text-muted">{row.reactenz_organism_id ?? "ReactEnzDB source-organism ID not assigned"}</div>
              </td>
              <td className="px-4 py-3">{row.enzyme_count.toLocaleString()}</td>
              <td className="px-4 py-3">{row.reaction_count.toLocaleString()}</td>
              <td className="px-4 py-3">{row.record_count.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AssociationRecordsTable({
  records,
}: {
  records: Array<{
    reactenz_reaction_id: string;
    reactenz_enzyme_id: string;
    reactenz_organism_id: string | null;
    enzyme_name: string | null;
    gene_name_primary: string | null;
    organism: string | null;
    protein_id: string | null;
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
            <th className="px-4 py-3">Source Organism</th>
            <th className="px-4 py-3">Gene</th>
            <th className="px-4 py-3">Protein</th>
            <th className="px-4 py-3">Sequence</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border dark:divide-dark_border">
          {records.map((row) => (
            <tr key={`${row.reactenz_reaction_id}-${row.reactenz_enzyme_id}-${row.organism}`} className="align-top hover:bg-hero-bg/60 dark:hover:bg-dark_b">
              <td className="px-4 py-3 font-bold text-primary"><Link href={`/reactions/${row.reactenz_reaction_id}`}>{row.reactenz_reaction_id}</Link></td>
              <td className="px-4 py-3">
                <Link className="font-bold text-primary hover:underline" href={`/enzymes/${row.reactenz_enzyme_id}`}>{row.reactenz_enzyme_id}</Link>
                <div className="mt-1 text-muted">{row.enzyme_name ?? <DataStatus status="not_curated" />}</div>
              </td>
              <td className="px-4 py-3">
                {row.reactenz_organism_id ? <Link className="font-semibold text-primary hover:underline" href={`/organisms/${row.reactenz_organism_id}`}>{row.organism}</Link> : row.organism ?? <DataStatus status="not_curated" />}
              </td>
              <td className="px-4 py-3">{row.gene_name_primary ?? <DataStatus status="not_reported" />}</td>
              <td className="px-4 py-3">{row.protein_id ?? <DataStatus status="not_mapped" />}</td>
              <td className="px-4 py-3">{row.has_sequence ? `${row.sequence_length ?? 0} aa` : <DataStatus status="sequence_not_available" />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
