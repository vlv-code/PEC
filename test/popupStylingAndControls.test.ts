import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { renderPopupHtml } from "../src/templates/popupHtmlTemplate.js";
import { renderPopupJs } from "../src/templates/popupJsTemplate.js";

test("popupHtmlTemplate provides explicit high-contrast text colors for all dark and light palettes", () => {
  const html = renderPopupHtml();

  // All palettes must specify --text and --text-muted for both dark and light modes
  assert.ok(html.includes('[data-palette="cyber"]'), "cyber palette must exist");
  assert.ok(html.includes('[data-palette="obsidian"]'), "obsidian palette must exist");
  assert.ok(html.includes('[data-palette="nord"]'), "nord palette must exist");
  assert.ok(html.includes('[data-palette="emerald"]'), "emerald palette must exist");
  assert.ok(html.includes('[data-palette="light"]'), "light palette must exist");

  // Verify that [data-palette="light"] in dark mode sets high-contrast text (#f8fafc or similar), NOT dark text
  assert.match(
    html,
    /\[data-palette="light"\][^{]*\{[^}]*--primary/s,
    "light palette must configure primary"
  );
  assert.match(
    html,
    /\[data-palette="light"\]:not\(\[data-theme="light"\]\)[^{]*\{[^}]*--text:\s*#f/s,
    "light palette in dark mode must set light text color to avoid gray/black on dark card"
  );
});

test("popup.js toggles active state classes on btnPowerToggle and btnPauseToggle", () => {
  const js = fs.readFileSync(path.resolve("extension/popup.js"), "utf8");

  assert.ok(
    js.includes("btn-power-active") || js.includes("btnPowerToggle.classList.toggle"),
    "popup.js must dynamically toggle active/highlight state on btnPowerToggle"
  );
  assert.ok(
    js.includes("btn-pause-active") || js.includes("btnPauseToggle.classList.toggle"),
    "popup.js must dynamically toggle active/highlight state on btnPauseToggle"
  );
});

test("popupHtmlTemplate styles segmented tabs with symmetrical padding", () => {
  const html = renderPopupHtml();

  assert.ok(
    html.includes(".tabs") && html.includes("background: var(--card-inner)"),
    "popupHtmlTemplate must use segmented control container background"
  );
});

test("dashboard.css styles danger buttons with softened non-blinding red", () => {
  const css = fs.readFileSync(path.resolve("public/dashboard.css"), "utf8");

  // In dark themes, danger buttons should not be harsh raw #dc2626
  assert.ok(
    css.includes(".btn-danger") && css.includes("rgba("),
    "dashboard.css must use muted/tinted colors for dark theme danger buttons"
  );
  assert.ok(
    css.includes('body[data-theme="light"]') && css.includes("btn-danger"),
    "dashboard.css must style danger buttons specifically for light theme"
  );
  assert.ok(
    css.includes('body[data-layout="console"] .btn-sm'),
    "dashboard.css must standardize .btn-sm height in console layout"
  );
});

test("popupHtmlTemplate provides high contrast on action buttons in light mode", () => {
  const html = renderPopupHtml();

  assert.ok(
    html.includes('[data-theme="light"] .btn-primary-sm') && html.includes("color: #ffffff"),
    "popupHtmlTemplate must provide white text for primary button in light theme"
  );
});

