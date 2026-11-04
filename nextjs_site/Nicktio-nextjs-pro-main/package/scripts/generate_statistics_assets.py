from __future__ import annotations

import json
import argparse
import hashlib
import math
import sqlite3
from datetime import datetime, timezone
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
PACKAGE = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "web_release" / "reactenzdb_web.db"
OUT_DIR = PACKAGE / "public" / "reactenzdb" / "statistics"

PALETTE = {
    "blue": "#2f6fed",
    "blue_light": "#dce8ff",
    "teal": "#2aa198",
    "green": "#42b883",
    "amber": "#d99a2b",
    "red": "#c94f4f",
    "slate": "#63738a",
    "ink": "#0d2b45",
    "grid": "#e8eef6",
}


def query(con: sqlite3.Connection, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
    return con.execute(sql, params).fetchall()


def scalar(con: sqlite3.Connection, sql: str, params: tuple = ()) -> int:
    value = con.execute(sql, params).fetchone()[0]
    return int(value or 0)


def count_rows(rows: list[sqlite3.Row], key: str = "count") -> list[dict]:
    return [dict(row) for row in rows if row[key] is not None]


def pct(value: int, total: int) -> float:
    return round((value / total * 100), 2) if total else 0.0


def load_release_json(filename: str) -> dict:
    file_path = ROOT / "web_release" / filename
    if not file_path.exists():
        return {}
    return json.loads(file_path.read_text(encoding="utf-8"))


def build_summary(con: sqlite3.Connection) -> dict:
    stats = {row["metric"]: int(row["value"]) for row in query(con, "SELECT metric, value FROM web_stats")}
    stats["alphafold_mapped_enzymes"] = scalar(
        con, "SELECT COUNT(DISTINCT biopart_id) FROM web_alphafold_mappings WHERE status = 'found' AND model_entity_id IS NOT NULL AND model_entity_id <> ''"
    )
    stats["compounds"] = scalar(con, "SELECT COUNT(DISTINCT compound_id) FROM web_reaction_compounds")
    stats["compounds_with_smiles"] = scalar(
        con,
        "SELECT COUNT(DISTINCT compound_id) FROM web_reaction_compounds WHERE smiles IS NOT NULL AND smiles <> ''",
    )
    stats["compounds_with_chebi"] = scalar(
        con,
        "SELECT COUNT(DISTINCT compound_id) FROM web_reaction_compounds WHERE chebi_id IS NOT NULL AND chebi_id <> ''",
    )
    stats["compounds_with_pubchem"] = scalar(
        con,
        "SELECT COUNT(DISTINCT compound_id) FROM web_reaction_compounds WHERE pubchem_id IS NOT NULL AND pubchem_id <> ''",
    )
    stats["compound_images"] = scalar(
        con,
        "SELECT COUNT(DISTINCT compound_id) FROM web_compound_images WHERE image_path IS NOT NULL AND image_path <> ''",
    )
    stats["uniprot_mapped_enzymes"] = scalar(
        con,
        "SELECT COUNT(DISTINCT biopart_id) FROM web_enzyme_uniprot WHERE uniprot_accession IS NOT NULL AND uniprot_accession <> ''",
    )
    stats["chassis_annotated_records"] = scalar(con, "SELECT COUNT(*) FROM web_chassis_records")

    reaction_direction = count_rows(
        query(
            con,
            """
            SELECT COALESCE(reaction_direction, 'not curated') AS label, COUNT(*) AS count
            FROM web_reactions
            GROUP BY COALESCE(reaction_direction, 'not curated')
            ORDER BY count DESC
            """,
        )
    )

    reaction_structure = [
        {
            "label": "SMILES complete",
            "count": int(stats.get("structure_complete_reactions", 0)),
            "percent": pct(int(stats.get("structure_complete_reactions", 0)), int(stats.get("reactions", 0))),
        },
        {
            "label": "Partial / unresolved",
            "count": int(stats.get("reactions", 0) - stats.get("structure_complete_reactions", 0)),
            "percent": pct(
                int(stats.get("reactions", 0) - stats.get("structure_complete_reactions", 0)),
                int(stats.get("reactions", 0)),
            ),
        },
    ]

    ec_class = count_rows(
        query(
            con,
            """
            WITH ec AS (
              SELECT DISTINCT reaction_id, substr(ec_number_clean, 1, 1) AS class
              FROM web_reaction_ec_numbers
              WHERE ec_number_clean GLOB '[0-9]*'
            )
            SELECT 'EC ' || class AS label, COUNT(DISTINCT reaction_id) AS count
            FROM ec
            GROUP BY class
            ORDER BY CAST(class AS INTEGER)
            """,
        )
    )

    reaction_annotation = [
        {"label": "EC", "count": scalar(con, "SELECT COUNT(DISTINCT reaction_id) FROM web_reaction_ec_numbers")},
        {"label": "Rhea", "count": scalar(con, "SELECT COUNT(*) FROM web_reactions WHERE rhea_id IS NOT NULL AND rhea_id <> ''")},
        {"label": "KEGG", "count": scalar(con, "SELECT COUNT(*) FROM web_reactions WHERE kegg_reaction_id IS NOT NULL AND kegg_reaction_id <> ''")},
        {"label": "MetaCyc", "count": scalar(con, "SELECT COUNT(*) FROM web_reactions WHERE metacyc_reaction_id IS NOT NULL AND metacyc_reaction_id <> ''")},
        {"label": "SMILES complete", "count": int(stats.get("structure_complete_reactions", 0))},
    ]
    for item in reaction_annotation:
        item["percent"] = pct(int(item["count"]), int(stats.get("reactions", 0)))

    sequence_bins = count_rows(
        query(
            con,
            """
            SELECT bin AS label, COUNT(*) AS count
            FROM (
              SELECT CASE
                WHEN sequence_length IS NULL OR sequence_length <= 0 THEN 'missing'
                WHEN sequence_length < 200 THEN '<200 aa'
                WHEN sequence_length < 400 THEN '200-399 aa'
                WHEN sequence_length < 600 THEN '400-599 aa'
                WHEN sequence_length < 800 THEN '600-799 aa'
                WHEN sequence_length < 1000 THEN '800-999 aa'
                ELSE '>=1000 aa'
              END AS bin
              FROM web_enzymes
            )
            GROUP BY bin
            ORDER BY CASE bin
              WHEN 'missing' THEN 0
              WHEN '<200 aa' THEN 1
              WHEN '200-399 aa' THEN 2
              WHEN '400-599 aa' THEN 3
              WHEN '600-799 aa' THEN 4
              WHEN '800-999 aa' THEN 5
              ELSE 6
            END
            """,
        )
    )

    top_organisms = count_rows(
        query(
            con,
            """
            SELECT organism AS label, COUNT(DISTINCT biopart_id) AS count
            FROM web_reaction_enzymes
            WHERE organism IS NOT NULL AND organism <> ''
            GROUP BY organism
            ORDER BY count DESC, organism
            LIMIT 20
            """,
        )
    )

    enzyme_coverage = [
        {"label": "Sequence", "count": int(stats.get("enzymes_with_sequence", 0))},
        {"label": "UniProt", "count": int(stats.get("uniprot_mapped_enzymes", 0))},
        {"label": "PDB", "count": int(stats.get("pdb_mapped_enzymes", 0))},
        {"label": "AlphaFold", "count": int(stats.get("alphafold_mapped_enzymes", 0))},
        {
            "label": "PDB or AlphaFold",
            "count": scalar(
                con,
                """
                SELECT COUNT(DISTINCT biopart_id) FROM (
                  SELECT biopart_id FROM web_pdb_mappings
                  UNION
                  SELECT biopart_id FROM web_alphafold_mappings WHERE status = 'found' AND model_entity_id IS NOT NULL AND model_entity_id <> ''
                )
                """,
            ),
        },
    ]
    for item in enzyme_coverage:
        item["percent"] = pct(int(item["count"]), int(stats.get("enzymes", 0)))

    kinetic_parameters = count_rows(
        query(
            con,
            """
            SELECT COALESCE(parameter_type, 'not curated') AS label, COUNT(*) AS count
            FROM web_kinetics
            GROUP BY COALESCE(parameter_type, 'not curated')
            ORDER BY count DESC
            LIMIT 12
            """,
        )
    )
    kinetic_sources = count_rows(
        query(
            con,
            """
            SELECT COALESCE(NULLIF(lower(trim(source_db)), ''), 'unknown') AS label,
                   COUNT(*) AS count
            FROM web_kinetics
            GROUP BY label
            ORDER BY count DESC, label
            """,
        )
    )
    kinetic_assignment = count_rows(
        query(
            con,
            """
            SELECT COALESCE(reaction_assignment_status, 'not curated') AS label, COUNT(*) AS count
            FROM web_kinetics
            GROUP BY COALESCE(reaction_assignment_status, 'not curated')
            ORDER BY count DESC
            """,
        )
    )

    compound_coverage = [
        {"label": "SMILES", "count": int(stats["compounds_with_smiles"])},
        {"label": "ChEBI", "count": int(stats["compounds_with_chebi"])},
        {"label": "PubChem", "count": int(stats["compounds_with_pubchem"])},
        {"label": "SVG image", "count": int(stats["compound_images"])},
    ]
    for item in compound_coverage:
        item["percent"] = pct(int(item["count"]), int(stats.get("compounds", 0)))

    image_status = count_rows(
        query(
            con,
            """
            SELECT COALESCE(image_status, 'not generated') AS label, COUNT(DISTINCT compound_id) AS count
            FROM web_compound_images
            GROUP BY COALESCE(image_status, 'not generated')
            ORDER BY count DESC
            """,
        )
    )

    top_chassis = count_rows(
        query(
            con,
            """
            SELECT label, record_count AS count, reaction_count, enzyme_count, organism_count
            FROM web_chassis_labels
            ORDER BY record_count DESC, label
            LIMIT 20
            """,
        )
    )

    host_pathway = load_release_json("host_pathway_coverage_analysis.summary.json")
    candidate_diversity = load_release_json("candidate_diversity_analysis.summary.json")
    sequence_clusters = load_release_json("enzyme_sequence_clusters.summary.json")
    model_ready = load_release_json("model_ready_dataset.summary.json")
    advanced_selection = load_release_json("advanced_candidate_selection.summary.json")

    return {
        "release": {"version": "ReactEnzDB 2026.09.1", "date": "2026-09-22"},
        "overall": stats,
        "reaction": {
            "direction": reaction_direction,
            "structure": reaction_structure,
            "annotation": reaction_annotation,
            "ec_class": ec_class,
        },
        "enzyme": {
            "sequence_length_bins": sequence_bins,
            "top_organisms": top_organisms,
            "coverage": enzyme_coverage,
        },
        "kinetics": {
            "parameter_types": kinetic_parameters,
            "source_db": kinetic_sources,
            "assignment_status": kinetic_assignment,
        },
        "compound": {
            "coverage": compound_coverage,
            "image_status": image_status,
        },
        "chassis": {"top_labels": top_chassis},
        "supplemental": {
            "host_pathway": {
                "counts": host_pathway.get("counts", {}),
                "generated_at": host_pathway.get("generated_at_utc"),
            },
            "candidate_diversity": {
                "counts": candidate_diversity.get("counts", {}),
                "thresholds": candidate_diversity.get("thresholds", []),
                "generated_at": candidate_diversity.get("generated_at"),
            },
            "sequence_clusters": {
                "input_audit": sequence_clusters.get("input_audit", {}),
                "cluster_summary": sequence_clusters.get("cluster_summary", {}),
                "generated_at": sequence_clusters.get("generated_at_utc"),
            },
            "model_ready": {
                "tables": model_ready.get("tables", {}),
                "reaction_quality": model_ready.get("reaction_quality", {}),
                "candidate_quality": model_ready.get("candidate_quality", {}),
                "generated_at": model_ready.get("generated_at_utc"),
            },
            "advanced_selection": {
                "reaction_count": advanced_selection.get("reaction_count", 0),
                "candidate_rows": advanced_selection.get("candidate_rows", 0),
                "reactions_with_known_active": advanced_selection.get("reactions_with_known_active", 0),
                "known_active_rows": advanced_selection.get("known_active_rows", 0),
                "pairwise_alignment_screens": advanced_selection.get("pairwise_alignment_screens", 0),
                "novelty_counts": advanced_selection.get("novelty_counts", {}),
                "generated_at": advanced_selection.get("generated_at_utc"),
            },
        },
    }


def svg_text(x: float, y: float, text: str, size=13, weight="400", color=None, anchor="start") -> str:
    color = color or PALETTE["ink"]
    return (
        f'<text x="{x:.1f}" y="{y:.1f}" font-family="Arial, Helvetica, sans-serif" '
        f'font-size="{size}" font-weight="{weight}" fill="{color}" text-anchor="{anchor}">'
        f"{escape(str(text))}</text>"
    )


def svg_panel(x: float, y: float, w: float, h: float, title: str, label: str) -> list[str]:
    return [
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="18" fill="#ffffff" stroke="#d9e4f2" stroke-width="1"/>',
        svg_text(x + 18, y + 28, label, size=17, weight="700", color=PALETTE["blue"]),
        svg_text(x + 44, y + 28, title, size=15, weight="700"),
    ]


def scale_linear(value: float, max_value: float, length: float) -> float:
    return 0 if max_value <= 0 else value / max_value * length


def scale_log(value: float, max_value: float, length: float) -> float:
    if value <= 0 or max_value <= 1:
        return 0
    return math.log10(value) / math.log10(max_value) * length


def draw_h_lollipop(x: float, y: float, w: float, h: float, rows: list[dict], color: str, max_items=8) -> list[str]:
    rows = rows[:max_items]
    if not rows:
        return [svg_text(x + 18, y + 66, "No data", size=12, color=PALETTE["slate"])]
    max_value = max(int(r["count"]) for r in rows) or 1
    top = y + 62
    step = min(28, (h - 82) / max(1, len(rows)))
    label_w = w * 0.42
    axis_x = x + label_w
    line_w = w - label_w - 70
    out = []
    for i, row in enumerate(rows):
      cy = top + i * step
      label = str(row["label"])
      if len(label) > 28:
          label = label[:25] + "..."
      value = int(row["count"])
      lx = scale_linear(value, max_value, line_w)
      out.append(svg_text(x + 18, cy + 4, label, size=10.5, color=PALETTE["ink"]))
      out.append(f'<line x1="{axis_x:.1f}" y1="{cy:.1f}" x2="{axis_x + lx:.1f}" y2="{cy:.1f}" stroke="{color}" stroke-opacity="0.45" stroke-width="7" stroke-linecap="round"/>')
      out.append(f'<circle cx="{axis_x + lx:.1f}" cy="{cy:.1f}" r="5" fill="{color}"/>')
      out.append(svg_text(axis_x + lx + 10, cy + 4, f"{value:,}", size=10, color=PALETTE["slate"]))
    return out


def draw_v_lollipop(x: float, y: float, w: float, h: float, rows: list[dict], total: int, colors: list[str]) -> list[str]:
    rows = rows[: min(len(rows), len(colors))]
    if not rows:
        return [svg_text(x + 18, y + 66, "No data", size=12, color=PALETTE["slate"])]
    plot_x = x + 34
    plot_y = y + 58
    plot_w = w - 58
    plot_h = h - 106
    out = [
        f'<line x1="{plot_x}" y1="{plot_y + plot_h}" x2="{plot_x + plot_w}" y2="{plot_y + plot_h}" stroke="{PALETTE["grid"]}" stroke-width="1"/>',
        f'<line x1="{plot_x}" y1="{plot_y}" x2="{plot_x}" y2="{plot_y + plot_h}" stroke="{PALETTE["grid"]}" stroke-width="1"/>',
    ]
    step = plot_w / max(1, len(rows))
    for i, (row, color) in enumerate(zip(rows, colors)):
        value = int(row["count"])
        pc = pct(value, total)
        cx = plot_x + step * (i + 0.5)
        cy = plot_y + plot_h - scale_linear(pc, 100, plot_h)
        out.append(f'<line x1="{cx:.1f}" y1="{plot_y + plot_h:.1f}" x2="{cx:.1f}" y2="{cy:.1f}" stroke="{color}" stroke-opacity="0.5" stroke-width="10" stroke-linecap="round"/>')
        out.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="6" fill="{color}"/>')
        out.append(svg_text(cx, cy - 10, f"{pc:.1f}%", size=9, weight="700", color=color, anchor="middle"))
        label = str(row["label"])
        if len(label) > 12:
            label = label[:10] + "..."
        out.append(svg_text(cx, plot_y + plot_h + 20, label, size=9, color=PALETTE["slate"], anchor="middle"))
    return out


def draw_overview(x: float, y: float, w: float, h: float, rows: list[dict]) -> list[str]:
    max_value = max(int(r["count"]) for r in rows) or 1
    plot_x = x + 58
    plot_y = y + 72
    plot_w = w - 100
    plot_h = h - 120
    colors = [PALETTE["blue"], PALETTE["teal"], PALETTE["green"], PALETTE["amber"], PALETTE["slate"], "#9ab7d7"]
    out = [
        f'<line x1="{plot_x}" y1="{plot_y + plot_h}" x2="{plot_x + plot_w}" y2="{plot_y + plot_h}" stroke="{PALETTE["grid"]}" stroke-width="1"/>',
    ]
    step = plot_w / len(rows)
    for i, (row, color) in enumerate(zip(rows, colors)):
        value = int(row["count"])
        cx = plot_x + step * (i + 0.5)
        cy = plot_y + plot_h - scale_log(value, max_value, plot_h)
        out.append(f'<line x1="{cx:.1f}" y1="{plot_y + plot_h:.1f}" x2="{cx:.1f}" y2="{cy:.1f}" stroke="{color}" stroke-opacity="0.55" stroke-width="16" stroke-linecap="round"/>')
        out.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="8" fill="{color}"/>')
        out.append(svg_text(cx, cy - 14, f"{value:,}", size=12, weight="700", color=color, anchor="middle"))
        out.append(svg_text(cx, plot_y + plot_h + 24, row["label"], size=11, weight="700", anchor="middle"))
    out.append(svg_text(plot_x, y + h - 18, "Count axis uses log scaling to compare relation records with entity counts.", size=10, color=PALETTE["slate"]))
    return out


def draw_figure(summary: dict) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    overall = summary["overall"]
    width, height = 1480, 1660
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        '<rect width="100%" height="100%" fill="#f8fbff"/>',
        svg_text(50, 52, f'{summary["release"]["version"]} statistical landscape · updated {summary["release"].get("updated_date", summary["release"]["date"])}', size=28, weight="700"),
        svg_text(50, 82, "Reaction-enzyme associations link biochemical transformations to enzyme candidates, source organisms, chassis annotations, kinetics and structure evidence.", size=14, color=PALETTE["slate"]),
    ]

    panels = {
        "A": (50, 115, 1380, 260, "Release overview"),
        "B": (50, 410, 420, 260, "Reaction direction"),
        "C": (530, 410, 420, 260, "Reaction annotation coverage"),
        "D": (1010, 410, 420, 260, "EC class distribution"),
        "E": (50, 705, 420, 280, "Enzyme sequence length"),
        "F": (530, 705, 420, 280, "Enzyme identifier / structure coverage"),
        "G": (1010, 705, 420, 280, "Top source organisms"),
        "H": (50, 1020, 420, 280, "Kinetic parameter types"),
        "I": (530, 1020, 420, 280, "Compound structure coverage"),
        "J": (1010, 1020, 420, 280, "Top chassis annotations"),
    }
    for label, (x, y, w, h, title) in panels.items():
        parts.extend(svg_panel(x, y, w, h, title, label))

    hero_rows = [
        {"label": "Association records", "count": overall.get("reaction_enzyme_pairs", 0)},
        {"label": "Enzymes", "count": overall.get("enzymes", 0)},
        {"label": "Reactions", "count": overall.get("reactions", 0)},
        {"label": "Kinetics", "count": overall.get("kinetics", 0)},
        {"label": "Source organisms", "count": overall.get("source_organisms", 0)},
        {"label": "Chassis annotations", "count": overall.get("chassis_labels", 0)},
    ]
    parts.extend(draw_overview(50, 115, 1380, 260, hero_rows))
    parts.extend(draw_h_lollipop(50, 410, 420, 260, summary["reaction"]["direction"], PALETTE["blue"]))
    parts.extend(draw_v_lollipop(530, 410, 420, 260, summary["reaction"]["annotation"], overall.get("reactions", 0), [PALETTE["green"], PALETTE["teal"], PALETTE["blue"], PALETTE["amber"], PALETTE["slate"]]))
    parts.extend(draw_h_lollipop(1010, 410, 420, 260, summary["reaction"]["ec_class"], PALETTE["teal"]))
    parts.extend(draw_h_lollipop(50, 705, 420, 280, summary["enzyme"]["sequence_length_bins"], PALETTE["green"]))
    parts.extend(draw_v_lollipop(530, 705, 420, 280, summary["enzyme"]["coverage"], overall.get("enzymes", 0), [PALETTE["green"], PALETTE["teal"], PALETTE["blue"], PALETTE["amber"], PALETTE["slate"]]))
    parts.extend(draw_h_lollipop(1010, 705, 420, 280, summary["enzyme"]["top_organisms"], PALETTE["amber"], max_items=10))
    parts.extend(draw_h_lollipop(50, 1020, 420, 280, summary["kinetics"]["parameter_types"], PALETTE["blue"], max_items=8))
    parts.extend(draw_v_lollipop(530, 1020, 420, 280, summary["compound"]["coverage"], overall.get("compounds", 0), [PALETTE["green"], PALETTE["teal"], PALETTE["blue"], PALETTE["amber"]]))
    parts.extend(draw_h_lollipop(1010, 1020, 420, 280, summary["chassis"]["top_labels"], PALETTE["slate"], max_items=8))
    parts.append(svg_text(50, 1350, f'Source data: {summary["release"]["version"]}; revision {summary.get("provenance", {}).get("data_revision", "unknown")}.', size=12, color=PALETTE["slate"]))
    parts.append(svg_text(50, 1376, "Figure export: editable SVG generated with Python from the release SQLite database.", size=12, color=PALETTE["slate"]))
    parts.append("</svg>")
    (OUT_DIR / "reactenzdb_statistics_overview.svg").write_text("\n".join(parts), encoding="utf-8")


