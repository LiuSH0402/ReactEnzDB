import type { PairLiteratureRecord } from "@/lib/pairLiterature";

export default function PairLiteratureEvidence({ records }: { records: PairLiteratureRecord[] }) {
  if (!records.length) return null;
  return <section className="space-y-4 border-y border-border py-4 dark:border-dark_border" aria-label="Pair-linked literature notes">
    <h3 className="text-lg font-bold">Pair-linked literature notes</h3>
    <p className="text-sm text-muted">Targeted primary-text checks assisted by AI; independent expert review is not recorded. These notes are separate from mapped source assertions and do not establish a combined pathway experiment.</p>
    {records.map(row => <details key={row.record_id} className="border-t border-border pt-3 dark:border-dark_border">
      <summary className="cursor-pointer font-bold">{row.reactenz_reaction_id} · {row.reactenz_enzyme_id} · {row.protein_label} · PMID {row.paper.pmid}</summary>
      <div className="mt-3 space-y-3 text-sm leading-6">
        <p><a className="font-bold text-primary hover:underline" href={`/enzymes/${row.reactenz_enzyme_id}`}>{row.reactenz_enzyme_id}</a> · {row.organism} · {row.gene_locus} · <a className="text-primary hover:underline" href={`https://www.uniprot.org/uniprotkb/${row.protein_accession}/entry`} target="_blank" rel="noreferrer">{row.protein_accession}</a></p>
        <p>{row.reaction_context}</p>
        <p><strong>Protein and construct:</strong> {row.construct}</p>
        <p><strong>Sequence identity:</strong> Native sequence ({row.native_sequence_length} aa) matches the paper-listed {row.paper_sequence_accession} and the checked UniProt sequence; recombinant tags and preparation conditions are described separately.</p>
        <ul className="list-disc space-y-1 pl-5">{row.measurements.map((m,i) => <li key={i}>{m.parameter}: {m.value}{"uncertainty" in m ? ` ± ${m.uncertainty}` : ""} {m.unit} · {m.subject} · {m.anchor}</li>)}</ul>
        {row.conditions.map((c,i) => <p key={i}><strong>{c.scope}:</strong> {c.temperature_c} °C; pH {c.ph}. {c.description}</p>)}
        <p><strong>Measurement:</strong> {row.assay_readout}</p>
        <p><strong>Product evidence:</strong> {row.product_confirmation}</p>
        <p><a className="font-bold text-primary hover:underline" href={row.paper.url} target="_blank" rel="noreferrer">{row.paper.title}</a> ({row.paper.year}) · <a className="text-primary hover:underline" href={`https://doi.org/${row.paper.doi}`} target="_blank" rel="noreferrer">DOI {row.paper.doi}</a></p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">{row.anchors.map(a => <a key={a.url} className="text-primary hover:underline" href={a.url} target="_blank" rel="noreferrer">{a.label}</a>)}</div>
        <ul className="list-disc space-y-1 pl-5 text-muted">{row.limitations.map(l => <li key={l}>{l}</li>)}</ul>
      </div>
    </details>)}
    <a className="text-sm font-bold text-primary hover:underline" href="/data/reaction-enzyme-literature.json" download>Download literature notes (JSON)</a>
  </section>;
}
