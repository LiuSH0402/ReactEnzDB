from __future__ import annotations

import argparse
import contextlib
import json
import os
import sys
import types
from pathlib import Path
from typing import Any


SOURCE_ROOT = Path(os.environ.get("RETROBIOCAT_SOURCE_ROOT", "/runtime/retrobiocat/source")).resolve()
RULES_YAML = Path(os.environ.get("RETROBIOCAT_RULES_YAML", "/runtime/retrobiocat/data/rxns_yaml.yaml")).resolve()
BUILDING_BLOCKS_DB = Path(
    os.environ.get("RETROBIOCAT_BUILDING_BLOCKS_DB", "/runtime/retrobiocat/data/building_blocks.db")
).resolve()


def install_optional_dependency_stubs() -> None:
    load_from_mongo = types.ModuleType("retrobiocat_web.retro.generation.load.load_from_mongo")
    load_from_mongo.get_reactions = lambda *args, **kwargs: []
    sys.modules[load_from_mongo.__name__] = load_from_mongo

    specificity = types.ModuleType("retrobiocat_web.retro.enzyme_identification.molecular_similarity")

    class SubstrateSpecificityScorer:
        score_substrates = False

        def scoreReaction(self, *args: Any, **kwargs: Any) -> tuple[int, bool]:
            return 0, False

    specificity.SubstrateSpecificityScorer = SubstrateSpecificityScorer
    sys.modules[specificity.__name__] = specificity

    aizynthfinder = types.ModuleType(
        "retrobiocat_web.retro.generation.retrosynthesis_engine.aizynthfinder_actions"
    )
    aizynthfinder.aizynth_action_applier = object()
    sys.modules[aizynthfinder.__name__] = aizynthfinder

    visualise = types.ModuleType("retrobiocat_web.retro.visualisation.visualise")

    class DisabledVisualiser:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            raise RuntimeError("The legacy notebook visualiser is not enabled in the API runtime.")

    visualise.Visualiser = DisabledVisualiser
    sys.modules[visualise.__name__] = visualise


def scalar(value: Any) -> int | float | str | bool | None:
    if value is None or isinstance(value, (int, float, str, bool)):
        return value
    if hasattr(value, "item"):
        return value.item()
    return str(value)


def plan(target: str, steps: int, top_k: int, max_nodes: int) -> dict[str, Any]:
    if not SOURCE_ROOT.is_dir() or not RULES_YAML.is_file() or not BUILDING_BLOCKS_DB.is_file():
        raise FileNotFoundError("RetroBioCat source, reaction rules, or building-block database is missing.")
    sys.path.insert(0, str(SOURCE_ROOT))

    import numpy as np

    np.bool = np.bool_
    install_optional_dependency_stubs()

    from retrobiocat_web.retro.evaluation.starting_material import StartingMaterialEvaluator
    from retrobiocat_web.retro.generation.load.rxn_class import RetroBioCat_Reactions
    import retrobiocat_web.retro.generation.network_generation.network as network_module
    from retrobiocat_web.retro.generation.pathway_generation.best_first_search import BFS

    StartingMaterialEvaluator.sqlite_db_path = str(BUILDING_BLOCKS_DB)

    def yaml_reactions(*args: Any, **kwargs: Any) -> RetroBioCat_Reactions:
        return RetroBioCat_Reactions(mode="yaml", yaml_path=str(RULES_YAML))

    network_module.RetroBioCat_Reactions = yaml_reactions
    network = network_module.Network(max_nodes=max_nodes, print_log=False)
    network.settings.update(
        {
            "calculate_substrate_specificity": False,
            "specificity_score_substrates": False,
            "get_building_blocks": True,
            "max_nodes": max_nodes,
            "max_reactions": 10,
            "remove_simple": True,
            "include_experimental": False,
            "include_two_step": False,
        }
    )
    graph = network.generate(target, steps, calculate_scores=True)
    bfs = BFS(
        network=network,
        max_pathways=max(100, min(2500, top_k * 200)),
        max_pathway_length=steps,
        min_weight=1,
        use_random=False,
        score_pathways=True,
    )
    bfs.run()
    pathways = bfs.get_pathways()
    pathways.sort(
        key=lambda pathway: (
            float(pathway.scores.starting_material),
            float(pathway.scores.change_in_complexity),
            -int(pathway.scores.num_enzyme_steps),
        ),
        reverse=True,
    )

    results: list[dict[str, Any]] = []
    for rank, pathway in enumerate(pathways[:top_k], start=1):
        reaction_steps: list[dict[str, Any]] = []
        for reaction_node in pathway.reactions:
            attributes = graph.nodes[reaction_node]["attributes"]
            product_nodes = list(graph.predecessors(reaction_node))
            substrate_nodes = list(graph.successors(reaction_node))
            reaction_steps.append(
                {
                    "reaction": attributes.get("name", str(reaction_node)),
                    "product_smiles": product_nodes[0] if product_nodes else None,
                    "substrate_smiles": substrate_nodes,
                    "selected_enzyme": attributes.get("selected_enzyme"),
                    "possible_enzymes": list(attributes.get("possible_enzymes") or []),
                    "enzyme_cofactors": attributes.get("enzyme_cofactors") or {},
                }
            )
        reaction_steps.sort(
            key=lambda item: len(__import__("networkx").shortest_path(graph, network.target_smiles, item["product_smiles"]))
            if item["product_smiles"] in graph
            else 999
        )
        results.append(
            {
                "rank": rank,
                "end_materials": list(pathway.end_nodes),
                "steps": reaction_steps,
                "scores": {key: scalar(value) for key, value in pathway.scores.scores_dict().items()},
            }
        )

    return {
        "tool": "retrobiocat",
        "target_smiles": network.target_smiles,
        "mode": "rule_based_pathway_cpu",
        "requested_steps": steps,
        "network": {
            "nodes": graph.number_of_nodes(),
            "edges": graph.number_of_edges(),
            "substrates": len(network.substrate_nodes),
            "reactions": len(network.reaction_nodes),
        },
        "pathways": results,
        "note": "Rule-based pathway proposals require expert review and experimental validation.",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the RetroBioCat rule-based pathway planner on CPU.")
    parser.add_argument("--target", required=True)
    parser.add_argument("--steps", type=int, default=2)
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--max-nodes", type=int, default=150)
    args = parser.parse_args()
    with contextlib.redirect_stdout(sys.stderr):
        payload = plan(
            args.target.strip(),
            max(1, min(args.steps, 3)),
            max(1, min(args.top_k, 10)),
            max(25, min(args.max_nodes, 250)),
        )
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
