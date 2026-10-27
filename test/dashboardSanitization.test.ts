import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const dashboardJs = readFileSync(
  fileURLToPath(new URL("../public/dashboard.js", import.meta.url)),
  "utf-8"
);

// Helper to extract a function declaration string using balanced brace matching
function extractFunction(code: string, fnName: string): string {
  const marker = `function ${fnName}(`;
  const startIdx = code.indexOf(marker);
  if (startIdx === -1) return "";
  const braceIdx = code.indexOf("{", startIdx);
  if (braceIdx === -1) return "";
  let depth = 1;
  let i = braceIdx + 1;
  while (i < code.length && depth > 0) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") depth--;
    i++;
  }
  return code.slice(startIdx, i);
}

// Extract shipped esc() function from public/dashboard.js
function getShippedEsc(): (v: unknown) => string {
  const fnStr = extractFunction(dashboardJs, "esc");
  assert.ok(fnStr.length > 0, "The esc() function must be defined in public/dashboard.js");
  return new Function(`return (${fnStr})`)() as (v: unknown) => string;
}

test("public/dashboard.js contains no calls to undefined showToast", () => {
  const matches = dashboardJs.match(/\bshowToast\b/g);
  assert.strictEqual(
    matches,
    null,
    `Found call(s) or reference(s) to undefined showToast: ${matches ? matches.length : 0} occurrence(s). All toasts must use toast().`
  );
});

test("loadDesktopInstances is declared at outer scope and not nested inside initFleetListeners", () => {
  // Extract initFleetListeners function with balanced brace parsing
  const initFleetFn = extractFunction(dashboardJs, "initFleetListeners");
  assert.ok(initFleetFn.length > 0, "initFleetListeners must be defined in public/dashboard.js");

  assert.strictEqual(
    initFleetFn.includes("async function loadDesktopInstances"),
    false,
    "loadDesktopInstances must not be declared inside initFleetListeners"
  );
  assert.strictEqual(
    initFleetFn.includes("function loadDesktopInstances"),
    false,
    "loadDesktopInstances must not be declared as any function inside initFleetListeners"
  );

  // Verify loadDesktopInstances is declared as an async function at outer dashboard scope
  assert.match(
    dashboardJs,
    /(?:^|\n)\s*async\s+function\s+loadDesktopInstances\s*\(\)/,
    "loadDesktopInstances must be declared as an async function at outer scope"
  );

  // Verify loadInstances invokes loadDesktopInstances at outer scope
  const loadInstancesFn = extractFunction(dashboardJs, "loadInstances");
  assert.ok(
    loadInstancesFn.includes("loadDesktopInstances();"),
    "loadInstances must invoke loadDesktopInstances() at outer scope"
  );
});

test("preset action badge template uses esc(act) and esc(actLabel) (M-11)", () => {
  assert.ok(
    dashboardJs.includes('preset-in-profile-badge action-${esc(act)}'),
    "Preset action badge class must wrap act in esc(act)"
  );
  assert.ok(
    dashboardJs.includes("${esc(actLabel)}</span>"),
    "Preset action badge content must wrap actLabel in esc(actLabel)"
  );
  assert.strictEqual(
    dashboardJs.includes('preset-in-profile-badge action-${act}'),
    false,
    "Preset action badge must not use unescaped ${act}"
  );
  assert.strictEqual(
    dashboardJs.includes("${actLabel}</span>"),
    false,
    "Preset action badge must not use unescaped ${actLabel}"
  );

  // Behavioral test: verify XSS payloads are properly neutralized by esc()
  const esc = getShippedEsc();
  const xssAct = '"><script>alert(1)</script>';
  const xssLabel = '<img src=x onerror="alert(1)">';

  const renderedBadge = `<span class="preset-in-profile-badge action-${esc(xssAct)}">In Profile: ${esc(xssLabel)}</span>`;
  assert.strictEqual(renderedBadge.includes("<script>"), false, "Must not contain raw <script>");
  assert.strictEqual(renderedBadge.includes("<img"), false, "Must not contain raw <img>");
  assert.ok(renderedBadge.includes("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(renderedBadge.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
});

test("GitHub release version renders data.currentVersion wrapped in esc() (L-23)", () => {
  assert.match(
    dashboardJs,
    /v\$\{esc\(data\.currentVersion/,
    "GitHub release version display must escape data.currentVersion with esc()"
  );

  // Behavioral test: verify XSS payload in currentVersion is safely escaped
  const esc = getShippedEsc();
  const xssVersion = '2.1.0"><b onfocus=alert(1)>';
  const escapedVersion = esc(xssVersion);
  assert.strictEqual(escapedVersion.includes("<b"), false, "Must not contain raw HTML tags");
  assert.strictEqual(escapedVersion.includes(">"), false, "Must not contain unescaped >");
  assert.ok(escapedVersion.includes("&quot;&gt;&lt;b onfocus=alert(1)&gt;"));
});

test("formatRelativeTime has safe typeof === 'function' fallback guard (M-15)", () => {
  assert.strictEqual(
    dashboardJs.includes("typeof formatRelativeTime === 'function'"),
    true,
    "formatRelativeTime reference must be guarded by typeof check"
  );
  // Ensure un-guarded ternary is not present
  assert.strictEqual(
    dashboardJs.includes("(formatRelativeTime ? formatRelativeTime("),
    false,
    "Direct identifier reference formatRelativeTime ? formatRelativeTime(...) throws ReferenceError if undeclared"
  );

  // Behavioral test in vm sandbox:
  // Case A: formatRelativeTime is NOT declared (must not throw ReferenceError)
  const ctxWithoutFn = {
    inst: { lastSync: "2026-10-27T10:00:00.000Z" }
  };
  vm.createContext(ctxWithoutFn);
  const code = `inst.lastSync ? (typeof formatRelativeTime === 'function' ? formatRelativeTime(inst.lastSync) : new Date(inst.lastSync).toLocaleTimeString()) : '-'`;
  const resultFallback = vm.runInContext(code, ctxWithoutFn);
  assert.ok(typeof resultFallback === "string" && resultFallback.length > 0, "Must return valid formatted time string on fallback");

  // Case B: formatRelativeTime IS declared (must call formatRelativeTime)
  const ctxWithFn = {
    inst: { lastSync: "2026-10-27T10:00:00.000Z" },
    formatRelativeTime: (t: string) => `rel:${t}`
  };
  vm.createContext(ctxWithFn);
  const resultCustom = vm.runInContext(code, ctxWithFn);
  assert.strictEqual(resultCustom, "rel:2026-10-27T10:00:00.000Z");
});

test("public/dashboard.js compiles cleanly as valid plain JavaScript", () => {
  // Verifies that public/dashboard.js has no syntax errors or leaked TS constructs
  assert.doesNotThrow(() => {
    new vm.Script(dashboardJs, { filename: "dashboard.js" });
  });
});
