import { keggAccessPolicy } from "./keggSourcePolicy.mjs";

export type IncludeSet = Set<string>;

export function apiJson(data: unknown, meta: Record<string, unknown> = {}, status = 200): Response {
  return Response.json(
    {
      meta: {
        api_version: "2026.09.1",
        kegg_access_policy: keggAccessPolicy,
        pathways_status: "KEGG_MEMBERSHIP_WITHHELD",
        license_note:
          "ReactEnzDB-added curation and derived summary tables are released as documented on the Downloads page; source database terms remain applicable.",
        ...meta,
        ...(meta.export_xls ? { export_xls: null, export_status: "WITHHELD_PENDING_SOURCE_SEPARATION" } : {}),
      },
      data,
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export function apiError(message: string, status = 400, details?: Record<string, unknown>): Response {
  return Response.json(
    {
      error: {
        message,
        status,
        ...details,
      },
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export function textParam(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key)?.trim();
  return value || undefined;
}

export function boolParam(params: URLSearchParams, key: string): boolean | undefined {
  const value = params.get(key)?.trim().toLowerCase();
  if (value === "true" || value === "1" || value === "yes") return true;
  if (value === "false" || value === "0" || value === "no") return false;
  return undefined;
}

export function intParam(params: URLSearchParams, key: string, fallback: number, min: number, max: number): number {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export function listPaging(params: URLSearchParams): { page: number; pageSize: number } {
  return {
    page: intParam(params, "page", 1, 1, 1000000),
    pageSize: intParam(params, "pageSize", 20, 1, 100),
  };
}

export function detailLimit(params: URLSearchParams, fallback = 120): number {
  return intParam(params, "limit", fallback, 1, 1000);
}

export function includeSet(params: URLSearchParams, defaults: string[]): IncludeSet {
  const raw = params.get("include")?.trim();
  const values = raw
    ? raw
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    : defaults;
  if (values.includes("all")) {
    return new Set(["all"]);
  }
  return new Set(values);
}

export function hasInclude(includes: IncludeSet, key: string): boolean {
  return includes.has("all") || includes.has(key);
}

export function requestUrl(request: Request): URL {
  return new URL(request.url);
}
