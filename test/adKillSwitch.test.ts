import test from "node:test";
import assert from "node:assert";
import express from "express";
import http from "node:http";
import { AddressInfo } from "node:net";
import { createCredsRouter, renderPacForInstance } from "../src/routes/credsRoutes.js";
import { createAppSyncRouter } from "../src/routes/appSyncRoutes.js";
import { adSyncService } from "../src/adSync.js";
import {
  clearInstances,
  _clearPersistentMetaForTesting,
  getInstanceMeta,
  registerHeartbeat,
} from "../src/instances.js";

const SHARED_TOKEN = "test-shared-ext-token-123456";
const FLEET_TOKEN = "test-fleet-token-654321";

async function createTestServer() {
  const app = express();
  app.use(express.json());
  const credsRouter = createCredsRouter(() => SHARED_TOKEN);
  const appSyncRouter = createAppSyncRouter(() => FLEET_TOKEN);

  app.use(credsRouter);
  app.use(appSyncRouter);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("AD Kill-Switch & Anti-Spoofing Suite", async (t) => {
  const initialAdConfig = adSyncService.getConfig();

  t.afterEach(() => {
    adSyncService.updateConfig(initialAdConfig);
    clearInstances();
    _clearPersistentMetaForTesting();
  });

  await t.test("credsRoutes: anti-spoofing binds instanceId to first domainUser and rejects switches", async () => {
    const { baseUrl, close } = await createTestServer();
    try {
      adSyncService.updateConfig({ enabled: false });

      // 1. Initial registration with CORP\alice
      const res1 = await fetch(`${baseUrl}/api/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ext-Token": SHARED_TOKEN,
        },
        body: JSON.stringify({
          instanceId: "inst-spoof-1",
          domainUser: "CORP\\alice",
        }),
      });
      assert.strictEqual(res1.status, 200);
      const data1 = await res1.json() as any;
      assert.strictEqual(data1.ok, true);

      // Verify bound domainUser
      const meta = getInstanceMeta("inst-spoof-1");
      assert.strictEqual(meta?.domainUser, "CORP\\alice");

      // 2. Subsequent sync with same domainUser (different case) passes
      const res2 = await fetch(`${baseUrl}/api/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ext-Token": SHARED_TOKEN,
        },
        body: JSON.stringify({
          instanceId: "inst-spoof-1",
          domainUser: "corp\\ALICE",
        }),
      });
      assert.strictEqual(res2.status, 200);

      // 3. Spoofing attempt: same instanceId presenting CORP\mallory
      const res3 = await fetch(`${baseUrl}/api/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ext-Token": SHARED_TOKEN,
        },
        body: JSON.stringify({
          instanceId: "inst-spoof-1",
          domainUser: "CORP\\mallory",
        }),
      });
      assert.strictEqual(res3.status, 403);
      const data3 = await res3.json() as any;
      assert.strictEqual(data3.ok, false);
      assert.strictEqual(data3.action, "DISABLE_PROXY");
      assert.ok(data3.error.includes("Domain user mismatch"));
    } finally {
      await close();
    }
  });

  await t.test("credsRoutes: AD_ENABLED=true rejects missing domainUser when AD_REJECT_UNKNOWN_USERS=true", async () => {
    const { baseUrl, close } = await createTestServer();
    try {
      adSyncService.updateConfig({
        enabled: true,
        rejectUnknownUsers: true,
      });

      const res = await fetch(`${baseUrl}/api/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ext-Token": SHARED_TOKEN,
        },
        body: JSON.stringify({
          instanceId: "inst-anon-1",
        }),
      });

      assert.strictEqual(res.status, 403);
      const data = await res.json() as any;
      assert.strictEqual(data.ok, false);
      assert.strictEqual(data.action, "DISABLE_PROXY");
      assert.strictEqual(data.error, "AD identity required");
    } finally {
      await close();
    }
  });

  await t.test("credsRoutes: AD Kill-Switch revokes unauthorized user and renders DIRECT in PAC", async () => {
    const { baseUrl, close } = await createTestServer();
    try {
      adSyncService.updateConfig({
        enabled: true,
        rejectUnknownUsers: true,
      });
      adSyncService.setMockAllowedUsers(["allowed.user"]);

      // 1. Allowed user connects cleanly
      const resAllowed = await fetch(`${baseUrl}/api/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ext-Token": SHARED_TOKEN,
        },
        body: JSON.stringify({
          instanceId: "inst-allowed-1",
          domainUser: "CORP\\allowed.user",
        }),
      });
      assert.strictEqual(resAllowed.status, 200);

      // 2. Unauthorized user gets revoked immediately
      const resDenied = await fetch(`${baseUrl}/api/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ext-Token": SHARED_TOKEN,
        },
        body: JSON.stringify({
          instanceId: "inst-revoked-1",
          domainUser: "CORP\\fired.employee",
        }),
      });
      assert.strictEqual(resDenied.status, 403);
      const dataDenied = await resDenied.json() as any;
      assert.strictEqual(dataDenied.ok, false);
      assert.strictEqual(dataDenied.action, "DISABLE_PROXY");
      assert.strictEqual(dataDenied.error, "Access revoked by Active Directory");

      // Verify instance is marked revoked
      const meta = getInstanceMeta("inst-revoked-1");
      assert.strictEqual(meta?.revoked, true);

      // 3. Subsequent calls from revoked instance are rejected
      const resSubsequent = await fetch(`${baseUrl}/creds?instanceId=inst-revoked-1`, {
        headers: { "X-Ext-Token": SHARED_TOKEN },
      });
      assert.strictEqual(resSubsequent.status, 403);

      // 4. PAC generator outputs DIRECT for revoked instance
      const pacText = renderPacForInstance("inst-revoked-1");
      assert.ok(pacText.includes('return "DIRECT";'));
      assert.ok(pacText.includes("Access Revoked"));
    } finally {
      await close();
    }
  });

  await t.test("appSyncRoutes: desktop app sync enforces AD authorization and revokes forbidden client", async () => {
    const { baseUrl, close } = await createTestServer();
    try {
      adSyncService.updateConfig({
        enabled: true,
        rejectUnknownUsers: true,
      });
      adSyncService.setMockAllowedUsers(["desktop.admin"]);

      // 1. Allowed desktop user
      const resAllowed = await fetch(`${baseUrl}/api/app/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Fleet-Token": FLEET_TOKEN,
        },
        body: JSON.stringify({
          appInstanceId: "app-inst-valid-1",
          hostname: "WORKSTATION-01",
          username: "desktop.admin",
        }),
      });
      assert.strictEqual(resAllowed.status, 200);
      const dataAllowed = await resAllowed.json() as any;
      assert.strictEqual(dataAllowed.ok, true);

      // 2. Unauthorized desktop user
      const resDenied = await fetch(`${baseUrl}/api/app/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Fleet-Token": FLEET_TOKEN,
        },
        body: JSON.stringify({
          appInstanceId: "app-inst-rogue-1",
          hostname: "WORKSTATION-02",
          username: "unauthorized.user",
        }),
      });
      assert.strictEqual(resDenied.status, 403);
      const dataDenied = await resDenied.json() as any;
      assert.strictEqual(dataDenied.ok, false);
      assert.strictEqual(dataDenied.action, "DISABLE_PROXY");
      assert.strictEqual(dataDenied.error, "Forbidden: Access revoked by Active Directory");

      // Verify app instance is revoked
      const meta = getInstanceMeta("app-inst-rogue-1");
      assert.strictEqual(meta?.revoked, true);

      // 3. Subsequent desktop sync attempt is blocked
      const resRetry = await fetch(`${baseUrl}/api/app/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Fleet-Token": FLEET_TOKEN,
        },
        body: JSON.stringify({
          appInstanceId: "app-inst-rogue-1",
          hostname: "WORKSTATION-02",
          username: "desktop.admin",
        }),
      });
      assert.strictEqual(resRetry.status, 401);
    } finally {
      await close();
    }
  });

  await t.test("appSyncRoutes: desktop anti-spoofing binds appInstanceId to first username and rejects switches (SEC-AD-2)", async () => {
    const { baseUrl, close } = await createTestServer();
    try {
      adSyncService.updateConfig({ enabled: false });

      // 1. Initial desktop registration with desktop.alice
      const res1 = await fetch(`${baseUrl}/api/app/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Fleet-Token": FLEET_TOKEN,
        },
        body: JSON.stringify({
          appInstanceId: "app-spoof-1",
          hostname: "WORKSTATION-01",
          username: "desktop.alice",
        }),
      });
      assert.strictEqual(res1.status, 200);
      const data1 = await res1.json() as any;
      assert.strictEqual(data1.ok, true);

      // Verify bound username in persistent metadata
      const meta = getInstanceMeta("app-spoof-1");
      assert.strictEqual(meta?.username, "desktop.alice");

      const instanceToken = data1.instanceToken;
      assert.ok(instanceToken, "Must issue enrollment instance token");

      // 2. Subsequent sync with same username (different case) passes
      const res2 = await fetch(`${baseUrl}/api/app/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Instance-Token": instanceToken,
        },
        body: JSON.stringify({
          appInstanceId: "app-spoof-1",
          hostname: "WORKSTATION-01",
          username: "DESKTOP.ALICE",
        }),
      });
      assert.strictEqual(res2.status, 200);

      // 3. Spoofing attempt: same appInstanceId presenting desktop.mallory
      const res3 = await fetch(`${baseUrl}/api/app/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Instance-Token": instanceToken,
        },
        body: JSON.stringify({
          appInstanceId: "app-spoof-1",
          hostname: "WORKSTATION-01",
          username: "desktop.mallory",
        }),
      });
      assert.strictEqual(res3.status, 403);
      const data3 = await res3.json() as any;
      assert.strictEqual(data3.ok, false);
      assert.strictEqual(data3.action, "DISABLE_PROXY");
      assert.ok(data3.error.includes("Username mismatch"));
    } finally {
      await close();
    }
  });

  await t.test("adSync: logs security warning when tlsRejectUnauthorized is false (SEC-AD-1)", () => {
    let warnLogged = false;
    const originalWarn = console.warn;
    console.warn = (...args: any[]) => {
      const msg = args.join(" ");
      if (msg.includes("[SECURITY WARNING] Active Directory LDAPS certificate validation is disabled")) {
        warnLogged = true;
      }
      originalWarn(...args);
    };

    try {
      adSyncService.updateConfig({
        enabled: true,
        tlsRejectUnauthorized: false,
      });
      adSyncService.startPeriodicSync();
      adSyncService.stopPeriodicSync();
      assert.strictEqual(warnLogged, true, "Security warning must be logged when TLS rejection is disabled");
    } finally {
      console.warn = originalWarn;
    }
  });
});
