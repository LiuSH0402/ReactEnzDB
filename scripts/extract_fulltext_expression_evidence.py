from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import re
import shutil
import sqlite3
import sys
import time
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import pdfplumber
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "expression_work"
DB = WORK / "expression_evidence.sqlite"
OUT = WORK / "fulltext_expression_extraction"
CACHE = OUT / "text_cache"
EXPORTS = OUT / "exports"
RUNS = OUT / "runs"
ELSEVIER_MANIFEST = WORK / "literature" / "institutional_access" / "elsevier" / "full_corpus" / "manifest_latest.tsv"
SPRINGER_MANIFEST = WORK / "literature" / "institutional_access" / "springer_nature" / "full_corpus" / "manifest_latest.tsv"
ACCESS_MANIFEST = WORK / "literature" / "open_fulltext" / "exports" / "all-candidates.access_manifest.tsv"
MISSING_PUBLISHER_RECOVERY_MANIFEST = WORK / "literature" / "open_fulltext" / "exports" / "missing-publisher-fulltext.access_manifest.tsv"
VERSION = "FULLTEXT_EXPRESSION_AUTO_V1"


EXPRESSION_RE = re.compile(
    r"(?i)\b(?:heterolog(?:ous|ically)|recombinant|overexpress(?:ed|ion|ing)?|"
    r"express(?:ed|ion|ing)\s+(?:in|using|from)|protein\s+expression|"
    r"clon(?:ed|ing)\s+into|transform(?:ed|ation)\s+(?:into|with)|transfect(?:ed|ion)|"
    r"produced\s+in|production\s+(?:of\s+.+?\s+)?in|induc(?:ed|tion)\s+(?:with|by|at)|"
    r"expression\s+vector|purified\s+from)\b"
)
STRONG_EXPRESSION_RE = re.compile(
    r"(?i)\b(?:heterolog(?:ous|ically)|recombinant|overexpress(?:ed|ion|ing)?|"
    r"clon(?:ed|ing)\s+into|transfect(?:ed|ion)|expression\s+vector|IPTG|"
    r"baculovirus|pET[-\w.]*|pGEX[-\w.]*)\b"
)
SOLUBLE_RE = re.compile(r"(?i)\b(?:solubly\s+expressed|soluble\s+(?:protein|fraction|form|expression)|predominantly\s+soluble)\b")
PARTIAL_SOLUBLE_RE = re.compile(r"(?i)\b(?:partially|partly)\s+soluble\b")
INSOLUBLE_RE = re.compile(r"(?i)\b(?:insoluble\s+(?:protein|fraction|form)|inclusion\s+bod(?:y|ies)|aggregat(?:ed|ion))\b")
INACTIVE_RE = re.compile(r"(?i)\b(?:catalytically\s+inactive|enzymatically\s+inactive|no\s+(?:detectable\s+)?(?:enzyme|enzymatic|catalytic)?\s*activity|inactive\s+protein)\b")
ACTIVE_RE = re.compile(r"(?i)\b(?:catalytically\s+active|enzymatically\s+active|active\s+(?:enzyme|protein|form)|retained\s+(?:enzyme|enzymatic|catalytic)?\s*activity|activity\s+(?:was\s+)?(?:detected|measured|confirmed)|conversion\s+(?:of|to))\b")
PURIFIED_RE = re.compile(r"(?i)\b(?:purified\s+(?:protein|enzyme|to\s+homogeneity|by|using|from)|affinity\s+purif(?:ied|ication)|Ni[- ]NTA|chromatograph(?:y|ic))\b")
NEGATIVE_EXPRESSION_RE = re.compile(r"(?i)\b(?:not\s+expressed|failed\s+to\s+express|no\s+(?:detectable\s+)?expression|expression\s+was\s+not\s+detected)\b")
EXPRESSION_DETECTED_RE = re.compile(r"(?i)\b(?:was|were|is|are|successfully)\s+(?:heterologously\s+)?(?:over)?expressed\b|\boverexpression\s+(?:of|in)\b")
VECTOR_RE = re.compile(r"(?i)\b(?:pET(?:Duet)?[-\w.]*|pGEX[-\w.]*|pBAD[-\w.]*|pQE[-\w.]*|pMAL[-\w.]*|pPIC[Z9]?[\w.-]*|pYES[\w.-]*|pESC[\w.-]*|pRS\d+[\w.-]*|pCDF[-\w.]*|pACYC(?:Duet)?[-\w.]*|pCold[-\w.]*|pTrc[-\w.]*|pUC\d+[\w.-]*)\b")
PROMOTER_RE = re.compile(r"(?i)\b(?:T7|AOX1|GAL1|GAL10|lac|tac|trc|CMV|TEF1|PGK1)\s+promoter\b")
TAG_RE = re.compile(r"(?i)\b(?:His(?:6|\s*[- ]tag)?|6xHis|GST|MBP|FLAG|HA|Strep(?:II)?)[- ]tag(?:ged)?\b")
STRAIN_RE = re.compile(r"(?i)\b(?:BL21(?:\s*\(DE3\))?|Rosetta(?:\s*\(DE3\))?|Origami(?:\s*\(DE3\))?|C4[13]\s*\(DE3\)|HMS174|DH5[αa]|JM109|TOP10|M15|XL1[- ]Blue|S288C|BY474[12]|GS115|X[- ]33|KM71H|Sf9|High\s+Five|HEK[- ]?293[\w-]*)\b")
INDUCER_RE = re.compile(r"(?i)\b(?:IPTG|isopropyl\s+β?-?D-?1-thiogalactopyranoside|methanol|galactose|arabinose|doxycycline|tetracycline)\b")
TEMP_RE = re.compile(r"(?<!\d)(\d{1,2}(?:\.\d+)?)\s*(?:°|º)?\s*C\b", re.I)
TIME_RE = re.compile(r"(?<!\d)(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|min|minutes?)\b", re.I)
COFACTOR_RE = re.compile(r"(?i)\b(?:FAD|FMN|NADPH|NADH|PLP|pyridoxal\s+phosphate|heme|haem|Fe(?:2\+|3\+)|Mg2\+|Zn2\+|Co2\+|biotin|thiamine\s+pyrophosphate)\b")
YIELD_RE = re.compile(r"(?i)\b(?:yield|titre|titer|production)\b[^.;]{0,80}?\b\d+(?:\.\d+)?\s*(?:mg|g|µg|ug)\s*(?:L|l|liter|litre)?-?1?\b")
CONVERSION_RE = re.compile(r"(?i)\b(?:conversion|converted|product\s+yield)\b[^.;]{0,100}?\b\d+(?:\.\d+)?\s*%")
REFERENCE_SECTION_RE = re.compile(r"(?i)^\s*(?:references|bibliography|literature\s+cited)\s*$")
METHOD_SECTION_RE = re.compile(r"(?i)(?:materials?\s+and\s+methods?|experimental|methods?|protein\s+expression|cloning|purification|results?)")

