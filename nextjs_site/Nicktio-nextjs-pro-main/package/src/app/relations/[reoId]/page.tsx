import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ReoCompositeDetails from "@/components/ReactEnz/ReoCompositeDetails";
import { ParentBackLink } from "@/components/ReactEnz/ParentBackLink";
import { getEnzyme, getOrganism, getReaction, getReoRecordById } from "@/lib/reactenzdb";

export const revalidate = 60;
type PageProps = { params: Promise<{ reoId: string }> };

const sections = [
  ["overview", "Overview"],
  ["reo-reaction", "Reaction identity"],
  ["reo-reaction-participants", "Participants"],
  ["reo-reaction-pathways", "Pathways & mechanism"],
  ["reo-reaction-activity", "Reaction evidence"],
  ["reo-enzyme", "Enzyme identity"],
  ["reo-enzyme-sequence", "Sequence & families"],
  ["reo-enzyme-annotation", "Protein annotation"],
  ["reo-enzyme-mechanism", "Enzyme mechanism"],
  ["reo-enzyme-kinetics", "Kinetics & structure"],
  ["reo-enzyme-evidence", "Enzyme evidence"],
  ["reo-organism", "Source provenance"],
  ["reo-organism-expression", "Expression evidence"],
  ["reo-organism-structure", "Structure coverage"],
  ["interpretation", "Interpretation"],
] as const;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { reoId } = await params;
  const record = getReoRecordById(decodeURIComponent(reoId));
  if (!record) notFound();
  return { title: `${record.reo_id} association` };
}

export default async function ReoDetailPage({ params }: PageProps) {
  const { reoId } = await params;
  const record = getReoRecordById(decodeURIComponent(reoId));
  if (!record) notFound();
  const relationId = record.reo_id;
  const reaction = getReaction(record.reaction_id);
  const enzyme = getEnzyme(record.biopart_id);
  const organism = record.reactenz_organism_id ? getOrganism(record.reactenz_organism_id) : null;

  return (
    <main className="reactenz-detail reactenz-container py-10">
      <div className="grid gap-8 lg:grid-cols-[230px_1fr]">
        <aside className="h-fit border-border text-sm dark:border-dark_border lg:sticky lg:top-[88px] lg:border-r lg:pr-5">
          <ParentBackLink href="/relations" label="Associations" />
          <div className="mb-4 hidden text-xs font-semibold uppercase tracking-[0.16em] text-muted lg:block">Association record</div>
          <details className="lg:hidden">
            <summary className="cursor-pointer list-none rounded-xl border border-border bg-white px-4 py-3 font-black text-midnight_text dark:border-dark_border dark:bg-darkmode dark:text-white">Jump to record section</summary>
            <nav className="mt-3 grid grid-cols-2 gap-1">
              {sections.map(([id, label]) => <a className="rounded-lg px-3 py-2 font-semibold text-muted transition hover:bg-primary/5 hover:text-primary" href={`#${id}`} key={id}>{label}</a>)}
            </nav>
          </details>
          <nav className="hidden space-y-1 lg:block">
            {sections.map(([id, label]) => <a className="block border-l-2 border-transparent px-3 py-2 font-semibold text-muted transition hover:border-primary hover:bg-primary/[0.035] hover:text-primary" href={`#${id}`} key={id}>{label}</a>)}
          </nav>
        </aside>

        <div className="min-w-0">
          <header className="reactenz-page-intro reactenz-page-compact-hero scroll-mt-8 !mb-0" id="overview">
            <p className="reactenz-eyebrow">Reaction–Enzyme Association</p>
            <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
              <h1>{relationId}</h1>
              <span className="mb-2 font-mono text-sm font-black uppercase tracking-[0.16em] text-cyan-200">Stable association ID</span>
            </div>
            <p className="reactenz-page-copy">A source-attributed link between one reaction and one enzyme record, with source-organism provenance and supporting evidence shown as separate context.</p>
          </header>

          <section className="grid gap-5 border-b border-border py-7 dark:border-dark_border md:grid-cols-2">
            <IdentitySummary letter="R" label="Reaction" id={record.reactenz_reaction_id} value={reaction?.reaction_equation_display || record.reaction_equation_display || record.reaction_id} />
            <IdentitySummary letter="E" label="Enzyme" id={record.reactenz_enzyme_id} value={enzyme?.enzyme_name || record.enzyme_name || "Unnamed enzyme"} />
            <div className="border-l-2 border-primary/30 pl-4 md:col-span-2">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-muted">Source-organism provenance</p>
              <strong className="mt-1 block text-lg text-midnight_text dark:text-white">{organism?.organism || record.organism || "Organism not reported"}</strong>
              <span className="mt-1 block font-mono text-sm font-bold text-primary">{record.reactenz_organism_id || "No source-organism ID"}</span>
              <p className="mt-2 text-xs leading-5 text-muted">Biological source annotation for the enzyme record; this is not an engineering-host assignment.</p>
            </div>
            <dl className="grid gap-4 border-t border-border pt-5 text-sm dark:border-dark_border sm:grid-cols-3 md:col-span-2">
              <div><dt className="text-xs font-black uppercase tracking-[0.12em] text-muted">Evidence</dt><dd className="mt-1 font-bold text-midnight_text dark:text-white">{record.evidence_level ?? record.source_db ?? "Not curated"}</dd></div>
              <div><dt className="text-xs font-black uppercase tracking-[0.12em] text-muted">Pair-linked kinetics</dt><dd className="mt-1 font-bold text-midnight_text dark:text-white">{record.kinetic_count.toLocaleString()}</dd></div>
              <div><dt className="text-xs font-black uppercase tracking-[0.12em] text-muted">Linked publication PMIDs</dt><dd className="mt-1 font-bold text-midnight_text dark:text-white">{record.reference_count.toLocaleString()}</dd></div>
            </dl>
          </section>

          <ReoCompositeDetails biopartId={record.biopart_id} organismId={record.reactenz_organism_id} reactionId={record.reaction_id} />

          <footer className="mt-12 scroll-mt-8 border-l-2 border-primary bg-hero-bg px-6 py-5 text-sm leading-7 text-muted dark:bg-dark_b" id="interpretation">
            <strong className="text-midnight_text dark:text-white">Interpretation boundary</strong>
            <p>This association record identifies a database link between a reaction and an enzyme. Source-organism provenance, chassis annotations, and linked literature do not by themselves establish catalytic activity, successful heterologous expression, or compatibility with a particular engineering host.</p>
          </footer>
        </div>
      </div>
    </main>
  );
}


function IdentitySummary({ letter, label, id, value }: { letter: string; label: string; id: string; value: string }) {
  return <div className="group grid grid-cols-[44px_1fr] gap-4"><span className="grid h-11 w-11 place-items-center rounded-full bg-primary font-black text-white shadow-sm transition group-hover:-translate-y-0.5 group-hover:shadow-md">{letter}</span><div className="min-w-0"><p className="text-xs font-black uppercase tracking-[0.14em] text-muted">{label}</p><strong className="mt-1 block truncate text-lg text-midnight_text dark:text-white" title={value}>{value}</strong><span className="mt-1 block font-mono text-sm font-bold text-primary">{id}</span></div></div>;
}
