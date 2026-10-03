import { type NextResponse, type NextRequest } from "next/server";
import { getRepository } from "@/lib/db";
import { notFound, ok, route } from "@/lib/api-helpers";
import { getSessionId } from "@/lib/session";
import { verifyAssay } from "@/lib/service";
import { parseUuid } from "@/lib/validation";

/**
 * /api/assays/[id]/verify — replay one assay's seal chain.
 *
 * Returns 200 with `ok: false` when a break is found, because the endpoint
 * answered correctly; the caller inspects `firstBrokenSeq`.
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

    const events = await repo.listEvents(id);
    if (events.length === 0) {
      return notFound("No sealed assay with that id exists in this session.");
    }

    const replay = await verifyAssay({ repo, sessionId }, id);
    return ok({ replay, events: events.length });
  });
}