import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express, { Request, Response, NextFunction } from "express";
import { createAppBuilderRouter } from "../src/routes/appBuilderRoutes.js";
import { createTokenAuthMiddleware } from "../src/middleware/security.js";
import { TEST_TOKEN, TEST_ADMIN_TOKEN } from "./helpers/setup.js";

function setupApp() {
  const app = express();
  app.use(express.json());

  const adminAuth = createTokenAuthMiddleware(() => TEST_ADMIN_TOKEN, "x-admin-token");
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    return adminAuth(req, res, next);
  });

  const router = createAppBuilderRouter(
    () => TEST_TOKEN,
    () => TEST_ADMIN_TOKEN
  );
  app.use(router);
  return app;
}

async function withTestServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = setupApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    return await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("appBuilderRoutes: enforces admin auth on all endpoints", async () => {
  await withTestServer(async (baseUrl) => {
    // 1. Without credentials -> 401
    const unauthRes = await fetch(`${baseUrl}/api/app-builder/config`);
    assert.equal(unauthRes.status, 401);

    // 2. With fleet token (low privilege) -> 401
    const fleetTokenRes = await fetch(`${baseUrl}/api/app-builder/config`, {
      headers: { "x-admin-token": "wrong-token" },
    });
    assert.equal(fleetTokenRes.status, 401);

    // 3. With valid admin token -> 200
    const authRes = await fetch(`${baseUrl}/api/app-builder/config`, {
      headers: { "x-admin-token": TEST_ADMIN_TOKEN },
    });
    assert.equal(authRes.status, 200);
    const body = await authRes.json();
    assert.ok(body.name);
    assert.ok(Array.isArray(body.processRules));
  });
});

test("appBuilderRoutes: validates and saves config updates", async () => {
  await withTestServer(async (baseUrl) => {
    // Rejects invalid protocol
    const badProtoRes = await fetch(`${baseUrl}/api/app-builder/config`, {
      method: "POST",
      headers: {
        "x-admin-token": TEST_ADMIN_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        processRules: [
          {
            id: "bad_rule",
            processName: "curl.exe",
            protocol: "invalid_proto",
            action: "proxy",
          },
        ],
      }),
    });
    assert.equal(badProtoRes.status, 400);

    // Rejects invalid action
    const badActionRes = await fetch(`${baseUrl}/api/app-builder/config`, {
      method: "POST",
      headers: {
        "x-admin-token": TEST_ADMIN_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        processRules: [
          {
            id: "bad_rule",
            processName: "curl.exe",
            protocol: "tcp",
            action: "invalid_action",
          },
        ],
      }),
    });
    assert.equal(badActionRes.status, 400);

    // Valid update
    const validRes = await fetch(`${baseUrl}/api/app-builder/config`, {
      method: "POST",
      headers: {
        "x-admin-token": TEST_ADMIN_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Corporate App Router",
        presetStyle: "dark-obsidian",
        processRules: [
          {
            id: "rule_1",
            processName: "git.exe",
            targetHosts: "github.com",
            targetPorts: "443",
            protocol: "tcp",
            action: "proxy",
          },
        ],
      }),
    });
    assert.equal(validRes.status, 200);
    const updated = await validRes.json();
    assert.equal(updated.name, "Corporate App Router");
    assert.equal(updated.presetStyle, "dark-obsidian");
  });
});

