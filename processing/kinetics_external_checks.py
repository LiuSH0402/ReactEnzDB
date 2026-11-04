"""Offline extraction from ReactEnzDB/scripts/enrich_kinetics_external_checks.py.
Acquisition functions and the original acquisition CLI are omitted.
Local processing rules are retained; see docs/PROCESSING.md.
"""
from __future__ import annotations
import urllib.parse

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import argparse

import hashlib

import json

import math

import os

import re

import sqlite3

import time

from collections import defaultdict

from pathlib import Path

from typing import Any

ROOT = Path(__file__).resolve().parents[1]

DEFAULT_WEB_DB = ROOT / "web_release" / "reactenzdb_web.db"

SABIO_BASE = "https://sabiork.h-its.org/export-api/sabio/kinlaw-entry/json"

BRENDA_WSDL = "https://www.brenda-enzymes.org/soap/brenda_zeep.wsdl"

BRENDA_EC_URL = "https://www.brenda-enzymes.org/enzyme.php?ecno={ec_number}"

PARAMETER_MAP = {
    "km": "km",
    "k_m": "km",
    "kcat": "kcat",
    "turnover number": "kcat",
    "kcat/km": "kcat_km",
    "specificity constant": "kcat_km",
    "vmax": "vmax",
    "v_max": "vmax",
}

UNIT_RE = re.compile(r"\b(uM|µM|μM|mM|M|min\^-1|min\\^-1|min\\(-1\\)|s\^-1|s\\^-1|s\\(-1\\))\b", re.I)

WORD_RE = re.compile(r"[A-Za-z0-9]+")

BRENDA_METHODS = {
    "km": {
        "method": "getKmValue",
        "value": "kmValue",
        "maximum": "kmValueMaximum",
        "unit": "mM",
        "fields": ("kmValue*", "kmValueMaximum*", "substrate*", "commentary*", "ligandStructureId*", "literature*"),
    },
    "kcat": {
        "method": "getTurnoverNumber",
        "value": "turnoverNumber",
        "maximum": "turnoverNumberMaximum",
        "unit": "s^-1",
        "fields": ("turnoverNumber*", "turnoverNumberMaximum*", "substrate*", "commentary*", "ligandStructureId*", "literature*"),
    },
    "kcat_km": {
        "method": "getKcatKmValue",
        "value": "kcatKmValue",
        "maximum": "kcatKmValueMaximum",
        "unit": "mM^-1 s^-1",
        "fields": ("kcatKmValue*", "kcatKmValueMaximum*", "substrate*", "commentary*", "ligandStructureId*", "literature*"),
    },
}

BRENDA_ATTRIBUTE_METHODS = {
    "optimum_ph": {
        "method": "getPhOptimum",
        "value": "phOptimum",
        "maximum": "phOptimumMaximum",
        "unit": "pH",
        "fields": ("phOptimum*", "phOptimumMaximum*", "commentary*", "literature*"),
    },
    "optimum_temperature": {
        "method": "getTemperatureOptimum",
        "value": "temperatureOptimum",
        "maximum": "temperatureOptimumMaximum",
        "unit": "degC",
        "fields": ("temperatureOptimum*", "temperatureOptimumMaximum*", "commentary*", "literature*"),
    },
}

def connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA temp_store = MEMORY")
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn

def log(message: str) -> None:
    print(message, flush=True)

