import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import AdmZip from "adm-zip";
import zlib from "node:zlib";
import { execSync } from "node:child_process";
import {
  DEFAULT_APP_BUILD_CONFIG,
  DEFAULT_APP_VERSION,
  extractPeVersion,
  getCoreModulesIntegrity,
  getAppBuildConfig,
  saveAppBuildConfig,
  buildAppProfile,
  renderAppDeployPs1,
  renderAppVerifyPs1,
  packageApp,
  getAppUpdatesDir,
  getTemplatesAppDir,
  buildAppBinaries,
  assembleAppPackage,
  compileBinariesWithMinGW,
  cleanAppBinaries,
  parseAppVersion,
  writeVersionGenHeaders,
  getToolchainDiagnostics,
  MINGW_GUI_CMD,
  MSVC_GUI_CMD,
} from "../src/appPackager.js";
import { getAppBuildConfigPath, getAppBuildInfoPath, getReleasesDir } from "../src/storage.js";

test("getAppBuildConfig returns default config initially", () => {
  const cfg = getAppBuildConfig();
  assert.strictEqual(cfg.name, DEFAULT_APP_BUILD_CONFIG.name);
  assert.strictEqual(cfg.presetStyle, "cyber-blue");
  assert.strictEqual(Array.isArray(cfg.processRules), true);
  assert.strictEqual(cfg.processRules.length > 0, true);
});

test("saveAppBuildConfig updates configuration atomically and persists", () => {
  const updated = saveAppBuildConfig({
    name: "Custom Enterprise Proxy Client",
    presetStyle: "emerald-sentinel",
    trafficLogging: true,
  });

  assert.strictEqual(updated.name, "Custom Enterprise Proxy Client");
  assert.strictEqual(updated.presetStyle, "emerald-sentinel");
  assert.strictEqual(updated.trafficLogging, true);

  // Check persisted file
  const fileContent = JSON.parse(fs.readFileSync(getAppBuildConfigPath(), "utf-8"));
  assert.strictEqual(fileContent.name, "Custom Enterprise Proxy Client");
  assert.strictEqual(fileContent.presetStyle, "emerald-sentinel");
  assert.strictEqual(fileContent.trafficLogging, true);

  // No temporary files left behind
  const dir = path.dirname(getAppBuildConfigPath());
  const tmpFiles = fs.readdirSync(dir).filter((f) => f.includes("tmp") || f.endsWith(".tmp"));
  assert.strictEqual(tmpFiles.length, 0, "No tmp files should linger");
});

test("buildAppProfile generates valid .pbprofile conforming to ProxyBridge schema", () => {
  const cfg = getAppBuildConfig();
  const baseUrl = "https://pec.company.corp:8443";
  const profile = buildAppProfile(cfg, baseUrl) as any;

  assert.strictEqual(profile.Version, "1.0");
  assert.strictEqual(typeof profile.IsTrafficLoggingEnabled, "boolean");
  assert.strictEqual(Array.isArray(profile.ProxyConfigs), true);
  assert.strictEqual(profile.ProxyConfigs.length > 0, true);
  assert.strictEqual(typeof profile.ProxyConfigs[0].Host, "string");
  assert.strictEqual(typeof profile.ProxyConfigs[0].Port, "string");

  assert.strictEqual(Array.isArray(profile.ProxyRules), true);
  assert.strictEqual(profile.ProxyRules.length > 0, true);
  const rule = profile.ProxyRules[0];
  assert.strictEqual(typeof rule.ProcessName, "string");
  assert.strictEqual(typeof rule.Action, "string");
  assert.strictEqual(typeof rule.Protocol, "string");

  // PecSync section
  assert.ok(profile.PecSync);
  assert.strictEqual(profile.PecSync.serverUrl, baseUrl);
  assert.ok(profile.PecSync.fleetToken);

  // Theme section
  assert.ok(profile.Theme);
  assert.strictEqual(profile.Theme.preset, cfg.presetStyle);
  assert.strictEqual(profile.Theme.mode, cfg.defaultThemeMode);
  assert.strictEqual(profile.Theme.primary, cfg.themeColor);

  // Security check: passwords must be empty in static .pbprofile (N-1)
  for (const pc of profile.ProxyConfigs) {
    assert.strictEqual(pc.Password, "", "Packaged .pbprofile must have empty password for proxy nodes");
  }
});

test("getTemplatesAppDir returns templates/app without duplicating into dist/templates (N-8)", () => {
  const originalEnv = process.env.PEC_TEMPLATES_DIR;
  try {
    delete process.env.PEC_TEMPLATES_DIR;
    const defaultDir = getTemplatesAppDir();
    assert.strictEqual(defaultDir, path.resolve("./templates/app"));

    process.env.PEC_TEMPLATES_DIR = path.resolve("./custom_templates");
    const customDir = getTemplatesAppDir();
    assert.strictEqual(customDir, path.resolve("./custom_templates"));
  } finally {
    if (originalEnv !== undefined) {
      process.env.PEC_TEMPLATES_DIR = originalEnv;
    } else {
      delete process.env.PEC_TEMPLATES_DIR;
    }
  }
});

