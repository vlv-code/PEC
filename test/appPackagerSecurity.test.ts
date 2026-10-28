import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import child_process from "node:child_process";
import { buildMsiPackage, buildMsiWithWix, getAppBuildConfig, extractPeVersion, getCoreModulesIntegrity } from "../src/appPackager.js";

test("S-4: buildMsiPackage executes wixl via execFileSync with discrete array arguments", () => {
  const origExecFileSync = child_process.execFileSync;
  const origExecSync = child_process.execSync;

  const calls: Array<{ file: string; args: string[] | readonly string[] | undefined }> = [];
  let execSyncCalls: string[] = [];

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pec-msi-sec-test-"));
  const stagedDir = path.join(tmpDir, "staged with spaces");
  fs.mkdirSync(stagedDir, { recursive: true });
  const outputMsi = path.join(tmpDir, "output with spaces.msi");

  try {
    child_process.execSync = ((cmd: string, ...rest: any[]) => {
      execSyncCalls.push(cmd);
      throw new Error(`execSync should not be called: ${cmd}`);
    }) as any;

    child_process.execFileSync = ((file: string, args?: any, options?: any) => {
      calls.push({ file, args });
      if (file === "wixl") {
        if (Array.isArray(args) && args.includes("--version")) {
          return Buffer.from("wixl 0.104");
        }
        if (Array.isArray(args) && args.includes("-o")) {
          // Simulate producing the output MSI
          fs.writeFileSync(outputMsi, "dummy msi payload");
          return Buffer.from("");
        }
      }
      throw new Error(`Command failed: ${file}`);
    }) as any;

    const cfg = getAppBuildConfig();
    const result = buildMsiPackage(cfg, "https://pec.example.com", stagedDir, outputMsi);

    assert.equal(result.success, true);
    assert.equal(result.msiPath, outputMsi);

    // Verify execSync was NEVER invoked
    assert.equal(execSyncCalls.length, 0, "child_process.execSync must not be called");

    // Verify execFileSync was called with array arguments
    assert.ok(calls.length >= 2, "Expected at least 2 execFileSync calls");
    assert.equal(calls[0].file, "wixl");
    assert.deepEqual(calls[0].args, ["--version"]);

    assert.equal(calls[1].file, "wixl");
    assert.deepEqual(calls[1].args, [
      "-v",
      "-o",
      outputMsi,
      path.join(stagedDir, "pec-app.wxs"),
    ]);

    // Ensure no argument contains outer quotes that would indicate raw shell escaping
    for (const arg of calls[1].args as string[]) {
      assert.ok(!arg.startsWith('"') && !arg.endsWith('"'), `Argument ${arg} should not have shell quotes`);
    }
  } finally {
    child_process.execFileSync = origExecFileSync;
    child_process.execSync = origExecSync;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
});

test("S-4: buildMsiPackage falls back to WiX v3 (candle.exe + light.exe) via execFileSync when wixl is unavailable", () => {
  if (process.platform !== "win32") {
    // WiX Toolset v3 fallback is Windows-specific
    return;
  }

  const origExecFileSync = child_process.execFileSync;
  const origExecSync = child_process.execSync;

  const calls: Array<{ file: string; args: string[] | readonly string[] | undefined }> = [];
  let execSyncCalls: string[] = [];

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pec-msi-wix3-test-"));
  const stagedDir = path.join(tmpDir, "staged dir");
  fs.mkdirSync(stagedDir, { recursive: true });
  const outputMsi = path.join(tmpDir, "output app.msi");

  try {
    child_process.execSync = ((cmd: string) => {
      execSyncCalls.push(cmd);
      throw new Error(`execSync should not be called: ${cmd}`);
    }) as any;

    child_process.execFileSync = ((file: string, args?: any) => {
      calls.push({ file, args });
      if (file === "wixl") {
        throw new Error("wixl not found");
      }
      if (file === "candle.exe" && Array.isArray(args) && args.includes("/?")) {
        return Buffer.from("WiX Compiler version 3.14");
      }
      if (file === "candle.exe" && Array.isArray(args) && args.includes("-out")) {
        return Buffer.from("");
      }
      if (file === "light.exe" && Array.isArray(args) && args.includes("-out")) {
        fs.writeFileSync(outputMsi, "dummy msi payload from light.exe");
        return Buffer.from("");
      }
      throw new Error(`Unknown command: ${file}`);
    }) as any;

    const cfg = getAppBuildConfig();
    const result = buildMsiPackage(cfg, "https://pec.example.com", stagedDir, outputMsi);

    assert.equal(result.success, true);
    assert.equal(result.msiPath, outputMsi);
    assert.equal(execSyncCalls.length, 0, "execSync must not be called");

    // Verify candle and light were called via execFileSync with discrete array arguments
    const candleCall = calls.find((c) => c.file === "candle.exe" && c.args && c.args[0] === "-out");
    assert.ok(candleCall, "candle.exe must be invoked with -out");
    assert.deepEqual(candleCall.args, ["-out", path.join(stagedDir, "pec-app.wixobj"), path.join(stagedDir, "pec-app.wxs")]);

    const lightCall = calls.find((c) => c.file === "light.exe" && c.args && c.args[0] === "-out");
    assert.ok(lightCall, "light.exe must be invoked with -out");
    assert.deepEqual(lightCall.args, ["-out", outputMsi, path.join(stagedDir, "pec-app.wixobj")]);

    // Ensure raw quotes are absent
    for (const arg of [...candleCall.args!, ...lightCall.args!]) {
      assert.ok(!arg.startsWith('"') && !arg.endsWith('"'), `Argument ${arg} should not have shell quotes`);
    }
  } finally {
    child_process.execFileSync = origExecFileSync;
    child_process.execSync = origExecSync;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
});

test("S-4: buildMsiPackage falls back to WiX v4/v5 (wix.exe) via execFileSync when wixl and wix3 are unavailable", () => {
  if (process.platform !== "win32") {
    return;
  }

  const origExecFileSync = child_process.execFileSync;
  const origExecSync = child_process.execSync;

  const calls: Array<{ file: string; args: string[] | readonly string[] | undefined }> = [];
  let execSyncCalls: string[] = [];

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pec-msi-wix4-test-"));
  const stagedDir = path.join(tmpDir, "staged dir");
  fs.mkdirSync(stagedDir, { recursive: true });
  const outputMsi = path.join(tmpDir, "output app.msi");

  try {
    child_process.execSync = ((cmd: string) => {
      execSyncCalls.push(cmd);
      throw new Error(`execSync should not be called: ${cmd}`);
    }) as any;

    child_process.execFileSync = ((file: string, args?: any) => {
      calls.push({ file, args });
      if (file === "wixl" || file === "candle.exe" || file === "light.exe") {
        throw new Error("Tool not found");
      }
      if (file === "wix.exe" && Array.isArray(args) && args.includes("--version")) {
        return Buffer.from("4.0.5");
      }
      if (file === "wix.exe" && Array.isArray(args) && args.includes("build")) {
        fs.writeFileSync(outputMsi, "dummy msi payload from wix.exe");
        return Buffer.from("");
      }
      throw new Error(`Unknown command: ${file}`);
    }) as any;

    const cfg = getAppBuildConfig();
    const result = buildMsiPackage(cfg, "https://pec.example.com", stagedDir, outputMsi);

    assert.equal(result.success, true);
    assert.equal(result.msiPath, outputMsi);
    assert.equal(execSyncCalls.length, 0, "execSync must not be called");

    const wixCall = calls.find((c) => c.file === "wix.exe" && c.args && c.args[0] === "build");
    assert.ok(wixCall, "wix.exe build must be invoked");
    assert.deepEqual(wixCall.args, ["build", "-o", outputMsi, path.join(stagedDir, "pec-app.wxs")]);
  } finally {
    child_process.execFileSync = origExecFileSync;
    child_process.execSync = origExecSync;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
});

test("S-4: buildMsiWithWix is exported as an alias of buildMsiPackage", () => {
  assert.equal(typeof buildMsiWithWix, "function");
  assert.equal(buildMsiWithWix, buildMsiPackage);
});

test("Security: extractPeVersion resists truncated buffers and bounds overrun without throwing", () => {
  // Empty buffer
  assert.equal(extractPeVersion(Buffer.alloc(0)), null);

  // Buffer with signature but truncated fixed file info (< 24 bytes after signature)
  const truncatedBuf = Buffer.alloc(10);
  truncatedBuf.writeUInt32LE(0xfeef04bd, 0);
  assert.equal(extractPeVersion(truncatedBuf), null);

  // Signature exactly at end of buffer
  const endSigBuf = Buffer.alloc(100);
  endSigBuf.writeUInt32LE(0xfeef04bd, 96);
  assert.equal(extractPeVersion(endSigBuf), null);

  // Signature placed where idx + 24 === buffer.length (minimum valid fixed file info length)
  const minBuf = Buffer.alloc(28);
  minBuf.writeUInt32LE(0xfeef04bd, 4);
  minBuf.writeUInt32LE(0x00010000, 8);
  minBuf.writeUInt32LE((1 << 16) | 2, 12); // 1.2
  minBuf.writeUInt32LE((3 << 16) | 4, 16); // 3.4
  minBuf.writeUInt32LE((5 << 16) | 6, 20); // 5.6
  minBuf.writeUInt32LE((7 << 16) | 8, 24); // 7.8
  const parsed = extractPeVersion(minBuf);
  assert.ok(parsed !== null);
  assert.equal(parsed.fileVersion, "1.2.3.4");
  assert.equal(parsed.productVersion, "5.6.7.8");
});

test("Security: getCoreModulesIntegrity detects dummy / truncated binaries as unverified", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pec-sec-modules-"));
  try {
    // Create a dummy module with MZ_DUMMY header
    const dummyCore = path.join(tmpDir, "PECAppCore.dll");
    fs.writeFileSync(dummyCore, "MZ_DUMMY fake stub DLL content");

    const integrity = getCoreModulesIntegrity(tmpDir);
    const core = integrity.find((m) => m.name === "PECAppCore.dll");
    assert.ok(core);
    assert.equal(core.present, true);
    assert.equal(core.verified, false, "Dummy stub DLL must not be verified");
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
});

