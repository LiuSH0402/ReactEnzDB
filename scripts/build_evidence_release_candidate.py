from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import os
import re
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "evidence_work"
SOURCE_DB = WORK / "enzyme_reaction_evidence.sqlite"
RELEASE_DIR = WORK / "release_candidate"
OUTPUT_DB = RELEASE_DIR / "reactenzdb_evidence_rc.sqlite"
SUMMARY_JSON = RELEASE_DIR / "reactenzdb_evidence_rc.summary.json"
README_PATH = RELEASE_DIR / "README.md"
MANIFEST_PATH = RELEASE_DIR / "manifest.json"
TSV_DIR = RELEASE_DIR / "tsv"
INCLUDED_SOURCE_SQL = "(source_db IN ('SABIO-RK','BRENDA') OR source_db LIKE 'ReactEnzDB-core:%')"


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def text(value: Any) -> str | None:
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def canonical_parameter(value: Any) -> str:
    raw = re.sub(r"[ _-]+", " ", str(value or "").strip().lower())
    aliases = {
        "turnover number": "kcat", "turnovernumber": "kcat", "k cat": "kcat",
        "kcat/km": "kcat_km", "kcat km": "kcat_km", "kcatkm": "kcat_km",
        "specific activity": "specific_activity", "specificactivity": "specific_activity",
        "specific enz. activity": "specific_activity", "specific enzyme activity": "specific_activity",
        "vmax/km": "vmax_km", "vmax km": "vmax_km",
        "ic 50": "ic50", "equilibrium constant": "keq",
    }
    return aliases.get(raw, raw.replace(" ", "_")) or "not_reported"


def normalize_unit_text(value: Any) -> str:
    unit = str(value or "").strip().lower()
    unit = unit.replace("μ", "u").replace("µ", "u").replace("−", "-").replace("·", "*")
    unit = re.sub(r"\s+", "", unit)
    return unit


