import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { TEST_TMP_DIR, TEST_TOKEN, TEST_ADMIN_TOKEN } from "./helpers/setup.js";
import { createReleasesRouter, computeFileSha256, releaseHashCache } from "../src/routes/releasesRoutes.js";
import { createBuilderRouter } from "../src/routes/builderRoutes.js";
import { createInstancesRouter } from "../src/routes/instancesRoutes.js";
import { createRoutingRouter } from "../src/routes/routingRoutes.js";
import { createAppSyncRouter } from "../src/routes/appSyncRoutes.js";
import { getBuildConfig } from "../src/packager.js";
import { getProxyConfig } from "../src/instances.js";
import { updateRotationConfig } from "../src/scheduler.js";
import { writeJsonAtomic } from "../src/jsonStore.js";
import { getReleasesMetaPath, getReleasesDir, getRotationConfigPath } from "../src/storage.js";
import serverApp from "../server.js";

async function startTestServer(router: express.Router): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      if (typeof (server as any).closeAllConnections === "function") {
        (server as any).closeAllConnections();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test("M-3: Releases download integrity check uses cached / streaming hash and detects mismatches", async () => {
  const testFile = path.join(TEST_TMP_DIR, "test-stream-hash.bin");
  const content = Buffer.alloc(1024 * 1024, 0x5a); // 1 MB buffer
  fs.writeFileSync(testFile, content);

  const expectedSha256 = crypto.createHash("sha256").update(content).digest("hex");

  // Verify computeFileSha256 computes correctly and caches
  if (typeof computeFileSha256 === "function") {
    const hash1 = await computeFileSha256(testFile);
    assert.strictEqual(hash1, expectedSha256);

    const stat = fs.statSync(testFile);
    const resolvedPath = path.resolve(testFile);
    const cacheKey = `${resolvedPath}:${stat.mtimeMs}:${stat.size}`;
    assert.ok(releaseHashCache?.has(cacheKey), "hash should be stored in cache");

    // Second call should return cached value
    const hash2 = await computeFileSha256(testFile);
    assert.strictEqual(hash2, expectedSha256);

    // Concurrent calls should resolve properly with in-flight deduplication
    const [hashA, hashB] = await Promise.all([
      computeFileSha256(testFile),
      computeFileSha256(testFile),
    ]);
    assert.strictEqual(hashA, expectedSha256);
    assert.strictEqual(hashB, expectedSha256);

    // Modify file: should compute new hash and update cache
    const newContent = Buffer.alloc(1024 * 1024, 0x3c);
    fs.writeFileSync(testFile, newContent);
    const newExpected = crypto.createHash("sha256").update(newContent).digest("hex");
    const hash3 = await computeFileSha256(testFile);
    assert.strictEqual(hash3, newExpected);
  } else {
    assert.fail("computeFileSha256 must be exported");
  }

  // Set up a release record and test through download router
  const releasesDir = path.resolve(getReleasesDir());
  const relExtDir = path.join(releasesDir, "extensions", "9.9.9");
  fs.mkdirSync(relExtDir, { recursive: true });
  const releaseFilePath = path.join(relExtDir, "extension-9.9.9.zip");
  fs.writeFileSync(releaseFilePath, content);

  const metaPath = getReleasesMetaPath();
  writeJsonAtomic(metaPath, {
    activeExtensionVersion: "9.9.9",
    activeAppVersion: "1.0.0",
    releases: [
      {
        type: "extension",
        version: "9.9.9",
        fileName: "extension-9.9.9.zip",
        filePath: releaseFilePath,
        fileSize: content.length,
        sha256: expectedSha256,
        uploadedAt: new Date().toISOString(),
        isActive: true,
      },
      {
        type: "extension",
        version: "9.9.7",
        fileName: "extension-9.9.7.zip",
        filePath: releaseFilePath,
        fileSize: content.length,
        sha256: "deadbeef00000000000000000000000000000000000000000000000000000000", // Mismatched hash
        uploadedAt: new Date().toISOString(),
        isActive: false,
      },
    ],
  });

  const releasesRouter = createReleasesRouter(
    () => TEST_ADMIN_TOKEN,
    undefined,
    () => TEST_TOKEN
  );
  const { baseUrl, close } = await startTestServer(releasesRouter);

  try {
    // 1. Valid download succeeds
    const res = await fetch(`${baseUrl}/api/releases/download/extension/9.9.9`, {
      headers: { "x-admin-token": TEST_ADMIN_TOKEN },
    });
    assert.strictEqual(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.strictEqual(buf.length, content.length);

    // 2. Mismatched hash triggers 500 integrity check failure
    const resMismatch = await fetch(`${baseUrl}/api/releases/download/extension/9.9.7`, {
      headers: { "x-admin-token": TEST_ADMIN_TOKEN },
    });
    assert.strictEqual(resMismatch.status, 500);
    const mismatchBody = (await resMismatch.json()) as any;
    assert.strictEqual(mismatchBody.ok, false);
    assert.strictEqual(mismatchBody.error, "Integrity check failed: release file SHA-256 mismatch");
  } finally {
    await close();
  }
});

test("M-9: Scheduler stores rotation secrets exclusively in rotation_config.json without mirroring", async () => {
  const envPath = path.resolve(".env");
  const envOriginal = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : null;

  try {
    const testSecret = "XuiPasswordUniqueTest12345!";
    updateRotationConfig({
      adminPass: testSecret,
      adminUser: "scheduler_admin",
      panelUrl: "https://xui.test.example:2053/base",
    });

    // Check .env does NOT contain testSecret
    if (fs.existsSync(envPath)) {
      const currentEnv = fs.readFileSync(envPath, "utf-8");
      assert.ok(!currentEnv.includes(testSecret), "Secrets must NOT be mirrored to .env");
    }

    // Check .rotation_secrets.json is NOT written
    const cfgPath = getRotationConfigPath();
    const secretsPath = path.join(path.dirname(cfgPath), ".rotation_secrets.json");
    assert.ok(!fs.existsSync(secretsPath), ".rotation_secrets.json must not exist");

    const fallbackSecrets = path.resolve("./data/.rotation_secrets.json");
    if (fs.existsSync(fallbackSecrets)) {
      const fbContent = fs.readFileSync(fallbackSecrets, "utf-8");
      assert.ok(!fbContent.includes(testSecret), "fallback .rotation_secrets.json must not contain new secret");
    }

    // Check rotation_config.json exists and has the secret
    assert.ok(fs.existsSync(cfgPath), "rotation_config.json must exist");
    const saved = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
    assert.strictEqual(saved.adminPass, testSecret);
  } finally {
    // Restore .env if needed
    if (envOriginal !== null) {
      fs.writeFileSync(envPath, envOriginal, "utf-8");
    }
  }
});

test("L-1: Builder routes filter unwhitelisted mass-assignment fields on config and build", async () => {
  const builderRouter = createBuilderRouter(() => TEST_TOKEN, () => TEST_ADMIN_TOKEN);
  const { baseUrl, close } = await startTestServer(builderRouter);

  try {
    const maliciousPayload = {
      name: "Hygiene Sanitized Ext",
      version: "1.2.3",
      unwhitelistedProp: "EVIL_PAYLOAD",
      __proto_pollution: "HACK",
      isAdmin: true,
      rootAccess: 1337,
    };

    // 1. Test POST /api/builder/config
    const res = await fetch(`${baseUrl}/api/builder/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(maliciousPayload),
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as any;
    assert.strictEqual(body.name, "Hygiene Sanitized Ext");
    assert.strictEqual(body.unwhitelistedProp, undefined);
    assert.strictEqual(body.__proto_pollution, undefined);
    assert.strictEqual(body.isAdmin, undefined);
    assert.strictEqual(body.rootAccess, undefined);

    const stored = getBuildConfig() as any;
    assert.strictEqual(stored.unwhitelistedProp, undefined);
    assert.strictEqual(stored.isAdmin, undefined);

    // 2. Test POST /api/builder/build
    const resBuild = await fetch(`${baseUrl}/api/builder/build`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Build Sanitized Ext",
        injectedBuildProp: "ATTACK",
        evilKey: 999,
      }),
    });
    assert.strictEqual(resBuild.status, 200);
    const storedAfterBuild = getBuildConfig() as any;
    assert.strictEqual(storedAfterBuild.name, "Build Sanitized Ext");
    assert.strictEqual(storedAfterBuild.injectedBuildProp, undefined);
    assert.strictEqual(storedAfterBuild.evilKey, undefined);
  } finally {
    await close();
  }
});

test("L-1: Instances config update filters unwhitelisted mass-assignment fields", async () => {
  const instancesRouter = createInstancesRouter();
  const { baseUrl, close } = await startTestServer(instancesRouter);

  try {
    const maliciousPayload = {
      host: "10.99.88.77",
      port: 8080,
      protocol: "http",
      injectedRole: "superadmin",
      secretBackdoor: true,
      arbitraryData: { exploit: true },
    };

    const res = await fetch(`${baseUrl}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(maliciousPayload),
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as any;
    assert.strictEqual(body.host, "10.99.88.77");
    assert.strictEqual(body.injectedRole, undefined);
    assert.strictEqual(body.secretBackdoor, undefined);
    assert.strictEqual(body.arbitraryData, undefined);

    const stored = getProxyConfig() as any;
    assert.strictEqual(stored.injectedRole, undefined);
    assert.strictEqual(stored.secretBackdoor, undefined);
  } finally {
    await close();
  }
});

test("L-3: AppSync and Releases routes return generic 500 without internal paths on errors, preserving 400 for bad input", async () => {
  // Test Releases route 500 behavior
  const releasesRouter = createReleasesRouter(
    () => TEST_ADMIN_TOKEN,
    undefined,
    () => TEST_TOKEN
  );

  // Set up a release whose file throws an error or fails unexpectedly during download
  const releasesDir = path.resolve(getReleasesDir());
  const relExtDir = path.join(releasesDir, "extensions", "9.9.8");
  fs.mkdirSync(relExtDir, { recursive: true });
  const releaseFilePath = path.join(relExtDir, "corrupted.zip");
  // File exists initially
  fs.writeFileSync(releaseFilePath, "valid-bytes");

  const metaPath = getReleasesMetaPath();
  writeJsonAtomic(metaPath, {
    activeExtensionVersion: "9.9.8",
    activeAppVersion: "1.0.0",
    releases: [
      {
        type: "extension",
        version: "9.9.8",
        fileName: "corrupted.zip",
        filePath: releaseFilePath,
        fileSize: 11,
        sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        uploadedAt: new Date().toISOString(),
        isActive: true,
      },
    ],
  });

  const { baseUrl: relUrl, close: closeRel } = await startTestServer(releasesRouter);

  try {
    // Delete file right before request so computeFileSha256 / stream triggers ENOENT
    fs.rmSync(releaseFilePath, { force: true });
    // Replace file with an unreadable directory: reading directory as file fails with EISDIR
    fs.mkdirSync(releaseFilePath);

    const res = await fetch(`${relUrl}/api/releases/download/extension/9.9.8`, {
      headers: { "x-admin-token": TEST_ADMIN_TOKEN },
    });
    assert.strictEqual(res.status, 500);
    const data = (await res.json()) as any;
    assert.strictEqual(data.ok, false);
    assert.strictEqual(data.error, "Internal server error");
    // Ensure no filesystem path leaked
    assert.ok(!JSON.stringify(data).includes("EISDIR"));
    assert.ok(!JSON.stringify(data).includes(TEST_TMP_DIR));
  } finally {
    await closeRel();
    try {
      fs.rmSync(releaseFilePath, { recursive: true, force: true });
    } catch {}
  }

  // Test AppSync route 500 behavior on internal error
  const appSyncFaultyRouter = createAppSyncRouter(() => {
    throw new Error("ENOENT: no such file or directory C:\\secret\\token.key");
  });
  const { baseUrl: appFaultyUrl, close: closeAppFaulty } = await startTestServer(appSyncFaultyRouter);

  try {
    const res = await fetch(`${appFaultyUrl}/api/app/sync`, {
      method: "POST",
      headers: {
        "x-fleet-token": TEST_TOKEN,
        "x-instance-id": "app-test-err",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        appInstanceId: "app-test-err",
      }),
    });
    assert.strictEqual(res.status, 500);
    const body = (await res.json()) as any;
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.error, "Internal server error");
    assert.ok(!JSON.stringify(body).includes("ENOENT"));
    assert.ok(!JSON.stringify(body).includes("token.key"));
  } finally {
    await closeAppFaulty();
  }

  // Test AppSync route preserves 400 Bad Request on client validation failure (e.g. __proto__)
  const appSyncValidRouter = createAppSyncRouter(() => TEST_TOKEN, () => TEST_ADMIN_TOKEN);
  const { baseUrl: appValidUrl, close: closeAppValid } = await startTestServer(appSyncValidRouter);

  try {
    const resProto = await fetch(`${appValidUrl}/api/app/sync`, {
      method: "POST",
      headers: {
        "x-fleet-token": TEST_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        appInstanceId: "__proto__",
        hostname: "HOST-1",
      }),
    });
    assert.strictEqual(resProto.status, 400);
    const protoBody = (await resProto.json()) as any;
    assert.strictEqual(protoBody.ok, false);
  } finally {
    await closeAppValid();
  }
});

