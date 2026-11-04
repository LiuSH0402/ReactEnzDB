from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
WORK_DIR = ROOT / "evidence_work"
EVIDENCE_DB = WORK_DIR / "enzyme_reaction_evidence.sqlite"
EVIDENCE_SUMMARY = WORK_DIR / "enzyme_reaction_evidence.summary.json"
RAW_DIR = WORK_DIR / "raw" / "brenda"
SEQUENCE_CATALOG = WORK_DIR / "brenda_sequence_catalog.sqlite"
UNIPROT_RE = re.compile(r"\b(?:[A-NR-Z][0-9][A-Z0-9]{3}[0-9]|[OPQ][0-9][A-Z0-9]{3}[0-9])\b")
MUTATION_RE = re.compile(r"\b[A-Z][0-9]{1,5}[A-Z](?:/[A-Z][0-9]{1,5}[A-Z])*\b")
PH_RE = re.compile(r"\bpH\s*([0-9]+(?:\.[0-9]+)?)", re.I)
TEMP_RE = re.compile(r"\b(-?[0-9]+(?:\.[0-9]+)?)\s*(?:°|\?|deg(?:ree)?s?\s*)?C\b", re.I)

# Conservative condition extractors. The temperature pattern rejects residue
# descriptions such as "168 C-terminal", which are not assay temperatures.
SAFE_TEMP_RE = re.compile(r"\b(-?[0-9]+(?:\.[0-9]+)?)\s*(?:(?:°|º|\?)\s*C\b|deg(?:ree)?s?\s*C\b|C(?![-A-Za-z]))", re.I)

KINETIC_OPERATIONS = {
    "getKmValue": ("km", "kmValue", "kmValueMaximum", "mM", "substrate", "substrate"),
    "getTurnoverNumber": ("kcat", "turnoverNumber", "turnoverNumberMaximum", "s^-1", "substrate", "substrate"),
    "getKcatKmValue": ("kcat/km", "kcatKmValue", "kcatKmValueMaximum", "mM^-1 s^-1", "substrate", "substrate"),
    "getSpecificActivity": ("specific_activity", "specificActivity", "specificActivityMaximum", "umol min^-1 mg^-1", None, None),
    "getKiValue": ("ki", "kiValue", "kiValueMaximum", "mM", "inhibitor", "inhibitor"),
    "getIc50Value": ("ic50", "ic50Value", "ic50ValueMaximum", "mM", "inhibitor", "inhibitor"),
}

CONTEXT_OPERATIONS = {
    "getPhOptimum": ("ph_optimum", "phOptimum", "phOptimumMaximum"),
    "getPhRange": ("ph_range", "phRange", "phRangeMaximum"),
    "getTemperatureOptimum": ("temperature_optimum", "temperatureOptimum", "temperatureOptimumMaximum"),
    "getTemperatureRange": ("temperature_range", "temperatureRange", "temperatureRangeMaximum"),
    "getCofactor": ("cofactor", "cofactor", None),
    "getActivatingCompound": ("activating_compound", "activatingCompound", None),
    "getMetalsIons": ("metal_ion", "metalsIons", None),
    "getInhibitors": ("inhibitor", "inhibitor", None),
    "getExpression": ("expression", "expression", None),
    "getCloned": ("cloned", None, None),
    "getPosttranslationalModification": ("posttranslational_modification", "posttranslationalModification", None),
}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def text(value: Any) -> str | None:
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def brenda_value(value: Any) -> str | None:
    """Return a real BRENDA value while excluding SOAP missing-value sentinels."""
    value = text(value)
    if value is None:
        return None
    if value.lower() in {"-999", "-999.0", "n/a", "na", "none", "null", "more", "?"}:
        return None
    return value


def structured_conditions(commentary: Any) -> tuple[float | None, float | None]:
    value = str(commentary or "")
    ph_match = PH_RE.search(value)
    temp_match = SAFE_TEMP_RE.search(value)
    ph = float(ph_match.group(1)) if ph_match else None
    temperature = float(temp_match.group(1)) if temp_match else None
    if ph is not None and not 0 <= ph <= 14:
        ph = None
    if temperature is not None and not -100 <= temperature <= 200:
        temperature = None
    return ph, temperature


def normalize_name(value: Any) -> str:
    value = str(value or "").lower().strip()
    value = value.replace("α", "alpha").replace("β", "beta").replace("γ", "gamma")
    value = re.sub(r"\s+", " ", value)
    return re.sub(r"[^a-z0-9+()' -]", "", value).strip()


def normalize_organism(value: Any) -> str:
    value = re.sub(r"\([^)]*\)", "", str(value or "").lower())
    value = re.sub(r"\b(?:strain|subsp\.?|dsm|atcc|jcm|nrrl|nbro|nbro|nctc)\b.*$", "", value)
    return re.sub(r"[^a-z0-9]", "", value)


