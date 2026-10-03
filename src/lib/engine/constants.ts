import type { KeyAlgorithm } from "../types";

/**
 * Published constants used by the assay engine.
 *
 * Nothing here is invented. Every number carries the citation it came from, and
 * the engine surfaces that citation on each factor so a reader can check the
 * arithmetic instead of trusting it.
 */

/* ------------------------------------------------------------------ *
 * Shor cost model
 * ------------------------------------------------------------------ */

/**
 * Gidney & Ekerå, "How to factor 2048 bit RSA integers in 8 hours using 20
 * million noisy qubits", Quantum 5, 433 (2021), arXiv:1905.09749.
 *
 * From the abstract of that paper, for n-bit RSA in the abstract circuit model:
 *   logical qubits = 3n + 0.002 n lg(n)
 *   Toffoli gates   = 0.3 n^3 + 0.0005 n^3 lg(n)
 *
 * That model deliberately omits distillation and routing overhead, which is why
 * the paper's headline physical-qubit figure is much larger than logical x a
 * naive ratio. Both published physical figures are therefore carried explicitly
 * as anchors rather than being re-derived.
 */
export const SHOR_CITATION =
  "Gidney & Ekerå 2021, arXiv:1905.09749 (abstract circuit model: 3n + 0.002n·lg(n) logical qubits, 0.3n³ + 0.0005n³·lg(n) Toffolis)";

export const GIDNEY_EKERA_TITLE =
  "How to factor 2048 bit RSA integers in 8 hours using 20 million noisy qubits";
export const GIDNEY_EKERA_ARXIV = "1905.09749";

/**
 * Gidney, "How to factor 2048 bit RSA integers with less than a million noisy
 * qubits", arXiv:2505.15917 (2025): RSA-2048 in under a week with under one
 * million noisy qubits. This is the currently best published physical figure,
 * and the engine ships both so a reader can see how much the estimate moved.
 */
export const GIDNEY_2025_TITLE =
  "How to factor 2048 bit RSA integers with less than a million noisy qubits";
export const GIDNEY_2025_ARXIV = "2505.15917";

export type CostModelId = "gidney-ekera-2019" | "gidney-2025";

export interface CostModel {
  id: CostModelId;
  label: string;
  /** Published physical qubits needed to break RSA-2048. */
  rsa2048PhysicalQubits: number;
  citation: string;
  arxivId: string;
  publishedYear: number;
}

export const COST_MODELS: readonly CostModel[] = [
  {
    id: "gidney-ekera-2019",
    label: "Gidney & Ekerå 2019/2021 — 20M physical qubits, 8 hours",
    rsa2048PhysicalQubits: 20_000_000,
    citation:
      "Gidney & Ekerå, Quantum 5, 433 (2021): RSA-2048 factored in 8 hours with 20 million noisy qubits.",
    arxivId: GIDNEY_EKERA_ARXIV,
    publishedYear: 2021,
  },
  {
    id: "gidney-2025",
    label: "Gidney 2025 — under 1M physical qubits, under a week",
    rsa2048PhysicalQubits: 1_000_000,
    citation:
      "Gidney, arXiv:2505.15917 (2025): RSA-2048 factored in under a week with under one million noisy qubits.",
    arxivId: GIDNEY_2025_ARXIV,
    publishedYear: 2025,
  },
];

/** The anchor modulus the published physical-qubit figures are quoted for. */
export const ANCHOR_RSA_BITS = 2048;

/* ------------------------------------------------------------------ *
 * NIST SP 800-57 classical equivalences
 * ------------------------------------------------------------------ */

/**
 * NIST SP 800-57 Part 1 Rev. 5 security-strength equivalences, plus the
 * well-established fact that Grover's algorithm only halves the exponent of a
 * symmetric search, so an n-bit symmetric key retains n/2 bits against a
 * quantum attacker.
 */
export const NIST_CITATION =
  "NIST SP 800-57 Part 1 Rev. 5 security strength equivalences; Grover search over a symmetric key yields a square-root speedup";

