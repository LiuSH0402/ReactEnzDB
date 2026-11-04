import { apiError, apiJson } from "@/lib/reactenzdb-api";
import { getExpressionArticle } from "@/lib/expressionEvidence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ pmid: string }> }) {
  const { pmid } = await context.params;
  const bundle = getExpressionArticle(decodeURIComponent(pmid));
  if (!bundle) return apiError("Expression-evidence article not found.", 404);
  const safeBundle = {
    ...bundle,
    spans: bundle.spans.map(({ evidence_text, ...span }) => ({
      ...span,
      evidence_text_excerpt: evidence_text.replace(/\s+/g, " ").trim().slice(0, 520),
      excerpt_truncated: evidence_text.length > 520,
    })),
  };
  return apiJson(safeBundle, {
    endpoint: "/api/reactenzdb/expression-evidence/{pmid}",
    evidence_boundary: "Source excerpts are shortened for traceability. Consult the publication for complete context; all candidates remain pending human review.",
  });
}
