import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const dashboardJs = fs.readFileSync(
  path.join(process.cwd(), "public", "dashboard.js"),
  "utf-8"
);

test("dashboardAppStudioLogic: dashboard.js parses as valid JavaScript without TS leaks", () => {
  assert.doesNotThrow(() => {
    new vm.Script(dashboardJs, { filename: "dashboard.js" });
  });
});

test("dashboardAppStudioLogic: required App Studio functions are defined and exposed", () => {
  const requiredFunctions = [
    "loadAppStudioConfig",
    "saveAppStudioConfigAction",
    "buildAppPackageAction",
    "updateAppLivePreview",
    "addNewAppProcessRule",
    "deleteAppProcessRule",
    "setAppPresetTheme",
    "setAppThemeMode",
    "switchPreviewWindowTab",
    "downloadAppPackageAction",
    "downloadAppScriptAction",
    "downloadAppProfileAction",
  ];

  for (const fn of requiredFunctions) {
    assert.ok(
      dashboardJs.includes(`function ${fn}`) || dashboardJs.includes(`${fn} =`),
      `Function ${fn} must be defined in dashboard.js`
    );
    assert.ok(
      dashboardJs.includes(`window.${fn} = ${fn}`) || dashboardJs.includes(`window.${fn} =`),
      `Function ${fn} must be exposed on window`
    );
  }
});

test("dashboardAppStudioLogic: theme presets map correctly in dashboard.js", () => {
  assert.ok(dashboardJs.includes("cyber-blue"), "Must support cyber-blue preset");
  assert.ok(dashboardJs.includes("dark-obsidian"), "Must support dark-obsidian preset");
  assert.ok(dashboardJs.includes("nordic-arctic"), "Must support nordic-arctic preset");
  assert.ok(dashboardJs.includes("emerald-secops"), "Must support emerald-secops preset");
  assert.ok(dashboardJs.includes("enterprise-light"), "Must support enterprise-light preset");
  assert.ok(dashboardJs.includes("emerald-sentinel"), "Must support emerald-sentinel preset");
  assert.ok(dashboardJs.includes("sunset-amber"), "Must support sunset-amber preset");
  assert.ok(dashboardJs.includes("minimal-light"), "Must support minimal-light preset");
});

function createMockDashboardEnvironment(
  fetchHandler: (url: string, opts?: any) => Promise<any> = async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
    blob: async () => ({}),
  })
) {
  const elements: Record<string, any> = {};
  const appendedElements: any[] = [];

  const getEl = (id: string) => {
    if (!elements[id]) {
      const classSet = new Set<string>();
      const customStyles: Record<string, string> = { display: "block" };
      elements[id] = {
        id,
        value: "",
        textContent: "",
        innerHTML: "",
        checked: false,
        disabled: false,
        style: new Proxy(customStyles, {
          get(target, prop: string) {
            if (prop === "setProperty") {
              return (k: string, v: string) => {
                target[k] = v;
              };
            }
            return target[prop];
          },
          set(target, prop: string, val: string) {
            target[prop] = val;
            return true;
          },
        }),
        classList: {
          classes: classSet,
          add: (c: string) => classSet.add(c),
          remove: (c: string) => classSet.delete(c),
          toggle: (c: string, force?: boolean) => {
            if (force === true) classSet.add(c);
            else if (force === false) classSet.delete(c);
            else if (classSet.has(c)) classSet.delete(c);
            else classSet.add(c);
          },
          contains: (c: string) => classSet.has(c),
        },
        children: [],
        appendChild(child: any) {
          this.children.push(child);
        },
        removeChild(child: any) {
          this.children = this.children.filter((x: any) => x !== child);
        },
        remove() {},
        addEventListener() {},
        removeEventListener() {},
        setAttribute(k: string, v: string) {
          (this as any)[k] = v;
        },
        getAttribute(k: string) {
          return (this as any)[k] || null;
        },
        focus() {},
        click() {},
      };
    }
    return elements[id];
  };

  const toasts: Array<{ msg: string; type: string }> = [];

  const sandbox: any = {
    window: {
      addEventListener: () => {},
      removeEventListener: () => {},
      location: { href: "http://localhost:3000" },
    },
    document: {
      getElementById: getEl,
      querySelector: (sel: string) => {
        if (sel.startsWith("#")) return getEl(sel.slice(1));
        return getEl("mock_" + sel);
      },
      querySelectorAll: () => [],
      createElement: (tag: string) => {
        const el: any = {
          tagName: tag.toUpperCase(),
          download: "",
          href: "",
          style: {},
          classList: {
            add: () => {},
            remove: () => {},
            toggle: () => {},
            contains: () => false,
          },
          appendChild: () => {},
          removeChild: () => {},
          remove: () => {},
          addEventListener: () => {},
          setAttribute: () => {},
          getAttribute: () => null,
          click: () => {
            el._clicked = true;
          },
        };
        return el;
      },
      body: {
        appendChild: (child: any) => {
          appendedElements.push(child);
        },
        removeChild: (child: any) => {
          const idx = appendedElements.indexOf(child);
          if (idx !== -1) appendedElements.splice(idx, 1);
        },
        getAttribute: () => "dark",
        setAttribute: () => {},
      },
      activeElement: null,
      addEventListener: () => {},
    },
    fetch: fetchHandler,
    URL: {
      createObjectURL: () => "blob:mock-url",
      revokeObjectURL: () => {},
    },
    setTimeout: (fn: any) => {
      return 1;
    },
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    console: {
      log: () => {},
      warn: () => {},
      error: () => {},
      info: () => {},
    },
    Date: global.Date,
    Math: global.Math,
    JSON: global.JSON,
    Array: global.Array,
    Object: global.Object,
    String: global.String,
    Number: global.Number,
    Boolean: global.Boolean,
    RegExp: global.RegExp,
  };

  sandbox.window.document = sandbox.document;
  sandbox.global = sandbox.window;
  sandbox.self = sandbox.window;

  const ctx = vm.createContext(sandbox);
  vm.runInContext(dashboardJs, ctx);

  return { ctx, elements, getEl, appendedElements, toasts };
}

