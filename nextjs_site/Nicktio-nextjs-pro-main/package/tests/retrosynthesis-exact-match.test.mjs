import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");
const script = path.join(projectRoot, "scripts", "reaction_smiles_search.py");
const python = process.env.REACTENZDB_PYTHON || "python";

function canonicalize(terms) {
  const result = spawnSync(python, [script, "--canonicalize"], {
    input: JSON.stringify(terms),
    encoding: "utf8",
    timeout: 15000,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test("retrosynthesis match canonicalizes equivalent vanillin SMILES", () => {
  const kekule = canonicalize(["COC1=C(C=CC(=C1)C=O)O"]);
  const aromatic = canonicalize(["COc1cc(C=O)ccc1O"]);
  const alt = canonicalize(["O=Cc1ccc(O)c(OC)c1"]);
  assert.equal(kekule.invalid, false);
  assert.deepEqual(kekule.canonical, aromatic.canonical);
  assert.deepEqual(alt.canonical, aromatic.canonical);
  assert.equal(aromatic.canonical[0], "COc1cc(C=O)ccc1O");
});

test("retrosynthesis match rejects invalid SMILES instead of matching a fragment", () => {
  const parsed = canonicalize(["O=Cc1ccc(O)c(O)c1", "not-a-smiles"]);
  assert.equal(parsed.invalid, true);
  assert.deepEqual(parsed.canonical, []);
});

test("atom maps are stripped before canonical lookup", () => {
  const mapped = canonicalize(["[CH3:1][O:2][c:3]1[cH:4][c:5]([CH:6]=[O:7])[cH:8][cH:9][c:10]1[OH:11]"]);
  assert.equal(mapped.invalid, false);
  assert.equal(mapped.canonical[0], "COc1cc(C=O)ccc1O");
});
