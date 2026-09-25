import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import express from "express";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import { createProxiesRouter } from "../src/routes/proxiesRoutes.js";
import { getProxiesStorePath } from "../src/storage.js";
import { createProxy, getAllProxies } from "../src/proxies.js";
import { updateRotationConfig } from "../src/scheduler.js";
import { getAuditLogs } from "../src/audit.js";
import { withHttpServer } from "./helpers/http-server.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createProxiesRouter());
  return app;
}

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const app = buildApp();
  let server: any;
  const port = await new Promise<number>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    if (typeof server.closeAllConnections === "function") {
      server.closeAllConnections();
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function resetProxiesStore() {
  const storePath = getProxiesStorePath();
  if (fs.existsSync(storePath)) {
    fs.unlinkSync(storePath);
  }
}

test("GET /api/proxies: returns empty list initially or all proxies with masked passwords", async () => {
  resetProxiesStore();
  await withServer(async (base) => {
    const res1 = await fetch(`${base}/api/proxies`);
    assert.strictEqual(res1.status, 200);
    const body1 = await res1.json();
    assert.deepStrictEqual(body1, []);

    // Create a proxy with password directly
    createProxy({
      tag: "test-p1",
      name: "Proxy 1",
      type: "manual",
      protocol: "socks5",
      host: "10.0.0.1",
      port: 1080,
      username: "user1",
      password: "secretpassword123",
    });

    const res2 = await fetch(`${base}/api/proxies`);
    assert.strictEqual(res2.status, 200);
    const body2 = await res2.json();
    assert.strictEqual(body2.length, 1);
    assert.strictEqual(body2[0].tag, "test-p1");
    assert.strictEqual(body2[0].password, "********");
  });
});

test("POST /api/proxies (manual): validation and creation", async () => {
  resetProxiesStore();
  await withServer(async (base) => {
    // Missing required fields
    const resBad = await fetch(`${base}/api/proxies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "manual", host: "1.2.3.4" }),
    });
    assert.strictEqual(resBad.status, 400);

    // Invalid type
    const resBadType = await fetch(`${base}/api/proxies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "unknown-type", tag: "t1" }),
    });
    assert.strictEqual(resBadType.status, 400);

    // Invalid port
    const resBadPort = await fetch(`${base}/api/proxies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "manual",
        tag: "p-bad-port",
        protocol: "socks5",
        host: "1.2.3.4",
        port: 99999,
      }),
    });
    assert.strictEqual(resBadPort.status, 400);

    // Valid manual proxy
    const resGood = await fetch(`${base}/api/proxies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "manual",
        tag: "manual-node-1",
        name: "Manual Node 1",
        protocol: "socks5",
        host: "192.168.1.50",
        port: 10808,
        username: "myuser",
        password: "mypassword",
      }),
    });
    assert.strictEqual(resGood.status, 201);
    const created = await resGood.json();
    assert.ok(created.id);
    assert.strictEqual(created.tag, "manual-node-1");
    assert.strictEqual(created.name, "Manual Node 1");
    assert.strictEqual(created.protocol, "socks5");
    assert.strictEqual(created.host, "192.168.1.50");
    assert.strictEqual(created.port, 10808);
    assert.strictEqual(created.password, "********");
    assert.strictEqual(created.isActive, true, "First proxy must be active");

    // Verify audit log
    const auditLogs = getAuditLogs();
    const createdAudit = auditLogs.find((a) => a.result === "PROXY_CREATED");
    assert.ok(createdAudit, "Audit log must contain PROXY_CREATED");
    assert.strictEqual(createdAudit.status, 201);
  });
});

test("PUT /api/proxies/:id: validation, 404 and updating", async () => {
  resetProxiesStore();
  const node = createProxy({
    tag: "p-to-update",
    protocol: "http",
    host: "1.2.3.4",
    port: 8080,
    password: "oldpassword",
  });

  await withServer(async (base) => {
    // 404 for unknown id
    const res404 = await fetch(`${base}/api/proxies/non-existent-id`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New Name" }),
    });
    assert.strictEqual(res404.status, 404);

    // 400 for invalid port
    const res400 = await fetch(`${base}/api/proxies/${node.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ port: -1 }),
    });
    assert.strictEqual(res400.status, 400);

    // 200 for valid update
    const res200 = await fetch(`${base}/api/proxies/${node.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated Name", port: 8081 }),
    });
    assert.strictEqual(res200.status, 200);
    const updated = await res200.json();
    assert.strictEqual(updated.id, node.id);
    assert.strictEqual(updated.name, "Updated Name");
    assert.strictEqual(updated.port, 8081);
    assert.strictEqual(updated.password, "********");

    // Verify audit log
    const auditLogs = getAuditLogs();
    const updatedAudit = auditLogs.find((a) => a.result === "PROXY_UPDATED");
    assert.ok(updatedAudit, "Audit log must contain PROXY_UPDATED");
  });
});

