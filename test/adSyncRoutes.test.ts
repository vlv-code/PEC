import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert/strict";
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
} from "../src/instances.js";

const SHARED_TOKEN = "test-shared-ext-token-ad-routes";
const FLEET_TOKEN = "test-fleet-token-ad-routes";

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

test("adSyncRoutes: suite for AD sync, kill-switch revocation, and anti-spoofing", async (t) => {
  const initialAdConfig = adSyncService.getConfig();

  t.afterEach(() => {
    adSyncService.updateConfig(initialAdConfig);
    clearInstances();
    _clearPersistentMetaForTesting();
  });

  await t.test("POST /api/sync handles valid vs invalid domainUser when AD_ENABLED=true", async () => {
    const { baseUrl, close } = await createTestServer();
    try {
      adSyncService.updateConfig({
        enabled: true,
        rejectUnknownUsers: true,
      });
      adSyncService.setMockAllowedUsers(["alice.valid", "bob.finance"]);

      // 1. Valid domainUser with NetBIOS domain prefix
      const resValid = await fetch(`${baseUrl}/api/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ext-Token": SHARED_TOKEN,
        },
        body: JSON.stringify({
          instanceId: "inst-valid-user-1",
          domainUser: "CORP\\alice.valid",
          extensionVersion: "2.1.0",
        }),
      });

      assert.equal(resValid.status, 200, "Valid AD user must receive HTTP 200");
      const dataValid = (await resValid.json()) as any;
      assert.equal(dataValid.ok, true);
      assert.ok(dataValid.creds, "Response must include creds");

      const metaValid = getInstanceMeta("inst-valid-user-1");
      assert.ok(metaValid, "Instance meta must be saved");
      assert.equal(metaValid?.domainUser, "CORP\\alice.valid");
      assert.equal(metaValid?.revoked, false);

      // 2. Invalid / unauthorized domainUser (e.g. fired or unauthorized contractor)
      const resInvalid = await fetch(`${baseUrl}/api/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ext-Token": SHARED_TOKEN,
        },
        body: JSON.stringify({
          instanceId: "inst-unauth-user-1",
          domainUser: "CORP\\unauthorized.intruder",
          extensionVersion: "2.1.0",
        }),
      });

      assert.equal(resInvalid.status, 403, "Unauthorized AD user must receive HTTP 403");
      const dataInvalid = (await resInvalid.json()) as any;
      assert.equal(dataInvalid.ok, false);
      assert.equal(dataInvalid.action, "DISABLE_PROXY");
      assert.equal(dataInvalid.error, "Access revoked by Active Directory");

      const metaInvalid = getInstanceMeta("inst-unauth-user-1");
      assert.ok(metaInvalid, "Instance meta must be recorded");
      assert.equal(metaInvalid?.revoked, true, "Instance must be marked as revoked");

      // 3. Anonymous extension request when AD_REJECT_UNKNOWN_USERS=true
      const resAnon = await fetch(`${baseUrl}/api/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ext-Token": SHARED_TOKEN,
        },
        body: JSON.stringify({
          instanceId: "inst-anon-user-1",
        }),
      });

      assert.equal(resAnon.status, 403, "Missing identity must be rejected when rejectUnknownUsers=true");
      const dataAnon = (await resAnon.json()) as any;
      assert.equal(dataAnon.ok, false);
      assert.equal(dataAnon.action, "DISABLE_PROXY");
      assert.equal(dataAnon.error, "AD identity required");
    } finally {
      await close();
    }
  });

  await t.test("immediate PAC generation returns DIRECT for excluded/revoked user", async () => {
    const { baseUrl, close } = await createTestServer();
    try {
      adSyncService.updateConfig({
        enabled: true,
        rejectUnknownUsers: true,
      });
      adSyncService.setMockAllowedUsers(["authorized.employee"]);

      // 1. Establish authorized session first
      const resInit = await fetch(`${baseUrl}/api/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ext-Token": SHARED_TOKEN,
        },
        body: JSON.stringify({
          instanceId: "inst-pac-test-1",
          domainUser: "CORP\\authorized.employee",
        }),
      });
      assert.equal(resInit.status, 200);

      // Verify normal PAC before revocation
      const normalPac = renderPacForInstance("inst-pac-test-1");
      assert.ok(
        normalPac.includes("return "),
        "Normal PAC must contain routing instructions"
      );
      assert.ok(
        !normalPac.includes("Access Revoked"),
        "Normal PAC must not contain Access Revoked comment"
      );

      // 2. Now employee is removed from AD group: next sync triggers revocation
      adSyncService.setMockAllowedUsers([]); // Group membership revoked in AD

      const resRevoke = await fetch(`${baseUrl}/api/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ext-Token": SHARED_TOKEN,
        },
        body: JSON.stringify({
          instanceId: "inst-pac-test-1",
          domainUser: "CORP\\authorized.employee",
        }),
      });
      assert.equal(resRevoke.status, 403);
      const dataRevoke = (await resRevoke.json()) as any;
      assert.equal(dataRevoke.action, "DISABLE_PROXY");

      // 3. Immediately inspect PAC script generated for revoked instance
      const revokedPac = renderPacForInstance("inst-pac-test-1");
      assert.ok(
        revokedPac.includes('return "DIRECT";'),
        "Revoked instance PAC must strictly return DIRECT"
      );
      assert.ok(
        revokedPac.includes("Access Revoked"),
        "Revoked instance PAC must contain Access Revoked banner"
      );
      assert.ok(
        !revokedPac.includes("PROXY "),
        "Revoked instance PAC must not route traffic through corporate proxy"
      );

      // 4. GET /creds endpoint rejects revoked instance with HTTP 403
      const resCreds = await fetch(`${baseUrl}/creds?instanceId=inst-pac-test-1`, {
        headers: { "X-Ext-Token": SHARED_TOKEN },
      });
      assert.equal(resCreds.status, 403, "Revoked instance must be rejected on /creds with 403");
    } finally {
      await close();
    }
  });

  await t.test("anti-spoofing prevents changing domainUser on existing instanceId", async () => {
    const { baseUrl, close } = await createTestServer();
    try {
      adSyncService.updateConfig({ enabled: false }); // Test anti-spoofing invariant independently of AD state

      // 1. Initial registration binds inst-spoof-guard to CORP\alice
      const res1 = await fetch(`${baseUrl}/api/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ext-Token": SHARED_TOKEN,
        },
        body: JSON.stringify({
          instanceId: "inst-spoof-guard",
          domainUser: "CORP\\alice",
        }),
      });
      assert.equal(res1.status, 200);

      const meta = getInstanceMeta("inst-spoof-guard");
      assert.equal(meta?.domainUser, "CORP\\alice");

      // 2. Re-sync with matching domainUser (different case: corp\ALICE) passes cleanly
      const res2 = await fetch(`${baseUrl}/api/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ext-Token": SHARED_TOKEN,
        },
        body: JSON.stringify({
          instanceId: "inst-spoof-guard",
          domainUser: "corp\\ALICE",
        }),
      });
      assert.equal(res2.status, 200, "Case-insensitive identity match must be accepted");

      // 3. Spoofing attempt: reusing same instanceId with different identity (CORP\bob)
      const resSpoof = await fetch(`${baseUrl}/api/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ext-Token": SHARED_TOKEN,
        },
        body: JSON.stringify({
          instanceId: "inst-spoof-guard",
          domainUser: "CORP\\bob",
        }),
      });

      assert.equal(resSpoof.status, 403, "Identity spoofing attempt must be rejected with HTTP 403");
      const dataSpoof = (await resSpoof.json()) as any;
      assert.equal(dataSpoof.ok, false);
      assert.equal(dataSpoof.action, "DISABLE_PROXY");
      assert.ok(
        dataSpoof.error.includes("Domain user mismatch"),
        `Error must indicate domain user mismatch, got: ${dataSpoof.error}`
      );

      // Verify that original instance identity was preserved (alice) and not hijacked by bob
      const originalMeta = getInstanceMeta("inst-spoof-guard");
      assert.equal(
        originalMeta?.domainUser?.toLowerCase(),
        "corp\\alice",
        "Instance must remain bound to original identity"
      );
    } finally {
      await close();
    }
  });

  await t.test("POST /api/app/sync enforces AD identity and revocation for desktop clients", async () => {
    const { baseUrl, close } = await createTestServer();
    try {
      adSyncService.updateConfig({
        enabled: true,
        rejectUnknownUsers: true,
      });
      adSyncService.setMockAllowedUsers(["desktop.dev"]);

      // 1. Authorized desktop user
      const resValid = await fetch(`${baseUrl}/api/app/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Fleet-Token": FLEET_TOKEN,
        },
        body: JSON.stringify({
          appInstanceId: "app-client-01",
          hostname: "DEV-STATION-01",
          username: "desktop.dev",
        }),
      });
      assert.equal(resValid.status, 200);
      const dataValid = (await resValid.json()) as any;
      assert.equal(dataValid.ok, true);

      // 2. Unauthorized desktop user
      const resDenied = await fetch(`${baseUrl}/api/app/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Fleet-Token": FLEET_TOKEN,
        },
        body: JSON.stringify({
          appInstanceId: "app-client-02",
          hostname: "ROGUE-STATION-02",
          username: "unauthorized.user",
        }),
      });
      assert.equal(resDenied.status, 403);
      const dataDenied = (await resDenied.json()) as any;
      assert.equal(dataDenied.action, "DISABLE_PROXY");
      assert.equal(dataDenied.error, "Forbidden: Access revoked by Active Directory");

      const meta = getInstanceMeta("app-client-02");
      assert.equal(meta?.revoked, true);
    } finally {
      await close();
    }
  });
});
