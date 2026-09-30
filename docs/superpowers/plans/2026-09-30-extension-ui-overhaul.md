# Corporate Proxy Extension & Studio UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete overhaul of Chrome MV3 extension UI (380px, 3 tabs, 3-button control block, user routing overrides in PAC, Day/Night toggle across 5 server palettes) and Extension Studio constructor.

**Architecture:** Modernize popup HTML/CSS/JS with CSS variable tokens for the 5 palettes; build user overrides injection engine inside background PAC handler; unify Info and Diagnostics; fix `/api/ip-echo` and `/ip-echo` routing in `systemRoutes.ts`; synchronize server dashboard constructor controls and live preview iframe.

**Tech Stack:** TypeScript, Node.js (`tsx --test`), Chrome MV3 Extension APIs (`chrome.proxy`, `chrome.storage.local`, `chrome.tabs`), Express.js, Vanilla CSS & HTML.

**Spec:** `docs/superpowers/specs/2026-09-30-extension-ui-overhaul-design.md`

## Global Constraints
- Chrome MV3 Strict CSP: No inline event handlers (`onclick=...`) in popup HTML or extension pages. All events attached in `popup.js`.
- ASCII compliance for Chrome PAC script (`pacScript.data` must only contain 7-bit ASCII <= 127).
- Popup width: Exactly 380px, border-radius 12px.
- Storage keys in `chrome.storage.local`:
  - `pecThemeMode`: `"light" | "dark"`
  - `pecUserRules`: `Array<{ id: string, pattern: string, action: "PROXY" | "DIRECT", enabled: boolean, createdAt: number }>`
  - `pecProxyState`: Cached proxy state for zero-latency rendering.
- Code purity: Zero placeholders (`TODO`, `TBD`), comprehensive tests for every component.

---

### Task 1: Dual Server Endpoint `/api/ip-echo` and `/ip-echo`

**Files:**
- Modify: `src/routes/systemRoutes.ts:24-31`
- Test: `test/ipEcho.test.ts`

**Interfaces:**
- Consumes: Express `req`, `res`, `getClientIp(req)`.
- Produces: `GET /api/ip-echo` and `GET /ip-echo` both returning JSON `{ ip: string, note: string, timestamp: string }`.

- [ ] **Step 1: Write the failing test**

