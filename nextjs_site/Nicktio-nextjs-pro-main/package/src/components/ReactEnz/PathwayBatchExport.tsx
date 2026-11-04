"use client";

import { useState, useTransition } from "react";

type Candidate = {
  reactenz_enzyme_id: string | null;
  biopart_id: string;
  enzyme_name: string | null;
  organism: string | null;
  chassis_labels: string | null;
  host_suitability_score: number;
  host_suitability_tier: string;
  score_explanation: string[];
  enzyme_evidence_score: number;
  kinetic_record_count: number;
  structure_confidence_score: number;
  interpro_count: number;
  pfam_count: number;
  active_site_count: number;
  binding_site_count: number;
  conserved_site_count: number;
  uniprot_accession: string | null;
};

type GapFillingCandidate = Candidate & {
  gap_fill_score: number;
  gap_fill_notes: string[];
  structure_confidence_tier: string | null;
  best_structure_type: string | null;
  best_structure_id: string | null;
};

type NativeNeighbor = {
  host_id: string;
  host_name: string;
  model_id: string;
  model_source: string;
  bigg_reaction_id: string;
  reaction_name: string | null;
  subsystem: string | null;
  ec_numbers: string | null;
  link_type: string | null;
  confidence: string | null;
  matched_identifier: string | null;
};

type Step = {
  query: string;
  found: boolean;
  reaction: {
    reactenz_reaction_id: string;
    reaction_id: string;
    reaction_equation_display: string | null;
    canonical_reaction_smiles: string | null;
    formula_balance_status: string;
    quality_flags: string;
  } | null;
  host_context: {
    host_name: string;
    host_model_count: number;
    native_model_reaction_count: number;
    high_confidence_link_count: number;
    low_confidence_link_count: number;
    bigg_reaction_ids: string | null;
    subsystems: string | null;
    has_exchange_context: number;
    has_transport_context: number;
  } | null;
  candidates: Candidate[];
  gap_filling: {
    gap_status: "native_exact" | "ec_class_only" | "missing" | "not_evaluated";
    reason: string;
    suggested_heterologous_enzymes: GapFillingCandidate[];
    neighboring_native_reactions: NativeNeighbor[];
  } | null;
};

type PathwayResult = {
  host: string;
  host_label: string;
  limit_per_reaction: number;
  boundary_note: string;
  host_feasibility: Array<{
    host_id: string;
    host_name: string;
    model_id: string;
    model_source: string;
    exact_native_step_count: number;
    ec_class_context_step_count: number;
    heterologous_step_count: number;
    missing_reaction_count: number;
    linked_precursor_metabolite_count: number;
    total_participant_count: number;
    linked_participant_count: number;
    participant_coverage: number;
    feasibility_score: number;
    recommendation_tier: string;
  }>;
  cofactor_burden: Array<{
    category: string;
    label: string;
    left_count: number;
    right_count: number;
    net_count: number;
    reaction_count: number;
    example_compounds: string;
    interpretation: string;
  }>;
  steps: Step[];
};

const hostOptions = [
  ["any", "Any host"],
  ["ecoli", "E. coli"],
  ["yeast", "S. cerevisiae"],
  ["bacillus", "B. subtilis"],
  ["corynebacterium", "C. glutamicum"],
  ["pseudomonas", "P. putida KT2440"],
  ["pichia", "Pichia / Komagataella"],
  ["streptomyces", "S. coelicolor"],
  ["yarrowia", "Y. lipolytica"],
  ["cupriavidus", "C. necator H16"],
];

