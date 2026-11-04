from __future__ import annotations

import csv
import gzip
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "expression_work" / "expression_evidence.sqlite"
OUT = ROOT / "web_release" / "downloads"


def write_query(conn: sqlite3.Connection, filename: str, sql: str) -> dict[str, object]:
    path = OUT / filename
    cursor = conn.execute(sql)
    columns = [item[0] for item in cursor.description]
    rows = 0
    with gzip.open(path, "wt", encoding="utf-8", newline="", compresslevel=6) as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(columns)
        for row in cursor:
            writer.writerow(row)
            rows += 1
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return {"file": f"downloads/{filename}", "rows": rows, "columns": len(columns), "size": path.stat().st_size, "sha256": digest}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB)
    artifacts = [
        write_query(conn, "expression_article_correspondence.tsv.gz", """
            SELECT pmid,doi,pmcid,title,journal,publisher_group,original_access_status,
                   fulltext_status,fulltext_available,fulltext_source_channel,extraction_status,
                   legacy_annotation_count,biopart_count,reactenz_enzyme_count,reaction_count,
                   legacy_host_count,sequence_supported_annotation_count,expression_candidate_count,
                   e1_count,e2_count,e3_count,e4_count,exact_enzyme_candidate_count,
                   active_candidate_count,inactive_candidate_count,soluble_candidate_count,
                   insoluble_candidate_count,max_candidate_confidence,qc_flag_count,
                   critical_flagged_candidate_count,high_flagged_candidate_count,
                   evidence_interpretation,correspondence_version,generated_at
            FROM article_master_correspondence ORDER BY CAST(pmid AS INTEGER)
        """),
        write_query(conn, "experimental_expression_candidates.tsv.gz", """
            SELECT c.candidate_id,c.pmid,c.doi,a.title,a.journal,c.host_id,c.host_name,c.source_organism,
                   c.expression_mode,c.enzyme_identity_status,c.evidence_type_candidate,c.confidence,
                   c.expression_detected,c.solubility,c.activity,c.purification,c.localization,c.vector,
                   c.promoter,c.tag,c.strain_or_cell_line,c.inducer,c.induction_condition,
                   c.expression_temperature_c,c.expression_time_text,c.cofactor_supplementation,
                   c.yield_text,c.conversion_text,c.negative_result_text,c.success_interpretation,
                   c.curation_status,l.biopart_id,l.reactenz_enzyme_id,l.protein_id,l.gene_name,
                   l.enzyme_name,l.reaction_id,l.reactenz_reaction_id,l.link_method,l.match_score,l.is_primary
            FROM expression_evidence_candidates c
            JOIN article_master_correspondence a USING(pmid)
            LEFT JOIN expression_evidence_candidate_enzyme_links l USING(candidate_id)
            ORDER BY CAST(c.pmid AS INTEGER),c.candidate_id,l.is_primary DESC,l.match_score DESC
        """),
        write_query(conn, "experimental_expression_qc_flags.tsv.gz", """
            SELECT c.pmid,f.candidate_id,f.flag_code,f.severity,f.details_json,f.qc_version,f.created_at
            FROM expression_evidence_candidate_qc_flags f
            JOIN expression_evidence_candidates c USING(candidate_id)
            ORDER BY CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,CAST(c.pmid AS INTEGER),f.candidate_id
        """),
        write_query(conn, "experimental_expression_source_trace.tsv.gz", """
            SELECT c.pmid,s.candidate_id,s.span_id,s.section,s.page_or_table,s.paragraph_or_locator,
                   s.evidence_text_sha256,s.extraction_method,s.created_at
            FROM expression_evidence_candidate_spans s
            JOIN expression_evidence_candidates c USING(candidate_id)
            ORDER BY CAST(c.pmid AS INTEGER),s.candidate_id,s.span_id
        """),
    ]
    counts = dict(conn.execute("""
        SELECT 'candidate_articles',COUNT(*) FROM article_master_correspondence UNION ALL
        SELECT 'fulltext_available',SUM(fulltext_available) FROM article_master_correspondence UNION ALL
        SELECT 'articles_with_candidates',SUM(expression_candidate_count>0) FROM article_master_correspondence UNION ALL
        SELECT 'expression_candidates',COUNT(*) FROM expression_evidence_candidates UNION ALL
        SELECT 'source_spans',COUNT(*) FROM expression_evidence_candidate_spans UNION ALL
        SELECT 'candidate_enzyme_reaction_links',COUNT(*) FROM expression_evidence_candidate_enzyme_links
    """))
    conn.close()
    summary = {
        "release": "ReactEnzDB experimental expression evidence",
        "version": "2026.08-candidate",
        "generated_at": datetime.now(timezone.utc).astimezone().isoformat(),
        "status": "machine_extracted_pending_human_review",
        "counts": counts,
        "artifacts": artifacts,
        "public_release_boundary": "No PDFs, local paths, text-cache paths, or bulk verbatim source paragraphs are included.",
        "interpretation_boundary": "No extracted candidate is not negative expression evidence. The 12-host metabolic context and predicted compatibility are separate layers.",
    }
    summary_path = OUT / "expression_evidence_release.summary.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    readme_path = OUT / "EXPERIMENTAL_EXPRESSION_EVIDENCE.md"
    readme_path.write_text(
        "# ReactEnzDB experimental expression evidence\n\n"
        "This candidate release links articles to heterologous-expression observations, hosts, enzyme/reaction mappings, experimental fields, and review flags.\n\n"
        "All machine-extracted candidates remain pending human review. No extracted candidate must not be interpreted as failed expression or inactivity. "
        "Experimental expression evidence, twelve-host metabolic context, and predicted compatibility are separate data layers.\n\n"
        "The public files exclude PDFs, local filesystem paths, text-cache paths, and bulk verbatim source paragraphs.\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
