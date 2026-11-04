#!/usr/bin/env python3
import argparse
import json
import sqlite3
import sys

ALLOWED_TABLES = {"web_reactions_fts", "web_enzymes_fts"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    parser.add_argument("--table", required=True)
    parser.add_argument("--query", required=True)
    parser.add_argument("--limit", type=int, default=2000)
    args = parser.parse_args()
    if args.table not in ALLOWED_TABLES:
        print(json.dumps({"rowids": [], "error": "unsupported table"}))
        raise SystemExit(0)
    conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    enabled = conn.execute("SELECT sqlite_compileoption_used('ENABLE_FTS5')").fetchone()[0]
    if not enabled:
        print(json.dumps({"rowids": [], "error": "fts5 unavailable"}))
        raise SystemExit(0)
    limit = max(1, min(int(args.limit), 5000))
    sql = f"SELECT rowid FROM {args.table} WHERE {args.table} MATCH ? LIMIT ?"
    rowids = [int(row[0]) for row in conn.execute(sql, (args.query, limit)).fetchall()]
    print(json.dumps({"rowids": rowids}))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"rowids": [], "error": str(exc)}), file=sys.stderr)
        raise SystemExit(1)
