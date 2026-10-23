import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import type { AddressInfo } from "node:net";
import {
  probeProxyEgress,
  saveProxy,
  getProxyById,
  deleteProxy,
  createProxy,
} from "../src/proxies.js";
import { createProxiesRouter } from "../src/routes/proxiesRoutes.js";

test("probeProxyEgress tests TCP and returns offline status when host is unreachable", async () => {
  const px = saveProxy({
    tag: "dead-test-node",
    name: "Dead Node",
    type: "manual",
    protocol: "http",
    host: "192.0.2.1", // TEST-NET-1 unroutable
    port: 9999,
    isActive: false,
  });

  try {
    const result = await probeProxyEgress(px);
    assert.equal(result.id, px.id);
    assert.ok(
      result.status === "OFFLINE" || result.status === "ERROR" || result.status === "TIMEOUT",
      `Expected offline/error/timeout but got ${result.status}`
    );
    assert.ok(result.checkedAt, "checkedAt must be set");
  } finally {
    deleteProxy(px.id);
  }
});

test("probeProxyEgress connects to responsive HTTP proxy and reports ONLINE with latency", async () => {
  // Create a minimal mock HTTP proxy server
  const mockProxy = http.createServer((req, res) => {
    // If client requested echo endpoint through proxy
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ip: "198.51.100.42", country: "US" }));
  });

  await new Promise<void>((resolve) => mockProxy.listen(0, "127.0.0.1", () => resolve()));
  const port = (mockProxy.address() as AddressInfo).port;

  const px = saveProxy({
    tag: "live-test-node",
    name: "Live Node",
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
    assert.equal(result.egressIp, "198.51.100.42");
    assert.equal(result.geoCountry, "US");

    // Check that proxy in store was updated with probe results
    const stored = getProxyById(px.id);
    assert.ok(stored);
    assert.equal(stored.egressIp, "198.51.100.42");
    assert.equal(stored.geoCountry, "US");
    assert.equal(stored.latencyMs, result.latencyMs);
  } finally {
    deleteProxy(px.id);
    mockProxy.close();
  }
});

test("POST /api/proxies/:id/check and POST /api/proxies/check-all endpoints", async () => {
  const app = express();
  app.use(express.json());
  app.use(createProxiesRouter());

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const sPort = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${sPort}`;

  const px = createProxy({
    tag: "api-test-node",
    name: "API Test Node",
    type: "manual",
    protocol: "http",
    host: "192.0.2.2",
    port: 8888,
    isActive: false,
  });

  try {
    // 1. Single check endpoint
    const resSingle = await fetch(`${base}/api/proxies/${px.id}/check`, {
      method: "POST",
    });
    assert.equal(resSingle.status, 200);
    const bodySingle = await resSingle.json();
    assert.equal(bodySingle.ok, true);
    assert.ok(bodySingle.result);
    assert.equal(bodySingle.result.id, px.id);

    // 2. Check all endpoint
    const resAll = await fetch(`${base}/api/proxies/check-all`, {
      method: "POST",
    });
    assert.equal(resAll.status, 200);
    const bodyAll = await resAll.json();
    assert.equal(bodyAll.ok, true);
    assert.ok(bodyAll.results);
    assert.ok(bodyAll.results[px.id]);
  } finally {
    deleteProxy(px.id);
    server.close();
  }
});

test("probeProxyEgress connects to responsive SOCKS5 proxy and parses egress IP", async () => {
  const net = await import("node:net");
  const socksServer = net.createServer((socket) => {
    socket.once("data", (_greeting) => {
      // Greeting reply: NO AUTH (0x00)
      socket.write(Buffer.from([0x05, 0x00]));

      socket.once("data", (_req) => {
        // Connect reply: SUCCESS (0x00)
        socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 80]));

        socket.once("data", (_httpData) => {
          const res =
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n" +
            JSON.stringify({ ip: "203.0.113.195", country: "DE" });
          socket.end(res);
        });
      });
    });
  });

  await new Promise<void>((resolve) => socksServer.listen(0, "127.0.0.1", () => resolve()));
  const port = (socksServer.address() as AddressInfo).port;

  const px = saveProxy({
    tag: "socks5-mock-node",
    name: "Mock SOCKS5",
    type: "manual",
    protocol: "socks5",
    host: "127.0.0.1",
    port,
    isActive: false,
  });

  try {
    const result = await probeProxyEgress(px);
    assert.equal(result.id, px.id);
    assert.equal(result.status, "ONLINE");
    assert.ok(result.latencyMs >= 0);
    assert.equal(result.egressIp, "203.0.113.195");
    assert.equal(result.geoCountry, "DE");
  } finally {
    deleteProxy(px.id);
    socksServer.close();
  }
});

test("dashboard.js: switchTab triggers checkAllProxies upon switching to proxy-settings or rotation tab", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const js = fs.readFileSync(path.resolve("public/dashboard.js"), "utf8");

  assert.ok(
    js.includes("checkAllProxies();"),
    "dashboard.js must call checkAllProxies"
  );
  assert.match(
    js,
    /if\s*\([^)]*name\s*===\s*['"]proxy-settings['"][^)]*\)[\s\S]*?checkAllProxies\(\)/,
    "switchTab must trigger checkAllProxies when switching to proxy-settings"
  );
});

