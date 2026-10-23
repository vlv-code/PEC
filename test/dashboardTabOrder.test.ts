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