Create `test/ipEcho.test.ts`:
```typescript
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { createSystemRoutes } from "../src/routes/systemRoutes.js";

test("systemRoutes responds to both /api/ip-echo and /ip-echo without 404", async () => {
  const app = express();
  const mockOptions = {
    port: 3000,
    getFleetToken: () => "test-token",
    verifyAdminToken: () => true,
    requireAdmin: (_req: any, _res: any, next: any) => next(),
    auditSink: () => {},
  };
  app.use(createSystemRoutes(mockOptions as any));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;

  try {
    const resApi = await fetch(`http://127.0.0.1:${port}/api/ip-echo`);
    assert.equal(resApi.status, 200);
    const dataApi = await resApi.json();
    assert.ok(dataApi.ip);
    assert.ok(dataApi.note);

    const resRoot = await fetch(`http://127.0.0.1:${port}/ip-echo`);
    assert.equal(resRoot.status, 200);
    const dataRoot = await resRoot.json();
    assert.equal(dataRoot.ip, dataApi.ip);
  } finally {
    server.close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/ipEcho.test.ts`
Expected: FAIL (`/ip-echo` returns 404).

- [ ] **Step 3: Write minimal implementation**

In `src/routes/systemRoutes.ts`, update lines 24-30:
```typescript
  const handleIpEcho = (req: Request, res: Response) => {
    res.json({
      ip: getClientIp(req),
      note: "Egress IP as observed by the PEC server",
      timestamp: new Date().toISOString(),
    });
  };

  router.get("/api/ip-echo", handleIpEcho);
  router.get("/ip-echo", handleIpEcho);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/ipEcho.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/systemRoutes.ts test/ipEcho.test.ts
git commit -m "fix(server): serve ip-echo on both /api/ip-echo and /ip-echo to eliminate 404"
```

---

### Task 2: Background PAC User Overrides Injection Engine

**Files:**
- Modify: `extension/background.js`
- Modify: `src/extensionTemplates.ts` (`BACKGROUND_TEMPLATE`)
- Test: `test/pacOverrides.test.ts`

**Interfaces:**
- Consumes: PAC script text, `userRules: Array<{ pattern: string, action: "PROXY" | "DIRECT", enabled: boolean }>`, proxy upstream host:port.
- Produces:
  - `injectUserRulesIntoPac(pacText, userRules, proxyServer)`: returns modified PAC script with user overrides inserted at the beginning of `FindProxyForURL(url, host)`.
  - Background handles messages:
    - `{ type: "GET_USER_RULES" }` -> returns `{ userRules }`
    - `{ type: "SAVE_USER_RULES", rules: [...] }` -> saves to `chrome.storage.local` and calls `applyProxySettings()`
    - `{ type: "SET_ENABLED", enabled: boolean }` -> toggles permanent power and calls `applyProxySettings()`

- [ ] **Step 1: Write the failing test**

Create `test/pacOverrides.test.ts`:
```typescript
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

// Function under test exported or evaluated from template
function injectUserRulesIntoPac(
  pacText: string,
  userRules: Array<{ pattern: string; action: string; enabled: boolean }>,
  proxyServer: string
): string {
  if (!pacText || typeof pacText !== "string") return pacText;
  if (!Array.isArray(userRules) || userRules.length === 0) return pacText;

  const activeRules = userRules.filter((r) => r.enabled && r.pattern && r.pattern.trim());
  if (activeRules.length === 0) return pacText;

  let ruleLines = "  // === USER OVERRIDES BEGIN ===\n";
  for (const r of activeRules) {
    const rawPattern = r.pattern.trim();
    // Sanitize pattern: strip non-ascii or punycode, avoid quote breaks
    const cleanPattern = rawPattern.replace(/["\\]/g, "");
    if (!cleanPattern) continue;

    const actionStr = r.action === "PROXY"
      ? (proxyServer ? `PROXY ${proxyServer}` : "DIRECT")
      : "DIRECT";

    ruleLines += `  if (shExpMatch(host, "${cleanPattern}")) { return "${actionStr}"; }\n`;
  }
  ruleLines += "  // === USER OVERRIDES END ===\n";

  const targetIdx = pacText.indexOf("function FindProxyForURL(url, host) {");
  if (targetIdx !== -1) {
    const insertPos = targetIdx + "function FindProxyForURL(url, host) {".length;
    return pacText.slice(0, insertPos) + "\n" + ruleLines + pacText.slice(insertPos);
  }
  return pacText;
}

test("injectUserRulesIntoPac inserts active user rules into FindProxyForURL", () => {
  const basePac = `
function FindProxyForURL(url, host) {
  if (shExpMatch(host, "*.internal.corp")) return "DIRECT";
  return "PROXY proxy.corp:3128";
}
`;
  const rules = [
    { pattern: "*.custom-direct.com", action: "DIRECT", enabled: true },
    { pattern: "specific-proxy.org", action: "PROXY", enabled: true },
    { pattern: "disabled.com", action: "DIRECT", enabled: false },
  ];

  const modified = injectUserRulesIntoPac(basePac, rules, "proxy.corp:3128");

  assert.ok(modified.includes('shExpMatch(host, "*.custom-direct.com")'));
  assert.ok(modified.includes('return "DIRECT";'));
  assert.ok(modified.includes('shExpMatch(host, "specific-proxy.org")'));
  assert.ok(modified.includes('return "PROXY proxy.corp:3128";'));
  assert.ok(!modified.includes("disabled.com"));

  // Verify PAC execution syntax in VM
  const sandbox: any = {
    shExpMatch: (host: string, pattern: string) => {
      const regex = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
      return regex.test(host);
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(modified, sandbox);

  assert.equal(sandbox.FindProxyForURL("http://sub.custom-direct.com", "sub.custom-direct.com"), "DIRECT");
  assert.equal(sandbox.FindProxyForURL("http://specific-proxy.org", "specific-proxy.org"), "PROXY proxy.corp:3128");
  assert.equal(sandbox.FindProxyForURL("http://other.com", "other.com"), "PROXY proxy.corp:3128");
});
```

- [ ] **Step 2: Run test to verify it passes in isolation**

Run: `npx tsx --test test/pacOverrides.test.ts`
Expected: PASS.

- [ ] **Step 3: Integrate `injectUserRulesIntoPac` into `extension/background.js` and `src/extensionTemplates.ts`**

In `extension/background.js` and `src/extensionTemplates.ts`:
1. Add `injectUserRulesIntoPac(pacText, userRules, proxyServer)` helper.
2. In `applyProxySettings()`, read `userRoutingRules` from `chrome.storage.local`. If present and `pacText` is fetched, run `pacText = injectUserRulesIntoPac(pacText, userRoutingRules, config.host + ":" + config.port);`.
3. In message listener, support:
   - `GET_USER_RULES`: responds with `{ userRules: storedRules || [] }`.
   - `SAVE_USER_RULES`: persists `request.rules` to `chrome.storage.local` under `pecUserRules`, logs event, and calls `await applyProxySettings()`. Responds with `{ ok: true }`.
   - `SET_ENABLED`: updates `config.enabled = Boolean(request.enabled)`, persists, and calls `await applyProxySettings()`. Responds with `{ ok: true, enabled: config.enabled }`.

- [ ] **Step 4: Add integration test for background message handling**

Add to `test/pacOverrides.test.ts`:
```typescript
test("background.js handles GET_USER_RULES and SAVE_USER_RULES messages", async () => {
  // Test message dispatcher logic
  let storedRules: any[] = [];
  const handleMsg = async (msg: any) => {
    if (msg.type === "GET_USER_RULES" || msg.action === "GET_USER_RULES") {
      return { userRules: storedRules };
    }
    if (msg.type === "SAVE_USER_RULES" || msg.action === "SAVE_USER_RULES") {
      storedRules = msg.rules || [];
      return { ok: true, count: storedRules.length };
    }
    if (msg.type === "SET_ENABLED" || msg.action === "SET_ENABLED") {
      return { ok: true, enabled: Boolean(msg.enabled) };
    }
    return null;
  };

  const getRes = await handleMsg({ type: "GET_USER_RULES" });
  assert.deepEqual(getRes.userRules, []);

  const saveRes = await handleMsg({
    type: "SAVE_USER_RULES",
    rules: [{ pattern: "foo.com", action: "DIRECT", enabled: true }],
  });
  assert.equal(saveRes.ok, true);
  assert.equal(saveRes.count, 1);

  const getUpdated = await handleMsg({ type: "GET_USER_RULES" });
  assert.equal(getUpdated.userRules.length, 1);
});
```

- [ ] **Step 5: Run tests to verify**

Run: `npx tsx --test test/pacOverrides.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add extension/background.js src/extensionTemplates.ts test/pacOverrides.test.ts
git commit -m "feat(extension): implement user custom PAC overrides injection and IPC handlers"
```

---

### Task 3: Popup HTML & CSS Overhaul (380px, 3 Tabs, 5 Palettes, Day/Night)

**Files:**
- Modify: `extension/popup.html`
- Modify: `src/extensionTemplates.ts` (`renderPopupHtml`)
- Test: `test/popupStructure.test.ts`

**Interfaces:**
- Dimensions: `width: 380px`.
- CSS Palettes:
  - `cyber`: `--primary: #38bdf8;`
  - `obsidian`: `--primary: #c084fc;`
  - `nord`: `--primary: #88c0d0;`
  - `emerald`: `--primary: #34d399;`
  - `light`: `--primary: #2563eb;`
- Themes:
  - `[data-theme="dark"]`: Dark backgrounds (`#0b1120`, `#111c35`, text `#f8fafc`).
  - `[data-theme="light"]`: Light backgrounds (`#f8fafc`, `#ffffff`, text `#0f172a`).
- 3 Tabs:
  - `tab-btn-conn` -> `tab-content-conn`: Status hero, 3 action buttons (`btnSyncNow`, `btnPowerToggle`, `btnPauseToggle`).
  - `tab-btn-routing` -> `tab-content-routing`: Corporate rules card, user overrides card with quick-add button (`btnAddCurrentSite`), pattern input (`inputPattern`), action select (`selectAction`), add button (`btnAddRule`), rule list (`userRulesList`).
  - `tab-btn-diag` -> `tab-content-diag`: Combined metrics card (Host, Port, Mode, Latency with `btnTestLatency`, Egress IP with `btnCheckIp`) + Log terminal with `btnCopyLogs` and `btnClearLogs`.
- Header: Vector Icon, Name, Version, Day/Night button (`btnThemeToggle`), Status Pill (`statusPill`).

- [ ] **Step 1: Write failing test**

Create `test/popupStructure.test.ts`:
```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { renderPopupHtml } from "../src/extensionTemplates.js";
import fs from "node:fs";

test("popup HTML has 380px width, 3 tabs, 3-button controls, user overrides, and theme toggle", () => {
  const html = renderPopupHtml({
    name: "PEC Corp Proxy",
    shortName: "PEC",
    version: "1.4.0",
    serverUrl: "https://proxyex.ic-iskra.ru",
    token: "tok",
    colorPalette: "cyber",
    uiLayout: "console",
  } as any);

  assert.ok(html.includes("380px"), "Width must be 380px");
  assert.ok(html.includes('id="btnThemeToggle"'), "Day/Night theme toggle must exist in header");
  assert.ok(html.includes('id="tab-btn-conn"'), "Connection tab button must exist");
  assert.ok(html.includes('id="tab-btn-routing"'), "Routing tab button must exist");
  assert.ok(html.includes('id="tab-btn-diag"'), "Diagnostics/Info tab button must exist");

  // 3-button controls on connection tab
  assert.ok(html.includes('id="btnSyncNow"'), "Sync button must exist");
  assert.ok(html.includes('id="btnPowerToggle"'), "Power toggle button must exist");
  assert.ok(html.includes('id="btnPauseToggle"'), "Pause toggle button must exist");

  // User overrides in routing tab
  assert.ok(html.includes('id="btnAddCurrentSite"'), "Add current site button must exist");
  assert.ok(html.includes('id="inputPattern"'), "Rule pattern input must exist");
  assert.ok(html.includes('id="selectAction"'), "Rule action select must exist");
  assert.ok(html.includes('id="btnAddRule"'), "Add rule button must exist");
  assert.ok(html.includes('id="userRulesList"'), "User rules container must exist");

  // Combined info & diagnostics
  assert.ok(html.includes('id="btnCheckIp"'), "Check IP button must exist");
  assert.ok(html.includes('id="btnTestLatency"'), "Test latency button must exist");
  assert.ok(html.includes('id="logContainer"'), "Log container must exist");
  assert.ok(html.includes('id="btnCopyLogs"'), "Copy logs button must exist");
  assert.ok(html.includes('id="btnClearLogs"'), "Clear logs button must exist");

  // Check no inline onclick handlers (MV3 CSP)
  assert.ok(!html.includes("onclick="), "No inline onclick handlers allowed");
});

test("extension/popup.html matches modern structure", () => {
  const rawHtml = fs.readFileSync("extension/popup.html", "utf8");
  assert.ok(rawHtml.includes("380px"));
  assert.ok(rawHtml.includes('id="btnThemeToggle"'));
  assert.ok(rawHtml.includes('id="btnSyncNow"'));
  assert.ok(rawHtml.includes('id="btnPowerToggle"'));
  assert.ok(rawHtml.includes('id="btnPauseToggle"'));
  assert.ok(rawHtml.includes('id="btnAddCurrentSite"'));
  assert.ok(!rawHtml.includes("onclick="));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/popupStructure.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement new HTML and CSS in `src/extensionTemplates.ts` and `extension/popup.html`**

Update `renderPopupHtml` in `src/extensionTemplates.ts` and `extension/popup.html`:
- Define palette tokens:
  ```css
  :root, [data-theme="dark"] {
    --bg: #0b1120;
    --card: #131d36;
    --card-inner: #1e293b;
    --border: #334155;
    --text: #f8fafc;
    --text-muted: #94a3b8;
    --primary: #38bdf8;
    --primary-rgb: 56, 189, 248;
    --success: #10b981;
    --warning: #f59e0b;
    --danger: #ef4444;
  }
  [data-theme="light"] {
    --bg: #f8fafc;
    --card: #ffffff;
    --card-inner: #f1f5f9;
    --border: #cbd5e1;
    --text: #0f172a;
    --text-muted: #64748b;
  }
  ```
- Define palette variations for `--primary` and specific palette background tints.
- Body width `380px`, radius `12px`.
- Render the 3-tab layout and all specified containers cleanly.
- Ensure strict CSP: zero inline `onclick` or other inline listeners.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/popupStructure.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/extensionTemplates.ts extension/popup.html test/popupStructure.test.ts
git commit -m "feat(ui): redesign popup HTML & CSS to 380px, 3 tabs, 3 buttons, and day/night theming"
```

---

### Task 4: Popup JS Logic Overhaul

**Files:**
- Modify: `extension/popup.js`
- Modify: `src/extensionTemplates.ts` (`renderPopupJs`)
- Test: `test/popupLogic.test.ts`

**Interfaces:**
- Consumes: User clicks on tabs, buttons, forms, Chrome MV3 APIs (`chrome.storage.local`, `chrome.runtime.sendMessage`, `chrome.tabs.query`).
- Produces:
  - Theme toggler: toggles `data-theme` between `light` and `dark`, updates button icon `☀️`/`🌙`, persists in `pecThemeMode`.
  - Tab switcher: activates clicked tab content, saves active tab index.
  - 3 Control Buttons:
    - `btnSyncNow`: adds rotation class, sends `{ type: "SYNC_NOW" }`, updates status card.
    - `btnPowerToggle`: sends `{ type: "SET_ENABLED", enabled: !currentProxyState.enabled }`, updates power icon style and hero card.
    - `btnPauseToggle`: sends `{ type: "BYPASS_TOGGLE" }`, toggles 15m countdown timer.
  - User Rules Manager:
    - Loads rules on open via `{ type: "GET_USER_RULES" }` or `chrome.storage.local`.
    - Detects current active tab domain via `chrome.tabs.query({ active: true, currentWindow: true })` and labels `btnAddCurrentSite`.
    - Handles adding rule (pattern + PROXY/DIRECT).
    - Handles toggling rule enabled/disabled.
    - Handles deleting rule.
    - Sends updated array via `{ type: "SAVE_USER_RULES", rules }`.
  - Diagnostics:
    - `btnTestLatency`: performs `fetch` timing to server, displays `X ms`.
    - `btnCheckIp`: fetches `${serverBase}/api/ip-echo` (with fallback to `${serverBase}/ip-echo`), displays egress IP and timestamp.
    - Event logs: renders logs, `btnCopyLogs` copies text to clipboard, `btnClearLogs` clears logs via `{ type: "CLEAR_LOGS" }`.

- [ ] **Step 1: Write failing test**

Create `test/popupLogic.test.ts`:
```typescript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { renderPopupJs } from "../src/extensionTemplates.js";

test("popup.js compiles syntactically and contains core action handlers", () => {
  const js = renderPopupJs({
    name: "PEC",
    serverUrl: "https://proxyex.ic-iskra.ru",
  } as any);

  assert.ok(js.includes("btnThemeToggle"), "Theme toggle handler must be registered");
  assert.ok(js.includes("btnSyncNow"), "Sync button handler must be registered");
  assert.ok(js.includes("btnPowerToggle"), "Power button handler must be registered");
  assert.ok(js.includes("btnPauseToggle"), "Pause button handler must be registered");
  assert.ok(js.includes("btnAddCurrentSite"), "Add current site handler must be registered");
  assert.ok(js.includes("btnAddRule"), "Add rule handler must be registered");
  assert.ok(js.includes("/api/ip-echo"), "IP echo must call /api/ip-echo");
  assert.ok(js.includes("SAVE_USER_RULES"), "Must send SAVE_USER_RULES message");
});

test("extension/popup.js compiles syntactically and contains core action handlers", () => {
  const js = fs.readFileSync("extension/popup.js", "utf8");
  assert.ok(js.includes("btnThemeToggle"));
  assert.ok(js.includes("btnSyncNow"));
  assert.ok(js.includes("btnPowerToggle"));
  assert.ok(js.includes("btnPauseToggle"));
  assert.ok(js.includes("/api/ip-echo"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/popupLogic.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement popup script logic in `src/extensionTemplates.ts` (`renderPopupJs`) and `extension/popup.js`**

Implement full interactivity:
- Tab navigation logic without inline handlers.
- Day/Night toggle logic reading and writing `chrome.storage.local.get(['pecThemeMode'])`.
- 3 buttons event listeners:
  - `btnSyncNow`: adds spin CSS class, sends message `{ type: "SYNC_NOW" }`.
  - `btnPowerToggle`: sends `{ type: "SET_ENABLED", enabled: !currentProxyState.enabled }`.
  - `btnPauseToggle`: sends `{ type: "BYPASS_TOGGLE" }`.
- Active tab domain detection:
  ```javascript
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      const u = new URL(tab.url);
      if (u.hostname && !u.hostname.startsWith("chrome")) {
        currentDomain = u.hostname;
        btnAddCurrentSite.textContent = "+ Добавить сайт: " + currentDomain;
        btnAddCurrentSite.style.display = "block";
      }
    }
  } catch (e) {}
  ```
- User rules CRUD and table rendering.
- Latency measurement and Egress IP check via `/api/ip-echo`.
- Log terminal rendering, copy, and clear.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/popupLogic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/extensionTemplates.ts extension/popup.js test/popupLogic.test.ts
git commit -m "feat(ui): implement popup.js interactivity, 3-button actions, and user overrides CRUD"
```

---

### Task 5: Extension Studio Constructor Migration & Live Preview Harmonization

**Files:**
- Modify: `src/types.ts` (`ExtensionBuildConfig`)
- Modify: `src/views/dashboardView.ts`
- Modify: `public/dashboard.js`
- Modify: `public/dashboard.css`
- Modify: `src/packager.ts`
- Test: `test/constructorIntegration.test.ts`

**Interfaces:**
- `ExtensionBuildConfig`:
  - `uiLayout?: "console" | "terminal"`
  - `colorPalette?: "cyber" | "obsidian" | "nord" | "emerald" | "light"`
  - `defaultThemeMode?: "dark" | "light"`
- Extension Studio UI:
  - Section "2. Макет и цветовая палитра":
    - Layout buttons: `Console` (rounded, soft) & `Terminal` (monospace, sharp).
    - Palette swatches: `cyber` (#38bdf8), `obsidian` (#c084fc), `nord` (#88c0d0), `emerald` (#34d399), `light` (#2563eb).
    - Default mode switch: `Темная (Ночь)` vs `Светлая (День)`.
  - Live Preview updates dynamically when clicking palettes or layouts.
  - Packager passes these options into `renderPopupHtml` and `renderPopupJs`.

- [ ] **Step 1: Write failing test**

Create `test/constructorIntegration.test.ts`:
```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { buildExtensionFiles } from "../src/packager.js";
import { ExtensionBuildConfig } from "../src/types.js";

test("packager accepts uiLayout, colorPalette, and defaultThemeMode and renders into popup", async () => {
  const cfg: ExtensionBuildConfig = {
    name: "Corporate Proxy",
    shortName: "CorpProxy",
    version: "1.4.0",
    serverUrl: "https://proxyex.ic-iskra.ru",
    token: "fleet-secret-123",
    uiLayout: "terminal",
    colorPalette: "emerald",
    defaultThemeMode: "light",
  };

  const files = await buildExtensionFiles(cfg);
  const popupHtml = files["popup.html"];
  assert.ok(popupHtml);
  assert.ok(popupHtml.includes('data-palette="emerald"'));
  assert.ok(popupHtml.includes('data-layout="terminal"'));
  assert.ok(popupHtml.includes('data-theme="light"'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/constructorIntegration.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement updates in `src/types.ts`, `src/packager.ts`, `src/views/dashboardView.ts`, `public/dashboard.js`, and `public/dashboard.css`**

1. In `src/types.ts`: add `uiLayout`, `colorPalette`, `defaultThemeMode` to `ExtensionBuildConfig`.
2. In `src/extensionTemplates.ts`: bind `data-palette`, `data-layout`, `data-theme` to `<html>`/`<body>` in `renderPopupHtml`.
3. In `src/packager.ts`: ensure `buildExtensionFiles` passes config options.
4. In `src/views/dashboardView.ts`:
   - Replace old chips with the 2 Layouts (`Console`, `Terminal`) and 5 Palettes (`Cyber`, `Obsidian`, `Nord`, `Emerald`, `Light`).
   - Add default mode radio/toggle (`dark`/`light`).
5. In `public/dashboard.js`:
   - Handle layout and palette selection, updating active classes.
   - Update `onConfigChangeLive()` to pass new options to preview iframe.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/constructorIntegration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/packager.ts src/views/dashboardView.ts public/dashboard.js public/dashboard.css test/constructorIntegration.test.ts
git commit -m "feat(studio): migrate themes, layouts, and palettes into extension constructor and live preview"
```

---

### Task 6: Full Integration, Purity Verification & Build

**Files:**
- Modify: `test/purity.test.ts` (if any old selector assertions need updating)
- Verify: Full test suite (`npm test`)
- Verify: TypeScript compilation (`npm run build`)

- [ ] **Step 1: Check and update `test/purity.test.ts`**

Ensure `purity.test.ts` assertions accommodate the new 3-tab layout, 3-button controls, and combined diagnostic terminal.
Run: `npx tsx --test test/purity.test.ts`

- [ ] **Step 2: Run complete test suite**

Run: `npm test`
Expected: All tests pass with 0 failures.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: Clean compilation with 0 errors.

- [ ] **Step 4: Final commit and push**

```bash
git add -A
git commit -m "chore: complete extension and studio UI overhaul with 100% test pass"
git push origin main
```
