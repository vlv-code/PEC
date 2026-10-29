import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import type { AddressInfo } from "node:net";
import app from "../server.js";
import { probeProxyEgress, saveProxy, deleteProxy } from "../src/proxies.js";
import { saveRoutingPresets, getRoutingPresets } from "../src/storage.js";
import { TEST_ADMIN_TOKEN } from "./helpers/setup.js";

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    if (typeof (server as any).closeAllConnections === "function") {
      (server as any).closeAllConnections();
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("H-1: /proxies/check-all and /proxies/:id/check aliases are removed; /api/proxies requires auth", async () => {
  await withServer(async (base) => {
    // 1. Unauthenticated request to old alias /proxies/check-all must NOT bypass auth
    const resOldCheckAll = await fetch(`${base}/proxies/check-all`, {
      method: "POST",
    });
    // Route must be removed (404) or blocked by auth (401), not 200
    assert.ok(
      resOldCheckAll.status === 404 || resOldCheckAll.status === 401,
      `Expected 401/404 for /proxies/check-all but got ${resOldCheckAll.status}`
    );

    // 2. Unauthenticated request to old alias /proxies/dummy-id/check must NOT bypass auth
    const resOldSingleCheck = await fetch(`${base}/proxies/dummy-id/check`, {
      method: "POST",
    });
    assert.ok(
      resOldSingleCheck.status === 404 || resOldSingleCheck.status === 401,
      `Expected 401/404 for /proxies/dummy-id/check but got ${resOldSingleCheck.status}`
    );

    // 3. Unauthenticated request to canonical /api/proxies/check-all must return 401
    const resApiCheckAllNoAuth = await fetch(`${base}/api/proxies/check-all`, {
      method: "POST",
    });
    assert.equal(resApiCheckAllNoAuth.status, 401, "Expected 401 for unauthenticated /api/proxies/check-all");

    // 4. Unauthenticated request to canonical /api/proxies/:id/check must return 401
    const resApiSingleCheckNoAuth = await fetch(`${base}/api/proxies/dummy-id/check`, {
      method: "POST",
    });
    assert.equal(resApiSingleCheckNoAuth.status, 401, "Expected 401 for unauthenticated /api/proxies/:id/check");

    // 5. Authenticated request to canonical /api/proxies/check-all must succeed
    const resApiCheckAllWithAuth = await fetch(`${base}/api/proxies/check-all`, {
      method: "POST",
      headers: {
        "x-admin-token": TEST_ADMIN_TOKEN || "test-root-admin-token",
      },
    });
    assert.equal(resApiCheckAllWithAuth.status, 200, "Expected 200 for authenticated /api/proxies/check-all");

    // 6. Authenticated request to canonical /api/proxies/:id/check for non-existent proxy returns 404
    const resApiSingleCheckWithAuth = await fetch(`${base}/api/proxies/non-existent-id/check`, {
      method: "POST",
      headers: {
        "x-admin-token": TEST_ADMIN_TOKEN || "test-root-admin-token",
      },
    });
    assert.equal(resApiSingleCheckWithAuth.status, 404, "Expected 404 for authenticated check of non-existent proxy");
  });
});

test("M-5: SOCKS5 probe response truncates / closes stream safely when exceeding 64KB", async () => {
  let serverStreamDestroyed = false;
  let serverBytesWritten = 0;

  // Create a mock SOCKS5 server that sends an oversized HTTP response (> 64KB)
  const socksServer = net.createServer((socket) => {
    socket.once("data", (_greeting) => {
      // Greeting reply: NO AUTH (0x00)
      socket.write(Buffer.from([0x05, 0x00]));

      socket.once("data", (_req) => {
        // Connect reply: SUCCESS (0x00)
        socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 80]));

        socket.once("data", (_httpData) => {
          // Send HTTP headers followed by JSON prefix
          const header = 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{"ip":"198.51.100.99","country":"NL","payload":"';
          socket.write(header);
          serverBytesWritten += header.length;

          // Write 16KB chunks continuously
          const chunk = Buffer.alloc(16 * 1024, "A");
          const interval = setInterval(() => {
            if (socket.destroyed || !socket.writable) {
              clearInterval(interval);
              serverStreamDestroyed = true;
              return;
            }
            try {
              socket.write(chunk);
              serverBytesWritten += chunk.length;
              if (serverBytesWritten > 2 * 1024 * 1024) {
                // Safety cutoff if client never destroys
                clearInterval(interval);
                socket.destroy();
              }
            } catch {
              clearInterval(interval);
              serverStreamDestroyed = true;
            }
          }, 5);

          socket.on("close", () => {
            clearInterval(interval);
            serverStreamDestroyed = true;
          });
          socket.on("error", () => {
            clearInterval(interval);
            serverStreamDestroyed = true;
          });
        });
      });
    });
  });

  await new Promise<void>((resolve) => socksServer.listen(0, "127.0.0.1", () => resolve()));
  const port = (socksServer.address() as AddressInfo).port;

  const px = saveProxy({
    tag: "socks5-oversized-node",
    name: "Mock SOCKS5 Oversized",
    type: "manual",
    protocol: "socks5",
    host: "127.0.0.1",
    port,
    isActive: false,
  });

  try {
    const startTime = Date.now();
    // probeProxyEgress should safely finish, cap buffer to 64KB and destroy stream
    const result = await probeProxyEgress(px, 5000);
    const durationMs = Date.now() - startTime;

    assert.equal(result.id, px.id);
    assert.equal(result.status, "ONLINE");
    assert.equal(result.egressIp, "198.51.100.99", "Egress IP should be extracted even if response was truncated");
    assert.equal(result.geoCountry, "NL", "Geo country should be extracted even if response was truncated");
    // Should complete quickly without waiting for full 5000ms timeout
    assert.ok(durationMs < 4800, `Expected quick completion, took ${durationMs}ms`);

    // Give socket events a moment to propagate
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.ok(serverStreamDestroyed, "Client should destroy the stream when response exceeds 64KB");
    // Server should have been stopped before sending megabytes
    assert.ok(
      serverBytesWritten < 256 * 1024,
      `Expected serverBytesWritten < 256KB but was ${serverBytesWritten}`
    );
  } finally {
    deleteProxy(px.id);
    socksServer.close();
  }
});

