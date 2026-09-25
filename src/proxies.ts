import "./loadEnv.js";
import fs from "node:fs";
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

  if (node.username || node.password) {
    atomicWriteCreds(getCredsStorePath(), {
      user: node.username || "",
      pass: node.password || "",
    });
  }
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
  const found = list.find((p) => p.isActive);
  return found ? { ...found } : undefined;
}

export type CreateProxyInput = Omit<ProxyNode, "id" | "createdAt" | "updatedAt"> & {
  tag?: string;
  name?: string;
  type?: "3x-ui" | "manual";
  protocol?: "socks5" | "http" | "https";
  isActive?: boolean;
};

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

  const defaultNode: ProxyNode = {
    id: crypto.randomBytes(4).toString("hex"),
    tag: "default-proxy",
    name: `${protocol.toUpperCase()} Default`,
    type: "manual",
    protocol,
    host: cfg.host || "127.0.0.1",
    port: cfg.port || 10808,
    username,
    password,
    isActive: true,
    status: "OK",
    createdAt: now,
    updatedAt: now,
  };

  writeJsonAtomic(storePath, [defaultNode]);
  syncActiveProxyToConfigAndCreds(defaultNode);
}
