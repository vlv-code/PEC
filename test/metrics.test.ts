import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  recordRotation,
  recordRateLimitBlock,
  resetMetricsForTest,
  renderPrometheusMetrics,
  getMetricsSnapshot,
} from "../src/metrics.js";
import { createMetricsRouter } from "../src/routes/metricsRoutes.js";
import {
  registerHeartbeat,
  registerDesktopHeartbeat,
  clearInstances,
} from "../src/instances.js";

test("metrics: records 3x-ui rotations and rate limit blocks", () => {
  resetMetricsForTest();

  recordRotation("3x-ui", "success");
  recordRotation("3x-ui", "success");
  recordRotation("3x-ui", "failure");
  recordRotation("standalone", "success");

  recordRateLimitBlock("/api/sync");
  recordRateLimitBlock("/api/sync");
  recordRateLimitBlock("/api/auth/login");

  const output = renderPrometheusMetrics();

  assert.ok(output.includes('pec_rotation_total{source="3x-ui",status="success"} 2'), "3x-ui success count must be 2");
  assert.ok(output.includes('pec_rotation_total{source="3x-ui",status="failure"} 1'), "3x-ui failure count must be 1");
  assert.ok(output.includes('pec_rotation_total{source="standalone",status="success"} 1'), "standalone success count must be 1");

  assert.ok(output.includes('pec_rate_limit_blocks_total{endpoint="/api/sync"} 2'), "/api/sync rate limit count must be 2");
  assert.ok(output.includes('pec_rate_limit_blocks_total{endpoint="/api/auth/login"} 1'), "/api/auth/login rate limit count must be 1");

  assert.ok(output.includes("pec_fleet_active_instances{type=\"total\"}"), "must export fleet instances metric");
  assert.ok(output.includes("pec_process_uptime_seconds"), "must export process uptime metric");
});

test("metrics fleet events: increments active instance metrics on fleet registration and heartbeat", () => {
  clearInstances();
  try {
    const initialSnapshot = getMetricsSnapshot();
    const initialExt = initialSnapshot.fleet.extension;
    const initialDesk = initialSnapshot.fleet.desktop;
    const initialTotal = initialSnapshot.fleet.total;

    // 1. Register Chrome extension instance
    registerHeartbeat({
      instanceId: "test-metrics-ext-101",
      ip: "127.0.0.1",
      version: "1.0.0",
    });

    const afterExtSnapshot = getMetricsSnapshot();
    assert.equal(afterExtSnapshot.fleet.extension, initialExt + 1, "extension instance count must increment");
    assert.equal(afterExtSnapshot.fleet.total, initialTotal + 1, "total fleet instance count must increment");

    // 2. Register native desktop client instance
    registerDesktopHeartbeat({
      appInstanceId: "test-metrics-desk-202",
      ip: "127.0.0.1",
      version: "1.0.0",
      username: "corp_user",
      os: "windows",
      hostname: "test-corp-pc",
    });

    const afterDeskSnapshot = getMetricsSnapshot();
    assert.equal(afterDeskSnapshot.fleet.desktop, initialDesk + 1, "desktop instance count must increment");
    assert.equal(afterDeskSnapshot.fleet.total, initialTotal + 2, "total fleet instance count must increment");

    // 3. Verify Prometheus output reflects live counts
    const prometheusText = renderPrometheusMetrics();
    assert.ok(
      prometheusText.includes(`pec_fleet_active_instances{type="extension"} ${afterDeskSnapshot.fleet.extension}`),
      "Prometheus output must include exact active extension gauge"
    );
    assert.ok(
      prometheusText.includes(`pec_fleet_active_instances{type="desktop"} ${afterDeskSnapshot.fleet.desktop}`),
      "Prometheus output must include exact active desktop gauge"
    );
    assert.ok(
      prometheusText.includes(`pec_fleet_active_instances{type="total"} ${afterDeskSnapshot.fleet.total}`),
      "Prometheus output must include exact active total gauge"
    );
  } finally {
    clearInstances();
  }
});

