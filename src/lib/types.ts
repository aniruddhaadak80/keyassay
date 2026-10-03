/**
 * Shared domain types.
 *
 * External data is normalised here, once, so that the UI, the REST layer and
 * the MCP tools all reason about exactly one shape. Every live payload keeps its
 * provenance: `status` (live | fallback), `fetchedAt`, `source` and `upstreamId`,
 * so a stale or sealed-offline record can never be presented as current.
 */

/* ------------------------------------------------------------------ *
 * Live source status
 * ------------------------------------------------------------------ */

export type SourceStatus = "live" | "fallback";

export interface SourceMeta {
  status: SourceStatus;
  /** Which upstream produced this payload. */
  source: string;
  /** Human-readable upstream identifier: host, DOI, arXiv id. */
  upstreamId: string;
  /** Attribution line for display and for exports. */
  attribution: string;
  /** ISO-8601 instant the payload was retrieved. */
  fetchedAt: string;
  /** Set when status is "fallback". */
  fallbackReason?: string;
}

export interface LivePayload<T> {
  status: SourceStatus;
  meta: SourceMeta;
  data: T;
}

/* ------------------------------------------------------------------ *
 * Live source 1: TLS handshake
 * ------------------------------------------------------------------ */

export type KeyAlgorithm = "rsa" | "ec" | "ed25519" | "dsa" | "unknown";

export interface ChainCertificate {
  subject: string;
  issuer: string;
  selfSigned: boolean;
  validFrom: string | null;
  validTo: string | null;
  /** Classified public-key algorithm of this certificate. */
  algorithm: KeyAlgorithm;
  /** Public-key size in bits, when the handshake reported one. */
  bits: number | null;
  /** Named curve for EC keys. */
  curve: string | null;
  /** True when the certificate was issued by a post-quantum algorithm. */
  postQuantum: boolean;
}

export interface TlsObservation {
  host: string;
  port: number;
  /** Negotiated protocol, e.g. TLSv1.3. */
  protocol: string | null;
  /** Negotiated cipher suite name. */
  cipher: string | null;
  authorized: boolean;
  authorizationError: string | null;
  /** Deepest chain position that is not self-signed. */
  chainDepth: number;
  chain: ChainCertificate[];
  /** OpenPGP/DER fingerprint of the leaf certificate. */
  fingerprint: string | null;
  serialNumber: string | null;
  subjectAlternativeNames: string[];
  /** True when the leaf certificate signature is post-quantum. */
  postQuantumSignature: boolean;
  /** Every cipher the server advertised during the handshake. */
  advertisedProtocols: string[];
  observedAt: string;
}

/* ------------------------------------------------------------------ *
 * Live source 2: Certificate Transparency (crt.sh)
 * ------------------------------------------------------------------ */

export interface CtCertificate {
  id: number;
  issuer: string;
  commonName: string | null;
  names: string[];
  notBefore: string;
  notAfter: string;
  serialNumber: string | null;
}

export interface CtSummary {
  domain: string;
  certificateCount: number;
  /** Certificates issued in the last 90 days. */
  recentCount: number;
  distinctIssuers: string[];
  /** Longest validity window observed, in days. */
  longestValidityDays: number;
  /**
   * How many observed certificates remain valid past the 2030 deprecation
   * date in NIST IR 8547. A certificate whose validity outlives the standard
   * forces its holder to re-issue after the key must already have changed.
   */
  certificatesBeyond2030: number;
  /** How many remain valid past the 2035 disallow date. */
  certificatesBeyond2035: number;
  /** Days since the earliest certificate in the sample was issued. */
  historyDays: number;
  /** Upstream ids consulted, newest first. */
  sampledIds: number[];
}

/* ------------------------------------------------------------------ *
 * Live source 3: arXiv citation verification
 * ------------------------------------------------------------------ */

export interface CitationRecord {
  arxivId: string;
  title: string;
  published: string;
  updated: string;
  authors: string[];
  abstract: string;
  url: string;
}

export interface CitationVerification {
  arxivId: string;
  status: SourceStatus;
  found: boolean;
  title: string | null;
  published: string | null;
  updated: string | null;
  authors: string[];
  url: string;
  /** True when the verified title matches the constant the engine cites. */
  titleMatches: boolean;
  checkedAt: string;
  reason?: string;
}

/* ------------------------------------------------------------------ *
 * Persisted entity: the Assay
 * ------------------------------------------------------------------ */

export type Grade = "bullion" | "sterling" | "base" | "corroded";

export const GRADES: readonly Grade[] = ["bullion", "sterling", "base", "corroded"];

export type Decision = "migrate-first" | "plan-hybrid" | "monitor" | "accepted";

export const DECISIONS: readonly Decision[] = [
  "migrate-first",
  "plan-hybrid",
  "monitor",
  "accepted",
];

export type FactorId =
  | "asymmetric-strength"
  | "shor-cost"
  | "harvest-window"
  | "lifetime-compliance"
  | "chain-exposure"
  | "protocol-cipher"
  | "post-quantum-readiness";

export interface Factor {
  id: FactorId;
  label: string;
  /** Weight in the composite score. Sums to 1 across all factors. */
  weight: number;
  /** Value as measured, in the factor's own unit. */
  raw: number;
  /** raw mapped onto 0..1 where 1 is best. */
  normalised: number;
  /** normalised * weight, the factor's actual contribution. */
  contribution: number;
  /** Plain-language statement of what was measured. */
  evidence: string;
  /** Published source supporting the measurement, where one applies. */
  citation: string | null;
}

