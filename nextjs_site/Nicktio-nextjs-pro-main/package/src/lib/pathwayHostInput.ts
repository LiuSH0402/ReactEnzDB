export type PathwayDirection = "unspecified" | "forward" | "reverse";
export type PathwayInputStep = { step: number; reaction_id: string; direction: PathwayDirection };
export type PathwayInputResult = { steps: PathwayInputStep[]; errors: string[]; warnings: string[] };

export const MAX_PATHWAY_STEPS = 30;
export const MAX_PATHWAY_INPUT_CHARS = 16_000;
export const REACTION_ID_PATTERN = /^R\d{5}$/;

function result(rows: Array<{ reaction_id: unknown; direction?: unknown; step?: unknown }>): PathwayInputResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!rows.length) errors.push("Provide at least one ReactEnzDB reaction ID.");
  if (rows.length > MAX_PATHWAY_STEPS) errors.push(`A pathway may contain at most ${MAX_PATHWAY_STEPS} steps in this preview.`);
  const seen = new Set<string>();
  const steps = rows.slice(0, MAX_PATHWAY_STEPS).map((row, index) => {
    const id = typeof row.reaction_id === "string" ? row.reaction_id.trim().toUpperCase() : "";
    const direction = row.direction === undefined || row.direction === "" ? "unspecified" : row.direction;
    if (!REACTION_ID_PATTERN.test(id)) errors.push(`Step ${index + 1}: use a canonical ReactEnzDB ID such as R00001 (not a rule, compound, or internal ID).`);
    if (direction !== "unspecified" && direction !== "forward" && direction !== "reverse") errors.push(`Step ${index + 1}: direction must be forward, reverse, or unspecified.`);
    if (row.step !== undefined && row.step !== index + 1) errors.push(`Step ${index + 1}: the step number must be ${index + 1}; rows are never reordered silently.`);
    if (seen.has(id) && id) warnings.push(`Step ${index + 1}: ${id} also appears earlier; repeated reactions are retained.`);
    seen.add(id);
    return { step: index + 1, reaction_id: id, direction: direction as PathwayDirection };
  });
  if (steps.some((step) => step.direction === "unspecified")) warnings.push("Pathway direction is unspecified for one or more steps; no net stoichiometry or implementation claim can be made.");
  return { steps, errors, warnings };
}

function overLimit(text: string): PathwayInputResult | null {
  return text.length > MAX_PATHWAY_INPUT_CHARS
    ? { steps: [], errors: [`Input exceeds ${MAX_PATHWAY_INPUT_CHARS.toLocaleString()} characters.`], warnings: [] }
    : null;
}

export function parseManualPathway(text: string, direction: PathwayDirection = "unspecified"): PathwayInputResult {
  const limit = overLimit(text);
  if (limit) return limit;
  const ids = text
    .split(/[\r\n,;]+/)
    .flatMap((line) => line.trim().split(/\s+/))
    .map((id) => id.trim().toUpperCase())
    .filter(Boolean);
  return result(ids.map((reaction_id) => ({ reaction_id, direction })));
}

export function parseTsvPathway(text: string): PathwayInputResult {
  const limit = overLimit(text);
  if (limit) return limit;
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  while (lines.at(-1)?.trim() === "") lines.pop();
  const header = lines.shift()?.split("\t").map((value) => value.trim().toLowerCase()) ?? [];
  const hasDirection = header.length === 3 && header.join("\t") === "step\treaction_id\tdirection";
  if (!hasDirection && !(header.length === 2 && header.join("\t") === "step\treaction_id")) {
    return { steps: [], errors: ["TSV header must be step<TAB>reaction_id, optionally followed by <TAB>direction."], warnings: [] };
  }
  const errors: string[] = [];
  const rows = lines.map((line, index) => {
    const cells = line.split("\t").map((value) => value.trim());
    if (cells.length !== header.length || !/^\d+$/.test(cells[0] ?? "")) errors.push(`TSV line ${index + 2}: expected ${header.length} tab-separated fields and an integer step.`);
    return { step: Number(cells[0]), reaction_id: cells[1], direction: hasDirection ? cells[2] : undefined };
  });
  const parsed = result(rows);
  return { ...parsed, errors: [...errors, ...parsed.errors] };
}

export function parseRetrosynthesisPathway(text: string): PathwayInputResult {
  const limit = overLimit(text);
  if (limit) return limit;
  let input: unknown;
  try { input = JSON.parse(text); } catch { return { steps: [], errors: ["Paste valid JSON from a reaction-matching result or an ID-resolved steps array."], warnings: [] }; }
  if (!input || typeof input !== "object" || Array.isArray(input)) return { steps: [], errors: ["Expected a JSON object containing an exact reaction match or steps."], warnings: [] };
  const payload = input as Record<string, unknown>;
  if (payload.classification && typeof payload.classification === "object") {
    const level = (payload.classification as Record<string, unknown>).level;
    const target = payload.target as Record<string, unknown> | null | undefined;
    if (level !== "exact_query_structures" || !target?.reactenz_reaction_id) {
      return { steps: [], errors: ["This prediction has no unique exact ReactEnzDB reaction match. Resolve the reaction before import."], warnings: [] };
    }
    return result([{ reaction_id: target.reactenz_reaction_id }]);
  }
  if (Array.isArray(payload.steps)) {
    return result(payload.steps.map((step) => step && typeof step === "object" && !Array.isArray(step)
      ? step as { reaction_id: unknown; direction?: unknown; step?: unknown }
      : { reaction_id: null }));
  }
  if (Array.isArray(payload.pathways) || Array.isArray(payload.core_paths)) {
    return { steps: [], errors: ["This tool returns reaction-rule labels or compound paths, not stable ReactEnzDB reaction IDs. Resolve each step first; nothing was imported."], warnings: [] };
  }
  return { steps: [], errors: ["Expected an exact /api/retrosynthesis/match response or {\"steps\":[{\"reaction_id\":\"R00001\"}]} with stable IDs."], warnings: [] };
}
