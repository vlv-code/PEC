import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import AdmZip from "adm-zip";
import { ExtensionBuildInfo, ExtensionBuildConfig } from "./types.js";
import { BACKGROUND_TEMPLATE, MANAGED_SCHEMA_TEMPLATE, renderBackgroundJs } from "./extensionTemplates.js";

const EXTENSION_DIR = path.resolve(process.env.PEC_EXTENSION_DIR || "./extension");
const KEY_PATH = path.join(EXTENSION_DIR, "key.pem");
const UPDATES_DIR = path.resolve(process.env.PEC_UPDATES_DIR || "./dist/updates");
const BUILD_CONFIG_PATH = path.resolve(process.env.BUILDER_CONFIG || "./extension_build_config.json");

export const DEFAULT_BUILD_CONFIG: ExtensionBuildConfig = {
  name: "PEC - Proxy Extension Corp",
  shortName: "PEC Corp",
  version: "1.3.0",
  description: "Корпоративное расширение Chrome для автоматической синхронизации HTTP/SOCKS5 прокси и ротируемой аутентификации.",
  uiMode: "popup",
  presetTemplate: "self-service-pro",
  presetStyle: "cyber-blue",
  themeColor: "#0284c7",
  themeBackground: "#0b1120",
  themeCard: "#131d36",
  iconEmoji: "🛡️",
  iconType: "shield",
  locale: "ru",
  webRtcProtection: true,
  dnsLeakProtection: true,
  badgeIndicator: true,
  allowUserBypass: true,
  bypassAutoTimeoutMinutes: 15,
  showIpGeoChecker: true,
  showSupportButton: true,
  supportUrl: "mailto:it-support@corp.local",
  pingTestUrl: "/healthz",
  syncIntervalMinutes: 15,
  defaultServerUrl: "https://mini-server.ic.local",
  defaultToken: "corp-proxy-secret-token-change-me",
  targetProfileId: "profile_default_split",
  autoConfigureProxy: true,
};

let currentBuildConfig: ExtensionBuildConfig = { ...DEFAULT_BUILD_CONFIG };

try {
  if (fs.existsSync(BUILD_CONFIG_PATH)) {
    const raw = fs.readFileSync(BUILD_CONFIG_PATH, "utf-8");
    currentBuildConfig = { ...DEFAULT_BUILD_CONFIG, ...JSON.parse(raw) };
  }
} catch {}

export function getBuildConfig(): ExtensionBuildConfig {
  return { ...currentBuildConfig };
}

export function saveBuildConfig(cfg: Partial<ExtensionBuildConfig>): ExtensionBuildConfig {
  currentBuildConfig = { ...currentBuildConfig, ...cfg };
  try {
    fs.writeFileSync(BUILD_CONFIG_PATH, JSON.stringify(currentBuildConfig, null, 2), "utf-8");
  } catch (e) {
    console.error("[packager] Error persisting build config:", e);
  }
  return { ...currentBuildConfig };
}

export function ensureKeyExists(): crypto.KeyObject {
  if (fs.existsSync(KEY_PATH)) {
    const pem = fs.readFileSync(KEY_PATH, "utf-8");
    return crypto.createPrivateKey(pem);
  }

  const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  fs.writeFileSync(KEY_PATH, privateKey, { encoding: "utf-8", mode: 0o600 });
  return crypto.createPrivateKey(privateKey);
}

export function getPublicKeySpkiDer(privateKey: crypto.KeyObject): Buffer {
  const pub = crypto.createPublicKey(privateKey);
  return pub.export({ type: "spki", format: "der" });
}

export function calculateExtensionId(spkiDer: Buffer): string {
  const hash = crypto.createHash("sha256").update(spkiDer).digest().subarray(0, 16);
  let id = "";
  for (let i = 0; i < hash.length; i++) {
    const byte = hash[i];
    id += String.fromCharCode(97 + (byte >> 4));
    id += String.fromCharCode(97 + (byte & 0x0f));
  }
  return id;
}

export function buildUpdatesXml(extensionId: string, version: string, codebaseUrl: string): string {
  return `<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='${extensionId}'>
    <updatecheck codebase='${codebaseUrl}' version='${version}' />
  </app>
</gupdate>
`;
}

export function generateGpoConfig(extensionId: string, serverBaseUrl: string, token: string) {
  const updateUrl = `${serverBaseUrl}/updates/updates.xml`;
  const credsUrl = `${serverBaseUrl}/creds`;
  const syncUrl = `${serverBaseUrl}/api/sync`;

  const forcelistEntry = `${extensionId};${updateUrl}`;

  const extensionSettingsJson = {
    [extensionId]: {
      installation_mode: "force_installed",
      update_url: updateUrl,
      extToken: token,
      credsUrl: credsUrl,
      syncUrl: syncUrl,
    },
  };

  const regContent = `Windows Registry Editor Version 5.00

; Force install extension via GPO
[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Google\\Chrome\\ExtensionInstallForcelist]
"1"="${forcelistEntry}"

; Configure managed settings (token & URLs)
[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Google\\Chrome\\3rdparty\\extensions\\${extensionId}\\policy]
"extToken"="${token}"
"credsUrl"="${credsUrl}"
"syncUrl"="${syncUrl}"
`;

  return {
    forcelistEntry,
    extensionSettingsJson,
    regContent,
  };
}

