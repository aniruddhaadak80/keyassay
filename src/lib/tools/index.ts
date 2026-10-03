import { getRepository } from "../db";
import type { Repository } from "../db/repository";
import { DEFAULT_POLICY, type AssayPolicy } from "../engine/assay";
import { ASSAY_ENGINE_CITATIONS, costFor, runAssay } from "../engine/assay";
import { COST_MODELS } from "../engine/constants";
import { buildAssayCsv, buildCertificate } from "../export";
import { siteConfig } from "../config";
import {
  NotFoundError,
  assayHost,
  deleteAssay,
  loadPolicy,
  recordDecision,
  rerateStored,
  savePolicy,
  verifyAssay,
  type ServiceContext,
} from "../service";
import { ValidationError } from "../validation";
import {
  ASSAY_HOST_ARGS,
  DELETE_ASSAY_ARGS,
  EXPORT_CERTIFICATE_ARGS,
  GET_ASSAY_ARGS,
  GET_POLICY_ARGS,
  LIST_ASSAYS_ARGS,
  RECORD_DECISION_ARGS,
  RERATE_ARGS,
  VERIFY_INTEGRITY_ARGS,
  parseArgs,
  toJsonSchema,
  type ArgumentSpec,
} from "./schemas";

/**
 * The agent tool surface.
 *
 * Nine tools over one service layer: read, analysis, and three mutating tools
 * that call exactly the same functions the UI form calls. `assay_host` performs
 * the same real handshake, engine run and seal appending as pressing the button
 * on the landing page, so "the agent can do what the UI does" is a property of
 * the code rather than a claim in a README.
 */

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  kind: "read" | "analysis" | "mutation";
  args: ArgumentSpec;
}

export const TOOLS: readonly ToolDefinition[] = [
  {
    name: "assay_host",
    title: "Assay a live TLS endpoint",
    description:
      "Perform a real TLS handshake with the named host, read its certificate chain, retrieve its Certificate Transparency history, run the deterministic assay engine, persist the result and seal it. Mutating.",
    kind: "mutation",
    args: ASSAY_HOST_ARGS,
  },
  {
    name: "list_assays",
    title: "List assays in this ledger",
    description:
      "Return the assays owned by the current session, with grade, score, modelled break year, decision and seal.",
    kind: "read",
    args: LIST_ASSAYS_ARGS,
  },
  {
    name: "get_assay",
    title: "Read one assay",
    description:
      "Return a single assay with its full observation payload, itemised factors, citations, exposure analysis and optionally its sealed audit trail.",
    kind: "read",
    args: GET_ASSAY_ARGS,
  },
  {
    name: "rerate_assay",
    title: "Re-rate an assay against a different risk position",
    description:
      "Recompute an existing assay under an overridden confidentiality horizon or qubit growth rate without changing the stored measurement. Optionally persist the override as this session's policy.",
    kind: "analysis",
    args: RERATE_ARGS,
  },
  {
    name: "record_decision",
    title: "Seal a migration decision",
    description:
      "Record migrate-first, plan-hybrid, monitor or accepted against an assay, appending a signed audit event. Mutating.",
    kind: "mutation",
    args: RECORD_DECISION_ARGS,
  },
  {
    name: "delete_assay",
    title: "Tombstone an assay",
    description:
      "Soft-delete an assay, retaining its tombstone and audit chain so historical verification still works. Requires confirm=true. Mutating.",
    kind: "mutation",
    args: DELETE_ASSAY_ARGS,
  },
  {
    name: "verify_integrity",
    title: "Replay a seal chain",
    description:
      "Recompute the SHA-384 hash chain for one assay, or every assay in the session, and report the first broken link if any.",
    kind: "read",
    args: VERIFY_INTEGRITY_ARGS,
  },
  {
    name: "get_policy",
    title: "Read or update the risk policy",
    description:
      "Return the confidentiality horizon, cost model, qubit growth assumption and classical security floor, and persist any supplied change.",
    kind: "mutation",
    args: GET_POLICY_ARGS,
  },
  {
    name: "export_certificate",
    title: "Export an assay certificate",
    description:
      "Render the sealed certificate for an assay as json, html or csv, including every factor with its weight, evidence and citation.",
    kind: "read",
    args: EXPORT_CERTIFICATE_ARGS,
  },
] as const;

export const TOOL_NAMES: readonly string[] = TOOLS.map((tool) => tool.name);

export function describeTools(): Array<{
  name: string;
  title: string;
  description: string;
  kind: string;
  inputSchema: ReturnType<typeof toJsonSchema>;
}> {
  return TOOLS.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    kind: tool.kind,
    inputSchema: toJsonSchema(tool.args),
  }));
}

export function findTool(name: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.name === name);
}

/* ------------------------------------------------------------------ *
 * Argument types
 * ------------------------------------------------------------------ */

