import "./loadEnv.js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { RotationConfig, RotationHistoryItem } from "./types.js";
import { executeRotation, validateSafeEndpointUrl } from "./rotate.js";
import { writeJsonAtomic } from "./jsonStore.js";
import { getRotationConfigPath, getRotationHistoryPath } from "./storage.js";

const ROTATION_CONFIG_FILE = getRotationConfigPath();
const HISTORY_FILE = getRotationHistoryPath();

const MIN_INTERVAL_MINUTES = 1;
// setTimeout/setInterval accept delays only up to 2^31-1 ms (~24.8 days):
// a larger value makes Node clamp the timer to 1 ms, turning the rotation
// scheduler into a hot loop that hammers the 3x-ui panel with logins.
const MAX_INTERVAL_MINUTES = Math.floor((2 ** 31 - 1) / 60_000); // 35791 (~24.8 days)
const MAX_HISTORY_ENTRIES = 50;

/**
 * Validate and normalize a rotation interval. Prevents NaN / 0 / strings
 * from reaching setInterval - a NaN interval previously degraded to a 1 ms
 * timer that hammered the 3x-ui API and the filesystem.
 */
function normalizeIntervalMinutes(value: unknown): number {
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < MIN_INTERVAL_MINUTES || n > MAX_INTERVAL_MINUTES) {
    throw new Error(
      `intervalMinutes must be an integer between ${MIN_INTERVAL_MINUTES} and ${MAX_INTERVAL_MINUTES}`
    );
  }
  return n;
}

// Helper to sync updated rotation secrets back to .env if present
function syncSecretsToEnv(vars: Record<string, string | undefined>): void {
  try {
    const envPath = path.resolve(".env");
    if (!fs.existsSync(envPath)) return;
    let content = fs.readFileSync(envPath, "utf-8");
    let changed = false;
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) continue;
      const regex = new RegExp(`^${k}=.*$`, "m");
      if (regex.test(content)) {
        content = content.replace(regex, `${k}=${v}`);
        changed = true;
      } else {
        content += `\n${k}=${v}`;
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(envPath, content, { encoding: "utf-8", mode: 0o600 });
    }
  } catch {
    // Non-fatal if .env is read-only in container
  }
}

const DEFAULT_CONFIG: RotationConfig = {
  enabled: true,
  intervalMinutes: parseInt(process.env.ROTATION_INTERVAL_MIN || "1440", 10), // default 24h
  panelUrl: process.env.XUI_PANEL_URL || "https://3xui-host:2053/basepath",
  adminUser: process.env.XUI_ADMIN_USER || "admin",
  adminPass: process.env.XUI_ADMIN_PASS || "",
  inboundRemark: process.env.XUI_INBOUND_REMARK || "squid-in",
  inboundTag: process.env.XUI_INBOUND_TAG || undefined,
  insecureSkipVerify: process.env.XUI_INSECURE_SKIP_VERIFY === "true",
  lastStatus: "Idle",
};

function loadInitialConfig(): RotationConfig {
  let loaded: Partial<RotationConfig> = {};

  // 1. Primary config file
  try {
    if (fs.existsSync(ROTATION_CONFIG_FILE)) {
      const raw = fs.readFileSync(ROTATION_CONFIG_FILE, "utf-8");
      loaded = JSON.parse(raw);
    }
  } catch (e) {
    console.warn("[scheduler] Error reading rotation_config.json:", e);
  }

  // 2. Secondary backup secrets store
  const secretsFile = path.join(path.dirname(ROTATION_CONFIG_FILE), ".rotation_secrets.json");
  if (!loaded.adminPass && fs.existsSync(secretsFile)) {
    try {
      const secRaw = fs.readFileSync(secretsFile, "utf-8");
      const secData = JSON.parse(secRaw);
      if (secData && secData.adminPass) {
        loaded.adminPass = secData.adminPass;
      }
      if (secData && secData.panelUrl && (!loaded.panelUrl || loaded.panelUrl.includes("3xui-host"))) {
        loaded.panelUrl = secData.panelUrl;
      }
      if (secData && secData.adminUser && !loaded.adminUser) {
        loaded.adminUser = secData.adminUser;
      }
    } catch {}
  }

  // 3. Fallback to ./data/.rotation_secrets.json if running in a different dir
  const fallbackSecrets = path.resolve("./data/.rotation_secrets.json");
  if (!loaded.adminPass && fs.existsSync(fallbackSecrets)) {
    try {
      const fbRaw = fs.readFileSync(fallbackSecrets, "utf-8");
      const fbData = JSON.parse(fbRaw);
      if (fbData && fbData.adminPass) {
        loaded.adminPass = fbData.adminPass;
      }
    } catch {}
  }

  // 4. Merge: Never let an empty adminPass or placeholder panelUrl wipe out environment variables
  const finalPass =
    (loaded.adminPass && loaded.adminPass.trim()) ||
    (process.env.XUI_ADMIN_PASS && process.env.XUI_ADMIN_PASS.trim()) ||
    DEFAULT_CONFIG.adminPass ||
    "";

  const finalPanel =
    (loaded.panelUrl && !loaded.panelUrl.includes("3xui-host") && loaded.panelUrl.trim()) ||
    (process.env.XUI_PANEL_URL && !process.env.XUI_PANEL_URL.includes("3xui-host") && process.env.XUI_PANEL_URL.trim()) ||
    loaded.panelUrl ||
    DEFAULT_CONFIG.panelUrl;

  const finalUser =
    (loaded.adminUser && loaded.adminUser.trim()) ||
    (process.env.XUI_ADMIN_USER && process.env.XUI_ADMIN_USER.trim()) ||
    DEFAULT_CONFIG.adminUser ||
    "admin";

  const finalRemark =
    (loaded.inboundRemark && loaded.inboundRemark.trim()) ||
    (process.env.XUI_INBOUND_REMARK && process.env.XUI_INBOUND_REMARK.trim()) ||
    DEFAULT_CONFIG.inboundRemark ||
    "squid-in";

  return {
    ...DEFAULT_CONFIG,
    ...loaded,
    adminPass: finalPass,
    panelUrl: finalPanel,
    adminUser: finalUser,
    inboundRemark: finalRemark,
  };
}

