# Corporate Proxy Extension & Studio UI Overhaul Design Spec

**Date:** 2026-09-30  
**Status:** Validated & Ready for Planning  
**Target:** Chrome MV3 Extension (`extension/` & `src/extensionTemplates.ts`), Web Dashboard Extension Studio (`src/views/dashboardView.ts`, `public/dashboard.js`, `public/dashboard.css`), Backend API (`src/routes/systemRoutes.ts`).

---

## 1. Overview & Objectives

This specification defines the complete overhaul of the Corporate Chrome MV3 Proxy Extension user interface and the server-side Extension Studio constructor. 

### Key Goals
1. **Un-cram and Modernize Popup UI**: Expand width to 380px with 12px rounded cards, sleek typography, clean hierarchy, and elimination of cramped, clipped tab labels.
2. **Three-Tab Organization**:
   - `Подключение` (Connection): Ultra-minimalist hero status display + 3 primary action buttons.
   - `Маршрутизация` (Routing): Corporate PAC rules overview + User Custom Overrides ("Мои исключения") with 1-click current tab domain addition.
   - `Инфо и Диагностика` (Diagnostics & Info): Unified technical metrics card (latency ping, fixed egress IP check, profile metadata) + Live event log terminal.
3. **Dedicated 3-Button Control Block**:
   - **Circular Sync** `🔄`: Immediate manual fetch and re-application of server PAC/settings with smooth spin animation.
   - **Permanent Power** `⏻`: Explicit full Enable / Disable toggle (persists indefinitely until clicked again).
   - **Pause** `⏸`: Temporary 15-minute bypass with live countdown timer and instant resumption.
4. **User Custom Routing Overrides**:
   - End-user can define custom routing rules (domain / glob patterns -> `PROXY` or `DIRECT`).
   - Dynamic injection at the top of the PAC script (`FindProxyForURL`) ensuring local user exceptions take precedence over corporate defaults without violating ASCII encoding constraints.
5. **Egress IP & Geo Endpoint Fix**:
   - Eliminate 404 errors by registering both `/api/ip-echo` and `/ip-echo` in `src/routes/systemRoutes.ts` and pointing extension diagnostic checks reliably to `/api/ip-echo`.
6. **Constructor & Theming Harmonization**:
   - Synchronize the server Extension Studio with the server's 2 Layout Themes (`Console` vs `Terminal`) and 5 Color Palettes (`cyber`, `obsidian`, `nord`, `emerald`, `light`).
   - Provide an end-user Day/Night (`☀️`/`🌙`) toggle in the popup header that harmonizes with all 5 color presets.
   - Update Extension Studio Live Preview iframe to mirror the redesigned layout and real-time palette changes.

---

## 2. Popup UI & UX Specifications

### 2.1 General Layout & Shell
- **Width**: `380px` (increased from 340px).
- **Border Radius**: Outer card `12px`, inner cards `8px`, buttons `6-8px`.
- **Header**:
  - Left: Vector icon + Extension Title + Version tag (`v1.4.0`).
  - Right: Day/Night toggle button (`☀️` / `🌙`) + Connection Status Pill (Green "Активен" / Amber "Пауза" / Gray "Выключен").
- **Tab Bar (3 Tabs)**:
  - Tab 1: `Подключение` (Connection) - Default active tab.
  - Tab 2: `Маршрутизация` (Routing).
  - Tab 3: `Инфо и Диагностика` (Diagnostics & Info).
  - Clean pill tabs with icons: `⚡ Подключение`, `🔀 Маршрутизация`, `📊 Инфо и Диагностика`.

---

### 2.2 Tab 1: Подключение (Connection)
Ultra-minimalist interface focused on instant status recognition and direct action:

1. **Status Hero Card**:
   - Central visual: Animated status shield / radar ring indicating connection health.
   - Big bold status text:
     - Enabled & Active: `"Защищено (Корпоративный прокси)"` (Green glow).
     - Bypassed / Paused: `"Пауза обхода: 14:45"` (Amber glow with countdown).
     - Permanently Disabled: `"Прокси отключен"` (Muted gray).
   - Subtitle metadata: Active profile name (`Direct by Default (Selective Proxy)`) and proxy upstream (`proxy.ic-iskra.ru:3128`).

