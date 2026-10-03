import type { Repository } from "./db/repository";
import type { Assay, AssayResult, Decision, Grade } from "./types";
import {
  DEFAULT_POLICY,
  runAssay,
  type AssayPolicy,
} from "./engine/assay";
import { buildEvent, headSealOf, replayChain } from "./integrity/chain";
import { CtLookupError, ctFallbackPayload, ctPayload, fetchCertificateTransparency } from "./sources/ct";
import { TlsProbeError, probeTls, tlsFallbackPayload, tlsPayload } from "./sources/tls";
import {
  parseDecision,
  parseHostTarget,
  parseIdempotencyKey,
  parseLabel,
  parseNotes,
} from "./validation";

/**
 * The service layer.
 *
 * Every mutation in the product goes through here: the UI form, the REST route
 * and the MCP tool all call the same function, so there is exactly one place
 * where a scan happens, the engine runs, a seal is struck and an audit event is
 * appended. That is what makes the agent's mutation genuinely the same path as
 * the UI's, rather than a parallel implementation that drifts.
 */

export interface ServiceContext {
  repo: Repository;
  sessionId: string;
  /** Injected in tests so results and seals are deterministic. */
  now?: () => Date;
  /** Injected in tests so break-year maths is deterministic. */
  currentYear?: () => number;
}

function clock(ctx: ServiceContext): Date {
  return ctx.now ? ctx.now() : new Date();
}

function year(ctx: ServiceContext): number {
  return ctx.currentYear ? ctx.currentYear() : new Date().getFullYear();
}

export async function loadPolicy(ctx: ServiceContext): Promise<AssayPolicy> {
  const stored = await ctx.repo.getPolicy(ctx.sessionId);
  if (!stored) return { ...DEFAULT_POLICY };
  return {
    ...DEFAULT_POLICY,
    horizonYear: stored.horizonYear,
    costModel: stored.costModel as AssayPolicy["costModel"],
    capabilityBaseQubits: stored.capabilityBaseQubits,
    capabilityGrowth: stored.capabilityGrowth,
    minimumClassicalBits: stored.minimumClassicalBits,
  };
}

export async function savePolicy(
  ctx: ServiceContext,
  patch: Partial<AssayPolicy>,
): Promise<AssayPolicy> {
  const current = await loadPolicy(ctx);
  const next: AssayPolicy = { ...current, ...patch };
  await ctx.repo.savePolicy(ctx.sessionId, {
    horizonYear: next.horizonYear,
    costModel: next.costModel,
    capabilityBaseQubits: next.capabilityBaseQubits,
    capabilityGrowth: next.capabilityGrowth,
    minimumClassicalBits: next.minimumClassicalBits,
  });
  return next;
}

/* ------------------------------------------------------------------ *
 * Scan
 * ------------------------------------------------------------------ */

export interface ScanOutcome {
  assay: Assay;
  /** True when the TLS handshake could not run and a sealed sample was used. */
  degraded: boolean;
  /** Present when the TLS probe failed, for an honest UI warning. */
  tlsWarning: string | null;
}

/**
 * Perform a real handshake, pull CT history, run the engine, persist the result
 * and seal it. The TLS probe is authoritative: if the handshake fails the scan
 * fails, unless the caller explicitly accepts a sealed sample.
 */
