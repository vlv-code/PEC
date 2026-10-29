import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { renderDashboardHtml } from "../src/views/dashboardView.js";

const dashboardJs = fs.readFileSync(
  path.join(process.cwd(), "public", "dashboard.js"),
  "utf-8"
);

function createMockDashboardEnvironment(
  fetchHandler: (url: string, opts?: any) => Promise<any> = async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
    blob: async () => ({}),
  })
) {
  const elements: Record<string, any> = {};

  const getEl = (id: string) => {
    if (!elements[id]) {
      const classSet = new Set<string>();
      const customStyles: Record<string, string> = { display: "block" };
      let currentId = id;
      const el: any = {
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
        children: [] as any[],
        firstChild: null as any,
        parentNode: null as any,
        appendChild(child: any) {
          child.parentNode = this;
          this.children.push(child);
          if (!this.firstChild) this.firstChild = child;
        },
        insertBefore(newNode: any, referenceNode: any) {
          newNode.parentNode = this;
          const idx = this.children.indexOf(referenceNode);
          if (idx !== -1) {
            this.children.splice(idx, 0, newNode);
          } else {
            this.children.push(newNode);
          }
          this.firstChild = this.children[0] || null;
        },
        removeChild(child: any) {
          child.parentNode = null;
          this.children = this.children.filter((x: any) => x !== child);
          this.firstChild = this.children[0] || null;
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

      Object.defineProperty(el, "id", {
        get() {
          return currentId;
        },
        set(newId: string) {
          currentId = newId;
          elements[newId] = el;
        },
      });

      elements[id] = el;
    }
    return elements[id];
  };

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
        const tempId = "created_" + Math.random().toString(36).slice(2, 8);
        const el = getEl(tempId);
        el.tagName = tag.toUpperCase();
        return el;
      },
      body: getEl("body"),
      activeElement: null,
      addEventListener: () => {},
    },
    fetch: fetchHandler,
    URL: {
      createObjectURL: () => "blob:mock-url",
      revokeObjectURL: () => {},
    },
    setTimeout: () => 1,
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

  return { ctx, elements, getEl, sandbox };
}

test("dashboard: App Studio tab exists and is positioned next to Extension Studio", () => {
  const html = renderDashboardHtml({});

  // 1. Tab button exists with proper switchTab handler
  assert.match(
    html,
    /<button[^>]+id="tabBtnAppStudio"[^>]*class="tab-btn"[^>]*onclick="switchTab\('app-studio'\)"/
  );

  // 2. Positioned immediately next to tabBtnBuilder
  const builderIdx = html.indexOf('id="tabBtnBuilder"');
  const appStudioIdx = html.indexOf('id="tabBtnAppStudio"');
  assert.ok(builderIdx !== -1, "tabBtnBuilder must exist");
  assert.ok(appStudioIdx !== -1, "tabBtnAppStudio must exist");
  // Ensure no other tab button is between them
  const builderEnd = html.indexOf("</button>", builderIdx);
  const between = html.slice(builderEnd + 9, appStudioIdx);
  assert.ok(!between.includes('class="tab-btn"'), "No other tab between Builder and App Studio");
});

test("dashboard: App Studio view container and inputs exist", () => {
  const html = renderDashboardHtml({});

  // Tab pane & main container
  assert.match(html, /<div[^>]+id="tab-app-studio"[^>]*class="tab-pane"/);
  assert.match(html, /id="viewAppStudio"/);

  // Settings form elements
  const requiredIds = [
    "appBuildName",
    "appBuildShortName",
    "appBuildVersion",
    "appBuildDescription",
    "appPresetStyle",
    "appThemeColor",
    "appThemeBackground",
    "appThemeCard",
    "appProcessRulesTable",
    "btnAppSaveConfig",
    "btnAppBuildBinaries",
    "btnAppBuild",
    "btnAppDownloadZip",
    "btnAppDownloadTar",
    "btnAppDownloadPs1",
    "btnAppDownloadVerifyPs1",
  ];

  for (const id of requiredIds) {
    assert.ok(html.includes(`id="${id}"`), `Element with id "${id}" must exist in dashboard HTML`);
  }
});

test("dashboard: App Studio desktop live preview elements exist", () => {
  const html = renderDashboardHtml({});

  const previewIds = [
    "appPreviewContainer",
    "appPreviewWindow",
    "appPreviewTitle",
    "appPreviewStatusDot",
  ];

  for (const id of previewIds) {
    assert.ok(html.includes(`id="${id}"`), `Preview element with id "${id}" must exist in dashboard HTML`);
  }
});

