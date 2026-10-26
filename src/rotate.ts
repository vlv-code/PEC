import "./loadEnv.js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import dns from "node:dns";
import { RotationConfig, RotationHistoryItem, Panel3xuiConfig } from "./types.js";
import { writeJsonAtomic, readJsonStore } from "./jsonStore.js";
import { getCredsStorePath, get3xuiPanelsPath, getRotationConfigPath } from "./storage.js";

export { getCredsStorePath, get3xuiPanelsPath };

/**
 * Create the credentials store with a cryptographically random password if
 * it does not exist yet. Previously a hardcoded fallback password was baked
 * into two source locations.
 */
export function ensureCredsStore(storePath: string): { user: string; pass: string; updatedAt: string } {
  const creds = {
    user: "corp-user",
    pass: crypto.randomBytes(18).toString("base64url"),
    updatedAt: new Date().toISOString(),
  };
  atomicWriteCreds(storePath, creds);
  return creds;
}

export function readCurrentCreds(): { user: string; pass: string; updatedAt?: string } | null {
  const storePath = getCredsStorePath();
  try {
    if (fs.existsSync(storePath)) {
      const data = JSON.parse(fs.readFileSync(storePath, "utf-8"));
      if (data && typeof data.user === "string" && typeof data.pass === "string") {
        return data;
      }
    } else {
      // Auto-heal missing creds store (random password, never a hardcoded one)
      const defaultCreds = ensureCredsStore(storePath);
      console.log(`[rotate] Auto-healed missing creds store at ${storePath}`);
      return defaultCreds;
    }
  } catch (err) {
    console.error("[rotate] Error reading creds store:", err);
  }
  return null;
}

/**
 * Async variant for request hot paths (/creds, /api/sync, /api/status):
 * fs.promises keeps the event loop free while the store is read from disk.
 * The sync version above stays for startup and cold-path callers.
 */
export async function readCurrentCredsAsync(): Promise<{ user: string; pass: string; updatedAt?: string } | null> {
  const storePath = getCredsStorePath();
  try {
    const raw = await fs.promises.readFile(storePath, "utf-8");
    const data = JSON.parse(raw);
    if (data && typeof data.user === "string" && typeof data.pass === "string") {
      return data;
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      // Auto-heal missing creds store (rare; the sync write is fine here)
      const defaultCreds = ensureCredsStore(storePath);
      console.log(`[rotate] Auto-healed missing creds store at ${storePath}`);
      return defaultCreds;
    }
    console.error("[rotate] Error reading creds store:", err);
  }
  return null;
}

