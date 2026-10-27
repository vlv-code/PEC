import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import child_process from "node:child_process";
import {
  getEncryptionKey,
  saveCertificate,
  getCertificateStatus,
  deleteCertificate,
  signBinary,
  extractCertificateMetadata,
  getCertsDir,
  decryptPassword,
  StoredCertificateConfig,
} from "../src/codeSigner.js";

const TEST_CERTS_DIR = path.resolve("./data/test_certs_security");

function setupTestDir() {
  process.env.CODE_SIGN_DIR = TEST_CERTS_DIR;
  if (!fs.existsSync(TEST_CERTS_DIR)) {
    fs.mkdirSync(TEST_CERTS_DIR, { recursive: true, mode: 0o700 });
  }
}

function cleanTestDir() {
  delete process.env.CODE_SIGN_DIR;
  delete process.env.CODE_SIGN_MASTER_KEY;
  if (fs.existsSync(TEST_CERTS_DIR)) {
    try {
      fs.rmSync(TEST_CERTS_DIR, { recursive: true, force: true });
    } catch {}
  }
}

test("M-6: Uses CODE_SIGN_MASTER_KEY environment variable when provided", (t) => {
  setupTestDir();
  t.after(cleanTestDir);

  const customKey = "my-super-secret-master-signing-key-1234567890";
  process.env.CODE_SIGN_MASTER_KEY = customKey;

  const key = getEncryptionKey();
  const expected = crypto.createHash("sha256").update(customKey).digest();
  assert.deepEqual(key, expected, "Must derive key from CODE_SIGN_MASTER_KEY env variable");

  // Key file should not be created if env var is used
  const keyFile = path.join(TEST_CERTS_DIR, ".code_sign_master_key");
  assert.equal(fs.existsSync(keyFile), false, "Key file should not be created when CODE_SIGN_MASTER_KEY is provided");
});

test("M-6: Generates and stores 32-byte secret in .code_sign_master_key with mode 0o600 when unset", (t) => {
  setupTestDir();
  t.after(cleanTestDir);

  delete process.env.CODE_SIGN_MASTER_KEY;
  const keyFile = path.join(TEST_CERTS_DIR, ".code_sign_master_key");
  if (fs.existsSync(keyFile)) fs.unlinkSync(keyFile);

  const generatedKey = getEncryptionKey();
  assert.equal(generatedKey.length, 32, "Generated master key must be exactly 32 bytes");

  assert.ok(fs.existsSync(keyFile), ".code_sign_master_key file must be created");
  const stat = fs.statSync(keyFile);
  // On POSIX check 0o600; on Windows mode check readability
  if (process.platform !== "win32") {
    assert.equal(stat.mode & 0o777, 0o600, "Key file must have mode 0o600");
  }

  // Second invocation must return the persisted key
  const reloadedKey = getEncryptionKey();
  assert.deepEqual(reloadedKey, generatedKey, "Must reload persisted key on subsequent invocations");
});

test("M-6: Fail-closed if master key is unavailable (no hardcoded fallback seed)", (t) => {
  setupTestDir();
  t.after(cleanTestDir);

  delete process.env.CODE_SIGN_MASTER_KEY;
  // Point to an invalid directory that cannot be written to
  const invalidDir = path.join(TEST_CERTS_DIR, "nonexistent", "nested", "readonly");
  process.env.CODE_SIGN_DIR = invalidDir;

  // Mock writeFileSync to simulate file system failure
  const originalWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = () => {
    throw new Error("Disk full or permission denied");
  };

  try {
    assert.throws(
      () => {
        getEncryptionKey();
      },
      (err: any) => {
        assert.ok(err instanceof Error);
        // Ensure no fallback to hardcoded string
        return true;
      },
      "Must throw and fail-closed when key cannot be loaded or generated"
    );
  } finally {
    fs.writeFileSync = originalWriteFileSync;
  }
});

