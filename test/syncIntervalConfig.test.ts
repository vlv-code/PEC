import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { renderDashboardHtml } from "../src/views/dashboardView.js";
import { renderBackgroundJs } from "../src/extensionTemplates.js";
import { packageExtension } from "../src/packager.js";

test("syncIntervalConfig: dashboardView renders expanded sync interval options", () => {
  const html = renderDashboardHtml();
  assert.ok(html.includes('value="1"'), "should include 1 minute option");
  assert.ok(html.includes('value="2"'), "should include 2 minutes option");
  assert.ok(html.includes('value="5"'), "should include 5 minutes option");
  assert.ok(html.includes('value="10"'), "should include 10 minutes option");
  assert.ok(html.includes('value="15"'), "should include 15 minutes option");
  assert.ok(html.includes('value="30"'), "should include 30 minutes option");
  assert.ok(html.includes('value="60"'), "should include 60 minutes option");
  assert.ok(html.includes('value="120"'), "should include 120 minutes option");
  assert.ok(html.includes('value="360"'), "should include 360 minutes option");
});

test("syncIntervalConfig: renderBackgroundJs substitutes custom sync interval", () => {
  const rendered = renderBackgroundJs({ syncIntervalMinutes: 2 });
  assert.ok(rendered.includes("const SYNC_INTERVAL_MIN = 2;"), "should substitute SYNC_INTERVAL_MIN constant");
});

test("syncIntervalConfig: packageExtension respects PEC_SYNC_INTERVAL_MIN env var", () => {
  const origEnv = process.env.PEC_SYNC_INTERVAL_MIN;
  try {
    process.env.PEC_SYNC_INTERVAL_MIN = "3";
    const res = packageExtension("http://127.0.0.1:3999");
    assert.ok(res.extensionId, "packageExtension should return build result with extensionId");

    const bgJs = fs.readFileSync(path.join(process.cwd(), "dist/unpacked/background.js"), "utf-8");
    assert.ok(bgJs.includes("const SYNC_INTERVAL_MIN = 3;"), "unpacked background.js must have SYNC_INTERVAL_MIN = 3");
  } finally {
    if (origEnv !== undefined) process.env.PEC_SYNC_INTERVAL_MIN = origEnv;
    else delete process.env.PEC_SYNC_INTERVAL_MIN;
  }
});
