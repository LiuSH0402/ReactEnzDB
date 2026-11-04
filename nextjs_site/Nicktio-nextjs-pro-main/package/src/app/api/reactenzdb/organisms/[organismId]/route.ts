import {
  apiError,
  apiJson,
  detailLimit,
  hasInclude,
  includeSet,
  requestUrl,
} from "@/lib/reactenzdb-api";
import {
  getOrganism,
  getOrganismChassis,
  getOrganismRecords,
  searchEnzymes,
  searchReactions,
} from "@/lib/reactenzdb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ organismId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { organismId } = await context.params;
    const url = requestUrl(request);
    const limit = detailLimit(url.searchParams);
    const includes = includeSet(url.searchParams, ["records", "reactions", "enzymes", "chassis"]);
    const organism = getOrganism(decodeURIComponent(organismId));
    if (!organism) return apiError("Source organism not found.", 404, { id: organismId });

    const data: Record<string, unknown> = { organism };
    if (hasInclude(includes, "records")) data.records = getOrganismRecords(organism.organism, limit);
    if (hasInclude(includes, "reactions")) data.reactions = searchReactions({ organism: organism.organism, limit });
    if (hasInclude(includes, "enzymes")) data.enzymes = searchEnzymes({ organism: organism.organism, limit });
    if (hasInclude(includes, "chassis")) data.chassis = getOrganismChassis(organism.organism, limit);

    return apiJson(data, {
      endpoint: "/api/reactenzdb/organisms/{id}",
      id: organism.reactenz_organism_id,
      include: Array.from(includes),
      limit,
      export_xls: `/api/reactenzdb/export?type=organism-detail&id=${encodeURIComponent(organism.reactenz_organism_id)}`,
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Source-organism retrieval failed.", 400);
  }
}
