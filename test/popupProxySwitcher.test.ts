import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { renderPopupHtml } from "../src/templates/popupHtmlTemplate.js";

test("Task 6: popup.html contains proxy selector card on routing tab", () => {
  const html = renderPopupHtml();
  assert.ok(html.includes("selectActiveProxy"), "popup HTML must include #selectActiveProxy select");
  assert.ok(html.includes("cardProxySelector"), "popup HTML must include #cardProxySelector container");
});

test("Task 6: popup.js and background.js handle SET_ACTIVE_PROXY action", () => {
  const popupJs = fs.readFileSync(path.resolve("extension/popup.js"), "utf8");
  assert.ok(popupJs.includes("selectActiveProxy"), "popup.js must bind selectActiveProxy");
  assert.ok(popupJs.includes("SET_ACTIVE_PROXY"), "popup.js must send SET_ACTIVE_PROXY");

  const bgJs = fs.readFileSync(path.resolve("extension/background.js"), "utf8");
  assert.ok(bgJs.includes("SET_ACTIVE_PROXY"), "background.js must handle SET_ACTIVE_PROXY");
});

test("Task 6: popup.js applyPopupState toggles cardProxySelector and populates selectActiveProxy", () => {
  const popupJs = fs.readFileSync(path.resolve("extension/popup.js"), "utf8");
  const elements: Record<string, any> = {
    cardProxySelector: { style: { display: "" } },
    selectActiveProxy: { innerHTML: "", value: "", addEventListener: () => {} },
    activeProxyProtocolBadge: { textContent: "" },
  };

  const context: any = {
    window: {
      addEventListener: () => {},
    },
    document: {
      getElementById: (id: string) => elements[id] || null,
      querySelectorAll: () => [],
      querySelector: () => null,
      body: { setAttribute: () => {} },
      addEventListener: () => {},
    },
    currentProxyState: {},
    console,
  };
  context.window = Object.assign(context.window, context);

  vm.createContext(context);
  vm.runInContext(popupJs, context);

  // 1. When allowUserProxySwitch is false, hide selector
  context.window.applyPopupState({
    allowUserProxySwitch: false,
    availableProxies: [{ id: "px1", name: "Node 1", protocol: "socks5", host: "1.1.1.1", port: 1080 }],
    activeProxyId: "px1",
    protocol: "socks5",
  });
  assert.strictEqual(elements.cardProxySelector.style.display, "none");

  // 2. When allowUserProxySwitch is true, show selector and populate options
  context.window.applyPopupState({
    allowUserProxySwitch: true,
    availableProxies: [
      { id: "px1", name: "Node 1", protocol: "socks5", host: "1.1.1.1", port: 1080 },
      { id: "px2", name: "Node 2", protocol: "http", host: "2.2.2.2", port: 8080 },
    ],
    activeProxyId: "px2",
    protocol: "http",
  });
  assert.strictEqual(elements.cardProxySelector.style.display, "block");
  assert.ok(elements.selectActiveProxy.innerHTML.includes("px1"));
  assert.ok(elements.selectActiveProxy.innerHTML.includes("px2"));
  assert.strictEqual(elements.selectActiveProxy.value, "px2");
  assert.strictEqual(elements.activeProxyProtocolBadge.textContent, "HTTP");

  // 3. When protocol is "pac" (enterprise PAC mode), badge reflects selected node's protocol (SOCKS5), not "PAC"
  context.window.applyPopupState({
    allowUserProxySwitch: true,
    availableProxies: [
      { id: "px1", name: 'Node <script> & "quotes"', protocol: "socks5", host: "1.1.1.1", port: 1080 },
    ],
    activeProxyId: "px1",
    protocol: "pac",
  });
  assert.strictEqual(elements.activeProxyProtocolBadge.textContent, "SOCKS5");
  // HTML escaping prevents raw script or unescaped quotes injection
  assert.ok(!elements.selectActiveProxy.innerHTML.includes("<script>"));
  assert.ok(elements.selectActiveProxy.innerHTML.includes("&lt;script&gt;"));
  assert.ok(elements.selectActiveProxy.innerHTML.includes("&quot;quotes&quot;"));
});

test("Task 6: background.js SET_ACTIVE_PROXY switches active proxy and respects allowUserProxySwitch", async () => {
  const bgJs = fs.readFileSync(path.resolve("extension/background.js"), "utf8");
  const storageData: Record<string, any> = {};
  let capturedBody: any = null;

  const substituted = bgJs
    .replace(/"__PEC_SERVER_BASE__"/g, '"https://test.corp"')
    .replace(/"__PEC_DEFAULT_TOKEN__"/g, '"test-token"');

  const vmScript = `
    const chrome = {
      storage: {
        session: { set: () => Promise.resolve(), get: () => Promise.resolve({}) },
        local: {
          get: (keys, cb) => {
            const res = {};
            const arr = Array.isArray(keys) ? keys : [keys];
            arr.forEach(k => { if (storageData[k] !== undefined) res[k] = storageData[k]; });
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
      alarms: { create: () => {}, get: (_n, cb) => cb && cb(null), onAlarm: { addListener: () => {} }, clear: () => {} },
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
        id: "test-ext-id",
        onMessage: {
          addListener: (fn) => { globalThis.messageListener = fn; }
        }
      }
    };
    ${substituted}
    globalThis.testSetProxyState = (st) => { Object.assign(currentProxyState, st); };
    globalThis.testGetCurrentProxyState = () => currentProxyState;
  `;

  const ctx: any = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    Date,
    URL,
    fetch: async (url: string, opts: any) => {
      if (url.includes("/api/sync")) {
        capturedBody = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({
            activeProxyId: capturedBody.selectedProxyId,
            availableProxies: [{ id: capturedBody.selectedProxyId, name: "Node X" }],
            allowUserProxySwitch: true,
            config: { host: "1.2.3.4", port: 1080, protocol: "socks5" },
            creds: { user: "u", pass: "p" },
          }),
        };
      }
      return { ok: false };
    },
    AbortSignal,
    Map,
    parseInt,
    storageData,
    messageListener: null,
  });

  vm.runInContext(vmScript, ctx);

  // 1. Success switch
  let switchResp: any = null;
  await new Promise<void>((resolve) => {
    ctx.messageListener({ action: "SET_ACTIVE_PROXY", proxyId: "node-stockholm" }, {}, (res: any) => {
      switchResp = res;
      resolve();
    });
  });

  assert.strictEqual(switchResp?.ok, true);
  assert.strictEqual(switchResp?.activeProxyId, "node-stockholm");
  assert.strictEqual(storageData.pecActiveProxyId, "node-stockholm");
  assert.strictEqual(capturedBody?.selectedProxyId, "node-stockholm");

  // 2. Reject when allowUserProxySwitch is false
  ctx.testSetProxyState({ allowUserProxySwitch: false });
  let rejectResp: any = null;
  await new Promise<void>((resolve) => {
    ctx.messageListener({ action: "SET_ACTIVE_PROXY", proxyId: "node-forbidden" }, {}, (res: any) => {
      rejectResp = res;
      resolve();
    });
  });

  assert.strictEqual(rejectResp?.ok, false);
  assert.ok(rejectResp?.error?.includes("disabled"));
});
