# Design Specification: Devices, Extension Studio & Popup UX Overhaul

## 1. Overview & Objective
This specification establishes the architectural, behavioral, and visual design requirements for the next major overhaul of the Corporate Proxy Extension & Management Platform (`proxy_extention_corp`).

The overhaul focuses on five key pillars:
1. **Extension Popup UI & Logs Modernization:** Compact, clean UI without redundant cards; 3 minimalist icon-only control buttons in the connection card header; balanced symmetrical padding (14px); `[PEC]` log prefix; tab rename (`Главная`, `Роутинг`, `Инфо`) and centered dividers.
2. **Routing Profiles Modals DOM Structure:** Fix misplaced modal dialogs (`#modalGeobaseInspector` and `#modalImportPresets`) nested inside `#modalProxyForm`.
3. **Extension Studio Constructor & Icon Management:** Remove Kiosk mode; rename Archetypes to "Режим интерфейса" with Normal and Stealth; prevent preview breakage by retaining popup templates in memory; remove redundant UI Mode and Vector Icon Type selects; support custom icon image upload generating MV3 icon PNGs; eliminate preview scrollbars.
4. **Devices Management (Fleet Renaming & Lifecycle):** Rename all "Флот / Fleet" references to "Устройства / Devices"; add interactive device deletion calling existing `DELETE /api/instances/:id`.
5. **3x-ui Integration & Settings Streamlining:** Inbound lookup by `tag` or `remark`; admin password preservation with status indicator; remove obsolete "Client Traffic Routing Mode" card.

---

## 2. Extension Popup UI & Logs Modernization

### 2.1 Tab Bar
- Tabs renamed to:
  - Tab 1: `Главная` (id: `tabBtnStatus`)
  - Tab 2: `Роутинг` (id: `tabBtnRouting`)
  - Tab 3: `Инфо` (id: `tabBtnInfo`)
- Layout: 3 equal columns, centered labels, subtle vertical divider separators between buttons, smooth active indicator.

### 2.2 Main Tab Redesign
- Remove the redundant `.hero-status-card` ("Защита активна" banner).
- The primary connection card (`#cardConnection`) becomes the central focal point.
- **Header Actions:** Place 3 minimalist icon-only action buttons in the top right of `#cardConnection`:
  1. `btnSyncNow`: 🔄 (Tooltip: `Синхронизировать сейчас`) -> sends `SYNC_NOW`
  2. `btnPowerToggle`: ⏻ (Tooltip: `Включить / Выключить прокси`) -> sends `SET_ENABLED`
  3. `btnPauseToggle`: ⏸️ (Tooltip: `Приостановить прокси на 15 минут`) -> sends `BYPASS_TOGGLE` (duration: 15m)
- Button styling:
  - `.btn-icon-minimal`: 32x32px, border-radius 6px, transparent background, subtle border matching palette, flex center, no text.
  - Hover / active state: slight background highlight.

### 2.3 Symmetrical Padding
- Container padding is `14px`.
- Cards have `margin-bottom: 10px;`.
- The last `.card` inside any tab content container must have `margin-bottom: 0;` via `.tab-content > .card:last-child { margin-bottom: 0; }`.
- Ensures the bottom margin matches the top and lateral margins exactly (14px).

### 2.4 Log Prefix
- All console and extension logs are standardized to `[PEC]` instead of `[corp-proxy]`.

### 2.5 External IP Diagnostics & Detection
- In `extension/popup.js` and `src/extensionTemplates.ts`:
  - `btnCheckIp` previously only queried `base + '/api/ip-echo'`. In internal/intranet environments (where `window.__pecServerBase` is hosted on LAN or behind a direct internal route), this returned the local private LAN IP (e.g. `192.168.5.25`) instead of the true external egress IP.
  - Egress IP check must query public external IP endpoints:
    1. Primary: `https://api.ipify.org?format=json` (returns `{ ip: string }`)
    2. Secondary fallback: `https://icanhazip.com` (plain text response)
    3. Final fallback: `base + '/api/ip-echo'` (local server echo if offline or external access blocked).
  - This ensures that when routing through proxy, the proxy's public egress IP is displayed, and when direct, the user's real public ISP IP is displayed, never a private RFC1918 address (unless completely isolated from the internet).

---

## 3. Routing Profiles & Modals DOM Structure

