import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, "src", ...parts), "utf8");
const layer = read("lib", "hostRegistryPreview.ts");
const list = read("app", "hosts", "page.tsx");
const detail = read("app", "hosts", "[hostId]", "page.tsx");
const compare = read("app", "hosts", "compare", "page.tsx");

test("host registry is freeze 2026.09.1 and fails closed without the sqlite file", () => {
  assert.match(layer, /HOST_CONTEXT_STAGING_DB_PATH/);
  assert.match(layer, /RELEASE_HOST_CONTEXT_2026_09_1/);
  assert.match(layer, /RELEASED_IN_2026\.09\.1/);
  assert.match(layer, /STAGING_ONLY_NOT_PRODUCTION/);
  assert.doesNotMatch(layer, /reactenzdb_web\.db|host_pathway_coverage_analysis\.sqlite/);
  assert.match(list, /Host registry not mounted/);
  assert.match(compare, /Host registry not mounted/);
});

test("host pages disclose the mapping gate and do not publish coverage statistics", () => {
  assert.match(list, /not a ranking/);
  assert.match(list, /human review of the mapping sample is still empty/);
  assert.match(detail, /Reaction mapping, host breadth, native coverage and pathway suitability are withheld/);
  assert.match(compare, /Reaction overlap, native coverage, Jaccard similarity and host suitability are not available/);
  assert.doesNotMatch(layer, /FROM reaction_host_mapping|FROM host_coverage_summary/);
  assert.match(list, /\/hosts\/\$\{encodeURIComponent\(host\.host_id\)\}/);
});

test("host HTML does not display model QC verdicts", () => {
  assert.doesNotMatch(list, /Model QC|qc_verdict|QC verdict|Quality warnings/);
  assert.doesNotMatch(detail, /QC verdict|Quality warnings|Fatal gates|MEMOTE/);
  assert.doesNotMatch(compare, /Model QC screening|Quality warnings|Fatal gates/);
  assert.match(list, /host-model identities/);
});

test("host detail states species-consensus scope without a list-page error badge", () => {
  assert.doesNotMatch(list, /Model \/ strain scope warning/);
  assert.match(detail, /species-consensus reconstruction/);
  assert.doesNotMatch(detail, /amber-800|role="note"|Model \/ strain scope warning/);
});

test("host detail links recorded papers and hides file checksums", () => {
  assert.doesNotMatch(detail, /File SHA-256|artifact_sha256/);
  assert.match(detail, /getHostPapers/);
  assert.match(detail, /Recorded papers/);
  assert.match(layer, /FROM host_reference_links/);
  assert.match(layer, /https:\/\/doi\.org\//);
  assert.match(layer, /https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\//);
});
