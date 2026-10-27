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
