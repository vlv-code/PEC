// Entry point for modular PEC Dashboard UI
import { state, startDashboardTimers, stopDashboardTimers } from './core/state.js';
import * as api from './core/api.js';
import * as notify from './core/notify.js';
import * as theme from './core/theme.js';
import * as proxies from './tabs/proxies.js';
import * as routing from './tabs/routing.js';
import * as studio from './tabs/studio.js';
import * as telemetry from './tabs/telemetry.js';

// Re-export all sub-modules for tree-shaking and module consumers
export * from './core/state.js';
export * from './core/api.js';
export * from './core/notify.js';
export * from './core/theme.js';
export * from './tabs/proxies.js';
export * from './tabs/routing.js';
export * from './tabs/studio.js';
export * from './tabs/telemetry.js';

// Immediate theme boot to prevent FOUC (Flash of Unstyled Content)
try {
  const _bootLayout = localStorage.getItem('pec_server_layout') || 'console';
  if (_bootLayout && document.body) document.body.setAttribute('data-layout', _bootLayout);
  const _bootTheme = localStorage.getItem('pec_server_theme') || 'cyber';
  if (_bootTheme && document.body) document.body.setAttribute('data-theme', _bootTheme);
  const _bootMode = localStorage.getItem('pec_server_theme_mode') || 'dark';
  if (_bootMode && document.body) document.body.setAttribute('data-theme-mode', _bootMode);
  const _bootLang = localStorage.getItem('pec_lang') || 'ru';
  if (_bootLang && document.documentElement) document.documentElement.lang = _bootLang;
} catch (_) {}

if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', function(event: any) {
    if (event.reason && (event.reason.name === 'TypeError' || String(event.reason).includes('fetch') || String(event.reason).includes('Failed to fetch'))) {
      console.warn('Network request error safely handled:', event.reason);
      event.preventDefault();
    } else {
      console.warn('Unhandled promise rejection:', event.reason);
    }
  });
}

export const TAB_HASH_MAP: Record<string, string> = {
  'routing': '#routing',
  'proxy-settings': '#proxy-settings',
  'rotation': '#proxy-settings',
  'builder': '#extension-builder',
  'extension-builder': '#extension-builder',
  'app-studio': '#app-studio',
  'fleet': '#fleet',
  'instances': '#fleet',
  'gpo': '#gpo',
  'releases': '#releases',
  'logs': '#logs',
  'audit': '#logs'
};

