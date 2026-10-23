import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EXTENSION_STYLES_MAP, getThemeStyles } from "../src/packager.js";
import { renderPopupHtml } from "../src/templates/popupHtmlTemplate.js";

test("Style Audit: sunset-amber preset has genuine warm amber tones (P2.2)", () => {
  const amber = EXTENSION_STYLES_MAP["sunset-amber"];
  assert.ok(amber, "sunset-amber must exist in EXTENSION_STYLES_MAP");
  assert.equal(amber.primary, "#f59e0b", "primary must be amber #f59e0b");
  assert.equal(amber.bg, "#1c1307", "bg must be deep warm #1c1307, not Nord blue");
  assert.equal(amber.card, "#261805", "card must be warm brown #261805");
  assert.equal(amber.border, "#78350f", "border must be amber border #78350f");
  assert.equal(amber.text, "#fef3c7", "text must be warm light amber #fef3c7");

  // Verify getThemeStyles resolves amber palette and preset
  const resolvedPreset = getThemeStyles({ presetStyle: "sunset-amber" });
  assert.equal(resolvedPreset.primary, "#f59e0b");
  assert.equal(resolvedPreset.bg, "#1c1307");

  const resolvedPalette = getThemeStyles({ colorPalette: "amber" });
  assert.equal(resolvedPalette.primary, "#f59e0b");
  assert.equal(resolvedPalette.bg, "#1c1307");
});

test("Style Audit: popup custom color cascade and dynamic rgb calculation (P2.1)", () => {
  const html = renderPopupHtml({
    themeColor: "#ff0055",
    themeBackground: "#110022",
    themeCard: "#220033",
  });

  // Dynamic --primary-rgb calculation
  assert.ok(
    html.includes("--primary-rgb: 255, 0, 85"),
    "Popup HTML must calculate correct --primary-rgb for #ff0055"
  );

  // High-specificity cascade override for body[data-palette], body[data-theme]
  assert.ok(
    html.includes("body[data-palette], body[data-theme] {"),
    "Custom override block for body[data-palette], body[data-theme] must exist"
  );
  assert.ok(
    html.includes("--primary: #ff0055 !important;"),
    "Custom themeColor must be marked !important"
  );
  assert.ok(
    html.includes("--bg: #110022 !important;"),
    "Custom themeBackground must be marked !important"
  );
  assert.ok(
    html.includes("--card: #220033 !important;"),
    "Custom themeCard must be marked !important"
  );

  // Sixth palette: [data-palette="amber"]
  assert.ok(
    html.includes('[data-palette="amber"]'),
    "Popup HTML must include [data-palette=\"amber\"] styles"
  );
});

test("Style Audit: Light theme CSS icon inversion for monochrome icons (P1.1)", () => {
  const css = fs.readFileSync(path.resolve("public/dashboard.css"), "utf8");
  assert.ok(
    css.includes('body[data-theme="light"] img.icon-inline:not([src*="status-"])'),
    "dashboard.css must include invert filter rule for light theme inline icons"
  );
  assert.ok(
    css.includes("filter: invert(0.85);"),
    "Invert filter rule must be at least 0.85 intensity"
  );
});

test("Style Audit: Desktop native client ImGui themes and layout geometry (P1.2, P1.4, P2.3)", () => {
  const header = fs.readFileSync(path.resolve("client/Windows/gui/pec_imgui_theme.h"), "utf8");

  // P1.2 & P1.4: Presets & COLORREF overrides
  assert.ok(
    header.includes('preset == "sunset-amber" || preset == "amber"'),
    "pec_imgui_theme.h must contain sunset-amber preset"
  );
  assert.ok(
    header.includes('preset == "emerald-sentinel"'),
    "pec_imgui_theme.h must alias emerald-sentinel"
  );
  assert.ok(
    header.includes('preset == "minimal-light"'),
    "pec_imgui_theme.h must alias minimal-light"
  );
  assert.ok(
    header.includes("PecTheme::HoverAccent"),
    "pec_imgui_theme.h must calculate HoverAccent dynamically from PrimaryAccent"
  );

  // P2.3: Layout geometry
  assert.ok(
    header.includes('layout == "terminal" || layout == "sharp"'),
    "pec_imgui_theme.h must check for terminal or sharp layout"
  );
  assert.ok(
    header.includes("style.WindowRounding    = 0.0f;"),
    "pec_imgui_theme.h must set 0.0f rounding for terminal/sharp layout"
  );

  // C Profile parser
  const profH = fs.readFileSync(path.resolve("client/Windows/gui/profile/profile.h"), "utf8");
  assert.match(
    profH,
    /wchar_t\s+layout\[32\];/,
    "profile.h must declare layout in PBTheme"
  );

  const profC = fs.readFileSync(path.resolve("client/Windows/gui/profile/profile.c"), "utf8");
  assert.ok(
    profC.includes('json_str(th, "layout"') || profC.includes("p->theme.layout"),
    "profile.c must parse and store theme layout"
  );
});

test("Style Audit: Dashboard App Studio presets and hygiene (P3.1)", () => {
  const js = fs.readFileSync(path.resolve("public/dashboard.js"), "utf8");
  assert.ok(
    js.includes("APP_THEME_PRESETS['amber'] = APP_THEME_PRESETS['sunset-amber'];"),
    "dashboard.js must provide amber alias for APP_THEME_PRESETS"
  );
  assert.ok(
    js.includes("'sunset-amber': 'amber'"),
    "dashboard.js must map sunset-amber style preset to amber palette"
  );
  assert.ok(
    js.includes("const bgEl = document.getElementById('bldThemeBg')"),
    "dashboard.js getEmojiIconDataUrl must read custom/theme background"
  );

  // Hygiene in dashboardView.ts
  const view = fs.readFileSync(path.resolve("src/views/dashboardView.ts"), "utf8");
  assert.ok(
    !view.includes('<div id="loginModal" style="display: none;"></div>'),
    "dashboardView.ts must not contain empty dead #loginModal div"
  );
});
