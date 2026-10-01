import "./loadEnv.js";
import fs from "node:fs";
import crypto from "node:crypto";
import { domainToASCII } from "node:url";
import { GeoPreset, RoutingPresetItem, RoutingProfile, RoutingRule, ProxyConfiguration } from "./types.js";
import { writeJsonAtomic } from "./jsonStore.js";
import { getRoutingProfilesPath, getRoutingPresets } from "./storage.js";

import { getActiveProxy } from "./proxies.js";

const PROFILES_FILE = getRoutingProfilesPath();

/**
 * Convert any internationalized (IDN) domain to Punycode ASCII (e.g. *.рф -> *.xn--p1ai).
 * Chrome's pacScript.data strictly enforces 7-bit ASCII and rejects any non-ASCII characters.
 */
export function toPunycodeDomain(domain: string): string {
  if (!domain || /^[\x00-\x7F]*$/.test(domain)) {
    return domain;
  }
  try {
    if (domain.startsWith("*.")) {
      const ascii = domainToASCII(domain.slice(2));
      return ascii ? `*.${ascii}` : domain;
    }
    if (domain.startsWith(".")) {
      const ascii = domainToASCII(domain.slice(1));
      return ascii ? `.${ascii}` : domain;
    }
    return domainToASCII(domain) || domain;
  } catch {
    return domain;
  }
}

import { GEO_PRESETS } from "./defaultPresets.js";
export { GEO_PRESETS } from "./defaultPresets.js";

const DEFAULT_PROFILES: RoutingProfile[] = [
  {
    id: "profile_default_split",
    name: "Direct by Default (Selective Proxy)",
    description: "Default: all traffic goes DIRECT. Only chosen AI, Media or custom domains go through PROXY. Corporate stays DIRECT.",
    defaultPolicy: "direct",
    isDefault: true,
    targetScope: "all",
    rules: [
      {
        id: "r1",
        name: "Bypass Corporate Intranet",
        targetType: "preset",
        pattern: "preset:corporate_internal",
        action: "direct",
        enabled: true,
      },
      {
        id: "r2",
        name: "Route AI Services to Proxy",
        targetType: "preset",
        pattern: "preset:ai_services",
        action: "proxy",
        enabled: true,
      },
      {
        id: "r3",
        name: "Block Telemetry & Trackers",
        targetType: "preset",
        pattern: "preset:ad_telemetry_block",
        action: "block",
        enabled: true,
      },
    ],
    updatedAt: new Date().toISOString(),
  },
  {
    id: "profile_full_proxy",
    name: "Full Proxy Tunnel (Bypass Intranet)",
    description: "Default: all traffic goes through PROXY. Only corporate internal subnets & RU services stay DIRECT.",
    defaultPolicy: "proxy",
    isDefault: false,
    targetScope: "group",
    targetGroup: "SEC-Proxy-VPN-VIP",
    rules: [
      {
        id: "r_corp",
        name: "Keep Corporate Direct",
        targetType: "preset",
        pattern: "preset:corporate_internal",
        action: "direct",
        enabled: true,
      },
      {
        id: "r_ru",
        name: "Direct RU Services",
        targetType: "preset",
        pattern: "preset:geosite_ru",
        action: "direct",
        enabled: true,
      },
      {
        id: "r_block",
        name: "Sinkhole Trackers",
        targetType: "preset",
        pattern: "preset:ad_telemetry_block",
        action: "block",
        enabled: true,
      },
    ],
    updatedAt: new Date().toISOString(),
  },
];

let profiles: RoutingProfile[] = [...DEFAULT_PROFILES];

try {
  if (fs.existsSync(PROFILES_FILE)) {
    const raw = fs.readFileSync(PROFILES_FILE, "utf-8");
    const loaded = JSON.parse(raw);
    if (Array.isArray(loaded) && loaded.length > 0) {
      profiles = loaded;
    }
  }
} catch (e) {
  console.warn("[routing] Using default routing profiles:", e);
}

function persistProfiles() {
  try {
    writeJsonAtomic(PROFILES_FILE, profiles);
  } catch (e) {
    console.error("[routing] Error saving profiles:", e);
  }
}

export function getAllProfiles(): RoutingProfile[] {
  return [...profiles];
}

export function getProfileById(id: string): RoutingProfile | undefined {
  return profiles.find((p) => p.id === id);
}

function normalizeDefaultPolicy(policy: unknown): "direct" | "proxy" {
  return policy === "proxy" ? "proxy" : "direct";
}

function normalizeAction(action: unknown): "direct" | "proxy" | "block" {
  return action === "direct" || action === "block" ? action : "proxy";
}

