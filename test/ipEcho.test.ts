import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { createSystemRoutes } from "../src/routes/systemRoutes.js";

test("systemRoutes responds to both /api/ip-echo and /ip-echo without 404", async () => {
  const app = express();
  const mockOptions = {
    port: 3000,
    getFleetToken: () => "test-token",
    verifyAdminToken: () => true,
    requireAdmin: (_req: any, _res: any, next: any) => next(),
    auditSink: () => {},
  };
  app.use(createSystemRoutes(mockOptions as any));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;

  try {
    const resApi = await fetch(`http://127.0.0.1:${port}/api/ip-echo`);
    assert.equal(resApi.status, 200);
    const dataApi = await resApi.json();
    assert.ok(dataApi.ip);
    assert.ok(dataApi.note);

    const resRoot = await fetch(`http://127.0.0.1:${port}/ip-echo`);
    assert.equal(resRoot.status, 200);
    const dataRoot = await resRoot.json();
    assert.equal(dataRoot.ip, dataApi.ip);
  } finally {
    server.close();
  }
});
