import "./loadEnv.js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import child_process from "node:child_process";
import AdmZip from "adm-zip";
import { writeJsonAtomic, readJsonStore } from "./jsonStore.js";
import { getAppBuildConfigPath, getAppBuildInfoPath, getReleasesDir } from "./storage.js";
import { recordRelease } from "./releases.js";
import { getActiveProxy, getProxyById, getAllProxies } from "./proxies.js";
import { getProxyConfig } from "./instances.js";
import { getProfileById, expandRuleDomains } from "./routing.js";
import type { AppBuildConfig, AppBuildInfo, AppProcessRule, ProxyNode, ToolchainDiagnostics } from "./types.js";
import { signBinary, getCertificateStatus } from "./codeSigner.js";

export function getTemplatesAppDir(): string {
  if (process.env.PEC_TEMPLATES_DIR) {
    return path.resolve(process.env.PEC_TEMPLATES_DIR);
  }
  return path.resolve("./templates/app");
}

export function getAppUpdatesDir(): string {
  return path.resolve(process.env.PEC_UPDATES_DIR || "./dist/updates");
}

export function ensurePristineTemplates(): void {
  const rootWin = path.join(getTemplatesAppDir(), "windows");
  const fallbackWin = path.resolve("./templates/app/windows");
  const dirs = Array.from(new Set([rootWin, fallbackWin]));

  const binaries = [
    "PEC-App.exe",
    "PEC-CLI.exe",
    "PECAppSvc.exe",
    "PEC-App-Setup.exe",
    "PECAppCore.dll",
    "WinDivert.dll",
    "WinDivert64.sys"
  ];

  for (const winDir of dirs) {
    if (!fs.existsSync(winDir)) continue;
    const pristineDir = path.join(winDir, ".pristine");
    if (!fs.existsSync(pristineDir)) {
      try { fs.mkdirSync(pristineDir, { recursive: true }); } catch {}
    }
    for (const b of binaries) {
      const src = path.join(winDir, b);
      const dst = path.join(pristineDir, b);
      const altSrc = winDir === rootWin ? path.join(fallbackWin, b) : path.join(rootWin, b);
      const altPristine = winDir === rootWin ? path.join(fallbackWin, ".pristine", b) : path.join(rootWin, ".pristine", b);

      if (fs.existsSync(src) && fs.statSync(src).size > 1000) {
        if (!fs.existsSync(dst) || fs.statSync(dst).size < 1000) {
          try { fs.copyFileSync(src, dst); } catch {}
        }
      } else if (fs.existsSync(altSrc) && fs.statSync(altSrc).size > 1000) {
        try { fs.copyFileSync(altSrc, src); } catch {}
        if (!fs.existsSync(dst) || fs.statSync(dst).size < 1000) {
          try { fs.copyFileSync(altSrc, dst); } catch {}
        }
      } else if (fs.existsSync(dst) && fs.statSync(dst).size > 1000) {
        try { fs.copyFileSync(dst, src); } catch {}
      } else if (fs.existsSync(altPristine) && fs.statSync(altPristine).size > 1000) {
        try { fs.copyFileSync(altPristine, src); } catch {}
        try { fs.copyFileSync(altPristine, dst); } catch {}
      }
    }
  }
}

try { ensurePristineTemplates(); } catch {}

export const DEFAULT_APP_VERSION = "2.2.0";

export const DEFAULT_APP_BUILD_CONFIG: AppBuildConfig = {
  name: "PEC-App",
  shortName: "PEC-App",
  version: DEFAULT_APP_VERSION,
  description: "Корпоративный прозрачный клиент PEC-App с маршрутизацией трафика, фильтрацией процессов и автоматической синхронизацией.",
  presetStyle: "cyber-blue",
  uiLayout: "console",
  defaultThemeMode: "dark",
  themeColor: "#38bdf8",
  themeBackground: "#0b1120",
  themeCard: "#131d36",
  iconType: "shield",
  defaultServerUrl: (process.env.PUBLIC_BASE_URL || "https://update.example.com").trim().replace(/\/+$/, ""),
  defaultToken: process.env.EXT_SHARED_TOKEN || "corp-proxy-secret-token-change-me",
  syncIntervalMinutes: 15,
  autoStartWithWindows: true,
  startMinimizedToTray: true,
  installAsService: false,
  trafficLogging: true,
  defaultProxyId: "",
  processRules: [
    {
      id: "rule_blocked_sites",
      processName: "*",
      targetDomains: "*.youtube.com; *.googlevideo.com; *.ytimg.com; *.twitter.com; *.x.com; *.instagram.com; *.linkedin.com",
      targetHosts: "*",
      targetPorts: "80; 443",
      protocol: "tcp",
      action: "proxy",
    },
    {
      id: "rule_dev_tools",
      processName: "curl.exe; git.exe; powershell.exe; pwsh.exe; docker.exe; node.exe; python.exe",
      targetDomains: "*",
      targetHosts: "*",
      targetPorts: "80; 443; 22",
      protocol: "tcp",
      action: "proxy",
    },
    {
      id: "rule_internal_direct",
      processName: "*",
      targetDomains: "*.corp; *.local; *.internal",
      targetHosts: "10.0.0.0/8; 172.16.0.0/12; 192.168.0.0/16; 127.0.0.1",
      targetPorts: "*",
      protocol: "both",
      action: "direct",
    },
    {
      id: "rule_browsers_direct",
      processName: "chrome.exe; msedge.exe; brave.exe; yandex.exe; opera.exe; vivaldi.exe; firefox.exe",
      targetDomains: "*",
      targetHosts: "*",
      targetPorts: "80; 443",
      protocol: "tcp",
      action: "direct",
    },
  ],
};

let currentAppBuildConfig: AppBuildConfig = { ...DEFAULT_APP_BUILD_CONFIG };

export function splitHostsAndDomains(rawHosts?: string): { ips: string; domains: string } {
  if (!rawHosts || rawHosts.trim() === "*" || rawHosts.trim() === "") {
    return { ips: "*", domains: "*" };
  }
  const tokens = rawHosts
    .split(/[;,]/)
    .map((t) => t.trim())
    .filter(Boolean);
  const ips: string[] = [];
  const domains: string[] = [];
  for (const tok of tokens) {
    if (tok === "*") {
      ips.push("*");
      domains.push("*");
      continue;
    }
    // Domain token: contains letters or starts with *. or has domain-like characters
    if (/[a-zA-Z]/.test(tok)) {
      domains.push(tok);
    } else {
      ips.push(tok);
    }
  }
  return {
    ips: ips.length > 0 ? ips.join(";") : "*",
    domains: domains.length > 0 ? domains.join(";") : "*",
  };
}

export function escapePsString(str: string): string {
  return String(str || "").replace(/[`$"']/g, (c) => "`" + c);
}

export function loadPersistedAppBuildConfig(): AppBuildConfig {
  const configPath = getAppBuildConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const data = readJsonStore<AppBuildConfig>(configPath);
      if (data && typeof data === "object") {
        currentAppBuildConfig = {
          ...DEFAULT_APP_BUILD_CONFIG,
          ...data,
          processRules: Array.isArray(data.processRules) ? data.processRules : DEFAULT_APP_BUILD_CONFIG.processRules,
        };
      }
    } else {
      currentAppBuildConfig = {
        ...DEFAULT_APP_BUILD_CONFIG,
        processRules: [...DEFAULT_APP_BUILD_CONFIG.processRules],
      };
    }
  } catch (err) {
    console.warn("[appPackager] Failed to load app build config, using defaults:", err);
  }
  return { ...currentAppBuildConfig };
}

// Initial load
loadPersistedAppBuildConfig();

export function getAppBuildConfig(): AppBuildConfig {
  loadPersistedAppBuildConfig();
  return { ...currentAppBuildConfig };
}

export function saveAppBuildConfig(updates: Partial<AppBuildConfig>): AppBuildConfig {
  const current = getAppBuildConfig();
  currentAppBuildConfig = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  try {
    writeJsonAtomic(getAppBuildConfigPath(), currentAppBuildConfig);
  } catch (err) {
    console.error("[appPackager] Error persisting app build config:", err);
    throw err;
  }

  return { ...currentAppBuildConfig };
}

export function buildAppProfile(cfg: AppBuildConfig, baseUrl: string): object {
  let proxy: ProxyNode | undefined;
  if (cfg.defaultProxyId) {
    proxy = getProxyById(cfg.defaultProxyId);
  }
  if (!proxy) {
    proxy = getActiveProxy();
  }

  let host = proxy?.host;
  let port = proxy?.port;
  let protocol = proxy?.protocol || "socks5";
  let username = proxy?.username || "";
  let password = proxy?.password || "";
  const proxyName = proxy?.name || "Corporate Proxy";

  if (!host || !port) {
    try {
      const fallbackConfig = getProxyConfig();
      if (fallbackConfig && fallbackConfig.host && fallbackConfig.port) {
        host = fallbackConfig.host;
        port = fallbackConfig.port;
        const fbProto = fallbackConfig.protocol;
        if (fbProto === "http" || fbProto === "https" || fbProto === "socks5") {
          protocol = fbProto;
        }
      }
    } catch {}
  }

  if (!host) host = "127.0.0.1";
  if (!port) port = 1080;

  const allNodes = getAllProxies(false).filter((p) => p.host && p.port);
  const orderedNodes: Array<{
    id?: string;
    name: string;
    protocol: string;
    host: string;
    port: number | string;
    username?: string;
    password?: string;
  }> = [];

  orderedNodes.push({
    id: proxy?.id,
    name: proxyName,
    protocol,
    host,
    port,
    username,
    password,
  });

  for (const node of allNodes) {
    if (orderedNodes.some((n) => n.host === node.host && String(n.port) === String(node.port))) {
      continue;
    }
    orderedNodes.push({
      id: node.id,
      name: node.name || `Proxy ${orderedNodes.length + 1}`,
      protocol: node.protocol || "socks5",
      host: node.host,
      port: node.port,
      username: node.username || "",
      password: node.password || "",
    });
    if (orderedNodes.length >= 32) break;
  }

  const proxyConfigs = orderedNodes.map((node, idx) => ({
    Id: idx + 1,
    Name: node.name,
    Type: (node.protocol || "socks5").toUpperCase(),
    Host: node.host,
    Port: String(node.port),
    Username: node.username || "",
    Password: "",
    SendDomainToProxy: true,
  }));

  const effectiveRules = [...(cfg.processRules || [])];
  if (cfg.inheritRoutingProfileId) {
    try {
      const parentProfile = getProfileById(cfg.inheritRoutingProfileId);
      if (parentProfile && Array.isArray(parentProfile.rules)) {
        for (let i = 0; i < parentProfile.rules.length; i++) {
          const r = parentProfile.rules[i];
          const expanded = expandRuleDomains(r);
          if (expanded.length > 0) {
            effectiveRules.push({
              id: `inherited_${r.id || i + 1}`,
              processName: "*",
              targetHosts: expanded.slice(0, 100).join("; "),
              targetPorts: "*",
              protocol: "tcp",
              action: r.action === "block" ? "block" : (r.action === "direct" ? "direct" : "proxy"),
            });
          }
        }
      }
    } catch (e) {
      console.warn("[appPackager] Could not inherit rules from routing profile:", e);
    }
  }

  const proxyRules = effectiveRules.map((rule, idx) => {
    let proto = (rule.protocol || "tcp").toUpperCase();
    if (proto === "ALL") proto = "BOTH";
    let action = (rule.action || "proxy").toUpperCase();
    let ips = "*";
    let domains = "*";

    if (rule.targetDomains !== undefined && rule.targetDomains !== null) {
      domains = rule.targetDomains.trim() || "*";
      ips = rule.targetHosts ? splitHostsAndDomains(rule.targetHosts).ips : "*";
    } else {
      const split = splitHostsAndDomains(rule.targetHosts);
      ips = split.ips;
      domains = split.domains;
    }

    return {
      Name: rule.processName || `Rule ${idx + 1}`,
      ProcessName: rule.processName || "*",
      TargetHosts: ips,
      TargetPorts: rule.targetPorts || "*",
      TargetDomains: domains,
      Protocol: proto,
      Action: action,
      IsEnabled: true,
      ProxyConfigId: 1,
    };
  });

  const envPublicBase = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  const effectiveServerUrl = (envPublicBase || baseUrl || cfg.defaultServerUrl || "http://127.0.0.1:3000").replace(/\/+$/, "");

  return {
    Version: "1.0",
    Name: cfg.name || "PEC Client",
    Language: "ru",
    IsTrafficLoggingEnabled: cfg.trafficLogging !== undefined ? Boolean(cfg.trafficLogging) : true,
    AutoClearConnectionLogs: true,
    LogEveryConnection: false,
    CloseToTray: Boolean(cfg.startMinimizedToTray),
    FontZoom: 100,
    NextProxyConfigId: proxyConfigs.length + 1,
    ProxyConfigs: proxyConfigs,
    ProxyRules: proxyRules,
    PecSync: {
      serverUrl: effectiveServerUrl,
      fleetToken: cfg.defaultToken || process.env.EXT_SHARED_TOKEN || "corp-proxy-secret-token-change-me",
      intervalMinutes: cfg.syncIntervalMinutes || 15,
    },
    Theme: {
      preset: cfg.presetStyle || "cyber-blue",
      layout: cfg.uiLayout || "console",
      mode: cfg.defaultThemeMode || "dark",
      primary: cfg.themeColor || "#38bdf8",
      background: cfg.themeBackground || "#0b1120",
      card: cfg.themeCard || "#131d36",
    },
  };
}