test("renderAppDeployPs1 and renderAppVerifyPs1 render without unresolved placeholders", () => {
  const cfg = getAppBuildConfig();
  const baseUrl = "https://pec.company.corp:8443";
  const deployScript = renderAppDeployPs1(cfg, baseUrl);
  const verifyScript = renderAppVerifyPs1(cfg);

  assert.ok(deployScript.includes("PEC-ProxyClient"));
  assert.ok(deployScript.includes("pec_profile.pbprofile"));
  assert.ok(!deployScript.includes("__"));
  assert.ok(!deployScript.includes("undefined"));

  assert.ok(verifyScript.includes("ProxyBridge"));
  assert.ok(!verifyScript.includes("__"));
  assert.ok(!verifyScript.includes("undefined"));
});

test("packageApp generates valid Windows zip and Linux tar.gz bundles with SHA-256 hashes", () => {
  const baseUrl = "https://pec.company.corp:8443";
  const info = packageApp(baseUrl);

  assert.ok(info.version);
  assert.ok(info.builtAt);
  assert.strictEqual(info.windowsPackageUrl, "/api/app-builder/download/windows");
  assert.strictEqual(info.linuxPackageUrl, "/api/app-builder/download/linux");
  assert.ok(info.windowsPackageSize > 0, "Windows zip size must be > 0");
  assert.ok(info.linuxPackageSize > 0, "Linux tar.gz size must be > 0");
  assert.match(info.windowsPackageSha256, /^[a-f0-9]{64}$/);
  assert.match(info.linuxPackageSha256, /^[a-f0-9]{64}$/);

  // Inspect windows package contents in releasesDir (strictly isolated from updatesDir)
  const updatesDir = getAppUpdatesDir();
  const releasesDir = path.join(getReleasesDir(), "apps", info.version || "2.1.0");
  const zipPath = path.join(releasesDir, "pec-client-windows-x64.zip");
  assert.strictEqual(fs.existsSync(zipPath), true, "zip must exist in releasesDir");
  assert.strictEqual(fs.existsSync(path.join(updatesDir, "pec-client-windows-x64.zip")), false, "zip must not exist in updatesDir");
  assert.strictEqual(fs.existsSync(path.join(updatesDir, "PEC-App-windows-x64.zip")), false, "PEC-App zip must not exist in updatesDir");
  assert.strictEqual(fs.existsSync(path.join(updatesDir, "pec_profile.pbprofile")), false, "profile must not exist in updatesDir");

  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries().map((e) => e.entryName);
  assert.ok(entries.includes("pec_profile.pbprofile"), "Profile must be inside zip");
  assert.ok(entries.includes("deploy-pec-app.ps1"), "Deploy script must be inside zip");
  assert.ok(entries.includes("verify-pec-app.ps1"), "Verify script must be inside zip");
  assert.ok(entries.includes("Install.cmd"), "Install.cmd must be inside zip");
  assert.ok(entries.includes("Uninstall.cmd"), "Uninstall.cmd must be inside zip");
  assert.ok(entries.includes("PEC-App.exe"), "PEC-App.exe must be inside zip");
  assert.ok(entries.includes("PEC-CLI.exe"), "PEC-CLI.exe must be inside zip");
  assert.ok(entries.includes("PECAppSvc.exe"), "PECAppSvc.exe must be inside zip");
  assert.ok(entries.includes("PECAppCore.dll"), "PECAppCore.dll must be inside zip");
  assert.ok(!entries.includes("ProxyBridge.exe"), "ProxyBridge.exe should not be in zip");
  assert.ok(!entries.includes("pbcli.exe"), "pbcli.exe should not be in zip");

  // Inspect linux package existence in releasesDir
  const tarPath = path.join(releasesDir, "pec-client-linux-x64.tar.gz");
  assert.strictEqual(fs.existsSync(tarPath), true, "tar.gz must exist in releasesDir");
  assert.strictEqual(fs.existsSync(path.join(updatesDir, "pec-client-linux-x64.tar.gz")), false, "tar.gz must not exist in updatesDir");

  // AppBuildInfo persistence check
  const infoOnDisk = JSON.parse(fs.readFileSync(getAppBuildInfoPath(), "utf-8"));
  assert.strictEqual(infoOnDisk.windowsPackageSha256, info.windowsPackageSha256);
  assert.strictEqual(infoOnDisk.linuxPackageSha256, info.linuxPackageSha256);
});

