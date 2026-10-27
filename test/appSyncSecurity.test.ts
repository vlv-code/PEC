import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import express from "express";
import type { AddressInfo } from "node:net";
import { TEST_TOKEN, TEST_ADMIN_TOKEN } from "./helpers/setup.js";
import { createAppSyncRouter } from "../src/routes/appSyncRoutes.js";
import {
  registerHeartbeat,
  registerDesktopHeartbeat,
  getActiveInstances,
  getActiveDesktopInstances,
  clearInstances,
  setDesktopInstanceProxy,
  getInstanceMeta,
  _clearPersistentMetaForTesting,
  deleteDesktopInstance,
  acquireInstanceMutex,
  _setPersistentMetaEntryForTesting,
} from "../src/instances.js";
import { recordRelease, resetReleasesStore } from "../src/releases.js";
import { createProxy, getAllProxies, updateProxy } from "../src/proxies.js";
import { getBuildConfig, saveBuildConfig } from "../src/packager.js";
import { isNewerVersion, compareSemver } from "../src/utils/semver.js";

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

// -------------------------------------------------------------
// Requirement 1 & 4 (M-4): Semver utility and update checks
// -------------------------------------------------------------

test("M-4: compareSemver and isNewerVersion correctness", () => {
  // Newer candidate
  assert.strictEqual(compareSemver("2.2.0", "2.1.0"), 1);
  assert.strictEqual(isNewerVersion("2.2.0", "2.1.0"), true);
  assert.strictEqual(compareSemver("v2.2.0", "2.1.0"), 1);
  assert.strictEqual(isNewerVersion("v2.2.0", "2.1.0"), true);

  // Equal version
  assert.strictEqual(compareSemver("2.1.0", "2.1.0"), 0);
  assert.strictEqual(isNewerVersion("2.1.0", "2.1.0"), false);
  assert.strictEqual(compareSemver("2.1.0", "v2.1.0"), 0);
  assert.strictEqual(isNewerVersion("2.1.0", "v2.1.0"), false);

  // Older candidate
  assert.strictEqual(compareSemver("2.0.9", "2.1.0"), -1);
  assert.strictEqual(isNewerVersion("2.0.9", "2.1.0"), false);

  // Numeric vs lexical comparison (2.10.0 > 2.9.0)
  assert.strictEqual(compareSemver("2.10.0", "2.9.0"), 1);
  assert.strictEqual(isNewerVersion("2.10.0", "2.9.0"), true);

  // Patch differences
  assert.strictEqual(compareSemver("1.0.1", "1.0.0"), 1);
  assert.strictEqual(isNewerVersion("1.0.1", "1.0.0"), true);

  // Pre-release precedence: 1.0.0 > 1.0.0-beta
  assert.strictEqual(compareSemver("1.0.0", "1.0.0-beta"), 1);
  assert.strictEqual(isNewerVersion("1.0.0", "1.0.0-beta"), true);
  assert.strictEqual(compareSemver("1.0.0-beta", "1.0.0"), -1);
  assert.strictEqual(isNewerVersion("1.0.0-beta", "1.0.0"), false);

  // SemVer 2.0.0 dot-separated pre-release identifiers:
  // Numeric comparison for numeric identifiers: beta.2 < beta.11
  assert.strictEqual(compareSemver("1.0.0-beta.2", "1.0.0-beta.11"), -1);
  assert.strictEqual(isNewerVersion("1.0.0-beta.11", "1.0.0-beta.2"), true);
  assert.strictEqual(compareSemver("1.0.0-rc.10", "1.0.0-rc.9"), 1);
  assert.strictEqual(isNewerVersion("1.0.0-rc.10", "1.0.0-rc.9"), true);

  // Numeric vs non-numeric identifier precedence: 1.0.0-alpha.1 < 1.0.0-alpha.beta
  assert.strictEqual(compareSemver("1.0.0-alpha.1", "1.0.0-alpha.beta"), -1);
  assert.strictEqual(compareSemver("1.0.0-alpha", "1.0.0-alpha.1"), -1);

  // SemVer 2.0.0 build metadata must be ignored in precedence
  assert.strictEqual(compareSemver("1.0.0+build1", "1.0.0+build2"), 0);
  assert.strictEqual(isNewerVersion("1.0.0+build2", "1.0.0+build1"), false);
  assert.strictEqual(compareSemver("1.0.0-rc.1+build.1", "1.0.0-rc.1+build.2"), 0);
  assert.strictEqual(isNewerVersion("1.0.0-rc.1+build.2", "1.0.0-rc.1+build.1"), false);
  assert.strictEqual(isNewerVersion("1.0.1+build1", "1.0.0+build2"), true);

  // Empty or invalid handling
  assert.strictEqual(isNewerVersion("", "2.1.0"), false);
  assert.strictEqual(isNewerVersion("2.1.0", ""), true);
  assert.strictEqual(isNewerVersion("", ""), false);
});

