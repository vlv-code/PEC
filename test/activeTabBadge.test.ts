import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createManifestObject, getBuildConfig } from "../src/packager.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

test("manifest.json and packager include 'tabs' permission for active tab badge", () => {
  const manifestRaw = fs.readFileSync(path.join(REPO_ROOT, "extension", "manifest.json"), "utf-8");
  const manifest = JSON.parse(manifestRaw);
  assert.ok(
    manifest.permissions.includes("tabs"),
    "extension/manifest.json must include 'tabs' permission"
  );

  const cfg = getBuildConfig();
  const generatedManifest = createManifestObject(cfg);
  assert.ok(
    (generatedManifest.permissions as string[]).includes("tabs"),
    "createManifestObject must include 'tabs' permission"
  );
});

test("backgroundTemplate contains domainMatchesPattern and evaluateHostRouting functions", async () => {
  const { BACKGROUND_TEMPLATE } = await import("../src/templates/backgroundTemplate.js");
  assert.ok(
    BACKGROUND_TEMPLATE.includes("function domainMatchesPattern("),
    "BACKGROUND_TEMPLATE must export/define domainMatchesPattern"
  );
  assert.ok(
    BACKGROUND_TEMPLATE.includes("function evaluateHostRouting("),
    "BACKGROUND_TEMPLATE must export/define evaluateHostRouting"
  );
  assert.ok(
    BACKGROUND_TEMPLATE.includes("function updateActiveTabBadge("),
    "BACKGROUND_TEMPLATE must export/define updateActiveTabBadge"
  );
  assert.ok(
    BACKGROUND_TEMPLATE.includes("chrome.tabs.onActivated.addListener"),
    "BACKGROUND_TEMPLATE must register onActivated tab listener"
  );
  assert.ok(
    BACKGROUND_TEMPLATE.includes("chrome.tabs.onUpdated.addListener"),
    "BACKGROUND_TEMPLATE must register onUpdated tab listener"
  );
});
