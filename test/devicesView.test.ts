import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { renderDashboardHtml } from "../src/views/dashboardView.js";
import { createInstancesRouter } from "../src/routes/instancesRoutes.js";
import { registerHeartbeat, getActiveInstances } from "../src/instances.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dashboardJs = readFileSync(
  fileURLToPath(new URL("../public/dashboard.js", import.meta.url)),
  "utf-8"
);

test("Dashboard renders Fleet navigation and titles", () => {
  const html = renderDashboardHtml({});
  assert.match(html, /Флот/);
  assert.match(html, /id="tab-instances"/);
  assert.match(html, /Флот корпоративной сети/);
  assert.match(html, /Централизованное управление инстансами расширения, профилями и прокси-нодами/);
  assert.match(html, /Зарегистрированный флот/);
  assert.match(html, /Действия/);
});

test("public/dashboard.js defines delete device functionality and updated dictionary", () => {
  // Checks for delete instance button and API interaction
  assert.match(dashboardJs, /btn-delete-instance/);
  assert.match(dashboardJs, /DELETE/);
  assert.match(dashboardJs, /\/api\/instances\//);
  assert.match(dashboardJs, /renderInstancesTable/);
  // Ensure Russian translations use Флот
  assert.match(dashboardJs, /'Группа флота'/);
});

test("DELETE /api/instances/:id deletes an existing instance", async () => {
  const app = express();
  app.use(express.json());
  app.use(createInstancesRouter());

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const testId = "test_device_to_delete_" + Date.now();
    registerHeartbeat({ instanceId: testId, ip: "192.168.1.100", version: "1.4.0" });
    assert.ok(getActiveInstances().some((i) => i.instanceId === testId));

    const res = await fetch(`${baseUrl}/api/instances/${encodeURIComponent(testId)}`, {
      method: "DELETE",
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.removed, true);

    // Verify it is no longer in active instances
    assert.ok(!getActiveInstances().some((i) => i.instanceId === testId));
  } finally {
    server.close();
  }
});