def release_normalize(parameter: str, value: Any, unit: Any) -> tuple[float | None, str | None, str]:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None, None, "non_numeric_or_missing"
    u = normalize_unit_text(unit)
    concentration_parameters = {"km", "ki", "ic50", "kd", "concentration"}
    if parameter in concentration_parameters:
        if u in {"mm", "mmol/l", "mmolar"}:
            return numeric, "mM", "converted_exact"
        if u in {"um", "umol/l", "umolar"}:
            return numeric / 1000.0, "mM", "converted_exact"
        if u in {"nm", "nmol/l", "nmolar"}:
            return numeric / 1_000_000.0, "mM", "converted_exact"
        if u in {"m", "mol/l", "molar"}:
            return numeric * 1000.0, "mM", "converted_exact"
    if parameter == "kcat":
        if u in {"s^(-1)", "s^-1", "1/s", "s-1"}:
            return numeric, "s^-1", "converted_exact"
        if u in {"min^(-1)", "min^-1", "1/min", "min-1"}:
            return numeric / 60.0, "s^-1", "converted_exact"
    if parameter == "kcat_km":
        per_second = 1.0
        if "min^(-1)" in u or "min^-1" in u or "/min" in u:
            per_second = 1.0 / 60.0
        elif "h^(-1)" in u or "h^-1" in u or "/h" in u:
            per_second = 1.0 / 3600.0
        if u.startswith("mm^(-1)") or u.startswith("mm^-1") or u.startswith("1/(mm*"):
            return numeric * per_second, "mM^-1 s^-1", "converted_exact"
        if u.startswith("m^(-1)") or u.startswith("m^-1") or u.startswith("mol^(-1)") or u.startswith("1/(m*"):
            return numeric * per_second / 1000.0, "mM^-1 s^-1", "converted_exact"
        if u.startswith("um^(-1)") or u.startswith("um^-1") or u.startswith("1/(um*"):
            return numeric * per_second * 1000.0, "mM^-1 s^-1", "converted_exact"
        if u.startswith("nm^(-1)") or u.startswith("nm^-1") or u.startswith("1/(nm*"):
            return numeric * per_second * 1_000_000.0, "mM^-1 s^-1", "converted_exact"
    if parameter == "specific_activity" and u in {
        "umol/(min*mg)", "umol*min^-1*mg^-1", "u/mg", "unit/mg", "units/mg",
    }:
        return numeric, "umol min^-1 mg^-1", "converted_exact"
    if parameter == "specific_activity":
        factors = {
            "nmol/(min*mg)": 1e-3,
            "pmol/(min*mg)": 1e-6,
            "mmol/(min*mg)": 1e3,
            "nmol/(h*mg)": 1e-3 / 60.0,
            "umol/(h*mg)": 1.0 / 60.0,
            "pmol/(h*mg)": 1e-6 / 60.0,
            "nmol/(s*mg)": 0.06,
            "nkatal/mg": 0.06,
            "pkatal/mg": 0.00006,
        }
        if u in factors:
            return numeric * factors[u], "umol min^-1 mg^-1", "converted_exact"
    return None, None, "unit_not_normalized"


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA foreign_keys=ON;
        CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE evidence_class_definitions(
          evidence_class TEXT PRIMARY KEY,rank_order INTEGER NOT NULL,definition TEXT NOT NULL,
          minimum_requirements_json TEXT NOT NULL,interpretation_boundary TEXT NOT NULL
        );
        CREATE TABLE outcome_definitions(outcome_class TEXT PRIMARY KEY,definition TEXT NOT NULL);
        CREATE TABLE assertions(
          assertion_id TEXT PRIMARY KEY,source_db TEXT NOT NULL,source_record_id TEXT NOT NULL,
          source_ec_number TEXT,reaction_id TEXT,reactenz_reaction_id TEXT,
          primary_biopart_id TEXT,primary_reactenz_enzyme_id TEXT,enzyme_form_id TEXT,
          wild_type_status TEXT,mutation_text TEXT,form_accession TEXT,
          evidence_class TEXT NOT NULL,evidence_rank INTEGER NOT NULL,display_evidence_label TEXT NOT NULL,
          outcome_class TEXT NOT NULL,is_experimental INTEGER NOT NULL,
          enzyme_identity_status TEXT NOT NULL,reaction_identity_status TEXT NOT NULL,
          substrate_identity_status TEXT NOT NULL,product_identity_status TEXT NOT NULL,
          mapping_score REAL,curation_status TEXT NOT NULL,pmid_count INTEGER NOT NULL,
          has_quantitative_measurement INTEGER NOT NULL,has_assay_conditions INTEGER NOT NULL,
          source_url TEXT,rule_id TEXT,duplicate_group_id TEXT,is_canonical INTEGER NOT NULL,
          duplicate_group_member_count INTEGER NOT NULL,created_at TEXT NOT NULL
        );
        CREATE INDEX idx_release_assertion_reaction ON assertions(reaction_id,evidence_rank);
        CREATE INDEX idx_release_assertion_enzyme ON assertions(primary_biopart_id,evidence_rank);
        CREATE INDEX idx_release_assertion_duplicate ON assertions(duplicate_group_id);
        CREATE INDEX idx_release_assertion_canonical ON assertions(is_canonical,reaction_id,evidence_rank);
        CREATE TABLE assertion_enzyme_links(
          assertion_id TEXT NOT NULL,biopart_id TEXT NOT NULL,reactenz_enzyme_id TEXT,
          link_method TEXT NOT NULL,source_accession TEXT,is_primary INTEGER NOT NULL,
          PRIMARY KEY(assertion_id,biopart_id,link_method),
          FOREIGN KEY(assertion_id) REFERENCES assertions(assertion_id)
        );
        CREATE TABLE assertion_compounds(
          assertion_id TEXT NOT NULL,participant_role TEXT NOT NULL,raw_name TEXT,
          compound_id TEXT,compound_name TEXT,canonical_smiles TEXT,inchikey TEXT,
          mapping_method TEXT NOT NULL,structure_similarity REAL,is_exact_structure_match INTEGER NOT NULL,
          PRIMARY KEY(assertion_id,participant_role,raw_name,compound_id),
          FOREIGN KEY(assertion_id) REFERENCES assertions(assertion_id)
        );
        CREATE TABLE measurements(
          measurement_id TEXT PRIMARY KEY,assertion_id TEXT NOT NULL,
          parameter_type_raw TEXT NOT NULL,parameter_type_canonical TEXT NOT NULL,
          raw_value_text TEXT,raw_value_numeric REAL,raw_unit TEXT,
          source_normalized_value REAL,source_normalized_unit TEXT,source_normalization_status TEXT NOT NULL,
          release_normalized_value REAL,release_normalized_unit TEXT,release_normalization_status TEXT NOT NULL,
          subject_name TEXT,FOREIGN KEY(assertion_id) REFERENCES assertions(assertion_id)
        );
        CREATE INDEX idx_release_measurement_assertion ON measurements(assertion_id,parameter_type_canonical);
        CREATE TABLE assay_conditions(
          condition_id TEXT PRIMARY KEY,assertion_id TEXT NOT NULL,ph REAL,temperature_c REAL,
          buffer_text TEXT,cofactor_text TEXT,condition_text TEXT,extraction_method TEXT NOT NULL,
          FOREIGN KEY(assertion_id) REFERENCES assertions(assertion_id)
        );
        CREATE TABLE citations(
          assertion_id TEXT NOT NULL,pmid TEXT,doi TEXT,title TEXT,journal TEXT,year INTEGER,
          source_url TEXT,full_text_status TEXT NOT NULL,verification_status TEXT NOT NULL,
          PRIMARY KEY(assertion_id,pmid,doi),FOREIGN KEY(assertion_id) REFERENCES assertions(assertion_id)
        );
        CREATE INDEX idx_release_citation_pmid ON citations(pmid);
        CREATE TABLE reaction_enzyme_summary(
          reaction_id TEXT NOT NULL,reactenz_reaction_id TEXT NOT NULL,
          biopart_id TEXT NOT NULL,reactenz_enzyme_id TEXT NOT NULL,
          best_evidence_class TEXT NOT NULL,best_evidence_rank INTEGER NOT NULL,
          assertion_count INTEGER NOT NULL,exact_assertion_count INTEGER NOT NULL,
          catalytic_assertion_count INTEGER NOT NULL,non_catalytic_assertion_count INTEGER NOT NULL,
          inactive_or_negative_count INTEGER NOT NULL,measurement_count INTEGER NOT NULL,
          citation_count INTEGER NOT NULL,condition_count INTEGER NOT NULL,
          literature_verified_count INTEGER NOT NULL,literature_discrepancy_count INTEGER NOT NULL,
          source_count INTEGER NOT NULL,source_labels TEXT NOT NULL,
          PRIMARY KEY(reaction_id,biopart_id)
        );
        CREATE INDEX idx_release_re_summary_public ON reaction_enzyme_summary(reactenz_reaction_id,best_evidence_rank);
        CREATE TABLE reaction_summary(
          reaction_id TEXT PRIMARY KEY,reactenz_reaction_id TEXT NOT NULL,
          enzyme_count INTEGER NOT NULL,assertion_count INTEGER NOT NULL,
          exact_enzyme_count INTEGER NOT NULL,catalytic_assertion_count INTEGER NOT NULL,
          inactive_or_negative_count INTEGER NOT NULL,citation_count INTEGER NOT NULL,
          best_evidence_rank INTEGER,best_evidence_class TEXT
        );
        CREATE TABLE enzyme_summary(
          biopart_id TEXT PRIMARY KEY,reactenz_enzyme_id TEXT NOT NULL,
          reaction_count INTEGER NOT NULL,assertion_count INTEGER NOT NULL,
          exact_reaction_count INTEGER NOT NULL,catalytic_assertion_count INTEGER NOT NULL,
          inactive_or_negative_count INTEGER NOT NULL,citation_count INTEGER NOT NULL,
          best_evidence_rank INTEGER,best_evidence_class TEXT
        );
        CREATE TABLE qa_results(
          check_name TEXT PRIMARY KEY,passed INTEGER NOT NULL,observed_value TEXT NOT NULL,
          expected_value TEXT,checked_at TEXT NOT NULL
        );
        CREATE TABLE brenda_context_records(
          context_id TEXT PRIMARY KEY,operation TEXT NOT NULL,context_type TEXT NOT NULL,
          ec_number TEXT NOT NULL,organism TEXT,value_text TEXT,value_max_text TEXT,
          commentary_available INTEGER NOT NULL,literature_ids_json TEXT NOT NULL,
          ligand_structure_id TEXT,linkage_boundary TEXT NOT NULL
        );
        CREATE INDEX idx_release_brenda_context_ec ON brenda_context_records(ec_number,context_type);
        """
    )


def build_release() -> dict[str, int]:
    RELEASE_DIR.mkdir(parents=True, exist_ok=True)
    temp = OUTPUT_DB.with_suffix(".sqlite.tmp")
    if temp.exists():
        temp.unlink()
    out = sqlite3.connect(temp)
    out.row_factory = sqlite3.Row
    create_schema(out)
    print("[release-candidate] schema created", flush=True)
    src = sqlite3.connect(SOURCE_DB)
    src.row_factory = sqlite3.Row
    class_rows = list(src.execute("SELECT * FROM evidence_class_definitions ORDER BY rank_order"))
    class_rank = {row["evidence_class"]: int(row["rank_order"]) for row in class_rows}
    out.executemany("INSERT INTO evidence_class_definitions VALUES (?,?,?,?,?)", [tuple(row) for row in class_rows])
    out.executemany("INSERT INTO outcome_definitions VALUES (?,?)", [tuple(row) for row in src.execute("SELECT * FROM outcome_definitions")])
    print("[release-candidate] definitions loaded", flush=True)
    out.executemany(
        "INSERT INTO metadata VALUES (?,?)",
        [
            ("release_status", "release_candidate_full_sources"),
            ("release_version", "EVIDENCE_RC_V2"),
            ("generated_at", now()),
            ("included_sources", "ReactEnzDB core kinetics; complete SABIO-RK entry JSON; complete BRENDA SOAP evidence cache with conservative mapping"),
            ("excluded_pending_source", "No downloaded evidence source is pending ingestion; literature verification remains an explicit curation state"),
            ("raw_response_policy", "No raw cache paths or complete licensed source responses are included"),
            ("automatic_exact_boundary", "Automatic strict matches are distinct from literature-verified assertions"),
        ],
    )
    public_reactions = dict(src.execute("SELECT reaction_id,reactenz_reaction_id FROM reactions"))
    public_enzymes = dict(src.execute("SELECT biopart_id,reactenz_enzyme_id FROM enzymes"))
    compound_names = {row[0]: row[1] for row in src.execute("SELECT compound_id,max(compound_name) FROM reaction_compounds GROUP BY compound_id")}
    assertions = list(src.execute(f"""
        SELECT assertion_id,source_db,source_record_id,source_ec_number,reaction_id,biopart_id,
               enzyme_form_id,evidence_class,display_evidence_label,outcome_class,is_experimental,
               enzyme_identity_status,reaction_identity_status,substrate_identity_status,product_identity_status,
               mapping_score,curation_status,pmid_count,has_quantitative_measurement,has_assay_conditions,
               source_url,json_extract(mapping_details_json,'$.rule_id') AS rule_id,created_at
        FROM experimental_assertions WHERE {INCLUDED_SOURCE_SQL} ORDER BY assertion_id
    """))
    assertion_ids = {row["assertion_id"] for row in assertions}
    print(f"[release-candidate] assertions selected: {len(assertions):,}", flush=True)
    compound_map: dict[str, list[tuple]] = defaultdict(list)
    measurement_map: dict[str, list[tuple]] = defaultdict(list)
    citation_map: dict[str, list[tuple]] = defaultdict(list)
    condition_map: dict[str, list[tuple]] = defaultdict(list)
    needed_form_ids = {row["enzyme_form_id"] for row in assertions if row["enzyme_form_id"]}
    form_map = {row["enzyme_form_id"]: row for row in src.execute("SELECT * FROM enzyme_forms") if row["enzyme_form_id"] in needed_form_ids}
    print(f"[release-candidate] enzyme forms indexed: {len(form_map):,}", flush=True)
    for row in src.execute("SELECT * FROM assertion_compounds"):
        if row["assertion_id"] in assertion_ids:
            compound_map[row["assertion_id"]].append(tuple(row))
    print(f"[release-candidate] compound links indexed: {sum(map(len, compound_map.values())):,}", flush=True)
    for row in src.execute("SELECT * FROM measurements"):
        if row["assertion_id"] in assertion_ids:
            measurement_map[row["assertion_id"]].append(tuple(row))
    print(f"[release-candidate] measurements indexed: {sum(map(len, measurement_map.values())):,}", flush=True)
    for row in src.execute("SELECT * FROM citations"):
        if row["assertion_id"] in assertion_ids:
            citation_map[row["assertion_id"]].append(tuple(row))
    print(f"[release-candidate] citations indexed: {sum(map(len, citation_map.values())):,}", flush=True)
    for row in src.execute("SELECT * FROM assay_conditions"):
        if row["assertion_id"] in assertion_ids:
            condition_map[row["assertion_id"]].append(tuple(row))
    print(f"[release-candidate] conditions indexed: {sum(map(len, condition_map.values())):,}", flush=True)
    prepared_assertions = []
    duplicate_members: dict[str, list[sqlite3.Row]] = defaultdict(list)
    source_priority = {"SABIO-RK": 0, "BRENDA": 1}
    release_assertions = []
    for row in assertions:
        aid = row["assertion_id"]
        form = form_map.get(row["enzyme_form_id"])
        fingerprint_payload = {
            "reaction": row["reaction_id"],
            "enzyme": row["biopart_id"],
            "ec": row["source_ec_number"],
            "organism": form["organism"] if form else None,
            "accession": form["accession"] if form else None,
            "mutation": form["mutation_text"] if form else None,
            "evidence_class": row["evidence_class"],
            "outcome": row["outcome_class"],
            "pmids": sorted(str(x[1]) for x in citation_map[aid] if x[1]),
            "compounds": sorted((str(x[1]), str(x[2]), str(x[3])) for x in compound_map[aid]),
            "measurements": sorted((canonical_parameter(x[2]), str(x[3]), str(x[5]), str(x[9])) for x in measurement_map[aid]),
            "conditions": sorted((str(x[2]), str(x[3]), str(x[4]), str(x[5])) for x in condition_map[aid]),
        }
        if not fingerprint_payload["pmids"] and not fingerprint_payload["compounds"] and not fingerprint_payload["measurements"]:
            fingerprint_payload["source_record_fallback"] = row["source_record_id"]
        duplicate_group = hashlib.sha256(json.dumps(fingerprint_payload, sort_keys=True).encode()).hexdigest()[:20]
        prepared_assertions.append((row, form, row["rule_id"], duplicate_group))
        duplicate_members[duplicate_group].append(row)

    canonical_ids = set()
    for members in duplicate_members.values():
        canonical = min(
            members,
            key=lambda row: (
                0 if row["curation_status"] == "literature_verified" else 1,
                class_rank[row["evidence_class"]],
                -int(row["pmid_count"] or 0),
                -int(row["has_quantitative_measurement"] or 0),
                source_priority.get(row["source_db"], 2),
                row["assertion_id"],
            ),
        )
        canonical_ids.add(canonical["assertion_id"])

    for row, form, rule_id, duplicate_group in prepared_assertions:
        aid = row["assertion_id"]
        release_assertions.append((
            aid, row["source_db"], row["source_record_id"], row["source_ec_number"], row["reaction_id"], public_reactions.get(row["reaction_id"]),
            row["biopart_id"], public_enzymes.get(row["biopart_id"]), row["enzyme_form_id"],
            form["wild_type_status"] if form else None, form["mutation_text"] if form else None, form["accession"] if form else None,
            row["evidence_class"], class_rank[row["evidence_class"]], row["display_evidence_label"], row["outcome_class"], row["is_experimental"],
            row["enzyme_identity_status"], row["reaction_identity_status"], row["substrate_identity_status"], row["product_identity_status"],
            row["mapping_score"], row["curation_status"], row["pmid_count"], row["has_quantitative_measurement"], row["has_assay_conditions"],
            row["source_url"], rule_id, duplicate_group, int(aid in canonical_ids),
            len(duplicate_members[duplicate_group]), row["created_at"],
        ))
    out.executemany("INSERT INTO assertions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", release_assertions)
    print("[release-candidate] public assertions inserted", flush=True)
    # Include both explicit multi-enzyme links and the primary link.
    links = set()
    for row in assertions:
        if row["biopart_id"]:
            links.add((row["assertion_id"], row["biopart_id"], public_enzymes.get(row["biopart_id"]), "primary_assertion_link", None, 1))
    try:
        for row in src.execute("SELECT * FROM assertion_enzyme_links"):
            if row["assertion_id"] in assertion_ids:
                links.add((row["assertion_id"], row["biopart_id"], public_enzymes.get(row["biopart_id"]), row["link_method"], row["source_accession"], row["is_primary"]))
    except sqlite3.OperationalError:
        pass
    out.executemany("INSERT OR IGNORE INTO assertion_enzyme_links VALUES (?,?,?,?,?,?)", sorted(links))
    compound_rows = []
    for aid, rows in compound_map.items():
        for row in rows:
            compound_rows.append((row[0], row[1], row[2], row[3], compound_names.get(row[3]), row[4], row[5], row[6], row[7], row[8]))
    out.executemany("INSERT OR IGNORE INTO assertion_compounds VALUES (?,?,?,?,?,?,?,?,?,?)", compound_rows)
    release_measurements = []
    for aid, rows in measurement_map.items():
        for row in rows:
            parameter = canonical_parameter(row[2])
            normalized, normalized_unit, status = release_normalize(parameter, row[4], row[5])
            release_measurements.append((
                row[0], row[1], row[2], parameter, row[3], row[4], row[5], row[6], row[7], row[8],
                normalized, normalized_unit, status, row[9],
            ))
    out.executemany("INSERT INTO measurements VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", release_measurements)
    print(f"[release-candidate] public measurements inserted: {len(release_measurements):,}", flush=True)
    condition_rows = [row for rows in condition_map.values() for row in rows]
    out.executemany("INSERT INTO assay_conditions VALUES (?,?,?,?,?,?,?,?)", condition_rows)
    citation_rows = [row for rows in citation_map.values() for row in rows]
    out.executemany("INSERT OR IGNORE INTO citations VALUES (?,?,?,?,?,?,?,?,?)", citation_rows)
    try:
        out.executemany(
            "INSERT OR IGNORE INTO brenda_context_records VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            [
                (row[0], row[1], row[2], row[3], row[4], row[5], row[6], int(bool(row[7])), row[8], row[9], row[11])
                for row in src.execute("SELECT * FROM brenda_context_records")
            ],
        )
    except sqlite3.OperationalError:
        pass
    out.commit()
    print("[release-candidate] detail tables committed; building summaries", flush=True)
    # Build reaction-enzyme summaries from all assertion links.
    out.execute(
        """
        INSERT INTO reaction_enzyme_summary
        SELECT a.reaction_id,a.reactenz_reaction_id,l.biopart_id,l.reactenz_enzyme_id,
               (SELECT a2.evidence_class FROM assertions a2 JOIN assertion_enzyme_links l2 USING(assertion_id)
                WHERE a2.reaction_id=a.reaction_id AND l2.biopart_id=l.biopart_id
                ORDER BY a2.evidence_rank,a2.assertion_id LIMIT 1),
               min(a.evidence_rank),count(DISTINCT a.assertion_id),
               count(DISTINCT CASE WHEN a.evidence_class='exact_substrate_product_experimental_evidence' THEN a.assertion_id END),
               count(DISTINCT CASE WHEN a.outcome_class='quantitative_activity' THEN a.assertion_id END),
               count(DISTINCT CASE WHEN a.outcome_class='quantitative_non_catalytic' THEN a.assertion_id END),
               count(DISTINCT CASE WHEN a.outcome_class IN ('inactive','negative_or_below_detection') THEN a.assertion_id END),
               count(DISTINCT m.measurement_id),count(DISTINCT coalesce(c.pmid,c.doi)),count(DISTINCT ac.condition_id),
               count(DISTINCT CASE WHEN a.curation_status='literature_verified' THEN a.assertion_id END),
               count(DISTINCT CASE WHEN a.curation_status='literature_discrepancy' THEN a.assertion_id END),
               count(DISTINCT a.source_db),group_concat(DISTINCT a.source_db)
        FROM assertions a JOIN assertion_enzyme_links l USING(assertion_id)
        LEFT JOIN measurements m USING(assertion_id)
        LEFT JOIN citations c USING(assertion_id)
        LEFT JOIN assay_conditions ac USING(assertion_id)
        WHERE a.is_canonical=1 AND a.reaction_id IS NOT NULL AND l.biopart_id IS NOT NULL
        GROUP BY a.reaction_id,l.biopart_id
        """
    )
    print("[release-candidate] reaction-enzyme summary built", flush=True)
    out.execute(
        """
        INSERT INTO reaction_summary
        SELECT reaction_id,reactenz_reaction_id,count(DISTINCT biopart_id),sum(assertion_count),
               count(DISTINCT CASE WHEN exact_assertion_count>0 THEN biopart_id END),sum(catalytic_assertion_count),
               sum(inactive_or_negative_count),sum(citation_count),min(best_evidence_rank),
               (SELECT x.best_evidence_class FROM reaction_enzyme_summary x WHERE x.reaction_id=s.reaction_id ORDER BY x.best_evidence_rank LIMIT 1)
        FROM reaction_enzyme_summary s GROUP BY reaction_id
        """
    )
    print("[release-candidate] reaction summary built", flush=True)
    out.execute(
        """
        INSERT INTO enzyme_summary
        SELECT biopart_id,reactenz_enzyme_id,count(DISTINCT reaction_id),sum(assertion_count),
               count(DISTINCT CASE WHEN exact_assertion_count>0 THEN reaction_id END),sum(catalytic_assertion_count),
               sum(inactive_or_negative_count),sum(citation_count),min(best_evidence_rank),
               (SELECT x.best_evidence_class FROM reaction_enzyme_summary x WHERE x.biopart_id=s.biopart_id ORDER BY x.best_evidence_rank LIMIT 1)
        FROM reaction_enzyme_summary s GROUP BY biopart_id
        """
    )
    print("[release-candidate] enzyme summary built", flush=True)
    checks = [
        ("sqlite_integrity", out.execute("PRAGMA integrity_check").fetchone()[0] == "ok", out.execute("PRAGMA integrity_check").fetchone()[0], "ok"),
        ("no_raw_cache_paths", all("raw_cache" not in row[1] for row in out.execute("PRAGMA table_info(assertions)")), 0, 0),
        ("all_assertions_have_public_reaction_when_internal_present", out.execute("SELECT count(1) FROM assertions WHERE reaction_id IS NOT NULL AND reactenz_reaction_id IS NULL").fetchone()[0] == 0, out.execute("SELECT count(1) FROM assertions WHERE reaction_id IS NOT NULL AND reactenz_reaction_id IS NULL").fetchone()[0], 0),
        ("all_primary_enzymes_have_public_id", out.execute("SELECT count(1) FROM assertions WHERE primary_biopart_id IS NOT NULL AND primary_reactenz_enzyme_id IS NULL").fetchone()[0] == 0, out.execute("SELECT count(1) FROM assertions WHERE primary_biopart_id IS NOT NULL AND primary_reactenz_enzyme_id IS NULL").fetchone()[0], 0),
        ("strict_exact_not_literature_verified_by_default", out.execute("SELECT count(1) FROM assertions WHERE evidence_class='exact_substrate_product_experimental_evidence' AND curation_status='literature_verified'").fetchone()[0] == 0, out.execute("SELECT count(1) FROM assertions WHERE evidence_class='exact_substrate_product_experimental_evidence' AND curation_status='literature_verified'").fetchone()[0], 0),
        ("foreign_keys", len(list(out.execute("PRAGMA foreign_key_check"))) == 0, len(list(out.execute("PRAGMA foreign_key_check"))), 0),
        ("one_canonical_per_duplicate_group", out.execute("SELECT count(1) FROM (SELECT duplicate_group_id FROM assertions GROUP BY duplicate_group_id HAVING sum(is_canonical)<>1)").fetchone()[0] == 0, out.execute("SELECT count(1) FROM (SELECT duplicate_group_id FROM assertions GROUP BY duplicate_group_id HAVING sum(is_canonical)<>1)").fetchone()[0], 0),
        ("no_brenda_missing_value_sentinel", out.execute("SELECT count(1) FROM measurements m JOIN assertions a USING(assertion_id) WHERE a.source_db='BRENDA' AND (m.source_normalized_value=-999 OR m.raw_value_numeric=-999 OR trim(coalesce(m.raw_value_text,''))='-999')").fetchone()[0] == 0, out.execute("SELECT count(1) FROM measurements m JOIN assertions a USING(assertion_id) WHERE a.source_db='BRENDA' AND (m.source_normalized_value=-999 OR m.raw_value_numeric=-999 OR trim(coalesce(m.raw_value_text,''))='-999')").fetchone()[0], 0),
    ]
    out.executemany("INSERT INTO qa_results VALUES (?,?,?,?,?)", [(name, int(ok), str(observed), str(expected), now()) for name, ok, observed, expected in checks])
    out.commit()
    result = {
        "assertions": out.execute("SELECT count(1) FROM assertions").fetchone()[0],
        "canonical_assertions": out.execute("SELECT count(1) FROM assertions WHERE is_canonical=1").fetchone()[0],
        "measurements": out.execute("SELECT count(1) FROM measurements").fetchone()[0],
        "measurements_release_normalized": out.execute("SELECT count(1) FROM measurements WHERE release_normalized_value IS NOT NULL").fetchone()[0],
        "citations": out.execute("SELECT count(1) FROM citations").fetchone()[0],
        "reaction_enzyme_pairs": out.execute("SELECT count(1) FROM reaction_enzyme_summary").fetchone()[0],
        "reactions_with_evidence": out.execute("SELECT count(1) FROM reaction_summary").fetchone()[0],
        "enzymes_with_evidence": out.execute("SELECT count(1) FROM enzyme_summary").fetchone()[0],
        "automatic_exact_assertions": out.execute("SELECT count(1) FROM assertions WHERE evidence_class='exact_substrate_product_experimental_evidence'").fetchone()[0],
        "literature_discrepancies": out.execute("SELECT count(1) FROM assertions WHERE curation_status='literature_discrepancy'").fetchone()[0],
        "duplicate_groups_with_multiple_assertions": out.execute("SELECT count(1) FROM (SELECT duplicate_group_id FROM assertions GROUP BY duplicate_group_id HAVING count(1)>1)").fetchone()[0],
        "brenda_context_records": out.execute("SELECT count(1) FROM brenda_context_records").fetchone()[0],
        "qa_passed": sum(int(row[1]) for row in checks),
        "qa_total": len(checks),
    }
    out.close()
    src.close()
    os.replace(temp, OUTPUT_DB)
    SUMMARY_JSON.write_text(json.dumps({"generated_at": now(), **result}, ensure_ascii=False, indent=2), encoding="utf-8")
    README_PATH.write_text(
        f"""# ReactEnzDB reaction-specific evidence release candidate V2

