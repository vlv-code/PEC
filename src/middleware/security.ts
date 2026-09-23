import { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";

/**
 * Standard HTTP Security Headers
 */
export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
}

/**
 * Segmented and Safe CORS Policy
 * - Public delivery endpoints (proxy.pac, healthz, updates): wildcard allowed
 * - Admin and synchronization endpoints: restricted to same-origin or chrome-extension:// origins
 */
export function safeCorsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin || "";
  const isPublicResource =
    req.path === "/healthz" ||
    req.path === "/proxy.pac" ||
    req.path.startsWith("/updates/") ||
    req.path.startsWith("/dist/updates/");

  if (isPublicResource) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin) {
    // Allow requests originating from Chrome extensions (chrome-extension://<id>) or same host
    if (origin.startsWith("chrome-extension://") || origin.includes(req.headers.host || "")) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Ext-Token, X-Requested-With");

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
}

/**
 * In-Memory Sliding-Window Rate Limiter
 */
interface RateLimitRecord {
  count: number;
  resetTime: number;
}

export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  message?: string;
}) {
  const store = new Map<string, RateLimitRecord>();

  // Cleanup expired IPs every 2 minutes
  const interval = setInterval(() => {
    const now = Date.now();
    for (const [ip, rec] of store.entries()) {
      if (now > rec.resetTime) {
        store.delete(ip);
      }
    }
  }, 120_000);
  interval.unref?.();

  return (req: Request, res: Response, next: NextFunction): void => {
    const clientIp =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";

    const now = Date.now();
    const record = store.get(clientIp);

    if (!record || now > record.resetTime) {
      store.set(clientIp, { count: 1, resetTime: now + options.windowMs });
      next();
      return;
    }

    if (record.count >= options.maxRequests) {
      const retryAfterSec = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader("Retry-After", retryAfterSec);
      res.status(429).json({
        ok: false,
        error: options.message || "Too many requests. Please slow down.",
        retryAfterSec,
      });
      return;
    }

    record.count++;
    next();
  };
}

/**
 * Timing-safe string comparison to prevent timing attacks
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}
