import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
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

test("Extension PAC Settings (H-3): enforces mandatory: true and caches lastKnownGoodPacText in storage", async () => {
  const bgPath = path.resolve("extension/background.js");
  const src = fs.readFileSync(bgPath, "utf-8");

  let appliedProxySettings: any = null;
  const localStorageData: Record<string, any> = {};

  const mockChrome = {
    storage: {
      local: {
        get: (keys: string[] | string, cb?: any) => {
          const res: Record<string, any> = {};
          const arr = Array.isArray(keys) ? keys : [keys];
          for (const k of arr) {
            if (k in localStorageData) res[k] = localStorageData[k];
          }
          if (cb) cb(res);
          return Promise.resolve(res);
        },
        set: (items: Record<string, any>, cb?: any) => {
          Object.assign(localStorageData, items);
          if (cb) cb();
          return Promise.resolve();
        },
      },
      session: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
      managed: { get: () => Promise.resolve({}) },
    },
    alarms: { create: () => {}, get: (_n: any, cb: any) => cb && cb(null), onAlarm: { addListener: () => {} }, clear: () => {} },
    privacy: { network: { webRTCIPHandlingPolicy: { set: () => Promise.resolve() } } },
    action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
    proxy: {
      settings: {
        set: (cfg: any) => {
          appliedProxySettings = cfg;
          return Promise.resolve();
        },
        get: () => Promise.resolve({ value: appliedProxySettings?.value }),
      },
    },
    webRequest: {
      onAuthRequired: { addListener: () => {} },
      onCompleted: { addListener: () => {} },
      onErrorOccurred: { addListener: () => {} },
    },
    runtime: {
      getManifest: () => ({ version: "1.0.0" }),
      id: "test-id",
      onMessage: { addListener: () => {} },
    },
  };

  const pacContent = "function FindProxyForURL(url, host) { return 'DIRECT'; }";
  const sandbox = {
    chrome: mockChrome,
    console: { log: () => {}, warn: () => {}, error: () => {}, info: () => {} },
    setTimeout,
    clearTimeout,
    Date,
    URL,
    fetch: (url: string) => {
      if (url.includes("pac")) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(pacContent),
        });
      }
      return Promise.resolve({ ok: false });
    },
    AbortSignal,
    Map,
    Promise,
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(src, context);

  const applyPacScript = (context as any).applyPacScript;
  assert.strictEqual(typeof applyPacScript, "function");

  await applyPacScript("https://127.0.0.1:3000/pac", { host: "127.0.0.1", port: 10809 }, true);

  assert.ok(appliedProxySettings, "proxy settings must be applied");
  assert.strictEqual(appliedProxySettings.value.mode, "pac_script");
  assert.strictEqual(appliedProxySettings.value.pacScript.mandatory, true, "mandatory must be true");
  assert.ok(localStorageData.lastKnownGoodPacText, "lastKnownGoodPacText must be cached");
});

