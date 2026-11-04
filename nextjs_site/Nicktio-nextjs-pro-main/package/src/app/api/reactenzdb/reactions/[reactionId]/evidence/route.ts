import { getReactionEvidenceBundle } from "@/lib/evidence-release";
import { getReaction } from "@/lib/reactenzdb";
import { apiError, apiJson, intParam, requestUrl, textParam } from "@/lib/reactenzdb-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ reactionId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { reactionId } = await context.params;
    const decodedId = decodeURIComponent(reactionId);
    const reaction = getReaction(decodedId);
    if (!reaction) return apiError("Reaction not found.", 404, { id: decodedId });
    const params = requestUrl(request).searchParams;
    const bundle = getReactionEvidenceBundle(reaction.reactenz_reaction_id, {
      evidenceClass: textParam(params, "evidenceClass"),
      outcome: textParam(params, "outcome"),
      curationStatus: textParam(params, "curationStatus"),
      parameter: textParam(params, "parameter"),
      limit: intParam(params, "limit", 40, 1, 250),
      offset: intParam(params, "offset", 0, 0, 10_000_000),
      pairLimit: intParam(params, "pairLimit", 80, 1, 250),
    });
    return apiJson(bundle, {
      endpoint: "/api/reactenzdb/reactions/{id}/evidence",
      id: reaction.reactenz_reaction_id,
      evidence_release: bundle.release.metadata.release_version ?? null,
      evidence_boundary: bundle.release.metadata.automatic_exact_boundary ?? null,
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Reaction evidence retrieval failed.", 400);
  }
}
