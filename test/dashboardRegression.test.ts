import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import { setupDashboardDom } from "./helpers/dashboardDom.js";

// ============================================================================
// Group 1: Инициализация и переключение вкладок (Proxies, Studio, Telemetry, Presets)
// ============================================================================

test("dashboard regression: 1.1 default tab initialization activates routing tab", () => {
  const env = setupDashboardDom({ authenticated: true });
  try {
    const { document, window } = env;

    assert.equal(typeof window.switchTab, "function", "window.switchTab must be exposed globally on window");
    assert.equal(typeof window.openEditRuleModal, "function", "window.openEditRuleModal must be exposed globally on window");

    const routingBtn = document.getElementById("tabBtnRouting");
    const routingPane = document.getElementById("tab-routing");

    assert.ok(routingBtn, "Routing tab button #tabBtnRouting must exist");
    assert.ok(routingPane, "Routing pane #tab-routing must exist");

    assert.ok(routingBtn.classList.contains("active"), "Routing tab button must be active by default");
    assert.equal(routingBtn.getAttribute("aria-selected"), "true", "Routing tab button must have aria-selected='true'");
    assert.ok(routingPane.classList.contains("active"), "Routing pane must have active class by default");

    const proxyBtn = document.getElementById("tabBtnProxySettings");
    assert.ok(proxyBtn, "Proxy settings tab button must exist");
    assert.equal(proxyBtn.classList.contains("active"), false, "Proxy tab button must not be active on start");
    assert.equal(proxyBtn.getAttribute("aria-selected"), "false", "Proxy tab button must have aria-selected='false'");
  } finally {
    env.teardown();
  }
});

test("dashboard regression: 1.2 tab switching to Proxies activates proxy pane and fetches proxies", async () => {
  const env = setupDashboardDom({ authenticated: true });
  try {
    const { window, document, fetchCalls } = env;

    // Switch to proxy settings
    assert.equal(typeof window.switchTab, "function", "window.switchTab must be a function on window");
    window.switchTab("proxy-settings");

    const proxyBtn = document.getElementById("tabBtnProxySettings");
    const proxyPane = document.getElementById("tab-proxy-settings");
    const routingBtn = document.getElementById("tabBtnRouting");
    const routingPane = document.getElementById("tab-routing");

    assert.ok(proxyBtn?.classList.contains("active"), "Proxy tab button must be active after switch");
    assert.equal(proxyBtn?.getAttribute("aria-selected"), "true", "Proxy tab button must have aria-selected='true'");
    assert.ok(proxyPane?.classList.contains("active"), "Proxy pane #tab-proxy-settings must have active class");

    assert.equal(routingBtn?.classList.contains("active"), false, "Routing tab button must lose active class");
    assert.equal(routingPane?.classList.contains("active"), false, "Routing pane must lose active class");

    const fetchedProxies = fetchCalls.some((c) => c.url === "/api/proxies");
    assert.ok(fetchedProxies, "Switching to Proxies tab must fetch /api/proxies");
  } finally {
    env.teardown();
  }
});

test("dashboard regression: 1.3 tab switching to Studio activates app-studio pane and loads config", async () => {
  const env = setupDashboardDom({ authenticated: true });
  try {
    const { window, document, fetchCalls } = env;

    if (typeof window.switchTab === "function") {
      window.switchTab("app-studio");
    } else {
      const btn = document.getElementById("tabBtnAppStudio");
      btn?.click();
    }

    const appStudioBtn = document.getElementById("tabBtnAppStudio");
    const appStudioPane = document.getElementById("tab-app-studio");

    assert.ok(appStudioBtn?.classList.contains("active"), "App Studio tab button must be active after switch");
    assert.equal(appStudioBtn?.getAttribute("aria-selected"), "true", "App Studio tab button must have aria-selected='true'");
    assert.ok(appStudioPane?.classList.contains("active"), "App Studio pane #tab-app-studio must have active class");

    const fetchedConfig = fetchCalls.some((c) => c.url === "/api/app-builder/config");
    assert.ok(fetchedConfig, "Switching to App Studio tab must fetch /api/app-builder/config");
  } finally {
    env.teardown();
  }
});