test("buildAppProfile preserves protocol BOTH and populates TargetHosts and TargetDomains conforming to ProxyBridge", () => {
  const cfg = {
    ...getAppBuildConfig(),
    processRules: [
      {
        id: "rule_tunnel",
        processName: "*",
        targetHosts: "github.com; 10.0.0.1; *.internal.corp",
        targetPorts: "*",
        protocol: "both" as const,
        action: "proxy" as const,
      },
    ],
  };

  const profile = buildAppProfile(cfg, "https://pec.company.corp") as any;
  const rule = profile.ProxyRules[0];

  assert.strictEqual(rule.Protocol, "BOTH", "Protocol must be BOTH (recognized by Windows ProtoIdx and Linux pb_profile.c), never ALL");
  assert.ok(rule.TargetHosts, "TargetHosts must be defined");
  assert.ok(rule.TargetDomains, "TargetDomains must be defined");
  assert.ok(rule.TargetDomains.includes("github.com"), "TargetDomains must contain domain names");
  assert.ok(rule.TargetHosts.includes("10.0.0.1"), "TargetHosts must contain IP addresses");
});

test("renderAppDeployPs1 escapes special characters and handles Windows service registration", () => {
  const cfg = {
    ...getAppBuildConfig(),
    name: 'PEC "Ultra" $Corp `Client`',
    installAsService: true,
  };

  const script = renderAppDeployPs1(cfg, "https://pec.company.corp");
  // Check escaping - no raw unescaped quotes or dollar variables that break PowerShell
  assert.ok(!script.includes('$AppName = "PEC "Ultra"'), "Double quotes inside app name must be escaped");
  // Check service installation logic
  assert.ok(script.includes("sc.exe") || script.includes("New-Service") || script.includes("ProxyBridgeSvc"), "Deploy script must register Windows service when installAsService is true");
});

test("renderAppVerifyPs1 supports custom InstallPath parameter and checks driver files", () => {
  const cfg = getAppBuildConfig();
  const script = renderAppVerifyPs1(cfg);

  assert.ok(script.includes("param("), "verify script must accept parameters");
  assert.ok(script.includes("$InstallPath"), "verify script must accept $InstallPath parameter");
  assert.ok(script.includes("WinDivert"), "verify script should verify WinDivert driver");
});

test("buildAppBinaries compiles or verifies native PEC-App binaries and WinDivert", () => {
  const result = buildAppBinaries();
  assert.strictEqual(result.ok, true);
  assert.ok(result.builtFiles.length > 0);
  assert.ok(result.builtFiles.includes("PEC-App.exe"));
  assert.ok(result.builtFiles.includes("PEC-CLI.exe"));
  assert.ok(result.builtFiles.includes("PECAppSvc.exe"));
  assert.ok(result.builtFiles.includes("PECAppCore.dll"));
  assert.ok(result.builtFiles.includes("WinDivert.dll"));
  assert.ok(result.builtFiles.includes("WinDivert64.sys"));
});


test("buildAppBinaries and packageApp include detailed timestamped buildLog", () => {
  const binRes = buildAppBinaries();
  assert.strictEqual(binRes.ok, true);
  assert.ok(Array.isArray(binRes.buildLog), "buildLog must be an array");
  assert.ok(binRes.buildLog.length > 0, "buildLog must have entries");
  assert.ok(binRes.buildLog.some((l: string) => l.includes("PEC-App") || l.includes("Verified") || l.includes("MinGW") || l.includes("MSVC")));

  const pkgRes = packageApp("https://pec.company.corp");
  assert.ok(Array.isArray(pkgRes.buildLog), "pkgRes.buildLog must be an array");
  assert.ok(pkgRes.buildLog.length > 0, "pkgRes.buildLog must have entries");
  assert.ok(pkgRes.buildLog.some((l: string) => l.includes("SHA-256") || l.includes("Packed")));
});

test("buildAppProfile honors uiLayout and sets Theme.layout", () => {
  const cfgTerminal = { ...getAppBuildConfig(), uiLayout: "terminal" as const };
  const profTerminal = buildAppProfile(cfgTerminal, "https://pec.company.corp") as any;
  assert.strictEqual(profTerminal.Theme.layout, "terminal");

  const cfgConsole = { ...getAppBuildConfig(), uiLayout: "console" as const };
  const profConsole = buildAppProfile(cfgConsole, "https://pec.company.corp") as any;
  assert.strictEqual(profConsole.Theme.layout, "console");
});

test("buildAppProfile inherits rules when inheritRoutingProfileId is provided", () => {
  const cfg = {
    ...getAppBuildConfig(),
    inheritRoutingProfileId: "profile_default_split",
    processRules: [
      {
        id: "rule_custom_1",
        processName: "special.exe",
        targetHosts: "special.corp",
        targetPorts: "443",
        protocol: "tcp" as const,
        action: "proxy" as const,
      },
    ],
  };

  const profile = buildAppProfile(cfg, "https://pec.company.corp") as any;
  assert.ok(Array.isArray(profile.ProxyRules));
  // Must include custom rule AND inherited rules from profile_default_split
  assert.ok(profile.ProxyRules.length > 1, "Should have more than 1 rule due to inheritance");
  assert.ok(profile.ProxyRules.some((r: any) => r.ProcessName === "special.exe"));
});

