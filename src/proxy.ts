import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-constants";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Session ownership is established here, in the proxy (Next.js 16's successor to
 * middleware), and nowhere else.
 *
 * Next.js forbids writing a cookie during a Server Component render, so a page
 * that lazily created the session would 500 on the visitor's first request. The
 * proxy runs before rendering and can set the cookie on both the request and the
 * response, so the page render and every later API call share one session from
 * the first request onwards.
 *
 * The value is an unguessable v4 UUID. It is the ownership boundary for every
 * assay, so it is httpOnly and SameSite=Lax.
 */
export function proxy(request: NextRequest): NextResponse {
  const existing = request.cookies.get(SESSION_COOKIE)?.value;
  if (existing && UUID_RE.test(existing)) {
    return NextResponse.next();
  }

  const id = crypto.randomUUID();
  const headers = new Headers(request.headers);
  headers.set("cookie", `${SESSION_COOKIE}=${id}`);

  /**
   * `Secure` is derived from the request's actual protocol, not from
   * NODE_ENV. Deciding it from the environment looks equivalent but is not: a
   * production-mode server reached over plain HTTP would set a Secure cookie
   * that the client is required to discard, and every subsequent request would
   * arrive as a new anonymous session with an empty ledger. Reading the
   * forwarded protocol keeps HTTPS deployments secure and keeps a local
   * production-mode run usable.
   */
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const isHttps = forwardedProto
    ? forwardedProto.split(",")[0]?.trim() === "https"
    : request.nextUrl.protocol === "https:";

  const response = NextResponse.next({ request: { headers } });
  response.cookies.set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    secure: isHttps,
  });
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:woff2?|png|svg|jpg|jpeg|gif|ico|txt|xml)$).*)",
  ],
};