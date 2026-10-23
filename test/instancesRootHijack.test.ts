import test from "node:test";
import assert from "node:assert";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createInstancesRouter } from "../src/routes/instancesRoutes.js";

test("instances router does not intercept GET / (root) dashboard route", async () => {
  const app = express();
  app.use(createInstancesRouter());
  app.get("/", (_req, res) => {
    res.type("html").send("<html><body>Dashboard</body></html>");
  });

  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    const text = await res.text();
    assert.strictEqual(
      text,
      "<html><body>Dashboard</body></html>",
      "GET / must reach dashboard handler and not be intercepted by instances router returning JSON"
    );
  } finally {
    server.close();
  }
});
