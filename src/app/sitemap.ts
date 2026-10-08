import type { MetadataRoute } from "next";

/** Public product pages only; never enumerate private workspace or share URLs. */
export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/docs", "/docs/integrations", "/privacy", "/terms", "/support"].map(path => ({
    url: `https://tallyhand.xyz${path}`,
  }));
}