export function saveProfile(profile: Partial<RoutingProfile>): RoutingProfile {
  const existingIdx = profiles.findIndex((p) => p.id === profile.id);
  const now = new Date().toISOString();

  if (profile.isDefault) {
    for (const p of profiles) {
      p.isDefault = false;
    }
  }

  const cleanDefaultPolicy = profile.defaultPolicy !== undefined
    ? normalizeDefaultPolicy(profile.defaultPolicy)
    : undefined;

  const cleanRules = Array.isArray(profile.rules)
    ? profile.rules.map((r) => ({
        ...r,
        name: String(r.name || "Rule").slice(0, 100),
        action: normalizeAction(r.action),
      }))
    : undefined;

  if (existingIdx >= 0) {
    profiles[existingIdx] = {
      ...profiles[existingIdx],
      ...profile,
      ...(cleanDefaultPolicy !== undefined ? { defaultPolicy: cleanDefaultPolicy } : {}),
      ...(cleanRules !== undefined ? { rules: cleanRules } : {}),
      updatedAt: now,
    } as RoutingProfile;
    persistProfiles();
    return profiles[existingIdx];
  } else {
    const newProfile: RoutingProfile = {
      id: profile.id || "prof_" + crypto.randomBytes(4).toString("hex"),
      name: profile.name || "Custom Profile",
      description: profile.description || "",
      defaultPolicy: cleanDefaultPolicy || "direct",
      rules: cleanRules || [],
      targetScope: profile.targetScope || "all",
      targetGroup: profile.targetGroup,
      targetInstanceIds: profile.targetInstanceIds,
      isDefault: profile.isDefault || false,
      updatedAt: now,
    };
    profiles.push(newProfile);
    persistProfiles();
    return newProfile;
  }
}

export function deleteProfile(id: string): boolean {
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx < 0) return false;
  if (profiles[idx].isDefault) {
    throw new Error("Cannot delete the default routing profile");
  }
  profiles.splice(idx, 1);
  persistProfiles();
  return true;
}

export function resolveProfileForInstance(instanceId?: string, group?: string): RoutingProfile {
  if (instanceId) {
    const specific = profiles.find(
      (p) => p.targetScope === "instances" && Array.isArray(p.targetInstanceIds) && p.targetInstanceIds.includes(instanceId)
    );
    if (specific) return specific;
  }

  if (group) {
    const groupMatch = profiles.find((p) => p.targetScope === "group" && p.targetGroup === group);
    if (groupMatch) return groupMatch;
  }

  const def = profiles.find((p) => p.isDefault) || profiles[0] || DEFAULT_PROFILES[0];
  return def;
}

// Expand preset domains into actual matchers
export function expandRuleDomains(rule: RoutingRule): string[] {
  if (rule.targetType === "preset" && rule.pattern.startsWith("preset:")) {
    let presets: RoutingPresetItem[] = [];
    try {
      presets = getRoutingPresets();
    } catch {
      // fallback
    }
    const preset =
      presets.find((p) => p.id === rule.pattern) ||
      (GEO_PRESETS ? GEO_PRESETS.find((p) => p.id === rule.pattern) : undefined);
    if (!preset) return [];
    if ("entries" in preset && Array.isArray(preset.entries) && preset.entries.length > 0) {
      return preset.entries;
    }
    return preset.domains || [];
  }
  return rule.pattern
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}


