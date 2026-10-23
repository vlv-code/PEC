import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { getRoutingPresetsPath, getRoutingPresets, saveRoutingPresets } from "../src/storage.js";
import { expandRuleDomains, generatePacScript, GEO_PRESETS } from "../src/routing.js";
import { createRoutingRouter } from "../src/routes/routingRoutes.js";
import { withHttpServer } from "./helpers/http-server.js";
import type { RoutingPresetItem, RoutingRule, RoutingProfile, ProxyConfiguration } from "../src/types.js";

// Helper to write a protobuf varint into a buffer
function encodeVarint(val: number): Buffer {
  const bytes: number[] = [];
  let current = val;
  while (current > 0x7f) {
    bytes.push((current & 0x7f) | 0x80);
    current >>>= 7;
  }
  bytes.push(current & 0x7f);
  return Buffer.from(bytes);
}

// Helper to encode length-delimited field
function encodeLengthDelimited(fieldNum: number, data: Buffer): Buffer {
  const tag = (fieldNum << 3) | 2;
  return Buffer.concat([encodeVarint(tag), encodeVarint(data.length), data]);
}

function makeMockGeoSiteBuffer(tag: string, domains: string[]): Buffer {
  const domainBuffers = domains.map((d) => {
    return Buffer.concat([
      encodeVarint((1 << 3) | 0), // type = 0 (Plain)
      encodeVarint(0),
      encodeLengthDelimited(2, Buffer.from(d, "utf-8")),
    ]);
  });
  const siteBuffer = Buffer.concat([
    encodeLengthDelimited(1, Buffer.from(tag, "utf-8")),
    ...domainBuffers.map((db) => encodeLengthDelimited(2, db)),
  ]);
  return Buffer.concat([encodeLengthDelimited(1, siteBuffer)]);
}

function makeMockGeoIpBuffer(countryCode: string, cidrs: Array<{ ip: string; prefix: number }>): Buffer {
  const cidrBuffers = cidrs.map((c) => {
    const parts = c.ip.split(".").map(Number);
    const ipBuf = Buffer.from(parts);
    return Buffer.concat([
      encodeLengthDelimited(1, ipBuf),
      encodeVarint((2 << 3) | 0),
      encodeVarint(c.prefix),
    ]);
  });
  const geoIpEntry = Buffer.concat([
    encodeLengthDelimited(1, Buffer.from(countryCode, "utf-8")),
    ...cidrBuffers.map((cb) => encodeLengthDelimited(2, cb)),
  ]);
  return Buffer.concat([encodeLengthDelimited(1, geoIpEntry)]);
}

