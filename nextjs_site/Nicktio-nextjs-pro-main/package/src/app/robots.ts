import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://reactenzdb.lin-group.cn").replace(/\/$/, "");
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/reactenzdb/export"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
