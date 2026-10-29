import "./loadEnv.js";
import fs from "node:fs";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import crypto from "node:crypto";
import { writeJsonAtomic, readJsonStore } from "./jsonStore.js";
import { getProxiesStorePath, getCredsStorePath } from "./storage.js";
import { updateProxyConfig, getProxyConfig } from "./instances.js";
import { atomicWriteCreds } from "./rotate.js";
import { ProxyNode, ProxyCheckResult } from "./types.js";

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
    panelId: data.panelId,
    protocol,
    host: cleanHost,
    port: cleanPort,
    username: data.username,
    password: data.password,
    isActive: shouldBeActive,
    enabled: data.enabled !== undefined ? data.enabled : true,
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

export function saveProxy(data: CreateProxyInput & { id?: string }): ProxyNode {
  if (data.id && getProxyById(data.id)) {
    return updateProxy(data.id, data);
  }
  return createProxy(data);
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

const probeCache = new Map<string, { reachable: boolean; timestamp: number }>();
const PROBE_CACHE_TTL_MS = 10000;

export async function probeProxyTcp(host: string, port: number, timeoutMs = 1500, bypassCache = false): Promise<boolean> {
  const cleanHost = String(host || "").trim();
  const cleanPort = Number(port);
  if (!cleanHost || !cleanPort || isNaN(cleanPort)) {
    return false;
  }

  // Fast path for known unreachable placeholders
  if (cleanHost === "10.0.0.1" || cleanHost === "0.0.0.0") {
    return false;
  }

  const cacheKey = `${cleanHost}:${cleanPort}`;
  const now = Date.now();
  const cached = probeCache.get(cacheKey);
  if (
    !bypassCache &&
    cached &&
    now - cached.timestamp < PROBE_CACHE_TTL_MS
  ) {
    return cached.reachable;
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

  probeCache.set(cacheKey, { reachable, timestamp: now });
  return reachable;
}

function tryUpdateStoredProxyCheck(id: string, result: ProxyCheckResult): void {
  try {
    const storePath = getProxiesStorePath();
    const list = readJsonStore<ProxyNode[]>(storePath) || [];
    const idx = list.findIndex((p) => p.id === id);
    if (idx !== -1) {
      list[idx].status = result.status === "ONLINE" ? "OK" : "ERROR";
      list[idx].latencyMs = result.latencyMs;
      if (result.egressIp) list[idx].egressIp = result.egressIp;
      if (result.geoCountry) list[idx].geoCountry = result.geoCountry;
      list[idx].lastCheck = result.checkedAt;
      list[idx].errorMessage = result.error;
      list[idx].updatedAt = new Date().toISOString();
      writeJsonAtomic(storePath, list);
    }
  } catch {
    // Ignore store write errors during probes
  }
}

function probeHttpProxy(
  node: ProxyNode,
  targetUrl: string,
  timeoutMs: number
): Promise<{ latencyMs: number; egressIp?: string; geoCountry?: string }> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(targetUrl);
    } catch {
      parsedUrl = new URL("http://api.ipify.org?format=json");
    }

    let authHeader = "";
    if (node.username) {
      authHeader = "Basic " + Buffer.from(`${node.username}:${node.password || ""}`).toString("base64");
    }

    const headers: Record<string, string> = {
      Host: parsedUrl.host,
      "User-Agent": "PEC-Proxy-Probe/1.0",
      Connection: "close",
    };
    if (authHeader) {
      headers["Proxy-Authorization"] = authHeader;
    }

    const isHttpsProxy = node.protocol === "https";
    const client = isHttpsProxy ? https : http;

    let settled = false;
    const safeResolve = (val: { latencyMs: number; egressIp?: string; geoCountry?: string }) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    const safeReject = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    const req = client.request(
      {
        host: node.host,
        port: node.port,
        rejectUnauthorized: process.env.PROBE_INSECURE_TLS !== "true",
        method: "GET",
        path: targetUrl,
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        let rawData = "";
        const MAX_BODY_BYTES = 64 * 1024;
        const onEnd = () => {
          const latencyMs = Math.max(1, Date.now() - start);
          let egressIp: string | undefined;
          let geoCountry: string | undefined;
          try {
            const parsed = JSON.parse(rawData);
            egressIp = parsed.ip || parsed.clientIp || parsed.query || parsed.origin;
            geoCountry = parsed.country || parsed.countryCode || parsed.country_code || parsed.geoCountry;
          } catch {
            const trimmed = rawData.trim();
            if (/^(\d{1,3}\.){3}\d{1,3}$/.test(trimmed)) {
              egressIp = trimmed;
            }
          }
          safeResolve({ latencyMs, egressIp, geoCountry });
        };

        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          if (rawData.length < MAX_BODY_BYTES) {
            const remaining = MAX_BODY_BYTES - rawData.length;
            rawData += chunk.slice(0, remaining);
          }
          if (rawData.length >= MAX_BODY_BYTES) {
            res.destroy();
            onEnd();
          }
        });
        res.on("end", onEnd);
        res.on("error", (err) => {
          safeReject(err);
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error("HTTP probe timed out"));
    });
    req.on("error", (err) => {
      safeReject(err);
    });
    req.end();
  });
}

