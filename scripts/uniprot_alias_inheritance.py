"""Replay exact-identity verified identifiers, retaining primary/secondary roles.

The official verification is tied to the recorded UniProt release. This never
selects a new representative protein, imports an annotation, or creates a
reaction/measurement relationship. The caller owns the transaction.
"""
import json,re,sqlite3
from protein_reference_inheritance import identity
from uniprot_accession_rules import APPROVED

TABLE='web_uniprot_alias_inheritance'
SCOPE='verified_identifier_alias_not_reaction_or_measurement_evidence'


def create_table(conn):
    conn.execute(f'''CREATE TABLE IF NOT EXISTS {TABLE} (
      target_biopart_id TEXT NOT NULL, old_accession TEXT NOT NULL,
      current_primary TEXT NOT NULL, xref_db TEXT NOT NULL,
      sequence_sha256 TEXT NOT NULL, taxonomy_id TEXT NOT NULL,
      canonical_protein_key TEXT NOT NULL, source_biopart_id TEXT NOT NULL,
      source_xref_id INTEGER NOT NULL, source_xref_json TEXT NOT NULL,
      source_snapshot_xref_sha256 TEXT NOT NULL, verification_status TEXT NOT NULL,
      official_release TEXT NOT NULL, official_resolution_path TEXT NOT NULL,
      official_sequence_sha256 TEXT NOT NULL, official_taxonomy_id TEXT NOT NULL,
      official_cache_files TEXT NOT NULL, scope TEXT NOT NULL,
      taxonomy_resolution_path TEXT NOT NULL,
      official_taxonomy_merge_evidence_sha256 TEXT NOT NULL,
      PRIMARY KEY(target_biopart_id,old_accession,source_snapshot_xref_sha256,source_xref_id)
    )''')


def validate_records(conn,records):
    target_identity={}
    for row in records:
        eid=row['target_biopart_id']
        if eid not in target_identity:
            current=conn.execute('SELECT protein_sequence,taxonomy_id FROM web_enzymes WHERE biopart_id=?',(eid,)).fetchone()
            if current is None:raise ValueError('Alias target absent: '+eid)
            target_identity[eid]=identity(*current)
        expected=(row['sequence_sha256'],row['taxonomy_id'])
        if target_identity[eid]!=expected or expected[0]!=row['official_sequence_sha256']:
            raise ValueError('Local/official alias identity mismatch: '+eid)
        tax_path=json.loads(row['taxonomy_resolution_path'])
        if expected[1]!=row['official_taxonomy_id']:
            if (not row['verification_status'].endswith('_taxonomy_merged') or
                tax_path!=[expected[1],row['official_taxonomy_id']] or
                not re.fullmatch('[0-9a-f]{64}',row['official_taxonomy_merge_evidence_sha256'])):
                raise ValueError('Taxonomy difference lacks official merge proof')
        elif tax_path!=[expected[1]]:
            raise ValueError('Taxonomy resolution path mismatch')
        if row['verification_status'] not in APPROVED or row['scope']!=SCOPE:
            raise ValueError('Unverified alias status or evidence scope')
        acc=row['old_accession'];primary=row['current_primary']
        pattern=r'(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})'
        if not re.fullmatch(pattern,acc) or not re.fullmatch(pattern,primary):
            raise ValueError('Invalid base accession; isoforms require separate verification')
        path=json.loads(row['official_resolution_path'])
        if not path or path[0]!=acc or path[-1]!=primary:
            raise ValueError('Official resolution path mismatch')
        secondary=row['verification_status'].startswith('verified_merged_secondary_accession')
        if secondary and (len(path)<2 or row['xref_db']!='UniProt_secondary'):
            raise ValueError('Merged accession must remain a secondary alias')
        if not secondary and (len(path)!=1 or row['xref_db'].lower()!='uniprot'):
            raise ValueError('Primary accession/path mismatch')


def recorded_aliases(conn):
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",(TABLE,)).fetchone():return []
    columns=[r[1] for r in conn.execute(f'PRAGMA table_info({TABLE})')]
    return [dict(zip(columns,row)) for row in conn.execute(f'SELECT * FROM {TABLE} ORDER BY target_biopart_id,old_accession,source_xref_id')]


def restore_aliases(conn):
    records=recorded_aliases(conn);validate_records(conn,records)
    existing={tuple(r) for r in conn.execute("SELECT entity_id,upper(trim(xref_value)) FROM web_xrefs WHERE entity_type='enzyme' AND lower(xref_db) LIKE '%uniprot%'")}
    inserted=0
    for row in records:
        pair=(row['target_biopart_id'],row['old_accession'])
        if pair in existing:continue
        conn.execute('INSERT INTO web_xrefs(entity_type,entity_id,xref_db,xref_value,xref_url,source_db) VALUES (\'enzyme\',?,?,?,?,?)',
                     (pair[0],row['xref_db'],pair[1],f"https://www.uniprot.org/uniprotkb/{row['current_primary']}/entry",'RDBSB_v1_snapshot'))
        existing.add(pair);inserted+=1
    return inserted


def install_alias_plan(conn,records):
    validate_records(conn,records)
    create_table(conn)
    columns=[r[1] for r in conn.execute(f'PRAGMA table_info({TABLE})')]
    for row in records:
        values=tuple(row[c] for c in columns)
        old=conn.execute(f'SELECT * FROM {TABLE} WHERE target_biopart_id=? AND old_accession=? AND source_snapshot_xref_sha256=? AND source_xref_id=?',
                         (row['target_biopart_id'],row['old_accession'],row['source_snapshot_xref_sha256'],row['source_xref_id'])).fetchone()
        if old is not None and tuple(old)!=values:raise ValueError('Conflicting alias provenance')
        if old is None:conn.execute(f'INSERT INTO {TABLE} VALUES ({",".join("?" for _ in columns)})',values)
    return restore_aliases(conn)
