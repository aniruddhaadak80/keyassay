import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Assay detail pages are session-scoped, so there is nothing public to
        // index there; the shared verify route accepts a query parameter and is
        // still useful without one.
        disallow: ["/api/", "/ledger/"],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: absoluteUrl("/"),
  };
}