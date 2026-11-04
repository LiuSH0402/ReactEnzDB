import { getHostRegistryPreview } from "@/lib/hostRegistryPreview";
import { localMappingPreviewAvailable } from "@/lib/hostMappingLocalPreview";
import { hostFields, previewContractVersion, previewManifestPath, previewResponse, previewTsv } from "@/lib/hostContextPreviewContract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!localMappingPreviewAvailable()) return Response.json({ error: "Local staging preview is disabled." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const format = new URL(request.url).searchParams.get("format") ?? "json";
  if (format !== "json" && format !== "tsv") return Response.json({ error: "format must be json or tsv" }, { status: 400 });
  const rows = getHostRegistryPreview() ?? [];
  if (format === "tsv") return previewResponse(previewTsv(hostFields, rows as unknown as Array<Record<string, unknown>>), "tsv", "host-registry-local-preview.tsv");
  return previewResponse(JSON.stringify({ contract_version: previewContractVersion, publication_status: "RELEASED_IN_2026.09.1", manifest: previewManifestPath, data: rows }) + "\n", "json");
}
