import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { RotationConfig, RotationHistoryItem } from "./types.js";
import { writeJsonAtomic } from "./jsonStore.js";

const CREDS_STORE_DEFAULT = "./current_creds.json";

export function getCredsStorePath(): string {
  return path.resolve(process.env.CREDS_STORE || CREDS_STORE_DEFAULT);
}

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
    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }
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

export async function test3xuiConnection(config: {
  panelUrl: string;
  adminUser: string;
  adminPass: string;
  inboundRemark: string;
  timeoutSec?: number;
}): Promise<{ ok: boolean; message: string; inboundFound?: boolean; inboundId?: number }> {
  const urlCheck = validateSafeEndpointUrl(config.panelUrl);
  if (!urlCheck.valid) {
    return { ok: false, message: `SSRF Security Check Failed: ${urlCheck.error}` };
  }

  const panel = config.panelUrl.replace(/\/+$/, "");
  const timeoutMs = (config.timeoutSec || 8) * 1000;

  try {
    const loginRes = await fetch(`${panel}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: config.adminUser, password: config.adminPass }),
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    assertNoRedirect(loginRes, "login");

    if (!loginRes.ok) {
      return { ok: false, message: `3x-ui HTTP error: ${loginRes.status} ${loginRes.statusText}` };
    }

    const cookie = loginRes.headers.get("set-cookie") || "";
    const loginData = await loginRes.json().catch(() => ({}));
    if (loginData && loginData.success === false) {
      return { ok: false, message: `3x-ui rejected credentials: ${loginData.msg || "Invalid admin login"}` };
    }

    // Check inbounds list
    const inboundsRes = await fetch(`${panel}/panel/api/inbounds/list`, {
      headers: { Cookie: cookie },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    assertNoRedirect(inboundsRes, "inbounds list");
    if (!inboundsRes.ok) {
      return { ok: false, message: `Failed to list inbounds: HTTP ${inboundsRes.status}` };
    }

    const inboundsData = await inboundsRes.json();
    const inbounds: Array<{ id: number; remark?: string; protocol?: string }> = inboundsData.obj || [];
    const target = inbounds.find((i) => i.remark === config.inboundRemark);

    if (!target) {
      return {
        ok: true,
        inboundFound: false,
        message: `Connected successfully, but inbound with remark "${config.inboundRemark}" was not found (found ${inbounds.length} inbounds).`,
      };
    }

    return {
      ok: true,
      inboundFound: true,
      inboundId: target.id,
      message: `Connected successfully to 3x-ui! Found inbound "${target.remark}" (id: ${target.id}, protocol: ${target.protocol || "http"}).`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Connection failed: ${msg}` };
  }
}

export async function executeRotation(customConfig?: Partial<RotationConfig>): Promise<RotationHistoryItem> {
  const panel = customConfig?.panelUrl || process.env.XUI_PANEL_URL;
  const xuiUser = customConfig?.adminUser || process.env.XUI_ADMIN_USER;
  const xuiPass = customConfig?.adminPass || process.env.XUI_ADMIN_PASS;
  const inboundRemark = customConfig?.inboundRemark || process.env.XUI_INBOUND_REMARK || "squid-in";
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
      const ssrfCheck = validateSafeEndpointUrl(panelUrl);
      if (!ssrfCheck.valid) {
        throw new Error(`SSRF Security Check Failed: ${ssrfCheck.error}`);
      }

      const cleanPanel = panelUrl.replace(/\/+$/, "");
      const loginRes = await fetch(`${cleanPanel}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: xuiUser, password: xuiPass }),
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      assertNoRedirect(loginRes, "login");

      if (!loginRes.ok) {
        throw new Error(`3x-ui login failed: HTTP ${loginRes.status}`);
      }

      const cookie = loginRes.headers.get("set-cookie") || "";
      const loginData = await loginRes.json().catch(() => ({}));
      if (loginData && loginData.success === false) {
        throw new Error(`3x-ui login rejected: ${loginData.msg || "Invalid credentials"}`);
      }

      // Fetch inbounds
      const inboundsRes = await fetch(`${cleanPanel}/panel/api/inbounds/list`, {
        headers: { Cookie: cookie },
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      assertNoRedirect(inboundsRes, "inbounds list");
      const inboundsData = await inboundsRes.json();
      const inbounds = inboundsData.obj || [];
      const target = inbounds.find((i: { remark?: string }) => i.remark === inboundRemark);

      if (!target) {
        throw new Error(`Inbound '${inboundRemark}' not found in 3x-ui panel`);
      }

      const settings = typeof target.settings === "string" ? JSON.parse(target.settings) : target.settings;
      if (!settings.accounts || !settings.accounts[0]) {
        throw new Error(`Inbound '${inboundRemark}' has no accounts in settings`);
      }

      // Generate secure 24-character random password
      const newPassword = crypto.randomBytes(18).toString("base64url");
      const username = settings.accounts[0].user || "corp-user";
      settings.accounts[0].pass = newPassword;
      target.settings = JSON.stringify(settings);

      const updateRes = await fetch(`${cleanPanel}/panel/api/inbounds/update/${target.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify(target),
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      assertNoRedirect(updateRes, "inbound update");

      if (!updateRes.ok) {
        throw new Error(`3x-ui inbound update failed: HTTP ${updateRes.status}`);
      }

      atomicWriteCreds(credsStorePath, { user: username, pass: newPassword });

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
