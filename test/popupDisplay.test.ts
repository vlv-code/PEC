import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function evaluatePopup(popupScript: string, elements: Record<string, any> = {}) {
  const defaultElements: Record<string, any> = {
    statusText: { textContent: "", className: "" },
    heroStatusText: { textContent: "" },
    badge: { textContent: "", className: "" },
    statusPill: { textContent: "", className: "" },
    statusOrb: { className: "" },
    modeVal: { textContent: "", title: "" },
    serverVal: { textContent: "" },
    profileVal: { textContent: "" },
    pingVal: { textContent: "" },
    exitIpVal: { textContent: "" },
    webrtcVal: { textContent: "", className: "" },
    dnsVal: { textContent: "", className: "" },
    tabRulesDefaultPolicy: { textContent: "" },
    btnToggleBypass: { textContent: "" },
    btnSyncNow: { addEventListener: () => {} },
    btnPowerToggle: { addEventListener: () => {}, classList: { toggle: () => {} }, style: {} },
    btnPauseToggle: { addEventListener: () => {}, classList: { toggle: () => {} } },
    btnTestLatency: { addEventListener: (_ev: string, cb: any) => { defaultElements.btnTestLatency.handler = cb; }, disabled: false, textContent: "Тест" },
    btnCheckIp: { addEventListener: () => {} },
  };

  const mergedElements = { ...defaultElements, ...elements };

  const sandbox = {
    window: {
      addEventListener: () => {},
      __pecServerBase: "",
    },
    document: {
      getElementById: (id: string) => mergedElements[id] || null,
      querySelectorAll: () => [],
      readyState: "complete",
      addEventListener: () => {},
      body: {
        setAttribute: () => {},
        getAttribute: () => "dark",
      },
    },
    chrome: {
      storage: {
        local: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
        onChanged: { addListener: () => {} },
      },
      runtime: {
        sendMessage: () => {},
        lastError: null,
      },
      tabs: { query: () => {} },
    },
    console: { log: () => {}, warn: () => {}, error: () => {}, info: () => {} },
    setTimeout,
    clearTimeout,
    Date,
    URL,
    fetch: () => Promise.reject(new Error("Network failed")),
    AbortController: globalThis.AbortController,
    Promise,
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(popupScript, context);
  return { context, elements: mergedElements };
}

test("E-10: popup.js displays real WebRTC and DNS status based on active config", () => {
  const popupJsPath = path.resolve("extension/popup.js");
  const src = fs.readFileSync(popupJsPath, "utf-8");

  // 1. WebRTC enabled in config, proxy enabled
  const { context: ctx1, elements: el1 } = evaluatePopup(src);
  (ctx1 as any).window.applyPopupState({
    online: true,
    enabled: true,
    bypassActive: false,
    webRtcProtection: true,
    dnsProtection: false,
  });

  assert.strictEqual(el1.webrtcVal.textContent, "Защищено (без утечки UDP)");
  assert.strictEqual(el1.webrtcVal.className, "val success-val");
  assert.strictEqual(el1.dnsVal.textContent, "Системный");
  assert.strictEqual(el1.dnsVal.className, "val");

  // 2. WebRTC disabled in config (webRtcProtection: false)
  const { context: ctx2, elements: el2 } = evaluatePopup(src);
  (ctx2 as any).window.applyPopupState({
    online: true,
    enabled: true,
    bypassActive: false,
    webRtcProtection: false,
  });

  assert.strictEqual(el2.webrtcVal.textContent, "Отключено");
  assert.strictEqual(el2.webrtcVal.className, "val warn-val");

  // 3. Custom DNS active
  const { context: ctx3, elements: el3 } = evaluatePopup(src);
  (ctx3 as any).window.applyPopupState({
    online: true,
    enabled: true,
    bypassActive: false,
    dnsProtection: true,
  });

  assert.strictEqual(el3.dnsVal.textContent, "Включена");
  assert.strictEqual(el3.dnsVal.className, "val success-val");

  // 4. Proxy disabled or bypassed -> WebRTC is Disabled (Direct)
  const { context: ctx4, elements: el4 } = evaluatePopup(src);
  (ctx4 as any).window.applyPopupState({
    online: true,
    enabled: true,
    bypassActive: true,
    webRtcProtection: true,
  });

  assert.strictEqual(el4.webrtcVal.textContent, "Отключено (Direct)");
  assert.strictEqual(el4.webrtcVal.className, "val warn-val");
});

test("E-17: btnTestLatency displays 'Недоступен' when ping fails instead of synthetic ping time", async () => {
  const popupJsPath = path.resolve("extension/popup.js");
  const src = fs.readFileSync(popupJsPath, "utf-8");

  const { context, elements } = evaluatePopup(src);
  (context as any).window.applyPopupState({
    online: true,
    enabled: true,
    bypassActive: false,
  });

  // Trigger latency test click handler where all fetches fail
  const handler = elements.btnTestLatency.handler;
  assert.ok(handler, "btnTestLatency click handler must be registered");

  await handler();

  assert.strictEqual(
    elements.pingVal.textContent,
    "Недоступен",
    "pingVal must show 'Недоступен' when pinging fails"
  );
});
