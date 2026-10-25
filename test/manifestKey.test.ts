import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  createManifestObject,
  ensureKeyExists,
  getPublicKeySpkiDer,
  calculateExtensionId,
  packageExtension,
} from "../src/packager.js";
import { TEST_TMP_DIR } from "./helpers/setup.js";

test("manifestKey: createManifestObject includes public key matching calculateExtensionId", () => {
  const privKey = ensureKeyExists();
  const spkiDer = getPublicKeySpkiDer(privKey);
  const expectedId = calculateExtensionId(spkiDer);
  const expectedBase64Key = spkiDer.toString("base64");

  const manifest = createManifestObject({
    name: "PEC Test",
    shortName: "PEC",
    version: "1.0.0",
  });

  assert.ok(manifest.key, "manifest.json must include a 'key' property");
  assert.strictEqual(typeof manifest.key, "string", "'key' must be a base64 string");
  assert.strictEqual(manifest.key, expectedBase64Key, "'key' in manifest must match the SPKI DER base64 of signing key");

  // Verify that Chrome calculating extension ID from manifest.key yields the identical ID
  const decodedDer = Buffer.from(manifest.key as string, "base64");
  const unpackedId = calculateExtensionId(decodedDer);
  assert.strictEqual(unpackedId, expectedId, "unpacked extension ID derived from manifest.key must equal CRX ID");
});

test("manifestKey: createManifestObject supports passing custom key explicitly", () => {
  const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const customPrivKey = crypto.createPrivateKey(privateKey);
  const customSpkiDer = getPublicKeySpkiDer(customPrivKey);
  const customExpectedId = calculateExtensionId(customSpkiDer);

  const manifest = createManifestObject(
    { name: "Custom Key Test", shortName: "Custom", version: "2.0.0" },
    customPrivKey
  );

  assert.strictEqual(manifest.key, customSpkiDer.toString("base64"));
  const derivedId = calculateExtensionId(Buffer.from(manifest.key as string, "base64"));
  assert.strictEqual(derivedId, customExpectedId);
});

test("manifestKey: packageExtension writes 'key' into unpacked manifest.json", () => {
  const result = packageExtension("http://localhost:3000");
  const unpackedManifestPath = path.join(TEST_TMP_DIR, "unpacked", "manifest.json");

  assert.ok(fs.existsSync(unpackedManifestPath), "unpacked manifest.json must exist");
  const content = JSON.parse(fs.readFileSync(unpackedManifestPath, "utf-8"));
  assert.ok(content.key, "unpacked manifest.json must contain 'key'");

  const derivedId = calculateExtensionId(Buffer.from(content.key, "base64"));
  assert.strictEqual(derivedId, result.extensionId, "unpacked manifest ID must match packaged extensionId");
});
