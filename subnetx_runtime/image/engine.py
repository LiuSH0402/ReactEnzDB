from __future__ import annotations

import json
import os
import sqlite3
import time
from itertools import islice
from pathlib import Path
from typing import Any

import networkx as nx
from rdkit import Chem, DataStructs, RDLogger
from rdkit.Chem import rdFingerprintGenerator


DATABASE = Path(os.environ.get("SUBNETX_DATABASE", "/runtime/subnetx/data/subnetx_extraction.sqlite"))
IGNORED_BOUNDARIES = {
    "1468093962", "1468141273", "1467879821", "1468034880", "1468083953",
    "1467881253", "1467873656", "1468339327", "1467869449", "1468141265",
}


class SubNetXEngine:
    def __init__(self, database: Path = DATABASE) -> None:
        if not database.is_file():
            raise FileNotFoundError(database)
        RDLogger.DisableLog("rdApp.*")
        self.database = database
        self.connection = sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.host_ids = {row[0] for row in self.connection.execute("SELECT compound_id FROM host_metabolites")}
        self.graph = nx.Graph()
        for row in self.connection.execute("SELECT source,target,pair_id,car,distance,known_reaction FROM edges"):
            existing = self.graph.get_edge_data(row["source"], row["target"])
            if existing is None or float(row["distance"]) < float(existing["distance"]):
                self.graph.add_edge(
                    row["source"], row["target"], pair_id=row["pair_id"],
                    car=float(row["car"]), distance=float(row["distance"]), known=float(row["known_reaction"]),
                )
        self.fingerprint_generator = rdFingerprintGenerator.GetMorganGenerator(radius=2, fpSize=1024)
        self.precursors: list[tuple[str, Any, Any, int]] = []
        placeholders = ",".join("?" for _ in self.host_ids)
        query = f"SELECT compound_id,smiles,atoms FROM compounds WHERE compound_id IN ({placeholders})"
        for row in self.connection.execute(query, tuple(self.host_ids)):
            molecule = Chem.MolFromSmiles(row["smiles"] or "")
            if molecule is not None and row["compound_id"] in self.graph:
                self.precursors.append((
                    row["compound_id"], molecule, self.fingerprint_generator.GetFingerprint(molecule), int(row["atoms"] or 0)
                ))
        self.metadata = {
            row["key"]: json.loads(row["value"])
            for row in self.connection.execute("SELECT key,value FROM metadata")
        }

    def health(self) -> dict[str, Any]:
        return {
            "status": "ok",
            "graph_nodes": self.graph.number_of_nodes(),
            "graph_edges": self.graph.number_of_edges(),
            "host_precursors": len(self.precursors),
            "mode": self.metadata.get("mode"),
        }

    def compound(self, compound_id: str) -> dict[str, Any] | None:
        row = self.connection.execute(
            "SELECT compound_id,name,formula,smiles,inchikey,atoms,carbons,molecular_weight FROM compounds WHERE compound_id=?",
            (compound_id,),
        ).fetchone()
        return dict(row) if row else None

    def search(self, query: str, limit: int = 10) -> list[dict[str, Any]]:
        query = query.strip()
        if not query:
            return []
        exact = self.connection.execute(
            "SELECT compound_id,name,formula,smiles,inchikey FROM compounds WHERE compound_id=? OR smiles=? OR inchikey=? LIMIT ?",
            (query, query, query.upper(), limit),
        ).fetchall()
        rows = list(exact)
        if len(rows) < limit:
            rows.extend(self.connection.execute(
                "SELECT compound_id,name,formula,smiles,inchikey FROM compounds WHERE name LIKE ? COLLATE NOCASE ORDER BY CASE WHEN lower(name)=lower(?) THEN 0 ELSE 1 END,name LIMIT ?",
                (f"%{query}%", query, limit - len(rows)),
            ).fetchall())
        seen: set[str] = set()
        return [dict(row) for row in rows if not (row["compound_id"] in seen or seen.add(row["compound_id"]))]

    def resolve_target(self, target: str) -> dict[str, Any]:
        target = target.strip()
        row = self.connection.execute(
            "SELECT compound_id FROM compounds WHERE compound_id=? OR smiles=? OR inchikey=? OR lower(name)=lower(?) LIMIT 1",
            (target, target, target.upper(), target),
        ).fetchone()
        if row is None:
            suggestions = self.search(target, 8)
            raise ValueError(json.dumps({"message": "Target is not an exact ARBRE compound match.", "suggestions": suggestions}))
        compound = self.compound(row["compound_id"])
        if compound is None or compound["compound_id"] not in self.graph:
            raise ValueError(json.dumps({"message": "The target exists in ARBRE but is not present in the filtered extraction graph."}))
        return compound

    def ranked_precursors(self, target_id: str, limit: int = 3) -> list[tuple[str, float]]:
        if target_id not in self.graph:
            return []
        target = self.compound(target_id)
        molecule = Chem.MolFromSmiles((target or {}).get("smiles") or "")
        if molecule is None:
            raise ValueError(json.dumps({"message": "The target has no usable molecular structure."}))
        target_fp = self.fingerprint_generator.GetFingerprint(molecule)
        target_atoms = molecule.GetNumAtoms()
        connected = nx.node_connected_component(self.graph, target_id)
        scores = [
            (compound_id, float(DataStructs.TanimotoSimilarity(target_fp, fingerprint)))
            for compound_id, _mol, fingerprint, atoms in self.precursors
            if atoms <= target_atoms and compound_id in connected
        ]
        scores.sort(key=lambda item: (-item[1], item[0]))
        return scores[:limit]

    def shortest_paths(self, target_id: str, path_count: int, max_path_length: int) -> tuple[list[list[str]], list[tuple[str, float]]]:
        precursors = self.ranked_precursors(target_id, 3)
        candidates: list[tuple[float, int, list[str]]] = []
        for precursor_id, _similarity in precursors:
            try:
                iterator = nx.shortest_simple_paths(self.graph, precursor_id, target_id, weight="distance")
                for path in islice(iterator, path_count):
                    if len(path) - 1 <= max_path_length:
                        weight = sum(float(self.graph[u][v]["distance"]) for u, v in zip(path, path[1:]))
                        candidates.append((weight, len(path), path))
            except (nx.NetworkXNoPath, nx.NodeNotFound):
                continue
        candidates.sort(key=lambda item: (item[0], item[1], item[2]))
        unique: list[list[str]] = []
        seen: set[tuple[str, ...]] = set()
        for _weight, _length, path in candidates:
            key = tuple(path)
            if key not in seen:
                seen.add(key)
                unique.append(path)
            if len(unique) >= path_count:
                break
        return unique, precursors

    def edge_reactions(self, source: str, target: str, alternatives: int = 1) -> list[dict[str, Any]]:
        if source > target:
            source, target = target, source
        rows = self.connection.execute(
            """
            SELECT r.reaction_id,r.compounds,r.stoichiometry,r.is_known
            FROM pair_reactions pr JOIN reactions r ON r.reaction_id=pr.reaction_id
            WHERE pr.source=? AND pr.target=?
            """,
            (source, target),
        ).fetchall()
        payload: list[dict[str, Any]] = []
        for row in rows:
            boundary = sorted(
                set((row["compounds"] or "").split(";"))
                - {source, target} - self.host_ids - IGNORED_BOUNDARIES - {""}
            )
            payload.append({
                "reaction_id": row["reaction_id"],
                "stoichiometry": row["stoichiometry"],
                "is_known": bool(row["is_known"]),
                "boundaries": boundary,
            })
        payload.sort(key=lambda item: (len(item["boundaries"]), not item["is_known"], item["reaction_id"]))
        return payload[:alternatives]

    def extract(self, target: str, path_count: int = 3, expansion_rounds: int = 1, max_nodes: int = 160) -> dict[str, Any]:
        started = time.monotonic()
        target_compound = self.resolve_target(target)
        target_id = target_compound["compound_id"]
        max_path_length = 24
        paths, precursors = self.shortest_paths(target_id, path_count, max_path_length)
        if not paths:
            raise ValueError(json.dumps({"message": "No bounded path from the selected E. coli precursors to this target was found."}))

        selected_edges: set[tuple[str, str]] = set()
        selected_paths: list[list[str]] = list(paths)
        for path in paths:
            selected_edges.update(tuple(sorted((u, v))) for u, v in zip(path, path[1:]))

        rounds_completed = 0
        truncated = False
        for _round in range(expansion_rounds + 1):
            annotations = {
                edge: self.edge_reactions(edge[0], edge[1], 1)
                for edge in sorted(selected_edges)
            }
            unresolved = sorted({
                boundary
                for reactions in annotations.values()
                for reaction in reactions
                for boundary in reaction["boundaries"]
                if boundary not in {node for edge in selected_edges for node in edge}
            })
            if _round >= expansion_rounds or not unresolved:
                break
            added = False
            for boundary in unresolved[:8]:
                boundary_paths, _ = self.shortest_paths(boundary, 1, max_path_length)
                if not boundary_paths:
                    continue
                path = boundary_paths[0]
                prospective = selected_edges | {tuple(sorted((u, v))) for u, v in zip(path, path[1:])}
                prospective_nodes = {node for edge in prospective for node in edge}
                if len(prospective_nodes) > max_nodes:
                    truncated = True
                    continue
                selected_edges = prospective
                selected_paths.append(path)
                added = True
            rounds_completed += 1
            if not added:
                break

        annotations = {edge: self.edge_reactions(edge[0], edge[1], 1) for edge in sorted(selected_edges)}
        nodes = sorted({node for edge in selected_edges for node in edge})
        compounds = {compound_id: self.compound(compound_id) for compound_id in nodes}
        unresolved = sorted({
            boundary
            for reactions in annotations.values()
            for reaction in reactions
            for boundary in reaction["boundaries"]
            if boundary not in nodes and boundary not in self.host_ids
        })
        reaction_ids = sorted({reaction["reaction_id"] for reactions in annotations.values() for reaction in reactions})
        return {
            "tool": "subnetx",
            "mode": "bounded_candidate_subnetwork_extraction",
            "target": target_compound,
            "host": "Escherichia coli",
            "selected_precursors": [
                {**(self.compound(compound_id) or {"compound_id": compound_id}), "similarity": similarity}
                for compound_id, similarity in precursors
            ],
            "core_paths": [[compounds[node] for node in path if node in compounds] for path in paths],
            "network": {
                "node_count": len(nodes),
                "edge_count": len(selected_edges),
                "reaction_count": len(reaction_ids),
                "nodes": [compounds[node] for node in nodes],
                "edges": [
                    {"source": source, "target": target_node, "reactions": annotations[(source, target_node)]}
                    for source, target_node in sorted(selected_edges)
                ],
            },
            "unresolved_boundaries": [self.compound(value) or {"compound_id": value} for value in unresolved[:50]],
            "expansion_rounds_completed": rounds_completed,
            "truncated": truncated or len(unresolved) > 50,
            "elapsed_seconds": round(time.monotonic() - started, 3),
            "note": "Candidate extraction only: no CPLEX optimization, yield ranking, or final stoichiometric/thermodynamic feasibility claim.",
        }
