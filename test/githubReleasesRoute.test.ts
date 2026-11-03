import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { createSystemRouter } from "../src/routes/systemRoutes.js";
import { TEST_TOKEN } from "./helpers/setup.js";

function setupSystemApp() {
  const app = express();
  app.use(express.json());
  app.use(
    createSystemRouter({
      port: 3000,
      getFleetToken: () => TEST_TOKEN,
      defaultFleetToken: "default-token",
      adminTokenConfigured: true,
      credsStorePath: "/tmp/creds.json",
    })
  );
  return app;
}

test("systemRoutes: /api/github/releases and /api/releases/github are both supported and return releases", async () => {
  const app = setupSystemApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Primary endpoint: /api/github/releases
    const res1 = await fetch(`${baseUrl}/api/github/releases`);
    assert.equal(res1.status, 200, "GET /api/github/releases must return 200");
    const data1 = (await res1.json()) as any;
    assert.equal(data1.ok, true, "response ok must be true");
    assert.ok(Array.isArray(data1.releases), "releases must be an array");

    // 2. Alias endpoint: /api/releases/github
    const res2 = await fetch(`${baseUrl}/api/releases/github`);
    assert.equal(res2.status, 200, "GET /api/releases/github must return 200");
    const data2 = (await res2.json()) as any;
    assert.equal(data2.ok, true, "alias response ok must be true");
    assert.ok(Array.isArray(data2.releases), "alias releases must be an array");

    // 3. Validation: rejects invalid repository string
    const resBad = await fetch(`${baseUrl}/api/github/releases?repo=invalid_format`);
    assert.equal(resBad.status, 400, "invalid repo format must return 400");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
