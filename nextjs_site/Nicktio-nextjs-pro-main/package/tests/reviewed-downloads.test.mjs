import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readReviewedCatalog, resolveReviewedFile } from "../src/lib/reviewedDownloadFiles.mjs";
import { projectExportValue } from "../src/lib/exportPresentation.mjs";

test("download keys resolve to the reviewed copy and cannot expose a raw sibling", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reactenzdb-reviewed-"));
  fs.mkdirSync(path.join(root, "download_bundle", "sqlite"), { recursive: true });
  fs.writeFileSync(path.join(root, "download_bundle", "sqlite", "reactenzdb_web.db"), "clean");
  fs.writeFileSync(path.join(root, "raw.db"), "private");
  const catalog = { availability: "published", identified_kegg_content_excluded: true, revision: "test", files: [
    { path: "download_bundle/sqlite/reactenzdb_web.db", name: "reactenzdb_web.db", group: "sqlite", size: 5, sha256: "a".repeat(64) },
  ] };
  fs.writeFileSync(path.join(root, "catalog_public.json"), JSON.stringify(catalog));
  assert.equal(resolveReviewedFile("db", { db: "reactenzdb_web.db" }, root)?.filePath, path.join(root, "download_bundle", "sqlite", "reactenzdb_web.db"));
  assert.equal(resolveReviewedFile("reviewed:../raw.db", {}, root), null);
  assert.equal(resolveReviewedFile("download:raw.db", {}, root), null);
  assert.equal(resolveReviewedFile("download:web_source_imports.tsv.gz", {}, root), null);
  fs.writeFileSync(path.join(root, "download_bundle", "sqlite", "reactenzdb_web.db"), "changed");
  assert.equal(resolveReviewedFile("db", { db: "reactenzdb_web.db" }, root), null);
  catalog.files[0].path = "../raw.db";
  fs.writeFileSync(path.join(root, "catalog_public.json"), JSON.stringify(catalog));
  assert.equal(readReviewedCatalog(root), null);
});

test("export projection retains biological context and IDs while removing origin labels/content", () => {
  const result = projectExportValue({ source_db: "RDBSB", source_organism: "Escherichia coli", protein_sequence: "MAAG", ph: 7, pmids_json: '["123"]',
    observations: [{ source_db: "kegg_ag", value_text: "copied pathway" }, { source_db: "BRENDA", value_numeric: 2.1, unit: "mM" }],
    links: [{ source_db: "KEGG", entity_id: "ours", xref_db: "kegg_reaction", xref_value: "R03732", xref_url: "https://www.kegg.jp/entry/R03732" }],
    participant: { source_name: "water", source_compound_id: "C00001", smiles: "O" } });
  assert.equal(result.source_db, undefined);
  assert.equal(result.source_organism, "Escherichia coli");
  assert.equal(result.protein_sequence, "MAAG");
  assert.equal(result.ph, 7);
  assert.equal(result.pmids_json, '["123"]');
  assert.deepEqual(result.observations, [{ value_numeric: 2.1, unit: "mM" }]);
  assert.equal(result.links[0].xref_value, "R03732");
  assert.equal(result.links[0].xref_url, "https://www.kegg.jp/entry/R03732");
  assert.equal(result.participant.compound_name, "water");
  assert.equal(projectExportValue({ source: "KEGG", id: "map01100", name: "copied pathway name" }), null);
  assert.equal(projectExportValue({ source_db: ["Rhea", "KEGG"], value_text: "mixed copied value" }), null);
});
