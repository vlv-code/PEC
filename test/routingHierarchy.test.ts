import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generatePacScript } from "../src/routing.js";
import { RoutingProfile, ProxyConfiguration } from "../src/types.js";

test("generatePacScript evaluates rules in exact array order (top-to-bottom hierarchy)", () => {
  const profile: RoutingProfile = {
    id: "test_hierarchy",
    name: "Hierarchy Test",
    description: "Testing rule priority order",
    defaultPolicy: "direct",
    isDefault: false,
    rules: [
      { id: "rule1", name: "Block rule", targetType: "wildcard", pattern: "special.corp", action: "block", enabled: true },
      { id: "rule2", name: "Proxy rule", targetType: "wildcard", pattern: "*.corp", action: "proxy", enabled: true },
    ],
    targetScope: "all",
    updatedAt: new Date().toISOString(),
  };
  const proxyConfig: ProxyConfiguration = {
    enabled: true,
    host: "proxy.corp",
    port: 10809,
    protocol: "http",
    bypassList: [],
    pacScript: "",
    pacUrl: "",
    syncIntervalMs: 60000,
    killSwitch: false,
    updatedAt: new Date().toISOString(),
  };

  const pacText = generatePacScript(profile, proxyConfig);
  const blockIdx = pacText.indexOf("special.corp");
  const proxyIdx = pacText.indexOf("corp");

  assert.ok(blockIdx !== -1 && proxyIdx !== -1, "Both rules must be in PAC script");
  assert.ok(blockIdx < proxyIdx, "First rule must appear before second rule in PAC script");

  // Reverse order test
  const reversedProfile: RoutingProfile = {
    ...profile,
    rules: [
      { id: "rule2", name: "Proxy rule", targetType: "wildcard", pattern: "*.corp", action: "proxy", enabled: true },
      { id: "rule1", name: "Block rule", targetType: "wildcard", pattern: "special.corp", action: "block", enabled: true },
    ],
  };
  const reversedPac = generatePacScript(reversedProfile, proxyConfig);
  const rProxyIdx = reversedPac.indexOf("corp");
  const rBlockIdx = reversedPac.indexOf("special.corp");
  assert.ok(rProxyIdx < rBlockIdx, "Reversed rules must change PAC emission order");
});

test("dashboardView includes reorder buttons, presets grid, inspector modal, and unsaved changes indicator", () => {
  const dashboardView = fs.readFileSync(path.join(process.cwd(), "src", "views", "dashboardView.ts"), "utf-8");
  assert.ok(dashboardView.includes("btn-reorder-up"), "Must include rule reorder up button");
  assert.ok(dashboardView.includes("btn-reorder-down"), "Must include rule reorder down button");
  assert.ok(dashboardView.includes("modalGeobaseInspector"), "Must include modal geobase inspector markup");
  assert.ok(dashboardView.includes("presets-grid"), "Must include responsive presets grid class");
  assert.ok(dashboardView.includes("modalImportPresets"), "Must include import presets modal markup");
  assert.ok(dashboardView.includes("unsavedChangesBadge"), "Must include unsaved changes badge");
});

test("dashboard.css includes required styles for presets grid, reorder buttons, and modals", () => {
  const dashboardCss = fs.readFileSync(path.join(process.cwd(), "public", "dashboard.css"), "utf-8");
  assert.ok(dashboardCss.includes(".presets-grid"), "Must include .presets-grid style");
  assert.ok(dashboardCss.includes(".btn-reorder-up"), "Must include .btn-reorder-up style");
  assert.ok(dashboardCss.includes(".btn-reorder-down"), "Must include .btn-reorder-down style");
  assert.ok(dashboardCss.includes(".preset-in-profile-badge"), "Must include .preset-in-profile-badge style");
  assert.ok(dashboardCss.includes(".modal-geobase-inspector"), "Must include .modal-geobase-inspector style");
  assert.ok(dashboardCss.includes(".unsaved-badge"), "Must include .unsaved-badge style");
});

test("dashboard.js implements moveRuleUp, moveRuleDown, duplicate preset badging, inspector, and unsaved tracking", () => {
  const dashboardJs = fs.readFileSync(path.join(process.cwd(), "public", "dashboard.js"), "utf-8");
  assert.ok(dashboardJs.includes("moveRuleUp"), "Must implement moveRuleUp function");
  assert.ok(dashboardJs.includes("moveRuleDown"), "Must implement moveRuleDown function");
  assert.ok(dashboardJs.includes("openGeobaseInspector"), "Must implement openGeobaseInspector function");
  assert.ok(dashboardJs.includes("openImportPresetsModal"), "Must implement openImportPresetsModal function");
  assert.ok(dashboardJs.includes("hasUnsavedRouting"), "Must track hasUnsavedRouting dirty state");
});