test("dashboard: Element IDs remain globally unique with App Studio included", () => {
  const html = renderDashboardHtml({});
  const idRegex = /\sid="([^"]+)"/g;
  const ids: string[] = [];
  let match;
  while ((match = idRegex.exec(html)) !== null) {
    ids.push(match[1]);
  }

  const counts: Record<string, number> = {};
  const duplicates: string[] = [];
  for (const id of ids) {
    counts[id] = (counts[id] || 0) + 1;
    if (counts[id] === 2) {
      duplicates.push(id);
    }
  }

  assert.deepStrictEqual(
    duplicates,
    [],
    `Found duplicate DOM IDs in dashboard HTML: ${duplicates.join(", ")}`
  );
});

test("dashboard: dashboard.js handles binariesStale and renders amber warning banner when present", () => {
  const { ctx, getEl } = createMockDashboardEnvironment();
  const info = {
    version: "2.2.0",
    embeddedVersion: "2.1.0",
    binariesStale: true,
  };

  ctx.window.renderAppStudioBuildInfo(info);

  const banner = getEl("appBinariesStaleBanner");
  assert.equal(banner.style.display, "block");
  assert.match(
    banner.innerHTML,
    /⚠️ Внимание: Версия в бинарниках \(2\.1\.0\) не совпадает с версией релиза \(2\.2\.0\)/
  );
  assert.match(
    banner.innerHTML,
    /Перед публикацией релиза пересоберите бинарники \(кнопка «Собрать бинарники»\)/
  );
});

test("dashboard: dashboard.js hides binariesStale banner when binaries are up to date", () => {
  const { ctx, getEl } = createMockDashboardEnvironment();

  // First render with stale binaries
  ctx.window.renderAppStudioBuildInfo({
    version: "2.2.0",
    embeddedVersion: "2.1.0",
    binariesStale: true,
  });
  const banner = getEl("appBinariesStaleBanner");
  assert.equal(banner.style.display, "block");

  // Re-render when binaries are up to date
  ctx.window.renderAppStudioBuildInfo({
    version: "2.2.0",
    embeddedVersion: "2.2.0",
    binariesStale: false,
  });
  assert.equal(banner.style.display, "none");
});

test("dashboard: dashboard.js renders coreModulesIntegrity badges with size and verified status", () => {
  const { ctx, getEl } = createMockDashboardEnvironment();
  const info = {
    version: "2.2.0",
    embeddedVersion: "2.2.0",
    binariesStale: false,
    coreModulesIntegrity: [
      { name: "PECAppCore.dll", sha256: "abc123", size: 1048576, present: true, verified: true },
      { name: "WinDivert.dll", sha256: "def456", size: 524288, present: true, verified: true },
      { name: "WinDivert64.sys", sha256: "ghi789", size: 262144, present: true, verified: false },
    ],
  };

  ctx.window.renderAppStudioBuildInfo(info);

  const integrityEl = getEl("appCoreModulesIntegrity");
  assert.equal(integrityEl.style.display, "flex");
  assert.ok(integrityEl.innerHTML.includes("PECAppCore.dll"));
  assert.ok(integrityEl.innerHTML.includes("1024 KB"));
  assert.ok(integrityEl.innerHTML.includes("проверен"));
  assert.ok(integrityEl.innerHTML.includes("WinDivert.dll"));
  assert.ok(integrityEl.innerHTML.includes("512 KB"));
  assert.ok(integrityEl.innerHTML.includes("WinDivert64.sys"));
  assert.ok(integrityEl.innerHTML.includes("256 KB"));
  assert.ok(integrityEl.innerHTML.includes("не проверен"));
});

test("dashboard: loadAppStudioConfig triggers renderAppStudioBuildInfo with stale binary warning from API", async () => {
  const fetchMock = async (url: string) => {
    if (url.includes("/api/app-builder/config")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          name: "Test App",
          version: "2.2.0",
          processRules: [],
        }),
      };
    }
    if (url.includes("/api/app-builder/info")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          info: {
            version: "2.2.0",
            embeddedVersion: "2.1.0",
            binariesStale: true,
            coreModulesIntegrity: [
              { name: "PECAppCore.dll", sha256: "111", size: 1048576, present: true, verified: true },
              { name: "WinDivert.dll", sha256: "222", size: 524288, present: true, verified: true },
              { name: "WinDivert64.sys", sha256: "333", size: 262144, present: true, verified: true },
            ],
          },
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const { ctx, getEl } = createMockDashboardEnvironment(fetchMock);

  await ctx.window.loadAppStudioConfig();

  const banner = getEl("appBinariesStaleBanner");
  assert.equal(banner.style.display, "block");
  assert.match(banner.innerHTML, /⚠️ Внимание: Версия в бинарниках \(2\.1\.0\)/);

  const integrityEl = getEl("appCoreModulesIntegrity");
  assert.equal(integrityEl.style.display, "flex");
  assert.ok(integrityEl.innerHTML.includes("PECAppCore.dll"));
});