export interface KeyEquivalence {
  /** Family match against the observed key material. */
  matches: (input: { algorithm: KeyAlgorithm; bits: number | null; curve: string | null }) => boolean;
  algorithm: KeyAlgorithm;
  algorithmLabel: string;
  bits: number | null;
  curve: string | null;
  classicalSecurityBits: number;
  /**
   * The RSA modulus size whose classical security equals this key's, used to
   * drive the cited circuit model. Stated explicitly rather than hidden.
   */
  effectiveRsaBits: number;
  equivalence: string;
}

function normCurve(curve: string | null): string {
  return (curve ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export const KEY_EQUIVALENCES: readonly KeyEquivalence[] = [
  {
    matches: ({ algorithm, bits }) => algorithm === "rsa" && bits === 2048,
    algorithm: "rsa",
    algorithmLabel: "RSA 2048",
    bits: 2048,
    curve: null,
    classicalSecurityBits: 112,
    effectiveRsaBits: 2048,
    equivalence: "NIST SP 800-57: RSA-2048 = 112-bit classical strength",
  },
  {
    matches: ({ algorithm, bits }) => algorithm === "rsa" && bits === 3072,
    algorithm: "rsa",
    algorithmLabel: "RSA 3072",
    bits: 3072,
    curve: null,
    classicalSecurityBits: 128,
    effectiveRsaBits: 3072,
    equivalence: "NIST SP 800-57: RSA-3072 = 128-bit classical strength",
  },
  {
    matches: ({ algorithm, bits }) => algorithm === "rsa" && bits === 4096,
    algorithm: "rsa",
    algorithmLabel: "RSA 4096",
    bits: 4096,
    curve: null,
    classicalSecurityBits: 152,
    effectiveRsaBits: 4096,
    equivalence: "NIST SP 800-57: RSA-4096 ≈ 152-bit classical strength",
  },
  {
    matches: ({ algorithm, bits }) => algorithm === "rsa" && bits === 7680,
    algorithm: "rsa",
    algorithmLabel: "RSA 7680",
    bits: 7680,
    curve: null,
    classicalSecurityBits: 192,
    effectiveRsaBits: 7680,
    equivalence: "NIST SP 800-57: RSA-7680 = 192-bit classical strength",
  },
  {
    matches: ({ algorithm, bits }) => algorithm === "rsa" && bits === 15360,
    algorithm: "rsa",
    algorithmLabel: "RSA 15360",
    bits: 15360,
    curve: null,
    classicalSecurityBits: 256,
    effectiveRsaBits: 15360,
    equivalence: "NIST SP 800-57: RSA-15360 = 256-bit classical strength",
  },
  {
    matches: ({ algorithm, bits }) => algorithm === "rsa" && bits === 1024,
    algorithm: "rsa",
    algorithmLabel: "RSA 1024",
    bits: 1024,
    curve: null,
    classicalSecurityBits: 80,
    effectiveRsaBits: 1024,
    equivalence: "NIST SP 800-57: RSA-1024 = 80-bit classical strength, below the 112-bit floor",
  },
  {
    matches: ({ algorithm, curve }) =>
      algorithm === "ec" &&
      ["prime256v1", "secp256r1", "nistp256"].includes(normCurve(curve)),
    algorithm: "ec",
    algorithmLabel: "ECDSA P-256 / prime256v1",
    bits: 256,
    curve: "prime256v1",
    classicalSecurityBits: 128,
    effectiveRsaBits: 3072,
    equivalence: "NIST SP 800-57: P-256 = 128-bit classical strength, equivalent to RSA-3072",
  },
  {
    matches: ({ algorithm, curve }) =>
      algorithm === "ec" && ["secp384r1", "nistp384"].includes(normCurve(curve)),
    algorithm: "ec",
    algorithmLabel: "ECDSA P-384",
    bits: 384,
    curve: "secp384r1",
    classicalSecurityBits: 192,
    effectiveRsaBits: 7680,
    equivalence: "NIST SP 800-57: P-384 = 192-bit classical strength, equivalent to RSA-7680",
  },
  {
    matches: ({ algorithm, curve }) =>
      algorithm === "ec" && ["secp521r1", "nistp521"].includes(normCurve(curve)),
    algorithm: "ec",
    algorithmLabel: "ECDSA P-521",
    bits: 521,
    curve: "secp521r1",
    classicalSecurityBits: 256,
    effectiveRsaBits: 15360,
    equivalence: "NIST SP 800-57: P-521 = 256-bit classical strength, equivalent to RSA-15360",
  },
  {
    matches: ({ algorithm }) => algorithm === "ed25519",
    algorithm: "ed25519",
    algorithmLabel: "Ed25519",
    bits: 256,
    curve: "ed25519",
    classicalSecurityBits: 128,
    effectiveRsaBits: 3072,
    equivalence:
      "NIST SP 800-57: Ed25519 = 128-bit classical strength, equivalent to RSA-3072",
  },
  {
    matches: ({ algorithm }) => algorithm === "dsa",
    algorithm: "dsa",
    algorithmLabel: "DSA",
    bits: null,
    curve: null,
    classicalSecurityBits: 112,
    effectiveRsaBits: 2048,
    equivalence: "NIST SP 800-57: 1024-bit DSA = 112-bit classical strength",
  },
];

/* ------------------------------------------------------------------ *
 * NIST IR 8547 transition clock
 * ------------------------------------------------------------------ */

export const IR8547_CITATION =
  "NIST IR 8547 (ipd), Transition to Post-Quantum Cryptography Standards: 112-bit-strength public keys deprecated after 2030; all quantum-vulnerable public key algorithms disallowed after 2035";

export const IR8547_DEPRECATE_YEAR = 2030;
export const IR8547_DISALLOW_YEAR = 2035;

/* ------------------------------------------------------------------ *
 * Capability growth policy
 * ------------------------------------------------------------------ */

/**
 * The starting point is the largest publicly announced physical qubit count
 * from a leading superconducting programme (IBM Condor, 1,121 qubits, December
 * 2023; Atom Computing reported 1,180 the same year). The growth rate is a
 * stated assumption, not a forecast, and is deliberately adjustable in the
 * product because no one can defend a single number here.
 */
export const CAPABILITY_CITATION =
  "Base physical qubit count anchored to publicly announced processor sizes (IBM Condor 1,121 qubits, Dec 2023); annual growth is a user-set assumption, not a forecast.";

export const DEFAULT_CAPABILITY_BASE_QUBITS = 1_200;
export const DEFAULT_CAPABILITY_BASE_YEAR = 2026;
export const DEFAULT_CAPABILITY_GROWTH = 0.35;

/* ------------------------------------------------------------------ *
 * Post-quantum algorithm detection
 * ------------------------------------------------------------------ */

/**
 * OpenSSL/Node report a certificate's signature algorithm as an OID name or a
 * human string. These are the post-quantum signature names that appear in
 * OpenSSL 3.5+ builds, which is where ML-DSA certificates show up in the wild.
 */
export const POST_QUANTUM_SIGNATURE_MARKERS: readonly string[] = [
  "ml-dsa",
  "mldsa",
  "ml_dsa",
  "dilithium",
  "falcon",
  "sphincs",
  "slh-dsa",
  "slhdsa",
];

/** TLS versions that are no longer acceptable under any reading of the clock. */
export const OBSOLETE_PROTOCOLS: readonly string[] = ["TLSv1", "TLSv1.1", "SSLv2", "SSLv3"];

/** Cipher suites whose symmetric key strength is already inadequate. */
export const WEAK_CIPHER_MARKERS: readonly string[] = [
  "_RC4_",
  "_3DES_",
  "_DES_",
  "_NULL_",
  "_EXPORT_",
  "_anon_",
  "_CBC_SHA",
];