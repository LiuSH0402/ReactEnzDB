import { listSitemapEnzymeIds, listSitemapReactionIds } from "@/lib/reactenzdb";
import { REACTENZDB_RELEASE } from "@/lib/release";

const STATIC_ROUTES = [
  "",
  "/search",
  "/browse",
  "/expression-evidence",
  "/reactions",
  "/enzymes",
  "/hosts",
  "/sequence-families",
  "/sequence-families/candidates",
  "/organisms",
  "/chassis",
  "/tools",
  "/tools/gsetretro",
  "/tools/readretro",
  "/tools/bionavi-np",
  "/tools/retrobiocat",
  "/tools/subnetx",
  "/tools/pathway-host-context",
  "/retrosynthesis",
  "/statistics",
  "/downloads",
  "/documentation/api",
  "/methodology",
  "/maintenance",
  "/help",
  "/about",
];

// The sitemap protocol allows at most 50,000 URLs per file.
const URLS_PER_FILE = 40_000;
const LAST_MODIFIED = REACTENZDB_RELEASE.date;

type Entry = { path: string; changefreq: string; priority: string };

export function siteBase(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://reactenzdb.lin-group.cn").replace(/\/$/, "");
}

function chunkCount(total: number): number {
  return Math.max(1, Math.ceil(total / URLS_PER_FILE));
}

export function sitemapFileNames(): string[] {
  const reactionFiles = chunkCount(listSitemapReactionIds().length);
  const enzymeFiles = chunkCount(listSitemapEnzymeIds().length);
  return [
    "static.xml",
    ...Array.from({ length: reactionFiles }, (_, index) => `reactions-${index + 1}.xml`),
    ...Array.from({ length: enzymeFiles }, (_, index) => `enzymes-${index + 1}.xml`),
  ];
}

function entriesFor(name: string): Entry[] | null {
  if (name === "static.xml") {
    return STATIC_ROUTES.map((route) => ({
      path: route,
      changefreq: route === "" ? "weekly" : "monthly",
      priority: route === "" ? "1.0" : route === "/search" || route === "/browse" ? "0.9" : "0.7",
    }));
  }
  const match = /^(reactions|enzymes)-(\d+)\.xml$/.exec(name);
  if (!match) return null;
  const ids = match[1] === "reactions" ? listSitemapReactionIds() : listSitemapEnzymeIds();
  const index = Number(match[2]) - 1;
  if (index < 0 || index >= chunkCount(ids.length)) return null;
  return ids.slice(index * URLS_PER_FILE, (index + 1) * URLS_PER_FILE).map((id) => ({
    path: `/${match[1]}/${encodeURIComponent(id)}`,
    changefreq: "monthly",
    priority: "0.5",
  }));
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function xmlResponse(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${body}\n`, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}

export function sitemapIndexResponse(): Response {
  const base = siteBase();
  const items = sitemapFileNames()
    .map((name) => `  <sitemap><loc>${escapeXml(`${base}/sitemaps/${name}`)}</loc><lastmod>${LAST_MODIFIED}</lastmod></sitemap>`)
    .join("\n");
  return xmlResponse(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</sitemapindex>`);
}

export function sitemapFileResponse(name: string): Response {
  const entries = entriesFor(name);
  if (!entries) return new Response("Not found", { status: 404 });
  const base = siteBase();
  const items = entries
    .map((entry) => `  <url><loc>${escapeXml(`${base}${entry.path}`)}</loc><lastmod>${LAST_MODIFIED}</lastmod><changefreq>${entry.changefreq}</changefreq><priority>${entry.priority}</priority></url>`)
    .join("\n");
  return xmlResponse(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</urlset>`);
}
