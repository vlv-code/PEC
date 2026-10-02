import "./loadEnv.js";
import fs from "node:fs";
import { ProxyConfiguration, ExtensionInstance } from "./types.js";
import { resolveProfileForInstance, getProfileById } from "./routing.js";
import { writeJsonAtomic } from "./jsonStore.js";
import { getProxyConfigPath, getInstancesMetaPath } from "./storage.js";
import { getActiveProxy, getProxyById } from "./proxies.js";

const CONFIG_PATH = getProxyConfigPath();
const INSTANCES_META_PATH = getInstancesMetaPath();

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
  routingMode: "pac",
  updatedAt: new Date().toISOString(),
};

let currentConfig: ProxyConfiguration = { ...DEFAULT_CONFIG };

// Load persistent configuration if available
try {
  if (fs.existsSync(CONFIG_PATH)) {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    currentConfig = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    if (!currentConfig.routingMode) {
      currentConfig.routingMode = "pac";
    }
  }
} catch (e) {
  console.warn("[instances] Failed to read proxy_config.json, using defaults:", e);
}

export function getProxyConfig(): ProxyConfiguration {
  try {
    const active = getActiveProxy();
    if (active) {
      return {
        ...currentConfig,
        protocol: active.protocol,
        host: active.host,
        port: active.port,
      };
    }
  } catch {
    // If store is unreadable or during circular bootstrap, fall back to currentConfig
  }
  return { ...currentConfig };
}

export function updateProxyConfig(updates: Partial<ProxyConfiguration>): ProxyConfiguration {
  if (updates.routingMode !== undefined) {
    if (updates.routingMode !== "pac" && updates.routingMode !== "fixed") {
      throw new Error("Invalid routingMode: must be 'pac' or 'fixed'");
    }
  }

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
    writeJsonAtomic(CONFIG_PATH, currentConfig);
  } catch (err) {
    console.error("[instances] Failed to persist proxy config:", err);
  }

  return { ...currentConfig };
}

// In-memory instances registry (key: instanceId) with max capacity limit.
// A JS Map iterates in insertion order, so re-inserting on every heartbeat
// gives true O(1) LRU eviction (previously an O(n) scan over 2000 records
// ran on every registration once the cap was hit).
const MAX_INSTANCES = 2000;
const MAX_PERSISTENT_META = 5000;
const instancesMap = new Map<string, ExtensionInstance>();

/**
 * Validate an instance ID before it is used as an object key or Map key.
 * Blocks prototype-pollution vectors (__proto__/constructor/prototype) and
 * caps the length; anything invalid is rejected loudly.
 */
function assertSafeInstanceId(instanceId: string): string {
  const clean = String(instanceId || "").trim().slice(0, 128);
  if (!clean) {
    throw new Error("Invalid instanceId");
  }
  if (clean === "__proto__" || clean === "constructor" || clean === "prototype") {
    throw new Error("Forbidden instanceId");
  }
  return clean;
}

function isUnsafeObjectId(id: string): boolean {
  return id === "__proto__" || id === "constructor" || id === "prototype";
}

// Load persistent instance assignments (group & assigned profile, token enrollment)
const persistentMeta: Record<
  string,
  {
    group?: string;
    assignedProfileId?: string;
    assignedProxyId?: string;
    tokenHash?: string;
    enrolledAt?: string;
    revoked?: boolean;
  }
> = {};
try {
  if (fs.existsSync(INSTANCES_META_PATH)) {
    const raw = fs.readFileSync(INSTANCES_META_PATH, "utf-8");
    Object.assign(persistentMeta, JSON.parse(raw));
  }
} catch {}

