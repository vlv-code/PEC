import { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import { getClientIp, recordAudit } from "../audit.js";

/**
 * Standard HTTP Security Headers
 * Note: X-XSS-Protection intentionally removed - the header is obsolete
 * and ignored by modern browsers (it could even introduce issues).
 */
export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
}

/**
 * Segmented and Safe CORS Policy
 * - Public delivery endpoints (proxy.pac, healthz, updates): wildcard allowed
 * - Admin and synchronization endpoints: restricted to same-host or chrome-extension:// origins
 *
 * Origin matching is exact: the Origin's host:port must equal the Host header.
 * Substring matching is not used because it is trivially bypassable
 * (e.g. "https://evil-localhost.example" containing "localhost").
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
    const reqHost = req.headers.host || "";
    let originAllowed = false;

    if (origin.startsWith("chrome-extension://")) {
      originAllowed = true;
    } else if (reqHost) {
      try {
        originAllowed = new URL(origin).host === reqHost;
      } catch {
        originAllowed = false;
      }
    }

    if (originAllowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Ext-Token, X-Admin-Token, X-Requested-With");

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
}

/**
 * In-Memory Sliding-Window Rate Limiter
 * Uses the shared getClientIp() helper, which honours the Express "trust proxy"
 * setting: with trust proxy disabled, X-Forwarded-For is ignored, so clients
 * cannot bypass rate limits by spoofing that header.
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
    const clientIp = getClientIp(req);

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
 * Timing-safe string comparison that does not leak the token length.
 * Both inputs are SHA-256 digested first, so the comparison always operates
 * on equal-length buffers and fails in constant time.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = crypto.createHash("sha256").update(a, "utf-8").digest();
  const bufB = crypto.createHash("sha256").update(b, "utf-8").digest();
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Token authentication middleware for API routes.
 * The header name is parameterized so fleet and admin tokens can be enforced
 * on disjoint route sets: extensions authenticate with the low-privilege
 * fleet token (X-Ext-Token), operators with the admin token (X-Admin-Token).
 *
 * For the admin gate an optional cookieAuth callback enables the dashboard's
 * server-side session login: when the bearer header is absent, the request
 * may still pass if it carries a valid session cookie (the callback also
 * enforces the CSRF marker header - cross-site requests cannot set custom
 * headers without a CORS preflight, which this server never grants).
 */
export function createTokenAuthMiddleware(
  getToken: () => string,
  headerName = "x-ext-token",
  cookieAuth?: (req: Request) => boolean
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers[headerName as "x-ext-token"];
    const provided = Array.isArray(header) ? header[0] : header;
    const token = getToken();
    const headerLabel = headerName.toUpperCase();

    const headerOk = Boolean(token && provided && timingSafeEqualString(provided, token));
    if (headerOk || (cookieAuth && cookieAuth(req))) {
      next();
      return;
    }

    recordAudit({
      ip: getClientIp(req),
      endpoint: req.path,
      status: 401,
      result: "REJECTED_TOKEN",
      details: `API authentication required (${headerLabel})`,
    });
    res.status(401).json({ error: `Unauthorized: a valid ${headerLabel} header is required` });
  };
}

/**
 * Admin token bootstrap. In production an explicit ADMIN_TOKEN is mandatory
 * (fail fast); in development a throwaway token is generated once per start.
 * Throws instead of exiting so callers (and tests) control the failure mode.
 */
export function resolveAdminToken(env: { ADMIN_TOKEN?: string; NODE_ENV?: string }): { token: string; generated: boolean } {
  const provided = (env.ADMIN_TOKEN || "").trim();
  if (provided) {
    return { token: provided, generated: false };
  }
  if (env.NODE_ENV === "production") {
    throw new Error(
      "ADMIN_TOKEN is required when NODE_ENV=production. " +
        "Set it in .env (a long random value, distinct from EXT_SHARED_TOKEN)."
    );
  }
  return { token: crypto.randomBytes(24).toString("base64url"), generated: true };
}