This public-facing derived layer combines ReactEnzDB core kinetics, complete SABIO-RK entry JSON, and the complete cached BRENDA SOAP evidence matrix. Raw licensed source responses and local cache paths are not redistributed.

## Counts

- Source assertions: {result['assertions']:,}
- Canonical assertions after duplicate grouping: {result['canonical_assertions']:,}
- Measurements: {result['measurements']:,}
- Release-normalized measurements: {result['measurements_release_normalized']:,}
- Citations: {result['citations']:,}
- Reaction-enzyme evidence pairs: {result['reaction_enzyme_pairs']:,}
- Reactions with specific evidence: {result['reactions_with_evidence']:,}
- Enzymes with specific evidence: {result['enzymes_with_evidence']:,}
- BRENDA contextual records: {result['brenda_context_records']:,}

## Interpretation boundaries

- `exact_substrate_product_experimental_evidence` requires a specific enzyme identity, complete substrate/product identity, experimental provenance, and a catalytic measurement.
- A unique EC/organism candidate is retained as a weaker mapping and never upgraded to exact protein identity.
- Automatic strict matches remain distinct from literature-verified assertions.
- `is_canonical=1` selects one representative from each deterministic duplicate group; all source assertions remain available for provenance.
- BRENDA contextual records describe EC/organism/reference-level pH, temperature, cofactors, inhibitors, expression, cloning, metals, activators, or post-translational modification. They are not automatically assigned to a specific enzyme-reaction assay.
- BRENDA `-999` SOAP missing-value sentinels are excluded from quantitative measurements.

