"""Derived reaction lookup and conservative, direction-aware query-side retrieval."""
import argparse
from collections import defaultdict
from functools import lru_cache
from fractions import Fraction
import json
import os
from pathlib import Path
import sqlite3
import sys

from rdkit import Chem, RDLogger, rdBase
from rdkit.Chem.MolStandardize import rdMolStandardize

RDLogger.DisableLog("rdApp.*")
POLICY = "uncharger_stereo_isotope_v1"
UNCHARGER = rdMolStandardize.Uncharger()


def readonly(path):
    conn = sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only=ON")
    return conn


@lru_cache(maxsize=50000)
def structures(value):
    if not value:
        return None
    mol = Chem.MolFromSmiles(value)
    if mol is None or not mol.GetNumAtoms() or any(atom.GetAtomicNum() == 0 for atom in mol.GetAtoms()):
        return None
    for atom in mol.GetAtoms():
        atom.SetAtomMapNum(0)
    return (Chem.MolToSmiles(mol, isomericSmiles=True),
            Chem.MolToSmiles(UNCHARGER.uncharge(mol), isomericSmiles=True))


def build_index(source_path, output_path):
    source_path, output_path = Path(source_path).resolve(), Path(output_path).resolve()
    if source_path == output_path:
        raise ValueError("The derived index must not overwrite the source database")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_name(output_path.name + f".building-{os.getpid()}")
    source = readonly(source_path)
    destination = sqlite3.connect(temporary)
    try:
        destination.executescript("""
          CREATE TABLE reaction_participants (
            reaction_id TEXT NOT NULL, side TEXT NOT NULL,
            canonical_smiles TEXT NOT NULL, normalized_smiles TEXT,
            compound_name TEXT, is_currency INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(reaction_id,side,canonical_smiles));
          CREATE INDEX idx_lookup_side_smiles ON reaction_participants(side,canonical_smiles);
          CREATE INDEX idx_lookup_normalized ON reaction_participants(side,normalized_smiles);
          CREATE TABLE reaction_context (
            reaction_id TEXT PRIMARY KEY, reaction_direction TEXT,
            equation TEXT, participants_complete INTEGER NOT NULL,
            no_net_chemical_change INTEGER NOT NULL DEFAULT 0);
          CREATE TABLE lookup_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        """)
        destination.executemany("INSERT INTO reaction_context(reaction_id,reaction_direction,equation,participants_complete) VALUES (?,?,?,?)", (
            (row["reaction_id"], row["reaction_direction"], row["reaction_equation_display"],
             int(bool(row["all_participants_have_smiles"])))
            for row in source.execute("SELECT reaction_id,reaction_direction,reaction_equation_display,all_participants_have_smiles FROM web_reactions")
        ))
        currency = {"O", "[H+]", "[OH-]", "O=O", "O=C=O", "[O-]P(=O)([O-])[O-]"}
        input_rows = invalid_rows = 0
        net = defaultdict(lambda: defaultdict(Fraction))
        uncertain_net = set()
        for row in source.execute("SELECT reaction_id,side,smiles,compound_name,stoichiometry FROM web_reaction_compounds WHERE side IN ('left','right')"):
            input_rows += 1
            value = row["smiles"]
            if not value:
                uncertain_net.add(row["reaction_id"])
                destination.execute("UPDATE reaction_context SET participants_complete=0 WHERE reaction_id=?", (row["reaction_id"],))
                continue
            parsed = structures(value)
            if parsed is None:
                uncertain_net.add(row["reaction_id"])
                destination.execute("UPDATE reaction_context SET participants_complete=0 WHERE reaction_id=?", (row["reaction_id"],))
                mol = Chem.MolFromSmiles(value)
                if mol is None:
                    invalid_rows += 1
                    continue
                canonical, normalized = Chem.MolToSmiles(mol, isomericSmiles=True), None
            else:
                canonical, normalized = parsed
                try:
                    # Blank source coefficients use the usual implicit unit coefficient.
                    coefficient = Fraction(str(row["stoichiometry"] or "1"))
                    if coefficient <= 0:
                        raise ValueError("Nonpositive coefficient")
                    net[row["reaction_id"]][normalized] += coefficient * (1 if row["side"] == "right" else -1)
                except (ValueError, ZeroDivisionError):
                    uncertain_net.add(row["reaction_id"])
            destination.execute("INSERT OR IGNORE INTO reaction_participants VALUES (?,?,?,?,?,?)", (
                row["reaction_id"], row["side"], canonical, normalized,
                row["compound_name"], int(canonical in currency)))
        destination.executemany("UPDATE reaction_context SET no_net_chemical_change=1 WHERE reaction_id=? AND participants_complete=1", (
            (rid,) for rid, changes in net.items() if rid not in uncertain_net and changes and all(value == 0 for value in changes.values())))
        metadata = {
            "source_database": source_path.name,
            "source_size_bytes": str(source_path.stat().st_size),
            "input_rows": str(input_rows), "invalid_smiles_rows": str(invalid_rows),
            "indexed_participants": str(destination.execute("SELECT count(*) FROM reaction_participants").fetchone()[0]),
            "indexed_reactions": str(destination.execute("SELECT count(*) FROM reaction_context").fetchone()[0]),
            "normalization_policy": POLICY, "rdkit_version": rdBase.rdkitVersion,
            "build_policy": "Query-side retrieval only; chirality/isotopes retained; no tautomer or stereochemistry inference; direction from core structured participant orientation.",
        }
        destination.executemany("INSERT INTO lookup_metadata VALUES (?,?)", metadata.items())
        destination.commit()
    finally:
        destination.close()
        source.close()
    os.replace(temporary, output_path)
    return metadata


