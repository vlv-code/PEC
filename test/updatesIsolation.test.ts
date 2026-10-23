import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import app from "../server.js";
import { TEST_TMP_DIR } from "./helpers/setup.js";

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const server = app.listen(0);
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

test("Updates Isolation (C-1): restricts /updates to .crx and updates.xml only", async () => {
  const updatesDir = path.resolve(process.env.PEC_UPDATES_DIR || path.join(TEST_TMP_DIR, "updates"));
  fs.mkdirSync(updatesDir, { recursive: true });

  // Place dummy files on disk in updatesDir
  fs.writeFileSync(path.join(updatesDir, "updates.xml"), "<xml>ok</xml>");
  fs.writeFileSync(path.join(updatesDir, "extension.crx"), "crx-content");
  fs.writeFileSync(path.join(updatesDir, "pec_profile.pbprofile"), "{\"secret\":\"exposed\"}");
  fs.writeFileSync(path.join(updatesDir, "PEC-App-windows-x64.zip"), "zip-content");
  fs.writeFileSync(path.join(updatesDir, "PEC-App-Setup.exe"), "exe-content");
  fs.writeFileSync(path.join(updatesDir, "pec-client-linux-x64.tar.gz"), "targz-content");

  await withServer(async (base) => {
    // Whitelisted files must be accessible
    const xmlRes = await fetch(`${base}/updates/updates.xml`);
    assert.strictEqual(xmlRes.status, 200);
    const xmlBody = await xmlRes.text();
    assert.strictEqual(xmlBody, "<xml>ok</xml>");

    const crxRes = await fetch(`${base}/updates/extension.crx`);
    assert.strictEqual(crxRes.status, 200);

    // Desktop binaries and profiles must return 404 Not Found even if present on disk
    const profileRes = await fetch(`${base}/updates/pec_profile.pbprofile`);
    assert.strictEqual(profileRes.status, 404, "pbprofile must return 404");

    const zipRes = await fetch(`${base}/updates/PEC-App-windows-x64.zip`);
    assert.strictEqual(zipRes.status, 404, "PEC-App-windows-x64.zip must return 404");

    const exeRes = await fetch(`${base}/updates/PEC-App-Setup.exe`);
    assert.strictEqual(exeRes.status, 404, "PEC-App-Setup.exe must return 404");

    const tarRes = await fetch(`${base}/updates/pec-client-linux-x64.tar.gz`);
    assert.strictEqual(tarRes.status, 404, "pec-client-linux-x64.tar.gz must return 404");
  });
});
