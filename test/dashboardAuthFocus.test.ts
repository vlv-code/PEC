import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { renderDashboardHtml } from "../src/views/dashboardView.js";

test("login focus bug: public/dashboard.js manages background timers safely and prevents focus stealing", () => {
  const js = fs.readFileSync(path.resolve("public/dashboard.js"), "utf8");

  // 1. Must define a way to stop dashboard timers so polling does not continue when logged out
  assert.ok(
    js.includes("stopDashboardTimers") || js.includes("stopTimers"),
    "dashboard.js must define stopDashboardTimers to clean up background intervals"
  );

  // 2. Both loadInstances and fetchStatus timers must be tracked and clearable
  assert.ok(
    js.includes("pecTimerInstances") || js.includes("pecTimers"),
    "dashboard.js must track background timer handles"
  );

  // 3. logoutDashboard must stop timers
  const logoutIdx = js.indexOf("async function logoutDashboard");
  assert.ok(logoutIdx !== -1, "logoutDashboard must be defined");
  const logoutBody = js.slice(logoutIdx, logoutIdx + 400);
  assert.ok(
    logoutBody.includes("stopDashboardTimers") || logoutBody.includes("clearInterval"),
    "logoutDashboard must stop/clear background timers"
  );

  // 4. adminFetch on 401 must stop timers and avoid re-triggering showAuthStep if already visible
  const adminFetchIdx = js.indexOf("async function adminFetch");
  assert.ok(adminFetchIdx !== -1, "adminFetch must be defined");
  const adminFetchBody = js.slice(adminFetchIdx, adminFetchIdx + 600);
  assert.ok(
    adminFetchBody.includes("stopDashboardTimers") || adminFetchBody.includes("clearInterval"),
    "adminFetch must stop timers when receiving 401"
  );

  // 5. showAuthStep must NOT steal focus if user is already focused on an element inside authScreen
  const showAuthStepIdx = js.indexOf("function showAuthStep");
  assert.ok(showAuthStepIdx !== -1, "showAuthStep must be defined");
  const showAuthStepBody = js.slice(showAuthStepIdx, showAuthStepIdx + 1200);
  assert.ok(
    showAuthStepBody.includes("activeElement") || showAuthStepBody.includes("alreadyFocused") || showAuthStepBody.includes("contains(document.activeElement)"),
    "showAuthStep must check document.activeElement before moving focus to prevent stealing focus while typing password"
  );
});

test("login labels: renderDashboardHtml associates labels with input IDs via 'for' attribute", () => {
  const html = renderDashboardHtml({});
  assert.ok(
    html.includes('for="loginUsernameInput"'),
    "username label must have for='loginUsernameInput'"
  );
  assert.ok(
    html.includes('for="loginTokenInput"'),
    "password label must have for='loginTokenInput'"
  );
});