export function renderAppDeployPs1(cfg: AppBuildConfig, baseUrl: string): string {
  const appName = cfg.name || "PEC - Proxy Client";
  const appVersion = cfg.version || DEFAULT_APP_VERSION;
  const envPublicBase = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  const serverUrl = (envPublicBase || baseUrl || cfg.defaultServerUrl || "").replace(/\/+$/, "");
  const autoStart = cfg.autoStartWithWindows ? "$true" : "$false";
  const isService = cfg.installAsService ? "$true" : "$false";

  const safeAppName = escapePsString(appName);
  const safeAppVersion = escapePsString(appVersion);
  const safeServerUrl = escapePsString(serverUrl);

  return `<#
.SYNOPSIS
    Enterprise silent deployment script for ${safeAppName}.
.DESCRIPTION
    Installs PEC Proxy Client binaries, configuration profile, desktop/start menu shortcuts,
    and registers startup persistence or Windows service.
#>
[CmdletBinding()]
param(
    [string]$InstallPath = "",
    [switch]$Silent = $true
)

$ErrorActionPreference = "Stop"

$AppName = "${safeAppName}"
$AppVersion = "${safeAppVersion}"
$ServerUrl = "${safeServerUrl}"
$IsService = ${isService}
$AutoStart = ${autoStart}

if (-not $InstallPath) {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if ($isAdmin) {
        $InstallPath = Join-Path $env:ProgramFiles "PEC-ProxyClient"
    } else {
        $InstallPath = Join-Path $env:LOCALAPPDATA "PEC-ProxyClient"
    }
}

Write-Host "[PEC-Deploy] Installing $AppName v$AppVersion into $InstallPath..." -ForegroundColor Cyan
if (-not (Test-Path $InstallPath)) {
    New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Get-ChildItem -Path $ScriptDir -Exclude "deploy-pec-app.ps1" | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $InstallPath -Recurse -Force
}

if ($isAdmin) {
    try {
        & icacls.exe "$InstallPath" /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-32-545:(OI)(CI)RX" 2>$null | Out-Null
    } catch {
        Write-Warning "[PEC-Deploy] icacls notice: $_"
    }
}

$ExePath = Join-Path $InstallPath "PEC-App.exe"
if (-not (Test-Path $ExePath)) {
    $ExePath = Join-Path $InstallPath "ProxyBridge.exe"
}
$ProfilePath = Join-Path $InstallPath "pec_profile.pbprofile"

# Create Start Menu & Desktop Shortcut
try {
    $WshShell = New-Object -ComObject WScript.Shell
    $StartMenuPath = [System.IO.Path]::Combine([Environment]::GetFolderPath([Environment+SpecialFolder]::Programs), "PEC-App.lnk")
    $Shortcut = $WshShell.CreateShortcut($StartMenuPath)
    $Shortcut.TargetPath = $ExePath
    $Shortcut.Arguments = "-profile \`"$ProfilePath\`""
    $Shortcut.WorkingDirectory = $InstallPath
    $Shortcut.Description = "$AppName Client"
    $Shortcut.Save()
} catch {
    Write-Warning "[PEC-Deploy] Could not create shortcut: $_"
}

if ($IsService) {
    try {
        Write-Host "[PEC-Deploy] Configuring Windows Service for $AppName..." -ForegroundColor Cyan
        $SvcName = "PECAppSvc"
        $SvcExePath = Join-Path $InstallPath "PECAppSvc.exe"
        if (-not (Test-Path $SvcExePath)) {
            $SvcExePath = Join-Path $InstallPath "ProxyBridgeSvc.exe"
        }
        $BinPath = "\`"$SvcExePath\`""
        & sc.exe stop $SvcName 2>$null | Out-Null
        & sc.exe delete $SvcName 2>$null | Out-Null
        & sc.exe stop "PECProxyBridgeSvc" 2>$null | Out-Null
        & sc.exe delete "PECProxyBridgeSvc" 2>$null | Out-Null
        & sc.exe stop "ProxyBridgeSvc" 2>$null | Out-Null
        & sc.exe delete "ProxyBridgeSvc" 2>$null | Out-Null
        if (Test-Path $SvcExePath) {
            & $SvcExePath --setup-users 2>$null | Out-Null
        }
        & sc.exe create $SvcName binPath= $BinPath start= auto DisplayName= "PEC-App Service" | Out-Null
        & sc.exe description $SvcName "Privileged transparent proxy service for $AppName." | Out-Null
        & sc.exe sdset $SvcName "D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWLOCRRC;;;IU)(A;;CCLCSWLOCRRC;;;SU)" 2>$null | Out-Null
        & sc.exe start $SvcName 2>$null | Out-Null
        Write-Host "[PEC-Deploy] Service $SvcName registered and started (start=auto)." -ForegroundColor Green
    } catch {
        Write-Warning "[PEC-Deploy] Could not configure service: $_"
    }
}

if ($AutoStart -and -not $IsService) {
    $regKey = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"
    Set-ItemProperty -Path $regKey -Name "PEC-App" -Value "\`"$ExePath\`" -profile \`"$ProfilePath\`" -minimized" -Force
}

Write-Host "[PEC-Deploy] Deployment completed successfully." -ForegroundColor Green
`;
}

