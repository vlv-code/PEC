import "./helpers/setup.js";
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { renderDashboardHtml } from "../src/views/dashboardView.js";
import { setupDashboardDom } from "./helpers/dashboardDom.js";

test("Task 4: Fleet table includes Proxy Server column and dashboard.js handles assignment", () => {
  const html = renderDashboardHtml();
  assert.ok(html.includes("Прокси-сервер") || html.includes("Прокси-нода"), "table header must include Proxy column");

  const js = fs.readFileSync(path.resolve("public/dashboard.js"), "utf8");
  assert.ok(js.includes("/api/instances/assign-proxy"), "dashboard.js must post to /api/instances/assign-proxy");
  assert.ok(js.includes("select-instance-proxy"), "dashboard.js must bind select-instance-proxy");
});

test("D-01 regression: loadInstances() executes in JSDOM environment without ReferenceError", async () => {
  const env = setupDashboardDom({
    customResponses: {
      "/api/proxies": [
        { id: "proxy-corp-1", name: "Primary Proxy", host: "10.0.0.1", port: 10808, protocol: "socks5", isActive: true },
        { id: "proxy-corp-2", name: "Backup Proxy", host: "10.0.0.2", port: 10809, protocol: "http", isActive: false },
      ],
      "/api/instances": {
        online: 2,
        instances: [
          {
            instanceId: "inst-alpha",
            username: "operator@corp.local",
            ip: "10.0.1.100",
            version: "1.0.0",
            group: "Finance",
            appliedProfileName: "Corporate PAC",
            syncCount: 15,
            status: "ONLINE",
            tokenHash: "token-hash-alpha",
            assignedProxyId: "proxy-corp-1",
          },
          {
            instanceId: "inst-beta",
            username: "developer@corp.local",
            ip: "10.0.1.101",
            version: "1.0.0",
            group: "Dev",
            appliedProfileName: "Default PAC",
            syncCount: 4,
            status: "OFFLINE",
            tokenHash: "",
            assignedProxyId: "",
          },
        ],
      },
      "/api/app/instances": {
        online: 1,
        instances: [
          {
            appInstanceId: "app-alpha",
            hostname: "FINANCE-PC",
            username: "operator",
            ip: "10.0.1.100",
            version: "2.1.0",
            status: "ONLINE",
            assignedProxyId: "proxy-corp-1",
            lastSync: new Date().toISOString(),
          },
        ],
      },
      "/api/routing/profiles": [
        { id: "prof-corp", name: "Corporate PAC", defaultPolicy: "direct" },
        { id: "prof-default", name: "Default PAC", defaultPolicy: "direct" },
      ],
    },
  });

  try {
    // Functions must be present in window scope
    assert.strictEqual(typeof env.window.loadInstances, "function", "loadInstances must be a function in window scope");
    assert.strictEqual(typeof env.window.loadDesktopInstances, "function", "loadDesktopInstances must be a function in window scope");
    assert.strictEqual(typeof env.window.initFleetListeners, "function", "initFleetListeners must be a function in window scope");

    // Execute loadInstances() in real DOM environment
    await assert.doesNotReject(async () => {
      await env.window.loadInstances();
    }, "loadInstances must not reject or throw");

    // Wait for asynchronous loadDesktopInstances() to finish its fetch & render
    await new Promise((r) => setTimeout(r, 80));

    // Verify no ReferenceError or TypeError was caught and logged during execution
    const referenceErrors = env.loggedErrors.filter((args) =>
      args.some((arg) => String(arg).includes("ReferenceError") || (arg instanceof Error && arg.name === "ReferenceError"))
    );
    assert.strictEqual(
      referenceErrors.length,
      0,
      `loadInstances() must not produce ReferenceError: ${JSON.stringify(referenceErrors.map((e) => String(e[0])))}`
    );

    assert.strictEqual(
      env.loggedErrors.length,
      0,
      `loadInstances() must not log any errors to console: ${JSON.stringify(env.loggedErrors.map((e) => String(e[0])))}`
    );

    // Verify DOM updates on fleet table
    const tbody = env.document.getElementById("fleetTableBody");
    assert.ok(tbody, "fleetTableBody must exist in DOM");
    const rows = tbody.querySelectorAll("tr");
    assert.strictEqual(rows.length, 2, "fleetTableBody must render 2 rows for the 2 instances");

    const badgeFleetOnline = env.document.getElementById("badgeFleetOnline");
    assert.ok(badgeFleetOnline, "badgeFleetOnline element must exist");
    assert.ok(
      badgeFleetOnline.textContent?.includes("2 онлайн") || badgeFleetOnline.textContent?.includes("2 online"),
      "badgeFleetOnline must display online count"
    );

    // Verify proxy dropdowns in rows
    const proxySelects = tbody.querySelectorAll(".select-instance-proxy");
    assert.strictEqual(proxySelects.length, 2, "each row must include a .select-instance-proxy element");
    const firstProxySelect = proxySelects[0] as HTMLSelectElement;
    assert.strictEqual(firstProxySelect.value, "proxy-corp-1", "first instance must have assignedProxyId selected");

    // Verify profile dropdowns in rows
    const profileSelects = tbody.querySelectorAll(".select-instance-profile");
    assert.strictEqual(profileSelects.length, 2, "each row must include a .select-instance-profile element");

    // Verify desktop instances table was rendered by loadDesktopInstances()
    const desktopTbody = env.document.getElementById("desktopFleetTableBody");
    assert.ok(desktopTbody, "desktopFleetTableBody must exist");
    assert.ok(desktopTbody.innerHTML.includes("FINANCE-PC"), "desktopFleetTableBody must render desktop instance hostname");
    assert.ok(desktopTbody.innerHTML.includes("badge-subtle"), "desktopFleetTableBody must render user badge");

    const badgeDesktopOnline = env.document.getElementById("badgeDesktopOnline");
    assert.ok(badgeDesktopOnline, "badgeDesktopOnline must exist");
    assert.ok(
      badgeDesktopOnline.textContent?.includes("1 онлайн") || badgeDesktopOnline.textContent?.includes("1 online"),
      "badgeDesktopOnline must reflect desktop online count"
    );
  } finally {
    env.teardown();
  }
});