// ---------------------------------------------------------------------------
// CRX3 packaging
//
// Chrome (since v70) rejects CRX version 2 outright ("CRX version 3 expected").
// The format is defined in chromium's components/crx_file/crx3.proto:
//
//   [4]  "Cr24" magic
//   [4]  format version (3), little-endian
//   [4]  header length N, little-endian
//   [N]  protobuf CrxFileHeader {
//          sha256_with_rsa   = field 2:  AsymmetricKeyProof {
//                                               public_key = 1 (SPKI DER)
//                                               signature  = 2 }
//          signed_header_data = field 10000: SignedData { crx_id = 1 }
//        }
//   [M]  the ZIP archive
//
// Every proof signs:
//   "CRX3 SignedData\0" + uint32_le(len(signed_header_data))
//   + signed_header_data + archive
// with RSA-SHA256 (PKCS#1 v1.5). crx_id = SHA256(public_key)[0..16].
// This implementation is byte-identical to the reference `crx3` npm package.
// ---------------------------------------------------------------------------

function protobufVarint(value: number): Buffer {
  const bytes: number[] = [];
  let v = value;
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  bytes.push(v);
  return Buffer.from(bytes);
}

function protobufBytesField(fieldNo: number, value: Buffer): Buffer {
  const tag = protobufVarint((fieldNo << 3) | 2); // wire type 2: length-delimited
  return Buffer.concat([tag, protobufVarint(value.length), value]);
}

export function packCrxBuffer(zipBuffer: Buffer, privateKey: crypto.KeyObject): Buffer {
  const pubDer = getPublicKeySpkiDer(privateKey);
  const crxId = crypto.createHash("sha256").update(pubDer).digest().subarray(0, 16);

  // SignedData { crx_id = 1 }
  const signedData = protobufBytesField(1, crxId);

  const signedDataLen = Buffer.alloc(4);
  signedDataLen.writeUInt32LE(signedData.length, 0);

  // Proof input: context string + length-prefixed signed data + archive
  const signatureInput = Buffer.concat([
    Buffer.from("CRX3 SignedData\0", "utf8"),
    signedDataLen,
    signedData,
    zipBuffer,
  ]);

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signatureInput);
  const signature = signer.sign(privateKey);

  // AsymmetricKeyProof { public_key = 1, signature = 2 }
  const proof = Buffer.concat([protobufBytesField(1, pubDer), protobufBytesField(2, signature)]);

  // CrxFileHeader { sha256_with_rsa = 2, signed_header_data = 10000 }
  const header = Buffer.concat([protobufBytesField(2, proof), protobufBytesField(10000, signedData)]);

  const out = Buffer.alloc(12);
  out.write("Cr24", 0, "latin1");
  out.writeUInt32LE(3, 4); // CRX version 3
  out.writeUInt32LE(header.length, 8);
  return Buffer.concat([out, header, zipBuffer]);
}

function getThemeStyles(cfg: ExtensionBuildConfig) {
  const stylesMap: Record<string, { primary: string; bg: string; card: string; border: string; text: string }> = {
    "cyber-blue": { primary: "#0284c7", bg: "#0b1120", card: "#131d36", border: "#22345c", text: "#f8fafc" },
    "dark-obsidian": { primary: "#a855f7", bg: "#09090b", card: "#18181b", border: "#27272a", text: "#fafafa" },
    "emerald-sentinel": { primary: "#10b981", bg: "#061e14", card: "#0c2c1e", border: "#144e37", text: "#ecfdf5" },
    "sunset-amber": { primary: "#f59e0b", bg: "#19110a", card: "#281a10", border: "#452a18", text: "#fffbeb" },
    "minimal-light": { primary: "#2563eb", bg: "#f8fafc", card: "#ffffff", border: "#cbd5e1", text: "#0f172a" },
  };

  const selected = stylesMap[cfg.presetStyle] || stylesMap["cyber-blue"];
  return {
    primary: cfg.themeColor || selected.primary,
    bg: cfg.themeBackground || selected.bg,
    card: cfg.themeCard || selected.card,
    border: selected.border,
    text: selected.text,
  };
}

