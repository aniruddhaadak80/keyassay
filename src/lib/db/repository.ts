import type { Assay, AssaySummary, AuditEvent, Grade, KeyAlgorithm } from "../types";

/** Minimal query surface satisfied by both node-postgres Pool and PGlite. */
export interface SqlClient {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export type StoreKind = "postgres" | "pglite";

export interface AssayPolicyRecord {
  horizonYear: number;
  costModel: string;
  capabilityBaseQubits: number;
  capabilityGrowth: number;
  minimumClassicalBits: number;
  updatedAt: string;
}

export interface NewAssayRecord {
  id: string;
  sessionId: string;
  idempotencyKey: string | null;
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
  tlsPayload: unknown;
  ctPayload: unknown;
  result: unknown;
  seal: string;
}

export type AssayPatch = Partial<
  Pick<Assay, "label" | "decision" | "notes" | "seal" | "grade" | "score" | "harvestYear">
>;

export interface AssayQuery {
  limit: number;
  offset: number;
  grade?: Grade;
  decision?: Assay["decision"];
  search?: string;
  includeDeleted: boolean;
}

export interface AssayPage {
  items: Assay[];
  total: number;
}

export interface Repository {
  readonly kind: StoreKind;
  readonly schema: string;
  init(): Promise<void>;
  healthCheck(): Promise<{ ok: boolean; detail: string; checkedAt: string }>;
  createAssay(record: NewAssayRecord, events: AuditEvent[]): Promise<Assay>;
  listAssays(sessionId: string, query: AssayQuery): Promise<AssaySummary[]>;
  /**
   * A full page of records and the filtered total in ONE round trip.
   *
   * List pages need complete rows, not summaries, so a summary list plus a
   * per-row fetch is the obvious shape — and it is an N+1 that will exhaust a
   * small connection pool on a hosted database. A window function returns the
   * total alongside the page, and the full rows arrive in the same query.
   */
  listAssaysPage(sessionId: string, query: AssayQuery): Promise<AssayPage>;
  countAssays(sessionId: string, query: AssayQuery): Promise<number>;
  getAssay(sessionId: string, id: string, includeDeleted?: boolean): Promise<Assay | null>;
  findByIdempotencyKey(sessionId: string, key: string): Promise<Assay | null>;
  updateAssay(
    sessionId: string,
    id: string,
    patch: AssayPatch,
    events: AuditEvent[],
  ): Promise<Assay | null>;
  deleteAssay(sessionId: string, id: string, events: AuditEvent[]): Promise<Assay | null>;
  listEvents(entityId: string): Promise<AuditEvent[]>;
  listEventHeads(entityIds: string[]): Promise<Map<string, AuditEvent>>;
  getPolicy(sessionId: string): Promise<AssayPolicyRecord | null>;
  savePolicy(sessionId: string, policy: Omit<AssayPolicyRecord, "updatedAt">): Promise<AssayPolicyRecord>;
}