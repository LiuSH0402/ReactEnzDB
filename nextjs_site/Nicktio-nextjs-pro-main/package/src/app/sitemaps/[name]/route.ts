import { sitemapFileResponse } from "@/lib/sitemap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return sitemapFileResponse(name);
}
