import { DECISIONS, GRADES } from "./types";

/**
 * Input validation.
 *
 * Every route and every MCP tool validates through this module, so a malformed
 * host, an oversized note or an out-of-range year is rejected with a specific
 * code instead of reaching SQL or the socket layer.
 */

export class ValidationError extends Error {
  readonly code: string;
  readonly field: string;
  constructor(code: string, field: string, message: string) {
    super(message);
    this.name = "ValidationError";
    this.code = code;
    this.field = field;
  }
}

/* ------------------------------------------------------------------ *
 * Host
 * ------------------------------------------------------------------ */

const HOST_RE = /^(?=.{1,253}$)(?!-)[a-zA-Z0-9-]{1,63}(?<!-)(\.(?!-)[a-zA-Z0-9-]{1,63}(?<!-))*$/;

export interface HostTarget {
  host: string;
  port: number;
}

/**
 * Accepts a hostname, an IPv4 literal or a bracketed IPv6 literal. Paths,
 * schemes, credentials and ports-in-the-host are rejected outright so the value
 * can never become an SSRF pivot or a URL injection.
 */
export function parseHostTarget(input: unknown): HostTarget {
  if (typeof input !== "string") {
    throw new ValidationError("invalid_type", "host", "Host must be a string.");
  }

  let value = input.trim().toLowerCase();
  if (value.length === 0) {
    throw new ValidationError("required", "host", "A hostname is required.");
  }
  if (value.length > 253) {
    throw new ValidationError("too_long", "host", "Hostname must be 253 characters or fewer.");
  }
  if (value.includes("/") || value.includes("@") || value.includes("?") || value.includes("#")) {
    throw new ValidationError(
      "invalid_host",
      "host",
      "Enter a bare hostname, not a URL. Paths, credentials and query strings are not accepted.",
    );
  }

  let port = 443;
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end === -1) {
      throw new ValidationError("invalid_host", "host", "Bracketed IPv6 literal is not closed.");
    }
    const inner = value.slice(1, end);
    const rest = value.slice(end + 1);
    if (!/^[0-9a-f:]+$/.test(inner)) {
      throw new ValidationError("invalid_host", "host", "IPv6 literal contains invalid characters.");
    }
    if (rest) {
      if (!rest.startsWith(":")) {
        throw new ValidationError("invalid_host", "host", "Unexpected characters after the IPv6 literal.");
      }
      port = parsePort(rest.slice(1));
    }
    // The brackets are URL syntax, not part of the address. Node's socket API
    // wants the bare literal, so the brackets are stripped here rather than
    // being carried into the stored host.
    return { host: inner, port };
  }

  if (value.includes(":")) {
    const parts = value.split(":");
    if (parts.length !== 2) {
      throw new ValidationError("invalid_host", "host", "Only one port may be specified.");
    }
    port = parsePort(parts[1] ?? "");
    value = parts[0] ?? "";
  }

  if (!HOST_RE.test(value)) {
    throw new ValidationError(
      "invalid_host",
      "host",
      "That is not a valid hostname. Use letters, digits, hyphens and dots, for example example.com.",
    );
  }

  return { host: value, port };
}

function parsePort(raw: string): number {
  if (!/^\d{1,5}$/.test(raw)) {
    throw new ValidationError("invalid_port", "port", "Port must be 1 to 65535.");
  }
  const port = Number(raw);
  if (port < 1 || port > 65535) {
    throw new ValidationError("invalid_port", "port", "Port must be 1 to 65535.");
  }
  return port;
}

/* ------------------------------------------------------------------ *
 * Strings
 * ------------------------------------------------------------------ */

export function parseLabel(value: unknown, field = "label"): string {
  if (typeof value !== "string") {
    throw new ValidationError("invalid_type", field, `${field} must be a string.`);
  }
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) {
    throw new ValidationError("required", field, `${field} is required.`);
  }
  if (trimmed.length > 80) {
    throw new ValidationError("too_long", field, `${field} must be 80 characters or fewer.`);
  }
  // Control characters would corrupt the ledger's column alignment.
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new ValidationError("invalid_characters", field, `${field} contains control characters.`);
  }
  return trimmed;
}

export function parseNotes(value: unknown, field = "notes"): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new ValidationError("invalid_type", field, `${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 600) {
    throw new ValidationError("too_long", field, `${field} must be 600 characters or fewer.`);
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(trimmed)) {
    throw new ValidationError("invalid_characters", field, `${field} contains control characters.`);
  }
  return trimmed;
}

export function parseDecision(value: unknown): string {
  if (typeof value !== "string" || !DECISIONS.includes(value as never)) {
    throw new ValidationError(
      "invalid_enum",
      "decision",
      `decision must be one of: ${DECISIONS.join(", ")}.`,
    );
  }
  return value;
}

export function parseGrade(value: unknown): string {
  if (typeof value !== "string" || !GRADES.includes(value as never)) {
    throw new ValidationError("invalid_enum", "grade", `grade must be one of: ${GRADES.join(", ")}.`);
  }
  return value;
}

export function parseUuid(value: unknown, field = "id"): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new ValidationError("invalid_uuid", field, `${field} must be a UUID.`);
  }
  return value;
}

export function parseIdempotencyKey(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new ValidationError("invalid_type", "idempotencyKey", "idempotencyKey must be a string.");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 128) {
    throw new ValidationError("too_long", "idempotencyKey", "idempotencyKey must be 128 characters or fewer.");
  }
  return trimmed;
}

export function parseBoundedInt(
  value: unknown,
  field: string,
  options: { min: number; max: number; fallback?: number },
): number {
  if (value === undefined || value === null || value === "") {
    if (options.fallback !== undefined) return options.fallback;
    throw new ValidationError("required", field, `${field} is required.`);
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed)) {
    throw new ValidationError("invalid_type", field, `${field} must be a whole number.`);
  }
  if (parsed < options.min || parsed > options.max) {
    throw new ValidationError(
      "out_of_range",
      field,
      `${field} must be between ${options.min} and ${options.max}.`,
    );
  }
  return parsed;
}

export function parseNumber(
  value: unknown,
  field: string,
  options: { min: number; max: number; fallback?: number },
): number {
  if (value === undefined || value === null || value === "") {
    if (options.fallback !== undefined) return options.fallback;
    throw new ValidationError("required", field, `${field} is required.`);
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ValidationError("invalid_type", field, `${field} must be a number.`);
  }
  if (parsed < options.min || parsed > options.max) {
    throw new ValidationError(
      "out_of_range",
      field,
      `${field} must be between ${options.min} and ${options.max}.`,
    );
  }
  return parsed;
}

export function parseEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ValidationError("invalid_enum", field, `${field} must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

export function parseBoolean(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return fallback;
}