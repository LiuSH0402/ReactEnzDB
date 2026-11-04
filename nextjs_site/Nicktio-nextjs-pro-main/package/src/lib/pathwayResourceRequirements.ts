import type { PathwayParticipant, RequestedDirection } from "./pathwayLocalCalculations";

export const resourceNames = ["ATP", "ADP", "AMP", "NADH", "NAD+", "NADPH", "NADP+", "FAD", "FADH2", "FMN", "FMNH2", "CoA", "acetyl-CoA", "SAM", "oxygen", "glutathione", "glutathione disulfide"] as const;
export type ResourceName = (typeof resourceNames)[number];
type Step = { step: number; reaction_id: string; direction: RequestedDirection; participants: PathwayParticipant[]; coefficients_confirmed: boolean };
type Link = { status: string; shared: Array<{ chebi_id: string }> };
export type ResourceLedger = { resource: ResourceName; gross_consumption: number; gross_production: number; net_requirement: number; net_production: number };

// Exact name + observed identifier pairs from the current local normalized_participants table.
// This pools documented protonation/identifier variants for a descriptive cofactor ledger;
// it is not a general chemical-identity crosswalk.
const identities: Record<ResourceName, { names: string[]; ids: string[] }> = {
  ATP: { names: ["atp"], ids: ["CHEBI:30616", "CHEBI:15422"] },
  ADP: { names: ["adp"], ids: ["CHEBI:456216", "CHEBI:16761"] },
  AMP: { names: ["amp"], ids: ["CHEBI:456215", "CHEBI:16027"] },
  NADH: { names: ["nadh"], ids: ["CHEBI:57945", "CHEBI:16908"] },
  "NAD+": { names: ["nad(+)", "nad+"], ids: ["CHEBI:57540", "CHEBI:15846"] },
  NADPH: { names: ["nadph"], ids: ["CHEBI:57783", "CHEBI:16474", "PUBCHEM:5884"] },
  "NADP+": { names: ["nadp+", "nadp"], ids: ["CHEBI:58349", "CHEBI:18009", "PUBCHEM:5886"] },
  FAD: { names: ["fad"], ids: ["CHEBI:57692"] },
  FADH2: { names: ["fadh2"], ids: ["CHEBI:58307", "PUBCHEM:46931118"] },
  FMN: { names: ["fmn"], ids: ["CHEBI:58210", "CHEBI:17621"] },
  FMNH2: { names: ["fmnh2", "reduced fmn"], ids: ["CHEBI:57618", "CHEBI:16048"] },
  CoA: { names: ["coa"], ids: ["CHEBI:57287", "CHEBI:15346", "PUBCHEM:87642"] },
  "acetyl-CoA": { names: ["acetyl-coa"], ids: ["CHEBI:57288", "CHEBI:15351", "PUBCHEM:444493"] },
  SAM: { names: ["s-adenosyl-l-methionine", "s-adenosylmethionine"], ids: ["CHEBI:59789", "CHEBI:15414", "PUBCHEM:34755"] },
  oxygen: { names: ["o2"], ids: ["CHEBI:15379", "PUBCHEM:977"] },
  glutathione: { names: ["glutathione"], ids: ["CHEBI:57925", "PUBCHEM:7048684"] },
  "glutathione disulfide": { names: ["glutathione disulfide"], ids: ["CHEBI:58297", "PUBCHEM:40467895"] },
};

function normalizeName(name: string | null): string { return (name ?? "").replace(/<[^>]*>/g, "").trim().toLowerCase().replace(/\s+/g, " "); }
function round(value: number): number { return Number(value.toFixed(6)); }

function identify(row: PathwayParticipant): { resource: ResourceName | null; error: string | null } {
  const name = normalizeName(row.source_name);
  const resource = resourceNames.find((item) => identities[item].names.includes(name)) ?? null;
  if (!resource) return { resource: null, error: null };
  if (!row.chebi_id || !identities[resource].ids.includes(row.chebi_id) || row.structure_status !== "complete") {
    return { resource: null, error: `Unreconciled resource identity: ${row.source_name ?? "unnamed"} (${row.chebi_id ?? "no ID"}).` };
  }
  return { resource, error: null };
}

