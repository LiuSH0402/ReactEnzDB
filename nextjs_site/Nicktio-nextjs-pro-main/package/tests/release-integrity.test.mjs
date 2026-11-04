import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { installKeggPublicProjection } from "../src/lib/keggAccessPolicy.ts";
import { readReviewedCatalog, resolveReviewedFile, reviewedDownloadRoot } from "../src/lib/reviewedDownloadFiles.mjs";

const releaseDir = path.resolve(process.env.REACTENZDB_RELEASE_DIR || path.resolve(process.cwd(), "../../../web_release"), "");
const publicRoot = reviewedDownloadRoot();
const bundleDir = path.join(publicRoot, "download_bundle");
const manifestPath = path.join(bundleDir, "manifest.json");
const integrity = JSON.parse(fs.readFileSync(path.join(releaseDir, "release_integrity.summary.json"), "utf8"));

function manifest() {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function coreReactionCount() {
  return integrity.core_counts.web_reactions;
}

const hashes = new Map();
async function hashFile(file) {
  if (!hashes.has(file)) {
    const hash = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    hashes.set(file, hash.digest("hex"));
  }
  return hashes.get(file);
}

test("page statistics use runtime data and public exports match their reviewed SQLite projection", async () => {
  const summary = JSON.parse(fs.readFileSync("public/reactenzdb/statistics/statistics_summary.json", "utf8"));
  const governance = JSON.parse(fs.readFileSync(path.join(releaseDir, "PUBLIC_RELEASE_GOVERNANCE.json"), "utf8"));
  const db = new DatabaseSync(path.join(releaseDir, "reactenzdb_web.db"), { readOnly: true });
  installKeggPublicProjection(db);
  for (const [metric, table] of [["reactions", "web_reactions"], ["enzymes", "web_enzymes"], ["reaction_enzyme_pairs", "web_reaction_enzymes"], ["kinetics", "web_kinetics"]]) {
    assert.equal(summary.overall[metric], Number(db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count), metric);
  }
  const types = db.prepare("SELECT COALESCE(parameter_type, 'not curated') label, COUNT(*) count FROM web_kinetics GROUP BY 1 ORDER BY count DESC LIMIT 12").all().map(row => ({ ...row }));
  assert.deepEqual(summary.kinetics.parameter_types, types);
  const sum = rows => rows.reduce((n, row) => n + row.count, 0);
  assert.equal(sum(summary.reaction.direction), summary.overall.reactions);
  assert.equal(sum(summary.enzyme.sequence_length_bins), summary.overall.enzymes);
  const found = db.prepare("SELECT COUNT(DISTINCT biopart_id) count FROM web_alphafold_mappings WHERE status='found' AND model_entity_id IS NOT NULL AND model_entity_id<>''").get();
  assert.equal(summary.overall.alphafold_mapped_enzymes, Number(found.count));
  assert.equal(summary.provenance.data_revision, governance.data_revision);
  assert.equal(summary.release.snapshot_id, governance.snapshot_id);
  const model = JSON.parse(fs.readFileSync(path.join(releaseDir, "model_ready_dataset.summary.json"), "utf8"));
  assert.deepEqual(summary.supplemental.model_ready.tables, model.tables);
  const exports = manifest().tabular_files;
  const publishedModel = new DatabaseSync(path.join(bundleDir, "sqlite/model_ready_dataset.sqlite"), { readOnly: true });
  for (const table of ["model_ready_reactions", "model_ready_enzyme_candidates", "model_ready_trainable_reactions"]) {
    const item = exports.find(row => row.file === `${table}.tsv.gz`);
    assert.ok(item, table);
    const file = path.join(bundleDir, "tables", item.file);
    assert.equal(item.rows, Number(publishedModel.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count), `stale public rows: ${table}`);
    assert.equal(item.size, fs.statSync(file).size, `stale download size: ${table}`);
    assert.equal(item.sha256, await hashFile(file), `stale download hash: ${table}`);
  }
  assert.equal(Number(publishedModel.prepare("SELECT COUNT(*) count FROM model_ready_reactions").get().count), coreReactionCount());
  publishedModel.close();
  const svg = fs.readFileSync("public/reactenzdb/statistics/reactenzdb_statistics_overview.svg", "utf8");
  for (const metric of ["reactions", "enzymes", "reaction_enzyme_pairs", "kinetics"]) {
    assert.ok(svg.includes(summary.overall[metric].toLocaleString("en-US")), `stale figure metric: ${metric}`);
  }
  db.close();
});

test("active public catalog resolves through the website resolver and every SHA256 matches", async () => {
  const catalog = readReviewedCatalog(publicRoot);
  assert.ok(catalog);
  assert.ok(catalog.files.length > 20);
  assert.equal(catalog.revision, manifest().revision);
  for (const artifact of catalog.files) {
    const resolved = resolveReviewedFile(`reviewed:${artifact.path}`, {}, publicRoot);
    assert.ok(resolved, `unresolvable artifact: ${artifact.path}`);
    assert.equal(fs.statSync(resolved.filePath).size, artifact.size, `stale size: ${artifact.path}`);
    assert.equal(await hashFile(resolved.filePath), artifact.sha256, `stale SHA256: ${artifact.path}`);
  }
});

test("documented schema covers every logical web table", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(releaseDir, integrity.runtime_schema.file), "utf8"));
  const db = new DatabaseSync(path.join(releaseDir, "reactenzdb_web.db"), { readOnly: true });
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM sqlite_master
    WHERE type = 'table'
      AND name LIKE 'web_%'
      AND name NOT LIKE 'web_retrosynthesis_%'
      AND name NOT LIKE '%_fts'
      AND name NOT LIKE '%_fts_%'
  `).get();
  assert.equal(new Set(schema.map(field => field.table)).size, Number(row.count));
  for (const table of new Set(schema.map(field => field.table))) {
    assert.deepEqual(schema.filter(field => field.table === table).map(field => field.column), db.prepare(`PRAGMA table_info("${table}")`).all().map(field => field.name));
  }
  db.close();
});

test("downloaded field dictionary describes the actual redacted SQLite schemas", () => {
  const lines = fs.readFileSync(path.join(bundleDir, "sqlite_fields.tsv"), "utf8").trimEnd().split(/\r?\n/);
  assert.equal(lines.shift(), "file\ttable\tfield\ttype\tnot_null\tprimary_key_order");
  const actual = [];
  for (const file of manifest().sqlite_files) {
    const db = new DatabaseSync(path.join(bundleDir, file.file), { readOnly: true });
    for (const table of db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()) {
      for (const col of db.prepare(`PRAGMA table_info("${table.name}")`).all()) actual.push([path.basename(file.file), table.name, col.name, col.type, col.notnull, col.pk].join("\t"));
    }
    db.close();
  }
  assert.deepEqual(lines, actual);
  assert.equal(lines.length, manifest().schema.sqlite_fields);
});

test("runtime file hashes and public reaction–enzyme identities agree with the audited snapshot", async () => {
  for (const [name, record] of Object.entries(integrity.runtime)) {
    assert.equal(await hashFile(path.join(releaseDir, name)), record.sha256, `runtime snapshot changed: ${name}`);
  }
  const runtime = new DatabaseSync(path.join(releaseDir, "reactenzdb_web.db"), { readOnly: true });
  const published = new DatabaseSync(path.join(bundleDir, "sqlite/reactenzdb_web.db"), { readOnly: true });
  for (const [table, columns] of [["web_reactions", "reaction_id"], ["web_enzymes", "biopart_id"], ["web_reaction_enzymes", "reo_id,reaction_id,biopart_id"]]) {
    const sql = `SELECT ${columns} FROM ${table} ORDER BY ${columns}`;
    assert.deepEqual(published.prepare(sql).all().map(row => Object.values(row)), runtime.prepare(sql).all().map(row => Object.values(row)), table);
  }
  assert.equal(integrity.core_counts.web_reactions, Number(runtime.prepare("SELECT COUNT(*) count FROM web_reactions").get().count));
  published.close();
  runtime.close();
});

test("retrosynthesis authority registry declares one canonical external source", () => {
  const registryPath = path.join(releaseDir, "DATA_LAYER_REGISTRY.json");
  assert.ok(fs.existsSync(registryPath));
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const external = registry.layers.find((layer) => layer.layer_id === "retrosynthesis_external_resources");
  const legacy = registry.layers.find((layer) => layer.layer_id === "legacy_core_retrosynthesis_snapshot");
  assert.equal(registry.policy.retrosynthesis_authority, "retrosynthesis_external_resources");
  assert.equal(external.authority, "canonical");
  assert.equal(external.database.file, "retrosynthesis_resources.sqlite");
  assert.equal(legacy.authority, "deprecated_legacy_snapshot");
  assert.equal(legacy.canonical_replacement, "retrosynthesis_external_resources");
  assert.ok(legacy.tables.every((table) => table.startsWith("web_retrosynthesis_")));
});

test("retrosynthesis tool registry separates predictors from resource layers", () => {
  const registryPath = path.join(releaseDir, "RETROSYNTHESIS_TOOL_REGISTRY.json");
  assert.ok(fs.existsSync(registryPath));
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  assert.equal(registry.tools.length, 5);
  assert.equal(registry.tools.filter((tool) => tool.capability_class === "live_single_step_predictor").length, 3);
  assert.equal(registry.tools.filter((tool) => tool.capability_class !== "live_single_step_predictor").length, 2);
  assert.equal(registry.policy.prediction_is_not_evidence, true);
  for (const tool of registry.tools) {
    assert.match(tool.paper.doi, /^10\./);
    assert.ok(tool.reactenzdb_scope.length > 40);
    assert.ok(tool.code_license.status);
  }
  for (const tool of registry.tools.filter((item) => item.checkpoint)) {
    assert.match(tool.checkpoint.sha256, /^[a-f0-9]{64}$/);
    assert.equal(tool.checkpoint.redistributed_by_reactenzdb, false);
  }
  const bionavi = registry.tools.find((tool) => tool.tool_id === "bionavi_np");
  assert.equal(bionavi.code_license.status, "not_found_at_upstream_root");
});

test("default trainable reactions and external kinetic confirmation fields are reproducible", () => {
  const modelDb = new DatabaseSync(path.join(releaseDir, "model_ready_dataset.sqlite"), { readOnly: true });
  const trainable = modelDb.prepare("SELECT COUNT(*) AS count FROM model_ready_trainable_reactions").get();
  const invalidTrainable = modelDb.prepare(`
    SELECT COUNT(*) AS count
    FROM model_ready_trainable_reactions
    WHERE canonical_reaction_smiles IS NULL
       OR all_participants_have_smiles <> 1
       OR formula_balance_status <> 'formula_balanced'
       OR only_currency_transformation <> 0
       OR enzyme_candidate_count < 1
  `).get();
  const external = modelDb.prepare(`
    SELECT COUNT(*) AS count
    FROM model_ready_enzyme_candidates
    WHERE external_validation_status <> 'not_externally_confirmed'
      AND external_exact_kinetic_count > 0
  `).get();
  const modelSummary = JSON.parse(fs.readFileSync(path.join(releaseDir, "model_ready_dataset.summary.json"), "utf8"));
  assert.equal(Number(trainable.count), modelSummary.tables.model_ready_trainable_reactions);
  assert.ok(Number(trainable.count) >= 10751);
  assert.equal(Number(invalidTrainable.count), 0);
  assert.ok(Number(external.count) > 0);
  modelDb.close();
});

test("browse summary tables cover every enzyme and source organism", () => {
  const db = new DatabaseSync(path.join(releaseDir, "reactenzdb_web.db"), { readOnly: true });
  const enzymeRows = db.prepare("SELECT COUNT(*) AS count FROM web_enzymes").get();
  const enzymeSummaryRows = db.prepare("SELECT COUNT(*) AS count FROM web_enzyme_browse_summary").get();
  const organismRows = db.prepare("SELECT COUNT(DISTINCT organism) AS count FROM web_reaction_enzymes WHERE organism IS NOT NULL AND trim(organism) <> ''").get();
  const organismSummaryRows = db.prepare("SELECT COUNT(*) AS count FROM web_organism_browse_summary").get();
  assert.equal(Number(enzymeSummaryRows.count), Number(enzymeRows.count));
  assert.equal(Number(organismSummaryRows.count), Number(organismRows.count));
  db.close();
});

test("R-E-O records use permanent explicit identifiers in the database and bulk downloads", () => {
  const dbPath = path.join(releaseDir, "reactenzdb_web.db");
  const registryPath = path.join(releaseDir, "reo_id_registry.sqlite");
  assert.ok(fs.existsSync(registryPath));

  const db = new DatabaseSync(dbPath, { readOnly: true });
  const columns = db.prepare("PRAGMA table_info('web_reaction_enzymes')").all().map((row) => row.name);
  assert.ok(columns.includes("reo_id"));
  const stats = db.prepare(`
    SELECT COUNT(*) AS total,
           COUNT(DISTINCT reo_id) AS distinct_ids,
           SUM(CASE WHEN reo_id IS NULL OR substr(reo_id, 1, 3) <> 'REO'
                     OR length(reo_id) < 9 OR substr(reo_id, 4) GLOB '*[^0-9]*'
                    THEN 1 ELSE 0 END) AS invalid_ids
    FROM web_reaction_enzymes
  `).get();
  assert.equal(Number(stats.total), Number(stats.distinct_ids));
  assert.equal(Number(stats.invalid_ids), 0);
  const legacyFirst = db.prepare("SELECT reo_id FROM web_reaction_enzymes WHERE rowid = 1").get();
  assert.equal(legacyFirst.reo_id, "REO000001");
  db.close();

  const registry = new DatabaseSync(registryPath, { readOnly: true });
  const registered = registry.prepare("SELECT COUNT(*) AS count FROM reo_ids").get();
  assert.ok(Number(registered.count) >= Number(stats.total));
  assert.equal(Number(registry.prepare("SELECT COUNT(*) AS count FROM reo_ids WHERE reo_id='REO000001'").get().count), 1);
  registry.close();

  for (const format of ["csv", "tsv"]) {
    const file = path.join(bundleDir, `tables/web_reaction_enzymes.${format}.gz`);
    const header = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8").split(/\r?\n/, 1)[0];
    assert.ok(header.split(format === "csv" ? "," : "\t").includes("reo_id"));
  }
});

test("citation, licence and QA preserve snapshot identity and unresolved review states", () => {
  const citation = fs.readFileSync(path.join(bundleDir, "CITATION.cff"), "utf8");
  const license = fs.readFileSync(path.join(releaseDir, "LICENSE_DATA.txt"), "utf8");
  const qa = JSON.parse(fs.readFileSync(path.join(releaseDir, integrity.runtime_qa.file), "utf8"));
  assert.match(citation, /^cff-version: 1\.2\.0/m);
  assert.match(citation, /^type: dataset/m);
  const governance = JSON.parse(fs.readFileSync(path.join(releaseDir, "PUBLIC_RELEASE_GOVERNANCE.json"), "utf8"));
  assert.equal(qa.snapshot_id, governance.snapshot_id);
  assert.equal(manifest().data_snapshot, readReviewedCatalog(publicRoot).source_snapshot);
  assert.ok(citation.includes(`version: "${governance.snapshot_id}"`));
  if (governance.snapshot_state === "local_working_candidate") {
    assert.doesNotMatch(citation, /^date-released:/m, "an unpublished local candidate must not claim a release date");
  } else {
    assert.ok(citation.includes(`date-released: "${governance.public_snapshot.frozen_at_utc.slice(0, 10)}"`));
  }
  if (governance.snapshot_state === "server_frozen_public_bytes") assert.equal(governance.snapshot_id, governance.public_snapshot.snapshot_id);
  assert.deepEqual(governance.public_snapshot.counts, governance.local_core.counts);
  assert.equal(governance.licence.status, "approval_pending");
  assert.equal(governance.licence.blanket_open_data_grant, false);
  assert.equal(governance.long_term_archive.doi, null);
  assert.match(license, /approval pending/i);
  assert.doesNotMatch(license, /are released under the Creative Commons/i);
  assert.match(citation, /^title: "ReactEnzDB: Reaction-centered Enzyme Evidence and Implementation Database,/m);
  assert.doesNotMatch(license, /review before launch|placeholder/i);
  assert.equal(qa.version, "2026.09.1");
  assert.ok(qa.automated_integrity_checks.every((item) => item.status === "pass"));
  assert.equal(qa.manual_review.status, "pending_human_review");
  assert.match(qa.manual_review.historical_materials_boundary, /not a completed review/);
  assert.ok(qa.structure_coverage_sets);
  assert.ok(qa.annotation_richness_score);

  assert.equal(governance.quality_review.independent_review_completed, false);
});

test("reaction standardization runtime is complete, integrity-checked, and publication-scoped", async () => {
  const databasePath = path.join(releaseDir, "reaction_standardization.sqlite");
  const summaryPath = path.join(releaseDir, "reaction_standardization.summary.json");
  assert.ok(fs.existsSync(databasePath));
  assert.ok(fs.existsSync(summaryPath));
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  const digest = await hashFile(databasePath);
  assert.equal(summary.standardization_sha256, digest);
  assert.equal(summary.checks.integrity, "ok");
  assert.equal(summary.tables.reaction_inputs, coreReactionCount());
  assert.equal(summary.tables.standardized_reactions, coreReactionCount());
  assert.equal(summary.tables.balance_results, coreReactionCount() * 2);

  const db = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM reaction_inputs i JOIN standardized_reactions s USING(reaction_id)").get().count), coreReactionCount());
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM balance_results").get().count), coreReactionCount() * 2);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='external_reactions'").get().count), 0);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM atom_mappings WHERE public_structure_detail=0 AND atom_mapped_reaction_smiles IS NOT NULL").get().count), 0);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM atom_mappings").get().count), summary.tables.atom_mappings);
  assert.ok(Number(db.prepare("SELECT COUNT(*) AS count FROM atom_mappings WHERE public_structure_detail=1 AND atom_mapped_reaction_smiles IS NOT NULL").get().count) > 0);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM cross_database_mappings WHERE target_db IN ('KEGG','MetaCyc') AND evidence_json LIKE '%external_reaction_smiles%'").get().count), 0);
  db.close();
});

test("reaction standardization quality gates support reproducible search intersections", () => {
  const db = new DatabaseSync(path.join(releaseDir, "reaction_standardization.sqlite"), { readOnly: true });
  const row = db.prepare(`
    SELECT COUNT(*) AS count FROM reaction_inputs i
    WHERE EXISTS (SELECT 1 FROM balance_results b WHERE b.reaction_id=i.reaction_id AND b.balance_context='full_explicit' AND b.mass_balance_status='balanced')
      AND EXISTS (SELECT 1 FROM balance_results b WHERE b.reaction_id=i.reaction_id AND b.balance_context='full_explicit' AND b.charge_balance_status='balanced')
      AND EXISTS (SELECT 1 FROM cross_database_mappings m WHERE m.reaction_id=i.reaction_id AND m.target_db='Rhea' AND m.chemistry_equivalence='exact_normalized_identity')
      AND EXISTS (SELECT 1 FROM atom_mappings a WHERE a.reaction_id=i.reaction_id AND a.mapping_status IN ('valid','valid_with_warnings','validated_predicted'))
      AND NOT EXISTS (SELECT 1 FROM mapping_conflicts c WHERE c.reaction_id=i.reaction_id)
  `).get();
  const summary = JSON.parse(fs.readFileSync(path.join(releaseDir, "reaction_standardization.summary.json"), "utf8"));
  assert.equal(Number(row.count), summary.quality_gates.balanced_exact_rhea_atom_mapping_no_conflict);
  assert.ok(Number(row.count) > 0 && Number(row.count) <= coreReactionCount());
  db.close();
});

test("candidate diversity analysis is complete, bounded, and evidence-scoped", () => {
  const databasePath = path.join(releaseDir, "candidate_diversity_analysis.sqlite");
  const summaryPath = path.join(releaseDir, "candidate_diversity_analysis.summary.json");
  assert.ok(fs.existsSync(databasePath));
  assert.ok(fs.existsSync(summaryPath));

  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  assert.equal(summary.thresholds.length, 4);
  assert.match(summary.definitions.kinetic_snapshot, /final standardized BRENDA/i);

  const db = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM reaction_candidate_diversity").get().count), summary.counts.reactions);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM threshold_coverage_summary").get().count), 4);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM qa_results WHERE passed=0").get().count), 0);
  assert.equal(Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM reaction_candidate_diversity
    WHERE unique_sequence_count > enzyme_candidate_count
       OR nr100_cluster_count < 1 OR nr100_cluster_count > unique_sequence_count
       OR nr90_cluster_count < 1 OR nr90_cluster_count > unique_sequence_count
       OR nr70_cluster_count < 1 OR nr70_cluster_count > unique_sequence_count
       OR nr50_cluster_count < 1 OR nr50_cluster_count > unique_sequence_count
  `).get().count), 0);
  assert.equal(Number(db.prepare("SELECT SUM(multiple_nr70_clusters) AS count FROM reaction_candidate_diversity").get().count), summary.counts.reactions_with_multiple_nr70_clusters);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM reaction_candidate_diversity WHERE multimodal_candidate_count>0").get().count), summary.counts.reactions_with_multimodal_candidates);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM reaction_candidate_diversity WHERE reaction_supported_candidate_count>0").get().count), summary.counts.reactions_with_reaction_supported_candidates);
  assert.equal(Number(db.prepare("SELECT value FROM final_evidence_summary WHERE metric='reactions_with_exact_substrate_product_candidates'").get().value), summary.counts.reactions_with_exact_substrate_product_candidates);
  db.close();

  const clusterDb = new DatabaseSync(path.join(releaseDir, "enzyme_sequence_clusters.sqlite"), { readOnly: true });
  assert.equal(clusterDb.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.equal(clusterDb.prepare("SELECT value FROM metadata WHERE key='final_evidence_refresh_status'").get().value, "complete_standardized_brenda_sabio_core");
  const clusterSummary = JSON.parse(fs.readFileSync(path.join(releaseDir, "enzyme_sequence_clusters.summary.json"), "utf8"));
  assert.equal(Number(clusterDb.prepare("SELECT COUNT(*) AS count FROM final_reaction_enzyme_evidence").get().count), clusterSummary.final_evidence_refresh.counts.matched_reaction_enzyme_pairs);
  assert.equal(Number(clusterDb.prepare("SELECT COUNT(*) AS count FROM final_evidence_qa WHERE passed=0").get().count), 0);
  assert.equal(Number(clusterDb.prepare("SELECT COUNT(*) AS count FROM final_reaction_cluster_evidence").get().count), Number(clusterDb.prepare("SELECT COUNT(*) AS count FROM reaction_sequence_clusters").get().count));
  clusterDb.close();
});

