import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TEST_TMP_DIR } from "./helpers/setup.js";

/**
 * Test hygiene and shipped-artifact checks.
 *
 * 1. Store purity: every state store is env-redirected into a temp dir by
 *    helpers/setup.ts. If a writer ever falls back to the repo working
 *    directory again, tests would silently pollute the checkout (the repo
 *    once shipped 11 duplicated test profiles and a dead proxy_config.json
 *    committed in git because of exactly that).
 * 2. Syntax checks: the extension sources and the rendered (placeholder-
 *    substituted) background.js must be valid JavaScript.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const STORE_FILES = [
  "current_creds.json",
  "proxy_config.json",
  "routing_profiles.json",
  "instances_meta.json",
  "rotation_config.json",
  "rotation_history.json",
  "extension_build_config.json",
  "audit_log.json",
];

test("purity: exercising every store writer never touches the repository directory", async () => {
  const before = new Set(fs.readdirSync(REPO_ROOT));

  const { saveProfile } = await import("../src/routing.js");
  const { updateProxyConfig, registerHeartbeat } = await import("../src/instances.js");
  const { updateRotationConfig } = await import("../src/scheduler.js");
  const { saveBuildConfig, ensureKeyExists, packageExtension } = await import("../src/packager.js");
  const { recordAudit } = await import("../src/audit.js");
  const { atomicWriteCreds, getCredsStorePath } = await import("../src/rotate.js");

  saveProfile({ name: "Purity Probe", defaultPolicy: "direct", rules: [] });
  updateProxyConfig({ protocol: "socks5", host: "purity.internal", port: 10808 });
  registerHeartbeat({ instanceId: "inst_purity", ip: "127.0.0.1", version: "1.3.0" });
  updateRotationConfig({ enabled: false });
  saveBuildConfig({ name: "Purity Brand" });
  recordAudit({ ip: "127.0.0.1", endpoint: "/purity", status: 200, result: "SERVED" });
  atomicWriteCreds(getCredsStorePath(), { user: "corp-user", pass: "purity-pass" });
  ensureKeyExists();
  packageExtension("https://purity.example.corp");

  // No files may appear in the repo working directory
  const added = fs.readdirSync(REPO_ROOT).filter((f) => !before.has(f));
  assert.deepStrictEqual(added, [], "tests must not create files in the repo working directory");

  // And none of the known store files may exist there
  for (const f of STORE_FILES) {
    assert.ok(!fs.existsSync(path.join(REPO_ROOT, f)), `${f} must never be created in the repo root`);
  }

  // The writes must have landed in the redirected temp stores instead
  assert.ok(fs.existsSync(path.join(TEST_TMP_DIR, "routing_profiles.json")), "profiles must go to the temp store");
  assert.ok(fs.existsSync(path.join(TEST_TMP_DIR, "updates", "extension.crx")), "packaged extension must go to the temp updates dir");
});

test("purity: extension sources are syntactically valid JavaScript", () => {
  const sources = [
    "extension/background.js",
    "extension/popup.js",
    "extension/scripts/pack.js",
  ];
  for (const rel of sources) {
    const file = path.join(REPO_ROOT, rel);
    assert.ok(fs.existsSync(file), `${rel} must exist`);
    // node --check exits non-zero on any syntax error
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  }
});

test("purity: extension/background.js evaluates top-level scope without ReferenceError or unresolved tokens", async () => {
  const bgPath = path.join(REPO_ROOT, "extension", "background.js");
  const src = fs.readFileSync(bgPath, "utf-8");
  const vm = await import("node:vm");
  const vmScript = `
    const chrome = {
      storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() }, managed: { get: () => Promise.resolve({}) } },
      alarms: { create: () => {}, get: (_n, cb) => cb && cb(null), onAlarm: { addListener: () => {} } },
      privacy: { network: { webRTCIPHandlingPolicy: { set: () => Promise.resolve() } } },
      action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
      proxy: { settings: { set: () => Promise.resolve() } },
      webRequest: { onAuthRequired: { addListener: () => {} }, onCompleted: { addListener: () => {} }, onErrorOccurred: { addListener: () => {} } },
      runtime: { getManifest: () => ({ version: "1.0.0" }), id: "test-id", onMessage: { addListener: () => {} } }
    };
    ${src}
  `;
  const ctx = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    Date,
    URL,
    fetch: () => Promise.resolve({ ok: false }),
    AbortSignal,
    Map,
  });
  vm.runInContext(vmScript, ctx);
});

test("purity: extension/background.js logs fatal error when loaded with unsubstituted __PEC_ placeholders", async () => {
  const bgPath = path.join(REPO_ROOT, "extension", "background.js");
  const src = fs.readFileSync(bgPath, "utf-8");
  const vm = await import("node:vm");

  let errorLogged = "";
  const vmScript = `
    const chrome = {
      storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() }, managed: { get: () => Promise.resolve({}) } },
      alarms: { create: () => {}, get: (_n, cb) => cb && cb(null), onAlarm: { addListener: () => {} } },
      privacy: { network: { webRTCIPHandlingPolicy: { set: () => Promise.resolve() } } },
      action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
      proxy: { settings: { set: () => Promise.resolve() } },
      webRequest: { onAuthRequired: { addListener: () => {} }, onCompleted: { addListener: () => {} }, onErrorOccurred: { addListener: () => {} } },
      runtime: { getManifest: () => ({ version: "1.0.0" }), id: "test-id", onMessage: { addListener: () => {} } }
    };
    ${src}
  `;
  const ctx = vm.createContext({
    console: {
      ...console,
      error: (...args: any[]) => { errorLogged += args.join(" "); },
    },
    setTimeout,
    clearTimeout,
    Date,
    URL,
    fetch: () => Promise.resolve({ ok: false }),
    AbortSignal,
    Map,
  });
  vm.runInContext(vmScript, ctx);

  assert.ok(
    errorLogged.includes("FATAL: server URL placeholder was not substituted"),
    "background.js must log fatal error when raw placeholders are present"
  );
});

test("purity: the rendered background.js (placeholders substituted) parses as JavaScript", async () => {
  const { packageExtension } = await import("../src/packager.js");
  packageExtension("https://purity-render.example.corp");

  // The substituted service worker only exists inside the packaged zip - the
  // source file on disk intentionally keeps its __PEC_*__ placeholders.
  const zipPath = path.join(TEST_TMP_DIR, "updates", "extension.zip");
  assert.ok(fs.existsSync(zipPath), "packaged extension zip must exist in the temp updates dir");
  const AdmZip = (await import("adm-zip")).default;
  const bg = new AdmZip(zipPath).readAsText("background.js");
  assert.ok(!bg.includes("__PEC_"), "no raw placeholders may remain in the packaged background.js");

  const tmpFile = path.join(TEST_TMP_DIR, "rendered-background-check.js");
  fs.writeFileSync(tmpFile, bg, "utf-8");
  execFileSync(process.execPath, ["--check", tmpFile], { stdio: "pipe" });

  // The instanceId must survive MV3 service-worker restarts: it has to be
  // persisted through chrome.storage.local, not held in module memory.
  assert.ok(bg.includes("pecInstanceId"), "instanceId must be persisted under a stable storage key");
  assert.ok(bg.includes("chrome.storage.local"), "instanceId persistence must use chrome.storage.local");
  assert.ok(!bg.includes("ephemeralInstanceId"), "the old ephemeral module-level instanceId must be gone");
});

test("purity: extension html files must not contain inline event handlers (MV3 CSP compliance)", async () => {
  const inlineEventRegex = /\son[a-z]+=/i;

  // 1. Source popup.html
  const sourceHtml = fs.readFileSync(path.join(REPO_ROOT, "extension", "popup.html"), "utf-8");
  assert.ok(
    !inlineEventRegex.test(sourceHtml),
    "extension/popup.html must not contain inline event handlers (e.g. onclick=) which violate MV3 CSP"
  );

  // 2. Packaged popup.html in extension.zip
  const { packageExtension } = await import("../src/packager.js");
  packageExtension("https://purity-render.example.corp");
  const zipPath = path.join(TEST_TMP_DIR, "updates", "extension.zip");
  const AdmZip = (await import("adm-zip")).default;
  const packagedHtml = new AdmZip(zipPath).readAsText("popup.html");
  assert.ok(
    !inlineEventRegex.test(packagedHtml),
    "Packaged popup.html must not contain inline event handlers (e.g. onclick=) which violate MV3 CSP"
  );
});

test("purity: packageExtension generates a ready-to-load unpacked directory without placeholders", async () => {
  const { packageExtension } = await import("../src/packager.js");
  const res = packageExtension("https://unpacked-test.example.corp");
  assert.ok(res.unpackedPath, "packageExtension result must include unpackedPath");
  assert.ok(fs.existsSync(res.unpackedPath), "unpacked extension directory must exist on disk");

  const manifestFile = path.join(res.unpackedPath, "manifest.json");
  const bgFile = path.join(res.unpackedPath, "background.js");
  const popupHtmlFile = path.join(res.unpackedPath, "popup.html");
  assert.ok(fs.existsSync(manifestFile), "unpacked manifest.json must exist");
  assert.ok(fs.existsSync(bgFile), "unpacked background.js must exist");
  assert.ok(fs.existsSync(popupHtmlFile), "unpacked popup.html must exist");

  const bgContent = fs.readFileSync(bgFile, "utf-8");
  assert.ok(!bgContent.includes("__PEC_"), "unpacked background.js must have all placeholders resolved");
  assert.ok(bgContent.includes("https://unpacked-test.example.corp"), "unpacked background.js must contain effective server URL");

  const popupHtmlContent = fs.readFileSync(popupHtmlFile, "utf-8");
  assert.ok(popupHtmlContent.includes('id="logContainer"'), "unpacked popup.html must include event log container");
  assert.ok(popupHtmlContent.includes('id="btnCopyLogs"'), "unpacked popup.html must include copy logs button");

  const popupJsFile = path.join(res.unpackedPath, "popup.js");
  assert.ok(fs.existsSync(popupJsFile), "unpacked popup.js must exist");
  const popupJsContent = fs.readFileSync(popupJsFile, "utf-8");
  assert.ok(popupJsContent.includes("__pecLoadLogs"), "unpacked popup.js must include __pecLoadLogs hook");
});

test("purity: generateExtensionFiles emits popup with logContainer and __pecLoadLogs", async () => {
  const { generateExtensionFiles, getBuildConfig } = await import("../src/packager.js");
  const extDir = process.env.PEC_EXTENSION_DIR || path.join(REPO_ROOT, "extension");
  const cfg = getBuildConfig();
  generateExtensionFiles(cfg, { force: true });
  const html = fs.readFileSync(path.join(extDir, "popup.html"), "utf-8");
  const js = fs.readFileSync(path.join(extDir, "popup.js"), "utf-8");
  assert.ok(html.includes('id="logContainer"'), "generated popup.html must include id=logContainer");
  assert.ok(js.includes("__pecLoadLogs"), "generated popup.js must include __pecLoadLogs");
});

test("purity: popup HTML and JS do not fake active status or dummy metrics", async () => {
  const popupHtmlPath = path.join(REPO_ROOT, "extension", "popup.html");
  const popupJsPath = path.join(REPO_ROOT, "extension", "popup.js");
  const html = fs.readFileSync(popupHtmlPath, "utf-8");
  const js = fs.readFileSync(popupJsPath, "utf-8");

  // 1. Initial HTML must not claim Active or 28ms before connecting
  assert.ok(!html.includes(">28 ms<"), "popup.html must not hardcode fake 28 ms latency");
  assert.ok(!html.includes(">proxy.corp.internal<"), "popup.html must not hardcode fake proxy endpoint");
  assert.ok(html.includes("status-badge offline"), "popup.html must default to offline/inactive state initially");

  // 2. popup.js must NOT set status to 'Active' when runtime.lastError occurs
  assert.ok(!js.includes('statusText.textContent = "Активен";\n          return;'), "popup.js must not fake active status on runtime error");
  assert.ok(!js.includes('statusText.textContent = "Активен";\r\n          return;'), "popup.js must not fake active status on runtime error");
});

test("purity: background.js applyProxyConfig applies pac_script mode when pacUrl is present even with protocol http/socks5", async () => {
  const bgPath = path.join(REPO_ROOT, "extension", "background.js");
  const src = fs.readFileSync(bgPath, "utf-8");
  const vm = await import("node:vm");

  const vmScript = `
    const chrome = {
      storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() }, managed: { get: () => Promise.resolve({}) } },
      alarms: { create: () => {}, get: (_n, cb) => cb && cb(null), onAlarm: { addListener: () => {} } },
      privacy: { network: { webRTCIPHandlingPolicy: { set: () => Promise.resolve() } } },
      action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
      proxy: {
        settings: {
          set: (val) => {
            appliedProxySettings = val;
            return Promise.resolve();
          }
        }
      },
      webRequest: { onAuthRequired: { addListener: () => {} }, onCompleted: { addListener: () => {} }, onErrorOccurred: { addListener: () => {} } },
      runtime: { getManifest: () => ({ version: "1.0.0" }), id: "test-id", onMessage: { addListener: () => {} } }
    };
    ${src}
    globalThis.testApplyProxyConfig = applyProxyConfig;
  `;
  const ctx = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    Date,
    URL,
    fetch: () => Promise.resolve({ ok: false }),
    AbortSignal,
    Map,
    parseInt,
    appliedProxySettings: null,
  });
  vm.runInContext(vmScript, ctx);

  // 1. HTTP proxy config with pacUrl present (standard server response with routing profile)
  await (ctx as any).testApplyProxyConfig({
    protocol: "http",
    host: "proxy.corp.example",
    port: 10809,
    pacUrl: "https://mini-server.corp.example/proxy.pac?profileId=profile_default_split",
  });
  assert.strictEqual(
    (ctx as any).appliedProxySettings?.value?.mode,
    "pac_script",
    "must use pac_script mode when pacUrl is provided by server"
  );
  assert.strictEqual(
    (ctx as any).appliedProxySettings?.value?.pacScript?.url,
    "https://mini-server.corp.example/proxy.pac?profileId=profile_default_split"
  );

  // 2. Fixed servers mode when routingMode: "fixed"
  await (ctx as any).testApplyProxyConfig({
    protocol: "http",
    host: "proxy.corp.example",
    port: 10809,
    routingMode: "fixed",
    pacUrl: "https://mini-server.corp.example/proxy.pac?profileId=profile_default_split",
  });
  assert.strictEqual(
    (ctx as any).appliedProxySettings?.value?.mode,
    "fixed_servers",
    "must use fixed_servers mode when routingMode is fixed"
  );
  assert.strictEqual(
    (ctx as any).appliedProxySettings?.value?.rules?.singleProxy?.host,
    "proxy.corp.example"
  );
});

test("purity: background.js installs the PAC script INLINE (pacScript.data) when the PAC endpoint is reachable", async () => {
  const bgPath = path.join(REPO_ROOT, "extension", "background.js");
  const src = fs.readFileSync(bgPath, "utf-8");
  const vm = await import("node:vm");

  // A realistic split-profile PAC as served by GET /proxy.pac
  const pacScript = [
    "// Profile: Direct by Default (Selective Proxy) (Policy: Default DIRECT)",
    "// Generated: 2026-09-28T04:54:36.837Z",
    "function FindProxyForURL(url, host) {",
    '  host = ("" + host).toLowerCase();',
    '  if (dnsDomainIs(host, "chatgpt.com")) { return "PROXY proxy.example.corp:10810; DIRECT"; }',
    '  return "DIRECT";',
    "}",
    "",
  ].join("\n");

  const vmScript = `
    const chrome = {
      storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() }, managed: { get: () => Promise.resolve({}) } },
      alarms: { create: () => {}, get: (_n, cb) => cb && cb(null), onAlarm: { addListener: () => {} } },
      privacy: { network: { webRTCIPHandlingPolicy: { set: () => Promise.resolve() } } },
      action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
      proxy: {
        settings: {
          set: (val) => {
            appliedProxySettings = val;
            return Promise.resolve();
          },
          get: (_q) => Promise.resolve({ value: { mode: "pac_script" }, levelOfControl: "controlled_by_this_extension" })
        },
        onProxyError: { addListener: () => {} }
      },
      webRequest: { onAuthRequired: { addListener: () => {} }, onCompleted: { addListener: () => {} }, onErrorOccurred: { addListener: () => {} } },
      runtime: { getManifest: () => ({ version: "1.0.0" }), id: "test-id", onMessage: { addListener: () => {} } }
    };
    ${src}
    globalThis.testApplyProxyConfig = applyProxyConfig;
  `;
  const ctx = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    Date,
    URL,
    fetch: () => Promise.resolve({ ok: true, text: () => Promise.resolve(pacScript) }),
    AbortSignal,
    Map,
    parseInt,
    appliedProxySettings: null,
  });
  vm.runInContext(vmScript, ctx);

  await (ctx as any).testApplyProxyConfig({
    protocol: "http",
    host: "proxy.example.corp",
    port: 10810,
    pacUrl: "https://pac.example.corp/proxy.pac?profileId=profile_default_split",
  });

  assert.strictEqual(
    (ctx as any).appliedProxySettings?.value?.mode,
    "pac_script",
    "PAC profile configs must be applied in pac_script mode"
  );
  const pac = (ctx as any).appliedProxySettings?.value?.pacScript;
  assert.ok(pac?.data, "when the PAC endpoint is reachable the script must be installed inline via pacScript.data");
  assert.ok(String(pac.data).includes("FindProxyForURL"), "inline PAC must contain the entry point function");
  assert.strictEqual(pac.url, undefined, "url-mode is a fallback only and must not be set when data is available");
  assert.strictEqual(pac.mandatory, false, "fail-open semantics are preserved (mandatory=false)");
});

test("purity: background.js maintains ring-buffer logs and handles GET_LOGS and CLEAR_LOGS", async () => {
  const bgPath = path.join(REPO_ROOT, "extension", "background.js");
  const src = fs.readFileSync(bgPath, "utf-8");
  const vm = await import("node:vm");

  let capturedMessageListener: any = null;
  const storageData: Record<string, any> = {};

  const vmScript = `
    const chrome = {
      storage: {
        local: {
          get: (keys, cb) => {
            const res = typeof keys === "string" ? { [keys]: storageData[keys] } : storageData;
            if (cb) cb(res);
            return Promise.resolve(res);
          },
          set: (obj, cb) => {
            Object.assign(storageData, obj);
            if (cb) cb();
            return Promise.resolve();
          }
        },
        managed: { get: () => Promise.resolve({}) }
      },
      alarms: { create: () => {}, get: (_n, cb) => cb && cb(null), onAlarm: { addListener: () => {} } },
      privacy: { network: { webRTCIPHandlingPolicy: { set: () => Promise.resolve() } } },
      action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
      proxy: {
        settings: {
          set: () => Promise.resolve(),
          get: () => Promise.resolve({ value: { mode: "pac_script" }, levelOfControl: "controlled_by_this_extension" })
        },
        onProxyError: { addListener: () => {} }
      },
      webRequest: { onAuthRequired: { addListener: () => {} }, onCompleted: { addListener: () => {} }, onErrorOccurred: { addListener: () => {} } },
      runtime: {
        getManifest: () => ({ version: "1.0.0" }),
        id: "test-id",
        onMessage: {
          addListener: (fn) => { capturedMessageListener = fn; }
        }
      }
    };
    ${src}
    globalThis.testLogEvent = typeof logEvent !== "undefined" ? logEvent : undefined;
    globalThis.testMessageListener = capturedMessageListener;
  `;
  const ctx = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    Date,
    URL,
    fetch: () => Promise.resolve({ ok: false }),
    AbortSignal,
    Map,
    parseInt,
    storageData,
    capturedMessageListener: null,
  });
  vm.runInContext(vmScript, ctx);

  // 1. logEvent exists and records entries
  assert.strictEqual(typeof (ctx as any).testLogEvent, "function", "logEvent must be defined");
  (ctx as any).testLogEvent("info", "Test event 1");
  (ctx as any).testLogEvent("warn", "Test event 2");

  // 2. GET_LOGS returns the entries
  let logsResponse: any = null;
  (ctx as any).testMessageListener({ action: "GET_LOGS" }, {}, (res: any) => { logsResponse = res; });
  assert.ok(logsResponse && Array.isArray(logsResponse.logs), "GET_LOGS must return logs array");
  assert.ok(logsResponse.logs.some((l: any) => l.message && l.message.includes("Test event 1")), "logs must contain Test event 1");

  // 3. CLEAR_LOGS empties the ring buffer
  (ctx as any).testMessageListener({ action: "CLEAR_LOGS" }, {}, (_res: any) => {});
  let clearedLogs: any = null;
  (ctx as any).testMessageListener({ action: "GET_LOGS" }, {}, (res: any) => { clearedLogs = res; });
  assert.strictEqual(clearedLogs.logs.length, 0, "logs must be empty after CLEAR_LOGS");
});

test("purity: popup.html and popup.js render diagnostics log terminal with copy and refresh actions", () => {
  const htmlPath = path.join(REPO_ROOT, "extension", "popup.html");
  const jsPath = path.join(REPO_ROOT, "extension", "popup.js");
  const html = fs.readFileSync(htmlPath, "utf-8");
  const js = fs.readFileSync(jsPath, "utf-8");

  assert.ok(html.includes('id="logContainer"'), "popup.html must contain logContainer element");
  assert.ok(html.includes('id="btnCopyLogs"'), "popup.html must contain btnCopyLogs button");
  assert.ok(html.includes('id="btnClearLogs"'), "popup.html must contain btnClearLogs button");

  assert.ok(js.includes("GET_LOGS"), "popup.js must request GET_LOGS from background worker");
  assert.ok(js.includes("CLEAR_LOGS"), "popup.js must support CLEAR_LOGS");
});

test("purity: background.js handles non-ASCII PAC scripts safely and falls back to URL mode if inline set fails", async () => {
  const bgPath = path.join(REPO_ROOT, "extension", "background.js");
  const src = fs.readFileSync(bgPath, "utf-8");
  const vm = await import("node:vm");

  // A PAC script with non-ASCII Russian comment
  const rawPacScript = '// Профиль: Корпоративный\nfunction FindProxyForURL(url, host) { return "DIRECT"; }\n';

  let appliedSettings: any = null;
  const vmScript = `
    const chrome = {
      storage: {
        local: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
        managed: { get: () => Promise.resolve({}) }
      },
      alarms: { create: () => {}, get: (_n, cb) => cb && cb(null), onAlarm: { addListener: () => {} } },
      privacy: { network: { webRTCIPHandlingPolicy: { set: () => Promise.resolve() } } },
      action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
      proxy: {
        settings: {
          set: (cfg) => {
            appliedSettings = cfg;
            // Simulate Chrome's exact C++ validation error when pacScript.data contains non-ASCII:
            if (cfg.value?.pacScript?.data && /[^\x00-\x7F]/.test(cfg.value.pacScript.data)) {
              throw new Error("'pacScript.data' supports only ASCII code(encode URLs in Punycode format).");
            }
            return Promise.resolve();
          },
          get: () => Promise.resolve({ value: { mode: "pac_script" }, levelOfControl: "controlled_by_this_extension" })
        },
        onProxyError: { addListener: () => {} }
      },
      webRequest: { onAuthRequired: { addListener: () => {} }, onCompleted: { addListener: () => {} }, onErrorOccurred: { addListener: () => {} } },
      runtime: { getManifest: () => ({ version: "1.0.0" }), id: "test-id", onMessage: { addListener: () => {} } }
    };
    ${src}
    globalThis.testApplyProxyConfig = applyProxyConfig;
  `;
  const ctx = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    Date,
    URL,
    fetch: () => Promise.resolve({ ok: true, text: () => Promise.resolve(rawPacScript) }),
    AbortSignal,
    Map,
    parseInt,
    appliedSettings: null,
  });
  vm.runInContext(vmScript, ctx);

  await (ctx as any).testApplyProxyConfig({
    protocol: "pac",
    pacUrl: "https://example.corp/proxy.pac",
  });

  // Verify that proxy was applied without error and either sanitized data to ASCII or fell back to url
  assert.strictEqual((ctx as any).appliedSettings?.value?.mode, "pac_script");
  const pac = (ctx as any).appliedSettings?.value?.pacScript;
  assert.ok(pac, "pacScript configuration must be set");
  if (pac.data) {
    assert.ok(/^[\x00-\x7F]+$/.test(pac.data), "pacScript.data must be 100% 7-bit ASCII");
  } else {
    assert.strictEqual(pac.url, "https://example.corp/proxy.pac");
  }
});

test("purity: background.js logs HTTP error status when /api/sync fails with non-OK status", async () => {
  const bgPath = path.join(REPO_ROOT, "extension", "background.js");
  const src = fs.readFileSync(bgPath, "utf-8");
  const vm = await import("node:vm");

  const loggedEvents: Array<{ level: string; message: string }> = [];

  const vmScript = `
    const chrome = {
      storage: {
        local: {
          get: () => Promise.resolve({ pecLogs: [] }),
          set: (obj) => {
            if (obj.pecLogs) {
              loggedEvents.length = 0;
              loggedEvents.push(...obj.pecLogs);
            }
            return Promise.resolve();
          }
        },
        managed: { get: () => Promise.resolve({}) }
      },
      alarms: { create: () => {}, get: (_n, cb) => cb && cb(null), onAlarm: { addListener: () => {} } },
      privacy: { network: { webRTCIPHandlingPolicy: { set: () => Promise.resolve() } } },
      action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
      proxy: {
        settings: {
          set: () => Promise.resolve(),
          get: () => Promise.resolve({ value: { mode: "system" }, levelOfControl: "controlled_by_this_extension" })
        },
        onProxyError: { addListener: () => {} }
      },
      webRequest: { onAuthRequired: { addListener: () => {} }, onCompleted: { addListener: () => {} }, onErrorOccurred: { addListener: () => {} } },
      runtime: { getManifest: () => ({ version: "1.0.0" }), id: "test-id", onMessage: { addListener: () => {} } }
    };
    ${src}
    globalThis.testSyncWithServer = syncWithServer;
  `;

  const ctx = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    Date,
    URL,
    fetch: (url: string) => {
      if (url.includes("/api/sync")) {
        return Promise.resolve({
          ok: false,
          status: 401,
          statusText: "Unauthorized",
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ user: "fallbackUser", pass: "fallbackPass" }),
      });
    },
    AbortSignal,
    Map,
    parseInt,
    loggedEvents,
  });

  vm.runInContext(vmScript, ctx);

  await (ctx as any).testSyncWithServer(true);

  const syncFailLog = loggedEvents.find(
    (e) => e.level === "warn" && e.message.includes("/api/sync returned HTTP 401")
  );
  assert.ok(syncFailLog, "must record warning log with HTTP 401 status when /api/sync fails");
});

test("purity: background.js parses and stores profileDefaultPolicy from /api/sync and delivers via GET_STATUS", async () => {
  const bgPath = path.join(REPO_ROOT, "extension", "background.js");
  const src = fs.readFileSync(bgPath, "utf-8");
  const vm = await import("node:vm");

  const vmScript = `
    const chrome = {
      storage: {
        local: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
        managed: { get: () => Promise.resolve({}) }
      },
      alarms: { create: () => {}, get: (_n, cb) => cb && cb(null), onAlarm: { addListener: () => {} } },
      privacy: { network: { webRTCIPHandlingPolicy: { set: () => Promise.resolve() } } },
      action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
      proxy: {
        settings: {
          set: () => Promise.resolve(),
          get: () => Promise.resolve({ value: { mode: "system" }, levelOfControl: "controlled_by_this_extension" })
        },
        onProxyError: { addListener: () => {} }
      },
      webRequest: { onAuthRequired: { addListener: () => {} }, onCompleted: { addListener: () => {} }, onErrorOccurred: { addListener: () => {} } },
      runtime: {
        getManifest: () => ({ version: "1.0.0" }),
        id: "test-id",
        onMessage: {
          addListener: (fn) => { globalThis.capturedMessageListener = fn; }
        }
      }
    };
    ${src}
    globalThis.testSyncWithServer = syncWithServer;
  `;

  const ctx = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    Date,
    URL,
    fetch: (url: string) => {
      if (url.includes("/api/sync")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            profileName: "Full Tunnel VIP",
            profileDefaultPolicy: "proxy",
            config: {
              protocol: "pac",
              pacUrl: "https://pac.example.corp/proxy.pac",
            },
            creds: { user: "u", pass: "p" },
          }),
        });
      }
      return Promise.resolve({ ok: true, text: () => Promise.resolve("function FindProxyForURL() { return 'DIRECT'; }") });
    },
    AbortSignal,
    Map,
    parseInt,
  });

  vm.runInContext(vmScript, ctx);

  await (ctx as any).testSyncWithServer(true);

  // Ask GET_STATUS via message listener
  let statusResponse: any = null;
  (ctx as any).capturedMessageListener({ action: "GET_STATUS" }, {}, (resp: any) => {
    statusResponse = resp;
  });

  assert.ok(statusResponse, "GET_STATUS must return status object");
  assert.strictEqual(statusResponse.profileDefaultPolicy, "proxy", "profileDefaultPolicy must be passed through");
});

test("purity: popup.js and renderPopupJs render descriptive routing mode indicator (selective vs tunnel) with tooltips", async () => {
  const popupJsPath = path.join(REPO_ROOT, "extension", "popup.js");
  const src = fs.readFileSync(popupJsPath, "utf-8");
  const vm = await import("node:vm");

  function evaluateApplyPopupState(popupScript: string, state: any) {
    const elements: Record<string, any> = {
      statusText: { textContent: "", title: "", className: "", addEventListener: () => {} },
      badge: { textContent: "", title: "", className: "", addEventListener: () => {} },
      modeVal: { textContent: "", title: "", className: "", addEventListener: () => {} },
      serverVal: { textContent: "", title: "", className: "", addEventListener: () => {} },
      profileVal: { textContent: "", title: "", className: "", addEventListener: () => {} },
      pingVal: { textContent: "", title: "", className: "", addEventListener: () => {} },
      exitIpVal: { textContent: "", title: "", className: "", addEventListener: () => {} },
      tabRulesDefaultPolicy: { textContent: "", title: "", className: "", addEventListener: () => {} },
      btnToggleBypass: { textContent: "", title: "", className: "", addEventListener: () => {} },
      btnSync: { textContent: "", title: "", className: "", addEventListener: () => {} },
      btnCheckIp: { textContent: "", title: "", className: "", addEventListener: () => {} },
    };

    const ctx = vm.createContext({
      window: {
        addEventListener: () => {},
      },
      document: {
        getElementById: (id: string) => elements[id] || null,
        querySelectorAll: () => [],
      },
      console,
    });

    vm.runInContext(popupScript, ctx);
    (ctx as any).window.applyPopupState(state);
    return elements;
  }

  // 1. Test extension/popup.js with selective PAC
  const el1 = evaluateApplyPopupState(src, {
    online: true,
    protocol: "pac",
    profileDefaultPolicy: "direct",
  });
  assert.strictEqual(el1.modeVal.textContent, "PAC (селективный)");
  assert.ok(el1.modeVal.title.includes("домены из правил"), "modeVal must have informative tooltip");
  assert.strictEqual(el1.tabRulesDefaultPolicy.textContent, "DIRECT (селективный)");

  // 2. Test extension/popup.js with full tunnel PAC
  const el2 = evaluateApplyPopupState(src, {
    online: true,
    protocol: "pac",
    profileDefaultPolicy: "proxy",
  });
  assert.strictEqual(el2.modeVal.textContent, "PAC (туннель)");
  assert.ok(el2.modeVal.title.includes("Весь трафик через прокси"), "modeVal must have tunnel tooltip");
  assert.strictEqual(el2.tabRulesDefaultPolicy.textContent, "PROXY (туннель)");

  // 3. Test renderPopupJs template from extensionTemplates
  const { renderPopupJs } = await import("../src/extensionTemplates.js");
  const { DEFAULT_BUILD_CONFIG } = await import("../src/packager.js");
  const generatedJs = renderPopupJs(DEFAULT_BUILD_CONFIG);
  const el3 = evaluateApplyPopupState(generatedJs, {
    online: true,
    protocol: "pac",
    profileDefaultPolicy: "direct",
  });
  assert.strictEqual(el3.modeVal.textContent, "PAC (селективный)");
  assert.ok(el3.modeVal.title.length > 0, "rendered template must set tooltip title");
});

test("purity: background.js sets ERR badge and logs warning when proxyReachable is false", async () => {
  const bgPath = path.join(REPO_ROOT, "extension", "background.js");
  const src = fs.readFileSync(bgPath, "utf-8");
  const vm = await import("node:vm");

  const loggedEvents: Array<{ level: string; message: string }> = [];

  const vmScript = `
    const chrome = {
      storage: {
        local: {
          get: () => Promise.resolve({ pecLogs: [] }),
          set: (obj) => {
            if (obj.pecLogs) {
              loggedEvents.length = 0;
              loggedEvents.push(...obj.pecLogs);
            }
            return Promise.resolve();
          }
        },
        managed: { get: () => Promise.resolve({}) }
      },
      alarms: { create: () => {}, get: (_n, cb) => cb && cb(null), onAlarm: { addListener: () => {} } },
      privacy: { network: { webRTCIPHandlingPolicy: { set: () => Promise.resolve() } } },
      action: {
        setBadgeText: (opt) => { globalThis.badgeText = opt.text; },
        setBadgeBackgroundColor: (opt) => { globalThis.badgeColor = opt.color; }
      },
      proxy: {
        settings: {
          set: () => Promise.resolve(),
          get: () => Promise.resolve({ value: { mode: "pac_script" }, levelOfControl: "controlled_by_this_extension" })
        },
        onProxyError: { addListener: () => {} }
      },
      webRequest: { onAuthRequired: { addListener: () => {} }, onCompleted: { addListener: () => {} }, onErrorOccurred: { addListener: () => {} } },
      runtime: {
        getManifest: () => ({ version: "1.0.0" }),
        id: "test-id",
        onMessage: { addListener: () => {} }
      }
    };
    ${src}
    globalThis.testSyncWithServer = syncWithServer;
  `;

  const ctx = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    Date,
    URL,
    fetch: (url: string) => {
      if (url.includes("/api/sync")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            profileName: "Dead Proxy Profile",
            profileDefaultPolicy: "direct",
            proxyReachable: false,
            config: {
              protocol: "pac",
              pacUrl: "https://pac.example.corp/proxy.pac",
              host: "192.0.2.1",
              port: 10809,
            },
            creds: { user: "u", pass: "p" },
          }),
        });
      }
      return Promise.resolve({ ok: true, text: () => Promise.resolve("function FindProxyForURL() { return 'DIRECT'; }") });
    },
    AbortSignal,
    Map,
    parseInt,
    loggedEvents,
  });

  vm.runInContext(vmScript, ctx);

  await (ctx as any).testSyncWithServer(true);

  assert.strictEqual((ctx as any).badgeText, "ERR", "badge must show ERR when proxy is unreachable");
  assert.strictEqual((ctx as any).badgeColor, "#ef4444", "badge color must be red");
  const warnLog = loggedEvents.find(
    (e) => e.level === "warn" && e.message.toLowerCase().includes("unreachable")
  );
  assert.ok(warnLog, "must record warning log about unreachable proxy");
});

test("purity: package.json provides distinct build:server and build:extension scripts", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8"));
  assert.ok(pkg.scripts["build:server"], "package.json must define build:server");
  assert.ok(pkg.scripts["build:extension"], "package.json must define build:extension");
  assert.match(pkg.scripts["build:server"], /esbuild server\.ts/);
  assert.match(pkg.scripts["build:extension"], /pack-extension\.ts/);
});

test("purity: extension/README.md references actual npm/tsx build script and not nonexistent pack.py", () => {
  const readme = fs.readFileSync(path.join(REPO_ROOT, "extension", "README.md"), "utf-8");
  assert.ok(!readme.includes("pack.py"), "extension/README.md must not reference nonexistent pack.py");
  assert.ok(
    readme.includes("pack-extension.ts") || readme.includes("build:extension"),
    "extension/README.md must reference pack-extension.ts or build:extension"
  );
});

test("purity: extension/popup.html uses russian lang attribute", () => {
  const html = fs.readFileSync(path.join(REPO_ROOT, "extension", "popup.html"), "utf-8");
  assert.match(html, /<html\s+lang="ru">/);
});









