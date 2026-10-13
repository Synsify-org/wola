import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/site";

// Only genuinely public pages. Everything behind sign-in is deliberately absent.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await siteOrigin();
  return [{ url: `${origin}/login`, changeFrequency: "yearly", priority: 1 }];
}
