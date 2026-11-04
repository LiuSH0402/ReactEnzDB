import { getHostRegistryPreviewById } from "@/lib/hostRegistryPreview";
import { localMappingPreviewAvailable } from "@/lib/hostMappingLocalPreview";
import { previewContractVersion, previewManifestPath, previewResponse } from "@/lib/hostContextPreviewContract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ hostId: string }> }) {
  if (!localMappingPreviewAvailable()) return Response.json({ error: "Local staging preview is disabled." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const host = getHostRegistryPreviewById((await params).hostId);
  if (!host) return Response.json({ error: "Host ID not found in the staging registry." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return previewResponse(JSON.stringify({ contract_version: previewContractVersion, publication_status: "RELEASED_IN_2026.09.1", manifest: previewManifestPath, data: host }) + "\n", "json");
}
