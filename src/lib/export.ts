import { siteConfig } from "./config";
import { replayChain } from "./integrity/chain";
import type { Assay, AuditEvent } from "./types";
import type { AssayPolicy } from "./engine/assay";

/**
 * The takeaway artifact: an assay certificate.
 *
 * A visitor should leave with something they can hand to a colleague or attach
 * to a ticket. This renders a self-contained HTML certificate and a machine-
 * readable JSON twin, both carrying the seal, every factor with its weight and
 * citation, the full provenance of each external source, and the chain head.
 *
 * The HTML is a single file with inline styles and no scripts, so it survives
 * being emailed, attached to a ticket or opened from a file:// URL.
 */

export interface CertificateBundle {
  json: string;
  html: string;
  filenameBase: string;
}

export interface CertificateInput {
  assay: Assay;
  policy: AssayPolicy;
  events: Array<
    Pick<AuditEvent, "seq" | "eventType" | "payload" | "prevSeal" | "seal" | "createdAt">
  >;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function gradeStamp(assay: Assay): string {
  return {
    bullion: "FINE",
    sterling: "STERLING",
    base: "BASE",
    corroded: "CORRODED",
  }[assay.grade];
}

export function buildCertificateJson(input: CertificateInput): Record<string, unknown> {
  const { assay, policy, events } = input;
  const replay = replayChain(assay.id, events, new Date().toISOString());

  return {
    artifact: "keyassay.certificate",
    artifactVersion: "1.0.0",
    issuedAt: new Date().toISOString(),
    issuer: {
      product: siteConfig.name,
      repository: siteConfig.repository,
      liveUrl: siteConfig.liveUrl,
    },
    subject: {
      id: assay.id,
      label: assay.label,
      endpoint: `${assay.host}:${assay.port}`,
      createdAt: assay.createdAt,
    },
    grade: {
      mark: gradeStamp(assay),
      code: assay.grade,
      score: assay.score,
      label: assay.result.gradeLabel,
    },
    keyMaterial: {
      algorithm: assay.keyAlgorithm,
      bits: assay.keyBits,
      curve: assay.curve,
      effectiveRsaBits: assay.result.keyCosts[0]?.bits ?? null,
      transport: { protocol: assay.protocol, cipher: assay.cipher },
      issuer: assay.issuerCommonName,
      validUntil: assay.notAfter,
      chainDepth: assay.chainDepth,
    },
    quantumBreakCost: assay.result.keyCosts[0] ?? null,
    exposure: assay.result.exposure,
    decision: assay.decision,
    notes: assay.notes,
    factors: assay.result.factors.map((factor) => ({
      id: factor.id,
      label: factor.label,
      weight: factor.weight,
      raw: factor.raw,
      normalised: factor.normalised,
      contribution: factor.contribution,
      evidence: factor.evidence,
      citation: factor.citation,
    })),
    recommendation: assay.result.recommendation,
    policy: {
      horizonYear: policy.horizonYear,
      costModel: policy.costModel,
      capabilityBaseQubits: policy.capabilityBaseQubits,
      capabilityGrowth: policy.capabilityGrowth,
      minimumClassicalBits: policy.minimumClassicalBits,
    },
    engine: {
      version: assay.result.engineVersion,
      computedAt: assay.result.computedAt,
      weakestFactor: assay.result.weakestFactor,
    },
    provenance: {
      tls: assay.tls.meta,
      certificateTransparency: assay.ct.meta,
    },
    integrity: {
      algorithm: "SHA-384 hash chain",
      rule: "seal_n = SHA-384(UTF-8(prevSeal) || canonicalJson(event_n))",
      genesis: "keyassay/genesis/1",
      eventCount: events.length,
      headSeal: replay.headSeal,
      replayOk: replay.ok,
      storedSeal: assay.seal,
    },
    disclaimer:
      "This certificate is an engineering aid produced from public data and published cost estimates. It is not a penetration test, an audit opinion, or a guarantee that a host is secure. The break years are outputs of a stated growth assumption, not predictions. Verify independently before acting on them.",
  };
}

export function buildCertificateHtml(input: CertificateInput): string {
  const { assay, policy, events } = input;
  const replay = replayChain(assay.id, events, new Date().toISOString());
  const factorRows = assay.result.factors
    .map(
      (factor) => `
        <tr>
          <td class="factor-label">${escapeHtml(factor.label)}</td>
          <td class="num">${(factor.weight * 100).toFixed(0)}%</td>
          <td class="num">${escapeHtml(String(factor.raw))}</td>
          <td class="num">${(factor.normalised * 100).toFixed(0)}</td>
          <td class="evidence">
            ${escapeHtml(factor.evidence)}
            ${factor.citation ? `<span class="cite">Source: ${escapeHtml(factor.citation)}</span>` : ""}
          </td>
        </tr>`,
    )
    .join("");

  const chainRows = events
    .map(
      (event) => `
        <tr>
          <td class="num">${event.seq}</td>
          <td>${escapeHtml(event.eventType)}</td>
          <td class="mono small">${escapeHtml(event.seal.slice(0, 24))}…</td>
        </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Assay certificate — ${escapeHtml(assay.host)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 32px 20px 64px; background: #f4f1ea; color: #1b1a17;
         font-family: "Iowan Old Style", Georgia, "Times New Roman", serif; }
  .sheet { max-width: 940px; margin: 0 auto; background: #fffdf8; border: 1px solid #d9d2c3;
           box-shadow: 0 1px 0 #e6dfd0; padding: 40px 44px 48px; }
  h1 { margin: 0 0 4px; font-size: 28px; letter-spacing: -0.01em; }
  .sub { margin: 0 0 28px; color: #6b6558; font-size: 14px; }
  .mark { display: inline-block; border: 3px double #1b1a17; padding: 8px 16px;
          font-size: 20px; letter-spacing: 0.14em; text-transform: uppercase; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px;
          border-bottom: 2px solid #1b1a17; padding-bottom: 20px; flex-wrap: wrap; }
  table { width: 100%; border-collapse: collapse; margin: 18px 0 8px; font-size: 13.5px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e6dfd0; vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.09em; color: #6b6558; }
  td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .mono { font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; font-size: 12px; }
  .small { font-size: 11px; }
  .evidence { color: #3d3931; }
  .cite { display: block; color: #7a7263; font-size: 11.5px; margin-top: 4px; }
  .recommend { border-left: 4px solid #1b1a17; padding: 12px 16px; background: #f6f2e7; margin: 22px 0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; margin: 20px 0; }
  .cell { border: 1px solid #ddd5c6; padding: 12px 14px; }
  .cell dt { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.09em; color: #6b6558; margin: 0 0 4px; }
  .cell dd { margin: 0; font-size: 17px; font-variant-numeric: tabular-nums; }
  .foot { margin-top: 34px; border-top: 1px solid #d9d2c3; padding-top: 16px; font-size: 12px; color: #6b6558; }
  .foot a { color: #1b1a17; }
  .disclaimer { margin-top: 12px; font-size: 11.5px; color: #7a7263; }
</style>
</head>
<body>
<main class="sheet">
  <div class="head">
    <div>
      <h1>Certificate of Cryptographic Assay</h1>
      <p class="sub">${escapeHtml(siteConfig.name)} · issued ${escapeHtml(new Date().toISOString().slice(0, 19).replace("T", " "))} UTC</p>
    </div>
    <div class="mark">${escapeHtml(gradeStamp(assay))}</div>
  </div>

  <dl class="grid">
    <div class="cell"><dt>Endpoint</dt><dd>${escapeHtml(assay.host)}:${assay.port}</dd></div>
    <div class="cell"><dt>Composite score</dt><dd>${assay.score} / 100</dd></div>
    <div class="cell"><dt>Leaf key</dt><dd>${escapeHtml(assay.keyAlgorithm.toUpperCase())}${assay.keyBits ? ` ${assay.keyBits}` : ""}${assay.curve ? ` · ${escapeHtml(assay.curve)}` : ""}</dd></div>
    <div class="cell"><dt>Modelled break year</dt><dd>${assay.result.exposure.breakYear}</dd></div>
    <div class="cell"><dt>Confidentiality horizon</dt><dd>${policy.horizonYear}</dd></div>
    <div class="cell"><dt>Transport</dt><dd>${escapeHtml(assay.protocol ?? "unknown")}</dd></div>
  </dl>

  <h2 style="font-size:15px;letter-spacing:0.08em;text-transform:uppercase;margin:26px 0 0;">Findings</h2>
  <table>
    <thead><tr><th>Factor</th><th class="num">Weight</th><th class="num">Measured</th><th class="num">Score</th><th>Evidence</th></tr></thead>
    <tbody>${factorRows}</tbody>
  </table>

  <div class="recommend">
    <strong>Recommendation.</strong> ${escapeHtml(assay.result.recommendation)}
  </div>

  <h2 style="font-size:15px;letter-spacing:0.08em;text-transform:uppercase;margin:26px 0 0;">Harvest-now-decrypt-later exposure</h2>
  <p>${escapeHtml(assay.result.exposure.statement)}</p>

  <h2 style="font-size:15px;letter-spacing:0.08em;text-transform:uppercase;margin:26px 0 0;">Provenance</h2>
  <table>
    <tbody>
      <tr><td>TLS handshake</td><td>${escapeHtml(assay.tls.meta.attribution)} (status: ${escapeHtml(assay.tls.meta.status)})</td></tr>
      <tr><td>Certificate Transparency</td><td>${escapeHtml(assay.ct.meta.attribution)} (status: ${escapeHtml(assay.ct.meta.status)})</td></tr>
      <tr><td>Engine</td><td>${escapeHtml(assay.result.engineVersion)} · computed ${escapeHtml(assay.result.computedAt)}</td></tr>
      <tr><td>Cost model</td><td>${escapeHtml(policy.costModel)}</td></tr>
    </tbody>
  </table>

  <h2 style="font-size:15px;letter-spacing:0.08em;text-transform:uppercase;margin:26px 0 0;">Integrity</h2>
  <p class="mono small">seal(n) = SHA-384(UTF-8(prevSeal) || canonicalJson(event(n))) · genesis ${escapeHtml("keyassay/genesis/1")}</p>
  <table>
    <thead><tr><th class="num">Seq</th><th>Event</th><th>Seal</th></tr></thead>
    <tbody>${chainRows}</tbody>
  </table>
  <p class="mono small">Chain head: ${escapeHtml(replay.headSeal)} · replay ${replay.ok ? "verified" : "FAILED at seq " + replay.firstBrokenSeq}</p>

  <div class="foot">
    <p>Verify this certificate at <a href="${escapeHtml(siteConfig.liveUrl)}/verify?assay=${encodeURIComponent(assay.id)}">${escapeHtml(siteConfig.liveUrl)}/verify</a> or from source at <a href="${escapeHtml(siteConfig.repository)}">${escapeHtml(siteConfig.repository)}</a>.</p>
    <p class="disclaimer">Engineering aid produced from public data and published cost estimates. Not a penetration test, an audit opinion, or a guarantee of security. Break years are outputs of a stated growth assumption, not predictions. Verify independently before acting.</p>
  </div>
</main>
</body>
</html>`;
}

export function buildCertificate(input: CertificateInput): CertificateBundle {
  const json = buildCertificateJson(input);
  return {
    json: JSON.stringify(json, null, 2),
    html: buildCertificateHtml(input),
    filenameBase: `keyassay-${input.assay.host.replace(/[^a-z0-9.-]/gi, "-")}-${input.assay.id.slice(0, 8)}`,
  };
}

/** CSV of one assay, for pasting into a ticket or a spreadsheet. */
export function buildAssayCsv(assay: Assay): string {
  const escape = (value: unknown): string => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const header = [
    "id", "host", "port", "label", "grade", "score", "key_algorithm", "key_bits", "curve",
    "protocol", "cipher", "issuer", "valid_until", "chain_depth", "ct_certificates",
    "break_year", "exposed", "decision", "seal", "tls_status", "ct_status", "created_at",
  ];
  const rows = [
    [
      assay.id, assay.host, assay.port, assay.label, assay.grade, assay.score, assay.keyAlgorithm,
      assay.keyBits, assay.curve, assay.protocol, assay.cipher, assay.issuerCommonName,
      assay.notAfter, assay.chainDepth, assay.ctCertificateCount, assay.result.exposure.breakYear,
      assay.result.exposure.exposed, assay.decision, assay.seal, assay.tls.meta.status,
      assay.ct.meta.status, assay.createdAt,
    ],
  ];
  return [header, ...rows].map((row) => row.map(escape).join(",")).join("\n");
}