function saveInstancesMeta() {
  try {
    writeJsonAtomic(INSTANCES_META_PATH, persistentMeta);
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
  const cleanId = assertSafeInstanceId(data.instanceId);

  // Memory exhaustion protection: evict the least-recently-active instance.
  // Insertion order == recency order because we re-insert on every heartbeat.
  if (instancesMap.size >= MAX_INSTANCES && !instancesMap.has(cleanId)) {
    const oldestKey = instancesMap.keys().next().value;
    if (oldestKey !== undefined) {
      instancesMap.delete(oldestKey);
    }
  }

  const existing = instancesMap.get(cleanId);
  const now = new Date().toISOString();
  const meta = persistentMeta[cleanId] || {};

  const effectiveGroup = String(data.group || meta.group || existing?.group || "Default Fleet").slice(0, 64);
  const effectiveProfileId = meta.assignedProfileId || existing?.assignedProfileId;
  const resolvedProfile = effectiveProfileId
    ? getProfileById(effectiveProfileId)
    : resolveProfileForInstance(cleanId, effectiveGroup);

  const effectiveProxyId = meta.assignedProxyId !== undefined ? meta.assignedProxyId : existing?.assignedProxyId;
  let appliedProxyName: string | undefined = "По умолчанию";
  if (effectiveProxyId) {
    const node = getProxyById(effectiveProxyId);
    appliedProxyName = node ? (node.name || `${node.host}:${node.port}`) : "По умолчанию";
  }

  const record: ExtensionInstance = {
    instanceId: cleanId,
    ip: String(data.ip || "").slice(0, 64),
    version: String(data.version || "").slice(0, 32),
    extensionId: (data.extensionId || existing?.extensionId || "").slice(0, 64),
    userAgent: (data.userAgent || existing?.userAgent || "").slice(0, 256),
    lastSync: now,
    syncCount: (existing?.syncCount || 0) + 1,
    status: "ONLINE",
    activeProxyMode: String(data.activeProxyMode || existing?.activeProxyMode || getProxyConfig().protocol).slice(0, 64),
    group: effectiveGroup,
    assignedProfileId: effectiveProfileId,
    appliedProfileName: resolvedProfile?.name || "Default Profile",
    assignedProxyId: effectiveProxyId,
    appliedProxyName: appliedProxyName,
    tokenHash: meta.tokenHash || existing?.tokenHash,
    enrolledAt: meta.enrolledAt || existing?.enrolledAt,
    revoked: meta.revoked !== undefined ? meta.revoked : existing?.revoked,
  };

  instancesMap.delete(cleanId); // refresh insertion order (LRU recency)
  instancesMap.set(cleanId, record);
  return record;
}

export function assignInstanceProfile(instanceId: string, profileId?: string, group?: string) {
  const cleanId = assertSafeInstanceId(instanceId);
  if (!persistentMeta[cleanId]) {
    persistentMeta[cleanId] = {};
  }
  if (profileId !== undefined) {
    persistentMeta[cleanId].assignedProfileId = profileId || undefined;
  }
  if (group !== undefined) {
    persistentMeta[cleanId].group = group;
  }

  // Cap the persistent meta: an unbounded stream of unique instance IDs
  // previously grew this object (and its on-disk JSON) without limit.
  const metaKeys = Object.keys(persistentMeta);
  if (metaKeys.length > MAX_PERSISTENT_META) {
    for (const k of metaKeys.slice(0, metaKeys.length - MAX_PERSISTENT_META)) {
      delete persistentMeta[k];
    }
  }
  saveInstancesMeta();

  const existing = instancesMap.get(cleanId);
  if (existing) {
    existing.group = persistentMeta[cleanId].group || existing.group;
    existing.assignedProfileId = persistentMeta[cleanId].assignedProfileId;
    const resolved = existing.assignedProfileId
      ? getProfileById(existing.assignedProfileId)
      : resolveProfileForInstance(cleanId, existing.group);
    existing.appliedProfileName = resolved?.name || "Default Profile";
  }
}

export function assignInstanceProxy(instanceId: string, proxyId?: string) {
  const cleanId = assertSafeInstanceId(instanceId);
  if (!persistentMeta[cleanId]) {
    persistentMeta[cleanId] = {};
  }
  persistentMeta[cleanId].assignedProxyId = proxyId ? String(proxyId).trim() : undefined;

  const metaKeys = Object.keys(persistentMeta);
  if (metaKeys.length > MAX_PERSISTENT_META) {
    for (const k of metaKeys.slice(0, metaKeys.length - MAX_PERSISTENT_META)) {
      delete persistentMeta[k];
    }
  }
  saveInstancesMeta();

  const existing = instancesMap.get(cleanId);
  if (existing) {
    existing.assignedProxyId = persistentMeta[cleanId].assignedProxyId;
    if (existing.assignedProxyId) {
      const node = getProxyById(existing.assignedProxyId);
      existing.appliedProxyName = node ? (node.name || `${node.host}:${node.port}`) : "По умолчанию";
    } else {
      existing.appliedProxyName = "По умолчанию";
    }
  }
}

/**
 * Remove an instance from the active registry and the persistent meta store
 * (used for diagnostics cleanup after synthetic /api/sync tests).
 */
export function deleteInstance(instanceId: string): boolean {
  if (isUnsafeObjectId(instanceId)) return false;
  const existedInMap = instancesMap.delete(instanceId);
  const existedInMeta = instanceId in persistentMeta;
  if (existedInMeta) {
    delete persistentMeta[instanceId];
    saveInstancesMeta();
  }
  return existedInMap || existedInMeta;
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

/**
 * Enroll a newly generated per-instance token hash.
 */
export function enrollInstanceToken(instanceId: string, tokenHash: string): void {
  const cleanId = assertSafeInstanceId(instanceId);
  if (!persistentMeta[cleanId]) {
    persistentMeta[cleanId] = {};
  }
  const now = new Date().toISOString();
  persistentMeta[cleanId].tokenHash = tokenHash;
  persistentMeta[cleanId].enrolledAt = now;
  persistentMeta[cleanId].revoked = false;
  saveInstancesMeta();

  const existing = instancesMap.get(cleanId);
  if (existing) {
    existing.tokenHash = tokenHash;
    existing.enrolledAt = now;
    existing.revoked = false;
  }
}

/**
 * Revoke an instance's per-instance token and mark it revoked.
 */
export function revokeInstanceToken(instanceId: string): boolean {
  if (isUnsafeObjectId(instanceId)) return false;
  let changed = false;
  if (persistentMeta[instanceId]) {
    delete persistentMeta[instanceId].tokenHash;
    delete persistentMeta[instanceId].enrolledAt;
    persistentMeta[instanceId].revoked = true;
    changed = true;
    saveInstancesMeta();
  }
  const existing = instancesMap.get(instanceId);
  if (existing) {
    existing.tokenHash = undefined;
    existing.enrolledAt = undefined;
    existing.revoked = true;
    changed = true;
  }
  return changed;
}

/**
 * Retrieve persistent metadata (tokenHash, enrolledAt, revoked) for an instance.
 */
export function getInstanceMeta(instanceId: string): { group?: string; assignedProfileId?: string; assignedProxyId?: string; tokenHash?: string; enrolledAt?: string; revoked?: boolean } | undefined {
  if (isUnsafeObjectId(instanceId)) return undefined;
  return persistentMeta[instanceId];
}