export function getTabNameFromHash(hash: string): { tab: string; branch?: string } | null {
  if (!hash) return null;
  const clean = hash.replace(/^[#/]+/, '').toLowerCase();
  if (clean === 'routing/app' || clean === 'routing-app') return { tab: 'routing', branch: 'app' };
  if (clean === 'routing/ext' || clean === 'routing-ext') return { tab: 'routing', branch: 'ext' };
  const map: Record<string, string> = {
    'routing': 'routing',
    'proxy-settings': 'proxy-settings',
    'proxies': 'proxy-settings',
    'rotation': 'proxy-settings',
    'extension-builder': 'builder',
    'builder': 'builder',
    'app-studio': 'app-studio',
    'fleet': 'instances',
    'instances': 'instances',
    'gpo': 'gpo',
    'releases': 'releases',
    'logs': 'logs',
    'audit': 'logs'
  };
  const t = map[clean];
  return t ? { tab: t } : null;
}

export function initHashRouting() {
  if (typeof window === 'undefined' || !window.location) return;
  const parsed = getTabNameFromHash(window.location.hash);
  if (parsed) {
    switchTab(parsed.tab, true);
    if (parsed.branch && typeof studio.switchRoutingBranch === 'function') {
      studio.switchRoutingBranch(parsed.branch);
    }
  }
  if (!(window as any)._pecHashListenerBound) {
    (window as any)._pecHashListenerBound = true;
    window.addEventListener('hashchange', function() {
      const m = getTabNameFromHash(window.location.hash);
      if (m) {
        switchTab(m.tab, true);
        if (m.branch && typeof studio.switchRoutingBranch === 'function') {
          studio.switchRoutingBranch(m.branch);
        }
      }
    });
  }
}

export function initTabsAccessibility() {
  const nav = document.querySelector('.tabs-nav') as any;
  if (!nav || nav._a11yBound) return;
  nav._a11yBound = true;
  nav.addEventListener('keydown', function(e: KeyboardEvent) {
    const tabs = Array.from(nav.querySelectorAll('.tab-btn')) as HTMLElement[];
    const activeIdx = tabs.indexOf(document.activeElement as HTMLElement);
    if (activeIdx === -1) return;

    let nextIdx = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      nextIdx = (activeIdx + 1) % tabs.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      nextIdx = (activeIdx - 1 + tabs.length) % tabs.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      nextIdx = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      nextIdx = tabs.length - 1;
    }

    if (nextIdx !== -1) {
      const nextTab = tabs[nextIdx];
      nextTab.focus();
      nextTab.click();
    }
  });
}

export function switchTab(name: string, skipHashUpdate: boolean = false) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
    b.tabIndex = -1;
  });
  document.querySelectorAll('.tab-pane').forEach(p => { p.classList.remove('active'); });

  let targetId = 'tab-' + name;
  if (!document.getElementById(targetId)) {
    if (name === 'rotation') targetId = 'tab-proxy-settings';
    else if (name === 'proxy-settings') targetId = 'tab-rotation';
    else if (name === 'fleet') targetId = 'tab-instances';
    else if (name === 'instances') targetId = 'tab-fleet';
  }
  const pane = document.getElementById(targetId);
  if (pane) pane.classList.add('active');

  const btn = Array.from(document.querySelectorAll('.tab-btn')).find(b => {
    const dt = b.getAttribute('data-tab') || '';
    const oc = b.getAttribute('onclick') || '';
    const id = b.id || '';
    return dt === name || oc.includes(name) ||
      ((name === 'rotation' || name === 'proxy-settings') && (dt === 'proxy-settings' || oc.includes('rotation') || oc.includes('proxy-settings'))) ||
      ((name === 'fleet' || name === 'instances') && (dt === 'instances' || oc.includes('fleet') || oc.includes('instances') || id === 'tabBtnInstances' || id === 'tab-instances' || id === 'tabBtnFleet'));
  }) as HTMLElement | undefined;
  if (btn) {
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    btn.tabIndex = 0;
  }

  // Sync active tab with location.hash for deep linking and back/forward navigation (WEB-01)
  if (!skipHashUpdate && TAB_HASH_MAP[name] && typeof window !== 'undefined' && window.location) {
    const targetHash = TAB_HASH_MAP[name];
    if (window.location.hash !== targetHash) {
      try {
        if (window.history && window.history.pushState) {
          window.history.pushState(null, '', targetHash);
        } else {
          window.location.hash = targetHash;
        }
      } catch (_) {
        try { window.location.hash = targetHash; } catch (__) {}
      }
    }
  }

  if (name === 'instances' || name === 'fleet') {
    telemetry.loadInstances();
  } else if (name === 'proxy-settings' || name === 'rotation') {
    proxies.fetchProxies();
    if (typeof telemetry.load3xuiPanels === 'function') telemetry.load3xuiPanels();
  } else if (name === 'app-studio') {
    if (!studio.currentAppConfig || !studio.isAppStudioDirty) studio.loadAppStudioConfig();
  } else if (name === 'releases') {
    telemetry.loadReleases();
  } else if (name === 'logs' || name === 'audit') {
    telemetry.fetchStatus();
  } else if (name === 'builder') {
    studio.loadBuilderConfig();
    telemetry.fetchExtensionInfo();
  } else if (name === 'routing') {
    if (!state.currentProfile) routing.loadProfiles();
  }
}

export function bootDashboard() {
  initTabsAccessibility();
  notify.initModalBackdropHandlers();
  initHashRouting();
  refreshAll(true);
  startDashboardTimers(() => telemetry.fetchStatus(), () => telemetry.loadInstances());
}

