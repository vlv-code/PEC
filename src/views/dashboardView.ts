export interface DashboardViewOptions {
  isDefaultTokenInUse: boolean;
  port: number;
}

export function renderDashboardHtml(options: DashboardViewOptions): string {
  const { isDefaultTokenInUse, port } = options;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Corp Proxy Fleet & Extension Studio</title>
  <meta name="description" content="Central manager for selective proxy routing, GeoBases, extension constructor studio, and 3x-ui rotating authentication." />
  <link rel="stylesheet" href="/dashboard.css">
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1 id="appTitle" style="font-size: 22px; font-weight: 700;" data-i18n="appTitle">PEC - Proxy Extension Corp</h1>
        <p id="appSubtitle" style="font-size: 14px; color: var(--text-muted);" data-i18n="appSubtitle">Enterprise Proxy Synchronization</p>
      </div>
      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
        <!-- GitHub Version Release Badge -->
        <span id="versionReleaseBadge" class="badge badge-action-proxy" style="cursor: pointer; font-size: 11px; padding: 4px 8px;" onclick="toggleCustomizationPopover(event)" title="GitHub Releases & Version Control">v1.3.0</span>

        <!-- Server Customization Popover Trigger (Palette Icon) -->
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
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                <button type="button" id="optLayoutConsoleCard" class="popover-layout-btn" onclick="setServerLayout('console')">
                  <span style="font-size: 11px; font-weight: 600;">Console</span>
                </button>
                <button type="button" id="optLayoutTerminalCard" class="popover-layout-btn" onclick="setServerLayout('terminal')">
                  <span style="font-size: 11px; font-weight: 600;">Terminal</span>
                </button>
              </div>
            </div>

            <!-- 2. Color palettes -->
            <div>
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

            <!-- 3. Account (dashboard login credentials) -->
            <div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--border);">
              <button type="button" id="btnOpenCredsModal" class="popover-layout-btn" style="width: 100%;">
                🔑 <span style="font-size: 11px; font-weight: 600;">Сменить логин / пароль</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Quick Language Switcher -->
        <div style="display: flex; align-items: center; background: var(--card-bg); border: 1px solid var(--border); border-radius: 6px; overflow: hidden;">
          <button type="button" id="btnLangEn" onclick="setLanguage('en')" style="background: transparent; border: none; padding: 5px 10px; font-size: 12px; font-weight: 700; color: var(--text-muted); cursor: pointer;">EN</button>
          <div style="width: 1px; height: 16px; background: var(--border);"></div>
          <button type="button" id="btnLangRu" onclick="setLanguage('ru')" style="background: var(--primary); border: none; padding: 5px 10px; font-size: 12px; font-weight: 700; color: #fff; cursor: pointer;">RU</button>
        </div>

        <span class="badge-status">
          <span class="dot"></span>
          <span id="lblGatewayStatus" data-i18n="statusGatewayActive">Шлюз активен</span>
        </span>
        
        <!-- Refresh All (Icon Only) -->
        <button id="btnRefreshAll" onclick="refreshAll()" class="btn-icon" data-i18n-title="btnRefreshAllTitle" title="Обновить всё">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
          </svg>
        </button>

        <!-- Log out (Icon Only) - revokes the server session -->
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
        <span style="font-size: 16px;">⚠️</span>
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
        <strong id="lblHdrFleet" data-i18n="lblHdrFleet">Подключенный флот:</strong> <span id="hdrFleetCount">0 активных</span> &bull; 
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
    <div class="tabs-nav">
      <button id="tabBtnRouting" class="tab-btn active" onclick="switchTab('routing')" data-i18n="tabBtnRouting">Routing & GeoBases</button>
      <button id="tabBtnBuilder" class="tab-btn" onclick="switchTab('builder')" data-i18n="tabBtnBuilder">Extension Constructor Studio</button>
      <button id="tabBtnFleet" class="tab-btn" onclick="switchTab('fleet')" data-i18n="tabBtnFleet">Fleet & Target Assignment</button>
      <button id="tabBtnGpo" class="tab-btn" onclick="switchTab('gpo')" data-i18n="tabBtnGpo">GPO Deployment</button>
      <button id="tabBtnProxySettings" class="tab-btn" onclick="switchTab('proxy-settings')" data-i18n="tabBtnProxySettings">Proxy Settings</button>
      <button id="tabBtnLogs" class="tab-btn" onclick="switchTab('logs')" data-i18n="tabBtnLogs">Audit & Tester</button>
    </div>

    <!-- ==================== TAB 1: ROUTING & GEOBASES ==================== -->
    <div id="tab-routing" class="tab-pane active">
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
          <div style="display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 14px; margin-bottom: 12px;">
            <div>
              <label data-i18n="lblProfName">Profile Name</label>
              <input type="text" id="profName" style="margin-bottom: 0;" />
            </div>
            <div>
              <label data-i18n="lblDefaultPolicy">Default Traffic Policy</label>
              <select id="profDefaultPolicy" style="margin-bottom: 0;">
                <option value="direct" data-i18n="optPolicyDirect">DIRECT by Default (Selective Proxy)</option>
                <option value="proxy" data-i18n="optPolicyProxy">PROXY by Default (Full Tunnel)</option>
              </select>
            </div>
            <div>
              <label data-i18n="lblTargetScope">Deployment Target Scope</label>
              <select id="profTargetScope" style="margin-bottom: 0;">
                <option value="all" data-i18n="optScopeAll">All Fleet (Global Default)</option>
                <option value="group" data-i18n="optScopeGroup">Target AD / Fleet Group</option>
                <option value="instances" data-i18n="optScopeInstances">Specific Selected Instances</option>
              </select>
            </div>
          </div>

          <div id="groupTargetRow" style="display: none; margin-bottom: 10px;">
            <label data-i18n="lblTargetGroup">Target Group Name</label>
            <input type="text" id="profTargetGroup" placeholder="e.g. SEC-Proxy-VPN-VIP or Dev-Team" data-i18n-ph="phTargetGroup" style="margin-bottom: 0;" />
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
            <p style="font-size: 12px; color: var(--text-muted);" id="profDesc" data-i18n="profDescDefault">
              Routing policy applied to matching browser instances.
            </p>
            <div style="display: flex; gap: 8px;">
              <button onclick="saveCurrentProfile()" data-i18n="btnSaveProfile">Save Routing Profile</button>
              <button onclick="deleteCurrentProfile()" class="btn-danger" style="font-size: 12px;" data-i18n="btnDeleteProfile">Delete Profile</button>
              <a id="btnPacPreview" href="/proxy.pac" target="_blank" class="btn-secondary" style="font-size: 12px;" data-i18n="btnPacPreview">View PAC Script</a>
            </div>
          </div>
        </div>

        <!-- Quick Add GeoBase Presets -->
        <h3 style="font-size: 14px; font-weight: 600; margin-bottom: 10px; color: var(--text);" data-i18n="titleGeoPresets">
          Quick Add GeoBase & Domain Bundles
        </h3>
        <div class="grid-3" id="presetsContainer">
          <!-- Dynamically populated -->
        </div>

        <!-- Custom Rule Adder -->
        <div style="background: var(--card-inner); padding: 14px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 16px;">
          <h4 style="font-size: 13px; font-weight: 600; margin-bottom: 10px;" data-i18n="titleCustomRule">Add Custom Domain / Subnet Rule</h4>
          <div style="display: grid; grid-template-columns: 2fr 3fr 1fr auto; gap: 10px; align-items: flex-end;">
            <div>
              <label data-i18n="lblRuleName">Rule Name</label>
              <input type="text" id="newRuleName" placeholder="My Custom Rule" data-i18n-ph="phRuleName" style="margin-bottom: 0;" />
            </div>
            <div>
              <label data-i18n="lblRulePattern">Pattern (comma separated domains or CIDRs)</label>
              <input type="text" id="newRulePattern" placeholder="*.example.com, target-domain.org, 10.50.0.0/16" data-i18n-ph="phRulePattern" style="margin-bottom: 0;" />
            </div>
            <div>
              <label data-i18n="lblRuleAction">Action</label>
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
                <th data-i18n="thStatus">Status</th>
                <th data-i18n="thRuleName">Rule Name</th>
                <th data-i18n="thPattern">Pattern / Preset</th>
                <th data-i18n="thAction">Action</th>
                <th data-i18n="thActions">Actions</th>
              </tr>
            </thead>
            <tbody id="rulesTableBody">
              <tr><td colspan="5" style="text-align: center; color: var(--text-muted);" data-i18n="txtNoRules">No rules defined for this profile.</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ==================== TAB 2: EXTENSION CONSTRUCTOR STUDIO ==================== -->
    <div id="tab-builder" class="tab-pane">
      <div style="display: grid; grid-template-columns: 1.25fr 1fr; gap: 16px; margin-bottom: 16px;">
        
        <!-- Left Column: Visual, Preset & Feature Customizer -->
        <div class="card" style="margin-bottom: 0;">
          <h2>
            <span data-i18n="titleBuilder">Extension Constructor & Customizer</span>
            <span class="badge badge-action-proxy" id="bldPresetBadge">Self-Service Pro</span>
          </h2>
          <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 14px;" data-i18n="subBuilder">
            Configure functional archetypes, visual styles, security leak guards, and user capabilities:
          </p>

          <!-- 1. Archetype Presets -->
          <div style="background: var(--card-inner); padding: 12px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 14px;">
            <label style="margin-bottom: 8px;" data-i18n="lblArchetypePresets">1. Functional Archetype Presets</label>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <button type="button" class="preset-chip active" id="chip-self-service" onclick="applyTemplatePreset('self-service-pro')">
                <span>👤</span>
                <span data-i18n="chipSelfService">Self-Service Pro</span>
              </button>
              <button type="button" class="preset-chip" id="chip-kiosk" onclick="applyTemplatePreset('kiosk-restricted')">
                <span>🔒</span>
                <span data-i18n="chipKiosk">Kiosk / Restricted</span>
              </button>
              <button type="button" class="preset-chip" id="chip-stealth" onclick="applyTemplatePreset('enterprise-invisible')">
                <span>👻</span>
                <span data-i18n="chipStealth">Stealth Agent</span>
              </button>
            </div>
            <p id="presetDescText" style="font-size: 11px; color: var(--text-muted); margin-top: 6px;">
              Self-Service Pro: Interactive popup with connection details, routing overview, manual sync, and temporary user bypass.
            </p>
          </div>

          <!-- 2. Theme & Visual Style Presets -->
          <div style="background: var(--card-inner); padding: 12px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 14px;">
            <label style="margin-bottom: 8px;" data-i18n="lblThemePalettes">2. Theme & Color Palettes</label>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <button type="button" class="preset-chip active" id="chip-style-cyber-blue" onclick="applyStylePreset('cyber-blue')">
                <span class="color-swatch" style="background: #0284c7;"></span>
                <span>Cyber Blue</span>
              </button>
              <button type="button" class="preset-chip" id="chip-style-dark-obsidian" onclick="applyStylePreset('dark-obsidian')">
                <span class="color-swatch" style="background: #a855f7;"></span>
                <span>Dark Obsidian</span>
              </button>
              <button type="button" class="preset-chip" id="chip-style-emerald-sentinel" onclick="applyStylePreset('emerald-sentinel')">
                <span class="color-swatch" style="background: #10b981;"></span>
                <span>Emerald Sentinel</span>
              </button>
              <button type="button" class="preset-chip" id="chip-style-sunset-amber" onclick="applyStylePreset('sunset-amber')">
                <span class="color-swatch" style="background: #f59e0b;"></span>
                <span>Sunset Amber</span>
              </button>
              <button type="button" class="preset-chip" id="chip-style-minimal-light" onclick="applyStylePreset('minimal-light')">
                <span class="color-swatch" style="background: #2563eb;"></span>
                <span>Minimal Light</span>
              </button>
            </div>
          </div>

          <!-- 3. Identity & Branding -->
          <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 10px;">
            <div>
              <label data-i18n="lblExtName">Extension Name</label>
              <input type="text" id="bldName" oninput="onConfigChangeLive()" placeholder="Corp Proxy Auth & Sync" data-i18n-ph="phExtName" />
            </div>
            <div>
              <label data-i18n="lblShortName">Short Name</label>
              <input type="text" id="bldShortName" oninput="onConfigChangeLive()" placeholder="CorpProxy" data-i18n-ph="phShortName" />
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
            <div>
              <label data-i18n="lblVersion">Version</label>
              <input type="text" id="bldVersion" oninput="onConfigChangeLive()" placeholder="1.2.0" />
            </div>
            <div>
              <label data-i18n="lblUiMode">UI Mode</label>
              <select id="bldUiMode" onchange="onConfigChangeLive()">
                <option value="popup" data-i18n="optUiPopup">Interactive Popup UI</option>
                <option value="stealth" data-i18n="optUiStealth">Silent / Stealth Enterprise Worker</option>
              </select>
            </div>
            <div>
              <label data-i18n="lblIconType">Vector Icon Type</label>
              <select id="bldIconType" onchange="onConfigChangeLive()">
                <option value="shield">🛡️ Shield Security</option>
                <option value="lock">🔒 Lock Encrypted</option>
                <option value="globe">🌐 Global Network</option>
                <option value="bolt">⚡ Lightning Bolt</option>
                <option value="server">🖥️ Gateway Server</option>
                <option value="key">🔑 Auth Token Key</option>
              </select>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
            <div>
              <label data-i18n="lblBrandColor">Brand Theme Color</label>
              <input type="text" id="bldThemeColor" oninput="onConfigChangeLive()" placeholder="#0284c7" />
            </div>
            <div>
              <label data-i18n="lblIconEmoji">Icon Emoji</label>
              <input type="text" id="bldEmoji" oninput="onConfigChangeLive()" placeholder="🛡️" />
            </div>
            <div>
              <label data-i18n="lblSyncInterval">Sync Interval</label>
              <select id="bldSyncInterval" onchange="onConfigChangeLive()">
                <option value="5" data-i18n="optSync5">Every 5 minutes</option>
                <option value="15" selected data-i18n="optSync15">Every 15 minutes</option>
                <option value="30" data-i18n="optSync30">Every 30 minutes</option>
                <option value="60" data-i18n="optSync60">Every 1 hour</option>
              </select>
            </div>
          </div>

          <label data-i18n="lblExtDesc">Enterprise Description</label>
          <input type="text" id="bldDesc" oninput="onConfigChangeLive()" placeholder="Enterprise Chrome extension for automatic proxy synchronization" data-i18n-ph="phExtDesc" />

          <label data-i18n="lblServerUrl">Sync Server Base URL (API Base URL)</label>
          <input type="text" id="bldServerUrl" oninput="onConfigChangeLive()" placeholder="https://pec.example.corp" data-i18n-ph="phServerUrl" />

          <!-- 4. Security & User Feature Policies -->
          <div style="background: var(--card-inner); padding: 12px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 14px;">
            <label style="margin-bottom: 8px;" data-i18n="lblSecPolicies">Security & Leak Prevention Policies</label>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px;">
              <label style="display: flex; align-items: center; gap: 8px; text-transform: none; color: var(--text); font-weight: normal; cursor: pointer;">
                <input type="checkbox" id="bldWebRtc" checked onchange="onConfigChangeLive()" style="width: auto; margin-bottom: 0;" />
                <span data-i18n="lblWebrtcShield">WebRTC IP Shield (no UDP leak)</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; text-transform: none; color: var(--text); font-weight: normal; cursor: pointer;">
                <input type="checkbox" id="bldDnsGuard" checked onchange="onConfigChangeLive()" style="width: auto; margin-bottom: 0;" />
                <span data-i18n="lblDnsGuard">DNS Leak Guard</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; text-transform: none; color: var(--text); font-weight: normal; cursor: pointer;">
                <input type="checkbox" id="bldBadge" checked onchange="onConfigChangeLive()" style="width: auto; margin-bottom: 0;" />
                <span data-i18n="lblBadgeIcon">Live Status Badge on Icon</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; text-transform: none; color: var(--text); font-weight: normal; cursor: pointer;">
                <input type="checkbox" id="bldAutoProxy" checked onchange="onConfigChangeLive()" style="width: auto; margin-bottom: 0;" />
                <span data-i18n="lblAutoProxy">Dynamic Proxy Enforcement</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; text-transform: none; color: var(--text); font-weight: normal; cursor: pointer;">
                <input type="checkbox" id="bldAllowBypass" checked onchange="onConfigChangeLive()" style="width: auto; margin-bottom: 0;" />
                <span data-i18n="lblAllowBypass">Allow Temporary User Bypass</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; text-transform: none; color: var(--text); font-weight: normal; cursor: pointer;">
                <input type="checkbox" id="bldIpGeo" checked onchange="onConfigChangeLive()" style="width: auto; margin-bottom: 0;" />
                <span data-i18n="lblIpGeo">Show Egress IP / Geo Verifier</span>
              </label>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 10px; margin-top: 10px;">
              <div>
                <label style="font-size: 11px;" data-i18n="lblBypassTimeout">Bypass Auto-Timeout</label>
                <select id="bldBypassTimeout" onchange="onConfigChangeLive()" style="margin-bottom: 0; font-size: 12px;">
                  <option value="10">10 minutes</option>
                  <option value="15" selected>15 minutes</option>
                  <option value="30">30 minutes</option>
                  <option value="60">60 minutes</option>
                </select>
              </div>
              <div>
                <label style="font-size: 11px;" data-i18n="lblSupportUrl">IT Helpdesk Contact</label>
                <input type="text" id="bldSupportUrl" oninput="onConfigChangeLive()" placeholder="mailto:it-support@corp.local" data-i18n-ph="phSupportUrl" style="margin-bottom: 0; font-size: 12px;" />
              </div>
            </div>
          </div>

          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            <button onclick="buildAndPackExtension()" class="btn-success" data-i18n="btnBuildCrx">Compile, Sign & Pack CRX</button>
            <button onclick="saveBuilderConfigOnly(true)" class="btn-secondary" data-i18n="btnSaveConfig">Save Config Only</button>
            <button onclick="regenerateTemplatesFromConfig()" class="btn-secondary" style="margin-left: auto;" data-i18n="btnResetTemplate">Reset to Clean Template</button>
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
                <span>🔒</span>
                <span>https://company-intranet.corp/internal-app</span>
              </div>
              <!-- Chrome extension icon with live badge -->
              <div class="browser-ext-icon" id="browserExtIcon" onclick="togglePopupPreviewVisibility()" title="Click to inspect extension popup">
                <span id="browserIconGlyph">🛡️</span>
                <span class="browser-ext-badge" id="browserBadge">PRX</span>
              </div>
            </div>

            <!-- Preview Canvas -->
            <div class="preview-canvas">
              <!-- Popup Window Box -->
              <div class="popup-frame-box" id="popupFrameBox">
                <iframe id="previewFrame" sandbox="allow-scripts" style="width: 100%; height: 470px; border: none;" title="Extension Popup Preview"></iframe>
              </div>

              <!-- Stealth Mode Fallback Card -->
              <div id="stealthNotice" style="display: none; background: #0f172a; border: 1px solid var(--border); border-radius: 8px; padding: 24px; text-align: center; max-width: 320px;">
                <div style="font-size: 38px; margin-bottom: 10px;">👻</div>
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
            <a href="/updates/extension.crx" class="btn" style="font-size: 12px;" data-i18n="btnDownloadCrx">Download .CRX</a>
            <a href="/api/extension/download-zip" download="corp-proxy-extension.zip" class="btn-secondary" style="font-size: 12px;" data-i18n="btnDownloadZip">Download .ZIP</a>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== TAB 3: FLEET & TARGET ASSIGNMENT ==================== -->
    <div id="tab-fleet" class="tab-pane">
      <div class="card">
        <h2>
          <span data-i18n="titleFleetInstances">Connected Extension Instances</span>
          <span id="badgeFleetOnline" class="badge badge-online">0 online</span>
        </h2>
        <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 14px;" data-i18n="subFleetInstances">
          Assign specific profiles or groups to instances, or monitor live sync activity:
        </p>

        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th data-i18n="thInstId">Instance ID</th>
                <th data-i18n="thInstIp">IP Address</th>
                <th data-i18n="thInstVer">Version</th>
                <th data-i18n="thInstGroup">Fleet Group</th>
                <th data-i18n="thInstProfile">Assigned Profile</th>
                <th data-i18n="thInstSyncs">Syncs</th>
                <th data-i18n="thInstStatus">Status</th>
                <th data-i18n="thInstAssign">Assign</th>
              </tr>
            </thead>
            <tbody id="fleetTableBody">
              <tr><td colspan="8" style="text-align: center; color: var(--text-muted);" data-i18n="txtNoFleet">No active instances connected yet.</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ==================== TAB 4: GPO DEPLOYMENT ==================== -->
    <div id="tab-gpo" class="tab-pane">
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
            <a href="/updates/extension.crx" class="btn" style="font-size: 13px;" data-i18n="btnDownloadCrxPkg">Download .CRX Package</a>
            <a href="/api/extension/download-zip" download="corp-proxy-extension.zip" class="btn-secondary" style="font-size: 13px; margin-left: 8px;" data-i18n="btnDownloadZipPkg">Download .ZIP</a>
          </div>
        </div>

        <div class="card">
          <h2 data-i18n="titleAdGpoSettings">Active Directory GPO Settings</h2>
          <label data-i18n="lblGpoForcelist">1. ExtensionInstallForcelist Entry</label>
          <pre id="gpoForcelist">Loading...</pre>

          <label style="margin-top: 10px;" data-i18n="lblGpoSettings">2. ExtensionSettings (JSON)</label>
          <pre id="gpoSettings" style="max-height: 140px;">Loading...</pre>

          <div style="margin-top: 10px;">
            <button onclick="downloadRegFile()" class="btn-secondary" style="font-size: 12px;" data-i18n="btnDownloadReg">Download Windows .REG Policy File</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== TAB 5: PROXY SETTINGS & 3X-UI ==================== -->
    <div id="tab-proxy-settings" class="tab-pane">
      <!-- 1. Upstream Proxy Nodes Registry Card -->
      <div class="card" style="margin-bottom: 16px;">
        <h2>
          <span data-i18n="titleProxyRegistry">Proxy Registry</span>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button type="button" id="btnAdd3xui" onclick="openAdd3xuiModal()" class="btn-secondary" style="font-size: 12px;" data-i18n="btnAdd3xui">+ Add from 3x-ui by Tag</button>
            <button type="button" id="btnAddManual" onclick="openAddManualModal()" style="font-size: 12px;" data-i18n="btnAddManual">+ Add Manual Proxy</button>
          </div>
        </h2>
        <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 14px;" data-i18n="subProxyRegistry">
          Manage upstream corporate proxy servers, tag-based sync with 3x-ui inbounds, and manual nodes.
        </p>

        <!-- Active PAC Directive Indicator Banner -->
        <div id="activePacDirectiveBanner" style="background: var(--card-inner); border: 1px solid var(--border); border-left: 4px solid var(--primary); padding: 10px 14px; border-radius: 6px; margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; font-size: 13px;">
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
                <th style="text-align: right;" data-i18n="thProxyActions">Actions</th>
              </tr>
            </thead>
            <tbody id="proxiesTableBody">
              <tr><td colspan="8" style="text-align: center; color: var(--text-muted);" data-i18n="txtNoProxies">Loading proxies...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 2. 3x-ui Connection & Rotation Scheduler (grid-2) -->
      <div class="grid-2">
        <div class="card">
          <h2 data-i18n="title3xuiCreds">3x-ui API Credentials & Timing Scheduler</h2>
          <label data-i18n="lbl3xuiPanelUrl">3x-ui Panel URL</label>
          <input type="text" id="rotPanelUrl" placeholder="https://3xui-host:2053/basepath" data-i18n-ph="phRotPanelUrl" />

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div>
              <label data-i18n="lblAdminUser">Admin Username</label>
              <input type="text" id="rotAdminUser" placeholder="admin" data-i18n-ph="phRotAdminUser" />
            </div>
            <div>
              <label data-i18n="lblAdminPass">Admin Password</label>
              <input type="password" id="rotAdminPass" placeholder="••••••••" />
            </div>
          </div>

          <label data-i18n="lblInboundRemark">Target Inbound Remark</label>
          <input type="text" id="rotRemark" placeholder="squid-in" data-i18n-ph="phRotRemark" />

          <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 10px;">
            <div>
              <label data-i18n="lblRotInterval">Rotation Interval</label>
              <select id="rotInterval">
                <option value="15" data-i18n="optRot15">Every 15 minutes</option>
                <option value="60" data-i18n="optRot60">Every 1 hour</option>
                <option value="360" data-i18n="optRot360">Every 6 hours</option>
                <option value="720" data-i18n="optRot720">Every 12 hours</option>
                <option value="1440" selected data-i18n="optRot1440">Every 24 hours (Daily)</option>
              </select>
            </div>
            <div>
              <label data-i18n="lblScheduler">Scheduler</label>
              <select id="rotEnabled">
                <option value="true" data-i18n="optSchedEnabled">Enabled (Auto)</option>
                <option value="false" data-i18n="optSchedDisabled">Disabled</option>
              </select>
            </div>
          </div>

          <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; margin-top: 8px; text-transform: none; font-weight: normal; cursor: pointer;">
            <input type="checkbox" id="rotInsecureTls" style="width: auto; margin-bottom: 0;" />
            <span data-i18n="lblInsecureTls">Allow Insecure / Self-Signed TLS</span>
          </label>

          <div style="display: flex; gap: 8px; margin-top: 10px;">
            <button onclick="saveRotationConfig()" data-i18n="btnSaveScheduler">Save Scheduler Settings</button>
            <button onclick="test3xui()" class="btn-secondary" data-i18n="btnTest3xui">Test 3x-ui Connection</button>
          </div>
          <div id="test3xuiResult" style="margin-top: 10px; font-size: 12px; font-family: var(--mono); color: var(--text-muted);"></div>
        </div>

        <div class="card">
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

          <div style="margin-top: 16px;">
            <label data-i18n="lblRecentRot">Recent Password Rotations</label>
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

    <!-- ==================== TAB 6: AUDIT & TESTER ==================== -->
    <div id="tab-logs" class="tab-pane">
      <div class="grid-2">
        <div class="card">
          <h2 data-i18n="titleCredsTester">Interactive /creds Tester</h2>
          <label data-i18n="lblTestToken">X-Admin-Token Header Value</label>
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

  </div>

  <div id="loginModal" style="display: none; position: fixed; inset: 0; z-index: 9999; background: rgba(3, 7, 18, 0.94); align-items: center; justify-content: center;">
    <div style="max-width: 420px; width: 90%; background: #131d36; border: 1px solid #22345c; border-radius: 12px; padding: 28px; text-align: center;">
      <div style="font-size: 28px; margin-bottom: 8px;">🔐</div>
      <h2 style="margin: 0 0 8px 0; font-size: 18px;">Authentication Required</h2>
      <p style="color: #94a3b8; font-size: 12.5px; margin: 0 0 16px 0;">Введите логин и пароль администратора для входа в консоль управления PEC. Учётные данные проверяются на сервере и заменяются HttpOnly-сессией. Это НЕ токен расширений (EXT_SHARED_TOKEN).</p>
      <input type="text" id="loginUsernameInput" placeholder="Логин" autocomplete="username" style="width: 100%; box-sizing: border-box; margin-bottom: 12px;" />
      <input type="password" id="loginTokenInput" placeholder="Пароль" autocomplete="current-password" style="width: 100%; box-sizing: border-box; margin-bottom: 12px;" />
      <div id="loginError" style="display: none; color: #ef4444; font-size: 12px; margin-bottom: 10px;"></div>
      <button id="loginSubmitBtn" style="width: 100%;">Войти</button>
    </div>
  </div>

  <div id="credsModal" style="display: none; position: fixed; inset: 0; z-index: 9999; background: rgba(3, 7, 18, 0.94); align-items: center; justify-content: center;">
    <div style="max-width: 440px; width: 90%; background: #131d36; border: 1px solid #22345c; border-radius: 12px; padding: 28px;">
      <h2 style="margin: 0 0 8px 0; font-size: 17px; text-align: center;">🔑 Учётная запись администратора</h2>
      <p style="color: #94a3b8; font-size: 12px; margin: 0 0 16px 0; text-align: center;">Смена логина и/или пароля панели. Требуется текущий пароль; после сохранения все прочие сессии будут завершены.</p>
      <label style="text-transform: uppercase; font-size: 10.5px; color: #94a3b8;">Текущий пароль</label>
      <input type="password" id="credCurrentPassword" autocomplete="current-password" style="width: 100%; box-sizing: border-box; margin-bottom: 12px;" />
      <label style="text-transform: uppercase; font-size: 10.5px; color: #94a3b8;">Новый логин</label>
      <input type="text" id="credUsernameInput" autocomplete="username" style="width: 100%; box-sizing: border-box; margin-bottom: 12px;" />
      <label style="text-transform: uppercase; font-size: 10.5px; color: #94a3b8;">Новый пароль (мин. 8 символов, пусто = не менять)</label>
      <input type="password" id="credNewPassword" autocomplete="new-password" style="width: 100%; box-sizing: border-box; margin-bottom: 12px;" />
      <div id="credError" style="display: none; color: #ef4444; font-size: 12px; margin-bottom: 10px;"></div>
      <div style="display: flex; gap: 8px;">
        <button id="credSubmitBtn" style="flex: 1;">Сохранить</button>
        <button id="credCancelBtn" class="btn-secondary" style="flex: 1;">Отмена</button>
      </div>
    </div>
  </div>

  <!-- Modal: Add Proxy from 3x-ui by Tag -->
  <div id="modalAdd3xui" style="display: none; position: fixed; inset: 0; z-index: 9999; background: rgba(3, 7, 18, 0.94); align-items: center; justify-content: center;">
    <div style="max-width: 500px; width: 90%; background: #131d36; border: 1px solid #22345c; border-radius: 12px; padding: 24px;">
      <h2 style="margin: 0 0 12px 0; font-size: 17px;" data-i18n="titleAdd3xui">Add Proxy from 3x-ui by Inbound Tag</h2>
      <p style="color: #94a3b8; font-size: 12px; margin: 0 0 16px 0;" data-i18n="subAdd3xui">Enter inbound tag configured in your 3x-ui panel to fetch and link credentials.</p>

      <label style="text-transform: uppercase; font-size: 10.5px; color: #94a3b8;" data-i18n="lblAdd3xuiTag">Inbound Tag</label>
      <div style="display: flex; gap: 8px; margin-bottom: 12px;">
        <input type="text" id="add3xuiTag" placeholder="corp-socks" data-i18n-ph="phAdd3xuiTag" style="flex: 1; margin-bottom: 0;" />
        <button type="button" id="btnAdd3xuiFetch" onclick="lookup3xuiInbound()" class="btn-secondary" style="font-size: 12px; white-space: nowrap;" data-i18n="btnFetchInbound">Fetch Info</button>
      </div>

      <!-- Inbound preview box -->
      <div id="add3xuiPreview" style="background: var(--card-inner); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; margin-bottom: 14px; font-size: 12px; color: var(--text-muted);">
        <span data-i18n="txtInboundPreviewPlaceholder">Click "Fetch Info" to preview inbound parameters before adding.</span>
      </div>

      <label style="text-transform: uppercase; font-size: 10.5px; color: #94a3b8;" data-i18n="lblAdd3xuiName">Friendly Name (optional)</label>
      <input type="text" id="add3xuiName" placeholder="Production SOCKS5 Node" data-i18n-ph="phAdd3xuiName" style="width: 100%; box-sizing: border-box; margin-bottom: 12px;" />

      <label style="text-transform: uppercase; font-size: 10.5px; color: #94a3b8;" data-i18n="lblAdd3xuiHost">Host Override (optional)</label>
      <input type="text" id="add3xuiHost" placeholder="10.0.0.1 or proxy.corp.local" data-i18n-ph="phAdd3xuiHost" style="width: 100%; box-sizing: border-box; margin-bottom: 14px;" />

      <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; text-transform: none; font-weight: normal; cursor: pointer; margin-bottom: 16px;">
        <input type="checkbox" id="add3xuiIsActive" checked style="width: auto; margin-bottom: 0;" />
        <span data-i18n="lblMakeActive">Make this proxy active immediately</span>
      </label>

      <div id="add3xuiError" style="display: none; color: #ef4444; font-size: 12px; margin-bottom: 12px;"></div>

      <div style="display: flex; gap: 8px;">
        <button type="button" id="btnAdd3xuiSubmit" onclick="submitAdd3xuiProxy()" style="flex: 1;" data-i18n="btnAdd3xuiSubmit">Add 3x-ui Proxy</button>
        <button type="button" onclick="closeAdd3xuiModal()" class="btn-secondary" style="flex: 1;" data-i18n="btnCancel">Cancel</button>
      </div>
    </div>
  </div>

  <!-- Modal: Add Manual or Edit Proxy Form -->
  <div id="modalProxyForm" style="display: none; position: fixed; inset: 0; z-index: 9999; background: rgba(3, 7, 18, 0.94); align-items: center; justify-content: center;">
    <div style="max-width: 480px; width: 90%; background: #131d36; border: 1px solid #22345c; border-radius: 12px; padding: 24px;">
      <h2 id="proxyFormTitle" style="margin: 0 0 12px 0; font-size: 17px;" data-i18n="titleAddManualProxy">Add Manual Proxy Node</h2>
      <input type="hidden" id="proxyFormId" value="" />

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
        <div>
          <label style="text-transform: uppercase; font-size: 10.5px; color: #94a3b8;" data-i18n="lblProxyTag">Tag</label>
          <input type="text" id="proxyFormTag" placeholder="manual-us-1" data-i18n-ph="phProxyTag" style="width: 100%; box-sizing: border-box; margin-bottom: 0;" />
        </div>
        <div>
          <label style="text-transform: uppercase; font-size: 10.5px; color: #94a3b8;" data-i18n="lblProxyName">Friendly Name</label>
          <input type="text" id="proxyFormName" placeholder="Backup US Gateway" data-i18n-ph="phProxyName" style="width: 100%; box-sizing: border-box; margin-bottom: 0;" />
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 2fr 1fr; gap: 10px; margin-bottom: 10px;">
        <div>
          <label style="text-transform: uppercase; font-size: 10.5px; color: #94a3b8;" data-i18n="lblProxyProtocol">Protocol</label>
          <select id="proxyFormProtocol" style="width: 100%; box-sizing: border-box; margin-bottom: 0;">
            <option value="socks5">SOCKS5</option>
            <option value="http">HTTP</option>
            <option value="https">HTTPS</option>
          </select>
        </div>
        <div>
          <label style="text-transform: uppercase; font-size: 10.5px; color: #94a3b8;" data-i18n="lblProxyHost">Host / IP</label>
          <input type="text" id="proxyFormHost" placeholder="192.168.1.100" data-i18n-ph="phProxyHost" style="width: 100%; box-sizing: border-box; margin-bottom: 0;" />
        </div>
        <div>
          <label style="text-transform: uppercase; font-size: 10.5px; color: #94a3b8;" data-i18n="lblProxyPort">Port</label>
          <input type="number" id="proxyFormPort" placeholder="1080" data-i18n-ph="phProxyPort" min="1" max="65535" style="width: 100%; box-sizing: border-box; margin-bottom: 0;" />
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px;">
        <div>
          <label style="text-transform: uppercase; font-size: 10.5px; color: #94a3b8;" data-i18n="lblProxyUser">Username</label>
          <input type="text" id="proxyFormUser" placeholder="proxyuser" data-i18n-ph="phProxyUser" style="width: 100%; box-sizing: border-box; margin-bottom: 0;" />
        </div>
        <div>
          <label style="text-transform: uppercase; font-size: 10.5px; color: #94a3b8;" data-i18n="lblProxyPass">Password</label>
          <input type="password" id="proxyFormPass" placeholder="••••••••" style="width: 100%; box-sizing: border-box; margin-bottom: 0;" />
        </div>
      </div>

      <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; text-transform: none; font-weight: normal; cursor: pointer; margin-bottom: 16px;">
        <input type="checkbox" id="proxyFormIsActive" checked style="width: auto; margin-bottom: 0;" />
        <span data-i18n="lblMakeActive">Make this proxy active immediately</span>
      </label>

      <div id="proxyFormError" style="display: none; color: #ef4444; font-size: 12px; margin-bottom: 12px;"></div>

      <div style="display: flex; gap: 8px;">
        <button type="button" id="btnProxyFormSubmit" onclick="submitProxyForm()" style="flex: 1;" data-i18n="btnSaveProxy">Save Proxy</button>
        <button type="button" id="btnProxyFormCancel" onclick="closeProxyFormModal()" class="btn-secondary" style="flex: 1;" data-i18n="btnCancel">Cancel</button>
      </div>
    </div>
  </div>

  <script src="/dashboard.js"></script>
</body>
</html>`;
}
