"use client";

import Link from "next/link";
import { useState } from "react";
import CandidateComparison from "@/components/ReactEnz/CandidateComparison";
import ReactionCandidateEvidence from "@/components/ReactEnz/ReactionCandidateEvidence";
import type { EnzymeCandidateRow } from "@/lib/reactenzdb";
import type { ReactionEnzymeEvidenceSummary } from "@/lib/evidence-release";
import type { ReactionStructureMapping } from "@/lib/retrosynthesisMapping";
import { transformationSearchHref } from "@/lib/transformationSearch";

export type MappingMatch = {
  target: {
    reactenz_reaction_id: string;
    equation: string | null;
    ec_number: string | null;
    rhea_id: string | null;
    kegg_reaction_id: string | null;
    metacyc_reaction_id: string | null;
  };
  structure_match: {
    matched_left_count: number;
    matched_right_count: number;
    query_left_count: number;
    query_right_count: number;
  } & Partial<ReactionStructureMapping> | null;
  evidence_available?: boolean;
  candidates: Array<EnzymeCandidateRow & {
    reaction_evidence?: ReactionEnzymeEvidenceSummary | null;
    reaction_evidence_url?: string;
    literature_record_count?: number;
  }>;
};

export type MappingResponse = {
  classification: { level: string; label: string; note: string };
  target: MappingMatch["target"] | null;
  structure_match: MappingMatch["structure_match"];
  candidates: EnzymeCandidateRow[];
  matches?: MappingMatch[];
  alternatives: Array<{ reactenz_reaction_id: string }>;
  excluded?: Array<{ reaction_id: string; reason: string }>;
  truncated?: boolean;
  total_reference_matches?: number;
};

function crossIds(target: MappingMatch["target"]) {
  return [
    target.ec_number ? `EC ${target.ec_number}` : null,
    target.rhea_id ? `Rhea ${target.rhea_id}` : null,
    target.kegg_reaction_id ? `KEGG ${target.kegg_reaction_id}` : null,
    target.metacyc_reaction_id ? `MetaCyc ${target.metacyc_reaction_id}` : null,
  ].filter(Boolean);
}