SPECIES_PATTERNS = {
    "Escherichia coli": r"(?i)\b(?:Escherichia\s+coli|E\.?\s*coli|BL21(?:\s*\(DE3\))?|Rosetta(?:\s*\(DE3\))?|Origami(?:\s*\(DE3\))?)\b",
    "Saccharomyces cerevisiae": r"(?i)\b(?:Saccharomyces\s+cerevisiae|S\.?\s*cerevisiae|baker'?s\s+yeast)\b",
    "Komagataella phaffii": r"(?i)\b(?:Komagataella\s+phaffii|Pichia\s+pastoris|K\.?\s*phaffii)\b",
    "Pichia pastoris": r"(?i)\b(?:Pichia\s+pastoris|Komagataella\s+phaffii)\b",
    "Bacillus subtilis": r"(?i)\b(?:Bacillus\s+subtilis|B\.?\s*subtilis)\b",
    "Pseudomonas putida": r"(?i)\b(?:Pseudomonas\s+putida|P\.?\s*putida)\b",
    "Corynebacterium glutamicum": r"(?i)\b(?:Corynebacterium\s+glutamicum|C\.?\s*glutamicum)\b",
    "Yarrowia lipolytica": r"(?i)\b(?:Yarrowia\s+lipolytica|Y\.?\s*lipolytica)\b",
    "Streptomyces coelicolor": r"(?i)\b(?:Streptomyces\s+coelicolor|S\.?\s*coelicolor)\b",
    "Cupriavidus necator": r"(?i)\b(?:Cupriavidus\s+necator|Ralstonia\s+eutropha)\b",
    "Spodoptera frugiperda": r"(?i)\b(?:Spodoptera\s+frugiperda|Sf9|Sf21)\b",
}


def now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def stable_id(prefix: str, *values: str) -> str:
    payload = "|".join(values).encode("utf-8")
    return prefix + hashlib.sha256(payload).hexdigest()[:20]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_tsv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle, delimiter="\t"))


def write_tsv_gz(path: Path, rows: Iterable[dict[str, Any]], columns: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8", newline="", compresslevel=6) as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, delimiter="\t", lineterminator="\n", extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def clean_text(value: str) -> str:
    value = value.replace("\x00", " ").replace("\u00ad", "")
    value = re.sub(r"(?<=\w)-\s*\n\s*(?=\w)", "", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def split_sentences(text: str) -> list[str]:
    text = clean_text(text)
    if not text:
        return []
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9(])", text)
    return [part.strip() for part in parts if len(part.strip()) >= 20]


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].split(":")[-1].lower()


def extract_xml_paragraphs(path: Path) -> tuple[list[dict[str, Any]], int, str]:
    root = ET.parse(path).getroot()
    paragraphs: list[dict[str, Any]] = []
    section = ""
    locator = 0
    for elem in root.iter():
        name = local_name(elem.tag)
        text = clean_text(" ".join(part for part in elem.itertext() if part))
        if name in {"section-title", "sectitle"} and 2 <= len(text) <= 250:
            section = text
        elif name in {"para", "simple-para", "p"} and len(text) >= 40:
            locator += 1
            paragraphs.append({"section": section, "page": "", "locator": f"xml_para_{locator}", "text": text})
    parser = "xml.etree.iterparse_paragraphs"
    if len(paragraphs) < 5:
        text = clean_text(" ".join(part for part in root.itertext() if part))
        sentences = split_sentences(text)
        paragraphs = []
        for index in range(0, len(sentences), 4):
            chunk = " ".join(sentences[index:index + 4])
            if len(chunk) >= 40:
                paragraphs.append({"section": "full_text_fallback", "page": "", "locator": f"xml_chunk_{index // 4 + 1}", "text": chunk})
        parser = "xml.etree.full_text_fallback"
    return paragraphs, 0, parser


