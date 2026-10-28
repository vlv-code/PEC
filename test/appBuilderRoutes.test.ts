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

test("appBuilderRoutes: rejects path traversal and invalid semver versions (Audit M-Server)", async () => {
  await withTestServer(async (baseUrl) => {
    // 1. Rejects path traversal in build-binaries
    const badBuildBinaries = await fetch(`${baseUrl}/api/app-builder/build-binaries`, {
      method: "POST",
      headers: {
        "x-admin-token": TEST_ADMIN_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify({ version: "../../etc/passwd" }),
    });
    assert.equal(badBuildBinaries.status, 400);
    const badBuildBinariesBody = await badBuildBinaries.json();
    assert.match(badBuildBinariesBody.error, /semver/i);

    // 2. Rejects invalid semver format in build-binaries
    const invalidVer = await fetch(`${baseUrl}/api/app-builder/build-binaries`, {
      method: "POST",
      headers: {
        "x-admin-token": TEST_ADMIN_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify({ version: "not-a-version" }),
    });
    assert.equal(invalidVer.status, 400);

    // 3. Rejects path traversal in config update
    const badConfigVer = await fetch(`${baseUrl}/api/app-builder/config`, {
      method: "POST",
      headers: {
        "x-admin-token": TEST_ADMIN_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify({ version: "../../../traversal" }),
    });
    assert.equal(badConfigVer.status, 400);
    const badConfigBody = await badConfigVer.json();
    assert.match(badConfigBody.error, /semver/i);

    // 4. Rejects path traversal in build endpoint
    const badBuildVer = await fetch(`${baseUrl}/api/app-builder/build`, {
      method: "POST",
      headers: {
        "x-admin-token": TEST_ADMIN_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify({ version: "1.0.0; rm -rf /" }),
    });
    assert.equal(badBuildVer.status, 400);

    // 5. Rejects null version in config
    const nullConfigVer = await fetch(`${baseUrl}/api/app-builder/config`, {
      method: "POST",
      headers: {
        "x-admin-token": TEST_ADMIN_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify({ version: null }),
    });
    assert.equal(nullConfigVer.status, 400);

    // 6. Rejects null version in build-binaries
    const nullBuildBinariesVer = await fetch(`${baseUrl}/api/app-builder/build-binaries`, {
      method: "POST",
      headers: {
        "x-admin-token": TEST_ADMIN_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify({ version: null }),
    });
    assert.equal(nullBuildBinariesVer.status, 400);

    // 7. Accepts valid pre-release semver tag
    const validPreRelease = await fetch(`${baseUrl}/api/app-builder/config`, {
      method: "POST",
      headers: {
        "x-admin-token": TEST_ADMIN_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify({ version: "1.0.4-beta.1.alpha" }),
    });
    assert.equal(validPreRelease.status, 200);
    const validBody = await validPreRelease.json();
    assert.equal(validBody.version, "1.0.4-beta.1.alpha");

    // Restore version back to 2.2.0
    await fetch(`${baseUrl}/api/app-builder/config`, {
      method: "POST",
      headers: {
        "x-admin-token": TEST_ADMIN_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify({ version: "2.2.0" }),
    });
  });
});

test("appBuilderRoutes: GET /api/app-builder/info includes embeddedVersion and coreModulesIntegrity", async () => {
  await withTestServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/app-builder/info`, {
      headers: { "x-admin-token": TEST_ADMIN_TOKEN },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);

    const embeddedVersion = body.embeddedVersion || body.info?.embeddedVersion;
    const coreModulesIntegrity = body.coreModulesIntegrity || body.info?.coreModulesIntegrity;

    assert.ok(embeddedVersion, "Must include embeddedVersion");
    assert.ok(Array.isArray(coreModulesIntegrity), "Must include coreModulesIntegrity array");
    assert.ok(coreModulesIntegrity.length > 0, "coreModulesIntegrity should contain module entries");

    const coreDll = coreModulesIntegrity.find((m: any) => m.name === "PECAppCore.dll");
    assert.ok(coreDll, "Must include PECAppCore.dll integrity");
    assert.ok(coreDll.sha256 && coreDll.sha256.length === 64, "PECAppCore.dll must have 64-char sha256");
  });
});


