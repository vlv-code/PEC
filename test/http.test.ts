import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import express, { Request, Response, NextFunction } from "express";
import type { AddressInfo } from "node:net";
import { createTokenAuthMiddleware } from "../src/middleware/security.js";
import { createCredsRouter } from "../src/routes/credsRoutes.js";
import { createInstancesRouter } from "../src/routes/instancesRoutes.js";
import { saveProfile } from "../src/routing.js";
import { atomicWriteCreds, getCredsStorePath } from "../src/rotate.js";
import { TEST_TOKEN } from "./helpers/setup.js";

/**
 * Full-stack HTTP tests over real sockets, mirroring the production wiring
 * from server.ts: admin auth gate with a public allowlist, /creds with its
 * sliding-window rate limiter, /api/sync with the extension token flow, and
 * the /proxy.pac delivery path. The JSON body limit is set to 1kb here (5mb
 * in production) so the payload-too-large rejection can be exercised quickly.
 */

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1kb" }));
  const adminAuth = createTokenAuthMiddleware(() => TEST_TOKEN);
  const PUBLIC_API_PATHS = new Set(["/ip-echo", "/sync"]);
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    return adminAuth(req, res, next);
  });
  app.use(createCredsRouter(() => TEST_TOKEN));
  app.use(createInstancesRouter());
  return app;
}

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const server = buildApp().listen(0);
  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

test("HTTP: /creds enforces its sliding-window rate limit (429 + Retry-After)", async () => {
  await withServer(async (base) => {
    // The limiter counts every hit from one IP before the token check:
    // 60 requests pass (rejected with 403 - no token), the 61st is throttled.
    let throttled: globalThis.Response | null = null;
    for (let i = 0; i < 61; i++) {
      const res = await fetch(`${base}/creds`);
      if (i < 60) {
        assert.strictEqual(res.status, 403, `request #${i + 1} must hit the token check, not the limiter`);
      } else {
        throttled = res;
      }
    }
    assert.ok(throttled, "the 61st request must have been made");
    assert.strictEqual(throttled!.status, 429, "61st request within one minute must be rate limited");
    const retryAfter = Number(throttled!.headers.get("retry-after"));
    assert.ok(Number.isFinite(retryAfter) && retryAfter >= 1, "Retry-After header must be a positive number of seconds");
    const body = await throttled!.json() as { error?: string };
    assert.match(body.error || "", /rate limit/i);

    // The limit applies per window: a different route stays reachable.
    const sync = await fetch(`${base}/api/sync`, { method: "POST" });
    assert.notStrictEqual(sync.status, 429);
  });
});

test("HTTP: oversized JSON bodies are rejected with 413 before any handler runs", async () => {
  await withServer(async (base) => {
    const huge = JSON.stringify({ instanceId: "x".repeat(2048) });
    const res = await fetch(`${base}/api/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Ext-Token": TEST_TOKEN },
      body: huge,
    });
    assert.strictEqual(res.status, 413, "bodies above the configured express.json limit must be rejected");
  });
});

test("HTTP: e2e - sync as a group worker, then receive that group's PAC", async () => {
  await withServer(async (base) => {
    // Fleet credentials the sync response must deliver
    atomicWriteCreds(getCredsStorePath(), { user: "corp-user", pass: "e2e-fleet-pass" });

    // A profile scoped to the QA group, with a marker domain
    const qaProfile = saveProfile({
      name: "E2E QA Group Profile",
      targetScope: "group",
      targetGroup: "E2E-QA-GROUP",
      defaultPolicy: "direct",
      rules: [
        { id: "e2e-r1", name: "QA marker", targetType: "domain", pattern: "e2e-qa-marker.example", action: "proxy", enabled: true },
      ],
    });

    // 1. The extension worker syncs with its group
    const syncRes = await fetch(`${base}/api/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Ext-Token": TEST_TOKEN },
      body: JSON.stringify({ instanceId: "inst_e2e_qa", version: "1.3.0", group: "E2E-QA-GROUP" }),
    });
    assert.strictEqual(syncRes.status, 200);
    const sync = await syncRes.json() as {
      ok: boolean;
      creds: { user: string; pass: string } | null;
      profileId: string;
      profileName: string;
      config: { pacUrl: string };
    };
    assert.strictEqual(sync.ok, true);
    assert.strictEqual(sync.profileName, "E2E QA Group Profile", "group workers must resolve their group profile");
    assert.strictEqual(sync.profileId, qaProfile.id);
    assert.strictEqual(sync.creds!.pass, "e2e-fleet-pass", "sync must deliver the current fleet credentials");
    assert.ok(sync.config.pacUrl.includes(`profileId=${qaProfile.id}`), "pacUrl must point at the resolved profile");

    // 2. The extension fetches the PAC it was pointed to
    const pacRes = await fetch(sync.config.pacUrl);
    assert.strictEqual(pacRes.status, 200);
    assert.match(pacRes.headers.get("content-type") || "", /x-ns-proxy-autoconfig/);
    const pac = await pacRes.text();
    assert.match(pac, /FindProxyForURL/);
    assert.match(pac, /e2e-qa-marker\.example/, "the PAC must contain the QA profile's routing rule");

    // 3. The same group resolves without an explicit profileId
    const pacByGroup = await (await fetch(`${base}/proxy.pac?group=E2E-QA-GROUP`)).text();
    assert.match(pacByGroup, /e2e-qa-marker\.example/);

    // 4. The default fleet gets the default profile - not the QA rules
    const pacDefault = await (await fetch(`${base}/proxy.pac`)).text();
    assert.ok(!pacDefault.includes("e2e-qa-marker.example"), "default fleet must not receive QA group rules");
    assert.match(pacDefault, /FindProxyForURL/);

    // 5. An unknown profileId falls back to the default profile (never a 500)
    const pacUnknown = await fetch(`${base}/proxy.pac?profileId=does-not-exist`);
    assert.strictEqual(pacUnknown.status, 200);
    assert.match(await pacUnknown.text(), /FindProxyForURL/);

    // 6. The worker's heartbeat registered it with the applied profile
    const fleetRes = await fetch(`${base}/api/instances`, { headers: { "X-Ext-Token": TEST_TOKEN } });
    assert.strictEqual(fleetRes.status, 200);
    const fleet = await fleetRes.json() as { instances: Array<{ instanceId: string; group?: string; appliedProfileName?: string }> };
    const inst = fleet.instances.find((i) => i.instanceId === "inst_e2e_qa");
    assert.ok(inst, "synced worker must appear in the fleet registry");
    assert.strictEqual(inst!.group, "E2E-QA-GROUP");
    assert.strictEqual(inst!.appliedProfileName, "E2E QA Group Profile");
  });
});
