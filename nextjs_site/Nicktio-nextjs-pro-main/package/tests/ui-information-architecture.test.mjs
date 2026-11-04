import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(projectRoot, ...parts), "utf8");
const relationsPage = read("src", "app", "relations", "page.tsx");
const associationPage = read("src", "app", "relations", "[reoId]", "page.tsx");
const reactionPage = read("src", "app", "reactions", "[reactionId]", "page.tsx");
const enzymePage = read("src", "app", "enzymes", "[biopartId]", "page.tsx");
const reactionTable = read("src", "components", "ReactEnz", "ReactionTable.tsx");
const dataLayer = read("src", "lib", "reactenzdb.ts");
const sqliteLayer = read("src", "lib", "sqlite.ts");
const searchPage = read("src", "app", "search", "page.tsx");
const smilesSearch = read("scripts", "reaction_smiles_search.py");
const statisticsPage = read("src", "app", "statistics", "page.tsx");
const downloadsPage = read("src", "app", "downloads", "page.tsx");
const apiDocumentation = read("src", "app", "documentation", "api", "page.tsx");
const openApiRoute = read("src", "app", "api", "reactenzdb", "openapi", "route.ts");
const exportRoute = read("src", "app", "api", "reactenzdb", "export", "route.ts");
const releaseMetrics = read("src", "lib", "releaseMetrics.ts");
const databaseMap = read("src", "components", "ReactEnz", "DatabaseMap.tsx");
const homePage = read("src", "app", "page.tsx");
const pathwayExport = read("src", "components", "ReactEnz", "PathwayBatchExport.tsx");
const currentPublicCopy = [
  read("src", "app", "about", "page.tsx"),
  read("src", "app", "help", "page.tsx"),
  read("src", "app", "methodology", "page.tsx"),
  read("src", "app", "(site)", "documentation", "page.tsx"),
  read("src", "app", "page.tsx"),
  read("src", "app", "reactions", "page.tsx"),
  read("src", "app", "enzymes", "page.tsx"),
  read("src", "app", "retrosynthesis", "page.tsx"),
  read("src", "components", "ReactEnz", "RetrosynthesisWorkbench.tsx"),
  read("scripts", "generate_statistics_assets.py"),
];
const statisticsSummary = JSON.parse(read("public", "reactenzdb", "statistics", "statistics_summary.json"));

test("association UI keeps reo_id while presenting reaction–enzyme associations", () => {
  assert.match(relationsPage, /Reaction–Enzyme Associations/);
  assert.match(relationsPage, /Association ID/);
  assert.match(relationsPage, /Source organism/);
  assert.match(relationsPage, />Evidence</);
  assert.match(relationsPage, />Kinetics</);
  assert.match(relationsPage, />References</);
  assert.match(associationPage, /record\.reo_id/);
  assert.match(associationPage, /Stable association ID/);
  assert.match(dataLayer, /WHERE re\.reo_id =/);
  assert.match(dataLayer, /AS kinetic_count/);
  assert.match(dataLayer, /AS reference_count/);
});

test("source organism and chassis annotations remain distinct from hosts", () => {
  for (const source of [relationsPage, associationPage, reactionPage, enzymePage]) {
    assert.doesNotMatch(source, /Reaction–enzyme–organism records/);
    assert.doesNotMatch(source, /title="Expression [Cc]hassis"/);
  }
  assert.match(associationPage, /not an engineering-host assignment/);
  assert.match(reactionPage, /Chassis annotations/);
  assert.match(reactionPage, /backHref="\/reactions"/);
  assert.match(reactionPage, /backLabel="Reactions"/);
  assert.match(reactionPage, /IdentifierMeta/);
  assert.match(reactionPage, /text-\[11px\] font-semibold uppercase/);
  assert.doesNotMatch(reactionPage, /text-\[10px\]/);
  assert.match(reactionPage, /sm:grid-cols-2/);
  assert.match(reactionPage, /items-center/);
  assert.match(reactionPage, />Identifiers</);
  assert.doesNotMatch(reactionPage, /h-52/);
  assert.doesNotMatch(reactionPage, /pt-8/);
  assert.match(enzymePage, /not curated metabolic hosts/);
  assert.match(enzymePage, /backHref="\/enzymes"/);
  assert.match(enzymePage, /backLabel="Enzymes"/);
  assert.match(reactionTable, /label="Associations"/);
  assert.doesNotMatch(reactionTable, /label="R-E records"/);
});

