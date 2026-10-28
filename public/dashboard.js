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

    // ----------------- Admin Authentication & Onboarding -----------------
    // Server-side sessions: the browser never holds the admin token. The
    // operator completes initial setup with ADMIN_TOKEN -> sets login/password,
    // and logs in with HttpOnly session cookies.
    let pecTimerInstances = null;
    let pecTimerStatus = null;

    function startDashboardTimers() {
      stopDashboardTimers();
      pecTimerInstances = setInterval(loadInstances, 5000);
      pecTimerStatus = setInterval(fetchStatus, 10000);
      window.__pecTimers = pecTimerInstances;
    }

    function stopDashboardTimers() {
      if (pecTimerInstances) {
        clearInterval(pecTimerInstances);
        pecTimerInstances = null;
      }
      if (pecTimerStatus) {
        clearInterval(pecTimerStatus);
        pecTimerStatus = null;
      }
      if (window.__pecTimers) {
        clearInterval(window.__pecTimers);
        window.__pecTimers = null;
      }
    }

    function showAuthStep(step) {
      const screen = document.getElementById('authScreen');
      if (screen) screen.style.display = 'flex';
      const stepToken = document.getElementById('authStepToken');
      const stepCreds = document.getElementById('authStepCredentials');
      const stepLogin = document.getElementById('authStepLogin');
      if (stepToken) stepToken.style.display = 'none';
      if (stepCreds) stepCreds.style.display = 'none';
      if (stepLogin) stepLogin.style.display = 'none';

      // Check if user is already interacting with an input inside authScreen
      const active = document.activeElement;
      const alreadyFocused = active && (screen && screen.contains(active));

      if (step === 'token') {
        if (stepToken) stepToken.style.display = 'block';
        const inp = document.getElementById('authTokenInput');
        if (inp && !alreadyFocused) { inp.value = ''; inp.focus(); }
      } else if (step === 'credentials') {
        if (stepCreds) stepCreds.style.display = 'block';
        const inp = document.getElementById('authNewUsername');
        if (inp && !alreadyFocused) { inp.value = 'admin'; inp.focus(); }
      } else {
        if (stepLogin) stepLogin.style.display = 'block';
        const userInp = document.getElementById('loginUsernameInput');
        const passInp = document.getElementById('loginTokenInput');
        if (!alreadyFocused) {
          if (userInp && !userInp.value) {
            userInp.focus();
          } else if (passInp) {
            passInp.focus();
          } else if (userInp) {
            userInp.focus();
          }
        }
      }
    }
    function hideAuthScreen() {
      const screen = document.getElementById('authScreen');
      if (screen) screen.style.display = 'none';
      const modal = document.getElementById('loginModal');
      if (modal) modal.style.display = 'none';
    }
    function showLoginModal() {
      showAuthStep('login');
    }
    function hideLoginModal() {
      hideAuthScreen();
    }
    function setTokenError(msg) {
      const el = document.getElementById('authTokenError');
      if (el) {
        el.textContent = msg || '';
        el.style.display = msg ? 'block' : 'none';
      }
    }
    function setAuthCredsError(msg) {
      const el = document.getElementById('authCredsError');
      if (el) {
        el.textContent = msg || '';
        el.style.display = msg ? 'block' : 'none';
      }
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
        stopDashboardTimers();
        const screen = document.getElementById('authScreen');
        const isAuthVisible = screen && screen.style.display !== 'none';
        if (!isAuthVisible) {
          loginPendingRetry = { url: url, opts: opts };
          showAuthStep('login');
        }
      }
      return res;
    }
    async function handleAuthVerifyToken() {
      const input = document.getElementById('authTokenInput');
      const token = ((input && input.value) || '').trim();
      if (!token) {
        if (input) input.focus();
        setTokenError('Введите Admin Token');
        return;
      }
      const btn = document.getElementById('btnAuthVerifyToken');
      if (btn) btn.disabled = true;
      setTokenError('');
      try {
        const res = await fetch('/api/auth/setup-verify', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          showAuthStep('credentials');
        } else {
          setTokenError(data.error || 'Неверный токен администратора');
        }
      } catch (e) {
        setTokenError('Сетевая ошибка: ' + e);
      } finally {
        if (btn) btn.disabled = false;
      }
    }
    async function handleAuthSaveCredentials() {
      const userInput = document.getElementById('authNewUsername');
      const passInput = document.getElementById('authNewPassword');
      const passConfInput = document.getElementById('authNewPasswordConfirm');
      const u = ((userInput && userInput.value) || '').trim();
      const p = ((passInput && passInput.value) || '');
      const pc = ((passConfInput && passConfInput.value) || '');

      setAuthCredsError('');
      if (!u || u.length < 3) {
        setAuthCredsError('Логин должен содержать от 3 до 64 символов');
        if (userInput) userInput.focus();
        return;
      }
      if (!p || p.length < 8) {
        setAuthCredsError('Пароль должен содержать минимум 8 символов');
        if (passInput) passInput.focus();
        return;
      }
      if (p !== pc) {
        setAuthCredsError('Пароли не совпадают');
        if (passConfInput) passConfInput.focus();
        return;
      }

      const btn = document.getElementById('btnAuthSaveCredentials');
      if (btn) btn.disabled = true;
      try {
        const res = await fetch('/api/auth/setup-credentials', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'pec-dashboard' },
          body: JSON.stringify({ username: u, password: p })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          showAuthStep('login');
          const banner = document.getElementById('authSetupSuccessBanner');
          if (banner) banner.style.display = 'block';
          const loginUser = document.getElementById('loginUsernameInput');
          if (loginUser) loginUser.value = u;
          const loginPass = document.getElementById('loginTokenInput');
          if (loginPass) { loginPass.value = ''; loginPass.focus(); }
        } else {
          setAuthCredsError(data.error || 'Ошибка сохранения учётных данных');
        }
      } catch (e) {
        setAuthCredsError('Сетевая ошибка: ' + e);
      } finally {
        if (btn) btn.disabled = false;
      }
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
          hideAuthScreen();
          if (loginPendingRetry) {
            const r = loginPendingRetry;
            loginPendingRetry = null;
            adminFetch(r.url, r.opts).catch(function (e) { console.warn('Retry after login failed:', e); });
          }
          bootDashboard();
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
      stopDashboardTimers();
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'X-Requested-With': 'pec-dashboard' }
        });
      } catch (e) {}
      showAuthStep('login');
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
      startDashboardTimers();
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

    // ----------------- Releases Version Display (Cleaned up per D-08) -----------------
    function renderGitHubReleases(data) {
      const container = document.getElementById('ghReleaseContent');
      if (!container || !data) return;

      const isRu = currentLang === 'ru';
      const isUpdate = Boolean(data.updateAvailable || data.hasUpdate);
      const latestVer = data.latestRelease ? (data.latestRelease.cleanVersion || data.latestRelease.version || data.latestRelease.tag_name || '') : '';
      if (data.latestRelease && !data.latestRelease.version) {
        data.latestRelease.version = latestVer;
      }

      let html = `<div style="display: flex; gap: 16px; align-items: center; margin-bottom: 8px; flex-wrap: wrap;">
        <div>
          <span style="color: var(--text-muted); font-size: 11px;">${isRu ? 'Установленная версия:' : 'Installed version:'}</span>
          <strong style="color: var(--primary); font-family: var(--mono); font-size: 13px; margin-left: 6px;">v${esc(data.currentVersion || (document.getElementById('versionReleaseBadge') && document.getElementById('versionReleaseBadge').getAttribute('data-server-version')) || '1.0.0')}</strong>
        </div>`;

      if (data.latestRelease) {
        html += `<div>
          <span style="color: var(--text-muted); font-size: 11px;">${isRu ? 'Последний релиз:' : 'Latest release:'}</span>
          <strong style="color: ${isUpdate ? 'var(--warning)' : 'var(--success)'}; font-family: var(--mono); font-size: 13px; margin-left: 6px;">${esc(data.latestRelease.name || ('v' + data.latestRelease.version))}</strong>
        </div>`;
      }

      if (isUpdate) {
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
        tabBtnAppStudio: 'App Studio',
        tabBtnFleet: 'Fleet',
        tabBtnInstances: 'Fleet',
        tabBtnGpo: 'GPO Deployment',
        tabBtnRotation: 'Proxy Settings',
        tabBtnProxySettings: 'Proxy Settings',
        tabBtnLogs: 'Audit & Tester',
        activeFleetSuffix: ' active',

        // Modal
        modalSettingsTitle: 'Server Customization & GitHub Releases',
        lblSettingsLayout: '1. Dashboard Layout Style',
        subSettingsLayout: 'Choose the structural layout archetype for all dashboard tabs:',
        optLayoutConsole: '<img src="/icons/devices.png" class="icon-inline" alt="console"> Compact Console',
        descLayoutConsole: 'Ultra-minimalist compact layout with flat borders, 4px corners, and maximum information density across all tabs.',
        optLayoutTerminal: '<img src="/icons/bolt.png" class="icon-inline" alt="terminal"> Cyber Terminal',
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
        lblTargetInstances: 'Target Instances',
        phTargetGroup: 'e.g. SEC-Proxy-VPN-VIP or Dev-Team',
        lblFailClosed: 'Fail-Closed: Prevent direct fallback (DIRECT) if proxy drops (avoids IP leak)',
        profDescDefault: 'Routing policy applied to matching browser instances.',
        lblUnsavedChanges: 'Unsaved Changes',
        btnSaveProfile: 'Save Routing Profile',
        btnDeleteProfile: 'Delete Profile',
        btnPacPreview: 'View PAC Script',
        titleGeoPresets: 'Quick Add GeoBase & Domain Bundles',
        btnImportPresets: '<img src="/icons/upload.png" class="icon-inline" alt="import"> + Import Presets (.dat / .txt)',
        titleImportPresets: 'Import GeoData & Presets',
        subImportPresets: 'Import geosite.dat, geoip.dat or plaintext domain lists',
        titleEditRule: 'Edit Routing Rule',
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
        optSync1: 'Every 1 minute (test)',
        optSync2: 'Every 2 minutes',
        optSync5: 'Every 5 minutes',
        optSync10: 'Every 10 minutes',
        optSync15: 'Every 15 minutes',
        optSync30: 'Every 30 minutes',
        optSync60: 'Every 1 hour',
        optSync120: 'Every 2 hours',
        optSync360: 'Every 6 hours',
        lblExtDesc: 'Enterprise Description',
        phExtDesc: 'Enterprise Chrome extension for automatic proxy synchronization',
        lblServerUrl: 'Sync Server Base URL (API Base URL)',
        phServerUrl: 'https://pec.example.corp',
        lblUpdateUrl: 'Update Manifest XML URL (update_url)',
        phUpdateUrl: 'https://pec.example.corp/updates/updates.xml',
        hintUpdateUrl: 'Baked into manifest.json (update_url) and GPO. If empty, automatically derived as [Server URL]/updates/updates.xml',
        lblBuilderDefaultProxy: 'Default Proxy for Extension Build',
        lblSecPolicies: 'Security & Leak Prevention Policies',
        lblWebrtcShield: 'WebRTC IP Shield (no UDP leak)',
        lblDnsGuard: 'DNS Leak Guard',
        lblBadgeIcon: 'Live Status Badge on Icon',
        lblAutoProxy: 'Dynamic Proxy Enforcement',
        lblAllowBypass: 'Allow Temporary User Bypass',
        lblIpGeo: 'Show Egress IP / Geo Verifier',
        lblAllowUserProxySwitch: 'Allow User Proxy Switching in Extension',
        lblPauseTimeout: 'Pause Auto-Timeout',
        lblBypassTimeout: 'Pause Auto-Timeout',
        lblSupportUrl: 'IT Helpdesk Contact',
        phSupportUrl: 'mailto:it-support@corp.local',
        btnBuildCrx: 'Build CRX',
        btnSaveConfig: 'Save Config',
        btnResetTemplate: 'Reset Template',
        btnResetTemplateTitle: 'Reset all source files to clean template from current config',
        btnGithubTitle: 'GitHub Repository: vlv-code/PEC',
        titleLivePreview: 'Live Extension Interactive Preview',
        badgeSynced: 'Synced',
        subLivePreview: 'Full runtime sandbox mirroring real Chrome popup, icons, badge states, and events in real time:',
        titleStealthNotice: 'Stealth Mode Enabled',
        subStealthNotice: 'The extension runs silently as an enterprise background service worker without a popup window. Traffic is routed dynamically via PAC policy.',
        badgeStealthActive: 'Icon Badge: Active',
        lblSimState: 'Simulated Extension State',
        btnSimOnline: '<img src="/icons/status-green.png" class="icon-inline-sm" alt="online"> Online Proxy',
        btnSimBypass: '<img src="/icons/status-yellow.png" class="icon-inline-sm" alt="pause"> Paused',
        btnSimOffline: '<img src="/icons/status-red.png" class="icon-inline-sm" alt="offline"> Offline Fallback',
        btnSimError: '<img src="/icons/sync.png" class="icon-inline-sm" alt="auth"> Re-Authenticating',
        titleCodeInternals: 'Extension Source Code Internals',
        lblActiveFile: 'Active File:',
        subCodeInternals: 'Live Code Editor: Edits in popup.html or popup.js update the Interactive Preview instantly.',
        lblCodeReady: 'Ready',
        btnSaveCode: 'Save File Edits & Apply',
        btnDownloadCrx: 'Download .CRX',
        btnDownloadZip: 'Download .ZIP',

        // Tab: App Studio (PEC-App)
        titleAppStudio: 'PEC-App Studio',
        subAppStudio: 'Configure native transparent desktop proxy client (Windows WinDivert / Linux NFQUEUE):',
        lblAppName: 'Application Name',
        lblAppShortName: 'Short Name',
        lblAppVersion: 'Version',
        lblAppIconType: 'Application Icon',
        lblAppDescription: 'Description',
        titleAppThemes: 'Themes & Visual Style',
        lblAppPresetStyle: 'Theme Presets:',
        lblAppThemeMode: 'Theme Mode:',
        lblAppThemeColor: 'Accent Color',
        lblAppThemeBg: 'Window Background',
        lblAppThemeCard: 'Card Background',
        titleAppRoutingRules: 'Process Routing Rules',
        lblQuickRules: 'Quick Presets:',
        titleAppBehavior: 'System Services & Startup',
        lblAppAutoStart: 'Auto-start with Windows',
        lblAppStartMinimized: 'Start Minimized to System Tray',
        lblAppInstallService: 'Install as Windows Service',
        lblAppTrafficLogging: 'Connection Traffic Logging',
        titleAppLivePreview: 'Interactive Desktop Live Preview',
        subAppLivePreview: 'Reactive simulator of native PEC-App desktop client with real-time theme styling:',

        // Tab 3: Fleet
        titleFleetInstances: 'Corporate Network Fleet',
        subFleetInstances: 'Centralized management of extension instances, profiles, and proxy nodes',
        titleRegisteredDevices: 'Registered Fleet',
        thInstId: 'Instance ID',
        thInstUser: 'User / Session',
        thInstIp: 'IP Address',
        thInstVer: 'Version',
        thInstGroup: 'Fleet Group',
        thInstProfile: 'Assigned Profile',
        thInstSyncs: 'Syncs',
        thInstStatus: 'Status',
        thInstAssign: 'Assign Profile',
        thInstProxy: 'Proxy Server',
        thInstActions: 'Actions',
        txtNoFleet: 'No registered fleet connected yet.',
        titleDesktopClients: 'PEC-App Desktop Clients',
        subDesktopClients: 'Centralized management of Windows clients, version monitoring, and proxy node assignment',
        txtNoDesktopClients: 'No desktop clients connected yet. Launch PEC-App.exe on a workstation.',
        tabBtnReleases: '<img src="/icons/package.png" class="icon-inline" alt="releases"> Releases & Rollback',
        titleReleasesBanner: 'Release Management & Rollback Engine',
        descReleasesBanner: 'Versioned archive of extensions (.crx) and desktop apps (.zip). One-click rollback for safe operations.',
        btnRefreshReleases: 'Refresh Releases',
        titleReleasesTable: 'Releases History',
        thRelType: 'Type',
        thRelVer: 'Version',
        thRelDate: 'Build Date',
        thRelSha: 'SHA-256',
        thRelStatus: 'Status',
        thRelActions: 'Actions',

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
        titleGpoPackBanner: 'Comprehensive Active Directory GPO Deployment Pack',
        descGpoPackBanner: 'Includes ready-to-import .REG policy files (HKCU and HKLM) for all 4 browsers (Chrome, Edge, Yandex, Opera), PowerShell deploy/verify scripts, JSON policies, and administrator manual.',
        btnDownloadGpoPack: 'Download GPO Deployment Pack (.zip)',
        titleGpoScripts: 'PowerShell Automation Scripts',
        descGpoScripts: 'Automated scripts for GPO Logon/Startup and workstation diagnostic verification.',
        btnDownloadDeployPs: 'deploy-pec-gpo.ps1',
        btnDownloadVerifyPs: 'verify-pec-gpo.ps1',
        lblGpoActivePath: 'Registry key:',
        btnCopy: 'Copy',

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
        warnChromiumSocks5Auth: '<img src="/icons/warning.png" class="icon-inline" alt="warn"> Chromium (Chrome, Edge, Brave, Yandex) does not support SOCKS5 authentication. If credentials are set, Chrome will reject the connection or bypass the proxy. Use HTTP protocol for authenticated corporate proxies or use SOCKS5 without username/password (e.g. IP whitelist).',
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
        btnScenDocker: '<img src="/icons/docker.png" class="icon-inline" alt="docker"> Docker & Compose',
        btnScenSystemd: '<img src="/icons/linux.png" class="icon-inline" alt="linux"> Linux Systemd Service',
        btnScenNginx: '<img src="/icons/shield.png" class="icon-inline" alt="nginx"> Nginx + SSL (HTTPS)',
        btnScenStandalone: '<img src="/icons/bolt.png" class="icon-inline" alt="standalone"> Standalone / PM2',
        btnScenGpo: '<img src="/icons/building.png" class="icon-inline" alt="gpo"> Active Directory / GPO',
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
        tabBtnAppStudio: 'Конструктор приложения',
        tabBtnFleet: 'Флот',
        tabBtnInstances: 'Флот',
        tabBtnGpo: 'GPO & Реестр Windows',
        tabBtnRotation: 'Настройки прокси',
        tabBtnProxySettings: 'Настройки прокси',
        tabBtnLogs: 'Аудит и Тестер API',
        activeFleetSuffix: ' активных',

        // Modal
        modalSettingsTitle: 'Кастомизация сервера и Релизы',
        lblSettingsLayout: '1. Стиль интерфейса сервера (Layout)',
        subSettingsLayout: 'Выберите структурный шаблон для всех вкладок панели:',
        optLayoutConsole: '<img src="/icons/devices.png" class="icon-inline" alt="console"> Compact Console',
        descLayoutConsole: 'Ультра-минималистичный компактный интерфейс с плоскими границами, 4px скруглениями и максимальной плотностью информации во всех вкладках.',
        optLayoutTerminal: '<img src="/icons/bolt.png" class="icon-inline" alt="terminal"> Cyber Terminal',
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
        lblTargetInstances: 'Выбранные устройства',
        phTargetGroup: 'напр. SEC-Proxy-VPN-VIP или Dev-Team',
        lblFailClosed: 'Fail-Closed: запретить прямой доступ (DIRECT) при падении прокси (защита от утечки IP)',
        profDescDefault: 'Политика маршрутизации, применяемая к соответствующим браузерам.',
        lblUnsavedChanges: 'Несохраненные изменения',
        btnSaveProfile: 'Сохранить профиль',
        btnDeleteProfile: 'Удалить профиль',
        btnPacPreview: 'Открыть PAC-скрипт',
        titleGeoPresets: 'Быстрое добавление гео-баз и наборов доменов',
        btnImportPresets: '<img src="/icons/upload.png" class="icon-inline" alt="import"> + Импорт пресетов (.dat / .txt)',
        titleImportPresets: 'Импорт гео-данных и пресетов',
        subImportPresets: 'Импорт geosite.dat, geoip.dat или текстовых списков доменов',
        titleEditRule: 'Редактировать правило маршрутизации',
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
        optSync1: 'Каждую 1 минуту (тест)',
        optSync2: 'Каждые 2 минуты',
        optSync5: 'Каждые 5 минут',
        optSync10: 'Каждые 10 минут',
        optSync15: 'Каждые 15 минут',
        optSync30: 'Каждые 30 минут',
        optSync60: 'Каждый 1 час',
        optSync120: 'Каждые 2 часа',
        optSync360: 'Каждые 6 часов',
        lblExtDesc: 'Корпоративное описание',
        phExtDesc: 'Корпоративное расширение Chrome для автоматической синхронизации прокси',
        lblServerUrl: 'Сервер синхронизации (API Base URL)',
        phServerUrl: 'https://pec.example.corp',
        lblUpdateUrl: 'URL XML-манифеста обновлений (update_url)',
        phUpdateUrl: 'https://pec.example.corp/updates/updates.xml',
        hintUpdateUrl: 'Зашивается в manifest.json (update_url) и GPO. Если пусто, формируется автоматически как [Server URL]/updates/updates.xml',
        lblBuilderDefaultProxy: 'Прокси по умолчанию для сборки',
        lblSecPolicies: 'Политики безопасности и защита от утечек',
        lblWebrtcShield: 'Защита WebRTC (предотвращение утечки IP)',
        lblDnsGuard: 'Защита DNS (резолв через прокси)',
        lblBadgeIcon: 'Индикатор состояния на иконке (бейдж)',
        lblAutoProxy: 'Принудительное применение PAC при старте',
        lblAllowBypass: 'Разрешить паузу',
        lblIpGeo: 'Отображать выходной IP и проверку гео',
        lblAllowUserProxySwitch: 'Разрешить пользователю переключать прокси в расширении',
        lblPauseTimeout: 'Таймаут паузы',
        lblBypassTimeout: 'Таймаут паузы',
        lblSupportUrl: 'Контакт службы поддержки',
        phSupportUrl: 'mailto:it-support@corp.local',
        btnBuildCrx: 'Собрать CRX',
        btnSaveConfig: 'Сохранить конфиг',
        btnResetTemplate: 'Сбросить шаблон',
        btnResetTemplateTitle: 'Сбросить все исходные файлы к чистому шаблону из настроек',
        btnGithubTitle: 'Репозиторий GitHub: vlv-code/PEC',
        titleLivePreview: 'Интерактивный предпросмотр расширения',
        badgeSynced: 'Синхронизировано',
        subLivePreview: 'Живая песочница, отображающая popup Chrome, иконки, бейджи и события в реальном времени:',
        titleStealthNotice: 'Включен скрытый режим (Stealth Mode)',
        subStealthNotice: 'Расширение работает в фоновом режиме без всплывающего окна. Трафик маршрутизируется динамически через PAC-скрипт.',
        badgeStealthActive: 'Бейдж иконки: Активен',
        lblSimState: 'Состояние симуляции расширения',
        btnSimOnline: '<img src="/icons/status-green.png" class="icon-inline-sm" alt="online"> Онлайн прокси',
        btnSimBypass: '<img src="/icons/status-yellow.png" class="icon-inline-sm" alt="pause"> Пауза 15м',
        btnSimOffline: '<img src="/icons/status-red.png" class="icon-inline-sm" alt="offline"> Офлайн',
        btnSimError: '<img src="/icons/sync.png" class="icon-inline-sm" alt="auth"> 407 Ре-аутентификация',
        titleCodeInternals: 'Исходный код и внутренние файлы расширения',
        lblActiveFile: 'Активный файл:',
        subCodeInternals: 'Редактор кода: изменения в popup.html или popup.js мгновенно обновляют интерактивный предпросмотр.',
        lblCodeReady: 'Готов',
        btnSaveCode: 'Сохранить изменения и применить',
        btnDownloadCrx: 'Скачать .CRX',
        btnDownloadZip: 'Скачать .ZIP',

        // Tab: App Studio (PEC-App)
        titleAppStudio: 'Конструктор приложения PEC-App',
        subAppStudio: 'Настройка нативного прозрачного десктоп-клиента (Windows WinDivert / Linux NFQUEUE):',
        lblAppName: 'Название приложения',
        lblAppShortName: 'Короткое имя',
        lblAppVersion: 'Версия',
        lblAppIconType: 'Иконка приложения',
        lblAppDescription: 'Описание',
        titleAppThemes: 'Темы и визуальный стиль',
        lblAppPresetStyle: 'Готовые темы оформления:',
        lblAppThemeMode: 'Режим темы:',
        lblAppThemeColor: 'Акцентный цвет',
        lblAppThemeBg: 'Фон окна',
        lblAppThemeCard: 'Фон карточек',
        titleAppRoutingRules: 'Правила маршрутизации процессов',
        lblQuickRules: 'Быстрые пресеты:',
        titleAppBehavior: 'Системные службы и запуск',
        lblAppAutoStart: 'Автозапуск с Windows',
        lblAppStartMinimized: 'Сворачивать в системный трей',
        lblAppInstallService: 'Служба Windows (Background Service)',
        lblAppTrafficLogging: 'Логирование соединений',
        titleAppLivePreview: 'Интерактивный предпросмотр приложения',
        subAppLivePreview: 'Реактивный симулятор десктопного окна PEC-App с применением темы и правил в реальном времени:',

        // Tab 3: Fleet
        titleFleetInstances: 'Флот корпоративной сети',
        subFleetInstances: 'Централизованное управление инстансами расширения, профилями и прокси-нодами',
        titleRegisteredDevices: 'Зарегистрированный флот',
        thInstId: 'ID экземпляра',
        thInstUser: 'Пользователь',
        thInstIp: 'IP адрес',
        thInstVer: 'Версия',
        thInstGroup: 'Группа флота',
        thInstProfile: 'Назначенный профиль',
        thInstSyncs: 'Синхронизаций',
        thInstStatus: 'Статус',
        thInstAssign: 'Назначить профиль',
        thInstProxy: 'Прокси-сервер',
        thInstActions: 'Действия',
        txtNoFleet: 'Зарегистрированный флот отсутствует',
        titleDesktopClients: 'Десктопные клиенты PEC-App',
        subDesktopClients: 'Централизованное управление клиентами Windows, мониторинг версий и назначение прокси-нод',
        txtNoDesktopClients: 'Десктопные клиенты еще не подключались. Запустите PEC-App.exe на рабочей станции.',
        tabBtnReleases: '<img src="/icons/package.png" class="icon-inline" alt="releases"> Релизы и откат',
        titleReleasesBanner: 'Управление релизами и откат версий',
        descReleasesBanner: 'Версионированный архив расширений (.crx) и десктоп-клиентов (.zip). Мгновенный откат в случае сбоев.',
        btnRefreshReleases: '🔄 Обновить релизы',
        titleReleasesTable: 'История релизов',
        thRelType: 'Тип',
        thRelVer: 'Версия',
        thRelDate: 'Дата сборки',
        thRelSha: 'SHA-256',
        thRelStatus: 'Статус',
        thRelActions: 'Действия',

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
        titleGpoPackBanner: 'Комплексный пакет развертывания Active Directory GPO',
        descGpoPackBanner: 'Включает готовые .REG файлы (HKCU и HKLM) для всех 4 браузеров (Chrome, Edge, Яндекс, Opera), PowerShell скрипты deploy/verify, JSON-политики и руководство администратора.',
        btnDownloadGpoPack: 'Скачать GPO Deployment Pack (.zip)',
        titleGpoScripts: 'PowerShell скрипты автоматизации',
        descGpoScripts: 'Скрипты для использования в качестве Logon/Startup скриптов GPO и проверки рабочего места.',
        btnDownloadDeployPs: 'deploy-pec-gpo.ps1',
        btnDownloadVerifyPs: 'verify-pec-gpo.ps1',
        lblGpoActivePath: 'Ветка реестра:',
        btnCopy: 'Копировать',

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
        warnChromiumSocks5Auth: '<img src="/icons/warning.png" class="icon-inline" alt="warn"> Браузеры на базе Chromium (Chrome, Edge, Brave, Яндекс) не поддерживают авторизацию (логин/пароль) для SOCKS5. При наличии логина Chrome не сможет подключиться к прокси. Используйте протокол HTTP для авторизованных корпоративных прокси либо SOCKS5 без логина/пароля (по IP-фильтру).',
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
        btnScenDocker: '<img src="/icons/docker.png" class="icon-inline" alt="docker"> Docker и Compose',
        btnScenSystemd: '<img src="/icons/linux.png" class="icon-inline" alt="linux"> Служба Linux Systemd',
        btnScenNginx: '<img src="/icons/shield.png" class="icon-inline" alt="nginx"> Nginx + SSL (HTTPS)',
        btnScenStandalone: '<img src="/icons/bolt.png" class="icon-inline" alt="standalone"> Standalone / PM2',
        btnScenGpo: '<img src="/icons/building.png" class="icon-inline" alt="gpo"> Active Directory / GPO',
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

      const dict = I18N[currentLang];
      
      // Update all elements with data-i18n attributes
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (dict[key]) {
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
          if (dict[key].includes('<')) {
            el.innerHTML = dict[key];
          } else {
            el.textContent = dict[key];
          }
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
          ((name === 'fleet' || name === 'instances') && (oc.includes('fleet') || oc.includes('instances') || id === 'tabBtnInstances' || id === 'tab-instances' || id === 'tabBtnFleet'));
      });
      if (btn) btn.classList.add('active');

      if (name === 'instances' || name === 'fleet') {
        loadInstances();
      } else if (name === 'proxy-settings' || name === 'rotation') {
        fetchProxies();
      } else if (name === 'app-studio') {
        if (!currentAppConfig || !isAppStudioDirty) {
          loadAppStudioConfig();
        }
      } else if (name === 'releases') {
        loadReleases();
      }
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
      const instList = document.getElementById('profTargetInstancesList');
      if (instList && !instList._dirtyBound) {
        instList.addEventListener('change', () => setUnsavedRouting(true));
        instList._dirtyBound = true;
      }
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
            badgeHtml = `<span class="preset-in-profile-badge action-${esc(act)}">${isRu ? 'В профиле: ' : 'In Profile: '}${esc(actLabel)}</span>`;
          }

          return `
          <div class="preset-card">
            <div>
              <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 6px; margin-bottom: 4px;">
                <h4 style="margin: 0; font-size: 13px; font-weight: 600;">${esc(p.name)}</h4>
                <button type="button" class="btn-icon btn-inspect-geobase" data-id="${esc(p.id)}" title="${isRu ? 'Инспектор пресета' : 'Inspect Preset'}" style="font-size: 11px; padding: 2px 5px; line-height: 1;"><img src="/icons/search.png" class="icon-inline-sm" alt="inspect"></button>
              </div>
              <p style="margin: 0 0 6px 0;">${esc(p.description)} (${count} ${isRu ? 'записей' : 'entries'})</p>
              ${badgeHtml ? `<div style="margin-bottom: 6px;">${badgeHtml}</div>` : ''}
            </div>
            <div style="display: flex; gap: 6px; margin-top: 6px;">
              <button type="button" class="btn-secondary btn-add-preset-rule" data-id="${esc(p.id)}" data-name="${esc(p.name)}" data-action="proxy" style="font-size: 11px; padding: 4px 8px; flex: 1;">+ ${isRu ? 'Прокси' : 'Proxy'}</button>
              <button type="button" class="btn-secondary btn-add-preset-rule" data-id="${esc(p.id)}" data-name="${esc(p.name)}" data-action="direct" style="font-size: 11px; padding: 4px 8px; flex: 1;">+ ${isRu ? 'Напрямую' : 'Direct'}</button>
              <button type="button" class="btn-danger btn-add-preset-rule" data-id="${esc(p.id)}" data-name="${esc(p.name)}" data-action="block" style="font-size: 11px; padding: 4px 8px; flex: 1;">+ ${isRu ? 'Блок' : 'Block'}</button>
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

    async function populateProfileInstancesList(selectedIds = []) {
      const container = document.getElementById('profTargetInstancesList');
      if (!container) return;
      if (!lastLoadedInstances || !lastLoadedInstances.length) {
        try {
          const res = await adminFetch('/api/instances');
          if (res.ok) {
            const data = await res.json();
            lastLoadedInstances = data.instances || [];
          }
        } catch (_) {}
      }
      const instances = lastLoadedInstances || [];
      const set = new Set(selectedIds || []);
      const isRu = currentLang === 'ru';
      if (instances.length === 0) {
        container.innerHTML = '<span style="color: var(--text-muted); font-size: 12px;">' + (isRu ? 'Нет подключенных устройств' : 'No instances connected yet') + '</span>';
        return;
      }
      container.innerHTML = instances.map(inst => {
        const id = esc(inst.instanceId);
        const name = esc(inst.username || inst.ip || inst.instanceId);
        const checked = set.has(inst.instanceId) ? ' checked' : '';
        return '<label style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px; font-size: 12px; cursor: pointer;">' +
          '<input type="checkbox" class="prof-instance-checkbox" value="' + id + '"' + checked + ' style="margin: 0; width: 14px; height: 14px;"> ' +
          '<span><code>' + id + '</code> (' + name + ')</span>' +
          '</label>';
      }).join('');
    }

    function renderProfile(p) {
      document.getElementById('profName').value = p.name || '';
      document.getElementById('profDefaultPolicy').value = p.defaultPolicy || 'direct';
      document.getElementById('profTargetScope').value = p.targetScope || 'all';
      document.getElementById('profTargetGroup').value = p.targetGroup || '';
      document.getElementById('profFailClosed').checked = Boolean(p.failClosed);
      document.getElementById('profDesc').textContent = p.description || 'Configured routing rules.';
      
      const groupRow = document.getElementById('groupTargetRow');
      if (groupRow) groupRow.style.display = p.targetScope === 'group' ? 'block' : 'none';

      const instRow = document.getElementById('instancesTargetRow');
      if (instRow) {
        instRow.style.display = p.targetScope === 'instances' ? 'block' : 'none';
        if (p.targetScope === 'instances') {
          populateProfileInstancesList(p.targetInstanceIds || []);
        }
      }

      document.getElementById('btnPacPreview').href = '/proxy.pac?profileId=' + p.id;
      setUnsavedRouting(false);
      initRoutingDirtyTracking();
      renderRules(p.rules || []);
      loadPresets();
    }

    document.getElementById('profTargetScope').addEventListener('change', (e) => {
      const scope = e.target.value;
      const groupRow = document.getElementById('groupTargetRow');
      if (groupRow) groupRow.style.display = scope === 'group' ? 'block' : 'none';
      const instRow = document.getElementById('instancesTargetRow');
      if (instRow) {
        instRow.style.display = scope === 'instances' ? 'block' : 'none';
        if (scope === 'instances') {
          populateProfileInstancesList(currentProfile ? currentProfile.targetInstanceIds : []);
        }
      }
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
            <input type="checkbox" class="toggle-rule-enabled" data-index="${idx}" ${r.enabled ? 'checked' : ''} style="margin: 0;" />
          </td>
          <td>
            <div style="display: flex; gap: 4px; align-items: center;">
              <button type="button" class="btn-reorder-up" data-index="${idx}" ${idx === 0 ? 'disabled' : ''} title="${isRu ? 'Выше' : 'Move Up'}">▲</button>
              <button type="button" class="btn-reorder-down" data-index="${idx}" ${idx === rules.length - 1 ? 'disabled' : ''} title="${isRu ? 'Ниже' : 'Move Down'}">▼</button>
            </div>
          </td>
          <td><strong>${esc(r.name)}</strong></td>
          <td><code>${esc(r.pattern)}</code></td>
          <td><span class="badge ${badge}">${esc(actionLabel)}</span></td>
          <td>
            <div style="display: flex; gap: 4px; align-items: center;">
              <button type="button" class="btn-secondary btn-edit-rule" data-index="${idx}" style="font-size: 11px; padding: 3px 8px;" title="${isRu ? 'Редактировать правило' : 'Edit rule'}">✏️ ${isRu ? 'Изменить' : 'Edit'}</button>
              <button type="button" class="btn-danger btn-remove-rule" data-index="${idx}" style="font-size: 11px; padding: 3px 8px;">${isRu ? 'Удалить' : 'Delete'}</button>
            </div>
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

    function openEditRuleModal(idx) {
      if (!currentProfile || !Array.isArray(currentProfile.rules) || !currentProfile.rules[idx]) return;
      const rule = currentProfile.rules[idx];
      const idxEl = document.getElementById('editRuleIndex');
      const nameEl = document.getElementById('editRuleName');
      const patternEl = document.getElementById('editRulePattern');
      const actionEl = document.getElementById('editRuleAction');
      const errEl = document.getElementById('editRuleError');

      if (idxEl) idxEl.value = String(idx);
      if (nameEl) nameEl.value = rule.name || '';
      if (patternEl) patternEl.value = rule.pattern || '';
      if (actionEl) actionEl.value = rule.action || 'proxy';
      if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }

      const modal = document.getElementById('modalEditRule');
      if (modal) modal.style.display = 'flex';
    }

    function closeEditRuleModal() {
      const modal = document.getElementById('modalEditRule');
      if (modal) modal.style.display = 'none';
    }

    function saveEditedRule() {
      if (!currentProfile || !Array.isArray(currentProfile.rules)) return;
      const idxEl = document.getElementById('editRuleIndex');
      const nameEl = document.getElementById('editRuleName');
      const patternEl = document.getElementById('editRulePattern');
      const actionEl = document.getElementById('editRuleAction');
      const errEl = document.getElementById('editRuleError');

      const idx = parseInt(idxEl ? idxEl.value : '-1', 10);
      if (isNaN(idx) || idx < 0 || idx >= currentProfile.rules.length) {
        if (errEl) { errEl.textContent = 'Invalid rule index'; errEl.style.display = 'block'; }
        return;
      }

      const name = nameEl ? nameEl.value.trim() : '';
      const pattern = patternEl ? patternEl.value.trim() : '';
      const action = actionEl ? actionEl.value : 'proxy';

      if (!pattern) {
        if (errEl) {
          errEl.textContent = currentLang === 'ru' ? 'Укажите шаблон правила' : 'Please specify a rule pattern';
          errEl.style.display = 'block';
        }
        return;
      }

      const rule = currentProfile.rules[idx];
      rule.name = name || pattern;
      rule.pattern = pattern;
      rule.action = action;
      if (rule.targetType !== 'preset') {
        rule.targetType = pattern.includes('/') ? 'cidr' : 'wildcard';
      }

      setUnsavedRouting(true);
      renderRules(currentProfile.rules);
      closeEditRuleModal();
      toast(currentLang === 'ru' ? 'Правило обновлено (сохраните профиль)' : 'Rule updated (save profile to persist)', 'success');
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

      if (currentProfile.targetScope === 'instances') {
        const checkedBoxes = document.querySelectorAll('#profTargetInstancesList .prof-instance-checkbox:checked');
        currentProfile.targetInstanceIds = Array.from(checkedBoxes).map(cb => cb.value);
      } else {
        currentProfile.targetInstanceIds = [];
      }

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
            <input type="checkbox" class="toggle-inspector-entry" data-entry="${escapeHtml(entry)}" ${checked} style="margin: 0;" />
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
          let data = null;
          try {
            data = await res.json();
          } catch (jsonErr) {
            const rawText = await res.text().catch(() => '');
            const cleanText = rawText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            throw new Error('HTTP ' + res.status + ': ' + (cleanText.slice(0, 150) || res.statusText));
          }
          if (!res.ok || !data || !data.ok) {
            throw new Error((data && data.error) || ('HTTP ' + res.status));
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
    let isCustomIconUploaded = false;

    function setCustomIconDataUrl(dataUrl, isUploaded = false, triggerSave = false) {
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

    function getEmojiIconDataUrl() {
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

    function highlightStyleChip(style) {
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

    function toggleSimBypass() {
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
          const extLogs = (data.result && data.result.buildLog) || data.buildLog;
        if (Array.isArray(extLogs) && extLogs.length > 0) {
          lastExtBuildLog = extLogs;
          const extLogBtn = document.getElementById('btnExtViewBuildLog');
          if (extLogBtn) extLogBtn.style.display = 'inline-block';
        }
        toast('Extension package built successfully! .CRX signed, .ZIP created, and updates.xml regenerated.', 'success');
          fetchExtensionInfo();
          await loadExtensionFiles();
          loadReleases();
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

    // ----------------- App Studio (Конструктор десктоп-приложения) -----------------
    let currentAppConfig = null;
    let currentAppRules = [];
    let currentAppThemeMode = 'dark';
    let isAppStudioDirty = false;

    const APP_THEME_PRESETS = {
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
        background: '#0f172a',
        card: '#1e293b',
        text: '#0f172a',
        lightBackground: '#f8fafc',
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

    let lastAppBuildLog = [];
    let lastExtBuildLog = [];
    let currentViewingLogType = 'app';
    let currentAppLayout = 'console';

    function setAppLayout(layout) {
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

    function openBuildLogModal(type) {
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

    function showCompilerWarningModal(message) {
      const modal = document.getElementById('modalCompilerWarning');
      const textEl = document.getElementById('compilerWarningModalText');
      if (textEl) textEl.textContent = message;
      if (modal) {
        modal.style.display = 'flex';
      }
    }

    function closeCompilerWarningModal() {
      const modal = document.getElementById('modalCompilerWarning');
      if (modal) modal.style.display = 'none';
    }

    function closeBuildLogModal() {
      const modal = document.getElementById('modalBuildLog');
      if (modal) modal.style.display = 'none';
    }

    function copyBuildLogToClipboard() {
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

    async function loadAppRoutingProfilesDropdown() {
      const sel = document.getElementById('appRoutingProfileSelect');
      if (!sel) return;
      try {
        const res = await adminFetch('/api/routing/profiles');
        if (!res.ok) return;
        const profiles = await res.json();
        if (!Array.isArray(profiles)) return;
        const currentVal = sel.value || (currentAppConfig && currentAppConfig.inheritRoutingProfileId) || '';
        sel.innerHTML = '<option value="">-- ' + (currentLang === 'ru' ? 'Выберите профиль маршрутизации' : 'Select routing profile') + ' --</option>';
        profiles.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = p.name + ' (' + (p.rules || []).length + ' ' + (currentLang === 'ru' ? 'правил' : 'rules') + ')';
          sel.appendChild(opt);
        });
        if (currentVal) sel.value = currentVal;
      } catch (e) {
        console.warn('Error loading routing profiles for App Studio:', e);
      }
    }

    async function importSelectedRoutingProfileRules() {
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
            domains = r.pattern.split(',').map(s => s.trim()).filter(Boolean);
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

    async function loadAppStudioConfig() {
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

        if (nameEl) nameEl.value = cfg.name || 'PEC - Proxy Client';
        if (shortNameEl) shortNameEl.value = cfg.shortName || 'PEC Client';
        if (verEl) verEl.value = cfg.version || '2.2.0';
        if (descEl) descEl.value = cfg.description || '';
        if (iconEl) iconEl.value = cfg.iconType || 'shield';
        if (presetEl) presetEl.value = cfg.presetStyle || 'cyber-blue';
        if (colorEl) colorEl.value = cfg.themeColor || '#0284c7';
        if (bgEl) bgEl.value = cfg.themeBackground || '#0b1120';
        if (cardEl) cardEl.value = cfg.themeCard || '#131d36';

        if (autoStartEl) autoStartEl.checked = cfg.autoStartWithWindows !== false;
        if (minEl) minEl.checked = cfg.startMinimizedToTray !== false;
        if (serviceEl) serviceEl.checked = cfg.installAsService === true;
        if (logEl) logEl.checked = cfg.trafficLogging !== false;

        currentAppLayout = cfg.uiLayout || 'console';
        setAppLayout(currentAppLayout);
        await loadAppRoutingProfilesDropdown();
        if (cfg.inheritRoutingProfileId) {
          const rSel = document.getElementById('appRoutingProfileSelect');
          if (rSel) rSel.value = cfg.inheritRoutingProfileId;
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
        isAppStudioDirty = false;
      } catch (e) {
        console.error('Failed to load App Studio config:', e);
      }
    }

    function renderAppStudioBuildInfo(info) {
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

          function parseToolInfo(toolKey, defaultAvail) {
            if (!tc) return { available: defaultAvail, text: '' };
            const raw = tc[toolKey] !== undefined ? tc[toolKey] : (tc.tools && tc.tools[toolKey]);
            if (typeof raw === 'boolean') return { available: raw, text: '' };
            if (typeof raw === 'string') return { available: true, text: raw };
            if (raw && typeof raw === 'object') {
              const avail = raw.available !== undefined ? Boolean(raw.available) : (raw.present !== undefined ? Boolean(raw.present) : defaultAvail);
              const txt = raw.version || raw.path || '';
              return { available: avail, text: txt };
            }
            return { available: defaultAvail, text: '' };
          }

          const gccInfo = parseToolInfo('gcc', isAvailable);
          const windresInfo = parseToolInfo('windres', isAvailable);
          const wixlInfo = parseToolInfo('wixl', Boolean(tc && tc.wixl && (tc.wixl === true || tc.wixl.available)));

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

          const wixlBadge = wixlInfo.available
            ? `<span class="badge badge-tool-wixl" id="appToolchainWixlBadge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 11px; padding: 2px 8px; border-radius: 4px;" title="Wixl: ${esc(wixlInfo.text || 'Доступен')}">✓ Wixl${wixlInfo.text ? ' (' + esc(wixlInfo.text) + ')' : ''}</span>`
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

    function collectAppConfigFromForm() {
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

      return {
        name: nameEl ? nameEl.value.trim() : 'PEC - Proxy Client',
        shortName: shortNameEl ? shortNameEl.value.trim() : 'PEC Client',
        version: verEl ? verEl.value.trim() : '2.2.0',
        description: descEl ? descEl.value.trim() : '',
        iconType: iconEl ? iconEl.value : 'shield',
        presetStyle: presetEl ? presetEl.value : 'cyber-blue',
        uiLayout: currentAppLayout,
        inheritRoutingProfileId: (document.getElementById('appRoutingProfileSelect')?.value || '').trim() || undefined,
        defaultThemeMode: currentAppThemeMode || 'dark',
        themeColor: colorEl ? colorEl.value : '#0284c7',
        themeBackground: bgEl ? bgEl.value : '#0b1120',
        themeCard: cardEl ? cardEl.value : '#131d36',
        autoStartWithWindows: autoStartEl ? autoStartEl.checked : true,
        startMinimizedToTray: minEl ? minEl.checked : true,
        installAsService: serviceEl ? serviceEl.checked : false,
        trafficLogging: logEl ? logEl.checked : false,
        processRules: currentAppRules || []
      };
    }

    async function saveAppStudioConfigAction(silent = false) {
      const btn = document.getElementById('btnAppSaveConfig');
      if (btn) btn.disabled = true;
      const config = collectAppConfigFromForm();

      try {
        const res = await adminFetch('/api/app-builder/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config)
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && (data.ok || data.name || data.version)) {
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
        if (btn) btn.disabled = false;
      }
    }

    async function cleanAppBinariesAction() {
      const isRu = currentLang === 'ru';
      if (!confirm(isRu ? 'Удалить скомпилированные бинарники PEC-App для сборки с нуля?' : 'Clean compiled PEC-App binaries to build from scratch?')) {
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

    async function buildAppBinariesAction() {
      const btn = document.getElementById('btnAppBuildBinaries');
      const statusEl = document.getElementById('appBuildStatusMsg');
      if (btn) btn.disabled = true;
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.color = 'var(--text-muted)';
        statusEl.textContent = currentLang === 'ru' ? 'Компиляция и проверка бинарников PEC-App...' : 'Compiling and verifying PEC-App binaries...';
      }
      toast(currentLang === 'ru' ? 'Запуск сборки бинарников PEC-App...' : 'Starting binary build...', 'info');

      try {
        const startTime = Date.now();
        const verEl = document.getElementById('appBuildVersion');
        const targetVer = verEl ? verEl.value.trim() : '';
        const res = await adminFetch('/api/app-builder/build-binaries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ version: targetVer }),
        });
        const data = await res.json().catch(() => ({}));

        const isMissingOrFailed = Boolean(
          !res.ok ||
          res.compilerMissing ||
          data.compilerMissing ||
          !data.ok
        );

        if (isMissingOrFailed) {
          const remVer = data.embeddedVersion || (data.info && data.info.embeddedVersion) || (data.info && data.info.version) || targetVer || '2.1.0';
          const warnMsg = currentLang === 'ru'
            ? `Компилятор C/C++ (MinGW / MSVC) не обнаружен. Сборка не производилась. В шаблонах остаются бинарники v${remVer}`
            : `C/C++ compiler (MinGW / MSVC) not found. Compilation was not performed. Templates keep binaries v${remVer}`;

          if (data.info) {
            renderAppStudioBuildInfo(data.info);
          } else if (res.compilerMissing || data.compilerMissing || !res.ok) {
            renderAppStudioBuildInfo({
              version: targetVer || '2.2.0',
              embeddedVersion: remVer,
              binariesStale: true,
              compilerMissing: true,
              toolchain: { available: false, compilerMissing: true }
            });
          }

          if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.style.color = 'var(--danger, #ef4444)';
            statusEl.textContent = warnMsg;
          }
          toast(warnMsg, 'error');
          showCompilerWarningModal(warnMsg);
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
        }
      } catch (e) {
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.style.color = 'var(--danger)';
          statusEl.textContent = 'Network error: ' + e.message;
        }
        toast('Binary build failed: ' + e.message, 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    async function buildAppPackageAction() {
      const btn = document.getElementById('btnAppBuild');
      const statusEl = document.getElementById('appBuildStatusMsg');
      if (btn) btn.disabled = true;
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.color = 'var(--text-muted)';
        statusEl.textContent = currentLang === 'ru' ? 'Сборка пакетов Windows и Linux...' : 'Packaging Windows and Linux distributions...';
      }
      toast(currentLang === 'ru' ? 'Запуск сборки пакетов приложения...' : 'Starting app packaging...', 'info');

      try {
        const saved = await saveAppStudioConfigAction(true);
        if (!saved) {
          if (btn) btn.disabled = false;
          return;
        }

        const res = await adminFetch('/api/app-builder/build', { method: 'POST' });
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
        if (btn) btn.disabled = false;
      }
    }

    function renderAppProcessRulesTable() {
      const tbody = document.getElementById('appProcessRulesBody');
      if (!tbody) return;

      if (!currentAppRules || currentAppRules.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 12px;">${currentLang === 'ru' ? 'Правила не настроены. Добавьте правило или примените пресет.' : 'No process rules defined. Add a rule or apply a preset.'}</td></tr>`;
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

      tbody.innerHTML = html;
      updateAppLivePreview();
    }

    function updateAppProcessRuleField(index, field, value) {
      isAppStudioDirty = true;
      if (currentAppRules && currentAppRules[index]) {
        currentAppRules[index][field] = value;
        if (field === 'processName' || field === 'action' || field === 'targetPorts') {
          updateAppLivePreview();
        }
      }
    }

    function addNewAppProcessRule() {
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

    function deleteAppProcessRule(index) {
      isAppStudioDirty = true;
      if (Array.isArray(currentAppRules) && index >= 0 && index < currentAppRules.length) {
        currentAppRules.splice(index, 1);
        renderAppProcessRulesTable();
      }
    }

    function applyAppRulePreset(presetKey) {
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

    function setAppPresetTheme(presetKey) {
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
      if (currentAppThemeMode === 'light' || presetKey === 'minimal-light' || presetKey === 'enterprise-light') {
        if ((presetKey === 'minimal-light' || presetKey === 'enterprise-light') && currentAppThemeMode !== 'light') {
          currentAppThemeMode = 'light';
          const btnDark = document.getElementById('btnAppModeDark');
          const btnLight = document.getElementById('btnAppModeLight');
          if (btnDark) btnDark.classList.remove('active');
          if (btnLight) btnLight.classList.add('active');
        }
        if (bgEl) bgEl.value = palette.lightBackground || '#f8fafc';
        if (cardEl) cardEl.value = palette.lightCard || '#ffffff';
      } else {
        if (bgEl) bgEl.value = palette.background;
        if (cardEl) cardEl.value = palette.card;
      }

      updateAppLivePreview();
    }

    function onAppPresetChange(val) {
      setAppPresetTheme(val);
    }

    function setAppThemeMode(mode) {
      if (mode !== 'light' && mode !== 'dark') mode = 'dark';
      currentAppThemeMode = mode;

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

    function onAppCustomColorChange() {
      updateAppLivePreview();
    }

    function onAppConfigChangeLive() {
      isAppStudioDirty = true;
      updateAppLivePreview();
    }

    function switchPreviewWindowTab(tabKey) {
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

    function updateAppLivePreview() {
      const previewWin = document.getElementById('appPreviewWindow');
      if (!previewWin) return;
      if (typeof previewWin.setAttribute === 'function') previewWin.setAttribute('data-app-layout', currentAppLayout || 'console');

      const nameEl = document.getElementById('appBuildName');
      const titleEl = document.getElementById('appPreviewTitle');
      if (titleEl) {
        titleEl.textContent = (nameEl && nameEl.value.trim()) || 'PEC - Proxy Client';
      }

      const iconEl = document.getElementById('appIconType');
      const prevIconEl = document.getElementById('appPreviewIcon');
      if (prevIconEl && iconEl) {
        const iconMap = {
          shield: '🛡️',
          lock: '🔒',
          globe: '🌐',
          server: '🖥️',
          key: '🔑'
        };
        prevIconEl.textContent = iconMap[iconEl.value] || '🛡️';
      }

      const colorEl = document.getElementById('appThemeColor');
      const bgEl = document.getElementById('appThemeBackground');
      const cardEl = document.getElementById('appThemeCard');

      const accent = (colorEl && colorEl.value) || '#0284c7';
      const bg = (bgEl && bgEl.value) || '#0b1120';
      const card = (cardEl && cardEl.value) || '#131d36';
      const isLight = currentAppThemeMode === 'light';

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
                <div style="font-weight: 600; color: #f8fafc;">${esc(r.processName || '*')}</div>
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

    async function downloadAppPackageAction(platform) {
      toast((currentLang === 'ru' ? 'Скачивание пакета ' : 'Downloading package ') + platform + '...', 'info');
      try {
        const res = await adminFetch('/api/app-builder/download/' + platform);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          toast((currentLang === 'ru' ? 'Ошибка скачивания: ' : 'Download error: ') + (err.error || ('HTTP ' + res.status)), 'error');
          return;
        }
        const blob = await res.blob();
        let filename = 'pec-client-windows-x64.zip';
        if (platform === 'linux') {
          filename = 'pec-client-linux-x64.tar.gz';
        } else if (platform === 'installer' || platform === 'setup' || platform === 'exe') {
          filename = 'PEC-App-Setup-2.2.0.exe';
        } else if (platform === 'msi') {
          filename = 'PEC-App.msi';
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

    async function downloadAppScriptAction(type) {
      const isVerify = type === 'verify';
      toast((currentLang === 'ru'
        ? (isVerify ? 'Скачивание скрипта проверки...' : 'Скачивание скрипта развёртывания...')
        : (isVerify ? 'Downloading verification script...' : 'Downloading deployment script...')), 'info');
      try {
        const res = await adminFetch('/api/app-builder/scripts/' + (type || 'deploy'));
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          toast((currentLang === 'ru' ? 'Ошибка скачивания: ' : 'Download error: ') + (err.error || ('HTTP ' + res.status)), 'error');
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


    async function loadCodeSignStatus() {
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

    function onCodeSignTypeChange() {
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

    async function uploadCodeSignCertAction() {
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

    async function deleteCodeSignCertAction() {
      if (!confirm(currentLang === 'ru' ? 'Удалить сохраненный сертификат цифровой подписи?' : 'Delete code signing certificate?')) return;
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

    async function downloadAppProfileAction() {
      toast((currentLang === 'ru' ? 'Скачивание профиля PEC-App...' : 'Downloading PEC-App profile...'), 'info');
      try {
        const res = await adminFetch('/api/app-builder/profile');
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          toast((currentLang === 'ru' ? 'Ошибка скачивания: ' : 'Download error: ') + (err.error || ('HTTP ' + res.status)), 'error');
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
    window.loadAppStudioConfig = loadAppStudioConfig;
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
    window.downloadAppPackageAction = downloadAppPackageAction;
    window.downloadAppScriptAction = downloadAppScriptAction;
    window.downloadAppProfileAction = downloadAppProfileAction;
    window.onAppPresetChange = onAppPresetChange;
    window.onAppCustomColorChange = onAppCustomColorChange;
    window.onAppConfigChangeLive = onAppConfigChangeLive;
    window.applyAppRulePreset = applyAppRulePreset;
    window.updateAppProcessRuleField = updateAppProcessRuleField;
    window.populateProfileInstancesList = populateProfileInstancesList;
    Object.defineProperty(window, 'isAppStudioDirty', {
      get() { return isAppStudioDirty; },
      set(v) { isAppStudioDirty = Boolean(v); },
      configurable: true
    });
    Object.defineProperty(window, 'currentProfile', {
      get() { return currentProfile; },
      set(v) { currentProfile = v; },
      configurable: true
    });
    Object.defineProperty(window, 'currentAppRules', {
      get() { return currentAppRules; },
      set(v) { currentAppRules = Array.isArray(v) ? v : []; },
      configurable: true
    });
    Object.defineProperty(window, 'currentAppConfig', {
      get() { return currentAppConfig; },
      set(v) { currentAppConfig = v; },
      configurable: true
    });
    window.loadCodeSignStatus = loadCodeSignStatus;
    window.onCodeSignTypeChange = onCodeSignTypeChange;
    window.uploadCodeSignCertAction = uploadCodeSignCertAction;
    window.deleteCodeSignCertAction = deleteCodeSignCertAction;
    window.loadDesktopInstances = loadDesktopInstances;
    window.renderDesktopInstancesTable = renderDesktopInstancesTable;
    window.initFleetListeners = initFleetListeners;
    window.testCredsEndpoint = testCredsEndpoint;
    window.testSyncEndpoint = testSyncEndpoint;

    // ----------------- Devices & Instances -----------------
    let lastLoadedInstances = [];
    let selectedFleetInstances = new Set();
    let fleetSortCol = 'lastSync';
    let fleetSortAsc = false;
    let fleetListenersInitialized = false;

    async function loadInstances() {
      try {
        if (!currentProxiesList || !currentProxiesList.length) {
          try {
            const pRes = await adminFetch('/api/proxies');
            if (pRes.ok) currentProxiesList = (await pRes.json()) || [];
          } catch (_) {}
        }
        const res = await adminFetch('/api/instances');
        const data = await res.json();
        const isRu = currentLang === 'ru';
        const badge = document.getElementById('badgeFleetOnline');
        if (badge) {
          badge.textContent = data.online + (isRu ? ' онлайн' : ' online');
        }
        lastLoadedInstances = data.instances || [];
        renderInstancesTable(lastLoadedInstances);
        loadDesktopInstances();
        initFleetListeners();
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
        selectedFleetInstances.clear();
        updateFleetBulkBar();
        tbody.innerHTML = '<tr><td colspan="12" style="text-align: center; color: var(--text-muted);">' + (isRu ? 'Пока нет подключенных устройств. Расширения синхронизируются через <code>/api/sync</code> каждые 5 мин.' : 'No instances connected yet. Extensions sync via <code>/api/sync</code> every 5 min.') + '</td></tr>';
        return;
      }

      const defaultProxy = (currentProxiesList || []).find(p => p.isActive || p.active);
      const defaultHostPort = defaultProxy && defaultProxy.host ? (defaultProxy.host.includes(':') && !defaultProxy.host.startsWith('[') ? '[' + defaultProxy.host + ']:' + defaultProxy.port : defaultProxy.host + ':' + defaultProxy.port) : '';
      const defaultProxyName = defaultProxy
        ? (defaultProxy.name || defaultHostPort)
        : (isRu ? 'Серверный по умолчанию' : 'Server Default');


      // Sort instances
      const sortedInstances = [...instances].sort((a, b) => {
        let vA = '';
        let vB = '';
        if (fleetSortCol === 'id') {
          vA = a.instanceId || '';
          vB = b.instanceId || '';
        } else if (fleetSortCol === 'user') {
          vA = a.username || '';
          vB = b.username || '';
        } else if (fleetSortCol === 'ip') {
          vA = a.ip || '';
          vB = b.ip || '';
        } else if (fleetSortCol === 'version') {
          vA = a.version || '';
          vB = b.version || '';
        } else if (fleetSortCol === 'group') {
          vA = a.group || '';
          vB = b.group || '';
        } else if (fleetSortCol === 'profile') {
          vA = a.appliedProfileName || '';
          vB = b.appliedProfileName || '';
        } else if (fleetSortCol === 'syncs') {
          const diff = (Number(a.syncCount) || 0) - (Number(b.syncCount) || 0);
          return fleetSortAsc ? diff : -diff;
        } else if (fleetSortCol === 'status') {
          vA = a.status || '';
          vB = b.status || '';
        } else { // default 'lastSync'
          const tA = a.lastHeartbeat ? new Date(a.lastHeartbeat).getTime() : 0;
          const tB = b.lastHeartbeat ? new Date(b.lastHeartbeat).getTime() : 0;
          return fleetSortAsc ? (tA - tB) : (tB - tA);
        }
        const cmp = String(vA).localeCompare(String(vB));
        return fleetSortAsc ? cmp : -cmp;
      });

      // Update header indicators
      document.querySelectorAll('#instancesTable th.sortable-th').forEach(th => {
        const col = th.getAttribute('data-sort');
        th.classList.remove('sort-asc', 'sort-desc');
        if (col === fleetSortCol) {
          th.classList.add(fleetSortAsc ? 'sort-asc' : 'sort-desc');
        }
      });

      tbody.innerHTML = sortedInstances.map(inst => {
        let badge = 'badge-online';
        if (inst.status === 'STALE') badge = 'badge-stale';
        else if (inst.status === 'OFFLINE') badge = 'badge-offline';

        const hasToken = Boolean(inst.tokenHash);
        const tokenBadge = hasToken
          ? '<span class="badge badge-success" title="' + (isRu ? 'Индивидуальный токен выдан' : 'Enrolled per-instance token') + '">🔑 ' + (isRu ? 'Токен' : 'Token') + '</span>'
          : (inst.revoked
            ? '<span class="badge badge-danger" title="' + (isRu ? 'Токен отозван' : 'Token revoked') + '">🚫 ' + (isRu ? 'Отозван' : 'Revoked') + '</span>'
            : '<span class="badge badge-secondary" title="' + (isRu ? 'Использует общий токен' : 'Using shared token') + '">' + (isRu ? 'Общий' : 'Shared') + '</span>');

        const revokeBtnHtml = hasToken
          ? '<button class="btn btn-sm btn-warning btn-revoke-token" data-id="' + escapeHtml(inst.instanceId) + '" title="' + (isRu ? 'Отозвать индивидуальный токен' : 'Revoke token') + '">🚫</button>'
          : '';

        const isChecked = selectedFleetInstances.has(inst.instanceId);

        const profileOptions = (allProfiles || []).map(p => {
          const sel = (inst.assignedProfileId === p.id) ? ' selected' : '';
          return `<option value="${esc(p.id)}"${sel}>${esc(p.name)}</option>`;
        }).join('');

        const pairedBadge = inst.pairedAppId
          ? `<span class="badge badge-success" title="${isRu ? 'Связано с десктоп-агентом (' + esc(inst.pairedHostname || '') + ')' : 'Paired with desktop app (' + esc(inst.pairedHostname || '') + ')'}">🔗 ${isRu ? 'Десктоп' : 'Desktop'}</span>`
          : '';
        const userDisplay = inst.username
          ? `<div style="font-weight: 600; font-family: var(--mono); font-size: 12px;">${esc(inst.username)}</div>${pairedBadge ? '<div style="margin-top: 3px;">' + pairedBadge + '</div>' : ''}`
          : `<span style="color: var(--text-muted);">—</span>`;

        return `<tr>
          <td style="text-align: center;">
            <input type="checkbox" class="fleet-row-checkbox" data-id="${esc(inst.instanceId)}" ${isChecked ? 'checked' : ''}>
          </td>
          <td>
            <code>${esc(inst.instanceId)}</code>
            <div style="margin-top: 4px;">${tokenBadge}</div>
          </td>
          <td>${userDisplay}</td>
          <td style="font-family: var(--mono);">${esc(inst.ip)}</td>
          <td>v${esc(inst.version)}</td>
          <td><code>${esc(inst.group || (isRu ? 'Основная группа' : 'Default Group'))}</code></td>
          <td><span class="badge badge-action-proxy">${esc(inst.appliedProfileName || (isRu ? 'По умолчанию' : 'Default'))}</span></td>
          <td>${esc(inst.syncCount)}</td>
          <td><span class="badge ${badge}">${esc(inst.status)}</span></td>
          <td>
            <select class="form-select form-select-sm select-instance-profile" data-instance-id="${escapeHtml(inst.instanceId)}" style="margin-bottom: 0; font-size: 11px; padding: 3px 6px;">
              <option value="">${isRu ? 'По умолчанию (Авто)' : 'Default (Auto)'}</option>
              ${profileOptions}
            </select>
          </td>
          <td>
            <select class="form-select form-select-sm select-instance-proxy" data-instance-id="${escapeHtml(inst.instanceId)}" style="margin-bottom: 0; font-size: 11px; padding: 3px 6px;">
              <option value="">${isRu ? 'По умолчанию (' + esc(defaultProxyName) + ')' : 'Default (' + esc(defaultProxyName) + ')'}</option>
              ${(currentProxiesList || []).map(p => {
                const pHostPort = p.host && p.host.includes(':') && !p.host.startsWith('[') ? '[' + p.host + ']:' + p.port : p.host + ':' + p.port;
                const pName = p.name || pHostPort;
                const sel = inst.assignedProxyId === p.id ? ' selected' : '';
                return `<option value="${esc(p.id)}"${sel}>${esc(pName)} (${esc(p.protocol)})</option>`;
              }).join('')}
            </select>
          </td>
          <td>
            <div style="display: inline-flex; gap: 6px; align-items: center;">
              ${revokeBtnHtml}
              <button class="btn btn-sm btn-danger btn-delete-instance" data-id="${escapeHtml(inst.instanceId)}" title="${isRu ? 'Удалить устройство' : 'Delete device'}"><img src="/icons/trash.png" class="icon-inline-sm" alt="del"></button>
            </div>
          </td>
        </tr>`;
      }).join('');

      updateFleetBulkBar();
    }

    function updateFleetBulkBar() {
      const isRu = currentLang === 'ru';
      const bar = document.getElementById('fleetBulkBar');
      const countEl = document.getElementById('fleetSelectedCount');
      const selectAll = document.getElementById('fleetSelectAll');

      const count = selectedFleetInstances.size;
      if (countEl) countEl.textContent = count;

      if (bar) {
        bar.style.display = count > 0 ? 'flex' : 'none';
      }

      if (selectAll) {
        const total = (lastLoadedInstances || []).length;
        if (total > 0 && count === total) {
          selectAll.checked = true;
          selectAll.indeterminate = false;
        } else if (count > 0) {
          selectAll.checked = false;
          selectAll.indeterminate = true;
        } else {
          selectAll.checked = false;
          selectAll.indeterminate = false;
        }
      }

      // Populate bulk selects
      const proxySelect = document.getElementById('bulkAssignProxySelect');
      if (proxySelect) {
        const currentVal = proxySelect.value;
        const defaultProxy = (currentProxiesList || []).find(p => p.isActive || p.active);
        const defaultHostPort = defaultProxy && defaultProxy.host ? (defaultProxy.host.includes(':') && !defaultProxy.host.startsWith('[') ? '[' + defaultProxy.host + ']:' + defaultProxy.port : defaultProxy.host + ':' + defaultProxy.port) : '';
        const defaultProxyName = defaultProxy ? (defaultProxy.name || defaultHostPort) : (isRu ? 'Серверный по умолчанию' : 'Server Default');
        
        proxySelect.innerHTML = `<option value="">${isRu ? 'По умолчанию (' + esc(defaultProxyName) + ')' : 'Default (' + esc(defaultProxyName) + ')'}</option>` +
          (currentProxiesList || []).map(p => {
            const pHostPort = p.host && p.host.includes(':') && !p.host.startsWith('[') ? '[' + p.host + ']:' + p.port : p.host + ':' + p.port;
            const pName = p.name || pHostPort;
            return `<option value="${esc(p.id)}">${esc(pName)} (${esc(p.protocol)})</option>`;
          }).join('');
        if (currentVal) proxySelect.value = currentVal;
      }

      const profileSelect = document.getElementById('bulkAssignProfileSelect');
      if (profileSelect) {
        const currentVal = profileSelect.value;
        profileSelect.innerHTML = `<option value="">${isRu ? 'По умолчанию (Авто)' : 'Default (Auto)'}</option>` +
          (allProfiles || []).map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
        if (currentVal) profileSelect.value = currentVal;
      }
    }

    async function bulkAssignProxy() {
      const isRu = currentLang === 'ru';
      if (!selectedFleetInstances.size) return;
      const proxySelect = document.getElementById('bulkAssignProxySelect');
      const proxyId = proxySelect ? proxySelect.value : '';
      try {
        const res = await adminFetch('/api/instances/bulk-assign-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instanceIds: Array.from(selectedFleetInstances),
            proxyId: proxyId || undefined
          })
        });
        if (res.ok) {
          toast(isRu ? `Прокси назначен для ${selectedFleetInstances.size} устройств` : `Proxy assigned to ${selectedFleetInstances.size} devices`, 'success');
          selectedFleetInstances.clear();
          loadInstances();
        } else {
          const d = await res.json().catch(() => ({}));
          toast('Bulk proxy error: ' + (d.error || res.statusText), 'error');
        }
      } catch (err) {
        toast('Bulk proxy error: ' + err, 'error');
      }
    }

    async function bulkAssignProfile() {
      const isRu = currentLang === 'ru';
      if (!selectedFleetInstances.size) return;
      const profileSelect = document.getElementById('bulkAssignProfileSelect');
      const profileId = profileSelect ? profileSelect.value : '';
      try {
        const res = await adminFetch('/api/instances/bulk-assign-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instanceIds: Array.from(selectedFleetInstances),
            profileId
          })
        });
        if (res.ok) {
          toast(isRu ? `Профиль назначен для ${selectedFleetInstances.size} устройств` : `Profile assigned to ${selectedFleetInstances.size} devices`, 'success');
          selectedFleetInstances.clear();
          loadInstances();
        } else {
          const d = await res.json().catch(() => ({}));
          toast('Bulk profile error: ' + (d.error || res.statusText), 'error');
        }
      } catch (err) {
        toast('Bulk profile error: ' + err, 'error');
      }
    }

    async function bulkRevokeTokens() {
      const isRu = currentLang === 'ru';
      const count = selectedFleetInstances.size;
      if (!count) return;
      if (!confirm(isRu ? `Отозвать индивидуальные токены для ${count} устройств?` : `Revoke tokens for ${count} devices?`)) return;
      try {
        const res = await adminFetch('/api/instances/bulk-revoke-tokens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instanceIds: Array.from(selectedFleetInstances)
          })
        });
        if (res.ok) {
          toast(isRu ? 'Токены успешно отозваны' : 'Tokens successfully revoked', 'success');
          selectedFleetInstances.clear();
          loadInstances();
        } else {
          const d = await res.json().catch(() => ({}));
          toast('Bulk revoke error: ' + (d.error || res.statusText), 'error');
        }
      } catch (err) {
        toast('Bulk revoke error: ' + err, 'error');
      }
    }

    async function bulkDeleteInstances() {
      const isRu = currentLang === 'ru';
      const count = selectedFleetInstances.size;
      if (!count) return;
      if (!confirm(isRu ? `Удалить ${count} выбранных устройств из флота?` : `Delete ${count} selected devices from fleet?`)) return;
      try {
        const res = await adminFetch('/api/instances/bulk-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instanceIds: Array.from(selectedFleetInstances)
          })
        });
        if (res.ok) {
          toast(isRu ? 'Устройства успешно удалены' : 'Devices deleted successfully', 'success');
          selectedFleetInstances.clear();
          loadInstances();
        } else {
          const d = await res.json().catch(() => ({}));
          toast('Bulk delete error: ' + (d.error || res.statusText), 'error');
        }
      } catch (err) {
        toast('Bulk delete error: ' + err, 'error');
      }
    }

    let lastLoadedDesktopInstances = [];

    async function loadDesktopInstances() {
      try {
        if (!currentProxiesList || !currentProxiesList.length) {
          try {
            const pRes = await adminFetch('/api/proxies');
            if (pRes.ok) currentProxiesList = (await pRes.json()) || [];
          } catch (_) {}
        }
        const res = await adminFetch('/api/app/instances');
        if (!res.ok) return;
        const data = await res.json();
        lastLoadedDesktopInstances = data.instances || [];
        renderDesktopInstancesTable(lastLoadedDesktopInstances);
      } catch (err) {
        console.warn('Failed to load desktop instances:', err);
      }
    }

    function renderDesktopInstancesTable(instances) {
      const isRu = currentLang === 'ru';
      const tbody = document.getElementById('desktopFleetTableBody');
      const badge = document.getElementById('badgeDesktopOnline');
      if (!tbody) return;

      const onlineCount = (instances || []).filter(i => i.status === 'ONLINE').length;
      if (badge) {
        badge.textContent = onlineCount + (isRu ? ' онлайн' : ' online');
        badge.className = 'badge ' + (onlineCount > 0 ? 'badge-online' : 'badge-offline');
      }

      if (!instances || !instances.length) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--text-muted);">' +
          (isRu ? 'Десктопные клиенты еще не подключались. Запустите PEC-App.exe на рабочей станции.' : 'No desktop clients connected yet. Launch PEC-App.exe on a workstation.') +
          '</td></tr>';
        return;
      }

      const proxies = currentProxiesList || [];
      tbody.innerHTML = instances.map(inst => {
        let badgeClass = 'badge-online';
        if (inst.status === 'STALE') badgeClass = 'badge-stale';
        else if (inst.status === 'OFFLINE') badgeClass = 'badge-offline';

        const pairedBadge = inst.pairedExtension?.instanceId
          ? `<span class="badge badge-success" title="ID: ${esc(inst.pairedExtension.instanceId)}">🔗 ${esc(inst.pairedExtension.instanceId.slice(0, 14))}... (${esc(inst.pairedExtension.browser || 'ext')})</span>`
          : `<span style="color: var(--text-muted); font-size: 11px;">${isRu ? 'Не привязано' : 'Not paired'}</span>`;

        let proxyOptions = `<option value="default">${isRu ? 'По умолчанию' : 'Default'}</option>`;
        proxies.forEach(p => {
          const pHostPort = (p.host || '') + ':' + (p.port || '');
          const pName = p.name || pHostPort;
          const isSel = (inst.assignedProxyId === p.id);
          proxyOptions += `<option value="${esc(p.id)}" ${isSel ? 'selected' : ''}>${esc(pName)}</option>`;
        });

        const syncTime = inst.lastSync ? (typeof formatRelativeTime === 'function' ? formatRelativeTime(inst.lastSync) : new Date(inst.lastSync).toLocaleTimeString()) : '-';

        return `<tr>
          <td><span class="badge ${badgeClass}">${esc(inst.status || 'ONLINE')}</span></td>
          <td><strong>${esc(inst.hostname || '-')}</strong></td>
          <td><span class="badge badge-subtle">👤 ${esc(inst.username || '-')}</span></td>
          <td><code>${esc(inst.ip || '-')}</code></td>
          <td><span class="badge badge-version">v${esc(inst.version || '2.2.0')}</span></td>
          <td>${pairedBadge}</td>
          <td>
            <select class="form-select form-select-sm desktop-proxy-select" data-app-id="${esc(inst.appInstanceId)}" style="font-size: 12px; max-width: 170px; margin-bottom: 0;">
              ${proxyOptions}
            </select>
          </td>
          <td style="font-size: 11px; color: var(--text-muted);">${esc(syncTime)}</td>
          <td style="text-align: center;">
            <button type="button" class="btn btn-sm btn-icon btn-danger btn-delete-desktop" data-app-id="${esc(inst.appInstanceId)}" title="${isRu ? 'Удалить из реестра' : 'Delete'}">🗑️</button>
          </td>
        </tr>`;
      }).join('');
    }

    function initFleetListeners() {
      if (fleetListenersInitialized) return;
      fleetListenersInitialized = true;

      const selectAll = document.getElementById('fleetSelectAll');
      if (selectAll) {
        selectAll.addEventListener('change', () => {
          if (selectAll.checked) {
            (lastLoadedInstances || []).forEach(i => selectedFleetInstances.add(i.instanceId));
          } else {
            selectedFleetInstances.clear();
          }
          renderInstancesTable(lastLoadedInstances);
        });
      }

      const tbody = document.getElementById('fleetTableBody');
      if (tbody) {
        tbody.addEventListener('change', (e) => {
          const target = e.target;
          if (target && target.classList.contains('fleet-row-checkbox')) {
            const id = target.getAttribute('data-id');
            if (id) {
              if (target.checked) selectedFleetInstances.add(id);
              else selectedFleetInstances.delete(id);
              updateFleetBulkBar();
            }
          }
        });
      }

      const table = document.getElementById('instancesTable');
      if (table) {
        table.addEventListener('click', (e) => {
          const th = e.target.closest('th.sortable-th');
          if (th) {
            const col = th.getAttribute('data-sort');
            if (col) {
              if (fleetSortCol === col) {
                fleetSortAsc = !fleetSortAsc;
              } else {
                fleetSortCol = col;
                fleetSortAsc = true;
              }
              renderInstancesTable(lastLoadedInstances);
            }
          }
        });
      }

      const btnBulkProxy = document.getElementById('btnBulkAssignProxy');
      if (btnBulkProxy) btnBulkProxy.addEventListener('click', bulkAssignProxy);
      const btnBulkProfile = document.getElementById('btnBulkAssignProfile');
      if (btnBulkProfile) btnBulkProfile.addEventListener('click', bulkAssignProfile);
      const btnBulkRevoke = document.getElementById('btnBulkRevokeTokens');
      if (btnBulkRevoke) btnBulkRevoke.addEventListener('click', bulkRevokeTokens);
      const btnBulkDel = document.getElementById('btnBulkDelete');
      if (btnBulkDel) btnBulkDel.addEventListener('click', bulkDeleteInstances);
      const btnRefreshDesktop = document.getElementById('btnRefreshDesktopFleet');
      if (btnRefreshDesktop) {
        btnRefreshDesktop.addEventListener('click', () => loadDesktopInstances());
      }

      const desktopTbody = document.getElementById('desktopFleetTableBody');
      if (desktopTbody) {
        desktopTbody.addEventListener('change', async (e) => {
          const sel = e.target.closest('.desktop-proxy-select');
          if (!sel) return;
          const appId = sel.getAttribute('data-app-id');
          const proxyId = sel.value;
          try {
            const res = await adminFetch(`/api/app/instances/${encodeURIComponent(appId)}/assign-proxy`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ proxyId }),
            });
            if (res.ok) {
              toast(currentLang === 'ru' ? 'Прокси успешно назначен клиенту' : 'Proxy assigned to client', 'success');
              loadDesktopInstances();
            } else {
              toast(currentLang === 'ru' ? 'Не удалось назначить прокси' : 'Failed to assign proxy', 'error');
            }
          } catch (err) {
            toast((currentLang === 'ru' ? 'Ошибка: ' : 'Error: ') + err.message, 'error');
          }
        });

        desktopTbody.addEventListener('click', async (e) => {
          const btn = e.target.closest('.btn-delete-desktop');
          if (!btn) return;
          const appId = btn.getAttribute('data-app-id');
          const isRu = currentLang === 'ru';
          if (!confirm(isRu ? 'Удалить десктопный клиент из реестра?' : 'Delete desktop client from registry?')) return;
          try {
            const res = await adminFetch(`/api/app/instances/${encodeURIComponent(appId)}`, {
              method: 'DELETE',
            });
            if (res.ok) {
              toast(isRu ? 'Клиент удален' : 'Client deleted', 'success');
              loadDesktopInstances();
            } else {
              toast(isRu ? 'Не удалось удалить клиента' : 'Failed to delete client', 'error');
            }
          } catch (err) {
            toast((isRu ? 'Ошибка: ' : 'Error: ') + err.message, 'error');
          }
        });
      }
    }

    async function revokeInstanceToken(id) {
      const isRu = currentLang === 'ru';
      if (!confirm((isRu ? 'Отозвать токен доступа для ' : 'Revoke access token for ') + id + '?')) return;
      try {
        const res = await adminFetch('/api/instances/' + encodeURIComponent(id) + '/revoke-token', {
          method: 'POST'
        });
        if (res.ok || res.status === 200) {
          toast(isRu ? 'Токен успешно отозван' : 'Token successfully revoked', 'success');
          loadInstances();
        } else {
          const errData = await res.json().catch(() => ({}));
          toast('Revoke error: ' + (errData.error || res.statusText), 'error');
        }
      } catch (err) {
        toast('Revoke error: ' + err, 'error');
      }
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
      const revokeBtn = e.target.closest('.btn-revoke-token');
      if (revokeBtn) {
        const id = revokeBtn.getAttribute('data-id');
        if (id) revokeInstanceToken(id);
        return;
      }
      const btn = e.target.closest('.btn-delete-instance');
      if (btn) {
        const id = btn.getAttribute('data-id');
        if (id) deleteInstance(id);
        return;
      }
      const inspectPresetBtn = e.target.closest('.btn-inspect-geobase');
      if (inspectPresetBtn) {
        const id = inspectPresetBtn.getAttribute('data-id');
        if (id) openGeobaseInspector(id);
        return;
      }
      const addPresetBtn = e.target.closest('.btn-add-preset-rule');
      if (addPresetBtn) {
        const id = addPresetBtn.getAttribute('data-id');
        const name = addPresetBtn.getAttribute('data-name');
        const action = addPresetBtn.getAttribute('data-action');
        if (id && name && action) addPresetRule(id, name, action);
        return;
      }
      const reorderUpBtn = e.target.closest('.btn-reorder-up');
      if (reorderUpBtn) {
        const idx = reorderUpBtn.getAttribute('data-index');
        if (idx !== null) moveRuleUp(parseInt(idx, 10));
        return;
      }
      const reorderDownBtn = e.target.closest('.btn-reorder-down');
      if (reorderDownBtn) {
        const idx = reorderDownBtn.getAttribute('data-index');
        if (idx !== null) moveRuleDown(parseInt(idx, 10));
        return;
      }
      const editRuleBtn = e.target.closest('.btn-edit-rule');
      if (editRuleBtn) {
        const idx = editRuleBtn.getAttribute('data-index');
        if (idx !== null) openEditRuleModal(parseInt(idx, 10));
        return;
      }
      const removeRuleBtn = e.target.closest('.btn-remove-rule');
      if (removeRuleBtn) {
        const idx = removeRuleBtn.getAttribute('data-index');
        if (idx !== null) removeRule(parseInt(idx, 10));
        return;
      }
      const delAppRuleBtn = e.target.closest('.btn-delete-app-rule');
      if (delAppRuleBtn) {
        const idx = delAppRuleBtn.getAttribute('data-index');
        if (idx !== null) deleteAppProcessRule(parseInt(idx, 10));
        return;
      }
      const actProxyBtn = e.target.closest('.btn-activate-proxy');
      if (actProxyBtn) {
        const id = actProxyBtn.getAttribute('data-id');
        if (id) activateProxy(id);
        return;
      }
      const checkProxyBtn = e.target.closest('.btn-check-proxy');
      if (checkProxyBtn) {
        const id = checkProxyBtn.getAttribute('data-id');
        if (id) checkProxy(id);
        return;
      }
      const syncProxyBtn = e.target.closest('.btn-sync-proxy');
      if (syncProxyBtn) {
        const id = syncProxyBtn.getAttribute('data-id');
        if (id) syncProxy(id);
        return;
      }
      const editProxyBtn = e.target.closest('.btn-edit-proxy');
      if (editProxyBtn) {
        const id = editProxyBtn.getAttribute('data-id');
        if (id) openEditProxyModal(id);
        return;
      }
      const delProxyBtn = e.target.closest('.btn-delete-proxy');
      if (delProxyBtn) {
        const id = delProxyBtn.getAttribute('data-id');
        if (id) deleteProxy(id);
        return;
      }
      const setActiveRelBtn = e.target.closest('.btn-set-active-release');
      if (setActiveRelBtn) {
        const type = setActiveRelBtn.getAttribute('data-type');
        const version = setActiveRelBtn.getAttribute('data-version');
        if (type && version) setActiveReleaseVersion(type, version);
        return;
      }
      const downloadRelBtn = e.target.closest('.btn-download-release');
      if (downloadRelBtn) {
        const type = downloadRelBtn.getAttribute('data-type');
        const version = downloadRelBtn.getAttribute('data-version');
        const filename = downloadRelBtn.getAttribute('data-filename');
        if (type && version) downloadReleaseVersion(type, version, filename);
        return;
      }
      const delRelBtn = e.target.closest('.btn-delete-release');
      if (delRelBtn) {
        const type = delRelBtn.getAttribute('data-type');
        const version = delRelBtn.getAttribute('data-version');
        if (type && version) deleteReleaseVersion(type, version);
        return;
      }
    });

    async function assignProfileToInstance(instanceId, profileId) {
      try {
        const res = await adminFetch('/api/instances/assign-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instanceId, profileId })
        });
        if (res.ok) {
          toast(currentLang === 'ru' ? 'Профиль для инстанса обновлен' : 'Instance profile updated', 'success');
          loadInstances();
        } else {
          const err = await res.json().catch(() => ({}));
          toast(err.error || ('HTTP ' + res.status), 'error');
        }
      } catch (e) {
        toast('Assignment error: ' + e, 'error');
      }
    }

    async function assignProxyToInstance(instanceId, proxyId) {
      try {
        const res = await adminFetch('/api/instances/assign-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instanceId, proxyId: proxyId || undefined })
        });
        if (res.ok) {
          toast(currentLang === 'ru' ? 'Прокси для инстанса обновлен' : 'Instance proxy updated', 'success');
          loadInstances();
        } else {
          const data = await res.json().catch(() => ({}));
          toast('Proxy assignment error: ' + (data.error || res.statusText), 'error');
        }
      } catch (err) {
        toast('Proxy assignment error: ' + err, 'error');
      }
    }

    document.addEventListener('change', function (e) {
      const selectProxy = e.target.closest('.select-instance-proxy');
      if (selectProxy) {
        const instanceId = selectProxy.getAttribute('data-instance-id');
        const proxyId = selectProxy.value || undefined;
        assignProxyToInstance(instanceId, proxyId);
        return;
      }
      const selectProfile = e.target.closest('.select-instance-profile');
      if (selectProfile) {
        const instanceId = selectProfile.getAttribute('data-instance-id');
        const profileId = selectProfile.value || '';
        assignProfileToInstance(instanceId, profileId);
        return;
      }
      const toggleRule = e.target.closest('.toggle-rule-enabled');
      if (toggleRule) {
        const idx = toggleRule.getAttribute('data-index');
        if (idx !== null) toggleRuleEnabled(parseInt(idx, 10));
        return;
      }
      const toggleInspector = e.target.closest('.toggle-inspector-entry');
      if (toggleInspector) {
        const entry = toggleInspector.getAttribute('data-entry');
        if (entry) toggleInspectorEntry(entry, toggleInspector.checked);
        return;
      }
      const appRuleSel = e.target.closest('.app-rule-select');
      if (appRuleSel) {
        const idx = appRuleSel.getAttribute('data-index');
        const field = appRuleSel.getAttribute('data-field');
        if (idx !== null && field) updateAppProcessRuleField(parseInt(idx, 10), field, appRuleSel.value);
        return;
      }
    });

    document.addEventListener('input', function (e) {
      const appRuleInp = e.target.closest('.app-rule-input');
      if (appRuleInp) {
        const idx = appRuleInp.getAttribute('data-index');
        const field = appRuleInp.getAttribute('data-field');
        if (idx !== null && field) updateAppProcessRuleField(parseInt(idx, 10), field, appRuleInp.value);
        return;
      }
    });

    // ----------------- Extension Info & GPO -----------------
    let currentGpoScope = 'user'; // 'user' (HKCU) or 'machine' (HKLM)
    let currentGpoBrowser = 'chrome'; // 'chrome', 'edge', 'yandex', 'opera'

    function updateGpoDisplay() {
      if (!globalGpo) return;

      const browserKeys = {
        chrome: 'Google\\Chrome',
        edge: 'Microsoft\\Edge',
        yandex: 'YandexBrowser',
        opera: 'Opera Software\\Opera',
      };

      const root = currentGpoScope === 'machine' ? 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies' : 'HKEY_CURRENT_USER\\Software\\Policies';
      const activePathEl = document.getElementById('gpoActiveRegKey');
      if (activePathEl) {
        activePathEl.textContent = root + '\\' + (browserKeys[currentGpoBrowser] || 'Google\\Chrome');
      }

      const forcelistEntry = (globalGpo.forcelistEntries && globalGpo.forcelistEntries[currentGpoBrowser]) || globalGpo.forcelistEntry || '';
      const forcelistEl = document.getElementById('gpoForcelist');
      if (forcelistEl) forcelistEl.textContent = forcelistEntry;

      const scenGpo = document.getElementById('scenGpoForcelistText');
      if (scenGpo) scenGpo.textContent = forcelistEntry;

      const browserSettings = (globalGpo.extensionSettingsEntries && globalGpo.extensionSettingsEntries[currentGpoBrowser]) || globalGpo.extensionSettingsJson;
      const settingsEl = document.getElementById('gpoSettings');
      if (settingsEl && browserSettings) {
        settingsEl.textContent = JSON.stringify(browserSettings, null, 2);
      }

      const yandexAlert = document.getElementById('gpoYandexAlert');
      if (yandexAlert) {
        yandexAlert.style.display = currentGpoBrowser === 'yandex' ? 'block' : 'none';
      }

      const dlLabel = document.getElementById('lblDownloadRegBtn');
      if (dlLabel) {
        const isRu = currentLang === 'ru';
        dlLabel.textContent = isRu
          ? (currentGpoScope === 'machine' ? 'Скачать Windows .REG файл (HKLM)' : 'Скачать Windows .REG файл (HKCU)')
          : (currentGpoScope === 'machine' ? 'Download Windows .REG File (HKLM)' : 'Download Windows .REG File (HKCU)');
      }
    }

    function setGpoScope(scope) {
      currentGpoScope = scope;
      const userBtn = document.getElementById('scopeBtnUser');
      const machBtn = document.getElementById('scopeBtnMachine');
      if (userBtn && machBtn) {
        if (scope === 'user') {
          userBtn.style.background = 'var(--primary)';
          userBtn.style.color = '#fff';
          userBtn.style.opacity = '1';
          machBtn.style.background = 'transparent';
          machBtn.style.color = 'var(--text)';
          machBtn.style.opacity = '0.6';
        } else {
          machBtn.style.background = 'var(--primary)';
          machBtn.style.color = '#fff';
          machBtn.style.opacity = '1';
          userBtn.style.background = 'transparent';
          userBtn.style.color = 'var(--text)';
          userBtn.style.opacity = '0.6';
        }
      }
      updateGpoDisplay();
    }

    function setGpoBrowser(browser) {
      currentGpoBrowser = browser;
      const browsers = ['chrome', 'edge', 'yandex', 'opera'];
      browsers.forEach(b => {
        const btn = document.getElementById('gpoBrowser' + b.charAt(0).toUpperCase() + b.slice(1));
        if (btn) {
          if (b === browser) {
            btn.classList.add('active');
            btn.style.borderColor = 'var(--primary)';
            btn.style.opacity = '1';
          } else {
            btn.classList.remove('active');
            btn.style.borderColor = '';
            btn.style.opacity = '0.7';
          }
        }
      });
      updateGpoDisplay();
    }

    async function fetchExtensionInfo() {
      try {
        const res = await adminFetch('/api/extension/info');
        const data = await res.json();
        document.getElementById('dispExtId').textContent = data.extensionId;
        document.getElementById('dispExtVer').textContent = data.version;

        globalGpo = data.gpo;
        updateGpoDisplay();
      } catch (e) {
        console.error(e);
      }
    }

    async function downloadGpoPack() {
      try {
        toast(currentLang === 'ru' ? 'Формирование GPO пакета...' : 'Generating GPO deployment pack...', 'info');
        const res = await adminFetch('/api/builder/gpo-pack');
        if (!res.ok) {
          toast('Failed to download GPO pack: HTTP ' + res.status, 'error');
          return;
        }
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'pec-gpo-deployment-pack.zip';
        a.click();
        toast(currentLang === 'ru' ? 'Пакет GPO скачан!' : 'GPO pack downloaded!', 'success');
      } catch (e) {
        toast('Error downloading GPO pack: ' + e, 'error');
      }
    }

    async function downloadRegFile() {
      try {
        const res = await adminFetch('/api/builder/reg?scope=' + currentGpoScope);
        if (!res.ok) {
          toast('Failed to download .reg file: HTTP ' + res.status, 'error');
          return;
        }
        const text = await res.text();
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'pec-policy-' + currentGpoScope + '.reg';
        a.click();
      } catch (e) {
        toast('Could not download .reg file: ' + e, 'error');
      }
    }

    async function downloadScriptFile(name) {
      try {
        const res = await adminFetch('/api/builder/script/' + name + '.ps1');
        if (!res.ok) {
          toast('Failed to download script: HTTP ' + res.status, 'error');
          return;
        }
        const text = await res.text();
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (name === 'deploy' ? 'deploy-pec-gpo.ps1' : 'verify-pec-gpo.ps1');
        a.click();
      } catch (e) {
        toast('Could not download script: ' + e, 'error');
      }
    }

    function copyGpoForcelist() {
      const el = document.getElementById('gpoForcelist');
      if (el && el.textContent) {
        navigator.clipboard.writeText(el.textContent.trim()).then(() => {
          toast(currentLang === 'ru' ? 'Forcelist скопирован в буфер!' : 'Forcelist entry copied to clipboard!', 'success');
        });
      }
    }

    function copyGpoSettings() {
      const el = document.getElementById('gpoSettings');
      if (el && el.textContent) {
        navigator.clipboard.writeText(el.textContent.trim()).then(() => {
          toast(currentLang === 'ru' ? 'ExtensionSettings JSON скопирован!' : 'ExtensionSettings JSON copied!', 'success');
        });
      }
    }

    function copyGpoRegSz() {
      if (!globalGpo) return;
      const browserSettings = (globalGpo.extensionSettingsEntries && globalGpo.extensionSettingsEntries[currentGpoBrowser]) || globalGpo.extensionSettingsJson;
      if (browserSettings) {
        const rawJson = JSON.stringify(browserSettings);
        navigator.clipboard.writeText(rawJson).then(() => {
          toast(currentLang === 'ru' ? 'REG_SZ строка скопирована для GPMC!' : 'REG_SZ string copied for GPMC!', 'success');
        });
      }
    }

    window.setGpoScope = setGpoScope;
    window.setGpoBrowser = setGpoBrowser;
    window.downloadGpoPack = downloadGpoPack;
    window.downloadRegFile = downloadRegFile;
    window.downloadScriptFile = downloadScriptFile;
    window.copyGpoForcelist = copyGpoForcelist;
    window.copyGpoSettings = copyGpoSettings;
    window.copyGpoRegSz = copyGpoRegSz;

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
      const enteredPass = document.getElementById('rotAdminPass').value;
      const payload = {
        panelUrl: document.getElementById('rotPanelUrl').value.trim(),
        adminUser: document.getElementById('rotAdminUser').value.trim(),
        inboundRemark: document.getElementById('rotRemark').value.trim()
      };
      if (enteredPass && enteredPass.trim()) {
        payload.adminPass = enteredPass.trim();
      }

      try {
        const res = await adminFetch('/api/3xui/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        out.innerHTML = (data.ok ? '<img src="/icons/check.png" class="icon-inline-sm" alt="ok"> ' : '<img src="/icons/cross.png" class="icon-inline-sm" alt="err"> ') + esc(data.message);
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
          tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; color: var(--text-muted);">' + esc(t('txtNoProxies', 'No proxy nodes configured yet.')) + '</td></tr>';
        } else {
          tbody.innerHTML = list.map(function (px) {
            const activeCell = px.isActive
              ? '<span class="badge badge-online" style="cursor: default;" title="' + esc(t('badgeActive', 'ACTIVE')) + '">● ' + esc(t('badgeActive', 'ACTIVE')) + '</span>'
              : '<button type="button" class="btn-secondary btn-activate-proxy" style="font-size: 11px; padding: 3px 8px;" data-id="' + esc(px.id) + '">' + esc(t('btnSetActive', 'Activate')) + '</button>';

            const nameHtml = (px.name && px.name !== px.tag)
              ? '<div style="font-size: 11px; color: var(--text-muted);">' + esc(px.name) + '</div>'
              : '';

            const typeBadge = px.type === '3x-ui' ? 'badge-action-proxy' : 'badge-secondary';
            const statusBadge = px.status === 'OK' ? 'badge-online' : (px.status === 'ERROR' ? 'badge-offline' : 'badge-secondary');
            const syncTime = px.lastSync ? '<div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">' + new Date(px.lastSync).toLocaleTimeString() + '</div>' : '';

            const latencyHtml = (typeof px.latencyMs === 'number' && px.latencyMs > 0)
              ? '<span class="badge ' + (px.latencyMs < 300 ? 'badge-online' : (px.latencyMs < 1000 ? 'badge-warning' : 'badge-offline')) + '">' + px.latencyMs + ' ms</span>'
              : '<span style="color: var(--text-muted); font-size: 11px;">—</span>';

            const egressHtml = px.egressIp
              ? '<code>' + esc(px.egressIp) + '</code>' + (px.geoCountry ? ' <span class="badge badge-secondary" style="margin-left: 4px;">' + esc(px.geoCountry) + '</span>' : '')
              : '<span style="color: var(--text-muted); font-size: 11px;">—</span>';

            const checkBtn = '<button type="button" class="btn-secondary btn-check-proxy" style="font-size: 11px; padding: 3px 6px;" data-id="' + esc(px.id) + '" title="' + esc(t('btnCheckProxy', 'Check proxy latency and egress IP')) + '"><img src="/icons/bolt.png" class="icon-inline-sm" alt="check"></button>';

            const syncBtn = px.type === '3x-ui'
              ? '<button type="button" class="btn-secondary btn-sync-proxy" style="font-size: 11px; padding: 3px 6px;" data-id="' + esc(px.id) + '" title="' + esc(t('btnSyncProxy', 'Sync & Rotate')) + '"><img src="/icons/sync.png" class="icon-inline-sm" alt="sync"></button>'
              : '';

            const socksAuthWarn = (px.protocol === 'socks5' && px.username)
              ? ' <span title="' + esc(t('warnSocksAuthTable', 'Chromium browsers do not support SOCKS5 with authentication. Use HTTP or IP-whitelisted SOCKS5.')) + '" style="cursor: help; color: #f59e0b;" class="socks-auth-warn"><img src="/icons/warning.png" class="icon-inline-sm" alt="warn"></span>'
              : '';

            return '<tr>' +
              '<td style="text-align: center;">' + activeCell + '</td>' +
              '<td><div><strong>' + esc(px.tag) + '</strong></div>' + nameHtml + '</td>' +
              '<td><span class="badge ' + esc(typeBadge) + '">' + esc(px.type) + '</span></td>' +
              '<td><code style="font-size: 11px; text-transform: uppercase;">' + esc(px.protocol) + '</code>' + socksAuthWarn + '</td>' +
              '<td><code>' + esc(px.host) + ':' + esc(px.port) + '</code></td>' +
              '<td><span>' + esc(px.username || '—') + '</span></td>' +
              '<td><span class="badge ' + esc(statusBadge) + '" title="' + esc(px.errorMessage || '') + '">' + esc(px.status || 'IDLE') + '</span>' + syncTime + '</td>' +
              '<td>' + latencyHtml + '</td>' +
              '<td>' + egressHtml + '</td>' +
              '<td style="text-align: right;"><div style="display: flex; gap: 4px; justify-content: flex-end;">' +
                checkBtn +
                syncBtn +
                '<button type="button" class="btn-secondary btn-edit-proxy" style="font-size: 11px; padding: 3px 6px;" data-id="' + esc(px.id) + '" title="' + esc(t('btnEditProxy', 'Edit')) + '"><img src="/icons/edit.png" class="icon-inline-sm" alt="edit"></button>' +
                '<button type="button" class="btn-danger btn-delete-proxy" style="font-size: 11px; padding: 3px 6px;" data-id="' + esc(px.id) + '" title="' + esc(t('btnDeleteProxy', 'Delete')) + '"><img src="/icons/trash.png" class="icon-inline-sm" alt="del"></button>' +
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

      // 0. Warning banner for placeholder 10.0.0.1 (shown when no proxy is active or host is placeholder)
      const warnBanner = document.getElementById('noActiveProxyWarning');
      if (warnBanner) {
        const isPlaceholder = !active || active.host === '10.0.0.1' || active.status === 'ERR' || active.status === 'ERROR';
        warnBanner.style.display = isPlaceholder ? 'flex' : 'none';
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

    async function checkProxy(id) {
      try {
        toast(t('toastCheckingProxy', 'Checking proxy connectivity and egress IP...'), 'info');
        const res = await adminFetch('/api/proxies/' + encodeURIComponent(id) + '/check', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok && data.result) {
          const r = data.result;
          const statusText = r.status === 'ONLINE' ? 'ONLINE (' + r.latencyMs + 'ms)' : r.status;
          toast(t('toastProxyCheckSuccess', 'Proxy probe: ') + statusText + (r.egressIp ? ' | IP: ' + r.egressIp : ''), r.status === 'ONLINE' ? 'success' : 'warning');
          await fetchProxies();
          fetchStatus();
        } else {
          toast(data.error || 'Failed to check proxy', 'error');
        }
      } catch (e) {
        toast('Error checking proxy: ' + e, 'error');
      }
    }

    async function checkAllProxies() {
      try {
        toast(t('toastCheckingAllProxies', 'Probing all proxies...'), 'info');
        const res = await adminFetch('/api/proxies/check-all', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          const count = data.results ? Object.keys(data.results).length : 0;
          toast(t('toastCheckAllSuccess', 'Probed ') + count + ' proxies successfully', 'success');
          await fetchProxies();
          fetchStatus();
        } else {
          toast(data.error || 'Failed to check proxies', 'error');
        }
      } catch (e) {
        toast('Error probing proxies: ' + e, 'error');
      }
    }

    window.activateProxy = activateProxy;
    window.syncProxy = syncProxy;
    window.deleteProxy = deleteProxy;
    window.checkProxy = checkProxy;
    window.checkAllProxies = checkAllProxies;

    // ----------------- 3x-ui Panels Registry -----------------
    let currentPanelsList = [];

    async function load3xuiPanels() {
      try {
        const res = await adminFetch('/api/3xui/panels');
        if (!res.ok) return;
        const data = await res.json();
        currentPanelsList = Array.isArray(data) ? data : (data && data.panels ? data.panels : []);
        render3xuiPanelsTable(currentPanelsList);
      } catch (e) {
        console.warn('Failed to load 3x-ui panels:', e);
      }
    }

    function render3xuiPanelsTable(panels) {
      const isRu = currentLang === 'ru';
      const tbody = document.getElementById('panels3xuiBody');
      if (tbody) {
        if (!panels || !panels.length) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">' + (isRu ? 'Панели 3x-ui не настроены' : 'No 3x-ui panels configured') + '</td></tr>';
        } else {
          tbody.innerHTML = panels.map(p => `<tr>
            <td><strong>${esc(p.name)}</strong></td>
            <td style="font-family: var(--mono);">${esc(p.panelUrl)}</td>
            <td><code>${esc(p.adminUser)}</code></td>
            <td><span class="badge ${p.insecureTls ? 'badge-warning' : 'badge-success'}">${p.insecureTls ? (isRu ? 'Self-signed TLS' : 'Insecure TLS') : (isRu ? 'Строгий TLS' : 'Valid TLS')}</span></td>
            <td style="text-align: right;">
              <div style="display: inline-flex; gap: 6px;">
                <button type="button" class="btn btn-sm btn-secondary btn-test-panel" data-id="${esc(p.id)}">${isRu ? 'Проверить' : 'Test'}</button>
                <button type="button" class="btn btn-sm btn-secondary btn-edit-panel" data-id="${esc(p.id)}" title="${isRu ? 'Редактировать' : 'Edit'}">✏️</button>
                <button type="button" class="btn btn-sm btn-danger btn-delete-panel" data-id="${esc(p.id)}" title="${isRu ? 'Удалить' : 'Delete'}"><img src="/icons/trash.png" class="icon-inline-sm" alt="del"></button>
              </div>
            </td>
          </tr>`).join('');
        }
      }

      // Populate select in Add from 3x-ui modal
      const sel = document.getElementById('add3xuiPanelSelect');
      if (sel) {
        sel.innerHTML = '<option value="">' + (isRu ? 'По умолчанию (Настройки ротации)' : 'Default (Rotation Settings)') + '</option>' +
          (panels || []).map(p => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.panelUrl)})</option>`).join('');
      }
    }

    function openAdd3xuiPanelModal(panel) {
      const idInp = document.getElementById('panelIdInput');
      const nameInp = document.getElementById('panelName');
      const urlInp = document.getElementById('panelUrl');
      const userInp = document.getElementById('panelUser');
      const passInp = document.getElementById('panelPass');
      const tlsInp = document.getElementById('panelInsecureTls');
      const errEl = document.getElementById('panelModalError');

      if (idInp) idInp.value = panel ? panel.id : '';
      if (nameInp) nameInp.value = panel ? panel.name : '';
      if (urlInp) urlInp.value = panel ? panel.panelUrl : '';
      if (userInp) userInp.value = panel ? panel.adminUser : '';
      if (passInp) passInp.value = '';
      if (tlsInp) tlsInp.checked = panel ? Boolean(panel.insecureTls) : false;
      if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }

      const modal = document.getElementById('modal3xuiPanel');
      if (modal) modal.style.display = 'flex';
      if (nameInp) nameInp.focus();
    }

    function close3xuiPanelModal() {
      const modal = document.getElementById('modal3xuiPanel');
      if (modal) modal.style.display = 'none';
    }

    async function save3xuiPanelAction() {
      const isRu = currentLang === 'ru';
      const id = document.getElementById('panelIdInput')?.value;
      const name = document.getElementById('panelName')?.value?.trim();
      const panelUrl = document.getElementById('panelUrl')?.value?.trim();
      const adminUser = document.getElementById('panelUser')?.value?.trim();
      const adminPass = document.getElementById('panelPass')?.value;
      const insecureTls = document.getElementById('panelInsecureTls')?.checked;
      const errEl = document.getElementById('panelModalError');

      if (!name || !panelUrl || !adminUser) {
        if (errEl) { errEl.textContent = isRu ? 'Заполните обязательные поля: Название, URL и Пользователь' : 'Please fill all required fields'; errEl.style.display = 'block'; }
        return;
      }

      try {
        const url = id ? `/api/3xui/panels/${encodeURIComponent(id)}` : '/api/3xui/panels';
        const method = id ? 'PUT' : 'POST';
        const res = await adminFetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, panelUrl, adminUser, adminPass, insecureTls })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          close3xuiPanelModal();
          toast(isRu ? 'Панель 3x-ui сохранена' : '3x-ui panel saved', 'success');
          load3xuiPanels();
        } else {
          if (errEl) { errEl.textContent = data.error || 'Failed to save panel'; errEl.style.display = 'block'; }
        }
      } catch (e) {
        if (errEl) { errEl.textContent = String(e); errEl.style.display = 'block'; }
      }
    }

    async function delete3xuiPanelAction(id) {
      const isRu = currentLang === 'ru';
      if (!confirm(isRu ? 'Удалить эту панель 3x-ui?' : 'Delete this 3x-ui panel?')) return;
      try {
        const res = await adminFetch(`/api/3xui/panels/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (res.ok) {
          toast(isRu ? 'Панель удалена' : 'Panel deleted', 'success');
          load3xuiPanels();
        } else {
          toast('Delete failed', 'error');
        }
      } catch (e) {
        toast('Delete error: ' + e, 'error');
      }
    }

    async function test3xuiPanelAction(id) {
      const isRu = currentLang === 'ru';
      toast(isRu ? 'Проверка соединения с панелью...' : 'Testing panel connection...', 'info');
      try {
        const res = await adminFetch(`/api/3xui/panels/${encodeURIComponent(id)}/test`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          toast(isRu ? 'Соединение успешно! ' + (data.message || '') : 'Connected! ' + (data.message || ''), 'success');
        } else {
          toast((isRu ? 'Ошибка соединения: ' : 'Connection error: ') + (data.message || data.error || 'Failed'), 'error');
        }
      } catch (e) {
        toast('Test error: ' + e, 'error');
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
      const panelSelect = document.getElementById('add3xuiPanelSelect');
      const panelId = panelSelect ? panelSelect.value : '';
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
          body: JSON.stringify({ tag: tag, panelId: panelId || undefined })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok && data.inbound) {
          const ib = data.inbound;
          let warnHtml = '';
          if ((ib.protocol === 'socks' || ib.protocol === 'socks5') && (ib.username || ib.hasPassword)) {
            warnHtml = '<div style="margin-top: 8px; padding: 6px 10px; background: rgba(245, 158, 11, 0.15); border: 1px solid #f59e0b; border-radius: 4px; color: #fbbf24; font-size: 11px; display: flex; align-items: center; gap: 6px;">' +
              '<img src="/icons/warning.png" class="icon-inline" alt="warn"> ' +
              '<span>' + t('warnChromiumSocks5Auth', 'Chromium (Chrome, Edge, Brave, Yandex) does not support SOCKS5 authentication. If credentials are set, Chrome will reject the connection or bypass the proxy. Use HTTP protocol for authenticated corporate proxies or use SOCKS5 without username/password (e.g. IP whitelist).') + '</span>' +
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
      const panelSelect = document.getElementById('add3xuiPanelSelect');
      const panelId = panelSelect ? panelSelect.value : '';
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
        isActive: activeEl ? Boolean(activeEl.checked) : true,
        panelId: panelId || undefined
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
          if (errEl) { errEl.textContent = data.error || 'Failed to save proxy'; errEl.style.display = 'block'; }
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

    // ----------------- Releases & Rollback Management -----------------
    let currentReleasesList = [];
    let currentActiveExtVer = '';
    let currentActiveAppVer = '';

    async function loadReleases() {
      try {
        const res = await adminFetch('/api/releases');
        if (!res.ok) {
          console.warn('Failed to load releases:', res.status);
          return;
        }
        const data = await res.json();
        currentActiveExtVer = data.activeExtensionVersion || '';
        currentActiveAppVer = data.activeAppVersion || '';
        currentReleasesList = data.releases || [];

        const badgesEl = document.getElementById('activeReleasesBadges');
        if (badgesEl) {
          const isRu = currentLang === 'ru';
          const extText = currentActiveExtVer ? `Ext: v${esc(currentActiveExtVer)}` : (isRu ? 'Расширение: нет' : 'Ext: none');
          const appText = currentActiveAppVer ? `App: v${esc(currentActiveAppVer)}` : (isRu ? 'Десктоп: нет' : 'App: none');
          badgesEl.innerHTML = `
            <span class="badge badge-action-proxy" title="${isRu ? 'Активная версия расширения' : 'Active extension version'}">🧩 ${extText}</span>
            <span class="badge badge-success" style="margin-left: 6px;" title="${isRu ? 'Активная версия десктоп-агента' : 'Active desktop app version'}">💻 ${appText}</span>
          `;
        }

        renderReleasesTable();
      } catch (err) {
        console.error('Error loading releases:', err);
      }
    }

    function filterReleases() {
      renderReleasesTable();
    }

    function renderReleasesTable() {
      const tbody = document.getElementById('releasesTableBody');
      if (!tbody) return;

      const isRu = currentLang === 'ru';
      const filterEl = document.getElementById('releasesFilterType');
      const filterType = filterEl ? filterEl.value : 'all';

      let list = currentReleasesList || [];
      if (filterType !== 'all') {
        list = list.filter(r => r.type === filterType);
      }

      if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 18px;">${isRu ? 'Релизов не найдено. Соберите CRX в Конструкторе или ZIP в Конструкторе приложения.' : 'No releases found. Build CRX in Extension Builder or ZIP in App Studio.'}</td></tr>`;
        return;
      }

      // Sort descending by builtAt
      const sorted = [...list].sort((a, b) => {
        const timeA = new Date(a.builtAt || 0).getTime();
        const timeB = new Date(b.builtAt || 0).getTime();
        return timeB - timeA;
      });

      const rows = sorted.map(rel => {
        const isExtension = rel.type === 'extension';
        const typeBadge = isExtension
          ? `<span class="badge badge-action-proxy">🧩 ${isRu ? 'Расширение' : 'Extension'}</span>`
          : `<span class="badge badge-success">💻 ${isRu ? 'Десктоп' : 'Desktop App'}</span>`;

        const isActive = Boolean(rel.isActive || rel.active);
        const statusBadge = isActive
          ? `<span class="badge badge-success" style="font-weight: 700;">● ${isRu ? 'АКТИВНА' : 'ACTIVE'}</span>`
          : `<span class="badge badge-offline" style="opacity: 0.7;">${isRu ? 'В архиве' : 'Archived'}</span>`;

        const builtDate = rel.builtAt
          ? new Date(rel.builtAt).toLocaleString(isRu ? 'ru-RU' : 'en-US', { hour12: false })
          : '—';

        const shaDisplay = rel.sha256
          ? `<span style="font-family: var(--mono); font-size: 11px;" title="${esc(rel.sha256)}">${esc(rel.sha256.slice(0, 10))}…</span>`
          : '—';

        const rollbackBtn = isActive
          ? `<button class="btn btn-sm btn-secondary" disabled style="opacity: 0.5; font-size: 11px; padding: 3px 8px;">${isRu ? 'Активна' : 'Active'}</button>`
          : `<button class="btn btn-sm btn-primary btn-set-active-release" data-type="${esc(rel.type)}" data-version="${esc(rel.version)}" style="font-size: 11px; padding: 3px 8px;" title="${isRu ? 'Откатить/переключить на эту версию' : 'Rollback/switch to this version'}">${isRu ? 'Сделать активной' : 'Set Active'}</button>`;

        const downloadBtn = `<button class="btn btn-sm btn-secondary btn-download-release" data-type="${esc(rel.type)}" data-version="${esc(rel.version)}" data-filename="${esc(rel.fileName || '')}" style="font-size: 11px; padding: 3px 8px; display: inline-flex; align-items: center; gap: 4px;" title="${isRu ? 'Скачать архив релиза' : 'Download release package'}">${isRu ? 'Скачать' : 'Download'}</button>`;

        const deleteBtn = isActive
          ? ''
          : `<button class="btn btn-sm btn-danger btn-delete-release" data-type="${esc(rel.type)}" data-version="${esc(rel.version)}" style="font-size: 11px; padding: 3px 6px;" title="${isRu ? 'Удалить из архива' : 'Delete release'}">✕</button>`;

        return `<tr>
          <td>${typeBadge}</td>
          <td style="font-weight: 600; font-family: var(--mono);">v${esc(rel.version)}</td>
          <td style="font-size: 12px; color: var(--text-muted);">${builtDate}</td>
          <td>${shaDisplay}</td>
          <td>${statusBadge}</td>
          <td>
            <div style="display: flex; gap: 6px; align-items: center;">
              ${rollbackBtn}
              ${downloadBtn}
              ${deleteBtn}
            </div>
          </td>
        </tr>`;
      }).join('');

      tbody.innerHTML = rows;
    }

    async function setActiveReleaseVersion(type, version) {
      const isRu = currentLang === 'ru';
      const label = type === 'extension' ? (isRu ? 'расширения' : 'extension') : (isRu ? 'десктоп-агента' : 'desktop app');
      const confirmMsg = isRu
        ? `Переключить активную версию ${label} на v${version} (откат)?`
        : `Switch active ${label} version to v${version} (rollback)?`;
      if (!confirm(confirmMsg)) return;

      try {
        const res = await adminFetch('/api/releases/set-active', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, version })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          toast(isRu ? `Активная версия ${label} изменена на v${version}` : `Active ${label} version switched to v${version}`, 'success');
          await loadReleases();
        } else {
          toast(data.error || (isRu ? 'Ошибка смены активной версии' : 'Failed to switch active release'), 'error');
        }
      } catch (e) {
        console.error('Error switching active release:', e);
        toast(isRu ? 'Сетевая ошибка при смене версии' : 'Network error switching active release', 'error');
      }
    }

    async function deleteReleaseVersion(type, version) {
      const isRu = currentLang === 'ru';
      const confirmMsg = isRu
        ? `Удалить релиз ${type} v${version} из архива?`
        : `Delete release ${type} v${version} from archive?`;
      if (!confirm(confirmMsg)) return;

      try {
        const res = await adminFetch(`/api/releases/${encodeURIComponent(type)}/${encodeURIComponent(version)}`, {
          method: 'DELETE'
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          toast(isRu ? `Релиз v${version} удален` : `Release v${version} deleted`, 'success');
          await loadReleases();
        } else {
          toast(data.error || (isRu ? 'Ошибка удаления релиза' : 'Failed to delete release'), 'error');
        }
      } catch (e) {
        console.error('Error deleting release:', e);
        toast(isRu ? 'Сетевая ошибка при удалении релиза' : 'Network error deleting release', 'error');
      }
    }

    async function downloadReleaseVersion(type, version, fileName) {
      const isRu = currentLang === 'ru';
      toast((isRu ? 'Скачивание релиза v' : 'Downloading release v') + version + '...', 'info');
      try {
        const res = await adminFetch(`/api/releases/download/${encodeURIComponent(type)}/${encodeURIComponent(version)}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          toast((isRu ? 'Ошибка скачивания: ' : 'Download error: ') + (err.error || ('HTTP ' + res.status)), 'error');
          return;
        }
        const blob = await res.blob();
        const downloadFileName = fileName || (type === 'extension' ? 'pec-extension.crx' : 'pec-client-windows-x64.zip');
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = downloadFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      } catch (e) {
        toast((isRu ? 'Ошибка скачивания: ' : 'Download failed: ') + e.message, 'error');
      }
    }

    window.loadReleases = loadReleases;
    window.filterReleases = filterReleases;
    window.setActiveReleaseVersion = setActiveReleaseVersion;
    window.deleteReleaseVersion = deleteReleaseVersion;
    window.downloadReleaseVersion = downloadReleaseVersion;

    function refreshAll() {
      try {
        const savedLayout = localStorage.getItem('pec_server_layout') || 'console';
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
      loadAppStudioConfig();
      loadExtensionFiles();
      fetchFleet();
      fetchExtensionInfo();
      fetchRotationConfig();
      fetchProxies();
      fetchProxyConfig();
      load3xuiPanels();
      loadReleases();
    }

    (async function initAuth() {
      try {
        const savedLayout = localStorage.getItem('pec_server_layout') || 'console';
        setServerLayout(savedLayout);
        const savedTheme = localStorage.getItem('pec_server_theme') || 'cyber';
        setServerTheme(savedTheme);
        const savedLang = localStorage.getItem('pec_lang') || 'ru';
        setLanguage(savedLang);
      } catch (e) {}

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

      // 3x-ui Panels registry modal buttons
      const btnOpenPanel = document.getElementById('btnOpenAdd3xuiPanel');
      if (btnOpenPanel) btnOpenPanel.addEventListener('click', () => openAdd3xuiPanelModal());
      const btnSavePanel = document.getElementById('btnSave3xuiPanel');
      if (btnSavePanel) btnSavePanel.addEventListener('click', save3xuiPanelAction);
      const btnCancelPanel = document.getElementById('btnCancel3xuiPanel');
      if (btnCancelPanel) btnCancelPanel.addEventListener('click', close3xuiPanelModal);

      // 3x-ui Panels table actions delegation
      document.addEventListener('click', function(e) {
        const testBtn = e.target.closest('.btn-test-panel');
        if (testBtn) {
          const id = testBtn.getAttribute('data-id');
          if (id) test3xuiPanelAction(id);
          return;
        }
        const editBtn = e.target.closest('.btn-edit-panel');
        if (editBtn) {
          const id = editBtn.getAttribute('data-id');
          const panel = currentPanelsList.find(p => p.id === id);
          if (panel) openAdd3xuiPanelModal(panel);
          return;
        }
        const delBtn = e.target.closest('.btn-delete-panel');
        if (delBtn) {
          const id = delBtn.getAttribute('data-id');
          if (id) delete3xuiPanelAction(id);
          return;
        }
      });

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
      // Global click feedback handler - makes any button click visually confirmed in the current theme
      document.addEventListener('click', function(e) {
        const btn = e.target.closest('button, .btn, .tab-btn, .studio-layout-btn, .studio-mode-btn, .preset-chip');
        if (!btn) return;
        btn.classList.remove('btn-clicked');
        void btn.offsetWidth; // trigger reflow
        btn.classList.add('btn-clicked');
        setTimeout(() => {
          btn.classList.remove('btn-clicked');
        }, 400);
      });

      // Setup Step 1 & 2 Event Listeners
      const btnVerify = document.getElementById('btnAuthVerifyToken');
      if (btnVerify) btnVerify.addEventListener('click', handleAuthVerifyToken);
      const tokenInp = document.getElementById('authTokenInput');
      if (tokenInp) tokenInp.addEventListener('keydown', function(e) { if (e.key === 'Enter') handleAuthVerifyToken(); });

      const btnSaveCreds = document.getElementById('btnAuthSaveCredentials');
      if (btnSaveCreds) btnSaveCreds.addEventListener('click', handleAuthSaveCredentials);
      const passConfInp = document.getElementById('authNewPasswordConfirm');
      if (passConfInp) passConfInp.addEventListener('keydown', function(e) { if (e.key === 'Enter') handleAuthSaveCredentials(); });

      // First entry: check auth status (setup required? authenticated?)
      try {
        const res = await fetch('/api/auth/status', { credentials: 'same-origin' });
        const data = await res.json();
        if (data && data.authenticated) {
          hideAuthScreen();
          bootDashboard();
          return;
        }
        if (data && data.setupRequired) {
          showAuthStep('token');
          return;
        }
      } catch (e) {
        console.warn('Auth status check failed:', e);
      }
      showAuthStep('login');
    })();
