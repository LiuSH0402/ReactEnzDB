from __future__ import annotations

import csv
import gzip
import hashlib
import json
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "reaction_standardization_work"
DB_PATH = WORK / "reaction_standardization.sqlite"
RELEASE = WORK / "release_2026-07-14"


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def rows(db: sqlite3.Connection, query: str):
    return [dict(row) for row in db.execute(query)]


def write_tsv_gz(path: Path, data, fieldnames: list[str]) -> int:
    count = 0
    with gzip.open(path, "wt", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, delimiter="\t", extrasaction="ignore")
        writer.writeheader()
        for row in data:
            writer.writerow(dict(row))
            count += 1
    return count


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    RELEASE.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row

    counts = {name: db.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0] for name in (
        "reactenz_reaction_inputs", "normalized_participants", "standardized_reactions", "balance_results",
        "external_reactions", "cross_database_mappings", "mapping_conflicts", "atom_mappings", "reaction_centres",
    )}
    structure = rows(db, "SELECT structure_completeness_status status,COUNT(*) count FROM standardized_reactions GROUP BY 1 ORDER BY count DESC")
    stereo = rows(db, "SELECT stereo_completeness_status status,COUNT(*) count FROM standardized_reactions GROUP BY 1 ORDER BY count DESC")
    balance = rows(db, "SELECT balance_context,mass_balance_status,charge_balance_status,COUNT(*) count FROM balance_results GROUP BY 1,2,3 ORDER BY 1,count DESC")
    mapping = rows(db, "SELECT target_db,confidence_tier,chemistry_equivalence,COUNT(*) count FROM cross_database_mappings GROUP BY 1,2,3 ORDER BY 1,count DESC")
    conflicts = rows(db, "SELECT conflict_type,conflict_severity,COUNT(*) count,SUM(requires_manual_review) manual_review_count FROM mapping_conflicts GROUP BY 1,2 ORDER BY count DESC")
    atom = rows(db, "SELECT mapping_source,mapping_status,COALESCE(json_extract(validation_flags_json,'$.match_basis'),json_extract(validation_flags_json,'$.quality_tier')) match_basis,COUNT(*) count,ROUND(AVG(mapping_confidence),4) mean_confidence FROM atom_mappings GROUP BY 1,2,3 ORDER BY count DESC")
    centres = rows(db, "SELECT extraction_status,COUNT(*) count FROM reaction_centres GROUP BY 1 ORDER BY count DESC")
    qa = rows(db, "SELECT check_name,passed,observed_value,expected_value,severity,checked_at FROM qa_results ORDER BY severity,check_name")
    source_files = rows(db, "SELECT source_name,relative_path,size_bytes,sha256,redistribution_status FROM source_files ORDER BY source_name,relative_path")

    reaction_query = """
    SELECT i.reaction_id,i.reactenz_reaction_id,i.source_equation,i.source_direction,i.ec_number,
           i.rhea_id,i.kegg_reaction_id,i.metacyc_reaction_id,i.mnx_reaction_ids,
           s.canonical_reaction_smiles,s.directionless_reaction_key,s.directional_reaction_key,
           s.directionless_reaction_key_no_stereo,s.directional_reaction_key_no_stereo,
           s.normalized_direction,s.structure_completeness_status,s.stereo_completeness_status,
           s.standardization_status,
           bf.mass_balance_status full_mass_balance_status,bf.charge_balance_status full_charge_balance_status,
           bf.element_delta_json full_element_delta_json,bf.charge_delta full_charge_delta,
           bc.mass_balance_status core_mass_balance_status,bc.charge_balance_status core_charge_balance_status,
           a.mapping_source best_atom_mapping_source,a.mapping_status best_atom_mapping_status,
           a.mapping_confidence best_atom_mapping_confidence,
           COALESCE(json_extract(a.validation_flags_json,'$.match_basis'),json_extract(a.validation_flags_json,'$.quality_tier')) best_atom_mapping_basis,
           rc.extraction_status reaction_centre_status,
           (SELECT COUNT(*) FROM mapping_conflicts mc WHERE mc.reaction_id=i.reaction_id) conflict_count,
           (SELECT COUNT(*) FROM mapping_conflicts mc WHERE mc.reaction_id=i.reaction_id AND mc.requires_manual_review=1) manual_review_conflict_count
    FROM reactenz_reaction_inputs i
    JOIN standardized_reactions s USING(reaction_id)
    LEFT JOIN balance_results bf ON bf.reaction_id=i.reaction_id AND bf.balance_context='full_explicit'
    LEFT JOIN balance_results bc ON bc.reaction_id=i.reaction_id AND bc.balance_context='core_transformation'
    LEFT JOIN atom_mappings a ON a.reaction_id=i.reaction_id
    LEFT JOIN reaction_centres rc ON rc.atom_mapping_id=a.atom_mapping_id
    ORDER BY i.reaction_id
    """
    reaction_fields = [description[0] for description in db.execute(reaction_query).description]
    reaction_count = write_tsv_gz(RELEASE / "reaction_standardization_full.tsv.gz", db.execute(reaction_query), reaction_fields)

    conflict_query = """
    SELECT mc.conflict_id,mc.reaction_id,i.reactenz_reaction_id,i.source_equation,mc.conflict_type,
           mc.conflict_severity,mc.reactenz_value,mc.external_value,mc.explanation,mc.resolution_status,
           mc.resolution_rule,mc.requires_manual_review,m.target_db,m.target_reaction_id,m.mapping_basis,
           m.mapping_confidence,m.confidence_tier
    FROM mapping_conflicts mc
    JOIN reactenz_reaction_inputs i USING(reaction_id)
    LEFT JOIN cross_database_mappings m USING(mapping_id)
    ORDER BY mc.requires_manual_review DESC,mc.conflict_severity,mc.conflict_type,mc.reaction_id
    """
    conflict_fields = [description[0] for description in db.execute(conflict_query).description]
    conflict_count = write_tsv_gz(RELEASE / "conflicts_for_review.tsv.gz", db.execute(conflict_query), conflict_fields)

    progress_path = WORK / "rxnmapper_progress.sqlite"
    rxnmapper_audit_count = 0
    if progress_path.exists():
        progress = sqlite3.connect(progress_path)
        progress.row_factory = sqlite3.Row
        review_query = """
        SELECT i.reaction_id,i.reactenz_reaction_id,i.input_status,
               p.prediction_status,p.model_name,p.model_version,p.rxnmapper_confidence,
               p.error_type,p.error_text,v.quality_tier,v.publishable,
               v.parse_status,v.duplicate_map_numbers_left,v.duplicate_map_numbers_right,
               v.left_only_map_count,v.right_only_map_count,v.element_mismatch_count,
               v.mapped_formula_mass_balance_status,v.source_mass_balance_status,
               v.large_rearrangement_flag,v.reaction_centre_status,
               v.validation_flags_json,v.validation_details_json
        FROM prediction_inputs i
        LEFT JOIN predictions p USING(reaction_id)
        LEFT JOIN validations v USING(reaction_id)
        WHERE i.cohort='unmatched' AND COALESCE(v.publishable,0)=0
        ORDER BY i.reaction_id
        """
        review_fields = [description[0] for description in progress.execute(review_query).description]
        rxnmapper_audit_count = write_tsv_gz(
            RELEASE / "rxnmapper_review_queue.tsv.gz", progress.execute(review_query), review_fields
        )
        calibration_query = """
        SELECT i.reaction_id,i.reactenz_reaction_id,p.rxnmapper_confidence,p.model_name,
               c.source_orientation,c.correspondence_jaccard,c.centre_signature_jaccard,
               c.centre_status_agreement,c.agreement_status,c.details_json
        FROM calibration_comparisons c
        JOIN prediction_inputs i USING(reaction_id)
        JOIN predictions p USING(reaction_id)
        ORDER BY i.reaction_id
        """
        calibration_fields = [description[0] for description in progress.execute(calibration_query).description]
        write_tsv_gz(RELEASE / "rxnmapper_enzymemap_calibration.tsv.gz", progress.execute(calibration_query), calibration_fields)
        audit_snapshot = RELEASE / "rxnmapper_audit.sqlite"
        if audit_snapshot.exists():
            audit_snapshot.unlink()
        audit_db = sqlite3.connect(audit_snapshot)
        progress.backup(audit_db)
        audit_db.commit(); audit_db.close(); progress.close()
        for name in ("rxnmapper_audit_report.json", "rxnmapper_audit_report.md"):
            source = WORK / name
            if source.exists():
                shutil.copy2(source, RELEASE / name)

    source_fields = list(source_files[0]) if source_files else []
    with (RELEASE / "source_provenance.tsv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=source_fields, delimiter="\t")
        writer.writeheader(); writer.writerows(source_files)

    snapshot = RELEASE / "reaction_standardization.sqlite"
    for old in (snapshot, Path(str(snapshot) + "-wal"), Path(str(snapshot) + "-shm")):
        if old.exists():
            old.unlink()
    snapshot_db = sqlite3.connect(snapshot)
    db.backup(snapshot_db)
    snapshot_db.commit()
    snapshot_db.execute("PRAGMA journal_mode=DELETE")
    snapshot_db.close()
    for sidecar in (Path(str(snapshot) + "-wal"), Path(str(snapshot) + "-shm")):
        if sidecar.exists():
            sidecar.unlink()
    snapshot_sha = sha256(snapshot)

    summary = {
        "generated_at": now(), "rule_versions": dict(db.execute("SELECT key,value FROM metadata WHERE key LIKE '%rule_version'")),
        "counts": counts, "structure": structure, "stereo": stereo, "balance": balance, "mapping": mapping,
        "conflicts": conflicts, "atom_mapping": atom, "reaction_centres": centres, "qa": qa,
        "exports": {"reaction_rows": reaction_count, "conflict_rows": conflict_count,
                    "database_snapshot_sha256": snapshot_sha, "registered_source_files": len(source_files)},
        "interpretation_boundaries": [
            "Mass and charge balance use represented protonation states and reparsed stoichiometric coefficients.",
            "Generic structures containing wildcard atoms are not treated as fully mass-balanceable molecules.",
            "Core-transformation balance excludes only explicitly classified currency/cofactor participants and is not a replacement for full balance.",
            "EnzymeMap atom mappings are retained only after normalized-identity matching; RXNMapper records are separately labelled predictions and promoted only after calibrated structural, mass-balance, rearrangement and reaction-centre gates.",
            "KEGG and MetaCyc snapshot-derived raw records remain internal where upstream terms require it; derived conflict annotations are separated from raw redistribution.",
        ],
    }
    (RELEASE / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    def table(items: list[dict], columns: list[str]) -> str:
        if not items:
            return "_None_"
        output = ["| " + " | ".join(columns) + " |", "| " + " | ".join("---" for _ in columns) + " |"]
        output += ["| " + " | ".join(str(item.get(col, "")) for col in columns) + " |" for item in items]
        return "\n".join(output)

    report = f"""# ReactEnzDB reaction standardization release

Generated: {summary['generated_at']}

## Scope

- ReactEnzDB reactions: {counts['reactenz_reaction_inputs']:,}
- Normalized participants: {counts['normalized_participants']:,}
- External working records: {counts['external_reactions']:,}
- Cross-database mappings: {counts['cross_database_mappings']:,}
- Selected atom mappings: {counts['atom_mappings']:,}
- Extracted/no-change reaction-centre records: {counts['reaction_centres']:,}
- Explicit conflict records: {counts['mapping_conflicts']:,}
- Registered, checksum-verified source files: {len(source_files):,}

## Structure completeness

{table(structure, ['status','count'])}

## Full and core balance outcomes

{table(balance, ['balance_context','mass_balance_status','charge_balance_status','count'])}

## Cross-database identity outcomes

{table(mapping, ['target_db','confidence_tier','chemistry_equivalence','count'])}

## Atom mapping outcomes

{table(atom, ['mapping_source','mapping_status','match_basis','count','mean_confidence'])}

## Reaction-centre outcomes

{table(centres, ['extraction_status','count'])}

## Conflicts requiring explicit interpretation

{table(conflicts, ['conflict_type','conflict_severity','count','manual_review_count'])}

## QA

All checks passed: {all(item['passed'] for item in qa)} ({sum(item['passed'] for item in qa)}/{len(qa)}).

## Files

- `reaction_standardization.sqlite`: consistent SQLite snapshot; SHA256 `{snapshot_sha}`
- `reaction_standardization_full.tsv.gz`: one row per ReactEnzDB reaction for website/API ingestion
- `conflicts_for_review.tsv.gz`: conflict and review queue
- `rxnmapper_review_queue.tsv.gz`: per-reaction predicted mappings withheld from the public atom-mapping layer, including explicit reasons ({rxnmapper_audit_count:,} rows)
- `rxnmapper_enzymemap_calibration.tsv.gz`: all 1,844 RXNMapper/EnzymeMap calibration comparisons
- `rxnmapper_audit.sqlite`: resumable prediction, validation, calibration, and promotion audit trail
- `rxnmapper_audit_report.json` / `.md`: machine-readable and human-readable RXNMapper QA summaries
- `source_provenance.tsv`: registered sources, checksums and redistribution scope
- `summary.json`: machine-readable release summary

## Interpretation boundaries

""" + "\n".join(f"- {item}" for item in summary["interpretation_boundaries"]) + "\n"
    (RELEASE / "README.md").write_text(report, encoding="utf-8")
    db.close()
    print(json.dumps({"release": str(RELEASE), "reaction_rows": reaction_count, "conflict_rows": conflict_count,
                      "snapshot_sha256": snapshot_sha, "qa_passed": all(item["passed"] for item in qa)}, indent=2))


if __name__ == "__main__":
    main()