def main() -> None:
    global ROOT, DB_PATH, OUT_DIR
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=DB_PATH)
    parser.add_argument("--out", type=Path, default=OUT_DIR)
    parser.add_argument("--release-dir", type=Path, default=ROOT / "web_release")
    args = parser.parse_args()
    DB_PATH, OUT_DIR, ROOT = args.db.resolve(), args.out.resolve(), args.release_dir.resolve().parent
    if not DB_PATH.exists():
        raise FileNotFoundError(DB_PATH)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH.as_uri() + "?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    # Apply the public source filter before computing aggregates. Research
    # snapshots remain read-only; temporary views disappear with this connection.
    for row in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND upper(coalesce(sql,'')) NOT LIKE 'CREATE VIRTUAL TABLE%'").fetchall():
        name = row["name"]
        columns = {r["name"] for r in con.execute(f'PRAGMA table_info("{name}")')}
        sources = columns & {"source_db", "target_db", "mapping_source", "structure_source"}
        if sources and name != "web_xrefs":
            condition = " AND ".join(f'instr(lower(coalesce("{column}",\'\')),\'kegg\')=0' for column in sorted(sources))
            con.execute(f'CREATE TEMP VIEW "{name}" AS SELECT * FROM main."{name}" WHERE {condition}')
    con.execute("CREATE TEMP VIEW web_stats AS SELECT * FROM main.web_stats WHERE metric NOT LIKE 'kegg_pathway%'")
    summary = build_summary(con)
    # Public counts must describe the same source-filtered population.
    for key, table in [("kinetics", "web_kinetics"), ("field_level_evidences", "web_attribute_evidences")]:
        summary["overall"][key] = scalar(con, f'SELECT COUNT(*) FROM "{table}"')
    repair = load_release_json("data_repair_manifest.json")
    governance = load_release_json("PUBLIC_RELEASE_GOVERNANCE.json")
    summary["release"].update({
        "snapshot_id": governance.get("snapshot_id"),
        "snapshot_state": governance.get("snapshot_state"),
        "updated_date": str(governance.get("generated_at_utc", ""))[:10],
    })
    digest = hashlib.sha256()
    with DB_PATH.open("rb") as source:
        while block := source.read(1024 * 1024):
            digest.update(block)
    summary["provenance"] = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "source_database_sha256": digest.hexdigest(),
        "data_revision": governance.get("data_revision") or repair.get("revision", repair.get("working_revision", repair.get("repair_id", "unknown"))),
        "source_policy": "2026-10-08-external-links-only",
    }
    con.close()
    (OUT_DIR / "statistics_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    draw_figure(summary)


if __name__ == "__main__":
    main()