test("M-4: hasUpdate is false when client version is greater than or equal to active release version", async () => {
  resetReleasesStore();

  recordRelease({
    type: "app",
    version: "2.5.0",
    builtAt: new Date().toISOString(),
    sha256: "sha256-test-release",
    fileName: "pec-client-2.5.0.zip",
    filePath: "dist/releases/apps/2.5.0/pec-client.zip",
    isActive: true,
  });

  await withServer(async (base) => {
    // 1. Client version EQUAL to active release version -> hasUpdate must be FALSE
    const resEqual = await fetch(`${base}/api/app/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Fleet-Token": TEST_TOKEN,
      },
      body: JSON.stringify({
        appInstanceId: "app_ver_equal",
        hostname: "HOST-01",
        version: "2.5.0",
      }),
    });
    assert.strictEqual(resEqual.status, 200);
    const bodyEqual = await resEqual.json();
    assert.strictEqual(bodyEqual.ok, true);
    assert.strictEqual(bodyEqual.update.hasUpdate, false);

    // 2. Client version GREATER than active release version -> hasUpdate must be FALSE
    const resGreater = await fetch(`${base}/api/app/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Fleet-Token": TEST_TOKEN,
      },
      body: JSON.stringify({
        appInstanceId: "app_ver_greater",
        hostname: "HOST-02",
        version: "2.6.0",
      }),
    });
    assert.strictEqual(resGreater.status, 200);
    const bodyGreater = await resGreater.json();
    assert.strictEqual(bodyGreater.ok, true);
    assert.strictEqual(bodyGreater.update.hasUpdate, false);

    // 3. Client version OLDER than active release version -> hasUpdate must be TRUE
    const resOlder = await fetch(`${base}/api/app/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Fleet-Token": TEST_TOKEN,
      },
      body: JSON.stringify({
        appInstanceId: "app_ver_older",
        hostname: "HOST-03",
        version: "2.4.9",
      }),
    });
    assert.strictEqual(resOlder.status, 200);
    const bodyOlder = await resOlder.json();
    assert.strictEqual(bodyOlder.ok, true);
    assert.strictEqual(bodyOlder.update.hasUpdate, true);
    assert.strictEqual(bodyOlder.update.latestVersion, "2.5.0");
  });
});

// -------------------------------------------------------------
// Requirement 2 (H-2): allowUserProxySwitch controls proxy selection
// -------------------------------------------------------------

test("H-2: Client cannot switch proxy when allowUserProxySwitch is false", async () => {
  clearInstances();
  _clearPersistentMetaForTesting();
  const origCfg = getBuildConfig();

  const nodeAdmin = createProxy({
    host: "10.100.1.10",
    port: 10810,
    protocol: "socks5",
    name: "Admin Fixed Node",
    tag: "admin-fixed",
    type: "manual",
  });

  const nodeUserChoice = createProxy({
    host: "10.100.1.20",
    port: 10820,
    protocol: "socks5",
    name: "User Desired Node",
    tag: "user-desired",
    type: "manual",
  });

  try {
    // 1. Admin assigns nodeAdmin to instance and disables user proxy switching
    saveBuildConfig({ allowUserProxySwitch: false });
    const appId = "app_switch_test_01";
    setDesktopInstanceProxy(appId, nodeAdmin.id);

    await withServer(async (base) => {
      // Client tries to switch to nodeUserChoice by ID
      const resById = await fetch(`${base}/api/app/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Fleet-Token": TEST_TOKEN,
        },
        body: JSON.stringify({
          appInstanceId: appId,
          hostname: "HOST-SWITCH-TEST",
          version: "2.1.0",
          selectedProxyId: nodeUserChoice.id,
        }),
      });

      assert.strictEqual(resById.status, 200);
      const bodyById = await resById.json();
      assert.strictEqual(bodyById.ok, true);
      assert.strictEqual(bodyById.allowUserProxySwitch, false);
      // Active proxy MUST remain nodeAdmin
      assert.strictEqual(bodyById.activeProxy.id, nodeAdmin.id);

      const appToken = bodyById.instanceToken;
      assert.ok(appToken, "Instance token must be issued on initial enrollment");

      // Verify server-side instance meta was not modified
      const meta = getInstanceMeta(appId);
      assert.strictEqual(meta?.assignedProxyId, nodeAdmin.id);

      // Client tries to switch to nodeUserChoice by host/port
      const resByHost = await fetch(`${base}/api/app/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Instance-Token": appToken,
        },
        body: JSON.stringify({
          appInstanceId: appId,
          hostname: "HOST-SWITCH-TEST",
          version: "2.1.0",
          selectedProxyHost: nodeUserChoice.host,
          selectedProxyPort: nodeUserChoice.port,
        }),
      });

      assert.strictEqual(resByHost.status, 200);
      const bodyByHost = await resByHost.json();
      assert.strictEqual(bodyByHost.ok, true);
      assert.strictEqual(bodyByHost.activeProxy.id, nodeAdmin.id);
    });

    // 2. When allowUserProxySwitch is true, client CAN switch proxy
    saveBuildConfig({ allowUserProxySwitch: true });
    await withServer(async (base) => {
      // Use a new instance to test enrollment + allowed switch cleanly
      const appIdAllowed = "app_switch_test_allowed";
      const resAllowed = await fetch(`${base}/api/app/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Fleet-Token": TEST_TOKEN,
        },
        body: JSON.stringify({
          appInstanceId: appIdAllowed,
          hostname: "HOST-SWITCH-TEST",
          version: "2.1.0",
          selectedProxyId: nodeUserChoice.id,
        }),
      });

      assert.strictEqual(resAllowed.status, 200);
      const bodyAllowed = await resAllowed.json();
      assert.strictEqual(bodyAllowed.ok, true);
      assert.strictEqual(bodyAllowed.allowUserProxySwitch, true);
      assert.strictEqual(bodyAllowed.activeProxy.id, nodeUserChoice.id);

      const meta = getInstanceMeta(appIdAllowed);
      assert.strictEqual(meta?.assignedProxyId, nodeUserChoice.id);
    });
  } finally {
    saveBuildConfig({ allowUserProxySwitch: origCfg.allowUserProxySwitch });
  }
});