function ledger(steps: Step[], weights: number[]): { rows: ResourceLedger[]; oxygen_steps: number[]; errors: string[] } {
  const totals = new Map<ResourceName, { consumption: number; production: number }>();
  const errors: string[] = [];
  const oxygen = new Set<number>();
  for (const [index, step] of steps.entries()) {
    if (step.direction === "unspecified" || !step.coefficients_confirmed || !step.participants.length) {
      errors.push(`Step ${step.step}: direction, coefficient evidence or participants missing.`);
      continue;
    }
    for (const row of step.participants) {
      const result = identify(row);
      if (result.error) { errors.push(`Step ${step.step}: ${result.error}`); continue; }
      if (!result.resource) continue;
      const coefficient = row.stoichiometric_coefficient;
      if (coefficient == null || !Number.isFinite(coefficient) || coefficient <= 0) {
        errors.push(`Step ${step.step}: invalid coefficient for ${result.resource}.`); continue;
      }
      const input = row.side === (step.direction === "forward" ? "left" : "right");
      const output = row.side === (step.direction === "forward" ? "right" : "left");
      if (!input && !output) { errors.push(`Step ${step.step}: invalid side for ${result.resource}.`); continue; }
      const entry = totals.get(result.resource) ?? { consumption: 0, production: 0 };
      if (input) { entry.consumption += coefficient * weights[index]; if (result.resource === "oxygen") oxygen.add(step.step); }
      else entry.production += coefficient * weights[index];
      totals.set(result.resource, entry);
    }
  }
  const rows = resourceNames.filter((item) => totals.has(item)).map((resource) => {
    const { consumption, production } = totals.get(resource)!;
    return { resource, gross_consumption: round(consumption), gross_production: round(production),
      net_requirement: round(Math.max(0, consumption - production)), net_production: round(Math.max(0, production - consumption)) };
  });
  return { rows, oxygen_steps: [...oxygen].sort((a, b) => a - b), errors };
}

function coefficientOnSide(step: Step, chebiId: string, output: boolean): number {
  const side = step.direction === "forward" ? (output ? "right" : "left") : (output ? "left" : "right");
  return step.participants.filter((row) => row.side === side && row.chebi_id === chebiId)
    .reduce((sum, row) => sum + (row.stoichiometric_coefficient ?? 0), 0);
}

export function calculatePathwayResources(steps: Step[], links: Link[]) {
  const unscaled = ledger(steps, steps.map(() => 1));
  if (unscaled.errors.length) return {
    status: "INSUFFICIENT" as const, reasons: unscaled.errors,
    unit_step_ledger: null, chain_scaled_ledger: null, step_multipliers: null,
    oxygen_consuming_steps: [], compartment_check: "UNVERIFIED" as const,
  };
  const weights = [1];
  const scalingReasons: string[] = [];
  if (links.length !== Math.max(0, steps.length - 1)) scalingReasons.push("Adjacent-step evidence is incomplete.");
  for (let index = 0; index < steps.length - 1; index++) {
    const link = links[index];
    if (!link || link.status !== "POSSIBLE_DIRECT_CHEMICAL_LINK" || link.shared.length !== 1) {
      scalingReasons.push(`Steps ${index + 1}–${index + 2}: no unique, confirmed main intermediate.`); break;
    }
    const produced = coefficientOnSide(steps[index], link.shared[0].chebi_id, true);
    const consumed = coefficientOnSide(steps[index + 1], link.shared[0].chebi_id, false);
    if (!Number.isFinite(produced) || !Number.isFinite(consumed) || produced <= 0 || consumed <= 0) {
      scalingReasons.push(`Steps ${index + 1}–${index + 2}: intermediate coefficients cannot determine a step ratio.`); break;
    }
    const next = weights[index] * produced / consumed;
    if (!Number.isFinite(next) || next <= 0 || next > 1e9) { scalingReasons.push("Step multiplier is not numerically safe."); break; }
    weights.push(next);
  }
  const scaled = scalingReasons.length ? null : ledger(steps, weights);
  return {
    status: scaled && !scaled.errors.length ? "SINGLE_CHAIN_PROVISIONAL" as const : "UNIT_STEP_ONLY" as const,
    reasons: scalingReasons,
    unit_step_ledger: unscaled.rows,
    chain_scaled_ledger: scaled && !scaled.errors.length ? scaled.rows : null,
    step_multipliers: scaled && !scaled.errors.length ? weights.map(round) : null,
    oxygen_consuming_steps: unscaled.oxygen_steps,
    compartment_check: "UNVERIFIED" as const,
  };
}
