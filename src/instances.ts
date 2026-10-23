import "./loadEnv.js";
import fs from "node:fs";
import { ProxyConfiguration, ExtensionInstance, DesktopInstance } from "./types.js";
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
  const clean = String(instanceId || "").trim();
  if (!clean || !/^[a-zA-Z0-9_\-\.]{1,128}$/.test(clean) || clean === "." || clean === "..") {
    throw new Error("Invalid instanceId");
  }

  if (
    clean === "__proto__" ||
    clean === "constructor" ||
    clean === "prototype" ||
    clean in Object.prototype
  ) {
    throw new Error("Forbidden instanceId");
  }
  return clean;
}

function isUnsafeObjectId(id: string): boolean {
  return (
    id === "__proto__" ||
    id === "constructor" ||
    id === "prototype" ||
    id in Object.prototype
  );
}

// Load persistent instance assignments (group & assigned profile, token enrollment, desktop pairing)
let persistentMeta: Record<
  string,
  {
    group?: string;
    assignedProfileId?: string;
    assignedProxyId?: string;
    tokenHash?: string;
    enrolledAt?: string;
    revoked?: boolean;
    username?: string;
    pairedAppId?: string;
    pairedHostname?: string;
    verifiedByApp?: boolean;
  }
> = Object.create(null);
try {
  if (fs.existsSync(INSTANCES_META_PATH)) {
    const raw = fs.readFileSync(INSTANCES_META_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      persistentMeta = Object.assign(Object.create(null), persistentMeta, parsed);
      delete (persistentMeta as any)["__proto__"];
      delete (persistentMeta as any)["constructor"];
      delete (persistentMeta as any)["prototype"];
    }
  }
} catch {}

function saveInstancesMeta() {
  try {
    writeJsonAtomic(INSTANCES_META_PATH, persistentMeta);
  } catch (e) {
    console.error("[instances] Error saving instances meta:", e);
  }
}

export function registerHeartbeat(
  dataOrId: string | {
    instanceId: string;
    ip: string;
    version: string;
    extensionId?: string;
    userAgent?: string;
    activeProxyMode?: string;
    group?: string;
  },
  opts?: {
    ip: string;
    version: string;
    extensionId?: string;
    userAgent?: string;
    activeProxyMode?: string;
    group?: string;
  }
): ExtensionInstance {
  const data = typeof dataOrId === "string"
    ? { instanceId: dataOrId, ip: opts?.ip || "127.0.0.1", version: opts?.version || "1.0.0", ...opts }
    : dataOrId;
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
    const hostPort = node && node.host ? (node.host.includes(":") && !node.host.startsWith("[") ? `[${node.host}]:${node.port}` : `${node.host}:${node.port}`) : "";
    appliedProxyName = node ? (node.name || hostPort) : "По умолчанию";
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
    username: meta.username || existing?.username,
    pairedAppId: meta.pairedAppId || existing?.pairedAppId,
    pairedHostname: meta.pairedHostname || existing?.pairedHostname,
    verifiedByApp: meta.verifiedByApp !== undefined ? meta.verifiedByApp : existing?.verifiedByApp,
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
  const cleanProxy = proxyId ? String(proxyId).trim() : undefined;
  persistentMeta[cleanId].assignedProxyId = cleanProxy || undefined;

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
      const hostPort = node && node.host ? (node.host.includes(":") && !node.host.startsWith("[") ? `[${node.host}]:${node.port}` : `${node.host}:${node.port}`) : "";
      existing.appliedProxyName = node ? (node.name || hostPort) : "По умолчанию";
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
    let appliedProxyName = item.appliedProxyName || "По умолчанию";
    if (item.assignedProxyId) {
      const node = getProxyById(item.assignedProxyId);
      const hostPort = node && node.host ? (node.host.includes(":") && !node.host.startsWith("[") ? `[${node.host}]:${node.port}` : `${node.host}:${node.port}`) : "";
      appliedProxyName = node ? (node.name || hostPort) : "По умолчанию";
    }
    list.push({ ...item, status, appliedProxyName });
  }

  // Sort by most recently active
  list.sort((a, b) => new Date(b.lastSync).getTime() - new Date(a.lastSync).getTime());
  return list;
}

const desktopInstancesMap = new Map<string, DesktopInstance>();
const MAX_DESKTOP_INSTANCES = 2000;

