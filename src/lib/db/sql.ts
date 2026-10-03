import type {
  Assay,
  AssayResult,
  AssaySummary,
  AuditEvent,
  CtSummary,
  Decision,
  Grade,
  KeyAlgorithm,
  LivePayload,
  SourceStatus,
  TlsObservation,
} from "../types";
import type {
  AssayPatch,
  AssayQuery,
  NewAssayRecord,
  Repository,
  SqlClient,
  StoreKind,
} from "./repository";
import { applySchema } from "./schema";

/**
 * One SQL implementation, two adapters.
 *
 * node-postgres and PGlite both expose query(text, params) -> { rows }, so every
 * query, mapping and transaction below is written once. The only difference
 * between local development and production is which client is handed in, which
 * is what makes "the same typed repository interface and domain logic for both"
 * true rather than aspirational.
 */

const ASSAY_COLUMNS = `
  a.id, a.session_id, a.host, a.port, a.label, a.grade, a.score, a.key_algorithm,
  a.key_bits, a.curve, a.protocol, a.cipher, a.issuer_common_name, a.not_after,
  a.chain_depth, a.ct_certificate_count, a.harvest_year, a.tls_payload, a.ct_payload,
  a.result, a.seal, a.created_at, a.updated_at, a.deleted_at, a.decision, a.notes
`;

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const normalised = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value)
      ? value
      : `${value.replace(" ", "T")}Z`;
    const parsed = new Date(normalised);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return String(value);
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = asNumber(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asNullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function asJson<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

function statusOf(payload: unknown): SourceStatus {
  const record = asJson<{ status?: string } | null>(payload);
  return record?.status === "fallback" ? "fallback" : "live";
}

function mapAssay(row: Record<string, unknown>): Assay {
  const tls = asJson<LivePayload<TlsObservation>>(row.tls_payload);
  const ct = asJson<LivePayload<CtSummary>>(row.ct_payload);
  return {
    id: String(row.id),
    host: String(row.host),
    port: asNumber(row.port),
    label: String(row.label),
    grade: row.grade as Grade,
    score: asNumber(row.score),
    keyAlgorithm: row.key_algorithm as KeyAlgorithm,
    keyBits: asNullableNumber(row.key_bits),
    curve: asNullableText(row.curve),
    protocol: asNullableText(row.protocol),
    cipher: asNullableText(row.cipher),
    issuerCommonName: asNullableText(row.issuer_common_name),
    notAfter: row.not_after ? asIso(row.not_after) : null,
    chainDepth: asNumber(row.chain_depth),
    ctCertificateCount: asNullableNumber(row.ct_certificate_count),
    harvestYear: asNullableNumber(row.harvest_year),
    decision: (row.decision ?? null) as Decision | null,
    notes: asNullableText(row.notes),
    seal: String(row.seal),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    deletedAt: row.deleted_at ? asIso(row.deleted_at) : null,
    tls,
    ct,
    result: asJson<AssayResult>(row.result),
  };
}

function mapSummary(row: Record<string, unknown>): AssaySummary {
  return {
    id: String(row.id),
    host: String(row.host),
    port: asNumber(row.port),
    label: String(row.label),
    grade: row.grade as Grade,
    score: asNumber(row.score),
    keyAlgorithm: row.key_algorithm as KeyAlgorithm,
    keyBits: asNullableNumber(row.key_bits),
    curve: asNullableText(row.curve),
    protocol: asNullableText(row.protocol),
    harvestYear: asNullableNumber(row.harvest_year),
    decision: (row.decision ?? null) as Decision | null,
    seal: String(row.seal),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    deletedAt: row.deleted_at ? asIso(row.deleted_at) : null,
    tlsStatus: statusOf(row.tls_payload),
    ctStatus: statusOf(row.ct_payload),
    ctCertificateCount: asNullableNumber(row.ct_certificate_count),
  };
}

function mapEvent(row: Record<string, unknown>): AuditEvent {
  return {
    entityId: String(row.entity_id),
    seq: asNumber(row.seq),
    eventType: row.event_type as AuditEvent["eventType"],
    payload: asJson<Record<string, unknown>>(row.payload) ?? {},
    prevSeal: String(row.prev_seal),
    seal: String(row.seal),
    createdAt: asIso(row.created_at),
  };
}

const PATCH_COLUMNS: Record<keyof AssayPatch, string> = {
  label: "label",
  decision: "decision",
  notes: "notes",
  seal: "seal",
  grade: "grade",
  score: "score",
  harvestYear: "harvest_year",
};

export async function withTransaction<T>(client: SqlClient, run: () => Promise<T>): Promise<T> {
  await client.query("begin");
  try {
    const result = await run();
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function insertEvents(
  client: SqlClient,
  schema: string,
  sessionId: string,
  events: AuditEvent[],
): Promise<void> {
  for (const event of events) {
    await client.query(
      `insert into ${schema}.audit_events
         (entity_id, entity_kind, session_id, seq, event_type, payload, prev_seal, seal, created_at)
       values ($1,'assay',$2,$3,$4,$5,$6,$7,$8)`,
      [
        event.entityId,
        sessionId,
        event.seq,
        event.eventType,
        JSON.stringify(event.payload),
        event.prevSeal,
        event.seal,
        event.createdAt,
      ],
    );
  }
}

export async function readAssay(
  client: SqlClient,
  schema: string,
  sessionId: string,
  id: string,
  includeDeleted = false,
): Promise<Assay | null> {
  const deletedFilter = includeDeleted ? "" : " and a.deleted_at is null";
  const result = await client.query<Record<string, unknown>>(
    `select ${ASSAY_COLUMNS} from ${schema}.assays a
      where a.id = $1 and a.session_id = $2${deletedFilter}`,
    [id, sessionId],
  );
  return result.rows[0] ? mapAssay(result.rows[0]) : null;
}

function assayFilters(sessionId: string, query: AssayQuery): { sql: string; params: unknown[] } {
  const filters = ["a.session_id = $1"];
  const params: unknown[] = [sessionId];
  if (!query.includeDeleted) filters.push("a.deleted_at is null");
  if (query.grade) {
    params.push(query.grade);
    filters.push(`a.grade = $${params.length}`);
  }
  if (query.decision) {
    params.push(query.decision);
    filters.push(`a.decision = $${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search}%`);
    filters.push(
      `(a.host ilike $${params.length} or a.label ilike $${params.length} or coalesce(a.issuer_common_name,'') ilike $${params.length})`,
    );
  }
  return { sql: filters.join(" and "), params };
}

export function createSqlRepository(client: SqlClient, kind: StoreKind, schema: string): Repository {
  let ready = false;

  const repository: Repository = {
    kind,
    schema,

    async init() {
      if (ready) return;
      await applySchema(client, schema);
      ready = true;
    },

    async healthCheck() {
      const checkedAt = new Date().toISOString();
      try {
        const probe = await client.query<{ n: number }>("select 1 as n");
        if (probe.rows[0]?.n !== 1) {
          return { ok: false, detail: "SELECT 1 did not return 1", checkedAt };
        }
        const assays = await client.query<{ n: number }>(
          `select count(*)::int as n from ${schema}.assays`,
        );
        const events = await client.query<{ n: number }>(
          `select count(*)::int as n from ${schema}.audit_events`,
        );
        return {
          ok: true,
          detail: `SELECT 1 succeeded; ${assays.rows[0]?.n ?? 0} assays stored; ${events.rows[0]?.n ?? 0} sealed audit events`,
          checkedAt,
        };
      } catch (error) {
        return {
          ok: false,
          detail: error instanceof Error ? error.message : "database probe failed",
          checkedAt,
        };
      }
    },

    async createAssay(record: NewAssayRecord, events: AuditEvent[]) {
      return withTransaction(client, async () => {
        await client.query(
          `insert into ${schema}.assays (
             id, session_id, idempotency_key, host, port, label, grade, score,
             key_algorithm, key_bits, curve, protocol, cipher, issuer_common_name,
             not_after, chain_depth, ct_certificate_count, harvest_year,
             tls_payload, ct_payload, result, seal
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
          [
            record.id,
            record.sessionId,
            record.idempotencyKey,
            record.host,
            record.port,
            record.label,
            record.grade,
            record.score,
            record.keyAlgorithm,
            record.keyBits,
            record.curve,
            record.protocol,
            record.cipher,
            record.issuerCommonName,
            record.notAfter,
            record.chainDepth,
            record.ctCertificateCount,
            record.harvestYear,
            JSON.stringify(record.tlsPayload),
            JSON.stringify(record.ctPayload),
            JSON.stringify(record.result),
            record.seal,
          ],
        );
        await insertEvents(client, schema, record.sessionId, events);
        const stored = await readAssay(client, schema, record.sessionId, record.id);
        if (!stored) throw new Error("Assay insert did not return a readable row");
        return stored;
      });
    },

    async listAssays(sessionId, query) {
      const { sql, params } = assayFilters(sessionId, query);
      const bounded = [...params, query.limit, query.offset];
      const result = await client.query<Record<string, unknown>>(
        `select ${ASSAY_COLUMNS} from ${schema}.assays a
          where ${sql}
          order by a.created_at desc
          limit $${bounded.length - 1} offset $${bounded.length}`,
        bounded,
      );
      return result.rows.map(mapSummary);
    },

    async listAssaysPage(sessionId, query) {
      const { sql, params } = assayFilters(sessionId, query);
      const bounded = [...params, query.limit, query.offset];
      // count(*) over() is evaluated before LIMIT, so it reports the size of the
      // whole filtered set rather than of the page.
      const result = await client.query<Record<string, unknown>>(
        `select ${ASSAY_COLUMNS}, count(*) over() as total_count
           from ${schema}.assays a
          where ${sql}
          order by a.created_at desc
          limit $${bounded.length - 1} offset $${bounded.length}`,
        bounded,
      );
      const items = result.rows.map(mapAssay);
      const total = result.rows[0] ? asNumber(result.rows[0].total_count) : 0;
      return { items, total };
    },

    async countAssays(sessionId, query) {
      const { sql, params } = assayFilters(sessionId, query);
      const result = await client.query<{ n: number }>(
        `select count(*)::int as n from ${schema}.assays a where ${sql}`,
        params,
      );
      return result.rows[0]?.n ?? 0;
    },

    async getAssay(sessionId, id, includeDeleted = false) {
      return readAssay(client, schema, sessionId, id, includeDeleted);
    },

    async findByIdempotencyKey(sessionId, key) {
      const result = await client.query<Record<string, unknown>>(
        `select ${ASSAY_COLUMNS} from ${schema}.assays a
          where a.session_id = $1 and a.idempotency_key = $2 and a.deleted_at is null
          limit 1`,
        [sessionId, key],
      );
      return result.rows[0] ? mapAssay(result.rows[0]) : null;
    },

    async updateAssay(sessionId, id, patch, events) {
      const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
      if (entries.length === 0) return readAssay(client, schema, sessionId, id);

      return withTransaction(client, async () => {
        const assignments: string[] = [];
        const params: unknown[] = [id, sessionId];
        for (const [key, value] of entries) {
          const column = PATCH_COLUMNS[key as keyof AssayPatch];
          if (!column) continue;
          params.push(value);
          assignments.push(`${column} = $${params.length}`);
        }
        if (assignments.length === 0) return readAssay(client, schema, sessionId, id);
        assignments.push("updated_at = now()");
        const result = await client.query(
          `update ${schema}.assays set ${assignments.join(", ")}
            where id = $1 and session_id = $2 and deleted_at is null
            returning id`,
          params,
        );
        if (result.rows.length === 0) return null;
        await insertEvents(client, schema, sessionId, events);
        return readAssay(client, schema, sessionId, id);
      });
    },

    async deleteAssay(sessionId, id, events) {
      return withTransaction(client, async () => {
        // The seal is written as part of the tombstone, not left behind. If the
        // stored seal could lag the audit chain head, a verifier reading the row
        // and a verifier replaying the events would disagree about the same
        // entity, which would make the seal meaningless.
        const seal = events[events.length - 1]?.seal ?? null;
        const result = await client.query(
          `update ${schema}.assays
              set deleted_at = now(), updated_at = now(), seal = coalesce($3, seal)
            where id = $1 and session_id = $2 and deleted_at is null
            returning id`,
          [id, sessionId, seal],
        );
        if (result.rows.length === 0) return null;
        await insertEvents(client, schema, sessionId, events);
        // The row is tombstoned now, so read it back WITHOUT the deleted filter;
        // otherwise a successful deletion would report itself missing.
        return readAssay(client, schema, sessionId, id, true);
      });
    },

    async listEvents(entityId) {
      const result = await client.query<Record<string, unknown>>(
        `select entity_id, seq, event_type, payload, prev_seal, seal, created_at
           from ${schema}.audit_events
          where entity_id = $1
          order by seq asc`,
        [entityId],
      );
      return result.rows.map(mapEvent);
    },

    async listEventHeads(entityIds) {
      const heads = new Map<string, AuditEvent>();
      if (entityIds.length === 0) return heads;
      const result = await client.query<Record<string, unknown>>(
        `select distinct on (entity_id)
           entity_id, seq, event_type, payload, prev_seal, seal, created_at
           from ${schema}.audit_events
          where entity_id = any($1::uuid[])
          order by entity_id, seq desc`,
        [entityIds],
      );
      for (const row of result.rows) {
        const event = mapEvent(row);
        heads.set(event.entityId, event);
      }
      return heads;
    },

    async getPolicy(sessionId) {
      const result = await client.query<Record<string, unknown>>(
        `select session_id, horizon_year, cost_model, capability_base_qubits,
                capability_growth, minimum_classical_bits, updated_at
           from ${schema}.assay_policies where session_id = $1`,
        [sessionId],
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        horizonYear: asNumber(row.horizon_year),
        costModel: String(row.cost_model),
        capabilityBaseQubits: asNumber(row.capability_base_qubits),
        capabilityGrowth: asNumber(row.capability_growth),
        minimumClassicalBits: asNumber(row.minimum_classical_bits),
        updatedAt: asIso(row.updated_at),
      };
    },

    async savePolicy(sessionId, policy) {
      const result = await client.query<Record<string, unknown>>(
        `insert into ${schema}.assay_policies
           (session_id, horizon_year, cost_model, capability_base_qubits,
            capability_growth, minimum_classical_bits, updated_at)
         values ($1,$2,$3,$4,$5,$6, now())
         on conflict (session_id) do update set
           horizon_year = excluded.horizon_year,
           cost_model = excluded.cost_model,
           capability_base_qubits = excluded.capability_base_qubits,
           capability_growth = excluded.capability_growth,
           minimum_classical_bits = excluded.minimum_classical_bits,
           updated_at = now()
         returning updated_at`,
        [
          sessionId,
          policy.horizonYear,
          policy.costModel,
          policy.capabilityBaseQubits,
          policy.capabilityGrowth,
          policy.minimumClassicalBits,
        ],
      );
      return {
        horizonYear: policy.horizonYear,
        costModel: policy.costModel,
        capabilityBaseQubits: policy.capabilityBaseQubits,
        capabilityGrowth: policy.capabilityGrowth,
        minimumClassicalBits: policy.minimumClassicalBits,
        updatedAt: asIso(result.rows[0]?.updated_at ?? new Date().toISOString()),
      };
    },
  };

  return repository;
}