import assert from "node:assert/strict";
import test from "node:test";
import { evaluateDirection, evaluateAdjacentContinuity, classifyModelGap } from "../src/lib/pathwayLocalCalculations.ts";

const p = (side, chebi_id, source_name, role = "main_product") => ({
  reaction_id: "OENA1", side, chebi_id, source_name, stoichiometric_coefficient: 1,
  structure_status: "complete", participant_role: role,
});

test("REVERSE means reversed stored equation orientation, not automatic reverse pathway support", () => {
  assert.equal(evaluateDirection("forward", "=>", "DIRECTIONAL_NATIVE", "REVERSE").status, "SUPPORTED_IN_MODEL_RECORD");
  assert.equal(evaluateDirection("reverse", "=>", "DIRECTIONAL_NATIVE", "REVERSE").status, "CONFLICTS_WITH_MODEL_RECORD");
  assert.equal(evaluateDirection("reverse", "<=", "EXACT_NATIVE", "SAME").status, "SUPPORTED_IN_MODEL_RECORD");
  assert.equal(evaluateDirection("forward", "=>", "DIRECTIONAL_NATIVE", "HOST_REVERSIBLE").status, "SUPPORTED_IN_MODEL_RECORD");
  assert.equal(evaluateDirection("forward", "<=>", "DIRECTIONAL_NATIVE", "REACTENZDB_REVERSIBLE").status, "INSUFFICIENT");
  assert.equal(evaluateDirection("unspecified", "=>", "EXACT_NATIVE", "SAME").status, "INSUFFICIENT");
  assert.equal(evaluateDirection("forward", "=>", "EXACT_NATIVE", "SAME", false).status, "INSUFFICIENT");
});

test("model gaps are not transformed into host suitability or biological absence", () => {
  assert.equal(classifyModelGap("NOT_MAPPED", "NO_EXACT_MODEL_MAPPING"), "MODEL_NO_EXACT_MATCH");
  assert.equal(classifyModelGap("CONTEXT_ONLY", "NO_EXACT_MODEL_MAPPING"), "CONTEXT_ONLY_NO_NATIVE_MATCH");
  assert.equal(classifyModelGap("EXACT_NATIVE", "CONFLICTS_WITH_MODEL_RECORD"), "DIRECTION_CONFLICT");
  assert.equal(classifyModelGap("UNRESOLVED", "INSUFFICIENT"), "INSUFFICIENT");
});

test("adjacent link needs declared directions, reconciled coefficients and a noncurrency exact identity", () => {
  const product = p("right", "CHEBI:123", "L-lactate");
  const substrate = p("left", "CHEBI:123", "L-lactate", "main_substrate");
  assert.equal(evaluateAdjacentContinuity([product], [substrate], "forward", "forward", true).status, "POSSIBLE_DIRECT_CHEMICAL_LINK");
  assert.equal(evaluateAdjacentContinuity([product], [substrate], "unspecified", "forward", true).status, "INSUFFICIENT");
  assert.equal(evaluateAdjacentContinuity([product], [substrate], "forward", "forward", false).status, "INSUFFICIENT");
  assert.equal(evaluateAdjacentContinuity([p("right", "CHEBI:15377", "H2O", "water")], [p("left", "CHEBI:15377", "H2O", "water")], "forward", "forward", true).status, "CURRENCY_ONLY_LINK");
  assert.equal(evaluateAdjacentContinuity([product], [p("left", "CHEBI:999", "pyruvate", "main_substrate")], "forward", "forward", true).status, "NO_DIRECT_MAIN_PARTICIPANT_LINK");
});
