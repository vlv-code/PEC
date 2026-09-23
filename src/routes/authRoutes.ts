import { Router, Request, Response } from "express";
import { createRateLimiter } from "../middleware/security.js";
import { recordAudit, getClientIp } from "../audit.js";
import {
  buildLogoutCookie,
  buildSessionCookie,
  clearAllSessionsExcept,
  createAdminSession,
  CSRF_HEADER_NAME,
  CSRF_HEADER_VALUE,
  getSessionExpiry,
  getSessionUsername,
  getDashboardUsername,
  parseCookies,
  requestIsSecure,
  revokeAdminSession,
  SESSION_COOKIE_NAME,
  updateDashboardCredentials,
  validateAdminSession,
  verifyDashboardCredentials,
} from "../auth.js";

/**
 * Dashboard login endpoints.
 *
 * POST /api/auth/login        - exchange username + password for an HttpOnly
 *                               session cookie (rate limited per IP)
 * POST /api/auth/logout       - revoke the current session
 * GET  /api/auth/session      - is the current cookie authenticated? (public)
 * POST /api/auth/credentials  - change username/password (admin gate;
 *                               requires the current password and revokes
 *                               every other session)
 */
export function createAuthRouter(_getAdminToken: () => string): Router {
  const router = Router();

  const loginLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 10,
    message: "Too many login attempts. Try again in a minute.",
  });

  router.post("/api/auth/login", loginLimiter, (req: Request, res: Response) => {
    const username = typeof req.body?.username === "string" ? req.body.username : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!username || !password || !verifyDashboardCredentials(username, password)) {
      recordAudit({
        ip: getClientIp(req),
        endpoint: "/api/auth/login",
        status: 401,
        result: "LOGIN_FAILED",
        details: "Invalid dashboard username or password",
      });
      return res.status(401).json({ ok: false, error: "Неверный логин или пароль / Wrong username or password" });
    }

    const cleanUsername = username.trim().toLowerCase();
    const session = createAdminSession(getClientIp(req), cleanUsername);
    res.setHeader("Set-Cookie", buildSessionCookie(session.id, requestIsSecure(req)));
    recordAudit({
      ip: getClientIp(req),
      endpoint: "/api/auth/login",
      status: 200,
      result: "LOGIN_OK",
      details: `Dashboard session started (user: ${cleanUsername})`,
    });
    return res.json({ ok: true, username: cleanUsername, expiresAt: new Date(session.expiresAt).toISOString() });
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
      username: getSessionUsername(sid),
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    });
  });

  // Change dashboard credentials. Behind the admin gate (session cookie +
  // CSRF marker, or the X-Admin-Token bearer header); requires the CURRENT
  // password, and revokes every other session so stolen cookies die.
  router.post("/api/auth/credentials", (req: Request, res: Response) => {
    const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
    const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
    const newUsername = typeof req.body?.newUsername === "string" ? req.body.newUsername.trim() : "";
    const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";

    if (!currentPassword || !verifyDashboardCredentials(getDashboardUsername(), currentPassword)) {
      recordAudit({
        ip: getClientIp(req),
        endpoint: "/api/auth/credentials",
        status: 401,
        result: "LOGIN_FAILED",
        details: "Credential change rejected: current password mismatch",
      });
      return res.status(401).json({ ok: false, error: "Текущий пароль неверен" });
    }

    if (!newUsername && !newPassword) {
      return res.status(400).json({ ok: false, error: "Укажите новый логин и/или новый пароль" });
    }
    if (newUsername && !/^[a-zA-Z0-9_.-]{3,64}$/.test(newUsername)) {
      return res.status(400).json({ ok: false, error: "Логин: 3-64 символа, буквы/цифры/._- " });
    }
    if (newPassword && (newPassword.length < 8 || newPassword.length > 128)) {
      return res.status(400).json({ ok: false, error: "Пароль: от 8 до 128 символов" });
    }

    const result = updateDashboardCredentials({
      username: newUsername || undefined,
      password: newPassword || undefined,
    });

    clearAllSessionsExcept(sid);
    recordAudit({
      ip: getClientIp(req),
      endpoint: "/api/auth/credentials",
      status: 200,
      result: "CONFIG_UPDATED",
      details: `Dashboard credentials updated (user: ${result.username})`,
    });
    return res.json({ ok: true, username: result.username });
  });

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