test("Fleet UI: select-instance-proxy change event triggers /api/instances/assign-proxy", async () => {
  const env = setupDashboardDom({
    customResponses: {
      "/api/proxies": [
        { id: "proxy-corp-1", name: "Primary Proxy", host: "10.0.0.1", port: 10808, protocol: "socks5", isActive: true },
        { id: "proxy-corp-2", name: "Backup Proxy", host: "10.0.0.2", port: 10809, protocol: "http", isActive: false },
      ],
      "/api/instances": {
        online: 1,
        instances: [
          {
            instanceId: "inst-interactive-01",
            username: "operator@corp.local",
            ip: "10.0.1.100",
            version: "1.0.0",
            group: "Default Group",
            appliedProfileName: "Corporate PAC",
            syncCount: 1,
            status: "ONLINE",
            assignedProxyId: "proxy-corp-1",
          },
        ],
      },
      "/api/instances/assign-proxy": { ok: true },
    },
  });

  try {
    await env.window.loadInstances();

    const tbody = env.document.getElementById("fleetTableBody");
    assert.ok(tbody, "fleetTableBody must exist");

    const proxySelect = tbody.querySelector(".select-instance-proxy") as HTMLSelectElement;
    assert.ok(proxySelect, "select-instance-proxy element must exist in row");

    // Select alternative proxy
    proxySelect.value = "proxy-corp-2";
    proxySelect.dispatchEvent(new env.window.Event("change", { bubbles: true }));

    // Wait a brief tick for async event handler
    await new Promise((r) => setTimeout(r, 60));

    const assignCall = env.fetchCalls.find((c) => c.url === "/api/instances/assign-proxy");
    assert.ok(assignCall, "changing proxy select must issue request to /api/instances/assign-proxy");
    assert.strictEqual(assignCall.method, "POST");

    const payload = JSON.parse(assignCall.body);
    assert.strictEqual(payload.instanceId, "inst-interactive-01");
    assert.strictEqual(payload.proxyId, "proxy-corp-2");

    assert.strictEqual(env.loggedErrors.length, 0, "no errors must be logged during proxy assignment");
  } finally {
    env.teardown();
  }
});