test("dashboard regression: 1.4 tab switching to Telemetry activates fleet pane and loads instances", async () => {
  const env = setupDashboardDom({ authenticated: true });
  try {
    const { window, document, fetchCalls } = env;

    // 'instances' / 'fleet' tab
    if (typeof window.switchTab === "function") {
      window.switchTab("instances");
    } else {
      const btn = document.getElementById("tabBtnInstances");
      btn?.click();
    }

    const fleetBtn = document.getElementById("tabBtnInstances");
    const fleetPane = document.getElementById("tab-instances");

    assert.ok(fleetBtn?.classList.contains("active"), "Fleet tab button must be active after switch");
    assert.equal(fleetBtn?.getAttribute("aria-selected"), "true", "Fleet tab button must have aria-selected='true'");
    assert.ok(fleetPane?.classList.contains("active"), "Fleet pane #tab-instances must have active class");

    // Allow async loadInstances fetch chain (/api/proxies -> /api/instances) to complete
    await new Promise((r) => setTimeout(r, 60));

    const fetchedInstances = fetchCalls.some((c) => c.url === "/api/instances");
    assert.ok(fetchedInstances, "Switching to Telemetry/Fleet tab must fetch /api/instances");
  } finally {
    env.teardown();
  }
});

test("dashboard regression: 1.5 presets load and render into routing container", async () => {
  const mockPresets = [
    {
      id: "preset-corp-vpn",
      name: "Corporate VPN & Split",
      description: "Routes corporate intranets through SOCKS5 proxy",
      rulesCount: 15,
      domains: ["corp.internal", "jira.corp.local"],
      ips: ["10.0.0.0/8"],
      applied: false,
    },
    {
      id: "preset-cloud-bypass",
      name: "Cloud Direct Access",
      description: "Bypasses proxy for direct public cloud access",
      rulesCount: 8,
      domains: ["aws.amazon.com", "azure.microsoft.com"],
      ips: [],
      applied: true,
    },
  ];

  const env = setupDashboardDom({
    authenticated: true,
    customResponses: {
      "/api/routing/presets": mockPresets,
    },
  });

  try {
    const { window, document } = env;

    // Boot calls loadPresets()
    const container = document.getElementById("presetsContainer");
    assert.ok(container, "Presets container #presetsContainer must exist in routing tab");

    // Allow async render
    await new Promise((r) => setTimeout(r, 50));

    const html = container.innerHTML;
    assert.ok(html.includes("Corporate VPN &amp; Split") || html.includes("Corporate VPN & Split"), "Preset name must be rendered in DOM");
    assert.ok(html.includes("Cloud Direct Access"), "Second preset name must be rendered in DOM");
  } finally {
    env.teardown();
  }
});

// ============================================================================
// Group 2: Применение и переключение тем оформления
// ============================================================================

test("dashboard regression: 2.1 server layout switching updates data-layout and localStorage", () => {
  const env = setupDashboardDom({ authenticated: true });
  try {
    const { window, document } = env;

    // Switch to terminal layout
    window.setServerLayout("terminal");
    assert.equal(document.body.getAttribute("data-layout"), "terminal", "body[data-layout] must be 'terminal'");
    assert.equal(window.localStorage.getItem("pec_server_layout"), "terminal", "localStorage must store 'terminal'");

    // Switch to console layout
    window.setServerLayout("console");
    assert.equal(document.body.getAttribute("data-layout"), "console", "body[data-layout] must be 'console'");
    assert.equal(window.localStorage.getItem("pec_server_layout"), "console", "localStorage must store 'console'");

    // Invalid fallback defaults to console
    window.setServerLayout("invalid-layout-value");
    assert.equal(document.body.getAttribute("data-layout"), "console", "Invalid layout must fallback to 'console'");
  } finally {
    env.teardown();
  }
});

