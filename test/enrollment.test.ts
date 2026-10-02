import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { createCredsRouter } from "../src/routes/credsRoutes.js";
import { createInstancesRouter } from "../src/routes/instancesRoutes.js";
import { clearInstances, getActiveInstances, deleteInstance } from "../src/instances.js";

test("A1: per-instance token enrollment model", async (t) => {
  const SHARED_TOKEN = "master-corp-shared-token-xyz-123";
  const app = express();
  app.use(express.json());
  app.use(createCredsRouter(() => SHARED_TOKEN));
  app.use(createInstancesRouter());

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    deleteInstance(testInstanceId);
    clearInstances();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  let enrolledToken: string = "";
  const testInstanceId = `corp-laptop-${Date.now()}`;
  deleteInstance(testInstanceId);

  await t.test("1. Initial sync with shared token generates and returns instanceToken", async () => {
    const res = await fetch(`${baseUrl}/api/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Ext-Token": SHARED_TOKEN,
      },
      body: JSON.stringify({
        instanceId: testInstanceId,
        version: "1.4.0",
      }),
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.ok(data.instanceToken, "Response must include newly enrolled instanceToken");
    assert.strictEqual(typeof data.instanceToken, "string");
    assert.strictEqual(data.instanceToken.length, 48); // 24 bytes hex = 48 chars
    enrolledToken = data.instanceToken;

    // Verify instance record in registry
    const instances = getActiveInstances();
    const inst = instances.find((i) => i.instanceId === testInstanceId);
    assert.ok(inst, "Instance must be registered");
    assert.ok(inst?.tokenHash, "Instance must have tokenHash stored");
    assert.ok(inst?.enrolledAt, "Instance must have enrolledAt timestamp");
  });

  await t.test("2. Subsequent sync using per-instance token authenticates successfully", async () => {
    assert.ok(enrolledToken, "enrolledToken must be present");
    const res = await fetch(`${baseUrl}/api/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Ext-Token": enrolledToken,
        "X-Instance-Id": testInstanceId,
      },
      body: JSON.stringify({
        instanceId: testInstanceId,
        version: "1.4.0",
      }),
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    // Should NOT issue a new token
    assert.strictEqual(data.instanceToken, undefined, "Already enrolled instance must not re-receive instanceToken");
  });

  await t.test("3. GET /creds authenticates with per-instance token", async () => {
    const res = await fetch(`${baseUrl}/creds?instanceId=${encodeURIComponent(testInstanceId)}`, {
      headers: {
        "X-Ext-Token": enrolledToken,
      },
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.user);
    assert.ok(data.pass);
  });

  await t.test("4. Invalid token returns 403 Forbidden", async () => {
    const res = await fetch(`${baseUrl}/api/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Ext-Token": "bogus-wrong-token",
        "X-Instance-Id": testInstanceId,
      },
      body: JSON.stringify({
        instanceId: testInstanceId,
      }),
    });

    assert.strictEqual(res.status, 403);
  });

  await t.test("5. POST /api/instances/:id/revoke-token revokes per-instance token", async () => {
    const revokeRes = await fetch(`${baseUrl}/api/instances/${encodeURIComponent(testInstanceId)}/revoke-token`, {
      method: "POST",
    });
    assert.strictEqual(revokeRes.status, 200);
    const revokeData = await revokeRes.json();
    assert.strictEqual(revokeData.ok, true);
    assert.strictEqual(revokeData.revoked, true);

    // After revocation, old instance token must return 403
    const syncRes = await fetch(`${baseUrl}/api/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Ext-Token": enrolledToken,
        "X-Instance-Id": testInstanceId,
      },
      body: JSON.stringify({
        instanceId: testInstanceId,
      }),
    });
    assert.strictEqual(syncRes.status, 403, "Revoked per-instance token must be rejected");

    // Revoked instance attempting to use shared token must ALSO be rejected
    const sharedSyncRes = await fetch(`${baseUrl}/api/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Ext-Token": SHARED_TOKEN,
        "X-Instance-Id": testInstanceId,
      },
      body: JSON.stringify({
        instanceId: testInstanceId,
      }),
    });
    assert.strictEqual(sharedSyncRes.status, 403, "Revoked instance cannot re-enroll with shared token");
  });

  await t.test("6. Deleting instance clears revocation, allowing clean re-enrollment", async () => {
    deleteInstance(testInstanceId);

    const reEnrollRes = await fetch(`${baseUrl}/api/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Ext-Token": SHARED_TOKEN,
      },
      body: JSON.stringify({
        instanceId: testInstanceId,
      }),
    });

    assert.strictEqual(reEnrollRes.status, 200);
    const reEnrollData = await reEnrollRes.json();
    assert.ok(reEnrollData.instanceToken, "Cleaned instance can enroll anew");
  });

  await t.test("7. Anonymous sync without instanceId succeeds with shared token", async () => {
    const res = await fetch(`${baseUrl}/api/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Ext-Token": SHARED_TOKEN,
      },
      body: JSON.stringify({}),
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.instanceToken, undefined, "Anonymous sync should not issue instanceToken");
  });
});
