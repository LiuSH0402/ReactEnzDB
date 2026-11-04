"""Verify the recorded file hashes of the prepared code package (read-only)."""
import hashlib
import json
from pathlib import Path

def main():
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root / "CODE_PROVENANCE.json").read_text(encoding="utf-8"))
    failures = []
    for entry in manifest["files"]:
        path = root / entry["path"]
        if not path.is_file():
            failures.append({"path": entry["path"], "reason": "missing"})
            continue
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != entry["sha256"]:
            failures.append({"path": entry["path"], "reason": "sha256_mismatch"})
    print(json.dumps({"files_checked": len(manifest["files"]), "failures": failures,
                      "scope": "File integrity only; does not establish licence clearance or scientific validity."},
                     ensure_ascii=False, indent=2))
    raise SystemExit(1 if failures else 0)

if __name__ == "__main__":
    main()
