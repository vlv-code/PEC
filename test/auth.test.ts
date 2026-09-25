import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import express, { Request, Response, NextFunction } from "express";
import type { AddressInfo } from "node:net";
import { createTokenAuthMiddleware } from "../src/middleware/security.js";
import { createAuthRouter, createCookieAuthenticator } from "../src/routes/authRoutes.js";
import {
  clearAllSessions,
  getDashboardAuthStorePath,
  initDashboardCredentials,
} from "../src/auth.js";
import { TEST_ADMIN_TOKEN } from "./helpers/setup.js";

/**
 * Dashboard login flow over real sockets, mirroring the production wiring
 * from server.ts: username + password are verified server-side against a
 * scrypt-hashed credential store, exchanged for an HttpOnly session cookie.
 * The combined admin gate accepts the session cookie (+CSRF marker header)
 * or the X-Admin-Token bearer header. Credentials are changeable through
 * /api/auth/credentials (current password required, other sessions revoked).
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
  // Fresh credential store per test: delete + re-bootstrap (username "admin",
  // fallback password = the test ADMIN_TOKEN).
  try {
    fs.unlinkSync(getDashboardAuthStorePath());
  } catch {}
  clearAllSessions();
  initDashboardCredentials({ username: "admin", fallbackPassword: TEST_ADMIN_TOKEN });

  const server = buildApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
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

function cookieValue(res: globalThis.Response): string {
  return sessionCookieOf(res).split(";")[0];
}

async function login(base: string, username: string, password: string): Promise<globalThis.Response> {
  return fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

const PING_CSRF = { "X-Requested-With": "pec-dashboard" };

test("auth: wrong username and wrong password are both rejected without a cookie", async () => {
  await withServer(async (base) => {
    const badUser = await login(base, "no-such-user", TEST_ADMIN_TOKEN);
    assert.strictEqual(badUser.status, 401);
    assert.strictEqual(badUser.headers.getSetCookie().length, 0, "failed login must not set a session");

    const badPass = await login(base, "admin", "totally-wrong");
    assert.strictEqual(badPass.status, 401);
    const body = await badPass.json();
    assert.strictEqual(body.ok, false);
  });
});

test("auth: correct username+password starts an HttpOnly SameSite=Strict session", async () => {
  await withServer(async (base) => {
    const res = await login(base, "admin", TEST_ADMIN_TOKEN);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.username, "admin", "login must report the authenticated username");
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
  await withServer(async (base) => {
    const sid = cookieValue(await login(base, "admin", TEST_ADMIN_TOKEN));

    // Cookie without the CSRF marker header -> rejected (cross-site requests
    // can silently carry cookies, but cannot set custom headers).
    const csrfless = await fetch(`${base}/api/ping`, { headers: { Cookie: sid } });
    assert.strictEqual(csrfless.status, 401, "cookie without X-Requested-With must not authenticate");

    const ok = await fetch(`${base}/api/ping`, {
      headers: { Cookie: sid, ...PING_CSRF },
    });
    assert.strictEqual(ok.status, 200, "session cookie + CSRF marker must authenticate the dashboard");
  });
});

test("auth: bearer X-Admin-Token still works for scripts (backward compatible)", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/ping`, { headers: { "X-Admin-Token": TEST_ADMIN_TOKEN } });
    assert.strictEqual(res.status, 200, "the bearer header path must keep working without a session");
  });
});

test("auth: /api/auth/session reports username and liveness", async () => {
  await withServer(async (base) => {
    const anon = await fetch(`${base}/api/auth/session`);
    const anonState = await anon.json();
    assert.strictEqual(anonState.authenticated, false);
    assert.strictEqual(anonState.username, null);

    const sid = cookieValue(await login(base, "admin", TEST_ADMIN_TOKEN));
    const authed = await fetch(`${base}/api/auth/session`, { headers: { Cookie: sid } });
    const state = await authed.json();
    assert.strictEqual(state.authenticated, true);
    assert.strictEqual(state.username, "admin");
    assert.ok(state.expiresAt, "an authenticated session must report its expiry");
  });
});

test("auth: logout revokes the session server-side", async () => {
  await withServer(async (base) => {
    const sid = cookieValue(await login(base, "admin", TEST_ADMIN_TOKEN));

    const before = await fetch(`${base}/api/ping`, { headers: { Cookie: sid, ...PING_CSRF } });
    assert.strictEqual(before.status, 200);

    const out = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { Cookie: sid, ...PING_CSRF } });
    assert.strictEqual(out.status, 200);
    assert.match(out.headers.getSetCookie().join(" "), /Max-Age=0/, "logout must expire the cookie client-side too");

    const after = await fetch(`${base}/api/ping`, { headers: { Cookie: sid, ...PING_CSRF } });
    assert.strictEqual(after.status, 401, "a revoked session must stop working immediately");
  });
});

test("auth: credentials change requires the current password", async () => {
  await withServer(async (base) => {
    const sid = cookieValue(await login(base, "admin", TEST_ADMIN_TOKEN));
    const res = await fetch(`${base}/api/auth/credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sid, ...PING_CSRF },
      body: JSON.stringify({ currentPassword: "wrong-current", newPassword: "new-pass-12345" }),
    });
    assert.strictEqual(res.status, 401, "a wrong current password must block the change");

    // and the old password still works
    assert.strictEqual((await login(base, "admin", TEST_ADMIN_TOKEN)).status, 200);
  });
});

test("auth: credential validation - empty change, bad username, short password", async () => {
  await withServer(async (base) => {
    const sid = cookieValue(await login(base, "admin", TEST_ADMIN_TOKEN));
    const post = (body: object) =>
      fetch(`${base}/api/auth/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sid, ...PING_CSRF },
        body: JSON.stringify(body),
      });

    assert.strictEqual((await post({ currentPassword: TEST_ADMIN_TOKEN })).status, 400, "no-op change must be rejected");
    assert.strictEqual((await post({ currentPassword: TEST_ADMIN_TOKEN, newUsername: "a" })).status, 400, "too-short username must be rejected");
    assert.strictEqual((await post({ currentPassword: TEST_ADMIN_TOKEN, newPassword: "short" })).status, 400, "too-short password must be rejected");
    assert.strictEqual((await post({ currentPassword: TEST_ADMIN_TOKEN, newUsername: "bad user!" })).status, 400, "username charset must be enforced");
  });
});

test("auth: changing credentials works, kills other sessions, and the new pair logs in", async () => {
  await withServer(async (base) => {
    const sessionA = cookieValue(await login(base, "admin", TEST_ADMIN_TOKEN));
    const sessionB = cookieValue(await login(base, "admin", TEST_ADMIN_TOKEN));

    const res = await fetch(`${base}/api/auth/credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sessionA, ...PING_CSRF },
      body: JSON.stringify({ currentPassword: TEST_ADMIN_TOKEN, newUsername: "ops-admin", newPassword: "brand-new-pass-1" }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.username, "ops-admin");

    // The old username+password pair must stop working immediately.
    const oldLogin = await login(base, "admin", TEST_ADMIN_TOKEN);
    assert.strictEqual(oldLogin.status, 401, "old credentials must be rejected after the change");

    // Other sessions (B) are revoked; the acting session (A) survives.
    const bPing = await fetch(`${base}/api/ping`, { headers: { Cookie: sessionB, ...PING_CSRF } });
    assert.strictEqual(bPing.status, 401, "sessions other than the acting one must be revoked");
    const aPing = await fetch(`${base}/api/ping`, { headers: { Cookie: sessionA, ...PING_CSRF } });
    assert.strictEqual(aPing.status, 200, "the acting session must stay authenticated");

    // The new pair logs in fine.
    const newLogin = await login(base, "ops-admin", "brand-new-pass-1");
    assert.strictEqual(newLogin.status, 200, "the new username+password must authenticate");
    assert.strictEqual((await newLogin.json()).username, "ops-admin");
  });
});

test("auth: login attempts are rate limited (10/min per IP)", async () => {
  await withServer(async (base) => {
    let last: globalThis.Response | null = null;
    for (let i = 0; i < 11; i++) {
      last = await login(base, "admin", "guess-" + i);
      if (i < 10) {
        assert.strictEqual(last.status, 401, `attempt #${i + 1} must hit the password check`);
      }
    }
    assert.strictEqual(last!.status, 429, "the 11th attempt within a minute must be throttled");
  });
});
