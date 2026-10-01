import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { renderPopupJs } from "../src/extensionTemplates.js";

test("popup.js compiles syntactically and contains core action handlers", () => {
  const js = renderPopupJs({
    name: "PEC",
    serverUrl: "https://proxyex.ic-iskra.ru",
  } as any);

  assert.ok(js.includes("btnThemeToggle"), "Theme toggle handler must be registered");
  assert.ok(js.includes("btnSyncNow"), "Sync button handler must be registered");
  assert.ok(js.includes("btnPowerToggle"), "Power button handler must be registered");
  assert.ok(js.includes("btnPauseToggle"), "Pause button handler must be registered");
  assert.ok(js.includes("btnAddCurrentSite"), "Add current site handler must be registered");
  assert.ok(js.includes("btnAddRule"), "Add rule handler must be registered");
  assert.ok(js.includes("/api/ip-echo"), "IP echo must call /api/ip-echo");
  assert.ok(js.includes("SAVE_USER_RULES"), "Must send SAVE_USER_RULES message");
  assert.ok(js.includes("btnTestLatency"), "Latency test button handler must be registered");
  assert.ok(js.includes("pecThemeMode"), "Theme state must be stored in pecThemeMode");
});

test("extension/popup.js compiles syntactically and contains core action handlers", () => {
  const js = fs.readFileSync("extension/popup.js", "utf8");
  assert.ok(js.includes("btnThemeToggle"), "Theme toggle handler must be registered");
  assert.ok(js.includes("btnSyncNow"), "Sync button handler must be registered");
  assert.ok(js.includes("btnPowerToggle"), "Power button handler must be registered");
  assert.ok(js.includes("btnPauseToggle"), "Pause button handler must be registered");
  assert.ok(js.includes("btnAddCurrentSite"), "Add current site handler must be registered");
  assert.ok(js.includes("btnAddRule"), "Add rule handler must be registered");
  assert.ok(js.includes("/api/ip-echo"), "IP echo must call /api/ip-echo");
  assert.ok(js.includes("SAVE_USER_RULES"), "Must send SAVE_USER_RULES message");
  assert.ok(js.includes("btnTestLatency"), "Latency test button handler must be registered");
  assert.ok(js.includes("pecThemeMode"), "Theme state must be stored in pecThemeMode");
});

function createMockEnvironment(scriptText: string) {
  const classListMap: Record<string, Set<string>> = {};
  const getClassList = (id: string) => {
    if (!classListMap[id]) classListMap[id] = new Set<string>();
    return {
      add: (cls: string) => classListMap[id].add(cls),
      remove: (cls: string) => classListMap[id].delete(cls),
      contains: (cls: string) => classListMap[id].has(cls),
    };
  };

  const elements: Record<string, any> = {
    statusText: { textContent: "", title: "", className: "", addEventListener: () => {} },
    heroStatusText: { textContent: "", title: "", className: "", addEventListener: () => {} },
    statusPill: { textContent: "", title: "", className: "", addEventListener: () => {} },
    badge: { textContent: "", title: "", className: "", addEventListener: () => {} },
    statusOrb: { textContent: "", title: "", className: "", addEventListener: () => {} },
    modeVal: { textContent: "", title: "", className: "", addEventListener: () => {} },
    serverVal: { textContent: "", title: "", className: "", addEventListener: () => {} },
    profileVal: { textContent: "", title: "", className: "", addEventListener: () => {} },
    pingVal: { textContent: "", title: "", className: "", addEventListener: () => {} },
    exitIpVal: { textContent: "", title: "", className: "", addEventListener: () => {} },
    tabRulesDefaultPolicy: { textContent: "", title: "", className: "", addEventListener: () => {} },
    btnToggleBypass: { textContent: "", title: "", className: "", addEventListener: () => {} },
    btnPowerLabel: { textContent: "", title: "", className: "", addEventListener: () => {} },
    btnPauseLabel: { textContent: "", title: "", className: "", addEventListener: () => {} },
    btnPowerToggle: { textContent: "", title: "", className: "", style: {}, addEventListener: () => {} },
    btnSyncNow: { textContent: "", title: "", className: "", querySelector: () => null, addEventListener: () => {} },
    btnCheckIp: { textContent: "", title: "", className: "", addEventListener: () => {} },
    btnTestLatency: { textContent: "", title: "", className: "", addEventListener: () => {} },
    "tab-content-conn": { id: "tab-content-conn", classList: getClassList("tab-content-conn") },
    "tab-content-routing": { id: "tab-content-routing", classList: getClassList("tab-content-routing") },
    "tab-content-diag": { id: "tab-content-diag", classList: getClassList("tab-content-diag") },
    "tab-btn-conn": { id: "tab-btn-conn", classList: getClassList("tab-btn-conn") },
    "tab-btn-routing": { id: "tab-btn-routing", classList: getClassList("tab-btn-routing") },
    "tab-btn-diag": { id: "tab-btn-diag", classList: getClassList("tab-btn-diag") },
  };

  const allTabs = [
    { classList: getClassList("tab-btn-conn"), addEventListener: () => {} },
    { classList: getClassList("tab-btn-routing"), addEventListener: () => {} },
    { classList: getClassList("tab-btn-diag"), addEventListener: () => {} },
  ];
  const allContents = [
    { classList: getClassList("tab-content-conn") },
    { classList: getClassList("tab-content-routing") },
    { classList: getClassList("tab-content-diag") },
  ];

  const ctx = vm.createContext({
    window: {
      addEventListener: () => {},
    },
    setInterval,
    clearInterval,
    document: {
      getElementById: (id: string) => elements[id] || null,
      querySelector: (sel: string) => {
        if (sel.includes("tab-content-conn")) return elements["tab-btn-conn"];
        if (sel.includes("tab-content-routing")) return elements["tab-btn-routing"];
        if (sel.includes("tab-content-diag")) return elements["tab-btn-diag"];
        return null;
      },
      querySelectorAll: (sel: string) => {
        if (sel === ".tab-btn") return allTabs;
        if (sel === ".tab-content") return allContents;
        return [];
      },
      body: {
        getAttribute: () => "dark",
        setAttribute: () => {},
      },
      addEventListener: () => {},
    },
    console,
  });

  vm.runInContext(scriptText, ctx);
  return { ctx: ctx as any, elements, classListMap };
}

