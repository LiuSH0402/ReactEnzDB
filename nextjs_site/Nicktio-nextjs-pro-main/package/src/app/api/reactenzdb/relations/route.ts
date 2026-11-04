import { apiError, apiJson, boolParam, listPaging, requestUrl, textParam } from "@/lib/reactenzdb-api";
import { searchReoRecordsPage } from "@/lib/reactenzdb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = requestUrl(request);
    const { page, pageSize } = listPaging(url.searchParams);
    const sequence = boolParam(url.searchParams, "hasSequence");
    const result = searchReoRecordsPage({
      q: textParam(url.searchParams, "q"),
      reaction: textParam(url.searchParams, "reaction"),
      enzyme: textParam(url.searchParams, "enzyme"),
      organism: textParam(url.searchParams, "organism"),
      hasSequence: sequence === true ? "yes" : sequence === false ? "no" : "all",
      sort: textParam(url.searchParams, "sort") ?? "reaction",
      dir: textParam(url.searchParams, "dir") ?? "asc",
      page,
      pageSize,
    });
    return apiJson(result.rows, {
      endpoint: "/api/reactenzdb/relations",
      id_policy: "Permanent monotonic reo_id; identifiers are never derived from SQLite rowid or reassigned.",
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: result.totalPages,
      example_detail: result.rows[0] ? `/api/reactenzdb/relations/${result.rows[0].reo_id}` : null,
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Association search failed.", 400);
  }
}
