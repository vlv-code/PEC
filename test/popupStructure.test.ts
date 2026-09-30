import test from "node:test";
import assert from "node:assert/strict";
import { renderPopupHtml } from "../src/extensionTemplates.js";
import fs from "node:fs";

test("popup HTML has 380px width, 3 tabs, 3-button controls, user overrides, and theme toggle", () => {
  const html = renderPopupHtml({
    name: "PEC Corp Proxy",
    shortName: "PEC",
    version: "1.4.0",
    serverUrl: "https://proxyex.ic-iskra.ru",
    token: "tok",
    colorPalette: "cyber",
    uiLayout: "console",
  } as any);

  assert.ok(html.includes("380px"), "Width must be 380px");
  assert.ok(html.includes('id="btnThemeToggle"'), "Day/Night theme toggle must exist in header");
  assert.ok(html.includes('id="tab-btn-conn"'), "Connection tab button must exist");
  assert.ok(html.includes('id="tab-btn-routing"'), "Routing tab button must exist");
  assert.ok(html.includes('id="tab-btn-diag"'), "Diagnostics/Info tab button must exist");
  assert.ok(html.includes("📊 Инфо"), "Tab 3 must be renamed to 📊 Инфо");
  assert.ok(html.includes("grid-template-columns: repeat(3, 1fr);"), ".tabs must use repeat(3, 1fr) grid");
  assert.ok(html.includes("padding: 12px 14px;"), ".card padding must be standardized to 12px 14px");

  // 3-button controls on connection tab
  assert.ok(html.includes('id="btnSyncNow"'), "Sync button must exist");
  assert.ok(html.includes('id="btnPowerToggle"'), "Power toggle button must exist");
  assert.ok(html.includes('id="btnPauseToggle"'), "Pause toggle button must exist");

  // User overrides in routing tab
  assert.ok(html.includes('id="btnAddCurrentSite"'), "Add current site button must exist");
  assert.ok(html.includes('id="inputPattern"'), "Rule pattern input must exist");
  assert.ok(html.includes('id="selectAction"'), "Rule action select must exist");
  assert.ok(html.includes('id="btnAddRule"'), "Add rule button must exist");
  assert.ok(html.includes('id="userRulesList"'), "User rules container must exist");

  // Combined info & diagnostics
  assert.ok(html.includes('id="btnCheckIp"'), "Check IP button must exist");
  assert.ok(html.includes('id="btnTestLatency"'), "Test latency button must exist");
  assert.ok(html.includes('id="logContainer"'), "Log container must exist");
  assert.ok(html.includes('id="btnCopyLogs"'), "Copy logs button must exist");
  assert.ok(html.includes('id="btnClearLogs"'), "Clear logs button must exist");

  // Check no inline onclick handlers (MV3 CSP)
  assert.ok(!html.includes("onclick="), "No inline onclick handlers allowed");
});

test("extension/popup.html matches modern structure", () => {
  const rawHtml = fs.readFileSync("extension/popup.html", "utf8");
  assert.ok(rawHtml.includes("380px"));
  assert.ok(rawHtml.includes('id="btnThemeToggle"'));
  assert.ok(rawHtml.includes('id="btnSyncNow"'));
  assert.ok(rawHtml.includes('id="btnPowerToggle"'));
  assert.ok(rawHtml.includes('id="btnPauseToggle"'));
  assert.ok(rawHtml.includes('id="btnAddCurrentSite"'));
  assert.ok(rawHtml.includes("📊 Инфо"), "extension/popup.html must have tab 3 renamed to 📊 Инфо");
  assert.ok(rawHtml.includes("grid-template-columns: repeat(3, 1fr);"), "extension/popup.html .tabs must use grid");
  assert.ok(rawHtml.includes("padding: 12px 14px;"), "extension/popup.html .card padding must be 12px 14px");
  assert.ok(!rawHtml.includes("onclick="));
});
