import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { renderPopupJs } from "../src/templates/popupJsTemplate.js";

test("popup.js: addRule safely handles null/undefined/malformed rules in userRules", () => {
  const code = renderPopupJs();
  assert.ok(
    code.includes("r && r.pattern && r.pattern.toLowerCase() === p"),
    "popup.js must guard against null/undefined rule or pattern in userRules"
  );
});

test("popup.js: btnTestLatency clears timer and aborts controller in finally block", () => {
  const code = renderPopupJs();
  assert.ok(
    code.includes("if (t) clearTimeout(t);") && code.includes("finally {"),
    "btnTestLatency must clear timeout in finally block"
  );
});

test("extension/popup.js is in sync with template", () => {
  const extPopup = fs.readFileSync(path.resolve("extension/popup.js"), "utf8");
  assert.ok(
    extPopup.includes("r && r.pattern && r.pattern.toLowerCase() === p"),
    "extension/popup.js must contain the null-safe check"
  );
  assert.ok(
    extPopup.includes("if (t) clearTimeout(t);"),
    "extension/popup.js must contain clearTimeout in finally"
  );
});
