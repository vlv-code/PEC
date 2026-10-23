import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { createInstancesRouter } from "../src/routes/instancesRoutes.js";
import { registerHeartbeat, getAllInstances, assignInstanceProxy, assignInstanceProfile } from "../src/instances.js";

test("instances bulk API endpoints execute batch actions across selected instances", async () => {
  const app = express();
  app.use(express.json());
  app.use(createInstancesRouter());

  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}/api/instances`;

  try {
    // Seed 2 instances
    registerHeartbeat("inst-batch-1", { ip: "1.1.1.1", version: "1.0.0" });
    registerHeartbeat("inst-batch-2", { ip: "1.1.1.2", version: "1.0.0" });

    // 1. Bulk assign proxy
    const resProxy = await fetch(`${base}/bulk-assign-proxy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceIds: ["inst-batch-1", "inst-batch-2"], proxyId: "" })
    });
    assert.equal(resProxy.status, 200);
    const dataProxy = await resProxy.json();
    assert.equal(dataProxy.ok, true);
    assert.equal(dataProxy.count, 2);

    // 2. Bulk assign profile
    const resProfile = await fetch(`${base}/bulk-assign-profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceIds: ["inst-batch-1", "inst-batch-2"], profileId: "prof-corp" })
    });
    assert.equal(resProfile.status, 200);
    const dataProfile = await resProfile.json();
    assert.equal(dataProfile.ok, true);
    assert.equal(dataProfile.count, 2);

    // 3. Bulk revoke tokens
    const resRevoke = await fetch(`${base}/bulk-revoke-tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceIds: ["inst-batch-1", "inst-batch-2"] })
    });
    assert.equal(resRevoke.status, 200);
    const dataRevoke = await resRevoke.json();
    assert.equal(dataRevoke.ok, true);
    assert.equal(dataRevoke.count, 2);

    // 4. Bulk delete
    const resDel = await fetch(`${base}/bulk-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceIds: ["inst-batch-1"] })
    });
    assert.equal(resDel.status, 200);
    const dataDel = await resDel.json();
    assert.equal(dataDel.ok, true);
    assert.equal(dataDel.count, 1);
  } finally {
    server.close();
  }
});

test("dashboard UI: fleet table contains multi-select header, sortable attributes, and bulk actions toolbar", async () => {
  const { renderDashboardHtml } = await import("../src/views/dashboardView.js");
  const fs = await import("node:fs");
  const path = await import("node:path");

  const html = renderDashboardHtml({});

  // 1. Bulk toolbar
  assert.ok(html.includes('id="fleetBulkBar"'), "dashboardView must contain #fleetBulkBar");
  assert.ok(html.includes('id="fleetSelectedCount"'), "dashboardView must contain #fleetSelectedCount");
  assert.ok(html.includes('id="bulkAssignProxySelect"'), "dashboardView must contain #bulkAssignProxySelect");
  assert.ok(html.includes('id="btnBulkAssignProxy"'), "dashboardView must contain #btnBulkAssignProxy");
  assert.ok(html.includes('id="bulkAssignProfileSelect"'), "dashboardView must contain #bulkAssignProfileSelect");
  assert.ok(html.includes('id="btnBulkAssignProfile"'), "dashboardView must contain #btnBulkAssignProfile");
  assert.ok(html.includes('id="btnBulkRevokeTokens"'), "dashboardView must contain #btnBulkRevokeTokens");
  assert.ok(html.includes('id="btnBulkDelete"'), "dashboardView must contain #btnBulkDelete");

  // 2. Select All header and Sortable columns
  assert.ok(html.includes('id="fleetSelectAll"'), "dashboardView must contain #fleetSelectAll");
  assert.ok(html.includes('data-sort="id"'), "dashboardView must have sortable id header");
  assert.ok(html.includes('data-sort="ip"'), "dashboardView must have sortable ip header");

  // 3. Client script support
  const js = fs.readFileSync(path.resolve("public/dashboard.js"), "utf8");
  assert.ok(js.includes("selectedFleetInstances"), "dashboard.js must track selectedFleetInstances");
  assert.ok(js.includes("/api/instances/bulk-assign-proxy") || js.includes("/bulk-assign-proxy"), "dashboard.js must call bulk-assign-proxy");
  assert.ok(js.includes("/api/instances/bulk-delete") || js.includes("/bulk-delete"), "dashboard.js must call bulk-delete");
});

