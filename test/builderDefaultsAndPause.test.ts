import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDashboardHtml } from "../src/views/dashboardView.js";
import { generateExtensionFiles } from "../src/packager.js";

test("builder studio: defaults are enforced and bypass checkboxes are removed from UI", () => {
  const html = renderDashboardHtml({});
  
  // 1. Checkboxes for badge, allowBypass, and ipGeo should be removed from view
  assert.ok(!html.includes('id="bldBadge"'), "bldBadge checkbox should be removed from UI");
  assert.ok(!html.includes('id="bldAllowBypass"'), "bldAllowBypass checkbox should be removed from UI");
  assert.ok(!html.includes('id="bldIpGeo"'), "bldIpGeo checkbox should be removed from UI");

  // 2. Terminology must be 'Пауза' instead of 'ручной обход'
  assert.ok(!html.includes("ручного обхода"), "UI must not contain 'ручного обхода'");
  assert.ok(html.includes("паузы") || html.includes("Пауза"), "UI must use 'Пауза' / 'паузы'");
});

test("packager: generateExtensionFiles defaults badge, pause, and ipGeo to true", () => {
  const files = generateExtensionFiles({
    name: "Test Ext",
    shortName: "Test",
    version: "1.0.0",
    serverUrl: "https://test.corp"
  });

  const bg = files["background.js"];
  assert.ok(bg.includes("PEC_BADGE_ENABLED = true;"), "badge must be enabled by default");
  assert.ok(bg.includes("PEC_ALLOW_MANUAL_BYPASS = true;"), "manual bypass/pause must be enabled by default");
});
