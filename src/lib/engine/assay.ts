import type {
  AssayResult,
  AssayedChainLink,
  CtSummary,
  Factor,
  FactorId,
  FactorVerdict,
  Grade,
  HarvestExposure,
  KeyAlgorithm,
  KeyCost,
  LivePayload,
  TlsObservation,
} from "../types";
import {
  ANCHOR_RSA_BITS,
  CAPABILITY_CITATION,
  COST_MODELS,
  DEFAULT_CAPABILITY_BASE_QUBITS,
  DEFAULT_CAPABILITY_BASE_YEAR,
  DEFAULT_CAPABILITY_GROWTH,
  IR8547_CITATION,
  IR8547_DEPRECATE_YEAR,
  IR8547_DISALLOW_YEAR,
  KEY_EQUIVALENCES,
  NIST_CITATION,
  OBSOLETE_PROTOCOLS,
  SHOR_CITATION,
  WEAK_CIPHER_MARKERS,
  type CostModelId,
  type KeyEquivalence,
} from "./constants";

/**
 * The deterministic assay engine.
 *
 * This is the single implementation used by the UI, the REST endpoints and the
 * MCP tools. Nothing here is recomputed in a component: a React card and an
 * agent tool call produce identical numbers for identical inputs, because they
 * call this one function.
 *
 * The engine separates two very different kinds of input:
 *
 *   PUBLISHED CONSTANTS  - Shor circuit costs from Gidney & Ekerå, NIST
 *                          SP 800-57 equivalences, the NIST IR 8547 clock.
 *                          These are cited on every factor that uses them.
 *
 *   POLICY ASSUMPTIONS   - when a cryptographically relevant quantum computer
 *                          is expected to reach the modelled capability, and
 *                          how long harvested data must stay secret. These are
 *                          the visitor's own risk position, set in the product,
 *                          and are never presented as predictions.
 *
 * Everything is a pure function of (observation, policy, currentYear). Feed it
 * the same three and you get the same result byte for byte.
 */

export const ENGINE_VERSION = "keyassay/1.0.0";

export interface AssayPolicy {
  /** Year by which harvested traffic must still be unreadable. */
  horizonYear: number;
  costModel: CostModelId;
  capabilityBaseQubits: number;
  capabilityBaseYear: number;
  /** Fractional annual growth in error-corrected physical qubit capacity. */
  capabilityGrowth: number;
  minimumClassicalBits: number;
  deprecateYear: number;
  disallowYear: number;
}

export const DEFAULT_POLICY: AssayPolicy = {
  horizonYear: 2040,
  costModel: "gidney-2025",
  capabilityBaseQubits: DEFAULT_CAPABILITY_BASE_QUBITS,
  capabilityBaseYear: DEFAULT_CAPABILITY_BASE_YEAR,
  capabilityGrowth: DEFAULT_CAPABILITY_GROWTH,
  minimumClassicalBits: 112,
  deprecateYear: IR8547_DEPRECATE_YEAR,
  disallowYear: IR8547_DISALLOW_YEAR,
};

