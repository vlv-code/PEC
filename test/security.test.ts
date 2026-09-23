import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import express, { Request, Response, NextFunction } from "express";
import type { AddressInfo } from "node:net";
import { timingSafeEqualString, createTokenAuthMiddleware, safeCorsMiddleware, resolveAdminToken } from "../src/middleware/security.js";
import { createSystemRouter } from "../src/routes/systemRoutes.js";
import { createInstancesRouter } from "../src/routes/instancesRoutes.js";
import { createCredsRouter } from "../src/routes/credsRoutes.js";
import { TEST_TOKEN, TEST_ADMIN_TOKEN } from "./helpers/setup.js";

test("timingSafeEqualString compares digests (no length leak, safe on any input)", () => {
  assert.strictEqual(timingSafeEqualString("same", "same"), true);
  assert.strictEqual(timingSafeEqualString("short", "a-much-longer-value-here"), false);
  assert.strictEqual(timingSafeEqualString("", ""), true);
  assert.strictEqual(timingSafeEqualString("x", ""), false);
  // No throw on different lengths (old implementation returned early)
  assert.doesNotThrow(() => timingSafeEqualString("a", "bb"));
});

test("CORS reflects only exact same-host origins, never substrings", () => {
  interface MockRes {
    setHeader: (k: string, v: string) => void;
    sendStatus: (code: number) => void;
    captured: Record<string, string>;
  }
  const makeRes = (): MockRes => {
    const captured: Record<string, string> = {};
    return {
      captured,
      setHeader: (k: string, v: string) => {
        captured[k.toLowerCase()] = v;
      },
      sendStatus: () => {},
    };
  };

  // exact host match -> reflected
  let req = { path: "/api/status", method: "GET", headers: { origin: "http://localhost:3000", host: "localhost:3000" } } as unknown as Request;
  let res = makeRes();
  safeCorsMiddleware(req, res as unknown as Response, () => {});
  assert.strictEqual(res.captured["access-control-allow-origin"], "http://localhost:3000");

  // substring spoof -> NOT reflected
  req = { path: "/api/status", method: "GET", headers: { origin: "http://evil-localhost.example", host: "localhost:3000" } } as unknown as Request;
  res = makeRes();
  safeCorsMiddleware(req, res as unknown as Response, () => {});
  assert.strictEqual(res.captured["access-control-allow-origin"], undefined);

  // empty host header -> NOT reflected (previously includes("") was always true)
  req = { path: "/api/status", method: "GET", headers: { origin: "http://attacker.example" } } as unknown as Request;
  res = makeRes();
  safeCorsMiddleware(req, res as unknown as Response, () => {});
  assert.strictEqual(res.captured["access-control-allow-origin"], undefined);

  // chrome extension origins are allowed
  req = { path: "/api/sync", method: "POST", headers: { origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop" } } as unknown as Request;
  res = makeRes();
  safeCorsMiddleware(req, res as unknown as Response, () => {});
  assert.strictEqual(res.captured["access-control-allow-origin"], "chrome-extension://abcdefghijklmnopabcdefghijklmnop");

  // public resources get a wildcard
  req = { path: "/proxy.pac", method: "GET", headers: { origin: "http://anyone.example" } } as unknown as Request;
  res = makeRes();
  safeCorsMiddleware(req, res as unknown as Response, () => {});
  assert.strictEqual(res.captured["access-control-allow-origin"], "*");
});

test("admin auth middleware: 401 without/with wrong token, pass-through with valid token", async () => {
  const app = express();
  const auth = createTokenAuthMiddleware(() => TEST_ADMIN_TOKEN, "x-admin-token");
  app.use("/api", auth);
  app.get("/api/ping", (_req: Request, res: Response) => res.json({ ok: true }));

  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const noToken = await fetch(`${base}/api/ping`);
    assert.strictEqual(noToken.status, 401);

    const wrongToken = await fetch(`${base}/api/ping`, { headers: { "X-Admin-Token": "wrong-token" } });
    assert.strictEqual(wrongToken.status, 401);

    // Strict header separation: the fleet token must NOT open admin routes.
    const fleetToken = await fetch(`${base}/api/ping`, { headers: { "X-Ext-Token": TEST_TOKEN } });
    assert.strictEqual(fleetToken.status, 401, "the fleet token must not authenticate against X-Admin-Token routes");

    const ok = await fetch(`${base}/api/ping`, { headers: { "X-Admin-Token": TEST_ADMIN_TOKEN } });
    assert.strictEqual(ok.status, 200);
    const body = await ok.json();
    assert.strictEqual(body.ok, true);
  } finally {
    server.close();
  }
});

test("resolveAdminToken: explicit value wins, prod without token fails fast, dev gets a generated token", () => {
  const explicit = resolveAdminToken({ ADMIN_TOKEN: "  provided-secret  ", NODE_ENV: "production" });
  assert.strictEqual(explicit.token, "provided-secret");
  assert.strictEqual(explicit.generated, false);

  assert.throws(
    () => resolveAdminToken({ ADMIN_TOKEN: "", NODE_ENV: "production" }),
    /ADMIN_TOKEN is required/,
    "production without ADMIN_TOKEN must fail fast"
  );

  const dev = resolveAdminToken({ ADMIN_TOKEN: "", NODE_ENV: "development" });
  assert.strictEqual(dev.generated, true);
  assert.ok(dev.token.length >= 20, "generated dev token must have decent entropy");
  assert.notStrictEqual(dev.token, resolveAdminToken({ NODE_ENV: "development" }).token, "each dev start must generate a fresh token");
});

test("HTTP: two-token access matrix - fleet token on admin routes, admin token on fleet routes", async () => {
  // Mirrors the production wiring from server.ts
  const app = express();
  app.use(express.json());
  const adminAuth = createTokenAuthMiddleware(() => TEST_ADMIN_TOKEN, "x-admin-token");
  const PUBLIC_API_PATHS = new Set(["/ip-echo", "/sync"]);
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    return adminAuth(req, res, next);
  });
  app.use(createSystemRouter({ port: 3000, getFleetToken: () => TEST_TOKEN, defaultFleetToken: "default-x", adminTokenConfigured: true, credsStorePath: "/tmp/x.json" }));
  app.use(createInstancesRouter());
  app.use(createCredsRouter(() => TEST_TOKEN));

  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. fleet token on an admin route -> 401 (the old single-token privilege hole)
    const fleetOnAdmin = await fetch(`${base}/api/status`, { headers: { "X-Ext-Token": TEST_TOKEN } });
    assert.strictEqual(fleetOnAdmin.status, 401, "fleet token must be rejected on admin routes");

    // 2. admin token on an admin route -> 200
    const adminOnAdmin = await fetch(`${base}/api/status`, { headers: { "X-Admin-Token": TEST_ADMIN_TOKEN } });
    assert.strictEqual(adminOnAdmin.status, 200);
    const status = await adminOnAdmin.json();
    assert.strictEqual(typeof status.killSwitch, "boolean");
    assert.strictEqual(status.adminTokenConfigured, true);
    assert.strictEqual(typeof status.fleetDefaultTokenInUse, "boolean");

    // 3. admin token on fleet routes -> 403 (strict isolation, no overlap)
    const adminOnCreds = await fetch(`${base}/creds`, { headers: { "X-Admin-Token": TEST_ADMIN_TOKEN } });
    assert.strictEqual(adminOnCreds.status, 403, "admin token must not be accepted on /creds");
    const adminOnSync = await fetch(`${base}/api/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Token": TEST_ADMIN_TOKEN },
      body: "{}",
    });
    assert.strictEqual(adminOnSync.status, 403, "admin token must not be accepted on /api/sync");

    // 4. fleet token on fleet routes -> 200 (unchanged extension protocol)
    const fleetOnCreds = await fetch(`${base}/creds`, { headers: { "X-Ext-Token": TEST_TOKEN } });
    assert.strictEqual(fleetOnCreds.status, 200);
    const creds = await fleetOnCreds.json();
    assert.strictEqual(typeof creds.pass, "string");
    const fleetOnSync = await fetch(`${base}/api/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Ext-Token": TEST_TOKEN },
      body: JSON.stringify({ instanceId: "http-test-worker", version: "1.3.1", group: "QA" }),
    });
    assert.strictEqual(fleetOnSync.status, 200);
    assert.strictEqual((await fleetOnSync.json()).ok, true);

    // admin-only fleet listing stays gated behind the admin token
    const fleetNoAuth = await fetch(`${base}/api/instances`);
    assert.strictEqual(fleetNoAuth.status, 401);

    // /api/ip-echo stays public (used by extension popups)
    const echo = await fetch(`${base}/api/ip-echo`);
    assert.strictEqual(echo.status, 200);
  } finally {
    server.close();
  }
});
