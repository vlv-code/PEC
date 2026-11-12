import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import { renderGppRegistryXml } from "../src/templates/gpoTemplates.js";

// Helper to decode basic XML entities in attribute values
function decodeXmlAttr(val: string): string {
  return val
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

test("gppRegistryXml: XML declaration and root RegistrySettings structure", () => {
  const extId = "abcdefghijklmnopabcdefghijklmnop";
  const serverUrl = "https://pec.corp.local:3000";
  const token = "corp-shared-token-12345";

  const xml = renderGppRegistryXml(extId, serverUrl, token);

  // 1. Standard XML declaration
  assert.ok(
    xml.startsWith('<?xml version="1.0" encoding="utf-8"?>'),
    "XML must start with utf-8 XML declaration"
  );

  // 2. Root element RegistrySettings with correct CLSID
  assert.ok(
    xml.includes('<RegistrySettings clsid="{A3CCFC41-DFDB-43a5-8D26-0FE8B954DA51}">'),
    "Root element must be RegistrySettings with MS-GPPREG CLSID {A3CCFC41-DFDB-43a5-8D26-0FE8B954DA51}"
  );

  // 3. Closes with </RegistrySettings>
  assert.ok(
    xml.trim().endsWith("</RegistrySettings>"),
    "XML must properly close with </RegistrySettings>"
  );
});

test("gppRegistryXml: verifies required attributes removePolicy='1', action='R', bypassErrors='1', and HKCU hive", () => {
  const extId = "abcdefghijklmnopabcdefghijklmnop";
  const serverUrl = "https://pec.corp.local";
  const token = "token-test-xyz";

  const xml = renderGppRegistryXml(extId, serverUrl, token, "SecOps");

  // Matches all <Registry ...> tags
  const registryRegex = /<Registry\s+([^>]+)>/g;
  let match: RegExpExecArray | null;
  let registryCount = 0;

  while ((match = registryRegex.exec(xml)) !== null) {
    registryCount++;
    const attrs = match[1];

    assert.ok(
      attrs.includes('clsid="{9CD4B2F7-2C92-116a-9E29-EEB64A588655}"'),
      `Registry item ${registryCount} must have Registry CLSID {9CD4B2F7-2C92-116a-9E29-EEB64A588655}`
    );
    assert.ok(
      attrs.includes('bypassErrors="1"'),
      `Registry item ${registryCount} must have bypassErrors="1"`
    );
    assert.ok(
      attrs.includes('removePolicy="1"'),
      `Registry item ${registryCount} must have removePolicy="1"`
    );
    assert.ok(
      attrs.includes('userContext="1"'),
      `Registry item ${registryCount} must have userContext="1"`
    );
    assert.ok(
      /uid="\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}"/.test(attrs),
      `Registry item ${registryCount} must have valid formatted GUID in uid attribute`
    );
  }

  assert.ok(registryCount > 0, "XML must contain multiple Registry items");

  // Matches all <Properties .../> tags
  const propsRegex = /<Properties\s+([^>]+)\/>/g;
  let propsCount = 0;

  while ((match = propsRegex.exec(xml)) !== null) {
    propsCount++;
    const attrs = match[1];

    assert.ok(
      attrs.includes('action="R"'),
      `Properties item ${propsCount} must specify action="R" (Replace)`
    );
    assert.ok(
      attrs.includes('hive="HKEY_CURRENT_USER"'),
      `Properties item ${propsCount} must target hive="HKEY_CURRENT_USER"`
    );
    assert.ok(
      attrs.includes('bypassErrors="1"'),
      `Properties item ${propsCount} must have bypassErrors="1"`
    );
    assert.ok(
      attrs.includes('removePolicy="1"'),
      `Properties item ${propsCount} must have removePolicy="1"`
    );
  }

  assert.equal(propsCount, registryCount, "Each Registry item must contain exactly one Properties tag");
});

test("gppRegistryXml: verifies %USERDOMAIN%\\%USERNAME% substitution for domainUser", () => {
  const extId = "abcdefghijklmnopabcdefghijklmnop";
  const serverUrl = "https://pec.corp.local";
  const token = "token-123";

  const xml = renderGppRegistryXml(extId, serverUrl, token);

  // Extract all Properties tags with name="domainUser"
  const domainUserRegex = /<Properties[^>]+name="domainUser"[^>]*\/>/g;
  const matches = xml.match(domainUserRegex) || [];

  // Must be generated for all supported enterprise browsers (Chrome, Edge, Yandex, Opera)
  assert.equal(matches.length, 4, "Must generate domainUser policy for all 4 browsers");

  for (const m of matches) {
    assert.ok(
      m.includes('value="%USERDOMAIN%\\%USERNAME%"'),
      `domainUser property must preserve raw Windows environment variables %USERDOMAIN%\\%USERNAME%, got: ${m}`
    );
    assert.ok(
      m.includes('hive="HKEY_CURRENT_USER"'),
      "domainUser must be located in HKEY_CURRENT_USER"
    );
    assert.ok(
      m.includes('type="REG_SZ"'),
      "domainUser must have type REG_SZ"
    );
  }
});

test("gppRegistryXml: verifies multi-browser ExtensionSettings JSON correctness and installation modes", () => {
  const extId = "abcdefghijklmnopabcdefghijklmnop";
  const serverUrl = "https://pec.corp.local:8443";
  const token = "secret-token-777";
  const targetGroup = "DevOps-Core";

  const xml = renderGppRegistryXml(extId, serverUrl, token, targetGroup);

  // Extract ExtensionSettings Properties
  const propsRegex = /<Properties\s+([^>]+)\/>/g;
  let match: RegExpExecArray | null;
  const foundSettings: Array<{ key: string; json: any }> = [];

  while ((match = propsRegex.exec(xml)) !== null) {
    const attrs = match[1];
    if (attrs.includes('name="ExtensionSettings"')) {
      const keyMatch = /key="([^"]+)"/.exec(attrs);
      const valMatch = /value="([^"]+)"/.exec(attrs);
      if (keyMatch && valMatch) {
        const decodedJson = decodeXmlAttr(valMatch[1]);
        let parsed: any;
        try {
          parsed = JSON.parse(decodedJson);
        } catch (err: any) {
          assert.fail(`ExtensionSettings in key "${keyMatch[1]}" is not valid JSON: ${err.message}`);
        }
        foundSettings.push({ key: keyMatch[1], json: parsed });
      }
    }
  }

  assert.equal(foundSettings.length, 4, "Must contain ExtensionSettings for all 4 browsers");

  // Check Chrome, Edge, and Opera (force_installed)
  const chromeSettings = foundSettings.find((s) => s.key === "Software\\Policies\\Google\\Chrome");
  assert.ok(chromeSettings, "Chrome ExtensionSettings must exist");
  assert.equal(chromeSettings.json[extId].installation_mode, "force_installed");
  assert.equal(chromeSettings.json[extId].override_update_url, true);
  assert.equal(chromeSettings.json[extId].extToken, token);
  assert.equal(chromeSettings.json[extId].targetGroup, targetGroup);
  assert.equal(chromeSettings.json[extId].credsUrl, `${serverUrl}/creds`);
  assert.equal(chromeSettings.json[extId].syncUrl, `${serverUrl}/api/sync`);
  assert.deepEqual(chromeSettings.json["*"].install_sources, [`${serverUrl}/*`]);

  const edgeSettings = foundSettings.find((s) => s.key === "Software\\Policies\\Microsoft\\Edge");
  assert.ok(edgeSettings, "Edge ExtensionSettings must exist");
  assert.equal(edgeSettings.json[extId].installation_mode, "force_installed");

  const operaSettings = foundSettings.find((s) => s.key === "Software\\Policies\\Opera Software\\Opera");
  assert.ok(operaSettings, "Opera ExtensionSettings must exist");
  assert.equal(operaSettings.json[extId].installation_mode, "force_installed");

  // Check Yandex Browser (normal_installed requirement)
  const yandexSettings = foundSettings.find((s) => s.key === "Software\\Policies\\YandexBrowser");
  assert.ok(yandexSettings, "Yandex Browser ExtensionSettings must exist");
  assert.equal(
    yandexSettings.json[extId].installation_mode,
    "normal_installed",
    "Yandex Browser must use normal_installed to avoid enterprise policy rejection"
  );
  assert.equal(yandexSettings.json[extId].extToken, token);
  assert.equal(yandexSettings.json[extId].targetGroup, targetGroup);
});

