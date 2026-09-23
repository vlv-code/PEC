// Global tab switching helper
window.switchPopupTab = function(tabId) {
  if (!tabId) return;
  const tabs = document.querySelectorAll(".tab-btn");
  tabs.forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));

  const activeBtn = document.querySelector('.tab-btn[data-tab="' + tabId + '"]');
  if (activeBtn) activeBtn.classList.add("active");
  const target = document.getElementById(tabId);
  if (target) target.classList.add("active");
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

  if (statusText) {
    if (response.bypassActive) statusText.textContent = "Обход";
    else if (!response.online) statusText.textContent = "Отключен";
    else statusText.textContent = "Активен";
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
  if (modeVal && response.protocol) modeVal.textContent = response.protocol.toUpperCase();
  if (serverVal) serverVal.textContent = response.host ? (response.host + ":" + response.port) : "Direct";
  if (profileVal) profileVal.textContent = response.profileName || "Selective PAC";
  if (pingVal && response.ping) pingVal.textContent = response.ping;
  if (exitIpVal && response.exitIp) exitIpVal.textContent = response.exitIp;
  // Remember the management server origin (reported by the service worker)
  // so the diagnostics tab can call it with an absolute URL - a relative
  // fetch() inside chrome-extension:// never reaches the server.
  if (response.serverBase) window.__pecServerBase = response.serverBase;
  if (btnToggle) {
    btnToggle.textContent = response.bypassActive ? "Включить прокси" : "Временно отключить (15м)";
  }
};

window.addEventListener("message", function(e) {
  if (e.data && e.data.type === "UPDATE_SIM_STATE") {
    window.applyPopupState(e.data.state);
  }
});

function initPopup() {
  const statusText = document.getElementById("statusText");
  const badge = document.getElementById("badge");
  const modeVal = document.getElementById("modeVal");
  const serverVal = document.getElementById("serverVal");
  const profileVal = document.getElementById("profileVal");
  const exitIpVal = document.getElementById("exitIpVal");
  const btnSync = document.getElementById("btnSync");
  const btnToggle = document.getElementById("btnToggleBypass");
  const btnCheckIp = document.getElementById("btnCheckIp");

  // Tab switching listeners
  const tabs = document.querySelectorAll(".tab-btn");
  tabs.forEach(tab => {
    tab.addEventListener("click", (ev) => {
      ev.preventDefault();
      window.switchPopupTab(tab.dataset.tab);
    });
  });

  async function loadState() {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action: "GET_STATUS" }, (response) => {
        if (chrome.runtime.lastError || !response) {
          if (statusText) statusText.textContent = "Активен";
          return;
        }
        window.applyPopupState(response);
      });
    }
  }

  if (btnSync) {
    btnSync.addEventListener("click", () => {
      btnSync.disabled = true;
      const originalText = btnSync.innerHTML;
      btnSync.innerHTML = "<span>Синхронизация...</span>";
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: "FORCE_SYNC" }, () => {
          setTimeout(() => {
            btnSync.disabled = false;
            btnSync.innerHTML = originalText;
            loadState();
          }, 800);
        });
      } else {
        setTimeout(() => {
          btnSync.disabled = false;
          btnSync.innerHTML = originalText;
        }, 600);
      }
    });
  }

  if (btnToggle) {
    btnToggle.addEventListener("click", () => {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: "TOGGLE_BYPASS" }, () => {
          loadState();
        });
      } else {
        const isBypassed = badge && badge.classList.contains("bypass");
        if (badge) badge.className = isBypassed ? "status-badge" : "status-badge bypass";
        if (statusText) statusText.textContent = isBypassed ? "Активен" : "Обход";
        btnToggle.textContent = isBypassed ? "Временно отключить (15м)" : "Включить прокси";
        if (window.parent && window.parent.postMessage) {
          window.parent.postMessage({ type: "SIM_TOGGLE_BYPASS" }, "*");
        }
      }
    });
  }

  if (btnCheckIp) {
    btnCheckIp.addEventListener("click", async () => {
      btnCheckIp.disabled = true;
      btnCheckIp.textContent = "Проверка IP...";
      try {
        const base = window.__pecServerBase || "";
        const res = await fetch(base + "/api/ip-echo").then(r => r.json()).catch(() => null);
        if (res && res.ip && exitIpVal) {
          exitIpVal.textContent = res.ip;
        }
      } catch {}
      setTimeout(() => {
        btnCheckIp.disabled = false;
        btnCheckIp.textContent = "Проверить Egress IP и Гео";
      }, 500);
    });
  }

  loadState();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPopup);
} else {
  initPopup();
}