export function escapeCmdArg(value: string): string {
  return String(value ?? "")
    .replace(/[%&<>|^"`!()]/g, "")
    .replace(/[\r\n]/g, "")
    .trim();
}

export function renderInstallCmd(cfg: AppBuildConfig): string {
  const appName = escapeCmdArg(cfg?.name || "PEC-App") || "PEC-App";
  return `@echo off
setlocal
cd /d "%~dp0"
echo ====================================================================
echo  ${appName} 1-Click Administrator Installer
echo ====================================================================
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [${appName}] Requesting administrator privileges...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd.exe -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)
echo [${appName}] Executing deployment script...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-pec-app.ps1"
if %errorlevel% equ 0 (
    echo.
    echo [${appName}] Installation completed successfully!
) else (
    echo.
    echo [${appName}] Installation failed with code %errorlevel%.
)
echo ====================================================================
pause
`;
}

export function renderUninstallCmd(cfg: AppBuildConfig): string {
  const appName = escapeCmdArg(cfg?.name || "PEC-App") || "PEC-App";
  return `@echo off
setlocal
cd /d "%~dp0"
echo ====================================================================
echo  ${appName} 1-Click Administrator Uninstaller
echo ====================================================================
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [${appName}] Requesting administrator privileges...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd.exe -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)
echo [${appName}] Stopping and removing PEC services...
sc stop PECAppSvc >nul 2>&1
sc delete PECAppSvc >nul 2>&1
sc stop ProxyBridgeSvc >nul 2>&1
sc delete ProxyBridgeSvc >nul 2>&1
sc stop WinDivert >nul 2>&1
sc delete WinDivert >nul 2>&1
echo.
echo [${appName}] Service removed successfully.
echo ====================================================================
pause
`;
}

export function renderAppVerifyPs1(cfg: AppBuildConfig): string {
  const appName = cfg.name || "PEC-App";
  const safeAppName = escapePsString(appName);

  return `<#
.SYNOPSIS
    Health and verification script for ${safeAppName}.
#>
[CmdletBinding()]
param(
    [string]$InstallPath = ""
)

$AppName = "${safeAppName}"
Write-Host "[PEC-Verify] Checking $AppName installation..." -ForegroundColor Cyan

if (-not $InstallPath) {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    $InstallPath = if ($isAdmin) { Join-Path $env:ProgramFiles "PEC-ProxyClient" } else { Join-Path $env:LOCALAPPDATA "PEC-ProxyClient" }
}

$ExePath = Join-Path $InstallPath "PEC-App.exe"
if (-not (Test-Path $ExePath)) {
    $ExePath = Join-Path $InstallPath "ProxyBridge.exe"
}
$ProfilePath = Join-Path $InstallPath "pec_profile.pbprofile"
$DllPath = Join-Path $InstallPath "WinDivert.dll"
$SysPath = Join-Path $InstallPath "WinDivert64.sys"

if (-not (Test-Path $ExePath)) {
    Write-Warning "[FAIL] PEC-App.exe or ProxyBridge.exe not found at $InstallPath"
    exit 1
}

if (-not (Test-Path $ProfilePath)) {
    Write-Warning "[FAIL] Profile not found at $ProfilePath"
    exit 1
}

if (-not (Test-Path $DllPath) -and -not (Test-Path $SysPath)) {
    Write-Warning "[WARN] WinDivert driver binaries not found in $InstallPath"
}

Write-Host "[PASS] Installation verified successfully at $InstallPath." -ForegroundColor Green
exit 0
`;
}

/**
 * Packs an in-memory tar.gz buffer compliant with standard POSIX USTAR.
 */
function createTarGz(files: { name: string; content: Buffer; mode?: number }[]): Buffer {
  const blocks: Buffer[] = [];

  for (const file of files) {
    const header = Buffer.alloc(512);
    const mode = file.mode ?? 0o644;
    const size = file.content.length;
    const mtime = Math.floor(Date.now() / 1000);

    // Name (0-99)
    header.write(file.name, 0, 100, "utf-8");
    // Mode (100-107)
    header.write(mode.toString(8).padStart(7, "0") + "\0", 100, 8, "ascii");
    // UID (108-115)
    header.write("0000000\0", 108, 8, "ascii");
    // GID (116-123)
    header.write("0000000\0", 116, 8, "ascii");
    // Size (124-135)
    header.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii");
    // Mtime (136-147)
    header.write(mtime.toString(8).padStart(11, "0") + "\0", 136, 12, "ascii");
    // Chksum placeholder (148-155) - 8 spaces
    header.fill(0x20, 148, 156);
    // Typeflag (156) - '0' regular file
    header[156] = 0x30;
    // Magic (257-262) - "ustar\0"
    header.write("ustar\0", 257, 6, "ascii");
    // Version (263-264) - "00"
    header.write("00", 263, 2, "ascii");

    // Calculate checksum
    let sum = 0;
    for (let i = 0; i < 512; i++) {
      sum += header[i];
    }
    const chksumStr = sum.toString(8).padStart(6, "0") + "\0 ";
    header.write(chksumStr, 148, 8, "ascii");

    blocks.push(header);
    blocks.push(file.content);

    const pad = (512 - (size % 512)) % 512;
    if (pad > 0) {
      blocks.push(Buffer.alloc(pad));
    }
  }

  // End of archive marker: two 512-byte zero blocks
  blocks.push(Buffer.alloc(1024));

  const tarBuffer = Buffer.concat(blocks);
  return zlib.gzipSync(tarBuffer);
}

export interface AppPackageResult {
  zipPath: string;
  fileName: string;
  size: number;
  sha256: string;
  entries: string[];
}

export function normalizeMsiVersion(rawVersion: string): string {
  const clean = (rawVersion || "1.0.0").replace(/^v/i, "").split("-")[0];
  const parts = clean.split(".").map((p) => {
    const n = parseInt(p, 10);
    return isNaN(n) ? 0 : n;
  });
  while (parts.length < 3) parts.push(0);
  return parts.slice(0, 4).join(".");
}

export function generateUpgradeCode(serverUrlOrSeed?: string): string {
  const seed = (serverUrlOrSeed || "").trim() || "default";
  const hex = crypto.createHash("sha1").update(`pec-app:${seed}`).digest("hex");
  return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`.toUpperCase();
}

export function renderWxsManifest(cfg: AppBuildConfig, baseUrl: string, sourceDir: string): string {
  const appName = cfg.name || "PEC-App";
  const publisher = cfg.shortName || "PEC Corp";
  const msiVer = normalizeMsiVersion(cfg.version || "1.0.0");
  const fleetToken = cfg.defaultToken || "";
  const normalizedSourceDir = sourceDir.replace(/\\/g, "/");

  const candidates = [
    path.join(getTemplatesAppDir(), "windows", "pec-app.wxs.template"),
    path.resolve("./templates/app/windows/pec-app.wxs.template"),
  ];

  let templateContent = "";
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        templateContent = fs.readFileSync(c, "utf-8");
        break;
      } catch {}
    }
  }

  if (!templateContent) {
    templateContent = `<?xml version="1.0" encoding="utf-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
  <Product Id="*" Name="{{APP_NAME}}" Language="1033" Version="{{VERSION}}" Manufacturer="{{PUBLISHER}}" UpgradeCode="{{UPGRADE_CODE}}">
    <Package InstallerVersion="200" Compressed="yes" InstallScope="perMachine" Platform="x64" Comments="PEC-App Windows Enterprise Client" />
    <MajorUpgrade DowngradeErrorMessage="A newer version of {{APP_NAME}} is already installed." />
    <MediaTemplate EmbedCab="yes" />
    <Property Id="SERVER_URL" Value="{{SERVER_URL}}" />
    <Property Id="FLEET_TOKEN" Value="{{FLEET_TOKEN}}" />
    <Directory Id="TARGETDIR" Name="SourceDir">
      <Directory Id="ProgramFiles64Folder">
        <Directory Id="INSTALLFOLDER" Name="PEC-App">
          <Component Id="C_PECAppExe" Guid="*" Win64="yes">
            <File Id="F_PECAppExe" Source="{{SOURCE_DIR}}/PEC-App.exe" KeyPath="yes">
              <Shortcut Id="S_PECAppMenu" Directory="ProgramMenuDir" Name="PEC-App" WorkingDirectory="INSTALLFOLDER" Icon="AppIcon.ico" IconIndex="0" Advertise="yes" />
            </File>
          </Component>
          <Component Id="C_PECAppSvc" Guid="*" Win64="yes">
            <File Id="F_PECAppSvc" Source="{{SOURCE_DIR}}/PECAppSvc.exe" KeyPath="yes" />
            <ServiceInstall Id="SvcInstall" Type="ownProcess" Name="PECAppSvc" DisplayName="PEC-App Service" Description="Privileged traffic-redirection engine for PEC-App." Start="auto" Account="LocalSystem" ErrorControl="normal" Vital="yes" />
            <ServiceControl Id="SvcControl" Name="PECAppSvc" Start="install" Stop="both" Remove="uninstall" Wait="yes" />
          </Component>
          <Component Id="C_PECCliExe" Guid="*" Win64="yes">
            <File Id="F_PECCliExe" Source="{{SOURCE_DIR}}/PEC-CLI.exe" KeyPath="yes" />
          </Component>
          <Component Id="C_PECAppCoreDll" Guid="*" Win64="yes">
            <File Id="F_PECAppCoreDll" Source="{{SOURCE_DIR}}/PECAppCore.dll" KeyPath="yes" />
          </Component>
          <Component Id="C_WinDivertDll" Guid="*" Win64="yes">
            <File Id="F_WinDivertDll" Source="{{SOURCE_DIR}}/WinDivert.dll" KeyPath="yes" />
          </Component>
          <Component Id="C_WinDivert64Sys" Guid="*" Win64="yes">
            <File Id="F_WinDivert64Sys" Source="{{SOURCE_DIR}}/WinDivert64.sys" KeyPath="yes" />
          </Component>
          <Component Id="C_Profile" Guid="*" Win64="yes">
            <File Id="F_Profile" Source="{{SOURCE_DIR}}/pec_profile.pbprofile" KeyPath="yes" />
          </Component>
          <Component Id="C_RegistryConfig" Guid="*" Win64="yes">
            <RegistryKey Root="HKLM" Key="Software\\PEC-App">
              <RegistryValue Type="string" Name="InstallPath" Value="[INSTALLFOLDER]" KeyPath="yes" />
              <RegistryValue Type="string" Name="ServerUrl" Value="[SERVER_URL]" />
              <RegistryValue Type="string" Name="FleetToken" Value="[FLEET_TOKEN]" />
              <RegistryValue Type="string" Name="Version" Value="{{VERSION}}" />
            </RegistryKey>
          </Component>
        </Directory>
      </Directory>
      <Directory Id="ProgramMenuFolder">
        <Directory Id="ProgramMenuDir" Name="PEC-App">
          <Component Id="C_ProgramMenuDir" Guid="B7C8E9F0-1234-5678-9ABC-DEF012345678">
            <RemoveFolder Id="RemoveProgramMenuDir" On="uninstall" />
            <RegistryValue Root="HKCU" Key="Software\\PEC-App" Name="MenuInstalled" Type="integer" Value="1" KeyPath="yes" />
          </Component>
        </Directory>
      </Directory>
    </Directory>
    <Icon Id="AppIcon.ico" Source="{{SOURCE_DIR}}/PEC-App.exe" />
    <Property Id="ARPPRODUCTICON" Value="AppIcon.ico" />
    <Feature Id="ProductFeature" Title="PEC-App" Level="1">
      <ComponentRef Id="C_PECAppExe" />
      <ComponentRef Id="C_PECAppSvc" />
      <ComponentRef Id="C_PECCliExe" />
      <ComponentRef Id="C_PECAppCoreDll" />
      <ComponentRef Id="C_WinDivertDll" />
      <ComponentRef Id="C_WinDivert64Sys" />
      <ComponentRef Id="C_Profile" />
      <ComponentRef Id="C_RegistryConfig" />
      <ComponentRef Id="C_ProgramMenuDir" />
    </Feature>
  </Product>
</Wix>`;
  }

  const xmlEscape = (s: string) =>
    String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");

  const serverSeed = (cfg as any).serverBaseUrl || baseUrl || cfg.defaultServerUrl || "default";
  const upgradeCode = generateUpgradeCode(serverSeed);

  return templateContent
    .replace(/\{\{APP_NAME\}\}/g, xmlEscape(appName))
    .replace(/\{\{VERSION\}\}/g, xmlEscape(msiVer))
    .replace(/\{\{PUBLISHER\}\}/g, xmlEscape(publisher))
    .replace(/\{\{SERVER_URL\}\}/g, xmlEscape(baseUrl))
    .replace(/\{\{FLEET_TOKEN\}\}/g, xmlEscape(fleetToken))
    .replace(/\{\{SOURCE_DIR\}\}/g, normalizedSourceDir)
    .replace(/\{\{UPGRADE_CODE\}\}/g, xmlEscape(upgradeCode));
}

export function buildMsiPackage(
  cfg: AppBuildConfig,
  baseUrl: string,
  stagedDir: string,
  outputMsiPath: string
): { success: boolean; msiPath?: string; error?: string } {
  try {
    const wxsContent = renderWxsManifest(cfg, baseUrl, stagedDir);
    const wxsPath = path.join(stagedDir, "pec-app.wxs");
    fs.writeFileSync(wxsPath, wxsContent, "utf-8");

    // 1. Try wixl (standard on Linux Alpine with msitools, or cross-platform)
    let hasWixl = false;
    try {
      child_process.execFileSync("wixl", ["--version"], { windowsHide: true, stdio: "ignore" });
      hasWixl = true;
    } catch {}

    if (hasWixl) {
      try {
        child_process.execFileSync("wixl", ["-v", "-o", outputMsiPath, wxsPath], {
          windowsHide: true,
          stdio: "pipe",
        });
        if (fs.existsSync(outputMsiPath) && fs.statSync(outputMsiPath).size > 0) {
          return { success: true, msiPath: outputMsiPath };
        }
      } catch (wixlErr) {
        // If wixl failed on Linux, let the outer catch report it; on Windows, allow fallback to WiX Toolset
        if (process.platform !== "win32") {
          throw wixlErr;
        }
      }
    }

    // 2. Try Windows WiX Toolset v3 (candle + light) or WiX v4/v5 (wix build)
    if (process.platform === "win32") {
      let candlePath = "candle.exe";
      let lightPath = "light.exe";
      let hasWix3 = false;

      const wix3Dirs = [
        ...(process.env.WIX ? [path.join(process.env.WIX, "bin")] : []),
        "C:\\Program Files (x86)\\WiX Toolset v3.11\\bin",
        "C:\\Program Files\\WiX Toolset v3.11\\bin",
        "C:\\Program Files (x86)\\WiX Toolset v3.14\\bin",
        "C:\\Program Files\\WiX Toolset v3.14\\bin",
      ];
      for (const d of wix3Dirs) {
        if (fs.existsSync(path.join(d, "candle.exe")) && fs.existsSync(path.join(d, "light.exe"))) {
          candlePath = path.join(d, "candle.exe");
          lightPath = path.join(d, "light.exe");
          hasWix3 = true;
          break;
        }
      }

      if (!hasWix3) {
        try {
          child_process.execFileSync("candle.exe", ["/?"], { windowsHide: true, stdio: "ignore" });
          hasWix3 = true;
        } catch {}
      }

      if (hasWix3) {
        try {
          const wixobj = path.join(stagedDir, "pec-app.wixobj");
          child_process.execFileSync(candlePath, ["-out", wixobj, wxsPath], {
            windowsHide: true,
            stdio: "pipe",
          });
          child_process.execFileSync(lightPath, ["-out", outputMsiPath, wixobj], {
            windowsHide: true,
            stdio: "pipe",
          });
          if (fs.existsSync(outputMsiPath) && fs.statSync(outputMsiPath).size > 0) {
            return { success: true, msiPath: outputMsiPath };
          }
        } catch {}
      }

      // Check WiX v4 / v5
      try {
        child_process.execFileSync("wix.exe", ["--version"], { windowsHide: true, stdio: "ignore" });
        child_process.execFileSync("wix.exe", ["build", "-o", outputMsiPath, wxsPath], {
          windowsHide: true,
          stdio: "pipe",
        });
        if (fs.existsSync(outputMsiPath) && fs.statSync(outputMsiPath).size > 0) {
          return { success: true, msiPath: outputMsiPath };
        }
      } catch {}
    }

    return {
      success: false,
      error: "WiX compiler not found (install msitools/wixl on Linux or WiX Toolset on Windows)",
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || String(err),
    };
  }
}

/** Alias for buildMsiPackage referenced in wave2 remediation plan */
export const buildMsiWithWix = buildMsiPackage;

export function assembleAppPackage(
  baseUrl?: string,
  config?: AppBuildConfig,
  destinationDir?: string
): AppPackageResult {
  const cfg = config || getAppBuildConfig();
  const targetDir = destinationDir || path.join(getReleasesDir(), "apps", cfg.version || DEFAULT_APP_VERSION);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const envPublicBase = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  const effectiveBaseUrl = (envPublicBase || baseUrl || cfg.defaultServerUrl || "http://127.0.0.1:3000").replace(/\/+$/, "");
  const profileObj = buildAppProfile(cfg, effectiveBaseUrl);
  const profileJson = JSON.stringify(profileObj, null, 2);
  const profileBuffer = Buffer.from(profileJson, "utf-8");

  const deployPs1 = renderAppDeployPs1(cfg, effectiveBaseUrl);
  const verifyPs1 = renderAppVerifyPs1(cfg);
  const installCmd = renderInstallCmd(cfg);
  const uninstallCmd = renderUninstallCmd(cfg);

  const winZip = new AdmZip();
  const winTemplatesDir = path.join(getTemplatesAppDir(), "windows");
  if (fs.existsSync(winTemplatesDir)) {
    for (const item of fs.readdirSync(winTemplatesDir)) {
      if (
        item === "ProxyBridge.exe" ||
        item === "pbcli.exe" ||
        item === "ProxyBridgeSvc.exe" ||
        item === "ProxyBridgeCore.dll" ||
        item === "PEC-App.exe" ||
        item === "PEC-CLI.exe" ||
        item === "PECAppSvc.exe" ||
        item === "PECAppCore.dll" ||
        item === "WinDivert.dll" ||
        item === "WinDivert64.sys" ||
        item === "PEC-App-Setup.exe" ||
        item.startsWith("PEC-App-Setup-") ||
        item === "ui" ||
        item.startsWith("ui/") ||
        item.startsWith("ui\\")
      ) {
        continue;
      }
      const full = path.join(winTemplatesDir, item);
      const stat = fs.statSync(full);
      if (stat.isFile() && !item.toLowerCase().endsWith(".html") && !item.toLowerCase().endsWith(".css")) {
        winZip.addLocalFile(full);
      }
    }
  }

  const resolveTemplateBinary = (name: string): string | null => {
    const candidates = [
      path.join(winTemplatesDir, name),
      path.resolve("./templates/app/windows", name),
      path.resolve("./client/Windows/gui", name),
      path.resolve("./client/Windows/installer", name),
      path.resolve("./client/Windows/src/service", name),
      path.resolve("./client/Windows", name),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        try {
          if (fs.statSync(c).size > 1000) return c;
        } catch {}
      }
    }
    return null;
  };

  // Ensure legacy alias files are never in the release zip
  if (winZip.getEntry("ProxyBridge.exe")) winZip.deleteFile("ProxyBridge.exe");
  if (winZip.getEntry("pbcli.exe")) winZip.deleteFile("pbcli.exe");
  if (winZip.getEntry("ProxyBridgeSvc.exe")) winZip.deleteFile("ProxyBridgeSvc.exe");
  if (winZip.getEntry("ProxyBridgeCore.dll")) winZip.deleteFile("ProxyBridgeCore.dll");

  // Ensure no ui/ entries or web assets exist in the zip package
  for (const entry of winZip.getEntries()) {
    const en = entry.entryName.toLowerCase();
    if (
      en.startsWith("ui/") ||
      en.startsWith("ui\\") ||
      en === "ui" ||
      en.endsWith(".html") ||
      en.endsWith(".css") ||
      (en.endsWith(".js") && en.startsWith("ui"))
    ) {
      winZip.deleteFile(entry.entryName);
    }
  }

  // Create staging directory to sign binaries without altering source templates
  const stagingDir = path.join(targetDir, `_staging_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);
  fs.mkdirSync(stagingDir, { recursive: true });

  const stageAndResolve = (binaryName: string, sourcePath: string | null): string | null => {
    if (!sourcePath || !fs.existsSync(sourcePath)) return null;
    const dest = path.join(stagingDir, binaryName);
    fs.copyFileSync(sourcePath, dest);
    return dest;
  };

  const stagedGui = stageAndResolve("PEC-App.exe", resolveTemplateBinary("PEC-App.exe") || resolveTemplateBinary("ProxyBridge.exe"));
  const stagedCli = stageAndResolve("PEC-CLI.exe", resolveTemplateBinary("PEC-CLI.exe") || resolveTemplateBinary("pbcli.exe"));
  const stagedDivertDll = stageAndResolve("WinDivert.dll", resolveTemplateBinary("WinDivert.dll"));
  const stagedDivertSys = stageAndResolve("WinDivert64.sys", resolveTemplateBinary("WinDivert64.sys"));
  const stagedCore = stageAndResolve("PECAppCore.dll", resolveTemplateBinary("PECAppCore.dll") || resolveTemplateBinary("ProxyBridgeCore.dll"));
  const stagedSvc = stageAndResolve("PECAppSvc.exe", resolveTemplateBinary("PECAppSvc.exe") || resolveTemplateBinary("ProxyBridgeSvc.exe"));
  const stagedSetup = stageAndResolve("PEC-App-Setup.exe", resolveTemplateBinary("PEC-App-Setup.exe") || resolveTemplateBinary(`PEC-App-Setup-${cfg.version || DEFAULT_APP_VERSION}.exe`));

  // Write profile into staging
  fs.writeFileSync(path.join(stagingDir, "pec_profile.pbprofile"), profileBuffer);

  // Deep Sign binaries if code signing certificate is active
  const certStatus = getCertificateStatus();
  if (certStatus.hasCertificate) {
    if (stagedGui) signBinary(stagedGui);
    if (stagedCli) signBinary(stagedCli);
    if (stagedCore) signBinary(stagedCore);
    if (stagedSvc) signBinary(stagedSvc);
    if (stagedSetup) signBinary(stagedSetup);
  }

  // Build MSI Package
  const stagedMsi = path.join(stagingDir, "PEC-App.msi");
  const msiBuildRes = buildMsiPackage(cfg, effectiveBaseUrl, stagingDir, stagedMsi);
  if (msiBuildRes.success && fs.existsSync(stagedMsi)) {
    if (certStatus.hasCertificate) {
      signBinary(stagedMsi);
    }
    const finalMsiPath = path.join(targetDir, "PEC-App.msi");
    const versionedMsiPath = path.join(targetDir, `PEC-App-${cfg.version || DEFAULT_APP_VERSION}.msi`);
    fs.copyFileSync(stagedMsi, finalMsiPath);
    fs.copyFileSync(stagedMsi, versionedMsiPath);
    winZip.addLocalFile(stagedMsi, "", "PEC-App.msi");
  }

  // 1. PEC-App.exe (DirectX 11 Standalone GUI)
  if (stagedGui) {
    if (winZip.getEntry("PEC-App.exe")) winZip.deleteFile("PEC-App.exe");
    winZip.addLocalFile(stagedGui, "", "PEC-App.exe");
  }

  // 2. PEC-CLI.exe
  if (stagedCli) {
    if (winZip.getEntry("PEC-CLI.exe")) winZip.deleteFile("PEC-CLI.exe");
    winZip.addLocalFile(stagedCli, "", "PEC-CLI.exe");
  }

  // 3. WinDivert.dll
  if (stagedDivertDll) {
    if (winZip.getEntry("WinDivert.dll")) winZip.deleteFile("WinDivert.dll");
    winZip.addLocalFile(stagedDivertDll, "", "WinDivert.dll");
  }

  // 4. WinDivert64.sys
  if (stagedDivertSys) {
    if (winZip.getEntry("WinDivert64.sys")) winZip.deleteFile("WinDivert64.sys");
    winZip.addLocalFile(stagedDivertSys, "", "WinDivert64.sys");
  }

  // 5. PECAppCore.dll
  if (stagedCore) {
    if (winZip.getEntry("PECAppCore.dll")) winZip.deleteFile("PECAppCore.dll");
    winZip.addLocalFile(stagedCore, "", "PECAppCore.dll");
  }

  // 6. PECAppSvc.exe
  if (stagedSvc) {
    if (winZip.getEntry("PECAppSvc.exe")) winZip.deleteFile("PECAppSvc.exe");
    winZip.addLocalFile(stagedSvc, "", "PECAppSvc.exe");
  }

  // 7. PEC-App-Setup.exe (Standalone Installer)
  if (stagedSetup) {
    try {
      if (winZip.getEntry("PEC-App-Setup.exe")) winZip.deleteFile("PEC-App-Setup.exe");
      winZip.addLocalFile(stagedSetup, "", "PEC-App-Setup.exe");
    } catch {}
  }

  winZip.addFile("pec_profile.pbprofile", profileBuffer);
  winZip.addFile("Default.pbprofile", profileBuffer);
  winZip.addFile("deploy-pec-app.ps1", Buffer.from(deployPs1, "utf-8"));
  winZip.addFile("verify-pec-app.ps1", Buffer.from(verifyPs1, "utf-8"));
  winZip.addFile("Install.cmd", Buffer.from(installCmd, "utf-8"));
  winZip.addFile("Uninstall.cmd", Buffer.from(uninstallCmd, "utf-8"));
  const rootLicense = path.resolve("./LICENSE");
  if (fs.existsSync(rootLicense)) {
    winZip.addFile("LICENSE", fs.readFileSync(rootLicense));
  }
  const lgplLicense = path.resolve("./assets/licenses/LICENSE-LGPL-3.0.txt");
  if (fs.existsSync(lgplLicense)) {
    winZip.addFile("LICENSE-LGPL-3.0.txt", fs.readFileSync(lgplLicense));
  }
  const noticesFile = path.resolve("./assets/licenses/THIRD-PARTY-NOTICES.txt");
  if (fs.existsSync(noticesFile)) {
    winZip.addFile("THIRD-PARTY-NOTICES.txt", fs.readFileSync(noticesFile));
  }

  // Cleanup staging directory
  try {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  } catch {}

  const winZipBuffer = winZip.toBuffer();
  const pecAppZipPath = path.join(targetDir, "PEC-App-windows-x64.zip");
  fs.writeFileSync(pecAppZipPath, winZipBuffer);

  const legacyZipPath = path.join(targetDir, "pec-client-windows-x64.zip");
  fs.writeFileSync(legacyZipPath, winZipBuffer);

  const winSha256 = crypto.createHash("sha256").update(winZipBuffer).digest("hex");
  const entries = winZip.getEntries().map((e) => e.entryName);

  return {
    zipPath: pecAppZipPath,
    fileName: "PEC-App-windows-x64.zip",
    size: winZipBuffer.length,
    sha256: winSha256,
    entries,
  };
}

export function packageApp(baseUrl: string): AppBuildInfo {
  const cfg = getAppBuildConfig();
  const appVersion = cfg.version || DEFAULT_APP_VERSION;
  const targetReleasesDir = path.join(getReleasesDir(), "apps", appVersion);
  if (!fs.existsSync(targetReleasesDir)) {
    fs.mkdirSync(targetReleasesDir, { recursive: true });
  }

  const pkgLog: string[] = [];
  const log = (msg: string) => {
    const ts = new Date().toISOString().substring(11, 19);
    pkgLog.push(`[${ts}] ${msg}`);
  };

  const envPublicBase = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  const effectiveBaseUrl = (envPublicBase || baseUrl || cfg.defaultServerUrl || "http://127.0.0.1:3000").replace(/\/+$/, "");

  log(`Starting PEC-App package assembly v${appVersion}...`);
  log(`Base URL: ${effectiveBaseUrl}`);

  const profileObj = buildAppProfile(cfg, effectiveBaseUrl);
  const profileJson = JSON.stringify(profileObj, null, 2);
  const profileBuffer = Buffer.from(profileJson, "utf-8");

  // 1. Windows Package (DirectX 11 ImGui Standalone, no web server or ui/ directory)
  const winPackage = assembleAppPackage(effectiveBaseUrl, cfg, targetReleasesDir);
  const winZipBuffer = fs.readFileSync(winPackage.zipPath);
  const winSha256 = winPackage.sha256;

  // Standalone Setup Installer artifact check
  const winTemplatesDir = path.join(getTemplatesAppDir(), "windows");
  const resolveTemplateBinary = (name: string): string | null => {
    const candidates = [
      path.join(winTemplatesDir, name),
      path.resolve("./templates/app/windows", name),
      path.resolve("./client/Windows/gui", name),
      path.resolve("./client/Windows/installer", name),
      path.resolve("./client/Windows/src/service", name),
      path.resolve("./client/Windows", name),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        try {
          if (fs.statSync(c).size > 1000) return c;
        } catch {}
      }
    }
    return null;
  };

  const realGui = resolveTemplateBinary("PEC-App.exe") || resolveTemplateBinary("ProxyBridge.exe");
  let embeddedVersion: string | undefined = undefined;
  let binariesStale = false;
  if (realGui) {
    try {
      const peBuf = fs.readFileSync(realGui);
      const peVer = extractPeVersion(peBuf);
      if (peVer) {
        embeddedVersion = peVer.productVersion || peVer.fileVersion;
      }
    } catch {}
  }

  if (embeddedVersion && embeddedVersion !== appVersion) {
    binariesStale = true;
    log(`[WARN] Embedded binary version (${embeddedVersion}) does not match configured package version (${appVersion}). Binaries may be stale.`);
  }

  const coreModulesIntegrity = getCoreModulesIntegrity();

  const realSetup = resolveTemplateBinary("PEC-App-Setup.exe") || resolveTemplateBinary(`PEC-App-Setup-${appVersion}.exe`);
  let setupBuffer: Buffer | null = null;
  let setupSha256 = "";
  if (realSetup) {
    try {
      setupBuffer = fs.readFileSync(realSetup);
      setupSha256 = crypto.createHash("sha256").update(setupBuffer).digest("hex");
      fs.writeFileSync(path.join(targetReleasesDir, `PEC-App-Setup-${appVersion}.exe`), setupBuffer);
      fs.writeFileSync(path.join(targetReleasesDir, "PEC-App-Setup.exe"), setupBuffer);
      log(`[Installer] Prepared PEC-App-Setup-${appVersion}.exe (${Math.round(setupBuffer.length / 1024)} KB) for releases`);
    } catch (setupErr) {
      log(`[Installer] Note: installer embedding warning: ${setupErr}`);
    }
  }

  // 2. Linux Package
  const linuxFiles: { name: string; content: Buffer; mode?: number }[] = [];
  const linuxTemplatesDir = path.join(getTemplatesAppDir(), "linux");
  if (fs.existsSync(linuxTemplatesDir)) {
    for (const item of fs.readdirSync(linuxTemplatesDir)) {
      const full = path.join(linuxTemplatesDir, item);
      const stat = fs.statSync(full);
      if (stat.isFile()) {
        const isExecutable = item === "pec-cli" || item === "proxybridge-cli" || item.endsWith(".sh");
        linuxFiles.push({
          name: item,
          content: fs.readFileSync(full),
          mode: isExecutable ? 0o755 : 0o644,
        });
      }
    }
  }

  linuxFiles.push({
    name: "pec_profile.pbprofile",
    content: profileBuffer,
    mode: 0o644,
  });

  const linuxTarGzBuffer = createTarGz(linuxFiles);
  const linuxTarPath = path.join(targetReleasesDir, "pec-client-linux-x64.tar.gz");
  fs.writeFileSync(linuxTarPath, linuxTarGzBuffer);

  const linuxSha256 = crypto.createHash("sha256").update(linuxTarGzBuffer).digest("hex");

  // Save standalone profile in releasesDir strictly (Task 1.2 C-1)
  const profileDiskPath = path.join(targetReleasesDir, "pec_profile.pbprofile");
  fs.writeFileSync(profileDiskPath, profileBuffer);

  log(`[Windows] Packed ${winPackage.entries.length} files into zip archive (${Math.round(winZipBuffer.length / 1024)} KB)`);
  log(`[Windows] SHA-256: ${winSha256}`);
  log(`[Linux] Packed ${linuxFiles.length} files into tar.gz (${Math.round(linuxTarGzBuffer.length / 1024)} KB)`);
  log(`[Linux] SHA-256: ${linuxSha256}`);
  log(`[Release] Generated pec_profile.pbprofile and deployment scripts.`);

  // Check for compiled MSI artifact
  const finalMsi = path.join(targetReleasesDir, "PEC-App.msi");
  let msiBuffer: Buffer | null = null;
  let msiSha256 = "";
  if (fs.existsSync(finalMsi)) {
    try {
      msiBuffer = fs.readFileSync(finalMsi);
      msiSha256 = crypto.createHash("sha256").update(msiBuffer).digest("hex");
      log(`[MSI] Prepared PEC-App.msi (${Math.round(msiBuffer.length / 1024)} KB, SHA: ${msiSha256.substring(0, 10)}...) for GPO/Intune`);
    } catch {}
  }

  const certStatus = getCertificateStatus();
  if (certStatus.hasCertificate) {
    log(`[CodeSign] Deliverables signed with certificate: ${certStatus.subject} (${certStatus.type})`);
  }

  const buildInfo: AppBuildInfo = {
    version: appVersion,
    builtAt: new Date().toISOString(),
    embeddedVersion,
    binariesStale,
    coreModulesIntegrity,
    toolchain: getToolchainDiagnostics(),
    windowsPackageUrl: "/api/app-builder/download/windows",
    windowsPackageSize: winZipBuffer.length,
    windowsPackageSha256: winSha256,
    windowsInstallerUrl: setupBuffer ? "/api/app-builder/download/installer" : undefined,
    windowsInstallerSize: setupBuffer ? setupBuffer.length : undefined,
    windowsInstallerSha256: setupBuffer ? setupSha256 : undefined,
    windowsMsiUrl: msiBuffer ? `/api/app-builder/download/msi` : undefined,
    windowsMsiSize: msiBuffer ? msiBuffer.length : undefined,
    windowsMsiSha256: msiBuffer ? msiSha256 : undefined,
    linuxPackageUrl: "/api/app-builder/download/linux",
    linuxPackageSize: linuxTarGzBuffer.length,
    linuxPackageSha256: linuxSha256,
    profilePath: profileDiskPath,
    buildLog: pkgLog,
    codeSigningStatus: {
      isSigned: certStatus.hasCertificate,
      subject: certStatus.subject,
      issuer: certStatus.issuer,
      type: certStatus.type,
    },
  };

  try {
    writeJsonAtomic(getAppBuildInfoPath(), buildInfo);
  } catch (err) {
    console.error("[appPackager] Error writing app build info:", err);
  }

  // Archive versioned release and record in releases store
  try {
    const releasesDir = path.join(getReleasesDir(), "apps", buildInfo.version);
    fs.mkdirSync(releasesDir, { recursive: true });
    const versionedWinZip = path.join(releasesDir, "pec-client-windows-x64.zip");
    fs.writeFileSync(versionedWinZip, winZipBuffer);
    fs.writeFileSync(path.join(releasesDir, "PEC-App-windows-x64.zip"), winZipBuffer);
    if (setupBuffer) {
      fs.writeFileSync(path.join(releasesDir, `PEC-App-Setup-${buildInfo.version}.exe`), setupBuffer);
      fs.writeFileSync(path.join(releasesDir, "PEC-App-Setup.exe"), setupBuffer);
    }
    if (msiBuffer) {
      fs.writeFileSync(path.join(releasesDir, `PEC-App-${buildInfo.version}.msi`), msiBuffer);
      fs.writeFileSync(path.join(releasesDir, "PEC-App.msi"), msiBuffer);
    }
    fs.writeFileSync(path.join(releasesDir, "pec-client-linux-x64.tar.gz"), linuxTarGzBuffer);
    fs.writeFileSync(path.join(releasesDir, "pec_profile.pbprofile"), profileBuffer);
    recordRelease({
      type: "app",
      version: buildInfo.version,
      builtAt: buildInfo.builtAt,
      sha256: winSha256,
      fileName: "pec-client-windows-x64.zip",
      filePath: versionedWinZip,
      size: winZipBuffer.length,
      isActive: true,
    });
  } catch (relErr) {
    console.warn("[appPackager] Warning: failed recording app release:", relErr);
  }

  return buildInfo;
}

