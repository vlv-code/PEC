/**
 * Source templates for extension files that are generated at build time.
 *
 * BACKGROUND_TEMPLATE is the source of truth for the extension service
 * worker. It contains __PEC_*__ placeholders that the packager substitutes
 * from the build config when assembling the ZIP - so "Server URL",
 * "Sync Interval", "Bypass Timeout", "Default Token" and "Target Group"
 * configured in the Studio actually end up in the shipped extension.
 * (Previously background.js was a static file with a hardcoded server URL
 * and most build-config fields were silently ignored.)
 *
 * Managed storage (GPO) values always take precedence at runtime.
 */

export const BACKGROUND_TEMPLATE = `// background.js - Enterprise Chrome MV3 Service Worker (PEC template)
//
// 1. Centralized proxy synchronization (SOCKS5/HTTP/HTTPS/PAC) pushed by server.
// 2. Intercepts Basic-Auth proxy challenges (details.isProxy === true).
// 3. ZERO local credential persistence (strictly in-memory during worker lifecycle).
// 4. WebRTC IP Leak Protection & Status Badge.
// 5. Temporary bypass with automatic re-enable after BYPASS_TIMEOUT_MIN.
// 6. Popup messaging support (GET_STATUS, FORCE_SYNC, TOGGLE_BYPASS).
//
// Build placeholders (substituted by the PEC packager):
//   PEC_SERVER_BASE          - default management server base URL
//   PEC_DEFAULT_TOKEN        - fallback shared token (GPO extToken overrides)
//   PEC_SYNC_INTERVAL_MIN    - periodic sync alarm, minutes
//   PEC_BYPASS_TIMEOUT_MIN   - auto-revert of a temporary bypass, minutes
//   PEC_BADGE_ENABLED        - whether the toolbar badge indicator is shown
//   PEC_TARGET_GROUP         - default fleet group (GPO targetGroup overrides)

const DEFAULT_SERVER_BASE = "__PEC_SERVER_BASE__";
const DEFAULT_CREDS_URL = DEFAULT_SERVER_BASE + "/creds";
const DEFAULT_SYNC_URL = DEFAULT_SERVER_BASE + "/api/sync";
const FALLBACK_TOKEN = "__PEC_DEFAULT_TOKEN__";
const SYNC_INTERVAL_MIN = 5;
const BYPASS_TIMEOUT_MIN = 15;
const BADGE_ENABLED = true;
const DEFAULT_TARGET_GROUP = "__PEC_TARGET_GROUP__";

const ALARM_SYNC = "corp_proxy_sync";
const ALARM_BYPASS_EXPIRE = "corp_proxy_bypass_expire";

const TTL_MS = 5 * 60 * 1000;
const MAX_AUTH_ATTEMPTS = 2;
const FETCH_TIMEOUT_MS = 6000;

// Ephemeral in-memory state
let memoryCredsCache = null; // { user, pass, fetchedAt }
let syncPromise = null;
const seenRequests = new Map();
let currentProxyState = {
  online: false,
  protocol: "http",
  host: "",
  port: 10809,
  profileName: "Default Split",
  bypassActive: false,
  bypassExpiresAt: null,
  serverBase: DEFAULT_SERVER_BASE,
  lastSync: 0,
};

// Diagnostics ring-buffer log (last 100 events) persisted to local storage
const MAX_LOGS = 100;
let recentLogs = [];

try {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local && chrome.storage.local.get) {
    chrome.storage.local.get(["pecLogs"], (res) => {
      if (res && Array.isArray(res.pecLogs) && recentLogs.length === 0) {
        recentLogs = res.pecLogs.slice(-MAX_LOGS);
      }
    });
  }
} catch (e) {}

function logEvent(level, message, data) {
  const entry = {
    timestamp: new Date().toISOString(),
    level: level || "info",
    message: String(message),
    data: data !== undefined ? data : null,
  };
  recentLogs.push(entry);
  if (recentLogs.length > MAX_LOGS) {
    recentLogs.shift();
  }
  const prefix = "[corp-proxy][" + entry.level.toUpperCase() + "]";
  if (entry.level === "error") {
    console.error(prefix, message, data !== undefined ? data : "");
  } else if (entry.level === "warn") {
    console.warn(prefix, message, data !== undefined ? data : "");
  } else {
    console.log(prefix, message, data !== undefined ? data : "");
  }
  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local && chrome.storage.local.set) {
      chrome.storage.local.set({ pecLogs: recentLogs });
    }
  } catch (e) {}
  return entry;
}

// Persistent instance identity: the MV3 service worker is killed after ~30s
// of idle time and re-executes this script on wake, so a module-level random
// ID would change on every wake and flood the server's instance registry.
// Generate once and persist in chrome.storage.local instead.
let cachedInstanceId = null;
async function getInstanceId() {
  if (cachedInstanceId) return cachedInstanceId;
  try {
    const stored = await chrome.storage.local.get(["pecInstanceId"]);
    if (stored && stored.pecInstanceId) {
      cachedInstanceId = stored.pecInstanceId;
      return cachedInstanceId;
    }
  } catch (e) {}
  const newId = "inst_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 10);
  cachedInstanceId = newId;
  try { await chrome.storage.local.set({ pecInstanceId: newId }); } catch (e) {}
  return newId;
}

function isValidUrl(url) {
  if (typeof url !== "string") return false;
  try {
    const p = new URL(url);
    return p.protocol === "https:" || p.protocol === "http:" || p.hostname === "localhost" || p.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

async function getManagedConfig() {
  try {
    const managed = await chrome.storage.managed.get([
      "extToken",
      "credsUrl",
      "syncUrl",
      "autoConfigureProxy",
      "targetGroup",
    ]);

    const token = managed.extToken || FALLBACK_TOKEN || null;
    const credsUrl = isValidUrl(managed.credsUrl) ? managed.credsUrl : DEFAULT_CREDS_URL;
    const syncUrl = isValidUrl(managed.syncUrl) ? managed.syncUrl : DEFAULT_SYNC_URL;
    const autoConfigureProxy = managed.autoConfigureProxy !== false;
    const targetGroup = managed.targetGroup || DEFAULT_TARGET_GROUP || "Default Fleet";

    return { token, credsUrl, syncUrl, autoConfigureProxy, targetGroup };
  } catch (e) {
    return {
      token: FALLBACK_TOKEN || null,
      credsUrl: DEFAULT_CREDS_URL,
      syncUrl: DEFAULT_SYNC_URL,
      autoConfigureProxy: true,
      targetGroup: DEFAULT_TARGET_GROUP || "Default Fleet",
    };
  }
}

// Update Action badge if action API is available
function updateBadge(text, color) {
  if (!BADGE_ENABLED) return;
  if (chrome.action && chrome.action.setBadgeText) {
    try {
      chrome.action.setBadgeText({ text: text });
      if (color && chrome.action.setBadgeBackgroundColor) {
        chrome.action.setBadgeBackgroundColor({ color: color });
      }
    } catch {}
  }
}

// Enable WebRTC leak protection if privacy permission is granted
async function applyWebRtcProtection() {
  if (chrome.privacy && chrome.privacy.network && chrome.privacy.network.webRTCIPHandlingPolicy) {
    try {
      await chrome.privacy.network.webRTCIPHandlingPolicy.set({
        value: "disable_non_proxied_udp",
        scope: "regular",
      });
      console.log("[corp-proxy] WebRTC IP leak protection enforced.");
      logEvent("info", "WebRTC IP leak protection enforced (disable_non_proxied_udp)");
    } catch (e) {
      console.warn("[corp-proxy] Could not set WebRTC IP handling policy:", e);
      logEvent("warn", "Could not set WebRTC IP handling policy: " + (e && e.message ? e.message : e));
    }
  }
}

// Extract the "// Generated: <timestamp>" stamp from a PAC script so the
// applied routing revision is visible in the service worker console.
function pacRevisionOf(pacText) {
  const marker = "// Generated:";
  const idx = pacText.indexOf(marker);
  if (idx === -1) return "unknown rev";
  let end = idx + marker.length;
  const limit = Math.min(pacText.length, end + 48);
  while (end < limit && pacText.charCodeAt(end) !== 10 && pacText.charCodeAt(end) !== 13) {
    end++;
  }
  return pacText.slice(idx + marker.length, end).trim() || "unknown rev";
}

// Read the effective proxy setting back and log who controls it. This is the
// ground truth for "did the browser actually accept our config":
//   mode=<expected> + levelOfControl=controlled_by_this_extension -> LIVE
//   controlled_by_other_extensions -> another extension owns the setting
//   not_controllable               -> enterprise policy enforces proxy
// chrome://net-internals can mislead here: its "Original" block reflects
// OS-level settings, so a working extension PAC can still look "default".
async function verifyAppliedProxySettings(expectedMode) {
  try {
    if (!chrome.proxy.settings.get) return;
    const details = await chrome.proxy.settings.get({});
    const mode = details && details.value ? details.value.mode : "(unset)";
    const control = details && details.levelOfControl ? details.levelOfControl : "(unknown)";
    if (mode === expectedMode && control === "controlled_by_this_extension") {
      console.log("[corp-proxy] Proxy verified: mode=" + mode + ", control=" + control + " - config is LIVE in the browser.");
      logEvent("info", "Proxy verified: mode=" + mode + ", control=" + control + " (active)");
    } else if (control === "controlled_by_other_extensions" || control === "not_controllable") {
      console.warn("[corp-proxy] Proxy NOT in effect: mode=" + mode + ", control=" + control +
        " - the proxy setting is owned by " +
        (control === "not_controllable" ? "an enterprise policy" : "another extension") +
        ", our config is ignored.");
      logEvent("error", "Proxy NOT active: owned by " + (control === "not_controllable" ? "enterprise policy" : "another extension") + " (" + control + ")");
    } else {
      console.warn("[corp-proxy] Proxy NOT verified: mode=" + mode + ", control=" + control);
      logEvent("warn", "Proxy NOT verified: mode=" + mode + ", control=" + control);
    }
  } catch (err) {
    console.warn("[corp-proxy] Verification read failed:", err && err.message ? err.message : err);
    logEvent("warn", "Verification read failed: " + (err && err.message ? err.message : err));
  }
}

// Apply a PAC script. Two strategies:
//  1) INLINE (preferred): the worker downloads the PAC text itself and
//     installs it via pacScript.data. Atomic and deterministic - the exact
//     script we fetched is the script in effect, and every sync installs a
//     fresh revision. This is how SwitchyOmega-class extensions do it.
//  2) URL fallback: if the worker cannot fetch the script, fall back to
//     pacScript.url and let the browser process download it. CAUTION: in
//     url-mode, while that browser-side download is pending - or when it
//     fails - Chrome silently routes everything DIRECT (mandatory:false),
//     with no feedback anywhere.
async function applyPacScript(pacUrl) {
  let pacText = null;
  logEvent("info", "Fetching PAC script from " + pacUrl);
  try {
    const res = await fetch(pacUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.ok) {
      const text = await res.text();
      if (text && text.indexOf("FindProxyForURL") !== -1) {
        pacText = text;
      } else {
        console.warn("[corp-proxy] PAC endpoint returned an invalid script (no FindProxyForURL).");
        logEvent("warn", "PAC endpoint returned invalid script (no FindProxyForURL), falling back to URL mode");
      }
    } else {
      console.warn("[corp-proxy] PAC download failed: HTTP " + res.status + " - falling back to URL mode.");
      logEvent("warn", "PAC download failed: HTTP " + res.status + " - falling back to URL mode");
    }
  } catch (err) {
    console.warn("[corp-proxy] PAC download error - falling back to URL mode:", err && err.message ? err.message : err);
    logEvent("warn", "PAC download error (" + (err && err.message ? err.message : err) + ") - falling back to URL mode");
  }

  const useInline = pacText !== null;
  const pacRev = useInline ? pacRevisionOf(pacText) : null;
  console.log("[corp-proxy] Applying PAC " + (useInline
    ? "(inline, " + pacText.length + " bytes, generated " + pacRev + ") from " + pacUrl
    : "(URL fallback - browser fetches it) " + pacUrl));
  logEvent("info", "Applying PAC " + (useInline
    ? "(inline, " + pacText.length + " bytes, rev " + pacRev + ")"
    : "(URL mode fallback)") + " from " + pacUrl);

  await chrome.proxy.settings.set({
    value: {
      mode: "pac_script",
      pacScript: useInline
        ? { data: pacText, mandatory: false }
        : { url: pacUrl, mandatory: false },
    },
    scope: "regular",
  });
  updateBadge("PAC", "#0284c7");
  await verifyAppliedProxySettings("pac_script");
}

// Apply proxy settings to browser network stack
async function applyProxyConfig(config) {
  if (!chrome.proxy || !chrome.proxy.settings) return;

  try {
    if (currentProxyState.bypassActive || config.killSwitch || config.enabled === false || config.protocol === "direct") {
      console.log("[corp-proxy] Routing set to DIRECT.");
      logEvent("info", "Proxy set to DIRECT (bypass=" + currentProxyState.bypassActive + ", enabled=" + config.enabled + ")");
      await chrome.proxy.settings.set({
        value: { mode: "direct" },
        scope: "regular",
      });
      updateBadge("DIR", "#f59e0b");
      await verifyAppliedProxySettings("direct");
      return;
    }

    const usePac = (config.protocol === "pac" || (config.pacUrl && config.routingMode !== "fixed"));
    if (usePac && config.pacUrl) {
      await applyPacScript(config.pacUrl);
      return;
    }

    // Fixed single proxy server (SOCKS5, HTTP, or HTTPS)
    const schemeMap = {
      http: "http",
      https: "https",
      socks5: "socks5",
    };
    const scheme = schemeMap[config.protocol] || "http";
    const bypassList = Array.isArray(config.bypassList) ? config.bypassList : ["<local>"];

    console.log("[corp-proxy] Applying " + scheme.toUpperCase() + " Proxy: " + config.host + ":" + config.port);
    logEvent("info", "Applying " + scheme.toUpperCase() + " Proxy: " + config.host + ":" + config.port);
    await chrome.proxy.settings.set({
      value: {
        mode: "fixed_servers",
        rules: {
          singleProxy: {
            scheme: scheme,
            host: config.host,
            port: parseInt(config.port, 10),
          },
          bypassList: bypassList,
        },
      },
      scope: "regular",
    });
    updateBadge(scheme === "socks5" ? "S5" : "PRX", "#10b981");
    await verifyAppliedProxySettings("fixed_servers");
  } catch (err) {
    console.error("[corp-proxy] Error applying proxy settings:", err);
    logEvent("error", "Error applying proxy settings: " + (err && err.message ? err.message : err));
    updateBadge("ERR", "#ef4444");
  }
}

// Surface PAC/proxy runtime failures (script errors, unreachable PROXY
// lines). Without this listener such failures are completely invisible.
if (chrome.proxy && chrome.proxy.onProxyError && chrome.proxy.onProxyError.addListener) {
  chrome.proxy.onProxyError.addListener((details) => {
    const errDesc = details && details.error ? details.error : "unknown";
    const fatal = details && details.fatal;
    console.warn("[corp-proxy] onProxyError:", errDesc, fatal ? "(FATAL - request failed)" : "(recovered)");
    logEvent("error", "Proxy network/PAC error: " + errDesc + (fatal ? " (FATAL - request failed)" : " (recovered)"), details);
  });
}

// Re-enable proxy after the temporary bypass window elapsed
async function expireBypass() {
  console.log("[corp-proxy] Bypass window elapsed - re-enabling proxy.");
  logEvent("info", "Temporary bypass window expired - re-enabling proxy");
  currentProxyState.bypassActive = false;
  currentProxyState.bypassExpiresAt = null;
  syncWithServer(true).catch(function (e) {
    console.warn("[corp-proxy] Re-sync after bypass expiry failed:", e);
    logEvent("warn", "Re-sync after bypass expiry failed: " + (e && e.message ? e.message : e));
  });
}

// Synchronize with server (fetches creds & config)
async function syncWithServer(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && memoryCredsCache && now - memoryCredsCache.fetchedAt < TTL_MS) {
    return memoryCredsCache;
  }

  if (!forceRefresh && syncPromise) {
    return syncPromise;
  }

  if (forceRefresh && syncPromise) {
    // 407 storm dedup: N parallel auth retries must not spawn N forced
    // syncs (self-inflicted 429 from the sync rate limiter). Join the
    // in-flight request; only force a new one if it finished stale.
    await syncPromise.catch(() => {});
    const fresh = memoryCredsCache && Date.now() - memoryCredsCache.fetchedAt < 2000;
    if (fresh) {
      return memoryCredsCache;
    }
  }

  if (forceRefresh) {
    memoryCredsCache = null;
  }

  syncPromise = (async () => {
    try {
      const { token, syncUrl, credsUrl, autoConfigureProxy, targetGroup } = await getManagedConfig();
      const manifest = chrome.runtime.getManifest();

      try {
        currentProxyState.serverBase = new URL(syncUrl).origin;
      } catch {}

      const headers = { "Content-Type": "application/json" };
      if (token) headers["X-Ext-Token"] = token;

      let syncSuccessful = false;
      logEvent("info", "Starting sync with server: " + syncUrl);

      try {
        const res = await fetch(syncUrl, {
          method: "POST",
          headers: headers,
          body: JSON.stringify({
            instanceId: await getInstanceId(),
            version: manifest.version,
            extensionId: chrome.runtime.id,
            activeProxyMode: currentProxyState.protocol,
            group: targetGroup,
          }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (res.ok) {
          const payload = await res.json();
          if (payload.creds && payload.creds.user && payload.creds.pass) {
            memoryCredsCache = {
              user: payload.creds.user,
              pass: payload.creds.pass,
              fetchedAt: Date.now(),
            };
            syncSuccessful = true;
          }

          if (payload.config) {
            const isPac = Boolean(payload.config.pacUrl && payload.config.routingMode !== "fixed") || payload.config.protocol === "pac";
            currentProxyState = {
              ...currentProxyState,
              online: true,
              protocol: isPac ? "pac" : (payload.config.protocol || "http"),
              host: payload.config.host || "",
              port: payload.config.port || 10809,
              profileName: payload.profileName || "Default Profile",
              pacUrl: payload.config.pacUrl || "",
              lastSync: Date.now(),
            };

            logEvent("info", "Sync successful: profile=" + currentProxyState.profileName + ", mode=" + currentProxyState.protocol + ", host=" + (currentProxyState.host || "pac"));

            if (autoConfigureProxy) {
              await applyProxyConfig(payload.config);
            }
          }
        }
      } catch (err) {
        console.warn("[corp-proxy] Sync endpoint error, trying fallback /creds:", err);
        logEvent("warn", "Sync endpoint error, trying fallback /creds: " + (err && err.message ? err.message : err));
      }

      // Fallback to /creds
      if (!syncSuccessful) {
        const resFallback = await fetch(credsUrl, {
          headers: token ? { "X-Ext-Token": token } : {},
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (!resFallback.ok) {
          currentProxyState.online = false;
          logEvent("error", "Creds fetch failed: HTTP " + resFallback.status);
          throw new Error("Creds fetch failed: HTTP " + resFallback.status);
        }

        const data = await resFallback.json();
        if (!data.user || !data.pass) {
          logEvent("error", "Invalid creds payload from server");
          throw new Error("Invalid creds payload from server");
        }

        memoryCredsCache = {
          user: data.user,
          pass: data.pass,
          fetchedAt: Date.now(),
        };
        currentProxyState.online = true;
        currentProxyState.lastSync = Date.now();
        logEvent("info", "Creds fallback successful for user " + data.user);
      }

      return memoryCredsCache;
    } finally {
      syncPromise = null;
    }
  })();

  return syncPromise;
}

// Proxy authentication handler (handles 407 challenge)
chrome.webRequest.onAuthRequired.addListener(
  (details, asyncCallback) => {
    if (!details.isProxy) {
      asyncCallback({});
      return;
    }

    logEvent("info", "Proxy auth challenge (407) for " + (details.url ? details.url.slice(0, 80) : "requestId=" + details.requestId));

    if (seenRequests.size > 1000) seenRequests.clear();
    const attempts = (seenRequests.get(details.requestId) || 0) + 1;
    seenRequests.set(details.requestId, attempts);

    if (attempts > MAX_AUTH_ATTEMPTS) {
      console.warn("[corp-proxy] Max auth attempts exceeded for requestId=" + details.requestId);
      logEvent("warn", "Max auth attempts exceeded for requestId=" + details.requestId);
      seenRequests.delete(details.requestId);
      asyncCallback({ cancel: true });
      return;
    }

    const forceRefresh = attempts > 1;
    syncWithServer(forceRefresh)
      .then((creds) => {
        if (!creds || !creds.user || !creds.pass) {
          throw new Error("No valid credentials returned");
        }
        logEvent("info", "Supplied proxy auth credentials for requestId=" + details.requestId);
        asyncCallback({ authCredentials: { username: creds.user, password: creds.pass } });
      })
      .catch((err) => {
        console.error("[corp-proxy] onAuthRequired error:", err);
        logEvent("error", "onAuthRequired error: " + (err && err.message ? err.message : err));
        seenRequests.delete(details.requestId);
        asyncCallback({});
      });
  },
  { urls: ["<all_urls>"] },
  ["asyncBlocking"]
);

// Clear request tracker
chrome.webRequest.onCompleted.addListener(
  (details) => seenRequests.delete(details.requestId),
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => seenRequests.delete(details.requestId),
  { urls: ["<all_urls>"] }
);

// Listen for popup messages
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "GET_STATUS") {
    sendResponse({ ...currentProxyState });
    return true;
  }
  if (msg.action === "GET_LOGS") {
    sendResponse({ logs: [...recentLogs] });
    return true;
  }
  if (msg.action === "CLEAR_LOGS") {
    recentLogs = [];
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local && chrome.storage.local.remove) {
        chrome.storage.local.remove(["pecLogs"]);
      }
    } catch (e) {}
    sendResponse({ ok: true, logs: [] });
    return true;
  }
  if (msg.action === "FORCE_SYNC") {
    syncWithServer(true).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg.action === "TOGGLE_BYPASS") {
    currentProxyState.bypassActive = !currentProxyState.bypassActive;
    if (currentProxyState.bypassActive) {
      // Schedule automatic re-enable - "temporary bypass" must actually be temporary.
      currentProxyState.bypassExpiresAt = Date.now() + BYPASS_TIMEOUT_MIN * 60 * 1000;
      chrome.alarms.create(ALARM_BYPASS_EXPIRE, { delayInMinutes: Math.max(0.5, BYPASS_TIMEOUT_MIN) });
      console.log("[corp-proxy] Bypass enabled for " + BYPASS_TIMEOUT_MIN + " minutes.");
    } else {
      currentProxyState.bypassExpiresAt = null;
      chrome.alarms.clear(ALARM_BYPASS_EXPIRE);
    }
    logEvent("info", "Proxy bypass toggled: " + (currentProxyState.bypassActive ? "ON (expires in " + BYPASS_TIMEOUT_MIN + "m)" : "OFF"));
    syncWithServer(true)
      .then(() => sendResponse({ ok: true, bypassActive: currentProxyState.bypassActive }))
      .catch(() => sendResponse({ ok: false, bypassActive: currentProxyState.bypassActive }));
    return true;
  }
});

// Alarm handler: periodic sync + bypass expiry
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_SYNC) {
    syncWithServer(false).catch((e) => console.warn("[corp-proxy] Periodic sync error:", e));
  } else if (alarm.name === ALARM_BYPASS_EXPIRE) {
    expireBypass();
  }
});

// Periodic Sync Alarm (interval from build config / GPO)
chrome.alarms.create(ALARM_SYNC, { periodInMinutes: Math.max(1, SYNC_INTERVAL_MIN) });

// If the service worker was restarted mid-bypass, re-arm the expiry
chrome.alarms.get(ALARM_BYPASS_EXPIRE, (alarm) => {
  if (!alarm && currentProxyState.bypassActive) {
    expireBypass();
  }
});

// Initialize on service worker start
applyWebRtcProtection();
syncWithServer(false).catch((e) => console.warn("[corp-proxy] Initial boot sync warning:", e));
`;

