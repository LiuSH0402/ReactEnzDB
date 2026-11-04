import { apiError, apiJson } from "@/lib/reactenzdb-api";
import { getEvidenceReleaseStatus } from "@/lib/evidence-release";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const status = getEvidenceReleaseStatus();
    return apiJson(status, {
      endpoint: "/api/reactenzdb/evidence/status",
      release_status: status.metadata.release_status ?? (status.available ? "available" : "unavailable"),
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Evidence release status retrieval failed.", 500);
  }
}
