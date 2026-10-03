import type { X509Certificate } from "node:crypto";

/**
 * A minimal DER reader, used for exactly one job: reading the signature
 * algorithm OID out of an X.509 certificate.
 *
 * Node's X509Certificate exposes the public key precisely but not the signature
 * algorithm, and "is this certificate signed with a post-quantum algorithm?" is a
 * question this product has to answer honestly rather than guess. The OIDs for
 * the NIST FIPS 204 signatures are known exactly, so the honest way to detect
 * them is to read the field.
 *
 *   Certificate    ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signature }
 *   TBSCertificate ::= SEQUENCE {
 *                        [0] EXPLICIT version OPTIONAL,
 *                        serialNumber INTEGER,
 *                        signature AlgorithmIdentifier,   <- what we want
 *                        ... }
 *
 * The walk is bounded and allocation-free; a malformed or truncated certificate
 * returns null rather than throwing, because a weird certificate must not be
 * able to crash an assay.
 */

export interface DerTlv {
  tag: number;
  contentStart: number;
  contentEnd: number;
  next: number;
}

const SEQUENCE_TAG = 0x30;
const OID_TAG = 0x06;
const INTEGER_TAG = 0x02;
const VERSION_TAG = 0xa0;

export function readTlv(der: Uint8Array, offset: number): DerTlv | null {
  if (offset + 2 > der.length) return null;
  const tag = der[offset] as number;
  let cursor = offset + 1;
  if (cursor >= der.length) return null;

  const lengthByte = der[cursor] as number;
  cursor += 1;
  let length: number;

  if ((lengthByte & 0x80) === 0) {
    length = lengthByte;
  } else {
    const byteCount = lengthByte & 0x7f;
    // A length that claims more bytes than the buffer holds is malformed.
    if (byteCount === 0 || byteCount > 4 || cursor + byteCount > der.length) return null;
    length = 0;
    for (let index = 0; index < byteCount; index += 1) {
      length = length * 256 + (der[cursor + index] as number);
    }
    cursor += byteCount;
  }

  const contentStart = cursor;
  const contentEnd = contentStart + length;
  if (contentEnd > der.length) return null;
  return { tag, contentStart, contentEnd, next: contentEnd };
}