export function registerDesktopHeartbeat(data: {
  appInstanceId: string;
  hostname: string;
  username: string;
  os?: string;
  version: string;
  clientType?: string;
  ip: string;
  pairedExtension?: { instanceId: string; browser?: string };
}): DesktopInstance {
  const cleanAppId = assertSafeInstanceId(data.appInstanceId);
  const now = new Date().toISOString();

  if (desktopInstancesMap.size >= MAX_DESKTOP_INSTANCES && !desktopInstancesMap.has(cleanAppId)) {
    const oldestKey = desktopInstancesMap.keys().next().value;
    if (oldestKey !== undefined) {
      desktopInstancesMap.delete(oldestKey);
    }
  }

  const record: DesktopInstance = {
    appInstanceId: cleanAppId,
    hostname: String(data.hostname || "").slice(0, 128),
    username: String(data.username || "").slice(0, 128),
    os: data.os ? String(data.os).slice(0, 128) : undefined,
    version: String(data.version || "").slice(0, 32),
    clientType: data.clientType ? String(data.clientType).slice(0, 64) : undefined,
    ip: String(data.ip || "").slice(0, 64),
    lastSync: now,
    status: "ONLINE",
    assignedProxyId: persistentMeta[cleanAppId]?.assignedProxyId,
    appliedProxyName: persistentMeta[cleanAppId]?.assignedProxyId
      ? (getProxyById(persistentMeta[cleanAppId].assignedProxyId!)?.name || "Назначен")
      : "По умолчанию",
    pairedExtension: data.pairedExtension?.instanceId
      ? {
          instanceId: assertSafeInstanceId(data.pairedExtension.instanceId),
          browser: data.pairedExtension.browser ? String(data.pairedExtension.browser).slice(0, 64) : undefined,
        }
      : undefined,
  };

  desktopInstancesMap.delete(cleanAppId);
  desktopInstancesMap.set(cleanAppId, record);

  // Cross-link pairing with extension instance if present
  if (record.pairedExtension?.instanceId) {
    const cleanExtId = record.pairedExtension.instanceId;
    if (!persistentMeta[cleanExtId]) {
      persistentMeta[cleanExtId] = {};
    }
    persistentMeta[cleanExtId].username = record.username;
    persistentMeta[cleanExtId].pairedAppId = record.appInstanceId;
    persistentMeta[cleanExtId].pairedHostname = record.hostname;
    persistentMeta[cleanExtId].verifiedByApp = true;
    saveInstancesMeta();

    const existingExt = instancesMap.get(cleanExtId);
    if (existingExt) {
      existingExt.username = record.username;
      existingExt.pairedAppId = record.appInstanceId;
      existingExt.pairedHostname = record.hostname;
      existingExt.verifiedByApp = true;
    }
  }

  return record;
}

export function getActiveDesktopInstances(): DesktopInstance[] {
  const now = Date.now();
  const list: DesktopInstance[] = [];

  for (const item of desktopInstancesMap.values()) {
    const elapsedMs = now - new Date(item.lastSync).getTime();
    let status: "ONLINE" | "STALE" | "OFFLINE" = "ONLINE";
    if (elapsedMs > 15 * 60 * 1000) {
      status = "OFFLINE";
    } else if (elapsedMs > 6 * 60 * 1000) {
      status = "STALE";
    }
    const meta = persistentMeta[item.appInstanceId];
    const assignedProxyId = meta?.assignedProxyId !== undefined ? meta.assignedProxyId : item.assignedProxyId;
    let appliedProxyName = "По умолчанию";
    if (assignedProxyId) {
      const node = getProxyById(assignedProxyId);
      const hostPort = node && node.host ? (node.host.includes(":") && !node.host.startsWith("[") ? `[${node.host}]:${node.port}` : `${node.host}:${node.port}`) : "";
      appliedProxyName = node ? (node.name || hostPort) : "По умолчанию";
    }
    list.push({ ...item, status, assignedProxyId, appliedProxyName });
  }

  list.sort((a, b) => new Date(b.lastSync).getTime() - new Date(a.lastSync).getTime());
  return list;
}

export function setDesktopInstanceProxy(appInstanceId: string, proxyId: string | null): boolean {
  const cleanId = assertSafeInstanceId(appInstanceId);
  const cleanProxy = proxyId ? proxyId.trim() : null;
  if (!persistentMeta[cleanId]) {
    persistentMeta[cleanId] = {};
  }
  persistentMeta[cleanId].assignedProxyId = cleanProxy || undefined;
  saveInstancesMeta();

  const existing = desktopInstancesMap.get(cleanId);
  if (existing) {
    existing.assignedProxyId = persistentMeta[cleanId].assignedProxyId;
    if (existing.assignedProxyId) {
      const node = getProxyById(existing.assignedProxyId);
      const hostPort = node && node.host ? (node.host.includes(":") && !node.host.startsWith("[") ? `[${node.host}]:${node.port}` : `${node.host}:${node.port}`) : "";
      existing.appliedProxyName = node ? (node.name || hostPort) : "По умолчанию";
    } else {
      existing.appliedProxyName = "По умолчанию";
    }
  }
  return true;
}

export function deleteDesktopInstance(appInstanceId: string): boolean {
  if (isUnsafeObjectId(appInstanceId)) return false;
  const existedInMap = desktopInstancesMap.delete(appInstanceId);
  const existedInMeta = appInstanceId in persistentMeta;
  if (existedInMeta) {
    delete persistentMeta[appInstanceId];
    saveInstancesMeta();
  }
  return existedInMap || existedInMeta;
}

export function clearInstances() {
  instancesMap.clear();
  desktopInstancesMap.clear();
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

export const getAllInstances = getActiveInstances;


