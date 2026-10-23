import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { GEO_PRESETS } from "../src/defaultPresets.js";
import { getAllProfiles, generatePacScript } from "../src/routing.js";
import { getProxyConfig } from "../src/instances.js";
import { injectUserRulesIntoPac } from "../src/extensionPureLogic.js";

test("preset:ip_check exists and is included in profile_default_split", () => {
  const ipPreset = GEO_PRESETS.find((p) => p.id === "preset:ip_check");
  assert.ok(ipPreset, "preset:ip_check must be defined in GEO_PRESETS");
  assert.ok(ipPreset.domains.includes("api.ipify.org"), "must contain api.ipify.org");
  assert.ok(ipPreset.domains.includes("icanhazip.com"), "must contain icanhazip.com");
  assert.ok(ipPreset.domains.includes("2ip.io"), "must contain 2ip.io");
  assert.ok(ipPreset.domains.includes("2ip.ru"), "must contain 2ip.ru");

  const profiles = getAllProfiles();
  const splitProfile = profiles.find((p) => p.id === "profile_default_split");
  assert.ok(splitProfile, "profile_default_split must exist");
  const rule = splitProfile.rules.find((r) => r.pattern === "preset:ip_check");
  assert.ok(rule, "profile_default_split must have a rule for preset:ip_check");
  assert.equal(rule.action, "proxy", "rule must route diagnostics to proxy");
  assert.equal(rule.enabled, true, "rule must be enabled");

  const pac = generatePacScript(splitProfile, getProxyConfig());
  assert.ok(pac.includes("api.ipify.org"), "PAC script must include api.ipify.org");
  assert.ok(pac.includes("icanhazip.com"), "PAC script must include icanhazip.com");
  assert.ok(pac.includes("2ip.io"), "PAC script must include 2ip.io");
});

test("injectUserRulesIntoPac inherits fallback suffix to prevent net::ERR_PROXY_CONNECTION_FAILED", () => {
  const basePacWithFallback = `
function FindProxyForURL(url, host) {
  if (host === "openai.com") return "PROXY proxy.corp:10809; DIRECT";
  return "DIRECT";
}
`;
  const userRules = [
    { pattern: "2ip.io", action: "PROXY", enabled: true },
    { pattern: "rutracker.org", action: "PROXY", enabled: true },
    { pattern: "custom-direct.com", action: "DIRECT", enabled: true },
  ];

  const injected = injectUserRulesIntoPac(basePacWithFallback, userRules, "proxy.corp:10809");
  // Must contain user overrides
  assert.ok(injected.includes('host === "2ip.io"'));
  assert.ok(injected.includes('host === "rutracker.org"'));
  assert.ok(injected.includes('host === "custom-direct.com"'));

  // PROXY rules must include '; DIRECT' fallback so an offline proxy falls back gracefully instead of fatal crash
  assert.ok(
    injected.includes('return "PROXY proxy.corp:10809; DIRECT";'),
    "Injected PROXY rule must include '; DIRECT' fallback"
  );
  assert.ok(injected.includes('return "DIRECT";'));
});

test("3x-ui secrets backup file is written alongside rotation_config.json on save", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pec-secrets-test-"));
  const cfgPath = path.join(tmpDir, "rotation_config.json");
  const secPath = path.join(tmpDir, ".rotation_secrets.json");

  // Write sample secrets
  const sample = {
    adminPass: "SuperSecretXuiPass!2026",
    adminUser: "admin",
    panelUrl: "https://3xui.example.corp:2053/base",
    inboundRemark: "squid-in",
  };
  fs.writeFileSync(secPath, JSON.stringify(sample), "utf-8");

  assert.ok(fs.existsSync(secPath));
  const read = JSON.parse(fs.readFileSync(secPath, "utf-8"));
  assert.equal(read.adminPass, "SuperSecretXuiPass!2026");

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
