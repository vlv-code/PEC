import "./helpers/setup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { createCredsRouter } from "../src/routes/credsRoutes.js";
import { createProxy, getAllProxies, updateProxy } from "../src/proxies.js";
import { assignInstanceProxy, getInstanceMeta, deleteInstance } from "../src/instances.js";
import { getBuildConfig, saveBuildConfig } from "../src/packager.js";

function setupApp(sharedToken = "test-sync-multi-token") {
  const app = express();
  app.use(express.json());
  app.use(createCredsRouter(() => sharedToken));

  const server = app.listen(0);
  const port = (server.address() as any).port;

  async function postSync(body: any, headers: Record<string, string> = {}) {
    const postData = JSON.stringify(body);
    return new Promise<{ status: number; json: any }>((resolve, reject) => {
      const req = http.request(
        `http://127.0.0.1:${port}/api/sync`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(postData),
            "x-ext-token": headers["x-ext-token"] || sharedToken,
            ...headers,
          },
        },
        (res) => {
          let raw = "";
          res.on("data", (chunk) => (raw += chunk));
          res.on("end", () => {
            try {
              resolve({ status: res.statusCode || 0, json: JSON.parse(raw) });
            } catch (err) {
              reject(err);
            }
          });
        }
      );
      req.on("error", reject);
      req.write(postData);
      req.end();
    });
  }

  async function getPac(query: string = "") {
    return new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = http.request(
        `http://127.0.0.1:${port}/proxy.pac${query ? `?${query}` : ""}`,
        { method: "GET" },
        (res) => {
          let raw = "";
          res.on("data", (chunk) => (raw += chunk));
          res.on("end", () => {
            resolve({ status: res.statusCode || 0, text: raw });
          });
        }
      );
      req.on("error", reject);
      req.end();
    });
  }

  function close() {
    return new Promise<void>((resolve) => server.close(() => resolve()));
  }

  return { port, postSync, getPac, close };
}

test("Task 3: POST /api/sync delivers tailored node config, credentials, and activeProxyId for assigned instance", async () => {
  const { postSync, close } = setupApp();
  const instId = "test-sync-assigned-" + Date.now();

  try {
    const node = createProxy({
      host: "198.51.100.88",
      port: 10888,
      protocol: "socks5",
      name: "Stockholm SOCKS Node",
      tag: "stockholm-node",
      username: "user_se",
      password: "secret_password_se",
      type: "manual",
    });

    assignInstanceProxy(instId, node.id);

    const res = await postSync({ instanceId: instId });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.activeProxyId, node.id, "activeProxyId must match assigned proxy id");
    assert.equal(res.json.config.host, "198.51.100.88", "config.host must match node host");
    assert.equal(res.json.config.port, 10888, "config.port must match node port");
    assert.equal(res.json.config.protocol, "socks5", "config.protocol must match node protocol");
    assert.equal(res.json.creds.user, "user_se", "creds.user must match node username");
    assert.equal(res.json.creds.pass, "secret_password_se", "creds.pass must match node password");
    assert.ok(res.json.config.pacUrl.includes(`proxyId=${encodeURIComponent(node.id)}`), "pacUrl must include proxyId param");
  } finally {
    deleteInstance(instId);
    await close();
  }
});

test("Task 3: POST /api/sync returns availableProxies array and allowUserProxySwitch", async () => {
  const { postSync, close } = setupApp();
  const instId = "test-sync-avail-" + Date.now();

  try {
    const node = createProxy({
      host: "203.0.113.77",
      port: 8080,
      protocol: "http",
      name: "Warsaw HTTP Gateway",
      tag: "warsaw-gw",
      username: "user_pl",
      password: "secret_pl_password",
      type: "manual",
    });

    const res = await postSync({ instanceId: instId });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.availableProxies), "availableProxies must be an array");

    const found = res.json.availableProxies.find((p: any) => p.id === node.id);
    assert.ok(found, "availableProxies must include newly created node");
    assert.equal(found.host, "203.0.113.77");
    assert.equal(found.port, 8080);
    assert.equal(found.protocol, "http");
    assert.equal(found.name, "Warsaw HTTP Gateway");
    assert.equal(found.tag, "warsaw-gw");
    assert.equal((found as any).password, undefined, "availableProxies must NOT expose passwords");

    const bldCfg = getBuildConfig();
    assert.equal(res.json.allowUserProxySwitch, bldCfg.allowUserProxySwitch !== false);
  } finally {
    deleteInstance(instId);
    await close();
  }
});

