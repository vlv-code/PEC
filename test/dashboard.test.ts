import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { renderDashboardHtml } from "../src/views/dashboardView.js";

/**
 * Render-level regressions for the management dashboard.
 *
 * The dashboard client code ships as real static assets (public/dashboard.js,
 * public/dashboard.css) referenced from the rendered HTML. These tests lock
 * down: (1) the shared token never ships in the HTML or the assets, (2) the
 * default-token warning is driven by the render option, (3) esc() escapes
 * every HTML-breaking character, (4) no attacker-influenced object
 * interpolation exists without an esc() wrapper, and (5) the shipped client
 * script parses as PLAIN JavaScript - a TypeScript-only construct once leaked
 * into the inline script and killed every dashboard handler in production.
 */

const dashboardJs = readFileSync(
  fileURLToPath(new URL("../public/dashboard.js", import.meta.url)),
  "utf-8"
);
const dashboardCss = readFileSync(
  fileURLToPath(new URL("../public/dashboard.css", import.meta.url)),
  "utf-8"
);

function render(isDefaultTokenInUse: boolean): string {
  return renderDashboardHtml({ isDefaultTokenInUse, port: 3000 });
}

test("dashboard render: references the static assets, no inline code blocks", () => {
  const html = render(false);
  assert.match(html, /<link rel="stylesheet" href="\/dashboard.css">/);
  assert.match(html, /<script src="\/dashboard.js"><\/script>/);
  assert.ok(!html.includes("<style>"), "CSS must ship as the external asset");
  assert.ok(!/<script>[\s\S]/.test(html), "client JS must ship as the external asset");
});

test("dashboard assets: client script parses as plain JavaScript (no TS leak)", () => {
  // vm.Script compiles without executing: a TypeScript-only construct such as
  // "(pf as HTMLIFrameElement)" throws SyntaxError here, catching the leak on
  // CI instead of in a browser where it silently killed the whole script.
  new vm.Script(dashboardJs, { filename: "dashboard.js" });
});