function MatchedReactionCard({ match, index, total }: { match: MappingMatch; index: number; total: number }) {
  const ids = crossIds(match.target);
  const [showAll, setShowAll] = useState(false);
  return (
    <div className={total > 1 ? "mt-4 rounded-2xl border border-border px-4 py-4 dark:border-dark_border" : "mt-4"}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-black text-midnight_text dark:text-white">
          {total > 1 ? `Matched reference reaction ${index + 1} of ${total}` : "Matched reference reaction"}
        </span>
        <Link className="rounded-full bg-primary px-3 py-1 font-mono text-xs font-black text-white hover:bg-primary/90" href={`/reactions/${match.target.reactenz_reaction_id}`}>
          {match.target.reactenz_reaction_id}
        </Link>
        <Link className="text-xs font-bold text-primary hover:underline" href={`/tools/pathway-host-context?reactionId=${encodeURIComponent(match.target.reactenz_reaction_id)}`}>
          Validate as a pathway step →
        </Link>
        {ids.map((id) => <span className="rounded-full bg-hero-bg px-3 py-1 text-xs font-bold text-muted dark:bg-dark_b" key={id}>{id}</span>)}
      </div>
      {match.target.equation ? <p className="mt-3 text-sm leading-6 text-muted dark:text-white/60">{match.target.equation}</p> : null}
      {match.structure_match ? <div className="mt-2 space-y-2 text-xs leading-5 text-muted dark:text-white/60">
        <p>{match.structure_match.match_basis === "protonation_normalized" ? "Protonation-normalized" : "Exact canonical"} query-side coverage: {match.structure_match.matched_left_count}/{match.structure_match.query_left_count} precursors and {match.structure_match.matched_right_count}/{match.structure_match.query_right_count} products. Stereochemistry is retained.</p>
        <p>Direction: {match.structure_match.direction_status === "supported_by_reference" ? "supported by the reference record" : "unspecified in the reference; requires review"}{match.structure_match.orientation === "reversed" ? " (opposite to the written equation)" : ""}. This does not establish the measured assay direction or pathway feasibility.</p>
        {match.structure_match.participants_complete === 0 ? <p>Some reference participant structures are unavailable or unspecified.</p> : null}
        {match.structure_match.additional_participants ? <details>
          <summary className="cursor-pointer font-bold text-primary">Additional reference participants</summary>
          {(["precursors", "products"] as const).map((side) => <div className="mt-2" key={side}>
            <span className="font-bold">{side === "precursors" ? "Input side" : "Output side"}: </span>
            {match.structure_match?.additional_participants?.[side].length ? match.structure_match.additional_participants[side].map((item, i) => <span key={i} title={item.smiles}>{i ? "; " : ""}{item.name ?? item.smiles}</span>) : "None in the indexed structures"}
          </div>)}
          <p className="mt-2">Check the full equation and stoichiometry; submitted molecules alone do not specify all cofactors or co-substrates.</p>
        </details> : null}
      </div> : null}

      {match.candidates.length ? (
        <>
          <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="reactenz-eyebrow">Database connection</p>
              <h4 className="mt-1 text-[20px]">{match.candidates.length} returned core enzyme records</h4>
            </div>
            <Link className="text-sm font-black text-primary hover:underline" href={`/reactions/${match.target.reactenz_reaction_id}`}>Open reaction record</Link>
          </div>
          <div className="mt-3 overflow-x-auto rounded-xl border border-border dark:border-dark_border">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-hero-bg text-xs uppercase tracking-wider text-muted dark:bg-dark_b">
                <tr><th className="px-3 py-3">Enzyme</th><th className="px-3 py-3">Source Organism</th><th className="px-3 py-3">Sequence</th><th className="px-3 py-3">Kinetics</th><th className="px-3 py-3">Structure</th><th className="px-3 py-3">Annotation Richness</th><th className="px-3 py-3">Reaction-specific evidence</th></tr>
              </thead>
              <tbody className="divide-y divide-border dark:divide-dark_border">
                {(showAll ? match.candidates : match.candidates.slice(0, 10)).map((candidate) => (
                  <tr key={`${match.target.reactenz_reaction_id}:${candidate.reactenz_enzyme_id}`}>
                    <td className="px-3 py-3"><Link className="font-black text-primary hover:underline" href={`/enzymes/${candidate.reactenz_enzyme_id}`}>{candidate.reactenz_enzyme_id}</Link><div className="mt-1 max-w-52 truncate text-xs text-muted">{candidate.enzyme_name ?? "Unnamed enzyme"}</div></td>
                    <td className="px-3 py-3 text-muted dark:text-white/65">{candidate.organism ?? "NA"}</td>
                    <td className="px-3 py-3 text-muted dark:text-white/65">{candidate.sequence_length ? `${candidate.sequence_length} aa` : "Missing"}</td>
                    <td className="px-3 py-3 text-muted dark:text-white/65">{candidate.kinetic_count}</td>
                    <td className="px-3 py-3 text-muted dark:text-white/65">{candidate.pdb_count} PDB / {candidate.alphafold_count} AF</td>
                    <td className="px-3 py-3 font-black text-primary">{candidate.evidence_score}</td>
                    <td className="px-3 py-3">{candidate.reaction_evidence_url ? <ReactionCandidateEvidence available={match.evidence_available ?? false} summary={candidate.reaction_evidence ?? null} literatureCount={candidate.literature_record_count ?? 0} url={candidate.reaction_evidence_url} /> : "Not loaded"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {match.candidates.length > 10 ? <button className="mt-3 text-sm font-bold text-primary hover:underline" onClick={() => setShowAll(!showAll)} type="button">{showAll ? "Show first 10 enzymes" : `Show all ${match.candidates.length} returned enzymes`}</button> : null}
          <p className="mt-2 text-xs text-muted">Up to 30 core candidates are returned in annotation-richness order. This score is not a probability of activity. Open the reaction record for the full candidate list.</p>
          {match.candidates.length > 1 ? <CandidateComparison candidates={match.candidates} /> : null}
        </>
      ) : (
        <p className="mt-4 rounded-xl bg-hero-bg px-4 py-3 text-sm text-muted dark:bg-dark_b dark:text-white/60">No linked ReactEnzDB enzyme candidates were returned for this transformation.</p>
      )}
    </div>
  );
}

export default function ReactionMatchPanel({ mapping }: { mapping: MappingResponse }) {
  const matches: MappingMatch[] = mapping.matches?.length
    ? mapping.matches
    : mapping.target
      ? [{ target: mapping.target, structure_match: mapping.structure_match, candidates: mapping.candidates }]
      : [];
  const stateClass = mapping.classification.level === "exact_query_structures"
    ? "border-green/25 bg-green/5"
    : mapping.classification.level === "no_match"
      ? "border-amber-200 bg-amber-50"
      : "border-primary/20 bg-primary/5";

  return (
    <div className="mt-4 rounded-2xl border border-border bg-white p-4 dark:border-dark_border dark:bg-darkmode">
      <div className={`rounded-xl border px-4 py-3 ${stateClass}`}>
        <p className="text-sm font-black text-midnight_text dark:text-white">{mapping.classification.label}</p>
        <p className="mt-1 text-xs leading-5 text-muted dark:text-white/60">{mapping.classification.note}</p>
      </div>

      {mapping.truncated ? <p className="mt-2 text-xs text-muted">Showing {matches.length} of {mapping.total_reference_matches} candidate reference records. Narrow the input to resolve additional alternatives.</p> : null}
      {mapping.excluded?.length ? <details className="mt-3 text-xs text-muted"><summary className="cursor-pointer">Excluded reference records ({mapping.excluded.length})</summary><ul className="mt-2 space-y-1">{mapping.excluded.map((item, i) => <li key={i}>{item.reaction_id}: {item.reason.replaceAll("_", " ")}</li>)}</ul></details> : null}

      {matches.map((match, index) => (
        <MatchedReactionCard index={index} key={`${match.target.reactenz_reaction_id}:${match.structure_match?.orientation ?? "as_written"}`} match={match} total={matches.length} />
      ))}

      {!matches.length && mapping.alternatives.length ? (
        <div className="mt-4">
          <p className="text-sm font-black text-midnight_text dark:text-white">Possible reference reactions</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {mapping.alternatives.map((alternative) => (
              <Link className="rounded-full bg-primary px-3 py-1 font-mono text-xs font-black text-white hover:bg-primary/90" href={transformationSearchHref({ reaction: alternative.reactenz_reaction_id })} key={alternative.reactenz_reaction_id}>
                {alternative.reactenz_reaction_id}
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {!matches.length && !mapping.candidates.length ? (
        <p className="mt-4 rounded-xl bg-hero-bg px-4 py-3 text-sm text-muted dark:bg-dark_b dark:text-white/60">No linked ReactEnzDB enzyme candidates were returned for this transformation.</p>
      ) : null}
    </div>
  );
}
