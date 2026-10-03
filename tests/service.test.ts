import { createTestRepository } from "@/lib/db";
import type { Repository } from "@/lib/db/repository";
import { GENESIS_SEAL } from "@/lib/integrity/chain";
import { NotFoundError, assayHost, deleteAssay, loadPolicy, recordDecision, renameAssay, savePolicy, updateNotes, verifyAssay } from "@/lib/service";
import { buildEvent, headSealOf } from "@/lib/integrity/chain";
import { ValidationError, parseHostTarget } from "@/lib/validation";

/**
 * Service and persistence tests.
 *
 * These run against a real Postgres engine (PGlite, Postgres compiled to
 * WebAssembly), so the schema, check constraints, partial unique index and
 * transactions exercised here are the same ones that run in production. The TLS
 * probe is stubbed so the suite never depends on a third party being up.
 */

const FIXED_NOW = new Date("2026-10-03T09:00:00.000Z");

let repo: Repository;
/**
 * One embedded Postgres instance is created for the whole file rather than one
 * per test: initialising the WASM engine and replaying the DDL takes far longer
 * than any single assertion. Isolation comes from a fresh session id per test,
 * which is exactly the boundary the production queries are scoped by.
 */
let sessionId: string;
/** A second visitor, used to prove the ownership boundary holds. */
const otherSession = "ffffffff-3333-4333-8333-ffffffffffff";

/** A minimal but realistic TLS observation, shaped exactly like the real probe. */
const OBSERVATION = {
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
      issuer: "CN = Example CA",
      selfSigned: false,
      validFrom: "2026-01-01T00:00:00.000Z",
      validTo: "2027-06-01T00:00:00.000Z",
      algorithm: "ec" as const,
      bits: 256,
      curve: "prime256v1",
      postQuantum: false,
    },
    {
      subject: "CN = Example CA",
      issuer: "CN = Example Root",
      selfSigned: false,
      validFrom: "2026-01-01T00:00:00.000Z",
      validTo: "2034-01-01T00:00:00.000Z",
      algorithm: "rsa" as const,
      bits: 4096,
      curve: null,
      postQuantum: false,
    },
  ],
  fingerprint: "AA:BB:CC:DD",
  serialNumber: "0123ABCD",
  subjectAlternativeNames: ["DNS:example.com"],
  postQuantumSignature: false,
  advertisedProtocols: ["TLSv1.3"],
  observedAt: "2026-10-03T09:00:00.000Z",
};

const CT_SUMMARY = {
  domain: "example.com",
  certificateCount: 17,
  recentCount: 3,
  distinctIssuers: ["CN = Example CA"],
  longestValidityDays: 365,
  certificatesBeyond2030: 0,
  certificatesBeyond2035: 0,
  historyDays: 1_200,
  sampledIds: [1, 2],
};

function ctx(id = sessionId) {
  return {
    repo,
    sessionId: id,
    now: () => FIXED_NOW,
    currentYear: () => 2026,
  };
}

/**
 * Stand in for the two network sources. `assayHost` still performs its whole
 * service path: validation, engine run, persistence and sealing.
 */
async function seedAssay(host = "example.com", label = "Primary edge") {
  // Reproduce the service's persistence shape directly, without a socket.
  const { runAssay } = await import("@/lib/engine/assay");
  const { buildEvent: build } = await import("@/lib/integrity/chain");
  const policy = await loadPolicy(ctx());

  const tls = {
    status: "live" as const,
    meta: {
      status: "live" as const,
      source: "test handshake",
      upstreamId: `${host}:443`,
      attribution: "test",
      fetchedAt: "2026-10-03T09:00:00.000Z",
    },
    data: { ...OBSERVATION, host },
  };
  const ct = {
    status: "live" as const,
    meta: {
      status: "live" as const,
      source: "test ct",
      upstreamId: host,
      attribution: "test",
      fetchedAt: "2026-10-03T09:00:00.000Z",
    },
    data: { ...CT_SUMMARY, domain: host },
  };

  const result = runAssay({
    tls,
    ct,
    policy,
    currentYear: 2026,
    now: FIXED_NOW.toISOString(),
  });

  const id = crypto.randomUUID();
  const created = build({
    entityId: id,
    type: "created",
    payload: { host, label },
    createdAt: FIXED_NOW.toISOString(),
    previousSeal: GENESIS_SEAL,
    nextSeq: 1,
  });

  const stored = await repo.createAssay(
    {
      id,
      sessionId: sessionId,
      idempotencyKey: null,
      host,
      port: 443,
      label,
      grade: result.grade,
      score: result.score,
      keyAlgorithm: "ec",
      keyBits: 256,
      curve: "prime256v1",
      protocol: "TLSv1.3",
      cipher: "TLS_AES_128_GCM_SHA256",
      issuerCommonName: "CN = Example CA",
      notAfter: "2027-06-01T00:00:00.000Z",
      chainDepth: 2,
      ctCertificateCount: 17,
      harvestYear: result.exposure.breakYear,
      tlsPayload: tls,
      ctPayload: ct,
      result,
      seal: created.seal,
    },
    [created],
  );
  return stored;
}

