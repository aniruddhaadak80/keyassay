import { type NextResponse, type NextRequest } from "next/server";
import { fail, ok, route } from "@/lib/api-helpers";
import {
  breakYearFor,
  costFor,
  logicalQubitsForModulus,
  runAssay,
  toffolisForModulus,
  ENGINE_VERSION,
} from "@/lib/engine/assay";
import { ASSAY_ENGINE_CITATIONS, DEFAULT_POLICY } from "@/lib/engine/assay";
import { COST_MODELS } from "@/lib/engine/constants";
import { parseBoundedInt, parseEnum, parseNumber } from "@/lib/validation";
import { probeTls } from "@/lib/sources/tls";
import { fetchCertificateTransparency } from "@/lib/sources/ct";
import type { CtSummary, TlsObservation } from "@/lib/types";

/**
 * /api/engine — the deterministic engine, exposed.
 *
 * Two modes:
 *   ?key=rsa&bits=2048          the quantum break cost for one algorithm
 *   POST { tls, ct }            run the whole engine against a supplied observation
 *
 * The engine is a pure function, so this route adds no behaviour of its own: it
 * validates the input and returns exactly what the UI and the agent get.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALGORITHMS = ["rsa", "ec", "ed25519"] as const;
const COST_MODELS_IDS = ["gidney-ekera-2019", "gidney-2025"] as const;

export async function GET(request: NextRequest): Promise<NextResponse> {
  return await route(async () => {
    const params = request.nextUrl.searchParams;
    const algorithm = params.get("key");
    const engineVersion = ENGINE_VERSION;

    if (!algorithm) {
      return ok({
        engineVersion,
        policy: DEFAULT_POLICY,
        costModels: COST_MODELS,
        citations: ASSAY_ENGINE_CITATIONS,
        usage: {
          singleKey: "/api/engine?key=rsa&bits=2048",
          fullAssay: "POST /api/engine with { tls, ct }",
          liveAssay: "POST /api/assays with { host }",
        },
      });
    }

    const parsedAlgorithm = parseEnum(algorithm, "key", ALGORITHMS, "rsa");
    const bits = parseBoundedInt(params.get("bits") ?? "", "bits", { min: 256, max: 32768 });
    const curve = params.get("curve");
    const horizonYear = parseBoundedInt(params.get("horizonYear") ?? "", "horizonYear", {
      min: 2026,
      max: 2200,
      fallback: DEFAULT_POLICY.horizonYear,
    });
    const costModel = parseEnum(
      params.get("costModel") ?? "",
      "costModel",
      COST_MODELS_IDS,
      DEFAULT_POLICY.costModel,
    );
    const capabilityGrowth = parseNumber(params.get("capabilityGrowth") ?? "", "capabilityGrowth", {
      min: 0.01,
      max: 5,
      fallback: DEFAULT_POLICY.capabilityGrowth,
    });

    const policy = { ...DEFAULT_POLICY, horizonYear, costModel, capabilityGrowth };
    const cost = costFor(
      { algorithm: parsedAlgorithm, bits, curve: curve ?? null, postQuantum: false },
      policy,
    );

    return ok({
      engineVersion,
      policy,
      cost,
      breakYear: breakYearFor(cost.effectiveRsaBits ?? 2048, policy),
      abstractCircuit: {
        logicalQubits: logicalQubitsForModulus(cost.effectiveRsaBits ?? 2048),
        toffolis: toffolisForModulus(cost.effectiveRsaBits ?? 2048),
      },
      citations: ASSAY_ENGINE_CITATIONS,
    });
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return await route(async () => {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return fail("invalid_json", "Request body must be valid JSON.", 400);
    }

    // Convenience: a bare { host } runs the real handshake, so the engine can be
    // exercised end to end without a browser.
    if (body.tls === undefined && typeof body.host === "string") {
      const observation = await probeTls(body.host, 443);
      let ctSummary: CtSummary = {
        domain: observation.host,
        certificateCount: 0,
        recentCount: 0,
        distinctIssuers: [],
        longestValidityDays: 0,
        certificatesBeyond2030: 0,
        certificatesBeyond2035: 0,
        historyDays: 0,
        sampledIds: [],
      };
      let ctStatus: "live" | "fallback" = "fallback";
      try {
        const fetched = await fetchCertificateTransparency(observation.host, {
          deprecateYear: DEFAULT_POLICY.deprecateYear,
          disallowYear: DEFAULT_POLICY.disallowYear,
        });
        ctSummary = fetched.summary;
        ctStatus = "live";
      } catch {
        ctStatus = "fallback";
      }
      const now = new Date().toISOString();
      const result = runAssay({
        tls: {
          status: "live",
          meta: {
            status: "live",
            source: "TLS handshake",
            upstreamId: `${observation.host}:443`,
            attribution: `Direct TLS handshake at ${now}`,
            fetchedAt: now,
          },
          data: observation,
        },
        ct: {
          status: ctStatus,
          meta: {
            status: ctStatus,
            source: ctStatus === "live" ? "Certificate Transparency (crt.sh)" : "Sealed offline sample",
            upstreamId: observation.host,
            attribution:
              ctStatus === "live"
                ? `Certificate Transparency records retrieved at ${now}`
                : "Certificate Transparency unavailable for this host.",
            fetchedAt: now,
          },
          data: ctSummary,
        },
        currentYear: new Date().getFullYear(),
        now,
      });
      return ok({ engineVersion: ENGINE_VERSION, observation, result });
    }

    const tls = body.tls as { status?: string; meta?: unknown; data?: TlsObservation } | undefined;
    const ct = body.ct as { status?: string; meta?: unknown; data?: CtSummary } | undefined;
    if (!tls?.data?.chain || !ct?.data) {
      return fail(
        "missing_input",
        "Provide either { host } to run a live handshake, or { tls, ct } observation payloads.",
        400,
        { accepted: ["host", "tls+ct"] },
      );
    }

    const result = runAssay({
      tls: tls as never,
      ct: ct as never,
      currentYear: new Date().getFullYear(),
      now: new Date().toISOString(),
    });
    return ok({ engineVersion: ENGINE_VERSION, result });
  });
}