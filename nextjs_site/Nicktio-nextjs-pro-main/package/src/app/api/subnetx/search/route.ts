import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SERVICE_URL = process.env.SUBNETX_SERVICE_URL?.trim().replace(/\/$/, "") ?? "";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!query || query.length > 500) return NextResponse.json({ results: [] }, { headers: { "Cache-Control": "no-store" } });
  if (!SERVICE_URL) return NextResponse.json({ error: "This deployment does not include the SubNetX extraction runtime." }, { status: 503 });
  try {
    const response = await fetch(`${SERVICE_URL}/search?q=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    return NextResponse.json(await response.json(), { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "SubNetX target search is unavailable." }, { status: 503 });
  }
}

