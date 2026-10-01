// background.js - Enterprise Chrome MV3 Service Worker (PEC template)
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
    chrome.storage.local.get(["pecLogs", "pecProxyState", "pecLastConfig", "pecEnabled"], (res) => {
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
  const pacDirMatch = pacText.match(/return\s+"((?:SOCKS5|HTTPS|PROXY)\s+(?!127\.0\.0\.1|10\.0\.0\.1|0\.0\.0\.0)[^"]+)";/i);
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
        rawPattern = rawPattern.replace(/^[a-z]+:\/\//i, "").split("/")[0].split(":")[0];
      }
    } else if (rawPattern.indexOf("/") !== -1) {
      rawPattern = rawPattern.split("/")[0].trim();
    }
    if (rawPattern.indexOf(":") !== -1 && rawPattern.indexOf("]") === -1) {
      rawPattern = rawPattern.split(":")[0].trim();
    }
    // Sanitize pattern: strip newlines, quotes and backslashes
    let cleanPattern = rawPattern.replace(/["\\\r\n]/g, "");
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
async function applyPacScript(pacUrl, config) {
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
      updateBadge(scheme === "socks5" ? "S5" : "P", "#10b981");
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
              lastSync: Date.now(),
            };

            persistProxyState();
            logEvent("info", "Sync successful: profile=" + currentProxyState.profileName + ", mode=" + currentProxyState.protocol + ", host=" + (currentProxyState.host || "pac"));

            if (!proxyReachable) {
              logEvent("warn", "Configured proxy " + (currentProxyState.host || "") + ":" + currentProxyState.port + " is unreachable from server");
            }

            if (autoConfigureProxy) {
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
