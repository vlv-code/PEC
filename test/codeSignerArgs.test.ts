import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import child_process from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  extractCertificateMetadata,
  signBinary,
  saveCertificate,
  deleteCertificate,
} from "../src/codeSigner.js";

test("codeSigner: extractCertificateMetadata uses execFileSync with safe env and array args", (t) => {
  const originalExecFileSync = child_process.execFileSync;
  const calls: Array<{ file: string; args?: readonly string[]; options?: any }> = [];

  child_process.execFileSync = ((file: string, args?: readonly string[], options?: any) => {
    calls.push({ file, args, options });
    if (file === "openssl") {
      // simulate openssl failure or success
      return Buffer.from("fake openssl output");
    }
    return Buffer.from("");
  }) as any;

  t.after(() => {
    child_process.execFileSync = originalExecFileSync;
  });

  const dummyPfx = crypto.randomBytes(64);
  const maliciousPassword = 'malicious"$(whoami)&calc.exe|dir;test\'';

  // Call extractCertificateMetadata
  extractCertificateMetadata(dummyPfx, maliciousPassword);

  const opensslCall = calls.find((c) => c.file === "openssl");
  if (opensslCall) {
    assert.ok(Array.isArray(opensslCall.args), "openssl must be called with array args");
    assert.ok(opensslCall.args.includes("-passin"), "must use -passin arg");
    assert.ok(opensslCall.args.includes("env:PFX_PASS"), "must use env:PFX_PASS for password");
    assert.equal(
      opensslCall.options?.env?.PFX_PASS,
      maliciousPassword,
      "raw password must be passed in env.PFX_PASS without shell interpolation"
    );
  }
});

test("codeSigner: signBinary invokes tools via execFileSync with discrete array arguments", (t) => {
  const originalExecFileSync = child_process.execFileSync;
  const calls: Array<{ file: string; args?: readonly string[]; options?: any }> = [];

  child_process.execFileSync = ((file: string, args?: readonly string[], options?: any) => {
    calls.push({ file, args, options });
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
    return Buffer.from("");
  }) as any;

  t.after(() => {
    child_process.execFileSync = originalExecFileSync;
    deleteCertificate();
  });

  const tmpDir = path.resolve("./data/certs");
  fs.mkdirSync(tmpDir, { recursive: true });
  const dummyTarget = path.join(tmpDir, `test_target_${Date.now()}.exe`);
  fs.writeFileSync(dummyTarget, "dummy executable data");

  try {
    const maliciousPassword = 'pass"&calc.exe|dir;$(id)';
    const dummyPfx = crypto.randomBytes(128);
    saveCertificate(dummyPfx, maliciousPassword, "commercial", "http://timestamp.digicert.com");

    const signed = signBinary(dummyTarget);
    assert.equal(signed, true, "signBinary should succeed when osslsigncode mock succeeds");

    const signCall = calls.find((c) => c.file === "osslsigncode" && c.args?.[0] === "sign");
    assert.ok(signCall, "osslsigncode sign must be called");
    assert.ok(Array.isArray(signCall.args), "args must be an array");

    // Check that maliciousPassword is NOT passed as a CLI argument (M-7 security hardening)
    assert.ok(!signCall.args.includes(maliciousPassword), "raw password must NOT be passed in CLI arguments");
    assert.equal(signCall.args.indexOf("-pass"), -1, "-pass flag must not be used to avoid process table leakage");
    assert.ok(signCall.args.includes("-readpass"), "-readpass flag must be used with temporary file");
    assert.equal(
      signCall.options?.env?.PFX_PASS,
      maliciousPassword,
      "password must be safely passed via environment or secure temporary file"
    );
  } finally {
    if (fs.existsSync(dummyTarget)) fs.unlinkSync(dummyTarget);
    deleteCertificate();
  }
});
