import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { ensureKeyExists, getPublicKeySpkiDer, calculateExtensionId } from "../src/packager.js";

test("A4: ensureKeyExists respects PEC_PRIVATE_KEY_PEM and produces stable extension ID", () => {
  const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const expectedKeyObj = crypto.createPrivateKey(privateKey);
  const expectedId = calculateExtensionId(getPublicKeySpkiDer(expectedKeyObj));

  const origPem = process.env.PEC_PRIVATE_KEY_PEM;
  const origPath = process.env.PEC_PRIVATE_KEY_PATH;

  try {
    process.env.PEC_PRIVATE_KEY_PEM = privateKey;
    delete process.env.PEC_PRIVATE_KEY_PATH;

    const key = ensureKeyExists();
    const id = calculateExtensionId(getPublicKeySpkiDer(key));
    assert.equal(id, expectedId, "Extension ID derived from PEC_PRIVATE_KEY_PEM must match generated key ID");
  } finally {
    if (origPem !== undefined) process.env.PEC_PRIVATE_KEY_PEM = origPem;
    else delete process.env.PEC_PRIVATE_KEY_PEM;
    if (origPath !== undefined) process.env.PEC_PRIVATE_KEY_PATH = origPath;
    else delete process.env.PEC_PRIVATE_KEY_PATH;
  }
});

test("A4: ensureKeyExists respects PEC_PRIVATE_KEY_PATH and matches PEM output", () => {
  const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pec-key-test-"));
  const keyFile = path.join(tempDir, "custom_key.pem");
  fs.writeFileSync(keyFile, privateKey, "utf-8");

  const origPem = process.env.PEC_PRIVATE_KEY_PEM;
  const origPath = process.env.PEC_PRIVATE_KEY_PATH;

  try {
    delete process.env.PEC_PRIVATE_KEY_PEM;
    process.env.PEC_PRIVATE_KEY_PATH = keyFile;

    const key = ensureKeyExists();
    const idFromPath = calculateExtensionId(getPublicKeySpkiDer(key));

    process.env.PEC_PRIVATE_KEY_PEM = privateKey;
    const keyFromPem = ensureKeyExists();
    const idFromPem = calculateExtensionId(getPublicKeySpkiDer(keyFromPem));

    assert.equal(idFromPath, idFromPem, "PEM string and PEM file must yield identical extension IDs");
  } finally {
    if (origPem !== undefined) process.env.PEC_PRIVATE_KEY_PEM = origPem;
    else delete process.env.PEC_PRIVATE_KEY_PEM;
    if (origPath !== undefined) process.env.PEC_PRIVATE_KEY_PATH = origPath;
    else delete process.env.PEC_PRIVATE_KEY_PATH;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
});
