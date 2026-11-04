export const TOOL_PAGE_SLUGS = {
  gsetretro: "gsetretro",
  readretro: "readretro",
  bionavi_np: "bionavi-np",
  retrobiocat: "retrobiocat",
  subnetx: "subnetx",
} as const;

export type ToolPageId = keyof typeof TOOL_PAGE_SLUGS;
export type ToolPageSlug = (typeof TOOL_PAGE_SLUGS)[ToolPageId];

export const TOOL_PAGE_IDS = Object.keys(TOOL_PAGE_SLUGS) as ToolPageId[];

const SLUG_TO_ID = Object.fromEntries(
  Object.entries(TOOL_PAGE_SLUGS).map(([id, slug]) => [slug, id]),
) as Record<ToolPageSlug, ToolPageId>;

export function toolHref(toolId: string): string {
  const slug = TOOL_PAGE_SLUGS[toolId as ToolPageId];
  return slug ? `/tools/${slug}` : "/tools";
}

export function toolIdFromSlug(slug: string): ToolPageId | null {
  return SLUG_TO_ID[slug as ToolPageSlug] ?? null;
}

export function toolCapabilityLabel(capability: string): string {
  if (capability === "live_single_step_predictor") return "Single-step predictor";
  if (capability === "live_rule_based_planner") return "Rule-based pathway planner";
  if (capability === "bounded_candidate_subnetwork_extractor") return "Candidate subnetwork extractor";
  return capability.replaceAll("_", " ");
}