test("12-host pathway coverage is complete and mapping-limited hosts are not overinterpreted", () => {
  const databasePath = path.join(releaseDir, "host_pathway_coverage_analysis.sqlite");
  const summaryPath = path.join(releaseDir, "host_pathway_coverage_analysis.summary.json");
  assert.ok(fs.existsSync(databasePath));
  assert.ok(fs.existsSync(summaryPath));
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  assert.equal(summary.counts.hosts, 12);
  assert.equal(summary.counts.analysis_ready_hosts, 10);
  assert.equal(summary.counts.limited_mapping_hosts, 1);
  assert.equal(summary.counts.unavailable_mapping_hosts, 1);
  assert.equal(summary.counts.reactenz_reactions, coreReactionCount());
  assert.match(summary.pathway_boundary, /not ordered/i);
  assert.match(summary.cofactor_boundary, /not flux/i);

  const db = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM reaction_host_coverage").get().count), summary.counts.hosts * coreReactionCount());
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM pathway_host_coverage").get().count), summary.counts.hosts * summary.counts.pathway_membership_sets);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM pathway_step_host_status").get().count), summary.counts.hosts * summary.counts.reaction_pathway_memberships);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM qa_results WHERE passed=0").get().count), 0);
  assert.equal(Number(db.prepare("SELECT SUM(exact_native_reaction_count) AS count FROM host_coverage_summary").get().count), Number(db.prepare("SELECT COUNT(*) AS count FROM reaction_host_coverage WHERE exact_native=1").get().count));
  assert.deepEqual(db.prepare("SELECT * FROM host_coverage_summary ORDER BY exact_native_reaction_count DESC,host_id").all().map(row => ({ ...row })), summary.host_coverage);
  const recorded = Object.fromEntries(db.prepare("SELECT key,value FROM metadata").all().map(row => [row.key, row.value]));
  assert.equal(summary.generated_at_utc, recorded.generated_at_utc);
  for (const key of ["core_database_sha256", "host_database_sha256", "model_database_sha256"]) assert.equal(summary[key], recorded[key], "recorded analysis inputs must not be relabelled as newly computed");
  assert.equal(Number(db.prepare(`
    SELECT COUNT(*) AS count FROM reaction_host_coverage r
    JOIN host_coverage_summary h USING(host_id)
    WHERE h.mapping_readiness <> 'available'
      AND r.exact_native=0
      AND r.implementation_status <> 'not_evaluated'
  `).get().count), 0);
  assert.equal(Number(db.prepare(`
    SELECT COUNT(*) AS count FROM pathway_host_coverage
    WHERE exact_native_step_count + heterologous_candidate_step_count + unresolved_step_count + not_evaluated_step_count <> step_count
  `).get().count), 0);
  db.close();
});

