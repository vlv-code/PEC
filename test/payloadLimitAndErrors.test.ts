import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import app from "../server.js";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

test("API JSON Error Handling & Payload Limits", async (t) => {
  let server: Server;
  let baseUrl: string;

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  await t.test("POST /api/sync enforces 16KB max payload", async () => {
    const largeSyncPayload = {
      instanceId: "test-large-sync",
      activeProxyMode: "DIRECT",
      extraBloat: "a".repeat(20000),
    };
    const res = await fetch(`${baseUrl}/api/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(largeSyncPayload),
    });
    assert.strictEqual(res.status, 413);
    const data = await res.json();
    assert.match(data.error, /Payload Too Large/i);
  });

  await t.test("POST /api/routing/presets/import-file accepts payloads larger than 5MB (e.g. 10MB)", async () => {
    // 6MB payload (previously crashed with 413 at 5MB)
    const content = "example.com\n".repeat(450000); // ~5.4MB of domains
    const res = await fetch(`${baseUrl}/api/routing/presets/import-file`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Token": process.env.ADMIN_TOKEN || "test-root-admin-token",
      },
      body: JSON.stringify({
        filename: "large_domains.txt",
        content: content,
        name: "Large Domain Preset",
      }),
    });
    assert.strictEqual(res.status, 200);
    const data = (await res.json()) as any;
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.preset.name, "Large Domain Preset");
  });

  await t.test("Express error middleware returns JSON instead of HTML on malformed JSON", async () => {
    const res = await fetch(`${baseUrl}/api/routing/presets/import-file`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Token": process.env.ADMIN_TOKEN || "test-root-admin-token",
      },
      body: '{"brokenJson": true,',
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.headers.get("content-type")?.includes("application/json"), true);
    const data = (await res.json()) as any;
    assert.strictEqual(data.ok, false);
    assert.ok(data.error);
  });
});
