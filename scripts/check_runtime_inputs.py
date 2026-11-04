"""Read-only validation of runtime inputs; never invent missing provenance columns."""
import argparse, hashlib, json, sqlite3
from pathlib import Path

def inspect(core, evidence=None):
    result = {"core_exists": core.is_file(), "core_compatible": False,
              "evidence_available": False, "missing": []}
    if core.is_file():
        c = sqlite3.connect(core.resolve().as_uri()+"?mode=ro", uri=True)
        required = {"web_reactions": {"reaction_id", "source_db"},
                    "web_enzymes": {"biopart_id", "protein_sequence"},
                    "web_reaction_enzymes": {"reaction_id", "biopart_id", "source_db"},
                    "web_kinetics": {"kinetic_id", "source_db"}}
        for table, columns in required.items():
            actual = {row[1] for row in c.execute('PRAGMA table_info("'+table+'")')}
            result["missing"].extend(table+"."+col for col in sorted(columns-actual))
        result["core_compatible"] = not result["missing"]
        c.close()
    if evidence and evidence.is_file():
        c = sqlite3.connect(evidence.resolve().as_uri()+"?mode=ro", uri=True)
        actual = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        result["evidence_available"] = {"assertions", "assertion_enzyme_links", "measurements", "citations"} <= actual
        c.close()
    result["full_evidence_workflow_inputs_present"] = result["core_compatible"] and result["evidence_available"]
    result["scope"] = "Minimal schema preflight only; does not validate all optional data, provenance rights, scientific accuracy or full functionality."
    return result

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--core", type=Path, required=True)
    p.add_argument("--evidence", type=Path)
    a = p.parse_args()
    result = inspect(a.core, a.evidence)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result["full_evidence_workflow_inputs_present"] else 2)

if __name__ == "__main__":
    main()