export async function refreshAll(isInitialBoot: boolean = false) {
  if (!isInitialBoot && (state.hasUnsavedRouting || studio.isAppStudioDirty)) {
    const isRu = state.currentLang === 'ru';
    const ok = await notify.pecConfirm({
      title: isRu ? 'Несохраненные изменения' : 'Unsaved Changes',
      message: isRu
        ? 'У вас есть несохраненные изменения. Обновить данные с сервера и сбросить правки?'
        : 'You have unsaved changes. Refresh from server and discard modifications?',
      isDanger: true
    });
    if (!ok) return;
    routing.setUnsavedRouting(false);
    studio.setIsAppStudioDirty(false);
  }

  try {
    const savedLayout = localStorage.getItem('pec_server_layout') || 'console';
    theme.setServerLayout(savedLayout);
    const savedTheme = localStorage.getItem('pec_server_theme') || 'cyber';
    theme.setServerTheme(savedTheme);
    const savedMode = localStorage.getItem('pec_server_theme_mode') || 'dark';
    theme.setServerThemeMode(savedMode);
    const savedIcon = localStorage.getItem('pec_global_brand_icon') || 'shield';
    theme.setGlobalBrandIconSource(savedIcon);
    const savedLang = localStorage.getItem('pec_lang') || 'ru';
    theme.setLanguage(savedLang);
    theme.applyThemeSyncToConstructors();
  } catch (e) {}

  telemetry.fetchStatus();
  routing.loadPresets();
  routing.loadProfiles();
  studio.loadBuilderConfig();
  studio.loadAppStudioConfig();
  studio.loadExtensionFiles();
  telemetry.fetchFleet();
  telemetry.fetchExtensionInfo();
  telemetry.fetchRotationConfig();
  proxies.fetchProxies();
  proxies.fetchProxyConfig();
  telemetry.load3xuiPanels();
  telemetry.loadReleases();
}

