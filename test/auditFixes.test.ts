import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import http from "node:http";
import express, { Request, Response } from "express";
import type { AddressInfo } from "node:net";
import { saveProfile, generatePacScript, getAllProfiles } from "../src/routing.js";
import { createRoutingRouter } from "../src/routes/routingRoutes.js";
import { registerHeartbeat } from "../src/instances.js";
import { safeCorsMiddleware } from "../src/middleware/security.js";
import { createManifestObject, packageExtension } from "../src/packager.js";
import { createBuilderRouter } from "../src/routes/builderRoutes.js";
import { GEO_PRESETS } from "../src/defaultPresets.js";
import { TEST_ADMIN_TOKEN, TEST_TOKEN } from "./helpers/setup.js";

test("U1 / H-2: import-url refuses HTTP redirects (SSRF guard)", async () => {
  // Setup a server that issues a 302 redirect
  const redirectTarget = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("secret-data\n");
  });
  redirectTarget.listen(0, "127.0.0.1");
  await new Promise<void>((r) => redirectTarget.once("listening", () => r()));
  const targetPort = (redirectTarget.address() as AddressInfo).port;

  const redirectServer = http.createServer((_req, res) => {
    res.writeHead(302, { Location: `http://127.0.0.1:${targetPort}/` });
    res.end();
  });
  redirectServer.listen(0, "127.0.0.1");
  await new Promise<void>((r) => redirectServer.once("listening", () => r()));
  const redirectPort = (redirectServer.address() as AddressInfo).port;

  const app = express();
  app.use(express.json());
  app.use(createRoutingRouter());
  const apiServer = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => apiServer.once("listening", () => r()));
  const apiPort = (apiServer.address() as AddressInfo).port;

  try {
    const res = await fetch(`http://127.0.0.1:${apiPort}/api/routing/presets/import-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: `http://127.0.0.1:${redirectPort}/` }),
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /redirect/i, "Must refuse redirects");
  } finally {
    redirectTarget.close();
    redirectServer.close();
    apiServer.close();
  }
});

test("U2 / N2: saveProfile whitelists actions/defaultPolicy and prevents PAC comment injection", () => {
  const injectionAttempt = "proxy\nfunction InjectedCode() { return 'EVIL'; }\n//";
  const profile = saveProfile({
    name: "Injection Test",
    defaultPolicy: injectionAttempt as any,
    rules: [
      {
        id: "r1",
        name: "Test Injection Rule",
        targetType: "domain",
        pattern: "example.com",
        action: injectionAttempt as any,
        enabled: true,
      },
    ],
  });

  // Action and defaultPolicy must be whitelisted
  assert.strictEqual(profile.defaultPolicy, "direct", "invalid defaultPolicy must fall back to direct");
  assert.strictEqual(profile.rules[0].action, "proxy", "invalid action must fall back to proxy");

  // Generated PAC must not contain the injection payload
  const pac = generatePacScript(profile, { host: "127.0.0.1", port: 10809, protocol: "http" } as any);
  assert.ok(!pac.includes("function InjectedCode"), "Injected script must not appear in PAC");
  assert.ok(!pac.includes(injectionAttempt), "Raw injection string must not appear in PAC");
});

test("U3 / N3: generatePacScript deduplicates domains and enforces entry cap", () => {
  const duplicateDomains = Array.from({ length: 50 }, () => "duplicate.example.com");
  const profile = saveProfile({
    name: "Dedupe Test",
    defaultPolicy: "direct",
    rules: [
      {
        id: "r_dedupe",
        name: "Dedupe Rule",
        targetType: "domain",
        pattern: duplicateDomains.join(","),
        action: "proxy",
        enabled: true,
      },
    ],
  });

  const pac = generatePacScript(profile, { host: "127.0.0.1", port: 10809, protocol: "http", enabled: true } as any);
  // Domain check for duplicate.example.com should only appear once
  const matches = pac.match(/duplicate\.example\.com/g) || [];
  // Each domain check creates (host === "..." || dnsDomainIs(host, "...")) -> 2 occurrences per domain
  assert.strictEqual(matches.length, 2, "Duplicate domain must be checked only once");
});