### 3.1 Modal Isolation
- In `src/views/dashboardView.ts`, `#modalGeobaseInspector` and `#modalImportPresets` were previously placed inside `#modalProxyForm`'s `.modal-dialog` due to missing closing tags.
- Required structure:
  ```html
  <!-- Modal: Proxy Form -->
  <div id="modalProxyForm" class="modal-overlay">...</div>

  <!-- Modal: Geobase Inspector -->
  <div id="modalGeobaseInspector" class="modal-overlay">...</div>

  <!-- Modal: Import Presets -->
  <div id="modalImportPresets" class="modal-overlay">...</div>
  ```
- All modals reside directly under `<body>` to allow proper stacking context, backdrop, and accessibility.

### 3.2 Functionality Verification
- Preset card 🔍 (Inspector loupe) triggers `openGeobaseInspector(presetId)`.
- `+ Импорт пресетов` button triggers `openImportPresetsModal()`.

---

## 4. Extension Studio Constructor & Icon Management

### 4.1 Interface Modes
- Remove "Режим киоска (Kiosk Mode)".
- Rename "1. Функциональные конфигурационные архетипы" to "1. Режим интерфейса".
- Supported modes:
  - `popup`: "Обычный режим" (standard user popup UI)
  - `stealth`: "Скрытый агент" (runs purely in background, no browserAction/popup)

### 4.2 Preview State Persistence
- In `src/packager.ts`:
  - `renderPopupHtml()` and `renderPopupJs()` must always be executed and placed into `files['popup.html']` and `files['popup.js']` so that when switching between `stealth` and `popup`, the preview iframe always has content.
  - In `buildExtensionPackage()` zip generation, if `uiMode === "stealth"`, `manifest.action` is omitted from `manifest.json`.

### 4.3 Redundancy Cleanup
- Remove the redundant "Режим интерфейса" select from the Branding section in `src/views/dashboardView.ts`.
- Remove the "Тип векторной иконки" dropdown.

### 4.4 Icon Management
- Extension icons in MV3 require PNG formats (16x16, 48x48, 128x128).
- Two sources supported:
  1. **Emoji Icon:** User types or selects an emoji (e.g. 🛡️, 🚀, ⚡). Rendered to PNG canvas buffers.
  2. **Custom Uploaded Image:** User uploads PNG, JPEG, WebP, or SVG file. Cropped/scaled to square PNG icons.
- Extension package produces:
  - `icons/icon16.png`
  - `icons/icon48.png`
  - `icons/icon128.png`
- Live Preview iframe renders the chosen icon in its header.

### 4.5 Preview Scrollbars Elimination
- Preview container `.popup-frame-box` and `iframe` have `overflow: hidden;`.
- Iframe height is dynamically adapted to the exact internal `scrollHeight` without triggering viewport scrollbars.

---

## 5. Devices Management (Fleet Renaming & Lifecycle)

### 5.1 Naming Standardization
- All UI labels, navigation links, table headers, stat cards, and log messages referring to "Флот / Fleet" are renamed to "Устройства / Devices":
  - Menu item: `💻 Устройства`
  - Title: `Устройства корпоративной сети`
  - Subtitle: `Список активных установок расширения и их текущий статус`
  - Table header: `Зарегистрированные устройства`

### 5.2 Device Deletion
- Each row in the Devices table displays a delete button (🗑️).
- Clicking prompts confirmation (`Удалить устройство {id}?`).
- On confirmation, calls `DELETE /api/instances/:id`.
- On success, displays toast and reloads devices list via `loadInstances()`.

---

## 6. 3x-ui Integration & Settings Streamlining

### 6.1 Flexible Inbound Lookup
- When synchronizing 3x-ui inbounds in `src/rotate.ts` (`sync3xuiInboundByTag`):
  - Check match on inbound `tag` (exact or case-insensitive trimmed) OR inbound `remark` (case-insensitive trimmed).
  - This allows users to label their 3x-ui inbounds using either technical tags or human-readable remarks.

### 6.2 Password Preservation
- In Proxy Settings / 3x-ui configuration:
  - If the user leaves the admin password field blank when saving, the backend retains the existing `rotAdminPass`.
  - When a password is configured in storage, the UI renders a green badge: `(Пароль сохранён на сервере)` next to the password input field.

### 6.3 Cleanup
- Remove the obsolete "Режим маршрутизации трафика клиентов" (Client Traffic Routing Mode) card from Proxy Settings.

---

## 7. Quality & Verification Standards
- Zero inline JavaScript event handlers in extension HTML (MV3 strict CSP).
- 100% parity between static files in `extension/` and templates in `src/extensionTemplates.ts`.
- Chrome PAC 7-bit ASCII compliance.
- 100% passing test suite across all units and integration tests.
