import { releasePath } from "@/lib/paths";
import fs from "node:fs";
import path from "node:path";

export type RetrosynthesisToolEntry = {
  tool_id: string;
  name: string;
  capability_class: "live_single_step_predictor" | "live_rule_based_planner" | "bounded_candidate_subnetwork_extractor" | "rule_and_activity_resource" | "case_study_subnetwork_resource";
  reactenzdb_status: string;
  reactenzdb_scope: string;
  input: string;
  output: string;
  upstream_repository: string;
  paper: { citation: string; doi: string };
  code_license: { status: string; spdx?: string | null; deployment_action?: string };
  model_weights_license?: { status: string; deployment_action?: string };
  data_license?: { status: string; spdx?: string | null; doi?: string };
  checkpoint?: { file: string; size_bytes?: number; sha256?: string; redistributed_by_reactenzdb?: boolean };
  enzyme_mapping: string;
};

export type RetrosynthesisToolRegistry = {
  registry_version: string;
  release_version: string;
  policy: {
    prediction_is_not_evidence: boolean;
    score_policy: string;
    mapping_policy: string;
    redistribution_policy: string;
  };
  tools: RetrosynthesisToolEntry[];
};

const REGISTRY_PATH = releasePath("RETROSYNTHESIS_TOOL_REGISTRY.json");

export function getRetrosynthesisToolRegistry(): RetrosynthesisToolRegistry {
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8")) as RetrosynthesisToolRegistry;
}
