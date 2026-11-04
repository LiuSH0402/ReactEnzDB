import { releasePath } from "@/lib/paths";
import { NextResponse } from "next/server";
import path from "node:path";
import { getReaction, getEnzyme } from "@/lib/reactenzdb";
import { getReactionEnzymeEvidenceDetail } from "@/lib/evidence-release";
import { querySqliteParams } from "@/lib/sqlite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const params = new URL(request.url).searchParams;
    const reactionId = params.get("reactionId") ?? "";
    const enzymeId = params.get("enzymeId") ?? "";
    if (!reactionId || !enzymeId || reactionId.length > 80 || enzymeId.length > 80) {
      return NextResponse.json({ error: "Provide reactionId and enzymeId." }, { status: 400, headers });
    }
    const reaction = getReaction(reactionId);
    const enzyme = getEnzyme(enzymeId);
    const publicPair = reaction && enzyme && querySqliteParams(
      releasePath("reactenzdb_web.db"),
      "SELECT 1 FROM web_reaction_enzymes WHERE reaction_id=? AND biopart_id=? LIMIT 1",
      [reaction.reaction_id, enzyme.biopart_id],
    ).length > 0;
    if (!reaction || !enzyme || !publicPair) {
      return NextResponse.json({ error: "This public reaction–enzyme association was not found." }, { status: 404, headers });
    }
    const requestedOffset = Number(params.get("offset") ?? 0);
    const offset = Number.isFinite(requestedOffset) ? Math.max(0, Math.min(100000, Math.floor(requestedOffset))) : 0;
    return NextResponse.json({
      reaction_id: reaction.reactenz_reaction_id, enzyme_id: enzyme.reactenz_enzyme_id,
      boundary: "Source assertions and separate literature notes for this reaction–enzyme pair. AI-assisted primary-text checks are not independent expert review; inspect target-substrate activity, product identification, construct and assay conditions. Separate step evidence does not validate a combined cascade.",
      ...getReactionEnzymeEvidenceDetail(reaction.reaction_id, enzyme.biopart_id, offset),
    }, { headers });
  } catch (caught) {
    console.error("Reaction–enzyme evidence retrieval failed", caught);
    return NextResponse.json({ error: "Reaction-specific evidence is temporarily unavailable." }, { status: 503, headers });
  }
}
