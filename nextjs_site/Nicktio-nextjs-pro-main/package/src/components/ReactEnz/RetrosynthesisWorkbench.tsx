"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import ReactionMatchPanel, { type MappingResponse } from "@/components/ReactEnz/ReactionMatchPanel";
import { StructureSearchField } from "@/components/ReactEnz/StructureSearchField";
import type { RetrosynthesisToolEntry } from "@/lib/retrosynthesisToolRegistry";
import { transformationSearchHref } from "@/lib/transformationSearch";

type Predictor = "gsetretro" | "readretro" | "bionavi_np";

type Prediction = {
  rank: number;
  precursor_smiles: string;
  score: number | null;
};

type PredictorResponse = {
  tool: Predictor;
  target_smiles: string;
  mode: string;
  predictions: Prediction[];
  note: string;
  tool_identity?: {
    registry_version: string;
    name: string;
    reactenzdb_scope: string;
    code_license: { spdx?: string | null };
    model_weights_license?: { status: string };
    checkpoint?: { file: string; sha256?: string };
    paper: { doi: string };
  } | null;
};

type LiveTool = RetrosynthesisToolEntry & { tool_id: Predictor };

function isLiveTool(item: RetrosynthesisToolEntry): item is LiveTool {
  return item.capability_class === "live_single_step_predictor" && ["gsetretro", "readretro", "bionavi_np"].includes(item.tool_id);
}

