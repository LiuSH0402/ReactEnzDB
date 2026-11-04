import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { structureResultsHref } from "../src/lib/transformationSearch.ts";
import { installKeggPublicProjection } from "../src/lib/keggAccessPolicy.ts";

const python = process.env.REACTENZDB_PYTHON || "python";
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "reactenz-search-review-"));
const file = path.join(folder, "fixture.sqlite");
const db = new DatabaseSync(file);
db.exec(`CREATE TABLE web_reaction_compounds (reaction_id TEXT, compound_id TEXT, compound_name TEXT, chebi_id TEXT, pubchem_id TEXT, smiles TEXT, side TEXT);
  CREATE TABLE web_reaction_ids (reaction_id TEXT, reactenz_reaction_id TEXT);
  CREATE TABLE web_reactions (reaction_id TEXT, reaction_direction TEXT, reaction_equation_display TEXT, enzyme_count INTEGER, kinetics_count INTEGER, all_participants_have_smiles INTEGER, ec_number TEXT, rhea_id TEXT, kegg_reaction_id TEXT, metacyc_reaction_id TEXT);`);
for (let i = 1; i <= 12; i++) {
  const id = `R${String(i).padStart(5, "0")}`;
  db.prepare("INSERT INTO web_reaction_ids VALUES (?,?)").run(id, id);
  db.prepare("INSERT INTO web_reactions VALUES (?, '=', '', ?, 0, 1, NULL, NULL, NULL, NULL)").run(id, 20 - i);
  for (const [name, smiles, side] of i <= 10 ? [["ethanol", "CCO", "left"], ["acetaldehyde", "CC=O", "right"]]
    : i === 11 ? [["acetaldehyde", "CC=O", "right"]] : [["ethanol", "CCO", "right"]]) {
    db.prepare("INSERT INTO web_reaction_compounds VALUES (?, ?, ?, NULL, NULL, ?, ?)").run(id, name, name, smiles, side);
  }
}
db.close();

function search(mode, offset = 0, substrates = "ethanol", products = "acetaldehyde") {
  const result = spawnSync(python, ["scripts/reaction_smiles_search.py", "--db", file,
    "--substrates", substrates, "--products", products, "--match-mode", mode,
    "--offset", String(offset), "--limit", "8"], { encoding: "utf8", timeout: 15000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("complete transformations require every submitted compound on its specified side", () => {
  const complete = search("complete");
  assert.equal(complete.total, 10);
  assert.ok(complete.rows.every(row => row.matched_query_count === row.query_count));
  assert.equal(search("related").total, 1);
  assert.equal(search("related").rows[0].reactenz_reaction_id, "R00011");
  assert.equal(search("complete", 0, "CCO", "CC=O").total, 10);
  assert.equal(search("complete", 0, "unreported compound", "acetaldehyde").total, 0);
});

test("structure pagination preserves the same population with no duplicate rows", () => {
  const first = search("complete");
  const second = search("complete", 8);
  assert.equal(second.total, first.total);
  assert.equal(second.rows.length, 2);
  const ids = new Set([...first.rows, ...second.rows].map(row => row.reactenz_reaction_id));
  assert.equal(ids.size, 10);
  const url = new URL(structureResultsHref({ substrates: "CCO + O", products: "CC=O", q: "R00027", matchMode: "related", page: 2 }), "http://local");
  assert.equal(url.pathname, "/search");
  assert.equal(url.searchParams.get("substrates"), "CCO + O");
  assert.equal(url.searchParams.get("products"), "CC=O");
  assert.equal(url.searchParams.get("structureMatch"), "related");
  assert.equal(url.searchParams.get("page"), "2");
});

test("downloaded kinetic source summary equals the source-filtered repaired database", { skip: process.env.REACTENZDB_TEST_RELEASE !== "1" }, () => {
  const release = path.resolve(process.env.REACTENZDB_RELEASE_DIR || path.resolve(process.cwd(), "../../../web_release"), "reactenzdb_web.db");
  const database = new DatabaseSync(release, { readOnly: true });
  installKeggPublicProjection(database);
  const expected = database.prepare("SELECT COALESCE(NULLIF(lower(trim(source_db)), ''), 'unknown') label, COUNT(*) count FROM web_kinetics GROUP BY 1 ORDER BY count DESC, label").all().map(row => ({ ...row }));
  const summary = JSON.parse(fs.readFileSync("public/reactenzdb/statistics/statistics_summary.json", "utf8"));
  assert.deepEqual(summary.kinetics.source_db, expected);
  assert.equal(expected.reduce((sum, row) => sum + row.count, 0), summary.overall.kinetics);
  assert.equal(summary.provenance.source_policy, "2026-10-08-external-links-only");
  database.close();
});

test.after(() => { fs.rmSync(folder, { recursive: true, force: true }); });
