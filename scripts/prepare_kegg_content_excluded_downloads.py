"""Build independent download copies excluding identified KEGG content.

Identifier namespaces and ordinary links are explicitly allowed. This is not a
statement that all historical RDBSB fields have verified upstream provenance,
or that other database licences have been cleared for public redistribution.
"""
from __future__ import annotations

import argparse
import collections
import csv
import gzip
import hashlib
import json
import shutil
import sqlite3
import zipfile
from pathlib import Path

import prepare_data_display_exports as display
import separate_sqlite_release as sep

ORIGINS = {"source_db", "source_db_raw", "source_db_normalized", "source_label",
           "source_labels", "source_name", "structure_source", "mapping_source"}
ID_TABLES = {"web_xrefs", "host_reaction_links", "host_compound_links"}
EMPTY_TABLES = {"web_pathways", "web_reaction_pathways", "pathway_cofactor_requirements",
                "pathway_host_coverage", "pathway_step_host_status", "readretro_compounds",
                "retrosynthesis_route_targets"}
ID_KEYS = {"source", "source_db", "identifier_namespace", "id", "external_id",
           "xref_db", "xref_value", "xref_url", "url", "link", "record_url"}


def has_kegg(value):
    # Underscore labels such as kegg_ag are provenance, too; word-boundary
    # regexes incorrectly miss these labels.
    return isinstance(value, str) and "kegg" in value.lower()


def clean_json(value):
    """Prune explicitly labelled content before hiding collection descriptions."""
    if isinstance(value, list):
        return [v for x in value if (v := clean_json(x)) is not None]
    if not isinstance(value, dict):
        return value
    origin = any(has_kegg(value.get(k)) for k in ORIGINS | {"source"})
    if origin and not set(value).issubset(ID_KEYS):
        return None
    result = {}
    for key, item in value.items():
        if has_kegg(key) and not any(part in key.lower() for part in ("id", "xref", "url", "link", "namespace")):
            continue
        cleaned = clean_json(item)
        if cleaned is not None or item is None:
            result[key] = cleaned
    return result


def cell(key, value):
    if isinstance(value, str) and value.lstrip().startswith(("{", "[")):
        try:
            raw = json.loads(value)
        except ValueError:
            pass
        else:
            cleaned = clean_json(raw)
            if cleaned != raw:
                value = json.dumps(cleaned, ensure_ascii=False, separators=(",", ":"))
    return display.project_cell(key, value) if isinstance(value, str) else value


def keep_row(table, row, allowed_rules=None, allowed_templates=None, allowed_benchmarks=None):
    if table in EMPTY_TABLES:
        return False
    # A namespace used to join independently obtained records is not copied
    # pathway/chemistry content. Preserve these identifier-only relationships.
    if table not in ID_TABLES and table not in {"web_mnx_reaction_mappings", "web_mnx_compound_mappings"}:
        for key in ORIGINS:
            if key == "source_name" and table == "normalized_participants":
                continue
            if has_kegg(row.get(key)):
                return False
    if table == "cross_database_mappings" and has_kegg(row.get("target_db")):
        return False
    if table in {"bionavi_reaction_rules", "rule_templates"} and row.get("rule_source") == "enzymatic_metabolic":
        return False
    if table == "bionavi_rule_references" and allowed_rules is not None:
        return row.get("rule_id") in allowed_rules
    if table in {"rule_template_reaction_links", "rule_template_enzyme_candidate_links"} and allowed_templates is not None:
        return row.get("template_id") in allowed_templates
    if table == "bionavi_building_blocks":
        return row.get("block_set") in {"BioNavi chemo building blocks", "READRetro amino acid building blocks"}
    if table == "retrosynthesis_benchmark_sets":
        return row.get("dataset_name") == "BioNavi-NP USPTO_NPL"
    if table == "retrosynthesis_benchmark_reactions" and allowed_benchmarks is not None:
        return row.get("benchmark_id") in allowed_benchmarks
    return True