test("assembleAppPackage packages PEC-App.exe directly into PEC-App-windows-x64.zip without web server or ui/ directory", () => {
  const result = assembleAppPackage("https://pec.company.corp:8443");
  assert.strictEqual(result.fileName, "PEC-App-windows-x64.zip");
  assert.strictEqual(fs.existsSync(result.zipPath), true, "PEC-App-windows-x64.zip must exist on disk");
  assert.ok(result.size > 0, "Zip size must be > 0");
  assert.match(result.sha256, /^[a-f0-9]{64}$/);

  // Inspect entries
  assert.ok(result.entries.includes("PEC-App.exe"), "PEC-App.exe must be packaged in zip");
  assert.ok(result.entries.includes("pec_profile.pbprofile"), "Profile must be inside zip");
  assert.ok(result.entries.includes("deploy-pec-app.ps1"), "Deploy script must be inside zip");
  assert.ok(result.entries.includes("verify-pec-app.ps1"), "Verify script must be inside zip");

  // STRICT CHECK: No web server or ui/ directory allowed in native ImGui DirectX 11 release
  const hasUiDir = result.entries.some((entry) => entry.startsWith("ui/") || entry.startsWith("ui\\") || entry === "ui");
  assert.strictEqual(hasUiDir, false, "Native ImGui package must not contain ui/ directory or web assets");
  const hasHtml = result.entries.some((entry) => entry.toLowerCase().endsWith(".html"));
  assert.strictEqual(hasHtml, false, "Native ImGui package must not contain HTML web server files");
});

test("ImGui DirectX 11 compilation commands: MinGW and MSVC use exact DirectX 11 and ImGui flags", () => {
  // Verify MinGW command structure
  assert.ok(MINGW_GUI_CMD.includes("x86_64-w64-mingw32-g++"));
  assert.ok(MINGW_GUI_CMD.includes("-mwindows"));
  assert.ok(MINGW_GUI_CMD.includes("main_imgui.cpp"));
  assert.ok(MINGW_GUI_CMD.includes("imgui/imgui*.cpp"));
  assert.ok(MINGW_GUI_CMD.includes("imgui/backends/imgui_impl_win32.cpp"));
  assert.ok(MINGW_GUI_CMD.includes("imgui/backends/imgui_impl_dx11.cpp"));
  assert.ok(MINGW_GUI_CMD.includes("profile/profile.c"));
  assert.ok(MINGW_GUI_CMD.includes("profile/json.c"));
  assert.ok(MINGW_GUI_CMD.includes("res.res"));
  assert.ok(MINGW_GUI_CMD.includes("-o PEC-App.exe"));
  assert.ok(MINGW_GUI_CMD.includes("-ld3d11"));
  assert.ok(MINGW_GUI_CMD.includes("-ldxgi"));
  assert.ok(MINGW_GUI_CMD.includes("-ld3dcompiler"));
  assert.ok(MINGW_GUI_CMD.includes("-ldwmapi"));
  assert.ok(MINGW_GUI_CMD.includes("-lshlwapi"));
  assert.ok(MINGW_GUI_CMD.includes("-lshell32"));
  assert.ok(MINGW_GUI_CMD.includes("-ladvapi32"));
  assert.ok(MINGW_GUI_CMD.includes("-lole32"));
  assert.ok(MINGW_GUI_CMD.includes("-luser32"));
  assert.ok(MINGW_GUI_CMD.includes("-lgdi32"));
  assert.ok(MINGW_GUI_CMD.includes("-lcrypt32"));
  assert.ok(MINGW_GUI_CMD.includes("-luxtheme"));

  // Verify MSVC command structure
  assert.ok(MSVC_GUI_CMD.includes("cl.exe"));
  assert.ok(MSVC_GUI_CMD.includes("/EHsc"));
  assert.ok(MSVC_GUI_CMD.includes("main_imgui.cpp"));
  assert.ok(MSVC_GUI_CMD.includes("imgui\\imgui*.cpp"));
  assert.ok(MSVC_GUI_CMD.includes("imgui\\backends\\imgui_impl_win32.cpp"));
  assert.ok(MSVC_GUI_CMD.includes("imgui\\backends\\imgui_impl_dx11.cpp"));
  assert.ok(MSVC_GUI_CMD.includes("profile\\profile.c"));
  assert.ok(MSVC_GUI_CMD.includes("profile\\json.c"));
  assert.ok(MSVC_GUI_CMD.includes("res\\app.res"));
  assert.ok(MSVC_GUI_CMD.includes("/Fe:PEC-App.exe"));
  assert.ok(MSVC_GUI_CMD.includes("d3d11.lib"));
  assert.ok(MSVC_GUI_CMD.includes("dxgi.lib"));
  assert.ok(MSVC_GUI_CMD.includes("d3dcompiler.lib"));
  assert.ok(MSVC_GUI_CMD.includes("dwmapi.lib"));
  assert.ok(MSVC_GUI_CMD.includes("shlwapi.lib"));
  assert.ok(MSVC_GUI_CMD.includes("shell32.lib"));
  assert.ok(MSVC_GUI_CMD.includes("advapi32.lib"));
  assert.ok(MSVC_GUI_CMD.includes("ole32.lib"));
  assert.ok(MSVC_GUI_CMD.includes("user32.lib"));
  assert.ok(MSVC_GUI_CMD.includes("gdi32.lib"));
});