test("experimental expression release is complete, traceable, and public-safe", () => {
  const expressionDbPath = path.resolve(process.cwd(), "../../../expression_work/expression_evidence.sqlite");
  const summaryPath = path.join(releaseDir, "downloads/expression_evidence_release.summary.json");
  assert.ok(fs.existsSync(expressionDbPath));
  assert.ok(fs.existsSync(summaryPath));
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  assert.equal(summary.status, "machine_extracted_pending_human_review");
  assert.equal(summary.counts.candidate_articles, 6861);
  assert.equal(summary.counts.fulltext_available, 3443);
  assert.equal(summary.counts.articles_with_candidates, 3013);
  assert.equal(summary.counts.expression_candidates, 3369);
  assert.equal(summary.counts.source_spans, 9912);
  assert.equal(summary.counts.candidate_enzyme_reaction_links, 14978);
  assert.match(summary.public_release_boundary, /No PDFs/i);

  for (const artifact of summary.artifacts) {
    const filePath = path.join(releaseDir, artifact.file);
    assert.ok(fs.existsSync(filePath), `missing expression artifact: ${artifact.file}`);
    assert.equal(fs.statSync(filePath).size, artifact.size);
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"), artifact.sha256);
    const content = zlib.gunzipSync(fs.readFileSync(filePath)).toString("utf8");
    assert.doesNotMatch(content, /[A-Z]:\\/i, `local path leaked by ${artifact.file}`);
    assert.doesNotMatch(content, /\.pdf(?:\t|\r|\n|$)/i, `PDF path leaked by ${artifact.file}`);
  }

  const db = new DatabaseSync(expressionDbPath, { readOnly: true });
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.equal(Number(db.prepare("SELECT COUNT(*) count FROM article_master_correspondence").get().count), 6861);
  assert.equal(Number(db.prepare("SELECT COUNT(*) count FROM expression_assertions").get().count), 0);
  assert.equal(Number(db.prepare("SELECT COUNT(*) count FROM expression_evidence_candidates WHERE curation_status NOT LIKE '%pending%'").get().count), 0);
  db.close();
});