def copy_database(name, original_dir, previous_dir, output_dir):
    original = original_dir / name
    prior = previous_dir / "sqlite" / name
    target = output_dir / "sqlite" / name
    before = sep.file_hash(original)
    prior_hash = sep.file_hash(prior)
    shutil.copy2(prior, target)
    assert sep.file_hash(target) == prior_hash
    src = sqlite3.connect(original.resolve().as_uri() + "?mode=ro", uri=True)
    dst = sqlite3.connect(target)
    dst.execute("PRAGMA secure_delete=ON")
    dst.execute("PRAGMA temp_store=MEMORY")
    dst.execute("PRAGMA synchronous=NORMAL")
    tables = {t: sql for t, sql in sep.ordinary_tables(dst)}
    raw_info = {t: src.execute(f"PRAGMA table_info({sep.q(t)})").fetchall() for t in tables}
    allowed_rules = allowed_templates = allowed_benchmarks = None
    if "bionavi_reaction_rules" in tables:
        allowed_rules = {r[0] for r in src.execute("SELECT rule_id FROM bionavi_reaction_rules WHERE rule_source<>'enzymatic_metabolic'")}
        allowed_benchmarks = {r[0] for r in src.execute("SELECT benchmark_id FROM retrosynthesis_benchmark_sets WHERE dataset_name='BioNavi-NP USPTO_NPL'")}
    if "rule_templates" in tables:
        allowed_templates = {r[0] for r in src.execute("SELECT template_id FROM rule_templates WHERE rule_source<>'enzymatic_metabolic'")}
    audit = {"input": name, "input_sha256": before, "presentation_input_sha256": prior_hash,
             "tables": [], "identifier_only_exemptions": sorted(ID_TABLES)}
    for table in tables:
        info = raw_info[table]
        columns = [r[1] for r in info]
        previous_count = dst.execute(f"SELECT count(*) FROM {sep.q(table)}").fetchone()[0]
        # Rewrite only tables with provenance or JSON, or explicitly mixed pools.
        origin_cols = [c for c in columns if c in ORIGINS and not (c == "source_name" and table == "normalized_participants")]
        json_cols = [c for c in columns if c.endswith("_json")]
        special = table in EMPTY_TABLES or table in {"bionavi_reaction_rules", "bionavi_rule_references", "bionavi_building_blocks", "rule_templates", "rule_template_reaction_links", "rule_template_enzyme_candidate_links", "cross_database_mappings", "retrosynthesis_benchmark_sets", "retrosynthesis_benchmark_reactions"}
        rebuild = special or bool(json_cols) or bool(origin_cols and table not in ID_TABLES)
        # Key/value operational metadata is already projected in the previous
        # candidate. Do not reintroduce omitted collection history.
        if columns == ["key", "value"]:
            rebuild = False
        removed = transformed = 0
        if rebuild:
            kept, names = sep.projection(table, info)
            actual = [r[1] for r in dst.execute(f"PRAGMA table_info({sep.q(table)})")]
            assert names == actual, (name, table, names, actual)
            dst.execute(f"DELETE FROM {sep.q(table)}")
            insert = f"INSERT INTO {sep.q(table)} VALUES ({','.join('?' for _ in names)})"
            batch = []
            for values in src.execute(f"SELECT * FROM {sep.q(table)}"):
                row = dict(zip(columns, values))
                if not keep_row(table, row, allowed_rules, allowed_templates, allowed_benchmarks):
                    removed += 1
                    continue
                # MNX xrefs retain identifiers. Their associated description or
                # equation from KEGG is removed, rather than discarding IDs.
                if table == "web_mnx_reaction_mappings" and has_kegg(row.get("source_db")):
                    row["source_equation"] = None
                    transformed += 1
                if table == "bionavi_rule_references" and has_kegg(row.get("external_db")):
                    row["raw_reference"] = None
                    transformed += 1
                projected = tuple(cell(columns[i], row[columns[i]]) for i in kept)
                batch.append(projected)
                if len(batch) >= 2500:
                    dst.executemany(insert, batch); batch.clear()
            if batch:
                dst.executemany(insert, batch)
            dst.commit()
        count = dst.execute(f"SELECT count(*) FROM {sep.q(table)}").fetchone()[0]
        audit["tables"].append({"table": table, "before_rows": previous_count,
                                "after_rows": count, "excluded_rows": removed,
                                "identifier_rows_content_cleared": transformed,
                                "reprojected_before_origin_omission": rebuild})
        print("TABLE", name, table, previous_count, count, flush=True)
    # Remove linked comparison/annotation rows whose parent content was removed,
    # including relationships without a declared SQLite foreign key.
    cleanups = []
    for child, key, parent, pk in [("web_attribute_external_checks", "attribute_evidence_id", "web_attribute_evidences", "attribute_evidence_id"),
                                    ("mapping_conflicts", "mapping_id", "cross_database_mappings", "mapping_id"),
                                    ("reaction_centres", "atom_mapping_id", "atom_mappings", "atom_mapping_id")]:
        if child in tables and parent in tables:
            n = dst.execute(f"DELETE FROM {sep.q(child)} WHERE {sep.q(key)} IS NOT NULL AND {sep.q(key)} NOT IN (SELECT {sep.q(pk)} FROM {sep.q(parent)})").rowcount
            cleanups.append({"table": child, "rows": n, "reason": "excluded_parent_content"})
    # Existing FK semantics are retained; prune children rather than silently
    # dropping constraints to conceal dangling records.
    while True:
        violations = dst.execute("PRAGMA foreign_key_check").fetchall()
        if not violations:
            break
        assert all(row[1] is not None for row in violations), violations[:5]
        for table, rowid, parent, _ in violations:
            dst.execute(f"DELETE FROM {sep.q(table)} WHERE rowid=?", (rowid,))
        cleanups.append({"rows": len(violations), "reason": "declared_fk_parent_excluded"})
    # Project KEGG comparison records to *only* their cross-reference identity.
    if "cross_database_mappings" in tables:
        dst.execute("CREATE TABLE external_identifier_links (reaction_id TEXT,target_db TEXT,target_reaction_id TEXT)")
        dst.executemany("INSERT INTO external_identifier_links VALUES (?,?,?)", src.execute("SELECT reaction_id,target_db,target_reaction_id FROM cross_database_mappings WHERE instr(lower(coalesce(target_db,'')),'kegg')>0"))
    dst.commit()
    assert dst.execute("PRAGMA foreign_key_check").fetchall() == []
    assert dst.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    dst.execute("VACUUM")
    dst.close(); src.close()
    assert sep.file_hash(original) == before
    assert sep.file_hash(prior) == prior_hash
    audit["linked_content_cleanup"] = cleanups
    audit["input_bytes_unchanged"] = True
    (output_dir.parent / "audit" / (name + ".json")).write_text(json.dumps(audit, indent=2), encoding="utf-8")
    print("DATABASE_COMPLETE", name, flush=True)
    return audit


