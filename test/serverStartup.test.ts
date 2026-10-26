import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import path from "node:path";
import http from "node:http";

test("H-7: Production startup fails fast when default token is in use", async (t) => {
  await t.test("exits with 1 in NODE_ENV=production with default token", async () => {
    const child = spawn(
      process.execPath,
      [path.resolve("node_modules/tsx/dist/cli.mjs"), path.resolve("server.ts")],
      {
        env: {
          ...process.env,
          NODE_ENV: "production",
          EXT_SHARED_TOKEN: "corp-proxy-secret-token-change-me",
          PEC_DISABLE_LISTEN: "true",
        },
      }
    );

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const exitCode = await new Promise<number>((resolve) => {
      child.on("close", (code) => resolve(code ?? 0));
    });

    assert.strictEqual(exitCode, 1, "Must exit with code 1 in production with default token");
    assert.match(
      stderr,
      /\[FATAL SECURITY ERROR\] EXT_SHARED_TOKEN is set to the default insecure value in production!/
    );
  });

  await t.test("allows startup in development or test with default token", async () => {
    const child = spawn(
      process.execPath,
      [path.resolve("node_modules/tsx/dist/cli.mjs"), path.resolve("server.ts")],
      {
        env: {
          ...process.env,
          NODE_ENV: "test",
          EXT_SHARED_TOKEN: "corp-proxy-secret-token-change-me",
          PEC_DISABLE_LISTEN: "true",
        },
      }
    );

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const exitCode = await new Promise<number>((resolve) => {
      child.on("close", (code) => resolve(code ?? 0));
    });

    assert.strictEqual(exitCode, 0, "Must exit with code 0 in test mode with default token");
  });
});

test("M-1: server-level enforcement of max 16KB payload on /api/app/sync and /api/sync", async () => {
  // Import the configured server app
  const { default: app } = await import("../server.js");
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const largePayload = {
      appInstanceId: "app-test-overflow",
      junkData: "X".repeat(20000),
    };

    const resAppSync = await fetch(`${baseUrl}/api/app/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(largePayload),
    });
    assert.strictEqual(resAppSync.status, 413, "POST /api/app/sync with > 16KB payload must return 413");
    const appSyncBody = await resAppSync.json();
    assert.match(appSyncBody.error, /Payload Too Large/i);

    const resExtSync = await fetch(`${baseUrl}/api/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(largePayload),
    });
    assert.strictEqual(resExtSync.status, 413, "POST /api/sync with > 16KB payload must return 413");
    const extSyncBody = await resExtSync.json();
    assert.match(extSyncBody.error, /Payload Too Large/i);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("H-4: global express body limit restricted to 1mb and import-file protected behind adminAuth", async () => {
  const { default: app } = await import("../server.js");
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Unauthenticated POST to normal endpoint with >1MB payload is rejected with 413
    const largeBuf = "x".repeat(1.5 * 1024 * 1024);
    const resAuthLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: largeBuf }),
    });
    assert.strictEqual(resAuthLogin.status, 413, "POST /api/auth/login with >1MB payload must return 413");

    // 2. Unauthenticated POST to import-file is rejected with 401 before body parsing
    const resImportUnauth = await fetch(`${baseUrl}/api/routing/presets/import-file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "test.txt", content: largeBuf, name: "Test" }),
    });
    assert.strictEqual(resImportUnauth.status, 401, "POST /api/routing/presets/import-file without auth must return 401");

    // 3. Authenticated POST to normal endpoint with >1MB payload is STILL rejected with 413 (max 1MB)
    const resAuthProfile = await fetch(`${baseUrl}/api/routing/profiles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Token": process.env.ADMIN_TOKEN || "test-root-admin-token",
      },
      body: JSON.stringify({ name: "Large Profile", extraBloat: largeBuf }),
    });
    assert.strictEqual(resAuthProfile.status, 413, "Authenticated POST with >1MB payload to normal endpoint must return 413");
    const authProfileBody = await resAuthProfile.json();
    assert.match(authProfileBody.error, /max 1MB/i);

    // 4. Authenticated POST to import-file accepts payload >1MB (e.g. 2MB)
    const twoMbContent = "domain.com\n".repeat(150000); // ~1.6MB
    const resImportAuth = await fetch(`${baseUrl}/api/routing/presets/import-file`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Token": process.env.ADMIN_TOKEN || "test-root-admin-token",
      },
      body: JSON.stringify({ filename: "large.txt", content: twoMbContent, name: "Large Preset" }),
    });
    assert.strictEqual(resImportAuth.status, 200, "Authenticated POST to import-file with >1MB payload must succeed");
    const importData = await resImportAuth.json();
    assert.strictEqual(importData.ok, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

