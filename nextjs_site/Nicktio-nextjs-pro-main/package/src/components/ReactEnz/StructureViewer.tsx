"use client";

import { useState } from "react";
import Badge from "./Badge";
import DataStatus from "./DataStatus";
import type { AlphaFoldRow, PdbRow } from "@/lib/reactenzdb";

type StructureItem =
  | {
      id: string;
      kind: "pdb";
      label: string;
      subtitle: string;
      confidence: string;
      viewerUrl: string;
      rcsbUrl: string;
      cifUrl: string;
      pdbUrl: string;
    }
  | {
      id: string;
      kind: "alphafold";
      label: string;
      subtitle: string;
      confidence: string;
      viewerUrl: string;
      entryUrl: string;
      cifUrl: string | null;
      pdbUrl: string | null;
      paeImageUrl: string | null;
    };

function pdbViewerUrl(pdbId: string) {
  return `https://molstar.org/viewer/?pdb=${encodeURIComponent(pdbId)}&pdb-provider=rcsb&hide-controls=1`;
}

function afViewerUrl(accession: string) {
  return `https://molstar.org/viewer/?afdb=${encodeURIComponent(accession)}&hide-controls=1`;
}

function structureItems(pdb: PdbRow[], alphafold: AlphaFoldRow[]): StructureItem[] {
  const experimental = pdb.map((item) => ({
    id: `pdb-${item.pdb_id}-${item.chain_id ?? "all"}`,
    kind: "pdb" as const,
    label: item.pdb_id,
    subtitle: [
      item.chain_id ? `chain ${item.chain_id}` : null,
      item.experimental_method,
      item.resolution ? `${item.resolution} A` : null,
    ].filter(Boolean).join(" | "),
    confidence: item.coverage ? `coverage ${Math.round(item.coverage)}%` : "coverage not reported",
    viewerUrl: pdbViewerUrl(item.pdb_id),
    rcsbUrl: `https://www.rcsb.org/structure/${item.pdb_id}`,
    cifUrl: `https://files.rcsb.org/download/${item.pdb_id}.cif`,
    pdbUrl: `https://files.rcsb.org/download/${item.pdb_id}.pdb`,
  }));

  const predicted = alphafold.map((item) => ({
    id: `af-${item.uniprot_accession}-${item.model_entity_id ?? "model"}`,
    kind: "alphafold" as const,
    label: item.model_entity_id ?? `AF-${item.uniprot_accession}`,
    subtitle: [
      item.uniprot_accession,
      item.latest_version ? `v${item.latest_version}` : null,
      item.sequence_start && item.sequence_end ? `${item.sequence_start}-${item.sequence_end}` : null,
    ].filter(Boolean).join(" | "),
    confidence: item.global_metric_value ? `mean pLDDT ${item.global_metric_value.toFixed(1)}` : "pLDDT not reported",
    viewerUrl: afViewerUrl(item.uniprot_accession),
    entryUrl: `https://alphafold.ebi.ac.uk/entry/${item.uniprot_accession}`,
    cifUrl: item.cif_url,
    pdbUrl: item.pdb_url,
    paeImageUrl: item.pae_image_url,
  }));

  return [...experimental, ...predicted];
}

export default function StructureViewer({ pdb, alphafold }: { pdb: PdbRow[]; alphafold: AlphaFoldRow[] }) {
  const items = structureItems(pdb, alphafold);
  const [selectedId, setSelectedId] = useState(items[0]?.id ?? "");
  const selected = items.find((item) => item.id === selectedId) ?? items[0];

  if (!selected) {
    return <p className="text-muted">No experimental PDB or AlphaFold-predicted structure is mapped for this enzyme.</p>;
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
      <div className="rounded-2xl border border-border bg-white p-4 dark:border-dark_border dark:bg-darkmode">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-20">Structure entries</h3>
            <p className="mt-1 text-sm text-muted">{pdb.length} experimental; {alphafold.length} predicted</p>
          </div>
        </div>
        <div className="max-h-[640px] space-y-3 overflow-auto pr-1">
          {items.map((item) => {
            const active = item.id === selected.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={`w-full rounded-2xl border p-4 text-left transition ${
                  active
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-border hover:border-primary dark:border-dark_border"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="font-bold text-primary">{item.label}</div>
                  <Badge tone={item.kind === "pdb" ? "green" : "blue"}>
                    {item.kind === "pdb" ? "experimental" : "predicted"}
                  </Badge>
                </div>
                <div className="mt-2 text-sm leading-6 text-midnight_text dark:text-white/80">
                  {item.subtitle || <DataStatus status="not_reported" />}
                </div>
                <div className="mt-1 text-xs font-semibold uppercase tracking-[0.1em] text-muted">{item.confidence}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-white dark:border-dark_border dark:bg-darkmode">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4 dark:border-dark_border">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
              {selected.kind === "pdb" ? "PDB experimental structure" : "AlphaFold predicted model"}
            </div>
            <h3 className="mt-1 text-20">{selected.label}</h3>
          </div>
          <div className="flex flex-wrap gap-2 text-sm font-semibold">
            {selected.kind === "pdb" ? (
              <a className="rounded-full border border-primary px-3 py-2 text-primary" href={selected.rcsbUrl} target="_blank" rel="noreferrer">
                View RCSB
              </a>
            ) : (
              <a className="rounded-full border border-primary px-3 py-2 text-primary" href={selected.entryUrl} target="_blank" rel="noreferrer">
                View AlphaFold DB
              </a>
            )}
            {selected.cifUrl ? (
              <a className="rounded-full bg-primary px-3 py-2 text-white" href={selected.cifUrl} target="_blank" rel="noreferrer">
                Download CIF
              </a>
            ) : null}
            {selected.pdbUrl ? (
              <a className="rounded-full bg-primary px-3 py-2 text-white" href={selected.pdbUrl} target="_blank" rel="noreferrer">
                Download PDB
              </a>
            ) : null}
          </div>
        </div>
        <iframe
          key={selected.id}
          src={selected.viewerUrl}
          title={`${selected.label} 3D structure viewer`}
          className="h-[640px] w-full bg-white"
          loading="lazy"
          allow="fullscreen"
        />
        {selected.kind === "alphafold" && selected.paeImageUrl ? (
          <div className="border-t border-border p-4 text-sm dark:border-dark_border">
            <a className="font-semibold text-primary hover:underline" href={selected.paeImageUrl} target="_blank" rel="noreferrer">
              View predicted aligned error image
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}
