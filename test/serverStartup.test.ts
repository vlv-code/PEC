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
