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

test("H-3: applyPacScript sets mandatory: true in chrome.proxy.settings.set and caches lastKnownGoodPacText on success", async () => {
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

  // Assert mandatory: true is enforced
  assert.ok(appliedProxySettings, "proxy settings must be applied");
  assert.strictEqual(appliedProxySettings.value.mode, "pac_script");
  assert.strictEqual(appliedProxySettings.value.pacScript.mandatory, true, "mandatory must be true");

  // Assert lastKnownGoodPacText was cached in chrome.storage.local
  assert.ok(localStorageData.lastKnownGoodPacText, "lastKnownGoodPacText must be cached");
  assert.ok(localStorageData.lastKnownGoodPacText.includes("FindProxyForURL"));
});

test("H-3: applyPacScript falls back to lastKnownGoodPacText with amber badge when PAC set fails", async () => {
  const bgPath = path.resolve("extension/background.js");
  const src = fs.readFileSync(bgPath, "utf-8");

  const lastKnownGood = "function FindProxyForURL(url, host) { return 'PROXY fallback.corp:1080'; }";
  const localStorageData: Record<string, any> = {
    lastKnownGoodPacText: lastKnownGood,
  };

  let badgeText = "";
  let badgeColor = "";
  const setAttempts: any[] = [];

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
    action: {
      setBadgeText: (d: any) => { badgeText = d.text; },
      setBadgeBackgroundColor: (d: any) => { badgeColor = d.color; },
    },
    proxy: {
      settings: {
        set: (cfg: any) => {
          setAttempts.push(cfg);
          // Fail the first PAC set (the new PAC)
          if (setAttempts.length === 1) {
            return Promise.reject(new Error("Invalid PAC script or network error"));
          }
          // Succeed on fallback
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
      onMessage: { addListener: () => {} },
    },
  };

  const brokenPac = "function FindProxyForURL(url, host) { throw 'broken'; }";
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
          text: () => Promise.resolve(brokenPac),
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
  await applyPacScript("https://127.0.0.1:3000/pac", { host: "127.0.0.1", port: 10809 }, true);

  // Assert fallback was attempted with lastKnownGoodPacText
  assert.strictEqual(setAttempts.length, 2, "must attempt fallback after first set fails");
  assert.strictEqual(setAttempts[1].value.pacScript.data, lastKnownGood);
  assert.strictEqual(setAttempts[1].value.pacScript.mandatory, true);

  // Assert warning amber badge
  assert.strictEqual(badgeText, "●");
  assert.strictEqual(badgeColor, "#f59e0b");
});

test("H-3: applyPacScript sets red error badge if PAC set fails and fallback is unavailable", async () => {
  const bgPath = path.resolve("extension/background.js");
  const src = fs.readFileSync(bgPath, "utf-8");

  let badgeText = "";
  let badgeColor = "";

  const mockChrome = {
    storage: {
      local: {
        get: (_keys: string[], cb?: any) => {
          if (cb) cb({});
          return Promise.resolve({});
        },
        set: () => Promise.resolve(),
      },
      session: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
      managed: { get: () => Promise.resolve({}) },
    },
    alarms: { create: () => {}, get: (_n: any, cb: any) => cb && cb(null), onAlarm: { addListener: () => {} }, clear: () => {} },
    privacy: { network: { webRTCIPHandlingPolicy: { set: () => Promise.resolve() } } },
    action: {
      setBadgeText: (d: any) => { badgeText = d.text; },
      setBadgeBackgroundColor: (d: any) => { badgeColor = d.color; },
    },
    proxy: {
      settings: {
        set: () => Promise.reject(new Error("Fatal PAC failure")),
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
      onMessage: { addListener: () => {} },
    },
  };

  const brokenPac = "function FindProxyForURL(url, host) { throw 'broken'; }";
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
          text: () => Promise.resolve(brokenPac),
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
  await assert.rejects(async () => {
    await applyPacScript("https://127.0.0.1:3000/pac", { host: "127.0.0.1", port: 10809 }, true);
  });

  // Badge must be red error badge (#ef4444)
  assert.strictEqual(badgeColor, "#ef4444");
  assert.ok(badgeText === "ERR" || badgeText === "●");
});

test("H-3: applyPacScript falls back to lastKnownGoodPacText from storage when fetch(pacUrl) fails (HTTP 403 / network error)", async () => {
  const bgPath = path.resolve("extension/background.js");
  const src = fs.readFileSync(bgPath, "utf-8");

  const lastKnownGood = "function FindProxyForURL(url, host) { return 'PROXY fallback.corp:1080'; }";
  const localStorageData: Record<string, any> = {
    lastKnownGoodPacText: lastKnownGood,
  };

  let badgeText = "";
  let badgeColor = "";
  let appliedConfig: any = null;

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
    action: {
      setBadgeText: (d: any) => { badgeText = d.text; },
      setBadgeBackgroundColor: (d: any) => { badgeColor = d.color; },
    },
    proxy: {
      settings: {
        set: (cfg: any) => {
          appliedConfig = cfg;
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
    fetch: () => {
      // Simulate PAC download failure (e.g. 403 Forbidden from expired signed PAC URL)
      return Promise.resolve({ ok: false, status: 403 });
    },
    AbortSignal,
    Map,
    Promise,
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(src, context);

  const applyPacScript = (context as any).applyPacScript;
  await applyPacScript("https://127.0.0.1:3000/pac?signature=expired", { host: "127.0.0.1", port: 10809 }, true);

  // Must fall back to inline PAC from storage with mandatory: true
  assert.ok(appliedConfig, "proxy settings must be applied");
  assert.strictEqual(appliedConfig.value.mode, "pac_script");
  assert.strictEqual(appliedConfig.value.pacScript.data, lastKnownGood, "must use lastKnownGoodPacText from storage");
  assert.strictEqual(appliedConfig.value.pacScript.mandatory, true, "mandatory must be true");

  // Warning amber badge must be displayed
  assert.strictEqual(badgeText, "●");
  assert.strictEqual(badgeColor, "#f59e0b");
});

test("H-3: applyPacScript sets red error badge when fetch(pacUrl) fails and fallback is unavailable", async () => {
  const bgPath = path.resolve("extension/background.js");
  const src = fs.readFileSync(bgPath, "utf-8");

  let badgeText = "";
  let badgeColor = "";

  const mockChrome = {
    storage: {
      local: {
        get: (_keys: string[], cb?: any) => {
          if (cb) cb({});
          return Promise.resolve({});
        },
        set: () => Promise.resolve(),
      },
      session: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
      managed: { get: () => Promise.resolve({}) },
    },
    alarms: { create: () => {}, get: (_n: any, cb: any) => cb && cb(null), onAlarm: { addListener: () => {} }, clear: () => {} },
    privacy: { network: { webRTCIPHandlingPolicy: { set: () => Promise.resolve() } } },
    action: {
      setBadgeText: (d: any) => { badgeText = d.text; },
      setBadgeBackgroundColor: (d: any) => { badgeColor = d.color; },
    },
    proxy: {
      settings: {
        set: () => Promise.reject(new Error("Chrome proxy configuration failed")),
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
    fetch: () => Promise.resolve({ ok: false, status: 500 }),
    AbortSignal,
    Map,
    Promise,
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(src, context);

  const applyPacScript = (context as any).applyPacScript;
  await assert.rejects(async () => {
    await applyPacScript("https://127.0.0.1:3000/pac", { host: "127.0.0.1", port: 10809 }, true);
  });

  // Badge must be red error badge (#ef4444)
  assert.strictEqual(badgeColor, "#ef4444");
  assert.ok(badgeText === "ERR" || badgeText === "●");
});

test("H-7: 407 storm dedup under syncExecutionQueue collapses concurrent forced auth retries within 2000ms window", async () => {
  const bgPath = path.resolve("extension/background.js");
  const src = fs.readFileSync(bgPath, "utf-8");

  let fetchCount = 0;
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

  let currentTime = 1000000;
  const sandbox = {
    chrome: mockChrome,
    console: { log: () => {}, warn: () => {}, error: () => {}, info: () => {} },
    setTimeout,
    clearTimeout,
    Date: class extends Date {
      static now() {
        return currentTime;
      }
    },
    URL,
    fetch: async (url: string) => {
      if (url.includes("/api/sync")) {
        fetchCount++;
        return {
          ok: true,
          json: async () => ({
            activeProxyId: "default-proxy",
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
  // Advance time past the 2000ms freshness window so the 407 challenge requires a fetch
  currentTime += 5000;
  fetchCount = 0;

  // Simulate 3 concurrent 407 challenges triggering forced creds refresh (applyConfig: false)
  const results = await Promise.all([
    syncWithServer(true, false, undefined),
    syncWithServer(true, false, undefined),
    syncWithServer(true, false, undefined),
  ]);

  // All 3 callers must get valid creds
  assert.strictEqual(results[0]?.user, "u");
  assert.strictEqual(results[1]?.user, "u");
  assert.strictEqual(results[2]?.user, "u");

  // Only 1 fetch must be sent to server to prevent 429 rate limit storm
  assert.strictEqual(fetchCount, 1, "407 storm must dedup concurrent forced syncs into a single fetch");
});

test("H-7: syncWithServer serializes requests in mutex execution queue so manual proxy selection is not clobbered", async () => {
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
            // Heartbeat sync
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
            // User manual proxy switch
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

    // Launch routine heartbeat sync
    const p1 = syncWithServer(true, true, undefined);

    // Wait until first fetch has definitely begun
    while (!firstFetchStarted) {
      await new Promise((r) => setTimeout(r, 5));
    }

    // User immediately switches proxy while heartbeat is still pending
    const p2 = syncWithServer(true, true, "user-proxy");

    // Wait 50ms while heartbeat fetch is still held in-flight
    await new Promise((r) => setTimeout(r, 50));

    // Release the first fetch
    resolveFirstFetch();

    await Promise.all([p1, p2]);

    // Verify sequential execution order: heartbeat must finish before user switch executes
    assert.deepStrictEqual(executionLog, [
      "start:heartbeat",
      "finish:heartbeat",
      "start:user-switch:user-proxy",
      "finish:user-switch:user-proxy",
    ]);

    // Current proxy state must retain user selection
    let statusResponse: any = null;
    messageListener({ action: "GET_STATUS" }, {}, (res: any) => {
      statusResponse = res;
    });
    assert.strictEqual(statusResponse?.activeProxyId, "user-proxy");
  });


