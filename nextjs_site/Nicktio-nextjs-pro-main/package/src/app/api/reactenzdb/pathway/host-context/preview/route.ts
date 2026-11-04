import { NextResponse } from "next/server";
import { getHostRegistryPreview } from "@/lib/hostRegistryPreview";
import { getLocalMappingsForReactions, localMappingPreviewAvailable, MAX_HOST_RELEASES, type LocalMappingRow } from "@/lib/hostMappingLocalPreview";
import { getReaction } from "@/lib/reactenzdb";
import { getPathwayCoefficientEvidence } from "@/lib/pathwayCoefficientLocalPreview";
import { classifyModelGap, evaluateAdjacentContinuity, evaluateDirection } from "@/lib/pathwayLocalCalculations";
import { getLocalPathwayParticipants } from "@/lib/pathwayParticipantsLocalPreview";
import { calculatePathwayResources } from "@/lib/pathwayResourceRequirements";
import { pathwayStepFields, previewContractVersion, previewManifestPath, previewResponse, previewTsv, resourceFields } from "@/lib/hostContextPreviewContract";
import { MAX_PATHWAY_STEPS, REACTION_ID_PATTERN, type PathwayInputStep } from "@/lib/pathwayHostInput";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
const reject = (error: string, status = 400) => NextResponse.json({ error }, { status, headers });