test("Fleet UI: select-instance-profile change event triggers /api/instances/assign-profile", async () => {
  const env = setupDashboardDom({
    customResponses: {
      "/api/instances": {
        online: 1,
        instances: [
          {
            instanceId: "inst-interactive-02",
            username: "user@corp.local",
            ip: "10.0.1.102",
            version: "1.0.0",
            group: "Default Group",
            appliedProfileName: "Corporate PAC",
            syncCount: 1,
            status: "ONLINE",
            assignedProxyId: "",
          },
        ],
      },
      "/api/routing/profiles": [
        { id: "prof-pac-new", name: "New PAC Profile", defaultPolicy: "direct" },
      ],
      "/api/instances/assign-profile": { ok: true },
    },
  });

  try {
    await env.window.loadProfiles();
    await env.window.loadInstances();

    const tbody = env.document.getElementById("fleetTableBody");
    assert.ok(tbody, "fleetTableBody must exist");

    const profileSelect = tbody.querySelector(".select-instance-profile") as HTMLSelectElement;
    assert.ok(profileSelect, "select-instance-profile element must exist in row");

    profileSelect.value = "prof-pac-new";
    profileSelect.dispatchEvent(new env.window.Event("change", { bubbles: true }));

    await new Promise((r) => setTimeout(r, 60));

    const assignCall = env.fetchCalls.find((c) => c.url === "/api/instances/assign-profile");
    assert.ok(assignCall, "changing profile select must issue request to /api/instances/assign-profile");
    assert.strictEqual(assignCall.method, "POST");

    const payload = JSON.parse(assignCall.body);
    assert.strictEqual(payload.instanceId, "inst-interactive-02");
    assert.strictEqual(payload.profileId, "prof-pac-new");

    assert.strictEqual(env.loggedErrors.length, 0, "no errors must be logged during profile assignment");
  } finally {
    env.teardown();
  }
});

test("Fleet UI: empty fleet state renders placeholder cleanly without crashing", async () => {
  const env = setupDashboardDom({
    customResponses: {
      "/api/instances": { online: 0, instances: [] },
      "/api/app/instances": { online: 0, instances: [] },
    },
  });

  try {
    await env.window.loadInstances();

    assert.strictEqual(env.loggedErrors.length, 0, "loadInstances with empty fleet must not log errors");

    const tbody = env.document.getElementById("fleetTableBody");
    assert.ok(tbody, "fleetTableBody must exist");
    assert.ok(
      tbody.innerHTML.includes("colspan=\"12\""),
      "empty fleetTableBody must render placeholder spanning all 12 columns"
    );

    const desktopTbody = env.document.getElementById("desktopFleetTableBody");
    assert.ok(desktopTbody, "desktopFleetTableBody must exist");
    assert.ok(
      desktopTbody.innerHTML.includes("colspan=\"9\""),
      "empty desktopFleetTableBody must render placeholder spanning 9 columns"
    );
  } finally {
    env.teardown();
  }
});

test("D-07: Interactive tester label specifies X-Ext-Token", () => {
  const html = renderDashboardHtml();
  assert.ok(
    html.includes('<label data-i18n="lblTestToken">X-Ext-Token Header Value</label>'),
    "lblTestToken must specify X-Ext-Token Header Value"
  );
  assert.strictEqual(
    html.includes('<label data-i18n="lblTestToken">X-Admin-Token Header Value</label>'),
    false,
    "lblTestToken must not contain misleading X-Admin-Token"
  );
});

test("D-08: dashboard.css defines required badge, button, and select classes", () => {
  const css = fs.readFileSync(path.resolve("public/dashboard.css"), "utf8");

  const requiredClasses = [
    ".badge-primary",
    ".badge-secondary",
    ".badge-danger",
    ".badge-warning",
    ".badge-subtle",
    ".badge-version",
    ".btn-warning",
    ".btn-primary",
    ".form-select",
    ".form-select-sm",
  ];

  for (const cls of requiredClasses) {
    assert.ok(css.includes(cls), `dashboard.css must include ${cls}`);
  }
});

test("D-08: dead checkGitHubReleases function is removed from dashboard.js", () => {
  const js = fs.readFileSync(path.resolve("public/dashboard.js"), "utf8");
  assert.strictEqual(
    js.includes("function checkGitHubReleases"),
    false,
    "checkGitHubReleases must be removed as dead code"
  );
});

