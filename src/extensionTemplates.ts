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
const SYNC_INTERVAL_MIN = /* __PEC_SYNC_INTERVAL_MIN__ */ 5;
const BYPASS_TIMEOUT_MIN = /* __PEC_BYPASS_TIMEOUT_MIN__ */ 15;
const BADGE_ENABLED = /* __PEC_BADGE_ENABLED__ */ true;
const DEFAULT_TARGET_GROUP = "__PEC_TARGET_GROUP__";

// Fail fast on un-substituted build placeholders (loaded extension/ instead of dist/unpacked)
if (DEFAULT_SERVER_BASE.startsWith("__" + "PEC_")) {
  console.error(
    "[PEC] FATAL: server URL placeholder was not substituted. " +
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
let lastConfig = null;
let cachedBasePacText = null;
let currentProxyState = {
  enabled: true,
  online: false,
  protocol: "http",
  host: "",
  port: 10809,
  profileName: "Default Split",
  profileDefaultPolicy: "direct",
  proxyReachable: true,
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
    chrome.storage.local.get(["pecLogs", "pecProxyState", "pecLastConfig", "pecEnabled", "pecCredsCache", "pecBasePac"], (res) => {
      if (res && Array.isArray(res.pecLogs) && recentLogs.length === 0) {
        recentLogs = res.pecLogs.slice(-MAX_LOGS);
      }
      if (res && res.pecProxyState && typeof res.pecProxyState === "object") {
        currentProxyState = { ...currentProxyState, ...res.pecProxyState };
      }
      if (res && res.pecLastConfig && typeof res.pecLastConfig === "object") {
        lastConfig = res.pecLastConfig;
      }
      if (res && typeof res.pecEnabled === "boolean") {
        currentProxyState.enabled = res.pecEnabled;
      }
      if (res && res.pecCredsCache && res.pecCredsCache.user && res.pecCredsCache.pass) {
        memoryCredsCache = res.pecCredsCache;
      }
      if (res && res.pecBasePac && typeof res.pecBasePac === "string" && !cachedBasePacText) {
        cachedBasePacText = res.pecBasePac;
      }
    });
  }
} catch (e) {}

function persistProxyState() {
  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local && chrome.storage.local.set) {
      chrome.storage.local.set({ pecProxyState: currentProxyState, pecEnabled: currentProxyState.enabled !== false });
    }
  } catch (e) {}
}

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
  const prefix = "[PEC][" + entry.level.toUpperCase() + "]";
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
      if (chrome.action.setBadgeTextColor) {
        chrome.action.setBadgeTextColor({ color: "#ffffff" });
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
      console.log("[PEC] WebRTC IP leak protection enforced.");
      logEvent("info", "WebRTC IP leak protection enforced (disable_non_proxied_udp)");
    } catch (e) {
      console.warn("[PEC] Could not set WebRTC IP handling policy:", e);
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
      console.log("[PEC] Proxy verified: mode=" + mode + ", control=" + control + " - config is LIVE in the browser.");
      logEvent("info", "Proxy verified: mode=" + mode + ", control=" + control + " (active)");
    } else if (control === "controlled_by_other_extensions" || control === "not_controllable") {
      console.warn("[PEC] Proxy NOT in effect: mode=" + mode + ", control=" + control +
        " - the proxy setting is owned by " +
        (control === "not_controllable" ? "an enterprise policy" : "another extension") +
        ", our config is ignored.");
      logEvent("error", "Proxy NOT active: owned by " + (control === "not_controllable" ? "enterprise policy" : "another extension") + " (" + control + ")");
    } else {
      console.warn("[PEC] Proxy NOT verified: mode=" + mode + ", control=" + control);
      logEvent("warn", "Proxy NOT verified: mode=" + mode + ", control=" + control);
    }
  } catch (err) {
    console.warn("[PEC] Verification read failed:", err && err.message ? err.message : err);
    logEvent("warn", "Verification read failed: " + (err && err.message ? err.message : err));
  }
}

// Injects user-defined routing rules (PROXY or DIRECT) ahead of corporate PAC rules
// inside FindProxyForURL(url, host).
function injectUserRulesIntoPac(pacText, userRules, proxyServer, proxyProtocol) {
  if (!pacText || typeof pacText !== "string") return pacText;
  if (!Array.isArray(userRules) || userRules.length === 0) return pacText;

  const activeRules = userRules.filter((r) => r && r.enabled && r.pattern && typeof r.pattern === "string" && r.pattern.trim());
  if (activeRules.length === 0) return pacText;

  // Detect proxy protocol if specified or if pacText contains SOCKS5/HTTPS directives
  let proto = (proxyProtocol || "").toLowerCase();
  if (!proto || proto === "pac") {
    if (pacText.indexOf("SOCKS5 ") !== -1) proto = "socks5";
    else if (pacText.indexOf("HTTPS ") !== -1) proto = "https";
  }

  // Find the proxy directive already in use in pacText (excluding placeholder / sinkhole IPs)
  const pacDirMatch = pacText.match(/return\\s+"((?:SOCKS5|HTTPS|PROXY)\\s+(?!127\\.0\\.0\\.1|10\\.0\\.0\\.1|0\\.0\\.0\\.0)[^"]+)";/i);
  let defaultProxyDirective = pacDirMatch ? pacDirMatch[1] : "";

  if (!defaultProxyDirective && proxyServer) {
    if (proto === "socks5") {
      defaultProxyDirective = "SOCKS5 " + proxyServer;
    } else if (proto === "https") {
      defaultProxyDirective = "HTTPS " + proxyServer;
    } else {
      defaultProxyDirective = "PROXY " + proxyServer;
    }
  } else if (!defaultProxyDirective) {
    defaultProxyDirective = "DIRECT";
  }

  // If the host script provides a fallback suffix (; DIRECT), ensure defaultProxyDirective also inherits it
  if (pacText.indexOf("; DIRECT") !== -1 && defaultProxyDirective.indexOf("; DIRECT") === -1 && defaultProxyDirective !== "DIRECT") {
    defaultProxyDirective += "; DIRECT";
  }

  const nl = String.fromCharCode(10);
  let ruleLines = "  // === USER OVERRIDES BEGIN ===" + nl;
  ruleLines += '  host = ("" + host).toLowerCase();' + nl;
  for (const r of activeRules) {
    let rawPattern = (r.pattern ? r.pattern.trim() : "");
    // Strip protocol if user pasted full URL (e.g. https://site.com/abc -> site.com)
    if (rawPattern.indexOf("://") !== -1) {
      try {
        rawPattern = new URL(rawPattern).hostname;
      } catch (e) {
        rawPattern = rawPattern.replace(/^[a-z]+:\\/\\//i, "").split("/")[0].split(":")[0];
      }
    } else if (rawPattern.indexOf("/") !== -1) {
      rawPattern = rawPattern.split("/")[0].trim();
    }
    if (rawPattern.indexOf(":") !== -1 && rawPattern.indexOf("]") === -1) {
      rawPattern = rawPattern.split(":")[0].trim();
    }
    // Sanitize pattern: strip newlines, quotes and backslashes
    let cleanPattern = rawPattern.replace(/["\\\\\\r\\n]/g, "");
    if (!cleanPattern) continue;

    // Support IDN / Punycode conversion if non-ASCII characters are present so Chrome 7-bit ASCII compliance is never violated
    let hasNonAscii = false;
    for (let j = 0; j < cleanPattern.length; j++) {
      if (cleanPattern.charCodeAt(j) > 127) {
        hasNonAscii = true;
        break;
      }
    }
    if (hasNonAscii) {
      try {
        if (cleanPattern.startsWith("*.")) {
          const ascii = new URL("http://" + cleanPattern.slice(2)).hostname;
          cleanPattern = "*." + ascii;
        } else if (cleanPattern.startsWith(".")) {
          const ascii = new URL("http://" + cleanPattern.slice(1)).hostname;
          cleanPattern = "." + ascii;
        } else if (cleanPattern.indexOf("*") === -1 && cleanPattern.indexOf("/") === -1) {
          cleanPattern = new URL("http://" + cleanPattern).hostname;
        } else {
          cleanPattern = cleanPattern
            .split(".")
            .map((part) => {
              let partNonAscii = false;
              for (let k = 0; k < part.length; k++) {
                if (part.charCodeAt(k) > 127) {
                  partNonAscii = true;
                  break;
                }
              }
              if (partNonAscii && part.indexOf("*") === -1) {
                try {
                  const h = new URL("http://" + part + ".test").hostname;
                  return h.endsWith(".test") ? h.slice(0, -5) : h;
                } catch {
                  return part;
                }
              }
              return part;
            })
            .join(".");
        }
      } catch (e) {}

      let asciiOnly = "";
      for (let m = 0; m < cleanPattern.length; m++) {
        if (cleanPattern.charCodeAt(m) <= 127) {
          asciiOnly += cleanPattern[m];
        }
      }
      cleanPattern = asciiOnly;
      if (!cleanPattern) continue;
    }

    const actionUpper = String(r.action || "PROXY").toUpperCase();
    let actionStr = defaultProxyDirective;
    if (actionUpper === "DIRECT") {
      actionStr = "DIRECT";
    } else if (actionUpper === "BLOCK") {
      actionStr = "PROXY 127.0.0.1:0";
    } else {
      actionStr = defaultProxyDirective;
      if (!actionStr.includes("; DIRECT") && actionStr !== "DIRECT" && !actionStr.includes("127.0.0.1")) {
        actionStr += "; DIRECT";
      }
    }

    let condition = "";
    const lower = cleanPattern.toLowerCase();
    if (cleanPattern.startsWith("*.")) {
      const root = cleanPattern.slice(2);
      condition = 'shExpMatch(host, "' + lower + '") || host === "' + root.toLowerCase() + '" || dnsDomainIs(host, ".' + cleanPattern.slice(2) + '")';
    } else if (cleanPattern.startsWith(".")) {
      const root = cleanPattern.slice(1);
      condition = 'shExpMatch(host, "*.' + root.toLowerCase() + '") || host === "' + root.toLowerCase() + '" || dnsDomainIs(host, ".' + cleanPattern.slice(1) + '")';
    } else if (cleanPattern.indexOf("*") === -1 && cleanPattern.indexOf("/") === -1) {
      condition = 'host === "' + lower + '" || dnsDomainIs(host, ".' + cleanPattern + '") || shExpMatch(host, "*.' + lower + '")';
    } else {
      condition = 'shExpMatch(host, "' + lower + '")';
    }

    ruleLines += '  if (' + condition + ') { return "' + actionStr + '"; }' + nl;
  }
  ruleLines += "  // === USER OVERRIDES END ===" + nl;

  const marker = "function FindProxyForURL(url, host) {";
  const targetIdx = pacText.indexOf(marker);
  if (targetIdx !== -1) {
    const insertPos = targetIdx + marker.length;
    return pacText.slice(0, insertPos) + nl + ruleLines + pacText.slice(insertPos);
  }
  const fnIdx = pacText.indexOf("FindProxyForURL");
  if (fnIdx !== -1) {
    const braceIdx = pacText.indexOf("{", fnIdx);
    if (braceIdx !== -1) {
      const insertPos = braceIdx + 1;
      return pacText.slice(0, insertPos) + nl + ruleLines + pacText.slice(insertPos);
    }
  }
  return pacText;
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
async function applyPacScript(pacUrl, config, forcePacFetch = false) {
  let pacText = (!forcePacFetch && cachedBasePacText) ? cachedBasePacText : null;
  if (!pacText) {
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
          cachedBasePacText = text;
        } else {
          console.warn("[PEC] PAC endpoint returned an invalid script (no FindProxyForURL).");
          logEvent("warn", "PAC endpoint returned invalid script (no FindProxyForURL), falling back to URL mode");
        }
      } else {
        console.warn("[PEC] PAC download failed: HTTP " + res.status + " - falling back to URL mode.");
        logEvent("warn", "PAC download failed: HTTP " + res.status + " - falling back to URL mode");
      }
    } catch (err) {
      console.warn("[PEC] PAC download error - falling back to URL mode:", err && err.message ? err.message : err);
      logEvent("warn", "PAC download error (" + (err && err.message ? err.message : err) + ") - falling back to URL mode");
    }
  }

  // Inject active user overrides ahead of corporate rules
  if (pacText !== null) {
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local && chrome.storage.local.get) {
        const stored = await chrome.storage.local.get(["pecUserRules"]);
        if (stored && Array.isArray(stored.pecUserRules) && stored.pecUserRules.length > 0) {
          const proxyHost = (config && config.host) || currentProxyState.host || "";
          const proxyPort = (config && config.port) || currentProxyState.port || 10809;
          const proxyProto = (config && config.protocol) || (lastConfig && lastConfig.protocol) || currentProxyState.protocol || "http";
          const proxyServer = proxyHost ? proxyHost + ":" + proxyPort : "";
          pacText = injectUserRulesIntoPac(pacText, stored.pecUserRules, proxyServer, proxyProto);
          logEvent("info", "Injected " + stored.pecUserRules.length + " user routing overrides into PAC");
        }
      }
    } catch (injectErr) {
      console.warn("[PEC] Failed to inject user rules into PAC:", injectErr);
      logEvent("warn", "Failed to inject user rules into PAC: " + (injectErr && injectErr.message ? injectErr.message : injectErr));
    }
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
  console.log("[PEC] Applying PAC " + (useInline
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
      console.warn("[PEC] Inline PAC installation failed (" + (setErr && setErr.message ? setErr.message : setErr) + "), falling back to URL mode:", pacUrl);
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
  if (currentProxyState.proxyReachable === false) {
    updateBadge("ERR", "#ef4444");
  } else {
    updateBadge("P", "#0284c7");
  }
  await verifyAppliedProxySettings("pac_script");
}

// Apply proxy settings to browser network stack using explicit config or cached state
async function applyProxySettings(config) {
  const cfg = config || lastConfig || {
    protocol: currentProxyState.protocol,
    host: currentProxyState.host,
    port: currentProxyState.port,
    pacUrl: currentProxyState.pacUrl,
    enabled: currentProxyState.enabled !== false,
  };
  return await applyProxyConfig(cfg);
}

// Apply proxy settings to browser network stack
async function applyProxyConfig(config) {
  if (!chrome.proxy || !chrome.proxy.settings) return;

  if (config) {
    lastConfig = config;
  }
  const effectiveConfig = config || lastConfig || {
    protocol: currentProxyState.protocol,
    host: currentProxyState.host,
    port: currentProxyState.port,
    pacUrl: currentProxyState.pacUrl,
    enabled: currentProxyState.enabled !== false,
  };

  try {
    const isEnabled = (effectiveConfig.enabled !== false) && currentProxyState.enabled !== false;
    if (currentProxyState.bypassActive || effectiveConfig.killSwitch || !isEnabled || effectiveConfig.protocol === "direct") {
      console.log("[PEC] Routing set to DIRECT.");
      logEvent("info", "Proxy set to DIRECT (bypass=" + currentProxyState.bypassActive + ", enabled=" + isEnabled + ")");
      await chrome.proxy.settings.set({
        value: { mode: "direct" },
        scope: "regular",
      });
      updateBadge("D", "#f59e0b");
      await verifyAppliedProxySettings("direct");
      return;
    }

    const usePac = (effectiveConfig.protocol === "pac" || (effectiveConfig.pacUrl && effectiveConfig.routingMode !== "fixed"));
    if (usePac && effectiveConfig.pacUrl) {
      await applyPacScript(effectiveConfig.pacUrl, effectiveConfig);
      return;
    }

    // Fixed single proxy server (SOCKS5, HTTP, or HTTPS)
    const schemeMap = {
      http: "http",
      https: "https",
      socks5: "socks5",
    };
    const scheme = schemeMap[effectiveConfig.protocol] || "http";
    const bypassList = Array.isArray(effectiveConfig.bypassList) ? effectiveConfig.bypassList : ["<local>"];

    console.log("[PEC] Applying " + scheme.toUpperCase() + " Proxy: " + effectiveConfig.host + ":" + effectiveConfig.port);
    logEvent("info", "Applying " + scheme.toUpperCase() + " Proxy: " + effectiveConfig.host + ":" + effectiveConfig.port);
    await chrome.proxy.settings.set({
      value: {
        mode: "fixed_servers",
        rules: {
          singleProxy: {
            scheme: scheme,
            host: effectiveConfig.host,
            port: parseInt(effectiveConfig.port, 10),
          },
          bypassList: bypassList,
        },
      },
      scope: "regular",
    });
    if (currentProxyState.proxyReachable === false) {
      updateBadge("ERR", "#ef4444");
    } else {
      updateBadge(scheme === "socks5" ? "S" : "P", "#10b981");
    }
    await verifyAppliedProxySettings("fixed_servers");
  } catch (err) {
    console.error("[PEC] Error applying proxy settings:", err);
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
    console.warn("[PEC] onProxyError:", errDesc, fatal ? "(FATAL - request failed)" : "(recovered)");
    logEvent("error", "Proxy network/PAC error: " + errDesc + (fatal ? " (FATAL - request failed)" : " (recovered)"), details);
  });
}

