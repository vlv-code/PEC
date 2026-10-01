# Devices, Extension Studio & Popup UX Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the extension popup UI, fix routing modals DOM structure, refine Extension Studio constructor with custom icon uploads and flexible frame, rename fleet to devices with instance deletion, and polish 3x-ui integration.

**Architecture:** Clean separation of concerns between extension templates (`src/extensionTemplates.ts`), client dashboard views (`src/views/dashboardView.ts`, `public/dashboard.js`), and server-side packager/rotation logic (`src/packager.ts`, `src/rotate.ts`). Parity between static extension files and generated templates is strictly preserved.

**Tech Stack:** TypeScript, Node.js (v18+), Express, Chrome MV3 Extension APIs, HTML5/CSS3, Canvas API.

**Spec:** `docs/superpowers/specs/2026-10-01-devices-studio-popup-ux-overhaul-design.md`

## Global Constraints

- Chrome MV3 Strict CSP: No inline event handlers (`onclick=...`) in popup HTML or extension pages.
- Chrome PAC 7-bit ASCII compliance: PAC scripts must only contain characters with ASCII codes <= 127.
- 1:1 Parity: `extension/` static files and `src/extensionTemplates.ts` templates must be identical.
- Zero external binary dependencies for geodata parsing or packaging.
- Every task ends with an independently testable deliverable and a git commit.

---

### Task 1: Extension Popup UI & Logs Modernization

**Files:**
- Modify: `extension/popup.html`
- Modify: `extension/popup.js`
- Modify: `extension/background.js`
- Modify: `src/extensionTemplates.ts`
- Test: `test/popupStructure.test.ts`

**Interfaces:**
- Consumes: `renderPopupHtml`, `renderPopupJs`, `BACKGROUND_TEMPLATE` from `src/extensionTemplates.ts`
- Produces: Updated popup markup with 3 tabs (`Главная`, `Роутинг`, `Инфо`), minimalist action buttons in connection card header, symmetrical padding, and `[PEC]` log prefix.

- [ ] **Step 1: Write the failing test for popup structure and log prefix**

Update `test/popupStructure.test.ts`:
```typescript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { renderPopupHtml, BACKGROUND_TEMPLATE } from "../src/extensionTemplates.js";

test("popup HTML has updated tabs (Главная, Роутинг, Инфо) and minimalist header buttons", () => {
  const html = renderPopupHtml();
  assert.match(html, /Главная/);
  assert.match(html, /Роутинг/);
  assert.match(html, /Инфо/);
  assert.match(html, /id="btnSyncNow"/);
  assert.match(html, /id="btnPowerToggle"/);
  assert.match(html, /id="btnPauseToggle"/);
  assert.doesNotMatch(html, /hero-status-card/);
});

test("extension background uses [PEC] log prefix", () => {
  assert.match(BACKGROUND_TEMPLATE, /\[PEC\]/);
  assert.doesNotMatch(BACKGROUND_TEMPLATE, /\[corp-proxy\]/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/popupStructure.test.ts`
Expected: FAIL due to tab names, missing header action buttons, or log prefix.

- [ ] **Step 3: Implement popup layout, buttons, symmetrical padding, and log prefix**

1. In `extension/popup.html` and `src/extensionTemplates.ts` (`renderPopupHtml`):
   - Rename tabs:
     ```html
     <button class="tab-btn active" data-tab="tab-status" id="tabBtnStatus">Главная</button>
     <button class="tab-btn" data-tab="tab-routing" id="tabBtnRouting">Роутинг</button>
     <button class="tab-btn" data-tab="tab-info" id="tabBtnInfo">Инфо</button>
     ```
   - In CSS:
     ```css
     .tab-content > .card:last-child {
       margin-bottom: 0;
     }
     .card-header-actions {
       display: flex;
       align-items: center;
       gap: 6px;
     }
     .btn-icon-minimal {
       width: 30px;
       height: 30px;
       padding: 0;
       border-radius: 6px;
       border: 1px solid var(--border-color);
       background: transparent;
       color: var(--text-main);
       cursor: pointer;
       display: flex;
       align-items: center;
       justify-content: center;
       font-size: 14px;
       transition: all 0.2s ease;
     }
     .btn-icon-minimal:hover {
       background: var(--bg-hover, rgba(255, 255, 255, 0.08));
       border-color: var(--accent-color);
     }
     ```
   - In `#tab-status`, remove `.hero-status-card`.
   - Update `#cardConnection` header:
     ```html
     <div class="card" id="cardConnection">
       <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
         <span class="card-title">🔌 Подключение к корпоративному шлюзу</span>
         <div class="card-header-actions">
           <button class="btn-icon-minimal" id="btnSyncNow" title="Синхронизировать сейчас">🔄</button>
           <button class="btn-icon-minimal" id="btnPowerToggle" title="Включить / Выключить прокси">⏻</button>
           <button class="btn-icon-minimal" id="btnPauseToggle" title="Приостановить прокси на 15 минут">⏸️</button>
         </div>
       </div>
       ...
     ```
