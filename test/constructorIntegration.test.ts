import test from "node:test";
import assert from "node:assert/strict";
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
