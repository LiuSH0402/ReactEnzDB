import { releasePath } from "@/lib/paths";
import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { formatKineticParameterType, getStats } from "@/lib/reactenzdb";
import { getHostRegistryPreview, type HostRegistryPreviewRow } from "@/lib/hostRegistryPreview";
import { querySqlite, querySqliteStable } from "@/lib/sqlite";
import { REACTENZDB_RELEASE } from "@/lib/release";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Release statistics",
  description: "ReactEnzDB release-level reaction, enzyme, association, source-organism, chassis-annotation, kinetics, compound, and structure coverage statistics.",
  alternates: { canonical: "/statistics" },
};

type CountRow = {
  label: string;
  count: number;
  percent?: number;
  reaction_count?: number;
  enzyme_count?: number;
  organism_count?: number;
};

type ClusterLevel = {
  clusters?: number;
  compression_vs_enzyme_records?: number;
};

type StatisticsSummary = {
  release: { version: string; date: string; updated_date?: string; snapshot_id?: string };
  provenance?: { generated_at_utc?: string };
  overall: Record<string, number>;
  reaction: {
    direction: CountRow[];
    structure: CountRow[];
    annotation: CountRow[];
    ec_class: CountRow[];
  };
  enzyme: {
    sequence_length_bins: CountRow[];
    top_organisms: CountRow[];
    coverage: CountRow[];
  };
  kinetics: {
    parameter_types: CountRow[];
    source_db: CountRow[];
    assignment_status: CountRow[];
  };
  compound: {
    coverage: CountRow[];
    image_status: CountRow[];
  };
  chassis: { top_labels: CountRow[] };
  supplemental?: {
    host_pathway?: {
      counts?: Record<string, number>;
      generated_at?: string;
    };
    candidate_diversity?: {
      counts?: Record<string, number>;
      generated_at?: string;
    };
    sequence_clusters?: {
      input_audit?: { enzyme_records_with_sequence?: number };
      cluster_summary?: Record<string, ClusterLevel>;
      generated_at?: string;
    };
    model_ready?: {
      tables?: Record<string, number>;
      reaction_quality?: Record<string, number>;
      candidate_quality?: Record<string, number>;
      generated_at?: string;
    };
    advanced_selection?: {
      reaction_count?: number;
      candidate_rows?: number;
      reactions_with_known_active?: number;
      known_active_rows?: number;
      pairwise_alignment_screens?: number;
      novelty_counts?: Record<string, number>;
      generated_at?: string;
    };
  };
};

const SUMMARY_PATH = path.join(process.cwd(), "public/reactenzdb/statistics/statistics_summary.json");
const WEB_DB = releasePath("reactenzdb_web.db");
const FIGURE_SVG = "/reactenzdb/statistics/reactenzdb_statistics_overview.svg";
const SUMMARY_JSON = "/reactenzdb/statistics/statistics_summary.json";
const COLORS = ["#2f7de1", "#28aa9b", "#73a9e9", "#e6a84a", "#73839b", "#8c7bd6", "#46b878"];

function readSummary(): StatisticsSummary {
  return JSON.parse(fs.readFileSync(SUMMARY_PATH, "utf-8")) as StatisticsSummary;
}

function format(value: number | undefined) {
  return Number(value ?? 0).toLocaleString();
}

function percentage(value: number | undefined, total: number | undefined) {
  return total ? Math.min(100, Math.max(0, (Number(value ?? 0) / total) * 100)) : 0;
}

function parameterTypeLabel(value: string) {
  return formatKineticParameterType(value);
}

function loadKineticsParameterScope() {
  const published = querySqliteStable<{ label: string; count: number }>(
    WEB_DB,
    "SELECT COALESCE(parameter_type, 'not curated') AS label, COUNT(*) AS count FROM web_kinetics GROUP BY 1 ORDER BY count DESC",
  );
  const tables = querySqlite<{ name: string }>(
    WEB_DB,
    "SELECT name FROM sqlite_master WHERE type='table' AND name='web_kinetics_excluded_qc'",
  );
  const withheld = tables.length
    ? querySqliteStable<{ label: string; count: number }>(
      WEB_DB,
      "SELECT COALESCE(parameter_type, 'not curated') AS label, COUNT(*) AS count FROM web_kinetics_excluded_qc GROUP BY 1 ORDER BY count DESC",
    )
    : [];
  const sources = querySqliteStable<CountRow>(WEB_DB,
    "SELECT COALESCE(NULLIF(lower(trim(source_db)), ''), 'unknown') AS label, COUNT(*) AS count FROM web_kinetics GROUP BY 1 ORDER BY count DESC, label");
  return { published, withheld, sources };
}

