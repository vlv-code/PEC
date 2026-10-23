import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import express from "express";
import type { AddressInfo } from "node:net";
import { TEST_TOKEN, TEST_ADMIN_TOKEN } from "./helpers/setup.js";
import { createAppSyncRouter } from "../src/routes/appSyncRoutes.js";
import { clearInstances } from "../src/instances.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createAppSyncRouter(() => TEST_TOKEN, () => TEST_ADMIN_TOKEN));
  return app;
}

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const server = buildApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
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

test("App Sync Token Elevation (M-3): enforces per-instance token least privilege after enrollment", async () => {
  clearInstances();

  await withServer(async (base) => {
    const testAppId = `app_test_elevation_${Date.now()}`;

    // 1. Initial registration with X-Fleet-Token succeeds and returns instanceToken
    const enrollRes = await fetch(`${base}/api/app/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Fleet-Token": TEST_TOKEN,
      },
      body: JSON.stringify({
        appInstanceId: testAppId,
        hostname: "HOST-1",
        username: "user1",
        version: "2.1.0",
      }),
    });

    assert.strictEqual(enrollRes.status, 200);
    const enrollBody = await enrollRes.json();
    assert.strictEqual(enrollBody.ok, true);
    assert.ok(enrollBody.instanceToken, "Response must include newly enrolled instanceToken");
    const issuedToken = enrollBody.instanceToken;

    // 2. Subsequent sync with global X-Fleet-Token MUST BE REJECTED (401 Unauthorized)
    const repeatFleetRes = await fetch(`${base}/api/app/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Fleet-Token": TEST_TOKEN,
      },
      body: JSON.stringify({
        appInstanceId: testAppId,
        hostname: "HOST-1",
        username: "user1",
        version: "2.1.0",
      }),
    });
    assert.strictEqual(repeatFleetRes.status, 401, "Subsequent request with X-Fleet-Token must be rejected with 401");

    // 3. Subsequent sync with X-Instance-Token succeeds (200 OK)
    const instanceTokenRes = await fetch(`${base}/api/app/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Instance-Token": issuedToken,
      },
      body: JSON.stringify({
        appInstanceId: testAppId,
        hostname: "HOST-1",
        username: "user1",
        version: "2.1.0",
      }),
    });
    assert.strictEqual(instanceTokenRes.status, 200);
    const instanceTokenBody = await instanceTokenRes.json();
    assert.strictEqual(instanceTokenBody.ok, true);
    // Should NOT re-issue token
    assert.strictEqual(instanceTokenBody.instanceToken, undefined, "Already enrolled instance must not re-receive instanceToken");

    // 4. Subsequent sync with invalid X-Instance-Token returns 401
    const invalidTokenRes = await fetch(`${base}/api/app/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Instance-Token": "bogus-invalid-token",
      },
      body: JSON.stringify({
        appInstanceId: testAppId,
        hostname: "HOST-1",
        username: "user1",
        version: "2.1.0",
      }),
    });
    assert.strictEqual(invalidTokenRes.status, 401);
  });
});
