import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BACKGROUND_TEMPLATE } from "../src/extensionTemplates.js";

test("dashboardReviewFixes: highlightStyleChip is defined and mapped to studio palette", () => {
  const dashboardJs = fs.readFileSync(path.join(process.cwd(), "public/dashboard.js"), "utf-8");
  assert.ok(dashboardJs.includes("function highlightStyleChip("), "highlightStyleChip must be defined");
  assert.ok(dashboardJs.includes("window.highlightStyleChip = highlightStyleChip;"), "highlightStyleChip must be exposed on window");
  assert.ok(dashboardJs.includes("setStudioPalette(styleToPalette[style]"), "highlightStyleChip must map to setStudioPalette");
});

test("dashboardReviewFixes: setCustomIconDataUrl defaults triggerSave to false and displays saved icons", () => {
  const dashboardJs = fs.readFileSync(path.join(process.cwd(), "public/dashboard.js"), "utf-8");
  assert.ok(
    dashboardJs.includes("function setCustomIconDataUrl(dataUrl, isUploaded = false, triggerSave = false)"),
    "setCustomIconDataUrl must default triggerSave to false to avoid unwanted POST on load"
  );
  assert.ok(
    dashboardJs.includes("setCustomIconDataUrl(cfg.customIconDataUrl, true, false)"),
    "loadBuilderConfig must set isUploaded to true and triggerSave to false for saved custom icon"
  );
});

test("dashboardReviewFixes: applyPacScript caches downloaded PAC in chrome.storage.local", () => {
  const bgJs = fs.readFileSync(path.join(process.cwd(), "extension/background.js"), "utf-8");
  assert.ok(
    bgJs.includes("chrome.storage.local.set({ pecBasePac: text })"),
    "background.js must persist pecBasePac to chrome.storage.local"
  );
  assert.ok(
    BACKGROUND_TEMPLATE.includes("chrome.storage.local.set({ pecBasePac: text })"),
    "BACKGROUND_TEMPLATE must persist pecBasePac to chrome.storage.local"
  );
});
