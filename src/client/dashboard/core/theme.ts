// Themes, Layouts & Localization Module for PEC Dashboard
// Theme Invariant: 100% parity with client/Windows/gui/pec_imgui_theme.h
import { state } from './state.js';
import { I18N } from './i18n.js';

export { I18N };

export interface ThemePalette {
  accent: string;
  bg: string;
  card: string;
  lightBg: string;
  lightCard: string;
  style: string;
}

export const APP_PALETTES: Record<string, ThemePalette> = {
  cyber: { accent: '#38bdf8', bg: '#0b1120', card: '#131d36', lightBg: '#f0f9ff', lightCard: '#ffffff', style: 'cyber-blue' },
  obsidian: { accent: '#c084fc', bg: '#0d1117', card: '#161b22', lightBg: '#faf5ff', lightCard: '#ffffff', style: 'dark-obsidian' },
  nord: { accent: '#88c0d0', bg: '#242933', card: '#2e3440', lightBg: '#f8fafc', lightCard: '#ffffff', style: 'nordic-arctic' },
  emerald: { accent: '#34d399', bg: '#06130d', card: '#0b1f16', lightBg: '#f0fdf4', lightCard: '#ffffff', style: 'emerald-secops' },
  amber: { accent: '#f59e0b', bg: '#1c1307', card: '#261805', lightBg: '#fffbeb', lightCard: '#ffffff', style: 'sunset-amber' },
  sunset: { accent: '#f59e0b', bg: '#1c1307', card: '#261805', lightBg: '#fffbeb', lightCard: '#ffffff', style: 'sunset-amber' },
  light: { accent: '#2563eb', bg: '#0b1120', card: '#131d36', lightBg: '#f1f5f9', lightCard: '#ffffff', style: 'enterprise-light' }
};

export const APP_THEME_PRESETS: Record<string, { accent: string; bg: string; card: string; badge: string; palette: string }> = {
  'cyber-blue': { accent: '#38bdf8', bg: '#0b1120', card: '#131d36', badge: 'Cyber Blue', palette: 'cyber' },
  'dark-obsidian': { accent: '#c084fc', bg: '#0d1117', card: '#161b22', badge: 'Dark Obsidian', palette: 'obsidian' },
  'nordic-arctic': { accent: '#88c0d0', bg: '#242933', card: '#2e3440', badge: 'Nordic Arctic', palette: 'nord' },
  'emerald-secops': { accent: '#34d399', bg: '#06130d', card: '#0b1f16', badge: 'Emerald SecOps', palette: 'emerald' },
  'sunset-amber': { accent: '#f59e0b', bg: '#1c1307', card: '#261805', badge: 'Sunset Amber', palette: 'amber' },
  'amber': { accent: '#f59e0b', bg: '#1c1307', card: '#261805', badge: 'Sunset Amber', palette: 'amber' },
  'enterprise-light': { accent: '#2563eb', bg: '#f1f5f9', card: '#ffffff', badge: 'Enterprise Light', palette: 'light' }
};

export function setServerLayout(layout: string) {
  if (layout !== 'terminal' && layout !== 'console') {
    layout = 'console';
  }
  document.body.setAttribute('data-layout', layout);
  try { localStorage.setItem('pec_server_layout', layout); } catch (_) {}
  updateModalActiveState();
}

export function setServerTheme(theme: string) {
  if (!theme) theme = 'cyber';
  document.body.setAttribute('data-theme', theme);
  try { localStorage.setItem('pec_server_theme', theme); } catch (_) {}
  updateModalActiveState();
  if (isThemeSyncEnabled()) {
    applyThemeSyncToConstructors();
  }
}

export function setServerThemeMode(mode: string) {
  if (mode !== 'light' && mode !== 'dark') mode = 'dark';
  document.body.setAttribute('data-theme-mode', mode);
  try { localStorage.setItem('pec_server_theme_mode', mode); } catch (_) {}
  updateModalActiveState();
  if (isThemeSyncEnabled()) {
    applyThemeSyncToConstructors();
  }
}