def refresh_scores_and_features(output_dir):
    import build_evidence_scores
    path = output_dir / "sqlite/reactenzdb_web.db"
    build_evidence_scores.DB_PATH = path
    build_evidence_scores.build_scores()
    core = sqlite3.connect(path)
    scores = {(t, i): (v, tier) for t, i, v, tier in core.execute("SELECT entity_type,entity_id,evidence_score,evidence_tier FROM web_evidence_scores")}
    attrs = dict((i, (ph, temp)) for i, ph, temp in core.execute("""SELECT entity_id,
      GROUP_CONCAT(DISTINCT CASE WHEN attribute_name='optimum_ph' THEN COALESCE(CAST(value_numeric AS TEXT),value_text) END),
      GROUP_CONCAT(DISTINCT CASE WHEN attribute_name='optimum_temperature' THEN COALESCE(CAST(value_numeric AS TEXT),value_text) END)
      FROM web_attribute_evidences WHERE entity_type='enzyme' AND attribute_name IN ('optimum_ph','optimum_temperature') GROUP BY entity_id"""))
    if core.execute("SELECT 1 FROM sqlite_master WHERE name='web_stats'").fetchone():
        metrics = dict(core.execute("SELECT metric,value FROM web_stats"))
        for key in metrics:
            if 'pathway' in key.lower():
                core.execute("UPDATE web_stats SET value=0 WHERE metric=?", (key,))
        core.execute("UPDATE web_stats SET value=(SELECT count(*) FROM web_attribute_evidences) WHERE metric='field_level_evidences'")
        core.commit()
    # Exported cached organism scores must refer to the new evidence table.
    core.executemany("UPDATE web_organism_browse_summary SET evidence_score=?,evidence_tier=? WHERE organism=?",
                     [(v, t, i) for (kind, i), (v, t) in scores.items() if kind == 'organism'])
    core.commit(); core.close()
    model = sqlite3.connect(output_dir / "sqlite/model_ready_dataset.sqlite")
    model.executemany("UPDATE model_ready_reactions SET evidence_score=?,evidence_tier=? WHERE reaction_id=?",
                      [(v, t, i) for (kind, i), (v, t) in scores.items() if kind == 'reaction'])
    model.executemany("UPDATE model_ready_enzyme_candidates SET enzyme_evidence_score=?,enzyme_evidence_tier=? WHERE biopart_id=?",
                      [(v, t, i) for (kind, i), (v, t) in scores.items() if kind == 'enzyme'])
    model.execute("UPDATE model_ready_enzyme_candidates SET optimum_ph_values=NULL,optimum_temperature_values=NULL")
    model.executemany("UPDATE model_ready_enzyme_candidates SET optimum_ph_values=?,optimum_temperature_values=? WHERE biopart_id=?",
                      [(ph, temp, i) for i, (ph, temp) in attrs.items()])
    model.commit(); model.close()
    refresh_benchmark_sqlite(output_dir)
    return scores, attrs


