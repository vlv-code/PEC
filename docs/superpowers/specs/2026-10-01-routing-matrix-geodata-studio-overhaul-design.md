# Routing Matrix, Geodata (.dat) Subsystem, Popup Geometry & Studio Overhaul Design Spec

**Date:** 2026-10-01  
**Status:** Approved & Ready for Planning  
**Target Areas:**
1. Chrome Extension Popup (`extension/popup.html`, `extension/popup.js`, `src/extensionTemplates.ts`)
2. Routing Engine & PAC Generator (`src/extensionPureLogic.ts`, `extension/background.js`, `src/routing.ts`)
3. Geodata & Presets Engine (`src/geodata/datParser.ts`, `src/storage.ts`, `src/routes/routingRoutes.ts`, `src/types.ts`)
4. Dashboard Routing Profiles & Matrix UI (`src/views/dashboardView.ts`, `public/dashboard.js`, `public/dashboard.css`)
5. Extension Studio Constructor Live Preview (`public/dashboard.js`, `public/dashboard.css`)

---

## 1. Objectives & Problem Statements

### 1.1 Popup Geometry & Asymmetry
- **Problem**: In `popup.html`, `.tabs` was `display: flex; gap: 6px;` with `white-space: nowrap;`. The label `"📊 Инфо и Диагностика"` was 19 characters, causing the 3 tabs to require more than the available 380px inner width. This pushed the entire tab bar to the right, truncating the right padding and causing asymmetrical margins. In the parameters card, values were uncomfortably tight against the right card border.
- **Solution**:
  - Rename tab 3 to `"📊 Инфо"` (or `"ℹ️ Инфо"`).
  - Convert `.tabs` to `display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;`.
  - Enforce strictly equal tab widths (~112px each) with symmetric outer 14px window padding.
  - Standardize inner card padding to `12px 14px` with balanced spacing.

### 1.2 Extension Studio Constructor Preview
- **Problem**:
  - Container `.popup-frame-box` had fixed `width: 350px;` while the extension is `380px`, cutting off content and causing scrollbars.
  - The simulator script inside the iframe lacked `chrome.storage.local` and `chrome.tabs.query`, throwing uncaught runtime TypeErrors on load.
  - Simulator listener checked `msg.action` only, missing `msg.type` messages.
- **Solution**:
  - Make preview flexible: `.popup-frame-box` uses `width: fit-content; max-width: 100%; transition: all 0.2s ease;`.
  - In iframe, measure content `scrollWidth` and `scrollHeight` via `ResizeObserver`, posting `{ type: 'PREVIEW_RESIZE', width, height }`.
  - Parent frame dynamically adjusts dimensions to fit the popup pixel-for-pixel without scrollbars.
  - Implement full mock for `chrome.storage.local` (`get`, `set`) and `chrome.tabs.query`, and support both `msg.type` and `msg.action`.

### 1.3 PAC Domain Normalization
- **Problem**: End-users entering `yandex.ru` expect both `yandex.ru` and `*.yandex.ru` to match. Users entering `*.ru` or `.ru` expect all `.ru` sites to match.
- **Solution**:
  - Enhance `injectUserRulesIntoPac` to normalize patterns:
    - If pattern starts with `*.`: `shExpMatch(host, "*.ru") || host === "ru"`.
    - If pattern starts with `.`: normalized to `*.` rule.
    - If pattern is a bare domain (no wildcard, e.g. `domain.com`): `host === "domain.com" || dnsDomainIs(host, ".domain.com") || shExpMatch(host, "*.domain.com")`.

### 1.4 Geodata Subsystem (.dat, .txt, GitHub & Local Upload)
- **Problem**: Presets were hardcoded in `src/routing.ts`. Users frequently use `.dat` files (`geosite.dat`, `geoip.dat`) from GitHub (V2Ray, Xray, Loyalsoldier, runetfreedom) or plain `.txt` domain/CIDR lists, and cannot add or edit them.
- **Solution**:
  - Implement a pure TypeScript protobuf parser for `geosite.dat` (`GeoSiteList` -> `GeoSite` with `Domain` rules: Substr, Regex, Domain, Full) and `geoip.dat` (`GeoIP` -> `CIDR`).
  - Support importing from remote URLs (GitHub raw, release `.dat` binaries) and local file upload (`.dat`, `.txt`, `.list`, `.json`).
  - Store presets dynamically in `data/routing_presets.json` (falling back to built-ins if empty).
  - Full CRUD API: `GET /api/routing/presets`, `POST /api/routing/presets`, `DELETE /api/routing/presets/:id`, `POST /api/routing/presets/import-url`, `POST /api/routing/presets/import-file`, `POST /api/routing/presets/:id/refresh`.