2. In `extension/background.js` and `src/extensionTemplates.ts` (`BACKGROUND_TEMPLATE`):
   - Replace all occurrences of `[corp-proxy]` with `[PEC]`.
3. In `extension/popup.js` and `src/extensionTemplates.ts` (`renderPopupJs`):
   - Upgrade `btnCheckIp` listener: query public external IP endpoints (`https://api.ipify.org?format=json`, fallback `https://icanhazip.com`) with 4-second timeout, falling back to local server `base + "/api/ip-echo"` only if external access fails. This prevents displaying internal LAN IP (e.g. `192.168.5.25`) for external IP checks.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/popupStructure.test.ts test/purity.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extension/popup.html extension/popup.js extension/background.js src/extensionTemplates.ts test/popupStructure.test.ts
git commit -m "feat(popup): modernize tab titles, header controls, symmetrical padding, [PEC] log prefix, and public external IP check"
```

---

### Task 2: Routing Profiles Modals DOM Fix

**Files:**
- Modify: `src/views/dashboardView.ts`
- Modify: `public/dashboard.js`
- Test: `test/modalsDomStructure.test.ts`

**Interfaces:**
- Consumes: `renderDashboardView` in `src/views/dashboardView.ts`
- Produces: Correct DOM hierarchy with `#modalGeobaseInspector` and `#modalImportPresets` located directly under `<body>`.

- [ ] **Step 1: Write the failing test for modal DOM placement**

Create `test/modalsDomStructure.test.ts`:
```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { renderDashboardHtml } from "../src/views/dashboardView.js";

test("Geobase Inspector and Import Presets modals are top-level under body and not inside modalProxyForm", () => {
  const html = renderDashboardHtml({});
  
  // modalProxyForm closing tag must occur before modalGeobaseInspector
  const proxyFormIndex = html.indexOf('id="modalProxyForm"');
  const geobaseInspectorIndex = html.indexOf('id="modalGeobaseInspector"');
  const importPresetsIndex = html.indexOf('id="modalImportPresets"');

  assert.ok(proxyFormIndex !== -1, "modalProxyForm exists");
  assert.ok(geobaseInspectorIndex !== -1, "modalGeobaseInspector exists");
  assert.ok(importPresetsIndex !== -1, "modalImportPresets exists");

  // Extract snippet between proxyForm and geobaseInspector to confirm proxyForm is closed
  const proxyFormSnippet = html.slice(proxyFormIndex, geobaseInspectorIndex);
  // Must contain closing div for modal-content and modal-overlay
  assert.ok(proxyFormSnippet.includes('</form>'), "Proxy form has closed form tag");
  assert.ok(proxyFormSnippet.includes('</div>\n  </div>') || proxyFormSnippet.includes('</div></div>'), "Proxy form closes dialog and overlay");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/modalsDomStructure.test.ts`
Expected: FAIL due to missing closing tags before `modalGeobaseInspector`.

- [ ] **Step 3: Fix modal closing tags and isolate modals**

1. In `src/views/dashboardView.ts`:
   - Locate the end of `#modalProxyForm`: ensure `</form>`, `</div>` (dialog), `</div>` (overlay) are present.
   - Verify `#modalGeobaseInspector` and `#modalImportPresets` are cleanly positioned as siblings of `#modalProxyForm`.
2. In `public/dashboard.js`:
   - Verify `openGeobaseInspector()` removes `display: none` and adds `display: flex` (or `class active`).
   - Verify `closeGeobaseInspector()` hides the modal.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/modalsDomStructure.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/views/dashboardView.ts public/dashboard.js test/modalsDomStructure.test.ts