test("dashboard regression: 2.2 server palette switching updates data-theme across all presets", () => {
  const env = setupDashboardDom({ authenticated: true });
  try {
    const { window, document } = env;

    const palettes = ["obsidian", "nord", "emerald", "cyber"];
    for (const pal of palettes) {
      window.setServerTheme(pal);
      assert.equal(document.body.getAttribute("data-theme"), pal, `body[data-theme] must be '${pal}'`);
      assert.equal(window.localStorage.getItem("pec_server_theme"), pal, `localStorage must store '${pal}'`);
    }

    // Default fallback
    window.setServerTheme("");
    assert.equal(document.body.getAttribute("data-theme"), "cyber", "Empty theme must fallback to 'cyber'");
  } finally {
    env.teardown();
  }
});

test("dashboard regression: 2.3 server theme mode switching toggles dark and light modes", () => {
  const env = setupDashboardDom({ authenticated: true });
  try {
    const { window, document } = env;

    window.setServerThemeMode("light");
    assert.equal(document.body.getAttribute("data-theme-mode"), "light", "body[data-theme-mode] must be 'light'");
    assert.equal(window.localStorage.getItem("pec_server_theme_mode"), "light", "localStorage must store 'light'");

    window.setServerThemeMode("dark");
    assert.equal(document.body.getAttribute("data-theme-mode"), "dark", "body[data-theme-mode] must be 'dark'");
    assert.equal(window.localStorage.getItem("pec_server_theme_mode"), "dark", "localStorage must store 'dark'");

    // Invalid mode defaults to dark
    window.setServerThemeMode("invalid-mode");
    assert.equal(document.body.getAttribute("data-theme-mode"), "dark", "Invalid mode must fallback to 'dark'");
  } finally {
    env.teardown();
  }
});

test("dashboard regression: 2.4 app studio theme presets update form inputs and theme colors", () => {
  const env = setupDashboardDom({ authenticated: true });
  try {
    const { window, document } = env;

    // Apply minimal-light preset
    window.setAppPresetTheme("minimal-light");

    const presetInput = document.getElementById("appPresetStyle") as HTMLSelectElement | HTMLInputElement;
    const colorInput = document.getElementById("appThemeColor") as HTMLInputElement;
    const bgInput = document.getElementById("appThemeBackground") as HTMLInputElement;
    const cardInput = document.getElementById("appThemeCard") as HTMLInputElement;

    assert.ok(presetInput, "appPresetStyle element must exist");
    assert.ok(colorInput, "appThemeColor element must exist");
    assert.ok(bgInput, "appThemeBackground element must exist");
    assert.ok(cardInput, "appThemeCard element must exist");

    assert.equal(presetInput.value, "minimal-light", "Preset style must be set to 'minimal-light'");
    // Background in minimal-light must be light palette (#f8fafc or similar)
    assert.ok(bgInput.value.toLowerCase().startsWith("#f"), `Light background must be light hex, got: ${bgInput.value}`);

    // Apply cyber-blue preset
    window.setAppPresetTheme("cyber-blue");
    assert.equal(presetInput.value, "cyber-blue", "Preset style must be set to 'cyber-blue'");
    assert.ok(bgInput.value.toLowerCase().startsWith("#0"), `Dark cyber background must be dark hex, got: ${bgInput.value}`);

    // Set palette to nord
    window.setAppPalette("nord");
    assert.equal(presetInput.value, "nordic-arctic", "Preset style must be 'nordic-arctic' after setAppPalette('nord')");
  } finally {
    env.teardown();
  }
});

// ============================================================================
// Group 3: Сохранение конфигурации App Studio
// ============================================================================

