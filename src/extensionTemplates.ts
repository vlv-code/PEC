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

import type { ExtensionBuildConfig } from "./types.js";

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

// Fail fast on un-substituted build placeholders (loaded extension/ instead of dist/unpacked)
if (DEFAULT_SERVER_BASE.startsWith("__" + "PEC_")) {
  console.error(
    "[corp-proxy] FATAL: server URL placeholder was not substituted. " +
    "You probably loaded the raw extension/ template directory instead of the " +
    "built dist/unpacked/ output. Proxy sync is DISABLED."
  );
}

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

  // Chrome's pacScript.data API strictly requires 7-bit ASCII code.
  // If pacText contains any non-ASCII characters (e.g. Cyrillic comments or IDN domains),
  // sanitize them to ASCII (Punycode domains, ASCII comments) to avoid Chrome throwing:
  // "Error: 'pacScript.data' supports only ASCII code(encode URLs in Punycode format)".
  if (pacText !== null) {
    let hasNonAscii = false;
    for (let i = 0; i < pacText.length; i++) {
      if (pacText.charCodeAt(i) > 127) {
        hasNonAscii = true;
        break;
      }
    }

    if (hasNonAscii) {
      const nl = String.fromCharCode(10);
      const lines = pacText.split(nl);
      for (let i = 0; i < lines.length; i++) {
        const commentIdx = lines[i].indexOf("//");
        if (commentIdx !== -1) {
          let cleanComment = "";
          for (let c = commentIdx; c < lines[i].length; c++) {
            if (lines[i].charCodeAt(c) <= 127) cleanComment += lines[i][c];
          }
          lines[i] = lines[i].slice(0, commentIdx) + cleanComment;
        }
      }
      let sanitized = lines.join(nl);

      sanitized = sanitized.replace(/"([^"]*)"/g, (match, content) => {
        let contentNonAscii = false;
        for (let j = 0; j < content.length; j++) {
          if (content.charCodeAt(j) > 127) {
            contentNonAscii = true;
            break;
          }
        }
        if (contentNonAscii) {
          try {
            const isWild = content.startsWith("*.");
            const isDot = !isWild && content.startsWith(".");
            const raw = isWild ? content.slice(2) : isDot ? content.slice(1) : content;
            const host = new URL("http://" + raw).hostname;
            return '"' + (isWild ? "*." + host : isDot ? "." + host : host) + '"';
          } catch {
            let clean = "";
            for (let k = 0; k < content.length; k++) {
              if (content.charCodeAt(k) <= 127) clean += content[k];
            }
            return '"' + clean + '"';
          }
        }
        return match;
      });

      let finalClean = "";
      for (let m = 0; m < sanitized.length; m++) {
        if (sanitized.charCodeAt(m) <= 127) finalClean += sanitized[m];
      }

      if (finalClean.indexOf("FindProxyForURL") !== -1) {
        logEvent("info", "Sanitized non-ASCII characters from PAC script for Chrome ASCII compliance");
        pacText = finalClean;
      } else {
        logEvent("warn", "PAC script contained non-ASCII characters that could not be sanitized, falling back to URL mode");
        pacText = null;
      }
    }
  }

  const useInline = pacText !== null;
  const pacRev = useInline ? pacRevisionOf(pacText) : null;
  console.log("[corp-proxy] Applying PAC " + (useInline
    ? "(inline, " + pacText.length + " bytes, generated " + pacRev + ") from " + pacUrl
    : "(URL fallback - browser fetches it) " + pacUrl));
  logEvent("info", "Applying PAC " + (useInline
    ? "(inline, " + pacText.length + " bytes, rev " + pacRev + ")"
    : "(URL mode fallback)") + " from " + pacUrl);

  try {
    await chrome.proxy.settings.set({
      value: {
        mode: "pac_script",
        pacScript: useInline
          ? { data: pacText, mandatory: false }
          : { url: pacUrl, mandatory: false },
      },
      scope: "regular",
    });
  } catch (setErr) {
    if (useInline) {
      console.warn("[corp-proxy] Inline PAC installation failed (" + (setErr && setErr.message ? setErr.message : setErr) + "), falling back to URL mode:", pacUrl);
      logEvent("warn", "Inline PAC installation failed, falling back to URL mode: " + (setErr && setErr.message ? setErr.message : setErr));
      await chrome.proxy.settings.set({
        value: {
          mode: "pac_script",
          pacScript: { url: pacUrl, mandatory: false },
        },
        scope: "regular",
      });
    } else {
      throw setErr;
    }
  }
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

