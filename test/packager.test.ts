import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getBuildInfo, saveBuildConfig } from "../src/packager.js";
import { DEFAULT_APP_VERSION } from "../src/appPackager.js";
import { TEST_TMP_DIR } from "./helpers/setup.js";

test("packager: getBuildInfo correctly computes hasPrivateKey from PEM env var", () => {
  const origPem = process.env.PEC_PRIVATE_KEY_PEM;
  const origPath = process.env.PEC_PRIVATE_KEY_PATH;
  try {
    const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

    process.env.PEC_PRIVATE_KEY_PEM = pem;
    delete process.env.PEC_PRIVATE_KEY_PATH;

    const info = getBuildInfo();
    assert.strictEqual(info.hasPrivateKey, true, "hasPrivateKey must be true when PEC_PRIVATE_KEY_PEM is provided");
  } finally {
    process.env.PEC_PRIVATE_KEY_PEM = origPem;
    process.env.PEC_PRIVATE_KEY_PATH = origPath;
  }
});

test("packager: getBuildInfo correctly computes hasPrivateKey from PATH env var", () => {
  const origPem = process.env.PEC_PRIVATE_KEY_PEM;
  const origPath = process.env.PEC_PRIVATE_KEY_PATH;
  try {
    delete process.env.PEC_PRIVATE_KEY_PEM;
    const tempKeyFile = path.join(TEST_TMP_DIR, "test-custom-key.pem");
    const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    fs.writeFileSync(tempKeyFile, privateKey.export({ type: "pkcs1", format: "pem" }));

    process.env.PEC_PRIVATE_KEY_PATH = tempKeyFile;

    const info = getBuildInfo();
    assert.strictEqual(info.hasPrivateKey, true, "hasPrivateKey must be true when PEC_PRIVATE_KEY_PATH points to an existing file");
  } finally {
    process.env.PEC_PRIVATE_KEY_PEM = origPem;
    process.env.PEC_PRIVATE_KEY_PATH = origPath;
  }
});

test("packager: version falls back to currentBuildConfig or DEFAULT_APP_VERSION, not hardcoded 1.2.0", () => {
  const info = getBuildInfo();
  assert.notStrictEqual(info.version, "1.2.0", "version should not be hardcoded to 1.2.0");
  assert.ok(info.version.length > 0);
});