/**
 * Managed storage schema. Declares every key background.js actually reads -
 * previously `targetGroup` was read at runtime but never declared, so
 * group-based routing silently failed on GPO deployments.
 */
export const MANAGED_SCHEMA_TEMPLATE = `{
  "type": "object",
  "properties": {
    "extToken": {
      "type": "string",
      "description": "Shared corporate token for authentication on the mini-server (via X-Ext-Token header)."
    },
    "credsUrl": {
      "type": "string",
      "description": "Direct URL for /creds endpoint. Defaults to the build-configured server URL + /creds."
    },
    "syncUrl": {
      "type": "string",
      "description": "URL for /api/sync endpoint to receive dynamic proxy configuration and send heartbeat."
    },
    "autoConfigureProxy": {
      "type": "boolean",
      "description": "If true, extension manages chrome.proxy.settings dynamically according to the mini-server config."
    },
    "targetGroup": {
      "type": "string",
      "description": "Fleet group this device belongs to (used for group-scoped routing profiles)."
    }
  }
}
`;

/**
 * Substitute __PEC_*__ placeholders in the background.js template.
 */
export function renderBackgroundJs(cfg: {
  defaultServerUrl?: string;
  defaultToken?: string;
  syncIntervalMinutes?: number;
  bypassAutoTimeoutMinutes?: number;
  badgeIndicator?: boolean;
  targetGroup?: string;
}): string {
  const serverBase = String(cfg.defaultServerUrl || "https://mini-server.ic.local").replace(/\/+$/, "");
  const syncInterval = Math.max(1, Math.round(Number(cfg.syncIntervalMinutes) || 5));
  const bypassTimeout = Math.max(1, Math.round(Number(cfg.bypassAutoTimeoutMinutes) || 15));
  const badgeEnabled = cfg.badgeIndicator === false ? "false" : "true";

  return BACKGROUND_TEMPLATE
    .replace(/"__PEC_SERVER_BASE__"/g, JSON.stringify(serverBase))
    .replace(/"__PEC_DEFAULT_TOKEN__"/g, JSON.stringify(String(cfg.defaultToken || "")))
    .replace(/const SYNC_INTERVAL_MIN = [^;]+;/g, `const SYNC_INTERVAL_MIN = ${syncInterval};`)
    .replace(/const BYPASS_TIMEOUT_MIN = [^;]+;/g, `const BYPASS_TIMEOUT_MIN = ${bypassTimeout};`)
    .replace(/const BADGE_ENABLED = [^;]+;/g, `const BADGE_ENABLED = ${badgeEnabled};`)
    .replace(/"__PEC_TARGET_GROUP__"/g, JSON.stringify(String(cfg.targetGroup || "Default Fleet")));
}