export function getPopupTranslations(cfg: ExtensionBuildConfig) {
  const isRu = (cfg.locale || "ru") === "ru";
  return {
    isRu,
    title: cfg.name,
    active: isRu ? "Активен" : "Active",
    bypassed: isRu ? "Обход активен" : "Bypass Active",
    offline: isRu ? "Отключен" : "Offline",
    tabConn: isRu ? "Подключение" : "Connection",
    tabRules: isRu ? "Маршрутизация" : "Routing",
    tabDiag: isRu ? "Диагностика" : "Diagnostics",
    tabHelp: isRu ? "Поддержка" : "Support",
    proxyMode: isRu ? "Режим прокси" : "Proxy Mode",
    activeEndpoint: isRu ? "Прокси-сервер" : "Active Endpoint",
    routingProfile: isRu ? "Профиль правил" : "Routing Profile",
    latency: isRu ? "Задержка (Пинг)" : "Latency (Ping)",
    btnSync: isRu ? "Синхронизировать сейчас" : "Sync with Server Now",
    btnBypass: isRu ? `Временно отключить (${cfg.bypassAutoTimeoutMinutes || 15}м)` : `Bypass Proxy Temporarily (${cfg.bypassAutoTimeoutMinutes || 15}m)`,
    btnResume: isRu ? "Включить прокси" : "Resume Proxy Now",
    bypassRestricted: isRu ? "🔒 Прямой обход ограничен политикой безопасности предприятия." : "🔒 Direct bypass is restricted by IT enterprise policy.",
    defaultFallback: isRu ? "По умолчанию" : "Default Fallback",
    aiModels: isRu ? "🤖 Модели AI и LLM" : "🤖 AI & LLM Models",
    corpIntranet: isRu ? "🏢 Корпоративная сеть RFC1918" : "🏢 Corporate RFC1918",
    adsTelemetry: isRu ? "🛡️ Реклама и телеметрия" : "🛡️ Ads & Telemetry",
    socialMedia: isRu ? "🌐 Медиа и соцсети" : "🌐 Global Social / Media",
    webrtcShield: isRu ? "Защита WebRTC IP" : "WebRTC IP Shield",
    webrtcStatus: isRu ? "Защищено (без утечки UDP)" : "Protected (No UDP leak)",
    dnsGuard: isRu ? "Защита от подмены DNS" : "DNS Poisoning Guard",
    dnsStatus: isRu ? "Включена" : "Enforced",
    exitIp: isRu ? "Текущий внешний IP" : "Current Exit IP",
    btnCheckIp: isRu ? "Проверить Egress IP и Гео" : "Verify Egress IP & Geo",
    checkingIp: isRu ? "Проверка IP..." : "Checking IP...",
    syncingCreds: isRu ? "Синхронизация..." : "Syncing credentials...",
    supportText: isRu ? "При возникновении проблем с доступом или для запроса новых политик обратитесь в службу поддержки:" : "For proxy connectivity issues, network access requests, or policy updates, contact the enterprise security team:",
    helpdesk: isRu ? "Техподдержка" : "Helpdesk",
    buildVer: isRu ? "Версия сборки" : "Build Version",
    contactSupport: isRu ? "Написать в службу поддержки" : "Contact IT Support Desk",
    rulesNotice: isRu ? "Правила маршрутизации и обхода определяются активным PAC-профилем с сервера PEC." : "Rules are centrally managed and compiled to /proxy.pac dynamically.",
    connError: isRu ? "Ошибка связи" : "Connection Error",
    serverUnreachable: isRu ? "Сервер PEC недоступен" : "PEC Server Unreachable",
    eventLog: isRu ? "Журнал событий" : "Event Log",
    zeroEntries: isRu ? "0 записей" : "0 entries",
    emptyLog: isRu ? "Журнал пуст" : "No log entries",
    entriesSuffix: isRu ? " записей" : " entries",
    copyLogs: isRu ? "Скопировать логи" : "Copy logs",
    clearLogs: isRu ? "Очистить" : "Clear",
    copied: isRu ? "Скопировано!" : "Copied!",
  };
}

