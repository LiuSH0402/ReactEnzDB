import { releasePath } from "@/lib/paths";
import path from "node:path";
import { apiError, apiJson, intParam, requestUrl, textParam } from "@/lib/reactenzdb-api";
import { parseSearchQuery } from "@/lib/reactenzdb";
import { querySqlite } from "@/lib/sqlite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MODEL_READY_DB_PATH = releasePath("model_ready_dataset.sqlite");

type ExternalValidationFilter = "any" | "brenda_exact" | "sabio_rk_exact" | "either_exact" | "both_exact";

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function validationFilter(value: string | undefined): ExternalValidationFilter {
  if (value === "brenda_exact" || value === "sabio_rk_exact" || value === "either_exact" || value === "both_exact") return value;
  return "any";
}

function validationWhere(filter: ExternalValidationFilter): string {
  if (filter === "brenda_exact") return "candidate.brenda_exact_kinetic_count > 0";
  if (filter === "sabio_rk_exact") return "candidate.sabio_rk_exact_kinetic_count > 0";
  if (filter === "either_exact") return "candidate.external_exact_kinetic_count > 0";
  if (filter === "both_exact") return "candidate.brenda_exact_kinetic_count > 0 AND candidate.sabio_rk_exact_kinetic_count > 0";
  return "1 = 1";
}

export async function GET(request: Request) {
  try {
    const url = requestUrl(request);
    const view = textParam(url.searchParams, "view") === "all" ? "model_ready_reactions" : "model_ready_trainable_reactions";
    const externalValidation = validationFilter(textParam(url.searchParams, "externalValidation"));
    const page = intParam(url.searchParams, "page", 1, 1, 1_000_000);
    const pageSize = intParam(url.searchParams, "pageSize", 20, 1, 100);
    const query = textParam(url.searchParams, "q");
    const clauses: string[] = [];
    if (query) {
      const parsed = parseSearchQuery(query);
      if (parsed.kind === "reaction_id") {
        const id = sqlString(parsed.value);
        clauses.push(`(reaction.reactenz_reaction_id = ${id} OR reaction.reaction_id = ${id})`);
      } else if (parsed.kind === "ec") {
        clauses.push(`reaction.ec_number = ${sqlString(parsed.value)}`);
      } else if (parsed.kind === "rhea") {
        const id = sqlString(parsed.value);
        clauses.push(`(reaction.rhea_id = ${id} OR reaction.rhea_id = ${sqlString(`RHEA:${parsed.value}`)})`);
      } else if (parsed.kind === "kegg") {
        clauses.push(`reaction.kegg_reaction_id = ${sqlString(parsed.value)}`);
      } else if (parsed.kind === "text") {
        const pattern = sqlString(`%${parsed.value}%`);
        clauses.push(`(reaction.reactenz_reaction_id LIKE ${pattern} OR reaction.reaction_id LIKE ${pattern} OR COALESCE(reaction.ec_number, '') LIKE ${pattern} OR COALESCE(reaction.rhea_id, '') LIKE ${pattern})`);
      } else {
        clauses.push("1 = 0");
      }
    }
    if (externalValidation !== "any") {
      clauses.push(`EXISTS (
        SELECT 1
        FROM model_ready_enzyme_candidates AS candidate
        WHERE candidate.reaction_id = reaction.reaction_id
          AND ${validationWhere(externalValidation)}
      )`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const offset = (page - 1) * pageSize;
    const total = Number(querySqlite<{ total: number }>(MODEL_READY_DB_PATH, `SELECT COUNT(*) AS total FROM ${view} AS reaction ${where}`)[0]?.total ?? 0);
    const rows = querySqlite<Record<string, unknown>>(
      MODEL_READY_DB_PATH,
      `SELECT reaction.*,
              COUNT(candidate.candidate_id) AS candidate_count,
              COALESCE(SUM(candidate.brenda_exact_kinetic_count), 0) AS brenda_exact_kinetic_matches,
              COALESCE(SUM(candidate.sabio_rk_exact_kinetic_count), 0) AS sabio_rk_exact_kinetic_matches,
              COALESCE(SUM(candidate.external_exact_kinetic_count), 0) AS external_exact_kinetic_matches
       FROM ${view} AS reaction
       LEFT JOIN model_ready_enzyme_candidates AS candidate ON candidate.reaction_id = reaction.reaction_id
       ${where}
       GROUP BY reaction.reaction_id
       ORDER BY reaction.evidence_score DESC, reaction.kinetics_count DESC, reaction.reactenz_reaction_id
       LIMIT ${pageSize} OFFSET ${offset}`,
    );
    return apiJson(rows, {
      endpoint: "/api/reactenzdb/model-ready",
      view: view === "model_ready_trainable_reactions" ? "default_trainable" : "all_model_ready",
      externalValidation,
      external_validation_definition: "Only web_kinetic_external_checks.match_status = matched counts as exact confirmation; weak_match and EC-only statuses are excluded.",
      trainable_definition: "canonical reaction SMILES, complete participant SMILES, formula-balanced, non-currency-only, and at least one enzyme candidate.",
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Model-ready query failed.", 400);
  }
}
