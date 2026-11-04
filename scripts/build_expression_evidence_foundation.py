from __future__ import annotations
import os

import argparse
import csv
import gzip
import hashlib
import io
import json
import math
import re
import sqlite3
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = Path(os.environ.get("REACTENZDB_INPUT_ROOT", ROOT / "inputs"))
CORE_DB = ROOT / "web_release" / "reactenzdb_web.db"
UPSTREAM_DB = DATA_ROOT / "rdbsb_v2" / "rdbsb_biosyn_v2.db"
HOST_CONTEXT_DB = ROOT / "web_release" / "host_context_chassis.sqlite"
WORK = ROOT / "expression_work"
OUTPUT_DB = WORK / "expression_evidence.sqlite"
SUMMARY_JSON = WORK / "expression_foundation.summary.json"
SCHEMA_JSON = WORK / "expression_schema.json"
DOWNLOADS = WORK / "stage_ab_exports"

SPLITTER = re.compile(r"\s*,\s*")
PLACEHOLDERS = {"", "-", "na", "n/a", "none", "null", "not available", "unknown"}

MODEL_SPECIES: dict[str, list[str]] = {
    "Escherichia coli": ["ecoli_k12_mg1655", "ecoli_bl21_de3", "ecoli_w", "ecoli_nissle_1917"],
    "Saccharomyces cerevisiae": ["scerevisiae_s288c"],
    "Bacillus subtilis": ["bsubtilis_168"],
    "Corynebacterium glutamicum": ["cglutamicum_atcc13032"],
    "Pseudomonas putida": ["pputida_kt2440"],
    "Komagataella phaffii": ["kphaffii_pichia_pastoris"],
    "Streptomyces coelicolor": ["scoelicolor_a3_2"],
    "Yarrowia lipolytica": ["ylipolytica"],
    "Cupriavidus necator": ["cnecator_h16"],
}

MODEL_STRAINS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\b(?:k-?12\b.*\bmg1655\b|mg1655\b)", re.I), "ecoli_k12_mg1655"),
    (re.compile(r"\bbl\s*-?\s*21\s*\(?de3\)?\b", re.I), "ecoli_bl21_de3"),
    (re.compile(r"\bnissle\s*1917\b", re.I), "ecoli_nissle_1917"),
    (re.compile(r"\bescherichia coli\s+w\b", re.I), "ecoli_w"),
    (re.compile(r"\bs288c\b", re.I), "scerevisiae_s288c"),
    (re.compile(r"\bbacillus subtilis\b.*\b168\b", re.I), "bsubtilis_168"),
    (re.compile(r"\batcc\s*13032\b", re.I), "cglutamicum_atcc13032"),
    (re.compile(r"\bkt2440\b", re.I), "pputida_kt2440"),
    (re.compile(r"\bstreptomyces coelicolor\b.*\ba3\s*\(?2\)?", re.I), "scoelicolor_a3_2"),
    (re.compile(r"\b(?:h16|dsm\s*428)\b", re.I), "cnecator_h16"),
]

CELL_LINES: list[tuple[re.Pattern[str], str, str]] = [
    (re.compile(r"\bhek\s*-?\s*293\s*t(?:/17)?\b|\bhek293t\b", re.I), "HEK-293T", "human_cell_line"),
    (re.compile(r"\bhek\s*-?\s*293\s*f\b|\bhek293-f\b", re.I), "HEK-293F", "human_cell_line"),
    (re.compile(r"\bhek\s*-?\s*293\b|\bhek293\b", re.I), "HEK-293", "human_cell_line"),
    (re.compile(r"\bcho\s*-?\s*k1\b|chinese hamster ovary.*\bk1\b", re.I), "CHO-K1", "mammalian_cell_line"),
    (re.compile(r"\bcho\b|chinese hamster ovary", re.I), "CHO", "mammalian_cell_line"),
    (re.compile(r"\bcos\s*-?\s*7\b|\bcos7\b", re.I), "COS-7", "mammalian_cell_line"),
    (re.compile(r"\bcos\s*-?\s*1\b", re.I), "COS-1", "mammalian_cell_line"),
    (re.compile(r"\bcos\b", re.I), "COS (unspecified)", "mammalian_cell_line"),
    (re.compile(r"\bhela\b", re.I), "HeLa", "human_cell_line"),
    (re.compile(r"\bsf\s*-?\s*9\b|spodoptera frugiperda.*sf9", re.I), "Sf9", "insect_cell_line"),
    (re.compile(r"\bsf\s*-?\s*21\b", re.I), "Sf21", "insect_cell_line"),
    (re.compile(r"\bhigh\s*five\b|\bhi5\b", re.I), "High Five", "insect_cell_line"),
    (re.compile(r"\bs2\s+cells?\b|drosophila melanogaster s2", re.I), "Drosophila S2", "insect_cell_line"),
    (re.compile(r"\ba549\b", re.I), "A549", "human_cell_line"),
    (re.compile(r"\bmcf\s*-?\s*7\b", re.I), "MCF-7", "human_cell_line"),
    (re.compile(r"\bhep\s*-?\s*g2\b", re.I), "HepG2", "human_cell_line"),
]

