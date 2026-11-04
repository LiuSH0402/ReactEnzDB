#!/usr/bin/env python3
"""Build the public registry for third-party retrosynthesis tools and resources."""

from __future__ import annotations
import os

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = Path(os.environ.get("RETROSYNTHESIS_DATA_ROOT", ROOT / "inputs" / "retrosynthesis"))
RELEASE_DIR = ROOT / "web_release"


def project_dir(prefix: str, nested: str | None = None) -> Path:
    matches = sorted(path for path in DATA_ROOT.glob(f"{prefix}*") if path.is_dir())
    if not matches:
        return DATA_ROOT / prefix
    return matches[0] / nested if nested else matches[0]


def file_record(path: Path, public_name: str) -> dict[str, object]:
    if not path.is_file():
        return {"file": public_name, "available_in_local_audit": False}
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return {
        "file": public_name,
        "available_in_local_audit": True,
        "size_bytes": path.stat().st_size,
        "sha256": digest.hexdigest(),
        "redistributed_by_reactenzdb": False,
    }


def registry() -> dict[str, object]:
    gse_checkpoint = project_dir("GSETRetro-main", "GSETRetro-main") / "GSETransformer" / "experiments" / "biochem_npl_20xaug" / "model_best_acc_step_355000_avg.pt"
    read_checkpoint = project_dir("READRetro-main") / "g2s" / "saved_models" / "biochem.pt"
    bionavi_checkpoint = project_dir("BioNavi-NP-main", "BioNavi-NP-main") / "singlestep" / "checkpoints" / "np-like" / "model_step_100000.pt"
    return {
        "registry_version": "1.0",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "release_version": "2026.08",
        "policy": {
            "prediction_is_not_evidence": True,
            "score_policy": "Scores and ranks are model-specific and are not calibrated probabilities or comparable across tools.",
            "mapping_policy": "ReactEnzDB assigns enzyme candidates only after a separate exact or explicitly labelled contextual reaction match.",
            "redistribution_policy": "Third-party code and model weights are not included in ReactEnzDB downloads unless their redistribution terms are independently verified.",
            "taxonomy": {
                "live_single_step_predictor": "A local CPU adapter executes one upstream single-step model component.",
                "rule_and_activity_resource": "Source-attributed rules or activity records are browsable/downloadable; no upstream planner is executed.",
                "case_study_subnetwork_resource": "Published pathway/subnetwork outputs are browsable/downloadable; no optimization job is executed.",
            },
        },
        "tools": [
            {
                "tool_id": "gsetretro",
                "name": "GSETRetro / GSETransformer",
                "capability_class": "live_single_step_predictor",
                "reactenzdb_status": "local_cpu_adapter_verified",
                "reactenzdb_scope": "Runs only the GSETransformer biochemical/natural-product single-step checkpoint. The upstream GUI enzyme/EC module and multi-step planner are not exposed.",
                "input": "One target molecule as SMILES.",
                "output": "Ranked precursor SMILES proposed by the upstream single-step model.",
                "upstream_repository": "https://github.com/momozhangcn/GSETRetro",
                "upstream_head_observed": "5bcc0be90dd3ab7c2177c8873db96abdc34395d8",
                "source_snapshot_note": "The local source is an archive without Git metadata; equivalence to the observed upstream HEAD is not claimed.",
                "paper": {
                    "citation": "Cong S, Zhang M, Song Y, et al. Graph-sequence enhanced transformer for template-free prediction of natural product biosynthesis. Patterns. 2025;6:101259.",
                    "doi": "10.1016/j.patter.2025.101259",
                },
                "software_archive": "https://doi.org/10.5281/zenodo.15023160",
                "code_license": {"status": "verified", "spdx": "MIT", "source": "upstream LICENSE"},
                "model_weights_license": {"status": "not_separately_stated", "deployment_action": "confirm upstream model-weight terms before public service deployment"},
                "checkpoint": file_record(gse_checkpoint, "model_best_acc_step_355000_avg.pt"),
                "enzyme_mapping": "Not emitted by the deployed adapter. ReactEnzDB performs a separate reaction match after prediction.",
            },
            {
                "tool_id": "readretro",
                "name": "READRetro",
                "capability_class": "live_single_step_predictor",
                "reactenzdb_status": "local_cpu_adapter_verified",
                "reactenzdb_scope": "Runs only the Graph2SMILES biochemical checkpoint. The full dual-view ensemble, retrievers, and multi-step Retro* workflow are not exposed.",
                "input": "One target molecule as SMILES.",
                "output": "Ranked precursor SMILES proposed by the Graph2SMILES component.",
                "upstream_repository": "https://github.com/SeulLee05/READRetro",
                "upstream_head_observed": "4a5b77c886cb4feb788d97aaa4c1b003b0c388b0",
                "source_snapshot_note": "The local source is an archive without Git metadata; equivalence to the observed upstream HEAD is not claimed.",
                "paper": {
                    "citation": "Kim T, Lee S, Kwak Y, et al. READRetro: natural product biosynthesis predicting with retrieval-augmented dual-view retrosynthesis. New Phytologist. 2024;243:2512-2527.",
                    "doi": "10.1111/nph.20012",
                },
                "data_archive": "https://doi.org/10.5281/zenodo.11485641",
                "code_license": {"status": "verified", "spdx": "MIT", "source": "upstream LICENSE"},
                "model_weights_license": {"status": "not_separately_stated", "deployment_action": "confirm Zenodo checkpoint terms before public service deployment"},
                "checkpoint": file_record(read_checkpoint, "g2s/saved_models/biochem.pt"),
                "enzyme_mapping": "Not emitted by the deployed component. ReactEnzDB performs a separate reaction match after prediction.",
            },
            {
                "tool_id": "bionavi_np",
                "name": "BioNavi-NP",
                "capability_class": "live_single_step_predictor",
                "reactenzdb_status": "local_cpu_adapter_verified_permission_pending",
                "reactenzdb_scope": "Runs one np-like OpenNMT checkpoint only. It is not the published four-checkpoint ensemble and does not expose the upstream multi-step Retro* planner.",
                "input": "One target molecule as SMILES.",
                "output": "Ranked precursor SMILES; this adapter does not receive a calibrated score from the upstream command.",
                "upstream_repository": "https://github.com/prokia/BioNavi-NP",
                "upstream_head_observed": "8350a4dc8ca262154787d6a3055ba75bd4e0c746",
                "source_snapshot_note": "The local source is an archive without Git metadata; equivalence to the observed upstream HEAD is not claimed.",
                "paper": {
                    "citation": "Zheng S, Zeng T, Li C, et al. Deep learning driven biosynthetic pathways navigation for natural products with BioNavi-NP. Nature Communications. 2022;13:3342.",
                    "doi": "10.1038/s41467-022-30970-9",
                },
                "code_license": {"status": "not_found_at_upstream_root", "spdx": None, "deployment_action": "obtain author permission or an explicit license before public deployment"},
                "model_weights_license": {"status": "not_separately_stated", "deployment_action": "obtain explicit permission before public deployment"},
                "checkpoint": file_record(bionavi_checkpoint, "np-like/model_step_100000.pt"),
                "enzyme_mapping": "Not emitted by the deployed component. ReactEnzDB performs a separate reaction match after prediction.",
            },
            {
                "tool_id": "retrobiocat",
                "name": "RetroBioCat",
                "capability_class": "live_rule_based_planner",
                "reactenzdb_status": "bounded_cpu_pathway_planner_verified",
                "reactenzdb_scope": "Executes a bounded one-to-three-step RetroBioCat biocatalytic rule network and returns ranked routes with enzyme classes, cofactors, and purchasable end-material scores. The legacy Flask administration and user-account system, MongoDB activity scoring, and AiZynthFinder chemical policy model are not exposed.",
                "input": "One target molecule as SMILES, a maximum pathway length of one to three steps, and the number of routes to return.",
                "output": "Ranked rule-based biocatalytic pathways with reaction names, precursor SMILES, enzyme classes, cofactors, and starting-material availability scores.",
                "upstream_repository": "https://doi.org/10.6084/m9.figshare.12698072.v7",
                "paper": {
                    "citation": "Finnigan W, Hepworth LJ, Flitsch SL, Turner NJ. RetroBioCat as a computer-aided synthesis planning tool for biocatalytic reactions and cascades. Nature Catalysis. 2021;4:98-104.",
                    "doi": "10.1038/s41929-020-00556-z",
                },
                "code_license": {"status": "verified", "spdx": "MIT", "source": "Figshare software v7"},
                "data_license": {"status": "verified", "spdx": "CC-BY-4.0", "source": "Figshare database files v7", "doi": "10.6084/m9.figshare.12696482.v7"},
                "enzyme_mapping": "Generic assay labels and enzyme types are retained as source metadata and are not forced onto UniProt-level ReactEnzDB enzymes.",
            },
            {
                "tool_id": "subnetx",
                "name": "SubNetX",
                "capability_class": "bounded_candidate_subnetwork_extractor",
                "reactenzdb_status": "cplex_free_candidate_extractor_verified",
                "reactenzdb_scope": "Runs a bounded, source-attributed candidate subnetwork extraction against the ARBRE graph for E. coli. It returns core paths, reaction-linked graph statistics, and unresolved boundary compounds; it does not run CPLEX optimization, yield ranking, or claim final stoichiometric or thermodynamic feasibility.",
                "input": "An exact ARBRE/LCSB compound ID, common name, InChIKey, or exact SMILES; one to five core paths; and zero or one bounded boundary-expansion round.",
                "output": "Candidate core paths and a capped reaction subnetwork with source compound/reaction identifiers and unresolved boundaries.",
                "upstream_repository": "https://github.com/EPFL-LCSB/SubNetX",
                "upstream_release": "v1.0",
                "upstream_snapshot_commit": "b29e53217282ca8f39b8b83f2b41841ac53e0e59",
                "paper": {
                    "citation": "Sveshnikova A, Oftadeh O, Hatzimanikatis V. Designing pathways for bioproducing complex chemicals by combining tools for pathway extraction and ranking. Nature Communications. 2025;16:4839.",
                    "doi": "10.1038/s41467-025-59827-7",
                },
                "code_license": {"status": "verified", "spdx": "MIT", "source": "upstream LICENSE"},
                "data_license": {"status": "verified", "spdx": "CC-BY-4.0", "source": "Zenodo v1", "doi": "10.5281/zenodo.15119707"},
                "extraction_data_provenance": {"source": "ARBRE files bundled with the SubNetX v1.0 repository", "license_status": "no separate machine-readable license observed in the ARBRE data folder; retain upstream attribution and review before commercial reuse"},
                "runtime_dependency_note": "The deployed extraction stage uses no CPLEX. Full upstream host-model optimization and ranking used ILOG CPLEX and remains outside the service scope.",
                "enzyme_mapping": "Case-level pathways are not forced onto ReactEnzDB reactions without exact reaction identifiers or defensible structure reconciliation.",
            },
        ],
    }


