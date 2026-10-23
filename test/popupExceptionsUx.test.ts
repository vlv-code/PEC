import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("popup.js: quick add site does not duplicate domain into inputPattern", () => {
  const js = fs.readFileSync(path.resolve("extension/popup.js"), "utf8");

  const match = js.match(/btnAddCurrentSite\.addEventListener\("click",\s*\(\)\s*=>\s*\{([\s\S]*?)\}\);/);
  assert.ok(match, "quick add click listener must exist");
  assert.ok(
    !match[1].includes("inputPattern.value = currentDomain"),
    "quick add must not write domain to inputPattern.value"
  );
  assert.ok(
    match[1].includes('inputPattern.value = ""'),
    "quick add must clear inputPattern.value"
  );
});

test("popup.html & popup.js: copy user exceptions button exists and binds copy action", () => {
  const html = fs.readFileSync(path.resolve("extension/popup.html"), "utf8");
  const js = fs.readFileSync(path.resolve("extension/popup.js"), "utf8");

  assert.ok(html.includes('id="btnCopyUserExceptions"'), "popup.html must have btnCopyUserExceptions");
  assert.ok(js.includes("btnCopyUserExceptions"), "popup.js must reference btnCopyUserExceptions");
  assert.ok(js.includes("navigator.clipboard.writeText"), "popup.js must copy to clipboard");
  assert.ok(js.includes("fallbackCopyText"), "popup.js must implement fallback copy mechanism");
});

