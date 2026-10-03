import { type NextResponse, type NextRequest } from "next/server";
import { getRepository } from "@/lib/db";
import { fail, fromError, ok, parsePagination, route } from "@/lib/api-helpers";
import { checkRate, rateHeaders } from "@/lib/rate-limit";
import { getSessionId } from "@/lib/session";
import { assayHost } from "@/lib/service";
import { parseBoundedInt, parseEnum, parseGrade, parseUuid } from "@/lib/validation";
import type { Grade } from "@/lib/types";

/**
 * /api/assays — the core entity.
 *
 * GET  lists the current session's assays with bounded pagination and filters.
 * POST performs a real handshake, runs the engine, persists and seals.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  return await route(async () => {
    const sessionId = await getSessionId();
    const repo = await getRepository();
    const url = request.nextUrl;
    const { limit, offset } = parsePagination(url);

    const gradeRaw = url.searchParams.get("grade");
    const grade = gradeRaw ? (parseGrade(gradeRaw) as Grade) : undefined;
    const decision = url.searchParams.get("decision") ?? undefined;
    const search = url.searchParams.get("search")?.trim() || undefined;
    const includeDeleted = url.searchParams.get("includeDeleted") === "true";

    const query = {
      limit,
      offset,
      grade,
      decision: decision as never,
      search: search?.slice(0, 120),
      includeDeleted,
    };

    const [items, total] = await Promise.all([
      repo.listAssays(sessionId, query),
      repo.countAssays(sessionId, query),
    ]);

    return ok({ items, total, limit, offset });
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return await route(async () => {
    const sessionId = await getSessionId();
    const verdict = checkRate(`create:${sessionId}`);
    if (!verdict.allowed) {
      return fail("rate_limited", "Too many scans from this session. Wait a moment and try again.", 429);
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return fail("invalid_json", "Request body must be valid JSON.", 400);
    }

    const repo = await getRepository();
    const outcome = await assayHost(
      { repo, sessionId },
      {
        host: String(body.host ?? ""),
        port: body.port === undefined ? undefined : parseBoundedInt(body.port, "port", { min: 1, max: 65535 }),
        label: typeof body.label === "string" ? body.label : undefined,
        notes: typeof body.notes === "string" ? body.notes : undefined,
        idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined,
      },
    );

    return ok(
      {
        assay: outcome.assay,
        degraded: outcome.degraded,
        warning: outcome.tlsWarning,
      },
      outcome.degraded ? 200 : 201,
      rateHeaders(verdict),
    );
  });
}

/** Tool-driven creation, used by the in-page agent console. */
export async function PUT(request: NextRequest): Promise<NextResponse> {
  return await route(async () => {
    const sessionId = await getSessionId();
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return fail("invalid_json", "Request body must be valid JSON.", 400);
    }
    const repo = await getRepository();
    const outcome = await assayHost(
      { repo, sessionId },
      {
        host: String(body.host ?? ""),
        label: typeof body.label === "string" ? body.label : undefined,
        idempotencyKey:
          typeof body.idempotencyKey === "string" && body.idempotencyKey.length > 0
            ? body.idempotencyKey
            : undefined,
      },
    );
    return ok({ assay: outcome.assay, degraded: outcome.degraded, warning: outcome.tlsWarning }, 201);
  });
}

export { parseEnum, parseUuid, fromError };