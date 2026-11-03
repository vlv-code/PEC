import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDashboardHtml } from "../src/views/dashboardView.js";

test("dashboard navigation: tab-proxy-settings is placed immediately after tab-routing", () => {
  const html = renderDashboardHtml({});

  const routingBtnIdx = html.indexOf("switchTab('routing')");
  const proxySettingsBtnIdx = html.indexOf("switchTab('proxy-settings')");
  const builderBtnIdx = html.indexOf("switchTab('builder')");
  const fleetBtnIdx = html.indexOf("switchTab('instances')");

  assert.ok(routingBtnIdx !== -1, "routing tab button exists");
  assert.ok(proxySettingsBtnIdx !== -1, "proxy settings tab button exists");
  assert.ok(builderBtnIdx !== -1, "builder tab button exists");
  assert.ok(fleetBtnIdx !== -1, "fleet tab button exists");

  assert.ok(routingBtnIdx < proxySettingsBtnIdx, "routing is before proxy settings");
  assert.ok(proxySettingsBtnIdx < builderBtnIdx, "proxy settings is before builder");
  assert.ok(builderBtnIdx < fleetBtnIdx, "builder is before fleet");
});

test("dashboard header: gateway status indicator is a minimized pulsing dot without inline text", () => {
  const html = renderDashboardHtml({});

  // Indicator element check
  assert.match(
    html,
    /<span class="badge-status-dot" id="gatewayStatusIndicator" title="Шлюз активен" data-i18n-title="statusGatewayActive">\s*<span class="dot"><\/span>\s*<\/span>/,
    "must render gatewayStatusIndicator with only dot inside and tooltip attributes"
  );

  // Must not have the old id that caused setLanguage() to inject text
  assert.doesNotMatch(html, /id="lblGatewayStatus"/, "must not have id lblGatewayStatus");
});
