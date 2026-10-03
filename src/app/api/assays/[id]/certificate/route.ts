import { NextResponse, type NextRequest } from "next/server";
import { getRepository } from "@/lib/db";
import { notFound, route } from "@/lib/api-helpers";
import { getSessionId } from "@/lib/session";
import { loadPolicy } from "@/lib/service";
import { buildAssayCsv, buildCertificate } from "@/lib/export";
import { parseEnum, parseUuid } from "@/lib/validation";

/**
 * /api/assays/[id]/certificate — the takeaway artifact.
 *
 * Downloads a self-contained HTML certificate, a JSON twin or a CSV row. The
 * HTML has no scripts and no external assets, so it survives being emailed or
 * attached to a ticket.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const FORMATS = ["json", "html", "csv"] as const;
type Format = (typeof FORMATS)[number];

export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  return await route(async () => {
    const { id: rawId } = await params;
    const id = parseUuid(rawId);
    const sessionId = await getSessionId();
    const repo = await getRepository();

    const assay = await repo.getAssay(sessionId, id, true);
    if (!assay) return notFound("No assay with that id exists in this session.");

    const format = parseEnum<Format>(
      request.nextUrl.searchParams.get("format") ?? "json",
      "format",
      FORMATS,
      "json",
    );

    const [policy, events] = await Promise.all([loadPolicy({ repo, sessionId }), repo.listEvents(id)]);
    const base = `keyassay-${assay.host.replace(/[^a-z0-9.-]/gi, "-")}-${assay.id.slice(0, 8)}`;

    if (format === "csv") {
      return new NextResponse(buildAssayCsv(assay), {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${base}.csv"`,
          "cache-control": "no-store",
        },
      });
    }

    const bundle = buildCertificate({ assay, policy, events });

    if (format === "html") {
      return new NextResponse(bundle.html, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-disposition": `attachment; filename="${base}.html"`,
          "cache-control": "no-store",
        },
      });
    }

    return new NextResponse(bundle.json, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${base}.json"`,
        "cache-control": "no-store",
      },
    });
  });
}