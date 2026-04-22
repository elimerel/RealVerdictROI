import type { MetadataRoute } from "next";

function siteUrl(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  return (fromEnv || "http://localhost:3000").replace(/\/$/, "");
}

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // /results is per-deal and uses user-supplied inputs in the URL —
        // no SEO value, lots of crawl waste. /api is server-only.
        // /dashboard and /compare require auth or local state.
        disallow: ["/results", "/api/", "/dashboard", "/compare"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
