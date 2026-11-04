"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import ReactionMatchPanel, { type MappingResponse } from "@/components/ReactEnz/ReactionMatchPanel";
import { StructureSearchField } from "@/components/ReactEnz/StructureSearchField";
import { transformationSearchHref } from "@/lib/transformationSearch";

type RouteStep = {
  reaction: string;
  product_smiles: string | null;
  substrate_smiles: string[];
  selected_enzyme: string | null;
  possible_enzymes: string[];
  enzyme_cofactors: Record<string, [string[], string[]]>;
};

type PlannedPathway = {
  rank: number;
  end_materials: string[];
  steps: RouteStep[];
  scores: { starting_material: number; change_in_complexity: number; num_enzyme_steps: number };
};

type PlanResponse = {
  target_smiles: string;
  requested_steps: number;
  elapsed_seconds: number;
  network: { nodes: number; edges: number; substrates: number; reactions: number };
  pathways: PlannedPathway[];
  note: string;
  tool_identity?: { code_license?: { spdx?: string }; data_license?: { spdx?: string }; paper?: { doi?: string } };
};

export default function RetroBioCatPlanner() {
  const [target, setTarget] = useState("");
  const [steps, setSteps] = useState(2);
  const [topK, setTopK] = useState(5);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PlanResponse | null>(null);
  const [mapping, setMapping] = useState<{ key: string; data: MappingResponse } | null>(null);
  const [mappingError, setMappingError] = useState("");
  const [mappingKey, setMappingKey] = useState<string | null>(null);

  async function matchStep(key: string, substrates: string, product: string) {
    setMappingKey(key);
    setMappingError("");
    setMapping(null);
    try {
      const response = await fetch("/api/retrosynthesis/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ precursors: substrates, product }),
      });
      const payload = await response.json() as MappingResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Reaction matching failed.");
      setMapping({ key, data: payload });
    } catch (requestError) {
      setMappingError(requestError instanceof Error ? requestError.message : "Reaction matching failed.");
    } finally {
      setMappingKey(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const smiles = target.trim();
    if (!smiles) return;
    setRunning(true);
      setError("");
      setResult(null);
      setMapping(null);
      setMappingError("");
    try {
      const response = await fetch("/api/retrobiocat/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: smiles, steps, topK }),
      });
      const payload = await response.json() as PlanResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "RetroBioCat planning failed.");
      setResult(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "RetroBioCat planning failed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-[28px] border border-border bg-white shadow-sm dark:border-dark_border dark:bg-darkmode">
      <div className="border-b border-border bg-[linear-gradient(105deg,rgba(23,196,167,0.12),rgba(47,115,242,0.08))] px-6 py-6 dark:border-dark_border">
        <p className="reactenz-eyebrow">Rule-based pathway planning</p>
        <h2 className="reactenz-api-example-title mt-2 text-midnight_text dark:text-white">Bounded 1–3 step rule network</h2>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-muted dark:text-white/60">
          Apply the source-attributed RetroBioCat reaction rules, rank bounded multi-step routes, and report suggested enzyme classes, cofactors, and purchasable end materials.
        </p>
      </div>

      <form className="grid gap-5 p-6" onSubmit={submit}>
        <StructureSearchField
          compact
          label="Target molecule"
          maxLength={2000}
          onChange={setTarget}
          placeholder="SMILES, or draw / load a structure"
          replaceOnApply
          rows={5}
          value={target}
        />
        <div className="flex flex-wrap items-end gap-5">
          <label className="text-sm font-bold text-midnight_text dark:text-white">
            Maximum steps
            <select className="ml-3 rounded-lg border border-border bg-white px-3 py-2 dark:border-dark_border dark:bg-darkmode" onChange={(event) => setSteps(Number(event.target.value))} value={steps}>
              {[1, 2, 3].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="text-sm font-bold text-midnight_text dark:text-white">
            Routes to return
            <select className="ml-3 rounded-lg border border-border bg-white px-3 py-2 dark:border-dark_border dark:bg-darkmode" onChange={(event) => setTopK(Number(event.target.value))} value={topK}>
              {[3, 5, 10].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <button className="ml-auto rounded-xl bg-primary px-5 py-3 text-sm font-black text-white disabled:cursor-wait disabled:opacity-60" disabled={running || !target.trim()} type="submit">
            {running ? "Queued or planning..." : "Plan with RetroBioCat"}
          </button>
        </div>
        <p className="text-xs leading-5 text-muted dark:text-white/50">Planning is limited to three steps and a bounded reaction network. It shares the server CPU queue with the single-step predictors.</p>
      </form>

      {error ? <div className="mx-6 mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}
      {result ? (
        <div className="border-t border-border p-6 dark:border-dark_border">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="reactenz-eyebrow">Planning result</p>
              <h3 className="mt-1 text-lg font-bold">{result.pathways.length} ranked pathways</h3>
            </div>
            <span className="rounded-full bg-green/10 px-3 py-1 text-xs font-black text-green">{result.elapsed_seconds.toFixed(2)} seconds</span>
          </div>
          <p className="mt-3 text-xs text-muted dark:text-white/50">Network: {result.network.nodes} nodes, {result.network.reactions} reactions, {result.network.edges} edges.</p>
          {mappingError ? <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{mappingError}</p> : null}
          <div className="mt-4 space-y-4">
            {result.pathways.map((pathway) => (
              <article className="rounded-2xl border border-border p-4 dark:border-dark_border" key={pathway.rank}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-lg font-black">Route #{pathway.rank}</h4>
                  <span className="text-xs font-bold text-muted">{pathway.steps.length} enzyme step{pathway.steps.length === 1 ? "" : "s"} · purchasable score {pathway.scores.starting_material.toFixed(2)}</span>
                </div>
                <p className="mt-2 break-all rounded-xl bg-hero-bg px-3 py-2 font-mono text-xs text-muted dark:bg-dark_b">End materials: {pathway.end_materials.join(" + ")}</p>
                <ol className="mt-3 space-y-3">
                  {pathway.steps.map((step, index) => {
                    const substrates = step.substrate_smiles.filter(Boolean).join(".");
                    const product = step.product_smiles?.trim() ?? "";
                    const canMatch = Boolean(substrates && product);
                    const key = `${pathway.rank}-${index}`;
                    return (
                      <li className="grid gap-2 rounded-xl border border-border px-4 py-3 text-sm dark:border-dark_border md:grid-cols-[42px_minmax(0,1fr)]" key={`${step.reaction}-${index}`}>
                        <span className="font-mono font-black text-primary">{index + 1}</span>
                        <div>
                          <p className="font-black text-midnight_text dark:text-white">{step.reaction} · {step.selected_enzyme || "enzyme unspecified"}</p>
                          <p className="mt-1 break-all font-mono text-xs leading-5 text-muted">{step.substrate_smiles.join(" + ")} → {step.product_smiles}</p>
                          <p className="mt-1 text-xs text-muted">RetroBioCat enzyme classes, not ReactEnzDB enzyme records: {step.possible_enzymes.join(", ") || "not recorded"}</p>
                          {canMatch ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button className="rounded-lg bg-primary px-3 py-1.5 text-xs font-black text-white disabled:cursor-wait disabled:opacity-60" disabled={mappingKey !== null} onClick={() => void matchStep(key, substrates, product)} type="button">
                                {mappingKey === key ? "Matching..." : "Match in ReactEnzDB"}
                              </button>
                              <Link className="rounded-lg bg-primary px-3 py-1.5 text-xs font-black text-white hover:bg-primary/90" href={transformationSearchHref({ substrates, products: product })}>
                                Open in Search
                              </Link>
                            </div>
                          ) : null}
                          {mapping?.key === key ? <ReactionMatchPanel mapping={mapping.data} /> : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </article>
            ))}
          </div>
          <p className="mt-4 text-xs leading-5 text-muted dark:text-white/50">{result.note} Code {result.tool_identity?.code_license?.spdx ?? "license not recorded"}; data {result.tool_identity?.data_license?.spdx ?? "license not recorded"}.</p>
        </div>
      ) : null}
    </section>
  );
}
