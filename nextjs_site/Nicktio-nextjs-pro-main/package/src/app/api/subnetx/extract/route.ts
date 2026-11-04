import { NextResponse } from "next/server";
import { acquireModelQueueSlot, ModelQueueAbortedError, type ModelQueueSlot } from "@/lib/modelQueue";
import { getRetrosynthesisToolRegistry } from "@/lib/retrosynthesisToolRegistry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SERVICE_URL = process.env.SUBNETX_SERVICE_URL?.trim().replace(/\/$/, "") ?? "";
const TIMEOUT_MS = Math.max(1_000, Number(process.env.SUBNETX_TIMEOUT_MS) || 180_000);

function jsonError(message: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  let queueSlot: ModelQueueSlot | null = null;
  try {
    const body = await request.json() as { target?: string; pathCount?: number; expansionRounds?: number; maxNodes?: number };
    const target = body.target?.trim() ?? "";
    if (!target || target.length > 2_000) return jsonError("Provide an ARBRE/LCSB ID, compound name, InChIKey, or exact SMILES.", 400);
    if (!SERVICE_URL) return jsonError("This deployment does not include the SubNetX extraction runtime.", 503);
    queueSlot = await acquireModelQueueSlot("reactenzdb:subnetx", request.signal);
    const response = await fetch(`${SERVICE_URL}/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target,
        pathCount: Math.max(1, Math.min(Math.floor(Number(body.pathCount) || 3), 5)),
        expansionRounds: Math.max(0, Math.min(Math.floor(Number(body.expansionRounds) || 0), 1)),
        maxNodes: Math.max(40, Math.min(Math.floor(Number(body.maxNodes) || 120), 180)),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const payload = await response.json() as Record<string, unknown> & { error?: string; suggestions?: unknown };
    if (!response.ok) return jsonError(payload.error || "SubNetX rejected this extraction request.", response.status, payload.suggestions ? { suggestions: payload.suggestions } : {});
    const identity = getRetrosynthesisToolRegistry().tools.find((tool) => tool.tool_id === "subnetx");
    return NextResponse.json({ ...payload, tool_identity: identity ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ModelQueueAbortedError) return jsonError("The queued SubNetX request was cancelled.", 499);
    console.error("SubNetX extraction failed", error instanceof Error ? error.message : error);
    return jsonError("SubNetX could not return a bounded candidate subnetwork for this target.", 422);
  } finally {
    await queueSlot?.release();
  }
}