// Generate PAC script for a given routing profile and proxy server config
export function generatePacScript(profile: RoutingProfile, proxyConfig: ProxyConfiguration): string {
  if (proxyConfig.killSwitch || !proxyConfig.enabled) {
    return `// Corp Proxy: Kill-Switch Active\nfunction FindProxyForURL(url, host) { return "DIRECT"; }\n`;
  }

  const activeProxy = getActiveProxy();
  const effectiveProtocol = (activeProxy?.protocol || proxyConfig.protocol || "http").toLowerCase();
  const rawHost = activeProxy?.host || proxyConfig.host || "10.0.0.1";
  const rawPort = activeProxy?.port || proxyConfig.port || 10809;

  const safeHost = String(rawHost).replace(/[^a-zA-Z0-9.-]/g, "");
  const safePort = Math.min(65535, Math.max(1, parseInt(String(rawPort), 10) || 10809));

  const fallbackSuffix = profile.failClosed ? "" : "; DIRECT";
  let proxyDirective = "PROXY " + safeHost + ":" + safePort + fallbackSuffix;
  if (effectiveProtocol === "socks5") {
    proxyDirective = "SOCKS5 " + safeHost + ":" + safePort + fallbackSuffix;
  } else if (effectiveProtocol === "https") {
    proxyDirective = "HTTPS " + safeHost + ":" + safePort + fallbackSuffix;
  }

  // Sinkhole for blocked domains: a dead proxy WITHOUT a DIRECT fallback.
  // With "...; DIRECT" Chrome silently falls back to a direct connection
  // whenever the proxy is unreachable, which defeats blocking entirely.
  const blockDirective = "PROXY 127.0.0.1:0";
  const defaultDirective = profile.defaultPolicy === "proxy" ? proxyDirective : "DIRECT";

  const toAsciiComment = (str: string): string => {
    return str.replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();
  };

  const safeProfileName = toAsciiComment(String(profile.name || "Default")) || "Default";
  const safeDefaultPolicy = profile.defaultPolicy === "proxy" ? "PROXY" : "DIRECT";
  const codeLines: string[] = [];
  codeLines.push(`// Profile: ${safeProfileName} (Policy: Default ${safeDefaultPolicy})`);
  codeLines.push(`// Generated: ${new Date().toISOString()}`);
  codeLines.push(`function FindProxyForURL(url, host) {`);
  codeLines.push(`  host = ("" + host).toLowerCase();`);
  codeLines.push(`  if (isPlainHostName(host) || host === "localhost" || host === "127.0.0.1") { return "DIRECT"; }`);

  const MAX_PAC_TOTAL_ENTRIES = 10000;
  let totalEntriesCount = 0;

  // Active rules
  const activeRules = profile.rules.filter((r) => r.enabled);
  for (const rule of activeRules) {
    if (totalEntriesCount >= MAX_PAC_TOTAL_ENTRIES) break;

    const domains = expandRuleDomains(rule);
    if (!domains.length) continue;

    // Security: rule names are emitted as PAC comments and must never be able
    // to break out of the comment (newline) or inject PAC directives.
    const safeRuleName = toAsciiComment(String(rule.name || "Rule").replace(/[\r\n"'\\;]/g, " ")).slice(0, 100) || "Rule";
    const safeAction = rule.action === "proxy" || rule.action === "block" || rule.action === "direct" ? rule.action : "proxy";
    const actionDirective =
      safeAction === "proxy" ? proxyDirective : safeAction === "block" ? blockDirective : "DIRECT";

    codeLines.push(`\n  // Rule: ${safeRuleName} -> ${safeAction.toUpperCase()}`);

    // Domain checks run directly; CIDR checks are collected separately and
    // emitted behind an IP-literal guard (see below).
    const domainChecks: string[] = [];
    const cidrChecks: string[] = [];
    const seenInRule = new Set<string>();

    for (const rawDomain of domains) {
      if (totalEntriesCount >= MAX_PAC_TOTAL_ENTRIES) break;

      // Security: Strip dangerous characters to prevent script injection in PAC
      let d = rawDomain.replace(/["'\\\r\n;]/g, "").trim().toLowerCase();
      if (!d || seenInRule.has(d)) continue;
      seenInRule.add(d);
      totalEntriesCount++;

      // Convert any IDN/Cyrillic domain to Punycode ASCII
      d = toPunycodeDomain(d);

      if (d.includes("/")) {
        // CIDR subnet
        const [ip, maskStr] = d.split("/");
        const maskNum = parseInt(maskStr, 10);
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip) && !isNaN(maskNum) && maskNum >= 0 && maskNum <= 32) {
          cidrChecks.push(`isInNet(host, "${ip}", "${maskToSubnet(maskNum)}")`);
        }
      } else if (d.startsWith("*.")) {
        const root = d.substring(2);
        domainChecks.push(`(dnsDomainIs(host, "${root}") || host === "${root}")`);
      } else if (d.startsWith(".")) {
        domainChecks.push(`dnsDomainIs(host, "${d.substring(1)}")`);
      } else {
        domainChecks.push(`(host === "${d}" || dnsDomainIs(host, ".${d}"))`);
      }
    }

    // Semantics change (deliberate): isInNet(host, ...) with a DNS name forces
    // the browser to do a SYNCHRONOUS DNS resolve on every request - the
    // default corporate CIDR rules (10/8 etc.) used to freeze the UI whenever
    // the corporate DNS was slow or unreachable. CIDR checks now match only
    // hosts that are already IP literals; intranet hostnames resolving into
    // RFC1918 ranges must be covered by domain rules (e.g. *.corp.local).
    const IP_LITERAL_GUARD = `/^\\d{1,3}(\\.\\d{1,3}){3}$/.test(host)`;
    let condition: string;
    if (cidrChecks.length && domainChecks.length) {
      condition = `${domainChecks.join(" ||\n    ")} ||\n    (${IP_LITERAL_GUARD} && (${cidrChecks.join(" || ")}))`;
    } else if (cidrChecks.length) {
      condition = `${IP_LITERAL_GUARD} && (${cidrChecks.join(" || ")})`;
    } else {
      condition = domainChecks.join(" ||\n    ");
    }

    codeLines.push(`  if (\n    ${condition}\n  ) {\n    return "${actionDirective}";\n  }`);
  }

  codeLines.push(`\n  // Default fallback policy`);
  codeLines.push(`  return "${defaultDirective}";`);
  codeLines.push(`}`);

  // Guarantee that the generated PAC script is 100% 7-bit ASCII (Chrome pacScript.data requirement)
  const pacResult = (codeLines.join("\n") + "\n").replace(/[^\x00-\x7F]/g, "");
  if (pacResult.length > 512 * 1024) {
    console.warn(`[routing] Warning: generated PAC script size (${Math.round(pacResult.length / 1024)} KB) exceeds 512 KB recommendation`);
  }
  return pacResult;
}

function maskToSubnet(bits: number): string {
  const mask = [];
  for (let i = 0; i < 4; i++) {
    const n = Math.min(bits, 8);
    mask.push(256 - Math.pow(2, 8 - n));
    bits -= n;
  }
  return mask.join(".");
}