function badgeClass(tier: string) {
  if (tier === "recommended") return "bg-green/15 text-green";
  if (tier === "plausible") return "bg-primary/10 text-primary";
  if (tier === "weak") return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

function gapStatusClass(status: string) {
  if (status === "native_exact") return "bg-green/15 text-green";
  if (status === "ec_class_only") return "bg-amber-100 text-amber-700";
  if (status === "missing") return "bg-danger/10 text-danger";
  return "bg-slate-100 text-slate-600";
}

export default function PathwayBatchExport() {
  const [reactions, setReactions] = useState("R00001, R00002, R00003");
  const [host, setHost] = useState("ecoli");
  const [limit, setLimit] = useState(5);
  const [result, setResult] = useState<PathwayResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const params = new URLSearchParams({
    reactions,
    host,
    limit: String(limit),
  });
  const csvHref = `/api/reactenzdb/pathway-export?${params.toString()}&format=csv`;
  const jsonHref = `/api/reactenzdb/pathway-export?${params.toString()}&format=json`;

  function runPreview() {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(jsonHref, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Pathway export failed.");
        setResult(payload.data as PathwayResult);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Pathway export failed.");
      }
    });
  }

  return (
    <section className="mt-10">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="reactenz-eyebrow">Pathway design export</p>
          <h2>Preliminary host-context enzyme prioritization</h2>
        </div>
        <div className="max-w-3xl text-sm leading-6 text-muted dark:text-white/60">
          Enter multiple reaction IDs to retrieve ranked enzyme candidates for every pathway step. Scores are evidence-based heuristics for prioritization, not expression-success predictions.
        </div>
      </div>

      <div className="rounded-[24px] border border-border bg-white p-6 dark:border-dark_border dark:bg-darkmode">
        <div className="grid gap-4 lg:grid-cols-[1fr_230px_130px_auto] lg:items-end">
          <label className="block">
            <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-muted">Reaction IDs</span>
            <textarea
              className="min-h-24 border border-border bg-hero-bg p-3 text-sm dark:border-dark_border dark:bg-dark_b dark:text-white"
              onChange={(event) => setReactions(event.target.value)}
              placeholder="R00001, R00002, R00003"
              value={reactions}
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-muted">Target host</span>
            <select
              className="border border-border bg-hero-bg px-3 py-3 text-sm font-bold dark:border-dark_border dark:bg-dark_b dark:text-white"
              onChange={(event) => setHost(event.target.value)}
              value={host}
            >
              {hostOptions.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-muted">Top N</span>
            <select
              className="border border-border bg-hero-bg px-3 py-3 text-sm font-bold dark:border-dark_border dark:bg-dark_b dark:text-white"
              onChange={(event) => setLimit(Number(event.target.value))}
              value={limit}
            >
              {[5, 10, 20, 50].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-xl bg-primary px-5 py-3 text-sm font-black text-white hover:bg-primary/90 disabled:opacity-60"
              disabled={isPending}
              onClick={runPreview}
              type="button"
            >
              {isPending ? "Ranking..." : "Preview"}
            </button>
            <a className="rounded-xl border border-primary px-5 py-3 text-sm font-black text-primary hover:bg-primary hover:text-white" href={csvHref}>
              CSV
            </a>
            <a className="rounded-xl border border-border px-5 py-3 text-sm font-black text-midnight_text hover:border-primary hover:text-primary dark:border-dark_border dark:text-white" href={jsonHref}>
              JSON
            </a>
          </div>
        </div>

        {error ? <div className="mt-4 rounded-2xl bg-danger/10 p-4 text-sm font-semibold text-danger">{error}</div> : null}

        {result ? (
          <div className="mt-6 grid gap-5">
            <div className="rounded-2xl bg-hero-bg p-4 text-sm leading-6 text-muted dark:bg-dark_b dark:text-white/60">
              Target host: <strong className="text-midnight_text dark:text-white">{result.host_label}</strong>. {result.boundary_note}
            </div>

            {result.host_feasibility.length ? (
              <div className="overflow-x-auto rounded-[22px] border border-border dark:border-dark_border">
                <div className="border-b border-border bg-white p-5 dark:border-dark_border dark:bg-darkmode">
                  <p className="reactenz-eyebrow">Host-model coverage summary</p>
                  <h3 className="mt-1">Preliminary host-model coverage ranking</h3>
                  <p className="mt-2 text-sm leading-6 text-muted dark:text-white/60">
                    Only host models with mapped reactions are compared. This is a model-coverage heuristic, not a flux, growth, yield, expression, or production feasibility prediction. Exact identifier mappings establish model-native steps; same-EC matches are contextual clues and cannot establish native coverage.
                  </p>
                </div>
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="bg-hero-bg text-xs uppercase tracking-wider text-muted dark:bg-dark_b">
                    <tr>
                      <th className="px-4 py-3">Rank</th>
                      <th className="px-4 py-3">Host model</th>
                      <th className="px-4 py-3">Coverage heuristic</th>
                      <th className="px-4 py-3">Exact native</th>
                      <th className="px-4 py-3">EC context only</th>
                      <th className="px-4 py-3">Needs heterologous design</th>
                      <th className="px-4 py-3">No host context</th>
                      <th className="px-4 py-3">Participant coverage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-white dark:divide-dark_border dark:bg-darkmode">
                    {result.host_feasibility.slice(0, 8).map((row, index) => (
                      <tr key={row.host_id}>
                        <td className="px-4 py-3 font-mono font-black text-primary">#{index + 1}</td>
                        <td className="px-4 py-3">
                          <div className="font-bold text-midnight_text dark:text-white">{row.host_name}</div>
                          <div className="mt-1 text-xs text-muted">{row.model_id} / {row.model_source}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-2xl font-black text-primary" title="Host-model coverage score; not a production feasibility prediction">{row.feasibility_score}</div>
                          <span className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-xs font-black ${badgeClass(row.recommendation_tier)}`}>
                            {row.recommendation_tier}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-semibold">{row.exact_native_step_count}</td>
                        <td className="px-4 py-3">{row.ec_class_context_step_count}</td>
                        <td className="px-4 py-3">{row.heterologous_step_count}</td>
                        <td className="px-4 py-3">{row.missing_reaction_count}</td>
                        <td className="px-4 py-3">{Math.round(row.participant_coverage * 100)}% ({row.linked_participant_count}/{row.total_participant_count})</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {result.cofactor_burden.length ? (
              <div className="overflow-x-auto rounded-[22px] border border-border dark:border-dark_border">
                <div className="border-b border-border bg-white p-5 dark:border-dark_border dark:bg-darkmode">
                  <p className="reactenz-eyebrow">Cofactor burden summary</p>
                  <h3 className="mt-1">Currency and cofactor demand across the pathway</h3>
                  <p className="mt-2 text-sm leading-6 text-muted dark:text-white/60">
                    Counts are derived from pathway reaction participants. Net is products minus inputs, so negative values indicate pathway-level input demand.
                  </p>
                </div>
                <table className="w-full min-w-[920px] text-left text-sm">
                  <thead className="bg-hero-bg text-xs uppercase tracking-wider text-muted dark:bg-dark_b">
                    <tr>
                      <th className="px-4 py-3">Cofactor</th>
                      <th className="px-4 py-3">Net</th>
                      <th className="px-4 py-3">Input / product</th>
                      <th className="px-4 py-3">Steps</th>
                      <th className="px-4 py-3">Interpretation</th>
                      <th className="px-4 py-3">Examples</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-white dark:divide-dark_border dark:bg-darkmode">
                    {result.cofactor_burden.slice(0, 10).map((row) => (
                      <tr key={row.category}>
                        <td className="px-4 py-3 font-black text-midnight_text dark:text-white">{row.label}</td>
                        <td className={`px-4 py-3 font-mono text-lg font-black ${row.net_count < 0 ? "text-amber-700" : row.net_count > 0 ? "text-green" : "text-muted"}`}>
                          {row.net_count > 0 ? `+${row.net_count}` : row.net_count}
                        </td>
                        <td className="px-4 py-3">{row.left_count} / {row.right_count}</td>
                        <td className="px-4 py-3">{row.reaction_count}</td>
                        <td className="px-4 py-3 text-muted dark:text-white/60">{row.interpretation}</td>
                        <td className="px-4 py-3 text-xs text-muted dark:text-white/60">{row.example_compounds || "not reported"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {result.steps.map((step, index) => (
              <article className="rounded-[22px] border border-border p-5 dark:border-dark_border" key={`${step.query}-${index}`}>
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.14em] text-muted">Step {index + 1} - query {step.query}</div>
                    <h3 className="mt-2">
                      {step.reaction ? step.reaction.reactenz_reaction_id : "Reaction not found"}
                    </h3>
                    {step.reaction ? (
                      <p className="mt-2 max-w-5xl text-sm leading-6 text-muted dark:text-white/60">{step.reaction.reaction_equation_display}</p>
                    ) : null}
                  </div>
                  {step.reaction ? (
                    <div className="rounded-full bg-primary/10 px-3 py-1 text-xs font-black text-primary">
                      {step.reaction.formula_balance_status}
                    </div>
                  ) : null}
                </div>

                {step.reaction ? (
                  <div className="mb-4 grid gap-3 rounded-2xl bg-hero-bg p-4 text-sm dark:bg-dark_b md:grid-cols-3">
                    <div>
                        <div className="text-xs font-black uppercase tracking-[0.14em] text-muted">Host model context</div>
                        <div className="mt-1 font-bold text-midnight_text dark:text-white">
                          {step.host_context
                            ? `${step.host_context.high_confidence_link_count} exact model link${step.host_context.high_confidence_link_count === 1 ? "" : "s"} across ${step.host_context.host_model_count} model${step.host_context.host_model_count === 1 ? "" : "s"}`
                            : "No selected-host model link"}
                        </div>
                    </div>
                    <div>
                      <div className="text-xs font-black uppercase tracking-[0.14em] text-muted">Mapping semantics</div>
                      <div className="mt-1 font-semibold text-muted dark:text-white/60">
                        {step.host_context
                          ? `${step.host_context.high_confidence_link_count} exact identifier; ${step.host_context.low_confidence_link_count} EC-class context only`
                          : "not evaluated"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-black uppercase tracking-[0.14em] text-muted">BiGG / subsystem</div>
                      <div className="mt-1 truncate font-semibold text-muted dark:text-white/60" title={step.host_context?.subsystems ?? ""}>
                        {step.host_context?.bigg_reaction_ids?.split(",").slice(0, 3).join(", ") ?? "none"}
                      </div>
                    </div>
                  </div>
                ) : null}

                {step.reaction && step.gap_filling ? (
                  <div className="mb-4 rounded-2xl border border-border bg-white p-4 dark:border-dark_border dark:bg-darkmode">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-black uppercase tracking-[0.14em] text-muted">Reaction gap-filling suggestions</div>
                        <p className="mt-1 text-sm leading-6 text-muted dark:text-white/60">{step.gap_filling.reason}</p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-wide ${gapStatusClass(step.gap_filling.gap_status)}`}>
                        {step.gap_filling.gap_status.replaceAll("_", " ")}
                      </span>
                    </div>

                    {step.gap_filling.neighboring_native_reactions.length ? (
                      <div className="mb-4 rounded-xl bg-hero-bg p-3 dark:bg-dark_b">
                        <div className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-muted">Same-EC / native neighboring reactions in selected host</div>
                        <div className="grid gap-2 md:grid-cols-2">
                          {step.gap_filling.neighboring_native_reactions.slice(0, 4).map((neighbor) => (
                            <div className="rounded-xl bg-white p-3 text-xs dark:bg-darkmode" key={`${neighbor.host_id}-${neighbor.bigg_reaction_id}`}>
                              <div className="font-black text-primary">{neighbor.bigg_reaction_id}</div>
                              <div className="mt-1 font-semibold text-midnight_text dark:text-white">{neighbor.reaction_name ?? "reaction name not reported"}</div>
                              <div className="mt-1 text-muted">{neighbor.host_name} / {neighbor.model_id}</div>
                              <div className="mt-1 text-muted">{neighbor.subsystem ?? "subsystem not reported"}</div>
                              <div className="mt-2">
                                <span className={`rounded-full px-2 py-1 font-black ${gapStatusClass(neighbor.confidence === "high" ? "native_exact" : "ec_class_only")}`}>
                                  {neighbor.link_type ?? "native context"} {neighbor.confidence ? `(${neighbor.confidence})` : ""}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {step.gap_filling.suggested_heterologous_enzymes.length ? (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[980px] text-left text-sm">
                          <thead className="bg-hero-bg text-xs uppercase tracking-wider text-muted dark:bg-dark_b">
                            <tr>
                              <th className="px-4 py-3">Gap rank</th>
                              <th className="px-4 py-3">Heterologous enzyme</th>
                              <th className="px-4 py-3">Source organism</th>
                              <th className="px-4 py-3">Kinetics</th>
                              <th className="px-4 py-3">Structure / sites</th>
                              <th className="px-4 py-3">Decision notes</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border dark:divide-dark_border">
                            {step.gap_filling.suggested_heterologous_enzymes.map((candidate, rank) => (
                              <tr className="align-top" key={`${candidate.biopart_id}-gap`}>
                                <td className="px-4 py-3">
                                  <div className="font-mono text-xs font-black text-primary">#{rank + 1}</div>
                                  <div className="mt-1 text-2xl font-black text-primary">{candidate.gap_fill_score}</div>
                                </td>
                                <td className="px-4 py-3">
                                  <div className="font-bold text-midnight_text dark:text-white">{candidate.reactenz_enzyme_id ?? candidate.biopart_id}</div>
                                  <div className="mt-1 text-xs text-muted">{candidate.enzyme_name ?? "enzyme name not reported"}</div>
                                  {candidate.uniprot_accession ? <div className="mt-1 text-xs text-primary">UniProt {candidate.uniprot_accession}</div> : null}
                                </td>
                                <td className="px-4 py-3">
                                  <div>{candidate.organism ?? "source organism not reported"}</div>
                                  <div className="mt-1 text-xs text-muted">{candidate.chassis_labels ?? "no chassis annotation context"}</div>
                                </td>
                                <td className="px-4 py-3">
                                  <div className="font-semibold">{candidate.kinetic_record_count} records</div>
                                  <div className="mt-1 text-xs text-muted">evidence {candidate.enzyme_evidence_score}/100</div>
                                </td>
                                <td className="px-4 py-3">
                                  <div className="font-semibold">{candidate.structure_confidence_score}/100 {candidate.structure_confidence_tier ?? ""}</div>
                                  <div className="mt-1 text-xs text-muted">
                                    InterPro/Pfam {candidate.interpro_count}/{candidate.pfam_count}; sites {candidate.active_site_count + candidate.binding_site_count + candidate.conserved_site_count}
                                  </div>
                                </td>
                                <td className="px-4 py-3">
                                  <ul className="grid gap-1 text-xs leading-5 text-muted">
                                    {candidate.gap_fill_notes.slice(0, 5).map((note) => (
                                      <li key={note}>{note}</li>
                                    ))}
                                  </ul>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : step.gap_filling.gap_status !== "native_exact" ? (
                      <div className="rounded-xl bg-hero-bg p-3 text-sm text-muted dark:bg-dark_b">
                        No heterologous enzyme candidate is available for this step in the model-ready layer.
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {step.candidates.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1080px] text-left text-sm">
                      <thead className="bg-hero-bg text-xs uppercase tracking-wider text-muted dark:bg-dark_b">
                        <tr>
                          <th className="px-4 py-3">Rank</th>
                          <th className="px-4 py-3">Candidate enzyme</th>
                          <th className="px-4 py-3">Source organism / chassis annotation</th>
                          <th className="px-4 py-3">Host-context heuristic</th>
                          <th className="px-4 py-3">Evidence</th>
                          <th className="px-4 py-3">Why ranked here</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border dark:divide-dark_border">
                        {step.candidates.map((candidate, rank) => (
                          <tr className="align-top" key={candidate.biopart_id}>
                            <td className="px-4 py-3 font-mono font-black text-primary">#{rank + 1}</td>
                            <td className="px-4 py-3">
                              <div className="font-bold text-midnight_text dark:text-white">{candidate.reactenz_enzyme_id ?? candidate.biopart_id}</div>
                              <div className="mt-1 text-xs text-muted">{candidate.enzyme_name ?? "enzyme name not reported"}</div>
                              {candidate.uniprot_accession ? <div className="mt-1 text-xs text-primary">UniProt {candidate.uniprot_accession}</div> : null}
                            </td>
                            <td className="px-4 py-3">
                              <div>{candidate.organism ?? "source organism not reported"}</div>
                              <div className="mt-1 text-xs text-muted">{candidate.chassis_labels ?? "no chassis annotation context"}</div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="text-2xl font-black text-primary">{candidate.host_suitability_score}</div>
                              <span className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-xs font-black ${badgeClass(candidate.host_suitability_tier)}`}>
                                {candidate.host_suitability_tier}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs leading-5 text-muted">
                              evidence {candidate.enzyme_evidence_score}; kinetics {candidate.kinetic_record_count}; structure {candidate.structure_confidence_score}; InterPro/Pfam {candidate.interpro_count}/{candidate.pfam_count}; sites {candidate.active_site_count + candidate.binding_site_count + candidate.conserved_site_count}
                            </td>
                            <td className="px-4 py-3">
                              <ul className="grid gap-1 text-xs leading-5 text-muted">
                                {candidate.score_explanation.slice(0, 4).map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="rounded-2xl bg-hero-bg p-4 text-sm text-muted dark:bg-dark_b">
                    {step.found ? "No enzyme candidates are available for this reaction in the model-ready layer." : "Check the reaction ID and try a ReactEnzDB ID such as R00001."}
                  </p>
                )}
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