test("M-8: Temporary PFX files in extractCertificateMetadata use random suffix and mode 0o600", (t) => {
  setupTestDir();
  t.after(cleanTestDir);

  const originalExecFileSync = child_process.execFileSync;
  const originalWriteFileSync = fs.writeFileSync;
  const createdPfxFiles: Array<{ path: string; mode?: any }> = [];

  fs.writeFileSync = ((filePath: fs.PathOrFileDescriptor, data: any, options?: any) => {
    if (typeof filePath === "string" && filePath.endsWith(".pfx") && path.basename(filePath).startsWith("tmp_")) {
      const mode = typeof options === "object" ? options.mode : undefined;
      createdPfxFiles.push({ path: filePath, mode });
    }
    return originalWriteFileSync(filePath, data, options);
  }) as any;

  child_process.execFileSync = ((file: string, args?: readonly string[], options?: any) => {
    if (file === "openssl" || file === "certutil") {
      return Buffer.from("");
    }
    return Buffer.from("");
  }) as any;

  t.after(() => {
    child_process.execFileSync = originalExecFileSync;
    fs.writeFileSync = originalWriteFileSync;
  });

  const dummyPfx = crypto.randomBytes(64);
  extractCertificateMetadata(dummyPfx, "SecretTestPass!");

  assert.ok(createdPfxFiles.length > 0, "At least one temporary PFX file must be written for CLI extraction");

  for (const { path: pfxPath, mode } of createdPfxFiles) {
    const filename = path.basename(pfxPath);
    // Filename must match tmp_<timestamp>_<random16hex>.pfx
    assert.match(
      filename,
      /^tmp_\d+_[a-f0-9]{16}\.pfx$/,
      `Temp PFX filename must contain random hex suffix (M-8): ${filename}`
    );
    assert.equal(mode, 0o600, `Temp PFX file must be created with mode 0o600 (M-8): ${filename}`);
  }
});

test("M-7: Passwords are NOT passed via CLI argv for osslsigncode, signtool, or certutil", (t) => {
  setupTestDir();
  t.after(cleanTestDir);

  const originalExecFileSync = child_process.execFileSync;
  const recordedCalls: Array<{ file: string; args?: readonly string[]; options?: any }> = [];

  child_process.execFileSync = ((file: string, args?: readonly string[], options?: any) => {
    recordedCalls.push({ file, args, options });
    if (args && args.includes("--version")) {
      return Buffer.from("osslsigncode 2.5");
    }
    if (file === "osslsigncode" && args && args[0] === "sign") {
      const outIdx = args.indexOf("-out");
      if (outIdx !== -1 && args[outIdx + 1]) {
        fs.writeFileSync(args[outIdx + 1], "dummy signed data");
      }
      return Buffer.from("signed");
    }
    if (file === "signtool.exe") {
      return Buffer.from("signed");
    }
    return Buffer.from("");
  }) as any;

  t.after(() => {
    child_process.execFileSync = originalExecFileSync;
    deleteCertificate();
  });

  const targetFile = path.join(TEST_CERTS_DIR, "app_to_sign.exe");
  fs.writeFileSync(targetFile, "executable content");

  const secretPassword = "VerySecretPassword123!#%";
  const dummyPfx = crypto.randomBytes(128);

  // Save certificate with password
  saveCertificate(dummyPfx, secretPassword, "commercial", "http://timestamp.digicert.com");

  // Perform signBinary
  const signed = signBinary(targetFile);
  assert.equal(signed, true, "signBinary should succeed with mocked osslsigncode");

  // Check all invocations during extraction and signing
  for (const call of recordedCalls) {
    if (!call.args) continue;

    // 1. Password must NOT be passed as process argv directly
    for (const arg of call.args) {
      assert.notEqual(
        arg,
        secretPassword,
        `Password was leaked directly into process argv of ${call.file}! Must pass via env or temp file (M-7)`
      );
    }

    // 2. No `-pass <secretPassword>` or `/p <secretPassword>`
    const passIdx = call.args.indexOf("-pass");
    if (passIdx !== -1) {
      assert.notEqual(
        call.args[passIdx + 1],
        secretPassword,
        `Cleartext password found after -pass in ${call.file}`
      );
    }

    const pIdx = call.args.indexOf("/p");
    if (pIdx !== -1) {
      assert.notEqual(
        call.args[pIdx + 1],
        secretPassword,
        `Cleartext password found after /p in ${call.file}`
      );
    }

    // 3. If osslsigncode sign was called, check password passed via -readpass or env PFX_PASS
    if (call.file === "osslsigncode" && call.args[0] === "sign") {
      const hasReadpass = call.args.includes("-readpass");
      const hasEnvPass = call.options?.env?.PFX_PASS === secretPassword;
      assert.ok(
        hasReadpass || hasEnvPass,
        "osslsigncode must receive password via -readpass <file> or env.PFX_PASS (M-7)"
      );

      if (hasReadpass) {
        const readpassIdx = call.args.indexOf("-readpass");
        const passFilePath = call.args[readpassIdx + 1];
        assert.ok(passFilePath, "-readpass must have a file argument");
        // Verify temp pass file has random suffix
        assert.match(path.basename(passFilePath), /^tmp_pass_\d+_[a-f0-9]{16}\.txt$/);
      }
    }
  }
});

