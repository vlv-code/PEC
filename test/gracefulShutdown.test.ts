import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const TSX_CLI = path.resolve(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const SERVER_SCRIPT = path.resolve(REPO_ROOT, "server.ts");

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

test("gracefulShutdown: server drains active keep-alive requests and rejects new connections on SIGTERM", async (t) => {
  const port = await getFreePort();
  const host = "127.0.0.1";

  const child = spawn(process.execPath, [TSX_CLI, SERVER_SCRIPT], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PEC_DISABLE_LISTEN: "false",
      PORT: String(port),
      HOST: host,
      ADMIN_TOKEN: "test-admin-token-3891",
      EXT_SHARED_TOKEN: "test-ext-token-3891",
    },
    stdio: ["pipe", "pipe", "pipe", "ipc"],
  });

  t.after(() => {
    try {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    } catch {}
  });

  let stdoutLogs = "";
  let stderrLogs = "";

  const serverReadyPromise = new Promise<void>((resolve) => {
    child.stdout?.on("data", (chunk: Buffer) => {
      const s = chunk.toString();
      stdoutLogs += s;
      if (s.includes("Active listening on:")) {
        resolve();
      }
    });
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    stderrLogs += chunk.toString();
  });

  const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });

  // Wait for server to indicate it is listening
  const startTimeout = setTimeout(() => {
    throw new Error(`Server failed to start within 20s.\nSTDOUT:\n${stdoutLogs}\nSTDERR:\n${stderrLogs}`);
  }, 20000);
  await serverReadyPromise;
  clearTimeout(startTimeout);

  // 1. Initiate active keep-alive request
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  let activeSocket: net.Socket | undefined;

  const activeRequestPromise = new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
    const req = http.request(
      {
        hostname: host,
        port,
        path: "/proxy.pac",
        method: "GET",
        agent,
        headers: {
          Connection: "keep-alive",
        },
      },
      (res) => {
        activeSocket = res.socket;
        res.socket?.on("error", () => {});

        // Send SIGTERM while response is in flight
        if (process.platform === "win32" && typeof child.send === "function") {
          child.send({ type: "SIGTERM" });
          child.send("SIGTERM");
        } else {
          child.kill("SIGTERM");
        }

        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode || 0, body: data });
        });
        res.on("error", reject);
      }
    );
    req.on("socket", (sock) => {
      activeSocket = sock;
      sock.on("error", () => {});
    });
    req.on("error", reject);
    req.end();
  });

  // 3. Verify the active request completes with 200
  const activeRes = await activeRequestPromise;
  assert.strictEqual(activeRes.statusCode, 200, "Active request must complete with HTTP 200");
  assert.ok(activeRes.body.length > 0, "Active request must return body content");

  // Clean up client-side keep-alive agent and socket
  try {
    activeSocket?.end();
    agent.destroy();
  } catch {}

  // 4. Verify new requests are rejected (ECONNREFUSED or ECONNRESET)
  let rejected = false;
  let lastErr: any;
  for (let i = 0; i < 20; i++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const client = net.connect({ port, host });
        client.on("connect", () => {
          client.destroy();
          reject(new Error("Server accepted connection after SIGTERM"));
        });
        client.on("error", (err) => {
          reject(err);
        });
      });
    } catch (err: any) {
      lastErr = err;
      if (err.code === "ECONNREFUSED" || err.code === "ECONNRESET") {
        rejected = true;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  assert.ok(
    rejected,
    `New requests after SIGTERM must be rejected with ECONNREFUSED/ECONNRESET (got ${lastErr?.code || lastErr?.message})`
  );

  // 5. Verify process terminates cleanly with code 0 within 5 seconds
  const exitTimeout = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((_, reject) =>
    setTimeout(() => reject(new Error("Server process did not exit within 5 seconds of SIGTERM")), 5000)
  );

  const { code, signal } = await Promise.race([exitPromise, exitTimeout]);
  assert.strictEqual(code, 0, `Server process must exit with code 0 (got code ${code}, signal ${signal})`);
});
