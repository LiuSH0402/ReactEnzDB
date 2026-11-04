"use client";

import Link from "next/link";
import { useState, type ChangeEvent, type FormEvent } from "react";
import {
  MAX_PATHWAY_INPUT_CHARS,
  parseManualPathway,
  parseRetrosynthesisPathway,
  parseTsvPathway,
  type PathwayInputResult,
  type PathwayInputStep,
  type PathwayDirection,
} from "@/lib/pathwayHostInput";

type HostOption = { host_id: string; scientific_name: string; strain: string; model_name: string; release_id: string; version_ref: string };
type Mode = "manual" | "tsv" | "retrosynthesis";
type CheckedStep = { step: number; reaction_id: string; requested_direction: string; record_status: "FOUND" | "UNKNOWN_ID"; equation: string | null; recorded_direction: string | null };
type Validation = {
  validation_only: true;
  all_record_ids_found: boolean;
  mapping_publication_status: "RELEASED_IN_2026.09.1";
  selected_releases: Array<{ host_id: string; release_id: string; model_name: string }>;
  steps: CheckedStep[];
  note: string;
};
type Preview = {
  schema_version: "pathway-host-local-staging-preview-v3";
  staging_only: true;
  reviewed: false;
  publication_status: "RELEASED_IN_2026.09.1";
  direction_check_scope: string;
  pathway_connectivity_scope: string;
  heterologous_scope: string;
  summaries: Array<{ host_id: string; release_id: string; model_name: string; recorded_exact_native_steps: number; recorded_directional_native_steps: number; context_only_steps: number; not_mapped_in_model_steps: number; unresolved_or_missing_steps: number; unknown_reaction_id_steps: number; coefficient_evidence_insufficient_steps: number; direction_supported_record_steps: number; direction_conflict_steps: number; model_no_exact_match_steps: number }>;
  steps: Array<{ step: number; reaction_id: string; requested_direction: string; record_status: "FOUND" | "UNKNOWN_ID"; coefficient_evidence: { status: "SOURCE_NAME_CONFIRMED" | "INSUFFICIENT"; reasons: string[] }; hosts: Array<{ host_id: string; release_id: string; mapping_status: string; model_reaction_id: string | null; direction_relation: string | null; direction_check: { status: string; reason: string }; model_gap_check: string }> }>;
  adjacent_links: Array<{ from_step: number; to_step: number; status: string; shared: Array<{ chebi_id: string; name: string }>; reason: string; compartment_check: "UNVERIFIED" }>;
  pathway_resource_requirements: { status: "INSUFFICIENT" | "UNIT_STEP_ONLY" | "SINGLE_CHAIN_PROVISIONAL"; reasons: string[]; unit_step_ledger: Array<{ resource: string; gross_consumption: number; gross_production: number; net_requirement: number; net_production: number }> | null; chain_scaled_ledger: Array<{ resource: string; gross_consumption: number; gross_production: number; net_requirement: number; net_production: number }> | null; step_multipliers: number[] | null; oxygen_consuming_steps: number[]; compartment_check: "UNVERIFIED" };
  note: string;
};

const modes: Array<{ id: Mode; title: string; description: string }> = [
  { id: "manual", title: "Reaction IDs", description: "One ID per line, or comma-separated" },
  { id: "tsv", title: "TSV", description: "Ordered step and reaction_id columns" },
  { id: "retrosynthesis", title: "Retrosynthesis result", description: "Exact match JSON or resolved steps" },
];

function parseInput(mode: Mode, text: string, manualDirection: PathwayDirection): PathwayInputResult {
  if (mode === "tsv") return parseTsvPathway(text);
  if (mode === "retrosynthesis") return parseRetrosynthesisPathway(text);
  return parseManualPathway(text, manualDirection);
}

