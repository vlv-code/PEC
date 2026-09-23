import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import AdmZip from "adm-zip";
import { TEST_TMP_DIR, TEST_TOKEN, TEST_ADMIN_TOKEN } from "./helpers/setup.js";
import { ensureKeyExists, packageExtension, packCrxBuffer, saveBuildConfig, generateGpoConfig } from "../src/packager.js";
import { renderBackgroundJs } from "../src/extensionTemplates.js";

// --- minimal protobuf reader (wire type 2 only) ---
function* readFields(buf: Buffer): Generator<{ fieldNo: number; bytes: Buffer }> {
  let i = 0;
  while (i < buf.length) {
    let tag = 0;
    let shift = 0;
    let b: number;
    do {
      b = buf[i++];
      tag |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    const fieldNo = tag >>> 3;
    const wire = tag & 7;
    assert.strictEqual(wire, 2, "unexpected wire type");
    let len = 0;
    shift = 0;
    do {
      b = buf[i++];
      len |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    yield { fieldNo, bytes: buf.subarray(i, i + len) };
    i += len;
  }
}

test("CRX3: package is a valid CRX version 3 with verifiable RSA-SHA256 proof", () => {
  saveBuildConfig({ version: "9.9.9" });
  packageExtension("http://localhost:3000");

  const crxPath = path.join(TEST_TMP_DIR, "updates", "extension.crx");
  assert.strictEqual(fs.existsSync(crxPath), true);
  const crx = fs.readFileSync(crxPath);

  // Header layout
  assert.strictEqual(crx.subarray(0, 4).toString("latin1"), "Cr24");
  assert.strictEqual(crx.readUInt32LE(4), 3, "CRX format version must be 3 (Chrome rejects v2)");
  const headerLen = crx.readUInt32LE(8);
  const header = crx.subarray(12, 12 + headerLen);
  const archive = crx.subarray(12 + headerLen);
  assert.strictEqual(archive.subarray(0, 2).toString("latin1"), "PK", "zip payload must follow the header");

  // Parse CrxFileHeader
  let proof: Buffer | null = null;
  let signedData: Buffer | null = null;
  for (const f of readFields(header)) {
    if (f.fieldNo === 2) proof = f.bytes; // sha256_with_rsa
    if (f.fieldNo === 10000) signedData = f.bytes; // signed_header_data
  }
  assert.ok(proof, "AsymmetricKeyProof missing");
  assert.ok(signedData, "SignedData missing");

  let pubKey: Buffer | null = null;
  let signature: Buffer | null = null;
  for (const f of readFields(proof!)) {
    if (f.fieldNo === 1) pubKey = f.bytes;
    if (f.fieldNo === 2) signature = f.bytes;
  }
  let crxId: Buffer | null = null;
  for (const f of readFields(signedData!)) {
    if (f.fieldNo === 1) crxId = f.bytes;
  }

  assert.ok(pubKey && pubKey.length > 200, "public key (SPKI DER) missing");
  assert.strictEqual(signature!.length, 256, "RSA-2048 signature expected");
  assert.strictEqual(crxId!.length, 16, "crx_id must be 16 bytes");

  // crx_id must equal SHA256(public key)[0..16]
  const expectedId = crypto.createHash("sha256").update(pubKey!).digest().subarray(0, 16);
  assert.ok(crxId!.equals(expectedId), "crx_id mismatch");

  // Signature over "CRX3 SignedData\0" + u32le(len) + signed_data + archive
  const lenLe = Buffer.alloc(4);
  lenLe.writeUInt32LE(signedData!.length, 0);
  const sigInput = Buffer.concat([Buffer.from("CRX3 SignedData\0", "utf8"), lenLe, signedData!, archive]);
  const valid = crypto.verify(
    "RSA-SHA256",
    sigInput,
    crypto.createPublicKey({ key: pubKey!, format: "der", type: "spki" }),
    signature!
  );
  assert.strictEqual(valid, true, "RSA-SHA256 proof must verify");
});

test("CRX3: zip contains the rendered background.js (placeholders substituted) and managed_schema", () => {
  saveBuildConfig({ defaultServerUrl: "https://pec-test.example.corp", defaultToken: "build-token-42", syncIntervalMinutes: 15, bypassAutoTimeoutMinutes: 30 });
  packageExtension("https://pec-test.example.corp");

  const zip = new AdmZip(path.join(TEST_TMP_DIR, "updates", "extension.zip"));
  const bg = zip.readAsText("background.js");
  const schema = zip.readAsText("managed_schema.json");

  assert.match(bg, /const DEFAULT_SERVER_BASE = "https:\/\/pec-test\.example\.corp"/);
  assert.match(bg, /const FALLBACK_TOKEN = "build-token-42"/);
  assert.match(bg, /const SYNC_INTERVAL_MIN = 15;/);
  assert.match(bg, /const BYPASS_TIMEOUT_MIN = 30;/);
  assert.match(bg, /corp_proxy_bypass_expire/); // temporary bypass auto-revert alarm
  assert.doesNotMatch(bg, /__PEC_/); // no raw placeholders may ship
  assert.match(schema, /targetGroup/); // GPO group routing key is declared

  const manifest = JSON.parse(zip.readAsText("manifest.json"));
  assert.strictEqual(manifest.minimum_chrome_version, "108");
  assert.strictEqual(manifest.manifest_version, 3);

  // The source file on disk keeps placeholders for the next rebuild
  const srcBg = fs.readFileSync(path.join(TEST_TMP_DIR, "extension", "background.js"), "utf-8");
  assert.match(srcBg, /__PEC_SERVER_BASE__/);
});

test("CRX3: packCrxBuffer is deterministic for the same key and archive", () => {
  const key = ensureKeyExists();
  const zipBuffer = Buffer.from("PK-fake-archive-content-0000");
  const a = packCrxBuffer(zipBuffer, key);
  const b = packCrxBuffer(zipBuffer, key);
  // RSA PKCS#1 v1.5 is deterministic -> identical output proves stability
  assert.ok(a.equals(b));
  assert.strictEqual(a.readUInt32LE(4), 3);
});

test("artifacts ship the fleet token and never the admin token", () => {
  // background.js rendering with the fleet token baked in (defaultToken comes
  // from the build config, which the server seeds from EXT_SHARED_TOKEN)
  const bg = renderBackgroundJs({ defaultToken: TEST_TOKEN } as never);
  assert.ok(bg.includes(TEST_TOKEN), "rendered background.js must carry the fleet token");
  assert.ok(!bg.includes(TEST_ADMIN_TOKEN), "rendered background.js must never contain the admin token");

  // GPO registry export: extension workstations receive the fleet token only
  const gpo = generateGpoConfig("a".repeat(32), "https://pec.example.corp", TEST_TOKEN);
  const regBlob = `${gpo.regContent}${JSON.stringify(gpo.extensionSettingsJson)}${gpo.forcelistEntry}`;
  assert.ok(regBlob.includes(TEST_TOKEN), "GPO config must carry the fleet token");
  assert.ok(!regBlob.includes(TEST_ADMIN_TOKEN), "GPO config must never contain the admin token");
});