test("reaction candidate comparison exposes evidence fields without a combined recommendation score", () => {
  assert.match(reactionPage, /Enzyme Candidate Evidence Table/);
  assert.match(reactionPage, /No combined recommendation or feasibility score is calculated here/);
  assert.doesNotMatch(reactionPage, /function candidateDecisionScore/);
  assert.doesNotMatch(reactionPage, /top decision score/);
  assert.doesNotMatch(reactionPage, /Host\/chassis evidence/);
});

test("detail-page evidence index is labeled as annotation richness", () => {
  for (const source of [reactionPage, enzymePage]) {
    assert.match(source, /Release-derived annotation richness/);
    assert.match(source, /richness index/);
    assert.doesNotMatch(source, /Transparent evidence confidence/);
  }
});

test("enzyme detail does not leak CJK into English UI copy", () => {
  assert.doesNotMatch(enzymePage, /[\u4e00-\u9fff]/);
  assert.match(enzymePage, /\\u00B7/);
  assert.match(enzymePage, /overflow-wrap:anywhere/);
});

test("statistics and search use the registered public terminology", () => {
  assert.match(releaseMetrics, /label: "Association Records"/);
  assert.match(releaseMetrics, /label: "Source Organisms"/);
  assert.match(releaseMetrics, /label: "Chassis Annotations"/);
  assert.match(releaseMetrics, /label: "Host models"/);
  assert.match(downloadsPage, /getPublicHeroMetrics/);
  assert.doesNotMatch(downloadsPage, /getCoreReleaseMetrics/);
  assert.match(databaseMap, /value\("chassis_labels"\).*Chassis annotations/);
  assert.match(databaseMap, /Host models/);
  assert.match(sqliteLayer, /export function sqliteFts5Available/);
  assert.match(dataLayer, /sqliteFts5Available\(DB_PATH\)/);
  assert.match(dataLayer, /function likeTokenClause/);
  assert.match(searchPage, /searchEnzymesPage/);
  assert.match(searchPage, /Matching records/);
  assert.match(searchPage, /parseSearchQuery/);
  assert.match(searchPage, /Match substrate and product/);
  assert.match(searchPage, /id="search-results"/);
  assert.match(searchPage, /SearchResultsJump/);
  assert.doesNotMatch(searchPage, /Refine search/);
  assert.ok(searchPage.indexOf("id=\"transformation-search\"") < searchPage.indexOf("{results}"));
  assert.match(searchPage, /enzymeHits\?\.total/);
  assert.match(searchPage, /reactionHits\?\.total/);
  assert.match(searchPage, /structureMatchTotal/);
  assert.match(searchPage, /Look up substrate \/ product/);
  assert.match(searchPage, /transformationReactions/);
  assert.match(searchPage, /No reaction record matched this identifier/);
  assert.match(searchPage, /SearchClearButton/);
  assert.match(searchPage, /StructureSearchField/);
  assert.match(searchPage, /name="q"/);
  assert.doesNotMatch(searchPage, /name="enzyme"/);
  assert.doesNotMatch(searchPage, /name="host"/);
  assert.doesNotMatch(searchPage, /name="organism"/);
  assert.match(searchPage, /Reaction, enzyme, or host/);
  assert.match(searchPage, /Reaction ID or EC; enzyme name, gene or UniProt; host or model name/);
  assert.match(searchPage, /Search reactions, enzymes, and hosts/);
  assert.doesNotMatch(searchPage, /Start with a transformation/);
  assert.match(read("src", "components", "Layout", "Header", "index.tsx"), /action: "\/search#search-results"/);
  assert.doesNotMatch(read("src", "components", "Layout", "Header", "index.tsx"), /placeholder: "Search reactions"/);
  assert.doesNotMatch(read("src", "components", "Layout", "Header", "index.tsx"), /Sequence families/);
  assert.doesNotMatch(read("src", "app", "browse", "page.tsx"), /Sequence families/);
  assert.doesNotMatch(read("src", "app", "browse", "page.tsx"), /One route through the lists/);
  assert.doesNotMatch(read("src", "app", "browse", "page.tsx"), /Also in this release/);
  assert.doesNotMatch(read("src", "app", "browse", "page.tsx"), /href: "\/relations"/);
  assert.doesNotMatch(read("src", "app", "browse", "page.tsx"), /Expression evidence/);
  assert.match(read("src", "app", "browse", "page.tsx"), /Open reactions/);
  assert.match(read("src", "app", "browse", "page.tsx"), /Open enzymes/);
  assert.match(read("src", "app", "browse", "page.tsx"), /Open hosts/);
  assert.doesNotMatch(read("src", "app", "help", "page.tsx"), /remain on the Browse page/);
  assert.doesNotMatch(read("src", "app", "help", "page.tsx"), /plus associations, source organisms/);
  assert.match(read("src", "app", "help", "page.tsx"), /summary className="cursor-pointer text-base font-black/);
  assert.doesNotMatch(read("src", "app", "help", "page.tsx"), /summary className="cursor-pointer text-lg font-black/);
  assert.doesNotMatch(read("src", "app", "help", "page.tsx"), /max-w-4xl/);
  assert.doesNotMatch(read("src", "app", "tools", "page.tsx"), /max-w-4xl|max-w-5xl/);
  assert.doesNotMatch(read("src", "app", "documentation", "api", "page.tsx"), /max-w-5xl/);
  assert.doesNotMatch(read("src", "app", "maintenance", "page.tsx"), /max-w-5xl/);
  assert.doesNotMatch(read("src", "app", "methodology", "page.tsx"), /max-w-5xl/);
  assert.doesNotMatch(read("src", "app", "globals.css"), /\.reactenz-download-section-title > div:last-child:not\(:first-child\) \{\s*max-width: 980px/);
  assert.doesNotMatch(read("src", "app", "globals.css"), /summary > div > div \{ max-width: 930px/);
  assert.doesNotMatch(read("src", "components", "Layout", "Header", "index.tsx"), /label: "Associations"/);
  assert.doesNotMatch(read("src", "components", "Layout", "Header", "index.tsx"), /label: "Source organisms"/);
  assert.doesNotMatch(read("src", "components", "Layout", "Header", "index.tsx"), /label: "Chassis annotations"/);
  assert.doesNotMatch(read("src", "components", "Layout", "Header", "index.tsx"), /label: "Expression evidence"/);
  assert.match(read("src", "components", "Layout", "Footer", "index.tsx"), /label: "Hosts"/);
  assert.match(reactionPage, /if \(!reaction\) notFound\(\)/);
  assert.match(enzymePage, /if \(!enzyme\) notFound\(\)/);
  assert.match(read("src", "components", "ReactEnz", "DetailJumpNav.tsx"), /ParentBackLink/);
  assert.match(read("src", "components", "ReactEnz", "DetailJumpNav.tsx"), /lg:top-\[88px\]/);
  assert.doesNotMatch(read("src", "components", "ReactEnz", "ParentBackLink.tsx"), /sticky /);
  assert.match(smilesSearch, /lower\(compound_name\) = lower/);
  assert.match(smilesSearch, /fingerprint_scan/);
  assert.match(smilesSearch, /canonicalize_query_term/);
  assert.match(smilesSearch, /isomericSmiles=True/);
  assert.match(dataLayer, /function canonicalizeSmilesTerms/);
  assert.match(dataLayer, /canonicalizeSmilesTerms\(params\.substrates\)/);
  const matchRoute = read("src", "app", "api", "retrosynthesis", "match", "route.ts");
  // Ambiguity, direction and candidate-only status are exercised through the
  // actual API in retrosynthesis-integration.test.mjs, not private variable names.
  assert.match(matchRoute, /matches,/);
  assert.match(matchRoute, /unique\?\.target \?\? null/);
  assert.match(dataLayer, /EC\[:\\s\]\*\(\\d\+/);
  assert.match(dataLayer, /sqlite_fts_search.py/);
  assert.match(dataLayer, /looksLikeStructureQuery/);
  assert.match(dataLayer, /web_reaction_ec_numbers/);
  assert.match(dataLayer, /ec_number_clean/);
  assert.match(dataLayer, /export function parseSearchQuery/);
  assert.match(dataLayer, /kind: "chebi"/);
  assert.match(dataLayer, /function reoTextSearchClause/);
  assert.match(dataLayer, /function catalogNameClause/);
  assert.match(dataLayer, /looksLikeStructureQuery/);
  assert.match(dataLayer, /web_reaction_ec_numbers/);
  assert.match(dataLayer, /ec_number_clean/);
  assert.match(dataLayer, /export function parseSearchQuery/);
  assert.match(searchPage, /Look up a record/);
  assert.match(searchPage, /Match substrate and product/);
  assert.match(searchPage, /These are not curated metabolic hosts/);
  assert.doesNotMatch(searchPage, /Associations, source organisms, and chassis annotations remain under Browse/);
  assert.doesNotMatch(searchPage, /remain under Browse/);
  assert.doesNotMatch(searchPage, /stay on the Browse list pages/);
  assert.doesNotMatch(searchPage, /Search a data layer/);
  assert.doesNotMatch(searchPage, /Quick search/);
  assert.doesNotMatch(searchPage, /title: "R-E-O records"/);
  assert.doesNotMatch(searchPage, /title: "Expression chassis"/);
  assert.match(statisticsPage, /Top chassis annotations/);
  assert.doesNotMatch(statisticsPage, /Top expression chassis/);
  assert.doesNotMatch(statisticsPage, /Association Records/);
  assert.match(statisticsPage, /host-model candidates/);
  assert.match(statisticsPage, /not a curated-host catalog/);
  assert.match(databaseMap, /hostHref = "\/hosts"/);
  assert.doesNotMatch(databaseMap, /hosts\/preliminary/);
  assert.doesNotMatch(homePage, /hosts\/preliminary/);
  assert.match(homePage, /href: "\/enzymes"/);
  assert.match(homePage, /Browse enzymes/);
  assert.match(homePage, /Choose a planning tool/);
  assert.match(homePage, /href: "\/tools"/);
  assert.doesNotMatch(homePage, /Inspect host-model context/);
  assert.doesNotMatch(homePage, /Build with the data/);
  assert.match(databaseMap, /rdb-map-kicker">Host</);
  assert.doesNotMatch(databaseMap, />CONTEXT</);
  assert.doesNotMatch(databaseMap, /reaction–enzyme association records/);
  assert.match(pathwayExport, /Preliminary host-model coverage ranking/);
  assert.doesNotMatch(pathwayExport, /Recommended chassis/);
  assert.doesNotMatch(pathwayExport, /Host-aware enzyme ranking/);
  assert.doesNotMatch(apiDocumentation, /pathway host-aware ranking/);
  const toolsPage = read("src", "app", "tools", "page.tsx");
  const toolRunPage = read("src", "app", "tools", "[toolSlug]", "page.tsx");
  const workbench = read("src", "components", "ReactEnz", "RetrosynthesisWorkbench.tsx");
  assert.match(toolsPage, /toolHref\(tool\.tool_id\)/);
  assert.match(toolsPage, /Open \{tool\.name\}/);
  assert.doesNotMatch(toolsPage, /tools\/retrosynthesis#/);
  assert.match(toolRunPage, /fixedTool=\{toolId\}/);
  assert.doesNotMatch(toolRunPage, /siblings=/);
  const toolShell = read("src", "components", "ReactEnz", "ToolRunPage.tsx");
  assert.doesNotMatch(toolShell, /Other tools/);
  assert.doesNotMatch(toolShell, /Tool comparison/);
  assert.match(toolShell, /ParentBackLink/);
  assert.match(toolShell, /label="Tools"/);
  assert.match(workbench, /fixedTool: Predictor/);
  assert.doesNotMatch(workbench, /Select a reproduced predictor/);
  assert.doesNotMatch(workbench, /text-\[30px\]/);
  assert.doesNotMatch(workbench, /Plan a single biochemical disconnection/);
  assert.match(workbench, /StructureSearchField/);
  assert.match(workbench, /placeholder="SMILES, or draw \/ load a structure"/);
  assert.doesNotMatch(workbench, /useState\("COc1cc/);
  const hostWorkbench = read("src", "components", "ReactEnz", "PathwayHostInputWorkbench.tsx");
  const matchPanel = read("src", "components", "ReactEnz", "ReactionMatchPanel.tsx");
  assert.match(matchPanel, /mapping\.matches\?\.length/);
  assert.match(matchPanel, /Matched reference reaction \$\{index \+ 1\} of \$\{total\}/);
  const styles = read("src", "app", "globals.css");
  assert.doesNotMatch(hostWorkbench, /scientific_name\} · \{host\.model_name\}/);
  assert.match(hostWorkbench, /type="checkbox"/);
  assert.match(matchPanel, /bg-primary px-3 py-1 font-mono text-xs font-black text-white/);
  assert.match(workbench, /Open in Search/);
  assert.match(workbench, /bg-primary px-4 py-2 text-sm font-black text-white/);
  assert.match(styles, /button\[class~="bg-primary"\]/);
  assert.match(styles, /textarea::placeholder/);
});

test("current public copy does not regress to legacy product terminology", () => {
  for (const source of currentPublicCopy) {
    assert.doesNotMatch(source, /R-E-O record|reaction[-–]enzyme[-–]organism|expression chassis|chassis labels|Chassis layer|title: "Organism search"|>Organism</i);
  }
  assert.match(downloadsPage, /existing XLS headers/);
  assert.match(apiDocumentation, /original R-E-O data model/);
});

test("statistics use the strict released kinetics population throughout", () => {
  const total = statisticsSummary.overall.kinetics;
  const sum = (rows) => rows.reduce((value, row) => value + row.count, 0);
  const types = Object.fromEntries(statisticsSummary.kinetics.parameter_types.map((row) => [row.label, row.count]));
  assert.ok(types.km > 0);
  assert.ok(types.kcat > 0);
  assert.ok(types.kcat_km > 0);
  assert.equal(sum(statisticsSummary.kinetics.parameter_types), total);
  assert.equal(sum(statisticsSummary.kinetics.assignment_status), total);
  assert.ok(sum(statisticsSummary.kinetics.source_db) <= total);
  assert.ok(statisticsSummary.kinetics.source_db.every((row) => !/^\d+$/.test(row.label)));
  assert.doesNotMatch(statisticsPage, /Public kinetics are Km only/);
  assert.match(statisticsPage, /qualifying source-verified Vmax assays/);
});

test("API and download terminology changes preserve the 2026.08.1 contract", () => {
  assert.match(apiDocumentation, /Display names changed; the wire contract did not/);
  assert.match(apiDocumentation, /\/relations · reo_id · relation/);
  assert.match(openApiRoute, /summary: "Search Reaction–Enzyme Associations"/);
  assert.match(openApiRoute, /name: "reo_id"/);
  assert.match(openApiRoute, /name: "organism"/);
  assert.match(openApiRoute, /name: "chassis"/);
  assert.match(openApiRoute, /Release 2026\.08\.1 routes and field names are retained/);
  assert.match(downloadsPage, /existing XLS headers/);
  // Filtered exports retain their wire contract while omitting collection labels.
  assert.match(exportRoute, /projectExportValue/);
  assert.doesNotMatch(exportRoute, /label: "Source database"/);
});
