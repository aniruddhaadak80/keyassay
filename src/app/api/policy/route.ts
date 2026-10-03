import { type NextResponse, type NextRequest } from "next/server";
import { getRepository } from "@/lib/db";
import { ok, route } from "@/lib/api-helpers";
import { getSessionId } from "@/lib/session";
import { loadPolicy, rerateStored, savePolicy } from "@/lib/service";
import {
  parseBoolean,
  parseBoundedInt,
  parseEnum,
  parseNumber,
  parseUuid,
  ValidationError,
} from "@/lib/validation";
import { fail } from "@/lib/api-helpers";
import type { AssayPolicy } from "@/lib/engine/assay";

/**
 * /api/policy — the risk position every assay is rated against.
 *
 * This is what the horizon dial writes to. Changing it re-rates the whole
 * ledger on the next read without touching a single stored measurement, which is
 * the whole point: the observation is a fact, the timeline is an assumption.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COST_MODELS = ["gidney-ekera-2019", "gidney-2025"] as const;

export async function GET(): Promise<NextResponse> {
  return await route(async () => {
    const sessionId = await getSessionId();
    const repo = await getRepository();
    const policy = await loadPolicy({ repo, sessionId });
    return ok({ policy });
  });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  return await route(async () => {
    const sessionId = await getSessionId();
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return fail("invalid_json", "Request body must be valid JSON.", 400);
    }

    const accepted = ["horizonYear", "costModel", "capabilityBaseQubits", "capabilityGrowth", "minimumClassicalBits"];
    const keys = Object.keys(body);
    const unknownKeys = keys.filter((key) => !accepted.includes(key));
    if (unknownKeys.length > 0) {
      return fail(
        "unknown_field",
        `Unrecognised policy field(s): ${unknownKeys.join(", ")}.`,
        400,
        { accepted },
      );
    }
    if (keys.length === 0) {
      return fail("nothing_to_update", `Provide at least one of: ${accepted.join(", ")}.`, 400, { accepted });
    }

    const patch: Partial<AssayPolicy> = {};
    if (body.horizonYear !== undefined) {
      patch.horizonYear = parseBoundedInt(body.horizonYear, "horizonYear", { min: 2026, max: 2200 });
    }
    if (body.costModel !== undefined) {
      patch.costModel = parseEnum(body.costModel, "costModel", COST_MODELS, "gidney-2025");
    }
    if (body.capabilityBaseQubits !== undefined) {
      patch.capabilityBaseQubits = parseBoundedInt(body.capabilityBaseQubits, "capabilityBaseQubits", {
        min: 1,
        max: 100_000_000,
      });
    }
    if (body.capabilityGrowth !== undefined) {
      patch.capabilityGrowth = parseNumber(body.capabilityGrowth, "capabilityGrowth", {
        min: 0.01,
        max: 5,
      });
    }
    if (body.minimumClassicalBits !== undefined) {
      patch.minimumClassicalBits = parseBoundedInt(body.minimumClassicalBits, "minimumClassicalBits", {
        min: 80,
        max: 256,
      });
    }

    const repo = await getRepository();
    const ctx = { repo, sessionId };
    await savePolicy(ctx, patch);
    const policy = await loadPolicy(ctx);

    // Re-rate the whole ledger under the new position so the caller immediately
    // sees the consequence rather than having to re-request every assay.
    const items = await repo.listAssays(sessionId, { limit: 100, offset: 0, includeDeleted: true });
    const currentYear = new Date().getFullYear();
    const rerated = [];
    for (const summary of items) {
      const assay = await repo.getAssay(sessionId, summary.id, true);
      if (!assay) continue;
      const result = rerateStored(assay, policy, currentYear);
      rerated.push({
        id: assay.id,
        host: assay.host,
        storedGrade: assay.grade,
        storedScore: assay.score,
        grade: result.grade,
        score: result.score,
        exposed: result.exposure.exposed,
        breakYear: result.exposure.breakYear,
        decision: assay.decision,
      });
    }

    return ok({ policy, persisted: parseBoolean(body.persist, true), rerated });
  });
}

export { ValidationError, parseUuid };