2. **3-Button Action Bar**:
   - Horizontal flex container with 3 prominent, accessible buttons:
     - **Button A: Синхронизация (`btnSyncNow`)**:
       - Icon: `🔄` (SVG circular arrows).
       - Label: `"Синхронизация"`.
       - Behavior: Emits `{ type: "SYNC_NOW" }` to `background.js`. Spins 360° continuously during request, shows checkmark on success.
     - **Button B: Питание (`btnPowerToggle`)**:
       - Icon: `⏻` (Power icon).
       - Label: `"Вкл / Выкл"`.
       - Behavior: Toggles permanent state (`config.enabled = !config.enabled`). Disables PAC / routing until re-enabled by user.
     - **Button C: Пауза 15 мин (`btnPauseToggle`)**:
       - Icon: `⏸` (Pause icon).
       - Label: `"Пауза 15м"` (or `"Возобновить"` when paused).
       - Behavior: Activates temporary bypass with auto-resume countdown after 15 minutes.

---

### 2.3 Tab 2: Маршрутизация (Routing & User Overrides)
Split into two distinct, functional panels:

1. **Top Section: Корпоративные правила (Corporate Rules)**:
   - Read-only card with corporate badge `"От сервера"`.
   - Summary of corporate routing: Mode (e.g. `PAC (Выборочный прокси)`), total server patterns count, and list of key domain rules (e.g. `*.corp.internal`, `*.zoom.us`).
   - Notice: `"Управляется администратором. Ваши локальные исключения ниже имеют приоритет."`

2. **Bottom Section: Мои исключения (User Custom Overrides)**:
   - **Quick Add Bar**:
     - Auto-detects current active tab domain (via `chrome.tabs.query({ active: true, currentWindow: true })`).
     - Button: `+ Добавить текущий сайт: example.com`. Clicking pre-populates or directly adds rule.
   - **Manual Rule Creator**:
     - Input field: Pattern / Domain (e.g., `*.github.com` or `dev.local`).
     - Select action: `PROXY` (Через прокси) or `DIRECT` (Прямое подключение).
     - Button: `+ Добавить`.
   - **User Rules List**:
     - Each entry shows: Pattern, Action Badge (Green `PROXY` / Orange `DIRECT`), Enabled toggle checkbox, and Delete button (`✕`).
     - Real-time save: Stored in `chrome.storage.local` under `pecUserRules`.
     - Immediate application: Triggering background PAC re-injection without requiring full page reload.

---

### 2.4 Tab 3: Инфо и Диагностика (Diagnostics & Info)
Combines technical inspection metrics and log auditing into a single view:

1. **Metrics Card**:
   - Mode & Protocol: `PAC (Inline)` / `SOCKS5` / `HTTP`.
   - Сервер шлюза: `proxy.ic-iskra.ru:3128`.
   - Профиль: `Direct by Default (Selective Proxy)`.
   - Egress IP & Geo:
     - Value: `IP: 185.x.x.x (Проверено)` or button `"Проверить Egress IP"`.
     - Fixed endpoint: Calls `https://<serverBase>/api/ip-echo` (with fallback to `<serverBase>/ip-echo`).
   - Ping / Задержка:
     - Button: `"Тест задержки"`. Displays round-trip time in milliseconds (`42 ms`).
   - Версия сборки & Поддержка:
     - Version `1.4.0`, link to Helpdesk / Admin contact.

2. **Event Logs Terminal**:
   - Compact monospace log console (height: `150px`, scrollable).
   - Log entries with colored severity badges: `[INFO]` (cyan), `[WARN]` (yellow), `[ERROR]` (red).
   - Control buttons:
     - `📋 Копировать логи` (copies formatted plain text to clipboard).
     - `🗑️ Очистить` (clears logs in background storage).

---

## 3. PAC Script Injection & Routing Engine

### 3.1 User Overrides Injection Strategy
Corporate PAC scripts define a standard entrypoint:
```javascript
function FindProxyForURL(url, host) {
  // Corporate rules...
  return DIRECT;
}
```

When user rules exist in `chrome.storage.local`:
1. Rules are sanitized:
   - Strings trimmed, converted to ASCII / Punycode if IDN.
   - Patterns escaped against JS injection.
