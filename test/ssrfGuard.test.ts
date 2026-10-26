import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import dns from "node:dns";
import { validateSafeEndpointUrlAsync } from "../src/rotate.js";

test("SSRF DNS Guard (H-5): rejects DNS rebinding and nip.io domains resolving to private/loopback IPs", async () => {
  const oldVal = process.env.ALLOW_INTERNAL_PANEL;
  try {
    delete process.env.ALLOW_INTERNAL_PANEL;

    // Loopback via nip.io
    const loopbackRes = await validateSafeEndpointUrlAsync("http://127.0.0.1.nip.io:2053/xui");
    assert.strictEqual(loopbackRes.valid, false, "127.0.0.1.nip.io must be blocked");
    assert.match(loopbackRes.error || "", /SSRF|private|loopback/i);

    // Private RFC 1918 via nip.io
    const private10Res = await validateSafeEndpointUrlAsync("http://10.0.0.1.nip.io:2053/xui");
    assert.strictEqual(private10Res.valid, false, "10.0.0.1.nip.io must be blocked");
    assert.match(private10Res.error || "", /SSRF|private|loopback/i);

    const private192Res = await validateSafeEndpointUrlAsync("http://192.168.1.100.nip.io:2053/xui");
    assert.strictEqual(private192Res.valid, false, "192.168.1.100.nip.io must be blocked");
    assert.match(private192Res.error || "", /SSRF|private|loopback/i);

    const private172Res = await validateSafeEndpointUrlAsync("http://172.16.0.1.nip.io:2053/xui");
    assert.strictEqual(private172Res.valid, false, "172.16.0.1.nip.io must be blocked");
    assert.match(private172Res.error || "", /SSRF|private|loopback/i);

    // Literal loopback & private IPs still blocked
    const literalRes = await validateSafeEndpointUrlAsync("http://127.0.0.1:2053/xui");
    assert.strictEqual(literalRes.valid, false);

    const literalLocalhost = await validateSafeEndpointUrlAsync("http://localhost:2053/xui");
    assert.strictEqual(literalLocalhost.valid, false);

    // Cloud metadata still blocked
    const metaRes = await validateSafeEndpointUrlAsync("http://169.254.169.254/latest/meta-data");
    assert.strictEqual(metaRes.valid, false);
    assert.match(metaRes.error || "", /cloud metadata/i);

    // Cloud metadata via nip.io blocked
    const metaNipRes = await validateSafeEndpointUrlAsync("http://169.254.169.254.nip.io/");
    assert.strictEqual(metaNipRes.valid, false);

    // Non-resolvable hostname returns error, not throw
    const nonExistent = await validateSafeEndpointUrlAsync("http://non-existent-domain-pec-test-random-12345.corp:2053/xui");
    assert.strictEqual(nonExistent.valid, false);
    assert.match(nonExistent.error || "", /DNS resolution failed/i);

    // Invalid format returns error
    const invalidProto = await validateSafeEndpointUrlAsync("ftp://example.com/xui");
    assert.strictEqual(invalidProto.valid, false);
  } finally {
    if (oldVal !== undefined) {
      process.env.ALLOW_INTERNAL_PANEL = oldVal;
    } else {
      delete process.env.ALLOW_INTERNAL_PANEL;
    }
  }
});

test("SSRF DNS Guard (H-5): allows public domains when ALLOW_INTERNAL_PANEL is not set", async () => {
  const oldVal = process.env.ALLOW_INTERNAL_PANEL;
  try {
    delete process.env.ALLOW_INTERNAL_PANEL;

    // Public domain resolving to public IP (e.g. 1.1.1.1)
    const publicRes = await validateSafeEndpointUrlAsync("https://one.one.one.one/xui");
    assert.strictEqual(publicRes.valid, true, "Public domain should be allowed");
  } finally {
    if (oldVal !== undefined) {
      process.env.ALLOW_INTERNAL_PANEL = oldVal;
    } else {
      delete process.env.ALLOW_INTERNAL_PANEL;
    }
  }
});

test("SSRF DNS Guard (H-5): permits internal panels when ALLOW_INTERNAL_PANEL=true", async () => {
  const oldVal = process.env.ALLOW_INTERNAL_PANEL;
  try {
    process.env.ALLOW_INTERNAL_PANEL = "true";

    assert.strictEqual((await validateSafeEndpointUrlAsync("http://127.0.0.1:2053/xui")).valid, true);
    assert.strictEqual((await validateSafeEndpointUrlAsync("http://127.0.0.1.nip.io:2053/xui")).valid, true);
    assert.strictEqual((await validateSafeEndpointUrlAsync("http://localhost:2053/xui")).valid, true);
    assert.strictEqual((await validateSafeEndpointUrlAsync("http://10.0.0.5:2053/xui")).valid, true);

    // Cloud metadata must still be blocked even if ALLOW_INTERNAL_PANEL=true
    assert.strictEqual((await validateSafeEndpointUrlAsync("http://169.254.169.254/latest/meta-data")).valid, false);
  } finally {
    if (oldVal !== undefined) {
      process.env.ALLOW_INTERNAL_PANEL = oldVal;
    } else {
      delete process.env.ALLOW_INTERNAL_PANEL;
    }
  }
});

test("SSRF DNS Guard (H-5): rejects when any resolved IP is private in multi-address DNS results", async () => {
  const oldVal = process.env.ALLOW_INTERNAL_PANEL;
  const originalLookup = dns.promises.lookup;
  try {
    delete process.env.ALLOW_INTERNAL_PANEL;

    // Mock dns.promises.lookup returning both a public IP and a private IP
    dns.promises.lookup = (async (hostname: string, options?: any) => {
      if (hostname === "dual-homed.example.com") {
        return [
          { address: "93.184.216.34", family: 4 },
          { address: "10.0.0.99", family: 4 },
        ] as any;
      }
      return originalLookup(hostname, options);
    }) as any;

    const res = await validateSafeEndpointUrlAsync("http://dual-homed.example.com:2053/xui");
    assert.strictEqual(res.valid, false, "Must reject if any resolved IP is in private range");
    assert.match(res.error || "", /10\.0\.0\.99.*SSRF/i);
  } finally {
    dns.promises.lookup = originalLookup;
    if (oldVal !== undefined) {
      process.env.ALLOW_INTERNAL_PANEL = oldVal;
    } else {
      delete process.env.ALLOW_INTERNAL_PANEL;
    }
  }
});