test("dashboard render: the shared token never ships in the HTML or assets", () => {
  for (const flag of [true, false]) {
    const html = render(flag);
    assert.ok(!html.includes("test-admin-token"), "EXT_SHARED_TOKEN value must not be embedded in the page");
    assert.ok(!html.includes("corp-proxy-secret-token-change-me"), "the default token constant must not be embedded");
    assert.ok(!html.includes(process.env.EXT_SHARED_TOKEN || "test-admin-token"), "live token value must not be embedded");
    // no prefilled secret in any input (old regression: the token was embedded)
    assert.doesNotMatch(html, /<input[^>]+value="[^"]+"[^>]*type="password"/i);
    assert.doesNotMatch(html, /type="password"[^>]+value="[^"]+"/i);
  }
  for (const [name, asset] of [["dashboard.js", dashboardJs], ["dashboard.css", dashboardCss]]) {
    assert.ok(!asset.includes("test-admin-token"), `${name} must not embed the token value`);
    assert.ok(!asset.includes("corp-proxy-secret-token-change-me"), `${name} must not embed the default token`);
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

test("dashboard render: login gate is present (password is entered, session is server-side)", () => {
  const html = render(false);
  assert.match(html, /id="loginUsernameInput"/, "the login screen asks for a username");
  assert.match(html, /id="loginTokenInput"/);
  assert.match(html, /autocomplete="current-password"/, "the login field is a password field");
  assert.match(html, /id="loginError"/, "failed logins must surface an error line");
  assert.match(html, /id="btnLogout"/, "the header must carry a logout button");
  assert.match(html, /id="credsModal"/, "the settings must expose a credential-change dialog");
});

test("dashboard assets: no external font dependencies (CSP would block them anyway)", () => {
  const html = render(false);
  assert.ok(!html.includes("fonts.googleapis.com"), "Google Fonts stylesheet must not be referenced");
  assert.ok(!html.includes("fonts.gstatic.com"), "Google Fonts preconnect must not be referenced");
  assert.ok(!dashboardCss.includes("fonts.googleapis.com"), "Google Fonts must not be referenced from the CSS");
  assert.ok(!dashboardCss.includes("Plus Jakarta Sans"), "the removed webfont family must not remain in the CSS");
  assert.ok(dashboardCss.includes("ui-monospace"), "the mono stack must be system fonts");
});

test("dashboard render: the studio preview iframe is sandboxed", () => {
  const html = render(false);
  // sandbox="allow-scripts" gives the preview an opaque origin: the preview
  // cannot touch dashboard sessionStorage or its same-origin API surface.
  assert.match(html, /<iframe id="previewFrame" sandbox="allow-scripts"/);
});

test("dashboard assets: release names are escaped; auth rides a server session, not stored secrets", () => {
  // GitHub release names are attacker-influenced and must pass through esc()
  assert.match(
    dashboardJs,
    /\$\{esc\(data\.latestRelease\.name \|\| \('v' \+ data\.latestRelease\.version\)\)\}/
  );

  // The browser never holds the admin token: login exchanges the password for
  // an HttpOnly session cookie and every API call carries only the CSRF
  // marker header.
  assert.match(dashboardJs, /'X-Requested-With': 'pec-dashboard'/, "API calls must carry the CSRF marker header");
  assert.match(dashboardJs, /\/api\/auth\/login/, "the client must log in through the server");
  assert.match(dashboardJs, /credentials: 'same-origin'/, "API calls must send the session cookie");
  assert.ok(!dashboardJs.includes("sessionStorage"), "no secret may be stored client-side");
  assert.ok(!dashboardJs.includes("'X-Admin-Token': token"), "adminFetch must not attach a stored token");
  // the /creds and /api/sync testers deliberately keep the fleet header
  assert.match(dashboardJs, /'X-Ext-Token': token \}/, "fleet endpoint testers must keep X-Ext-Token");
});

test("dashboard assets: shipped esc() neutralizes every HTML-breaking character", () => {
  const m = dashboardJs.match(/function esc\(value\) \{[\s\S]*?\n    \}/);
  assert.ok(m, "the esc() helper must ship inside public/dashboard.js");
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

test("dashboard assets: every attacker-influenced interpolation is esc()-wrapped", () => {
  // Interpolations of fleet/audit/rule/preset/history/release objects that are
  // NOT wrapped in esc(). Safe exceptions: boolean ternaries selecting string
  // literals, .length numbers, and new Date(...).toLocaleDateString() output
  // (all produce inert text with no HTML metacharacters).
  const candidates = dashboardJs.match(/(?<!esc\()\$\{(?:inst|l|r|p|item)\.[A-Za-z][A-Za-z.]*/g) || [];
  const unsafe = candidates.filter((expr) => !isInertInterpolation(dashboardJs, expr));
  assert.deepStrictEqual(
    [...new Set(unsafe)],
    [],
    "all interpolations of fleet/audit/rule/release objects must pass through esc() " +
      "(or be provably inert: boolean ternary, .length, new Date().toLocaleDateString())"
  );

  // The known XSS sinks from the original review must stay esc()-wrapped.
  for (const sink of ["${esc(inst.instanceId)}", "${esc(inst.ip)}", "${esc(r.name)}", "${esc(r.pattern)}", "${esc(l.details", "${esc(item.user)}", "${esc(r.htmlUrl)}"]) {
    assert.ok(dashboardJs.includes(sink), `missing esc() wrapper at sink: ${sink}`);
  }
});

function isInertInterpolation(source: string, expr: string): boolean {
  if (/\.length$/.test(expr)) return true; // a number - no HTML metacharacters
  const i = source.indexOf(expr);
  const context = source.slice(i, i + 120);
  // boolean ternary producing a literal ('checked', 'badge-online'...) or a
  // new Date(...).toLocaleDateString() - neither can emit HTML metacharacters
  return /\?\s*'/.test(context) || /new Date\(/.test(context);
}
