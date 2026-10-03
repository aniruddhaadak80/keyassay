"use client";

import { useCallback, useState } from "react";
import { PlayIcon, TerminalIcon } from "@/components/icons";

/**
 * The in-page agent console.
 *
 * It speaks real JSON-RPC 2.0 to /api/mcp: initialize, then tools/list, then
 * tools/call. The request and response are both shown verbatim, so the transport
 * is inspectable rather than asserted. Mutations made here go through the same
 * service layer as the UI, which is why a call that creates an assay produces a
 * link to the assay the ledger then renders.
 */

export interface ConsoleTool {
  name: string;
  title: string;
  description: string;
  kind: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string; enum?: readonly string[] }>;
    required: readonly string[];
    additionalProperties: false;
  };
}

interface Exchange {
  id: number;
  label: string;
  request: string;
  response: string | null;
  error: string | null;
  working: boolean;
  resultLink: string | null;
}

interface Preset {
  label: string;
  description: string;
  method: string;
  params: Record<string, unknown>;
}

const PRESETS: Preset[] = [
  {
    label: "initialize",
    description: "Negotiate the protocol version and read the server identity.",
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "keyassay-console", version: "1.0.0" },
    },
  },
  {
    label: "tools/list",
    description: "Discover every tool with its JSON Schema.",
    method: "tools/list",
    params: {},
  },
  {
    label: "tools/call · assay_host",
    description: "Mutating. Performs a real TLS handshake, persists and seals a new assay.",
    method: "tools/call",
    params: { name: "assay_host", arguments: { host: "github.com", label: "Agent-scanned edge" } },
  },
  {
    label: "tools/call · list_assays",
    description: "Read the ledger this session owns.",
    method: "tools/call",
    params: { name: "list_assays", arguments: { limit: 5 } },
  },
  {
    label: "tools/call · get_policy",
    description: "Read the horizon, cost model and growth assumption in force.",
    method: "tools/call",
    params: { name: "get_policy", arguments: {} },
  },
  {
    label: "tools/call · verify_integrity",
    description: "Replay every seal chain in the ledger.",
    method: "tools/call",
    params: { name: "verify_integrity", arguments: {} },
  },
];

