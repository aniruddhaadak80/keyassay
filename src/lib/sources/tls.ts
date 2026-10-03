import { connect as tlsConnect, type DetailedPeerCertificate, type TLSSocket } from "node:tls";
import { X509Certificate } from "node:crypto";
import type {
  ChainCertificate,
  KeyAlgorithm,
  LivePayload,
  SourceMeta,
  TlsObservation,
} from "../types";
import { classifySignatureAlgorithm, isSelfSigned, summarisePublicKey } from "../x509";

/**
 * Live source 1: a real TLS handshake.
 *
 * This is not a lookup and not a simulation. The server opens a TCP connection
 * to port 443, performs the handshake, and reads the certificate chain the
 * remote endpoint actually presents, plus the protocol and cipher it actually
 * negotiates. If the host is down or refuses, the scan fails and says so.
 *
 * `rejectUnauthorized: false` is deliberate and necessary: an expired or
 * otherwise untrusted certificate is exactly the kind of material an assay must
 * be able to inspect rather than reject.
 */

const HANDSHAKE_TIMEOUT_MS = 8_000;
const MAX_CHAIN = 8;

export class TlsProbeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TlsProbeError";
    this.code = code;
  }
}

function formatName(name: string): string {
  const lines = name
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const cn = lines.find((line) => line.startsWith("CN="));
  const org = lines.find((line) => line.startsWith("O="));
  const commonName = cn ? cn.slice(3) : (lines[0] ?? "(no subject)");
  return org ? `${commonName} — ${org.slice(2)}` : commonName;
}

function toIso(value: string): string | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Walk the issuerCertificate links Node hands back, with loop protection. */
function flattenChain(root: DetailedPeerCertificate): DetailedPeerCertificate[] {
  const chain: DetailedPeerCertificate[] = [];
  const seen = new Set<string>();
  let current: DetailedPeerCertificate | null = root;

  while (current && chain.length < MAX_CHAIN) {
    const marker = current.fingerprint256 ?? `${current.serialNumber ?? ""}`;
    if (seen.has(marker)) break;
    seen.add(marker);
    chain.push(current);

    const issuer: DetailedPeerCertificate | undefined = current.issuerCertificate;
    if (!issuer || issuer === current) break;
    current = issuer;
  }
  return chain;
}

function mapChain(certificate: DetailedPeerCertificate): ChainCertificate | null {
  if (!certificate.raw || certificate.raw.length === 0) return null;
  let parsed: X509Certificate;
  try {
    parsed = new X509Certificate(certificate.raw);
  } catch {
    return null;
  }

  const key = summarisePublicKey(parsed, {
    bits: certificate.bits,
    asn1Curve: certificate.asn1Curve,
  });
  const signature = classifySignatureAlgorithm(certificate.raw);

  return {
    subject: formatName(parsed.subject),
    issuer: formatName(parsed.issuer),
    selfSigned: isSelfSigned(parsed),
    validFrom: toIso(parsed.validFrom),
    validTo: toIso(parsed.validTo),
    algorithm: key.algorithm as KeyAlgorithm,
    bits: key.bits,
    curve: key.curve,
    postQuantum: signature.postQuantum,
  };
}

/**
 * Perform the handshake and return a normalised observation.
 *
 * Throws TlsProbeError with a stable code on every failure mode so the API can
 * map them to honest 4xx/502 responses instead of leaking socket internals.
 */
