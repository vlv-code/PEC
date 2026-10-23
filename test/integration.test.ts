import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import {
  packageApp,
  assembleAppPackage,
  getAppUpdatesDir,
  getTemplatesAppDir,
  buildAppBinaries,
  MINGW_GUI_CMD,
  MSVC_GUI_CMD,
} from "../src/appPackager.js";
import { getReleasesDir } from "../src/storage.js";

/**
 * Helper to inspect PE header structure of a Windows binary buffer.
 */
function inspectPeHeader(buffer: Buffer): {
  isPe: boolean;
  isPe64: boolean;
  machine: number;
  magic: number;
} {
  if (buffer.length < 64) {
    return { isPe: false, isPe64: false, machine: 0, magic: 0 };
  }
  // Check MZ signature
  if (buffer[0] !== 0x4d || buffer[1] !== 0x5a) {
    return { isPe: false, isPe64: false, machine: 0, magic: 0 };
  }
  const peOffset = buffer.readUInt32LE(0x3c);
  if (peOffset + 24 > buffer.length) {
    return { isPe: false, isPe64: false, machine: 0, magic: 0 };
  }
  // Check 'PE\0\0'
  const isPe =
    buffer[peOffset] === 0x50 &&
    buffer[peOffset + 1] === 0x45 &&
    buffer[peOffset + 2] === 0x00 &&
    buffer[peOffset + 3] === 0x00;
  if (!isPe) {
    return { isPe: false, isPe64: false, machine: 0, magic: 0 };
  }
  const machine = buffer.readUInt16LE(peOffset + 4);
  const optHeaderOffset = peOffset + 24;
  const magic = optHeaderOffset + 2 <= buffer.length ? buffer.readUInt16LE(optHeaderOffset) : 0;
  // 0x8664 = IMAGE_FILE_MACHINE_AMD64; 0x020B = PE32+ (64-bit optional header)
  const isPe64 = machine === 0x8664 || magic === 0x020b;
  return { isPe: true, isPe64, machine, magic };
}

test("Integration: assembleAppPackage builds clean DirectX 11 PEC-App-windows-x64.zip bundle", () => {
  const baseUrl = "https://pec.integration.corp:8443";
  const result = assembleAppPackage(baseUrl);

  assert.strictEqual(result.fileName, "PEC-App-windows-x64.zip");
  assert.strictEqual(fs.existsSync(result.zipPath), true, "PEC-App-windows-x64.zip must exist");
  assert.ok(result.size > 0, "Package size must be greater than 0");
  assert.match(result.sha256, /^[a-f0-9]{64}$/);

  // Read zip contents
  const zip = new AdmZip(result.zipPath);
  const entryNames = zip.getEntries().map((e) => e.entryName);

  // Must include the standalone PEC-App.exe executable
  assert.ok(entryNames.includes("PEC-App.exe"), "Zip must contain PEC-App.exe");

  // Must NOT include obsolete legacy aliases
  assert.ok(!entryNames.includes("ProxyBridge.exe"), "Zip must not contain ProxyBridge.exe");
  assert.ok(!entryNames.includes("pbcli.exe"), "Zip must not contain pbcli.exe");

  // Zero web server footprint: no ui/ directory, no HTML/CSS files
  const uiEntries = entryNames.filter((name) => name.startsWith("ui/") || name.startsWith("ui\\") || name === "ui");
  assert.strictEqual(uiEntries.length, 0, "Zip must not contain any ui/ directory or web assets");
  const htmlEntries = entryNames.filter((name) => name.toLowerCase().endsWith(".html"));
  assert.strictEqual(htmlEntries.length, 0, "Zip must not contain HTML files");

  // Verify core drivers and configs
  assert.ok(entryNames.includes("pec_profile.pbprofile"), "Zip must contain pec_profile.pbprofile");
  assert.ok(entryNames.includes("Default.pbprofile"), "Zip must contain Default.pbprofile");
  assert.ok(entryNames.includes("deploy-pec-app.ps1"), "Zip must contain deploy-pec-app.ps1");
  assert.ok(entryNames.includes("verify-pec-app.ps1"), "Zip must contain verify-pec-app.ps1");
  assert.ok(entryNames.includes("Install.cmd"), "Zip must contain Install.cmd");
  assert.ok(entryNames.includes("Uninstall.cmd"), "Zip must contain Uninstall.cmd");

  // Profile content check
  const profileEntry = zip.getEntry("pec_profile.pbprofile");
  assert.ok(profileEntry);
  const profileData = JSON.parse(profileEntry.getData().toString("utf-8"));
  assert.strictEqual(profileData.Version, "1.0");
  assert.strictEqual(profileData.PecSync.serverUrl, baseUrl);
});

test("Integration: PEC-App.exe in package is a valid PE64 binary linking DirectX 11", () => {
  const result = assembleAppPackage("https://pec.integration.corp:8443");
  const zip = new AdmZip(result.zipPath);
  const exeEntry = zip.getEntry("PEC-App.exe");
  assert.ok(exeEntry, "PEC-App.exe entry must exist in zip");

  const exeBuffer = exeEntry.getData();
  assert.ok(exeBuffer.length > 0, "PEC-App.exe buffer must not be empty");

  // Check MZ header and PE signature
  const peInfo = inspectPeHeader(exeBuffer);
  assert.strictEqual(peInfo.isPe, true, "Must be a valid PE executable");
  assert.strictEqual(peInfo.isPe64, true, "Must be a 64-bit PE64 binary (IMAGE_FILE_MACHINE_AMD64 / PE32+)");

  // Verify DirectX 11 runtime dependency
  const hasD3d11 =
    exeBuffer.includes(Buffer.from("d3d11.dll", "ascii")) ||
    exeBuffer.includes(Buffer.from("D3D11.dll", "ascii")) ||
    exeBuffer.includes(Buffer.from("d3d11", "ascii"));
  assert.strictEqual(hasD3d11, true, "PEC-App.exe must link DirectX 11 runtime (d3d11.dll)");
});

