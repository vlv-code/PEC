import { Router, Request, Response } from "express";
import { timingSafeEqualString, createRateLimiter } from "../middleware/security.js";
import { recordAudit, getClientIp } from "../audit.js";
import {
  buildLogoutCookie,
  buildSessionCookie,
  createAdminSession,
  CSRF_HEADER_NAME,
  CSRF_HEADER_VALUE,
  getSessionExpiry,
  parseCookies,
  requestIsSecure,
  revokeAdminSession,
  SESSION_COOKIE_NAME,
  validateAdminSession,
} from "../auth.js";

/**
 * Dashboard login endpoints.
 *
 * POST /api/auth/login    - exchange the admin password for an HttpOnly
 *                           session cookie (rate limited per IP)
 * POST /api/auth/logout   - revoke the current session
 * GET  /api/auth/session  - is the current cookie authenticated? (public)
 */
export function createAuthRouter(getAdminToken: () => string): Router {
  const router = Router();

  const loginLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 10,
    message: "Too many login attempts. Try again in a minute.",
  });

  router.post("/api/auth/login", loginLimiter, (req: Request, res: Response) => {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const token = getAdminToken();

    if (!token || !password || !timingSafeEqualString(password, token)) {
      recordAudit({
        ip: getClientIp(req),
        endpoint: "/api/auth/login",
        status: 401,
        result: "LOGIN_FAILED",
        details: "Invalid dashboard password",
      });
      return res.status(401).json({ ok: false, error: "Неверный пароль / Wrong password" });
    }

    const session = createAdminSession(getClientIp(req));
    res.setHeader("Set-Cookie", buildSessionCookie(session.id, requestIsSecure(req)));
    recordAudit({
      ip: getClientIp(req),
      endpoint: "/api/auth/login",
      status: 200,
      result: "LOGIN_OK",
      details: "Dashboard session started",
    });
    return res.json({ ok: true, expiresAt: new Date(session.expiresAt).toISOString() });
  });

  router.post("/api/auth/logout", (req: Request, res: Response) => {
    const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
    if (revokeAdminSession(sid)) {
      recordAudit({
        ip: getClientIp(req),
        endpoint: "/api/auth/logout",
        status: 200,
        result: "LOGOUT",
        details: "Dashboard session revoked",
      });
    }
    res.setHeader("Set-Cookie", buildLogoutCookie());
    return res.json({ ok: true });
  });

  router.get("/api/auth/session", (req: Request, res: Response) => {
    const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
    const expiresAt = getSessionExpiry(sid);
    return res.json({
      authenticated: expiresAt !== null,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    });
  });

  // Exported for server.ts: cookie-based authentication check used by the
  // combined admin gate (session + CSRF marker header).
  return router;
}

/**
 * Cookie-auth callback for the admin API gate in server.ts: a request is
 * authenticated by session cookie only when it also carries the CSRF marker
 * header. Cross-site attackers can set cookies (they are sent automatically)
 * but cannot attach custom headers to cross-origin requests without passing
 * a CORS preflight, which this server never grants.
 */
export function createCookieAuthenticator(): (req: Request) => boolean {
  return (req: Request): boolean => {
    const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
    if (!sid) return false;
    return (
      req.headers[CSRF_HEADER_NAME] === CSRF_HEADER_VALUE && validateAdminSession(sid)
    );
  };
}
