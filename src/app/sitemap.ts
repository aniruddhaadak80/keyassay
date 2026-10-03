import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/config";

/** Every functional user route, so nothing shipped is left unindexed. */
export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [
    { path: "", priority: 1, changeFrequency: "daily" as const },
    { path: "/ledger", priority: 0.9, changeFrequency: "daily" as const },
    { path: "/horizon", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/standards", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/agent", priority: 0.7, changeFrequency: "weekly" as const },
    { path: "/export", priority: 0.6, changeFrequency: "weekly" as const },
    { path: "/verify", priority: 0.6, changeFrequency: "weekly" as const },
    { path: "/settings", priority: 0.5, changeFrequency: "monthly" as const },
  ];

  return routes.map((route) => ({
    url: absoluteUrl(route.path || "/"),
    lastModified: new Date(),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}