test("Extension Proxy Sync Mutex (H-7): syncWithServer queues sync requests sequentially preventing clobbering", async () => {
  const bgPath = path.resolve("extension/background.js");
  const src = fs.readFileSync(bgPath, "utf-8");

  let messageListener: any = null;
  const mockChrome = {
    storage: {
      local: {
        get: (_keys: string[], cb?: any) => { cb && cb({}); return Promise.resolve({}); },
        set: () => Promise.resolve(),
      },
      session: {
        get: (_keys: string[], cb?: any) => { cb && cb({}); return Promise.resolve({}); },
        set: () => Promise.resolve(),
      },
      managed: { get: () => Promise.resolve({}) },
    },
    alarms: { create: () => {}, get: (_n: any, cb: any) => cb && cb(null), onAlarm: { addListener: () => {} }, clear: () => {} },
    privacy: { network: { webRTCIPHandlingPolicy: { set: () => Promise.resolve() } } },
    action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
    proxy: {
      settings: {
        set: () => Promise.resolve(),
        get: () => Promise.resolve({ value: { mode: "fixed_servers" } }),
      },
    },
    webRequest: {
      onAuthRequired: { addListener: () => {} },
      onCompleted: { addListener: () => {} },
      onErrorOccurred: { addListener: () => {} },
    },
    runtime: {
      getManifest: () => ({ version: "1.0.0" }),
      id: "test-id",
      onMessage: {
        addListener: (fn: any) => { messageListener = fn; },
      },
    },
  };

  let blockFetch = false;
  let firstFetchStarted = false;
  let resolveFirstFetch: any = null;
  const firstFetchPromise = new Promise((resolve) => {
    resolveFirstFetch = resolve;
  });

  const executionLog: string[] = [];

  const sandbox = {
    chrome: mockChrome,
    console: { log: () => {}, warn: () => {}, error: () => {}, info: () => {} },
    setTimeout,
    clearTimeout,
    Date,
    URL,
    fetch: async (url: string, opts: any) => {
      if (url.includes("/api/sync")) {
        const body = opts && opts.body ? JSON.parse(opts.body) : {};
        if (body.selectedProxyId === undefined) {
          if (blockFetch) {
            firstFetchStarted = true;
            executionLog.push("start:heartbeat");
            await firstFetchPromise;
            executionLog.push("finish:heartbeat");
          }
          return {
            ok: true,
            json: async () => ({
              activeProxyId: "default-proxy",
              availableProxies: [{ id: "default-proxy" }, { id: "user-proxy" }],
              config: { protocol: "http", host: "10.0.0.1", port: 8080 },
              creds: { user: "u", pass: "p" },
            }),
          };
        } else {
          executionLog.push(`start:user-switch:${body.selectedProxyId}`);
          executionLog.push(`finish:user-switch:${body.selectedProxyId}`);
          return {
            ok: true,
            json: async () => ({
              activeProxyId: body.selectedProxyId,
              availableProxies: [{ id: "default-proxy" }, { id: "user-proxy" }],
              config: { protocol: "http", host: "10.0.0.2", port: 8080 },
              creds: { user: "u", pass: "p" },
            }),
          };
        }
      }
      return { ok: false };
    },
    AbortSignal,
    Map,
    Promise,
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(src, context);

  const syncWithServer = (context as any).syncWithServer;
  assert.strictEqual(typeof syncWithServer, "function");

  // Allow initial service-worker boot sync to settle
  await new Promise((r) => setTimeout(r, 20));
  executionLog.length = 0;
  blockFetch = true;

  const p1 = syncWithServer(true, true, undefined);

  while (!firstFetchStarted) {
    await new Promise((r) => setTimeout(r, 5));
  }

  const p2 = syncWithServer(true, true, "user-proxy");

  await new Promise((r) => setTimeout(r, 50));
  resolveFirstFetch();

  await Promise.all([p1, p2]);

  assert.deepStrictEqual(executionLog, [
    "start:heartbeat",
    "finish:heartbeat",
    "start:user-switch:user-proxy",
    "finish:user-switch:user-proxy",
  ]);

  let statusResponse: any = null;
  messageListener({ action: "GET_STATUS" }, {}, (res: any) => {
    statusResponse = res;
  });
  assert.strictEqual(statusResponse?.activeProxyId, "user-proxy");
});

test("Extension Proxy Sync Mutex (H-7): queue continues processing subsequent requests when preceding sync fails", async () => {
  const bgPath = path.resolve("extension/background.js");
  const src = fs.readFileSync(bgPath, "utf-8");

  const mockChrome = {
    storage: {
      local: {
        get: (_keys: string[], cb?: any) => { cb && cb({}); return Promise.resolve({}); },
        set: () => Promise.resolve(),
      },
      session: {
        get: (_keys: string[], cb?: any) => { cb && cb({}); return Promise.resolve({}); },
        set: () => Promise.resolve(),
      },
      managed: { get: () => Promise.resolve({}) },
    },
    alarms: { create: () => {}, get: (_n: any, cb: any) => cb && cb(null), onAlarm: { addListener: () => {} }, clear: () => {} },
    privacy: { network: { webRTCIPHandlingPolicy: { set: () => Promise.resolve() } } },
    action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
    proxy: {
      settings: {
        set: () => Promise.resolve(),
        get: () => Promise.resolve({ value: { mode: "fixed_servers" } }),
      },
    },
    webRequest: {
      onAuthRequired: { addListener: () => {} },
      onCompleted: { addListener: () => {} },
      onErrorOccurred: { addListener: () => {} },
    },
    runtime: {
      getManifest: () => ({ version: "1.0.0" }),
      id: "test-id",
      onMessage: { addListener: () => {} },
    },
  };

  let failNext = false;
  const executionOrder: string[] = [];

  const sandbox = {
    chrome: mockChrome,
    console: { log: () => {}, warn: () => {}, error: () => {}, info: () => {} },
    setTimeout,
    clearTimeout,
    Date,
    URL,
    fetch: async (url: string) => {
      if (url.includes("/api/sync")) {
        if (failNext) {
          failNext = false;
          executionOrder.push("fail-first");
          throw new Error("Network offline");
        }
        executionOrder.push("succeed-second");
        return {
          ok: true,
          json: async () => ({
            activeProxyId: "recovered-proxy",
            config: { protocol: "http", host: "10.0.0.1", port: 8080 },
            creds: { user: "u", pass: "p" },
          }),
        };
      }
      return { ok: false };
    },
    AbortSignal,
    Map,
    Promise,
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(src, context);

  const syncWithServer = (context as any).syncWithServer;

  // Settle boot sync
  await new Promise((r) => setTimeout(r, 20));
  executionOrder.length = 0;
  failNext = true;

  // Launch failing request, and immediately queue a second request
  const p1 = syncWithServer(true, true, undefined);
  const p2 = syncWithServer(true, true, "recovered-proxy");

  // p1 must reject with the network error
  await assert.rejects(async () => {
    await p1;
  });

  // p2 must execute and succeed despite p1 rejecting
  const res2 = await p2;
  assert.ok(res2, "second request must succeed");
  assert.deepStrictEqual(executionOrder, ["fail-first", "succeed-second"]);
});



