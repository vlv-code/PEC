import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import { renderDashboardHtml } from "../src/views/dashboardView.js";

/**
 * Render-level regressions for the management dashboard.
 *
 * The dashboard renders fleet data client-side through innerHTML; every
 * dynamic value must pass through the shipped esc() helper. These tests
 * lock down: (1) the shared token never ships in the HTML, (2) the
 * default-token warning is driven by the render option (it previously
 * rendered unconditionally as dead template text), (3) esc() escapes
 * every HTML-breaking character, and (4) no attacker-influenced object
 * interpolation exists without an esc() wrapper.
 */

function render(isDefaultTokenInUse: boolean): string {
  return renderDashboardHtml({ isDefaultTokenInUse, port: 3000 });
}

test("dashboard render: the shared token never ships in the HTML", () => {
  for (const flag of [true, false]) {
    const html = render(flag);
    assert.ok(!html.includes("test-admin-token"), "EXT_SHARED_TOKEN value must not be embedded in the page");
    assert.ok(!html.includes("corp-proxy-secret-token-change-me"), "the default token constant must not be embedded");
    assert.ok(!html.includes(process.env.EXT_SHARED_TOKEN || "test-admin-token"), "live token value must not be embedded");
    // no prefilled secret in any input (old regression: the token was embedded)
    assert.doesNotMatch(html, /<input[^>]+value="[^"]+"[^>]*type="password"/i);
    assert.doesNotMatch(html, /type="password"[^>]+value="[^"]+"/i);
  }
});

test("dashboard render: default-token warning is driven by the render option", () => {
  // Regression: the banner was behind an escaped \${...} placeholder in HTML
  // context, so it rendered on every page together with raw template text.
  const warn = render(true);
  assert.match(warn, /DEFAULT TOKEN IN USE/);
  assert.match(warn, /Security Warning:/);

  const quiet = render(false);
  assert.doesNotMatch(quiet, /DEFAULT TOKEN IN USE/);
  assert.doesNotMatch(quiet, /Security Warning:/);

  for (const html of [warn, quiet]) {
    assert.ok(!html.includes("${isDefaultTokenInUse"), "unrendered template expression leaked into the HTML");
    assert.ok(!html.includes("\\${"), "escaped template expressions must not reach the browser");
  }
});

test("dashboard render: login gate is present (token is entered, not embedded)", () => {
  const html = render(false);
  assert.match(html, /id="loginTokenInput"/);
  assert.match(html, /autocomplete="off"/);
});

test("dashboard render: no external font dependencies (CSP would block them anyway)", () => {
  const html = render(false);
  assert.ok(!html.includes("fonts.googleapis.com"), "Google Fonts stylesheet must not be referenced");
  assert.ok(!html.includes("fonts.gstatic.com"), "Google Fonts preconnect must not be referenced");
  assert.ok(!html.includes("Plus Jakarta Sans"), "the removed webfont family must not remain in the CSS");
  assert.ok(html.includes("ui-monospace"), "the mono stack must be system fonts");
});

test("dashboard render: the studio preview iframe is sandboxed and release names are escaped", () => {
  const html = render(false);
  // sandbox="allow-scripts" gives the preview an opaque origin: the preview
  // cannot touch dashboard sessionStorage or its same-origin API surface.
  assert.match(html, /<iframe id="previewFrame" sandbox="allow-scripts"/);

  // GitHub release names are attacker-influenced and must pass through esc()
  assert.match(html, /\$\{esc\(data\.latestRelease\.name \|\| \('v' \+ data\.latestRelease\.version\)\)\}/);
});

test("dashboard render: adminFetch authenticates with X-Admin-Token, fleet header stays for endpoint testers", () => {
  const html = render(false);
  assert.match(html, /'X-Admin-Token': token/, "the management-API client must send the admin token header");
  assert.ok(!html.includes("opts.headers = Object.assign({}, opts.headers || {}, { 'X-Ext-Token': token })"), "adminFetch must not send the fleet header");
  // the /creds and /api/sync testers deliberately keep the fleet header
  assert.match(html, /'X-Ext-Token': token \}/, "fleet endpoint testers must keep X-Ext-Token");
});

test("dashboard render: shipped esc() neutralizes every HTML-breaking character", () => {
  const html = render(false);
  const m = html.match(/function esc\(value\) \{[\s\S]*?\n    \}/);
  assert.ok(m, "the esc() helper must ship inside the dashboard script");
  // Execute the ACTUAL shipped implementation, not a re-implementation.
  const esc = new Function(`return (${m[0]})`)() as (v: unknown) => string;

  const payloads = [
    '<img src=x onerror="alert(1)">',
    '"><script>alert(1)</script>',
    "'-\"-`-${alert(1)}",
    "&amp;&lt;&gt;",
    "\u2028\u2029",
    "javascript:alert(1)",
  ];
  for (const p of payloads) {
    const out = esc(p);
    assert.ok(!out.includes("<"), `< must be escaped for payload: ${p}`);
    assert.ok(!out.includes(">"), `> must be escaped for payload: ${p}`);
    assert.ok(!/[&<>"'`]/.test(out.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&#96;/g, "")), `payload not fully escaped: ${p}`);
  }

  // nullish and falsy handling
  assert.strictEqual(esc(null), "");
  assert.strictEqual(esc(undefined), "");
  assert.strictEqual(esc(0), "0");
  assert.strictEqual(esc(false), "false");
});

test("dashboard render: every attacker-influenced interpolation is esc()-wrapped", () => {
  const html = render(false);

  // Interpolations of fleet/audit/rule/preset/history/release objects that are
  // NOT wrapped in esc(). Safe exceptions: boolean ternaries selecting string
  // literals, .length numbers, and new Date(...).toLocaleDateString() output
  // (all produce inert text with no HTML metacharacters).
  const candidates = html.match(/(?<!esc\()\$\{(?:inst|l|r|p|item)\.[A-Za-z][A-Za-z.]*/g) || [];
  const unsafe = candidates.filter((expr) => !isInertInterpolation(html, expr));
  assert.deepStrictEqual(
    [...new Set(unsafe)],
    [],
    "all interpolations of fleet/audit/rule/release objects must pass through esc() " +
      "(or be provably inert: boolean ternary, .length, new Date().toLocaleDateString())"
  );

  // The known XSS sinks from the original review must stay esc()-wrapped.
  for (const sink of ["${esc(inst.instanceId)}", "${esc(inst.ip)}", "${esc(r.name)}", "${esc(r.pattern)}", "${esc(l.details", "${esc(item.user)}", "${esc(r.htmlUrl)}"]) {
    assert.ok(html.includes(sink), `missing esc() wrapper at sink: ${sink}`);
  }
});

function isInertInterpolation(html: string, expr: string): boolean {
  if (/\.length$/.test(expr)) return true; // a number - no HTML metacharacters
  const i = html.indexOf(expr);
  const context = html.slice(i, i + 120);
  // boolean ternary producing a literal ('checked', 'badge-online'...) or a
  // new Date(...).toLocaleDateString() - neither can emit HTML metacharacters
  return /\?\s*'/.test(context) || /new Date\(/.test(context);
}