test("gppRegistryXml: targetGroup handling and XML attribute escaping", () => {
  const extId = "abcdefghijklmnopabcdefghijklmnop";
  const serverUrl = "https://pec.corp.local";
  const token = "token<with>&'\"chars";

  // 1. Without targetGroup
  const xmlNoGroup = renderGppRegistryXml(extId, serverUrl, token, "");
  assert.ok(
    !xmlNoGroup.includes('name="targetGroup"'),
    "When targetGroup is empty, targetGroup registry item must not be generated"
  );

  // 2. Special characters escaping in XML
  assert.ok(!xmlNoGroup.includes("<with>"), "Unescaped < and > must not exist in XML");
  assert.ok(xmlNoGroup.includes("&lt;with&gt;"), "<with> must be escaped as &lt;with&gt;");
  assert.ok(xmlNoGroup.includes("&amp;"), "& must be escaped as &amp;");
  assert.ok(xmlNoGroup.includes("&quot;"), '" must be escaped as &quot;');
  assert.ok(xmlNoGroup.includes("&apos;"), "' must be escaped as &apos;");

  // 3. With targetGroup
  const xmlWithGroup = renderGppRegistryXml(extId, serverUrl, token, "SecOps & Incident Response");
  const targetGroupProps = xmlWithGroup.match(/<Properties[^>]+name="targetGroup"[^>]*\/>/g) || [];
  assert.equal(targetGroupProps.length, 4, "Must generate targetGroup registry entry for all 4 browsers");
  for (const p of targetGroupProps) {
    assert.ok(p.includes('value="SecOps &amp; Incident Response"'), "targetGroup value must be XML escaped");
    assert.ok(p.includes('type="REG_SZ"'), "targetGroup type must be REG_SZ");
  }
});
