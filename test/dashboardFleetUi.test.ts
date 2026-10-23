import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { renderDashboardHtml } from "../src/views/dashboardView.js";

test("Task 4: Fleet table includes Proxy Server column and dashboard.js handles assignment", () => {
  const html = renderDashboardHtml();
  assert.ok(html.includes("Прокси-сервер") || html.includes("Прокси-нода"), "table header must include Proxy column");

  const js = fs.readFileSync(path.resolve("public/dashboard.js"), "utf8");
  assert.ok(js.includes("/api/instances/assign-proxy"), "dashboard.js must post to /api/instances/assign-proxy");
  assert.ok(js.includes("select-instance-proxy"), "dashboard.js must bind select-instance-proxy");
});
