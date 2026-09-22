import fs from "node:fs";
import path from "node:path";
import { RotationConfig, RotationHistoryItem } from "./types.js";
import { executeRotation } from "./rotate.js";

const ROTATION_CONFIG_FILE = path.resolve("./rotation_config.json");
const HISTORY_FILE = path.resolve("./rotation_history.json");

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
    rotationHistory = JSON.parse(raw);
  }
} catch {}

function saveState() {
  try {
    fs.writeFileSync(ROTATION_CONFIG_FILE, JSON.stringify(currentConfig, null, 2), "utf-8");
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(rotationHistory.slice(0, 50), null, 2), "utf-8");
  } catch (err) {
    console.error("[scheduler] Error persisting state:", err);
  }
}

export function getRotationConfig(): RotationConfig {
  return { ...currentConfig };
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
    if (rotationHistory.length > 50) rotationHistory.pop();
    saveState();
    return result;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    currentConfig.lastStatus = "Failed";
    currentConfig.lastError = errMsg;
    const failItem: RotationHistoryItem = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
      source: "manual",
      user: "unknown",
      success: false,
      error: errMsg,
    };
    rotationHistory.unshift(failItem);
    saveState();
    throw err;
  }
}

export function updateRotationConfig(updates: Partial<RotationConfig>): RotationConfig {
  currentConfig = {
    ...currentConfig,
    ...updates,
  };

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

  const intervalMs = Math.max(1, currentConfig.intervalMinutes) * 60 * 1000;
  currentConfig.nextRotationAt = new Date(Date.now() + intervalMs).toISOString();
  console.log(`[scheduler] Started rotation timer: interval=${currentConfig.intervalMinutes}m, next=${currentConfig.nextRotationAt}`);

  timerHandle = setInterval(async () => {
    console.log("[scheduler] Triggering scheduled password rotation...");
    try {
      await runManualRotation();
    } catch (err) {
      console.error("[scheduler] Scheduled rotation error:", err);
    }
  }, intervalMs);
}

export function restartScheduler() {
  startScheduler();
}
