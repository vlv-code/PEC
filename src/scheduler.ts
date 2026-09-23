import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { RotationConfig, RotationHistoryItem } from "./types.js";
import { executeRotation, validateSafeEndpointUrl } from "./rotate.js";

const ROTATION_CONFIG_FILE = path.resolve(process.env.ROTATION_CONFIG_PATH || "./rotation_config.json");
const HISTORY_FILE = path.resolve(process.env.ROTATION_HISTORY_PATH || "./rotation_history.json");

const MIN_INTERVAL_MINUTES = 1;
const MAX_INTERVAL_MINUTES = 60 * 24 * 366; // one year
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

const DEFAULT_CONFIG: RotationConfig = {
  enabled: true,
  intervalMinutes: parseInt(process.env.ROTATION_INTERVAL_MIN || "1440", 10), // default 24h
  panelUrl: process.env.XUI_PANEL_URL || "https://3xui-host:2053/basepath",
  adminUser: process.env.XUI_ADMIN_USER || "admin",
  adminPass: process.env.XUI_ADMIN_PASS || "",
  inboundRemark: process.env.XUI_INBOUND_REMARK || "squid-in",
  insecureSkipVerify: process.env.XUI_INSECURE_SKIP_VERIFY === "true",
  lastStatus: "Idle",
};

let currentConfig: RotationConfig = { ...DEFAULT_CONFIG };
let timerHandle: NodeJS.Timeout | null = null;
let rotationHistory: RotationHistoryItem[] = [];

// Load persisted configuration
try {
  if (fs.existsSync(ROTATION_CONFIG_FILE)) {
    const raw = fs.readFileSync(ROTATION_CONFIG_FILE, "utf-8");
    currentConfig = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  }
} catch (e) {
  console.warn("[scheduler] Error reading rotation_config.json:", e);
}

// Load persisted history
try {
  if (fs.existsSync(HISTORY_FILE)) {
    const raw = fs.readFileSync(HISTORY_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Cap on load as well: the push path only pops a single entry, so an
      // oversized store (written by an older version or by hand) would keep
      // getRotationHistory() above the documented limit of 50 until enough
      // new rotations push the surplus out.
      rotationHistory = parsed.slice(0, MAX_HISTORY_ENTRIES);
    }
  }
} catch {}

function saveState() {
  try {
    fs.writeFileSync(ROTATION_CONFIG_FILE, JSON.stringify(currentConfig, null, 2), "utf-8");
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(rotationHistory.slice(0, MAX_HISTORY_ENTRIES), null, 2), "utf-8");
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

export async function runManualRotation(): Promise<RotationHistoryItem> {
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