let currentConfig: RotationConfig = loadInitialConfig();
let timerHandle: NodeJS.Timeout | null = null;
let rotationHistory: RotationHistoryItem[] = [];

// Load persisted history
try {
  if (fs.existsSync(HISTORY_FILE)) {
    const raw = fs.readFileSync(HISTORY_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      rotationHistory = parsed.slice(0, MAX_HISTORY_ENTRIES);
    }
  }
} catch {}

function saveState() {
  try {
    writeJsonAtomic(ROTATION_CONFIG_FILE, currentConfig);
    // Secondary persistent backup
    const secretsFile = path.join(path.dirname(ROTATION_CONFIG_FILE), ".rotation_secrets.json");
    if (currentConfig.adminPass) {
      writeJsonAtomic(secretsFile, {
        adminPass: currentConfig.adminPass,
        adminUser: currentConfig.adminUser,
        panelUrl: currentConfig.panelUrl,
        inboundRemark: currentConfig.inboundRemark,
      });
      // Also backup in ./data if different
      const fallbackSecrets = path.resolve("./data/.rotation_secrets.json");
      if (secretsFile !== fallbackSecrets) {
        try {
          writeJsonAtomic(fallbackSecrets, {
            adminPass: currentConfig.adminPass,
            adminUser: currentConfig.adminUser,
            panelUrl: currentConfig.panelUrl,
            inboundRemark: currentConfig.inboundRemark,
          });
        } catch {}
      }
    }
    writeJsonAtomic(HISTORY_FILE, rotationHistory.slice(0, MAX_HISTORY_ENTRIES));
    syncSecretsToEnv({
      XUI_PANEL_URL: currentConfig.panelUrl,
      XUI_ADMIN_USER: currentConfig.adminUser,
      XUI_ADMIN_PASS: currentConfig.adminPass,
      XUI_INBOUND_REMARK: currentConfig.inboundRemark,
    });
  } catch (err) {
    console.error("[scheduler] Error persisting state:", err);
  }
}

export function getRotationConfig(): RotationConfig {
  return { ...currentConfig };
}

/**
 * Masked view of the rotation config for API responses.
 * The 3x-ui admin password must never leave the server in plaintext.
 */
export function getRotationConfigPublic(): RotationConfig {
  return { ...currentConfig, adminPass: currentConfig.adminPass ? "********" : "" };
}

export function getRotationHistory(): RotationHistoryItem[] {
  return [...rotationHistory];
}

// In-flight lock: concurrent callers (double "Rotate Now" click, manual call
// racing the timer) must not run two rotations in parallel - interleaved
// panel/local writes would desynchronize the fleet's credentials.
let rotationInFlight: Promise<RotationHistoryItem> | null = null;

export function runManualRotation(): Promise<RotationHistoryItem> {
  if (rotationInFlight) return rotationInFlight;
  rotationInFlight = doRunManualRotation().finally(() => {
    rotationInFlight = null;
  });
  return rotationInFlight;
}

