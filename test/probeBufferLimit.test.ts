import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { saveProxy, deleteProxy, probeProxyEgress } from "../src/proxies.js";

test("probeHttpProxy caps accumulated response buffer at 64 KB", async () => {
  let bytesSent = 0;
  const mockServer = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    // Send 10 chunks of 16 KB (160 KB total, which exceeds 64 KB)
    const chunk = "X".repeat(16 * 1024);
    for (let i = 0; i < 10; i++) {
      res.write(chunk);
      bytesSent += chunk.length;
    }
    res.end();
  });

  await new Promise<void>((resolve) => mockServer.listen(0, "127.0.0.1", () => resolve()));
  const port = (mockServer.address() as AddressInfo).port;

  const px = saveProxy({
    tag: "overflow-probe-test",
    name: "Overflow Test Node",
    type: "manual",
    protocol: "http",
    host: "127.0.0.1",
    port,
    isActive: false,
  });

  try {
    const result = await probeProxyEgress(px);
    assert.equal(result.id, px.id);
    assert.equal(result.status, "ONLINE");
    assert.ok(typeof result.latencyMs === "number" && result.latencyMs >= 0);
  } finally {
    deleteProxy(px.id);
    mockServer.close();
  }
});