export async function assayHost(
  ctx: ServiceContext,
  input: {
    host: string;
    port?: number;
    label?: string;
    notes?: string | null;
    idempotencyKey?: string | null;
    allowFallback?: boolean;
  },
): Promise<ScanOutcome> {
  const target = parseHostTarget(
    input.port === undefined ? input.host : `${input.host}:${input.port}`,
  );
  const label = parseLabel(input.label ?? target.host);
  const notes = parseNotes(input.notes);
  const idempotencyKey = parseIdempotencyKey(input.idempotencyKey);
  const allowFallback = input.allowFallback ?? false;

  if (idempotencyKey) {
    const existing = await ctx.repo.findByIdempotencyKey(ctx.sessionId, idempotencyKey);
    if (existing) {
      return { assay: existing, degraded: existing.tls.status === "fallback", tlsWarning: null };
    }
  }

  const policy = await loadPolicy(ctx);
  const now = clock(ctx);
  const currentYear = year(ctx);

  let tls;
  let tlsWarning: string | null = null;
  let degraded = false;

  try {
    tls = tlsPayload(await probeTls(target.host, target.port));
  } catch (error) {
    const message = error instanceof Error ? error.message : "TLS probe failed.";
    if (!allowFallback) {
      if (error instanceof TlsProbeError) {
        const failure = new Error(message) as Error & { code?: string };
        failure.code = error.code;
        throw failure;
      }
      throw new Error(message);
    }
    tls = tlsFallbackPayload(target.host, message);
    tlsWarning = `The TLS handshake with ${target.host} could not be completed, so this assay used the sealed offline sample. It is not a measurement of that host.`;
    degraded = true;
  }

  let ct;
  try {
    const ctResult = await fetchCertificateTransparency(target.host, {
      deprecateYear: policy.deprecateYear,
      disallowYear: policy.disallowYear,
    });
    ct = ctPayload(ctResult.summary, new Date().toISOString());
  } catch (error) {
    const reason =
      error instanceof CtLookupError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Certificate Transparency lookup failed.";
    ct = ctFallbackPayload(target.host, reason);
  }

  const result: AssayResult = runAssay({
    tls,
    ct,
    policy,
    currentYear,
    now: now.toISOString(),
  });

  const createdAt = now.toISOString();
  const id = crypto.randomUUID();
  const leaf = tls.data.chain[0] ?? null;

  const created = buildEvent({
    entityId: id,
    type: "created",
    payload: {
      host: target.host,
      port: target.port,
      label,
      grade: result.grade,
      score: result.score,
      keyAlgorithm: leaf?.algorithm ?? "unknown",
      keyBits: leaf?.bits ?? null,
      protocol: tls.data.protocol,
      tlsStatus: tls.status,
      ctStatus: ct.status,
      engineVersion: result.engineVersion,
    },
    createdAt,
    previousSeal: headSealOf([]),
    nextSeq: 1,
  });

  const stored = await ctx.repo.createAssay(
    {
      id,
      sessionId: ctx.sessionId,
      idempotencyKey,
      host: target.host,
      port: target.port,
      label,
      grade: result.grade,
      score: result.score,
      keyAlgorithm: leaf?.algorithm ?? "unknown",
      keyBits: leaf?.bits ?? null,
      curve: leaf?.curve ?? null,
      protocol: tls.data.protocol,
      cipher: tls.data.cipher,
      issuerCommonName: leaf?.issuer ?? null,
      notAfter: leaf?.validTo ?? null,
      chainDepth: tls.data.chainDepth,
      ctCertificateCount: ct.data.certificateCount,
      harvestYear: result.exposure.breakYear,
      tlsPayload: tls,
      ctPayload: ct,
      result,
      seal: created.seal,
    },
    [created],
  );

  const withNotes = notes ? await setNotes(ctx, stored.id, notes, stored) : stored;
  return { assay: withNotes, degraded, tlsWarning };
}

async function setNotes(
  ctx: ServiceContext,
  id: string,
  notes: string,
  previous: Assay,
): Promise<Assay> {
  const events = await ctx.repo.listEvents(id);
  const now = clock(ctx).toISOString();
  const event = buildEvent({
    entityId: id,
    type: "updated",
    payload: { notes },
    createdAt: now,
    previousSeal: headSealOf(events),
    nextSeq: events.length + 1,
  });
  const updated = await ctx.repo.updateAssay(
    ctx.sessionId,
    id,
    { notes, seal: event.seal },
    [event],
  );
  return updated ?? previous;
}

/* ------------------------------------------------------------------ *
 * Update / decide / delete
 * ------------------------------------------------------------------ */

