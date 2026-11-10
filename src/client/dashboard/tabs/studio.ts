// Extension Constructor Studio & App Studio Tab Module for PEC Dashboard
import { state } from '../core/state.js';
import { adminFetch, esc, escapeHtml, extractError } from '../core/api.js';
import { toast, pecConfirm, pecPrompt, registerModalCloser } from '../core/notify.js';
import { t, applyThemeSyncToConstructors, closeCustomizationPopover } from '../core/theme.js';

declare let currentLang: string;
if (typeof window !== 'undefined' && !('currentLang' in window)) {
  Object.defineProperty(window, 'currentLang', {
    get() { return state.currentLang || 'ru'; },
    set(v) { state.currentLang = v; },
    configurable: true
  });
}

declare let currentProfile: any;
if (typeof window !== 'undefined' && !('currentProfile' in window)) {
  Object.defineProperty(window, 'currentProfile', {
    get() { return state.currentProfile; },
    set(v) { state.currentProfile = v; },
    configurable: true
  });
}

    // ----------------- Extension Constructor Studio & Live Sandbox -----------------
export let liveSimState = {
      online: true,
      bypassActive: false,
      protocol: 'socks5',
      host: 'xray-gateway.corp.local',
      port: 10808,
      profileName: 'Corporate AI + Intranet Policy',
      appliedProfileId: 'prof_default',
      exitIp: '198.51.100.42',
      ipLocation: 'Frankfurt, DE (Corp Direct Egress)',
      lastSyncTime: new Date().toLocaleTimeString(),
      status: 'Active'
    };

    let builderDebounceTimer = null;
    let codeEditorDebounceTimer = null;
export let activeTemplatePreset = 'self-service-pro';
export let activeStylePreset = 'cyber-blue';
export let activeStudioLayout = 'console';
export let activeStudioPalette = 'cyber';
export let activeStudioThemeMode = 'dark';

    export function setStudioLayout(layout, silent = false) {
      if (layout !== 'terminal' && layout !== 'console') {
        layout = 'console';
      }
      activeStudioLayout = layout;

      const btnConsole = document.getElementById('btnStudioLayoutConsole');
      const btnTerminal = document.getElementById('btnStudioLayoutTerminal');
      if (btnConsole) btnConsole.classList.toggle('active', layout === 'console');
      if (btnTerminal) btnTerminal.classList.toggle('active', layout === 'terminal');

      const previewBox = document.getElementById('popupFrameBox');
      if (previewBox) {
        previewBox.setAttribute('data-layout', layout);
        previewBox.style.borderRadius = layout === 'terminal' ? '0px' : '12px';
      }

      updateLivePreviewThemeAndLayout();
      updateLivePreview();
      if (!silent) onConfigChangeLive();
    }

    export function setStudioPalette(palette, silent = false) {
      const validPalettes = ['cyber', 'obsidian', 'nord', 'emerald', 'light'];
      if (!validPalettes.includes(palette)) {
        palette = 'cyber';
      }
      activeStudioPalette = palette;

      validPalettes.forEach(p => {
        const el = document.getElementById('chip-palette-' + p);
        if (el) el.classList.toggle('active', p === palette);
      });

      const paletteToBrandColor = {
        cyber: '#38bdf8',
        obsidian: '#c084fc',
        nord: '#88c0d0',
        emerald: '#34d399',
        light: '#2563eb'
      };
      const brandColorInput = document.getElementById('bldThemeColor');
      if (brandColorInput && paletteToBrandColor[palette]) {
        brandColorInput.value = paletteToBrandColor[palette];
      }

      updateLivePreviewThemeAndLayout();
      updateLivePreview();
      if (!silent) onConfigChangeLive();
    }

    export function setStudioThemeMode(mode, silent = false) {
      if (mode !== 'light' && mode !== 'dark') {
        mode = 'dark';
      }
      activeStudioThemeMode = mode;

      const btnDark = document.getElementById('btnStudioModeDark');
      const btnLight = document.getElementById('btnStudioModeLight');
      if (btnDark) btnDark.classList.toggle('active', mode === 'dark');
      if (btnLight) btnLight.classList.toggle('active', mode === 'light');

      updateLivePreviewThemeAndLayout();
      updateLivePreview();
      if (!silent) onConfigChangeLive();
    }

    export function updateLivePreviewThemeAndLayout() {
      const iframe = document.getElementById('previewFrame');
      if (iframe && iframe.contentWindow) {
        try {
          const currentVersionVal = (document.getElementById('bldVersion') && document.getElementById('bldVersion').value.trim()) || '1.0.0';
          iframe.contentWindow.postMessage({
            type: 'UPDATE_STUDIO_THEME',
            palette: activeStudioPalette,
            layout: activeStudioLayout,
            themeMode: activeStudioThemeMode
          }, '*');
          iframe.contentWindow.postMessage({
            type: 'UPDATE_STUDIO_VERSION',
            version: currentVersionVal
          }, '*');
        } catch (e) {}
      }
    }

    window.setStudioLayout = setStudioLayout;
    window.setStudioPalette = setStudioPalette;
    window.setStudioThemeMode = setStudioThemeMode;

