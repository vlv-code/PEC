import test from "node:test";
import assert from "node:assert/strict";
import { generatePacScript } from "../src/routing.js";
import { RoutingProfile, ProxyConfiguration } from "../src/types.js";

const baseProxyConfig: ProxyConfiguration = {
  enabled: true,
  host: "proxy.internal",
  port: 8080,
  protocol: "http",
  bypassList: [],
  pacScript: "",
  pacUrl: "",
  syncIntervalMs: 60000,
  killSwitch: false,
  updatedAt: new Date().toISOString(),
};

test("generatePacScript appends '; DIRECT' when failClosed is false and defaultPolicy is direct", () => {
  const profile: RoutingProfile = {
    id: "prof_open",
    name: "Open Profile",
    description: "Fail open",
    defaultPolicy: "direct",
    failClosed: false,
    rules: [
      { id: "r1", name: "AI Rule", targetType: "domain", pattern: "openai.com", action: "proxy", enabled: true },
    ],
    targetScope: "all",
    updatedAt: new Date().toISOString(),
  };

  const pac = generatePacScript(profile, baseProxyConfig);
  assert.ok(pac.includes('return "PROXY proxy.internal:8080; DIRECT";'), "Must include '; DIRECT' when failClosed is false and defaultPolicy is direct");
});

test("generatePacScript omits '; DIRECT' when failClosed is true (M-12)", () => {
  const profile: RoutingProfile = {
    id: "prof_fail_closed",
    name: "Fail Closed Profile",
    description: "Strict fail closed",
    defaultPolicy: "direct",
    failClosed: true,
    rules: [
      { id: "r1", name: "AI Rule", targetType: "domain", pattern: "openai.com", action: "proxy", enabled: true },
    ],
    targetScope: "all",
    updatedAt: new Date().toISOString(),
  };

  const pac = generatePacScript(profile, baseProxyConfig);
  assert.ok(pac.includes('return "PROXY proxy.internal:8080";'), "Must return 'PROXY host:port' without '; DIRECT'");
  assert.ok(!pac.includes("; DIRECT"), "Must not contain '; DIRECT' fallback anywhere in failClosed mode");
});

test("generatePacScript omits '; DIRECT' when defaultPolicy is 'proxy' even if failClosed is not explicitly set (M-12)", () => {
  const profile: RoutingProfile = {
    id: "prof_default_proxy",
    name: "Default Proxy Profile",
    description: "Tunnel all",
    defaultPolicy: "proxy",
    rules: [
      { id: "r1", name: "Intranet Rule", targetType: "domain", pattern: "corp.local", action: "direct", enabled: true },
    ],
    targetScope: "all",
    updatedAt: new Date().toISOString(),
  };

  const pac = generatePacScript(profile, baseProxyConfig);
  assert.ok(pac.includes('return "PROXY proxy.internal:8080";'), "Default directive must be 'PROXY host:port' without '; DIRECT'");
  assert.ok(!pac.includes("; DIRECT"), "Must not contain '; DIRECT' fallback when defaultPolicy is proxy");
});

test("generatePacScript handles socks5 and https protocols without '; DIRECT' when failClosed is true", () => {
  const profile: RoutingProfile = {
    id: "prof_socks",
    name: "SOCKS Profile",
    description: "Socks tunnel",
    defaultPolicy: "proxy",
    failClosed: true,
    rules: [],
    targetScope: "all",
    updatedAt: new Date().toISOString(),
  };

  const socksConfig: ProxyConfiguration = { ...baseProxyConfig, protocol: "socks5", port: 1080 };
  const socksPac = generatePacScript(profile, socksConfig);
  assert.ok(socksPac.includes('return "SOCKS5 proxy.internal:1080";'), "SOCKS5 directive must omit '; DIRECT'");
  assert.ok(!socksPac.includes("; DIRECT"), "SOCKS5 pac must not contain '; DIRECT'");

  const httpsConfig: ProxyConfiguration = { ...baseProxyConfig, protocol: "https", port: 8443 };
  const httpsPac = generatePacScript(profile, httpsConfig);
  assert.ok(httpsPac.includes('return "HTTPS proxy.internal:8443";'), "HTTPS directive must omit '; DIRECT'");
  assert.ok(!httpsPac.includes("; DIRECT"), "HTTPS pac must not contain '; DIRECT'");
});

test("generatePacScript retains '; DIRECT' when failClosed is explicitly false even if defaultPolicy is 'proxy'", () => {
  const profile: RoutingProfile = {
    id: "prof_explicit_open",
    name: "Explicit Open Profile",
    description: "Explicit open with default proxy",
    defaultPolicy: "proxy",
    failClosed: false,
    rules: [
      { id: "r1", name: "Intranet Rule", targetType: "domain", pattern: "corp.local", action: "direct", enabled: true },
    ],
    targetScope: "all",
    updatedAt: new Date().toISOString(),
  };

  const pac = generatePacScript(profile, baseProxyConfig);
  assert.ok(pac.includes('return "PROXY proxy.internal:8080; DIRECT";'), "Explicit failClosed: false must retain '; DIRECT'");
});

test("saveProfile preserves failClosed property when creating a new profile", async () => {
  const { saveProfile } = await import("../src/routing.js");
  const saved = saveProfile({
    name: "New Fail-Closed Profile",
    failClosed: true,
    defaultPolicy: "proxy",
  });
  assert.strictEqual(saved.failClosed, true, "Newly created profile must preserve failClosed: true");
});

