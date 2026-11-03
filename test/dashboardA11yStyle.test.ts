import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { renderPopupHtml } from "../src/templates/popupHtmlTemplate.js";

test("CSS Architecture & A11y: dashboard.css contains contract responsive grids", () => {
  const css = fs.readFileSync(path.resolve("public/dashboard.css"), "utf8");

  const requiredClasses = [
    ".grid-routing-matrix-header",
    ".grid-routing-rule-form",
    ".grid-builder-columns",
    ".grid-form-2col",
    ".grid-form-3col",
    ".grid-preview-traffic-row",
  ];

  for (const cls of requiredClasses) {
    assert.ok(
      css.includes(cls),
      `dashboard.css must declare contract grid class: ${cls}`
    );
  }

  // Check specific column templates
  assert.match(
    css,
    /\.grid-routing-matrix-header\s*\{[^}]*grid-template-columns:\s*2fr 1fr 1fr/s,
    "grid-routing-matrix-header must have 2fr 1fr 1fr template"
  );
  assert.match(
    css,
    /\.grid-routing-rule-form\s*\{[^}]*grid-template-columns:\s*2fr 3fr 1fr auto/s,
    "grid-routing-rule-form must have 2fr 3fr 1fr auto template"
  );
  assert.match(
    css,
    /\.grid-builder-columns\s*\{[^}]*grid-template-columns:\s*1\.25fr 1fr/s,
    "grid-builder-columns must have 1.25fr 1fr template"
  );
  assert.match(
    css,
    /\.grid-form-2col\s*\{[^}]*grid-template-columns:\s*1fr 1fr/s,
    "grid-form-2col must have 1fr 1fr template"
  );
  assert.match(
    css,
    /\.grid-form-3col\s*\{[^}]*grid-template-columns:\s*1fr 1fr 1fr/s,
    "grid-form-3col must have 1fr 1fr 1fr template"
  );
  assert.match(
    css,
    /\.grid-preview-traffic-row\s*\{[^}]*grid-template-columns:\s*50px 70px 1fr 50px/s,
    "grid-preview-traffic-row must have 50px 70px 1fr 50px template"
  );
});

test("CSS Architecture & A11y: dashboard.css implements required media breakpoints (768px, 1024px, 1280px)", () => {
  const css = fs.readFileSync(path.resolve("public/dashboard.css"), "utf8");

  assert.ok(
    css.includes("@media (max-width: 1280px)") || css.includes("@media(max-width: 1280px)"),
    "dashboard.css must include 1280px breakpoint"
  );
  assert.ok(
    css.includes(".table-responsive-wrapper"),
    "dashboard.css must include .table-responsive-wrapper class"
  );
  assert.match(
    css,
    /\.table-responsive-wrapper\s*\{[^}]*overflow-x:\s*auto/s,
    "table-responsive-wrapper must provide horizontal scroll with overflow-x: auto"
  );

  assert.ok(
    css.includes("@media (max-width: 1024px)") || css.includes("@media(max-width: 1024px)"),
    "dashboard.css must include 1024px breakpoint"
  );
  assert.match(
    css,
    /@media\s*\(\s*max-width:\s*1024px\s*\)\s*\{[^}]*\.grid-builder-columns\s*\{[^}]*grid-template-columns:\s*1fr/s,
    "1024px breakpoint must collapse .grid-builder-columns into single column"
  );

  assert.ok(
    css.includes("@media (max-width: 768px)") || css.includes("@media(max-width: 768px)"),
    "dashboard.css must include 768px breakpoint"
  );
  assert.match(
    css,
    /@media\s*\(\s*max-width:\s*768px\s*\)\s*\{[^}]*grid-template-columns:\s*1fr/s,
    "768px breakpoint must collapse multi-column grids into single column"
  );
});

test("CSS Architecture & A11y: dashboard.css implements global focus-visible accessibility", () => {
  const css = fs.readFileSync(path.resolve("public/dashboard.css"), "utf8");

  assert.ok(
    css.includes("button:focus-visible"),
    "dashboard.css must style button:focus-visible"
  );
  assert.ok(
    css.includes(".btn:focus-visible"),
    "dashboard.css must style .btn:focus-visible"
  );
  assert.ok(
    css.includes(".tab-btn:focus-visible"),
    "dashboard.css must style .tab-btn:focus-visible"
  );
  assert.ok(
    css.includes(".btn-icon:focus-visible"),
    "dashboard.css must style .btn-icon:focus-visible"
  );
  assert.ok(
    css.includes("outline: 2px solid var(--primary)") || css.includes("outline:2px solid var(--primary)"),
    "focus-visible must provide clear outline with 2px solid var(--primary)"
  );
  assert.ok(
    css.includes("outline-offset: 2px"),
    "focus-visible must have outline-offset: 2px"
  );
});

test("CSS Architecture & A11y: Light theme buttons maintain white text contrast on var(--primary)", () => {
  const css = fs.readFileSync(path.resolve("public/dashboard.css"), "utf8");

  // In light theme mode, primary/base action buttons must have white text #ffffff to ensure WCAG AA contrast against primary background
  assert.match(
    css,
    /body\[data-theme-mode="light"\][^{]*button:not\(\.btn-secondary\)[^{]*\{[^}]*color:\s*#ffffff\s*!important/s,
    "dashboard.css must ensure base buttons on var(--primary) get #ffffff text in light theme"
  );
  assert.match(
    css,
    /body\[data-theme-mode="light"\][^{]*\.btn:not\(\.btn-secondary\)[^{]*\{[^}]*color:\s*#ffffff\s*!important/s,
    "dashboard.css must ensure base .btn elements get #ffffff text in light theme"
  );
});

test("CSS Architecture & A11y: Extension popup implements :focus-visible rules for key controls", () => {
  const popupHtml = fs.readFileSync(path.resolve("extension/popup.html"), "utf8");
  const templateHtml = renderPopupHtml();

  for (const [sourceName, content] of [["extension/popup.html", popupHtml], ["popupHtmlTemplate.ts", templateHtml]]) {
    assert.ok(
      content.includes(".btn-action:focus-visible") || content.includes(".btn-action:focus"),
      `${sourceName} must include focus-visible style for .btn-action`
    );
    assert.ok(
      content.includes(".btn-icon-minimal:focus-visible") || content.includes(".btn-icon-minimal:focus"),
      `${sourceName} must include focus-visible style for .btn-icon-minimal`
    );
    assert.ok(
      content.includes(".btn-primary-sm:focus-visible") || content.includes(".btn-primary-sm:focus"),
      `${sourceName} must include focus-visible style for .btn-primary-sm`
    );
    assert.ok(
      content.includes(".tab-btn:focus-visible") || content.includes(".tab-btn:focus"),
      `${sourceName} must include focus-visible style for .tab-btn`
    );
    assert.ok(
      content.includes(".btn-theme-toggle:focus-visible") || content.includes(".btn-theme-toggle:focus"),
      `${sourceName} must include focus-visible style for .btn-theme-toggle`
    );
  }
});
