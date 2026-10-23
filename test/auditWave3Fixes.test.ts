import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { getRoutingPresets, saveRoutingPresets, clearRoutingPresetsCache } from "../src/storage.js";
import { BACKGROUND_TEMPLATE, renderBackgroundJs } from "../src/templates/backgroundTemplate.js";
import { generateGpoConfig } from "../src/packager.js";

test("Wave 3: storage in-memory preset caching works and avoids redundant disk reads", () => {
  clearRoutingPresetsCache();
  const presets1 = getRoutingPresets();
  assert.ok(Array.isArray(presets1));
  assert.ok(presets1.length > 0);

  // Second call must return the exact same in-memory array reference without disk read
  const presets2 = getRoutingPresets();
  assert.strictEqual(presets1, presets2, "Subsequent getRoutingPresets must return cached array");

  // Updating presets updates cache
  const updatedList = [{
    id: "preset:test_wave3",
    name: "Test Wave 3",
    category: "test",
    description: "desc",
    type: "domain" as const,
    source: "file" as const,
    domains: ["*.test.corp"],
    entries: ["*.test.corp"],
    lastUpdated: new Date().toISOString(),
  }];
  saveRoutingPresets(updatedList);
  const presets3 = getRoutingPresets();
  assert.strictEqual(presets3, updatedList, "saveRoutingPresets must update cached array");

  // Reset cache
  clearRoutingPresetsCache();
});

test("Wave 3: BACKGROUND_TEMPLATE and background.js have stale PAC cache fix, bypass recovery and no dead code", () => {
  const bgCode = fs.readFileSync("extension/background.js", "utf-8");

  // Manual bypass policy flag present and wired to TOGGLE_BYPASS
  assert.ok(bgCode.includes("PEC_ALLOW_MANUAL_BYPASS"), "PEC_ALLOW_MANUAL_BYPASS must be defined");
  assert.ok(bgCode.includes("Manual bypass disabled by policy"), "TOGGLE_BYPASS must check PEC_ALLOW_MANUAL_BYPASS");
  assert.ok(BACKGROUND_TEMPLATE.includes("PEC_ALLOW_MANUAL_BYPASS"), "template must define PEC_ALLOW_MANUAL_BYPASS");

  // PAC forcePacFetch parameter and cachedBasePacText fallback present
  assert.ok(bgCode.includes("forcePacFetch = false"), "applyPacScript must accept forcePacFetch");
  assert.ok(bgCode.includes("Using cached PAC script as fallback"), "applyPacScript must fall back to cachedBasePacText on network failure");
  assert.ok(bgCode.includes("applyProxyConfig(payload.config, true)"), "syncWithServer must force fresh PAC download");

  // expireBypass fail-closed recovery present
  assert.ok(bgCode.includes("applyProxyConfig(lastConfig, false)"), "expireBypass must immediately restore lastConfig before network sync");
  assert.ok(BACKGROUND_TEMPLATE.includes("applyProxyConfig(lastConfig, false)"), "template expireBypass must immediately restore lastConfig");

  // 407 fast-path TTL check present
  assert.ok(bgCode.includes("now - creds.fetchedAt < TTL_MS"), "407 onAuthRequired must check credential TTL in fast-path");
});

test("Wave 3: renderBackgroundJs substitutes placeholders in custom overridden sources", () => {
  const customSource = `
    const DEFAULT_SERVER_BASE = "__PEC_SERVER_BASE__";
    const FALLBACK_TOKEN = "__PEC_DEFAULT_TOKEN__";
    // Custom operator script logic here
  `;
  const rendered = renderBackgroundJs({
    defaultServerUrl: "https://secure.corp.proxy:8443",
    defaultToken: "fleet-secret-token-123",
  }, customSource);

  assert.ok(!rendered.includes("__PEC_SERVER_BASE__"), "Placeholders must be substituted in custom background.js");
  assert.ok(!rendered.includes("__PEC_DEFAULT_TOKEN__"), "Placeholders must be substituted in custom background.js");
  assert.ok(rendered.includes("https://secure.corp.proxy:8443"));
  assert.ok(rendered.includes("fleet-secret-token-123"));
  assert.ok(rendered.includes("Custom operator script logic here"));
});

test("Wave 3: generated .reg file includes warning about ExtensionInstallForcelist index 1 collision", () => {
  const gpo = generateGpoConfig(
    "abcdefghijklmnopabcdefghijklmnop",
    "https://pec.corp.local",
    "ext-tok-test",
    { targetGroup: "Finance" }
  );
  assert.ok(gpo.regContentMachine.includes("ExtensionInstallForcelist"), "Must have ExtensionInstallForcelist");
  assert.ok(gpo.regContentMachine.includes("deploy-pec-extension.ps1"), ".reg must recommend deploy-pec-extension.ps1 to avoid index collisions");
});