test("tab switching logic activates target tab and removes active from others", () => {
  const js = fs.readFileSync("extension/popup.js", "utf8");
  const { ctx, classListMap } = createMockEnvironment(js);

  assert.ok(typeof ctx.window.switchPopupTab === "function", "switchPopupTab must be exposed globally");

  ctx.window.switchPopupTab("tab-content-routing");
  assert.ok(classListMap["tab-content-routing"].has("active"), "Routing tab content must be active");
  assert.ok(!classListMap["tab-content-conn"].has("active"), "Connection tab content must not be active");

  ctx.window.switchPopupTab("tab-content-diag");
  assert.ok(classListMap["tab-content-diag"].has("active"), "Diag tab content must be active");
  assert.ok(!classListMap["tab-content-routing"].has("active"), "Routing tab content must not be active");
});

test("applyPopupState correctly handles bypass, disabled power, and tunnel policy", () => {
  const js = fs.readFileSync("extension/popup.js", "utf8");
  const { ctx, elements } = createMockEnvironment(js);

  // 1. Online + active PAC
  ctx.window.applyPopupState({
    online: true,
    enabled: true,
    protocol: "pac",
    profileDefaultPolicy: "direct",
    host: "10.0.0.1",
    port: 10809,
  });
  assert.strictEqual(elements.statusText.textContent, "Активен");
  assert.strictEqual(elements.btnPowerLabel.textContent, "Отключить");
  assert.strictEqual(elements.modeVal.textContent, "PAC (селективный)");

  // 2. Power disabled
  ctx.window.applyPopupState({
    online: true,
    enabled: false,
    protocol: "pac",
  });
  assert.strictEqual(elements.statusText.textContent, "Отключен");
  assert.strictEqual(elements.btnPowerLabel.textContent, "Включить");

  // 3. Bypass active
  ctx.window.applyPopupState({
    online: true,
    enabled: true,
    bypassActive: true,
    bypassExpiresAt: Date.now() + 600000,
  });
  assert.strictEqual(elements.statusText.textContent, "Обход");
  assert.ok(elements.badge.className.includes("bypass"));
  assert.ok(elements.btnPauseLabel.textContent.includes("Пауза"));

  // 4. Reset bypass so timer stops
  ctx.window.applyPopupState({ bypassActive: false });
});

test("popup.js and renderPopupJs defensively filter user rules", () => {
  const rawJs = fs.readFileSync("extension/popup.js", "utf8");
  assert.ok(rawJs.includes('rules || []).filter(r => r && typeof r.pattern === "string")'), "popup.js must filter invalid rules defensively");

  const generatedJs = renderPopupJs({ name: "PEC", serverUrl: "https://proxyex.ic-iskra.ru" } as any);
  assert.ok(generatedJs.includes('rules || []).filter(r => r && typeof r.pattern === "string")'), "renderPopupJs must filter invalid rules defensively");
});

test("btnCheckIp in popup.js and renderPopupJs queries public IP services first with fallbacks", () => {
  const rawJs = fs.readFileSync("extension/popup.js", "utf8");
  assert.ok(rawJs.includes("api.ipify.org"), "popup.js must query api.ipify.org");
  assert.ok(rawJs.includes("icanhazip.com"), "popup.js must have icanhazip.com fallback");

  const generatedJs = renderPopupJs({ name: "PEC", serverUrl: "https://proxyex.ic-iskra.ru" } as any);
  assert.ok(generatedJs.includes("api.ipify.org"), "renderPopupJs must query api.ipify.org");
  assert.ok(generatedJs.includes("icanhazip.com"), "renderPopupJs must have icanhazip.com fallback");
});