// -------------------------------------------------------------
// Requirement 3 (M-1): Mutex protection & pairedExtension safety
// -------------------------------------------------------------

test("M-1: Mutex prevents concurrent pre-enrollment race condition and hijacking of cleanAppId", async () => {
  clearInstances();
  _clearPersistentMetaForTesting();

  const appId = "app_race_target_id";

  await withServer(async (base) => {
    // Send two concurrent sync requests with same appId using fleet token
    const makeReq = () =>
      fetch(`${base}/api/app/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Fleet-Token": TEST_TOKEN,
        },
        body: JSON.stringify({
          appInstanceId: appId,
          hostname: "RACE-HOST",
          version: "2.1.0",
        }),
      });

    const [res1, res2] = await Promise.all([makeReq(), makeReq()]);

    const statuses = [res1.status, res2.status].sort();
    // One request must succeed with 200 (enrollment completed)
    // The concurrent/racing request must fail with 401 because instance is already enrolled and requires X-Instance-Token
    assert.strictEqual(statuses[0], 200, "One request must successfully enroll");
    assert.strictEqual(statuses[1], 401, "Racing request without instance token must be rejected");

    const successRes = res1.status === 200 ? res1 : res2;
    const bodySuccess = await successRes.json();
    assert.ok(bodySuccess.instanceToken, "Successful enrollment must return instanceToken");

    // Subsequent request with the issued instance token succeeds
    const resWithToken = await fetch(`${base}/api/app/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Instance-Token": bodySuccess.instanceToken,
      },
      body: JSON.stringify({
        appInstanceId: appId,
        hostname: "RACE-HOST",
        version: "2.1.0",
      }),
    });
    assert.strictEqual(resWithToken.status, 200);
  });
});

