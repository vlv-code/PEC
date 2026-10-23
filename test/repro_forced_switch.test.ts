import "./helpers/setup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { createCredsRouter } from "../src/routes/credsRoutes.js";
import { createProxy } from "../src/proxies.js";
import { assignInstanceProxy, getInstanceMeta, deleteInstance } from "../src/instances.js";

// Regression suite for the panel-forced proxy switch bug.
//
// Root cause: background.js syncWithServer() echoed its current
// activeProxyId as selectedProxyId on every routine heartbeat; the server
// treats any incoming selectedProxyId as an explicit user choice and called
// assignInstanceProxy(), silently reverting proxy assignments made from the
// admin panel. Fixed by only sending selectedProxyId on explicit user action.

function setupApp(sharedToken = "test-repro-token") {
  const app = express();
  app.use(express.json());
  app.use(createCredsRouter(() => sharedToken));
  const server = app.listen(0);
  const port = (server.address() as any).port;

  async function postSync(body: any) {
    const postData = JSON.stringify(body);
    return new Promise<{ status: number; json: any }>((resolve, reject) => {
      const req = http.request(
        `http://127.0.0.1:${port}/api/sync`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(postData),
            "x-ext-token": sharedToken,
          },
        },
        (res) => {
          let raw = "";
          res.on("data", (chunk) => (raw += chunk));
          res.on("end", () => resolve({ status: res.statusCode || 0, json: JSON.parse(raw) }));
        }
      );
      req.on("error", reject);
      req.write(postData);
      req.end();
    });
  }

  function close() {
    return new Promise<void>((resolve) => server.close(() => resolve()));
  }
  return { postSync, close };
}

test("FIXED: panel-forced proxy switch survives the extension's regular heartbeat sync", async () => {
  const { postSync, close } = setupApp();
  const instId = "repro-forced-switch-" + Date.now();

  try {
    const nodeA = createProxy({
      host: "192.0.2.101", port: 10801, protocol: "socks5",
      name: "Node A", tag: "node-a", type: "manual",
    });
    const nodeB = createProxy({
      host: "192.0.2.102", port: 10802, protocol: "socks5",
      name: "Node B", tag: "node-b", type: "manual",
    });

    // Step 1: instance is currently on Node A (panel assigned earlier,
    // extension synced; the extension stores activeProxyId = A locally).
    assignInstanceProxy(instId, nodeA.id);
    const s1 = await postSync({ instanceId: instId });
    assert.equal(s1.json.activeProxyId, nodeA.id);

    // Step 2: admin force-switches the instance to Node B from the panel.
    assignInstanceProxy(instId, nodeB.id);

    // Step 3: post-fix extension does NOT send selectedProxyId on heartbeat.
    const s3 = await postSync({ instanceId: instId });
    assert.equal(getInstanceMeta(instId)?.assignedProxyId, nodeB.id, "panel assignment must survive");
    assert.equal(s3.json.activeProxyId, nodeB.id, "sync must direct the extension to Node B");
    assert.equal(s3.json.config.host, "192.0.2.102");
    assert.ok(s3.json.config.pacUrl.includes(`proxyId=${encodeURIComponent(nodeB.id)}`));
  } finally {
    deleteInstance(instId);
    await close();
  }
});

test("FIXED: explicit user switch (SET_ACTIVE_PROXY) still overrides the panel assignment", async () => {
  const { postSync, close } = setupApp();
  const instId = "repro-user-switch-" + Date.now();

  try {
    const nodeA = createProxy({
      host: "192.0.2.111", port: 10811, protocol: "socks5",
      name: "Node A2", tag: "node-a2", type: "manual",
    });
    const nodeB = createProxy({
      host: "192.0.2.112", port: 10812, protocol: "socks5",
      name: "Node B2", tag: "node-b2", type: "manual",
    });

    assignInstanceProxy(instId, nodeA.id);

    // User picks Node B in the popup -> SET_ACTIVE_PROXY -> sync(true,true,B)
    const res = await postSync({ instanceId: instId, selectedProxyId: nodeB.id });
    assert.equal(res.json.activeProxyId, nodeB.id);
    assert.equal(getInstanceMeta(instId)?.assignedProxyId, nodeB.id);
    assert.equal(res.json.creds.user, undefined === res.json.creds.user ? "" : res.json.creds.user, "creds present");
  } finally {
    deleteInstance(instId);
    await close();
  }
});

test("FIXED: 'default' user choice keeps the instance unpinned (follows global active proxy)", async () => {
  const { postSync, close } = setupApp();
  const instId = "repro-default-choice-" + Date.now();

  try {
    const node = createProxy({
      host: "192.0.2.121", port: 10821, protocol: "socks5",
      name: "Node D", tag: "node-d", type: "manual",
    });

    // User selects "default" in the popup -> server resets the assignment.
    // NOTE: the globally active proxy is process-wide state shared by the
    // whole test run, so we only assert consistency, not a specific node.
    const res = await postSync({ instanceId: instId, selectedProxyId: "" });
    assert.equal(getInstanceMeta(instId)?.assignedProxyId, undefined, "assignment stays unpinned");
    const fallbackId = res.json.activeProxyId;
    assert.ok(fallbackId, "falls back to the globally active proxy");

    // Post-fix heartbeats must NOT re-pin the instance to the fallback node.
    const res2 = await postSync({ instanceId: instId });
    assert.equal(getInstanceMeta(instId)?.assignedProxyId, undefined, "heartbeat must not pin the instance");
    assert.equal(res2.json.activeProxyId, fallbackId, "still following the global active proxy");
  } finally {
    deleteInstance(instId);
    await close();
  }
});
