import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { hostContextLayerAvailable } from "@/lib/hostRegistryPreview";

function resolveEvidencePath(): string {
  if (process.env.REACTENZDB_PATHWAY_COEFFICIENT_EVIDENCE_PATH) {
    return path.resolve(process.env.REACTENZDB_PATHWAY_COEFFICIENT_EVIDENCE_PATH);
  }
  const mounted = path.resolve("/app/host_context/reaction_evidence.tsv");
  if (fs.existsSync(mounted)) return mounted;
  return path.resolve(process.cwd(), "../../../staging/host-context/2026.09.1/qa-pathway-coefficients/reaction_evidence.tsv");
}

export type CoefficientEvidence = { status: "SOURCE_NAME_CONFIRMED" | "INSUFFICIENT"; reasons: string[] };
type CoefficientAuditCache = {
  path: string;
  mtimeMs: number;
  rows: Map<string, CoefficientEvidence>;
  sha256: string;
};

let cached: CoefficientAuditCache | null = null;

function loadCoefficientAudit(): CoefficientAuditCache | null {
  const evidencePath = resolveEvidencePath();
  if (!fs.existsSync(evidencePath)) return null;
  const stat = fs.statSync(evidencePath);
  if (cached?.path === evidencePath && cached.mtimeMs === stat.mtimeMs) return cached;

  const content = fs.readFileSync(evidencePath, "utf8");
  const rows = new Map<string, CoefficientEvidence>();
  for (const line of content.split(/\r?\n/).slice(1)) {
    if (!line) continue;
    const [id, status, reasons] = line.split("\t");
    if (/^OENA\d+$/.test(id) && (status === "SOURCE_NAME_CONFIRMED" || status === "INSUFFICIENT")) {
      rows.set(id, { status, reasons: reasons ? reasons.split(";") : [] });
    }
  }
  cached = {
    path: evidencePath,
    mtimeMs: stat.mtimeMs,
    rows,
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
  };
  return cached;
}

export function getPathwayCoefficientAuditStatus() {
  const audit = loadCoefficientAudit();
  return audit
    ? { available: true as const, entries: audit.rows.size, sha256: audit.sha256 }
    : { available: false as const, entries: 0, sha256: null };
}

export function getPathwayCoefficientEvidence(reactionId: string): CoefficientEvidence {
  if (!hostContextLayerAvailable()) {
    return { status: "INSUFFICIENT", reasons: ["HOST_CONTEXT_NOT_ENABLED"] };
  }
  const audit = loadCoefficientAudit();
  if (!audit) return { status: "INSUFFICIENT", reasons: ["NO_CURRENT_COEFFICIENT_AUDIT"] };
  return audit.rows.get(reactionId) ?? { status: "INSUFFICIENT", reasons: ["NO_CURRENT_COEFFICIENT_RECORD"] };
}
