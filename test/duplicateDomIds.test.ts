import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import { renderDashboardHtml } from "../src/views/dashboardView.js";

test("Dashboard HTML has no duplicate element IDs", () => {
  const html = renderDashboardHtml({});
  const idRegex = /\sid="([^"]+)"/g;
  const ids: string[] = [];
  let match;
  while ((match = idRegex.exec(html)) !== null) {
    ids.push(match[1]);
  }

  const counts: Record<string, number> = {};
  const duplicates: string[] = [];
  for (const id of ids) {
    counts[id] = (counts[id] || 0) + 1;
    if (counts[id] === 2) {
      duplicates.push(id);
    }
  }

  assert.deepStrictEqual(
    duplicates,
    [],
    `Found duplicate DOM IDs in dashboard HTML: ${duplicates.join(", ")}`
  );
});

test("Devices tab navigation button has distinct id tabBtnInstances, not tab-instances", () => {
  const html = renderDashboardHtml({});
  // Button must be tabBtnInstances
  assert.match(html, /<button[^>]+id="tabBtnInstances"[^>]*class="tab-btn"[^>]*onclick="switchTab\('instances'\)"/);
  // Pane must be tab-instances
  assert.match(html, /<div[^>]+id="tab-instances"[^>]*class="tab-pane"/);
});
