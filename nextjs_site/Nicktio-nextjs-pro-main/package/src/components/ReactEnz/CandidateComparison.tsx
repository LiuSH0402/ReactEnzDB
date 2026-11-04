"use client";

import { useState } from "react";
import Link from "next/link";
import type { EnzymeCandidateRow } from "@/lib/reactenzdb";

type CandidateComparisonProps = {
  candidates: EnzymeCandidateRow[];
};

const MAX_COMPARE = 5;

function shortText(value: string | null | undefined, fallback = "NA") {
  if (!value) return fallback;
  return value.length > 80 ? `${value.slice(0, 80)}...` : value;
}

export default function CandidateComparison({ candidates }: CandidateComparisonProps) {
  const initial = candidates.slice(0, Math.min(3, candidates.length)).map((candidate) => candidate.reactenz_enzyme_id);
  const [selectedIds, setSelectedIds] = useState<string[]>(initial);
  const selected = candidates.filter((candidate) => selectedIds.includes(candidate.reactenz_enzyme_id));

  function toggle(id: string) {
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= MAX_COMPARE) return current;
      return [...current, id];
    });
  }

  if (!candidates.length) return null;

  return (
    <section className="mt-6 rounded-[22px] border border-border bg-white p-5 dark:border-dark_border dark:bg-darkmode">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="reactenz-eyebrow">Candidate comparison</p>
          <h3 className="text-[22px]">Compare selected enzymes</h3>
        </div>
        <p className="text-sm leading-6 text-muted dark:text-white/60">
          Select 2-{MAX_COMPARE} candidates to compare sequence, source organism, kinetics, structure, chassis annotations, and annotation richness.
        </p>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {candidates.slice(0, 20).map((candidate) => {
          const checked = selectedIds.includes(candidate.reactenz_enzyme_id);
          const disabled = !checked && selectedIds.length >= MAX_COMPARE;
          return (
            <label
              className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-sm font-bold ${
                checked
                  ? "border-primary bg-primary text-white"
                  : "border-border bg-hero-bg text-midnight_text dark:border-dark_border dark:bg-dark_b dark:text-white"
              } ${disabled ? "opacity-45" : ""}`}
              key={candidate.reactenz_enzyme_id}
            >
              <input
                checked={checked}
                className="h-4 w-4 accent-primary"
                disabled={disabled}
                onChange={() => toggle(candidate.reactenz_enzyme_id)}
                type="checkbox"
              />
              {candidate.reactenz_enzyme_id}
            </label>
          );
        })}
      </div>

      {selected.length >= 2 ? (
        <div className="overflow-hidden rounded-2xl border border-border dark:border-dark_border">
          <table className="w-full min-w-[980px] text-left">
            <thead className="bg-hero-bg text-sm uppercase tracking-wider text-muted dark:bg-dark_b">
              <tr>
                <th className="px-4 py-3">Feature</th>
                {selected.map((candidate) => (
                  <th className="px-4 py-3" key={candidate.reactenz_enzyme_id}>
                    <Link className="text-primary hover:underline" href={`/enzymes/${candidate.reactenz_enzyme_id}`}>
                      {candidate.reactenz_enzyme_id}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-sm dark:divide-dark_border">
              {[
                ["Enzyme", (candidate: EnzymeCandidateRow) => shortText(candidate.enzyme_name)],
                ["Source organism", (candidate: EnzymeCandidateRow) => shortText(candidate.organism)],
                ["Gene", (candidate: EnzymeCandidateRow) => shortText(candidate.gene_name_primary)],
                ["UniProt", (candidate: EnzymeCandidateRow) => candidate.uniprot_accession ?? "Not mapped"],
                ["Sequence", (candidate: EnzymeCandidateRow) => candidate.sequence_length ? `${candidate.sequence_length} aa` : "Missing"],
                ["Kinetics", (candidate: EnzymeCandidateRow) => `${candidate.kinetic_count} records`],
                ["Structure", (candidate: EnzymeCandidateRow) => `${candidate.pdb_count} PDB / ${candidate.alphafold_count} AlphaFold`],
                ["Chassis annotations", (candidate: EnzymeCandidateRow) => candidate.chassis_labels?.split(",").slice(0, 3).join(", ") ?? "No annotation"],
                ["Annotation richness", (candidate: EnzymeCandidateRow) => String(candidate.evidence_score)],
              ].map(([label, getter]) => (
                <tr key={String(label)}>
                  <td className="px-4 py-3 font-black text-midnight_text dark:text-white">{String(label)}</td>
                  {selected.map((candidate) => (
                    <td className="px-4 py-3 text-muted dark:text-white/70" key={`${candidate.reactenz_enzyme_id}-${String(label)}`}>
                      {(getter as (candidate: EnzymeCandidateRow) => string)(candidate)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-2xl bg-hero-bg p-4 text-sm font-semibold text-muted dark:bg-dark_b dark:text-white/60">
          Select at least two enzyme candidates to create a comparison table.
        </div>
      )}
    </section>
  );
}