test("Task 3: POST /api/sync with selectedProxyId reassigns the instance immediately", async () => {
  const { postSync, close } = setupApp();
  const instId = "test-sync-switch-" + Date.now();

  try {
    const nodeA = createProxy({
      host: "192.0.2.11",
      port: 10811,
      protocol: "socks5",
      name: "Node Alpha",
      tag: "node-alpha",
      username: "alpha_user",
      password: "alpha_pass",
      type: "manual",
    });

    const nodeB = createProxy({
      host: "192.0.2.22",
      port: 10822,
      protocol: "socks5",
      name: "Node Beta",
      tag: "node-beta",
      username: "beta_user",
      password: "beta_pass",
      type: "manual",
    });

    // Initial sync assigns to Node A
    assignInstanceProxy(instId, nodeA.id);
    const initialRes = await postSync({ instanceId: instId });
    assert.equal(initialRes.json.activeProxyId, nodeA.id);

    // Sync with selectedProxyId switching to Node B
    const switchRes = await postSync({
      instanceId: instId,
      selectedProxyId: nodeB.id,
    });

    assert.equal(switchRes.status, 200);
    assert.equal(switchRes.json.activeProxyId, nodeB.id, "activeProxyId must switch to node B");
    assert.equal(switchRes.json.config.host, "192.0.2.22");
    assert.equal(switchRes.json.config.port, 10822);
    assert.equal(switchRes.json.creds.user, "beta_user");
    assert.equal(switchRes.json.creds.pass, "beta_pass");

    // Verify persistent metadata was updated
    const meta = getInstanceMeta(instId);
    assert.equal(meta?.assignedProxyId, nodeB.id);
  } finally {
    deleteInstance(instId);
    await close();
  }
});

test("Task 3: GET /proxy.pac?proxyId=... generates tailored PAC script with target node host and port", async () => {
  const { getPac, close } = setupApp();

  try {
    const customNode = createProxy({
      host: "198.51.100.222",
      port: 9999,
      protocol: "socks5",
      name: "PAC Tailored Node",
      tag: "pac-tailored",
      type: "manual",
    });

    const res = await getPac(`proxyId=${encodeURIComponent(customNode.id)}`);
    assert.equal(res.status, 200);
    assert.ok(
      res.text.includes("198.51.100.222:9999"),
      `PAC script must contain target proxy host and port: ${res.text}`
    );
    assert.ok(
      res.text.includes("SOCKS5 198.51.100.222:9999"),
      `PAC script must contain SOCKS5 directive for socks5 node: ${res.text}`
    );
  } finally {
    await close();
  }
});

test("Task 3 Fix: When allowUserProxySwitch is false, selectedProxyId in /api/sync is ignored", async () => {
  const { postSync, close } = setupApp();
  const instId = "test-sync-switch-disabled-" + Date.now();
  const origCfg = getBuildConfig();

  try {
    saveBuildConfig({ allowUserProxySwitch: false });

    const nodeA = createProxy({
      host: "192.0.2.31",
      port: 10831,
      protocol: "socks5",
      name: "Node Alpha",
      tag: "node-alpha-fix",
      type: "manual",
    });

    const nodeB = createProxy({
      host: "192.0.2.32",
      port: 10832,
      protocol: "socks5",
      name: "Node Beta",
      tag: "node-beta-fix",
      type: "manual",
    });

    assignInstanceProxy(instId, nodeA.id);

    const switchRes = await postSync({
      instanceId: instId,
      selectedProxyId: nodeB.id,
    });

    assert.equal(switchRes.status, 200);
    assert.equal(switchRes.json.allowUserProxySwitch, false);
    // Should still be node A, node B switch was ignored
    assert.equal(switchRes.json.activeProxyId, nodeA.id);
    const meta = getInstanceMeta(instId);
    assert.equal(meta?.assignedProxyId, nodeA.id);
  } finally {
    saveBuildConfig({ allowUserProxySwitch: origCfg.allowUserProxySwitch });
    deleteInstance(instId);
    await close();
  }
});

test("Task 3 Fix: When selectedProxyId is empty string or 'default', assignedProxyId is reset/unassigned", async () => {
  const { postSync, close } = setupApp();
  const instId = "test-sync-reset-" + Date.now();

  try {
    const node = createProxy({
      host: "192.0.2.41",
      port: 10841,
      protocol: "socks5",
      name: "Node Assigned",
      tag: "node-assigned-fix",
      type: "manual",
    });

    assignInstanceProxy(instId, node.id);
    assert.equal(getInstanceMeta(instId)?.assignedProxyId, node.id);

    // Send selectedProxyId: "default"
    const resDefault = await postSync({
      instanceId: instId,
      selectedProxyId: "default",
    });
    assert.equal(resDefault.status, 200);
    assert.equal(getInstanceMeta(instId)?.assignedProxyId, undefined);

    // Re-assign and send empty string ""
    assignInstanceProxy(instId, node.id);
    assert.equal(getInstanceMeta(instId)?.assignedProxyId, node.id);

    const resEmpty = await postSync({
      instanceId: instId,
      selectedProxyId: "   ",
    });
    assert.equal(resEmpty.status, 200);
    assert.equal(getInstanceMeta(instId)?.assignedProxyId, undefined);
  } finally {
    deleteInstance(instId);
    await close();
  }
});

test("Task 3 Fix: If effectiveNode is disabled, sync falls back to active proxy", async () => {
  const { postSync, close } = setupApp();
  const instId = "test-sync-disabled-node-" + Date.now();

  try {
    const nodeDisabled = createProxy({
      host: "192.0.2.51",
      port: 10851,
      protocol: "socks5",
      name: "Node Disabled",
      tag: "node-disabled-fix",
      type: "manual",
      enabled: false,
    });

    assignInstanceProxy(instId, nodeDisabled.id);

    const res = await postSync({ instanceId: instId });
    assert.equal(res.status, 200);
    // Should NOT use the disabled node
    assert.notEqual(res.json.activeProxyId, nodeDisabled.id);
    assert.notEqual(res.json.config.host, "192.0.2.51");
  } finally {
    deleteInstance(instId);
    await close();
  }
});
