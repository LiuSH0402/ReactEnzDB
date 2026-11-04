import argparse
import json
import re
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

from rdkit import Chem, DataStructs
from rdkit import RDLogger
from rdkit.Chem import rdFingerprintGenerator

RDLogger.DisableLog("rdApp.*")

COMMON_SMILES = {
    "[H]O[H]",
    "O",
    "[H+]",
    "[OH-]",
    "O=O",
    "O=C=O",
    "[O-]P(=O)([O-])[O-]",
}


def split_terms(value):
    if not value:
        return []
    normalized = (
        value.replace("<=>", ";")
        .replace("=>", ";")
        .replace("->", ";")
        .replace("→", ";")
        .replace("\n", ";")
        .replace("\t", ";")
    )
    normalized = re.sub(r"\s+\+\s+", ";", normalized)
    return [term.strip() for term in normalized.split(";") if term.strip()]


def mol_from_term(term):
    if not term or " " in term or re.search(r"[A-Za-z]{3,}-\d", term):
        return None
    return Chem.MolFromSmiles(term)


def canonicalize_query_term(term):
    if not term or not isinstance(term, str):
        return None
    mol = Chem.MolFromSmiles(term)
    if mol is None:
        return None
    for atom in mol.GetAtoms():
        atom.SetAtomMapNum(0)
    return Chem.MolToSmiles(mol, canonical=True, isomericSmiles=True)


def canonical_smiles(term):
    return canonicalize_query_term(term)


def chebi_values(term):
    match = re.match(r"^(?:CHEBI[:\s]+)(\d+)$", term, re.I)
    if not match:
        return []
    num = match.group(1)
    return [num, f"CHEBI:{num}", f"chebi:{num}"]


def pubchem_values(term):
    match = re.match(r"^(?:CID[:\s]*|PUBCHEM[:\s]+)(\d+)$", term, re.I)
    if not match:
        return []
    num = match.group(1)
    return [num, f"CID:{num}", f"CID {num}"]


def build_query_terms(substrates, products, mixed):
    substrate_terms = split_terms(substrates)
    product_terms = split_terms(products)
    if mixed and not substrate_terms and not product_terms:
        if "->" in mixed:
            left, right = mixed.split("->", 1)
            substrate_terms = split_terms(left)
            product_terms = split_terms(right)
        elif "=>" in mixed:
            left, right = mixed.split("=>", 1)
            substrate_terms = split_terms(left)
            product_terms = split_terms(right)
        elif "→" in mixed:
            left, right = mixed.split("→", 1)
            substrate_terms = split_terms(left)
            product_terms = split_terms(right)
        else:
            substrate_terms = split_terms(mixed)
    return substrate_terms, product_terms


def query_has_direction(value):
    return any(token in value for token in ("<=>", "=>", "->", "→"))


def side_sql(side):
    if side in {"left", "right"}:
        return "AND side = ?"
    return ""


def identity_rows(conn, term, side):
    clauses = []
    params = []
    chebis = chebi_values(term)
    if chebis:
        clauses.append(f"chebi_id IN ({','.join('?' for _ in chebis)})")
        params.extend(chebis)
    pubs = pubchem_values(term)
    if pubs:
        clauses.append(f"pubchem_id IN ({','.join('?' for _ in pubs)})")
        params.extend(pubs)
    clauses.append("lower(compound_id) = lower(?)")
    params.append(term)
    clauses.append("lower(compound_name) = lower(?)")
    params.append(term)
    canonical = canonical_smiles(term)
    if canonical:
        clauses.append("smiles = ? OR smiles = ?")
        params.extend([term, canonical])
    sql = f"""
        SELECT reaction_id, compound_id, compound_name, chebi_id, pubchem_id, smiles, side
        FROM web_reaction_compounds
        WHERE ({' OR '.join(clauses)})
        {side_sql(side)}
    """
    if side in {"left", "right"}:
        params.append(side)
    rows = conn.execute(sql, params).fetchall()
    if rows or len(term) < 4 or chebis or pubs or canonical:
        return rows, "identity"
    like_sql = f"""
        SELECT reaction_id, compound_id, compound_name, chebi_id, pubchem_id, smiles, side
        FROM web_reaction_compounds
        WHERE compound_name LIKE ? ESCAPE '\\'
        {side_sql(side)}
    """
    like = "%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    like_params = [like]
    if side in {"left", "right"}:
        like_params.append(side)
    return conn.execute(like_sql, like_params).fetchall(), "text"


def fingerprint_scan(conn, pending_items, generator):
    if not pending_items:
        return []
    rows = conn.execute(
        """
        SELECT reaction_id, compound_id, compound_name, chebi_id, pubchem_id, smiles, side
        FROM web_reaction_compounds
        WHERE smiles IS NOT NULL AND trim(smiles) <> ''
        """
    ).fetchall()
    matches = []
    for row in rows:
        smiles = row["smiles"]
        if not smiles or smiles in COMMON_SMILES:
            continue
        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            continue
        fingerprint = generator.GetFingerprint(mol)
        for item in pending_items:
            if item["side"] in {"left", "right"} and row["side"] and row["side"] != item["side"]:
                continue
            score = float(DataStructs.TanimotoSimilarity(item["fingerprint"], fingerprint))
            if score >= 0.45:
                matches.append((row, item, score, "fingerprint"))
    return matches


def add_match(reaction_matches, row, item, score, method):
    reaction_matches[row["reaction_id"]].append(
        {
            "query": item["term"],
            "side": item["side"],
            "score": score,
            "method": method,
            "compound": row["compound_name"] or row["compound_id"],
        }
    )


