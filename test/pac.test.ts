import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import express from "express";
import type { AddressInfo } from "node:net";
import { RoutingProfile, RoutingRule } from "../src/types.js";
import { getAllProfiles, saveProfile, resolveProfileForInstance, generatePacScript, GEO_PRESETS, deleteProfile } from "../src/routing.js";
import { getProxyConfig } from "../src/instances.js";
import { createProxy, setActiveProxy } from "../src/proxies.js";
import { getProxiesStorePath } from "../src/storage.js";
import { readCurrentCreds } from "../src/rotate.js";
import { createCredsRouter } from "../src/routes/credsRoutes.js";
import { TEST_TOKEN } from "./helpers/setup.js";

const PROXY_CFG = getProxyConfig();

function clearProxiesStore() {
  const storePath = getProxiesStorePath();
  if (fs.existsSync(storePath)) {
    fs.unlinkSync(storePath);
  }
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createCredsRouter(() => TEST_TOKEN));
  return app;
}

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const server = buildApp().listen(0);
  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

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

  // CIDR rules expand to isInNet checks behind an IP-literal guard: a bare
  // isInNet(host, ...) on a DNS name would force a synchronous DNS resolve
  // on every request (UI freezes when corporate DNS is slow).
  const cidrProfile = saveProfile({
    name: "CIDR Test",
    defaultPolicy: "direct",
    rules: [{ id: "c1", name: "Corp nets", targetType: "domain", pattern: "10.0.0.0/8", action: "direct", enabled: true }],
  });
  const cidrPac = generatePacScript(cidrProfile, PROXY_CFG);
  assert.match(cidrPac, /isInNet\(host, "10\.0\.0\.0", "255\.0\.0\.0"\)/);
  // the isInNet call must sit inside the IP-literal guard for the same rule
  assert.ok(
    cidrPac.includes('/^\\d{1,3}(\\.\\d{1,3}){3}$/.test(host) && (isInNet(host, "10.0.0.0", "255.0.0.0"))'),
    "CIDR checks must be wrapped in the IP-literal guard"
  );
  assert.doesNotMatch(cidrPac, /if \(\s*isInNet/, "no bare isInNet may be emitted as a top-level condition");

  // Mixed rule: domain checks stay unguarded, CIDR checks get the guard
  const mixedProfile = saveProfile({
    name: "Mixed Rule Test",
    defaultPolicy: "direct",
    rules: [{
      id: "m1", name: "Corp mixed", targetType: "domain", enabled: true,
      pattern: "*.corp.local,10.0.0.0/8",
      action: "proxy",
    }],
  });
  const mixedPac = generatePacScript(mixedProfile, PROXY_CFG);
  assert.match(mixedPac, /dnsDomainIs\(host, "corp\.local"\)/);
  // domain condition first, CIDR checks behind the IP-literal guard after it
  assert.ok(
    mixedPac.includes('/^\\d{1,3}(\\.\\d{1,3}){3}$/.test(host) && (isInNet(host, "10.0.0.0", "255.0.0.0"))'),
    "CIDR checks must be wrapped in the IP-literal guard"
  );
  assert.ok(
    mixedPac.indexOf('dnsDomainIs(host, "corp.local")') < mixedPac.indexOf('.test(host) && (isInNet'),
    "domain checks must stay unguarded and precede the guarded CIDR checks"
  );
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

test("PAC: fuzzed rule and profile names never reach executable PAC lines", () => {
  // Deterministic PRNG so a failure is always reproducible
  let seed = 0x5eed1234;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const ALPHABET = "\n\r\"'`\\;{}<>&/()=";
  const marker = (i: number) => `XQZ${i}_`;

  for (let i = 0; i < 40; i++) {
    let payload = marker(i);
    while (payload.length < 24) {
      payload += rand() < 0.55
        ? ALPHABET[Math.floor(rand() * ALPHABET.length)]
        : String.fromCharCode(97 + Math.floor(rand() * 26));
    }

    const profile = makeProfile({
      name: `prof-${payload}`,
      rules: [
        {
          id: `fz${i}`,
          name: payload,
          targetType: "domain",
          pattern: `fuzz-domain-${i}.example`,
          action: "proxy",
          enabled: true,
        },
      ],
    });

    const pac = generatePacScript(profile, PROXY_CFG);

    // The script itself must stay intact
    assert.match(pac, /function FindProxyForURL/, `payload #${i} destroyed the PAC script`);

    // Every line carrying the payload marker must be a comment - the payload
    // may only survive as inert comment text, never on an executable line.
    const lines = pac.split("\n");
    for (const line of lines) {
      if (line.includes(marker(i))) {
        assert.ok(
          line.trim().startsWith("//"),
          `payload #${i} leaked outside a comment: ${JSON.stringify(payload)}`
        );
      }
    }

    // Executable (non-comment) lines must be completely marker-free
    const executable = lines.filter((l) => !l.trim().startsWith("//")).join("\n");
    assert.ok(!executable.includes(marker(i)), `payload #${i} reached executable PAC code`);
    assert.ok(!executable.includes('return "PROXY evil'), `payload #${i} injected a proxy directive`);
  }
});

test("PAC: directives dynamically reflect active proxy node (SOCKS5 -> HTTP -> HTTPS)", () => {
  clearProxiesStore();
  const profile = makeProfile({
    name: "Full Proxy Profile",
    defaultPolicy: "proxy",
    rules: [],
  });

  // 1. Create and activate SOCKS5 proxy
  createProxy({
    tag: "node-socks",
    name: "SOCKS Node",
    protocol: "socks5",
    host: "10.0.0.50",
    port: 1080,
    isActive: true,
  });

  let pac = generatePacScript(profile, PROXY_CFG);
  assert.match(pac, /return "SOCKS5 10\.0\.0\.50:1080; DIRECT";/);

  // 2. Create and activate HTTP proxy
  const httpNode = createProxy({
    tag: "node-http",
    name: "HTTP Node",
    protocol: "http",
    host: "10.0.0.60",
    port: 8080,
    isActive: true,
  });
  setActiveProxy(httpNode.id);

  pac = generatePacScript(profile, PROXY_CFG);
  assert.match(pac, /return "PROXY 10\.0\.0\.60:8080; DIRECT";/);

  // 3. Create and activate HTTPS proxy
  const httpsNode = createProxy({
    tag: "node-https",
    name: "HTTPS Node",
    protocol: "https",
    host: "10.0.0.70",
    port: 8443,
    isActive: true,
  });
  setActiveProxy(httpsNode.id);

  pac = generatePacScript(profile, PROXY_CFG);
  assert.match(pac, /return "HTTPS 10\.0\.0\.70:8443; DIRECT";/);

  // 4. Kill-switch still forces DIRECT regardless of active proxy
  const killPac = generatePacScript(profile, { ...PROXY_CFG, killSwitch: true });
  assert.match(killPac, /Kill-Switch Active/);
  assert.match(killPac, /return "DIRECT";/);

  clearProxiesStore();
});

test("Fleet sync: /creds and readCurrentCreds return active proxy credentials", async () => {
  clearProxiesStore();
  createProxy({
    tag: "auth-proxy",
    name: "Auth Node",
    protocol: "socks5",
    host: "10.0.0.99",
    port: 1080,
    username: "active_user_abc",
    password: "active_password_xyz",
    isActive: true,
  });

  // Verify readCurrentCreds
  const creds = readCurrentCreds();
  assert.ok(creds, "creds should be readable");
  assert.strictEqual(creds?.user, "active_user_abc");
  assert.strictEqual(creds?.pass, "active_password_xyz");

  // Verify /creds endpoint
  await withServer(async (base) => {
    const res = await fetch(`${base}/creds`, {
      headers: { "x-ext-token": TEST_TOKEN },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.user, "active_user_abc");
    assert.strictEqual(body.pass, "active_password_xyz");
  });

  clearProxiesStore();
});

test("Fleet sync: /api/sync and /proxy.pac return active proxy configuration", async () => {
  clearProxiesStore();
  createProxy({
    tag: "sync-node",
    name: "Sync Node",
    protocol: "https",
    host: "10.20.30.40",
    port: 9443,
    username: "fleet_user",
    password: "fleet_password",
    isActive: true,
  });

  await withServer(async (base) => {
    // 1. /api/sync
    const syncRes = await fetch(`${base}/api/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-ext-token": TEST_TOKEN,
      },
      body: JSON.stringify({ instanceId: "inst_test_sync" }),
    });
    assert.strictEqual(syncRes.status, 200);
    const syncBody = await syncRes.json();
    assert.strictEqual(syncBody.ok, true);
    assert.strictEqual(syncBody.config.protocol, "https");
    assert.strictEqual(syncBody.config.host, "10.20.30.40");
    assert.strictEqual(syncBody.config.port, 9443);
    assert.strictEqual(syncBody.creds.user, "fleet_user");
    assert.strictEqual(syncBody.creds.pass, "fleet_password");

    // 2. /proxy.pac
    const pacRes = await fetch(`${base}/proxy.pac`);
    assert.strictEqual(pacRes.status, 200);
    const pacText = await pacRes.text();
    // Default profile has preset:ai_services -> proxy
    assert.match(pacText, /HTTPS 10\.20\.30\.40:9443; DIRECT/);
  });

  clearProxiesStore();
});