test("dashboard: App Studio renders static placeholder for toolchain diagnostics and compiler warning modal", () => {
  const html = renderDashboardHtml({});
  assert.ok(html.includes('id="appToolchainDiagnostics"'), "appToolchainDiagnostics must exist in dashboard HTML");
  assert.ok(html.includes('id="modalCompilerWarning"'), "modalCompilerWarning must exist in dashboard HTML");
  assert.ok(html.includes('id="compilerWarningModalText"'), "compilerWarningModalText must exist in dashboard HTML");
});

test("dashboard: dashboard.js renders toolchain diagnostics badge when toolchain is available", () => {
  const { ctx, getEl } = createMockDashboardEnvironment();
  const info = {
    version: "2.2.0",
    embeddedVersion: "2.2.0",
    toolchain: {
      available: true,
      compilerName: "MinGW-w64 GCC (x86_64)",
      gcc: { available: true, version: "13.2.0" },
      windres: { available: true },
      wixl: { available: true, version: "0.100" },
    },
  };

  ctx.window.renderAppStudioBuildInfo(info);

  const toolchainEl = getEl("appToolchainDiagnostics");
  assert.equal(toolchainEl.style.display, "flex");
  assert.ok(
    toolchainEl.innerHTML.includes("✓ Тулчейн компиляции: MinGW-w64 GCC (x86_64)"),
    "Must display green badge with compiler name"
  );
  // Detailed badges for GCC, Windres, Wixl
  assert.ok(toolchainEl.innerHTML.includes("✓ GCC (13.2.0)"), "Must display GCC badge with version");
  assert.ok(toolchainEl.innerHTML.includes("✓ Windres"), "Must display Windres badge");
  assert.ok(toolchainEl.innerHTML.includes("✓ Wixl (0.100)"), "Must display Wixl badge");
  assert.ok(
    toolchainEl.getAttribute("title").includes("GCC: 13.2.0"),
    "Toolchain bar title must contain toolchain details"
  );
});

test("dashboard: dashboard.js renders toolchain badges correctly from flat backend format (hasWixl, hasGcc, hasWindres)", () => {
  const { ctx, getEl } = createMockDashboardEnvironment();
  const info = {
    version: "2.2.0",
    embeddedVersion: "2.2.0",
    binariesStale: false,
    toolchain: {
      available: true,
      compilerName: "MinGW-w64 GCC (x86_64)",
      compilerVersion: "12.2.0",
      hasGcc: true,
      hasGxx: true,
      hasWindres: true,
      hasWixl: true,
      hasMakensis: false,
    },
  };

  ctx.window.renderAppStudioBuildInfo(info);

  const toolchainEl = getEl("appToolchainDiagnostics");
  assert.equal(toolchainEl.style.display, "flex");
  assert.ok(toolchainEl.innerHTML.includes("✓ GCC"), "Must display GCC badge");
  assert.ok(toolchainEl.innerHTML.includes("✓ Windres"), "Must display Windres badge");
  assert.ok(toolchainEl.innerHTML.includes("✓ Wixl"), "Must display Wixl badge from hasWixl");
});

test("dashboard: dashboard.js renders amber badge when toolchain is missing or compilerMissing", () => {
  const { ctx, getEl } = createMockDashboardEnvironment();
  const info = {
    version: "2.2.0",
    embeddedVersion: "2.1.0",
    compilerMissing: true,
    toolchain: {
      available: false,
      compilerMissing: true,
      compilerName: "None",
      gcc: false,
      windres: false,
      wixl: false,
    },
  };

  ctx.window.renderAppStudioBuildInfo(info);

  const toolchainEl = getEl("appToolchainDiagnostics");
  assert.equal(toolchainEl.style.display, "flex");
  assert.ok(
    toolchainEl.innerHTML.includes("⚠ Компилятор C/C++ не установлен (сборка из исходников недоступна)"),
    "Must display amber badge for missing compiler"
  );
  assert.ok(toolchainEl.innerHTML.includes("❌ GCC"), "Must show missing GCC badge");
  assert.ok(toolchainEl.innerHTML.includes("❌ Windres"), "Must show missing Windres badge");
  assert.ok(toolchainEl.innerHTML.includes("⚠ Wixl"), "Must show missing/warning Wixl badge");
});

