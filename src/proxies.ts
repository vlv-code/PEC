import "./loadEnv.js";
import fs from "node:fs";
import net from "node:net";
import crypto from "node:crypto";
import { writeJsonAtomic, readJsonStore } from "./jsonStore.js";
import { getProxiesStorePath, getCredsStorePath } from "./storage.js";
import { updateProxyConfig, getProxyConfig } from "./instances.js";
import { atomicWriteCreds } from "./rotate.js";
import { ProxyNode } from "./types.js";

function validateHost(host: unknown): string {
  const cleanHost = String(host ?? "").trim();
  if (!cleanHost || !/^[a-zA-Z0-9.-]+$/.test(cleanHost)) {
    throw new Error("Invalid host format: only hostname or IP address without special characters allowed");
  }
  return cleanHost;
}

function validatePort(port: unknown): number {
  const portNum = parseInt(String(port), 10);
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
    throw new Error("Invalid port number: must be an integer between 1 and 65535");
  }
  return portNum;
}

function syncActiveProxyToConfigAndCreds(node: ProxyNode): void {
  updateProxyConfig({
    protocol: node.protocol,
    host: node.host,
    port: node.port,
  });

  atomicWriteCreds(getCredsStorePath(), {
    user: node.username || "",
    pass: node.password || "",
  });
}

export function getAllProxies(maskPasswords = false): ProxyNode[] {
  const storePath = getProxiesStorePath();
  const list = readJsonStore<ProxyNode[]>(storePath) || [];
  return list.map((node) => ({
    ...node,
    password: maskPasswords ? (node.password ? "********" : "") : node.password,
  }));
}

export function getProxyById(id: string): ProxyNode | undefined {
  const storePath = getProxiesStorePath();
  const list = readJsonStore<ProxyNode[]>(storePath) || [];
  const found = list.find((p) => p.id === id);
  return found ? { ...found } : undefined;
}

export function getActiveProxy(): ProxyNode | undefined {
  const storePath = getProxiesStorePath();
  const list = readJsonStore<ProxyNode[]>(storePath) || [];
  const found = list.find((p) => p.isActive && p.host && p.host !== "10.0.0.1" && p.host !== "0.0.0.0");
  return found ? { ...found } : undefined;
}

export type CreateProxyInput = Pick<ProxyNode, "host" | "port"> &
  Partial<Omit<ProxyNode, "id" | "createdAt" | "updatedAt" | "host" | "port">>;

export function createProxy(data: CreateProxyInput): ProxyNode {
  const cleanHost = validateHost(data.host);
  const cleanPort = validatePort(data.port);

  const storePath = getProxiesStorePath();
  const list = readJsonStore<ProxyNode[]>(storePath) || [];

  const isFirst = list.length === 0;
  const shouldBeActive = isFirst || Boolean(data.isActive);

  if (shouldBeActive) {
    for (const p of list) {
      p.isActive = false;
    }
  }

  const id = crypto.randomBytes(4).toString("hex");
  const now = new Date().toISOString();
  const tag = data.tag ? String(data.tag).trim() : `proxy-${id}`;
  const name = data.name ? String(data.name).trim() : tag;
  const protocol = data.protocol === "http" || data.protocol === "https" ? data.protocol : "socks5";

  const newNode: ProxyNode = {
    id,
    tag,
    name,
    type: data.type === "3x-ui" ? "3x-ui" : "manual",
    protocol,
    host: cleanHost,
    port: cleanPort,
    username: data.username,
    password: data.password,
    isActive: shouldBeActive,
    lastSync: data.lastSync,
    status: data.status || "OK",
    errorMessage: data.errorMessage,
    createdAt: now,
    updatedAt: now,
  };

  list.push(newNode);
  writeJsonAtomic(storePath, list);

  if (shouldBeActive) {
    syncActiveProxyToConfigAndCreds(newNode);
  }

  return { ...newNode };
}

export function updateProxy(id: string, updates: Partial<ProxyNode>): ProxyNode {
  const storePath = getProxiesStorePath();
  const list = readJsonStore<ProxyNode[]>(storePath) || [];
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) {
    throw new Error(`Proxy not found: ${id}`);
  }

  const existing = list[idx];
  const cleanUpdates: Partial<ProxyNode> = { ...updates };

  if (cleanUpdates.host !== undefined) {
    cleanUpdates.host = validateHost(cleanUpdates.host);
  }
  if (cleanUpdates.port !== undefined) {
    cleanUpdates.port = validatePort(cleanUpdates.port);
  }

  const willBeActive = cleanUpdates.isActive !== undefined ? Boolean(cleanUpdates.isActive) : existing.isActive;

  if (willBeActive && !existing.isActive) {
    for (const p of list) {
      p.isActive = false;
    }
  }

  const updatedNode: ProxyNode = {
    ...existing,
    ...cleanUpdates,
    id: existing.id,
    createdAt: existing.createdAt,
    isActive: willBeActive,
    updatedAt: new Date().toISOString(),
  };

  list[idx] = updatedNode;
  writeJsonAtomic(storePath, list);

  if (updatedNode.isActive) {
    syncActiveProxyToConfigAndCreds(updatedNode);
  }

  return { ...updatedNode };
}

