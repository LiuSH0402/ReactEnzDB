import assert from "node:assert/strict";
import test from "node:test";
import { calculatePathwayResources } from "../src/lib/pathwayResourceRequirements.ts";

const row = (side, source_name, chebi_id, stoichiometric_coefficient) => ({
  reaction_id: "OENA1", side, source_name, chebi_id, stoichiometric_coefficient,
  structure_status: "complete", participant_role: "main_substrate",
});
const first = { step: 1, reaction_id: "R1", direction: "forward", coefficients_confirmed: true,
  participants: [row("left", "ATP", "CHEBI:30616", 2), row("right", "NADH", "CHEBI:57945", 1), row("right", "B", "CHEBI:B", 2)] };
const second = { step: 2, reaction_id: "R2", direction: "forward", coefficients_confirmed: true,
  participants: [row("left", "B", "CHEBI:B", 1), row("left", "NADH", "CHEBI:57945", 3), row("left", "O2", "CHEBI:15379", 1), row("right", "ATP", "CHEBI:30616", 1)] };
const link = { status: "POSSIBLE_DIRECT_CHEMICAL_LINK", shared: [{ chebi_id: "CHEBI:B" }] };

test("stoichiometric resource totals cancel internally and a unique intermediate scales the chain", () => {
  const result = calculatePathwayResources([first, second], [link]);
  assert.equal(result.status, "SINGLE_CHAIN_PROVISIONAL");
  assert.deepEqual(result.step_multipliers, [1, 2]);
  const unit = new Map(result.unit_step_ledger.map((item) => [item.resource, item]));
  const scaled = new Map(result.chain_scaled_ledger.map((item) => [item.resource, item]));
  assert.deepEqual([unit.get("ATP").gross_consumption, unit.get("ATP").gross_production, unit.get("ATP").net_requirement], [2, 1, 1]);
  assert.deepEqual([scaled.get("ATP").gross_consumption, scaled.get("ATP").gross_production, scaled.get("ATP").net_requirement], [2, 2, 0]);
  assert.deepEqual([scaled.get("NADH").gross_consumption, scaled.get("NADH").gross_production, scaled.get("NADH").net_requirement], [6, 1, 5]);
  assert.deepEqual(result.oxygen_consuming_steps, [2]);
});

test("direction reversal changes consumption and production", () => {
  const result = calculatePathwayResources([{ ...first, direction: "reverse" }], []);
  const atp = result.chain_scaled_ledger.find((item) => item.resource === "ATP");
  assert.equal(atp.gross_production, 2);
  assert.equal(atp.net_requirement, 0);
});

test("uncertain identity or coefficient evidence blocks numeric claims", () => {
  assert.equal(calculatePathwayResources([{ ...first, coefficients_confirmed: false }], []).status, "INSUFFICIENT");
  assert.equal(calculatePathwayResources([{ ...first, participants: [row("left", "ATP", "CHEBI:unknown", 1)] }], []).status, "INSUFFICIENT");
  assert.equal(calculatePathwayResources([{ ...first, direction: "unspecified" }], []).status, "INSUFFICIENT");
});

test("ambiguous or absent adjacent identity yields only the unscaled step ledger", () => {
  const result = calculatePathwayResources([first, second], [{ ...link, shared: [{ chebi_id: "CHEBI:B" }, { chebi_id: "CHEBI:C" }] }]);
  assert.equal(result.status, "UNIT_STEP_ONLY");
  assert.equal(result.chain_scaled_ledger, null);
  assert.ok(result.unit_step_ledger.length);
});
