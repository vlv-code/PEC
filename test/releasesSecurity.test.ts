import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { TEST_TMP_DIR, TEST_ADMIN_TOKEN, TEST_TOKEN } from "./helpers/setup.js";
import {
  recordRelease,
  setActiveRelease,
  getAllReleases,
  resetReleasesStore,
} from "../src/releases.js";
import { createReleasesRouter } from "../src/routes/releasesRoutes.js";
import { getReleasesDir } from "../src/storage.js";

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

test("releases: setActiveRelease rejects release with mismatched SHA-256 (M-3)", () => {
  resetReleasesStore();

  const relDir = path.join(TEST_TMP_DIR, "releases/extensions/3.0.0");
  fs.mkdirSync(relDir, { recursive: true });
  const crxPath = path.join(relDir, "pec-extension.crx");
  const originalContent = "original-crx-content-3.0.0";
  fs.writeFileSync(crxPath, originalContent);

  const realSha256 = crypto.createHash("sha256").update(originalContent).digest("hex");

  // Record with correct SHA-256
  recordRelease({
    type: "extension",
    version: "3.0.0",
    builtAt: new Date().toISOString(),
    sha256: realSha256,
    fileName: "pec-extension.crx",
    filePath: crxPath,
    isActive: false,
  });

  // Now tamper with the file content
  fs.writeFileSync(crxPath, "tampered-content-malicious");

  // Activating the tampered release must throw an integrity error
  assert.throws(
    () => setActiveRelease("extension", "3.0.0"),
    /Integrity check failed.*SHA-256 mismatch/i
  );

  // Verify it was NOT made active
  const store = getAllReleases();
  assert.notEqual(store.activeExtensionVersion, "3.0.0");

  // Restore untampered content
  fs.writeFileSync(crxPath, originalContent);

  // Now activating should succeed
  const result = setActiveRelease("extension", "3.0.0");
  assert.equal(result.ok, true);
  assert.equal(result.activeVersion, "3.0.0");
  assert.equal(getAllReleases().activeExtensionVersion, "3.0.0");
});

test("releasesRoutes: validates version parameter against regex (M-5)", async () => {
  resetReleasesStore();

  await withServer(async (base) => {
    // 1. Invalid version in set-active
    const invalidVersions = [
      "../../etc/passwd",
      "1.0.0/../../evil",
      "1.0.0;rm -rf",
      "invalid-version",
      "1",
      "v1.0.0",
      "1.0.0.0.0.0",
    ];

    for (const badVer of invalidVersions) {
      const res = await fetch(`${base}/api/releases/set-active`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Token": TEST_ADMIN_TOKEN,
        },
        body: JSON.stringify({ type: "extension", version: badVer }),
      });
      assert.equal(res.status, 400, `Expected 400 for bad version in set-active: ${badVer}`);
    }

    // 2. Invalid version in download
    for (const badVer of ["..%2F..%2Fpasswd", "evil/path", "not-a-version"]) {
      const res = await fetch(`${base}/api/releases/download/extension/${encodeURIComponent(badVer)}`, {
        headers: { "X-Admin-Token": TEST_ADMIN_TOKEN },
      });
      assert.equal(res.status, 400, `Expected 400 for bad version in download: ${badVer}`);
    }

    // 3. Invalid version in delete
    for (const badVer of ["..%2Fevil", "bad*version"]) {
      const res = await fetch(`${base}/api/releases/extension/${encodeURIComponent(badVer)}`, {
        method: "DELETE",
        headers: { "X-Admin-Token": TEST_ADMIN_TOKEN },
      });
      assert.equal(res.status, 400, `Expected 400 for bad version in delete: ${badVer}`);
    }
  });
});

test("releasesRoutes: enforces path containment on download (M-5)", async () => {
  resetReleasesStore();

  // Create a file strictly OUTSIDE getReleasesDir()
  const outsideFile = path.join(TEST_TMP_DIR, "outside_secret.txt");
  fs.writeFileSync(outsideFile, "super-secret-system-file");

  // Register a release whose filePath points outside releases dir
  recordRelease({
    type: "extension",
    version: "3.5.0",
    builtAt: new Date().toISOString(),
    sha256: "test-outside-sha",
    fileName: "outside_secret.txt",
    filePath: outsideFile,
    isActive: false,
  });

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/releases/download/extension/3.5.0`, {
      headers: { "X-Admin-Token": TEST_ADMIN_TOKEN },
    });
    // Must be rejected with 403 Forbidden due to path containment failure
    assert.equal(res.status, 403, "Should return 403 for file outside releases directory");
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "Access denied");
  });
});
