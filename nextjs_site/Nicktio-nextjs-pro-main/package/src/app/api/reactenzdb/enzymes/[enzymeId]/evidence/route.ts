import { getEnzymeEvidenceBundle } from "@/lib/evidence-release";
import { getEnzyme } from "@/lib/reactenzdb";
import { apiError, apiJson, intParam, requestUrl, textParam } from "@/lib/reactenzdb-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ enzymeId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { enzymeId } = await context.params;
    const decodedId = decodeURIComponent(enzymeId);
    const enzyme = getEnzyme(decodedId);
    if (!enzyme) return apiError("Enzyme not found.", 404, { id: decodedId });
    const params = requestUrl(request).searchParams;
    const bundle = getEnzymeEvidenceBundle(enzyme.reactenz_enzyme_id, {
      evidenceClass: textParam(params, "evidenceClass"),
      outcome: textParam(params, "outcome"),
      curationStatus: textParam(params, "curationStatus"),
      parameter: textParam(params, "parameter"),
      limit: intParam(params, "limit", 40, 1, 250),
      offset: intParam(params, "offset", 0, 0, 10_000_000),
      pairLimit: intParam(params, "pairLimit", 80, 1, 250),
    });
    return apiJson(bundle, {
      endpoint: "/api/reactenzdb/enzymes/{id}/evidence",
      id: enzyme.reactenz_enzyme_id,
      evidence_release: bundle.release.metadata.release_version ?? null,
      evidence_boundary: bundle.release.metadata.automatic_exact_boundary ?? null,
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Enzyme evidence retrieval failed.", 400);
  }
}