async function doRunManualRotation(): Promise<RotationHistoryItem> {
  currentConfig.lastStatus = "Rotating...";
  try {
    const result = await executeRotation(currentConfig);
    currentConfig.lastRotatedAt = result.timestamp;
    currentConfig.lastStatus = `Success (${result.source})`;
    currentConfig.lastError = undefined;

    // Recalculate next rotation time
    if (currentConfig.enabled) {
      currentConfig.nextRotationAt = new Date(Date.now() + currentConfig.intervalMinutes * 60 * 1000).toISOString();
    }

    rotationHistory.unshift(result);
    if (rotationHistory.length > MAX_HISTORY_ENTRIES) rotationHistory.pop();
    saveState();
    return result;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    currentConfig.lastStatus = "Failed";
    currentConfig.lastError = errMsg;

    let user = "unknown";
    try {
      const { readCurrentCreds } = await import("./rotate.js");
      const creds = readCurrentCreds();
      if (creds?.user) user = creds.user;
    } catch {}

    const failItem: RotationHistoryItem = {
      id: crypto.randomUUID?.() ?? Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
      source: currentConfig.panelUrl && !currentConfig.panelUrl.includes("3xui-host") ? "3x-ui" : "manual",
      user,
      success: false,
      error: errMsg,
    };
    rotationHistory.unshift(failItem);
    if (rotationHistory.length > MAX_HISTORY_ENTRIES) rotationHistory.pop();
    saveState();
    throw err;
  }
}

export function updateRotationConfig(updates: Partial<RotationConfig>): RotationConfig {
  // Validate interval BEFORE merging: rejects NaN, 0, negative and
  // non-integer values instead of silently degrading the scheduler.
  if (updates.intervalMinutes !== undefined) {
    currentConfig.intervalMinutes = normalizeIntervalMinutes(updates.intervalMinutes);
  }

  // An empty or missing adminPass means "keep the stored one" - the dashboard
  // intentionally sends no password when the operator did not retype it.
  const { adminPass, intervalMinutes: _ignored, panelUrl, ...restUpdates } = updates as Partial<RotationConfig> & {
    intervalMinutes?: unknown;
  };
  if (typeof adminPass === "string" && adminPass.trim()) {
    if (adminPass.trim() === "********") {
      throw new Error("Refusing to store the masked password placeholder");
    }
    currentConfig.adminPass = adminPass.trim();
  }

  if (panelUrl !== undefined && String(panelUrl).trim()) {
    const urlCheck = validateSafeEndpointUrl(String(panelUrl).trim());
    if (!urlCheck.valid) {
      throw new Error(`Invalid panelUrl: ${urlCheck.error}`);
    }
    currentConfig.panelUrl = String(panelUrl).trim();
  }

  currentConfig = {
    ...currentConfig,
    ...restUpdates,
  } as RotationConfig;

  if (currentConfig.enabled) {
    currentConfig.nextRotationAt = new Date(Date.now() + currentConfig.intervalMinutes * 60 * 1000).toISOString();
  } else {
    currentConfig.nextRotationAt = undefined;
    currentConfig.lastStatus = "Scheduler Paused";
  }

  saveState();
  restartScheduler();
  return { ...currentConfig };
}

export function startScheduler() {
  if (timerHandle) {
    clearInterval(timerHandle);
    timerHandle = null;
  }

  if (!currentConfig.enabled) {
    console.log("[scheduler] Automatic credential rotation is disabled.");
    return;
  }

  // Normalize persisted values before arming the timer - protects against
  // hand-edited config files containing garbage.
  let intervalMinutes: number;
  try {
    intervalMinutes = normalizeIntervalMinutes(currentConfig.intervalMinutes);
  } catch {
    intervalMinutes = 1440;
    console.warn(
      `[scheduler] Invalid persisted intervalMinutes (${currentConfig.intervalMinutes}); falling back to 1440 minutes.`
    );
  }
  currentConfig.intervalMinutes = intervalMinutes;

  const intervalMs = intervalMinutes * 60 * 1000;
  currentConfig.nextRotationAt = new Date(Date.now() + intervalMs).toISOString();
  console.log(`[scheduler] Started rotation timer: interval=${intervalMinutes}m, next=${currentConfig.nextRotationAt}`);

  timerHandle = setInterval(async () => {
    console.log("[scheduler] Triggering scheduled password rotation...");
    try {
      await runManualRotation();
    } catch (err) {
      console.error("[scheduler] Scheduled rotation error:", err);
    }
  }, intervalMs);
  // Background job: must not keep the process alive on its own (the HTTP
  // listener governs server lifetime; this also keeps test runs clean).
  timerHandle.unref?.();
}

export function restartScheduler() {
  startScheduler();
}
