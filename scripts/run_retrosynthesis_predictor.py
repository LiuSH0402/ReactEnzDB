#!/usr/bin/env python
"""Run one locally reproduced single-step retrosynthesis predictor on CPU.

The script is intentionally a small process boundary for the web app.  It
loads one model per request, emits one JSON payload, and does not mutate the
third-party project directories or their checkpoints.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


DATA_ROOT = Path(__file__).resolve().parents[1] / "inputs" / "retrosynthesis"


# The deployment uses an ASCII-only mounted path.  Keep the environment
# override so local audits can continue to point at the original data tree.
DEFAULT_DATA_ROOT = Path(__file__).resolve().parents[1] / "predictor_data"
DATA_ROOT = Path(os.environ.get("RETROSYNTHESIS_DATA_ROOT", DEFAULT_DATA_ROOT)).resolve()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tool", choices=("gsetretro", "readretro", "bionavi_np"), required=True)
    parser.add_argument("--target", required=True, help="Target molecule as a single valid SMILES string.")
    parser.add_argument("--top-k", type=int, default=5)
    return parser.parse_args()


def project_dir(prefix: str, nested_name: str) -> Path:
    candidates = sorted(path for path in DATA_ROOT.glob(f"{prefix}*") if path.is_dir())
    for candidate in candidates:
        nested = candidate / nested_name
        if nested.is_dir():
            return nested
        if candidate.name.startswith(nested_name):
            return candidate
    raise FileNotFoundError(f"Local project directory not found for {nested_name} under {DATA_ROOT}")


def canonical_smiles(value: str) -> str:
    from rdkit import Chem

    molecule = Chem.MolFromSmiles(value)
    if molecule is None:
        raise ValueError("target must be a valid single-molecule SMILES string")
    return Chem.MolToSmiles(molecule, isomericSmiles=True)


def canonical_precursors(value: str) -> str:
    from rdkit import Chem

    fragments: list[str] = []
    for fragment in value.split("."):
        molecule = Chem.MolFromSmiles(fragment)
        if molecule is None:
            return value
        fragments.append(Chem.MolToSmiles(molecule, isomericSmiles=True))
    return ".".join(fragments)


def normalize_predictions(reactants: list[Any], scores: list[Any], top_k: int) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    seen: set[str] = set()
    for reactant, score in zip(reactants, scores):
        if not isinstance(reactant, str) or not reactant.strip():
            continue
        precursor_smiles = canonical_precursors(reactant)
        if precursor_smiles in seen:
            continue
        seen.add(precursor_smiles)
        output.append(
            {
                "rank": len(output) + 1,
                "precursor_smiles": precursor_smiles,
                "score": round(float(score), 6) if score is not None else None,
            }
        )
        if len(output) >= top_k:
            break
    return output


def run_gsetretro(target: str, top_k: int) -> list[dict[str, Any]]:
    root = project_dir("GSETRetro-main", "GSETRetro-main")
    model = root / "GSETransformer" / "experiments" / "biochem_npl_20xaug" / "model_best_acc_step_355000_avg.pt"
    if not model.is_file():
        raise FileNotFoundError(f"GSETRetro checkpoint not found: {model}")
    os.environ.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")
    # The upstream translator always creates ``temp.txt`` in its current
    # directory.  Run it in an ephemeral writable location so the mounted
    # third-party source tree and checkpoint can remain read-only.
    sys.path.insert(0, str(root))
    sys.path.insert(0, str(root / "GSETransformer"))
    # GSETransformer creates an OpenNMT translator at import time.  OpenNMT
    # parses sys.argv itself, so do not expose this wrapper's CLI flags to it.
    sys.argv = [sys.argv[0]]
    from GSETransformer.translate_multi_step import prepare_GSET_translator, run_GSET_translate

    with tempfile.TemporaryDirectory(prefix="reactenzdb-gsetretro-") as temp_dir:
        os.chdir(temp_dir)
        translator, options = prepare_GSET_translator(str(model), max(3, top_k), top_k, False)
        raw = run_GSET_translate(target, translator, options)
        if not isinstance(raw, dict):
            raise RuntimeError("GSETRetro returned an unexpected prediction payload")
        return normalize_predictions(list(raw.get("reactants") or []), list(raw.get("scores") or []), top_k)


def run_readretro(target: str, top_k: int) -> list[dict[str, Any]]:
    root = project_dir("READRetro-main", "READRetro-main")
    model_path = root / "g2s" / "saved_models" / "biochem.pt"
    vocab_path = root / "g2s" / "saved_models" / "vocab_smiles.txt"
    if not model_path.is_file() or not vocab_path.is_file():
        raise FileNotFoundError("READRetro Graph2SMILES checkpoint or vocabulary is missing")
    os.chdir(root)
    sys.path.insert(0, str(root))
    # The released checkpoint records CUDA storage locations even when the
    # caller requests CPU inference.  Force checkpoint tensors onto CPU so a
    # CPU-only PyTorch build can deserialize it.
    import torch

    original_torch_load = torch.load

    def cpu_torch_load(*args: Any, **kwargs: Any) -> Any:
        kwargs.setdefault("map_location", torch.device("cpu"))
        return original_torch_load(*args, **kwargs)

    torch.load = cpu_torch_load
    from g2s.translate import prepare_g2s, run_g2s

    model, args, vocab, vocab_tokens, device = prepare_g2s(
        cuda=False,
        beam_size=max(20, top_k * 4),
        expansion_topk=top_k,
        path=str(model_path),
        vocab_path=str(vocab_path),
    )
    raw = run_g2s(model, args, target, vocab, vocab_tokens, device)
    return normalize_predictions(list(raw.get("reactants") or []), list(raw.get("scores") or []), top_k)


def run_bionavi_np(target: str, top_k: int) -> list[dict[str, Any]]:
    root = project_dir("BioNavi-NP-main", "BioNavi-NP-main")
    single_step = root / "singlestep"
    checkpoint = single_step / "checkpoints" / "np-like" / "model_step_100000.pt"
    if not checkpoint.is_file():
        raise FileNotFoundError(f"BioNavi-NP checkpoint not found: {checkpoint}")

    with tempfile.TemporaryDirectory(prefix="reactenzdb-bionavi-np-") as temp_dir:
        temp = Path(temp_dir)
        source = temp / "source.txt"
        output = temp / "predictions.txt"
        source.write_text(f"{target}\n", encoding="utf-8")
        onmt_translate = shutil.which("onmt_translate") or str(Path(sys.executable).with_name("onmt_translate.exe"))
        command = [
            onmt_translate,
            "-model",
            str(checkpoint),
            "-src",
            str(source),
            "-output",
            str(output),
            "-batch_size",
            "1",
            "-max_length",
            "200",
            "-beam_size",
            str(top_k),
            "-n_best",
            str(top_k),
            "-replace_unk",
        ]
        completed = subprocess.run(command, cwd=single_step, capture_output=True, text=True, timeout=100, check=False)
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout or "BioNavi-NP inference failed").strip()
            raise RuntimeError(detail[-1200:])
        predictions = [line.strip().replace(" ", "") for line in output.read_text(encoding="utf-8").splitlines() if line.strip()]
    return normalize_predictions(predictions, [None] * len(predictions), top_k)


def main() -> int:
    args = parse_args()
    top_k = max(1, min(int(args.top_k), 10))
    target = canonical_smiles(args.target.strip())
    runners = {
        "gsetretro": run_gsetretro,
        "readretro": run_readretro,
        "bionavi_np": run_bionavi_np,
    }
    # Third-party stacks emit progress and compatibility warnings to stdout.
    # Keep stdout machine-readable for the Next.js API route.
    with contextlib.redirect_stdout(sys.stderr):
        predictions = runners[args.tool](target, top_k)
    print(
        json.dumps(
            {
                "tool": args.tool,
                "target_smiles": target,
                "mode": "single_step_cpu",
                "predictions": predictions,
                "note": "Predicted precursor sets are computational suggestions and require experimental validation.",
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