export function renderPopupHtml(cfg: ExtensionBuildConfig, colors?: Record<string, string>): string {
  const t = getPopupTranslations(cfg);
  const effectiveColors = {
    primary: cfg.themeColor || "#0284c7",
    bg: cfg.themeBackground || "#0b1120",
    card: cfg.themeCard || "#111c35",
    border: "#1e293b",
    text: "#f8fafc",
    ...colors,
  };

  return `<!DOCTYPE html>
<html lang="${cfg.locale || "ru"}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${cfg.name}</title>
  <style>
    :root {
      --primary: ${effectiveColors.primary};
      --bg: ${effectiveColors.bg};
      --card: ${effectiveColors.card};
      --border: ${effectiveColors.border};
      --text: ${effectiveColors.text};
      --text-muted: #94a3b8;
      --success: #10b981;
      --danger: #ef4444;
      --warning: #f59e0b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 340px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 14px;
      font-size: 13px;
      line-height: 1.4;
      user-select: none;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--border);
      padding-bottom: 10px;
      margin-bottom: 10px;
    }
    .brand { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14px; }
    .brand-icon {
      width: 24px;
      height: 24px;
      border-radius: 6px;
      background: var(--primary);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      background: rgba(16, 185, 129, 0.1);
      color: var(--success);
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .status-badge .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); }
    .status-badge.offline {
      background: rgba(239, 68, 68, 0.1);
      color: var(--danger);
      border-color: rgba(239, 68, 68, 0.3);
    }
    .status-badge.offline .dot { background: var(--danger); }
    .status-badge.bypass {
      background: rgba(245, 158, 11, 0.1);
      color: var(--warning);
      border-color: rgba(245, 158, 11, 0.3);
    }
    .status-badge.bypass .dot { background: var(--warning); }

    /* Nav Tabs */
    .tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 12px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 6px;
    }
    .tab-btn {
      flex: 1;
      background: transparent;
      border: none;
      color: var(--text-muted);
      font-size: 11px;
      font-weight: 600;
      padding: 6px 4px;
      border-radius: 5px;
      cursor: pointer;
      text-align: center;
    }
    .tab-btn.active {
      background: var(--card);
      color: var(--primary);
      border: 1px solid var(--border);
    }

    .tab-content { display: none; }
    .tab-content.active { display: block; }

    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 12px;
      margin-bottom: 10px;
    }
    .row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 12px; }
    .label { color: var(--text-muted); font-size: 11px; }
    .val { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 600; font-size: 12px; }
    
    .btn-primary {
      width: 100%;
      background: var(--primary);
      color: #0b1120;
      font-weight: 600;
      border: none;
      padding: 8px 12px;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      font-size: 12px;
      transition: opacity 0.2s;
    }
    .btn-primary:hover { opacity: 0.9; }

    .btn-sec {
      width: 100%;
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text);
      font-weight: 500;
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 11px;
      margin-top: 6px;
      transition: background 0.2s;
    }
    .btn-sec:hover { background: rgba(255, 255, 255, 0.05); }
    .btn-sec.warning { color: var(--warning); border-color: rgba(245, 158, 11, 0.3); }

    .tag {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 2px 5px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.08);
      color: var(--text-muted);
    }
    .support-box {
      font-size: 11px;
      color: var(--text-muted);
      line-height: 1.5;
      margin-bottom: 8px;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="brand-icon">⚡</div>
      <span>${cfg.shortName || cfg.name}</span>
    </div>
    <div class="status-badge offline" id="badge">
      <div class="dot"></div>
      <span id="statusText">${t.offline}</span>
    </div>
  </header>

  <!-- Navigation Tabs -->
  <div class="tabs">
    <button class="tab-btn active" data-tab="conn">${t.tabConn}</button>
    <button class="tab-btn" data-tab="rules">${t.tabRules}</button>
    <button class="tab-btn" data-tab="diag">${t.tabDiag}</button>
    <button class="tab-btn" data-tab="help">${t.tabHelp}</button>
  </div>

  <!-- TAB 1: Connection -->
  <div class="tab-content active" id="tab-conn">
    <div class="card">
      <div class="row">
        <span class="label">${t.proxyMode}</span>
        <span class="tag" id="modeVal">PAC</span>
      </div>
      <div class="row">
        <span class="label">${t.activeEndpoint}</span>
        <span class="val" id="serverVal">—</span>
      </div>
      <div class="row">
        <span class="label">${t.routingProfile}</span>
        <span class="val" id="profileVal">—</span>
      </div>
      <div class="row">
        <span class="label">${t.latency}</span>
        <span class="val" id="pingVal">—</span>
      </div>
    </div>

    <button id="btnSync" class="btn-primary">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
      <span>${t.btnSync}</span>
    </button>

    ${cfg.allowUserBypass ? `
    <button id="btnToggleBypass" class="btn-sec warning">
      ${t.btnBypass}
    </button>` : `
    <div style="font-size: 10px; color: var(--text-muted); text-align: center; margin-top: 8px;">
      ${t.bypassRestricted}
    </div>`}
  </div>

  <!-- TAB 2: Routing -->
  <div class="tab-content" id="tab-rules">
    <div class="card">
      <div class="row" style="margin-bottom: 6px;">
        <span class="label">${t.defaultFallback}</span>
        <span class="tag" id="tabRulesDefaultPolicy">DIRECT</span>
      </div>
      <div style="font-size: 11px; color: var(--text-muted); line-height: 1.5; margin-top: 8px;">
        ${t.rulesNotice}
      </div>
    </div>
  </div>

  <!-- TAB 3: Diagnostics -->
  <div class="tab-content" id="tab-diag">
    <div class="card">
      <div class="row">
        <span class="label">${t.webrtcShield}</span>
        <span class="val" style="color: var(--success);">${cfg.webRtcProtection ? t.webrtcStatus : "Disabled"}</span>
      </div>
      <div class="row">
        <span class="label">${t.dnsGuard}</span>
        <span class="val" style="color: var(--success);">${cfg.dnsLeakProtection ? t.dnsStatus : "Off"}</span>
      </div>
      <div class="row">
        <span class="label">${t.exitIp}</span>
        <span class="val" id="exitIpVal">—</span>
      </div>
    </div>

    ${cfg.showIpGeoChecker ? `
    <button id="btnCheckIp" class="btn-sec">
      ${t.btnCheckIp}
    </button>` : ""}

    <div class="card" style="margin-top: 10px;">
      <div class="row" style="margin-bottom: 6px;">
        <span class="label" style="font-weight: 600;">${t.eventLog}</span>
        <span class="tag" id="logCountTag" style="font-size: 10px;">${t.zeroEntries}</span>
      </div>
      <pre id="logContainer" style="background: #050914; border: 1px solid var(--border); border-radius: 6px; padding: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; color: #94a3b8; max-height: 150px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; margin: 4px 0 8px 0;"></pre>
      <div style="display: flex; gap: 6px;">
        <button id="btnCopyLogs" class="btn-sec" style="margin-top: 0; flex: 1; padding: 5px 8px; font-size: 11px;">
          ${t.copyLogs}
        </button>
        <button id="btnClearLogs" class="btn-sec" style="margin-top: 0; flex: 1; padding: 5px 8px; font-size: 11px;">
          ${t.clearLogs}
        </button>
      </div>
    </div>
  </div>

  <!-- TAB 4: Support -->
  <div class="tab-content" id="tab-help">
    <div class="card">
      <div class="support-box">
        ${t.supportText}
      </div>
      <div class="row">
        <span class="label">${t.helpdesk}</span>
        <span class="val">${cfg.supportUrl || "mailto:it-support@corp.local"}</span>
      </div>
      <div class="row">
        <span class="label">${t.buildVer}</span>
        <span class="val">v${cfg.version}</span>
      </div>
    </div>

    <a href="${cfg.supportUrl || "mailto:it-support@corp.local"}" target="_blank" style="text-decoration: none;">
      <button class="btn-sec">
        ${t.contactSupport}
      </button>
    </a>
  </div>

  <script src="popup.js"></script>
</body>
</html>`;
}

