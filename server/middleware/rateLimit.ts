import type { NextFunction, Request, Response } from 'express';

interface Bucket {
  timestamps: number[];
}

export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (req: Request) => string;
  message?: string;
}) {
  const buckets = new Map<string, Bucket>();

  // Periodic cleanup of expired entries
  setInterval(() => {
    const cutoff = Date.now() - options.windowMs;
    for (const [key, bucket] of buckets.entries()) {
      bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);
      if (bucket.timestamps.length === 0) {
        buckets.delete(key);
      }
    }
  }, Math.max(options.windowMs, 30_000));

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const cutoff = now - options.windowMs;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = options.keyGenerator ? `${ip}:${options.keyGenerator(req)}` : ip;

    const bucket = buckets.get(key) || { timestamps: [] };
    bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);

    if (bucket.timestamps.length >= options.maxRequests) {
      const oldest = bucket.timestamps[0];
      const retryAfterSec = Math.max(1, Math.ceil((oldest + options.windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: options.message || 'Too many requests. Please wait before trying again.',
        retryAfterSeconds: retryAfterSec,
      });
      return;
    }

    bucket.timestamps.push(now);
    buckets.set(key, bucket);
    next();
  };
}