function KineticParameterScope({
  published,
  withheld,
}: {
  published: CountRow[];
  withheld: CountRow[];
}) {
  return (
    <div className="stats-kinetic-scope">
      <div>
        <p>Public table</p>
        {published.map((row) => (
          <div key={row.label}>
            <strong>{parameterTypeLabel(row.label)}</strong>
            <span>{format(row.count)}</span>
          </div>
        ))}
      </div>
      <div>
        <p>Present in source, withheld by QC</p>
        {withheld.map((row) => (
          <div key={`withheld-${row.label}`}>
            <strong>{parameterTypeLabel(row.label)}</strong>
            <span>{format(row.count)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionTitle({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <div className="stats-section-title">
      <div>
        <p className="reactenz-eyebrow">{eyebrow}</p>
        <h2 className="reactenz-tools-section-title">{title}</h2>
      </div>
      <p>{children}</p>
    </div>
  );
}

function BubbleLandscape({
  stats,
  hosts,
}: {
  stats: Record<string, number>;
  hosts: HostRegistryPreviewRow[] | null;
}) {
  const items = [
    { key: "reactions", label: "Reactions", value: stats.reactions, tone: "cyan" },
    { key: "enzymes", label: "Enzymes", value: stats.enzymes, tone: "teal" },
    { key: "kinetics", label: "Kinetic records", value: stats.kinetics, tone: "violet" },
    { key: "compounds", label: "Compounds", value: stats.compounds, tone: "amber" },
  ];
  const largestCount = Math.max(1, ...items.map((item) => item.value ?? 0));

  return (
    <div className="stats-bubble-panel">
      <div className="stats-panel-heading">
        <div><span>Entity counts</span><h3>Record scale</h3></div>
        <p>Circle sizes use a compressed scale for readability. Read labels for exact counts.</p>
      </div>
      <div className="stats-bubble-cloud" role="group" aria-label="Database record counts; circle sizes use a compressed scale">
        {items.map((item) => {
          const scale = Math.pow(Math.max(0, item.value ?? 0) / largestCount, 1 / 6);
          return (
            <figure
              className="stats-bubble-item"
              key={item.label}
              data-count={item.value ?? 0}
              style={{ "--bubble-scale": scale } as CSSProperties}
              title={`${item.label}: ${format(item.value)}`}
            >
              <div className="stats-bubble-measure" aria-hidden="true">
                <div className={`stats-bubble stats-bubble-${item.tone}`} />
              </div>
              <figcaption><strong>{format(item.value)}</strong><span>{item.label}</span></figcaption>
            </figure>
          );
        })}
      </div>
      {hosts?.length ? (
        <div className="stats-host-summary">
          <strong>{format(hosts.length)}</strong>
          <div><span>Staging host models</span><p>These are host-model candidates, not a curated-host catalog. Reaction mappings have not yet been manually reviewed.</p></div>
          <Link href="/hosts">Open host registry →</Link>
        </div>
      ) : (
        <p className="stats-host-missing">Host-model staging registry is not mounted in this environment.</p>
      )}
    </div>
  );
}

function RingMetric({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pc = percentage(value, total);
  const precision = pc < 100 && pc >= 99.9 ? 2 : pc >= 99 ? 1 : 0;
  return (
    <div className="stats-ring-metric" title={`${format(value)} of ${format(total)}`}>
      <div className="stats-ring" style={{ background: `conic-gradient(${color} ${pc * 3.6}deg, #e6edf6 0deg)` }}>
        <div><strong>{pc.toFixed(precision)}%</strong></div>
      </div>
      <span>{label}</span>
      <small>{format(value)} records</small>
    </div>
  );
}

function DonutDistribution({ rows, total, label }: { rows: CountRow[]; total: number; label: string }) {
  let cursor = 0;
  const segments = rows.map((row, index) => {
    const start = cursor;
    cursor += percentage(row.count, total) * 3.6;
    return `${COLORS[index % COLORS.length]} ${start}deg ${cursor}deg`;
  });

  return (
    <div className="stats-donut-layout">
      <div className="stats-donut" style={{ background: `conic-gradient(${segments.join(",")})` }}>
        <div><strong>{format(total)}</strong><span>{label}</span></div>
      </div>
      <div className="stats-legend">
        {rows.map((row, index) => (
          <div key={row.label}>
            <i style={{ background: COLORS[index % COLORS.length] }} />
            <span>{row.label}</span>
            <strong>{percentage(row.count, total).toFixed(1)}%</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function RankedBars({ rows, maxRows = 8 }: { rows: CountRow[]; maxRows?: number }) {
  const shown = rows.slice(0, maxRows);
  const max = Math.max(...shown.map((row) => row.count), 1);
  return (
    <div className="stats-ranked-bars">
      {shown.map((row, index) => (
        <div className="stats-ranked-row" key={row.label}>
          <span>{row.label}</span>
          <div><i style={{ width: `${Math.max(3, (row.count / max) * 100)}%`, background: COLORS[index % COLORS.length] }} /></div>
          <strong>{format(row.count)}</strong>
        </div>
      ))}
    </div>
  );
}

function Histogram({ rows }: { rows: CountRow[] }) {
  const max = Math.max(...rows.map((row) => row.count), 1);
  return (
    <div className="stats-histogram" aria-label="Sequence length histogram">
      {rows.map((row, index) => (
        <div className="stats-histogram-column" key={row.label} title={`${row.label}: ${format(row.count)}`}>
          <strong>{format(row.count)}</strong>
          <div><i style={{ height: `${Math.max(4, (row.count / max) * 100)}%`, background: COLORS[index % COLORS.length] }} /></div>
          <span>{row.label}</span>
        </div>
      ))}
    </div>
  );
}

function QualitySplit({ stats }: { stats: Record<string, number> }) {
  const total = stats.reactions || 1;
  const gold = percentage(stats.gold_reactions, total);
  const silver = percentage(stats.silver_reactions, total);
  return (
    <div className="stats-quality-split">
      <div className="stats-panel-heading"><div><span>Structure coverage tiers</span><h3>Reaction structure availability</h3></div></div>
      <div className="stats-segmented-track" aria-label="Structure coverage proportions">
        <i style={{ width: `${gold}%` }} /><i style={{ width: `${silver}%` }} />
      </div>
      <div className="stats-quality-values">
        <div><i /><span>ChEBI-complete structure set</span><strong>{format(stats.gold_reactions)}</strong><small>{gold.toFixed(1)}%</small></div>
        <div><i /><span>Structure-capable set</span><strong>{format(stats.silver_reactions)}</strong><small>{silver.toFixed(1)}%</small></div>
      </div>
      <p className="mt-4 text-xs leading-6 text-muted">These sets describe compound-structure availability, not completed manual review or verified catalytic activity. The structure-capable set excludes the ChEBI-complete overlap.</p>
    </div>
  );
}

function ClusterLineChart({ levels }: { levels: Record<string, ClusterLevel> }) {
  const rows = ["NR100", "NR90", "NR70", "NR50"].map((label) => ({ label, value: Number(levels[label]?.clusters ?? 0) }));
  const max = Math.max(...rows.map((row) => row.value), 1);
  const points = rows.map((row, index) => ({ ...row, x: 72 + index * 154, y: 188 - (row.value / max) * 128 }));
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `72,188 ${line} ${points.at(-1)?.x ?? 534},188`;

  return (
    <div className="stats-line-chart">
      <svg viewBox="0 0 610 235" role="img" aria-label="Sequence cluster count across identity thresholds">
        <defs>
          <linearGradient id="clusterArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2f7de1" stopOpacity="0.22" />
            <stop offset="1" stopColor="#2f7de1" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="44" y1="188" x2="566" y2="188" className="stats-axis" />
        <polygon points={area} fill="url(#clusterArea)" />
        <polyline points={line} className="stats-cluster-line" />
        {points.map((point) => (
          <g key={point.label}>
            <circle cx={point.x} cy={point.y} r="7" />
            <text x={point.x} y={point.y - 15} textAnchor="middle">{format(point.value)}</text>
            <text x={point.x} y="215" textAnchor="middle">{point.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function ProgressMetric({ label, value, total }: { label: string; value: number; total: number }) {
  const pc = percentage(value, total);
  return (
    <div className="stats-progress-metric">
      <div><span>{label}</span><strong>{format(value)} <small>/ {format(total)}</small></strong></div>
      <div><i style={{ width: `${pc}%` }} /></div>
      <small>{pc.toFixed(1)}%</small>
    </div>
  );
}

function RankingList({ title, rows }: { title: string; rows: CountRow[] }) {
  return (
    <div className="stats-ranking-list">
      <h3>{title}</h3>
      <ol>
        {rows.slice(0, 8).map((row, index) => (
          <li key={row.label}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{row.label}</strong>
            <em>{format(row.count)}</em>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function StatisticsPage() {
  const summary = readSummary();
  const stats = { ...summary.overall, ...getStats() };
  const hosts = getHostRegistryPreview();
  const supplements = summary.supplemental ?? {};
  const diversityCounts = supplements.candidate_diversity?.counts ?? {};
  const clusterLevels = supplements.sequence_clusters?.cluster_summary ?? {};
  const modelTables = supplements.model_ready?.tables ?? {};
  const kineticsScope = loadKineticsParameterScope();
  const exportVersion = encodeURIComponent(summary.provenance?.generated_at_utc ?? summary.release.date);

  return (
    <main className="reactenz-container reactenz-page stats-page">
      <section className="reactenz-page-intro reactenz-page-compact-hero overflow-hidden lg:p-8">
        <div>
          <p className="reactenz-eyebrow">Statistics · {summary.release.version}{summary.release.updated_date ? ` · Data updated ${summary.release.updated_date}` : ""}</p>
          <h1>Data statistics</h1>
          <p className="reactenz-page-copy stats-hero-copy">Current release scale, annotation coverage, evidence composition, and 30 staging host models.</p>
        </div>
      </section>

      <section className="stats-section stats-overview-section">
        <SectionTitle eyebrow="Release overview" title="Scale and completeness">
          Current entity totals and annotation coverage. Host models are staging identities, not a curated-host catalog.
        </SectionTitle>
        <div className="stats-overview-grid">
          <BubbleLandscape stats={stats} hosts={hosts} />
          <div className="stats-coverage-panel">
            <div className="stats-panel-heading">
              <div><span>Coverage</span><h3>Data completeness</h3></div>
              <p>Share of each corresponding entity layer.</p>
            </div>
            <div className="stats-rings-grid">
              <RingMetric label="Complete reaction structures" value={stats.structure_complete_reactions} total={stats.reactions} color="#2f7de1" />
              <RingMetric label="Enzyme sequences" value={stats.enzymes_with_sequence} total={stats.enzymes} color="#28aa9b" />
              <RingMetric label="UniProt mapping" value={stats.uniprot_mapped_enzymes} total={stats.enzymes} color="#538bd1" />
              <RingMetric label="AlphaFold mapping" value={stats.alphafold_mapped_enzymes} total={stats.enzymes} color="#8c7bd6" />
              <RingMetric label="Compound SMILES" value={stats.compounds_with_smiles} total={stats.compounds} color="#e6a84a" />
              <RingMetric label="Compound images" value={stats.compound_images} total={stats.compounds} color="#46b878" />
            </div>
          </div>
        </div>
      </section>

      <section className="stats-section">
        <SectionTitle eyebrow="Reaction layer" title="Reaction composition">
          Direction is best read as a part-to-whole distribution; EC classes retain ranked bars because magnitude comparison matters here.
        </SectionTitle>
        <div className="stats-reaction-grid">
          <div className="stats-chart-panel">
            <div className="stats-panel-heading"><div><span>Direction</span><h3>Reaction direction</h3></div></div>
            <DonutDistribution rows={summary.reaction.direction} total={stats.reactions} label="reactions" />
          </div>
          <div className="stats-chart-panel">
            <div className="stats-panel-heading"><div><span>Classification</span><h3>EC class distribution</h3></div></div>
            <RankedBars rows={summary.reaction.ec_class} />
          </div>
          <QualitySplit stats={stats} />
        </div>
      </section>

      <section className="stats-section">
        <SectionTitle eyebrow="Evidence layers" title="Sequence and kinetic evidence">
          Current kinetics include Km, kcat, kcat/Km and qualifying source-verified Vmax assays. Source rows that fail reaction assignment or unit QC remain withheld; parameter presence alone does not establish a valid assay.
        </SectionTitle>
        <div className="stats-evidence-grid">
          <div className="stats-chart-panel stats-sequence-panel">
            <div className="stats-panel-heading"><div><span>Length profile</span><h3>Enzyme sequence lengths</h3></div></div>
            <Histogram rows={summary.enzyme.sequence_length_bins} />
          </div>
          <div className="stats-chart-panel">
            <div className="stats-panel-heading">
              <div><span>Kinetic evidence</span><h3>Parameter types</h3></div>
              <p>Released rows still have to pass numeric, unit, and reaction-assignment gates.</p>
            </div>
            <KineticParameterScope published={kineticsScope.published} withheld={kineticsScope.withheld} />
          </div>
        </div>
      </section>

      <section className="stats-section stats-new-layers">
        <SectionTitle eyebrow="Added analytical data" title="New release layers are now included">
          Model-ready subsets, sequence families, sequence diversity and advanced candidate selection were rebuilt from the current expanded core on 2026-10-16. Sequence analyses require an available protein sequence.
        </SectionTitle>
        <div className="stats-supplement-grid">
          <div className="stats-chart-panel stats-cluster-panel">
            <div className="stats-panel-heading">
              <div><span>Sequence families</span><h3>Clusters across identity thresholds</h3></div>
              <p>Historical input: {format(supplements.sequence_clusters?.input_audit?.enzyme_records_with_sequence)} sequence-bearing enzymes. Lower thresholds merge related sequences into broader families.</p>
            </div>
            <ClusterLineChart levels={clusterLevels} />
          </div>
          <div className="stats-chart-panel stats-model-panel">
            <div className="stats-panel-heading"><div><span>Model-ready data</span><h3>Conservative training subsets</h3></div></div>
            <ProgressMetric label="Trainable reactions" value={modelTables.model_ready_trainable_reactions ?? 0} total={modelTables.model_ready_reactions ?? 0} />
            <ProgressMetric label="Trainable enzyme candidates" value={modelTables.model_ready_trainable_enzyme_candidates ?? 0} total={modelTables.model_ready_enzyme_candidates ?? 0} />
            <div className="stats-supported-callout">
              <strong>{format(diversityCounts.reactions_with_multimodal_candidates)}</strong>
              <span>reactions with evidence-supported, structure-covered candidates in the rebuilt {format(diversityCounts.reactions)}-reaction analysis</span>
            </div>
          </div>
        </div>
      </section>

      <section className="stats-section">
        <SectionTitle eyebrow="Leading categories" title="Where records are concentrated">
          Compact ranked lists preserve exact values without adding two more repetitive bar charts.
        </SectionTitle>
        <div className="stats-rankings-grid">
          <RankingList title="Top source organisms" rows={summary.enzyme.top_organisms} />
          <RankingList title="Top chassis annotations" rows={summary.chassis.top_labels} />
        </div>
      </section>

      <section className="stats-export-strip">
        <div>
          <p className="reactenz-eyebrow">Reusable outputs</p>
          <h2 className="reactenz-tools-section-title">Use the same current-release data elsewhere</h2>
        </div>
        <div>
          <a href={`${SUMMARY_JSON}?v=${exportVersion}`} download>Download source JSON</a>
          <a href={`${FIGURE_SVG}?v=${exportVersion}`} download>Download editable SVG</a>
        </div>
      </section>
    </main>
  );
}