test("compileBinariesWithMinGW function executes cleanly or reports toolchain status", () => {
  const result = compileBinariesWithMinGW();
  assert.strictEqual(typeof result.ok, "boolean");
  assert.strictEqual(typeof result.message, "string");
  assert.strictEqual(Array.isArray(result.builtFiles), true);
  if (result.ok) {
    assert.ok(result.builtFiles.includes("PEC-App.exe"));
  }
});

test("parseAppVersion parses major, minor, patch, quad accurately", () => {
  const v1 = parseAppVersion("1.0.3");
  assert.strictEqual(v1.version, "1.0.3");
  assert.strictEqual(v1.major, 1);
  assert.strictEqual(v1.minor, 0);
  assert.strictEqual(v1.patch, 3);
  assert.strictEqual(v1.build, 0);
  assert.strictEqual(v1.quad, "1.0.3.0");

  const v2 = parseAppVersion("v2.4.1.9");
  assert.strictEqual(v2.version, "2.4.1");
  assert.strictEqual(v2.major, 2);
  assert.strictEqual(v2.minor, 4);
  assert.strictEqual(v2.patch, 1);
  assert.strictEqual(v2.build, 9);
  assert.strictEqual(v2.quad, "2.4.1.9");
});

test("cleanAppBinaries cleans output binaries but never deletes kernel drivers or templates", () => {
  const res = cleanAppBinaries();
  assert.strictEqual(res.ok, true);
  assert.strictEqual(Array.isArray(res.deletedFiles), true);
  assert.strictEqual(Array.isArray(res.preservedFiles), true);

  // Assert WinDivert is never touched
  const badDelete = res.deletedFiles.some((f) => f.toLowerCase().includes("windivert"));
  assert.strictEqual(badDelete, false, "Kernel drivers (WinDivert) must never be deleted");

  // WinDivert.dll and WinDivert64.sys should still exist on disk
  const tDir = path.resolve("./templates/app/windows");
  if (fs.existsSync(tDir)) {
    assert.strictEqual(fs.existsSync(path.join(tDir, "WinDivert.dll")), true);
    assert.strictEqual(fs.existsSync(path.join(tDir, "WinDivert64.sys")), true);
  }
});

test("cleanAppBinaries followed by buildAppBinaries recovers binaries from pristine templates without compiler", () => {
  cleanAppBinaries();
  const prevEnv = process.env.SKIP_NATIVE_REBUILD;
  try {
    process.env.SKIP_NATIVE_REBUILD = "true";
    const res = buildAppBinaries();
    assert.strictEqual(res.ok, true, `Expected buildAppBinaries to succeed: ${res.message}`);
    assert.strictEqual(res.builtFiles.includes("PEC-App.exe"), true);
    assert.strictEqual(res.builtFiles.includes("PEC-CLI.exe"), true);
    assert.strictEqual(res.builtFiles.includes("PECAppSvc.exe"), true);
  } finally {
    if (prevEnv !== undefined) {
      process.env.SKIP_NATIVE_REBUILD = prevEnv;
    } else {
      delete process.env.SKIP_NATIVE_REBUILD;
    }
  }
});

test("setup.c extracts payload to a secure randomized temp directory with SYSTEM/Admin SDDL (Audit H-6)", () => {
  const setupPath = path.resolve("./client/Windows/installer/setup.c");
  assert.strictEqual(fs.existsSync(setupPath), true, "setup.c must exist");
  const content = fs.readFileSync(setupPath, "utf-8");

  // Must NOT write directly to predictable %TEMP%\pec_payload.zip
  assert.strictEqual(
    content.includes('lstrcatW(tempZip, L"pec_payload.zip");'),
    false,
    "setup.c must not append payload filename directly to base temp path"
  );

  // Must use randomized unique directory (e.g. CoCreateGuid or GetTempFileNameW)
  assert.ok(
    content.includes("CoCreateGuid") || content.includes("GetTempFileNameW"),
    "setup.c must generate a randomized unique directory for payload extraction"
  );

  // Must apply restricted security descriptor granting access only to SYSTEM (SY) and Administrators (BA)
  assert.ok(
    content.includes("ConvertStringSecurityDescriptorToSecurityDescriptorW"),
    "setup.c must configure security descriptor via ConvertStringSecurityDescriptorToSecurityDescriptorW"
  );
  assert.ok(
    content.includes("D:(A;OICI;GA;;;SY)(A;OICI;GA;;;BA)"),
    "setup.c must apply restricted SDDL granting Full Access only to SYSTEM and Administrators"
  );

  // Must clean up the temporary directory
  assert.ok(
    content.includes("RemoveDirectoryW"),
    "setup.c must remove temporary extraction directory after cleanup"
  );

  // Regression check: Single-line comments must not end with a backslash (which causes line-splicing and comments out code)
  assert.strictEqual(
    /\/\/[^\r\n]*\\(?:\r?\n)/.test(content),
    false,
    "setup.c must not have trailing backslashes on single-line comments that cause line-continuation bugs"
  );

  // If clang is present on the system, compile setup.c to ensure zero compilation or syntax errors
  try {
    execSync("where.exe clang", { stdio: "ignore" });
    const res = execSync("clang -fsyntax-only -Wall -Werror=comment client/Windows/installer/setup.c", {
      encoding: "utf-8",
    });
    assert.ok(res !== undefined, "clang syntax check on setup.c must succeed");
  } catch (err: any) {
    if (err.status !== undefined && err.status !== 0) {
      throw new Error(`clang syntax check failed on setup.c: ${err.stderr || err.message}`);
    }
  }
});

