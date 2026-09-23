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
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'pec-dashboard' },
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
        window.__pecTimers = setInterval(fetchFleet, 5000);
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
        lblHdrFleet: 'Connected Fleet:',
        lblHdrUser: 'Current User:',
        lblHdrProfile: 'Active PAC Profile:',
        lblHdrRot: 'Next Rotation:',
        btnRotateNow: 'Rotate Password Now',
        btnKillSwitchOff: 'Kill-Switch: OFF',
        btnKillSwitchOn: 'Kill-Switch: ON (Active)',
        tabBtnRouting: 'Routing & GeoBases',
        tabBtnBuilder: 'Extension Constructor Studio',
        tabBtnFleet: 'Fleet & Target Assignment',
        tabBtnGpo: 'GPO Deployment',
        tabBtnRotation: '3x-ui API & Scheduler',
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
        optScopeAll: 'All Fleet (Global Default)',
        optScopeGroup: 'Target AD / Fleet Group',
        optScopeInstances: 'Specific Selected Instances',
        lblTargetGroup: 'Target Group Name',
        phTargetGroup: 'e.g. SEC-Proxy-VPN-VIP or Dev-Team',
        profDescDefault: 'Routing policy applied to matching browser instances.',
        btnSaveProfile: 'Save Routing Profile',
        btnDeleteProfile: 'Delete Profile',
        btnPacPreview: 'View PAC Script',
        titleGeoPresets: 'Quick Add GeoBase & Domain Bundles',
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
        thRuleName: 'Rule Name',
        thPattern: 'Pattern / Preset',
        thAction: 'Action',
        thActions: 'Actions',
        txtNoRules: 'No rules defined for this profile.',

        // Tab 2: Extension Constructor Studio
        titleBuilder: 'Extension Constructor & Customizer',
        subBuilder: 'Configure functional archetypes, visual styles, security leak guards, and user capabilities:',
        lblArchetypePresets: '1. Functional Archetype Presets',
        chipSelfService: 'Self-Service Pro',
        chipKiosk: 'Kiosk / Restricted',
        chipStealth: 'Stealth Agent',
        lblThemePalettes: '2. Theme & Color Palettes',
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

        // Tab 3: Fleet
        titleFleetInstances: 'Connected Extension Instances',
        subFleetInstances: 'Assign specific profiles or groups to instances, or monitor live sync activity:',
        thInstId: 'Instance ID',
        thInstIp: 'IP Address',
        thInstVer: 'Version',
        thInstGroup: 'Fleet Group',
        thInstProfile: 'Assigned Profile',
        thInstSyncs: 'Syncs',
        thInstStatus: 'Status',
        thInstAssign: 'Assign',
        txtNoFleet: 'No active instances connected yet.',

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

        // Tab 5: 3x-ui Rotation
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
        lblHdrFleet: 'Подключенный флот:',
        lblHdrUser: 'Текущий пользователь:',
        lblHdrProfile: 'Активный PAC профиль:',
        lblHdrRot: 'Следующая ротация:',
        btnRotateNow: 'Ротировать пароль сейчас',
        btnKillSwitchOff: 'Kill-Switch: ВЫКЛ',
        btnKillSwitchOn: 'Kill-Switch: ВКЛ (Авария)',
        tabBtnRouting: 'Маршрутизация и Гео-базы',
        tabBtnBuilder: 'Конструктор расширения',
        tabBtnFleet: 'Флот и устройства',
        tabBtnGpo: 'GPO & Реестр Windows',
        tabBtnRotation: 'Ротация паролей 3x-ui',
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
        optScopeAll: 'Весь флот (Глобально по умолчанию)',
        optScopeGroup: 'Целевая группа AD / Флота',
        optScopeInstances: 'Отдельные выбранные устройства',
        lblTargetGroup: 'Имя целевой группы',
        phTargetGroup: 'напр. SEC-Proxy-VPN-VIP или Dev-Team',
        profDescDefault: 'Политика маршрутизации, применяемая к соответствующим браузерам.',
        btnSaveProfile: 'Сохранить профиль',
        btnDeleteProfile: 'Удалить профиль',
        btnPacPreview: 'Открыть PAC-скрипт',
        titleGeoPresets: 'Быстрое добавление гео-баз и наборов доменов',
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
        thRuleName: 'Имя правила',
        thPattern: 'Шаблон / Пресет',
        thAction: 'Действие',
        thActions: 'Действия',
        txtNoRules: 'Правила для этого профиля пока не заданы.',

        // Tab 2: Extension Constructor Studio
        titleBuilder: 'Конструктор и кастомизатор расширения',
        subBuilder: 'Настройка функциональных архетипов, визуального стиля, защиты от утечек и возможностей пользователя:',
        lblArchetypePresets: '1. Функциональные конфигурационные архетипы',
        chipSelfService: 'Self-Service Pro',
        chipKiosk: 'Киоск / Ограниченный',
        chipStealth: 'Скрытый агент (Stealth)',
        lblThemePalettes: '2. Темы и цветовые палитры',
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

        // Tab 3: Fleet
        titleFleetInstances: 'Подключенные экземпляры расширения',
        subFleetInstances: 'Назначайте профили или группы устройствам, отслеживайте статус синхронизации:',
        thInstId: 'ID экземпляра',
        thInstIp: 'IP адрес',
        thInstVer: 'Версия',
        thInstGroup: 'Группа флота',
        thInstProfile: 'Назначенный профиль',
        thInstSyncs: 'Синхронизаций',
        thInstStatus: 'Статус',
        thInstAssign: 'Назначить',
        txtNoFleet: 'Пока нет подключенных активных устройств.',

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

        // Tab 5: 3x-ui Rotation
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

    let currentLang = 'ru';

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
    }

    function switchTab(name) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      
      const pane = document.getElementById('tab-' + name);
      if (pane) pane.classList.add('active');
      
      const btn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.getAttribute('onclick').includes(name));
      if (btn) btn.classList.add('active');
    }

    // ----------------- Routing & Profiles -----------------
    async function loadPresets() {
      try {
        const res = await adminFetch('/api/routing/presets');
        const presets = await res.json();
        const container = document.getElementById('presetsContainer');
        
        const isRu = currentLang === 'ru';
        container.innerHTML = presets.map(p => `
          <div class="preset-card">
            <div>
              <h4>${esc(p.name)}</h4>
              <p>${esc(p.description)} (${p.domains.length} patterns)</p>
            </div>
            <div style="display: flex; gap: 6px; margin-top: 6px;">
              <button onclick="addPresetRule('${esc(p.id)}', '${esc(p.name)}', 'proxy')" class="btn-secondary" style="font-size: 11px; padding: 4px 8px;">+ ${isRu ? 'Прокси' : 'Proxy'}</button>
              <button onclick="addPresetRule('${esc(p.id)}', '${esc(p.name)}', 'direct')" class="btn-secondary" style="font-size: 11px; padding: 4px 8px;">+ ${isRu ? 'Напрямую' : 'Direct'}</button>
              <button onclick="addPresetRule('${esc(p.id)}', '${esc(p.name)}', 'block')" class="btn-danger" style="font-size: 11px; padding: 4px 8px;">+ ${isRu ? 'Блок' : 'Block'}</button>
            </div>
          </div>
        `).join('');
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
      document.getElementById('profDesc').textContent = p.description || 'Configured routing rules.';
      
      const groupRow = document.getElementById('groupTargetRow');
      groupRow.style.display = p.targetScope === 'group' ? 'block' : 'none';

      document.getElementById('btnPacPreview').href = '/proxy.pac?profileId=' + p.id;
      renderRules(p.rules || []);
    }

    document.getElementById('profTargetScope').addEventListener('change', (e) => {
      document.getElementById('groupTargetRow').style.display = e.target.value === 'group' ? 'block' : 'none';
    });

    function renderRules(rules) {
      const tbody = document.getElementById('rulesTableBody');
      const isRu = currentLang === 'ru';
      if (!rules || !rules.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">' + (isRu ? 'В этом профиле нет правил. Используйте кнопки выше для добавления пресетов или кастомных правил.' : 'No rules defined for this profile. Use buttons above to add presets or custom rules.') + '</td></tr>';
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
          <td><strong>${esc(r.name)}</strong></td>
          <td><code>${esc(r.pattern)}</code></td>
          <td><span class="badge ${badge}">${actionLabel}</span></td>
          <td>
            <button onclick="removeRule(${idx})" class="btn-danger" style="font-size: 11px; padding: 3px 8px;">${isRu ? 'Удалить' : 'Delete'}</button>
          </td>
        </tr>`;
      }).join('');
    }

    function toggleRuleEnabled(idx) {
      if (currentProfile && currentProfile.rules[idx]) {
        currentProfile.rules[idx].enabled = !currentProfile.rules[idx].enabled;
        renderRules(currentProfile.rules);
      }
    }

    function removeRule(idx) {
      if (currentProfile && currentProfile.rules[idx]) {
        currentProfile.rules.splice(idx, 1);
        renderRules(currentProfile.rules);
      }
    }

    function addPresetRule(presetId, presetName, action) {
      if (!currentProfile) return;
      currentProfile.rules.push({
        id: 'r_' + Math.random().toString(36).substring(2, 8),
        name: presetName,
        targetType: 'preset',
        pattern: presetId,
        action: action,
        enabled: true
      });
      renderRules(currentProfile.rules);
    }

    function addCustomRule() {
      if (!currentProfile) return;
      const name = document.getElementById('newRuleName').value.trim();
      const pattern = document.getElementById('newRulePattern').value.trim();
      const action = document.getElementById('newRuleAction').value;

      if (!name || !pattern) {
        toast('Please specify rule name and pattern', 'error');
        return;
      }

      currentProfile.rules.push({
        id: 'r_' + Math.random().toString(36).substring(2, 8),
        name: name,
        targetType: pattern.includes('/') ? 'cidr' : 'wildcard',
        pattern: pattern,
        action: action,
        enabled: true
      });

      document.getElementById('newRuleName').value = '';
      document.getElementById('newRulePattern').value = '';
      renderRules(currentProfile.rules);
    }

    async function saveCurrentProfile() {
      if (!currentProfile) return;
      currentProfile.name = document.getElementById('profName').value.trim();
      currentProfile.defaultPolicy = document.getElementById('profDefaultPolicy').value;
      currentProfile.targetScope = document.getElementById('profTargetScope').value;
      currentProfile.targetGroup = document.getElementById('profTargetGroup').value.trim();

      try {
        const res = await adminFetch('/api/routing/profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(currentProfile)
        });
        if (res.ok) {
          toast('Routing profile saved! Deployed to matching fleet instances.', 'success');
          loadProfiles();
        } else {
          const data = await res.json().catch(() => ({}));
          toast('Failed to save profile: ' + (data.error || ('HTTP ' + res.status)), 'error');
        }
      } catch (e) {
        toast('Error saving profile: ' + e, 'error');
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

    async function loadBuilderConfig() {
      try {
        const res = await adminFetch('/api/builder/config');
        const cfg = await res.json();
        
        document.getElementById('bldName').value = cfg.name || 'Corp Proxy Auth & Sync';
        document.getElementById('bldShortName').value = cfg.shortName || 'CorpProxy';
        document.getElementById('bldVersion').value = cfg.version || '1.2.0';
        document.getElementById('bldUiMode').value = cfg.uiMode || 'popup';
        document.getElementById('bldIconType').value = cfg.iconType || 'shield';
        document.getElementById('bldThemeColor').value = cfg.themeColor || '#0284c7';
        document.getElementById('bldEmoji').value = cfg.iconEmoji || '🛡️';
        document.getElementById('bldDesc').value = cfg.description || 'Enterprise Chrome extension for automatic proxy synchronization';
        document.getElementById('bldSyncInterval').value = cfg.syncIntervalMinutes || 15;
        document.getElementById('bldWebRtc').checked = cfg.webRtcProtection !== false;
        document.getElementById('bldDnsGuard').checked = cfg.dnsLeakProtection !== false;
        document.getElementById('bldBadge').checked = cfg.badgeIndicator !== false;
        document.getElementById('bldAutoProxy').checked = cfg.autoConfigureProxy !== false;
        document.getElementById('bldAllowBypass').checked = cfg.allowUserBypass !== false;
        document.getElementById('bldIpGeo').checked = cfg.showIpGeoCheck !== false;
        document.getElementById('bldBypassTimeout').value = cfg.bypassTimeoutMinutes || 15;
        document.getElementById('bldSupportUrl').value = cfg.supportUrl || 'mailto:it-support@corp.local';

        if (cfg.presetTemplate) {
          highlightTemplateChip(cfg.presetTemplate);
        }
        if (cfg.presetStyle) {
          highlightStyleChip(cfg.presetStyle);
        }

        updateLivePreview();
      } catch (e) {
        console.error(e);
      }
    }

    function highlightTemplateChip(preset) {
      activeTemplatePreset = preset;
      ['chip-self-service', 'chip-kiosk', 'chip-stealth'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
      });
      const badge = document.getElementById('bldPresetBadge');
      const desc = document.getElementById('presetDescText');

      if (preset === 'self-service-pro') {
        const el = document.getElementById('chip-self-service');
        if (el) el.classList.add('active');
        if (badge) badge.textContent = 'Self-Service Pro';
        if (desc) desc.textContent = 'Self-Service Pro: Interactive popup with full connection metrics, routing inspection, manual force sync, and user temporary bypass.';
      } else if (preset === 'kiosk-restricted') {
        const el = document.getElementById('chip-kiosk');
        if (el) el.classList.add('active');
        if (badge) badge.textContent = 'Kiosk / Restricted';
        if (desc) desc.textContent = 'Kiosk / Restricted: Read-only popup view without bypass controls or sensitive host exposure. Locked for managed kiosks and students.';
      } else if (preset === 'enterprise-invisible') {
        const el = document.getElementById('chip-stealth');
        if (el) el.classList.add('active');
        if (badge) badge.textContent = 'Stealth Agent';
        if (desc) desc.textContent = 'Stealth Agent: Runs silently in the background without any popup UI, enforcing corporate PAC policies quietly.';
      }
    }

    function highlightStyleChip(style) {
      activeStylePreset = style;
      ['chip-style-cyber-blue', 'chip-style-dark-obsidian', 'chip-style-emerald-sentinel', 'chip-style-sunset-amber', 'chip-style-minimal-light'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
      });
      const target = document.getElementById('chip-style-' + style);
      if (target) target.classList.add('active');
    }

    async function applyTemplatePreset(preset) {
      highlightTemplateChip(preset);

      if (preset === 'self-service-pro') {
        document.getElementById('bldUiMode').value = 'popup';
        document.getElementById('bldAllowBypass').checked = true;
        document.getElementById('bldIpGeo').checked = true;
        document.getElementById('bldBadge').checked = true;
      } else if (preset === 'kiosk-restricted') {
        document.getElementById('bldUiMode').value = 'popup';
        document.getElementById('bldAllowBypass').checked = false;
        document.getElementById('bldIpGeo').checked = false;
        document.getElementById('bldBadge').checked = true;
      } else if (preset === 'enterprise-invisible') {
        document.getElementById('bldUiMode').value = 'stealth';
        document.getElementById('bldAllowBypass').checked = false;
        document.getElementById('bldBadge').checked = true;
      }

      await saveBuilderConfigOnly(false);
      await regenerateTemplatesFromConfig();
    }

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

      if (iconGlyphEl) iconGlyphEl.textContent = iconEmoji;

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
              'if (!msg) return;' +
              'if (msg.action === "GET_STATUS") {' +
                'if (cb) cb(window.__simState || ' + JSON.stringify(liveSimState) + ');' +
              '} else if (msg.action === "FORCE_SYNC") {' +
                'setTimeout(function() {' +
                  'if (cb) cb({ ok: true, syncedAt: new Date().toLocaleTimeString() });' +
                '}, 400);' +
              '} else if (msg.action === "TOGGLE_BYPASS") {' +
                'window.parent.postMessage({ type: "SIM_TOGGLE_BYPASS" }, "*");' +
                'if (cb) cb({ ok: true });' +
              '}' +
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
      const popupScriptRegex = new RegExp('<' + 'script\s+src="popup\.js">' + '<' + '/script>', 'i');
      if (doc.includes('popup.js')) {
        doc = doc.replace(popupScriptRegex, mockScript + scriptOpen + jsContent + scriptClose);
      } else {
        doc = mockScript + doc + scriptOpen + jsContent + scriptClose;
      }

      const iframe = document.getElementById('previewFrame');
      if (iframe) {
        iframe.onload = function() {
          pushSimStateToIframe();
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
        uiMode: document.getElementById('bldUiMode').value,
        iconType: document.getElementById('bldIconType').value,
        themeColor: document.getElementById('bldThemeColor').value.trim(),
        iconEmoji: document.getElementById('bldEmoji').value.trim(),
        description: document.getElementById('bldDesc').value.trim(),
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

    // ----------------- Fleet & Instances -----------------
    async function fetchFleet() {
      try {
        const res = await adminFetch('/api/instances');
        const data = await res.json();
        const isRu = currentLang === 'ru';
        document.getElementById('badgeFleetOnline').textContent = data.online + (isRu ? ' онлайн' : ' online');

        const tbody = document.getElementById('fleetTableBody');
        if (!data.instances || !data.instances.length) {
          tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">' + (isRu ? 'Пока нет подключенных устройств. Расширения синхронизируются через <code>/api/sync</code> каждые 5 мин.' : 'No instances connected yet. Extensions sync via <code>/api/sync</code> every 5 min.') + '</td></tr>';
          return;
        }

        const profileOptions = allProfiles.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');

        tbody.innerHTML = data.instances.map(inst => {
          let badge = 'badge-online';
          if (inst.status === 'STALE') badge = 'badge-stale';
          else if (inst.status === 'OFFLINE') badge = 'badge-offline';

          return `<tr>
            <td><code>${esc(inst.instanceId)}</code></td>
            <td style="font-family: var(--mono);">${esc(inst.ip)}</td>
            <td>v${esc(inst.version)}</td>
            <td><code>${esc(inst.group || (isRu ? 'Основной флот' : 'Default Fleet'))}</code></td>
            <td><span class="badge badge-action-proxy">${esc(inst.appliedProfileName || (isRu ? 'По умолчанию' : 'Default'))}</span></td>
            <td>${esc(inst.syncCount)}</td>
            <td><span class="badge ${badge}">${esc(inst.status)}</span></td>
            <td>
              <select onchange="assignProfileToInstance('${esc(inst.instanceId)}', this.value)" style="margin-bottom: 0; font-size: 11px; padding: 3px 6px;">
                <option value="">${isRu ? 'По умолчанию (Авто)' : 'Default (Auto)'}</option>
                ${profileOptions}
              </select>
            </td>
          </tr>`;
        }).join('');
      } catch (e) {
        console.error(e);
      }
    }

    async function assignProfileToInstance(instanceId, profileId) {
      try {
        await adminFetch('/api/instances/assign-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instanceId, profileId })
        });
        fetchFleet();
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
        
        document.getElementById('rotStatusText').textContent = cfg.lastStatus || 'Idle';
        document.getElementById('rotNextRun').textContent = cfg.nextRotationAt ? new Date(cfg.nextRotationAt).toLocaleString() : 'Disabled';
        document.getElementById('rotLastRun').textContent = cfg.lastRotatedAt ? new Date(cfg.lastRotatedAt).toLocaleString() : 'None';

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
      const payload = {
        panelUrl: document.getElementById('rotPanelUrl').value.trim(),
        adminUser: document.getElementById('rotAdminUser').value.trim(),
        inboundRemark: document.getElementById('rotRemark').value.trim(),
        intervalMinutes: intervalNum,
        enabled: document.getElementById('rotEnabled').value === 'true',
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
