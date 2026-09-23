import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import { RoutingProfile, RoutingRule } from "../src/types.js";
import { getAllProfiles, saveProfile, resolveProfileForInstance, generatePacScript, GEO_PRESETS, deleteProfile } from "../src/routing.js";
import { getProxyConfig } from "../src/instances.js";

const PROXY_CFG = getProxyConfig();

function makeProfile(overrides: Partial<RoutingProfile> & { rules: RoutingRule[] }): RoutingProfile {
  return {
    id: "prof_test_" + Math.random().toString(36).slice(2, 8),
    name: "Test Profile",
    description: "test",
    defaultPolicy: "direct",
    targetScope: "all",
    isDefault: false,
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as RoutingProfile;
}

test("PAC: rule names cannot break out of comments (injection regression)", () => {
  const profile = makeProfile({
    name: "Injection Test",
    defaultPolicy: "direct",
    rules: [
      {
        id: "r1",
        name: 'x\nreturn "PROXY evil.example:8080"; //',
        targetType: "domain",
        pattern: "example.com",
        action: "proxy",
        enabled: true,
      },
      {
        id: "r2",
        name: '"); escape attempt "quotes"',
        targetType: "domain",
        pattern: "second.com",
        action: "direct",
        enabled: true,
      },
    ],
  });

  const pac = generatePacScript(profile, PROXY_CFG);
  // The injected directive must be dead code: it may only survive as inert
  // comment text - never on an executable line of the generated script.
  const executableLines = pac.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(executableLines, /evil\.example/, "injected directive must not survive as executable PAC code");
  assert.doesNotMatch(executableLines, /return "PROXY evil/);
  // The sanitized name stays a single-line comment
  assert.match(pac, /\/\/ Rule: x /);
  assert.match(pac, /example\.com/);
});

test("PAC: block sinkhole is terminal (no silent DIRECT fallback)", () => {
  const profile = makeProfile({
    name: "Block Test",
    defaultPolicy: "direct",
    rules: [
      {
        id: "r1",
        name: "Block Trackers",
        targetType: "preset",
        pattern: "preset:ad_telemetry_block",
        action: "block",
        enabled: true,
      },
    ],
  });
  const pac = generatePacScript(profile, PROXY_CFG);
  assert.match(pac, /return "PROXY 127\.0\.0\.1:0";/);
  assert.doesNotMatch(pac, /PROXY 127\.0\.0\.1:0; DIRECT/, "blocked domains must not fall back to DIRECT");
});

test("PAC: proxy host sanitization still holds", () => {
  const maliciousConfig = {
    ...PROXY_CFG,
    enabled: true,
    protocol: "http" as const,
    host: 'proxy.internal"; return "INJECTED"; //',
  };
  const pac = generatePacScript(makeProfile({ name: "N", defaultPolicy: "proxy", rules: [] }), maliciousConfig);
  assert.doesNotMatch(pac, /return "INJECTED"/);
});

test("PAC: kill switch and presets generate expected directives", () => {
  assert.ok(GEO_PRESETS.length >= 4);
  const splitProfile = saveProfile({
    name: "Test Split Tunnel",
    defaultPolicy: "direct",
    rules: [
      { id: "r1", name: "AI to Proxy", targetType: "preset", pattern: "preset:ai_services", action: "proxy", enabled: true },
      { id: "r2", name: "Sinkhole", targetType: "preset", pattern: "preset:ad_telemetry_block", action: "block", enabled: true },
    ],
  });

  const pac = generatePacScript(splitProfile, PROXY_CFG);
  assert.match(pac, /function FindProxyForURL/);
  assert.match(pac, /openai\.com/);
  assert.match(pac, /doubleclick\.net/);
  assert.match(pac, /return "DIRECT";/); // default policy direct

  const killPac = generatePacScript(splitProfile, { ...PROXY_CFG, killSwitch: true });
  assert.match(killPac, /Kill-Switch Active/);

  // CIDR rules expand to isInNet checks
  const cidrProfile = saveProfile({
    name: "CIDR Test",
    defaultPolicy: "direct",
    rules: [{ id: "c1", name: "Corp nets", targetType: "domain", pattern: "10.0.0.0/8", action: "direct", enabled: true }],
  });
  const cidrPac = generatePacScript(cidrProfile, PROXY_CFG);
  assert.match(cidrPac, /isInNet\(host, "10\.0\.0\.0", "255\.0\.0\.0"\)/);
});

test("routing: profile resolution honours group scope and instance assignment", () => {
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

  // default profile resolves when nothing matches
  const fallback = resolveProfileForInstance("inst_nobody", "NO-SUCH-GROUP");
  assert.strictEqual(fallback.isDefault, true);

  // default profile cannot be deleted
  assert.throws(() => deleteProfile(fallback.id), /default/i);
});
