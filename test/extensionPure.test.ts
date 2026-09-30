import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import {
  sanitizePacScript,
  pacRevisionOf,
  computeDescriptiveMode,
  appendLog,
} from "../src/extensionPureLogic.js";

test("extension-pure: sanitizePacScript preserves valid 7-bit ASCII PAC script", () => {
  const input = `
    // Generated PAC
    function FindProxyForURL(url, host) {
      if (dnsDomainIs(host, "example.com")) return "PROXY 127.0.0.1:10809; DIRECT";
      return "DIRECT";
    }
  `;
  const output = sanitizePacScript(input);
  assert.strictEqual(output, input);
});

test("extension-pure: sanitizePacScript converts Cyrillic IDN domains to Punycode", () => {
  const input = `
    function FindProxyForURL(url, host) {
      if (dnsDomainIs(host, "яндекс.рф")) return "PROXY 127.0.0.1:10809; DIRECT";
      if (dnsDomainIs(host, "*.почта.рус")) return "PROXY 127.0.0.1:10809; DIRECT";
      return "DIRECT";
    }
  `;
  const output = sanitizePacScript(input);
  assert.ok(output !== null, "sanitized output must not be null");
  assert.ok(!/[^\x00-\x7F]/.test(output!), "output must be 100% 7-bit ASCII");
  assert.match(output!, /xn--d1acpjx3f\.xn--p1ai/);
  assert.match(output!, /\*\.xn--80a1acny\.xn--p1acf/);
});

test("extension-pure: sanitizePacScript cleans Cyrillic comments while preserving FindProxyForURL", () => {
  const input = `
    // Корпоративная маршрутизация PEC
    function FindProxyForURL(url, host) {
      // Доступ к внутренним ресурсам
      return "DIRECT";
    }
  `;
  const output = sanitizePacScript(input);
  assert.ok(output !== null);
  assert.ok(!/[^\x00-\x7F]/.test(output!), "output must not contain Cyrillic");
  assert.ok(output!.includes("FindProxyForURL"));
});

test("extension-pure: sanitizePacScript returns null when FindProxyForURL is absent", () => {
  const input = `// Invalid script without proxy function\nvar x = 1;`;
  const output = sanitizePacScript(input);
  assert.strictEqual(output, null);
});

test("extension-pure: pacRevisionOf extracts generated timestamp or returns fallback", () => {
  const scriptWithDate = `/* Generated: 2026-09-30T10:00:00.000Z */\nfunction FindProxyForURL() {}`;
  assert.strictEqual(pacRevisionOf(scriptWithDate), "2026-09-30T10:00:00.000Z");

  const scriptNoDate = `function FindProxyForURL() {}`;
  assert.strictEqual(pacRevisionOf(scriptNoDate), "unknown rev");
});

test("extension-pure: computeDescriptiveMode returns correct labels and tooltips", () => {
  // 1. Bypass mode
  const bypass = computeDescriptiveMode({ mode: "pac_script", bypassActive: true });
  assert.strictEqual(bypass.label, "Обход (Bypass)");
  assert.strictEqual(bypass.tag, "BYPASS");

  // 2. PAC Tunnel
  const tunnel = computeDescriptiveMode({ mode: "pac_script", defaultPolicy: "proxy" });
  assert.strictEqual(tunnel.label, "PAC (туннель)");
  assert.strictEqual(tunnel.tag, "PAC");
  assert.ok(tunnel.tooltip.includes("туннелирует"));

  // 3. PAC Selective
  const selective = computeDescriptiveMode({ mode: "pac_script", defaultPolicy: "direct" });
  assert.strictEqual(selective.label, "PAC (селективный)");
  assert.strictEqual(selective.tag, "PAC");
  assert.ok(selective.tooltip.includes("напрямую"));

  // 4. Fixed
  const fixed = computeDescriptiveMode({ mode: "fixed_servers", host: "1.2.3.4", port: 10809 });
  assert.strictEqual(fixed.label, "Fixed (1.2.3.4:10809)");

  // 5. Direct
  const direct = computeDescriptiveMode({ mode: "direct" });
  assert.strictEqual(direct.label, "Прямой (DIRECT)");
});

test("extension-pure: appendLog maintains ring buffer capped at maxLogs", () => {
  const buffer: Array<{ timestamp: string; level: string; message: string; data?: any }> = [];
  for (let i = 1; i <= 60; i++) {
    appendLog(buffer, { level: "info", message: `Event ${i}` }, 50);
  }
  assert.strictEqual(buffer.length, 50, "buffer must be capped at 50");
  assert.strictEqual(buffer[0].message, "Event 11", "oldest 10 events must have been dropped");
  assert.strictEqual(buffer[49].message, "Event 60", "newest event must be at the end");
});