function probeSocks5Proxy(
  node: ProxyNode,
  targetUrl: string,
  timeoutMs: number
): Promise<{ latencyMs: number; egressIp?: string; geoCountry?: string }> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(targetUrl);
    } catch {
      parsedUrl = new URL("http://api.ipify.org?format=json");
    }

    const targetHost = parsedUrl.hostname;
    const targetPort = parsedUrl.port ? parseInt(parsedUrl.port, 10) : (parsedUrl.protocol === "https:" ? 443 : 80);

    const socket = new net.Socket();
    let settled = false;

    const cleanup = (err?: Error, result?: { latencyMs: number; egressIp?: string; geoCountry?: string }) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(result || { latencyMs: Math.max(1, Date.now() - start) });
    };

    socket.setTimeout(timeoutMs);
    socket.once("timeout", () => cleanup(new Error("SOCKS5 probe timed out")));
    socket.once("error", (err) => cleanup(err));

    socket.connect(node.port, node.host, () => {
      const hasAuth = Boolean(node.username);
      const greeting = hasAuth
        ? Buffer.from([0x05, 0x02, 0x00, 0x02])
        : Buffer.from([0x05, 0x01, 0x00]);

      socket.write(greeting);

      socket.once("data", (data1) => {
        if (data1.length < 2 || data1[0] !== 0x05) {
          return cleanup(new Error("Invalid SOCKS5 greeting response"));
        }
        const method = data1[1];
        if (method === 0xff) {
          return cleanup(new Error("SOCKS5: No acceptable authentication methods"));
        }

        const proceedConnect = () => {
          const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(targetHost);
          let reqBuf: Buffer;
          if (isIp) {
            const parts = targetHost.split(".").map(Number);
            reqBuf = Buffer.from([0x05, 0x01, 0x00, 0x01, ...parts, (targetPort >> 8) & 0xff, targetPort & 0xff]);
          } else {
            const hostBuf = Buffer.from(targetHost);
            reqBuf = Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length, ...hostBuf, (targetPort >> 8) & 0xff, targetPort & 0xff]);
          }
          socket.write(reqBuf);

          socket.once("data", (data2) => {
            if (data2.length < 2 || data2[0] !== 0x05) {
              return cleanup(new Error("Invalid SOCKS5 connect response"));
            }
            if (data2[1] !== 0x00) {
              return cleanup(new Error(`SOCKS5 connect failed with code ${data2[1]}`));
            }

            const latencyMs = Math.max(1, Date.now() - start);
            const isTargetHttps = parsedUrl.protocol === "https:";

            const sendHttpOverStream = (stream: net.Socket | tls.TLSSocket) => {
              stream.setEncoding("utf8");
              const httpReq = `GET ${parsedUrl.pathname || "/"}${parsedUrl.search || ""} HTTP/1.1\r\nHost: ${parsedUrl.host}\r\nUser-Agent: PEC-Proxy-Probe/1.0\r\nConnection: close\r\n\r\n`;
              stream.write(httpReq);

              let httpResData = "";
              const MAX_RES_BYTES = 64 * 1024;
              let ended = false;

              const onEnd = () => {
                if (ended) return;
                ended = true;

                let egressIp: string | undefined;
                let geoCountry: string | undefined;

                let body = httpResData;
                const doubleCrlf = httpResData.indexOf("\r\n\r\n");
                if (doubleCrlf !== -1) {
                  body = httpResData.slice(doubleCrlf + 4);
                } else {
                  const doubleLf = httpResData.indexOf("\n\n");
                  if (doubleLf !== -1) {
                    body = httpResData.slice(doubleLf + 2);
                  }
                }

                try {
                  const parsed = JSON.parse(body);
                  egressIp = parsed.ip || parsed.clientIp || parsed.query || parsed.origin;
                  geoCountry = parsed.country || parsed.countryCode || parsed.country_code || parsed.geoCountry;
                } catch {
                  const ipMatch = body.match(/"(?:ip|clientIp|query|origin)"\s*:\s*"([^"]+)"/);
                  if (ipMatch) egressIp = ipMatch[1];
                  const countryMatch = body.match(/"(?:country|countryCode|country_code|geoCountry)"\s*:\s*"([^"]+)"/);
                  if (countryMatch) geoCountry = countryMatch[1];
                  if (!egressIp) {
                    const trimmed = body.trim();
                    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(trimmed)) {
                      egressIp = trimmed;
                    }
                  }
                }
                cleanup(undefined, { latencyMs, egressIp, geoCountry });
              };

              stream.on("data", (chunk) => {
                const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
                if (httpResData.length < MAX_RES_BYTES) {
                  const remaining = MAX_RES_BYTES - httpResData.length;
                  httpResData += text.slice(0, remaining);
                }
                if (httpResData.length >= MAX_RES_BYTES) {
                  stream.removeAllListeners("data");
                  stream.destroy();
                  onEnd();
                }
              });

              stream.once("end", onEnd);
            };

            if (isTargetHttps) {
              const tlsSocket = tls.connect(
                {
                  socket,
                  servername: targetHost,
                  rejectUnauthorized: process.env.PROBE_INSECURE_TLS !== "true",
                },
                () => {
                  sendHttpOverStream(tlsSocket);
                }
              );
              tlsSocket.once("error", (tlsErr) => cleanup(tlsErr));
            } else {
              sendHttpOverStream(socket);
            }
          });
        };

        if (method === 0x02) {
          const uBuf = Buffer.from(node.username || "");
          const pBuf = Buffer.from(node.password || "");
          const authBuf = Buffer.concat([
            Buffer.from([0x01, uBuf.length]),
            uBuf,
            Buffer.from([pBuf.length]),
            pBuf,
          ]);
          socket.write(authBuf);
          socket.once("data", (authRes) => {
            if (authRes.length < 2 || authRes[1] !== 0x00) {
              return cleanup(new Error("SOCKS5 authentication failed"));
            }
            proceedConnect();
          });
        } else {
          proceedConnect();
        }
      });
    });
  });
}

