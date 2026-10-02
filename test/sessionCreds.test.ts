import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { BACKGROUND_TEMPLATE } from "../src/extensionTemplates.js";

test("A3: zero-persistence credentials use chrome.storage.session and avoid chrome.storage.local", async (t) => {
  await t.test("BACKGROUND_TEMPLATE static audit confirms pecCredsCache is session-only", () => {
    // 1. chrome.storage.local must NOT write credentials
    assert.strictEqual(
      BACKGROUND_TEMPLATE.includes("chrome.storage.local.set({ pecCredsCache"),
      false,
      "chrome.storage.local.set must never be called with pecCredsCache"
    );

    // 2. chrome.storage.local startup read must NOT query pecCredsCache
    assert.strictEqual(
      BACKGROUND_TEMPLATE.includes('"pecCredsCache", "pecBasePac"'),
      false,
      "chrome.storage.local.get startup query must not include pecCredsCache"
    );

    // 3. chrome.storage.session MUST be used for pecCredsCache
    assert.ok(
      BACKGROUND_TEMPLATE.includes("sessionStore.set({ pecCredsCache"),
      "sessionStore.set must be called with pecCredsCache"
    );
    assert.ok(
      BACKGROUND_TEMPLATE.includes('sessionStore.get(["pecCredsCache"]'),
      "sessionStore.get must be called for pecCredsCache"
    );

    // 4. Parity with extension/background.js
    const bgJs = fs.readFileSync(path.resolve(process.cwd(), "extension/background.js"), "utf8");
    assert.strictEqual(
      bgJs.includes("chrome.storage.local.set({ pecCredsCache"),
      false,
      "extension/background.js must never write pecCredsCache to local storage"
    );
    assert.ok(
      bgJs.includes("sessionStore.set({ pecCredsCache"),
      "extension/background.js must write pecCredsCache to session storage"
    );
  });

  await t.test("runtime execution saves credentials to session storage and leaves local storage clean", async () => {
    const sessionStorageData: Record<string, any> = {};
    const localStorageData: Record<string, any> = {};

    const mockChrome = {
      storage: {
        session: {
          get: (keys: string[], cb: (res: any) => void) => {
            const res: Record<string, any> = {};
            for (const k of keys) res[k] = sessionStorageData[k];
            if (cb) cb(res);
            return Promise.resolve(res);
          },
          set: (obj: Record<string, any>, cb?: () => void) => {
            Object.assign(sessionStorageData, obj);
            if (cb) cb();
            return Promise.resolve();
          },
        },
        local: {
          get: (keys: string[], cb: (res: any) => void) => {
            const res: Record<string, any> = {};
            for (const k of keys) res[k] = localStorageData[k];
            if (cb) cb(res);
            return Promise.resolve(res);
          },
          set: (obj: Record<string, any>, cb?: () => void) => {
            Object.assign(localStorageData, obj);
            if (cb) cb();
            return Promise.resolve();
          },
        },
        managed: { get: () => Promise.resolve({}) },
      },
      webRequest: {
        onAuthRequired: { addListener: () => {} },
        onCompleted: { addListener: () => {} },
        onErrorOccurred: { addListener: () => {} },
      },
      proxy: {
        settings: {
          set: (_cfg: any, cb: any) => { if (cb) cb(); return Promise.resolve(); },
          get: (_cfg: any, cb: any) => { if (cb) cb({ levelOfControl: "controlled_by_this_extension", value: { mode: "pac_script" } }); return Promise.resolve({}); },
          onChange: { addListener: () => {} },
        },
      },
      privacy: {
        network: {
          webRTCIPHandlingPolicy: {
            set: (_cfg: any, cb: any) => { if (cb) cb(); return Promise.resolve(); },
          },
        },
      },
      alarms: {
        create: () => {},
        get: (_n: any, cb: any) => cb && cb(null),
        clear: () => {},
        onAlarm: { addListener: () => {} },
      },
      runtime: {
        id: "test-id",
        getManifest: () => ({ version: "1.0.0" }),
        onInstalled: { addListener: () => {} },
        onStartup: { addListener: () => {} },
        onMessage: { addListener: () => {} },
      },
      action: {
        setBadgeText: () => {},
        setBadgeBackgroundColor: () => {},
      },
    };

    const substituted = BACKGROUND_TEMPLATE
      .replace(/__PEC_SERVER_BASE__/g, "https://mock.server.corp")
      .replace(/__PEC_DEFAULT_HOST__/g, "proxy.corp")
      .replace(/__PEC_DEFAULT_PORT__/g, "8080")
      .replace(/__PEC_DEFAULT_PROFILE__/g, "1")
      .replace(/__PEC_ROUTING_MODE__/g, "pac")
      .replace(/__PEC_ROUTING_VALUE__/g, "https://mock.server.corp/proxy.pac")
      .replace(/__PEC_DIRECT_FALLBACK__/g, "true")
      .replace(/__PEC_SYNC_INTERVAL_MIN__/g, "15")
      .replace(/__PEC_EXT_SHARED_TOKEN__/g, "test-shared-token")
      .replace(/__PEC_MANAGED_POLICY__/g, "false");

    const mockFetch = async (url: string) => {
      if (url.includes("/api/sync")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            profile: "1",
            host: "proxy.corp",
            port: 8080,
            routingMode: "fixed",
            creds: { user: "secUser", pass: "secPass" },
          }),
        };
      }
      return { ok: false, status: 404 };
    };

    const sandbox = {
      chrome: mockChrome,
      console,
      fetch: mockFetch,
      setTimeout: (fn: Function) => setTimeout(fn, 0),
      clearTimeout,
      setInterval: () => 1,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Error,
      TypeError,
      Promise,
      AbortSignal,
      URL,
      Map,
    };

    const context = vm.createContext(sandbox);
    vm.runInContext(substituted, context);

    // Wait microtasks
    await new Promise((r) => setTimeout(r, 50));

    // Verify: pecCredsCache must exist in sessionStorageData
    assert.ok(sessionStorageData.pecCredsCache, "pecCredsCache must be stored in chrome.storage.session");
    assert.strictEqual(sessionStorageData.pecCredsCache.user, "secUser");
    assert.strictEqual(sessionStorageData.pecCredsCache.pass, "secPass");

    // Verify: pecCredsCache must NEVER exist in localStorageData
    assert.strictEqual(
      localStorageData.pecCredsCache,
      undefined,
      "pecCredsCache must never be written to chrome.storage.local"
    );
  });
});
