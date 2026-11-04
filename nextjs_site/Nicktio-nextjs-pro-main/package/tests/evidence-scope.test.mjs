import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module, { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const site = path.resolve(import.meta.dirname, "..");
const original = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...args) {
  if (request.startsWith("@/")) request = path.join(site, "src", request.slice(2));
  return original.call(this, request, parent, ...args);
};
require.extensions[".ts"] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reactenzdb-evidence-scope-"));
const file = path.join(dir, "evidence.sqlite");
process.env.REACTENZDB_EVIDENCE_DB = file;
process.env.REACTENZDB_EVIDENCE_RELEASE_DIR = dir;
const db = new DatabaseSync(file);
db.exec(`
  CREATE TABLE metadata(key TEXT, value TEXT);
  INSERT INTO metadata VALUES ('release_version','EVIDENCE_RC_V2');
  CREATE TABLE evidence_class_definitions(evidence_class TEXT, rank_order INTEGER);
  CREATE TABLE outcome_definitions(outcome_class TEXT);
  CREATE TABLE assertions(assertion_id TEXT PRIMARY KEY, reaction_id TEXT, reactenz_reaction_id TEXT,
    primary_biopart_id TEXT, primary_reactenz_enzyme_id TEXT, source_ec_number TEXT,
    evidence_class TEXT, evidence_rank INTEGER, outcome_class TEXT, curation_status TEXT,
    is_canonical INTEGER, has_quantitative_measurement INTEGER, pmid_count INTEGER, mapping_score INTEGER);
  CREATE TABLE assertion_enzyme_links(assertion_id TEXT, biopart_id TEXT, link_role TEXT);
  CREATE TABLE measurements(measurement_id TEXT, assertion_id TEXT, parameter_type_canonical TEXT);
  CREATE TABLE citations(assertion_id TEXT, pmid TEXT, doi TEXT, year INTEGER);
  CREATE TABLE assay_conditions(condition_id TEXT PRIMARY KEY, assertion_id TEXT);
  CREATE TABLE brenda_context_records(context_id TEXT, ec_number TEXT, context_type TEXT, organism TEXT);
  CREATE TABLE reaction_enzyme_summary(reaction_id TEXT, reactenz_reaction_id TEXT, biopart_id TEXT,
    reactenz_enzyme_id TEXT, best_evidence_rank INTEGER, exact_assertion_count INTEGER,
    literature_verified_count INTEGER, citation_count INTEGER, measurement_count INTEGER);
  INSERT INTO reaction_enzyme_summary VALUES
    ('r1','R00001','p1','E00001',1,1,0,1,1), ('r1','R00001','p2','E00002',1,2,0,1,1);
  CREATE TABLE reaction_summary(reaction_id TEXT, reactenz_reaction_id TEXT, assertion_count INTEGER,
    catalytic_assertion_count INTEGER, inactive_or_negative_count INTEGER, citation_count INTEGER);
  INSERT INTO reaction_summary VALUES ('r1','R00001',99,98,0,99);
  CREATE TABLE enzyme_summary(biopart_id TEXT, reactenz_enzyme_id TEXT, assertion_count INTEGER,
    catalytic_assertion_count INTEGER, inactive_or_negative_count INTEGER, citation_count INTEGER);
  INSERT INTO enzyme_summary VALUES ('p1','E00001',99,98,0,99),('p2','E00002',99,98,0,99);
`);
const add = db.prepare("INSERT INTO assertions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
for (const [id, primary, klass, outcome, canonical] of [
  ["shared", "p1", "exact_substrate_product_experimental_evidence", "quantitative_activity", 1],
  ["secondary", "p3", "same_reaction_identifier_evidence", "quantitative_activity", 1],
  ["negative", "p1", "exact_substrate_product_experimental_evidence", "inactive", 1],
  ["background", "p1", "same_ec_different_substrate", "quantitative_activity", 1],
  ["duplicate", "p1", "exact_substrate_product_experimental_evidence", "quantitative_activity", 0],
]) add.run(id,"r1","R00001",primary,null,"1.2.3.4",klass,1,outcome,"automatic_strict_exact",canonical,1,1,100);
db.exec(`
  INSERT INTO assertion_enzyme_links VALUES ('shared','p1','primary'),('shared','p2','secondary'),
    ('shared','p2','alias'),('secondary','p2','secondary'),('negative','p1','primary');
  INSERT INTO measurements VALUES ('m1','shared','km'),('m2','background','km'),('m3','negative','activity');
  INSERT INTO citations VALUES ('shared','100',NULL,2020),('negative','100',NULL,2020),
    ('secondary','101',NULL,2021),('background','102',NULL,2022);
  INSERT INTO assay_conditions VALUES ('shared:condition','shared'),('background:condition','background');
`);
db.close();
const lib = require("../src/lib/evidence-release.ts");
after(() => {
  for (const [key, connection] of globalThis.__reactenzdbSqliteConnections ?? []) {
    if (key.endsWith(path.resolve(file))) connection.close();
  }
  assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
  assert.ok(path.basename(dir).startsWith("reactenzdb-evidence-scope-"));
  fs.rmSync(dir, { recursive: true, force: true });
});
function assertRelated(bundle) {
  const ids = new Set(bundle.assertions.map(row => row.assertion_id));
  assert.ok([...bundle.measurements,...bundle.citations,...bundle.assay_conditions].every(row => ids.has(row.assertion_id)));
}

test("target list excludes same-EC background and ignores pair-summed stored totals", () => {
  const b = lib.getReactionEvidenceBundle("R00001", { limit: 100 });
  assert.equal(b.assertion_scope, "target_association");
  assert.equal(b.pagination.total, 3);
  assert.equal(b.assertions.length, 3);
  assert.equal(b.summary.assertion_count, 3);
  assert.equal(b.summary.catalytic_assertion_count, 2);
  assert.equal(b.summary.inactive_or_negative_count, 1);
  assert.equal(b.summary.citation_count, 2);
  assert.ok(!b.assertions.some(row => ["background","duplicate"].includes(row.assertion_id)));
  assertRelated(b);
});

test("pages, empty tail and assertion filters count the same unique source scope", () => {
  const all = lib.getReactionEvidenceBundle("R00001", { limit: 100 });
  const pages = [0,1,2,3].map(offset => lib.getReactionEvidenceBundle("R00001", { limit: 1, offset }));
  assert.ok(pages.every(b => b.pagination.total === 3));
  assert.deepEqual(pages.flatMap(b => b.assertions.map(a => a.assertion_id)), all.assertions.map(a => a.assertion_id));
  assert.equal(pages[3].assertions.length, 0);
  const km = lib.getReactionEvidenceBundle("R00001", { parameter: "km" });
  assert.equal(km.pagination.total, 1);
  assert.deepEqual(km.assertions.map(a => a.assertion_id), ["shared"]);
  assertRelated(km);
  const negative = lib.getReactionEvidenceBundle("R00001", { outcome: "inactive" });
  assert.equal(negative.pagination.total, 1);
  assert.equal(negative.assertions[0].assertion_id, "negative");
  assert.equal(lib.getReactionEvidenceBundle("R00001", { parameter: "absent" }).pagination.total, 0);
});

test("background remains explicitly queryable with its own filtered count", () => {
  const b = lib.getReactionEvidenceBundle("R00001", { evidenceClass: "same_ec_different_substrate", parameter: "km" });
  assert.equal(b.assertion_scope, "same_ec_background");
  assert.equal(b.pagination.total, 1);
  assert.deepEqual(b.assertions.map(a => a.assertion_id), ["background"]);
  assert.equal(b.summary.assertion_count, 3, "target summary does not turn context into target support");
  assertRelated(b);
});

test("enzyme list includes secondary links once and keeps negative results", () => {
  const secondary = lib.getEnzymeEvidenceBundle("E00002", { limit: 100 });
  assert.equal(secondary.pagination.total, 2);
  assert.deepEqual(new Set(secondary.assertions.map(a => a.assertion_id)), new Set(["shared","secondary"]));
  const primary = lib.getEnzymeEvidenceBundle("E00001", { limit: 100 });
  assert.equal(primary.pagination.total, 2);
  assert.ok(primary.assertions.some(a => a.outcome_class === "inactive"));
});

test("unknown target remains a well-scoped empty response", () => {
  const b = lib.getReactionEvidenceBundle("R99999");
  assert.equal(b.summary, null);
  assert.equal(b.pagination.total, 0);
  assert.equal(b.assertion_scope, "target_association");
});
