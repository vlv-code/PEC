import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

test("background.js: restoreStartupState awaits asynchronous storage callbacks before resolving", async () => {
  const bgPath = path.resolve("extension/background.js");
  const src = fs.readFileSync(bgPath, "utf-8");

  let localCallback: any = null;
  let sessionCallback: any = null;

  let messageListener: any = null;
  const mockChrome = {
    storage: {
      local: {
        get: (_keys: string[], cb: (res: any) => void) => {
          localCallback = cb;
        },
        set: () => {},
      },
      session: {
        get: (_keys: string[], cb: (res: any) => void) => {
          sessionCallback = cb;
        },
        set: () => {},
      },
    },
    alarms: {
      get: async () => null,
      create: () => {},
      onAlarm: { addListener: () => {} },
    },
    privacy: { network: { webRTCIPHandlingPolicy: { set: () => {} } } },
    action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
    proxy: { settings: { set: () => {} } },
    webRequest: {
      onAuthRequired: { addListener: () => {} },
      onCompleted: { addListener: () => {} },
      onErrorOccurred: { addListener: () => {} },
    },
    runtime: {
      getManifest: () => ({ version: "1.0.0" }),
      id: "test-ext-id",
      onMessage: {
        addListener: (fn: any) => {
          messageListener = fn;
        },
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

  // restoreStartupState function is defined in the script context
  assert.ok(localCallback, "storage.local.get callback must be registered");
  assert.ok(sessionCallback, "storage.session.get callback must be registered");

  let resolved = false;
  const p = (context as any).restoreStartupState().then(() => {
    resolved = true;
  });

  // Advance microticks
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(resolved, false, "restoreStartupState must NOT resolve while storage callbacks are pending");

  // Call session storage callback
  sessionCallback!({
    pecCredsCache: { user: "sessionUser", pass: "sessionPass", fetchedAt: Date.now() },
  });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(resolved, false, "restoreStartupState must NOT resolve until both storage callbacks complete");

  // Call local storage callback
  localCallback!({
    pecProxyState: { activeProxyId: "proxy_test_1" },
    pecInstanceToken: "inst_tok_999",
  });

  await p;
  assert.strictEqual(resolved, true, "restoreStartupState must resolve once storage callbacks have executed");

  let statusResponse: any = null;
  assert.ok(messageListener, "onMessage listener must be registered");
  messageListener({ action: "GET_STATUS" }, {}, (res: any) => {
    statusResponse = res;
  });
  assert.strictEqual(statusResponse?.activeProxyId, "proxy_test_1");
});
