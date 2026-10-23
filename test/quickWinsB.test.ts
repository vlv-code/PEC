import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getAppVersion } from "../src/version.js";
import { renderDashboardHtml } from "../src/views/dashboardView.js";
import { initDashboardCredentials, resetDashboardCredentialsForTest } from "../src/auth.js";

test("B2: getAppVersion returns package.json version and renders in dashboard badge", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8"));
  const version = getAppVersion();
  assert.equal(version, pkg.version);

  const html = renderDashboardHtml();
  assert.ok(html.includes(`data-server-version="${pkg.version}"`), "badge must contain data-server-version attribute");
  assert.ok(html.includes(`>v${pkg.version}</span>`), "badge must render formatted version string");
  assert.ok(!html.includes(">v1.3.0</span>"), "hardcoded v1.3.0 must not be present");
});

test("B3: update check repo defaults to vlv-code/PEC and honors UPDATE_CHECK_REPO env", () => {
  const systemRoutesContent = fs.readFileSync(path.join(process.cwd(), "src/routes/systemRoutes.ts"), "utf-8");
  assert.ok(
    systemRoutesContent.includes('process.env.UPDATE_CHECK_REPO || "vlv-code/PEC"'),
    "default repo must be vlv-code/PEC with UPDATE_CHECK_REPO env override"
  );
  assert.ok(!systemRoutesContent.includes("balukabalukasa/pec-proxy-corp"), "stale repo must be removed");
});

test("B1: initDashboardCredentials prints bootstrap credentials banner on fallback creation", () => {
  const origLog = console.log;
  let loggedOutput = "";
  console.log = (...args: any[]) => {
    loggedOutput += args.join(" ") + "\n";
  };

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pec-b1-test-"));
  const authPath = path.join(tempDir, "dashboard_auth.json");
  const origAuthPath = process.env.DASHBOARD_AUTH_PATH;
  const origAdminPass = process.env.ADMIN_PASSWORD;

  try {
    process.env.DASHBOARD_AUTH_PATH = authPath;
    delete process.env.ADMIN_PASSWORD;
    resetDashboardCredentialsForTest();

    const res = initDashboardCredentials({ username: "admin", autoCreate: true });
    assert.equal(res.usingFallbackPassword, true);
    assert.equal(res.setupRequired, false);

    assert.ok(loggedOutput.includes("Dashboard bootstrap credentials (shown ONCE)"), "must print bootstrap banner");
    assert.ok(loggedOutput.includes("Login:    admin"), "banner must show admin username");
    assert.ok(fs.existsSync(authPath), "auth file must be written to disk");

    // Second call with existing store should NOT print banner
    loggedOutput = "";
    const secondRes = initDashboardCredentials({ username: "admin" });
    assert.equal(secondRes.usingFallbackPassword, false);
    assert.ok(!loggedOutput.includes("Dashboard bootstrap credentials (shown ONCE)"), "second run must not re-print");
  } finally {
    console.log = origLog;
    if (origAuthPath !== undefined) process.env.DASHBOARD_AUTH_PATH = origAuthPath;
    else delete process.env.DASHBOARD_AUTH_PATH;
    if (origAdminPass !== undefined) process.env.ADMIN_PASSWORD = origAdminPass;
    else delete process.env.ADMIN_PASSWORD;
    resetDashboardCredentialsForTest();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
});