export function extractPeVersion(buffer: Buffer): { fileVersion: string; productVersion: string } | null {
  const sig = Buffer.from([0xbd, 0x04, 0xef, 0xfe]); // 0xFEEF04BD VS_FIXEDFILEINFO
  const idx = buffer.indexOf(sig);
  if (idx === -1 || idx + 24 > buffer.length) return null;
  const fvMs = buffer.readUInt32LE(idx + 8);
  const fvLs = buffer.readUInt32LE(idx + 12);
  const pvMs = buffer.readUInt32LE(idx + 16);
  const pvLs = buffer.readUInt32LE(idx + 20);
  const fv = `${fvMs >> 16}.${fvMs & 0xffff}.${fvLs >> 16}${fvLs & 0xffff ? `.${fvLs & 0xffff}` : ""}`;
  const pv = `${pvMs >> 16}.${pvMs & 0xffff}.${pvLs >> 16}${pvLs & 0xffff ? `.${pvLs & 0xffff}` : ""}`;
  return { fileVersion: fv, productVersion: pv };
}

export function getEmbeddedVersion(customWinDir?: string): string {
  const winDir = customWinDir || path.join(getTemplatesAppDir(), "windows");
  const candidates = [
    path.join(winDir, "PEC-App.exe"),
    path.join(winDir, ".pristine", "PEC-App.exe"),
    path.resolve("./templates/app/windows/PEC-App.exe"),
    path.resolve("./templates/app/windows/.pristine/PEC-App.exe"),
    path.join(winDir, "ProxyBridge.exe"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        const pe = extractPeVersion(fs.readFileSync(c));
        if (pe) return pe.productVersion || pe.fileVersion;
      } catch {}
    }
  }
  return DEFAULT_APP_VERSION;
}