test("dashboard regression: 3.1 App Studio form collects form values into config payload", async () => {
  const env = setupDashboardDom({ authenticated: true });
  try {
    const { window, document, fetchCalls } = env;

    // Allow initial background theme sync save to settle
    await new Promise((r) => setTimeout(r, 60));

    // Populate App Studio inputs
    const nameEl = document.getElementById("appBuildName") as HTMLInputElement;
    const shortNameEl = document.getElementById("appBuildShortName") as HTMLInputElement;
    const verEl = document.getElementById("appBuildVersion") as HTMLInputElement;
    const syncEl = document.getElementById("appSyncIntervalMinutes") as HTMLInputElement;
    const autoStartEl = document.getElementById("appAutoStart") as HTMLInputElement;

    if (nameEl) nameEl.value = "Custom Enterprise Proxy Client";
    if (shortNameEl) shortNameEl.value = "EntClient";
    if (verEl) verEl.value = "3.0.1";
    if (syncEl) syncEl.value = "30";
    if (autoStartEl) autoStartEl.checked = true;

    env.setMockResponse("/api/app-builder/config", { ok: true, version: "3.0.1" });

    // Call save action
    const savePromise = window.saveAppStudioConfigAction(true);
    const result = await savePromise;

    assert.equal(result, true, "saveAppStudioConfigAction must return true on success");

    const saveCall = fetchCalls
      .filter((c) => c.url === "/api/app-builder/config" && c.method === "POST")
      .pop();
    assert.ok(saveCall, "Must execute POST /api/app-builder/config");

    const payload = JSON.parse(saveCall.body);
    assert.equal(payload.name, "Custom Enterprise Proxy Client");
    assert.equal(payload.shortName, "EntClient");
    assert.equal(payload.version, "3.0.1");
    assert.equal(payload.syncIntervalMinutes, 30);
    assert.equal(payload.autoStartWithWindows, true);
  } finally {
    env.teardown();
  }
});

test("dashboard regression: 3.2 App Studio successful save resets isAppStudioDirty and restores button", async () => {
  const env = setupDashboardDom({ authenticated: true });
  try {
    const { window, document } = env;

    const saveBtn = document.getElementById("btnAppSaveConfig") as HTMLButtonElement;
    assert.ok(saveBtn, "#btnAppSaveConfig must exist");

    env.setMockResponse("/api/app-builder/config", { ok: true, name: "PEC - Client" });

    // Allow initial background theme sync save to settle
    await new Promise((r) => setTimeout(r, 60));

    // Set dirty flag
    window.isAppStudioDirty = true;
    assert.equal(window.isAppStudioDirty, true, "Precondition: isAppStudioDirty must be true");

    const success = await window.saveAppStudioConfigAction(true);

    assert.equal(success, true, "save action must return true on success response");
    assert.equal(window.isAppStudioDirty, false, "isAppStudioDirty must be reset to false on success");
    assert.equal(saveBtn.disabled, false, "Save button must be re-enabled after completion");
  } finally {
    env.teardown();
  }
});

test("dashboard regression: 3.3 App Studio save failure preserves isAppStudioDirty and re-enables button", async () => {
  const env = setupDashboardDom({ authenticated: true });
  try {
    const { window, document } = env;

    const saveBtn = document.getElementById("btnAppSaveConfig") as HTMLButtonElement;
    assert.ok(saveBtn, "#btnAppSaveConfig must exist");

    // Mock API error
    env.setMockResponse("/api/app-builder/config:status", 500);
    env.setMockResponse("/api/app-builder/config", { ok: false, error: "Disk write error" });

    // Allow initial background theme sync save to settle
    await new Promise((r) => setTimeout(r, 60));

    window.isAppStudioDirty = true;

    const result = await window.saveAppStudioConfigAction(true);

    assert.equal(result, false, "save action must return false when server returns 500");
    assert.equal(window.isAppStudioDirty, true, "isAppStudioDirty must remain true when save fails");
    assert.equal(saveBtn.disabled, false, "Save button must not remain disabled on failure");
  } finally {
    env.teardown();
  }
});
