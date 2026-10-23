import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("applyI18n in dashboard.js checks dict[key].includes('<') BEFORE checking icon to prevent escaping HTML translations", () => {
  const js = fs.readFileSync(path.resolve("public/dashboard.js"), "utf8");

  // In public/dashboard.js, inside document.querySelectorAll('[data-i18n]').forEach:
  // dict[key].includes('<') MUST be checked before el.querySelector('img.icon-inline, svg'),
  // so that translations with HTML (like <img src="/icons/upload.png">) are set as innerHTML
  // and not passed to createTextNode, which turns tags into literal text on the button.

  const i18nLoopIndex = js.indexOf("document.querySelectorAll('[data-i18n]').forEach");
  assert.ok(i18nLoopIndex !== -1, "data-i18n loop must exist in dashboard.js");

  const i18nLoopSnippet = js.substring(i18nLoopIndex, i18nLoopIndex + 500);

  const dictKeyCheckIndex = i18nLoopSnippet.indexOf("dict[key].includes('<')");
  const iconQueryIndex = i18nLoopSnippet.indexOf("el.querySelector('img.icon-inline, svg')");

  assert.ok(dictKeyCheckIndex !== -1, "dict[key].includes('<') check must exist in i18n loop");
  assert.ok(
    dictKeyCheckIndex < iconQueryIndex,
    "dict[key].includes('<') MUST be checked before el.querySelector to prevent escaping HTML into createTextNode"
  );
});
