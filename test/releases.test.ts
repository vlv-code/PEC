import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { TEST_TMP_DIR } from "./helpers/setup.js";
import {
  getAllReleases,
  recordRelease,
  setActiveRelease,
  deleteRelease,
  getActiveRelease,
  resetReleasesStore,
} from "../src/releases.js";

test("Release Manager: records a new release and marks it active if first of its type", () => {
  resetReleasesStore();

  const rel = recordRelease({
    type: "extension",
    version: "1.2.0",
    builtAt: new Date().toISOString(),
    sha256: "test-sha-120",
    fileName: "pec-extension.crx",
    filePath: path.join(TEST_TMP_DIR, "releases/extensions/1.2.0/pec-extension.crx"),
  });

  assert.strictEqual(rel.isActive, true);
  assert.strictEqual(rel.version, "1.2.0");
  assert.strictEqual(rel.type, "extension");

  const store = getAllReleases();
  assert.strictEqual(store.activeExtensionVersion, "1.2.0");
  assert.strictEqual(store.releases.length, 1);

  const active = getActiveRelease("extension");
  assert.strictEqual(active?.version, "1.2.0");
});

test("Release Manager: allows setting a prior release active (rollback)", () => {
  resetReleasesStore();

  recordRelease({
    type: "extension",
    version: "1.2.0",
    builtAt: new Date().toISOString(),
    sha256: "test-sha-120",
    fileName: "pec-extension.crx",
    filePath: path.join(TEST_TMP_DIR, "releases/extensions/1.2.0/pec-extension.crx"),
  });

  const rel2 = recordRelease({
    type: "extension",
    version: "1.2.1",
    builtAt: new Date().toISOString(),
    sha256: "test-sha-121",
    fileName: "pec-extension.crx",
    filePath: path.join(TEST_TMP_DIR, "releases/extensions/1.2.1/pec-extension.crx"),
    isActive: true,
  });

  assert.strictEqual(rel2.isActive, true);
  assert.strictEqual(getAllReleases().activeExtensionVersion, "1.2.1");

  // Rollback to 1.2.0
  const res = setActiveRelease("extension", "1.2.0");
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.activeVersion, "1.2.0");

  const store = getAllReleases();
  assert.strictEqual(store.activeExtensionVersion, "1.2.0");
  const rel120 = store.releases.find((r) => r.version === "1.2.0");
  const rel121 = store.releases.find((r) => r.version === "1.2.1");
  assert.strictEqual(rel120?.isActive, true);
  assert.strictEqual(rel121?.isActive, false);

  const active = getActiveRelease("extension");
  assert.strictEqual(active?.version, "1.2.0");
});

test("Release Manager: refuses to delete an active release, allows deleting inactive", () => {
  resetReleasesStore();

  recordRelease({
    type: "app",
    version: "2.1.0",
    builtAt: new Date().toISOString(),
    sha256: "test-sha-210",
    fileName: "pec-client-windows-x64.zip",
    filePath: path.join(TEST_TMP_DIR, "releases/apps/2.1.0/pec-client-windows-x64.zip"),
  });

  recordRelease({
    type: "app",
    version: "2.2.0",
    builtAt: new Date().toISOString(),
    sha256: "test-sha-220",
    fileName: "pec-client-windows-x64.zip",
    filePath: path.join(TEST_TMP_DIR, "releases/apps/2.2.0/pec-client-windows-x64.zip"),
    isActive: true,
  });

  // Cannot delete active version 2.2.0
  assert.throws(
    () => deleteRelease("app", "2.2.0"),
    /Cannot delete active release/
  );

  // Can delete inactive version 2.1.0
  const deleted = deleteRelease("app", "2.1.0");
  assert.strictEqual(deleted, true);

  const store = getAllReleases();
  assert.strictEqual(store.releases.length, 1);
  assert.strictEqual(store.releases[0].version, "2.2.0");

  // Deleting non-existent returns false
  assert.strictEqual(deleteRelease("app", "9.9.9"), false);

  // Activating non-existent throws
  assert.throws(() => setActiveRelease("app", "9.9.9"), /Release not found/);
});