test("M-1: pairedExtension cannot hijack another instance's pairing or inject phantom extensions", async () => {
  clearInstances();
  _clearPersistentMetaForTesting();

  // 1. Setup legitimate extension instance and pair it with legitimate app
  registerHeartbeat({
    instanceId: "ext_legit_100",
    ip: "127.0.0.1",
    version: "1.0.0",
  });

  await withServer(async (base) => {
    // Legit desktop app pairs with ext_legit_100
    const resLegit = await fetch(`${base}/api/app/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Fleet-Token": TEST_TOKEN,
      },
      body: JSON.stringify({
        appInstanceId: "app_legit_100",
        hostname: "HOST-LEGIT",
        username: "CORP\\alice",
        version: "2.1.0",
        pairedExtension: {
          instanceId: "ext_legit_100",
          browser: "chrome",
        },
      }),
    });
    assert.strictEqual(resLegit.status, 200);

    const extAfterLegit = getActiveInstances().find((e) => e.instanceId === "ext_legit_100");
    assert.strictEqual(extAfterLegit?.pairedAppId, "app_legit_100");
    assert.strictEqual(extAfterLegit?.username, "CORP\\alice");

    // 2. Attacker desktop app attempts to hijack ext_legit_100's pairing
    const resAttacker = await fetch(`${base}/api/app/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Fleet-Token": TEST_TOKEN,
      },
      body: JSON.stringify({
        appInstanceId: "app_attacker_666",
        hostname: "HOST-ATTACKER",
        username: "CORP\\mallory",
        version: "2.1.0",
        pairedExtension: {
          instanceId: "ext_legit_100",
          browser: "firefox",
        },
      }),
    });
    assert.strictEqual(resAttacker.status, 200);

    // Verify ext_legit_100 was NOT hijacked
    const extAfterAttacker = getActiveInstances().find((e) => e.instanceId === "ext_legit_100");
    assert.strictEqual(extAfterAttacker?.pairedAppId, "app_legit_100", "pairedAppId must NOT be hijacked");
    assert.strictEqual(extAfterAttacker?.username, "CORP\\alice", "username must NOT be hijacked");

    const attackerDesktop = getActiveDesktopInstances().find((d) => d.appInstanceId === "app_attacker_666");
    assert.strictEqual(attackerDesktop?.pairedExtension, undefined, "Attacker desktop record must not have hijacked pairing");

    // 3. Desktop app attempts to pair with non-existent extension ID
    const resPhantom = await fetch(`${base}/api/app/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Fleet-Token": TEST_TOKEN,
      },
      body: JSON.stringify({
        appInstanceId: "app_phantom_test",
        hostname: "HOST-PHANTOM",
        username: "CORP\\bob",
        version: "2.1.0",
        pairedExtension: {
          instanceId: "ext_non_existent_404",
          browser: "chrome",
        },
      }),
    });
    assert.strictEqual(resPhantom.status, 200);

    // Verify phantom extension metadata was NOT created
    const phantomMeta = getInstanceMeta("ext_non_existent_404");
    assert.strictEqual(phantomMeta, undefined, "Phantom extension must not be created in persistentMeta");

    // 4. Desktop app attempts to pair with a REVOKED extension
    const revokedExtId = "ext_revoked_999";
    registerHeartbeat({
      instanceId: revokedExtId,
      ip: "127.0.0.1",
      version: "1.0.0",
    });
    _setPersistentMetaEntryForTesting(revokedExtId, { revoked: true });

    const resRevoked = await fetch(`${base}/api/app/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Fleet-Token": TEST_TOKEN,
      },
      body: JSON.stringify({
        appInstanceId: "app_pair_revoked",
        hostname: "HOST-REVOKED",
        username: "CORP\\charlie",
        version: "2.1.0",
        pairedExtension: {
          instanceId: revokedExtId,
          browser: "chrome",
        },
      }),
    });
    assert.strictEqual(resRevoked.status, 200);

    const revokedDesktop = getActiveDesktopInstances().find((d) => d.appInstanceId === "app_pair_revoked");
    assert.strictEqual(revokedDesktop?.pairedExtension, undefined, "Revoked extension must not be paired");
  });
});

