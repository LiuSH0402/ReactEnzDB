import { apiJson, intParam, requestUrl, textParam } from "@/lib/reactenzdb-api";
import { getExpressionEvidenceOverview, getExpressionHosts, searchExpressionArticles } from "@/lib/expressionEvidence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = requestUrl(request).searchParams;
  const page = intParam(params, "page", 1, 1, 1000000);
  const pageSize = intParam(params, "pageSize", 20, 1, 100);
  const result = searchExpressionArticles({
    q: textParam(params, "q"), fulltext: textParam(params, "fulltext"), tier: textParam(params, "tier"),
    host: textParam(params, "host"), activity: textParam(params, "activity"), solubility: textParam(params, "solubility"),
    review: textParam(params, "review"), sort: textParam(params, "sort"), dir: textParam(params, "dir"), page, pageSize,
  });
  return apiJson(result.rows, {
    endpoint: "/api/reactenzdb/expression-evidence",
    overview: getExpressionEvidenceOverview(),
    top_hosts: getExpressionHosts(20),
    pagination: { total: result.total, page: result.page, page_size: result.pageSize, total_pages: result.totalPages },
    evidence_boundary: "Machine-extracted candidates remain pending human review. No candidate is not negative expression evidence.",
  });
}
