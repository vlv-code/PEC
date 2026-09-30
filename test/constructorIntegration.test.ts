import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildExtensionFiles, saveBuildConfig, getBuildConfig } from "../src/packager.js";
import { ExtensionBuildConfig } from "../src/types.js";

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