export function AgentConsole({ tools }: { tools: ConsoleTool[] }) {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [counter, setCounter] = useState(0);
  const [host, setHost] = useState("github.com");
  const [selectedId, setSelectedId] = useState("");

  const send = useCallback(async (preset: Preset) => {
    const id = counter + 1;
    setCounter(id);

    const request = {
      jsonrpc: "2.0",
      id,
      method: preset.method,
      params: preset.params,
    };

    setExchanges((current) => [
      ...current,
      {
        id,
        label: preset.label,
        request: JSON.stringify(request, null, 2),
        response: null,
        error: null,
        working: true,
        resultLink: null,
      },
    ]);

    try {
      const response = await fetch("/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }

      let resultLink: string | null = null;
      const payload = parsed as {
        result?: { structuredContent?: { id?: string } };
        error?: { message?: string };
      };
      if (payload.result?.structuredContent?.id) {
        resultLink = `/ledger/${payload.result.structuredContent.id}`;
      }

      setExchanges((current) =>
        current.map((entry) =>
          entry.id === id
            ? {
                ...entry,
                working: false,
                response: JSON.stringify(parsed, null, 2),
                error: payload.error?.message ?? null,
                resultLink,
              }
            : entry,
        ),
      );
    } catch (error) {
      setExchanges((current) =>
        current.map((entry) =>
          entry.id === id
            ? {
                ...entry,
                working: false,
                error: error instanceof Error ? error.message : "The transport failed.",
              }
            : entry,
        ),
      );
    }
  }, [counter]);

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.15fr]">
      <section>
        <p className="ledger-head">Preloaded calls</p>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
          Each button sends a real JSON-RPC 2.0 request to the live endpoint at{" "}
          <code className="rounded-sm bg-parchment-200 px-1.5 py-0.5 font-mono text-xs">/api/mcp</code>,
          using this browser&apos;s session cookie.
        </p>
        <div className="mt-4 space-y-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => void send(preset)}
              className="w-full rounded-sm border border-parchment-300 px-4 py-3 text-left transition-colors hover:border-ultramarine-500"
            >
              <span className="flex items-center gap-2 font-mono text-xs text-ultramarine-700">
                <PlayIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {preset.label}
              </span>
              <span className="mt-1 block text-sm leading-relaxed text-ink-500">{preset.description}</span>
            </button>
          ))}
        </div>

        <form
          className="mt-6 border-t border-parchment-300 pt-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (host.trim().length === 0) return;
            void send({
              label: `tools/call · assay_host (${host.trim()})`,
              description: "",
              method: "tools/call",
              params: { name: "assay_host", arguments: { host: host.trim() } },
            });
          }}
        >
          <label htmlFor="agent-host" className="ledger-head block">
            Assay any host through the agent
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              id="agent-host"
              type="text"
              value={host}
              onChange={(event) => setHost(event.target.value)}
              placeholder="example.com"
              className="w-full rounded-sm border border-parchment-400 bg-parchment-50 px-3 py-2 font-mono text-sm focus:border-ultramarine-600 focus:outline-none"
            />
            <button
              type="submit"
              className="shrink-0 rounded-sm bg-ultramarine-700 px-4 py-2 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-parchment-50 hover:bg-ultramarine-600"
            >
              Call
            </button>
          </div>
        </form>

        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!selectedId) return;
            void send({
              label: `tools/call · rerate_assay (${selectedId.slice(0, 8)}…)`,
              description: "",
              method: "tools/call",
              params: {
                name: "rerate_assay",
                arguments: { id: selectedId, horizon_year: 2040 },
              },
            });
          }}
        >
          <label htmlFor="agent-rerate" className="ledger-head block">
            Re-rate a stored assay (needs an id)
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              id="agent-rerate"
              type="text"
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
              placeholder="paste an assay UUID from the ledger"
              className="w-full rounded-sm border border-parchment-400 bg-parchment-50 px-3 py-2 font-mono text-xs focus:border-ultramarine-600 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!selectedId}
              className="shrink-0 rounded-sm border border-ink-900 px-4 py-2 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-ink-900 hover:bg-ink-900 hover:text-parchment-50 disabled:opacity-50"
            >
              Call
            </button>
          </div>
        </form>
      </section>

      <section>
        <p className="ledger-head">Exchange log</p>
        {exchanges.length === 0 ? (
          <div className="mt-2 flex items-start gap-3 rounded-sm border border-dashed border-parchment-400 px-5 py-8 text-sm text-ink-400">
            <TerminalIcon className="mt-0.5 h-4 w-4" aria-hidden="true" />
            Send one of the preloaded calls and the request and response appear here verbatim.
          </div>
        ) : (
          <ol className="mt-2 space-y-3">
            {exchanges.map((entry) => (
              <li key={entry.id} className="rounded-sm border border-parchment-300 bg-parchment-50">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-parchment-300 px-4 py-2">
                  <span className="font-mono text-xs text-ultramarine-700">{entry.label}</span>
                  {entry.working ? (
                    <span className="font-mono text-[0.62rem] uppercase tracking-[0.1em] text-ink-400">
                      awaiting response
                    </span>
                  ) : null}
                </div>
                <div className="px-4 py-3">
                  <p className="ledger-head">Request</p>
                  <pre className="mt-1 overflow-x-auto font-mono text-[0.68rem] leading-relaxed text-ink-700">
                    {entry.request}
                  </pre>
                  {entry.error ? (
                    <>
                      <p className="ledger-head mt-3 text-retort-700">Error</p>
                      <pre className="mt-1 overflow-x-auto font-mono text-[0.68rem] leading-relaxed text-retort-700">
                        {entry.error}
                      </pre>
                    </>
                  ) : null}
                  {entry.response ? (
                    <>
                      <p className="ledger-head mt-3">Response</p>
                      <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-all font-mono text-[0.68rem] leading-relaxed text-ink-700">
                        {entry.response}
                      </pre>
                    </>
                  ) : null}
                  {entry.resultLink ? (
                    <a
                      href={entry.resultLink}
                      className="mt-3 inline-block rounded-sm border border-verdigris-700 px-3 py-1.5 font-mono text-[0.62rem] uppercase tracking-[0.1em] text-verdigris-700 hover:bg-verdigris-700 hover:text-parchment-50"
                    >
                      Open the persisted assay
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="lg:col-span-2">
        <p className="ledger-head">Published tool schemas ({tools.length})</p>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
          The same catalogue <code className="rounded-sm bg-parchment-200 px-1.5 py-0.5 font-mono text-xs">/api/tools</code>{" "}
          serves as JSON, and the same dispatcher validates incoming arguments against these schemas.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {tools.map((tool) => (
            <article key={tool.name} className="sheet rounded-sm p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-mono text-sm text-ultramarine-700">{tool.name}</h3>
                <span
                  className={`rounded-sm border px-1.5 py-0.5 font-mono text-[0.58rem] uppercase tracking-[0.1em] ${
                    tool.kind === "mutation"
                      ? "border-retort-500 text-retort-700"
                      : tool.kind === "analysis"
                        ? "border-ultramarine-500 text-ultramarine-700"
                        : "border-verdigris-500 text-verdigris-700"
                  }`}
                >
                  {tool.kind}
                </span>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{tool.description}</p>
              <ul className="mt-3 space-y-1.5 border-t border-parchment-200 pt-3">
                {Object.entries(tool.inputSchema.properties).map(([name, field]) => (
                  <li key={name} className="flex flex-wrap items-baseline gap-x-2">
                    <code className="font-mono text-xs text-ink-900">{name}</code>
                    <span className="font-mono text-[0.62rem] uppercase tracking-[0.1em] text-ink-300">
                      {field.type}
                      {field.enum ? ` · ${field.enum.join(" | ")}` : ""}
                      {tool.inputSchema.required.includes(name) ? " · required" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}