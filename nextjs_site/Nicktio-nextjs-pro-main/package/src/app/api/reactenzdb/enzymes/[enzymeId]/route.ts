import {
  apiError,
  apiJson,
  detailLimit,
  hasInclude,
  includeSet,
  requestUrl,
} from "@/lib/reactenzdb-api";
import {
  getAlphaFoldMappings,
  getEnzyme,
  getEnzymeAttributeEvidences,
  getEnzymeAttributeExternalChecks,
  getEnzymeChassis,
  getEnzymeKineticExternalChecks,
  getEnzymeKinetics,
  getEnzymeMcsaCompounds,
  getEnzymeMcsaEntries,
  getEnzymeMcsaMechanisms,
  getEnzymeMcsaMechanismSteps,
  getEnzymeMcsaReferences,
  getEnzymeMcsaResidues,
  getEnzymeProteinAnnotation,
  getEnzymeProteinDomains,
  getEnzymeProteinFeatures,
  getEnzymeReactions,
  getEnzymeReferences,
  getEnzymeStructureConfidence,
  getEnzymeXrefs,
  getPdbMappings,
  getReportedExperimentalObservations,
} from "@/lib/reactenzdb";
import { getEnzymeEvidenceBundle } from "@/lib/evidence-release";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ enzymeId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { enzymeId } = await context.params;
    const url = requestUrl(request);
    const limit = detailLimit(url.searchParams);
    const includes = includeSet(url.searchParams, ["reactions", "kinetics", "structures", "protein", "xrefs", "reported_experiments"]);
    const enzyme = getEnzyme(decodeURIComponent(enzymeId));
    if (!enzyme) return apiError("Enzyme not found.", 404, { id: enzymeId });

    const data: Record<string, unknown> = { enzyme };
    if (hasInclude(includes, "reported_experiments")) data.reported_experiments = getReportedExperimentalObservations(enzyme.biopart_id);
    if (hasInclude(includes, "reactions")) data.reactions = getEnzymeReactions(enzyme.biopart_id, limit);
    if (hasInclude(includes, "kinetics")) data.kinetics = getEnzymeKinetics(enzyme.biopart_id, limit);
    if (hasInclude(includes, "kinetic_checks")) data.kinetic_external_checks = getEnzymeKineticExternalChecks(enzyme.biopart_id, limit);
    if (hasInclude(includes, "attribute_evidence")) data.attribute_evidence = getEnzymeAttributeEvidences(enzyme.biopart_id, limit);
    if (hasInclude(includes, "attribute_checks")) data.attribute_external_checks = getEnzymeAttributeExternalChecks(enzyme.biopart_id, limit);
    if (hasInclude(includes, "structures")) {
      data.pdb_mappings = getPdbMappings(enzyme.biopart_id);
      data.alphafold_mappings = getAlphaFoldMappings(enzyme.biopart_id);
      data.structure_confidence = getEnzymeStructureConfidence(enzyme.biopart_id);
    }
    if (hasInclude(includes, "protein")) {
      data.protein_annotation = getEnzymeProteinAnnotation(enzyme.biopart_id);
      data.protein_domains = getEnzymeProteinDomains(enzyme.biopart_id, limit);
      data.protein_features = getEnzymeProteinFeatures(enzyme.biopart_id, limit);
    }
    if (hasInclude(includes, "chassis")) data.chassis = getEnzymeChassis(enzyme.biopart_id);
    if (hasInclude(includes, "references")) data.references = getEnzymeReferences(enzyme.biopart_id, limit);
    if (hasInclude(includes, "evidence_rc")) data.evidence_rc = getEnzymeEvidenceBundle(enzyme.reactenz_enzyme_id, { limit, pairLimit: limit });
    if (hasInclude(includes, "xrefs")) data.xrefs = getEnzymeXrefs(enzyme.biopart_id);
    if (hasInclude(includes, "mcsa")) {
      data.mcsa_entries = getEnzymeMcsaEntries(enzyme.biopart_id, limit);
      data.mcsa_residues = getEnzymeMcsaResidues(enzyme.biopart_id, limit);
      data.mcsa_mechanisms = getEnzymeMcsaMechanisms(enzyme.biopart_id, limit);
      data.mcsa_mechanism_steps = getEnzymeMcsaMechanismSteps(enzyme.biopart_id, limit);
      data.mcsa_compounds = getEnzymeMcsaCompounds(enzyme.biopart_id, limit);
      data.mcsa_references = getEnzymeMcsaReferences(enzyme.biopart_id, limit);
    }

    return apiJson(data, {
      endpoint: "/api/reactenzdb/enzymes/{id}",
      id: enzyme.reactenz_enzyme_id,
      include: Array.from(includes),
      limit,
      export_xls: `/api/reactenzdb/export?type=enzyme-detail&id=${encodeURIComponent(enzyme.reactenz_enzyme_id)}`,
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Enzyme retrieval failed.", 400);
  }
}