test("M-1: deleteDesktopInstance cleanly unpairs linked extension", () => {
  clearInstances();
  _clearPersistentMetaForTesting();

  registerHeartbeat({
    instanceId: "ext_linked_01",
    ip: "127.0.0.1",
    version: "1.0.0",
  });

  const desktop = registerDesktopHeartbeat({
    appInstanceId: "app_linked_01",
    hostname: "WORKSTATION-LINKED",
    username: "CORP\\user_link",
    version: "2.1.0",
    ip: "127.0.0.1",
    pairedExtension: {
      instanceId: "ext_linked_01",
      browser: "chrome",
    },
  });
  assert.ok(desktop.pairedExtension);

  const extBefore = getActiveInstances().find((e) => e.instanceId === "ext_linked_01");
  assert.strictEqual(extBefore?.pairedAppId, "app_linked_01");

  // Delete desktop instance
  const deleted = deleteDesktopInstance("app_linked_01");
  assert.strictEqual(deleted, true);

  // Extension must now be unlinked
  const extAfter = getActiveInstances().find((e) => e.instanceId === "ext_linked_01");
  assert.strictEqual(extAfter?.pairedAppId, undefined, "Extension pairedAppId must be cleared");
  assert.strictEqual(getInstanceMeta("ext_linked_01")?.pairedAppId, undefined);
});

test("H-2: Client can reset proxy to default when allowUserProxySwitch is true", async () => {
  clearInstances();
  _clearPersistentMetaForTesting();
  const origCfg = getBuildConfig();

  const nodeUser = createProxy({
    host: "10.200.1.50",
    port: 10850,
    protocol: "socks5",
    name: "User Switchable Node",
    tag: "user-switchable",
    type: "manual",
  });

  try {
    saveBuildConfig({ allowUserProxySwitch: true });
    const appId = "app_reset_test_01";

    await withServer(async (base) => {
      // 1. Client switches to nodeUser
      const resSwitch = await fetch(`${base}/api/app/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Fleet-Token": TEST_TOKEN,
        },
        body: JSON.stringify({
          appInstanceId: appId,
          hostname: "HOST-RESET",
          version: "2.1.0",
          selectedProxyId: nodeUser.id,
        }),
      });
      assert.strictEqual(resSwitch.status, 200);
      const bodySwitch = await resSwitch.json();
      assert.strictEqual(bodySwitch.activeProxy.id, nodeUser.id);
      const appToken = bodySwitch.instanceToken;

      // 2. Client sends selectedProxyId: 'default' to reset back to default
      const resReset = await fetch(`${base}/api/app/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Instance-Token": appToken,
        },
        body: JSON.stringify({
          appInstanceId: appId,
          hostname: "HOST-RESET",
          version: "2.1.0",
          selectedProxyId: "default",
        }),
      });
      assert.strictEqual(resReset.status, 200);
      const meta = getInstanceMeta(appId);
      assert.strictEqual(meta?.assignedProxyId, undefined, "assignedProxyId must be cleared");
    });
  } finally {
    saveBuildConfig({ allowUserProxySwitch: origCfg.allowUserProxySwitch });
  }
});

test("H-2: Disabled proxy falls back to active proxy in desktop sync", async () => {
  clearInstances();
  _clearPersistentMetaForTesting();

  const nodeDisabled = createProxy({
    host: "10.200.1.60",
    port: 10860,
    protocol: "socks5",
    name: "Disabled Node",
    tag: "disabled-node",
    type: "manual",
  });
  updateProxy(nodeDisabled.id, { enabled: false } as any);

  const appId = "app_disabled_fallback_test";
  setDesktopInstanceProxy(appId, nodeDisabled.id);

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/app/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Fleet-Token": TEST_TOKEN,
      },
      body: JSON.stringify({
        appInstanceId: appId,
        hostname: "HOST-DISABLED-TEST",
        version: "2.1.0",
      }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    // Active proxy must not be the disabled node
    assert.notStrictEqual(body.activeProxy.id, nodeDisabled.id);
  });
});

test("M-1: acquireInstanceMutex handles empty/blank IDs cleanly", async () => {
  const release1 = await acquireInstanceMutex("");
  assert.strictEqual(typeof release1, "function");
  release1();

  const release2 = await acquireInstanceMutex("   ");
  assert.strictEqual(typeof release2, "function");
  release2();
});

