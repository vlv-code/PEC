import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import express, { Request, Response, NextFunction } from "express";
import type { AddressInfo } from "node:net";
import { createTokenAuthMiddleware } from "../src/middleware/security.js";
import { createAuthRouter, createCookieAuthenticator } from "../src/routes/authRoutes.js";
import { clearAllSessions } from "../src/auth.js";
import { TEST_ADMIN_TOKEN } from "./helpers/setup.js";

/**
 * Dashboard login flow over real sockets, mirroring the production wiring
 * from server.ts: a combined admin gate (X-Admin-Token bearer header OR a
 * server-side session cookie + CSRF marker header) plus the public
 * /api/auth/login|session endpoints. The admin token must never travel to
 * the browser - it is exchanged once for an HttpOnly session cookie.
 */

function buildApp() {
  const app = express();
  app.use(express.json());
  const adminAuth = createTokenAuthMiddleware(() => TEST_ADMIN_TOKEN, "x-admin-token", createCookieAuthenticator());
  const PUBLIC_API_PATHS = new Set(["/ip-echo", "/sync", "/auth/login", "/auth/session"]);
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    return adminAuth(req, res, next);
  });
  app.use(createAuthRouter(() => TEST_ADMIN_TOKEN));
  // A representative gated management route (like /api/status in production)
  app.get("/api/ping", (_req: Request, res: Response) => res.json({ ok: true }));
  return app;
}

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const server = buildApp().listen(0);
  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

function sessionCookieOf(res: globalThis.Response): string {
  const cookies = res.headers.getSetCookie();
  const session = cookies.find((c) => c.startsWith("pec_admin_session="));
  assert.ok(session, "login must set the pec_admin_session cookie");
  return session;
}

test("auth: wrong password is rejected and sets no cookie", async () => {
  clearAllSessions();
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "nope" }),
    });
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.ok, false);
    assert.ok(!res.headers.getSetCookie().some((c) => c.startsWith("pec_admin_session=")), "failed login must not set a session");
  });
});

test("auth: correct password starts an HttpOnly SameSite=Strict session", async () => {
  clearAllSessions();
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: TEST_ADMIN_TOKEN }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.ok(body.expiresAt, "login must report the session expiry");

    const cookie = sessionCookieOf(res);
    assert.match(cookie, /pec_admin_session=[A-Za-z0-9_-]+;/, "session id must be an opaque value");
    assert.match(cookie, /HttpOnly/i, "the cookie must be HttpOnly (invisible to JS/XSS)");
    assert.match(cookie, /SameSite=Strict/i, "the cookie must be SameSite=Strict (CSRF hardening)");
    assert.doesNotMatch(cookie, /;\s*Secure/i, "plain-http test server must not emit the Secure flag");
    assert.match(cookie, /Max-Age=28800/, "the session must live 8 hours");
  });
});

test("auth: cookie-only requests need the CSRF marker header; with it the gate passes", async () => {
  clearAllSessions();
  await withServer(async (base) => {
    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: TEST_ADMIN_TOKEN }),
    });
    const sid = sessionCookieOf(login).split(";")[0];

    // Cookie without the CSRF marker header -> rejected (cross-site requests
    // can silently carry cookies, but cannot set custom headers).
    const csrfless = await fetch(`${base}/api/ping`, { headers: { Cookie: sid } });
    assert.strictEqual(csrfless.status, 401, "cookie without X-Requested-With must not authenticate");

    const ok = await fetch(`${base}/api/ping`, {
      headers: { Cookie: sid, "X-Requested-With": "pec-dashboard" },
    });
    assert.strictEqual(ok.status, 200, "session cookie + CSRF marker must authenticate the dashboard");
  });
});

test("auth: bearer X-Admin-Token still works for scripts (backward compatible)", async () => {
  clearAllSessions();
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/ping`, { headers: { "X-Admin-Token": TEST_ADMIN_TOKEN } });
    assert.strictEqual(res.status, 200, "the bearer header path must keep working without a session");
  });
});

test("auth: /api/auth/session reports whether the cookie is alive", async () => {
  clearAllSessions();
  await withServer(async (base) => {
    const anon = await fetch(`${base}/api/auth/session`);
    assert.strictEqual((await anon.json()).authenticated, false);

    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: TEST_ADMIN_TOKEN }),
    });
    const sid = sessionCookieOf(login).split(";")[0];

    const authed = await fetch(`${base}/api/auth/session`, { headers: { Cookie: sid } });
    const state = await authed.json();
    assert.strictEqual(state.authenticated, true);
    assert.ok(state.expiresAt, "an authenticated session must report its expiry");
  });
});

test("auth: logout revokes the session server-side", async () => {
  clearAllSessions();
  await withServer(async (base) => {
    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: TEST_ADMIN_TOKEN }),
    });
    const sid = sessionCookieOf(login).split(";")[0];

    const before = await fetch(`${base}/api/ping`, {
      headers: { Cookie: sid, "X-Requested-With": "pec-dashboard" },
    });
    assert.strictEqual(before.status, 200);

    const out = await fetch(`${base}/api/auth/logout`, {
      method: "POST",
      headers: { Cookie: sid, "X-Requested-With": "pec-dashboard" },
    });
    assert.strictEqual(out.status, 200);
    assert.match(out.headers.getSetCookie().join(" "), /Max-Age=0/, "logout must expire the cookie client-side too");

    const after = await fetch(`${base}/api/ping`, {
      headers: { Cookie: sid, "X-Requested-With": "pec-dashboard" },
    });
    assert.strictEqual(after.status, 401, "a revoked session must stop working immediately");
  });
});

test("auth: login attempts are rate limited (10/min per IP)", async () => {
  clearAllSessions();
  await withServer(async (base) => {
    let last: globalThis.Response | null = null;
    for (let i = 0; i < 11; i++) {
      last = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "guess-" + i }),
      });
      if (i < 10) {
        assert.strictEqual(last.status, 401, `attempt #${i + 1} must hit the password check`);
      }
    }
    assert.strictEqual(last!.status, 429, "the 11th attempt within a minute must be throttled");
  });
});
