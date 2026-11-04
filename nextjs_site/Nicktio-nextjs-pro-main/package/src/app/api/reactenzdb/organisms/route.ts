import { apiError, apiJson, listPaging, requestUrl, textParam } from "@/lib/reactenzdb-api";
import { searchOrganismsPage } from "@/lib/reactenzdb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = requestUrl(request);
    const { page, pageSize } = listPaging(url.searchParams);
    const result = searchOrganismsPage({
      q: textParam(url.searchParams, "q"),
      sort: textParam(url.searchParams, "sort") ?? "completeness",
      dir: textParam(url.searchParams, "dir") ?? "desc",
      minEvidenceScore: textParam(url.searchParams, "minEvidenceScore"),
      page,
      limit: pageSize,
    });
    return apiJson(result.rows, {
      endpoint: "/api/reactenzdb/organisms",
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: result.totalPages,
      example_detail: result.rows[0] ? `/api/reactenzdb/organisms/${encodeURIComponent(result.rows[0].reactenz_organism_id)}` : null,
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Source-organism search failed.", 400);
  }
}