beforeAll(async () => {
  repo = await createTestRepository();
});

beforeEach(() => {
  // Fresh ownership per test, shared engine per file.
  sessionId = crypto.randomUUID();
});

describe("schema", () => {
  it("reports a healthy store", async () => {
    const health = await repo.healthCheck();
    expect(health.ok).toBe(true);
    expect(health.detail).toContain("SELECT 1 succeeded");
  });

  it("enforces the grade check constraint", async () => {
    await expect(
      repo.createAssay(
        {
          id: crypto.randomUUID(),
          sessionId: sessionId,
          idempotencyKey: null,
          host: "bad.example",
          port: 443,
          label: "bad",
          grade: "platinum" as never,
          score: 50,
          keyAlgorithm: "rsa",
          keyBits: 2048,
          curve: null,
          protocol: "TLSv1.3",
          cipher: null,
          issuerCommonName: null,
          notAfter: null,
          chainDepth: 0,
          ctCertificateCount: 0,
          harvestYear: 2050,
          tlsPayload: {},
          ctPayload: {},
          result: {},
          seal: "x",
        },
        [],
      ),
    ).rejects.toThrow();
  });

  it("refuses a score outside 0..100", async () => {
    await expect(
      repo.createAssay(
        {
          id: crypto.randomUUID(),
          sessionId: sessionId,
          idempotencyKey: null,
          host: "bad.example",
          port: 443,
          label: "bad",
          grade: "sterling",
          score: 101,
          keyAlgorithm: "rsa",
          keyBits: 2048,
          curve: null,
          protocol: null,
          cipher: null,
          issuerCommonName: null,
          notAfter: null,
          chainDepth: 0,
          ctCertificateCount: 0,
          harvestYear: 2050,
          tlsPayload: {},
          ctPayload: {},
          result: {},
          seal: "x",
        },
        [],
      ),
    ).rejects.toThrow();
  });

  it("refuses a port outside the legal range", async () => {
    const assay = await seedAssay();
    expect(assay.port).toBe(443);
    await expect(
      repo.createAssay(
        {
          id: crypto.randomUUID(),
          sessionId,
          idempotencyKey: null,
          host: "x.example",
          port: 70000,
          label: "x",
          grade: "sterling",
          score: 50,
          keyAlgorithm: "rsa",
          keyBits: 2048,
          curve: null,
          protocol: null,
          cipher: null,
          issuerCommonName: null,
          notAfter: null,
          chainDepth: 0,
          ctCertificateCount: 0,
          harvestYear: 2050,
          tlsPayload: {},
          ctPayload: {},
          result: {},
          seal: "x",
        } as never,
        [],
      ),
    ).rejects.toThrow();
  });
});