export default function RetrosynthesisWorkbench({ registry, fixedTool }: { registry: RetrosynthesisToolEntry[]; fixedTool: Predictor }) {
  const tools = registry.filter(isLiveTool).filter((item) => item.tool_id === fixedTool);
  const tool = fixedTool;
  const [target, setTarget] = useState("");
  const [topK, setTopK] = useState(5);
  const [result, setResult] = useState<PredictorResponse | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [mapping, setMapping] = useState<{ rank: number; data: MappingResponse } | null>(null);
  const [mappingError, setMappingError] = useState("");
  const [mappingRank, setMappingRank] = useState<number | null>(null);

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
      const response = await fetch("/api/retrosynthesis/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, target: smiles, topK }),
      });
      const payload = await response.json() as PredictorResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Prediction failed.");
      setResult(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Prediction failed.");
    } finally {
      setRunning(false);
    }
  }

  async function resolveEnzymes(prediction: Prediction) {
    if (!result) return;
    setMappingRank(prediction.rank);
    setMappingError("");
    setMapping(null);
    try {
      const response = await fetch("/api/retrosynthesis/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ precursors: prediction.precursor_smiles, product: result.target_smiles }),
      });
      const payload = await response.json() as MappingResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Reaction matching failed.");
      setMapping({ rank: prediction.rank, data: payload });
    } catch (requestError) {
      setMappingError(requestError instanceof Error ? requestError.message : "Reaction matching failed.");
    } finally {
      setMappingRank(null);
    }
  }

  const activeTool = tools.find((item) => item.tool_id === tool) ?? tools[0];
  if (!activeTool) return <p className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">No live predictor is declared in the release tool registry.</p>;

  return (
    <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_310px]">
      <section className="overflow-hidden rounded-[28px] border border-border bg-white shadow-sm dark:border-dark_border dark:bg-darkmode">
        <div className="border-b border-border bg-[linear-gradient(105deg,rgba(47,115,242,0.10),rgba(23,196,167,0.08))] px-6 py-5 dark:border-dark_border">
          <p className="reactenz-eyebrow">CPU prediction</p>
          <h2 className="reactenz-api-example-title mt-2 text-midnight_text dark:text-white">Single-step disconnection</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted dark:text-white/60">
            The model proposes precursor sets. ReactEnzDB then searches the forward precursor-to-target transformation and ranks linked enzymes only when a database match is found.
          </p>
          {activeTool.model_weights_license?.status !== "verified" ? (
            <p className="mt-3 inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-black text-amber-800">Public deployment permission pending</p>
          ) : null}
        </div>

        <form className="p-6" onSubmit={submit}>
          <div className="grid gap-5">
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

            <div className="flex flex-wrap items-end justify-between gap-4">
              <label className="text-sm font-bold text-midnight_text dark:text-white">
                Maximum proposals
                <select className="ml-3 rounded-lg border border-border bg-white px-3 py-2 text-sm dark:border-dark_border dark:bg-darkmode" onChange={(event) => setTopK(Number(event.target.value))} value={topK}>
                  {[3, 5, 10].map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <button className="rounded-xl bg-primary px-5 py-3 text-sm font-black text-white disabled:cursor-wait disabled:opacity-60" disabled={running || !target.trim()} type="submit">
                {running ? `Queued or running ${activeTool.name}...` : `Run ${activeTool.name}`}
              </button>
            </div>
            <p className="text-xs leading-5 text-muted dark:text-white/50">Online model tasks run one at a time. If another prediction is active, this submission waits in the shared queue automatically.</p>
          </div>
        </form>

        {error ? <div className="mx-6 mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}

        {result ? (
          <div className="border-t border-border p-6 dark:border-dark_border">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="reactenz-eyebrow">Prediction result</p>
                <h3 className="mt-1 text-lg font-bold">{tools.find((item) => item.tool_id === result.tool)?.name} precursor proposals</h3>
              </div>
              <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-black uppercase tracking-wider text-primary">{result.mode.replaceAll("_", " ")}</span>
            </div>
            <p className="mt-3 break-all rounded-xl bg-hero-bg px-4 py-3 font-mono text-xs text-muted dark:bg-dark_b dark:text-white/60">Target: {result.target_smiles}</p>
            {result.tool_identity ? (
              <p className="mt-2 text-xs leading-5 text-muted dark:text-white/50">
                Registry v{result.tool_identity.registry_version} · {result.tool_identity.checkpoint?.file ?? "checkpoint not recorded"}
                {result.tool_identity.checkpoint?.sha256 ? ` · SHA256 ${result.tool_identity.checkpoint.sha256.slice(0, 12)}...` : ""}
                {` · code ${result.tool_identity.code_license.spdx ?? "license not specified"} · weights ${result.tool_identity.model_weights_license?.status ?? "not recorded"}`}
              </p>
            ) : null}
            {result.predictions.length ? (
              <div className="mt-4 divide-y divide-border overflow-hidden rounded-2xl border border-border dark:divide-dark_border dark:border-dark_border">
                {result.predictions.map((prediction) => {
                  const finderHref = transformationSearchHref({ substrates: prediction.precursor_smiles, products: result.target_smiles });
                  return (
                    <div className="p-4" key={`${prediction.rank}-${prediction.precursor_smiles}`}>
                      <div className="grid gap-3 md:grid-cols-[52px_minmax(0,1fr)_auto] md:items-center">
                        <div className="font-mono text-sm font-black text-primary">#{prediction.rank}</div>
                        <div>
                          <div className="break-all font-mono text-xs leading-6 text-midnight_text dark:text-white">{prediction.precursor_smiles}</div>
                          <div className="mt-1 text-xs text-muted">{prediction.score === null ? "Model score unavailable" : `Relative model score ${prediction.score.toFixed(4)}`}</div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button className="rounded-xl bg-primary px-4 py-2 text-sm font-black text-white disabled:cursor-wait disabled:opacity-60" disabled={mappingRank !== null} onClick={() => resolveEnzymes(prediction)} type="button">
                            {mappingRank === prediction.rank ? "Matching..." : "Match in ReactEnzDB"}
                          </button>
                          <Link className="inline-flex justify-center rounded-xl bg-primary px-4 py-2 text-sm font-black text-white hover:bg-primary/90" href={finderHref}>Open in Search</Link>
                        </div>
                      </div>
                      {mappingError && mappingRank === null && mapping?.rank !== prediction.rank ? <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{mappingError}</p> : null}
                      {mapping?.rank === prediction.rank ? <ReactionMatchPanel mapping={mapping.data} /> : null}
                    </div>
                  );
                })}
              </div>
            ) : <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">The predictor returned no valid precursor proposal for this target.</p>}
            <p className="mt-4 text-xs leading-5 text-muted dark:text-white/50">{result.note} &quot;Resolve enzymes&quot; runs a separate forward reaction match; no enzyme is implied when no exact or defensible structure-level match is found.</p>
          </div>
        ) : null}
      </section>

      <aside>
        <section className="rounded-[24px] border border-border bg-white p-5 dark:border-dark_border dark:bg-darkmode">
          <p className="reactenz-eyebrow">Evidence policy</p>
          <h2 className="reactenz-api-example-title mt-2 text-midnight_text dark:text-white">Prediction is not evidence</h2>
          <ol className="mt-4 space-y-3 text-sm leading-6 text-muted dark:text-white/60">
            <li><b className="text-midnight_text dark:text-white">1. Structure and direction:</b> query-side coverage with protonation normalization and retained stereochemistry; review all additional participants.</li>
            <li><b className="text-midnight_text dark:text-white">2. Pair evidence:</b> follow source assertions for the selected reaction and enzyme; automated mapping and literature verification are separate.</li>
            <li><b className="text-midnight_text dark:text-white">3. Similarity:</b> shown separately as a hypothesis, never as a confirmed assignment.</li>
          </ol>
        </section>
      </aside>
    </div>
  );
}