def refresh_benchmark_sqlite(output_dir):
    db = sqlite3.connect(output_dir / 'sqlite/rule_template_benchmark.sqlite')
    table = 'benchmark_evaluation_reaction_to_enzyme'
    sql = db.execute('SELECT sql FROM sqlite_master WHERE name=?', (table,)).fetchone()[0]
    if '"baseline_rank_score" REAL NOT NULL' in sql or '"baseline_rank" INTEGER NOT NULL' in sql:
        indices = [r[0] for r in db.execute("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL", (table,))]
        replacement = sql.replace(qname := sep.q(table), sep.q('_rank_rebuild'), 1).replace('"baseline_rank_score" REAL NOT NULL', '"baseline_rank_score" REAL').replace('"baseline_rank" INTEGER NOT NULL', '"baseline_rank" INTEGER')
        db.execute(replacement)
        db.execute('INSERT INTO _rank_rebuild SELECT * FROM ' + qname)
        db.execute('DROP TABLE ' + qname)
        db.execute('ALTER TABLE _rank_rebuild RENAME TO ' + qname)
        for statement in indices:
            db.execute(statement)
    db.execute('ATTACH DATABASE ? AS retained', (str(output_dir / 'sqlite/reactenzdb_web.db'),))
    for table, column, entity, identifier in [
        ('benchmark_task_enzyme_ranking', 'enzyme_evidence_score', 'enzyme', 'candidate_biopart_id'),
        ('benchmark_evaluation_reaction_to_enzyme', 'evidence_score', 'enzyme', 'candidate_biopart_id'),
        ('benchmark_task_reaction_to_enzyme', 'evidence_score', 'enzyme', 'positive_biopart_id'),
        ('benchmark_task_substrate_product_to_reaction', 'evidence_score', 'reaction', 'gold_reaction_id')]:
        fields = {r[1] for r in db.execute('PRAGMA table_info(' + sep.q(table) + ')')}
        db.execute('UPDATE ' + sep.q(table) + ' SET ' + sep.q(column) +
                   '=(SELECT evidence_score FROM retained.web_evidence_scores s WHERE s.entity_type=? AND s.entity_id=' + sep.q(table) + '.' + sep.q(identifier) + ')', (entity,))
        for rank in ('baseline_rank_score', 'baseline_rank'):
            if rank in fields:
                db.execute('UPDATE ' + sep.q(table) + ' SET ' + sep.q(rank) + '=NULL')
    db.execute('DELETE FROM benchmark_baseline_metrics')
    db.commit()
    assert not db.execute('PRAGMA foreign_key_check').fetchall()
    db.close()