def markdown(data: dict[str, object]) -> str:
    lines = [
        "# ReactEnzDB retrosynthesis tool registry",
        "",
        "This registry separates live single-step adapters, bounded pathway and subnetwork services, and published resources.",
        "Model output is not experimental evidence, model scores are not comparable across tools, and third-party",
        "weights are not redistributed by ReactEnzDB.",
        "",
        "| Tool | ReactEnzDB role | Current scope | Code license | Public deployment |",
        "|---|---|---|---|---|",
    ]
    for tool in data["tools"]:
        license_name = tool.get("code_license", {}).get("spdx") or "not specified"
        lines.append(
            f"| {tool['name']} | {tool['capability_class']} | {tool['reactenzdb_scope']} | "
            f"{license_name} | {tool['reactenzdb_status']} |"
        )
    lines.extend(["", "See the JSON registry for checkpoint hashes, citations, source versions, and detailed restrictions.", ""])
    return "\n".join(lines)


def main() -> None:
    data = registry()
    RELEASE_DIR.mkdir(parents=True, exist_ok=True)
    (RELEASE_DIR / "RETROSYNTHESIS_TOOL_REGISTRY.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (RELEASE_DIR / "RETROSYNTHESIS_TOOL_REGISTRY.md").write_text(markdown(data), encoding="utf-8")
    print(json.dumps({"tools": len(data["tools"]), "output": str(RELEASE_DIR / "RETROSYNTHESIS_TOOL_REGISTRY.json")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