export let currentCustomIconDataUrl = '';
export let isCustomIconUploaded = false;

    export function setCustomIconDataUrl(dataUrl, isUploaded = false, triggerSave = false) {
      currentCustomIconDataUrl = dataUrl || '';
      isCustomIconUploaded = Boolean(isUploaded);
      const previewBox = document.getElementById('customIconPreviewBox');
      const previewImg = document.getElementById('customIconPreviewImg');
      if (currentCustomIconDataUrl && isCustomIconUploaded) {
        if (previewImg) previewImg.src = currentCustomIconDataUrl;
        if (previewBox) previewBox.style.display = 'inline-flex';
      } else {
        if (previewImg) previewImg.src = '';
        if (previewBox) previewBox.style.display = 'none';
        const fileInput = document.getElementById('iconFileInput');
        if (fileInput) fileInput.value = '';
      }
      if (triggerSave) {
        onConfigChangeLive();
      }
      updateLivePreview();
    }

    window.clearCustomIcon = function() {
      setCustomIconDataUrl('', false, true);
    };

    window.onIconFileSelected = function(e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(evt) {
        const rawUrl = evt.target.result;
        const img = new Image();
        img.onload = function() {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = 128;
            canvas.height = 128;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, 128, 128);
            const pngDataUrl = canvas.toDataURL('image/png');
            setCustomIconDataUrl(pngDataUrl, true, true);
          } catch (err) {
            setCustomIconDataUrl(rawUrl, true, true);
          }
        };
        img.onerror = function() {
          setCustomIconDataUrl(rawUrl, true, true);
        };
        img.src = rawUrl;
      };
      reader.readAsDataURL(file);
    };

    export function getEmojiIconDataUrl() {
      try {
        const emojiEl = document.getElementById('bldEmoji');
        const emoji = (emojiEl ? emojiEl.value : '🛡️').trim() || '🛡️';
        const colorEl = document.getElementById('bldThemeColor');
        const themeColor = (colorEl ? colorEl.value : '#00f0ff').trim() || '#00f0ff';
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        if (!ctx) return '';

        const bgEl = document.getElementById('bldThemeBg') || document.getElementById('bldThemeBackground') || document.getElementById('appThemeBackground');
        const themeBg = (bgEl && bgEl.value) ? bgEl.value.trim() : '#0a1020';

        // Rounded rect background
        const rad = 28;
        ctx.fillStyle = themeBg;
        ctx.beginPath();
        ctx.moveTo(rad, 0);
        ctx.lineTo(128 - rad, 0);
        ctx.quadraticCurveTo(128, 0, 128, rad);
        ctx.lineTo(128, 128 - rad);
        ctx.quadraticCurveTo(128, 128, 128 - rad, 128);
        ctx.lineTo(rad, 128);
        ctx.quadraticCurveTo(0, 128, 0, 128 - rad);
        ctx.lineTo(0, rad);
        ctx.quadraticCurveTo(0, 0, rad, 0);
        ctx.closePath();
        ctx.fill();

        // Border in primary theme color
        ctx.lineWidth = 4;
        ctx.strokeStyle = themeColor;
        ctx.stroke();

        // Centered emoji
        ctx.font = '68px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(emoji, 64, 70);

        return canvas.toDataURL('image/png');
      } catch (_) {
        return '';
      }
    }

    export async function loadBuilderConfig() {
      try {
        const res = await adminFetch('/api/builder/config');
        if (!res.ok) return;
        const cfg = await res.json();
        
        document.getElementById('bldName').value = cfg.name || 'Corp Proxy Auth & Sync';
        document.getElementById('bldShortName').value = cfg.shortName || 'CorpProxy';
        document.getElementById('bldVersion').value = cfg.version || '1.2.0';
        document.getElementById('bldUiMode').value = cfg.uiMode || 'popup';
        const iconTypeEl = document.getElementById('bldIconType');
        if (iconTypeEl) iconTypeEl.value = cfg.iconType || 'shield';
        document.getElementById('bldThemeColor').value = cfg.themeColor || '#0284c7';
        document.getElementById('bldEmoji').value = cfg.iconEmoji || '🛡️';
        if (cfg.customIconDataUrl) {
          setCustomIconDataUrl(cfg.customIconDataUrl, true, false);
        } else {
          setCustomIconDataUrl('', false, false);
        }
        document.getElementById('bldDesc').value = cfg.description || 'Enterprise Chrome extension for automatic proxy synchronization';
        const srvInput = document.getElementById('bldServerUrl');
        if (srvInput) {
          srvInput.value = (cfg.defaultServerUrl && !cfg.defaultServerUrl.includes('update.example.com'))
            ? cfg.defaultServerUrl
            : window.location.origin;
        }
        const updInput = document.getElementById('bldUpdateUrl');
        if (updInput) {
          updInput.value = cfg.updateUrl || '';
        }
        document.getElementById('bldSyncInterval').value = cfg.syncIntervalMinutes || 15;
        document.getElementById('bldWebRtc').checked = cfg.webRtcProtection !== false;
        document.getElementById('bldDnsGuard').checked = cfg.dnsLeakProtection !== false;
        if (document.getElementById('bldBadge')) document.getElementById('bldBadge').checked = cfg.badgeIndicator !== false;
        document.getElementById('bldAutoProxy').checked = cfg.autoConfigureProxy !== false;
        if (document.getElementById('bldAllowBypass')) document.getElementById('bldAllowBypass').checked = cfg.allowUserBypass !== false;
        if (document.getElementById('bldIpGeo')) {
          document.getElementById('bldIpGeo').checked = (cfg.showIpGeoChecker !== false && cfg.showIpGeoCheck !== false);
        }
        document.getElementById('bldBypassTimeout').value = cfg.bypassAutoTimeoutMinutes || cfg.bypassTimeoutMinutes || 15;
        document.getElementById('bldSupportUrl').value = cfg.supportUrl || 'mailto:it-support@corp.local';

        const defProxyEl = document.getElementById('builderDefaultProxyId');
        if (defProxyEl) {
          if (!currentProxiesList || !currentProxiesList.length) {
            try {
              const pRes = await adminFetch('/api/proxies');
              if (pRes.ok) currentProxiesList = (await pRes.json()) || [];
            } catch (_) {}
          }
          const defaultProxy = (currentProxiesList || []).find(p => p.isActive || p.active);
          const defaultHostPort = defaultProxy && defaultProxy.host ? (defaultProxy.host.includes(':') && !defaultProxy.host.startsWith('[') ? '[' + defaultProxy.host + ']:' + defaultProxy.port : defaultProxy.host + ':' + defaultProxy.port) : '';
          const defaultProxyName = defaultProxy
            ? (defaultProxy.name || defaultHostPort)
            : (currentLang === 'ru' ? 'Активный на сервере' : 'Active Server Node');
          defProxyEl.innerHTML = `<option value="">${currentLang === 'ru' ? 'По умолчанию (' + esc(defaultProxyName) + ')' : 'Default (' + esc(defaultProxyName) + ')'}</option>` +
            (currentProxiesList || []).map(p => {
              const pHostPort = p.host && p.host.includes(':') && !p.host.startsWith('[') ? '[' + p.host + ']:' + p.port : p.host + ':' + p.port;
              const pName = p.name || pHostPort;
              return `<option value="${esc(p.id)}">${esc(pName)} (${esc(p.protocol)})</option>`;
            }).join('');
          defProxyEl.value = cfg.defaultProxyId || '';
        }
        const allowProxySwitchEl = document.getElementById('builderAllowUserProxySwitch');
        if (allowProxySwitchEl) {
          allowProxySwitchEl.checked = cfg.allowUserProxySwitch !== false;
        }

        if (cfg.uiMode) {
          highlightTemplateChip(cfg.uiMode, false);
        } else if (cfg.presetTemplate) {
          highlightTemplateChip(cfg.presetTemplate, false);
        }
        if (cfg.presetStyle) {
          highlightStyleChip(cfg.presetStyle);
        }
        if (cfg.uiLayout) {
          setStudioLayout(cfg.uiLayout, true);
        } else {
          setStudioLayout('console', true);
        }
        if (cfg.colorPalette) {
          setStudioPalette(cfg.colorPalette, true);
        } else if (cfg.presetStyle) {
          const styleToPalette = {
            'cyber-blue': 'cyber',
            'dark-obsidian': 'obsidian',
            'emerald-sentinel': 'emerald',
            'sunset-amber': 'amber',
            'minimal-light': 'light'
          };
          setStudioPalette(styleToPalette[cfg.presetStyle] || 'cyber', true);
        } else {
          setStudioPalette('cyber', true);
        }
        if (cfg.defaultThemeMode) {
          setStudioThemeMode(cfg.defaultThemeMode, true);
        } else {
          setStudioThemeMode('dark', true);
        }

        updateLivePreview();
        applyThemeSyncToConstructors();
      } catch (e) {
        console.error(e);
      }
    }

    export function applyUiModePreset(mode, triggerSave = true) {
      const uiModeEl = document.getElementById('bldUiMode');
      if (uiModeEl) uiModeEl.value = mode;

      const chipPopup = document.getElementById('chip-popup') || document.getElementById('chip-self-service');
      const chipStealth = document.getElementById('chip-stealth');
      const desc = document.getElementById('presetDescText');
      const badge = document.getElementById('bldPresetBadge');

      if (mode === 'stealth') {
        if (chipPopup) chipPopup.classList.remove('active');
        if (chipStealth) chipStealth.classList.add('active');
        activeTemplatePreset = 'enterprise-invisible';
        if (badge) badge.textContent = 'Stealth Agent';
        if (desc) desc.textContent = 'Скрытый агент: фоновая служба без окна popup, применяет правила PAC незаметно.';
      } else {
        if (chipPopup) chipPopup.classList.add('active');
        if (chipStealth) chipStealth.classList.remove('active');
        activeTemplatePreset = 'self-service-pro';
        if (badge) badge.textContent = 'Self-Service Pro';
        if (desc) desc.textContent = 'Обычный режим: интерактивный попап с информацией о подключении, маршрутизации и управлением.';
      }

      if (triggerSave) {
        onConfigChangeLive();
      }
      updateLivePreview();
    }
    window.applyUiModePreset = applyUiModePreset;

    export function highlightTemplateChip(preset, triggerSave = false) {
      if (preset === 'enterprise-invisible' || preset === 'stealth') {
        applyUiModePreset('stealth', triggerSave);
      } else {
        applyUiModePreset('popup', triggerSave);
      }
    }

    export async function applyTemplatePreset(preset) {
      if (preset === 'enterprise-invisible' || preset === 'stealth') {
        applyUiModePreset('stealth', true);
      } else {
        applyUiModePreset('popup', true);
      }
    }
    window.applyTemplatePreset = applyTemplatePreset;

    export function highlightStyleChip(style) {
      const styleToPalette = {
        'cyber-blue': 'cyber',
        'dark-obsidian': 'obsidian',
        'nord': 'nord',
        'emerald-sentinel': 'emerald',
        'sunset-amber': 'amber',
        'minimal-light': 'light'
      };
      setStudioPalette(styleToPalette[style] || style || 'cyber', true);
    }
    window.highlightStyleChip = highlightStyleChip;

    export async function applyStylePreset(style) {
      highlightStyleChip(style);
      const colorMap = {
        'cyber-blue': '#0284c7',
        'dark-obsidian': '#a855f7',
        'emerald-sentinel': '#10b981',
        'sunset-amber': '#f59e0b',
        'minimal-light': '#2563eb'
      };
      if (colorMap[style]) {
        document.getElementById('bldThemeColor').value = colorMap[style];
      }
      await saveBuilderConfigOnly(false);
      await regenerateTemplatesFromConfig();
    }

    export function onConfigChangeLive() {
      updateLivePreview();
      clearTimeout(builderDebounceTimer);
      builderDebounceTimer = setTimeout(async () => {
        await saveBuilderConfigOnly(false);
      }, 500);
    }

    export async function regenerateTemplatesFromConfig() {
      try {
        const res = await adminFetch('/api/builder/regenerate', { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
          await loadExtensionFiles();
          updateLivePreview();
        }
      } catch (e) {
        console.error('Regenerate error:', e);
      }
    }

    export function onCodeEditorLiveChange() {
      const fileName = document.getElementById('codeFileSelect').value;
      const content = document.getElementById('codeEditor').value;
      extensionFiles[fileName] = content;
      
      clearTimeout(codeEditorDebounceTimer);
      codeEditorDebounceTimer = setTimeout(() => {
        updateLivePreview();
      }, 250);
    }

    export function pushSimStateToIframe() {
      const iframe = document.getElementById('previewFrame');
      if (iframe && iframe.contentWindow) {
        try {
          iframe.contentWindow.postMessage({ type: 'UPDATE_SIM_STATE', state: liveSimState }, '*');
        } catch (e) {}
      }
    }

    export function simulateState(stateType) {
      const label = document.getElementById('simStateLabel');
      const isRu = currentLang === 'ru';
      if (stateType === 'active') {
        liveSimState.online = true;
        liveSimState.bypassActive = false;
        liveSimState.status = 'Active';
        if (label) {
          label.textContent = isRu ? 'Состояние: Активен / Прокси работает' : 'State: Online / Routing Active';
          label.style.color = 'var(--success)';
        }
      } else if (stateType === 'bypass') {
        liveSimState.online = true;
        liveSimState.bypassActive = true;
        liveSimState.status = 'Bypassed';
        if (label) {
          label.textContent = isRu ? 'Состояние: Пауза (прямой доступ)' : 'State: Paused (Direct Fallback)';
          label.style.color = 'var(--warning)';
        }
      } else if (stateType === 'offline') {
        liveSimState.online = false;
        liveSimState.bypassActive = false;
        liveSimState.status = 'Direct Fallback';
        if (label) {
          label.textContent = isRu ? 'Состояние: Офлайн / Прямой трафик' : 'State: Offline / Direct Fallback';
          label.style.color = 'var(--danger)';
        }
      } else if (stateType === 'error407') {
        liveSimState.online = true;
        liveSimState.bypassActive = false;
        liveSimState.status = 'Syncing...';
        if (label) {
          label.textContent = isRu ? 'Состояние: Переаутентификация / Синхронизация' : 'State: Re-Authenticating / Syncing';
          label.style.color = 'var(--primary)';
        }
      }

      const badgeEl = document.getElementById('browserBadge');
      if (badgeEl) {
        if (liveSimState.bypassActive) {
          badgeEl.textContent = 'BYP';
          badgeEl.style.background = '#f59e0b';
          badgeEl.style.color = '#000';
        } else if (!liveSimState.online) {
          badgeEl.textContent = 'OFF';
          badgeEl.style.background = '#ef4444';
          badgeEl.style.color = '#fff';
        } else {
          badgeEl.textContent = 'PRX';
          badgeEl.style.background = '#10b981';
          badgeEl.style.color = '#000';
        }
      }

      pushSimStateToIframe();
    }

    export function toggleSimBypass() {
      liveSimState.bypassActive = !liveSimState.bypassActive;
      liveSimState.status = liveSimState.bypassActive ? 'Bypassed' : 'Active';
      const label = document.getElementById('simStateLabel');
      const isRu = currentLang === 'ru';
      if (label) {
        if (liveSimState.bypassActive) {
          label.textContent = isRu ? 'Состояние: Пауза (прямой доступ)' : 'State: Paused (Direct Fallback)';
          label.style.color = 'var(--warning)';
        } else {
          label.textContent = isRu ? 'Состояние: Активен / Прокси работает' : 'State: Online / Routing Active';
          label.style.color = 'var(--success)';
        }
      }
      const badgeEl = document.getElementById('browserBadge');
      if (badgeEl) {
        if (liveSimState.bypassActive) {
          badgeEl.textContent = 'BYP';
          badgeEl.style.background = '#f59e0b';
          badgeEl.style.color = '#000';
        } else if (!liveSimState.online) {
          badgeEl.textContent = 'OFF';
          badgeEl.style.background = '#ef4444';
          badgeEl.style.color = '#fff';
        } else {
          badgeEl.textContent = 'PRX';
          badgeEl.style.background = '#10b981';
          badgeEl.style.color = '#000';
        }
      }
      pushSimStateToIframe();
    }

    export function togglePopupPreviewVisibility() {
      const popupBox = document.getElementById('popupFrameBox');
      if (popupBox.style.display === 'none') {
        popupBox.style.display = 'block';
      } else {
        popupBox.style.display = 'none';
      }
    }

    export function updateLivePreview() {
      const uiMode = document.getElementById('bldUiMode').value;
      const previewBox = document.getElementById('popupFrameBox');
      const stealthNotice = document.getElementById('stealthNotice');
      const badgeEl = document.getElementById('browserBadge');
      const iconGlyphEl = document.getElementById('browserIconGlyph');
      const themeColor = document.getElementById('bldThemeColor').value || '#0284c7';
      const iconEmoji = document.getElementById('bldEmoji').value || '🛡️';

      if (iconGlyphEl) {
        if (currentCustomIconDataUrl) {
          iconGlyphEl.innerHTML = '<img src="' + currentCustomIconDataUrl + '" style="width:16px;height:16px;border-radius:3px;vertical-align:middle;object-fit:contain;" />';
        } else {
          iconGlyphEl.textContent = iconEmoji;
        }
      }

      if (badgeEl) {
        if (liveSimState.bypassActive) {
          badgeEl.textContent = 'BYP';
          badgeEl.style.background = '#f59e0b';
          badgeEl.style.color = '#000';
        } else if (!liveSimState.online) {
          badgeEl.textContent = 'OFF';
          badgeEl.style.background = '#ef4444';
          badgeEl.style.color = '#fff';
        } else {
          badgeEl.textContent = 'PRX';
          badgeEl.style.background = '#10b981';
          badgeEl.style.color = '#000';
        }
      }

      if (uiMode === 'stealth') {
        if (previewBox) previewBox.style.display = 'none';
        if (stealthNotice) stealthNotice.style.display = 'block';
        return;
      } else {
        if (previewBox) previewBox.style.display = 'block';
        if (stealthNotice) stealthNotice.style.display = 'none';
      }

      const previewFrame = document.getElementById('previewFrame');
      if (previewFrame) previewFrame.style.overflow = 'hidden';

      let htmlContent = extensionFiles['popup.html'] || '<div style="color:#fff;padding:20px;">No popup.html generated</div>';
      let jsContent = extensionFiles['popup.js'] || '';

      const currentFileName = document.getElementById('codeFileSelect').value;
      if (currentFileName === 'popup.html') {
        htmlContent = document.getElementById('codeEditor').value;
      } else if (currentFileName === 'popup.js') {
        jsContent = document.getElementById('codeEditor').value;
      }

      const scriptOpen = '<' + 'script>';
      const scriptClose = '<' + '/script>';

      const mockScript = scriptOpen +
        'window.__simState = ' + JSON.stringify(liveSimState) + ';' +
        'var __simStorage = {' +
          'pecThemeMode: ' + JSON.stringify(activeStudioThemeMode || 'dark') + ',' +
          'pecUserRules: []' +
        '};' +
        'var _simStorageGet = function(keys, cb) {' +
          'var res = {};' +
          'if (keys === null || keys === undefined) {' +
            'for (var k in __simStorage) { if (Object.prototype.hasOwnProperty.call(__simStorage, k)) res[k] = __simStorage[k]; }' +
          '} else if (typeof keys === "string") {' +
            'res[keys] = __simStorage[keys];' +
          '} else if (Array.isArray(keys)) {' +
            'for (var i = 0; i < keys.length; i++) { var k = keys[i]; res[k] = __simStorage[k]; }' +
          '} else if (typeof keys === "object") {' +
            'for (var k in keys) { if (Object.prototype.hasOwnProperty.call(keys, k)) res[k] = (__simStorage[k] !== undefined) ? __simStorage[k] : keys[k]; }' +
          '}' +
          'if (typeof cb === "function") cb(res);' +
          'return Promise.resolve(res);' +
        '};' +
        'var _simStorageSet = function(items, cb) {' +
          'if (items && typeof items === "object") {' +
            'for (var k in items) { if (Object.prototype.hasOwnProperty.call(items, k)) __simStorage[k] = items[k]; }' +
          '}' +
          'if (typeof cb === "function") cb();' +
          'return Promise.resolve();' +
        '};' +
        'window.switchPopupTab = function(tabId) {' +
          'if (!tabId) return;' +
          'var tabs = document.querySelectorAll(".tab-btn");' +
          'for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove("active");' +
          'var contents = document.querySelectorAll(".tab-content");' +
          'for (var j = 0; j < contents.length; j++) contents[j].classList.remove("active");' +
          'var btn = document.querySelector(".tab-btn[data-tab=" + JSON.stringify(tabId) + "]");' +
          'if (btn) btn.classList.add("active");' +
          'var tgt = document.getElementById(tabId);' +
          'if (tgt) tgt.classList.add("active");' +
        '};' +
        'window.chrome = {' +
          'runtime: {' +
            'lastError: null,' +
            'sendMessage: function(msg, cb) {' +
              'if (!msg) return Promise.resolve();' +
              'var action = msg.action || msg.type || "";' +
              'var res = { ok: true };' +
              'if (action === "GET_STATUS") {' +
                'res = window.__simState || ' + JSON.stringify(liveSimState) + ';' +
              '} else if (action === "SET_ENABLED") {' +
                'if (!window.__simState) window.__simState = ' + JSON.stringify(liveSimState) + ';' +
                'window.__simState.online = (msg.enabled !== undefined) ? Boolean(msg.enabled) : !window.__simState.online;' +
                'res = window.__simState;' +
              '} else if (action === "BYPASS_TOGGLE" || action === "TOGGLE_BYPASS") {' +
                'if (!window.__simState) window.__simState = ' + JSON.stringify(liveSimState) + ';' +
                'window.__simState.bypassActive = !window.__simState.bypassActive;' +
                'window.parent.postMessage({ type: "SIM_TOGGLE_BYPASS" }, "*");' +
                'res = window.__simState;' +
              '} else if (action === "SYNC_NOW" || action === "FORCE_SYNC") {' +
                'res = { ok: true, profile: "Direct by Default", syncedAt: new Date().toLocaleTimeString() };' +
              '} else if (action === "GET_USER_RULES") {' +
                'var rules = Array.isArray(__simStorage.pecUserRules) ? __simStorage.pecUserRules : [];' +
                'res = { ok: true, rules: rules, userRules: rules };' +
              '} else if (action === "SAVE_USER_RULES") {' +
                '__simStorage.pecUserRules = Array.isArray(msg.rules) ? msg.rules : [];' +
                'res = { ok: true, count: __simStorage.pecUserRules.length };' +
              '} else if (action === "GET_LOGS") {' +
                'res = { ok: true, logs: [' +
                  '{ time: new Date().toLocaleTimeString(), level: "info", message: "Live simulator initialized" },' +
                  '{ time: new Date().toLocaleTimeString(), level: "info", message: "Proxy node connected: direct egress" }' +
                '] };' +
              '}' +
              'if (typeof cb === "function") cb(res);' +
              'return Promise.resolve(res);' +
            '}' +
          '},' +
          'storage: {' +
            'local: { get: _simStorageGet, set: _simStorageSet },' +
            'sync: { get: _simStorageGet, set: _simStorageSet }' +
          '},' +
          'tabs: {' +
            'query: function(queryInfo, cb) {' +
              'var tabs = [{ id: 1, url: "https://yandex.ru/search", title: "Yandex", active: true }];' +
              'if (typeof cb === "function") cb(tabs);' +
              'return Promise.resolve(tabs);' +
            '}' +
          '}' +
        '};' +
        'window.addEventListener("message", function(e) {' +
          'try {' +
            'if (e.data && e.data.type === "UPDATE_SIM_STATE") {' +
              'window.__simState = e.data.state;' +
              'if (typeof window.applyPopupState === "function") {' +
                'window.applyPopupState(e.data.state);' +
              '} else {' +
                'var st = document.getElementById("statusText");' +
                'var bg = document.getElementById("badge");' +
                'var btn = document.getElementById("btnToggleBypass");' +
                'if (st) st.textContent = e.data.state.bypassActive ? "Обход" : (e.data.state.online ? "Активен" : "Отключен");' +
                'if (bg) bg.className = e.data.state.bypassActive ? "status-badge bypass" : (e.data.state.online ? "status-badge" : "status-badge offline");' +
                'if (btn) btn.textContent = e.data.state.bypassActive ? "Включить прокси" : "Временно отключить";' +
              '}' +
            '} else if (e.data && e.data.type === "UPDATE_STUDIO_THEME") {' +
              'if (document.documentElement && e.data.themeMode) document.documentElement.setAttribute("data-theme", e.data.themeMode);' +
              'if (document.body) {' +
                'if (e.data.palette) document.body.setAttribute("data-palette", e.data.palette);' +
                'if (e.data.layout) document.body.setAttribute("data-layout", e.data.layout);' +
                'if (e.data.themeMode) document.body.setAttribute("data-theme", e.data.themeMode);' +
              '}' +
            '} else if (e.data && e.data.type === "UPDATE_STUDIO_VERSION") {' +
              'var vTag = document.querySelector(".version-tag");' +
              'if (vTag && e.data.version) vTag.textContent = "v" + e.data.version;' +
            '}' +
          '} catch (err) { console.error("Error handling simulated message:", err); }' +
        '});' +
        'document.addEventListener("click", function(ev) {' +
          'var tab = ev.target.closest(".tab-btn");' +
          'if (tab && tab.dataset && tab.dataset.tab) {' +
            'ev.preventDefault();' +
            'window.switchPopupTab(tab.dataset.tab);' +
          '}' +
        '});' +
        'window.addEventListener("unhandledrejection", function(e) { e.preventDefault(); });' +
        // Report the document dimensions to the parent so the sandboxed preview
        // iframe can size itself to the popup content (a real Chrome popup
        // sizes to content; the sandbox blocks the parent from measuring).
        'try {' +
          'var _noScrollStyle = document.createElement("style");' +
          '_noScrollStyle.textContent = "html, body { overflow: hidden !important; scrollbar-width: none !important; -ms-overflow-style: none !important; } ::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }";' +
          'document.head.appendChild(_noScrollStyle);' +
        '} catch (e) {}' +
        'function __postPreviewSize() {' +
          'try {' +
            'var w = Math.max(380, document.body ? document.body.scrollWidth : 380);' +
            'var h = Math.max(' +
              'document.documentElement ? document.documentElement.scrollHeight : 0,' +
              'document.body ? document.body.scrollHeight : 0);' +
            'window.parent.postMessage({ type: "PREVIEW_RESIZE", width: w, height: h }, "*");' +
          '} catch (e) {}' +
        '}' +
        'var __postPreviewHeight = __postPreviewSize;' +
        'window.addEventListener("load", __postPreviewSize);' +
        'setTimeout(__postPreviewSize, 60);' +
        'setTimeout(__postPreviewSize, 400);' +
        'if (window.ResizeObserver) { new ResizeObserver(__postPreviewSize).observe(document.documentElement); }' +
        'var _origFetch = window.fetch;' +
        'window.fetch = function(url, opts) {' +
          'if (typeof url === "string" && url.includes("/api/ip-echo")) {' +
            'return Promise.resolve(new Response(JSON.stringify({' +
              'ip: (window.__simState && window.__simState.exitIp) || "198.51.100.42",' +
              'country: (window.__simState && window.__simState.ipLocation) || "Frankfurt, DE",' +
              'city: "Direct Egress",' +
              'protocol: "HTTPS"' +
            '}), { status: 200, headers: { "Content-Type": "application/json" } }));' +
          '}' +
          'return _origFetch ? _origFetch(url, opts).catch(function() { return new Response("{}", { status: 200 }); }) : Promise.resolve(new Response("{}", { status: 200 }));' +
        '};' +
        scriptClose;

      try {
        let doc = htmlContent;
        const currentVersionVal = (document.getElementById('bldVersion') && document.getElementById('bldVersion').value.trim()) || '1.0.0';
        doc = doc.replace(/<span class="version-tag">[^<]*<\/span>/i, '<span class="version-tag">v' + currentVersionVal + '</span>');
        doc = doc.replace(/<html([^>]*)>/i, function(match, attrs) {
          let clean = attrs.replace(/\s*data-theme="[^"]*"/g, '');
          return '<html' + clean + ' data-theme="' + activeStudioThemeMode + '">';
        });
        doc = doc.replace(/<body([^>]*)>/i, function(match, attrs) {
          let clean = attrs.replace(/\s*data-palette="[^"]*"/g, '')
                           .replace(/\s*data-layout="[^"]*"/g, '')
                           .replace(/\s*data-theme="[^"]*"/g, '');
          return '<body' + clean + ' data-palette="' + activeStudioPalette + '" data-layout="' + activeStudioLayout + '" data-theme="' + activeStudioThemeMode + '">';
        });
        // Override the early inline theme detection script in <head> so preview always uses activeStudioThemeMode
        doc = doc.replace(/var m = localStorage\.getItem\("pec_theme_mode"\)[^;]*;/gi, 'var m = ' + JSON.stringify(activeStudioThemeMode) + ';');
        if (activeStudioThemeMode === 'light') {
          doc = doc.replace(/--bg:\s*#0b1120\s*!important;?/gi, '')
                   .replace(/--card:\s*#131d36\s*!important;?/gi, '');
        }
        // NB: built with RegExp so that \s and \. are real regex escapes - a
        // plain string literal would turn '\s' into 's' and never match.
        const popupScriptRegex = new RegExp('<script[^>]*src="popup\\.js"[^>]*>\\s*</script>', 'i');
        if (doc.includes('popup.js')) {
          doc = doc.replace(popupScriptRegex, mockScript + scriptOpen + jsContent + scriptClose);
        } else {
          doc = mockScript + doc + scriptOpen + jsContent + scriptClose;
        }

        const iframe = document.getElementById('previewFrame');
        if (iframe) {
          iframe.onload = function() {
            try {
              pushSimStateToIframe();
              updateLivePreviewThemeAndLayout();
            } catch (err) {
              console.error('Error on preview frame load:', err);
            }
          };
          iframe.srcdoc = doc;
        }
      } catch (err) {
        console.error('Error in updateLivePreview:', err);
      }
    }

    window.addEventListener('message', (e) => {
      try {
        // Only accept simulator messages from our own sandboxed preview frame
        const pf = document.getElementById('previewFrame');
        if (!pf || e.source !== pf.contentWindow) return;
        if (e.data && e.data.type === 'SIM_TOGGLE_BYPASS') {
          toggleSimBypass();
        } else if (e.data && e.data.type === 'PREVIEW_RESIZE' && typeof e.data.height === 'number') {
          // Size the preview to the popup content like a real Chrome popup,
          // clamped to a sane band so a broken template cannot blow up the UI.
          pf.style.height = Math.max(180, Math.min(850, Math.round(e.data.height))) + 'px';
          if (typeof e.data.width === 'number') {
            pf.style.width = Math.max(380, Math.min(600, Math.round(e.data.width))) + 'px';
          }
          pf.style.overflow = 'hidden';
        }
      } catch (err) {
        console.error('Error in message listener:', err);
      }
    });

    export async function loadExtensionFiles() {
      try {
        const res = await adminFetch('/api/builder/files');
        extensionFiles = await res.json();
        loadFileContent();
        updateLivePreview();
        applyThemeSyncToConstructors();
      } catch (e) {
        console.error(e);
      }
    }

    export function loadFileContent() {
      const fileName = document.getElementById('codeFileSelect').value;
      const editor = document.getElementById('codeEditor');
      editor.value = extensionFiles[fileName] || '// File not found or empty';
      document.getElementById('codeStatus').textContent = 'Viewing ' + fileName;
      updateLivePreview();
    }

    export async function saveCurrentCodeFile() {
      const fileName = document.getElementById('codeFileSelect').value;
      const content = document.getElementById('codeEditor').value;
      try {
        const res = await adminFetch('/api/builder/file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName, content })
        });
        if (res.ok) {
          extensionFiles[fileName] = content;
          document.getElementById('codeStatus').textContent = 'Saved ' + fileName + ' at ' + new Date().toLocaleTimeString();
          updateLivePreview();
        } else {
          const data = await res.json().catch(() => ({}));
          toast('Failed to save ' + fileName + ': ' + (data.error || ('HTTP ' + res.status)), 'error');
        }
      } catch (e) {
        toast('Error saving file: ' + e, 'error');
      }
    }

    export async function saveBuilderConfigOnly(showAlert = true) {
      const payload = {
        name: document.getElementById('bldName').value.trim(),
        shortName: document.getElementById('bldShortName').value.trim(),
        version: document.getElementById('bldVersion').value.trim(),
        uiMode: document.getElementById('bldUiMode') ? document.getElementById('bldUiMode').value : 'popup',
        iconType: document.getElementById('bldIconType') ? document.getElementById('bldIconType').value : undefined,
        themeColor: document.getElementById('bldThemeColor').value.trim(),
        iconEmoji: document.getElementById('bldEmoji').value.trim(),
        customIconDataUrl: (isCustomIconUploaded && currentCustomIconDataUrl) ? currentCustomIconDataUrl : (getEmojiIconDataUrl() || undefined),
        description: document.getElementById('bldDesc').value.trim(),
        defaultServerUrl: document.getElementById('bldServerUrl')
          ? document.getElementById('bldServerUrl').value.trim()
          : '',
        updateUrl: document.getElementById('bldUpdateUrl')
          ? document.getElementById('bldUpdateUrl').value.trim()
          : '',
        syncIntervalMinutes: parseInt(document.getElementById('bldSyncInterval').value, 10) || 15,
        webRtcProtection: document.getElementById('bldWebRtc').checked,
        dnsLeakProtection: document.getElementById('bldDnsGuard').checked,
        badgeIndicator: document.getElementById('bldBadge') ? document.getElementById('bldBadge').checked : true,
        autoConfigureProxy: document.getElementById('bldAutoProxy') ? document.getElementById('bldAutoProxy').checked : true,
        allowUserBypass: document.getElementById('bldAllowBypass') ? document.getElementById('bldAllowBypass').checked : true,
        showIpGeoChecker: document.getElementById('bldIpGeo') ? document.getElementById('bldIpGeo').checked : true,
        showIpGeoCheck: document.getElementById('bldIpGeo') ? document.getElementById('bldIpGeo').checked : true,
        bypassAutoTimeoutMinutes: parseInt(document.getElementById('bldBypassTimeout').value, 10) || 15,
        bypassTimeoutMinutes: parseInt(document.getElementById('bldBypassTimeout').value, 10) || 15,
        supportUrl: document.getElementById('bldSupportUrl').value.trim(),
        defaultProxyId: document.getElementById('builderDefaultProxyId') ? document.getElementById('builderDefaultProxyId').value.trim() : undefined,
        allowUserProxySwitch: document.getElementById('builderAllowUserProxySwitch') ? document.getElementById('builderAllowUserProxySwitch').checked : true,
        presetTemplate: activeTemplatePreset,
        presetStyle: activeStylePreset,
        uiLayout: activeStudioLayout,
        colorPalette: activeStudioPalette,
        defaultThemeMode: activeStudioThemeMode,
      };

      try {
        const res = await adminFetch('/api/builder/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          if (showAlert) toast('Constructor configuration saved and extension files re-rendered!', 'success');
          return true;
        } else {
          const data = await res.json().catch(() => ({}));
          if (showAlert) toast('Failed to save config: ' + (data.error || ('HTTP ' + res.status)), 'error');
          return false;
        }
      } catch (e) {
        if (showAlert) toast('Error saving config: ' + e, 'error');
        return false;
      }
    }

    export async function buildExtensionPackage() {
      const savedOk = await saveBuilderConfigOnly(false);
      if (savedOk === false) {
        toast('Build aborted: could not save the builder configuration.', 'error');
        return;
      }
      return await buildAndPackExtension();
    }
    window.buildExtensionPackage = buildExtensionPackage;

    export async function buildAndPackExtension() {
      const btn = document.getElementById('btnBuildExtension') || document.querySelector('.builder-actions-row button.btn-success');
      let origHtml = '';
      if (btn) {
        if (btn.disabled) return false;
        origHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="loading-spinner"></span> ' + (btn.textContent || '').trim();
      }
      try {
        const savedOk = await saveBuilderConfigOnly(false);
        if (savedOk === false) {
          toast(currentLang === 'ru' ? 'Сборка отменена: не удалось сохранить настройки.' : 'Build aborted: could not save the builder configuration.', 'error');
          return false;
        }
        const res = await adminFetch('/api/builder/build', { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
          const extLogs = (data.result && data.result.buildLog) || data.buildLog;
          if (Array.isArray(extLogs) && extLogs.length > 0) {
            lastExtBuildLog = extLogs;
            const extLogBtn = document.getElementById('btnExtViewBuildLog');
            if (extLogBtn) extLogBtn.style.display = 'inline-block';
          }
          toast(currentLang === 'ru' ? 'Пакет расширения успешно собран! .CRX подписан, .ZIP создан, updates.xml обновлен.' : 'Extension package built successfully! .CRX signed, .ZIP created, and updates.xml regenerated.', 'success');
          fetchExtensionInfo();
          await loadExtensionFiles();
          loadReleases();
          return true;
        } else {
          const extLogs = (data.result && data.result.buildLog) || data.buildLog;
          if (Array.isArray(extLogs) && extLogs.length > 0) {
            lastExtBuildLog = extLogs;
            const extLogBtn = document.getElementById('btnExtViewBuildLog');
            if (extLogBtn) extLogBtn.style.display = 'inline-block';
          }
          toast(currentLang === 'ru' ? 'Ошибка сборки расширения: ' + (data.error || 'Сбой') : 'Build error: ' + (data.error || 'Failed'), 'error');
          return false;
        }
      } catch (e) {
        toast((currentLang === 'ru' ? 'Ошибка сборки расширения: ' : 'Error building extension: ') + e, 'error');
        return false;
      } finally {
        if (btn) {
          btn.disabled = false;
          if (origHtml) btn.innerHTML = origHtml;
        }
      }
    }

    export async function downloadExtensionPackage(type) {
      toast(currentLang === 'ru' ? 'Сборка пакета перед скачиванием...' : 'Building package before download...', 'info');
      const ok = await buildAndPackExtension();
      if (!ok) {
        toast(currentLang === 'ru' ? 'Сборка завершилась ошибкой. Скачивание отменено.' : 'Build failed. Download cancelled.', 'error');
        return;
      }
      if (type === 'zip') {
        try {
          const res = await adminFetch('/api/extension/download-zip');
          if (!res.ok) {
            toast('Failed to download zip: HTTP ' + res.status, 'error');
            return;
          }
          const blob = await res.blob();
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = 'corp-proxy-extension.zip';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        } catch (e) {
          toast('Error downloading package: ' + e, 'error');
        }
      } else {
        const url = '/updates/extension.crx';
        const a = document.createElement('a');
        a.href = url;
        a.download = 'extension.crx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    }

    // ----------------- App Studio (Конструктор десктоп-приложения) -----------------
export let currentAppConfig = null;
export let currentAppRules = [];
export let currentAppThemeMode = 'dark';
export let isAppStudioDirty = false;

export const APP_THEME_PRESETS: any = {
      'cyber-blue': {
        primary: '#38bdf8',
        background: '#090e1a',
        card: '#111a2e',
        text: '#f8fafc',
        lightBackground: '#f0f9ff',
        lightCard: '#ffffff'
      },
      'dark-obsidian': {
        primary: '#c084fc',
        background: '#0d1117',
        card: '#161b22',
        text: '#f0f6fc',
        lightBackground: '#faf5ff',
        lightCard: '#ffffff'
      },
      'nordic-arctic': {
        primary: '#88c0d0',
        background: '#242933',
        card: '#2e3440',
        text: '#eceff4',
        lightBackground: '#eceff4',
        lightCard: '#ffffff'
      },
      'emerald-secops': {
        primary: '#34d399',
        background: '#061e14',
        card: '#0d3322',
        text: '#ecfdf5',
        lightBackground: '#ecfdf5',
        lightCard: '#ffffff'
      },
      'enterprise-light': {
        primary: '#2563eb',
        background: '#0b1120',
        card: '#131d36',
        text: '#f8fafc',
        lightBackground: '#f1f5f9',
        lightCard: '#ffffff'
      },
      'emerald-sentinel': {
        primary: '#34d399',
        background: '#061e14',
        card: '#0d3322',
        text: '#ecfdf5',
        lightBackground: '#ecfdf5',
        lightCard: '#ffffff'
      },
      'sunset-amber': {
        primary: '#f59e0b',
        background: '#1c1307',
        card: '#261805',
        text: '#fef3c7',
        lightBackground: '#fffbeb',
        lightCard: '#ffffff'
      },
      'minimal-light': {
        primary: '#2563eb',
        background: '#f8fafc',
        card: '#ffffff',
        text: '#0f172a',
        lightBackground: '#f8fafc',
        lightCard: '#ffffff'
      }
    };
    APP_THEME_PRESETS['cyber'] = APP_THEME_PRESETS['cyber-blue'];
    APP_THEME_PRESETS['obsidian'] = APP_THEME_PRESETS['dark-obsidian'];
    APP_THEME_PRESETS['nord'] = APP_THEME_PRESETS['nordic-arctic'];
    APP_THEME_PRESETS['emerald'] = APP_THEME_PRESETS['emerald-secops'];
    APP_THEME_PRESETS['amber'] = APP_THEME_PRESETS['sunset-amber'];
    APP_THEME_PRESETS['light'] = APP_THEME_PRESETS['enterprise-light'];

export let lastAppBuildLog = [];
export let lastExtBuildLog = [];
export let currentViewingLogType = 'app';
export let currentAppLayout = 'console';

    export function setAppLayout(layout) {
      currentAppLayout = (layout === 'terminal') ? 'terminal' : 'console';
      const btnConsole = document.getElementById('btnAppLayoutConsole');
      const btnTerminal = document.getElementById('btnAppLayoutTerminal');
      if (btnConsole && btnTerminal) {
        btnConsole.classList.toggle('active', currentAppLayout === 'console');
        btnTerminal.classList.toggle('active', currentAppLayout === 'terminal');
      }
      const preview = document.getElementById('appPreviewWindow');
      if (preview && typeof preview.setAttribute === 'function') {
        preview.setAttribute('data-app-layout', currentAppLayout);
      }
      onAppConfigChangeLive();
    }

    export function openBuildLogModal(type) {
      currentViewingLogType = type;
      const modal = document.getElementById('modalBuildLog');
      const titleEl = document.getElementById('buildLogModalTitle');
      const consoleEl = document.getElementById('buildLogConsole');
      if (!modal || !consoleEl) return;

      const logs = type === 'extension' ? lastExtBuildLog : lastAppBuildLog;
      const titleText = type === 'extension'
        ? (currentLang === 'ru' ? 'Лог сборки Chrome Расширения' : 'Extension Build Log')
        : (currentLang === 'ru' ? 'Лог сборки и компиляции PEC-App' : 'PEC-App Build & Compilation Log');

      if (titleEl) {
        titleEl.innerHTML = '<span>📋</span><span>' + esc(titleText) + '</span>';
      }

      if (!logs || logs.length === 0) {
        consoleEl.textContent = currentLang === 'ru'
          ? 'Лог пока пуст. Запустите сборку для отображения подробного вывода компилятора и шагов сборки.'
          : 'Log is currently empty. Run a build to see detailed compiler output and packaging steps.';
      } else {
        consoleEl.textContent = logs.join('\n');
      }

      modal.style.display = 'flex';
    }

    export function showCompilerWarningModal(message) {
      const modal = document.getElementById('modalCompilerWarning');
      const textEl = document.getElementById('compilerWarningModalText');
      if (textEl) textEl.textContent = message;
      if (modal) {
        modal.style.display = 'flex';
      }
    }

    export function closeCompilerWarningModal() {
      const modal = document.getElementById('modalCompilerWarning');
      if (modal) modal.style.display = 'none';
    }

    export function closeBuildLogModal() {
      const modal = document.getElementById('modalBuildLog');
      if (modal) modal.style.display = 'none';
    }

    export function copyBuildLogToClipboard() {
      const consoleEl = document.getElementById('buildLogConsole');
      if (!consoleEl) return;
      const text = consoleEl.textContent;
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        toast(currentLang === 'ru' ? 'Лог скопирован в буфер обмена' : 'Log copied to clipboard', 'success');
      }).catch(() => {
        toast('Failed to copy log', 'error');
      });
    }

    export async function loadAppRoutingProfilesDropdown() {
      const sel = document.getElementById('appRoutingProfileSelect');
      const branchSel = document.getElementById('branchAppInheritProfileSelect');
      const targets = [sel, branchSel].filter(Boolean);
      if (targets.length === 0) return;
      try {
        const res = await adminFetch('/api/routing/profiles');
        if (!res.ok) return;
        const profiles = await res.json();
        if (!Array.isArray(profiles)) return;
        targets.forEach(targetSel => {
          const isBranch = targetSel.id === 'branchAppInheritProfileSelect';
          const currentVal = targetSel.value || (currentAppConfig && currentAppConfig.inheritRoutingProfileId) || '';
          targetSel.innerHTML = '<option value="">-- ' + (isBranch ? (currentLang === 'ru' ? 'Наследовать по назначению флота' : 'Inherit fleet assigned profile') : (currentLang === 'ru' ? 'Выберите профиль маршрутизации' : 'Select routing profile')) + ' --</option>';
          profiles.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name + ' (' + (p.rules || []).length + ' ' + (currentLang === 'ru' ? 'правил' : 'rules') + ')';
            targetSel.appendChild(opt);
          });
          if (currentVal) targetSel.value = currentVal;
        });
      } catch (e) {
        console.warn('Error loading routing profiles for App Studio:', e);
      }
    }

    export async function importSelectedRoutingProfileRules() {
      const sel = document.getElementById('appRoutingProfileSelect');
      if (!sel || !sel.value) {
        toast(currentLang === 'ru' ? 'Выберите профиль маршрутизации для импорта' : 'Select a routing profile to import', 'info');
        return;
      }
      const profileId = sel.value;
      try {
        const res = await adminFetch('/api/routing/profiles');
        if (!res.ok) return;
        const profiles = await res.json();
        const target = profiles.find(p => p.id === profileId);
        if (!target || !Array.isArray(target.rules) || target.rules.length === 0) {
          toast(currentLang === 'ru' ? 'В выбранном профиле нет правил для импорта' : 'No rules found in selected profile', 'info');
          return;
        }

        // Look up presets to expand preset entries into real domain hosts
        const presetsMap = new Map();
        try {
          const presRes = await adminFetch('/api/routing/presets');
          if (presRes.ok) {
            const presetList = await presRes.json();
            if (Array.isArray(presetList)) {
              presetList.forEach(p => {
                const entries = p.entries || p.domains || [];
                if (p.id) {
                  presetsMap.set(p.id, entries);
                  if (p.id.startsWith('preset:')) {
                    presetsMap.set(p.id.replace(/^preset:/, ''), entries);
                  } else {
                    presetsMap.set('preset:' + p.id, entries);
                  }
                }
              });
            }
          }
        } catch (_) {}

        let addedCount = 0;
        target.rules.forEach(r => {
          let domains = [];
          if (r.targetType === 'preset' && r.pattern) {
            const list = presetsMap.get(r.pattern) || presetsMap.get(r.pattern.replace(/^preset:/, '')) || [];
            if (list.length > 0) {
              domains = list;
            } else if (!r.pattern.startsWith('preset:')) {
              domains = [r.pattern];
            }
          } else if (r.pattern) {
            domains = r.pattern.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
          }
          if (domains.length === 0) return;

          const action = r.action === 'block' ? 'block' : (r.action === 'direct' ? 'direct' : 'proxy');
          currentAppRules.push({
            id: 'rule_imp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            processName: '*',
            targetHosts: domains.join('; '),
            targetPorts: '*',
            protocol: 'tcp',
            action: action,
          });
          addedCount++;
        });

        renderAppProcessRulesTable();
        onAppConfigChangeLive();
        toast(
          currentLang === 'ru'
            ? 'Импортировано правил: ' + addedCount + ' из профиля "' + target.name + '"'
            : 'Imported ' + addedCount + ' rules from profile "' + target.name + '"',
          'success'
        );
      } catch (e) {
        toast('Error importing routing rules: ' + e.message, 'error');
      }
    }
    const importRoutingRulesToApp = importSelectedRoutingProfileRules;

    export async function loadAppStudioConfig() {
      try {
        const res = await adminFetch('/api/app-builder/config');
        if (!res.ok) return;
        const cfg = await res.json();
        currentAppConfig = cfg;

        const nameEl = document.getElementById('appBuildName');
        const shortNameEl = document.getElementById('appBuildShortName');
        const verEl = document.getElementById('appBuildVersion');
        const descEl = document.getElementById('appBuildDescription');
        const iconEl = document.getElementById('appIconType');
        const presetEl = document.getElementById('appPresetStyle');
        const colorEl = document.getElementById('appThemeColor');
        const bgEl = document.getElementById('appThemeBackground');
        const cardEl = document.getElementById('appThemeCard');
        const autoStartEl = document.getElementById('appAutoStart');
        const minEl = document.getElementById('appStartMinimized');
        const serviceEl = document.getElementById('appInstallService');
        const logEl = document.getElementById('appTrafficLogging');
        const legacyWin7El = document.getElementById('appLegacyWin7');
        const syncIntervalEl = document.getElementById('appSyncIntervalMinutes');

        if (nameEl) nameEl.value = cfg.name || 'PEC - Proxy Client';
        if (shortNameEl) shortNameEl.value = cfg.shortName || 'PEC Client';
        if (verEl) verEl.value = cfg.version || '2.2.0';
        if (descEl) descEl.value = cfg.description || '';
        if (iconEl) iconEl.value = cfg.iconType || 'shield';
        if (cfg.customIconDataUrl) {
          setAppCustomIconDataUrl(cfg.customIconDataUrl, true, false);
        } else {
          setAppCustomIconDataUrl('', false, false);
        }
        if (presetEl) presetEl.value = cfg.presetStyle || 'cyber-blue';
        if (colorEl) colorEl.value = cfg.themeColor || '#0284c7';
        if (bgEl) bgEl.value = cfg.themeBackground || '#0b1120';
        if (cardEl) cardEl.value = cfg.themeCard || '#131d36';

        if (autoStartEl) autoStartEl.checked = cfg.autoStartWithWindows !== false;
        if (minEl) minEl.checked = cfg.startMinimizedToTray !== false;
        if (serviceEl) serviceEl.checked = cfg.installAsService === true;
        if (logEl) logEl.checked = cfg.trafficLogging !== false;
        if (legacyWin7El) legacyWin7El.checked = cfg.legacyWin7 === true;
        if (syncIntervalEl) syncIntervalEl.value = cfg.syncIntervalMinutes || 15;

        const inclExtEl = document.getElementById('branchAppIncludeExtensionRules');
        if (inclExtEl) {
          inclExtEl.checked = Boolean(cfg.includeExtensionRules);
          const container = document.getElementById('branchAppInheritProfileContainer');
          if (container) container.style.display = cfg.includeExtensionRules ? 'block' : 'none';
        }
        const appInclExtEl = document.getElementById('appIncludeExtensionRules');
        if (appInclExtEl) appInclExtEl.checked = Boolean(cfg.includeExtensionRules);

        currentAppLayout = cfg.uiLayout || 'console';
        setAppLayout(currentAppLayout);
        await loadAppRoutingProfilesDropdown();
        if (cfg.inheritRoutingProfileId) {
          const rSel = document.getElementById('appRoutingProfileSelect');
          if (rSel) rSel.value = cfg.inheritRoutingProfileId;
          const bSel = document.getElementById('branchAppInheritProfileSelect');
          if (bSel) bSel.value = cfg.inheritRoutingProfileId;
        }

        const isSpecific = Array.isArray(cfg.inheritRuleIds) && cfg.inheritRuleIds.length > 0;
        const radAll = document.getElementById('appRuleInheritModeAll');
        const radSpec = document.getElementById('appRuleInheritModeSpecific');
        if (radAll && radSpec) {
          radAll.checked = !isSpecific;
          radSpec.checked = isSpecific;
          onAppRuleInheritModeChange();
        }
        if (cfg.inheritRoutingProfileId) {
          renderBranchAppSpecificRules(cfg.inheritRoutingProfileId, cfg.inheritRuleIds || []);
        }
        currentAppThemeMode = cfg.defaultThemeMode || 'dark';
        const btnDark = document.getElementById('btnAppModeDark');
        const btnLight = document.getElementById('btnAppModeLight');
        if (btnDark) btnDark.classList.toggle('active', currentAppThemeMode === 'dark');
        if (btnLight) btnLight.classList.toggle('active', currentAppThemeMode === 'light');

        const presetKey = cfg.presetStyle || 'cyber-blue';
        const chips = {
          'cyber-blue': document.getElementById('chipAppPresetCyber'),
          'dark-obsidian': document.getElementById('chipAppPresetObsidian'),
          'nordic-arctic': document.getElementById('chipAppPresetNord'),
          'emerald-secops': document.getElementById('chipAppPresetEmerald'),
          'enterprise-light': document.getElementById('chipAppPresetLight'),
          'emerald-sentinel': document.getElementById('chipAppPresetEmerald'),
          'sunset-amber': document.getElementById('chipAppPresetSunset') || document.getElementById('chipAppPresetNord'),
          'minimal-light': document.getElementById('chipAppPresetLight')
        };
        Object.keys(chips).forEach(k => {
          if (chips[k]) chips[k].classList.toggle('active', k === presetKey);
        });

        const presetTitles = {
          'cyber-blue': 'Cyber Blue',
          'dark-obsidian': 'Dark Obsidian',
          'nordic-arctic': 'Nordic Arctic',
          'emerald-secops': 'Emerald SecOps',
          'enterprise-light': 'Enterprise Light',
          'emerald-sentinel': 'Emerald SecOps',
          'sunset-amber': 'Sunset Amber',
          'minimal-light': 'Minimal Light'
        };
        const badgeEl = document.getElementById('appPresetBadge');
        if (badgeEl) badgeEl.textContent = presetTitles[presetKey] || presetKey;

        try {
          const infoRes = await adminFetch('/api/app-builder/info');
          if (infoRes.ok) {
            const infoData = await infoRes.json();
            const info = infoData.info || infoData.result || (infoData.toolchain || infoData.compilerMissing !== undefined ? infoData : null);
            if (info) {
              renderAppStudioBuildInfo(info);
            }
          }
        } catch (_) {}

        if (!currentProxiesList || !currentProxiesList.length) {
          try {
            const pRes = await adminFetch('/api/proxies');
            if (pRes.ok) currentProxiesList = (await pRes.json()) || [];
          } catch (_) {}
        }

        currentAppRules = Array.isArray(cfg.processRules) ? JSON.parse(JSON.stringify(cfg.processRules)) : [];
        renderAppProcessRulesTable();
        updateAppLivePreview();
        await loadCodeSignStatus();
        applyThemeSyncToConstructors();
        isAppStudioDirty = false;
      } catch (e) {
        console.error('Failed to load App Studio config:', e);
      }
    }

    export function renderAppStudioBuildInfo(info) {
      if (!info) return;

      // 1. Prominent amber warning card/banner in App Studio tab for stale binaries
      let staleBannerEl = document.getElementById('appBinariesStaleBanner');
      if (info.binariesStale) {
        if (!staleBannerEl) {
          staleBannerEl = document.createElement('div');
          staleBannerEl.id = 'appBinariesStaleBanner';
          const container = document.getElementById('viewAppStudio')
            || document.getElementById('tab-app-studio')
            || (document.getElementById('appBuildStatusMsg') ? document.getElementById('appBuildStatusMsg').parentNode : null)
            || document.body;
          if (container) {
            if (container.firstChild) {
              container.insertBefore(staleBannerEl, container.firstChild);
            } else {
              container.appendChild(staleBannerEl);
            }
          }
        }
        if (staleBannerEl) {
          staleBannerEl.className = 'alert-banner alert-warning';
          staleBannerEl.style.display = 'block';
          staleBannerEl.style.background = 'rgba(245, 158, 11, 0.12)';
          staleBannerEl.style.border = '1px solid rgba(245, 158, 11, 0.4)';
          staleBannerEl.style.borderLeft = '4px solid #f59e0b';
          staleBannerEl.style.color = '#fbbf24';
          staleBannerEl.style.padding = '12px 16px';
          staleBannerEl.style.borderRadius = '6px';
          staleBannerEl.style.marginBottom = '16px';
          staleBannerEl.style.fontSize = '13px';
          staleBannerEl.style.lineHeight = '1.5';
          staleBannerEl.style.gridColumn = '1 / -1';
          staleBannerEl.innerHTML = `⚠️ Внимание: Версия в бинарниках (${esc(info.embeddedVersion || 'старая')}) не совпадает с версией релиза (${esc(info.version)}). Перед публикацией релиза пересоберите бинарники (кнопка «Собрать бинарники»), чтобы исключить вечный цикл обновлений у клиентов.`;
        }
      } else if (staleBannerEl) {
        staleBannerEl.style.display = 'none';
        staleBannerEl.innerHTML = '';
      }

      // 1.1 Dedicated Toolchain Diagnostics card / pill next to the binary version warning
      let toolchainEl = document.getElementById('appToolchainDiagnostics');
      const tc = info.toolchain;
      const hasToolchainInfo = Boolean(
        tc ||
        info.compilerMissing !== undefined ||
        (info.compilerStatus && typeof info.compilerStatus === 'object')
      );

      if (hasToolchainInfo) {
        if (!toolchainEl) {
          toolchainEl = document.createElement('div');
          toolchainEl.id = 'appToolchainDiagnostics';
          const staleEl = document.getElementById('appBinariesStaleBanner');
          if (staleEl && staleEl.parentNode) {
            staleEl.parentNode.insertBefore(toolchainEl, staleEl.nextSibling);
          } else {
            const container = document.getElementById('viewAppStudio')
              || document.getElementById('tab-app-studio')
              || (document.getElementById('appBuildStatusMsg') ? document.getElementById('appBuildStatusMsg').parentNode : null)
              || document.body;
            if (container) {
              if (container.firstChild) {
                container.insertBefore(toolchainEl, container.firstChild);
              } else {
                container.appendChild(toolchainEl);
              }
            }
          }
        }
        if (toolchainEl) {
          const isAvailable = Boolean(tc && tc.available === true && !info.compilerMissing && !tc.compilerMissing);

          toolchainEl.className = 'card toolchain-card';
          toolchainEl.style.display = 'flex';
          toolchainEl.style.alignItems = 'center';
          toolchainEl.style.justifyContent = 'space-between';
          toolchainEl.style.flexWrap = 'wrap';
          toolchainEl.style.gap = '10px';
          toolchainEl.style.padding = '10px 14px';
          toolchainEl.style.borderRadius = '6px';
          toolchainEl.style.marginBottom = '14px';
          toolchainEl.style.gridColumn = '1 / -1';
          toolchainEl.style.background = isAvailable ? 'rgba(16, 185, 129, 0.08)' : 'rgba(245, 158, 11, 0.1)';
          toolchainEl.style.border = isAvailable ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(245, 158, 11, 0.35)';

          function parseToolInfo(toolKey: any, defaultAvail: any) {
            if (!tc) return { available: defaultAvail, text: '' };
            const hasKey = 'has' + toolKey.charAt(0).toUpperCase() + toolKey.slice(1);
            const raw = tc[toolKey] !== undefined
              ? tc[toolKey]
              : (tc[hasKey] !== undefined
                  ? tc[hasKey]
                  : (tc.tools && tc.tools[toolKey]));
            if (typeof raw === 'boolean') return { available: raw, text: '' };
            if (typeof raw === 'string') return { available: true, text: raw };
            if (raw && typeof raw === 'object') {
              const avail = raw.available !== undefined ? Boolean(raw.available) : (raw.present !== undefined ? Boolean(raw.present) : defaultAvail);
              const txt = raw.version || raw.path || '';
              return { available: avail, text: txt };
            }
            return { available: defaultAvail, text: '' };
          }

          const gccInfo = parseToolInfo('gcc', Boolean(tc && (tc.hasGcc !== undefined ? tc.hasGcc : isAvailable)));
          const windresInfo = parseToolInfo('windres', Boolean(tc && (tc.hasWindres !== undefined ? tc.hasWindres : isAvailable)));
          const wixlInfo = parseToolInfo('wixl', Boolean(tc && (tc.hasWixl || (tc.wixl && (tc.wixl === true || tc.wixl.available)))));

          const mainBadgeText = isAvailable
            ? ('✓ Тулчейн компиляции: ' + (tc.compilerName || (info.compilerStatus && info.compilerStatus.compilerName) || 'MinGW-w64 GCC'))
            : '⚠ Компилятор C/C++ не установлен (сборка из исходников недоступна)';

          const mainBadgeBg = isAvailable ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)';
          const mainBadgeColor = isAvailable ? '#10b981' : '#f59e0b';
          const mainBadgeBorder = isAvailable ? 'rgba(16, 185, 129, 0.4)' : 'rgba(245, 158, 11, 0.5)';

          const gccBadge = gccInfo.available
            ? `<span class="badge badge-tool-gcc" id="appToolchainGccBadge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 11px; padding: 2px 8px; border-radius: 4px;" title="GCC: ${esc(gccInfo.text || 'Доступен')}">✓ GCC${gccInfo.text ? ' (' + esc(gccInfo.text) + ')' : ''}</span>`
            : `<span class="badge badge-tool-gcc" id="appToolchainGccBadge" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); font-size: 11px; padding: 2px 8px; border-radius: 4px;" title="GCC: Отсутствует">❌ GCC</span>`;

          const windresBadge = windresInfo.available
            ? `<span class="badge badge-tool-windres" id="appToolchainWindresBadge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 11px; padding: 2px 8px; border-radius: 4px;" title="Windres: ${esc(windresInfo.text || 'Доступен')}">✓ Windres${windresInfo.text ? ' (' + esc(windresInfo.text) + ')' : ''}</span>`
            : `<span class="badge badge-tool-windres" id="appToolchainWindresBadge" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); font-size: 11px; padding: 2px 8px; border-radius: 4px;" title="Windres: Отсутствует">❌ Windres</span>`;

          const wixLabel = wixlInfo.text && wixlInfo.text.toLowerCase().includes('wix')
            ? esc(wixlInfo.text)
            : ('Wixl' + (wixlInfo.text ? ' (' + esc(wixlInfo.text) + ')' : ''));
          const wixlBadge = wixlInfo.available
            ? `<span class="badge badge-tool-wixl" id="appToolchainWixlBadge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 11px; padding: 2px 8px; border-radius: 4px;" title="Wixl: ${esc(wixlInfo.text || 'Доступен')}">✓ ${wixLabel}</span>`
            : `<span class="badge badge-tool-wixl" id="appToolchainWixlBadge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 11px; padding: 2px 8px; border-radius: 4px;" title="Wixl: Отсутствует">⚠ Wixl</span>`;

          const tooltipStr = `GCC: ${gccInfo.available ? (gccInfo.text || 'OK') : 'отсутствует'}, Windres: ${windresInfo.available ? (windresInfo.text || 'OK') : 'отсутствует'}, Wixl: ${wixlInfo.available ? (wixlInfo.text || 'OK') : 'отсутствует'}`;
          toolchainEl.setAttribute('title', tooltipStr);

          toolchainEl.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span id="appToolchainMainBadge" class="badge" style="background: ${mainBadgeBg}; color: ${mainBadgeColor}; border: 1px solid ${mainBadgeBorder}; font-weight: 600; padding: 4px 10px; border-radius: 6px; font-size: 12px;">${esc(mainBadgeText)}</span>
            </div>
            <div id="appToolchainToolsList" style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;" title="${esc(tooltipStr)}">
              ${gccBadge}
              ${windresBadge}
              ${wixlBadge}
            </div>
          `;
        }
      } else if (toolchainEl) {
        toolchainEl.style.display = 'none';
        toolchainEl.innerHTML = '';
      }

      // 2. Build status message (Windows / Linux package sizes, SHA, MSI, signature)
      const statusEl = document.getElementById('appBuildStatusMsg');
      if (statusEl) {
        const winSizeKb = Math.round((info.windowsPackageSize || 0) / 1024);
        const linSizeKb = Math.round((info.linuxPackageSize || 0) / 1024);
        const winSha = (info.windowsPackageSha256 || '').slice(0, 10);
        statusEl.style.display = 'block';
        statusEl.style.color = 'var(--text-muted)';
        const builtAtStr = info.builtAt ? new Date(info.builtAt).toLocaleTimeString() : '';
        if (Array.isArray(info.buildLog) && info.buildLog.length > 0) {
          lastAppBuildLog = info.buildLog;
          const logBtn = document.getElementById('btnAppViewBuildLog');
          if (logBtn) logBtn.style.display = 'inline-block';
        }
        const msiSizeKb = info.windowsMsiSize ? Math.round(info.windowsMsiSize / 1024) : 0;
        const msiPart = msiSizeKb ? `, MSI (${msiSizeKb} KB)` : '';
        const signPart = (info.codeSigningStatus && info.codeSigningStatus.isSigned) ? ` &bull; 🔏 ${esc(info.codeSigningStatus.type || 'Signed')}` : '';
        statusEl.innerHTML = (typeof currentLang !== 'undefined' && currentLang === 'ru')
          ? `Собран: Windows (${winSizeKb} KB, SHA: ${esc(winSha)}...)${msiPart}, Linux (${linSizeKb} KB)${builtAtStr ? ' &bull; ' + builtAtStr : ''}${signPart}`
          : `Built: Windows (${winSizeKb} KB, SHA: ${esc(winSha)}...)${msiPart}, Linux (${linSizeKb} KB)${builtAtStr ? ' &bull; ' + builtAtStr : ''}${signPart}`;
      }

      // 3. Core modules integrity badges/list
      let modules = [];
      if (Array.isArray(info.coreModulesIntegrity)) {
        modules = info.coreModulesIntegrity;
      } else if (info.coreModulesIntegrity && typeof info.coreModulesIntegrity === 'object') {
        modules = Object.entries(info.coreModulesIntegrity).map(([k, v]) => ({ name: k, ...v }));
      }

      let integrityEl = document.getElementById('appCoreModulesIntegrity');
      if (modules.length > 0) {
        if (!integrityEl) {
          integrityEl = document.createElement('div');
          integrityEl.id = 'appCoreModulesIntegrity';
          if (statusEl && statusEl.parentNode) {
            statusEl.parentNode.appendChild(integrityEl);
          } else {
            const container = document.getElementById('viewAppStudio')
              || document.getElementById('tab-app-studio')
              || document.body;
            if (container) container.appendChild(integrityEl);
          }
        }
        if (integrityEl) {
          integrityEl.style.display = 'flex';
          integrityEl.style.flexWrap = 'wrap';
          integrityEl.style.gap = '8px';
          integrityEl.style.marginTop = '8px';
          integrityEl.style.alignItems = 'center';

          const isRu = typeof currentLang !== 'undefined' && currentLang === 'ru';
          const labelText = isRu ? 'Целостность ядра:' : 'Core Modules:';

          const badgesHtml = modules.map(m => {
            const sz = m.size ? `${Math.round(m.size / 1024)} KB` : '0 KB';
            const isVerified = Boolean(m.verified);
            const isPresent = m.present !== false;
            let badgeColor = isVerified ? '#10b981' : (isPresent ? '#f59e0b' : '#ef4444');
            let badgeBg = isVerified ? 'rgba(16, 185, 129, 0.12)' : (isPresent ? 'rgba(245, 158, 11, 0.12)' : 'rgba(239, 68, 68, 0.12)');
            let badgeBorder = isVerified ? 'rgba(16, 185, 129, 0.3)' : (isPresent ? 'rgba(245, 158, 11, 0.3)' : 'rgba(239, 68, 68, 0.3)');
            let icon = isVerified ? '✓' : (isPresent ? '⚠️' : '❌');
            let statusText = isVerified ? (isRu ? 'проверен' : 'verified') : (isPresent ? (isRu ? 'не проверен' : 'unverified') : (isRu ? 'отсутствует' : 'missing'));

            return `<span class="badge" data-module="${esc(m.name)}" data-verified="${isVerified ? 'true' : 'false'}" style="background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder}; font-size: 11px; padding: 2px 8px; border-radius: 4px; font-family: monospace;">` +
              `${icon} ${esc(m.name)} (${sz}, ${statusText})</span>`;
          }).join(' ');

          integrityEl.innerHTML = `<span style="font-size: 11px; color: var(--text-muted);">${labelText}</span> ${badgesHtml}`;
        }
      } else if (integrityEl) {
        integrityEl.style.display = 'none';
        integrityEl.innerHTML = '';
      }
    }

    export function collectAppConfigFromForm() {
      const nameEl = document.getElementById('appBuildName');
      const shortNameEl = document.getElementById('appBuildShortName');
      const verEl = document.getElementById('appBuildVersion');
      const descEl = document.getElementById('appBuildDescription');
      const iconEl = document.getElementById('appIconType');
      const presetEl = document.getElementById('appPresetStyle');
      const colorEl = document.getElementById('appThemeColor');
      const bgEl = document.getElementById('appThemeBackground');
      const cardEl = document.getElementById('appThemeCard');
      const autoStartEl = document.getElementById('appAutoStart');
      const minEl = document.getElementById('appStartMinimized');
      const serviceEl = document.getElementById('appInstallService');
      const logEl = document.getElementById('appTrafficLogging');
      const legacyWin7El = document.getElementById('appLegacyWin7');
      const syncIntervalEl = document.getElementById('appSyncIntervalMinutes');
      const parsedInterval = syncIntervalEl ? parseInt(syncIntervalEl.value, 10) : 15;

      return {
        name: nameEl ? nameEl.value.trim() : 'PEC - Proxy Client',
        shortName: shortNameEl ? shortNameEl.value.trim() : 'PEC Client',
        version: verEl ? verEl.value.trim() : '2.2.0',
        description: descEl ? descEl.value.trim() : '',
        iconType: iconEl ? iconEl.value : 'shield',
        customIconDataUrl: (isAppCustomIconUploaded && currentAppCustomIconDataUrl) ? currentAppCustomIconDataUrl : undefined,
        presetStyle: presetEl ? presetEl.value : 'cyber-blue',
        uiLayout: currentAppLayout,
        inheritRoutingProfileId: (document.getElementById('branchAppInheritProfileSelect')?.value || document.getElementById('appRoutingProfileSelect')?.value || '').trim() || undefined,
        includeExtensionRules: Boolean(document.getElementById('branchAppIncludeExtensionRules')?.checked || document.getElementById('appIncludeExtensionRules')?.checked),
        defaultThemeMode: currentAppThemeMode || 'dark',
        themeColor: colorEl ? colorEl.value : '#0284c7',
        themeBackground: bgEl ? bgEl.value : '#0b1120',
        themeCard: cardEl ? cardEl.value : '#131d36',
        syncIntervalMinutes: isNaN(parsedInterval) ? 15 : Math.max(1, Math.min(1440, parsedInterval)),
        autoStartWithWindows: autoStartEl ? autoStartEl.checked : true,
        startMinimizedToTray: minEl ? minEl.checked : true,
        installAsService: serviceEl ? serviceEl.checked : false,
        trafficLogging: logEl ? logEl.checked : false,
        legacyWin7: legacyWin7El ? legacyWin7El.checked : false,
        processRules: currentAppRules || []
      };
    }

    export async function saveAppStudioConfigAction(silent = false) {
      const btn = document.getElementById('btnAppSaveConfig');
      let origHtml = '';
      if (btn) {
        if (btn.disabled) return false;
        btn.disabled = true;
        origHtml = btn.innerHTML;
        btn.innerHTML = '<span class="loading-spinner"></span> ' + (btn.textContent || '').trim();
      }
      const config = collectAppConfigFromForm();

      try {
        const res = await adminFetch('/api/app-builder/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config)
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && (data.ok || data.name || data.version || (data.ok !== false && !data.error))) {
          isAppStudioDirty = false;
          if (!silent) {
            toast(currentLang === 'ru' ? 'Настройки приложения успешно сохранены!' : 'App Studio settings saved successfully!', 'success');
          }
          return true;
        } else {
          toast(currentLang === 'ru' ? 'Ошибка сохранения: ' + (data.error || res.status) : 'Save error: ' + (data.error || res.status), 'error');
          return false;
        }
      } catch (e) {
        toast('Error saving app config: ' + e.message, 'error');
        return false;
      } finally {
        if (btn) {
          btn.disabled = false;
          if (origHtml) btn.innerHTML = origHtml;
        }
      }
    }

    export async function cleanAppBinariesAction() {
      const isRu = currentLang === 'ru';
      if (!await pecConfirm(isRu ? 'Удалить скомпилированные бинарники PEC-App для сборки с нуля?' : 'Clean compiled PEC-App binaries to build from scratch?', { isDanger: true })) {
        return;
      }
      const btn = document.getElementById('btnAppCleanBinaries');
      const statusEl = document.getElementById('appBuildStatusMsg');
      if (btn) btn.disabled = true;
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.color = 'var(--text-muted)';
        statusEl.textContent = isRu ? 'Очистка бинарников...' : 'Cleaning binaries...';
      }
      try {
        const res = await adminFetch('/api/app-builder/clean-binaries', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.style.color = 'var(--success)';
            statusEl.innerHTML = isRu
              ? `Бинарники очищены (${(data.deletedFiles || []).length} удалено, ${(data.preservedFiles || []).length} защищено) &bull; ${new Date().toLocaleTimeString()}`
              : `Binaries cleaned (${(data.deletedFiles || []).length} deleted, ${(data.preservedFiles || []).length} preserved) &bull; ${new Date().toLocaleTimeString()}`;
          }
          toast(isRu ? 'Бинарники успешно очищены. Теперь можно собрать с нуля.' : 'Binaries cleaned successfully. Ready for clean build.', 'success');
        } else {
          if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.style.color = 'var(--danger)';
            statusEl.textContent = (isRu ? 'Ошибка очистки: ' : 'Clean error: ') + (data.error || data.message || res.status);
          }
          toast((isRu ? 'Ошибка очистки: ' : 'Clean error: ') + (data.error || data.message || res.status), 'error');
        }
      } catch (e) {
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.style.color = 'var(--danger)';
          statusEl.textContent = 'Network error: ' + e.message;
        }
        toast('Clean failed: ' + e.message, 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    export async function buildAppBinariesAction() {
      const btn = document.getElementById('btnAppBuildBinaries');
      const statusEl = document.getElementById('appBuildStatusMsg');
      let origHtml = '';
      if (btn) {
        origHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="loading-spinner"></span> ' + (btn.textContent || '').trim();
      }
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.color = 'var(--text-muted)';
        statusEl.textContent = currentLang === 'ru' ? 'Компиляция и проверка бинарников PEC-App...' : 'Compiling and verifying PEC-App binaries...';
      }
      toast(currentLang === 'ru' ? 'Запуск сборки бинарников PEC-App...' : 'Starting binary build...', 'info');

      try {
        const saved = await saveAppStudioConfigAction(true);
        if (!saved) {
          if (btn) btn.disabled = false;
          return;
        }

        const startTime = Date.now();
        const verEl = document.getElementById('appBuildVersion');
        const targetVer = verEl ? verEl.value.trim() : '';
        const res = await adminFetch('/api/app-builder/build-binaries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ version: targetVer }),
        });
        const data = await res.json().catch(() => ({}));

        if (!data.ok) {
          const remVer = data.embeddedVersion || (data.info && data.info.embeddedVersion) || (data.info && data.info.version) || targetVer || '2.1.0';
          const isMissing = Boolean(data.compilerMissing || res.compilerMissing);
          let warnMsg = '';
          if (isMissing) {
            warnMsg = currentLang === 'ru'
              ? `Компилятор C/C++ (MinGW / MSVC) не обнаружен. Сборка не производилась. В шаблонах остаются бинарники v${remVer}`
              : `C/C++ compiler (MinGW / MSVC) not found. Compilation was not performed. Templates keep binaries v${remVer}`;
            showCompilerWarningModal(warnMsg);
          } else {
            warnMsg = data.message || (currentLang === 'ru' ? 'Ошибка компиляции бинарников' : 'Binary compilation failed');
          }

          if (Array.isArray(data.buildLog) && data.buildLog.length > 0) {
            lastAppBuildLog = data.buildLog;
            const logBtn = document.getElementById('btnAppViewBuildLog');
            if (logBtn) logBtn.style.display = 'inline-block';
          }

          if (data.info) {
            renderAppStudioBuildInfo(data.info);
          } else if (isMissing || !res.ok) {
            renderAppStudioBuildInfo({
              version: targetVer || '2.2.0',
              embeddedVersion: remVer,
              binariesStale: true,
              compilerMissing: isMissing,
              toolchain: data.toolchain || { available: !isMissing, compilerMissing: isMissing }
            });
          }

          if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.style.color = 'var(--danger, #ef4444)';
            statusEl.textContent = warnMsg;
          }
          toast(warnMsg, 'error');
        } else {
          // Render build info first so it does not overwrite the statusEl build message
          if (data.info) {
            renderAppStudioBuildInfo(data.info);
          }

          const executionTimeMs = Date.now() - startTime;
          const timeSec = (executionTimeMs / 1000).toFixed(1);
          const compiledVer = data.version || (data.info && data.info.version) || targetVer || '2.2.0';
          const filesCount = Array.isArray(data.builtFiles) ? data.builtFiles.length : 0;
          if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.style.color = 'var(--success)';
            statusEl.innerHTML = currentLang === 'ru'
              ? `Бинарники v${esc(compiledVer)} готовы (${esc(data.compiler || 'Toolchain')}, ${filesCount} файлов, ${timeSec}с): ${esc(data.message || 'OK')} &bull; ${new Date().toLocaleTimeString()}`
              : `Binaries v${esc(compiledVer)} ready (${esc(data.compiler || 'Toolchain')}, ${filesCount} files, ${timeSec}s): ${esc(data.message || 'OK')} &bull; ${new Date().toLocaleTimeString()}`;
          }
          if (Array.isArray(data.buildLog) && data.buildLog.length > 0) {
            lastAppBuildLog = data.buildLog;
            const logBtn = document.getElementById('btnAppViewBuildLog');
            if (logBtn) logBtn.style.display = 'inline-block';
          }
          const successMsg = currentLang === 'ru'
            ? `Сборка бинарников v${compiledVer} успешно выполнена (${timeSec} с)`
            : `Binaries v${compiledVer} compiled successfully (${timeSec}s)`;
          toast(successMsg, 'success');

          if (typeof loadAppStudioConfig === 'function') {
            await loadAppStudioConfig();
          }
        }
      } catch (e) {
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.style.color = 'var(--danger)';
          statusEl.textContent = 'Network error: ' + e.message;
        }
        toast('Binary build failed: ' + e.message, 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          if (origHtml) btn.innerHTML = origHtml;
        }
      }
    }

    export async function buildAppPackageAction() {
      const btn = document.getElementById('btnAppBuild');
      const statusEl = document.getElementById('appBuildStatusMsg');
      let origHtml = '';
      if (btn) {
        origHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="loading-spinner"></span> ' + (btn.textContent || '').trim();
      }
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.color = 'var(--text-muted)';
        statusEl.textContent = currentLang === 'ru' ? 'Сборка пакетов Windows и Linux...' : 'Packaging Windows and Linux distributions...';
      }
      toast(currentLang === 'ru' ? 'Запуск сборки пакетов приложения...' : 'Starting app packaging...', 'info');

      try {
        const saved = await saveAppStudioConfigAction(true);
        if (!saved) {
          return;
        }

        const currentFormConfig = collectAppConfigFromForm();
        const res = await adminFetch('/api/app-builder/build', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(currentFormConfig)
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          const info = data.info || data.result || {};
          renderAppStudioBuildInfo(info);
          const winSizeKb = Math.round((info.windowsPackageSize || 0) / 1024);
          const linSizeKb = Math.round((info.linuxPackageSize || 0) / 1024);
          const winSha = (info.windowsPackageSha256 || '').slice(0, 10);
          if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.style.color = 'var(--success)';
            statusEl.innerHTML = currentLang === 'ru'
              ? `Готово: Windows (${winSizeKb} KB, SHA: ${esc(winSha)}...), Linux (${linSizeKb} KB) &bull; ${new Date().toLocaleTimeString()}`
              : `Ready: Windows (${winSizeKb} KB, SHA: ${esc(winSha)}...), Linux (${linSizeKb} KB) &bull; ${new Date().toLocaleTimeString()}`;
          }
          const logEntries = (data.result && data.result.buildLog) || (data.info && data.info.buildLog) || data.buildLog;
          if (Array.isArray(logEntries) && logEntries.length > 0) {
            lastAppBuildLog = logEntries;
            const logBtn = document.getElementById('btnAppViewBuildLog');
            if (logBtn) logBtn.style.display = 'inline-block';
          }
          toast(currentLang === 'ru' ? 'Пакеты приложения успешно собраны!' : 'App packages built successfully!', 'success');
          loadReleases();
        } else {
          if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.style.color = 'var(--danger)';
            statusEl.textContent = currentLang === 'ru' ? 'Ошибка сборки: ' + (data.error || res.status) : 'Build error: ' + (data.error || res.status);
          }
          toast(currentLang === 'ru' ? 'Ошибка сборки приложения: ' + (data.error || res.status) : 'App build error: ' + (data.error || res.status), 'error');
        }
      } catch (e) {
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.style.color = 'var(--danger)';
          statusEl.textContent = 'Network error: ' + e.message;
        }
        toast('Build failed: ' + e.message, 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          if (origHtml) btn.innerHTML = origHtml;
        }
      }
    }

    export function renderAppProcessRulesTable() {
      const tbody1 = document.getElementById('appProcessRulesBody');
      const tbody2 = document.getElementById('branchAppProcessRulesBody');
      const targets = [tbody1, tbody2].filter(Boolean);
      if (targets.length === 0) return;

      if (!currentAppRules || currentAppRules.length === 0) {
        const emptyHtml = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 12px;">${currentLang === 'ru' ? 'Правила не настроены. Добавьте правило или примените пресет.' : 'No process rules defined. Add a rule or apply a preset.'}</td></tr>`;
        targets.forEach(t => { t.innerHTML = emptyHtml; });
        updateAppLivePreview();
        return;
      }

      let html = '';
      currentAppRules.forEach((rule, idx) => {
        const isProtoTcp = (rule.protocol || 'tcp') === 'tcp';
        const isProtoUdp = rule.protocol === 'udp';
        const isProtoBoth = rule.protocol === 'both';

        const isActProxy = (rule.action || 'proxy') === 'proxy';
        const isActDirect = rule.action === 'direct';
        const isActBlock = rule.action === 'block';

        html += `<tr>
          <td>
            <input type="text" class="app-rule-input" data-index="${idx}" data-field="processName" value="${esc(rule.processName || '')}" placeholder="chrome.exe; *" style="margin-bottom:0; font-size:11.5px; padding:4px 6px;" />
          </td>
          <td>
            <input type="text" class="app-rule-input" data-index="${idx}" data-field="targetDomains" value="${esc(rule.targetDomains || '*')}" placeholder="*.youtube.com; instagram.com" title="Сайты / Домены" style="margin-bottom:0; font-size:11.5px; padding:4px 6px;" />
          </td>
          <td>
            <input type="text" class="app-rule-input" data-index="${idx}" data-field="targetHosts" value="${esc(rule.targetHosts || '*')}" placeholder="* или 192.168.1.*" title="IP адреса или подсети CIDR" style="margin-bottom:0; font-size:11.5px; padding:4px 6px;" />
          </td>
          <td>
            <input type="text" class="app-rule-input" data-index="${idx}" data-field="targetPorts" value="${esc(rule.targetPorts || '*')}" placeholder="80; 443" style="margin-bottom:0; font-size:11.5px; padding:4px 6px;" />
          </td>
          <td>
            <select class="app-rule-select" data-index="${idx}" data-field="protocol" style="margin-bottom:0; font-size:11px; padding:4px 6px;">
              <option value="tcp"${isProtoTcp ? ' selected' : ''}>TCP</option>
              <option value="udp"${isProtoUdp ? ' selected' : ''}>UDP</option>
              <option value="both"${isProtoBoth ? ' selected' : ''}>TCP+UDP</option>
            </select>
          </td>
          <td>
            <select class="app-rule-select" data-index="${idx}" data-field="action" style="margin-bottom:0; font-size:11px; padding:4px 6px;">
              <option value="proxy"${isActProxy ? ' selected' : ''}>PROXY</option>
              <option value="direct"${isActDirect ? ' selected' : ''}>DIRECT</option>
              <option value="block"${isActBlock ? ' selected' : ''}>BLOCK</option>
            </select>
          </td>
          <td style="text-align: center;">
            <button type="button" class="btn-danger btn-delete-app-rule" data-index="${idx}" style="padding: 2px 7px; font-size: 11px; line-height: 1.2;">&times;</button>
          </td>
        </tr>`;
      });

      targets.forEach(t => { t.innerHTML = html; });
      updateAppLivePreview();
    }

    export function updateAppProcessRuleField(index, field, value) {
      isAppStudioDirty = true;
      if (currentAppRules && currentAppRules[index]) {
        currentAppRules[index][field] = value;
        if (field === 'processName' || field === 'action' || field === 'targetPorts') {
          updateAppLivePreview();
        }
      }
    }

    export function addNewAppProcessRule() {
      isAppStudioDirty = true;
      if (!Array.isArray(currentAppRules)) currentAppRules = [];
      const newRule = {
        id: 'rule_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        processName: '*',
        targetDomains: '*.youtube.com; *.instagram.com',
        targetHosts: '*',
        targetPorts: '80; 443',
        protocol: 'tcp',
        action: 'proxy'
      };
      currentAppRules.push(newRule);
      renderAppProcessRulesTable();
    }

    export function deleteAppProcessRule(index) {
      isAppStudioDirty = true;
      if (Array.isArray(currentAppRules) && index >= 0 && index < currentAppRules.length) {
        currentAppRules.splice(index, 1);
        renderAppProcessRulesTable();
      }
    }

    export function applyAppRulePreset(presetKey) {
      isAppStudioDirty = true;
      if (!Array.isArray(currentAppRules)) currentAppRules = [];
      if (presetKey === 'blocked_sites') {
        currentAppRules.push({
          id: 'rule_blocked_sites_' + Date.now(),
          processName: '*',
          targetDomains: '*.youtube.com; *.googlevideo.com; *.ytimg.com; *.twitter.com; *.x.com; *.instagram.com; *.linkedin.com',
          targetHosts: '*',
          targetPorts: '80; 443',
          protocol: 'tcp',
          action: 'proxy'
        });
      } else if (presetKey === 'browsers' || presetKey === 'browsers_direct') {
        currentAppRules.push({
          id: 'rule_browsers_' + Date.now(),
          processName: 'chrome.exe; msedge.exe; brave.exe; yandex.exe; firefox.exe',
          targetHosts: '*',
          targetPorts: '80; 443',
          protocol: 'tcp',
          action: 'direct'
        });
      } else if (presetKey === 'devtools') {
        currentAppRules.push({
          id: 'rule_devtools_' + Date.now(),
          processName: 'curl.exe; git.exe; powershell.exe; pwsh.exe; docker.exe; node.exe',
          targetHosts: '*',
          targetPorts: '80; 443; 22',
          protocol: 'tcp',
          action: 'proxy'
        });
      } else if (presetKey === 'tunnel') {
        currentAppRules.push({
          id: 'rule_tunnel_' + Date.now(),
          processName: '*',
          targetHosts: '*',
          targetPorts: '*',
          protocol: 'both',
          action: 'proxy'
        });
      }
      renderAppProcessRulesTable();
    }

    export function setAppPresetTheme(presetKey) {
      const palette = APP_THEME_PRESETS[presetKey];
      if (!palette) return;

      const select = document.getElementById('appPresetStyle');
      if (select) select.value = presetKey;

      const presetTitles = {
        'cyber-blue': 'Cyber Blue',
        'dark-obsidian': 'Dark Obsidian',
        'nordic-arctic': 'Nordic Arctic',
        'emerald-secops': 'Emerald SecOps',
        'enterprise-light': 'Enterprise Light',
        'emerald-sentinel': 'Emerald SecOps',
        'sunset-amber': 'Sunset Amber',
        'minimal-light': 'Minimal Light'
      };
      const badgeEl = document.getElementById('appPresetBadge');
      if (badgeEl) badgeEl.textContent = presetTitles[presetKey] || presetKey;

      const chips = {
        'cyber-blue': document.getElementById('chipAppPresetCyber'),
        'dark-obsidian': document.getElementById('chipAppPresetObsidian'),
        'nordic-arctic': document.getElementById('chipAppPresetNord'),
        'emerald-secops': document.getElementById('chipAppPresetEmerald'),
        'enterprise-light': document.getElementById('chipAppPresetLight'),
        'emerald-sentinel': document.getElementById('chipAppPresetEmerald'),
        'sunset-amber': document.getElementById('chipAppPresetSunset') || document.getElementById('chipAppPresetNord'),
        'minimal-light': document.getElementById('chipAppPresetLight')
      };
      Object.keys(chips).forEach(k => {
        if (chips[k]) chips[k].classList.toggle('active', k === presetKey);
      });

      const colorEl = document.getElementById('appThemeColor');
      const bgEl = document.getElementById('appThemeBackground');
      const cardEl = document.getElementById('appThemeCard');

      if (colorEl) colorEl.value = palette.primary;
      if (presetKey === 'minimal-light' || presetKey === 'enterprise-light') {
        currentAppThemeMode = 'light';
        const btnDark = document.getElementById('btnAppModeDark');
        const btnLight = document.getElementById('btnAppModeLight');
        if (btnDark) btnDark.classList.remove('active');
        if (btnLight) btnLight.classList.add('active');
        if (bgEl) bgEl.value = palette.lightBackground || '#f8fafc';
        if (cardEl) cardEl.value = palette.lightCard || '#ffffff';
      } else {
        currentAppThemeMode = 'dark';
        const btnDark = document.getElementById('btnAppModeDark');
        const btnLight = document.getElementById('btnAppModeLight');
        if (btnDark) btnDark.classList.add('active');
        if (btnLight) btnLight.classList.remove('active');
        if (bgEl) bgEl.value = palette.background || '#0b1120';
        if (cardEl) cardEl.value = palette.card || '#131d36';
      }

      updateAppLivePreview();
    }

    export function onAppPresetChange(val) {
      isAppStudioDirty = true;
      setAppPresetTheme(val);
    }

    export function setAppThemeMode(mode) {
      if (mode !== 'light' && mode !== 'dark') mode = 'dark';
      currentAppThemeMode = mode;
      isAppStudioDirty = true;

      const btnDark = document.getElementById('btnAppModeDark');
      const btnLight = document.getElementById('btnAppModeLight');
      if (btnDark) btnDark.classList.toggle('active', mode === 'dark');
      if (btnLight) btnLight.classList.toggle('active', mode === 'light');

      const preset = document.getElementById('appPresetStyle') ? document.getElementById('appPresetStyle').value : 'cyber-blue';
      const palette = APP_THEME_PRESETS[preset] || APP_THEME_PRESETS['cyber-blue'];

      const bgEl = document.getElementById('appThemeBackground');
      const cardEl = document.getElementById('appThemeCard');
      if (mode === 'light') {
        if (bgEl) bgEl.value = palette.lightBackground || '#f8fafc';
        if (cardEl) cardEl.value = palette.lightCard || '#ffffff';
      } else {
        if (bgEl) bgEl.value = palette.background || '#0b1120';
        if (cardEl) cardEl.value = palette.card || '#131d36';
      }

      updateAppLivePreview();
    }

    export function onAppCustomColorChange() {
      isAppStudioDirty = true;
      updateAppLivePreview();
    }

    export function onAppConfigChangeLive() {
      isAppStudioDirty = true;
      updateAppLivePreview();
    }

    function _switchPreviewWindowTabLegacy(tabKey: any) {
      const tabBtns = {
        rules: document.getElementById('btnPrevTabRules'),
        proxy: document.getElementById('btnPrevTabProxy'),
        settings: document.getElementById('btnPrevTabSettings'),
        log: document.getElementById('btnPrevTabLog')
      };
      const tabPanes = {
        rules: document.getElementById('prevTabRules'),
        proxy: document.getElementById('prevTabProxy'),
        settings: document.getElementById('prevTabSettings'),
        log: document.getElementById('prevTabLog')
      };

      Object.keys(tabBtns).forEach(k => {
        if (tabBtns[k]) tabBtns[k].classList.toggle('active', k === tabKey);
        if (tabPanes[k]) tabPanes[k].style.display = (k === tabKey) ? 'block' : 'none';
      });
    }

    export function updateAppLivePreview() {
      const previewWin = document.getElementById('appPreviewWindow');
      const isLight = currentAppThemeMode === 'light';
      if (typeof previewWin.setAttribute === 'function') {
        previewWin.setAttribute('data-app-layout', currentAppLayout || 'console');
        previewWin.setAttribute('data-app-theme-mode', isLight ? 'light' : 'dark');
      }

      const nameEl = document.getElementById('appBuildName');
      const titleEl = document.getElementById('appPreviewTitle');
      if (titleEl) {
        titleEl.textContent = (nameEl && nameEl.value.trim()) || 'PEC - Proxy Client';
      }

      const iconEl = document.getElementById('appIconType');
      const prevIconEl = document.getElementById('appPreviewIcon');
      if (prevIconEl && iconEl) {
        if (currentAppCustomIconDataUrl) {
          prevIconEl.innerHTML = `<img src="${currentAppCustomIconDataUrl}" style="width: 14px; height: 14px; border-radius: 2px; vertical-align: middle; object-fit: contain;" alt="icon" />`;
        } else {
          const iconMap = {
            shield: '🛡️',
            lock: '🔒',
            globe: '🌐',
            server: '🖥️',
            key: '🔑'
          };
          prevIconEl.textContent = iconMap[iconEl.value] || '🛡️';
        }
      }

      const colorEl = document.getElementById('appThemeColor');
      const bgEl = document.getElementById('appThemeBackground');
      const cardEl = document.getElementById('appThemeCard');

      let accent = (colorEl && colorEl.value) || (isLight ? '#2563eb' : '#0284c7');
      let bg = (bgEl && bgEl.value) || (isLight ? '#f1f5f9' : '#0b1120');
      let card = (cardEl && cardEl.value) || (isLight ? '#ffffff' : '#131d36');
      if (isLight) {
        if (/^#0[0-9a-f]{5}$/i.test(bg) || /^#1[0-9a-f]{5}$/i.test(bg) || /^#2[0-4][0-9a-f]{4}$/i.test(bg)) {
          bg = '#f1f5f9';
        }
        if (/^#0[0-9a-f]{5}$/i.test(card) || /^#1[0-9a-f]{5}$/i.test(card) || /^#2[0-4][0-9a-f]{4}$/i.test(card)) {
          card = '#ffffff';
        }
      }

      previewWin.style.setProperty('--app-accent', accent);
      previewWin.style.setProperty('--app-bg', bg);
      previewWin.style.setProperty('--app-card', card);
      previewWin.style.setProperty('--app-text', isLight ? '#0f172a' : '#f8fafc');

      const autoStart = document.getElementById('appAutoStart');
      const minTray = document.getElementById('appStartMinimized');
      const srv = document.getElementById('appInstallService');

      const prevAuto = document.getElementById('prevAutoStartVal');
      const prevMin = document.getElementById('prevMinimizeVal');
      const prevSrv = document.getElementById('prevServiceVal');

      if (prevAuto) {
        const on = autoStart ? autoStart.checked : true;
        prevAuto.textContent = on ? 'ВКЛ' : 'ВЫКЛ';
        prevAuto.style.color = on ? '#10b981' : '#64748b';
      }
      if (prevMin) {
        const on = minTray ? minTray.checked : true;
        prevMin.textContent = on ? 'ВКЛ' : 'ВЫКЛ';
        prevMin.style.color = on ? '#10b981' : '#64748b';
      }
      if (prevSrv) {
        const on = srv ? srv.checked : false;
        prevSrv.textContent = on ? 'ВКЛ' : 'ВЫКЛ';
        prevSrv.style.color = on ? '#10b981' : '#64748b';
      }

      const rulesListEl = document.getElementById('mockupRulesList');
      if (rulesListEl) {
        if (!currentAppRules || currentAppRules.length === 0) {
          rulesListEl.innerHTML = '<div style="font-size: 11px; color: #64748b; font-style: italic;">Правила не заданы (весь трафик DIRECT)</div>';
        } else {
          rulesListEl.innerHTML = currentAppRules.map(r => {
            const act = (r.action || 'proxy').toLowerCase();
            const badgeColor = act === 'proxy' ? '#0284c7' : act === 'direct' ? '#10b981' : '#ef4444';
            const badgeBg = act === 'proxy' ? 'rgba(2, 132, 199, 0.15)' : act === 'direct' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';
            return `<div class="mockup-rule-item">
              <div>
                <div style="font-weight: 600; color: var(--app-text, #f8fafc);">${esc(r.processName || '*')}</div>
                ${(r.targetDomains && r.targetDomains !== '*') ? `<div style="font-size: 10px; color: var(--app-accent, #0284c7); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px;" title="${esc(r.targetDomains)}">🌐 ${esc(r.targetDomains)}</div>` : ''}
              </div>
              <div style="display: flex; gap: 6px; align-items: center;">
                <span style="font-size: 10px; color: #94a3b8;">${esc(r.targetPorts || '*')}</span>
                <span style="font-size: 9.5px; padding: 1px 5px; border-radius: 4px; font-weight: 700; background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeColor};">${esc(act.toUpperCase())}</span>
              </div>
            </div>`;
          }).join('');
        }
      }

      const activeProxy = (currentProxiesList || []).find(p => p.isActive || p.active) || (currentProxiesList && currentProxiesList[0]);
      const nodeTagEl = document.getElementById('appPreviewNodeTag');
      const detailsEl = document.getElementById('prevActiveProxyDetails');
      if (activeProxy && activeProxy.host && activeProxy.port) {
        const proto = (activeProxy.type || activeProxy.protocol || 'SOCKS5').toUpperCase();
        const hostPort = activeProxy.host + ':' + activeProxy.port;
        if (nodeTagEl) nodeTagEl.textContent = `${proto} ${hostPort}`;
        if (detailsEl) detailsEl.textContent = `${proto} • ${hostPort}${activeProxy.name ? ' (' + activeProxy.name + ')' : ''}`;
      } else {
        if (nodeTagEl) nodeTagEl.textContent = 'DIRECT';
        if (detailsEl) detailsEl.textContent = currentLang === 'ru' ? 'Прямое подключение (DIRECT)' : 'Direct Connection (DIRECT)';
      }
    }

    export async function downloadAppPackageAction(platform) {
      if (typeof saveAppStudioConfigAction === 'function') {
        try { await saveAppStudioConfigAction(true); } catch (_) {}
      }
      toast((currentLang === 'ru' ? 'Скачивание пакета ' : 'Downloading package ') + platform + '...', 'info');
      try {
        const res = await adminFetch('/api/app-builder/download/' + platform);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          const errMsg = extractError(res, err, currentLang === 'ru' ? 'Пакет не найден или сборка завершилась ошибкой' : 'Package not found or build failed');
          toast((currentLang === 'ru' ? 'Ошибка скачивания: ' : 'Download error: ') + errMsg, 'error');
          return;
        }
        const blob = await res.blob();
        const verEl = document.getElementById('appBuildVersion');
        const curVer = (verEl && verEl.value.trim()) || '1.0.0';
        let filename = 'pec-client-windows-x64-' + curVer + '.zip';
        if (platform === 'linux') {
          filename = 'pec-client-linux-x64-' + curVer + '.tar.gz';
        } else if (platform === 'installer' || platform === 'setup' || platform === 'exe') {
          filename = 'PEC-App-Setup-' + curVer + '.exe';
        } else if (platform === 'msi') {
          filename = 'PEC-App-' + curVer + '.msi';
        }

        const cdHeader = res.headers ? res.headers.get('content-disposition') : null;
        if (cdHeader) {
          const match = cdHeader.match(/filename=["']?([^"';]+)["']?/i);
          if (match && match[1]) filename = match[1].trim();
        }

        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      } catch (e) {
        toast((currentLang === 'ru' ? 'Ошибка скачивания: ' : 'Download failed: ') + e.message, 'error');
      }
    }

    export async function downloadAppScriptAction(type) {
      const isVerify = type === 'verify';
      toast((currentLang === 'ru'
        ? (isVerify ? 'Скачивание скрипта проверки...' : 'Скачивание скрипта развёртывания...')
        : (isVerify ? 'Downloading verification script...' : 'Downloading deployment script...')), 'info');
      try {
        const res = await adminFetch('/api/app-builder/scripts/' + (type || 'deploy'));
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          const errMsg = extractError(res, err, currentLang === 'ru' ? 'Пакет не найден или сборка завершилась ошибкой' : 'Package not found or build failed');
          toast((currentLang === 'ru' ? 'Ошибка скачивания: ' : 'Download error: ') + errMsg, 'error');
          return;
        }
        const blob = await res.blob();
        const filename = isVerify ? 'verify-pec-app.ps1' : 'deploy-pec-app.ps1';
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      } catch (e) {
        toast((currentLang === 'ru' ? 'Ошибка скачивания: ' : 'Download failed: ') + e.message, 'error');
      }
    }


    export async function loadCodeSignStatus() {
      try {
        const res = await adminFetch('/api/app-builder/certificate');
        if (!res.ok) return;
        const data = await res.json();
        const cert = data.certificate;
        const badge = document.getElementById('badgeCodeSignStatus');
        const configView = document.getElementById('codeSignConfiguredView');
        const uploadView = document.getElementById('codeSignUploadView');

        if (cert && cert.hasCertificate) {
          if (badge) {
            badge.className = 'badge badge-online';
            badge.textContent = cert.type === 'internal' ? (currentLang === 'ru' ? 'Внутридоменный CA' : 'Internal CA') : (currentLang === 'ru' ? 'Коммерческий Authenticode' : 'Commercial Authenticode');
          }
          if (configView) configView.style.display = 'block';
          const subjEl = document.getElementById('csCertSubject');
          const issEl = document.getElementById('csCertIssuer');
          const valEl = document.getElementById('csCertValidity');
          const typeBadge = document.getElementById('csCertTypeBadge');
          const thumbEl = document.getElementById('csCertThumbprint');

          if (subjEl) subjEl.textContent = cert.subject || 'Enterprise Certificate';
          if (issEl) issEl.textContent = (currentLang === 'ru' ? 'Кем выдан: ' : 'Issuer: ') + (cert.issuer || 'N/A');
          if (valEl) valEl.textContent = (currentLang === 'ru' ? 'Действителен: ' : 'Valid: ') + (cert.validFrom ? new Date(cert.validFrom).toLocaleDateString() : '') + ' — ' + (cert.validTo ? new Date(cert.validTo).toLocaleDateString() : '');
          if (typeBadge) {
            typeBadge.className = cert.type === 'internal' ? 'badge badge-primary' : 'badge badge-online';
            typeBadge.textContent = cert.type === 'internal' ? 'AD CS (Внутридоменный)' : 'Commercial (Штамп времени)';
          }
          if (thumbEl) thumbEl.textContent = 'SHA: ' + (cert.thumbprint || '').slice(0, 16) + '...';
        } else {
          if (badge) {
            badge.className = 'badge badge-offline';
            badge.textContent = currentLang === 'ru' ? 'Не настроена' : 'Not configured';
          }
          if (configView) configView.style.display = 'none';
        }
      } catch (err) {
        console.warn('Failed to load code signing status:', err);
      }
    }

    export function onCodeSignTypeChange() {
      const typeEl = document.getElementById('csCertType');
      const tsEl = document.getElementById('csTimestampUrl');
      if (!typeEl || !tsEl) return;
      if (typeEl.value === 'internal') {
        tsEl.value = '';
        tsEl.placeholder = currentLang === 'ru' ? 'Не требуется (offline / внутридоменный CA)' : 'Not required (offline / internal CA)';
        tsEl.disabled = true;
      } else {
        tsEl.disabled = false;
        tsEl.value = 'http://timestamp.digicert.com';
        tsEl.placeholder = 'http://timestamp.digicert.com';
      }
    }

    export async function uploadCodeSignCertAction() {
      const fileInput = document.getElementById('csCertFile');
      const passInput = document.getElementById('csCertPassword');
      const typeSelect = document.getElementById('csCertType');
      const tsInput = document.getElementById('csTimestampUrl');
      const statusEl = document.getElementById('csUploadStatus');

      if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        toast(currentLang === 'ru' ? 'Выберите файл сертификата (.pfx / .p12)' : 'Select certificate file (.pfx / .p12)', 'error');
        return;
      }

      const file = fileInput.files[0];
      if (statusEl) {
        statusEl.textContent = currentLang === 'ru' ? 'Загрузка...' : 'Uploading...';
        statusEl.style.color = 'var(--text-muted)';
      }

      try {
        const reader = new FileReader();
        reader.onload = async function() {
          try {
            const base64 = String(reader.result).split(',')[1];
            const res = await adminFetch('/api/app-builder/certificate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                pfxBase64: base64,
                password: passInput ? passInput.value : '',
                type: typeSelect ? typeSelect.value : 'commercial',
                timestampUrl: tsInput ? tsInput.value : '',
              }),
            });
            const data = await res.json();
            if (res.ok && data.ok) {
              toast(currentLang === 'ru' ? 'Сертификат успешно сохранен и активирован' : 'Certificate successfully saved and activated', 'success');
              if (passInput) passInput.value = '';
              fileInput.value = '';
              if (statusEl) statusEl.textContent = '';
              await loadCodeSignStatus();
            } else {
              toast((currentLang === 'ru' ? 'Ошибка загрузки сертификата: ' : 'Certificate error: ') + (data.error || 'Unknown error'), 'error');
              if (statusEl) statusEl.textContent = data.error || 'Error';
            }
          } catch (e) {
            toast('Error: ' + e.message, 'error');
            if (statusEl) statusEl.textContent = e.message;
          }
        };
        reader.readAsDataURL(file);
      } catch (err) {
        toast('Error: ' + err.message, 'error');
      }
    }

    export async function deleteCodeSignCertAction() {
      if (!await pecConfirm(currentLang === 'ru' ? 'Удалить сохраненный сертификат цифровой подписи?' : 'Delete code signing certificate?', { isDanger: true })) return;
      try {
        const res = await adminFetch('/api/app-builder/certificate', { method: 'DELETE' });
        const data = await res.json();
        if (res.ok && data.ok) {
          toast(currentLang === 'ru' ? 'Сертификат удален' : 'Certificate removed', 'info');
          await loadCodeSignStatus();
        } else {
          toast('Error: ' + (data.error || 'Failed to delete certificate'), 'error');
        }
      } catch (err) {
        toast('Error: ' + err.message, 'error');
      }
    }

    export async function downloadAppProfileAction() {
      toast((currentLang === 'ru' ? 'Скачивание профиля PEC-App...' : 'Downloading PEC-App profile...'), 'info');
      try {
        const res = await adminFetch('/api/app-builder/profile');
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          const errMsg = extractError(res, err, currentLang === 'ru' ? 'Пакет не найден или сборка завершилась ошибкой' : 'Package not found or build failed');
          toast((currentLang === 'ru' ? 'Ошибка скачивания: ' : 'Download error: ') + errMsg, 'error');
          return;
        }
        const blob = await res.blob();
        const filename = 'pec_profile.pbprofile';
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      } catch (e) {
        toast((currentLang === 'ru' ? 'Ошибка скачивания: ' : 'Download failed: ') + e.message, 'error');
      }
    }

    window.openBuildLogModal = openBuildLogModal;
    window.closeBuildLogModal = closeBuildLogModal;
    window.copyBuildLogToClipboard = copyBuildLogToClipboard;
    window.openEditRuleModal = openEditRuleModal;
    window.closeEditRuleModal = closeEditRuleModal;
    window.saveEditedRule = saveEditedRule;
    window.setAppLayout = setAppLayout;
    window.importSelectedRoutingProfileRules = importSelectedRoutingProfileRules;
    window.renderAppStudioBuildInfo = renderAppStudioBuildInfo;

    export function switchRoutingBranch(branch) {
      const btnExt = document.getElementById('btnBranchExt');
      const btnApp = document.getElementById('btnBranchApp');
      const viewExt = document.getElementById('branchExtView');
      const viewApp = document.getElementById('branchAppView');

      if (branch === 'app') {
        if (btnApp) btnApp.classList.add('active');
        if (btnExt) btnExt.classList.remove('active');
        if (viewApp) viewApp.style.display = 'block';
        if (viewExt) viewExt.style.display = 'none';
        renderAppProcessRulesTable();
        loadAppRoutingProfilesDropdown();
      } else {
        if (btnExt) btnExt.classList.add('active');
        if (btnApp) btnApp.classList.remove('active');
        if (viewExt) viewExt.style.display = 'block';
        if (viewApp) viewApp.style.display = 'none';
      }
    }

    export function onBranchAppIncludeExtRulesChange() {
      const chk = document.getElementById('branchAppIncludeExtensionRules');
      const container = document.getElementById('branchAppInheritProfileContainer');
      if (container) {
        container.style.display = chk && chk.checked ? 'block' : 'none';
      }
      const appChk = document.getElementById('appIncludeExtensionRules');
      if (appChk && chk && appChk.checked !== chk.checked) {
        appChk.checked = chk.checked;
      }
    }

    export function onBranchAppInheritProfileChange() {
      const sel = document.getElementById('branchAppInheritProfileSelect');
      const appSel = document.getElementById('appRoutingProfileSelect');
      if (sel && appSel && appSel.value !== sel.value) {
        appSel.value = sel.value;
      }
    }

    export async function saveAppRulesBranch() {
      const btn = document.getElementById('btnSaveAppRulesBranch');
      const statusEl = document.getElementById('branchAppSaveStatus');
      if (btn) btn.disabled = true;
      if (statusEl) {
        statusEl.textContent = currentLang === 'ru' ? 'Сохранение...' : 'Saving...';
        statusEl.style.color = 'var(--text-muted)';
      }

      const includeExt = Boolean(document.getElementById('branchAppIncludeExtensionRules')?.checked);
      const inheritProfileId = document.getElementById('branchAppInheritProfileSelect')?.value || '';

      try {
        const res = await adminFetch('/api/app-rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rules: currentAppRules || [],
            includeExtensionRules: includeExt,
            inheritRoutingProfileId: inheritProfileId
          })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          if (currentAppConfig) {
            currentAppConfig.processRules = data.rules;
            currentAppConfig.includeExtensionRules = data.includeExtensionRules;
            currentAppConfig.inheritRoutingProfileId = data.inheritRoutingProfileId;
          }
          isAppStudioDirty = false;
          toast(currentLang === 'ru' ? 'Правила десктоп-клиента успешно сохранены и применены!' : 'Desktop app rules saved and applied!', 'success');
          if (statusEl) {
            statusEl.textContent = (currentLang === 'ru' ? 'Сохранено: ' : 'Saved: ') + new Date().toLocaleTimeString();
            statusEl.style.color = 'var(--success, #10b981)';
          }
        } else {
          toast(currentLang === 'ru' ? 'Ошибка сохранения: ' + (data.error || res.status) : 'Save error: ' + (data.error || res.status), 'error');
          if (statusEl) {
            statusEl.textContent = currentLang === 'ru' ? 'Ошибка' : 'Error';
            statusEl.style.color = 'var(--danger, #ef4444)';
          }
        }
      } catch (err) {
        toast('Error saving desktop rules: ' + err.message, 'error');
        if (statusEl) {
          statusEl.textContent = currentLang === 'ru' ? 'Сбой' : 'Failed';
          statusEl.style.color = 'var(--danger, #ef4444)';
        }
      } finally {
        if (btn) btn.disabled = false;
      }
    }
    
    const APP_PALETTES = {
      cyber: { accent: '#38bdf8', bg: '#0b1120', card: '#131d36', lightBg: '#f0f9ff', lightCard: '#ffffff', style: 'cyber-blue' },
      obsidian: { accent: '#c084fc', bg: '#0d1117', card: '#161b22', lightBg: '#faf5ff', lightCard: '#ffffff', style: 'dark-obsidian' },
      nord: { accent: '#88c0d0', bg: '#242933', card: '#2e3440', lightBg: '#f8fafc', lightCard: '#ffffff', style: 'nordic-arctic' },
      emerald: { accent: '#34d399', bg: '#06130d', card: '#0b1f16', lightBg: '#f0fdf4', lightCard: '#ffffff', style: 'emerald-secops' },
      amber: { accent: '#f59e0b', bg: '#1c1307', card: '#261805', lightBg: '#fffbeb', lightCard: '#ffffff', style: 'sunset-amber' },
      sunset: { accent: '#f59e0b', bg: '#1c1307', card: '#261805', lightBg: '#fffbeb', lightCard: '#ffffff', style: 'sunset-amber' },
      light: { accent: '#2563eb', bg: '#0b1120', card: '#131d36', lightBg: '#f1f5f9', lightCard: '#ffffff', style: 'enterprise-light' }
    };

    export function setAppPalette(paletteKey, isUserAction = true) {
      const p = APP_PALETTES[paletteKey];
      if (!p) return;
      if (isUserAction) isAppStudioDirty = true;

      const colorEl = document.getElementById('appThemeColor');
      const bgEl = document.getElementById('appThemeBackground');
      const cardEl = document.getElementById('appThemeCard');
      const styleEl = document.getElementById('appPresetStyle');
      const isLight = currentAppThemeMode === 'light';

      if (colorEl) colorEl.value = p.accent;
      if (bgEl) bgEl.value = isLight ? (p.lightBg || '#f1f5f9') : p.bg;
      if (cardEl) cardEl.value = isLight ? (p.lightCard || '#ffffff') : p.card;
      if (styleEl) styleEl.value = p.style;

      const presetTitles = {
        cyber: 'Cyber Blue',
        obsidian: 'Dark Obsidian',
        nord: 'Nordic Arctic',
        emerald: 'Emerald SecOps',
        amber: 'Sunset Amber',
        sunset: 'Sunset Amber',
        light: 'Enterprise Light',
      };
      const badgeEl = document.getElementById('appPresetBadge');
      if (badgeEl && presetTitles[paletteKey]) badgeEl.textContent = presetTitles[paletteKey];

      ['Cyber', 'Obsidian', 'Nord', 'Emerald', 'Light'].forEach(name => {
        const chip = document.getElementById('chipAppPalette' + name);
        if (chip) {
          if (name.toLowerCase() === paletteKey) chip.classList.add('active');
          else chip.classList.remove('active');
        }
      });

      updateAppLivePreview();
    }

    export function toggleVersionPopover(e) {
      if (e) e.stopPropagation();
      const popover = document.getElementById('popoverVersionRelease');
      if (!popover) return;
      const isVisible = popover.style.display === 'block';
      closeCustomizationPopover();
      popover.style.display = isVisible ? 'none' : 'block';
      if (!isVisible) {
        refreshGitHubReleasesNow();
      }
    }

    export function closeVersionPopover() {
      const popover = document.getElementById('popoverVersionRelease');
      if (popover) popover.style.display = 'none';
    }

    export async function refreshGitHubReleasesNow() {
      const badge = document.getElementById('hdrGhUpdateBadge');
      const info = document.getElementById('hdrGhLatestInfo');
      const list = document.getElementById('hdrGhReleasesList');
      const updateDot = document.getElementById('versionUpdateDot');

      if (badge) {
        badge.textContent = currentLang === 'ru' ? 'Проверка...' : 'Checking...';
        badge.className = 'badge badge-online';
      }

      try {
        let res = null;
        try {
          res = await adminFetch('/api/github/releases');
          if (res.status === 404) {
            res = await adminFetch('/api/releases/github');
          }
        } catch (netErr) {}

        let data = null;
        if (res && res.ok) {
          data = await res.json();
        } else {
          // Direct fallback from browser to GitHub API if server is 404/500/offline
          try {
            const ghRes = await fetch('https://api.github.com/repos/vlv-code/PEC/releases', {
              headers: { Accept: 'application/vnd.github.v3+json' }
            });
            if (ghRes.ok) {
              const rawReleases = await ghRes.json();
              const serverVer = (document.getElementById('versionReleaseBadge')?.getAttribute('data-server-version')) || '1.0.0';
              const releases = Array.isArray(rawReleases) ? rawReleases.map(r => ({
                tag: r.tag_name || '',
                name: r.name || r.tag_name || '',
                publishedAt: r.published_at || '',
                htmlUrl: r.html_url || 'https://github.com/vlv-code/PEC/releases'
              })) : [];
              const latestRelease = releases[0] || null;
              const latestVer = latestRelease ? (latestRelease.tag || '').replace(/^v/, '') : '';
              const isUpdate = Boolean(latestVer && latestVer !== serverVer);
              data = {
                currentVersion: serverVer,
                latestRelease,
                releases,
                updateAvailable: isUpdate,
                hasUpdate: isUpdate
              };
            }
          } catch (directErr) {}
        }

        if (!data) throw new Error('Release check failed');
        cachedReleases = data;

        const isUpdate = Boolean(data.updateAvailable || data.hasUpdate);
        if (updateDot) {
          updateDot.style.display = isUpdate ? 'block' : 'none';
        }

        if (badge) {
          if (isUpdate) {
            badge.textContent = currentLang === 'ru' ? 'Доступно обновление!' : 'Update Available!';
            badge.className = 'badge badge-action-direct';
          } else {
            badge.textContent = currentLang === 'ru' ? 'Актуальная версия' : 'Up to date';
            badge.className = 'badge badge-online';
          }
        }

        if (info && data.latestRelease) {
          info.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center;">
            <span>${currentLang === 'ru' ? 'Последний релиз:' : 'Latest:'} <strong>${esc(data.latestRelease.name || data.latestRelease.tag || '')}</strong></span>
            <span style="font-size:10px; color:var(--text-muted);">${data.latestRelease.publishedAt ? new Date(data.latestRelease.publishedAt).toLocaleDateString() : ''}</span>
          </div>`;
        }

        if (list && Array.isArray(data.releases) && data.releases.length > 0) {
          list.innerHTML = data.releases.slice(0, 4).map(r => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:3px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
              <span style="font-weight:600; color:var(--primary);">${esc(r.tag || r.name)}</span>
              <a href="${esc(r.htmlUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--text-muted); text-decoration:none; font-size:10px;">Открыть &rarr;</a>
            </div>
          `).join('');
        }
      } catch (err) {
        if (badge) {
          badge.textContent = currentLang === 'ru' ? 'Не удалось проверить' : 'Check failed';
          badge.className = 'badge badge-offline';
        }
        if (info) {
          info.innerHTML = `<span style="color:var(--text-muted); font-size:11px;">${currentLang === 'ru' ? 'Релизы на GitHub:' : 'Releases on GitHub:'}</span>`;
        }
        if (list) {
          list.innerHTML = `<div style="padding:4px 0; text-align:center;"><a href="https://github.com/vlv-code/PEC/releases" target="_blank" rel="noopener noreferrer" style="color:var(--primary); font-size:11.5px; text-decoration:none;">github.com/vlv-code/PEC/releases &rarr;</a></div>`;
        }
      }
    }

    export function switchPreviewWindowTab(tabKey) {
      const tabs = ['main', 'traffic', 'rules', 'log', 'settings'];
      tabs.forEach(t => {
        const btn = document.getElementById('btnPrevTab' + t.charAt(0).toUpperCase() + t.slice(1));
        const pane = document.getElementById('prevTab' + t.charAt(0).toUpperCase() + t.slice(1));
        if (btn) {
          if (t === tabKey) btn.classList.add('active');
          else btn.classList.remove('active');
        }
        if (pane) {
          pane.style.display = (t === tabKey) ? 'block' : 'none';
        }
      });
    }

    let cachedRoutingProfilesList = [];

    export function onAppRuleInheritModeChange() {
      const isSpecific = document.getElementById('appRuleInheritModeSpecific')?.checked;
      const container = document.getElementById('branchAppSpecificRulesContainer');
      if (container) {
        container.style.display = isSpecific ? 'block' : 'none';
      }
    }

    export async function renderBranchAppSpecificRules(profileId, selectedRuleIds = []) {
      const container = document.getElementById('branchAppSpecificRulesContainer');
      if (!container) return;

      if (!profileId) {
        container.innerHTML = '<div style="color:var(--text-muted); font-size:11px;">' + (currentLang === 'ru' ? 'Выберите профиль расширений выше' : 'Select extension profile above') + '</div>';
        return;
      }

      try {
        if (!cachedRoutingProfilesList || cachedRoutingProfilesList.length === 0) {
          const res = await adminFetch('/api/routing/profiles');
          if (res.ok) cachedRoutingProfilesList = (await res.json()) || [];
        }

        const profile = cachedRoutingProfilesList.find(p => p.id === profileId);
        if (!profile || !Array.isArray(profile.rules) || profile.rules.length === 0) {
          container.innerHTML = '<div style="color:var(--text-muted); font-size:11px;">' + (currentLang === 'ru' ? 'В этом профиле нет правил' : 'No rules in this profile') + '</div>';
          return;
        }

        let html = '<div style="font-size:10.5px; font-weight:600; color:var(--text-muted); margin-bottom:4px;">' + (currentLang === 'ru' ? 'Отметьте правила для подмешивания в клиент:' : 'Select rules to inject:') + '</div>';
        profile.rules.forEach(r => {
          const isChecked = selectedRuleIds.length === 0 || selectedRuleIds.includes(r.id);
          const actColor = r.action === 'block' ? '#ef4444' : (r.action === 'direct' ? '#10b981' : '#38bdf8');
          html += `<label style="display:flex; align-items:center; gap:6px; margin-bottom:4px; cursor:pointer; font-size:11px;">
            <input type="checkbox" class="branch-app-rule-checkbox" value="${esc(r.id)}" ${isChecked ? 'checked' : ''} style="margin:0; width:14px; height:14px;" />
            <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:${actColor};"></span>
            <span style="font-weight:600; flex:1; overflow:hidden; text-overflow:ellipsis;">${esc(r.name || r.pattern || r.id)}</span>
            <span style="font-size:10px; color:${actColor}; font-weight:bold; text-transform:uppercase;">${esc(r.action || 'proxy')}</span>
          </label>`;
        });

        container.innerHTML = html;
      } catch (err) {
        container.innerHTML = '<div style="color:var(--danger); font-size:11px;">Ошибка загрузки правил</div>';
      }
    }
    window.loadAppStudioConfig = loadAppStudioConfig;
    window.setAppPalette = setAppPalette;
    window.setServerTheme = setServerTheme;
    window.setServerThemeMode = setServerThemeMode;
    window.setGlobalBrandIcon = setGlobalBrandIcon;
    window.setGlobalBrandIconSource = setGlobalBrandIconSource;
    window.setGlobalBrandCustomIcon = setGlobalBrandCustomIcon;
    window.clearGlobalBrandCustomIcon = clearGlobalBrandCustomIcon;
    window.onGlobalBrandIconFileSelected = onGlobalBrandIconFileSelected;
    window.setAppCustomIconDataUrl = setAppCustomIconDataUrl;
    window.clearAppCustomIcon = clearAppCustomIcon;
    window.onAppIconFileSelected = onAppIconFileSelected;
    window.toggleSyncThemeWithApps = toggleSyncThemeWithApps;
    window.applyThemeSyncToConstructors = applyThemeSyncToConstructors;
    window.toggleVersionPopover = toggleVersionPopover;
    window.closeVersionPopover = closeVersionPopover;
    window.refreshGitHubReleasesNow = refreshGitHubReleasesNow;
    window.switchPreviewWindowTab = switchPreviewWindowTab;
    window.onAppRuleInheritModeChange = onAppRuleInheritModeChange;
    window.renderBranchAppSpecificRules = renderBranchAppSpecificRules;
    window.switchRoutingBranch = switchRoutingBranch;
    window.onBranchAppIncludeExtRulesChange = onBranchAppIncludeExtRulesChange;
    window.onBranchAppInheritProfileChange = onBranchAppInheritProfileChange;
    window.saveAppRulesBranch = saveAppRulesBranch;
    window.saveAppStudioConfigAction = saveAppStudioConfigAction;
    window.cleanAppBinariesAction = cleanAppBinariesAction;
    window.buildAppBinariesAction = buildAppBinariesAction;
    window.showCompilerWarningModal = showCompilerWarningModal;
    window.closeCompilerWarningModal = closeCompilerWarningModal;
    window.buildAppPackageAction = buildAppPackageAction;
    window.updateAppLivePreview = updateAppLivePreview;
    window.importSelectedRoutingProfileRules = importSelectedRoutingProfileRules;
    window.importRoutingRulesToApp = importSelectedRoutingProfileRules;
    window.addNewAppProcessRule = addNewAppProcessRule;
    window.deleteAppProcessRule = deleteAppProcessRule;
    window.setAppPresetTheme = setAppPresetTheme;
    window.setAppThemeMode = setAppThemeMode;
    window.switchPreviewWindowTab = switchPreviewWindowTab;

// Register Modal Closers
registerModalCloser('modalCompilerWarning', closeCompilerWarningModal);
registerModalCloser('modalBuildLog', closeBuildLogModal);

// Window sync
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'isAppStudioDirty', {
    get() { return isAppStudioDirty; },
    set(v) { isAppStudioDirty = Boolean(v); state.isAppStudioDirty = Boolean(v); },
    configurable: true
  });
  Object.defineProperty(window, 'currentAppRules', {
    get() { return currentAppRules; },
    set(v) { currentAppRules = Array.isArray(v) ? v : []; },
    configurable: true
  });
  Object.defineProperty(window, 'currentAppConfig', {
    get() { return currentAppConfig; },
    set(v) { currentAppConfig = v; state.currentAppStudioConfig = v; },
    configurable: true
  });
}

export function setIsAppStudioDirty(val: boolean) {
  isAppStudioDirty = Boolean(val);
  state.isAppStudioDirty = Boolean(val);
}
