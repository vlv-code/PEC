import "./loadEnv.js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import AdmZip from "adm-zip";
import {
  BACKGROUND_TEMPLATE,
  MANAGED_SCHEMA_TEMPLATE,
  renderBackgroundJs,
  renderPopupHtml,
  renderPopupJs,
} from "./extensionTemplates.js";
import { writeJsonAtomic } from "./jsonStore.js";
import { getBuilderConfigPath } from "./storage.js";
import type { ExtensionBuildConfig, ExtensionBuildInfo } from "./types.js";

const EXTENSION_DIR = path.resolve(process.env.PEC_EXTENSION_DIR || "./extension");
const KEY_PATH = path.join(EXTENSION_DIR, "key.pem");
const UPDATES_DIR = path.resolve(process.env.PEC_UPDATES_DIR || "./dist/updates");
const UNPACKED_DIR = path.resolve(process.env.PEC_UNPACKED_DIR || path.join(path.dirname(UPDATES_DIR), "unpacked"));
const BUILD_CONFIG_PATH = getBuilderConfigPath();

export const DEFAULT_BUILD_CONFIG: ExtensionBuildConfig = {
  name: "PEC - Proxy Extension Corp",
  shortName: "PEC Corp",
  version: "1.4.0",
  description: "Корпоративное расширение Chrome для автоматической синхронизации HTTP/SOCKS5 прокси и ротируемой аутентификации.",
  uiMode: "popup",
  presetTemplate: "self-service-pro",
  presetStyle: "cyber-blue",
  uiLayout: "console",
  colorPalette: "cyber",
  defaultThemeMode: "dark",
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
  // The fleet token baked into shipped artifacts. It must always be the
  // low-privilege EXT_SHARED_TOKEN, never ADMIN_TOKEN (which stays server-side).
  defaultToken: process.env.EXT_SHARED_TOKEN || "corp-proxy-secret-token-change-me",
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
    writeJsonAtomic(BUILD_CONFIG_PATH, currentBuildConfig);
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

  // The extension dir may not exist yet (fresh clone, empty Docker volume,
  // isolated test run) - create it before writing the key.
  fs.mkdirSync(EXTENSION_DIR, { recursive: true });

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
  // .reg string values: escape backslashes and quotes, flatten line breaks -
  // a raw quote or backslash in any value would corrupt the registry file.
  const regEscape = (s: string) =>
    String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]/g, " ");

  const updateUrl = `${serverBaseUrl}/updates/updates.xml`;
  const credsUrl = `${serverBaseUrl}/creds`;
  const syncUrl = `${serverBaseUrl}/api/sync`;

  const forcelistEntry = `${regEscape(extensionId)};${regEscape(updateUrl)}`;

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

; ============================================================================
; Google Chrome Enterprise Policies
; ============================================================================

; Force install extension via GPO
[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Google\\Chrome\\ExtensionInstallForcelist]
"1"="${forcelistEntry}"

; Configure managed settings (token & URLs)
[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Google\\Chrome\\3rdparty\\extensions\\${regEscape(extensionId)}\\policy]
"extToken"="${regEscape(token)}"
"credsUrl"="${regEscape(credsUrl)}"
"syncUrl"="${regEscape(syncUrl)}"

; Allowlist for manual install and activation
[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Google\\Chrome\\ExtensionInstallAllowlist]
"1"="${regEscape(extensionId)}"

; ============================================================================
; Microsoft Edge Enterprise Policies
; ============================================================================

; Force install extension via GPO
[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Microsoft\\Edge\\ExtensionInstallForcelist]
"1"="${forcelistEntry}"

; Configure managed settings (token & URLs)
[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Microsoft\\Edge\\3rdparty\\extensions\\${regEscape(extensionId)}\\policy]
"extToken"="${regEscape(token)}"
"credsUrl"="${regEscape(credsUrl)}"
"syncUrl"="${regEscape(syncUrl)}"