test("L-9: Cannot create or modify preset with source 'builtin' or overwrite builtin presets", async () => {
  const routingRouter = createRoutingRouter();
  const { baseUrl, close } = await startTestServer(routingRouter);

  try {
    // 1. Try to create preset with source: "builtin"
    const resCreate = await fetch(`${baseUrl}/api/routing/presets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "preset-fake-builtin",
        name: "Fake Builtin",
        entries: ["example.com"],
        source: "builtin",
      }),
    });

    assert.strictEqual(resCreate.status, 400);
    const bodyCreate = (await resCreate.json()) as any;
    assert.strictEqual(bodyCreate.error, "Cannot create or modify builtin presets");

    // 2. Try with uppercase/whitespace " BUILTIN "
    const resCase = await fetch(`${baseUrl}/api/routing/presets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "preset-fake-builtin-case",
        name: "Fake Builtin Case",
        entries: ["example.com"],
        source: " BUILTIN ",
      }),
    });
    assert.strictEqual(resCase.status, 400);
    const bodyCase = (await resCase.json()) as any;
    assert.strictEqual(bodyCase.error, "Cannot create or modify builtin presets");

    // 3. Try to update an existing custom preset to source: "builtin"
    const resValid = await fetch(`${baseUrl}/api/routing/presets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "preset-custom-to-update",
        name: "Custom Preset",
        entries: ["custom.org"],
        source: "file",
      }),
    });
    assert.strictEqual(resValid.status, 200);

    const resUpdate = await fetch(`${baseUrl}/api/routing/presets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "preset-custom-to-update",
        name: "Updated Name",
        entries: ["custom.org"],
        source: "builtin",
      }),
    });
    assert.strictEqual(resUpdate.status, 400);
    const bodyUpdate = (await resUpdate.json()) as any;
    assert.strictEqual(bodyUpdate.error, "Cannot create or modify builtin presets");

    // 4. Try to overwrite builtin preset in import-file
    const resImportFile = await fetch(`${baseUrl}/api/routing/presets/import-file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "test.txt",
        content: "sub.example.com",
        id: "preset:ai_services", // ID of builtin preset
      }),
    });
    assert.strictEqual(resImportFile.status, 400);
    const bodyImport = (await resImportFile.json()) as any;
    assert.strictEqual(bodyImport.error, "Cannot overwrite builtin preset");
  } finally {
    await close();
  }
});

test("S-06: Root path Content-Security-Policy header includes frame-ancestors 'none'", async () => {
  const server = serverApp.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${baseUrl}/`);
    assert.strictEqual(res.status, 200);
    const csp = res.headers.get("content-security-policy");
    assert.ok(csp, "CSP header must be present on /");
    assert.match(csp, /frame-ancestors\s+'none'/, "CSP must contain frame-ancestors 'none'");
  } finally {
    if (typeof (server as any).closeAllConnections === "function") {
      (server as any).closeAllConnections();
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