2. Injected at the very start of `FindProxyForURL`:
```javascript
function FindProxyForURL(url, host) {
  // === USER OVERRIDES BEGIN ===
  if (shExpMatch(host, "*.slack.com")) { return "PROXY proxy.ic-iskra.ru:3128"; }
  if (shExpMatch(host, "dev.company.lan")) { return "DIRECT"; }
  // === USER OVERRIDES END ===
  
  // Existing corporate rules...
```
3. If Chrome proxy mode is `fixed_servers`, user bypass rules are merged into Chrome's native bypass list (`rules.bypassList`).
4. Resulting PAC data is checked for non-ASCII bytes and applied via `chrome.proxy.settings.set`.

---

## 4. Theming Engine & Extension Studio Migration

### 4.1 Server Palette & Layout Definitions

#### Layouts
- **`console`**: Standard clean enterprise card UI, soft borders, modern sans-serif typography, comfortable paddings.
- **`terminal`**: DevSecOps / hacker aesthetic, darker background tones, monospace accents for metrics and tabs, sharp border accents.

#### Color Palettes
| Palette ID | Palette Name | Accent / Primary | Dark Bg / Card | Light Bg / Card |
|---|---|---|---|---|
| `cyber` | Cyber Blue | `#38bdf8` | `#0b1120` / `#131d36` | `#f0f9ff` / `#ffffff` |
| `obsidian` | Dark Obsidian | `#c084fc` | `#09090b` / `#18181b` | `#faf5ff` / `#ffffff` |
| `nord` | Nordic Arctic | `#88c0d0` | `#242933` / `#2e3440` | `#eceff4` / `#ffffff` |
| `emerald` | Emerald SecOps | `#34d399` | `#061e14` / `#0d3322` | `#f0fdf4` / `#ffffff` |
| `light` | Enterprise Light | `#2563eb` | `#0f172a` / `#1e293b` | `#f8fafc` / `#ffffff` |

### 4.2 Popup Day/Night Toggle Mechanism
- Extension popup stores `pecThemeMode: "light" | "dark"` in `chrome.storage.local`.
- Default mode is configured by Admin in the Extension Studio constructor (`defaultThemeMode: "dark" | "light"`).
- Header contains toggle button (`☀️` when dark, `🌙` when light).
- Sets `data-theme="light"` or `data-theme="dark"` on `<html>`/`<body>`.
- All UI colors reference CSS Custom Properties (`--bg`, `--card`, `--card-inner`, `--border`, `--text`, `--text-muted`, `--primary`).

### 4.3 Extension Studio Dashboard Integration
In `src/views/dashboardView.ts` and `public/dashboard.js`:
- Replace legacy style chips with:
  1. **Layout Switcher**: Visual toggle between `Console` and `Terminal`.
  2. **Color Palette Selector**: 5 chips matching the dashboard popover (`Cyber Blue`, `Dark Obsidian`, `Nordic Arctic`, `Emerald SecOps`, `Enterprise Light`).
  3. **Initial Theme Mode**: Toggle between `Dark (Ночь)` and `Light (День)`.
- Live Preview iframe immediately reflects the selected layout, palette, and initial day/night state.
- Constructor configuration exports these properties into `ExtensionBuildConfig`.

---

## 5. Server API Adjustments

### 5.1 Egress IP Echo Endpoint
In `src/routes/systemRoutes.ts`:
- Ensure both routes are explicitly handled:
  - `GET /api/ip-echo` -> Returns `{ ip: string, note: string, timestamp: string }`
  - `GET /ip-echo` -> Returns same JSON payload (for backwards compatibility).
- Set CORS and JSON headers properly.
- In `src/extensionTemplates.ts` (`renderPopupJs`) and `extension/popup.js`, use `${serverBase}/api/ip-echo`.

---

## 6. Verification & Quality Gates

1. **Automated Unit Tests**:
   - Test PAC injection with user rules (verifying rule precedence and valid syntax).
   - Test `/api/ip-echo` and `/ip-echo` HTTP responses in `systemRoutes`.
   - Test `renderPopupHtml` and `renderPopupJs` output containing new 3-tab markup and 3-button actions.
   - Run `npm test` to ensure all existing + new test suites pass.
2. **Build Verification**:
   - Run `npm run build` to verify clean TypeScript compilation.
3. **Manual / Live Verification**:
   - Inspect extension popup in Chrome: 380px width, sleek UI, 3 tabs, 3-button controls, user overrides operational, Day/Night toggle switching themes smoothly.
