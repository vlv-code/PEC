import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { BACKGROUND_TEMPLATE } from "../src/templates/backgroundTemplate.js";

test("BACKGROUND_TEMPLATE includes 3-tier WebRTC protection", () => {
  assert.ok(
    BACKGROUND_TEMPLATE.includes("webRTCIPHandlingPolicy"),
    "BACKGROUND_TEMPLATE must configure webRTCIPHandlingPolicy"
  );
  assert.ok(
    BACKGROUND_TEMPLATE.includes("webRTCMultipleRoutesEnabled"),
    "BACKGROUND_TEMPLATE must configure webRTCMultipleRoutesEnabled"
  );
  assert.ok(
    BACKGROUND_TEMPLATE.includes("webRTCNonProxiedUdpEnabled"),
    "BACKGROUND_TEMPLATE must configure webRTCNonProxiedUdpEnabled"
  );
});

test("applyWebRtcProtection enforces all three privacy policies", async () => {
  const policyCalls: Record<string, any> = {};

  const mockChrome = {
    privacy: {
      network: {
        webRTCIPHandlingPolicy: {
          set: (obj: any) => {
            policyCalls.webRTCIPHandlingPolicy = obj;
            return Promise.resolve();
          },
        },
        webRTCMultipleRoutesEnabled: {
          set: (obj: any) => {
            policyCalls.webRTCMultipleRoutesEnabled = obj;
            return Promise.resolve();
          },
        },
        webRTCNonProxiedUdpEnabled: {
          set: (obj: any) => {
            policyCalls.webRTCNonProxiedUdpEnabled = obj;
            return Promise.resolve();
          },
        },
      },
    },
    storage: {
      local: {
        get: (_keys: any, cb: any) => cb && cb({}),
        set: () => Promise.resolve(),
      },
    },
    action: {
      setBadgeText: () => {},
      setBadgeBackgroundColor: () => {},
    },
    proxy: {
      settings: {
        set: () => Promise.resolve(),
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
    alarms: {
      create: () => {},
      get: (_n: any, cb: any) => cb && cb(null),
      onAlarm: { addListener: () => {} },
    },
  };

  const sandbox = {
    chrome: mockChrome,
    console,
    setTimeout,
    clearTimeout,
    Date,
    URL,
    fetch: () => Promise.resolve({ ok: false }),
    AbortSignal,
    Map,
  };

  const context = vm.createContext(sandbox);
  // Run background template to define applyWebRtcProtection and trigger initial boot
  vm.runInContext(BACKGROUND_TEMPLATE, context);

  // Give microtasks a turn to resolve
  await new Promise((r) => setTimeout(r, 50));

  assert.equal(
    policyCalls.webRTCIPHandlingPolicy?.value,
    "disable_non_proxied_udp",
    "webRTCIPHandlingPolicy must be set to disable_non_proxied_udp"
  );
  assert.equal(
    policyCalls.webRTCMultipleRoutesEnabled?.value,
    false,
    "webRTCMultipleRoutesEnabled must be set to false"
  );
  assert.equal(
    policyCalls.webRTCNonProxiedUdpEnabled?.value,
    false,
    "webRTCNonProxiedUdpEnabled must be set to false"
  );
});
