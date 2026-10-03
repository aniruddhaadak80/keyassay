import { type NextResponse, type NextRequest } from "next/server";
import { ok, route } from "@/lib/api-helpers";
import { fetchResearchSignals, verifyEngineCitations } from "@/lib/sources/arxiv";
import { verifyCitation } from "@/lib/sources/arxiv";
import {
  GIDNEY_2025_ARXIV,
  GIDNEY_2025_TITLE,
  GIDNEY_EKERA_ARXIV,
  GIDNEY_EKERA_TITLE,
  IR8547_CITATION,
  NIST_CITATION,
  CAPABILITY_CITATION,
  COST_MODELS,
} from "@/lib/engine/constants";
import { parseBoundedInt } from "@/lib/validation";

/**
 * /api/standards — the cost model and its citations, verified live.
 *
 * The engine's break costs come from two specific papers. This endpoint fetches
 * their real arXiv metadata and reports whether the paper the engine cites is
 * still the paper arXiv says it is, so a stale or superseded citation shows up
 * as a failed check instead of a confident-sounding string.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  return await route(async () => {
    const limit = parseBoundedInt(
      request.nextUrl.searchParams.get("limit") ?? "",
      "limit",
      { min: 1, max: 20, fallback: 6 },
    );

    const [citations, research] = await Promise.all([
      verifyEngineCitations(),
      fetchResearchSignals(limit),
    ]);

    return ok({
      costModels: COST_MODELS,
      citations: {
        shor: { arxivId: GIDNEY_EKERA_ARXIV, title: GIDNEY_EKERA_TITLE },
        shorRevised: { arxivId: GIDNEY_2025_ARXIV, title: GIDNEY_2025_TITLE },
        nist: NIST_CITATION,
        ir8547: IR8547_CITATION,
        capability: CAPABILITY_CITATION,
      },
      verification: citations,
      allCitationsVerified: citations.every((entry) => entry.found && entry.titleMatches),
      research,
    });
  });
}

/** Verify one arbitrary arXiv citation, used by the Standards page. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  return await route(async () => {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return ok({ error: { code: "invalid_json", message: "Request body must be valid JSON." } }, 400);
    }
    const arxivId = String(body.arxivId ?? "").trim();
    if (!/^\d{4}\.\d{4,5}$/.test(arxivId)) {
      return ok(
        {
          error: {
            code: "invalid_arxiv_id",
            message: "arxivId must look like 2505.15917.",
          },
        },
        400,
      );
    }
    const verification = await verifyCitation({
      arxivId,
      expectedTitle: typeof body.expectedTitle === "string" ? body.expectedTitle : "",
    });
    return ok({ verification });
  });
}