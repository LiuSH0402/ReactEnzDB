import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getVisitorSummary, registerAnonymousVisitor } from "@/lib/visitorAnalytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VISITOR_COOKIE = "reactenzdb_visitor_id";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const BOT_PATTERN = /bot|crawler|spider|slurp|preview|facebookexternalhit|headless|lighthouse|monitor/i;

function json(summary: ReturnType<typeof getVisitorSummary>, status = 200) {
  return NextResponse.json(summary, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
}

export async function GET() {
  try {
    return json(getVisitorSummary());
  } catch (error) {
    console.error("Unable to read ReactEnzDB visitor analytics", error);
    return NextResponse.json({ error: "visitor_statistics_unavailable" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userAgent = request.headers.get("user-agent") ?? "";
    const doNotTrack = request.headers.get("dnt") === "1";
    const fetchSite = request.headers.get("sec-fetch-site");
    const sameOrigin = !fetchSite || fetchSite === "same-origin" || fetchSite === "same-site" || fetchSite === "none";

    if (doNotTrack || BOT_PATTERN.test(userAgent) || !sameOrigin) {
      return json(getVisitorSummary());
    }

    const existingVisitorId = request.cookies.get(VISITOR_COOKIE)?.value;
    const visitorId = existingVisitorId && /^[0-9a-f-]{36}$/i.test(existingVisitorId)
      ? existingVisitorId
      : crypto.randomUUID();
    const response = json(registerAnonymousVisitor(visitorId));

    if (visitorId !== existingVisitorId) {
      const forwardedProtocol = request.headers.get("x-forwarded-proto");
      response.cookies.set(VISITOR_COOKIE, visitorId, {
        httpOnly: true,
        maxAge: COOKIE_MAX_AGE,
        path: "/",
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:" || forwardedProtocol === "https",
      });
    }

    return response;
  } catch (error) {
    console.error("Unable to register ReactEnzDB visitor", error);
    return NextResponse.json({ error: "visitor_registration_unavailable" }, { status: 503 });
  }
}
