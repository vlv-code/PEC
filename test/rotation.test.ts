import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import { updateRotationConfig, getRotationConfig, getRotationConfigPublic, getRotationHistory } from "../src/scheduler.js";
import { executeRotation, readCurrentCreds, atomicWriteCreds, getCredsStorePath } from "../src/rotate.js";

test("rotation config: interval validation rejects NaN, zero, negatives and garbage", () => {
  assert.throws(() => updateRotationConfig({ intervalMinutes: 0 }), /intervalMinutes/);
  assert.throws(() => updateRotationConfig({ intervalMinutes: NaN }), /intervalMinutes/);
  assert.throws(() => updateRotationConfig({ intervalMinutes: "abc" as unknown as number }), /intervalMinutes/);
  assert.throws(() => updateRotationConfig({ intervalMinutes: -5 }), /intervalMinutes/);
  assert.throws(() => updateRotationConfig({ intervalMinutes: 1.5 }), /intervalMinutes/);
  // valid value passes and persists
  updateRotationConfig({ intervalMinutes: 90, enabled: false });
  assert.strictEqual(getRotationConfig().intervalMinutes, 90);
});

test("rotation config: admin pass is masked in the public view and preserved on empty save", () => {
  updateRotationConfig({ adminPass: "super-secret-3xui-pass", enabled: false });

  const pub = getRotationConfigPublic();
  assert.strictEqual(pub.adminPass, "********");
  assert.ok(!JSON.stringify(pub).includes("super-secret-3xui-pass"), "public config must not leak the password");

  // saving with an empty password keeps the stored one
  updateRotationConfig({ adminPass: "", enabled: false });
  assert.strictEqual(getRotationConfig().adminPass, "super-secret-3xui-pass");

  // saving the mask itself is rejected (would corrupt the credential)
  assert.throws(() => updateRotationConfig({ adminPass: "********" }), /masked/i);
});

test("rotation config: panelUrl is SSRF-validated on save", () => {
  assert.throws(() => updateRotationConfig({ panelUrl: "http://169.254.169.254/", enabled: false }), /panelUrl|SSRF/i);
  assert.throws(() => updateRotationConfig({ panelUrl: "file:///etc/passwd", enabled: false }), /panelUrl/i);
  updateRotationConfig({ panelUrl: "https://panel.corp.example:2053/xui", enabled: false });
  assert.strictEqual(getRotationConfig().panelUrl, "https://panel.corp.example:2053/xui");
});

test("executeRotation: configured-but-unreachable panel FAILS LOUDLY and does not touch local creds", async () => {
  // seed a known local password
  atomicWriteCreds(getCredsStorePath(), { user: "corp-user", pass: "known-password-before-rotation" });
  const before = readCurrentCreds();

  updateRotationConfig({
    panelUrl: "http://127.0.0.1:9/", // port 9 (discard) - nothing listens, fails fast
    adminUser: "admin",
    adminPass: "panel-pass",
    inboundRemark: "squid-in",
    enabled: false,
  });

  await assert.rejects(
    () => executeRotation(getRotationConfig()),
    /NOT changed|failed/i,
    "a failing 3x-ui panel must throw instead of silently rotating the local store"
  );

  const after = readCurrentCreds();
  assert.strictEqual(after!.pass, before!.pass, "local credentials must remain untouched on panel failure");
});

test("executeRotation: standalone mode (no panel configured) still rotates atomically", async () => {
  updateRotationConfig({
    panelUrl: "https://3xui-host:2053/basepath", // placeholder = not configured
    enabled: false,
  });
  const result = await executeRotation(getRotationConfig());
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.source, "standalone-atomic");
  const creds = readCurrentCreds();
  assert.strictEqual(creds!.user, result.user);
  assert.strictEqual(typeof creds!.pass, "string");
  assert.notStrictEqual(creds!.pass, "");
});

test("rotation history is returned newest-first and capped", () => {
  const history = getRotationHistory();
  assert.ok(Array.isArray(history));
  if (history.length >= 2) {
    assert.ok(new Date(history[0].timestamp).getTime() >= new Date(history[1].timestamp).getTime());
  }
});
