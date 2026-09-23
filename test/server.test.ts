import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { atomicWriteCreds } from "../src/rotate.js";
import { registerHeartbeat, getActiveInstances, updateProxyConfig, getProxyConfig, assignInstanceProfile } from "../src/instances.js";
import {
  ensureKeyExists,
  getPublicKeySpkiDer,
  calculateExtensionId,
  buildUpdatesXml,
  packageExtension,
  getBuildConfig,
  saveBuildConfig,
  getExtensionSourceFiles,
} from "../src/packager.js";
import {
  getAllProfiles,
  saveProfile,
  resolveProfileForInstance,
  generatePacScript,
  GEO_PRESETS,
} from "../src/routing.js";

test("timing safe comparison check", () => {
  const token = "test-secret-token";
  const bufA = Buffer.from(token);
  const bufB = Buffer.from(token);
  const bufC = Buffer.from("wrong-token-abc");

  assert.strictEqual(crypto.timingSafeEqual(bufA, bufB), true);
  assert.strictEqual(bufA.length === bufC.length && crypto.timingSafeEqual(bufA, bufC), false);
});

test("atomic write safety creates valid file and replaces cleanly", () => {
  const testDir = path.join(process.cwd(), ".test-tmp");
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  const testFile = path.join(testDir, "test_creds.json");

  atomicWriteCreds(testFile, {
    user: "test-user",
    pass: "test-secret-pass",
  });

  assert.strictEqual(fs.existsSync(testFile), true);
  const readBack = JSON.parse(fs.readFileSync(testFile, "utf-8"));
  assert.strictEqual(readBack.user, "test-user");
  assert.strictEqual(readBack.pass, "test-secret-pass");

  fs.rmSync(testDir, { recursive: true, force: true });
});

test("extension packaging derives deterministic 32-character Chrome extension ID", () => {
  const key = ensureKeyExists();
  const spkiDer = getPublicKeySpkiDer(key);
  const extensionId = calculateExtensionId(spkiDer);

  assert.strictEqual(typeof extensionId, "string");
  assert.strictEqual(extensionId.length, 32);
  assert.match(extensionId, /^[a-p]{32}$/);
});

test("buildUpdatesXml outputs valid Google update manifest", () => {
  const xml = buildUpdatesXml("abcdefghijklmnopabcdefghijklmnop", "1.1.0", "https://server.local/extension.crx");
  assert.match(xml, /<app appid='abcdefghijklmnopabcdefghijklmnop'>/);
  assert.match(xml, /version='1.1.0'/);
  assert.match(xml, /codebase='https:\/\/server.local\/extension.crx'/);
});

test("extension packaging produces crx and zip files", () => {
  const info = packageExtension("http://localhost:3000");
  assert.strictEqual(info.crxExists, true);
  assert.strictEqual(info.zipExists, true);
  assert.strictEqual(info.updatesXmlExists, true);
  assert.match(info.extensionId, /^[a-p]{32}$/);
});

test("instances management registers heartbeats and tracks sync counts", () => {
  const inst1 = registerHeartbeat({
    instanceId: "inst_test_123",
    ip: "192.168.1.50",
    version: "1.1.0",
    activeProxyMode: "socks5",
  });

  assert.strictEqual(inst1.instanceId, "inst_test_123");
  assert.strictEqual(inst1.syncCount, 1);
  assert.strictEqual(inst1.status, "ONLINE");

  // Sync second time
  const inst2 = registerHeartbeat({
    instanceId: "inst_test_123",
    ip: "192.168.1.50",
    version: "1.1.0",
  });
  assert.strictEqual(inst2.syncCount, 2);

  const active = getActiveInstances();
  const found = active.find((i) => i.instanceId === "inst_test_123");
  assert.ok(found);
  assert.strictEqual(found.syncCount, 2);
});

test("dynamic proxy configuration updates cleanly", () => {
  updateProxyConfig({
    protocol: "socks5",
    host: "xray.internal",
    port: 10808,
  });

  const cfg = getProxyConfig();
  assert.strictEqual(cfg.protocol, "socks5");
  assert.strictEqual(cfg.host, "xray.internal");
  assert.strictEqual(cfg.port, 10808);
});