test("appBuilderRoutes: build, download, profile, and script delivery", async () => {
  await withTestServer(async (baseUrl) => {
    // 1. Build package
    const buildRes = await fetch(`${baseUrl}/api/app-builder/build`, {
      method: "POST",
      headers: { "x-admin-token": TEST_ADMIN_TOKEN },
    });
    assert.equal(buildRes.status, 200);
    const buildBody = await buildRes.json();
    assert.equal(buildBody.ok, true);
    assert.ok(buildBody.result.windowsPackageSha256);
    assert.ok(buildBody.result.linuxPackageSha256);

    // 2. Download profile
    const profileRes = await fetch(`${baseUrl}/api/app-builder/profile`, {
      headers: { "x-admin-token": TEST_ADMIN_TOKEN },
    });
    assert.equal(profileRes.status, 200);
    const profile = await profileRes.json();
    assert.equal(profile.Version, "1.0");

    // 3. Download windows package
    const winRes = await fetch(`${baseUrl}/api/app-builder/download/windows`, {
      headers: { "x-admin-token": TEST_ADMIN_TOKEN },
    });
    assert.equal(winRes.status, 200);
    assert.ok(winRes.headers.get("content-type")?.includes("zip") || winRes.headers.get("content-disposition")?.includes("zip"));
    const winBuffer = Buffer.from(await winRes.arrayBuffer());
    assert.ok(winBuffer.length > 0);

    // 4. Download linux package
    const linuxRes = await fetch(`${baseUrl}/api/app-builder/download/linux`, {
      headers: { "x-admin-token": TEST_ADMIN_TOKEN },
    });
    assert.equal(linuxRes.status, 200);
    assert.ok(linuxRes.headers.get("content-type")?.includes("gzip") || linuxRes.headers.get("content-disposition")?.includes("tar.gz"));
    const linuxBuffer = Buffer.from(await linuxRes.arrayBuffer());
    assert.ok(linuxBuffer.length > 0);

    // 5. Download deployment scripts
    const deployScriptRes = await fetch(`${baseUrl}/api/app-builder/scripts/deploy`, {
      headers: { "x-admin-token": TEST_ADMIN_TOKEN },
    });
    assert.equal(deployScriptRes.status, 200);
    const deployText = await deployScriptRes.text();
    assert.ok(deployText.includes("PEC-ProxyClient"));

    const verifyScriptRes = await fetch(`${baseUrl}/api/app-builder/scripts/verify`, {
      headers: { "x-admin-token": TEST_ADMIN_TOKEN },
    });
    assert.equal(verifyScriptRes.status, 200);
    const verifyText = await verifyScriptRes.text();
    assert.ok(verifyText.includes("ProxyBridge"));

    // 6. GET /api/app-builder/info returns latest build metadata
    const infoRes = await fetch(`${baseUrl}/api/app-builder/info`, {
      headers: { "x-admin-token": TEST_ADMIN_TOKEN },
    });
    assert.equal(infoRes.status, 200);
    const infoBody = await infoRes.json();
    assert.equal(infoBody.ok, true);
    assert.ok(infoBody.info);
    assert.equal(infoBody.info.windowsPackageSha256, buildBody.result.windowsPackageSha256);

    // 7. POST /api/app-builder/build-binaries builds or verifies native binaries
    const binariesUnauth = await fetch(`${baseUrl}/api/app-builder/build-binaries`, {
      method: "POST",
    });
    assert.equal(binariesUnauth.status, 401);

    const binariesRes = await fetch(`${baseUrl}/api/app-builder/build-binaries`, {
      method: "POST",
      headers: { "x-admin-token": TEST_ADMIN_TOKEN },
    });
    assert.equal(binariesRes.status, 200);
    const binariesBody = await binariesRes.json();
    assert.equal(binariesBody.ok, true);
    assert.ok(Array.isArray(binariesBody.builtFiles));
    assert.ok(binariesBody.builtFiles.includes("PEC-App.exe"));
    assert.ok(binariesBody.builtFiles.includes("PEC-CLI.exe"));
    assert.ok(binariesBody.builtFiles.includes("PECAppSvc.exe"));
    assert.ok(binariesBody.builtFiles.includes("PECAppCore.dll"));

    // 8. POST /api/app-builder/clean-binaries cleans compiled binaries but preserves WinDivert
    const cleanUnauth = await fetch(`${baseUrl}/api/app-builder/clean-binaries`, {
      method: "POST",
    });
    assert.equal(cleanUnauth.status, 401);

    const cleanRes = await fetch(`${baseUrl}/api/app-builder/clean-binaries`, {
      method: "POST",
      headers: { "x-admin-token": TEST_ADMIN_TOKEN },
    });
    assert.equal(cleanRes.status, 200);
    const cleanBody = await cleanRes.json();
    assert.equal(cleanBody.ok, true);
    assert.ok(Array.isArray(cleanBody.deletedFiles));
    assert.ok(Array.isArray(cleanBody.preservedFiles));
    // Verify WinDivert is in preservedFiles and not deletedFiles
    const hasDivertDeleted = cleanBody.deletedFiles.some((f: string) => f.toLowerCase().includes("windivert"));
    assert.equal(hasDivertDeleted, false, "WinDivert files must NEVER be deleted");

    // 9. POST /api/app-builder/build-binaries with custom version compiles/syncs with that version
    const customBuildRes = await fetch(`${baseUrl}/api/app-builder/build-binaries`, {
      method: "POST",
      headers: {
        "x-admin-token": TEST_ADMIN_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify({ version: "1.0.3" }),
    });
    assert.equal(customBuildRes.status, 200);
    const customBuildBody = await customBuildRes.json();
    assert.equal(customBuildBody.ok, true);
    assert.ok(Array.isArray(customBuildBody.builtFiles));

    // Re-stage default binaries so subsequent tests in the test runner have them intact
    await fetch(`${baseUrl}/api/app-builder/build-binaries`, {
      method: "POST",
      headers: { "x-admin-token": TEST_ADMIN_TOKEN },
    });
  });
});