test("Release Manager: getActiveRelease returns undefined when store is empty", () => {
  resetReleasesStore();
  assert.strictEqual(getActiveRelease("extension"), undefined);
  assert.strictEqual(getActiveRelease("app"), undefined);
});

test("Release Manager: setActiveRelease mirrors both extension.crx and pec-extension.crx as well as pec_profile.pbprofile", () => {
  resetReleasesStore();

  const relDirExt = path.join(TEST_TMP_DIR, "releases/extensions/1.0.0");
  const relDirApp = path.join(TEST_TMP_DIR, "releases/apps/2.0.0");
  fs.mkdirSync(relDirExt, { recursive: true });
  fs.mkdirSync(relDirApp, { recursive: true });

  const pecCrxPath = path.join(relDirExt, "pec-extension.crx");
  const extCrxPath = path.join(relDirExt, "extension.crx");
  const xmlPath = path.join(relDirExt, "updates.xml");
  fs.writeFileSync(pecCrxPath, "pec-crx-100");
  fs.writeFileSync(extCrxPath, "ext-crx-100");
  fs.writeFileSync(xmlPath, "<xml>100</xml>");

  const winZipPath = path.join(relDirApp, "pec-client-windows-x64.zip");
  const profilePath = path.join(relDirApp, "pec_profile.pbprofile");
  fs.writeFileSync(winZipPath, "win-zip-200");
  fs.writeFileSync(profilePath, "{\"profile\":\"200\"}");

  recordRelease({
    type: "extension",
    version: "1.0.0",
    builtAt: new Date().toISOString(),
    sha256: "sha-100",
    fileName: "pec-extension.crx",
    filePath: pecCrxPath,
    isActive: false,
  });

  recordRelease({
    type: "app",
    version: "2.0.0",
    builtAt: new Date().toISOString(),
    sha256: "sha-200",
    fileName: "pec-client-windows-x64.zip",
    filePath: winZipPath,
    isActive: false,
  });

  setActiveRelease("extension", "1.0.0");
  setActiveRelease("app", "2.0.0");

  const updatesDir = path.resolve(process.env.PEC_UPDATES_DIR || path.join(TEST_TMP_DIR, "updates"));
  assert.strictEqual(fs.readFileSync(path.join(updatesDir, "pec-extension.crx"), "utf-8"), "pec-crx-100");
  assert.strictEqual(fs.readFileSync(path.join(updatesDir, "extension.crx"), "utf-8"), "ext-crx-100");
  assert.strictEqual(fs.readFileSync(path.join(updatesDir, "updates.xml"), "utf-8"), "<xml>100</xml>");
  assert.strictEqual(fs.readFileSync(path.join(updatesDir, "pec-client-windows-x64.zip"), "utf-8"), "win-zip-200");
  assert.strictEqual(fs.readFileSync(path.join(updatesDir, "pec_profile.pbprofile"), "utf-8"), "{\"profile\":\"200\"}");
});

test("Release Manager: deleteRelease safely ignores deletion when filePath is not within getReleasesDir", () => {
  resetReleasesStore();

  const fakeOutsidePath = path.join(TEST_TMP_DIR, "outside_file.txt");
  fs.writeFileSync(fakeOutsidePath, "do-not-delete-me");

  recordRelease({
    type: "app",
    version: "0.0.1",
    builtAt: new Date().toISOString(),
    sha256: "sha-unsafe",
    fileName: "outside_file.txt",
    filePath: fakeOutsidePath,
    isActive: false,
  });

  recordRelease({
    type: "app",
    version: "0.0.2",
    builtAt: new Date().toISOString(),
    sha256: "sha-active",
    fileName: "active.zip",
    filePath: path.join(TEST_TMP_DIR, "releases/apps/0.0.2/active.zip"),
    isActive: true,
  });

  const deleted = deleteRelease("app", "0.0.1");
  assert.strictEqual(deleted, true);
  // Target outside file must NOT be deleted
  assert.ok(fs.existsSync(fakeOutsidePath));
});
