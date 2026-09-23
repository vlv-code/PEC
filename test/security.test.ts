import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import express, { Request, Response, NextFunction } from "express";
import type { AddressInfo } from "node:net";
import { timingSafeEqualString, createTokenAuthMiddleware, safeCorsMiddleware } from "../src/middleware/security.js";
import { createSystemRouter } from "../src/routes/systemRoutes.js";
import { createInstancesRouter } from "../src/routes/instancesRoutes.js";
import { createCredsRouter } from "../src/routes/credsRoutes.js";
import { TEST_TOKEN } from "./helpers/setup.js";

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
  const auth = createTokenAuthMiddleware(() => TEST_TOKEN);
  app.use("/api", auth);
  app.get("/api/ping", (_req: Request, res: Response) => res.json({ ok: true }));

  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const noToken = await fetch(`${base}/api/ping`);
    assert.strictEqual(noToken.status, 401);

    const wrongToken = await fetch(`${base}/api/ping`, { headers: { "X-Ext-Token": "wrong-token" } });
    assert.strictEqual(wrongToken.status, 401);

    const ok = await fetch(`${base}/api/ping`, { headers: { "X-Ext-Token": TEST_TOKEN } });
    assert.strictEqual(ok.status, 200);
    const body = await ok.json();
    assert.strictEqual(body.ok, true);
  } finally {
    server.close();
  }
});

test("HTTP: management APIs require the admin token; fleet endpoints stay reachable for extensions", async () => {
  // Mirrors the production wiring from server.ts
  const app = express();
  app.use(express.json());
  const adminAuth = createTokenAuthMiddleware(() => TEST_TOKEN);
  const PUBLIC_API_PATHS = new Set(["/ip-echo", "/sync"]);
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    return adminAuth(req, res, next);
  });
  app.use(createSystemRouter({ port: 3000, getSharedToken: () => TEST_TOKEN, defaultToken: "default-x", credsStorePath: "/tmp/x.json" }));
  app.use(createInstancesRouter());
  app.use(createCredsRouter(() => TEST_TOKEN));

  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // /api/status is admin-only now
    const statusNoAuth = await fetch(`${base}/api/status`);
    assert.strictEqual(statusNoAuth.status, 401);
    const statusAuth = await fetch(`${base}/api/status`, { headers: { "X-Ext-Token": TEST_TOKEN } });
    assert.strictEqual(statusAuth.status, 200);
    const status = await statusAuth.json();
    assert.strictEqual(typeof status.killSwitch, "boolean");

    // fleet instances listing is admin-only (was a reconnaissance endpoint)
    const fleetNoAuth = await fetch(`${base}/api/instances`);
    assert.strictEqual(fleetNoAuth.status, 401);

    // /api/ip-echo stays public (used by extension popups)
    const echo = await fetch(`${base}/api/ip-echo`);
    assert.strictEqual(echo.status, 200);
    const echoBody = await echo.json();
    assert.strictEqual(typeof echoBody.ip, "string");

    // /api/sync authenticates in-router with its own token check
    const syncBad = await fetch(`${base}/api/sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.strictEqual(syncBad.status, 403);
    const syncOk = await fetch(`${base}/api/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Ext-Token": TEST_TOKEN },
      body: JSON.stringify({ instanceId: "http-test-worker", version: "1.3.0", group: "QA" }),
    });
    assert.strictEqual(syncOk.status, 200);
    const syncBody = await syncOk.json();
    assert.strictEqual(syncBody.ok, true);

    // /creds requires the extension token
    const credsBad = await fetch(`${base}/creds`);
    assert.strictEqual(credsBad.status, 403);
    const credsOk = await fetch(`${base}/creds`, { headers: { "X-Ext-Token": TEST_TOKEN } });
    assert.strictEqual(credsOk.status, 200);
    const creds = await credsOk.json();
    assert.strictEqual(typeof creds.pass, "string");
    assert.strictEqual(creds.pass.includes("InitialRotatingProxyPass"), false);
  } finally {
    server.close();
  }
});