test("routing profiles support default direct vs proxy, geo presets, and pac generation", () => {
  assert.ok(GEO_PRESETS.length >= 4);

  const customProfile = saveProfile({
    name: "Test Split Tunnel",
    defaultPolicy: "direct",
    rules: [
      {
        id: "r1",
        name: "Route AI to Proxy",
        targetType: "preset",
        pattern: "preset:ai_services",
        action: "proxy",
        enabled: true,
      },
      {
        id: "r2",
        name: "Sinkhole Trackers",
        targetType: "preset",
        pattern: "preset:ad_telemetry_block",
        action: "block",
        enabled: true,
      },
    ],
  });

  assert.strictEqual(customProfile.defaultPolicy, "direct");
  assert.strictEqual(customProfile.rules.length, 2);

  const proxyCfg = getProxyConfig();
  const pac = generatePacScript(customProfile, proxyCfg);

  assert.match(pac, /function FindProxyForURL/);
  assert.match(pac, /openai\.com/);
  assert.match(pac, /doubleclick\.net/);
  // Default policy is direct:
  assert.match(pac, /return "DIRECT";/);
  // Block action sinkhole:
  assert.match(pac, /127\.0.0\.1:0/);
});

test("instance profile and group targeting resolves accurately", () => {
  const vipProfile = saveProfile({
    id: "prof_vip_test",
    name: "VIP Direct Preset",
    defaultPolicy: "direct",
    targetScope: "group",
    targetGroup: "SEC-VIP-GROUP",
    rules: [],
  });

  const resolved = resolveProfileForInstance("inst_vip_user", "SEC-VIP-GROUP");
  assert.strictEqual(resolved.id, vipProfile.id);

  // Explicit instance profile assignment
  assignInstanceProfile("inst_vip_user", "prof_vip_test", "CustomGroup");
  const inst = registerHeartbeat({
    instanceId: "inst_vip_user",
    ip: "10.10.10.10",
    version: "1.2.0",
  });

  assert.strictEqual(inst.assignedProfileId, "prof_vip_test");
  assert.strictEqual(inst.appliedProfileName, "VIP Direct Preset");
});

test("extension constructor studio manages config and source inspection", () => {
  const orig = getBuildConfig();
  saveBuildConfig({
    name: "Test Custom Brand",
    uiMode: "popup",
    themeColor: "#10b981",
  });

  const updated = getBuildConfig();
  assert.strictEqual(updated.name, "Test Custom Brand");
  assert.strictEqual(updated.themeColor, "#10b981");

  const files = getExtensionSourceFiles();
  assert.ok(files["manifest.json"]);
  assert.ok(files["background.js"]);

  // Restore
  saveBuildConfig(orig);
});

test("security: SSRF validation blocks dangerous cloud metadata and non-http schemes", async () => {
  const { validateSafeEndpointUrl } = await import("../src/rotate.js");

  // Disallow metadata endpoints
  const check1 = validateSafeEndpointUrl("http://169.254.169.254/latest/meta-data");
  assert.strictEqual(check1.valid, false);
  assert.match(check1.error || "", /cloud metadata/i);

  const check2 = validateSafeEndpointUrl("http://metadata.google.internal/computeMetadata/v1");
  assert.strictEqual(check2.valid, false);

  // Disallow non-HTTP schemes
  const check3 = validateSafeEndpointUrl("file:///etc/passwd");
  assert.strictEqual(check3.valid, false);

  // Allow legitimate HTTP / HTTPS
  const check4 = validateSafeEndpointUrl("https://my-3xui-panel.corp:2053/subpath");
  assert.strictEqual(check4.valid, true);
});

test("security: PAC generation sanitizes host and prevents code injection", () => {
  const customProfile = {
    id: "prof_sec_test",
    name: "Injection Test\nLine2",
    defaultPolicy: "proxy" as const,
    rules: [],
  };

  const maliciousConfig = {
    enabled: true,
    protocol: "http" as const,
    host: 'proxy.internal"; return "INJECTED"; //',
    port: 10809,
    bypassList: [],
    pacScript: "",
    pacUrl: "/proxy.pac",
    syncIntervalMs: 300000,
    killSwitch: false,
    updatedAt: new Date().toISOString(),
  };

  const pac = generatePacScript(customProfile, maliciousConfig);
  // Host must have had quotes, semicolons, whitespace stripped
  assert.doesNotMatch(pac, /return "INJECTED"/);
  assert.match(pac, /proxy\.internalreturnINJECTED:10809/);
});

test("security: updateProxyConfig rejects invalid host characters and out-of-range ports", () => {
  assert.throws(() => {
    updateProxyConfig({ host: "bad host name with spaces" });
  }, /invalid host format/i);

  assert.throws(() => {
    updateProxyConfig({ port: 99999 });
  }, /invalid port number/i);
});

