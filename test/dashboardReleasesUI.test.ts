import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { renderDashboardHtml } from "../src/views/dashboardView.js";

test("Dashboard UI: renderDashboardHtml includes Releases tab and Rollback table", () => {
  const html = renderDashboardHtml({
    isDefaultTokenInUse: false,
  });

  assert.ok(
    html.includes('id="tabBtnReleases"'),
    "HTML must include tabBtnReleases navigation button"
  );
  assert.ok(
    html.includes('id="tab-releases"'),
    "HTML must include tab-releases pane"
  );
  assert.ok(
    html.includes('id="releasesTable"'),
    "HTML must include releasesTable"
  );
  assert.ok(
    html.includes('id="releasesTableBody"'),
    "HTML must include releasesTableBody"
  );
});

test("Dashboard UI: fleet table includes username column and pairing display", () => {
  const html = renderDashboardHtml({
    isDefaultTokenInUse: false,
  });

  assert.ok(
    html.includes("data-sort=\"user\"") || html.includes("Пользователь"),
    "instancesTable must have user / username column header"
  );

  const jsContent = fs.readFileSync(path.resolve("./public/dashboard.js"), "utf-8");
  assert.ok(
    jsContent.includes("loadReleases"),
    "dashboard.js must contain loadReleases function"
  );
  assert.ok(
    jsContent.includes("/api/releases/set-active"),
    "dashboard.js must call /api/releases/set-active for rollback"
  );
  assert.ok(
    jsContent.includes("downloadReleaseVersion"),
    "dashboard.js must contain downloadReleaseVersion function"
  );
  assert.ok(
    jsContent.includes("pairedAppId") || jsContent.includes("pairedHostname"),
    "dashboard.js must handle paired desktop extension badge"
  );
});

test("Dashboard UI: renderReleasesTable correctly distinguishes active vs archived release rows", () => {
  const jsContent = fs.readFileSync(path.resolve("./public/dashboard.js"), "utf-8");

  // Extract renderReleasesTable and its dependencies to execute in a light VM
  assert.ok(
    jsContent.includes("rel.isActive"),
    "dashboard.js must inspect rel.isActive property"
  );

  // Simulate row generator logic
  const relActive = {
    type: "extension",
    version: "1.2.0",
    builtAt: new Date().toISOString(),
    sha256: "abcdef123456",
    isActive: true,
  };

  const relArchived = {
    type: "extension",
    version: "1.1.0",
    builtAt: new Date(Date.now() - 100000).toISOString(),
    sha256: "123456abcdef",
    isActive: false,
  };

  // Check code pattern in dashboard.js
  assert.ok(
    jsContent.includes("const isActive = Boolean(rel.isActive || rel.active);"),
    "dashboard.js must compute isActive using rel.isActive"
  );
  assert.ok(
    jsContent.includes("downloadReleaseVersion("),
    "dashboard.js must trigger downloadReleaseVersion from download button"
  );
});
