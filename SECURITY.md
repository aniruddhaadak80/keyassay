# Security policy

## Scope

Keyassay reads public TLS endpoints and public Certificate Transparency records. It accepts anonymous
write requests, so there are three things worth reporting.

| Class | Examples | Route |
| --- | --- | --- |
| Vulnerabilities | Session ownership bypass, cross-session data exposure, seal forgery, injection, SSRF | Private disclosure below |
| Abuse resistance | Write flooding, resource exhaustion, scraping | Private disclosure below |
| Wrong results | A published citation that does not say what the engine claims | Public issue |

## Reporting a vulnerability

Report privately through GitHub's security advisory form for this repository:

**Report a vulnerability** → <https://github.com/aniruddhaadak80/keyassay/security/advisories/new>

Include a description, steps to reproduce, and the impact you believe it has. Do not open a public
issue for anything in the first two classes above.

This is a single-maintainer project with no response-time commitment. If a report is not fixed, you are
free to disclose it publicly; please open an issue at the same time so the record exists.

## What is already handled

- **Ownership.** Every record is scoped to an unguessable v4 UUID in an HTTP-only, SameSite=Lax cookie.
  A record belonging to another session returns `404`, not `403`, so the existence of another
  visitor's data is never disclosed.
- **Cookie transport.** `Secure` is derived from the request's actual protocol, not from
  `NODE_ENV`, so a production-mode server reached over plain HTTP does not set a cookie the client
  must discard.
- **Destructive operations.** `DELETE` is a tombstone that appends its own signed event, and the MCP
  `delete_assay` tool additionally requires `confirm: true`.
- **Input.** Hostnames are parsed, not interpolated: schemes, paths, credentials and ports-in-host are
  rejected, which removes the obvious SSRF and URL-injection vectors. Strings and enum values are
  length- and set-bounded. All SQL is parameterised.
- **Error responses.** No stack traces, environment variables or driver messages reach a client.
- **Rate limiting.** A per-process token bucket guards write routes. This is best-effort on
  serverless: each container keeps its own bucket, so a deployment that needs a hard limit should put a
  hosted rate limiter or WAF rule in front of `/api`.

## Known limits

- The per-process rate limiter does not bound a coordinated, distributed flood. Treat it as a speed
  bump, not a control.
- The engine models the cost of breaking a public key. It cannot see implementation bugs, traffic
  analysis, weak randomness, or operational mistakes.
- Break years are outputs of a stated growth assumption. They are not predictions, and they should
  never be quoted as one.