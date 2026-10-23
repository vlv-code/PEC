import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import { validateSafeEndpointUrl } from "../src/rotate.js";

test("SSRF Protection (M-1): blocks loopback and RFC 1918 by default", () => {
  const oldVal = process.env.ALLOW_INTERNAL_PANEL;
  try {
    delete process.env.ALLOW_INTERNAL_PANEL;

    // Loopback targets
    const loopbacks = [
      "http://127.0.0.1:2053/xui",
      "http://127.0.0.2:8080",
      "http://127.1.2.3:3000",
      "http://localhost:2053/xui",
      "http://[::1]:2053/xui",
      "http://[::]/xui",
      "http://0.0.0.0:2053/xui",
      "http://[::ffff:127.0.0.1]:2053/xui",
      "http://2130706433:2053/xui",
      "http://0177.0.0.1:2053/xui",
    ];
    for (const url of loopbacks) {
      const res = validateSafeEndpointUrl(url);
      assert.strictEqual(res.valid, false, `${url} must be blocked by default`);
      assert.match(res.error || "", /SSRF|loopback|private/i);
    }

    // RFC 1918 private IPv4 ranges & IPv4-mapped IPv6 & IPv6 ULA
    const privateIps = [
      "http://10.0.0.1:2053/xui",
      "http://10.255.255.254:2053/xui",
      "http://172.16.0.1:2053/xui",
      "http://172.24.1.1:2053/xui",
      "http://172.31.255.254:2053/xui",
      "http://192.168.0.1:2053/xui",
      "http://192.168.1.100:2053/xui",
      "http://[::ffff:10.0.0.1]:2053/xui",
      "http://[::ffff:172.16.0.1]:2053/xui",
      "http://[::ffff:192.168.1.1]:2053/xui",
      "http://[fc00::1]:2053/xui",
      "http://[fd00::1]:2053/xui",
    ];
    for (const url of privateIps) {
      const res = validateSafeEndpointUrl(url);
      assert.strictEqual(res.valid, false, `${url} must be blocked by default`);
      assert.match(res.error || "", /SSRF|loopback|private/i);
    }

    // Public / non-private targets must be allowed by default
    const publicUrls = [
      "https://example.com/panel",
      "https://8.8.8.8:2053/xui",
      "https://172.15.0.1:2053/xui", // outside 172.16.0.0/12
      "https://172.32.0.1:2053/xui", // outside 172.16.0.0/12
      "https://192.169.1.1:2053/xui", // outside 192.168.0.0/16
      "https://my-3xui.corp.example:2053/subpath",
    ];
    for (const url of publicUrls) {
      const res = validateSafeEndpointUrl(url);
      assert.strictEqual(res.valid, true, `${url} must be allowed`);
    }
  } finally {
    if (oldVal !== undefined) {
      process.env.ALLOW_INTERNAL_PANEL = oldVal;
    } else {
      delete process.env.ALLOW_INTERNAL_PANEL;
    }
  }
});

test("SSRF Protection (M-1): permits internal panels when ALLOW_INTERNAL_PANEL=true", () => {
  const oldVal = process.env.ALLOW_INTERNAL_PANEL;
  try {
    process.env.ALLOW_INTERNAL_PANEL = "true";

    assert.strictEqual(validateSafeEndpointUrl("http://127.0.0.1:2053/xui").valid, true);
    assert.strictEqual(validateSafeEndpointUrl("http://localhost:2053/xui").valid, true);
    assert.strictEqual(validateSafeEndpointUrl("http://[::1]:2053/xui").valid, true);
    assert.strictEqual(validateSafeEndpointUrl("http://10.0.0.5:2053/xui").valid, true);
    assert.strictEqual(validateSafeEndpointUrl("http://172.16.0.1:2053/xui").valid, true);
    assert.strictEqual(validateSafeEndpointUrl("http://192.168.1.1:2053/xui").valid, true);

    // Cloud metadata must ALWAYS be blocked even if ALLOW_INTERNAL_PANEL=true
    assert.strictEqual(validateSafeEndpointUrl("http://169.254.169.254/latest/meta-data").valid, false);
    assert.strictEqual(validateSafeEndpointUrl("http://[fd00:ec2::254]/").valid, false);
  } finally {
    if (oldVal !== undefined) {
      process.env.ALLOW_INTERNAL_PANEL = oldVal;
    } else {
      delete process.env.ALLOW_INTERNAL_PANEL;
    }
  }
});
