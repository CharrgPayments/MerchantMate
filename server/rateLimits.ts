import type { Request, Response, NextFunction, RequestHandler } from "express";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function clientIp(req: Request): string {
  const fwd = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  return fwd || req.ip || req.socket?.remoteAddress || "unknown";
}

export interface RateLimitOptions {
  scope: string;
  windowMs: number;
  max: number;
  keyExtractor?: (req: Request) => string | undefined;
  message?: string;
}

export function rateLimit(opts: RateLimitOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = clientIp(req);
    const id = opts.keyExtractor?.(req);
    // Namespace every bucket key with the limiter's scope so independent
    // limiters never share counters across endpoints.
    const ns = opts.scope;
    const keys = id
      ? [`${ns}:ip:${ip}`, `${ns}:id:${String(id).toLowerCase()}`]
      : [`${ns}:ip:${ip}`];

    const now = Date.now();
    let blocked = false;
    let retryAfterMs = 0;

    for (const k of keys) {
      const bucket = buckets.get(k);
      if (!bucket || bucket.resetAt <= now) {
        buckets.set(k, { count: 1, resetAt: now + opts.windowMs });
        continue;
      }
      bucket.count += 1;
      if (bucket.count > opts.max) {
        blocked = true;
        retryAfterMs = Math.max(retryAfterMs, bucket.resetAt - now);
      }
    }

    if (blocked) {
      res.setHeader("Retry-After", Math.ceil(retryAfterMs / 1000).toString());
      return res.status(429).json({
        message: opts.message || "Too many requests. Please try again later.",
      });
    }
    next();
  };
}

export function clearRateLimitBuckets(): void {
  buckets.clear();
}
