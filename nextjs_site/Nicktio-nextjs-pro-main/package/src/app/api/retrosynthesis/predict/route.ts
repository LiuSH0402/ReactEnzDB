import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { acquireModelQueueSlot, ModelQueueAbortedError, type ModelQueueSlot } from "@/lib/modelQueue";
import { getRetrosynthesisToolRegistry } from "@/lib/retrosynthesisToolRegistry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const MAX_TARGET_LENGTH = 2_000;
const MAX_TOP_K = 10;
const PREDICTION_TIMEOUT_MS = Math.max(1_000, Number(process.env.RETROSYNTHESIS_TIMEOUT_MS) || 120_000);
const PREDICTION_SERVICE_URL = process.env.RETROSYNTHESIS_SERVICE_URL?.trim().replace(/\/$/, "") ?? "";
const REQUEST_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 3;
const requests = new Map<string, { count: number; resetAt: number }>();

type Predictor = "gsetretro" | "readretro" | "bionavi_np";

function clientKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}

function mayRun(request: Request): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const key = clientKey(request);
  const current = requests.get(key);
  const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + REQUEST_WINDOW_MS } : current;
  bucket.count += 1;
  requests.set(key, bucket);
  if (bucket.count > MAX_REQUESTS_PER_WINDOW) return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  return { allowed: true };
}

function jsonError(message: string, status: number, retryAfter?: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store", ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}) } },
  );
}

export async function POST(request: Request) {
  const access = mayRun(request);
  if (!access.allowed) return jsonError("Prediction limit reached. Please try again shortly.", 429, access.retryAfter);

  let queueSlot: ModelQueueSlot | null = null;
  try {
    const body = await request.json() as { tool?: string; target?: string; topK?: number };
    const tool = body.tool as Predictor;
    const target = body.target?.trim() ?? "";
    const topK = Math.max(1, Math.min(Math.floor(Number(body.topK) || 5), MAX_TOP_K));
    if (!(["gsetretro", "readretro", "bionavi_np"] as string[]).includes(tool)) return jsonError("Unknown predictor.", 400);
    if (!target || target.length > MAX_TARGET_LENGTH) return jsonError("Provide one valid target SMILES under 2,000 characters.", 400);

    queueSlot = await acquireModelQueueSlot(`reactenzdb:${tool}`, request.signal);
    let payload: Record<string, unknown>;
    if (PREDICTION_SERVICE_URL) {
      const response = await fetch(`${PREDICTION_SERVICE_URL}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, target, topK }),
        signal: AbortSignal.timeout(PREDICTION_TIMEOUT_MS),
        cache: "no-store",
      });
      const servicePayload = await response.json() as Record<string, unknown> & { error?: string };
      if (!response.ok) {
        return jsonError(servicePayload.error || "The CPU predictor service rejected this request.", response.status);
      }
      payload = servicePayload;
    } else {
      const reactenzRoot = path.resolve(process.cwd(), "../../../");
      const python = process.env.RETROSYNTHESIS_PYTHON ?? path.join(reactenzRoot, ".gsetretro-venv", "Scripts", "python.exe");
      const script = path.join(reactenzRoot, "scripts", "run_retrosynthesis_predictor.py");
      if (!fs.existsSync(python) || !fs.existsSync(script)) {
        return jsonError("This deployment does not include the local CPU predictor runtime.", 503);
      }
      const { stdout } = await execFileAsync(python, [script, "--tool", tool, "--target", target, "--top-k", String(topK)], {
        cwd: reactenzRoot,
        encoding: "utf8",
        timeout: PREDICTION_TIMEOUT_MS,
        maxBuffer: 1024 * 1024 * 2,
        windowsHide: true,
      });
      payload = JSON.parse(stdout.trim()) as Record<string, unknown>;
    }
    const registry = getRetrosynthesisToolRegistry();
    const identity = registry.tools.find((item) => item.tool_id === tool);
    return NextResponse.json({
      ...payload,
      tool_identity: identity ? {
        registry_version: registry.registry_version,
        name: identity.name,
        reactenzdb_scope: identity.reactenzdb_scope,
        code_license: identity.code_license,
        model_weights_license: identity.model_weights_license,
        checkpoint: identity.checkpoint,
        paper: identity.paper,
      } : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ModelQueueAbortedError) return jsonError("The queued prediction request was cancelled.", 499);
    const message = error instanceof Error ? error.message : "Prediction failed.";
    console.error("Retrosynthesis prediction failed", message);
    return jsonError("The selected CPU predictor could not return a result for this target.", 422);
  } finally {
    await queueSlot?.release();
  }
}
