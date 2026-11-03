import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { renderDashboardHtml } from "../src/views/dashboardView.js";

const CSS_PATH = path.resolve("./public/dashboard.css");
const JS_PATH = path.resolve("./public/dashboard.js");

test("D-THEME-01: public/dashboard.css gives obsidian purple primary color", () => {
  const css = fs.readFileSync(CSS_PATH, "utf-8");
  
  // Verify body[data-theme="obsidian"] primary accent is purple, not blue (#58a6ff)
  const obsidianMatch = css.match(/body\[data-theme=["']obsidian["']\]\s*\{([^}]+)\}/);
  assert.ok(obsidianMatch, "body[data-theme='obsidian'] must exist in dashboard.css");
  const block = obsidianMatch[1];
  assert.match(block, /--primary:\s*#c084fc;/, "obsidian primary must be purple (#c084fc)");
  assert.match(block, /--primary-rgb:\s*192,\s*132,\s*252;/, "obsidian primary-rgb must be 192, 132, 252");
});

test("D-THEME-02: public/dashboard.css styles terminal layout cleanly in light mode", () => {
  const css = fs.readFileSync(CSS_PATH, "utf-8");
  
  assert.ok(css.includes('body[data-theme-mode="light"][data-layout="terminal"] .card'), "Must contain light mode terminal card styling");
  assert.ok(css.includes('body[data-theme-mode="light"][data-layout="terminal"] .preset-card'), "Must contain light mode terminal preset-card styling");
  assert.ok(css.includes('body[data-theme-mode="light"][data-layout="terminal"] input'), "Must contain light mode terminal input styling");
  assert.ok(css.includes(':not(.popover-layout-btn)'), "Must exclude popover-layout-btn from global white text");
});

test("D-POPOVER-01: public/dashboard.js closes version popover on outside click and Escape", () => {
  const js = fs.readFileSync(JS_PATH, "utf-8");
  const html = renderDashboardHtml({});

  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: "http://localhost:3000/dashboard",
  });
  const { window } = dom;

  // Execute dashboard.js in dom window
  window.eval(js);

  const popover = window.document.getElementById("popoverVersionRelease");
  const badge = window.document.getElementById("versionReleaseBadge");
  assert.ok(popover, "popoverVersionRelease must exist");
  assert.ok(badge, "versionReleaseBadge must exist");

  // Initial state is hidden
  assert.equal(popover.style.display, "none");

  // Open via toggleVersionPopover
  window.toggleVersionPopover();
  assert.equal(popover.style.display, "block", "Popover should open on toggle");

  // Click outside (e.g. on body)
  const outsideClick = new window.MouseEvent("click", { bubbles: true, cancelable: true });
  window.document.body.dispatchEvent(outsideClick);
  assert.equal(popover.style.display, "none", "Popover should close on click outside");

  // Open again
  window.toggleVersionPopover();
  assert.equal(popover.style.display, "block", "Popover should open again");

  // Press Escape
  const escEvent = new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true });
  window.document.dispatchEvent(escEvent);
  assert.equal(popover.style.display, "none", "Popover should close on Escape");
});