// Re-enable proxy after the temporary bypass window elapsed
async function expireBypass() {
  console.log("[PEC] Bypass window elapsed - re-enabling proxy.");
  logEvent("info", "Temporary bypass window expired - re-enabling proxy");
  currentProxyState.bypassActive = false;
  currentProxyState.bypassExpiresAt = null;
  syncWithServer(true).catch(function (e) {
    console.warn("[PEC] Re-sync after bypass expiry failed:", e);
    logEvent("warn", "Re-sync after bypass expiry failed: " + (e && e.message ? e.message : e));
  });
}

// Synchronize with server (fetches creds & config)
async function syncWithServer(forceRefresh = false, applyConfig = true) {
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
            try {
              if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local && chrome.storage.local.set) {
                chrome.storage.local.set({ pecCredsCache: memoryCredsCache });
              }
            } catch (e) {}
            syncSuccessful = true;
          }

          if (payload.config) {
            lastConfig = payload.config;
            try {
              if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local && chrome.storage.local.set) {
                chrome.storage.local.set({ pecLastConfig: lastConfig });
              }
            } catch (e) {}
            const isPac = Boolean(payload.config.pacUrl && payload.config.routingMode !== "fixed") || payload.config.protocol === "pac";
            const proxyReachable = payload.proxyReachable !== false;
            currentProxyState = {
              ...currentProxyState,
              online: true,
              protocol: isPac ? "pac" : (payload.config.protocol || "http"),
              host: payload.config.host || "",
              port: payload.config.port || 10809,
              profileName: payload.profileName || "Default Profile",
              profileDefaultPolicy: payload.profileDefaultPolicy || "direct",
              proxyReachable: proxyReachable,
              pacUrl: payload.config.pacUrl || "",
              uiLayout: payload.uiLayout || (payload.config && payload.config.uiLayout) || "console",
              colorPalette: payload.colorPalette || (payload.config && payload.config.colorPalette) || "cyber",
              lastSync: Date.now(),
            };

            persistProxyState();
            logEvent("info", "Sync successful: profile=" + currentProxyState.profileName + ", mode=" + currentProxyState.protocol + ", host=" + (currentProxyState.host || "pac"));

            if (!proxyReachable) {
              logEvent("warn", "Configured proxy " + (currentProxyState.host || "") + ":" + currentProxyState.port + " is unreachable from server");
            }

            if (autoConfigureProxy && applyConfig) {
              await applyProxyConfig(payload.config);
            }
          }
        } else {
          const statusMsg = "HTTP " + res.status + (res.statusText ? " " + res.statusText : "");
          console.warn("[PEC] Sync endpoint /api/sync returned " + statusMsg + ". Falling back to /creds");
          logEvent("warn", "Sync endpoint /api/sync returned " + statusMsg + ". Falling back to /creds");
        }
      } catch (err) {
        console.warn("[PEC] Sync endpoint error, trying fallback /creds:", err);
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
          persistProxyState();
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
        try {
          if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local && chrome.storage.local.set) {
            chrome.storage.local.set({ pecCredsCache: memoryCredsCache });
          }
        } catch (e) {}
        currentProxyState.online = true;
        currentProxyState.lastSync = Date.now();
        persistProxyState();
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
      console.warn("[PEC] Max auth attempts exceeded for requestId=" + details.requestId);
      logEvent("warn", "Max auth attempts exceeded for requestId=" + details.requestId);
      seenRequests.delete(details.requestId);
      asyncCallback({});
      return;
    }

    const provideCreds = (user, pass, source) => {
      logEvent("info", "Supplied " + source + " proxy auth credentials for requestId=" + details.requestId);
      asyncCallback({ authCredentials: { username: user, password: pass } });
    };

    // Fast path 1: if credentials already in memory, supply immediately
    if (memoryCredsCache && memoryCredsCache.user && memoryCredsCache.pass) {
      provideCreds(memoryCredsCache.user, memoryCredsCache.pass, "cached");
      return;
    }

    // Fast path 2: check local storage directly before attempting slow network roundtrip
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local && chrome.storage.local.get) {
      chrome.storage.local.get(["pecCredsCache"], (stored) => {
        if (stored && stored.pecCredsCache && stored.pecCredsCache.user && stored.pecCredsCache.pass) {
          memoryCredsCache = stored.pecCredsCache;
          provideCreds(memoryCredsCache.user, memoryCredsCache.pass, "storage");
          return;
        }

        const forceRefresh = attempts > 1;
        // CRITICAL: applyConfig must be FALSE during onAuthRequired to avoid resetting the proxy mid-request!
        syncWithServer(forceRefresh, false)
          .then((creds) => {
            if (!creds || !creds.user || !creds.pass) {
              throw new Error("No valid credentials returned");
            }
            provideCreds(creds.user, creds.pass, "synced");
          })
          .catch((err) => {
            console.error("[PEC] onAuthRequired error:", err);
            logEvent("error", "onAuthRequired error: " + (err && err.message ? err.message : err));
            seenRequests.delete(details.requestId);
            asyncCallback({});
          });
      });
      return;
    }

    const forceRefresh = attempts > 1;
    // CRITICAL: applyConfig must be FALSE during onAuthRequired to avoid resetting the proxy mid-request!
    syncWithServer(forceRefresh, false)
      .then((creds) => {
        if (!creds || !creds.user || !creds.pass) {
          throw new Error("No valid credentials returned");
        }
        provideCreds(creds.user, creds.pass, "synced");
      })
      .catch((err) => {
        console.error("[PEC] onAuthRequired error:", err);
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
  if (!msg) return false;
  const action = msg.action || msg.type;
  if (action === "GET_STATUS") {
    sendResponse({ ...currentProxyState });
    return true;
  }
  if (action === "GET_USER_RULES") {
    (async () => {
      try {
        const stored = await chrome.storage.local.get(["pecUserRules"]);
        const rules = (stored && Array.isArray(stored.pecUserRules)) ? stored.pecUserRules : [];
        sendResponse({ userRules: rules });
      } catch (e) {
        sendResponse({ userRules: [] });
      }
    })();
    return true;
  }
  if (action === "SAVE_USER_RULES") {
    const rules = Array.isArray(msg.rules) ? msg.rules : [];
    (async () => {
      try {
        await chrome.storage.local.set({ pecUserRules: rules });
        logEvent("info", "Saved " + rules.length + " user routing overrides");
        await applyProxySettings();
        sendResponse({ ok: true, count: rules.length });
      } catch (err) {
        logEvent("error", "Failed to save user rules: " + (err && err.message ? err.message : err));
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true;
  }
  if (action === "SET_ENABLED") {
    const enabled = msg.enabled !== undefined ? Boolean(msg.enabled) : !currentProxyState.enabled;
    currentProxyState.enabled = enabled;
    persistProxyState();
    (async () => {
      try {
        await chrome.storage.local.set({ pecEnabled: enabled });
        logEvent("info", "Proxy power toggled: " + (enabled ? "ENABLED" : "DISABLED"));
        await applyProxySettings();
        sendResponse({ ok: true, enabled: enabled });
      } catch (err) {
        logEvent("error", "Failed to set proxy enabled: " + (err && err.message ? err.message : err));
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true;
  }
  if (action === "GET_LOGS") {
    sendResponse({ logs: [...recentLogs] });
    return true;
  }
  if (action === "CLEAR_LOGS") {
    recentLogs = [];
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local && chrome.storage.local.remove) {
        chrome.storage.local.remove(["pecLogs"]);
      }
    } catch (e) {}
    sendResponse({ ok: true, logs: [] });
    return true;
  }
  if (action === "FORCE_SYNC" || action === "SYNC_NOW") {
    syncWithServer(true)
      .then(() => {
        persistProxyState();
        sendResponse({ ok: true, ...currentProxyState });
      })
      .catch(() => {
        sendResponse({ ok: false, ...currentProxyState });
      });
    return true;
  }
  if (action === "TOGGLE_BYPASS" || action === "BYPASS_TOGGLE") {
    currentProxyState.bypassActive = !currentProxyState.bypassActive;
    if (currentProxyState.bypassActive) {
      // Schedule automatic re-enable - "temporary bypass" must actually be temporary.
      currentProxyState.bypassExpiresAt = Date.now() + BYPASS_TIMEOUT_MIN * 60 * 1000;
      chrome.alarms.create(ALARM_BYPASS_EXPIRE, { delayInMinutes: Math.max(0.5, BYPASS_TIMEOUT_MIN) });
      console.log("[PEC] Bypass enabled for " + BYPASS_TIMEOUT_MIN + " minutes.");
    } else {
      currentProxyState.bypassExpiresAt = null;
      chrome.alarms.clear(ALARM_BYPASS_EXPIRE);
    }
    logEvent("info", "Proxy bypass toggled: " + (currentProxyState.bypassActive ? "ON (expires in " + BYPASS_TIMEOUT_MIN + "m)" : "OFF"));
    persistProxyState();
    syncWithServer(true)
      .then(() => {
        persistProxyState();
        sendResponse({ ok: true, bypassActive: currentProxyState.bypassActive, ...currentProxyState });
      })
      .catch(() => {
        sendResponse({ ok: false, bypassActive: currentProxyState.bypassActive, ...currentProxyState });
      });
    return true;
  }
});

// Alarm handler: periodic sync + bypass expiry
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_SYNC) {
    syncWithServer(false).catch((e) => console.warn("[PEC] Periodic sync error:", e));
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
syncWithServer(false).catch((e) => console.warn("[PEC] Initial boot sync warning:", e));
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
  const serverBase = String(cfg.defaultServerUrl || "https://update.example.com").replace(/\/+$/, "");
  const syncInterval = Math.max(1, Math.round(Number(cfg.syncIntervalMinutes) || 5));
  const bypassTimeout = Math.max(1, Math.round(Number(cfg.bypassAutoTimeoutMinutes) || 15));
  const badgeEnabled = cfg.badgeIndicator === false ? "false" : "true";

  return BACKGROUND_TEMPLATE
    .replace(/"__PEC_SERVER_BASE__"/g, JSON.stringify(serverBase))
    .replace(/"__PEC_DEFAULT_TOKEN__"/g, JSON.stringify(String(cfg.defaultToken || "")))
    .replace(/\/\*\s*__PEC_SYNC_INTERVAL_MIN__\s*\*\/[^\n;]+/g, String(syncInterval))
    .replace(/\/\*\s*__PEC_BYPASS_TIMEOUT_MIN__\s*\*\/[^\n;]+/g, String(bypassTimeout))
    .replace(/\/\*\s*__PEC_BADGE_ENABLED__\s*\*\/[^\n;]+/g, String(badgeEnabled))
    .replace(/const SYNC_INTERVAL_MIN = [^;]+;/g, `const SYNC_INTERVAL_MIN = ${syncInterval};`)
    .replace(/const BYPASS_TIMEOUT_MIN = [^;]+;/g, `const BYPASS_TIMEOUT_MIN = ${bypassTimeout};`)
    .replace(/const BADGE_ENABLED = [^;]+;/g, `const BADGE_ENABLED = ${badgeEnabled};`)
    .replace(/"__PEC_TARGET_GROUP__"/g, JSON.stringify(String(cfg.targetGroup || "Default Fleet")));
}

export function getPopupTranslations(cfg?: Partial<ExtensionBuildConfig>) {
  const safeCfg = cfg || {};
  const isRu = (safeCfg.locale || "ru") === "ru";
  return {
    isRu,
    title: safeCfg.name || "PEC Corp",
    active: isRu ? "Активен" : "Active",
    bypassed: isRu ? "Обход активен" : "Bypass Active",
    offline: isRu ? "Отключен" : "Offline",
    tabConn: isRu ? "Главная" : "Main",
    tabRules: isRu ? "Роутинг" : "Routing",
    tabDiag: isRu ? "Инфо" : "Info",
    tabHelp: isRu ? "Поддержка" : "Support",
    connGateway: isRu ? "Подключение к прокси" : "Proxy Connection",
    proxyMode: isRu ? "Режим прокси" : "Proxy Mode",
    activeEndpoint: isRu ? "Прокси-сервер" : "Active Endpoint",
    routingProfile: isRu ? "Профиль правил" : "Routing Profile",
    latency: isRu ? "Задержка (Пинг)" : "Latency (Ping)",
    btnSync: isRu ? "Синхронизировать сейчас" : "Sync with Server Now",
    btnSyncShort: isRu ? "Синхронизация" : "Sync",
    btnPower: isRu ? "Включить / Выключить прокси" : "Enable / Disable Proxy",
    btnPause: isRu ? "Приостановить прокси на 15 минут" : "Pause Proxy for 15 min",
    toggleTheme: isRu ? "Переключить тему (День / Ночь)" : "Toggle theme (Day / Night)",
    btnBypass: isRu ? `Временно отключить (${cfg?.bypassAutoTimeoutMinutes || 15}м)` : `Bypass Proxy Temporarily (${cfg?.bypassAutoTimeoutMinutes || 15}m)`,
    btnResume: isRu ? "Включить прокси" : "Resume Proxy Now",
    corpRules: isRu ? "Корпоративные правила" : "Corporate Rules",
    userOverrides: isRu ? "Мои исключения" : "My Overrides",
    fromServer: isRu ? "От сервера" : "From Server",
    localBadge: isRu ? "Локально" : "Local",
    addCurrentSite: isRu ? "+ Добавить текущий сайт" : "+ Add Current Site",
    addRule: isRu ? "+ Добавить" : "+ Add",
    patternPlaceholder: isRu ? "*.example.com или домен" : "*.example.com or domain",
    throughProxy: isRu ? "PROXY (через прокси)" : "PROXY (via proxy)",
    directConn: isRu ? "DIRECT (напрямую)" : "DIRECT (direct)",
    emptyUserRules: isRu ? "Нет пользовательских правил" : "No custom rules",
    connParams: isRu ? "Параметры соединения" : "Connection Details",
    testBtn: isRu ? "Тест" : "Test",
    checkBtn: isRu ? "Проверить" : "Verify",
    bypassRestricted: isRu ? "Прямой обход ограничен политикой безопасности предприятия." : "Direct bypass is restricted by IT enterprise policy.",
    defaultFallback: isRu ? "По умолчанию" : "Default Fallback",
    aiModels: isRu ? "Модели AI и LLM" : "AI & LLM Models",
    corpIntranet: isRu ? "Корпоративная сеть RFC1918" : "Corporate RFC1918",
    adsTelemetry: isRu ? "Реклама и телеметрия" : "Ads & Telemetry",
    socialMedia: isRu ? "Медиа и соцсети" : "Global Social / Media",
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
    rulesNotice: isRu ? "Правила маршрутизации и обхода определяются активным PAC-профилем с сервера PEC. Ваши локальные исключения ниже имеют приоритет." : "Rules are centrally managed via PAC profile from the PEC server. Your local overrides below take precedence.",
    connError: isRu ? "Ошибка связи" : "Connection Error",
    serverUnreachable: isRu ? "Сервер PEC недоступен" : "PEC Server Unreachable",
    eventLog: isRu ? "Журнал событий" : "Event Log",
    zeroEntries: isRu ? "0 записей" : "0 entries",
    emptyLog: isRu ? "Журнал пуст" : "No log entries",
    entriesSuffix: isRu ? " записей" : " entries",
    copyLogs: isRu ? "Скопировать логи" : "Copy logs",
    clearLogs: isRu ? "Очистить" : "Clear",
    copied: isRu ? "Скопировано!" : "Copied!",
    pacSelective: isRu ? "PAC (селективный)" : "PAC (selective)",
    pacTunnel: isRu ? "PAC (туннель)" : "PAC (tunnel)",
    pacSelectiveHint: isRu ? "Проксируются только домены из правил; остальной трафик — напрямую" : "Only rule domains are proxied; other traffic goes direct",
    pacTunnelHint: isRu ? "Весь трафик через прокси, кроме исключений" : "All traffic proxied except exceptions",
    bypassMode: isRu ? "Обход (Bypass)" : "Direct (Bypass)",
    bypassHint: isRu ? "Прокси временно отключен пользователем" : "Proxy is temporarily bypassed by user",
    fixedProxyHint: isRu ? "Весь трафик направляется через фиксированный прокси-сервер" : "All traffic routed through fixed proxy server",
  };
}

export function renderPopupHtml(cfg?: ExtensionBuildConfig, colors?: Record<string, string>): string {
  const safeCfg = cfg || ({} as ExtensionBuildConfig);
  const t = getPopupTranslations(safeCfg);
  const palette = (safeCfg as any).colorPalette || "cyber";
  const layout = (safeCfg as any).uiLayout || "console";
  const themeMode = (safeCfg as any).defaultThemeMode || "dark";
  const effectiveColors = {
    primary: safeCfg.themeColor || "#38bdf8",
    bg: safeCfg.themeBackground || "#0b1120",
    card: safeCfg.themeCard || "#131d36",
    border: "#334155",
    text: "#f8fafc",
    ...colors,
  };

  return `<!DOCTYPE html>
<html lang="${safeCfg.locale || "ru"}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeCfg.name || "PEC Corp Proxy"}</title>
  <style>
    :root, [data-theme="dark"] {
      --primary: ${effectiveColors.primary};
      --bg: ${effectiveColors.bg};
      --card: ${effectiveColors.card};
      --card-inner: #1e293b;
      --border: ${effectiveColors.border};
      --text: ${effectiveColors.text};
      --text-muted: #94a3b8;
      --primary-rgb: 56, 189, 248;
      --success: #10b981;
      --danger: #ef4444;
      --warning: #f59e0b;
      --border-color: var(--border);
      --text-main: var(--text);
      --bg-hover: rgba(255, 255, 255, 0.08);
      --accent-color: var(--primary);
    }
    [data-theme="light"] {
      --bg: #f8fafc;
      --card: #ffffff;
      --card-inner: #f1f5f9;
      --border: #cbd5e1;
      --text: #0f172a;
      --text-muted: #64748b;
      --primary: #2563eb;
      --border-color: var(--border);
      --text-main: var(--text);
      --bg-hover: rgba(0, 0, 0, 0.06);
      --accent-color: var(--primary);
    }

    /* 5 Color Palettes */
    [data-palette="cyber"] { --primary: #38bdf8; --primary-rgb: 56, 189, 248; }
    [data-palette="obsidian"] { --primary: #c084fc; --primary-rgb: 192, 132, 252; }
    [data-palette="obsidian"]:not([data-theme="light"]), [data-palette="obsidian"][data-theme="dark"] {
      --bg: #09090b; --card: #18181b; --card-inner: #27272a; --border: #3f3f46;
    }
    [data-palette="obsidian"][data-theme="light"] {
      --bg: #faf5ff; --card: #ffffff; --card-inner: #f3e8ff; --border: #e9d5ff;
    }
    [data-palette="nord"] { --primary: #88c0d0; --primary-rgb: 136, 192, 208; }
    [data-palette="nord"]:not([data-theme="light"]), [data-palette="nord"][data-theme="dark"] {
      --bg: #242933; --card: #2e3440; --card-inner: #3b4252; --border: #4c566a;
    }
    [data-palette="nord"][data-theme="light"] {
      --bg: #eceff4; --card: #ffffff; --card-inner: #e5e9f0; --border: #d8dee9;
    }
    [data-palette="emerald"] { --primary: #34d399; --primary-rgb: 52, 211, 153; }
    [data-palette="emerald"]:not([data-theme="light"]), [data-palette="emerald"][data-theme="dark"] {
      --bg: #061e14; --card: #0d3322; --card-inner: #134e35; --border: #1a6344;
    }
    [data-palette="emerald"][data-theme="light"] {
      --bg: #f0fdf4; --card: #ffffff; --card-inner: #dcfce7; --border: #bbf7d0;
    }
    [data-palette="light"] { --primary: #2563eb; --primary-rgb: 37, 99, 235; }
    [data-palette="light"]:not([data-theme="light"]), [data-palette="light"][data-theme="dark"] {
      --bg: #0f172a; --card: #1e293b; --card-inner: #334155; --border: #475569;
    }
    [data-palette="light"][data-theme="light"] {
      --bg: #f8fafc; --card: #ffffff; --card-inner: #f1f5f9; --border: #cbd5e1;
    }

    /* Layout Terminal & Console: 0px razor-sharp retro-terminal corners matching dashboard */
    [data-layout="terminal"],
    [data-layout="terminal"] *,
    [data-layout="terminal"] *::before,
    [data-layout="terminal"] *::after,
    [data-layout="console"],
    [data-layout="console"] *,
    [data-layout="console"] *::before,
    [data-layout="console"] *::after {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
      border-radius: 0 !important;
    }
    [data-layout="terminal"] .card,
    [data-layout="console"] .card {
      border-radius: 0 !important;
      border-color: var(--primary) !important;
      box-shadow: 0 0 10px rgba(var(--primary-rgb), 0.2);
    }
    [data-layout="terminal"] .btn-sec,
    [data-layout="terminal"] .btn-sm,
    [data-layout="terminal"] .form-input,
    [data-layout="terminal"] .form-select,
    [data-layout="terminal"] .btn-primary-sm,
    [data-layout="terminal"] .btn-quick-add,
    [data-layout="terminal"] .tab-btn,
    [data-layout="terminal"] .badge,
    [data-layout="terminal"] .tag,
    [data-layout="terminal"] .switch,
    [data-layout="terminal"] .slider,
    [data-layout="terminal"] .status-dot,
    [data-layout="terminal"] .btn-icon,
    [data-layout="console"] .btn-sec,
    [data-layout="console"] .btn-sm,
    [data-layout="console"] .form-input,
    [data-layout="console"] .form-select,
    [data-layout="console"] .btn-primary-sm,
    [data-layout="console"] .btn-quick-add,
    [data-layout="console"] .tab-btn,
    [data-layout="console"] .badge,
    [data-layout="console"] .tag,
    [data-layout="console"] .switch,
    [data-layout="console"] .slider,
    [data-layout="console"] .status-dot,
    [data-layout="console"] .btn-icon {
      border-radius: 0 !important;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 380px;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 14px;
      font-size: 13px;
      line-height: 1.4;
      user-select: none;
      transition: background 0.2s, color 0.2s;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--border);
      padding-bottom: 10px;
      margin-bottom: 12px;
      gap: 8px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      font-size: 14px;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .brand-icon {
      width: 24px;
      height: 24px;
      border-radius: 6px;
      background: var(--primary);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #0b1120;
      flex-shrink: 0;
    }
    .version-tag {
      font-size: 10px;
      font-weight: 600;
      color: var(--text-muted);
      background: var(--card-inner);
      padding: 1px 5px;
      border-radius: 4px;
      border: 1px solid var(--border);
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }
    .btn-theme-toggle {
      background: var(--card-inner);
      border: 1px solid var(--border);
      color: var(--text);
      width: 26px;
      height: 26px;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 13px;
      transition: all 0.15s;
    }
    .btn-theme-toggle:hover {
      background: var(--border);
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      background: rgba(16, 185, 129, 0.15);
      color: var(--success);
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .status-badge .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--success);
    }
    .status-badge.offline {
      background: rgba(239, 68, 68, 0.15);
      color: var(--danger);
      border-color: rgba(239, 68, 68, 0.3);
    }
    .status-badge.offline .dot { background: var(--danger); }
    .status-badge.bypass {
      background: rgba(245, 158, 11, 0.15);
      color: var(--warning);
      border-color: rgba(245, 158, 11, 0.3);
    }
    .status-badge.bypass .dot { background: var(--warning); }

    /* Tabs */
    .tabs {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
      margin-bottom: 12px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 6px;
    }
    .tab-btn {
      flex: 1;
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-muted);
      font-size: 11px;
      font-weight: 600;
      padding: 7px 4px;
      border-radius: 6px;
      cursor: pointer;
      text-align: center;
      transition: all 0.15s;
      white-space: nowrap;
    }
    .tab-btn:hover {
      color: var(--text);
      background: var(--card-inner);
    }
    .tab-btn.active {
      background: var(--card);
      color: var(--primary);
      border-color: var(--border);
    }

    .tab-content { display: none; }
    .tab-content.active { display: block; }

    /* Cards */
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px 14px;
      margin-bottom: 10px;
    }
    .tab-content > .card:last-child {
      margin-bottom: 0;
    }
    .card-header-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .btn-icon-minimal {
      width: 30px;
      height: 30px;
      padding: 0;
      border-radius: 6px;
      border: 1px solid var(--border-color);
      background: transparent;
      color: var(--text-main);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      transition: all 0.2s ease;
    }
    .btn-icon-minimal:hover {
      background: var(--bg-hover, rgba(255, 255, 255, 0.08));
      border-color: var(--accent-color);
    }
    .btn-icon-minimal:active,
    .btn-theme-toggle:active,
    .btn-sm:active,
    .btn-sec:active,
    .btn-primary-sm:active,
    .btn-action:active,
    .tab-btn:active {
      transform: translateY(1px) scale(0.95) !important;
      filter: brightness(0.85) contrast(1.15) !important;
      box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.4) !important;
    }

    /* Inline PNG icon pack */
    .icon-inline {
      width: 14px;
      height: 14px;
      vertical-align: -2px;
      display: inline-block;
      object-fit: contain;
      flex-shrink: 0;
      pointer-events: none;
    }
    .icon-inline-lg {
      width: 18px;
      height: 18px;
      vertical-align: -4px;
      display: inline-block;
      object-fit: contain;
      flex-shrink: 0;
      pointer-events: none;
    }
    .icon-inline-sm {
      width: 12px;
      height: 12px;
      vertical-align: -1px;
      display: inline-block;
      object-fit: contain;
      flex-shrink: 0;
      pointer-events: none;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .card-title {
      font-weight: 700;
      font-size: 12px;
      color: var(--text);
    }
    .tag {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--card-inner);
      color: var(--text-muted);
      border: 1px solid var(--border);
    }
    .tag.corp-tag {
      color: var(--primary);
      border-color: rgba(56, 189, 248, 0.3);
      background: rgba(56, 189, 248, 0.1);
    }
    .tag.user-tag {
      color: var(--warning);
      border-color: rgba(245, 158, 11, 0.3);
      background: rgba(245, 158, 11, 0.1);
    }

    /* Hero Card in Conn Tab */
    .hero-card {
      text-align: center;
      padding: 14px 12px;
    }
    .hero-header {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      margin-bottom: 10px;
    }
    .status-orb {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: rgba(239, 68, 68, 0.2);
      border: 2px solid var(--danger);
      box-shadow: 0 0 12px rgba(239, 68, 68, 0.4);
      transition: all 0.3s;
    }
    .status-orb.active {
      background: rgba(16, 185, 129, 0.2);
      border-color: var(--success);
      box-shadow: 0 0 12px rgba(16, 185, 129, 0.4);
    }
    .status-orb.bypass {
      background: rgba(245, 158, 11, 0.2);
      border-color: var(--warning);
      box-shadow: 0 0 12px rgba(245, 158, 11, 0.4);
    }
    .hero-status-title {
      font-weight: 700;
      font-size: 14px;
      color: var(--text);
    }
    .hero-meta {
      background: var(--card-inner);
      border-radius: 8px;
      padding: 8px 10px;
      border: 1px solid var(--border);
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 3px 0;
      font-size: 11px;
    }
    .meta-label { color: var(--text-muted); }
    .meta-val {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-weight: 600;
      color: var(--text);
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* 3 Action Buttons */
    .action-bar {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-bottom: 10px;
    }
    .btn-action {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 4px;
      color: var(--text);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      font-weight: 600;
      transition: all 0.15s;
    }
    .btn-action:hover {
      background: var(--card-inner);
      border-color: var(--primary);
    }
    .btn-action:active {
      transform: scale(0.98);
    }
    .action-icon {
      color: var(--primary);
    }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    button.btn-icon-minimal.spin, button.spin { animation: none !important; }
    .sync-icon { display: inline-block; line-height: 1; transform-origin: center center; }
    .sync-icon.spin, span.spin { display: inline-block; animation: spin 0.8s linear infinite; transform-origin: center center; }
    .action-label {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
    }

    /* Rows */
    .row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 0;
      font-size: 12px;
    }
    .label { color: var(--text-muted); font-size: 11px; }
    .val {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-weight: 600;
      font-size: 12px;
    }
    .val.success-val { color: var(--success); }
    .row-action {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    /* Form and Inputs in Routing */
    .rules-notice {
      font-size: 11px;
      color: var(--text-muted);
      line-height: 1.4;
    }
    .btn-quick-add {
      width: 100%;
      background: var(--card-inner);
      border: 1px dashed var(--border);
      border-radius: 6px;
      color: var(--primary);
      padding: 6px 10px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      text-align: center;
      margin-bottom: 8px;
      transition: all 0.15s;
    }
    .btn-quick-add:hover {
      border-color: var(--primary);
      background: rgba(56, 189, 248, 0.05);
    }
    .rule-form {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 8px;
    }
    .form-input {
      width: 100%;
      background: var(--card-inner);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 8px;
      color: var(--text);
      font-size: 11px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      outline: none;
    }
    .form-input:focus {
      border-color: var(--primary);
    }
    .rule-form-row {
      display: flex;
      gap: 6px;
    }
    .form-select {
      flex: 1;
      background: var(--card-inner);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 8px;
      color: var(--text);
      font-size: 11px;
      outline: none;
    }
    .btn-primary-sm {
      background: var(--primary);
      color: #0b1120;
      border: none;
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      transition: opacity 0.15s;
      white-space: nowrap;
    }
    .btn-primary-sm:hover { opacity: 0.9; }

    .user-rules-list {
      max-height: 140px;
      overflow-y: auto;
      border-top: 1px solid var(--border);
      padding-top: 6px;
      margin-top: 4px;
    }
    .empty-rules {
      font-size: 11px;
      color: var(--text-muted);
      text-align: center;
      padding: 10px 0;
    }
    .user-rule-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 0;
      font-size: 11px;
      border-bottom: 1px dashed var(--border);
    }
    .user-rule-item:last-child { border-bottom: none; }
    .rule-pattern {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .rule-meta {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .rule-badge {
      font-size: 9px;
      font-weight: 700;
      padding: 1px 4px;
      border-radius: 3px;
    }
    .rule-badge.proxy {
      background: rgba(16, 185, 129, 0.15);
      color: var(--success);
    }
    .rule-badge.direct {
      background: rgba(245, 158, 11, 0.15);
      color: var(--warning);
    }
    .rule-del-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 3px;
    }
    .rule-del-btn:hover {
      color: var(--danger);
    }

    /* Diagnostics & Terminal */
    .btn-sm {
      background: var(--card-inner);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 3px 8px;
      border-radius: 5px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
    }
    .btn-sm:hover {
      background: var(--border);
    }
    .log-terminal {
      background: #050914;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 10px;
      color: #94a3b8;
      height: 120px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
      margin: 4px 0 8px 0;
    }
    [data-theme="light"] .log-terminal {
      background: #0f172a;
      color: #cbd5e1;
    }
    .log-actions {
      display: flex;
      gap: 6px;
    }
    .btn-sec {
      flex: 1;
      background: var(--card-inner);
      border: 1px solid var(--border);
      color: var(--text);
      font-weight: 500;
      padding: 5px 8px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 11px;
      text-align: center;
      transition: background 0.15s;
    }
    .btn-sec:hover { background: var(--border); }
  </style>
</head>
<body data-palette="${palette}" data-layout="${layout}" data-theme="${themeMode}">
  <header>
    <div class="brand">
      <div class="brand-icon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      </div>
      <span>${safeCfg.shortName || safeCfg.name || "PEC"}</span>
      <span class="version-tag">v${safeCfg.version || "1.4.0"}</span>
    </div>
    <div class="header-actions">
      <button id="btnThemeToggle" class="btn-theme-toggle" title="${t.toggleTheme || "Переключить тему (День / Ночь)"}" aria-label="Toggle theme"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg></button>
      <div class="status-badge offline" id="statusPill">
        <span class="dot"></span>
        <span id="statusText">${t.offline}</span>
      </div>
    </div>
  </header>

  <!-- Navigation Tabs -->
  <div class="tabs">
    <button class="tab-btn active" data-tab="tab-status" id="tabBtnStatus">${t.tabConn || "Главная"}</button>
    <button class="tab-btn" data-tab="tab-routing" id="tabBtnRouting">${t.tabRules || "Роутинг"}</button>
    <button class="tab-btn" data-tab="tab-info" id="tabBtnInfo">${t.tabDiag || "Инфо"}</button>
  </div>

  <!-- TAB 1: Main (Главная) -->
  <div class="tab-content active" id="tab-status">
    <div class="card" id="cardConnection">
      <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
        <span class="card-title"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px; margin-right: 5px;"><path d="M9 2v6M15 2v6M6 8h12a2 2 0 0 1 2 2v2a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6v-2a2 2 0 0 1 2-2zM12 18v4"/></svg> ${t.connGateway || "Подключение к прокси"}</span>
        <div class="card-header-actions">
          <button class="btn-icon-minimal" id="btnSyncNow" title="${t.btnSync || "Синхронизировать сейчас"}"><span class="sync-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg></span></button>
          <button class="btn-icon-minimal" id="btnPowerToggle" title="${t.btnPower || "Включить / Выключить прокси"}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10"/></svg></button>
          <button class="btn-icon-minimal" id="btnPauseToggle" title="${t.btnPause || "Приостановить прокси на 15 минут"}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg></button>
        </div>
      </div>
      <div class="hero-meta">
        <div class="meta-row">
          <span class="meta-label">${t.routingProfile}</span>
          <span class="meta-val" id="profileVal">—</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">${t.activeEndpoint}</span>
          <span class="meta-val" id="serverVal">—</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">${t.proxyMode}</span>
          <span class="meta-val" id="modeVal">—</span>
        </div>
      </div>
    </div>
  </div>

  <!-- TAB 2: Routing -->
  <div class="tab-content" id="tab-routing">
    <div class="card">
      <div class="card-header">
        <span class="card-title">${t.corpRules || "Корпоративные правила"}</span>
        <span class="tag corp-tag">${t.fromServer || "От сервера"}</span>
      </div>
      <div class="row" style="margin-top: 6px;">
        <span class="label">${t.defaultFallback}</span>
        <span class="tag" id="tabRulesDefaultPolicy">DIRECT</span>
      </div>
      <div class="rules-notice" style="margin-top: 8px;">
        ${t.rulesNotice}
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="card-title">${t.userOverrides || "Мои исключения"}</span>
        <span class="tag user-tag">${t.localBadge || "Локально"}</span>
      </div>
      <button id="btnAddCurrentSite" class="btn-quick-add" style="display: none;">
        ${t.addCurrentSite || "+ Добавить текущий сайт"}
      </button>
      <div class="rule-form">
        <input type="text" id="inputPattern" placeholder="${t.patternPlaceholder || "*.example.com или домен"}" class="form-input" autocomplete="off" spellcheck="false">
        <div class="rule-form-row">
          <select id="selectAction" class="form-select">
            <option value="PROXY">${t.throughProxy || "PROXY (через прокси)"}</option>
            <option value="DIRECT">${t.directConn || "DIRECT (напрямую)"}</option>
          </select>
          <button id="btnAddRule" class="btn-primary-sm">${t.addRule || "+ Добавить"}</button>
        </div>
      </div>
      <div id="userRulesList" class="user-rules-list">
        <div class="empty-rules">${t.emptyUserRules || "Нет пользовательских правил"}</div>
      </div>
    </div>
  </div>

  <!-- TAB 3: Diagnostics & Info -->
  <div class="tab-content" id="tab-info">
    <div class="card">
      <div class="card-header">
        <span class="card-title">${t.connParams || "Параметры соединения"}</span>
      </div>
      <div class="row">
        <span class="label">${t.webrtcShield}</span>
        <span class="val success-val" id="webrtcVal">${safeCfg.webRtcProtection !== false ? t.webrtcStatus : "Disabled"}</span>
      </div>
      <div class="row">
        <span class="label">${t.dnsGuard}</span>
        <span class="val success-val" id="dnsVal">${safeCfg.dnsLeakProtection !== false ? t.dnsStatus : "Off"}</span>
      </div>
      <div class="row">
        <span class="label">${t.latency}</span>
        <div class="row-action">
          <span class="val" id="pingVal">—</span>
          <button id="btnTestLatency" class="btn-sm">${t.testBtn || "Тест"}</button>
        </div>
      </div>
      <div class="row">
        <span class="label">${t.exitIp}</span>
        <div class="row-action">
          <span class="val" id="exitIpVal">—</span>
          <button id="btnCheckIp" class="btn-sm">${t.checkBtn || "Проверить"}</button>
        </div>
      </div>
      <div class="row" style="margin-top: 4px; padding-top: 6px; border-top: 1px dashed var(--border);">
        <span class="label">${t.helpdesk}</span>
        <span class="val" style="font-size: 11px;"><a href="${safeCfg.supportUrl || "mailto:it-support@corp.local"}" target="_blank" style="color: var(--primary); text-decoration: none;">${(safeCfg.supportUrl || "it-support@corp.local").replace(/^mailto:/i, "")}</a></span>
      </div>
    </div>

    <div class="card">
      <div class="row" style="margin-bottom: 6px;">
        <span class="label" style="font-weight: 600;">${t.eventLog}</span>
        <span class="tag" id="logCountTag" style="font-size: 10px;">${t.zeroEntries}</span>
      </div>
      <pre id="logContainer" class="log-terminal"></pre>
      <div class="log-actions">
        <button id="btnCopyLogs" class="btn-sec"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -1px; margin-right: 4px;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> ${t.copyLogs}</button>
        <button id="btnClearLogs" class="btn-sec"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -1px; margin-right: 4px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> ${t.clearLogs}</button>
      </div>
    </div>
  </div>

  <script src="popup.js"></script>
</body>
</html>`;
}

export function renderPopupJs(cfg?: ExtensionBuildConfig): string {
  const safeCfg = cfg || ({} as ExtensionBuildConfig);
  const t = getPopupTranslations(safeCfg);
  return `// Global tab switching helper
window.switchPopupTab = function(tabId) {
  if (!tabId) return;
  const tabs = document.querySelectorAll(".tab-btn");
  tabs.forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));

  let targetContentId = tabId;
  if (tabId === "tabBtnStatus" || tabId === "tab-status" || tabId === "status" || tabId === "tab-btn-conn" || tabId === "tab-content-conn" || tabId === "conn") {
    targetContentId = (typeof document !== "undefined" && document.getElementById && document.getElementById("tab-status")) ? "tab-status" : "tab-content-conn";
  } else if (tabId === "tabBtnRouting" || tabId === "tab-routing" || tabId === "routing" || tabId === "tab-btn-routing" || tabId === "tab-content-routing") {
    targetContentId = (typeof document !== "undefined" && document.getElementById && document.getElementById("tab-routing")) ? "tab-routing" : "tab-content-routing";
  } else if (tabId === "tabBtnInfo" || tabId === "tab-info" || tabId === "info" || tabId === "tab-btn-diag" || tabId === "tab-content-diag" || tabId === "diag" || tabId === "tab-diag") {
    targetContentId = (typeof document !== "undefined" && document.getElementById && document.getElementById("tab-info")) ? "tab-info" : ((typeof document !== "undefined" && document.getElementById && document.getElementById("tab-content-diag")) ? "tab-content-diag" : "tab-content-info");
  } else if (!targetContentId.startsWith("tab-content-") && (typeof document !== "undefined" && document.getElementById && !document.getElementById(targetContentId))) {
    targetContentId = "tab-content-" + tabId.replace(/^tab-btn-/, "").replace(/^tab-/, "");
  }

  const activeBtn = document.querySelector('.tab-btn[data-tab="' + tabId + '"]') ||
                    document.querySelector('.tab-btn[data-tab="' + targetContentId + '"]') ||
                    document.getElementById(tabId) ||
                    document.getElementById("tab-btn-" + tabId.replace(/^tab-content-/, "").replace(/^tab-/, ""));
  if (activeBtn) activeBtn.classList.add("active");
  const target = document.getElementById(targetContentId) || document.getElementById(tabId);
  if (target) target.classList.add("active");

  if ((targetContentId === "tab-content-diag" || targetContentId === "tab-info" || tabId === "diag" || tabId === "tab-diag" || tabId === "info" || tabId === "tab-info") && typeof window.__pecLoadLogs === "function") {
    window.__pecLoadLogs();
  }
};

let currentProxyState = { enabled: true, online: false, bypassActive: false };
let bypassCountdownTimer = null;

function updateBypassCountdown(expiresAt) {
  const btnPauseToggle = document.getElementById("btnPauseToggle");
  const btnPauseLabel = document.getElementById("btnPauseLabel");
  if (!btnPauseToggle && !btnPauseLabel) return;
  if (!expiresAt || expiresAt <= Date.now()) {
    if (btnPauseToggle) btnPauseToggle.title = "${t.btnPause}";
    if (btnPauseLabel) btnPauseLabel.textContent = "${t.btnPause}";
    if (bypassCountdownTimer && typeof clearInterval !== "undefined") {
      clearInterval(bypassCountdownTimer);
      bypassCountdownTimer = null;
    }
    return;
  }
  const remainingSec = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
  const m = Math.floor(remainingSec / 60);
  const s = remainingSec % 60;
  const timeStr = "${t.isRu ? "Пауза" : "Pause"} (" + m + ":" + (s < 10 ? "0" : "") + s + ")";
  if (btnPauseToggle) btnPauseToggle.title = timeStr;
  if (btnPauseLabel) btnPauseLabel.textContent = timeStr;
}

// Global state applier - reactive to simulator and chrome.runtime
window.applyPopupState = function(response) {
  if (!response) return;
  currentProxyState = Object.assign({}, currentProxyState, response);

  const statusText = document.getElementById("statusText");
  const heroStatusText = document.getElementById("heroStatusText");
  const badge = document.getElementById("badge") || document.getElementById("statusPill");
  const statusOrb = document.getElementById("statusOrb");
  const modeVal = document.getElementById("modeVal");
  const serverVal = document.getElementById("serverVal");
  const profileVal = document.getElementById("profileVal");
  const pingVal = document.getElementById("pingVal");
  const exitIpVal = document.getElementById("exitIpVal");
  const tabRulesDefaultPolicy = document.getElementById("tabRulesDefaultPolicy");
  const btnToggle = document.getElementById("btnToggleBypass");
  const btnPowerLabel = document.getElementById("btnPowerLabel");
  const btnPauseLabel = document.getElementById("btnPauseLabel");
  const btnPowerToggle = document.getElementById("btnPowerToggle");
  const btnPauseToggle = document.getElementById("btnPauseToggle");

  const isBypass = Boolean(response.bypassActive);
  const isOnline = Boolean(response.online);
  const isEnabled = response.enabled !== false;

  let stateStr = "${t.offline}";
  let badgeCls = "status-badge offline";
  let orbCls = "status-orb";

  if (isBypass) {
    stateStr = "${t.bypassed}";
    badgeCls = "status-badge bypass";
    orbCls = "status-orb bypass";
  } else if (!isEnabled || !isOnline) {
    stateStr = "${t.offline}";
    badgeCls = "status-badge offline";
    orbCls = "status-orb";
  } else {
    stateStr = "${t.active}";
    badgeCls = "status-badge";
    orbCls = "status-orb active";
  }

  if (statusText) statusText.textContent = stateStr;
  if (heroStatusText) heroStatusText.textContent = stateStr;
  if (badge) badge.className = badgeCls;
  if (statusOrb) statusOrb.className = orbCls;

  if (btnPowerLabel) {
    btnPowerLabel.textContent = isEnabled ? "${t.isRu ? "Отключить" : "Disable"}" : "${t.isRu ? "Включить" : "Enable"}";
  }
  if (btnPowerToggle) {
    btnPowerToggle.style.opacity = isEnabled ? "1" : "0.7";
  }

  if (bypassCountdownTimer && typeof clearInterval !== "undefined") {
    clearInterval(bypassCountdownTimer);
    bypassCountdownTimer = null;
  }
  if (btnPauseToggle || btnPauseLabel) {
    if (isBypass) {
      if (response.bypassExpiresAt) {
        updateBypassCountdown(response.bypassExpiresAt);
        if (typeof setInterval !== "undefined") {
          bypassCountdownTimer = setInterval(() => {
            if (response.bypassExpiresAt && response.bypassExpiresAt > Date.now()) {
              updateBypassCountdown(response.bypassExpiresAt);
            } else {
              if (typeof clearInterval !== "undefined") clearInterval(bypassCountdownTimer);
              bypassCountdownTimer = null;
              if (btnPauseToggle) btnPauseToggle.title = "${t.btnPause}";
              if (btnPauseLabel) btnPauseLabel.textContent = "${t.btnPause}";
            }
          }, 1000);
        }
      } else {
        if (btnPauseToggle) btnPauseToggle.title = "${t.btnResume}";
        if (btnPauseLabel) btnPauseLabel.textContent = "${t.btnResume}";
      }
    } else {
      if (btnPauseToggle) btnPauseToggle.title = "${t.btnPause}";
      if (btnPauseLabel) btnPauseLabel.textContent = "${t.btnPause}";
    }
  }

  if (modeVal) {
    if (isBypass) {
      modeVal.textContent = "${t.bypassMode}";
      modeVal.title = "${t.bypassHint}";
    } else if (response.protocol === "pac") {
      const isTunnel = response.profileDefaultPolicy === "proxy";
      modeVal.textContent = isTunnel ? "${t.pacTunnel}" : "${t.pacSelective}";
      modeVal.title = isTunnel ? "${t.pacTunnelHint}" : "${t.pacSelectiveHint}";
    } else if (response.protocol) {
      modeVal.textContent = "Fixed (" + response.protocol.toUpperCase() + ")";
      modeVal.title = "${t.fixedProxyHint}";
    } else {
      modeVal.textContent = "—";
      modeVal.title = "";
    }
  }

  if (tabRulesDefaultPolicy && response.profileDefaultPolicy) {
    const isTunnel = response.profileDefaultPolicy === "proxy";
    tabRulesDefaultPolicy.textContent = isTunnel ? "PROXY (туннель)" : "DIRECT (селективный)";
  }

  if (serverVal) {
    serverVal.textContent = (isOnline && response.host) ? (response.host + ":" + response.port) : (isOnline ? "Direct" : "${t.offline}");
  }
  if (profileVal) profileVal.textContent = response.profileName || "Selective PAC";
  if (pingVal && response.ping) pingVal.textContent = response.ping;
  if (exitIpVal && response.exitIp) exitIpVal.textContent = response.exitIp;
  if (response.uiLayout && document.body) {
    document.body.setAttribute("data-layout", response.uiLayout);
  }
  if (response.colorPalette && document.body) {
    document.body.setAttribute("data-palette", response.colorPalette);
  }
  if (response.serverBase) window.__pecServerBase = response.serverBase;

  if (btnToggle) {
    btnToggle.textContent = isBypass ? "${t.btnResume}" : "${t.btnBypass}";
  }
};

window.addEventListener("message", function(e) {
  if (e.data && e.data.type === "UPDATE_SIM_STATE") {
    window.applyPopupState(e.data.state);
  }
  if (e.data && e.data.type === "UPDATE_STUDIO_THEME") {
    if (e.data.layout && document.body) document.body.setAttribute("data-layout", e.data.layout);
    if (e.data.palette && document.body) document.body.setAttribute("data-palette", e.data.palette);
    if (e.data.themeMode) applyTheme(e.data.themeMode);
  }
});

function applyTheme(theme) {
  const isLight = theme === "light";
  if (typeof document !== "undefined" && document.body) {
    document.body.setAttribute("data-theme", isLight ? "light" : "dark");
  }
  const btnThemeToggle = typeof document !== "undefined" && document.getElementById ? document.getElementById("btnThemeToggle") : null;
  if (btnThemeToggle) {
    btnThemeToggle.innerHTML = isLight
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
    btnThemeToggle.title = isLight ? "${t.isRu ? "Переключить на темную тему" : "Switch to dark theme"}" : "${t.isRu ? "Переключить на светлую тему" : "Switch to light theme"}";
  }
}

function initPopup() {
  const statusText = document.getElementById("statusText");
  const heroStatusText = document.getElementById("heroStatusText");
  const badge = document.getElementById("badge") || document.getElementById("statusPill");
  const statusOrb = document.getElementById("statusOrb");
  const modeVal = document.getElementById("modeVal");
  const serverVal = document.getElementById("serverVal");
  const pingVal = document.getElementById("pingVal");
  const exitIpVal = document.getElementById("exitIpVal");
  const btnThemeToggle = document.getElementById("btnThemeToggle");
  const btnSyncNow = document.getElementById("btnSyncNow") || document.getElementById("btnSync");
  const btnPowerToggle = document.getElementById("btnPowerToggle");
  const btnPauseToggle = document.getElementById("btnPauseToggle") || document.getElementById("btnToggleBypass");
  const btnTestLatency = document.getElementById("btnTestLatency");
  const btnCheckIp = document.getElementById("btnCheckIp");

  // Tab switching listeners
  const tabs = document.querySelectorAll(".tab-btn");
  tabs.forEach(tab => {
    tab.addEventListener("click", (ev) => {
      ev.preventDefault();
      window.switchPopupTab(tab.dataset.tab || tab.id);
    });
  });

  // Day/Night theme toggler
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local && chrome.storage.local.get) {
    try {
      chrome.storage.local.get(["pecThemeMode"], (res) => {
        if (res && res.pecThemeMode) {
          applyTheme(res.pecThemeMode);
        }
      });
    } catch (e) {}
  }

  if (btnThemeToggle) {
    btnThemeToggle.addEventListener("click", () => {
      const cur = (document.body && document.body.getAttribute("data-theme") === "light") ? "light" : "dark";
      const next = cur === "light" ? "dark" : "light";
      applyTheme(next);
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local && chrome.storage.local.set) {
        chrome.storage.local.set({ pecThemeMode: next });
      }
    });
  }

  async function loadState() {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local && chrome.storage.local.get) {
      try {
        const stored = await chrome.storage.local.get(["pecProxyState", "pecThemeMode", "pecLastConfig"]);
        if (stored) {
          if (stored.pecProxyState && typeof stored.pecProxyState === "object") {
            window.applyPopupState(stored.pecProxyState);
          }
          if (stored.pecThemeMode) {
            applyTheme(stored.pecThemeMode);
          }
          if (stored.pecLastConfig && document.body) {
            if (stored.pecLastConfig.uiLayout) document.body.setAttribute("data-layout", stored.pecLastConfig.uiLayout);
            if (stored.pecLastConfig.colorPalette) document.body.setAttribute("data-palette", stored.pecLastConfig.colorPalette);
          }
        }
      } catch (e) {}
    }

    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action: "GET_STATUS", type: "GET_STATUS" }, (response) => {
        if (chrome.runtime.lastError || !response) {
          if (!serverVal || serverVal.textContent === "—") {
            if (statusText) statusText.textContent = "${t.connError}";
            if (heroStatusText) heroStatusText.textContent = "${t.connError}";
            if (badge) badge.className = "status-badge offline";
            if (statusOrb) statusOrb.className = "status-orb";
            if (serverVal) serverVal.textContent = "${t.serverUnreachable}";
            if (modeVal) modeVal.textContent = "—";
            if (pingVal) pingVal.textContent = "—";
          }
          return;
        }
        window.applyPopupState(response);
      });
    }
  }

  // 3 Action Buttons
  if (btnSyncNow) {
    btnSyncNow.addEventListener("click", () => {
      btnSyncNow.disabled = true;
      let syncIcon = btnSyncNow.querySelector(".sync-icon");
      if (!syncIcon) {
        const span = document.createElement("span");
        span.className = "sync-icon";
        span.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>';
        btnSyncNow.textContent = "";
        btnSyncNow.appendChild(span);
        syncIcon = span;
      }
      syncIcon.classList.add("spin");
      const startMs = Date.now();
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: "SYNC_NOW", type: "SYNC_NOW" }, (res) => {
          const latencyMs = Date.now() - startMs;
          setTimeout(() => {
            btnSyncNow.disabled = false;
            if (syncIcon) syncIcon.classList.remove("spin");
            if (res && res.ok && pingVal) {
              pingVal.textContent = latencyMs + " ms";
            }
            if (res) window.applyPopupState(res);
            loadState();
          }, 400);
        });
      } else {
        setTimeout(() => {
          btnSyncNow.disabled = false;
          if (syncIcon) syncIcon.classList.remove("spin");
        }, 400);
      }
    });
  }

  if (btnPowerToggle) {
    btnPowerToggle.addEventListener("click", () => {
      const nextEnabled = currentProxyState.enabled !== undefined ? !currentProxyState.enabled : false;
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: "SET_ENABLED", type: "SET_ENABLED", enabled: nextEnabled }, (res) => {
          if (res) {
            currentProxyState.enabled = res.enabled !== undefined ? res.enabled : nextEnabled;
            window.applyPopupState(currentProxyState);
          }
          loadState();
        });
      } else {
        currentProxyState.enabled = nextEnabled;
        window.applyPopupState(currentProxyState);
      }
    });
  }

  if (btnPauseToggle) {
    btnPauseToggle.addEventListener("click", () => {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: "BYPASS_TOGGLE", type: "BYPASS_TOGGLE" }, (res) => {
          if (res) window.applyPopupState(res);
          loadState();
        });
      } else {
        const nextBypass = !currentProxyState.bypassActive;
        currentProxyState.bypassActive = nextBypass;
        currentProxyState.bypassExpiresAt = nextBypass ? Date.now() + 15 * 60 * 1000 : null;
        window.applyPopupState(currentProxyState);
        if (window.parent && window.parent.postMessage) {
          window.parent.postMessage({ type: "SIM_TOGGLE_BYPASS" }, "*");
        }
      }
    });
  }

  // Active tab domain detection
  let currentDomain = "";
  if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.query) {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError || !tabs || !tabs.length) return;
        const tab = tabs[0];
        if (tab && tab.url) {
          try {
            const u = new URL(tab.url);
            if (u.hostname && !u.hostname.startsWith("chrome") && !u.hostname.startsWith("edge") && !u.hostname.startsWith("about")) {
              currentDomain = u.hostname;
              const btnAddCurrentSite = document.getElementById("btnAddCurrentSite");
              if (btnAddCurrentSite) {
                btnAddCurrentSite.textContent = "${t.isRu ? "+ Добавить сайт: " : "+ Add site: "}" + currentDomain;
                btnAddCurrentSite.style.display = "block";
              }
            }
          } catch (e) {}
        }
      });
    } catch (e) {}
  }

  // User rules CRUD
  let userRules = [];

  function renderUserRules(rules) {
    const listEl = document.getElementById("userRulesList");
    if (!listEl) return;
    const validRules = (rules || []).filter(r => r && typeof r.pattern === "string");
    if (!validRules.length) {
      listEl.innerHTML = '<div class="empty-rules">${t.emptyUserRules}</div>';
      return;
    }
    listEl.innerHTML = "";
    validRules.forEach((rule, idx) => {
      const item = document.createElement("div");
      item.className = "user-rule-item";

      const left = document.createElement("div");
      left.style.display = "flex";
      left.style.alignItems = "center";
      left.style.gap = "6px";
      left.style.minWidth = "0";

      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.className = "rule-toggle";
      chk.checked = Boolean(rule.enabled);
      chk.title = rule.enabled ? "${t.isRu ? "Отключить правило" : "Disable rule"}" : "${t.isRu ? "Включить правило" : "Enable rule"}";
      chk.addEventListener("change", () => {
        rule.enabled = chk.checked;
        saveUserRules(userRules);
      });

      const pat = document.createElement("span");
      pat.className = "rule-pattern";
      pat.textContent = rule.pattern;
      pat.title = rule.pattern;
      if (!rule.enabled) {
        pat.style.textDecoration = "line-through";
        pat.style.opacity = "0.6";
      }

      left.appendChild(chk);
      left.appendChild(pat);

      const meta = document.createElement("div");
      meta.className = "rule-meta";

      const badge = document.createElement("span");
      const act = (rule.action || "PROXY").toUpperCase();
      badge.className = "rule-badge " + act.toLowerCase();
      badge.textContent = act;

      const delBtn = document.createElement("button");
      delBtn.className = "rule-del-btn";
      delBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
      delBtn.title = "${t.isRu ? "Удалить правило" : "Delete rule"}";
      delBtn.addEventListener("click", () => {
        const removeIdx = userRules.indexOf(rule);
        if (removeIdx !== -1) {
          userRules.splice(removeIdx, 1);
        } else {
          userRules.splice(idx, 1);
        }
        saveUserRules(userRules);
      });

      meta.appendChild(badge);
      meta.appendChild(delBtn);

      item.appendChild(left);
      item.appendChild(meta);
      listEl.appendChild(item);
    });
  }

  const MAX_USER_RULES = 100;

  function saveUserRules(rules) {
    userRules = (rules || []).slice(0, MAX_USER_RULES);
    renderUserRules(userRules);
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action: "SAVE_USER_RULES", type: "SAVE_USER_RULES", rules: userRules });
    } else if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local && chrome.storage.local.set) {
      chrome.storage.local.set({ pecUserRules: userRules });
    }
  }

  function loadUserRules() {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action: "GET_USER_RULES", type: "GET_USER_RULES" }, (res) => {
        if (!chrome.runtime.lastError && res && Array.isArray(res.userRules)) {
          userRules = res.userRules.slice(0, MAX_USER_RULES);
          renderUserRules(userRules);
        }
      });
    } else if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local && chrome.storage.local.get) {
      chrome.storage.local.get(["pecUserRules"], (res) => {
        if (res && Array.isArray(res.pecUserRules)) {
          userRules = res.pecUserRules.slice(0, MAX_USER_RULES);
          renderUserRules(userRules);
        }
      });
    }
  }

  function addRule(pattern, action) {
    let p = (pattern || "").trim().toLowerCase();
    if (!p) return;
    // Strip protocol if user pasted full URL (e.g. https://site.com/abc -> site.com)
    if (p.indexOf("://") !== -1) {
      try {
        p = new URL(p).hostname.toLowerCase();
      } catch (e) {
        p = p.replace(/^[a-z]+:\\/\\//i, "").split("/")[0].split(":")[0];
      }
    } else if (p.indexOf("/") !== -1) {
      p = p.split("/")[0].trim();
    }
    if (p.indexOf(":") !== -1 && p.indexOf("]") === -1) {
      p = p.split(":")[0].trim();
    }
    if (!p) return;
    const act = (action || "PROXY").toUpperCase();
    const existing = userRules.find(r => r.pattern.toLowerCase() === p);
    if (existing) {
      existing.action = act;
      existing.enabled = true;
    } else {
      if (userRules.length >= MAX_USER_RULES) {
        return;
      }
      userRules.push({ pattern: p, action: act, enabled: true });
    }
    saveUserRules(userRules);
  }

  const inputPattern = document.getElementById("inputPattern");
  const selectAction = document.getElementById("selectAction");
  const btnAddRule = document.getElementById("btnAddRule");
  const btnAddCurrentSite = document.getElementById("btnAddCurrentSite");

  if (btnAddRule) {
    btnAddRule.addEventListener("click", () => {
      if (inputPattern && inputPattern.value.trim()) {
        addRule(inputPattern.value.trim(), selectAction ? selectAction.value : "PROXY");
        inputPattern.value = "";
      }
    });
  }

  if (inputPattern) {
    inputPattern.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && inputPattern.value.trim()) {
        addRule(inputPattern.value.trim(), selectAction ? selectAction.value : "PROXY");
        inputPattern.value = "";
      }
    });
  }

  if (btnAddCurrentSite) {
    btnAddCurrentSite.addEventListener("click", () => {
      if (currentDomain) {
        if (inputPattern) inputPattern.value = currentDomain;
        addRule(currentDomain, (selectAction && selectAction.value) || "DIRECT");
      }
    });
  }

  // Diagnostics
  if (btnTestLatency) {
    btnTestLatency.addEventListener("click", async () => {
      btnTestLatency.disabled = true;
      const origText = btnTestLatency.textContent;
      btnTestLatency.textContent = "...";
      const startMs = Date.now();
      const base = window.__pecServerBase || "";
      try {
        const c1 = new AbortController();
        const t1 = setTimeout(() => c1.abort(), 4000);
        let res = await fetch("https://api.ipify.org?format=json", { signal: c1.signal, cache: "no-store" }).catch(() => null);
        clearTimeout(t1);
        if (!res || !res.ok) {
          const c2 = new AbortController();
          const t2 = setTimeout(() => c2.abort(), 4000);
          res = await fetch("https://icanhazip.com", { signal: c2.signal, cache: "no-store" }).catch(() => null);
          clearTimeout(t2);
        }
        if (!res || !res.ok) {
          res = await fetch(base + "/api/ip-echo", { cache: "no-store" }).catch(() => null);
        }
        if (!res || !res.ok) {
          res = await fetch(base + "/ip-echo", { cache: "no-store" }).catch(() => null);
        }
        const latencyMs = Date.now() - startMs;
        if (pingVal) {
          pingVal.textContent = latencyMs + " ms";
        }
      } catch (e) {
        if (pingVal) pingVal.textContent = "—";
      } finally {
        setTimeout(() => {
          btnTestLatency.disabled = false;
          btnTestLatency.textContent = origText;
        }, 300);
      }
    });
  }

  if (btnCheckIp) {
    btnCheckIp.addEventListener("click", async () => {
      btnCheckIp.disabled = true;
      const origText = btnCheckIp.textContent;
      btnCheckIp.textContent = "${t.checkingIp}";
      if (exitIpVal) exitIpVal.textContent = "${t.checkingIp}";
      const base = window.__pecServerBase || "";
      let ip = null;
      let geo = null;

      function isIpAddress(str) {
        if (!str || typeof str !== "string") return false;
        let s = str.trim();
        if (s.startsWith("::ffff:")) s = s.substring(7);
        // IPv4 regex (4 octets 0-255)
        if (/^(?:(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)$/.test(s)) return true;
        // IPv6 regex
        if (/^[a-fA-F0-9:]{2,39}$/.test(s) && s.includes(":")) return true;
        return false;
      }

      async function fetchCandidate(url, isJson, key) {
        try {
          const c = new AbortController();
          const t = setTimeout(() => c.abort(), 3500);
          const res = await fetch(url, { signal: c.signal, cache: "no-store" }).catch(() => null);
          clearTimeout(t);
          if (!res || !res.ok) return null;
          if (isJson) {
            const data = await res.json().catch(() => null);
            const val = data && key ? data[key] : (data && data.ip ? data.ip : null);
            return isIpAddress(val) ? String(val).trim() : null;
          }
          const text = await res.text().catch(() => "");
          const clean = text.trim();
          return isIpAddress(clean) ? clean : null;
        } catch {
          return null;
        }
      }

      // 1. Primary: https://api.ipify.org?format=json
      ip = await fetchCandidate("https://api.ipify.org?format=json", true, "ip");

      // 2. Fast global fallback: https://checkip.amazonaws.com
      if (!ip) {
        ip = await fetchCandidate("https://checkip.amazonaws.com", false);
      }

      // 3. Fallback: https://icanhazip.com
      if (!ip) {
        ip = await fetchCandidate("https://icanhazip.com", false);
      }

      // 4. Reliable Russian provider: https://yandex.ru/internet/api/v0/ip
      if (!ip) {
        ip = await fetchCandidate("https://yandex.ru/internet/api/v0/ip", false);
      }

      // 5. Intranet echo fallback
      if (!ip && base) {
        try {
          let res = await fetch(base + "/api/ip-echo").catch(() => null);
          if (!res || !res.ok) {
            res = await fetch(base + "/ip-echo").catch(() => null);
          }
          if (res && res.ok) {
            const data = await res.json().catch(() => null);
            if (data && isIpAddress(data.ip)) {
              ip = String(data.ip).trim();
              if (data.geo) geo = data.geo;
            }
          }
        } catch (err) {}
      }

      if (ip && exitIpVal) {
        exitIpVal.textContent = ip + (geo ? " (" + geo + ")" : "");
      } else if (exitIpVal) {
        exitIpVal.textContent = "${t.connError}";
      }
      setTimeout(() => {
        btnCheckIp.disabled = false;
        btnCheckIp.textContent = origText;
      }, 400);
    });
  }

  // Diagnostics log viewer
  const logContainer = document.getElementById("logContainer");
  const btnCopyLogs = document.getElementById("btnCopyLogs");
  const btnClearLogs = document.getElementById("btnClearLogs");
  const logCountTag = document.getElementById("logCountTag");

  function formatTime(isoStr) {
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return "--:--:--";
      return d.toTimeString().split(" ")[0] + "." + String(d.getMilliseconds()).padStart(3, "0");
    } catch {
      return isoStr || "--:--:--";
    }
  }

  function renderLogs(logs) {
    if (!logContainer) return;
    if (!Array.isArray(logs) || logs.length === 0) {
      logContainer.textContent = "${t.emptyLog}";
      if (logCountTag) logCountTag.textContent = "${t.zeroEntries}";
      return;
    }
    if (logCountTag) logCountTag.textContent = logs.length + "${t.entriesSuffix}";
    const lines = logs.map((l) => {
      const time = formatTime(l.timestamp || l.time);
      const lvl = (l.level || "INFO").toUpperCase().padEnd(5);
      const msg = l.message || "";
      const extra = l.data ? " " + (typeof l.data === "object" ? JSON.stringify(l.data) : l.data) : "";
      return "[" + time + "] [" + lvl + "] " + msg + extra;
    });
    logContainer.textContent = lines.join("\\n");
    logContainer.scrollTop = logContainer.scrollHeight;
  }

  function loadLogs() {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action: "GET_LOGS", type: "GET_LOGS" }, (res) => {
        if (!chrome.runtime.lastError && res && Array.isArray(res.logs)) {
          renderLogs(res.logs);
        }
      });
    }
  }

  window.__pecLoadLogs = loadLogs;

  if (btnCopyLogs) {
    btnCopyLogs.addEventListener("click", () => {
      if (!logContainer) return;
      const text = logContainer.textContent || "";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          const orig = btnCopyLogs.textContent;
          btnCopyLogs.textContent = "${t.copied}";
          setTimeout(() => { btnCopyLogs.textContent = orig; }, 1200);
        }).catch(() => {});
      }
    });
  }

  if (btnClearLogs) {
    btnClearLogs.addEventListener("click", () => {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: "CLEAR_LOGS", type: "CLEAR_LOGS" }, () => {
          renderLogs([]);
        });
      } else {
        renderLogs([]);
      }
    });
  }

  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local") {
        if (changes.pecProxyState && changes.pecProxyState.newValue) {
          window.applyPopupState(changes.pecProxyState.newValue);
        }
        if (changes.pecUserRules && changes.pecUserRules.newValue) {
          userRules = changes.pecUserRules.newValue;
          renderUserRules(userRules);
        }
        if (changes.pecThemeMode && changes.pecThemeMode.newValue) {
          applyTheme(changes.pecThemeMode.newValue);
        }
      }
    });
  }

  loadState();
  loadUserRules();
  loadLogs();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPopup);
  } else {
    initPopup();
  }
}
`;
}
