import { NextResponse } from "next/server";
import { getHostRegistryPreview } from "@/lib/hostRegistryPreview";
import { getReaction } from "@/lib/reactenzdb";
import { MAX_HOST_RELEASES } from "@/lib/hostMappingLocalPreview";
import { MAX_PATHWAY_STEPS, REACTION_ID_PATTERN, type PathwayInputStep } from "@/lib/pathwayHostInput";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };
function reject(error: string, status = 400) { return NextResponse.json({ error }, { status, headers }); }

export async function POST(request: Request) {
  const bodyText = await request.text();
  if (bodyText.length > 16_000) return reject("Validation request is too large.", 413);
  let body: unknown;
  try { body = JSON.parse(bodyText); } catch { return reject("Expected JSON input."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return reject("Expected a pathway input object.");
  const { steps, release_ids: releaseIds } = body as { steps?: unknown; release_ids?: unknown };
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > MAX_PATHWAY_STEPS) return reject(`Provide 1–${MAX_PATHWAY_STEPS} ordered reaction steps.`);
  if (!Array.isArray(releaseIds) || releaseIds.length < 1 || releaseIds.length > MAX_HOST_RELEASES || releaseIds.some((id) => typeof id !== "string")) return reject(`Select 1–${MAX_HOST_RELEASES} fixed model releases.`);
  if (new Set(releaseIds).size !== releaseIds.length) return reject("Select each model release only once.");
  if (!steps.every((step, index) => step && typeof step === "object" && !Array.isArray(step)
    && (step as PathwayInputStep).step === index + 1
    && typeof (step as PathwayInputStep).reaction_id === "string"
    && REACTION_ID_PATTERN.test((step as PathwayInputStep).reaction_id)
    && ["unspecified", "forward", "reverse"].includes((step as PathwayInputStep).direction))) {
    return reject("Steps must be ordered, use canonical ReactEnzDB IDs, and declare forward, reverse or unspecified direction.");
  }

  const registry = getHostRegistryPreview();
  if (!registry) return reject("Staging host registry is not mounted in this environment; validation is unavailable.", 503);
  const selected = registry.filter((host) => releaseIds.includes(host.release_id));
  if (selected.length !== releaseIds.length || new Set(selected.map((host) => host.host_id)).size !== selected.length) {
    return reject("Selected releases must be distinct current registry hosts.");
  }

  const checked = (steps as PathwayInputStep[]).map((step) => {
    const reaction = getReaction(step.reaction_id);
    const exact = reaction?.reactenz_reaction_id === step.reaction_id;
    return {
      step: step.step,
      reaction_id: step.reaction_id,
      requested_direction: step.direction,
      record_status: exact ? "FOUND" : "UNKNOWN_ID",
      equation: exact ? reaction.reaction_equation_display : null,
      recorded_direction: exact ? reaction.reaction_direction : null,
      // Deliberately no reaction × host lookup or inferred mapping status.
    };
  });
  return NextResponse.json({
    schema_version: "pathway-host-input-validation-v1",
    validation_only: true,
    all_record_ids_found: checked.every((step) => step.record_status === "FOUND"),
    mapping_publication_status: "RELEASED_IN_2026.09.1",
    selected_releases: selected.map((host) => ({ host_id: host.host_id, release_id: host.release_id, model_name: host.model_name })),
    steps: checked,
    note: "Record identity and selected staging releases were checked. Requested pathway direction was not chemically validated. No reaction–host mapping, growth, pathway implementation or suitability was calculated.",
  }, { headers });
}
