import type { Metadata } from "next";
import { getStats } from "@/lib/reactenzdb";
import { getHostRegistryPreview } from "@/lib/hostRegistryPreview";
import { getPublicHeroMetrics } from "@/lib/releaseMetrics";
import { getReviewedCatalog, type ReviewedArtifact } from "@/lib/reviewedDownloads";
import { reviewedHref } from "@/lib/reviewedDownloadFiles.mjs";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Downloads", description: "Download the current ReactEnzDB snapshot, SQLite databases, CSV/TSV tables, and field dictionaries.", alternates: { canonical: "/downloads" } };

function bytes(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`;
  return `${n} B`;
}
function Button({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-primary/90">{children}</a>;
}
function FileTable({ files }: { files: ReviewedArtifact[] }) {
  return <div className="overflow-x-auto rounded-[24px] border border-border bg-white dark:border-dark_border dark:bg-darkmode">
    <table className="w-full min-w-[680px] text-left text-sm">
      <thead className="bg-hero-bg text-xs uppercase tracking-wider text-muted dark:bg-dark_b"><tr>
        <th className="px-4 py-4">File</th><th className="px-3 py-4">Rows</th><th className="px-3 py-4">Size</th><th className="px-3 py-4">Download</th>
      </tr></thead>
      <tbody className="divide-y divide-border dark:divide-dark_border">{files.map(file => <tr key={file.path}>
        <td className="px-4 py-4"><div className="max-w-[440px] break-words font-bold text-midnight_text dark:text-white">{file.name}</div>{file.rows === 0 ? <div className="mt-1 text-xs text-muted">Header only · excluded content</div> : null}</td>
        <td className="px-3 py-4 tabular-nums">{file.rows === undefined ? "—" : file.rows.toLocaleString()}</td>
        <td className="whitespace-nowrap px-3 py-4 tabular-nums">{bytes(file.size)}</td>
        <td className="px-3 py-4"><Button href={reviewedHref(file)}>Download</Button></td>
      </tr>)}</tbody>
    </table>
  </div>;
}
function FileGroup({ title, description, id, files, open = false }: { title: string; description: string; id: string; files: ReviewedArtifact[]; open?: boolean }) {
  return <details className="reactenz-download-disclosure mt-6 scroll-mt-28" id={id} open={open}>
    <summary><div><p>Release files</p><h2>{title}</h2><div>{description}</div></div><span>{files.length} files</span></summary>
    <div className="reactenz-download-disclosure-body"><FileTable files={files} /></div>
  </details>;
}
const exports = [
  { title: "Reaction table", type: "reactions", description: "Reaction identifiers, equations, structures, kinetics, and external cross-references." },
  { title: "Enzyme table", type: "enzymes", description: "Protein identity, sequences, source organisms, structures, domains, and kinetics." },
  { title: "Source-organism table", type: "organisms", description: "Organism-level reaction, enzyme, annotation, and structure summaries." },
  { title: "Chassis-annotation table", type: "chassis", description: "Reported biological-context annotations and their linked records." },
];

export default function DownloadsPage() {
  const catalog = getReviewedCatalog();
  const stats = getStats();
  const metrics = getPublicHeroMetrics(stats, getHostRegistryPreview()?.length ?? 0);
  if (!catalog) return <main className="reactenz-container reactenz-page"><section className="reactenz-page-panel"><h1>Downloads</h1><p>The download snapshot is being prepared. Please reload shortly.</p></section></main>;
  const groups = (group: ReviewedArtifact["group"]) => catalog.files.filter(file => file.group === group);
  const bundle = groups("bundle")[0];
  const core = groups("sqlite").find(file => file.name === "reactenzdb_web.db")!;
  const model = groups("sqlite").find(file => file.name === "model_ready_dataset.sqlite")!;
  return <main className="reactenz-container reactenz-page reactenz-downloads-page">
    <section id="download-availability" className="reactenz-page-panel overflow-hidden scroll-mt-28">
      <div className="reactenz-downloads-hero-grid grid gap-6 lg:grid-cols-[1fr_380px] lg:items-center">
        <div><p className="reactenz-eyebrow">Data release</p><h1 className="reactenz-downloads-hero-title mb-4">Downloads and reproducibility</h1>
          <p className="reactenz-page-copy">Download the current snapshot, SQLite databases, and CSV/TSV tables. External identifiers, literature links, and scientific context are retained.</p>
        </div>
        <div className="rounded-2xl border border-border bg-white/90 p-5 dark:border-dark_border dark:bg-darkmode/80">
          <div className="text-sm font-black uppercase tracking-wider text-muted">Current downloads</div>
          <div className="mt-3 break-words text-xl font-black text-midnight_text dark:text-white">{catalog.revision}</div>
          <dl className="mt-4 grid grid-cols-[1fr_auto] gap-2 text-sm text-midnight_text dark:text-white/80"><dt>Released</dt><dd>{catalog.release_date}</dd><dt>SQLite databases</dt><dd>{groups("sqlite").length}</dd><dt>CSV / TSV files</dt><dd>{groups("csv").length + groups("tsv").length}</dd></dl>
        </div>
      </div>
    </section>
    <section className={`mt-8 grid gap-5 md:grid-cols-3 ${metrics.length === 5 ? "xl:grid-cols-5" : "xl:grid-cols-4"}`}>
      {metrics.map(metric => <div key={metric.key} className="rounded-2xl border border-border bg-white p-5 dark:border-dark_border dark:bg-darkmode"><div className="text-3xl font-black text-midnight_text dark:text-white">{metric.value.toLocaleString()}</div><div className="mt-2 text-xs font-black uppercase tracking-wider text-muted">{metric.label}</div></div>)}
    </section>
    <section className="reactenz-recommended-downloads mt-10">
      <p className="reactenz-eyebrow">Start here</p><h2 className="reactenz-tools-section-title mb-5">Data packages</h2>
      <div className="reactenz-featured-download-grid">
        <article className="reactenz-featured-download"><p>All formats</p><h3>Complete download bundle</h3><div>{groups("sqlite").length} SQLite databases, {groups("csv").length + groups("tsv").length} CSV/TSV files, field dictionaries, citation, and accompanying notices.</div><footer><span>{bytes(bundle.size)}</span><Button href="/api/reactenzdb/release-file?file=bundle">Download ZIP</Button></footer></article>
        <article className="reactenz-featured-download"><p>Offline analysis</p><h3>ReactEnzDB SQLite</h3><div>The data-facing core database for offline joins and analysis, with collection-source columns omitted.</div><footer><span>{bytes(core.size)}</span><Button href="/api/reactenzdb/release-file?file=db">Download database</Button></footer></article>
        <article className="reactenz-featured-download"><p>Machine learning</p><h3>Model-ready dataset</h3><div>Canonical reactions, enzyme-candidate features, structures, assay summaries, and refreshed evidence scores.</div><footer><span>{bytes(model.size)}</span><Button href="/api/reactenzdb/release-file?file=model_ready_db">Download dataset</Button></footer></article>
      </div>
    </section>
    <FileGroup title="SQLite databases" description="Individual databases for core data, structures, candidates, clustering, host context, and retained planning resources." id="sqlite-files" files={groups("sqlite")} open />
    <FileGroup title="CSV tables" description="Compressed CSV files for Python, R, Excel, and other analysis tools." id="bulk-table-files" files={groups("csv")} />
    <FileGroup title="TSV tables" description="Compressed and plain TSV files, including model features and experiment-related tables." id="tsv-files" files={groups("tsv")} />
    <section className="mt-8 border-y border-border py-5 text-sm leading-7 dark:border-dark_border" id="literature-notes">
      <h2 className="text-lg font-bold">Pair-linked literature supplement</h2>
      <p>Two primary-paper notes for existing reaction–enzyme pairs, including protein identity, measurements, source locations and limits. Revision: literature-pair-notes-20261104-v1. These notes are separate from the 2026-10-30 frozen data bundle and do not increase its assertion counts.</p>
      <a className="font-bold text-primary hover:underline" href="/data/reaction-enzyme-literature.json" download>Download literature notes (JSON)</a>
    </section>
    <FileGroup title="Field dictionaries and release documents" description="Schemas, citation information, and accompanying notices." id="release-documents" files={groups("metadata")} />
    <section className="mt-10"><p className="reactenz-eyebrow">Interactive exports</p><h2 className="reactenz-tools-section-title mb-5">Filtered list-page downloads</h2>
      <p className="mb-5 text-sm leading-7 text-muted">Use the export button on each list page to keep its filters, selected rows, and visible columns. The existing XLS headers remain compatible; collection-source descriptions are omitted.</p>
      <div className="grid gap-5 lg:grid-cols-2">{exports.map(item => <article key={item.type} className="rounded-[24px] border border-border bg-white p-6 dark:border-dark_border dark:bg-darkmode"><h3>{item.title}</h3><p className="my-4 text-sm leading-7 text-muted">{item.description}</p><div className="flex flex-wrap gap-3"><Button href={`/api/reactenzdb/export?type=${item.type}&format=xls`}>Export XLS</Button><Button href={`/api/reactenzdb/export?type=${item.type}&format=tsv.gz`}>Export TSV.GZ</Button></div></article>)}</div>
    </section>
    <section className="mt-10 rounded-[24px] border border-border bg-white p-6 text-sm leading-7 text-muted dark:border-dark_border dark:bg-darkmode">
      <h2 className="mb-4 text-midnight_text dark:text-white">Snapshot and citation</h2>
      <p>Source snapshot: <code>{catalog.source_snapshot}</code>. Download revision: <code>{catalog.revision}</code>. Cite the downloaded file and its release version.</p>
      <p className="mt-3">Identified KEGG content and unresolved mixed planning pools are excluded from this download snapshot. Ordinary identifiers and external links are retained. Full scope and applicable terms are recorded in the README and accompanying notices.</p>
      <div className="mt-5 flex flex-wrap gap-3"><Button href="/api/reactenzdb/release-file?file=catalog">Download manifest</Button><Button href="/api/reactenzdb/release-file?file=citation">Download CITATION.cff</Button><Button href="/documentation/api">API documentation</Button></div>
    </section>
  </main>;
}
