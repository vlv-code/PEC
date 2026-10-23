import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import { renderDashboardHtml } from "../src/views/dashboardView.js";

test("dashboard: App Studio tab exists and is positioned next to Extension Studio", () => {
  const html = renderDashboardHtml({});

  // 1. Tab button exists with proper switchTab handler
  assert.match(
    html,
    /<button[^>]+id="tabBtnAppStudio"[^>]*class="tab-btn"[^>]*onclick="switchTab\('app-studio'\)"/
  );

  // 2. Positioned immediately next to tabBtnBuilder
  const builderIdx = html.indexOf('id="tabBtnBuilder"');
  const appStudioIdx = html.indexOf('id="tabBtnAppStudio"');
  assert.ok(builderIdx !== -1, "tabBtnBuilder must exist");
  assert.ok(appStudioIdx !== -1, "tabBtnAppStudio must exist");
  // Ensure no other tab button is between them
  const builderEnd = html.indexOf("</button>", builderIdx);
  const between = html.slice(builderEnd + 9, appStudioIdx);
  assert.ok(!between.includes('class="tab-btn"'), "No other tab between Builder and App Studio");
});

test("dashboard: App Studio view container and inputs exist", () => {
  const html = renderDashboardHtml({});

  // Tab pane & main container
  assert.match(html, /<div[^>]+id="tab-app-studio"[^>]*class="tab-pane"/);
  assert.match(html, /id="viewAppStudio"/);

  // Settings form elements
  const requiredIds = [
    "appBuildName",
    "appBuildShortName",
    "appBuildVersion",
    "appBuildDescription",
    "appPresetStyle",
    "appThemeColor",
    "appThemeBackground",
    "appThemeCard",
    "appProcessRulesTable",
    "btnAppSaveConfig",
    "btnAppBuildBinaries",
    "btnAppBuild",
    "btnAppDownloadZip",
    "btnAppDownloadTar",
    "btnAppDownloadPs1",
    "btnAppDownloadVerifyPs1",
  ];

  for (const id of requiredIds) {
    assert.ok(html.includes(`id="${id}"`), `Element with id "${id}" must exist in dashboard HTML`);
  }
});

test("dashboard: App Studio desktop live preview elements exist", () => {
  const html = renderDashboardHtml({});

  const previewIds = [
    "appPreviewContainer",
    "appPreviewWindow",
    "appPreviewTitle",
    "appPreviewStatusDot",
  ];

  for (const id of previewIds) {
    assert.ok(html.includes(`id="${id}"`), `Preview element with id "${id}" must exist in dashboard HTML`);
  }
});

test("dashboard: Element IDs remain globally unique with App Studio included", () => {
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