def setup_tables(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS web_external_kinetics (
          external_kinetic_id TEXT PRIMARY KEY,
          source_db TEXT NOT NULL,
          external_entry_id TEXT NOT NULL,
          ec_number TEXT,
          parameter_type TEXT,
          parameter_name TEXT,
          value_numeric REAL,
          value_end REAL,
          unit TEXT,
          normalized_value REAL,
          normalized_unit TEXT,
          substrate TEXT,
          organism TEXT,
          taxonomy_id TEXT,
          ph REAL,
          temperature REAL,
          pubmed_id TEXT,
          title TEXT,
          source_url TEXT,
          raw_json TEXT
        );

        CREATE TABLE IF NOT EXISTS web_kinetic_external_checks (
          check_id INTEGER PRIMARY KEY AUTOINCREMENT,
          kinetic_id TEXT NOT NULL,
          source_db TEXT NOT NULL,
          match_status TEXT NOT NULL,
          match_score INTEGER NOT NULL DEFAULT 0,
          match_reason TEXT,
          external_kinetic_id TEXT,
          external_entry_id TEXT,
          ec_number TEXT,
          external_parameter_type TEXT,
          external_value_numeric REAL,
          external_unit TEXT,
          external_normalized_value REAL,
          external_normalized_unit TEXT,
          external_substrate TEXT,
          external_organism TEXT,
          external_ph REAL,
          external_temperature REAL,
          external_pubmed_id TEXT,
          source_url TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS web_kinetic_external_source_status (
          source_db TEXT NOT NULL,
          ec_number TEXT NOT NULL,
          status TEXT NOT NULL,
          fetched_entries INTEGER NOT NULL DEFAULT 0,
          error_text TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (source_db, ec_number)
        );

        CREATE TABLE IF NOT EXISTS web_external_attribute_values (
          external_attribute_id TEXT PRIMARY KEY,
          source_db TEXT NOT NULL,
          ec_number TEXT,
          attribute_name TEXT,
          value_numeric REAL,
          value_maximum REAL,
          unit TEXT,
          organism TEXT,
          literature_ids TEXT,
          commentary TEXT,
          source_url TEXT,
          raw_json TEXT
        );

        CREATE TABLE IF NOT EXISTS web_attribute_external_checks (
          check_id INTEGER PRIMARY KEY AUTOINCREMENT,
          attribute_evidence_id TEXT NOT NULL,
          source_db TEXT NOT NULL,
          match_status TEXT NOT NULL,
          match_score INTEGER NOT NULL DEFAULT 0,
          match_reason TEXT,
          external_attribute_id TEXT,
          ec_number TEXT,
          external_attribute_name TEXT,
          external_value_numeric REAL,
          external_value_maximum REAL,
          external_unit TEXT,
          external_organism TEXT,
          external_literature_ids TEXT,
          external_commentary TEXT,
          source_url TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_web_external_kinetics_ec_param ON web_external_kinetics(source_db, ec_number, parameter_type);
        CREATE INDEX IF NOT EXISTS idx_web_external_kinetics_pubmed ON web_external_kinetics(source_db, pubmed_id);
        CREATE INDEX IF NOT EXISTS idx_web_kinetic_external_checks_kinetic ON web_kinetic_external_checks(kinetic_id);
        CREATE INDEX IF NOT EXISTS idx_web_kinetic_external_checks_status ON web_kinetic_external_checks(source_db, match_status);
        CREATE INDEX IF NOT EXISTS idx_web_external_attribute_values_ec_attr ON web_external_attribute_values(source_db, ec_number, attribute_name);
        CREATE INDEX IF NOT EXISTS idx_web_attribute_external_checks_attr ON web_attribute_external_checks(attribute_evidence_id);
        CREATE INDEX IF NOT EXISTS idx_web_attribute_external_checks_status ON web_attribute_external_checks(source_db, match_status);
        CREATE INDEX IF NOT EXISTS idx_web_attribute_evidences_attr_entity ON web_attribute_evidences(attribute_name, entity_type, entity_id);
        """
    )
    conn.commit()

def normalize_parameter(name: str | None) -> str | None:
    if not name:
        return None
    key = name.strip().lower().replace(" ", "")
    if key in PARAMETER_MAP:
        return PARAMETER_MAP[key]
    lowered = name.strip().lower()
    return PARAMETER_MAP.get(lowered)

def normalize_value(value: float | None, unit: str | None, value_text: str | None = None) -> tuple[float | None, str | None]:
    if value is None:
        return None, None
    unit_value = unit or ""
    if not unit_value and value_text:
        match = UNIT_RE.search(value_text)
        unit_value = match.group(1) if match else ""
    canonical = unit_value.replace("μ", "u").replace("µ", "u").strip()
    lower = canonical.lower()
    if lower == "um":
        return value * 1e-6, "M"
    if lower == "mm":
        return value * 1e-3, "M"
    if lower == "m":
        return value, "M"
    if "min" in lower:
        return value / 60.0, "s^-1"
    if "s" in lower and "-1" in lower:
        return value, "s^-1"
    return value, canonical or None

def parse_sabio_entry(entry: dict) -> list[tuple]:
    entry_id = str(entry.get("id"))
    enzyme = entry.get("enzyme_description") or {}
    general = entry.get("general") or {}
    experimental = entry.get("experimental_conditions") or {}
    publication = entry.get("publication") or {}
    organism = (general.get("organism") or {}).get("name")
    taxonomy_id = (general.get("organism") or {}).get("ncbi_taxonomy_id")
    ec_number = enzyme.get("ec_number")
    pubmed_id = publication.get("pubmed_id")
    title = publication.get("title")
    ph = (experimental.get("envvar_ph") or {}).get("start_value")
    temperature = (experimental.get("envvar_temperature") or {}).get("start_value")
    parameters = ((entry.get("kineticlaw") or {}).get("parameter") or [])
    rows = []
    for index, parameter in enumerate(parameters):
        parameter_name = (parameter.get("parameter_type") or {}).get("name") or parameter.get("name")
        parameter_type = normalize_parameter(parameter_name)
        if parameter_type not in {"km", "kcat", "kcat_km", "vmax"}:
            continue
        value = parameter.get("start_value")
        unit = (parameter.get("unit") or {}).get("name")
        normalized = parameter.get("n_start_value")
        normalized_unit = (parameter.get("unit") or {}).get("n_name")
        if normalized is None:
            normalized, normalized_unit = normalize_value(value, unit)
        substrate = species_name(parameter)
        external_kinetic_id = f"SABIO-RK:{entry_id}:{index}"
        rows.append(
            (
                external_kinetic_id,
                "SABIO-RK",
                entry_id,
                ec_number,
                parameter_type,
                parameter_name,
                value,
                parameter.get("end_value"),
                unit,
                normalized,
                normalized_unit,
                substrate,
                organism,
                str(taxonomy_id) if taxonomy_id else None,
                ph,
                temperature,
                pubmed_id,
                title,
                f"https://sabiork.h-its.org/ui/kinlaw-entry/{entry_id}",
                json.dumps(parameter, ensure_ascii=False),
            )
        )
    return rows

def parse_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    else:
        match = re.search(r"-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?", str(value))
        if not match:
            return None
        number = float(match.group(0))
    if number == -999:
        return None
    return number

def normalize_brenda_value(parameter_type: str, value: float, unit: str) -> tuple[float, str]:
    if parameter_type == "km":
        return value * 1e-3, "M"
    if parameter_type == "kcat_km":
        return value * 1000.0, "M^-1 s^-1"
    return value, unit

def parse_brenda_kinetics(ec_number: str, parameter_type: str, items: list[dict]) -> list[tuple]:
    spec = BRENDA_METHODS[parameter_type]
    rows = []
    for index, item in enumerate(items):
        value = parse_float(item.get(spec["value"]))
        if value is None:
            continue
        maximum = parse_float(item.get(spec["maximum"]))
        normalized, normalized_unit = normalize_brenda_value(parameter_type, value, spec["unit"])
        literature_ids = [str(value) for value in item.get("literature") or [] if str(value).strip()]
        commentary = item.get("commentary")
        if literature_ids:
            commentary = f"{commentary or ''} BRENDA literature IDs: {', '.join(literature_ids)}".strip()
        external_kinetic_id = f"BRENDA:{ec_number}:{parameter_type}:{index}"
        rows.append(
            (
                external_kinetic_id,
                "BRENDA",
                f"{ec_number}:{parameter_type}:{index}",
                ec_number,
                parameter_type,
                spec["value"],
                value,
                maximum,
                spec["unit"],
                normalized,
                normalized_unit,
                item.get("substrate"),
                item.get("organism"),
                None,
                None,
                None,
                None,
                commentary,
                BRENDA_EC_URL.format(ec_number=urllib.parse.quote(ec_number)),
                json.dumps(item, ensure_ascii=False, default=str),
            )
        )
    return rows

def parse_brenda_attributes(ec_number: str, attribute_name: str, items: list[dict]) -> list[tuple]:
    spec = BRENDA_ATTRIBUTE_METHODS[attribute_name]
    rows = []
    for index, item in enumerate(items):
        value = parse_float(item.get(spec["value"]))
        if value is None:
            continue
        literature_ids = [str(value) for value in item.get("literature") or [] if str(value).strip()]
        external_attribute_id = f"BRENDA:{ec_number}:{attribute_name}:{index}"
        rows.append(
            (
                external_attribute_id,
                "BRENDA",
                ec_number,
                attribute_name,
                value,
                parse_float(item.get(spec["maximum"])),
                spec["unit"],
                item.get("organism"),
                json.dumps(literature_ids, ensure_ascii=False),
                item.get("commentary"),
                BRENDA_EC_URL.format(ec_number=urllib.parse.quote(ec_number)),
                json.dumps(item, ensure_ascii=False, default=str),
            )
        )
    return rows

def species_name(parameter: dict) -> str | None:
    key = ((parameter.get("species") or {}).get("species_key") or "").strip()
    if "|" in key:
        parts = [part.strip() for part in key.split("|")]
        if len(parts) >= 2:
            return parts[1]
    return key or None

def local_kinetics(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute(
        """
        SELECT k.kinetic_id, k.reaction_id, k.biopart_id, k.parameter_type,
               k.value_text, k.value_numeric, k.unit, k.subject_name, k.pmids_json,
               wr.ec_number, re.organism
        FROM web_kinetics k
        JOIN web_reactions wr ON wr.reaction_id = k.reaction_id
        LEFT JOIN web_reaction_enzymes re
          ON re.reaction_id = k.reaction_id AND re.biopart_id = k.biopart_id
        WHERE wr.ec_number IS NOT NULL AND trim(wr.ec_number) <> ''
        """
    ).fetchall()

def safe_pmids(value: str | None) -> set[str]:
    if not value:
        return set()
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return set()
    if not isinstance(parsed, list):
        return set()
    return {str(item).strip() for item in parsed if str(item).strip()}

def token_set(value: str | None) -> set[str]:
    if not value:
        return set()
    stop = {"for", "at", "ph", "and", "the", "degrees", "degree", "celsius"}
    return {token.lower() for token in WORD_RE.findall(value) if len(token) > 1 and token.lower() not in stop}

def score_match(local: sqlite3.Row, external: sqlite3.Row) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []
    local_pmids = safe_pmids(local["pmids_json"])
    if local_pmids and external["pubmed_id"] and external["pubmed_id"] in local_pmids:
        score += 45
        reasons.append("shared PMID")
    local_norm, local_unit = normalize_value(local["value_numeric"], local["unit"], local["value_text"])
    ext_norm = external["normalized_value"]
    ext_unit = external["normalized_unit"]
    if local_norm is not None and ext_norm is not None:
        same_unit = (local_unit or "").lower() == (ext_unit or "").lower() or not local_unit or not ext_unit
        ratio = abs(math.log10(max(local_norm, 1e-300) / max(ext_norm, 1e-300)))
        if same_unit and ratio <= math.log10(1.25):
            score += 40
            reasons.append("numeric value within 25%")
        elif same_unit and ratio <= math.log10(2.0):
            score += 28
            reasons.append("numeric value within 2-fold")
        elif same_unit and ratio <= 1.0:
            score += 12
            reasons.append("same order of magnitude")
    local_subject = token_set(local["subject_name"] or local["value_text"])
    ext_subject = token_set(external["substrate"])
    if local_subject and ext_subject and local_subject.intersection(ext_subject):
        score += 10
        reasons.append("substrate/subject overlap")
    local_organism = token_set(local["organism"])
    ext_organism = token_set(external["organism"])
    if local_organism and ext_organism and local_organism.intersection(ext_organism):
        score += 10
        reasons.append("organism overlap")
    return min(score, 100), reasons

def rebuild_checks(conn: sqlite3.Connection, source_db: str) -> None:
    conn.execute("DELETE FROM web_kinetic_external_checks WHERE source_db = ?", (source_db,))
    external_by_key: dict[tuple[str, str], list[sqlite3.Row]] = defaultdict(list)
    for row in conn.execute("SELECT * FROM web_external_kinetics WHERE source_db = ?", (source_db,)):
        if row["ec_number"] and row["parameter_type"]:
            external_by_key[(row["ec_number"], row["parameter_type"])].append(row)

    check_rows = []
    for local in local_kinetics(conn):
        parameter_type = normalize_parameter(local["parameter_type"]) or local["parameter_type"]
        candidates = external_by_key.get((local["ec_number"], parameter_type), [])
        best = None
        best_score = 0
        best_reasons: list[str] = []
        for external in candidates:
            score, reasons = score_match(local, external)
            if score > best_score:
                best = external
                best_score = score
                best_reasons = reasons
        if best and best_score >= 55:
            status = "matched"
        elif best and best_score >= 25:
            status = "weak_match"
        elif candidates:
            status = "ec_parameter_only"
        else:
            status = "not_found"
        check_rows.append(
            (
                local["kinetic_id"],
                source_db,
                status,
                best_score,
                "; ".join(best_reasons) if best_reasons else None,
                best["external_kinetic_id"] if best else None,
                best["external_entry_id"] if best else None,
                local["ec_number"],
                best["parameter_type"] if best else parameter_type,
                best["value_numeric"] if best else None,
                best["unit"] if best else None,
                best["normalized_value"] if best else None,
                best["normalized_unit"] if best else None,
                best["substrate"] if best else None,
                best["organism"] if best else None,
                best["ph"] if best else None,
                best["temperature"] if best else None,
                best["pubmed_id"] if best else None,
                best["source_url"] if best else None,
            )
        )
    conn.executemany(
        """
        INSERT INTO web_kinetic_external_checks (
          kinetic_id, source_db, match_status, match_score, match_reason,
          external_kinetic_id, external_entry_id, ec_number, external_parameter_type,
          external_value_numeric, external_unit, external_normalized_value, external_normalized_unit,
          external_substrate, external_organism, external_ph, external_temperature,
          external_pubmed_id, source_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        check_rows,
    )
    conn.commit()

def local_attribute_conditions(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute(
        """
        WITH local_attr AS (
          SELECT ae.attribute_evidence_id, ae.attribute_name, ae.value_text, ae.value_numeric, ae.unit,
                 ae.pmids_json,
                 substr(ae.entity_id, 1, instr(ae.entity_id, '::') - 1) AS biopart_id,
                 substr(ae.entity_id, instr(ae.entity_id, '::') + 2) AS reaction_id
          FROM web_attribute_evidences ae
          WHERE ae.entity_type = 'biopart_reaction'
            AND ae.attribute_name IN ('optimum_ph', 'optimum_temperature')
            AND instr(ae.entity_id, '::') > 0
        )
        SELECT la.attribute_evidence_id, la.attribute_name, la.value_text, la.value_numeric, la.unit,
               la.pmids_json, wr.ec_number, re.organism
        FROM local_attr la
        JOIN web_reactions wr ON wr.reaction_id = la.reaction_id
        LEFT JOIN web_reaction_enzymes re ON re.reaction_id = la.reaction_id AND re.biopart_id = la.biopart_id
        WHERE wr.ec_number IS NOT NULL AND trim(wr.ec_number) <> ''
        """
    ).fetchall()

def score_attribute_match(local: sqlite3.Row, external: sqlite3.Row) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []
    local_value = local["value_numeric"]
    external_value = external["value_numeric"]
    external_max = external["value_maximum"]
    if local_value is None and local["value_text"]:
        local_value = parse_float(local["value_text"])
    if local_value is not None and external_value is not None:
        if external_max is not None and min(external_value, external_max) <= local_value <= max(external_value, external_max):
            score += 45
            reasons.append("numeric value within BRENDA range")
        else:
            delta = abs(float(local_value) - float(external_value))
            if local["attribute_name"] == "optimum_ph":
                if delta <= 0.2:
                    score += 40
                    reasons.append("pH value within 0.2")
                elif delta <= 0.5:
                    score += 28
                    reasons.append("pH value within 0.5")
                elif delta <= 1.0:
                    score += 12
                    reasons.append("pH value within 1.0")
            else:
                if delta <= 2:
                    score += 40
                    reasons.append("temperature within 2 degC")
                elif delta <= 5:
                    score += 28
                    reasons.append("temperature within 5 degC")
                elif delta <= 10:
                    score += 12
                    reasons.append("temperature within 10 degC")
    local_organism = token_set(local["organism"])
    ext_organism = token_set(external["organism"])
    if local_organism and ext_organism and local_organism.intersection(ext_organism):
        score += 15
        reasons.append("organism overlap")
    return min(score, 100), reasons

def rebuild_attribute_checks(conn: sqlite3.Connection, source_db: str) -> None:
    conn.execute("DELETE FROM web_attribute_external_checks WHERE source_db = ?", (source_db,))
    external_by_key: dict[tuple[str, str], list[sqlite3.Row]] = defaultdict(list)
    for row in conn.execute("SELECT * FROM web_external_attribute_values WHERE source_db = ?", (source_db,)):
        if row["ec_number"] and row["attribute_name"]:
            external_by_key[(row["ec_number"], row["attribute_name"])].append(row)

    check_rows = []
    for local in local_attribute_conditions(conn):
        candidates = external_by_key.get((local["ec_number"], local["attribute_name"]), [])
        best = None
        best_score = 0
        best_reasons: list[str] = []
        for external in candidates:
            score, reasons = score_attribute_match(local, external)
            if score > best_score:
                best = external
                best_score = score
                best_reasons = reasons
        if best and best_score >= 50:
            status = "matched"
        elif best and best_score >= 25:
            status = "weak_match"
        elif candidates:
            status = "ec_attribute_only"
        else:
            status = "not_found"
        check_rows.append(
            (
                local["attribute_evidence_id"],
                source_db,
                status,
                best_score,
                "; ".join(best_reasons) if best_reasons else None,
                best["external_attribute_id"] if best else None,
                local["ec_number"],
                best["attribute_name"] if best else local["attribute_name"],
                best["value_numeric"] if best else None,
                best["value_maximum"] if best else None,
                best["unit"] if best else None,
                best["organism"] if best else None,
                best["literature_ids"] if best else None,
                best["commentary"] if best else None,
                best["source_url"] if best else None,
            )
        )
    conn.executemany(
        """
        INSERT INTO web_attribute_external_checks (
          attribute_evidence_id, source_db, match_status, match_score, match_reason,
          external_attribute_id, ec_number, external_attribute_name, external_value_numeric,
          external_value_maximum, external_unit, external_organism, external_literature_ids,
          external_commentary, source_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        check_rows,
    )
    conn.commit()
