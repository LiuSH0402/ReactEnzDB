import { apiError, apiJson } from "@/lib/reactenzdb-api";
import { getEnzyme, getOrganism, getReaction, getReoRecordById } from "@/lib/reactenzdb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ reoId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { reoId } = await context.params;
    const relation = getReoRecordById(decodeURIComponent(reoId));
    if (!relation) return apiError("Reaction–Enzyme Association not found.", 404, { id: reoId });

    return apiJson(
      {
        relation,
        reaction: getReaction(relation.reaction_id),
        enzyme: getEnzyme(relation.biopart_id),
        organism: relation.reactenz_organism_id ? getOrganism(relation.reactenz_organism_id) : null,
        interpretation_boundary:
          "This association asserts a released reaction–enzyme link and retains source-organism provenance. It does not by itself assert assay-level validation, expression success in a new host, or pathway feasibility.",
      },
      {
        endpoint: "/api/reactenzdb/relations/{reo_id}",
        id: relation.reo_id,
        canonical_page: `/relations/${relation.reo_id}`,
      },
    );
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Association retrieval failed.", 400);
  }
}