MICROBIAL_SPECIES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bescherichi[as]\s+coli\b|\be\.?\s*coli\b", re.I), "Escherichia coli"),
    (re.compile(r"\bsaccharomyces\s+cerevisiae\b", re.I), "Saccharomyces cerevisiae"),
    (re.compile(r"\b(?:pichia\s+pastoris|komagataella\s+phaffii)\b", re.I), "Komagataella phaffii"),
    (re.compile(r"\byarrowia\s+lipolytica\b", re.I), "Yarrowia lipolytica"),
    (re.compile(r"\bbacillus\s+subtilis\b", re.I), "Bacillus subtilis"),
    (re.compile(r"\bcorynebacterium\s+glutamicum\b", re.I), "Corynebacterium glutamicum"),
    (re.compile(r"\bpseudomonas\s+putida\b", re.I), "Pseudomonas putida"),
    (re.compile(r"\bstreptomyces\s+coelicolor\b", re.I), "Streptomyces coelicolor"),
    (re.compile(r"\b(?:cupriavidus\s+necator|ralstonia\s+eutropha)\b", re.I), "Cupriavidus necator"),
    (re.compile(r"\bstreptomyces\s+lividans\b", re.I), "Streptomyces lividans"),
    (re.compile(r"\bagrobacterium\s+tumefaciens\b", re.I), "Agrobacterium tumefaciens"),
]

STRAIN_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bbl\s*-?\s*21\s*\(?de3\)?\s*p?lys\s*s\b", re.I), "BL21(DE3)pLysS"),
    (re.compile(r"\bbl\s*-?\s*21\s*\(?de3\)?\b", re.I), "BL21(DE3)"),
    (re.compile(r"\bbl\s*-?\s*21\b", re.I), "BL21"),
    (re.compile(r"\brosetta\s*2?\s*\(?de3\)?\b|\brossetta\s*2?\s*\(?de3\)?\b|\bros2\s*\(?de3\)?", re.I), "Rosetta(DE3)"),
    (re.compile(r"\bdh5\s*(?:alpha|a|α)\b", re.I), "DH5alpha"),
    (re.compile(r"\bdh10b\b", re.I), "DH10B"),
    (re.compile(r"\bjm109\b", re.I), "JM109"),
    (re.compile(r"\bhb101\b", re.I), "HB101"),
    (re.compile(r"\bc41\s*\(?de3\)?\b", re.I), "C41(DE3)"),
    (re.compile(r"\bc43\s*\(?de3\)?\b", re.I), "C43(DE3)"),
    (re.compile(r"\bxl\s*-?\s*1\s*-?\s*blue\b", re.I), "XL1-Blue"),
    (re.compile(r"\btop\s*10\b", re.I), "TOP10"),
    (re.compile(r"\bmg1655\b", re.I), "K-12 MG1655"),
    (re.compile(r"\bgs115\b", re.I), "GS115"),
    (re.compile(r"\bkm71\b", re.I), "KM71"),
    (re.compile(r"\bsmd1168\b", re.I), "SMD1168"),
]


@dataclass(frozen=True)
class HostNormalization:
    raw_label: str
    clean_label: str
    host_id: str
    canonical_name: str
    canonical_species: str | None
    strain_or_cell_line: str | None
    host_kind: str
    context_qualifier: str | None
    role_candidate: str
    normalization_status: str
    normalization_rule: str
    confidence: float
    is_twelve_host_species: int
    model_host_ids_json: str
    model_mapping_status: str


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def clean_label(value: str) -> str:
    result = re.sub(r"\s+", " ", str(value or "").replace("‐", "-").replace("–", "-")).strip(" ;,")
    result = re.sub(r"\s+evidence$", "", result, flags=re.I).strip()
    return result


def stable_id(prefix: str, value: str, length: int = 16) -> str:
    return prefix + hashlib.sha256(value.encode("utf-8")).hexdigest()[:length]


def context_qualifier(label: str) -> str | None:
    qualifiers = []
    for pattern, name in [
        (r"\bmicrosomes?\b", "microsomes"),
        (r"\bmembranes?\b", "membrane_fraction"),
        (r"\bprotoplasts?\b", "protoplast"),
        (r"\badipocytes?\b", "differentiated_cells"),
        (r"\bbaculovirus(?:-infected)?\b", "baculovirus_system"),
        (r"\btransfected\b|\brecombinant\b", "recombinant_or_transfected"),
    ]:
        if re.search(pattern, label, re.I):
            qualifiers.append(name)
    return ";".join(qualifiers) or None


def role_for(label: str, kind: str, qualifier: str | None) -> str:
    if kind in {"microbial_host", "plant_host"}:
        return "microbial_or_organism_expression_host_candidate"
    if kind.endswith("cell_line"):
        if qualifier and "membrane" in qualifier or qualifier and "microsomes" in qualifier:
            return "cell_or_tissue_assay_context_ambiguous"
        return "recombinant_cell_expression_system_candidate"
    if re.search(r"\bmicrosomes?|membranes?|fibroblasts?|macrophages?|carcinoma|cancer|tissue|living cells?\b", label, re.I):
        return "cell_or_tissue_assay_context_ambiguous"
    if re.search(r"\bbaculovirus\b", label, re.I):
        return "vector_or_delivery_annotation"
    if re.search(r"\bcell[- ]?free|reticulocyte|wheat germ\b", label, re.I):
        return "cell_free_expression_candidate"
    return "unresolved_host_or_assay_context"