; Allowlist for manual install and activation
[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Microsoft\\Edge\\ExtensionInstallAllowlist]
"1"="${regEscape(extensionId)}"
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
  const paletteColors: Record<string, { primary: string; bg: string; card: string; border: string; text: string }> = {
    cyber: { primary: "#38bdf8", bg: "#0b1120", card: "#131d36", border: "#22345c", text: "#f8fafc" },
    obsidian: { primary: "#c084fc", bg: "#09090b", card: "#18181b", border: "#27272a", text: "#fafafa" },
    nord: { primary: "#88c0d0", bg: "#242933", card: "#2e3440", border: "#4c566a", text: "#eceff4" },
    emerald: { primary: "#34d399", bg: "#061e14", card: "#0d3322", border: "#1a6344", text: "#ecfdf5" },
    light: { primary: "#2563eb", bg: "#f8fafc", card: "#ffffff", border: "#cbd5e1", text: "#0f172a" },
  };

  const stylesMap: Record<string, { primary: string; bg: string; card: string; border: string; text: string }> = {
    "cyber-blue": { primary: "#0284c7", bg: "#0b1120", card: "#131d36", border: "#22345c", text: "#f8fafc" },
    "dark-obsidian": { primary: "#a855f7", bg: "#09090b", card: "#18181b", border: "#27272a", text: "#fafafa" },
    "emerald-sentinel": { primary: "#10b981", bg: "#061e14", card: "#0c2c1e", border: "#144e37", text: "#ecfdf5" },
    "sunset-amber": { primary: "#f59e0b", bg: "#19110a", card: "#281a10", border: "#452a18", text: "#fffbeb" },
    "minimal-light": { primary: "#2563eb", bg: "#f8fafc", card: "#ffffff", border: "#cbd5e1", text: "#0f172a" },
  };

  const selectedPalette = cfg.colorPalette ? paletteColors[cfg.colorPalette] : null;
  const selectedStyle = stylesMap[cfg.presetStyle || ""] || stylesMap["cyber-blue"];
  const selected = selectedPalette || selectedStyle;
  return {
    primary: cfg.themeColor || selected.primary,
    bg: cfg.themeBackground || selected.bg,
    card: cfg.themeCard || selected.card,
    border: selected.border,
    text: selected.text,
  };
}

