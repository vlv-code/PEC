// Global tab switching helper
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
  const btnPauseLabel = document.getElementById("btnPauseLabel");
  if (!btnPauseLabel) return;
  if (!expiresAt || expiresAt <= Date.now()) {
    btnPauseLabel.textContent = "Пауза 15м";
    if (bypassCountdownTimer && typeof clearInterval !== "undefined") {
      clearInterval(bypassCountdownTimer);
      bypassCountdownTimer = null;
    }
    return;
  }
  const remainingSec = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
  const m = Math.floor(remainingSec / 60);
  const s = remainingSec % 60;
  btnPauseLabel.textContent = "Пауза (" + m + ":" + (s < 10 ? "0" : "") + s + ")";
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

  const isBypass = Boolean(response.bypassActive);
  const isOnline = Boolean(response.online);
  const isEnabled = response.enabled !== false;

  let stateStr = "Отключен";
  let badgeCls = "status-badge offline";
  let orbCls = "status-orb";

  if (isBypass) {
    stateStr = "Обход";
    badgeCls = "status-badge bypass";
    orbCls = "status-orb bypass";
  } else if (!isEnabled || !isOnline) {
    stateStr = "Отключен";
    badgeCls = "status-badge offline";
    orbCls = "status-orb";
  } else {
    stateStr = "Активен";
    badgeCls = "status-badge";
    orbCls = "status-orb active";
  }

  if (statusText) statusText.textContent = stateStr;
  if (heroStatusText) heroStatusText.textContent = stateStr;
  if (badge) badge.className = badgeCls;
  if (statusOrb) statusOrb.className = orbCls;

  if (btnPowerLabel) {
    btnPowerLabel.textContent = isEnabled ? "Отключить" : "Включить";
  }
  if (btnPowerToggle) {
    btnPowerToggle.style.opacity = isEnabled ? "1" : "0.7";
  }

  if (bypassCountdownTimer && typeof clearInterval !== "undefined") {
    clearInterval(bypassCountdownTimer);
    bypassCountdownTimer = null;
  }
  if (btnPauseLabel) {
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
              if (btnPauseLabel) btnPauseLabel.textContent = "Пауза 15м";
            }
          }, 1000);
        }
      } else {
        btnPauseLabel.textContent = "Включить прокси";
      }
    } else {
      btnPauseLabel.textContent = "Пауза 15м";
    }
  }

  if (modeVal) {
    if (isBypass) {
      modeVal.textContent = "Обход (Bypass)";
      modeVal.title = "Прокси временно отключен пользователем";
    } else if (response.protocol === "pac") {
      const isTunnel = response.profileDefaultPolicy === "proxy";
      modeVal.textContent = isTunnel ? "PAC (туннель)" : "PAC (селективный)";
      modeVal.title = isTunnel
        ? "Весь трафик через прокси, кроме исключений"
        : "Проксируются только домены из правил; остальной трафик — напрямую";
    } else if (response.protocol) {
      modeVal.textContent = "Fixed (" + response.protocol.toUpperCase() + ")";
      modeVal.title = "Весь трафик направляется через фиксированный прокси-сервер";
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
    serverVal.textContent = (isOnline && response.host) ? (response.host + ":" + response.port) : (isOnline ? "Direct" : "Отключен");
  }
  if (profileVal) profileVal.textContent = response.profileName || "Selective PAC";
  if (pingVal && response.ping) pingVal.textContent = response.ping;
  if (exitIpVal && response.exitIp) exitIpVal.textContent = response.exitIp;
  if (response.serverBase) window.__pecServerBase = response.serverBase;

  if (btnToggle) {
    btnToggle.textContent = isBypass ? "Включить прокси" : "Временно отключить (15м)";
  }
};

window.addEventListener("message", function(e) {
  if (e.data && e.data.type === "UPDATE_SIM_STATE") {
    window.applyPopupState(e.data.state);
  }
});

