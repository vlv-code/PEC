import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

test("E-1: background.js eliminates MV3 wake-storm by not registering onCompleted/onErrorOccurred listeners", () => {
  const bgPath = path.resolve("extension/background.js");
  const src = fs.readFileSync(bgPath, "utf-8");

  const listeners: Record<string, any[]> = {
    onAuthRequired: [],
    onCompleted: [],
    onErrorOccurred: [],
  };

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
      onAuthRequired: {
        addListener: (fn: any, filter: any) => {
          listeners.onAuthRequired.push({ fn, filter });
        },
      },
      onCompleted: {
        addListener: (fn: any, filter: any) => {
          listeners.onCompleted.push({ fn, filter });
        },
      },
      onErrorOccurred: {
        addListener: (fn: any, filter: any) => {
          listeners.onErrorOccurred.push({ fn, filter });
        },
      },
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

  assert.strictEqual(
    listeners.onCompleted.length,
    0,
    "chrome.webRequest.onCompleted listener must NOT be registered on <all_urls> (causes MV3 wake-storm)"
  );
  assert.strictEqual(
    listeners.onErrorOccurred.length,
    0,
    "chrome.webRequest.onErrorOccurred listener must NOT be registered on <all_urls> (causes MV3 wake-storm)"
  );
  assert.strictEqual(
    listeners.onAuthRequired.length,
    1,
    "chrome.webRequest.onAuthRequired must be the only webRequest listener registered"
  );
});

test("E-1 / E-7: seenRequests stores { count, timestamp } and prunes entries older than 60s when size > 100", async () => {
  const bgPath = path.resolve("extension/background.js");
  const src = fs.readFileSync(bgPath, "utf-8");

  let authListener: any = null;

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
      onAuthRequired: {
        addListener: (fn: any) => { authListener = fn; },
      },
      onCompleted: { addListener: () => {} },
      onErrorOccurred: { addListener: () => {} },
    },
    runtime: {
      getManifest: () => ({ version: "1.0.0" }),
      id: "test-id",
      onMessage: { addListener: () => {} },
    },
  };

  let mockNow = 1000000;
  class MockDate extends Date {
    constructor(...args: any[]) {
      if (args.length === 0) super(mockNow);
      else super(...(args as [any]));
    }
    static now() { return mockNow; }
  }

  const sandbox = {
    chrome: mockChrome,
    console: { log: () => {}, warn: () => {}, error: () => {}, info: () => {} },
    setTimeout,
    clearTimeout,
    Date: MockDate,
    URL,
    fetch: () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ user: "testUser", pass: "testPass" }),
    }),
    AbortSignal,
    Map,
    Promise,
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(src + "\nglobalThis.testSeenRequests = seenRequests;", context);

  assert.ok(authListener, "onAuthRequired listener must be registered");

  // Populate seenRequests with 120 dummy entries older than 60s
  const seenRequestsMap = (context as any).testSeenRequests;
  assert.ok(seenRequestsMap instanceof Map, "seenRequests must be a Map");

  for (let i = 0; i < 120; i++) {
    seenRequestsMap.set("old_req_" + i, { count: 1, timestamp: mockNow - 70000 });
  }
  // Add 5 fresh entries
  for (let i = 0; i < 5; i++) {
    seenRequestsMap.set("fresh_req_" + i, { count: 1, timestamp: mockNow - 10000 });
  }

  assert.strictEqual(seenRequestsMap.size, 125);

  // Trigger onAuthRequired with details.isProxy = true
  let callbackResult: any = null;
  authListener(
    { isProxy: true, requestId: "new_req_test", url: "https://example.com" },
    (res: any) => { callbackResult = res; }
  );

  // Old entries older than 60s must have been pruned because size was > 100
  // Remaining: 5 fresh entries + 1 new_req_test entry = 6 entries
  assert.strictEqual(seenRequestsMap.size, 6, "seenRequests must have pruned entries older than 60s");
  assert.strictEqual(seenRequestsMap.has("fresh_req_0"), true);
  assert.strictEqual(seenRequestsMap.has("old_req_0"), false);

  const newEntry = seenRequestsMap.get("new_req_test");
  assert.ok(newEntry && typeof newEntry === "object", "seenRequests entry must be an object");
  assert.strictEqual(newEntry.count, 1, "entry count must be 1 on first attempt");
  assert.strictEqual(newEntry.timestamp, mockNow, "entry timestamp must be recorded");
});
