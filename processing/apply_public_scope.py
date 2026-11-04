"""Filter a disposable local copy using an explicit separately supplied policy."""
import argparse
import json
from pathlib import Path
import shutil
from processing.scope_filter import sets, filter_db, validate_db

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--policy", type=Path, required=True)
    a = p.parse_args()
    if not a.source.is_file() or not a.policy.is_file():
        p.error("Source and policy must be existing files")
    if a.output.exists() or a.output.resolve() == a.source.resolve():
        p.error("Output must be a new disposable copy")
    policy = sets(json.loads(a.policy.read_text(encoding="utf-8")))
    a.output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(a.source, a.output)
    changes = filter_db(a.output, policy, a.output.parent)
    validate_db(a.output, policy)
    print(json.dumps({"deleted_rows": changes, "scope_validated": True,
                      "derived_statistics_rebuilt": False}))

if __name__ == "__main__":
    main()
