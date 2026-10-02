import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { renderPopupHtml } from "../src/templates/popupHtmlTemplate.js";

test("popupHtmlTemplate distinguishes console (rounded, soft) from terminal (sharp, 0px)", () => {
  const html = renderPopupHtml();
  
  // Console must have rounded corners, NOT border-radius: 0
  assert.ok(
    !html.includes('[data-layout="console"],') && !html.includes('[data-layout="console"] *,'),
    "Console layout must not be grouped into 0px terminal reset"
  );

  assert.ok(
    html.includes('[data-layout="console"] .card') &&
    html.includes('[data-layout="terminal"] .card'),
    "HTML must contain separate rules for console and terminal cards"
  );

  assert.match(
    html,
    /\[data-layout="terminal"\][^{]*\{[^}]*border-radius:\s*0\s*!important/s,
    "Terminal layout must enforce 0px border-radius"
  );

  assert.match(
    html,
    /\[data-layout="console"\]\s*\.card\s*\{[^}]*border-radius:\s*10px/s,
    "Console layout must have 10px rounded cards"
  );
});

test("dashboard.css gives console soft rounded corners (8px/6px) and terminal sharp corners (0px)", () => {
  const css = fs.readFileSync(path.resolve("public/dashboard.css"), "utf8");

  assert.match(
    css,
    /body\[data-layout="console"\]\s*\.card\s*\{[^}]*border-radius:\s*10px/s,
    "dashboard.css must style console cards with 10px rounded corners"
  );

  assert.match(
    css,
    /body\[data-layout="terminal"\]\s*\*\s*\{[^}]*border-radius:\s*0px\s*!important/s,
    "dashboard.css must keep terminal sharp with 0px"
  );
});
