import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import express from "express";
import { createCredsRouter, getFallbackPacSecret, resetFallbackPacSecretForTest, resolvePacSecret, EnrollmentTracker } from "../src/routes/credsRoutes.js";
import { signPacUrlParams } from "../src/pacSigner.js";
import { enrollInstanceToken, revokeInstanceToken, deleteInstance, _clearPersistentMetaForTesting } from "../src/instances.js";
import { atomicWriteCreds, getCredsStorePath } from "../src/rotate.js";
import { loadDockerSecrets } from "../src/loadEnv.js";

test("M-1 & M-2: credsRoutes payload limit and enrolled token exclusivity", async (t) => {
  atomicWriteCreds(getCredsStorePath(), { user: "test-user", pass: "test-pass" });
  const SHARED_TOKEN = "shared-fleet-token-1234567890";

  const app = express();
  app.use(express.json({ limit: "5mb" })); // Outer parser with high limit to test route-level guard
  app.use(createCredsRouter(() => SHARED_TOKEN));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    _clearPersistentMetaForTesting();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  await t.test("M-1: rejects payload with Content-Length > 16384 with 413", async () => {
    const largeString = "A".repeat(17000);
    const res = await fetch(`${baseUrl}/api/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Ext-Token": SHARED_TOKEN,
      },
      body: JSON.stringify({
        instanceId: "test-inst-large",
        extraData: largeString,
      }),
    });

    assert.strictEqual(res.status, 413);
    const body = await res.json();
    assert.match(body.error, /Payload Too Large/i);
  });

  await t.test("M-1: allows payload <= 16384 with 200", async () => {
    const res = await fetch(`${baseUrl}/api/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Ext-Token": SHARED_TOKEN,
      },
      body: JSON.stringify({
        instanceId: "test-inst-ok",
        version: "1.0.0",
      }),
    });

    assert.strictEqual(res.status, 200);
    deleteInstance("test-inst-ok");
  });

  await t.test("M-2: enrolled instance cannot use shared token fallback", async () => {
    const instanceId = "test-enrolled-inst-1";
    deleteInstance(instanceId);

    const dedicatedToken = "instance-secret-token-abcdef";
    const tokenHash = crypto.createHash("sha256").update(dedicatedToken).digest("hex");
    enrollInstanceToken(instanceId, tokenHash);

    // 1. Request with dedicated instance token must succeed
    const resDedicated = await fetch(`${baseUrl}/api/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Ext-Token": dedicatedToken,
        "X-Instance-Id": instanceId,
      },
      body: JSON.stringify({
        instanceId,
        version: "1.0.0",
      }),
    });
    assert.strictEqual(resDedicated.status, 200, "Dedicated instance token must authenticate");

    // 2. Revoking the instance token must reject subsequent requests with 403
    revokeInstanceToken(instanceId);

    const resRevoked = await fetch(`${baseUrl}/api/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Ext-Token": SHARED_TOKEN,
        "X-Instance-Id": instanceId,
      },
      body: JSON.stringify({
        instanceId,
        version: "1.0.0",
      }),
    });
    assert.strictEqual(resRevoked.status, 403, "Revoked instance must be rejected");

    // 3. /creds endpoint must also reject revoked instance
    const resCredsRevoked = await fetch(`${baseUrl}/creds?instanceId=${encodeURIComponent(instanceId)}`, {
      headers: {
        "X-Ext-Token": dedicatedToken,
      },
    });
    assert.strictEqual(resCredsRevoked.status, 403, "GET /creds must reject revoked instance");

    deleteInstance(instanceId);
  });
});