function generateSvgIcon(cfg: ExtensionBuildConfig, colors: { primary: string; bg: string }): string {
  const glyphMap: Record<string, string> = {
    shield: `<path d="M64 20 L102 36 C102 72 84 98 64 108 C44 98 26 72 26 36 Z" fill="none" stroke="#ffffff" stroke-width="8" stroke-linejoin="round"/>
             <path d="M64 42 L80 58 L60 78 L48 66" fill="none" stroke="${colors.primary}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`,
    lock: `<rect x="36" y="52" width="56" height="52" rx="10" fill="none" stroke="#ffffff" stroke-width="8"/>
           <path d="M48 52 V38 C48 29.1 55.2 22 64 22 C72.8 22 80 29.1 80 38 V52" fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round"/>
           <circle cx="64" cy="74" r="6" fill="${colors.primary}"/>
           <line x1="64" y1="80" x2="64" y2="88" stroke="${colors.primary}" stroke-width="5" stroke-linecap="round"/>`,
    globe: `<circle cx="64" cy="64" r="44" fill="none" stroke="#ffffff" stroke-width="7"/>
            <ellipse cx="64" cy="64" rx="22" ry="44" fill="none" stroke="#ffffff" stroke-width="6"/>
            <line x1="20" y1="64" x2="108" y2="64" stroke="#ffffff" stroke-width="6"/>
            <line x1="28" y1="44" x2="100" y2="44" stroke="#ffffff" stroke-width="4" stroke-opacity="0.7"/>
            <line x1="28" y1="84" x2="100" y2="84" stroke="#ffffff" stroke-width="4" stroke-opacity="0.7"/>`,
    bolt: `<polygon points="68,16 34,68 62,68 56,112 94,56 68,56" fill="${colors.primary}" stroke="#ffffff" stroke-width="5" stroke-linejoin="round"/>`,
    server: `<rect x="28" y="24" width="72" height="22" rx="5" fill="none" stroke="#ffffff" stroke-width="6"/>
             <circle cx="42" cy="35" r="4" fill="${colors.primary}"/>
             <rect x="28" y="53" width="72" height="22" rx="5" fill="none" stroke="#ffffff" stroke-width="6"/>
             <circle cx="42" cy="64" r="4" fill="${colors.primary}"/>
             <rect x="28" y="82" width="72" height="22" rx="5" fill="none" stroke="#ffffff" stroke-width="6"/>
             <circle cx="42" cy="93" r="4" fill="${colors.primary}"/>`,
    key: `<circle cx="48" cy="64" r="22" fill="none" stroke="#ffffff" stroke-width="7"/>
          <line x1="70" y1="64" x2="106" y2="64" stroke="#ffffff" stroke-width="8" stroke-linecap="round"/>
          <line x1="92" y1="64" x2="92" y2="78" stroke="#ffffff" stroke-width="7" stroke-linecap="round"/>
          <line x1="104" y1="64" x2="104" y2="74" stroke="#ffffff" stroke-width="7" stroke-linecap="round"/>`,
  };

  const vectorGlyph = cfg.iconType && glyphMap[cfg.iconType] ? glyphMap[cfg.iconType] : null;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${colors.primary}"/>
      <stop offset="100%" stop-color="${colors.bg}"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#bgGrad)" />
  <rect x="6" y="6" width="116" height="116" rx="24" fill="none" stroke="#ffffff" stroke-width="2" stroke-opacity="0.15"/>
  ${vectorGlyph ? vectorGlyph : `<text x="64" y="78" font-size="52" text-anchor="middle" font-family="system-ui, sans-serif">${cfg.iconEmoji || "🛡️"}</text>`}
</svg>`;
}

// Generate customizable extension files based on BuildConfig
const EXTENSION_SOURCE_FILES = [
  "manifest.json",
  "background.js",
  "popup.html",
  "popup.js",
  "managed_schema.json",
  "icon.svg",
] as const;

/**
 * Write a generated file unless the operator manually edited it in the
 * Studio (overriddenFiles) - manual edits must never be silently clobbered
 * by a rebuild. `force` (the "Regenerate templates" action) resets overrides.
 */
function writeGeneratedFile(fileName: string, content: string, cfg: ExtensionBuildConfig, force = false): void {
  const overridden = (cfg.overriddenFiles || []).includes(fileName);
  if (overridden && !force) {
    return;
  }
  fs.writeFileSync(path.join(EXTENSION_DIR, fileName), content, "utf-8");
}

export function generateExtensionFiles(cfg: ExtensionBuildConfig, opts?: { force?: boolean }) {
  if (!fs.existsSync(EXTENSION_DIR)) {
    fs.mkdirSync(EXTENSION_DIR, { recursive: true });
  }

  const force = Boolean(opts?.force);
  if (force) {
    cfg.overriddenFiles = [];
    saveBuildConfig({ overriddenFiles: [] });
  }

  const colors = getThemeStyles(cfg);

  // 1. Manifest
  const permissions: string[] = ["webRequest", "webRequestAuthProvider", "storage", "proxy", "alarms"];
  if (cfg.webRtcProtection) {
    permissions.push("privacy");
  }

  const manifest: Record<string, unknown> = {
    manifest_version: 3,
    name: cfg.name,
    short_name: cfg.shortName,
    version: cfg.version,
    description: cfg.description,
    permissions: Array.from(new Set(permissions)),
    host_permissions: ["<all_urls>"],
    background: {
      service_worker: "background.js",
    },
    storage: {
      managed_schema: "managed_schema.json",
    },
    // webRequestAuthProvider (proxy auth interception) shipped in Chrome 108;
    // declaring 96 previously allowed installs where auth silently broke.
    minimum_chrome_version: "108",
  };

  if (cfg.uiMode === "popup") {
    manifest.action = {
      default_title: cfg.name,
      default_popup: "popup.html",
      default_icon: "icon.svg",
    };
    manifest.icons = {
      128: "icon.svg",
    };
  }

  writeGeneratedFile("manifest.json", JSON.stringify(manifest, null, 2), cfg, force);

  // 2. Icon (SVG vector)
  writeGeneratedFile("icon.svg", generateSvgIcon(cfg, colors), cfg, force);

  // 2b. Service worker template + managed storage schema. These are shipped
  // even into a fresh extension directory (Docker volume) - previously a
  // fresh volume produced an extension zip without background.js at all.
  // The file on disk keeps its __PEC_*__ placeholders; substitution happens
  // at ZIP time (see packageExtension) so config changes apply on rebuild.
  writeGeneratedFile("background.js", BACKGROUND_TEMPLATE, cfg, force);
  writeGeneratedFile("managed_schema.json", MANAGED_SCHEMA_TEMPLATE, cfg, force);

  // 3. Popup HTML & JS (if interactive mode)
  if (cfg.uiMode === "popup") {
    const isKiosk = cfg.presetTemplate === "kiosk-restricted";
    const allowBypass = cfg.allowUserBypass && !isKiosk;
    const isRu = (cfg.locale || "ru") === "ru";

    const t = {
      brand: cfg.shortName || (isRu ? "PEC Прокси" : "CorpProxy"),
      active: isRu ? "Активен" : "Active",
      bypassed: isRu ? "Обход" : "Bypassed",
      offline: isRu ? "Отключен" : "Offline",
      tabConn: isRu ? "Подключение" : "Connection",
      tabRules: isRu ? "Маршрутизация" : "Routing",
      tabDiag: isRu ? "Диагностика" : "Diagnostics",
      tabHelp: isRu ? "Поддержка" : "Support",
      proxyMode: isRu ? "Режим прокси" : "Proxy Mode",
      activeEndpoint: isRu ? "Прокси-сервер" : "Active Endpoint",
      routingProfile: isRu ? "Профиль правил" : "Routing Profile",
      latency: isRu ? "Задержка (Пинг)" : "Latency (Ping)",
      btnSync: isRu ? "Синхронизировать сейчас" : "Sync with Server Now",
      btnBypass: isRu ? `Временно отключить (${cfg.bypassAutoTimeoutMinutes || 15}м)` : `Bypass Proxy Temporarily (${cfg.bypassAutoTimeoutMinutes || 15}m)`,
      btnResume: isRu ? "Включить прокси" : "Resume Proxy Now",
      bypassRestricted: isRu ? "🔒 Прямой обход ограничен политикой безопасности предприятия." : "🔒 Direct bypass is restricted by IT enterprise policy.",
      defaultFallback: isRu ? "По умолчанию" : "Default Fallback",
      aiModels: isRu ? "🤖 Модели AI и LLM" : "🤖 AI & LLM Models",
      corpIntranet: isRu ? "🏢 Корпоративная сеть RFC1918" : "🏢 Corporate RFC1918",
      adsTelemetry: isRu ? "🛡️ Реклама и телеметрия" : "🛡️ Ads & Telemetry",
      socialMedia: isRu ? "🌐 Медиа и соцсети" : "🌐 Global Social / Media",
      webrtcShield: isRu ? "Защита WebRTC IP" : "WebRTC IP Shield",
      webrtcStatus: isRu ? "Защищено (без утечки UDP)" : "Protected (No UDP leak)",
      dnsGuard: isRu ? "Защита от подмены DNS" : "DNS Poisoning Guard",
      dnsStatus: isRu ? "Включена" : "Enforced",
      exitIp: isRu ? "Текущий внешний IP" : "Current Exit IP",
      btnCheckIp: isRu ? "Проверить Egress IP и Гео" : "Verify Egress IP & Geo",
      checkingIp: isRu ? "Проверка IP..." : "Checking IP...",
      syncingCreds: isRu ? "Синхронизация..." : "Syncing credentials...",
      supportText: isRu ? "При возникновении проблем с доступом или для запроса новых политик обратитесь в службу поддержки:" : "For proxy connectivity issues, network access requests, or policy updates, contact the enterprise security team:",
      helpdesk: isRu ? "Техподдержка" : "Helpdesk",
      buildVer: isRu ? "Версия сборки" : "Build Version",
      contactSupport: isRu ? "Написать в службу поддержки" : "Contact IT Support Desk",
      rulesNotice: isRu ? "Правила управляются централизованно через сервер /proxy.pac." : "Rules are centrally managed and compiled to /proxy.pac dynamically.",
    };

    const popupHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${cfg.name}</title>
  <style>
    :root {
      --primary: ${colors.primary};
      --bg: ${colors.bg};
      --card: ${colors.card};
      --border: ${colors.border};
      --text: ${colors.text};
      --text-muted: #94a3b8;
      --success: #10b981;
      --danger: #ef4444;
      --warning: #f59e0b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 340px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 14px;
      font-size: 13px;
      line-height: 1.4;
      user-select: none;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--border);
      padding-bottom: 10px;
      margin-bottom: 10px;
    }
    .brand { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14px; }
    .brand-icon {
      width: 24px;
      height: 24px;
      border-radius: 6px;
      background: var(--primary);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      background: rgba(16, 185, 129, 0.15);
      color: var(--success);
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .status-badge .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); }
    .status-badge.bypass {
      background: rgba(245, 158, 11, 0.15);
      color: var(--warning);
      border-color: rgba(245, 158, 11, 0.3);
    }
    .status-badge.bypass .dot { background: var(--warning); }

    /* Nav Tabs */
    .tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 12px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 6px;
    }
    .tab-btn {
      flex: 1;
      background: transparent;
      border: none;
      color: var(--text-muted);
      font-size: 11px;
      font-weight: 600;
      padding: 6px 4px;
      border-radius: 5px;
      cursor: pointer;
      text-align: center;
    }
    .tab-btn.active {
      background: var(--card);
      color: var(--primary);
      border: 1px solid var(--border);
    }

    .tab-content { display: none; }
    .tab-content.active { display: block; }

    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 12px;
      margin-bottom: 10px;
    }
    .row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 12px; }
    .label { color: var(--text-muted); font-size: 11px; }
    .val { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 600; font-size: 12px; }
    
    .btn-primary {
      width: 100%;
      background: var(--primary);
      color: #0b1120;
      font-weight: 600;
      border: none;
      padding: 8px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: opacity 0.15s;
    }
    .btn-primary:hover { opacity: 0.9; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

    .btn-sec {
      width: 100%;
      background: rgba(255, 255, 255, 0.05);
      color: var(--text);
      border: 1px solid var(--border);
      padding: 7px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      margin-top: 6px;
      text-align: center;
      transition: background 0.15s;
    }
    .btn-sec:hover { background: rgba(255, 255, 255, 0.1); }
    .btn-sec.warning { border-color: rgba(245, 158, 11, 0.4); color: var(--warning); }

    .tag {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(2, 132, 199, 0.15);
      color: var(--primary);
      border: 1px solid rgba(2, 132, 199, 0.3);
    }
    .rule-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 5px 0;
      border-bottom: 1px dashed rgba(255, 255, 255, 0.08);
      font-size: 11px;
    }
    .rule-item:last-child { border-bottom: none; }
    .support-box { font-size: 11px; color: var(--text-muted); line-height: 1.5; margin-bottom: 8px; }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="brand-icon">${cfg.iconEmoji || "🛡️"}</div>
      <span>${t.brand}</span>
    </div>
    <div class="status-badge" id="badge">
      <span class="dot"></span>
      <span id="statusText">${t.active}</span>
    </div>
  </header>

  <div class="tabs">
    <button class="tab-btn active" data-tab="tab-conn" onclick="window.switchPopupTab('tab-conn')">${t.tabConn}</button>
    <button class="tab-btn" data-tab="tab-rules" onclick="window.switchPopupTab('tab-rules')">${t.tabRules}</button>
    <button class="tab-btn" data-tab="tab-diag" onclick="window.switchPopupTab('tab-diag')">${t.tabDiag}</button>
    <button class="tab-btn" data-tab="tab-help" onclick="window.switchPopupTab('tab-help')">${t.tabHelp}</button>
  </div>

  <!-- TAB 1: Connection -->
  <div class="tab-content active" id="tab-conn">
    <div class="card">
      <div class="row">
        <span class="label">${t.proxyMode}</span>
        <span class="val" id="modeVal">HTTP / SOCKS5</span>
      </div>
      <div class="row">
        <span class="label">${t.activeEndpoint}</span>
        <span class="val" id="serverVal">proxy.corp.internal</span>
      </div>
      <div class="row">
        <span class="label">${t.routingProfile}</span>
        <span class="val" id="profileVal">Selective (PAC)</span>
      </div>
      <div class="row">
        <span class="label">${t.latency}</span>
        <span class="val" id="pingVal" style="color: var(--success);">28 ms</span>
      </div>
    </div>

    <button id="btnSync" class="btn-primary">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
      <span>${t.btnSync}</span>
    </button>

    ${allowBypass ? `
    <button id="btnToggleBypass" class="btn-sec warning">
      ${t.btnBypass}
    </button>` : `
    <div style="font-size: 11px; text-align: center; color: var(--text-muted); margin-top: 6px;">
      ${t.bypassRestricted}
    </div>`}
  </div>

  <!-- TAB 2: Routing -->
  <div class="tab-content" id="tab-rules">
    <div class="card">
      <div class="row" style="margin-bottom: 6px;">
        <span class="label">${t.defaultFallback}</span>
        <span class="tag">DIRECT</span>
      </div>
      <div class="rule-item">
        <span>${t.aiModels}</span>
        <span class="tag" style="background: rgba(16, 185, 129, 0.15); color: var(--success); border-color: rgba(16,185,129,0.3);">PROXY</span>
      </div>
      <div class="rule-item">
        <span>${t.corpIntranet}</span>
        <span class="tag">DIRECT</span>
      </div>
      <div class="rule-item">
        <span>${t.adsTelemetry}</span>
        <span class="tag" style="background: rgba(239, 68, 68, 0.15); color: var(--danger); border-color: rgba(239,68,68,0.3);">SINKHOLE</span>
      </div>
      <div class="rule-item">
        <span>${t.socialMedia}</span>
        <span class="tag" style="background: rgba(16, 185, 129, 0.15); color: var(--success); border-color: rgba(16,185,129,0.3);">PROXY</span>
      </div>
    </div>
    <div style="font-size: 11px; color: var(--text-muted);">
      ${t.rulesNotice}
    </div>
  </div>

  <!-- TAB 3: Diagnostics -->
  <div class="tab-content" id="tab-diag">
    <div class="card">
      <div class="row">
        <span class="label">${t.webrtcShield}</span>
        <span class="val" style="color: var(--success);">${cfg.webRtcProtection ? t.webrtcStatus : "Disabled"}</span>
      </div>
      <div class="row">
        <span class="label">${t.dnsGuard}</span>
        <span class="val" style="color: var(--success);">${cfg.dnsLeakProtection ? t.dnsStatus : "Off"}</span>
      </div>
      <div class="row">
        <span class="label">${t.exitIp}</span>
        <span class="val" id="exitIpVal">198.51.100.42</span>
      </div>
    </div>

    ${cfg.showIpGeoChecker ? `
    <button id="btnCheckIp" class="btn-sec">
      ${t.btnCheckIp}
    </button>` : ""}
  </div>

  <!-- TAB 4: Support -->
  <div class="tab-content" id="tab-help">
    <div class="card">
      <div class="support-box">
        ${t.supportText}
      </div>
      <div class="row">
        <span class="label">${t.helpdesk}</span>
        <span class="val">${cfg.supportUrl || "helpdesk@corp.local"}</span>
      </div>
      <div class="row">
        <span class="label">${t.buildVer}</span>
        <span class="val">v${cfg.version}</span>
      </div>
    </div>

    ${cfg.showSupportButton ? `
    <a href="${cfg.supportUrl || "mailto:it-support@corp.local"}" target="_blank" class="btn-sec" style="text-decoration: none; display: block;">
      ${t.contactSupport}
    </a>` : ""}
  </div>

  <script src="popup.js"></script>
</body>
</html>`;
    writeGeneratedFile("popup.html", popupHtml, cfg, force);

    const popupJs = `// Global tab switching helper
window.switchPopupTab = function(tabId) {
  if (!tabId) return;
  const tabs = document.querySelectorAll(".tab-btn");
  tabs.forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));

  const activeBtn = document.querySelector('.tab-btn[data-tab="' + tabId + '"]');
  if (activeBtn) activeBtn.classList.add("active");
  const target = document.getElementById(tabId);
  if (target) target.classList.add("active");
};

// Global state applier - reactive to simulator and chrome.runtime
window.applyPopupState = function(response) {
  if (!response) return;
  const statusText = document.getElementById("statusText");
  const badge = document.getElementById("badge");
  const modeVal = document.getElementById("modeVal");
  const serverVal = document.getElementById("serverVal");
  const profileVal = document.getElementById("profileVal");
  const pingVal = document.getElementById("pingVal");
  const exitIpVal = document.getElementById("exitIpVal");
  const btnToggle = document.getElementById("btnToggleBypass");

  if (statusText) {
    if (response.bypassActive) statusText.textContent = "${t.bypassed}";
    else if (!response.online) statusText.textContent = "${t.offline}";
    else statusText.textContent = "${t.active}";
  }
  if (badge) {
    if (response.bypassActive) {
      badge.className = "status-badge bypass";
    } else if (!response.online) {
      badge.className = "status-badge offline";
    } else {
      badge.className = "status-badge";
    }
  }
  if (modeVal && response.protocol) modeVal.textContent = response.protocol.toUpperCase();
  if (serverVal) serverVal.textContent = response.host ? (response.host + ":" + response.port) : "Direct";
  if (profileVal) profileVal.textContent = response.profileName || "Selective PAC";
  if (pingVal && response.ping) pingVal.textContent = response.ping;
  if (exitIpVal && response.exitIp) exitIpVal.textContent = response.exitIp;
  // Remember the management server origin (reported by the service worker)
  // so the diagnostics tab can call it with an absolute URL - a relative
  // fetch() inside chrome-extension:// never reaches the server.
  if (response.serverBase) window.__pecServerBase = response.serverBase;
  if (btnToggle) {
    btnToggle.textContent = response.bypassActive ? "${t.btnResume}" : "${t.btnBypass}";
  }
};

window.addEventListener("message", function(e) {
  if (e.data && e.data.type === "UPDATE_SIM_STATE") {
    window.applyPopupState(e.data.state);
  }
});

function initPopup() {
  const statusText = document.getElementById("statusText");
  const badge = document.getElementById("badge");
  const modeVal = document.getElementById("modeVal");
  const serverVal = document.getElementById("serverVal");
  const profileVal = document.getElementById("profileVal");
  const exitIpVal = document.getElementById("exitIpVal");
  const btnSync = document.getElementById("btnSync");
  const btnToggle = document.getElementById("btnToggleBypass");
  const btnCheckIp = document.getElementById("btnCheckIp");

  // Tab switching listeners
  const tabs = document.querySelectorAll(".tab-btn");
  tabs.forEach(tab => {
    tab.addEventListener("click", (ev) => {
      ev.preventDefault();
      window.switchPopupTab(tab.dataset.tab);
    });
  });

  async function loadState() {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action: "GET_STATUS" }, (response) => {
        if (chrome.runtime.lastError || !response) {
          if (statusText) statusText.textContent = "${t.active}";
          return;
        }
        window.applyPopupState(response);
      });
    }
  }

  if (btnSync) {
    btnSync.addEventListener("click", () => {
      btnSync.disabled = true;
      const originalText = btnSync.innerHTML;
      btnSync.innerHTML = "<span>${t.syncingCreds}</span>";
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: "FORCE_SYNC" }, () => {
          setTimeout(() => {
            btnSync.disabled = false;
            btnSync.innerHTML = originalText;
            loadState();
          }, 800);
        });
      } else {
        setTimeout(() => {
          btnSync.disabled = false;
          btnSync.innerHTML = originalText;
        }, 600);
      }
    });
  }

  if (btnToggle) {
    btnToggle.addEventListener("click", () => {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: "TOGGLE_BYPASS" }, () => {
          loadState();
        });
      } else {
        const isBypassed = badge && badge.classList.contains("bypass");
        if (badge) badge.className = isBypassed ? "status-badge" : "status-badge bypass";
        if (statusText) statusText.textContent = isBypassed ? "${t.active}" : "${t.bypassed}";
        btnToggle.textContent = isBypassed ? "${t.btnBypass}" : "${t.btnResume}";
        if (window.parent && window.parent.postMessage) {
          window.parent.postMessage({ type: "SIM_TOGGLE_BYPASS" }, "*");
        }
      }
    });
  }

  if (btnCheckIp) {
    btnCheckIp.addEventListener("click", async () => {
      btnCheckIp.disabled = true;
      btnCheckIp.textContent = "${t.checkingIp}";
      try {
        const base = window.__pecServerBase || "";
        const res = await fetch(base + "/api/ip-echo").then(r => r.json()).catch(() => null);
        if (res && res.ip && exitIpVal) {
          exitIpVal.textContent = res.ip;
        }
      } catch {}
      setTimeout(() => {
        btnCheckIp.disabled = false;
        btnCheckIp.textContent = "${t.btnCheckIp}";
      }, 500);
    });
  }

  loadState();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPopup);
} else {
  initPopup();
}`;
    writeGeneratedFile("popup.js", popupJs, cfg, force);
  } else {
    // Stealth mode: remove popup files if they exist
    const popH = path.join(EXTENSION_DIR, "popup.html");
    const popJ = path.join(EXTENSION_DIR, "popup.js");
    if (fs.existsSync(popH)) fs.unlinkSync(popH);
    if (fs.existsSync(popJ)) fs.unlinkSync(popJ);
  }
}

