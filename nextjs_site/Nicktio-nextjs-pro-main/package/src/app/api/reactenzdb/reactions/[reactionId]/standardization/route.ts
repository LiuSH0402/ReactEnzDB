import { apiError, apiJson } from "@/lib/reactenzdb-api";
import { getReactionStandardizationBundle } from "@/lib/reaction-standardization";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ reactionId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { reactionId } = await context.params;
    const decodedId = decodeURIComponent(reactionId);
    const bundle = getReactionStandardizationBundle(decodedId);
    if (!bundle) return apiError("Reaction standardization record not found.", 404, { id: decodedId });
    return apiJson(bundle, {
      endpoint: "/api/reactenzdb/reactions/{id}/standardization",
      id: bundle.standardization.reactenz_reaction_id,
      release_version: bundle.release.release_version,
      interpretation_boundary: bundle.release.publication_scope,
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Reaction standardization retrieval failed.", 400);
  }
}