export function renderPopupJs(cfg: ExtensionBuildConfig): string {
  const t = getPopupTranslations(cfg);
  return `// Global tab switching helper
window.switchPopupTab = function(tabId) {
  if (!tabId) return;
  const tabs = document.querySelectorAll(".tab-btn");
  tabs.forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));

  const activeBtn = document.querySelector('.tab-btn[data-tab="' + tabId + '"]');
  if (activeBtn) activeBtn.classList.add("active");
  const target = document.getElementById("tab-" + tabId) || document.getElementById(tabId);
  if (target) target.classList.add("active");

  if (tabId === "diag" && typeof window.__pecLoadLogs === "function") {
    window.__pecLoadLogs();
  }
};

// Global state applier - reactive to simulator and chrome.runtime
window.applyPopupState = function(response) {
  if (!response) return;
  const statusText = document.getElementById("statusText");
  const badge = document.getElementById("badge");
  const modeVal = document.getElementById("modeVal");
  const serverVal = document.getElementById("serverVal");
  const profileVal = document.getElementById("profileVal");
  const pingVal = document.getElementById("pingVal");
  const exitIpVal = document.getElementById("exitIpVal");
  const btnToggle = document.getElementById("btnToggleBypass");
  const tabRulesDefaultPolicy = document.getElementById("tabRulesDefaultPolicy");

  if (statusText) {
    if (response.bypassActive) statusText.textContent = "${t.bypassed}";
    else if (!response.online) statusText.textContent = "${t.offline}";
    else statusText.textContent = "${t.active}";
  }
  if (badge) {
    if (response.bypassActive) {
      badge.className = "status-badge bypass";
    } else if (!response.online) {
      badge.className = "status-badge offline";
    } else {
      badge.className = "status-badge";
    }
  }
  if (modeVal) {
    const proto = response.protocol ? response.protocol.toUpperCase() : "—";
    const pol = response.profileDefaultPolicy === "direct" ? " (${t.isRu ? "селективный" : "selective"})" : (response.profileDefaultPolicy === "proxy" ? " (${t.isRu ? "туннель" : "tunnel"})" : "");
    modeVal.textContent = proto + pol;
  }
  if (serverVal) serverVal.textContent = (response.online && response.host) ? (response.host + ":" + response.port) : (response.online ? "Direct" : "${t.offline}");
  if (profileVal) profileVal.textContent = response.profileName || "Selective PAC";
  if (tabRulesDefaultPolicy && response.profileDefaultPolicy) {
    tabRulesDefaultPolicy.textContent = response.profileDefaultPolicy.toUpperCase();
  }
  if (pingVal) pingVal.textContent = (response.online && response.ping) ? response.ping : "—";
  if (exitIpVal && response.exitIp) exitIpVal.textContent = response.exitIp;
  if (response.serverBase) window.__pecServerBase = response.serverBase;
  if (btnToggle) {
    btnToggle.textContent = response.bypassActive ? "${t.btnResume}" : "${t.btnBypass}";
  }
};

window.addEventListener("message", function(e) {
  if (e.data && e.data.type === "UPDATE_SIM_STATE") {
    window.applyPopupState(e.data.state);
  }
});

function initPopup() {
  const tabs = document.querySelectorAll(".tab-btn");
  tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      const tabId = btn.dataset.tab;
      window.switchPopupTab(tabId);
    });
  });

  const btnSync = document.getElementById("btnSync");
  const btnToggle = document.getElementById("btnToggleBypass");
  const btnCheckIp = document.getElementById("btnCheckIp");

  async function loadState() {
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) {
      return;
    }
    try {
      const response = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
      if (chrome.runtime.lastError) {
        console.warn("Could not retrieve status:", chrome.runtime.lastError.message);
        return;
      }
      window.applyPopupState(response);
    } catch (err) {
      console.warn("Failed to talk to background worker:", err);
    }
  }

  if (btnSync) {
    btnSync.addEventListener("click", async () => {
      const originalText = btnSync.querySelector("span")?.textContent || "";
      if (btnSync.querySelector("span")) btnSync.querySelector("span").textContent = "${t.syncingCreds}";
      btnSync.style.opacity = "0.7";
      try {
        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
          const res = await chrome.runtime.sendMessage({ type: "FORCE_SYNC" });
          window.applyPopupState(res);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setTimeout(() => {
          if (btnSync.querySelector("span")) btnSync.querySelector("span").textContent = originalText;
          btnSync.style.opacity = "1";
        }, 600);
      }
    });
  }

  if (btnToggle) {
    btnToggle.addEventListener("click", async () => {
      btnToggle.style.opacity = "0.7";
      try {
        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
          const res = await chrome.runtime.sendMessage({ type: "TOGGLE_BYPASS" });
          window.applyPopupState(res);
        }
      } catch (err) {
        console.error(err);
      } finally {
        btnToggle.style.opacity = "1";
      }
    });
  }

  if (btnCheckIp) {
    btnCheckIp.addEventListener("click", async () => {
      const exitIpVal = document.getElementById("exitIpVal");
      if (exitIpVal) exitIpVal.textContent = "${t.checkingIp}";
      btnCheckIp.style.opacity = "0.7";

      const serverBase = window.__pecServerBase || "";
      const url = serverBase ? serverBase + "/ip-echo" : "/ip-echo";

      try {
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (exitIpVal) exitIpVal.textContent = data.ip + (data.geo ? " (" + data.geo + ")" : "");
        } else {
          if (exitIpVal) exitIpVal.textContent = "${t.connError} (" + res.status + ")";
        }
      } catch (err) {
        if (exitIpVal) exitIpVal.textContent = "${t.serverUnreachable}";
      } finally {
        setTimeout(() => {
          btnCheckIp.style.opacity = "1";
        }, 500);
      }
    });
  }

  // Diagnostics log viewer
  function formatTime(iso) {
    try {
      const d = new Date(iso);
      return d.toTimeString().split(" ")[0];
    } catch {
      return "";
    }
  }

  function renderLogs(logs) {
    const container = document.getElementById("logContainer");
    const countTag = document.getElementById("logCountTag");
    if (!container) return;
    if (!logs || !logs.length) {
      container.textContent = "${t.emptyLog}";
      if (countTag) countTag.textContent = "${t.zeroEntries}";
      return;
    }
    if (countTag) countTag.textContent = logs.length + "${t.entriesSuffix}";
    container.textContent = logs
      .map(function(l) {
        const time = formatTime(l.time);
        const lvl = (l.level || "info").toUpperCase().padEnd(5);
        return "[" + time + "] " + lvl + " " + l.message;
      })
      .join("\\n");
    container.scrollTop = container.scrollHeight;
  }

  async function loadLogs() {
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) return;
    try {
      const resp = await chrome.runtime.sendMessage({ type: "GET_LOGS" });
      if (resp && resp.logs) {
        renderLogs(resp.logs);
      }
    } catch (e) {
      console.warn("Failed to load logs:", e);
    }
  }

  window.__pecLoadLogs = loadLogs;

  const btnCopyLogs = document.getElementById("btnCopyLogs");
  if (btnCopyLogs) {
    btnCopyLogs.addEventListener("click", async function() {
      const container = document.getElementById("logContainer");
      if (container && container.textContent) {
        try {
          await navigator.clipboard.writeText(container.textContent);
          const orig = btnCopyLogs.textContent;
          btnCopyLogs.textContent = "${t.copied}";
          setTimeout(function() { btnCopyLogs.textContent = orig; }, 1500);
        } catch (e) {
          console.warn("Clipboard copy failed:", e);
        }
      }
    });
  }

  const btnClearLogs = document.getElementById("btnClearLogs");
  if (btnClearLogs) {
    btnClearLogs.addEventListener("click", async function() {
      if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) return;
      try {
        await chrome.runtime.sendMessage({ type: "CLEAR_LOGS" });
        renderLogs([]);
      } catch (e) {
        console.warn("Failed to clear logs:", e);
      }
    });
  }

  loadState();
  loadLogs();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPopup);
} else {
  initPopup();
}`;
}
