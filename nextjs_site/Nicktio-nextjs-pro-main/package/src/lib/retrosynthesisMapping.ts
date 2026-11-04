import { releasePath } from "@/lib/paths";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);

export type ReactionStructureMapping = {
  reaction_id: string;
  equation: string | null;
  reaction_direction: string | null;
  participants_complete: number;
  orientation: "as_written" | "reversed";
  direction_status: "unspecified" | "supported_by_reference";
  match_basis: "exact_query_structures" | "protonation_normalized";
  matched_left_count: number;
  matched_right_count: number;
  query_left_count: number;
  query_right_count: number;
  additional_participants: Record<"precursors" | "products", Array<{ name: string | null; smiles: string }>>;
  accepted_reaction_identity: false;
  review_required: string[];
};

export type StructureMappingResult = {
  status: string;
  normalization_policy: string;
  rdkit_version?: string;
  query: { precursors: string; product: string };
  matches: ReactionStructureMapping[];
  excluded: Array<{ reaction_id: string; reason: string }>;
  total_matches: number;
  truncated: boolean;
};

export async function resolveReactionStructures(precursors: string, product: string): Promise<StructureMappingResult> {
  const python = process.env.REACTENZDB_PYTHON ?? "python";
  const script = path.resolve(process.cwd(), "scripts/retrosynthesis_mapping.py");
  const index = process.env.REACTENZDB_RETROSYNTHESIS_LOOKUP_DB
    ?? releasePath("retrosynthesis_reaction_lookup.sqlite");
  if (!fs.existsSync(index)) throw new Error("Reaction lookup is unavailable");
  const { stdout } = await runFile(python, [script, "--index", index, "--limit", "5", "--query", JSON.stringify({ precursors, product })], {
    encoding: "utf8", timeout: 15000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
  });
  return JSON.parse(stdout) as StructureMappingResult;
}