export function atomicWriteCreds(filePath: string, creds: { user: string; pass: string; updatedAt?: string }) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const withTimestamp = {
    ...creds,
    updatedAt: creds.updatedAt || new Date().toISOString(),
  };

  const tempFile = path.join(dir, `${path.basename(filePath)}.tmp.${crypto.randomBytes(4).toString("hex")}`);
  fs.writeFileSync(tempFile, JSON.stringify(withTimestamp, null, 2), { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(tempFile, filePath);
}

function isPrivateOrLoopbackHost(hostname: string): boolean {
  if (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "0:0:0:0:0:0:0:1" ||
    hostname === "::" ||
    hostname === "0.0.0.0"
  ) {
    return true;
  }
  if (hostname.startsWith("127.")) {
    return true;
  }

  // Handle IPv4-mapped IPv6 (e.g. "::ffff:127.0.0.1" or Node's normalized "::ffff:7f00:1")
  let cleanHost = hostname;
  if (cleanHost.startsWith("::ffff:") || cleanHost.startsWith("0:0:0:0:0:ffff:")) {
    const rest = cleanHost.replace(/^(?:0:0:0:0:0:ffff:|::ffff:)/, "");
    if (rest.includes(":")) {
      const parts = rest.split(":");
      if (parts.length === 2) {
        const n1 = parseInt(parts[0], 16);
        const n2 = parseInt(parts[1], 16);
        if (!isNaN(n1) && !isNaN(n2)) {
          cleanHost = `${(n1 >> 8) & 0xff}.${n1 & 0xff}.${(n2 >> 8) & 0xff}.${n2 & 0xff}`;
        }
      }
    } else if (rest.includes(".")) {
      cleanHost = rest;
    }
  }

  // Unique local IPv6 (fc00::/7) or link-local IPv6 (fe80::/10)
  if (/^f[cd][0-9a-f]{2}:/i.test(cleanHost) || /^fe[89ab][0-9a-f]:/i.test(cleanHost)) {
    return true;
  }

  const match = cleanHost.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (match) {
    const o1 = parseInt(match[1], 10);
    const o2 = parseInt(match[2], 10);
    const o3 = parseInt(match[3], 10);
    const o4 = parseInt(match[4], 10);
    if (o1 <= 255 && o2 <= 255 && o3 <= 255 && o4 <= 255) {
      if (o1 === 10) return true;
      if (o1 === 172 && o2 >= 16 && o2 <= 31) return true;
      if (o1 === 192 && o2 === 168) return true;
      if (o1 === 127) return true;
      if (o1 === 0) return true;
      if (o1 === 169 && o2 === 254) return true;
      if (o1 === 100 && o2 >= 64 && o2 <= 127) return true;
    }
  }
  return false;
}

export function validateSafeEndpointUrl(urlStr: string): { valid: boolean; error?: string } {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { valid: false, error: "Only http:// or https:// protocol is permitted" };
    }
    // Node keeps IPv6 brackets in .hostname - strip them before matching.
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    // Block cloud metadata services and link-local addresses (SSRF guard)
    if (
      hostname === "169.254.169.254" ||
      hostname.startsWith("169.254.") ||
      hostname === "metadata.google.internal" ||
      hostname === "metadata.goog" ||
      hostname === "instance-data" ||
      // IPv6 forms of the same targets: AWS IMDSv1 endpoint and link-local
      hostname.startsWith("fd00:ec2:") ||
      hostname.startsWith("fe80:")
    ) {
      return { valid: false, error: "Access to cloud metadata endpoints is prohibited (SSRF prevention)" };
    }

    if (process.env.ALLOW_INTERNAL_PANEL !== "true" && isPrivateOrLoopbackHost(hostname)) {
      return {
        valid: false,
        error: "Access to loopback or private network endpoints is prohibited (SSRF prevention)",
      };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }
}

/**
 * Asynchronous URL validation performing DNS IP resolution when ALLOW_INTERNAL_PANEL !== "true".
 * Blocks DNS rebinding attacks (e.g. *.nip.io resolving to 127.0.0.1 or RFC1918 addresses).
 */
export async function validateSafeEndpointUrlAsync(rawUrl: string): Promise<{ valid: boolean; error?: string }> {
  const syncCheck = validateSafeEndpointUrl(rawUrl);
  if (!syncCheck.valid) return syncCheck;
  if (process.env.ALLOW_INTERNAL_PANEL === "true") return { valid: true };

  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    const lookupResult = await dns.promises.lookup(hostname, { all: true });
    for (const addr of lookupResult) {
      if (isPrivateOrLoopbackHost(addr.address)) {
        return { valid: false, error: `Hostname resolves to private address ${addr.address} (SSRF prevention)` };
      }
    }
    return { valid: true };
  } catch (e: any) {
    return { valid: false, error: `DNS resolution failed: ${e?.message || e}` };
  }
}

let rotationInFlight = false;

export function isRotationInFlight(): boolean {
  return rotationInFlight;
}

export function setRotationInFlight(inFlight: boolean): void {
  rotationInFlight = inFlight;
}

/**
 * Panel fetches must never follow redirects: a 30x would silently send the
 * admin credentials (or an authorized request) to whatever target the panel
 * (or an attacker who controls it) points at. redirect:"manual" keeps the
 * 3xx response local; this helper turns it into a hard failure.
 */
function assertNoRedirect(res: Response, what: string): void {
  if (res.status >= 300 && res.status < 400) {
    throw new Error(`${what}: panel returned redirect (${res.status}) - refused`);
  }
}

/**
 * Login to the 3x-ui panel, transparently supporting both generations:
 * - current panels issue a CSRF token (GET /csrf-token with the session
 *   cookie, then X-CSRF-Token on POST /login) - without it login is a bare 403;
 * - older panels accept a plain POST /login.
 * Returns the Cookie header value to authorize subsequent API calls.
 */
