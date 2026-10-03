import { createHash } from "node:crypto";
import type { AuditEvent, AuditEventType, ReplayResult } from "../types";

/**
 * Per-entity tamper-evident audit chain.
 *
 *   genesis     = "keyassay/genesis/1"
 *   seal(n)     = SHA-384( UTF-8(seal(n-1)) || canonicalJson(event(n)) )
 *
 * Canonical JSON recursively sorts object keys and preserves array order, so
 * two structurally identical events always hash to the same value regardless of
 * key insertion order. That is what makes replay a real check rather than a
 * tautology.
 */

export const GENESIS_SEAL = "keyassay/genesis/1";
const ENTITY_KIND = "assay";

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

/**
 * Deterministic JSON serialisation: object keys sorted recursively, arrays left
 * in their given order, undefined dropped, numbers rejected if non-finite.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`canonicalJson: non-finite number (${String(value)}) cannot be serialised`);
    }
    return JSON.stringify(value);
  }
  if (typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    const parts = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${parts.join(",")}}`;
  }
  throw new Error(`canonicalJson: unsupported type ${typeof value}`);
}

export function sha384(input: string): string {
  return createHash("sha384").update(input, "utf8").digest("hex");
}

/**
 * The exact shape that gets hashed. `seq`, `eventType`, `payload` and
 * `createdAt` are all inside the digest, so re-ordering, editing or removing an
 * event invalidates every later seal.
 */
export function sealEvent(
  prevSeal: string,
  event: { seq: number; eventType: AuditEventType; payload: Record<string, unknown>; createdAt: string },
  entityId: string,
): string {
  const body = canonicalJson({
    entityId,
    entityKind: ENTITY_KIND,
    seq: event.seq,
    eventType: event.eventType,
    payload: event.payload,
    createdAt: event.createdAt,
  });
  return sha384(`${prevSeal}${body}`);
}

export interface BuildEventsInput {
  entityId: string;
  type: AuditEventType;
  payload: Record<string, unknown>;
  createdAt: string;
  /** The seal already stored on the entity, or the genesis value. */
  previousSeal: string;
  /** The next sequence number. */
  nextSeq: number;
}

/**
 * Build the single event that a create, update, decision or delete appends.
 *
 * Every mutation in the product funnels through here, so the chain cannot be
 * bypassed by a route that forgets to seal.
 */
export function buildEvent(input: BuildEventsInput): AuditEvent {
  const seal = sealEvent(
    input.previousSeal,
    {
      seq: input.nextSeq,
      eventType: input.type,
      payload: input.payload,
      createdAt: input.createdAt,
    },
    input.entityId,
  );
  return {
    entityId: input.entityId,
    seq: input.nextSeq,
    eventType: input.type,
    payload: input.payload,
    prevSeal: input.previousSeal,
    seal,
    createdAt: input.createdAt,
  };
}

/**
 * Recompute the whole chain and report the first link that does not verify.
 *
 * Returns ok=true only when every event's stored seal equals the recomputed
 * seal AND every prevSeal equals the seal of the event before it.
 */
export function replayChain(
  entityId: string,
  events: Pick<AuditEvent, "seq" | "eventType" | "payload" | "prevSeal" | "seal" | "createdAt">[],
  verifiedAt: string,
): ReplayResult {
  let prev = GENESIS_SEAL;

  for (const event of events) {
    if (event.prevSeal !== prev) {
      return {
        ok: false,
        entityId,
        eventsChecked: event.seq,
        headSeal: prev,
        firstBrokenSeq: event.seq,
        reason: `event ${event.seq} claims previous seal ${event.prevSeal.slice(0, 16)}… but the chain head was ${prev.slice(0, 16)}…`,
        verifiedAt,
      };
    }

    const expected = sealEvent(
      prev,
      {
        seq: event.seq,
        eventType: event.eventType,
        payload: event.payload,
        createdAt: event.createdAt,
      },
      entityId,
    );

    if (expected !== event.seal) {
      return {
        ok: false,
        entityId,
        eventsChecked: event.seq,
        headSeal: prev,
        firstBrokenSeq: event.seq,
        reason: `event ${event.seq} stores seal ${event.seal.slice(0, 16)}… but its contents hash to ${expected.slice(0, 16)}…`,
        verifiedAt,
      };
    }

    prev = event.seal;
  }

  return {
    ok: true,
    entityId,
    eventsChecked: events.length,
    headSeal: prev,
    firstBrokenSeq: null,
    reason: null,
    verifiedAt,
  };
}

/** Head seal for an entity, used when a mutation needs to append. */
export function headSealOf(events: Pick<AuditEvent, "seal">[]): string {
  const last = events[events.length - 1];
  return last?.seal ?? GENESIS_SEAL;
}