export default function PathwayHostInputWorkbench({ hosts, initialReactionId, mappingPreviewEnabled = false }: { hosts: HostOption[] | null; initialReactionId: string; mappingPreviewEnabled?: boolean }) {
  const [mode, setMode] = useState<Mode>("manual");
  const [manualDirection, setManualDirection] = useState<PathwayDirection>("unspecified");
  const [text, setText] = useState(initialReactionId);
  const [fileName, setFileName] = useState("");
  const [releaseIds, setReleaseIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<PathwayInputResult | null>(null);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [exportRequest, setExportRequest] = useState<{ steps: PathwayInputStep[]; release_ids: string[] } | null>(null);
  const [lastDigest, setLastDigest] = useState("");
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [hostQuery, setHostQuery] = useState("");

  function changeMode(next: Mode) {
    setMode(next); setText(""); setFileName(""); setDraft(null); setValidation(null); setPreview(null); setExportRequest(null); setLastDigest(""); setError("");
  }

  function toggleRelease(id: string) {
    setValidation(null); setPreview(null); setExportRequest(null); setLastDigest(""); setError("");
    setReleaseIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function readTsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setDraft(null); setValidation(null); setPreview(null); setExportRequest(null); setLastDigest(""); setError(""); setFileName(file?.name ?? "");
    if (!file) return;
    if (file.size > MAX_PATHWAY_INPUT_CHARS) { setText(""); setError("The TSV exceeds the 16 KB local input limit; nothing was uploaded."); return; }
    setText(await file.text());
  }

  function resetWorkbench() {
    setText(""); setFileName(""); setReleaseIds([]); setHostQuery(""); setDraft(null); setValidation(null); setPreview(null); setExportRequest(null); setLastDigest(""); setError("");
  }

  const filteredHosts = (hosts ?? []).filter((host) => {
    const query = hostQuery.trim().toLowerCase();
    if (!query) return true;
    return `${host.scientific_name} ${host.strain} ${host.model_name} ${host.host_id} ${host.release_id}`.toLowerCase().includes(query);
  });
  const canSubmit = Boolean(hosts?.length) && releaseIds.length >= 1 && !running;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidation(null); setPreview(null); setExportRequest(null); setLastDigest(""); setError("");
    const parsed = parseInput(mode, text, manualDirection);
    setDraft(parsed);
    if (parsed.errors.length) return;
    if (!hosts) { setError("Staging registry is not mounted. No model release can be selected or validated here."); return; }
    if (releaseIds.length < 1) { setError("Select at least one fixed model release before validation."); return; }
    setRunning(true);
    try {
      const response = await fetch(mappingPreviewEnabled ? "/api/reactenzdb/pathway/host-context/preview" : "/api/reactenzdb/pathway/host-context/validate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steps: parsed.steps satisfies PathwayInputStep[], release_ids: releaseIds }),
      });
      const payload = await response.json() as (Validation | Preview) & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Input validation failed.");
      if (mappingPreviewEnabled) { setPreview(payload as Preview); setExportRequest({ steps: parsed.steps, release_ids: [...releaseIds] }); }
      else setValidation(payload as Validation);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Input validation failed."); }
    finally { setRunning(false); }
  }

  async function download(format: "json-download" | "steps-tsv" | "resources-tsv") {
    if (!exportRequest) return;
    const filenames = { "json-download": "pathway-host-context-local-preview.json", "steps-tsv": "pathway-steps-local-preview.tsv", "resources-tsv": "pathway-resources-local-preview.tsv" };
    setError(""); setLastDigest("");
    try {
      const response = await fetch(`/api/reactenzdb/pathway/host-context/preview?format=${format}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(exportRequest) });
      if (!response.ok) throw new Error(`Local export failed (${response.status}).`);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = filenames[format]; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setLastDigest(`${filenames[format]} downloaded`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Local export failed."); }
  }

  return (
    <form className="reactenz-phc-workbench" onSubmit={(event) => void submit(event)}>
      <div className="reactenz-phc-board">
      <div className="reactenz-phc-card">
        <h2 className="reactenz-api-example-title text-midnight_text dark:text-white">1. Enter ordered reactions</h2>
        <p className="mt-2 text-sm leading-6 text-muted">This checks record identity and order only. It does not infer pathway direction from a list or reverse a retrosynthesis route.</p>
        <div aria-label="Input method" className="mt-5 grid gap-2 sm:grid-cols-3" role="group">
          {modes.map((item) => (
            <button aria-pressed={mode === item.id} className={`min-w-0 border-b-2 px-2 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-primary ${mode === item.id ? "border-primary text-primary" : "border-border text-muted hover:border-primary/50 dark:border-dark_border"}`} key={item.id} onClick={() => changeMode(item.id)} type="button">
              <span className="block text-sm font-bold">{item.title}</span><span className="mt-1 block text-xs leading-4">{item.description}</span>
            </button>
          ))}
        </div>
        {mode === "tsv" ? (
          <label className="mt-6 block text-sm font-bold text-midnight_text dark:text-white">Choose a local TSV (not uploaded)
            <input accept=".tsv,text/tab-separated-values,text/plain" className="mt-2 block w-full text-sm font-normal text-muted file:mr-4 file:rounded-lg file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:font-bold file:text-primary" onChange={(event) => void readTsv(event)} type="file" />
            {fileName ? <span className="mt-2 block break-all text-xs font-normal text-muted">Loaded in this browser: {fileName}</span> : null}
          </label>
        ) : null}
        <label className="mt-6 block text-sm font-bold text-midnight_text dark:text-white">
          {mode === "manual" ? "ReactEnzDB reaction IDs" : mode === "tsv" ? "TSV preview / edit" : "Paste resolved retrosynthesis JSON"}
          <textarea className="mt-2 block min-h-48 w-full rounded-lg border border-border bg-white px-4 py-3 font-mono text-sm font-normal leading-6 text-midnight_text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-dark_border dark:bg-darkmode dark:text-white" maxLength={MAX_PATHWAY_INPUT_CHARS} onChange={(event) => { setText(event.target.value); setDraft(null); setValidation(null); setPreview(null); setExportRequest(null); setLastDigest(""); setError(""); }} placeholder={mode === "manual" ? "R00001\nR03369" : mode === "tsv" ? "step\treaction_id\tdirection\n1\tR00001\tunspecified" : '{"steps":[{"reaction_id":"R00001","direction":"unspecified"}]}'} spellCheck={false} value={text} />
        </label>
        {mode === "manual" ? <label className="mt-4 block max-w-xs text-sm font-bold text-midnight_text dark:text-white">Direction for all manual steps
          <select className="mt-2 block w-full border border-border bg-white px-4 py-3 dark:border-dark_border dark:bg-darkmode" onChange={(event) => { setManualDirection(event.target.value as PathwayDirection); setDraft(null); setValidation(null); setPreview(null); setExportRequest(null); setLastDigest(""); }} value={manualDirection}>
            <option value="unspecified">Unspecified · checks remain pending</option>
            <option value="forward">Forward · displayed left → right</option>
            <option value="reverse">Reverse · displayed right → left</option>
          </select>
        </label> : null}
        <p className="mt-2 text-xs leading-5 text-muted">1–30 steps; canonical IDs have the form R00001. Paste one ID per line, or separate IDs with commas, spaces or semicolons. Duplicate steps are retained and flagged. Direction may be forward, reverse or unspecified; unspecified blocks later net-resource interpretation.</p>
        {mode === "manual" ? <p className="mt-1 text-xs leading-5 text-muted">For mixed directions, use TSV with a direction on each row.</p> : null}
        {mode === "retrosynthesis" ? <p className="mt-3 text-sm leading-6 text-muted">Candidate matches require reviewing participants, direction and pair evidence. Enter the chosen stable reaction ID and direction manually after review. Previously resolved exact results remain importable; raw RetroBioCat rule labels and SubNetX compound paths cannot be converted automatically. <Link className="font-semibold text-primary hover:underline" href="/tools">Open Tools →</Link></p> : null}
        {mode === "tsv" ? <p className="mt-3 font-mono text-xs leading-6 text-muted">step[TAB]reaction_id[TAB]direction (optional) · one row per step · numbering begins at 1</p> : null}
      </div>

      <div className="reactenz-phc-card">
        <h2 className="reactenz-api-example-title text-midnight_text dark:text-white">2. Fix model releases</h2>
        <p className="mt-2 text-sm leading-6 text-muted">Select any number of the {hosts?.length ?? 30} fixed model releases, including all of them. {mappingPreviewEnabled ? "Mapping results are unreviewed and must not be cited as curated host evidence." : "Selecting a collected model is not reaction mapping or permission to publish comparisons."}</p>
          {hosts ? (
          <div className="mt-5 border-y border-border py-3 dark:border-dark_border">
            <p className="text-sm font-bold text-primary">Choose host models · {releaseIds.length} of {hosts.length} selected</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="rounded-lg border border-primary px-3 py-1 text-xs font-semibold text-primary hover:bg-primary hover:text-white" onClick={() => { setValidation(null); setPreview(null); setExportRequest(null); setLastDigest(""); setError(""); setReleaseIds(hosts.map((host) => host.release_id)); }} type="button">Select all</button>
              {releaseIds.length ? <button className="rounded-lg border border-border px-3 py-1 text-xs font-semibold text-muted hover:border-primary hover:text-primary dark:border-dark_border" onClick={() => { setValidation(null); setPreview(null); setExportRequest(null); setLastDigest(""); setError(""); setReleaseIds([]); }} type="button">Clear selection</button> : null}
            </div>
            <label className="mt-3 block text-xs font-bold uppercase tracking-wider text-muted">Filter by species, strain, or model
              <input className="mt-2 block w-full rounded-lg border border-border bg-white px-3 py-2 text-sm font-normal text-midnight_text dark:border-dark_border dark:bg-darkmode dark:text-white" onChange={(event) => setHostQuery(event.target.value)} placeholder="Escherichia, iML1515, yeast…" type="search" value={hostQuery} />
            </label>
            <div className="mt-3 max-h-72 space-y-1 overflow-y-auto pr-2">
              {filteredHosts.length ? filteredHosts.map((host) => (
                <label className="flex cursor-pointer items-start gap-3 border-b border-border/60 py-2 text-sm dark:border-dark_border" key={host.release_id}>
                  <input checked={releaseIds.includes(host.release_id)} className="mt-1 accent-primary" onChange={() => toggleRelease(host.release_id)} type="checkbox" />
                  <span className="min-w-0"><strong className="block break-words text-midnight_text dark:text-white"><i>{host.scientific_name}</i> · {host.strain}</strong><span className="mt-0.5 block break-all font-mono text-xs text-muted">{host.model_name} · {host.release_id}</span></span>
                </label>
              )) : <p className="py-3 text-sm text-muted">No host model matches this filter.</p>}
            </div>
          </div>
        ) : <p className="mt-5 border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:bg-amber-950/20 dark:text-amber-100" role="status">Staging registry not mounted. Host selection and server validation are unavailable; input can still be drafted locally.</p>}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <button className="text-sm font-black text-muted hover:text-primary" onClick={resetWorkbench} type="button">Clear</button>
          <button className="min-h-11 rounded-lg bg-primary px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-[#173552] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50" disabled={!canSubmit} type="submit">{running ? "Checking inputs…" : releaseIds.length < 1 ? "Select at least one host model first" : mappingPreviewEnabled ? "Look up selected host models" : "Validate inputs only"}</button>
        </div>
        {releaseIds.length < 1 && hosts ? <p className="mt-3 text-xs font-semibold text-amber-800 dark:text-amber-300">Pick at least one collected host model. Nothing is selected by default; this is a lookup, not a recommendation.</p> : null}
        <p className="mt-3 text-xs leading-5 text-muted">The TSV/JSON file itself stays in your browser. This action sends only ordered IDs, declared directions and release IDs to the local read-only validation endpoint. No analysis ID or saved job is created.</p>
        {error ? <p className="mt-4 border-l-4 border-red-500 pl-3 text-sm font-semibold text-red-700" role="alert">{error}</p> : null}
      </div>
      </div>

      {(draft || validation || preview) ? (
        <section aria-live="polite" className="reactenz-phc-card reactenz-phc-result">
          <h2 className="reactenz-api-example-title text-midnight_text dark:text-white">3. {preview ? "Local pathway checks" : "Input validation"}</h2>
          {draft?.errors.length ? <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-red-700" role="alert">{draft.errors.map((item, index) => <li key={index}>{item}</li>)}</ul> : null}
          {draft?.warnings.length ? <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-amber-800 dark:text-amber-300">{draft.warnings.map((item, index) => <li key={index}>{item}</li>)}</ul> : null}
          {validation ? (
            <>
              <p className="mt-4 text-sm font-semibold text-midnight_text dark:text-white">{validation.all_record_ids_found ? "All reaction IDs were found." : "Some reaction IDs were not found."} Selected model releases: {validation.selected_releases.length}. Mapping: NOT RELEASED.</p>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-muted">{validation.note}</p>
              <div className="mt-5 overflow-x-auto border-y border-border dark:border-dark_border">
                <table className="w-full min-w-[580px] text-left text-sm">
                  <thead><tr className="text-xs uppercase tracking-wide text-muted"><th className="py-3 pr-4">Step</th><th className="py-3 pr-4">Reaction</th><th className="py-3 pr-4">ID check</th><th className="py-3 pr-4">Requested direction</th><th className="py-3">Equation in ReactEnzDB</th></tr></thead>
                  <tbody className="divide-y divide-border dark:divide-dark_border">{validation.steps.map((step) => (
                    <tr key={step.step}><td className="py-3 pr-4 font-mono">{step.step}</td><td className="py-3 pr-4 font-mono">{step.record_status === "FOUND" ? <Link className="text-primary hover:underline" href={`/reactions/${step.reaction_id}`}>{step.reaction_id}</Link> : step.reaction_id}</td><td className="py-3 pr-4 font-semibold">{step.record_status === "FOUND" ? "Found" : "Unknown ID"}</td><td className="py-3 pr-4">{step.requested_direction}</td><td className="max-w-lg py-3 text-muted">{step.equation ?? "—"}</td></tr>
                  ))}</tbody>
                </table>
              </div>
              <p className="mt-4 text-sm font-semibold text-amber-800 dark:text-amber-300">There is no pathway–host implementation profile, native-step count, heterologous gap or host suitability result in this preview.</p>
            </>
          ) : null}
          {preview ? (
            <div className="mt-5">
              <p className="border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">Freeze 2026.09.1 host-model lookup. Mapping sample is not human-reviewed. Direction and adjacency are checked where evidence permits; model compartments, transport, flux and implementation feasibility are not validated. No host suitability ranking is provided.</p>
              <p className="mt-3 text-sm leading-6 text-muted">{preview.note}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2 border-y border-border py-4 dark:border-dark_border">
                <span className="mr-2 text-xs font-bold text-muted">Local, request-scoped exports:</span>
                {(["json-download", "steps-tsv", "resources-tsv"] as const).map((format) => <button className="border border-primary px-3 py-2 text-xs font-bold text-primary hover:bg-primary hover:text-white" key={format} onClick={() => void download(format)} type="button">{format === "json-download" ? "Complete JSON" : format === "steps-tsv" ? "Step × host TSV" : "Resource TSV"}</button>)}
                <a className="text-xs font-semibold text-primary hover:underline" href="/api/reactenzdb/host-context-preview/manifest" rel="nofollow">Schema, field dictionary & manifest →</a>
                {lastDigest ? <p className="w-full break-all font-mono text-xs text-muted">{lastDigest}</p> : null}
              </div>
              <div className="mt-5 overflow-x-auto border-y border-border dark:border-dark_border">
                <table className="w-full min-w-[1080px] text-left text-sm">
                  <thead><tr className="text-xs uppercase text-muted"><th className="py-3 pr-4">Model</th><th className="py-3 pr-4">Exact native*</th><th className="py-3 pr-4">Directional native*</th><th className="py-3 pr-4">Direction supported*</th><th className="py-3 pr-4">Direction conflict*</th><th className="py-3 pr-4">No exact model match</th><th className="py-3 pr-4">Context only</th><th className="py-3">Unresolved / missing</th></tr></thead>
                  <tbody className="divide-y divide-border dark:divide-dark_border">{preview.summaries.map((host) => (
                    <tr key={host.release_id}><td className="py-3 pr-4 font-semibold">{host.model_name}<span className="block font-mono text-xs text-muted">{host.host_id}</span></td><td className="py-3 pr-4">{host.recorded_exact_native_steps}</td><td className="py-3 pr-4">{host.recorded_directional_native_steps}</td><td className="py-3 pr-4">{host.direction_supported_record_steps}</td><td className="py-3 pr-4">{host.direction_conflict_steps}</td><td className="py-3 pr-4">{host.model_no_exact_match_steps}</td><td className="py-3 pr-4">{host.context_only_steps}</td><td className="py-3">{host.unresolved_or_missing_steps}</td></tr>
                  ))}</tbody>
                </table>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted">* Frozen mapping relation in the ReactEnzDB equation frame; conflict and insufficient results remain distinct. Direction support is not a flux or growth simulation.</p>
              {preview.adjacent_links.length ? <section className="mt-6 border-t border-border pt-5 dark:border-dark_border">
                <h3 className="text-lg font-bold">Adjacent-step chemical continuity</h3>
                <p className="mt-1 text-sm text-muted">Exact ChEBI product–substrate overlap only. Compartments and transport remain unverified; no overlap is not proof that a longer route is impossible.</p>
                <ul className="mt-3 space-y-2">{preview.adjacent_links.map((link) => <li className="border-l-2 border-primary/40 pl-3 text-sm" key={`${link.from_step}-${link.to_step}`}><strong>Step {link.from_step} → {link.to_step}: {link.status.replaceAll("_", " ")}</strong><span className="block text-muted">{link.reason}</span>{link.shared.length ? <span className="block text-xs text-muted">Shared: {link.shared.map((item) => `${item.name} (${item.chebi_id})`).join("; ")}</span> : null}</li>)}</ul>
              </section> : null}
              <section className="mt-7 border-t border-border pt-6 dark:border-dark_border">
                <h3 className="text-lg font-bold">Pathway Resource Requirements</h3>
                <p className="mt-1 max-w-4xl text-sm leading-6 text-muted">Descriptive reaction stoichiometry only, independent of host model supply. Gross consumption and production are summed before netting. A single-chain multiplier is provisional; no compartment, transport or flux validation is implied.</p>
                <p className="mt-3 text-sm font-semibold">Status: {preview.pathway_resource_requirements.status.replaceAll("_", " ")}</p>
                {preview.pathway_resource_requirements.reasons.length ? <ul className="mt-2 list-disc pl-5 text-xs leading-5 text-amber-800 dark:text-amber-300">{preview.pathway_resource_requirements.reasons.slice(0, 8).map((reason, index) => <li key={index}>{reason}</li>)}</ul> : null}
                {preview.pathway_resource_requirements.unit_step_ledger ? <>
                  <p className="mt-4 text-xs font-bold text-muted">One execution of each declared step (unscaled). These totals are not automatically a per-product pathway requirement.</p>
                  <ResourceTable rows={preview.pathway_resource_requirements.unit_step_ledger} />
                </> : <p className="mt-3 text-sm text-muted">No numeric resource result is issued while direction, coefficient or resource identity evidence is insufficient.</p>}
                {preview.pathway_resource_requirements.chain_scaled_ledger ? <>
                  <p className="mt-5 text-xs font-bold text-muted">Provisional unique-intermediate chain scaling · relative multipliers {preview.pathway_resource_requirements.step_multipliers?.join(" : ")}; initial step fixed to 1. Compartments and biological flux remain unverified.</p>
                  <ResourceTable rows={preview.pathway_resource_requirements.chain_scaled_ledger} />
                </> : null}
                {preview.pathway_resource_requirements.oxygen_consuming_steps.length ? <p className="mt-3 text-xs text-muted">Oxygen consumed in step(s): {preview.pathway_resource_requirements.oxygen_consuming_steps.join(", ")} (not a host oxygen-supply check).</p> : null}
              </section>
              <div className="mt-6 space-y-4">{preview.steps.map((step) => (
                <div className="border-l-2 border-primary/40 pl-4" key={step.step}>
                  <p className="font-semibold">Step {step.step} · {step.record_status === "FOUND" ? <Link className="text-primary hover:underline" href={`/reactions/${step.reaction_id}`}>{step.reaction_id}</Link> : step.reaction_id} · {step.requested_direction} · {step.record_status}</p>
                  <p className={`mt-1 text-xs font-semibold ${step.coefficient_evidence.status === "INSUFFICIENT" ? "text-amber-800 dark:text-amber-300" : "text-muted"}`}>
                    {step.coefficient_evidence.status === "INSUFFICIENT" ? "Coefficient evidence insufficient" : "Coefficient text reconciled with the current equation (not chemical identity validation)"}
                    {step.coefficient_evidence.reasons.length ? ` · ${step.coefficient_evidence.reasons.join(", ")}` : ""}
                  </p>
                  <ul className="mt-2 grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-3">{step.hosts.map((host) => (
                    <li className="border border-border px-3 py-2 dark:border-dark_border" key={host.release_id}><span className="font-semibold">{host.host_id}</span><span className="block font-mono text-xs">{host.mapping_status}</span><span className="block text-xs">Direction: {host.direction_check.status.replaceAll("_", " ")}</span><span className="block text-xs">Model gap: {host.model_gap_check.replaceAll("_", " ")}</span>{host.model_reaction_id ? <span className="block text-xs text-muted">Model reaction: {host.model_reaction_id} · {host.direction_relation}</span> : null}<Link className="mt-1 inline-block text-xs font-semibold text-primary hover:underline" href={`/tools/pathway-host-context/evidence?reactionId=${encodeURIComponent(step.reaction_id)}&releaseId=${encodeURIComponent(host.release_id)}`}>Evidence board →</Link></li>
                  ))}</ul>
                  {step.hosts.some((host) => host.model_gap_check === "MODEL_NO_EXACT_MATCH" || host.model_gap_check === "CONTEXT_ONLY_NO_NATIVE_MATCH") ? <p className="mt-2 text-xs text-muted">No exact model match is a follow-up question, not proof of biological absence.</p> : null}
                </div>
              ))}</div>
            </div>
          ) : null}
        </section>
      ) : null}
    </form>
  );
}

function ResourceTable({ rows }: { rows: NonNullable<Preview["pathway_resource_requirements"]["unit_step_ledger"]> }) {
  return rows.length ? <div className="mt-3 overflow-x-auto border-y border-border dark:border-dark_border"><table className="w-full min-w-[620px] text-left text-xs sm:text-sm"><thead><tr className="text-muted"><th className="py-2 pr-3">Resource</th><th className="py-2 pr-3">Gross consumption</th><th className="py-2 pr-3">Gross production</th><th className="py-2 pr-3">Net requirement</th><th className="py-2">Net production</th></tr></thead><tbody className="divide-y divide-border dark:divide-dark_border">{rows.map((row) => <tr key={row.resource}><th className="py-2 pr-3 font-semibold">{row.resource}</th><td className="py-2 pr-3">{row.gross_consumption}</td><td className="py-2 pr-3">{row.gross_production}</td><td className="py-2 pr-3">{row.net_requirement}</td><td className="py-2">{row.net_production}</td></tr>)}</tbody></table></div> : <p className="mt-3 text-xs text-muted">No listed cofactor/resource occurs in the currently evidenced steps.</p>;
}
