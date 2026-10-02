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
  const btnPauseToggle = document.getElementById("btnPauseToggle");
  const btnPauseLabel = document.getElementById("btnPauseLabel");
  if (!btnPauseToggle && !btnPauseLabel) return;
  if (!expiresAt || expiresAt <= Date.now()) {
    if (btnPauseToggle) btnPauseToggle.title = "Пауза 15м";
    if (btnPauseLabel) btnPauseLabel.textContent = "Пауза 15м";
    if (bypassCountdownTimer && typeof clearInterval !== "undefined") {
      clearInterval(bypassCountdownTimer);
      bypassCountdownTimer = null;
    }
    return;
  }
  const remainingSec = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
  const m = Math.floor(remainingSec / 60);
  const s = remainingSec % 60;
  const timeStr = "Пауза (" + m + ":" + (s < 10 ? "0" : "") + s + ")";
  if (btnPauseToggle) btnPauseToggle.title = timeStr;
  if (btnPauseLabel) btnPauseLabel.textContent = timeStr;
}

function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
    if (btnPowerToggle.classList && typeof btnPowerToggle.classList.toggle === "function") {
      btnPowerToggle.classList.toggle("btn-power-active", isEnabled);
      btnPowerToggle.classList.toggle("btn-power-disabled", !isEnabled);
    }
    btnPowerToggle.title = isEnabled ? "Отключить прокси" : "Включить прокси";
  }

  if (btnPauseToggle) {
    if (btnPauseToggle.classList && typeof btnPauseToggle.classList.toggle === "function") {
      btnPauseToggle.classList.toggle("btn-pause-active", isBypass);
    }
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
              if (btnPauseToggle) {
                btnPauseToggle.title = "Пауза 15м";
                if (btnPauseToggle.classList && typeof btnPauseToggle.classList.remove === "function") {
                  btnPauseToggle.classList.remove("btn-pause-active");
                }
              }
              if (btnPauseLabel) btnPauseLabel.textContent = "Пауза 15м";
            }
          }, 1000);
        }
      } else {
        if (btnPauseToggle) btnPauseToggle.title = "Включить прокси";
        if (btnPauseLabel) btnPauseLabel.textContent = "Включить прокси";
      }
    } else {
      if (btnPauseToggle) btnPauseToggle.title = "Пауза 15м";
      if (btnPauseLabel) btnPauseLabel.textContent = "Пауза 15м";
    }
  }

  if (modeVal) {
    if (isBypass) {
      modeVal.textContent = "Обход (Bypass)";
      modeVal.title = "Прокси временно отключен пользователем";
    } else if (response.protocol === "pac") {
      const isTunnel = response.profileDefaultPolicy === "proxy";
      modeVal.textContent = isTunnel ? "PAC (туннель)" : "PAC (селективный)";
      modeVal.title = isTunnel ? "Весь трафик через прокси, кроме исключений" : "Проксируются только домены из правил; остальной трафик — напрямую";
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
  if (response.uiLayout && document.body) {
    document.body.setAttribute("data-layout", response.uiLayout);
  }
  if (response.colorPalette && document.body) {
    document.body.setAttribute("data-palette", response.colorPalette);
  }
  if (response.serverBase) window.__pecServerBase = response.serverBase;

  if (btnToggle) {
    btnToggle.textContent = isBypass ? "Включить прокси" : "Временно отключить (15м)";
  }

  const cardProxySelector = document.getElementById("cardProxySelector");
  const selectActiveProxy = document.getElementById("selectActiveProxy");
  const activeProxyProtocolBadge = document.getElementById("activeProxyProtocolBadge");

  if (cardProxySelector) {
    if (response.allowUserProxySwitch === false) {
      cardProxySelector.style.display = "none";
    } else {
      cardProxySelector.style.display = "block";
    }
  }

  if (activeProxyProtocolBadge) {
    let proto = "";
    if (response.activeProxyId && Array.isArray(response.availableProxies)) {
      const activeNode = response.availableProxies.find(function(p) { return p.id === response.activeProxyId; });
      if (activeNode && activeNode.protocol) {
        proto = activeNode.protocol;
      }
    }
    if (!proto && response.proxyProtocol) {
      proto = response.proxyProtocol;
    }
    if (!proto && response.config && response.config.protocol && response.config.protocol !== "pac") {
      proto = response.config.protocol;
    }
    if (!proto) {
      proto = (response.protocol && response.protocol !== "pac") ? response.protocol : (currentProxyState.proxyProtocol || currentProxyState.protocol || "HTTP");
    }
    activeProxyProtocolBadge.textContent = proto.toUpperCase();
  }

  if (selectActiveProxy && Array.isArray(response.availableProxies)) {
    const isRu = "true" === "true";
    const currentActiveId = response.activeProxyId || "";
    const optionsHtml = response.availableProxies.map(function(p) {
      const pHostPort = p.host && p.host.includes(":") && !p.host.startsWith("[") ? "[" + p.host + "]:" + p.port : (p.host ? p.host + ":" + p.port : "");
      const pName = p.name || pHostPort || p.id;
      const pProto = (p.protocol || "http").toUpperCase();
      const sel = p.id === currentActiveId ? " selected" : "";
      return '<option value="' + escapeHtml(p.id) + '"' + sel + '>' + escapeHtml(pName) + ' (' + escapeHtml(pProto) + ')</option>';
    }).join("");

    const defaultOpt = '<option value="">' + (isRu ? "По умолчанию (Сервер)" : "Default (Server)") + '</option>';
    selectActiveProxy.innerHTML = defaultOpt + optionsHtml;
    selectActiveProxy.value = currentActiveId;
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
      delBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
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
        p = p.replace(/^[a-z]+:\/\//i, "").split("/")[0].split(":")[0];
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

  const selectActiveProxy = document.getElementById("selectActiveProxy");
  if (selectActiveProxy) {
    selectActiveProxy.addEventListener("change", () => {
      const proxyId = selectActiveProxy.value;
      const badge = document.getElementById("activeProxyProtocolBadge");
      if (badge && Array.isArray(currentProxyState.availableProxies)) {
        const selNode = currentProxyState.availableProxies.find(function(p) { return p.id === proxyId; });
        if (selNode && selNode.protocol) {
          badge.textContent = selNode.protocol.toUpperCase();
        }
      }
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: "SET_ACTIVE_PROXY", proxyId: proxyId }, (res) => {
          if (res) window.applyPopupState(res);
        });
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
        const c = new AbortController();
        const t = setTimeout(() => c.abort(), 4000);
        const pings = [
          "https://api.ipify.org?format=json",
          "https://checkip.amazonaws.com",
          "https://ipv4.icanhazip.com"
        ];
        await Promise.any(
          pings.map(async (url) => {
            const res = await fetch(url, { signal: c.signal, cache: "no-store" });
            if (!res || !res.ok) throw new Error("Ping failed");
            return true;
          })
        ).catch(async () => {
          if (base) {
            let res = await fetch(base + "/api/ip-echo", { cache: "no-store" }).catch(() => null);
            if (!res || !res.ok) res = await fetch(base + "/ip-echo", { cache: "no-store" }).catch(() => null);
            if (!res || !res.ok) throw new Error("All ping fallbacks failed");
          }
        });
        clearTimeout(t);
        c.abort();
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
      btnCheckIp.textContent = "Проверка IP...";
      if (exitIpVal) exitIpVal.textContent = "Проверка IP...";
      const base = window.__pecServerBase || "";
      let ip = null;
      let geo = null;

      function isIpAddress(str) {
        if (!str || typeof str !== "string") return false;
        let s = str.trim();
        if (s.startsWith("::ffff:")) s = s.substring(7);
        // IPv4 regex (4 octets 0-255)
        if (/^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/.test(s)) return true;
        // IPv6 regex
        if (/^[a-fA-F0-9:]{2,39}$/.test(s) && s.includes(":")) return true;
        return false;
      }

      const candidates = [
        { url: "https://api.ipify.org?format=json", isJson: true, key: "ip" },
        { url: "https://checkip.amazonaws.com", isJson: false },
        { url: "https://ipv4.icanhazip.com", isJson: false },
        { url: "https://icanhazip.com", isJson: false },
        { url: "https://yandex.ru/internet/api/v0/ip", isJson: false }
      ];

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      try {
        ip = await Promise.any(
          candidates.map(async (cand) => {
            const res = await fetch(cand.url, { signal: controller.signal, cache: "no-store" });
            if (!res || !res.ok) throw new Error("HTTP error " + (res ? res.status : "unknown"));
            let val = null;
            if (cand.isJson) {
              const data = await res.json();
              val = data && cand.key ? data[cand.key] : (data && data.ip ? data.ip : null);
            } else {
              const text = await res.text();
              val = text ? text.trim() : null;
            }
            if (!isIpAddress(val)) {
              throw new Error("Invalid IP address");
            }
            return String(val).trim();
          })
        );
        clearTimeout(timeoutId);
        controller.abort();
      } catch (err) {
        clearTimeout(timeoutId);
        controller.abort();
      }

      // Fallback to intranet echo endpoint
      if (!ip && base) {
        try {
          let res = await fetch(base + "/api/ip-echo", { cache: "no-store" }).catch(() => null);
          if (!res || !res.ok) {
            res = await fetch(base + "/ip-echo", { cache: "no-store" }).catch(() => null);
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
      logContainer.textContent = "Журнал пуст";
      if (logCountTag) logCountTag.textContent = "0 записей";
      return;
    }
    if (logCountTag) logCountTag.textContent = logs.length + " записей";
    const lines = logs.map((l) => {
      const time = formatTime(l.timestamp || l.time);
      const lvl = (l.level || "INFO").toUpperCase().padEnd(5);
      const msg = l.message || "";
      const extra = l.data ? " " + (typeof l.data === "object" ? JSON.stringify(l.data) : l.data) : "";
      return "[" + time + "] [" + lvl + "] " + msg + extra;
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
