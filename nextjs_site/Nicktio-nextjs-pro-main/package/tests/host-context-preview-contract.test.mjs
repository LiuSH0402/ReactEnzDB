import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { hostFields, pathwayStepFields, previewContractVersion, previewManifest, previewResponse, previewTsv, reactionHostFields, resourceFields } from "../src/lib/hostContextPreviewContract.ts";

test("every local TSV column has a dictionary definition and versioned schema", () => {
  assert.equal(previewManifest.contract_version, previewContractVersion);
  for (const field of [...hostFields, ...reactionHostFields, ...pathwayStepFields, ...resourceFields]) {
    assert.equal(typeof previewManifest.field_dictionary[field], "string", field);
  }
  assert.deepEqual(previewManifest.schemas.pathway_resources_tsv.fields, resourceFields);
  assert.equal(previewManifest.publication_status, "RELEASED_IN_2026.09.1");
  assert.match(previewManifest.source_hash_verification, /NOT_RECHECKED_PER_REQUEST/);
});

test("download digest covers exact UTF-8 bytes and TSV cells cannot execute spreadsheet formulas", async () => {
  const content = previewTsv(["host_id", "scientific_name"], [{ host_id: "h1", scientific_name: "=HYPERLINK(1)\tfoo\nbar" }]);
  assert.match(content, /^host_id\tscientific_name\nh1\t'=HYPERLINK\(1\) foo bar\n$/);
  const response = previewResponse(content, "tsv", "example.tsv");
  assert.equal(response.headers.get("X-Content-SHA256"), createHash("sha256").update(await response.text(), "utf8").digest("hex"));
  assert.equal(response.headers.get("X-Contract-Version"), previewContractVersion);
  assert.match(response.headers.get("Content-Disposition"), /example\.tsv/);
});

test("host-context routes stay on the companion contract; public OpenAPI is 2026.09.1", () => {
  const relative = "../src/app/api/reactenzdb";
  for (const file of ["hosts/preview/route.ts", "hosts/preview/[hostId]/route.ts", "reactions/[reactionId]/hosts/preview/route.ts", "host-context-preview/manifest/route.ts", "host-context-preview/openapi/route.ts", "pathway/host-context/preview/route.ts"]) {
    assert.match(fs.readFileSync(path.join(import.meta.dirname, relative, file), "utf8"), /localMappingPreviewAvailable\(\)/, file);
  }
  const publicOpenapi = fs.readFileSync(path.join(import.meta.dirname, relative, "openapi/route.ts"), "utf8");
  assert.match(publicOpenapi, /version: "2026\.09\.1"/);
  assert.doesNotMatch(publicOpenapi, /\/hosts\/preview/);
});