test("U5 / N5: parseGeodataBuffer throws error on missing tag instead of silent fallback", async () => {
  const app = express();
  app.use(express.json());
  app.use(createRoutingRouter());
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const port = (server.address() as AddressInfo).port;

  // Serve a dummy .dat buffer with no matching tag
  const dummyDatServer = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    res.end(Buffer.from([0x00, 0x01, 0x02]));
  });
  dummyDatServer.listen(0, "127.0.0.1");
  await new Promise<void>((r) => dummyDatServer.once("listening", () => r()));
  const datPort = (dummyDatServer.address() as AddressInfo).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/routing/presets/import-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: `http://127.0.0.1:${datPort}/test.dat`, tag: "NON_EXISTENT_TAG" }),
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /not found/i, "Must error out when tag is missing");
  } finally {
    dummyDatServer.close();
    server.close();
  }
});

test("U8 / M-8: createManifestObject produces consistent MV3 manifest with minimum_chrome_version 108 and no type module", () => {
  const manifest = createManifestObject({
    name: "PEC Corp",
    shortName: "PEC",
    version: "1.4.0",
    uiMode: "popup",
  });

  assert.strictEqual(manifest.manifest_version, 3);
  assert.strictEqual(manifest.minimum_chrome_version, "108");
  assert.strictEqual((manifest.background as any).service_worker, "background.js");
  assert.strictEqual((manifest.background as any).type, undefined, "MV3 service worker must not have type: module");
  assert.strictEqual((manifest.storage as any).managed_schema, "managed_schema.json");
});

test("H-1: registerHeartbeat trims group and activeProxyMode to 64 chars", () => {
  const hugeString = "A".repeat(10000);
  const rec = registerHeartbeat({
    instanceId: "test-inst-h1",
    ip: "127.0.0.1",
    version: "1.0.0",
    group: hugeString,
    activeProxyMode: hugeString,
  });

  assert.strictEqual(rec.group?.length, 64, "group must be clamped to 64 chars");
  assert.strictEqual(rec.activeProxyMode?.length, 64, "activeProxyMode must be clamped to 64 chars");
});

test("M-1 & M-2: CORS does not grant Allow-Credentials to extensions or untrusted X-Forwarded-Host", () => {
  interface MockRes {
    headers: Record<string, string>;
    setHeader: (k: string, v: string) => void;
  }
  const makeRes = (): MockRes => {
    const headers: Record<string, string> = {};
    return {
      headers,
      setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
    };
  };

  // 1. Extension origin gets Allow-Origin but NOT Allow-Credentials
  const extReq = {
    headers: { origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop" },
    path: "/api/sync",
  } as unknown as Request;
  const extRes = makeRes();
  safeCorsMiddleware(extReq, extRes as unknown as Response, () => {});
  assert.strictEqual(extRes.headers["access-control-allow-origin"], "chrome-extension://abcdefghijklmnopabcdefghijklmnop");
  assert.strictEqual(extRes.headers["access-control-allow-credentials"], undefined, "Extension must not get Allow-Credentials");

  // 2. Untrusted X-Forwarded-Host without trust proxy is ignored
  const spoofReq = {
    headers: {
      origin: "https://evil.corp",
      "x-forwarded-host": "evil.corp",
      host: "real.corp",
    },
    app: { get: (_k: string) => false },
    path: "/api/config",
  } as unknown as Request;
  const spoofRes = makeRes();
  safeCorsMiddleware(spoofReq, spoofRes as unknown as Response, () => {});
  assert.strictEqual(spoofRes.headers["access-control-allow-origin"], undefined, "Untrusted XFH must not reflect evil origin");
});

test("M-7: POST /api/builder/config rejects defaultToken matching ADMIN_TOKEN with 400", async () => {
  const app = express();
  app.use(express.json());
  app.use(createBuilderRouter(() => TEST_TOKEN, () => TEST_ADMIN_TOKEN));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const port = (server.address() as AddressInfo).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/builder/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultToken: TEST_ADMIN_TOKEN }),
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /ADMIN_TOKEN/);
  } finally {
    server.close();
  }
});

test("M-9: POST /api/routing/presets rejects overwriting builtin presets", async () => {
  const app = express();
  app.use(express.json());
  app.use(createRoutingRouter());
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const port = (server.address() as AddressInfo).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/routing/presets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "preset:ai_services",
        name: "Hacked Preset",
        entries: ["evil.com"],
      }),
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Cannot overwrite builtin preset/i);
  } finally {
    server.close();
  }
});
