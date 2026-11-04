import { releasePath } from "@/lib/paths";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { resolveReviewedFile } from "@/lib/reviewedDownloadFiles.mjs";
import { keggAccessPolicy, keggPolicyUnavailable, releaseFileAllowed } from "@/lib/keggAccessPolicy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RELEASE_DIR = releasePath();
const DOWNLOAD_DIR = path.join(RELEASE_DIR, "downloads");
const EVIDENCE_RELEASE_DIR = path.resolve(process.cwd(), "../../../evidence_work/release_candidate");

const rootFiles: Record<string, { filename: string; contentType?: string }> = {
  db: { filename: "reactenzdb_web.db", contentType: "application/vnd.sqlite3" },
  manifest: { filename: "manifest.json", contentType: "application/json; charset=utf-8" },
  data_repair_manifest: { filename: "data_repair_manifest.json", contentType: "application/json; charset=utf-8" },
  release_governance: { filename: "PUBLIC_RELEASE_GOVERNANCE.json", contentType: "application/json; charset=utf-8" },
  release_governance_readme: { filename: "PUBLIC_RELEASE_GOVERNANCE.md", contentType: "text/markdown; charset=utf-8" },
  alphafold_report: { filename: "alphafold_match_report.json", contentType: "application/json; charset=utf-8" },
  pubchem_report: { filename: "compound_pubchem_enrichment_report.json", contentType: "application/json; charset=utf-8" },
  svg_report: { filename: "compound_svg_report.json", contentType: "application/json; charset=utf-8" },
  license: { filename: "LICENSE_DATA.txt", contentType: "text/plain; charset=utf-8" },
  citation: { filename: "CITATION.cff", contentType: "text/yaml; charset=utf-8" },
  readme: { filename: "README_RELEASE.md", contentType: "text/markdown; charset=utf-8" },
  data_layer_registry: { filename: "DATA_LAYER_REGISTRY.json", contentType: "application/json; charset=utf-8" },
  data_layer_registry_readme: { filename: "DATA_LAYER_REGISTRY.md", contentType: "text/markdown; charset=utf-8" },
  retrosynthesis_tool_registry: { filename: "RETROSYNTHESIS_TOOL_REGISTRY.json", contentType: "application/json; charset=utf-8" },
  retrosynthesis_tool_registry_readme: { filename: "RETROSYNTHESIS_TOOL_REGISTRY.md", contentType: "text/markdown; charset=utf-8" },
  retrosynthesis_db: { filename: "retrosynthesis_resources.sqlite", contentType: "application/vnd.sqlite3" },
  retrosynthesis_summary: { filename: "retrosynthesis_resources.summary.json", contentType: "application/json; charset=utf-8" },
  retrosynthesis_readme: { filename: "RETROSYNTHESIS_RESOURCES.md", contentType: "text/markdown; charset=utf-8" },
  retrosynthesis_mapping_report: { filename: "retrosynthesis_reactenzdb_mapping_assessment.md", contentType: "text/markdown; charset=utf-8" },
  retrosynthesis_mapping_json: { filename: "retrosynthesis_reactenzdb_mapping_assessment.json", contentType: "application/json; charset=utf-8" },
  retrosynthesis_lookup: { filename: "retrosynthesis_reaction_lookup.sqlite", contentType: "application/vnd.sqlite3" },
  model_ready_db: { filename: "model_ready_dataset.sqlite", contentType: "application/vnd.sqlite3" },
  model_ready_summary: { filename: "model_ready_dataset.summary.json", contentType: "application/json; charset=utf-8" },
  sequence_clusters_db: { filename: "enzyme_sequence_clusters.sqlite", contentType: "application/vnd.sqlite3" },
  sequence_clusters_summary: { filename: "enzyme_sequence_clusters.summary.json", contentType: "application/json; charset=utf-8" },
  sequence_clusters_readme: { filename: "ENZYME_SEQUENCE_CLUSTERS.md", contentType: "text/markdown; charset=utf-8" },
  candidate_diversity_db: { filename: "candidate_diversity_analysis.sqlite", contentType: "application/vnd.sqlite3" },
  candidate_diversity_summary: { filename: "candidate_diversity_analysis.summary.json", contentType: "application/json; charset=utf-8" },
  candidate_diversity_readme: { filename: "CANDIDATE_DIVERSITY_ANALYSIS.md", contentType: "text/markdown; charset=utf-8" },
};

