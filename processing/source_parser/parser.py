from __future__ import annotations

from html import unescape
import json
import re
from typing import Any

from bs4 import BeautifulSoup, Tag

from .config import EXTRACTION_VERSION
from .utils import normalize_key, normalize_text, safe_float, sha256_text, stable_json


def parse_list_page(html: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    ids: set[str] = set()
    for anchor in soup.find_all("a", href=True):
        href = anchor["href"]
        match = re.search(r"/rdbsb/bioparts_detail/(OENC\d+)(?:\.p)?", href)
        if match:
            ids.add(match.group(1))

    total = None
    total_match = re.search(r"Total：</span>\s*<b[^>]*>(\d+)</b>", html)
    if total_match:
        total = int(total_match.group(1))
    return {"total": total, "biopart_ids": sorted(ids)}


def parse_detail_page(biopart_id: str, html: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    embedded = _extract_embedded_payloads(html)
    reference_lookup = _build_reference_lookup(soup)
    card = soup.find(id="cf")
    card_body = card.find_parent(class_="card-body") if card else soup
    rows = card_body.find_all("div", class_="row", recursive=False)

    general_rows: list[Tag] = []
    reaction_rows: list[Tag] = []
    other_rows: list[Tag] = []
    for row in rows:
        if row.find("h4"):
            reaction_rows.append(row)
            continue
        group_titles = [normalize_key(group.find(class_="detail-group-title").get_text(" ", strip=True)) for group in row.select("div.detail-group") if group.find(class_="detail-group-title")]
        if any(
            title in {
                "name",
                "synonym",
                "organism",
                "optimum ph",
                "optimum temperature(ºc)",
                "chassis",
                "reactions",
                "pathways",
            }
            for title in group_titles
        ):
            general_rows.append(row)
        elif group_titles and all(title in {"external links", "ec number"} for title in group_titles if title):
            reaction_rows.append(row)
        else:
            other_rows.append(row)

    general_groups = _parse_row_groups(general_rows, reference_lookup=reference_lookup)
    general_map = _group_map(general_groups)

    biopart = _build_biopart(
        biopart_id,
        general_map,
        embedded.get("seq") or [],
        embedded.get("curr_protein_seq"),
    )
    reactions, reaction_compounds, biopart_reactions, xrefs, reaction_refs = _build_reactions(
        biopart_id=biopart_id,
        reaction_rows=reaction_rows,
        embedded_reactions=embedded.get("reationsList") or [],
        reference_lookup=reference_lookup,
        default_pathways=biopart.get("pathway_annotations_json"),
        default_chassis=biopart.get("chassis_json"),
        default_ph=biopart.get("optimum_ph_json"),
        default_temp=biopart.get("optimum_temperature_json"),
        default_organism=biopart.get("organism"),
        evidence_label=biopart.get("evidence_label"),
    )

    compound_rows = _build_compounds_from_relations(reaction_compounds)
    other_payload = _parse_other_sections(other_rows, reference_lookup=reference_lookup)
    _fill_biopart_from_other_sections(biopart, other_payload)
    xrefs.extend(_parse_generic_xrefs(biopart_id, other_payload, reaction_compounds))
    references = reaction_refs + _parse_references(biopart_id, reference_lookup)
    attribute_evidences = _build_attribute_evidences(
        biopart=biopart,
        biopart_reactions=biopart_reactions,
        general_groups=general_groups,
        other_payload=other_payload,
        reference_lookup=reference_lookup,
    )
    kinetics = _parse_kinetics(
        biopart_id=biopart_id,
        card_body=card_body,
        reactions=reactions,
        reaction_compounds=reaction_compounds,
        compound_lookup={r["compound_name_raw"]: r["compound_id"] for r in reaction_compounds if r.get("compound_name_raw")},
    )

    return {
        "biopart": biopart,
        "reactions": reactions,
        "compounds": compound_rows,
        "biopart_reactions": biopart_reactions,
        "reaction_compounds": reaction_compounds,
        "kinetics": kinetics,
        "xrefs": xrefs,
        "references": references,
        "attribute_evidences": attribute_evidences,
    }


def _build_biopart(
    biopart_id: str,
    general_map: dict[str, dict[str, Any]],
    embedded_seq: list[dict[str, Any]],
    embedded_protein_sequence: str | None,
) -> dict[str, Any]:
    evidence_text = " ".join([group.get("text") or "" for group in general_map.values()])
    gene_names = sorted({normalize_text(item.get("gene_name")) for item in embedded_seq if normalize_text(item.get("gene_name"))})
    nt_ids = sorted(
        {
            normalize_text(item.get("npbiosys_gene_id"))
            for item in embedded_seq
            if normalize_text(item.get("npbiosys_gene_id"))
        }
    )
    nt_sequences = [item.get("rseq") for item in embedded_seq if item.get("rseq")]
    return {
        "biopart_id": biopart_id,
        "protein_id": None,
        "name": _group_text(general_map, "name"),
        "enzyme_name": _group_text(general_map, "name"),
        "synonyms_json": _group_json(general_map, "synonym"),
        "gene_name_primary": _preferred_gene_name(gene_names),
        "gene_names_json": stable_json(gene_names) if gene_names else None,
        "protein_sequence": _extract_sequence(embedded_protein_sequence),
        "nt_ids_json": stable_json(nt_ids) if nt_ids else None,
        "nt_sequences_json": stable_json(nt_sequences) if nt_sequences else None,
        "cds_sequence": None,
        "organism": _group_text(general_map, "organism"),
        "enzyme_organism": _group_text(general_map, "organism"),
        "source_organism": _group_text(general_map, "organism"),
        "taxonomy_id": _extract_taxonomy_id(_group_text(general_map, "taxonomy id")),
        "lineage": None,
        "chassis_json": _group_json(general_map, "chassis"),
        "source_tissues_json": None,
        "subcellular_localizations_json": None,
        "pathway_annotations_json": _group_json(general_map, "pathways"),
        "optimum_ph_json": _group_json(general_map, "optimum ph"),
        "optimum_temperature_json": _group_json(general_map, "optimum temperature(ºc)")
        or _group_json(general_map, "optimum temperature(\u6f5ec)"),
        "temperature_stability_json": None,
        "ph_stability_json": None,
        "molecular_weight_json": None,
        "protein_families_json": None,
        "subunit_structure_json": None,
        "evidence_label": "experimental evidence" if "experimental evidence" in evidence_text.lower() else None,
        "raw_general_json": stable_json(list(general_map.values())),
        "raw_organism_json": None,
        "raw_sequence_json": stable_json(embedded_seq) if embedded_seq else None,
        "extraction_version": EXTRACTION_VERSION,
    }


def _build_reactions(
    biopart_id: str,
    reaction_rows: list[Tag],
    embedded_reactions: list[dict[str, Any]],
    reference_lookup: dict[str, str],
    default_pathways: str | None,
    default_chassis: str | None,
    default_ph: str | None,
    default_temp: str | None,
    default_organism: str | None,
    evidence_label: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    if embedded_reactions:
        return _build_reactions_from_embedded(
            biopart_id=biopart_id,
            embedded_reactions=embedded_reactions,
            reference_lookup=reference_lookup,
            default_pathways=default_pathways,
            default_chassis=default_chassis,
            default_ph=default_ph,
            default_temp=default_temp,
            default_organism=default_organism,
            evidence_label=evidence_label,
        )

    reactions: list[dict[str, Any]] = []
    reaction_compounds: list[dict[str, Any]] = []
    biopart_reactions: list[dict[str, Any]] = []
    xrefs: list[dict[str, Any]] = []
    references: list[dict[str, Any]] = []
    current_reaction: dict[str, Any] | None = None
    reaction_counter = 0

    for row in reaction_rows:
        if row.find("h4"):
            reaction_counter += 1
            equation = normalize_text(row.find("h4").get_text(" ", strip=True))
            reaction_id = f"{biopart_id}::rxn::{reaction_counter}"
            compounds, connectors = _parse_reaction_compounds(row)
            cofactor_names = set()
            compounds = _assign_roles(compounds, connectors, cofactor_names)
            current_reaction = {
                "reaction_id": reaction_id,
                "reaction_index": reaction_counter,
                "reaction_equation_raw": equation,
                "reaction_equation_display": equation,
                "reaction_direction": _infer_direction(equation),
                "ec_number": None,
                "evidence_level": evidence_label,
                "source_db": "RDBSB",
                "rhea_id": None,
                "kegg_reaction_id": None,
                "metacyc_reaction_id": None,
                "reaction_center": None,
                "reaction_template": None,
                "balanced_or_not": None,
                "cofactors_json": None,
                "pathway_names_json": default_pathways,
                "raw_reaction_json": stable_json(
                    {
                        "row_html": str(row),
                        "connectors": connectors,
                        "compounds": compounds,
                    }
                ),
                "extraction_version": EXTRACTION_VERSION,
            }
            reactions.append(current_reaction)
            biopart_reactions.append(
                {
                    "biopart_reaction_id": f"{biopart_id}::{reaction_id}",
                    "biopart_id": biopart_id,
                    "reaction_id": reaction_id,
                    "reaction_organism": default_organism,
                    "enzyme_organism": default_organism,
                    "chassis_json": default_chassis,
                    "pathway_name_json": default_pathways,
                    "optimum_ph_json": default_ph,
                    "optimum_temperature_json": default_temp,
                    "temperature_stability_json": None,
                    "ph_stability_json": None,
                    "source_tissues_json": None,
                    "evidence_level": evidence_label,
                    "source_db": "RDBSB",
                    "raw_relation_json": stable_json({"row_html": str(row)}),
                }
            )
            for compound in compounds:
                reaction_compounds.append(
                    {
                        "reaction_compound_id": f"{reaction_id}::{compound['position_index']}",
                        "reaction_id": reaction_id,
                        "compound_id": compound["chebi_id_raw"] or f"{reaction_id}::cmp::{compound['position_index']}",
                        "role": compound["role"] or "unknown",
                        "side": compound["side"],
                        "position_index": compound["position_index"],
                        "stoichiometry": None,
                        "compound_name_raw": compound["compound_name_raw"],
                        "chebi_id_raw": compound["chebi_id_raw"],
                        "formula_raw": compound["formula_raw"],
                        "connector_before": compound["connector_before"],
                        "source_db": "RDBSB",
                        "raw_relation_json": stable_json(compound),
                    }
                )
            continue

        current_reaction = _patch_reaction_from_detail_group_row(current_reaction, row, xrefs)
    return reactions, reaction_compounds, biopart_reactions, xrefs, references


def _build_reactions_from_embedded(
    biopart_id: str,
    embedded_reactions: list[dict[str, Any]],
    reference_lookup: dict[str, str],
    default_pathways: str | None,
    default_chassis: str | None,
    default_ph: str | None,
    default_temp: str | None,
    default_organism: str | None,
    evidence_label: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    reactions: list[dict[str, Any]] = []
    reaction_compounds: list[dict[str, Any]] = []
    biopart_reactions: list[dict[str, Any]] = []
    xrefs: list[dict[str, Any]] = []
    references: list[dict[str, Any]] = []

    for index, item in enumerate(embedded_reactions, start=1):
        reaction_info = item.get("reactions") or {}
        reaction_id = reaction_info.get("npbiosys_reaction_id") or f"{biopart_id}::rxn::{index}"
        rhea_id = reaction_info.get("rhea_id")
        reaction = {
            "reaction_id": reaction_id,
            "reaction_index": index,
            "reaction_equation_raw": normalize_text(reaction_info.get("equation")),
            "reaction_equation_display": normalize_text(reaction_info.get("equation")),
            "reaction_direction": normalize_text(reaction_info.get("direction")),
            "ec_number": _first_value(item.get("reaction_ec_number"), "value"),
            "evidence_level": evidence_label,
            "source_db": normalize_text(item.get("source")) or "RDBSB",
            "rhea_id": str(rhea_id) if rhea_id is not None else None,
            "kegg_reaction_id": _extract_external_link_value(item.get("external_links"), r"R\d+"),
            "metacyc_reaction_id": _extract_external_link_value(item.get("external_links"), r"RXN-[A-Z0-9-]+"),
            "reaction_center": None,
            "reaction_template": None,
            "balanced_or_not": None,
            "cofactors_json": None,
            "pathway_names_json": default_pathways,
            "raw_reaction_json": stable_json(item),
            "extraction_version": EXTRACTION_VERSION,
        }
        reactions.append(reaction)
        biopart_reactions.append(
            {
                "biopart_reaction_id": f"{biopart_id}::{reaction_id}",
                "biopart_id": biopart_id,
                "reaction_id": reaction_id,
                "reaction_organism": default_organism,
                "enzyme_organism": default_organism,
                "chassis_json": default_chassis,
                "pathway_name_json": default_pathways,
                "optimum_ph_json": default_ph,
                "optimum_temperature_json": default_temp,
                "temperature_stability_json": None,
                "ph_stability_json": None,
                "source_tissues_json": None,
                "evidence_level": evidence_label,
                "source_db": normalize_text(item.get("source")) or "RDBSB",
                "raw_relation_json": stable_json(item.get("bioparts")),
            }
        )

        for db_name, value, url in _embedded_reaction_xrefs(item):
            xrefs.append(
                {
                    "entity_type": "reaction",
                    "entity_id": reaction_id,
                    "xref_db": db_name,
                    "xref_value": value,
                    "xref_url": url,
                    "source_db": "RDBSB",
                    "raw_json": stable_json(item.get("external_links")),
                }
            )

        compounds = []
        for side_name, role in (("left", "substrate"), ("right", "product")):
            for position, compound in enumerate(reaction_info.get(side_name) or []):
                chebi_id = _first_accession(compound)
                compound_id = chebi_id or f"{reaction_id}::cmp::{side_name}::{position}"
                raw_compound = {
                    "name": normalize_text(compound.get("name")),
                    "formula": normalize_text(compound.get("formula")),
                    "charge": compound.get("charge"),
                    "coefficient": compound.get("coefficient"),
                    "coefficient_name": normalize_text(compound.get("coefficientName")),
                    "accession": compound.get("accession"),
                    "order": compound.get("order"),
                    "side": side_name,
                    "role": role,
                }
                compounds.append(raw_compound)
                reaction_compounds.append(
                    {
                        "reaction_compound_id": f"{reaction_id}::{side_name}::{position}",
                        "reaction_id": reaction_id,
                        "compound_id": compound_id,
                        "role": role,
                        "side": side_name,
                        "position_index": position,
                        "stoichiometry": normalize_text(compound.get("coefficientName")),
                        "compound_name_raw": normalize_text(compound.get("name")),
                        "chebi_id_raw": chebi_id,
                        "formula_raw": normalize_text(compound.get("formula")),
                        "connector_before": None,
                        "source_db": "RDBSB",
                        "raw_relation_json": stable_json(raw_compound),
                    }
                )
                if chebi_id:
                    xrefs.append(
                        {
                            "entity_type": "compound",
                            "entity_id": compound_id,
                            "xref_db": "chebi",
                            "xref_value": chebi_id,
                            "xref_url": f"https://www.ebi.ac.uk/chebi/searchId.do?chebiId={chebi_id}",
                            "source_db": "RDBSB",
                            "raw_json": stable_json(compound),
                        }
                    )

        for ref_index, ref in enumerate(item.get("reaction_reference") or [], start=1):
            pmids = ref.get("pmid")
            if isinstance(pmids, list):
                ref_pmids = pmids
            elif pmids:
                ref_pmids = [str(pmids)]
            else:
                ref_pmids = []
            for pmid in ref_pmids:
                references.append(
                    {
                        "entity_type": "reaction",
                        "entity_id": reaction_id,
                        "pmid": pmid,
                        "citation_text": reference_lookup.get(str(pmid)) or normalize_text(ref.get("source")) or f"reaction_reference_{ref_index}",
                        "reference_url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}" if pmid else None,
                        "source_db": "RDBSB",
                        "raw_json": stable_json(ref),
                    }
                )
    return reactions, reaction_compounds, biopart_reactions, xrefs, references


def _patch_reaction_from_detail_group_row(
    reaction: dict[str, Any] | None,
    row: Tag,
    xrefs: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if reaction is None:
        return None
    for group in row.select("div.detail-group"):
        payload = _group_payload(group)
        title_key = payload["title_key"]
        if title_key == "external links":
            for link in payload["links"]:
                db_name, value = _classify_reaction_xref(link["href"], link["text"])
                if not db_name or not value:
                    continue
                xrefs.append(
                    {
                        "entity_type": "reaction",
                        "entity_id": reaction["reaction_id"],
                        "xref_db": db_name,
                        "xref_value": value,
                        "xref_url": link["href"],
                        "source_db": "RDBSB",
                        "raw_json": stable_json(link),
                    }
                )
                if db_name == "rhea":
                    reaction["rhea_id"] = value
                elif db_name == "kegg_reaction":
                    reaction["kegg_reaction_id"] = value
                elif db_name == "metacyc_reaction":
                    reaction["metacyc_reaction_id"] = value
        elif title_key == "ec number":
            match = re.search(r"\d+\.\d+\.\d+\.\d+", payload["text"] or "")
            if match:
                reaction["ec_number"] = match.group(0)
    return reaction


def _build_compounds_from_relations(reaction_compounds: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    compounds: list[dict[str, Any]] = []
    for relation in reaction_compounds:
        compound_id = relation["compound_id"]
        if compound_id in seen:
            continue
        seen.add(compound_id)
        raw_payload = {}
        if relation.get("raw_relation_json"):
            try:
                raw_payload = json.loads(relation["raw_relation_json"])
            except json.JSONDecodeError:
                raw_payload = {}
        compounds.append(
            {
                "compound_id": compound_id,
                "compound_name": relation["compound_name_raw"],
                "names_json": stable_json([relation["compound_name_raw"]]) if relation["compound_name_raw"] else None,
                "chebi_id": relation["chebi_id_raw"],
                "structure_string": None,
                "smiles": None,
                "inchi": None,
                "inchikey": None,
                "formula": relation["formula_raw"],
                "exact_mass": None,
                "charge": str(raw_payload.get("charge")) if raw_payload.get("charge") is not None else None,
                "synonyms_json": None,
                "pubchem_id": None,
                "kegg_compound_id": None,
                "raw_compound_json": relation["raw_relation_json"],
                "extraction_version": EXTRACTION_VERSION,
            }
        )
    return compounds


def _parse_other_sections(
    rows: list[Tag],
    reference_lookup: dict[str, str] | None = None,
) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = {"organism": [], "sequence": [], "cross_links": []}
    for row in rows:
        for group in row.select("div.detail-group"):
            payload = _group_payload(group, reference_lookup=reference_lookup)
            key = payload["title_key"]
            if key in {"taxonomy", "taxonomy id", "lineage", "source tissue", "subcellular localization"}:
                result["organism"].append(payload)
            elif key in {
                "protein id",
                "molecular weight",
                "xref",
                "gene name",
                "nt seq id",
                "protein family",
                "pfam entry",
                "definition",
                "pdb id",
                "subunit structure",
            }:
                result["sequence"].append(payload)
            elif key in {"brenda", "uniprot", "kegg", "rhea", "metacyc", "enzyme"}:
                result["cross_links"].append(payload)
    return result


def _fill_biopart_from_other_sections(biopart: dict[str, Any], payload: dict[str, list[dict[str, Any]]]) -> None:
    org_map = _group_map(payload.get("organism", []))
    seq_map = _group_map(payload.get("sequence", []))

    taxonomy_text = _group_text(org_map, "taxonomy id") or _find_group_text_from_json(
        biopart.get("raw_general_json"),
        "taxonomy id",
    )
    biopart["taxonomy_id"] = biopart.get("taxonomy_id") or _extract_taxonomy_id(taxonomy_text)
    biopart["lineage"] = _group_text(org_map, "lineage")
    biopart["source_tissues_json"] = _group_json(org_map, "source tissue")
    biopart["subcellular_localizations_json"] = _group_json(org_map, "subcellular localization")
    biopart["raw_organism_json"] = stable_json(payload.get("organism"))

    biopart["protein_id"] = _group_text(seq_map, "protein id")
    biopart["molecular_weight_json"] = _group_json(seq_map, "molecular weight")
    seq_text = _group_text(seq_map, "sequence")
    biopart["protein_sequence"] = biopart.get("protein_sequence") or _extract_sequence(seq_text)
    biopart["protein_families_json"] = _group_json(seq_map, "protein family") or _group_json(seq_map, "pfam entry")
    biopart["subunit_structure_json"] = _group_json(seq_map, "subunit structure")
    biopart["gene_name_primary"] = biopart.get("gene_name_primary") or _group_text(seq_map, "gene name")
    if not biopart.get("nt_ids_json"):
        biopart["nt_ids_json"] = _group_json(seq_map, "nt seq id")
    if payload.get("sequence"):
        if biopart.get("raw_sequence_json"):
            try:
                existing = json.loads(biopart["raw_sequence_json"])
            except json.JSONDecodeError:
                existing = []
            merged = existing + payload.get("sequence", [])
            biopart["raw_sequence_json"] = stable_json(merged)
        else:
            biopart["raw_sequence_json"] = stable_json(payload.get("sequence"))


def _parse_generic_xrefs(
    biopart_id: str,
    payload: dict[str, list[dict[str, Any]]],
    reaction_compounds: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    xrefs: list[dict[str, Any]] = []
    groups = list(payload.get("cross_links", []))
    groups.extend(group for group in payload.get("sequence", []) if group.get("title_key") == "xref")
    for group in groups:
        title = group["title"] or ""
        for link in group["links"]:
            db_name, value = _classify_generic_xref(link["href"], link["text"], title)
            if not db_name or not value:
                continue
            xrefs.append(
                {
                    "entity_type": "biopart",
                    "entity_id": biopart_id,
                    "xref_db": db_name,
                    "xref_value": value,
                    "xref_url": link["href"],
                    "source_db": "RDBSB",
                    "raw_json": stable_json(link),
                }
            )

    for chebi_id in sorted(
        {
            relation.get("chebi_id_raw")
            for relation in reaction_compounds
            if relation.get("chebi_id_raw")
        }
    ):
        xrefs.append(
            {
                "entity_type": "compound",
                "entity_id": chebi_id,
                "xref_db": "chebi",
                "xref_value": chebi_id,
                "xref_url": f"https://www.ebi.ac.uk/chebi/searchId.do?chebiId={chebi_id}",
                "source_db": "RDBSB",
                "raw_json": None,
            }
        )
    return xrefs


def _build_attribute_evidences(
    biopart: dict[str, Any],
    biopart_reactions: list[dict[str, Any]],
    general_groups: list[dict[str, Any]],
    other_payload: dict[str, list[dict[str, Any]]],
    reference_lookup: dict[str, str],
) -> list[dict[str, Any]]:
    evidences: list[dict[str, Any]] = []
    relation_ids = [row["biopart_reaction_id"] for row in biopart_reactions]

    biopart_groups = list(general_groups) + list(other_payload.get("organism", [])) + list(other_payload.get("sequence", []))
    for group in biopart_groups:
        attribute_name = _attribute_name_for_group(group.get("title_key"))
        if not attribute_name:
            continue
        evidences.extend(
            _evidence_rows_for_group(
                entity_type="biopart",
                entity_id=biopart["biopart_id"],
                attribute_name=attribute_name,
                group=group,
            )
        )
        if attribute_name in {
            "pathway_name",
            "optimum_ph",
            "optimum_temperature",
            "chassis",
            "source_tissue",
            "subcellular_localization",
        }:
            for relation_id in relation_ids:
                evidences.extend(
                    _evidence_rows_for_group(
                        entity_type="biopart_reaction",
                        entity_id=relation_id,
                        attribute_name=attribute_name,
                        group=group,
                    )
                )
    return evidences


def _evidence_rows_for_group(
    entity_type: str,
    entity_id: str,
    attribute_name: str,
    group: dict[str, Any],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    items = group.get("items") or []
    if not items and group.get("text"):
        items = [
            {
                "value_text": group.get("text"),
                "display_text": group.get("text"),
                "sources": [],
                "pmids": [],
                "citations": [],
                "external_links": [],
                "raw_html": group.get("raw_html"),
            }
        ]
    for index, item in enumerate(items, start=1):
        value_text = item.get("value_text") or item.get("display_text")
        if not value_text:
            continue
        external_links = item.get("external_links") or [None]
        if external_links and external_links[0] is None:
            external_links = [None]
        for ext_index, external_link in enumerate(external_links, start=1):
            external_text = normalize_text(external_link.get("text")) if external_link else None
            external_url = normalize_text(external_link.get("href")) if external_link else None
            external_id = _infer_external_id(external_text, external_url)
            source_label = ",".join(item.get("sources") or []) or None
            evidence_id = _attribute_evidence_id(
                entity_type=entity_type,
                entity_id=entity_id,
                attribute_name=attribute_name,
                value_text=value_text,
                source_label=source_label,
                external_id=external_id,
                external_url=external_url,
                index=index,
                ext_index=ext_index,
            )
            rows.append(
                {
                    "attribute_evidence_id": evidence_id,
                    "entity_type": entity_type,
                    "entity_id": entity_id,
                    "attribute_name": attribute_name,
                    "value_text": value_text,
                    "value_numeric": _numeric_value_for_attribute(attribute_name, value_text),
                    "unit": _unit_for_attribute(attribute_name),
                    "source_label": source_label,
                    "source_db": source_label,
                    "external_id": external_id,
                    "external_url": external_url,
                    "pmids_json": stable_json(item.get("pmids") or []),
                    "citations_json": stable_json(item.get("citations") or []),
                    "raw_json": stable_json(
                        {
                            "group_title": group.get("title"),
                            "item": item,
                        }
                    ),
                }
            )
    return rows


def _extract_embedded_payloads(html: str) -> dict[str, Any]:
    payloads: dict[str, Any] = {}
    for name in ("seq", "reationsList"):
        match = re.search(rf"var\s+{name}\s*=\s*(\[.*?\]);", html, flags=re.S)
        if not match:
            payloads[name] = []
            continue
        try:
            payloads[name] = json.loads(match.group(1))
        except json.JSONDecodeError:
            payloads[name] = []
    seq_match = re.search(r'var\s+curr_protein_seq\s*=\s*\$\.trim\("([^"]*)"\);', html)
    payloads["curr_protein_seq"] = unescape(seq_match.group(1)) if seq_match else None
    return payloads


def _build_reference_lookup(soup: BeautifulSoup) -> dict[str, str]:
    lookup: dict[str, str] = {}
    for anchor in soup.find_all(id=re.compile(r"^ref\d{5,9}$")):
        pmid_match = re.search(r"ref(\d{5,9})", anchor.get("id") or "")
        if not pmid_match:
            continue
        lookup[pmid_match.group(1)] = normalize_text(anchor.get_text(" ", strip=True)) or pmid_match.group(1)
    return lookup


def _parse_references(biopart_id: str, reference_lookup: dict[str, str]) -> list[dict[str, Any]]:
    references: list[dict[str, Any]] = []
    for pmid, citation_text in reference_lookup.items():
        references.append(
            {
                "entity_type": "biopart",
                "entity_id": biopart_id,
                "pmid": pmid,
                "citation_text": citation_text,
                "reference_url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}",
                "source_db": "RDBSB",
                "raw_json": None,
            }
        )
    return references


def _parse_kinetics(
    biopart_id: str,
    card_body: Tag,
    reactions: list[dict[str, Any]],
    reaction_compounds: list[dict[str, Any]],
    compound_lookup: dict[str, str],
) -> list[dict[str, Any]]:
    kinetics: list[dict[str, Any]] = []
    reaction_membership = _reaction_compound_membership(reaction_compounds)
    reaction_text_index = _reaction_text_index(reactions)
    rows = card_body.find_all("div", class_="row", recursive=False)
    for row in rows:
        for group in row.select("div.detail-group"):
            payload = _group_payload(group)
            title_key = payload["title_key"]
            if title_key not in {"km", "kcat", "vmax", "kcat/km", "kcat km"}:
                continue
            parameter_type = (payload["title"] or "").replace("/", "_").replace(" ", "_").lower()
            items = payload["items"] or [{"value_text": payload["text"], "sources": [], "pmids": []}]
            for index, item in enumerate(items, start=1):
                text = item.get("value_text") or item.get("display_text") or item.get("text")
                if text in {None, "", "-", "?"}:
                    continue
                condition_text = _condition_text_from_item(item)
                subject_name = _subject_from_text(text)
                compound_id = _match_compound(text, compound_lookup)
                (
                    assigned_reaction_id,
                    assignment_status,
                    assignment_method,
                    assignment_details,
                ) = _resolve_kinetic_assignment(
                    text=text,
                    condition_text=condition_text,
                    reactions=reactions,
                    reaction_membership=reaction_membership,
                    reaction_text_index=reaction_text_index,
                    compound_lookup=compound_lookup,
                    fallback_compound_id=compound_id,
                )
                evidence_pmids = item.get("pmids") or _pmids_from_fragment(payload["raw_html"])
                kinetic_seed = "|".join(
                    [
                        biopart_id,
                        assigned_reaction_id or "UNRESOLVED",
                        compound_id or "NO_COMPOUND",
                        parameter_type,
                        normalize_text(text) or "",
                        normalize_text(condition_text) or "",
                        stable_json(sorted(evidence_pmids)) or "",
                        str(index),
                    ]
                )
                kinetics.append(
                    {
                        "kinetic_id": f"kin::{sha256_text(kinetic_seed)[:24]}",
                        "biopart_id": biopart_id,
                        "reaction_id": assigned_reaction_id,
                        "compound_id": compound_id,
                        "parameter_type": parameter_type,
                        "value_text": text,
                        "value_numeric": safe_float(text),
                        "unit": "uM" if text and "uM" in text else None,
                        "subject_name": subject_name,
                        "subject_compound_name": subject_name,
                        "condition_text": condition_text,
                        "source_db": ",".join(item.get("sources") or []) or "RDBSB",
                        "evidence_text": stable_json(item.get("citations")) if item.get("citations") else None,
                        "pmids_json": stable_json(evidence_pmids),
                        "reaction_assignment_status": assignment_status,
                        "reaction_assignment_method": assignment_method,
                        "assignment_details_json": stable_json(assignment_details),
                        "raw_json": stable_json({"item": item, "assignment": assignment_details}),
                    }
                )
    return kinetics


def _reaction_compound_membership(reaction_compounds: list[dict[str, Any]]) -> dict[str, set[str]]:
    membership: dict[str, set[str]] = {}
    for relation in reaction_compounds:
        reaction_id = relation.get("reaction_id")
        compound_id = relation.get("compound_id")
        if not reaction_id or not compound_id:
            continue
        membership.setdefault(reaction_id, set()).add(compound_id)
    return membership


def _reaction_text_index(reactions: list[dict[str, Any]]) -> dict[str, str]:
    index: dict[str, str] = {}
    for reaction in reactions:
        reaction_id = reaction.get("reaction_id")
        if not reaction_id:
            continue
        parts = [
            normalize_text(reaction.get("reaction_equation_raw")),
            normalize_text(reaction.get("reaction_equation_display")),
            normalize_text(reaction.get("ec_number")),
        ]
        index[reaction_id] = " ".join(part.lower() for part in parts if part)
    return index


def _ec_mentions(text: str | None) -> list[str]:
    if not text:
        return []
    return sorted(set(re.findall(r"\d+\.(?:\d+|-)\.(?:\d+|-)\.(?:\d+|-)", text)))


def _resolve_kinetic_assignment(
    text: str | None,
    condition_text: str | None,
    reactions: list[dict[str, Any]],
    reaction_membership: dict[str, set[str]],
    reaction_text_index: dict[str, str],
    compound_lookup: dict[str, str],
    fallback_compound_id: str | None,
) -> tuple[str | None, str, str | None, dict[str, Any]]:
    reaction_ids = [reaction["reaction_id"] for reaction in reactions if reaction.get("reaction_id")]
    details: dict[str, Any] = {
        "candidate_reaction_ids": reaction_ids,
        "matched_compound_id": fallback_compound_id,
        "ec_mentions": sorted(set(_ec_mentions(text) + _ec_mentions(condition_text))),
    }

    if not reaction_ids:
        return None, "unresolved_no_reaction", None, details

    if len(reaction_ids) == 1:
        details["matched_reaction_ids"] = reaction_ids
        return reaction_ids[0], "resolved_single_reaction", "single_reaction_page", details

    compound_id = fallback_compound_id or _match_compound(text, compound_lookup)
    ambiguous_compound_reactions: list[str] = []
    if compound_id:
        matched_reactions = sorted(
            reaction_id
            for reaction_id, compound_ids in reaction_membership.items()
            if compound_id in compound_ids
        )
        details["matched_reaction_ids"] = matched_reactions
        if len(matched_reactions) == 1:
            return matched_reactions[0], "resolved_by_compound", "compound_membership", details
        if len(matched_reactions) > 1:
            ambiguous_compound_reactions = matched_reactions

    search_terms = [
        normalize_text(_subject_from_text(text)),
        normalize_text(text),
        normalize_text(condition_text),
    ]
    for search_term in search_terms:
        if not search_term or len(search_term) < 4:
            continue
        lowered = search_term.lower()
        matched_reactions = sorted(
            reaction_id
            for reaction_id, payload in reaction_text_index.items()
            if lowered in payload
        )
        details["matched_reaction_ids"] = matched_reactions
        details["matched_search_term"] = search_term
        if len(matched_reactions) == 1:
            return matched_reactions[0], "resolved_by_reaction_text", "reaction_text_match", details

    if details["ec_mentions"]:
        matched_reactions = []
        for reaction in reactions:
            ec_number = normalize_text(reaction.get("ec_number")) or ""
            if any(ec in ec_number for ec in details["ec_mentions"]):
                matched_reactions.append(reaction["reaction_id"])
        details["matched_reaction_ids"] = matched_reactions
        if len(matched_reactions) == 1:
            return matched_reactions[0], "resolved_by_ec", "ec_match", details

    if ambiguous_compound_reactions:
        details["matched_reaction_ids"] = ambiguous_compound_reactions
        return None, "unresolved_ambiguous_compound", "compound_membership", details

    return None, "unresolved_multi_reaction_page", None, details


def _parse_row_groups(rows: list[Tag], reference_lookup: dict[str, str] | None = None) -> list[dict[str, Any]]:
    groups: list[dict[str, Any]] = []
    for row in rows:
        for group in row.select("div.detail-group"):
            groups.append(_group_payload(group, reference_lookup=reference_lookup))
    return groups


def _group_payload(group: Tag, reference_lookup: dict[str, str] | None = None) -> dict[str, Any]:
    title_tag = group.find(class_="detail-group-title")
    content_tag = group.find(class_="detail-group-content")
    title = normalize_text(title_tag.get_text(" ", strip=True) if title_tag else None)
    text = normalize_text(content_tag.get_text(" ", strip=True) if content_tag else None)
    links = []
    items = []
    if content_tag:
        for anchor in content_tag.find_all("a", href=True):
            links.append({"text": normalize_text(anchor.get_text(" ", strip=True)), "href": anchor["href"]})
        for li in content_tag.find_all("li"):
            items.append(_parse_group_item(li, reference_lookup or {}))
    return {
        "title": title,
        "title_key": normalize_key(title),
        "text": text,
        "links": links,
        "items": items,
        "raw_html": str(group),
    }


def _parse_group_item(li: Tag, reference_lookup: dict[str, str]) -> dict[str, Any]:
    direct_divs = [child for child in li.find_all("div", recursive=False)]
    value_text = None
    if direct_divs:
        value_text = normalize_text(direct_divs[0].get_text(" ", strip=True))
    if not value_text:
        mouse_anchor = li.select_one("a.mouse")
        if mouse_anchor:
            value_text = normalize_text(mouse_anchor.get_text(" ", strip=True))
    display_text = normalize_text(li.get_text(" ", strip=True))
    sources = [
        normalize_text(badge.get_text(" ", strip=True))
        for badge in li.select("span.badge")
        if normalize_text(badge.get_text(" ", strip=True))
    ]

    pmids: list[str] = []
    citations: list[dict[str, str]] = []
    external_links: list[dict[str, str]] = []

    for anchor in li.find_all("a", href=True):
        href = normalize_text(anchor.get("href"))
        text = normalize_text(anchor.get_text(" ", strip=True))
        if href and not href.startswith("javascript:") and not href.startswith("#ref"):
            external_links.append({"text": text, "href": href})

    for pop in li.find_all(attrs={"data-content": True}):
        parsed = _parse_popover_fragment(pop.get("data-content"), reference_lookup)
        pmids.extend(parsed["pmids"])
        citations.extend(parsed["citations"])
        external_links.extend(parsed["external_links"])

    return {
        "value_text": value_text or display_text,
        "display_text": display_text,
        "sources": sorted(set(sources)),
        "pmids": sorted(set(pmids)),
        "citations": _unique_citations(citations),
        "external_links": _unique_links(external_links),
        "raw_html": str(li),
    }


def _group_map(groups: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {group["title_key"]: group for group in groups if group.get("title_key")}


def _group_text(group_map: dict[str, dict[str, Any]], key: str) -> str | None:
    group = group_map.get(key)
    return group.get("text") if group else None


def _group_json(group_map: dict[str, dict[str, Any]], key: str) -> str | None:
    group = group_map.get(key)
    if not group:
        return None
    payload = group["items"] if group["items"] else [group["text"]] if group["text"] else None
    return stable_json(payload)


def _parse_reaction_compounds(row: Tag) -> tuple[list[dict[str, Any]], list[str]]:
    compounds: list[dict[str, Any]] = []
    connectors: list[str] = []
    inner = row.select_one(".reaction-inner")
    if inner is None:
        return compounds, connectors
    for child in inner.find_all(recursive=False):
        classes = set(child.get("class") or [])
        if "col" in classes and "flex-grow-0" not in classes:
            text = child.get_text(" ", strip=True)
            chebi_match = re.search(r"CHEBI\s*:?\s*(\d+)", text)
            formula_match = re.search(r"Formula:\s*([A-Za-z0-9+\-()]+)", text)
            name_tag = child.select_one("h5.h5-title")
            compounds.append(
                {
                    "compound_name_raw": normalize_text(name_tag.get_text(" ", strip=True) if name_tag else None),
                    "chebi_id_raw": f"CHEBI:{chebi_match.group(1)}" if chebi_match else None,
                    "formula_raw": formula_match.group(1) if formula_match else None,
                    "raw_html": str(child),
                }
            )
        elif "flex-grow-0" in classes:
            connectors.append(normalize_text(child.get_text(" ", strip=True)) or "")
    return compounds, connectors


def _assign_roles(
    compounds: list[dict[str, Any]],
    connectors: list[str],
    cofactor_names: set[str],
) -> list[dict[str, Any]]:
    arrow_index = None
    for idx, symbol in enumerate(connectors):
        if symbol in {"=", "<=>", "=>"}:
            arrow_index = idx
            break
    for index, compound in enumerate(compounds):
        side = None
        role = None
        if arrow_index is not None:
            side = "left" if index <= arrow_index else "right"
            role = "substrate" if side == "left" else "product"
        if compound.get("compound_name_raw") in cofactor_names:
            role = "cofactor"
        compound["side"] = side
        compound["role"] = role
        compound["position_index"] = index
        compound["connector_before"] = connectors[index - 1] if 0 < index <= len(connectors) else None
    return compounds


def _infer_direction(equation: str | None) -> str | None:
    if equation is None:
        return None
    if "<=>" in equation:
        return "<=>"
    if "=>" in equation:
        return "=>"
    if "=" in equation:
        return "="
    return None


def _classify_reaction_xref(href: str | None, text: str | None) -> tuple[str | None, str | None]:
    href = href or ""
    text = normalize_text(text)
    if "rhea-db.org/reaction" in href:
        return "rhea", text
    if "kegg.jp/dbget-bin/www_bget?R" in href:
        return "kegg_reaction", text
    if "metacyc.org" in href and "REACTION" in href:
        return "metacyc_reaction", text
    if "brenda-enzymes.org/enzyme.php" in href:
        return "brenda_ec", text
    return None, None


def _classify_generic_xref(href: str | None, text: str | None, title: str | None) -> tuple[str | None, str | None]:
    href = href or ""
    text = normalize_text(text)
    title_key = normalize_key(title)
    if title_key == "uniprot" or "uniprot.org/uniprot/" in href:
        return "uniprot", text
    if title_key == "kegg" or "kegg.jp/dbget-bin/www_bget?ag:" in href:
        return "kegg_gene", text
    if title_key == "rhea" or "rhea-db.org/reaction" in href:
        return "rhea", text
    if title_key == "metacyc" or "metacyc.org/gene" in href:
        return "metacyc_gene", text
    if title_key == "brenda" or "brenda-enzymes.org/enzyme.php" in href:
        return "brenda_ec", text
    if title_key == "enzyme" or "enzyme-database.org" in href:
        return "enzyme_db_ec", text
    return None, None


def _extract_sequence(text: str | None) -> str | None:
    if not text:
        return None
    match = re.search(r"([A-Z]{20,})", text)
    return match.group(1) if match else None


def _subject_from_text(text: str | None) -> str | None:
    if not text:
        return None
    match = re.search(r"for (.+)$", text, flags=re.I)
    return normalize_text(match.group(1)) if match else None


def _pmids_from_fragment(html_fragment: str | None) -> list[str]:
    if not html_fragment:
        return []
    return sorted(set(re.findall(r"ref(\d{5,9})", html_fragment)))


def _match_compound(text: str | None, compound_lookup: dict[str, str]) -> str | None:
    if not text:
        return None
    lowered = text.lower()
    for name, compound_id in compound_lookup.items():
        if name and name.lower() in lowered:
            return compound_id
    return None


def _first_value(items: list[dict[str, Any]] | None, key: str) -> str | None:
    if not items:
        return None
    for item in items:
        value = normalize_text(item.get(key))
        if value:
            return value
    return None


def _extract_external_link_value(items: list[dict[str, Any]] | None, pattern: str) -> str | None:
    if not items:
        return None
    for item in items:
        value = normalize_text(item.get("value"))
        if value and re.fullmatch(pattern, value):
            return value
    return None


def _embedded_reaction_xrefs(item: dict[str, Any]) -> list[tuple[str, str, str | None]]:
    results: list[tuple[str, str, str | None]] = []
    reaction_info = item.get("reactions") or {}
    rhea_id = reaction_info.get("rhea_id")
    if rhea_id is not None:
        results.append(("rhea", str(rhea_id), f"https://www.rhea-db.org/reaction?id={rhea_id}"))
    for link in item.get("external_links") or []:
        value = normalize_text(link.get("value"))
        if not value:
            continue
        if re.fullmatch(r"R\d+", value):
            results.append(("kegg_reaction", value, f"https://www.kegg.jp/dbget-bin/www_bget?rn:{value}"))
        elif re.fullmatch(r"RXN-[A-Z0-9-]+", value):
            results.append(("metacyc_reaction", value, None))
        elif re.fullmatch(r"\d+", value) and str(rhea_id or "") != value:
            results.append(("reaction_numeric_ref", value, None))
    return results


def _first_accession(compound: dict[str, Any]) -> str | None:
    accessions = compound.get("accession") or []
    if not accessions:
        return None
    value = normalize_text(accessions[0])
    return value or None


def _parse_popover_fragment(fragment: str | None, reference_lookup: dict[str, str]) -> dict[str, Any]:
    if not fragment:
        return {"pmids": [], "citations": [], "external_links": []}
    soup = BeautifulSoup(unescape(fragment), "html.parser")
    pmids: list[str] = []
    citations: list[dict[str, str]] = []
    external_links: list[dict[str, str]] = []
    for anchor in soup.find_all("a", href=True):
        href = normalize_text(anchor.get("href"))
        text = normalize_text(anchor.get_text(" ", strip=True))
        if not href:
            continue
        ref_match = re.search(r"#ref(\d{5,9})", href)
        if ref_match:
            pmid = ref_match.group(1)
            pmids.append(pmid)
            citations.append(
                {
                    "pmid": pmid,
                    "citation_text": reference_lookup.get(pmid) or pmid,
                }
            )
        elif not href.startswith("javascript:"):
            external_links.append({"text": text, "href": href})
    return {
        "pmids": sorted(set(pmids)),
        "citations": _unique_citations(citations),
        "external_links": _unique_links(external_links),
    }


def _unique_citations(items: list[dict[str, str]]) -> list[dict[str, str]]:
    seen: set[tuple[str | None, str | None]] = set()
    output: list[dict[str, str]] = []
    for item in items:
        key = (item.get("pmid"), item.get("citation_text"))
        if key in seen:
            continue
        seen.add(key)
        output.append(item)
    return output


def _unique_links(items: list[dict[str, str]]) -> list[dict[str, str]]:
    seen: set[tuple[str | None, str | None]] = set()
    output: list[dict[str, str]] = []
    for item in items:
        key = (item.get("href"), item.get("text"))
        if key in seen:
            continue
        seen.add(key)
        output.append(item)
    return output


def _attribute_name_for_group(title_key: str | None) -> str | None:
    if not title_key:
        return None
    if title_key.startswith("optimum temperature"):
        return "optimum_temperature"
    mapping = {
        "pathways": "pathway_name",
        "optimum ph": "optimum_ph",
        "chassis": "chassis",
        "source tissue": "source_tissue",
        "subcellular localization": "subcellular_localization",
        "synonym": "synonym",
        "organism": "organism",
        "taxonomy": "taxonomy",
        "taxonomy id": "taxonomy_id",
        "lineage": "lineage",
        "molecular weight": "molecular_weight",
        "gene name": "gene_name",
        "nt seq id": "nt_seq_id",
        "protein family": "protein_family",
        "pfam entry": "pfam_entry",
        "subunit structure": "subunit_structure",
        "protein id": "protein_id",
    }
    return mapping.get(title_key)


def _unit_for_attribute(attribute_name: str) -> str | None:
    if attribute_name == "optimum_temperature":
        return "°C"
    return None


def _preferred_gene_name(gene_names: list[str]) -> str | None:
    if not gene_names:
        return None
    for gene_name in gene_names:
        if gene_name and not gene_name.startswith("("):
            return gene_name
    return gene_names[0]


def _extract_taxonomy_id(text: str | None) -> str | None:
    if not text:
        return None
    match = re.search(r"\d{3,}", text)
    return match.group(0) if match else None


def _find_group_text_from_json(raw_json: str | None, title_key: str) -> str | None:
    if not raw_json:
        return None
    try:
        payload = json.loads(raw_json)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, list):
        return None
    for item in payload:
        if isinstance(item, dict) and item.get("title_key") == title_key:
            return normalize_text(item.get("text"))
    return None


def _condition_text_from_item(item: dict[str, Any]) -> str | None:
    raw_html = item.get("raw_html")
    if not raw_html:
        return None
    fragments = re.findall(r"<p class='text-primary my-0'>(.*?)</p>", raw_html)
    cleaned = [
        normalize_text(BeautifulSoup(unescape(fragment), "html.parser").get_text(" ", strip=True))
        for fragment in fragments
    ]
    cleaned = [value for value in cleaned if value]
    return " | ".join(cleaned) if cleaned else None


def _numeric_value_for_attribute(attribute_name: str, value_text: str | None) -> float | None:
    if attribute_name in {"optimum_ph", "optimum_temperature", "molecular_weight"}:
        return safe_float(value_text)
    return None


def _infer_external_id(text: str | None, url: str | None) -> str | None:
    candidates = [text or "", url or ""]
    patterns = [
        r"map\d{5}",
        r"R\d+",
        r"CHEBI:\d+",
        r"RXN-[A-Z0-9-]+",
        r"\d+\.\d+\.\d+\.\d+",
    ]
    for candidate in candidates:
        for pattern in patterns:
            match = re.search(pattern, candidate)
            if match:
                return match.group(0)
    if text and text != url:
        return text
    return None


def _attribute_evidence_id(
    entity_type: str,
    entity_id: str,
    attribute_name: str,
    value_text: str | None,
    source_label: str | None,
    external_id: str | None,
    external_url: str | None,
    index: int,
    ext_index: int,
) -> str:
    seed = "|".join(
        [
            entity_type,
            entity_id,
            attribute_name,
            value_text or "",
            source_label or "",
            external_id or "",
            external_url or "",
            str(index),
            str(ext_index),
        ]
    )
    return f"ae::{sha256_text(seed)[:24]}"