test("update.h enforces WinVerifyTrust Authenticode signature verification before launching installer (Audit H-1)", () => {
  const updateHeaderPath = path.resolve("./client/Windows/gui/ui/update.h");
  assert.strictEqual(fs.existsSync(updateHeaderPath), true, "update.h must exist");
  const content = fs.readFileSync(updateHeaderPath, "utf-8");

  // Must include WinTrust headers and library pragma
  assert.ok(content.includes("<wintrust.h>"), "update.h must include <wintrust.h>");
  assert.ok(content.includes("<softpub.h>"), "update.h must include <softpub.h>");
  assert.ok(content.includes('"wintrust.lib"'), "update.h must link wintrust.lib");

  // Must call WinVerifyTrust with WINTRUST_ACTION_GENERIC_VERIFY_V2
  assert.ok(content.includes("WinVerifyTrust"), "update.h must call WinVerifyTrust");
  assert.ok(
    content.includes("WINTRUST_ACTION_GENERIC_VERIFY_V2"),
    "update.h must verify with WINTRUST_ACTION_GENERIC_VERIFY_V2"
  );

  // Must clean up state with WTD_STATEACTION_CLOSE
  assert.ok(
    content.includes("WTD_STATEACTION_CLOSE"),
    "update.h must clean up trust provider state with WTD_STATEACTION_CLOSE"
  );

  // Must use headless / no-UI parameter
  assert.ok(
    content.includes("WTD_UI_NONE"),
    "update.h must set WTD_UI_NONE to prevent interactive trust dialogs"
  );

  // Must verify authenticode before ShellExecuteW
  const verifyPos = content.indexOf("WinVerifyTrust");
  const shellExecPos = content.lastIndexOf('ShellExecuteW(dlg, L"open", d->dest');
  assert.ok(verifyPos !== -1 && shellExecPos !== -1, "Both WinVerifyTrust and ShellExecuteW must exist");
  assert.ok(verifyPos < shellExecPos, "WinVerifyTrust verification must occur before ShellExecuteW");

  // If clang is present on the system, compile main.c (which includes update.h) to ensure zero compilation errors
  try {
    execSync("where.exe clang", { stdio: "ignore" });
    const res = execSync("clang -fsyntax-only -Wall -Wextra -I client/Windows/gui client/Windows/gui/main.c", {
      encoding: "utf-8",
    });
    assert.ok(res !== undefined, "clang syntax check on main.c (including update.h) must succeed");
  } catch (err: any) {
    if (err.status !== undefined && err.status !== 0) {
      throw new Error(`clang syntax check failed on main.c: ${err.stderr || err.message}`);
    }
  }
});

test("DEFAULT_APP_VERSION is 2.2.0 and DEFAULT_APP_BUILD_CONFIG.version is 2.2.0 (Д-1, §2)", () => {
  assert.strictEqual(DEFAULT_APP_VERSION, "2.2.0");
  assert.strictEqual(DEFAULT_APP_BUILD_CONFIG.version, "2.2.0");
});

test("PUBLIC_BASE_URL has top priority in buildAppProfile, assembleAppPackage, and packageApp (R-1)", () => {
  const origEnv = process.env.PUBLIC_BASE_URL;
  try {
    process.env.PUBLIC_BASE_URL = "https://env-override.corp.example:8443";
    const cfg = getAppBuildConfig();
    const profile = buildAppProfile(cfg, "https://passed-param.example:3000") as any;
    assert.strictEqual(
      profile.PecSync.serverUrl,
      "https://env-override.corp.example:8443",
      "PUBLIC_BASE_URL from env must take precedence over parameter baseUrl"
    );

    const deployPs1 = renderAppDeployPs1(cfg, "https://passed-param.example:3000");
    assert.ok(
      deployPs1.includes("https://env-override.corp.example:8443"),
      "deploy script must use PUBLIC_BASE_URL over passed parameter"
    );
  } finally {
    if (origEnv !== undefined) {
      process.env.PUBLIC_BASE_URL = origEnv;
    } else {
      delete process.env.PUBLIC_BASE_URL;
    }
  }
});

