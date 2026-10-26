import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import { getBaseUrl, recordAudit, getAuditLogs, clearAuditLogs, getClientIp } from "../src/audit.js";
import type { Request } from "express";

test("Audit Service & getBaseUrl (Audit M-Server)", async (t) => {
  await t.test("getBaseUrl ignores spoofed x-forwarded-proto when trust proxy is false", () => {
    const mockReq = {
      protocol: "http",
      get: (h: string) => (h.toLowerCase() === "x-forwarded-proto" ? "https" : h.toLowerCase() === "host" ? "example.com" : null),
    } as unknown as Request;
    assert.strictEqual(getBaseUrl(mockReq), "http://example.com");
  });

  await t.test("getBaseUrl uses https when Express protocol is https", () => {
    const mockReq = {
      protocol: "https",
      get: (h: string) => (h.toLowerCase() === "host" ? "secure.example.com" : null),
    } as unknown as Request;
    assert.strictEqual(getBaseUrl(mockReq), "https://secure.example.com");
  });

  await t.test("getBaseUrl respects PUBLIC_BASE_URL override", () => {
    const prev = process.env.PUBLIC_BASE_URL;
    try {
      process.env.PUBLIC_BASE_URL = "https://corp.example.com///";
      const mockReq = {
        protocol: "http",
        get: (h: string) => (h.toLowerCase() === "host" ? "internal.local" : null),
      } as unknown as Request;
      assert.strictEqual(getBaseUrl(mockReq), "https://corp.example.com");
    } finally {
      process.env.PUBLIC_BASE_URL = prev;
    }
  });

  await t.test("audit log recording and ring buffer limit", () => {
    clearAuditLogs();
    assert.strictEqual(getAuditLogs().length, 0);

    for (let i = 0; i < 110; i++) {
      recordAudit({
        ip: `192.168.1.${i % 50}`,
        endpoint: `/api/test-${i}`,
        status: 200,
        result: "BUILD_SUCCESS",
        details: `Log entry ${i}`,
      });
    }

    const logs = getAuditLogs();
    assert.strictEqual(logs.length, 100, "Must be bounded to MAX_AUDIT_LOGS = 100");
    assert.strictEqual(logs[0].details, "Log entry 109", "Most recent log entry must be first");
  });

  await t.test("getClientIp handles standard, ipv6-mapped and missing ip correctly", () => {
    // 1. Direct req.ip
    const req1 = { ip: "10.0.0.5", socket: {} } as unknown as Request;
    assert.strictEqual(getClientIp(req1), "10.0.0.5");

    // 2. IPv6 mapped IPv4 address
    const req2 = { ip: "::ffff:192.168.1.50", socket: {} } as unknown as Request;
    assert.strictEqual(getClientIp(req2), "192.168.1.50");

    // 3. Fallback to socket.remoteAddress
    const req3 = { ip: undefined, socket: { remoteAddress: "::ffff:172.16.0.1" } } as unknown as Request;
    assert.strictEqual(getClientIp(req3), "172.16.0.1");

    // 4. Fallback to unknown
    const req4 = { ip: undefined, socket: {} } as unknown as Request;
    assert.strictEqual(getClientIp(req4), "unknown");
  });
});

