import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TEST_TMP_DIR } from "./helpers/setup.js";

/**
 * Test hygiene and shipped-artifact checks.
 *
 * 1. Store purity: every state store is env-redirected into a temp dir by
 *    helpers/setup.ts. If a writer ever falls back to the repo working
 *    directory again, tests would silently pollute the checkout (the repo
 *    once shipped 11 duplicated test profiles and a dead proxy_config.json
 *    committed in git because of exactly that).
 * 2. Syntax checks: the extension sources and the rendered (placeholder-
 *    substituted) background.js must be valid JavaScript.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const STORE_FILES = [
  "current_creds.json",
  "proxy_config.json",
  "routing_profiles.json",
  "instances_meta.json",
  "rotation_config.json",
  "rotation_history.json",
  "extension_build_config.json",
  "audit_log.json",
];

test("purity: exercising every store writer never touches the repository directory", async () => {
  const before = new Set(fs.readdirSync(REPO_ROOT));

  const { saveProfile } = await import("../src/routing.js");
  const { updateProxyConfig, registerHeartbeat } = await import("../src/instances.js");
  const { updateRotationConfig } = await import("../src/scheduler.js");
  const { saveBuildConfig, ensureKeyExists, packageExtension } = await import("../src/packager.js");
  const { recordAudit } = await import("../src/audit.js");
  const { atomicWriteCreds, getCredsStorePath } = await import("../src/rotate.js");

  saveProfile({ name: "Purity Probe", defaultPolicy: "direct", rules: [] });
  updateProxyConfig({ protocol: "socks5", host: "purity.internal", port: 10808 });
  registerHeartbeat({ instanceId: "inst_purity", ip: "127.0.0.1", version: "1.3.0" });
  updateRotationConfig({ enabled: false });
  saveBuildConfig({ name: "Purity Brand" });
  recordAudit({ ip: "127.0.0.1", endpoint: "/purity", status: 200, result: "SERVED" });
  atomicWriteCreds(getCredsStorePath(), { user: "corp-user", pass: "purity-pass" });
  ensureKeyExists();
  packageExtension("https://purity.example.corp");

  // No files may appear in the repo working directory
  const added = fs.readdirSync(REPO_ROOT).filter((f) => !before.has(f));
  assert.deepStrictEqual(added, [], "tests must not create files in the repo working directory");

  // And none of the known store files may exist there
  for (const f of STORE_FILES) {
    assert.ok(!fs.existsSync(path.join(REPO_ROOT, f)), `${f} must never be created in the repo root`);
  }

  // The writes must have landed in the redirected temp stores instead
  assert.ok(fs.existsSync(path.join(TEST_TMP_DIR, "routing_profiles.json")), "profiles must go to the temp store");
  assert.ok(fs.existsSync(path.join(TEST_TMP_DIR, "updates", "extension.crx")), "packaged extension must go to the temp updates dir");
});

test("purity: extension sources are syntactically valid JavaScript", () => {
  const sources = [
    "extension/background.js",
    "extension/popup.js",
    "extension/scripts/pack.js",
  ];
  for (const rel of sources) {
    const file = path.join(REPO_ROOT, rel);
    assert.ok(fs.existsSync(file), `${rel} must exist`);
    // node --check exits non-zero on any syntax error
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  }
});

test("purity: the rendered background.js (placeholders substituted) parses as JavaScript", async () => {
  const { packageExtension } = await import("../src/packager.js");
  packageExtension("https://purity-render.example.corp");

  // The substituted service worker only exists inside the packaged zip - the
  // source file on disk intentionally keeps its __PEC_*__ placeholders.
  const zipPath = path.join(TEST_TMP_DIR, "updates", "extension.zip");
  assert.ok(fs.existsSync(zipPath), "packaged extension zip must exist in the temp updates dir");
  const AdmZip = (await import("adm-zip")).default;
  const bg = new AdmZip(zipPath).readAsText("background.js");
  assert.ok(!bg.includes("__PEC_"), "no raw placeholders may remain in the packaged background.js");

  const tmpFile = path.join(TEST_TMP_DIR, "rendered-background-check.js");
  fs.writeFileSync(tmpFile, bg, "utf-8");
  execFileSync(process.execPath, ["--check", tmpFile], { stdio: "pipe" });

  // The instanceId must survive MV3 service-worker restarts: it has to be
  // persisted through chrome.storage.local, not held in module memory.
  assert.ok(bg.includes("pecInstanceId"), "instanceId must be persisted under a stable storage key");
  assert.ok(bg.includes("chrome.storage.local"), "instanceId persistence must use chrome.storage.local");
  assert.ok(!bg.includes("ephemeralInstanceId"), "the old ephemeral module-level instanceId must be gone");
});
