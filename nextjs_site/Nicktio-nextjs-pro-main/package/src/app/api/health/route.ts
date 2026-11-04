import { NextResponse } from "next/server";
import { getStats } from "@/lib/reactenzdb";
import { REACTENZDB_RELEASE } from "@/lib/release";
import { hostContextLayerAvailable } from "@/lib/hostRegistryPreview";
import { getPathwayCoefficientAuditStatus } from "@/lib/pathwayCoefficientLocalPreview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const stats = getStats();
    const hostContextAvailable = hostContextLayerAvailable();
    const coefficientAudit = getPathwayCoefficientAuditStatus();
    if (hostContextAvailable && !coefficientAudit.available) {
      throw new Error("Host Context is enabled but the pathway coefficient audit is unavailable.");
    }
    return NextResponse.json(
      {
        status: "ok",
        release: REACTENZDB_RELEASE.version,
        reactions: stats.reactions ?? 0,
        enzymes: stats.enzymes ?? 0,
        dependencies: {
          host_context: hostContextAvailable ? "ok" : "disabled",
          pathway_coefficient_audit: coefficientAudit.available ? "ok" : "unavailable",
          pathway_coefficient_entries: coefficientAudit.entries,
          pathway_coefficient_sha256: coefficientAudit.sha256,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Health check failed", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { status: "error", release: REACTENZDB_RELEASE.version },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