def pdf_paragraphs_from_pages(page_texts: Iterable[str]) -> tuple[list[dict[str, Any]], int]:
    paragraphs: list[dict[str, Any]] = []
    references_started = False
    page_count = 0
    for page_number, raw in enumerate(page_texts, start=1):
        page_count = page_number
        lines = [clean_text(line) for line in raw.splitlines() if clean_text(line)]
        if any(REFERENCE_SECTION_RE.fullmatch(line) for line in lines[:10]):
            references_started = True
        if references_started:
            continue
        text = clean_text(" ".join(lines))
        sentences = split_sentences(text)
        for index in range(0, len(sentences), 3):
            chunk = " ".join(sentences[index:index + 3])
            if len(chunk) >= 40:
                paragraphs.append({"section": "pdf_body", "page": str(page_number), "locator": f"page_{page_number}_chunk_{index // 3 + 1}", "text": chunk})
    return paragraphs, page_count


def extract_pdf_paragraphs(path: Path) -> tuple[list[dict[str, Any]], int, str]:
    try:
        reader = PdfReader(str(path), strict=False)
        paragraphs, page_count = pdf_paragraphs_from_pages((page.extract_text() or "") for page in reader.pages)
        return paragraphs, page_count, "pypdf.PdfReader.extract_text"
    except Exception as pypdf_error:
        try:
            with pdfplumber.open(path) as pdf:
                paragraphs, page_count = pdf_paragraphs_from_pages((page.extract_text() or "") for page in pdf.pages)
            return paragraphs, page_count, f"pdfplumber.Page.extract_text fallback_after_{type(pypdf_error).__name__}"
        except Exception as pdfplumber_error:
            raise RuntimeError(
                f"pypdf={type(pypdf_error).__name__}:{str(pypdf_error)[:160]}; "
                f"pdfplumber={type(pdfplumber_error).__name__}:{str(pdfplumber_error)[:160]}"
            ) from pdfplumber_error