export interface AssayInput {
  tls: LivePayload<TlsObservation>;
  ct: LivePayload<CtSummary>;
  policy?: Partial<AssayPolicy>;
  /** Injected so results are deterministic in tests. */
  currentYear?: number;
  now?: string;
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function clamp(value: number, low = 0, high = 1): number {
  if (Number.isNaN(value)) return low;
  return Math.min(high, Math.max(low, value));
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Linear interpolation from a raw measurement onto 0..1, where 1 is best. */
function band(value: number, worst: number, best: number): number {
  if (worst === best) return value <= worst ? 1 : 0;
  return clamp((best - value) / (best - worst));
}

/** Maps a "break year" onto 0..1: earlier breaks are worse. */
function bandYear(year: number, worstYear: number, bestYear: number): number {
  return band(year, worstYear, bestYear);
}

export function gradeFor(score: number): Grade {
  if (score >= 80) return "bullion";
  if (score >= 62) return "sterling";
  if (score >= 42) return "base";
  return "corroded";
}

export const GRADE_LABELS: Record<Grade, string> = {
  bullion: "Bullion — quantum-resistant for the stated horizon",
  sterling: "Sterling — strong, migration can follow the normal cycle",
  base: "Base — exposed inside the planning horizon",
  corroded: "Corroded — harvest-now-decrypt-later exposure is live",
};

export function verdictFor(normalised: number): FactorVerdict {
  if (normalised >= 0.75) return "strong";
  if (normalised >= 0.5) return "adequate";
  if (normalised >= 0.25) return "weak";
  return "critical";
}

function formatYear(year: number): string {
  return String(Math.round(year));
}

function formatQubits(value: number | null): string {
  if (value === null) return "not modelled";
  if (value >= 1_000_000) return `${round(value / 1_000_000, 2)}M physical qubits`;
  if (value >= 1_000) return `${round(value / 1_000, 1)}k physical qubits`;
  return `${Math.round(value)} physical qubits`;
}

function formatToffolis(value: number | null): string {
  if (value === null) return "not modelled";
  const exponent = Math.floor(Math.log10(value));
  const mantissa = value / 10 ** exponent;
  return `~${round(mantissa, 2)}e${exponent} Toffoli gates`;
}

/* ------------------------------------------------------------------ *
 * Shor cost model
 * ------------------------------------------------------------------ */

/** Gidney & Ekerå abstract-circuit logical qubit count for an n-bit modulus. */
export function logicalQubitsForModulus(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const lg = Math.log2(n);
  return Math.round(3 * n + 0.002 * n * lg);
}

/** Gidney & Ekerå abstract-circuit Toffoli count for an n-bit modulus. */
export function toffolisForModulus(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const lg = Math.log2(n);
  return Math.round(0.3 * n ** 3 + 0.0005 * n ** 3 * lg);
}

/** Anchor-relative scaling applied to a non-2048-bit modulus. */
function modulusScale(n: number): { qubits: number; gates: number } {
  const anchorLogical = logicalQubitsForModulus(ANCHOR_RSA_BITS);
  const anchorGates = toffolisForModulus(ANCHOR_RSA_BITS);
  const logical = logicalQubitsForModulus(n);
  const gates = toffolisForModulus(n);
  return {
    qubits: anchorLogical === 0 ? 1 : logical / anchorLogical,
    gates: anchorGates === 0 ? 1 : gates / anchorGates,
  };
}

/**
 * Physical qubits a CRQC would need to break the key.
 *
 * The published figures are quoted for RSA-2048 only. Rather than multiply a
 * logical count by a guessed error-correction ratio, the engine scales the
 * published anchor by the ratio of abstract-circuit costs at the key's own
 * modulus size. That reproduces both published numbers exactly at 2048 bits and
 * scales by something the cited model actually describes.
 */
export function physicalQubitsFor(effectiveRsaBits: number, policy: AssayPolicy): number {
  const model = COST_MODELS.find((entry) => entry.id === policy.costModel) ?? COST_MODELS[1];
  if (!model) return 0;
  const scale = modulusScale(effectiveRsaBits);
  return Math.round(model.rsa2048PhysicalQubits * scale.qubits);
}

/**
 * The calendar year a CRQC is expected to reach the capability needed to break
 * this key, under the visitor's stated growth assumption.
 *
 * capacity(year) = base * (1 + growth) ^ (year - baseYear)
 * breakYear      = smallest year where capacity >= physicalQubitsRequired
 *
 * Closed form, then ceiling. Deterministic, and inspectable: change the growth
 * rate and every number in the product moves.
 */
export function breakYearFor(effectiveRsaBits: number, policy: AssayPolicy): number {
  const required = physicalQubitsFor(effectiveRsaBits, policy);
  if (required <= 0) return policy.capabilityBaseYear;
  const growth = policy.capabilityGrowth;
  if (growth <= 0) return 2200;
  if (required <= policy.capabilityBaseQubits) return policy.capabilityBaseYear;
  const years = Math.log(required / policy.capabilityBaseQubits) / Math.log(1 + growth);
  if (!Number.isFinite(years)) return 2200;
  return Math.min(2200, Math.ceil(policy.capabilityBaseYear + years));
}

/* ------------------------------------------------------------------ *
 * Key classification
 * ------------------------------------------------------------------ */

export interface ResolvedKey {
  equivalence: KeyEquivalence | null;
  algorithm: KeyAlgorithm;
  algorithmLabel: string;
  bits: number | null;
  curve: string | null;
  classicalSecurityBits: number;
  effectiveRsaBits: number;
  equivalenceNote: string;
  recognised: boolean;
}

const UNKNOWN_KEY: Omit<ResolvedKey, "bits" | "curve"> = {
  equivalence: null,
  algorithm: "unknown",
  algorithmLabel: "Unrecognised public key",
  classicalSecurityBits: 0,
  effectiveRsaBits: ANCHOR_RSA_BITS,
  equivalenceNote:
    "Key material could not be matched to a NIST SP 800-57 equivalence. The cost model falls back to an RSA-2048-equivalent workload and marks the result as unverified.",
  recognised: false,
};

export function resolveKey(input: {
  algorithm: KeyAlgorithm;
  bits: number | null;
  curve: string | null;
}): ResolvedKey {
  const matched = KEY_EQUIVALENCES.find((entry) => entry.matches(input));
  if (!matched) {
    return {
      ...UNKNOWN_KEY,
      bits: input.bits,
      curve: input.curve,
    };
  }
  return {
    equivalence: matched,
    algorithm: matched.algorithm,
    algorithmLabel: matched.algorithmLabel,
    bits: matched.bits ?? input.bits,
    curve: matched.curve ?? input.curve,
    classicalSecurityBits: matched.classicalSecurityBits,
    effectiveRsaBits: matched.effectiveRsaBits,
    equivalenceNote: matched.equivalence,
    recognised: true,
  };
}

/** Symmetric/hash quantum margin: Grover only halves the exponent. */
function quantumBitsForSymmetric(classicalBits: number): number {
  return Math.floor(classicalBits / 2);
}

/* ------------------------------------------------------------------ *
 * Per-key cost
 * ------------------------------------------------------------------ */

export function costFor(
  input: { algorithm: KeyAlgorithm; bits: number | null; curve: string | null; postQuantum: boolean },
  policy: AssayPolicy,
): KeyCost {
  const model = COST_MODELS.find((entry) => entry.id === policy.costModel) ?? COST_MODELS[1];
  const resolved = resolveKey(input);

  if (input.postQuantum) {
    return {
      algorithm: input.algorithm,
      algorithmLabel: resolved.algorithmLabel,
      bits: input.bits,
      curve: input.curve,
      effectiveRsaBits: resolved.effectiveRsaBits,
      classicalSecurityBits: resolved.classicalSecurityBits || 128,
      quantumSecurityBits: resolved.classicalSecurityBits || 128,
      logicalQubits: null,
      toffolis: null,
      physicalQubits: null,
      harvestYear: null,
      postQuantum: true,
      equivalence:
        "Post-quantum algorithm. No Shor attack applies, so no break year is modelled.",
      citation:
        "NIST FIPS 203/204/205 (ML-KEM, ML-DSA, SLH-DSA) are quantum-resistant by construction; NIST IR 8547 keeps them as the migration target.",
    };
  }

  const classical = resolved.classicalSecurityBits;
  const isSymmetric = input.algorithm === "unknown" && input.bits !== null && classical > 0;
  const quantum = isSymmetric ? quantumBitsForSymmetric(classical) : null;

  return {
    algorithm: input.algorithm,
    algorithmLabel: resolved.algorithmLabel,
    bits: input.bits,
    curve: input.curve,
    effectiveRsaBits: resolved.effectiveRsaBits,
    classicalSecurityBits: classical,
    quantumSecurityBits: quantum,
    logicalQubits: logicalQubitsForModulus(resolved.effectiveRsaBits),
    toffolis: toffolisForModulus(resolved.effectiveRsaBits),
    physicalQubits: physicalQubitsFor(resolved.effectiveRsaBits, policy),
    harvestYear: breakYearFor(resolved.effectiveRsaBits, policy),
    postQuantum: false,
    equivalence: resolved.equivalenceNote,
    citation: model?.citation ?? SHOR_CITATION,
  };
}

/* ------------------------------------------------------------------ *
 * The engine
 * ------------------------------------------------------------------ */

export function runAssay(input: AssayInput): AssayResult {
  const policy: AssayPolicy = { ...DEFAULT_POLICY, ...(input.policy ?? {}) };
  const currentYear = input.currentYear ?? new Date().getFullYear();
  const computedAt = input.now ?? new Date().toISOString();

  const { data: tls } = input.tls;
  const ct = input.ct.data;

  /* -- Chain costs ------------------------------------------------- */

  const chain: AssayedChainLink[] = tls.chain.map((link) => {
    const resolved = resolveKey({
      algorithm: link.algorithm,
      bits: link.bits,
      curve: link.curve,
    });
    return {
      subject: link.subject,
      issuer: link.issuer,
      algorithm: link.algorithm,
      bits: link.bits,
      curve: link.curve,
      postQuantum: link.postQuantum,
      effectiveRsaBits: resolved.effectiveRsaBits,
      classicalSecurityBits: resolved.classicalSecurityBits,
      logicalQubits: link.postQuantum ? 0 : logicalQubitsForModulus(resolved.effectiveRsaBits),
      toffolis: link.postQuantum ? 0 : toffolisForModulus(resolved.effectiveRsaBits),
      harvestYear: link.postQuantum ? null : breakYearFor(resolved.effectiveRsaBits, policy),
      selfSigned: link.selfSigned,
    };
  });

  const leaf = chain[0] ?? null;
  const leafResolved = resolveKey({
    algorithm: tls.chain[0]?.algorithm ?? "unknown",
    bits: tls.chain[0]?.bits ?? null,
    curve: tls.chain[0]?.curve ?? null,
  });

  /**
   * A leaf that is already signed post-quantum has no Shor break year at all.
   * That is a categorically different finding from "a very far away break year",
   * so it is tracked as a flag rather than being flattened into a sentinel
   * year that every downstream factor would then have to special-case.
   */
  const leafIsQuantumSafe = leaf?.postQuantum ?? tls.postQuantumSignature;

  const leafCost = costFor(
    {
      algorithm: leafResolved.algorithm,
      bits: leaf?.bits ?? null,
      curve: leaf?.curve ?? null,
      postQuantum: leafIsQuantumSafe,
    },
    policy,
  );

  const breakYear = leafIsQuantumSafe ? null : (leafCost.harvestYear ?? (currentYear + 100));

  /* -- Exposure ---------------------------------------------------- */

  const expiryYear = tls.chain[0]?.validTo
    ? new Date(tls.chain[0].validTo).getUTCFullYear()
    : currentYear;
  const requiredHorizonYear = policy.horizonYear;
  const readableYear = breakYear;
  const yearsUntilReadable = breakYear === null ? null : breakYear - currentYear;
  const exposed = breakYear !== null && breakYear <= requiredHorizonYear;

  const exposure: HarvestExposure = leafIsQuantumSafe
    ? {
        postQuantum: true,
        breakYear: null,
        expiryYear,
        requiredYears: requiredHorizonYear - currentYear,
        readableYear: null,
        yearsUntilReadable: null,
        exposed: false,
        statement: `The leaf certificate is already signed with a post-quantum algorithm, so no Shor break year is modelled for it. Harvested traffic is not exposed through this key. Confirm that the key-establishment side of the connection is also post-quantum: a post-quantum certificate in front of a classical key exchange leaves the session keys exposed.`,
      }
    : {
        postQuantum: false,
        breakYear,
        expiryYear,
        requiredYears: requiredHorizonYear - currentYear,
        readableYear,
        yearsUntilReadable,
        exposed,
        statement: exposed
          ? `A CRQC is modelled to break this key in ${formatYear(readableYear as number)}, inside the ${formatYear(requiredHorizonYear)} confidentiality horizon. Traffic captured today is therefore assumed to be readable before it must expire, and rotating the certificate does not change that: the exposure is in the harvested ciphertext, not in the live key.`
          : `A CRQC is modelled to break this key in ${formatYear(readableYear as number)}, beyond the ${formatYear(requiredHorizonYear)} confidentiality horizon. Harvested traffic is assumed to stay unreadable for as long as it must be retained.`,
      };

  /* -- Factors ----------------------------------------------------- */

  const factors: Factor[] = [];

  // 1. Asymmetric strength against the policy floor.
  const strengthRaw = leafResolved.classicalSecurityBits;
  const strengthNorm = strengthRaw === 0
    ? 0
    : clamp(
        strengthRaw >= policy.minimumClassicalBits
          ? 1 - (policy.minimumClassicalBits - strengthRaw) / 200
          : strengthRaw / policy.minimumClassicalBits,
      );
  factors.push({
    id: "asymmetric-strength",
    label: "Classical strength of the leaf public key",
    weight: 0.2,
    raw: strengthRaw,
    normalised: round(strengthNorm, 4),
    contribution: round(strengthNorm * 0.2, 4),
    evidence:
      strengthRaw === 0
        ? "The leaf public key could not be classified, so no classical strength could be measured."
        : `${leafCost.algorithmLabel} provides ${strengthRaw} bits of classical security against the policy floor of ${policy.minimumClassicalBits} bits.`,
    citation: leafResolved.equivalenceNote === UNKNOWN_KEY.equivalenceNote ? NIST_CITATION : leafResolved.equivalenceNote,
  });

  // 2. Shor cost against the disallow clock.
  const costNorm = leafIsQuantumSafe
    ? 1
    : bandYear(breakYear as number, policy.disallowYear, policy.disallowYear + 40);
  factors.push({
    id: "shor-cost",
    label: "Quantum cost to break the leaf key",
    weight: 0.22,
    raw: breakYear ?? 0,
    normalised: round(costNorm, 4),
    contribution: round(costNorm * 0.22, 4),
    evidence: leafIsQuantumSafe
      ? `${leafCost.algorithmLabel} is signed post-quantum, so no Shor attack applies and no break year is modelled.`
      : `${leafCost.algorithmLabel} maps to an ${leafResolved.effectiveRsaBits}-bit equivalent modulus, needing ${formatQubits(leafCost.physicalQubits)} and ${formatToffolis(leafCost.toffolis)}. Under the stated growth assumption that capability arrives in ${formatYear(breakYear as number)}.`,
    citation: `${leafCost.citation}; ${CAPABILITY_CITATION}`,
  });

  // 3. Harvest-now-decrypt-later window: the decisive factor.
  //
  // This factor is anchored so that sitting exactly on the horizon scores 0.5:
  // half a point of credit for merely keeping pace, and a real penalty for every
  // year the break lands inside the confidentiality requirement. Saturation here
  // would be a bug, because a very distant horizon would otherwise make an
  // exposed key look safe.
  const windowNorm = leafIsQuantumSafe
    ? 1
    : exposed
      ? clamp(0.5 + (breakYear as number - policy.horizonYear) / 20)
      : clamp(0.5 + (policy.horizonYear - (breakYear as number)) / 40);
  const windowYears = leafIsQuantumSafe
    ? null
    : (breakYear as number) - policy.horizonYear;
  factors.push({
    id: "harvest-window",
    label: "Harvest-now-decrypt-later margin",
    weight: 0.24,
    raw: windowYears ?? 0,
    normalised: round(windowNorm, 4),
    contribution: round(windowNorm * 0.24, 4),
    evidence: leafIsQuantumSafe
      ? "No Shor break applies to this leaf, so harvested traffic is not exposed through it."
      : exposed
        ? `Break year ${formatYear(breakYear as number)} is ${Math.abs(windowYears as number)} year${Math.abs(windowYears as number) === 1 ? "" : "s"} inside the ${formatYear(policy.horizonYear)} horizon. Harvested traffic is exposed.`
        : `Break year ${formatYear(breakYear as number)} sits ${windowYears as number} years beyond the ${formatYear(policy.horizonYear)} horizon. Harvested traffic is assumed to stay unreadable.`,
    citation: CAPABILITY_CITATION,
  });

  // 4. Certificate lifetime and issuance posture against the IR 8547 clock.
  //
  // Two signals here. The leaf's own validity window decides whether it can be
  // re-issued unchanged once the standard lands. The Certificate Transparency
  // history says whether the issuing organisation as a whole is still minting
  // certificates that outlive the clock, which is a different and worse problem
  // than one long-lived leaf.
  const beyondDeprecate = expiryYear > policy.deprecateYear;
  const beyondDisallow = expiryYear > policy.disallowYear;
  const ctTotal = ct.certificateCount;
  const ctBeyond = ct.certificatesBeyond2030;
  const ctShare = ctTotal > 0 ? ctBeyond / ctTotal : 0;
  const lifetimeScore = beyondDisallow ? 0 : beyondDeprecate ? 0.4 : 1;
  const lifetimeNorm = round(lifetimeScore * (1 - 0.5 * ctShare), 4);
  factors.push({
    id: "lifetime-compliance",
    label: "Certificate lifetime against NIST IR 8547",
    weight: 0.12,
    raw: expiryYear,
    normalised: lifetimeNorm,
    contribution: round(lifetimeNorm * 0.12, 4),
    evidence: beyondDisallow
      ? `The leaf certificate is valid until ${expiryYear}, past the ${policy.disallowYear} disallow date, so it cannot be re-issued unchanged once the standard lands.`
      : beyondDeprecate
        ? `The leaf certificate is valid until ${expiryYear}, past the ${policy.deprecateYear} deprecation date but inside the ${policy.disallowYear} disallow date.`
        : `The leaf certificate expires in ${expiryYear}, before the ${policy.deprecateYear} deprecation date.`,
    citation: IR8547_CITATION,
  });

  // The CT signal is surfaced as part of the compliance evidence rather than as
  // an eighth weight, so it can sharpen the existing factor without letting a
  // single ratio dominate the composite.
  if (ctBeyond > 0) {
    const ctFactor = factors.find((entry) => entry.id === "lifetime-compliance");
    if (ctFactor) {
      ctFactor.evidence += ` Certificate Transparency also shows ${ctBeyond} of ${ctTotal} certificates for this host valid past ${policy.deprecateYear}, so the issuance policy itself has not been shortened yet.`;
    }
  }

  // 5. Chain exposure: every issuing CA is a harvest target too.
  const attackerControlled = chain.filter((link) => !link.selfSigned);
  const exposedLinks = attackerControlled.filter(
    (link) => !link.postQuantum && link.harvestYear !== null && link.harvestYear <= policy.horizonYear,
  );
  const chainNorm = attackerControlled.length === 0
    ? 0.5
    : clamp(1 - exposedLinks.length / attackerControlled.length);
  factors.push({
    id: "chain-exposure",
    label: "Certificate chain exposure",
    weight: 0.1,
    raw: exposedLinks.length,
    normalised: round(chainNorm, 4),
    contribution: round(chainNorm * 0.1, 4),
    evidence: attackerControlled.length === 0
      ? "No non-self-signed link was presented in the handshake, so chain exposure could not be measured."
      : `${exposedLinks.length} of ${attackerControlled.length} attacker-controlled chain link${attackerControlled.length === 1 ? "" : "s"} fall before the ${formatYear(policy.horizonYear)} horizon. Every issuing CA key is itself a harvest target.`,
    citation: SHOR_CITATION,
  });

  // 6. Protocol and negotiated cipher.
  const protocol = tls.protocol ?? "";
  const cipher = tls.cipher ?? "";
  const protocolObsolete = OBSOLETE_PROTOCOLS.some((entry) => protocol.startsWith(entry));
  const cipherWeak = WEAK_CIPHER_MARKERS.some((entry) => cipher.includes(entry));
  const protocolNorm = protocolObsolete ? 0 : protocol === "TLSv1.3" ? 1 : protocol === "TLSv1.2" ? 0.75 : 0.4;
  const cipherNorm = cipherWeak ? 0 : cipher.includes("GCM") || cipher.includes("CHACHA") ? 1 : 0.6;
  const transportNorm = round(protocolNorm * 0.6 + cipherNorm * 0.4, 4);
  factors.push({
    id: "protocol-cipher",
    label: "Transport protocol and negotiated cipher",
    weight: 0.06,
    raw: transportNorm,
    normalised: transportNorm,
    contribution: round(transportNorm * 0.06, 4),
    evidence: protocolObsolete
      ? `The endpoint negotiated ${protocol || "an unknown protocol"}, which is obsolete.`
      : cipherWeak
        ? `The endpoint negotiated ${cipher}, which is an obsolete suite.`
        : `The endpoint negotiated ${protocol} with ${cipher}.`,
    citation: NIST_CITATION,
  });

  // 7. Post-quantum readiness of what is actually deployed.
  const pqLinks = chain.filter((link) => link.postQuantum).length;
  const pqNorm = chain.length === 0 ? 0 : clamp(pqLinks / chain.length);
  factors.push({
    id: "post-quantum-readiness",
    label: "Post-quantum algorithm already deployed",
    weight: 0.06,
    raw: pqLinks,
    normalised: round(pqNorm, 4),
    contribution: round(pqNorm * 0.06, 4),
    evidence:
      pqLinks > 0
        ? `${pqLinks} of ${chain.length} chain link${chain.length === 1 ? "" : "s"} already use a post-quantum signature.`
        : `No post-quantum signature was observed in the ${chain.length} presented link${chain.length === 1 ? "" : "s"}. Every key in this chain is Shor-vulnerable today.`,
    citation:
      "NIST FIPS 203/204/205; post-quantum signatures are identified by their OpenSSL algorithm names.",
  });

  /* -- Composite --------------------------------------------------- */

  /**
   * Contributions are recomputed from the *rounded* normalised values.
   *
   * The factor table promises the reader that a contribution is the printed
   * normalised score times the printed weight. Deriving it from the rounded
   * value is what makes that literally true at 4 decimal places, so the column a
   * reader multiplies out by hand is the column the product shows.
   */
  for (const factor of factors) {
    factor.contribution = round(factor.normalised * factor.weight, 4);
  }

  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const weighted = factors.reduce((sum, factor) => sum + factor.normalised * factor.weight, 0);
  const score = Math.round(clamp(weighted / totalWeight) * 100);
  const grade = gradeFor(score);

  const ranked = [...factors].sort((a, b) => a.normalised - b.normalised);
  const weakest = ranked[0];
  const weakestFactor: FactorId = weakest?.id ?? "harvest-window";

  const recommendation = buildRecommendation({
    grade,
    exposed,
    postQuantumLeaf: leafIsQuantumSafe,
    breakYear,
    horizonYear: policy.horizonYear,
    weakestFactor,
    leafLabel: leafCost.algorithmLabel,
    pqLinks,
    chainLength: chain.length,
  });

  return {
    engineVersion: ENGINE_VERSION,
    score,
    grade,
    gradeLabel: GRADE_LABELS[grade],
    recommendation,
    factors,
    keyCosts: [leafCost],
    chain,
    exposure,
    policy: {
      assumedCrqcYear: breakYear ?? currentYear + 100,
      physicalPerLogical: Math.round(
        (leafCost.physicalQubits ?? 0) / Math.max(1, leafCost.logicalQubits ?? 1),
      ),
      confidentialityYears: requiredHorizonYear - currentYear,
      deprecateYear: policy.deprecateYear,
      disallowYear: policy.disallowYear,
      minimumClassicalBits: policy.minimumClassicalBits,
      engineVersion: ENGINE_VERSION,
    },
    weakestFactor,
    computedAt,
  };
}

function buildRecommendation(args: {
  grade: Grade;
  exposed: boolean;
  postQuantumLeaf: boolean;
  breakYear: number | null;
  horizonYear: number;
  weakestFactor: FactorId;
  leafLabel: string;
  pqLinks: number;
  chainLength: number;
}): string {
  const { exposed, postQuantumLeaf, breakYear, horizonYear, weakestFactor, leafLabel, pqLinks, chainLength } =
    args;

  if (pqLinks > 0 && pqLinks === chainLength) {
    return "Every link in this chain already uses a post-quantum signature. Keep the deployment on the FIPS 203/204/205 track and audit the key-establishment side of the connection next: a post-quantum certificate in front of a classical key exchange still leaves the session key breakable.";
  }

  if (postQuantumLeaf) {
    return "The leaf certificate is already signed post-quantum, so harvested traffic is not exposed through it. Check that the negotiated key exchange is also post-quantum before treating this endpoint as migrated: the certificate is only half of the handshake.";
  }

  if (exposed && breakYear !== null) {
    const inside = horizonYear - breakYear;
    return `Treat this as a harvest-now-decrypt-later exposure. A CRQC is modelled to factor this ${leafLabel} in ${breakYear}, ${inside} year${inside === 1 ? "" : "s"} inside your ${horizonYear} confidentiality horizon. Migrate the key-establishment path to a hybrid ML-KEM deployment before ${breakYear}; rotating the certificate alone does not protect traffic already captured.`;
  }

  switch (weakestFactor) {
    case "lifetime-compliance":
      return "The key itself outlasts the planning horizon, but the certificate does not respect the NIST IR 8547 clock. Re-issue with a validity period that ends before the deprecation date and re-assay; the harvested-ciphertext risk is unchanged.";
    case "chain-exposure":
      return "The leaf key is adequate but the issuing chain is not. An attacker holding a quantum computer targets the CA keys too, so a leaf-only migration leaves the chain exposed. Plan the issuing CA alongside the leaf.";
    case "asymmetric-strength":
      return "The public key is below your classical security floor. Move to a larger key or a higher-strength curve first; there is no point hardening the transport around a key that is already too weak classically.";
    case "protocol-cipher":
      return "The transport is fine and the key is the long pole. Fix the obsolete protocol or cipher separately, and spend the migration effort on the key.";
    case "post-quantum-readiness":
      return "Nothing post-quantum is deployed yet, which is consistent with the current clock. Stand up a hybrid ML-KEM key exchange now so that the transition is an increment rather than a rebuild.";
    default:
      return `No exposure inside the ${horizonYear} horizon under the stated growth assumption. Keep the assay scheduled, and re-run it whenever the growth assumption or the horizon changes.`;
  }
}

/** Convenience wrapper: re-rate an already-stored observation. */
export function rerate(input: AssayInput): AssayResult {
  return runAssay(input);
}

export const ASSAY_ENGINE_CITATIONS = {
  shor: SHOR_CITATION,
  nist: NIST_CITATION,
  ir8547: IR8547_CITATION,
  capability: CAPABILITY_CITATION,
} as const;