def canonicalize_query_terms(terms):
    if not isinstance(terms, list):
        return {"canonical": [], "invalid": True}
    canonical = []
    for term in terms:
        value = canonicalize_query_term(term)
        if not value:
            return {"canonical": [], "invalid": True}
        if value not in canonical:
            canonical.append(value)
    return {"canonical": canonical, "invalid": False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db")
    parser.add_argument("--substrates", default="")
    parser.add_argument("--products", default="")
    parser.add_argument("--query", default="")
    parser.add_argument("--limit", type=int, default=12)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--match-mode", choices=("complete", "related"), default="complete")
    parser.add_argument("--canonicalize", action="store_true")
    args = parser.parse_args()

    if args.canonicalize:
        try:
            terms = json.loads(sys.stdin.read() or "[]")
        except json.JSONDecodeError:
            print(json.dumps({"canonical": [], "invalid": True}))
            return
        print(json.dumps(canonicalize_query_terms(terms)))
        return

    if not args.db:
        raise SystemExit("--db is required unless --canonicalize is set")
    db_path = Path(args.db)
    substrate_terms, product_terms = build_query_terms(args.substrates, args.products, args.query)
    if args.query and not args.substrates and not args.products and not query_has_direction(args.query):
        all_terms = [("any", term) for term in substrate_terms]
    else:
        all_terms = [("left", term) for term in substrate_terms] + [("right", term) for term in product_terms]

    generator = rdFingerprintGenerator.GetMorganGenerator(radius=2, fpSize=2048)
    query_items = []
    for side, term in all_terms:
        mol = mol_from_term(term)
        query_items.append(
            {
                "side": side,
                "term": term,
                "mol": mol,
                "fingerprint": generator.GetFingerprint(mol) if mol is not None else None,
                "canonical": Chem.MolToSmiles(mol, canonical=True) if mol is not None else None,
            }
        )

    if not query_items:
        print(json.dumps({"rows": [], "query_terms": [], "total": 0}))
        return

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    reaction_matches = defaultdict(list)
    pending_fingerprint = []
    for item in query_items:
        rows, method = identity_rows(conn, item["term"], item["side"])
        if rows:
            for row in rows:
                add_match(reaction_matches, row, item, 1.0, method)
            continue
        if item["fingerprint"] is not None:
            pending_fingerprint.append(item)

    for row, item, score, method in fingerprint_scan(conn, pending_fingerprint, generator):
        add_match(reaction_matches, row, item, score, method)

    reaction_ids = list(reaction_matches)
    if not reaction_ids:
        print(json.dumps({"rows": [], "query_terms": [item["term"] for item in query_items], "total": 0}))
        return

    placeholders = ",".join("?" for _ in reaction_ids)
    meta_rows = conn.execute(
        f"""
        SELECT rid.reactenz_reaction_id, wr.reaction_id, wr.reaction_direction,
               wr.reaction_equation_display, wr.enzyme_count, wr.kinetics_count,
               wr.all_participants_have_smiles, wr.ec_number, wr.rhea_id,
               wr.kegg_reaction_id, wr.metacyc_reaction_id
        FROM web_reactions wr
        JOIN web_reaction_ids rid ON rid.reaction_id = wr.reaction_id
        WHERE wr.reaction_id IN ({placeholders})
        """,
        reaction_ids,
    ).fetchall()

    results = []
    for meta in meta_rows:
        matches = reaction_matches[meta["reaction_id"]]
        best_by_query = {}
        for match in matches:
            key = (match["side"], match["query"])
            if key not in best_by_query or match["score"] > best_by_query[key]["score"]:
                best_by_query[key] = match
        matched = list(best_by_query.values())
        complete = len(matched) == len(query_items) and all(match["method"] == "identity" for match in matched)
        if (args.match_mode == "complete") != complete:
            continue
        coverage = len(matched) / max(1, len(query_items))
        mean_score = sum(match["score"] for match in matched) / max(1, len(query_items))
        side_bonus = 0.08 if substrate_terms and product_terms and len(matched) >= 2 else 0
        score = min(1.0, mean_score * 0.82 + coverage * 0.18 + side_bonus)
        results.append(
            {
                "reactenz_reaction_id": meta["reactenz_reaction_id"],
                "reaction_id": meta["reaction_id"],
                "reaction_direction": meta["reaction_direction"],
                "reaction_equation_display": meta["reaction_equation_display"],
                "enzyme_count": meta["enzyme_count"],
                "kinetics_count": meta["kinetics_count"],
                "all_participants_have_smiles": meta["all_participants_have_smiles"],
                "ec_number": meta["ec_number"],
                "rhea_id": meta["rhea_id"],
                "kegg_reaction_id": meta["kegg_reaction_id"],
                "metacyc_reaction_id": meta["metacyc_reaction_id"],
                "smiles_similarity_score": round(score, 4),
                "matched_query_count": len(matched),
                "query_count": len(query_items),
                "matched_compounds": ", ".join(sorted({match["compound"] for match in matched if match["compound"]})),
                "match_methods": ", ".join(sorted({match["method"] for match in matched if match["method"]})),
            }
        )

    results.sort(
        key=lambda row: (
            row["smiles_similarity_score"],
            row["matched_query_count"],
            row["enzyme_count"] or 0,
            row["kinetics_count"] or 0,
        ),
        reverse=True,
    )
    print(json.dumps({
        "rows": results[max(0, args.offset): max(0, args.offset) + max(1, min(args.limit, 50))],
        "query_terms": [item["term"] for item in query_items],
        "total": len(results),
    }))


if __name__ == "__main__":
    main()