const evidenceFiles: Record<string, { filename: string; contentType?: string }> = {
  evidence_rc_db: { filename: "reactenzdb_evidence_rc.sqlite", contentType: "application/vnd.sqlite3" },
  evidence_rc_summary: { filename: "reactenzdb_evidence_rc.summary.json", contentType: "application/json; charset=utf-8" },
  evidence_rc_readme: { filename: "README.md", contentType: "text/markdown; charset=utf-8" },
  evidence_rc_manifest: { filename: "manifest.json", contentType: "application/json; charset=utf-8" },
  evidence_rc_qa: { filename: "qa_report.json", contentType: "application/json; charset=utf-8" },
  evidence_rc_assertions: { filename: "tsv/evidence_assertions.tsv.gz", contentType: "application/gzip" },
  evidence_rc_measurements: { filename: "tsv/evidence_measurements.tsv.gz", contentType: "application/gzip" },
  evidence_rc_citations: { filename: "tsv/evidence_citations.tsv.gz", contentType: "application/gzip" },
  evidence_rc_pairs: { filename: "tsv/reaction_enzyme_evidence_summary.tsv.gz", contentType: "application/gzip" },
  evidence_rc_brenda_context: { filename: "tsv/brenda_context_records.tsv.gz", contentType: "application/gzip" },
};