def normalize_host(raw: str) -> HostNormalization:
    label = clean_label(raw)
    lower = label.lower()
    qualifier = context_qualifier(label)
    species: str | None = None
    strain: str | None = None
    kind = "unresolved_context"
    canonical = label
    rule = "preserve_unresolved_label"
    status = "review_required"
    confidence = 0.35

    for pattern, cell_line, cell_kind in CELL_LINES:
        if pattern.search(label):
            strain = cell_line
            canonical = cell_line
            kind = cell_kind
            rule = "cell_line_alias_v1"
            status = "rule_normalized"
            confidence = 0.9
            break
    else:
        for pattern, candidate_species in MICROBIAL_SPECIES:
            if pattern.search(label):
                species = candidate_species
                kind = "microbial_host"
                for strain_pattern, normalized_strain in STRAIN_PATTERNS:
                    if strain_pattern.search(label):
                        strain = normalized_strain
                        break
                canonical = species + (f" {strain}" if strain else "")
                rule = "microbial_species_strain_alias_v1"
                status = "rule_normalized"
                confidence = 0.95 if strain else 0.88
                break

    if kind == "unresolved_context":
        if re.fullmatch(r"yeast(?: cells?| strain [A-Za-z0-9_.()/-]+)?", label, re.I):
            canonical = "Yeast (unspecified)"
            kind = "microbial_host"
            rule = "generic_yeast_v1"
            status = "partially_normalized"
            confidence = 0.55
        elif re.search(r"\barabidopsis thaliana\b", label, re.I):
            species, canonical, kind = "Arabidopsis thaliana", "Arabidopsis thaliana", "plant_host"
            rule, status, confidence = "plant_species_v1", "rule_normalized", 0.85
        elif re.search(r"\bnicotiana (?:tabacum|benthamiana)\b", label, re.I):
            match = re.search(r"\bNicotiana (?:tabacum|benthamiana)\b", label, re.I)
            species = match.group(0).capitalize() if match else None
            canonical, kind = species or label, "plant_host"
            rule, status, confidence = "plant_species_v1", "rule_normalized", 0.85

    model_ids: list[str] = []
    mapping_status = "not_in_twelve_host_layer"
    if species in MODEL_SPECIES:
        model_ids = list(MODEL_SPECIES[species])
        mapping_status = "species_context"
        for pattern, model_id in MODEL_STRAINS:
            if pattern.search(label) and model_id in model_ids:
                model_ids = [model_id]
                mapping_status = "exact_or_alias_strain_context"
                break
        if species == "Komagataella phaffii":
            mapping_status = "species_alias_context"
    key = "|".join([canonical, kind, qualifier or ""])
    host_id = stable_id("EH", key)
    role = role_for(label, kind, qualifier)
    return HostNormalization(
        raw_label=raw,
        clean_label=label,
        host_id=host_id,
        canonical_name=canonical,
        canonical_species=species,
        strain_or_cell_line=strain,
        host_kind=kind,
        context_qualifier=qualifier,
        role_candidate=role,
        normalization_status=status,
        normalization_rule=rule,
        confidence=confidence,
        is_twelve_host_species=int(bool(model_ids)),
        model_host_ids_json=json.dumps(model_ids, ensure_ascii=False),
        model_mapping_status=mapping_status,
    )


def split_chassis_text(value: str | None) -> list[str]:
    if not value:
        return []
    value = re.sub(r"\s+evidence$", "", str(value).strip(), flags=re.I)
    return [clean_label(part) for part in SPLITTER.split(value) if clean_label(part).lower() not in PLACEHOLDERS]


def numeric_pmids(value: Any) -> set[str]:
    if value is None:
        return set()
    values = value if isinstance(value, list) else [value]
    return {str(item).strip() for item in values if str(item).strip().isdigit() and int(str(item).strip()) > 0}


