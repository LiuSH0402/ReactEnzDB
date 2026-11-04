import { getEnzymeClusterMemberships, getReactionSequenceClusters, listSequenceClusters } from "@/lib/sequenceClusters";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const threshold = Number(url.searchParams.get("threshold") ?? 90);
  const reactionId = url.searchParams.get("reactionId");
  const enzymeId = url.searchParams.get("enzymeId");
  const limit = Number(url.searchParams.get("limit") ?? 100);
  if (reactionId) return Response.json({ threshold, reactionId, rows: getReactionSequenceClusters(reactionId, threshold, limit) });
  if (enzymeId) return Response.json({ enzymeId, rows: getEnzymeClusterMemberships(enzymeId) });
  const support = (url.searchParams.get("support") ?? "all") as "all" | "experimental" | "structure" | "diverse" | "underexplored";
  return Response.json({ threshold, support, rows: listSequenceClusters({ threshold, support, limit }) });
}
