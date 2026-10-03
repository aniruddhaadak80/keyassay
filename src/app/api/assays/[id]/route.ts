import { type NextResponse, type NextRequest } from "next/server";
import { getRepository } from "@/lib/db";
import { fail, fromError, notFound, ok, route } from "@/lib/api-helpers";
import { checkRate, rateHeaders } from "@/lib/rate-limit";
import { getSessionId } from "@/lib/session";
import { deleteAssay, recordDecision, renameAssay, updateNotes } from "@/lib/service";
import { ValidationError, parseNotes, parseUuid } from "@/lib/validation";

/**
 * /api/assays/[id] — read, update and tombstone a single assay.
 *
 * Every query is scoped to the session cookie, so an id from another visitor
 * returns 404 rather than 403: the existence of another session's record is not
 * something this product discloses.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  return await route(async () => {
    const { id: rawId } = await params;
    const id = parseUuid(rawId);
    const sessionId = await getSessionId();
    const repo = await getRepository();
    const assay = await repo.getAssay(sessionId, id, true);
    if (!assay) return notFound("No assay with that id exists in this session.");
    const events = await repo.listEvents(id);
    return ok({ assay, events });
  });
}

export async function PATCH(request: NextRequest, { params }: Params): Promise<NextResponse> {
  return await route(async () => {
    const { id: rawId } = await params;
    const id = parseUuid(rawId);
    const sessionId = await getSessionId();

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return fail("invalid_json", "Request body must be valid JSON.", 400);
    }

    const repo = await getRepository();
    const hasLabel = Object.prototype.hasOwnProperty.call(body, "label");
    const hasNotes = Object.prototype.hasOwnProperty.call(body, "notes");
    const hasDecision = Object.prototype.hasOwnProperty.call(body, "decision");
    if (!hasLabel && !hasNotes && !hasDecision) {
      return fail(
        "nothing_to_update",
        "Provide at least one of: label, notes, decision.",
        400,
        { accepted: ["label", "notes", "decision"] },
      );
    }

    const ctx = { repo, sessionId };
    let assay = await repo.getAssay(sessionId, id);
    if (!assay) return notFound("No assay with that id exists in this session.");

    if (hasLabel) {
      assay = await renameAssay(ctx, id, body.label);
    }
    if (hasNotes) {
      assay = await updateNotes(ctx, id, parseNotes(body.notes));
    }
    if (hasDecision) {
      // Recorded through the same service function the MCP tool calls, so the
      // audit event and seal are identical whichever route was used.
      assay = await recordDecision(ctx, id, body.decision);
    }

    const events = await repo.listEvents(id);
    return ok({ assay, events, seal: assay.seal });
  });
}

export async function DELETE(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  return await route(async () => {
    const { id: rawId } = await params;
    const id = parseUuid(rawId);
    const sessionId = await getSessionId();

    const verdict = checkRate(`delete:${sessionId}`);
    if (!verdict.allowed) {
      return fail("rate_limited", "Too many destructive requests from this session.", 429);
    }

    const repo = await getRepository();
    const existing = await repo.getAssay(sessionId, id);
    if (!existing) return notFound("No assay with that id exists in this session.");

    const deleted = await deleteAssay({ repo, sessionId }, id);
    if (!deleted) return notFound("No assay with that id exists in this session.");

    const events = await repo.listEvents(id);
    return ok(
      {
        id: deleted.id,
        host: deleted.host,
        deletedAt: deleted.deletedAt,
        seal: deleted.seal,
        auditEvents: events.length,
        note: "Tombstoned rather than erased, so the audit chain still replays.",
      },
      200,
      rateHeaders(verdict),
    );
  });
}

export { fromError, ValidationError };