export function deleteProxy(id: string): boolean {
  const storePath = getProxiesStorePath();
  const list = readJsonStore<ProxyNode[]>(storePath) || [];
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) {
    return false;
  }

  const wasActive = list[idx].isActive;
  list.splice(idx, 1);

  if (wasActive && list.length > 0) {
    list[0].isActive = true;
    list[0].updatedAt = new Date().toISOString();
    syncActiveProxyToConfigAndCreds(list[0]);
  }

  writeJsonAtomic(storePath, list);
  return true;
}

export function setActiveProxy(id: string): ProxyNode {
  const storePath = getProxiesStorePath();
  const list = readJsonStore<ProxyNode[]>(storePath) || [];
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) {
    throw new Error(`Proxy not found: ${id}`);
  }

  for (const p of list) {
    p.isActive = p.id === id;
  }
  list[idx].updatedAt = new Date().toISOString();

  writeJsonAtomic(storePath, list);
  syncActiveProxyToConfigAndCreds(list[idx]);

  return { ...list[idx] };
}

export function initDefaultProxyIfNeeded(): void {
  const storePath = getProxiesStorePath();
  const existing = readJsonStore<ProxyNode[]>(storePath);
  if (Array.isArray(existing) && existing.length > 0) {
    return;
  }

  let username: string | undefined;
  let password: string | undefined;
  try {
    const credsPath = getCredsStorePath();
    if (fs.existsSync(credsPath)) {
      const raw = JSON.parse(fs.readFileSync(credsPath, "utf-8"));
      if (raw && (raw.user || raw.pass)) {
        username = raw.user || undefined;
        password = raw.pass || undefined;
      }
    }
  } catch {
    // Ignore read errors
  }

  const cfg = getProxyConfig();
  const now = new Date().toISOString();
  const rawProto = (cfg.protocol || "socks5").toLowerCase();
  const protocol: "socks5" | "http" | "https" =
    rawProto === "http" || rawProto === "https" ? rawProto : "socks5";

  const isPlaceholder = !cfg.host || cfg.host === "10.0.0.1" || cfg.host === "0.0.0.0";
  const defaultNode: ProxyNode = {
    id: crypto.randomBytes(4).toString("hex"),
    tag: "default-proxy",
    name: `${protocol.toUpperCase()} Default`,
    type: "manual",
    protocol,
    host: cfg.host || "10.0.0.1",
    port: cfg.port || 10809,
    username,
    password,
    isActive: !isPlaceholder,
    status: isPlaceholder ? "ERROR" : "OK",
    errorMessage: isPlaceholder ? "Placeholder proxy host (10.0.0.1) - not configured" : undefined,
    createdAt: now,
    updatedAt: now,
  };

  writeJsonAtomic(storePath, [defaultNode]);
  syncActiveProxyToConfigAndCreds(defaultNode);
}

let lastProbeResult: { host: string; port: number; reachable: boolean; timestamp: number } | null = null;
const PROBE_CACHE_TTL_MS = 10000;

export async function probeProxyTcp(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  const cleanHost = String(host || "").trim();
  const cleanPort = Number(port);
  if (!cleanHost || !cleanPort || isNaN(cleanPort)) {
    return false;
  }

  // Fast path for known unreachable placeholders
  if (cleanHost === "10.0.0.1" || cleanHost === "0.0.0.0") {
    return false;
  }

  const now = Date.now();
  if (
    lastProbeResult &&
    lastProbeResult.host === cleanHost &&
    lastProbeResult.port === cleanPort &&
    now - lastProbeResult.timestamp < PROBE_CACHE_TTL_MS
  ) {
    return lastProbeResult.reachable;
  }

  const reachable = await new Promise<boolean>((resolve) => {
    let settled = false;
    const socket = new net.Socket();

    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));

    try {
      socket.connect(cleanPort, cleanHost);
    } catch {
      finish(false);
    }
  });

  lastProbeResult = { host: cleanHost, port: cleanPort, reachable, timestamp: now };
  return reachable;
}

