import {
  ASSAY_ENGINE_CITATIONS,
  DEFAULT_POLICY,
  ENGINE_VERSION,
  breakYearFor,
  costFor,
  gradeFor,
  logicalQubitsForModulus,
  physicalQubitsFor,
  resolveKey,
  runAssay,
  toffolisForModulus,
  type AssayPolicy,
} from "@/lib/engine/assay";
import type { CtSummary, LivePayload, TlsObservation } from "@/lib/types";

/**
 * Engine tests.
 *
 * These are pure-function tests with no network and no clock dependence: the
 * observation and policy are fixed, so every assertion is a known vector.
 */

const REFERENCE_YEAR = 2026;

function observation(overrides: Partial<TlsObservation> = {}): TlsObservation {
  return {
    host: "example.com",
    port: 443,
    protocol: "TLSv1.3",
    cipher: "TLS_AES_128_GCM_SHA256",
    authorized: true,
    authorizationError: null,
    chainDepth: 2,
    chain: [
      {
        subject: "CN = example.com",
        issuer: "CN = Example Intermediate",
        selfSigned: false,
        validFrom: "2026-01-01T00:00:00.000Z",
        validTo: "2027-06-01T00:00:00.000Z",
        algorithm: "rsa",
        bits: 2048,
        curve: null,
        postQuantum: false,
      },
      {
        subject: "CN = Example Intermediate",
        issuer: "CN = Example Root",
        selfSigned: false,
        validFrom: "2026-01-01T00:00:00.000Z",
        validTo: "2034-01-01T00:00:00.000Z",
        algorithm: "rsa",
        bits: 4096,
        curve: null,
        postQuantum: false,
      },
      {
        subject: "CN = Example Root",
        issuer: "CN = Example Root",
        selfSigned: true,
        validFrom: "2026-01-01T00:00:00.000Z",
        validTo: "2040-01-01T00:00:00.000Z",
        algorithm: "rsa",
        bits: 4096,
        curve: null,
        postQuantum: false,
      },
    ],
    fingerprint: "AA:BB:CC",
    serialNumber: "DEADBEEF",
    subjectAlternativeNames: ["DNS:example.com"],
    postQuantumSignature: false,
    advertisedProtocols: ["TLSv1.3"],
    observedAt: "2026-10-03T00:00:00.000Z",
    ...overrides,
  };
}

function ctSummary(overrides: Partial<CtSummary> = {}): CtSummary {
  return {
    domain: "example.com",
    certificateCount: 42,
    recentCount: 8,
    distinctIssuers: ["CN = Example CA"],
    longestValidityDays: 398,
    certificatesBeyond2030: 3,
    certificatesBeyond2035: 0,
    historyDays: 2_400,
    sampledIds: [1, 2, 3],
    ...overrides,
  };
}

function live<T>(data: T): LivePayload<T> {
  return {
    status: "live",
    meta: {
      status: "live",
      source: "test",
      upstreamId: "test",
      attribution: "test fixture",
      fetchedAt: "2026-10-03T00:00:00.000Z",
    },
    data,
  };
}

const policy: AssayPolicy = { ...DEFAULT_POLICY };

function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

