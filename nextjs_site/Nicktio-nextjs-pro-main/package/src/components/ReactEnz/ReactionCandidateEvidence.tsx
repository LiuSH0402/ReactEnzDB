"use client";

import { useEffect, useRef, useState } from "react";
import PairLiteratureEvidence from "@/components/ReactEnz/PairLiteratureEvidence";
import type { ReactionEnzymeEvidenceDetail, ReactionEnzymeEvidenceSummary } from "@/lib/evidence-release";

function safeSourceUrl(value: string | null) {
  return value && /^https?:\/\//i.test(value) ? value : undefined;
}

function conditionText(value: string | null): string {
  if (!value) return "";
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object") {
      return Object.values(parsed).flatMap((item) => typeof item === "string" ? [item]
        : Array.isArray(item) ? item.filter((part): part is string => typeof part === "string") : []).filter(Boolean).join("; ");
    }
  } catch { /* Plain source text is already displayable. */ }
  return value;
}

export default function ReactionCandidateEvidence({ summary, available, url, literatureCount = 0 }: {
  summary: ReactionEnzymeEvidenceSummary | null; available: boolean; url: string; literatureCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ReactionEnzymeEvidenceDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`${url}&offset=${offset}`, { signal: controller.signal }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Evidence retrieval failed.");
      if (!controller.signal.aborted) setData(payload);
    }).catch((caught) => {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Evidence retrieval failed.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, offset, url]);

  if (!available && !literatureCount) return <span className="text-xs text-muted">Evidence layer unavailable</span>;
  if (!summary && !literatureCount) return <span className="text-xs text-muted">No assay evidence mapped to this pair</span>;
  return (
    <div className="max-w-md text-xs leading-5">
      {summary ? <p>{summary.exact_assertion_count} exact-source assertions · {summary.literature_verified_count} literature-verified</p> : <p>No source assay assertions mapped</p>}
      {literatureCount ? <p>{literatureCount} pair-linked literature note{literatureCount === 1 ? "" : "s"}</p> : null}
      {summary?.inactive_or_negative_count ? <p>{summary.inactive_or_negative_count} inactive / negative assertions</p> : null}
      {summary?.literature_discrepancy_count ? <p>{summary.literature_discrepancy_count} literature discrepancies</p> : null}
      <button className="mt-1 font-bold text-primary hover:underline" type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}>View pair evidence</button>
      {open ? <dialog ref={dialog} onCancel={() => setOpen(false)} aria-label="Reaction–enzyme pair evidence" className="fixed inset-0 m-auto max-h-[85vh] w-[calc(100%-2rem)] max-w-4xl space-y-4 overflow-y-auto rounded-2xl border border-border bg-white p-6 text-left text-sm leading-6 text-midnight_text shadow-xl backdrop:bg-black/40 dark:border-dark_border dark:bg-darkmode dark:text-white">
        <div className="flex items-start justify-between gap-4"><h3 className="text-lg font-bold">{summary ? `${summary.reactenz_reaction_id} · ${summary.reactenz_enzyme_id} — ` : ""}Pair evidence</h3><button className="font-bold text-primary" onClick={() => setOpen(false)} type="button">Close evidence</button></div>
        {loading ? <p role="status">Loading evidence…</p> : error ? <p role="alert">{error}</p> : data ? <>
          <PairLiteratureEvidence records={data.literature_records} />
          <p className="text-muted">Source mapping and literature verification are separate. Check assay direction, protein form and conditions.</p>
          {data.assertions.map((assertion) => {
            const citations = data.citations.filter((row) => row.assertion_id === assertion.assertion_id);
            const measurements = data.measurements.filter((row) => row.assertion_id === assertion.assertion_id);
            const conditions = data.assay_conditions.filter((row) => row.assertion_id === assertion.assertion_id);
            const sourceUrl = safeSourceUrl(assertion.source_url);
            return <details className="border-t border-border pt-3 dark:border-dark_border" key={assertion.assertion_id}>
              <summary className="cursor-pointer font-bold">{assertion.source_db} · {assertion.source_record_id} · {[assertion.wild_type_status, assertion.mutation_text].filter(Boolean).join(" · ") || "Protein form not reported"}</summary>
              <p className="mt-2 font-bold">{sourceUrl ? <a className="text-primary hover:underline" href={sourceUrl} target="_blank" rel="noreferrer">Open source record {assertion.source_record_id}</a> : assertion.source_record_id}</p>
              <p>{assertion.display_evidence_label} · {assertion.outcome_class.replaceAll("_", " ")}</p>
              <p>Curation: {assertion.curation_status.replaceAll("_", " ")}</p>
              <p>Protein form: {[assertion.form_accession, assertion.wild_type_status, assertion.mutation_text].filter(Boolean).join(" · ") || "Not reported"}</p>
              <ul className="mt-1 space-y-1">{measurements.map((row) => <li key={row.measurement_id}>
                {row.parameter_type_canonical}: {row.release_normalized_value ?? row.raw_value_text ?? row.raw_value_numeric ?? "Not reported"} {row.release_normalized_value !== null ? row.release_normalized_unit : row.raw_value_numeric !== null || row.raw_value_text ? row.raw_unit : ""}{row.subject_name ? ` (${row.subject_name})` : ""}
              </li>)}</ul>
              <p className="mt-1">Conditions: {conditions.length ? conditions.map((row) => [row.ph !== null ? `pH ${row.ph}` : "", row.temperature_c !== null ? `${row.temperature_c} °C` : "", conditionText(row.buffer_text), conditionText(row.cofactor_text), conditionText(row.condition_text)].filter(Boolean).join("; ") || "Not reported").join(" | ") : "Not reported"}</p>
              <div className="mt-1 flex flex-wrap gap-2">{citations.length ? citations.map((row, index) => {
                const href = row.pmid && /^\d+$/.test(row.pmid) ? `https://pubmed.ncbi.nlm.nih.gov/${row.pmid}/` : row.doi ? `https://doi.org/${encodeURIComponent(row.doi)}` : safeSourceUrl(row.source_url);
                const label = row.pmid ? `PMID ${row.pmid}` : row.doi ?? row.title ?? "Source citation";
                return <span key={index}>{href ? <a className="font-bold text-primary hover:underline" href={href} target="_blank" rel="noreferrer">{label}</a> : label} · {row.verification_status.replaceAll("_", " ")}</span>;
              }) : <span>No citation mapped</span>}</div>
            </details>;
          })}
          <p>Showing {data.assertions.length ? offset + 1 : 0}–{offset + data.assertions.length} of {data.pagination.total} source assertions.</p>
          <div className="flex gap-3">
            {offset > 0 ? <button className="font-bold text-primary" type="button" onClick={() => setOffset(Math.max(0, offset - data.pagination.limit))}>Previous</button> : null}
            {offset + data.pagination.limit < data.pagination.total ? <button className="font-bold text-primary" type="button" onClick={() => setOffset(offset + data.pagination.limit)}>Next evidence</button> : null}
            <a className="font-bold text-primary hover:underline" href={`${url}&offset=${offset}`} target="_blank" rel="noreferrer">Evidence JSON</a>
          </div>
        </> : null}
      </dialog> : null}
    </div>
  );
}
