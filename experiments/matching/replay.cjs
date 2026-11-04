// Run actual retained matcher and actual current Next route with identical frozen inputs.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=path.resolve(__dirname,'../..'),site=path.join(root,'nextjs_site/Nicktio-nextjs-pro-main/package');
const W=path.resolve(process.env.REACTENZDB_EVALUATION_OUTPUT || path.join(__dirname,'results'));fs.mkdirSync(W,{recursive:true});
const ts=require(path.join(site,'node_modules/typescript')),resolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...rest){if(request.startsWith('@/'))request=path.join(site,'src',request.slice(2));return resolve.call(this,request,parent,...rest);};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
process.chdir(site);process.env.REACTENZDB_PYTHON ||= 'python';
process.env.REACTENZDB_RELEASE_DIR ||= path.join(root,'web_release');
process.env.REACTENZDB_EVIDENCE_DB ||= path.join(process.env.REACTENZDB_RELEASE_DIR,'evidence/reactenzdb_evidence_rc.sqlite');
const lib=require(path.join(site,'src/lib/reactenzdb.ts')),route=require(path.join(site,'src/app/api/retrosynthesis/match/route.ts')),ev=require(path.join(site,'src/lib/evidence-release.ts'));
const queries=JSON.parse(fs.readFileSync(path.join(__dirname,'queries.json'),'utf8')),results=[],pairs=new Map();
async function main(){
 const {execFileSync}=require('node:child_process');
 console.log('CHEMISTRY_PREFLIGHT',execFileSync(process.env.REACTENZDB_PYTHON,['-c','from rdkit import rdBase;print(rdBase.rdkitVersion)'],{encoding:'utf8',windowsHide:true}).trim());
 for(const q of queries){
  let old,newResult;const start=performance.now();
  try{old={success:true,matches:lib.findExactRetrosynthesisReactionMatches({substrates:q.precursors,products:q.product,limit:5}).map(m=>{const t=lib.getReaction(m.reaction_id);return{target:t,candidates:lib.findEnzymeCandidates({target:m.reactenz_reaction_id,limit:30}).candidates};})};}catch(e){old={success:false,error:String(e),matches:[]};}
  const middle=performance.now();
  try{const response=await route.POST(new Request('http://localhost/api/retrosynthesis/match',{method:'POST',body:JSON.stringify({precursors:q.precursors,product:q.product})}));newResult={success:response.ok,http_status:response.status,...await response.json()};}catch(e){newResult={success:false,error:String(e),matches:[]};}
  for(const [arm,data] of [['A',old],['B',newResult]])for(const m of data.matches||[]){
   const rid=m.structure_match?.reaction_id||m.target.reaction_id;
   for(const c of m.candidates){const key=rid+'|'+c.biopart_id;if(!pairs.has(key))pairs.set(key,{reaction_id:rid,enzyme_id:c.biopart_id,public_reaction_id:m.target.reactenz_reaction_id,public_enzyme_id:c.reactenz_enzyme_id,query_arms:[]});pairs.get(key).query_arms.push({query:q.id,arm});}
  }
  results.push({query:q,A:old,B:newResult,technical_ms:{A:middle-start,B:performance.now()-middle}});
  fs.writeFileSync(path.join(W,'raw_results.json'),JSON.stringify(results,null,2));console.log(q.id,old.matches.length,newResult.matches?.length||0,newResult.success);
 }
 const evidence=[];
 for(const p of pairs.values()){
  const first=ev.getReactionEnzymeEvidenceDetail(p.reaction_id,p.enzyme_id);const details=[first];
  for(let offset=first.pagination.limit;offset<first.pagination.total;offset+=first.pagination.limit)details.push(ev.getReactionEnzymeEvidenceDetail(p.reaction_id,p.enzyme_id,offset));
  const related={assertions:[],measurements:[],citations:[],assay_conditions:[]};
  for(const d of details)for(const k of Object.keys(related))related[k].push(...d[k]);
  evidence.push({...p,available:first.available,summary:first.summary,pagination:first.pagination,...related});
 }
 fs.writeFileSync(path.join(W,'pair_evidence.json'),JSON.stringify(evidence,null,2));
 fs.writeFileSync(path.join(W,'runtime.json'),JSON.stringify({node:process.version,python:process.env.REACTENZDB_PYTHON,evidence_db:process.env.REACTENZDB_EVIDENCE_DB,queries:results.length,unique_pair_objects:evidence.length,mode:'Actual local route and library execution; not a human usability study'},null,2));
 console.log('REPLAY_COMPLETE',results.length,evidence.length);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
