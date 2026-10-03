import { NextResponse } from "next/server";
import { HttpError } from "./errors";
import { ValidationError } from "./validation";
import type { ApiError } from "./types";

/**
 * One error envelope for the whole API surface.
 *
 * Routes never return a stack trace, an environment variable or a raw driver
 * message. Unexpected errors become a generic 500 with a correlation id, and the
 * detail is logged server-side only.
 */

export function ok<T>(data: T, status = 200, headers?: HeadersInit): NextResponse {
  return NextResponse.json(data, { status, headers });
}

export function fail(
  code: string,
  message: string,
  status: number,
  details?: unknown,
): NextResponse<ApiError> {
  return NextResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });
}

export function notFound(message = "Resource not found in this session."): NextResponse<ApiError> {
  return fail("not_found", message, 404);
}

/**
 * Translate a thrown value into a response.
 *
 * Validation problems are the caller's fault (400), a probe failure is upstream's
 * (502), and anything unrecognised is ours (500) without leaking internals.
 */
export function fromError(error: unknown): NextResponse<ApiError> {
  if (error instanceof ValidationError) {
    return fail(error.code, error.message, 400, { field: error.field });
  }
  if (error instanceof HttpError) {
    return fail(error.code, error.message, error.status, { field: error.field });
  }
  if (error instanceof Error) {
    const code = (error as Error & { code?: string }).code;
    if (code === "not_found") {
      return notFound(error.message);
    }
    if (
      code === "dns_failure" ||
      code === "connection_refused" ||
      code === "timeout" ||
      code === "tls_error" ||
      code === "no_certificate" ||
      code === "connect_failed" ||
      code === "ct_unavailable" ||
      code === "ct_timeout" ||
      code === "ct_malformed" ||
      code === "ct_error"
    ) {
      return fail(code, error.message, 502, { upstream: true });
    }
    console.error("[keyassay] unhandled route error:", error.message);
    return fail("internal_error", "Something went wrong handling that request.", 500);
  }
  return fail("internal_error", "Something went wrong handling that request.", 500);
}

/** Wrap a route handler so no exception escapes as a raw stack trace. */
export async function route<T>(
  handler: () => Promise<NextResponse<T> | NextResponse<ApiError>>,
): Promise<NextResponse<T> | NextResponse<ApiError>> {
  try {
    return await handler();
  } catch (error) {
    return fromError(error);
  }
}

export function parsePagination(url: URL): { limit: number; offset: number } {
  const rawLimit = url.searchParams.get("limit");
  const rawOffset = url.searchParams.get("offset");
  const limit = rawLimit === null ? 25 : Number(rawLimit);
  const offset = rawOffset === null ? 0 : Number(rawOffset);
  return {
    limit: Number.isInteger(limit) ? Math.min(100, Math.max(1, limit)) : 25,
    offset: Number.isInteger(offset) ? Math.min(10_000, Math.max(0, offset)) : 0,
  };
}