import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { executeRotation, atomicWriteCreds, getCredsStorePath } from "../src/rotate.js";

/**
 * The rotation history file must be seeded BEFORE the scheduler module loads
 * its state (it reads the store once at import time), so the scheduler is
 * imported dynamically after the seed is written.
 */
const HISTORY_PATH = process.env.ROTATION_HISTORY_PATH!;

// 55 entries in the store format produced by unshift(): newest first.
const seeded = Array.from({ length: 55 }, (_, i) => ({
  id: `hist_seed_${i}`,
  timestamp: new Date(Date.now() - (55 - i) * 60_000).toISOString(),
  source: "manual",
  user: "corp-user",
  success: true,
})).reverse(); // hist_seed_54 (newest) first, hist_seed_0 (oldest) last
fs.writeFileSync(HISTORY_PATH, JSON.stringify(seeded, null, 2));

const { updateRotationConfig, getRotationConfig, getRotationConfigPublic, getRotationHistory, runManualRotation } =
  await import("../src/scheduler.js");

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
  const before = JSON.parse(fs.readFileSync(getCredsStorePath(), "utf-8"));

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

  const after = JSON.parse(fs.readFileSync(getCredsStorePath(), "utf-8"));
  assert.strictEqual(after.pass, before.pass, "local credentials must remain untouched on panel failure");
});

test("executeRotation: standalone mode (no panel configured) still rotates atomically", async () => {
  updateRotationConfig({
    panelUrl: "https://3xui-host:2053/basepath", // placeholder = not configured
    enabled: false,
  });
  const result = await executeRotation(getRotationConfig());
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.source, "standalone-atomic");
  const creds = JSON.parse(fs.readFileSync(getCredsStorePath(), "utf-8"));
  assert.strictEqual(creds.user, result.user);
  assert.strictEqual(typeof creds.pass, "string");
  assert.notStrictEqual(creds.pass, "");
});

test("rotation history: capped at 50, newest first, both in memory and on disk", async () => {
  // The seed had 55 entries: loading must already cap at 50 (oldest evicted)
  const loaded = getRotationHistory();
  assert.strictEqual(loaded.length, 50, "an oversized history store must be capped on load");
  assert.strictEqual(loaded[0].id, "hist_seed_54", "newest seeded entry must come first");
  assert.strictEqual(loaded[49].id, "hist_seed_5", "the 6 oldest seeded entries must be evicted on load");

  // One more rotation keeps the cap and lands on top
  await runManualRotation();

  const history = getRotationHistory();
  assert.strictEqual(history.length, 50, "history must stay capped at 50 entries after a push");
  assert.strictEqual(history[0].success, true, "the fresh standalone rotation must be the newest entry");
  assert.strictEqual(history[1].id, "hist_seed_54", "the previous newest entry shifts to second place");

  // Strict newest-first ordering
  for (let i = 1; i < history.length; i++) {
    const prev = new Date(history[i - 1].timestamp).getTime();
    const cur = new Date(history[i].timestamp).getTime();
    assert.ok(prev >= cur, `history must be ordered newest-first (index ${i - 1} -> ${i})`);
  }

  // The persisted file is capped to the same 50 entries
  const onDisk = JSON.parse(fs.readFileSync(HISTORY_PATH, "utf-8")) as Array<{ id: string }>;
  assert.strictEqual(onDisk.length, 50, "the history store on disk must be capped to 50 entries");
  assert.ok(!onDisk.some((h) => h.id === "hist_seed_0"), "the oldest seeded entry must have been evicted from disk");
});

test("runManualRotation: concurrent calls are serialized by the in-flight lock", async () => {
  // Stub the panel HTTP layer: a slow failing endpoint lets the two callers
  // overlap deterministically, and the call counter proves how many rotation
  // attempts actually ran (the history file is capped, so its length cannot
  // discriminate 1 vs 2 attempts).
  updateRotationConfig({
    panelUrl: "http://127.0.0.1:59999/xui",
    adminUser: "admin",
    adminPass: "panel-pass",
    inboundRemark: "squid-in",
    enabled: false,
  });

  let panelFetches = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    panelFetches++;
    await new Promise((r) => setTimeout(r, 50));
    throw new Error("connection refused (test stub)");
  }) as typeof fetch;

  try {
    const [a, b] = await Promise.allSettled([runManualRotation(), runManualRotation()]);

    // Both callers observe the same failure (panel unreachable)
    assert.strictEqual(a.status, "rejected");
    assert.strictEqual(b.status, "rejected");

    // Exactly ONE panel attempt: the second caller joined the in-flight
    // promise instead of starting its own rotation.
    assert.strictEqual(panelFetches, 1, "concurrent rotations must be collapsed into a single panel attempt");

    // The in-flight slot is freed afterwards: a fresh call starts a new one
    await runManualRotation().catch(() => {});
    assert.strictEqual(panelFetches, 2, "the lock must release after completion");
  } finally {
    globalThis.fetch = realFetch;
  }
});
