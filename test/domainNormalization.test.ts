import test from "node:test";
import assert from "node:assert/strict";
import { injectUserRulesIntoPac } from "../src/extensionPureLogic.js";

const BASE_PAC = `function FindProxyForURL(url, host) {
  return "DIRECT";
}`;

test("PAC normalization: bare domain matches apex and subdomains", () => {
  const pac = injectUserRulesIntoPac(
    BASE_PAC,
    [{ pattern: "yandex.ru", action: "PROXY", enabled: true }],
    "proxy.corp.internal:1080"
  );

  assert.ok(
    pac.includes('host === "yandex.ru" || dnsDomainIs(host, ".yandex.ru") || shExpMatch(host, "*.yandex.ru")'),
    "Bare domain must check exact host, dnsDomainIs with dot, and shExpMatch wildcard"
  );
  assert.ok(pac.includes('return "PROXY proxy.corp.internal:1080";'));
});

test("PAC normalization: wildcard prefix *. matches subdomains and apex", () => {
  const pac = injectUserRulesIntoPac(
    BASE_PAC,
    [{ pattern: "*.example.com", action: "PROXY", enabled: true }],
    "proxy.corp.internal:1080"
  );

  assert.ok(
    pac.includes('shExpMatch(host, "*.example.com") || host === "example.com"'),
    "*.domain must match wildcard subdomains and apex"
  );
});

test("PAC normalization: leading dot . normalized to *.domain and matches apex", () => {
  const pac = injectUserRulesIntoPac(
    BASE_PAC,
    [{ pattern: ".example.com", action: "DIRECT", enabled: true }],
    "proxy.corp.internal:1080"
  );

  assert.ok(
    pac.includes('shExpMatch(host, "*.example.com") || host === "example.com"'),
    ".domain must normalize to *.domain wildcard and apex"
  );
  assert.ok(pac.includes('return "DIRECT";'));
});

test("PAC normalization: complex wildcard patterns use shExpMatch", () => {
  const pac = injectUserRulesIntoPac(
    BASE_PAC,
    [{ pattern: "foo.*.bar.com", action: "PROXY", enabled: true }],
    "proxy.corp.internal:1080"
  );

  assert.ok(
    pac.includes('shExpMatch(host, "foo.*.bar.com")'),
    "Complex wildcard pattern must use shExpMatch"
  );
});

test("PAC normalization: sanitizes newlines, quotes, and backslashes", () => {
  const pac = injectUserRulesIntoPac(
    BASE_PAC,
    [{ pattern: 'test"bad\\\r\nsite.com', action: "PROXY", enabled: true }],
    "proxy.corp.internal:1080"
  );

  assert.ok(!pac.includes('\r'), "PAC must not contain carriage return");
  assert.ok(!pac.includes('\n  if (shExpMatch(host, "test"bad'), "Quotes must be stripped");
  assert.ok(pac.includes('testbadsite.com'), "Pattern must be cleaned of quotes/slashes/newlines");
});

test("PAC normalization: converts non-ASCII IDN / Cyrillic to Punycode", () => {
  const pacBare = injectUserRulesIntoPac(
    BASE_PAC,
    [{ pattern: "яндекс.рф", action: "PROXY", enabled: true }],
    "proxy.corp.internal:1080"
  );

  // Must contain punycode xn--d1acpjx3f.xn--p1ai and no non-ASCII characters in rules
  assert.ok(
    pacBare.includes("xn--d1acpjx3f.xn--p1ai"),
    "Cyrillic bare domain must be converted to Punycode"
  );
  assert.ok(
    !/[^\x00-\x7F]/.test(pacBare),
    "Generated PAC must be strictly 7-bit ASCII for Chrome compliance"
  );

  const pacWild = injectUserRulesIntoPac(
    BASE_PAC,
    [{ pattern: "*.президент.рф", action: "PROXY", enabled: true }],
    "proxy.corp.internal:1080"
  );
  assert.ok(
    pacWild.includes("xn--d1abbgf6aiiy.xn--p1ai"),
    "Cyrillic wildcard domain must be converted to Punycode"
  );
  assert.ok(
    !/[^\x00-\x7F]/.test(pacWild),
    "Wildcard Cyrillic PAC must be strictly 7-bit ASCII"
  );
});
