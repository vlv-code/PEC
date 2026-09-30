import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { AddressInfo } from "node:net";
import AdmZip from "adm-zip";
import { TEST_TMP_DIR, TEST_TOKEN, TEST_ADMIN_TOKEN } from "./helpers/setup.js";
import { packageExtension, saveBuildConfig, isPackageStale } from "../src/packager.js";
import { createBuilderRouter } from "../src/routes/builderRoutes.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createBuilderRouter(() => TEST_TOKEN, () => TEST_ADMIN_TOKEN));
  return app;
}

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const server = buildApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    if (typeof (server as any).closeAllConnections === "function") {
      (server as any).closeAllConnections();
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("builder: isPackageStale detects when configuration is newer than zip", async () => {
  // 1. Initial package
  saveBuildConfig({ defaultServerUrl: "http://initial.example.corp" });
  packageExtension("http://initial.example.corp");
  assert.strictEqual(isPackageStale(), false, "immediately after packageExtension, package must not be stale");

  // 2. Artificially backdate the zip file
  const zipPath = path.join(TEST_TMP_DIR, "updates", "extension.zip");
  const past = new Date(Date.now() - 10000);
  fs.utimesSync(zipPath, past, past);

  // 3. Update build config
  saveBuildConfig({ defaultServerUrl: "http://updated.example.corp" });
  assert.strictEqual(isPackageStale(), true, "must report stale after build config is updated");

  // 4. Re-packaging clears staleness
  packageExtension("http://updated.example.corp");
  assert.strictEqual(isPackageStale(), false, "must not be stale after re-packaging");
});

test("builder: GET /api/extension/download-zip re-packages when stale and delivers updated config", async () => {
  await withServer(async (base) => {
    // 1. Initial build with server A
    saveBuildConfig({ defaultServerUrl: "http://server-a.example.corp", syncIntervalMinutes: 10 });
    packageExtension("http://server-a.example.corp");

    // 2. Change builder config to server B without calling build explicitly
    const zipPath = path.join(TEST_TMP_DIR, "updates", "extension.zip");
    const past = new Date(Date.now() - 10000);
    fs.utimesSync(zipPath, past, past);

    const postRes = await fetch(`${base}/api/builder/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Token": TEST_ADMIN_TOKEN },
      body: JSON.stringify({ defaultServerUrl: "http://server-b.example.corp", syncIntervalMinutes: 45 }),
    });
    assert.strictEqual(postRes.status, 200);

    // 3. Download zip as a user clicking Download .ZIP
    const dlRes = await fetch(`${base}/api/extension/download-zip`);
    assert.strictEqual(dlRes.status, 200);
    const buf = Buffer.from(await dlRes.arrayBuffer());
    const zip = new AdmZip(buf);
    const bg = zip.readAsText("background.js");

    assert.match(bg, /const DEFAULT_SERVER_BASE = "http:\/\/server-b\.example\.corp"/, "zip must contain the updated server URL");
    assert.match(bg, /const SYNC_INTERVAL_MIN = 45;/, "zip must contain updated sync interval");
  });
});

test("builder: packageExtension honors explicit public base URL", () => {
  saveBuildConfig({ defaultServerUrl: "" });
  const publicUrl = "https://public-proxy.corp.example";
  packageExtension(publicUrl);

  const zipPath = path.join(TEST_TMP_DIR, "updates", "extension.zip");
  const zip = new AdmZip(zipPath);
  const bg = zip.readAsText("background.js");
  assert.match(bg, /const DEFAULT_SERVER_BASE = "https:\/\/public-proxy\.corp\.example"/);

  const xmlPath = path.join(TEST_TMP_DIR, "updates", "updates.xml");
  const xml = fs.readFileSync(xmlPath, "utf-8");
  assert.match(xml, /codebase=['"]https:\/\/public-proxy\.corp\.example\/updates\/extension\.crx['"]/);
});

test("builder: packaged zip and unpacked dir exclude documentation and template files (README, .example, .svg)", () => {
  saveBuildConfig({ defaultServerUrl: "" });
  packageExtension("http://localhost:3000");

  const zipPath = path.join(TEST_TMP_DIR, "updates", "extension.zip");
  const zip = new AdmZip(zipPath);
  const zipEntries = zip.getEntries().map((e) => e.entryName);

  assert.ok(!zipEntries.some((name) => name.toLowerCase() === "readme.md"), "zip must not contain README.md");
  assert.ok(!zipEntries.some((name) => name.endsWith(".example")), "zip must not contain .example files");
  assert.ok(!zipEntries.some((name) => name.endsWith(".svg")), "zip must not contain .svg files");
  assert.ok(!zipEntries.some((name) => name.endsWith(".pem")), "zip must not contain private keys");

  const unpackedDir = path.join(TEST_TMP_DIR, "unpacked");
  if (fs.existsSync(unpackedDir)) {
    const unpackedFiles = fs.readdirSync(unpackedDir);
    assert.ok(!unpackedFiles.some((name) => name.toLowerCase() === "readme.md"), "unpacked dir must not contain README.md");
    assert.ok(!unpackedFiles.some((name) => name.endsWith(".example")), "unpacked dir must not contain .example files");
    assert.ok(!unpackedFiles.some((name) => name.endsWith(".svg")), "unpacked dir must not contain .svg files");
  }
});

test("builder: pack-extension script requires explicit server URL and rejects empty target", async () => {
  const { spawnSync } = await import("node:child_process");
  const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const scriptPath = path.resolve("scripts/pack-extension.ts");

  // Run without PEC_SERVER_URL or PUBLIC_BASE_URL
  const cleanEnv = { ...process.env };
  delete cleanEnv.PEC_SERVER_URL;
  delete cleanEnv.PUBLIC_BASE_URL;

  const resFail = spawnSync(npxCmd, ["tsx", scriptPath], {
    env: cleanEnv,
    encoding: "utf-8",
    shell: true,
  });

  assert.strictEqual(resFail.status, 1, "pack-extension must exit 1 when no server URL is provided");
  assert.ok(
    (resFail.stderr || "").includes("FATAL") && (resFail.stderr || "").includes("PEC_SERVER_URL"),
    "stderr must show fatal message about missing server URL"
  );

  // Run with PEC_SERVER_URL
  const resOk = spawnSync(npxCmd, ["tsx", scriptPath], {
    env: { ...cleanEnv, PEC_SERVER_URL: "https://pec-test.example.corp" },
    encoding: "utf-8",
    shell: true,
  });

  assert.strictEqual(resOk.status, 0, "pack-extension must succeed when PEC_SERVER_URL is provided");
  assert.ok(
    (resOk.stdout || "").includes("https://pec-test.example.corp"),
    "stdout must confirm target URL"
  );
});


