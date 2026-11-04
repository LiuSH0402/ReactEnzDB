import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module, { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const site = path.resolve(import.meta.dirname, "..");
const original = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...args) {
  if (request.startsWith("@/")) request = path.join(site, "src", request.slice(2));
  return original.call(this, request, parent, ...args);
};
require.extensions[".ts"] = (mod, filename) => {
  mod._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText, filename);
};
const route = require("../src/app/api/retrosynthesis/match/route.ts");
const evidence = require("../src/app/api/retrosynthesis/evidence/route.ts");
const coreExists = fs.existsSync(path.resolve(process.env.REACTENZDB_RELEASE_DIR || path.resolve(site, "../../../web_release"), "reactenzdb_web.db"));
async function query(precursors, product) {
  const response = await route.POST(new Request("http://localhost/api/retrosynthesis/match", {
    method: "POST", body: JSON.stringify({ precursors, product }),
  }));
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  assert.notEqual(data.classification.level, "exact_query_structures", "candidate mappings must not be imported as accepted identities");
  return data;
}

test("actual API connects PAL, preserves D-control, and excludes GABA exchange", { skip: !coreExists }, async () => {
  const pal = await query("N[C@@H](Cc1ccccc1)C(=O)O", "O=C(O)/C=C/c1ccccc1");
  assert.ok(pal.matches.some(row => row.target.reactenz_reaction_id === "R12283"));
  assert.ok(pal.matches.every(row => row.structure_match.accepted_reaction_identity === false));
  assert.ok(pal.matches.flatMap(row => row.candidates).every(row => row.reaction_evidence_url.includes("enzymeId=")));
  const wrong = await query("N[C@H](Cc1ccccc1)C(=O)O", "O=C(O)/C=C/c1ccccc1");
  assert.equal(wrong.matches.length, 0);
  const gaba = await query("N[C@@H](CCC(=O)O)C(=O)O", "NCCCC(=O)O");
  assert.ok(gaba.excluded.some(row => row.reaction_id === "OENA4802" && row.reason.includes("transport")));
  assert.ok(!gaba.matches.some(row => row.structure_match.reaction_id === "OENA4802"));
});

test("two-step route resolves forward CAR and reverse-written ADH direction", { skip: !coreExists }, async () => {
  const car = await query("O=C(O)/C=C/c1ccccc1", "O=C/C=C/c1ccccc1");
  assert.ok(car.matches.some(row => row.target.reactenz_reaction_id === "R03262" && row.structure_match.direction_status === "supported_by_reference"));
  const adh = await query("O=C/C=C/c1ccccc1", "OC/C=C/c1ccccc1");
  const selected = adh.matches.find(row => row.target.reactenz_reaction_id === "R07661");
  assert.ok(selected);
  assert.equal(selected.structure_match.orientation, "reversed");
  assert.equal(selected.structure_match.direction_status, "supported_by_reference");
  assert.equal(selected.candidates.length, 7);
});

test("pair evidence endpoint rejects unrelated core associations", { skip: !coreExists }, async () => {
  const response = await evidence.GET(new Request("http://localhost/api/retrosynthesis/evidence?reactionId=R12283&enzymeId=OENC372697"));
  assert.equal(response.status, 404);
});

test("pair evidence returns only linked assertions and related measurements", { skip: !coreExists }, async (context) => {
  const pal = await query("N[C@@H](Cc1ccccc1)C(=O)O", "O=C(O)/C=C/c1ccccc1");
  if (!pal.matches.some(row => row.evidence_available)) return context.skip("Evidence release is not mounted");
  const candidate = pal.matches.flatMap(row => row.candidates).find(row => row.reaction_evidence?.assertion_count > 0);
  assert.ok(candidate, "PAL core candidates should expose a mapped pair in the current release");
  const response = await evidence.GET(new Request(`http://localhost${candidate.reaction_evidence_url}`));
  assert.equal(response.status, 200);
  const detail = await response.json();
  assert.equal(detail.summary.biopart_id, candidate.biopart_id);
  assert.ok(detail.assertions.length > 0);
  assert.ok(detail.assertions.every(row => row.reaction_id === detail.summary.reaction_id));
  const ids = new Set(detail.assertions.map(row => row.assertion_id));
  assert.ok([...detail.measurements, ...detail.citations, ...detail.assay_conditions].every(row => ids.has(row.assertion_id)));
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(require("../src/lib/evidence-release.ts").EVIDENCE_DB_PATH, { readOnly: true });
  try {
    for (const row of detail.assertions) assert.ok(db.prepare("SELECT 1 FROM assertion_enzyme_links WHERE assertion_id=? AND biopart_id=?").get(row.assertion_id, candidate.biopart_id));
  } finally { db.close(); }
});

test("malformed inputs return explicit client errors", async () => {
  const response = await route.POST(new Request("http://localhost/api/retrosynthesis/match", { method: "POST", body: JSON.stringify({ precursors: {}, product: "CCO" }) }));
  assert.equal(response.status, 400);
});
