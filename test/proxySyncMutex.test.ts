import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import express from "express";
import type { AddressInfo } from "node:net";
import { createProxiesRouter } from "../src/routes/proxiesRoutes.js";
import { setRotationInFlight } from "../src/rotate.js";
import { createProxy } from "../src/proxies.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createProxiesRouter());
  return app;
}

test("Manual Proxy Sync Mutex (M-8): returns 409 Conflict when rotation is in flight", async () => {
  const app = buildApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const proxy = createProxy({
      name: "Test 3x-ui Node",
      type: "3x-ui",
      host: "10.0.0.1",
      port: 1080,
      username: "user1",
      tag: "test-tag",
    });

    // 1. Simulate active rotation in flight
    setRotationInFlight(true);

    const resInFlight = await fetch(`${base}/api/proxies/${proxy.id}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.strictEqual(resInFlight.status, 409, "Must return 409 Conflict when rotation is in flight");
    const bodyInFlight = await resInFlight.json();
    assert.match(bodyInFlight.error || "", /in flight|conflict|rotation/i);

    // 2. Clear rotation in flight - now it should proceed past the guard
    setRotationInFlight(false);

    const resClear = await fetch(`${base}/api/proxies/${proxy.id}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    // Should NOT be 409 anymore (might be 400 because 3x-ui panel is not configured, but NOT 409)
    assert.notStrictEqual(resClear.status, 409, "Must not return 409 when rotation is not in flight");
  } finally {
    setRotationInFlight(false);
    server.close();
  }
});

test("Manual Proxy Sync Mutex (M-8): returns 409 Conflict when concurrent sync is already in flight for the same proxy", async () => {
  const { withHttpServer } = await import("./helpers/http-server.js");
  const { save3xuiPanel } = await import("../src/rotate.js");

  let resolveFirstRequest: () => void = () => {};
  const firstRequestBlocker = new Promise<void>((resolve) => {
    resolveFirstRequest = resolve;
  });

  const { url, close } = await withHttpServer(async (req, res) => {
    if (req.url === "/csrf-token") {
      res.writeHead(404);
      res.end();
      return;
    }
    if (req.url === "/login") {
      res.writeHead(200, { "Content-Type": "application/json", "Set-Cookie": "session=abc" });
      res.end(JSON.stringify({ success: true }));
      return;
    }
    if (req.url === "/panel/api/inbounds/list") {
      // Delay response until we say so
      await firstRequestBlocker;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, obj: [] }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true }));
  });

  const app = buildApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const panel = save3xuiPanel({
      name: "Slow Mock Panel",
      panelUrl: url,
      adminUser: "admin",
      adminPass: "pass",
    });

    const proxy = createProxy({
      name: "Concurrent Test Node",
      type: "3x-ui",
      host: "10.0.0.1",
      port: 1080,
      username: "user1",
      tag: "test-concurrent",
      panelId: panel.id,
    });

    // Launch first sync request (it will pause inside mock server)
    const p1 = fetch(`${base}/api/proxies/${proxy.id}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rotatePassword: false }),
    });

    // Give express a brief moment to enter sync handler and add to activeSyncProxies
    await new Promise((r) => setTimeout(r, 50));

    // Launch second sync request concurrently for the same proxy
    const res2 = await fetch(`${base}/api/proxies/${proxy.id}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rotatePassword: false }),
    });

    assert.strictEqual(res2.status, 409, "Second concurrent sync must return 409 Conflict");
    const body2 = await res2.json();
    assert.match(body2.error || "", /in flight|sync/i);

    // Unblock first request
    resolveFirstRequest();
    await p1;
  } finally {
    resolveFirstRequest();
    server.close();
    await close();
  }
});