test("Integration: ImGui DirectX 11 build commands correctly link d3d11, dxgi, and d3dcompiler", () => {
  // Check MinGW link flags
  assert.ok(MINGW_GUI_CMD.includes("-ld3d11"), "MinGW command must link -ld3d11");
  assert.ok(MINGW_GUI_CMD.includes("-ldxgi"), "MinGW command must link -ldxgi");
  assert.ok(MINGW_GUI_CMD.includes("-ld3dcompiler"), "MinGW command must link -ld3dcompiler");
  assert.ok(MINGW_GUI_CMD.includes("-ldwmapi"), "MinGW command must link -ldwmapi");
  assert.ok(MINGW_GUI_CMD.includes("-lshlwapi"), "MinGW command must link -lshlwapi");
  assert.ok(MINGW_GUI_CMD.includes("-lshell32"), "MinGW command must link -lshell32");
  assert.ok(MINGW_GUI_CMD.includes("-ladvapi32"), "MinGW command must link -ladvapi32");
  assert.ok(MINGW_GUI_CMD.includes("-lole32"), "MinGW command must link -lole32");
  assert.ok(MINGW_GUI_CMD.includes("-luser32"), "MinGW command must link -luser32");
  assert.ok(MINGW_GUI_CMD.includes("-lgdi32"), "MinGW command must link -lgdi32");
  assert.ok(MINGW_GUI_CMD.includes("main_imgui.cpp"), "MinGW command must compile main_imgui.cpp");

  // Check MSVC link flags
  assert.ok(MSVC_GUI_CMD.includes("d3d11.lib"), "MSVC command must link d3d11.lib");
  assert.ok(MSVC_GUI_CMD.includes("dxgi.lib"), "MSVC command must link dxgi.lib");
  assert.ok(MSVC_GUI_CMD.includes("d3dcompiler.lib"), "MSVC command must link d3dcompiler.lib");
  assert.ok(MSVC_GUI_CMD.includes("dwmapi.lib"), "MSVC command must link dwmapi.lib");
  assert.ok(MSVC_GUI_CMD.includes("shlwapi.lib"), "MSVC command must link shlwapi.lib");
  assert.ok(MSVC_GUI_CMD.includes("shell32.lib"), "MSVC command must link shell32.lib");
  assert.ok(MSVC_GUI_CMD.includes("advapi32.lib"), "MSVC command must link advapi32.lib");
  assert.ok(MSVC_GUI_CMD.includes("ole32.lib"), "MSVC command must link ole32.lib");
  assert.ok(MSVC_GUI_CMD.includes("user32.lib"), "MSVC command must link user32.lib");
  assert.ok(MSVC_GUI_CMD.includes("gdi32.lib"), "MSVC command must link gdi32.lib");
  assert.ok(MSVC_GUI_CMD.includes("main_imgui.cpp"), "MSVC command must compile main_imgui.cpp");
});

test("Integration: main_imgui.cpp source includes DirectX 11 pipeline headers", () => {
  const mainImguiPath = path.resolve("./client/Windows/gui/main_imgui.cpp");
  assert.strictEqual(fs.existsSync(mainImguiPath), true, "main_imgui.cpp must exist");

  const content = fs.readFileSync(mainImguiPath, "utf-8");
  assert.ok(content.includes("<d3d11.h>"), "main_imgui.cpp must include <d3d11.h>");
  assert.ok(content.includes("<dxgi.h>"), "main_imgui.cpp must include <dxgi.h>");
  assert.ok(content.includes("imgui_impl_dx11.h"), "main_imgui.cpp must include imgui_impl_dx11.h");
  assert.ok(content.includes("imgui_impl_win32.h"), "main_imgui.cpp must include imgui_impl_win32.h");
  assert.ok(content.includes("profile/profile.h") || content.includes("PB_ProfileLoadActive"), "main_imgui.cpp must interface with profile");
});

test("Integration: packageApp archives versioned PEC-App-windows-x64.zip in releases directory", () => {
  const baseUrl = "https://pec.integration.corp:8443";
  const buildInfo = packageApp(baseUrl);

  const version = buildInfo.version || "2.1.0";
  const releasesDir = path.join(getReleasesDir(), "apps", version);
  const versionedZip = path.join(releasesDir, "PEC-App-windows-x64.zip");
  assert.strictEqual(fs.existsSync(versionedZip), true, "Versioned PEC-App-windows-x64.zip must exist in releases store");

  const zip = new AdmZip(versionedZip);
  const entries = zip.getEntries().map((e) => e.entryName);
  assert.ok(entries.includes("PEC-App.exe"), "Versioned zip must contain PEC-App.exe");
  assert.strictEqual(entries.some((e) => e.startsWith("ui/")), false, "Versioned zip must not contain ui/ directory");
});