test("UI-01: onConfigChangeLive does not automatically call /api/builder/regenerate", () => {
  const js = fs.readFileSync(path.resolve("public/dashboard.js"), "utf8");
  const match = js.match(/function onConfigChangeLive\(\)\s*\{[\s\S]*?\}/);
  assert.ok(match, "onConfigChangeLive must exist");
  assert.strictEqual(
    match[0].includes("regenerateTemplatesFromConfig"),
    false,
    "onConfigChangeLive must not call regenerateTemplatesFromConfig"
  );
});

test("UI-02: Fleet table renders assignedProfileId as selected in profile dropdown per instance", async () => {
  const env = setupDashboardDom({
    customResponses: {
      "/api/instances": {
        online: 2,
        instances: [
          {
            instanceId: "inst-profile-1",
            username: "user1@corp.local",
            ip: "10.0.1.10",
            version: "1.0.0",
            assignedProfileId: "prof-a",
            status: "ONLINE",
          },
          {
            instanceId: "inst-profile-2",
            username: "user2@corp.local",
            ip: "10.0.1.20",
            version: "1.0.0",
            assignedProfileId: "prof-b",
            status: "ONLINE",
          },
        ],
      },
      "/api/routing/profiles": [
        { id: "prof-a", name: "Profile A", defaultPolicy: "direct" },
        { id: "prof-b", name: "Profile B", defaultPolicy: "direct" },
      ],
    },
  });

  try {
    await env.window.loadProfiles();
    await env.window.loadInstances();

    const tbody = env.document.getElementById("fleetTableBody");
    assert.ok(tbody);

    const selects = tbody.querySelectorAll(".select-instance-profile");
    assert.strictEqual(selects.length, 2);

    const sel1 = selects[0] as HTMLSelectElement;
    assert.strictEqual(sel1.value, "prof-a", "First instance must have prof-a selected");
    const optA1 = sel1.querySelector('option[value="prof-a"]');
    assert.ok(optA1?.hasAttribute("selected"), "option prof-a must have selected attribute");

    const sel2 = selects[1] as HTMLSelectElement;
    assert.strictEqual(sel2.value, "prof-b", "Second instance must have prof-b selected");
    const optB2 = sel2.querySelector('option[value="prof-b"]');
    assert.ok(optB2?.hasAttribute("selected"), "option prof-b must have selected attribute");
  } finally {
    env.teardown();
  }
});

test("UI-04: assignProfileToInstance handles HTTP errors cleanly and displays toast", async () => {
  const env = setupDashboardDom({
    customResponses: {
      "/api/instances/assign-profile": { error: "Profile not found or revoked" },
      "/api/instances/assign-profile:status": 400,
    },
  });

  try {
    const toastCalls: string[] = [];
    env.window.toast = (msg: string, type: string) => {
      toastCalls.push(type + ":" + msg);
    };

    await env.window.assignProfileToInstance("inst-err-1", "invalid-profile");

    assert.ok(
      toastCalls.some((t) => t.includes("error") && t.includes("Profile not found or revoked")),
      "toast must display error message from failed assign-profile response: " + JSON.stringify(toastCalls)
    );
  } finally {
    env.teardown();
  }
});

test("UI-03: importRoutingRulesToApp expands presets into real domain hostnames", async () => {
  const env = setupDashboardDom({
    customResponses: {
      "/api/routing/profiles": [
        {
          id: "prof-presets",
          name: "Geo Profile",
          defaultPolicy: "direct",
          rules: [
            { id: "r1", targetType: "preset", pattern: "preset:ai_services", action: "proxy" },
            { id: "r2", targetType: "domain", pattern: "corp.internal, vpn.internal", action: "direct" },
          ],
        },
      ],
      "/api/routing/presets": [
        {
          id: "preset:ai_services",
          name: "AI Services",
          entries: ["openai.com", "*.openai.com", "claude.ai"],
        },
      ],
    },
  });

  try {
    const select = env.document.getElementById("appRoutingProfileSelect") as HTMLSelectElement;
    assert.ok(select, "appRoutingProfileSelect must exist in dashboard HTML");
    const opt = env.document.createElement("option");
    opt.value = "prof-presets";
    opt.selected = true;
    select.appendChild(opt);
    select.value = "prof-presets";

    assert.strictEqual(typeof env.window.importRoutingRulesToApp, "function");
    await env.window.importRoutingRulesToApp();

    const rules = env.window.currentAppRules;
    assert.ok(Array.isArray(rules) && rules.length === 2, "2 rules must be imported");

    const presetRule = rules[0];
    assert.strictEqual(presetRule.action, "proxy");
    assert.ok(
      presetRule.targetHosts.includes("openai.com") && presetRule.targetHosts.includes("claude.ai"),
      "preset rule must expand entries into real hostnames"
    );
    assert.strictEqual(
      presetRule.targetHosts.includes("preset:ai_services"),
      false,
      "preset rule must NOT contain raw preset: identifier"
    );

    const domainRule = rules[1];
    assert.strictEqual(domainRule.action, "direct");
    assert.strictEqual(domainRule.targetHosts, "corp.internal; vpn.internal");
  } finally {
    env.teardown();
  }
});