test("M-5 edge case: SOCKS5 probe parses egress info when body contains embedded CRLF or LF-only delimiter", async () => {
  const socksServer = net.createServer((socket) => {
    socket.once("data", () => {
      socket.write(Buffer.from([0x05, 0x00])); // NO AUTH
      socket.once("data", () => {
        socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 80])); // SUCCESS
        socket.once("data", () => {
          // Response body contains \r\n\r\n inside JSON string
          const payload = JSON.stringify({
            ip: "203.0.113.42",
            country: "DE",
            notes: "Multi-line notes\r\n\r\nwith double CRLF",
          });
          const response = `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n${payload}`;
          socket.write(response);
          socket.end();
        });
      });
    });
  });

  await new Promise<void>((resolve) => socksServer.listen(0, "127.0.0.1", () => resolve()));
  const port = (socksServer.address() as AddressInfo).port;

  const px = saveProxy({
    tag: "socks5-embedded-crlf",
    name: "Mock SOCKS5 Embedded CRLF",
    type: "manual",
    protocol: "socks5",
    host: "127.0.0.1",
    port,
    isActive: false,
  });

  try {
    const result = await probeProxyEgress(px, 3000);
    assert.equal(result.status, "ONLINE");
    assert.equal(result.egressIp, "203.0.113.42");
    assert.equal(result.geoCountry, "DE");
  } finally {
    deleteProxy(px.id);
    socksServer.close();
  }
});

test("M-2: routing presets import-url and refresh use async DNS SSRF validation", async () => {
  const origAllowInternal = process.env.ALLOW_INTERNAL_PANEL;
  process.env.ALLOW_INTERNAL_PANEL = "false";

  try {
    await withServer(async (base) => {
      // 1. Test import-url with a hostname resolving to loopback (DNS rebinding simulation)
      const resRebind = await fetch(`${base}/api/routing/presets/import-url`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": TEST_ADMIN_TOKEN || "test-root-admin-token",
        },
        body: JSON.stringify({
          url: "http://localtest.me/domains.txt",
          name: "Rebind Test",
        }),
      });

      assert.equal(resRebind.status, 400);
      const dataRebind = (await resRebind.json()) as any;
      assert.match(dataRebind.error, /SSRF validation failed/);

      // 2. Test refresh with preset having DNS rebinding sourceUrl
      const presets = getRoutingPresets();
      const testPreset = {
        id: "preset-rebind-test",
        name: "Preset Rebind Test",
        category: "custom",
        description: "Test preset for rebinding",
        type: "domain" as const,
        source: "remote" as const,
        sourceUrl: "http://localtest.me/domains.txt",
        entries: ["example.com"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      saveRoutingPresets([...presets, testPreset]);

      const resRefresh = await fetch(`${base}/api/routing/presets/preset-rebind-test/refresh`, {
        method: "POST",
        headers: {
          "x-admin-token": TEST_ADMIN_TOKEN || "test-root-admin-token",
        },
      });

      assert.equal(resRefresh.status, 400);
      const dataRefresh = (await resRefresh.json()) as any;
      assert.match(dataRefresh.error, /SSRF validation failed/);
    });
  } finally {
    process.env.ALLOW_INTERNAL_PANEL = origAllowInternal;
  }
});