test("POST /api/proxies/:id/activate: activates target proxy", async () => {
  resetProxiesStore();
  const node1 = createProxy({
    tag: "node-1",
    protocol: "socks5",
    host: "1.1.1.1",
    port: 1080,
    password: "pass1",
  });
  const node2 = createProxy({
    tag: "node-2",
    protocol: "http",
    host: "2.2.2.2",
    port: 8080,
    password: "pass2",
  });

  await withServer(async (base) => {
    // 404 for missing proxy
    const res404 = await fetch(`${base}/api/proxies/unknown-id/activate`, {
      method: "POST",
    });
    assert.strictEqual(res404.status, 404);

    // Activate node 2
    const res200 = await fetch(`${base}/api/proxies/${node2.id}/activate`, {
      method: "POST",
    });
    assert.strictEqual(res200.status, 200);
    const body = await res200.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.activeProxy.id, node2.id);
    assert.strictEqual(body.activeProxy.isActive, true);
    assert.strictEqual(body.activeProxy.password, "********");

    // Verify audit log
    const auditLogs = getAuditLogs();
    const activatedAudit = auditLogs.find((a) => a.result === "PROXY_ACTIVATED");
    assert.ok(activatedAudit, "Audit log must contain PROXY_ACTIVATED");
  });
});

test("DELETE /api/proxies/:id: deletes proxy", async () => {
  resetProxiesStore();
  const node = createProxy({
    tag: "node-to-delete",
    protocol: "socks5",
    host: "3.3.3.3",
    port: 1080,
  });

  await withServer(async (base) => {
    // Delete existing
    const res = await fetch(`${base}/api/proxies/${node.id}`, {
      method: "DELETE",
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.removed, true);

    // Delete non-existent
    const res2 = await fetch(`${base}/api/proxies/${node.id}`, {
      method: "DELETE",
    });
    assert.strictEqual(res2.status, 200);
    const body2 = await res2.json();
    assert.strictEqual(body2.ok, true);
    assert.strictEqual(body2.removed, false);

    // Verify audit log
    const auditLogs = getAuditLogs();
    const deletedAudit = auditLogs.find((a) => a.result === "PROXY_DELETED");
    assert.ok(deletedAudit, "Audit log must contain PROXY_DELETED");
  });
});

test("POST /api/proxies (3x-ui): creation via inbound sync and error cases", async () => {
  resetProxiesStore();

  await withServer(async (base) => {
    // Missing tag
    const resNoTag = await fetch(`${base}/api/proxies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "3x-ui" }),
    });
    assert.strictEqual(resNoTag.status, 400);

    // Panel URL not configured
    updateRotationConfig({ panelUrl: "", adminUser: "admin", adminPass: "admin" });
    const resNoPanel = await fetch(`${base}/api/proxies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "3x-ui", tag: "inbound-socks" }),
    });
    assert.strictEqual(resNoPanel.status, 400);

    // Mock 3x-ui panel
    const mockPanel = await withHttpServer((req, res) => {
      if (req.method === "GET" && req.url === "/csrf-token") {
        res.writeHead(404);
        res.end();
        return;
      }
      if (req.method === "POST" && req.url === "/login") {
        res.setHeader("Set-Cookie", "3x-ui=test-session; Path=/");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
        return;
      }
      if (req.method === "GET" && req.url === "/panel/api/inbounds/list") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            obj: [
              {
                id: 10,
                tag: "inbound-tag-test",
                remark: "Test 3XUI Remark",
                protocol: "socks",
                port: 10999,
                settings: JSON.stringify({
                  accounts: [{ user: "paneluser", pass: "panelpass" }],
                }),
              },
            ],
          })
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });

    try {
      updateRotationConfig({
        enabled: false,
        panelUrl: mockPanel.url,
        adminUser: "admin",
        adminPass: "admin",
      });

      const resCreate = await fetch(`${base}/api/proxies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "3x-ui",
          tag: "inbound-tag-test",
        }),
      });
      assert.strictEqual(resCreate.status, 201);
      const created = await resCreate.json();
      assert.strictEqual(created.type, "3x-ui");
      assert.strictEqual(created.tag, "inbound-tag-test");
      assert.strictEqual(created.protocol, "socks5");
      assert.strictEqual(created.port, 10999);
      assert.strictEqual(created.username, "paneluser");
      assert.strictEqual(created.password, "********");
      assert.strictEqual(created.host, "127.0.0.1");
    } finally {
      await mockPanel.close();
      updateRotationConfig({ enabled: false, panelUrl: "", adminUser: "admin", adminPass: "" });
    }
  });
});

test("POST /api/proxies/:id/sync: sync 3x-ui inbound and rotate password", async () => {
  resetProxiesStore();
  const manualNode = createProxy({
    tag: "manual-node",
    protocol: "socks5",
    host: "1.1.1.1",
    port: 1080,
  });

  await withServer(async (base) => {
    // 404 for unknown id
    const res404 = await fetch(`${base}/api/proxies/unknown-id/sync`, {
      method: "POST",
    });
    assert.strictEqual(res404.status, 404);

    // 400 for non-3x-ui proxy
    const resManual = await fetch(`${base}/api/proxies/${manualNode.id}/sync`, {
      method: "POST",
    });
    assert.strictEqual(resManual.status, 400);

    // Create 3x-ui node directly
    const node3x = createProxy({
      tag: "sync-tag-test",
      type: "3x-ui",
      protocol: "socks5",
      host: "127.0.0.1",
      port: 10999,
      username: "user1",
      password: "pass1",
    });

    let updatedPass = "";
    const mockPanel = await withHttpServer((req, res) => {
      if (req.method === "GET" && req.url === "/csrf-token") {
        res.writeHead(404);
        res.end();
        return;
      }
      if (req.method === "POST" && req.url === "/login") {
        res.setHeader("Set-Cookie", "3x-ui=test-session; Path=/");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
        return;
      }
      if (req.method === "GET" && req.url === "/panel/api/inbounds/list") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            obj: [
              {
                id: 15,
                tag: "sync-tag-test",
                protocol: "socks",
                port: 10999,
                settings: JSON.stringify({
                  accounts: [{ user: "user1", pass: "pass1" }],
                }),
              },
            ],
          })
        );
        return;
      }
      if (req.method === "POST" && req.url === "/panel/api/inbounds/update/15") {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
          const body = JSON.parse(raw);
          const st = JSON.parse(body.settings);
          updatedPass = st.accounts[0].pass;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, msg: "Updated" }));
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    try {
      updateRotationConfig({
        enabled: false,
        panelUrl: mockPanel.url,
        adminUser: "admin",
        adminPass: "admin",
      });

      const resSync = await fetch(`${base}/api/proxies/${node3x.id}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rotatePassword: true }),
      });
      assert.strictEqual(resSync.status, 200);
      const data = await resSync.json();
      assert.strictEqual(data.ok, true);
      assert.strictEqual(data.proxy.password, "********");
      assert.ok(data.proxy.lastSync);
      assert.ok(updatedPass);
    } finally {
      await mockPanel.close();
      updateRotationConfig({ enabled: false, panelUrl: "", adminUser: "admin", adminPass: "" });
    }
  });
});

