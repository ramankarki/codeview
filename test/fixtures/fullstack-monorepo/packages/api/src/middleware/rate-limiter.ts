import type { Context, Next } from "hono";

interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
}

/**
 * Simple in-memory rate limiter.
 */
export function rateLimiter(opts: RateLimiterOptions) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return async (c: Context, next: Next) => {
    const key = c.req.header("x-forwarded-for") ?? "127.0.0.1";
    const now = Date.now();

    let entry = hits.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + opts.windowMs };
      hits.set(key, entry);
    }

    entry.count++;

    if (entry.count > opts.maxRequests) {
      return c.json({ error: "Too many requests" }, 429);
    }

    await next();
  };
}