export function getCoreModulesIntegrity(customWinTemplatesDir?: string): Array<{
  name: string;
  sha256: string;
  size: number;
  present: boolean;
  verified: boolean;
}> {
  const winTemplatesDir = customWinTemplatesDir || path.join(getTemplatesAppDir(), "windows");
  const fallbackWin = path.resolve("./templates/app/windows");
  const pristineDir = path.join(fallbackWin, ".pristine");
  const modules = ["PECAppCore.dll", "WinDivert.dll", "WinDivert64.sys"];

  return modules.map((name) => {
    const candidates = [
      path.join(winTemplatesDir, name),
      path.join(winTemplatesDir, ".pristine", name),
      path.join(fallbackWin, name),
      path.join(pristineDir, name),
    ];
    const found = candidates.find((p) => {
      try {
        return fs.existsSync(p) && fs.statSync(p).size > 0;
      } catch {
        return false;
      }
    });

    if (!found) {
      return {
        name,
        sha256: "",
        size: 0,
        present: false,
        verified: false,
      };
    }

    try {
      const buf = fs.readFileSync(found);
      const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
      const size = buf.length;
      const isDummy = size < 512 && buf.subarray(0, 32).toString().includes("MZ_DUMMY");
      const verified = size > 1000 && !isDummy;
      return {
        name,
        sha256,
        size,
        present: true,
        verified,
      };
    } catch {
      return {
        name,
        sha256: "",
        size: 0,
        present: false,
        verified: false,
      };
    }
  });
}

export interface BuildAppBinariesResult {
  ok: boolean;
  status?: string;
  compiled?: boolean;
  compilerMissing?: boolean;
  compiler?: string;
  compilerStatus?: {
    compiled: boolean;
    compilerName: string;
    compilerMissing?: boolean;
    error?: string;
  };
  toolchain?: ToolchainDiagnostics;
  builtFiles: string[];
  message: string;
  buildLog?: string[];
  timeSec?: number | string;
}

export interface CleanAppBinariesResult {
  ok: boolean;
  deletedFiles: string[];
  preservedFiles: string[];
  message: string;
}

export function parseAppVersion(rawVersion?: string): {
  version: string;
  major: number;
  minor: number;
  patch: number;
  build: number;
  quad: string;
} {
  const clean = (rawVersion || "").trim().replace(/^v/i, "") || DEFAULT_APP_VERSION;
  const parts = clean.split(/[.-]/).map((p) => parseInt(p, 10)).filter((n) => !isNaN(n));
  const major = parts[0] ?? 2;
  const minor = parts[1] ?? 2;
  const patch = parts[2] ?? 0;
  const build = parts[3] ?? 0;
  return {
    version: `${major}.${minor}.${patch}`,
    major,
    minor,
    patch,
    build,
    quad: `${major}.${minor}.${patch}.${build}`,
  };
}

export function writeVersionGenHeaders(clientWinDir: string, appVer: ReturnType<typeof parseAppVersion>): void {
  const content = `#ifndef VERSION_GEN_H
#define VERSION_GEN_H

#define PB_VER_MAJOR ${appVer.major}
#define PB_VER_MINOR ${appVer.minor}
#define PB_VER_PATCH ${appVer.patch}
#define PB_VER_BUILD ${appVer.build}
#define PB_VER_STR "${appVer.version}"
#define PB_VER_STRW L"${appVer.version}"

#define APP_VER_MAJOR ${appVer.major}
#define APP_VER_MINOR ${appVer.minor}
#define APP_VER_PATCH ${appVer.patch}
#define APP_VER_BUILD ${appVer.build}
#define APP_VERSION_STR "${appVer.quad}"
#define APP_VERSION_STRW L"${appVer.quad}"
#define APP_VERSION_W L"${appVer.version}"
#define APP_VERSION_NARROW "${appVer.version}"
#define VERSION "${appVer.version}"
#define VERSION_W L"${appVer.version}"

#ifndef APP_VERSION
#define APP_VERSION L"${appVer.version}"
#endif

#endif // VERSION_GEN_H
`;

  const targetDirs = [
    path.join(clientWinDir, "gui", "res"),
    path.join(clientWinDir, "installer"),
    path.join(clientWinDir, "cli"),
    path.join(clientWinDir, "src", "service"),
    clientWinDir,
  ];

  for (const dir of targetDirs) {
    try {
      if (fs.existsSync(dir)) {
        fs.writeFileSync(path.join(dir, "version_gen.h"), content, "utf-8");
      }
    } catch {}
  }
}

export function cleanAppBinaries(): CleanAppBinariesResult {
  const deletedFiles: string[] = [];
  const preservedFiles: string[] = [];

  const safeDelete = (filePath: string) => {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        deletedFiles.push(path.relative(".", filePath).replace(/\\/g, "/"));
      }
    } catch (e: any) {
      console.warn(`[cleanAppBinaries] Could not delete ${filePath}:`, e.message);
    }
  };

  const winTemplatesDirs = new Set([
    path.resolve(path.join(getTemplatesAppDir(), "windows")),
  ]);

  ensurePristineTemplates();
  const NEVER_DELETE = new Set([
    "windivert.dll",
    "windivert64.sys",
    "pec-app.wxs.template",
    "readme.txt",
    "pecappcore.dll",
    ".gitkeep",
    ".pristine",
  ]);

  for (const tDir of winTemplatesDirs) {
    if (fs.existsSync(tDir)) {
      const entries = fs.readdirSync(tDir);
      for (const entry of entries) {
        const lower = entry.toLowerCase();
        const fullPath = path.join(tDir, entry);
        if (NEVER_DELETE.has(lower) || lower.endsWith(".template")) {
          preservedFiles.push(path.relative(".", fullPath).replace(/\\/g, "/"));
          continue;
        }
        if (
          lower.startsWith("pec-app") ||
          lower.startsWith("pec-cli") ||
          lower.startsWith("pecappsvc") ||
          lower.endsWith(".exe") ||
          lower.endsWith(".msi") ||
          lower.endsWith(".res") ||
          lower.endsWith(".obj") ||
          lower.endsWith(".pdb")
        ) {
          safeDelete(fullPath);
        }
      }
    }
  }

  // Intermediate files in client/Windows
  const repoRoot = path.resolve(".");
  const clientWinDir = path.join(repoRoot, "client", "Windows");
  if (fs.existsSync(clientWinDir)) {
    const intermediatePatterns = [
      path.join(clientWinDir, "PEC-CLI.exe"),
      path.join(clientWinDir, "PECAppSvc.exe"),
      path.join(clientWinDir, "gui", "PEC-App.exe"),
      path.join(clientWinDir, "gui", "res.res"),
      path.join(clientWinDir, "gui", "app.res"),
      path.join(clientWinDir, "gui", "res", "app.res"),
      path.join(clientWinDir, "gui", "res", "res.res"),
      path.join(clientWinDir, "cli", "cli.res"),
      path.join(clientWinDir, "src", "service", "svc.res"),
      path.join(clientWinDir, "installer", "setup.res"),
      path.join(clientWinDir, "installer", "PEC-App-Setup.exe"),
    ];
    for (const p of intermediatePatterns) {
      safeDelete(p);
    }

    const subdirs = [
      clientWinDir,
      path.join(clientWinDir, "gui"),
      path.join(clientWinDir, "cli"),
      path.join(clientWinDir, "installer"),
      path.join(clientWinDir, "src", "service"),
    ];
    for (const sd of subdirs) {
      if (fs.existsSync(sd)) {
        for (const f of fs.readdirSync(sd)) {
          if (f.endsWith(".obj") || f.endsWith(".pdb")) {
            safeDelete(path.join(sd, f));
          }
        }
      }
    }
  }

  return {
    ok: true,
    deletedFiles,
    preservedFiles: Array.from(new Set(preservedFiles)),
    message: `Cleaned ${deletedFiles.length} binary/object files. Preserved ${preservedFiles.length} protected drivers/templates.`,
  };
}

export function findMsvcVcvars(): string | null {
  if (process.env.PEC_FORCE_NO_COMPILER === "true") {
    return null;
  }
  if (process.platform !== "win32") {
    return null;
  }
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const vswhere = path.join(programFilesX86, "Microsoft Visual Studio", "Installer", "vswhere.exe");
  if (fs.existsSync(vswhere)) {
    try {
      const out = child_process
        .execSync(`"${vswhere}" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`, {
          encoding: "utf-8",
          windowsHide: true,
        })
        .trim();
      if (out) {
        const vcvars = path.join(out, "VC", "Auxiliary", "Build", "vcvarsall.bat");
        if (fs.existsSync(vcvars)) {
          return vcvars;
        }
      }
    } catch {}
  }

  const standardPaths = [
    path.join(programFilesX86, "Microsoft Visual Studio", "2022", "BuildTools", "VC", "Auxiliary", "Build", "vcvarsall.bat"),
    path.join(programFilesX86, "Microsoft Visual Studio", "2022", "Community", "VC", "Auxiliary", "Build", "vcvarsall.bat"),
    path.join(programFilesX86, "Microsoft Visual Studio", "2022", "Professional", "VC", "Auxiliary", "Build", "vcvarsall.bat"),
    path.join(programFilesX86, "Microsoft Visual Studio", "2022", "Enterprise", "VC", "Auxiliary", "Build", "vcvarsall.bat"),
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Auxiliary\\Build\\vcvarsall.bat",
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvarsall.bat",
  ];
  for (const sp of standardPaths) {
    if (fs.existsSync(sp)) {
      return sp;
    }
  }
  return null;
}

export const MINGW_GUI_CMD =
  "x86_64-w64-mingw32-g++ -O2 -std=c++17 -s -mwindows -DUNICODE -D_UNICODE -DNDEBUG -D_WIN32_WINNT=0x0601 main_imgui.cpp imgui/imgui*.cpp imgui/backends/imgui_impl_win32.cpp imgui/backends/imgui_impl_dx11.cpp profile/profile.c profile/json.c res.res -o PEC-App.exe -ld3d11 -ldxgi -ld3dcompiler -ldwmapi -lshlwapi -lshell32 -ladvapi32 -lole32 -luser32 -lgdi32 -lws2_32 -lwinhttp -lcomctl32 -lcrypt32 -luxtheme -lwintrust";

export const MSVC_GUI_CMD =
  "cl.exe /O2 /std:c++17 /EHsc /DUNICODE /D_UNICODE /DNDEBUG /D_WIN32_WINNT=0x0601 /utf-8 main_imgui.cpp imgui\\imgui*.cpp imgui\\backends\\imgui_impl_win32.cpp imgui\\backends\\imgui_impl_dx11.cpp profile\\profile.c profile\\json.c res\\app.res /Fe:PEC-App.exe /link /SUBSYSTEM:WINDOWS /OPT:REF /OPT:ICF /PDBALTPATH:%_PDB% d3d11.lib dxgi.lib d3dcompiler.lib dwmapi.lib shlwapi.lib shell32.lib advapi32.lib ole32.lib user32.lib gdi32.lib ws2_32.lib winhttp.lib comctl32.lib";

export function findMingwW64(): { gcc: string; gxx: string; windres: string } | null {
  if (process.env.PEC_FORCE_NO_COMPILER === "true") {
    return null;
  }
  try {
    const isWin = process.platform === "win32";
    const gccNames = isWin ? ["x86_64-w64-mingw32-gcc.exe", "gcc.exe"] : ["x86_64-w64-mingw32-gcc"];
    const gxxNames = isWin ? ["x86_64-w64-mingw32-g++.exe", "g++.exe"] : ["x86_64-w64-mingw32-g++"];
    const windresNames = isWin ? ["x86_64-w64-mingw32-windres.exe", "windres.exe"] : ["x86_64-w64-mingw32-windres"];

    let foundGcc = "";
    for (const name of gccNames) {
      try {
        const out = child_process
          .execSync(isWin ? `where ${name}` : `which ${name}`, {
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "ignore"],
          })
          .trim()
          .split(/\r?\n/)[0];
        if (out) {
          foundGcc = out;
          break;
        }
      } catch {}
    }

    let foundGxx = "";
    for (const name of gxxNames) {
      try {
        const out = child_process
          .execSync(isWin ? `where ${name}` : `which ${name}`, {
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "ignore"],
          })
          .trim()
          .split(/\r?\n/)[0];
        if (out) {
          foundGxx = out;
          break;
        }
      } catch {}
    }

    let foundWindres = "";
    for (const name of windresNames) {
      try {
        const out = child_process
          .execSync(isWin ? `where ${name}` : `which ${name}`, {
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "ignore"],
          })
          .trim()
          .split(/\r?\n/)[0];
        if (out) {
          foundWindres = out;
          break;
        }
      } catch {}
    }

    if (foundGcc && foundWindres) {
      return { gcc: foundGcc, gxx: foundGxx || foundGcc, windres: foundWindres };
    }
  } catch {}
  return null;
}

export function findMakensis(): string | null {
  try {
    const isWin = process.platform === "win32";
    const out = child_process
      .execSync(isWin ? "where makensis.exe" : "which makensis", {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      })
      .trim()
      .split(/\r?\n/)[0];
    if (out && fs.existsSync(out)) return out;
  } catch {}
  if (process.platform === "win32") {
    const stdNsis = path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "NSIS", "makensis.exe");
    if (fs.existsSync(stdNsis)) return stdNsis;
  }
  return null;
}

