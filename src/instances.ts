import fs from "node:fs";
import path from "node:path";
import { ProxyConfiguration, ExtensionInstance } from "./types.js";
import { resolveProfileForInstance, getProfileById } from "./routing.js";

const CONFIG_PATH = path.resolve(process.env.PROXY_CONFIG_PATH || "./proxy_config.json");
const INSTANCES_META_PATH = path.resolve(process.env.INSTANCES_META_PATH || "./instances_meta.json");

const DEFAULT_CONFIG: ProxyConfiguration = {
  enabled: true,
  protocol: "http",
  host: process.env.PROXY_HOST || "10.0.0.1",
  port: parseInt(process.env.PROXY_PORT || "10809", 10),
  bypassList: ["<local>", "127.0.0.1", "localhost", "*.corp.local"],
  pacScript: "",
  pacUrl: "/proxy.pac",
  syncIntervalMs: 5 * 60 * 1000, // 5 minutes
  killSwitch: false,
  updatedAt: new Date().toISOString(),
};

let currentConfig: ProxyConfiguration = { ...DEFAULT_CONFIG };

// Load persistent configuration if available
try {
  if (fs.existsSync(CONFIG_PATH)) {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    currentConfig = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  }
} catch (e) {
  console.warn("[instances] Failed to read proxy_config.json, using defaults:", e);
}

export function getProxyConfig(): ProxyConfiguration {
  return { ...currentConfig };
}

export function updateProxyConfig(updates: Partial<ProxyConfiguration>): ProxyConfiguration {
  if (updates.host !== undefined) {
    const cleanHost = String(updates.host).trim();
    if (!/^[a-zA-Z0-9.-]+$/.test(cleanHost)) {
      throw new Error("Invalid host format: only hostname or IP address without special characters allowed");
    }
    updates.host = cleanHost;
  }

  if (updates.port !== undefined) {
    const portNum = parseInt(String(updates.port), 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      throw new Error("Invalid port number: must be an integer between 1 and 65535");
    }
    updates.port = portNum;
  }

  currentConfig = {
    ...currentConfig,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(currentConfig, null, 2), "utf-8");
  } catch (err) {
    console.error("[instances] Failed to persist proxy config:", err);
  }

  return { ...currentConfig };
}

// In-memory instances registry (key: instanceId) with max capacity limit
const MAX_INSTANCES = 2000;
const instancesMap = new Map<string, ExtensionInstance>();

// Load persistent instance assignments (group & assigned profile)
const persistentMeta: Record<string, { group?: string; assignedProfileId?: string }> = {};
try {
  if (fs.existsSync(INSTANCES_META_PATH)) {
    const raw = fs.readFileSync(INSTANCES_META_PATH, "utf-8");
    Object.assign(persistentMeta, JSON.parse(raw));
  }
} catch {}

function saveInstancesMeta() {
  try {
    fs.writeFileSync(INSTANCES_META_PATH, JSON.stringify(persistentMeta, null, 2), "utf-8");
  } catch (e) {
    console.error("[instances] Error saving instances meta:", e);
  }
}

export function registerHeartbeat(data: {
  instanceId: string;
  ip: string;
  version: string;
  extensionId?: string;
  userAgent?: string;
  activeProxyMode?: string;
  group?: string;
}): ExtensionInstance {
  const cleanId = String(data.instanceId || "").slice(0, 128);
  if (!cleanId) {
    throw new Error("Invalid instanceId");
  }

  // Memory exhaustion protection: evict oldest instance if limit is reached
  if (instancesMap.size >= MAX_INSTANCES && !instancesMap.has(cleanId)) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [k, v] of instancesMap.entries()) {
      const t = new Date(v.lastSync).getTime();
      if (t < oldestTime) {
        oldestTime = t;
        oldestKey = k;
      }
    }
    if (oldestKey) {
      instancesMap.delete(oldestKey);
    }
  }

  const existing = instancesMap.get(cleanId);
  const now = new Date().toISOString();
  const meta = persistentMeta[cleanId] || {};

  const effectiveGroup = data.group || meta.group || existing?.group || "Default Fleet";
  const effectiveProfileId = meta.assignedProfileId || existing?.assignedProfileId;
  const resolvedProfile = effectiveProfileId
    ? getProfileById(effectiveProfileId)
    : resolveProfileForInstance(cleanId, effectiveGroup);

  const record: ExtensionInstance = {
    instanceId: cleanId,
    ip: String(data.ip || "").slice(0, 64),
    version: String(data.version || "").slice(0, 32),
    extensionId: (data.extensionId || existing?.extensionId || "").slice(0, 64),
    userAgent: (data.userAgent || existing?.userAgent || "").slice(0, 256),
    lastSync: now,
    syncCount: (existing?.syncCount || 0) + 1,
    status: "ONLINE",
    activeProxyMode: data.activeProxyMode || existing?.activeProxyMode || currentConfig.protocol,
    group: effectiveGroup,
    assignedProfileId: effectiveProfileId,
    appliedProfileName: resolvedProfile?.name || "Default Profile",
  };

  instancesMap.set(cleanId, record);
  return record;
}

export function assignInstanceProfile(instanceId: string, profileId?: string, group?: string) {
  if (!persistentMeta[instanceId]) {
    persistentMeta[instanceId] = {};
  }
  if (profileId !== undefined) {
    persistentMeta[instanceId].assignedProfileId = profileId || undefined;
  }
  if (group !== undefined) {
    persistentMeta[instanceId].group = group;
  }
  saveInstancesMeta();

  const existing = instancesMap.get(instanceId);
  if (existing) {
    existing.group = persistentMeta[instanceId].group || existing.group;
    existing.assignedProfileId = persistentMeta[instanceId].assignedProfileId;
    const resolved = existing.assignedProfileId
      ? getProfileById(existing.assignedProfileId)
      : resolveProfileForInstance(instanceId, existing.group);
    existing.appliedProfileName = resolved?.name || "Default Profile";
  }
}

export function getActiveInstances(): ExtensionInstance[] {
  const now = Date.now();
  const list: ExtensionInstance[] = [];

  for (const item of instancesMap.values()) {
    const elapsedMs = now - new Date(item.lastSync).getTime();
    let status: "ONLINE" | "STALE" | "OFFLINE" = "ONLINE";
    if (elapsedMs > 15 * 60 * 1000) {
      status = "OFFLINE";
    } else if (elapsedMs > 6 * 60 * 1000) {
      status = "STALE";
    }
    list.push({ ...item, status });
  }

  // Sort by most recently active
  list.sort((a, b) => new Date(b.lastSync).getTime() - new Date(a.lastSync).getTime());
  return list;
}

export function clearInstances() {
  instancesMap.clear();
}
