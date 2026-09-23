import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { TEST_TMP_DIR } from "./helpers/setup.js";
import { atomicWriteCreds, ensureCredsStore, getCredsStorePath, readCurrentCreds, validateSafeEndpointUrl } from "../src/rotate.js";
import { registerHeartbeat, getActiveInstances, updateProxyConfig, getProxyConfig } from "../src/instances.js";
import { ensureKeyExists, getPublicKeySpkiDer, calculateExtensionId, buildUpdatesXml, saveBuildConfig, getBuildConfig } from "../src/packager.js";

// Note: the timing-safe comparison behaviour of OUR wrapper
// (timingSafeEqualString) is covered in security.test.ts against the real
// middleware; testing Node's crypto.timingSafeEqual directly here tested the
// standard library, not this codebase.

test("atomic write creates valid file, replaces cleanly and enforces 0600 mode", () => {
  const testFile = path.join(TEST_TMP_DIR, "test_creds.json");
  atomicWriteCreds(testFile, { user: "test-user", pass: "test-secret-pass" });

  assert.strictEqual(fs.existsSync(testFile), true);
  const readBack = JSON.parse(fs.readFileSync(testFile, "utf-8"));
  assert.strictEqual(readBack.user, "test-user");
  assert.strictEqual(readBack.pass, "test-secret-pass");
  assert.strictEqual(readBack.updatedAt !== undefined, true);
  if (process.platform !== "win32") {
    const mode = (fs.statSync(testFile).mode & 0o777);
    assert.strictEqual(mode, 0o600);
  }

  // Replace: temp file must be renamed, no leftovers
  atomicWriteCreds(testFile, { user: "u2", pass: "p2" });
  const leftovers = fs.readdirSync(TEST_TMP_DIR).filter((f) => f.includes(".tmp."));
  assert.deepStrictEqual(leftovers, []);
});

test("ensureCredsStore generates a random high-entropy password (no hardcoded default)", () => {
  const storeA = path.join(TEST_TMP_DIR, "creds_a.json");
  const storeB = path.join(TEST_TMP_DIR, "creds_b.json");
  const a = ensureCredsStore(storeA);
  const b = ensureCredsStore(storeB);
  assert.strictEqual(a.user, "corp-user");
  assert.notStrictEqual(a.pass, b.pass);
  assert.strictEqual(a.pass.length >= 20, true);
  assert.strictEqual(a.pass.includes("InitialRotatingProxyPass"), false);

  // The active store (the one /creds and /api/sync read) must heal exactly
  // like the explicit-path ones, and readCurrentCreds must return the very
  // credentials that were persisted - not merely "something or null".
  const active = ensureCredsStore(getCredsStorePath());
  const read = readCurrentCreds();
  assert.ok(read, "the active creds store must be readable after healing");
  assert.strictEqual(read.user, active.user);
  assert.strictEqual(read.pass, active.pass);
  const persisted = JSON.parse(fs.readFileSync(getCredsStorePath(), "utf-8"));
  assert.strictEqual(persisted.pass, active.pass, "what readCurrentCreds returns must match the store on disk");
});

test("SSRF validation blocks metadata endpoints, link-local and non-http schemes", () => {
  assert.strictEqual(validateSafeEndpointUrl("http://169.254.169.254/latest/meta-data").valid, false);
  assert.strictEqual(validateSafeEndpointUrl("http://metadata.google.internal/computeMetadata/v1").valid, false);
  assert.strictEqual(validateSafeEndpointUrl("http://metadata.goog").valid, false);
  assert.strictEqual(validateSafeEndpointUrl("file:///etc/passwd").valid, false);
  assert.strictEqual(validateSafeEndpointUrl("ftp://panel.local").valid, false);
  assert.strictEqual(validateSafeEndpointUrl("https://my-3xui-panel.corp:2053/subpath").valid, true);
});

test("extension key derivation produces a deterministic 32-char a-p extension ID", () => {
  const key = ensureKeyExists();
  const spkiDer = getPublicKeySpkiDer(key);
  const id = calculateExtensionId(spkiDer);
  assert.match(id, /^[a-p]{32}$/);
  // Same key -> same ID (stability matters for GPO forcelists)
  assert.strictEqual(calculateExtensionId(getPublicKeySpkiDer(ensureKeyExists())), id);
});

test("buildUpdatesXml emits a valid Google update manifest", () => {
  const xml = buildUpdatesXml("abcdefghijklmnopabcdefghijklmnop", "1.1.0", "https://server.local/extension.crx");
  assert.match(xml, /<app appid='abcdefghijklmnopabcdefghijklmnop'>/);
  assert.match(xml, /version='1\.1\.0'/);
  assert.match(xml, /codebase='https:\/\/server\.local\/extension\.crx'/);
});

test("instances registry tracks heartbeats and sync counts", () => {
  const inst1 = registerHeartbeat({
    instanceId: "inst_test_123",
    ip: "192.168.1.50",
    version: "1.1.0",
    activeProxyMode: "socks5",
  });
  assert.strictEqual(inst1.instanceId, "inst_test_123");
  assert.strictEqual(inst1.syncCount, 1);
  assert.strictEqual(inst1.status, "ONLINE");

  const inst2 = registerHeartbeat({ instanceId: "inst_test_123", ip: "192.168.1.50", version: "1.1.0" });
  assert.strictEqual(inst2.syncCount, 2);

  const found = getActiveInstances().find((i) => i.instanceId === "inst_test_123");
  assert.ok(found);
  assert.strictEqual(found.syncCount, 2);
});

test("proxy config updates validate host and port", () => {
  updateProxyConfig({ protocol: "socks5", host: "xray.internal", port: 10808 });
  const cfg = getProxyConfig();
  assert.strictEqual(cfg.protocol, "socks5");
  assert.strictEqual(cfg.host, "xray.internal");
  assert.strictEqual(cfg.port, 10808);

  assert.throws(() => updateProxyConfig({ host: "bad host name with spaces" }), /invalid host format/i);
  assert.throws(() => updateProxyConfig({ port: 99999 }), /invalid port number/i);
});

test("builder config round-trips and studio overrides are tracked", () => {
  const orig = getBuildConfig();
  saveBuildConfig({ name: "Test Custom Brand", themeColor: "#10b981" });
  const updated = getBuildConfig();
  assert.strictEqual(updated.name, "Test Custom Brand");
  assert.strictEqual(updated.themeColor, "#10b981");
  saveBuildConfig(orig);
  assert.strictEqual(getBuildConfig().name, orig.name);
});
