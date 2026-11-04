#!/usr/bin/env python
"""Build the atomic derived exact and protonation-normalized reaction lookup."""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "nextjs_site/Nicktio-nextjs-pro-main/package/scripts"))
from retrosynthesis_mapping import build_index


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "web_release/reactenzdb_web.db")
    parser.add_argument("--output", type=Path, default=ROOT / "web_release/retrosynthesis_reaction_lookup.sqlite")
    args = parser.parse_args()
    print(json.dumps(build_index(args.source, args.output)))