export function packageExtension(baseUrl: string = ""): ExtensionBuildInfo & { zipPath: string; crxPath: string; xmlPath: string } {
  if (!fs.existsSync(UPDATES_DIR)) {
    fs.mkdirSync(UPDATES_DIR, { recursive: true });
  }

  // Generate / refresh extension files based on current build config
  generateExtensionFiles(currentBuildConfig);

  const privKey = ensureKeyExists();
  const spkiDer = getPublicKeySpkiDer(privKey);
  const extensionId = calculateExtensionId(spkiDer);

  const manifestPath = path.join(EXTENSION_DIR, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const version = manifest.version || currentBuildConfig.version || "1.2.0";
  const name = manifest.name || currentBuildConfig.name || "Corp Proxy Auth & Sync";

  const zip = new AdmZip();
  const items = fs.readdirSync(EXTENSION_DIR);
  for (const item of items) {
    if (item.endsWith(".pem") || item === "scripts" || item.endsWith(".crx") || item.endsWith(".zip")) {
      continue;
    }
    const full = path.join(EXTENSION_DIR, item);
    const stat = fs.statSync(full);
    if (stat.isFile()) {
      if (item === "background.js") {
        // Substitute build-config placeholders at packaging time; the source
        // file on disk keeps its __PEC_*__ placeholders for future rebuilds.
        const rendered = renderBackgroundJs(currentBuildConfig);
        zip.addFile(item, Buffer.from(rendered, "utf-8"));
      } else {
        zip.addLocalFile(full);
      }
    }
  }

  const zipBuffer = zip.toBuffer();
  const zipPath = path.join(UPDATES_DIR, "extension.zip");
  fs.writeFileSync(zipPath, zipBuffer);

  const crxBuffer = packCrxBuffer(zipBuffer, privKey);
  const crxPath = path.join(UPDATES_DIR, "extension.crx");
  fs.writeFileSync(crxPath, crxBuffer);

  const effectiveBaseUrl = baseUrl || "http://localhost:3000";
  const codebaseUrl = `${effectiveBaseUrl.replace(/\/+$/, "")}/updates/extension.crx`;
  const xmlContent = buildUpdatesXml(extensionId, version, codebaseUrl);
  const xmlPath = path.join(UPDATES_DIR, "updates.xml");
  fs.writeFileSync(xmlPath, xmlContent, "utf-8");

  return {
    extensionId,
    version,
    name,
    hasPrivateKey: true,
    crxExists: true,
    zipExists: true,
    updatesXmlExists: true,
    uiMode: currentBuildConfig.uiMode,
    lastPackTime: new Date().toISOString(),
    zipPath,
    crxPath,
    xmlPath,
  };
}

export function getBuildInfo(serverUrl: string = ""): ExtensionBuildInfo {
  const privKey = ensureKeyExists();
  const spkiDer = getPublicKeySpkiDer(privKey);
  const extensionId = calculateExtensionId(spkiDer);

  const manifestPath = path.join(EXTENSION_DIR, "manifest.json");
  let version = currentBuildConfig.version || "1.2.0";
  let name = currentBuildConfig.name || "Corp Proxy Auth & Sync";
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      version = manifest.version || version;
      name = manifest.name || name;
    } catch {}
  }

  const crxPath = path.join(UPDATES_DIR, "extension.crx");
  const zipPath = path.join(UPDATES_DIR, "extension.zip");
  const xmlPath = path.join(UPDATES_DIR, "updates.xml");

  return {
    extensionId,
    version,
    name,
    hasPrivateKey: fs.existsSync(KEY_PATH),
    crxExists: fs.existsSync(crxPath),
    zipExists: fs.existsSync(zipPath),
    updatesXmlExists: fs.existsSync(xmlPath),
    uiMode: currentBuildConfig.uiMode,
    lastPackTime: fs.existsSync(crxPath) ? fs.statSync(crxPath).mtime.toISOString() : undefined,
  };
}

