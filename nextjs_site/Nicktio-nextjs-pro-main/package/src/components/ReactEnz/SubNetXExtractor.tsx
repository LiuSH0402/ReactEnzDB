"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { StructureSearchField } from "@/components/ReactEnz/StructureSearchField";
import { transformationSearchHref } from "@/lib/transformationSearch";

type Compound = { compound_id: string; name: string; formula?: string; smiles?: string; similarity?: number };
type Extraction = {
  target: Compound;
  host: string;
  selected_precursors: Compound[];
  core_paths: Compound[][];
  network: { node_count: number; edge_count: number; reaction_count: number };
  unresolved_boundaries: Compound[];
  expansion_rounds_completed: number;
  truncated: boolean;
  elapsed_seconds: number;
  note: string;
};

export default function SubNetXExtractor() {
  const [target, setTarget] = useState("");
  const [pathCount, setPathCount] = useState(3);
  const [expand, setExpand] = useState(true);
  const [suggestions, setSuggestions] = useState<Compound[]>([]);
  const [result, setResult] = useState<Extraction | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  async function searchTarget() {
    setError("");
    const response = await fetch(`/api/subnetx/search?q=${encodeURIComponent(target)}`);
    const payload = await response.json() as { results?: Compound[]; error?: string };
    if (!response.ok) throw new Error(payload.error || "Target search failed.");
    setSuggestions(payload.results ?? []);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = target.trim();
    if (!query) return;
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/subnetx/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: query, pathCount, expansionRounds: expand ? 1 : 0, maxNodes: 120 }),
      });
      const payload = await response.json() as Extraction & { error?: string; suggestions?: Compound[] };
      if (!response.ok) {
        if (payload.suggestions) setSuggestions(payload.suggestions);
        throw new Error(payload.error || "SubNetX extraction failed.");
      }
      setSuggestions([]);
      setResult(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "SubNetX extraction failed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-[28px] border border-border bg-white shadow-sm dark:border-dark_border dark:bg-darkmode">
      <div className="border-b border-border bg-[linear-gradient(105deg,rgba(244,178,43,0.14),rgba(47,115,242,0.08))] px-6 py-6 dark:border-dark_border">
        <p className="reactenz-eyebrow">CPLEX-free candidate extraction</p>
        <h2 className="reactenz-api-example-title mt-2 text-midnight_text dark:text-white">Bounded E. coli ARBRE extraction</h2>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-muted dark:text-white/60">
          Search the source-attributed ARBRE graph for bounded candidate routes into E. coli metabolism. This stage does not perform CPLEX optimization, yield ranking, or final feasibility validation.
        </p>
      </div>
      <form className="grid gap-4 p-6" onSubmit={submit}>
        <div>
          <StructureSearchField
            compact
            label="Target name, ARBRE/LCSB ID, InChIKey, or structure"
            onChange={setTarget}
            placeholder="Name, ID, InChIKey, SMILES, or draw / load a structure"
            replaceOnApply
            rows={4}
            value={target}
          />
          <button className="mt-3 rounded-xl border border-primary px-4 py-2 text-sm font-black text-primary" onClick={() => void searchTarget().catch((cause) => setError(cause instanceof Error ? cause.message : "Search failed."))} type="button">Find target</button>
        </div>
        {suggestions.length ? (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((item) => <button className="rounded-full border border-border px-3 py-1.5 text-xs font-bold dark:border-dark_border" key={item.compound_id} onClick={() => { setTarget(item.compound_id); setSuggestions([]); }} type="button">{item.name} · {item.compound_id}</button>)}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-5">
          <label className="text-sm font-bold">Core paths<select className="ml-3 rounded-lg border border-border bg-white px-3 py-2 dark:border-dark_border dark:bg-darkmode" onChange={(event) => setPathCount(Number(event.target.value))} value={pathCount}>{[1, 3, 5].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="flex items-center gap-2 text-sm font-bold"><input checked={expand} onChange={(event) => setExpand(event.target.checked)} type="checkbox" />One bounded boundary-expansion round</label>
          <button className="ml-auto rounded-xl bg-primary px-5 py-3 text-sm font-black text-white disabled:cursor-wait disabled:opacity-60" disabled={running || !target.trim()} type="submit">{running ? "Queued or extracting..." : "Extract candidate subnetwork"}</button>
        </div>
        <p className="text-xs leading-5 text-muted dark:text-white/50">Requests are serialized and capped at 120 nodes. Targets must match a compound in the bundled ARBRE index.</p>
      </form>
      {error ? <div className="mx-6 mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}
      {result ? (
        <div className="border-t border-border p-6 dark:border-dark_border">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="reactenz-eyebrow">Candidate result</p><h3 className="mt-1 text-lg font-bold">{result.target.name} → {result.host}</h3></div><span className="rounded-full bg-green/10 px-3 py-1 text-xs font-black text-green">{result.elapsed_seconds.toFixed(2)} seconds</span></div>
          <p className="mt-3 text-sm text-muted">{result.network.node_count} compounds · {result.network.edge_count} edges · {result.network.reaction_count} source reactions · {result.unresolved_boundaries.length} unresolved boundaries</p>
          {result.target.smiles || result.target.name ? (
            <p className="mt-3 text-sm leading-6 text-muted">
              ARBRE compound IDs are not ReactEnzDB reaction IDs.{" "}
              <Link className="font-black text-primary hover:underline" href={transformationSearchHref({ products: result.target.smiles || result.target.name })}>
                Search the target as a product
              </Link>
              {result.selected_precursors[0] && (result.selected_precursors[0].smiles || result.selected_precursors[0].name) ? (
                <>
                  {" "}or{" "}
                  <Link className="font-black text-primary hover:underline" href={transformationSearchHref({ substrates: result.selected_precursors[0].smiles || result.selected_precursors[0].name, products: result.target.smiles || result.target.name })}>
                    search precursor → target
                  </Link>
                </>
              ) : null}
              . Enzyme records appear only after a database reaction is resolved.
            </p>
          ) : null}
          <div className="mt-5 space-y-3">
            {result.core_paths.map((path, index) => <article className="rounded-2xl border border-border p-4 dark:border-dark_border" key={index}><p className="text-xs font-black uppercase tracking-wide text-primary">Core path #{index + 1}</p><p className="mt-2 break-words text-sm leading-7">{path.map((item) => item.name).join(" → ")}</p></article>)}
          </div>
          {result.unresolved_boundaries.length ? <p className="mt-4 text-xs leading-6 text-muted">Unresolved boundary examples: {result.unresolved_boundaries.slice(0, 12).map((item) => item.name || item.compound_id).join(", ")}.</p> : null}
          <p className="mt-3 text-xs leading-5 text-muted dark:text-white/50">{result.note}</p>
        </div>
      ) : null}
    </section>
  );
}