### 1.5 Geobase Inspector & Cherry-Picking
- **Problem**: Admin cannot view domains inside a preset without digging into source code, nor pick specific domains to add to a profile.
- **Solution**:
  - Clicking a geobase opens a modal inspector.
  - Search / filter box for domains and CIDRs.
  - Checkboxes for each entry (with "Select All" / "Deselect All").
  - "Add Selected to Profile" button with action selector (`PROXY`, `DIRECT`, `BLOCK`).

### 1.6 Routing Profiles Hierarchy & UI UX
- **Problem**:
  - No way to change rule order, despite "(Evaluated Top-to-Bottom)".
  - Duplicate presets could be added repeatedly without warning.
  - Orphan 5th preset card on a second row.
  - Dropdown text clipped (`DIRECT по умолчанию (Выборочный пр...`).
  - No unsaved changes warning.
  - Required "Rule Name" for simple custom domains.
- **Solution**:
  - Add `▲` and `▼` buttons to each row in the rules table to reorder priority.
  - Prevent duplicate presets: show badge `In Profile: PROXY` on preset card; clicking updates action instead of duplicating.
  - Responsive card grid `repeat(auto-fill, minmax(260px, 1fr))`.
  - Auto-generate rule name if left blank (defaults to pattern).
  - Pulse highlight on "Save Profile" button when unsaved modifications exist.

---

## 2. Technical Architecture & File Changes

### 2.1 Backend Geodata & Presets
- `src/geodata/datParser.ts`:
  - Pure Protobuf wire-format decoder (decodes varints, length-delimited byte slices).
  - Decodes `GeoSiteList`: extracts category tags (`ru`, `google`, `telegram`, `category-ads`, `openai`, etc.) and domain lists.
  - Decodes `GeoIP`: extracts country code tags and CIDR IPv4/IPv6 ranges.
- `src/storage.ts`:
  - `getRoutingPresetsPath()` -> returns `<dataDir>/routing_presets.json`.
  - Atomic read/write helpers for presets.
- `src/routing.ts`:
  - Dynamic preset loading with fallback to default `GEO_PRESETS`.
  - Enhanced PAC generation honoring rule hierarchy and normalized domain/CIDR matches.
- `src/routes/routingRoutes.ts`:
  - Endpoints for presets CRUD, URL import with SSRF validation, file upload, and refresh.

### 2.2 Extension Popup Geometry & Normalization
- `extension/popup.html` & `src/extensionTemplates.ts`:
  - Rename tab 3 to `"📊 Инфо"`.
  - `.tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }`.
  - Symmetrical card padding and hero container alignment.
- `src/extensionPureLogic.ts` & `extension/background.js`:
  - Smart domain normalization for `*.ru`, `.ru`, and bare domains in `injectUserRulesIntoPac`.

### 2.3 Dashboard UI & Flexible Preview
- `public/dashboard.css`:
  - `.popup-frame-box { width: fit-content; max-width: 100%; ... }`.
  - Reorder buttons (`.btn-reorder-up`, `.btn-reorder-down`).
  - Responsive presets grid `.presets-grid`.
  - Geobase inspector modal styles.
  - Unsaved indicator badge.
- `public/dashboard.js`:
  - `PREVIEW_RESIZE` handler updating iframe width and height dynamically.
  - Simulator `mockScript` providing `chrome.storage.local` and `chrome.tabs.query`.
  - Rule reordering functions `moveRuleUp(idx)` and `moveRuleDown(idx)`.
  - Geobase inspector modal logic: search, select checkboxes, batch add to profile.
  - Import modal logic: fetch from URL / file upload, category picker for `.dat`.
- `src/views/dashboardView.ts`:
  - Updated HTML layout for Routing Profiles page and constructor preview frame.

---

## 3. Verification & Quality Gates
1. Unit tests for Protobuf `.dat` parser (`test/geodatParser.test.ts`).
2. Unit tests for presets CRUD and URL import (`test/presetsApi.test.ts`).
3. Unit tests for rule reordering and PAC hierarchy generation (`test/routingHierarchy.test.ts`).
4. Unit tests for smart domain normalization in PAC (`test/domainNormalization.test.ts`).
5. Purity and CSP validation (`test/purity.test.ts`).
6. Full test suite passing (`npm test`).
7. Clean TypeScript compilation (`npm run build`).
