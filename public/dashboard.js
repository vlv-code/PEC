    window.addEventListener('unhandledrejection', function(event) {
      if (event.reason && (event.reason.name === 'TypeError' || String(event.reason).includes('fetch') || String(event.reason).includes('Failed to fetch'))) {
        console.warn('Network request error safely handled:', event.reason);
        event.preventDefault();
      }
    });

    let globalGpo = null;
    let globalKillSwitch = false;
    let allProfiles = [];
    let currentProfile = null;
    let extensionFiles = {};
    let currentLang = 'ru';
    let currentProxiesList = [];

    // ----------------- Admin Authentication -----------------
    // Server-side sessions: the browser never holds the admin token. The
    // operator logs in once (POST /api/auth/login) and receives an HttpOnly
    // session cookie; every management API call carries only the CSRF marker
    // header. Admin routes authenticate via that cookie - the fleet token
    // (X-Ext-Token) is deliberately NOT accepted there.
    function showLoginModal() {
      const m = document.getElementById('loginModal');
      if (m) m.style.display = 'flex';
      const i = document.getElementById('loginUsernameInput');
      if (i) i.focus();
    }
    function hideLoginModal() {
      const m = document.getElementById('loginModal');
      if (m) m.style.display = 'none';
    }
    function setLoginError(msg) {
      const el = document.getElementById('loginError');
      if (el) {
        el.textContent = msg || '';
        el.style.display = msg ? 'block' : 'none';
      }
    }
    let loginPendingRetry = null;
    async function adminFetch(url, opts) {
      opts = opts || {};
      opts.credentials = 'same-origin';
      opts.headers = Object.assign({}, opts.headers || {}, { 'X-Requested-With': 'pec-dashboard' });
      const res = await fetch(url, opts);
      if (res.status === 401) {
        loginPendingRetry = { url: url, opts: opts };
        showLoginModal();
      }
      return res;
    }
    async function handleLoginSubmit() {
      const userInput = document.getElementById('loginUsernameInput');
      const input = document.getElementById('loginTokenInput');
      const u = ((userInput && userInput.value) || '').trim();
      const v = ((input && input.value) || '').trim();
      if (!u) { if (userInput) userInput.focus(); return; }
      if (!v) { if (input) input.focus(); return; }
      const btn = document.getElementById('loginSubmitBtn');
      if (btn) btn.disabled = true;
      setLoginError('');
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: u, password: v })
        });
        if (res.ok) {
          if (userInput) userInput.value = '';
          if (input) input.value = '';
          hideLoginModal();
          if (loginPendingRetry) {
            const r = loginPendingRetry;
            loginPendingRetry = null;
            adminFetch(r.url, r.opts).catch(function (e) { console.warn('Retry after login failed:', e); });
          } else {
            bootDashboard();
          }
        } else {
          const data = await res.json().catch(() => ({}));
          setLoginError(data.error || 'Ошибка входа (HTTP ' + res.status + ')');
        }
      } catch (e) {
        setLoginError('Сетевая ошибка: ' + e);
      } finally {
        if (btn) btn.disabled = false;
      }
    }
    async function logoutDashboard() {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'X-Requested-With': 'pec-dashboard' }
        });
      } catch (e) {}
      showLoginModal();
    }
    // ----------------- Account settings: change login / password -----------------
    function setCredError(msg) {
      const el = document.getElementById('credError');
      if (el) {
        el.textContent = msg || '';
        el.style.display = msg ? 'block' : 'none';
      }
    }
    async function openCredsModal() {
      setCredError('');
      const cur = document.getElementById('credCurrentPassword');
      const un = document.getElementById('credUsernameInput');
      const np = document.getElementById('credNewPassword');
      if (cur) cur.value = '';
      if (np) np.value = '';
      // Prefill the current username from the server session
      try {
        const res = await adminFetch('/api/auth/session');
        const data = await res.json();
        if (un && data.username) un.value = data.username;
      } catch (e) {}
      const m = document.getElementById('credsModal');
      if (m) m.style.display = 'flex';
      if (cur) cur.focus();
    }
    function closeCredsModal() {
      const m = document.getElementById('credsModal');
      if (m) m.style.display = 'none';
    }
    async function submitCredsChange() {
      const cur = document.getElementById('credCurrentPassword');
      const un = document.getElementById('credUsernameInput');
      const np = document.getElementById('credNewPassword');
      const currentPassword = (cur && cur.value) || '';
      const newUsername = ((un && un.value) || '').trim();
      const newPassword = (np && np.value) || '';
      if (!currentPassword) { setCredError('Введите текущий пароль'); if (cur) cur.focus(); return; }
      if (!newUsername && !newPassword) { setCredError('Укажите новый логин и/или новый пароль'); return; }
      const btn = document.getElementById('credSubmitBtn');
      if (btn) btn.disabled = true;
      setCredError('');
      try {
        const res = await adminFetch('/api/auth/credentials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword, newUsername: newUsername || undefined, newPassword: newPassword || undefined })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          closeCredsModal();
          toast('Учётные данные обновлены. Другие сессии завершены.', 'success');
        } else {
          setCredError(data.error || 'Не удалось сохранить (HTTP ' + res.status + ')');
        }
      } catch (e) {
        setCredError('Сетевая ошибка: ' + e);
      } finally {
        if (btn) btn.disabled = false;
      }
    }
    function bootDashboard() {
      refreshAll();
      if (!window.__pecTimers) {
        window.__pecTimers = setInterval(loadInstances, 5000);
        setInterval(fetchStatus, 10000);
      }
    }

    // ----------------- HTML Escaping -----------------
    // Every value rendered through innerHTML must pass through esc().
    // Fleet data (instanceId, ip, version, group), audit details, rule names
    // and patterns are all attacker-influencable via /api/sync payloads and
    // X-Forwarded-For; unescaped rendering gave stored XSS in the console.
    function esc(value) {
      return String(value == null ? '' : value).replace(/[&<>"'`]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c];
      });
    }
    const escapeHtml = esc;

    function t(key, fallback) {
      const dict = (typeof I18N !== 'undefined' && I18N[currentLang]) || {};
      return dict[key] || fallback || key;
    }

    // ----------------- Toast notifications -----------------
    // Non-blocking feedback replacing window.alert() (which froze the whole
    // tab and made bulk operations painful).
    function toast(message, type) {
      let host = document.getElementById('toastHost');
      if (!host) {
        host = document.createElement('div');
        host.id = 'toastHost';
        host.style.cssText = 'position: fixed; bottom: 18px; right: 18px; z-index: 10000; display: flex; flex-direction: column; gap: 8px; max-width: 380px;';
        document.body.appendChild(host);
      }
      const el = document.createElement('div');
      const colors = type === 'error'
        ? 'background: #7f1d1d; border: 1px solid #ef4444;'
        : type === 'success'
          ? 'background: #064e3b; border: 1px solid #10b981;'
          : 'background: #1e293b; border: 1px solid #475569;';
      el.style.cssText = colors + ' color: #f8fafc; padding: 10px 14px; border-radius: 8px; font-size: 12.5px; box-shadow: 0 6px 18px rgba(0,0,0,0.35); word-break: break-word;';
      el.textContent = message; // textContent: no HTML injection surface
      host.appendChild(el);
      setTimeout(function () {
        el.style.transition = 'opacity 0.4s';
        el.style.opacity = '0';
        setTimeout(function () { el.remove(); }, 420);
      }, 4200);
    }

    // ----------------- Layout & Theme Switchers -----------------
    function setServerLayout(layout) {
      if (layout !== 'terminal' && layout !== 'console') {
        layout = 'console';
      }
      document.body.setAttribute('data-layout', layout);
      try { localStorage.setItem('pec_server_layout', layout); } catch(e){}
      updateModalActiveState();
    }

    function setServerTheme(theme) {
      if (!theme) theme = 'cyber';
      document.body.setAttribute('data-theme', theme);
      try { localStorage.setItem('pec_server_theme', theme); } catch(e){}
      updateModalActiveState();
    }

    function toggleCustomizationPopover(e) {
      if (e && e.stopPropagation) e.stopPropagation();
      const popover = document.getElementById('popoverCustomization');
      const btn = document.getElementById('btnCustomization');
      if (!popover) return;
      const isOpen = popover.style.display !== 'none';
      if (isOpen) {
        closeCustomizationPopover();
      } else {
        popover.style.display = 'block';
        if (btn) btn.classList.add('active');
        updateModalActiveState();
      }
    }

    function closeCustomizationPopover() {
      const popover = document.getElementById('popoverCustomization');
      const btn = document.getElementById('btnCustomization');
      if (popover) popover.style.display = 'none';
      if (btn) btn.classList.remove('active');
    }

    function openCustomizationModal() { toggleCustomizationPopover(); }
    function closeCustomizationModal() { closeCustomizationPopover(); }

    document.addEventListener('click', function(e) {
      const popover = document.getElementById('popoverCustomization');
      const btn = document.getElementById('btnCustomization');
      if (popover && popover.style.display !== 'none') {
        if (!popover.contains(e.target) && (!btn || !btn.contains(e.target))) {
          closeCustomizationPopover();
        }
      }
    });

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        closeCustomizationPopover();
      }
    });

    function updateModalActiveState() {
      const currentLayout = document.body.getAttribute('data-layout') || 'console';
      const currentTheme = document.body.getAttribute('data-theme') || 'cyber';
      
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

      const themeBtns = {
        cyber: document.getElementById('btnThemeCyber'),
        obsidian: document.getElementById('btnThemeObsidian'),
        nord: document.getElementById('btnThemeNord'),
        emerald: document.getElementById('btnThemeEmerald'),
        light: document.getElementById('btnThemeLight'),
      };
      Object.keys(themeBtns).forEach(k => {
        const btn = themeBtns[k];
        if (btn) {
          if (k === currentTheme) btn.classList.add('active');
          else btn.classList.remove('active');
        }
      });
    }

    // ----------------- GitHub Releases & Version Control -----------------
    let cachedReleases = null;
    async function checkGitHubReleases(forceRefresh = false) {
      const container = document.getElementById('ghReleaseContent');
      const badge = document.getElementById('versionReleaseBadge');
      if (!container) return;

      if (!forceRefresh && cachedReleases) {
        renderGitHubReleases(cachedReleases);
        return;
      }

      container.innerHTML = `<span style="color: var(--text-muted);">${currentLang === 'ru' ? 'Запрос к GitHub Releases API...' : 'Fetching GitHub Releases API...'}</span>`;

      try {
        const res = await adminFetch('/api/github/releases');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        cachedReleases = data;
        renderGitHubReleases(data);
        if (badge && data.currentVersion) {
          badge.textContent = 'v' + data.currentVersion;
          if (data.updateAvailable) {
            badge.className = 'badge badge-action-direct';
            badge.title = (currentLang === 'ru' ? 'Доступна новая версия: v' : 'New version available: v') + data.latestRelease.version;
          } else {
            badge.className = 'badge badge-online';
            badge.title = currentLang === 'ru' ? 'Актуальная версия' : 'Latest version installed';
          }
        }
      } catch (err) {
        container.innerHTML = `<div style="color: var(--danger); font-size: 11.5px;">${currentLang === 'ru' ? 'Не удалось загрузить данные релизов GitHub (автономный режим).' : 'Unable to query GitHub releases (offline mode).'}<br><code style="color: var(--text-muted); font-size: 11px;">${err.message}</code></div>`;
      }
    }

    function renderGitHubReleases(data) {
      const container = document.getElementById('ghReleaseContent');
      if (!container || !data) return;

      const isRu = currentLang === 'ru';
      let html = `<div style="display: flex; gap: 16px; align-items: center; margin-bottom: 8px; flex-wrap: wrap;">
        <div>
          <span style="color: var(--text-muted); font-size: 11px;">${isRu ? 'Установленная версия:' : 'Installed version:'}</span>
          <strong style="color: var(--primary); font-family: var(--mono); font-size: 13px; margin-left: 6px;">v${data.currentVersion || '1.3.0'}</strong>
        </div>`;

      if (data.latestRelease) {
        html += `<div>
          <span style="color: var(--text-muted); font-size: 11px;">${isRu ? 'Последний релиз:' : 'Latest release:'}</span>
          <strong style="color: ${data.updateAvailable ? 'var(--warning)' : 'var(--success)'}; font-family: var(--mono); font-size: 13px; margin-left: 6px;">${esc(data.latestRelease.name || ('v' + data.latestRelease.version))}</strong>
        </div>`;
      }

      if (data.updateAvailable) {
        html += `<span class="badge badge-action-direct">${isRu ? 'Доступно обновление' : 'Update Available'}</span>`;
      } else if (data.latestRelease) {
        html += `<span class="badge badge-online">${isRu ? 'Актуальная версия' : 'Up to date'}</span>`;
      }

      html += `</div>`;

      if (data.releases && data.releases.length > 0) {
        html += `<div style="max-height: 140px; overflow-y: auto; background: var(--card-bg); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px;">`;
        html += data.releases.slice(0, 5).map(r => `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 11.5px;">
            <div>
              <a href="${esc(r.htmlUrl)}" target="_blank" rel="noopener noreferrer" style="color: var(--primary); font-weight: 600; text-decoration: none;">${esc(r.name || r.tag)}</a>
              <span style="color: var(--text-muted); font-size: 10px; margin-left: 6px;">${r.publishedAt ? new Date(r.publishedAt).toLocaleDateString() : ''}</span>
            </div>
            <a href="${esc(r.htmlUrl)}" target="_blank" rel="noopener noreferrer" class="btn-secondary" style="font-size: 10px; padding: 2px 6px;">GitHub</a>
          </div>
        `).join('');
        html += `</div>`;
      } else {
        html += `<div style="color: var(--text-muted); font-size: 11.5px;">${isRu ? 'Релизы в репозитории пока не опубликованы.' : 'No published releases in repository yet.'}</div>`;
      }

      container.innerHTML = html;
    }

    // ----------------- Comprehensive Language Switcher (EN / RU) -----------------
    const I18N = {
      en: {
        appTitle: 'PEC - Proxy Extension Corp',
        appSubtitle: 'Enterprise Proxy Synchronization',
        statusGatewayActive: 'Gateway Active',
        lblGatewayStatus: 'Gateway Active',
        btnRefreshAllTitle: 'Refresh All',
        btnLogoutTitle: 'Log out',
        btnCustomizationTitle: 'Appearance & Themes',
        popoverTitle: 'Appearance',
        lblHdrFleet: 'Connected Devices:',
        lblHdrUser: 'Current User:',
        lblHdrProfile: 'Active PAC Profile:',
        lblHdrRot: 'Next Rotation:',
        btnRotateNow: 'Rotate Password Now',
        btnKillSwitchOff: 'Kill-Switch: OFF',
        btnKillSwitchOn: 'Kill-Switch: ON (Active)',
        tabBtnRouting: 'Routing & GeoBases',
        tabBtnBuilder: 'Extension Constructor Studio',
        tabBtnFleet: '💻 Devices',
        tabBtnInstances: '💻 Devices',
        tabBtnGpo: 'GPO Deployment',
        tabBtnRotation: 'Proxy Settings',
        tabBtnProxySettings: 'Proxy Settings',
        tabBtnLogs: 'Audit & Tester',
        activeFleetSuffix: ' active',

        // Modal
        modalSettingsTitle: 'Server Customization & GitHub Releases',
        lblSettingsLayout: '1. Dashboard Layout Style',
        subSettingsLayout: 'Choose the structural layout archetype for all dashboard tabs:',
        optLayoutConsole: '🖥️ Compact Console',
        descLayoutConsole: 'Ultra-minimalist compact layout with flat borders, 4px corners, and maximum information density across all tabs.',
        optLayoutTerminal: '⚡ Cyber Terminal',
        descLayoutTerminal: 'Monospace SecOps cyber-terminal with sharp 0px corners, neon highlights, and glowing cards.',
        badgeSelected: 'Active',
        lblSettingsTheme: '2. Color Palette Scheme',
        subSettingsTheme: 'All color themes are preserved and automatically adapt to the chosen layout:',
        lblSettingsLang: '3. Dashboard Language',
        titleGhVersionControl: 'GitHub Releases & Version Control',
        subGhVersionControl: 'Live sync with GitHub repository to view installed version, release notes, and updates:',
        btnCheckGhReleases: 'Check for Updates',
        txtGhChecking: 'Checking GitHub releases...',
        btnCloseModal: 'Close',

        // Tab 1: Routing & GeoBases
        titleRoutingMatrix: 'Routing Profiles & Geo-Rules Matrix',
        btnNewProfile: '+ New Profile',
        lblProfName: 'Profile Name',
        lblDefaultPolicy: 'Default Traffic Policy',
        optPolicyDirect: 'DIRECT by Default (Selective Proxy)',
        optPolicyProxy: 'PROXY by Default (Full Tunnel)',
        lblTargetScope: 'Deployment Target Scope',
        optScopeAll: 'All Devices (Global Default)',
        optScopeGroup: 'Target AD / Device Group',
        optScopeInstances: 'Specific Selected Instances',
        lblTargetGroup: 'Target Group Name',
        phTargetGroup: 'e.g. SEC-Proxy-VPN-VIP or Dev-Team',
        lblFailClosed: 'Fail-Closed: Prevent direct fallback (DIRECT) if proxy drops (avoids IP leak)',
        profDescDefault: 'Routing policy applied to matching browser instances.',
        lblUnsavedChanges: 'Unsaved Changes',
        btnSaveProfile: 'Save Routing Profile',
        btnDeleteProfile: 'Delete Profile',
        btnPacPreview: 'View PAC Script',
        titleGeoPresets: 'Quick Add GeoBase & Domain Bundles',
        btnImportPresets: '📥 + Import Presets (.dat / .txt)',
        titleImportPresets: 'Import GeoData & Presets',
        subImportPresets: 'Import geosite.dat, geoip.dat or plaintext domain lists',
        titleCustomRule: 'Add Custom Domain / Subnet Rule',
        lblRuleName: 'Rule Name',
        phRuleName: 'My Custom Rule',
        lblRulePattern: 'Pattern (comma separated domains or CIDRs)',
        phRulePattern: '*.example.com, target-domain.org, 10.50.0.0/16',
        lblRuleAction: 'Action',
        optActionProxy: 'PROXY',
        optActionDirect: 'DIRECT',
        optActionBlock: 'BLOCK (Sinkhole)',
        btnAddRule: '+ Add Rule',
        titleActiveRules: 'Active Profile Rules Hierarchy (Evaluated Top-to-Bottom)',
        thStatus: 'Status',
        thOrder: 'Order',
        thRuleName: 'Rule Name',
        thPattern: 'Pattern / Preset',
        thAction: 'Action',
        thActions: 'Actions',
        txtNoRules: 'No rules defined for this profile.',

        // Tab 2: Extension Constructor Studio
        titleBuilder: 'Extension Constructor & Customizer',
        subBuilder: 'Configure functional archetypes, visual styles, security leak guards, and user capabilities:',
        lblArchetypePresets: '1. Interface Mode',
        chipPopupMode: 'Interactive Popup',
        chipStealthMode: 'Stealth Agent',
        btnUploadIcon: 'Upload Image',
        lblIconCustom: 'Extension Icon (Emoji or Image)',
        lblThemePalettes: '2. UI Layout & Color Palette',
        lblStudioLayout: 'Interface Layout:',
        lblStudioPalette: 'Color Palette:',
        lblStudioThemeMode: 'Default Theme Mode:',
        optModeDark: 'Dark (Night)',
        optModeLight: 'Light (Day)',
        lblExtName: 'Extension Name',
        phExtName: 'Corp Proxy Auth & Sync',
        lblShortName: 'Short Name',
        phShortName: 'CorpProxy',
        lblVersion: 'Version',
        lblUiMode: 'UI Mode',
        optUiPopup: 'Interactive Popup UI',
        optUiStealth: 'Silent / Stealth Enterprise Worker',
        lblIconType: 'Vector Icon Type',
        lblBrandColor: 'Brand Theme Color',
        lblIconEmoji: 'Icon Emoji',
        lblSyncInterval: 'Sync Interval',
        optSync5: 'Every 5 minutes',
        optSync15: 'Every 15 minutes',
        optSync30: 'Every 30 minutes',
        optSync60: 'Every 1 hour',
        lblExtDesc: 'Enterprise Description',
        phExtDesc: 'Enterprise Chrome extension for automatic proxy synchronization',
        lblServerUrl: 'Sync Server Base URL (API Base URL)',
        phServerUrl: 'https://pec.example.corp',
        lblSecPolicies: 'Security & Leak Prevention Policies',
        lblWebrtcShield: 'WebRTC IP Shield (no UDP leak)',
        lblDnsGuard: 'DNS Leak Guard',
        lblBadgeIcon: 'Live Status Badge on Icon',
        lblAutoProxy: 'Dynamic Proxy Enforcement',
        lblAllowBypass: 'Allow Temporary User Bypass',
        lblIpGeo: 'Show Egress IP / Geo Verifier',
        lblBypassTimeout: 'Bypass Auto-Timeout',
        lblSupportUrl: 'IT Helpdesk Contact',
        phSupportUrl: 'mailto:it-support@corp.local',
        btnBuildCrx: 'Compile, Sign & Pack CRX',
        btnSaveConfig: 'Save Config Only',
        btnResetTemplate: 'Reset to Clean Template',
        titleLivePreview: 'Live Extension Interactive Preview',
        badgeSynced: 'Synced',
        subLivePreview: 'Full runtime sandbox mirroring real Chrome popup, icons, badge states, and events in real time:',
        titleStealthNotice: 'Stealth Mode Enabled',
        subStealthNotice: 'The extension runs silently as an enterprise background service worker without a popup window. Traffic is routed dynamically via PAC policy.',
        badgeStealthActive: 'Icon Badge: Active',
        lblSimState: 'Simulated Extension State',
        btnSimOnline: 'Online Proxy',
        btnSimBypass: 'Bypassed',
        btnSimOffline: 'Offline Fallback',
        btnSimError: 'Re-Authenticating',
        titleCodeInternals: 'Extension Source Code Internals',
        lblActiveFile: 'Active File:',
        subCodeInternals: 'Live Code Editor: Edits in popup.html or popup.js update the Interactive Preview instantly.',
        lblCodeReady: 'Ready',
        btnSaveCode: 'Save File Edits & Apply',
        btnDownloadCrx: 'Download .CRX',
        btnDownloadZip: 'Download .ZIP',

        // Tab 3: Devices
        titleFleetInstances: 'Corporate Network Devices',
        subFleetInstances: 'Active extension installations and their current status:',
        titleRegisteredDevices: 'Registered Devices',
        thInstId: 'Instance ID',
        thInstIp: 'IP Address',
        thInstVer: 'Version',
        thInstGroup: 'Device Group',
        thInstProfile: 'Assigned Profile',
        thInstSyncs: 'Syncs',
        thInstStatus: 'Status',
        thInstAssign: 'Assign',
        thInstActions: 'Actions',
        txtNoFleet: 'No registered devices connected yet.',

        // Tab 4: GPO
        titleExtPackageInfo: 'Extension Identifiers & Package Info',
        lblCalcExtId: 'Calculated Extension ID',
        lblManifestVer: 'Manifest Version',
        lblRsaKey: 'RSA Private Key',
        lblUpdateManifest: 'Auto-Update Manifest',
        btnDownloadCrxPkg: 'Download .CRX Package',
        btnDownloadZipPkg: 'Download .ZIP',
        titleAdGpoSettings: 'Active Directory GPO Settings',
        lblGpoForcelist: '1. ExtensionInstallForcelist Entry',
        lblGpoSettings: '2. ExtensionSettings (JSON)',
        btnDownloadReg: 'Download Windows .REG Policy File',

        // Tab 5: Proxy Settings & 3x-ui
        warnNoActiveProxyTitle: 'No active upstream proxy.',
        warnNoActiveProxyDesc: 'Extensions are receiving placeholder 10.0.0.1:10809 and traffic will not flow. Add a proxy via "+ Add Manual Proxy" or "+ Add from 3x-ui" and click "Activate".',
        titleRoutingMode: 'Client Traffic Routing Mode',
        subRoutingMode: 'Choose how Chrome extensions route browser traffic through upstream nodes.',
        optRoutingModePac: 'Selective Routing via Profiles (PAC)',
        descRoutingModePac: 'Browser uses PAC rules to selectively proxy designated domains/subnets; all other traffic goes direct.',
        optRoutingModeFixed: 'Full Tunnel (All Traffic via Active Proxy)',
        descRoutingModeFixed: 'All browser traffic is forcibly tunneled through the currently active upstream proxy (fixed_servers mode).',
        toastRoutingModeSaved: 'Routing mode updated! Extensions will receive it on next sync.',
        titleProxyRegistry: 'Proxy Registry',
        subProxyRegistry: 'Manage upstream corporate proxy servers, tag-based sync with 3x-ui inbounds, and manual nodes.',
        btnAdd3xui: '+ Add from 3x-ui by Tag',
        btnAddManual: '+ Add Manual Proxy',
        lblActivePacDirective: 'Active PAC Directive:',
        badgeNoActiveProxy: 'No Active Proxy',
        badgeActive: 'ACTIVE',
        thProxyActive: 'Active',
        thProxyTagName: 'Tag / Name',
        thProxyType: 'Type',
        thProxyProtocol: 'Protocol',
        thProxyHostPort: 'Host : Port',
        thProxyUser: 'User',
        thProxyStatus: 'Status',
        thProxyActions: 'Actions',
        txtNoProxies: 'No proxy nodes configured yet.',
        btnSetActive: 'Activate',
        btnEditProxy: 'Edit',
        btnDeleteProxy: 'Delete',
        btnSyncProxy: 'Sync & Rotate',
        lblInsecureTls: 'Allow Insecure / Self-Signed TLS',
        titleAdd3xui: 'Add Proxy from 3x-ui by Inbound Tag',
        subAdd3xui: 'Enter inbound tag configured in your 3x-ui panel to fetch and link credentials.',
        lblAdd3xuiTag: 'Inbound Tag',
        phAdd3xuiTag: 'corp-socks',
        btnFetchInbound: 'Fetch Info',
        txtInboundPreviewPlaceholder: 'Click "Fetch Info" to preview inbound parameters before adding.',
        lblAdd3xuiName: 'Friendly Name (optional)',
        phAdd3xuiName: 'Production SOCKS5 Node',
        lblAdd3xuiHost: 'Host Override (optional)',
        phAdd3xuiHost: '10.0.0.1 or proxy.corp.local',
        lblMakeActive: 'Make this proxy active immediately',
        btnAdd3xuiSubmit: 'Add 3x-ui Proxy',
        titleAddManualProxy: 'Add Manual Proxy Node',
        titleEditProxy: 'Edit Proxy Node',
        lblProxyTag: 'Tag',
        phProxyTag: 'manual-us-1',
        lblProxyName: 'Friendly Name',
        phProxyName: 'Backup US Gateway',
        lblProxyProtocol: 'Protocol',
        lblProxyHost: 'Host / IP',
        phProxyHost: '192.168.1.100',
        lblProxyPort: 'Port',
        phProxyPort: '1080',
        lblProxyUser: 'Username',
        phProxyUser: 'proxyuser',
        lblProxyPass: 'Password',
        btnSaveProxy: 'Save Proxy',
        btnCancel: 'Cancel',
        confirmDeleteProxy: 'Are you sure you want to delete this proxy node?',
        toastProxyActivated: 'Proxy activated!',
        toastProxySynced: 'Proxy synchronized!',
        toastProxyDeleted: 'Proxy deleted',
        toastProxySaved: 'Proxy saved!',
        warnChromiumSocks5Auth: '⚠️ Chromium (Chrome, Edge, Brave, Yandex) does not support SOCKS5 authentication. If credentials are set, Chrome will reject the connection or bypass the proxy. Use HTTP protocol for authenticated corporate proxies or use SOCKS5 without username/password (e.g. IP whitelist).',
        warnSocksAuthTable: 'Chromium browsers do not support SOCKS5 authentication. Use HTTP or IP-whitelisted SOCKS5.',
        title3xuiCreds: '3x-ui API Credentials & Timing Scheduler',
        lbl3xuiPanelUrl: '3x-ui Panel URL',
        phRotPanelUrl: 'https://3xui-host:2053/basepath',
        lblAdminUser: 'Admin Username',
        phRotAdminUser: 'admin',
        lblAdminPass: 'Admin Password',
        lblInboundRemark: 'Target Inbound Remark',
        phRotRemark: 'squid-in',
        lblRotInterval: 'Rotation Interval',
        optRot15: 'Every 15 minutes',
        optRot60: 'Every 1 hour',
        optRot360: 'Every 6 hours',
        optRot720: 'Every 12 hours',
        optRot1440: 'Every 24 hours (Daily)',
        lblScheduler: 'Scheduler',
        optSchedEnabled: 'Enabled (Auto)',
        optSchedDisabled: 'Disabled',
        btnSaveScheduler: 'Save Scheduler Settings',
        btnTest3xui: 'Test 3x-ui Connection',
        titleRotStatus: 'Rotation Status & History',
        lblSchedStatus: 'Scheduler Status',
        lblNextRun: 'Next Scheduled Run',
        lblLastRot: 'Last Rotated At',
        lblRecentRot: 'Recent Password Rotations',
        thRotTime: 'Time',
        thRotSource: 'Source',
        thRotUser: 'User',
        thRotResult: 'Result',
        txtNoRotEvents: 'No rotation events yet',

        // Tab 6: Deploy
        titleDeployScenarios: 'Server Deployment & Container Scenarios',
        badgeProdReady: 'Production Ready',
        subDeployScenarios: 'Choose the best installation option for your corporate infrastructure: from isolated Docker containers to Linux systemd services or Nginx SSL reverse-proxy.',
        btnScenDocker: '🐳 Docker & Compose',
        btnScenSystemd: '🐧 Linux Systemd Service',
        btnScenNginx: '🛡️ Nginx + SSL (HTTPS)',
        btnScenStandalone: '⚡ Standalone / PM2',
        btnScenGpo: '🏢 Active Directory / GPO',
        scen1Title: 'Option 1: Docker & Docker Compose (Recommended)',
        scen1Desc: 'Fully isolated multi-stage container based on Alpine Linux. Automatically persists rotated passwords, compiled .CRX extensions and PAC scripts in Docker volumes.',
        scen1Quick: 'Quick single-command launch:',
        scen1Config: 'Configuration file docker-compose.yml:',
        btnDownloadDockerfile: 'Download Dockerfile',
        btnDownloadCompose: 'Download docker-compose.yml',
        scen2Title: 'Option 2: Linux System Service (systemd)',
        scen2Desc: 'Ideal for dedicated virtual machines (Ubuntu, Debian, RHEL). Sets up unprivileged user pecuser, automated startup, and journald logging.',
        scen2Auto: 'Automated installation script:',
        scen2File: 'Service unit /etc/systemd/system/pec-server.service:',
        scen2Commands: 'Service management commands:',
        scen3Title: 'Option 3: Nginx Reverse-Proxy + SSL + Rate Limiting',
        scen3Desc: 'Provides HTTPS encryption (required for secure credential delivery to extensions), PAC file caching, and rate limiting for authentication endpoints.',
        scen3Config: 'Nginx configuration (/etc/nginx/sites-available/pec-proxy.conf):',
        scen4Title: 'Option 4: Standalone Run via Node.js and PM2',
        scen4Desc: 'Fast start for development, testing, or lightweight environments without Docker.',
        scen5Title: 'Option 5: Extension Deployment via Active Directory GPO',
        scen5Desc: 'The ExtensionInstallForcelist policy automatically forces installation of the compiled .CRX onto Windows domain workstations without allowing uninstallation by users.',
        scen5RegKey: 'Windows Registry Key (HKLM\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist):',
        btnDownloadRegGpo: 'Download Registry File (.REG)',

        // Tab 7: Audit & Tester
        titleCredsTester: 'Interactive /creds Tester',
        lblTestToken: 'X-Ext-Token Header Value',
        btnSendCreds: 'Send GET /creds',
        btnTestInvalidToken: 'Test Invalid Token',
        titleSyncTester: 'Interactive /api/sync Tester',
        subSyncTester: 'Simulate a Chrome extension heartbeat sync:',
        btnSendSync: 'Send POST /api/sync',
        titleAuditLogs: 'Access & Security Audit Logs',
        thLogTime: 'Timestamp',
        thLogIp: 'IP Address',
        thLogEndpoint: 'Endpoint',
        thLogStatus: 'Status',
        thLogResult: 'Result',
        thLogDetails: 'Details',
        txtLoadingLogs: 'Loading logs...'
      },
      ru: {
        appTitle: 'PEC - Proxy Extension Corp',
        appSubtitle: 'Корпоративная синхронизация прокси',
        statusGatewayActive: 'Шлюз активен',
        lblGatewayStatus: 'Шлюз активен',
        btnRefreshAllTitle: 'Обновить всё',
        btnLogoutTitle: 'Выйти',
        btnCustomizationTitle: 'Внешний вид и темы',
        popoverTitle: 'Внешний вид',
        lblHdrFleet: 'Подключенные устройства:',
        lblHdrUser: 'Текущий пользователь:',
        lblHdrProfile: 'Активный PAC профиль:',
        lblHdrRot: 'Следующая ротация:',
        btnRotateNow: 'Ротировать пароль сейчас',
        btnKillSwitchOff: 'Kill-Switch: ВЫКЛ',
        btnKillSwitchOn: 'Kill-Switch: ВКЛ (Авария)',
        tabBtnRouting: 'Маршрутизация и Гео-базы',
        tabBtnBuilder: 'Конструктор расширения',
        tabBtnFleet: '💻 Устройства',
        tabBtnInstances: '💻 Устройства',
        tabBtnGpo: 'GPO & Реестр Windows',
        tabBtnRotation: 'Настройки прокси',
        tabBtnProxySettings: 'Настройки прокси',
        tabBtnLogs: 'Аудит и Тестер API',
        activeFleetSuffix: ' активных',

        // Modal
        modalSettingsTitle: 'Кастомизация сервера и Релизы',
        lblSettingsLayout: '1. Стиль интерфейса сервера (Layout)',
        subSettingsLayout: 'Выберите структурный шаблон для всех вкладок панели:',
        optLayoutConsole: '🖥️ Compact Console',
        descLayoutConsole: 'Ультра-минималистичный компактный интерфейс с плоскими границами, 4px скруглениями и максимальной плотностью информации во всех вкладках.',
        optLayoutTerminal: '⚡ Cyber Terminal',
        descLayoutTerminal: 'Моноширинный киберпанк/SecOps терминал со строгими 0px углами, неоновой сеткой и подсвеченными карточками.',
        badgeSelected: 'Активно',
        lblSettingsTheme: '2. Цветовая палитра (Color Scheme)',
        subSettingsTheme: 'Все цветовые схемы сохранены и адаптируются под выбранный макет:',
        lblSettingsLang: '3. Язык интерфейса (Language)',
        titleGhVersionControl: 'Версии и релизы GitHub',
        subGhVersionControl: 'Синхронизация с официальным репозиторием GitHub (показывает установленную версию и доступные релизы):',
        btnCheckGhReleases: 'Проверить обновления',
        txtGhChecking: 'Проверка релизов на GitHub...',
        btnCloseModal: 'Закрыть',

        // Tab 1: Routing & GeoBases
        titleRoutingMatrix: 'Профили маршрутизации и матрица гео-правил',
        btnNewProfile: '+ Новый профиль',
        lblProfName: 'Название профиля',
        lblDefaultPolicy: 'Политика по умолчанию (Fallback)',
        optPolicyDirect: 'DIRECT по умолчанию (Выборочный прокси)',
        optPolicyProxy: 'PROXY по умолчанию (Полный туннель)',
        lblTargetScope: 'Целевая область применения',
        optScopeAll: 'Все устройства (Глобально по умолчанию)',
        optScopeGroup: 'Целевая группа AD / Устройства',
        optScopeInstances: 'Отдельные выбранные устройства',
        lblTargetGroup: 'Имя целевой группы',
        phTargetGroup: 'напр. SEC-Proxy-VPN-VIP или Dev-Team',
        lblFailClosed: 'Fail-Closed: запретить прямой доступ (DIRECT) при падении прокси (защита от утечки IP)',
        profDescDefault: 'Политика маршрутизации, применяемая к соответствующим браузерам.',
        lblUnsavedChanges: 'Несохраненные изменения',
        btnSaveProfile: 'Сохранить профиль',
        btnDeleteProfile: 'Удалить профиль',
        btnPacPreview: 'Открыть PAC-скрипт',
        titleGeoPresets: 'Быстрое добавление гео-баз и наборов доменов',
        btnImportPresets: '📥 + Импорт пресетов (.dat / .txt)',
        titleImportPresets: 'Импорт гео-данных и пресетов',
        subImportPresets: 'Импорт geosite.dat, geoip.dat или текстовых списков доменов',
        titleCustomRule: 'Добавить пользовательское правило для домена / подсети',
        lblRuleName: 'Название правила',
        phRuleName: 'Мое правило',
        lblRulePattern: 'Шаблон (домены через запятую или CIDR подсети)',
        phRulePattern: '*.example.com, target-domain.org, 10.50.0.0/16',
        lblRuleAction: 'Действие',
        optActionProxy: 'PROXY',
        optActionDirect: 'DIRECT',
        optActionBlock: 'BLOCK (Блокировать)',
        btnAddRule: '+ Добавить правило',
        titleActiveRules: 'Иерархия правил профиля (Обработка сверху вниз)',
        thStatus: 'Статус',
        thOrder: 'Порядок',
        thRuleName: 'Имя правила',
        thPattern: 'Шаблон / Пресет',
        thAction: 'Действие',
        thActions: 'Действия',
        txtNoRules: 'Правила для этого профиля пока не заданы.',

        // Tab 2: Extension Constructor Studio
        titleBuilder: 'Конструктор и кастомизатор расширения',
        subBuilder: 'Настройка функциональных архетипов, визуального стиля, защиты от утечек и возможностей пользователя:',
        lblArchetypePresets: '1. Режим интерфейса',
        chipPopupMode: 'Обычный режим',
        chipStealthMode: 'Скрытый агент',
        btnUploadIcon: 'Загрузить изображение',
        lblIconCustom: 'Иконка расширения (Emoji или изображение)',
        lblThemePalettes: '2. Макет и цветовая палитра',
        lblStudioLayout: 'Макет интерфейса:',
        lblStudioPalette: 'Цветовая палитра:',
        lblStudioThemeMode: 'Режим темы по умолчанию:',
        optModeDark: 'Темная (Ночь)',
        optModeLight: 'Светлая (День)',
        lblExtName: 'Название расширения',
        phExtName: 'Corp Proxy Auth & Sync',
        lblShortName: 'Короткое имя',
        phShortName: 'CorpProxy',
        lblVersion: 'Версия',
        lblUiMode: 'Режим интерфейса',
        optUiPopup: 'Интерактивное всплывающее окно (Popup)',
        optUiStealth: 'Скрытый фоновый агент (Stealth Worker)',
        lblIconType: 'Тип векторной иконки',
        lblBrandColor: 'Фирменный акцентный цвет',
        lblIconEmoji: 'Эмодзи иконки',
        lblSyncInterval: 'Интервал синхронизации',
        optSync5: 'Каждые 5 минут',
        optSync15: 'Каждые 15 минут',
        optSync30: 'Каждые 30 минут',
        optSync60: 'Каждый 1 час',
        lblExtDesc: 'Корпоративное описание',
        phExtDesc: 'Корпоративное расширение Chrome для автоматической синхронизации прокси',
        lblServerUrl: 'Сервер синхронизации (API Base URL)',
        phServerUrl: 'https://pec.example.corp',
        lblSecPolicies: 'Политики безопасности и защита от утечек',
        lblWebrtcShield: 'Защита WebRTC (предотвращение утечки IP)',
        lblDnsGuard: 'Защита DNS (резолв через прокси)',
        lblBadgeIcon: 'Индикатор состояния на иконке (бейдж)',
        lblAutoProxy: 'Принудительное применение PAC при старте',
        lblAllowBypass: 'Разрешить временный ручной обход',
        lblIpGeo: 'Отображать выходной IP и проверку гео',
        lblBypassTimeout: 'Таймаут ручного обхода',
        lblSupportUrl: 'Контакт службы поддержки',
        phSupportUrl: 'mailto:it-support@corp.local',
        btnBuildCrx: 'Скомпилировать, подписать и собрать CRX',
        btnSaveConfig: 'Сохранить только конфиг',
        btnResetTemplate: 'Сбросить к исходному шаблону',
        titleLivePreview: 'Интерактивный предпросмотр расширения',
        badgeSynced: 'Синхронизировано',
        subLivePreview: 'Живая песочница, отображающая popup Chrome, иконки, бейджи и события в реальном времени:',
        titleStealthNotice: 'Включен скрытый режим (Stealth Mode)',
        subStealthNotice: 'Расширение работает в фоновом режиме без всплывающего окна. Трафик маршрутизируется динамически через PAC-скрипт.',
        badgeStealthActive: 'Бейдж иконки: Активен',
        lblSimState: 'Состояние симуляции расширения',
        btnSimOnline: '🟢 Онлайн прокси',
        btnSimBypass: '🟡 Прямой обход',
        btnSimOffline: '🔴 Офлайн',
        btnSimError: '🔄 407 Ре-аутентификация',
        titleCodeInternals: 'Исходный код и внутренние файлы расширения',
        lblActiveFile: 'Активный файл:',
        subCodeInternals: 'Редактор кода: изменения в popup.html или popup.js мгновенно обновляют интерактивный предпросмотр.',
        lblCodeReady: 'Готов',
        btnSaveCode: 'Сохранить изменения и применить',
        btnDownloadCrx: 'Скачать .CRX',
        btnDownloadZip: 'Скачать .ZIP',

        // Tab 3: Devices
        titleFleetInstances: 'Устройства корпоративной сети',
        subFleetInstances: 'Список активных установок расширения и их текущий статус',
        titleRegisteredDevices: 'Зарегистрированные устройства',
        thInstId: 'ID экземпляра',
        thInstIp: 'IP адрес',
        thInstVer: 'Версия',
        thInstGroup: 'Группа устройств',
        thInstProfile: 'Назначенный профиль',
        thInstSyncs: 'Синхронизаций',
        thInstStatus: 'Статус',
        thInstAssign: 'Назначить',
        thInstActions: 'Действия',
        txtNoFleet: 'Зарегистрированные устройства отсутствуют',

        // Tab 4: GPO
        titleExtPackageInfo: 'Идентификаторы расширения и сведения о пакете',
        lblCalcExtId: 'Вычисленный Extension ID',
        lblManifestVer: 'Версия Manifest',
        lblRsaKey: 'Приватный RSA-ключ',
        lblUpdateManifest: 'Манифест автообновлений',
        btnDownloadCrxPkg: 'Скачать пакет .CRX',
        btnDownloadZipPkg: 'Скачать .ZIP',
        titleAdGpoSettings: 'Параметры Active Directory GPO',
        lblGpoForcelist: '1. Запись ExtensionInstallForcelist',
        lblGpoSettings: '2. ExtensionSettings (JSON)',
        btnDownloadReg: 'Скачать файл реестра Windows (.REG)',

        // Tab 5: Proxy Settings & 3x-ui
        warnNoActiveProxyTitle: 'Нет активного upstream-прокси.',
        warnNoActiveProxyDesc: 'Расширения получают плейсхолдер 10.0.0.1:10809 и трафик не пойдёт. Добавьте прокси через кнопку «+ Add Manual Proxy» или «+ Add from 3x-ui» и нажмите «Activate».',
        titleRoutingMode: 'Режим маршрутизации трафика клиентов',
        subRoutingMode: 'Выберите, как расширения Chrome направляют трафик браузера через вышестоящие прокси.',
        optRoutingModePac: 'Выборочная маршрутизация по профилям (PAC)',
        descRoutingModePac: 'Браузер использует PAC-правила для выборочного проксирования указанных доменов/сетей; остальной трафик идет напрямую.',
        optRoutingModeFixed: 'Полный туннель (Весь трафик через активный прокси)',
        descRoutingModeFixed: 'Весь трафик браузера принудительно направляется через текущий активный upstream-прокси (режим fixed_servers).',
        toastRoutingModeSaved: 'Режим маршрутизации обновлен! Расширения получат его при следующей синхронизации.',
        titleProxyRegistry: 'Реестр прокси-серверов',
        subProxyRegistry: 'Управление вышестоящими корпоративными прокси, синхронизация с 3x-ui по тегам и ручные узлы.',
        btnAdd3xui: '+ Добавить по тегу из 3x-ui',
        btnAddManual: '+ Добавить вручную',
        lblActivePacDirective: 'Активная директива PAC:',
        badgeNoActiveProxy: 'Нет активного прокси',
        badgeActive: 'АКТИВЕН',
        thProxyActive: 'Активен',
        thProxyTagName: 'Тег / Имя',
        thProxyType: 'Тип',
        thProxyProtocol: 'Протокол',
        thProxyHostPort: 'Хост : Порт',
        thProxyUser: 'Пользователь',
        thProxyStatus: 'Статус',
        thProxyActions: 'Действия',
        txtNoProxies: 'Прокси-узлы еще не настроены.',
        btnSetActive: 'Активировать',
        btnEditProxy: 'Изменить',
        btnDeleteProxy: 'Удалить',
        btnSyncProxy: 'Синхронизировать',
        lblInsecureTls: 'Разрешить небезопасный / самоподписанный TLS',
        titleAdd3xui: 'Добавить прокси из 3x-ui по тегу',
        subAdd3xui: 'Введите тег входящего подключения из панели 3x-ui для загрузки и привязки реквизитов.',
        lblAdd3xuiTag: 'Тег входящего (Tag)',
        phAdd3xuiTag: 'corp-socks',
        btnFetchInbound: 'Запросить данные',
        txtInboundPreviewPlaceholder: 'Нажмите "Запросить данные", чтобы проверить параметры входящего подключения.',
        lblAdd3xuiName: 'Название узла (опционально)',
        phAdd3xuiName: 'Основной рабочий SOCKS5',
        lblAdd3xuiHost: 'Хост (опционально)',
        phAdd3xuiHost: '10.0.0.1 или proxy.corp.local',
        lblMakeActive: 'Сделать активным сразу после добавления',
        btnAdd3xuiSubmit: 'Добавить прокси 3x-ui',
        titleAddManualProxy: 'Добавить прокси вручную',
        titleEditProxy: 'Редактировать прокси-узел',
        lblProxyTag: 'Тег',
        phProxyTag: 'manual-us-1',
        lblProxyName: 'Понятное имя',
        phProxyName: 'Резервный шлюз',
        lblProxyProtocol: 'Протокол',
        lblProxyHost: 'Хост / IP',
        phProxyHost: '192.168.1.100',
        lblProxyPort: 'Порт',
        phProxyPort: '1080',
        lblProxyUser: 'Логин',
        phProxyUser: 'proxyuser',
        lblProxyPass: 'Пароль',
        btnSaveProxy: 'Сохранить прокси',
        btnCancel: 'Отмена',
        confirmDeleteProxy: 'Вы уверены, что хотите удалить этот прокси-узел?',
        toastProxyActivated: 'Прокси активирован!',
        toastProxySynced: 'Прокси синхронизирован!',
        toastProxyDeleted: 'Прокси удален',
        toastProxySaved: 'Прокси сохранен!',
        warnChromiumSocks5Auth: '⚠️ Браузеры на базе Chromium (Chrome, Edge, Brave, Яндекс) не поддерживают авторизацию (логин/пароль) для SOCKS5. При наличии логина Chrome не сможет подключиться к прокси. Используйте протокол HTTP для авторизованных корпоративных прокси либо SOCKS5 без логина/пароля (по IP-фильтру).',
        warnSocksAuthTable: 'Браузеры Chromium не поддерживают авторизацию для SOCKS5. Используйте HTTP или SOCKS5 без авторизации.',
        title3xuiCreds: 'Учетные данные 3x-ui API и планировщик',
        lbl3xuiPanelUrl: 'URL панели 3x-ui',
        phRotPanelUrl: 'https://3xui-host:2053/basepath',
        lblAdminUser: 'Логин администратора',
        phRotAdminUser: 'admin',
        lblAdminPass: 'Пароль администратора',
        lblInboundRemark: 'Примечание входящего (Remark)',
        phRotRemark: 'squid-in',
        lblRotInterval: 'Интервал ротации',
        optRot15: 'Каждые 15 минут',
        optRot60: 'Каждый 1 час',
        optRot360: 'Каждые 6 часов',
        optRot720: 'Каждые 12 часов',
        optRot1440: 'Каждые 24 часа (Раз в сутки)',
        lblScheduler: 'Планировщик',
        optSchedEnabled: 'Включен (Авто)',
        optSchedDisabled: 'Отключен',
        btnSaveScheduler: 'Сохранить настройки планировщика',
        btnTest3xui: 'Проверить подключение к 3x-ui',
        titleRotStatus: 'Статус ротации и история',
        lblSchedStatus: 'Статус планировщика',
        lblNextRun: 'Следующий запуск',
        lblLastRot: 'Последняя ротация',
        lblRecentRot: 'Недавние ротации паролей',
        thRotTime: 'Время',
        thRotSource: 'Источник',
        thRotUser: 'Пользователь',
        thRotResult: 'Результат',
        txtNoRotEvents: 'Событий ротации пока нет',

        // Tab 6: Deploy
        titleDeployScenarios: 'Сценарии установки и развертывания сервера',
        badgeProdReady: 'Готово к Production',
        subDeployScenarios: 'Выберите подходящий вариант для вашей инфраструктуры: от изолированного контейнера Docker до службы Linux systemd или Nginx с SSL.',
        btnScenDocker: '🐳 Docker и Compose',
        btnScenSystemd: '🐧 Служба Linux Systemd',
        btnScenNginx: '🛡️ Nginx + SSL (HTTPS)',
        btnScenStandalone: '⚡ Standalone / PM2',
        btnScenGpo: '🏢 Active Directory / GPO',
        scen1Title: 'Вариант 1: Запуск через Docker и Docker Compose (Рекомендуемый)',
        scen1Desc: 'Полностью изолированный multi-stage контейнер на базе Alpine Linux. Автоматически сохраняет ротируемые пароли, скомпилированные .CRX расширения и PAC-скрипты в томах Docker.',
        scen1Quick: 'Быстрый запуск одной командой:',
        scen1Config: 'Конфигурационный файл docker-compose.yml:',
        btnDownloadDockerfile: 'Скачать Dockerfile',
        btnDownloadCompose: 'Скачать docker-compose.yml',
        scen2Title: 'Вариант 2: Установка как системная служба Linux (systemd)',
        scen2Desc: 'Идеально для выделенных виртуальных машин (Ubuntu, Debian, RHEL). Создает системного пользователя pecuser, настраивает автозапуск и журналирование через journald.',
        scen2Auto: 'Автоматическая установка через скрипт:',
        scen2File: 'Файл службы /etc/systemd/system/pec-server.service:',
        scen2Commands: 'Команды управления службой:',
        scen3Title: 'Вариант 3: Реверс-прокси Nginx с SSL и защитой от перебора',
        scen3Desc: 'Обеспечивает шифрование трафика по HTTPS (требуется для безопасной доставки учетных данных в расширения), кеширование PAC-файлов и ограничение запросов (Rate Limiting).',
        scen3Config: 'Конфигурация Nginx (/etc/nginx/sites-available/pec-proxy.conf):',
        scen4Title: 'Вариант 4: Автономный запуск через Node.js и PM2',
        scen4Desc: 'Быстрый запуск для тестирования, разработки или легких окружений без Docker.',
        scen5Title: 'Вариант 5: Развертывание расширения через Active Directory GPO',
        scen5Desc: 'Политика ExtensionInstallForcelist автоматически принудительно устанавливает скомпилированный .CRX на компьютеры пользователей домена Windows без возможности ручного удаления сотрудником.',
        scen5RegKey: 'Ключ реестра Windows (HKLM\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist):',
        btnDownloadRegGpo: 'Скачать файл реестра (.REG)',

        // Tab 7: Audit & Tester
        titleCredsTester: 'Интерактивный тестер /creds',
        lblTestToken: 'Значение заголовка X-Ext-Token',
        btnSendCreds: 'Отправить GET /creds',
        btnTestInvalidToken: 'Проверить неверный токен',
        titleSyncTester: 'Интерактивный тестер /api/sync',
        subSyncTester: 'Симуляция отправки пульса синхронизации расширения:',
        btnSendSync: 'Отправить POST /api/sync',
        titleAuditLogs: 'Журнал аудита доступа и безопасности',
        thLogTime: 'Время',
        thLogIp: 'IP адрес',
        thLogEndpoint: 'Эндпоинт',
        thLogStatus: 'Статус',
        thLogResult: 'Результат',
        thLogDetails: 'Детали',
        txtLoadingLogs: 'Загрузка журнала...'
      }
    };

    currentLang = 'ru';

    function setLanguage(lang) {
      currentLang = (lang === 'en' || lang === 'ru') ? lang : 'ru';
      try { localStorage.setItem('pec_lang', currentLang); } catch(e){}
      
      const btnEn = document.getElementById('btnLangEn');
      const btnRu = document.getElementById('btnLangRu');
      if (btnEn && btnRu) {
        if (currentLang === 'en') {
          btnEn.style.background = 'var(--primary)';
          btnEn.style.color = '#fff';
          btnRu.style.background = 'transparent';
          btnRu.style.color = 'var(--text-muted)';
        } else {
          btnRu.style.background = 'var(--primary)';
          btnRu.style.color = '#fff';
          btnEn.style.background = 'transparent';
          btnEn.style.color = 'var(--text-muted)';
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

      const dict = I18N[currentLang];
      
      // Update all elements with data-i18n attributes
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (dict[key]) {
          el.textContent = dict[key];
        }
      });

      // Update placeholders with data-i18n-ph attributes
      document.querySelectorAll('[data-i18n-ph]').forEach(el => {
        const key = el.getAttribute('data-i18n-ph');
        if (dict[key]) {
          el.setAttribute('placeholder', dict[key]);
        }
      });

      // Update titles with data-i18n-title attributes
      document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (dict[key]) {
          el.setAttribute('title', dict[key]);
        }
      });

      // Update elements by ID if present in dictionary
      for (const key in dict) {
        const el = document.getElementById(key);
        if (el && !el.hasAttribute('data-i18n')) {
          el.textContent = dict[key];
        }
      }

      const btnKill = document.getElementById('btnKillSwitch');
      if (btnKill) {
        btnKill.textContent = globalKillSwitch ? dict.btnKillSwitchOn : dict.btnKillSwitchOff;
      }

      if (cachedReleases) {
        renderGitHubReleases(cachedReleases);
      }

      if (typeof loadPresets === 'function') loadPresets();
      if (typeof fetchFleet === 'function') fetchFleet();
      if (typeof fetchStatus === 'function') fetchStatus();
      if (typeof renderProxiesTable === 'function' && currentProxiesList) renderProxiesTable(currentProxiesList);
    }

    function switchTab(name) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

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
        const oc = b.getAttribute('onclick') || '';
        const id = b.id || '';
        return oc.includes(name) ||
          ((name === 'rotation' || name === 'proxy-settings') && (oc.includes('rotation') || oc.includes('proxy-settings'))) ||
          ((name === 'fleet' || name === 'instances') && (oc.includes('fleet') || oc.includes('instances') || id === 'tab-instances' || id === 'tabBtnFleet'));
      });
      if (btn) btn.classList.add('active');
    }

    // ----------------- Routing & Profiles -----------------
    let hasUnsavedRouting = false;

    function setUnsavedRouting(dirty) {
      hasUnsavedRouting = !!dirty;
      const badge = document.getElementById('unsavedChangesBadge');
      if (badge) {
        badge.style.display = hasUnsavedRouting ? 'inline-flex' : 'none';
      }
    }

    function initRoutingDirtyTracking() {
      ['profName', 'profTargetGroup'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el._dirtyBound) {
          el.addEventListener('input', () => setUnsavedRouting(true));
          el._dirtyBound = true;
        }
      });
      ['profDefaultPolicy', 'profTargetScope', 'profFailClosed'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el._dirtyBound) {
          el.addEventListener('change', () => setUnsavedRouting(true));
          el._dirtyBound = true;
        }
      });
    }

    async function loadPresets() {
      try {
        const res = await adminFetch('/api/routing/presets');
        const presets = await res.json();
        const container = document.getElementById('presetsContainer');
        if (!container) return;
        
        const isRu = currentLang === 'ru';
        container.innerHTML = presets.map(p => {
          const entriesList = p.entries || p.domains || [];
          const count = entriesList.length;

          // Check if preset is already in currentProfile
          const existingRule = (currentProfile && Array.isArray(currentProfile.rules))
            ? currentProfile.rules.find(r => r.targetType === 'preset' && r.pattern === p.id)
            : null;

          let badgeHtml = '';
          if (existingRule) {
            const act = (existingRule.action || 'proxy').toLowerCase();
            const actLabel = isRu
              ? (act === 'proxy' ? 'ПРОКСИ' : act === 'direct' ? 'НАПРЯМУЮ' : 'БЛОК')
              : act.toUpperCase();
            badgeHtml = `<span class="preset-in-profile-badge action-${act}">${isRu ? 'В профиле: ' : 'In Profile: '}${actLabel}</span>`;
          }

          return `
          <div class="preset-card">
            <div>
              <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 6px; margin-bottom: 4px;">
                <h4 style="margin: 0; font-size: 13px; font-weight: 600;">${esc(p.name)}</h4>
                <button type="button" onclick="openGeobaseInspector('${esc(p.id)}')" class="btn-icon" title="${isRu ? 'Инспектор пресета' : 'Inspect Preset'}" style="font-size: 11px; padding: 2px 5px; line-height: 1;">🔍</button>
              </div>
              <p style="margin: 0 0 6px 0;">${esc(p.description)} (${count} ${isRu ? 'записей' : 'entries'})</p>
              ${badgeHtml ? `<div style="margin-bottom: 6px;">${badgeHtml}</div>` : ''}
            </div>
            <div style="display: flex; gap: 6px; margin-top: 6px;">
              <button type="button" onclick="addPresetRule('${esc(p.id)}', '${esc(p.name)}', 'proxy')" class="btn-secondary" style="font-size: 11px; padding: 4px 8px; flex: 1;">+ ${isRu ? 'Прокси' : 'Proxy'}</button>
              <button type="button" onclick="addPresetRule('${esc(p.id)}', '${esc(p.name)}', 'direct')" class="btn-secondary" style="font-size: 11px; padding: 4px 8px; flex: 1;">+ ${isRu ? 'Напрямую' : 'Direct'}</button>
              <button type="button" onclick="addPresetRule('${esc(p.id)}', '${esc(p.name)}', 'block')" class="btn-danger" style="font-size: 11px; padding: 4px 8px; flex: 1;">+ ${isRu ? 'Блок' : 'Block'}</button>
            </div>
          </div>
          `;
        }).join('');
      } catch (e) {
        console.error(e);
      }
    }

    async function loadProfiles() {
      try {
        const res = await adminFetch('/api/routing/profiles');
        allProfiles = await res.json();
        const sel = document.getElementById('profileSelect');
        
        sel.innerHTML = allProfiles.map(p => 
          `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.defaultPolicy.toUpperCase())} default)${p.isDefault ? ' [DEFAULT]' : ''}</option>`
        ).join('');

        if (allProfiles.length > 0) {
          currentProfile = allProfiles[0];
          renderProfile(currentProfile);
          document.getElementById('hdrActiveProfile').textContent = currentProfile.name;
        }
      } catch (e) {
        console.error(e);
      }
    }

    function loadSelectedProfile() {
      const id = document.getElementById('profileSelect').value;
      const found = allProfiles.find(p => p.id === id);
      if (found) {
        currentProfile = found;
        renderProfile(currentProfile);
      }
    }

    function renderProfile(p) {
      document.getElementById('profName').value = p.name || '';
      document.getElementById('profDefaultPolicy').value = p.defaultPolicy || 'direct';
      document.getElementById('profTargetScope').value = p.targetScope || 'all';
      document.getElementById('profTargetGroup').value = p.targetGroup || '';
      document.getElementById('profFailClosed').checked = Boolean(p.failClosed);
      document.getElementById('profDesc').textContent = p.description || 'Configured routing rules.';
      
      const groupRow = document.getElementById('groupTargetRow');
      groupRow.style.display = p.targetScope === 'group' ? 'block' : 'none';

      document.getElementById('btnPacPreview').href = '/proxy.pac?profileId=' + p.id;
      setUnsavedRouting(false);
      initRoutingDirtyTracking();
      renderRules(p.rules || []);
      loadPresets();
    }

    document.getElementById('profTargetScope').addEventListener('change', (e) => {
      document.getElementById('groupTargetRow').style.display = e.target.value === 'group' ? 'block' : 'none';
      setUnsavedRouting(true);
    });

    function renderRules(rules) {
      const tbody = document.getElementById('rulesTableBody');
      const isRu = currentLang === 'ru';
      if (!rules || !rules.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">' + (isRu ? 'В этом профиле нет правил. Используйте кнопки выше для добавления пресетов или кастомных правил.' : 'No rules defined for this profile. Use buttons above to add presets or custom rules.') + '</td></tr>';
        return;
      }

      tbody.innerHTML = rules.map((r, idx) => {
        let badge = 'badge-action-proxy';
        if (r.action === 'direct') badge = 'badge-action-direct';
        else if (r.action === 'block') badge = 'badge-action-block';
        const actionLabel = isRu ? (r.action === 'proxy' ? 'ПРОКСИ' : (r.action === 'direct' ? 'НАПРЯМУЮ' : 'БЛОК')) : r.action.toUpperCase();

        return `<tr>
          <td>
            <input type="checkbox" ${r.enabled ? 'checked' : ''} onchange="toggleRuleEnabled(${idx})" style="margin: 0;" />
          </td>
          <td>
            <div style="display: flex; gap: 4px; align-items: center;">
              <button type="button" class="btn-reorder-up" onclick="moveRuleUp(${idx})" ${idx === 0 ? 'disabled' : ''} title="${isRu ? 'Выше' : 'Move Up'}">▲</button>
              <button type="button" class="btn-reorder-down" onclick="moveRuleDown(${idx})" ${idx === rules.length - 1 ? 'disabled' : ''} title="${isRu ? 'Ниже' : 'Move Down'}">▼</button>
            </div>
          </td>
          <td><strong>${esc(r.name)}</strong></td>
          <td><code>${esc(r.pattern)}</code></td>
          <td><span class="badge ${badge}">${actionLabel}</span></td>
          <td>
            <button type="button" onclick="removeRule(${idx})" class="btn-danger" style="font-size: 11px; padding: 3px 8px;">${isRu ? 'Удалить' : 'Delete'}</button>
          </td>
        </tr>`;
      }).join('');
    }

    function moveRuleUp(index) {
      if (!currentProfile || !Array.isArray(currentProfile.rules)) return;
      if (index <= 0 || index >= currentProfile.rules.length) return;
      const temp = currentProfile.rules[index];
      currentProfile.rules[index] = currentProfile.rules[index - 1];
      currentProfile.rules[index - 1] = temp;
      setUnsavedRouting(true);
      renderRules(currentProfile.rules);
    }

    function moveRuleDown(index) {
      if (!currentProfile || !Array.isArray(currentProfile.rules)) return;
      if (index < 0 || index >= currentProfile.rules.length - 1) return;
      const temp = currentProfile.rules[index];
      currentProfile.rules[index] = currentProfile.rules[index + 1];
      currentProfile.rules[index + 1] = temp;
      setUnsavedRouting(true);
      renderRules(currentProfile.rules);
    }

    function toggleRuleEnabled(idx) {
      if (currentProfile && currentProfile.rules[idx]) {
        currentProfile.rules[idx].enabled = !currentProfile.rules[idx].enabled;
        setUnsavedRouting(true);
        renderRules(currentProfile.rules);
      }
    }

    function removeRule(idx) {
      if (currentProfile && currentProfile.rules[idx]) {
        currentProfile.rules.splice(idx, 1);
        setUnsavedRouting(true);
        renderRules(currentProfile.rules);
        loadPresets();
      }
    }

    function addPresetRule(presetId, presetName, action) {
      if (!currentProfile) return;
      if (!Array.isArray(currentProfile.rules)) currentProfile.rules = [];
      const isRu = currentLang === 'ru';
      const existing = currentProfile.rules.find(r => r.targetType === 'preset' && r.pattern === presetId);
      if (existing) {
        existing.action = action;
        existing.enabled = true;
        toast((isRu ? 'Обновлено действие пресета: ' : 'Preset action updated: ') + presetName + ' -> ' + action.toUpperCase(), 'info');
      } else {
        currentProfile.rules.push({
          id: 'r_' + Math.random().toString(36).substring(2, 8),
          name: presetName,
          targetType: 'preset',
          pattern: presetId,
          action: action,
          enabled: true
        });
        toast((isRu ? 'Пресет добавлен: ' : 'Preset added: ') + presetName, 'success');
      }
      setUnsavedRouting(true);
      renderRules(currentProfile.rules);
      loadPresets();
    }

    function addCustomRule() {
      if (!currentProfile) return;
      const name = document.getElementById('newRuleName').value.trim();
      const pattern = document.getElementById('newRulePattern').value.trim();
      const action = document.getElementById('newRuleAction').value;

      if (!pattern) {
        toast('Please specify a rule pattern', 'error');
        return;
      }

      currentProfile.rules.push({
        id: 'r_' + Math.random().toString(36).substring(2, 8),
        name: name || pattern,
        targetType: pattern.includes('/') ? 'cidr' : 'wildcard',
        pattern: pattern,
        action: action,
        enabled: true
      });

      document.getElementById('newRuleName').value = '';
      document.getElementById('newRulePattern').value = '';
      setUnsavedRouting(true);
      renderRules(currentProfile.rules);
    }

    async function saveCurrentProfile() {
      if (!currentProfile) return;
      currentProfile.name = document.getElementById('profName').value.trim();
      currentProfile.defaultPolicy = document.getElementById('profDefaultPolicy').value;
      currentProfile.targetScope = document.getElementById('profTargetScope').value;
      currentProfile.targetGroup = document.getElementById('profTargetGroup').value.trim();
      currentProfile.failClosed = document.getElementById('profFailClosed').checked;

      try {
        const res = await adminFetch('/api/routing/profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(currentProfile)
        });
        if (res.ok) {
          toast(currentLang === 'ru' ? 'Профиль маршрутизации сохранен! Применен к соответствующим устройствам.' : 'Routing profile saved! Deployed to matching devices.', 'success');
          setUnsavedRouting(false);
          loadProfiles();
        } else {
          const data = await res.json().catch(() => ({}));
          toast('Failed to save profile: ' + (data.error || ('HTTP ' + res.status)), 'error');
        }
      } catch (e) {
        toast('Error saving profile: ' + e, 'error');
      }
    }

    // ==================== Geobase Inspector Modal Logic ====================
    let currentInspectorPreset = null;
    let inspectorEntries = [];
    let inspectorFilteredEntries = [];
    let inspectorSelectedSet = new Set();

    async function openGeobaseInspector(presetId) {
      const modal = document.getElementById('modalGeobaseInspector');
      if (!modal) return;
      modal.style.display = 'flex';
      
      const isRu = currentLang === 'ru';
      document.getElementById('inspectorTitle').textContent = isRu ? 'Загрузка...' : 'Loading...';
      document.getElementById('inspectorTableBody').innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">' + (isRu ? 'Загрузка содержимого пресета...' : 'Loading preset entries...') + '</td></tr>';
      document.getElementById('inspectorSearch').value = '';
      inspectorSelectedSet.clear();
      updateInspectorCounters();

      try {
        const res = await adminFetch('/api/routing/presets/' + encodeURIComponent(presetId));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const preset = await res.json();
        currentInspectorPreset = preset;

        document.getElementById('inspectorTitle').textContent = preset.name || presetId;
        const typeBadge = document.getElementById('inspectorTypeBadge');
        if (typeBadge) {
          typeBadge.textContent = (preset.type || 'domain').toUpperCase();
        }
        document.getElementById('inspectorSubtitle').textContent = preset.description || (preset.source ? 'Source: ' + preset.source : '');

        inspectorEntries = preset.entries || preset.domains || [];
        inspectorFilteredEntries = [...inspectorEntries];
        renderInspectorTable();
      } catch (err) {
        document.getElementById('inspectorTableBody').innerHTML = '<tr><td colspan="3" style="text-align: center; color: #ef4444;">' + (isRu ? 'Ошибка загрузки пресета: ' : 'Failed to load preset: ') + esc(String(err)) + '</td></tr>';
      }
    }

    function closeGeobaseInspector() {
      const modal = document.getElementById('modalGeobaseInspector');
      if (modal) modal.style.display = 'none';
      currentInspectorPreset = null;
      inspectorEntries = [];
      inspectorFilteredEntries = [];
      inspectorSelectedSet.clear();
    }

    function filterInspectorEntries() {
      const q = (document.getElementById('inspectorSearch').value || '').trim().toLowerCase();
      if (!q) {
        inspectorFilteredEntries = [...inspectorEntries];
      } else {
        inspectorFilteredEntries = inspectorEntries.filter(e => String(e).toLowerCase().includes(q));
      }
      renderInspectorTable();
    }

    function renderInspectorTable() {
      const tbody = document.getElementById('inspectorTableBody');
      const isRu = currentLang === 'ru';
      if (!inspectorFilteredEntries.length) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">' + (isRu ? 'Нет совпадений' : 'No matching entries') + '</td></tr>';
        updateInspectorCounters();
        return;
      }

      const limit = 500;
      const visible = inspectorFilteredEntries.slice(0, limit);
      tbody.innerHTML = visible.map(entry => {
        const checked = inspectorSelectedSet.has(entry) ? 'checked' : '';
        const entryType = entry.includes('/') ? 'CIDR' : (entry.startsWith('*.') || entry.startsWith('.')) ? 'Wildcard' : 'Domain';
        return `<tr>
          <td>
            <input type="checkbox" ${checked} onchange="toggleInspectorEntry('${esc(entry)}', this.checked)" style="margin: 0;" />
          </td>
          <td><code>${esc(entry)}</code></td>
          <td><span class="badge" style="font-size: 10px; background: rgba(255,255,255,0.06);">${entryType}</span></td>
        </tr>`;
      }).join('');

      if (inspectorFilteredEntries.length > limit) {
        tbody.innerHTML += `<tr><td colspan="3" style="text-align: center; color: var(--text-muted); font-size: 11px;">... ${isRu ? 'показано первых' : 'showing first'} ${limit} ${isRu ? 'из' : 'of'} ${inspectorFilteredEntries.length} (${isRu ? 'уточните поиск' : 'refine search'})</td></tr>`;
      }

      updateInspectorCounters();
    }

    function toggleInspectorEntry(entry, isChecked) {
      if (isChecked) {
        inspectorSelectedSet.add(entry);
      } else {
        inspectorSelectedSet.delete(entry);
      }
      updateInspectorCounters();
    }

    function selectInspectorAll(select) {
      if (select) {
        for (const e of inspectorFilteredEntries) {
          inspectorSelectedSet.add(e);
        }
      } else {
        for (const e of inspectorFilteredEntries) {
          inspectorSelectedSet.delete(e);
        }
      }
      renderInspectorTable();
    }

    function updateInspectorCounters() {
      const isRu = currentLang === 'ru';
      const selCount = document.getElementById('inspectorSelectedCount');
      if (selCount) {
        selCount.textContent = (isRu ? 'Выбрано: ' : 'Selected: ') + inspectorSelectedSet.size;
      }
      const totalCount = document.getElementById('inspectorTotalCount');
      if (totalCount) {
        totalCount.textContent = (isRu ? 'Всего записей: ' : 'Total entries: ') + inspectorEntries.length;
      }
      const allBox = document.getElementById('inspectorSelectAllBox');
      if (allBox) {
        allBox.checked = inspectorFilteredEntries.length > 0 && inspectorFilteredEntries.every(e => inspectorSelectedSet.has(e));
      }
    }

    function addSelectedToProfile() {
      const isRu = currentLang === 'ru';
      if (!currentProfile) {
        toast(isRu ? 'Профиль не выбран' : 'No active profile', 'error');
        return;
      }
      if (inspectorSelectedSet.size === 0) {
        toast(isRu ? 'Выберите хотя бы одну запись' : 'Select at least one entry', 'error');
        return;
      }

      if (!Array.isArray(currentProfile.rules)) currentProfile.rules = [];
      const selected = Array.from(inspectorSelectedSet);
      const action = document.getElementById('inspectorActionSelect').value || 'proxy';
      const presetName = currentInspectorPreset ? currentInspectorPreset.name : 'GeoBase';
      const ruleName = `${presetName} (${isRu ? 'выбрано' : 'selected'} ${selected.length})`;
      const pattern = selected.join(', ');

      currentProfile.rules.push({
        id: 'r_' + Math.random().toString(36).substring(2, 8),
        name: ruleName,
        targetType: pattern.includes('/') ? 'cidr' : 'wildcard',
        pattern: pattern,
        action: action,
        enabled: true
      });

      setUnsavedRouting(true);
      renderRules(currentProfile.rules);
      closeGeobaseInspector();
      toast((isRu ? 'Добавлено в профиль: ' : 'Added to profile: ') + selected.length + ' ' + (isRu ? 'записей' : 'entries'), 'success');
    }

    // ==================== Presets Import Modal Logic ====================
    let currentImportTab = 'url';

    function openImportPresetsModal() {
      const modal = document.getElementById('modalImportPresets');
      if (!modal) return;
      modal.style.display = 'flex';
      switchImportTab('url');
      document.getElementById('importPresetUrl').value = '';
      document.getElementById('importPresetFileInput').value = '';
      document.getElementById('importPresetTag').value = '';
      document.getElementById('importPresetName').value = '';
      document.getElementById('importPresetCategory').value = 'custom';
      document.getElementById('importPresetType').value = 'domain';
      const errBox = document.getElementById('importPresetError');
      if (errBox) {
        errBox.style.display = 'none';
        errBox.textContent = '';
      }
    }

    function closeImportPresetsModal() {
      const modal = document.getElementById('modalImportPresets');
      if (modal) modal.style.display = 'none';
    }

    function switchImportTab(tab) {
      currentImportTab = tab;
      const urlPanel = document.getElementById('panelImportUrl');
      const filePanel = document.getElementById('panelImportFile');
      const urlBtn = document.getElementById('tabImportUrlBtn');
      const fileBtn = document.getElementById('tabImportFileBtn');

      if (tab === 'url') {
        if (urlPanel) urlPanel.style.display = 'block';
        if (filePanel) filePanel.style.display = 'none';
        if (urlBtn) urlBtn.classList.add('active');
        if (fileBtn) fileBtn.classList.remove('active');
      } else {
        if (urlPanel) urlPanel.style.display = 'none';
        if (filePanel) filePanel.style.display = 'block';
        if (urlBtn) urlBtn.classList.remove('active');
        if (fileBtn) fileBtn.classList.add('active');
      }
    }

    async function submitImportPreset() {
      const isRu = currentLang === 'ru';
      const errBox = document.getElementById('importPresetError');
      if (errBox) {
        errBox.style.display = 'none';
        errBox.textContent = '';
      }

      const tag = document.getElementById('importPresetTag').value.trim();
      const name = document.getElementById('importPresetName').value.trim();
      const category = document.getElementById('importPresetCategory').value;
      const type = document.getElementById('importPresetType').value;
      const submitBtn = document.getElementById('btnSubmitImportPreset');

      if (currentImportTab === 'url') {
        const url = document.getElementById('importPresetUrl').value.trim();
        if (!url) {
          if (errBox) {
            errBox.textContent = isRu ? 'Укажите URL источника' : 'Specify source URL';
            errBox.style.display = 'block';
          }
          return;
        }

        try {
          if (submitBtn) submitBtn.disabled = true;
          const res = await adminFetch('/api/routing/presets/import-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, tag, name, category, type })
          });
          const data = await res.json();
          if (!res.ok || !data.ok) {
            throw new Error(data.error || ('HTTP ' + res.status));
          }
          toast((isRu ? 'Пресет успешно импортирован! Записей: ' : 'Preset successfully imported! Entries: ') + (data.preset ? data.preset.entriesCount : ''), 'success');
          closeImportPresetsModal();
          loadPresets();
        } catch (e) {
          if (errBox) {
            errBox.textContent = (isRu ? 'Ошибка импорта: ' : 'Import error: ') + e.message;
            errBox.style.display = 'block';
          }
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      } else {
        // File Upload
        const fileInput = document.getElementById('importPresetFileInput');
        if (!fileInput.files || !fileInput.files[0]) {
          if (errBox) {
            errBox.textContent = isRu ? 'Выберите файл для загрузки' : 'Select a file to upload';
            errBox.style.display = 'block';
          }
          return;
        }
        const file = fileInput.files[0];

        try {
          if (submitBtn) submitBtn.disabled = true;
          const reader = new FileReader();
          const base64Data = await new Promise((resolve, reject) => {
            reader.onload = () => {
              const res = reader.result;
              if (typeof res === 'string') {
                const b64 = res.includes(',') ? res.split(',')[1] : res;
                resolve(b64);
              } else {
                reject(new Error('Failed to read file'));
              }
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          });

          const res = await adminFetch('/api/routing/presets/import-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename: file.name,
              content: base64Data,
              encoding: 'base64',
              tag,
              name,
              category,
              type
            })
          });
          const data = await res.json();
          if (!res.ok || !data.ok) {
            throw new Error(data.error || ('HTTP ' + res.status));
          }
          toast((isRu ? 'Файл пресета импортирован! Записей: ' : 'Preset file imported! Entries: ') + (data.preset ? data.preset.entriesCount : ''), 'success');
          closeImportPresetsModal();
          loadPresets();
        } catch (e) {
          if (errBox) {
            errBox.textContent = (isRu ? 'Ошибка импорта: ' : 'Import error: ') + e.message;
            errBox.style.display = 'block';
          }
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      }
    }

    async function createNewProfile() {
      const name = prompt('Enter name for the new Routing Profile:', 'New Department Profile');
      if (!name) return;
      const newP = {
        id: 'prof_' + Math.random().toString(36).substring(2, 8),
        name: name,
        description: 'Custom routing profile',
        defaultPolicy: 'direct',
        targetScope: 'all',
        rules: []
      };
      // Persist immediately: a profile that only lives in the tab's memory
      // silently disappeared on reload (while Delete hit the server at once).
      try {
        const res = await adminFetch('/api/routing/profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newP)
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast('Failed to create profile: ' + (data.error || ('HTTP ' + res.status)), 'error');
          return;
        }
        const saved = await res.json();
        allProfiles.push(saved);
        currentProfile = saved;

        const sel = document.getElementById('profileSelect');
        const opt = document.createElement('option');
        opt.value = saved.id;
        opt.textContent = saved.name;
        opt.selected = true;
        sel.appendChild(opt);

        renderProfile(saved);
        toast('Profile created on the server. Remember to add rules and press Save after editing.', 'success');
      } catch (e) {
        toast('Error creating profile: ' + e, 'error');
      }
    }

    async function deleteCurrentProfile() {
      if (!currentProfile) return;
      if (!confirm('Are you sure you want to delete profile "' + currentProfile.name + '"?')) return;
      try {
        const res = await adminFetch('/api/routing/profiles/' + currentProfile.id, { method: 'DELETE' });
        const data = await res.json();
        if (data.ok) {
          toast('Profile deleted', 'success');
          loadProfiles();
        } else {
          toast('Delete error: ' + (data.error || 'Failed'), 'error');
        }
      } catch (e) {
        toast('Error: ' + e, 'error');
      }
    }

    // ----------------- Extension Constructor Studio & Live Sandbox -----------------
    let liveSimState = {
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
    let activeTemplatePreset = 'self-service-pro';
    let activeStylePreset = 'cyber-blue';
    let activeStudioLayout = 'console';
    let activeStudioPalette = 'cyber';
    let activeStudioThemeMode = 'dark';

    function setStudioLayout(layout, silent = false) {
      if (layout !== 'terminal' && layout !== 'console') {
        layout = 'console';
      }
      activeStudioLayout = layout;

      const btnConsole = document.getElementById('btnStudioLayoutConsole');
      const btnTerminal = document.getElementById('btnStudioLayoutTerminal');
      if (btnConsole) btnConsole.classList.toggle('active', layout === 'console');
      if (btnTerminal) btnTerminal.classList.toggle('active', layout === 'terminal');

      updateLivePreviewThemeAndLayout();
      if (!silent) onConfigChangeLive();
    }

    function setStudioPalette(palette, silent = false) {
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
      if (!silent) onConfigChangeLive();
    }

    function setStudioThemeMode(mode, silent = false) {
      if (mode !== 'light' && mode !== 'dark') {
        mode = 'dark';
      }
      activeStudioThemeMode = mode;

      const btnDark = document.getElementById('btnStudioModeDark');
      const btnLight = document.getElementById('btnStudioModeLight');
      if (btnDark) btnDark.classList.toggle('active', mode === 'dark');
      if (btnLight) btnLight.classList.toggle('active', mode === 'light');

      updateLivePreviewThemeAndLayout();
      if (!silent) onConfigChangeLive();
    }

    function updateLivePreviewThemeAndLayout() {
      const iframe = document.getElementById('previewFrame');
      if (iframe && iframe.contentWindow) {
        try {
          iframe.contentWindow.postMessage({
            type: 'UPDATE_STUDIO_THEME',
            palette: activeStudioPalette,
            layout: activeStudioLayout,
            themeMode: activeStudioThemeMode
          }, '*');
        } catch (e) {}
      }
    }

    window.setStudioLayout = setStudioLayout;
    window.setStudioPalette = setStudioPalette;
    window.setStudioThemeMode = setStudioThemeMode;

    let currentCustomIconDataUrl = '';

    function setCustomIconDataUrl(dataUrl, triggerSave = true) {
      currentCustomIconDataUrl = dataUrl || '';
      const previewBox = document.getElementById('customIconPreviewBox');
      const previewImg = document.getElementById('customIconPreviewImg');
      if (currentCustomIconDataUrl) {
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
    }

    window.clearCustomIcon = function() {
      setCustomIconDataUrl('', true);
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
            setCustomIconDataUrl(pngDataUrl, true);
          } catch (err) {
            setCustomIconDataUrl(rawUrl, true);
          }
        };
        img.onerror = function() {
          setCustomIconDataUrl(rawUrl, true);
        };
        img.src = rawUrl;
      };
      reader.readAsDataURL(file);
    };

    async function loadBuilderConfig() {
      try {
        const res = await adminFetch('/api/builder/config');
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
          setCustomIconDataUrl(cfg.customIconDataUrl, false);
        } else {
          setCustomIconDataUrl('', false);
        }
        document.getElementById('bldDesc').value = cfg.description || 'Enterprise Chrome extension for automatic proxy synchronization';
        const srvInput = document.getElementById('bldServerUrl');
        if (srvInput) {
          srvInput.value = (cfg.defaultServerUrl && !cfg.defaultServerUrl.includes('mini-server.ic.local'))
            ? cfg.defaultServerUrl
            : window.location.origin;
        }
        document.getElementById('bldSyncInterval').value = cfg.syncIntervalMinutes || 15;
        document.getElementById('bldWebRtc').checked = cfg.webRtcProtection !== false;
        document.getElementById('bldDnsGuard').checked = cfg.dnsLeakProtection !== false;
        document.getElementById('bldBadge').checked = cfg.badgeIndicator !== false;
        document.getElementById('bldAutoProxy').checked = cfg.autoConfigureProxy !== false;
        document.getElementById('bldAllowBypass').checked = cfg.allowUserBypass !== false;
        document.getElementById('bldIpGeo').checked = cfg.showIpGeoCheck !== false;
        document.getElementById('bldBypassTimeout').value = cfg.bypassTimeoutMinutes || 15;
        document.getElementById('bldSupportUrl').value = cfg.supportUrl || 'mailto:it-support@corp.local';

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
            'sunset-amber': 'cyber',
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
      } catch (e) {
        console.error(e);
      }
    }

    function applyUiModePreset(mode, triggerSave = true) {
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
    }
    window.applyUiModePreset = applyUiModePreset;

    function highlightTemplateChip(preset, triggerSave = false) {
      if (preset === 'enterprise-invisible' || preset === 'stealth') {
        applyUiModePreset('stealth', triggerSave);
      } else {
        applyUiModePreset('popup', triggerSave);
      }
    }

    async function applyTemplatePreset(preset) {
      if (preset === 'enterprise-invisible' || preset === 'stealth') {
        applyUiModePreset('stealth', true);
      } else {
        applyUiModePreset('popup', true);
      }
    }
    window.applyTemplatePreset = applyTemplatePreset;

    async function applyStylePreset(style) {
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

    function onConfigChangeLive() {
      clearTimeout(builderDebounceTimer);
      builderDebounceTimer = setTimeout(async () => {
        await saveBuilderConfigOnly(false);
        await regenerateTemplatesFromConfig();
      }, 500);
    }

    async function regenerateTemplatesFromConfig() {
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

    function onCodeEditorLiveChange() {
      const fileName = document.getElementById('codeFileSelect').value;
      const content = document.getElementById('codeEditor').value;
      extensionFiles[fileName] = content;
      
      clearTimeout(codeEditorDebounceTimer);
      codeEditorDebounceTimer = setTimeout(() => {
        updateLivePreview();
      }, 250);
    }

    function pushSimStateToIframe() {
      const iframe = document.getElementById('previewFrame');
      if (iframe && iframe.contentWindow) {
        try {
          iframe.contentWindow.postMessage({ type: 'UPDATE_SIM_STATE', state: liveSimState }, '*');
        } catch (e) {}
      }
    }

    function simulateState(stateType) {
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
          label.textContent = isRu ? 'Состояние: Временный прямой обход' : 'State: Bypassed / Direct Fallback';
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

    function toggleSimBypass() {
      liveSimState.bypassActive = !liveSimState.bypassActive;
      liveSimState.status = liveSimState.bypassActive ? 'Bypassed' : 'Active';
      const label = document.getElementById('simStateLabel');
      const isRu = currentLang === 'ru';
      if (label) {
        if (liveSimState.bypassActive) {
          label.textContent = isRu ? 'Состояние: Временный прямой обход' : 'State: Bypassed / Direct Fallback';
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

    function togglePopupPreviewVisibility() {
      const popupBox = document.getElementById('popupFrameBox');
      if (popupBox.style.display === 'none') {
        popupBox.style.display = 'block';
      } else {
        popupBox.style.display = 'none';
      }
    }

    function updateLivePreview() {
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
            'if (document.body) {' +
              'if (e.data.palette) document.body.setAttribute("data-palette", e.data.palette);' +
              'if (e.data.layout) document.body.setAttribute("data-layout", e.data.layout);' +
              'if (e.data.themeMode) document.body.setAttribute("data-theme", e.data.themeMode);' +
            '}' +
          '}' +
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

      let doc = htmlContent;
      doc = doc.replace(/<body([^>]*)>/i, function(match, attrs) {
        let clean = attrs.replace(/\s*data-palette="[^"]*"/g, '')
                         .replace(/\s*data-layout="[^"]*"/g, '')
                         .replace(/\s*data-theme="[^"]*"/g, '');
        return '<body' + clean + ' data-palette="' + activeStudioPalette + '" data-layout="' + activeStudioLayout + '" data-theme="' + activeStudioThemeMode + '">';
      });
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
          pushSimStateToIframe();
          updateLivePreviewThemeAndLayout();
        };
        iframe.srcdoc = doc;
      }
    }

    window.addEventListener('message', (e) => {
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
    });

    async function loadExtensionFiles() {
      try {
        const res = await adminFetch('/api/builder/files');
        extensionFiles = await res.json();
        loadFileContent();
        updateLivePreview();
      } catch (e) {
        console.error(e);
      }
    }

    function loadFileContent() {
      const fileName = document.getElementById('codeFileSelect').value;
      const editor = document.getElementById('codeEditor');
      editor.value = extensionFiles[fileName] || '// File not found or empty';
      document.getElementById('codeStatus').textContent = 'Viewing ' + fileName;
      updateLivePreview();
    }

    async function saveCurrentCodeFile() {
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

    async function saveBuilderConfigOnly(showAlert = true) {
      const payload = {
        name: document.getElementById('bldName').value.trim(),
        shortName: document.getElementById('bldShortName').value.trim(),
        version: document.getElementById('bldVersion').value.trim(),
        uiMode: document.getElementById('bldUiMode') ? document.getElementById('bldUiMode').value : 'popup',
        iconType: document.getElementById('bldIconType') ? document.getElementById('bldIconType').value : undefined,
        themeColor: document.getElementById('bldThemeColor').value.trim(),
        iconEmoji: document.getElementById('bldEmoji').value.trim(),
        customIconDataUrl: currentCustomIconDataUrl || undefined,
        description: document.getElementById('bldDesc').value.trim(),
        defaultServerUrl: document.getElementById('bldServerUrl')
          ? document.getElementById('bldServerUrl').value.trim()
          : '',
        syncIntervalMinutes: parseInt(document.getElementById('bldSyncInterval').value, 10) || 15,
        webRtcProtection: document.getElementById('bldWebRtc').checked,
        dnsLeakProtection: document.getElementById('bldDnsGuard').checked,
        badgeIndicator: document.getElementById('bldBadge').checked,
        autoConfigureProxy: document.getElementById('bldAutoProxy').checked,
        allowUserBypass: document.getElementById('bldAllowBypass').checked,
        showIpGeoCheck: document.getElementById('bldIpGeo').checked,
        bypassTimeoutMinutes: parseInt(document.getElementById('bldBypassTimeout').value, 10) || 15,
        supportUrl: document.getElementById('bldSupportUrl').value.trim(),
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

    async function buildExtensionPackage() {
      const savedOk = await saveBuilderConfigOnly(false);
      if (savedOk === false) {
        toast('Build aborted: could not save the builder configuration.', 'error');
        return;
      }
      return await buildAndPackExtension();
    }
    window.buildExtensionPackage = buildExtensionPackage;

    async function buildAndPackExtension() {
      const savedOk = await saveBuilderConfigOnly(false);
      if (savedOk === false) {
        toast('Build aborted: could not save the builder configuration.', 'error');
        return;
      }
      try {
        const res = await adminFetch('/api/builder/build', { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
          toast('Extension package built successfully! .CRX signed, .ZIP created, and updates.xml regenerated.', 'success');
          fetchExtensionInfo();
          await loadExtensionFiles();
        } else {
          toast('Build error: ' + (data.error || 'Failed'), 'error');
        }
      } catch (e) {
        toast('Error building extension: ' + e, 'error');
      }
    }

    async function downloadExtensionPackage(type) {
      toast(currentLang === 'ru' ? 'Сборка пакета перед скачиванием...' : 'Building package before download...', 'info');
      await buildAndPackExtension();
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

    // ----------------- Devices & Instances -----------------
    async function loadInstances() {
      try {
        const res = await adminFetch('/api/instances');
        const data = await res.json();
        const isRu = currentLang === 'ru';
        const badge = document.getElementById('badgeFleetOnline');
        if (badge) {
          badge.textContent = data.online + (isRu ? ' онлайн' : ' online');
        }
        renderInstancesTable(data.instances || []);
      } catch (e) {
        console.error(e);
      }
    }

    async function fetchFleet() {
      return loadInstances();
    }

    function renderInstancesTable(instances) {
      const isRu = currentLang === 'ru';
      const tbody = document.getElementById('fleetTableBody');
      if (!tbody) return;
      if (!instances || !instances.length) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--text-muted);">' + (isRu ? 'Пока нет подключенных устройств. Расширения синхронизируются через <code>/api/sync</code> каждые 5 мин.' : 'No instances connected yet. Extensions sync via <code>/api/sync</code> every 5 min.') + '</td></tr>';
        return;
      }

      const profileOptions = allProfiles.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');

      tbody.innerHTML = instances.map(inst => {
        let badge = 'badge-online';
        if (inst.status === 'STALE') badge = 'badge-stale';
        else if (inst.status === 'OFFLINE') badge = 'badge-offline';

        return `<tr>
          <td><code>${esc(inst.instanceId)}</code></td>
          <td style="font-family: var(--mono);">${esc(inst.ip)}</td>
          <td>v${esc(inst.version)}</td>
          <td><code>${esc(inst.group || (isRu ? 'Основная группа' : 'Default Group'))}</code></td>
          <td><span class="badge badge-action-proxy">${esc(inst.appliedProfileName || (isRu ? 'По умолчанию' : 'Default'))}</span></td>
          <td>${esc(inst.syncCount)}</td>
          <td><span class="badge ${badge}">${esc(inst.status)}</span></td>
          <td>
            <select onchange="assignProfileToInstance('${esc(inst.instanceId)}', this.value)" style="margin-bottom: 0; font-size: 11px; padding: 3px 6px;">
              <option value="">${isRu ? 'По умолчанию (Авто)' : 'Default (Auto)'}</option>
              ${profileOptions}
            </select>
          </td>
          <td>
            <button class="btn btn-sm btn-danger btn-delete-instance" data-id="${escapeHtml(inst.instanceId)}" title="Удалить устройство">🗑️</button>
          </td>
        </tr>`;
      }).join('');
    }

    async function deleteInstance(id) {
      if (!confirm("Удалить устройство " + id + "?")) return;
      try {
        const res = await adminFetch('/api/instances/' + encodeURIComponent(id), {
          method: 'DELETE'
        });
        if (res.ok || res.status === 200) {
          toast(currentLang === 'ru' ? 'Устройство успешно удалено' : 'Device deleted successfully', 'success');
          loadInstances();
        } else {
          const errData = await res.json().catch(() => ({}));
          toast('Delete error: ' + (errData.error || res.statusText), 'error');
        }
      } catch (err) {
        toast('Delete error: ' + err, 'error');
      }
    }

    document.addEventListener('click', function (e) {
      const btn = e.target.closest('.btn-delete-instance');
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      if (id) {
        deleteInstance(id);
      }
    });

    async function assignProfileToInstance(instanceId, profileId) {
      try {
        await adminFetch('/api/instances/assign-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instanceId, profileId })
        });
        loadInstances();
      } catch (e) {
        toast('Assignment error: ' + e, 'error');
      }
    }

    // ----------------- Extension Info & GPO -----------------
    async function fetchExtensionInfo() {
      try {
        const res = await adminFetch('/api/extension/info');
        const data = await res.json();
        document.getElementById('dispExtId').textContent = data.extensionId;
        document.getElementById('dispExtVer').textContent = data.version;

        globalGpo = data.gpo;
        if (data.gpo) {
          document.getElementById('gpoForcelist').textContent = data.gpo.forcelistEntry;
          document.getElementById('gpoSettings').textContent = JSON.stringify(data.gpo.extensionSettingsJson, null, 2);
          const scenGpo = document.getElementById('scenGpoForcelistText');
          if (scenGpo) scenGpo.textContent = data.gpo.forcelistEntry;
        }
      } catch (e) {
        console.error(e);
      }
    }

    async function downloadRegFile() {
      // Fetch GPO data on demand instead of failing silently when the page
      // state has not been populated yet.
      if (!globalGpo || !globalGpo.regContent) {
        try {
          await fetchExtensionInfo();
        } catch (e) {
          toast('Could not load GPO configuration: ' + e, 'error');
          return;
        }
      }
      if (!globalGpo || !globalGpo.regContent) {
        toast('GPO configuration is not available yet.', 'error');
        return;
      }
      const blob = new Blob([globalGpo.regContent], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'corp-proxy-policy.reg';
      a.click();
    }

    // ----------------- System Status & Kill-Switch -----------------
    async function fetchStatus() {
      try {
        const res = await adminFetch('/api/status');
        const data = await res.json();
        const isRu = currentLang === 'ru';
        
        document.getElementById('hdrUser').textContent = data.currentUser || (isRu ? 'нет' : 'none');
        document.getElementById('hdrFleetCount').textContent = data.activeInstancesCount + (isRu ? ' активных (' : ' active (') + data.totalInstancesCount + (isRu ? ' всего)' : ' total)');
        
        if (data.nextRotationAt) {
          const diffMin = Math.round((new Date(data.nextRotationAt).getTime() - Date.now()) / 60000);
          document.getElementById('hdrNextRot').textContent = (diffMin > 0 ? (isRu ? 'через ' + diffMin + ' мин' : 'in ' + diffMin + 'm') : (isRu ? 'сейчас' : 'imminent')) + ' (' + new Date(data.nextRotationAt).toLocaleTimeString() + ')';
        } else {
          document.getElementById('hdrNextRot').textContent = isRu ? 'Отключено' : 'Disabled';
        }

        // Kill-switch state is the SERVER's truth, never a local guess:
        // a stale local flag previously let a second tab (or a reopened
        // dashboard) accidentally flip the emergency state.
        if (typeof data.killSwitch === 'boolean' && data.killSwitch !== globalKillSwitch) {
          globalKillSwitch = data.killSwitch;
          updateKillSwitchButton();
        }

        renderAuditLogs(data.auditLogs || []);
      } catch (err) {
        console.error(err);
      }
    }

    function updateKillSwitchButton() {
      const ksBtn = document.getElementById('btnKillSwitch');
      if (!ksBtn) return;
      const dict = I18N[currentLang] || I18N.ru;
      if (globalKillSwitch) {
        ksBtn.textContent = dict.btnKillSwitchOn;
        ksBtn.classList.remove('btn-secondary');
        ksBtn.classList.add('btn-danger');
      } else {
        ksBtn.textContent = dict.btnKillSwitchOff;
        ksBtn.classList.remove('btn-danger');
        ksBtn.classList.add('btn-secondary');
      }
    }

    async function toggleKillSwitch() {
      const desired = !globalKillSwitch;
      try {
        const res = await adminFetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ killSwitch: desired })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || ('HTTP ' + res.status));
        }
        const updated = await res.json();
        globalKillSwitch = Boolean(updated.killSwitch);
        updateKillSwitchButton();
      } catch (e) {
        toast('Kill-switch error: ' + e, 'error');
        fetchStatus(); // resync with the server's actual state
      }
    }

    // ----------------- 3x-ui Rotation -----------------
    async function fetchRotationConfig() {
      try {
        const res = await adminFetch('/api/rotation/config');
        const data = await res.json();
        const cfg = data.config;
        
        document.getElementById('rotPanelUrl').value = cfg.panelUrl || '';
        document.getElementById('rotAdminUser').value = cfg.adminUser || '';
        document.getElementById('rotRemark').value = cfg.inboundRemark || '';
        document.getElementById('rotInterval').value = String(cfg.intervalMinutes || 1440);
        document.getElementById('rotEnabled').value = String(cfg.enabled);
        const rotInsecure = document.getElementById('rotInsecureTls');
        if (rotInsecure) rotInsecure.checked = Boolean(cfg.insecureSkipVerify);
        
        document.getElementById('rotStatusText').textContent = cfg.lastStatus || 'Idle';
        document.getElementById('rotNextRun').textContent = cfg.nextRotationAt ? new Date(cfg.nextRotationAt).toLocaleString() : 'Disabled';
        document.getElementById('rotLastRun').textContent = cfg.lastRotatedAt ? new Date(cfg.lastRotatedAt).toLocaleString() : 'None';

        const passBadge = document.getElementById('passwordSavedBadge');
        if (passBadge) {
          if ((cfg.rotAdminPass && cfg.rotAdminPass !== '') || (cfg.adminPass && cfg.adminPass !== '')) {
            passBadge.style.display = 'inline-block';
          } else {
            passBadge.style.display = 'none';
          }
        }

        renderRotationHistory(data.history || []);
      } catch (e) {
        console.error(e);
      }
    }

    async function saveRotationConfig() {
      const intervalRaw = document.getElementById('rotInterval').value.trim();
      const intervalNum = parseInt(intervalRaw, 10);
      if (!intervalRaw || !Number.isFinite(intervalNum) || intervalNum < 1 || String(intervalNum) !== intervalRaw) {
        toast('Rotation interval must be a whole number of minutes (>= 1).', 'error');
        return;
      }
      const rotInsecure = document.getElementById('rotInsecureTls');
      const payload = {
        panelUrl: document.getElementById('rotPanelUrl').value.trim(),
        adminUser: document.getElementById('rotAdminUser').value.trim(),
        inboundRemark: document.getElementById('rotRemark').value.trim(),
        intervalMinutes: intervalNum,
        enabled: document.getElementById('rotEnabled').value === 'true',
        insecureSkipVerify: rotInsecure ? rotInsecure.checked : false,
      };
      const pass = document.getElementById('rotAdminPass').value;
      if (pass) payload.adminPass = pass;

      try {
        const res = await adminFetch('/api/rotation/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          toast('Rotation schedule updated!', 'success');
          fetchRotationConfig();
          fetchStatus();
        } else {
          const data = await res.json().catch(() => ({}));
          toast('Failed to save rotation settings: ' + (data.error || ('HTTP ' + res.status)), 'error');
        }
      } catch (e) {
        toast('Error saving rotation settings: ' + e, 'error');
      }
    }

    async function test3xui() {
      const out = document.getElementById('test3xuiResult');
      out.textContent = 'Testing connection to 3x-ui API...';
      const payload = {
        panelUrl: document.getElementById('rotPanelUrl').value.trim(),
        adminUser: document.getElementById('rotAdminUser').value.trim(),
        adminPass: document.getElementById('rotAdminPass').value,
        inboundRemark: document.getElementById('rotRemark').value.trim()
      };

      try {
        const res = await adminFetch('/api/3xui/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        out.textContent = (data.ok ? '✅ ' : '❌ ') + data.message;
        out.style.color = data.ok ? 'var(--success)' : 'var(--danger)';
      } catch (e) {
        out.textContent = 'Connection test failed: ' + e;
        out.style.color = 'var(--danger)';
      }
    }

    async function manualRotate() {
      if (!confirm('Rotate proxy credentials immediately?')) return;
      try {
        const res = await adminFetch('/api/rotation/rotate-now', { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
          toast('Rotated! New user: ' + data.result.user + ' (source: ' + data.result.source + ')', 'success');
          refreshAll();
        } else {
          toast('Rotation error: ' + data.error, 'error');
        }
      } catch (e) {
        toast('Failed: ' + e, 'error');
      }
    }

    function renderRotationHistory(history) {
      const tbody = document.getElementById('rotHistoryTable');
      if (!history.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="color: var(--text-muted); text-align: center;">No rotation events yet</td></tr>';
        return;
      }
      tbody.innerHTML = history.map(item => `<tr>
        <td style="font-family: var(--mono); font-size: 12px;">${new Date(item.timestamp).toLocaleTimeString()}</td>
        <td><code>${esc(item.source)}</code></td>
        <td>${esc(item.user)}</td>
        <td><span class="badge ${item.success ? 'badge-online' : 'badge-offline'}">${item.success ? 'SUCCESS' : 'FAILED'}</span></td>
      </tr>`).join('');
    }

    // ----------------- Upstream Proxy Registry -----------------
    async function fetchProxies() {
      try {
        const res = await adminFetch('/api/proxies');
        if (!res.ok) {
          console.warn('Failed to fetch proxies: HTTP ' + res.status);
          return;
        }
        currentProxiesList = (await res.json()) || [];
        renderProxiesTable(currentProxiesList);
      } catch (e) {
        console.error('Error fetching proxies:', e);
      }
    }

    function renderProxiesTable(proxies) {
      const list = proxies || [];
      const tbody = document.getElementById('proxiesTableBody');
      if (tbody) {
        if (!list.length) {
          tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">' + esc(t('txtNoProxies', 'No proxy nodes configured yet.')) + '</td></tr>';
        } else {
          tbody.innerHTML = list.map(function (px) {
            const activeCell = px.isActive
              ? '<span class="badge badge-online" style="cursor: default;" title="' + esc(t('badgeActive', 'ACTIVE')) + '">● ' + esc(t('badgeActive', 'ACTIVE')) + '</span>'
              : '<button type="button" class="btn-secondary" style="font-size: 11px; padding: 3px 8px;" onclick="activateProxy(\'' + esc(px.id) + '\')">' + esc(t('btnSetActive', 'Activate')) + '</button>';

            const nameHtml = (px.name && px.name !== px.tag)
              ? '<div style="font-size: 11px; color: var(--text-muted);">' + esc(px.name) + '</div>'
              : '';

            const typeBadge = px.type === '3x-ui' ? 'badge-action-proxy' : 'badge-secondary';
            const statusBadge = px.status === 'OK' ? 'badge-online' : (px.status === 'ERROR' ? 'badge-offline' : 'badge-secondary');
            const syncTime = px.lastSync ? '<div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">' + new Date(px.lastSync).toLocaleTimeString() + '</div>' : '';

            const syncBtn = px.type === '3x-ui'
              ? '<button type="button" class="btn-secondary" style="font-size: 11px; padding: 3px 6px;" onclick="syncProxy(\'' + esc(px.id) + '\')" title="' + esc(t('btnSyncProxy', 'Sync & Rotate')) + '">🔄</button>'
              : '';

            const socksAuthWarn = (px.protocol === 'socks5' && px.username)
              ? ' <span title="' + esc(t('warnSocksAuthTable', 'Chromium browsers do not support SOCKS5 with authentication. Use HTTP or IP-whitelisted SOCKS5.')) + '" style="cursor: help; color: #f59e0b;" class="socks-auth-warn">⚠️</span>'
              : '';

            return '<tr>' +
              '<td style="text-align: center;">' + activeCell + '</td>' +
              '<td><div><strong>' + esc(px.tag) + '</strong></div>' + nameHtml + '</td>' +
              '<td><span class="badge ' + esc(typeBadge) + '">' + esc(px.type) + '</span></td>' +
              '<td><code style="font-size: 11px; text-transform: uppercase;">' + esc(px.protocol) + '</code>' + socksAuthWarn + '</td>' +
              '<td><code>' + esc(px.host) + ':' + esc(px.port) + '</code></td>' +
              '<td><span>' + esc(px.username || '—') + '</span></td>' +
              '<td><span class="badge ' + esc(statusBadge) + '" title="' + esc(px.errorMessage || '') + '">' + esc(px.status || 'IDLE') + '</span>' + syncTime + '</td>' +
              '<td style="text-align: right;"><div style="display: flex; gap: 4px; justify-content: flex-end;">' +
                syncBtn +
                '<button type="button" class="btn-secondary" style="font-size: 11px; padding: 3px 6px;" onclick="openEditProxyModal(\'' + esc(px.id) + '\')" title="' + esc(t('btnEditProxy', 'Edit')) + '">✏️</button>' +
                '<button type="button" class="btn-danger" style="font-size: 11px; padding: 3px 6px;" onclick="deleteProxy(\'' + esc(px.id) + '\')" title="' + esc(t('btnDeleteProxy', 'Delete')) + '">🗑️</button>' +
              '</div></td>' +
            '</tr>';
          }).join('');
        }
      }

      // Update active PAC directive indicator
      const active = list.find(function (px) { return px.isActive; });
      const pacText = document.getElementById('activePacDirectiveText');
      const activeBadge = document.getElementById('activeProxyBadge');
      if (pacText) {
        if (active) {
          let directive = 'PROXY ' + active.host + ':' + active.port + '; DIRECT';
          if (active.protocol === 'socks5') directive = 'SOCKS5 ' + active.host + ':' + active.port + '; DIRECT';
          else if (active.protocol === 'https') directive = 'HTTPS ' + active.host + ':' + active.port + '; DIRECT';
          pacText.textContent = directive;
        } else {
          pacText.textContent = 'DIRECT';
        }
      }
      if (activeBadge) {
        if (active) {
          activeBadge.textContent = active.tag + ' (' + active.protocol + ')';
          activeBadge.className = 'badge badge-action-proxy';
        } else {
          activeBadge.textContent = t('badgeNoActiveProxy', 'No Active Proxy');
          activeBadge.className = 'badge badge-offline';
        }
      }

      // 0. Warning banner for placeholder 10.0.0.1 (shown when no proxy is active)
      const warnBanner = document.getElementById('noActiveProxyWarning');
      if (warnBanner) {
        warnBanner.style.display = active ? 'none' : 'flex';
      }
    }

    async function fetchProxyConfig() {
      try {
        const res = await adminFetch('/api/config');
        if (!res.ok) return;
        const cfg = await res.json();
        const mode = cfg.routingMode || 'pac';
        const pacRadio = document.getElementById('routingModePac');
        const fixedRadio = document.getElementById('routingModeFixed');
        if (pacRadio && fixedRadio) {
          if (mode === 'fixed') {
            fixedRadio.checked = true;
          } else {
            pacRadio.checked = true;
          }
        }
      } catch (err) {
        console.warn('Failed to fetch proxy config:', err);
      }
    }

    async function onRoutingModeChanged(mode) {
      try {
        const res = await adminFetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ routingMode: mode })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || ('HTTP ' + res.status));
        }
        toast(t('toastRoutingModeSaved', 'Routing mode updated! Extensions will receive it on next sync.'), 'success');
      } catch (e) {
        toast('Failed to update routing mode: ' + e, 'error');
        fetchProxyConfig();
      }
    }

    async function activateProxy(id) {
      try {
        const res = await adminFetch('/api/proxies/' + encodeURIComponent(id) + '/activate', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          toast(t('toastProxyActivated', 'Proxy activated!'), 'success');
          await fetchProxies();
          fetchStatus();
        } else {
          toast(data.error || 'Failed to activate proxy', 'error');
        }
      } catch (e) {
        toast('Error activating proxy: ' + e, 'error');
      }
    }

    async function syncProxy(id) {
      try {
        toast('Syncing proxy with 3x-ui...', 'info');
        const res = await adminFetch('/api/proxies/' + encodeURIComponent(id) + '/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rotatePassword: true })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          toast(data.message || t('toastProxySynced', 'Proxy synchronized!'), 'success');
          await fetchProxies();
          fetchStatus();
        } else {
          toast(data.error || 'Failed to sync proxy', 'error');
        }
      } catch (e) {
        toast('Error syncing proxy: ' + e, 'error');
      }
    }

    async function deleteProxy(id) {
      if (!confirm(t('confirmDeleteProxy', 'Are you sure you want to delete this proxy node?'))) return;
      try {
        const res = await adminFetch('/api/proxies/' + encodeURIComponent(id), { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          toast(t('toastProxyDeleted', 'Proxy deleted'), 'success');
          await fetchProxies();
          fetchStatus();
        } else {
          toast(data.error || 'Failed to delete proxy', 'error');
        }
      } catch (e) {
        toast('Error deleting proxy: ' + e, 'error');
      }
    }

    function openAdd3xuiModal() {
      const tagEl = document.getElementById('add3xuiTag');
      const nameEl = document.getElementById('add3xuiName');
      const hostEl = document.getElementById('add3xuiHost');
      const activeEl = document.getElementById('add3xuiIsActive');
      const previewEl = document.getElementById('add3xuiPreview');
      const errEl = document.getElementById('add3xuiError');
      if (tagEl) tagEl.value = '';
      if (nameEl) nameEl.value = '';
      if (hostEl) hostEl.value = '';
      if (activeEl) activeEl.checked = true;
      if (previewEl) previewEl.innerHTML = '<span data-i18n="txtInboundPreviewPlaceholder">' + esc(t('txtInboundPreviewPlaceholder', 'Click "Fetch Info" to preview inbound parameters before adding.')) + '</span>';
      if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
      const modal = document.getElementById('modalAdd3xui');
      if (modal) modal.style.display = 'flex';
      if (tagEl) tagEl.focus();
    }

    function closeAdd3xuiModal() {
      const modal = document.getElementById('modalAdd3xui');
      if (modal) modal.style.display = 'none';
    }

    async function lookup3xuiInbound() {
      const tagEl = document.getElementById('add3xuiTag');
      const tag = tagEl ? tagEl.value.trim() : '';
      const errEl = document.getElementById('add3xuiError');
      const previewEl = document.getElementById('add3xuiPreview');
      if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
      if (!tag) {
        if (errEl) { errEl.textContent = 'Please enter an inbound tag'; errEl.style.display = 'block'; }
        return;
      }
      if (previewEl) previewEl.textContent = 'Querying 3x-ui panel...';

      try {
        const res = await adminFetch('/api/3xui/inbound-lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tag: tag })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok && data.inbound) {
          const ib = data.inbound;
          let warnHtml = '';
          if ((ib.protocol === 'socks' || ib.protocol === 'socks5') && (ib.username || ib.hasPassword)) {
            warnHtml = '<div style="margin-top: 8px; padding: 6px 10px; background: rgba(245, 158, 11, 0.15); border: 1px solid #f59e0b; border-radius: 4px; color: #fbbf24; font-size: 11px;">' +
              esc(t('warnChromiumSocks5Auth', '⚠️ Chromium (Chrome, Edge, Brave, Yandex) does not support SOCKS5 authentication. If credentials are set, Chrome will reject the connection or bypass the proxy. Use HTTP protocol for authenticated corporate proxies or use SOCKS5 without username/password (e.g. IP whitelist).')) +
              '</div>';
          }
          if (previewEl) {
            previewEl.innerHTML = '<div style="color: var(--success); font-weight: 600; margin-bottom: 4px;">Inbound Found:</div>' +
              '<div><strong>Protocol:</strong> ' + esc(ib.protocol) + ' &bull; <strong>Port:</strong> ' + esc(ib.port) + '</div>' +
              '<div><strong>Username:</strong> ' + esc(ib.username || 'none') + ' &bull; <strong>Password:</strong> ' + (ib.hasPassword ? 'Present' : 'None') + '</div>' +
              warnHtml;
          }
          const nameEl = document.getElementById('add3xuiName');
          if (nameEl && !nameEl.value.trim()) {
            nameEl.value = ib.tag || tag;
          }
        } else {
          const msg = data.error || 'Failed to lookup inbound from 3x-ui';
          if (previewEl) previewEl.textContent = 'Lookup failed: ' + msg;
          if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
        }
      } catch (e) {
        if (previewEl) previewEl.textContent = 'Error: ' + e;
        if (errEl) { errEl.textContent = String(e); errEl.style.display = 'block'; }
      }
    }

    async function submitAdd3xuiProxy() {
      const tagEl = document.getElementById('add3xuiTag');
      const nameEl = document.getElementById('add3xuiName');
      const hostEl = document.getElementById('add3xuiHost');
      const activeEl = document.getElementById('add3xuiIsActive');
      const errEl = document.getElementById('add3xuiError');
      if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }

      const tag = tagEl ? tagEl.value.trim() : '';
      if (!tag) {
        if (errEl) { errEl.textContent = 'Tag is required'; errEl.style.display = 'block'; }
        return;
      }
      const payload = {
        type: '3x-ui',
        tag: tag,
        name: nameEl && nameEl.value.trim() ? nameEl.value.trim() : undefined,
        host: hostEl && hostEl.value.trim() ? hostEl.value.trim() : undefined,
        isActive: activeEl ? Boolean(activeEl.checked) : true
      };

      try {
        const res = await adminFetch('/api/proxies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.id) {
          closeAdd3xuiModal();
          toast(t('toastProxySaved', 'Proxy saved!'), 'success');
          await fetchProxies();
          fetchStatus();
        } else {
          if (errEl) { errEl.textContent = data.error || 'Failed to add proxy'; errEl.style.display = 'block'; }
        }
      } catch (e) {
        if (errEl) { errEl.textContent = String(e); errEl.style.display = 'block'; }
      }
    }

    function checkSocksAuthWarning() {
      const protoEl = document.getElementById('proxyFormProtocol');
      const userEl = document.getElementById('proxyFormUser');
      const warnEl = document.getElementById('proxyFormSocksWarning');
      if (!warnEl) return;
      const isSocks = protoEl && (protoEl.value === 'socks5' || protoEl.value === 'socks');
      const hasAuth = userEl && userEl.value.trim().length > 0;
      if (isSocks && hasAuth) {
        warnEl.style.display = 'block';
      } else {
        warnEl.style.display = 'none';
      }
    }

    function openAddManualModal() {
      const idEl = document.getElementById('proxyFormId');
      const titleEl = document.getElementById('proxyFormTitle');
      const tagEl = document.getElementById('proxyFormTag');
      const nameEl = document.getElementById('proxyFormName');
      const protoEl = document.getElementById('proxyFormProtocol');
      const hostEl = document.getElementById('proxyFormHost');
      const portEl = document.getElementById('proxyFormPort');
      const userEl = document.getElementById('proxyFormUser');
      const passEl = document.getElementById('proxyFormPass');
      const activeEl = document.getElementById('proxyFormIsActive');
      const errEl = document.getElementById('proxyFormError');

      if (idEl) idEl.value = '';
      if (titleEl) titleEl.textContent = t('titleAddManualProxy', 'Add Manual Proxy Node');
      if (tagEl) { tagEl.value = ''; tagEl.disabled = false; }
      if (nameEl) nameEl.value = '';
      if (protoEl) { protoEl.value = 'http'; protoEl.disabled = false; }
      if (hostEl) hostEl.value = '';
      if (portEl) { portEl.value = '10809'; portEl.disabled = false; }
      if (userEl) userEl.value = '';
      if (passEl) { passEl.value = ''; passEl.placeholder = '••••••••'; }
      if (activeEl) activeEl.checked = true;
      if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
      checkSocksAuthWarning();

      const modal = document.getElementById('modalProxyForm');
      if (modal) modal.style.display = 'flex';
      if (tagEl) tagEl.focus();
    }

    function openEditProxyModal(id) {
      const px = (currentProxiesList || []).find(function (p) { return p.id === id; });
      if (!px) return;

      const idEl = document.getElementById('proxyFormId');
      const titleEl = document.getElementById('proxyFormTitle');
      const tagEl = document.getElementById('proxyFormTag');
      const nameEl = document.getElementById('proxyFormName');
      const protoEl = document.getElementById('proxyFormProtocol');
      const hostEl = document.getElementById('proxyFormHost');
      const portEl = document.getElementById('proxyFormPort');
      const userEl = document.getElementById('proxyFormUser');
      const passEl = document.getElementById('proxyFormPass');
      const activeEl = document.getElementById('proxyFormIsActive');
      const errEl = document.getElementById('proxyFormError');

      if (idEl) idEl.value = px.id;
      if (titleEl) titleEl.textContent = t('titleEditProxy', 'Edit Proxy Node') + ': ' + px.tag;
      if (tagEl) { tagEl.value = px.tag; tagEl.disabled = (px.type === '3x-ui'); }
      if (nameEl) nameEl.value = px.name || '';
      if (protoEl) { protoEl.value = px.protocol || 'http'; protoEl.disabled = (px.type === '3x-ui'); }
      if (hostEl) hostEl.value = px.host || '';
      if (portEl) { portEl.value = String(px.port || ''); portEl.disabled = (px.type === '3x-ui'); }
      if (userEl) userEl.value = px.username || '';
      if (passEl) { passEl.value = ''; passEl.placeholder = '•••••••• (leave empty to keep unchanged)'; }
      if (activeEl) activeEl.checked = Boolean(px.isActive);
      if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
      checkSocksAuthWarning();

      const modal = document.getElementById('modalProxyForm');
      if (modal) modal.style.display = 'flex';
    }

    function closeProxyFormModal() {
      const modal = document.getElementById('modalProxyForm');
      if (modal) modal.style.display = 'none';
    }

    async function submitProxyForm() {
      const idEl = document.getElementById('proxyFormId');
      const tagEl = document.getElementById('proxyFormTag');
      const nameEl = document.getElementById('proxyFormName');
      const protoEl = document.getElementById('proxyFormProtocol');
      const hostEl = document.getElementById('proxyFormHost');
      const portEl = document.getElementById('proxyFormPort');
      const userEl = document.getElementById('proxyFormUser');
      const passEl = document.getElementById('proxyFormPass');
      const activeEl = document.getElementById('proxyFormIsActive');
      const errEl = document.getElementById('proxyFormError');
      if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }

      const id = idEl ? idEl.value.trim() : '';
      const tag = tagEl ? tagEl.value.trim() : '';
      const name = nameEl ? nameEl.value.trim() : '';
      const protocol = protoEl ? protoEl.value : 'socks5';
      const host = hostEl ? hostEl.value.trim() : '';
      const portRaw = portEl ? portEl.value.trim() : '';
      const username = userEl ? userEl.value.trim() : '';
      const password = passEl ? passEl.value : '';
      const isActive = activeEl ? Boolean(activeEl.checked) : false;

      if (!tag || !host || !portRaw) {
        if (errEl) { errEl.textContent = 'Tag, Host, and Port are required.'; errEl.style.display = 'block'; }
        return;
      }
      const portNum = parseInt(portRaw, 10);
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        if (errEl) { errEl.textContent = 'Port must be a number between 1 and 65535.'; errEl.style.display = 'block'; }
        return;
      }

      try {
        let res;
        if (id) {
          // Editing existing proxy
          const payload = {
            name: name || undefined,
            host: host,
            port: portNum,
            username: username !== '' ? username : undefined,
            isActive: isActive
          };
          const existing = (currentProxiesList || []).find(function (p) { return p.id === id; });
          if (existing && existing.type === 'manual') {
            payload.tag = tag;
            payload.protocol = protocol;
          }
          if (password) {
            payload.password = password;
          }
          res = await adminFetch('/api/proxies/' + encodeURIComponent(id), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
        } else {
          // Adding new manual proxy
          const payload = {
            type: 'manual',
            tag: tag,
            name: name || undefined,
            protocol: protocol,
            host: host,
            port: portNum,
            username: username || undefined,
            password: password || undefined,
            isActive: isActive
          };
          res = await adminFetch('/api/proxies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
        }

        const data = await res.json().catch(() => ({}));
        if (res.ok && (data.id || data.ok)) {
          closeProxyFormModal();
          toast(t('toastProxySaved', 'Proxy saved!'), 'success');
          await fetchProxies();
          fetchStatus();
        } else {
          if (errEl) { errEl.textContent = data.error || 'Failed to save proxy'; errEl.style.display = 'block'; }
        }
      } catch (e) {
        if (errEl) { errEl.textContent = String(e); errEl.style.display = 'block'; }
      }
    }

    function renderAuditLogs(logs) {
      const tbody = document.getElementById('auditTableBody');
      if (!logs.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No requests recorded</td></tr>';
        return;
      }
      tbody.innerHTML = logs.map(l => {
        let badge = 'badge-online';
        if (l.result === 'REJECTED_TOKEN' || l.result === 'STORE_ERROR') badge = 'badge-offline';
        else if (l.result === 'HEALTH_CHECK') badge = 'badge-action-proxy';
        
        return `<tr>
          <td style="font-family: var(--mono); font-size: 12px;">${new Date(l.timestamp).toLocaleTimeString()}</td>
          <td style="font-family: var(--mono);">${esc(l.ip)}</td>
          <td><code>${esc(l.endpoint)}</code></td>
          <td style="font-family: var(--mono);">${esc(l.status)}</td>
          <td><span class="badge ${badge}">${esc(l.result)}</span></td>
          <td style="color: var(--text-muted); font-size: 12px;">${esc(l.details || '-')}</td>
        </tr>`;
      }).join('');
    }

    async function testCredsEndpoint() {
      const token = document.getElementById('testTokenInput').value;
      const out = document.getElementById('testCredsOutput');
      out.textContent = 'Executing GET /creds...';
      try {
        const start = performance.now();
        const res = await fetch('/creds', {
          headers: token ? { 'X-Ext-Token': token } : {}
        });
        const elapsed = Math.round(performance.now() - start);
        const json = await res.json().catch(() => ({}));
        out.textContent = `HTTP ${res.status} ${res.statusText} (${elapsed}ms)

${JSON.stringify(json, null, 2)}`;
        fetchStatus();
      } catch (e) {
        out.textContent = 'Request failed: ' + e;
      }
    }

    async function testSyncEndpoint() {
      const out = document.getElementById('testSyncOutput');
      out.textContent = 'Executing POST /api/sync...';
      const token = document.getElementById('testTokenInput').value;
      try {
        const res = await fetch('/api/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'X-Ext-Token': token } : {})
          },
          body: JSON.stringify({
            instanceId: 'test-simulated-worker',
            version: '1.2.0',
            activeProxyMode: 'http'
          })
        });
        const json = await res.json();
        out.textContent = JSON.stringify(json, null, 2);
        // Cleanup: a diagnostics probe must not pollute the production fleet
        // registry (online counters, instances_meta.json) with phantom workers.
        try { await adminFetch('/api/instances/test-simulated-worker', { method: 'DELETE' }); } catch (e) {}
        fetchFleet();
        fetchStatus();
      } catch (e) {
        out.textContent = 'Sync test failed: ' + e;
      }
    }

    function refreshAll() {
      try {
        const savedLayout = localStorage.getItem('pec_server_layout') || 'modern';
        setServerLayout(savedLayout);
        const savedTheme = localStorage.getItem('pec_server_theme') || 'cyber';
        setServerTheme(savedTheme);
        const savedLang = localStorage.getItem('pec_lang') || 'ru';
        setLanguage(savedLang);
      } catch (e) {}

      fetchStatus();
      loadPresets();
      loadProfiles();
      loadBuilderConfig();
      loadExtensionFiles();
      fetchFleet();
      fetchExtensionInfo();
      fetchRotationConfig();
      fetchProxies();
      fetchProxyConfig();
    }

    (async function initAuth() {
      const loginBtn = document.getElementById('loginSubmitBtn');
      const loginInput = document.getElementById('loginTokenInput');
      const loginUser = document.getElementById('loginUsernameInput');
      if (loginBtn) loginBtn.addEventListener('click', handleLoginSubmit);
      if (loginInput) loginInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') handleLoginSubmit(); });
      if (loginUser) loginUser.addEventListener('keydown', function (e) { if (e.key === 'Enter') document.getElementById('loginTokenInput').focus(); });
      const logoutBtn = document.getElementById('btnLogout');
      if (logoutBtn) logoutBtn.addEventListener('click', logoutDashboard);

      // Account settings (change login/password)
      const openCreds = document.getElementById('btnOpenCredsModal');
      const credSubmit = document.getElementById('credSubmitBtn');
      const credCancel = document.getElementById('credCancelBtn');
      const credPass = document.getElementById('credCurrentPassword');
      if (openCreds) openCreds.addEventListener('click', openCredsModal);
      if (credSubmit) credSubmit.addEventListener('click', submitCredsChange);
      if (credCancel) credCancel.addEventListener('click', closeCredsModal);
      if (credPass) credPass.addEventListener('keydown', function (e) { if (e.key === 'Enter') submitCredsChange(); });

      // Proxy form interactive validation
      const protoInput = document.getElementById('proxyFormProtocol');
      const userInput = document.getElementById('proxyFormUser');
      if (protoInput) {
        protoInput.addEventListener('change', function() {
          const portEl = document.getElementById('proxyFormPort');
          if (portEl && (portEl.value === '10808' || portEl.value === '10809')) {
            portEl.value = protoInput.value === 'http' ? '10809' : '10808';
          }
          checkSocksAuthWarning();
        });
      }
      if (userInput) {
        userInput.addEventListener('input', checkSocksAuthWarning);
      }

      // First entry: ask the server whether a valid session already exists.
      try {
        const res = await fetch('/api/auth/session', { credentials: 'same-origin' });
        const data = await res.json();
        if (data && data.authenticated) {
          bootDashboard();
          return;
        }
      } catch (e) {}
      showLoginModal();
    })();