export async function renameAssay(
  ctx: ServiceContext,
  id: string,
  rawLabel: unknown,
): Promise<Assay> {
  const label = parseLabel(rawLabel);
  const existing = await ctx.repo.getAssay(ctx.sessionId, id);
  if (!existing) throw new NotFoundError();
  if (label === existing.label) return existing;

  const events = await ctx.repo.listEvents(id);
  const event = buildEvent({
    entityId: id,
    type: "updated",
    payload: { label, previousLabel: existing.label },
    createdAt: clock(ctx).toISOString(),
    previousSeal: headSealOf(events),
    nextSeq: events.length + 1,
  });
  const updated = await ctx.repo.updateAssay(ctx.sessionId, id, { label, seal: event.seal }, [event]);
  if (!updated) throw new NotFoundError();
  return updated;
}

export async function updateNotes(
  ctx: ServiceContext,
  id: string,
  rawNotes: unknown,
): Promise<Assay> {
  const notes = parseNotes(rawNotes);
  const existing = await ctx.repo.getAssay(ctx.sessionId, id);
  if (!existing) throw new NotFoundError();
  if (notes === existing.notes) return existing;

  const events = await ctx.repo.listEvents(id);
  const event = buildEvent({
    entityId: id,
    type: "updated",
    payload: { notes, previousNotes: existing.notes },
    createdAt: clock(ctx).toISOString(),
    previousSeal: headSealOf(events),
    nextSeq: events.length + 1,
  });
  const updated = await ctx.repo.updateAssay(ctx.sessionId, id, { notes, seal: event.seal }, [event]);
  if (!updated) throw new NotFoundError();
  return updated;
}

export async function recordDecision(
  ctx: ServiceContext,
  id: string,
  rawDecision: unknown,
): Promise<Assay> {
  const decision = parseDecision(rawDecision) as Decision;
  const existing = await ctx.repo.getAssay(ctx.sessionId, id);
  if (!existing) throw new NotFoundError();

  const events = await ctx.repo.listEvents(id);
  const now = clock(ctx).toISOString();
  const event = buildEvent({
    entityId: id,
    type: "decision",
    payload: {
      decision,
      previousDecision: existing.decision,
      gradeAtDecision: existing.grade,
      scoreAtDecision: existing.score,
      breakYearAtDecision: existing.result.exposure.breakYear,
      engineVersion: existing.result.engineVersion,
    },
    createdAt: now,
    previousSeal: headSealOf(events),
    nextSeq: events.length + 1,
  });
  const updated = await ctx.repo.updateAssay(
    ctx.sessionId,
    id,
    { decision, seal: event.seal },
    [event],
  );
  if (!updated) throw new NotFoundError();
  return updated;
}

/**
 * Re-rate a stored assay against the current policy without touching the stored
 * observation. This is what the horizon dial drives: the measurement stays as it
 * was taken, and only the assumed timeline moves.
 */
export function rerateStored(assay: Assay, policy: AssayPolicy, currentYear: number): AssayResult {
  return runAssay({
    tls: assay.tls,
    ct: assay.ct,
    policy,
    currentYear,
    now: new Date().toISOString(),
  });
}

export async function deleteAssay(ctx: ServiceContext, id: string): Promise<Assay> {
  const existing = await ctx.repo.getAssay(ctx.sessionId, id);
  if (!existing) throw new NotFoundError();

  const events = await ctx.repo.listEvents(id);
  const event = buildEvent({
    entityId: id,
    type: "deleted",
    payload: {
      host: existing.host,
      label: existing.label,
      grade: existing.grade,
      score: existing.score,
      sealAtDeletion: existing.seal,
    },
    createdAt: clock(ctx).toISOString(),
    previousSeal: headSealOf(events),
    nextSeq: events.length + 1,
  });
  const deleted = await ctx.repo.deleteAssay(ctx.sessionId, id, [event]);
  if (!deleted) throw new NotFoundError();
  return deleted;
}

export async function verifyAssay(ctx: ServiceContext, id: string) {
  const assay = await ctx.repo.getAssay(ctx.sessionId, id, true);
  if (!assay) throw new NotFoundError();
  const events = await ctx.repo.listEvents(id);
  return replayChain(id, events, clock(ctx).toISOString());
}

export class NotFoundError extends Error {
  readonly code = "not_found";
  constructor() {
    super("No assay with that id exists in this session.");
    this.name = "NotFoundError";
  }
}

export const GRADE_ORDER: readonly Grade[] = ["corroded", "base", "sterling", "bullion"];