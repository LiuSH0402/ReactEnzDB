"""Offline public-scope filtering; policy data are supplied separately.
Original membership/column semantics retained. No hidden records are bundled.
"""
import csv,gzip,hashlib,json,re,sqlite3,sys
from pathlib import Path

def q(s):return '"'+s.replace('"','""')+'"'

def ro(p):return sqlite3.connect(p.resolve().as_uri()+'?mode=ro',uri=True)

def sets(p):
 return {k:set(p.get(k,[])) for k in ['hidden_enzyme_ids','hidden_public_enzyme_ids','hidden_reo_ids','hidden_kinetic_ids']}|{'raw':{r['reaction_id'] for r in p['hidden_reactions']},'public':{r['public_id'] for r in p['hidden_reactions']},'held':{(r['biopart_id'],r['accession']) for r in p['held_identifier_pairs']}}

def table_info(c):
 virtuals=[r[0] for r in c.execute("select name from sqlite_master where type='table' and upper(coalesce(sql,'')) like 'CREATE VIRTUAL TABLE%'")]
 return {t:[r[1] for r in c.execute('pragma table_info('+q(t)+')')] for t, in c.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'").fetchall() if not any(t==v or t.startswith(v+'_') for v in virtuals)}

def hidden_value(col,value,s):
 if value is None:return False
 v=str(value)
 # Column semantics prevent collisions with KEGG/host/source reaction identifiers.
 if col in {'reaction_id','query_reaction_id','gold_reaction_id'}:return v in s['raw']
 if col in {'reactenz_reaction_id','query_reactenz_reaction_id','gold_reactenz_reaction_id'}:return v in s['public']|s['raw']
 if col in {'biopart_id','primary_biopart_id','candidate_biopart_id','positive_biopart_id','target_biopart_id'}:return v in s['hidden_enzyme_ids']
 if col in {'reactenz_enzyme_id','primary_reactenz_enzyme_id','candidate_reactenz_enzyme_id','positive_reactenz_enzyme_id'}:return v in s['hidden_public_enzyme_ids']
 if col=='reo_id':return v in s['hidden_reo_ids']
 if col=='kinetic_id':return v in s['hidden_kinetic_ids']
 return False

def row_hidden(row,s):
 if any(hidden_value(k,v,s) for k,v in row.items()):return True
 for key in ['entity_id','internal_id','record_id']:
  v=str(row.get(key,''));kind=str(row.get('entity_type',row.get('kind',''))).lower()
  if kind in {'reaction','reactions'} and v in s['raw']|s['public']:return True
  if kind in {'enzyme','enzymes','protein'} and v in s['hidden_enzyme_ids']|s['hidden_public_enzyme_ids']:return True
  if kind in {'reo','biopart_reaction','reaction_enzyme'} and (v in s['hidden_reo_ids'] or any(part in s['raw']|s['hidden_enzyme_ids'] for part in v.split('::'))):return True
 e=row.get('biopart_id',row.get('primary_biopart_id',row.get('entity_id') if row.get('entity_type')=='enzyme' else row.get('target_biopart_id')))
 if e:
  if any((e,str(row.get(k,''))) in s['held'] for k in ['accession','uniprot_accession','uniprot_id','protein_id','xref_value','source_accession','old_accession','form_accession']):return True
 return False

def install_temp(c,s):
 domains={'scope_reactions':s['raw'],'scope_public_reactions':s['public']|s['raw'],'scope_enzymes':s['hidden_enzyme_ids'],'scope_public_enzymes':s['hidden_public_enzyme_ids'],'scope_reos':s['hidden_reo_ids'],'scope_kinetics':s['hidden_kinetic_ids']}
 for table,values in domains.items():
  c.execute('create temp table '+table+'(id primary key)');c.executemany('insert into '+table+' values (?)',[(v,) for v in values])
 c.execute('create temp table scope_held(eid text,acc text,primary key(eid,acc))');c.executemany('insert into scope_held values (?,?)',sorted(s['held']))

def clauses(cols):
 domains={'reaction_id':'scope_reactions','query_reaction_id':'scope_reactions','gold_reaction_id':'scope_reactions','reactenz_reaction_id':'scope_public_reactions','query_reactenz_reaction_id':'scope_public_reactions','gold_reactenz_reaction_id':'scope_public_reactions','biopart_id':'scope_enzymes','primary_biopart_id':'scope_enzymes','candidate_biopart_id':'scope_enzymes','positive_biopart_id':'scope_enzymes','target_biopart_id':'scope_enzymes','reactenz_enzyme_id':'scope_public_enzymes','primary_reactenz_enzyme_id':'scope_public_enzymes','candidate_reactenz_enzyme_id':'scope_public_enzymes','positive_reactenz_enzyme_id':'scope_public_enzymes','reo_id':'scope_reos','kinetic_id':'scope_kinetics'}
 out=[q(k)+' IN (SELECT id FROM '+v+')' for k,v in domains.items() if k in cols]
 if 'entity_id' in cols and 'entity_type' in cols:
  out += ["(entity_type='reaction' AND entity_id IN scope_reactions)","(entity_type='enzyme' AND entity_id IN scope_enzymes)","(entity_type IN ('reo','reaction_enzyme') AND entity_id IN scope_reos)","(entity_type='biopart_reaction' AND (substr(entity_id,instr(entity_id,'::')+2) IN scope_reactions OR substr(entity_id,1,instr(entity_id,'::')-1) IN scope_enzymes))"]
 if 'internal_id' in cols and 'kind' in cols:out += ["(kind='reaction' AND internal_id IN scope_reactions)","(kind='enzyme' AND internal_id IN scope_enzymes)"]
 eid='biopart_id' if 'biopart_id' in cols else 'primary_biopart_id' if 'primary_biopart_id' in cols else 'entity_id' if 'entity_type' in cols else 'target_biopart_id' if 'target_biopart_id' in cols else None
 if eid:
  for acc in ['accession','uniprot_accession','uniprot_id','protein_id','xref_value','source_accession','old_accession','form_accession']:
   if acc in cols:out.append('EXISTS (SELECT 1 FROM scope_held h WHERE h.eid='+q(eid)+' AND h.acc='+q(acc)+')')
 return out

def filter_db(path,s,workspace_root):
 assert path.resolve().is_relative_to(workspace_root.resolve()),'Only disposable task copies may be filtered'
 c=sqlite3.connect(path);c.execute('pragma foreign_keys=off');c.execute('pragma journal_mode=off');c.execute('pragma synchronous=off');c.execute('pragma cache_size=-131072');c.execute('pragma secure_delete=on');install_temp(c,s)
 info=table_info(c);changes={}
 for t,cols in info.items():
  terms=clauses(cols)
  if terms:
   try:n=c.execute('delete from '+q(t)+' where '+' OR '.join(terms)).rowcount
   except sqlite3.Error as error:
    print('FILTER_ERROR',str(path),t,error.sqlite_errorname,flush=True);raise
   if n:changes[t]=n
 # Foreign keys absent from some historic tables are handled explicitly.
 links=[('web_attribute_external_checks','attribute_evidence_id','web_attribute_evidences','attribute_evidence_id'),('web_kinetic_assay_links','kinetic_id','web_kinetics','kinetic_id'),('web_kinetic_external_checks','kinetic_id','web_kinetics','kinetic_id'),('web_kinetic_literature_reviews','kinetic_id','web_kinetics','kinetic_id'),('web_kinetics_source_provenance','kinetic_id','web_kinetics','kinetic_id'),('reaction_centres','atom_mapping_id','atom_mappings','atom_mapping_id'),('mapping_conflicts','mapping_id','cross_database_mappings','mapping_id'),('reaction_host_mapping_candidates','mapping_id','reaction_host_mapping','mapping_id')]
 if 'assertions' in info:
  links += [(t,'assertion_id','assertions','assertion_id') for t,cols in info.items() if t!='assertions' and 'assertion_id' in cols]
 if 'expression_assertions' in info:
  links += [(t,'assertion_id','expression_assertions','assertion_id') for t,cols in info.items() if t.startswith('expression_') and t!='expression_assertions' and 'assertion_id' in cols]
 for t,col,parent,pk in links:
  if t in info and parent in info:
   n=c.execute('delete from '+q(t)+' where '+q(col)+' is not null and '+q(col)+' not in (select '+q(pk)+' from '+q(parent)+')').rowcount
   if n:changes[t]=changes.get(t,0)+n
 while bad:=c.execute('pragma foreign_key_check').fetchall():
  for t,rid,parent,_ in bad:
   assert rid is not None,(path,t,parent);c.execute('delete from '+q(t)+' where rowid=?',(rid,));changes[t]=changes.get(t,0)+1
 if 'web_reactions' in info:
  for name in ['web_reactions_fts','web_enzymes_fts']:
   if c.execute('select 1 from sqlite_master where name=?',(name,)).fetchone():c.execute('insert into '+q(name)+'('+q(name)+") values ('rebuild')")
 c.commit();assert c.execute('pragma quick_check').fetchall()==[('ok',)]
 if changes:c.execute('vacuum')
 c.execute('pragma journal_mode=delete');c.close()
 return changes

def validate_db(path,s):
 c=ro(path);install_temp(c,s);bad={}
 for t,cols in table_info(c).items():
  terms=clauses(cols)
  if terms:
   n=c.execute('select count(*) from '+q(t)+' where '+' OR '.join(terms)).fetchone()[0]
   if n:bad[t]=n
 assert not bad,(path,bad)
 assert not c.execute('pragma foreign_key_check').fetchall(),path
 assert c.execute('pragma quick_check').fetchall()==[('ok',)],path
 c.close();return True
