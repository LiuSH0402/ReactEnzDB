import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Module, { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const site = path.resolve(import.meta.dirname, "..");
const original = Module._resolveFilename;
Module._resolveFilename = function(r,p,...a) {
  if (r.startsWith("@/")) r=path.join(site,"src",r.slice(2));
  return original.call(this,r,p,...a);
};
for (const ext of [".ts",".tsx"]) require.extensions[ext] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,"utf8"), {
  compilerOptions: { module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX },
}).outputText,f);
const lib=require("../src/lib/pairLiterature.ts");
const evidence=require("../src/lib/evidence-release.ts");
const route=require("../src/app/api/retrosynthesis/evidence/route.ts");
const data=JSON.parse(fs.readFileSync(path.join(site,"public/data/reaction-enzyme-literature.json"),"utf8"));
const native=fs.existsSync(path.resolve(process.env.REACTENZDB_RELEASE_DIR || path.resolve(site, "../../../web_release"), "reactenzdb_web.db"));

test("literature records require both exact identities and never propagate to other CADs", () => {
  assert.equal(lib.getPairLiterature("R03262","E115312").length,1);
  assert.equal(lib.getPairLiterature("OENA1868","OENC178551").length,1);
  assert.equal(lib.getPairLiterature("R07661","E023967").length,0);
  assert.equal(lib.getPairLiterature("R03262","E023974").length,0);
  assert.equal(lib.getPairLiterature("R07661","Q02971").length,0);
  assert.equal(lib.getTargetLiterature("enzyme","E023974").length,1);
});

test("target-substrate readout, product limitations, construct and AI status remain explicit", () => {
  assert.equal(data.records.length,2);
  for (const row of data.records) {
    assert.equal(row.independent_human_review_completed,false);
    assert.equal(row.cascade_experiment_confirmed,false);
    assert.equal(row.review_status,"ai_assisted_primary_text_checked");
    assert.ok(row.anchors.every(a => a.url.startsWith(row.paper.url+"#")));
    assert.ok(row.construct && row.assay_readout && row.product_confirmation && row.limitations.length);
  }
  const row=lib.getPairLiterature("R07661","E023974")[0];
  assert.equal(row.gene_locus,"At4g37980");
  assert.equal(row.measurements[0].value,8.46);
  assert.equal(row.measurements[0].uncertainty,7.172);
  assert.match(row.product_confirmation,/do not independently identify cinnamyl alcohol/);
  assert.match(row.product_confirmation,/E\/Z/);
});

test("notes match native protein sequences and existing public pairs",{skip:!native},() => {
  const {getReaction,getEnzyme}=require("../src/lib/reactenzdb.ts");
  const {querySqliteParams}=require("../src/lib/sqlite.ts");
  for(const row of data.records) {
    const enzyme=getEnzyme(row.reactenz_enzyme_id);const reaction=getReaction(row.reactenz_reaction_id);
    assert.equal(enzyme.biopart_id,row.biopart_id);assert.equal(reaction.reaction_id,row.reaction_id);
    assert.equal(crypto.createHash("sha256").update(enzyme.protein_sequence).digest("hex"),row.native_sequence_sha256);
    assert.ok(querySqliteParams(path.resolve(process.env.REACTENZDB_RELEASE_DIR || path.resolve(site, "../../../web_release"), "reactenzdb_web.db"),"SELECT 1 FROM web_reaction_enzymes WHERE reaction_id=? AND biopart_id=?",[row.reaction_id,row.biopart_id]).length);
  }
});

test("pair endpoint exposes separate notes without inventing source assertions",{skip:!native},async() => {
  for(const [rid,eid] of [["R03262","E115312"],["R07661","E023974"]]) {
    const r=await route.GET(new Request(`http://localhost/api/retrosynthesis/evidence?reactionId=${rid}&enzymeId=${eid}`));
    assert.equal(r.status,200);const b=await r.json();assert.equal(b.literature_records.length,1);
    assert.equal(b.assertions.length,0);assert.equal(b.pagination.total,0);assert.equal(b.summary,null);
  }
  const r=await route.GET(new Request("http://localhost/api/retrosynthesis/evidence?reactionId=R07661&enzymeId=E023967"));
  assert.equal((await r.json()).literature_records.length,0);
  const invalid=await route.GET(new Request("http://localhost/api/retrosynthesis/evidence?reactionId=R03262&enzymeId=E023974"));
  assert.equal(invalid.status,404);
});

test("reaction detail notes survive an empty source-assay summary",{skip:!native},() => {
  const b=evidence.getReactionEvidenceBundle("R03262");
  assert.equal(b.literature_records.length,1);assert.equal(b.summary,null);
  const React=require("react");const {renderToStaticMarkup}=require("react-dom/server");
  const Panel=require("../src/components/ReactEnz/SpecificReactionEvidence.tsx").default;
  const html=renderToStaticMarkup(React.createElement(Panel,{bundle:b}));
  assert.match(html,/Pair-linked literature notes/);assert.match(html,/27917101/);
});

test("candidate button stays available with a literature note and no assay summary", () => {
  const React=require("react");const {renderToStaticMarkup}=require("react-dom/server");
  const Candidate=require("../src/components/ReactEnz/ReactionCandidateEvidence.tsx").default;
  const html=renderToStaticMarkup(React.createElement(Candidate,{summary:null,available:true,literatureCount:1,url:"/api/retrosynthesis/evidence?reactionId=R07661&enzymeId=E023974"}));
  assert.match(html,/View pair evidence/);assert.match(html,/1 pair-linked literature note/);
  assert.match(html,/No source assay assertions mapped/);
});
