import { NextResponse, type NextRequest } from "next/server";
import { getRepository } from "@/lib/db";
import { parsePagination, route } from "@/lib/api-helpers";
import { getSessionId } from "@/lib/session";
import { loadPolicy, rerateStored } from "@/lib/service";
import { buildAssayCsv, buildCertificate } from "@/lib/export";
import { parseUuid } from "@/lib/validation";
import { parseBoolean } from "@/lib/validation";
import type { Assay } from "@/lib/types";

/**
 * /api/export — the whole ledger as one artifact.
 *
 * Produces a JSON portfolio (every assay with its full engine result and
 * provenance), a CSV that pastes straight into a ticket, or a single combined
 * HTML dossier with one certificate per assay.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FORMATS = ["json", "csv", "html"] as const;
type Format = (typeof FORMATS)[number];

export async function GET(request: NextRequest): Promise<NextResponse> {
  return await route(async () => {
    const sessionId = await getSessionId();
    const repo = await getRepository();
    const { limit, offset } = parsePagination(request.nextUrl);

    const requested = request.nextUrl.searchParams.get("format") ?? "json";
    const format = (FORMATS as readonly string[]).includes(requested) ? (requested as Format) : "json";
    const includeDeleted = parseBoolean(request.nextUrl.searchParams.get("includeDeleted"), false);

    const items = await repo.listAssaysPage(sessionId, { limit, offset, includeDeleted });
    const policy = await loadPolicy({ repo, sessionId });

    const currentYear = new Date().getFullYear();
    const complete = await Promise.all(
      items.items.map(async (assay) => ({
        assay,
        events: await repo.listEvents(assay.id),
        rerated: rerateStored(assay, policy, currentYear),
      })),
    );

    if (format === "csv") {
      const csv = [
        buildAssayCsv(complete[0]?.assay ?? ({} as Assay)),
        ...complete.slice(1).map((entry) => buildAssayCsv(entry.assay).split("\n").slice(1).join("\n")),
      ].join("\n");
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="keyassay-ledger-${new Date().toISOString().slice(0, 10)}.csv"`,
          "cache-control": "no-store",
        },
      });
    }

    if (format === "html") {
      const html = buildDossierHtml(
        complete.map((entry) => ({
          assay: entry.assay,
          events: entry.events,
          rerated: entry.rerated,
        })),
        policy,
      );
      return new NextResponse(html, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-disposition": `attachment; filename="keyassay-ledger-${new Date().toISOString().slice(0, 10)}.html"`,
          "cache-control": "no-store",
        },
      });
    }

    const payload = {
      artifact: "keyassay.ledger",
      artifactVersion: "1.0.0",
      exportedAt: new Date().toISOString(),
      policy,
      count: complete.length,
      assays: complete.map((entry) => ({
        id: entry.assay.id,
        host: entry.assay.host,
        port: entry.assay.port,
        label: entry.assay.label,
        grade: entry.assay.grade,
        score: entry.assay.score,
        decision: entry.assay.decision,
        notes: entry.assay.notes,
        seal: entry.assay.seal,
        createdAt: entry.assay.createdAt,
        updatedAt: entry.assay.updatedAt,
        deletedAt: entry.assay.deletedAt,
        keyMaterial: {
          algorithm: entry.assay.keyAlgorithm,
          bits: entry.assay.keyBits,
          curve: entry.assay.curve,
          protocol: entry.assay.protocol,
          cipher: entry.assay.cipher,
          issuer: entry.assay.issuerCommonName,
          validUntil: entry.assay.notAfter,
        },
        exposure: entry.assay.result.exposure,
        reratedUnderCurrentPolicy: {
          score: entry.rerated.score,
          grade: entry.rerated.grade,
          exposed: entry.rerated.exposure.exposed,
          breakYear: entry.rerated.exposure.breakYear,
        },
        engine: {
          version: entry.assay.result.engineVersion,
          computedAt: entry.assay.result.computedAt,
          weakestFactor: entry.assay.result.weakestFactor,
          recommendation: entry.assay.result.recommendation,
          factors: entry.assay.result.factors,
        },
        provenance: { tls: entry.assay.tls.meta, certificateTransparency: entry.assay.ct.meta },
        certificate: buildCertificate({ assay: entry.assay, policy, events: entry.events }).json,
      })),
      disclaimer:
        "Engineering aid produced from public data and published cost estimates. Not a penetration test or an audit opinion. Break years are outputs of a stated growth assumption, not predictions.",
    };

    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="keyassay-ledger-${new Date().toISOString().slice(0, 10)}.json"`,
        "cache-control": "no-store",
      },
    });
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildDossierHtml(
  entries: Array<{ assay: Assay; events: unknown[]; rerated: { score: number; grade: string; exposure: { breakYear: number | null; exposed: boolean } } }>,
  policy: { horizonYear: number; costModel: string; capabilityGrowth: number },
): string {
  const sections = entries
    .map(
      (entry) => `
    <section class="entry">
      <h2>${escapeHtml(entry.assay.host)}:${entry.assay.port}</h2>
      <p class="mark ${entry.assay.grade}">${escapeHtml(entry.assay.grade.toUpperCase())} · ${entry.assay.score}/100</p>
      <table>
        <tbody>
          <tr><td>Leaf key</td><td>${escapeHtml(entry.assay.keyAlgorithm.toUpperCase())}${entry.assay.keyBits ? ` ${entry.assay.keyBits}` : ""}${entry.assay.curve ? ` (${escapeHtml(entry.assay.curve)})` : ""}</td></tr>
          <tr><td>Transport</td><td>${escapeHtml(entry.assay.protocol ?? "unknown")} / ${escapeHtml(entry.assay.cipher ?? "unknown")}</td></tr>
          <tr><td>Issuer</td><td>${escapeHtml(entry.assay.issuerCommonName ?? "unknown")}</td></tr>
          <tr><td>Valid until</td><td>${entry.assay.notAfter ? escapeHtml(entry.assay.notAfter.slice(0, 10)) : "unknown"}</td></tr>
          <tr><td>Modelled break year</td><td>${entry.rerated.exposure.breakYear ?? "already post-quantum"}</td></tr>
          <tr><td>Exposed</td><td>${entry.rerated.exposure.exposed ? "YES — harvest-now-decrypt-later" : "no"}</td></tr>
          <tr><td>Decision</td><td>${escapeHtml(entry.assay.decision ?? "not recorded")}</td></tr>
          <tr><td>Seal</td><td class="mono">${escapeHtml(entry.assay.seal)}</td></tr>
          <tr><td>CT status</td><td>${escapeHtml(entry.assay.ct.meta.status)} (${entry.assay.ctCertificateCount ?? 0} certificates)</td></tr>
        </tbody>
      </table>
    </section>`,
    )
    .join("\n");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Keyassay ledger dossier</title><style>
body{font-family:Georgia,serif;background:#f4f1ea;color:#1b1a17;margin:0;padding:32px 20px 64px}
.sheet{max-width:900px;margin:0 auto;background:#fffdf8;border:1px solid #d9d2c3;padding:36px 40px}
h1{margin:0 0 6px;font-size:26px}h2{font-size:18px;margin:0 0 6px}
.meta{color:#6b6558;font-size:13px;margin:0 0 26px}
.entry{border-top:1px solid #d9d2c3;padding:20px 0}
.mark{display:inline-block;border:2px solid #1b1a17;padding:4px 12px;font-size:13px;letter-spacing:.1em}
table{width:100%;border-collapse:collapse;font-size:13px;margin-top:10px}
td{border-bottom:1px solid #eee7d8;padding:6px 8px}td:first-child{width:210px;color:#6b6558}
.mono{font-family:ui-monospace,Menlo,monospace;font-size:11px;word-break:break-all}
.foot{margin-top:28px;border-top:1px solid #d9d2c3;padding-top:14px;font-size:12px;color:#6b6558}
</style></head><body><main class="sheet">
<h1>Keyassay ledger dossier</h1>
<p class="meta">${entries.length} assay record${entries.length === 1 ? "" : "s"} · horizon ${policy.horizonYear} · cost model ${escapeHtml(policy.costModel)} · growth ${policy.capabilityGrowth} · exported ${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC</p>
${sections || "<p>No assays in this ledger yet.</p>"}
<div class="foot">Engineering aid produced from public data and published cost estimates. Not a penetration test or an audit opinion. Break years are outputs of a stated growth assumption, not predictions.</div>
</main></body></html>`;
}

export { parseUuid };