describe("Shor cost model", () => {
  it("reproduces the published logical-qubit formula for RSA-2048", () => {
    // 3n + 0.002 n lg(n) with n = 2048, lg(n) = 11
    expect(logicalQubitsForModulus(2048)).toBe(Math.round(3 * 2048 + 0.002 * 2048 * 11));
    expect(logicalQubitsForModulus(2048)).toBe(6189);
  });

  it("reproduces the published Toffoli formula for RSA-2048", () => {
    // 0.3 n^3 + 0.0005 n^3 lg(n) with n = 2048
    expect(toffolisForModulus(2048)).toBe(
      Math.round(0.3 * 2048 ** 3 + 0.0005 * 2048 ** 3 * 11),
    );
    expect(toffolisForModulus(2048)).toBeGreaterThan(2.5e9);
  });

  it("returns zero rather than NaN for a degenerate modulus", () => {
    expect(logicalQubitsForModulus(0)).toBe(0);
    expect(toffolisForModulus(-1)).toBe(0);
    expect(logicalQubitsForModulus(Number.NaN)).toBe(0);
  });

  it("anchors physical qubits exactly to the published RSA-2048 figures", () => {
    expect(physicalQubitsFor(2048, { ...policy, costModel: "gidney-ekera-2019" })).toBe(20_000_000);
    expect(physicalQubitsFor(2048, { ...policy, costModel: "gidney-2025" })).toBe(1_000_000);
  });

  it("scales physical qubits monotonically with modulus size", () => {
    const sizes = [1024, 2048, 3072, 7680, 15360];
    const costs = sizes.map((size) => physicalQubitsFor(size, policy));
    for (let index = 1; index < costs.length; index += 1) {
      expect(costs[index] as number).toBeGreaterThan(costs[index - 1] as number);
    }
  });
});

describe("capability timeline", () => {
  it("puts the CRQC year beyond the disallow date under default assumptions", () => {
    const year = breakYearFor(2048, policy);
    expect(year).toBeGreaterThan(2035);
    expect(year).toBeLessThanOrEqual(2200);
  });

  it("moves the break year later as qubit growth slows", () => {
    const fast = breakYearFor(2048, { ...policy, capabilityGrowth: 0.8 });
    const slow = breakYearFor(2048, { ...policy, capabilityGrowth: 0.1 });
    expect(fast).toBeLessThan(slow);
  });

  it("returns the base year when the key is already within capability", () => {
    const year = breakYearFor(2048, { ...policy, capabilityBaseQubits: 1_000_000_000 });
    expect(year).toBe(policy.capabilityBaseYear);
  });

  it("saturates instead of returning Infinity when growth is zero", () => {
    expect(breakYearFor(2048, { ...policy, capabilityGrowth: 0 })).toBe(2200);
  });
});

describe("key resolution", () => {
  it("maps RSA-2048 to 112-bit classical strength", () => {
    const resolved = resolveKey({ algorithm: "rsa", bits: 2048, curve: null });
    expect(resolved.classicalSecurityBits).toBe(112);
    expect(resolved.effectiveRsaBits).toBe(2048);
    expect(resolved.recognised).toBe(true);
  });

  it("maps P-256 onto its RSA-3072 equivalent", () => {
    const resolved = resolveKey({ algorithm: "ec", bits: 256, curve: "prime256v1" });
    expect(resolved.classicalSecurityBits).toBe(128);
    expect(resolved.effectiveRsaBits).toBe(3072);
  });

  it("maps P-384 onto its RSA-7680 equivalent", () => {
    const resolved = resolveKey({ algorithm: "ec", bits: 384, curve: "secp384r1" });
    expect(resolved.classicalSecurityBits).toBe(192);
    expect(resolved.effectiveRsaBits).toBe(7680);
  });

  it("flags an unrecognised key rather than guessing", () => {
    const resolved = resolveKey({ algorithm: "unknown", bits: null, curve: null });
    expect(resolved.recognised).toBe(false);
    expect(resolved.classicalSecurityBits).toBe(0);
    expect(resolved.equivalenceNote).toContain("could not be matched");
  });

  it("treats an already-quantum-safe key as having no break year", () => {
    const cost = costFor(
      { algorithm: "ec", bits: 256, curve: "prime256v1", postQuantum: true },
      policy,
    );
    expect(cost.harvestYear).toBeNull();
    expect(cost.postQuantum).toBe(true);
    expect(cost.citation).toContain("FIPS");
  });
});

