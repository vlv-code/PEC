import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import express, { Request, Response, NextFunction } from "express";
import type { AddressInfo } from "node:net";
import { createTokenAuthMiddleware } from "../src/middleware/security.js";
import { createAuthRouter, createCookieAuthenticator } from "../src/routes/authRoutes.js";
import {
  clearAllSessions,
  getDashboardAuthStorePath,
  resetDashboardCredentialsForTest,
} from "../src/auth.js";
import { TEST_ADMIN_TOKEN } from "./helpers/setup.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  const adminAuth = createTokenAuthMiddleware(() => TEST_ADMIN_TOKEN, "x-admin-token", createCookieAuthenticator());
  const PUBLIC_API_PATHS = new Set([
    "/ip-echo",
    "/sync",
    "/auth/status",
    "/auth/setup-verify",
    "/auth/setup-credentials",
    "/auth/login",
    "/auth/session",
  ]);
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    return adminAuth(req, res, next);
  });
  app.use(createAuthRouter(() => TEST_ADMIN_TOKEN));
  return app;
}

async function withSetupServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  try {
    fs.unlinkSync(getDashboardAuthStorePath());
  } catch {}
  clearAllSessions();
  resetDashboardCredentialsForTest();

  const server = buildApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

function extractSessionCookie(res: globalThis.Response): string {
  const cookies = res.headers.getSetCookie();
  const session = cookies.find((c) => c.startsWith("pec_admin_session="));
  assert.ok(session, "response must set pec_admin_session cookie");
  return session.split(";")[0];
}

test("authFlow: clean initial state requires setup and blocks login", async () => {
  await withSetupServer(async (base) => {
    const statusRes = await fetch(`${base}/api/auth/status`);
    assert.strictEqual(statusRes.status, 200);
    const statusData = await statusRes.json();
    assert.strictEqual(statusData.setupRequired, true);
    assert.strictEqual(statusData.authenticated, false);

    // Standard login must be blocked when setup is required
    const loginRes = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: TEST_ADMIN_TOKEN }),
    });
    assert.strictEqual(loginRes.status, 403);
    const loginData = await loginRes.json();
    assert.strictEqual(loginData.ok, false);
    assert.match(loginData.error, /первоначальная настройка|setup required/i);
  });
});

test("authFlow: setup-verify validates admin token and issues setup session", async () => {
  await withSetupServer(async (base) => {
    // Bad token rejected
    const badRes = await fetch(`${base}/api/auth/setup-verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "wrong-admin-token" }),
    });
    assert.strictEqual(badRes.status, 401);
    const badData = await badRes.json();
    assert.strictEqual(badData.ok, false);

    // Correct token accepted
    const okRes = await fetch(`${base}/api/auth/setup-verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: TEST_ADMIN_TOKEN }),
    });
    assert.strictEqual(okRes.status, 200);
    const okData = await okRes.json();
    assert.strictEqual(okData.ok, true);
    assert.strictEqual(okData.step, "set_credentials");

    const cookie = extractSessionCookie(okRes);
    assert.ok(cookie.length > 20);
  });
});

test("authFlow: complete lifecycle - token verify -> create credentials -> forced logout -> login with new creds -> repeated setup blocked", async () => {
  await withSetupServer(async (base) => {
    // 1. Verify token
    const verifyRes = await fetch(`${base}/api/auth/setup-verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: TEST_ADMIN_TOKEN }),
    });
    assert.strictEqual(verifyRes.status, 200);
    const setupCookie = extractSessionCookie(verifyRes);

    // 2. Setup credentials validation errors
    const shortPassRes = await fetch(`${base}/api/auth/setup-credentials`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": setupCookie,
        "X-Requested-With": "pec-dashboard",
      },
      body: JSON.stringify({ username: "admin_user", password: "123" }),
    });
    assert.strictEqual(shortPassRes.status, 400);

    // 3. Setup credentials success
    const credsRes = await fetch(`${base}/api/auth/setup-credentials`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": setupCookie,
        "X-Requested-With": "pec-dashboard",
      },
      body: JSON.stringify({ username: "super_admin", password: "MasterPassword2026!" }),
    });
    assert.strictEqual(credsRes.status, 200);
    const credsData = await credsRes.json();
    assert.strictEqual(credsData.ok, true);
    assert.strictEqual(credsData.username, "super_admin");

    // Check that logout cookie was sent (clearing the setup session)
    const cookiesAfterSetup = credsRes.headers.getSetCookie();
    const clearedCookie = cookiesAfterSetup.find((c) => c.includes("pec_admin_session=") && c.includes("Max-Age=0"));
    assert.ok(clearedCookie, "setup-credentials must revoke setup session and clear cookie");

    // 4. Status should now show setupRequired = false
    const statusRes = await fetch(`${base}/api/auth/status`);
    assert.strictEqual(statusRes.status, 200);
    const statusData = await statusRes.json();
    assert.strictEqual(statusData.setupRequired, false);
    assert.strictEqual(statusData.authenticated, false);

    // 5. Repeated setup attempts must now be permanently rejected
    const repeatVerify = await fetch(`${base}/api/auth/setup-verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: TEST_ADMIN_TOKEN }),
    });
    assert.strictEqual(repeatVerify.status, 403);

    const repeatCreds = await fetch(`${base}/api/auth/setup-credentials`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "pec-dashboard",
      },
      body: JSON.stringify({ username: "hacker", password: "HackerPassword123!" }),
    });
    assert.strictEqual(repeatCreds.status, 403);

    // 6. Normal login with the newly created credentials works
    const loginRes = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "super_admin", password: "MasterPassword2026!" }),
    });
    assert.strictEqual(loginRes.status, 200);
    const loginData = await loginRes.json();
    assert.strictEqual(loginData.ok, true);
    assert.strictEqual(loginData.username, "super_admin");

    const realSessionCookie = extractSessionCookie(loginRes);

    // 7. Status with real session cookie reports authenticated
    const authStatusRes = await fetch(`${base}/api/auth/status`, {
      headers: { Cookie: realSessionCookie },
    });
    const authStatusData = await authStatusRes.json();
    assert.strictEqual(authStatusData.setupRequired, false);
    assert.strictEqual(authStatusData.authenticated, true);
    assert.strictEqual(authStatusData.username, "super_admin");
  });
});

test("authFlow: dashboardView includes full-screen authScreen and all setup steps", async () => {
  const { renderDashboardHtml } = await import("../src/views/dashboardView.js");
  const html = renderDashboardHtml({});
  assert.match(html, /id="authScreen"/);
  assert.match(html, /id="authStepToken"/);
  assert.match(html, /id="authTokenInput"/);
  assert.match(html, /id="btnAuthVerifyToken"/);
  assert.match(html, /id="authStepCredentials"/);
  assert.match(html, /id="authNewUsername"/);
  assert.match(html, /id="authNewPassword"/);
  assert.match(html, /id="authNewPasswordConfirm"/);
  assert.match(html, /id="btnAuthSaveCredentials"/);
  assert.match(html, /id="authStepLogin"/);
  assert.match(html, /id="loginUsernameInput"/);
  assert.match(html, /id="loginTokenInput"/);
  assert.match(html, /id="loginSubmitBtn"/);
});

