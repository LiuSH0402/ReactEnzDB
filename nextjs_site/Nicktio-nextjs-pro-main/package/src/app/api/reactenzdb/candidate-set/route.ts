import { NextRequest, NextResponse } from "next/server";
import {
  candidateModes,
  candidateSetTsv,
  getCandidateReactionSummary,
  getCandidateSet,
  type CandidateMode,
} from "@/lib/candidateSelection";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const reactionId = request.nextUrl.searchParams.get("reactionId")?.trim() ?? "";
  const requestedMode = request.nextUrl.searchParams.get("mode") ?? "best-supported";
  const mode: CandidateMode = candidateModes.includes(requestedMode as CandidateMode)
    ? requestedMode as CandidateMode
    : "best-supported";
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit")) || 100, 1), 500);

  if (!reactionId) {
    return NextResponse.json({ error: "reactionId is required" }, { status: 400 });
  }
  const summary = getCandidateReactionSummary(reactionId);
  if (!summary) {
    return NextResponse.json({ error: "No sequence-bearing candidates were found for this reaction." }, { status: 404 });
  }
  const rows = getCandidateSet(reactionId, mode, limit);
  if (request.nextUrl.searchParams.get("format") === "tsv") {
    const filename = `${summary.reactenz_reaction_id}_${mode}_enzyme_candidates.tsv`;
    return new NextResponse(candidateSetTsv(rows, mode), {
      headers: {
        "content-type": "text/tab-separated-values; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  }
  return NextResponse.json({ summary, mode, count: rows.length, rows });
}
