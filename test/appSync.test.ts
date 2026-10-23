import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import express from "express";
import type { AddressInfo } from "node:net";
import { TEST_TOKEN, TEST_ADMIN_TOKEN } from "./helpers/setup.js";
import { createAppSyncRouter } from "../src/routes/appSyncRoutes.js";
import {
  registerHeartbeat,
  getActiveInstances,
  getActiveDesktopInstances,
  clearInstances,
} from "../src/instances.js";
import { recordRelease, resetReleasesStore } from "../src/releases.js";

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

test("App Sync API: rejects requests without valid fleet token", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/app/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appInstanceId: "app_test_unauth",
        hostname: "SR-TEST",
        username: "user1",
        version: "2.1.0",
      }),
    });
    assert.strictEqual(res.status, 401);
  });
});

test("App Sync API: registers desktop client, returns proxy info, and pairs with extension", async () => {
  clearInstances();
  resetReleasesStore();

  // 1. Register mock extension instance
  registerHeartbeat({
    instanceId: "inst_pair_999",
    ip: "127.0.0.1",
    version: "1.2.0",
  });

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/app/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Fleet-Token": TEST_TOKEN,
      },
      body: JSON.stringify({
        appInstanceId: "app_pair_01",
        hostname: "WORKSTATION-01",
        username: "CORP\\test_user",
        version: "2.1.0",
        os: "Windows 10 Pro (10.0.19045)",
        clientType: "windows-gui",
        pairedExtension: {
          instanceId: "inst_pair_999",
          browser: "yandex",
        },
      }),
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.ok(body.activeProxy);
    assert.ok(body.update);
    assert.strictEqual(body.update.hasUpdate, false);
    assert.ok(Array.isArray(body.serverRules), "serverRules should be an array");

    // Verify desktop instance registered
    const desktopInstances = getActiveDesktopInstances();
    const desktop = desktopInstances.find((d) => d.appInstanceId === "app_pair_01");
    assert.ok(desktop);
    assert.strictEqual(desktop.username, "CORP\\test_user");
    assert.strictEqual(desktop.hostname, "WORKSTATION-01");
    assert.strictEqual(desktop.pairedExtension?.instanceId, "inst_pair_999");

    // Verify extension instance was cross-linked
    const extInstances = getActiveInstances();
    const ext = extInstances.find((i) => i.instanceId === "inst_pair_999");
    assert.ok(ext);
    assert.strictEqual(ext.username, "CORP\\test_user");
    assert.strictEqual(ext.pairedAppId, "app_pair_01");
    assert.strictEqual(ext.pairedHostname, "WORKSTATION-01");
    assert.strictEqual(ext.verifiedByApp, true);

    // Verify subsequent extension heartbeat does not erase paired username
    const refreshed = registerHeartbeat({
      instanceId: "inst_pair_999",
      ip: "127.0.0.1",
      version: "1.2.0",
    });
    assert.strictEqual(refreshed.username, "CORP\\test_user");
    assert.strictEqual(refreshed.pairedAppId, "app_pair_01");
  });
});

test("App Sync API: evaluates update notification when server has newer release", async () => {
  resetReleasesStore();

  recordRelease({
    type: "app",
    version: "2.2.0",
    builtAt: new Date().toISOString(),
    sha256: "sha256-new-app-version",
    fileName: "pec-client-windows-x64.zip",
    filePath: "dist/releases/apps/2.2.0/pec-client-windows-x64.zip",
    isActive: true,
  });

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/app/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Fleet-Token": TEST_TOKEN,
      },
      body: JSON.stringify({
        appInstanceId: "app_old_client",
        hostname: "SR-WORKSTATION",
        username: "CORP\\user2",
        version: "2.1.0",
      }),
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.update.hasUpdate, true);
    assert.strictEqual(body.update.latestVersion, "2.2.0");
    assert.strictEqual(body.update.sha256, "sha256-new-app-version");
  });
});

