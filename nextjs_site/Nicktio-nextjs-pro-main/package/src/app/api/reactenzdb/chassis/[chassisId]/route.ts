import {
  apiError,
  apiJson,
  detailLimit,
  hasInclude,
  includeSet,
  requestUrl,
} from "@/lib/reactenzdb-api";
import {
  getChassis,
  getChassisRecords,
  searchEnzymes,
  searchReactions,
} from "@/lib/reactenzdb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ chassisId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { chassisId } = await context.params;
    const url = requestUrl(request);
    const limit = detailLimit(url.searchParams);
    const includes = includeSet(url.searchParams, ["records", "reactions", "enzymes"]);
    const chassis = getChassis(decodeURIComponent(chassisId));
    if (!chassis) return apiError("Chassis annotation not found.", 404, { id: chassisId });

    const data: Record<string, unknown> = { chassis };
    if (hasInclude(includes, "records")) data.records = getChassisRecords(chassis.label, limit);
    if (hasInclude(includes, "reactions")) data.reactions = searchReactions({ chassis: chassis.label, limit });
    if (hasInclude(includes, "enzymes")) data.enzymes = searchEnzymes({ chassis: chassis.label, limit });

    return apiJson(data, {
      endpoint: "/api/reactenzdb/chassis/{id}",
      id: chassis.reactenz_chassis_id,
      include: Array.from(includes),
      limit,
      export_xls: `/api/reactenzdb/export?type=chassis-detail&id=${encodeURIComponent(chassis.reactenz_chassis_id)}`,
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Chassis-annotation retrieval failed.", 400);
  }
}
