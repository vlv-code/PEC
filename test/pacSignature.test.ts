import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { signPacUrlParams, verifyPacUrlParams } from "../src/pacSigner.js";
import { createCredsRouter } from "../src/routes/credsRoutes.js";

test("A2: signPacUrlParams and verifyPacUrlParams cryptographic flow", () => {
  const secret = "test-super-secret-key-123";
  const profileId = "profile_default_split";

  // 1. Valid signature
  const { exp, sig } = signPacUrlParams(profileId, secret, 3600);
  const result = verifyPacUrlParams(profileId, String(exp), sig, secret);
  assert.equal(result.valid, true);

  // 2. Expired signature
  const expired = signPacUrlParams(profileId, secret, -10);
  const expResult = verifyPacUrlParams(profileId, String(expired.exp), expired.sig, secret);
  assert.equal(expResult.valid, false);
  assert.equal(expResult.reason, "EXPIRED");

  // 3. Tampered signature
  const tamperedSig = sig.slice(0, -2) + (sig.endsWith("a") ? "b" : "a");
  const tamperedResult = verifyPacUrlParams(profileId, String(exp), tamperedSig, secret);
  assert.equal(tamperedResult.valid, false);
  assert.equal(tamperedResult.reason, "INVALID_SIGNATURE");

  // 4. Missing parameters
  const missingResult = verifyPacUrlParams(profileId, "", "", secret);
  assert.equal(missingResult.valid, false);
  assert.equal(missingResult.reason, "MISSING_SIGNATURE_OR_EXPIRY");
});

test("A2: GET /proxy.pac enforcement with PAC_REQUIRE_SIGNATURE", async () => {
  const sharedToken = "test-fleet-token-123";
  const app = express();
  app.use(createCredsRouter(() => sharedToken));

  const server = app.listen(0);
  const port = (server.address() as any).port;

  const request = (path: string): Promise<{ status: number; text: string }> => {
    return new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}${path}`, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode || 0, text: data }));
        res.on("error", reject);
      });
    });
  };

  const origReqSig = process.env.PAC_REQUIRE_SIGNATURE;

  try {
    // 1. Without PAC_REQUIRE_SIGNATURE: open access for legacy compatibility
    delete process.env.PAC_REQUIRE_SIGNATURE;
    const resOpen = await request("/proxy.pac");
    assert.equal(resOpen.status, 200, "Unsigned request must succeed when PAC_REQUIRE_SIGNATURE is off");
    assert.ok(resOpen.text.includes("FindProxyForURL"));

    // 2. With PAC_REQUIRE_SIGNATURE=1: unsigned request must be rejected (403)
    process.env.PAC_REQUIRE_SIGNATURE = "1";
    const resForbidden = await request("/proxy.pac");
    assert.equal(resForbidden.status, 403, "Unsigned request must be 403 when signature required");

    // 3. With PAC_REQUIRE_SIGNATURE=1 and valid signature: 200
    const profileId = "profile_default_split";
    const { exp, sig } = signPacUrlParams(profileId, sharedToken, 3600);
    const resSigned = await request(`/proxy.pac?profileId=${profileId}&exp=${exp}&sig=${sig}`);
    assert.equal(resSigned.status, 200, "Valid signed request must succeed with 200");
    assert.ok(resSigned.text.includes("FindProxyForURL"));

    // 4. With PAC_REQUIRE_SIGNATURE=1 and invalid signature: 403
    const resBadSig = await request(`/proxy.pac?profileId=${profileId}&exp=${exp}&sig=invalid_sig`);
    assert.equal(resBadSig.status, 403, "Invalid signature must be 403");
  } finally {
    if (origReqSig !== undefined) process.env.PAC_REQUIRE_SIGNATURE = origReqSig;
    else delete process.env.PAC_REQUIRE_SIGNATURE;
    server.close();
  }
});