type AssayHostArgs = { host: string; label?: string; notes?: string; idempotency_key?: string };
type GetAssayArgs = { id: string; include_events?: boolean };
type ListAssaysArgs = {
  grade?: "bullion" | "sterling" | "base" | "corroded";
  decision?: "migrate-first" | "plan-hybrid" | "monitor" | "accepted";
  search?: string;
  limit?: number;
  offset?: number;
};
type RerateArgs = { id: string; horizon_year?: number; capability_growth?: number; persist?: boolean };
type RecordDecisionArgs = {
  id: string;
  decision: "migrate-first" | "plan-hybrid" | "monitor" | "accepted";
  notes?: string;
};
type VerifyArgs = { id?: string };
type DeleteArgs = { id: string; confirm: boolean };
type PolicyArgs = {
  horizon_year?: number;
  cost_model?: "gidney-ekera-2019" | "gidney-2025";
  capability_base_qubits?: number;
  capability_growth?: number;
  minimum_classical_bits?: number;
};
type ExportArgs = { id: string; format?: "json" | "html" | "csv" };

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

function json(value: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function text(message: string, value?: unknown): ToolResult {
  const body = value === undefined ? message : `${message}\n\n${JSON.stringify(value, null, 2)}`;
  return { content: [{ type: "text", text: body }], ...(value ? { structuredContent: value as Record<string, unknown> } : {}) };
}

async function context(sessionId: string): Promise<ServiceContext & { repo: Repository }> {
  const repo = await getRepository();
  return { repo, sessionId };
}

function currentYear(): number {
  return new Date().getFullYear();
}

/* ------------------------------------------------------------------ *
 * Dispatch
 * ------------------------------------------------------------------ */

export async function callTool(name: string, rawArgs: unknown, sessionId: string): Promise<ToolResult> {
  const tool = findTool(name);
  if (!tool) {
    return text(`Unknown tool "${name}". Available tools: ${TOOL_NAMES.join(", ")}.`);
  }

  const ctx = await context(sessionId);

  switch (name) {
    case "assay_host": {
      const args = parseArgs<AssayHostArgs>(tool.args, rawArgs);
      const outcome = await assayHost(ctx, {
        host: args.host,
        label: args.label,
        notes: args.notes,
        idempotencyKey: args.idempotency_key,
      });
      const assay = outcome.assay;
      return json({
        id: assay.id,
        host: assay.host,
        port: assay.port,
        label: assay.label,
        grade: assay.grade,
        gradeLabel: assay.result.gradeLabel,
        score: assay.score,
        keyAlgorithm: assay.keyAlgorithm,
        keyBits: assay.keyBits,
        curve: assay.curve,
        protocol: assay.protocol,
        cipher: assay.cipher,
        issuer: assay.issuerCommonName,
        validUntil: assay.notAfter,
        chainDepth: assay.chainDepth,
        ctCertificateCount: assay.ctCertificateCount,
        exposure: assay.result.exposure,
        recommendation: assay.result.recommendation,
        engineVersion: assay.result.engineVersion,
        factors: assay.result.factors,
        seal: assay.seal,
        sources: { tls: assay.tls.meta, certificateTransparency: assay.ct.meta },
        degraded: outcome.degraded,
        warning: outcome.tlsWarning,
      });
    }

    case "list_assays": {
      const args = parseArgs<ListAssaysArgs>(tool.args, rawArgs);
      const items = await ctx.repo.listAssays(sessionId, {
        limit: args.limit ?? 25,
        offset: args.offset ?? 0,
        grade: args.grade,
        decision: args.decision,
        search: args.search,
        includeDeleted: false,
      });
      const total = await ctx.repo.countAssays(sessionId, {
        limit: args.limit ?? 25,
        offset: args.offset ?? 0,
        grade: args.grade,
        decision: args.decision,
        search: args.search,
        includeDeleted: false,
      });
      return json({ total, limit: args.limit ?? 25, offset: args.offset ?? 0, items });
    }

    case "get_assay": {
      const args = parseArgs<GetAssayArgs>(tool.args, rawArgs);
      const assay = await ctx.repo.getAssay(sessionId, args.id);
      if (!assay) throw new NotFoundError();
      const events = args.include_events ? await ctx.repo.listEvents(args.id) : undefined;
      // Nested under `assay`, matching the REST route, so an agent and a script
      // reading either surface see the same shape.
      return json({
        assay: {
          id: assay.id,
          host: assay.host,
          port: assay.port,
          label: assay.label,
          grade: assay.grade,
          gradeLabel: assay.result.gradeLabel,
          score: assay.score,
          decision: assay.decision,
          notes: assay.notes,
          createdAt: assay.createdAt,
          updatedAt: assay.updatedAt,
          deletedAt: assay.deletedAt,
          seal: assay.seal,
          exposure: assay.result.exposure,
          recommendation: assay.result.recommendation,
          engineVersion: assay.result.engineVersion,
          factors: assay.result.factors,
          result: assay.result,
          observation: assay.tls,
          certificateTransparency: assay.ct,
        },
        events,
      });
    }

    case "rerate_assay": {
      const args = parseArgs<RerateArgs>(tool.args, rawArgs);
      const assay = await ctx.repo.getAssay(sessionId, args.id, true);
      if (!assay) throw new NotFoundError();

      if (args.persist) {
        await savePolicy(ctx, {
          ...(args.horizon_year !== undefined ? { horizonYear: args.horizon_year } : {}),
          ...(args.capability_growth !== undefined ? { capabilityGrowth: args.capability_growth } : {}),
        });
      }

      const base = await loadPolicy(ctx);
      const effective: AssayPolicy = {
        ...base,
        ...(args.horizon_year !== undefined ? { horizonYear: args.horizon_year } : {}),
        ...(args.capability_growth !== undefined ? { capabilityGrowth: args.capability_growth } : {}),
      };

      const result = rerateStored(assay, effective, currentYear());
      return json({
        id: assay.id,
        host: assay.host,
        persisted: args.persist === true,
        policyUsed: {
          horizonYear: effective.horizonYear,
          costModel: effective.costModel,
          capabilityGrowth: effective.capabilityGrowth,
        },
        score: result.score,
        grade: result.grade,
        exposure: result.exposure,
        weakestFactor: result.weakestFactor,
        recommendation: result.recommendation,
        factors: result.factors,
        engineVersion: result.engineVersion,
        note: "The stored measurement is unchanged. Only the assumed timeline differs.",
      });
    }

    case "record_decision": {
      const args = parseArgs<RecordDecisionArgs>(tool.args, rawArgs);
      const assay = await recordDecision(ctx, args.id, args.decision);
      const events = await ctx.repo.listEvents(args.id);
      return json({
        id: assay.id,
        host: assay.host,
        decision: assay.decision,
        gradeAtDecision: assay.grade,
        seal: assay.seal,
        auditEvents: events.length,
        headSeal: events[events.length - 1]?.seal ?? assay.seal,
      });
    }

    case "delete_assay": {
      const args = parseArgs<DeleteArgs>(tool.args, rawArgs);
      if (args.confirm !== true) {
        throw new ValidationError(
          "confirmation_required",
          "confirm",
          "Refusing to delete without confirm=true. The audit tombstone is permanent.",
        );
      }
      const deleted = await deleteAssay(ctx, args.id);
      return json({
        id: deleted.id,
        host: deleted.host,
        deletedAt: deleted.deletedAt,
        seal: deleted.seal,
        note: "The row is tombstoned, not erased, so the audit chain still replays.",
      });
    }

    case "verify_integrity": {
      const args = parseArgs<VerifyArgs>(tool.args, rawArgs);
      if (args.id) {
        const replay = await verifyAssay(ctx, args.id);
        return json(replay);
      }
      const items = await ctx.repo.listAssays(sessionId, {
        limit: 100,
        offset: 0,
        includeDeleted: true,
      });
      const results = [];
      for (const item of items) {
        results.push(await verifyAssay(ctx, item.id));
      }
      return json({
        checked: results.length,
        allValid: results.every((entry) => entry.ok),
        failures: results.filter((entry) => !entry.ok),
        results,
      });
    }

    case "get_policy": {
      const args = parseArgs<PolicyArgs>(tool.args, rawArgs);
      if (Object.keys(args).length > 0) {
        await savePolicy(ctx, {
          ...(args.horizon_year !== undefined ? { horizonYear: args.horizon_year } : {}),
          ...(args.cost_model !== undefined ? { costModel: args.cost_model } : {}),
          ...(args.capability_base_qubits !== undefined
            ? { capabilityBaseQubits: args.capability_base_qubits }
            : {}),
          ...(args.capability_growth !== undefined ? { capabilityGrowth: args.capability_growth } : {}),
          ...(args.minimum_classical_bits !== undefined
            ? { minimumClassicalBits: args.minimum_classical_bits }
            : {}),
        });
      }
      const stored = await loadPolicy(ctx);
      return json({
        policy: stored,
        defaults: DEFAULT_POLICY,
        availableCostModels: COST_MODELS,
        citations: ASSAY_ENGINE_CITATIONS,
      });
    }

    case "export_certificate": {
      const args = parseArgs<ExportArgs>(tool.args, rawArgs);
      const assay = await ctx.repo.getAssay(sessionId, args.id, true);
      if (!assay) throw new NotFoundError();
      const policy = await loadPolicy(ctx);
      const events = await ctx.repo.listEvents(args.id);
      const bundle = buildCertificate({ assay, policy, events });
      const format = args.format ?? "json";
      const payload = format === "html" ? bundle.html : format === "csv" ? buildAssayCsv(assay) : bundle.json;
      return text(
        `Certificate for ${assay.host} (${format}). Verify at ${siteConfig.liveUrl}/verify?assay=${assay.id}`,
        { filename: `${bundle.filenameBase}.${format}`, content: payload },
      );
    }

    default:
      return text(`Tool "${name}" is declared but not implemented.`);
  }
}

/** Exposed for the /api/tools route: the cost of a hypothetical key. */
export function estimateKeyCost(
  algorithm: "rsa" | "ec" | "ed25519",
  bits: number | null,
  curve: string | null,
  policy: AssayPolicy = DEFAULT_POLICY,
) {
  return costFor({ algorithm, bits, curve, postQuantum: false }, policy);
}

export { runAssay };