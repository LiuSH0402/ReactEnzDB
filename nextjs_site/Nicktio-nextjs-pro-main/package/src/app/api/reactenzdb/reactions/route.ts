import { apiError, apiJson, boolParam, listPaging, requestUrl, textParam } from "@/lib/reactenzdb-api";
import { searchReactionsPage } from "@/lib/reactenzdb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = requestUrl(request);
    const { page, pageSize } = listPaging(url.searchParams);
    const result = searchReactionsPage({
      q: textParam(url.searchParams, "q"),
      dataset: textParam(url.searchParams, "dataset"),
      direction: textParam(url.searchParams, "direction") ?? "all",
      complete: boolParam(url.searchParams, "complete"),
      organism: textParam(url.searchParams, "organism"),
      chassis: textParam(url.searchParams, "chassis"),
      sort: textParam(url.searchParams, "sort") ?? "completeness",
      dir: textParam(url.searchParams, "dir") ?? "desc",
      ec: textParam(url.searchParams, "ec"),
      rhea: textParam(url.searchParams, "rhea"),
      kegg: textParam(url.searchParams, "kegg"),
      metacyc: textParam(url.searchParams, "metacyc"),
      mnx: textParam(url.searchParams, "mnx"),
      minEnzymes: textParam(url.searchParams, "minEnzymes"),
      minKinetics: textParam(url.searchParams, "minKinetics"),
      minEvidenceScore: textParam(url.searchParams, "minEvidenceScore"),
      massBalance: textParam(url.searchParams, "massBalance"),
      chargeBalance: textParam(url.searchParams, "chargeBalance"),
      stereoStatus: textParam(url.searchParams, "stereoStatus"),
      structureStatus: textParam(url.searchParams, "structureStatus"),
      exactRhea: boolParam(url.searchParams, "exactRhea"),
      atomMapped: boolParam(url.searchParams, "atomMapped"),
      conflictFree: boolParam(url.searchParams, "conflictFree"),
      page,
      limit: pageSize,
    });
    return apiJson(result.rows, {
      endpoint: "/api/reactenzdb/reactions",
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: result.totalPages,
      example_detail: result.rows[0] ? `/api/reactenzdb/reactions/${result.rows[0].reactenz_reaction_id}` : null,
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Reaction search failed.", 400);
  }
}
