import { sslForUrl } from "@/lib/db/pg";

/**
 * Connection-string handling for the hosted adapter.
 *
 * These cases are cheap to get wrong and expensive to discover: a self-hosted
 * Postgres with TLS switched off is the normal case for a CI job or a laptop,
 * and forcing TLS on it fails every query with a connection error that looks
 * like a database outage rather than a TLS mismatch.
 */

describe("sslForUrl", () => {
  it("leaves the default to the driver, so a server without TLS still connects", () => {
    expect(sslForUrl("postgresql://postgres:postgres@127.0.0.1:5432/keyassay")).toBeUndefined();
    expect(sslForUrl("postgres://user:pw@db.internal:5432/app")).toBeUndefined();
  });

  it("treats prefer as the driver default", () => {
    expect(sslForUrl("postgresql://u:p@h:5432/d?sslmode=prefer")).toBeUndefined();
  });

  it("honours an explicit disable", () => {
    expect(sslForUrl("postgresql://u:p@h:5432/d?sslmode=disable")).toBe(false);
  });

  it("encrypts without verifying the chain when the mode only requires TLS", () => {
    expect(sslForUrl("postgresql://u:p@h:5432/d?sslmode=require")).toEqual({
      rejectUnauthorized: false,
    });
  });

  it("verifies the chain for the verifying modes", () => {
    for (const mode of ["verify-ca", "verify-full"]) {
      expect(sslForUrl(`postgresql://u:p@h:5432/d?sslmode=${mode}`)).toEqual({
        rejectUnauthorized: true,
      });
    }
  });

  it("reads the mode wherever it appears in the query string", () => {
    expect(sslForUrl("postgresql://u:p@h:5432/d?application_name=keyassay&sslmode=disable")).toBe(false);
    expect(sslForUrl("postgresql://u:p@h:5432/d?sslmode=require&application_name=keyassay")).toEqual({
      rejectUnauthorized: false,
    });
  });

  it("ignores an unrecognised mode rather than silently downgrading", () => {
    expect(sslForUrl("postgresql://u:p@h:5432/d?sslmode=nonsense")).toEqual({
      rejectUnauthorized: true,
    });
  });

  it("reads the mode from the password-free form used by pooled providers", () => {
    // Neon and other pooled providers append sslmode to the path-less form.
    expect(sslForUrl("postgresql://u:p@h/db?sslmode=require")).toEqual({
      rejectUnauthorized: false,
    });
  });
});