def source_entries(value: str | None) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    try:
        payload = json.loads(value or "[]")
    except Exception:
        return result
    if not isinstance(payload, list):
        payload = [payload]
    for item in payload:
        if not isinstance(item, dict):
            continue
        labels = split_chassis_text(item.get("value_text") or item.get("display_text"))
        pmids = numeric_pmids(item.get("pmids"))
        citation_text: dict[str, str] = {}
        for citation in item.get("citations") or []:
            if not isinstance(citation, dict):
                continue
            citation_pmids = numeric_pmids(citation.get("pmid"))
            pmids.update(citation_pmids)
            for pmid in citation_pmids:
                if citation.get("citation_text"):
                    citation_text[pmid] = str(citation["citation_text"]).strip()
        for label in labels:
            current = result.setdefault(label, {"pmids": set(), "citation_text": {}, "items": [], "grouped": False})
            current["pmids"].update(pmids)
            current["citation_text"].update(citation_text)
            current["items"].append(item)
            current["grouped"] = current["grouped"] or len(labels) > 1
    return result


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA foreign_keys=ON;
        CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE source_files(
          source_name TEXT PRIMARY KEY,path TEXT NOT NULL,size_bytes INTEGER,modified_at TEXT,
          sha256 TEXT,checksum_status TEXT NOT NULL,redistribution_boundary TEXT NOT NULL
        );
        CREATE TABLE host_entities(
          host_id TEXT PRIMARY KEY,canonical_name TEXT NOT NULL,canonical_species TEXT,
          strain_or_cell_line TEXT,host_kind TEXT NOT NULL,context_qualifier TEXT,
          is_twelve_host_species INTEGER NOT NULL,model_host_ids_json TEXT NOT NULL,
          model_mapping_status TEXT NOT NULL
        );
        CREATE TABLE host_aliases(
          raw_label TEXT PRIMARY KEY,clean_label TEXT NOT NULL,host_id TEXT NOT NULL,
          role_candidate TEXT NOT NULL,normalization_status TEXT NOT NULL,
          normalization_rule TEXT NOT NULL,confidence REAL NOT NULL,record_count INTEGER NOT NULL,
          FOREIGN KEY(host_id) REFERENCES host_entities(host_id)
        );
        CREATE INDEX idx_host_aliases_host ON host_aliases(host_id);
        CREATE TABLE evidence_type_definitions(
          evidence_type TEXT PRIMARY KEY,rank_order INTEGER NOT NULL,definition TEXT NOT NULL,
          is_experimental INTEGER NOT NULL,minimum_requirements_json TEXT NOT NULL
        );
        CREATE TABLE curation_status_definitions(
          curation_status TEXT PRIMARY KEY,definition TEXT NOT NULL
        );
        CREATE TABLE outcome_vocabularies(
          dimension TEXT NOT NULL,value TEXT NOT NULL,definition TEXT NOT NULL,
          PRIMARY KEY(dimension,value)
        );
        CREATE TABLE legacy_host_annotations(
          legacy_annotation_id TEXT PRIMARY KEY,host_id TEXT NOT NULL,raw_host_label TEXT NOT NULL,
          reaction_id TEXT NOT NULL,reactenz_reaction_id TEXT,biopart_id TEXT NOT NULL,
          reactenz_enzyme_id TEXT,enzyme_name TEXT,gene_name_primary TEXT,source_organism TEXT,
          protein_id TEXT,has_sequence INTEGER,sequence_length INTEGER,role_candidate TEXT NOT NULL,
          evidence_type TEXT NOT NULL,curation_status TEXT NOT NULL,citation_scope TEXT NOT NULL,
          pmid_count INTEGER NOT NULL,source_json_sha256 TEXT,raw_source_json TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY(host_id) REFERENCES host_entities(host_id),
          FOREIGN KEY(evidence_type) REFERENCES evidence_type_definitions(evidence_type),
          FOREIGN KEY(curation_status) REFERENCES curation_status_definitions(curation_status)
        );
        CREATE INDEX idx_legacy_host ON legacy_host_annotations(host_id);
        CREATE INDEX idx_legacy_enzyme ON legacy_host_annotations(biopart_id);
        CREATE INDEX idx_legacy_reaction ON legacy_host_annotations(reaction_id);
        CREATE TABLE papers(
          pmid TEXT PRIMARY KEY,doi TEXT,title TEXT,citation_text TEXT,publication_year INTEGER,
          full_text_status TEXT NOT NULL DEFAULT 'not_checked',local_source_path TEXT,
          screening_status TEXT NOT NULL DEFAULT 'not_screened',created_at TEXT NOT NULL
        );
        CREATE TABLE legacy_annotation_citations(
          legacy_annotation_id TEXT NOT NULL,pmid TEXT NOT NULL,citation_text TEXT,
          citation_scope TEXT NOT NULL,
          PRIMARY KEY(legacy_annotation_id,pmid),
          FOREIGN KEY(legacy_annotation_id) REFERENCES legacy_host_annotations(legacy_annotation_id),
          FOREIGN KEY(pmid) REFERENCES papers(pmid)
        );
        CREATE INDEX idx_legacy_citations_pmid ON legacy_annotation_citations(pmid);
        CREATE TABLE paper_host_candidates(
          pmid TEXT NOT NULL,host_id TEXT NOT NULL,legacy_annotation_count INTEGER NOT NULL,
          enzyme_count INTEGER NOT NULL,reaction_count INTEGER NOT NULL,sequence_enzyme_count INTEGER NOT NULL,
          twelve_host_priority INTEGER NOT NULL,priority_score REAL NOT NULL,
          PRIMARY KEY(pmid,host_id),FOREIGN KEY(pmid) REFERENCES papers(pmid),
          FOREIGN KEY(host_id) REFERENCES host_entities(host_id)
        );
        CREATE TABLE paper_screening(
          pmid TEXT PRIMARY KEY,screening_status TEXT NOT NULL,full_text_status TEXT NOT NULL,
          assigned_priority TEXT NOT NULL,reviewer TEXT,screening_note TEXT,updated_at TEXT NOT NULL,
          FOREIGN KEY(pmid) REFERENCES papers(pmid)
        );
        CREATE TABLE expression_assertions(
          assertion_id TEXT PRIMARY KEY,host_id TEXT NOT NULL,source_organism TEXT,
          expression_mode TEXT NOT NULL,enzyme_identity_status TEXT NOT NULL,
          evidence_type TEXT NOT NULL,curation_status TEXT NOT NULL,is_experimental INTEGER NOT NULL,
          source_db TEXT NOT NULL,source_record_id TEXT,raw_cache_path TEXT,mapping_details_json TEXT NOT NULL,
          created_at TEXT NOT NULL,FOREIGN KEY(host_id) REFERENCES host_entities(host_id),
          FOREIGN KEY(evidence_type) REFERENCES evidence_type_definitions(evidence_type),
          FOREIGN KEY(curation_status) REFERENCES curation_status_definitions(curation_status)
        );
        CREATE TABLE expression_enzyme_links(
          assertion_id TEXT NOT NULL,biopart_id TEXT,reactenz_enzyme_id TEXT,enzyme_form_id TEXT,
          accession TEXT,sequence_sha256 TEXT,link_method TEXT NOT NULL,is_primary INTEGER NOT NULL,
          PRIMARY KEY(assertion_id,biopart_id,link_method),
          FOREIGN KEY(assertion_id) REFERENCES expression_assertions(assertion_id)
        );
        CREATE TABLE expression_reaction_links(
          assertion_id TEXT NOT NULL,reaction_id TEXT,reactenz_reaction_id TEXT,
          assay_substrates_text TEXT,assay_products_text TEXT,reaction_link_status TEXT NOT NULL,
          PRIMARY KEY(assertion_id,reaction_id),FOREIGN KEY(assertion_id) REFERENCES expression_assertions(assertion_id)
        );
        CREATE TABLE expression_constructs(
          construct_id TEXT PRIMARY KEY,assertion_id TEXT NOT NULL,vector TEXT,promoter TEXT,
          tag TEXT,signal_peptide TEXT,resistance_marker TEXT,codon_optimization TEXT,
          gene_construct TEXT,plasmid_accession TEXT,fusion_partner TEXT,raw_construct_text TEXT,
          FOREIGN KEY(assertion_id) REFERENCES expression_assertions(assertion_id)
        );
        CREATE TABLE expression_conditions(
          condition_id TEXT PRIMARY KEY,assertion_id TEXT NOT NULL,medium TEXT,inducer TEXT,
          inducer_concentration_value REAL,inducer_concentration_unit TEXT,induction_od TEXT,
          expression_temperature_c REAL,expression_time_value REAL,expression_time_unit TEXT,
          oxygen_aeration TEXT,ph REAL,cofactor_supplementation TEXT,chaperone_coexpression TEXT,
          raw_condition_text TEXT,FOREIGN KEY(assertion_id) REFERENCES expression_assertions(assertion_id)
        );
        CREATE TABLE expression_outcomes(
          outcome_id TEXT PRIMARY KEY,assertion_id TEXT NOT NULL,expression_detected TEXT NOT NULL,
          solubility TEXT NOT NULL,activity TEXT NOT NULL,purification TEXT NOT NULL,
          localization TEXT,yield_text TEXT,conversion_text TEXT,titre_text TEXT,
          negative_result_text TEXT,success_interpretation TEXT NOT NULL,raw_outcome_text TEXT,
          FOREIGN KEY(assertion_id) REFERENCES expression_assertions(assertion_id)
        );
        CREATE TABLE expression_measurements(
          measurement_id TEXT PRIMARY KEY,assertion_id TEXT NOT NULL,measurement_type TEXT NOT NULL,
          raw_value_text TEXT,value_numeric REAL,unit TEXT,normalization_status TEXT NOT NULL,
          FOREIGN KEY(assertion_id) REFERENCES expression_assertions(assertion_id)
        );
        CREATE TABLE expression_citations(
          assertion_id TEXT NOT NULL,pmid TEXT,doi TEXT,source_url TEXT,verification_status TEXT NOT NULL,
          PRIMARY KEY(assertion_id,pmid,doi),FOREIGN KEY(assertion_id) REFERENCES expression_assertions(assertion_id)
        );
        CREATE TABLE expression_source_spans(
          span_id TEXT PRIMARY KEY,assertion_id TEXT NOT NULL,source_file TEXT NOT NULL,
          section TEXT,page_or_table TEXT,paragraph_or_locator TEXT,evidence_paraphrase TEXT,
          source_span_hash TEXT,extraction_method TEXT NOT NULL,
          FOREIGN KEY(assertion_id) REFERENCES expression_assertions(assertion_id)
        );
        CREATE TABLE coverage_status(
          biopart_id TEXT NOT NULL,host_id TEXT NOT NULL,status TEXT NOT NULL,candidate_paper_count INTEGER NOT NULL,
          screened_paper_count INTEGER NOT NULL,verified_assertion_count INTEGER NOT NULL,updated_at TEXT NOT NULL,
          PRIMARY KEY(biopart_id,host_id),FOREIGN KEY(host_id) REFERENCES host_entities(host_id)
        );
        CREATE TABLE curation_audit(
          audit_id INTEGER PRIMARY KEY AUTOINCREMENT,assertion_id TEXT,legacy_annotation_id TEXT,
          action TEXT NOT NULL,previous_value TEXT,new_value TEXT,rule_id TEXT,reviewer TEXT NOT NULL,
          note TEXT,created_at TEXT NOT NULL
        );
        CREATE TABLE qa_results(
          check_name TEXT PRIMARY KEY,passed INTEGER NOT NULL,observed_value TEXT NOT NULL,
          expected_value TEXT,checked_at TEXT NOT NULL
        );
        CREATE VIEW expression_evidence_flat AS
          SELECT a.assertion_id,a.host_id,h.canonical_name AS expression_host,h.strain_or_cell_line,
                 a.source_organism,a.expression_mode,a.enzyme_identity_status,a.evidence_type,a.curation_status,
                 o.expression_detected,o.solubility,o.activity,o.purification,o.localization,
                 c.vector,c.promoter,c.tag,c.signal_peptide,cond.inducer,cond.expression_temperature_c
          FROM expression_assertions a JOIN host_entities h USING(host_id)
          LEFT JOIN expression_outcomes o USING(assertion_id)
          LEFT JOIN expression_constructs c USING(assertion_id)
          LEFT JOIN expression_conditions cond USING(assertion_id);
        """
    )


def seed_definitions(conn: sqlite3.Connection) -> None:
    evidence = [
        ("E1_active_soluble_exact_enzyme", 1, "Exact enzyme/form was experimentally expressed in the exact host and reported both soluble and active.", 1, {"enzyme": "exact", "host": "exact", "solubility": "soluble", "activity": "active", "publication": "primary_full_text"}),
        ("E2_active_exact_enzyme", 2, "Exact enzyme/form was active in the expression host; solubility was not reported.", 1, {"enzyme": "exact", "host": "exact", "activity": "active", "publication": "primary_full_text"}),
        ("E3_expressed_or_purified_exact_enzyme", 3, "Exact enzyme/form was expressed or purified, without direct catalytic activity confirmation.", 1, {"enzyme": "exact", "host": "exact", "expression_or_purification": "reported"}),
        ("E4_host_annotation_with_publication", 4, "A source database links the enzyme and host to a publication, but experiment-level details are not verified.", 0, {"host": "database_annotation", "publication": "present"}),
        ("E5_legacy_label_only", 5, "Only a legacy chassis/host label is available.", 0, {"host": "legacy_label"}),
        ("P_predicted_compatibility", 100, "Compatibility is computationally predicted and is not experimental expression evidence.", 0, {"basis": "prediction_only"}),
    ]
    conn.executemany("INSERT INTO evidence_type_definitions VALUES (?,?,?,?,?)", [(a,b,c,d,json.dumps(e,ensure_ascii=False)) for a,b,c,d,e in evidence])
    statuses = [
        ("database_annotation_unverified", "A database annotation exists but the primary experiment has not been checked."),
        ("auto_extracted_pending_review", "Fields were automatically extracted and await human review."),
        ("full_text_verified", "The primary full text or supplementary information was reviewed."),
        ("abstract_only", "Only abstract-level evidence was available."),
        ("full_text_unavailable", "A candidate paper exists but accessible full text was not obtained."),
        ("disputed", "Source and publication evidence conflict."),
        ("rejected_not_expression_evidence", "The source context was reviewed and is not expression evidence."),
        ("predicted_only", "No experimental expression claim is made."),
    ]
    conn.executemany("INSERT INTO curation_status_definitions VALUES (?,?)", statuses)
    vocab = {
        "expression_detected": ["yes", "no", "not_reported"],
        "solubility": ["soluble", "partially_soluble", "insoluble", "not_reported"],
        "activity": ["active", "inactive", "not_tested", "not_reported"],
        "purification": ["purified", "not_purified", "not_reported"],
        "success_interpretation": ["successful_active_soluble", "successful_active", "expressed_only", "negative_expression", "insoluble", "inactive", "mixed", "not_interpretable"],
    }
    conn.executemany("INSERT INTO outcome_vocabularies VALUES (?,?,?)", [(dimension, value, f"Controlled value for {dimension}.") for dimension, values in vocab.items() for value in values])


def file_record(path: Path, boundary: str) -> tuple:
    stat = path.stat()
    return (path.name, str(path), stat.st_size, datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(), None, "not_computed_large_source", boundary)


def export_query(conn: sqlite3.Connection, sql: str, path: Path, gz: bool = False) -> int:
    cursor = conn.execute(sql)
    columns = [item[0] for item in cursor.description]
    count = 0
    if gz:
        raw_handle = path.open("wb")
        gzip_handle = gzip.GzipFile(filename="", mode="wb", fileobj=raw_handle, mtime=0)
        handle = io.TextIOWrapper(gzip_handle, encoding="utf-8", newline="")
    else:
        raw_handle = None
        gzip_handle = None
        handle = path.open("w", encoding="utf-8", newline="")
    try:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(columns)
        for row in cursor:
            writer.writerow(row)
            count += 1
    finally:
        handle.close()
        if gzip_handle is not None and not gzip_handle.closed:
            gzip_handle.close()
        if raw_handle is not None and not raw_handle.closed:
            raw_handle.close()
    return count


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Stage A/B foundation for experimental heterologous-expression evidence.")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    for path in (CORE_DB, UPSTREAM_DB, HOST_CONTEXT_DB):
        if not path.exists():
            raise FileNotFoundError(path)
    WORK.mkdir(parents=True, exist_ok=True)
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    temp_db = OUTPUT_DB.with_suffix(".sqlite.tmp")
    if temp_db.exists():
        temp_db.unlink()
    if OUTPUT_DB.exists() and not args.force:
        raise FileExistsError(f"{OUTPUT_DB} exists; pass --force to rebuild")
    conn = sqlite3.connect(temp_db)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=30000")
    create_schema(conn)
    seed_definitions(conn)
    conn.executemany("INSERT INTO metadata VALUES (?,?)", [
        ("layer", "experimental_expression_evidence_foundation"),
        ("stage", "A_and_B"),
        ("schema_version", "EXPRESSION_EVIDENCE_V1"),
        ("generated_at", utc_now()),
        ("interpretation_boundary", "Legacy chassis labels, host metabolic context, and predicted compatibility are not experimental expression evidence."),
        ("absence_boundary", "No evidence found must not be interpreted as failed expression."),
    ])
    conn.executemany("INSERT INTO source_files VALUES (?,?,?,?,?,?,?)", [
        file_record(CORE_DB, "Internal ReactEnzDB release source."),
        file_record(UPSTREAM_DB, "Internal upstream source; raw source redistribution requires review."),
        file_record(HOST_CONTEXT_DB, "Separate twelve-host metabolic-model context; never counted as experimental expression evidence."),
    ])
    conn.execute("ATTACH DATABASE ? AS core", (str(CORE_DB),))
    conn.execute("ATTACH DATABASE ? AS upstream", (str(UPSTREAM_DB),))

    label_counts = {row[0]: int(row[1]) for row in conn.execute("SELECT label,record_count FROM core.web_chassis_labels")}
    normalizations = {label: normalize_host(label) for label in label_counts}
    entities: dict[str, HostNormalization] = {}
    for norm in normalizations.values():
        entities.setdefault(norm.host_id, norm)
    conn.executemany(
        "INSERT INTO host_entities VALUES (?,?,?,?,?,?,?,?,?)",
        [(n.host_id,n.canonical_name,n.canonical_species,n.strain_or_cell_line,n.host_kind,n.context_qualifier,n.is_twelve_host_species,n.model_host_ids_json,n.model_mapping_status) for n in entities.values()],
    )
    conn.executemany(
        "INSERT INTO host_aliases VALUES (?,?,?,?,?,?,?,?)",
        [(n.raw_label,n.clean_label,n.host_id,n.role_candidate,n.normalization_status,n.normalization_rule,n.confidence,label_counts[n.raw_label]) for n in normalizations.values()],
    )

    query = """
      SELECT cr.chassis_label,cr.reaction_id,rid.reactenz_reaction_id,cr.biopart_id,eid.reactenz_enzyme_id,
             cr.enzyme_name,cr.gene_name_primary,cr.organism,cr.protein_id,cr.has_sequence,cr.sequence_length,
             br.chassis_json
      FROM core.web_chassis_records cr
      LEFT JOIN core.web_reaction_ids rid USING(reaction_id)
      LEFT JOIN core.web_enzyme_ids eid USING(biopart_id)
      LEFT JOIN upstream.biopart_reactions br ON br.reaction_id=cr.reaction_id AND br.biopart_id=cr.biopart_id
      ORDER BY cr.chassis_label,cr.reaction_id,cr.biopart_id
    """
    legacy_rows = []
    citation_rows = []
    paper_text: dict[str, str] = {}
    generated = utc_now()
    missing_source_json = 0
    for row in conn.execute(query):
        raw_label = row["chassis_label"]
        norm = normalizations[raw_label]
        parsed = source_entries(row["chassis_json"])
        source = parsed.get(clean_label(raw_label), {"pmids": set(), "citation_text": {}, "items": [], "grouped": False})
        pmids = sorted(source["pmids"], key=int)
        if row["chassis_json"] is None:
            missing_source_json += 1
        annotation_id = stable_id("LHA", "|".join([raw_label,row["reaction_id"],row["biopart_id"]]), 20)
        evidence_type = "E4_host_annotation_with_publication" if pmids else "E5_legacy_label_only"
        raw_items = json.dumps(source["items"], ensure_ascii=False, separators=(",", ":")) if source["items"] else None
        raw_hash = hashlib.sha256(raw_items.encode("utf-8")).hexdigest() if raw_items else None
        scope = "grouped_host_list" if source.get("grouped") else "single_host_label" if pmids else "no_publication_link"
        legacy_rows.append((annotation_id,norm.host_id,raw_label,row["reaction_id"],row["reactenz_reaction_id"],row["biopart_id"],row["reactenz_enzyme_id"],row["enzyme_name"],row["gene_name_primary"],row["organism"],row["protein_id"],row["has_sequence"],row["sequence_length"],norm.role_candidate,evidence_type,"database_annotation_unverified",scope,len(pmids),raw_hash,raw_items,generated))
        for pmid in pmids:
            ctext = source["citation_text"].get(pmid)
            if ctext and pmid not in paper_text:
                paper_text[pmid] = ctext
            citation_rows.append((annotation_id,pmid,ctext,scope))
    conn.executemany("INSERT INTO legacy_host_annotations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", legacy_rows)
    all_pmids = sorted({row[1] for row in citation_rows}, key=int)
    conn.executemany("INSERT INTO papers(pmid,citation_text,created_at) VALUES (?,?,?)", [(pmid,paper_text.get(pmid),generated) for pmid in all_pmids])
    conn.executemany("INSERT INTO legacy_annotation_citations VALUES (?,?,?,?)", citation_rows)
    conn.execute(
        """INSERT INTO paper_host_candidates
        SELECT c.pmid,l.host_id,COUNT(DISTINCT l.legacy_annotation_id),COUNT(DISTINCT l.biopart_id),
               COUNT(DISTINCT l.reaction_id),COUNT(DISTINCT CASE WHEN l.has_sequence=1 THEN l.biopart_id END),
               MAX(h.is_twelve_host_species),
               ROUND(50.0*MAX(h.is_twelve_host_species)+MIN(25,COUNT(DISTINCT l.biopart_id))+MIN(15,COUNT(DISTINCT l.reaction_id))+
                 5.0*MAX(CASE WHEN l.role_candidate LIKE '%expression%candidate' THEN 1 ELSE 0 END),2)
        FROM legacy_annotation_citations c JOIN legacy_host_annotations l USING(legacy_annotation_id)
        JOIN host_entities h USING(host_id) GROUP BY c.pmid,l.host_id"""
    )
    conn.execute(
        """INSERT INTO paper_screening
        SELECT p.pmid,'not_screened',p.full_text_status,
               CASE WHEN MAX(ph.priority_score)>=75 THEN 'high' WHEN MAX(ph.priority_score)>=40 THEN 'medium' ELSE 'low' END,
               NULL,NULL,? FROM papers p JOIN paper_host_candidates ph USING(pmid) GROUP BY p.pmid""",
        (generated,),
    )
    conn.execute(
        """INSERT INTO coverage_status
        SELECT l.biopart_id,l.host_id,'not_screened',COUNT(DISTINCT c.pmid),0,0,?
        FROM legacy_host_annotations l LEFT JOIN legacy_annotation_citations c USING(legacy_annotation_id)
        GROUP BY l.biopart_id,l.host_id""",
        (generated,),
    )

    expected = conn.execute("SELECT COUNT(*) FROM core.web_chassis_records").fetchone()[0]
    checks = [
        ("legacy_row_count_matches_web_release", len(legacy_rows) == expected, len(legacy_rows), expected),
        ("all_aliases_have_host_entity", conn.execute("SELECT COUNT(*) FROM host_aliases a LEFT JOIN host_entities h USING(host_id) WHERE h.host_id IS NULL").fetchone()[0] == 0, conn.execute("SELECT COUNT(*) FROM host_aliases a LEFT JOIN host_entities h USING(host_id) WHERE h.host_id IS NULL").fetchone()[0], 0),
        ("no_duplicate_legacy_ids", conn.execute("SELECT COUNT(*)-COUNT(DISTINCT legacy_annotation_id) FROM legacy_host_annotations").fetchone()[0] == 0, conn.execute("SELECT COUNT(*)-COUNT(DISTINCT legacy_annotation_id) FROM legacy_host_annotations").fetchone()[0], 0),
        ("all_candidate_pmids_numeric", all(pmid.isdigit() for pmid in all_pmids), sum(not p.isdigit() for p in all_pmids), 0),
        ("stage_ab_has_no_claimed_experimental_assertions", conn.execute("SELECT COUNT(*) FROM expression_assertions").fetchone()[0] == 0, conn.execute("SELECT COUNT(*) FROM expression_assertions").fetchone()[0], 0),
        ("host_context_not_loaded_as_expression_evidence", conn.execute("SELECT COUNT(*) FROM expression_assertions WHERE source_db LIKE '%host_context%'").fetchone()[0] == 0, conn.execute("SELECT COUNT(*) FROM expression_assertions WHERE source_db LIKE '%host_context%'").fetchone()[0], 0),
        ("foreign_key_integrity", len(conn.execute("PRAGMA foreign_key_check").fetchall()) == 0, len(conn.execute("PRAGMA foreign_key_check").fetchall()), 0),
    ]
    conn.executemany("INSERT INTO qa_results VALUES (?,?,?,?,?)", [(name,int(passed),str(observed),str(expected_value),generated) for name,passed,observed,expected_value in checks])
    conn.commit()

    exports = {
        "host_ontology.tsv": export_query(conn, "SELECT * FROM host_entities ORDER BY canonical_name,host_id", DOWNLOADS / "host_ontology.tsv"),
        "host_aliases.tsv": export_query(conn, "SELECT * FROM host_aliases ORDER BY record_count DESC,raw_label", DOWNLOADS / "host_aliases.tsv"),
        "legacy_chassis_assertions.tsv.gz": export_query(conn, "SELECT legacy_annotation_id,host_id,raw_host_label,reaction_id,reactenz_reaction_id,biopart_id,reactenz_enzyme_id,enzyme_name,gene_name_primary,source_organism,protein_id,has_sequence,sequence_length,role_candidate,evidence_type,curation_status,citation_scope,pmid_count,source_json_sha256 FROM legacy_host_annotations ORDER BY raw_host_label,reaction_id,biopart_id", DOWNLOADS / "legacy_chassis_assertions.tsv.gz", True),
        "expression_candidate_papers.tsv": export_query(conn, "SELECT p.pmid,p.citation_text,p.full_text_status,p.screening_status,ps.assigned_priority,COUNT(DISTINCT ph.host_id) host_count,SUM(ph.legacy_annotation_count) legacy_annotations,SUM(ph.enzyme_count) enzyme_host_links,SUM(ph.reaction_count) reaction_host_links,MAX(ph.priority_score) max_priority_score FROM papers p JOIN paper_screening ps USING(pmid) JOIN paper_host_candidates ph USING(pmid) GROUP BY p.pmid ORDER BY max_priority_score DESC,enzyme_host_links DESC,p.pmid", DOWNLOADS / "expression_candidate_papers.tsv"),
        "host_normalization_review_queue.tsv": export_query(conn, "SELECT a.*,h.canonical_name,h.host_kind,h.model_host_ids_json FROM host_aliases a JOIN host_entities h USING(host_id) WHERE a.normalization_status<>'rule_normalized' OR a.confidence<0.8 OR a.role_candidate LIKE '%ambiguous%' OR a.role_candidate LIKE 'unresolved%' ORDER BY a.record_count DESC,a.raw_label", DOWNLOADS / "host_normalization_review_queue.tsv"),
    }
    summary = {
        "generated_at": generated,
        "stage": "A_and_B",
        "schema_version": "EXPRESSION_EVIDENCE_V1",
        "counts": {
            "legacy_annotations": len(legacy_rows),
            "raw_host_labels": len(normalizations),
            "canonical_host_entities": len(entities),
            "candidate_pmids": len(all_pmids),
            "paper_host_candidates": conn.execute("SELECT COUNT(*) FROM paper_host_candidates").fetchone()[0],
            "enzymes_with_legacy_annotations": conn.execute("SELECT COUNT(DISTINCT biopart_id) FROM legacy_host_annotations").fetchone()[0],
            "reactions_with_legacy_annotations": conn.execute("SELECT COUNT(DISTINCT reaction_id) FROM legacy_host_annotations").fetchone()[0],
            "legacy_annotations_with_pmid": conn.execute("SELECT COUNT(*) FROM legacy_host_annotations WHERE pmid_count>0").fetchone()[0],
            "twelve_host_aliases": conn.execute("SELECT COUNT(*) FROM host_aliases a JOIN host_entities h USING(host_id) WHERE h.is_twelve_host_species=1").fetchone()[0],
            "normalization_review_queue": exports["host_normalization_review_queue.tsv"],
            "missing_upstream_source_json": missing_source_json,
            "verified_expression_assertions": 0,
        },
        "role_candidate_counts": {row[0]: row[1] for row in conn.execute("SELECT role_candidate,COUNT(*) FROM host_aliases GROUP BY role_candidate ORDER BY COUNT(*) DESC")},
        "normalization_status_counts": {row[0]: row[1] for row in conn.execute("SELECT normalization_status,COUNT(*) FROM host_aliases GROUP BY normalization_status")},
        "evidence_type_counts": {row[0]: row[1] for row in conn.execute("SELECT evidence_type,COUNT(*) FROM legacy_host_annotations GROUP BY evidence_type")},
        "qa": {name: bool(passed) for name,passed,_,_ in checks},
        "exports": exports,
        "boundaries": [
            "Legacy chassis annotations are discovery seeds, not verified expression experiments.",
            "The twelve-host model layer is not experimental expression evidence.",
            "No candidate publication or no reported field is not a negative expression result.",
            "Exact enzyme/form, host, construct, outcome, and primary-source provenance are required for E1/E2 promotion.",
        ],
    }
    SUMMARY_JSON.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    schema = {row[0]: [dict(item) for item in conn.execute(f"PRAGMA table_info({row[0]})")] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")}
    SCHEMA_JSON.write_text(json.dumps({"schema_version": "EXPRESSION_EVIDENCE_V1", "tables": schema}, ensure_ascii=False, indent=2), encoding="utf-8")
    conn.execute("DETACH DATABASE core")
    conn.execute("DETACH DATABASE upstream")
    conn.close()
    if OUTPUT_DB.exists():
        OUTPUT_DB.unlink()
    temp_db.replace(OUTPUT_DB)
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    if not all(item[1] for item in checks):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
