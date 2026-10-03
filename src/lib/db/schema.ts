import type { SqlClient } from "./repository";

/**
 * Schema creation, idempotent first-run seeding, and the safety rails.
 *
 * There is no seed data in the content sense: this product has no catalogue of
 * pre-made assays, because a fabricated assay would be a lie about a real host.
 * The one thing seeded is the reference row for the NIST IR 8547 clock, which is
 * a published standard rather than user content, and it carries origin='standard'
 * so it can never collide with a visitor's own record.
 */

const SCHEMA_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function resolveSchema(): string {
  const requested = process.env.DATABASE_SCHEMA?.trim();
  if (!requested) return "public";
  if (!SCHEMA_NAME_RE.test(requested)) {
    throw new Error(
      `DATABASE_SCHEMA must be a simple SQL identifier (letters, digits, underscore). Received: ${requested}`,
    );
  }
  return requested;
}

function ddl(schema: string): string[] {
  const s = schema;
  return [
    `create schema if not exists ${s}`,
    `create table if not exists ${s}.assays (
      id uuid primary key,
      session_id uuid not null,
      idempotency_key text,
      host text not null check (char_length(host) between 1 and 253),
      port integer not null check (port between 1 and 65535),
      label text not null check (char_length(label) between 1 and 80),
      grade text not null check (grade in ('bullion','sterling','base','corroded')),
      score integer not null check (score between 0 and 100),
      key_algorithm text not null check (key_algorithm in ('rsa','ec','ed25519','dsa','unknown')),
      key_bits integer check (key_bits between 256 and 32768),
      curve text check (curve is null or char_length(curve) <= 64),
      protocol text check (protocol is null or char_length(protocol) <= 32),
      cipher text check (cipher is null or char_length(cipher) <= 64),
      issuer_common_name text check (issuer_common_name is null or char_length(issuer_common_name) <= 200),
      not_after timestamptz,
      chain_depth integer not null default 0 check (chain_depth between 0 and 20),
      ct_certificate_count integer check (ct_certificate_count between 0 and 1000000),
      harvest_year integer check (harvest_year between 2000 and 2200),
      decision text check (decision is null or decision in ('migrate-first','plan-hybrid','monitor','accepted')),
      notes text check (notes is null or char_length(notes) <= 600),
      tls_payload jsonb not null,
      ct_payload jsonb not null,
      result jsonb not null,
      seal text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      deleted_at timestamptz
    )`,
    `create unique index if not exists assays_session_idempotency
       on ${s}.assays (session_id, idempotency_key)
       where idempotency_key is not null`,
    `create index if not exists assays_session_recent on ${s}.assays (session_id, created_at desc)`,
    `create index if not exists assays_session_grade on ${s}.assays (session_id, grade)`,
    `create index if not exists assays_session_decision on ${s}.assays (session_id, decision)`,
    `create index if not exists assays_host on ${s}.assays (host)`,
    `create table if not exists ${s}.audit_events (
      id bigserial primary key,
      entity_id uuid not null,
      entity_kind text not null default 'assay',
      session_id uuid not null,
      seq integer not null check (seq >= 1),
      event_type text not null check (event_type in ('created','updated','decision','deleted')),
      payload jsonb not null,
      prev_seal text not null,
      seal text not null,
      created_at timestamptz not null,
      unique (entity_id, seq)
    )`,
    `create index if not exists audit_entity_seq on ${s}.audit_events (entity_id, seq)`,
    `create index if not exists audit_session on ${s}.audit_events (session_id, created_at desc)`,
    `create table if not exists ${s}.assay_policies (
      session_id uuid primary key,
      horizon_year integer not null check (horizon_year between 2026 and 2200),
      cost_model text not null check (cost_model in ('gidney-ekera-2019','gidney-2025')),
      capability_base_qubits integer not null check (capability_base_qubits between 1 and 100000000),
      capability_growth real not null check (capability_growth > 0 and capability_growth <= 5),
      minimum_classical_bits integer not null check (minimum_classical_bits between 80 and 256),
      updated_at timestamptz not null default now()
    )`,
  ];
}

export async function applySchema(client: SqlClient, schema: string): Promise<void> {
  for (const statement of ddl(schema)) {
    await client.query(statement);
  }
}