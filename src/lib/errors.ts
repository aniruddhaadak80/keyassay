/**
 * A domain error that carries its own HTTP status.
 *
 * Used where a plain Error would lose the distinction between "the caller sent
 * something wrong" (400) and "an upstream service failed" (502), so routes can
 * map failures honestly without string matching.
 */
export class HttpError extends Error {
  readonly code: string;
  readonly field: string;
  readonly status: number;

  constructor(code: string, message: string, status: number, field = "") {
    super(message);
    this.name = "HttpError";
    this.code = code;
    this.field = field;
    this.status = status;
  }
}

export class ConflictError extends HttpError {
  constructor(message: string) {
    super("conflict", message, 409);
    this.name = "ConflictError";
  }
}

export class UpstreamError extends HttpError {
  constructor(code: string, message: string) {
    super(code, message, 502);
    this.name = "UpstreamError";
  }
}