test("metricsRoutes: serves standard Prometheus format on GET /metrics and GET /api/metrics", async () => {
  const dummyAdminAuth = (_req: any, _res: any, next: any) => next();
  const app = express();
  app.use(createMetricsRouter({ adminAuthMiddleware: dummyAdminAuth }));

  const server = app.listen(0);
  const port = (server.address() as any).port;

  try {
    // 1. Verify GET /metrics
    const resMetrics = await fetch(`http://127.0.0.1:${port}/metrics`);
    assert.equal(resMetrics.status, 200, "GET /metrics must return 200");
    const contentType = resMetrics.headers.get("content-type") || "";
    assert.ok(contentType.includes("text/plain"), "Content-Type must be text/plain");
    assert.ok(contentType.includes("version=0.0.4"), "Content-Type must declare Prometheus version=0.0.4");
    assert.equal(
      resMetrics.headers.get("cache-control"),
      "no-cache, no-store, must-revalidate",
      "metrics endpoint must forbid caching"
    );

    const bodyMetrics = await resMetrics.text();
    assert.ok(bodyMetrics.includes("# HELP pec_fleet_active_instances"), "must contain fleet HELP header");
    assert.ok(bodyMetrics.includes("# TYPE pec_fleet_active_instances gauge"), "must declare gauge type");
    assert.ok(bodyMetrics.includes("# HELP pec_rotation_total"), "must contain rotation HELP header");
    assert.ok(bodyMetrics.includes("# TYPE pec_rotation_total counter"), "must declare counter type");
    assert.ok(bodyMetrics.includes("# HELP pec_rate_limit_blocks_total"), "must contain rate limit HELP header");
    assert.ok(bodyMetrics.includes("# TYPE pec_rate_limit_blocks_total counter"), "must declare counter type");
    assert.ok(bodyMetrics.includes("# HELP pec_process_uptime_seconds"), "must contain uptime HELP header");
    assert.ok(bodyMetrics.includes("# TYPE pec_process_uptime_seconds gauge"), "must declare gauge type");

    // 2. Verify GET /api/metrics parity
    const resApiMetrics = await fetch(`http://127.0.0.1:${port}/api/metrics`);
    assert.equal(resApiMetrics.status, 200, "GET /api/metrics must return 200");
    const apiContentType = resApiMetrics.headers.get("content-type") || "";
    assert.ok(apiContentType.includes("text/plain"));
    assert.ok(apiContentType.includes("version=0.0.4"));
    const bodyApiMetrics = await resApiMetrics.text();
    assert.ok(bodyApiMetrics.includes("# HELP pec_fleet_active_instances"));
  } finally {
    server.close();
  }
});

test("metricsRoutes: cuts off unauthorized requests across all endpoints and auth headers", async () => {
  const dummyAdminAuth = (req: any, res: any, next: any) => {
    const authHeader = req.headers["authorization"];
    const customHeader = req.headers["x-admin-token"];
    if (authHeader === "Bearer secret_admin_token_99" || customHeader === "secret_admin_token_99") {
      return next();
    }
    return res.status(401).json({ ok: false, error: "Unauthorized: admin access required for metrics" });
  };

  const app = express();
  app.use(createMetricsRouter({ adminAuthMiddleware: dummyAdminAuth }));

  const server = app.listen(0);
  const port = (server.address() as any).port;

  try {
    // 1. Unauthenticated request to /metrics -> 401
    const unauthMetrics = await fetch(`http://127.0.0.1:${port}/metrics`);
    assert.equal(unauthMetrics.status, 401, "GET /metrics without token must return 401");
    const unauthMetricsJson = await unauthMetrics.json();
    assert.equal(unauthMetricsJson.ok, false);

    // 2. Unauthenticated request to /api/metrics -> 401
    const unauthApi = await fetch(`http://127.0.0.1:${port}/api/metrics`);
    assert.equal(unauthApi.status, 401, "GET /api/metrics without token must return 401");

    // 3. Invalid token -> 401
    const invalidRes = await fetch(`http://127.0.0.1:${port}/metrics`, {
      headers: { "x-admin-token": "wrong_token_123" },
    });
    assert.equal(invalidRes.status, 401, "GET /metrics with wrong token must return 401");

    // 4. Authenticated with Authorization: Bearer -> 200
    const bearerRes = await fetch(`http://127.0.0.1:${port}/metrics`, {
      headers: { authorization: "Bearer secret_admin_token_99" },
    });
    assert.equal(bearerRes.status, 200, "GET /metrics with Bearer token must return 200");
    const bearerText = await bearerRes.text();
    assert.ok(bearerText.includes("# HELP pec_fleet_active_instances"));

    // 5. Authenticated with x-admin-token -> 200
    const customHeaderRes = await fetch(`http://127.0.0.1:${port}/metrics`, {
      headers: { "x-admin-token": "secret_admin_token_99" },
    });
    assert.equal(customHeaderRes.status, 200, "GET /metrics with x-admin-token must return 200");
  } finally {
    server.close();
  }
});

test("metricsRoutes: serves public metrics when allowPublic: true or PEC_METRICS_PUBLIC=true", async () => {
  const dummyAdminAuth = (req: any, res: any, next: any) => {
    if (req.headers["x-admin-token"] === "valid_admin_token") {
      return next();
    }
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  };

  // 1. Via options.allowPublic = true
  const appPublicOpt = express();
  appPublicOpt.use(createMetricsRouter({ adminAuthMiddleware: dummyAdminAuth, allowPublic: true }));
  const serverOpt = appPublicOpt.listen(0);
  const portOpt = (serverOpt.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${portOpt}/metrics`);
    assert.equal(res.status, 200, "GET /metrics with allowPublic=true must return 200 without token");
  } finally {
    serverOpt.close();
  }

  // 2. Via PEC_METRICS_PUBLIC env var
  const prevEnv = process.env.PEC_METRICS_PUBLIC;
  try {
    process.env.PEC_METRICS_PUBLIC = "true";
    const appEnv = express();
    appEnv.use(createMetricsRouter({ adminAuthMiddleware: dummyAdminAuth }));
    const serverEnv = appEnv.listen(0);
    const portEnv = (serverEnv.address() as any).port;

    try {
      const res = await fetch(`http://127.0.0.1:${portEnv}/metrics`);
      assert.equal(res.status, 200, "GET /metrics with PEC_METRICS_PUBLIC=true must return 200 without token");
    } finally {
      serverEnv.close();
    }
  } finally {
    process.env.PEC_METRICS_PUBLIC = prevEnv;
  }
});