def export_tabular(original_dir, previous_dir, output_dir, scores, attrs):
    release = json.loads((original_dir / "downloads/release_files_manifest.json").read_text(encoding="utf-8"))
    inputs = {(original_dir / r['file']).name: original_dir / r['file'] for r in release['artifacts']}
    previous = json.loads((previous_dir / "manifest.json").read_text(encoding="utf-8"))
    core = sqlite3.connect(output_dir / "sqlite/reactenzdb_web.db")
    # For paired web formats, export the same physically filtered SQLite rows.
    # This also prevents pre-existing stale CSV snapshots diverging from SQLite.
    core_tables = {r[0] for r in core.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    rules_db = sqlite3.connect(output_dir / "sqlite/rule_template_benchmark.sqlite")
    templates = {r[0] for r in rules_db.execute("SELECT template_id FROM rule_templates")}
    manifest = []
    for item in previous['tabular_files']:
        name = item['file']; table = name.split('.')[0]
        target = output_dir / 'tables' / name
        raw_path = inputs[name]
        before = sep.file_hash(raw_path)
        delimiter = '\t' if '.tsv' in name else ','
        opener = gzip.open if name.endswith('.gz') else open
        options = {'compresslevel': 6} if name.endswith('.gz') else {}
        removed = 0; count = 0
        # Use recorded projected headers for compatible downstream field names.
        header = item['columns']
        cursor = None
        if table in core_tables:
            db_columns = {r[1] for r in core.execute(f'PRAGMA table_info({sep.q(table)})')}
            assert set(header).issubset(db_columns), (name, set(header)-db_columns)
            cursor = core.execute('SELECT ' + ','.join(sep.q(c) for c in header) + ' FROM ' + sep.q(table))
        with opener(target, 'wt', encoding='utf-8', newline='', **options) as dst:
            writer = csv.writer(dst, delimiter=delimiter); writer.writerow(header)
            if cursor is not None:
                for row in cursor:
                    writer.writerow(row); count += 1
            else:
                with opener(raw_path, 'rt', encoding='utf-8-sig', newline='') as src:
                    for row in csv.DictReader(src, delimiter=delimiter):
                        assert None not in row, name
                        logical = {'host_pathway_coverage_cofactors': 'pathway_cofactor_requirements',
                                   'host_pathway_coverage_pathways': 'pathway_host_coverage',
                                   'host_chassis_reaction_links': 'host_reaction_links',
                                   'host_chassis_compound_links': 'host_compound_links'}.get(table, table)
                        if not keep_row(logical, row, allowed_templates=templates):
                            removed += 1; continue
                        projected = {display.RENAME.get(k, k): cell(k, v) for k, v in row.items()
                                     if display.RENAME.get(k, k) in header}
                        if table.startswith('model_ready_'):
                            kind = 'enzyme' if 'enzyme' in table else 'reaction'
                            identifier = row.get('biopart_id') if kind == 'enzyme' else row.get('reaction_id')
                            score, tier = scores.get((kind, identifier), ('', ''))
                            scorekey = 'enzyme_evidence_score' if kind == 'enzyme' else 'evidence_score'
                            tierkey = 'enzyme_evidence_tier' if kind == 'enzyme' else 'evidence_tier'
                            if scorekey in projected: projected[scorekey] = score
                            if tierkey in projected: projected[tierkey] = tier
                            if kind == 'enzyme':
                                ph, temp = attrs.get(identifier, (None, None))
                                projected['optimum_ph_values'] = ph
                                projected['optimum_temperature_values'] = temp
                        # Historical evaluation ranks depend on the old evidence
                        # scores. Do not publish an obsolete numerical ranking.
                        for k in ('baseline_rank_score', 'baseline_rank'):
                            if k in projected: projected[k] = ''
                        if any(k in projected for k in ('evidence_score', 'enzyme_evidence_score')) and not table.startswith('model_ready_'):
                            identifier = row.get('candidate_biopart_id') or row.get('positive_biopart_id') or row.get('reaction_id') or row.get('gold_reaction_id')
                            kind = 'enzyme' if row.get('candidate_biopart_id') or row.get('positive_biopart_id') else 'reaction'
                            if (kind, identifier) in scores:
                                for k in ('evidence_score', 'enzyme_evidence_score'):
                                    if k in projected: projected[k] = scores[kind, identifier][0]
                                for k in ('evidence_tier', 'enzyme_evidence_tier'):
                                    if k in projected: projected[k] = scores[kind, identifier][1]
                        writer.writerow([projected.get(k) for k in header]); count += 1
        assert sep.file_hash(raw_path) == before
        # Read back the actual compressed payload, not just the in-memory rows.
        with opener(target, 'rt', encoding='utf-8', newline='') as stream:
            reader = csv.reader(stream, delimiter=delimiter)
            assert next(reader) == header
            observed = 0
            for values in reader:
                assert len(values) == len(header), name
                observed += 1
            assert observed == count
        manifest.append({'file':name,'rows':count,'columns':header,'sha256':sep.file_hash(target),
                         'size':target.stat().st_size,'input_sha256':before,
                         'explicit_excluded_rows':removed,'roundtrip_verified':True,
                         'synchronised_sqlite_table':table if cursor is not None else None})
        print('TABULAR', name, count, flush=True)
    core.close(); rules_db.close()
    return manifest


def finish(output_dir, reports, files):
    dictionary = []
    db_files = []
    for path in sorted((output_dir/'sqlite').iterdir()):
        db = sqlite3.connect(path)
        stripped = []
        for table, _ in sep.ordinary_tables(db):
            fields = {r[1] for r in db.execute('PRAGMA table_info(' + sep.q(table) + ')')}
            if 'representative_source_labels' in fields:
                db.execute('PRAGMA secure_delete=ON')
                db.execute('ALTER TABLE ' + sep.q(table) + ' DROP COLUMN representative_source_labels')
                stripped.append({'table':table,'column':'representative_source_labels'})
        if stripped:
            db.commit();db.execute('VACUUM')
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert not db.execute('PRAGMA foreign_key_check').fetchall()
        for table, _ in sep.ordinary_tables(db):
            for r in db.execute(f'PRAGMA table_info({sep.q(table)})'):
                dictionary.append([path.name,table,r[1],r[2],r[3],r[5]])
        audit = next(r for r in reports if r['input'] == path.name)
        if stripped:
            audit['additional_collection_description_columns_omitted'] = stripped
        for row in audit['tables']:
            row['final_rows'] = db.execute('SELECT count(*) FROM ' + sep.q(row['table'])).fetchone()[0]
        (output_dir.parent/'audit'/(path.name+'.json')).write_text(json.dumps(audit,indent=2),encoding='utf-8')
        db.close()
        db_files.append({'file':'sqlite/'+path.name,'size':path.stat().st_size,'sha256':sep.file_hash(path),
                         'integrity_check':'ok','foreign_key_check':'passed'})
    with (output_dir/'sqlite_fields.tsv').open('w',encoding='utf-8',newline='') as h:
        w=csv.writer(h,delimiter='\t');w.writerow(['file','table','field','type','not_null','primary_key_order']);w.writerows(dictionary)
    with (output_dir/'table_fields.tsv').open('w',encoding='utf-8',newline='') as h:
        w=csv.writer(h,delimiter='\t');w.writerow(['file','field','field_position'])
        for f in files:
            w.writerows((f['file'],c,i) for i,c in enumerate(f['columns'],1))
    manifest={'format':'identified-kegg-content-excluded-v1','status':'local_candidate',
              'public_download_enabled':False,'identified_kegg_content_excluded':True,
              'identifiers_and_ordinary_links_retained':True,
              'all_upstream_field_provenance_verified':False,'all_sources_redistribution_cleared':False,
              'sqlite_files':db_files,'tabular_files':files,
              'known_mixed_pools_withheld':['enzymatic_metabolic rules and dependent links',
                                          'biochemical building blocks, READRetro compounds and routes',
                                          'non-USPTO biochemical benchmarks'],
              'historical_baseline_ranks_cleared':True}
    (output_dir/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    (output_dir/'README.txt').write_text(
        'Identified KEGG content is excluded from these physically rebuilt download copies. '
        'KEGG identifiers, namespaces, ordinary external links and identifier-only joins are retained. '
        'Explicit KEGG attributes, pathway names/membership/coverage, chemical comparisons, atom mappings '
        'and dependent records are excluded. Known biochemical source-mixed rule, building-block, benchmark '
        'and route pools are withheld rather than relabelled. Typed SQLite schemas remain available even '
        'when a table is empty. Core evidence scores and model-ready optimum pH/temperature features are '
        'recomputed from retained data. Obsolete exported baseline ranks are blank. Paired CSV/TSV tables '
        'are regenerated from the filtered SQLite snapshot. Internal scientific masters are unchanged. '
        'This does not certify every historical field upstream or grant other databases redistribution rights. '
        'Existing citation/licence notices remain separate from data-row presentation.\n',encoding='utf-8')
    archive=output_dir.parent/'data_kegg_content_excluded.zip'
    with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=1) as z:
        for p in sorted(output_dir.rglob('*')):
            if p.is_file(): z.write(p,p.relative_to(output_dir).as_posix())
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
        entries=len(z.namelist())
    acceptance={'original_databases_unchanged':all(r['input_bytes_unchanged'] for r in reports),
                'sqlite_integrity_and_foreign_keys':'passed','tabular_roundtrip':'passed','archive_crc':'passed',
                'archive':str(archive),'sha256':sep.file_hash(archive),'size':archive.stat().st_size,
                'entries':entries,'sqlite_files':len(db_files),'tabular_files':len(files)}
    (output_dir.parent/'acceptance.json').write_text(json.dumps(acceptance,indent=2),encoding='utf-8')
    print('COMPLETE',json.dumps(acceptance),flush=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--original-dir',type=Path,required=True)
    parser.add_argument('--previous-bundle',type=Path,required=True)
    parser.add_argument('--output-dir',type=Path,required=True)
    args=parser.parse_args()
    original=args.original_dir.resolve(); previous=args.previous_bundle.resolve(); out=args.output_dir.resolve()
    assert not out.exists(), 'Use a fresh output directory'
    assert not out.is_relative_to(original) and not out.is_relative_to(previous)
    (out/'sqlite').mkdir(parents=True);(out/'tables').mkdir();(out.parent/'audit').mkdir(exist_ok=True)
    csv.field_size_limit(100_000_000)
    reports=[]
    for p in sorted((previous/'sqlite').iterdir()):
        reports.append(copy_database(p.name,original,previous,out))
    scores,attrs=refresh_scores_and_features(out)
    files=export_tabular(original,previous,out,scores,attrs)
    for name in ['LICENSE_DATA.txt','CITATION.cff','LICENSE_CITATION_NOTICES.txt']:
        shutil.copy2(previous/name,out/name)
    finish(out,reports,files)


if __name__=='__main__':
    main()
