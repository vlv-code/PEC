import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_TEMPLATE } from "../src/templates/backgroundTemplate.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const backgroundJs = fs.readFileSync(path.join(REPO_ROOT, "extension", "background.js"), "utf-8");

test("background.js and BACKGROUND_TEMPLATE include sender.id check in onMessage (L-20)", () => {
  const expectedCheck = "if (sender.id && sender.id !== chrome.runtime.id) return false;";

  assert.ok(
    backgroundJs.includes(expectedCheck),
    "extension/background.js must start onMessage listener with sender.id check"
  );
  assert.ok(
    BACKGROUND_TEMPLATE.includes(expectedCheck),
    "src/templates/backgroundTemplate.ts must start onMessage listener with sender.id check"
  );
});

test("background.js and BACKGROUND_TEMPLATE do not log data.user in plaintext (M-14)", () => {
  assert.ok(
    !backgroundJs.includes("data.user"),
    "extension/background.js must not reference data.user in logEvent or logs"
  );
  assert.ok(
    !BACKGROUND_TEMPLATE.includes("data.user"),
    "src/templates/backgroundTemplate.ts must not reference data.user in logEvent or logs"
  );
  assert.ok(
    backgroundJs.includes('logEvent("info", "Creds fallback successful");'),
    "extension/background.js must log 'Creds fallback successful' without username"
  );
  assert.ok(
    BACKGROUND_TEMPLATE.includes('logEvent("info", "Creds fallback successful");'),
    "src/templates/backgroundTemplate.ts must log 'Creds fallback successful' without username"
  );
});

test("background.js and BACKGROUND_TEMPLATE store creds strictly in session storage and never local (M-14)", () => {
  // Ensure pecCredsCache is never written to chrome.storage.local
  const localSetPattern = /chrome\.storage\.local\.set\(\s*\{[^}]*pecCredsCache/g;
  assert.ok(!localSetPattern.test(backgroundJs), "background.js must never save pecCredsCache to storage.local");
  assert.ok(!localSetPattern.test(BACKGROUND_TEMPLATE), "BACKGROUND_TEMPLATE must never save pecCredsCache to storage.local");

  // Ensure creds are saved to session storage
  assert.ok(
    backgroundJs.includes("sessionStore.set({ pecCredsCache: memoryCredsCache });"),
    "background.js must persist credentials to chrome.storage.session"
  );
  assert.ok(
    BACKGROUND_TEMPLATE.includes("sessionStore.set({ pecCredsCache: memoryCredsCache });"),
    "BACKGROUND_TEMPLATE must persist credentials to chrome.storage.session"
  );
});

test("background.js and BACKGROUND_TEMPLATE validate pacUrl before applying (L-21)", () => {
  assert.ok(
    backgroundJs.includes("isValidPacUrl"),
    "background.js must define or use pacUrl validation"
  );
  assert.ok(
    BACKGROUND_TEMPLATE.includes("isValidPacUrl"),
    "BACKGROUND_TEMPLATE must define or use pacUrl validation"
  );
});

test("background.js and BACKGROUND_TEMPLATE use amber (#f59e0b) badge on proxy failure or fallback (M-12)", () => {
  // Verify amber badge color (#f59e0b) is used on fallback and proxy error
  assert.ok(
    backgroundJs.includes("#f59e0b"),
    "background.js must include #f59e0b amber badge color"
  );
  assert.ok(
    BACKGROUND_TEMPLATE.includes("#f59e0b"),
    "BACKGROUND_TEMPLATE must include #f59e0b amber badge color"
  );
  assert.ok(
    backgroundJs.includes('updateBadge("●", "#f59e0b"); // Warning amber badge: running on cached PAC'),
    "background.js must use amber badge on PAC fallback"
  );
  assert.ok(
    BACKGROUND_TEMPLATE.includes('updateBadge("●", "#f59e0b"); // Warning amber badge: running on cached PAC'),
    "BACKGROUND_TEMPLATE must use amber badge on PAC fallback"
  );
});

test("isValidPacUrl correctly validates PAC URLs (L-21)", () => {
  const fnMatch = backgroundJs.match(/function isValidPacUrl\([^)]*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "isValidPacUrl function definition found in background.js");

  const fn = new Function("currentProxyState", "DEFAULT_SERVER_BASE", `
    ${fnMatch[0]}
    return isValidPacUrl;
  `)({ serverBase: "https://corp.example.com" }, "https://corp.example.com");

  // HTTPS is allowed
  assert.equal(fn("https://cdn.example.com/proxy.pac"), true);
  assert.equal(fn("https://corp.example.com/api/pac"), true);

  // Same-origin with server base is allowed (including schemeless base string)
  assert.equal(fn("https://corp.example.com/pac.js", "https://corp.example.com"), true);
  assert.equal(fn("http://corp.example.com:8080/pac.js", "http://corp.example.com:8080"), true);
  assert.equal(fn("http://corp.example.com:8080/pac.js", "corp.example.com:8080"), true);

  // Cross-origin HTTP is rejected
  assert.equal(fn("http://attacker.com/evil.pac", "https://corp.example.com"), false);
  assert.equal(fn("http://other.org/pac.pac"), false);

  // Dangerous protocols are rejected
  assert.equal(fn("javascript:alert(1)"), false);
  assert.equal(fn("data:text/javascript;base64,..."), false);
  assert.equal(fn("file:///etc/passwd"), false);
  assert.equal(fn(""), false);
  assert.equal(fn(null), false);
  assert.equal(fn("not-a-valid-url"), false);
});

test("syncWithServer clears sessionStore creds cache on forceRefresh (M-14)", () => {
  assert.ok(
    backgroundJs.includes('sessionStore.remove(["pecCredsCache"])'),
    "background.js must remove pecCredsCache from sessionStore on forceRefresh"
  );
  assert.ok(
    BACKGROUND_TEMPLATE.includes('sessionStore.remove(["pecCredsCache"])'),
    "BACKGROUND_TEMPLATE must remove pecCredsCache from sessionStore on forceRefresh"
  );
});

test("X-04: autoConfigureProxy evaluates to false for 0, '0', 'false', false and true for 1, true, undefined", () => {
  // Test that both background.js and BACKGROUND_TEMPLATE use the normalized autoConfigureProxy expression
  assert.ok(
    backgroundJs.includes('rawAuto !== false && rawAuto !== 0 && rawAuto !== "0" && rawAuto !== "false"'),
    "extension/background.js must normalize autoConfigureProxy to handle DWORD 0/1, strings and booleans"
  );
  assert.ok(
    BACKGROUND_TEMPLATE.includes('rawAuto !== false && rawAuto !== 0 && rawAuto !== "0" && rawAuto !== "false"'),
    "src/templates/backgroundTemplate.ts must normalize autoConfigureProxy to handle DWORD 0/1, strings and booleans"
  );

  // Evaluate the normalization logic across all permutations
  const normalizeAuto = (rawAuto: any) =>
    rawAuto === undefined ? true : (rawAuto !== false && rawAuto !== 0 && rawAuto !== "0" && rawAuto !== "false");

  assert.equal(normalizeAuto(0), false);
  assert.equal(normalizeAuto("0"), false);
  assert.equal(normalizeAuto(false), false);
  assert.equal(normalizeAuto("false"), false);

  assert.equal(normalizeAuto(1), true);
  assert.equal(normalizeAuto("1"), true);
  assert.equal(normalizeAuto(true), true);
  assert.equal(normalizeAuto("true"), true);
  assert.equal(normalizeAuto(undefined), true);
});
