import { getReaction } from "@/lib/reactenzdb";
import { getLocalMappingsForReaction, localMappingPreviewAvailable } from "@/lib/hostMappingLocalPreview";
import { previewContractVersion, previewManifestPath, previewResponse, previewTsv, reactionHostFields } from "@/lib/hostContextPreviewContract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ reactionId: string }> }) {
  if (!localMappingPreviewAvailable()) return Response.json({ error: "Local staging preview is disabled." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const publicId = (await params).reactionId;
  if (!/^R\d{5}$/.test(publicId)) return Response.json({ error: "Expected a canonical reaction ID." }, { status: 400 });
  const reaction = getReaction(publicId);
  if (!reaction || reaction.reactenz_reaction_id !== publicId) return Response.json({ error: "Reaction not found." }, { status: 404 });
  const rows = getLocalMappingsForReaction(reaction.reaction_id);
  if (!rows) return Response.json({ error: "Staging matrix unavailable." }, { status: 503 });
  const format = new URL(request.url).searchParams.get("format") ?? "json";
  if (format !== "json" && format !== "tsv") return Response.json({ error: "format must be json or tsv" }, { status: 400 });
  if (format === "tsv") return previewResponse(previewTsv(reactionHostFields, rows as unknown as Array<Record<string, unknown>>), "tsv", `reaction-${publicId}-hosts-local-preview.tsv`);
  return previewResponse(JSON.stringify({ contract_version: previewContractVersion, publication_status: "RELEASED_IN_2026.09.1", manifest: previewManifestPath, reaction_id: publicId, data: rows }) + "\n", "json");
}