function applyTheme(theme) {
  const isLight = theme === "light";
  if (typeof document !== "undefined" && document.body) {
    document.body.setAttribute("data-theme", isLight ? "light" : "dark");
  }
  const btnThemeToggle = typeof document !== "undefined" && document.getElementById ? document.getElementById("btnThemeToggle") : null;
  if (btnThemeToggle) {
    btnThemeToggle.textContent = isLight ? "🌙" : "☀️";
    btnThemeToggle.title = isLight ? "Переключить на темную тему" : "Переключить на светлую тему";
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
        const stored = await chrome.storage.local.get(["pecProxyState", "pecThemeMode"]);
        if (stored) {
          if (stored.pecProxyState && typeof stored.pecProxyState === "object") {
            window.applyPopupState(stored.pecProxyState);
          }
          if (stored.pecThemeMode) {
            applyTheme(stored.pecThemeMode);
          }
        }
      } catch (e) {}
    }

    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action: "GET_STATUS", type: "GET_STATUS" }, (response) => {
        if (chrome.runtime.lastError || !response) {
          if (!serverVal || serverVal.textContent === "—") {
            if (statusText) statusText.textContent = "Ошибка связи";
            if (heroStatusText) heroStatusText.textContent = "Ошибка связи";
            if (badge) badge.className = "status-badge offline";
            if (statusOrb) statusOrb.className = "status-orb";
            if (serverVal) serverVal.textContent = "Сервер PEC недоступен";
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
      const syncIcon = btnSyncNow.querySelector(".sync-icon") || btnSyncNow;
      if (syncIcon) syncIcon.classList.add("spin");
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
                btnAddCurrentSite.textContent = "+ Добавить сайт: " + currentDomain;
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
      listEl.innerHTML = '<div class="empty-rules">Нет пользовательских правил</div>';
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
      chk.title = rule.enabled ? "Отключить правило" : "Включить правило";
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
      delBtn.textContent = "✕";
      delBtn.title = "Удалить правило";
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

  function saveUserRules(rules) {
    userRules = rules;
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
          userRules = res.userRules;
          renderUserRules(userRules);
        }
      });
    } else if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local && chrome.storage.local.get) {
      chrome.storage.local.get(["pecUserRules"], (res) => {
        if (res && Array.isArray(res.pecUserRules)) {
          userRules = res.pecUserRules;
          renderUserRules(userRules);
        }
      });
    }
  }

  function addRule(pattern, action) {
    const p = (pattern || "").trim();
    if (!p) return;
    const act = (action || "PROXY").toUpperCase();
    const existing = userRules.find(r => r.pattern.toLowerCase() === p.toLowerCase());
    if (existing) {
      existing.action = act;
      existing.enabled = true;
    } else {
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
        let res = await fetch(base + "/api/ip-echo").catch(() => null);
        if (!res || !res.ok) {
          res = await fetch(base + "/ip-echo").catch(() => null);
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
      btnCheckIp.textContent = "Проверка...";
      if (exitIpVal) exitIpVal.textContent = "Проверка IP...";
      const base = window.__pecServerBase || "";
      let ip = null;
      let geo = null;

      // 1. Primary: https://api.ipify.org?format=json (4000ms timeout)
      try {
        const c1 = new AbortController();
        const t1 = setTimeout(() => c1.abort(), 4000);
        const res1 = await fetch("https://api.ipify.org?format=json", { signal: c1.signal }).catch(() => null);
        clearTimeout(t1);
        if (res1 && res1.ok) {
          const data1 = await res1.json().catch(() => null);
          if (data1 && data1.ip) ip = String(data1.ip).trim();
        }
      } catch (e) {}

      // 2. Fallback: https://icanhazip.com (4000ms timeout, plain text)
      if (!ip) {
        try {
          const c2 = new AbortController();
          const t2 = setTimeout(() => c2.abort(), 4000);
          const res2 = await fetch("https://icanhazip.com", { signal: c2.signal }).catch(() => null);
          clearTimeout(t2);
          if (res2 && res2.ok) {
            const text2 = await res2.text().catch(() => "");
            if (text2 && text2.trim()) ip = text2.trim();
          }
        } catch (e) {}
      }

      // 3. Tertiary fallback: intranet echo
      if (!ip) {
        try {
          let res = await fetch(base + "/api/ip-echo").catch(() => null);
          if (res && res.ok) {
            const data = await res.json().catch(() => null);
            if (data && data.ip) {
              ip = String(data.ip).trim();
              if (data.geo) geo = data.geo;
            }
          } else {
            let res2 = await fetch(base + "/ip-echo").catch(() => null);
            if (res2 && res2.ok) {
              const data2 = await res2.json().catch(() => null);
              if (data2 && data2.ip) {
                ip = String(data2.ip).trim();
                if (data2.geo) geo = data2.geo;
              }
            }
          }
        } catch (err) {}
      }

      if (ip && exitIpVal) {
        exitIpVal.textContent = ip + (geo ? " (" + geo + ")" : "");
      } else if (exitIpVal) {
        exitIpVal.textContent = "Ошибка связи";
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
      logContainer.textContent = "Журнал пуст. Нет зарегистрированных событий.";
      if (logCountTag) logCountTag.textContent = "0 записей";
      return;
    }
    if (logCountTag) logCountTag.textContent = logs.length + " зап.";
    const lines = logs.map((l) => {
      const time = formatTime(l.timestamp || l.time);
      const lvl = (l.level || "INFO").toUpperCase().padEnd(5);
      const msg = l.message || "";
      const extra = l.data ? " " + (typeof l.data === "object" ? JSON.stringify(l.data) : l.data) : "";
      return `[${time}] [${lvl}] ${msg}${extra}`;
    });
    logContainer.textContent = lines.join("\n");
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
          btnCopyLogs.textContent = "Скопировано!";
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