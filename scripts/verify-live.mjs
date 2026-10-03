#!/usr/bin/env node
/**
 * Live end-to-end verifier.
 *
 * Runs against a deployed production alias over real HTTP and proves the whole
 * product works outside the developer's machine: the store is durable, the live
 * sources answer, the CRUD loop round-trips, the engine returns a versioned
 * itemised result, the MCP endpoint initialises and mutates through the same
 * service layer as the interface, the seal chain replays, the record can be
 * deleted, and the repository link is actually present in the rendered HTML.
 *
 * Usage:
 *   BASE_URL=https://<alias>.vercel.app node scripts/verify-live.mjs
 *   BASE_URL=... node scripts/verify-live.mjs --keep     # leave the test record
 *
 * No secrets are read or embedded. Only the base URL comes from the environment.
 */

import { createHash } from "node:crypto";

const BASE = (process.env.BASE_URL ?? "").replace(/\/+$/, "");
const KEEP = process.argv.includes("--keep");

if (!BASE) {
  console.error("BASE_URL is required. Example:");
  console.error("  BASE_URL=https://example.vercel.app node scripts/verify-live.mjs");
  process.exit(2);
}

const REPO_URL = "https://github.com/aniruddhaadak80/keyassay";
const TEST_HOST = "github.com";
/** The revised factoring-cost paper the engine cites, used to exercise the citation form. */
const GIDNEY_2025_ARXIV = "2505.15917";

/**
 * A minimal cookie jar.
 *
 * Ownership is an anonymous HTTP-only cookie, and Node's fetch has no cookie
 * store, so without this every request would arrive as a different session and
 * the read-back steps would all 404. This mirrors what a browser does.
 */
const jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function absorbCookies(response) {
  const headers =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
  for (const raw of headers) {
    const [pair] = raw.split(";");
    const index = pair.indexOf("=");
    if (index > 0) {
      jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }
}

/** Cookie-aware GET/POST/PATCH/DELETE against the application. */
async function http(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  const cookies = cookieHeader();
  if (cookies) headers.cookie = cookies;
  const response = await fetch(`${BASE}${path}`, { ...options, headers, redirect: "follow" });
  absorbCookies(response);
  return response;
}

/** A request with no cookies at all, used to prove session isolation. */
async function httpAnonymous(path) {
  return fetch(`${BASE}${path}`);
}

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

async function rpc(method, params) {
  const response = await http(`/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Math.floor(Math.random() * 1e6), method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

async function main() {
  console.log(`Verifying ${BASE}\n${"=".repeat(64)}`);

  /* ---------------------------------------------------------------- *
   * 1. Landing and primary routes
   * ---------------------------------------------------------------- */
  section("Routes");
  const landing = await http(`/`);
  await landing.text();  check("GET / returns 200", landing.status === 200, `got ${landing.status}`);

  for (const path of ["/ledger", "/horizon", "/standards", "/agent", "/export", "/verify", "/settings"]) {
    const response = await http(`${path}`);
    check(`GET ${path} returns 200`, response.status === 200, `got ${response.status}`);
  }

  /* ---------------------------------------------------------------- *
   * 2. Health: the real production store
   * ---------------------------------------------------------------- */
  section("Persistence");
  const health = await http(`/api/health`);
  const healthBody = await health.json();
  check("GET /api/health returns 200", health.status === 200, `got ${health.status}`);
  check("health reports a durable production store", healthBody.durable === true, JSON.stringify(healthBody));
  check(
    "health probe executed a real query",
    typeof healthBody.detail === "string" && healthBody.detail.includes("SELECT 1 succeeded"),
    String(healthBody.detail),
  );

  /* ---------------------------------------------------------------- *
   * 3. Live sources
   * ---------------------------------------------------------------- */
  section("Live data");
  const standards = await http(`/api/standards?limit=3`);
  const standardsBody = await standards.json();
  check("GET /api/standards returns 200", standards.status === 200);
  check(
    "engine citations are reported, one per paper",
    Array.isArray(standardsBody.verification) && standardsBody.verification.length === 2,
    JSON.stringify(standardsBody.verification),
  );

  // The arbitrary-citation endpoint is driven by the form on /standards, so it
  // is verified for real rather than assumed to work because the route exists.
  const citeBad = await http("/api/standards", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ arxivId: "not-an-id" }),
  });
  check("POST /api/standards rejects a malformed identifier", citeBad.status === 400);

  const citeReal = await http("/api/standards", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ arxivId: GIDNEY_2025_ARXIV }),
  });
  const citeBody = await citeReal.json();
  check(
    "POST /api/standards verifies a real identifier",
    citeReal.status === 200 &&
      citeBody.verification?.arxivId === GIDNEY_2025_ARXIV &&
      typeof citeBody.verification?.found === "boolean" &&
      typeof citeBody.verification?.url === "string",
    JSON.stringify(citeBody.verification),
  );
  check(
    "a verified citation reports a title or an explicit reason",
    Boolean(citeBody.verification?.title) || Boolean(citeBody.verification?.reason),
  );
  check(
    "each citation carries an explicit live or fallback status",
    (standardsBody.verification ?? []).every(
      (entry) => entry.status === "live" || entry.status === "fallback",
    ),
  );
  // arXiv is a free service that rate-limits by IP. When it answers, the
  // citations must genuinely resolve; when it does not, the product must say so
  // rather than assert a stale match.
  const arxivLive = (standardsBody.verification ?? []).filter((entry) => entry.status === "live");
  if (arxivLive.length === 0) {
    console.log(
      `  NOTE  arXiv is unreachable right now (${standardsBody.verification?.[0]?.reason ?? "rate limited"});` +
        " the endpoint reported it as a labelled fallback rather than a verification.",
    );
  }
  check(
    "when arXiv answers, the cited papers are found and match",
    arxivLive.length === 0 || arxivLive.every((entry) => entry.found === true && entry.titleMatches === true),
    JSON.stringify((standardsBody.verification ?? []).map((entry) => ({ id: entry.arxivId, found: entry.found, match: entry.titleMatches }))),
  );

  const engineLive = await http(`/api/engine`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ host: TEST_HOST }),
  });
  const engineLiveBody = await engineLive.json();
  check("live handshake through POST /api/engine", engineLive.status === 200, `got ${engineLive.status}`);
  check(
    "observation came from a live TLS handshake",
    engineLiveBody?.observation?.protocol === "TLSv1.3" || engineLiveBody?.observation?.protocol === "TLSv1.2",
    String(engineLiveBody?.observation?.protocol),
  );
  check("certificate chain was read", (engineLiveBody?.observation?.chain?.length ?? 0) > 0);

  /* ---------------------------------------------------------------- *
   * 4. CRUD through the public API
   * ---------------------------------------------------------------- */
  section("CRUD");
  const created = await http(`/api/assays`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ host: TEST_HOST, label: "live-verifier", idempotencyKey: `verify-${Date.now()}` }),
  });
  const createdBody = await created.json();
  const assay = createdBody.assay;
  check("POST /api/assays created a record", created.status === 201, `got ${created.status}`);
  check("record has a grade", typeof assay?.grade === "string", JSON.stringify(assay?.grade));
  check("record has a score in 0..100", assay?.score >= 0 && assay?.score <= 100, String(assay?.score));
  check("record carries a 96-hex seal", /^[0-9a-f]{96}$/.test(assay?.seal ?? ""), String(assay?.seal));
  check(
    "TLS source is marked live",
    assay?.tls?.status === "live",
    `${assay?.tls?.status}: ${assay?.tls?.meta?.fallbackReason ?? "no reason"}`,
  );

  const id = assay?.id;
  const readBack = await http(`/api/assays/${id}`);
  const readBody = await readBack.json();
  check("GET read-back returns the record", readBack.status === 200 && readBody.assay.id === id);
  check("read-back persisted the engine result", (readBody.assay.result?.factors?.length ?? 0) === 7);
  check(
    "read-back preserved the Certificate Transparency provenance",
    typeof readBody.assay.ct?.meta?.source === "string",
  );

  const patched = await http(`/api/assays/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label: "live-verifier-renamed", notes: "Recorded by verify-live." }),
  });
  const patchedBody = await patched.json();
  check("PATCH updated the label", patched.status === 200 && patchedBody.assay.label === "live-verifier-renamed");
  check("PATCH advanced the seal", patchedBody.assay.seal !== assay.seal);

  /* ---------------------------------------------------------------- *
   * 5. Engine: versioned, itemised, sealed
   * ---------------------------------------------------------------- */
  section("Engine");
  const engineSingle = await http(`/api/engine?key=rsa&bits=2048`);
  const engineSingleBody = await engineSingle.json();
  check("GET /api/engine returns a versioned cost", typeof engineSingleBody.engineVersion === "string");
  check(
    "RSA-2048 cost reproduces the published 1M-quote anchor",
    engineSingleBody.cost?.physicalQubits === 1_000_000,
    String(engineSingleBody.cost?.physicalQubits),
  );
  check(
    "cost cites its published source",
    typeof engineSingleBody.cost?.citation === "string" && engineSingleBody.cost.citation.includes("arXiv"),
  );

  const factorSum = (assay.result?.factors ?? []).reduce(
    (sum, factor) => sum + factor.weight,
    0,
  );
  check("factor weights sum to 1", Math.abs(factorSum - 1) < 1e-9, String(factorSum));
  check(
    "every factor carries evidence and a citation",
    (assay.result?.factors ?? []).every((factor) => factor.evidence && factor.citation),
  );
  check("exposure carries a verification reference", typeof assay.result?.exposure?.breakYear === "number");

  /* ---------------------------------------------------------------- *
   * 6. MCP
   * ---------------------------------------------------------------- */
  section("Agent interface");
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
  check("MCP initialize succeeds", typeof init?.protocolVersion === "string", JSON.stringify(init));
  check("MCP server identifies itself", init?.serverInfo?.name === "Keyassay");

  const listed = await rpc("tools/list", {});
  const toolNames = (listed?.tools ?? []).map((tool) => tool.name).sort();
  check(
    "tools/list returns the expected catalogue",
    ["assay_host", "delete_assay", "export_certificate", "get_assay", "get_policy", "list_assays", "record_decision", "rerate_assay", "verify_integrity"].every(
      (name) => toolNames.includes(name),
    ),
    toolNames.join(","),
  );
  check(
    "every tool publishes an input schema",
    (listed?.tools ?? []).every((tool) => tool.inputSchema?.type === "object"),
  );

  const policyRead = await rpc("tools/call", { name: "get_policy", arguments: {} });
  check("get_policy tool returns the active policy", typeof policyRead?.structuredContent?.policy?.horizonYear === "number");

  const listedTools = await rpc("tools/call", { name: "list_assays", arguments: { limit: 5 } });
  check("list_assays tool sees the session ledger", Array.isArray(listedTools?.structuredContent?.items));

  /* -- MCP mutation through the same service layer ------------------ */
  const idempotencyKey = `mcp-verify-${Date.now()}`;
  const agentAssay = await rpc("tools/call", {
    name: "assay_host",
    arguments: { host: TEST_HOST, label: "created-by-agent", idempotency_key: idempotencyKey },
  });
  const agentRecord = agentAssay?.structuredContent;
  check("assay_host tool performed a live scan", typeof agentRecord?.grade === "string", JSON.stringify(agentAssay?.content?.[0]?.text?.slice(0, 160)));
  check("assay_host tool returned a seal", /^[0-9a-f]{96}$/.test(agentRecord?.seal ?? ""));

  const agentId = agentRecord?.id;
  const agentRead = await rpc("tools/call", { name: "get_assay", arguments: { id: agentId, include_events: true } });
  check(
    "MCP mutation persisted and is readable through the tool",
    agentRead?.structuredContent?.assay?.id === agentId,
  );
  check("audit events are attached", (agentRead?.structuredContent?.events?.length ?? 0) >= 1);

  // Idempotency: the same key must not create a second record.
  const replay = await rpc("tools/call", {
    name: "assay_host",
    arguments: { host: TEST_HOST, label: "created-by-agent", idempotency_key: idempotencyKey },
  });
  check("idempotency key returned the original assay", replay?.structuredContent?.id === agentId);

  const decision = await rpc("tools/call", {
    name: "record_decision",
    arguments: { id: agentId, decision: "plan-hybrid" },
  });
  check("record_decision sealed a verdict", decision?.structuredContent?.decision === "plan-hybrid");

  const refused = await http(`/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "delete_assay", arguments: { id: agentId } },
    }),
  });
  const refusedBody = await refused.json();
  check(
    "destructive tool refuses without confirm",
    refusedBody?.result?.isError === true,
    JSON.stringify(refusedBody).slice(0, 200),
  );

  /* ---------------------------------------------------------------- *
   * 7. Integrity
   * ---------------------------------------------------------------- */
  section("Integrity");
  const verified = await http(`/api/assays/${id}/verify`);
  const verifiedBody = await verified.json();
  check("seal chain replays clean", verifiedBody.replay?.ok === true, JSON.stringify(verifiedBody.replay));
  check("replay checked more than one event", (verifiedBody.replay?.eventsChecked ?? 0) > 1);
  check("chain head matches the stored seal", verifiedBody.replay?.headSeal === patchedBody.assay.seal);

  // Recompute the chain independently from the returned events.
  const events = (await (await http(`/api/assays/${id}`)).json()).events ?? [];
  const independent = replayChain(events);
  check(
    "chain recomputed independently by the verifier matches",
    independent.ok === true,
    independent.reason ?? "",
  );
  check("independent head matches the API head", independent.head === verifiedBody.replay?.headSeal);

  /* ---------------------------------------------------------------- *
   * 8. Policy and re-rate
   * ---------------------------------------------------------------- */
  section("Policy");
  const policyBefore = await http(`/api/policy`);
  const policyBeforeBody = await policyBefore.json();
  const originalHorizon = policyBeforeBody.policy.horizonYear;

  const policyAfter = await http(`/api/policy`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ horizonYear: 2032 }),
  });
  const policyAfterBody = await policyAfter.json();
  check("PATCH /api/policy persisted the horizon", policyAfterBody.policy.horizonYear === 2032);
  check(
    "policy change re-rated the ledger",
    Array.isArray(policyAfterBody.rerated) && policyAfterBody.rerated.length > 0,
  );
  const stillExists = await http(`/api/assays/${id}`);
  check(
    "re-rating did not modify the stored measurement",
    (await stillExists.json()).assay.score === patchedBody.assay.score,
  );

  await http(`/api/policy`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ horizonYear: originalHorizon }),
  });

  /* ---------------------------------------------------------------- *
   * 9. Export artifact
   * ---------------------------------------------------------------- */
  section("Export");
  for (const format of ["json", "html", "csv"]) {
    const response = await http(`/api/assays/${id}/certificate?format=${format}`);
    const body = await response.text();
    check(
      `certificate exports as ${format}`,
      response.status === 200 && body.length > 200,
      `status ${response.status}, ${body.length} bytes`,
    );
  }

  const ledgerExport = await http(`/api/export?format=json`);
  const ledgerBody = await ledgerExport.json();
  check(
    "ledger export contains the record with its certificate",
    ledgerExport.status === 200 &&
      (ledgerBody.assays ?? []).some((entry) => entry.id === id && entry.certificate),
  );

  /* ---------------------------------------------------------------- *
   * 10. Delete and confirm the tombstone
   * ---------------------------------------------------------------- */
  section("Deletion");
  const deleted = await http(`/api/assays/${id}`, { method: "DELETE" });
  const deletedBody = await deleted.json();
  check("DELETE returned 200", deleted.status === 200, `got ${deleted.status}`);
  check("record is tombstoned, not erased", Boolean(deletedBody.deletedAt));

  const afterDelete = await http(`/api/assays/${id}`);
  const afterDeleteBody = await afterDelete.json();
  check("tombstoned record is still readable", afterDelete.status === 200);
  check("tombstoned record has deletedAt set", Boolean(afterDeleteBody.assay.deletedAt));

  const listAfterDelete = await http(`/api/assays`);
  const listBody = await listAfterDelete.json();
  check(
    "tombstoned record left the active ledger",
    !(listBody.items ?? []).some((entry) => entry.id === id),
  );

  const verifyAfterDelete = await http(`/api/assays/${id}/verify`);
  const verifyAfterBody = await verifyAfterDelete.json();
  check("chain still replays after deletion", verifyAfterDelete.status === 200 && verifyAfterBody.replay.ok === true);

  // Clean up the agent-created record too.
  await http(`/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 99,
      method: "tools/call",
      params: { name: "delete_assay", arguments: { id: agentId, confirm: true } },
    }),
  });

  /* ---------------------------------------------------------------- *
   * 11. Session isolation
   * ---------------------------------------------------------------- */
  section("Session isolation");
  const withoutCookie = await httpAnonymous(`/api/assays/${agentId}`);
  check(
    "a session without the cookie cannot read another session's record",
    withoutCookie.status === 404,
    `got ${withoutCookie.status}`,
  );
  const withoutCookieList = await httpAnonymous(`/api/assays`);
  const anonymousBody = await withoutCookieList.json();
  check(
    "a session without the cookie sees an empty ledger",
    (anonymousBody.items ?? []).length === 0,
    `${(anonymousBody.items ?? []).length} items visible`,
  );

  /* ---------------------------------------------------------------- *
   * 12. Repository link is actually rendered
   * ---------------------------------------------------------------- */
  section("Repository access");
  for (const path of ["/", "/ledger", "/agent"]) {
    const html = await (await http(`${path}`)).text();
    const escaped = REPO_URL.replace(/:/g, "\\:");
    check(`${path} renders the repository URL`, html.includes(REPO_URL) || html.includes(escaped));
    check(`${path} renders visible repository text`, /Star on GitHub|View source/.test(html));
  }

  const repoResponse = await fetch(REPO_URL, {
    headers: { "user-agent": "keyassay-live-verifier" },
  });
  check("the repository URL returns 200", repoResponse.status === 200, `got ${repoResponse.status}`);

  const manifest = await http(`/mcp.json`);
  const manifestBody = await manifest.json();
  check("mcp.json is served", manifest.status === 200);
  check(
    "mcp.json publishes a reachable endpoint",
    typeof manifestBody?.endpoint === "string" && manifestBody.endpoint.startsWith(BASE),
    String(manifestBody?.endpoint),
  );
  check("mcp.json lists tools", Array.isArray(manifestBody?.tools) && manifestBody.tools.length >= 3);

  /* ---------------------------------------------------------------- *
   * Summary
   * ---------------------------------------------------------------- */
  console.log(`\n${"=".repeat(64)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const failure of failures) console.log(`  - ${failure}`);
  }
  if (!KEEP) {
    console.log("\n(Test records were tombstoned during the run.)");
  }
  process.exit(failed === 0 ? 0 : 1);
}

/**
 * Independent SHA-384 chain recomputation, written here rather than imported
 * from the application so the verifier is a genuine second opinion.
 */
function replayChain(events) {
  const genesis = "keyassay/genesis/1";
  let previous = genesis;
  for (const event of events) {
    if (event.prevSeal !== previous) {
      return { ok: false, reason: `seq ${event.seq}: prevSeal mismatch`, head: previous };
    }
    const body = canonicalJson({
      entityId: event.entityId,
      entityKind: "assay",
      seq: event.seq,
      eventType: event.eventType,
      payload: event.payload,
      createdAt: event.createdAt,
    });
    const expected = createHash("sha384").update(previous + body, "utf8").digest("hex");
    if (expected !== event.seal) {
      return { ok: false, reason: `seq ${event.seq}: seal mismatch`, head: previous };
    }
    previous = event.seal;
  }
  return { ok: true, reason: null, head: previous };
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "number") return JSON.stringify(value);
  if (typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

main().catch((error) => {
  console.error("\nVerifier crashed:", error);
  process.exit(1);
});