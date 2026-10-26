import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

test("E-2: isValidUrl enforces HTTPS for remote URLs and allows HTTP only on localhost/127.0.0.1", () => {
  const bgPath = path.resolve("extension/background.js");
  const src = fs.readFileSync(bgPath, "utf-8");

  const mockChrome = {
    storage: {
      local: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
      session: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
      managed: { get: () => Promise.resolve({}) },
    },
    alarms: { create: () => {}, get: (_n: any, cb: any) => cb && cb(null), onAlarm: { addListener: () => {} } },
    privacy: { network: { webRTCIPHandlingPolicy: { set: () => Promise.resolve() } } },
    action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
    proxy: { settings: { set: () => Promise.resolve() } },
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

  const sandbox = {
    chrome: mockChrome,
    console: { log: () => {}, warn: () => {}, error: () => {}, info: () => {} },
    setTimeout,
    clearTimeout,
    Date,
    URL,
    fetch: () => Promise.resolve({ ok: false }),
    AbortSignal,
    Map,
    Promise,
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(src, context);

  const isValidUrl = (context as any).isValidUrl;
  assert.strictEqual(typeof isValidUrl, "function", "isValidUrl must be defined");

  // Valid HTTPS remote URLs
  assert.strictEqual(isValidUrl("https://sync.example.corp/api/sync"), true);
  assert.strictEqual(isValidUrl("https://10.0.0.1:8443/creds"), true);

  // Insecure HTTP on remote hosts must be REJECTED (E-2)
  assert.strictEqual(isValidUrl("http://sync.example.corp/api/sync"), false);
  assert.strictEqual(isValidUrl("http://192.168.1.100:3000/api/sync"), false);
  assert.strictEqual(isValidUrl("http://evil.com/"), false);

  // Insecure HTTP on loopback / localhost is ALLOWED for local dev / testing
  assert.strictEqual(isValidUrl("http://localhost:3000/api/sync"), true);
  assert.strictEqual(isValidUrl("http://127.0.0.1:3000/api/sync"), true);
  assert.strictEqual(isValidUrl("https://localhost:3000/api/sync"), true);
  assert.strictEqual(isValidUrl("https://127.0.0.1:3000/api/sync"), true);

  // Invalid inputs
  assert.strictEqual(isValidUrl("javascript:alert(1)"), false);
  assert.strictEqual(isValidUrl("not a url"), false);
  assert.strictEqual(isValidUrl(null), false);
  assert.strictEqual(isValidUrl(undefined), false);
  assert.strictEqual(isValidUrl(123), false);
});

test("E-4: GET_STATUS message waits for restoreStartupState to complete before replying", async () => {
  const bgPath = path.resolve("extension/background.js");
  const src = fs.readFileSync(bgPath, "utf-8");

  let localCb: any = null;
  let sessionCb: any = null;
  let messageListener: any = null;

  const mockChrome = {
    storage: {
      local: {
        get: (_keys: string[], cb: any) => { localCb = cb; },
        set: () => Promise.resolve(),
      },
      session: {
        get: (_keys: string[], cb: any) => { sessionCb = cb; },
        set: () => Promise.resolve(),
      },
      managed: { get: () => Promise.resolve({}) },
    },
    alarms: { create: () => {}, get: (_n: any, cb: any) => cb && cb(null), onAlarm: { addListener: () => {} } },
    privacy: { network: { webRTCIPHandlingPolicy: { set: () => Promise.resolve() } } },
    action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
    proxy: { settings: { set: () => Promise.resolve() } },
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

  const sandbox = {
    chrome: mockChrome,
    console: { log: () => {}, warn: () => {}, error: () => {}, info: () => {} },
    setTimeout,
    clearTimeout,
    Date,
    URL,
    fetch: () => Promise.resolve({ ok: false }),
    AbortSignal,
    Map,
    Promise,
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(src, context);

  assert.ok(messageListener, "onMessage listener must be registered");
  assert.ok(localCb, "storage.local.get callback must be registered");

  // Send GET_STATUS BEFORE storage callbacks execute (cold-start race condition)
  interface StatusResponse {
    host: string;
    port: number;
    online: boolean;
  }
  let statusResponse: StatusResponse | null = null;
  const getStatus = (): StatusResponse | null => statusResponse;

  const returnedTrue = messageListener({ action: "GET_STATUS" }, {}, (res: any) => {
    statusResponse = res;
  });
  assert.strictEqual(returnedTrue, true, "onMessage must return true for async message handling");
  assert.strictEqual(getStatus(), null, "GET_STATUS must NOT reply with empty state before storage resolves");

  // Now simulate storage resolution
  if (sessionCb) sessionCb({});
  if (localCb) {
    localCb({
      pecProxyState: {
        host: "restored.proxy.corp",
        port: 10808,
        online: true,
        protocol: "socks5",
      },
    });
  }

  // Allow microtasks to settle
  await new Promise((r) => setImmediate(r));

  const response = getStatus();
  assert.ok(response, "GET_STATUS must reply once restoreStartupState completes");
  assert.strictEqual(response.host, "restored.proxy.corp");
  assert.strictEqual(response.port, 10808);
  assert.strictEqual(response.online, true);
});

test("E-5: TOGGLE_BYPASS immediately sets chrome.proxy.settings to direct locally before remote sync", async () => {
  const bgPath = path.resolve("extension/background.js");
  const src = fs.readFileSync(bgPath, "utf-8");

  let appliedProxySettings: any = null;
  let messageListener: any = null;

  const mockChrome = {
    storage: {
      local: {
        get: (_keys: string[], cb: any) => { cb && cb({}); return Promise.resolve({}); },
        set: () => Promise.resolve(),
      },
      session: {
        get: (_keys: string[], cb: any) => { cb && cb({}); return Promise.resolve({}); },
        set: () => Promise.resolve(),
      },
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
        get: () => Promise.resolve({ value: { mode: "pac_script" } }),
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

  // Mock fetch that hangs or fails to simulate remote server being down
  const sandbox = {
    chrome: mockChrome,
    console: { log: () => {}, warn: () => {}, error: () => {}, info: () => {} },
    setTimeout,
    clearTimeout,
    Date,
    URL,
    fetch: () => Promise.reject(new Error("Remote server unreachable")),
    AbortSignal,
    Map,
    Promise,
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(src, context);

  // Trigger TOGGLE_BYPASS
  let bypassResponse: any = null;
  messageListener({ action: "TOGGLE_BYPASS" }, {}, (res: any) => {
    bypassResponse = res;
  });

  // Give local async calls a moment to execute
  await new Promise((r) => setImmediate(r));

  // The local chrome.proxy.settings must have been set to direct IMMEDIATELY
  assert.ok(appliedProxySettings, "chrome.proxy.settings.set must be called locally on TOGGLE_BYPASS");
  assert.strictEqual(
    appliedProxySettings?.value?.mode,
    "direct",
    "chrome.proxy.settings mode must be 'direct' without waiting for remote sync"
  );
});
