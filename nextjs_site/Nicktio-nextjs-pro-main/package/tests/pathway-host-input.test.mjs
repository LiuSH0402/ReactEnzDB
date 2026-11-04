import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseManualPathway, parseTsvPathway, parseRetrosynthesisPathway } from "../src/lib/pathwayHostInput.ts";

test("manual input preserves order and repeated reactions without inventing direction", () => {
  const parsed = parseManualPathway("R00001\nR03369\nR00001\n");
  assert.deepEqual(parsed.steps.map(({ step, reaction_id, direction }) => [step, reaction_id, direction]), [
    [1, "R00001", "unspecified"], [2, "R03369", "unspecified"], [3, "R00001", "unspecified"],
  ]);
  assert.equal(parsed.errors.length, 0);
  assert.match(parsed.warnings.join(" "), /also appears earlier/);
  assert.deepEqual(parseManualPathway("R00001\nR03369", "forward").steps.map((step) => step.direction), ["forward", "forward"]);
});

test("TSV requires an exact header, contiguous order, and declared direction values", () => {
  const okay = parseTsvPathway("\uFEFFstep\treaction_id\tdirection\r\n1\tR00001\tforward\r\n2\tR03369\treverse\r\n");
  assert.equal(okay.errors.length, 0);
  assert.deepEqual(okay.steps.map((step) => step.direction), ["forward", "reverse"]);
  assert.match(parseTsvPathway("reaction_id\tstep\nR00001\t1").errors.join(" "), /header/);
  assert.match(parseTsvPathway("step\treaction_id\n2\tR00001").errors.join(" "), /must be 1/);
  assert.match(parseTsvPathway("step\treaction_id\tdirection\n1\tR00001\tsideways").errors.join(" "), /direction/);
});

test("unresolved or non-ID retrosynthesis outputs never silently become pathway steps", () => {
  const exact = parseRetrosynthesisPathway(JSON.stringify({ classification: { level: "exact_query_structures" }, target: { reactenz_reaction_id: "R00001" } }));
  assert.equal(exact.errors.length, 0);
  assert.equal(exact.steps[0].reaction_id, "R00001");
  const ambiguous = parseRetrosynthesisPathway(JSON.stringify({ classification: { level: "ambiguous_exact_structures" }, target: null }));
  assert.equal(ambiguous.steps.length, 0);
  assert.match(ambiguous.errors.join(" "), /unique exact/);
  const ruleRoute = parseRetrosynthesisPathway(JSON.stringify({ pathways: [{ steps: [{ reaction: "oxidoreductase rule" }] }] }));
  assert.equal(ruleRoute.steps.length, 0);
  assert.match(ruleRoute.errors.join(" "), /Resolve each step/);
  assert.equal(parseRetrosynthesisPathway(JSON.stringify({ core_paths: [[{ compound_id: "C1" }]] })).steps.length, 0);
});

test("manual input accepts comma-separated and lowercase IDs", () => {
  const parsed = parseManualPathway("R00001, r03309; R00002");
  assert.deepEqual(parsed.steps.map((step) => step.reaction_id), ["R00001", "R03309", "R00002"]);
  assert.equal(parsed.errors.length, 0);
});

test("ID-resolved JSON validates IDs and bounded steps", () => {
  assert.match(parseRetrosynthesisPathway('{"steps":[{"reaction_id":"RULE01"}]}').errors.join(" "), /canonical ReactEnzDB ID/);
  assert.match(parseManualPathway(Array.from({ length: 31 }, () => "R00001").join("\n")).errors.join(" "), /at most 30/);
});

test("validation endpoint is read-only and does not query host mapping or save jobs", () => {
  const root = path.resolve(import.meta.dirname, "../src");
  const route = fs.readFileSync(path.join(root, "app/api/reactenzdb/pathway/host-context/validate/route.ts"), "utf8");
  const page = fs.readFileSync(path.join(root, "app/tools/pathway-host-context/page.tsx"), "utf8");
  const matchPanel = fs.readFileSync(path.join(root, "components/ReactEnz/ReactionMatchPanel.tsx"), "utf8");
  assert.match(route, /getHostRegistryPreview\(\)/);
  assert.match(route, /getReaction\(step\.reaction_id\)/);
  assert.match(route, /mapping_publication_status: "RELEASED_IN_2026.09.1"/);
  assert.match(route, /all_record_ids_found:/);
  assert.doesNotMatch(route, /\bvalid: checked/);
  assert.doesNotMatch(route, /reaction_host_mapping|INSERT INTO|UPDATE |analysis_id|host_pathway_coverage/);
  assert.match(page, /Input validation only/);
  assert.match(matchPanel, /mapping\.classification\.level === "exact_query_structures"/);
  assert.match(matchPanel, /\/tools\/pathway-host-context\?reactionId=/);
  assert.match(matchPanel, /mapping\.matches\?\.length/);
});
