import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/site";

// Wola is private: only the sign-in page may be crawled. (Allow wins over
// Disallow for the longer, more specific rule.) Every other page is also
// noindex via meta tag and X-Robots-Tag header, so a stray link can't leak it.
export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await siteOrigin();
  return {
    rules: [{ userAgent: "*", allow: ["/login$"], disallow: ["/"] }],
    sitemap: `${origin}/sitemap.xml`,
  };
}
