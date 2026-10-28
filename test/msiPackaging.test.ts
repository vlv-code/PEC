import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import express, { Request, Response, NextFunction } from "express";
import {
  normalizeMsiVersion,
  renderWxsManifest,
  generateUpgradeCode,
  buildMsiPackage,
  getAppBuildConfig,
} from "../src/appPackager.js";
import { createAppBuilderRouter } from "../src/routes/appBuilderRoutes.js";
import { createReleasesRouter } from "../src/routes/releasesRoutes.js";
import { createTokenAuthMiddleware } from "../src/middleware/security.js";
import { getReleasesDir } from "../src/storage.js";
import { TEST_TOKEN, TEST_ADMIN_TOKEN } from "./helpers/setup.js";

function setupApp() {
  const app = express();
  app.use(express.json());

  const adminAuth = createTokenAuthMiddleware(() => TEST_ADMIN_TOKEN, "x-admin-token");
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    return adminAuth(req, res, next);
  });

  const appBuilderRouter = createAppBuilderRouter(
    () => TEST_TOKEN,
    () => TEST_ADMIN_TOKEN
  );
  const releasesRouter = createReleasesRouter(
    () => TEST_ADMIN_TOKEN,
    undefined,
    () => TEST_TOKEN
  );

  app.use(appBuilderRouter);
  app.use(releasesRouter);
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

test("normalizeMsiVersion produces valid 3-4 part numeric versions for WiX", () => {
  assert.equal(normalizeMsiVersion("2.1.0"), "2.1.0");
  assert.equal(normalizeMsiVersion("v2.1"), "2.1.0");
  assert.equal(normalizeMsiVersion("1.0.0-beta.2"), "1.0.0");
  assert.equal(normalizeMsiVersion("3.2.1.4"), "3.2.1.4");
  assert.equal(normalizeMsiVersion(""), "1.0.0");
  assert.equal(normalizeMsiVersion("invalid"), "0.0.0");
});

test("renderWxsManifest produces well-formed WiX XML with service and registry properties", () => {
  const cfg = getAppBuildConfig();
  const baseUrl = "https://pec.company.corp:8443";
  const sourceDir = "C:\\PEC\\Staging";

  const xml = renderWxsManifest(cfg, baseUrl, sourceDir);

  // XML Header & Product
  assert.ok(xml.includes('<?xml version="1.0" encoding="utf-8"?>'));
  assert.ok(xml.includes("<Wix"));
  assert.ok(xml.includes('<Product Id="*"'));
  const expectedUpgradeCode = generateUpgradeCode(baseUrl);
  assert.ok(xml.includes(`UpgradeCode="${expectedUpgradeCode}"`));
  assert.notEqual(expectedUpgradeCode, "A4B7D265-42E1-4D99-A785-30BF2A3C2F19");

  // Properties
  assert.ok(xml.includes(`<Property Id="SERVER_URL" Value="${baseUrl}" />`));
  assert.ok(xml.includes(`<Property Id="FLEET_TOKEN" Value="${cfg.defaultToken}" />`));

  // Service configuration for privileged engine
  assert.ok(xml.includes('<ServiceInstall Id="SvcInstall"'));
  assert.ok(xml.includes('Name="PECAppSvc"'));
  assert.ok(xml.includes('Start="auto"'));
  assert.ok(xml.includes('Account="LocalSystem"'));
  assert.ok(xml.includes('Id="SvcControl"'));
  assert.ok(xml.includes('Name="PECAppSvc"'));

  // Registry Key for Machine GPO configuration
  assert.ok(xml.includes('<RegistryKey Root="HKLM" Key="Software\\PEC-App">'));
  assert.ok(xml.includes('<RegistryValue Type="string" Name="ServerUrl" Value="[SERVER_URL]" />'));
  assert.ok(xml.includes('<RegistryValue Type="string" Name="FleetToken" Value="[FLEET_TOKEN]" />'));

  // Forward slashes in paths for cross-platform portability
  assert.ok(!xml.includes("C:\\PEC\\Staging\\PEC-App.exe"));
  assert.ok(xml.includes("C:/PEC/Staging/PEC-App.exe"));
});

test("buildMsiPackage handles environments without WiX gracefully", () => {
  const cfg = getAppBuildConfig();
  const tmpStaging = path.resolve("./data/tmp_staging_test");
  if (!fs.existsSync(tmpStaging)) fs.mkdirSync(tmpStaging, { recursive: true });
  const outMsi = path.join(tmpStaging, "test.msi");

  try {
    const res = buildMsiPackage(cfg, "https://pec.example.com", tmpStaging, outMsi);
    // If wixl is not on host, res.success is false with descriptive error
    if (!res.success) {
      assert.ok(res.error);
    }
  } finally {
    try {
      fs.rmSync(tmpStaging, { recursive: true, force: true });
    } catch {}
  }
});

test("MSI download routes: serve MSI from releases when present", async () => {
  await withTestServer(async (baseUrl) => {
    const cfg = getAppBuildConfig();
    const testVer = cfg.version || "2.2.0";
    const appRelDir = path.join(getReleasesDir(), "apps", testVer);
    if (!fs.existsSync(appRelDir)) fs.mkdirSync(appRelDir, { recursive: true });

    // Place dummy MSI artifact in releases
    const dummyMsiPath = path.join(appRelDir, "PEC-App.msi");
    const dummyContent = Buffer.alloc(2048, "M");
    fs.writeFileSync(dummyMsiPath, dummyContent);

    try {
      // 1. Download via /api/app-builder/download/msi
      const res1 = await fetch(`${baseUrl}/api/app-builder/download/msi`, {
        headers: { "x-admin-token": TEST_ADMIN_TOKEN },
      });
      assert.equal(res1.status, 200);
      const buf1 = Buffer.from(await res1.arrayBuffer());
      assert.equal(buf1.length, 2048);

      // 2. Download via /api/releases/download/msi/:version
      const res2 = await fetch(`${baseUrl}/api/releases/download/msi/${testVer}`, {
        headers: { "x-admin-token": TEST_ADMIN_TOKEN },
      });
      assert.equal(res2.status, 200);
      const buf2 = Buffer.from(await res2.arrayBuffer());
      assert.equal(buf2.length, 2048);
    } finally {
      if (fs.existsSync(dummyMsiPath)) {
        try {
          fs.unlinkSync(dummyMsiPath);
        } catch {}
      }
    }
  });
});