async function panelLogin(
  panel: string,
  username: string,
  password: string,
  timeoutMs: number
): Promise<{ cookie: string; csrfToken: string | null }> {
  let cookie = "";
  let csrfToken: string | null = null;

  // Newer panels: obtain the session cookie + CSRF token first.
  // Network failures throw immediately (no point retrying /login on an unreachable host).
  // HTTP non-200 responses (e.g. 404 on older panels without CSRF) fall through to plain login.
  const csrfRes = await fetch(`${panel}/csrf-token`, {
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  assertNoRedirect(csrfRes, "csrf-token");
  if (csrfRes.ok) {
    cookie = csrfRes.headers.get("set-cookie") || "";
    const data = (await csrfRes.json().catch(() => null)) as { obj?: string } | null;
    if (data && typeof data.obj === "string" && data.obj) {
      csrfToken = data.obj;
    }
  }

  const loginRes = await fetch(`${panel}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({ username, password }),
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  assertNoRedirect(loginRes, "login");

  if (!loginRes.ok) {
    throw new Error(`3x-ui login failed: HTTP ${loginRes.status}`);
  }

  const freshCookie = loginRes.headers.get("set-cookie");
  const mergedCookie = mergeCookies(cookie, freshCookie);
  const loginData = await loginRes.json().catch(() => ({}));
  if (loginData && loginData.success === false) {
    throw new Error(`3x-ui login rejected: ${loginData.msg || "Invalid credentials"}`);
  }
  return { cookie: mergedCookie, csrfToken };
}

/** Combine a session cookie from the CSRF handshake with login Set-Cookies. */
function mergeCookies(base: string, fresh: string | null): string {
  const jar = new Map<string, string>();
  for (const raw of [base, fresh || ""]) {
    for (const part of raw.split(/,(?=[^;]+?=)/)) {
      const pair = part.split(";")[0].trim();
      const eq = pair.indexOf("=");
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

/** Auth headers for panel API calls (cookie + CSRF where the panel issued one). */
function panelApiHeaders(auth: { cookie: string; csrfToken: string | null }): Record<string, string> {
  return {
    ...(auth.cookie ? { Cookie: auth.cookie } : {}),
    ...(auth.csrfToken ? { "X-CSRF-Token": auth.csrfToken } : {}),
  };
}

/**
 * Look up an inbound by tag or remark:
 * 1. Exact or trimmed match by tag
 * 2. Exact or trimmed match by remark
 * 3. Case-insensitive match by tag
 * 4. Case-insensitive match by remark
 */
export function findInboundByTagOrRemark(inbounds: any[], target: string): any | undefined {
  if (!Array.isArray(inbounds) || typeof target !== "string") return undefined;
  const t = target.trim();
  if (!t) return undefined;
  const tLower = t.toLowerCase();

  // 1. Exact or trimmed match by tag
  let found = inbounds.find((i) => i && typeof i.tag === "string" && i.tag.trim() === t);
  if (found) return found;

  // 2. Exact or trimmed match by remark
  found = inbounds.find((i) => i && typeof i.remark === "string" && i.remark.trim() === t);
  if (found) return found;

  // 3. Case-insensitive match by tag
  found = inbounds.find((i) => i && typeof i.tag === "string" && i.tag.trim().toLowerCase() === tLower);
  if (found) return found;

  // 4. Case-insensitive match by remark
  found = inbounds.find((i) => i && typeof i.remark === "string" && i.remark.trim().toLowerCase() === tLower);
  return found;
}

export async function sync3xuiInboundByTag(params: {
  panelUrl: string;
  adminUser: string;
  adminPass: string;
  tag: string;
  targetUsername?: string;
  rotatePassword?: boolean;
  timeoutSec?: number;
}): Promise<{
  ok: boolean;
  inboundId?: number;
  tag?: string;
  remark?: string;
  protocol?: "socks5" | "http" | "https";
  port?: number;
  username?: string;
  password?: string;
  message: string;
}> {
  const urlCheck = await validateSafeEndpointUrlAsync(params.panelUrl);
  if (!urlCheck.valid) {
    return { ok: false, message: `SSRF Security Check Failed: ${urlCheck.error}` };
  }

  const panel = params.panelUrl.replace(/\/+$/, "");
  const timeoutMs = (params.timeoutSec || 10) * 1000;

  try {
    const auth = await panelLogin(panel, params.adminUser, params.adminPass, timeoutMs);

    // Fetch inbounds
    const inboundsRes = await fetch(`${panel}/panel/api/inbounds/list`, {
      headers: panelApiHeaders(auth),
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    assertNoRedirect(inboundsRes, "inbounds list");
    if (!inboundsRes.ok) {
      return { ok: false, message: `Failed to list inbounds: HTTP ${inboundsRes.status}` };
    }

    const inboundsData = await inboundsRes.json();
    const inbounds: Array<{
      id: number;
      tag?: string;
      remark?: string;
      protocol?: string;
      port?: number;
      settings?: string | Record<string, unknown>;
      streamSettings?: string | Record<string, unknown>;
    }> = inboundsData.obj || [];

    const target = findInboundByTagOrRemark(inbounds, params.tag);
    if (!target) {
      return { ok: false, message: `Inbound with tag '${params.tag}' not found` };
    }

    // Parse settings
    let settings: any = {};
    if (typeof target.settings === "string") {
      try {
        settings = JSON.parse(target.settings);
      } catch {
        settings = {};
      }
    } else if (typeof target.settings === "object" && target.settings !== null) {
      settings = target.settings;
    }

    const accounts = Array.isArray(settings.accounts) ? settings.accounts : [];
    let targetAccountIdx = 0;
    if (params.targetUsername && accounts.length > 0) {
      const idx = accounts.findIndex((a: any) => a && a.user === params.targetUsername);
      if (idx !== -1) {
        targetAccountIdx = idx;
      }
    }
    const targetAccount = accounts[targetAccountIdx];
    const user = targetAccount?.user;
    const pass = targetAccount?.pass;

    // Protocol mapping
    let streamSettings: any = {};
    if (typeof target.streamSettings === "string") {
      try {
        streamSettings = JSON.parse(target.streamSettings);
      } catch {
        streamSettings = {};
      }
    } else if (typeof target.streamSettings === "object" && target.streamSettings !== null) {
      streamSettings = target.streamSettings;
    }

    let protocol: "socks5" | "http" | "https" = "socks5";
    if (streamSettings?.security === "tls") {
      protocol = "https";
    } else if (target.protocol === "socks") {
      protocol = "socks5";
    } else if (target.protocol === "http") {
      protocol = "http";
    } else if (target.protocol === "socks5" || target.protocol === "https") {
      protocol = target.protocol;
    } else {
      protocol = "socks5";
    }

    if (params.rotatePassword) {
      if (!accounts || accounts.length === 0) {
        return { ok: false, message: "Inbound has no accounts" };
      }

      const newPassword = crypto.randomBytes(18).toString("base64url");
      settings.accounts[targetAccountIdx].pass = newPassword;
      target.settings = typeof target.settings === "string" ? JSON.stringify(settings) : settings;

      const updateRes = await fetch(`${panel}/panel/api/inbounds/update/${target.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...panelApiHeaders(auth) },
        body: JSON.stringify(target),
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      assertNoRedirect(updateRes, "inbound update");

      if (!updateRes.ok) {
        return { ok: false, message: `3x-ui inbound update failed: HTTP ${updateRes.status}` };
      }

      const updateData = await updateRes.json().catch(() => ({}));
      if (updateData && updateData.success === false) {
        return { ok: false, message: `3x-ui inbound update rejected: ${updateData.msg || "Unknown error"}` };
      }

      return {
        ok: true,
        inboundId: target.id,
        tag: target.tag,
        remark: target.remark,
        protocol,
        port: target.port,
        username: user,
        password: newPassword,
        message: "Rotated successfully",
      };
    }

    return {
      ok: true,
      inboundId: target.id,
      tag: target.tag,
      remark: target.remark,
      protocol,
      port: target.port,
      username: user,
      password: pass,
      message: "Inbound fetched successfully",
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: msg };
  }
}

export async function test3xuiConnection(config: {
  panelUrl: string;
  adminUser: string;
  adminPass: string;
  inboundRemark?: string;
  inboundTag?: string;
  timeoutSec?: number;
}): Promise<{ ok: boolean; message: string; inboundFound?: boolean; inboundId?: number }> {
  const urlCheck = await validateSafeEndpointUrlAsync(config.panelUrl);
  if (!urlCheck.valid) {
    return { ok: false, message: `SSRF Security Check Failed: ${urlCheck.error}` };
  }

  const panel = config.panelUrl.replace(/\/+$/, "");
  const timeoutMs = (config.timeoutSec || 8) * 1000;

  try {
    const auth = await panelLogin(panel, config.adminUser, config.adminPass, timeoutMs);

    // Check inbounds list
    const inboundsRes = await fetch(`${panel}/panel/api/inbounds/list`, {
      headers: panelApiHeaders(auth),
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    assertNoRedirect(inboundsRes, "inbounds list");
    if (!inboundsRes.ok) {
      return { ok: false, message: `Failed to list inbounds: HTTP ${inboundsRes.status}` };
    }

    const inboundsData = await inboundsRes.json();
    const inbounds: Array<{ id: number; tag?: string; remark?: string; protocol?: string }> = inboundsData.obj || [];

    let target = undefined;
    const targetTag = config.inboundTag?.trim();
    const targetRemark = config.inboundRemark?.trim();

    if (targetTag) {
      target = findInboundByTagOrRemark(inbounds, targetTag);
    }
    if (!target && targetRemark) {
      target = findInboundByTagOrRemark(inbounds, targetRemark);
    }

    if (!target) {
      const searchKey = targetTag || targetRemark || "";
      const label = targetTag ? `tag/remark "${searchKey}"` : `remark "${searchKey}"`;
      return {
        ok: true,
        inboundFound: false,
        message: `Connected successfully, but inbound with ${label} was not found (found ${inbounds.length} inbounds).`,
      };
    }

    const displayName = target.remark || target.tag || String(target.id);
    return {
      ok: true,
      inboundFound: true,
      inboundId: target.id,
      message: `Connected successfully to 3x-ui! Found inbound "${displayName}" (id: ${target.id}, protocol: ${target.protocol || "http"}).`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Connection failed: ${msg}` };
  }
}

export async function executeRotation(customConfig?: Partial<RotationConfig>): Promise<RotationHistoryItem> {
  rotationInFlight = true;
  try {
    return await doExecuteRotation(customConfig);
  } finally {
    rotationInFlight = false;
  }
}

async function doExecuteRotation(customConfig?: Partial<RotationConfig>): Promise<RotationHistoryItem> {
  let panel = customConfig?.panelUrl || process.env.XUI_PANEL_URL;
  let xuiUser = customConfig?.adminUser || process.env.XUI_ADMIN_USER;
  let xuiPass = customConfig?.adminPass || process.env.XUI_ADMIN_PASS;
  const inboundTag = customConfig?.inboundTag || process.env.XUI_INBOUND_TAG;
  const inboundRemark = customConfig?.inboundRemark || process.env.XUI_INBOUND_REMARK || "squid-in";
  let targetTag = inboundTag || inboundRemark;
  let targetProxyId: string | undefined = undefined;
  let activeProxy: any = undefined;

  try {
    const { getActiveProxy } = await import("./proxies.js");
    activeProxy = getActiveProxy();
    if (activeProxy && activeProxy.type === "3x-ui") {
      targetProxyId = activeProxy.id;
      if (activeProxy.tag) targetTag = activeProxy.tag;
      if (activeProxy.panelId && (!panel || panel.includes("3xui-host"))) {
        const p = get3xuiPanelById(activeProxy.panelId);
        if (p) {
          panel = p.panelUrl;
          xuiUser = p.adminUser;
          xuiPass = p.adminPass;
        }
      }
    }
  } catch {}

  const timeoutMs = 10000;
  const credsStorePath = getCredsStorePath();

  // 3x-ui mode: only when the panel is explicitly configured (non-placeholder).
  const panelConfigured = Boolean(
    panel && xuiUser && xuiPass && !panel.includes("3xui-host") && panel.startsWith("http")
  );

  if (panelConfigured) {
    // SECURITY / OPERATIONS: no silent fallback. If the panel is configured,
    // a failed panel update must NOT write a new local password - that would
    // desynchronize every extension in the fleet (local store rotated, panel
    // inbound still on the old password) while history reported success.
    const panelUrl = panel as string;
    let failureReason = "";

    try {
      const syncResult = await sync3xuiInboundByTag({
        panelUrl,
        adminUser: xuiUser as string,
        adminPass: xuiPass as string,
        tag: targetTag,
        targetUsername: activeProxy?.username,
        rotatePassword: true,
        timeoutSec: Math.floor(timeoutMs / 1000),
      });

      if (!syncResult.ok) {
        throw new Error(syncResult.message);
      }

      const username = syncResult.username || "corp-user";
      const newPassword = syncResult.password!;

      atomicWriteCreds(credsStorePath, { user: username, pass: newPassword });

      try {
        const { getActiveProxy, updateProxy } = await import("./proxies.js");
        const activeProxy = getActiveProxy();
        const idToUpdate = targetProxyId || (activeProxy && activeProxy.type === "3x-ui" ? activeProxy.id : undefined);
        if (idToUpdate) {
          updateProxy(idToUpdate, {
            password: newPassword,
            lastSync: new Date().toISOString(),
          });
        }
      } catch (proxyErr) {
        console.warn("[rotate] Failed to sync rotated password to active proxy node:", proxyErr);
      }

      return {
        id: crypto.randomBytes(4).toString("hex"),
        timestamp: new Date().toISOString(),
        source: "3x-ui",
        user: username,
        success: true,
      };
    } catch (err: unknown) {
      failureReason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `3x-ui rotation failed; credentials were NOT changed to avoid desynchronizing the fleet. Fix the panel connection, then retry. Original error: ${failureReason}`
      );
    }
  }

  // Standalone mode: panel intentionally not configured - rotate the local
  // store only. This is a deliberate deployment mode, not an error fallback.
  let currentUsername = "corp-user";
  try {
    const existing = readCurrentCreds();
    if (existing?.user) {
      currentUsername = existing.user;
    }
  } catch {}

  const newPassword = crypto.randomBytes(18).toString("base64url");
  atomicWriteCreds(credsStorePath, { user: currentUsername, pass: newPassword });

  return {
    id: crypto.randomBytes(4).toString("hex"),
    timestamp: new Date().toISOString(),
    source: "standalone-atomic",
    user: currentUsername,
    success: true,
  };
}

// ==================== 3X-UI MULTI-PANEL REGISTRY ====================

function autoMigratePanelsIfNeeded(): void {
  const panelsFile = get3xuiPanelsPath();
  if (fs.existsSync(panelsFile)) return;

  const panels: Panel3xuiConfig[] = [];
  try {
    const rotConfigFile = getRotationConfigPath();
    if (fs.existsSync(rotConfigFile)) {
      const rotData = JSON.parse(fs.readFileSync(rotConfigFile, "utf-8"));
      if (
        rotData &&
        rotData.panelUrl &&
        typeof rotData.panelUrl === "string" &&
        rotData.panelUrl.startsWith("http") &&
        !rotData.panelUrl.includes("3xui-host")
      ) {
        panels.push({
          id: "panel_default",
          name: "Primary 3x-ui Panel",
          panelUrl: rotData.panelUrl.replace(/\/+$/, ""),
          adminUser: rotData.adminUser || "admin",
          adminPass: rotData.adminPass || "",
          insecureTls: Boolean(rotData.insecureSkipVerify),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }
  } catch (err) {
    console.warn("[rotate] Auto-migration of legacy 3x-ui panel failed:", err);
  }

  writeJsonAtomic(panelsFile, panels);
}

export function getAll3xuiPanels(maskPasswords = false): Panel3xuiConfig[] {
  autoMigratePanelsIfNeeded();
  const list = readJsonStore<Panel3xuiConfig[]>(get3xuiPanelsPath()) || [];
  return list.map((panel) => ({
    ...panel,
    adminPass: maskPasswords ? (panel.adminPass ? "••••••••" : "") : panel.adminPass,
  }));
}

export function get3xuiPanelById(id: string): Panel3xuiConfig | undefined {
  autoMigratePanelsIfNeeded();
  const list = readJsonStore<Panel3xuiConfig[]>(get3xuiPanelsPath()) || [];
  const found = list.find((p) => p.id === id);
  return found ? { ...found } : undefined;
}

export function save3xuiPanel(
  panelData: Partial<Panel3xuiConfig> & { name: string; panelUrl: string; adminUser: string }
): Panel3xuiConfig {
  const urlCheck = validateSafeEndpointUrl(panelData.panelUrl);
  if (!urlCheck.valid) {
    throw new Error(`SSRF Security Check Failed: ${urlCheck.error}`);
  }

  autoMigratePanelsIfNeeded();
  const panelsFile = get3xuiPanelsPath();
  const list = readJsonStore<Panel3xuiConfig[]>(panelsFile) || [];
  const cleanUrl = panelData.panelUrl.trim().replace(/\/+$/, "");

  let savedPanel: Panel3xuiConfig;
  const now = new Date().toISOString();

  if (panelData.id) {
    const existingIndex = list.findIndex((p) => p.id === panelData.id);
    if (existingIndex !== -1) {
      const existing = list[existingIndex];
      const shouldKeepPass =
        panelData.adminPass === undefined ||
        panelData.adminPass === "" ||
        panelData.adminPass === "••••••••" ||
        panelData.adminPass === "********";

      savedPanel = {
        ...existing,
        name: panelData.name.trim(),
        panelUrl: cleanUrl,
        adminUser: panelData.adminUser.trim(),
        adminPass: shouldKeepPass ? existing.adminPass : (panelData.adminPass?.trim() || existing.adminPass),
        insecureTls: panelData.insecureTls !== undefined ? panelData.insecureTls : existing.insecureTls,
        updatedAt: now,
      };
      list[existingIndex] = savedPanel;
    } else {
      savedPanel = {
        id: panelData.id,
        name: panelData.name.trim(),
        panelUrl: cleanUrl,
        adminUser: panelData.adminUser.trim(),
        adminPass: panelData.adminPass || "",
        insecureTls: Boolean(panelData.insecureTls),
        createdAt: now,
        updatedAt: now,
      };
      list.push(savedPanel);
    }
  } else {
    const newId = `panel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    savedPanel = {
      id: newId,
      name: panelData.name.trim(),
      panelUrl: cleanUrl,
      adminUser: panelData.adminUser.trim(),
      adminPass: panelData.adminPass || "",
      insecureTls: Boolean(panelData.insecureTls),
      createdAt: now,
      updatedAt: now,
    };
    list.push(savedPanel);
  }

  writeJsonAtomic(panelsFile, list);
  return savedPanel;
}

export function delete3xuiPanel(id: string): boolean {
  autoMigratePanelsIfNeeded();
  const panelsFile = get3xuiPanelsPath();
  const list = readJsonStore<Panel3xuiConfig[]>(panelsFile) || [];
  const initialLength = list.length;
  const filtered = list.filter((p) => p.id !== id);
  if (filtered.length !== initialLength) {
    writeJsonAtomic(panelsFile, filtered);
    return true;
  }
  return false;
}

export async function fetch3xuiInbounds(
  configOrId: { panelUrl: string; adminUser: string; adminPass: string; timeoutSec?: number } | string
): Promise<Array<any>> {
  let targetConfig: { panelUrl: string; adminUser: string; adminPass: string; timeoutSec?: number };

  if (typeof configOrId === "string") {
    const p = get3xuiPanelById(configOrId);
    if (!p) throw new Error(`3x-ui panel with ID '${configOrId}' not found`);
    targetConfig = {
      panelUrl: p.panelUrl,
      adminUser: p.adminUser,
      adminPass: p.adminPass,
      timeoutSec: 10,
    };
  } else {
    targetConfig = configOrId;
  }

  const urlCheck = await validateSafeEndpointUrlAsync(targetConfig.panelUrl);
  if (!urlCheck.valid) {
    throw new Error(`SSRF Security Check Failed: ${urlCheck.error}`);
  }

  const panel = targetConfig.panelUrl.replace(/\/+$/, "");
  const timeoutMs = (targetConfig.timeoutSec || 10) * 1000;

  const auth = await panelLogin(panel, targetConfig.adminUser, targetConfig.adminPass, timeoutMs);
  const inboundsRes = await fetch(`${panel}/panel/api/inbounds/list`, {
    headers: panelApiHeaders(auth),
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  assertNoRedirect(inboundsRes, "inbounds list");
  if (!inboundsRes.ok) {
    throw new Error(`Failed to list inbounds: HTTP ${inboundsRes.status}`);
  }

  const inboundsData = await inboundsRes.json();
  return inboundsData.obj || [];
}

