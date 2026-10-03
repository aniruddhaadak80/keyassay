/**
 * Append this build to the shared build history.
 *
 * The history is the record used to keep successive builds distinct, so it is
 * appended to rather than rewritten, and the rest of the file is left exactly as
 * it was.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const historyPath = join(homedir(), ".wow-repo-history.json");
const repository = "aniruddhaadak80/keyassay";

const history = JSON.parse(readFileSync(historyPath, "utf8"));
const builds = Array.isArray(history.builds) ? history.builds : [];

if (builds.some((entry) => entry.repository === repository)) {
  console.log(`${repository} is already recorded; nothing to do.`);
  process.exit(0);
}

const entry = {
  repository,
  concept:
    "A post-quantum migration triage office that assays a real public TLS endpoint and certifies the year its already-harvested traffic stops being confidential",
  persona:
    "Platform or security engineer who has to answer 'is this hostname safe to leave on RSA for another five years?' without access to an inventory or a quantum computer",
  coreEntity: "Assay certificate (a struck grade for one hostname under one horizon)",
  decisiveAction:
    "Assay a hostname live, read the itemised factors, move the confidentiality horizon, seal a migration decision, export the certificate, replay the chain",
  routeTopology: [
    "/",
    "/ledger",
    "/ledger/[id]",
    "/horizon",
    "/standards",
    "/agent",
    "/export",
    "/verify",
    "/settings",
  ],
  liveDataSource:
    "Direct TLS handshake to port 443 with X.509 chain and DER signature-OID parsing, crt.sh Certificate Transparency history, and arXiv metadata for the cited papers; every source carries a live or sealed-fallback label",
  persistenceModel:
    "Neon Postgres in production via DATABASE_URL; embedded PGlite for zero-config local development and the test suite; production refuses to start without a real connection string",
  engine:
    "keyassay/1.0.0: seven weighted factors summing to 1, with the Shor circuit cost of Gidney and Ekera plus Gidney's 2025 revision anchored to published physical-qubit counts and scaled by the visitor's stated growth rate, and exposure measured against the year data must stay secret rather than certificate expiry",
  agentWorkflow:
    "MCP JSON-RPC 2.0 with nine tools over one shared service layer: get_policy, list_assays, get_assay, assay_host, rename_assay, update_notes, record_decision, delete_assay (requires confirm), verify_integrity; mutating tools are idempotent on a key",
  visualMetaphor: "Assay office with a struck grade on a parchment certificate",
  palette: "Parchment, ultramarine, verdigris and retort orange",
  typographyLayout:
    "Fraunces display with Azeret Mono data labels, certificate rules and marginalia gutters",
  motionModel: "Stamp-and-reveal transitions with static reduced-motion equivalents",
  signatureInteraction:
    "The horizon dial: move the year the data must stay secret and every stored assay is re-rated through the same engine, with the stored measurement left untouched",
  repoUrl: "https://github.com/aniruddhaadak80/keyassay",
  liveUrl: "https://keyassay.vercel.app",
  completionDate: "2026-10-03",
  signature: {
    problemDomain:
      "Post-quantum migration readiness and harvest-now-decrypt-later exposure for public TLS endpoints",
    primaryPersona:
      "Engineer deciding whether a hostname's key can stay in service past its expiry",
    coreEntity: "Assay certificate for one hostname under one horizon",
    decisiveUserAction:
      "Assay, read the arithmetic, move the horizon, seal a decision, export, verify, delete",
    routeAndInformationTopology:
      "Landing + ledger + dynamic certificate + horizon dial + standards with live citation check + agent console + export + settings + integrity replay",
    liveDataSource:
      "Live TLS handshake, crt.sh and arXiv, all key-free, with per-source live or fallback labelling",
    deterministicDecisionModel:
      "Seven weighted explainable factors plus a confidentiality-horizon exposure model anchored to published quantum cost estimates",
    agentWorkflow:
      "JSON-RPC read, live analysis, idempotent mutation, sealed decision and integrity verification through nine typed tools",
    visualMetaphor: "Assay office with a struck grade on a parchment certificate",
    paletteAndContrast:
      "Parchment ground with ultramarine, verdigris and retort accents; WCAG AA on all text",
    typographyAndLayoutRhythm:
      "Fraunces with Azeret Mono, certificate rules and marginalia gutters",
    signatureInteractionOrMotionBehavior:
      "Horizon dial that persists a year and re-rates every stored assay without mutating the stored measurement",
  },
  verification: {
    typecheck: "pass",
    lint: "pass",
    unitTests: "99 passed across 5 files",
    build: "pass",
    ci: "GitHub Actions green: typecheck, lint, 99 tests, production build, and the browser journey against a real Postgres service",
    liveVerifier: "77 of 77 passed against https://keyassay.vercel.app",
    persistence:
      "neon-postgres confirmed by /api/health (SELECT 1 succeeded, productionStore true, durable true)",
    feed: "live TLS handshake, crt.sh and arXiv confirmed with per-source live or fallback labelling",
    mcp: "initialize, tools/list with nine schemas, live assay_host tool, idempotent retry, sealed decision and refusal without confirm",
    integrity: "per-entity SHA-384 chain replays clean; tombstones retained after deletion; cross-session reads return 404",
    export: "self-contained HTML, JSON and CSV certificates download carrying the seal and every citation",
    browserTests: "6 Playwright journeys passed against production on desktop and mobile, zero console errors",
    screenshots: "6 captured from the live deployment by scripts/capture-screenshots.mjs",
    repository: "https://github.com/aniruddhaadak80/keyassay returns 200",
    notableBugsFoundAndFixed: [
      "/ledger issued five parallel queries against a four-connection pool, so a serverless cold start could render the error boundary instead of the page",
      "/horizon re-fetched every ledger row individually after listing them, an N+1 on the same small pool",
      "Landing and standards copy rendered as mojibake after an edit pass round-tripped two files through a Windows code page",
      "SECURITY.md named an address nobody receives and promised response times a single maintainer cannot keep",
      "The CI browser job opted into embedded PGlite under next start, which crashes a bundled production server",
      "Async server components suspended on a third-party API, and React's RSC client failed the stream with an internal error whenever arXiv was slow",
      "The database adapter forced TLS on any URL that did not say sslmode=disable, so a stock Postgres was unreachable",
      "The browser suite counted headings before the streamed shell arrived and reported a working page as having no h1",
    ],
  },
};

builds.push(entry);
history.builds = builds;
writeFileSync(historyPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
console.log(`Recorded ${repository}. History now holds ${builds.length} builds.`);