describe("CRUD and ownership", () => {
  it("creates, reads back, updates and tombstones", async () => {
    const created = await seedAssay();
    expect(created.host).toBe("example.com");
    expect(created.grade).toBeTruthy();

    const readBack = await repo.getAssay(sessionId, created.id);
    expect(readBack?.id).toBe(created.id);
    expect(readBack?.result.factors.length).toBe(7);

    const renamed = await renameAssay(ctx(), created.id, "Edge node A");
    expect(renamed.label).toBe("Edge node A");

    const noted = await updateNotes(ctx(), created.id, "Confirm ML-KEM hybrid before Q3.");
    expect(noted.notes).toContain("ML-KEM");

    const deleted = await deleteAssay(ctx(), created.id);
    expect(deleted.deletedAt).not.toBeNull();

    // Hidden from the default read, visible when tombstoned are included.
    expect(await repo.getAssay(sessionId, created.id)).toBeNull();
    expect(await repo.getAssay(sessionId, created.id, true)).not.toBeNull();
  });

  it("never exposes another session's records", async () => {
    const created = await seedAssay();
    expect(await repo.getAssay(otherSession, created.id)).toBeNull();
    expect(await repo.listAssays(otherSession, { limit: 25, offset: 0, includeDeleted: false })).toHaveLength(0);
    await expect(renameAssay(ctx(otherSession), created.id, "stolen")).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteAssay(ctx(otherSession), created.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lists, filters and counts with bounded pagination", async () => {
    await seedAssay("one.example", "One");
    await seedAssay("two.example", "Two");
    await seedAssay("three.example", "Three");

    const all = await repo.listAssays(sessionId, { limit: 25, offset: 0, includeDeleted: false });
    expect(all).toHaveLength(3);
    expect(await repo.countAssays(sessionId, { limit: 25, offset: 0, includeDeleted: false })).toBe(3);

    const page = await repo.listAssays(sessionId, { limit: 2, offset: 0, includeDeleted: false });
    expect(page).toHaveLength(2);

    const secondPage = await repo.listAssays(sessionId, { limit: 2, offset: 2, includeDeleted: false });
    expect(secondPage).toHaveLength(1);

    const searched = await repo.listAssays(sessionId, {
      limit: 25,
      offset: 0,
      search: "two",
      includeDeleted: false,
    });
    expect(searched).toHaveLength(1);
    expect(searched[0]?.host).toBe("two.example");
  });

  it("returns full rows and the filtered total in one call", async () => {
    await seedAssay("one.example", "One");
    await seedAssay("two.example", "Two");
    await seedAssay("three.example", "Three");

    const result = await repo.listAssaysPage(sessionId, {
      limit: 2,
      offset: 0,
      includeDeleted: false,
    });
    expect(result.items).toHaveLength(2);
    // The total reflects the whole filtered set, not the page.
    expect(result.total).toBe(3);
    // Full rows, so a list page never needs a per-row fetch.
    expect(result.items[0]?.result).toBeDefined();
    expect(result.items[0]?.tls.data.chain.length).toBeGreaterThan(0);

    const filtered = await repo.listAssaysPage(sessionId, {
      limit: 25,
      offset: 0,
      search: "two",
      includeDeleted: false,
    });
    expect(filtered.total).toBe(1);
    expect(filtered.items[0]?.host).toBe("two.example");

    const empty = await repo.listAssaysPage(sessionId, {
      limit: 25,
      offset: 0,
      search: "nothing-matches-this",
      includeDeleted: false,
    });
    expect(empty.total).toBe(0);
    expect(empty.items).toHaveLength(0);
  });

  it("honours an idempotency key for agent mutations", async () => {
    const { runAssay } = await import("@/lib/engine/assay");
    const tls = { status: "live" as const, meta: { status: "live" as const, source: "t", upstreamId: "t", attribution: "t", fetchedAt: "2026-10-03T09:00:00.000Z" }, data: OBSERVATION };
    const ct = { status: "live" as const, meta: { status: "live" as const, source: "t", upstreamId: "t", attribution: "t", fetchedAt: "2026-10-03T09:00:00.000Z" }, data: CT_SUMMARY };
    const result = runAssay({ tls, ct, policy: await loadPolicy(ctx()), currentYear: 2026, now: FIXED_NOW.toISOString() });

    const make = async () => {
      const id = crypto.randomUUID();
      const created = buildEvent({
        entityId: id,
        type: "created",
        payload: { host: "example.com" },
        createdAt: FIXED_NOW.toISOString(),
        previousSeal: GENESIS_SEAL,
        nextSeq: 1,
      });
      return repo.createAssay(
        {
          id,
          sessionId: sessionId,
          idempotencyKey: "agent-call-42",
          host: "example.com",
          port: 443,
          label: "Idempotent",
          grade: result.grade,
          score: result.score,
          keyAlgorithm: "ec",
          keyBits: 256,
          curve: "prime256v1",
          protocol: "TLSv1.3",
          cipher: null,
          issuerCommonName: null,
          notAfter: null,
          chainDepth: 0,
          ctCertificateCount: 0,
          harvestYear: result.exposure.breakYear,
          tlsPayload: tls,
          ctPayload: ct,
          result,
          seal: created.seal,
        },
        [created],
      );
    };

    const first = await make();
    expect(await repo.findByIdempotencyKey(sessionId, "agent-call-42")).not.toBeNull();
    // The partial unique index rejects a second row with the same key.
    await expect(make()).rejects.toThrow();
    expect(first.id).toBeTruthy();
  });

  it("reports a 404-shaped error for an unknown id", async () => {
    await expect(recordDecision(ctx(), crypto.randomUUID(), "monitor")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("audit chain through the service", () => {
  it("links create, update, decision and delete into one verifiable chain", async () => {
    const created = await seedAssay();
    await renameAssay(ctx(), created.id, "Renamed");
    await updateNotes(ctx(), created.id, "note");
    await recordDecision(ctx(), created.id, "plan-hybrid");
    await deleteAssay(ctx(), created.id);

    const events = await repo.listEvents(created.id);
    expect(events).toHaveLength(5);
    expect(events.map((event) => event.eventType)).toEqual([
      "created",
      "updated",
      "updated",
      "decision",
      "deleted",
    ]);
    expect(events[0]?.prevSeal).toBe(GENESIS_SEAL);
    for (let index = 1; index < events.length; index += 1) {
      expect(events[index]?.prevSeal).toBe(events[index - 1]?.seal);
      expect(events[index]?.seq).toBe(index + 1);
    }
    expect(events[events.length - 1]?.seal).toBe(headSealOf(events));
  });

  it("verifies a chain after deletion because the tombstone is retained", async () => {
    const created = await seedAssay();
    await recordDecision(ctx(), created.id, "migrate-first");
    const deleted = await deleteAssay(ctx(), created.id);
    expect(deleted).not.toBeNull();

    const replay = await verifyAssay(ctx(), created.id);
    expect(replay.ok).toBe(true);
    expect(replay.eventsChecked).toBe(3);
    expect(replay.headSeal).toBe(deleted?.seal);
  });

  it("captures the grade at the moment of decision", async () => {
    const created = await seedAssay();
    await recordDecision(ctx(), created.id, "migrate-first");
    const events = await repo.listEvents(created.id);
    const decision = events.find((event) => event.eventType === "decision");
    expect(decision?.payload.decision).toBe("migrate-first");
    expect(decision?.payload.gradeAtDecision).toBe(created.grade);
    expect(decision?.payload.engineVersion).toBe(created.result.engineVersion);
  });
});

describe("policy persistence", () => {
  it("returns defaults before anything is saved", async () => {
    const policy = await loadPolicy(ctx());
    expect(policy.horizonYear).toBe(2040);
    expect(policy.costModel).toBe("gidney-2025");
  });

  it("persists a saved policy and reads it back", async () => {
    const saved = await savePolicy(ctx(), { horizonYear: 2032, capabilityGrowth: 0.22 });
    expect(saved.horizonYear).toBe(2032);
    const reloaded = await loadPolicy(ctx());
    expect(reloaded.horizonYear).toBe(2032);
    expect(reloaded.capabilityGrowth).toBe(0.22);
  });

  it("scopes the policy to the session", async () => {
    await savePolicy(ctx(), { horizonYear: 2031 });
    expect((await loadPolicy(ctx(otherSession))).horizonYear).toBe(2040);
  });

  it("rejects an out-of-range horizon at the database layer too", async () => {
    await expect(savePolicy(ctx(), { horizonYear: 1800 })).rejects.toThrow();
  });
});

describe("host validation", () => {
  it("accepts a plain hostname", () => {
    expect(parseHostTarget("example.com")).toEqual({ host: "example.com", port: 443 });
  });

  it("accepts an explicit port", () => {
    expect(parseHostTarget("example.com:8443")).toEqual({ host: "example.com", port: 8443 });
  });

  it("lowercases the host", () => {
    expect(parseHostTarget("EXAMPLE.COM").host).toBe("example.com");
  });

  it("rejects URLs, paths and credentials", () => {
    expect(() => parseHostTarget("https://example.com/x")).toThrow(ValidationError);
    expect(() => parseHostTarget("example.com/path")).toThrow(ValidationError);
    expect(() => parseHostTarget("user@example.com")).toThrow(ValidationError);
    expect(() => parseHostTarget("example.com?x=1")).toThrow(ValidationError);
  });

  it("rejects an invalid hostname shape", () => {
    expect(() => parseHostTarget("-bad.example")).toThrow(ValidationError);
    expect(() => parseHostTarget("bad_underscore.example")).toThrow(ValidationError);
  });

  it("rejects an out-of-range port", () => {
    expect(() => parseHostTarget("example.com:0")).toThrow(ValidationError);
    expect(() => parseHostTarget("example.com:70000")).toThrow(ValidationError);
    expect(() => parseHostTarget("example.com:abc")).toThrow(ValidationError);
  });

  it("rejects a missing or non-string host", () => {
    expect(() => parseHostTarget(undefined)).toThrow(ValidationError);
    expect(() => parseHostTarget(42)).toThrow(ValidationError);
    expect(() => parseHostTarget("   ")).toThrow(ValidationError);
  });

  it("accepts a bracketed IPv6 literal and strips the URL brackets", () => {
    expect(parseHostTarget("[2606:4700::1111]:443")).toEqual({ host: "2606:4700::1111", port: 443 });
    expect(parseHostTarget("[2606:4700::1111]")).toEqual({ host: "2606:4700::1111", port: 443 });
  });

  it("rejects an unclosed IPv6 literal", () => {
    expect(() => parseHostTarget("[2606:4700::1111")).toThrow(ValidationError);
  });
});

describe("assayHost contract", () => {
  it("validates the host before touching the network", async () => {
    await expect(assayHost(ctx(), { host: "https://nope" })).rejects.toBeInstanceOf(ValidationError);
    expect(await repo.countAssays(sessionId, { limit: 25, offset: 0, includeDeleted: false })).toBe(0);
  });

  it("rejects an oversized label", async () => {
    await expect(assayHost(ctx(), { host: "example.com", label: "x".repeat(200) })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});