from __future__ import annotations

import csv
import hashlib
import json
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = ROOT / "subnetx_runtime" / "upstream" / "SubNetX-v1.0" / "1_subnetwork_extraction"
ARBRE = UPSTREAM / "data" / "ARBRE"
OUTPUT = ROOT / "subnetx_runtime" / "data" / "subnetx_extraction.sqlite"
MIN_CAR = 0.34
IGNORED_BOUNDARIES = {
    "1468093962", "1468141273", "1468141265", "1467879821", "1468034880",
    "1468083953", "1467881253", "1467873656", "1468339327", "1467869449",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_id_list(path: Path) -> set[str]:
    values: set[str] = set()
    with path.open(encoding="utf-8-sig") as handle:
        for line in handle:
            value = line.strip().split()[0] if line.strip() else ""
            if value:
                values.add(value)
    return values


def batches(rows: list[tuple], size: int = 10_000):
    for index in range(0, len(rows), size):
        yield rows[index:index + size]


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    if OUTPUT.exists():
        OUTPUT.unlink()

    excludes = read_id_list(UPSTREAM / "defaults" / "excludelists" / "compounds.txt")
    toxic = read_id_list(UPSTREAM / "defaults" / "excludelists" / "toxic_compounds.txt")
    mammal = read_id_list(UPSTREAM / "defaults" / "excludelists" / "mammal_cofactors.txt")
    excluded_compounds = excludes | toxic

    conn = sqlite3.connect(OUTPUT)
    conn.executescript(
        """
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        PRAGMA temp_store=MEMORY;
        CREATE TABLE compounds (
          compound_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          synonyms TEXT,
          formula TEXT,
          smiles TEXT,
          inchikey TEXT,
          atoms INTEGER,
          carbons INTEGER,
          molecular_weight REAL
        ) WITHOUT ROWID;
        CREATE TABLE host_metabolites (compound_id TEXT PRIMARY KEY) WITHOUT ROWID;
        CREATE TABLE reactions (
          reaction_id TEXT PRIMARY KEY,
          compounds TEXT NOT NULL,
          stoichiometry TEXT NOT NULL,
          is_known INTEGER NOT NULL
        ) WITHOUT ROWID;
        CREATE TABLE edges (
          source TEXT NOT NULL,
          target TEXT NOT NULL,
          pair_id TEXT NOT NULL,
          car REAL NOT NULL,
          distance REAL NOT NULL,
          known_reaction REAL NOT NULL,
          PRIMARY KEY (source, target, pair_id)
        ) WITHOUT ROWID;
        CREATE TABLE pair_reactions (
          source TEXT NOT NULL,
          target TEXT NOT NULL,
          pair_id TEXT NOT NULL,
          reaction_id TEXT NOT NULL,
          PRIMARY KEY (source, target, pair_id, reaction_id)
        ) WITHOUT ROWID;
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
        """
    )

    allowed_ids: set[str] = set()
    compound_rows: list[tuple] = []
    with (ARBRE / "compounds.csv").open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            compound_id = row["cUID"].strip()
            try:
                carbons = int(float(row.get("C") or 0))
                atoms = int(float(row.get("Num_atoms") or 0))
                mw = float(row.get("MW") or 0)
            except ValueError:
                continue
            if compound_id in excluded_compounds or not (1 <= carbons <= 60) or not (1 <= atoms <= 1000) or not (0 <= mw <= 1000):
                continue
            allowed_ids.add(compound_id)
            compound_rows.append((
                compound_id,
                (row.get("COMMON_NAME") or compound_id).strip(),
                (row.get("OTHER_NAMES") or "")[:12_000],
                (row.get("Formula") or "").strip(),
                (row.get("SMILES") or "").strip(),
                (row.get("INCHIKEY") or "").strip(),
                atoms,
                carbons,
                mw,
            ))
    for chunk in batches(compound_rows):
        conn.executemany("INSERT INTO compounds VALUES (?,?,?,?,?,?,?,?,?)", chunk)
    conn.commit()

    host_ids: set[str] = set()
    with (UPSTREAM / "data" / "organisms_metabolites_annotated" / "ecoli.tsv").open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle, delimiter="\t"):
            compound_id = (row.get("metaboliteLCSBID") or "").strip()
            if compound_id in allowed_ids:
                host_ids.add(compound_id)
    conn.executemany("INSERT INTO host_metabolites VALUES (?)", ((value,) for value in sorted(host_ids)))

    balanced: set[str] = set()
    with (ARBRE / "reaction_balance.csv").open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            if row.get("balance") == "1":
                balanced.add(row["rxnUID"].strip())

    valid_reactions: set[str] = set()
    reaction_rows: list[tuple] = []
    with (ARBRE / "reactions.csv").open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            reaction_id = row["rxnUID"].strip()
            compound_ids = set((row.get("compounds") or "").split(";"))
            if reaction_id not in balanced or compound_ids & mammal:
                continue
            valid_reactions.add(reaction_id)
            reaction_rows.append((
                reaction_id,
                row.get("compounds") or "",
                row.get("rxn_stoich_code") or "",
                int(float(row.get("if_known") or 0)),
            ))
    for chunk in batches(reaction_rows):
        conn.executemany("INSERT INTO reactions VALUES (?,?,?,?)", chunk)
    conn.commit()

    network: dict[str, tuple[str, str, str, float, float, float]] = {}
    with (ARBRE / "network.csv").open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            source, target = row["source"].strip(), row["target"].strip()
            if source not in allowed_ids or target not in allowed_ids:
                continue
            if int(float(row.get("structure_based") or 0)) > 0 or float(row.get("score") or 0) < MIN_CAR:
                continue
            if source > target:
                source, target = target, source
            pair_id = row["UID of pair"].strip()
            network[pair_id] = (
                source,
                target,
                pair_id,
                float(row.get("score") or 0),
                float(row.get("dist_exp_known") or row.get("dist") or 1),
                float(row.get("known_reaction") or 0),
            )

    pair_rows: list[tuple] = []
    used_pairs: set[str] = set()
    with (ARBRE / "reactions_pairs.csv").open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            pair_id, reaction_id = row["UID of pair"].strip(), row["rxnUID"].strip()
            edge = network.get(pair_id)
            if edge is None or reaction_id not in valid_reactions:
                continue
            pair_rows.append((edge[0], edge[1], pair_id, reaction_id))
            used_pairs.add(pair_id)
            if len(pair_rows) >= 25_000:
                conn.executemany("INSERT OR IGNORE INTO pair_reactions VALUES (?,?,?,?)", pair_rows)
                pair_rows.clear()
    if pair_rows:
        conn.executemany("INSERT OR IGNORE INTO pair_reactions VALUES (?,?,?,?)", pair_rows)

    edge_rows = [network[pair_id] for pair_id in used_pairs]
    for chunk in batches(edge_rows):
        conn.executemany("INSERT OR IGNORE INTO edges VALUES (?,?,?,?,?,?)", chunk)
    conn.executescript(
        """
        CREATE INDEX idx_compounds_name ON compounds(name COLLATE NOCASE);
        CREATE INDEX idx_compounds_smiles ON compounds(smiles);
        CREATE INDEX idx_edges_target ON edges(target, source);
        CREATE INDEX idx_pair_reactions_pair ON pair_reactions(source, target);
        CREATE INDEX idx_pair_reactions_reaction ON pair_reactions(reaction_id);
        """
    )
    metadata = {
        "schema_version": "1",
        "upstream": "EPFL-LCSB/SubNetX v1.0",
        "upstream_commit": "b29e53217282ca8f39b8b83f2b41841ac53e0e59",
        "mode": "bounded_candidate_subnetwork_extraction_without_optimization",
        "compound_count": conn.execute("SELECT COUNT(*) FROM compounds").fetchone()[0],
        "host_metabolite_count": len(host_ids),
        "reaction_count": conn.execute("SELECT COUNT(*) FROM reactions").fetchone()[0],
        "edge_count": conn.execute("SELECT COUNT(*) FROM edges").fetchone()[0],
        "pair_reaction_count": conn.execute("SELECT COUNT(*) FROM pair_reactions").fetchone()[0],
        "ignored_boundary_ids": sorted(IGNORED_BOUNDARIES),
    }
    conn.executemany("INSERT INTO metadata VALUES (?,?)", ((key, json.dumps(value)) for key, value in metadata.items()))
    conn.commit()
    conn.execute("VACUUM")
    conn.close()
    print(json.dumps({"database": str(OUTPUT), "size": OUTPUT.stat().st_size, "sha256": sha256(OUTPUT), **metadata}))


if __name__ == "__main__":
    main()
