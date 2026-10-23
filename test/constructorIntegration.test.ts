import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildExtensionFiles, saveBuildConfig, getBuildConfig, generateExtensionFiles, parseDataUrlBuffer } from "../src/packager.js";
import { ExtensionBuildConfig } from "../src/types.js";
import { renderDashboardHtml } from "../src/views/dashboardView.js";

test("packager accepts uiLayout, colorPalette, and defaultThemeMode and renders into popup", async () => {
  const cfg: ExtensionBuildConfig = {
    name: "Corporate Proxy",
    shortName: "CorpProxy",
    version: "1.4.0",
    serverUrl: "https://proxyex.ic-iskra.ru",
    token: "fleet-secret-123",
    uiLayout: "terminal",
    colorPalette: "emerald",
    defaultThemeMode: "light",
  };

  const files = await buildExtensionFiles(cfg);
  const popupHtml = files["popup.html"];
  assert.ok(popupHtml);
  assert.ok(popupHtml.includes('data-palette="emerald"'));
  assert.ok(popupHtml.includes('data-layout="terminal"'));
  assert.ok(popupHtml.includes('data-theme="light"'));
});

test("packager falls back to default layout, palette, and theme mode when omitted", async () => {
  const cfg: ExtensionBuildConfig = {
    name: "Default Config Proxy",
    shortName: "DefProxy",
    version: "1.4.0",
  };

  const files = await buildExtensionFiles(cfg);
  const popupHtml = files["popup.html"];
  assert.ok(popupHtml);
  assert.ok(popupHtml.includes('data-palette="cyber"'));
  assert.ok(popupHtml.includes('data-layout="console"'));
  assert.ok(popupHtml.includes('data-theme="dark"'));
});

test("packager supports all 5 color palettes and both layouts", async () => {
  const palettes = ["cyber", "obsidian", "nord", "emerald", "light"] as const;
  const layouts = ["console", "terminal"] as const;

  for (const pal of palettes) {
    for (const lay of layouts) {
      const files = await buildExtensionFiles({
        name: `Test ${pal} ${lay}`,
        shortName: "Test",
        version: "1.0.0",
        colorPalette: pal,
        uiLayout: lay,
        defaultThemeMode: "dark",
      });
      const html = files["popup.html"];
      assert.ok(html.includes(`data-palette="${pal}"`));
      assert.ok(html.includes(`data-layout="${lay}"`));
    }
  }
});

test("saveBuildConfig round-trips uiLayout, colorPalette, and defaultThemeMode", () => {
  saveBuildConfig({
    uiLayout: "terminal",
    colorPalette: "nord",
    defaultThemeMode: "light",
  });

  const updated = getBuildConfig();
  assert.equal(updated.uiLayout, "terminal");
  assert.equal(updated.colorPalette, "nord");
  assert.equal(updated.defaultThemeMode, "light");
});

test("dashboard.css configures .popup-frame-box with flexible fit-content width and smooth transitions", () => {
  const css = fs.readFileSync(path.resolve(process.cwd(), "public/dashboard.css"), "utf-8");
  assert.match(css, /\.popup-frame-box\s*\{[^}]*width:\s*fit-content/);
  assert.match(css, /\.popup-frame-box\s*\{[^}]*max-width:\s*100%/);
  assert.match(css, /\.popup-frame-box\s*\{[^}]*transition:\s*width\s+0\.2s\s+ease,\s*height\s+0\.2s\s+ease/);
  assert.match(css, /\.popup-frame-box\s+iframe\s*\{[^}]*width:\s*380px/);
  assert.match(css, /\.popup-frame-box\s+iframe\s*\{[^}]*height:\s*580px/);
});

test("dashboard.js mockScript includes full chrome.storage.local mock with get/set", () => {
  const js = fs.readFileSync(path.resolve(process.cwd(), "public/dashboard.js"), "utf-8");
  assert.ok(js.includes("storage: {") || js.includes("storage:{"));
  assert.ok(js.includes("__simStorage"));
  assert.ok(js.includes("pecUserRules"));
});

test("dashboard.js mockScript includes chrome.tabs mock", () => {
  const js = fs.readFileSync(path.resolve(process.cwd(), "public/dashboard.js"), "utf-8");
  assert.ok(js.includes("tabs: {") || js.includes("tabs:{"));
  assert.ok(js.includes("query: function"));
});