test("App Sync API: rejects invalid appInstanceId and malformed pairedExtension cleanly", async () => {
  await withServer(async (base) => {
    // Empty appInstanceId
    const resEmpty = await fetch(`${base}/api/app/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Fleet-Token": TEST_TOKEN,
      },
      body: JSON.stringify({
        appInstanceId: "   ",
        hostname: "SR-TEST",
      }),
    });
    assert.strictEqual(resEmpty.status, 400);

    // Prototype pollution appInstanceId
    const resProto = await fetch(`${base}/api/app/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Fleet-Token": TEST_TOKEN,
      },
      body: JSON.stringify({
        appInstanceId: "__proto__",
        hostname: "SR-TEST",
      }),
    });
    assert.strictEqual(resProto.status, 400);

    // Malformed pairedExtension (array)
    const resArrayPair = await fetch(`${base}/api/app/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Fleet-Token": TEST_TOKEN,
      },
      body: JSON.stringify({
        appInstanceId: "app_valid_01",
        hostname: "SR-TEST",
        pairedExtension: ["not-an-object"],
      }),
    });
    assert.strictEqual(resArrayPair.status, 400);

    // Prototype pollution pairedExtension.instanceId
    const resProtoPair = await fetch(`${base}/api/app/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Fleet-Token": TEST_TOKEN,
      },
      body: JSON.stringify({
        appInstanceId: "app_valid_02",
        hostname: "SR-TEST",
        pairedExtension: { instanceId: "__proto__" },
      }),
    });
    assert.strictEqual(resProtoPair.status, 400);
  });
});

test("App Sync API: GET /api/app/instances supports cookie authentication", async () => {
  const customApp = express();
  customApp.use(express.json());
  customApp.use(
    createAppSyncRouter(
      () => TEST_TOKEN,
      () => TEST_ADMIN_TOKEN,
      (req) => req.headers["x-custom-session"] === "valid-session"
    )
  );

  const server = customApp.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // Without token or cookie: 401
    const resNoAuth = await fetch(`${base}/api/app/instances`);
    assert.strictEqual(resNoAuth.status, 401);

    // With cookieAuth: 200
    const resCookie = await fetch(`${base}/api/app/instances`, {
      headers: { "x-custom-session": "valid-session" },
    });
    assert.strictEqual(resCookie.status, 200);
    const body = await resCookie.json();
    assert.strictEqual(body.ok, true);
    assert.ok(Array.isArray(body.instances));
  } finally {
    if (typeof (server as any).closeAllConnections === "function") {
      (server as any).closeAllConnections();
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("App Sync API: availableProxies, proxy assignment, and instance deletion", async () => {
  const customApp = express();
  customApp.use(express.json());
  customApp.use(
    createAppSyncRouter(
      () => TEST_TOKEN,
      () => TEST_ADMIN_TOKEN
    )
  );

  const server = customApp.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const syncRes = await fetch(`${base}/api/app/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Fleet-Token": TEST_TOKEN,
      },
      body: JSON.stringify({
        appInstanceId: "app_test_assign_1",
        hostname: "WORKSTATION-A",
        username: "CORP\\user_a",
        version: "2.1.0",
      }),
    });
    assert.strictEqual(syncRes.status, 200);
    const syncBody = await syncRes.json();
    assert.strictEqual(syncBody.ok, true);
    assert.ok(Array.isArray(syncBody.availableProxies));
    for (const p of syncBody.availableProxies) {
      assert.strictEqual((p as any).user, undefined, "availableProxies must not leak usernames");
      assert.strictEqual((p as any).pass, undefined, "availableProxies must not leak passwords");
      assert.strictEqual((p as any).password, undefined, "availableProxies must not leak passwords");
    }

    // Assign proxy to this desktop client
    const assignRes = await fetch(`${base}/api/app/instances/app_test_assign_1/assign-proxy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Token": TEST_ADMIN_TOKEN,
      },
      body: JSON.stringify({ proxyId: "default" }),
    });
    assert.strictEqual(assignRes.status, 200);
    const assignBody = await assignRes.json();
    assert.strictEqual(assignBody.ok, true);
    assert.strictEqual(assignBody.assignedProxyId, null);

    // Delete instance
    const delRes = await fetch(`${base}/api/app/instances/app_test_assign_1`, {
      method: "DELETE",
      headers: {
        "X-Admin-Token": TEST_ADMIN_TOKEN,
      },
    });
    assert.strictEqual(delRes.status, 200);
    const delBody = await delRes.json();
    assert.strictEqual(delBody.ok, true);
  } finally {
    if (typeof (server as any).closeAllConnections === "function") {
      (server as any).closeAllConnections();
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