git commit -m "fix(dashboard): move geobase inspector and import presets modals out of proxy form overlay"
```

---

### Task 3: Extension Studio Constructor & Icon System

**Files:**
- Modify: `src/types.ts`
- Modify: `src/packager.ts`
- Modify: `src/views/dashboardView.ts`
- Modify: `public/dashboard.js`
- Modify: `public/dashboard.css`
- Test: `test/constructorIntegration.test.ts`

**Interfaces:**
- Consumes: `ExtensionBuildConfig`
- Produces: Clean Studio with 2 modes (`popup` / `stealth`), persistent preview templates, custom icon upload and emoji icon generator, no scrollbars in preview iframe.

- [ ] **Step 1: Write the failing test for Extension Studio modes and template persistence**

Update `test/constructorIntegration.test.ts`:
```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { generateExtensionFiles } from "../src/packager.js";
import { renderDashboardHtml } from "../src/views/dashboardView.js";

test("Extension Studio provides popup and stealth modes without kiosk", () => {
  const html = renderDashboardHtml({});
  assert.match(html, /Обычный режим/);
  assert.match(html, /Скрытый агент/);
  assert.doesNotMatch(html, /Режим киоска/i);
});

test("generateExtensionFiles always generates popup.html and popup.js in memory even in stealth mode", () => {
  const files = generateExtensionFiles({
    profile: {
      profileId: "test_p",
      name: "Test",
      mode: "pac",
      defaultAction: "DIRECT",
      rules: [],
      pacScript: "",
      routingMatrix: [],
      syncIntervalSec: 60,
      failoverMode: "direct",
      statsEnabled: true,
      logLevel: "INFO"
    },
    serverUrl: "https://proxy.example.com",
    uiMode: "stealth"
  });

  assert.ok(files["popup.html"], "popup.html is present in memory for preview");
  assert.ok(files["popup.js"], "popup.js is present in memory for preview");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/constructorIntegration.test.ts`
Expected: FAIL due to missing popup files in stealth mode or kiosk reference in dashboard.

- [ ] **Step 3: Update Packager, Dashboard View, and CSS**

1. In `src/types.ts`:
   - Update `uiMode?: 'popup' | 'stealth';`
   - Add `customIconDataUrl?: string;`
2. In `src/packager.ts`:
   - In `generateExtensionFiles()`:
     - Always generate `files['popup.html'] = renderPopupHtml(...);` and `files['popup.js'] = renderPopupJs(...);`.
     - In `manifest.json`: if `config.uiMode === 'stealth'`, omit `"action"` property.
   - Add icon generation supporting both emoji and `customIconDataUrl` (PNG buffer generation).
3. In `src/views/dashboardView.ts`:
   - Rename section to "1. Режим интерфейса".
   - Keep 2 cards: "Обычный режим" (`popup`) and "Скрытый агент" (`stealth`). Remove Kiosk card.
   - Remove redundant "Режим интерфейса" select and "Тип векторной иконки" select.
   - Add Custom Icon upload input `<input type="file" id="iconFileInput" accept="image/png,image/jpeg,image/webp,image/svg+xml">`.
4. In `public/dashboard.js` & `public/dashboard.css`:
   - Handle icon file upload, convert to data URL and set in config.
   - Preview frame `.popup-frame-box` and `iframe`: add `overflow: hidden;`, eliminate viewport scrollbars.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/constructorIntegration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/packager.ts src/views/dashboardView.ts public/dashboard.js public/dashboard.css test/constructorIntegration.test.ts
git commit -m "feat(studio): streamline interface modes, enable custom icon upload, and eliminate preview scrollbars"
```

---

### Task 4: Devices (Fleet) Management

**Files:**
- Modify: `src/views/dashboardView.ts`
- Modify: `public/dashboard.js`
- Test: `test/devicesView.test.ts`

**Interfaces:**
- Consumes: `DELETE /api/instances/:id`
- Produces: Renamed "Устройства" UI and working delete instance button.

- [ ] **Step 1: Write the failing test for Devices view**

Create `test/devicesView.test.ts`:
```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { renderDashboardHtml } from "../src/views/dashboardView.js";

test("Dashboard renders Devices navigation and titles without Fleet references", () => {
  const html = renderDashboardHtml({});
  assert.match(html, /💻 Устройства/);
  assert.match(html, /Устройства корпоративной сети/);
  assert.doesNotMatch(html, /Флот установок/);
  assert.doesNotMatch(html, /Управление флотом/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/devicesView.test.ts`
Expected: FAIL due to remaining "Флот" strings.

- [ ] **Step 3: Implement Devices renaming and deletion**

1. In `src/views/dashboardView.ts`:
   - Replace all remaining references to "Флот" with "Устройства".
   - In instances table headers, add "Действия" column.
2. In `public/dashboard.js`:
   - In `renderInstancesTable(instances)`:
     - Render a delete button `<button class="btn btn-sm btn-danger btn-delete-instance" data-id="${inst.instanceId}">🗑️</button>`.
   - Add event handler to trigger `deleteInstance(instanceId)` which calls `DELETE /api/instances/${encodeURIComponent(instanceId)}`.
   - On success, reload list and show notification.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/devicesView.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/views/dashboardView.ts public/dashboard.js test/devicesView.test.ts
git commit -m "feat(devices): rename fleet to devices and add instance deletion button"
```

---

### Task 5: 3x-ui Integration & Settings Streamlining

**Files:**
- Modify: `src/rotate.ts`
- Modify: `src/views/dashboardView.ts`
- Modify: `public/dashboard.js`
- Modify: `src/routes/configRoutes.ts`
- Test: `test/rotate3xuiTagOrRemark.test.ts`

**Interfaces:**
- Consumes: `sync3xuiInboundByTag` in `src/rotate.ts`
- Produces: Inbound lookup matching both tag and remark, admin password preservation with status indicator, removed client traffic routing mode card.

- [ ] **Step 1: Write the failing test for 3x-ui tag/remark matching and password preservation**

Create `test/rotate3xuiTagOrRemark.test.ts`:
```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { findInboundByTagOrRemark } from "../src/rotate.js";

test("findInboundByTagOrRemark matches by exact tag, trimmed tag, or remark", () => {
  const inbounds = [
    { id: 1, tag: "vless-inbound-1", remark: "US Office Primary" },
    { id: 2, tag: "vless-inbound-2", remark: "EU Failover" }
  ];

  assert.equal(findInboundByTagOrRemark(inbounds, "vless-inbound-1")?.id, 1);
  assert.equal(findInboundByTagOrRemark(inbounds, "US Office Primary")?.id, 1);
  assert.equal(findInboundByTagOrRemark(inbounds, "eu failover")?.id, 2);
  assert.equal(findInboundByTagOrRemark(inbounds, "unknown"), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/rotate3xuiTagOrRemark.test.ts`
Expected: FAIL because `findInboundByTagOrRemark` is not defined.

- [ ] **Step 3: Implement tag/remark lookup, password preservation, and remove redundant card**

1. In `src/rotate.ts`:
   - Implement `findInboundByTagOrRemark(inbounds: any[], target: string)`.
   - Update `sync3xuiInboundByTag` to use this function.
2. In `src/routes/configRoutes.ts`:
   - When updating proxy/rotation config: if `rotAdminPass` is empty string or undefined in request body, preserve the existing `currentConfig.rotAdminPass`.
3. In `src/views/dashboardView.ts`:
   - In 3x-ui / Proxy Settings: next to `#rotAdminPass`, add `<span id="passwordSavedBadge" class="badge badge-success" style="display: none; margin-left: 8px;">(Пароль сохранён на сервере)</span>`.
   - Remove obsolete "Режим маршрутизации трафика клиентов" card.
4. In `public/dashboard.js`:
   - Display `#passwordSavedBadge` if `config.rotAdminPass` exists.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/rotate3xuiTagOrRemark.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/rotate.ts src/views/dashboardView.ts public/dashboard.js src/routes/configRoutes.ts test/rotate3xuiTagOrRemark.test.ts
git commit -m "feat(3x-ui): support tag or remark lookup, preserve admin password, and clean up proxy settings"
```

---

### Task 6: Full Verification, Purity & Build

**Files:**
- Any minor adjustments across repository
- Verification: `test/purity.test.ts`, `npm test`, `npm run build`

**Interfaces:**
- Consumes: Entire codebase
- Produces: 100% clean test suite, zero build errors, production-ready release.

- [ ] **Step 1: Run purity tests**

Run: `npx tsx --test test/purity.test.ts`
Expected: PASS (zero inline handlers, 1:1 template parity, 7-bit ASCII PAC).

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All 188+ tests pass with 0 failures.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: Clean build with exit code 0.

- [ ] **Step 4: Push to origin/main**

```bash
git push origin main
```