export async function POST(request: Request) {
  if (!localMappingPreviewAvailable()) return reject("Local staging mapping preview is disabled.", 503);
  const format = new URL(request.url).searchParams.get("format") ?? "json";
  if (!["json", "json-download", "steps-tsv", "resources-tsv"].includes(format)) return reject("format must be json, json-download, steps-tsv or resources-tsv.");
  const bodyText = await request.text();
  if (bodyText.length > 16_000) return reject("Preview request is too large.", 413);
  let body: unknown;
  try { body = JSON.parse(bodyText); } catch { return reject("Expected JSON input."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return reject("Expected a pathway input object.");
  const { steps, release_ids: releaseIds } = body as { steps?: unknown; release_ids?: unknown };
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > MAX_PATHWAY_STEPS) return reject(`Provide 1–${MAX_PATHWAY_STEPS} ordered reaction steps.`);
  if (!Array.isArray(releaseIds) || releaseIds.length < 1 || releaseIds.length > MAX_HOST_RELEASES || releaseIds.some((id) => typeof id !== "string") || new Set(releaseIds).size !== releaseIds.length) {
    return reject(`Select 1–${MAX_HOST_RELEASES} distinct fixed model releases.`);
  }
  if (!steps.every((step, index) => step && typeof step === "object" && !Array.isArray(step)
    && (step as PathwayInputStep).step === index + 1
    && typeof (step as PathwayInputStep).reaction_id === "string"
    && REACTION_ID_PATTERN.test((step as PathwayInputStep).reaction_id)
    && ["unspecified", "forward", "reverse"].includes((step as PathwayInputStep).direction))) {
    return reject("Steps must be ordered canonical IDs with a valid direction declaration.");
  }
  const registry = getHostRegistryPreview();
  const selected = registry?.filter((host) => releaseIds.includes(host.release_id)) ?? [];
  if (selected.length !== releaseIds.length || new Set(selected.map((host) => host.host_id)).size !== selected.length) return reject("Unknown or duplicate host model release.");

  const checked = (steps as PathwayInputStep[]).map((step) => {
    const reaction = getReaction(step.reaction_id);
    const exact = reaction?.reactenz_reaction_id === step.reaction_id;
    return { ...step, internal_reaction_id: exact ? reaction.reaction_id : null, core_direction: exact ? reaction.reaction_direction : null };
  });
  const ids = [...new Set(checked.map((step) => step.internal_reaction_id).filter((id): id is string => Boolean(id)))];
  const mapping = ids.length ? getLocalMappingsForReactions(ids, selected.map((host) => host.release_id)) : [];
  if (mapping === null) return reject("Staging matrix could not be read safely.", 503);
  const byPair = new Map(mapping.map((row) => [`${row.reaction_id}\0${row.release_id}`, row] as const));
  const participants = getLocalPathwayParticipants(ids);
  const participantsByReaction = new Map<string, typeof participants>();
  for (const participant of participants) {
    const rows = participantsByReaction.get(participant.reaction_id) ?? [];
    rows.push(participant);
    participantsByReaction.set(participant.reaction_id, rows);
  }
  const outputSteps = checked.map((step) => {
    const coefficientEvidence = step.internal_reaction_id
      ? getPathwayCoefficientEvidence(step.internal_reaction_id)
      : { status: "INSUFFICIENT" as const, reasons: ["UNKNOWN_REACTION_ID"] };
    return {
      step: step.step,
      reaction_id: step.reaction_id,
      requested_direction: step.direction,
      core_direction: step.core_direction,
      record_status: step.internal_reaction_id ? "FOUND" : "UNKNOWN_ID",
      coefficient_evidence: coefficientEvidence,
      hosts: selected.map((host) => {
        const row: LocalMappingRow | undefined = step.internal_reaction_id
          ? byPair.get(`${step.internal_reaction_id}\0${host.release_id}`) : undefined;
        const mappingStatus = row?.mapping_status ?? "NO_MATRIX_ROW";
        const directionCheck = evaluateDirection(step.direction, step.core_direction, mappingStatus, row?.direction_relation ?? null, coefficientEvidence.status === "SOURCE_NAME_CONFIRMED");
        return {
          host_id: host.host_id,
          release_id: host.release_id,
          mapping_status: mappingStatus,
          model_reaction_id: row?.model_reaction_id ?? null,
          direction_relation: row?.direction_relation ?? null,
          qc_flags_json: row?.qc_flags_json ?? "[]",
          direction_check: directionCheck,
          model_gap_check: classifyModelGap(mappingStatus, directionCheck.status),
        };
      }),
    };
  });
  const adjacentLinks = outputSteps.slice(0, -1).map((step, index) => {
    const next = outputSteps[index + 1];
    const a = checked[index].internal_reaction_id;
    const b = checked[index + 1].internal_reaction_id;
    const assessment = a && b
      ? evaluateAdjacentContinuity(
          participantsByReaction.get(a) ?? [], participantsByReaction.get(b) ?? [],
          checked[index].direction, checked[index + 1].direction,
          step.coefficient_evidence.status === "SOURCE_NAME_CONFIRMED" && next.coefficient_evidence.status === "SOURCE_NAME_CONFIRMED",
        )
      : { status: "INSUFFICIENT" as const, shared: [], reason: "A reaction ID is unknown." };
    return { from_step: step.step, to_step: next.step, ...assessment, compartment_check: "UNVERIFIED" as const };
  });
  const resourceRequirements = calculatePathwayResources(checked.map((step, index) => ({
    step: step.step, reaction_id: step.reaction_id, direction: step.direction,
    participants: step.internal_reaction_id ? participantsByReaction.get(step.internal_reaction_id) ?? [] : [],
    coefficients_confirmed: outputSteps[index].coefficient_evidence.status === "SOURCE_NAME_CONFIRMED",
  })), adjacentLinks);
  const summaries = selected.map((host) => {
    const hostSteps = outputSteps.map((step) => step.hosts.find((item) => item.release_id === host.release_id)!);
    const statuses = hostSteps.map((item) => item.mapping_status);
    return {
      host_id: host.host_id, release_id: host.release_id, model_name: host.model_name,
      recorded_exact_native_steps: statuses.filter((status) => status === "EXACT_NATIVE").length,
      recorded_directional_native_steps: statuses.filter((status) => status === "DIRECTIONAL_NATIVE").length,
      context_only_steps: statuses.filter((status) => status === "CONTEXT_ONLY").length,
      not_mapped_in_model_steps: statuses.filter((status) => status === "NOT_MAPPED").length,
      unresolved_or_missing_steps: statuses.filter((status) => status === "UNRESOLVED" || status === "NO_MATRIX_ROW").length,
      unknown_reaction_id_steps: outputSteps.filter((step) => step.record_status === "UNKNOWN_ID").length,
      coefficient_evidence_insufficient_steps: outputSteps.filter((step) => step.coefficient_evidence.status === "INSUFFICIENT").length,
      direction_supported_record_steps: hostSteps.filter((item) => item.direction_check.status === "SUPPORTED_IN_MODEL_RECORD").length,
      direction_conflict_steps: hostSteps.filter((item) => item.direction_check.status === "CONFLICTS_WITH_MODEL_RECORD").length,
      model_no_exact_match_steps: hostSteps.filter((item) => item.model_gap_check === "MODEL_NO_EXACT_MATCH").length,
    };
  });
  const result = {
    contract_version: previewContractVersion, manifest: previewManifestPath,
    schema_version: "pathway-host-local-staging-preview-v3",
    staging_only: false, reviewed: false, publication_status: "RELEASED_IN_2026.09.1",
    direction_check_scope: "RECORDED_MODEL_BOUNDS_PARTIAL",
    pathway_connectivity_scope: "EXACT_CHEBI_DIRECT_ADJACENCY_COMPARTMENT_UNVERIFIED",
    heterologous_scope: "FIXED_MODEL_MAPPING_GAP_ONLY",
    selected_releases: selected.map((host) => ({ host_id: host.host_id, release_id: host.release_id, model_name: host.model_name })),
    summaries, steps: outputSteps, adjacent_links: adjacentLinks, pathway_resource_requirements: resourceRequirements,
    note: "Local, unreviewed calculations only. Resource totals use declared direction and coefficients; a unit-step ledger is not flux-scaled. A chain-scaled ledger requires one unique adjacent intermediate per pair and still does not validate compartments, transport or flux. A model mapping gap is not biological absence. No host supply, suitability, growth or implementation feasibility is claimed.",
  };
  if (format === "steps-tsv") {
    const rows = outputSteps.flatMap((step) => step.hosts.map((host) => ({
      step: step.step, reactenz_reaction_id: step.reaction_id, requested_direction: step.requested_direction,
      coefficient_status: step.coefficient_evidence.status, host_id: host.host_id, release_id: host.release_id,
      mapping_status: host.mapping_status, model_reaction_id: host.model_reaction_id,
      direction_check: host.direction_check.status, model_gap_check: host.model_gap_check,
    })));
    return previewResponse(previewTsv(pathwayStepFields, rows), "tsv", "pathway-steps-local-preview.tsv");
  }
  if (format === "resources-tsv") {
    const ledgerRows = [
      ...(resourceRequirements.unit_step_ledger ?? []).map((row) => ({ ...row, ledger_type: "UNIT_STEP", status: resourceRequirements.status, step_multipliers: "", compartment_check: resourceRequirements.compartment_check })),
      ...(resourceRequirements.chain_scaled_ledger ?? []).map((row) => ({ ...row, ledger_type: "SINGLE_CHAIN_PROVISIONAL", status: resourceRequirements.status, step_multipliers: resourceRequirements.step_multipliers?.join(":") ?? "", compartment_check: resourceRequirements.compartment_check })),
    ];
    const response = previewResponse(previewTsv(resourceFields, ledgerRows), "tsv", "pathway-resources-local-preview.tsv");
    response.headers.set("X-Analysis-Status", resourceRequirements.status);
    return response;
  }
  return previewResponse(JSON.stringify(result) + "\n", "json", format === "json-download" ? "pathway-host-context-local-preview.json" : undefined);
}