// Attach all functions to window for backwards compatibility with inline HTML and tests
if (typeof window !== 'undefined') {
  const win = window as any;

  // Tabs & Navigation
  win.switchTab = switchTab;
  win.refreshAll = refreshAll;
  win.bootDashboard = bootDashboard;
  win.initHashRouting = initHashRouting;
  win.initTabsAccessibility = initTabsAccessibility;

  // Assign APIs
  Object.assign(win, api);
  Object.assign(win, notify);
  Object.assign(win, theme);
  Object.assign(win, proxies);
  Object.assign(win, routing);
  Object.assign(win, studio);
  Object.assign(win, telemetry);

  // Tab pause/resume on visibility change
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      stopDashboardTimers();
    } else {
      const screen = document.getElementById('authScreen');
      const isAuthVisible = screen && screen.style.display !== 'none';
      if (!isAuthVisible && state.isDashboardAuthenticated) {
        startDashboardTimers(() => telemetry.fetchStatus(), () => telemetry.loadInstances());
        telemetry.loadInstances();
        telemetry.fetchStatus();
      }
    }
  });

  // Global click feedback handler
  document.addEventListener('click', function(e: any) {
    const btn = e.target.closest('button, .btn, .tab-btn, .studio-layout-btn, .studio-mode-btn, .preset-chip');
    if (!btn) return;
    btn.classList.remove('btn-clicked');
    void btn.offsetWidth; // trigger reflow
    btn.classList.add('btn-clicked');
    setTimeout(() => {
      btn.classList.remove('btn-clicked');
    }, 400);
  });

  // Beforeunload dirty warning
  window.addEventListener('beforeunload', function (e: any) {
    if (state.hasUnsavedRouting || studio.isAppStudioDirty) {
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  });

  // Bootstrap authentication
  (async function initAuth() {
    try {
      const savedLayout = localStorage.getItem('pec_server_layout') || 'console';
      theme.setServerLayout(savedLayout);
      const savedTheme = localStorage.getItem('pec_server_theme') || 'cyber';
      theme.setServerTheme(savedTheme);
      const savedMode = localStorage.getItem('pec_server_theme_mode') || 'dark';
      theme.setServerThemeMode(savedMode);
      const savedIcon = localStorage.getItem('pec_global_brand_icon') || 'shield';
      theme.setGlobalBrandIconSource(savedIcon);
      const savedLang = localStorage.getItem('pec_lang') || 'ru';
      theme.setLanguage(savedLang);
      theme.applyThemeSyncToConstructors();
    } catch (e) {}

    const loginBtn = document.getElementById('loginSubmitBtn');
    const loginInput = document.getElementById('loginTokenInput');
    const loginUser = document.getElementById('loginUsernameInput');
    if (loginBtn) loginBtn.addEventListener('click', api.handleLoginSubmit);
    if (loginInput) loginInput.addEventListener('keydown', function (e: any) { if (e.key === 'Enter') api.handleLoginSubmit(); });
    if (loginUser) loginUser.addEventListener('keydown', function (e: any) { if (e.key === 'Enter') (document.getElementById('loginTokenInput') as HTMLElement)?.focus(); });
    const logoutBtn = document.getElementById('btnLogout');
    if (logoutBtn) logoutBtn.addEventListener('click', api.logoutDashboard);

    // Account settings
    const openCreds = document.getElementById('btnOpenCredsModal');
    const credSubmit = document.getElementById('credSubmitBtn');
    const credCancel = document.getElementById('credCancelBtn');
    const credPass = document.getElementById('credCurrentPassword');
    if (openCreds) openCreds.addEventListener('click', api.openCredsModal);
    if (credSubmit) credSubmit.addEventListener('click', api.submitCredsChange);
    if (credCancel) credCancel.addEventListener('click', () => {
      const modal = document.getElementById('modalChangeCreds');
      if (modal) modal.style.display = 'none';
    });
    if (credPass) credPass.addEventListener('keydown', function (e: any) { if (e.key === 'Enter') api.submitCredsChange(); });

    // 3x-ui Panels registry modal buttons
    const btnOpenPanel = document.getElementById('btnOpenAdd3xuiPanel');
    if (btnOpenPanel) btnOpenPanel.addEventListener('click', () => telemetry.openAdd3xuiPanelModal());
    const btnSavePanel = document.getElementById('btnSave3xuiPanel');
    if (btnSavePanel) btnSavePanel.addEventListener('click', telemetry.save3xuiPanelAction);
    const btnCancelPanel = document.getElementById('btnCancel3xuiPanel');
    if (btnCancelPanel) btnCancelPanel.addEventListener('click', telemetry.close3xuiPanelModal);

    // 3x-ui Panels table actions delegation
    document.addEventListener('click', function(e: any) {
      const testBtn = e.target.closest('.btn-test-panel');
      if (testBtn) {
        const id = testBtn.getAttribute('data-id');
        if (id) telemetry.test3xuiPanelAction(id);
        return;
      }
      const editBtn = e.target.closest('.btn-edit-panel');
      if (editBtn) {
        const id = editBtn.getAttribute('data-id');
        const panel = telemetry.currentPanelsList?.find((p: any) => p.id === id);
        if (panel) telemetry.openAdd3xuiPanelModal(panel);
        return;
      }
      const delBtn = e.target.closest('.btn-delete-panel');
      if (delBtn) {
        const id = delBtn.getAttribute('data-id');
        if (id) telemetry.delete3xuiPanelAction(id);
        return;
      }
    });

    // Proxy form interactive validation
    const protoInput = document.getElementById('proxyFormProtocol') as HTMLSelectElement | null;
    if (protoInput) {
      protoInput.addEventListener('change', function() {
        const portEl = document.getElementById('proxyFormPort') as HTMLInputElement | null;
        if (portEl && (portEl.value === '10808' || portEl.value === '10809')) {
          portEl.value = protoInput.value === 'http' ? '10809' : '10808';
        }
        proxies.checkSocksAuthWarning();
      });
    }

    // Setup Step 1 & 2 Event Listeners
    const btnVerify = document.getElementById('btnAuthVerifyToken');
    if (btnVerify) btnVerify.addEventListener('click', api.handleAuthVerifyToken);
    const tokenInp = document.getElementById('authTokenInput');
    if (tokenInp) tokenInp.addEventListener('keydown', function(e: any) { if (e.key === 'Enter') api.handleAuthVerifyToken(); });

    const btnSaveCreds = document.getElementById('btnAuthSaveCredentials');
    if (btnSaveCreds) btnSaveCreds.addEventListener('click', api.handleAuthSaveCredentials);
    const passConfInp = document.getElementById('authNewPasswordConfirm');
    if (passConfInp) passConfInp.addEventListener('keydown', function(e: any) { if (e.key === 'Enter') api.handleAuthSaveCredentials(); });

    // First entry: check auth status
    try {
      const res = await fetch('/api/auth/status', { credentials: 'same-origin' });
      const data = await res.json();
      if (data && data.authenticated) {
        api.hideAuthScreen();
        bootDashboard();
        return;
      }
      if (data && data.setupRequired) {
        api.showAuthStep('token');
        return;
      }
    } catch (e) {
      console.warn('Auth status check failed:', e);
    }
    api.showAuthStep('login');
  })();
}