test("POST /api/3xui/inbound-lookup: lookup inbound by tag", async () => {
  await withServer(async (base) => {
    // Missing tag
    const resNoTag = await fetch(`${base}/api/3xui/inbound-lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.strictEqual(resNoTag.status, 400);

    const mockPanel = await withHttpServer((req, res) => {
      if (req.method === "GET" && req.url === "/csrf-token") {
        res.writeHead(404);
        res.end();
        return;
      }
      if (req.method === "POST" && req.url === "/login") {
        res.setHeader("Set-Cookie", "3x-ui=test-session; Path=/");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
        return;
      }
      if (req.method === "GET" && req.url === "/panel/api/inbounds/list") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            obj: [
              {
                id: 20,
                tag: "lookup-tag",
                protocol: "http",
                port: 8888,
                settings: JSON.stringify({
                  accounts: [{ user: "lookupUser", pass: "lookupPass" }],
                }),
              },
            ],
          })
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });

    try {
      updateRotationConfig({
        enabled: false,
        panelUrl: mockPanel.url,
        adminUser: "admin",
        adminPass: "admin",
      });

      const resLookup = await fetch(`${base}/api/3xui/inbound-lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag: "lookup-tag" }),
      });
      assert.strictEqual(resLookup.status, 200);
      const data = await resLookup.json();
      assert.strictEqual(data.ok, true);
      assert.deepStrictEqual(data.inbound, {
        tag: "lookup-tag",
        protocol: "http",
        port: 8888,
        username: "lookupUser",
        hasPassword: true,
      });
    } finally {
      await mockPanel.close();
      updateRotationConfig({ enabled: false, panelUrl: "", adminUser: "admin", adminPass: "" });
    }
  });
});
