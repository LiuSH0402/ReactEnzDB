"""Recompute the original development metrics; no human accuracy or timing claims."""
import os
from pathlib import Path
import json,hashlib,sqlite3,random
from collections import Counter,defaultdict
from datetime import datetime,timezone
HERE=Path(__file__).resolve().parent; ROOT=HERE.parents[1]
W=Path(os.environ.get('REACTENZDB_EVALUATION_OUTPUT', HERE/'results')).resolve()
def load(p):return json.loads(p.read_text(encoding='utf-8'))
def save(name,obj):(W/name).write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding='utf-8')
rows=load(W/'raw_results.json');pairs=load(W/'pair_evidence.json')
assert len(rows)==61 and all(r['A']['success'] and r['B']['success'] for r in rows)
assert all(r['B']['accepted_reaction_identity'] is False for r in rows)
dbpath=Path(os.environ.get('REACTENZDB_EVIDENCE_DB', Path(os.environ.get('REACTENZDB_RELEASE_DIR',ROOT/'web_release'))/'evidence/reactenzdb_evidence_rc.sqlite'))
db=sqlite3.connect(dbpath.as_uri()+'?mode=ro',uri=True)
violations=[]
for p in pairs:
 assert len(p['assertions'])==p['pagination']['total']
 ids={a['assertion_id'] for a in p['assertions']}
 for a in p['assertions']:
  if a['reaction_id']!=p['reaction_id'] or not db.execute('SELECT 1 FROM assertion_enzyme_links WHERE assertion_id=? AND biopart_id=?',(a['assertion_id'],p['enzyme_id'])).fetchone():violations.append((p['reaction_id'],p['enzyme_id'],a['assertion_id']))
 for k in ['measurements','citations','assay_conditions']:assert all(v['assertion_id'] in ids for v in p[k])
 assert len(ids)==len(p['assertions'])
db.close();assert not violations
def evidence_profile(p):
 measured={m['assertion_id'] for m in p['measurements'] if m.get('release_normalized_value') is not None or m.get('raw_value_numeric') is not None or m.get('raw_value_text')}
 cited={c['assertion_id'] for c in p['citations'] if c.get('pmid') or c.get('doi')}
 exact={a['assertion_id'] for a in p['assertions'] if a['evidence_class']=='exact_substrate_product_experimental_evidence'}
 return dict(has_source=bool(p['assertions']),has_measurement_citation=bool(measured&cited),has_auto_exact_measurement_citation=bool(measured&cited&exact),literature_verified_count=(p['summary'] or {}).get('literature_verified_count',0),source_assertion_count=len(p['assertions']))
for p in pairs:p['audit']=evidence_profile(p)
lookup={(p['reaction_id'],p['enzyme_id']):p for p in pairs}
def pairset(group,arm):
 result=set()
 for r in group:
  for m in r[arm]['matches']:
   rid=m.get('structure_match',{}).get('reaction_id') or m['target']['reaction_id']
   result.update((rid,c['biopart_id']) for c in m['candidates'])
 return result
def metric(group,arm):
 keys=pairset(group,arm);selected=[lookup[k] for k in keys]
 return dict(predictions=len(group),raw_smiles_query_pairs=len({(r['query']['precursors'],r['query']['product']) for r in group}),matched_predictions=sum(bool(r[arm]['matches']) for r in group),returned_reference_rows=sum(len(r[arm]['matches']) for r in group),core_pair_record_objects=len(keys),pairs_with_source_assertions=sum(p['audit']['has_source'] for p in selected),pairs_with_same_assertion_measurement_and_pmid_or_doi=sum(p['audit']['has_measurement_citation'] for p in selected),pairs_with_auto_exact_measurement_and_pmid_or_doi=sum(p['audit']['has_auto_exact_measurement_citation'] for p in selected),pairs_with_literature_verified_flag=sum(p['audit']['literature_verified_count']>0 for p in selected),predictions_with_source_pair=sum(any(lookup[k]['audit']['has_source'] for k in pairset([r],arm)) for r in group))
metrics={}
for name,group in [('single_step_all',[r for r in rows if r['query']['cohort']=='single_step_development']),('gsetretro',[r for r in rows if r['query'].get('tool')=='gsetretro']),('readretro',[r for r in rows if r['query'].get('tool')=='readretro']),('multistep_all',[r for r in rows if r['query']['cohort']=='multistep_development']),('engineering_controls',[r for r in rows if r['query']['cohort']=='engineering_controls'])]:metrics[name]={arm:metric(group,arm) for arm in ['A','B']}
cohorts={}
for cohort in ['single_step_development','multistep_development','engineering_controls']:
 group=[r for r in rows if r['query']['cohort']==cohort]
 cohorts[cohort]={'new_status_counts':dict(Counter(r['B']['classification']['level'] for r in group)),'new_truncated_predictions':sum(r['B']['truncated'] for r in group),'new_direction_unspecified_reference_rows':sum(m['structure_match']['direction_status']=='unspecified' for r in group for m in r['B']['matches']),'new_extra_participant_reference_rows':sum(any(m['structure_match']['additional_participants'].values()) for r in group for m in r['B']['matches']),'new_excluded_reasons':dict(Counter(x['reason'] for r in group for x in r['B']['excluded']))}
# Preserve empty routes from both original top-five outputs as separate outcomes.
routes=[]
for name,filename in [('phenylethanol','phenylethanol.json'),('cinnamyl_alcohol','cinnamyl_alcohol.json')]:
 d=load(HERE/'original_routes'/filename);paths=d.get('result',d)['pathways']
 for route in paths:
  steps=[r for r in rows if r['query'].get('target_name')==name and r['query'].get('route_rank')==route['rank']]
  assert len(steps)==len(route['steps'])
  routes.append(dict(target=name,rank=route['rank'],steps=len(steps),empty=not steps,**{arm+'_every_step_has_reference_candidate':bool(steps) and all(r[arm]['matches'] for r in steps) for arm in ['A','B']}))
assert len(routes)==10 and sum(r['steps'] for r in routes)==13
summary=dict(status="packaged_development_replay_not_independent_validation",
    executed_queries=len(rows),metrics=metrics,cohorts=cohorts,
    pair_scope_audit=dict(pair_record_objects=len(pairs),
        assertion_pair_links_checked=sum(len(p["assertions"]) for p in pairs),
        unique_source_assertions=len({a["assertion_id"] for p in pairs for a in p["assertions"]}),
        violations=len(violations)),
    route_results=dict(all_route_proposals=len(routes),
        empty_routes=sum(r["empty"] for r in routes),
        **{arm+"_nonempty_routes_with_reference_for_every_step":sum(
            r[arm+"_every_step_has_reference_candidate"] for r in routes) for arm in ["A","B"]}),
    accuracy_estimated=False,manual_savings_measured=False,
    complete_upstream_workflow_benchmarked=False)
save("summary.json",summary)
save("route_coverage.json",routes)
print(json.dumps(summary,ensure_ascii=False,indent=2))
