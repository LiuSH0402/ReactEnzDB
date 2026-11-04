import { apiError, apiJson, listPaging, requestUrl, textParam } from "@/lib/reactenzdb-api";
import { searchEnzymesPage } from "@/lib/reactenzdb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = requestUrl(request);
    const { page, pageSize } = listPaging(url.searchParams);
    const sequence = textParam(url.searchParams, "sequence") ?? "all";
    const result = searchEnzymesPage({
      q: textParam(url.searchParams, "q"),
      sequenceOnly: textParam(url.searchParams, "sequence") === "true",
      sequence,
      organism: textParam(url.searchParams, "organism"),
      reactionId: textParam(url.searchParams, "reactionId"),
      chassis: textParam(url.searchParams, "chassis"),
      sort: textParam(url.searchParams, "sort") ?? "completeness",
      dir: textParam(url.searchParams, "dir") ?? "desc",
      gene: textParam(url.searchParams, "gene"),
      taxonomy: textParam(url.searchParams, "taxonomy"),
      minLength: textParam(url.searchParams, "minLength"),
      maxLength: textParam(url.searchParams, "maxLength"),
      minReactions: textParam(url.searchParams, "minReactions"),
      hasPdb: textParam(url.searchParams, "hasPdb") ?? "all",
      hasAlphaFold: textParam(url.searchParams, "hasAlphaFold") ?? "all",
      hasStructure: textParam(url.searchParams, "hasStructure") ?? "all",
      hasKinetics: textParam(url.searchParams, "hasKinetics") ?? "all",
      hasInterPro: textParam(url.searchParams, "hasInterPro") ?? "all",
      hasHighConfidenceStructure: textParam(url.searchParams, "hasHighConfidenceStructure") ?? "all",
      hasCatalyticSiteSupport: textParam(url.searchParams, "hasCatalyticSiteSupport") ?? "all",
      minStructureConfidenceScore: textParam(url.searchParams, "minStructureConfidenceScore"),
      minEvidenceScore: textParam(url.searchParams, "minEvidenceScore"),
      page,
      limit: pageSize,
    });
    return apiJson(result.rows, {
      endpoint: "/api/reactenzdb/enzymes",
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: result.totalPages,
      example_detail: result.rows[0] ? `/api/reactenzdb/enzymes/${result.rows[0].reactenz_enzyme_id}` : null,
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Enzyme search failed.", 400);
  }
}