function generateSvgIcon(cfg: ExtensionBuildConfig, colors: { primary: string; bg: string }): string {
  if (cfg.customIconDataUrl) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${colors.primary}"/>
      <stop offset="100%" stop-color="${colors.bg}"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#bgGrad)" />
  <rect x="6" y="6" width="116" height="116" rx="24" fill="none" stroke="#ffffff" stroke-width="2" stroke-opacity="0.15"/>
  <image href="${cfg.customIconDataUrl}" x="16" y="16" width="96" height="96" preserveAspectRatio="xMidYMid meet"/>
</svg>`;
  }

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

function crc32(buf: Buffer): number {
  let table = (globalThis as unknown as { _pecCrcTable?: Uint32Array })._pecCrcTable;
  if (!table) {
    table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
    (globalThis as unknown as { _pecCrcTable?: Uint32Array })._pecCrcTable = table;
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crcBuf]);
}

export function parseDataUrlBuffer(dataUrl?: string): Buffer | null {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  try {
    const comma = dataUrl.indexOf(",");
    if (comma !== -1) {
      return Buffer.from(dataUrl.slice(comma + 1), "base64");
    }
  } catch {}
  return null;
}

/**
 * Generate a valid RGBA PNG icon in pure Node.js (defaults to 128x128).
 * Chrome Manifest V3 strictly requires PNG icons (SVG causes "Could not decode image" install error).
 */
export function generatePngIcon(primaryHex = "#00f0ff", bgHex = "#0a1020", size = 128): Buffer {
  const width = size;
  const height = size;
  const pR = parseInt(primaryHex.slice(1, 3), 16) || 0;
  const pG = parseInt(primaryHex.slice(3, 5), 16) || 240;
  const pB = parseInt(primaryHex.slice(5, 7), 16) || 255;
  const bR = parseInt(bgHex.slice(1, 3), 16) || 10;
  const bG = parseInt(bgHex.slice(3, 5), 16) || 16;
  const bB = parseInt(bgHex.slice(5, 7), 16) || 32;

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowSize = 1 + width * 4;
  const raw = Buffer.alloc(height * rowSize);
  const scale = size / 128;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    raw[rowOffset] = 0;
    const t = y / height;
    const bgR = Math.round(pR * (1 - t) * 0.4 + bR);
    const bgG = Math.round(pG * (1 - t) * 0.4 + bG);
    const bgB = Math.round(pB * (1 - t) * 0.4 + bB);

    for (let x = 0; x < width; x++) {
      const px = rowOffset + 1 + x * 4;
      let inCard = false;
      const margin = Math.max(1, Math.round(8 * scale));
      const rad = Math.max(2, Math.round(24 * scale));
      const left = margin + rad;
      const right = width - margin - rad;
      const top = margin + rad;
      const bottom = height - margin - rad;
      if (x >= margin && x < width - margin && y >= margin && y < height - margin) {
        if (x < left && y < top) inCard = (x - left) ** 2 + (y - top) ** 2 <= rad ** 2;
        else if (x > right && y < top) inCard = (x - right) ** 2 + (y - top) ** 2 <= rad ** 2;
        else if (x < left && y > bottom) inCard = (x - left) ** 2 + (y - bottom) ** 2 <= rad ** 2;
        else if (x > right && y > bottom) inCard = (x - right) ** 2 + (y - bottom) ** 2 <= rad ** 2;
        else inCard = true;
      }

      if (!inCard) {
        raw[px] = 0;
        raw[px + 1] = 0;
        raw[px + 2] = 0;
        raw[px + 3] = 0;
        continue;
      }

      const dx = Math.abs(x - 64 * scale);
      const isShieldTop = y >= 34 * scale && y <= 60 * scale && dx <= 30 * scale;
      const isShieldBottom = y > 60 * scale && y <= 94 * scale && dx <= 30 * scale * (1 - (y - 60 * scale) / Math.max(1, 38 * scale));
      const inShield = isShieldTop || isShieldBottom;

      const isShieldInner =
        inShield &&
        ((y >= 40 * scale && y <= 58 * scale && dx <= 24 * scale) ||
         (y > 58 * scale && y <= 88 * scale && dx <= 24 * scale * (1 - (y - 58 * scale) / Math.max(1, 34 * scale))));

      if (inShield && !isShieldInner) {
        raw[px] = 255;
        raw[px + 1] = 255;
        raw[px + 2] = 255;
        raw[px + 3] = 255;
      } else if (inShield && isShieldInner) {
        raw[px] = Math.round(pR * 0.9);
        raw[px + 1] = Math.round(pG * 0.9);
        raw[px + 2] = Math.round(pB * 0.9);
        raw[px + 3] = 255;
      } else {
        raw[px] = bgR;
        raw[px + 1] = bgG;
        raw[px + 2] = bgB;
        raw[px + 3] = 255;
      }
    }
  }

  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]);
}

// Generate customizable extension files based on BuildConfig
const EXTENSION_SOURCE_FILES = [
  "manifest.json",
  "background.js",
  "popup.html",
  "popup.js",
  "managed_schema.json",
  "icon.png",
  "icon.svg",
] as const;

/**
 * Write a generated file unless the operator manually edited it in the
 * Studio (overriddenFiles) - manual edits must never be silently clobbered
 * by a rebuild. `force` (the "Regenerate templates" action) resets overrides.
 */
function writeGeneratedFile(
  fileName: string,
  content: string | Buffer,
  cfg: ExtensionBuildConfig,
  force = false
): void {
  const overridden = (cfg.overriddenFiles || []).includes(fileName);

  if (!fs.existsSync(UNPACKED_DIR)) {
    fs.mkdirSync(UNPACKED_DIR, { recursive: true });
  }

  if (overridden && !force && fs.existsSync(path.join(EXTENSION_DIR, fileName))) {
    const extContent = fs.readFileSync(path.join(EXTENSION_DIR, fileName));
    fs.writeFileSync(path.join(UNPACKED_DIR, fileName), extContent);
  } else {
    const unpackedPath = path.join(UNPACKED_DIR, fileName);
    if (Buffer.isBuffer(content)) {
      fs.writeFileSync(unpackedPath, content);
    } else {
      fs.writeFileSync(unpackedPath, content, "utf-8");
    }
  }

  if (!fs.existsSync(EXTENSION_DIR)) {
    fs.mkdirSync(EXTENSION_DIR, { recursive: true });
  }
  const extPath = path.join(EXTENSION_DIR, fileName);
  if (force || process.env.PEC_KEEP_EXTENSION_DIR === "1" || !fs.existsSync(extPath)) {
    if (Buffer.isBuffer(content)) {
      fs.writeFileSync(extPath, content);
    } else {
      fs.writeFileSync(extPath, content, "utf-8");
    }
  }
}

export function generateExtensionFiles(
  cfg: ExtensionBuildConfig,
  opts?: { force?: boolean }
): Record<string, string | Buffer> {
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
    name: cfg.name || "PEC - Proxy Extension Corp",
    short_name: cfg.shortName || "PEC Corp",
    version: cfg.version || "1.4.0",
    description: cfg.description || "",
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
    icons: {
      "16": "icon16.png",
      "48": "icon48.png",
      "128": "icon128.png",
    },
  };

  if (cfg.uiMode !== "stealth") {
    manifest.action = {
      default_title: cfg.name || "PEC - Proxy Extension Corp",
      default_popup: "popup.html",
      default_icon: "icon48.png",
    };
  }

  const manifestJson = JSON.stringify(manifest, null, 2);
  writeGeneratedFile("manifest.json", manifestJson, cfg, force);

  // 2. Icon (both PNG for Chrome runtime and SVG for Studio vector preview/editor)
  const customBuf = parseDataUrlBuffer(cfg.customIconDataUrl);
  const icon16 = customBuf || generatePngIcon(colors.primary, colors.bg, 16);
  const icon48 = customBuf || generatePngIcon(colors.primary, colors.bg, 48);
  const icon128 = customBuf || generatePngIcon(colors.primary, colors.bg, 128);
  const iconPng = icon128;
  const iconSvg = generateSvgIcon(cfg, colors);

  writeGeneratedFile("icon.png", iconPng, cfg, force);
  writeGeneratedFile("icon16.png", icon16, cfg, force);
  writeGeneratedFile("icon48.png", icon48, cfg, force);
  writeGeneratedFile("icon128.png", icon128, cfg, force);
  writeGeneratedFile("icon.svg", iconSvg, cfg, force);

  // 2b. Service worker template + managed storage schema.
  writeGeneratedFile("background.js", BACKGROUND_TEMPLATE, cfg, force);
  writeGeneratedFile("managed_schema.json", MANAGED_SCHEMA_TEMPLATE, cfg, force);

  // 3. Popup HTML & JS
  // Always render into memory and disk so the Studio preview and editor always have content
  const popupHtml = renderPopupHtml(cfg, colors);
  writeGeneratedFile("popup.html", popupHtml, cfg, force);

  const popupJs = renderPopupJs(cfg);
  writeGeneratedFile("popup.js", popupJs, cfg, force);

  return {
    "manifest.json": manifestJson,
    "icon.png": iconPng,
    "icon16.png": icon16,
    "icon48.png": icon48,
    "icon128.png": icon128,
    "icon.svg": iconSvg,
    "background.js": BACKGROUND_TEMPLATE,
    "managed_schema.json": MANAGED_SCHEMA_TEMPLATE,
    "popup.html": popupHtml,
    "popup.js": popupJs,
  };
}

export async function buildExtensionFiles(cfg: ExtensionBuildConfig): Promise<Record<string, string>> {
  const effectiveBaseUrl = (cfg.serverUrl || cfg.defaultServerUrl || currentBuildConfig.defaultServerUrl || "http://localhost:3000").trim().replace(/\/+$/, "");
  const effectiveToken = cfg.token || cfg.defaultToken || currentBuildConfig.defaultToken;

  const mergedCfg: ExtensionBuildConfig = {
    ...DEFAULT_BUILD_CONFIG,
    ...cfg,
    defaultServerUrl: effectiveBaseUrl,
    defaultToken: effectiveToken,
  };

  generateExtensionFiles(mergedCfg);

  const colors = getThemeStyles(mergedCfg);
  const permissions: string[] = ["webRequest", "webRequestAuthProvider", "storage", "proxy", "alarms"];
  if (mergedCfg.webRtcProtection) {
    permissions.push("privacy");
  }

  const manifest: Record<string, unknown> = {
    manifest_version: 3,
    name: mergedCfg.name,
    short_name: mergedCfg.shortName,
    version: mergedCfg.version,
    description: mergedCfg.description,
    permissions: Array.from(new Set(permissions)),
    host_permissions: ["<all_urls>"],
    background: {
      service_worker: "background.js",
      type: "module",
    },
    icons: {
      "16": "icon16.png",
      "48": "icon48.png",
      "128": "icon128.png",
    },
  };

  if (mergedCfg.uiMode !== "stealth") {
    manifest.action = {
      default_title: mergedCfg.name,
      default_popup: "popup.html",
      default_icon: "icon48.png",
    };
  }

  const files: Record<string, string> = {
    "manifest.json": JSON.stringify(manifest, null, 2),
    "background.js": BACKGROUND_TEMPLATE,
    "managed_schema.json": MANAGED_SCHEMA_TEMPLATE,
    "popup.html": renderPopupHtml(mergedCfg, colors),
    "popup.js": renderPopupJs(mergedCfg),
  };

  return files;
}

export function packageExtension(baseUrl: string = ""): ExtensionBuildInfo & { zipPath: string; crxPath: string; xmlPath: string } {
  if (!fs.existsSync(UPDATES_DIR)) {
    fs.mkdirSync(UPDATES_DIR, { recursive: true });
  }

  const effectiveBaseUrl = (currentBuildConfig.defaultServerUrl && !currentBuildConfig.defaultServerUrl.includes("mini-server.ic.local"))
    ? currentBuildConfig.defaultServerUrl.trim().replace(/\/+$/, "")
    : (baseUrl ? baseUrl.trim().replace(/\/+$/, "") : "http://localhost:3000");

  if (process.env.EXT_SHARED_TOKEN && currentBuildConfig.defaultToken && currentBuildConfig.defaultToken !== process.env.EXT_SHARED_TOKEN) {
    console.warn(
      "[packager] Saved build-config defaultToken differs from EXT_SHARED_TOKEN - overriding with env value."
    );
  }

  const buildConfigToPack: ExtensionBuildConfig = {
    ...currentBuildConfig,
    defaultServerUrl: effectiveBaseUrl,
    defaultToken: process.env.EXT_SHARED_TOKEN || currentBuildConfig.defaultToken,
  };

  // Generate / refresh extension files based on build config to pack
  generateExtensionFiles(buildConfigToPack);

  const privKey = ensureKeyExists();
  const spkiDer = getPublicKeySpkiDer(privKey);
  const extensionId = calculateExtensionId(spkiDer);

  const manifestPath = fs.existsSync(path.join(UNPACKED_DIR, "manifest.json"))
    ? path.join(UNPACKED_DIR, "manifest.json")
    : path.join(EXTENSION_DIR, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const version = manifest.version || buildConfigToPack.version || "1.2.0";
  const name = manifest.name || buildConfigToPack.name || "Corp Proxy Auth & Sync";

  function isExcludedFromPackage(fileName: string): boolean {
    const lower = fileName.toLowerCase();
    return (
      fileName.startsWith(".") ||
      fileName.endsWith(".pem") ||
      fileName === "scripts" ||
      fileName.endsWith(".crx") ||
      fileName.endsWith(".zip") ||
      lower === "readme.md" ||
      fileName.endsWith(".example") ||
      fileName.endsWith(".svg")
    );
  }

  if (!fs.existsSync(UNPACKED_DIR)) {
    fs.mkdirSync(UNPACKED_DIR, { recursive: true });
  }

  // Render background.js with substituted placeholders directly into UNPACKED_DIR
  const renderedBg = renderBackgroundJs(buildConfigToPack);
  fs.writeFileSync(path.join(UNPACKED_DIR, "background.js"), renderedBg, "utf-8");

  // Copy any custom/extra non-excluded files from EXTENSION_DIR into UNPACKED_DIR
  // only if they don't already exist or are explicitly overridden by operator
  if (fs.existsSync(EXTENSION_DIR)) {
    for (const item of fs.readdirSync(EXTENSION_DIR)) {
      if (isExcludedFromPackage(item)) continue;
      const full = path.join(EXTENSION_DIR, item);
      const dest = path.join(UNPACKED_DIR, item);
      const stat = fs.statSync(full);
      if (stat.isFile()) {
        const isOverridden = (buildConfigToPack.overriddenFiles || []).includes(item);
        if (!fs.existsSync(dest) || isOverridden) {
          if (item !== "background.js") {
            fs.copyFileSync(full, dest);
          }
        }
      }
    }
  }

  // Remove any excluded files from UNPACKED_DIR
  for (const f of fs.readdirSync(UNPACKED_DIR)) {
    if (isExcludedFromPackage(f)) {
      try { fs.rmSync(path.join(UNPACKED_DIR, f), { recursive: true, force: true }); } catch {}
    }
  }

  // In stealth mode, package without popup.html and popup.js
  if (buildConfigToPack.uiMode === "stealth") {
    try { fs.rmSync(path.join(UNPACKED_DIR, "popup.html"), { force: true }); } catch {}
    try { fs.rmSync(path.join(UNPACKED_DIR, "popup.js"), { force: true }); } catch {}
  }

  // Create ZIP directly from the clean UNPACKED_DIR
  const zip = new AdmZip();
  for (const item of fs.readdirSync(UNPACKED_DIR)) {
    if (isExcludedFromPackage(item)) continue;
    const full = path.join(UNPACKED_DIR, item);
    const stat = fs.statSync(full);
    if (stat.isFile()) {
      zip.addLocalFile(full);
    }
  }

  const zipBuffer = zip.toBuffer();
  const zipPath = path.join(UPDATES_DIR, "extension.zip");
  fs.writeFileSync(zipPath, zipBuffer);

  const crxBuffer = packCrxBuffer(zipBuffer, privKey);
  const crxPath = path.join(UPDATES_DIR, "extension.crx");
  fs.writeFileSync(crxPath, crxBuffer);

  const codebaseUrl = `${effectiveBaseUrl}/updates/extension.crx`;
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
    unpackedExists: true,
    unpackedPath: UNPACKED_DIR,
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

export function isPackageStale(): boolean {
  const zipPath = path.join(UPDATES_DIR, "extension.zip");
  if (!fs.existsSync(zipPath)) {
    return true;
  }
  const zipMtime = fs.statSync(zipPath).mtimeMs;
  if (fs.existsSync(BUILD_CONFIG_PATH) && fs.statSync(BUILD_CONFIG_PATH).mtimeMs > zipMtime) {
    return true;
  }
  if (fs.existsSync(EXTENSION_DIR)) {
    try {
      const items = fs.readdirSync(EXTENSION_DIR);
      for (const item of items) {
        if (item.endsWith(".crx") || item.endsWith(".zip") || item.endsWith(".pem")) continue;
        const p = path.join(EXTENSION_DIR, item);
        if (fs.existsSync(p) && fs.statSync(p).mtimeMs > zipMtime) {
          return true;
        }
      }
    } catch {}
  }
  return false;
}
