from __future__ import annotations

import csv
import gzip
import hashlib
import json
import sqlite3
import sys
import tarfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from rdkit import Chem, RDLogger


RDLogger.DisableLog("rdApp.*")
csv.field_size_limit(min(sys.maxsize, 2_147_483_647))
ROOT = Path(__file__).resolve().parents[1]
WORK_DB = ROOT / "reaction_standardization_work" / "reaction_standardization.sqlite"
SRC = ROOT / "external" / "reaction_standardization"
WEB_DB = ROOT / "web_release" / "reactenzdb_web.db"
RULE_VERSION = "REACTENZ_CROSS_DATABASE_MAPPING_V1"


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def coeff_text(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else f"{value:.8g}"


def canonical_fragment(smiles: str, isomeric: bool) -> str | None:
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    for atom in mol.GetAtoms():
        atom.SetAtomMapNum(0)
    return Chem.MolToSmiles(mol, canonical=True, isomericSmiles=isomeric)


def reaction_identity(reaction_smiles: str | None) -> dict[str, Any] | None:
    if not reaction_smiles or ">>" not in reaction_smiles:
        return None
    raw_left, raw_right = reaction_smiles.split(">>", 1)

    def side(raw: str, isomeric: bool) -> list[tuple[str, str]] | None:
        counts: Counter[str] = Counter()
        for fragment in filter(None, raw.split(".")):
            canonical = canonical_fragment(fragment, isomeric)
            if canonical is None:
                return None
            counts[canonical] += 1
        if not counts:
            return None
        return sorted((smiles, coeff_text(float(count))) for smiles, count in counts.items())

    left = side(raw_left, True)
    right = side(raw_right, True)
    left_ns = side(raw_left, False)
    right_ns = side(raw_right, False)
    if not left or not right or not left_ns or not right_ns:
        return None

    def keys(a: list[tuple[str, str]], b: list[tuple[str, str]]) -> tuple[str, str]:
        forward = json.dumps({"left": a, "right": b}, separators=(",", ":"), ensure_ascii=False)
        reverse = json.dumps({"left": b, "right": a}, separators=(",", ":"), ensure_ascii=False)
        return (
            hashlib.sha256(forward.encode()).hexdigest(),
            hashlib.sha256(min(forward, reverse).encode()).hexdigest(),
        )

    directional, directionless = keys(left, right)
    directional_ns, directionless_ns = keys(left_ns, right_ns)
    return {
        "directional": directional,
        "directionless": directionless,
        "directional_no_stereo": directional_ns,
        "directionless_no_stereo": directionless_ns,
        "left": left,
        "right": right,
    }


def cheap_reaction_signature(reaction_smiles: str | None, relax_stereo: bool = False) -> str | None:
    """Low-cost prefilter for already-canonical, unmapped reaction SMILES.

    This is only a candidate filter. Every hit is still verified with RDKit and
    the SHA identities above, so it cannot promote a false positive.
    """
    if not reaction_smiles or ">>" not in reaction_smiles:
        return None
    left, right = reaction_smiles.split(">>", 1)
    if relax_stereo:
        for token in ("@", "/", "\\"):
            left = left.replace(token, "")
            right = right.replace(token, "")
    left = ".".join(sorted(filter(None, left.split("."))))
    right = ".".join(sorted(filter(None, right.split("."))))
    if not left or not right:
        return None
    return min(f"{left}>>{right}", f"{right}>>{left}")


def source_file_ids(db: sqlite3.Connection) -> dict[str, str]:
    return {row[0].replace("\\", "/"): row[1] for row in db.execute("SELECT relative_path,source_file_id FROM source_files")}


def file_id(files: dict[str, str], suffix: str) -> str:
    suffix = suffix.replace("\\", "/")
    matches = [value for path, value in files.items() if path.endswith(suffix)]
    if len(matches) != 1:
        raise RuntimeError(f"Expected one registered source ending {suffix!r}, found {len(matches)}")
    return matches[0]


def open_csv(path: Path):
    return gzip.open(path, "rt", encoding="utf-8", errors="replace", newline="") if path.suffix == ".gz" else open(path, "r", encoding="utf-8", errors="replace", newline="")


def normalized_id(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def external_insert(
    db: sqlite3.Connection,
    key: str,
    source_db: str,
    source_id: str,
    source_file_id: str,
    *,
    direction: str | None = None,
    equation: str | None = None,
    smiles: str | None = None,
    mapped: str | None = None,
    rule: str | None = None,
    quality: float | None = None,
    version: str | None = None,
    locator: str | None = None,
    publication_scope: str = "derived_results_with_attribution",
) -> None:
    db.execute(
        """
        INSERT OR REPLACE INTO external_reactions(
          external_reaction_key,source_db,source_reaction_id,source_direction,source_equation,
          source_reaction_smiles,source_atom_mapped_smiles,source_rule_smarts,source_quality,
          source_version,source_file_id,source_row_locator,publication_scope
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (key, source_db, source_id, direction, equation, smiles, mapped, rule, quality, version,
         source_file_id, locator, publication_scope),
    )


def relation(reactenz: sqlite3.Row, ext: dict[str, Any] | None) -> dict[str, str]:
    if ext is None:
        return {
            "direction": "not_computable", "participant": "not_computable",
            "stoichiometry": "not_computable", "stereo": "not_computable",
            "chemistry": "identifier_only",
        }
    if ext["directionless"] == reactenz["directionless_reaction_key"]:
        direction = "same" if ext["directional"] == reactenz["directional_reaction_key"] else "reversed"
        return {"direction": direction, "participant": "exact_structure_multiset", "stoichiometry": "exact",
                "stereo": "exact", "chemistry": "exact_normalized_identity"}
    if ext["directionless_no_stereo"] == reactenz["directionless_reaction_key_no_stereo"]:
        direction = "same_or_reversed_after_stereo_removal"
        return {"direction": direction, "participant": "same_connectivity", "stoichiometry": "exact",
                "stereo": "different_or_incomplete", "chemistry": "connectivity_equivalent_stereo_conflict"}
    return {"direction": "different_or_unknown", "participant": "different", "stoichiometry": "different_or_unknown",
            "stereo": "different_or_unknown", "chemistry": "identifier_identity_conflict"}


def add_mapping(
    db: sqlite3.Connection,
    reaction: sqlite3.Row,
    target_db: str,
    target_id: str,
    basis: str,
    ext: dict[str, Any] | None,
    evidence: dict[str, Any],
) -> str:
    rel = relation(reaction, ext)
    direct = basis.startswith("direct")
    if rel["chemistry"] == "exact_normalized_identity":
        confidence = 0.99 if direct else 0.96
        tier = "A"
        review = "accepted_automatic"
        explanation = None
    elif rel["chemistry"] == "connectivity_equivalent_stereo_conflict":
        confidence = 0.90 if direct else 0.84
        tier = "B"
        review = "automatic_with_stereo_warning"
        explanation = "Connectivity and stoichiometry agree after removing stereochemistry, but stereo representations differ or are incomplete."
    elif rel["chemistry"] == "identifier_only":
        confidence = 0.86 if direct else 0.70
        tier = "B" if direct else "C"
        review = "accepted_identifier_only"
        explanation = "The source identifier is available but this external record has no comparable structure identity."
    else:
        confidence = 0.58 if direct else 0.35
        tier = "D"
        review = "manual_review_required"
        explanation = "The asserted identifier does not reproduce the ReactEnzDB normalized reaction identity."
    mapping_id = "map:" + hashlib.sha256(f"{reaction['reaction_id']}|{target_db}|{target_id}|{basis}".encode()).hexdigest()[:24]
    db.execute(
        """
        INSERT OR REPLACE INTO cross_database_mappings VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (mapping_id, reaction["reaction_id"], target_db, target_id, basis,
         "direct_source_assertion" if direct else "inferred_structure_match", rel["direction"], rel["participant"],
         rel["stoichiometry"], "not_compared_external_charge_unavailable", rel["stereo"], rel["chemistry"],
         confidence, tier, json.dumps(evidence, ensure_ascii=False, sort_keys=True), explanation, review, now()),
    )
    if rel["chemistry"] in {"identifier_identity_conflict", "connectivity_equivalent_stereo_conflict"}:
        conflict_type = "stereochemistry_representation_conflict" if rel["chemistry"].startswith("connectivity") else "identifier_reaction_identity_conflict"
        severity = "warning" if conflict_type.startswith("stereo") else "error"
        conflict_id = "conflict:" + hashlib.sha256(f"{mapping_id}|{conflict_type}".encode()).hexdigest()[:24]
        db.execute(
            "INSERT OR REPLACE INTO mapping_conflicts VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (conflict_id, reaction["reaction_id"], mapping_id, conflict_type, severity,
             reaction["canonical_reaction_smiles"], evidence.get("external_reaction_smiles"), explanation,
             "open", RULE_VERSION, 1, now()),
        )
    return mapping_id


def mapped_validation(mapped: str) -> dict[str, Any]:
    if ">>" not in mapped:
        return {"status": "invalid_missing_separator", "flags": ["missing_separator"]}
    left_raw, right_raw = mapped.split(">>", 1)

    def parse_side(raw: str):
        atoms: dict[int, tuple[int, int]] = {}
        bonds: dict[tuple[int, int], str] = {}
        duplicate: set[int] = set()
        unnumbered = 0
        for frag in filter(None, raw.split(".")):
            mol = Chem.MolFromSmiles(frag)
            if mol is None:
                return None, None, None, None
            for atom in mol.GetAtoms():
                amap = atom.GetAtomMapNum()
                if not amap:
                    unnumbered += 1
                elif amap in atoms:
                    duplicate.add(amap)
                else:
                    atoms[amap] = (atom.GetAtomicNum(), atom.GetFormalCharge())
            for bond in mol.GetBonds():
                a = bond.GetBeginAtom().GetAtomMapNum(); b = bond.GetEndAtom().GetAtomMapNum()
                if a and b:
                    bonds[tuple(sorted((a, b)))] = str(bond.GetBondType())
        return atoms, bonds, duplicate, unnumbered

    la, lb, ld, lu = parse_side(left_raw)
    ra, rb, rd, ru = parse_side(right_raw)
    if la is None or ra is None:
        return {"status": "invalid_smiles", "flags": ["mapped_smiles_parse_failure"]}
    common = set(la) & set(ra)
    flags: list[str] = []
    if ld or rd:
        flags.append("duplicate_atom_map_numbers")
    if set(la) - set(ra) or set(ra) - set(la):
        flags.append("side_specific_atom_map_numbers")
    broken = [[*pair, bond] for pair, bond in lb.items() if pair not in rb]
    formed = [[*pair, bond] for pair, bond in rb.items() if pair not in lb]
    changed_bonds = [[*pair, lb[pair], rb[pair]] for pair in set(lb) & set(rb) if lb[pair] != rb[pair]]
    changed_atoms = {n for row in broken + formed + changed_bonds for n in row[:2]}
    for n in common:
        if la[n] != ra[n]:
            changed_atoms.add(n)
    unmapped = int(lu or 0) + int(ru or 0) + len(set(la) ^ set(ra))
    conserved = len(common) / max(len(la), len(ra), 1)
    status = "valid" if common and not ld and not rd else "valid_with_warnings" if common else "invalid_no_conserved_maps"
    if not changed_atoms:
        flags.append("no_reaction_centre_detected")
    return {
        "status": status, "flags": flags, "mapped": len(common), "unmapped": unmapped,
        "conserved": conserved, "changed_atoms": sorted(changed_atoms), "broken": broken,
        "formed": formed, "changed_bonds": changed_bonds,
    }


def main() -> None:
    db = sqlite3.connect(WORK_DB)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA journal_mode=WAL")
    files = source_file_ids(db)
    reactions = {row["reaction_id"]: row for row in db.execute("SELECT i.*,s.* FROM reactenz_reaction_inputs i JOIN standardized_reactions s USING(reaction_id)")}
    index_iso: dict[str, set[str]] = defaultdict(set)
    index_ns: dict[str, set[str]] = defaultdict(set)
    literal_iso: dict[str, set[str]] = defaultdict(set)
    literal_relaxed: dict[str, set[str]] = defaultdict(set)
    for rid, row in reactions.items():
        if row["directionless_reaction_key"]:
            index_iso[row["directionless_reaction_key"]].add(rid)
        if row["directionless_reaction_key_no_stereo"]:
            index_ns[row["directionless_reaction_key_no_stereo"]].add(rid)
        signature = cheap_reaction_signature(row["canonical_reaction_smiles"])
        relaxed_signature = cheap_reaction_signature(row["canonical_reaction_smiles"], relax_stereo=True)
        if signature:
            literal_iso[signature].add(rid)
        if relaxed_signature:
            literal_relaxed[relaxed_signature].add(rid)

    db.execute("DELETE FROM qa_results WHERE check_name LIKE 'cross_%' OR check_name LIKE 'atom_%'")
    for table in ("reaction_centres", "atom_mappings", "mapping_conflicts", "cross_database_mappings", "external_reactions"):
        db.execute(f"DELETE FROM {table}")
    db.commit()
    counters = Counter()
    candidates: dict[str, dict[str, Any]] = {}

    # Rhea reaction identities and direction families.
    rhea_smiles_path = SRC / "rhea/tsv/rhea-reaction-smiles.tsv"
    rhea_identity: dict[str, dict[str, Any]] = {}
    rhea_smiles: dict[str, str] = {}
    with open(rhea_smiles_path, encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, 1):
            rid, smiles = line.rstrip("\n").split("\t", 1)
            ident = reaction_identity(smiles)
            if ident:
                rhea_identity[rid] = ident
            rhea_smiles[rid] = smiles
            external_insert(db, f"rhea:{rid}", "Rhea", rid, file_id(files, "rhea/tsv/rhea-reaction-smiles.tsv"),
                            smiles=smiles, version="141", locator=f"line:{line_no}")
    families: dict[str, dict[str, str]] = {}
    any_to_family: dict[str, dict[str, str]] = {}
    with open(SRC / "rhea/tsv/rhea-directions.tsv", encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle, delimiter="\t"):
            family = {"MASTER": row["RHEA_ID_MASTER"], "LR": row["RHEA_ID_LR"], "RL": row["RHEA_ID_RL"], "BI": row["RHEA_ID_BI"]}
            families[family["MASTER"]] = family
            for value in family.values():
                any_to_family[value] = family
    obsolete: dict[str, str] = {}
    with open(SRC / "rhea/tsv/rhea-obsoletes.tsv", encoding="utf-8", newline="") as handle:
        rows = csv.reader(handle, delimiter="\t")
        header = next(rows)
        for row in rows:
            if len(row) >= 2:
                obsolete[row[0]] = row[1]

    # MetaNetX complete reaction property table.
    mnx_path = SRC / "metanetx/reac_prop.tsv"
    with open(mnx_path, encoding="utf-8", errors="replace") as handle:
        header = None
        line_no = 0
        for line_no, line in enumerate(handle, 1):
            if line.startswith("#ID\t"):
                header = line[1:].rstrip("\n").split("\t")
                break
        if header is None:
            raise RuntimeError("MetaNetX reac_prop header not found")
        reader = csv.DictReader(handle, fieldnames=header, delimiter="\t")
        for row in reader:
            mnx = row["ID"]
            external_insert(db, f"metanetx:{mnx}", "MetaNetX", mnx, file_id(files, "metanetx/reac_prop.tsv"),
                            equation=row.get("mnx_equation"), version="4.5", locator=f"line:{reader.line_num + line_no}")
            counters["external_metanetx"] += 1
    db.commit()
    print(f"[external] Rhea={len(rhea_smiles):,}; MetaNetX={counters['external_metanetx']:,}", flush=True)

    # EnzymeMap's Rhea atom maps are joined to Rhea structures by normalized identity.
    rhea_mapped_by_identity: dict[str, list[tuple[str, str]]] = defaultdict(list)
    rhea_mapped_by_identity_no_stereo: dict[str, list[tuple[str, str]]] = defaultdict(list)
    with open(SRC / "enzymemap/data/RHEA_reactions.csv", encoding="utf-8", newline="") as handle:
        for row_no, row in enumerate(csv.DictReader(handle), 2):
            mapped = row["rxn_smiles"]
            ident = reaction_identity(mapped)
            if ident:
                rhea_mapped_by_identity[ident["directionless"]].append((mapped, f"row:{row_no}"))
                rhea_mapped_by_identity_no_stereo[ident["directionless_no_stereo"]].append((mapped, f"row:{row_no}"))

    # Direct Rhea, KEGG, MetaCyc and MNX assertions.
    def best_rhea_external(row: sqlite3.Row) -> tuple[str | None, dict[str, Any] | None]:
        source = normalized_id(row["source_rhea_id"])
        if not source:
            return None, None
        family = any_to_family.get(source)
        candidate_ids = [source] if source in rhea_identity else []
        if family:
            candidate_ids += [family["LR"], family["RL"]]
        candidate_ids = list(dict.fromkeys(candidate_ids))
        best_id = None; best_ident = None; best_score = -1
        for ext_id in candidate_ids:
            ident = rhea_identity.get(ext_id)
            if not ident:
                continue
            rel = relation(row, ident)
            score = 3 if rel["chemistry"] == "exact_normalized_identity" else 2 if rel["chemistry"].startswith("connectivity") else 0
            if ident["directional"] == row["directional_reaction_key"]:
                score += 1
            if score > best_score:
                best_id, best_ident, best_score = ext_id, ident, score
        return best_id, best_ident

    # Aliases avoid duplicate column names from SELECT i.*,s.*.
    aliased = {}
    for rid, row in reactions.items():
        d = dict(row)
        d["source_rhea_id"] = d.get("source_rhea_id") or d.get("rhea_id")
        d["source_kegg_reaction_id"] = d.get("source_kegg_reaction_id") or d.get("kegg_reaction_id")
        d["source_metacyc_reaction_id"] = d.get("source_metacyc_reaction_id") or d.get("metacyc_reaction_id")
        d["source_mnx_reaction_ids"] = d.get("source_mnx_reaction_ids") or d.get("mnx_reaction_ids")
        aliased[rid] = d
    # sqlite.Row-like access is sufficient with dictionaries in all helper functions.
    reactions = aliased  # type: ignore[assignment]

    # Load direct EnzymeMap benchmark maps before creating direct KEGG/MetaCyc mappings.
    direct_processed: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for source_name, raw_rel, processed_rel, id_field, scope in (
        ("KEGG", "enzymemap/additional_benchmarks/kegg/data/raw_reactions.csv.gz", "enzymemap/additional_benchmarks/kegg/data/processed_reactions.csv", "ID", "internal_only_upstream_terms_apply"),
        ("MetaCyc", "enzymemap/additional_benchmarks/metacyc/data/raw_reactions.csv", "enzymemap/additional_benchmarks/metacyc/data/processed_reactions.csv", "ORIG_RXN_TEXT", "internal_only_upstream_license_required"),
    ):
        raw_by_index: dict[int, str] = {}
        with open_csv(SRC / raw_rel) as handle:
            for idx, row in enumerate(csv.DictReader(handle)):
                source_id = normalized_id(row.get(id_field))
                if source_id:
                    raw_by_index[idx] = source_id
        with open_csv(SRC / processed_rel) as handle:
            for row_no, row in enumerate(csv.DictReader(handle), 2):
                try:
                    source_id = raw_by_index.get(int(row["rxn_idx"]))
                except (TypeError, ValueError):
                    source_id = None
                if not source_id:
                    continue
                mapped = row.get("mapped") or ""
                ident = reaction_identity(row.get("unmapped") or mapped)
                item = {"mapped": mapped, "identity": ident, "quality": float(row.get("quality") or 0),
                        "rule": row.get("rule"), "row": row_no, "scope": scope, "processed_rel": processed_rel}
                direct_processed[(source_name, source_id)].append(item)

    for n, (rid, row) in enumerate(reactions.items(), 1):
        rhea_source = normalized_id(row.get("source_rhea_id"))
        if rhea_source:
            ext_id, ext_ident = best_rhea_external(row)  # type: ignore[arg-type]
            evidence = {"asserted_rhea_id": rhea_source, "matched_directional_rhea_id": ext_id,
                        "external_reaction_smiles": rhea_smiles.get(ext_id or "")}
            add_mapping(db, row, "Rhea", rhea_source, "direct_reactenz_identifier", ext_ident, evidence)  # type: ignore[arg-type]
            if rhea_source in obsolete:
                conflict_id = "conflict:" + hashlib.sha256(f"{rid}|obsolete_rhea".encode()).hexdigest()[:24]
                db.execute("INSERT OR REPLACE INTO mapping_conflicts VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                           (conflict_id, rid, None, "obsolete_external_identifier", "error", rhea_source, obsolete[rhea_source],
                            "ReactEnzDB points to an obsolete Rhea identifier.", "open", "replace_with_current_rhea_id", 1, now()))
            if ext_id and ext_ident:
                mapped_options = rhea_mapped_by_identity.get(ext_ident["directionless"], [])
                rhea_map_basis = "direct_rhea_identity"
                if not mapped_options:
                    mapped_options = rhea_mapped_by_identity_no_stereo.get(ext_ident["directionless_no_stereo"], [])
                    rhea_map_basis = "direct_rhea_connectivity_identity_stereo_relaxed"
                if mapped_options:
                    mapped, locator = mapped_options[0]
                    key = f"enzymemap-rhea:{ext_id}:{hashlib.sha256(mapped.encode()).hexdigest()[:12]}"
                    external_insert(db, key, "EnzymeMap-Rhea", ext_id, file_id(files, "enzymemap/data/RHEA_reactions.csv"),
                                    smiles=rhea_smiles.get(ext_id), mapped=mapped, version="c91578856f11312d7941b290f8b773eb41b54973",
                                    locator=locator)
                    candidates[rid] = {"mapped": mapped, "external_key": key, "source": "EnzymeMap-Rhea",
                                       "quality": 1.0, "rule": None,
                                       "score": 120.0 if rhea_map_basis == "direct_rhea_identity" else 114.0,
                                       "basis": rhea_map_basis}

        for target, field in (("KEGG", "source_kegg_reaction_id"), ("MetaCyc", "source_metacyc_reaction_id")):
            source_id = normalized_id(row.get(field))
            if not source_id:
                continue
            options = direct_processed.get((target, source_id), [])
            best = None
            for option in options:
                rel = relation(row, option["identity"]) if option["identity"] else None
                score = (30 if rel and rel["chemistry"] == "exact_normalized_identity" else 20 if rel and rel["chemistry"].startswith("connectivity") else 0) + option["quality"]
                if best is None or score > best[0]:
                    best = (score, option)
            option = best[1] if best else None
            ext_ident = option["identity"] if option else None
            ext_smiles = option["mapped"] if option else None
            add_mapping(db, row, target, source_id, "direct_reactenz_identifier", ext_ident,
                        {"external_reaction_smiles": ext_smiles, "enzymemap_processed_records": len(options)})  # type: ignore[arg-type]
            if option and ext_ident and relation(row, ext_ident)["chemistry"] != "identifier_identity_conflict":
                key = f"enzymemap-{target.lower()}:{source_id}:{option['row']}"
                external_insert(db, key, f"EnzymeMap-{target}", source_id, file_id(files, option["processed_rel"]),
                                smiles=option["identity"] and option["mapped"], mapped=option["mapped"], rule=option["rule"],
                                quality=option["quality"], version="c91578856f11312d7941b290f8b773eb41b54973",
                                locator=f"row:{option['row']}", publication_scope=option["scope"])
                score = 110 + option["quality"] if target == "KEGG" else 105 + option["quality"]
                if score > candidates.get(rid, {}).get("score", -1):
                    candidates[rid] = {"mapped": option["mapped"], "external_key": key, "source": f"EnzymeMap-{target}",
                                       "quality": option["quality"], "rule": option["rule"], "score": score,
                                       "basis": f"direct_{target.lower()}_identity"}

        for mnx in filter(None, (row.get("source_mnx_reaction_ids") or "").split(";")):
            exists = db.execute("SELECT 1 FROM external_reactions WHERE external_reaction_key=?", (f"metanetx:{mnx}",)).fetchone()
            add_mapping(db, row, "MetaNetX", mnx, "direct_existing_mnxref_mapping", None,
                        {"record_present_in_mnxref_4_5": bool(exists)})  # type: ignore[arg-type]
            if not exists:
                conflict_id = "conflict:" + hashlib.sha256(f"{rid}|{mnx}|missing_mnx".encode()).hexdigest()[:24]
                db.execute("INSERT OR REPLACE INTO mapping_conflicts VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                           (conflict_id, rid, None, "missing_external_record", "error", mnx, None,
                            "Existing ReactEnzDB MNX mapping is absent from the current MNXref reaction properties.",
                            "open", "review_deprecation_or_version_drift", 1, now()))
        if n % 1000 == 0:
            db.commit(); print(f"[direct] {n:,}/{len(reactions):,}", flush=True)
    db.commit()

    # Structure-only EnzymeMap matches, retaining only the best map per ReactEnz reaction.
    main_processed = SRC / "enzymemap/data/processed_reactions.csv.gz"
    matched_external_rows = 0
    with gzip.open(main_processed, "rt", encoding="utf-8", errors="replace", newline="") as handle:
        for row_no, row in enumerate(csv.DictReader(handle), 2):
            mapped = row.get("mapped") or ""
            unmapped = row.get("unmapped") or ""
            prefiltered = literal_iso.get(cheap_reaction_signature(unmapped) or "", set())
            if not prefiltered:
                prefiltered = literal_relaxed.get(cheap_reaction_signature(unmapped, relax_stereo=True) or "", set())
            if row_no % 25000 == 0:
                db.commit(); print(f"[EnzymeMap] scanned={row_no-1:,}; relevant={matched_external_rows:,}", flush=True)
            if not prefiltered:
                continue
            ident = reaction_identity(unmapped or mapped)
            if not ident:
                continue
            match_type = None
            matched = index_iso.get(ident["directionless"], set())
            if matched:
                match_type = "exact_normalized_identity"
            else:
                matched = index_ns.get(ident["directionless_no_stereo"], set())
                if matched:
                    match_type = "connectivity_identity_stereo_relaxed"
            if not matched:
                continue
            quality = float(row.get("quality") or 0)
            key = f"enzymemap-main:{row.get('rxn_idx')}:{row_no}"
            external_insert(db, key, "EnzymeMap", str(row.get("rxn_idx")), file_id(files, "enzymemap/data/processed_reactions.csv.gz"),
                            equation=row.get("orig_rxn_text"), smiles=row.get("unmapped"), mapped=mapped, rule=row.get("rule"),
                            quality=quality, version="c91578856f11312d7941b290f8b773eb41b54973", locator=f"row:{row_no}",
                            publication_scope="derived_mapping_and_rules_with_EnzymeMap_attribution")
            matched_external_rows += 1
            for rid in matched:
                reaction_row = reactions[rid]
                directional_bonus = 3 if ident["directional"] == reaction_row["directional_reaction_key"] else 0
                score = (95 if match_type == "exact_normalized_identity" else 82) + directional_bonus + quality
                if score > candidates.get(rid, {}).get("score", -1):
                    candidates[rid] = {"mapped": mapped, "external_key": key, "source": "EnzymeMap",
                                       "quality": quality, "rule": row.get("rule"), "score": score, "basis": match_type}
    db.commit()

    # Validate selected atom maps and extract bond-change reaction centres.
    for n, (rid, candidate) in enumerate(candidates.items(), 1):
        validation = mapped_validation(candidate["mapped"])
        mapping_id = f"atommap:{rid}:best"
        db.execute(
            "INSERT OR REPLACE INTO atom_mappings VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (mapping_id, rid, candidate["mapped"], "matched_precomputed_atom_mapping", candidate["source"],
             validation.get("mapped"), validation.get("unmapped"), validation.get("conserved"),
             min(1.0, max(0.0, candidate["score"] / 120.0)), validation["status"],
             json.dumps({"flags": validation.get("flags", []), "match_basis": candidate["basis"]}, sort_keys=True),
             candidate["external_key"], now()),
        )
        if validation.get("changed_atoms") is not None:
            changed = validation["changed_atoms"]
            centre_smarts = ".".join(f"[*:{number}]" for number in changed) or None
            db.execute(
                "INSERT OR REPLACE INTO reaction_centres VALUES (?,?,?,?,?,?,?,?,?,?)",
                (f"centre:{rid}:best", mapping_id, json.dumps(changed), json.dumps(validation["broken"]),
                 json.dumps(validation["formed"]), json.dumps(validation["changed_bonds"]), centre_smarts,
                 candidate.get("rule"), "atom_map_bond_and_atom_state_difference_v1",
                 "extracted" if changed else "no_change_detected"),
            )
        counters[f"atom_mapping:{validation['status']}"] += 1
        if n % 1000 == 0:
            db.commit(); print(f"[centres] {n:,}/{len(candidates):,}", flush=True)
    db.commit()

    # Rhea xref consistency checks for reactions that assert both Rhea and KEGG/MetaCyc.
    rhea_xrefs: dict[tuple[str, str], set[str]] = defaultdict(set)
    with open(SRC / "rhea/tsv/rhea2xrefs.tsv", encoding="utf-8", newline="") as handle:
        for x in csv.DictReader(handle, delimiter="\t"):
            db_name = x["DB"]
            if db_name in {"KEGG_REACTION", "METACYC"}:
                rhea_xrefs[(x["MASTER_ID"], db_name)].add(x["ID"])
    for rid, row in reactions.items():
        rhea_source = normalized_id(row.get("source_rhea_id"))
        if not rhea_source:
            continue
        family = any_to_family.get(rhea_source)
        master = family["MASTER"] if family else rhea_source
        for db_name, field in (("KEGG_REACTION", "source_kegg_reaction_id"), ("METACYC", "source_metacyc_reaction_id")):
            asserted = normalized_id(row.get(field))
            if not asserted:
                continue
            external_ids = rhea_xrefs.get((master, db_name), set())
            if external_ids and asserted not in external_ids:
                conflict_id = "conflict:" + hashlib.sha256(f"{rid}|{db_name}|xref".encode()).hexdigest()[:24]
                db.execute("INSERT OR REPLACE INTO mapping_conflicts VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                           (conflict_id, rid, None, "cross_database_identifier_disagreement", "error", asserted,
                            ";".join(sorted(external_ids)), "ReactEnzDB's asserted identifier disagrees with the current Rhea cross-reference set.",
                            "open", "manual_review_against_source_versions", 1, now()))
            if len(external_ids) > 1:
                conflict_id = "conflict:" + hashlib.sha256(f"{rid}|{db_name}|one_to_many".encode()).hexdigest()[:24]
                db.execute("INSERT OR REPLACE INTO mapping_conflicts VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                           (conflict_id, rid, None, "one_to_many_cross_reference", "warning", asserted,
                            ";".join(sorted(external_ids)), "One Rhea master reaction maps to multiple target database identifiers.",
                            "open", "preserve_all_targets_with_explicit_one_to_many_flag", 0, now()))

    metrics = {
        "external_reactions": db.execute("SELECT COUNT(*) FROM external_reactions").fetchone()[0],
        "cross_database_mappings": db.execute("SELECT COUNT(*) FROM cross_database_mappings").fetchone()[0],
        "mapping_conflicts": db.execute("SELECT COUNT(*) FROM mapping_conflicts").fetchone()[0],
        "atom_mappings": db.execute("SELECT COUNT(*) FROM atom_mappings").fetchone()[0],
        "reaction_centres": db.execute("SELECT COUNT(*) FROM reaction_centres").fetchone()[0],
        "enzymemap_relevant_rows": matched_external_rows,
    }
    checks = [
        ("cross_direct_rhea_coverage", db.execute("SELECT COUNT(*) FROM cross_database_mappings WHERE target_db='Rhea'").fetchone()[0],
         sum(bool(normalized_id(row.get("source_rhea_id"))) for row in reactions.values()), "error"),
        ("cross_direct_kegg_coverage", db.execute("SELECT COUNT(*) FROM cross_database_mappings WHERE target_db='KEGG'").fetchone()[0],
         sum(bool(normalized_id(row.get("source_kegg_reaction_id"))) for row in reactions.values()), "error"),
        ("cross_direct_metacyc_coverage", db.execute("SELECT COUNT(*) FROM cross_database_mappings WHERE target_db='MetaCyc'").fetchone()[0],
         sum(bool(normalized_id(row.get("source_metacyc_reaction_id"))) for row in reactions.values()), "error"),
        ("atom_mapping_centre_referential_integrity", db.execute("SELECT COUNT(*) FROM reaction_centres c LEFT JOIN atom_mappings a USING(atom_mapping_id) WHERE a.atom_mapping_id IS NULL").fetchone()[0], 0, "error"),
    ]
    for name, observed, expected, severity in checks:
        db.execute("INSERT OR REPLACE INTO qa_results VALUES (?,?,?,?,?,?,?)",
                   (name, int(observed == expected), str(observed), str(expected), severity, now(), "{}"))
    db.execute("INSERT OR REPLACE INTO metadata VALUES (?,?)", ("cross_database_build_summary_json", json.dumps(metrics, sort_keys=True)))
    db.execute("INSERT OR REPLACE INTO metadata VALUES (?,?)", ("cross_database_rule_version", RULE_VERSION))
    db.commit()
    print(json.dumps(metrics, indent=2, sort_keys=True), flush=True)
    db.close()


if __name__ == "__main__":
    main()
