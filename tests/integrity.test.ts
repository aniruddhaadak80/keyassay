import { createHash } from "node:crypto";
import {
  GENESIS_SEAL,
  buildEvent,
  canonicalJson,
  headSealOf,
  replayChain,
  sealEvent,
  sha384,
} from "@/lib/integrity/chain";
import type { AuditEvent } from "@/lib/types";

/**
 * Integrity tests with known vectors.
 *
 * The canonical-JSON and seal tests use literal expected digests, so a change
 * to the serialisation rules cannot silently pass: the expected hex string would
 * have to change too.
 */

function payload(n: number): Record<string, unknown> {
  return { host: "example.com", score: n, nested: { b: 2, a: 1 }, list: [3, 1, 2] };
}

describe("canonicalJson", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("preserves array order, because array order is data", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("is insensitive to key insertion order", () => {
    const a = canonicalJson({ x: 1, y: 2, z: { p: 1, q: 2 } });
    const b = canonicalJson({ z: { q: 2, p: 1 }, y: 2, x: 1 });
    expect(a).toBe(b);
  });

  it("drops undefined properties rather than emitting them", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("serialises primitives exactly", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson("x")).toBe('"x"');
    expect(canonicalJson(1.5)).toBe("1.5");
  });

  it("refuses non-finite numbers instead of emitting null", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow();
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow();
  });

  it("refuses unsupported types", () => {
    expect(() => canonicalJson(() => 1)).toThrow();
  });
});

describe("sha384", () => {
  it("matches the known SHA-384 digest of the empty string", () => {
    expect(sha384("")).toBe(
      "38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b",
    );
  });

  it("matches the known SHA-384 digest of 'abc'", () => {
    expect(sha384("abc")).toBe(
      "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7",
    );
  });
});

describe("seal vectors", () => {
  const event = {
    seq: 1,
    eventType: "created" as const,
    payload: payload(42),
    createdAt: "2026-10-03T00:00:00.000Z",
  };

  it("produces a stable seal for a known event", () => {
    const seal = sealEvent(GENESIS_SEAL, event, "00000000-0000-4000-8000-000000000001");
    // Locked vector. The canonical body it hashes is:
    //   {"createdAt":"2026-10-03T00:00:00.000Z","entityId":"00000000-0000-4000-8000-000000000001",
    //    "entityKind":"assay","eventType":"created",
    //    "payload":{"host":"example.com","list":[3,1,2],"nested":{"a":1,"b":2},"score":42},"seq":1}
    // Changing the key ordering rules, the entity kind, or the hash breaks this.
    expect(seal).toBe(
      "6c7f9cc1408ca45d5496e5fe03fd830ea1a8d2be802fe060f17634ecb990c3542f52d3d87970813f11d7cfd4c6733e27",
    );
  });

  it("produces the same seal regardless of payload key order", () => {
    const a = sealEvent(GENESIS_SEAL, { ...event, payload: { host: "example.com", score: 42, nested: { a: 1, b: 2 }, list: [3, 1, 2] } }, "id");
    const b = sealEvent(GENESIS_SEAL, event, "id");
    expect(a).toBe(b);
  });

  it("differs when any hashed field changes", () => {
    const base = sealEvent(GENESIS_SEAL, event, "id");
    expect(sealEvent(GENESIS_SEAL, { ...event, seq: 2 }, "id")).not.toBe(base);
    expect(sealEvent(GENESIS_SEAL, { ...event, createdAt: "2026-10-03T00:00:01.000Z" }, "id")).not.toBe(base);
    expect(sealEvent(GENESIS_SEAL, { ...event, payload: payload(43) }, "id")).not.toBe(base);
    expect(sealEvent(GENESIS_SEAL, { ...event, eventType: "updated" }, "id")).not.toBe(base);
    expect(sealEvent("different-prev", event, "id")).not.toBe(base);
    expect(sealEvent(GENESIS_SEAL, event, "other-id")).not.toBe(base);
  });
});

describe("buildEvent and replay", () => {
  function chain(count: number): { entityId: string; events: AuditEvent[] } {
    const entityId = "11111111-1111-4111-8111-111111111111";
    const events: AuditEvent[] = [];
    let previous = GENESIS_SEAL;
    for (let index = 1; index <= count; index += 1) {
      const event = buildEvent({
        entityId,
        type: index === 1 ? "created" : "updated",
        payload: payload(index),
        createdAt: `2026-10-0${Math.min(9, index)}T00:00:00.000Z`,
        previousSeal: previous,
        nextSeq: index,
      });
      events.push(event);
      previous = event.seal;
    }
    return { entityId, events };
  }

  it("starts from the genesis seal and links every event", () => {
    const { events } = chain(4);
    expect(events[0]?.prevSeal).toBe(GENESIS_SEAL);
    for (let index = 1; index < events.length; index += 1) {
      expect(events[index]?.prevSeal).toBe(events[index - 1]?.seal);
    }
  });

  it("verifies an untouched chain", () => {
    const { entityId, events } = chain(5);
    const result = replayChain(entityId, events, "2026-10-03T00:00:00.000Z");
    expect(result.ok).toBe(true);
    expect(result.eventsChecked).toBe(5);
    expect(result.firstBrokenSeq).toBeNull();
    expect(result.headSeal).toBe(events[4]?.seal);
  });

  it("verifies an empty chain back to genesis", () => {
    const result = replayChain("id", [], "2026-10-03T00:00:00.000Z");
    expect(result.ok).toBe(true);
    expect(result.headSeal).toBe(GENESIS_SEAL);
    expect(result.eventsChecked).toBe(0);
  });

  it("detects an edited payload and names the first broken link", () => {
    const { entityId, events } = chain(4);
    const tampered = events.map((event, index) =>
      index === 1 ? { ...event, payload: { ...event.payload, score: 9999 } } : event,
    );
    const result = replayChain(entityId, tampered, "2026-10-03T00:00:00.000Z");
    expect(result.ok).toBe(false);
    expect(result.firstBrokenSeq).toBe(2);
    expect(result.reason).toContain("event 2");
  });

  it("detects a removed event because the chain no longer links", () => {
    const { entityId, events } = chain(4);
    const withGap = [events[0] as AuditEvent, events[2] as AuditEvent, events[3] as AuditEvent];
    const result = replayChain(entityId, withGap, "2026-10-03T00:00:00.000Z");
    expect(result.ok).toBe(false);
    expect(result.firstBrokenSeq).toBe(3);
  });

  it("detects a rewritten seal", () => {
    const { entityId, events } = chain(3);
    const tampered = events.map((event, index) =>
      index === 2 ? { ...event, seal: "f".repeat(96) } : event,
    );
    const result = replayChain(entityId, tampered, "2026-10-03T00:00:00.000Z");
    expect(result.ok).toBe(false);
    expect(result.firstBrokenSeq).toBe(3);
  });

  it("is itself a plain SHA-384 of prevSeal concatenated with canonical JSON", () => {
    const { events } = chain(2);
    const second = events[1] as AuditEvent;
    const body = canonicalJson({
      entityId: second.entityId,
      entityKind: "assay",
      seq: second.seq,
      eventType: second.eventType,
      payload: second.payload,
      createdAt: second.createdAt,
    });
    const expected = createHash("sha384")
      .update(`${second.prevSeal}${body}`, "utf8")
      .digest("hex");
    expect(second.seal).toBe(expected);
  });

  it("reports the head seal for an entity", () => {
    const { events } = chain(3);
    expect(headSealOf(events)).toBe(events[2]?.seal);
    expect(headSealOf([])).toBe(GENESIS_SEAL);
  });
});