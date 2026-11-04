import { localMappingPreviewAvailable } from "@/lib/hostMappingLocalPreview";
import { previewManifest, previewResponse } from "@/lib/hostContextPreviewContract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!localMappingPreviewAvailable()) return Response.json({ error: "Local staging preview is disabled." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  return previewResponse(JSON.stringify(previewManifest, null, 2) + "\n", "json", "host-context-local-preview-manifest.json");
}