export async function probeTls(host: string, port = 443): Promise<TlsObservation> {
  const observedAt = new Date().toISOString();

  return await new Promise<TlsObservation>((resolve, reject) => {
    let settled = false;
    let socket: TLSSocket | undefined;

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      try {
        socket?.destroy();
      } catch {
        // Destroying an already-closed socket is not an error worth surfacing.
      }
      fn();
    };

    try {
      socket = tlsConnect(
        {
          host,
          port,
          servername: /^[a-z0-9.-]+$/i.test(host) ? host : undefined,
          rejectUnauthorized: false,
          timeout: HANDSHAKE_TIMEOUT_MS,
        },
        () => {
          const active = socket;
          if (!active) {
            finish(() => reject(new TlsProbeError("connect_failed", "The TLS socket closed early.")));
            return;
          }

          let peer: DetailedPeerCertificate;
          try {
            peer = active.getPeerCertificate(true);
          } catch {
            finish(() =>
              reject(
                new TlsProbeError(
                  "no_certificate",
                  `${host} completed a TLS handshake but no certificate could be read from it.`,
                ),
              ),
            );
            return;
          }

          if (!peer || !peer.raw || peer.raw.length === 0) {
            finish(() =>
              reject(
                new TlsProbeError(
                  "no_certificate",
                  `${host} completed a TLS handshake but presented no certificate, so there is no key material to assay.`,
                ),
              ),
            );
            return;
          }

          const chain = flattenChain(peer)
            .map(mapChain)
            .filter((entry): entry is ChainCertificate => entry !== null);

          if (chain.length === 0) {
            finish(() =>
              reject(
                new TlsProbeError(
                  "unparseable_certificate",
                  `The certificate presented by ${host} could not be parsed, so it cannot be assayed.`,
                ),
              ),
            );
            return;
          }

          const leafSignature = classifySignatureAlgorithm(peer.raw);
          const cipher = active.getCipher();
          const protocol = active.getProtocol();

          const observation: TlsObservation = {
            host,
            port,
            protocol: protocol ?? null,
            cipher: cipher?.name ?? null,
            authorized: active.authorized,
            authorizationError:
              active.authorizationError instanceof Error
                ? active.authorizationError.message
                : active.authorizationError
                  ? String(active.authorizationError)
                  : null,
            chainDepth: Math.max(0, chain.filter((link) => !link.selfSigned).length - 1),
            chain,
            fingerprint: peer.fingerprint256 ?? null,
            serialNumber: peer.serialNumber ?? null,
            subjectAlternativeNames: (() => {
              try {
                const alt = new X509Certificate(peer.raw).subjectAltName ?? "";
                return alt
                  .split(",")
                  .map((entry) => entry.trim())
                  .filter((entry) => entry.length > 0 && entry.length <= 253)
                  .slice(0, 40);
              } catch {
                return [];
              }
            })(),
            postQuantumSignature: leafSignature.postQuantum,
            advertisedProtocols: [protocol].filter((entry): entry is string => Boolean(entry)),
            observedAt,
          };

          finish(() => resolve(observation));
        },
      );
    } catch (error) {
      finish(() =>
        reject(
          new TlsProbeError(
            "connect_failed",
            `Could not open a TLS connection to ${host}:${port}. ${error instanceof Error ? error.message : "unknown error"}`,
          ),
        ),
      );
      return;
    }

    const activeSocket = socket;
    if (!activeSocket) return;

    activeSocket.on("timeout", () => {
      finish(() =>
        reject(
          new TlsProbeError(
            "timeout",
            `The TLS handshake with ${host}:${port} did not complete within ${HANDSHAKE_TIMEOUT_MS / 1000} seconds.`,
          ),
        ),
      );
    });

    activeSocket.on("error", (error: NodeJS.ErrnoException) => {
      const code =
        error.code === "ENOTFOUND"
          ? "dns_failure"
          : error.code === "ECONNREFUSED"
            ? "connection_refused"
            : error.code === "ETIMEDOUT"
              ? "timeout"
              : "tls_error";
      finish(() =>
        reject(
          new TlsProbeError(
            code,
            `TLS handshake with ${host}:${port} failed (${error.code ?? "unknown"}): ${error.message}`,
          ),
        ),
      );
    });
  });
}

export function tlsPayload(observation: TlsObservation): LivePayload<TlsObservation> {
  const meta: SourceMeta = {
    status: "live",
    source: "TLS handshake",
    upstreamId: `${observation.host}:${observation.port}`,
    attribution: `Direct TLS handshake with ${observation.host}, performed at ${observation.observedAt}.`,
    fetchedAt: observation.observedAt,
  };
  return { status: "live", meta, data: observation };
}

/**
 * Sealed offline sample.
 *
 * Used only when the handshake genuinely cannot run, so that a first paint and a
 * production build never break. It is clearly labelled "fallback" everywhere it
 * surfaces, and it is a labelled shape rather than a fabricated measurement.
 */
export function tlsFallbackPayload(host: string, reason: string): LivePayload<TlsObservation> {
  const observedAt = new Date().toISOString();
  const observation: TlsObservation = {
    host,
    port: 443,
    protocol: "TLSv1.3",
    cipher: "TLS_AES_128_GCM_SHA256",
    authorized: false,
    authorizationError: "No handshake was performed; this is a sealed sample record.",
    chainDepth: 1,
    chain: [
      {
        subject: "CN = sealed-sample.invalid",
        issuer: "CN = Sealed Sample Intermediate",
        selfSigned: false,
        validFrom: "2026-01-01T00:00:00.000Z",
        validTo: "2027-01-01T00:00:00.000Z",
        algorithm: "ec",
        bits: 256,
        curve: "prime256v1",
        postQuantum: false,
      },
      {
        subject: "CN = Sealed Sample Intermediate",
        issuer: "CN = Sealed Sample Root",
        selfSigned: false,
        validFrom: "2026-01-01T00:00:00.000Z",
        validTo: "2032-01-01T00:00:00.000Z",
        algorithm: "rsa",
        bits: 4096,
        curve: null,
        postQuantum: false,
      },
      {
        subject: "CN = Sealed Sample Root",
        issuer: "CN = Sealed Sample Root",
        selfSigned: true,
        validFrom: "2026-01-01T00:00:00.000Z",
        validTo: "2036-01-01T00:00:00.000Z",
        algorithm: "rsa",
        bits: 4096,
        curve: null,
        postQuantum: false,
      },
    ],
    fingerprint: "SEALED-SAMPLE-NOT-A-LIVE-CERTIFICATE",
    serialNumber: "00SEALED00SAMPLE00",
    subjectAlternativeNames: ["DNS:sealed-sample.invalid"],
    postQuantumSignature: false,
    advertisedProtocols: [],
    observedAt,
  };
  const meta: SourceMeta = {
    status: "fallback",
    source: "Sealed offline sample",
    upstreamId: "sealed-sample/v1",
    attribution:
      "Sealed offline sample. This is NOT a live measurement of the requested host and must not be read as one.",
    fetchedAt: observedAt,
    fallbackReason: reason,
  };
  return { status: "fallback", meta, data: observation };
}