test.describe("Presets Dynamic Storage & Routing PAC", () => {
  const originalDataDir = process.env.DATA_DIR;
  const originalPresetsPath = process.env.ROUTING_PRESETS_PATH;
  let tempDir: string;

  test.beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `pec-test-presets-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    process.env.DATA_DIR = tempDir;
    delete process.env.ROUTING_PRESETS_PATH;
  });

  test.afterEach(() => {
    if (originalDataDir !== undefined) {
      process.env.DATA_DIR = originalDataDir;
    } else {
      delete process.env.DATA_DIR;
    }
    if (originalPresetsPath !== undefined) {
      process.env.ROUTING_PRESETS_PATH = originalPresetsPath;
    } else {
      delete process.env.ROUTING_PRESETS_PATH;
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("getRoutingPresetsPath returns resolved path inside DATA_DIR", () => {
    const expected = path.resolve(path.join(tempDir, "routing_presets.json"));
    assert.strictEqual(getRoutingPresetsPath(), expected);
  });

  test("getRoutingPresets seeds default built-in presets when file missing", () => {
    assert.strictEqual(fs.existsSync(getRoutingPresetsPath()), false);
    const presets = getRoutingPresets();
    assert.ok(Array.isArray(presets));
    assert.ok(presets.length >= GEO_PRESETS.length);
    assert.strictEqual(fs.existsSync(getRoutingPresetsPath()), true);

    const ai = presets.find((p) => p.id === "preset:ai_services");
    assert.ok(ai);
    assert.strictEqual(ai.source, "builtin");
    assert.ok(Array.isArray(ai.entries));
    assert.ok(ai.entries.includes("openai.com"));
  });

  test("saveRoutingPresets persists presets and getRoutingPresets returns them", () => {
    const customItem: RoutingPresetItem = {
      id: "preset:custom_cloud",
      name: "Custom Cloud Services",
      category: "custom",
      description: "Custom cloud infrastructure endpoints",
      type: "domain",
      source: "file",
      entries: ["*.internal.cloud", "api.internal.cloud"],
    };

    saveRoutingPresets([customItem]);
    const loaded = getRoutingPresets();
    assert.strictEqual(loaded.length, 1);
    assert.strictEqual(loaded[0].id, "preset:custom_cloud");
    assert.deepStrictEqual(loaded[0].entries, ["*.internal.cloud", "api.internal.cloud"]);
  });

  test("expandRuleDomains and PAC generation dynamically expand saved presets", () => {
    const customItem: RoutingPresetItem = {
      id: "preset:fintech_partners",
      name: "FinTech Partners",
      category: "custom",
      description: "Special fintech API endpoints",
      type: "domain",
      source: "file",
      entries: ["*.fintech-partner.com", "bank-api.example.org"],
    };

    saveRoutingPresets([...getRoutingPresets(), customItem]);

    const rule: RoutingRule = {
      id: "rule_fintech",
      name: "Route FinTech Partners to Proxy",
      targetType: "preset",
      pattern: "preset:fintech_partners",
      action: "proxy",
      enabled: true,
    };

    const expanded = expandRuleDomains(rule);
    assert.ok(expanded.includes("*.fintech-partner.com"));
    assert.ok(expanded.includes("bank-api.example.org"));

    const profile: RoutingProfile = {
      id: "prof_fintech",
      name: "FinTech Profile",
      description: "Test profile",
      defaultPolicy: "direct",
      rules: [rule],
      targetScope: "all",
      updatedAt: new Date().toISOString(),
    };

    const proxyConfig: ProxyConfiguration = {
      enabled: true,
      protocol: "http",
      host: "proxy.corp",
      port: 8080,
      bypassList: [],
      pacScript: "",
      pacUrl: "http://127.0.0.1:8080/pac",
      syncIntervalMs: 60000,
      killSwitch: false,
      updatedAt: new Date().toISOString(),
    };

    const pac = generatePacScript(profile, proxyConfig);
    assert.ok(pac.includes("fintech-partner.com"));
    assert.ok(pac.includes("bank-api.example.org"));
  });
});

test.describe("Presets Backend CRUD & Import API", () => {
  const originalDataDir = process.env.DATA_DIR;
  let tempDir: string;
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  test.beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `pec-test-api-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    process.env.DATA_DIR = tempDir;
    delete process.env.ROUTING_PRESETS_PATH;

    app = express();
    app.use(express.json({ limit: "50mb" }));
    app.use(createRoutingRouter());

    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  test.afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (originalDataDir !== undefined) {
      process.env.DATA_DIR = originalDataDir;
    } else {
      delete process.env.DATA_DIR;
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("GET /api/routing/presets returns array with entriesCount", async () => {
    const res = await fetch(`${baseUrl}/api/routing/presets`);
    assert.strictEqual(res.status, 200);
    const data = (await res.json()) as RoutingPresetItem[];
    assert.ok(Array.isArray(data));
    assert.ok(data.length >= GEO_PRESETS.length);
    for (const item of data) {
      assert.strictEqual(typeof (item as any).entriesCount, "number");
      assert.ok((item as any).entriesCount >= 0);
    }
  });

  test("GET /api/routing/presets/:id returns single preset with full entries or 404", async () => {
    const resAi = await fetch(`${baseUrl}/api/routing/presets/preset:ai_services`);
    assert.strictEqual(resAi.status, 200);
    const aiData = (await resAi.json()) as RoutingPresetItem;
    assert.strictEqual(aiData.id, "preset:ai_services");
    assert.ok(Array.isArray(aiData.entries));
    assert.ok(aiData.entries.includes("openai.com"));
    assert.strictEqual(typeof (aiData as any).entriesCount, "number");

    const res404 = await fetch(`${baseUrl}/api/routing/presets/preset:non_existent`);
    assert.strictEqual(res404.status, 404);
  });

  test("POST /api/routing/presets creates, updates, and validates presets", async () => {
    // Missing required fields
    const resBad = await fetch(`${baseUrl}/api/routing/presets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Incomplete" }),
    });
    assert.strictEqual(resBad.status, 400);

    // Create custom preset
    const newPreset = {
      id: "preset:custom_saas",
      name: "Custom SaaS Services",
      category: "custom",
      description: "Workplace SaaS endpoints",
      type: "domain",
      entries: ["app.slack.com", "*.notion.so"],
    };
    const resCreate = await fetch(`${baseUrl}/api/routing/presets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newPreset),
    });
    assert.strictEqual(resCreate.status, 200);
    const createdData = (await resCreate.json()) as any;
    assert.strictEqual(createdData.ok, true);
    assert.strictEqual(createdData.preset.id, "preset:custom_saas");
    assert.deepStrictEqual(createdData.preset.entries, ["app.slack.com", "*.notion.so"]);

    // Update existing preset
    const updateRes = await fetch(`${baseUrl}/api/routing/presets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "preset:custom_saas",
        name: "Custom SaaS Services Updated",
        entries: ["app.slack.com", "*.notion.so", "zoom.us"],
      }),
    });
    assert.strictEqual(updateRes.status, 200);
    const updatedData = (await updateRes.json()) as any;
    assert.strictEqual(updatedData.ok, true);
    assert.strictEqual(updatedData.preset.name, "Custom SaaS Services Updated");
    assert.ok(updatedData.preset.entries.includes("zoom.us"));
  });

  test("DELETE /api/routing/presets/:id forbids deleting builtin presets and removes custom presets", async () => {
    // Attempt deleting builtin
    const resBuiltin = await fetch(`${baseUrl}/api/routing/presets/preset:ai_services`, {
      method: "DELETE",
    });
    assert.strictEqual(resBuiltin.status, 400);
    const errData = (await resBuiltin.json()) as any;
    assert.ok(errData.error.includes("builtin"));

    // Attempt deleting nonexistent
    const res404 = await fetch(`${baseUrl}/api/routing/presets/preset:random_nonexistent`, {
      method: "DELETE",
    });
    assert.strictEqual(res404.status, 404);

    // Create then delete custom preset
    saveRoutingPresets([
      ...getRoutingPresets(),
      {
        id: "preset:to_delete",
        name: "To Delete",
        category: "custom",
        description: "Temporary preset",
        type: "domain",
        source: "file",
        entries: ["temp.example.com"],
      },
    ]);

    const resDel = await fetch(`${baseUrl}/api/routing/presets/preset:to_delete`, {
      method: "DELETE",
    });
    assert.strictEqual(resDel.status, 200);
    const delData = (await resDel.json()) as any;
    assert.strictEqual(delData.ok, true);

    const recheck = getRoutingPresets().find((p) => p.id === "preset:to_delete");
    assert.strictEqual(recheck, undefined);
  });

  test("POST /api/routing/presets/import-url blocks SSRF attempts", async () => {
    const badTargets = [
      "http://169.254.169.254/latest/meta-data",
      "http://metadata.google.internal/computeMetadata/v1",
      "http://metadata.goog",
      "file:///etc/passwd",
      "ftp://somewhere.org/list.txt",
    ];

    for (const url of badTargets) {
      const res = await fetch(`${baseUrl}/api/routing/presets/import-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      assert.strictEqual(res.status, 400);
      const data = (await res.json()) as any;
      assert.ok(data.error);
    }
  });

  test("POST /api/routing/presets/import-url fetches plaintext and geosite dat from safe URL", async () => {
    // 1. Plaintext mock server
    const mockHttp = await withHttpServer((req, res) => {
      if (req.url === "/domains.txt") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("# Comment line\nexample.com\n*.test.org # inline\n\nsub.example.net\n");
      } else if (req.url === "/geosite.dat") {
        const buf = makeMockGeoSiteBuffer("RU", ["custom-ru.org", "*.yandex.net"]);
        res.writeHead(200, { "Content-Type": "application/octet-stream" });
        res.end(buf);
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    try {
      // Import plaintext
      const resTxt = await fetch(`${baseUrl}/api/routing/presets/import-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: `${mockHttp.url}/domains.txt`,
          name: "Imported Domains",
        }),
      });
      assert.strictEqual(resTxt.status, 200);
      const txtData = (await resTxt.json()) as any;
      assert.strictEqual(txtData.ok, true);
      assert.strictEqual(txtData.preset.source, "remote");
      assert.deepStrictEqual(txtData.preset.entries, ["example.com", "*.test.org", "sub.example.net"]);

      // Import geosite dat
      const resDat = await fetch(`${baseUrl}/api/routing/presets/import-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: `${mockHttp.url}/geosite.dat`,
          tag: "RU",
          name: "Imported GeoSite RU",
        }),
      });
      assert.strictEqual(resDat.status, 200);
      const datData = (await resDat.json()) as any;
      assert.strictEqual(datData.ok, true);
      assert.strictEqual(datData.preset.source, "remote");
      assert.deepStrictEqual(datData.preset.entries, ["custom-ru.org", "*.yandex.net"]);
    } finally {
      await mockHttp.close();
    }
  });

  test("POST /api/routing/presets/import-file imports txt and base64 dat files", async () => {
    // Plaintext import
    const resTxt = await fetch(`${baseUrl}/api/routing/presets/import-file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "blocklist.txt",
        content: "# Blocklist file\nbadsite.com\n*.tracker.io\n",
        name: "Imported Blocklist",
      }),
    });
    assert.strictEqual(resTxt.status, 200);
    const txtData = (await resTxt.json()) as any;
    assert.strictEqual(txtData.ok, true);
    assert.strictEqual(txtData.preset.source, "file");
    assert.deepStrictEqual(txtData.preset.entries, ["badsite.com", "*.tracker.io"]);

    // Base64 dat import
    const datBuf = makeMockGeoSiteBuffer("NEWS", ["bbc.co.uk", "cnn.com"]);
    const resDat = await fetch(`${baseUrl}/api/routing/presets/import-file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "geosite.dat",
        content: datBuf.toString("base64"),
        tag: "NEWS",
        name: "News Sites",
      }),
    });
    assert.strictEqual(resDat.status, 200);
    const datData = (await resDat.json()) as any;
    assert.strictEqual(datData.ok, true);
    assert.strictEqual(datData.preset.source, "file");
    assert.deepStrictEqual(datData.preset.entries, ["bbc.co.uk", "cnn.com"]);
  });

  test("POST /api/routing/presets/:id/refresh re-fetches remote presets", async () => {
    let returnVersion = 1;
    const mockHttp = await withHttpServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      if (returnVersion === 1) {
        res.end("v1.example.com\n");
      } else {
        res.end("v1.example.com\nv2.example.com\n");
      }
    });

    try {
      // 1. Initial import
      const resImport = await fetch(`${baseUrl}/api/routing/presets/import-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: `${mockHttp.url}/dynamic-list.txt`,
          name: "Refreshable Preset",
        }),
      });
      assert.strictEqual(resImport.status, 200);
      const imported = (await resImport.json()) as any;
      const presetId = imported.preset.id;
      assert.deepStrictEqual(imported.preset.entries, ["v1.example.com"]);

      // 2. Server updates content
      returnVersion = 2;

      // 3. Trigger refresh
      const resRefresh = await fetch(`${baseUrl}/api/routing/presets/${presetId}/refresh`, {
        method: "POST",
      });
      assert.strictEqual(resRefresh.status, 200);
      const refreshed = (await resRefresh.json()) as any;
      assert.strictEqual(refreshed.ok, true);
      assert.deepStrictEqual(refreshed.preset.entries, ["v1.example.com", "v2.example.com"]);

      // 4. Refreshing preset with no sourceUrl returns 400
      const resNoUrl = await fetch(`${baseUrl}/api/routing/presets/preset:ai_services/refresh`, {
        method: "POST",
      });
      assert.strictEqual(resNoUrl.status, 400);

      // 5. Refreshing unknown preset returns 404
      const res404 = await fetch(`${baseUrl}/api/routing/presets/preset:unknown/refresh`, {
        method: "POST",
      });
      assert.strictEqual(res404.status, 404);
    } finally {
      await mockHttp.close();
    }
  });
});
