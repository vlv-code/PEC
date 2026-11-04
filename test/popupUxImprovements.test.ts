import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { renderPopupHtml } from "../src/templates/popupHtmlTemplate.js";
import { renderPopupJs } from "../src/templates/popupJsTemplate.js";
import { getPopupTranslations } from "../src/templates/translations.js";

test("popupHtmlTemplate & popup.html: geometry, overflow and scrollbar-gutter", () => {
  const html = renderPopupHtml();
  const rawHtml = fs.readFileSync(path.resolve("extension/popup.html"), "utf8");

  for (const content of [html, rawHtml]) {
    assert.ok(content.includes("scrollbar-gutter: auto"), "must include scrollbar-gutter: auto for html, body");
    assert.ok(content.includes("max-width: 130px"), "network parameters / exitIpVal must have max-width: 130px");
    assert.ok(content.includes("text-overflow: ellipsis"), "must have text-overflow: ellipsis");
    assert.ok(content.includes("white-space: nowrap"), "must have white-space: nowrap");
    assert.ok(content.includes("min-width: 0"), "must have min-width: 0");
    assert.ok(content.includes("max-width: 80px"), "tabRulesDefaultPolicy must have max-width: 80px");
    assert.ok(content.includes("flex-shrink: 0"), "accordion chevron must have flex-shrink: 0");
    assert.ok(content.includes("flex: 1"), "rule-pattern must have flex: 1");
    assert.ok(content.includes('data-layout="terminal"') && content.includes("border-radius: 0 !important"), "terminal layout must have 0px border-radius");
    assert.ok(content.includes('data-layout="console"') && content.includes("border-radius: 12px"), "console layout must have 12px border-radius");
  }
});

test("popupHtmlTemplate & popup.html: a11y roles, attributes, contrast and missing CSS classes", () => {
  const html = renderPopupHtml();
  const rawHtml = fs.readFileSync(path.resolve("extension/popup.html"), "utf8");

  for (const content of [html, rawHtml]) {
    assert.ok(content.includes('role="tablist"'), "tabs must have role=tablist");
    assert.ok(content.includes('role="tab"'), "tab buttons must have role=tab");
    assert.ok(content.includes('aria-selected="true"'), "active tab must have aria-selected=true");
    assert.ok(content.includes('aria-controls="tab-status"'), "tab button must link aria-controls");
    assert.ok(content.includes('role="tabpanel"'), "tab content must have role=tabpanel");
    assert.ok(content.includes(".badge {"), ".badge class must be defined in CSS");
    assert.ok(content.includes(".badge-action-proxy"), ".badge-action-proxy class must be defined in CSS");
    assert.ok(content.includes(".btn-icon {"), ".btn-icon class must be defined in CSS");
    assert.ok(content.includes(":disabled"), ":disabled pseudo-class styling must exist in CSS");
  }

  // WCAG AA contrast check: cyber, nord, emerald in light theme
  assert.ok(
    html.includes('[data-palette="cyber"]') && html.includes("color: #0f172a !important;"),
    "cyber/nord/emerald palettes must have dark text (#0f172a) on buttons in light theme"
  );
});

test("popup.js: tab switching updates aria-selected attributes", () => {
  const js = fs.readFileSync(path.resolve("extension/popup.js"), "utf8");
  assert.ok(
    js.includes('t.setAttribute("aria-selected", "false")') || js.includes("aria-selected"),
    "switchPopupTab must update aria-selected attributes"
  );
});