test("dashboard: buildAppBinariesAction shows warning notification and modal when compiler is missing", async () => {
  const fetchMock = async (url: string) => {
    if (url.includes("/api/app-builder/build-binaries")) {
      return {
        ok: false,
        status: 500,
        json: async () => ({
          ok: false,
          compilerMissing: true,
          embeddedVersion: "2.1.0",
          error: "MinGW-w64 toolchain not found",
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const { ctx, getEl } = createMockDashboardEnvironment(fetchMock);
  getEl("appBuildVersion").value = "2.2.0";

  await ctx.window.buildAppBinariesAction();

  const statusEl = getEl("appBuildStatusMsg");
  assert.equal(statusEl.style.display, "block");
  assert.ok(
    statusEl.textContent.includes("Компилятор C/C++ (MinGW / MSVC) не обнаружен. Сборка не производилась. В шаблонах остаются бинарники v2.1.0"),
    "Status message must warn about missing compiler"
  );

  const modalEl = getEl("modalCompilerWarning");
  assert.equal(modalEl.style.display, "flex", "Warning modal must be displayed");

  const modalTextEl = getEl("compilerWarningModalText");
  assert.ok(
    modalTextEl.textContent.includes("Компилятор C/C++ (MinGW / MSVC) не обнаружен. Сборка не производилась. В шаблонах остаются бинарники v2.1.0"),
    "Modal content must describe missing compiler state"
  );

  // Close modal works
  ctx.window.closeCompilerWarningModal();
  assert.equal(modalEl.style.display, "none", "Modal should close on close action");
});

test("dashboard: buildAppBinariesAction shows success notification with execution time and compiled version", async () => {
  const fetchMock = async (url: string) => {
    if (url.includes("/api/app-builder/build-binaries")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          message: "Binaries ready",
          compiler: "MinGW-w64 GCC (x86_64)",
          version: "2.2.0",
          builtFiles: ["PEC-App.exe", "PEC-CLI.exe", "PECAppCore.dll"],
          info: {
            version: "2.2.0",
            embeddedVersion: "2.2.0",
            binariesStale: false,
            toolchain: {
              available: true,
              compilerName: "MinGW-w64 GCC (x86_64)",
              gcc: { available: true, version: "13.2.0" },
              windres: { available: true },
              wixl: { available: true },
            },
          },
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const { ctx, getEl } = createMockDashboardEnvironment(fetchMock);
  getEl("appBuildVersion").value = "2.2.0";

  await ctx.window.buildAppBinariesAction();

  const statusEl = getEl("appBuildStatusMsg");
  assert.equal(statusEl.style.display, "block");
  assert.ok(statusEl.innerHTML.includes("v2.2.0"), "Status must contain compiled version");
  assert.ok(statusEl.innerHTML.includes("MinGW-w64 GCC"), "Status must contain compiler name");
  assert.match(statusEl.innerHTML, /\d+(\.\d+)?с/, "Status must display execution time in seconds");

  const toastHost = getEl("toastHost");
  assert.ok(
    toastHost.children.some(
      (c: any) =>
        c.textContent &&
        c.textContent.includes("Сборка бинарников v2.2.0 успешно выполнена")
    ),
    "Toast message must indicate success with compiled version and execution time"
  );

  const toolchainEl = getEl("appToolchainDiagnostics");
  assert.equal(toolchainEl.style.display, "flex");
  assert.ok(
    toolchainEl.innerHTML.includes("✓ Тулчейн компиляции: MinGW-w64 GCC (x86_64)"),
    "Toolchain diagnostics must be updated with success toolchain info"
  );
});

test("dashboard: buildAppBinariesAction shows exact compilation error and enables log button when compiler is present but build failed", async () => {
  const fetchMock = async (url: string) => {
    if (url.includes("/api/app-builder/build-binaries")) {
      return {
        ok: false,
        status: 500,
        json: async () => ({
          ok: false,
          compilerMissing: false,
          compiler: "MinGW-w64 GCC (x86_64)",
          message: "Ошибка сборки исходного кода: undefined reference to 'CryptProtectData'",
          buildLog: [
            "[00:00:01] Starting PEC-App binary build pipeline for v1.0.5...",
            "[00:00:02] [ERROR] undefined reference to 'CryptProtectData'",
          ],
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const { ctx, getEl } = createMockDashboardEnvironment(fetchMock);
  getEl("appBuildVersion").value = "1.0.5";

  await ctx.window.buildAppBinariesAction();

  const statusEl = getEl("appBuildStatusMsg");
  assert.equal(statusEl.style.display, "block");
  assert.ok(
    statusEl.textContent.includes("Ошибка сборки исходного кода: undefined reference to 'CryptProtectData'"),
    "Status message must show the actual compiler error"
  );
  assert.ok(
    !statusEl.textContent.includes("не обнаружен"),
    "Must NOT falsely claim compiler is missing when compilation failed"
  );

  const modalEl = getEl("modalCompilerWarning");
  assert.notEqual(modalEl.style.display, "flex", "Missing compiler modal must NOT be shown when compilation failed");

  const logBtn = getEl("btnAppViewBuildLog");
  assert.equal(logBtn.style.display, "inline-block", "Log button must be enabled to view build log");
});

