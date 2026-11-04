import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(projectRoot, ...parts), "utf8");
const field = read("src", "components", "ReactEnz", "StructureSearchField.tsx");
const help = read("src", "app", "help", "page.tsx");
const jsmeNotice = read("public", "jsme", "NOTICE.txt");
const gset = read("src", "components", "ReactEnz", "RetrosynthesisWorkbench.tsx");
const retrobiocat = read("src", "components", "ReactEnz", "RetroBioCatPlanner.tsx");
const subnetx = read("src", "components", "ReactEnz", "SubNetXExtractor.tsx");

test("search structure entry converts a drawn or MOL structure, not a picture", () => {
  assert.match(field, /Draw structure/);
  assert.match(field, /Load MOL\/SDF/);
  assert.match(field, /Use this structure/);
  assert.match(field, /\/jsme\/jsme\.nocache\.js/);
  assert.match(field, /Pictures of molecules are not converted/);
  assert.match(field, /PNG, JPEG, and SVG screenshots are not converted/);
  assert.match(field, /Save As MDL Molfile/);
  assert.match(field, /readGenericMolecularInput/);
  assert.match(field, /smiles\(\)/);
  assert.doesNotMatch(field, /DECIMER|OSRA|MolScribe|img2mol/i);
  assert.match(help, /On Search and on each Tools runner, use Draw structure or Load MOL\/SDF/);
  assert.match(help, /Pictures of molecules \(PNG, JPEG, SVG screenshots\) are not converted/);
  for (const tool of [gset, retrobiocat, subnetx]) {
    assert.match(tool, /StructureSearchField/);
    assert.match(tool, /replaceOnApply/);
  }
  assert.match(jsmeNotice, /JSME Molecule Editor 2024\.04\.29/);
  assert.ok(fs.existsSync(path.join(projectRoot, "public", "jsme", "jsme.nocache.js")));
});