function contentType(filename: string, fallback = "application/octet-stream"): string {
  if (filename.endsWith(".zip")) return "application/zip";
  if (filename.endsWith(".json")) return "application/json; charset=utf-8";
  if (filename.endsWith(".tsv")) return "text/tab-separated-values; charset=utf-8";
  if (filename.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (filename.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (filename.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (filename.endsWith(".cff") || filename.endsWith(".yml") || filename.endsWith(".yaml")) return "text/yaml; charset=utf-8";
  if (filename.endsWith(".sql")) return "application/sql; charset=utf-8";
  if (filename.endsWith(".gz")) return "application/gzip";
  if (filename.endsWith(".db") || filename.endsWith(".sqlite")) return "application/vnd.sqlite3";
  return fallback;
}

function resolveRequestedFile(key: string): { filePath: string; filename: string; contentType: string; allowedRoot: string } | null {
  const rootFile = rootFiles[key];
  if (rootFile) {
    const filePath = path.resolve(RELEASE_DIR, rootFile.filename);
    return { filePath, filename: rootFile.filename, contentType: rootFile.contentType ?? contentType(rootFile.filename), allowedRoot: RELEASE_DIR };
  }

  const evidenceFile = evidenceFiles[key];
  if (evidenceFile) {
    const filePath = path.resolve(EVIDENCE_RELEASE_DIR, evidenceFile.filename);
    return {
      filePath,
      filename: path.basename(evidenceFile.filename),
      contentType: evidenceFile.contentType ?? contentType(evidenceFile.filename),
      allowedRoot: EVIDENCE_RELEASE_DIR,
    };
  }

  if (key.startsWith("download:")) {
    const filename = key.slice("download:".length);
    if (!/^[A-Za-z0-9_.-]+$/.test(filename)) return null;
    if (/^host[_-]/i.test(filename) || /host_context/i.test(filename) || /host_pathway/i.test(filename) || /host_chassis/i.test(filename)) {
      return null;
    }
    const filePath = path.resolve(DOWNLOAD_DIR, filename);
    return { filePath, filename, contentType: contentType(filename), allowedRoot: DOWNLOAD_DIR };
  }

  return null;
}

function requestedFile(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("file") ?? "";
  const reviewed = resolveReviewedFile(key, Object.fromEntries(Object.entries(rootFiles).map(([name, value]) => [name, value.filename])));
  if (reviewed) {
    const stat = fs.statSync(reviewed.filePath);
    return { file: { ...reviewed, contentType: contentType(reviewed.filename) }, stat };
  }
  const file = resolveRequestedFile(key);

  if (!file) {
    return { error: Response.json({ error: "Unsupported release file." }, { status: 400 }) };
  }

  if (!releaseFileAllowed(file.filename)) return { error: keggPolicyUnavailable() };

  const relative = path.relative(file.allowedRoot, file.filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(file.filePath)) {
    return { error: Response.json({ error: "Release file not found." }, { status: 404 }) };
  }

  return { file, stat: fs.statSync(file.filePath) };
}

function downloadHeaders(file: { filename: string; contentType: string; sha256?: string | null; revision?: string }, stat: fs.Stats): Headers {
  const headers = new Headers({
    "X-ReactEnzDB-Source-Policy": keggAccessPolicy.policy_version,
    "Accept-Ranges": "bytes",
    "Content-Type": file.contentType,
    "Content-Disposition": `attachment; filename="${file.filename}"`,
    "Cache-Control": "public, max-age=3600",
    "Last-Modified": stat.mtime.toUTCString(),
    "X-Content-Type-Options": "nosniff",
    "X-Accel-Buffering": "no",
  });
  if (file.sha256) { headers.set("X-Content-SHA256", file.sha256); headers.set("ETag", `"${file.sha256}"`); }
  if (file.revision) headers.set("X-ReactEnzDB-Download-Revision", file.revision);
  return headers;
}

function byteRange(value: string | null, size: number): { start: number; end: number } | null | "invalid" {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) return "invalid";

  const startText = match[1];
  const endText = match[2];
  if (!startText && !endText) return "invalid";

  let start: number;
  let end: number;
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return "invalid";
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start) return "invalid";
  return { start, end: Math.min(end, size - 1) };
}

export async function HEAD(request: Request) {
  const resolved = requestedFile(request);
  if ("error" in resolved) return resolved.error;
  const headers = downloadHeaders(resolved.file, resolved.stat);
  headers.set("Content-Length", String(resolved.stat.size));
  return new Response(null, { headers });
}

export async function GET(request: Request) {
  const resolved = requestedFile(request);
  if ("error" in resolved) return resolved.error;

  const { file, stat } = resolved;
  const headers = downloadHeaders(file, stat);
  const etag = headers.get("ETag");
  if (etag && !request.headers.has("range") && request.headers.get("if-none-match")?.split(",").some(value => value.trim() === etag || value.trim() === "*")) {
    return new Response(null, { status: 304, headers });
  }
  const ifRange = request.headers.get("if-range");
  const rangeIsCurrent = !ifRange || ifRange === etag || (!ifRange.includes('"') && Number.isFinite(Date.parse(ifRange)) && Date.parse(ifRange) >= Math.floor(stat.mtimeMs / 1000) * 1000);
  const range = byteRange(rangeIsCurrent ? request.headers.get("range") : null, stat.size);
  if (range === "invalid") {
    headers.set("Content-Range", `bytes */${stat.size}`);
    return new Response(null, { status: 416, headers });
  }

  if (range) {
    const stream = Readable.toWeb(fs.createReadStream(file.filePath, range)) as ReadableStream;
    headers.set("Content-Length", String(range.end - range.start + 1));
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${stat.size}`);
    return new Response(stream, { status: 206, headers });
  }

  const stream = Readable.toWeb(fs.createReadStream(file.filePath)) as ReadableStream;
  headers.set("Content-Length", String(stat.size));
  return new Response(stream, { headers });
}
