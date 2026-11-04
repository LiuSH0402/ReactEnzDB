import { getReportedExperimentalObservations } from "@/lib/reactenzdb";

export default function ReportedExperimentalObservations({ biopartId }: { biopartId: string }) {
  const { expression, stability } = getReportedExperimentalObservations(biopartId);
  if (!expression.length && !stability.length) return null;
  return <section id="reported-experiments" className="rounded-2xl border border-border bg-white p-6 dark:bg-darkmode">
    <h2 className="text-xl font-bold">Reported expression and stability</h2>
    <p className="mt-2 text-sm leading-6 text-muted">Observations refer to the reported construct and experimental context. Mutant, truncated and tagged constructs may differ from the canonical protein. Computed structure models do not establish stability.</p>
    {expression.length ? <div className="mt-5 space-y-5">{expression.map(row => <article key={row.expression_id} className="border-t border-border pt-4">
      <h3 className="font-bold">{row.host_name}{row.strain_or_cell_line ? ` · ${row.strain_or_cell_line}` : ""}</h3>
      <p className="mt-2 text-sm font-semibold">{row.yield_text}</p>
      <p className="mt-1 text-sm leading-6">{row.construct_note}</p>
      <p className="mt-1 text-xs text-muted">{row.yield_basis.replaceAll("_", " ")} · {row.solubility_status.replaceAll("_", " ")} · {row.activity_status.replaceAll("_", " ")}</p>
      {row.source_pmid ? <a className="mt-2 inline-block text-sm font-bold text-primary hover:underline" href={`https://pubmed.ncbi.nlm.nih.gov/${row.source_pmid}/`} target="_blank" rel="noreferrer">PMID {row.source_pmid}</a> : null}
    </article>)}</div> : null}
    {stability.length ? <div className="mt-5 space-y-4">{stability.map(row => <article key={row.observation_id} className="border-t border-border pt-4">
      <h3 className="text-sm font-bold">{row.property_kind.replaceAll("_", " ")}</h3><p className="mt-1 text-sm leading-6">{row.value_text}</p>
      <div className="mt-2 flex flex-wrap gap-3">{row.pmids.map(pmid => <a key={pmid} className="text-sm font-bold text-primary hover:underline" href={`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`} target="_blank" rel="noreferrer">PMID {pmid}</a>)}</div>
    </article>)}</div> : null}
  </section>;
}