test("extractPeVersion accurately parses VS_FIXEDFILEINFO (Д-4, R-3)", () => {
  // Empty or non-PE buffer
  assert.strictEqual(extractPeVersion(Buffer.alloc(32)), null);

  // Synthetic buffer containing VS_FIXEDFILEINFO signature 0xFEEF04BD
  const buf = Buffer.alloc(48);
  buf.writeUInt32LE(0xfeef04bd, 8);  // dwSignature
  buf.writeUInt32LE(0x00010000, 12); // dwStrucVersion
  buf.writeUInt32LE((2 << 16) | 3, 16); // dwFileVersionMS = 2.3
  buf.writeUInt32LE((4 << 16) | 5, 20); // dwFileVersionLS = 4.5
  buf.writeUInt32LE((1 << 16) | 0, 24); // dwProductVersionMS = 1.0
  buf.writeUInt32LE((9 << 16) | 0, 28); // dwProductVersionLS = 9.0

  const res = extractPeVersion(buf);
  assert.ok(res !== null);
  assert.strictEqual(res.fileVersion, "2.3.4.5");
  assert.strictEqual(res.productVersion, "1.0.9");

  // Real template binary if present
  const exePath = path.resolve("./templates/app/windows/PEC-App.exe");
  if (fs.existsSync(exePath) && fs.statSync(exePath).size > 1000) {
    const realBuf = fs.readFileSync(exePath);
    const realVer = extractPeVersion(realBuf);
    assert.ok(realVer !== null, "PEC-App.exe must contain valid VS_FIXEDFILEINFO");
    assert.ok(typeof realVer.fileVersion === "string");
    assert.ok(typeof realVer.productVersion === "string");
  }
});

test("getCoreModulesIntegrity computes sha256 and size for core modules (Д-3, R-2)", () => {
  const modules = getCoreModulesIntegrity();
  assert.strictEqual(Array.isArray(modules), true);
  assert.strictEqual(modules.length, 3);

  const names = modules.map((m) => m.name);
  assert.deepStrictEqual(names, ["PECAppCore.dll", "WinDivert.dll", "WinDivert64.sys"]);

  for (const mod of modules) {
    assert.ok(typeof mod.name === "string");
    assert.ok(typeof mod.present === "boolean");
    assert.ok(typeof mod.verified === "boolean");
    if (mod.present) {
      assert.strictEqual(mod.sha256.length, 64, `Module ${mod.name} should have valid SHA-256`);
      assert.ok(mod.size > 1000, `Module ${mod.name} size should be > 1000 bytes`);
      assert.strictEqual(mod.verified, true, `Module ${mod.name} should be verified`);
    }
  }
});

test("buildAppBinaries reports compilerStatus accurately and avoids false MSVC claims (Д-2, R-4)", () => {
  const result = buildAppBinaries();
  assert.strictEqual(typeof result.ok, "boolean");
  assert.ok(result.compilerStatus !== undefined, "compilerStatus must be defined in buildAppBinaries result");
  assert.strictEqual(typeof result.compilerStatus.compiled, "boolean");
  assert.strictEqual(typeof result.compilerStatus.compilerName, "string");

  if (!result.compilerStatus.compiled) {
    assert.ok(
      !result.compilerStatus.compilerName.includes("MSVC 2022") ||
      result.compilerStatus.compilerName.includes("failed"),
      "If not compiled, compilerName must not falsely claim pure MSVC success"
    );
  }
});

test("packageApp inspects embeddedVersion, sets binariesStale when mismatched, and includes coreModulesIntegrity (Д-4, R-3)", () => {
  saveAppBuildConfig({ version: "2.3.0" });
  const info = packageApp("https://pec.example.com");

  assert.ok(info.coreModulesIntegrity !== undefined, "coreModulesIntegrity must be present in AppBuildInfo");
  assert.strictEqual(Array.isArray(info.coreModulesIntegrity), true);
  assert.strictEqual(info.coreModulesIntegrity.length, 3);

  assert.ok(info.embeddedVersion !== undefined, "embeddedVersion should be detected from PEC-App.exe");
  // Embedded binary in templates is 1.0.3, while target package is 2.3.0 -> stale!
  assert.strictEqual(info.binariesStale, true, "binariesStale must be true when embedded version != configured version");

  // Restore back to default
  saveAppBuildConfig({ version: DEFAULT_APP_VERSION });
});

test("getToolchainDiagnostics returns structured diagnostic object with compiler inspection", () => {
  const diag = getToolchainDiagnostics();
  assert.strictEqual(typeof diag.available, "boolean");
  assert.strictEqual(typeof diag.compilerName, "string");
  assert.strictEqual(typeof diag.hasGcc, "boolean");
  assert.strictEqual(typeof diag.hasGxx, "boolean");
  assert.strictEqual(typeof diag.hasWindres, "boolean");
  assert.strictEqual(typeof diag.hasWixl, "boolean");
  assert.strictEqual(typeof diag.hasMakensis, "boolean");
  assert.ok(diag.tools && typeof diag.tools === "object", "diag.tools must be provided");
  assert.strictEqual(typeof diag.wixl?.available, "boolean");
  assert.strictEqual(typeof diag.gcc?.available, "boolean");
  assert.strictEqual(typeof diag.windres?.available, "boolean");

  if (diag.available) {
    assert.ok(diag.compilerName !== "None", "compilerName should identify available compiler");
    assert.ok(diag.compilerName.includes("MSVC") || diag.compilerName.includes("MinGW") || diag.compilerName.includes("GCC"));
  } else {
    assert.strictEqual(diag.compilerName, "None");
    assert.strictEqual(diag.hasGcc, false);
    assert.strictEqual(diag.hasGxx, false);
    assert.strictEqual(diag.hasWindres, false);
  }
});

