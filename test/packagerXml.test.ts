import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import { escapeXmlAttr, escapeCmdArg, buildUpdatesXml } from "../src/packager.js";

test("packager: escapeXmlAttr properly escapes XML special characters", () => {
  assert.equal(escapeXmlAttr("hello"), "hello");
  assert.equal(escapeXmlAttr("foo&bar"), "foo&amp;bar");
  assert.equal(escapeXmlAttr('foo"bar'), "foo&quot;bar");
  assert.equal(escapeXmlAttr("foo'bar"), "foo&apos;bar");
  assert.equal(escapeXmlAttr("foo<bar>"), "foo&lt;bar&gt;");
  assert.equal(escapeXmlAttr('a&b"c\'d<e>f'), "a&amp;b&quot;c&apos;d&lt;e&gt;f");
  assert.equal(escapeXmlAttr(undefined as any), "");
  assert.equal(escapeXmlAttr(null as any), "");
});

test("packager: buildUpdatesXml escapes extensionId, version, and codebaseUrl", () => {
  const maliciousExtId = 'ext" onload="alert(1)"';
  const maliciousVersion = "1.0.0' or '1'='1";
  const maliciousUrl = "https://example.com/test?foo=1&bar=2<tag>";

  const xml = buildUpdatesXml(maliciousExtId, maliciousVersion, maliciousUrl);

  assert.ok(!xml.includes('appid="ext" onload'), "Must not contain unescaped attribute breakout");
  assert.ok(xml.includes("&quot; onload=&quot;alert(1)&quot;"), "Must escape quotes and tags in appid");
  assert.ok(xml.includes("&apos; or &apos;1&apos;=&apos;1"), "Must escape single quotes in version");
  assert.ok(xml.includes("&amp;bar=2&lt;tag&gt;"), "Must escape ampersands and angle brackets in codebase URL");
  assert.ok(xml.startsWith("<?xml version='1.0' encoding='UTF-8'?>"));
});

test("packager: escapeCmdArg sanitizes % and shell special characters", () => {
  assert.equal(escapeCmdArg("SafeName"), "SafeName");
  assert.equal(escapeCmdArg("Test & calc.exe"), "Test  calc.exe");
  assert.equal(escapeCmdArg("App %PATH%"), "App PATH");
  assert.equal(escapeCmdArg("Evil | dir > out.txt < in.txt ^ secret"), "Evil  dir  out.txt  in.txt  secret");
  assert.equal(escapeCmdArg('Inject "quote" `backtick` !exclamation!'), "Inject quote backtick exclamation");
  assert.equal(escapeCmdArg("Multi\r\nLine"), "MultiLine");
});
