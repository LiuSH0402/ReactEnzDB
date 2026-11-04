"""Original scoped observation writers with record inputs supplied separately.
Input records must already have an explicit curation decision. This is not an
automated curator and does not recreate the unpublished record-level decisions.
"""
import hashlib, json, re, sqlite3

def apply_accepted_observations(c, accepted_expression_rows, accepted_stability_candidates):
    c.row_factory = sqlite3.Row
    rows = accepted_expression_rows
    report = {"expression_added": [], "stability_added": []}
    for bid,ac,pmid,host,strain,lo,hi,text,sol,act,basis,note in rows:
     e=c.execute('select * from web_enzymes where biopart_id=?',(bid,)).fetchone();assert e
     x={'expression_id':'expression20261016_'+bid+'_'+pmid,'biopart_id':bid,'reaction_id':None,'uniprot_accession':ac,'gene_name':e['gene_name_primary'],'source_organism':e['organism'],'source_db':'primary_publication_checked','source_entry_id':pmid,'source_candidate_id':None,'host_name':host,'strain_or_cell_line':strain,'expression_status':'source_reports_expression','solubility_status':sol,'activity_status':act,'yield_text':text,'yield_lower_g_l':lo,'yield_upper_g_l':hi,'yield_basis':basis,'enzyme_identity_status':'source_gene_species_context_not_exact_construct_sequence','enzyme_form_status':'mutant_construct' if pmid=='29448943' else 'source_construct_context','construct_note':note,'source_pmid':pmid,'source_url':'https://pubmed.ncbi.nlm.nih.gov/'+pmid+'/','verification_status':'primary_abstract_checked' if pmid!='29448943' else 'primary_open_fulltext_construct_checked','source_span_ids_json':'[]','source_span_sha256_json':'[]','evidence_scope':'Reported expression construct only; no transfer of yield or activity to wild-type enzyme or another host. Range and lower-bound semantics retained.'}
     if not c.execute('select 1 from web_expression_source_observations where expression_id=?',(x['expression_id'],)).fetchone():
      c.execute('insert into web_expression_source_observations ('+','.join(x)+') values ('+','.join('?' for _ in x)+')',list(x.values()));report['expression_added'].append(x['expression_id'])
    for i,r in enumerate(accepted_stability_candidates):
     text=r['value_text'];bid=r['entity_id']
     if c.execute('select 1 from web_protein_stability_observations where biopart_id=? and value_text=?',(bid,text)).fetchone():continue
     # Existing independently curated melting annotations may have a shortened quotation.
     old=[x[0] for x in c.execute('select value_text from web_protein_stability_observations where biopart_id=?',(bid,))]
     if any(t in text or text in t for t in old):continue
     tm=re.search(r'(?:melting temperature(?:\s*\(Tm\))?\s*(?:of|is)?\s*)(\d+(?:\.\d+)?)\s*degrees Celsius',text,re.I)
     kind='melting_temperature' if tm else 'ph_stability_annotation' if r['attribute_name']=='ph_dependence' else 'thermal_stability_annotation'
     oid='stability20261016_'+hashlib.sha256((bid+'|'+text).encode()).hexdigest()[:20]
     x=(oid,bid,r['external_id'],kind,text,float(tm[1]) if tm else None,'degC' if tm else None,r['pmids_json'],json.dumps({'attribute_evidence_id':r['attribute_evidence_id'],'record_url':r['external_url'],'scope':'Explicit source stability annotation, not independent full-paper revalidation.'}),'2026-10-16','source_explicit_stability_annotation_not_independent_fulltext_review')
     c.execute('insert or ignore into web_protein_stability_observations values ('+','.join('?' for _ in x)+')',x);report['stability_added'].append(oid)
    return report