def stable_id(operation: str, ec: str, item: dict[str, Any]) -> str:
    canonical = json.dumps(item, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return f"brenda:{operation}:{ec}:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()[:20]}"


def load_payload(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return json.load(handle)


def directory_snapshot_key(ec_dir: Path) -> str:
    """Identify the exact downloaded operation set used by an ingestion pass.

    BRENDA downloads continue while this script runs.  A directory-only status
    key would incorrectly suppress newly arrived operations on the next pass.
    """
    files = sorted((path.name, path.stat().st_size) for path in ec_dir.glob("*.json.gz"))
    digest = hashlib.sha256(json.dumps(files, separators=(",", ":")).encode()).hexdigest()[:16]
    return f"{ec_dir.relative_to(WORK_DIR).as_posix()}@snapshot:{digest}"


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS assertion_enzyme_links (
          assertion_id TEXT NOT NULL, biopart_id TEXT NOT NULL, link_method TEXT NOT NULL,
          source_accession TEXT, is_primary INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY(assertion_id, biopart_id, link_method)
        );
        CREATE TABLE IF NOT EXISTS source_ingestion_status (
          source TEXT NOT NULL, source_file TEXT NOT NULL, status TEXT NOT NULL,
          records_seen INTEGER NOT NULL DEFAULT 0, assertions_inserted INTEGER NOT NULL DEFAULT 0,
          exact_assertions INTEGER NOT NULL DEFAULT 0, error_text TEXT, completed_at TEXT,
          PRIMARY KEY(source, source_file)
        );
        CREATE TABLE IF NOT EXISTS brenda_ligand_mappings (
          ligand_structure_id TEXT NOT NULL, raw_name TEXT NOT NULL, compound_id TEXT,
          mapping_method TEXT NOT NULL, mapping_status TEXT NOT NULL,
          PRIMARY KEY(ligand_structure_id, raw_name)
        );
        CREATE TABLE IF NOT EXISTS brenda_context_records (
          context_id TEXT PRIMARY KEY, operation TEXT NOT NULL, context_type TEXT NOT NULL,
          ec_number TEXT NOT NULL, organism TEXT, value_text TEXT, value_max_text TEXT,
          commentary TEXT, literature_ids_json TEXT NOT NULL, ligand_structure_id TEXT,
          raw_cache_path TEXT NOT NULL, linkage_boundary TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_brenda_context_ec ON brenda_context_records(ec_number,context_type);
        """
    )


def literature_map(files: dict[str, Path]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    path = files.get("getReference")
    if not path:
        return result
    for item in load_payload(path).get("items") or []:
        key = text(item.get("reference"))
        if key and key not in result:
            result[key] = item
    return result


def references(item: dict[str, Any]) -> list[str]:
    values: list[Any] = []
    for key, value in item.items():
        if not str(key).lower().startswith("literature") or value is None:
            continue
        values.extend(value if isinstance(value, list) else re.findall(r"\d+", str(value)))
    return sorted({str(x) for x in values if str(x).strip() not in {"", "0", "None"}})


def enzyme_accession_index(conn: sqlite3.Connection) -> dict[str, list[str]]:
    result: dict[str, list[str]] = defaultdict(list)
    for biopart_id, accession in conn.execute("SELECT biopart_id,uniprot_accession FROM enzymes WHERE uniprot_accession IS NOT NULL"):
        result[str(accession).upper()].append(biopart_id)
    return result


def compound_name_index(conn: sqlite3.Connection) -> dict[str, set[str]]:
    result: dict[str, set[str]] = defaultdict(set)
    for compound_id, name in conn.execute("SELECT DISTINCT compound_id,compound_name FROM reaction_compounds WHERE compound_name IS NOT NULL"):
        result[normalize_name(name)].add(compound_id)
    return result


def reaction_indexes(conn: sqlite3.Connection) -> tuple[dict[str, list[str]], dict[str, dict[str, set[str]]]]:
    by_ec: dict[str, list[str]] = defaultdict(list)
    sides: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    for reaction_id, ec in conn.execute("SELECT reaction_id,ec_number FROM reactions"):
        for part in re.findall(r"\d+\.\d+\.\d+\.\d+", str(ec or "")):
            by_ec[part].append(reaction_id)
    for rid, cid, side in conn.execute("SELECT reaction_id,compound_id,side FROM reaction_compounds"):
        sides[rid][str(side or "")].add(cid)
    return by_ec, sides


def split_equation(value: str | None) -> tuple[list[str], list[str]]:
    if not value:
        return [], []
    parts = re.split(r"\s*(?:<=>|=>|->|=)\s*", value, maxsplit=1)
    if len(parts) != 2:
        return [], []
    split_side = lambda side: [x.strip() for x in re.split(r"\s+\+\s+", side) if x.strip()]
    return split_side(parts[0]), split_side(parts[1])


def map_names(names: list[str], name_index: dict[str, set[str]]) -> tuple[set[str], list[dict[str, Any]], bool]:
    mapped: set[str] = set()
    audit: list[dict[str, Any]] = []
    all_unique = bool(names)
    for name in names:
        candidates = name_index.get(normalize_name(name), set())
        audit.append({"raw_name": name, "candidates": sorted(candidates)})
        if len(candidates) == 1:
            mapped.update(candidates)
        else:
            all_unique = False
    return mapped, audit, all_unique


def map_full_reaction(ec: str, left_names: list[str], right_names: list[str], name_index: dict[str, set[str]], by_ec: dict[str, list[str]], sides: dict[str, dict[str, set[str]]]) -> tuple[str | None, str, dict[str, Any], list[tuple[str, str, str | None, str]]]:
    left, left_audit, left_ok = map_names(left_names, name_index)
    right, right_audit, right_ok = map_names(right_names, name_index)
    matches: list[tuple[str, str]] = []
    for rid in by_ec.get(ec, []):
        rs = sides.get(rid, {})
        if left_ok and right_ok and left == rs.get("left", set()) and right == rs.get("right", set()):
            matches.append((rid, "same_direction"))
        elif left_ok and right_ok and left == rs.get("right", set()) and right == rs.get("left", set()):
            matches.append((rid, "reverse_direction"))
    detail = {"left": left_audit, "right": right_audit, "matches": matches}
    links = [("substrate", raw, next(iter(name_index.get(normalize_name(raw), [])), None), "exact_normalized_name" if len(name_index.get(normalize_name(raw), [])) == 1 else "unmapped_or_ambiguous") for raw in left_names]
    links += [("product", raw, next(iter(name_index.get(normalize_name(raw), [])), None), "exact_normalized_name" if len(name_index.get(normalize_name(raw), [])) == 1 else "unmapped_or_ambiguous") for raw in right_names]
    if len(matches) == 1:
        return matches[0][0], "exact_complete_participant_set", detail, links
    return None, "ambiguous_or_unmapped_participant_set", detail, links


def explicit_accessions(item: dict[str, Any], accession_index: dict[str, list[str]]) -> list[tuple[str, str]]:
    blob = " ".join(str(item.get(key) or "") for key in ("commentary", "engineering", "firstAccessionCode"))
    result = []
    for accession in sorted(set(UNIPROT_RE.findall(blob.upper()))):
        result.extend((biopart, accession) for biopart in accession_index.get(accession, []))
    return sorted(set(result))


def mutation_status(item: dict[str, Any]) -> tuple[str, str | None, list[str]]:
    blob = " ".join(str(item.get(k) or "") for k in ("engineering", "commentary"))
    mutations = sorted(set(MUTATION_RE.findall(blob.upper())))
    if mutations or re.search(r"\bmutant\b", blob, re.I):
        return "mutant", "/".join(mutations) or text(item.get("engineering")), mutations
    if re.search(r"\bwild[- ]?type\b|\bwild type\b", blob, re.I):
        return "wild_type", None, []
    return "not_reported", None, []


def outcome(item: dict[str, Any], quantitative: bool) -> str:
    blob = " ".join(str(item.get(k) or "") for k in ("commentary", "engineering"))
    if re.search(r"\b(no|without) (?:detectable )?activity\b|\binactive\b|complete loss of activity", blob, re.I):
        return "inactive"
    if re.search(r"below (?:the )?detection|almost complete loss|strong decrease in activity|no conversion", blob, re.I):
        return "negative_or_below_detection"
    return "quantitative_activity" if quantitative else "qualitative_active"


def add_citations(conn: sqlite3.Connection, assertion_id: str, refs: list[str], refmap: dict[str, dict[str, Any]]) -> int:
    count = 0
    for ref in refs:
        record = refmap.get(ref, {})
        pmid = text(record.get("pubmedId"))
        conn.execute(
            "INSERT OR IGNORE INTO citations VALUES (?,?,?,?,?,?,?,?,?)",
            (assertion_id, pmid, None, text(record.get("title")), text(record.get("journal")), record.get("year"), f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else None, "not_checked", "not_checked"),
        )
        count += int(bool(pmid))
    return count


def add_compounds(conn: sqlite3.Connection, assertion_id: str, links: list[tuple[str, str, str | None, str]], ligand_id: Any = None) -> None:
    for role, raw, compound_id, method in links:
        conn.execute(
            "INSERT OR IGNORE INTO assertion_compounds VALUES (?,?,?,?,?,?,?,?,?)",
            (assertion_id, role, raw, compound_id, None, None, method, None, int(method.startswith("exact_"))),
        )
        if ligand_id is not None:
            conn.execute(
                "INSERT OR REPLACE INTO brenda_ligand_mappings VALUES (?,?,?,?,?)",
                (str(ligand_id), raw, compound_id, method, "unique" if compound_id else "unmapped_or_ambiguous"),
            )


def insert_form(conn: sqlite3.Connection, form_id: str, source_id: str, item: dict[str, Any], enzyme_links: list[tuple[str, str]]) -> None:
    wild, mutation, mutations = mutation_status(item)
    accession = enzyme_links[0][1] if enzyme_links else text(item.get("firstAccessionCode"))
    sequence = text(item.get("sequence"))
    seqhash = hashlib.sha256("".join(sequence.split()).upper().encode()).hexdigest() if sequence else None
    conn.execute(
        "INSERT OR IGNORE INTO enzyme_forms VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (form_id, enzyme_links[0][0] if enzyme_links else None, "BRENDA", source_id, text(item.get("organism")), wild, mutation, json.dumps(mutations), accession, seqhash, "exact_accession" if enzyme_links else "protein_identity_not_reported"),
    )


def insert_assertion(conn: sqlite3.Connection, assertion_id: str, ec: str, operation: str, item: dict[str, Any], raw_path: Path, refmap: dict[str, dict[str, Any]], accession_index: dict[str, list[str]], reaction_id: str | None, reaction_status: str, reaction_detail: dict[str, Any], compound_links: list[tuple[str, str, str | None, str]], quantitative: bool, measurement: tuple[str, str | None, str | None, str] | None = None) -> tuple[int, int]:
    if conn.execute("SELECT 1 FROM experimental_assertions WHERE assertion_id=?", (assertion_id,)).fetchone():
        add_citations(conn, assertion_id, references(item), refmap)
        conn.execute(
            "UPDATE experimental_assertions SET pmid_count=(SELECT count(1) FROM citations c WHERE c.assertion_id=? AND c.pmid IS NOT NULL AND trim(c.pmid)<>'') WHERE assertion_id=?",
            (assertion_id, assertion_id),
        )
        return 0, 0
    enzyme_links = explicit_accessions(item, accession_index)
    refs = references(item)
    form_id = assertion_id + ":form"
    insert_form(conn, form_id, assertion_id, item, enzyme_links)
    pmid_count = sum(bool(text(refmap.get(ref, {}).get("pubmedId"))) for ref in refs)
    full_sets = reaction_status == "exact_complete_participant_set"
    # BRENDA assay records usually identify an organism, not a particular protein accession.
    # Therefore an exact evidence tier is only possible when an accession is explicit too.
    # Unique normalized-name mapping can identify the same internal reaction,
    # but it is not an independent exact-structure crosswalk.  BRENDA records
    # therefore remain below the strict exact substrate/product tier.
    exact = False
    ev_class = "same_reaction_identifier_evidence" if full_sets else "same_ec_different_substrate"
    label = {"exact_substrate_product_experimental_evidence": "Exact substrate/product experimental evidence", "same_reaction_identifier_evidence": "Same reaction identifier evidence", "same_ec_different_substrate": "Same EC but different or unresolved substrate"}[ev_class]
    score = 70.0 if full_sets else 35.0
    ph, temperature = structured_conditions(item.get("commentary"))
    details = {"rule_id": "BRENDA_COMPLETE_SOAP_CONSERVATIVE_V2", "reaction_mapping": reaction_detail, "explicit_accessions": [a for _, a in enzyme_links], "brenda_literature_ids": refs, "unique_name_mapping_is_not_exact_structure_evidence": True}
    conn.execute(
        "INSERT INTO experimental_assertions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (assertion_id, "BRENDA", assertion_id, ec, reaction_id, enzyme_links[0][0] if enzyme_links else None, form_id, ev_class, label, outcome(item, quantitative), 1, "exact_accession" if enzyme_links else "organism_only_or_unresolved", reaction_status, "unique_normalized_name_to_internal_compound_set" if full_sets else "partial_or_unmapped", "unique_normalized_name_to_internal_compound_set" if full_sets else "partial_or_unmapped", score, "needs_literature_review", pmid_count, int(quantitative), int(bool(ph is not None or temperature is not None or item.get("commentary"))), "https://www.brenda-enzymes.org/enzyme.php?ecno=" + ec, raw_path.relative_to(WORK_DIR).as_posix(), json.dumps(details, ensure_ascii=False), now()),
    )
    add_compounds(conn, assertion_id, compound_links, item.get("ligandStructureId"))
    if measurement:
        ptype, value, vmax, unit = measurement
        raw = value if vmax is None else f"{value} to {vmax}"
        try:
            numeric = float(value) if value is not None else None
        except ValueError:
            numeric = None
        subject = text(item.get("substrate") or item.get("inhibitor"))
        conn.execute("INSERT INTO measurements VALUES (?,?,?,?,?,?,?,?,?,?)", (assertion_id + ":measurement", assertion_id, ptype, raw, numeric, unit, None, None, "source_unit_not_independently_verified", subject))
    conn.execute("INSERT INTO assay_conditions VALUES (?,?,?,?,?,?,?,?)", (assertion_id + ":condition", assertion_id, ph, temperature, None, None, json.dumps({"commentary": item.get("commentary")}, ensure_ascii=False), "bounded_regex_from_BRENDA_commentary"))
    add_citations(conn, assertion_id, refs, refmap)
    for i, (biopart, accession) in enumerate(enzyme_links):
        conn.execute("INSERT OR IGNORE INTO assertion_enzyme_links VALUES (?,?,?,?,?)", (assertion_id, biopart, "explicit_accession", accession, int(i == 0)))
    return 1, int(exact)


def insert_context_records(conn: sqlite3.Connection, ec: str, files: dict[str, Path]) -> int:
    inserted = 0
    for operation, (context_type, value_key, max_key) in CONTEXT_OPERATIONS.items():
        path = files.get(operation)
        if not path:
            continue
        for item in load_payload(path).get("items") or []:
            context_id = stable_id(operation, ec, item)
            value = "reported" if value_key is None else brenda_value(item.get(value_key))
            value_max = brenda_value(item.get(max_key)) if max_key else None
            before = conn.total_changes
            conn.execute(
                "INSERT OR IGNORE INTO brenda_context_records VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    context_id, operation, context_type, ec, text(item.get("organism")), value, value_max,
                    text(item.get("commentary")), json.dumps(references(item), ensure_ascii=False),
                    text(item.get("ligandStructureId")), path.relative_to(WORK_DIR).as_posix(),
                    "EC/organism/reference context; not automatically assigned to a specific enzyme-reaction assay",
                    now(),
                ),
            )
            inserted += int(conn.total_changes > before)
    return inserted


def import_sequence_catalog_forms(conn: sqlite3.Connection) -> int:
    """Import only sequence identities already mapped exactly to ReactEnzDB.

    Parsing all 13.5 million BRENDA sequence occurrences into the evidence DB
    would duplicate the dedicated catalog and obscure the assay evidence layer.
    """
    if not SEQUENCE_CATALOG.exists():
        return 0
    before = conn.total_changes
    conn.execute("ATTACH DATABASE ? AS brenda_catalog", (str(SEQUENCE_CATALOG),))
    try:
        conn.execute(
            """
            INSERT OR IGNORE INTO enzyme_forms
            SELECT 'brenda-sequence:'||replace(i.identity_key,':','_')||':'||m.biopart_id,
                   m.biopart_id,'BRENDA',i.identity_key,i.organism,'not_reported',NULL,'[]',
                   i.first_accession,i.sequence_sha256,
                   CASE WHEN max(m.match_method='exact_accession_and_sequence')=1
                        THEN 'sequence_catalog_exact_accession_and_sequence'
                        WHEN max(m.match_method='exact_accession')=1
                        THEN 'sequence_catalog_exact_accession'
                        ELSE 'sequence_catalog_exact_sequence' END
            FROM brenda_catalog.brenda_identities i
            JOIN brenda_catalog.reactenz_exact_mappings m USING(identity_key)
            GROUP BY i.identity_key,m.biopart_id
            """
        )
        conn.commit()
    finally:
        conn.execute("DETACH DATABASE brenda_catalog")
    return conn.total_changes - before


def clean_brenda_missing_value_sentinels(conn: sqlite3.Connection) -> int:
    affected = [
        row[0] for row in conn.execute(
            """
            SELECT m.measurement_id FROM measurements m
            JOIN experimental_assertions a USING(assertion_id)
            WHERE a.source_db='BRENDA'
              AND (m.raw_value_numeric=-999 OR trim(coalesce(m.raw_value_text,'')) IN ('-999','-999.0'))
            """
        )
    ]
    if affected:
        conn.executemany("DELETE FROM measurements WHERE measurement_id=?", [(item,) for item in affected])
        conn.execute(
            """
            UPDATE experimental_assertions
            SET has_quantitative_measurement=EXISTS(SELECT 1 FROM measurements m WHERE m.assertion_id=experimental_assertions.assertion_id),
                outcome_class=CASE
                  WHEN outcome_class='quantitative_activity'
                   AND NOT EXISTS(SELECT 1 FROM measurements m WHERE m.assertion_id=experimental_assertions.assertion_id)
                  THEN 'qualitative_active' ELSE outcome_class END
            WHERE source_db='BRENDA'
            """
        )
    return len(affected)


def clean_brenda_structured_conditions(conn: sqlite3.Connection) -> int:
    """Reparse bounded pH/temperature fields while retaining raw commentary."""
    rows = conn.execute(
        """
        SELECT c.condition_id, c.condition_text
        FROM assay_conditions c
        JOIN experimental_assertions a ON a.assertion_id=c.assertion_id
        WHERE a.source_db='BRENDA'
        """
    ).fetchall()
    updates: list[tuple[float | None, float | None, str]] = []
    for condition_id, condition_text in rows:
        commentary = None
        try:
            payload = json.loads(condition_text or "{}")
            commentary = payload.get("commentary") if isinstance(payload, dict) else None
        except (TypeError, ValueError, json.JSONDecodeError):
            commentary = None
        ph, temperature = structured_conditions(commentary)
        updates.append((ph, temperature, condition_id))
    conn.executemany(
        """
        UPDATE assay_conditions
        SET ph=?, temperature_c=?, extraction_method='bounded_regex_from_BRENDA_commentary'
        WHERE condition_id=?
        """,
        updates,
    )
    return len(updates)


def enforce_brenda_reaction_mapping_boundary(conn: sqlite3.Connection) -> int:
    before = conn.total_changes
    conn.execute(
        """
        UPDATE experimental_assertions
        SET evidence_class=CASE WHEN reaction_id IS NOT NULL THEN 'same_reaction_identifier_evidence' ELSE evidence_class END,
            display_evidence_label=CASE WHEN reaction_id IS NOT NULL THEN 'Same reaction identifier evidence' ELSE display_evidence_label END,
            substrate_identity_status=CASE WHEN substrate_identity_status='exact_structure_set' THEN 'unique_normalized_name_to_internal_compound_set' ELSE substrate_identity_status END,
            product_identity_status=CASE WHEN product_identity_status='exact_structure_set' THEN 'unique_normalized_name_to_internal_compound_set' ELSE product_identity_status END,
            mapping_score=CASE WHEN reaction_id IS NOT NULL AND mapping_score>70 THEN 70 ELSE mapping_score END,
            curation_status=CASE WHEN curation_status='automatic_strict_exact' THEN 'needs_literature_review' ELSE curation_status END
        WHERE source_db='BRENDA'
        """
    )
    return conn.total_changes - before


def map_unique_ec_organism_candidates(conn: sqlite3.Connection) -> int:
    """Map BRENDA records only when the core has one EC/organism candidate.

    This is deliberately weaker than accession identity and never upgrades an
    assertion to the strict exact-enzyme evidence tier.
    """
    candidates: dict[tuple[str, str], set[str]] = defaultdict(set)
    for ec, biopart_id, organism in conn.execute(
        """
        SELECT DISTINCT a.source_ec_number,a.biopart_id,e.organism
        FROM experimental_assertions a JOIN enzymes e USING(biopart_id)
        WHERE a.source_db LIKE 'ReactEnzDB-core:%' AND a.source_ec_number IS NOT NULL
          AND a.biopart_id IS NOT NULL AND e.organism IS NOT NULL
          AND e.reactenz_enzyme_id NOT LIKE 'UNMAPPED:%'
        """
    ):
        candidates[(str(ec), normalize_organism(organism))].add(str(biopart_id))
    unique = {key: next(iter(values)) for key, values in candidates.items() if key[1] and len(values) == 1}
    updates = []
    links = []
    forms = []
    for assertion_id, ec, form_id, organism, score in conn.execute(
        """
        SELECT a.assertion_id,a.source_ec_number,a.enzyme_form_id,f.organism,a.mapping_score
        FROM experimental_assertions a LEFT JOIN enzyme_forms f USING(enzyme_form_id)
        WHERE a.source_db='BRENDA' AND a.biopart_id IS NULL AND a.source_ec_number IS NOT NULL
        """
    ):
        biopart_id = unique.get((str(ec), normalize_organism(organism)))
        if not biopart_id:
            continue
        updates.append((biopart_id, min(float(score or 65.0), 65.0), assertion_id))
        links.append((assertion_id, biopart_id, "unique_ec_organism_core_candidate", None, 1))
        if form_id:
            forms.append((biopart_id, form_id))
    conn.executemany(
        "UPDATE experimental_assertions SET biopart_id=?,enzyme_identity_status='unique_core_candidate_for_ec_and_normalized_organism',mapping_score=? WHERE assertion_id=?",
        updates,
    )
    conn.executemany("INSERT OR IGNORE INTO assertion_enzyme_links VALUES (?,?,?,?,?)", links)
    conn.executemany(
        "UPDATE enzyme_forms SET biopart_id=?,identity_status='unique_core_candidate_for_ec_and_normalized_organism' WHERE enzyme_form_id=? AND biopart_id IS NULL",
        forms,
    )
    return len(updates)


def write_evidence_summary(conn: sqlite3.Connection, run_totals: Counter) -> None:
    summary = {
        "generated_at": now(),
        "database": EVIDENCE_DB.name,
        "assertions": conn.execute("SELECT count(1) FROM experimental_assertions").fetchone()[0],
        "measurements": conn.execute("SELECT count(1) FROM measurements").fetchone()[0],
        "citations": conn.execute("SELECT count(1) FROM citations").fetchone()[0],
        "assay_conditions": conn.execute("SELECT count(1) FROM assay_conditions").fetchone()[0],
        "enzyme_forms": conn.execute("SELECT count(1) FROM enzyme_forms").fetchone()[0],
        "brenda_context_records": conn.execute("SELECT count(1) FROM brenda_context_records").fetchone()[0],
        "by_source": [
            {"source_db": row[0], "assertions": row[1], "quantitative": row[2], "with_pmid": row[3]}
            for row in conn.execute(
                "SELECT source_db,count(1),sum(has_quantitative_measurement),sum(pmid_count>0) FROM experimental_assertions GROUP BY source_db ORDER BY source_db"
            )
        ],
        "brenda_mapping": {
            "assertions_with_reaction": conn.execute("SELECT count(1) FROM experimental_assertions WHERE source_db='BRENDA' AND reaction_id IS NOT NULL").fetchone()[0],
            "assertions_with_enzyme": conn.execute("SELECT count(1) FROM experimental_assertions WHERE source_db='BRENDA' AND biopart_id IS NOT NULL").fetchone()[0],
            "assertions_with_reaction_and_enzyme": conn.execute("SELECT count(1) FROM experimental_assertions WHERE source_db='BRENDA' AND reaction_id IS NOT NULL AND biopart_id IS NOT NULL").fetchone()[0],
            "automatic_exact": conn.execute("SELECT count(1) FROM experimental_assertions WHERE source_db='BRENDA' AND evidence_class='exact_substrate_product_experimental_evidence'").fetchone()[0],
        },
        "ingestion_errors": conn.execute("SELECT count(1) FROM source_ingestion_status WHERE status='error'").fetchone()[0],
        "last_run": dict(run_totals),
    }
    temp = EVIDENCE_SUMMARY.with_suffix(".json.tmp")
    temp.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(EVIDENCE_SUMMARY)


def ingest_ec(conn: sqlite3.Connection, ec_dir: Path, accession_index: dict[str, list[str]], name_index: dict[str, set[str]], by_ec: dict[str, list[str]], sides: dict[str, dict[str, set[str]]]) -> Counter:
    ec = ec_dir.name.removeprefix("EC_")
    files = {path.name.removesuffix(".json.gz"): path for path in ec_dir.glob("*.json.gz")}
    refmap = literature_map(files)
    stats = Counter()
    # Sequence records are handled once by brenda_sequence_catalog.sqlite.
    for operation, (ptype, value_key, max_key, unit, subject_key, subject_role) in KINETIC_OPERATIONS.items():
        path = files.get(operation)
        if not path:
            continue
        for item in load_payload(path).get("items") or []:
            stats["seen"] += 1
            subject = text(item.get(subject_key)) if subject_key else None
            mapped, audit, unique = map_names([subject] if subject else [], name_index)
            compound_links = [(subject_role, subject, next(iter(mapped), None), "exact_normalized_name" if unique else "unmapped_or_ambiguous")] if subject and subject_role else []
            aid = stable_id(operation, ec, item)
            value = brenda_value(item.get(value_key))
            value_max = brenda_value(item.get(max_key))
            has_measurement = bool(value or value_max)
            inserted, exact = insert_assertion(conn, aid, ec, operation, item, path, refmap, accession_index, None, "ec_only_no_complete_product_set", {"subject_mapping": audit}, compound_links, has_measurement, (ptype, value, value_max, unit) if has_measurement else None)
            stats.update(inserted=inserted, exact=exact)
    for operation, left_key, right_key in (("getSubstratesProducts", "substrates", "products"), ("getNaturalSubstratesProducts", "naturalSubstrates", "naturalProducts"), ("getReaction", "reaction", "reaction")):
        path = files.get(operation)
        if not path:
            continue
        for item in load_payload(path).get("items") or []:
            stats["seen"] += 1
            if operation == "getReaction":
                left_names, right_names = split_equation(text(item.get("reaction")))
            else:
                left_names = [x.strip() for x in re.split(r"\s+\+\s+", str(item.get(left_key) or "")) if x.strip()]
                right_names = [x.strip() for x in re.split(r"\s+\+\s+", str(item.get(right_key) or "")) if x.strip()]
            rid, status, detail, links = map_full_reaction(ec, left_names, right_names, name_index, by_ec, sides)
            aid = stable_id(operation, ec, item)
            inserted, exact = insert_assertion(conn, aid, ec, operation, item, path, refmap, accession_index, rid, status, detail, links, False)
            stats.update(inserted=inserted, exact=exact)
    path = files.get("getEngineering")
    if path:
        for item in load_payload(path).get("items") or []:
            stats["seen"] += 1
            aid = stable_id("getEngineering", ec, item)
            inserted, exact = insert_assertion(conn, aid, ec, "getEngineering", item, path, refmap, accession_index, None, "ec_only_engineering_record", {}, [], False)
            stats.update(inserted=inserted, exact=exact)
    stats["context"] += insert_context_records(conn, ec, files)
    return stats


def refresh_existing_citations(conn: sqlite3.Connection, ec_dir: Path) -> Counter:
    ec = ec_dir.name.removeprefix("EC_")
    files = {path.name.removesuffix(".json.gz"): path for path in ec_dir.glob("*.json.gz")}
    refmap = literature_map(files)
    stats = Counter()
    operations = [*KINETIC_OPERATIONS, "getSubstratesProducts", "getNaturalSubstratesProducts", "getReaction", "getEngineering"]
    for operation in operations:
        path = files.get(operation)
        if not path:
            continue
        for item in load_payload(path).get("items") or []:
            assertion_id = stable_id(operation, ec, item)
            if not conn.execute("SELECT 1 FROM experimental_assertions WHERE assertion_id=?", (assertion_id,)).fetchone():
                continue
            add_citations(conn, assertion_id, references(item), refmap)
            conn.execute(
                "UPDATE experimental_assertions SET pmid_count=(SELECT count(1) FROM citations c WHERE c.assertion_id=? AND c.pmid IS NOT NULL AND trim(c.pmid)<>'') WHERE assertion_id=?",
                (assertion_id, assertion_id),
            )
            stats["refreshed_assertions"] += 1
    for operation in CONTEXT_OPERATIONS:
        path = files.get(operation)
        if not path:
            continue
        for item in load_payload(path).get("items") or []:
            context_id = stable_id(operation, ec, item)
            conn.execute(
                "UPDATE brenda_context_records SET literature_ids_json=? WHERE context_id=?",
                (json.dumps(references(item), ensure_ascii=False), context_id),
            )
            stats["refreshed_context_records"] += 1
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest complete cached BRENDA SOAP responses conservatively.")
    parser.add_argument("--limit-ecs", type=int)
    parser.add_argument("--ec")
    parser.add_argument("--refresh-status", action="store_true")
    parser.add_argument("--refresh-existing-only", action="store_true")
    parser.add_argument("--postprocess-only", action="store_true")
    parser.add_argument("--commit-every", type=int, default=25)
    args = parser.parse_args()
    if not EVIDENCE_DB.exists():
        raise FileNotFoundError(EVIDENCE_DB)
    conn = sqlite3.connect(EVIDENCE_DB)
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA cache_size=-262144")
    ensure_schema(conn)
    dirs = sorted(RAW_DIR.glob("EC_*"))
    if args.ec:
        dirs = [RAW_DIR / f"EC_{args.ec}"]
    if args.limit_ecs:
        dirs = dirs[:args.limit_ecs]
    totals = Counter()
    if args.postprocess_only:
        totals["removed_missing_value_sentinels"] = clean_brenda_missing_value_sentinels(conn)
        totals["reparsed_structured_conditions"] = clean_brenda_structured_conditions(conn)
        totals["reaction_mapping_boundary_corrections"] = enforce_brenda_reaction_mapping_boundary(conn)
        totals["unique_ec_organism_candidates"] = map_unique_ec_organism_candidates(conn)
        conn.commit()
        write_evidence_summary(conn, totals)
        print(json.dumps(dict(totals), indent=2), flush=True)
        print("integrity:", conn.execute("PRAGMA quick_check").fetchone()[0], flush=True)
        conn.close()
        return
    if args.refresh_existing_only:
        for index, ec_dir in enumerate(dirs, 1):
            totals.update(refresh_existing_citations(conn, ec_dir))
            if index % max(1, args.commit_every) == 0:
                conn.commit()
            if index == 1 or index % 100 == 0:
                print(f"[brenda-refresh] {index}/{len(dirs)} EC dirs; assertions={totals['refreshed_assertions']:,}", flush=True)
        conn.commit()
        totals["removed_missing_value_sentinels"] = clean_brenda_missing_value_sentinels(conn)
        totals["reparsed_structured_conditions"] = clean_brenda_structured_conditions(conn)
        totals["reaction_mapping_boundary_corrections"] = enforce_brenda_reaction_mapping_boundary(conn)
        totals["unique_ec_organism_candidates"] = map_unique_ec_organism_candidates(conn)
        conn.commit()
        write_evidence_summary(conn, totals)
        print(json.dumps(dict(totals), indent=2), flush=True)
        print("integrity:", conn.execute("PRAGMA quick_check").fetchone()[0], flush=True)
        conn.close()
        return
    accession_index = enzyme_accession_index(conn)
    name_index = compound_name_index(conn)
    by_ec, sides = reaction_indexes(conn)
    for index, ec_dir in enumerate(dirs, 1):
        key = directory_snapshot_key(ec_dir)
        done = conn.execute("SELECT status FROM source_ingestion_status WHERE source='BRENDA' AND source_file=?", (key,)).fetchone()
        if done and done[0] == "done" and not args.refresh_status:
            continue
        conn.execute("SAVEPOINT brenda_ec")
        try:
            stats = ingest_ec(conn, ec_dir, accession_index, name_index, by_ec, sides)
            conn.execute("INSERT OR REPLACE INTO source_ingestion_status VALUES ('BRENDA',?,'done',?,?,?,NULL,?)", (key, stats["seen"], stats["inserted"], stats["exact"], now()))
            conn.execute("RELEASE SAVEPOINT brenda_ec")
            totals.update(stats)
            totals["ecs"] += 1
        except Exception as exc:
            conn.execute("ROLLBACK TO SAVEPOINT brenda_ec")
            conn.execute("RELEASE SAVEPOINT brenda_ec")
            conn.execute("INSERT OR REPLACE INTO source_ingestion_status VALUES ('BRENDA',?,'error',0,0,0,?,?)", (key, str(exc)[:1000], now()))
            print(f"[brenda-ingest] ERROR {key}: {exc}", flush=True)
        if index % max(1, args.commit_every) == 0:
            conn.commit()
        if index == 1 or index % 25 == 0:
            print(f"[brenda-ingest] {index}/{len(dirs)} EC dirs; inserted={totals['inserted']:,} exact={totals['exact']:,}", flush=True)
    conn.commit()
    removed_sentinels = clean_brenda_missing_value_sentinels(conn)
    reparsed_conditions = clean_brenda_structured_conditions(conn)
    boundary_corrections = enforce_brenda_reaction_mapping_boundary(conn)
    mapped_unique_candidates = map_unique_ec_organism_candidates(conn)
    conn.commit()
    imported_forms = import_sequence_catalog_forms(conn)
    totals["removed_missing_value_sentinels"] = removed_sentinels
    totals["reparsed_structured_conditions"] = reparsed_conditions
    totals["reaction_mapping_boundary_corrections"] = boundary_corrections
    totals["unique_ec_organism_candidates"] = mapped_unique_candidates
    totals["sequence_catalog_forms"] = imported_forms
    write_evidence_summary(conn, totals)
    print(json.dumps(dict(totals), indent=2), flush=True)
    print("integrity:", conn.execute("PRAGMA integrity_check").fetchone()[0], flush=True)
    conn.close()


if __name__ == "__main__":
    main()