export function getExtensionSourceFiles(): Record<string, string> {
  const result: Record<string, string> = {};
  if (!fs.existsSync(EXTENSION_DIR)) return result;

  const files = ["manifest.json", "background.js", "popup.html", "popup.js", "managed_schema.json", "icon.svg"];
  for (const f of files) {
    const full = path.join(EXTENSION_DIR, f);
    if (fs.existsSync(full)) {
      result[f] = fs.readFileSync(full, "utf-8");
    }
  }
  return result;
}

export function saveExtensionSourceFile(fileName: string, content: string): boolean {
  const allowed = ["manifest.json", "background.js", "popup.html", "popup.js", "managed_schema.json", "icon.svg"];
  if (!allowed.includes(fileName)) {
    throw new Error(`File name ${fileName} is not allowed for editing`);
  }
  const full = path.join(EXTENSION_DIR, fileName);
  fs.writeFileSync(full, content, "utf-8");
  // Remember the manual edit so a later rebuild does not clobber it.
  const overrides = new Set(currentBuildConfig.overriddenFiles || []);
  overrides.add(fileName);
  currentBuildConfig.overriddenFiles = Array.from(overrides);
  saveBuildConfig({ overriddenFiles: currentBuildConfig.overriddenFiles });
  return true;
}

export function updateManifestVersion(newVersion: string, newName?: string) {
  const manifestPath = path.join(EXTENSION_DIR, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    manifest.version = newVersion;
    if (newName) manifest.name = newName;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  }
  currentBuildConfig.version = newVersion;
  if (newName) currentBuildConfig.name = newName;
  saveBuildConfig(currentBuildConfig);
}
