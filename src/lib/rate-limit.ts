/**
 * Abuse control for anonymous writes.
 *
 * There are no accounts, so the only thing standing between the public write
 * surface and abuse is a per-process token bucket. It is deliberately honest
 * about its own weakness: a serverless deployment scales horizontally and each
 * cold container keeps its own bucket, so this raises the cost of a naive script
 * but does not stop a determined one. Deployments that need a hard limit should
 * put a hosted rate limiter or a WAF rule in front of /api and /api/mcp.
 */

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const CAPACITY = 12;
const REFILL_PER_SECOND = 12 / 60;

const buckets = new Map<string, Bucket>();

export interface RateVerdict {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function checkRate(key: string, now = Date.now()): RateVerdict {
  const bucket = buckets.get(key) ?? { tokens: CAPACITY, updatedAt: now };
  const elapsedSeconds = Math.max(0, (now - bucket.updatedAt) / 1000);
  bucket.tokens = Math.min(CAPACITY, bucket.tokens + elapsedSeconds * REFILL_PER_SECOND);
  bucket.updatedAt = now;

  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    const retryAfter = Math.ceil((1 - bucket.tokens) / REFILL_PER_SECOND);
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, retryAfter) };
  }

  bucket.tokens -= 1;
  buckets.set(key, bucket);

  if (buckets.size > 5_000) {
    for (const [entryKey, entry] of buckets) {
      if (now - entry.updatedAt > 3_600_000) buckets.delete(entryKey);
    }
  }

  return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterSeconds: 0 };
}

export function rateHeaders(verdict: RateVerdict): Record<string, string> {
  return {
    "X-RateLimit-Remaining": String(verdict.remaining),
    ...(verdict.allowed ? {} : { "Retry-After": String(verdict.retryAfterSeconds) }),
  };
}

/** Test seam: forget every bucket. */
export function resetRateLimits(): void {
  buckets.clear();
}