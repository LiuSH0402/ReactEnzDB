import Link from "next/link";
import Badge from "@/components/ReactEnz/Badge";
import type { ExpressionArticleBundle, ExpressionCandidateRow } from "@/lib/expressionEvidence";

export function expressionTier(candidate: ExpressionCandidateRow): string {
  return candidate.evidence_type_candidate.split("_", 1)[0] || "E4";
}

export function expressionTierLabel(tier: string): string {
  return ({
    E1: "active + soluble + exact enzyme",
    E2: "active + exact enzyme",
    E3: "expressed/purified + exact enzyme",
    E4: "host–paper annotation",
  } as Record<string, string>)[tier] ?? tier;
}

export function expressionTierTone(tier: string): "green" | "blue" | "amber" | "slate" {
  if (tier === "E1") return "green";
  if (tier === "E2") return "blue";
  if (tier === "E3") return "amber";
  return "slate";
}

function candidateOutcome(candidate: ExpressionCandidateRow): string {
  const values = [candidate.expression_detected, candidate.solubility, candidate.activity, candidate.purification]
    .filter((value) => value && value !== "unknown");
  return values.length ? values.join(" · ") : "outcome not resolved";
}

export default function ExperimentalExpressionEvidence({
  bundles,
  title = "Experimental expression evidence",
}: {
  bundles: ExpressionArticleBundle[];
  title?: string;
}) {
  if (!bundles.length) {
    return (
      <div className="border-l-2 border-border pl-5 dark:border-dark_border">
        <h3 className="text-20">{title}</h3>
        <p className="mt-2 text-sm leading-7 text-muted">
          No machine-extracted experimental expression candidate is currently mapped to this record. Absence here means not yet mapped, not evidence of failed expression.
        </p>
        <Link className="mt-3 inline-flex text-sm font-black text-primary hover:underline" href="/expression-evidence">Open the evidence explorer</Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-20">{title}</h3>
          <p className="mt-1 text-sm text-muted">{bundles.reduce((sum, bundle) => sum + bundle.candidates.length, 0)} candidate evidence record{bundles.reduce((sum, bundle) => sum + bundle.candidates.length, 0) === 1 ? "" : "s"} from {bundles.length} source article{bundles.length === 1 ? "" : "s"}; pending human review.</p>
        </div>
        <Link className="text-sm font-black text-primary hover:underline" href="/expression-evidence">Evidence explorer</Link>
      </div>
      <div className="divide-y divide-border border-y border-border dark:divide-dark_border dark:border-dark_border">
        {bundles.map((bundle) => {
          const best = bundle.candidates[0];
          const tier = best ? expressionTier(best) : "E4";
          const primaryLink = bundle.links.find((link) => link.is_primary) ?? bundle.links[0];
          const recordTitle = primaryLink?.enzyme_name || primaryLink?.reactenz_enzyme_id || bundle.article.title || `Article ${bundle.article.pmid}`;
          const detailHref = best ? `/expression-evidence/record/${best.candidate_id}` : `/expression-evidence/${bundle.article.pmid}`;
          return (
            <Link
              aria-label={`View expression evidence for PMID ${bundle.article.pmid}`}
              className="group grid gap-4 py-5 transition-colors hover:bg-hero-bg/55 focus-visible:bg-hero-bg/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 dark:hover:bg-dark_b/50 dark:focus-visible:bg-dark_b/50 md:grid-cols-[130px_1fr_auto]"
              href={detailHref}
              key={bundle.article.pmid}
            >
              <div>
                <Badge tone={expressionTierTone(tier)}>{tier}</Badge>
                <div className="mt-2 text-xs font-bold uppercase tracking-[0.12em] text-muted">PMID {bundle.article.pmid}</div>
              </div>
              <div className="min-w-0">
                <div className="font-black leading-6 text-midnight_text transition-colors group-hover:text-primary dark:text-white">
                  {recordTitle}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
                  <span>{best?.host_name ?? "host unresolved"}</span>
                  {best?.source_organism ? <span>source: {best.source_organism}</span> : null}
                  <span>{best ? candidateOutcome(best) : "candidate not resolved"}</span>
                  <span>{bundle.candidates.length} mapped candidate{bundle.candidates.length === 1 ? "" : "s"}</span>
                </div>
              </div>
              <div className="flex items-center justify-between gap-5 text-left text-sm md:block md:text-right">
                <div className="font-black text-primary">{best ? `${Math.round(best.confidence * 100)}%` : "—"}</div>
                <div>
                  <div className="mt-1 text-xs text-muted">extraction confidence</div>
                  <div className="mt-2 text-xs font-black text-primary">View evidence <span aria-hidden="true">&rarr;</span></div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
