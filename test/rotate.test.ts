import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import { test3xuiConnection, sync3xuiInboundByTag, fetch3xuiInbounds, save3xuiPanel, delete3xuiPanel } from "../src/rotate.js";
import { withHttpServer } from "./helpers/http-server.js";

test("rotate: test3xuiConnection with insecureTls accepts panel connections", async () => {
  const { url, close } = await withHttpServer((req, res) => {
    if (req.method === "GET" && req.url === "/csrf-token") {
      res.setHeader("Set-Cookie", "3x-ui=csrf-session; Path=/");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, obj: "token-test" }));
      return;
    }
    if (req.method === "POST" && req.url === "/login") {
      res.setHeader("Set-Cookie", "auth=val; Path=/");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
      return;
    }
    if (req.method === "GET" && req.url === "/panel/api/inbounds/list") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, obj: [{ id: 10, remark: "insecure-node", protocol: "http" }] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  try {
    const res = await test3xuiConnection({
      panelUrl: url,
      adminUser: "admin",
      adminPass: "admin",
      inboundRemark: "insecure-node",
      insecureTls: true,
      timeoutSec: 3,
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.inboundFound, true);
    assert.strictEqual(res.inboundId, 10);
  } finally {
    await close();
  }
});

test("rotate: fetch3xuiInbounds and sync3xuiInboundByTag honor insecureTls", async () => {
  const { url, close } = await withHttpServer((req, res) => {
    if (req.method === "GET" && req.url === "/csrf-token") {
      res.writeHead(404);
      res.end();
      return;
    }
    if (req.method === "POST" && req.url === "/login") {
      res.setHeader("Set-Cookie", "session=123; Path=/");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
      return;
    }
    if (req.method === "GET" && req.url === "/panel/api/inbounds/list") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, obj: [{ id: 25, tag: "tag-insecure", protocol: "socks", settings: JSON.stringify({ accounts: [{ user: "corp", pass: "secret" }] }) }] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  try {
    const inbounds = await fetch3xuiInbounds({
      panelUrl: url,
      adminUser: "admin",
      adminPass: "admin",
      timeoutSec: 3,
      insecureTls: true,
    });
    assert.strictEqual(inbounds.length, 1);
    assert.strictEqual(inbounds[0].id, 25);

    const syncRes = await sync3xuiInboundByTag({
      panelUrl: url,
      adminUser: "admin",
      adminPass: "admin",
      tag: "tag-insecure",
      insecureTls: true,
      timeoutSec: 3,
    });
    assert.strictEqual(syncRes.ok, true);
    assert.strictEqual(syncRes.inboundId, 25);
  } finally {
    await close();
  }
});
