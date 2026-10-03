import { createSqlRepository } from "./sql";
import { resolveSchema } from "./schema";
import type { Repository, SqlClient } from "./repository";

/**
 * Hosted production adapter.
 *
 * Connects to the Postgres instance supplied by DATABASE_URL (Neon through the
 * Vercel Marketplace integration, or any other provider). This is the only
 * adapter allowed in production: the selector in ./index.ts refuses to start a
 * production build without it rather than quietly writing to ephemeral storage.
 */

/**
 * Decide the TLS setting from the connection string's sslmode.
 *
 * Returning undefined leaves the choice to the driver, which attempts TLS and
 * falls back to plaintext when the server declines. That is what a self-hosted
 * Postgres needs, and what a provider that hands out TLS-terminating proxies
 * also tolerates. Forcing TLS whenever the URL does not say "disable" broke
 * every connection to a stock Postgres, which is exactly what the CI job runs.
 */
export function sslForUrl(databaseUrl: string): boolean | { rejectUnauthorized: boolean } | undefined {
  const mode = /[?&]sslmode=([^&]+)/.exec(databaseUrl)?.[1]?.toLowerCase();

  if (mode === undefined || mode === "prefer") return undefined;
  if (mode === "disable") return false;
  // "require" means encrypt but do not verify the certificate chain, which is
  // what hosted providers issue. The verifying modes check the chain properly.
  if (mode === "require") return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

export async function createPgRepository(databaseUrl: string): Promise<Repository> {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 4,
    idleTimeoutMillis: 10_000,
    // Pooled Postgres providers hand out connections through a proxy that can
    // take a moment to establish one. Ten seconds was tight enough to surface as a
    // page-level error under ordinary parallel load, which is worse than waiting.
    connectionTimeoutMillis: 25_000,
    ssl: sslForUrl(databaseUrl),
  });
  pool.on("error", () => {
    // A pooled connection dropped in serverless is recoverable: the pool
    // replaces it on the next query. Never crash the function for this.
  });

  const client: SqlClient = {
    query: async <T,>(text: string, params?: unknown[]) => {
      const result = await pool.query(text, params as never[]);
      return { rows: result.rows as T[] };
    },
  };

  return createSqlRepository(client, "postgres", resolveSchema());
}