test("N-1 (replaces M-7 for signtool): signtool.exe receives password via /p <password> in argv and not /pfile (AR-6)", (t) => {
  setupTestDir();
  t.after(cleanTestDir);

  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "win32" });

  const originalExecFileSync = child_process.execFileSync;
  const recordedCalls: Array<{ file: string; args?: readonly string[]; options?: any }> = [];

  child_process.execFileSync = ((file: string, args?: readonly string[], options?: any) => {
    recordedCalls.push({ file, args, options });
    if (file === "osslsigncode") {
      throw new Error("osslsigncode not installed");
    }
    if (file === "signtool.exe" && args && args[0] === "/?") {
      return Buffer.from("signtool help");
    }
    if (file === "signtool.exe" && args && args[0] === "sign") {
      return Buffer.from("successfully signed with signtool");
    }
    return Buffer.from("");
  }) as any;

  t.after(() => {
    if (originalPlatform) {
      Object.defineProperty(process, "platform", originalPlatform);
    }
    child_process.execFileSync = originalExecFileSync;
    deleteCertificate();
  });

  const targetFile = path.join(TEST_CERTS_DIR, "signtool_target.exe");
  fs.writeFileSync(targetFile, "executable content for signtool");

  const secretPassword = "WinSigntoolSecretPassword456!#";
  const dummyPfx = crypto.randomBytes(128);

  saveCertificate(dummyPfx, secretPassword, "commercial", "http://timestamp.digicert.com");

  const signed = signBinary(targetFile);
  assert.equal(signed, true, "signBinary should succeed when signtool.exe mock succeeds");

  const signtoolSignCall = recordedCalls.find((c) => c.file === "signtool.exe" && c.args?.[0] === "sign");
  assert.ok(signtoolSignCall, "signtool.exe sign must be called");
  assert.ok(Array.isArray(signtoolSignCall.args));

  // Must NOT have /pfile (signtool does not support /pfile)
  const pfileIdx = signtoolSignCall.args.indexOf("/pfile");
  assert.equal(pfileIdx, -1, "Must not use invalid /pfile argument on signtool");

  // Must have /p <password> (N-1 / AR-6)
  const pIdx = signtoolSignCall.args.indexOf("/p");
  assert.notEqual(pIdx, -1, "Must use /p argument for signtool.exe");
  assert.equal(signtoolSignCall.args[pIdx + 1], secretPassword, "Password must follow /p for signtool.exe");

  // Password in env PFX_PASS is also passed
  assert.equal(signtoolSignCall.options?.env?.PFX_PASS, secretPassword);
});

test("M-8: Leftover .signed temporary file is cleaned up if osslsigncode fails during signing", (t) => {
  setupTestDir();
  t.after(cleanTestDir);

  const originalExecFileSync = child_process.execFileSync;
  let createdSignedTmp = "";

  child_process.execFileSync = ((file: string, args?: readonly string[], options?: any) => {
    if (args && args.includes("--version")) {
      return Buffer.from("osslsigncode 2.5");
    }
    if (file === "osslsigncode" && args && args[0] === "sign") {
      const outIdx = args.indexOf("-out");
      if (outIdx !== -1 && args[outIdx + 1]) {
        createdSignedTmp = args[outIdx + 1];
        fs.writeFileSync(createdSignedTmp, "partial broken signed file");
      }
      throw new Error("Simulated osslsigncode process failure / crash");
    }
    return Buffer.from("");
  }) as any;

  t.after(() => {
    child_process.execFileSync = originalExecFileSync;
    deleteCertificate();
  });

  const targetFile = path.join(TEST_CERTS_DIR, "app_crash_test.exe");
  fs.writeFileSync(targetFile, "executable content");

  const dummyPfx = crypto.randomBytes(128);
  saveCertificate(dummyPfx, "dummyPassword", "commercial", "http://timestamp.digicert.com");

  const signed = signBinary(targetFile);
  assert.equal(signed, false, "signBinary must return false when osslsigncode fails");
  assert.ok(createdSignedTmp.length > 0, "A temporary .signed file should have been created");
  assert.equal(
    fs.existsSync(createdSignedTmp),
    false,
    "Temporary .signed file must be cleaned up in finally block upon failure"
  );
});

