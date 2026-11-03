import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import express from "express";
import type { AddressInfo } from "node:net";
import { TEST_TOKEN, TEST_ADMIN_TOKEN } from "./helpers/setup.js";
import { createAppSyncRouter } from "../src/routes/appSyncRoutes.js";
import { createAppBuilderRouter } from "../src/routes/appBuilderRoutes.js";
import { clearInstances } from "../src/instances.js";
import { getAppBuildConfig, saveAppBuildConfig } from "../src/appPackager.js";
import { saveProfile, getAllProfiles } from "../src/routing.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createAppSyncRouter(() => TEST_TOKEN, () => TEST_ADMIN_TOKEN));
  app.use(createAppBuilderRouter(() => TEST_TOKEN, () => TEST_ADMIN_TOKEN));
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

test("App Rules Branch: REST endpoints GET and POST /api/app-rules", async () => {
  await withServer(async (base) => {
    // 1. GET /api/app-rules
    const getRes = await fetch(`${base}/api/app-rules`, {
      headers: { "X-Admin-Token": TEST_ADMIN_TOKEN }
    });
    assert.strictEqual(getRes.status, 200);
    const getBody = await getRes.json();
    assert.strictEqual(getBody.ok, true);
    assert.ok(Array.isArray(getBody.rules));
    assert.strictEqual(typeof getBody.includeExtensionRules, "boolean");

    // 2. POST /api/app-rules updates rules and toggle
    const postRes = await fetch(`${base}/api/app-rules`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Token": TEST_ADMIN_TOKEN
      },
      body: JSON.stringify({
        rules: [
          {
            id: "rule_custom_dev",
            processName: "curl.exe; git.exe",
            targetDomains: "*.internal.corp",
            targetHosts: "10.0.0.0/8",
            targetPorts: "80; 443",
            protocol: "tcp",
            action: "proxy"
          }
        ],
        includeExtensionRules: false
      })
    });
    assert.strictEqual(postRes.status, 200);
    const postBody = await postRes.json();
    assert.strictEqual(postBody.ok, true);
    assert.strictEqual(postBody.includeExtensionRules, false);
    assert.strictEqual(postBody.rules.length, 1);
    assert.strictEqual(postBody.rules[0].processName, "curl.exe; git.exe");
  });
});

test("App Rules Branch: Desktop sync excludes extension rules by default, includes when enabled", async () => {
  clearInstances();

  // Create mock routing profile with domain rules
  const testProfile = saveProfile({
    name: "Corp Profile With Domain Rules",
    defaultPolicy: "direct",
    targetScope: "all",
    rules: [
      {
        id: "rule_domain_youtube",
        name: "YouTube Rule",
        targetType: "wildcard",
        pattern: "*.youtube.com",
        action: "proxy",
        enabled: true
      },
      {
        id: "rule_domain_github",
        name: "GitHub Rule",
        targetType: "wildcard",
        pattern: "*.github.com",
        action: "proxy",
        enabled: true
      }
    ]
  });

  await withServer(async (base) => {
    // Case 1: includeExtensionRules is FALSE -> serverRules only has desktop process rules
    saveAppBuildConfig({
      includeExtensionRules: false,
      processRules: [
        {
          id: "rule_desktop_only",
          processName: "curl.exe",
          targetDomains: "*",
          targetHosts: "*",
          targetPorts: "443",
          protocol: "tcp",
          action: "proxy"
        }
      ]
    });

    const res1 = await fetch(`${base}/api/app/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Fleet-Token": TEST_TOKEN
      },
      body: JSON.stringify({
        appInstanceId: "app_branch_test_1",
        hostname: "WORKSTATION-BRANCH-1",
        username: "CORP\\dev1",
        version: "2.2.0"
      })
    });
    assert.strictEqual(res1.status, 200);
    const body1 = await res1.json();
    assert.strictEqual(body1.ok, true);
    // Should NOT contain ext_rule
    const extRules1 = body1.serverRules.filter((r: any) => String(r.id).startsWith("ext_rule_"));
    assert.strictEqual(extRules1.length, 0, "Extension rules must NOT be included when includeExtensionRules is false");
    const procRules1 = body1.serverRules.filter((r: any) => r.process === "curl.exe");
    assert.strictEqual(procRules1.length, 1, "Desktop process rules must be present");

    // Case 2: includeExtensionRules is TRUE -> serverRules includes both
    saveAppBuildConfig({
      includeExtensionRules: true,
      inheritRoutingProfileId: testProfile.id
    });

    const res2 = await fetch(`${base}/api/app/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Fleet-Token": TEST_TOKEN
      },
      body: JSON.stringify({
        appInstanceId: "app_branch_test_2",
        hostname: "WORKSTATION-BRANCH-2",
        username: "CORP\\dev2",
        version: "2.2.0"
      })
    });
    assert.strictEqual(res2.status, 200);
    const body2 = await res2.json();
    assert.strictEqual(body2.ok, true);
    const extRules2 = body2.serverRules.filter((r: any) => String(r.id).startsWith("ext_rule_"));
    assert.ok(extRules2.length >= 2, "All extension rules must be included when inheritRuleIds is empty");

    // Case 3: inheritRuleIds is specified -> only selected extension rules are injected
    saveAppBuildConfig({
      includeExtensionRules: true,
      inheritRoutingProfileId: testProfile.id,
      inheritRuleIds: ["rule_domain_youtube"]
    });

    const res3 = await fetch(`${base}/api/app/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Fleet-Token": TEST_TOKEN
      },
      body: JSON.stringify({
        appInstanceId: "app_branch_test_3",
        hostname: "WORKSTATION-BRANCH-3",
        username: "CORP\\dev3",
        version: "2.2.0"
      })
    });
    assert.strictEqual(res3.status, 200);
    const body3 = await res3.json();
    assert.strictEqual(body3.ok, true);
    const extRules3 = body3.serverRules.filter((r: any) => String(r.id).startsWith("ext_rule_"));
    assert.strictEqual(extRules3.length, 1, "Only specific extension rule selected must be included");
    assert.strictEqual(extRules3[0].domains, "*.youtube.com");
  });
});
