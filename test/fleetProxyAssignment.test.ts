import "./helpers/setup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { registerHeartbeat, assignInstanceProxy, getActiveInstances, deleteInstance } from "../src/instances.js";
import { createProxy, getAllProxies } from "../src/proxies.js";
import { createInstancesRouter } from "../src/routes/instancesRoutes.js";

test("Task 2: assignInstanceProxy binds proxy to instance and reflects in getActiveInstances", () => {
  const node = createProxy({
    host: "198.51.100.25",
    port: 10808,
    protocol: "socks5",
    name: "Helsinki VLESS Node",
    tag: "fin-vless",
    type: "manual",
  });

  const instId = "test-inst-" + Date.now();
  registerHeartbeat({
    instanceId: instId,
    ip: "127.0.0.1",
    version: "1.0.0",
  });

  assignInstanceProxy(instId, node.id);

  const instances = getActiveInstances();
  const found = instances.find((i) => i.instanceId === instId);
  assert.ok(found, "instance must exist in active instances");
  assert.strictEqual(found.assignedProxyId, node.id);
  assert.strictEqual(found.appliedProxyName, "Helsinki VLESS Node");

  // Unassign proxy (fallback to default)
  assignInstanceProxy(instId, undefined);
  const unassigned = getActiveInstances().find((i) => i.instanceId === instId);
  assert.strictEqual(unassigned?.assignedProxyId, undefined);

  deleteInstance(instId);
});

test("Task 2: registerHeartbeat restores assignedProxyId and appliedProxyName from persistent meta", () => {
  const node = createProxy({
    host: "203.0.113.10",
    port: 10809,
    protocol: "socks5",
    name: "Tokyo Edge Proxy",
    tag: "tokyo-edge",
    type: "manual",
  });

  const instId = "test-inst-persist-" + Date.now();
  // Assign proxy before any heartbeat
  assignInstanceProxy(instId, node.id);

  // First heartbeat
  const inst = registerHeartbeat({
    instanceId: instId,
    ip: "10.0.0.50",
    version: "1.0.0",
  });

  assert.strictEqual(inst.assignedProxyId, node.id);
  assert.strictEqual(inst.appliedProxyName, "Tokyo Edge Proxy");

  deleteInstance(instId);
});

test("Task 2: POST /api/instances/assign-proxy assigns and clears proxy via HTTP endpoint", async (t) => {
  const app = express();
  app.use(express.json());
  app.use(createInstancesRouter());

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const node = createProxy({
    host: "192.0.2.1",
    port: 8080,
    protocol: "http",
    name: "Corporate Squid",
    tag: "corp-squid",
    type: "manual",
  });

  const instId = "http-inst-" + Date.now();
  registerHeartbeat({
    instanceId: instId,
    ip: "127.0.0.1",
    version: "1.0.0",
  });

  // Assign proxy via API
  const assignRes = await fetch(`${baseUrl}/api/instances/assign-proxy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instanceId: instId, proxyId: node.id }),
  });

  assert.strictEqual(assignRes.status, 200);
  const assignBody = await assignRes.json();
  assert.strictEqual(assignBody.ok, true);
  assert.strictEqual(assignBody.instanceId, instId);
  assert.strictEqual(assignBody.assignedProxyId, node.id);

  const found = getActiveInstances().find((i) => i.instanceId === instId);
  assert.strictEqual(found?.assignedProxyId, node.id);
  assert.strictEqual(found?.appliedProxyName, "Corporate Squid");

  // Unassign proxy via API
  const unassignRes = await fetch(`${baseUrl}/api/instances/assign-proxy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instanceId: instId }),
  });

  assert.strictEqual(unassignRes.status, 200);
  const unassignBody = await unassignRes.json();
  assert.strictEqual(unassignBody.ok, true);
  assert.strictEqual(unassignBody.assignedProxyId, null);

  const unassigned = getActiveInstances().find((i) => i.instanceId === instId);
  assert.strictEqual(unassigned?.assignedProxyId, undefined);

  // Missing instanceId returns 400
  const badRes = await fetch(`${baseUrl}/api/instances/assign-proxy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.strictEqual(badRes.status, 400);

  deleteInstance(instId);
});