/** Decode an OID's content bytes into dotted-decimal form. */
export function decodeOid(content: Uint8Array, start: number, end: number): string | null {
  if (end - start === 0) return null;
  const first = content[start] as number;
  const parts: number[] = [Math.floor(first / 40), first % 40];

  let value = 0;
  for (let index = start + 1; index < end; index += 1) {
    const byte = content[index] as number;
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join(".");
}

/**
 * Read the signatureAlgorithm OID from a certificate's DER bytes.
 * Returns null for anything it cannot confidently parse.
 */
export function parseSignatureAlgorithmOid(der: Uint8Array): string | null {
  const certificate = readTlv(der, 0);
  if (!certificate || certificate.tag !== SEQUENCE_TAG) return null;

  const tbs = readTlv(der, certificate.contentStart);
  if (!tbs || tbs.tag !== SEQUENCE_TAG) return null;

  let cursor = tbs.contentStart;

  // Optional explicit version tag.
  const maybeVersion = readTlv(der, cursor);
  if (maybeVersion?.tag === VERSION_TAG) {
    cursor = maybeVersion.next;
  }

  const serial = readTlv(der, cursor);
  if (!serial || serial.tag !== INTEGER_TAG) return null;
  cursor = serial.next;

  const algorithmIdentifier = readTlv(der, cursor);
  if (!algorithmIdentifier || algorithmIdentifier.tag !== SEQUENCE_TAG) return null;

  const oid = readTlv(der, algorithmIdentifier.contentStart);
  if (!oid || oid.tag !== OID_TAG) return null;

  return decodeOid(der, oid.contentStart, oid.contentEnd);
}

/* ------------------------------------------------------------------ *
 * NIST FIPS 204 / 205 signature OIDs
 * ------------------------------------------------------------------ */

export const ML_DSA_OIDS: Record<string, string> = {
  "2.16.840.1.101.3.4.3.17": "ML-DSA-44",
  "2.16.840.1.101.3.4.3.18": "ML-DSA-65",
  "2.16.840.1.101.3.4.3.19": "ML-DSA-87",
};

export const SLH_DSA_OID_PREFIX = "2.16.840.1.101.3.4.3.2";

export interface SignatureAlgorithm {
  oid: string | null;
  label: string | null;
  postQuantum: boolean;
}

export function classifySignatureAlgorithm(der: Uint8Array): SignatureAlgorithm {
  const oid = parseSignatureAlgorithmOid(der);
  if (!oid) return { oid: null, label: null, postQuantum: false };

  const ml = ML_DSA_OIDS[oid];
  if (ml) return { oid, label: ml, postQuantum: true };
  if (oid.startsWith(SLH_DSA_OID_PREFIX)) return { oid, label: "SLH-DSA", postQuantum: true };

  const known: Record<string, string> = {
    "1.2.840.113549.1.1.5": "SHA-1 with RSA",
    "1.2.840.113549.1.1.11": "SHA-256 with RSA",
    "1.2.840.113549.1.1.12": "SHA-384 with RSA",
    "1.2.840.113549.1.1.13": "SHA-512 with RSA",
    "1.2.840.10045.4.3.2": "ECDSA with SHA-256",
    "1.2.840.10045.4.3.3": "ECDSA with SHA-384",
    "1.2.840.10045.4.3.4": "ECDSA with SHA-512",
    "1.2.840.10045.4.1": "ECDSA with SHA-1",
    "1.3.101.112": "Ed25519",
    "1.3.101.113": "Ed448",
  };
  return { oid, label: known[oid] ?? `OID ${oid}`, postQuantum: false };
}

/* ------------------------------------------------------------------ *
 * Public key classification
 * ------------------------------------------------------------------ */

export interface PublicKeySummary {
  algorithm: "rsa" | "ec" | "ed25519" | "dsa" | "unknown";
  algorithmLabel: string;
  bits: number | null;
  curve: string | null;
  /** NIST SP 800-57 equivalence is resolved later, in the engine. */
  recognised: boolean;
}

export function summarisePublicKey(
  certificate: X509Certificate,
  /**
   * Key size and curve OID as reported alongside the handshake. Node exposes
   * these on the peer certificate rather than on X509Certificate, and the
   * public key object alone is missing them for some algorithms.
   */
  hints: { bits?: number | undefined; asn1Curve?: string | undefined } = {},
): PublicKeySummary {
  const key = certificate.publicKey;
  const details = key.asymmetricKeyDetails as
    | { modulusLength?: number; namedCurve?: string }
    | undefined;
  const type = key.asymmetricKeyType;

  if (type === "rsa" || type === "rsa-pss") {
    return {
      algorithm: "rsa",
      algorithmLabel: `RSA ${details?.modulusLength ?? hints.bits ?? "?"}`,
      bits: details?.modulusLength ?? hints.bits ?? null,
      curve: null,
      recognised: true,
    };
  }

  if (type === "ec") {
    const curve = details?.namedCurve ?? hints.asn1Curve ?? null;
    return {
      algorithm: "ec",
      algorithmLabel: curve ? `ECDSA ${curve}` : "ECDSA",
      bits: hints.bits ?? null,
      curve,
      recognised: Boolean(curve),
    };
  }

  if (type === "ed25519") {
    return {
      algorithm: "ed25519",
      algorithmLabel: "Ed25519",
      bits: 256,
      curve: "ed25519",
      recognised: true,
    };
  }

  if (type === "dsa") {
    return {
      algorithm: "dsa",
      algorithmLabel: "DSA",
      bits: hints.bits ?? null,
      curve: null,
      recognised: false,
    };
  }

  return {
    algorithm: "unknown",
    algorithmLabel: "Unrecognised public key",
    bits: hints.bits ?? null,
    curve: null,
    recognised: false,
  };
}

/** True when a certificate is self-issued and self-signed. */
export function isSelfSigned(certificate: X509Certificate): boolean {
  try {
    return certificate.checkIssued(certificate);
  } catch {
    // A malformed signature algorithm makes checkIssued throw; treating that as
    // "not self-signed" is the conservative choice, because it keeps the link in
    // the exposed set rather than silently excusing it.
    return false;
  }
}