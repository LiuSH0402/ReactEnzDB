#!/usr/bin/env python3
"""Build the frozen 2026.09.1 Reaction x Host mapping in staging only.

The implementation deliberately parses normalized SBML with ElementTree.  It
does not load COBRApy or a solver, and it never opens a release database in
write mode.  A complete matrix is written to a temporary copy of the Host
Registry staging database and atomically replaces that staging copy only after
all integrity checks pass.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import sqlite3
import tarfile
import tempfile
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from fractions import Fraction
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
STAGING_DB = ROOT / "staging/host-context/2026.09.1/host_context_v1_staging.sqlite"
NORMALIZED_DIR = ROOT / "staging/host-models/2026.09.1/normalized"
CORE_DB = ROOT / "web_release/reactenzdb_web.db"
MNX_ARCHIVE = ROOT / "external/reaction_standardization/metanetx/mnxref_tsv.tar.gz"
POLICY_PATH = ROOT / "host_reaction_mapping_policy_202609.json"
DRY_RUN_REPORT = ROOT / "host_reaction_mapping_dry_run_202609.json"
SUMMARY_JSON = ROOT / "host_reaction_mapping_summary_202609.json"
SUMMARY_MD = ROOT / "HOST_REACTION_MAPPING_STEP3_202609.md"
IYALI_DICTIONARY = ROOT / "staging/host-models/2026.09.1/dictionaries/iYali_v4.1.2_source_dictionary.json"
MANUAL_METABOLITE_RESOLUTIONS = ROOT / "staging/host-models/2026.09.1/dictionaries/manual_metabolite_identity_resolutions.json"

EXPECTED_POLICY_SHA = "a9b79a057576fb5e36ab451d98b96b6465b2aa91a303be70df660377c8c2b1d0"
EXPECTED_MNX_SHA = "fa6c095fbbbfd11445183bdbe0cf4e6af6596f4312f4e40bb24a4e744f93144e"
POLICY_ID = "rhm_2026_09_1_v1"
MAPPING_VERSION = "2026.09.1-step3-v5"
CREATED_AT = "2026-09-17T00:00:00+00:00"
EXPECTED_IYALI_DICTIONARY_SHA = "9524315b4a22c5be1a752a23c65c3992cfd1225d223853f5832fc6b9fc7800ce"
EXPECTED_MANUAL_METABOLITE_RESOLUTIONS_SHA = "0a8a429381697f0a19c2990a87738f5098df10e89c57750544e2569bf9e026f8"
EMPTY_JSON = "[]"

OP_RE = re.compile(r"\s+(<\?>|<=>|-->|<--|=|=>|<=|<-->)\s+")
TERM_RE = re.compile(r"^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s+([^\s@+]+)@[^\s+]+\s*$")
SOURCE_LOCATED_TERM_RE = re.compile(
    r"^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s+([^\s@+]+)@([^\s+]+)\s*$"
)
IDORG_RE = re.compile(r"identifiers\.org/([^/]+)/([^?#\s]+)")
EC_RE = re.compile(r"\b\d+\.(?:\d+|-|n)\.(?:\d+|-|n)\.(?:\d+|-|n)\b", re.I)
EXCLUDED_ID_RE = re.compile(r"^(EX_|DM_|SK_|BIOMASS|ATPM|MAINT|NGAM|PSEUDO)", re.I)
EXCLUDED_NAME_RE = re.compile(r"\b(biomass|maintenance|pseudo[- ]?reaction|demand reaction|sink reaction)\b", re.I)
EXCLUDED_SBO_TERMS = {
    "SBO:0000185", "SBO:0000587", "SBO:0000588",  # transport / translocation
    "SBO:0000627", "SBO:0000628", "SBO:0000629", "SBO:0000630",
    "SBO:0000631", "SBO:0000632",  # exchange, demand, biomass, maintenance, pseudo, sink
}


def log(message: str) -> None:
    print(message, flush=True)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def stable_id(prefix: str, *values: str) -> str:
    payload = "\x1f".join(values).encode("utf-8")
    return prefix + hashlib.sha256(payload).hexdigest()[:24]


def ro_connect(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(
        f"file:{path.resolve().as_posix()}?mode=ro&immutable=1", uri=True
    )
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only=ON")
    return connection


def production_hashes() -> dict[str, str]:
    paths = sorted(
        path for path in (ROOT / "web_release").iterdir()
        if path.is_file() and path.suffix.lower() in {".db", ".sqlite"}
    )
    return {path.relative_to(ROOT).as_posix(): sha256(path) for path in paths}


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def clean_model_id(value: str, prefix: str) -> str:
    return value[len(prefix):] if value.startswith(prefix) else value


LIBSBML_BRACKET_COMPARTMENT_RE = re.compile(
    r"^(.+)_LSQBKT([A-Za-z][A-Za-z0-9]*)_RSQBKT_?$"
)


def decode_libsbml_bracket_compartment(value: str) -> tuple[str, str] | None:
    """Decode only the terminal ``[compartment]`` SId escape used by iBT721.

    This intentionally does not perform a broad libSBML unescape.  The frozen
    iBT721 file has this exact terminal form for all species, and limiting the
    adapter prevents stereochemistry suffixes such as ``__L`` from being
    mistaken for compartments.
    """
    raw = clean_model_id(value, "M_")
    match = LIBSBML_BRACKET_COMPARTMENT_RE.fullmatch(raw)
    return match.groups() if match else None


def resources(element: ET.Element) -> dict[str, set[str]]:
    found: dict[str, set[str]] = defaultdict(set)
    for node in element.iter():
        for value in node.attrib.values():
            match = IDORG_RE.search(value)
            if match:
                found[match.group(1).lower()].add(match.group(2))
    return found


def notes_text(element: ET.Element) -> str:
    return " ".join(" ".join(element.itertext()).split())


def source_key(namespace: str, identifier: str) -> str | None:
    namespace = namespace.lower().strip()
    identifier = identifier.strip()
    if not identifier:
        return None
    if namespace in {"metanetx.chemical", "metanetx.reaction"}:
        return None
    if namespace == "chebi":
        identifier = re.sub(r"^CHEBI:", "", identifier, flags=re.I)
        return f"chebi:{identifier}"
    if namespace == "kegg.compound":
        return f"kegg.compound:{identifier}"
    if namespace == "kegg.reaction":
        return f"kegg.reaction:{identifier}"
    if namespace in {"biocyc", "metacyc.compound", "metacyc.reaction"}:
        identifier = re.sub(r"^META:", "", identifier, flags=re.I)
        kind = "reaction" if namespace.endswith("reaction") else "compound"
        return f"metacyc.{kind}:{identifier}"
    if namespace in {"seed.compound", "seed.reaction", "bigg.metabolite", "bigg.reaction"}:
        return f"{namespace}:{identifier}"
    if namespace == "rhea":
        identifier = re.sub(r"^RHEA:", "", identifier, flags=re.I)
        return f"rhea:{identifier}"
    return None


def annotation_keys(annotation: dict[str, set[str]], kind: str) -> tuple[set[str], set[str]]:
    direct_ns = "metanetx.chemical" if kind == "chemical" else "metanetx.reaction"
    direct = set(annotation.get(direct_ns, set()))
    keys: set[str] = set()
    allowed = (
        {"chebi", "kegg.compound", "biocyc", "metacyc.compound", "seed.compound", "bigg.metabolite"}
        if kind == "chemical" else
        {"rhea", "kegg.reaction", "biocyc", "metacyc.reaction", "seed.reaction", "bigg.reaction"}
    )
    for namespace in allowed:
        for value in annotation.get(namespace, set()):
            # BioCyc is used for both species and reactions in identifiers.org;
            # its MetaNetX namespace must follow the annotated object type.
            effective_namespace = (
                "metacyc.compound" if namespace == "biocyc" and kind == "chemical"
                else "metacyc.reaction" if namespace == "biocyc"
                else namespace
            )
            key = source_key(effective_namespace, value)
            if key:
                keys.add(key)
    return direct, keys


def conservative_id_keys(
    identifier: str, kind: str, *, strip_compartment_suffix: bool = True
) -> set[str]:
    raw = clean_model_id(identifier, "M_" if kind == "chemical" else "R_")
    if kind == "chemical":
        base = (
            re.sub(r"_[a-z][a-z0-9]*$", "", raw, flags=re.I)
            if strip_compartment_suffix else raw
        )
        keys = {f"bigg.metabolite:{base}"}
        if re.fullmatch(r"cpd\d+", base, re.I):
            keys.add(f"seed.compound:{base}")
        return keys
    keys = {f"bigg.reaction:{raw}", f"metacyc.reaction:{raw}"}
    if re.fullmatch(r"rxn\d+", raw, re.I):
        keys.add(f"seed.reaction:{raw}")
    return keys


@dataclass
class Metabolite:
    raw_id: str
    model_id: str
    name: str
    compartment: str
    formula: str | None
    charge: int | None
    direct_mnx: set[str]
    xref_keys: set[str]
    evidence_adapters: set[str] = field(default_factory=set)
    curated_mnx: str | None = None


@dataclass
class ModelReaction:
    raw_id: str
    model_id: str
    name: str
    lower_bound: float | None
    upper_bound: float | None
    reversible_attr: bool
    participants: list[tuple[str, Fraction]]
    direct_mnx: set[str]
    xref_keys: set[str]
    ec: set[str]
    gene_rule: str | None
    gene_ids: list[str]
    sbo: str | None
    host_equation: str
    evidence_adapters: set[str] = field(default_factory=set)
    excluded_reason: str | None = None


@dataclass
class ParsedModel:
    host_id: str
    release_id: str
    path: Path
    metabolites: dict[str, Metabolite]
    reactions: list[ModelReaction]


def parameter_value(model: ET.Element) -> dict[str, float]:
    result: dict[str, float] = {}
    for node in model.iter():
        if local_name(node.tag) != "parameter":
            continue
        identifier = node.attrib.get("id")
        value = node.attrib.get("value")
        if identifier and value is not None:
            try:
                result[identifier] = float(value)
            except ValueError:
                pass
    return result


def attr_ending(element: ET.Element, suffix: str) -> str | None:
    for key, value in element.attrib.items():
        if local_name(key) == suffix:
            return value
    return None


def parse_bound(value: str | None, parameters: dict[str, float]) -> float | None:
    if value is None:
        return None
    if value in parameters:
        return parameters[value]
    try:
        return float(value)
    except ValueError:
        return None


def fraction(value: str) -> Fraction | None:
    try:
        number = float(value)
        accepted = Fraction(number).limit_denominator(1_000_000)
        if abs(float(accepted) - number) > 1e-9:
            return None
        return accepted
    except (ValueError, OverflowError):
        return None


def build_equation(parts: list[tuple[str, Fraction]]) -> str:
    def side(items: Iterable[tuple[str, Fraction]]) -> str:
        return " + ".join(
            f"{abs(value)} {identifier}" for identifier, value in items
        ) or "0"
    return f"{side((i, v) for i, v in parts if v < 0)} => {side((i, v) for i, v in parts if v > 0)}"


def parse_model(host_id: str, release_id: str, path: Path) -> ParsedModel:
    tree = ET.parse(path)
    root = tree.getroot()
    model = next((node for node in root.iter() if local_name(node.tag) == "model"), None)
    if model is None:
        raise ValueError(f"No model element: {path}")
    parameters = parameter_value(model)
    metabolites: dict[str, Metabolite] = {}
    for node in model.iter():
        if local_name(node.tag) != "species":
            continue
        raw_id = node.attrib.get("id", "")
        ann = resources(node)
        direct, keys = annotation_keys(ann, "chemical")
        model_id = clean_model_id(raw_id, "M_")
        compartment = node.attrib.get("compartment", "")
        adapters: set[str] = set()
        decoded = decode_libsbml_bracket_compartment(raw_id)
        if decoded is not None:
            model_id, compartment = decoded
            keys |= conservative_id_keys(
                model_id, "chemical", strip_compartment_suffix=False
            )
            adapters.add("LIBSBML_BRACKET_COMPARTMENT_DECODED")
        else:
            keys |= conservative_id_keys(raw_id, "chemical")
        metabolites[raw_id] = Metabolite(
            raw_id=raw_id,
            model_id=model_id,
            name=node.attrib.get("name", ""),
            compartment=compartment,
            formula=attr_ending(node, "chemicalFormula"),
            charge=(
                int(float(attr_ending(node, "charge")))
                if attr_ending(node, "charge") not in {None, ""}
                else None
            ),
            direct_mnx=direct,
            xref_keys=keys,
            evidence_adapters=adapters,
        )
    reactions: list[ModelReaction] = []
    for node in model.iter():
        if local_name(node.tag) != "reaction":
            continue
        raw_id = node.attrib.get("id", "")
        ann = resources(node)
        direct, keys = annotation_keys(ann, "reaction")
        keys |= conservative_id_keys(raw_id, "reaction")
        parts: list[tuple[str, Fraction]] = []
        coefficient_failure = False
        for child in node:
            side_name = local_name(child.tag)
            if side_name not in {"listOfReactants", "listOfProducts"}:
                continue
            sign = -1 if side_name == "listOfReactants" else 1
            for ref in child:
                if local_name(ref.tag) != "speciesReference":
                    continue
                coefficient = fraction(ref.attrib.get("stoichiometry", "1"))
                if coefficient is None:
                    coefficient_failure = True
                    continue
                parts.append((ref.attrib.get("species", ""), sign * coefficient))
        text = notes_text(node)
        ecs = {re.sub(r"^EC[: -]*", "", value, flags=re.I) for value in ann.get("ec-code", set())}
        ecs |= set(EC_RE.findall(text))
        gene_ids = sorted({
            clean_model_id(value, "G_")
            for desc in node.iter()
            for key, value in desc.attrib.items()
            if local_name(key) == "geneProduct" and value
        })
        gene_rule = " or ".join(gene_ids) or None
        reaction = ModelReaction(
            raw_id=raw_id,
            model_id=clean_model_id(raw_id, "R_"),
            name=node.attrib.get("name", ""),
            lower_bound=parse_bound(attr_ending(node, "lowerFluxBound"), parameters),
            upper_bound=parse_bound(attr_ending(node, "upperFluxBound"), parameters),
            reversible_attr=node.attrib.get("reversible", "false").lower() == "true",
            participants=parts,
            direct_mnx=direct,
            xref_keys=keys,
            ec={value for value in ecs if value},
            gene_rule=gene_rule,
            gene_ids=gene_ids,
            sbo=node.attrib.get("sboTerm"),
            host_equation=build_equation(parts),
        )
        upper_name = reaction.name or ""
        if coefficient_failure:
            reaction.excluded_reason = "NON_RATIONAL_STOICHIOMETRY"
        elif reaction.sbo in EXCLUDED_SBO_TERMS:
            reaction.excluded_reason = "EXPLICIT_SBO_EXCLUDED_REACTION"
        elif EXCLUDED_ID_RE.search(reaction.model_id) or EXCLUDED_NAME_RE.search(upper_name):
            reaction.excluded_reason = "PSEUDO_OR_BOUNDARY_PATTERN"
        elif len(parts) < 2 or not any(value < 0 for _, value in parts) or not any(value > 0 for _, value in parts):
            reaction.excluded_reason = "BOUNDARY_OR_INCOMPLETE_REACTION"
        reactions.append(reaction)
    return ParsedModel(host_id, release_id, path, metabolites, reactions)


def apply_iyali_source_dictionary(model: ParsedModel) -> dict[str, int]:
    """Enrich frozen iYali 4.1.2 with its pinned annotation-only sidecar."""
    if model.host_id != "ylipolytica":
        return {}
    if sha256(IYALI_DICTIONARY) != EXPECTED_IYALI_DICTIONARY_SHA:
        raise RuntimeError("iYali source dictionary SHA drift")
    payload = json.loads(IYALI_DICTIONARY.read_text(encoding="utf-8"))
    validation = payload.get("identity_validation", {})
    if not all(
        validation.get(key) is True
        for key in (
            "metabolite_id_set_equal",
            "reaction_id_set_equal",
            "reaction_stoichiometry_equal",
        )
    ):
        raise RuntimeError("iYali source dictionary lacks exact identity validation")
    if payload.get("frozen_normalized_model_sha256") != sha256(model.path):
        raise RuntimeError("iYali dictionary is not bound to the selected normalized model")

    metabolite_lookup = {item.model_id: item for item in model.metabolites.values()}
    reaction_lookup = {item.model_id: item for item in model.reactions}
    if set(payload["metabolites"]) - set(metabolite_lookup):
        raise RuntimeError("iYali dictionary contains unknown metabolite IDs")
    if set(payload["reactions"]) - set(reaction_lookup):
        raise RuntimeError("iYali dictionary contains unknown reaction IDs")

    metabolite_updates = 0
    reaction_updates = 0
    for identifier, annotation_values in payload["metabolites"].items():
        annotation = {key: set(values) for key, values in annotation_values.items()}
        direct, keys = annotation_keys(annotation, "chemical")
        item = metabolite_lookup[identifier]
        before = (set(item.direct_mnx), set(item.xref_keys))
        item.direct_mnx |= direct
        item.xref_keys |= keys
        if before != (item.direct_mnx, item.xref_keys):
            item.evidence_adapters.add("IYALI_4_1_2_OFFICIAL_SOURCE_DICTIONARY")
            metabolite_updates += 1
    for identifier, annotation_values in payload["reactions"].items():
        annotation = {key: set(values) for key, values in annotation_values.items()}
        direct, keys = annotation_keys(annotation, "reaction")
        item = reaction_lookup[identifier]
        before = (set(item.direct_mnx), set(item.xref_keys), set(item.ec))
        item.direct_mnx |= direct
        item.xref_keys |= keys
        item.ec |= set(annotation.get("ec-code", set()))
        if before != (item.direct_mnx, item.xref_keys, item.ec):
            item.evidence_adapters.add("IYALI_4_1_2_OFFICIAL_SOURCE_DICTIONARY")
            reaction_updates += 1
    return {
        "iyali_dictionary_metabolite_updates": metabolite_updates,
        "iyali_dictionary_reaction_updates": reaction_updates,
    }


def apply_manual_metabolite_resolutions(model: ParsedModel) -> dict[str, int]:
    """Apply SHA-bound, evidence-rich staging identity adjudications."""
    if sha256(MANUAL_METABOLITE_RESOLUTIONS) != EXPECTED_MANUAL_METABOLITE_RESOLUTIONS_SHA:
        raise RuntimeError("manual metabolite identity resolution SHA drift")
    payload = json.loads(MANUAL_METABOLITE_RESOLUTIONS.read_text(encoding="utf-8"))
    if payload.get("metanetx_archive_sha256") != EXPECTED_MNX_SHA:
        raise RuntimeError("manual metabolite resolutions use a different MetaNetX basis")
    lookup = model.metabolites
    applied = 0
    for resolution in payload.get("resolutions", []):
        if resolution["host_id"] != model.host_id:
            continue
        if resolution["release_id"] != model.release_id:
            raise RuntimeError(f"manual metabolite resolution release drift: {model.host_id}")
        if resolution["normalized_model_sha256"] != sha256(model.path):
            raise RuntimeError(f"manual metabolite resolution model SHA drift: {model.host_id}")
        raw_id = resolution["raw_model_metabolite_id"]
        if raw_id not in lookup:
            raise RuntimeError(f"manual metabolite resolution unknown ID: {raw_id}")
        item = lookup[raw_id]
        if item.model_id != resolution["model_metabolite_id"]:
            raise RuntimeError(f"manual metabolite resolution model ID drift: {raw_id}")
        if item.formula != resolution["formula"] or item.charge != resolution["charge"]:
            raise RuntimeError(f"manual metabolite resolution formula/charge drift: {raw_id}")
        item.curated_mnx = resolution["selected_mnxm"]
        item.evidence_adapters.add("CURATED_STEREOSPECIFIC_MULTI_NAMESPACE_RESOLUTION")
        applied += 1
    return {"manual_metabolite_identity_resolutions": applied}


def normalize_vector(items: Iterable[tuple[str, Fraction]]) -> tuple[tuple[str, int], ...] | None:
    combined: dict[str, Fraction] = defaultdict(Fraction)
    for identifier, coefficient in items:
        combined[identifier] += coefficient
    combined = {key: value for key, value in combined.items() if value != 0}
    if not combined:
        return None
    denominator = 1
    for value in combined.values():
        denominator = math.lcm(denominator, value.denominator)
    integers = {key: int(value * denominator) for key, value in combined.items()}
    divisor = 0
    for value in integers.values():
        divisor = math.gcd(divisor, abs(value))
    divisor = divisor or 1
    return tuple(sorted((key, value // divisor) for key, value in integers.items()))


def reverse_vector(vector: tuple[tuple[str, int], ...]) -> tuple[tuple[str, int], ...]:
    return tuple((key, -value) for key, value in vector)


def directionless(vector: tuple[tuple[str, int], ...]) -> tuple[tuple[str, int], ...]:
    reverse = reverse_vector(vector)
    return min(vector, reverse)


def split_equation(text: str) -> tuple[str, str, str] | None:
    canonical = text.split("||")[-1].strip()
    match = OP_RE.search(canonical)
    if not match:
        return None
    return canonical[:match.start()], match.group(1), canonical[match.end():]


def equation_terms(text: str) -> tuple[list[tuple[str, Fraction]], list[str], str] | None:
    split = split_equation(text)
    if split is None:
        return None
    left, operator, right = split
    items: list[tuple[str, Fraction]] = []
    identifiers: list[str] = []
    for sign, side in ((-1, left), (1, right)):
        for raw_term in side.split(" + "):
            match = TERM_RE.match(raw_term)
            if not match:
                return None
            coefficient = fraction(match.group(1))
            if coefficient is None:
                return None
            identifier = match.group(2)
            items.append((identifier, sign * coefficient))
            identifiers.append(identifier)
    return items, identifiers, operator


def equation_source_key(identifier: str) -> str | None:
    if identifier.startswith("chebi:"):
        return identifier
    if identifier.startswith("keggC:"):
        return "kegg.compound:" + identifier.split(":", 1)[1]
    if identifier.startswith("metacycM:"):
        return "metacyc.compound:" + identifier.split(":", 1)[1]
    if identifier.startswith(("MNXM", "WATER")):
        return None
    return None


def collect_release_rows() -> list[dict[str, str]]:
    with ro_connect(STAGING_DB) as db:
        rows = [dict(row) for row in db.execute(
            """
            SELECT h.ordinal, h.host_id, r.release_id, r.internal_source_host_id,
                   r.normalized_model_sha256
            FROM curated_hosts h
            JOIN host_models m ON m.host_id=h.host_id
            JOIN host_model_releases r ON r.release_id=m.preferred_release_id
            ORDER BY h.ordinal
            """
        )]
        policy = db.execute(
            "SELECT policy_sha256, policy_status, production_approval FROM mapping_policy_versions WHERE policy_id=?",
            (POLICY_ID,),
        ).fetchone()
        if policy is None or policy[0] != EXPECTED_POLICY_SHA or policy[1] != "FROZEN_FOR_STAGING_IMPLEMENTATION":
            raise RuntimeError("frozen mapping policy is missing or drifted")
        if policy[2] != "NOT_GRANTED":
            raise RuntimeError("unexpected production approval state")
    return rows


def normalized_path(row: dict[str, str]) -> Path:
    path = NORMALIZED_DIR / f"{row['internal_source_host_id']}.xml"
    if not path.is_file():
        raise FileNotFoundError(path)
    if sha256(path) != row["normalized_model_sha256"]:
        raise RuntimeError(f"normalized model SHA drift: {row['host_id']}")
    return path


def load_core() -> tuple[list[dict[str, Any]], dict[str, set[str]], dict[str, list[dict[str, Any]]]]:
    with ro_connect(CORE_DB) as db:
        reactions = [dict(row) for row in db.execute(
            "SELECT reaction_id, reaction_equation_display, reaction_direction, ec_number FROM web_reactions ORDER BY reaction_id"
        )]
        mnx_rows: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in db.execute(
            "SELECT reaction_id, mnx_reaction_id, source_db, source_xref, source_equation, mapping_method, mnxref_version FROM web_mnx_reaction_mappings"
        ):
            mnx_rows[row["reaction_id"]].append(dict(row))
    ec_index: dict[str, set[str]] = defaultdict(set)
    for row in reactions:
        for ec in re.split(r"[;,|\s]+", row.get("ec_number") or ""):
            ec = re.sub(r"^EC[: -]*", "", ec, flags=re.I).strip()
            if ec:
                ec_index[ec].add(row["reaction_id"])
    return reactions, ec_index, mnx_rows


def scan_xrefs(wanted_chem: set[str], wanted_reac: set[str]) -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    chemical: dict[str, set[str]] = defaultdict(set)
    reaction: dict[str, set[str]] = defaultdict(set)
    with tarfile.open(MNX_ARCHIVE, "r:gz") as archive:
        for member, wanted, output in (
            ("chem_xref.tsv", wanted_chem, chemical),
            ("reac_xref.tsv", wanted_reac, reaction),
        ):
            handle = archive.extractfile(member)
            if handle is None:
                raise RuntimeError(f"MetaNetX archive lacks {member}")
            for raw in handle:
                if raw.startswith(b"#"):
                    continue
                fields = raw.decode("utf-8", errors="replace").rstrip("\n").split("\t")
                if len(fields) >= 2 and fields[0] in wanted and fields[1] != "EMPTY":
                    output[fields[0]].add(fields[1])
    return dict(chemical), dict(reaction)


def load_chem_properties(wanted: set[str]) -> dict[str, tuple[str | None, int | None]]:
    result: dict[str, tuple[str | None, int | None]] = {}
    with tarfile.open(MNX_ARCHIVE, "r:gz") as archive:
        handle = archive.extractfile("chem_prop.tsv")
        if handle is None:
            raise RuntimeError("MetaNetX archive lacks chem_prop.tsv")
        for raw in handle:
            if raw.startswith(b"#"):
                continue
            fields = raw.decode("utf-8", errors="replace").rstrip("\n").split("\t")
            if len(fields) < 5 or fields[0] not in wanted:
                continue
            try:
                charge = int(fields[4]) if fields[4] else None
            except ValueError:
                charge = None
            result[fields[0]] = (fields[3] or None, charge)
    return result


MNX_PROP_TERM_RE = re.compile(r"([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s+([^\s@+]+)@")


def load_mnx_reaction_vectors() -> tuple[
    dict[str, tuple[tuple[str, int], ...]],
    dict[tuple[tuple[str, int], ...], set[str]],
]:
    vectors: dict[str, tuple[tuple[str, int], ...]] = {}
    index: dict[tuple[tuple[str, int], ...], set[str]] = defaultdict(set)
    with tarfile.open(MNX_ARCHIVE, "r:gz") as archive:
        handle = archive.extractfile("reac_prop.tsv")
        if handle is None:
            raise RuntimeError("MetaNetX archive lacks reac_prop.tsv")
        for raw in handle:
            if raw.startswith(b"#"):
                continue
            fields = raw.decode("utf-8", errors="replace").rstrip("\n").split("\t")
            if len(fields) < 2 or " = " not in fields[1]:
                continue
            left, right = fields[1].split(" = ", 1)
            items: list[tuple[str, Fraction]] = []
            failed = False
            for sign, side in ((-1, left), (1, right)):
                matches = list(MNX_PROP_TERM_RE.finditer(side))
                if not matches:
                    failed = True
                    break
                for match in matches:
                    coefficient = fraction(match.group(1))
                    if coefficient is None:
                        failed = True
                        break
                    items.append((match.group(2), sign * coefficient))
            if failed:
                continue
            vector = normalize_vector(items)
            if vector is None:
                continue
            vectors[fields[0]] = vector
            index[directionless(vector)].add(fields[0])
    return vectors, dict(index)


def resolved_metabolites(
    model: ParsedModel,
    xrefs: dict[str, set[str]],
    chem_properties: dict[str, tuple[str | None, int | None]],
) -> tuple[
    dict[str, str], dict[str, list[str]], dict[str, list[str]]
]:
    resolved: dict[str, str] = {}
    ambiguous: dict[str, list[str]] = {}
    missing: dict[str, list[str]] = {}
    for raw_id, metabolite in model.metabolites.items():
        # The frozen policy gives a pinned, explicit MNXM identifier priority
        # over secondary aliases.  Mixing both sets makes deprecated MetaNetX
        # aliases look like biological ambiguity.
        alias_options: set[str] = set()
        for key in metabolite.xref_keys:
            alias_options |= xrefs.get(key, set())
        direct = set(metabolite.direct_mnx)
        current_direct = {identifier for identifier in direct if identifier in chem_properties}
        if metabolite.curated_mnx is not None:
            selected = metabolite.curated_mnx
            if selected not in alias_options or selected not in chem_properties:
                raise RuntimeError(f"curated metabolite resolution lacks pinned alias support: {raw_id}")
            selected_formula, selected_charge = chem_properties[selected]
            if metabolite.formula is not None and selected_formula != metabolite.formula:
                raise RuntimeError(f"curated metabolite resolution formula conflict: {raw_id}")
            if metabolite.charge is not None and selected_charge != metabolite.charge:
                raise RuntimeError(f"curated metabolite resolution charge conflict: {raw_id}")
            options = {selected}
        elif len(current_direct) == 1:
            options = current_direct
        elif len(direct) == 1 and not alias_options:
            options = direct
        elif alias_options:
            # Reconcile an obsolete model-embedded MNXM through current 4.5
            # external aliases rather than treating the stale ID as canonical.
            options = alias_options
        else:
            options = direct | alias_options
        if len(options) > 1 and (metabolite.formula is not None or metabolite.charge is not None):
            consistent = {
                identifier for identifier in options
                if identifier in chem_properties
                and (metabolite.formula is None or chem_properties[identifier][0] == metabolite.formula)
                and (metabolite.charge is None or chem_properties[identifier][1] == metabolite.charge)
            }
            if consistent:
                options = consistent
        if len(options) == 1:
            resolved[raw_id] = next(iter(options))
        elif len(options) > 1:
            ambiguous[raw_id] = sorted(options)
        else:
            missing[raw_id] = sorted(metabolite.xref_keys)
    return resolved, ambiguous, missing


def transported_identity_evidence(
    reaction: ModelReaction,
    model: ParsedModel,
    resolved: dict[str, str],
) -> list[dict[str, Any]]:
    """Return identities moved across compartments, before neutral collapse.

    Energy-coupled transporters retain ATP hydrolysis after compartment-neutral
    aggregation.  Detecting the transported identity first prevents those
    residual vectors from being misclassified as native ATP hydrolysis.
    """
    occurrences: dict[str, dict[str, set[str]]] = defaultdict(
        lambda: {"reactant": set(), "product": set()}
    )
    raw_ids: dict[str, set[str]] = defaultdict(set)
    for raw_id, coefficient in reaction.participants:
        canonical = resolved.get(raw_id)
        if canonical is None:
            continue
        side = "reactant" if coefficient < 0 else "product"
        occurrences[canonical][side].add(model.metabolites[raw_id].compartment)
        raw_ids[canonical].add(model.metabolites[raw_id].model_id)
    evidence: list[dict[str, Any]] = []
    for canonical, sides in sorted(occurrences.items()):
        if not sides["reactant"] or not sides["product"]:
            continue
        if sides["reactant"] == sides["product"]:
            continue
        if any(left != right for left in sides["reactant"] for right in sides["product"]):
            evidence.append({
                "canonical_metabolite_id": canonical,
                "model_metabolite_ids": sorted(raw_ids[canonical]),
                "reactant_compartments": sorted(sides["reactant"]),
                "product_compartments": sorted(sides["product"]),
            })
    return evidence


def identity_qc_flags(
    metabolite: Metabolite,
    canonical_id: str,
    properties: dict[str, tuple[str | None, int | None]],
) -> list[str]:
    """Flag model/MNX metadata discrepancies without silently changing ID priority."""
    canonical = properties.get(canonical_id)
    if canonical is None:
        return ["PINNED_CHEMICAL_PROPERTIES_MISSING"]
    formula, charge = canonical
    flags: list[str] = []
    if metabolite.formula is not None and formula is not None and metabolite.formula != formula:
        flags.append("MODEL_MNX_FORMULA_DISCREPANCY")
    if metabolite.charge is not None and charge is not None and metabolite.charge != charge:
        flags.append("MODEL_MNX_CHARGE_DISCREPANCY")
    return flags


def reaction_candidates(
    model: ParsedModel,
    chem_xrefs: dict[str, set[str]],
    chem_properties: dict[str, tuple[str | None, int | None]],
    reac_xrefs: dict[str, set[str]],
    mnx_vectors: dict[str, tuple[tuple[str, int], ...]],
    signature_index: dict[tuple[tuple[str, int], ...], set[str]],
) -> tuple[dict[str, list[dict[str, Any]]], dict[str, list[dict[str, Any]]], dict[str, set[str]], dict[str, int]]:
    resolved, ambiguous_mets, missing_mets = resolved_metabolites(model, chem_xrefs, chem_properties)
    accepted: dict[str, list[dict[str, Any]]] = defaultdict(list)
    unresolved: dict[str, list[dict[str, Any]]] = defaultdict(list)
    ec_model: dict[str, set[str]] = defaultdict(set)
    stats = Counter(
        model_metabolites=len(model.metabolites),
        resolved_metabolites=len(resolved),
        ambiguous_metabolites=len(ambiguous_mets),
        missing_metabolites=len(missing_mets),
        model_reactions=len(model.reactions),
        adapted_metabolites=sum(bool(item.evidence_adapters) for item in model.metabolites.values()),
        adapted_reactions=sum(bool(item.evidence_adapters) for item in model.reactions),
    )
    for raw_id, canonical_id in resolved.items():
        for flag in identity_qc_flags(model.metabolites[raw_id], canonical_id, chem_properties):
            stats[flag.lower()] += 1
    for reaction in model.reactions:
        for ec in reaction.ec:
            ec_model[ec].add(reaction.model_id)
        # Model annotations may contain MNXR accessions retired before the
        # pinned 4.5 release.  Only direct accessions present in reac_prop are
        # current; otherwise reconcile exact source identifiers via reac_xref.
        direct_options = {mnxr for mnxr in reaction.direct_mnx if mnxr in mnx_vectors}
        if not direct_options:
            for key in reaction.xref_keys:
                direct_options |= reac_xrefs.get(key, set())
        bad_participants = [raw for raw, _ in reaction.participants if raw not in resolved]
        if reaction.excluded_reason:
            for mnxr in direct_options:
                unresolved[mnxr].append({"reaction": reaction, "reason": reaction.excluded_reason})
            stats["excluded_reactions"] += 1
            continue
        transported = transported_identity_evidence(reaction, model, resolved)
        if transported:
            for mnxr in direct_options:
                unresolved[mnxr].append({
                    "reaction": reaction,
                    "reason": "TRANSPORT_REACTION_EXCLUDED",
                    "transported": transported,
                })
            stats["transport_reactions_excluded"] += 1
            continue
        compartments = {model.metabolites[raw].compartment for raw, _ in reaction.participants}
        if len(compartments) > 1:
            for mnxr in direct_options:
                unresolved[mnxr].append({
                    "reaction": reaction,
                    "reason": "CROSS_COMPARTMENT_REACTION_EXCLUDED",
                    "compartments": sorted(compartments),
                })
            stats["cross_compartment_reactions_excluded"] += 1
            continue
        if bad_participants:
            for mnxr in direct_options:
                unresolved[mnxr].append({
                    "reaction": reaction,
                    "reason": "UNRESOLVED_METABOLITES",
                    "unmatched": bad_participants,
                })
            stats["incomplete_chemistry_reactions"] += 1
            continue
        items = [(resolved[raw], coefficient) for raw, coefficient in reaction.participants]
        vector = normalize_vector(items)
        if vector is None:
            for mnxr in direct_options:
                unresolved[mnxr].append({"reaction": reaction, "reason": "ZERO_OR_INVALID_NORMALIZED_VECTOR"})
            stats["invalid_vector_reactions"] += 1
            continue
        signature_options = signature_index.get(directionless(vector), set())
        if direct_options:
            verified = {
                mnxr for mnxr in direct_options
                if mnxr in mnx_vectors and directionless(mnx_vectors[mnxr]) == directionless(vector)
            }
            rejected = direct_options - verified
            for mnxr in rejected:
                unresolved[mnxr].append({"reaction": reaction, "reason": "REACTION_ID_CHEMISTRY_CONFLICT"})
            method = "EXACT_SHARED_EXTERNAL_REACTION_ID_PLUS_CHEMISTRY_CHECK"
        else:
            verified = set(signature_options)
            method = "EXACT_NORMALIZED_METABOLITE_STOICHIOMETRY"
        matched = [
            {
                "model_metabolite_raw_id": model.metabolites[raw].raw_id,
                "model_metabolite_id": model.metabolites[raw].model_id,
                "canonical_metabolite_id": resolved[raw],
                "coefficient": str(coefficient),
                "compartment": model.metabolites[raw].compartment,
                "identity_adapters": sorted(model.metabolites[raw].evidence_adapters),
                "identity_qc_flags": identity_qc_flags(model.metabolites[raw], resolved[raw], chem_properties),
            }
            for raw, coefficient in reaction.participants
        ]
        evidence_adapters = set(reaction.evidence_adapters)
        identity_warnings = {flag for item in matched for flag in item["identity_qc_flags"]}
        for raw, _ in reaction.participants:
            evidence_adapters |= model.metabolites[raw].evidence_adapters
        compartment_relation = "COMPARTMENT_NEUTRAL_MATCH"
        for mnxr in verified:
            canonical = mnx_vectors[mnxr]
            orientation = "SAME" if vector == canonical else "REVERSE"
            accepted[mnxr].append({
                "reaction": reaction,
                "method": method,
                "vector": vector,
                "orientation": orientation,
                "matched": matched,
                "compartment_relation": compartment_relation,
                "evidence_adapters": sorted(evidence_adapters),
                "identity_qc_flags": sorted(identity_warnings),
            })
        if verified:
            stats["chemistry_verified_model_reactions"] += 1
    return dict(accepted), dict(unresolved), dict(ec_model), dict(stats)


def source_has_cross_compartment_transport(equation: str) -> bool:
    """Detect a source participant moved between compartments before collapse.

    A transport + ATP hydrolysis source must never be treated as ATP hydrolysis
    alone after the compartment-neutral signed vector cancels the cargo.
    """
    split = split_equation(equation)
    if split is None:
        return False
    left, _, right = split
    by_side: list[dict[str, set[str]]] = []
    for side in (left, right):
        terms: dict[str, set[str]] = defaultdict(set)
        for raw in side.split(" + "):
            match = SOURCE_LOCATED_TERM_RE.match(raw)
            if match is not None:
                terms[match.group(1)].add(match.group(2))
        by_side.append(terms)
    return any(
        by_side[0][identity] != by_side[1][identity]
        for identity in by_side[0].keys() & by_side[1].keys()
    )


def verified_core_mnx(
    mnx_rows: dict[str, list[dict[str, Any]]],
    chem_xrefs: dict[str, set[str]],
    mnx_vectors: dict[str, tuple[tuple[str, int], ...]],
) -> tuple[dict[str, dict[str, Any]], dict[str, list[str]], dict[str, int]]:
    verified: dict[str, dict[str, Any]] = {}
    unresolved: dict[str, list[str]] = {}
    stats = Counter()
    for reaction_id, rows in mnx_rows.items():
        valid: dict[str, list[dict[str, Any]]] = defaultdict(list)
        reasons: list[str] = []
        transport_present = False
        for row in rows:
            if source_has_cross_compartment_transport(row.get("source_equation") or ""):
                reasons.append(f"{row['mnx_reaction_id']}:SOURCE_TRANSPORT_REACTION_EXCLUDED")
                transport_present = True
                continue
            parsed = equation_terms(row.get("source_equation") or "")
            if parsed is None:
                reasons.append(f"{row['mnx_reaction_id']}:SOURCE_EQUATION_UNPARSEABLE")
                continue
            items, identifiers, operator = parsed
            canonical_items: list[tuple[str, Fraction]] = []
            failed = False
            for identifier, coefficient in items:
                if identifier.startswith(("MNXM", "WATER")):
                    options = {identifier}
                else:
                    key = equation_source_key(identifier)
                    options = chem_xrefs.get(key or "", set())
                if len(options) != 1:
                    failed = True
                    break
                canonical_items.append((next(iter(options)), coefficient))
            if failed:
                reasons.append(f"{row['mnx_reaction_id']}:SOURCE_METABOLITE_UNRESOLVED")
                continue
            vector = normalize_vector(canonical_items)
            canonical = mnx_vectors.get(row["mnx_reaction_id"])
            if vector is None or canonical is None or directionless(vector) != directionless(canonical):
                reasons.append(f"{row['mnx_reaction_id']}:SOURCE_EQUATION_CHEMISTRY_CONFLICT")
                continue
            valid[row["mnx_reaction_id"]].append({
                "mnxr": row["mnx_reaction_id"],
                "vector": vector,
                "operator": operator,
                "equation": row["source_equation"],
                "source_db": row["source_db"],
            })
        orientation_conflicts = {
            mnxr for mnxr, evidence in valid.items()
            if len({item["vector"] for item in evidence}) > 1
        }
        if transport_present:
            unresolved[reaction_id] = sorted(set(reasons) | {
                "SOURCE_TRANSPORT_PRESENT_IN_REACTION_EVIDENCE"
            })
            stats["source_transport_reaction_excluded"] += 1
        elif orientation_conflicts:
            unresolved[reaction_id] = sorted(
                set(reasons) | {
                    f"{mnxr}:SOURCE_ORIENTATION_CONFLICT" for mnxr in orientation_conflicts
                }
            )
            stats["source_orientation_conflict_reactions"] += 1
        elif len(valid) == 1:
            # Source row order is not part of the mapping identity.
            evidence = next(iter(valid.values()))
            verified[reaction_id] = min(
                evidence,
                key=lambda item: (item["source_db"], item["equation"], item["operator"]),
            )
            stats["verified_reactions"] += 1
        elif len(valid) > 1:
            unresolved[reaction_id] = sorted(valid)
            stats["multiple_verified_mnxr"] += 1
        elif rows:
            unresolved[reaction_id] = sorted(set(reasons))
            stats["unverified_strong_candidates"] += 1
    return verified, unresolved, dict(stats)


def flux_allowed(reaction: ModelReaction) -> set[int] | None:
    lower = reaction.lower_bound
    upper = reaction.upper_bound
    if lower is None or upper is None:
        if reaction.reversible_attr:
            return {-1, 1}
        return {1}
    allowed: set[int] = set()
    if upper > 0:
        allowed.add(1)
    if lower < 0:
        allowed.add(-1)
    return allowed or None


def react_allowed(direction: str | None) -> set[int] | None:
    return {
        "=>": {1},
        "<=": {-1},
        "<=>": {-1, 1},
        "<-->": {-1, 1},
    }.get(direction or "")


def direction_relation(reaction: ModelReaction, orientation: str, core_direction: str | None) -> str:
    host = flux_allowed(reaction)
    target = react_allowed(core_direction)
    if host is None or target is None:
        return "UNKNOWN"
    sign = 1 if orientation == "SAME" else -1
    host_in_target = {value * sign for value in host}
    if host == {-1, 1} and target == {-1, 1}:
        return "BOTH_REVERSIBLE"
    if host == {-1, 1}:
        return "HOST_REVERSIBLE"
    if target == {-1, 1}:
        return "REACTENZDB_REVERSIBLE"
    if host_in_target == target:
        return "SAME" if orientation == "SAME" else "REVERSE"
    return "CONSTRAINT_CONFLICT"


def orientation_against_core(
    model_vector: tuple[tuple[str, int], ...],
    core_vector: tuple[tuple[str, int], ...],
) -> str:
    """Compare equations in the core reaction frame, not the MNX frame."""
    if model_vector == core_vector:
        return "SAME"
    if model_vector == reverse_vector(core_vector):
        return "REVERSE"
    raise ValueError("model and core chemistry are not identical")


def json_compact(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def build_host_rows(
    host: ParsedModel,
    release_id: str,
    reactions: list[dict[str, Any]],
    verified_core: dict[str, dict[str, Any]],
    unresolved_core: dict[str, list[str]],
    accepted: dict[str, list[dict[str, Any]]],
    unresolved_host: dict[str, list[dict[str, Any]]],
    ec_model: dict[str, set[str]],
    model_stats: dict[str, Any],
) -> tuple[list[tuple[Any, ...]], list[tuple[Any, ...]], Counter[str]]:
    rows: list[tuple[Any, ...]] = []
    candidates: list[tuple[Any, ...]] = []
    counts: Counter[str] = Counter()
    context_by_core: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    for core in reactions:
        for ec in re.split(r"[;,|\s]+", core.get("ec_number") or ""):
            ec = re.sub(r"^EC[: -]*", "", ec, flags=re.I).strip()
            if ec:
                for model_reaction_id in ec_model.get(ec, set()):
                    context_by_core[core["reaction_id"]][model_reaction_id].add(ec)
    reaction_lookup = {reaction.model_id: reaction for reaction in host.reactions}
    for core in reactions:
        reaction_id = core["reaction_id"]
        mapping_id = stable_id("map_", reaction_id, release_id, POLICY_ID)
        status = "NOT_MAPPED"
        method = "SEARCH_COMPLETE_NO_MATCH"
        basis = "NONE"
        relation = "NOT_APPLICABLE"
        model_reaction_id = None
        host_equation = None
        matched_json = EMPTY_JSON
        unmatched_json = EMPTY_JSON
        compartment = "NOT_APPLICABLE"
        gene_rule = None
        genes_json = EMPTY_JSON
        confidence = None
        notes = "No exact or contextual mapping found under the frozen policy; this is not evidence of biological absence."
        flags: list[str] = []
        exact_candidates: list[dict[str, Any]] = []
        core_match = verified_core.get(reaction_id)
        if core_match:
            exact_candidates = accepted.get(core_match["mnxr"], [])
        strong_unresolved: list[dict[str, Any]] = []
        if core_match:
            strong_unresolved = unresolved_host.get(core_match["mnxr"], [])
        if len(exact_candidates) == 1:
            item = exact_candidates[0]
            reaction = item["reaction"]
            model_vector = item["vector"]
            core_vector = core_match["vector"]
            model_vs_core_orientation = orientation_against_core(model_vector, core_vector)
            relation = direction_relation(reaction, model_vs_core_orientation, core.get("reaction_direction"))
            model_reaction_id = reaction.model_id
            host_equation = reaction.host_equation
            matched_json = json_compact(item["matched"])
            compartment = item["compartment_relation"]
            gene_rule = reaction.gene_rule
            genes_json = json_compact(reaction.gene_ids)
            method = item["method"]
            basis = "FULL_NORMALIZED_MNX_CHEMISTRY"
            if relation == "UNKNOWN":
                status = "UNRESOLVED"
                confidence = None
                flags.append("UNKNOWN_REACTENZDB_OR_HOST_DIRECTION")
                notes = "Chemical identity is exact, but direction is unknown and cannot be promoted under the frozen policy."
                candidate_status = "AMBIGUOUS"
            else:
                status = "EXACT_NATIVE" if relation in {"SAME", "BOTH_REVERSIBLE"} else "DIRECTIONAL_NATIVE"
                confidence = 1.0
                notes = "Exact full chemical identity under pinned MetaNetX 4.5; confidence denotes identity only, not feasibility."
                candidate_status = "ACCEPTED"
            flags.extend(
                f"IDENTITY_ADAPTER:{adapter}"
                for adapter in item.get("evidence_adapters", [])
            )
            flags.extend(item.get("identity_qc_flags", []))
            candidates.append((
                stable_id("cand_", mapping_id, reaction.model_id), mapping_id, reaction.model_id, 1,
                candidate_status, method, basis,
                json_compact({
                    "mnxr": core_match["mnxr"],
                    "model_vs_core_orientation": model_vs_core_orientation,
                    "model_vs_mnx_orientation": item["orientation"],
                    "evidence_adapters": item.get("evidence_adapters", []),
                    "identity_qc_flags": item.get("identity_qc_flags", []),
                }),
            ))
        elif len(exact_candidates) > 1:
            status = "UNRESOLVED"
            method = "MULTIPLE_EXACT_MODEL_REACTION_CANDIDATES"
            basis = "FULL_NORMALIZED_MNX_CHEMISTRY"
            relation = "UNKNOWN"
            notes = "Multiple model reactions have exact chemistry for the same ReactEnzDB reaction; no candidate was selected silently."
            flags.append("AMBIGUOUS_MODEL_REACTION")
            for rank, item in enumerate(sorted(exact_candidates, key=lambda value: value["reaction"].model_id), 1):
                candidate = item["reaction"]
                candidates.append((
                    stable_id("cand_", mapping_id, candidate.model_id), mapping_id, candidate.model_id, rank,
                    "AMBIGUOUS", item["method"], "FULL_NORMALIZED_MNX_CHEMISTRY",
                    json_compact({
                        "mnxr": core_match["mnxr"],
                        "model_vs_core_orientation": orientation_against_core(item["vector"], core_match["vector"]),
                        "model_vs_mnx_orientation": item["orientation"],
                        "evidence_adapters": item.get("evidence_adapters", []),
                        "identity_qc_flags": item.get("identity_qc_flags", []),
                    }),
                ))
        elif reaction_id in unresolved_core or strong_unresolved:
            status = "UNRESOLVED"
            method = "STRONG_IDENTIFIER_OR_CHEMISTRY_CONFLICT"
            basis = "INCOMPLETE_OR_CONFLICTING_EXACT_EVIDENCE"
            relation = "UNKNOWN"
            notes = "Strong identity evidence exists but failed deterministic chemistry or uniqueness checks."
            flags.append("EXACT_EVIDENCE_UNRESOLVED")
            unresolved_participants = [
                {
                    "model_reaction_id": item["reaction"].model_id,
                    "model_metabolite_id": clean_model_id(raw, "M_"),
                    "reason": item["reason"],
                }
                for item in strong_unresolved
                for raw in item.get("unmatched", [])
            ]
            if unresolved_participants:
                unmatched_json = json_compact(unresolved_participants)
            for rank, item in enumerate(sorted(strong_unresolved, key=lambda value: value["reaction"].model_id), 1):
                candidate = item["reaction"]
                unmatched = item.get("unmatched", [])
                candidates.append((
                    stable_id("cand_", mapping_id, candidate.model_id), mapping_id, candidate.model_id, rank,
                    "AMBIGUOUS", method, basis,
                    json_compact({
                        "reason": item["reason"],
                        "unmatched_model_metabolites": unmatched,
                        "transported_metabolites": item.get("transported", []),
                        "compartments": item.get("compartments", []),
                    }),
                ))
        elif context_by_core.get(reaction_id):
            status = "CONTEXT_ONLY"
            method = "EC_ONLY_CONTEXT"
            basis = "EC_CONTEXT_NOT_REACTION_IDENTITY"
            relation = "NOT_APPLICABLE"
            notes = "EC overlap is contextual only and is excluded from native coverage."
            for rank, candidate_id in enumerate(sorted(context_by_core[reaction_id]), 1):
                candidates.append((
                    stable_id("cand_", mapping_id, candidate_id), mapping_id, candidate_id, rank,
                    "CONTEXT_ONLY", method, basis,
                    json_compact({"basis": "shared_ec", "shared_ec": sorted(context_by_core[reaction_id][candidate_id])}),
                ))
        context_candidate_count = len(context_by_core.get(reaction_id, {}))
        search_trace = {
            "schema_version": "reactenzdb-mapping-search-trace-v1",
            "policy_id": POLICY_ID,
            "release_id": release_id,
            "pinned_canonicalization_source": "MetaNetX 4.5",
            "core_canonicalization": (
                {"status": "VERIFIED_UNIQUE_MNXR", "mnxr": core_match["mnxr"]}
                if core_match else
                {
                    "status": (
                        "UNRESOLVED_STRONG_SOURCE_EVIDENCE"
                        if reaction_id in unresolved_core else "NO_VERIFIED_STRONG_SOURCE_EVIDENCE"
                    ),
                    "evidence_count": len(unresolved_core.get(reaction_id, [])),
                    "reasons": unresolved_core.get(reaction_id, []),
                }
            ),
            "model_search_space": {
                "model_reactions_total": model_stats.get("model_reactions", len(host.reactions)),
                "chemistry_verified_model_reactions": model_stats.get("chemistry_verified_model_reactions", 0),
                "pseudo_or_boundary_excluded": model_stats.get("excluded_reactions", 0),
                "transport_reactions_excluded": model_stats.get("transport_reactions_excluded", 0),
            },
            "result_counts": {
                "exact_chemistry_candidates": len(exact_candidates),
                "strong_unresolved_candidates": len(strong_unresolved),
                "ec_context_candidates": context_candidate_count,
            },
            "final_status": status,
            "conclusion": {
                "EXACT_NATIVE": "ONE_EXACT_CANDIDATE_DIRECTION_COMPATIBLE",
                "DIRECTIONAL_NATIVE": "ONE_EXACT_CANDIDATE_WITH_DIRECTION_CONTEXT",
                "CONTEXT_ONLY": "NO_EXACT_CANDIDATE_EC_CONTEXT_ONLY",
                "UNRESOLVED": "AMBIGUOUS_INCOMPLETE_OR_CONFLICTING_EVIDENCE",
                "NOT_MAPPED": "SEARCH_COMPLETE_NO_EXACT_UNRESOLVED_OR_CONTEXT_CANDIDATE",
            }[status],
            "negative_interpretation": (
                "Not mapped in this fixed release under this policy; not evidence of biological absence."
                if status == "NOT_MAPPED" else None
            ),
        }
        counts[status] += 1
        rows.append((
            mapping_id, reaction_id, release_id, POLICY_ID, model_reaction_id, status, method, basis,
            relation, core.get("reaction_equation_display"), host_equation, matched_json, unmatched_json,
            compartment, gene_rule, genes_json, confidence, notes, json_compact(flags),
            json_compact(search_trace), MAPPING_VERSION, CREATED_AT,
        ))
    return rows, candidates, counts


INSERT_MAPPING = """
INSERT INTO reaction_host_mapping (
 mapping_id,reaction_id,release_id,policy_id,model_reaction_id,mapping_status,mapping_method,
 identity_basis,direction_relation,reactenzdb_equation,host_equation,matched_metabolites_json,
 unmatched_metabolites_json,compartment_relation,gene_association,gene_ids_json,mapping_confidence,
 mapping_notes,qc_flags_json,search_trace_json,mapping_version,created_at
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
"""

INSERT_CANDIDATE = """
INSERT INTO reaction_host_mapping_candidates (
 candidate_id,mapping_id,model_reaction_id,candidate_rank,candidate_status,mapping_method,identity_basis,evidence_json
) VALUES (?,?,?,?,?,?,?,?)
"""


def validate_database(path: Path, expected_hosts: int, expected_reactions: int) -> dict[str, Any]:
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    counts = {
        "mappings": connection.execute("SELECT COUNT(*) FROM reaction_host_mapping").fetchone()[0],
        "candidates": connection.execute("SELECT COUNT(*) FROM reaction_host_mapping_candidates").fetchone()[0],
        "distinct_reactions": connection.execute("SELECT COUNT(DISTINCT reaction_id) FROM reaction_host_mapping").fetchone()[0],
        "distinct_releases": connection.execute("SELECT COUNT(DISTINCT release_id) FROM reaction_host_mapping").fetchone()[0],
    }
    status_counts = dict(connection.execute(
        "SELECT mapping_status,COUNT(*) FROM reaction_host_mapping GROUP BY mapping_status ORDER BY mapping_status"
    ).fetchall())
    expected = expected_hosts * expected_reactions
    checks = {
        "integrity_ok": connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok",
        "foreign_keys_ok": not connection.execute("PRAGMA foreign_key_check").fetchall(),
        "complete_matrix": counts["mappings"] == expected,
        "all_reactions_present": counts["distinct_reactions"] == expected_reactions,
        "all_releases_present": counts["distinct_releases"] == expected_hosts,
        "no_reo_keys": connection.execute("SELECT COUNT(*) FROM reaction_host_mapping WHERE reaction_id LIKE 'REO%'").fetchone()[0] == 0,
        "exact_contract": connection.execute(
            """SELECT COUNT(*) FROM reaction_host_mapping
               WHERE mapping_status IN ('EXACT_NATIVE','DIRECTIONAL_NATIVE')
               AND (model_reaction_id IS NULL OR mapping_confidence <> 1.0 OR direction_relation='UNKNOWN')"""
        ).fetchone()[0] == 0,
        "candidate_fk_complete": connection.execute(
            """SELECT COUNT(*) FROM reaction_host_mapping_candidates c
               LEFT JOIN reaction_host_mapping m ON m.mapping_id=c.mapping_id WHERE m.mapping_id IS NULL"""
        ).fetchone()[0] == 0,
        "no_accepted_cross_compartment_reactions": connection.execute(
            """SELECT COUNT(*) FROM reaction_host_mapping
               WHERE mapping_status IN ('EXACT_NATIVE','DIRECTIONAL_NATIVE')
                 AND compartment_relation='CROSS_COMPARTMENT_TRANSPORT_REQUIRED'"""
        ).fetchone()[0] == 0,
        "accepted_model_vs_core_orientation_recorded": connection.execute(
            """SELECT COUNT(*) FROM reaction_host_mapping m
               JOIN reaction_host_mapping_candidates c ON c.mapping_id=m.mapping_id
               WHERE m.mapping_status IN ('EXACT_NATIVE','DIRECTIONAL_NATIVE')
                 AND c.candidate_status='ACCEPTED'
                 AND (json_extract(c.evidence_json,'$.model_vs_core_orientation') IS NULL
                      OR json_extract(c.evidence_json,'$.model_vs_core_orientation') NOT IN ('SAME','REVERSE'))"""
        ).fetchone()[0] == 0,
        "search_trace_complete": connection.execute(
            """SELECT COUNT(*) FROM reaction_host_mapping
               WHERE json_extract(search_trace_json,'$.final_status') <> mapping_status
                  OR json_extract(search_trace_json,'$.policy_id') <> policy_id"""
        ).fetchone()[0] == 0,
        "not_mapped_negative_trace_complete": connection.execute(
            """SELECT COUNT(*) FROM reaction_host_mapping
               WHERE mapping_status='NOT_MAPPED' AND (
                    json_extract(search_trace_json,'$.conclusion') <> 'SEARCH_COMPLETE_NO_EXACT_UNRESOLVED_OR_CONTEXT_CANDIDATE'
                 OR json_extract(search_trace_json,'$.result_counts.exact_chemistry_candidates') <> 0
                 OR json_extract(search_trace_json,'$.result_counts.strong_unresolved_candidates') <> 0
                 OR json_extract(search_trace_json,'$.result_counts.ec_context_candidates') <> 0
                 OR json_extract(search_trace_json,'$.negative_interpretation') IS NULL
               )"""
        ).fetchone()[0] == 0,
    }
    connection.close()
    if not all(checks.values()):
        raise RuntimeError(f"mapping staging validation failed: {checks}")
    return {"counts": counts, "status_counts": status_counts, "checks": checks}


def ensure_mapping_schema(connection: sqlite3.Connection) -> None:
    columns = {
        row[1] for row in connection.execute("PRAGMA table_info(reaction_host_mapping)")
    }
    if "search_trace_json" not in columns:
        connection.execute(
            """ALTER TABLE reaction_host_mapping
               ADD COLUMN search_trace_json TEXT NOT NULL DEFAULT '{}'
               CHECK (json_valid(search_trace_json))"""
        )


def logical_table_sha256(path: Path, table: str, order_by: str) -> str:
    """Hash typed row content, independent of SQLite page/header layout."""
    digest = hashlib.sha256()
    connection = sqlite3.connect(f"file:{path.resolve().as_posix()}?mode=ro", uri=True)
    connection.execute("PRAGMA query_only=ON")
    columns = [row[1] for row in connection.execute(f"PRAGMA table_info({table})")]
    digest.update((table + "\0" + "\x1f".join(columns) + "\0").encode("utf-8"))
    for row in connection.execute(f"SELECT * FROM {table} ORDER BY {order_by}"):
        for value in row:
            if value is None:
                encoded = b"N"
            elif isinstance(value, bytes):
                encoded = b"B" + value
            else:
                encoded = b"T" + str(value).encode("utf-8")
            digest.update(len(encoded).to_bytes(8, "big"))
            digest.update(encoded)
    connection.close()
    return digest.hexdigest()


def logical_mapping_digests(path: Path) -> dict[str, str]:
    mapping = logical_table_sha256(path, "reaction_host_mapping", "mapping_id")
    candidates = logical_table_sha256(
        path, "reaction_host_mapping_candidates", "candidate_id"
    )
    combined = hashlib.sha256(
        f"reaction_host_mapping:{mapping}\nreaction_host_mapping_candidates:{candidates}\n".encode("ascii")
    ).hexdigest()
    return {
        "reaction_host_mapping": mapping,
        "reaction_host_mapping_candidates": candidates,
        "combined": combined,
    }


def markdown_report(summary: dict[str, Any]) -> str:
    lines = [
        "# Reaction × Host mapping 第三步报告（2026.09.1 staging）",
        "",
        "## 结论",
        "",
        f"第三步 staging 完整矩阵已生成：{summary['validation']['counts']['mappings']:,} 行，"
        f"覆盖 {summary['host_count']} 个固定模型 release × {summary['reaction_count']:,} 个 reaction_id。",
        "该结果尚未进入网页、API 或正式数据库，也尚未经过第四步双人抽样审核。",
        "",
        "## 事实",
        "",
        f"- 规则：`{summary['policy_id']}`；SHA-256 `{summary['policy_sha256']}`。",
        f"- MetaNetX：4.5；归档 SHA-256 `{summary['metanetx_sha256']}`。",
        f"- staging 数据库 SHA-256：`{summary['database_sha256']}`。",
        f"- 映射逻辑内容 SHA-256：`{summary['logical_content_sha256']['combined']}`（不受 SQLite 页头变化影响）。",
        f"- 候选证据行：{summary['validation']['counts']['candidates']:,}。",
        f"- 状态分布：`{json_compact(summary['validation']['status_counts'])}`。",
        f"- 生产库 {len(summary['release_database_integrity']['sha256_after'])} 个文件写前/写后 SHA 全部一致。",
        "- `reo_id` 未被用作 reaction 主键；所有映射绑定 `reaction_id × release_id × policy_id`。",
        "- XML 解析未调用 COBRApy、GLPK 或 MEMOTE；第三步没有重新求解生长。",
        "- SQLite 文件 SHA 用于标识当前物理文件；可复现性以按主键排序计算的逻辑内容 SHA 为准。",
        "",
        "## 推断",
        "",
        "- `EXACT_NATIVE`/`DIRECTIONAL_NATIVE` 表示规范化化学身份通过，不等于实验可行、可生长或推荐宿主。",
        "- `NOT_MAPPED` 只表示在所选模型 release 和当前证据中未映射，不能解释为该生物体不存在该反应。",
        "- `UNRESOLVED` 主要反映方向未知、多个模型反应候选或强标识与化学计量冲突，需第四步分类审核。",
        "",
        "## 建议",
        "",
        "- 下一步执行第四步：生成新旧映射差异、按状态/宿主/映射方法分层抽样 200–300 对，并进行双人审核。",
        "- 第四步完成前，不据此发布 coverage、Jaccard 或 host-specific 统计。",
        "",
        "## 未确认许可",
        "",
        "- 未获得将 staging 映射接入生产数据库、正式 Hosts 页面、API 或下载包的许可。",
        "- 模型再分发和商业使用许可仍以 Host Registry 的逐 release 许可记录为准；本步骤不改变许可结论。",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run-hosts", type=int, default=0, help="process only the first N hosts and do not write the database")
    parser.add_argument(
        "--dry-run-host",
        action="append",
        default=[],
        help="process the named host_id only; repeatable and never writes the database",
    )
    args = parser.parse_args()
    before = production_hashes()
    if sha256(POLICY_PATH) != EXPECTED_POLICY_SHA:
        raise RuntimeError("mapping policy SHA drift")
    if sha256(MNX_ARCHIVE) != EXPECTED_MNX_SHA:
        raise RuntimeError("MetaNetX archive SHA drift")
    release_rows = collect_release_rows()
    if args.dry_run_host:
        requested = set(args.dry_run_host)
        known = {row["host_id"] for row in release_rows}
        if requested - known:
            raise RuntimeError(f"unknown dry-run host IDs: {sorted(requested - known)}")
        release_rows = [row for row in release_rows if row["host_id"] in requested]
    elif args.dry_run_hosts:
        release_rows = release_rows[: args.dry_run_hosts]
    core_reactions, _, mnx_rows = load_core()
    log(f"Parsing {len(release_rows)} normalized SBML models without a solver...")
    models: list[ParsedModel] = []
    adapter_stats_by_host: dict[str, dict[str, int]] = {}
    wanted_chem: set[str] = set()
    wanted_reac: set[str] = set()
    for index, row in enumerate(release_rows, 1):
        path = normalized_path(row)
        model = parse_model(row["host_id"], row["release_id"], path)
        adapter_stats = apply_iyali_source_dictionary(model)
        adapter_stats.update(apply_manual_metabolite_resolutions(model))
        adapter_stats_by_host[model.host_id] = adapter_stats
        models.append(model)
        for metabolite in model.metabolites.values():
            wanted_chem |= metabolite.xref_keys
        for reaction in model.reactions:
            wanted_reac |= reaction.xref_keys
        log(f"[{index}/{len(release_rows)}] {row['host_id']}: {len(model.reactions)} reactions")
    for rows in mnx_rows.values():
        for row in rows:
            parsed = equation_terms(row.get("source_equation") or "")
            if parsed:
                for identifier in parsed[1]:
                    key = equation_source_key(identifier)
                    if key:
                        wanted_chem.add(key)
    log("Scanning pinned MetaNetX xrefs once per member...")
    chem_xrefs, reac_xrefs = scan_xrefs(wanted_chem, wanted_reac)
    wanted_properties = {
        identifier
        for model in models
        for metabolite in model.metabolites.values()
        for identifier in metabolite.direct_mnx
    } | {identifier for values in chem_xrefs.values() for identifier in values}
    log("Loading formula/charge for candidate canonical metabolites...")
    chem_properties = load_chem_properties(wanted_properties)
    log("Indexing pinned MetaNetX reaction chemistry...")
    mnx_vectors, signature_index = load_mnx_reaction_vectors()
    verified_core, unresolved_core, core_stats = verified_core_mnx(mnx_rows, chem_xrefs, mnx_vectors)
    host_prepared: list[tuple[ParsedModel, dict[str, Any], Any, Any, Any, Any]] = []
    for model, release in zip(models, release_rows):
        accepted, unresolved_host, ec_model, model_stats = reaction_candidates(
            model, chem_xrefs, chem_properties, reac_xrefs, mnx_vectors, signature_index
        )
        model_stats.update(adapter_stats_by_host.get(model.host_id, {}))
        host_prepared.append((model, release, accepted, unresolved_host, ec_model, model_stats))
        log(f"Prepared {model.host_id}: {model_stats.get('chemistry_verified_model_reactions', 0)} chemistry-verified model reactions")
    after_read = production_hashes()
    if before != after_read:
        raise RuntimeError("production database SHA changed during read-only preparation")
    if args.dry_run_hosts or args.dry_run_host:
        preview: dict[str, Any] = {}
        for model, release, accepted, unresolved_host, ec_model, model_stats in host_prepared:
            rows, candidates, counts = build_host_rows(
                model, release["release_id"], core_reactions, verified_core, unresolved_core,
                accepted, unresolved_host, ec_model, model_stats,
            )
            preview[model.host_id] = {
                "release_id": release["release_id"],
                "model_stats": model_stats,
                "mapping_status_counts": dict(counts),
                "mapping_rows": len(rows),
                "candidate_rows": len(candidates),
            }
        report = {
            "schema_version": "reactenzdb-host-reaction-mapping-dry-run-v1",
            "as_of_date": "2026-09-15",
            "dry_run": True,
            "database_writes": "NONE",
            "policy_id": POLICY_ID,
            "policy_sha256": EXPECTED_POLICY_SHA,
            "metanetx_sha256": EXPECTED_MNX_SHA,
            "core_reaction_stats": core_stats,
            "hosts": preview,
            "release_database_integrity": {"unchanged": before == after_read, "sha256": after_read},
        }
        DRY_RUN_REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        log(json.dumps({"dry_run_hosts": len(preview), "report": str(DRY_RUN_REPORT), "production_unchanged": True}, ensure_ascii=False))
        return
    staging_parent = STAGING_DB.parent.resolve()
    if not STAGING_DB.resolve().is_relative_to(staging_parent):
        raise RuntimeError("refusing to write outside host-context staging")
    temporary = STAGING_DB.with_suffix(".step3.tmp.sqlite")
    if temporary.exists():
        temporary.unlink()
    shutil.copy2(STAGING_DB, temporary)
    connection = sqlite3.connect(temporary)
    try:
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA journal_mode=DELETE")
        connection.execute("PRAGMA synchronous=FULL")
        ensure_mapping_schema(connection)
        connection.execute("DELETE FROM reaction_host_mapping_candidates")
        connection.execute("DELETE FROM reaction_host_mapping")
        connection.execute(
            "INSERT OR REPLACE INTO registry_build_sources(source_path,source_role,sha256) VALUES (?,?,?)",
            ("external/reaction_standardization/metanetx/mnxref_tsv.tar.gz", "MAPPING_CANONICALIZATION_SOURCE", EXPECTED_MNX_SHA),
        )
        connection.execute(
            "INSERT OR REPLACE INTO registry_build_sources(source_path,source_role,sha256) VALUES (?,?,?)",
            (
                MANUAL_METABOLITE_RESOLUTIONS.relative_to(ROOT).as_posix(),
                "CURATED_METABOLITE_IDENTITY_RESOLUTION",
                EXPECTED_MANUAL_METABOLITE_RESOLUTIONS_SHA,
            ),
        )
        connection.execute(
            "INSERT OR REPLACE INTO registry_build_sources(source_path,source_role,sha256) VALUES (?,?,?)",
            (
                IYALI_DICTIONARY.relative_to(ROOT).as_posix(),
                "IYALI_4_1_2_ANNOTATION_ONLY_SOURCE_DICTIONARY",
                EXPECTED_IYALI_DICTIONARY_SHA,
            ),
        )
        per_host: dict[str, Any] = {}
        for index, (model, release, accepted, unresolved_host, ec_model, model_stats) in enumerate(host_prepared, 1):
            rows, candidates, counts = build_host_rows(
                model, release["release_id"], core_reactions, verified_core, unresolved_core,
                accepted, unresolved_host, ec_model, model_stats,
            )
            connection.executemany(INSERT_MAPPING, rows)
            connection.executemany(INSERT_CANDIDATE, candidates)
            connection.commit()
            per_host[model.host_id] = {
                "release_id": release["release_id"],
                "model_stats": model_stats,
                "mapping_status_counts": dict(counts),
                "mapping_rows": len(rows),
                "candidate_rows": len(candidates),
            }
            log(f"[{index}/{len(host_prepared)}] inserted {model.host_id}: {len(rows)} mappings, {len(candidates)} candidates")
        connection.execute("VACUUM")
        connection.close()
        validation = validate_database(temporary, len(release_rows), len(core_reactions))
        os.replace(temporary, STAGING_DB)
    except Exception:
        connection.close()
        if temporary.exists():
            temporary.unlink()
        raise
    after = production_hashes()
    if before != after:
        raise RuntimeError("production database SHA changed during staging build")
    summary = {
        "schema_version": "reactenzdb-host-reaction-mapping-step3-summary-v1",
        "as_of_date": "2026-09-15",
        "release_target": "2026.09.1",
        "database_writes": "STAGING_ONLY",
        "production_database_writes": "NONE",
        "policy_id": POLICY_ID,
        "policy_sha256": EXPECTED_POLICY_SHA,
        "mapping_version": MAPPING_VERSION,
        "metanetx_version": "4.5",
        "metanetx_sha256": EXPECTED_MNX_SHA,
        "mapping_adapters": {
            "ibt721_sid_decoder": "TERMINAL_LIBSBML_BRACKET_COMPARTMENT_ONLY",
            "iyali_source_dictionary": {
                "path": IYALI_DICTIONARY.relative_to(ROOT).as_posix(),
                "sha256": EXPECTED_IYALI_DICTIONARY_SHA,
                "scope": "ANNOTATION_ONLY",
            },
            "manual_metabolite_identity_resolutions": {
                "path": MANUAL_METABOLITE_RESOLUTIONS.relative_to(ROOT).as_posix(),
                "sha256": EXPECTED_MANUAL_METABOLITE_RESOLUTIONS_SHA,
                "scope": "STAGING_MAPPING_ONLY",
            },
            "transport_exclusion": "EXPLICIT_SBO_OR_CROSS_COMPARTMENT_BEFORE_NEUTRAL_COLLAPSE",
            "negative_search_trace": "reaction_host_mapping.search_trace_json",
        },
        "host_count": len(release_rows),
        "reaction_count": len(core_reactions),
        "core_reaction_validation": core_stats,
        "hosts": per_host,
        "validation": validation,
        "database_path": STAGING_DB.relative_to(ROOT).as_posix(),
        "database_sha256": sha256(STAGING_DB),
        "logical_content_sha256": logical_mapping_digests(STAGING_DB),
        "database_size_bytes": STAGING_DB.stat().st_size,
        "release_database_integrity": {
            "unchanged": before == after,
            "sha256_before": before,
            "sha256_after": after,
        },
        "interpretation_limits": [
            "Exact mapping confidence is chemical identity only, not host suitability or experimental feasibility.",
            "NOT_MAPPED does not mean biological absence.",
            "Step 4 stratified double review is still required before comparable statistics are frozen.",
        ],
        "production_approval": "NOT_GRANTED",
    }
    SUMMARY_JSON.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    SUMMARY_MD.write_text(markdown_report(summary), encoding="utf-8")
    log(json.dumps({
        "database": str(STAGING_DB),
        "sha256": summary["database_sha256"],
        "mappings": validation["counts"]["mappings"],
        "candidates": validation["counts"]["candidates"],
        "status_counts": validation["status_counts"],
        "production_unchanged": True,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
