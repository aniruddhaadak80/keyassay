import { ValidationError } from "../validation";

/**
 * Typed argument schemas for the agent tool surface.
 *
 * Each tool declares its arguments once, as a list of field descriptors, and
 * that single declaration drives three things: runtime validation of incoming
 * arguments, the JSON Schema published by `tools/list`, and the documentation
 * shown in the agent console. A tool therefore cannot accept a shape it did not
 * advertise, and the published schema cannot drift from what is enforced.
 *
 * Implemented directly rather than with a validation library so the repository
 * keeps exactly the dependencies it declares.
 */

export type FieldType = "string" | "number" | "integer" | "boolean" | "enum";

export interface FieldSpec {
  name: string;
  type: FieldType;
  required?: boolean;
  description: string;
  /** For "enum". */
  values?: readonly string[];
  min?: number;
  max?: number;
  maxLength?: number;
  format?: "uuid";
  default?: unknown;
}

export type ArgumentSpec = readonly FieldSpec[];

export interface JsonSchemaProperty {
  type: string;
  description: string;
  enum?: readonly string[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  format?: string;
}

export interface JsonSchema {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required: readonly string[];
  additionalProperties: false;
}

/** The JSON Schema published for a tool, derived from its field list. */
export function toJsonSchema(spec: ArgumentSpec): JsonSchema {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  for (const field of spec) {
    const property: JsonSchemaProperty = {
      type: field.type === "enum" ? "string" : field.type === "integer" ? "integer" : field.type,
      description: field.description,
    };
    if (field.values) property.enum = field.values;
    if (field.min !== undefined) property.minimum = field.min;
    if (field.max !== undefined) property.maximum = field.max;
    if (field.maxLength !== undefined) property.maxLength = field.maxLength;
    if (field.format) property.format = field.format;
    properties[field.name] = property;
    if (field.required) required.push(field.name);
  }

  return { type: "object", properties, required, additionalProperties: false };
}

function coerceScalar(field: FieldSpec, raw: unknown): unknown {
  if (field.type === "string" || field.type === "enum") {
    if (typeof raw !== "string") {
      throw new ValidationError("invalid_type", field.name, `${field.name} must be a string.`);
    }
    const trimmed = raw.trim();
    if (field.maxLength !== undefined && trimmed.length > field.maxLength) {
      throw new ValidationError(
        "too_long",
        field.name,
        `${field.name} must be ${field.maxLength} characters or fewer.`,
      );
    }
    if (field.format === "uuid" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
      throw new ValidationError("invalid_format", field.name, `${field.name} must be a UUID.`);
    }
    if (field.type === "enum" && field.values && !field.values.includes(trimmed)) {
      throw new ValidationError(
        "invalid_enum",
        field.name,
        `${field.name} must be one of: ${field.values.join(", ")}.`,
      );
    }
    return trimmed;
  }

  if (field.type === "boolean") {
    if (typeof raw === "boolean") return raw;
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new ValidationError("invalid_type", field.name, `${field.name} must be true or false.`);
  }

  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new ValidationError("invalid_type", field.name, `${field.name} must be a number.`);
  }
  if (field.type === "integer" && !Number.isInteger(parsed)) {
    throw new ValidationError("invalid_type", field.name, `${field.name} must be a whole number.`);
  }
  if (field.min !== undefined && parsed < field.min) {
    throw new ValidationError("out_of_range", field.name, `${field.name} must be at least ${field.min}.`);
  }
  if (field.max !== undefined && parsed > field.max) {
    throw new ValidationError("out_of_range", field.name, `${field.name} must be at most ${field.max}.`);
  }
  return parsed;
}

/**
 * Validate and coerce an argument object against a field list.
 * Unknown keys are rejected so a typo cannot silently become a no-op.
 */
export function parseArgs<T>(spec: ArgumentSpec, args: unknown): T {
  const record: Record<string, unknown> =
    args === undefined || args === null ? {} : typeof args === "object" && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : (() => {
          throw new ValidationError("invalid_arguments", "arguments", "Tool arguments must be an object.");
        })();

  for (const key of Object.keys(record)) {
    if (!spec.some((field) => field.name === key)) {
      throw new ValidationError(
        "unknown_argument",
        key,
        `Unknown argument "${key}". Allowed: ${spec.map((field) => field.name).join(", ")}.`,
      );
    }
  }

  const result: Record<string, unknown> = {};
  for (const field of spec) {
    const raw = record[field.name];
    if (raw === undefined || raw === null || raw === "") {
      if (field.required) {
        throw new ValidationError("required", field.name, `${field.name} is required.`);
      }
      if (field.default !== undefined) result[field.name] = field.default;
      continue;
    }
    result[field.name] = coerceScalar(field, raw);
  }
  return result as T;
}

/* ------------------------------------------------------------------ *
 * Tool argument specifications
 * ------------------------------------------------------------------ */