test("S-1: in-memory random PAC secret retained across calls and rejects hardcoded 'pec-pac-secret'", async (t) => {
  const origPacSigSec = process.env.PAC_SIGNING_SECRET;
  const origReqSig = process.env.PAC_REQUIRE_SIGNATURE;

  try {
    delete process.env.PAC_SIGNING_SECRET;
    resetFallbackPacSecretForTest();

    // 1. Secret is 64 hex characters (32 random bytes)
    const secret1 = getFallbackPacSecret();
    assert.strictEqual(typeof secret1, "string");
    assert.strictEqual(secret1.length, 64);
    assert.match(secret1, /^[0-9a-f]{64}$/);

    // 2. Secret is retained across multiple invocations
    const secret2 = getFallbackPacSecret();
    assert.strictEqual(secret2, secret1, "In-memory PAC secret must be retained across calls");

    // 3. resolvePacSecret resolves to in-memory secret when PAC_SIGNING_SECRET and shared token are empty
    const resolvedSecret = resolvePacSecret(() => "");
    assert.strictEqual(resolvedSecret, secret1);

    // 4. Test HTTP integration: router uses retained secret and rejects hardcoded 'pec-pac-secret'
    process.env.PAC_REQUIRE_SIGNATURE = "1";
    const app = express();
    app.use(createCredsRouter(() => ""));

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const profileId = "profile_default_split";

      // Request signed with old hardcoded secret "pec-pac-secret" MUST fail (403)
      const forged = signPacUrlParams(profileId, "pec-pac-secret", 3600);
      const resForged = await fetch(`${baseUrl}/proxy.pac?profileId=${profileId}&exp=${forged.exp}&sig=${forged.sig}`);
      assert.strictEqual(resForged.status, 403, "Signatures with old hardcoded 'pec-pac-secret' must be rejected");

      // Request signed with genuine in-memory secret MUST succeed (200)
      const valid = signPacUrlParams(profileId, secret1, 3600);
      const resValid = await fetch(`${baseUrl}/proxy.pac?profileId=${profileId}&exp=${valid.exp}&sig=${valid.sig}`);
      assert.strictEqual(resValid.status, 200, "Signatures with in-memory secret must succeed");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    // 5. Resetting generates a fresh new secret
    resetFallbackPacSecretForTest();
    const secret3 = getFallbackPacSecret();
    assert.notStrictEqual(secret3, secret1, "Reset must cause new random secret generation");

    // 6. Whitespace PAC_SIGNING_SECRET is treated as unset
    process.env.PAC_SIGNING_SECRET = "   ";
    assert.strictEqual(resolvePacSecret(() => ""), secret3, "Whitespace PAC_SIGNING_SECRET should fallback to in-memory secret");

    // 7. Throwing getSharedToken does not crash resolvePacSecret
    delete process.env.PAC_SIGNING_SECRET;
    const throwingTokenGetter = () => {
      throw new Error("token error");
    };
    assert.strictEqual(resolvePacSecret(throwingTokenGetter), secret3, "Throwing getSharedToken should fallback safely");

    // 8. Explicit valid PAC_SIGNING_SECRET takes precedence
    process.env.PAC_SIGNING_SECRET = "custom-prod-pac-secret-999";
    assert.strictEqual(resolvePacSecret(() => "fleet-token"), "custom-prod-pac-secret-999");
  } finally {
    if (origPacSigSec !== undefined) process.env.PAC_SIGNING_SECRET = origPacSigSec;
    else delete process.env.PAC_SIGNING_SECRET;

    if (origReqSig !== undefined) process.env.PAC_REQUIRE_SIGNATURE = origReqSig;
    else delete process.env.PAC_REQUIRE_SIGNATURE;
    resetFallbackPacSecretForTest();
  }
});

