from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "web_release" / "reactenzdb_web.db"


def connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    args = parser.parse_args()
    conn = connect(args.db)

    conn.executescript(
        """
        CREATE VIRTUAL TABLE IF NOT EXISTS web_reactions_fts USING fts5(
            reaction_id,
            reaction_equation_display,
            reaction_equation_raw,
            ec_number,
            rhea_id,
            kegg_reaction_id,
            metacyc_reaction_id,
            content='web_reactions',
            content_rowid='rowid'
        );

        INSERT INTO web_reactions_fts(web_reactions_fts) VALUES('rebuild');

        CREATE VIRTUAL TABLE IF NOT EXISTS web_enzymes_fts USING fts5(
            biopart_id,
            enzyme_name,
            gene_name_primary,
            organism,
            protein_id,
            content='web_enzymes',
            content_rowid='rowid'
        );

        INSERT INTO web_enzymes_fts(web_enzymes_fts) VALUES('rebuild');

        CREATE INDEX IF NOT EXISTS idx_web_reactions_pair_count ON web_reactions(enzyme_pair_count DESC);
        CREATE INDEX IF NOT EXISTS idx_web_reaction_enzymes_sequence ON web_reaction_enzymes(has_sequence, sequence_length);
        CREATE INDEX IF NOT EXISTS idx_web_kinetics_param ON web_kinetics(parameter_type);
        ANALYZE;
        """
    )
    conn.commit()
    print("optimized")
    conn.close()


if __name__ == "__main__":
    main()
