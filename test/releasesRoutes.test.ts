import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import express from "express";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import path from "node:path";
import { TEST_TMP_DIR, TEST_ADMIN_TOKEN, TEST_TOKEN } from "./helpers/setup.js";
import { createReleasesRouter } from "../src/routes/releasesRoutes.js";
import { recordRelease, resetReleasesStore } from "../src/releases.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createReleasesRouter(() => TEST_ADMIN_TOKEN, undefined, () => TEST_TOKEN));
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

test("Releases API: GET /api/releases requires admin authentication", async () => {
  resetReleasesStore();

  await withServer(async (base) => {
    // Without token: 401
    const resNoAuth = await fetch(`${base}/api/releases`);
    assert.strictEqual(resNoAuth.status, 401);

    // With invalid token: 401
    const resBadAuth = await fetch(`${base}/api/releases`, {
      headers: { "X-Admin-Token": "wrong-token" },
    });
    assert.strictEqual(resBadAuth.status, 401);

    // With valid token: 200
    const resAuth = await fetch(`${base}/api/releases`, {
      headers: { "X-Admin-Token": TEST_ADMIN_TOKEN },
    });
    assert.strictEqual(resAuth.status, 200);
    const body = await resAuth.json();
    assert.strictEqual(body.ok, true);
    assert.ok(Array.isArray(body.releases));
  });
});

test("Releases API: POST /api/releases/set-active changes active version and rolls back", async () => {
  resetReleasesStore();

  // Create fake files
  const releaseDir1 = path.join(TEST_TMP_DIR, "releases/extensions/1.0.0");
  const releaseDir2 = path.join(TEST_TMP_DIR, "releases/extensions/1.1.0");
  fs.mkdirSync(releaseDir1, { recursive: true });
  fs.mkdirSync(releaseDir2, { recursive: true });
  const crx1 = path.join(releaseDir1, "pec-extension.crx");
  const crx2 = path.join(releaseDir2, "pec-extension.crx");
  fs.writeFileSync(crx1, "crx1-data");
  fs.writeFileSync(crx2, "crx2-data");

  recordRelease({
    type: "extension",
    version: "1.0.0",
    builtAt: new Date().toISOString(),
    sha256: "sha-1",
    fileName: "pec-extension.crx",
    filePath: crx1,
  });

  recordRelease({
    type: "extension",
    version: "1.1.0",
    builtAt: new Date().toISOString(),
    sha256: "sha-2",
    fileName: "pec-extension.crx",
    filePath: crx2,
    isActive: true,
  });

  await withServer(async (base) => {
    // Missing body: 400
    const resInvalid = await fetch(`${base}/api/releases/set-active`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Token": TEST_ADMIN_TOKEN,
      },
      body: JSON.stringify({ type: "unknown" }),
    });
    assert.strictEqual(resInvalid.status, 400);

    // Rollback to 1.0.0
    const resRollback = await fetch(`${base}/api/releases/set-active`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Token": TEST_ADMIN_TOKEN,
      },
      body: JSON.stringify({ type: "extension", version: "1.0.0" }),
    });
    assert.strictEqual(resRollback.status, 200);
    const body = await resRollback.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.activeVersion, "1.0.0");

    // Check updates directory has mirrored 1.0.0
    const updatesDir = path.join(TEST_TMP_DIR, "updates");
    const activeCrx = path.join(updatesDir, "pec-extension.crx");
    assert.ok(fs.existsSync(activeCrx));
    assert.strictEqual(fs.readFileSync(activeCrx, "utf-8"), "crx1-data");
  });
});

test("Releases API: DELETE /api/releases/:type/:version and download endpoint", async () => {
  resetReleasesStore();

  const releaseDir = path.join(TEST_TMP_DIR, "releases/apps/2.0.0");
  fs.mkdirSync(releaseDir, { recursive: true });
  const appZip = path.join(releaseDir, "pec-client-windows-x64.zip");
  fs.writeFileSync(appZip, "app-zip-payload");

  recordRelease({
    type: "app",
    version: "2.0.0",
    builtAt: new Date().toISOString(),
    sha256: "sha-app",
    fileName: "pec-client-windows-x64.zip",
    filePath: appZip,
    isActive: false,
  });

  await withServer(async (base) => {
    // Download release package with admin token
    const resDownloadAdmin = await fetch(`${base}/api/releases/download/app/2.0.0`, {
      headers: { "X-Admin-Token": TEST_ADMIN_TOKEN },
    });
    assert.strictEqual(resDownloadAdmin.status, 200);
    const contentAdmin = await resDownloadAdmin.text();
    assert.strictEqual(contentAdmin, "app-zip-payload");

    // Download release package with x-fleet-token
    const resDownloadFleet = await fetch(`${base}/api/releases/download/app/2.0.0`, {
      headers: { "x-fleet-token": TEST_TOKEN },
    });
    assert.strictEqual(resDownloadFleet.status, 200);
    const contentFleet = await resDownloadFleet.text();
    assert.strictEqual(contentFleet, "app-zip-payload");

    // Download release package with x-ext-token
    const resDownloadExt = await fetch(`${base}/api/releases/download/app/2.0.0`, {
      headers: { "x-ext-token": TEST_TOKEN },
    });
    assert.strictEqual(resDownloadExt.status, 200);
    const contentExt = await resDownloadExt.text();
    assert.strictEqual(contentExt, "app-zip-payload");

    // Download release package with multi-valued x-fleet-token headers
    const resDownloadMultiHeader = await fetch(`${base}/api/releases/download/app/2.0.0`, {
      headers: [["x-fleet-token", TEST_TOKEN], ["x-fleet-token", "second-val"]],
    });
    assert.strictEqual(resDownloadMultiHeader.status, 200);

    // Download without token returns 401
    const resDownloadNoAuth = await fetch(`${base}/api/releases/download/app/2.0.0`);
    assert.strictEqual(resDownloadNoAuth.status, 401);

    // Fleet token on admin-only route returns 401
    const resFleetOnAdmin = await fetch(`${base}/api/releases`, {
      headers: { "x-fleet-token": TEST_TOKEN },
    });
    assert.strictEqual(resFleetOnAdmin.status, 401);

    // Delete inactive release
    const resDelete = await fetch(`${base}/api/releases/app/2.0.0`, {
      method: "DELETE",
      headers: { "X-Admin-Token": TEST_ADMIN_TOKEN },
    });
    assert.strictEqual(resDelete.status, 200);
    const delBody = await resDelete.json();
    assert.strictEqual(delBody.ok, true);
    assert.strictEqual(delBody.removed, true);
  });
});

test("Releases API: supports cookie authentication via cookieAuth callback", async () => {
  resetReleasesStore();

  const customApp = express();
  customApp.use(express.json());
  customApp.use(
    createReleasesRouter(
      () => TEST_ADMIN_TOKEN,
      (req) => req.headers["x-custom-session"] === "valid-session"
    )
  );

  const server = customApp.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // Without token or cookie: 401
    const resNoAuth = await fetch(`${base}/api/releases`);
    assert.strictEqual(resNoAuth.status, 401);

    // With cookieAuth matched: 200
    const resCookieAuth = await fetch(`${base}/api/releases`, {
      headers: { "x-custom-session": "valid-session" },
    });
    assert.strictEqual(resCookieAuth.status, 200);
    const body = await resCookieAuth.json();
    assert.strictEqual(body.ok, true);
  } finally {
    if (typeof (server as any).closeAllConnections === "function") {
      (server as any).closeAllConnections();
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