test("dashboard.js mockScript supports SET_ENABLED, SAVE_USER_RULES, and GET_USER_RULES with action and type", () => {
  const js = fs.readFileSync(path.resolve(process.cwd(), "public/dashboard.js"), "utf-8");
  assert.ok(js.includes("SET_ENABLED"));
  assert.ok(js.includes("SAVE_USER_RULES"));
  assert.ok(js.includes("GET_USER_RULES"));
  assert.ok(js.includes("BYPASS_TOGGLE"));
  assert.ok(js.includes("GET_LOGS"));
});

test("dashboard.js handles PREVIEW_RESIZE with both width and height", () => {
  const js = fs.readFileSync(path.resolve(process.cwd(), "public/dashboard.js"), "utf-8");
  assert.ok(js.includes("__postPreviewSize"));
  assert.ok(js.includes("PREVIEW_RESIZE"));
  assert.match(js, /pf\.style\.width\s*=\s*Math\.max\(380,\s*Math\.min\(600/);
  assert.match(js, /pf\.style\.height\s*=\s*Math\.max\(180,\s*Math\.min\(850/);
});

test("Extension Studio provides popup and stealth modes without kiosk", () => {
  const html = renderDashboardHtml({});
  assert.match(html, /Обычный режим/);
  assert.match(html, /Скрытый агент/);
  assert.doesNotMatch(html, /Режим киоска/i);
  assert.doesNotMatch(html, /Kiosk \/ Restricted/i);
});

test("generateExtensionFiles always generates popup.html and popup.js in memory even in stealth mode", () => {
  const files = generateExtensionFiles({
    name: "Test Ext",
    shortName: "Test",
    version: "1.0.0",
    serverUrl: "https://proxy.example.com",
    uiMode: "stealth"
  });

  assert.ok(files, "generateExtensionFiles returns an object with files");
  assert.ok(files["popup.html"], "popup.html is present in memory for preview");
  assert.ok(files["popup.js"], "popup.js is present in memory for preview");
});

test("generateExtensionFiles omits action from manifest in stealth mode", () => {
  const files = generateExtensionFiles({
    name: "Stealth Ext",
    shortName: "Stealth",
    version: "1.0.0",
    uiMode: "stealth"
  });
  const manifest = JSON.parse(files["manifest.json"] as string);
  assert.equal(manifest.action, undefined, "manifest.action must be omitted in stealth mode");
});

test("generateExtensionFiles generates icon files from customIconDataUrl or emoji", () => {
  const sampleDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const filesWithCustom = generateExtensionFiles({
    name: "Custom Icon Ext",
    shortName: "Custom",
    version: "1.0.0",
    customIconDataUrl: sampleDataUrl,
  });

  assert.ok(filesWithCustom["icon16.png"], "icon16.png is generated");
  assert.ok(filesWithCustom["icon48.png"], "icon48.png is generated");
  assert.ok(filesWithCustom["icon128.png"], "icon128.png is generated");
  assert.ok(filesWithCustom["icon.png"], "icon.png is generated");
});

test("parseDataUrlBuffer returns null for empty, blank, or invalid base64 data URLs", () => {
  assert.equal(parseDataUrlBuffer(""), null);
  assert.equal(parseDataUrlBuffer(undefined), null);
  assert.equal(parseDataUrlBuffer("data:image/png;base64,"), null);
  assert.equal(parseDataUrlBuffer("not-a-data-url"), null);
});

test("generateExtensionFiles escapes customIconDataUrl in SVG preview to prevent attribute injection", () => {
  const maliciousDataUrl = 'data:image/png;base64,abc" onmouseover="alert(1)"';
  const files = generateExtensionFiles({
    name: "Injection Test",
    shortName: "Inject",
    version: "1.0.0",
    customIconDataUrl: maliciousDataUrl,
  });

  const svg = files["icon.svg"] as string;
  assert.ok(svg.includes("&quot;"), "quotes must be escaped in SVG href");
  assert.doesNotMatch(svg, /href="[^"]*"[^>]*onmouseover/);
});

test("dashboard.js applyUiModePreset accepts triggerSave parameter to avoid extraneous save on initial load", () => {
  const js = fs.readFileSync(path.resolve(process.cwd(), "public/dashboard.js"), "utf-8");
  assert.match(js, /function\s+applyUiModePreset\s*\(\s*mode\s*,\s*triggerSave\s*=\s*true\s*\)/);
  assert.match(js, /highlightTemplateChip\s*\(\s*cfg\.uiMode\s*,\s*false\s*\)/);
});



