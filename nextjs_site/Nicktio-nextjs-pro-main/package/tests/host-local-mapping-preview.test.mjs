import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const src = path.resolve(import.meta.dirname, "../src");
const read = (relative) => fs.readFileSync(path.join(src, relative), "utf8");

test("host mapping is freeze 2026.09.1 lookup and read-only", () => {
  const helper = read("lib/hostMappingLocalPreview.ts");
  const sqlite = read("lib/sqlite.ts");
  assert.match(helper, /hostContextLayerAvailable/);
  assert.match(helper, /getHostRegistryPreview\(\)/);
  assert.doesNotMatch(helper, /NODE_ENV !== "production"/);
  assert.match(sqlite, /readOnly: true/);
  assert.match(sqlite, /PRAGMA query_only = ON/);
  assert.doesNotMatch(helper, /INSERT INTO|UPDATE reaction_host_mapping|DELETE FROM/);
});

test("Browse is a directory and does not apply unpublished host mapping as a public filter", () => {
  const browse = read("app/browse/page.tsx");
  const data = read("lib/reactenzdb.ts");
  assert.doesNotMatch(browse, /getLocalReactionIdsByHostStatus/);
  assert.doesNotMatch(browse, /localPreviewReactionIds/);
  assert.match(browse, /href="\/hosts"/);
  assert.match(data, /json_each\(\$\{sqlString\(JSON\.stringify\(params\.localPreviewReactionIds\)\)\}\)/);
});

test("pathway preview retains five statuses, duplicate steps and no suitability claim", () => {
  const route = read("app/api/reactenzdb/pathway/host-context/preview/route.ts");
  const workbench = read("components/ReactEnz/PathwayHostInputWorkbench.tsx");
  assert.match(route, /getLocalMappingsForReactions/);
  assert.match(route, /outputSteps = checked\.map/);
  assert.match(route, /direction_check_scope: "RECORDED_MODEL_BOUNDS_PARTIAL"/);
  assert.match(route, /pathway_connectivity_scope: "EXACT_CHEBI_DIRECT_ADJACENCY_COMPARTMENT_UNVERIFIED"/);
  assert.match(route, /heterologous_scope: "FIXED_MODEL_MAPPING_GAP_ONLY"/);
  assert.match(route, /publication_status: "RELEASED_IN_2026.09.1"/);
  assert.match(route, /A model mapping gap is not biological absence/);
  assert.match(workbench, /No host suitability ranking/);
  assert.match(route, /getPathwayCoefficientEvidence/);
  assert.match(workbench, /系数证据不足/);
  assert.match(workbench, /Select at least one host model first/);
  assert.match(workbench, /Select all/);
  assert.match(workbench, /Filter by species/);
  assert.doesNotMatch(workbench, /Select 1–3 host models first/);
  assert.doesNotMatch(workbench, /up to three/);
  assert.doesNotMatch(workbench, /of 3 selected/);
  assert.doesNotMatch(workbench, /scientific_name\} · \{host\.model_name\}/);
  assert.match(route, /MAX_HOST_RELEASES/);
  assert.doesNotMatch(workbench, /<details/);
  assert.doesNotMatch(workbench, /hosts\.length <= 8/);
  assert.doesNotMatch(workbench, /Inspect local staging matrix/);
  assert.doesNotMatch(route, /INSERT INTO|UPDATE |DELETE FROM|analysis_id/);
});