describe("grades", () => {
  it("maps scores onto the four assay marks", () => {
    expect(gradeFor(95)).toBe("bullion");
    expect(gradeFor(80)).toBe("bullion");
    expect(gradeFor(79)).toBe("sterling");
    expect(gradeFor(62)).toBe("sterling");
    expect(gradeFor(61)).toBe("base");
    expect(gradeFor(42)).toBe("base");
    expect(gradeFor(41)).toBe("corroded");
    expect(gradeFor(0)).toBe("corroded");
  });
});

describe("runAssay", () => {
  it("returns a versioned, fully itemised result", () => {
    const result = runAssay({
      tls: live(observation()),
      ct: live(ctSummary()),
      policy,
      currentYear: REFERENCE_YEAR,
      now: "2026-10-03T00:00:00.000Z",
    });

    expect(result.engineVersion).toBe(ENGINE_VERSION);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.factors).toHaveLength(7);

    const weightTotal = result.factors.reduce((sum, factor) => sum + factor.weight, 0);
    expect(weightTotal).toBeCloseTo(1, 6);

    for (const factor of result.factors) {
      expect(factor.evidence.length).toBeGreaterThan(10);
      expect(factor.normalised).toBeGreaterThanOrEqual(0);
      expect(factor.normalised).toBeLessThanOrEqual(1);
      // The published contract: a reader who multiplies the printed normalised
      // score by the printed weight gets the printed contribution, at the 4dp
      // precision the ledger table renders.
      expect(factor.contribution).toBe(round4(factor.normalised * factor.weight));
    }
  });

  it("contributes exactly the weighted sum to the score", () => {
    const result = runAssay({
      tls: live(observation()),
      ct: live(ctSummary()),
      policy,
      currentYear: REFERENCE_YEAR,
      now: "2026-10-03T00:00:00.000Z",
    });
    const weighted = result.factors.reduce((sum, factor) => sum + factor.contribution, 0);
    expect(result.score).toBe(Math.round(weighted * 100));
  });

  it("is deterministic for identical inputs", () => {
    const input = {
      tls: live(observation()),
      ct: live(ctSummary()),
      policy,
      currentYear: REFERENCE_YEAR,
      now: "2026-10-03T00:00:00.000Z",
    };
    expect(JSON.stringify(runAssay(input))).toBe(JSON.stringify(runAssay(input)));
  });

  it("cites a published source on every factor that depends on one", () => {
    const result = runAssay({
      tls: live(observation()),
      ct: live(ctSummary()),
      policy,
      currentYear: REFERENCE_YEAR,
      now: "2026-10-03T00:00:00.000Z",
    });
    for (const factor of result.factors) {
      expect(factor.citation).not.toBeNull();
      expect((factor.citation ?? "").length).toBeGreaterThan(5);
    }
  });

  it("detects exposure when the break year falls inside the horizon", () => {
    const result = runAssay({
      tls: live(observation()),
      ct: live(ctSummary()),
      policy: { ...policy, horizonYear: 2200 },
      currentYear: REFERENCE_YEAR,
      now: "2026-10-03T00:00:00.000Z",
    });
    expect(result.exposure.exposed).toBe(true);
    expect(result.exposure.readableYear).toBeLessThanOrEqual(2200);
    expect(result.recommendation).toContain("harvest-now-decrypt-later");
    expect(result.weakestFactor).toBe("harvest-window");
  });

  it("reports no exposure when the break year is beyond the horizon", () => {
    const result = runAssay({
      tls: live(observation()),
      ct: live(ctSummary()),
      policy: { ...policy, horizonYear: 2030 },
      currentYear: REFERENCE_YEAR,
      now: "2026-10-03T00:00:00.000Z",
    });
    expect(result.exposure.exposed).toBe(false);
    expect(result.exposure.statement).toContain("beyond");
  });

  it("scores a fully post-quantum chain above a classical chain", () => {
    const classical = runAssay({
      tls: live(observation()),
      ct: live(ctSummary()),
      policy,
      currentYear: REFERENCE_YEAR,
      now: "2026-10-03T00:00:00.000Z",
    });

    const quantumSafe = runAssay({
      tls: live(
        observation({
          chain: [
            {
              subject: "CN = example.com",
              issuer: "CN = Example Intermediate",
              selfSigned: false,
              validFrom: "2026-01-01T00:00:00.000Z",
              validTo: "2027-06-01T00:00:00.000Z",
              algorithm: "ec",
              bits: 256,
              curve: "prime256v1",
              postQuantum: true,
            },
          ],
          postQuantumSignature: true,
        }),
      ),
      ct: live(ctSummary()),
      policy,
      currentYear: REFERENCE_YEAR,
      now: "2026-10-03T00:00:00.000Z",
    });

    expect(quantumSafe.score).toBeGreaterThan(classical.score);
  });

  it("penalises an obsolete protocol", () => {
    const modern = runAssay({
      tls: live(observation()),
      ct: live(ctSummary()),
      policy,
      currentYear: REFERENCE_YEAR,
      now: "2026-10-03T00:00:00.000Z",
    });
    const obsolete = runAssay({
      tls: live(observation({ protocol: "TLSv1", cipher: "TLS_RSA_WITH_AES_128_CBC_SHA" })),
      ct: live(ctSummary()),
      policy,
      currentYear: REFERENCE_YEAR,
      now: "2026-10-03T00:00:00.000Z",
    });
    expect(obsolete.score).toBeLessThan(modern.score);
  });

  it("flags a certificate that outlives the disallow date", () => {
    const result = runAssay({
      tls: live(
        observation({
          chain: [
            {
              subject: "CN = example.com",
              issuer: "CN = Example Root",
              selfSigned: false,
              validFrom: "2026-01-01T00:00:00.000Z",
              validTo: "2041-01-01T00:00:00.000Z",
              algorithm: "rsa",
              bits: 2048,
              curve: null,
              postQuantum: false,
            },
          ],
        }),
      ),
      ct: live(ctSummary()),
      policy,
      currentYear: REFERENCE_YEAR,
      now: "2026-10-03T00:00:00.000Z",
    });
    const factor = result.factors.find((entry) => entry.id === "lifetime-compliance");
    expect(factor?.normalised).toBe(0);
    expect(factor?.evidence).toContain("2035");
  });

  it("handles an empty chain without throwing", () => {
    const result = runAssay({
      tls: live(observation({ chain: [] })),
      ct: live(ctSummary()),
      policy,
      currentYear: REFERENCE_YEAR,
      now: "2026-10-03T00:00:00.000Z",
    });
    expect(result.factors).toHaveLength(7);
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.chain).toHaveLength(0);
  });

  it("handles a fallback observation without pretending it is live", () => {
    const result = runAssay({
      tls: {
        status: "fallback",
        meta: {
          status: "fallback",
          source: "Sealed offline sample",
          upstreamId: "sealed-sample/v1",
          attribution: "sealed",
          fetchedAt: "2026-10-03T00:00:00.000Z",
          fallbackReason: "handshake failed",
        },
        data: observation(),
      },
      ct: live(ctSummary()),
      policy,
      currentYear: REFERENCE_YEAR,
      now: "2026-10-03T00:00:00.000Z",
    });
    expect(Number.isFinite(result.score)).toBe(true);
  });

  it("survives a malformed policy without producing NaN", () => {
    const result = runAssay({
      tls: live(observation()),
      ct: live(ctSummary()),
      policy: { ...policy, capabilityGrowth: Number.NaN },
      currentYear: REFERENCE_YEAR,
      now: "2026-10-03T00:00:00.000Z",
    });
    expect(Number.isFinite(result.score)).toBe(true);
    expect(Number.isFinite(result.exposure.breakYear)).toBe(true);
  });

  it("exposes the citations it used", () => {
    expect(ASSAY_ENGINE_CITATIONS.shor).toContain("1905.09749");
    expect(ASSAY_ENGINE_CITATIONS.ir8547).toContain("2030");
    expect(ASSAY_ENGINE_CITATIONS.capability).toContain("assumption");
  });
});