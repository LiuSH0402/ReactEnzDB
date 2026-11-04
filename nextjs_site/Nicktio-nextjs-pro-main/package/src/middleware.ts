import { NextRequest, NextResponse } from "next/server";

type Bucket = { count: number; resetAt: number };

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 120;
const buckets = new Map<string, Bucket>();

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.endsWith("/release-file")) return NextResponse.next();

  const now = Date.now();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const key = forwarded || request.headers.get("x-real-ip") || "local";
  const current = buckets.get(key);
  const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + WINDOW_MS } : current;
  bucket.count += 1;
  buckets.set(key, bucket);

  if (buckets.size > 10_000) {
    for (const [bucketKey, value] of buckets) {
      if (value.resetAt <= now) buckets.delete(bucketKey);
    }
  }

  const remaining = Math.max(0, MAX_REQUESTS - bucket.count);
  if (bucket.count > MAX_REQUESTS) {
    return NextResponse.json(
      { meta: { status: 429, error: "rate_limit_exceeded" }, data: null },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))),
          "X-RateLimit-Limit": String(MAX_REQUESTS),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(bucket.resetAt / 1000)),
        },
      },
    );
  }

  const response = NextResponse.next();
  response.headers.set("X-RateLimit-Limit", String(MAX_REQUESTS));
  response.headers.set("X-RateLimit-Remaining", String(remaining));
  response.headers.set("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
  return response;
}

export const config = {
  matcher: ["/api/reactenzdb/:path*", "/api/retrosynthesis/:path*"],
};
