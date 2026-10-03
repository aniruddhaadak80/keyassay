import type { Metadata } from "next";
import { describeTools } from "@/lib/tools";
import { siteConfig } from "@/lib/config";
import { AgentConsole } from "@/components/agent-console";
import { GitHubLink } from "@/components/github-link";
import { SectionHeading } from "@/components/states";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Agent console",
  description:
    "A live MCP JSON-RPC 2.0 console: initialize, tools/list and tools/call against the same service layer the interface uses.",
  alternates: { canonical: `${siteConfig.liveUrl}/agent` },
};

/**
 * The agent console page.
 *
 * The schemas below come from the same `TOOLS` declaration the JSON-RPC
 * dispatcher validates against, so this page cannot drift from what the endpoint
 * actually accepts.
 */
export default function AgentPage() {
  const tools = describeTools();

  return (
    <div className="pt-10">
      <SectionHeading
        eyebrow="Agent interface"
        title="Drive Keyassay over JSON-RPC"
        lede="Nine tools over one service layer: read the ledger, assay a live host, re-rate against a different risk position, seal a decision, replay a chain, export a certificate. No key, no account."
      />

      <div className="sheet rounded-sm p-5">
        <p className="ledger-head">Point your MCP client at</p>
        <div className="mt-2 space-y-2">
          <p className="font-mono text-sm break-all text-ultramarine-700">{siteConfig.liveUrl}/api/mcp</p>
          <p className="font-mono text-xs text-ash-600">
            Manifest: {siteConfig.liveUrl}/mcp.json · Plain JSON catalogue: {siteConfig.liveUrl}/api/tools
          </p>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <GitHubLink variant="outline" label="View the dispatcher" />
          <a
            href="/mcp.json"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-sm border border-ink-900 px-4 py-2.5 font-mono text-xs uppercase tracking-[0.12em] text-ink-900 hover:bg-ink-900 hover:text-parchment-50"
          >
            mcp.json
          </a>
        </div>
      </div>

      <AgentConsole tools={tools} />

      <section className="mt-12">
        <h2 className="text-xl text-ink-900">Using it from an agent</h2>
        <div className="mt-3 grid gap-5 lg:grid-cols-2">
          <div className="sheet rounded-sm p-5">
            <p className="ledger-head">Mutating a host is one call</p>
            <pre className="mt-2 overflow-x-auto font-mono text-[0.68rem] leading-relaxed text-ink-700">
{`curl -s ${siteConfig.liveUrl}/api/mcp \\
  -H 'content-type: application/json' \\
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "assay_host",
      "arguments": { "host": "github.com" }
    }
  }'`}
            </pre>
            <p className="mt-3 text-xs leading-relaxed text-ash-600">
              The response carries the grade, the itemised factors, the modelled break year, the seal
              and the provenance of every source. Repeating the call with the same{" "}
              <code className="font-mono">idempotency_key</code> returns the original assay rather
              than creating a second one.
            </p>
          </div>
          <div className="sheet rounded-sm p-5">
            <p className="ledger-head">Destructive calls are guarded</p>
            <pre className="mt-2 overflow-x-auto font-mono text-[0.68rem] leading-relaxed text-ink-700">
{`# Refused without explicit confirmation
curl -s ${siteConfig.liveUrl}/api/mcp \\
  -H 'content-type: application/json' \\
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "delete_assay",
      "arguments": { "id": "<uuid>" }
    }
  }'`}
            </pre>
            <p className="mt-3 text-xs leading-relaxed text-ash-600">
              Missing <code className="font-mono">confirm: true</code> and the tool refuses. Deletion
              is a tombstone, not an erase, so a historical verification still replays after the
              record is gone from the ledger.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}