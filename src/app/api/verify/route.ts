import { type NextResponse, type NextRequest } from "next/server";
import { getRepository } from "@/lib/db";
import { ok, parsePagination, route } from "@/lib/api-helpers";
import { getSessionId } from "@/lib/session";
import { verifyAssay } from "@/lib/service";
import { parseUuid } from "@/lib/validation";

/**
 * /api/verify — integrity replay across the whole ledger.
 *
 * Without an id, every assay in the session is replayed and the first broken link
 * anywhere is reported. With an id, only that chain is checked.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  return await route(async () => {
    const sessionId = await getSessionId();
    const repo = await getRepository();
    const idParam = request.nextUrl.searchParams.get("assay");

    if (idParam) {
      const id = parseUuid(idParam, "assay");
      const events = await repo.listEvents(id);
      if (events.length === 0) {
        return ok({ checked: 0, results: [], allValid: true, message: "No sealed assay with that id in this session." });
      }
      const replay = await verifyAssay({ repo, sessionId }, id);
      return ok({ checked: 1, results: [replay], allValid: replay.ok });
    }

    const { limit, offset } = parsePagination(request.nextUrl);
    const items = await repo.listAssays(sessionId, { limit, offset, includeDeleted: true });

    const results = [];
    for (const item of items) {
      results.push(await verifyAssay({ repo, sessionId }, item.id));
    }

    return ok({
      checked: results.length,
      allValid: results.every((entry) => entry.ok),
      failures: results.filter((entry) => !entry.ok),
      results,
    });
  });
}