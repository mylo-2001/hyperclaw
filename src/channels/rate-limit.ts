/**
 * src/channels/rate-limit.ts
 * Per-channel rate limiting and backoff for connector resilience.
 */

const limits: Map<string, { count: number; windowStart: number }> = new Map();

export interface RateLimitConfig {
  /** Max requests per window */
  maxPerWindow: number;
  /** Window duration in ms */
  windowMs: number;
  /** Min delay between requests (ms) */
  minDelayMs?: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxPerWindow: 30,
  windowMs: 60_000,
  minDelayMs: 200
};

export async function withRateLimit<T>(
  channelId: string,
  fn: () => Promise<T>,
  config?: Partial<RateLimitConfig>
): Promise<T> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const key = channelId;
  let entry = limits.get(key);
  const now = Date.now();
  if (!entry || now - entry.windowStart > cfg.windowMs) {
    entry = { count: 0, windowStart: now };
    limits.set(key, entry);
  }
  entry.count++;
  if (entry.count > cfg.maxPerWindow) {
    const waitMs = cfg.windowMs - (now - entry.windowStart);
    if (waitMs > 0) await new Promise(r => setTimeout(r, Math.min(waitMs, 5000)));
  }
  if (cfg.minDelayMs) await new Promise(r => setTimeout(r, cfg.minDelayMs));
  return fn();
}

export function resetRateLimit(channelId: string): void {
  limits.delete(channelId);
}
