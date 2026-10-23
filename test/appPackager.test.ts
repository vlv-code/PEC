import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import AdmZip from "adm-zip";
import zlib from "node:zlib";
import {
  DEFAULT_APP_BUILD_CONFIG,
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
  assert.strictEqual(info.windowsPackageUrl, "/updates/pec-client-windows-x64.zip");
  assert.strictEqual(info.linuxPackageUrl, "/updates/pec-client-linux-x64.tar.gz");
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

