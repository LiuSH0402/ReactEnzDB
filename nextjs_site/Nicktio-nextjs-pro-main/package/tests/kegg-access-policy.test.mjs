import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { installKeggPublicProjection, releaseFileAllowed, keggPolicyUnavailable } from "../src/lib/keggAccessPolicy.ts";

test("public SQL excludes mixed KEGG provenance before limits, joins and aggregates; source rows survive", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE web_attribute_evidences (id INTEGER, source_db TEXT);
    INSERT INTO web_attribute_evidences VALUES (1,'kegg_ag'), (2,'brenda,kegg_vg'), (3,'brenda');
    CREATE TABLE web_pathways (pathway_id TEXT, source_db TEXT);
    INSERT INTO web_pathways VALUES ('map00010','kegg');
    CREATE TABLE web_xrefs (xref_db TEXT, xref_value TEXT, xref_url TEXT, source_db TEXT);
    INSERT INTO web_xrefs VALUES ('kegg_reaction','R00001','/local-proxy','RDBSB'), ('rhea','1','https://www.rhea-db.org/reaction?id=1','RDBSB');`);
  if (db.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') enabled").get().enabled) {
    db.exec("CREATE VIRTUAL TABLE reaction_fts USING fts5(identifier)");
  }
  installKeggPublicProjection(db);
  db.exec("PRAGMA query_only = ON");
  assert.equal(db.prepare("SELECT count(*) n FROM web_attribute_evidences").get().n, 1);
  assert.equal(db.prepare("SELECT id FROM web_attribute_evidences LIMIT 1").get().id, 3);
  assert.equal(db.prepare("SELECT count(*) n FROM web_pathways").get().n, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM main.web_attribute_evidences").get().n, 3);
  assert.equal(db.prepare("SELECT xref_url FROM web_xrefs WHERE xref_db='kegg_reaction'").get().xref_url, "https://www.kegg.jp/entry/R00001");
  assert.throws(() => db.exec("DELETE FROM main.web_attribute_evidences"));
  db.close();
});

test("withheld KEGG host mappings become unresolved, never model absence; independent mappings survive", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE reaction_host_mapping (id INTEGER, identity_basis TEXT, mapping_status TEXT, model_reaction_id TEXT, direction_relation TEXT, compartment_relation TEXT, qc_flags_json TEXT);
    INSERT INTO reaction_host_mapping VALUES (1,'KEGG_EXACT','EXACT_NATIVE','r1','SAME','MATCH','[]'), (2,'RHEA_EXACT','EXACT_NATIVE','r2','SAME','MATCH','[]');`);
  installKeggPublicProjection(db);
  const withheld = db.prepare("SELECT * FROM reaction_host_mapping WHERE id=1").get();
  assert.equal(withheld.mapping_status, "UNRESOLVED");
  assert.equal(withheld.model_reaction_id, null);
  assert.equal(withheld.identity_basis, "WITHHELD_KEGG_POLICY");
  assert.deepEqual(JSON.parse(withheld.qc_flags_json), ["WITHHELD_KEGG_POLICY"]);
  assert.equal(db.prepare("SELECT model_reaction_id FROM reaction_host_mapping WHERE id=2").get().model_reaction_id, "r2");
  db.close();
});

test("mixed biochemical rule pools are withheld even if a row can also match Rhea", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE bionavi_reaction_rules (rule_id TEXT, rule_source TEXT);
    INSERT INTO bionavi_reaction_rules VALUES ('mixed','enzymatic_metabolic'), ('organic','uspto_organic_or_hybrid');
    CREATE TABLE bionavi_rule_references (rule_id TEXT, external_db TEXT);
    INSERT INTO bionavi_rule_references VALUES ('mixed','Rhea'), ('mixed','KEGG'), ('organic','USPTO');`);
  installKeggPublicProjection(db);
  assert.equal(db.prepare("SELECT count(*) n FROM bionavi_rule_references ref JOIN bionavi_reaction_rules r USING(rule_id)").get().n, 1);
  assert.equal(db.prepare("SELECT count(*) n FROM main.bionavi_rule_references").get().n, 3);
  db.close();
});

test("KEGG chemistry comparison and its conflict records are withheld together", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE cross_database_mappings (mapping_id TEXT, target_db TEXT);
    INSERT INTO cross_database_mappings VALUES ('k','KEGG'), ('r','Rhea');
    CREATE TABLE mapping_conflicts (conflict_id TEXT, mapping_id TEXT);
    INSERT INTO mapping_conflicts VALUES ('k-conflict','k'), ('r-conflict','r'), ('independent',NULL);`);
  installKeggPublicProjection(db);
  assert.equal(db.prepare("SELECT count(*) n FROM cross_database_mappings").get().n, 1);
  assert.equal(db.prepare("SELECT count(*) n FROM mapping_conflicts").get().n, 2);
  assert.equal(db.prepare("SELECT count(*) n FROM main.mapping_conflicts").get().n, 3);
  db.close();
});

test("bulk download policy fails closed for unknown files while retaining citation metadata", async () => {
  for (const name of ["reactenzdb_web.db", "downloads/web_pathways.tsv.gz", "web_reactions.csv.gz", "new_future.sqlite", "evidence_assertions.tsv.gz"]) assert.equal(releaseFileAllowed(name), false);
  assert.equal(releaseFileAllowed("CITATION.cff"), true);
  const response = keggPolicyUnavailable();
  assert.equal(response.status, 410);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal((await response.json()).policy.mode, "external_links_only");
});