test("buildAppBinaries reports ok: false, compiled: false, compilerMissing: true honestly when no compiler is present", () => {
  const origEnv = process.env.PEC_FORCE_NO_COMPILER;
  try {
    process.env.PEC_FORCE_NO_COMPILER = "true";
    const diag = getToolchainDiagnostics();
    assert.strictEqual(diag.available, false);
    assert.strictEqual(diag.compilerName, "None");

    const result = buildAppBinaries();
    assert.strictEqual(result.ok, false, "buildAppBinaries must NOT return ok: true when compiler is missing");
    assert.strictEqual(result.compiled, false, "compiled must be false");
    assert.strictEqual(result.compilerMissing, true, "compilerMissing must be true");
    assert.ok(result.compilerStatus !== undefined);
    assert.strictEqual(result.compilerStatus.compiled, false);
    assert.strictEqual(result.compilerStatus.compilerMissing, true);
    assert.ok(
      result.message.includes("Компилятор C/C++ не обнаружен в системе. Сборка невозможна. В шаблонах находятся бинарники v"),
      `Message must explain compiler is missing and state embedded version: ${result.message}`
    );
    assert.ok(result.toolchain !== undefined);
    assert.strictEqual(result.toolchain.available, false);
  } finally {
    if (origEnv !== undefined) {
      process.env.PEC_FORCE_NO_COMPILER = origEnv;
    } else {
      delete process.env.PEC_FORCE_NO_COMPILER;
    }
  }
});

test("buildAppBinaries with available compiler verifies PE integrity (> 100 KB and version matching) and includes toolchain", () => {
  const diag = getToolchainDiagnostics();
  if (!diag.available) {
    return;
  }

  const result = buildAppBinaries("2.2.0");
  assert.ok(result.toolchain !== undefined, "toolchain must be present in build result");
  assert.strictEqual(result.toolchain.available, true);
  if (result.compiled) {
    assert.strictEqual(result.ok, true);
    const winTemplatesDir = path.join(getTemplatesAppDir(), "windows");
    for (const exe of ["PEC-App.exe", "PEC-CLI.exe", "PECAppSvc.exe"]) {
      const p = path.join(winTemplatesDir, exe);
      assert.strictEqual(fs.existsSync(p), true, `${exe} must exist`);
      const sz = fs.statSync(p).size;
      assert.ok(sz > 100 * 1024, `${exe} size (${sz} bytes) must be > 100 KB`);
      const pe = extractPeVersion(fs.readFileSync(p));
      assert.ok(pe, `${exe} must have valid PE version info`);
      const ver = pe.productVersion || pe.fileVersion;
      assert.ok(ver.startsWith("2.2.0") || ver === "2.2.0.0", `${exe} PE version (${ver}) must match target version 2.2.0`);
    }
  }
});

test("writeVersionGenHeaders generates C headers with correct numeric and string definitions without shell escape corruption", () => {
  const clientWinDir = path.resolve("./client/Windows");
  const parsed = parseAppVersion("1.0.5");
  writeVersionGenHeaders(clientWinDir, parsed);

  const guiVerGen = path.join(clientWinDir, "gui", "res", "version_gen.h");
  const instVerGen = path.join(clientWinDir, "installer", "version_gen.h");

  assert.strictEqual(fs.existsSync(guiVerGen), true, "gui version_gen.h must exist");
  assert.strictEqual(fs.existsSync(instVerGen), true, "installer version_gen.h must exist");

  const guiContent = fs.readFileSync(guiVerGen, "utf-8");
  assert.ok(guiContent.includes('#define PB_VER_MAJOR 1'), "Must define numeric major");
  assert.ok(guiContent.includes('#define PB_VER_MINOR 0'), "Must define numeric minor");
  assert.ok(guiContent.includes('#define PB_VER_PATCH 5'), "Must define numeric patch");
  assert.ok(guiContent.includes('#define PB_VER_STR "1.0.5"'), 'Must define PB_VER_STR as "1.0.5"');
  assert.ok(guiContent.includes('#define APP_VERSION_STR "1.0.5.0"'), 'Must define APP_VERSION_STR as "1.0.5.0"');

  const instContent = fs.readFileSync(instVerGen, "utf-8");
  assert.ok(instContent.includes('#define APP_VER_MAJOR 1'));
  assert.ok(instContent.includes('#define APP_VERSION_STR "1.0.5.0"'));
});

