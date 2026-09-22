// background.js — Enterprise Chrome MV3 Service Worker
//
// 1. Centralized proxy synchronization (SOCKS5/HTTP/HTTPS/PAC) pushed by server.
// 2. Intercepts Basic-Auth proxy challenges (details.isProxy === true).
// 3. ZERO local credential persistence (strictly in-memory during worker lifecycle).
// 4. WebRTC IP Leak Protection & Status Badge.
// 5. Popup messaging support (GET_STATUS, FORCE_SYNC, TOGGLE_BYPASS).

const DEFAULT_SERVER_BASE = "https://mini-server.ic.local";
const DEFAULT_CREDS_URL = `${DEFAULT_SERVER_BASE}/creds`;
const DEFAULT_SYNC_URL = `${DEFAULT_SERVER_BASE}/api/sync`;

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
  lastSync: 0,
};

let ephemeralInstanceId = "inst_" + Math.random().toString(36).substring(2, 10);

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

    const token = managed.extToken || null;
    const credsUrl = isValidUrl(managed.credsUrl) ? managed.credsUrl : DEFAULT_CREDS_URL;
    const syncUrl = isValidUrl(managed.syncUrl) ? managed.syncUrl : DEFAULT_SYNC_URL;
    const autoConfigureProxy = managed.autoConfigureProxy !== false;
    const targetGroup = managed.targetGroup || "Default Fleet";

    return { token, credsUrl, syncUrl, autoConfigureProxy, targetGroup };
  } catch (e) {
    return {
      token: null,
      credsUrl: DEFAULT_CREDS_URL,
      syncUrl: DEFAULT_SYNC_URL,
      autoConfigureProxy: true,
      targetGroup: "Default Fleet",
    };
  }
}

// Update Action badge if action API is available
function updateBadge(text, color) {
  if (chrome.action && chrome.action.setBadgeText) {
    try {
      chrome.action.setBadgeText({ text });
      if (color && chrome.action.setBadgeBackgroundColor) {
        chrome.action.setBadgeBackgroundColor({ color });
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
    } catch (e) {
      console.warn("[corp-proxy] Could not set WebRTC IP handling policy:", e);
    }
  }
}

// Apply proxy settings to browser network stack
async function applyProxyConfig(config) {
  if (!chrome.proxy || !chrome.proxy.settings) return;

  try {
    if (currentProxyState.bypassActive || config.killSwitch || !config.enabled || config.protocol === "direct") {
      console.log("[corp-proxy] Routing set to DIRECT.");
      await chrome.proxy.settings.set({
        value: { mode: "direct" },
        scope: "regular",
      });
      updateBadge("DIR", "#f59e0b");
      return;
    }

    if (config.protocol === "pac" && config.pacUrl) {
      console.log("[corp-proxy] Applying PAC URL:", config.pacUrl);
      await chrome.proxy.settings.set({
        value: {
          mode: "pac_script",
          pacScript: {
            url: config.pacUrl,
            mandatory: false,
          },
        },
        scope: "regular",
      });
      updateBadge("PAC", "#0284c7");
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

    console.log(`[corp-proxy] Applying ${scheme.toUpperCase()} Proxy: ${config.host}:${config.port}`);
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
  } catch (err) {
    console.error("[corp-proxy] Error applying proxy settings:", err);
    updateBadge("ERR", "#ef4444");
  }
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

  if (forceRefresh) {
    memoryCredsCache = null;
  }

  syncPromise = (async () => {
    try {
      const { token, syncUrl, credsUrl, autoConfigureProxy, targetGroup } = await getManagedConfig();
      const manifest = chrome.runtime.getManifest();

      const headers = { "Content-Type": "application/json" };
      if (token) headers["X-Ext-Token"] = token;

      let syncSuccessful = false;

      try {
        const res = await fetch(syncUrl, {
          method: "POST",
          headers: headers,
          body: JSON.stringify({
            instanceId: ephemeralInstanceId,
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
            currentProxyState = {
              ...currentProxyState,
              online: true,
              protocol: payload.config.protocol || "http",
              host: payload.config.host || "",
              port: payload.config.port || 10809,
              profileName: payload.profileName || "Default Profile",
              lastSync: Date.now(),
            };

            if (autoConfigureProxy) {
              await applyProxyConfig(payload.config);
            }
          }
        }
      } catch (err) {
        console.warn("[corp-proxy] Sync endpoint error, trying fallback /creds:", err);
      }

      // Fallback to /creds
      if (!syncSuccessful) {
        const resFallback = await fetch(credsUrl, {
          headers: token ? { "X-Ext-Token": token } : {},
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (!resFallback.ok) {
          currentProxyState.online = false;
          throw new Error(`Creds fetch failed: HTTP ${resFallback.status}`);
        }

        const data = await resFallback.json();
        if (!data.user || !data.pass) {
          throw new Error("Invalid creds payload from server");
        }

        memoryCredsCache = {
          user: data.user,
          pass: data.pass,
          fetchedAt: Date.now(),
        };
        currentProxyState.online = true;
        currentProxyState.lastSync = Date.now();
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

    if (seenRequests.size > 1000) seenRequests.clear();
    const attempts = (seenRequests.get(details.requestId) || 0) + 1;
    seenRequests.set(details.requestId, attempts);

    if (attempts > MAX_AUTH_ATTEMPTS) {
      console.warn(`[corp-proxy] Max auth attempts exceeded for requestId=${details.requestId}`);
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
        asyncCallback({ authCredentials: { username: creds.user, password: creds.pass } });
      })
      .catch((err) => {
        console.error("[corp-proxy] onAuthRequired error:", err);
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
    sendResponse(currentProxyState);
    return true;
  }
  if (msg.action === "FORCE_SYNC") {
    syncWithServer(true).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg.action === "TOGGLE_BYPASS") {
    currentProxyState.bypassActive = !currentProxyState.bypassActive;
    syncWithServer(true).then(() => sendResponse({ ok: true, bypassActive: currentProxyState.bypassActive }));
    return true;
  }
});

// Periodic Sync Alarm
chrome.alarms.create("corp_proxy_sync", { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "corp_proxy_sync") {
    syncWithServer(false).catch((e) => console.warn("[corp-proxy] Periodic sync error:", e));
  }
});

// Initialize on service worker start
applyWebRtcProtection();
syncWithServer(false).catch((e) => console.warn("[corp-proxy] Initial boot sync warning:", e));
