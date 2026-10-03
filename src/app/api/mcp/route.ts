import { NextResponse, type NextRequest } from "next/server";
import { getSessionId } from "@/lib/session";
import { checkRate, rateHeaders } from "@/lib/rate-limit";
import { fail, fromError } from "@/lib/api-helpers";
import { ValidationError } from "@/lib/validation";
import { TOOL_NAMES, TOOLS, callTool, describeTools, findTool } from "@/lib/tools";
import { siteConfig } from "@/lib/config";

/**
 * MCP-style JSON-RPC 2.0 endpoint.
 *
 * Implements `initialize`, `tools/list` and `tools/call`, which is the subset an
 * MCP client needs to discover and invoke this product's tools. It speaks plain
 * JSON-RPC over HTTP POST rather than the stdio transport, because the point of
 * this endpoint is that a remote agent can use the same service layer the UI
 * uses, including the real handshake and the real seal chain.
 *
 * Ownership is the same anonymous session cookie the UI uses, so an agent can
 * only ever see and mutate the assays of the session that called it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

type RpcId = string | number | null;

function rpcResult(id: RpcId, result: unknown): NextResponse {
  return NextResponse.json({ jsonrpc: "2.0", id, result });
}

function rpcError(id: RpcId, code: number, message: string, data?: unknown): NextResponse {
  return NextResponse.json({ jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } });
}

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

function idOf(request: JsonRpcRequest): RpcId {
  return request.id === undefined ? null : request.id;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const sessionId = await getSessionId();
    const verdict = checkRate(`mcp:${sessionId}`);
    if (!verdict.allowed) {
      return NextResponse.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: INVALID_REQUEST,
            message: "Too many requests. Slow down and retry after the interval given in Retry-After.",
          },
        },
        { status: 429, headers: rateHeaders(verdict) },
      );
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return rpcError(null, PARSE_ERROR, "Request body is not valid JSON.");
    }

    // A batch is an array of requests; answer each independently.
    if (Array.isArray(payload)) {
      if (payload.length === 0) {
        return rpcError(null, INVALID_REQUEST, "A batch must contain at least one request.");
      }
      if (payload.length > 20) {
        return rpcError(null, INVALID_REQUEST, "A batch may contain at most 20 requests.");
      }
      const responses = [];
      for (const entry of payload) {
        const response = await dispatch(entry as JsonRpcRequest, sessionId);
        if (response) responses.push(await response.json());
      }
      return responses.length === 0
        ? NextResponse.json({ jsonrpc: "2.0" })
        : NextResponse.json(responses);
    }

    const response = await dispatch(payload as JsonRpcRequest, sessionId);
    return response ?? rpcError(null, INVALID_REQUEST, "Empty request.");
  } catch (error) {
    const mapped = fromError(error);
    const body = (await mapped.json()) as { error?: { message?: string; code?: string } };
    return rpcError(
      null,
      INTERNAL_ERROR,
      body.error?.message ?? "The request could not be handled.",
      body.error?.code ? { code: body.error.code } : undefined,
    );
  }
}

async function dispatch(
  request: JsonRpcRequest,
  sessionId: string,
): Promise<NextResponse | null> {
  const id = idOf(request);

  if (!request || typeof request !== "object" || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return rpcError(id, INVALID_REQUEST, 'Expected a JSON-RPC 2.0 object with a "method" string.');
  }

  const params = (request.params ?? {}) as Record<string, unknown>;

  switch (request.method) {
    case "initialize": {
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: siteConfig.name,
          title: `${siteConfig.name} — cryptographic assay service`,
          version: "1.0.0",
          url: `${siteConfig.liveUrl}/agent`,
        },
        instructions:
          "Submit a public hostname with assay_host to perform a real TLS handshake and return a sealed cryptographic assay. Re-rate it with rerate_assay when the confidentiality horizon changes, record the verdict with record_decision, and confirm the audit trail with verify_integrity.",
      });
    }

    case "notifications/initialized":
      // A notification carries no id and expects no response.
      return null;

    case "ping":
      return rpcResult(id, { ok: true });

    case "tools/list":
      return rpcResult(id, { tools: describeTools() });

    case "tools/call": {
      const name = params.name;
      if (typeof name !== "string" || !findTool(name)) {
        return rpcError(id, INVALID_PARAMS, `Unknown tool. Available tools: ${TOOL_NAMES.join(", ")}.`);
      }
      try {
        const result = await callTool(name, params.arguments ?? {}, sessionId);
        return rpcResult(id, result);
      } catch (error) {
        if (error instanceof ValidationError) {
          return rpcResult(id, {
            content: [{ type: "text", text: error.message }],
            structuredContent: { error: { code: error.code, field: error.field } },
            isError: true,
          });
        }
        const mapped = fromError(error);
        const status = mapped.status;
        const body = (await mapped.json()) as { error?: { message?: string; code?: string } };
        if (status === 404) {
          return rpcError(id, INVALID_PARAMS, body.error?.message ?? "Not found.", {
            code: body.error?.code,
          });
        }
        console.error("[keyassay] tool call failed:", name, error instanceof Error ? error.message : error);
        return rpcResult(id, {
          content: [
            {
              type: "text",
              text:
                status === 502
                  ? (body.error?.message ?? "An upstream source could not be reached.")
                  : "The tool call failed. See the server logs for detail.",
            },
          ],
          structuredContent: { error: { code: body.error?.code ?? "internal_error" } },
          isError: true,
        });
      }
    }

    case "resources/list":
      return rpcResult(id, { resources: [] });

    case "prompts/list":
      return rpcResult(id, { prompts: [] });

    default:
      return rpcError(id, METHOD_NOT_FOUND, `Method "${request.method}" is not implemented.`);
  }
}

/** A GET on the endpoint returns a discovery document, so it is browsable. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    endpoint: `${siteConfig.liveUrl}/api/mcp`,
    transport: "JSON-RPC 2.0 over HTTP POST",
    protocolVersion: PROTOCOL_VERSION,
    methods: ["initialize", "tools/list", "tools/call", "ping"],
    tools: TOOLS.map((tool) => ({ name: tool.name, kind: tool.kind })),
    repository: siteConfig.repository,
  });
}

export { fail };