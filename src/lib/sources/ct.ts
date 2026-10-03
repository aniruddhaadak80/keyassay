import type { CtCertificate, CtSummary, LivePayload, SourceMeta } from "../types";

/**
 * Live source 2: Certificate Transparency.
 *
 * Every publicly trusted certificate is published to append-only CT logs. crt.sh
 * serves those logs as public JSON with no API key and no registration, which
 * makes it the only CT source this product can honestly call without asking a
 * visitor for a credential.
 *
 * CT gives the part of the picture a single handshake cannot: how much key
 * material an organisation has issued, how long those certificates live, and
 * whether any of them outlive the NIST IR 8547 deprecation clock. A certificate
 * valid past 2030 forces its owner to re-issue after its key must already have
 * changed.
 */

const CT_TIMEOUT_MS = 9_000;
const CT_MAX_ROWS = 4_000;
const RECENT_WINDOW_DAYS = 90;

interface RawCtRow {
  issuer_ca_id?: number;
  issuer_name?: string;
  common_name?: string | null;
  name_value?: string;
  id?: number;
  not_before?: string;
  not_after?: string;
  serial_number?: string;
}

export class CtLookupError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CtLookupError";
    this.code = code;
  }
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function parseRow(row: RawCtRow): CtCertificate | null {
  const notBefore = row.not_before ?? null;
  const notAfter = row.not_after ?? null;
  if (!notBefore || !notAfter) return null;
  return {
    id: row.id ?? 0,
    issuer: truncate(row.issuer_name ?? "(unknown issuer)", 160),
    commonName: row.common_name ? truncate(row.common_name, 253) : null,
    names: (row.name_value ?? "")
      .split("\n")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0 && entry.length <= 253)
      .slice(0, 40),
    notBefore,
    notAfter,
    serialNumber: row.serial_number ?? null,
  };
}

function summarise(domain: string, rows: CtCertificate[], deprecateYear: number, disallowYear: number, now: Date): CtSummary {
  const recentCutoff = now.getTime() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  let recentCount = 0;
  let longestValidityDays = 0;
  let certificatesBeyond2030 = 0;
  let certificatesBeyond2035 = 0;
  let earliest = Number.POSITIVE_INFINITY;
  const issuers = new Set<string>();

  for (const cert of rows) {
    const start = new Date(cert.notBefore).getTime();
    const end = new Date(cert.notAfter).getTime();
    if (Number.isFinite(start)) {
      if (start < earliest) earliest = start;
      if (start >= recentCutoff) recentCount += 1;
    }
    if (Number.isFinite(start) && Number.isFinite(end)) {
      const days = Math.round((end - start) / 86_400_000);
      if (days > longestValidityDays) longestValidityDays = days;
      const year = new Date(end).getUTCFullYear();
      if (year > deprecateYear) certificatesBeyond2030 += 1;
      if (year > disallowYear) certificatesBeyond2035 += 1;
    }
    if (cert.issuer) issuers.add(cert.issuer);
  }

  return {
    domain,
    certificateCount: rows.length,
    recentCount,
    distinctIssuers: [...issuers].slice(0, 12),
    longestValidityDays,
    certificatesBeyond2030,
    certificatesBeyond2035,
    historyDays: Number.isFinite(earliest)
      ? Math.max(0, Math.round((now.getTime() - earliest) / 86_400_000))
      : 0,
    sampledIds: rows
      .slice()
      .sort((a, b) => b.id - a.id)
      .slice(0, 10)
      .map((cert) => cert.id),
  };
}

export interface CtLookupOptions {
  deprecateYear: number;
  disallowYear: number;
  now?: Date;
}

/** Fetch CT history for a domain. Throws CtLookupError on any failure. */
export async function fetchCertificateTransparency(
  domain: string,
  options: CtLookupOptions,
): Promise<{ summary: CtSummary; rows: CtCertificate[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CT_TIMEOUT_MS);
  const url = `https://crt.sh/?q=${encodeURIComponent(domain)}&output=json&exclude=expired`;

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "keyassay/1.0 (+https://github.com/aniruddhaadak80/keyassay)" },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new CtLookupError(
        "ct_unavailable",
        `Certificate Transparency lookup returned HTTP ${response.status} for ${domain}.`,
      );
    }

    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new CtLookupError(
        "ct_malformed",
        `Certificate Transparency lookup for ${domain} returned a body that is not valid JSON.`,
      );
    }

    if (!Array.isArray(parsed)) {
      throw new CtLookupError(
        "ct_malformed",
        `Certificate Transparency lookup for ${domain} returned an unexpected shape.`,
      );
    }

    const rows: CtCertificate[] = [];
    for (const entry of parsed.slice(0, CT_MAX_ROWS) as RawCtRow[]) {
      const row = parseRow(entry);
      if (row) rows.push(row);
    }

    const summary = summarise(
      domain,
      rows,
      options.deprecateYear,
      options.disallowYear,
      options.now ?? new Date(),
    );
    return { summary, rows };
  } catch (error) {
    if (error instanceof CtLookupError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new CtLookupError(
        "ct_timeout",
        `Certificate Transparency lookup for ${domain} exceeded ${CT_TIMEOUT_MS / 1000} seconds.`,
      );
    }
    throw new CtLookupError(
      "ct_error",
      `Certificate Transparency lookup for ${domain} failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

export function ctPayload(summary: CtSummary, fetchedAt: string): LivePayload<CtSummary> {
  const meta: SourceMeta = {
    status: "live",
    source: "Certificate Transparency (crt.sh)",
    upstreamId: summary.domain,
    attribution: `Certificate Transparency records for ${summary.domain} retrieved from crt.sh at ${fetchedAt}.`,
    fetchedAt,
  };
  return { status: "live", meta, data: summary };
}

/**
 * Sealed offline sample. Labelled as fallback everywhere, and never a substitute
 * for a user's own records.
 */
export function ctFallbackPayload(domain: string, reason: string): LivePayload<CtSummary> {
  const fetchedAt = new Date().toISOString();
  const summary: CtSummary = {
    domain,
    certificateCount: 0,
    recentCount: 0,
    distinctIssuers: [],
    longestValidityDays: 0,
    certificatesBeyond2030: 0,
    certificatesBeyond2035: 0,
    historyDays: 0,
    sampledIds: [],
  };
  const meta: SourceMeta = {
    status: "fallback",
    source: "Sealed offline sample",
    upstreamId: "sealed-sample/v1",
    attribution:
      "Sealed offline sample. No Certificate Transparency records were retrieved for this host, so CT-derived counts are zero and must not be read as a measurement.",
    fetchedAt,
    fallbackReason: reason,
  };
  return { status: "fallback", meta, data: summary };
}