import { NextResponse } from "next/server";
import { acquireModelQueueSlot, ModelQueueAbortedError, type ModelQueueSlot } from "@/lib/modelQueue";
import { getRetrosynthesisToolRegistry } from "@/lib/retrosynthesisToolRegistry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SERVICE_URL = process.env.RETROBIOCAT_SERVICE_URL?.trim().replace(/\/$/, "") ?? "";
const TIMEOUT_MS = Math.max(1_000, Number(process.env.RETROBIOCAT_TIMEOUT_MS) || 240_000);

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  let queueSlot: ModelQueueSlot | null = null;
  try {
    const body = await request.json() as { target?: string; steps?: number; topK?: number };
    const target = body.target?.trim() ?? "";
    const steps = Math.max(1, Math.min(Math.floor(Number(body.steps) || 2), 3));
    const topK = Math.max(1, Math.min(Math.floor(Number(body.topK) || 5), 10));
    if (!target || target.length > 2_000) return jsonError("Provide one valid target SMILES under 2,000 characters.", 400);
    if (!SERVICE_URL) return jsonError("This deployment does not include the RetroBioCat pathway runtime.", 503);

    queueSlot = await acquireModelQueueSlot("reactenzdb:retrobiocat", request.signal);
    const response = await fetch(`${SERVICE_URL}/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, steps, topK }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const payload = await response.json() as Record<string, unknown> & { error?: string };
    if (!response.ok) return jsonError(payload.error || "RetroBioCat rejected this planning request.", response.status);
    const registry = getRetrosynthesisToolRegistry();
    const identity = registry.tools.find((tool) => tool.tool_id === "retrobiocat");
    return NextResponse.json(
      {
        ...payload,
        tool_identity: identity ? {
          registry_version: registry.registry_version,
          name: identity.name,
          reactenzdb_scope: identity.reactenzdb_scope,
          code_license: identity.code_license,
          data_license: identity.data_license,
          paper: identity.paper,
        } : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ModelQueueAbortedError) return jsonError("The queued pathway request was cancelled.", 499);
    console.error("RetroBioCat pathway planning failed", error instanceof Error ? error.message : error);
    return jsonError("RetroBioCat could not return a pathway for this target.", 422);
  } finally {
    await queueSlot?.release();
  }
}