export const ASSAY_HOST_ARGS = [
  {
    name: "host",
    type: "string",
    required: true,
    maxLength: 253,
    description: "Hostname to assay, for example example.com. No scheme, path or credentials.",
  },
  {
    name: "label",
    type: "string",
    maxLength: 80,
    description: "Short name for this endpoint in the ledger. Defaults to the hostname.",
  },
  {
    name: "notes",
    type: "string",
    maxLength: 600,
    description: "Free-text note stored with the assay.",
  },
  {
    name: "idempotency_key",
    type: "string",
    maxLength: 128,
    description:
      "Retry-safe key. Replaying the same key returns the original assay instead of creating a second one.",
  },
] as const satisfies ArgumentSpec;

export const GET_ASSAY_ARGS = [
  {
    name: "id",
    type: "string",
    required: true,
    format: "uuid",
    description: "Assay id, as returned by assay_host or list_assays.",
  },
  {
    name: "include_events",
    type: "boolean",
    description: "Include the sealed audit trail with the assay.",
  },
] as const satisfies ArgumentSpec;

export const LIST_ASSAYS_ARGS = [
  {
    name: "grade",
    type: "enum",
    values: ["bullion", "sterling", "base", "corroded"],
    description: "Filter by assay mark.",
  },
  {
    name: "decision",
    type: "enum",
    values: ["migrate-first", "plan-hybrid", "monitor", "accepted"],
    description: "Filter by recorded decision.",
  },
  {
    name: "search",
    type: "string",
    maxLength: 120,
    description: "Substring match against host, label and issuer.",
  },
  {
    name: "limit",
    type: "integer",
    min: 1,
    max: 100,
    default: 25,
    description: "Page size.",
  },
  {
    name: "offset",
    type: "integer",
    min: 0,
    max: 10_000,
    default: 0,
    description: "Page offset.",
  },
] as const satisfies ArgumentSpec;

export const RERATE_ARGS = [
  {
    name: "id",
    type: "string",
    required: true,
    format: "uuid",
    description: "Assay to re-rate. The stored measurement is never modified.",
  },
  {
    name: "horizon_year",
    type: "integer",
    min: 2026,
    max: 2200,
    description: "Confidentiality horizon for this calculation only.",
  },
  {
    name: "capability_growth",
    type: "number",
    min: 0.01,
    max: 5,
    description: "Annual error-corrected qubit growth for this calculation only.",
  },
  {
    name: "persist",
    type: "boolean",
    description: "Store the overridden values as this session's policy.",
  },
] as const satisfies ArgumentSpec;

export const RECORD_DECISION_ARGS = [
  {
    name: "id",
    type: "string",
    required: true,
    format: "uuid",
    description: "Assay the decision applies to.",
  },
  {
    name: "decision",
    type: "enum",
    required: true,
    values: ["migrate-first", "plan-hybrid", "monitor", "accepted"],
    description: "The migration verdict to seal against this assay.",
  },
  {
    name: "notes",
    type: "string",
    maxLength: 600,
    description: "Optional note stored with the decision.",
  },
] as const satisfies ArgumentSpec;

export const VERIFY_INTEGRITY_ARGS = [
  {
    name: "id",
    type: "string",
    format: "uuid",
    description: "Assay to verify. Omit to verify every assay in the session.",
  },
] as const satisfies ArgumentSpec;

export const DELETE_ASSAY_ARGS = [
  {
    name: "id",
    type: "string",
    required: true,
    format: "uuid",
    description: "Assay to tombstone.",
  },
  {
    name: "confirm",
    type: "boolean",
    required: true,
    description:
      "Must be true. Without it the call is refused, so a stray agent invocation cannot delete anything.",
  },
] as const satisfies ArgumentSpec;

export const GET_POLICY_ARGS = [
  {
    name: "horizon_year",
    type: "integer",
    min: 2026,
    max: 2200,
    description: "Year by which harvested traffic must still be unreadable.",
  },
  {
    name: "cost_model",
    type: "enum",
    values: ["gidney-ekera-2019", "gidney-2025"],
    description: "Which published RSA-2048 physical-qubit figure to anchor to.",
  },
  {
    name: "capability_base_qubits",
    type: "integer",
    min: 1,
    max: 100_000_000,
    description: "Error-corrected physical qubits assumed available in the base year.",
  },
  {
    name: "capability_growth",
    type: "number",
    min: 0.01,
    max: 5,
    description: "Annual fractional growth in that capacity.",
  },
  {
    name: "minimum_classical_bits",
    type: "integer",
    min: 80,
    max: 256,
    description: "Classical security floor for the leaf public key.",
  },
] as const satisfies ArgumentSpec;

export const EXPORT_CERTIFICATE_ARGS = [
  {
    name: "id",
    type: "string",
    required: true,
    format: "uuid",
    description: "Assay to certify.",
  },
  {
    name: "format",
    type: "enum",
    values: ["json", "html", "csv"],
    description: "Artifact format. Defaults to json.",
  },
] as const satisfies ArgumentSpec;

export const RESEARCH_ARGS = [
  {
    name: "limit",
    type: "integer",
    min: 1,
    max: 20,
    default: 6,
    description: "How many recent arXiv papers to return.",
  },
] as const satisfies ArgumentSpec;