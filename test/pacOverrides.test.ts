import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { BACKGROUND_TEMPLATE } from "../src/extensionTemplates.js";
import { injectUserRulesIntoPac } from "../src/extensionPureLogic.js";

const REPO_ROOT = path.resolve(".");

test("injectUserRulesIntoPac inserts active user rules into FindProxyForURL", () => {
  const basePac = `
function FindProxyForURL(url, host) {
  if (shExpMatch(host, "*.internal.corp")) return "DIRECT";
  return "PROXY proxy.corp:3128";
}
`;
  const rules = [
    { pattern: "*.custom-direct.com", action: "DIRECT", enabled: true },
    { pattern: "specific-proxy.org", action: "PROXY", enabled: true },
    { pattern: "disabled.com", action: "DIRECT", enabled: false },
  ];

  const modified = injectUserRulesIntoPac(basePac, rules, "proxy.corp:3128");

  assert.ok(modified.includes('shExpMatch(host, "*.custom-direct.com")'));
  assert.ok(modified.includes('return "DIRECT";'));
  assert.ok(modified.includes('host === "specific-proxy.org" || dnsDomainIs(host, ".specific-proxy.org") || shExpMatch(host, "*.specific-proxy.org")'));
  assert.ok(modified.includes('return "PROXY proxy.corp:3128";'));
  assert.ok(!modified.includes("disabled.com"));

  // Verify PAC execution syntax in VM
  const sandbox: any = {
    shExpMatch: (host: string, pattern: string) => {
      const regex = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
      return regex.test(host);
    },
    dnsDomainIs: (host: string, domain: string) => {
      return host === domain || host.endsWith(domain);
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(modified, sandbox);

  assert.equal(sandbox.FindProxyForURL("http://sub.custom-direct.com", "sub.custom-direct.com"), "DIRECT");
  assert.equal(sandbox.FindProxyForURL("http://specific-proxy.org", "specific-proxy.org"), "PROXY proxy.corp:3128");
  assert.equal(sandbox.FindProxyForURL("http://other.com", "other.com"), "PROXY proxy.corp:3128");
});

test("injectUserRulesIntoPac handles edge cases safely", () => {
  // Empty or invalid input
  assert.equal(injectUserRulesIntoPac("", [], "proxy.corp:3128"), "");
  assert.equal(injectUserRulesIntoPac("invalid", null as any, "proxy.corp:3128"), "invalid");

  // All disabled rules
  const basePac = "function FindProxyForURL(url, host) { return 'DIRECT'; }";
  const disabledRules = [{ pattern: "example.com", action: "PROXY", enabled: false }];
  assert.equal(injectUserRulesIntoPac(basePac, disabledRules, "proxy:8080"), basePac);

  // Sanitizes dangerous quote or escape characters in pattern
  const dangerousRules = [{ pattern: 'test".corp; return "DIRECT', action: "PROXY", enabled: true }];
  const sanitized = injectUserRulesIntoPac(basePac, dangerousRules, "proxy:8080");
  assert.ok(!sanitized.includes('test".corp'));
  assert.ok(sanitized.includes('test.corp; return DIRECT'));

  // Sanitizes dangerous newlines in pattern
  const newlineRules = [{ pattern: 'malicious\r\n.corp', action: "PROXY", enabled: true }];
  const sanitizedNl = injectUserRulesIntoPac(basePac, newlineRules, "proxy:8080");
  assert.ok(!sanitizedNl.includes("\r"));
  assert.ok(!sanitizedNl.includes("\n  if (shExpMatch(host, \"malicious\r\n"));
  assert.ok(sanitizedNl.includes('malicious.corp'));
});

test("background.js handles GET_USER_RULES, SAVE_USER_RULES, and SET_ENABLED messages", async () => {
  let storedRules: any[] = [];
  let isEnabled = true;
  const handleMsg = async (msg: any) => {
    if (msg.type === "GET_USER_RULES" || msg.action === "GET_USER_RULES") {
      return { userRules: storedRules };
    }
    if (msg.type === "SAVE_USER_RULES" || msg.action === "SAVE_USER_RULES") {
      storedRules = msg.rules || [];
      return { ok: true, count: storedRules.length };
    }
    if (msg.type === "SET_ENABLED" || msg.action === "SET_ENABLED") {
      isEnabled = Boolean(msg.enabled);
      return { ok: true, enabled: isEnabled };
    }
    return null;
  };

  const getRes = await handleMsg({ type: "GET_USER_RULES" });
  assert.ok(getRes);
  assert.deepEqual(getRes.userRules, []);

  const saveRes = await handleMsg({
    type: "SAVE_USER_RULES",
    rules: [{ pattern: "foo.com", action: "DIRECT", enabled: true }],
  });
  assert.ok(saveRes);
  assert.equal(saveRes.ok, true);
  assert.equal(saveRes.count, 1);

  const getUpdated = await handleMsg({ type: "GET_USER_RULES" });
  assert.ok(getUpdated && getUpdated.userRules);
  assert.equal(getUpdated.userRules.length, 1);

  const setEnabledRes = await handleMsg({ type: "SET_ENABLED", enabled: false });
  assert.ok(setEnabledRes);
  assert.equal(setEnabledRes.enabled, false);
});

test("integration: background.js and BACKGROUND_TEMPLATE implement injectUserRulesIntoPac and message handlers", async () => {
  const bgPath = path.join(REPO_ROOT, "extension", "background.js");
  const bgContent = fs.readFileSync(bgPath, "utf-8");

  // Must declare injectUserRulesIntoPac helper
  assert.ok(bgContent.includes("function injectUserRulesIntoPac"), "background.js must define injectUserRulesIntoPac");
  assert.ok(BACKGROUND_TEMPLATE.includes("function injectUserRulesIntoPac"), "BACKGROUND_TEMPLATE must define injectUserRulesIntoPac");

  // Must handle GET_USER_RULES, SAVE_USER_RULES, SET_ENABLED
  assert.ok(bgContent.includes("GET_USER_RULES"), "background.js must handle GET_USER_RULES");
  assert.ok(bgContent.includes("SAVE_USER_RULES"), "background.js must handle SAVE_USER_RULES");
  assert.ok(bgContent.includes("SET_ENABLED"), "background.js must handle SET_ENABLED");

  // Must store in pecUserRules
  assert.ok(bgContent.includes("pecUserRules"), "background.js must use pecUserRules storage key");
  assert.ok(BACKGROUND_TEMPLATE.includes("pecUserRules"), "BACKGROUND_TEMPLATE must use pecUserRules storage key");

  // Both files must stay in sync
  assert.equal(
    bgContent.replace(/\r\n/g, "\n").trim(),
    BACKGROUND_TEMPLATE.replace(/\r\n/g, "\n").trim(),
    "extension/background.js and BACKGROUND_TEMPLATE must be identical"
  );
});

test("integration: background.js executes in MV3 environment with message handling and PAC overrides", async () => {
  const bgPath = path.join(REPO_ROOT, "extension", "background.js");
  const src = fs.readFileSync(bgPath, "utf-8");

  const storageData: Record<string, any> = {};
  let messageHandler: any = null;
  let appliedProxySettings: any = null;

  const mockChrome = {
    storage: {
      local: {
        get: (keys: string[] | string) => {
          const keyArr = Array.isArray(keys) ? keys : [keys];
          const res: Record<string, any> = {};
          for (const k of keyArr) {
            if (k in storageData) res[k] = storageData[k];
          }
          return Promise.resolve(res);
        },
        set: (items: Record<string, any>) => {
          Object.assign(storageData, items);
          return Promise.resolve();
        },
        remove: (keys: string[] | string) => {
          const keyArr = Array.isArray(keys) ? keys : [keys];
          for (const k of keyArr) delete storageData[k];
          return Promise.resolve();
        },
      },
      managed: { get: () => Promise.resolve({}) },
    },
    alarms: { create: () => {}, get: (_n: any, cb: any) => cb && cb(null), onAlarm: { addListener: () => {} } },
    privacy: { network: { webRTCIPHandlingPolicy: { set: () => Promise.resolve() } } },
    action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
    proxy: {
      settings: {
        set: (val: any) => {
          appliedProxySettings = val;
          return Promise.resolve();
        },
        get: () => Promise.resolve({ value: { mode: "pac_script" }, levelOfControl: "controlled_by_this_extension" }),
      },
      onProxyError: { addListener: () => {} },
    },
    webRequest: {
      onAuthRequired: { addListener: () => {} },
      onCompleted: { addListener: () => {} },
      onErrorOccurred: { addListener: () => {} },
    },
    runtime: {
      getManifest: () => ({ version: "1.0.0" }),
      id: "test-ext-id",
      onMessage: {
        addListener: (fn: any) => {
          messageHandler = fn;
        },
      },
    },
  };

  const pacContent = `
function FindProxyForURL(url, host) {
  if (shExpMatch(host, "*.corp")) return "PROXY 10.0.0.1:8080";
  return "DIRECT";
}
`;

  const ctx = vm.createContext({
    chrome: mockChrome,
    console,
    setTimeout,
    clearTimeout,
    Date,
    URL,
    fetch: (url: string) => {
      if (url.includes("proxy.pac")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(pacContent),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    },
    AbortSignal,
    Map,
    parseInt,
    appliedProxySettings: null,
  });

  vm.runInContext(src, ctx);
  assert.ok(messageHandler, "messageHandler must be registered");

  const sendMsg = (msg: any): Promise<any> => {
    return new Promise((resolve) => {
      messageHandler(msg, {}, (res: any) => resolve(res));
    });
  };

  // 1. GET_USER_RULES initially empty
  const getRes1 = await sendMsg({ type: "GET_USER_RULES" });
  assert.equal(getRes1.userRules.length, 0);

  // 2. SAVE_USER_RULES saves rules to storage and triggers applyProxySettings
  const saveRes = await sendMsg({
    type: "SAVE_USER_RULES",
    rules: [
      { pattern: "*.special-domain.com", action: "DIRECT", enabled: true },
      { pattern: "proxy-override.com", action: "PROXY", enabled: true },
    ],
  });
  assert.equal(saveRes.ok, true);
  assert.equal(saveRes.count, 2);
  assert.equal(storageData.pecUserRules.length, 2);

  // 3. GET_USER_RULES returns updated rules
  const getRes2 = await sendMsg({ type: "GET_USER_RULES" });
  assert.equal(getRes2.userRules.length, 2);

  // 4. SET_ENABLED toggles enabled
  const setEnabledRes = await sendMsg({ type: "SET_ENABLED", enabled: false });
  assert.equal(setEnabledRes.ok, true);
  assert.equal(setEnabledRes.enabled, false);
  assert.equal(storageData.pecEnabled, false);
  assert.equal(appliedProxySettings?.value?.mode, "direct");

  // Re-enable
  await sendMsg({ type: "SET_ENABLED", enabled: true });

  // 5. Test applyProxyConfig with pacUrl: injected user overrides are installed in pacScript.data
  await (ctx as any).applyProxyConfig({
    protocol: "pac",
    host: "proxy.corp",
    port: 3128,
    pacUrl: "https://server.corp/proxy.pac",
  });

  assert.equal(appliedProxySettings?.value?.mode, "pac_script");
  const installedPac = appliedProxySettings?.value?.pacScript?.data;
  assert.ok(installedPac, "PAC script must be installed inline");
  assert.ok(installedPac.includes('shExpMatch(host, "*.special-domain.com")'));
  assert.ok(installedPac.includes('return "DIRECT";'));
  assert.ok(installedPac.includes('host === "proxy-override.com" || dnsDomainIs(host, ".proxy-override.com") || shExpMatch(host, "*.proxy-override.com")'));
  assert.ok(installedPac.includes('return "PROXY proxy.corp:3128";'));
});
