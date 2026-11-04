import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");
const librarySource = fs.readFileSync(path.join(projectRoot, "src/lib/pathwayExport.ts"), "utf8");
const routeSource = fs.readFileSync(path.join(projectRoot, "src/app/api/reactenzdb/pathway-export/route.ts"), "utf8");
const openapiSource = fs.readFileSync(path.join(projectRoot, "src/app/api/reactenzdb/openapi/route.ts"), "utf8");

test("pathway export rejects unsupported host keys and shares the documented enum", () => {
  assert.match(routeSource, /if \(!isAcceptedHost\(host\)\)/);
  assert.match(routeSource, /status: 400/);
  assert.match(routeSource, /accepted_hosts: acceptedHosts\(\)/);
  assert.match(openapiSource, /enum: PATHWAY_EXPORT_HOST_KEYS/);
});

test("reaction context reports an explicit scope instead of a hard-coded E. coli id", () => {
  assert.doesNotMatch(librarySource, /'ecoli_all' AS host_id/);
  assert.match(librarySource, /AS host_scope/);
  assert.match(librarySource, /GROUP_CONCAT\(DISTINCT l\.host_id\) AS host_ids/);
});

test("CSV fallback rows retain the full schema and candidate-free steps remain present", () => {
  assert.match(librarySource, /Array\(columns\.length\)\.fill\(""\)/);
  assert.match(librarySource, /step\.candidates\.length \? step\.candidates : \[null\]/);
});
