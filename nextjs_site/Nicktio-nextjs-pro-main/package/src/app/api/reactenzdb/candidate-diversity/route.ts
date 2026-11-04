import {
  getCandidateDiversityOverview,
  getReactionCandidateDiversity,
  listCandidateDiversityReactions,
} from "@/lib/candidateDiversity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const reactionId = url.searchParams.get("reactionId")?.trim();
  if (reactionId) {
    const row = getReactionCandidateDiversity(reactionId);
    return row ? Response.json({ data: row }) : Response.json({ error: "Reaction diversity record not found." }, { status: 404 });
  }
  const limit = Number(url.searchParams.get("limit") ?? 100);
  return Response.json({ overview: getCandidateDiversityOverview(), rows: listCandidateDiversityReactions(limit) });
}
