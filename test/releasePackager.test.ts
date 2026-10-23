import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { packageExtension } from "../src/packager.js";
import { packageApp } from "../src/appPackager.js";
import { getAllReleases, resetReleasesStore } from "../src/releases.js";
import { getReleasesDir } from "../src/storage.js";

test("Release Packager: packageExtension registers release and creates versioned directory", () => {
  resetReleasesStore();

  const info = packageExtension("http://localhost:3000");
  assert.ok(info.version);

  const releases = getAllReleases();
  assert.strictEqual(releases.activeExtensionVersion, info.version);

  const extRelease = releases.releases.find((r) => r.type === "extension" && r.version === info.version);
  assert.ok(extRelease);
  assert.strictEqual(extRelease.isActive, true);
  assert.ok(fs.existsSync(extRelease.filePath));

  const releaseDir = path.join(getReleasesDir(), "extensions", info.version);
  assert.ok(fs.existsSync(path.join(releaseDir, "pec-extension.crx")));
  assert.ok(fs.existsSync(path.join(releaseDir, "updates.xml")));
});

test("Release Packager: packageApp registers release and creates versioned directory", () => {
  resetReleasesStore();

  const info = packageApp("http://localhost:3000");
  assert.ok(info.version);

  const releases = getAllReleases();
  assert.strictEqual(releases.activeAppVersion, info.version);

  const appRelease = releases.releases.find((r) => r.type === "app" && r.version === info.version);
  assert.ok(appRelease);
  assert.strictEqual(appRelease.isActive, true);
  assert.ok(fs.existsSync(appRelease.filePath));

  const releaseDir = path.join(getReleasesDir(), "apps", info.version);
  assert.ok(fs.existsSync(path.join(releaseDir, "pec-client-windows-x64.zip")));
  assert.ok(fs.existsSync(path.join(releaseDir, "pec-client-linux-x64.tar.gz")));
});