test("M-6: Fails closed when existing master key file is empty (0 bytes / corrupted)", (t) => {
  setupTestDir();
  t.after(cleanTestDir);

  delete process.env.CODE_SIGN_MASTER_KEY;
  const keyFile = path.join(TEST_CERTS_DIR, ".code_sign_master_key");
  fs.writeFileSync(keyFile, Buffer.alloc(0), { mode: 0o600 });

  assert.throws(
    () => {
      getEncryptionKey();
    },
    (err: any) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /empty/i);
      return true;
    },
    "Must throw fail-closed error when .code_sign_master_key is 0 bytes"
  );
});

test("M-7: signBinary respects PFX_PASS environment variable directly", (t) => {
  setupTestDir();
  t.after(cleanTestDir);

  const originalExecFileSync = child_process.execFileSync;
  const recordedCalls: Array<{ file: string; args?: readonly string[]; options?: any }> = [];

  child_process.execFileSync = ((file: string, args?: readonly string[], options?: any) => {
    recordedCalls.push({ file, args, options });
    if (args && args.includes("--version")) {
      return Buffer.from("osslsigncode 2.5");
    }
    if (file === "osslsigncode" && args && args[0] === "sign") {
      const outIdx = args.indexOf("-out");
      if (outIdx !== -1 && args[outIdx + 1]) {
        fs.writeFileSync(args[outIdx + 1], "signed content");
      }
      return Buffer.from("signed");
    }
    return Buffer.from("");
  }) as any;

  t.after(() => {
    child_process.execFileSync = originalExecFileSync;
    delete process.env.CODE_SIGN_PFX_PATH;
    delete process.env.PFX_PASS;
  });

  const dummyPfxFile = path.join(TEST_CERTS_DIR, "env_cert.pfx");
  fs.writeFileSync(dummyPfxFile, "dummy pfx buffer", { mode: 0o600 });
  process.env.CODE_SIGN_PFX_PATH = dummyPfxFile;
  process.env.PFX_PASS = "SecretFromPfxPassEnv123";

  const target = path.join(TEST_CERTS_DIR, "target.exe");
  fs.writeFileSync(target, "binary data");

  const signed = signBinary(target);
  assert.equal(signed, true);

  const signCall = recordedCalls.find((c) => c.file === "osslsigncode" && c.args?.[0] === "sign");
  assert.ok(signCall);
  assert.equal(signCall.options?.env?.PFX_PASS, "SecretFromPfxPassEnv123");
});

test("N-2: decryptPassword falls back to legacy master key when primary decryption fails", (t) => {
  setupTestDir();
  t.after(cleanTestDir);

  // Set up a primary master key in .code_sign_master_key that differs from legacy key
  const certsDir = getCertsDir();
  fs.mkdirSync(certsDir, { recursive: true });
  const modernKey = crypto.randomBytes(32);
  fs.writeFileSync(path.join(certsDir, ".code_sign_master_key"), modernKey, { mode: 0o600 });

  // Encrypt password using legacy master key
  const legacySeed = process.env.ADMIN_TOKEN || "pec-default-code-sign-master-key-seed";
  const legacyKey = crypto.createHash("sha256").update(legacySeed).digest();
  const testPassword = "MyLegacySecretPassword2026!";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", legacyKey, iv);
  let encrypted = cipher.update(testPassword, "utf8", "base64");
  encrypted += cipher.final("base64");
  const tag = cipher.getAuthTag().toString("base64");

  const legacyConfig: StoredCertificateConfig = {
    hasCertificate: true,
    type: "commercial",
    encryptedPassword: encrypted,
    iv: iv.toString("base64"),
    tag,
  };

  const decrypted = decryptPassword(legacyConfig);
  assert.equal(decrypted, testPassword, "Legacy encrypted password must be successfully decrypted via fallback");
});
