import { NextResponse } from "next/server";
import { describeTools } from "@/lib/tools";
import { siteConfig } from "@/lib/config";
import { verifyEngineCitations } from "@/lib/sources/arxiv";

/**
 * /api/tools — the same tool catalogue the MCP endpoint serves, in plain JSON.
 *
 * Useful for anyone who wants to see the agent surface without speaking
 * JSON-RPC, and it doubles as the machine-readable index of this product.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const tools = describeTools();
  return NextResponse.json({
    product: siteConfig.name,
    repository: siteConfig.repository,
    mcpEndpoint: `${siteConfig.liveUrl}/api/mcp`,
    manifest: `${siteConfig.liveUrl}/mcp.json`,
    transport: "JSON-RPC 2.0 over HTTP POST",
    counts: {
      total: tools.length,
      read: tools.filter((tool) => tool.kind === "read").length,
      analysis: tools.filter((tool) => tool.kind === "analysis").length,
      mutation: tools.filter((tool) => tool.kind === "mutation").length,
    },
    tools,
    citationsVerified: (await verifyEngineCitations()).map((entry) => ({
      arxivId: entry.arxivId,
      found: entry.found,
      titleMatches: entry.titleMatches,
      status: entry.status,
    })),
  });
}