import { getAppVersion } from "../version.js";

export interface DashboardViewOptions {
  isDefaultTokenInUse?: boolean;
  /** @deprecated Unused in HTML rendering, retained for backwards compatibility */
  port?: number;
}

export function renderDashboardHtml(options: DashboardViewOptions = {}): string {
  const { isDefaultTokenInUse = false } = options;
  const currentVersion = getAppVersion();
    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PEC - Proxy Extension Corp</title>
  <meta name="description" content="Enterprise proxy synchronization server, live extension builder studio, GPO policies &amp; 3x-ui rotator" />
  <meta property="og:title" content="PEC - Proxy Extension Corp" />
  <meta property="og:description" content="Enterprise proxy synchronization server, live extension builder studio, GPO policies &amp; 3x-ui rotator" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="alternate icon" type="image/x-icon" href="/favicon.ico" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="stylesheet" href="/dashboard.css">
</head>
<body data-layout="console" data-theme="cyber">
  <div class="container">
    <header>
      <div>
        <h1 id="appTitle" style="font-size: 22px; font-weight: 700; display: flex; align-items: center; gap: 8px;">
          <span id="dashboardBrandIcon" style="font-size: 22px; line-height: 1;">🛡️</span>
          <span data-i18n="appTitle">PEC - Proxy Extension Corp</span>
        </h1>
        <p id="appSubtitle" style="font-size: 14px; color: var(--text-muted);" data-i18n="appSubtitle">Enterprise Proxy Synchronization</p>
      </div>
      <div class="header-controls">
        <!-- 1. Refresh All (Icon Only - far left) -->
        <button id="btnRefreshAll" onclick="refreshAll()" class="btn-icon" data-i18n-title="btnRefreshAllTitle" title="Обновить всё">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
          </svg>
        </button>

        <!-- 2. Server Customization (Palette Icon) & Language Switcher -->
        <div style="position: relative; display: inline-block;">
          <button type="button" id="btnCustomization" onclick="toggleCustomizationPopover(event)" class="btn-icon" data-i18n-title="btnCustomizationTitle" title="Кастомизация оформления">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/>
              <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>
              <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>
              <circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>
              <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>
            </svg>
          </button>

          <!-- Compact Floating Customization Popover -->
          <div id="popoverCustomization" class="customization-popover" style="display: none;" onclick="event.stopPropagation()">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid var(--border);">
              <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted);" data-i18n="popoverTitle">Внешний вид</span>
              <button type="button" onclick="closeCustomizationPopover()" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; font-size: 16px; padding: 0 4px; line-height: 1;">&times;</button>
            </div>

            <!-- 1. Layout switcher (Compact Console & Cyber Terminal) -->
            <div style="margin-bottom: 10px;">
              <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;" data-i18n="lblSettingsLayout">Макет панели:</div>
              <div class="grid-form-2col" style="gap: 6px;">
                <button type="button" id="optLayoutConsoleCard" class="popover-layout-btn" onclick="setServerLayout('console')">
                  <span style="font-size: 11px; font-weight: 600;">Console</span>
                </button>
                <button type="button" id="optLayoutTerminalCard" class="popover-layout-btn" onclick="setServerLayout('terminal')">
                  <span style="font-size: 11px; font-weight: 600;">Terminal</span>
                </button>
              </div>
            </div>

            <!-- 2. Dark / Light Mode Switcher (День / Ночь) -->
            <div style="margin-bottom: 10px;">
              <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;" data-i18n="lblSettingsThemeMode">Режим темы:</div>
              <div class="grid-form-2col" style="gap: 6px;">
                <button type="button" id="optModeDarkCard" class="popover-layout-btn active" onclick="setServerThemeMode('dark')">
                  <span style="font-size: 11px; font-weight: 600;" data-i18n="lblThemeDark">🌙 Темная</span>
                </button>
                <button type="button" id="optModeLightCard" class="popover-layout-btn" onclick="setServerThemeMode('light')">
                  <span style="font-size: 11px; font-weight: 600;" data-i18n="lblThemeLight">☀️ Светлая</span>
                </button>
              </div>
            </div>

            <!-- 3. Color palettes -->
            <div style="margin-bottom: 10px;">
              <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;" data-i18n="lblSettingsTheme">Цветовая гамма:</div>
              <div style="display: flex; gap: 6px; justify-content: space-between;">
                <button type="button" class="popover-theme-dot" id="btnThemeCyber" onclick="setServerTheme('cyber')" title="Cyber Blue">
                  <span style="background: #38bdf8;"></span>
                </button>
                <button type="button" class="popover-theme-dot" id="btnThemeObsidian" onclick="setServerTheme('obsidian')" title="Obsidian Minimal">
                  <span style="background: #c084fc;"></span>
                </button>
                <button type="button" class="popover-theme-dot" id="btnThemeNord" onclick="setServerTheme('nord')" title="Nordic Arctic">
                  <span style="background: #88c0d0;"></span>
                </button>
                <button type="button" class="popover-theme-dot" id="btnThemeEmerald" onclick="setServerTheme('emerald')" title="Emerald SecOps">
                  <span style="background: #34d399;"></span>
                </button>
                <button type="button" class="popover-theme-dot" id="btnThemeLight" onclick="setServerTheme('light')" title="Enterprise Light">
                  <span style="background: #2563eb; border: 1px solid #cbd5e1;"></span>
                </button>
              </div>
            </div>

            <!-- 4. Global Corporate Brand Icon & Sync With Apps -->
            <div style="margin-bottom: 10px; padding-top: 8px; border-top: 1px dashed var(--border);">
              <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;" data-i18n="lblGlobalBrandIcon">Корпоративный значок:</div>
              <!-- Icon source toggle: Emoji vs Custom logo -->
              <div class="grid-form-2col" style="gap: 6px; margin-bottom: 6px;">
                <button type="button" id="optBrandIconPreset" class="popover-layout-btn active" onclick="setGlobalBrandIconSource('preset')">
                  <span style="font-size: 11px; font-weight: 600;" data-i18n="lblBrandIconPreset">Эмодзи</span>
                </button>
                <button type="button" id="optBrandIconCustom" class="popover-layout-btn" onclick="setGlobalBrandIconSource('custom')">
                  <span style="font-size: 11px; font-weight: 600;" data-i18n="lblBrandIconCustom">Свой логотип</span>
                </button>
              </div>

              <!-- Preset Emoji Container -->
              <div id="boxBrandIconPreset" style="display: block; margin-bottom: 6px;">
                <select id="globalBrandIconSelect" onchange="setGlobalBrandIcon(this.value)" style="width: 100%; font-size: 11.5px; padding: 4px 6px; border: 1px solid var(--border); border-radius: 6px; background: var(--card-inner); color: var(--text); margin-bottom: 0;">
                  <option value="shield">🛡️ Щит (Защита)</option>
                  <option value="network">🌐 Сеть (Сфера)</option>
                  <option value="terminal">💻 Терминал (Консоль)</option>
                  <option value="lock">🔒 Замок (VPN / Безопасность)</option>
                  <option value="rocket">🚀 Ракета (Скорость)</option>
                </select>
              </div>

              <!-- Custom PNG / Image Upload Container -->
              <div id="boxBrandIconCustom" style="display: none; margin-bottom: 6px;">
                <div style="display: flex; gap: 6px; align-items: center;">
                  <input type="file" id="globalBrandIconFileInput" accept="image/png,image/jpeg,image/webp,image/svg+xml" style="display:none;" onchange="onGlobalBrandIconFileSelected(event)" />
                  <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('globalBrandIconFileInput').click()" style="font-size: 11px; padding: 4px 8px; height: 28px; flex: 1; justify-content: center; display: inline-flex; align-items: center; gap: 5px;">
                    <img src="/icons/folder.png" class="icon-inline" alt="folder">
                    <span data-i18n="btnUploadCorporateIcon">Загрузить логотип (PNG / SVG)</span>
                  </button>
                  <div id="globalBrandCustomPreviewBox" style="display: none; align-items: center; gap: 4px;">
                    <img id="globalBrandCustomPreviewImg" src="" alt="Icon preview" style="width: 24px; height: 24px; border-radius: 4px; object-fit: contain; border: 1px solid var(--border); background: rgba(0,0,0,0.2);" />
                    <button type="button" class="btn btn-sm" onclick="clearGlobalBrandCustomIcon()" title="Удалить логотип" style="padding: 2px 5px; font-size: 10px; background: transparent; border: 1px solid var(--border); color: var(--text-muted); cursor: pointer;"><img src="/icons/cross.png" class="icon-inline-sm" alt="del"></button>
                  </div>
                </div>
              </div>

              <label for="chkSyncThemeWithApps" style="display: flex; align-items: flex-start; gap: 8px; cursor: pointer; font-size: 11px; color: var(--text); user-select: none;">
                <input type="checkbox" id="chkSyncThemeWithApps" checked onchange="toggleSyncThemeWithApps(this.checked)" style="margin-top: 2px;" />
                <span data-i18n="lblSyncThemeWithApps">Синхронизировать тему и значок с расширениями и приложениями</span>
              </label>
            </div>

            <!-- 5. Account (dashboard login credentials) -->
            <div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--border);">
              <button type="button" id="btnOpenCredsModal" class="popover-layout-btn" style="width: 100%;">
                <img src="/icons/key.png" class="icon-inline" alt="key"> <span style="font-size: 11px; font-weight: 600;">Сменить логин / пароль</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Quick Language Switcher -->
        <div class="lang-switcher">
          <button type="button" id="btnLangEn" class="lang-btn" onclick="setLanguage('en')">EN</button>
          <div class="lang-divider"></div>
          <button type="button" id="btnLangRu" class="lang-btn active" onclick="setLanguage('ru')">RU</button>
        </div>

        <!-- 3. Version Badge with GitHub Updates Popover & GitHub Link -->
        <div style="position: relative; display: inline-block;">
          <span id="versionReleaseBadge" data-server-version="${currentVersion}" class="header-badge" onclick="toggleVersionPopover(event)" title="PEC Server v${currentVersion} &amp; Релизы GitHub" style="cursor: pointer; position: relative;">v${currentVersion}</span>
          <span id="versionUpdateDot" style="display: none; position: absolute; top: -3px; right: -3px; width: 8px; height: 8px; background: #f59e0b; border-radius: 50%; box-shadow: 0 0 5px #f59e0b; pointer-events: none;"></span>

          <!-- Compact GitHub Version Popover -->
          <div id="popoverVersionRelease" class="customization-popover" style="display: none; width: 300px; right: 0; left: auto;" onclick="event.stopPropagation()">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid var(--border);">
              <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted);" data-i18n="titleGhVersionControl">Версии и релизы GitHub</span>
              <button type="button" onclick="closeVersionPopover()" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; font-size: 16px; padding: 0 4px; line-height: 1;">&times;</button>
            </div>
            <div id="headerGhReleaseContent">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-size: 11.5px; color: var(--text-muted);">Текущая: <strong style="color: var(--primary);">v${currentVersion}</strong></span>
                <span id="hdrGhUpdateBadge" class="badge badge-online" style="font-size: 10px;">Проверка...</span>
              </div>
              <div id="hdrGhLatestInfo" style="font-size: 11.5px; margin-bottom: 8px; color: var(--text);"></div>
              <div id="hdrGhReleasesList" style="max-height: 120px; overflow-y: auto; background: var(--bg-card-subtle); border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px; margin-bottom: 8px; font-size: 11px;"></div>
              <div style="display: flex; justify-content: space-between; gap: 6px; pt: 6px; border-top: 1px solid var(--border);">
                <button type="button" onclick="refreshGitHubReleasesNow()" class="btn-secondary" style="font-size: 11px; padding: 4px 8px; flex: 1;" data-i18n="btnCheckGhReleases">Проверить</button>
                <a href="https://github.com/vlv-code/PEC/releases" target="_blank" rel="noopener noreferrer" class="btn-secondary" style="font-size: 11px; padding: 4px 8px; text-decoration: none;">GitHub Релизы</a>
              </div>
            </div>
          </div>
        </div>

        <!-- GitHub Repository Link -->
        <a href="https://github.com/vlv-code/PEC" target="_blank" rel="noopener noreferrer" id="btnGithubLink" class="btn-icon" data-i18n-title="btnGithubTitle" title="GitHub: vlv-code/PEC">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
            <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
          </svg>
        </a>

        <!-- 4. Minimized Pulsing Status Dot with Tooltip -->
        <span class="badge-status-dot" id="gatewayStatusIndicator" title="Шлюз активен" data-i18n-title="statusGatewayActive">
          <span class="dot"></span>
        </span>

        <!-- 5. Log out (Icon Only - far right) -->
        <button id="btnLogout" class="btn-icon" data-i18n-title="btnLogoutTitle" title="Выйти">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </button>
      </div>
    </header>
    ${isDefaultTokenInUse ? `
    <div style="background: rgba(239, 68, 68, 0.12); border: 1px solid #ef4444; border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px;">
      <div style="display: flex; align-items: center; gap: 10px;">
        <img src="/icons/warning.png" class="icon-inline-lg" alt="warning">
        <span style="font-size: 12px; color: #fca5a5;">
          <strong>Security Warning:</strong> The server is running with the default shared token (see <code>EXT_SHARED_TOKEN</code> in <code>.env.example</code>). Please set a unique, secure <strong>EXT_SHARED_TOKEN</strong> in your <strong>.env</strong> file.
        </span>
      </div>
      <span class="badge badge-action-block" style="font-size: 10px;">DEFAULT TOKEN IN USE</span>
    </div>
    ` : ""}

    <!-- Top quick overview banner -->
    <div class="banner">
      <div>
        <strong id="lblHdrFleet" data-i18n="lblHdrFleet">Подключенные устройства:</strong> <span id="hdrFleetCount">0 активных</span> &bull; 
        <strong id="lblHdrUser" data-i18n="lblHdrUser">Текущий пользователь:</strong> <code id="hdrUser">corp-user</code> &bull; 
        <strong id="lblHdrProfile" data-i18n="lblHdrProfile">Активный PAC профиль:</strong> <span id="hdrActiveProfile" style="color: var(--primary);">Direct Default</span> &bull;
        <strong id="lblHdrRot" data-i18n="lblHdrRot">Следующая ротация:</strong> <span id="hdrNextRot">Расчет...</span>
      </div>
      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        <button id="btnRotateNow" onclick="manualRotate()" style="font-size: 12px; padding: 6px 12px;" data-i18n="btnRotateNow">Ротировать пароль сейчас</button>
        <button id="btnKillSwitch" onclick="toggleKillSwitch()" class="btn-secondary" style="font-size: 12px; padding: 6px 12px;" data-i18n="btnKillSwitchOff">Kill-Switch: ВЫКЛ</button>
      </div>
    </div>

    <!-- Navigation Tabs -->
    <div class="tabs-nav" role="tablist" aria-label="Панель навигации">
      <button id="tabBtnRouting" class="tab-btn active" role="tab" aria-selected="true" aria-controls="tab-routing" tabindex="0" onclick="switchTab('routing')" data-tab="routing" data-i18n="tabBtnRouting"><img src="/icons/routing.png" class="icon-inline" alt="routing"> Маршрутизация и геобазы</button>
      <button id="tabBtnProxySettings" class="tab-btn" role="tab" aria-selected="false" aria-controls="tab-proxy-settings" tabindex="-1" onclick="switchTab('proxy-settings')" data-tab="proxy-settings" data-i18n="tabBtnProxySettings"><img src="/icons/server.png" class="icon-inline" alt="proxy"> Настройки прокси</button>
      <button id="tabBtnBuilder" class="tab-btn" role="tab" aria-selected="false" aria-controls="tab-builder" tabindex="-1" onclick="switchTab('builder')" data-tab="builder" data-i18n="tabBtnBuilder"><img src="/icons/palette.png" class="icon-inline" alt="builder"> Конструктор расширения</button>
      <button id="tabBtnAppStudio" class="tab-btn" role="tab" aria-selected="false" aria-controls="tab-app-studio" tabindex="-1" onclick="switchTab('app-studio')" data-tab="app-studio" data-i18n="tabBtnAppStudio"><img src="/icons/desktop.png" class="icon-inline" alt="app"> Конструктор приложения</button>
      <button id="tabBtnInstances" class="tab-btn" role="tab" aria-selected="false" aria-controls="tab-instances" tabindex="-1" onclick="switchTab('instances')" data-tab="instances" data-i18n="tabBtnInstances"><img src="/icons/devices.png" class="icon-inline" alt="fleet"> Флот</button>
      <button id="tabBtnGpo" class="tab-btn" role="tab" aria-selected="false" aria-controls="tab-gpo" tabindex="-1" onclick="switchTab('gpo')" data-tab="gpo" data-i18n="tabBtnGpo"><img src="/icons/building.png" class="icon-inline" alt="gpo"> Развертывание GPO</button>
      <button id="tabBtnReleases" class="tab-btn" role="tab" aria-selected="false" aria-controls="tab-releases" tabindex="-1" onclick="switchTab('releases')" data-tab="releases" data-i18n="tabBtnReleases"><img src="/icons/package.png" class="icon-inline" alt="releases"> Релизы и версионирование</button>
      <button id="tabBtnLogs" class="tab-btn" role="tab" aria-selected="false" aria-controls="tab-logs" tabindex="-1" onclick="switchTab('logs')" data-tab="logs" data-i18n="tabBtnLogs"><img src="/icons/logs.png" class="icon-inline" alt="logs"> Аудит и тестирование</button>
    </div>

    <!-- ==================== TAB 1: ROUTING & GEOBASES ==================== -->
    <div id="tab-routing" class="tab-pane active" role="tabpanel" tabindex="0" aria-labelledby="tabBtnRouting">
      <!-- Routing Switcher (Extensions vs Desktop App) -->
      <div style="display: flex; gap: 8px; margin-bottom: 16px; background: var(--bg-card-subtle, rgba(255,255,255,0.03)); padding: 6px; border-radius: 8px; border: 1px solid var(--border);">
        <button type="button" id="btnBranchExt" class="tab-btn active" onclick="switchRoutingBranch('ext')" style="flex: 1; justify-content: center; font-size: 13px; font-weight: 600; padding: 8px 16px;">
          <img src="/icons/palette.png" class="icon-inline" alt="ext">
          <span data-i18n="branchExtTitle">Правила расширений браузера (Домены, URL, Геобазы)</span>
        </button>
        <button type="button" id="btnBranchApp" class="tab-btn" onclick="switchRoutingBranch('app')" style="flex: 1; justify-content: center; font-size: 13px; font-weight: 600; padding: 8px 16px;">
          <img src="/icons/desktop.png" class="icon-inline" alt="app">
          <span data-i18n="branchAppTitle">Правила приложения PEC-App (Процессы, L3/L4, WinDivert)</span>
        </button>
      </div>

      <!-- ==================== BRANCH 1: EXTENSION ROUTING MATRIX ==================== -->
      <div id="branchExtView">
      <div class="card">
        <h2>
          <span data-i18n="titleRoutingMatrix">Routing Profiles & Geo-Rules Matrix</span>
          <div style="display: flex; gap: 8px;">
            <select id="profileSelect" onchange="loadSelectedProfile()" style="margin-bottom: 0; font-size: 13px; width: auto;">
              <option value="">Loading profiles...</option>
            </select>
            <button onclick="createNewProfile()" class="btn-secondary" style="font-size: 12px;" data-i18n="btnNewProfile">+ New Profile</button>
          </div>
        </h2>

        <!-- Profile Metadata & Default Policy -->
        <div style="background: var(--card-inner); padding: 16px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 16px;">
          <div class="grid-routing-matrix-header">
            <div>
              <label for="profName" data-i18n="lblProfName">Profile Name</label>
              <input type="text" id="profName" style="margin-bottom: 0;" />
            </div>
            <div>
              <label for="profDefaultPolicy" data-i18n="lblDefaultPolicy">Default Traffic Policy</label>
              <select id="profDefaultPolicy" style="margin-bottom: 0;">
                <option value="direct" data-i18n="optPolicyDirect">DIRECT by Default (Selective Proxy)</option>
                <option value="proxy" data-i18n="optPolicyProxy">PROXY by Default (Full Tunnel)</option>
              </select>
            </div>
            <div>
              <label for="profTargetScope" data-i18n="lblTargetScope">Deployment Target Scope</label>
              <select id="profTargetScope" style="margin-bottom: 0;">
                <option value="all" data-i18n="optScopeAll">All Devices (Global Default)</option>
                <option value="group" data-i18n="optScopeGroup">Target AD / Device Group</option>
                <option value="instances" data-i18n="optScopeInstances">Specific Selected Instances</option>
              </select>
            </div>
          </div>

          <div id="groupTargetRow" style="display: none; margin-bottom: 10px;">
            <label for="profTargetGroup" data-i18n="lblTargetGroup">Target Group Name</label>
            <input type="text" id="profTargetGroup" placeholder="e.g. SEC-Proxy-VPN-VIP or Dev-Team" data-i18n-ph="phTargetGroup" style="margin-bottom: 0;" />
          </div>

          <div id="instancesTargetRow" style="display: none; margin-bottom: 10px;">
            <label for="profTargetInstancesList" data-i18n="lblTargetInstances">Target Instances</label>
            <div id="profTargetInstancesList" style="max-height: 140px; overflow-y: auto; border: 1px solid var(--border); border-radius: 6px; padding: 8px; background: var(--bg-card-subtle);">
              <!-- Checkboxes for available instances rendered dynamically -->
            </div>
          </div>

          <div style="margin-bottom: 12px;">
            <label for="profFailClosed" style="display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px;">
              <input type="checkbox" id="profFailClosed" style="margin: 0; width: 16px; height: 16px;" />
              <span data-i18n="lblFailClosed">Fail-Closed: Prevent direct fallback (DIRECT) if proxy drops (avoids IP leak)</span>
            </label>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
            <p style="font-size: 12px; color: var(--text-muted);" id="profDesc" data-i18n="profDescDefault">
              Routing policy applied to matching browser instances.
            </p>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span id="unsavedChangesBadge" class="unsaved-badge" style="display: none;"><img src="/icons/warning.png" class="icon-inline-sm" alt="warn"> <span data-i18n="lblUnsavedChanges">Unsaved Changes</span></span>
              <button onclick="saveCurrentProfile()" data-i18n="btnSaveProfile">Save Routing Profile</button>
              <button onclick="deleteCurrentProfile()" class="btn-danger" style="font-size: 12px;" data-i18n="btnDeleteProfile">Delete Profile</button>
              <a id="btnPacPreview" href="/proxy.pac" target="_blank" class="btn-secondary" style="font-size: 12px;" data-i18n="btnPacPreview">View PAC Script</a>
            </div>
          </div>
        </div>

        <!-- Quick Add GeoBase Presets -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <h3 style="font-size: 14px; font-weight: 600; margin-bottom: 0; color: var(--text);" data-i18n="titleGeoPresets">
            Quick Add GeoBase & Domain Bundles
          </h3>
          <button type="button" onclick="openImportPresetsModal()" class="btn-secondary" style="font-size: 12px; padding: 4px 10px;" data-i18n="btnImportPresets">
            <img src="/icons/download.png" class="icon-inline" alt="import"> + Import Presets (.dat / .txt)
          </button>
        </div>
        <div class="presets-grid" id="presetsContainer">
          <!-- Dynamically populated -->
        </div>

        <!-- Custom Rule Adder -->
        <div style="background: var(--card-inner); padding: 14px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 16px;">
          <h4 style="font-size: 13px; font-weight: 600; margin-bottom: 10px;" data-i18n="titleCustomRule">Add Custom Domain / Subnet Rule</h4>
          <div class="grid-routing-rule-form">
            <div>
              <label for="newRuleName" data-i18n="lblRuleName">Rule Name</label>
              <input type="text" id="newRuleName" placeholder="My Custom Rule" data-i18n-ph="phRuleName" style="margin-bottom: 0;" />
            </div>
            <div>
              <label for="newRulePattern" data-i18n="lblRulePattern">Pattern (comma separated domains or CIDRs)</label>
              <input type="text" id="newRulePattern" placeholder="*.example.com, target-domain.org, 10.50.0.0/16" data-i18n-ph="phRulePattern" style="margin-bottom: 0;" />
            </div>
            <div>
              <label for="newRuleAction" data-i18n="lblRuleAction">Action</label>
              <select id="newRuleAction" style="margin-bottom: 0;">
                <option value="proxy" data-i18n="optActionProxy">PROXY</option>
                <option value="direct" data-i18n="optActionDirect">DIRECT</option>
                <option value="block" data-i18n="optActionBlock">BLOCK (Sinkhole)</option>
              </select>
            </div>
            <div>
              <button onclick="addCustomRule()" style="height: 38px;" data-i18n="btnAddRule">+ Add Rule</button>
            </div>
          </div>
        </div>

        <!-- Active Rules Table -->
        <h3 style="font-size: 14px; font-weight: 600; margin-bottom: 10px; color: var(--text);" data-i18n="titleActiveRules">
          Active Profile Rules Hierarchy (Evaluated Top-to-Bottom)
        </h3>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th style="width: 40px;" data-i18n="thStatus">Status</th>
                <th style="width: 70px;" data-i18n="thOrder">
                  Order
                  <span style="display: none;">
                    <button type="button" class="btn-reorder-up" title="Move Up">▲</button>
                    <button type="button" class="btn-reorder-down" title="Move Down">▼</button>
                  </span>
                </th>
                <th data-i18n="thRuleName">Rule Name</th>
                <th data-i18n="thPattern">Pattern / Preset</th>
                <th data-i18n="thAction">Action</th>
                <th style="width: 170px;" data-i18n="thActions">Actions</th>
              </tr>
            </thead>
            <tbody id="rulesTableBody">
              <tr><td colspan="6" style="text-align: center; color: var(--text-muted);" data-i18n="txtNoRules">No rules defined for this profile.</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      </div>

      <!-- ==================== DESKTOP APP PROCESS & L3/L4 RULES ==================== -->
      <div id="branchAppView" style="display: none;">
        <div class="card">
          <h2>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span data-i18n="titleAppRoutingBranch">Правила приложения PEC-App (L3/L4 & Процессы)</span>
              <span class="badge badge-active" style="font-size: 11px;">WinDivert / Packet Filter</span>
            </div>
            <div style="display: flex; gap: 8px;">
              <button type="button" id="btnSaveAppRulesBranch" onclick="saveAppRulesBranch()" style="font-size: 12px; background: var(--primary);" data-i18n="btnSaveAppRules">
                💾 Сохранить правила десктоп-агента
              </button>
            </div>
          </h2>

          <div style="background: var(--card-inner); padding: 14px 16px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 16px;">
            <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap;">
              <div style="flex: 1; min-width: 280px;">
                <label for="branchAppIncludeExtensionRules" style="display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; font-weight: 600;">
                  <input type="checkbox" id="branchAppIncludeExtensionRules" style="margin: 0; width: 16px; height: 16px;" onchange="onBranchAppIncludeExtRulesChange()" />
                  <span data-i18n="lblIncludeExtensionRules">Опционально подмешивать доменные правила расширений в десктоп-агент</span>
                </label>
                <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 4px; line-height: 1.4;">
                  По умолчанию правила браузерных расширений <strong>отключены</strong> для десктопного приложения. В десктопе действуют изолированные правила фильтрации процессов и портов (L3/L4). При включении доменные правила расширений будут дополнительно транслироваться в приложение при синхронизации.
                </div>
              </div>
              <div id="branchAppInheritProfileContainer" style="min-width: 300px; display: none;">
                <div style="margin-bottom: 8px;">
                  <label for="branchAppInheritProfileSelect" style="font-size: 12px; font-weight: 600;" data-i18n="lblBranchAppInheritProfile">Профиль расширений для подмешивания:</label>
                  <select id="branchAppInheritProfileSelect" style="font-size: 12px; margin-bottom: 6px; width: 100%;" onchange="onBranchAppInheritProfileChange()">
                    <option value="">-- Наследовать по назначению флота --</option>
                  </select>
                  <select id="appRoutingProfileSelect" style="display: none;"></select>
                </div>
                <div style="margin-bottom: 6px;">
                  <div style="font-size: 11px; font-weight: 600; color: var(--text-muted); margin-bottom: 4px;">Режим применения правил:</div>
                  <div style="display: flex; gap: 14px; font-size: 11.5px;">
                    <label for="appRuleInheritModeAll" style="display: inline-flex; align-items: center; gap: 5px; cursor: pointer;">
                      <input type="radio" name="appRuleInheritMode" id="appRuleInheritModeAll" value="all" checked onchange="onAppRuleInheritModeChange()" />
                      <span>Целиком весь профиль</span>
                    </label>
                    <label for="appRuleInheritModeSpecific" style="display: inline-flex; align-items: center; gap: 5px; cursor: pointer;">
                      <input type="radio" name="appRuleInheritMode" id="appRuleInheritModeSpecific" value="specific" onchange="onAppRuleInheritModeChange()" />
                      <span>Выбрать конкретные правила</span>
                    </label>
                  </div>
                </div>
                <div id="branchAppSpecificRulesContainer" style="display: none; max-height: 150px; overflow-y: auto; background: var(--bg-card-subtle); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; margin-top: 6px;">
                  <!-- Dynamically populated checklist -->
                </div>
              </div>
            </div>
          </div>

          <!-- Quick Add / Actions -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-wrap: wrap; gap: 8px;">
            <div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center;">
              <span style="font-size: 11px; color: var(--text-muted);" data-i18n="lblQuickRules">Быстрые пресеты для десктопа:</span>
              <button type="button" class="btn-secondary" style="font-size: 11px; padding: 4px 8px;" onclick="applyAppRulePreset('blocked_sites')">🌐 Сайты через прокси (*.youtube.com, x.com)</button>
              <button type="button" class="btn-secondary" style="font-size: 11px; padding: 4px 8px;" onclick="applyAppRulePreset('browsers')">Браузеры Direct</button>
              <button type="button" class="btn-secondary" style="font-size: 11px; padding: 4px 8px;" onclick="applyAppRulePreset('devtools')">Разработка (curl, git, docker)</button>
              <button type="button" class="btn-secondary" style="font-size: 11px; padding: 4px 8px;" onclick="applyAppRulePreset('tunnel')">Полный туннель (*)</button>
            </div>
            <button type="button" onclick="addNewAppProcessRule()" class="btn-secondary" style="font-size: 12px; padding: 4px 10px;" data-i18n="btnAddAppRule">
              + Добавить правило процесса
            </button>
          </div>

          <!-- Desktop App Rules Table -->
          <div class="table-container">
            <table id="branchAppProcessRulesTable" style="width: 100%; font-size: 12px;">
              <thead>
                <tr>
                  <th style="width: 18%;">Процессы (Process)</th>
                  <th style="width: 26%;">Сайты / Домены (Target Domains)</th>
                  <th style="width: 18%;">IP / Сети (Target Hosts)</th>
                  <th style="width: 12%;">Порты (Ports)</th>
                  <th style="width: 10%;">Протокол</th>
                  <th style="width: 10%;">Действие</th>
                  <th style="width: 6%; text-align: center;">Удалить</th>
                </tr>
              </thead>
              <tbody id="branchAppProcessRulesBody">
                <!-- Dynamically rendered -->
              </tbody>
            </table>
          </div>

          <div style="margin-top: 12px; font-size: 11px; color: var(--text-muted); display: flex; justify-content: space-between; align-items: center;">
            <span>ℹ️ Правила десктопного агента автоматически синхронизируются с запущенными клиентами PEC-App и службой PECAppSvc каждые 30 секунд.</span>
            <span id="branchAppSaveStatus" style="font-weight: 600;"></span>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== TAB 2: PROXY SETTINGS & 3X-UI ==================== -->
    <div id="tab-proxy-settings" class="tab-pane" role="tabpanel" tabindex="0" aria-labelledby="tabBtnProxySettings">
      <!-- 0. Warning Banner for placeholder 10.0.0.1 (shown when no proxy is active) -->
      <div id="noActiveProxyWarning" style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.4); border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 6px; margin-bottom: 16px; display: none; align-items: flex-start; gap: 10px; font-size: 13px;">
        <img src="/icons/warning.png" class="icon-inline-lg" alt="warn">
        <div>
          <strong data-i18n="warnNoActiveProxyTitle">No active upstream proxy.</strong>
          <div data-i18n="warnNoActiveProxyDesc" style="margin-top: 2px;">Extensions are receiving placeholder <code>10.0.0.1:10809</code> and traffic will not flow. Add a proxy via "+ Add Manual Proxy" or "+ Add from 3x-ui" and click "Activate".</div>
        </div>
      </div>

      <!-- 1. Upstream Proxy Nodes Registry Card -->
      <div class="card" style="margin-bottom: 16px;">
        <h2>
          <span data-i18n="titleProxyRegistry">Proxy Registry</span>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button type="button" id="btnCheckAllProxies" onclick="checkAllProxies()" class="btn-secondary" style="font-size: 12px;" data-i18n="btnCheckAllProxies">⚡ Проверить все</button>
            <button type="button" id="btnAdd3xui" onclick="openAdd3xuiModal()" class="btn-secondary" style="font-size: 12px;" data-i18n="btnAdd3xui">+ Add from 3x-ui by Tag</button>
            <button type="button" id="btnAddManual" onclick="openAddManualModal()" style="font-size: 12px;" data-i18n="btnAddManual">+ Add Manual Proxy</button>
          </div>
        </h2>
        <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 14px;" data-i18n="subProxyRegistry">
          Manage upstream corporate proxy servers, tag-based sync with 3x-ui inbounds, and manual nodes.
        </p>

        <!-- Active PAC Directive Indicator Banner -->
        <div id="activePacDirectiveBanner" style="background: var(--card-inner); border: 1px solid var(--border); border-left: 4px solid var(--primary); padding: 10px 14px; border-radius: 6px; margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between; flex-wrap: gap: 8px; font-size: 13px;">
          <div>
            <strong data-i18n="lblActivePacDirective">Active PAC Directive:</strong>
            <code id="activePacDirectiveText" style="color: var(--primary); font-weight: 700; margin-left: 6px;">DIRECT</code>
          </div>
          <span id="activeProxyBadge" class="badge badge-offline" data-i18n="badgeNoActiveProxy">No Active Proxy</span>
        </div>

        <!-- Table Container -->
        <div class="table-container">
          <table id="proxiesTable">
            <thead>
              <tr>
                <th style="width: 70px; text-align: center;" data-i18n="thProxyActive">Active</th>
                <th data-i18n="thProxyTagName">Tag / Name</th>
                <th data-i18n="thProxyType">Type</th>
                <th data-i18n="thProxyProtocol">Protocol</th>
                <th data-i18n="thProxyHostPort">Host : Port</th>
                <th data-i18n="thProxyUser">User</th>
                <th data-i18n="thProxyStatus">Status</th>
                <th data-i18n="thProxyLatency">Latency</th>
                <th data-i18n="thProxyEgress">Egress IP / Geo</th>
                <th style="text-align: right;" data-i18n="thProxyActions">Actions</th>
              </tr>
            </thead>
            <tbody id="proxiesTableBody">
              <tr><td colspan="10" style="text-align: center; color: var(--text-muted);" data-i18n="txtNoProxies">Loading proxies...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 2. 3x-ui Multi-Panel Registry Card -->
      <div class="card" style="margin-bottom: 16px;">
        <h2>
          <span>Реестр серверов 3x-ui / 3x-ui Panels</span>
          <button type="button" id="btnOpenAdd3xuiPanel" class="btn btn-secondary" style="font-size: 12px;">+ Добавить панель 3x-ui</button>
        </h2>
        <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 14px;">
          Централизованное управление несколькими панелями 3x-ui для импорта нод и автоматической ротации.
        </p>

        <div class="table-container">
          <table id="panels3xuiTable">
            <thead>
              <tr>
                <th>Название</th>
                <th>URL панели</th>
                <th>Пользователь</th>
                <th>Статус TLS</th>
                <th style="text-align: right;">Действия</th>
              </tr>
            </thead>
            <tbody id="panels3xuiBody">
              <tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Загрузка панелей 3x-ui...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 3. 3x-ui Connection & Rotation Scheduler (grid-2) -->
      <div class="grid-2">
        <div class="card">
          <h2 data-i18n="title3xuiCreds">3x-ui API Credentials & Timing Scheduler</h2>
          <label for="rotPanelUrl" data-i18n="lbl3xuiPanelUrl">3x-ui Panel URL</label>
          <input type="text" id="rotPanelUrl" placeholder="https://3xui-host:2053/basepath" data-i18n-ph="phRotPanelUrl" />

          <div class="grid-form-2col">
            <div>
              <label for="rotAdminUser" data-i18n="lblAdminUser">Admin Username</label>
              <input type="text" id="rotAdminUser" placeholder="admin" data-i18n-ph="phRotAdminUser" />
            </div>
            <div>
              <label for="rotAdminPass" data-i18n="lblAdminPass">Admin Password</label>
              <input type="password" id="rotAdminPass" placeholder="••••••••" /><span id="passwordSavedBadge" class="badge badge-success" style="display: none; margin-left: 8px;">(Пароль сохранён на сервере)</span>
            </div>
          </div>

          <label for="rotRemark" data-i18n="lblInboundRemark">Target Inbound Remark</label>
          <input type="text" id="rotRemark" placeholder="squid-in" data-i18n-ph="phRotRemark" />

          <div class="grid-form-2-1">
            <div>
              <label for="rotInterval" data-i18n="lblRotInterval">Rotation Interval</label>
              <select id="rotInterval">
                <option value="15" data-i18n="optRot15">Every 15 minutes</option>
                <option value="60" data-i18n="optRot60">Every 1 hour</option>
                <option value="360" data-i18n="optRot360">Every 6 hours</option>
                <option value="720" data-i18n="optRot720">Every 12 hours</option>
                <option value="1440" selected data-i18n="optRot1440">Every 24 hours (Daily)</option>
              </select>
            </div>
            <div>
              <label for="rotEnabled" data-i18n="lblScheduler">Scheduler</label>
              <select id="rotEnabled">
                <option value="true" data-i18n="optSchedEnabled">Enabled (Auto)</option>
                <option value="false" data-i18n="optSchedDisabled">Disabled</option>
              </select>
            </div>
          </div>

          <label for="rotInsecureTls" style="display: flex; align-items: center; gap: 8px; font-size: 12px; margin-top: 8px; text-transform: none; font-weight: normal; cursor: pointer;">
            <input type="checkbox" id="rotInsecureTls" style="width: auto; margin-bottom: 0;" />
            <span data-i18n="lblInsecureTls">Allow Insecure / Self-Signed TLS</span>
          </label>

          <div style="display: flex; gap: 8px; margin-top: 10px;">
            <button onclick="saveRotationConfig()" data-i18n="btnSaveScheduler">Save Scheduler Settings</button>
            <button onclick="test3xui()" class="btn-secondary" data-i18n="btnTest3xui">Test 3x-ui Connection</button>
          </div>
          <div id="test3xuiResult" style="margin-top: 10px; font-size: 12px; font-family: var(--mono); color: var(--text-muted);"></div>
        </div>

        <div id="widgetRotationStatus" class="card">
          <h2 data-i18n="titleRotStatus">Rotation Status & History</h2>
          <div class="stat-row">
            <span class="stat-label" data-i18n="lblSchedStatus">Scheduler Status</span>
            <span class="stat-value" id="rotStatusText">Idle</span>
          </div>
          <div class="stat-row">
            <span class="stat-label" data-i18n="lblNextRun">Next Scheduled Run</span>
            <span class="stat-value" id="rotNextRun">-</span>
          </div>
          <div class="stat-row">
            <span class="stat-label" data-i18n="lblLastRot">Last Rotated At</span>
            <span class="stat-value" id="rotLastRun">-</span>
          </div>

          <div id="rotHistoryList" style="margin-top: 16px;">
            <label for="rotHistoryTable" data-i18n="lblRecentRot">Recent Password Rotations</label>
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th data-i18n="thRotTime">Time</th>
                    <th data-i18n="thRotSource">Source</th>
                    <th data-i18n="thRotUser">User</th>
                    <th data-i18n="thRotResult">Result</th>
                  </tr>
                </thead>
                <tbody id="rotHistoryTable">
                  <tr><td colspan="4" style="color: var(--text-muted); text-align: center;" data-i18n="txtNoRotEvents">No rotation events yet</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== TAB 3: EXTENSION CONSTRUCTOR STUDIO ==================== -->
    <div id="tab-builder" class="tab-pane" role="tabpanel" tabindex="0" aria-labelledby="tabBtnBuilder">
      <div class="grid-builder-columns">
        
        <!-- Left Column: Visual, Preset & Feature Customizer -->
        <div class="card" style="margin-bottom: 0;">
          <h2>
            <span data-i18n="titleBuilder">Extension Constructor & Customizer</span>
            <span class="badge badge-action-proxy" id="bldPresetBadge">Self-Service Pro</span>
          </h2>
          <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 14px;" data-i18n="subBuilder">
            Configure functional archetypes, visual styles, security leak guards, and user capabilities:
          </p>

          <!-- 1. Interface Mode -->
          <div style="background: var(--card-inner); padding: 12px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 14px;">
            <label for="chip-popup" style="margin-bottom: 8px;" data-i18n="lblArchetypePresets">1. Режим интерфейса</label>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <button type="button" class="preset-chip active" id="chip-popup" onclick="applyUiModePreset('popup')">
                <img src="/icons/user.png" class="icon-inline" alt="user">
                <span data-i18n="chipPopupMode">Обычный режим</span>
              </button>
              <button type="button" class="preset-chip" id="chip-stealth" onclick="applyUiModePreset('stealth')">
                <img src="/icons/ghost.png" class="icon-inline" alt="ghost">
                <span data-i18n="chipStealthMode">Скрытый агент</span>
              </button>
            </div>
            <p id="presetDescText" style="font-size: 11px; color: var(--text-muted); margin-top: 6px;">
              Обычный режим: интерактивный попап с информацией о подключении, маршрутизации и управлением.
            </p>
          </div>

          <!-- 2. UI Layout & Color Palette -->
          <div id="builderThemeCardContainer" style="background: var(--card-inner); padding: 12px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 14px; position: relative;">
            <div id="builderThemeLockedNotice" class="theme-sync-lock-banner" style="display: none;">
              <span>🔒 <strong data-i18n="msgThemeLockedBySync">Синхронизировано с корпоративным оформлением панели</strong></span>
            </div>
            <label for="btnStudioLayoutConsole" style="margin-bottom: 8px;" data-i18n="lblThemePalettes">2. Макет и цветовая палитра</label>

            <!-- Layout selector: Console vs Terminal -->
            <div style="margin-bottom: 12px;">
              <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px;" data-i18n="lblStudioLayout">Макет интерфейса:</div>
              <div class="grid-form-2col" style="gap: 8px;">
                <button type="button" class="studio-layout-btn active" id="btnStudioLayoutConsole" onclick="setStudioLayout('console')">
                  <span style="font-size: 12px; font-weight: 600;">Console</span>
                  <span style="font-size: 10px; color: var(--text-muted);">(rounded, soft)</span>
                </button>
                <button type="button" class="studio-layout-btn" id="btnStudioLayoutTerminal" onclick="setStudioLayout('terminal')">
                  <span style="font-size: 12px; font-weight: 600; font-family: monospace;">Terminal</span>
                  <span style="font-size: 10px; color: var(--text-muted);">(monospace, sharp)</span>
                </button>
              </div>
            </div>

            <!-- Color Palettes: Cyber Blue, Dark Obsidian, Nordic Arctic, Emerald SecOps, Enterprise Light -->
            <div style="margin-bottom: 12px;">
              <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px;" data-i18n="lblStudioPalette">Цветовая палитра:</div>
              <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <button type="button" class="preset-chip active" id="chip-palette-cyber" onclick="setStudioPalette('cyber')">
                  <span class="color-swatch" style="background: #38bdf8;"></span>
                  <span>Cyber Blue</span>
                </button>
                <button type="button" class="preset-chip" id="chip-palette-obsidian" onclick="setStudioPalette('obsidian')">
                  <span class="color-swatch" style="background: #c084fc;"></span>
                  <span>Dark Obsidian</span>
                </button>
                <button type="button" class="preset-chip" id="chip-palette-nord" onclick="setStudioPalette('nord')">
                  <span class="color-swatch" style="background: #88c0d0;"></span>
                  <span>Nordic Arctic</span>
                </button>
                <button type="button" class="preset-chip" id="chip-palette-emerald" onclick="setStudioPalette('emerald')">
                  <span class="color-swatch" style="background: #34d399;"></span>
                  <span>Emerald SecOps</span>
                </button>
                <button type="button" class="preset-chip" id="chip-palette-light" onclick="setStudioPalette('light')">
                  <span class="color-swatch" style="background: #2563eb; border: 1px solid #cbd5e1;"></span>
                  <span>Enterprise Light</span>
                </button>
              </div>
            </div>

            <!-- Default Theme Mode: Dark (Ночь) vs Light (День) -->
            <div>
              <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px;" data-i18n="lblStudioThemeMode">Режим темы по умолчанию:</div>
              <div class="grid-form-2col" style="gap: 8px;">
                <button type="button" class="studio-mode-btn active" id="btnStudioModeDark" onclick="setStudioThemeMode('dark')">
                  <img src="/icons/moon.png" class="icon-inline" alt="moon">
                  <span style="font-size: 12px; font-weight: 600;" data-i18n="optModeDark">Темная (Ночь)</span>
                </button>
                <button type="button" class="studio-mode-btn" id="btnStudioModeLight" onclick="setStudioThemeMode('light')">
                  <img src="/icons/sun.png" class="icon-inline" alt="sun">
                  <span style="font-size: 12px; font-weight: 600;" data-i18n="optModeLight">Светлая (День)</span>
                </button>
              </div>
            </div>
          </div>

          <!-- 3. Identity & Branding -->
          <input type="hidden" id="bldUiMode" value="popup" />
          <div class="grid-form-2-1">
            <div>
              <label for="bldName" data-i18n="lblExtName">Extension Name</label>
              <input type="text" id="bldName" oninput="onConfigChangeLive()" placeholder="Corp Proxy Auth & Sync" data-i18n-ph="phExtName" />
            </div>
            <div>
              <label for="bldShortName" data-i18n="lblShortName">Short Name</label>
              <input type="text" id="bldShortName" oninput="onConfigChangeLive()" placeholder="CorpProxy" data-i18n-ph="phShortName" />
            </div>
          </div>

          <div class="grid-form-1-15">
            <div>
              <label for="bldVersion" data-i18n="lblVersion">Version</label>
              <input type="text" id="bldVersion" oninput="onConfigChangeLive()" placeholder="1.2.0" />
            </div>
            <div>
              <label for="bldSyncInterval" data-i18n="lblSyncInterval" title="Интервал синхронизации" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Sync Interval</label>
              <select id="bldSyncInterval" onchange="onConfigChangeLive()" style="width: 100%;">
                <option value="1" data-i18n="optSync1">Every 1 minute (test)</option>
                <option value="2" data-i18n="optSync2">Every 2 minutes</option>
                <option value="5" data-i18n="optSync5">Every 5 minutes</option>
                <option value="10" data-i18n="optSync10">Every 10 minutes</option>
                <option value="15" selected data-i18n="optSync15">Every 15 minutes</option>
                <option value="30" data-i18n="optSync30">Every 30 minutes</option>
                <option value="60" data-i18n="optSync60">Every 1 hour</option>
                <option value="120" data-i18n="optSync120">Every 2 hours</option>
                <option value="360" data-i18n="optSync360">Every 6 hours</option>
              </select>
            </div>
          </div>

          <div class="grid-form-1-15" style="margin-top: 10px;">
            <div>
              <label for="bldThemeColor" data-i18n="lblBrandColor">Brand Theme Color</label>
              <input type="text" id="bldThemeColor" oninput="onConfigChangeLive()" placeholder="#0284c7" />
            </div>
            <div>
              <label for="bldEmoji" data-i18n="lblIconCustom">Иконка расширения (Emoji или изображение)</label>
              <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                <input type="text" id="bldEmoji" oninput="onConfigChangeLive()" placeholder="🛡️" style="width: 50px; text-align: center; font-size: 18px;" />
                <input type="file" id="iconFileInput" accept="image/png,image/jpeg,image/webp,image/svg+xml" style="display:none;" onchange="onIconFileSelected(event)" />
                <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('iconFileInput').click()" style="display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; height: 34px;">
                  <img src="/icons/folder.png" class="icon-inline" alt="folder">
                  <span data-i18n="btnUploadIcon">Загрузить изображение</span>
                </button>
                <div id="customIconPreviewBox" style="display: none; align-items: center; gap: 6px;">
                  <img id="customIconPreviewImg" src="" alt="Icon preview" style="width: 28px; height: 28px; border-radius: 6px; object-fit: contain; border: 1px solid var(--border);" />
                  <button type="button" class="btn btn-sm" onclick="clearCustomIcon()" title="Удалить иконку" style="padding: 2px 6px; font-size: 11px; background: transparent; border: 1px solid var(--border); color: var(--text-muted); cursor: pointer;"><img src="/icons/cross.png" class="icon-inline-sm" alt="del"></button>
                </div>
              </div>
            </div>
          </div>

          <label for="bldDesc" data-i18n="lblExtDesc">Enterprise Description</label>
          <input type="text" id="bldDesc" oninput="onConfigChangeLive()" placeholder="Enterprise Chrome extension for automatic proxy synchronization" data-i18n-ph="phExtDesc" />

          <label for="bldServerUrl" data-i18n="lblServerUrl">Sync Server Base URL (API Base URL)</label>
          <input type="text" id="bldServerUrl" oninput="onConfigChangeLive()" placeholder="https://pec.example.corp" data-i18n-ph="phServerUrl" />

          <label for="bldUpdateUrl" data-i18n="lblUpdateUrl">Update Manifest XML URL (update_url)</label>
          <input type="text" id="bldUpdateUrl" oninput="onConfigChangeLive()" placeholder="https://pec.example.corp/updates/updates.xml" data-i18n-ph="phUpdateUrl" />
          <div style="font-size: 11px; color: var(--text-muted); margin-top: -6px; margin-bottom: 10px;" data-i18n="hintUpdateUrl">Зашивается в manifest.json (update_url) и GPO. Если не заполнено, формируется автоматически как [Server URL]/updates/updates.xml</div>

          <div style="margin-top: 10px; margin-bottom: 12px;">
            <label for="builderDefaultProxyId" data-i18n="lblBuilderDefaultProxy">Прокси по умолчанию для сборки</label>
            <select id="builderDefaultProxyId" onchange="onConfigChangeLive()" style="width: 100%; box-sizing: border-box; margin-bottom: 0;">
              <option value="">По умолчанию (Активный на сервере)</option>
            </select>
          </div>

          <!-- 4. Security & User Feature Policies -->
          <div style="background: var(--card-inner); padding: 12px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 14px;">
            <label for="bldWebRtc" style="margin-bottom: 8px;" data-i18n="lblSecPolicies">Security & Leak Prevention Policies</label>
            <div class="grid-form-2col" style="gap: 8px; font-size: 12px;">
              <label for="bldWebRtc" style="display: flex; align-items: center; gap: 8px; text-transform: none; color: var(--text); font-weight: normal; cursor: pointer;">
                <input type="checkbox" id="bldWebRtc" checked onchange="onConfigChangeLive()" style="width: auto; margin-bottom: 0;" />
                <span data-i18n="lblWebrtcShield">WebRTC IP Shield (no UDP leak)</span>
              </label>
              <label for="bldDnsGuard" style="display: flex; align-items: center; gap: 8px; text-transform: none; color: var(--text); font-weight: normal; cursor: pointer;">
                <input type="checkbox" id="bldDnsGuard" checked onchange="onConfigChangeLive()" style="width: auto; margin-bottom: 0;" />
                <span data-i18n="lblDnsGuard">DNS Leak Guard</span>
              </label>
              <label for="bldAutoProxy" style="display: flex; align-items: center; gap: 8px; text-transform: none; color: var(--text); font-weight: normal; cursor: pointer;">
                <input type="checkbox" id="bldAutoProxy" checked onchange="onConfigChangeLive()" style="width: auto; margin-bottom: 0;" />
                <span data-i18n="lblAutoProxy">Dynamic Proxy Enforcement</span>
              </label>
              <label for="builderAllowUserProxySwitch" style="display: flex; align-items: center; gap: 8px; text-transform: none; color: var(--text); font-weight: normal; cursor: pointer;">
                <input type="checkbox" id="builderAllowUserProxySwitch" checked onchange="onConfigChangeLive()" style="width: auto; margin-bottom: 0;" />
                <span data-i18n="lblAllowUserProxySwitch">Разрешить переключение прокси</span>
              </label>
            </div>
            
            <div class="grid-form-1-2" style="margin-top: 10px;">
              <div>
                <label for="bldBypassTimeout" style="font-size: 11px;" data-i18n="lblPauseTimeout">Таймаут паузы</label>
                <select id="bldBypassTimeout" onchange="onConfigChangeLive()" style="margin-bottom: 0; font-size: 12px;">
                  <option value="10">10 minutes</option>
                  <option value="15" selected>15 minutes</option>
                  <option value="30">30 minutes</option>
                  <option value="60">60 minutes</option>
                </select>
              </div>
              <div>
                <label for="bldSupportUrl" style="font-size: 11px;" data-i18n="lblSupportUrl">IT Helpdesk Contact</label>
                <input type="text" id="bldSupportUrl" oninput="onConfigChangeLive()" placeholder="mailto:it-support@corp.local" data-i18n-ph="phSupportUrl" style="margin-bottom: 0; font-size: 12px;" />
              </div>
            </div>
          </div>

          <div class="builder-actions-row">
            <button type="button" id="btnBuildExtension" onclick="buildAndPackExtension()" class="btn-success" data-i18n="btnBuildCrx">Собрать CRX</button>
            <button onclick="saveBuilderConfigOnly(true)" class="btn-secondary" data-i18n="btnSaveConfig">Сохранить конфиг</button>
            <button onclick="regenerateTemplatesFromConfig()" class="btn-secondary btn-reset-template" data-i18n="btnResetTemplate" data-i18n-title="btnResetTemplateTitle" title="Сбросить все исходные файлы к чистому шаблону из текущей конфигурации">Сбросить шаблон</button>
            <button type="button" id="btnExtViewBuildLog" onclick="openBuildLogModal('extension')" class="btn-secondary" style="display: none;" title="Показать лог сборки расширения">📋 Лог сборки</button>
          </div>
        </div>

        <!-- Right Column: Live Interactive Chrome Extension Preview Sandbox -->
        <div class="card" style="margin-bottom: 0; display: flex; flex-direction: column;">
          <h2>
            <span data-i18n="titleLivePreview">Live Extension Interactive Preview</span>
            <span class="badge badge-online" id="previewSyncStatus" data-i18n="badgeSynced">Synced</span>
          </h2>
          <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 12px;" data-i18n="subLivePreview">
            Full runtime sandbox mirroring real Chrome popup, icons, badge states, and events in real time:
          </p>

          <!-- Browser Mockup Frame -->
          <div class="browser-mock">
            <div class="browser-top">
              <div class="browser-dots">
                <span class="browser-dot dot-red"></span>
                <span class="browser-dot dot-yellow"></span>
                <span class="browser-dot dot-green"></span>
              </div>
              <div class="browser-address-bar">
                <img src="/icons/lock.png" class="icon-inline" alt="lock">
                <span>https://company-intranet.corp/internal-app</span>
              </div>
              <!-- Chrome extension icon with live badge -->
              <div class="browser-ext-icon" id="browserExtIcon" onclick="togglePopupPreviewVisibility()" title="Click to inspect extension popup">
                <span id="browserIconGlyph"><img src="/icons/shield.png" class="icon-inline" alt="shield"></span>
                <span class="browser-ext-badge" id="browserBadge">PRX</span>
              </div>
            </div>

            <!-- Preview Canvas -->
            <div class="preview-canvas">
              <!-- Popup Window Box -->
              <div class="popup-frame-box" id="popupFrameBox">
                <iframe id="previewFrame" sandbox="allow-scripts" style="height: 470px; border: none; overflow: hidden;" scrolling="no" title="Extension Popup Preview"></iframe>
              </div>

              <!-- Stealth Mode Fallback Card -->
              <div id="stealthNotice" style="display: none; background: #0f172a; border: 1px solid var(--border); border-radius: 8px; padding: 24px; text-align: center; max-width: 320px;">
                <div style="margin-bottom: 10px;"><img src="/icons/ghost.png" style="width: 38px; height: 38px;" alt="stealth"></div>
                <h4 style="font-size: 15px; margin-bottom: 6px;" data-i18n="titleStealthNotice">Stealth Mode Enabled</h4>
                <p style="font-size: 12px; color: var(--text-muted); line-height: 1.5;" data-i18n="subStealthNotice">
                  The extension runs silently as an enterprise background service worker without a popup window. Traffic is routed dynamically via PAC policy.
                </p>
                <div style="margin-top: 14px;">
                  <span class="badge badge-action-proxy" data-i18n="badgeStealthActive">Icon Badge: Active</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Interactive Simulator Controls -->
          <div style="background: var(--card-inner); padding: 10px; border-radius: 8px; border: 1px solid var(--border); margin-top: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span style="font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase;" data-i18n="lblSimState">Simulated Extension State</span>
              <span id="simStateLabel" style="font-size: 11px; color: var(--success); font-weight: 600;">State: Online / Routing Active</span>
            </div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              <button type="button" class="btn-secondary" onclick="simulateState('active')" style="font-size: 11px; padding: 4px 8px;" data-i18n="btnSimOnline">Online Proxy</button>
              <button type="button" class="btn-secondary" onclick="simulateState('bypass')" style="font-size: 11px; padding: 4px 8px;" data-i18n="btnSimBypass">Bypassed</button>
              <button type="button" class="btn-secondary" onclick="simulateState('offline')" style="font-size: 11px; padding: 4px 8px;" data-i18n="btnSimOffline">Offline Fallback</button>
              <button type="button" class="btn-secondary" onclick="simulateState('error407')" style="font-size: 11px; padding: 4px 8px;" data-i18n="btnSimError">Re-Authenticating</button>
            </div>
          </div>

        </div>
      </div>

      <!-- Bottom Full-Width Section: Source Code Internals Editor -->
      <div class="card">
        <h2>
          <span data-i18n="titleCodeInternals">Extension Source Code Internals</span>
          <div style="display: flex; gap: 10px; align-items: center;">
            <span style="font-size: 12px; color: var(--text-muted);" data-i18n="lblActiveFile">Active File:</span>
            <select id="codeFileSelect" onchange="loadFileContent()" style="margin-bottom: 0; font-size: 12px; width: auto;">
              <option value="popup.html">popup.html (Popup Markup & CSS)</option>
              <option value="popup.js">popup.js (Popup Script & Events)</option>
              <option value="manifest.json">manifest.json (Permissions & Actions)</option>
              <option value="background.js">background.js (Proxy Service Worker)</option>
              <option value="icon.svg">icon.svg (Vector Icon)</option>
              <option value="managed_schema.json">managed_schema.json (GPO Policy Schema)</option>
            </select>
          </div>
        </h2>
        <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 10px;" data-i18n="subCodeInternals">
          Live Code Editor: Edits in <code>popup.html</code> or <code>popup.js</code> update the Interactive Preview instantly.
        </p>

        <textarea id="codeEditor" oninput="onCodeEditorLiveChange()" style="width: 100%; height: 320px; font-family: var(--mono); font-size: 12px; margin-bottom: 10px; white-space: pre; line-height: 1.4;"></textarea>

        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
          <span id="codeStatus" style="font-size: 12px; color: var(--text-muted);" data-i18n="lblCodeReady">Ready</span>
          <div style="display: flex; gap: 8px;">
            <button onclick="saveCurrentCodeFile()" class="btn-secondary" style="font-size: 12px;" data-i18n="btnSaveCode">Save File Edits & Apply</button>
            <button onclick="downloadExtensionPackage('crx')" class="btn" style="font-size: 12px;" data-i18n="btnDownloadCrx">Download .CRX</button>
            <button onclick="downloadExtensionPackage('zip')" class="btn-secondary" style="font-size: 12px;" data-i18n="btnDownloadZip">Download .ZIP</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== TAB: APP CONSTRUCTOR STUDIO ==================== -->
    <div id="tab-app-studio" class="tab-pane" role="tabpanel" tabindex="0" aria-labelledby="tabBtnAppStudio">
      <div id="appBinariesStaleBanner" class="alert-banner alert-warning" style="display: none; margin-bottom: 12px;"></div>
      <div id="appToolchainDiagnostics" class="card toolchain-card" style="display: none; margin-bottom: 14px;"></div>
      <div id="viewAppStudio" class="app-studio-grid">
        <!-- Left Panel: Settings Form -->
        <div class="app-studio-form-col">
          <!-- 1. Branding & Identity Card -->
          <div class="card">
            <h2>
              <span data-i18n="titleAppStudio">Конструктор приложения PEC-App</span>
              <span class="badge badge-action-proxy" id="appPresetBadge">Cyber Blue</span>
            </h2>
            <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 14px;" data-i18n="subAppStudio">
              Настройка нативного прозрачного десктоп-клиента (Windows WinDivert / Linux NFQUEUE):
            </p>

            <div class="grid-form-2-1">
              <div>
                <label for="appBuildName" data-i18n="lblAppName">Название приложения</label>
                <input type="text" id="appBuildName" value="PEC - Proxy Client" oninput="onAppConfigChangeLive()" placeholder="PEC - Proxy Client" />
              </div>
              <div>
                <label for="appBuildShortName" data-i18n="lblAppShortName">Короткое имя</label>
                <input type="text" id="appBuildShortName" value="PEC Client" oninput="onAppConfigChangeLive()" placeholder="PEC Client" />
              </div>
            </div>

            <div class="grid-form-2col">
              <div>
                <label for="appBuildVersion" data-i18n="lblAppVersion">Версия</label>
                <input type="text" id="appBuildVersion" value="2.2.0" oninput="onAppConfigChangeLive()" placeholder="2.2.0" />
              </div>
              <div>
                <label for="appIconType" data-i18n="lblAppIconType">Иконка приложения (Эмодзи или PNG)</label>
                <div style="display: flex; gap: 6px; align-items: center;">
                  <select id="appIconType" onchange="onAppConfigChangeLive()" style="margin-bottom: 0; flex: 1;">
                    <option value="shield">🛡️ Shield (Щит безопасности)</option>
                    <option value="lock">🔒 Lock (Замок шифрования)</option>
                    <option value="globe">🌐 Globe (Глобальная сеть)</option>
                    <option value="server">🖥️ Server (Прокси-шлюз)</option>
                    <option value="key">🔑 Key (Ключ доступа)</option>
                  </select>
                  <input type="file" id="appIconFileInput" accept="image/png,image/jpeg,image/webp,image/svg+xml" style="display:none;" onchange="onAppIconFileSelected(event)" />
                  <button type="button" class="btn btn-secondary btn-sm" id="btnAppUploadIcon" onclick="document.getElementById('appIconFileInput').click()" title="Загрузить изображение (PNG / SVG)" style="padding: 6px 10px; height: 36px; white-space: nowrap; display: inline-flex; align-items: center; gap: 5px;">
                    <img src="/icons/folder.png" class="icon-inline" alt="folder">
                  </button>
                  <div id="appCustomIconPreviewBox" style="display: none; align-items: center; gap: 4px;">
                    <img id="appCustomIconPreviewImg" src="" alt="App icon" style="width: 26px; height: 26px; border-radius: 4px; object-fit: contain; border: 1px solid var(--border); background: rgba(0,0,0,0.2);" />
                    <button type="button" class="btn btn-sm" id="btnAppClearIcon" onclick="clearAppCustomIcon()" title="Удалить иконку" style="padding: 2px 5px; font-size: 10px; background: transparent; border: 1px solid var(--border); color: var(--text-muted); cursor: pointer;"><img src="/icons/cross.png" class="icon-inline-sm" alt="del"></button>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <label for="appBuildDescription" data-i18n="lblAppDescription">Описание</label>
              <textarea id="appBuildDescription" oninput="onAppConfigChangeLive()" rows="2" style="width: 100%; font-size: 12px; margin-bottom: 0;">Корпоративный прозрачный прокси-клиент с фильтрацией процессов и автоматической синхронизацией.</textarea>
            </div>
          </div>

          <!-- 2. Themes & Styling Card -->
          <div class="card" id="appThemeCardContainer" style="position: relative;">
            <div id="appThemeLockedNotice" class="theme-sync-lock-banner" style="display: none;">
              <span>🔒 <strong data-i18n="msgThemeLockedBySync">Синхронизировано с корпоративным оформлением панели</strong></span>
            </div>
            <h2>
              <span data-i18n="titleAppThemes">Темы и визуальный стиль</span>
            </h2>

            <!-- Unified Theme Palette Selector -->
            <div style="margin-bottom: 12px;">
              <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px;">Цветовая палитра:</div>
              <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <button type="button" class="preset-chip active" id="chipAppPaletteCyber" onclick="setAppPalette('cyber')">
                  <span class="color-swatch" style="background: #38bdf8;"></span>
                  <span>Cyber Blue</span>
                </button>
                <button type="button" class="preset-chip" id="chipAppPaletteObsidian" onclick="setAppPalette('obsidian')">
                  <span class="color-swatch" style="background: #c084fc;"></span>
                  <span>Dark Obsidian</span>
                </button>
                <button type="button" class="preset-chip" id="chipAppPaletteNord" onclick="setAppPalette('nord')">
                  <span class="color-swatch" style="background: #88c0d0;"></span>
                  <span>Nordic Arctic</span>
                </button>
                <button type="button" class="preset-chip" id="chipAppPaletteEmerald" onclick="setAppPalette('emerald')">
                  <span class="color-swatch" style="background: #34d399;"></span>
                  <span>Emerald SecOps</span>
                </button>
                <button type="button" class="preset-chip" id="chipAppPaletteLight" onclick="setAppPalette('light')">
                  <span class="color-swatch" style="background: #2563eb; border: 1px solid #cbd5e1;"></span>
                  <span>Enterprise Light</span>
                </button>
              </div>
              <input type="hidden" id="appPresetStyle" value="cyber-blue" />
            </div>

            <!-- Theme Geometry: Rounded (Console) vs Sharp (Terminal) -->
            <div style="margin-bottom: 12px;">
              <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px;" data-i18n="lblAppLayout">Геометрия интерфейса:</div>
              <div class="grid-form-2col" style="gap: 8px;">
                <button type="button" class="studio-layout-btn active" id="btnAppLayoutConsole" onclick="setAppLayout('console')">
                  <span style="font-size: 12px; font-weight: 600;">Console</span>
                  <span style="font-size: 10px; color: var(--text-muted);">(rounded, soft)</span>
                </button>
                <button type="button" class="studio-layout-btn" id="btnAppLayoutTerminal" onclick="setAppLayout('terminal')">
                  <span style="font-size: 12px; font-weight: 600; font-family: monospace;">Terminal</span>
                  <span style="font-size: 10px; color: var(--text-muted);">(monospace, sharp)</span>
                </button>
              </div>
            </div>

            <!-- Dark / Light Mode Switcher -->
            <div style="margin-bottom: 12px;">
              <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px;" data-i18n="lblAppThemeMode">Режим темы:</div>
              <div class="grid-form-2col" style="gap: 8px;">
                <button type="button" class="studio-mode-btn active" id="btnAppModeDark" onclick="setAppThemeMode('dark')">
                  <img src="/icons/moon.png" class="icon-inline" alt="dark">
                  <span style="font-size: 12px; font-weight: 600;" data-i18n="optModeDark">Темная (Ночь)</span>
                </button>
                <button type="button" class="studio-mode-btn" id="btnAppModeLight" onclick="setAppThemeMode('light')">
                  <img src="/icons/sun.png" class="icon-inline" alt="light">
                  <span style="font-size: 12px; font-weight: 600;" data-i18n="optModeLight">Светлая (День)</span>
                </button>
              </div>
            </div>

            <!-- Custom Colors -->
            <div class="grid-form-3col">
              <div>
                <label for="appThemeColor" style="font-size: 11px;" data-i18n="lblAppThemeColor">Акцентный цвет</label>
                <input type="color" id="appThemeColor" value="#38bdf8" onchange="onAppCustomColorChange()" style="height: 36px; padding: 2px; width: 100%; cursor: pointer;" />
              </div>
              <div>
                <label for="appThemeBackground" style="font-size: 11px;" data-i18n="lblAppThemeBg">Фон окна</label>
                <input type="color" id="appThemeBackground" value="#0b1120" onchange="onAppCustomColorChange()" style="height: 36px; padding: 2px; width: 100%; cursor: pointer;" />
              </div>
              <div>
                <label for="appThemeCard" style="font-size: 11px;" data-i18n="lblAppThemeCard">Фон карточек</label>
                <input type="color" id="appThemeCard" value="#131d36" onchange="onAppCustomColorChange()" style="height: 36px; padding: 2px; width: 100%; cursor: pointer;" />
              </div>
            </div>
          </div>

          <!-- 3. Startup & Service Behavior Card -->
          <div class="card">
            <h2>
              <span data-i18n="titleAppBehavior">Системные службы и запуск</span>
            </h2>

            <div class="grid-form-2col" style="gap: 12px;">
              <label for="appAutoStart" style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px;">
                <input type="checkbox" id="appAutoStart" checked onchange="onAppConfigChangeLive()" />
                <span data-i18n="lblAppAutoStart">Автозапуск с Windows</span>
              </label>
              <label for="appStartMinimized" style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px;">
                <input type="checkbox" id="appStartMinimized" checked onchange="onAppConfigChangeLive()" />
                <span data-i18n="lblAppStartMinimized">Сворачивать в системный трей</span>
              </label>
              <label for="appInstallService" style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px;">
                <input type="checkbox" id="appInstallService" onchange="onAppConfigChangeLive()" />
                <span data-i18n="lblAppInstallService">Служба Windows (Background Service)</span>
              </label>
              <label for="appTrafficLogging" style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px;">
                <input type="checkbox" id="appTrafficLogging" onchange="onAppConfigChangeLive()" />
                <span data-i18n="lblAppTrafficLogging">Логирование соединений</span>
              </label>
              <label for="appLegacyWin7" style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px;">
                <input type="checkbox" id="appLegacyWin7" onchange="onAppConfigChangeLive()" />
                <span data-i18n="lblAppLegacyWin7">Собрать для Windows 7 (Classic Win32 GUI)</span>
              </label>
            </div>

            <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border);">
              <label for="appSyncIntervalMinutes" style="font-size: 12px; font-weight: 600; display: block; margin-bottom: 4px;" data-i18n="lblAppSyncInterval">Интервал автосинхронизации с сервером (минуты):</label>
              <div style="display: flex; align-items: center; gap: 8px;">
                <input type="number" id="appSyncIntervalMinutes" min="1" max="1440" value="15" onchange="onAppConfigChangeLive()" style="width: 120px; font-size: 12px; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--card-inner); color: var(--text);" />
                <span style="font-size: 11px; color: var(--text-muted);" data-i18n="hintAppSyncInterval">Периодичность синхронизации профиля, прокси и маршрутов в фоновом режиме (по умолчанию: 15 мин).</span>
              </div>
            </div>
          </div>

          <!-- 5. Code Signing Card -->
          <div class="card" id="cardCodeSigning">
            <h2>
              <span>Цифровая подпись (Code Signing)</span>
              <span id="badgeCodeSignStatus" class="badge badge-offline">Не настроена</span>
            </h2>
            <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">
              Подпись Windows-бинарников (.exe, .dll, .msi) сертификатом Authenticode для безопасного развертывания через Active Directory GPO и Microsoft Intune без предупреждений SmartScreen.
            </p>

            <div id="codeSignConfiguredView" style="display: none; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 6px; padding: 12px; margin-bottom: 12px;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
                <div>
                  <div style="font-weight: 600; font-size: 13px; color: #10b981;" id="csCertSubject">CN=...</div>
                  <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;" id="csCertIssuer">Кем выдан: ...</div>
                  <div style="font-size: 11px; color: var(--text-muted);" id="csCertValidity">Действителен: ...</div>
                  <div style="font-size: 11px; margin-top: 4px; display: flex; align-items: center; gap: 8px;">
                    <span class="badge" id="csCertTypeBadge">Коммерческий</span>
                    <span style="font-size: 10px; color: var(--text-muted);" id="csCertThumbprint"></span>
                  </div>
                </div>
                <button type="button" onclick="deleteCodeSignCertAction()" class="btn-danger" style="font-size: 11px; padding: 4px 10px;">Удалить сертификат</button>
              </div>
            </div>

            <div id="codeSignUploadView">
              <div class="grid-form-2col" style="gap: 12px; margin-bottom: 10px;">
                <div>
                  <label for="csCertType" style="font-size: 11px; font-weight: 600;">Тип сертификата</label>
                  <select id="csCertType" class="form-select" onchange="onCodeSignTypeChange()" style="font-size: 12px; margin-bottom: 0;">
                    <option value="commercial">Официальный / Коммерческий (с RFC 3161 Timestamp)</option>
                    <option value="internal">Внутридоменный CA (Active Directory CS, offline / без штампа времени)</option>
                  </select>
                </div>
                <div>
                  <label for="csTimestampUrl" style="font-size: 11px; font-weight: 600;">URL сервера штампа времени (RFC 3161)</label>
                  <input type="text" id="csTimestampUrl" value="http://timestamp.digicert.com" placeholder="http://timestamp.digicert.com" style="font-size: 12px; margin-bottom: 0;" />
                </div>
              </div>

              <div class="grid-form-2col" style="gap: 12px; margin-bottom: 10px;">
                <div>
                  <label for="csCertFile" style="font-size: 11px; font-weight: 600;">Файл сертификата (.pfx / .p12)</label>
                  <input type="file" id="csCertFile" accept=".pfx,.p12" style="font-size: 12px; padding: 4px;" />
                </div>
                <div>
                  <label for="csCertPassword" style="font-size: 11px; font-weight: 600;">Пароль закрытого ключа</label>
                  <input type="password" id="csCertPassword" placeholder="Оставьте пустым, если без пароля" style="font-size: 12px; margin-bottom: 0;" />
                </div>
              </div>

              <div style="display: flex; align-items: center; gap: 10px;">
                <button type="button" id="btnUploadCert" onclick="uploadCodeSignCertAction()" class="btn-secondary" style="font-size: 12px; padding: 6px 14px;">
                  Загрузить и применить сертификат
                </button>
                <span id="csUploadStatus" style="font-size: 11px; color: var(--text-muted);"></span>
              </div>
            </div>
          </div>

          <!-- 6. Actions Card -->
          <div class="card" style="margin-bottom: 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
              <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <button type="button" id="btnAppSaveConfig" onclick="saveAppStudioConfigAction()" class="btn-secondary" style="font-size: 12px;">Сохранить настройки</button>
                <button type="button" id="btnAppCleanBinaries" onclick="cleanAppBinariesAction()" class="btn-danger" style="font-size: 12px;" title="Удалить скомпилированные бинарники для пересборки с нуля">🗑 Очистить бинарники</button>
                <button type="button" id="btnAppBuildBinaries" onclick="buildAppBinariesAction()" class="btn-secondary" style="font-size: 12px;">Собрать бинарники (Build Binaries)</button>
                <button type="button" id="btnAppBuild" onclick="buildAppPackageAction()" class="btn" style="font-size: 12px;">Собрать приложение (Build Package)</button>
                <button type="button" id="btnAppViewBuildLog" onclick="openBuildLogModal('app')" class="btn-secondary" style="font-size: 11px; display: none;">📋 Лог сборки</button>
              </div>
              <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                <button type="button" id="btnAppDownloadInstaller" onclick="downloadAppPackageAction('installer')" class="btn-primary" style="font-size: 11px; font-weight: bold; background: linear-gradient(135deg, #2563eb, #3b82f6); color: #fff;">⚡ Инсталлятор (.EXE)</button>
                <button type="button" id="btnAppDownloadMsi" onclick="downloadAppPackageAction('msi')" class="btn-primary" style="font-size: 11px; font-weight: bold; background: linear-gradient(135deg, #059669, #10b981); color: #fff;">📦 Скачать MSI (GPO / Intune)</button>
                <button type="button" id="btnAppDownloadZip" onclick="downloadAppPackageAction('windows')" class="btn-secondary" style="font-size: 11px;">Скачать Windows (.ZIP)</button>
                <button type="button" id="btnAppDownloadTar" onclick="downloadAppPackageAction('linux')" class="btn-secondary" style="font-size: 11px;">Скачать Linux (.tar.gz)</button>
                <button type="button" id="btnAppDownloadPs1" onclick="downloadAppScriptAction('deploy')" class="btn-secondary" style="font-size: 11px;">deploy.ps1</button>
                <button type="button" id="btnAppDownloadVerifyPs1" onclick="downloadAppScriptAction('verify')" class="btn-secondary" style="font-size: 11px;">verify.ps1</button>
                <button type="button" id="btnAppDownloadProfile" onclick="downloadAppProfileAction()" class="btn-secondary" style="font-size: 11px;">.pbprofile</button>
              </div>
            </div>
            <div id="appBuildStatusMsg" style="font-size: 11px; color: var(--text-muted); margin-top: 8px; display: none;"></div>
          </div>
        </div>

        <!-- Right Panel: Desktop Window Live Interactive Preview -->
        <div class="app-studio-preview-col" id="appPreviewContainer">
          <div class="card" style="margin-bottom: 0; position: sticky; top: 16px;">
            <h2>
              <span data-i18n="titleAppLivePreview">Интерактивный предпросмотр приложения</span>
              <span class="badge badge-online" id="appPreviewPlatformBadge">Windows / Linux</span>
            </h2>
            <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;" data-i18n="subAppLivePreview">
              Реактивный симулятор десктопного окна PEC-App с применением темы и правил в реальном времени:
            </p>

            <!-- Native Desktop Window Mockup -->
            <div id="appPreviewWindow" class="desktop-mockup-window" style="--app-accent: #0284c7; --app-bg: #0b1120; --app-card: #131d36;">
              <!-- Title Bar -->
              <div class="mockup-titlebar">
                <div class="mockup-titlebar-left">
                  <span id="appPreviewIcon" class="mockup-app-icon">🛡️</span>
                  <span id="appPreviewTitle" class="mockup-window-title">PEC - Proxy Client</span>
                </div>
                <div class="mockup-window-controls">
                  <span class="mockup-control-btn mockup-min">&minus;</span>
                  <span class="mockup-control-btn mockup-max">&#9633;</span>
                  <span class="mockup-control-btn mockup-close">&times;</span>
                </div>
              </div>

              <!-- Window Inner Content -->
              <div class="mockup-body">
                <!-- Status & Connection Strip -->
                <div class="mockup-status-strip">
                  <div class="mockup-status-left">
                    <span id="appPreviewStatusDot" class="mockup-status-dot online"></span>
                    <span id="appPreviewStatusText" style="font-weight: 600; font-size: 11px;">Прокси активен</span>
                  </div>
                  <div id="appPreviewNodeTag" class="mockup-proxy-pill">SOCKS5 127.0.0.1:1080</div>
                </div>

                <!-- Preview Window Navigation Tabs -->
                <div class="mockup-tabs">
                  <button type="button" class="mockup-tab-btn active" id="btnPrevTabMain" onclick="switchPreviewWindowTab('main')">Главная</button>
                  <button type="button" class="mockup-tab-btn" id="btnPrevTabTraffic" onclick="switchPreviewWindowTab('traffic')">Трафик</button>
                  <button type="button" class="mockup-tab-btn" id="btnPrevTabRules" onclick="switchPreviewWindowTab('rules')">Правила</button>
                  <button type="button" class="mockup-tab-btn" id="btnPrevTabLog" onclick="switchPreviewWindowTab('log')">Журнал</button>
                  <button type="button" class="mockup-tab-btn" id="btnPrevTabSettings" onclick="switchPreviewWindowTab('settings')">Настройки</button>
                </div>

                <!-- Preview Window Tab Content: Main -->
                <div id="prevTabMain" class="mockup-tab-content active">
                  <div style="background: var(--app-card); border-radius: 6px; padding: 10px; margin-bottom: 8px; border: 1px solid var(--border);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                      <span style="font-size: 11px; color: var(--text-muted);">Состояние службы:</span>
                      <span class="mockup-proxy-pill" style="background: rgba(16, 185, 129, 0.2); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.4);">● Сервер: Активен (18 ms)</span>
                    </div>
                    <button type="button" style="width: 100%; padding: 8px; font-size: 12px; font-weight: 700; background: var(--app-accent); color: #fff; border: none; border-radius: 4px; cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px;">
                      ⚡ Туннель активен (PROXY)
                    </button>
                    <div class="grid-form-2col" style="margin-top: 8px; font-size: 10.5px; color: var(--text-muted); gap: 4px;">
                      <div>Фильтр ядра: <strong style="color: #10b981;">WinDivert64.sys</strong></div>
                      <div>Локальный релей: <strong style="color: var(--app-accent);">127.0.0.1:34010</strong></div>
                    </div>
                  </div>
                </div>

                <!-- Preview Window Tab Content: Traffic -->
                <div id="prevTabTraffic" class="mockup-tab-content" style="display: none;">
                  <div style="font-size: 10.5px; color: var(--text-muted); margin-bottom: 4px;">Активные перехваты соединений L3/L4:</div>
                  <div style="max-height: 140px; overflow-y: auto; background: var(--app-card); border: 1px solid var(--border); border-radius: 4px; font-size: 10.5px;">
                    <div class="grid-preview-traffic-row" style="border-bottom: 1px solid rgba(255,255,255,0.06); font-weight: 600; color: var(--text-muted);">
                      <span>Время</span><span>Процесс</span><span>Назначение</span><span>Действие</span>
                    </div>
                    <div class="grid-preview-traffic-row" style="border-bottom: 1px solid rgba(255,255,255,0.03); align-items: center;">
                      <span style="color: #64748b;">13:40:02</span><span>curl.exe</span><span style="overflow:hidden; text-overflow:ellipsis;">api.github.com:443</span><span style="color: var(--app-accent); font-weight: 600;">PROXY</span>
                    </div>
                    <div class="grid-preview-traffic-row" style="border-bottom: 1px solid rgba(255,255,255,0.03); align-items: center;">
                      <span style="color: #64748b;">13:40:08</span><span>git.exe</span><span style="overflow:hidden; text-overflow:ellipsis;">github.com:22</span><span style="color: var(--app-accent); font-weight: 600;">PROXY</span>
                    </div>
                    <div class="grid-preview-traffic-row" style="border-bottom: 1px solid rgba(255,255,255,0.03); align-items: center;">
                      <span style="color: #64748b;">13:40:15</span><span>msedge.exe</span><span style="overflow:hidden; text-overflow:ellipsis;">internal.corp:80</span><span style="color: #10b981; font-weight: 600;">DIRECT</span>
                    </div>
                  </div>
                </div>

                <!-- Preview Window Tab Content: Rules -->
                <div id="prevTabRules" class="mockup-tab-content" style="display: none;">
                  <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px;">Перехватываемые процессы:</div>
                  <div id="mockupRulesList" class="mockup-rules-container">
                    <!-- Populated dynamically -->
                  </div>
                </div>

                <!-- Preview Window Tab Content: Log -->
                <div id="prevTabLog" class="mockup-tab-content" style="display: none;">
                  <div class="mockup-log-console" id="mockupLogConsole" style="max-height: 120px; overflow-y: auto;">
                    [PEC-App] WinDivert driver initialized (x64)<br>
                    [Engine] Rules loaded: 4 filters active<br>
                    [Engine] ProxyBridge listening on localhost:34010<br>
                    [Sync] Periodic fleet sync scheduled every 30s<br>
                    <span style="color: #10b981;">[Ready] Transparent packet filter active.</span>
                  </div>
                  <button type="button" class="btn-secondary" style="font-size: 10px; padding: 3px 6px; margin-top: 6px; width: 100%;">📋 Скопировать весь лог</button>
                </div>

                <!-- Preview Window Tab Content: Settings -->
                <div id="prevTabSettings" class="mockup-tab-content" style="display: none;">
                  <div class="mockup-card-block">
                    <div style="font-size: 11px; display: flex; justify-content: space-between; margin-bottom: 4px;">
                      <span>Автозапуск:</span> <strong id="prevAutoStartVal" style="color: #10b981;">ВКЛ</strong>
                    </div>
                    <div style="font-size: 11px; display: flex; justify-content: space-between; margin-bottom: 4px;">
                      <span>Сворачивать в трей:</span> <strong id="prevMinimizeVal" style="color: #10b981;">ВКЛ</strong>
                    </div>
                    <div style="font-size: 11px; display: flex; justify-content: space-between;">
                      <span>Служба Windows:</span> <strong id="prevServiceVal" style="color: #64748b;">ВЫКЛ</strong>
                    </div>
                  </div>
                </div>

              </div>
            </div>

          </div>
        </div>
      </div>
    </div>

    <!-- ==================== TAB 4: FLEET & TARGET ASSIGNMENT ==================== -->
    <div id="tab-instances" class="tab-pane" role="tabpanel" tabindex="0" aria-labelledby="tabBtnInstances">
      <div class="card">
        <h2>
          <span data-i18n="titleFleetInstances">Флот корпоративной сети</span>
          <span id="badgeFleetOnline" class="badge badge-online">0 online</span>
          <span id="badgeFleetStale" class="badge badge-warning" style="display: none;" title="Данные флота не актуализированы из-за ошибки сети">Устарело</span>
        </h2>
        <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 14px;" data-i18n="subFleetInstances">
          Централизованное управление инстансами расширения, профилями и прокси-нодами
        </p>

        <div style="font-size: 14px; font-weight: 600; margin-bottom: 8px;" data-i18n="titleRegisteredDevices">Зарегистрированный флот</div>

        <!-- Floating / Anchored Bulk Actions Toolbar -->
        <div id="fleetBulkBar" class="fleet-bulk-bar" style="display: none;">
          <div class="fleet-bulk-left">
            <span class="fleet-bulk-badge"><span id="fleetSelectedCount">0</span> <span data-i18n="lblFleetSelected">выбрано</span></span>
          </div>
          <div class="fleet-bulk-actions">
            <div class="fleet-bulk-group">
              <select id="bulkAssignProxySelect" class="form-select form-select-sm" style="margin-bottom: 0; font-size: 12px; max-width: 180px;">
                <option value="" data-i18n="optBulkProxySelect">Выберите прокси...</option>
              </select>
              <button type="button" id="btnBulkAssignProxy" class="btn btn-sm btn-secondary" data-i18n="btnBulkAssignProxy">Назначить прокси</button>
            </div>
            <div class="fleet-bulk-group">
              <select id="bulkAssignProfileSelect" class="form-select form-select-sm" style="margin-bottom: 0; font-size: 12px; max-width: 180px;">
                <option value="" data-i18n="optBulkProfileSelect">Выберите профиль...</option>
              </select>
              <button type="button" id="btnBulkAssignProfile" class="btn btn-sm btn-secondary" data-i18n="btnBulkAssignProfile">Назначить профиль</button>
            </div>
            <button type="button" id="btnBulkRevokeTokens" class="btn btn-sm btn-warning" data-i18n="btnBulkRevokeTokens">Отозвать токены</button>
            <button type="button" id="btnBulkDelete" class="btn btn-sm btn-danger" data-i18n="btnBulkDelete">Удалить выбранные</button>
          </div>
        </div>

        <div class="table-container">
          <table id="instancesTable">
            <thead>
              <tr>
                <th style="width: 38px; text-align: center;"><input type="checkbox" id="fleetSelectAll" title="Выбрать все"></th>
                <th class="sortable-th" data-sort="id" tabindex="0" role="button" aria-sort="none"><span data-i18n="thInstId">Instance ID</span> <span class="sort-icon"></span></th>
                <th class="sortable-th" data-sort="user" tabindex="0" role="button" aria-sort="none"><span data-i18n="thInstUser">Пользователь</span> <span class="sort-icon"></span></th>
                <th class="sortable-th" data-sort="ip" tabindex="0" role="button" aria-sort="none"><span data-i18n="thInstIp">IP Address</span> <span class="sort-icon"></span></th>
                <th class="sortable-th" data-sort="version" tabindex="0" role="button" aria-sort="none"><span data-i18n="thInstVer">Version</span> <span class="sort-icon"></span></th>
                <th class="sortable-th" data-sort="group" tabindex="0" role="button" aria-sort="none"><span data-i18n="thInstGroup">Группа флота</span> <span class="sort-icon"></span></th>
                <th class="sortable-th" data-sort="profile" tabindex="0" role="button" aria-sort="none"><span data-i18n="thInstProfile">Assigned Profile</span> <span class="sort-icon"></span></th>
                <th class="sortable-th" data-sort="syncs" tabindex="0" role="button" aria-sort="none"><span data-i18n="thInstSyncs">Syncs</span> <span class="sort-icon"></span></th>
                <th class="sortable-th" data-sort="status" tabindex="0" role="button" aria-sort="none"><span data-i18n="thInstStatus">Status</span> <span class="sort-icon"></span></th>
                <th data-i18n="thInstAssign">Assign</th>
                <th data-i18n="thInstProxy">Прокси-сервер</th>
                <th data-i18n="thInstActions">Действия</th>
              </tr>
            </thead>
            <tbody id="fleetTableBody">
              <tr><td colspan="12" style="text-align: center; color: var(--text-muted);" data-i18n="txtNoFleet">Зарегистрированный флот отсутствует</td></tr>
            </tbody>
          </table>
        </div>

        <!-- ==================== DESKTOP CLIENTS (PEC-App) ==================== -->
        <div style="margin-top: 32px; padding-top: 20px; border-top: 1px solid var(--border-color, rgba(255,255,255,0.08));">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 10px;">
            <div>
              <h3 style="margin: 0; font-size: 16px; display: flex; align-items: center; gap: 8px;">
                <span>🖥️</span>
                <span data-i18n="titleDesktopClients">Десктопные клиенты PEC-App</span>
                <span id="badgeDesktopOnline" class="badge badge-online">0 online</span>
              </h3>
              <p style="font-size: 12px; color: var(--text-muted); margin: 4px 0 0 0;" data-i18n="subDesktopClients">
                Централизованное управление клиентами Windows, мониторинг версий и назначение прокси-нод
              </p>
            </div>
            <button type="button" id="btnRefreshDesktopFleet" class="btn btn-sm btn-secondary" style="font-size: 12px;">
              🔄 <span data-i18n="btnRefresh">Обновить</span>
            </button>
          </div>

          <div class="table-container">
            <table id="desktopInstancesTable">
              <thead>
                <tr>
                  <th style="width: 100px;">Статус</th>
                  <th>Компьютер / Хост</th>
                  <th>Пользователь ОС</th>
                  <th>IP Адрес</th>
                  <th>Версия</th>
                  <th>Привязанное расширение</th>
                  <th>Назначенный прокси</th>
                  <th>Последняя активность</th>
                  <th style="width: 80px; text-align: center;">Действия</th>
                </tr>
              </thead>
              <tbody id="desktopFleetTableBody">
                <tr><td colspan="9" style="text-align: center; color: var(--text-muted);" data-i18n="txtNoDesktopClients">Десктопные клиенты еще не подключались. Запустите PEC-App.exe на рабочей станции.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== TAB 4: GPO DEPLOYMENT ==================== -->
    <div id="tab-gpo" class="tab-pane" role="tabpanel" tabindex="0" aria-labelledby="tabBtnGpo">
      <div class="card" style="margin-bottom: 20px; border-left: 4px solid var(--primary); background: var(--card-bg);">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
          <div>
            <h2 style="margin-bottom: 4px;" data-i18n="titleGpoPackBanner">Комплексный пакет развертывания Active Directory GPO</h2>
            <p style="font-size: 13px; color: var(--text-muted); margin: 0;" data-i18n="descGpoPackBanner">
              Включает готовые .REG файлы (HKCU и HKLM) для всех 4 браузеров (Chrome, Edge, Яндекс, Opera), PowerShell скрипты deploy/verify, JSON-политики и руководство администратора.
            </p>
          </div>
          <div>
            <button onclick="downloadGpoPack()" class="btn" style="display: flex; align-items: center; gap: 8px; font-weight: 600;" data-i18n="btnDownloadGpoPack">
              <img src="/icons/package.png" class="icon-inline" alt="pack"> Скачать GPO Deployment Pack (.zip)
            </button>
          </div>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <h2 data-i18n="titleExtPackageInfo">Extension Identifiers & Package Info</h2>
          <div class="stat-row">
            <span class="stat-label" data-i18n="lblCalcExtId">Calculated Extension ID</span>
            <span class="stat-value" id="dispExtId" style="color: var(--primary);">Loading...</span>
          </div>
          <div class="stat-row">
            <span class="stat-label" data-i18n="lblManifestVer">Manifest Version</span>
            <span class="stat-value" id="dispExtVer">1.2.0</span>
          </div>
          <div class="stat-row">
            <span class="stat-label" data-i18n="lblRsaKey">RSA Private Key</span>
            <span class="stat-value" style="color: var(--success);">2048-bit RSA (extension/key.pem)</span>
          </div>
          <div class="stat-row">
            <span class="stat-label" data-i18n="lblUpdateManifest">Auto-Update Manifest</span>
            <span class="stat-value"><a href="/updates/updates.xml" target="_blank" style="color: var(--primary);">/updates/updates.xml</a></span>
          </div>
          <div style="margin-top: 16px;">
            <button onclick="downloadExtensionPackage('crx')" class="btn" style="font-size: 13px;" data-i18n="btnDownloadCrxPkg">Download .CRX Package</button>
            <button onclick="downloadExtensionPackage('zip')" class="btn-secondary" style="font-size: 13px; margin-left: 8px;" data-i18n="btnDownloadZipPkg">Download .ZIP</button>
          </div>

          <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.08); margin: 20px 0 16px 0;">

          <h2 style="font-size: 14px;" data-i18n="titleGpoScripts">PowerShell скрипты автоматизации</h2>
          <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;" data-i18n="descGpoScripts">
            Скрипты для использования в качестве Logon/Startup скриптов GPO и проверки рабочего места.
          </p>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button onclick="downloadScriptFile('deploy')" class="btn-secondary" style="font-size: 12px;" data-i18n="btnDownloadDeployPs">
              <img src="/icons/download.png" class="icon-inline" alt="dl"> deploy-pec-gpo.ps1
            </button>
            <button onclick="downloadScriptFile('verify')" class="btn-secondary" style="font-size: 12px;" data-i18n="btnDownloadVerifyPs">
              <img src="/icons/check.png" class="icon-inline" alt="chk"> verify-pec-gpo.ps1
            </button>
          </div>
        </div>

        <div class="card">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
            <h2 style="margin: 0;" data-i18n="titleAdGpoSettings">Active Directory GPO Settings</h2>
            <div style="display: flex; gap: 4px; background: var(--card-inner); padding: 3px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.08);">
              <button id="scopeBtnUser" type="button" class="btn-secondary" style="padding: 3px 8px; font-size: 11px; font-weight: 600; border: none; background: var(--primary); color: #fff;" onclick="setGpoScope('user')">HKCU (Пользователь / RDS)</button>
              <button id="scopeBtnMachine" type="button" class="btn-secondary" style="padding: 3px 8px; font-size: 11px; font-weight: 600; border: none; opacity: 0.6;" onclick="setGpoScope('machine')">HKLM (Компьютер)</button>
            </div>
          </div>

          <div style="display: flex; gap: 6px; margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 8px;">
            <button id="gpoBrowserChrome" type="button" class="btn-secondary active" style="font-size: 11px; padding: 4px 10px; border-color: var(--primary);" onclick="setGpoBrowser('chrome')">Google Chrome</button>
            <button id="gpoBrowserEdge" type="button" class="btn-secondary" style="font-size: 11px; padding: 4px 10px; opacity: 0.7;" onclick="setGpoBrowser('edge')">Microsoft Edge</button>
            <button id="gpoBrowserYandex" type="button" class="btn-secondary" style="font-size: 11px; padding: 4px 10px; opacity: 0.7;" onclick="setGpoBrowser('yandex')">Яндекс.Браузер</button>
            <button id="gpoBrowserOpera" type="button" class="btn-secondary" style="font-size: 11px; padding: 4px 10px; opacity: 0.7;" onclick="setGpoBrowser('opera')">Opera</button>
          </div>

          <div style="background: rgba(43, 114, 226, 0.08); border-left: 3px solid var(--primary); padding: 8px 12px; border-radius: 4px; margin-bottom: 12px; font-size: 11px; line-height: 1.45;">
            <strong>Конфигурация по умолчанию (проверено в боевой среде):</strong><br>
            <code>Конфигурация пользователя → Настройка → Конфигурация Windows → Реестр</code><br>
            <span style="color: var(--text-muted);">
              • GPO применяется к <strong>OU с целевыми ПК</strong> (с включенным Loopback Processing)<br>
              • Управление через <strong>Группу AD в фильтрах безопасности</strong><br>
              • В делегировании <strong>ОБЯЗАТЕЛЬНО</strong> указать <strong>Authenticated Users</strong> («Прошедшие проверку») на Чтение (MS16-072 / KB3163622).
            </span>
          </div>

          <div id="gpoYandexAlert" style="display: none; background: rgba(234, 179, 8, 0.12); border: 1px solid rgba(234, 179, 8, 0.4); padding: 8px 12px; border-radius: 6px; margin-bottom: 12px; font-size: 11px; color: #facc15; line-height: 1.4;">
            ⚠️ <strong>Критично для Яндекс.Браузера:</strong> если версия браузера не управляется через корпоративную консоль Яндекса, режим <code>force_installed</code> ставить нельзя (расширение будет отключено внутренней системой безопасности). Используется проверенный боевой режим <code>normal_installed</code>.
          </div>

          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">
            <span data-i18n="lblGpoActivePath">Ветка реестра:</span>
            <code id="gpoActiveRegKey" style="color: var(--primary); font-size: 11px; word-break: break-all;">HKEY_CURRENT_USER\Software\Policies\Google\Chrome</code>
          </div>

          <label for="gpoForcelist" data-i18n="lblGpoForcelist">1. ExtensionInstallForcelist Entry</label>
          <div style="display: flex; gap: 6px; align-items: stretch; margin-bottom: 10px;">
            <pre id="gpoForcelist" style="flex: 1; margin: 0; white-space: pre-wrap; word-break: break-all;">Loading...</pre>
            <button class="btn-secondary" style="font-size: 11px; padding: 0 10px;" onclick="copyGpoForcelist()" data-i18n="btnCopy">Copy</button>
          </div>

          <label for="gpoSettings" data-i18n="lblGpoSettings">2. ExtensionSettings (JSON)</label>
          <div style="display: flex; gap: 6px; align-items: stretch; margin-bottom: 14px;">
            <pre id="gpoSettings" style="flex: 1; max-height: 120px; margin: 0; white-space: pre-wrap; word-break: break-all;">Loading...</pre>
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <button class="btn-secondary" style="font-size: 11px; padding: 0 10px; flex: 1;" onclick="copyGpoSettings()" title="Копировать отформатированный JSON" data-i18n="btnCopy">Copy JSON</button>
              <button class="btn-secondary" style="font-size: 10px; padding: 0 8px; flex: 1;" onclick="copyGpoRegSz()" title="Копировать строку для вставки в GPMC REG_SZ">Copy REG_SZ</button>
            </div>
          </div>

          <div>
            <button onclick="downloadRegFile()" class="btn-secondary" style="font-size: 12px;" data-i18n="btnDownloadReg">
              <img src="/icons/download.png" class="icon-inline" alt="dl"> <span id="lblDownloadRegBtn">Скачать Windows .REG файл (HKCU)</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== TAB 6: AUDIT & TESTER ==================== -->
    <div id="tab-logs" class="tab-pane" role="tabpanel" tabindex="0" aria-labelledby="tabBtnLogs">
      <div class="grid-2">
        <div class="card">
          <h2 data-i18n="titleCredsTester">Interactive /creds Tester</h2>
          <label for="testTokenInput" data-i18n="lblTestToken">X-Ext-Token Header Value</label>
          <input type="password" id="testTokenInput" value="" placeholder="paste token to test" autocomplete="off" />
          <div style="display: flex; gap: 8px; margin-bottom: 12px;">
            <button onclick="testCredsEndpoint()" data-i18n="btnSendCreds">Send GET /creds</button>
            <button class="btn-secondary" onclick="document.getElementById('testTokenInput').value = 'wrong-token'; testCredsEndpoint();" data-i18n="btnTestInvalidToken">Test Invalid Token</button>
          </div>
          <pre id="testCredsOutput" style="min-height: 100px;">// Click to test /creds</pre>
        </div>

        <div class="card">
          <h2 data-i18n="titleSyncTester">Interactive /api/sync Tester</h2>
          <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 10px;" data-i18n="subSyncTester">
            Simulate a Chrome extension heartbeat sync:
          </p>
          <button onclick="testSyncEndpoint()" data-i18n="btnSendSync">Send POST /api/sync</button>
          <pre id="testSyncOutput" style="min-height: 100px; margin-top: 12px;">// Click to test sync</pre>
        </div>
      </div>

      <div class="card">
        <h2 data-i18n="titleAuditLogs">Access & Security Audit Logs</h2>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th data-i18n="thLogTime">Timestamp</th>
                <th data-i18n="thLogIp">IP Address</th>
                <th data-i18n="thLogEndpoint">Endpoint</th>
                <th data-i18n="thLogStatus">Status</th>
                <th data-i18n="thLogResult">Result</th>
                <th data-i18n="thLogDetails">Details</th>
              </tr>
            </thead>
            <tbody id="auditTableBody">
              <tr><td colspan="6" style="text-align: center; color: var(--text-muted);" data-i18n="txtLoadingLogs">Loading logs...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ==================== TAB 8: RELEASES & ROLLBACK ==================== -->
    <div id="tab-releases" class="tab-pane" role="tabpanel" tabindex="0" aria-labelledby="tabBtnReleases">
      <div class="card" style="margin-bottom: 20px; border-left: 4px solid var(--primary); background: var(--card-bg);">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
          <div>
            <h2 style="margin-bottom: 4px;" data-i18n="titleReleasesBanner">Управление релизами и моментальный откат версий</h2>
            <p style="font-size: 13px; color: var(--text-muted); margin: 0;" data-i18n="descReleasesBanner">
              Архив всех собранных версий браузерных расширений (.crx) и десктоп-клиентов (.zip). Позволяет в один клик переключить активную версию для отката в случае проблемного обновления.
            </p>
          </div>
          <div>
            <button onclick="loadReleases()" class="btn btn-secondary" style="display: flex; align-items: center; gap: 8px; font-weight: 600;" data-i18n="btnRefreshReleases">
              🔄 Обновить релизы
            </button>
          </div>
        </div>
      </div>

      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
          <h2>
            <span data-i18n="titleReleasesTable">История релизов</span>
            <span id="activeReleasesBadges" style="margin-left: 12px; font-size: 12px; font-weight: normal;"></span>
          </h2>
          <div style="display: flex; gap: 8px;">
            <select id="releasesFilterType" onchange="filterReleases()" class="form-select form-select-sm" style="margin-bottom: 0; font-size: 12px;">
              <option value="all">Все компоненты</option>
              <option value="extension">Расширения (.crx)</option>
              <option value="app">Десктоп (.zip)</option>
            </select>
          </div>
        </div>

        <div class="table-container">
          <table id="releasesTable">
            <thead>
              <tr>
                <th data-i18n="thRelType">Тип</th>
                <th data-i18n="thRelVer">Версия</th>
                <th data-i18n="thRelDate">Дата сборки</th>
                <th data-i18n="thRelSha">SHA-256</th>
                <th data-i18n="thRelStatus">Статус</th>
                <th data-i18n="thRelActions">Действия</th>
              </tr>
            </thead>
            <tbody id="releasesTableBody">
              <tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Загрузка релизов...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

  </div>

  <!-- Fullscreen Authentication & Onboarding Screen -->
  <div id="authScreen" class="auth-screen-backdrop">
    <div class="auth-card-modal">
      <div style="display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 20px;">
        <img src="/icons/lock.png" class="icon-inline" style="width: 32px; height: 32px;" alt="PEC Auth">
        <span style="font-size: 19px; font-weight: 700; color: var(--text); letter-spacing: -0.3px;">PEC Management</span>
      </div>

      <!-- Step 1: Admin Token (Initial Setup) -->
      <div id="authStepToken" style="display: none;">
        <div style="display: inline-block; padding: 3px 10px; border-radius: 9999px; background: rgba(var(--primary-rgb), 0.15); color: var(--primary); font-size: 11px; font-weight: 600; text-transform: uppercase; margin-bottom: 12px; letter-spacing: 0.5px;">Шаг 1 из 2 &bull; Первичная настройка</div>
        <h2 style="margin: 0 0 8px 0; font-size: 18px; color: var(--text);">Инициализация сервера</h2>
        <p style="color: var(--text-muted); font-size: 12.5px; line-height: 1.5; margin: 0 0 18px 0;">Для первого входа введите <code>ADMIN_TOKEN</code> из конфигурации (.env) сервера.</p>
        <label for="authTokenInput" style="display: block; font-size: 10.5px; text-transform: uppercase; color: var(--text-muted); font-weight: 600; margin-bottom: 6px; text-align: left;">Admin Token</label>
        <input type="password" id="authTokenInput" class="auth-input" placeholder="Введите ADMIN_TOKEN" autocomplete="off" />
        <div id="authTokenError" style="display: none; color: var(--danger); background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 6px; padding: 8px 12px; font-size: 12px; margin-bottom: 12px; text-align: left;"></div>
        <button id="btnAuthVerifyToken" style="width: 100%;">Подтвердить токен &rarr;</button>
      </div>

      <!-- Step 2: Set Username & Password (Initial Setup) -->
      <div id="authStepCredentials" style="display: none;">
        <div style="display: inline-block; padding: 3px 10px; border-radius: 9999px; background: rgba(16, 185, 129, 0.15); color: var(--success); font-size: 11px; font-weight: 600; text-transform: uppercase; margin-bottom: 12px; letter-spacing: 0.5px;">Шаг 2 из 2 &bull; Учётная запись</div>
        <h2 style="margin: 0 0 8px 0; font-size: 18px; color: var(--text);">Создание учётной записи</h2>
        <p style="color: var(--text-muted); font-size: 12.5px; line-height: 1.5; margin: 0 0 16px 0;">Задайте логин и пароль для постоянного входа. После сохранения потребуется войти с новыми данными.</p>
        <label for="authNewUsername" style="display: block; font-size: 10.5px; text-transform: uppercase; color: var(--text-muted); font-weight: 600; margin-bottom: 6px; text-align: left;">Логин администратора</label>
        <input type="text" id="authNewUsername" class="auth-input" placeholder="admin" autocomplete="username" />
        <label for="authNewPassword" style="display: block; font-size: 10.5px; text-transform: uppercase; color: var(--text-muted); font-weight: 600; margin-bottom: 6px; text-align: left;">Пароль (от 8 символов)</label>
        <input type="password" id="authNewPassword" class="auth-input" placeholder="••••••••" autocomplete="new-password" />
        <label for="authNewPasswordConfirm" style="display: block; font-size: 10.5px; text-transform: uppercase; color: var(--text-muted); font-weight: 600; margin-bottom: 6px; text-align: left;">Повторите пароль</label>
        <input type="password" id="authNewPasswordConfirm" class="auth-input" placeholder="••••••••" autocomplete="new-password" />
        <div id="authCredsError" style="display: none; color: var(--danger); background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 6px; padding: 8px 12px; font-size: 12px; margin-bottom: 12px; text-align: left;"></div>
        <button id="btnAuthSaveCredentials" style="width: 100%;">Сохранить и перейти ко входу</button>
      </div>

      <!-- Step 3: Regular Login -->
      <div id="authStepLogin" style="display: none;">
        <div id="authSetupSuccessBanner" style="display: none; color: var(--success); background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 6px; padding: 8px 12px; font-size: 12px; margin-bottom: 14px; text-align: left;">Учётная запись создана! Войдите с новым логином и паролем.</div>
        <h2 style="margin: 0 0 8px 0; font-size: 18px; color: var(--text);">Вход в консоль</h2>
        <p style="color: var(--text-muted); font-size: 12.5px; line-height: 1.5; margin: 0 0 16px 0;">Введите логин и пароль администратора для входа в консоль управления PEC.</p>
        <label for="loginUsernameInput" style="display: block; font-size: 10.5px; text-transform: uppercase; color: var(--text-muted); font-weight: 600; margin-bottom: 6px; text-align: left;">Логин</label>
        <input type="text" id="loginUsernameInput" class="auth-input" placeholder="Логин" autocomplete="username" />
        <label for="loginTokenInput" style="display: block; font-size: 10.5px; text-transform: uppercase; color: var(--text-muted); font-weight: 600; margin-bottom: 6px; text-align: left;">Пароль</label>
        <input type="password" id="loginTokenInput" class="auth-input" placeholder="Пароль" autocomplete="current-password" />
        <div id="loginError" style="display: none; color: var(--danger); background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 6px; padding: 8px 12px; font-size: 12px; margin-bottom: 12px; text-align: left;"></div>
        <button id="loginSubmitBtn" style="width: 100%;">Войти</button>
      </div>
    </div>
  </div>

  <div id="credsModal" class="modal-backdrop-theme">
    <div class="modal-card-theme" style="max-width: 440px; width: 90%; padding: 28px;">
      <h2 style="margin: 0 0 8px 0; font-size: 17px; text-align: center; display: flex; align-items: center; justify-content: center; gap: 8px;"><img src="/icons/key.png" class="icon-inline" alt="key"> <span>Учётная запись администратора</span></h2>
      <p style="color: var(--text-muted); font-size: 12px; margin: 0 0 16px 0; text-align: center;">Смена логина и/или пароля панели. Требуется текущий пароль; после сохранения все прочие сессии будут завершены.</p>
      <label for="credCurrentPassword" style="text-transform: uppercase; font-size: 10.5px; color: var(--text-muted);">Текущий пароль</label>
      <input type="password" id="credCurrentPassword" autocomplete="current-password" style="width: 100%; box-sizing: border-box; margin-bottom: 12px;" />
      <label for="credUsernameInput" style="text-transform: uppercase; font-size: 10.5px; color: var(--text-muted);">Новый логин</label>
      <input type="text" id="credUsernameInput" autocomplete="username" style="width: 100%; box-sizing: border-box; margin-bottom: 12px;" />
      <label for="credNewPassword" style="text-transform: uppercase; font-size: 10.5px; color: var(--text-muted);">Новый пароль (мин. 8 символов, пусто = не менять)</label>
      <input type="password" id="credNewPassword" autocomplete="new-password" style="width: 100%; box-sizing: border-box; margin-bottom: 12px;" />
      <div id="credError" style="display: none; color: var(--danger); font-size: 12px; margin-bottom: 10px;"></div>
      <div style="display: flex; gap: 8px;">
        <button id="credSubmitBtn" style="flex: 1;">Сохранить</button>
        <button id="credCancelBtn" class="btn-secondary" style="flex: 1;">Отмена</button>
      </div>
    </div>
  </div>

  <!-- Modal: Add Proxy from 3x-ui by Tag -->
  <div id="modalAdd3xui" class="modal-backdrop-theme">
    <div class="modal-card-theme" style="max-width: 500px; width: 90%; padding: 24px;">
      <h2 style="margin: 0 0 12px 0; font-size: 17px;" data-i18n="titleAdd3xui">Add Proxy from 3x-ui by Inbound Tag</h2>
      <p style="color: var(--text-muted); font-size: 12px; margin: 0 0 16px 0;" data-i18n="subAdd3xui">Enter inbound tag configured in your 3x-ui panel to fetch and link credentials.</p>

      <div style="margin-bottom: 12px;">
        <label for="add3xuiPanelSelect" style="text-transform: uppercase; font-size: 10.5px; color: var(--text-muted);">Панель 3x-ui / Source Panel</label>
        <select id="add3xuiPanelSelect" style="width: 100%; box-sizing: border-box; margin-bottom: 0;">
          <option value="">По умолчанию (Настройки ротации)</option>
        </select>
      </div>

      <label for="add3xuiTag" style="text-transform: uppercase; font-size: 10.5px; color: var(--text-muted);" data-i18n="lblAdd3xuiTag">Inbound Tag</label>
      <div style="display: flex; gap: 8px; margin-bottom: 12px;">
        <input type="text" id="add3xuiTag" placeholder="corp-socks" data-i18n-ph="phAdd3xuiTag" style="flex: 1; margin-bottom: 0;" />
        <button type="button" id="btnAdd3xuiFetch" onclick="lookup3xuiInbound()" class="btn-secondary" style="font-size: 12px; white-space: nowrap;" data-i18n="btnFetchInbound">Fetch Info</button>
      </div>

      <!-- Inbound preview box -->
      <div id="add3xuiPreview" style="background: var(--card-inner); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; margin-bottom: 14px; font-size: 12px; color: var(--text-muted);">
        <span data-i18n="txtInboundPreviewPlaceholder">Click "Fetch Info" to preview inbound parameters before adding.</span>
      </div>

      <label for="add3xuiName" style="text-transform: uppercase; font-size: 10.5px; color: var(--text-muted);" data-i18n="lblAdd3xuiName">Friendly Name (optional)</label>
      <input type="text" id="add3xuiName" placeholder="Production SOCKS5 Node" data-i18n-ph="phAdd3xuiName" style="width: 100%; box-sizing: border-box; margin-bottom: 12px;" />

      <label for="add3xuiHost" style="text-transform: uppercase; font-size: 10.5px; color: var(--text-muted);" data-i18n="lblAdd3xuiHost">Host Override (optional)</label>
      <input type="text" id="add3xuiHost" placeholder="10.0.0.1 or proxy.corp.local" data-i18n-ph="phAdd3xuiHost" style="width: 100%; box-sizing: border-box; margin-bottom: 14px;" />

      <label for="add3xuiIsActive" style="display: flex; align-items: center; gap: 8px; font-size: 12px; text-transform: none; font-weight: normal; cursor: pointer; margin-bottom: 16px;">
        <input type="checkbox" id="add3xuiIsActive" checked style="width: auto; margin-bottom: 0;" />
        <span data-i18n="lblMakeActive">Make this proxy active immediately</span>
      </label>

      <div id="add3xuiError" style="display: none; color: var(--danger); font-size: 12px; margin-bottom: 12px;"></div>

      <div style="display: flex; gap: 8px;">
        <button type="button" id="btnAdd3xuiSubmit" onclick="submitAdd3xuiProxy()" style="flex: 1;" data-i18n="btnAdd3xuiSubmit">Add 3x-ui Proxy</button>
        <button type="button" onclick="closeAdd3xuiModal()" class="btn-secondary" style="flex: 1;" data-i18n="btnCancel">Cancel</button>
      </div>
    </div>
  </div>

  <!-- Modal: Add / Edit 3x-ui Panel -->
  <div id="modal3xuiPanel" class="modal-backdrop-theme" style="display: none;">
    <div class="modal-card-theme" style="max-width: 500px; width: 90%; padding: 24px;">
      <h2 id="modal3xuiPanelTitle" style="margin: 0 0 12px 0; font-size: 17px;">Панель 3x-ui / 3x-ui Panel</h2>
      <input type="hidden" id="panelIdInput" value="" />

      <label for="panelName" style="text-transform: uppercase; font-size: 10.5px; color: var(--text-muted);">Название / Name</label>
      <input type="text" id="panelName" placeholder="Frankfurt Node" style="width: 100%; box-sizing: border-box; margin-bottom: 12px;" />

      <label for="panelUrl" style="text-transform: uppercase; font-size: 10.5px; color: var(--text-muted);">URL панели / Panel URL</label>
      <input type="text" id="panelUrl" placeholder="https://3xui.example.corp:2053/path" style="width: 100%; box-sizing: border-box; margin-bottom: 12px;" />

      <div class="grid-form-2col" style="margin-bottom: 12px;">
        <div>
          <label for="panelUser" style="text-transform: uppercase; font-size: 10.5px; color: var(--text-muted);">Admin User</label>
          <input type="text" id="panelUser" placeholder="admin" style="width: 100%; box-sizing: border-box; margin-bottom: 0;" />
        </div>
        <div>
          <label for="panelPass" style="text-transform: uppercase; font-size: 10.5px; color: var(--text-muted);">Admin Pass</label>
          <input type="password" id="panelPass" placeholder="••••••••" style="width: 100%; box-sizing: border-box; margin-bottom: 0;" />
        </div>
      </div>

      <label for="panelInsecureTls" style="display: flex; align-items: center; gap: 8px; font-size: 12px; text-transform: none; font-weight: normal; cursor: pointer; margin-bottom: 16px;">
        <input type="checkbox" id="panelInsecureTls" style="width: auto; margin-bottom: 0;" />
        <span>Разрешить самоподписанный / не доверенный TLS</span>
      </label>

      <div id="panelModalError" style="display: none; color: var(--danger); font-size: 12px; margin-bottom: 12px;"></div>

      <div style="display: flex; gap: 8px;">
        <button type="button" id="btnSave3xuiPanel" style="flex: 1;">Сохранить панель</button>
        <button type="button" id="btnCancel3xuiPanel" class="btn-secondary" style="flex: 1;">Отмена</button>
      </div>
    </div>
  </div>

  <!-- Modal: Add Manual or Edit Proxy Form -->
  <div id="modalProxyForm" class="modal-backdrop-theme">
    <div class="modal-card-theme" style="max-width: 480px; width: 90%; padding: 24px;">
      <form id="proxyForm" onsubmit="submitProxyForm(); return false;">
      <h2 id="proxyFormTitle" style="margin: 0 0 12px 0; font-size: 17px;" data-i18n="titleAddManualProxy">Add Manual Proxy Node</h2>
      <input type="hidden" id="proxyFormId" value="" />

      <div class="grid-form-2col" style="margin-bottom: 10px;">
        <div>
          <label for="proxyFormTag" style="text-transform: uppercase; font-size: 10.5px; color: var(--text-muted);" data-i18n="lblProxyTag">Tag</label>
          <input type="text" id="proxyFormTag" placeholder="manual-us-1" data-i18n-ph="phProxyTag" style="width: 100%; box-sizing: border-box; margin-bottom: 0;" />
        </div>
        <div>
          <label for="proxyFormName" style="text-transform: uppercase; font-size: 10.5px; color: var(--text-muted);" data-i18n="lblProxyName">Friendly Name</label>
          <input type="text" id="proxyFormName" placeholder="Backup US Gateway" data-i18n-ph="phProxyName" style="width: 100%; box-sizing: border-box; margin-bottom: 0;" />
        </div>
      </div>

      <div class="grid-form-1-2-1" style="margin-bottom: 10px;">
        <div>
          <label for="proxyFormProtocol" style="text-transform: uppercase; font-size: 10.5px; color: var(--text-muted);" data-i18n="lblProxyProtocol">Protocol</label>
          <select id="proxyFormProtocol" style="width: 100%; box-sizing: border-box; margin-bottom: 0;">
            <option value="http">HTTP</option>
            <option value="socks5">SOCKS5</option>
            <option value="https">HTTPS</option>
          </select>
        </div>
        <div>
          <label for="proxyFormHost" style="text-transform: uppercase; font-size: 10.5px; color: var(--text-muted);" data-i18n="lblProxyHost">Host / IP</label>
          <input type="text" id="proxyFormHost" placeholder="192.168.1.100" data-i18n-ph="phProxyHost" style="width: 100%; box-sizing: border-box; margin-bottom: 0;" />
        </div>
        <div>
          <label for="proxyFormPort" style="text-transform: uppercase; font-size: 10.5px; color: var(--text-muted);" data-i18n="lblProxyPort">Port</label>
          <input type="number" id="proxyFormPort" placeholder="10809" data-i18n-ph="phProxyPort" min="1" max="65535" style="width: 100%; box-sizing: border-box; margin-bottom: 0;" />
        </div>
      </div>

      <div class="grid-form-2col" style="margin-bottom: 12px;">
        <div>
          <label for="proxyFormUser" style="text-transform: uppercase; font-size: 10.5px; color: var(--text-muted);" data-i18n="lblProxyUser">Username</label>
          <input type="text" id="proxyFormUser" placeholder="proxyuser" data-i18n-ph="phProxyUser" style="width: 100%; box-sizing: border-box; margin-bottom: 0;" />
        </div>
        <div>
          <label for="proxyFormPass" style="text-transform: uppercase; font-size: 10.5px; color: var(--text-muted);" data-i18n="lblProxyPass">Password</label>
          <input type="password" id="proxyFormPass" placeholder="••••••••" style="width: 100%; box-sizing: border-box; margin-bottom: 0;" />
        </div>
      </div>

      <div id="proxyFormSocksWarning" style="display: none; background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 6px; padding: 8px 10px; margin-bottom: 12px; font-size: 11px; color: #f59e0b; line-height: 1.4; align-items: center; gap: 6px;">
        <img src="/icons/warning.png" class="icon-inline" alt="warn">
        <span data-i18n="warnChromiumSocks5Auth">Warning: Chromium browsers (Chrome, Edge, Yandex) do not support username/password authentication for SOCKS5. For Chrome with auth, use HTTP protocol.</span>
      </div>

      <label for="proxyFormIsActive" style="display: flex; align-items: center; gap: 8px; font-size: 12px; text-transform: none; font-weight: normal; cursor: pointer; margin-bottom: 16px;">
        <input type="checkbox" id="proxyFormIsActive" checked style="width: auto; margin-bottom: 0;" />
        <span data-i18n="lblMakeActive">Make this proxy active immediately</span>
      </label>

      <div id="proxyFormError" style="display: none; color: #ef4444; font-size: 12px; margin-bottom: 12px;"></div>

      <div style="display: flex; gap: 8px;">
        <button type="button" id="btnProxyFormSubmit" onclick="submitProxyForm()" style="flex: 1;" data-i18n="btnSaveProxy">Save Proxy</button>
        <button type="button" id="btnProxyFormCancel" onclick="closeProxyFormModal()" class="btn-secondary" style="flex: 1;" data-i18n="btnCancel">Cancel</button>
      </div>
      </form>
    </div>
  </div>

  <!-- Modal: Edit Routing Profile Rule -->
  <div id="modalEditRule" class="modal-backdrop-theme" style="display: none;">
    <div class="modal-card-theme" style="max-width: 500px; width: 90%; padding: 24px;">
      <h2 id="modalEditRuleTitle" style="margin: 0 0 12px 0; font-size: 17px;" data-i18n="titleEditRule">Edit Routing Rule</h2>
      <input type="hidden" id="editRuleIndex" value="" />

      <div style="margin-bottom: 12px;">
        <label for="editRuleName" style="text-transform: uppercase; font-size: 10.5px; color: var(--text-muted);" data-i18n="lblRuleName">Rule Name</label>
        <input type="text" id="editRuleName" placeholder="My Custom Rule" data-i18n-ph="phRuleName" style="width: 100%; box-sizing: border-box; margin-bottom: 0;" />
      </div>

      <div style="margin-bottom: 12px;">
        <label for="editRulePattern" style="text-transform: uppercase; font-size: 10.5px; color: var(--text-muted);" data-i18n="lblRulePattern">Pattern (comma separated domains or CIDRs)</label>
        <input type="text" id="editRulePattern" placeholder="*.example.com, target-domain.org, 10.50.0.0/16" data-i18n-ph="phRulePattern" style="width: 100%; box-sizing: border-box; margin-bottom: 0;" />
      </div>

      <div style="margin-bottom: 16px;">
        <label for="editRuleAction" style="text-transform: uppercase; font-size: 10.5px; color: var(--text-muted);" data-i18n="lblRuleAction">Action</label>
        <select id="editRuleAction" style="width: 100%; box-sizing: border-box; margin-bottom: 0;">
          <option value="proxy" data-i18n="optActionProxy">PROXY</option>
          <option value="direct" data-i18n="optActionDirect">DIRECT</option>
          <option value="block" data-i18n="optActionBlock">BLOCK (Sinkhole)</option>
        </select>
      </div>

      <div id="editRuleError" style="display: none; color: var(--danger); font-size: 12px; margin-bottom: 12px;"></div>

      <div style="display: flex; gap: 8px;">
        <button type="button" id="btnSaveEditedRule" onclick="saveEditedRule()" style="flex: 1;" data-i18n="btnSave">Save</button>
        <button type="button" id="btnCancelEditRule" onclick="closeEditRuleModal()" class="btn-secondary" style="flex: 1;" data-i18n="btnCancel">Cancel</button>
      </div>
    </div>
  </div>

  <!-- Modal: Geobase Inspector -->
  <div id="modalGeobaseInspector" class="modal-geobase-inspector" style="display: none;">
    <div class="modal-geobase-inspector-content" style="background: var(--card-inner); color: var(--text);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border);">
        <div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <h2 id="inspectorTitle" style="margin: 0; font-size: 17px;">Geobase Inspector</h2>
            <span id="inspectorTypeBadge" class="badge badge-action-proxy" style="font-size: 10px;">DOMAIN</span>
          </div>
          <p id="inspectorSubtitle" style="margin: 2px 0 0 0; font-size: 12px; color: var(--text-muted);">Inspection and cherry-picking of preset entries</p>
        </div>
        <button type="button" onclick="closeGeobaseInspector()" class="btn-icon" title="Close" style="font-size: 18px; line-height: 1;">&times;</button>
      </div>

      <!-- Search & Filter Bar -->
      <div style="margin-bottom: 10px;">
        <input type="text" id="inspectorSearch" class="inspector-search-input" placeholder="Поиск по доменам или CIDR..." oninput="filterInspectorEntries()" />
      </div>

      <!-- Batch Selection Controls -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; font-size: 12px;">
        <div style="display: flex; gap: 8px; align-items: center;">
          <button type="button" class="btn-secondary" style="font-size: 11px; padding: 3px 8px;" onclick="selectInspectorAll(true)">Выбрать все</button>
          <button type="button" class="btn-secondary" style="font-size: 11px; padding: 3px 8px;" onclick="selectInspectorAll(false)">Снять выбор</button>
          <span id="inspectorSelectedCount" style="color: var(--text-muted); font-size: 11px;">Выбрано: 0</span>
        </div>
        <span id="inspectorTotalCount" style="color: var(--text-muted); font-size: 11px;">Всего записей: 0</span>
      </div>

      <!-- Scrollable Entries Table -->
      <div class="inspector-table-container">
        <table class="inspector-table">
          <thead>
            <tr>
              <th style="width: 36px;"><input type="checkbox" id="inspectorSelectAllBox" onchange="selectInspectorAll(this.checked)" /></th>
              <th>Pattern / Entry</th>
              <th style="width: 80px;">Type</th>
            </tr>
          </thead>
          <tbody id="inspectorTableBody">
            <tr><td colspan="3" style="text-align: center; color: var(--text-muted);">Загрузка содержимого пресета...</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Action Footer -->
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; padding-top: 12px; border-top: 1px solid var(--border);">
        <div style="display: flex; align-items: center; gap: 8px;">
          <label for="inspectorActionSelect" style="margin: 0; font-size: 12px; font-weight: 600;">Действие:</label>
          <select id="inspectorActionSelect" style="margin: 0; font-size: 12px; width: auto;">
            <option value="proxy">PROXY</option>
            <option value="direct">DIRECT</option>
            <option value="block">BLOCK</option>
          </select>
        </div>
        <div style="display: flex; gap: 8px;">
          <button type="button" id="btnAddSelectedToProfile" onclick="addSelectedToProfile()" style="font-size: 12px;">Добавить выбранные в профиль</button>
          <button type="button" onclick="closeGeobaseInspector()" class="btn-secondary" style="font-size: 12px;">Закрыть</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Modal: Import Presets -->
  <div id="modalImportPresets" class="modal-import-presets" style="display: none;">
    <div class="modal-import-presets-content" style="background: var(--card-inner); color: var(--text);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border);">
        <div>
          <h2 style="margin: 0; font-size: 17px;" data-i18n="titleImportPresets">Import GeoData & Presets</h2>
          <p style="margin: 2px 0 0 0; font-size: 12px; color: var(--text-muted);" data-i18n="subImportPresets">Import geosite.dat, geoip.dat or plaintext domain lists</p>
        </div>
        <button type="button" onclick="closeImportPresetsModal()" class="btn-icon" title="Close" style="font-size: 18px; line-height: 1;">&times;</button>
      </div>

      <!-- Tabs: URL vs File -->
      <div style="display: flex; gap: 8px; margin-bottom: 14px; border-bottom: 1px solid var(--border); padding-bottom: 8px;">
        <button type="button" id="tabImportUrlBtn" class="tab-btn active" onclick="switchImportTab('url')" style="font-size: 12px; padding: 4px 10px;">URL Import</button>
        <button type="button" id="tabImportFileBtn" class="tab-btn" onclick="switchImportTab('file')" style="font-size: 12px; padding: 4px 10px;">File Upload (.dat / .txt)</button>
      </div>

      <!-- Panel: URL Import -->
      <div id="panelImportUrl">
        <label for="importPresetUrl" style="text-transform: uppercase; font-size: 10.5px; color: var(--text-muted);">URL Источника (.dat или .txt)</label>
        <input type="text" id="importPresetUrl" placeholder="https://raw.githubusercontent.com/.../geosite.dat" style="width: 100%; box-sizing: border-box; margin-bottom: 12px;" />
      </div>

      <!-- Panel: File Upload -->
      <div id="panelImportFile" style="display: none;">
        <label for="importPresetFileInput" style="text-transform: uppercase; font-size: 10.5px; color: var(--text-muted);">Файл на диске (.dat или .txt)</label>
        <input type="file" id="importPresetFileInput" accept=".dat,.txt,.list" style="width: 100%; box-sizing: border-box; margin-bottom: 12px;" />
      </div>

      <!-- Common fields: Tag, Name, Category, Type -->
      <div class="grid-form-2col" style="margin-bottom: 12px;">
        <div>
          <label for="importPresetTag" style="text-transform: uppercase; font-size: 10.5px; color: var(--text-muted);">Тег списка (для .dat, например RU, GOOGLE, TELEGRAM)</label>
          <input type="text" id="importPresetTag" placeholder="RU" style="width: 100%; box-sizing: border-box; margin-bottom: 0;" />
        </div>
        <div>
          <label for="importPresetName" style="text-transform: uppercase; font-size: 10.5px; color: var(--text-muted);">Название пресета (опционально)</label>
          <input type="text" id="importPresetName" placeholder="My Imported Preset" style="width: 100%; box-sizing: border-box; margin-bottom: 0;" />
        </div>
      </div>

      <div class="grid-form-2col" style="margin-bottom: 14px;">
        <div>
          <label for="importPresetCategory" style="text-transform: uppercase; font-size: 10.5px; color: var(--text-muted);">Категория</label>
          <select id="importPresetCategory" style="width: 100%; box-sizing: border-box; margin-bottom: 0;">
            <option value="custom">Custom</option>
            <option value="ru">RU Services</option>
            <option value="ai">AI / LLM</option>
            <option value="social">Social & Media</option>
            <option value="security">Security & Ads</option>
          </select>
        </div>
        <div>
          <label for="importPresetType" style="text-transform: uppercase; font-size: 10.5px; color: var(--text-muted);">Тип записей</label>
          <select id="importPresetType" style="width: 100%; box-sizing: border-box; margin-bottom: 0;">
            <option value="domain">Домены (Domains)</option>
            <option value="cidr">IP / Подсети (CIDR)</option>
          </select>
        </div>
      </div>

      <div id="importPresetError" style="display: none; color: #ef4444; font-size: 12px; margin-bottom: 12px;"></div>

      <div style="display: flex; gap: 8px;">
        <button type="button" id="btnSubmitImportPreset" onclick="submitImportPreset()" style="flex: 1;">Импортировать</button>
        <button type="button" onclick="closeImportPresetsModal()" class="btn-secondary" style="flex: 1;">Отмена</button>
      </div>
    </div>
  </div>

    <!-- Modal: Compiler Warning -->
  <div id="modalCompilerWarning" class="modal-backdrop-theme" style="display: none;">
    <div class="modal-card-theme" style="max-width: 500px; width: 90%; padding: 24px;">
      <h3 style="margin-top: 0; color: #f59e0b; display: flex; align-items: center; gap: 8px;">
        <span>⚠</span>
        <span data-i18n="titleCompilerWarning">Компилятор C/C++ не обнаружен</span>
      </h3>
      <p id="compilerWarningModalText" style="font-size: 13px; line-height: 1.5; color: var(--text-color); margin: 16px 0;">
      </p>
      <div style="display: flex; justify-content: flex-end; gap: 10px;">
        <button type="button" class="btn" onclick="closeCompilerWarningModal()" data-i18n="btnCloseModal">Понятно</button>
      </div>
    </div>
  </div>

    <!-- Modal: Build Log Console -->
  <div id="modalBuildLog" class="modal-backdrop-theme" style="display: none;">
    <div class="modal-card-theme" style="max-width: 800px; width: 95%; padding: 24px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
        <h2 id="buildLogModalTitle" style="margin: 0; font-size: 16px; display: flex; align-items: center; gap: 8px;">
          <span>📋</span>
          <span>Лог сборки и компиляции</span>
        </h2>
        <div style="display: flex; gap: 8px;">
          <button type="button" onclick="copyBuildLogToClipboard()" class="btn-secondary" style="font-size: 11px; padding: 4px 8px;">Копировать</button>
          <button type="button" onclick="closeBuildLogModal()" class="btn-icon" style="font-size: 18px; line-height: 1;">&times;</button>
        </div>
      </div>
      <pre id="buildLogConsole" style="background: #020617; color: #38bdf8; padding: 14px; border-radius: 6px; font-family: 'Consolas', 'Monaco', monospace; font-size: 12px; line-height: 1.5; max-height: 420px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; border: 1px solid var(--border-color); margin: 0 0 14px 0;"></pre>
      <div style="display: flex; justify-content: flex-end;">
        <button type="button" onclick="closeBuildLogModal()" class="btn-secondary" style="padding: 6px 16px; font-size: 12px;">Закрыть</button>
      </div>
    </div>
  </div>

  <script src="/dashboard.min.js"></script>
</body>
</html>`;
}
