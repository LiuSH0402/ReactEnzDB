"""Conservative rules for an accession inherited from an omitted duplicate.

Current UniProt identity must equal the complete local sequence and explicit
taxonomy ID. A single official MERGED chain can support a secondary alias.
Split, deleted, unresolved and conflicting entries never qualify automatically.
"""
from protein_reference_inheritance import identity

APPROVED = {'verified_current_primary_accession', 'verified_merged_secondary_accession',
            'verified_current_primary_accession_taxonomy_merged', 'verified_merged_secondary_accession_taxonomy_merged'}


def split_candidates(accession: str, entries: dict, expected: tuple) -> dict:
    """Report all descendants without declaring a split accession unique."""
    pending=[accession];seen=set();active=[];matching=[];unresolved=[]
    while pending:
        current=pending.pop()
        if current in seen:continue
        seen.add(current)
        item=entries.get(current)
        if item is None:
            unresolved.append(current);continue
        record=item.get('record',item)
        if record.get('entryType')=='Inactive':
            targets=record.get('inactiveReason',{}).get('mergeDemergeTo',[])
            if not targets:unresolved.append(current)
            pending.extend(targets);continue
        active.append(current)
        try:
            actual=identity(record.get('sequence',{}).get('value'),record.get('organism',{}).get('taxonId'))
        except ValueError:
            unresolved.append(current);continue
        if actual==expected:matching.append(current)
    return dict(active_descendants=sorted(set(active)),matching_descendants=sorted(set(matching)),
                unresolved_descendants=sorted(set(unresolved)))


def resolve(accession: str, entries: dict) -> dict:
    path=[];seen=set();current=accession
    for _ in range(12):
        if current in seen:
            return dict(state='official_resolution_cycle',path=path,primary=None)
        seen.add(current);path.append(current)
        item=entries.get(current)
        if item is None:
            return dict(state='official_record_not_returned',path=path,primary=None)
        record=item.get('record',item)
        if record.get('entryType') != 'Inactive':
            if not record.get('sequence',{}).get('value') or not record.get('organism',{}).get('taxonId'):
                return dict(state='official_identity_incomplete',path=path,primary=current,record=record)
            return dict(state='active',path=path,primary=current,record=record)
        reason=record.get('inactiveReason',{})
        kind=reason.get('inactiveReasonType','UNKNOWN')
        destinations=reason.get('mergeDemergeTo',[])
        if kind=='MERGED' and len(destinations)==1:
            current=destinations[0];continue
        if kind=='DEMERGED' or len(destinations)>1:
            return dict(state='official_split_requires_review',path=path,primary=None,reason=reason)
        if kind=='DELETED':
            return dict(state='official_deleted_record',path=path,primary=None,reason=reason)
        return dict(state='official_inactive_unresolved',path=path,primary=None,reason=reason)
    return dict(state='official_resolution_depth_limit',path=path,primary=None)


def classify(lineage: dict, entries: dict, taxonomy_merges: dict | None = None) -> dict:
    resolution=resolve(lineage['accession'],entries)
    result=dict(status=resolution['state'],approved=False,resolution_path=resolution['path'],
                current_primary=resolution.get('primary'),sequence_match=None,taxonomy_match=None,
                official_sequence_sha256=None,official_taxonomy_id=None,
                taxonomy_equivalent_after_verified_merge=False,taxonomy_resolution_path=[])
    if not lineage['source_origins'] or not lineage['current_targets']:
        result['status']='missing_local_source_or_target';return result
    local=lineage['source_origins']+lineage['current_targets']
    if any(r['identity_state']!='explicit_sequence_taxonomy' for r in local):
        result['status']='local_explicit_taxonomy_or_sequence_missing';return result
    identities={(r['sequence_sha256'],r['taxonomy_id']) for r in local}
    if len(identities)!=1:
        result['status']='source_target_identity_conflict';return result
    if lineage.get('other_baseline_identity_keys'):
        result['status']='accession_has_multiple_baseline_identities';return result
    if resolution['state']=='official_split_requires_review':
        result.update(split_candidates(lineage['accession'],entries,next(iter(identities))))
    if resolution['state']!='active':return result
    record=resolution['record']
    try:
        official=identity(record['sequence']['value'],record['organism']['taxonId'])
    except ValueError:
        result['status']='official_sequence_or_taxonomy_invalid';return result
    expected=next(iter(identities))
    seq_match=official[0]==expected[0];tax_match=official[1]==expected[1]
    merged_tax=(not tax_match and (taxonomy_merges or {}).get(expected[1])==official[1])
    result.update(sequence_match=seq_match,taxonomy_match=tax_match,
                  official_sequence_sha256=official[0],official_taxonomy_id=official[1],
                  taxonomy_equivalent_after_verified_merge=merged_tax,
                  taxonomy_resolution_path=[expected[1],official[1]] if merged_tax else [expected[1]])
    if not seq_match and not tax_match:result['status']='current_sequence_and_taxonomy_conflict'
    elif not seq_match:result['status']='current_sequence_conflict'
    elif not tax_match and not merged_tax:result['status']='current_taxonomy_conflict'
    else:
        result['status']='verified_current_primary_accession' if len(resolution['path'])==1 else 'verified_merged_secondary_accession'
        if merged_tax:result['status']+='_taxonomy_merged'
        result['approved']=True
    return result