export function updateModalActiveState() {
  const currentLayout = document.body.getAttribute('data-layout') || 'console';
  const currentTheme = document.body.getAttribute('data-theme') || 'cyber';
  const currentMode = document.body.getAttribute('data-theme-mode') || 'dark';

  const darkBtn = document.getElementById('optModeDarkCard');
  const lightBtn = document.getElementById('optModeLightCard');
  if (darkBtn && lightBtn) {
    if (currentMode === 'light') {
      lightBtn.classList.add('active');
      darkBtn.classList.remove('active');
    } else {
      darkBtn.classList.add('active');
      lightBtn.classList.remove('active');
    }
  }

  const consoleCard = document.getElementById('optLayoutConsoleCard');
  const terminalCard = document.getElementById('optLayoutTerminalCard');
  if (consoleCard && terminalCard) {
    if (currentLayout === 'console') {
      consoleCard.classList.add('active');
      terminalCard.classList.remove('active');
    } else {
      terminalCard.classList.add('active');
      consoleCard.classList.remove('active');
    }
  }

  const themeBtns: Record<string, HTMLElement | null> = {
    cyber: document.getElementById('btnThemeCyber'),
    obsidian: document.getElementById('btnThemeObsidian'),
    nord: document.getElementById('btnThemeNord'),
    emerald: document.getElementById('btnThemeEmerald'),
    light: document.getElementById('btnThemeLight'),
  };
  Object.keys(themeBtns).forEach((k) => {
    const btn = themeBtns[k];
    if (btn) {
      if (k === currentTheme) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });
}

export function openCustomizationPopover() {
  const popover = document.getElementById('popoverCustomization');
  if (!popover) return;
  updateModalActiveState();
  popover.style.display = popover.style.display === 'none' || !popover.style.display ? 'block' : 'none';
}

export function closeCustomizationPopover() {
  const popover = document.getElementById('popoverCustomization');
  if (popover) popover.style.display = 'none';
}

export function isThemeSyncEnabled(): boolean {
  try {
    const stored = localStorage.getItem('pec_theme_sync_enabled');
    return stored === null ? true : stored === 'true';
  } catch (_) {
    return true;
  }
}

export function setThemeSyncEnabled(enabled: boolean) {
  try {
    localStorage.setItem('pec_theme_sync_enabled', enabled ? 'true' : 'false');
  } catch (_) {}
  applyThemeSyncToConstructors();
}

export function setGlobalBrandIcon(icon: string) {
  if (!icon) icon = 'shield';
  try { localStorage.setItem('pec_global_brand_icon', icon); } catch (_) {}
  applyThemeSyncToConstructors();
}

export function setGlobalBrandIconSource(source: string) {
  if (source !== 'custom') source = 'preset';
  try { localStorage.setItem('pec_global_brand_icon_mode', source); } catch (_) {}
  const btnPreset = document.getElementById('optBrandIconPreset');
  const btnCustom = document.getElementById('optBrandIconCustom');
  const boxPreset = document.getElementById('boxBrandIconPreset');
  const boxCustom = document.getElementById('boxBrandIconCustom');
  if (btnPreset) btnPreset.classList.toggle('active', source === 'preset');
  if (btnCustom) btnCustom.classList.toggle('active', source === 'custom');
  if (boxPreset) boxPreset.style.display = source === 'preset' ? 'block' : 'none';
  if (boxCustom) boxCustom.style.display = source === 'custom' ? 'block' : 'none';

  if (source === 'custom' && !state.currentGlobalBrandCustomDataUrl) {
    const fileInput = document.getElementById('globalBrandIconFileInput') as HTMLInputElement | null;
    if (fileInput) fileInput.click();
  }
  applyThemeSyncToConstructors();
}

export function setGlobalBrandCustomIcon(dataUrl: string, isUploaded = false, triggerSync = true) {
  state.currentGlobalBrandCustomDataUrl = dataUrl || '';
  state.isGlobalBrandCustomUploaded = Boolean(isUploaded && dataUrl);
  try {
    if (state.isGlobalBrandCustomUploaded) {
      localStorage.setItem('pec_global_brand_custom_data_url', state.currentGlobalBrandCustomDataUrl);
    } else {
      localStorage.removeItem('pec_global_brand_custom_data_url');
    }
  } catch (_) {}

  const gBox = document.getElementById('globalBrandCustomPreviewBox');
  const gImg = document.getElementById('globalBrandCustomPreviewImg') as HTMLImageElement | null;
  if (gBox && gImg) {
    if (state.currentGlobalBrandCustomDataUrl) {
      gImg.src = state.currentGlobalBrandCustomDataUrl;
      gBox.style.display = 'block';
    } else {
      gBox.style.display = 'none';
    }
  }
  if (triggerSync) {
    applyThemeSyncToConstructors();
  }
}

export function onGlobalBrandIconFileSelected(e: Event) {
  const input = e.target as HTMLInputElement;
  if (!input || !input.files || !input.files[0]) return;
  const file = input.files[0];
  const reader = new FileReader();
  reader.onload = (evt) => {
    const dataUrl = evt.target && (evt.target.result as string);
    if (!dataUrl) return;
    setGlobalBrandCustomIcon(dataUrl, true, true);
  };
  reader.readAsDataURL(file);
}

export function clearGlobalBrandCustomIcon() {
  setGlobalBrandCustomIcon('', false, true);
  const fileInput = document.getElementById('globalBrandIconFileInput') as HTMLInputElement | null;
  if (fileInput) fileInput.value = '';
}

export function applyThemeSyncToConstructors() {
  const syncEnabled = isThemeSyncEnabled();
  const chk = document.getElementById('chkSyncThemeWithApps') as HTMLInputElement | null;
  if (chk && chk.checked !== syncEnabled) {
    chk.checked = syncEnabled;
  }

  const currentTheme = document.body.getAttribute('data-theme') || 'cyber';
  const currentMode = document.body.getAttribute('data-theme-mode') || 'dark';
  const currentIcon = localStorage.getItem('pec_global_brand_icon') || 'shield';
  const globalCustomPng = localStorage.getItem('pec_global_brand_custom_data_url') || state.currentGlobalBrandCustomDataUrl || '';
  const iconSourceMode = localStorage.getItem('pec_global_brand_icon_mode') || (globalCustomPng ? 'custom' : 'preset');

  const btnPreset = document.getElementById('optBrandIconPreset');
  const btnCustom = document.getElementById('optBrandIconCustom');
  const boxPreset = document.getElementById('boxBrandIconPreset');
  const boxCustom = document.getElementById('boxBrandIconCustom');
  if (btnPreset) btnPreset.classList.toggle('active', iconSourceMode === 'preset');
  if (btnCustom) btnCustom.classList.toggle('active', iconSourceMode === 'custom');
  if (boxPreset) boxPreset.style.display = iconSourceMode === 'preset' ? 'block' : 'none';
  if (boxCustom) boxCustom.style.display = iconSourceMode === 'custom' ? 'block' : 'none';

  const isCustomActive = iconSourceMode === 'custom' && Boolean(globalCustomPng);

  const iconMapEmoji: Record<string, string> = {
    shield: '🛡️',
    network: '🌐',
    terminal: '💻',
    lock: '🔒',
    rocket: '🚀'
  };

  const dashBrandIcon = document.getElementById('dashboardBrandIcon');
  if (dashBrandIcon) {
    if (isCustomActive) {
      dashBrandIcon.innerHTML = `<img src="${globalCustomPng}" style="width: 24px; height: 24px; border-radius: 4px; vertical-align: middle; object-fit: contain;" alt="logo" />`;
    } else {
      dashBrandIcon.textContent = iconMapEmoji[currentIcon] || '🛡️';
    }
  }

  const globalIconSelect = document.getElementById('globalBrandIconSelect') as HTMLSelectElement | null;
  if (globalIconSelect && globalIconSelect.value !== currentIcon) {
    globalIconSelect.value = currentIcon;
  }

  // Lock banners in builder and studio
  const bLock = document.getElementById('builderThemeLockedNotice');
  const aLock = document.getElementById('appThemeLockedNotice');
  if (bLock) bLock.style.display = syncEnabled ? 'block' : 'none';
  if (aLock) aLock.style.display = syncEnabled ? 'block' : 'none';

  const bCard = document.getElementById('builderThemeCardContainer');
  const aCard = document.getElementById('appThemeCardContainer');
  if (bCard) bCard.classList.toggle('locked-by-sync', syncEnabled);
  if (aCard) aCard.classList.toggle('locked-by-sync', syncEnabled);
}

export function t(key: string, fallback?: string): string {
  const dict = I18N[state.currentLang] || {};
  return dict[key] || fallback || key;
}

export function setLanguage(lang: string) {
  const currentLang = (lang === 'en' || lang === 'ru') ? lang : 'ru';
  state.currentLang = currentLang;
  if (typeof window !== 'undefined') (window as any).currentLang = currentLang;
  if (document.documentElement) {
    document.documentElement.lang = currentLang;
  }
  try { localStorage.setItem('pec_lang', currentLang); } catch (_) {}

  const btnEn = document.getElementById('btnLangEn');
  const btnRu = document.getElementById('btnLangRu');
  if (btnEn && btnRu) {
    if (currentLang === 'en') {
      btnEn.classList.add('active');
      btnRu.classList.remove('active');
    } else {
      btnRu.classList.add('active');
      btnEn.classList.remove('active');
    }
  }

  const modalRu = document.getElementById('modalLangRu');
  const modalEn = document.getElementById('modalLangEn');
  if (modalRu && modalEn) {
    if (currentLang === 'ru') {
      modalRu.className = 'btn';
      modalEn.className = 'btn-secondary';
    } else {
      modalEn.className = 'btn';
      modalRu.className = 'btn-secondary';
    }
  }

  const dict = I18N[currentLang] || {};

  // Update all elements with data-i18n attributes
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key && dict[key]) {
      if (dict[key].includes('<')) {
        el.innerHTML = dict[key];
      } else {
        const icon = el.querySelector('img.icon-inline, svg');
        if (icon) {
          const clone = icon.cloneNode(true);
          el.innerHTML = '';
          el.appendChild(clone);
          el.appendChild(document.createTextNode(' ' + dict[key]));
        } else {
          el.textContent = dict[key];
        }
      }
    }
  });

  // Update placeholders with data-i18n-ph attributes
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
    const key = el.getAttribute('data-i18n-ph');
    if (key && dict[key]) {
      el.setAttribute('placeholder', dict[key]);
    }
  });

  // Update titles with data-i18n-title attributes
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (key && dict[key]) {
      el.setAttribute('title', dict[key]);
    }
  });

  // Update elements by ID if present in dictionary
  for (const key in dict) {
    const el = document.getElementById(key);
    if (el && !el.hasAttribute('data-i18n')) {
      if (dict[key].includes('<')) {
        el.innerHTML = dict[key];
      } else {
        el.textContent = dict[key];
      }
    }
  }

  const btnKill = document.getElementById('btnKillSwitch');
  if (btnKill) {
    btnKill.textContent = state.globalKillSwitch ? dict.btnKillSwitchOn : dict.btnKillSwitchOff;
  }
}