export async function probeProxyEgress(node: ProxyNode, timeoutMs = 3000): Promise<ProxyCheckResult> {
  const startTime = Date.now();
  const checkedAt = new Date().toISOString();

  // 1. Fast TCP connectivity check (bypassCache = true for fresh on-demand probe)
  const tcpOk = await probeProxyTcp(node.host, node.port, Math.max(timeoutMs, 2000), true);
  if (!tcpOk) {
    const result: ProxyCheckResult = {
      id: node.id,
      status: "OFFLINE",
      latencyMs: 0,
      checkedAt,
      error: "TCP connection failed or host unreachable",
    };
    tryUpdateStoredProxyCheck(node.id, result);
    return result;
  }

  const tcpLatency = Math.max(1, Date.now() - startTime);

  // 2. Protocol and egress check
  const echoUrl = process.env.PROXY_ECHO_URL || "http://api.ipify.org?format=json";

  try {
    let probeRes: { latencyMs: number; egressIp?: string; geoCountry?: string };

    if (node.protocol === "socks5") {
      probeRes = await probeSocks5Proxy(node, echoUrl, timeoutMs);
    } else {
      probeRes = await probeHttpProxy(node, echoUrl, timeoutMs);
    }

    const result: ProxyCheckResult = {
      id: node.id,
      status: "ONLINE",
      latencyMs: probeRes.latencyMs,
      egressIp: probeRes.egressIp,
      geoCountry: probeRes.geoCountry,
      checkedAt,
    };
    tryUpdateStoredProxyCheck(node.id, result);
    return result;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const isTimeout = errorMsg.toLowerCase().includes("timeout");
    const result: ProxyCheckResult = {
      id: node.id,
      status: isTimeout ? "TIMEOUT" : "ERROR",
      latencyMs: tcpLatency,
      checkedAt,
      error: errorMsg,
    };
    tryUpdateStoredProxyCheck(node.id, result);
    return result;
  }
}

export async function probeAllProxies(concurrency = 5): Promise<Record<string, ProxyCheckResult>> {
  const proxies = getAllProxies();
  const results: Record<string, ProxyCheckResult> = {};
  if (!proxies.length) return results;

  const queue = [...proxies];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const node = queue.shift();
      if (!node) break;
      try {
        const res = await probeProxyEgress(node);
        results[node.id] = res;
      } catch (err: unknown) {
        results[node.id] = {
          id: node.id,
          status: "ERROR",
          latencyMs: 0,
          checkedAt: new Date().toISOString(),
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  });

  await Promise.all(workers);
  return results;
}


