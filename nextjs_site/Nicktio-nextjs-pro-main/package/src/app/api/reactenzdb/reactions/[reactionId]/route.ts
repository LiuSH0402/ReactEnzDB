import {
  apiError,
  apiJson,
  detailLimit,
  hasInclude,
  includeSet,
  requestUrl,
} from "@/lib/reactenzdb-api";
import {
  getReaction,
  getReactionAttributeEvidences,
  getReactionAttributeExternalChecks,
  getReactionChassis,
  getReactionCompoundMnxMappings,
  getReactionCompounds,
  getReactionEnzymes,
  getReactionKineticExternalChecks,
  getReactionKinetics,
  getReactionMcsaCompounds,
  getReactionMcsaEntries,
  getReactionMcsaMechanisms,
  getReactionMcsaMechanismSteps,
  getReactionMcsaReferences,
  getReactionMcsaResidues,
  getReactionMnxMappings,
  getReactionPathways,
  getReactionReferences,
  getReactionXrefs,
} from "@/lib/reactenzdb";
import { getReactionEvidenceBundle } from "@/lib/evidence-release";
import { getReactionStandardizationBundle } from "@/lib/reaction-standardization";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ reactionId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { reactionId } = await context.params;
    const url = requestUrl(request);
    const limit = detailLimit(url.searchParams);
    const includes = includeSet(url.searchParams, ["standardization", "compounds", "enzymes", "kinetics", "xrefs"]);
    const reaction = getReaction(decodeURIComponent(reactionId));
    if (!reaction) return apiError("Reaction not found.", 404, { id: reactionId });

    const data: Record<string, unknown> = { reaction };
    if (hasInclude(includes, "standardization")) data.standardization = getReactionStandardizationBundle(reaction.reaction_id);
    if (hasInclude(includes, "compounds")) data.compounds = getReactionCompounds(reaction.reaction_id);
    if (hasInclude(includes, "enzymes")) data.enzymes = getReactionEnzymes(reaction.reaction_id, limit);
    if (hasInclude(includes, "kinetics")) data.kinetics = getReactionKinetics(reaction.reaction_id, limit);
    if (hasInclude(includes, "kinetic_checks")) data.kinetic_external_checks = getReactionKineticExternalChecks(reaction.reaction_id, limit);
    if (hasInclude(includes, "attribute_evidence")) data.attribute_evidence = getReactionAttributeEvidences(reaction.reaction_id, limit);
    if (hasInclude(includes, "attribute_checks")) data.attribute_external_checks = getReactionAttributeExternalChecks(reaction.reaction_id, limit);
    if (hasInclude(includes, "chassis")) data.chassis = getReactionChassis(reaction.reaction_id);
    if (hasInclude(includes, "xrefs")) data.xrefs = getReactionXrefs(reaction.reaction_id);
    if (hasInclude(includes, "mnx")) {
      data.mnx_reactions = getReactionMnxMappings(reaction.reaction_id);
      data.mnx_compounds = getReactionCompoundMnxMappings(reaction.reaction_id);
    }
    if (hasInclude(includes, "pathways")) data.pathways = getReactionPathways(reaction.reaction_id);
    if (hasInclude(includes, "references")) data.references = getReactionReferences(reaction.reaction_id, limit);
    if (hasInclude(includes, "evidence_rc")) data.evidence_rc = getReactionEvidenceBundle(reaction.reactenz_reaction_id, { limit, pairLimit: limit });
    if (hasInclude(includes, "mcsa")) {
      data.mcsa_entries = getReactionMcsaEntries(reaction.reaction_id, limit);
      data.mcsa_residues = getReactionMcsaResidues(reaction.reaction_id, limit);
      data.mcsa_mechanisms = getReactionMcsaMechanisms(reaction.reaction_id, limit);
      data.mcsa_mechanism_steps = getReactionMcsaMechanismSteps(reaction.reaction_id, limit);
      data.mcsa_compounds = getReactionMcsaCompounds(reaction.reaction_id, limit);
      data.mcsa_references = getReactionMcsaReferences(reaction.reaction_id, limit);
    }

    return apiJson(data, {
      endpoint: "/api/reactenzdb/reactions/{id}",
      id: reaction.reactenz_reaction_id,
      include: Array.from(includes),
      limit,
      export_xls: `/api/reactenzdb/export?type=reaction-detail&id=${encodeURIComponent(reaction.reactenz_reaction_id)}`,
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Reaction retrieval failed.", 400);
  }
}