test("CHAIN-1 & S-03: credsRoutes authentication chain, instanceId input validation, and fail-closed security", async (t) => {
  atomicWriteCreds(getCredsStorePath(), { user: "wave2-user", pass: "wave2-pass" });
  const SHARED_TOKEN = "shared-fleet-token-wave2-test";

  const app = express();
  app.use(express.json());
  app.use(createCredsRouter(() => SHARED_TOKEN));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    _clearPersistentMetaForTesting();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  await t.test("CHAIN-1: GET /creds with sharedToken and no instanceId returns 403 Forbidden", async () => {
    const res = await fetch(`${baseUrl}/creds`, {
      headers: {
        "X-Ext-Token": SHARED_TOKEN,
      },
    });
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.detail, "Forbidden");
  });

  await t.test("S-03: GET /creds with invalid instanceId (e.g. bad!id) returns 400 Bad Request", async () => {
    const res = await fetch(`${baseUrl}/creds?instanceId=${encodeURIComponent("bad!id")}`, {
      headers: {
        "X-Ext-Token": SHARED_TOKEN,
      },
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.error, "Invalid instanceId");
  });

  await t.test("S-03: POST /api/sync with invalid instanceId returns 400 immediately without hanging", async () => {
    const res = await fetch(`${baseUrl}/api/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Ext-Token": SHARED_TOKEN,
      },
      body: JSON.stringify({
        instanceId: "invalid/id!@#",
        version: "1.0.0",
      }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.error, "Invalid instanceId");
  });

  await t.test("CHAIN-1: GET /creds with un-enrolled valid instanceId and sharedToken returns 403", async () => {
    const freshId = "inst-unenrolled-valid";
    deleteInstance(freshId);

    const res = await fetch(`${baseUrl}/creds?instanceId=${encodeURIComponent(freshId)}`, {
      headers: {
        "X-Ext-Token": SHARED_TOKEN,
      },
    });
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.detail, "Forbidden");
  });

  await t.test("CHAIN-1: GET /creds with revoked instance returns 403 Forbidden regardless of token", async () => {
    const instId = "inst-wave2-revoked";
    deleteInstance(instId);

    const dedicatedToken = "dedicated-token-revoked-test-999";
    const tokenHash = crypto.createHash("sha256").update(dedicatedToken).digest("hex");
    enrollInstanceToken(instId, tokenHash);
    revokeInstanceToken(instId);

    // With dedicated token
    const resDedicated = await fetch(`${baseUrl}/creds?instanceId=${encodeURIComponent(instId)}`, {
      headers: { "X-Ext-Token": dedicatedToken },
    });
    assert.strictEqual(resDedicated.status, 403);

    // With shared token
    const resShared = await fetch(`${baseUrl}/creds?instanceId=${encodeURIComponent(instId)}`, {
      headers: { "X-Ext-Token": SHARED_TOKEN },
    });
    assert.strictEqual(resShared.status, 403);

    deleteInstance(instId);
  });

  await t.test("CHAIN-1: GET /creds with valid enrolled instance and matching instanceToken returns 200", async () => {
    const instId = "inst-wave2-enrolled-ok";
    deleteInstance(instId);

    const dedicatedToken = "dedicated-token-ok-test-1234567";
    const tokenHash = crypto.createHash("sha256").update(dedicatedToken).digest("hex");
    enrollInstanceToken(instId, tokenHash);

    const res = await fetch(`${baseUrl}/creds?instanceId=${encodeURIComponent(instId)}`, {
      headers: { "X-Ext-Token": dedicatedToken },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.user, "wave2-user");
    assert.strictEqual(body.pass, "wave2-pass");

    deleteInstance(instId);
  });
});

test("N-5: loadDockerSecrets reads secrets from *_FILE suffix paths into process.env", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pec-docker-secrets-"));
  const adminTokenFile = path.join(tmpDir, "admin_token.txt");
  const extSharedTokenFile = path.join(tmpDir, "ext_shared.txt");
  const pacSecretFile = path.join(tmpDir, "pac_secret.txt");

  fs.writeFileSync(adminTokenFile, "  super-secret-admin-token-from-file \n");
  fs.writeFileSync(extSharedTokenFile, "shared-token-from-file\r\n");
  fs.writeFileSync(pacSecretFile, "pac-secret-from-file\n");

  const mockEnv: NodeJS.ProcessEnv = {
    ADMIN_TOKEN_FILE: adminTokenFile,
    EXT_SHARED_TOKEN_FILE: extSharedTokenFile,
    PAC_SIGNING_SECRET_FILE: pacSecretFile,
  };

  loadDockerSecrets(mockEnv);

  assert.strictEqual(mockEnv.ADMIN_TOKEN, "super-secret-admin-token-from-file");
  assert.strictEqual(mockEnv.EXT_SHARED_TOKEN, "shared-token-from-file");
  assert.strictEqual(mockEnv.PAC_SIGNING_SECRET, "pac-secret-from-file");

  // Non-existent file does not crash and leaves variable undefined
  const badEnv: NodeJS.ProcessEnv = {
    CODE_SIGN_MASTER_KEY_FILE: path.join(tmpDir, "non_existent_file.txt"),
  };
  loadDockerSecrets(badEnv);
  assert.strictEqual(badEnv.CODE_SIGN_MASTER_KEY, undefined);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("D15: EnrollmentTracker cleans up expired entries and enforces rate limits", async () => {
  const tracker = new EnrollmentTracker(50, 2); // 50ms window, 2 requests max
  assert.strictEqual(tracker.check("1.2.3.4"), true, "First request within window should pass");
  assert.strictEqual(tracker.check("1.2.3.4"), true, "Second request within window should pass");
  assert.strictEqual(tracker.check("1.2.3.4"), false, "Third request within window should be rate-limited");

  // Other IP should not be affected
  assert.strictEqual(tracker.check("5.6.7.8"), true, "Different IP should pass");

  // Wait for window to expire
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.strictEqual(tracker.check("1.2.3.4"), true, "Request after resetTime should reset and pass");
});


