import { NextResponse } from "next/server";
import { getRepository, currentStoreKind } from "@/lib/db";

/**
 * Health endpoint.
 *
 * This verifies the real persistence path rather than returning a static
 * success object: it runs `SELECT 1` through the same adapter the application
 * uses and counts the rows actually stored. In production, if the hosted
 * database is unreachable, this reports failure.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const startedAt = Date.now();
  try {
    const repo = await getRepository();
    const health = await repo.healthCheck();

    const body = {
      status: health.ok ? "ok" : "degraded",
      store: repo.kind,
      productionStore: repo.kind === "postgres",
      durable: repo.kind === "postgres",
      detail: health.detail,
      schema: repo.schema,
      checkedAt: health.checkedAt,
      elapsedMs: Date.now() - startedAt,
      engine: "keyassay/1.0.0",
    };

    return NextResponse.json(body, { status: health.ok ? 200 : 503 });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        store: currentStoreKind(),
        productionStore: false,
        durable: false,
        detail:
          process.env.NODE_ENV === "production" && !process.env.DATABASE_URL
            ? "DATABASE_URL is not set. Keyassay refuses to run in production without a hosted Postgres database."
            : "The database adapter could not be initialised.",
        errorCode: (error as { code?: string }).code ?? "init_failed",
        checkedAt: new Date().toISOString(),
        elapsedMs: Date.now() - startedAt,
      },
      { status: 503 },
    );
  }
}