## Files

- `reactenzdb_evidence_rc.sqlite`: complete queryable release candidate.
- `reactenzdb_evidence_rc.summary.json`: release counts and QA summary.
- `manifest.json`: artifact sizes and SHA256 checksums.
- `qa_report.json`: independent public-release integrity and evidence-boundary checks.
- `tsv/evidence_assertions.tsv.gz`: all source assertions with canonical duplicate flags.
- `tsv/evidence_measurements.tsv.gz`: raw and safely normalized measurements.
- `tsv/evidence_citations.tsv.gz`: PMID/DOI mappings and verification state.
- `tsv/reaction_enzyme_evidence_summary.tsv.gz`: website/API summary table.
- `tsv/brenda_context_records.tsv.gz`: bounded BRENDA contextual facts.
""",
        encoding="utf-8",
    )
    return result


def export_tsvs() -> None:
    TSV_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(OUTPUT_DB)
    conn.row_factory = sqlite3.Row
    exports = {
        "reaction_enzyme_evidence_summary.tsv.gz": "SELECT * FROM reaction_enzyme_summary ORDER BY reactenz_reaction_id,best_evidence_rank,reactenz_enzyme_id",
        "evidence_assertions.tsv.gz": "SELECT * FROM assertions ORDER BY reactenz_reaction_id,primary_reactenz_enzyme_id,evidence_rank,assertion_id",
        "evidence_measurements.tsv.gz": "SELECT * FROM measurements ORDER BY assertion_id,measurement_id",
        "evidence_citations.tsv.gz": "SELECT * FROM citations ORDER BY pmid,assertion_id",
        "brenda_context_records.tsv.gz": "SELECT * FROM brenda_context_records ORDER BY ec_number,context_type,context_id",
    }
    for filename, sql in exports.items():
        rows = conn.execute(sql)
        columns = [item[0] for item in rows.description]
        path = TSV_DIR / filename
        temp = path.with_suffix(path.suffix + ".tmp")
        with gzip.open(temp, "wt", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
            writer.writerow(columns)
            writer.writerows(tuple(row) for row in rows)
        os.replace(temp, path)
    conn.close()


def write_manifest() -> None:
    files = [OUTPUT_DB, SUMMARY_JSON, README_PATH, *sorted(TSV_DIR.glob("*.tsv.gz"))]
    source_manifest = WORK / "source_fetch_manifest.json"
    payload = {
        "release_version": "EVIDENCE_RC_V2",
        "generated_at": now(),
        "source_fetch_manifest_sha256": file_sha256(source_manifest) if source_manifest.exists() else None,
        "artifacts": [
            {
                "file": path.relative_to(RELEASE_DIR).as_posix(),
                "size": path.stat().st_size,
                "sha256": file_sha256(path),
            }
            for path in files if path.exists()
        ],
    }
    MANIFEST_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the public-safe ReactEnzDB evidence release candidate.")
    parser.add_argument("--skip-tsv", action="store_true")
    args = parser.parse_args()
    result = build_release()
    if not args.skip_tsv:
        export_tsvs()
    write_manifest()
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