export type FactorVerdict = "strong" | "adequate" | "weak" | "critical";

export interface AssayedChainLink {
  subject: string;
  issuer: string;
  algorithm: KeyAlgorithm;
  bits: number | null;
  curve: string | null;
  postQuantum: boolean;
  /** Equivalent RSA modulus size used for the Shor cost model. */
  effectiveRsaBits: number;
  classicalSecurityBits: number;
  /** Logical qubits a CRQC would need for this key. */
  logicalQubits: number;
  /** Toffoli gate count for the break. */
  toffolis: number;
  /** Calendar year this link is expected to fall, or null when post-quantum. */
  harvestYear: number | null;
  selfSigned: boolean;
}

export interface KeyCost {
  algorithm: KeyAlgorithm;
  algorithmLabel: string;
  bits: number | null;
  curve: string | null;
  /**
   * The RSA modulus size whose classical security equals this key's, per
   * NIST SP 800-57. This is the value the cited circuit model is evaluated at.
   */
  effectiveRsaBits: number;
  classicalSecurityBits: number;
  quantumSecurityBits: number | null;
  logicalQubits: number | null;
  toffolis: number | null;
  /** Physical qubits required, using the stated physical-per-logical ratio. */
  physicalQubits: number | null;
  harvestYear: number | null;
  postQuantum: boolean;
  /** NIST SP 800-57 equivalence used to derive the cost. */
  equivalence: string;
  citation: string;
}

export interface HarvestExposure {
  /** True when the leaf key is already post-quantum, so no break year applies. */
  postQuantum: boolean;
  /**
   * The year a CRQC is assumed to break this key under the active policy, or
   * null when the key is already post-quantum and no break year is modelled.
   */
  breakYear: number | null;
  /** Year the key stops being usable at all (certificate expiry). */
  expiryYear: number;
  /** Years of confidentiality still required by the policy. */
  requiredYears: number;
  /** Year the harvested ciphertext is expected to be readable. */
  readableYear: number | null;
  /** Years between now and readableYear, or null when not modelled. */
  yearsUntilReadable: number | null;
  /** HNDL exposure: harvested data is readable before it must expire. */
  exposed: boolean;
  /** Human-readable statement of the exposure decision. */
  statement: string;
}

export interface AssayPolicySnapshot {
  /** Calendar year a CRQC is assumed to reach the modelled break. */
  assumedCrqcYear: number;
  /** Physical qubits per logical qubit. */
  physicalPerLogical: number;
  /** Confidentiality lifetime required for harvested traffic, in years. */
  confidentialityYears: number;
  /** NIST IR 8547 deprecation year for 112-bit-strength public keys. */
  deprecateYear: number;
  /** NIST IR 8547 disallow year for all quantum-vulnerable public keys. */
  disallowYear: number;
  /** Minimum acceptable classical security strength in bits. */
  minimumClassicalBits: number;
  /** Version of the engine that produced the snapshot. */
  engineVersion: string;
}

export interface AssayResult {
  engineVersion: string;
  /** Composite quantum-resistance score, 0..100, higher is safer. */
  score: number;
  grade: Grade;
  gradeLabel: string;
  recommendation: string;
  factors: Factor[];
  keyCosts: KeyCost[];
  chain: AssayedChainLink[];
  exposure: HarvestExposure;
  policy: AssayPolicySnapshot;
  /** Weakest factor id, used to drive the recommendation. */
  weakestFactor: FactorId;
  computedAt: string;
}

export interface Assay {
  id: string;
  host: string;
  port: number;
  label: string;
  grade: Grade;
  score: number;
  keyAlgorithm: KeyAlgorithm;
  keyBits: number | null;
  curve: string | null;
  protocol: string | null;
  cipher: string | null;
  issuerCommonName: string | null;
  notAfter: string | null;
  chainDepth: number;
  ctCertificateCount: number | null;
  harvestYear: number | null;
  decision: Decision | null;
  notes: string | null;
  seal: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  tls: LivePayload<TlsObservation>;
  ct: LivePayload<CtSummary>;
  result: AssayResult;
}

export interface AssaySummary {
  id: string;
  host: string;
  port: number;
  label: string;
  grade: Grade;
  score: number;
  keyAlgorithm: KeyAlgorithm;
  keyBits: number | null;
  curve: string | null;
  protocol: string | null;
  harvestYear: number | null;
  decision: Decision | null;
  seal: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  tlsStatus: SourceStatus;
  ctStatus: SourceStatus;
  ctCertificateCount: number | null;
}

/* ------------------------------------------------------------------ *
 * Audit trail
 * ------------------------------------------------------------------ */

export type AuditEventType = "created" | "updated" | "decision" | "deleted";

export interface AuditEvent {
  entityId: string;
  seq: number;
  eventType: AuditEventType;
  payload: Record<string, unknown>;
  prevSeal: string;
  seal: string;
  createdAt: string;
}

export interface ReplayResult {
  ok: boolean;
  entityId: string;
  eventsChecked: number;
  /** Seal of the last event, or the genesis seal when there are none. */
  headSeal: string;
  firstBrokenSeq: number | null;
  reason: string | null;
  verifiedAt: string;
}

/* ------------------------------------------------------------------ *
 * API envelopes
 * ------------------------------------------------------------------ */

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface AssayListResponse {
  items: AssaySummary[];
  total: number;
  limit: number;
  offset: number;
}