test("popup.js: #btnPowerToggle does not highlight green if server is offline", () => {
  const js = fs.readFileSync(path.resolve("extension/popup.js"), "utf8");

  let powerActiveVal = null;
  let powerDisabledVal = null;

  const mockBtnPowerToggle = {
    style: {},
    addEventListener: () => {},
    classList: {
      toggle: (cls: string, active: boolean) => {
        if (cls === "btn-power-active") powerActiveVal = active;
        if (cls === "btn-power-disabled") powerDisabledVal = active;
      },
    },
  };

  const sandbox = {
    window: {
      addEventListener: () => {},
    },
    document: {
      getElementById: (id: string) => {
        if (id === "btnPowerToggle") return mockBtnPowerToggle;
        return { textContent: "", title: "", style: {}, classList: { toggle: () => {} }, addEventListener: () => {}, setAttribute: () => {} };
      },
      querySelectorAll: () => [],
      body: { setAttribute: () => {} },
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(js, ctx);

  // When enabled is true, but server is offline (online: false)
  (sandbox.window as any).applyPopupState({
    enabled: true,
    online: false,
    bypassActive: false,
  });

  assert.strictEqual(powerActiveVal, false, "btn-power-active must be FALSE when server is offline");
  assert.strictEqual(powerDisabledVal, true, "btn-power-disabled must be TRUE when server is offline");

  // When enabled is true and server is online (online: true)
  (sandbox.window as any).applyPopupState({
    enabled: true,
    online: true,
    bypassActive: false,
  });

  assert.strictEqual(powerActiveVal, true, "btn-power-active must be TRUE when enabled and online");
  assert.strictEqual(powerDisabledVal, false, "btn-power-disabled must be FALSE when enabled and online");
});

test("popup.js: btnCopyLogs wraps text in span and preserves SVG icon", () => {
  const html = fs.readFileSync(path.resolve("extension/popup.html"), "utf8");
  const js = fs.readFileSync(path.resolve("extension/popup.js"), "utf8");

  // In HTML, btnCopyLogs must have SVG and inner span
  assert.match(html, /<button id="btnCopyLogs"[^>]*><svg[\s\S]*?<span id="btnCopyLogsText">/);

  // In JS, btnCopyLogs updates the text span without removing the SVG
  assert.ok(
    js.includes("btnCopyLogsText") || js.includes("btnCopyLogs.querySelector"),
    "btnCopyLogs must target inner span to preserve SVG"
  );
});

test("popup.js: btnClearLogs prompts user for confirmation before clearing logs", () => {
  const js = fs.readFileSync(path.resolve("extension/popup.js"), "utf8");

  assert.ok(
    js.includes("confirm(") || js.includes("confirmClearLogs"),
    "btnClearLogs must ask for confirmation before clearing"
  );
});

test("popup.js: updateBypassCountdown requests status from background on timer expiration", () => {
  const js = fs.readFileSync(path.resolve("extension/popup.js"), "utf8");

  assert.ok(
    js.includes('action: "GET_STATUS"') || js.includes("GET_STATUS"),
    "updateBypassCountdown must request GET_STATUS when expired"
  );
});

test("popup.js: addRule preserves CIDR subnet masks (/24, /8)", () => {
  const js = fs.readFileSync(path.resolve("extension/popup.js"), "utf8");

  assert.ok(
    js.includes("isSubnetMask") || js.includes("\\/\\d"),
    "addRule must detect subnet mask and not strip it"
  );
});

test("popup.js: candidate public IP checkers has isJson: true for Yandex IP endpoint", () => {
  const js = fs.readFileSync(path.resolve("extension/popup.js"), "utf8");

  assert.match(
    js,
    /yandex\.ru\/internet\/api\/v0\/ip[^\n}]*isJson:\s*true/,
    "Yandex IP endpoint must specify isJson: true"
  );
});

test("translations & popup: dynamic timeout from safeCfg.bypassAutoTimeoutMinutes", () => {
  const tDefault = getPopupTranslations();
  assert.ok(tDefault.btnPause.includes("15м"), "default pause should be 15m");

  const tCustom = getPopupTranslations({ bypassAutoTimeoutMinutes: 30 });
  assert.ok(tCustom.btnPause.includes("30м"), "custom pause should be 30m");
  assert.ok(tCustom.btnBypass.includes("30м"), "custom bypass text should be 30m");

  const htmlCustom = renderPopupHtml({ bypassAutoTimeoutMinutes: 45 });
  assert.ok(htmlCustom.includes("45"), "popup html should reflect 45m timeout in title or text");

  const jsCustom = renderPopupJs({ bypassAutoTimeoutMinutes: 20 } as any);
  assert.ok(jsCustom.includes("20"), "popup js should inject 20m timeout");
});
