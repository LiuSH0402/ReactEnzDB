import { NextResponse } from "next/server";
import { getPairLiterature } from "@/lib/pairLiterature";
import { findEnzymeCandidates, getReaction } from "@/lib/reactenzdb";
import { getReactionCandidateEvidence } from "@/lib/evidence-release";
import { resolveReactionStructures } from "@/lib/retrosynthesisMapping";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function serializeTarget(target: NonNullable<ReturnType<typeof getReaction>>) {
  return {
    reactenz_reaction_id: target.reactenz_reaction_id,
    equation: target.reaction_equation_display ?? target.reaction_equation_raw,
    ec_number: target.ec_number,
    rhea_id: target.rhea_id,
    kegg_reaction_id: target.kegg_reaction_id,
    metacyc_reaction_id: target.metacyc_reaction_id,
  };
}

export async function POST(request: Request) {
  try {
    let body: { precursors?: string; product?: string };
    try {
      body = await request.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) return error("Provide a JSON object with precursor and product SMILES.", 400);
    } catch {
      return error("Provide valid JSON with precursor and product SMILES.", 400);
    }
    const precursors = typeof body.precursors === "string" ? body.precursors.trim() : "";
    const product = typeof body.product === "string" ? body.product.trim() : "";
    if (!precursors || !product || precursors.length > 6_000 || product.length > 2_000) {
      return error("Provide precursor and product SMILES within the supported length limit.", 400);
    }

    if (precursors.split(".").length > 64 || product.split(".").length > 32) {
      return error("Too many molecular components in this query.", 400);
    }
    const resolved = await resolveReactionStructures(precursors, product);
    const matches = resolved.matches.flatMap((match) => {
      const reaction = getReaction(match.reaction_id);
      // Never resurrect hidden records or attach an index built for another equation.
      if (!reaction || reaction.reaction_direction !== match.reaction_direction
          || reaction.reaction_equation_display !== match.equation) return [];
      const candidates = findEnzymeCandidates({ target: reaction.reactenz_reaction_id, limit: 30 }).candidates;
      const evidence = getReactionCandidateEvidence(match.reaction_id, candidates.map((row) => row.biopart_id));
      const pairs = new Map(evidence.summaries.map((row) => [row.biopart_id, row]));
      return [{
        target: serializeTarget(reaction),
        structure_match: match,
        evidence_available: evidence.available,
        candidates: candidates.map((candidate) => ({ ...candidate,
          reaction_evidence: pairs.get(candidate.biopart_id) ?? null,
          literature_record_count: getPairLiterature(match.reaction_id, candidate.biopart_id).length,
          reaction_evidence_url: `/api/retrosynthesis/evidence?reactionId=${encodeURIComponent(reaction.reactenz_reaction_id)}&enzymeId=${encodeURIComponent(candidate.reactenz_enzyme_id)}`,
        })),
      }];
    });
    const unique = resolved.total_matches === 1 && matches.length === 1 ? matches[0] : undefined;
    const classification = matches.length
      ? {
          level: unique ? "candidate_query_structures" : "ambiguous_query_structures",
          label: unique ? "Candidate reference reaction" : "Multiple candidate reference reactions",
          note: "Submitted structures are covered by these reference reactions, allowing protonation normalization. Check direction, additional participants and reaction–enzyme evidence before choosing a pathway step. A structure match does not verify catalysis or a complete balanced reaction.",
        }
      : {
          level: resolved.status === "no_match" ? "no_match" : resolved.status,
          label: resolved.status === "invalid_or_wildcard_structure" ? "Incomplete or invalid molecular structure"
            : resolved.status === "no_net_query_transformation" ? "No net query transformation" : "No eligible reference reaction",
          note: "No linked enzymes are assigned to this query. Unspecified structures, unchanged molecules and reference records that oppose the requested direction cannot establish this transformation.",
        };

    return NextResponse.json(
      {
        classification,
        target: unique?.target ?? null,
        structure_match: unique?.structure_match ?? null,
        candidates: unique?.candidates ?? [],
        matches,
        alternatives: [],
        query: resolved.query,
        normalization_policy: resolved.normalization_policy,
        rdkit_version: resolved.rdkit_version,
        excluded: resolved.excluded,
        total_reference_matches: resolved.total_matches,
        truncated: resolved.truncated,
        accepted_reaction_identity: false,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (caught) {
    console.error("Retrosynthesis reaction match failed", caught);
    return error("Reaction matching is temporarily unavailable. The server's reaction lookup and chemistry runtime must use the same release.", 503);
  }
}