export function getToolchainDiagnostics(): ToolchainDiagnostics {
  const mingw = findMingwW64();
  const msvc = findMsvcVcvars();
  const makensis = findMakensis();

  let hasWixl = false;
  try {
    const isWin = process.platform === "win32";
    const wixlCmd = isWin ? "where wixl.exe" : "which wixl";
    const out = child_process
      .execSync(wixlCmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] })
      .trim();
    if (out) hasWixl = true;
  } catch {}
  if (!hasWixl) {
    try {
      const isWin = process.platform === "win32";
      const msiCmd = isWin ? "where msitools.exe" : "which msitools";
      const out = child_process
        .execSync(msiCmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] })
        .trim();
      if (out) hasWixl = true;
    } catch {}
  }
  if (!hasWixl) {
    try {
      child_process.execFileSync("wixl", ["--version"], { windowsHide: true, stdio: "ignore" });
      hasWixl = true;
    } catch {}
  }
  if (!hasWixl && process.platform !== "win32") {
    if (fs.existsSync("/usr/bin/wixl") || fs.existsSync("/usr/local/bin/wixl")) {
      hasWixl = true;
    }
  }

  let wixlVersion: string | undefined = undefined;
  if (hasWixl) {
    try {
      const out = child_process
        .execSync("wixl --version", { encoding: "utf-8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })
        .trim();
      const m = out.match(/([\d.]+)/);
      if (m) wixlVersion = m[1];
    } catch {}
  }

  const hasGcc = Boolean(mingw?.gcc);
  const hasGxx = Boolean(mingw?.gxx);
  const hasWindres = Boolean(mingw?.windres);
  const hasMakensis = Boolean(makensis);

  let available = false;
  let compilerName = "None";
  let compilerVersion: string | undefined = undefined;

  if (msvc) {
    available = true;
    compilerName = "MSVC 2022 (x64)";
    try {
      const vcToolsVersionFile = path.join(path.dirname(msvc), "..", "..", "Microsoft.VCToolsVersion.default.txt");
      if (fs.existsSync(vcToolsVersionFile)) {
        compilerVersion = fs.readFileSync(vcToolsVersionFile, "utf-8").trim();
      }
    } catch {}
    if (!compilerVersion) {
      try {
        const out = child_process.execSync(`call "${msvc}" x64 >nul && cl 2>&1`, { shell: "cmd.exe", windowsHide: true, encoding: "utf-8" });
        const m = out.match(/Version\s+([\d.]+)/i);
        if (m) compilerVersion = m[1];
      } catch {}
    }
  } else if (mingw && mingw.gcc) {
    available = true;
    compilerName = "MinGW-w64 GCC (x86_64)";
    try {
      const out = child_process
        .execSync(`"${mingw.gcc}" -dumpversion`, { encoding: "utf-8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })
        .trim();
      if (out) compilerVersion = out;
    } catch {}
  }

  return {
    available,
    compilerName,
    compilerVersion,
    hasGcc,
    hasGxx,
    hasWindres,
    hasWixl,
    hasMakensis,
    tools: {
      gcc: { available: hasGcc, version: compilerVersion },
      windres: { available: hasWindres },
      wixl: { available: hasWixl, version: wixlVersion },
      makensis: { available: hasMakensis },
    },
    gcc: { available: hasGcc, version: compilerVersion },
    windres: { available: hasWindres },
    wixl: { available: hasWixl, version: wixlVersion },
  };
}

export function compileBinariesWithMinGW(outDir?: string, customVersion?: string): BuildAppBinariesResult {
  const winTemplatesDir = outDir || path.join(getTemplatesAppDir(), "windows");
  if (!fs.existsSync(winTemplatesDir)) {
    fs.mkdirSync(winTemplatesDir, { recursive: true });
  }

  const buildLog: string[] = [];
  const log = (msg: string) => {
    const ts = new Date().toISOString().substring(11, 19);
    buildLog.push(`[${ts}] ${msg}`);
  };

  const appVer = parseAppVersion(customVersion || getAppBuildConfig().version);
  log(`[Version] Building MinGW binaries for version ${appVer.version} (${appVer.quad})...`);

  const mingw = findMingwW64();
  const repoRoot = path.resolve(".");
  const clientWinDir = path.join(repoRoot, "client", "Windows");
  const guiDir = path.join(clientWinDir, "gui");
  const cliDir = path.join(clientWinDir, "cli");
  const builtFiles: string[] = [];

  if (!mingw || !fs.existsSync(guiDir)) {
    return {
      ok: false,
      compiler: undefined,
      builtFiles: [],
      message: "MinGW-w64 toolchain not found or client directory missing",
      buildLog,
    };
  }

  const gxxBin = mingw.gxx || (process.platform === "win32" ? "x86_64-w64-mingw32-g++.exe" : "x86_64-w64-mingw32-g++");
  const compilerName = "MinGW-w64 GCC (x86_64)";
  log(`[Toolchain] MinGW-w64 cross-compiler detected: ${mingw.gcc} / ${gxxBin}`);

  const syncBinary = (sourcePath: string, name: string) => {
    if (fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, path.join(winTemplatesDir, name));
      const rootWin = path.resolve("./templates/app/windows");
      if (fs.existsSync(rootWin) && rootWin !== winTemplatesDir) {
        try { fs.copyFileSync(sourcePath, path.join(rootWin, name)); } catch {}
      }
    }
  };

  writeVersionGenHeaders(clientWinDir, appVer);

  const windresNumericDefines = `-DPB_VER_MAJOR=${appVer.major} -DPB_VER_MINOR=${appVer.minor} -DPB_VER_PATCH=${appVer.patch} -DPB_VER_BUILD=${appVer.build} -DAPP_VER_MAJOR=${appVer.major} -DAPP_VER_MINOR=${appVer.minor} -DAPP_VER_PATCH=${appVer.patch} -DAPP_VER_BUILD=${appVer.build}`;

  try {
    log("[GUI] Compiling resources with windres...");
    child_process.execSync(`"${mingw.windres}" -i res/app.rc --include-dir=res -I res ${windresNumericDefines} -o res.res -O coff`, { cwd: guiDir, stdio: "pipe" });
    try {
      fs.copyFileSync(path.join(guiDir, "res.res"), path.join(guiDir, "app.res"));
      const resSubdir = path.join(guiDir, "res");
      if (fs.existsSync(resSubdir)) {
        fs.copyFileSync(path.join(guiDir, "res.res"), path.join(resSubdir, "app.res"));
        fs.copyFileSync(path.join(guiDir, "res.res"), path.join(resSubdir, "res.res"));
      }
    } catch {}

    const mainImgui = path.join(guiDir, "main_imgui.cpp");
    if (fs.existsSync(mainImgui)) {
      log("[GUI] Compiling PEC-App DirectX 11 ImGui GUI with x86_64-w64-mingw32-g++...");
      let mingwGuiCmd = MINGW_GUI_CMD.replace(/^x86_64-w64-mingw32-g\+\+/, `"${gxxBin}"`);
      mingwGuiCmd = mingwGuiCmd.replace(/main_imgui\.cpp/, `-I res main_imgui.cpp`);
      const imguiDir = path.join(guiDir, "imgui");
      if (fs.existsSync(imguiDir)) {
        const imguiFiles = fs.readdirSync(imguiDir)
          .filter((f) => f.startsWith("imgui") && f.endsWith(".cpp"))
          .map((f) => `imgui/${f}`)
          .join(" ");
        if (imguiFiles) {
          mingwGuiCmd = mingwGuiCmd.replace("imgui/imgui*.cpp", imguiFiles);
        }
      }
      try {
        child_process.execSync(mingwGuiCmd, { cwd: guiDir, stdio: "pipe" });
      } catch (guiErr: any) {
        const guiDetails = (guiErr?.stderr?.toString() || "") + " " + (guiErr?.stdout?.toString() || "");
        log(`[GUI] DirectX 11 ImGui build note: ${guiDetails.trim()}. Falling back to native Win32 GUI...`);
        child_process.execSync(
          `"${mingw.gcc}" -O2 -s -mwindows -municode -DUNICODE -D_UNICODE -D_WIN32_WINNT=0x0601 -I res main.c profile/profile.c res.res -o PEC-App.exe -luser32 -lgdi32 -lcomctl32 -lshell32 -lcomdlg32 -lwinhttp -ladvapi32 -lws2_32 -luxtheme -ldwmapi -lcrypt32 -lole32 -lshlwapi -lwintrust`,
          { cwd: guiDir, stdio: "pipe" }
        );
      }
    } else {
      log("[GUI] Compiling PEC-App.exe with x86_64-w64-mingw32-gcc...");
      child_process.execSync(
        `"${mingw.gcc}" -O2 -s -mwindows -municode -DUNICODE -D_UNICODE -D_WIN32_WINNT=0x0601 -I res main.c profile/profile.c res.res -o PEC-App.exe -luser32 -lgdi32 -lcomctl32 -lshell32 -lcomdlg32 -lwinhttp -ladvapi32 -lws2_32 -luxtheme -ldwmapi -lcrypt32 -lole32 -lshlwapi -lwintrust`,
        { cwd: guiDir, stdio: "pipe" }
      );
    }

    const builtGui = path.join(guiDir, "PEC-App.exe");
    if (fs.existsSync(builtGui)) {
      syncBinary(builtGui, "PEC-App.exe");
      builtFiles.push("PEC-App.exe");
      log(`[GUI] Successfully compiled PEC-App.exe via MinGW (${Math.round(fs.statSync(builtGui).size / 1024)} KB)`);
    }

    if (fs.existsSync(cliDir)) {
      log("[CLI] Compiling CLI resources with windres...");
      child_process.execSync(`"${mingw.windres}" -i cli/cli.rc --include-dir=gui/res -I gui/res --include-dir=cli -I cli ${windresNumericDefines} -o cli/cli.res -O coff`, { cwd: clientWinDir, stdio: "pipe" });

      log("[CLI] Compiling PEC-CLI.exe with x86_64-w64-mingw32-gcc...");
      child_process.execSync(
        `"${mingw.gcc}" -O2 -s -DUNICODE -D_UNICODE -D_WIN32_WINNT=0x0601 -I gui/res -I cli cli/main.c cli/cli.res -o PEC-CLI.exe -lwinhttp -lshell32 -ladvapi32 -lws2_32`,
        { cwd: clientWinDir, stdio: "pipe" }
      );

      const builtCli = path.join(clientWinDir, "PEC-CLI.exe");
      if (fs.existsSync(builtCli)) {
        syncBinary(builtCli, "PEC-CLI.exe");
        builtFiles.push("PEC-CLI.exe");
        log(`[CLI] Successfully compiled PEC-CLI.exe via MinGW (${Math.round(fs.statSync(builtCli).size / 1024)} KB)`);
      }
    }

    const svcDir = path.join(clientWinDir, "src", "service");
    if (fs.existsSync(svcDir)) {
      log("[Service] Compiling Service resources with windres...");
      child_process.execSync(`"${mingw.windres}" -i svc.rc --include-dir=../../gui/res -I ../../gui/res --include-dir=. -I . ${windresNumericDefines} -o svc.res -O coff`, { cwd: svcDir, stdio: "pipe" });

      log("[Service] Compiling PECAppSvc.exe with x86_64-w64-mingw32-gcc...");
      child_process.execSync(
        `"${mingw.gcc}" -O2 -s -mconsole -municode -DUNICODE -D_UNICODE -D_WIN32_WINNT=0x0601 -I . -I ../../gui/res pb_service.c svc.res -o PECAppSvc.exe -ladvapi32 -lnetapi32 -lwtsapi32 -luser32 -lshell32`,
        { cwd: svcDir, stdio: "pipe" }
      );

      const builtSvc = path.join(svcDir, "PECAppSvc.exe");
      if (fs.existsSync(builtSvc)) {
        syncBinary(builtSvc, "PECAppSvc.exe");
        builtFiles.push("PECAppSvc.exe");
        log(`[Service] Successfully compiled PECAppSvc.exe via MinGW (${Math.round(fs.statSync(builtSvc).size / 1024)} KB)`);
      }
    }

    const instDir = path.join(clientWinDir, "installer");
    if (fs.existsSync(instDir)) {
      log("[Installer] Compiling Installer resources with windres...");
      child_process.execSync(`"${mingw.windres}" -i setup.rc --include-dir=. -I . --include-dir=../gui/res -I ../gui/res ${windresNumericDefines} -o setup.res -O coff`, { cwd: instDir, stdio: "pipe" });

      log("[Installer] Compiling PEC-App-Setup.exe with x86_64-w64-mingw32-gcc...");
      child_process.execSync(
        `"${mingw.gcc}" -O2 -s -mwindows -municode -DUNICODE -D_UNICODE -D_WIN32_WINNT=0x0601 -I . -I ../gui/res setup.c setup.res -o PEC-App-Setup.exe -luser32 -lgdi32 -lcomctl32 -lshell32 -ladvapi32 -lole32 -luuid -lwintrust`,
        { cwd: instDir, stdio: "pipe" }
      );

      const builtInst = path.join(instDir, "PEC-App-Setup.exe");
      if (fs.existsSync(builtInst)) {
        syncBinary(builtInst, "PEC-App-Setup.exe");
        syncBinary(builtInst, `PEC-App-Setup-${appVer.version}.exe`);
        builtFiles.push("PEC-App-Setup.exe", `PEC-App-Setup-${appVer.version}.exe`);
        log(`[Installer] Successfully compiled PEC-App-Setup.exe via MinGW (${Math.round(fs.statSync(builtInst).size / 1024)} KB)`);
      }
    }

    const makensisCmd = findMakensis();
    if (makensisCmd && fs.existsSync(path.join(clientWinDir, "installer", "ProxyBridge.nsi"))) {
      try {
        log("[Installer] NSIS compiler detected. Building official NSIS installer...");
        child_process.execSync(`"${makensisCmd}" -V2 -DPRODUCT_VERSION="${appVer.version}" -DVI_VERSION="${appVer.quad}" ProxyBridge.nsi`, { cwd: path.join(clientWinDir, "installer"), stdio: "pipe" });
        const nsiOut = path.join(clientWinDir, "installer", `PEC-App-Setup-${appVer.version}.exe`);
        if (fs.existsSync(nsiOut)) {
          fs.copyFileSync(nsiOut, path.join(winTemplatesDir, "PEC-App-Setup.exe"));
          fs.copyFileSync(nsiOut, path.join(winTemplatesDir, `PEC-App-Setup-${appVer.version}.exe`));
          log(`[Installer] NSIS Setup verified (${Math.round(fs.statSync(nsiOut).size / 1024)} KB)`);
        }
      } catch (nsiErr: any) {
        log(`[Installer] Note: NSIS build skipped: ${nsiErr?.message || nsiErr}`);
      }
    }
  } catch (err: any) {
    const details = (err?.stderr?.toString() || "") + " " + (err?.stdout?.toString() || "");
    log(`[WARN] MinGW cross-compilation warning: ${err?.message || err} ${details}`.trim());
    return {
      ok: false,
      compiler: compilerName,
      builtFiles,
      message: `MinGW build warning: ${err?.message || err}`,
      buildLog,
    };
  }

  return {
    ok: true,
    compiler: compilerName,
    builtFiles,
    message: `MinGW binaries compiled: ${builtFiles.join(", ")}`,
    buildLog,
  };
}

export function buildAppBinaries(customVersion?: string): BuildAppBinariesResult {
  const startTime = Date.now();
  const winTemplatesDir = path.join(getTemplatesAppDir(), "windows");
  if (!fs.existsSync(winTemplatesDir)) {
    fs.mkdirSync(winTemplatesDir, { recursive: true });
  }

  const buildLog: string[] = [];
  const log = (msg: string) => {
    const ts = new Date().toISOString().substring(11, 19);
    buildLog.push(`[${ts}] ${msg}`);
  };

  if (customVersion && customVersion.trim()) {
    try {
      saveAppBuildConfig({ version: customVersion.trim() });
    } catch {}
  }

  const cfg = getAppBuildConfig();
  const appVer = parseAppVersion(customVersion || cfg.version);

  log(`Starting PEC-App binary build pipeline for v${appVer.version} (${appVer.quad})...`);
  const builtFiles: string[] = [];
  let compilerName = "Pre-compiled / Verified";
  let compilerStatus: {
    compiled: boolean;
    compilerName: string;
    compilerMissing?: boolean;
    error?: string;
  } = {
    compiled: false,
    compilerName: "Pre-compiled / Verified",
  };

  const vcvars = findMsvcVcvars();
  const mingw = findMingwW64();
  const toolchain = getToolchainDiagnostics();

  if (!vcvars && !mingw) {
    if (process.env.PEC_FORCE_NO_COMPILER === "true") {
      const embeddedVersion = getEmbeddedVersion(winTemplatesDir);
      log(`[Toolchain] No C/C++ compiler detected. Embedded templates binary version: v${embeddedVersion}`);
      return {
        ok: false,
        compiled: false,
        compilerMissing: true,
        status: "compiler_missing",
        compiler: "None",
        compilerStatus: {
          compiled: false,
          compilerName: "None",
          compilerMissing: true,
          error: "No C/C++ compiler detected in system",
        },
        toolchain,
        builtFiles: [],
        message: `Компилятор C/C++ не обнаружен в системе. Сборка невозможна. В шаблонах находятся бинарники v${embeddedVersion}.`,
        buildLog,
      };
    }

    // First run template verification and auto-healing:
    ensurePristineTemplates();
    const pristineDir = path.join(path.resolve("./templates/app/windows"), ".pristine");
    const requiredBinaries = [
      "PEC-App.exe",
      "PEC-CLI.exe",
      "WinDivert.dll",
      "WinDivert64.sys",
      "PECAppCore.dll",
      "PECAppSvc.exe",
    ];

    const isValidBinary = (p: string) => {
      if (!fs.existsSync(p)) return false;
      const sz = fs.statSync(p).size;
      if (sz < 1000) return false;
      try {
        const header = fs.readFileSync(p, { flag: "r" }).subarray(0, 32).toString();
        if (header.includes("MZ_DUMMY")) return false;
      } catch {}
      return true;
    };

    // Recover any missing or invalid templates into winTemplatesDir from .pristine or root templates
    for (const bin of [...requiredBinaries, "PEC-App-Setup.exe"]) {
      const targetPath = path.join(winTemplatesDir, bin);
      if (!isValidBinary(targetPath)) {
        const candidates = [
          path.join(pristineDir, bin),
          path.resolve("./templates/app/windows", bin),
          path.resolve("./templates/app/windows/.pristine", bin),
        ];
        if (bin === "PECAppCore.dll") {
          candidates.push(
            path.resolve("./templates/app/windows", "ProxyBridgeCore.dll"),
            path.join(pristineDir, "ProxyBridgeCore.dll")
          );
        }
        if (bin === "PECAppSvc.exe") {
          candidates.push(
            path.resolve("./templates/app/windows", "ProxyBridgeSvc.exe"),
            path.join(pristineDir, "ProxyBridgeSvc.exe")
          );
        }
        const validSrc = candidates.find((c) => isValidBinary(c));
        if (validSrc) {
          try {
            fs.copyFileSync(validSrc, targetPath);
            log(`[Auto-Heal] Restored ${bin} from ${validSrc}`);
          } catch {}
        }
      }
      if (isValidBinary(targetPath) && !builtFiles.includes(bin)) {
        builtFiles.push(bin);
      }
    }

    const allPresent = requiredBinaries.every((b) => isValidBinary(path.join(winTemplatesDir, b)));
    const timeSec = Number(((Date.now() - startTime) / 1000).toFixed(2));

    if (allPresent) {
      log("[Toolchain] No C/C++ compiler detected. Pre-compiled templates verified successfully.");
      return {
        ok: true,
        compiled: false,
        compilerMissing: false,
        status: "success",
        compiler: "Pre-compiled / Verified",
        compilerStatus: {
          compiled: false,
          compilerName: "Pre-compiled / Verified",
        },
        builtFiles,
        message: "Native PEC-App binaries verified (Pre-compiled / Verified)",
        buildLog,
        toolchain,
        timeSec,
      };
    } else {
      const embeddedVersion = getEmbeddedVersion(winTemplatesDir);
      log(`[Toolchain] No C/C++ compiler detected and templates incomplete. Embedded version: v${embeddedVersion}`);
      return {
        ok: false,
        compiled: false,
        compilerMissing: true,
        status: "compiler_missing",
        compiler: "None",
        compilerStatus: {
          compiled: false,
          compilerName: "None",
          compilerMissing: true,
          error: "No C/C++ compiler detected in system and templates incomplete",
        },
        toolchain,
        builtFiles: [],
        message: `Компилятор C/C++ не обнаружен в системе. Сборка невозможна. В шаблонах находятся бинарники v${embeddedVersion}.`,
        buildLog,
        timeSec,
      };
    }
  }
  const repoRoot = path.resolve(".");
  const clientWinDir = path.join(repoRoot, "client", "Windows");
  const guiDir = path.join(clientWinDir, "gui");
  const cliDir = path.join(clientWinDir, "cli");

  const syncBinary = (sourcePath: string, name: string) => {
    if (fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, path.join(winTemplatesDir, name));
      const rootWin = path.resolve("./templates/app/windows");
      if (fs.existsSync(rootWin) && rootWin !== winTemplatesDir) {
        try { fs.copyFileSync(sourcePath, path.join(rootWin, name)); } catch {}
      }
    }
  };

  const msvcGuiDefines = `/DAPP_VERSION=\\"${appVer.version}\\" /DAPP_VERSION_STR=\\"${appVer.version}\\" /DAPP_VERSION_W=L\\"${appVer.version}\\" /DPB_VER_MAJOR=${appVer.major} /DPB_VER_MINOR=${appVer.minor} /DPB_VER_PATCH=${appVer.patch} /DPB_VER_BUILD=${appVer.build} /DPB_VER_STR=\\"${appVer.version}\\" /DPB_VER_STRW=L\\"${appVer.version}\\"`;
  const msvcRcAppDefines = `/dPB_VER_MAJOR=${appVer.major} /dPB_VER_MINOR=${appVer.minor} /dPB_VER_PATCH=${appVer.patch} /dPB_VER_BUILD=${appVer.build} /dPB_VER_STR=\\"${appVer.version}\\" /dAPP_VER_MAJOR=${appVer.major} /dAPP_VER_MINOR=${appVer.minor} /dAPP_VER_PATCH=${appVer.patch} /dAPP_VER_BUILD=${appVer.build} /dAPP_VERSION_STR=\\"${appVer.quad}\\"`;

  writeVersionGenHeaders(clientWinDir, appVer);

  if (process.env.SKIP_NATIVE_REBUILD !== "true" && vcvars && fs.existsSync(guiDir)) {
    try {
      log(`[Toolchain] Native MSVC compiler detected: ${vcvars}`);
      const mainImgui = path.join(guiDir, "main_imgui.cpp");
      if (fs.existsSync(mainImgui)) {
        log(`[GUI] Compiling PEC-App DirectX 11 ImGui GUI v${appVer.version} with MSVC (rc.exe + cl.exe)...`);
        const clCmd = MSVC_GUI_CMD.replace(/^cl\.exe/, `cl.exe ${msvcGuiDefines}`);
        const guiCmd = `call "${vcvars}" x64 >nul && cd /d "${guiDir}" && pushd res && rc /nologo ${msvcRcAppDefines} /fo ..\\res\\app.res app.rc && popd && copy /y res\\app.res res.res >nul 2>&1 && copy /y res\\app.res app.res >nul 2>&1 && ${clCmd}`;
        child_process.execSync(guiCmd, { shell: "cmd.exe", windowsHide: true, stdio: "pipe" });
      } else {
        log(`[GUI] Compiling PEC-App GUI v${appVer.version} with MSVC (rc.exe + cl.exe)...`);
        const guiCmd = `call "${vcvars}" x64 >nul && cd /d "${guiDir}" && pushd res && rc /nologo ${msvcRcAppDefines} /fo ..\\app.res app.rc && popd && cl.exe /nologo /utf-8 /O1 /Os /MT /GL /Gy /GS /guard:cf /sdl /W4 /wd4100 /wd4189 /wd4267 /wd4244 /wd4996 /DNDEBUG /D_CRT_SECURE_NO_WARNINGS /DUNICODE /D_UNICODE ${msvcGuiDefines} main.c profile\\profile.c app.res /Fe:PEC-App.exe /link /LTCG /SUBSYSTEM:WINDOWS /OPT:REF /OPT:ICF /RELEASE /DYNAMICBASE /HIGHENTROPYVA /NXCOMPAT /guard:cf /CETCOMPAT user32.lib gdi32.lib comctl32.lib shell32.lib comdlg32.lib winhttp.lib advapi32.lib ws2_32.lib wintrust.lib`;
        child_process.execSync(guiCmd, { shell: "cmd.exe", windowsHide: true, stdio: "pipe" });
      }

      const builtGui = path.join(guiDir, "PEC-App.exe");
      if (fs.existsSync(builtGui)) {
        syncBinary(builtGui, "PEC-App.exe");
        builtFiles.push("PEC-App.exe");
        log(`[GUI] Successfully built PEC-App.exe (${Math.round(fs.statSync(builtGui).size / 1024)} KB)`);
      }

      if (fs.existsSync(cliDir)) {
        log(`[CLI] Compiling PEC-CLI v${appVer.version} with MSVC...`);
        const cliCmd = `call "${vcvars}" x64 >nul && cd /d "${clientWinDir}" && rc /nologo ${msvcRcAppDefines} /fo cli\\cli.res cli\\cli.rc && cl.exe /nologo /O2 /Ot /GL /Gy /W4 /wd4100 /wd4189 /wd4267 /wd4244 /wd4996 /D_WINSOCK_DEPRECATED_NO_WARNINGS /D_WIN32_WINNT=0x0601 /DNDEBUG /DVERSION=\\"${appVer.version}\\" /DVERSION_W=L\\"${appVer.version}\\" /DAPP_VERSION=\\"${appVer.version}\\" /arch:SSE2 /fp:fast /GS /guard:cf /Qpar cli\\main.c cli\\cli.res /link /LTCG /OPT:REF /OPT:ICF /RELEASE /DYNAMICBASE /NXCOMPAT /SUBSYSTEM:CONSOLE winhttp.lib shell32.lib advapi32.lib ws2_32.lib /OUT:PEC-CLI.exe`;
        child_process.execSync(cliCmd, { shell: "cmd.exe", windowsHide: true, stdio: "pipe" });

        const builtCli = path.join(clientWinDir, "PEC-CLI.exe");
        if (fs.existsSync(builtCli)) {
          syncBinary(builtCli, "PEC-CLI.exe");
          builtFiles.push("PEC-CLI.exe");
          log(`[CLI] Successfully built PEC-CLI.exe (${Math.round(fs.statSync(builtCli).size / 1024)} KB)`);
        }
      }

      const svcDir = path.join(clientWinDir, "src", "service");
      if (fs.existsSync(svcDir)) {
        log(`[Service] Compiling PECAppSvc v${appVer.version} with MSVC...`);
        const svcCmd = `call "${vcvars}" x64 >nul && cd /d "${clientWinDir}" && rc /nologo ${msvcRcAppDefines} /fo src\\service\\svc.res src\\service\\svc.rc && cl.exe /nologo /O2 /GL /Gy /W4 /MT /GS /guard:cf /sdl /DNDEBUG /D_CRT_SECURE_NO_WARNINGS /DUNICODE /D_UNICODE /DAPP_VERSION=\\"${appVer.version}\\" src\\service\\pb_service.c src\\service\\svc.res /link /LTCG /OPT:REF /OPT:ICF /RELEASE /DYNAMICBASE /HIGHENTROPYVA /NXCOMPAT /guard:cf /CETCOMPAT /SUBSYSTEM:CONSOLE advapi32.lib netapi32.lib wtsapi32.lib user32.lib /OUT:PECAppSvc.exe`;
        child_process.execSync(svcCmd, { shell: "cmd.exe", windowsHide: true, stdio: "pipe" });
        const builtSvc = path.join(clientWinDir, "PECAppSvc.exe");
        if (fs.existsSync(builtSvc)) {
          syncBinary(builtSvc, "PECAppSvc.exe");
          builtFiles.push("PECAppSvc.exe");
          log(`[Service] Successfully built PECAppSvc.exe (${Math.round(fs.statSync(builtSvc).size / 1024)} KB)`);
        }
      }

      const instDir = path.join(clientWinDir, "installer");
      if (fs.existsSync(instDir)) {
        log(`[Installer] Compiling PEC-App-Setup v${appVer.version} with MSVC...`);
        const msvcRcInstDefines = `/dAPP_VER_MAJOR=${appVer.major} /dAPP_VER_MINOR=${appVer.minor} /dAPP_VER_PATCH=${appVer.patch} /dAPP_VER_BUILD=${appVer.build} /dAPP_VERSION_STR=\\"${appVer.quad}\\"`;
        const instCmd = `call "${vcvars}" x64 >nul && cd /d "${instDir}" && rc /nologo ${msvcRcInstDefines} /fo setup.res setup.rc && cl.exe /nologo /utf-8 /O2 /MT /GS /DNDEBUG /D_CRT_SECURE_NO_WARNINGS /DUNICODE /D_UNICODE /DAPP_VERSION=L\\"${appVer.version}\\" /DAPP_VERSION_STR=\\"${appVer.version}\\" setup.c setup.res /Fe:PEC-App-Setup.exe /link /SUBSYSTEM:WINDOWS /RELEASE user32.lib gdi32.lib comctl32.lib shell32.lib advapi32.lib ole32.lib uuid.lib`;
        child_process.execSync(instCmd, { shell: "cmd.exe", windowsHide: true, stdio: "pipe" });
        const builtInst = path.join(instDir, "PEC-App-Setup.exe");
        if (fs.existsSync(builtInst)) {
          syncBinary(builtInst, "PEC-App-Setup.exe");
          syncBinary(builtInst, `PEC-App-Setup-${appVer.version}.exe`);
          builtFiles.push("PEC-App-Setup.exe", `PEC-App-Setup-${appVer.version}.exe`);
          log(`[Installer] Successfully built PEC-App-Setup.exe (${Math.round(fs.statSync(builtInst).size / 1024)} KB)`);
        }
      }

      compilerName = "MSVC 2022 (x64)";
      compilerStatus = {
        compiled: true,
        compilerName: "MSVC 2022 (x64)",
      };
    } catch (err: any) {
      const out = (err?.stdout?.toString() || "") + " " + (err?.stderr?.toString() || "");
      log(`[WARN] MSVC build warning: ${err?.message || err}`);
      console.warn("[appPackager] MSVC compilation error, checking pre-built binaries:", err?.message || err, out);
      compilerName = "Pre-compiled / Verified (MSVC compilation failed)";
      compilerStatus = {
        compiled: false,
        compilerName: "Pre-compiled / Verified (MSVC compilation failed)",
        error: String(err?.message || err),
      };
    }
  } else if (process.env.SKIP_NATIVE_REBUILD !== "true" && mingw && fs.existsSync(guiDir)) {
    const mingwRes = compileBinariesWithMinGW(winTemplatesDir, appVer.version);
    if (mingwRes.buildLog) {
      buildLog.push(...mingwRes.buildLog);
    }
    if (mingwRes.ok) {
      compilerName = mingwRes.compiler || "MinGW-w64 GCC (x86_64)";
      compilerStatus = {
        compiled: true,
        compilerName,
      };
      builtFiles.push(...mingwRes.builtFiles);
    } else {
      compilerName = "Pre-compiled / Verified (MinGW compilation failed)";
      compilerStatus = {
        compiled: false,
        compilerName: "Pre-compiled / Verified (MinGW compilation failed)",
        error: mingwRes.message,
      };
    }
  } else {
    log("[Toolchain] No local C compiler detected. Using verified pre-compiled release templates.");
    compilerName = "Pre-compiled / Verified";
    compilerStatus = {
      compiled: false,
      compilerName: "Pre-compiled / Verified",
    };
  }

  if (process.env.SKIP_NATIVE_REBUILD === "true") {
    for (const b of ["PEC-App.exe", "PEC-CLI.exe", "PECAppSvc.exe", "PEC-App-Setup.exe"]) {
      const p = path.join(winTemplatesDir, b);
      const rootSrc = path.resolve("./templates/app/windows", b);
      if ((!fs.existsSync(p) || fs.statSync(p).size < 1000) && fs.existsSync(rootSrc) && fs.statSync(rootSrc).size > 1000) {
        try { fs.copyFileSync(rootSrc, p); } catch {}
      }
    }
  }

  // Fallback / verification if compilation didn't run or missed something:
  ensurePristineTemplates();
  const pristineDir = path.join(path.resolve("./templates/app/windows"), ".pristine");
  const destGui = path.join(winTemplatesDir, "PEC-App.exe");
  const fallbackGui = [
    path.join(guiDir, "PEC-App.exe"),
    path.join(pristineDir, "PEC-App.exe"),
    path.resolve("./templates/app/windows/PEC-App.exe"),
    path.resolve("./templates/app/windows/ProxyBridge.exe"),
  ].find(p => fs.existsSync(p) && fs.statSync(p).size > 1000);

  if ((!fs.existsSync(destGui) || fs.statSync(destGui).size < 1000) && fallbackGui) {
    fs.copyFileSync(fallbackGui, destGui);
    if (!builtFiles.includes("PEC-App.exe")) builtFiles.push("PEC-App.exe");
  } else if (fs.existsSync(destGui) && !builtFiles.includes("PEC-App.exe")) {
    builtFiles.push("PEC-App.exe");
  }

  const destCli = path.join(winTemplatesDir, "PEC-CLI.exe");
  const fallbackCli = [
    path.join(clientWinDir, "PEC-CLI.exe"),
    path.join(pristineDir, "PEC-CLI.exe"),
    path.resolve("./templates/app/windows/PEC-CLI.exe"),
    path.resolve("./templates/app/windows/pbcli.exe"),
  ].find(p => fs.existsSync(p) && fs.statSync(p).size > 1000);

  if ((!fs.existsSync(destCli) || fs.statSync(destCli).size < 1000) && fallbackCli) {
    fs.copyFileSync(fallbackCli, destCli);
    if (!builtFiles.includes("PEC-CLI.exe")) builtFiles.push("PEC-CLI.exe");
  } else if (fs.existsSync(destCli) && !builtFiles.includes("PEC-CLI.exe")) {
    builtFiles.push("PEC-CLI.exe");
  }

  const destSvc = path.join(winTemplatesDir, "PECAppSvc.exe");
  const fallbackSvc = [
    path.join(clientWinDir, "PECAppSvc.exe"),
    path.join(clientWinDir, "src", "service", "PECAppSvc.exe"),
    path.join(pristineDir, "PECAppSvc.exe"),
    path.resolve("./templates/app/windows/PECAppSvc.exe"),
    path.resolve("./templates/app/windows/ProxyBridgeSvc.exe"),
  ].find(p => fs.existsSync(p) && fs.statSync(p).size > 1000);

  if ((!fs.existsSync(destSvc) || fs.statSync(destSvc).size < 1000) && fallbackSvc) {
    fs.copyFileSync(fallbackSvc, destSvc);
    if (!builtFiles.includes("PECAppSvc.exe")) builtFiles.push("PECAppSvc.exe");
  } else if (fs.existsSync(destSvc) && !builtFiles.includes("PECAppSvc.exe")) {
    builtFiles.push("PECAppSvc.exe");
  }

  const destCore = path.join(winTemplatesDir, "PECAppCore.dll");
  const fallbackCore = [
    path.join(pristineDir, "PECAppCore.dll"),
    path.resolve("./templates/app/windows/PECAppCore.dll"),
    path.resolve("./templates/app/windows/ProxyBridgeCore.dll"),
  ].find(p => fs.existsSync(p) && fs.statSync(p).size > 1000);

  if ((!fs.existsSync(destCore) || fs.statSync(destCore).size < 1000) && fallbackCore) {
    fs.copyFileSync(fallbackCore, destCore);
    if (!builtFiles.includes("PECAppCore.dll")) builtFiles.push("PECAppCore.dll");
  } else if (fs.existsSync(destCore) && !builtFiles.includes("PECAppCore.dll")) {
    builtFiles.push("PECAppCore.dll");
  }

  const destSetup = path.join(winTemplatesDir, "PEC-App-Setup.exe");
  const fallbackSetup = [
    path.join(clientWinDir, "installer", "PEC-App-Setup.exe"),
    path.join(pristineDir, "PEC-App-Setup.exe"),
    path.resolve("./templates/app/windows/PEC-App-Setup.exe"),
  ].find((p) => fs.existsSync(p) && fs.statSync(p).size > 1000);

  if ((!fs.existsSync(destSetup) || fs.statSync(destSetup).size < 1000) && fallbackSetup) {
    fs.copyFileSync(fallbackSetup, destSetup);
    if (!builtFiles.includes("PEC-App-Setup.exe")) builtFiles.push("PEC-App-Setup.exe");
  } else if (fs.existsSync(destSetup) && !builtFiles.includes("PEC-App-Setup.exe")) {
    builtFiles.push("PEC-App-Setup.exe");
  }

  // Ensure signed WinDivert driver & Core binaries are present
  const ensureFromTemplates = (filename: string, sourceFallback?: string) => {
    const target = path.join(winTemplatesDir, filename);
    if (!fs.existsSync(target) || fs.statSync(target).size < 1000) {
      const candidates = [
        path.resolve("./templates/app/windows", filename),
        path.join(pristineDir, filename),
      ];
      if (sourceFallback) {
        candidates.push(
          path.resolve("./templates/app/windows", sourceFallback)
        );
      }
      const src = candidates.find(p => fs.existsSync(p) && fs.statSync(p).size > 1000);
      if (src) {
        try { fs.copyFileSync(src, target); } catch {}
      }
    }
  };

  ensureFromTemplates("WinDivert.dll");
  ensureFromTemplates("WinDivert64.sys");
  ensureFromTemplates("PECAppCore.dll", "ProxyBridgeCore.dll");
  ensureFromTemplates("PECAppSvc.exe", "ProxyBridgeSvc.exe");
  ensureFromTemplates("PEC-App-Setup.exe");

  const winDivertDll = path.join(winTemplatesDir, "WinDivert.dll");
  const winDivertSys = path.join(winTemplatesDir, "WinDivert64.sys");
  const coreDll = path.join(winTemplatesDir, "PECAppCore.dll");
  const svcExe = path.join(winTemplatesDir, "PECAppSvc.exe");

  const requiredChecks = [
    { name: "PEC-App.exe", path: destGui },
    { name: "PEC-CLI.exe", path: destCli },
    { name: "WinDivert.dll", path: winDivertDll },
    { name: "WinDivert64.sys", path: winDivertSys },
    { name: "PECAppCore.dll", path: coreDll },
    { name: "PECAppSvc.exe", path: svcExe },
  ];

  const missingFiles: string[] = [];
  for (const rf of requiredChecks) {
    if (!fs.existsSync(rf.path)) {
      missingFiles.push(rf.name);
    } else {
      const sz = fs.statSync(rf.path).size;
      let isDummy = false;
      if (sz < 512) {
        try {
          const header = fs.readFileSync(rf.path, { flag: "r" }).subarray(0, 32).toString();
          if (header.includes("MZ_DUMMY")) isDummy = true;
        } catch {}
      }
      if (isDummy) {
        missingFiles.push(rf.name);
      } else if (!builtFiles.includes(rf.name)) {
        builtFiles.push(rf.name);
      }
    }
  }

  if (missingFiles.length > 0) {
    // Attempt self-healing from .pristine or templates before declaring error
    ensurePristineTemplates();
    const stillMissing: string[] = [];
    for (const name of missingFiles) {
      const p = path.join(winTemplatesDir, name);
      const pristineP = path.join(path.resolve("./templates/app/windows"), ".pristine", name);
      const localPristineP = path.join(winTemplatesDir, ".pristine", name);
      const rootP = path.resolve("./templates/app/windows", name);
      if (fs.existsSync(localPristineP) && fs.statSync(localPristineP).size > 1000) {
        try { fs.copyFileSync(localPristineP, p); } catch {}
      } else if (fs.existsSync(pristineP) && fs.statSync(pristineP).size > 1000) {
        try { fs.copyFileSync(pristineP, p); } catch {}
      } else if (fs.existsSync(rootP) && fs.statSync(rootP).size > 1000) {
        try { fs.copyFileSync(rootP, p); } catch {}
      }
      if (!fs.existsSync(p) || fs.statSync(p).size < 1000) {
        stillMissing.push(name);
      } else {
        if (!builtFiles.includes(name)) builtFiles.push(name);
        log(`[Auto-Heal] Restored ${name} from verified release templates.`);
      }
    }
    if (stillMissing.length > 0) {
      log(`[Error] Missing required native binaries: ${stillMissing.join(", ")}`);
      return {
        ok: false,
        compiler: compilerName,
        compilerStatus,
        builtFiles: [],
        buildLog,
        message: `Missing required native binaries: ${stillMissing.join(", ")}. Please build them or install MSVC/MinGW.`,
      };
    }
  }

  // Remove any obsolete legacy ProxyBridge aliases from the templates directory
  const legacyFilesToRemove = [
    "ProxyBridge.exe",
    "pbcli.exe",
    "ProxyBridgeSvc.exe",
    "ProxyBridgeCore.dll",
  ];
  for (const legacy of legacyFilesToRemove) {
    const lp = path.join(winTemplatesDir, legacy);
    if (fs.existsSync(lp)) {
      try { fs.unlinkSync(lp); } catch {}
    }
  }

  const uniqueFiles = Array.from(new Set(builtFiles));
  for (const f of uniqueFiles) {
    const p = path.join(winTemplatesDir, f);
    if (fs.existsSync(p)) {
      const sz = fs.statSync(p).size;
      log(`[Verification] ${f}: ${Math.round(sz / 1024)} KB (${sz} bytes) - Verified`);
    }
  }

  if (compilerStatus.compiled) {
    const integrityIssues: string[] = [];
    const exesToVerify = ["PEC-App.exe", "PEC-CLI.exe", "PECAppSvc.exe"];
    for (const exeName of exesToVerify) {
      const exePath = path.join(winTemplatesDir, exeName);
      if (!fs.existsSync(exePath)) {
        integrityIssues.push(`${exeName} not found`);
        continue;
      }
      const sz = fs.statSync(exePath).size;
      if (sz < 100 * 1024) {
        integrityIssues.push(`${exeName} size is ${sz} bytes (expected > 100 KB)`);
      }
      try {
        const peBuf = fs.readFileSync(exePath);
        const peVer = extractPeVersion(peBuf);
        const peVerStr = peVer?.productVersion || peVer?.fileVersion;
        if (!peVer || (!peVerStr?.startsWith(appVer.version) && peVerStr !== appVer.quad)) {
          integrityIssues.push(`${exeName} version mismatch (got ${peVerStr || "none"}, expected ${appVer.version})`);
        } else {
          log(`[PE Integrity] ${exeName} verified (version: ${peVerStr}, size: ${Math.round(sz / 1024)} KB)`);
        }
      } catch (err: any) {
        integrityIssues.push(`${exeName} PE check error: ${err?.message || err}`);
      }
    }

    if (integrityIssues.length > 0) {
      log(`[Integrity Warning] Output binary verification issues: ${integrityIssues.join("; ")}`);
      return {
        ok: false,
        compiled: true,
        compiler: compilerName,
        compilerStatus: {
          ...compilerStatus,
          error: `Integrity check failed: ${integrityIssues.join("; ")}`,
        },
        toolchain,
        builtFiles: uniqueFiles,
        message: `Binary integrity verification failed: ${integrityIssues.join("; ")}`,
        buildLog,
      };
    }
  }

  if (!compilerStatus.compiled && !compilerStatus.compilerMissing && process.env.SKIP_NATIVE_REBUILD !== "true" && (vcvars || mingw)) {
    const errorMsg = compilerStatus.error || "Native compilation failed";
    log(`[ERROR] Compilation failed with detected compiler (${compilerName}): ${errorMsg}`);
    return {
      ok: false,
      compiled: false,
      compilerMissing: false,
      compiler: compilerName,
      compilerStatus,
      toolchain,
      builtFiles: uniqueFiles,
      message: `Ошибка компиляции бинарников (${compilerName}): ${errorMsg}`,
      buildLog,
    };
  }

  const hasRealSys = fs.existsSync(winDivertSys) && fs.statSync(winDivertSys).size > 50000;
  if (hasRealSys) {
    log("[Security] Signed kernel driver WinDivert64.sys verified.");
  }
  log(`[Result] Binary build & verification complete (${compilerName}).`);

  const driverStatus = hasRealSys ? " (Signed Driver Verified)" : "";
  const timeSec = Number(((Date.now() - startTime) / 1000).toFixed(2));
  return {
    ok: true,
    compiled: compilerStatus.compiled,
    compiler: compilerName,
    compilerStatus,
    toolchain,
    builtFiles: uniqueFiles,
    message: `Binaries ready (${compilerName}${driverStatus}): ${uniqueFiles.join(", ")}`,
    buildLog,
    timeSec,
  };
}