def match(index_path, query, limit=5):
    result = {"status": "no_match", "normalization_policy": POLICY,
              "query": query, "matches": [], "excluded": [], "total_matches": 0, "truncated": False}
    terms = [[part.strip() for part in query[key].split(".")] for key in ("precursors", "product")]
    parsed = [[structures(term) for term in side] for side in terms]
    if not all(all(side) for side in parsed):
        result["status"] = "invalid_or_wildcard_structure"
        return result
    left, right = [{entry[1] for entry in side} for side in parsed]
    if left == right:
        result["status"] = "no_net_query_transformation"
        return result
    conn = readonly(index_path)
    try:
        metadata = dict(conn.execute("SELECT key,value FROM lookup_metadata"))
        if metadata.get("normalization_policy") != POLICY or metadata.get("rdkit_version") != rdBase.rdkitVersion:
            raise ValueError("Rebuild the reaction lookup using this server's RDKit runtime")
        result["rdkit_version"] = rdBase.rdkitVersion
        index = defaultdict(set)
        keys = sorted(left | right)
        marks = ",".join("?" for _ in keys)
        for row in conn.execute(f"SELECT reaction_id,side,normalized_smiles FROM reaction_participants WHERE normalized_smiles IN ({marks})", keys):
            index[(row["side"], row["normalized_smiles"])].add(row["reaction_id"])
        for orientation, sides in (("as_written", ("left", "right")), ("reversed", ("right", "left"))):
            groups = [index[(sides[0], key)] for key in left] + [index[(sides[1], key)] for key in right]
            ids = set.intersection(*groups)
            for rid in sorted(ids):
                context = dict(conn.execute("SELECT * FROM reaction_context WHERE reaction_id=?", (rid,)).fetchone())
                rows = [dict(row) for row in conn.execute("SELECT * FROM reaction_participants WHERE reaction_id=?", (rid,))]
                reference = {side: {row["normalized_smiles"] for row in rows if row["side"] == side} for side in ("left", "right")}
                if context["no_net_chemical_change"]:
                    result["excluded"].append({"reaction_id": rid, "reason": "no_net_chemical_change_transport_or_exchange"})
                    continue
                direction = context["reaction_direction"]
                permitted = direction == "<=>" or (orientation == "as_written" and direction == "=>") or (orientation == "reversed" and direction == "<=")
                unknown = direction not in ("=>", "<=", "<=>")
                if not permitted and not unknown:
                    result["excluded"].append({"reaction_id": rid, "reason": "opposes_reference_direction"})
                    continue
                aligned = [[row for row in rows if row["side"] == side] for side in sides]
                exact = all(all(entry[0] in {row["canonical_smiles"] for row in ref} for entry in qry) for qry, ref in zip(parsed, aligned))
                extra = {side: [{"name": row["compound_name"], "smiles": row["canonical_smiles"]} for row in ref if row["normalized_smiles"] not in submitted]
                         for side, ref, submitted in zip(("precursors", "products"), aligned, (left, right))}
                result["matches"].append({
                    **context, "orientation": orientation,
                    "direction_status": "unspecified" if unknown else "supported_by_reference",
                    "match_basis": "exact_query_structures" if exact else "protonation_normalized",
                    "matched_left_count": len(left), "matched_right_count": len(right),
                    "query_left_count": len(left), "query_right_count": len(right),
                    "additional_participants": extra,
                    "accepted_reaction_identity": False,
                    "review_required": ["full participants and stoichiometry", "assay direction", "protein identity and experimental evidence"],
                })
        result["matches"].sort(key=lambda row: (row["direction_status"] != "supported_by_reference", row["match_basis"] != "exact_query_structures", row["reaction_id"], row["orientation"]))
        result["total_matches"] = len(result["matches"])
        result["truncated"] = len(result["matches"]) > limit
        result["matches"] = result["matches"][:limit]
        result["status"] = "candidate_reference_matches" if result["total_matches"] else "no_match"
        return result
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build", action="store_true")
    parser.add_argument("--db", type=Path)
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--query", help="JSON query; otherwise read stdin")
    args = parser.parse_args()
    if args.build:
        print(json.dumps(build_index(args.db, args.index)))
    else:
        print(json.dumps(match(args.index, json.loads(args.query) if args.query else json.load(sys.stdin), min(20, max(1, args.limit)))))
