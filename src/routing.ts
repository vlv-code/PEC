import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { GeoPreset, RoutingProfile, RoutingRule, ProxyConfiguration } from "./types.js";

const PROFILES_FILE = path.resolve(process.env.ROUTING_PROFILES_PATH || "./routing_profiles.json");

export const GEO_PRESETS: GeoPreset[] = [
  {
    id: "preset:ai_services",
    name: "AI & LLM Services (OpenAI, Claude, Perplexity, Copilot)",
    category: "ai",
    description: "Major AI development and chat platforms",
    domains: [
      "openai.com",
      "*.openai.com",
      "chatgpt.com",
      "*.chatgpt.com",
      "anthropic.com",
      "*.anthropic.com",
      "claude.ai",
      "*.claude.ai",
      "perplexity.ai",
      "*.perplexity.ai",
      "huggingface.co",
      "*.huggingface.co",
      "githubcopilot.com",
      "*.githubcopilot.com",
      "midjourney.com",
      "*.midjourney.com",
    ],
  },
  {
    id: "preset:social_media",
    name: "Global Media & Social (X/Twitter, LinkedIn, YouTube, Meta)",
    category: "social",
    description: "International social networks and video platforms",
    domains: [
      "x.com",
      "*.x.com",
      "twitter.com",
      "*.twitter.com",
      "twimg.com",
      "*.twimg.com",
      "instagram.com",
      "*.instagram.com",
      "facebook.com",
      "*.facebook.com",
      "linkedin.com",
      "*.linkedin.com",
      "youtube.com",
      "*.youtube.com",
      "googlevideo.com",
      "*.googlevideo.com",
    ],
  },
  {
    id: "preset:corporate_internal",
    name: "Corporate Intranet & Private RFC1918 Subnets",
    category: "internal",
    description: "Internal domains and private network ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)",
    domains: [
      "*.local",
      "*.corp.local",
      "*.internal",
      "localhost",
      "127.0.0.1",
      "10.0.0.0/8",
      "172.16.0.0/12",
      "192.168.0.0/16",
    ],
  },
  {
    id: "preset:geosite_ru",
    name: "Geo: Russia (.RU / .РФ / Yandex / VK / Gosuslugi)",
    category: "ru",
    description: "National Russian domain zone and state/banking services",
    domains: [
      "*.ru",
      "*.su",
      "*.рф",
      "*.yandex.ru",
      "*.ya.ru",
      "*.vk.com",
      "*.mail.ru",
      "*.gosuslugi.ru",
      "*.sberbank.ru",
      "*.tinkoff.ru",
      "*.ozon.ru",
      "*.wildberries.ru",
    ],
  },
  {
    id: "preset:ad_telemetry_block",
    name: "Security: Ads, Trackers & Malicious Telemetry Sinkhole",
    category: "security",
    description: "Common tracking, telemetry, and advertising networks to sinkhole",
    domains: [
      "*.doubleclick.net",
      "*.google-analytics.com",
      "*.adservice.google.com",
      "*.telemetry.corp",
      "*.adnxs.com",
      "*.scorecardresearch.com",
    ],
  },
];

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
    fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2), "utf-8");
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

export function saveProfile(profile: Partial<RoutingProfile>): RoutingProfile {
  const existingIdx = profiles.findIndex((p) => p.id === profile.id);
  const now = new Date().toISOString();

  if (profile.isDefault) {
    for (const p of profiles) {
      p.isDefault = false;
    }
  }

  if (existingIdx >= 0) {
    profiles[existingIdx] = {
      ...profiles[existingIdx],
      ...profile,
      updatedAt: now,
    } as RoutingProfile;
    persistProfiles();
    return profiles[existingIdx];
  } else {
    const newProfile: RoutingProfile = {
      id: profile.id || "prof_" + crypto.randomBytes(4).toString("hex"),
      name: profile.name || "Custom Profile",
      description: profile.description || "",
      defaultPolicy: profile.defaultPolicy || "direct",
      rules: profile.rules || [],
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
function expandRuleDomains(rule: RoutingRule): string[] {
  if (rule.targetType === "preset" && rule.pattern.startsWith("preset:")) {
    const preset = GEO_PRESETS.find((p) => p.id === rule.pattern);
    return preset ? preset.domains : [];
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

  const safeHost = String(proxyConfig.host || "10.0.0.1").replace(/[^a-zA-Z0-9.-]/g, "");
  const safePort = Math.min(65535, Math.max(1, parseInt(String(proxyConfig.port || "10809"), 10) || 10809));

  let proxyDirective = "PROXY " + safeHost + ":" + safePort + "; DIRECT";
  if (proxyConfig.protocol === "socks5") {
    proxyDirective = "SOCKS5 " + safeHost + ":" + safePort + "; DIRECT";
  } else if (proxyConfig.protocol === "https") {
    proxyDirective = "HTTPS " + safeHost + ":" + safePort + "; DIRECT";
  }

  const blockDirective = "PROXY 127.0.0.1:0; DIRECT"; // Sinkhole for blocked domains
  const defaultDirective = profile.defaultPolicy === "proxy" ? proxyDirective : "DIRECT";

  const safeProfileName = String(profile.name || "Default").replace(/[\r\n]/g, " ");
  const codeLines: string[] = [];
  codeLines.push(`// Profile: ${safeProfileName} (Policy: Default ${profile.defaultPolicy.toUpperCase()})`);
  codeLines.push(`// Generated: ${new Date().toISOString()}`);
  codeLines.push(`function FindProxyForURL(url, host) {`);
  codeLines.push(`  host = ("" + host).toLowerCase();`);
  codeLines.push(`  if (isPlainHostName(host) || host === "localhost" || host === "127.0.0.1") { return "DIRECT"; }`);

  // Active rules
  const activeRules = profile.rules.filter((r) => r.enabled);
  for (const rule of activeRules) {
    const domains = expandRuleDomains(rule);
    if (!domains.length) continue;

    const actionDirective =
      rule.action === "proxy" ? proxyDirective : rule.action === "block" ? blockDirective : "DIRECT";

    codeLines.push(`\n  // Rule: ${rule.name} -> ${rule.action.toUpperCase()}`);

    const checks: string[] = [];
    for (const rawDomain of domains) {
      // Security: Strip dangerous characters to prevent script injection in PAC
      const d = rawDomain.replace(/["'\\\r\n;]/g, "").trim().toLowerCase();
      if (!d) continue;

      if (d.includes("/")) {
        // CIDR subnet
        const [ip, maskStr] = d.split("/");
        const maskNum = parseInt(maskStr, 10);
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip) && !isNaN(maskNum) && maskNum >= 0 && maskNum <= 32) {
          checks.push(`isInNet(host, "${ip}", "${maskToSubnet(maskNum)}")`);
        }
      } else if (d.startsWith("*.")) {
        const root = d.substring(2);
        checks.push(`(dnsDomainIs(host, "${root}") || host === "${root}")`);
      } else if (d.startsWith(".")) {
        checks.push(`dnsDomainIs(host, "${d.substring(1)}")`);
      } else {
        checks.push(`(host === "${d}" || dnsDomainIs(host, ".${d}"))`);
      }
    }

    // Chunk checks for readability
    codeLines.push(`  if (\n    ${checks.join(" ||\n    ")}\n  ) {\n    return "${actionDirective}";\n  }`);
  }

  codeLines.push(`\n  // Default fallback policy`);
  codeLines.push(`  return "${defaultDirective}";`);
  codeLines.push(`}`);

  return codeLines.join("\n") + "\n";
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
