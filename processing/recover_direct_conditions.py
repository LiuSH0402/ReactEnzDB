"""Recover explicit conditions from a user-supplied disposable working database.
Original per-record parsing and evidence boundaries are retained. No acquisition.
"""
import argparse, collections, hashlib, json, sqlite3
from pathlib import Path
from condition_parser import parse_direct_conditions

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True, help="Writable working copy, never the production database")
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    if not args.database.is_file():
        parser.error("Working database does not exist")
    args.report.parent.mkdir(parents=True, exist_ok=True)
    c=sqlite3.connect(args.database);c.row_factory=sqlite3.Row
    stats=collections.Counter();accepted=[]
    for row in list(c.execute('SELECT * FROM web_kinetics')):
        source_text=row['subject_name'] or ''
        condition=parse_direct_conditions(source_text)
        if condition['ph'] is None and condition['temperature'] is None:continue
        stats['source_rows_with_explicit_scalar_condition']+=1
        if c.execute('SELECT 1 FROM web_kinetic_assay_links WHERE kinetic_id=?',(row['kinetic_id'],)).fetchone():continue
        aid='original_kinetic_context:'+row['kinetic_id']
        identity=c.execute('SELECT organism,taxonomy_id FROM web_enzymes WHERE biopart_id=?',(row['biopart_id'],)).fetchone()
        source_record=dict(row)
        evidence={'kinetic_id':row['kinetic_id'],'source_annotation':source_text,'extraction_status':condition['status'],
                  'held_fields':condition['held_fields'],'identity_scope':'Original kinetic record identity and form are retained; no independent full-text or construct review claimed.'}
        c.execute('INSERT OR IGNORE INTO web_assay_source_evidence (assay_id,source_db,source_entry_id,biopart_id,reaction_id,source_organism,source_taxonomy_id,enzyme_form_status,source_pmids_json,ph,temperature,temperature_unit,mapping_status,mapping_details_json,source_record_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                  (aid,row['source_db'],row['kinetic_id'],row['biopart_id'],row['reaction_id'],identity['organism'],identity['taxonomy_id'],'original_record_form_not_independently_revalidated',row['pmids_json'],condition['ph'],condition['temperature'],'Celsius' if condition['temperature'] is not None else None,'direct_original_kinetic_annotation',json.dumps(evidence),json.dumps(source_record)))
        c.execute('INSERT INTO web_kinetic_assay_links VALUES (?,?,?,?)',(row['kinetic_id'],aid,row['kinetic_id'],json.dumps({'source_annotation':source_text,'value_numeric':row['value_numeric'],'unit':row['unit'],'parameter_type':row['parameter_type'],'scope':evidence['identity_scope']})))
        if not row['condition_text']:
            value={key:condition[key] for key in ['ph','temperature'] if condition[key] is not None}
            if condition['temperature'] is not None:value['temperature_unit']='Celsius'
            value.update({'evidence_scope':'Explicit conditions in the original measurement annotation; enzyme form not independently revalidated.','original_annotation':source_text})
            c.execute('UPDATE web_kinetics SET condition_text=? WHERE kinetic_id=?',(json.dumps(value,ensure_ascii=False),row['kinetic_id']))
        accepted.append({'kinetic_id':row['kinetic_id'],'ph':condition['ph'],'temperature':condition['temperature'],'source_annotation':source_text})
        stats['linked_rows']+=1
        if condition['ph'] is not None and condition['temperature'] is not None:stats['linked_rows_with_both']+=1
    c.commit();c.close()
    args.report.write_text(json.dumps({'counts':dict(stats),'accepted':accepted},ensure_ascii=False,indent=2),encoding='utf-8')
    print('DIRECT_CONDITION_RECOVERY',dict(stats),flush=True)

if __name__ == "__main__":
    main()