test("dashboardAppStudioLogic: loadAppStudioConfig loads config and populates form and preset badge", async () => {
  const mockConfig = {
    name: "Custom Enterprise App",
    shortName: "CEA",
    version: "3.0.0",
    description: "Enterprise Transparent Client",
    iconType: "shield",
    presetStyle: "emerald-secops",
    defaultThemeMode: "dark",
    themeColor: "#10b981",
    themeBackground: "#062e1e",
    themeCard: "#0b422c",
    autoStartWithWindows: true,
    startMinimizedToTray: false,
    installAsService: true,
    trafficLogging: true,
    processRules: [
      {
        id: "r1",
        processName: "outlook.exe",
        targetHosts: "corp.net",
        targetPorts: "443",
        protocol: "tcp",
        action: "proxy",
      },
    ],
  };

  const mockInfo = {
    version: "3.0.0",
    builtAt: "2026-10-19T12:00:00.000Z",
    windowsPackageSize: 5242880,
    windowsPackageSha256: "abcdef1234567890",
    linuxPackageSize: 3145728,
  };

  const mockProxies = [
    {
      id: "px1",
      name: "Corp SOCKS Node",
      type: "socks5",
      host: "10.0.0.1",
      port: 1080,
      isActive: true,
    },
  ];

  const fetchCalls: string[] = [];
  const { ctx, getEl } = createMockDashboardEnvironment(async (url: string) => {
    fetchCalls.push(url);
    if (url === "/api/app-builder/config") {
      return { ok: true, status: 200, json: async () => mockConfig };
    }
    if (url === "/api/app-builder/info") {
      return { ok: true, status: 200, json: async () => ({ ok: true, info: mockInfo }) };
    }
    if (url === "/api/proxies") {
      return { ok: true, status: 200, json: async () => mockProxies };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });

  await ctx.window.loadAppStudioConfig();

  assert.equal(getEl("appBuildName").value, "Custom Enterprise App");
  assert.equal(getEl("appBuildShortName").value, "CEA");
  assert.equal(getEl("appBuildVersion").value, "3.0.0");
  assert.equal(getEl("appPresetBadge").textContent, "Emerald SecOps");
  assert.equal(getEl("appAutoStart").checked, true);
  assert.equal(getEl("appStartMinimized").checked, false);
  assert.equal(getEl("appInstallService").checked, true);

  // Status message should reflect package info
  const statusHtml = getEl("appBuildStatusMsg").innerHTML;
  assert.ok(statusHtml.includes("5120 KB"), `Status message should contain Windows size: ${statusHtml}`);
  assert.ok(statusHtml.includes("3072 KB"), `Status message should contain Linux size: ${statusHtml}`);
  assert.ok(statusHtml.includes("abcdef1234"), `Status message should contain Win SHA: ${statusHtml}`);
});

test("dashboardAppStudioLogic: saveAppStudioConfigAction submits form values and succeeds with data.ok", async () => {
  let submittedPayload: any = null;
  const { ctx, getEl } = createMockDashboardEnvironment(async (url: string, opts?: any) => {
    if (url === "/api/app-builder/config" && opts?.method === "POST") {
      submittedPayload = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ ok: true, ...submittedPayload }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });

  getEl("appBuildName").value = "SecOps App";
  getEl("appBuildShortName").value = "SOA";
  getEl("appBuildVersion").value = "2.5.0";
  getEl("appPresetStyle").value = "cyber-blue";
  getEl("appAutoStart").checked = true;

  const result = await ctx.window.saveAppStudioConfigAction(true);
  assert.equal(result, true, "saveAppStudioConfigAction must return true on success");
  assert.ok(submittedPayload, "Must have posted body");
  assert.equal(submittedPayload.name, "SecOps App");
  assert.equal(submittedPayload.version, "2.5.0");
});

test("dashboardAppStudioLogic: buildAppPackageAction invokes save then build endpoint", async () => {
  const calls: string[] = [];
  const buildResult = {
    version: "2.1.0",
    windowsPackageSize: 2048000,
    windowsPackageSha256: "fe1234567890abcd",
    linuxPackageSize: 1024000,
  };

  const { ctx, getEl } = createMockDashboardEnvironment(async (url: string, opts?: any) => {
    calls.push(`${opts?.method || "GET"} ${url}`);
    if (url === "/api/app-builder/config" && opts?.method === "POST") {
      return { ok: true, status: 200, json: async () => ({ ok: true, name: "Test" }) };
    }
    if (url === "/api/app-builder/build" && opts?.method === "POST") {
      return { ok: true, status: 200, json: async () => ({ ok: true, result: buildResult }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });

  await ctx.window.buildAppPackageAction();

  assert.ok(calls.includes("POST /api/app-builder/config"), "Must save config before build");
  assert.ok(calls.includes("POST /api/app-builder/build"), "Must call build endpoint");

  const statusHtml = getEl("appBuildStatusMsg").innerHTML;
  assert.ok(statusHtml.includes("2000 KB") || statusHtml.includes("KB"), "Must display build sizes");
  assert.ok(statusHtml.includes("fe12345678"), "Must display SHA snippet");
});

test("dashboardAppStudioLogic: setAppPresetTheme updates colors, chips, and appPresetBadge", () => {
  const { ctx, getEl } = createMockDashboardEnvironment();

  ctx.window.setAppPresetTheme("nordic-arctic");

  assert.equal(getEl("appPresetStyle").value, "nordic-arctic");
  assert.equal(getEl("appThemeColor").value, "#88c0d0");
  assert.equal(getEl("appPresetBadge").textContent, "Nordic Arctic");
  assert.ok(getEl("chipAppPresetNord").classList.contains("active"));
  assert.ok(!getEl("chipAppPresetCyber").classList.contains("active"));

  // Enterprise light should activate light mode
  ctx.window.setAppPresetTheme("enterprise-light");
  assert.equal(getEl("appPresetBadge").textContent, "Enterprise Light");
  assert.ok(getEl("btnAppModeLight").classList.contains("active"));
  assert.ok(!getEl("btnAppModeDark").classList.contains("active"));

  // Legacy preset support
  ctx.window.setAppPresetTheme("sunset-amber");
  assert.equal(getEl("appPresetStyle").value, "sunset-amber");
  assert.equal(getEl("appThemeColor").value, "#f59e0b");
});

test("dashboardAppStudioLogic: downloadAppScriptAction sets correct filenames for deploy vs verify", async () => {
  const downloadedFiles: string[] = [];
  const { ctx } = createMockDashboardEnvironment(async (url: string) => {
    return {
      ok: true,
      status: 200,
      blob: async () => ({ size: 100 }),
    };
  });

  // Mock createElement to capture download filename
  const origCreate = ctx.document.createElement;
  ctx.document.createElement = (tag: string) => {
    const el = origCreate(tag);
    if (tag.toLowerCase() === "a") {
      el.click = () => {
        downloadedFiles.push(el.download);
      };
    }
    return el;
  };

  await ctx.window.downloadAppScriptAction("deploy");
  assert.equal(downloadedFiles[0], "deploy-pec-app.ps1", "deploy action must download deploy-pec-app.ps1");

  await ctx.window.downloadAppScriptAction("verify");
  assert.equal(downloadedFiles[1], "verify-pec-app.ps1", "verify action must download verify-pec-app.ps1");
});

test("dashboardAppStudioLogic: updateAppLivePreview reflects active proxy pill and direct fallback", () => {
  const { ctx, getEl } = createMockDashboardEnvironment();

  // Test when no proxies exist -> DIRECT
  ctx.window.updateAppLivePreview();
  assert.equal(getEl("appPreviewNodeTag").textContent, "DIRECT");

  // Set mock proxies
  ctx.sandbox = ctx;
  vm.runInContext(
    `currentProxiesList = [{ type: 'socks5', host: '192.168.1.50', port: 10808, isActive: true, name: 'Office-Node' }];`,
    ctx
  );

  ctx.window.updateAppLivePreview();
  assert.equal(getEl("appPreviewNodeTag").textContent, "SOCKS5 192.168.1.50:10808");
  assert.ok(getEl("prevActiveProxyDetails").textContent.includes("192.168.1.50:10808"));
  assert.ok(getEl("prevActiveProxyDetails").textContent.includes("Office-Node"));
});