def cache_paragraphs(source: str, pmid: str, paragraphs: list[dict[str, Any]]) -> tuple[Path, str]:
    path = CACHE / source / f"PMID_{pmid}.paragraphs.json.gz"
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(paragraphs, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with path.open("wb") as outer:
        with gzip.GzipFile(filename="", mode="wb", fileobj=outer, mtime=0) as handle:
            handle.write(raw)
    return path, hashlib.sha256(raw).hexdigest()


def load_cached_paragraphs(path: Path) -> list[dict[str, Any]]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return json.load(handle)


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS expression_extraction_documents(
          document_id TEXT PRIMARY KEY,pmid TEXT NOT NULL,doi TEXT,publisher_source TEXT NOT NULL,
          source_format TEXT NOT NULL,source_file TEXT NOT NULL,source_sha256 TEXT NOT NULL,
          extraction_status TEXT NOT NULL,text_chars INTEGER NOT NULL,page_count INTEGER NOT NULL,
          paragraph_count INTEGER NOT NULL,text_cache_path TEXT,text_sha256 TEXT,parser TEXT,
          error TEXT,extraction_version TEXT NOT NULL,extracted_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_expression_extraction_documents_pmid ON expression_extraction_documents(pmid);
        CREATE TABLE IF NOT EXISTS expression_evidence_candidates(
          candidate_id TEXT PRIMARY KEY,document_id TEXT NOT NULL,pmid TEXT NOT NULL,doi TEXT,
          host_id TEXT,host_name TEXT NOT NULL,host_match_text TEXT,source_organism TEXT,
          expression_mode TEXT NOT NULL,enzyme_identity_status TEXT NOT NULL,
          evidence_type_candidate TEXT NOT NULL,confidence REAL NOT NULL,
          expression_detected TEXT NOT NULL,solubility TEXT NOT NULL,activity TEXT NOT NULL,
          purification TEXT NOT NULL,localization TEXT,vector TEXT,promoter TEXT,tag TEXT,
          strain_or_cell_line TEXT,inducer TEXT,induction_condition TEXT,
          expression_temperature_c REAL,expression_time_text TEXT,cofactor_supplementation TEXT,
          yield_text TEXT,conversion_text TEXT,negative_result_text TEXT,
          success_interpretation TEXT NOT NULL,curation_status TEXT NOT NULL,
          primary_span_id TEXT,mapping_details_json TEXT NOT NULL,
          extraction_version TEXT NOT NULL,created_at TEXT NOT NULL,
          FOREIGN KEY(document_id) REFERENCES expression_extraction_documents(document_id)
        );
        CREATE INDEX IF NOT EXISTS idx_expression_candidates_pmid_host ON expression_evidence_candidates(pmid,host_id);
        CREATE INDEX IF NOT EXISTS idx_expression_candidates_confidence ON expression_evidence_candidates(confidence DESC);
        CREATE TABLE IF NOT EXISTS expression_evidence_candidate_spans(
          span_id TEXT PRIMARY KEY,candidate_id TEXT NOT NULL,document_id TEXT NOT NULL,
          section TEXT,page_or_table TEXT,paragraph_or_locator TEXT,evidence_text TEXT NOT NULL,
          evidence_text_sha256 TEXT NOT NULL,match_features_json TEXT NOT NULL,
          extraction_method TEXT NOT NULL,created_at TEXT NOT NULL,
          FOREIGN KEY(candidate_id) REFERENCES expression_evidence_candidates(candidate_id),
          FOREIGN KEY(document_id) REFERENCES expression_extraction_documents(document_id)
        );
        CREATE INDEX IF NOT EXISTS idx_expression_candidate_spans_candidate ON expression_evidence_candidate_spans(candidate_id);
        CREATE TABLE IF NOT EXISTS expression_evidence_candidate_enzyme_links(
          candidate_id TEXT NOT NULL,biopart_id TEXT NOT NULL,reactenz_enzyme_id TEXT,
          protein_id TEXT,gene_name TEXT,enzyme_name TEXT,reaction_id TEXT,reactenz_reaction_id TEXT,
          link_method TEXT NOT NULL,match_score REAL NOT NULL,is_primary INTEGER NOT NULL,
          PRIMARY KEY(candidate_id,biopart_id,reaction_id,link_method),
          FOREIGN KEY(candidate_id) REFERENCES expression_evidence_candidates(candidate_id)
        );
        CREATE INDEX IF NOT EXISTS idx_expression_candidate_links_biopart ON expression_evidence_candidate_enzyme_links(biopart_id);
        """
    )


def load_documents() -> list[dict[str, str]]:
    documents: list[dict[str, str]] = []
    for row in read_tsv(ELSEVIER_MANIFEST):
        if row["classification"] == "full_text_xml":
            documents.append({**row, "publisher_source": "elsevier", "source_format": "xml"})
    for row in read_tsv(SPRINGER_MANIFEST):
        if row["classification"] == "valid_full_text_pdf":
            documents.append({**row, "publisher_source": "springer_nature", "source_format": "pdf"})
    seen_pmids = {row["pmid"] for row in documents}
    if ACCESS_MANIFEST.exists():
        for row in read_tsv(ACCESS_MANIFEST):
            if row["merged_access_status"] != "lawful_open_pdf_cached" or row["pmid"] in seen_pmids:
                continue
            publisher_slug = re.sub(r"[^a-z0-9]+", "_", (row.get("publisher_group") or "unknown").lower()).strip("_")
            documents.append({
                **row,
                "queue_position": str(5_000_000 + len(documents)),
                "publisher_source": f"open_access_{publisher_slug}",
                "source_format": "pdf",
                "output_file": str(WORK / row["best_local_path"]),
                "sha256": row["best_sha256"],
            })
            seen_pmids.add(row["pmid"])
    if MISSING_PUBLISHER_RECOVERY_MANIFEST.exists():
        for row in read_tsv(MISSING_PUBLISHER_RECOVERY_MANIFEST):
            if row["merged_access_status"] != "lawful_open_pdf_cached" or row["pmid"] in seen_pmids:
                continue
            publisher_source = "elsevier" if row["publisher_group"] == "Elsevier" else "springer_nature"
            documents.append({
                **row,
                "queue_position": str(10_000_000 + len(documents)),
                "publisher_source": publisher_source,
                "source_format": "pdf",
                "output_file": str(WORK / row["best_local_path"]),
                "sha256": row["best_sha256"],
            })
            seen_pmids.add(row["pmid"])
    documents.sort(key=lambda row: (row["publisher_source"], int(row["queue_position"])))
    return documents


def load_mapping_rows(conn: sqlite3.Connection) -> dict[str, list[dict[str, Any]]]:
    sql = """
    SELECT c.pmid,
           COALESCE(o.curated_host_id,l.host_id) host_id,
           COALESCE(o.curated_canonical_name,h.canonical_name) host_name,
           COALESCE(o.curated_species,h.canonical_species) host_species,
           COALESCE(o.curated_strain_or_cell_line,h.strain_or_cell_line) host_strain,
           COALESCE(o.curated_host_kind,h.host_kind) host_kind,
           COALESCE(o.curated_role_candidate,l.role_candidate) role_candidate,
           l.raw_host_label,l.biopart_id,l.reactenz_enzyme_id,l.reaction_id,l.reactenz_reaction_id,
           l.enzyme_name,l.gene_name_primary gene_name,l.source_organism,l.protein_id
    FROM legacy_annotation_citations c
    JOIN legacy_host_annotations l USING(legacy_annotation_id)
    JOIN host_entities h ON h.host_id=l.host_id
    LEFT JOIN host_alias_overrides o ON o.raw_label=l.raw_host_label
    ORDER BY c.pmid,host_id,l.biopart_id,l.reaction_id
    """
    result: dict[str, list[dict[str, Any]]] = defaultdict(list)
    seen: set[tuple[Any, ...]] = set()
    for row in conn.execute(sql):
        item = dict(row)
        key = (item["pmid"], item["host_id"], item["biopart_id"], item["reaction_id"], item["raw_host_label"])
        if key not in seen:
            seen.add(key)
            result[item["pmid"]].append(item)
    return result


def aliases_for_host(rows: list[dict[str, Any]]) -> list[str]:
    values: set[str] = set()
    for row in rows:
        for key in ("host_name", "host_species", "host_strain", "raw_host_label"):
            value = clean_text(str(row.get(key) or ""))
            if len(value) >= 4 and value.lower() not in {"cell", "cells", "host", "organism"}:
                values.add(value)
    return sorted(values, key=len, reverse=True)


def host_match(text: str, rows: list[dict[str, Any]]) -> tuple[bool, str, float]:
    species = next((str(row.get("host_species")) for row in rows if row.get("host_species")), "")
    if species in SPECIES_PATTERNS:
        match = re.search(SPECIES_PATTERNS[species], text)
        if match:
            return True, match.group(0), 1.0
    for alias in aliases_for_host(rows):
        escaped = re.escape(alias).replace(r"\ ", r"\s+")
        match = re.search(r"(?i)(?<!\w)" + escaped + r"(?!\w)", text)
        if match:
            specificity = min(1.0, 0.55 + len(alias) / 60)
            return True, match.group(0), specificity
    return False, "", 0.0


def group_hosts(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        groups[str(row["host_id"])].append(row)
    return groups


def field_match(pattern: re.Pattern[str], text: str) -> str:
    match = pattern.search(text)
    return clean_text(match.group(0)) if match else ""


def parse_fields(text: str) -> dict[str, Any]:
    soluble = bool(SOLUBLE_RE.search(text))
    partial = bool(PARTIAL_SOLUBLE_RE.search(text))
    insoluble = bool(INSOLUBLE_RE.search(text))
    if partial or (soluble and insoluble):
        solubility = "partially_soluble"
    elif soluble:
        solubility = "soluble"
    elif insoluble:
        solubility = "insoluble"
    else:
        solubility = "not_reported"
    active = bool(ACTIVE_RE.search(text))
    inactive = bool(INACTIVE_RE.search(text))
    activity = "active" if active and not inactive else "inactive" if inactive and not active else "not_reported"
    negative_expression = bool(NEGATIVE_EXPRESSION_RE.search(text))
    detected = bool(EXPRESSION_DETECTED_RE.search(text) or EXPRESSION_RE.search(text))
    expression_detected = "no" if negative_expression and not detected else "yes" if detected else "not_reported"
    purified = bool(PURIFIED_RE.search(text))
    purification = "purified" if purified else "not_reported"
    if expression_detected == "no":
        success = "negative_expression"
    elif solubility == "insoluble":
        success = "insoluble"
    elif activity == "inactive":
        success = "inactive"
    elif activity == "active" and solubility == "soluble":
        success = "successful_active_soluble"
    elif activity == "active":
        success = "successful_active"
    elif expression_detected == "yes" or purified:
        success = "expressed_only"
    else:
        success = "not_interpretable"
    temperatures = [float(value) for value in TEMP_RE.findall(text)]
    expression_temperature = next((value for value in temperatures if 4 <= value <= 45), None)
    return {
        "expression_detected": expression_detected,
        "solubility": solubility,
        "activity": activity,
        "purification": purification,
        "success_interpretation": success,
        "vector": field_match(VECTOR_RE, text),
        "promoter": field_match(PROMOTER_RE, text),
        "tag": field_match(TAG_RE, text),
        "strain_or_cell_line": field_match(STRAIN_RE, text),
        "inducer": field_match(INDUCER_RE, text),
        "expression_temperature_c": expression_temperature,
        "expression_time_text": field_match(TIME_RE, text),
        "cofactor_supplementation": field_match(COFACTOR_RE, text),
        "yield_text": field_match(YIELD_RE, text),
        "conversion_text": field_match(CONVERSION_RE, text),
        "negative_result_text": field_match(NEGATIVE_EXPRESSION_RE, text) or field_match(INACTIVE_RE, text),
    }


def exact_enzyme_matches(text: str, rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str, float]:
    matches: list[tuple[dict[str, Any], str, float]] = []
    for row in rows:
        protein = clean_text(str(row.get("protein_id") or ""))
        gene = clean_text(str(row.get("gene_name") or ""))
        enzyme = clean_text(str(row.get("enzyme_name") or ""))
        if len(protein) >= 4 and re.search(r"(?i)(?<!\w)" + re.escape(protein) + r"(?!\w)", text):
            matches.append((row, "fulltext_exact_protein_id", 1.0))
        elif 3 <= len(gene) <= 30 and gene.lower() not in {"gene", "protein", "enzyme"} and re.search(r"(?i)(?<!\w)" + re.escape(gene) + r"(?!\w)", text):
            matches.append((row, "fulltext_exact_gene_name", 0.9))
        elif 6 <= len(enzyme) <= 120 and enzyme.lower() not in {"protein", "enzyme"} and enzyme.lower() in text.lower():
            matches.append((row, "fulltext_enzyme_name_phrase", 0.8))
    if not matches:
        return [], "paper_host_link_pending_review", 0.0
    best_method = max(matches, key=lambda value: value[2])[1]
    best_score = max(value[2] for value in matches)
    unique: dict[tuple[str, str], dict[str, Any]] = {}
    for row, _, _ in matches:
        unique[(str(row["biopart_id"]), str(row["reaction_id"]))] = row
    return list(unique.values()), best_method, best_score


def expression_mode(rows: list[dict[str, Any]]) -> str:
    kind = " ".join(str(row.get("host_kind") or "") for row in rows).lower()
    species = " ".join(str(row.get("host_species") or "") for row in rows).lower()
    if "insect" in kind:
        return "insect_cell_expression"
    if "mammalian" in kind or "human_cell" in kind:
        return "mammalian_cell_expression"
    if "plant" in kind:
        return "plant_expression"
    if any(term in species for term in ("saccharomyces", "komagataella", "pichia", "yarrowia")):
        return "yeast_expression"
    return "microbial_expression"


def candidate_evidence_type(fields: dict[str, Any], exact_score: float) -> str:
    if exact_score > 0 and fields["activity"] == "active" and fields["solubility"] == "soluble":
        return "E1_active_soluble_exact_enzyme"
    if exact_score > 0 and fields["activity"] == "active":
        return "E2_active_exact_enzyme"
    if exact_score > 0 and (fields["expression_detected"] == "yes" or fields["purification"] == "purified"):
        return "E3_expressed_or_purified_exact_enzyme"
    return "E4_host_annotation_with_publication"


def extract_candidates(
    document: dict[str, str], paragraphs: list[dict[str, Any]], mapping_rows: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    doc_id = stable_id("XD", document["publisher_source"], document["pmid"], document["doi"].lower())
    host_groups = group_hosts(mapping_rows)
    evidence_by_host: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for paragraph in paragraphs:
        text = paragraph["text"]
        if not EXPRESSION_RE.search(text):
            continue
        matched_by_species: dict[str, tuple[str, str, float]] = {}
        for host_id, rows in host_groups.items():
            matched, matched_text, specificity = host_match(text, rows)
            if not matched:
                continue
            role = " ".join(str(row.get("role_candidate") or "") for row in rows).lower()
            if ("ambiguous" in role or "unresolved" in role) and not STRONG_EXPRESSION_RE.search(text):
                continue
            species_key = next((str(row.get("host_species") or "") for row in rows if row.get("host_species")), host_id)
            current = matched_by_species.get(species_key)
            if current is None or specificity > current[2]:
                matched_by_species[species_key] = (host_id, matched_text, specificity)
        for host_id, matched_text, specificity in matched_by_species.values():
            rows = host_groups[host_id]
            exact_rows, exact_method, exact_score = exact_enzyme_matches(text, rows)
            fields = parse_fields(text)
            outcomes = sum(fields[key] not in {"not_reported", ""} for key in ("solubility", "activity", "purification"))
            construct = sum(bool(fields[key]) for key in ("vector", "promoter", "tag", "inducer"))
            score = 0.42 + 0.18 * specificity + 0.12 * min(1, outcomes) + 0.08 * min(1, construct) + 0.13 * exact_score
            if METHOD_SECTION_RE.search(str(paragraph.get("section") or "")):
                score += 0.05
            score = min(0.98, round(score, 3))
            evidence_by_host[host_id].append({
                **paragraph, "host_match_text": matched_text, "specificity": specificity,
                "exact_rows": exact_rows, "exact_method": exact_method, "exact_score": exact_score,
                "fields": fields, "score": score,
            })

    candidates: list[dict[str, Any]] = []
    spans: list[dict[str, Any]] = []
    links: list[dict[str, Any]] = []
    created_at = now()
    for host_id, evidence in evidence_by_host.items():
        evidence.sort(key=lambda row: (-row["score"], row["locator"]))
        selected = evidence[:5]
        rows = host_groups[host_id]
        combined = " ".join(row["text"] for row in selected)
        fields = parse_fields(combined)
        exact_rows, exact_method, exact_score = exact_enzyme_matches(combined, rows)
        best = selected[0]
        confidence = round(min(0.98, max(row["score"] for row in selected)), 3)
        host_name = next((str(row.get("host_name")) for row in rows if row.get("host_name")), best["host_match_text"])
        source_organisms = sorted({str(row.get("source_organism")) for row in rows if row.get("source_organism")})
        candidate_id = stable_id("XC", doc_id, host_id)
        candidate_span_rows: list[dict[str, Any]] = []
        for item in selected:
            snippet = clean_text(item["text"])[:1200]
            span_hash = hashlib.sha256(snippet.encode("utf-8")).hexdigest()
            span_id = stable_id("XS", candidate_id, item["locator"], span_hash)
            features = {
                "expression_term": field_match(EXPRESSION_RE, snippet),
                "host_match": item["host_match_text"],
                "host_specificity": item["specificity"],
                "exact_enzyme_method": item["exact_method"],
                "score": item["score"],
            }
            span = {
                "span_id": span_id, "candidate_id": candidate_id, "document_id": doc_id,
                "section": item.get("section", ""), "page_or_table": item.get("page", ""),
                "paragraph_or_locator": item.get("locator", ""), "evidence_text": snippet,
                "evidence_text_sha256": span_hash, "match_features_json": json.dumps(features, ensure_ascii=False),
                "extraction_method": "rule_based_sentence_window", "created_at": created_at,
            }
            spans.append(span)
            candidate_span_rows.append(span)
        evidence_type = candidate_evidence_type(fields, exact_score)
        mapping_details = {
            "legacy_host_annotation_count": len(rows),
            "candidate_span_ids": [row["span_id"] for row in candidate_span_rows],
            "exact_enzyme_match_method": exact_method,
            "requires_human_verification": True,
        }
        candidate = {
            "candidate_id": candidate_id, "document_id": doc_id, "pmid": document["pmid"],
            "doi": document["doi"], "host_id": host_id, "host_name": host_name,
            "host_match_text": best["host_match_text"], "source_organism": " | ".join(source_organisms),
            "expression_mode": expression_mode(rows),
            "enzyme_identity_status": exact_method,
            "evidence_type_candidate": evidence_type, "confidence": confidence,
            "expression_detected": fields["expression_detected"], "solubility": fields["solubility"],
            "activity": fields["activity"], "purification": fields["purification"],
            "localization": "", "vector": fields["vector"], "promoter": fields["promoter"],
            "tag": fields["tag"], "strain_or_cell_line": fields["strain_or_cell_line"] or next((str(row.get("host_strain")) for row in rows if row.get("host_strain")), ""),
            "inducer": fields["inducer"], "induction_condition": "",
            "expression_temperature_c": fields["expression_temperature_c"],
            "expression_time_text": fields["expression_time_text"],
            "cofactor_supplementation": fields["cofactor_supplementation"],
            "yield_text": fields["yield_text"], "conversion_text": fields["conversion_text"],
            "negative_result_text": fields["negative_result_text"],
            "success_interpretation": fields["success_interpretation"],
            "curation_status": "auto_extracted_pending_review",
            "primary_span_id": candidate_span_rows[0]["span_id"],
            "mapping_details_json": json.dumps(mapping_details, ensure_ascii=False),
            "extraction_version": VERSION, "created_at": created_at,
        }
        candidates.append(candidate)
        link_rows = exact_rows if exact_rows else rows
        for index, row in enumerate(link_rows):
            links.append({
                "candidate_id": candidate_id, "biopart_id": str(row["biopart_id"]),
                "reactenz_enzyme_id": str(row.get("reactenz_enzyme_id") or ""),
                "protein_id": str(row.get("protein_id") or ""), "gene_name": str(row.get("gene_name") or ""),
                "enzyme_name": str(row.get("enzyme_name") or ""), "reaction_id": str(row["reaction_id"]),
                "reactenz_reaction_id": str(row.get("reactenz_reaction_id") or ""),
                "link_method": exact_method if exact_rows else "legacy_paper_host_link_pending_review",
                "match_score": exact_score if exact_rows else 0.25,
                "is_primary": int(index == 0 and (len(link_rows) == 1 or bool(exact_rows))),
            })
    return candidates, spans, links


def insert_document(conn: sqlite3.Connection, row: dict[str, Any]) -> None:
    columns = list(row)
    conn.execute(
        f"INSERT OR REPLACE INTO expression_extraction_documents({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})",
        [row[column] for column in columns],
    )


def insert_rows(conn: sqlite3.Connection, table: str, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    columns = list(rows[0])
    conn.executemany(
        f"INSERT OR REPLACE INTO {table}({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})",
        [[row[column] for column in columns] for row in rows],
    )


def export_tables(conn: sqlite3.Connection) -> None:
    specs = {
        "expression_extraction_documents": "documents.tsv.gz",
        "expression_evidence_candidates": "expression_evidence_candidates.tsv.gz",
        "expression_evidence_candidate_spans": "expression_evidence_candidate_spans.tsv.gz",
        "expression_evidence_candidate_enzyme_links": "expression_evidence_candidate_enzyme_links.tsv.gz",
    }
    for table, filename in specs.items():
        cursor = conn.execute(f"SELECT * FROM {table} ORDER BY 1")
        columns = [item[0] for item in cursor.description]
        write_tsv_gz(EXPORTS / filename, (dict(zip(columns, row)) for row in cursor), columns)
    cursor = conn.execute(
        """
        SELECT c.*,d.publisher_source,d.source_file,
               (SELECT evidence_text FROM expression_evidence_candidate_spans s WHERE s.span_id=c.primary_span_id) primary_evidence_text
        FROM expression_evidence_candidates c JOIN expression_extraction_documents d USING(document_id)
        ORDER BY c.confidence DESC,
                 CASE c.evidence_type_candidate WHEN 'E1_active_soluble_exact_enzyme' THEN 1 WHEN 'E2_active_exact_enzyme' THEN 2 WHEN 'E3_expressed_or_purified_exact_enzyme' THEN 3 ELSE 4 END,
                 CAST(c.pmid AS INTEGER)
        """
    )
    columns = [item[0] for item in cursor.description]
    write_tsv_gz(EXPORTS / "human_review_queue.tsv.gz", (dict(zip(columns, row)) for row in cursor), columns)


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract auditable expression-evidence candidates from publisher full text")
    parser.add_argument("--max-documents", type=int, default=0)
    parser.add_argument("--reset", action="store_true")
    args = parser.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    EXPORTS.mkdir(parents=True, exist_ok=True)
    RUNS.mkdir(parents=True, exist_ok=True)
    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_path = RUNS / f"run_{run_id}.log"

    def log(message: str) -> None:
        line = f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {message}"
        print(line, flush=True)
        with log_path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")

    backup = WORK / "expression_evidence.pre_fulltext_extraction.sqlite"
    if not backup.exists():
        shutil.copy2(DB, backup)
        log(f"Created pre-extraction database backup: {backup}")
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    ensure_schema(conn)
    if args.reset:
        conn.executescript(
            """
            DELETE FROM expression_evidence_candidate_enzyme_links;
            DELETE FROM expression_evidence_candidate_spans;
            DELETE FROM expression_evidence_candidates;
            DELETE FROM expression_extraction_documents;
            """
        )
        conn.commit()
    mappings = load_mapping_rows(conn)
    documents = load_documents()
    if args.max_documents > 0:
        documents = documents[:args.max_documents]
    completed = {row[0] for row in conn.execute("SELECT document_id FROM expression_extraction_documents WHERE extraction_status IN ('text_extracted','no_expression_candidate','candidate_extracted')")}
    summary = Counter()
    started = time.time()
    log(f"Documents selected={len(documents)}; already completed={len(completed)}; mapping PMIDs={len(mappings)}")
    for index, document in enumerate(documents, start=1):
        doc_id = stable_id("XD", document["publisher_source"], document["pmid"], document["doi"].lower())
        if doc_id in completed:
            summary["already_complete"] += 1
            continue
        source_path = Path(document["output_file"])
        cache_path = CACHE / document["publisher_source"] / f"PMID_{document['pmid']}.paragraphs.json.gz"
        try:
            if cache_path.exists():
                paragraphs = load_cached_paragraphs(cache_path)
                page_count = 0 if document["source_format"] == "xml" else -1
                parser_name = "cached_paragraph_json"
                text_sha = hashlib.sha256(json.dumps(paragraphs, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()
            else:
                if document["source_format"] == "xml":
                    paragraphs, page_count, parser_name = extract_xml_paragraphs(source_path)
                else:
                    paragraphs, page_count, parser_name = extract_pdf_paragraphs(source_path)
                cache_path, text_sha = cache_paragraphs(document["publisher_source"], document["pmid"], paragraphs)
            text_chars = sum(len(row["text"]) for row in paragraphs)
            extraction_status = "needs_ocr_or_text_recovery" if text_chars < 1000 else "text_extracted"
            candidates: list[dict[str, Any]] = []
            spans: list[dict[str, Any]] = []
            links: list[dict[str, Any]] = []
            if extraction_status == "text_extracted":
                candidates, spans, links = extract_candidates(document, paragraphs, mappings.get(document["pmid"], []))
                extraction_status = "candidate_extracted" if candidates else "no_expression_candidate"
            doc_row = {
                "document_id": doc_id, "pmid": document["pmid"], "doi": document["doi"],
                "publisher_source": document["publisher_source"], "source_format": document["source_format"],
                "source_file": str(source_path), "source_sha256": document["sha256"],
                "extraction_status": extraction_status, "text_chars": text_chars,
                "page_count": page_count, "paragraph_count": len(paragraphs),
                "text_cache_path": str(cache_path), "text_sha256": text_sha,
                "parser": parser_name, "error": "", "extraction_version": VERSION, "extracted_at": now(),
            }
            insert_document(conn, doc_row)
            insert_rows(conn, "expression_evidence_candidates", candidates)
            insert_rows(conn, "expression_evidence_candidate_spans", spans)
            insert_rows(conn, "expression_evidence_candidate_enzyme_links", links)
            conn.commit()
            summary[extraction_status] += 1
            summary["candidates"] += len(candidates)
            summary["spans"] += len(spans)
            if index % 25 == 0:
                log(f"Progress {index}/{len(documents)}; status={extraction_status}; candidates_total={summary['candidates']}")
        except Exception as exc:
            conn.rollback()
            insert_document(conn, {
                "document_id": doc_id, "pmid": document["pmid"], "doi": document["doi"],
                "publisher_source": document["publisher_source"], "source_format": document["source_format"],
                "source_file": str(source_path), "source_sha256": document["sha256"],
                "extraction_status": "parse_error", "text_chars": 0, "page_count": 0, "paragraph_count": 0,
                "text_cache_path": "", "text_sha256": "", "parser": "", "error": f"{type(exc).__name__}: {str(exc)[:1000]}",
                "extraction_version": VERSION, "extracted_at": now(),
            })
            conn.commit()
            summary["parse_error"] += 1
            log(f"ERROR {index}/{len(documents)} PMID={document['pmid']}: {type(exc).__name__}: {exc}")

    export_tables(conn)
    counts = {table: conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] for table in (
        "expression_extraction_documents", "expression_evidence_candidates",
        "expression_evidence_candidate_spans", "expression_evidence_candidate_enzyme_links",
    )}
    status_counts = dict(conn.execute("SELECT extraction_status,COUNT(*) FROM expression_extraction_documents GROUP BY extraction_status"))
    source_counts = dict(conn.execute("SELECT publisher_source,COUNT(*) FROM expression_extraction_documents GROUP BY publisher_source"))
    evidence_counts = dict(conn.execute("SELECT evidence_type_candidate,COUNT(*) FROM expression_evidence_candidates GROUP BY evidence_type_candidate"))
    final_assertions = conn.execute("SELECT COUNT(*) FROM expression_assertions").fetchone()[0]
    foreign_key_errors = len(conn.execute("PRAGMA foreign_key_check").fetchall())
    qa = {
        "generated_at": now(), "extraction_version": VERSION,
        "checks": {
            "all_selected_documents_accounted_for": counts["expression_extraction_documents"] >= len(documents),
            "no_auto_candidates_promoted_to_verified_assertions": final_assertions == 0,
            "candidate_has_source_span": conn.execute("SELECT COUNT(*) FROM expression_evidence_candidates c WHERE NOT EXISTS (SELECT 1 FROM expression_evidence_candidate_spans s WHERE s.candidate_id=c.candidate_id)").fetchone()[0] == 0,
            "candidate_has_enzyme_or_legacy_link": conn.execute("SELECT COUNT(*) FROM expression_evidence_candidates c WHERE NOT EXISTS (SELECT 1 FROM expression_evidence_candidate_enzyme_links l WHERE l.candidate_id=c.candidate_id)").fetchone()[0] == 0,
            "foreign_keys_clean": foreign_key_errors == 0,
        },
        "final_assertion_count": final_assertions,
        "foreign_key_errors": foreign_key_errors,
    }
    qa["passed"] = all(qa["checks"].values())
    result = {
        "generated_at": now(), "run_id": run_id, "extraction_version": VERSION,
        "selected_documents_this_invocation": len(documents), "table_counts": counts,
        "document_status_counts": status_counts, "publisher_source_counts": source_counts,
        "evidence_type_candidate_counts": evidence_counts,
        "elapsed_seconds": round(time.time() - started, 2), "qa_passed": qa["passed"],
        "rights_boundary": "Publisher full text and derived text caches are internal research material and are not public-download outputs.",
        "interpretation_boundary": "All extracted rows are auto_extracted_pending_review; no full_text_verified assertion is created automatically.",
        "log": str(log_path),
    }
    (OUT / "summary.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / "qa.json").write_text(json.dumps(qa, ensure_ascii=False, indent=2), encoding="utf-8")
    conn.close()
    log(json.dumps(result, ensure_ascii=False))
    return 0 if qa["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
