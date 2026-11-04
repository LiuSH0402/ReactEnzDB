import Badge from "@/components/ReactEnz/Badge";
import { ParentBackLink } from "@/components/ReactEnz/ParentBackLink";
import DataStatus from "@/components/ReactEnz/DataStatus";
import type {
  HostCoverageRow,
  PathwayHostCoverageRow,
  ReactionClassHostCoverageRow,
} from "@/lib/hostPathwayCoverage";

type PreliminaryHostAnalysis = {
  host: HostCoverageRow;
  reactionClasses: ReactionClassHostCoverageRow[];
  pathways: PathwayHostCoverageRow[];
};

export default function PreliminaryHostModelDetail({ analysis }: { analysis: PreliminaryHostAnalysis }) {
  const { host, reactionClasses, pathways } = analysis;

  return (
    <main className="reactenz-container reactenz-page">
      <ParentBackLink href="/hosts" label="Hosts" />

      <header className="reactenz-page-intro reactenz-page-compact-hero">
        <div className="flex flex-wrap items-center gap-3">
          <p className="reactenz-eyebrow !mb-0">Preliminary Host-Model Analysis</p>
          <Badge tone={readinessTone(host.mapping_readiness)}>{readinessLabel(host.mapping_readiness)}</Badge>
        </div>
        <h1 className="mt-4 !text-[clamp(2.4rem,4.2vw,4.4rem)]">{host.host_name}</h1>
        <p className="reactenz-page-copy mt-3">
          {host.model_id} · {host.model_source}. Exact reaction identifiers define database/model overlap; EC-class matches are shown separately as context.
        </p>
      </header>

      <section className="reactenz-host-detail-metrics" aria-label="Preliminary host-model coverage summary">
        <Metric value={host.exact_native_reaction_count} label="Exact native reactions" note={`${percentage(host.exact_native_fraction_mapped_universe)} of mapped universe`} />
        <Metric value={host.ec_context_only_reaction_count} label="EC-context only" note="Supporting context, not exact identity" />
        <Metric value={host.fully_native_pathway_count} label="All-steps exact sets" note="All listed membership steps exactly mapped" />
        <Metric value={host.cofactor_panel_count} label="Cofactor panel" note={`${host.precursor_panel_count.toLocaleString()} precursor entries`} />
      </section>

      <section className="reactenz-host-detail-section">
        <div className="reactenz-section-heading-stack">
          <p className="reactenz-eyebrow">Reaction classes</p>
          <h2>Coverage by EC class</h2>
          <p>Compare exact reaction overlap across catalytic classes. The values describe the model snapshot and are not a host-performance ranking.</p>
        </div>
        <div className="overflow-x-auto rounded-[20px] border border-border dark:border-dark_border">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="bg-hero-bg text-xs uppercase tracking-[0.12em] text-muted dark:bg-dark_b">
              <tr>
                <th className="px-4 py-4">EC class</th>
                <th className="px-4 py-4 text-right">ReactEnzDB reactions</th>
                <th className="px-4 py-4 text-right">Exact native</th>
                <th className="px-4 py-4 text-right">Coverage</th>
                <th className="px-4 py-4 text-right">EC context only</th>
                <th className="px-4 py-4 text-right">Not evaluated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border dark:divide-dark_border">
              {reactionClasses.map((row) => (
                <tr className="transition-colors hover:bg-primary/[0.035]" key={row.ec_class}>
                  <td className="px-4 py-4"><strong className="text-midnight_text dark:text-white">EC {row.ec_class}</strong><span className="ml-2 text-muted">{row.ec_class_label}</span></td>
                  <td className="px-4 py-4 text-right">{row.reaction_count.toLocaleString()}</td>
                  <td className="px-4 py-4 text-right font-bold text-primary">{row.exact_native_count.toLocaleString()}</td>
                  <td className="px-4 py-4 text-right">{percentage(row.exact_native_fraction)}</td>
                  <td className="px-4 py-4 text-right">{row.ec_context_only_count.toLocaleString()}</td>
                  <td className="px-4 py-4 text-right">{row.not_evaluated_count.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="reactenz-host-detail-section">
        <div className="reactenz-section-heading-stack sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="reactenz-eyebrow">Preliminary pathway coverage</p>
            <h2>KEGG pathway membership sets</h2>
            <p>Ordered by exact overlap. These are static membership sets, not ordered or experimentally validated production routes.</p>
          </div>
          <a className="reactenz-host-api-link" href={`/api/reactenzdb/host-pathway-coverage?hostId=${encodeURIComponent(host.host_id)}`}>View unchanged API data →</a>
        </div>
        {pathways.length ? (
          <div className="overflow-x-auto rounded-[20px] border border-border dark:border-dark_border">
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead className="bg-hero-bg text-xs uppercase tracking-[0.12em] text-muted dark:bg-dark_b">
                <tr>
                  <th className="px-4 py-4">Pathway membership set</th>
                  <th className="px-4 py-4 text-right">Steps</th>
                  <th className="px-4 py-4 text-right">Exact native</th>
                  <th className="px-4 py-4">Coverage</th>
                  <th className="px-4 py-4 text-right">EC context</th>
                  <th className="px-4 py-4 text-right">Not evaluated</th>
                  <th className="px-4 py-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border dark:divide-dark_border">
                {pathways.map((row) => (
                  <tr className="align-middle transition-colors hover:bg-primary/[0.035]" key={`${row.source_db}:${row.pathway_id}`}>
                    <td className="px-4 py-4"><div className="font-bold text-midnight_text dark:text-white">{row.pathway_name ?? row.pathway_id}</div><div className="mt-1 text-xs text-muted">{row.source_db} · {row.pathway_id}</div></td>
                    <td className="px-4 py-4 text-right">{row.step_count.toLocaleString()}</td>
                    <td className="px-4 py-4 text-right font-bold text-primary">{row.exact_native_step_count.toLocaleString()}</td>
                    <td className="px-4 py-4">
                      <div className="flex min-w-[180px] items-center gap-3">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, row.exact_native_fraction * 100))}%` }} /></div>
                        <span className="w-12 text-right font-semibold">{percentage(row.exact_native_fraction)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right">{row.ec_context_only_step_count.toLocaleString()}</td>
                    <td className="px-4 py-4 text-right">{row.not_evaluated_step_count.toLocaleString()}</td>
                    <td className="px-4 py-4">{row.all_steps_exact_native ? <Badge tone="green">All listed steps exact</Badge> : <Badge tone="blue">Partial exact overlap</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-[20px] border border-border p-6 dark:border-dark_border"><DataStatus status="not_curated" /> No pathway membership records are available for this model snapshot.</div>
        )}
      </section>

      <footer className="reactenz-host-detail-note">
        <strong>Preliminary interpretation boundary</strong>
        <p>{host.mapping_boundary}</p>
        <p className="mt-2">This analysis does not establish curated-host status, in vivo activity, flux, growth, yield, expression performance, or production feasibility.</p>
      </footer>
    </main>
  );
}

function Metric({ value, label, note }: { value: number; label: string; note: string }) {
  return <div><strong>{value.toLocaleString()}</strong><span>{label}</span><small>{note}</small></div>;
}

export function percentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function readinessLabel(value: string): string {
  if (value === "available") return "Analysis-ready mapping";
  if (value === "limited_identifier_coverage") return "Limited identifier coverage";
  return "Reaction mapping unavailable";
}

export function readinessTone(value: string): "green" | "amber" | "slate" {
  if (value === "available") return "green";
  if (value === "limited_identifier_coverage") return "amber";
  return "slate";
}
