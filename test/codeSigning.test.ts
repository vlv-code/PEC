import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import express, { Request, Response, NextFunction } from "express";
import {
  getCertificateStatus,
  saveCertificate,
  deleteCertificate,
  signBinary,
  extractCertificateMetadata,
} from "../src/codeSigner.js";
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

test("codeSigner: lifecycle (save, status, delete, sign guard)", () => {
  // 1. Initial state
  deleteCertificate();
  const initStatus = getCertificateStatus();
  assert.equal(initStatus.hasCertificate, false);

  // 2. Save certificate
  const fakePfx = crypto.randomBytes(512);
  const saved = saveCertificate(fakePfx, "SecretPass123!", "commercial", "http://timestamp.digicert.com");
  assert.equal(saved.hasCertificate, true);
  assert.equal(saved.type, "commercial");
  assert.equal(saved.timestampUrl, "http://timestamp.digicert.com");
  assert.ok(saved.subject);
  assert.ok(saved.thumbprint);

  // 3. Status matches persisted
  const activeStatus = getCertificateStatus();
  assert.equal(activeStatus.hasCertificate, true);
  assert.equal(activeStatus.type, "commercial");
  assert.equal(activeStatus.subject, saved.subject);

  // 4. Test signBinary on non-existent file
  const nonExistent = path.resolve("./data/certs/non_existent.exe");
  assert.equal(signBinary(nonExistent), false);

  // 5. Delete certificate
  const deleted = deleteCertificate();
  assert.equal(deleted, true);
  const finalStatus = getCertificateStatus();
  assert.equal(finalStatus.hasCertificate, false);
});

test("codeSigner: internal AD CS type preserves offline timestamp configuration", () => {
  deleteCertificate();
  const fakePfx = crypto.randomBytes(256);
  const saved = saveCertificate(fakePfx, "", "internal", "");
  assert.equal(saved.hasCertificate, true);
  assert.equal(saved.type, "internal");
  assert.equal(saved.timestampUrl, "");

  const status = getCertificateStatus();
  assert.equal(status.type, "internal");
  assert.equal(status.timestampUrl, "");
  deleteCertificate();
});

test("codeSigner: metadata extraction fallback generates valid thumbprint", () => {
  const buf = crypto.randomBytes(128);
  const meta = extractCertificateMetadata(buf, "");
  assert.ok(meta.subject);
  assert.ok(meta.issuer);
  assert.ok(meta.validFrom);
  assert.ok(meta.validTo);
  assert.ok(meta.thumbprint);
});

test("codeSigner API: GET, POST, DELETE endpoints via appBuilderRouter", async () => {
  await withTestServer(async (baseUrl) => {
    deleteCertificate();

    // 1. GET initial certificate status
    const getRes1 = await fetch(`${baseUrl}/api/app-builder/certificate`, {
      headers: { "x-admin-token": TEST_ADMIN_TOKEN },
    });
    assert.equal(getRes1.status, 200);
    const body1 = await getRes1.json();
    assert.equal(body1.ok, true);
    assert.equal(body1.certificate.hasCertificate, false);

    // 2. POST upload certificate
    const dummyPfxBase64 = crypto.randomBytes(300).toString("base64");
    const postRes = await fetch(`${baseUrl}/api/app-builder/certificate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": TEST_ADMIN_TOKEN,
      },
      body: JSON.stringify({
        pfxBase64: dummyPfxBase64,
        password: "TestCertPassword!123",
        type: "internal",
      }),
    });
    assert.equal(postRes.status, 200);
    const postBody = await postRes.json();
    assert.equal(postBody.ok, true);
    assert.equal(postBody.certificate.hasCertificate, true);
    assert.equal(postBody.certificate.type, "internal");

    // 3. GET active certificate
    const getRes2 = await fetch(`${baseUrl}/api/app-builder/certificate`, {
      headers: { "x-admin-token": TEST_ADMIN_TOKEN },
    });
    assert.equal(getRes2.status, 200);
    const body2 = await getRes2.json();
    assert.equal(body2.certificate.hasCertificate, true);
    assert.equal(body2.certificate.type, "internal");

    // 4. DELETE certificate
    const delRes = await fetch(`${baseUrl}/api/app-builder/certificate`, {
      method: "DELETE",
      headers: { "x-admin-token": TEST_ADMIN_TOKEN },
    });
    assert.equal(delRes.status, 200);
    const delBody = await delRes.json();
    assert.equal(delBody.ok, true);
    assert.equal(delBody.certificate.hasCertificate, false);
  });
});
