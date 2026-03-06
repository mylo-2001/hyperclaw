/**
 * src/infra/rate-limiter.ts
 * Per-tenant rate limiting. In-memory sliding window (MVP); Redis adapter later.
 */

export interface RateLimitConfig {
  /** Requests per window */
  limit: number;
  /** Window in seconds */
  windowSeconds: number;
}

const DEFAULT_LIMIT = 100;
const DEFAULT_WINDOW = 60;

interface WindowEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, WindowEntry>();

/** Check and consume one request. Returns true if allowed, false if rate limited. */
export function checkRateLimit(
  tenantId: string,
  key: string,
  config?: Partial<RateLimitConfig>
): boolean {
  const limit = config?.limit ?? DEFAULT_LIMIT;
  const windowMs = (config?.windowSeconds ?? DEFAULT_WINDOW) * 1000;
  const k = `${tenantId}:${key}`;
  const now = Date.now();
  let entry = store.get(k);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(k, entry);
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

/** Get remaining requests for tenant/key. */
export function getRemaining(
  tenantId: string,
  key: string,
  config?: Partial<RateLimitConfig>
): { remaining: number; resetAt: number } {
  const limit = config?.limit ?? DEFAULT_LIMIT;
  const windowMs = (config?.windowSeconds ?? DEFAULT_WINDOW) * 1000;
  const k = `${tenantId}:${key}`;
  const entry = store.get(k);
  const now = Date.now();
  if (!entry || now >= entry.resetAt) {
    return { remaining: limit, resetAt: now + windowMs };
  }
  return { remaining: Math.max(0, limit - entry.count), resetAt: entry.resetAt };
}

/** Reset rate limit for tenant (admin). */
export function resetRateLimit(tenantId: string, key?: string): void {
  if (key) {
    store.delete(`${tenantId}:${key}`);
  } else {
    for (const k of store.keys()) {
      if (k.startsWith(tenantId + ':')) store.delete(k);
    }
  }
}
