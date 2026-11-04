from __future__ import annotations

import argparse
import gzip
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
CORE_DB = ROOT / "web_release" / "reactenzdb_web.db"
RAW_DIR = WORK_DIR / "raw" / "sabio"
UNIPROT_RE = re.compile(r"\b(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})\b")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def text(value: Any) -> str | None:
    if value is None:
        return None
    result = str(value).strip()
    return result or None


def split_values(value: str | None) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in re.split(r"[;,|]", value) if part.strip()]


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS assertion_enzyme_links (
          assertion_id TEXT NOT NULL,
          biopart_id TEXT NOT NULL,
          link_method TEXT NOT NULL,
          source_accession TEXT,
          is_primary INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY(assertion_id, biopart_id, link_method),
          FOREIGN KEY(assertion_id) REFERENCES experimental_assertions(assertion_id),
          FOREIGN KEY(biopart_id) REFERENCES enzymes(biopart_id)
        );
        CREATE INDEX IF NOT EXISTS idx_assertion_enzyme_links_enzyme
          ON assertion_enzyme_links(biopart_id, assertion_id);
        CREATE TABLE IF NOT EXISTS source_ingestion_status (
          source TEXT NOT NULL,
          source_file TEXT NOT NULL,
          status TEXT NOT NULL,
          records_seen INTEGER NOT NULL DEFAULT 0,
          assertions_inserted INTEGER NOT NULL DEFAULT 0,
          exact_assertions INTEGER NOT NULL DEFAULT 0,
          error_text TEXT,
          completed_at TEXT,
          PRIMARY KEY(source, source_file)
        );
        """
    )
    conn.execute(
        "INSERT OR IGNORE INTO outcome_definitions VALUES (?,?)",
        ("quantitative_non_catalytic", "A binding, inhibition, equilibrium, or concentration measurement was reported without a catalytic parameter."),
    )


def has_catalytic_parameter(parameters: list[dict[str, Any]]) -> bool:
    accepted = {"kcat", "km", "vmax", "specific activity", "specific_activity", "turnover number", "kcat/km", "vmax/km"}
    for parameter in parameters:
        name = (parameter.get("parameter_type") or {}).get("name") or parameter.get("name") or ""
        if str(name).strip().lower() in accepted:
            return True
    return False


def reaction_xrefs(conn: sqlite3.Connection) -> dict[tuple[str, str], set[str]]:
    mapping: dict[tuple[str, str], set[str]] = defaultdict(set)
    db_alias = {
        "RheaReactionID": "rhea",
        "KeggReactionID": "kegg_reaction",
        "MetaCycReactionID": "metacyc_reaction",
        "MetaNetXReactionID": "mnx_reaction",
    }
    for reaction_id, db, value in conn.execute(
        "SELECT entity_id,xref_db,xref_value FROM core.web_xrefs WHERE entity_type='reaction'"
    ):
        for item in split_values(value):
            mapping[(db, item)].add(reaction_id)
    # Direct columns protect mappings that were not duplicated into web_xrefs.
    for row in conn.execute("SELECT reaction_id,rhea_id,kegg_reaction_id,metacyc_reaction_id FROM reactions"):
        for db, value in zip(("rhea", "kegg_reaction", "metacyc_reaction"), row[1:]):
            for item in split_values(value):
                mapping[(db, item)].add(row[0])
    mapping[("__aliases__", "__aliases__")] = set(db_alias)  # marker for audit/debugging
    return mapping


def compound_lookups(conn: sqlite3.Connection) -> dict[str, dict[str, set[str]]]:
    result: dict[str, dict[str, set[str]]] = {
        "chebi": defaultdict(set), "pubchem": defaultdict(set), "smiles": defaultdict(set), "inchi": defaultdict(set)
    }
    for compound_id, chebi, pubchem, smiles, inchi in conn.execute(
        "SELECT DISTINCT compound_id,chebi_id,pubchem_id,smiles,inchi FROM reaction_compounds"
    ):
        if chebi:
            result["chebi"][str(chebi).replace("CHEBI:", "")].add(compound_id)
        if pubchem:
            result["pubchem"][str(pubchem)].add(compound_id)
        if smiles:
            result["smiles"][str(smiles)].add(compound_id)
        if inchi:
            result["inchi"][str(inchi)].add(compound_id)
    return result


def map_reaction(entry: dict[str, Any], xrefs: dict[tuple[str, str], set[str]]) -> tuple[str | None, str, dict[str, Any]]:
    alias = {
        "RheaReactionID": "rhea",
        "KeggReactionID": "kegg_reaction",
        "MetaCycReactionID": "metacyc_reaction",
        "MetaNetXReactionID": "mnx_reaction",
    }
    mapped_sets: list[set[str]] = []
    used: list[dict[str, Any]] = []
    for item in (entry.get("external_links") or {}).get("reaction") or []:
        db = alias.get(str(item.get("key")))
        value = text(item.get("value"))
        if not db or not value:
            continue
        candidates = xrefs.get((db, value), set())
        used.append({"db": db, "value": value, "candidate_count": len(candidates)})
        if candidates:
            mapped_sets.append(set(candidates))
    if not mapped_sets:
        return None, "no_exact_reaction_identifier", {"xrefs": used}
    intersection = set.intersection(*mapped_sets)
    if len(intersection) == 1:
        return next(iter(intersection)), "exact_external_reaction_identifier", {"xrefs": used, "intersection": list(intersection)}
    counts: Counter[str] = Counter(candidate for group in mapped_sets for candidate in group)
    if counts:
        best, support = counts.most_common(1)[0]
        tied = [candidate for candidate, count in counts.items() if count == support]
        if len(tied) == 1 and support >= 2:
            return best, "concordant_multiple_external_identifiers", {"xrefs": used, "support": support}
    return None, "ambiguous_external_reaction_identifier", {"xrefs": used, "candidate_union": sorted(counts)}


def sabio_compound_links(entry: dict[str, Any]) -> dict[int, dict[str, list[str]]]:
    links: dict[int, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    for item in (entry.get("external_links") or {}).get("compound") or []:
        try:
            identifier = int(item.get("id"))
        except (TypeError, ValueError):
            continue
        key = str(item.get("key") or "")
        value = text(item.get("value"))
        if value:
            links[identifier][key].append(value)
    return links


def map_compound(
    compound: dict[str, Any],
    external: dict[str, list[str]],
    lookup: dict[str, dict[str, set[str]]],
    reaction_members: set[str],
) -> tuple[str | None, str, str | None, str | None]:
    routes = [
        ("InChI", "inchi", "exact_inchi"),
        ("SMILES", "smiles", "exact_smiles"),
        ("ChebiID", "chebi", "exact_chebi"),
        ("PubChemCID", "pubchem", "exact_pubchem"),
    ]
    for source_key, index_key, method in routes:
        candidates: set[str] = set()
        for value in external.get(source_key, []):
            normalized = value.replace("CHEBI:", "") if index_key == "chebi" else value
            candidates.update(lookup[index_key].get(normalized, set()))
        if reaction_members:
            candidates &= reaction_members
        if len(candidates) == 1:
            smiles = (external.get("SMILES") or [None])[0]
            inchi = (external.get("InChI") or [None])[0]
            return next(iter(candidates)), method, smiles, inchi
    return None, "unmapped_or_ambiguous", (external.get("SMILES") or [None])[0], (external.get("InChI") or [None])[0]


def uniprot_accessions(entry: dict[str, Any]) -> list[str]:
    values: set[str] = set()
    enzyme = entry.get("enzyme_description") or {}
    for protein in enzyme.get("proteins") or []:
        values.update(UNIPROT_RE.findall(str(protein.get("uniprot_id") or "").upper()))
    for section in ("kinlaw_entry", "uniprot"):
        for item in (entry.get("external_links") or {}).get(section) or []:
            if str(item.get("key")) in {"UniProtKB_AC", "UniProtKB_ACs"}:
                values.update(UNIPROT_RE.findall(str(item.get("value") or "").upper()))
    return sorted(values)


def map_enzymes(conn: sqlite3.Connection, accessions: list[str]) -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    for accession in accessions:
        rows.extend((item[0], accession) for item in conn.execute("SELECT biopart_id FROM enzymes WHERE uniprot_accession=?", (accession,)))
    return sorted(set(rows))


def evidence_class(
    reaction_status: str,
    enzyme_links: list[tuple[str, str]],
    substrate_exact: bool,
    product_exact: bool,
    pmid: str | None,
    catalytic_parameter: bool,
) -> tuple[str, str, float, str]:
    if reaction_status in {"exact_external_reaction_identifier", "concordant_multiple_external_identifiers"} and enzyme_links and substrate_exact and product_exact and pmid and catalytic_parameter:
        return "exact_substrate_product_experimental_evidence", "Exact substrate/product experimental evidence", 100.0, "automatic_strict_exact"
    if reaction_status in {"exact_external_reaction_identifier", "concordant_multiple_external_identifiers"} and enzyme_links:
        return "same_reaction_identifier_evidence", "Same reaction identifier evidence", 80.0, "needs_literature_review"
    return "same_ec_different_substrate", "Same EC but different or unresolved substrate", 35.0, "needs_literature_review"


def ingest_file(conn: sqlite3.Connection, path: Path, xrefs: dict, lookup: dict) -> tuple[int, int, int]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        payload = json.load(handle)
    seen = inserted = exact = 0
    for entry in payload.get("entries") or []:
        seen += 1
        entry_id = str(entry.get("id"))
        assertion_id = f"sabio:{entry_id}"
        if conn.execute("SELECT 1 FROM experimental_assertions WHERE assertion_id=?", (assertion_id,)).fetchone():
            continue
        enzyme = entry.get("enzyme_description") or {}
        general = entry.get("general") or {}
        publication = entry.get("publication") or {}
        conditions = entry.get("experimental_conditions") or {}
        reaction_id, reaction_status, reaction_detail = map_reaction(entry, xrefs)
        reaction_members = set()
        reaction_by_side: dict[str, set[str]] = defaultdict(set)
        if reaction_id:
            for compound_id, side in conn.execute("SELECT compound_id,side FROM reaction_compounds WHERE reaction_id=?", (reaction_id,)):
                reaction_members.add(compound_id)
                reaction_by_side[str(side or "")].add(compound_id)
        ext_compounds = sabio_compound_links(entry)
        assertion_compounds = []
        mapped_roles: dict[str, set[str]] = defaultdict(set)
        expected_roles: Counter[str] = Counter()
        for species in (entry.get("reaction") or {}).get("species") or []:
            role = str(species.get("role") or "unknown").lower()
            if role == "catalyst":
                continue
            compound = species.get("compound") or {}
            try:
                sid = int(compound.get("id"))
            except (TypeError, ValueError):
                sid = -1
            compound_id, method, smiles, inchi = map_compound(compound, ext_compounds.get(sid, {}), lookup, reaction_members)
            expected_roles[role] += 1
            if compound_id:
                mapped_roles[role].add(compound_id)
            assertion_compounds.append((
                assertion_id, role, text(compound.get("name")), compound_id, smiles,
                None, method, None, int(method.startswith("exact_")),
            ))
        substrate_exact = bool(expected_roles["substrate"]) and len(mapped_roles["substrate"]) == expected_roles["substrate"]
        product_exact = bool(expected_roles["product"]) and len(mapped_roles["product"]) == expected_roles["product"]
        # Require equality with the curated reaction sides for the strict tier.
        if reaction_id:
            substrate_exact = substrate_exact and mapped_roles["substrate"] == reaction_by_side.get("left", set())
            product_exact = product_exact and mapped_roles["product"] == reaction_by_side.get("right", set())
        accessions = uniprot_accessions(entry)
        enzyme_links = map_enzymes(conn, accessions)
        pmid = text(publication.get("pubmed_id"))
        parameters = (entry.get("kineticlaw") or {}).get("parameter") or []
        catalytic = has_catalytic_parameter(parameters)
        ev_class, label, score, curation = evidence_class(reaction_status, enzyme_links, substrate_exact, product_exact, pmid, catalytic)
        if ev_class == "exact_substrate_product_experimental_evidence":
            exact += 1
        mutation = text(enzyme.get("mutant_spec"))
        wild = text(enzyme.get("wildtype")) or "not_reported"
        form_id = f"sabio:{entry_id}:form"
        primary_biopart = enzyme_links[0][0] if enzyme_links else None
        primary_accession = accessions[0] if accessions else None
        conn.execute(
            "INSERT OR IGNORE INTO enzyme_forms VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (form_id, primary_biopart, "SABIO-RK", entry_id, text((general.get("organism") or {}).get("name")), wild, mutation, json.dumps([], ensure_ascii=False), primary_accession, None, "exact_uniprot_accession" if accessions else "protein_identity_not_reported"),
        )
        has_conditions = int(any([
            conditions.get("buffer"), conditions.get("comment"),
            (conditions.get("envvar_ph") or {}).get("start_value"),
            (conditions.get("envvar_temperature") or {}).get("start_value"),
            conditions.get("envvars_other"),
        ]))
        detail = {
            "rule_id": "SABIO_FULL_ENTRY_STRICT_V1",
            "reaction_mapping": reaction_detail,
            "source_reaction_equation": (entry.get("reaction") or {}).get("equation"),
            "source_uniprot_accessions": accessions,
            "substrate_set_exact": substrate_exact,
            "product_set_exact": product_exact,
            "has_catalytic_parameter": catalytic,
            "automatic_exact_requires_literature_confirmation": True,
        }
        conn.execute(
            "INSERT INTO experimental_assertions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                assertion_id, "SABIO-RK", entry_id, text(enzyme.get("ec_number")), reaction_id,
                primary_biopart, form_id, ev_class, label, "quantitative_activity" if catalytic else "quantitative_non_catalytic" if parameters else "qualitative_active",
                1, "exact_uniprot_accession" if accessions else "protein_identity_not_reported",
                reaction_status, "exact_structure_set" if substrate_exact else "partial_or_unmapped",
                "exact_structure_set" if product_exact else "partial_or_unmapped", score, curation,
                int(bool(pmid)), int(bool(parameters)), has_conditions,
                f"https://sabiork.h-its.org/ui/kinlaw-entry/{entry_id}", path.relative_to(WORK_DIR).as_posix(),
                json.dumps(detail, ensure_ascii=False), utc_now(),
            ),
        )
        conn.executemany("INSERT OR IGNORE INTO assertion_compounds VALUES (?,?,?,?,?,?,?,?,?)", assertion_compounds)
        for index, parameter in enumerate(parameters):
            ptype = (parameter.get("parameter_type") or {}).get("name") or parameter.get("name") or "not_reported"
            unit = parameter.get("unit") or {}
            species = parameter.get("species") or {}
            conn.execute(
                "INSERT INTO measurements VALUES (?,?,?,?,?,?,?,?,?,?)",
                (
                    f"sabio:{entry_id}:measurement:{index}", assertion_id, str(ptype).lower(),
                    text(parameter.get("start_value")), parameter.get("start_value"), text(unit.get("name")),
                    parameter.get("n_start_value"), text(unit.get("n_name")),
                    "source_normalized" if parameter.get("n_start_value") is not None else "not_normalized",
                    text(species.get("species_key")),
                ),
            )
        ph = (conditions.get("envvar_ph") or {}).get("start_value")
        temperature = (conditions.get("envvar_temperature") or {}).get("start_value")
        conn.execute(
            "INSERT INTO assay_conditions VALUES (?,?,?,?,?,?,?,?)",
            (
                f"sabio:{entry_id}:condition", assertion_id, ph, temperature,
                text(conditions.get("buffer")), None,
                json.dumps({"comment": conditions.get("comment"), "other": conditions.get("envvars_other")}, ensure_ascii=False),
                "SABIO_full_entry",
            ),
        )
        if pmid:
            conn.execute(
                "INSERT OR IGNORE INTO citations VALUES (?,?,?,?,?,?,?,?,?)",
                (
                    assertion_id, pmid, None, text(publication.get("title")), text(publication.get("journal")),
                    publication.get("year"), f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/", "not_checked", "not_checked",
                ),
            )
        for index, (biopart_id, accession) in enumerate(enzyme_links):
            conn.execute(
                "INSERT OR IGNORE INTO assertion_enzyme_links VALUES (?,?,?,?,?)",
                (assertion_id, biopart_id, "exact_uniprot_accession", accession, int(index == 0)),
            )
        inserted += 1
    return seen, inserted, exact


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest complete cached SABIO-RK entries into the conservative evidence work layer.")
    parser.add_argument("--limit-files", type=int)
    parser.add_argument("--refresh-file-status", action="store_true")
    args = parser.parse_args()
    if not EVIDENCE_DB.exists():
        raise FileNotFoundError(f"Build the core evidence DB first: {EVIDENCE_DB}")
    conn = sqlite3.connect(EVIDENCE_DB)
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("ATTACH DATABASE ? AS core", (str(CORE_DB),))
    ensure_schema(conn)
    xrefs = reaction_xrefs(conn)
    lookup = compound_lookups(conn)
    paths = sorted(RAW_DIR.glob("EC_*.complete.json.gz"))
    if args.limit_files:
        paths = paths[: max(0, args.limit_files)]
    totals = Counter()
    for index, path in enumerate(paths, start=1):
        relative = path.relative_to(WORK_DIR).as_posix()
        done = conn.execute(
            "SELECT status FROM source_ingestion_status WHERE source='SABIO-RK' AND source_file=?",
            (relative,),
        ).fetchone()
        if done and done[0] == "done" and not args.refresh_file_status:
            continue
        try:
            seen, inserted, exact = ingest_file(conn, path, xrefs, lookup)
            conn.execute(
                "INSERT OR REPLACE INTO source_ingestion_status VALUES ('SABIO-RK',?,'done',?,?,?,NULL,?)",
                (relative, seen, inserted, exact, utc_now()),
            )
            conn.commit()
            totals.update(seen=seen, inserted=inserted, exact=exact, files=1)
        except Exception as exc:
            conn.rollback()
            conn.execute(
                "INSERT OR REPLACE INTO source_ingestion_status VALUES ('SABIO-RK',?,'error',0,0,0,?,?)",
                (relative, str(exc)[:1000], utc_now()),
            )
            conn.commit()
            print(f"[sabio-ingest] ERROR {relative}: {exc}", flush=True)
        if index == 1 or index % 25 == 0:
            print(f"[sabio-ingest] {index}/{len(paths)} files; inserted={totals['inserted']:,} exact={totals['exact']:,}", flush=True)
    print(json.dumps(dict(totals), indent=2), flush=True)
    conn.close()


if __name__ == "__main__":
    main()