test("UI-05: dashboardView contains instancesTargetRow and saveCurrentProfile collects targetInstanceIds", async () => {
  const html = renderDashboardHtml();
  assert.ok(html.includes('id="instancesTargetRow"'), "dashboard HTML must contain instancesTargetRow container");
  assert.ok(html.includes('id="profTargetInstancesList"'), "dashboard HTML must contain profTargetInstancesList container");

  const env = setupDashboardDom({
    customResponses: {
      "/api/instances": {
        online: 2,
        instances: [
          { instanceId: "inst-101", username: "alice", status: "ONLINE" },
          { instanceId: "inst-102", username: "bob", status: "ONLINE" },
        ],
      },
      "/api/routing/profiles": { ok: true },
    },
  });

  try {
    env.window.currentProfile = {
      id: "prof-test-inst",
      name: "Inst Profile",
      defaultPolicy: "direct",
      targetScope: "instances",
      targetInstanceIds: ["inst-101"],
      rules: [],
    };

    env.window.renderProfile(env.window.currentProfile);
    await new Promise((r) => setTimeout(r, 60));

    const instRow = env.document.getElementById("instancesTargetRow");
    assert.strictEqual(instRow?.style.display, "block", "instancesTargetRow must be displayed when targetScope is instances");

    // Check inst-102 checkbox as well
    const cb102 = env.document.querySelector('input.prof-instance-checkbox[value="inst-102"]') as HTMLInputElement;
    if (cb102) cb102.checked = true;

    await env.window.saveCurrentProfile();

    const saveCall = env.fetchCalls.find((c) => c.url === "/api/routing/profiles" && c.method === "POST");
    assert.ok(saveCall, "saveCurrentProfile must POST to /api/routing/profiles");
    const saved = JSON.parse(saveCall.body);
    assert.strictEqual(saved.targetScope, "instances");
    assert.ok(saved.targetInstanceIds.includes("inst-101"), "must include inst-101");
    assert.ok(saved.targetInstanceIds.includes("inst-102"), "must include inst-102");
  } finally {
    env.teardown();
  }
});

test("UI-06: switchTab('app-studio') preserves modified state when isAppStudioDirty is true", async () => {
  let loadCount = 0;
  const env = setupDashboardDom({
    customResponses: {
      "/api/app-builder/config": () => {
        loadCount++;
        return { name: "Loaded App Config " + loadCount };
      },
      "/api/app-builder/info": { info: {} },
    },
  });

  try {
    // Initial load
    await env.window.loadAppStudioConfig();
    assert.strictEqual(loadCount, 1);
    assert.strictEqual(env.window.isAppStudioDirty, false);

    // Modify a field
    env.window.onAppConfigChangeLive();
    assert.strictEqual(env.window.isAppStudioDirty, true, "live change must set isAppStudioDirty = true");

    // Switching to app-studio must NOT re-fetch if dirty
    env.window.switchTab("app-studio");
    assert.strictEqual(loadCount, 1, "switchTab must not reload config when dirty");

    // Clear dirty flag and switchTab again
    env.window.isAppStudioDirty = false;
    env.window.switchTab("app-studio");
    await new Promise((res) => setTimeout(res, 80));
    assert.strictEqual(loadCount, 2, "switchTab reloads config when clean");
  } finally {
    env.teardown();
  }
});
