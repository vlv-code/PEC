import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { renderDashboardHtml } from "../src/views/dashboardView.js";

test("Task 1: dashboard view and i18n use Флот / Fleet terminology", () => {
  const html = renderDashboardHtml();
  assert.ok(html.includes("Флот"), "dashboard HTML must contain 'Флот'");
  assert.ok(html.includes("tab-instances") || html.includes("tab-fleet"), "must contain fleet tab navigation");

  const js = fs.readFileSync(path.resolve("public/dashboard.js"), "utf8");
  assert.ok(js.includes("Флот") || js.includes("Fleet"), "dashboard.js i18n must reference Fleet");
});

test("Task 1: ExtensionInstance and ExtensionBuildConfig support multi-proxy fields", () => {
  const typesSrc = fs.readFileSync(path.resolve("src/types.ts"), "utf8");
  assert.ok(typesSrc.includes("assignedProxyId?: string"), "ExtensionInstance must include assignedProxyId");
  assert.ok(typesSrc.includes("appliedProxyName?: string"), "ExtensionInstance must include appliedProxyName");
  assert.ok(typesSrc.includes("allowUserProxySwitch?: boolean"), "ExtensionBuildConfig must include allowUserProxySwitch");
  assert.ok(typesSrc.includes("defaultProxyId?: string"), "ExtensionBuildConfig must include defaultProxyId");
});
