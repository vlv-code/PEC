# Fleet Multi-Proxy Management & Client Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralized multi-proxy assignment across the fleet from the dashboard, node-tailored PAC & credential synchronization, and a client-side proxy switcher in the extension popup.

**Architecture:** Extend `ExtensionInstance` with `assignedProxyId` stored in `instances_meta.json`. Update `/api/sync` and `/proxy.pac` to deliver node-specific credentials and PAC directives dynamically. Provide a proxy selection column in the dashboard Fleet table and a reactive proxy dropdown above corporate rules in the extension's Routing tab with bidirectional synchronization.

**Tech Stack:** TypeScript (Node.js, Express), Chrome Extension MV3, Vanilla JS/CSS, HTML5, node:test runner.

**Spec:** `docs/superpowers/specs/2026-10-02-fleet-multi-proxy-management-design.md`

## Global Constraints
- Chrome MV3 Strict CSP: No inline event handlers (`onclick=...`) in popup HTML or extension pages.
- Chrome PAC 7-bit ASCII compliance: PAC scripts must only contain characters with ASCII codes <= 127.
- 1:1 Parity: `extension/` static files and `src/templates/*` must be 100% identical via `npm run sync:templates`.
- Naming: Use "Флот" / "Fleet" everywhere in UI and navigation, with backwards-compatible route IDs.
- Security: All instance IDs must be validated with `assertSafeInstanceId` against prototype-pollution.
- Quality: Zero test regressions across existing 270 tests.

---

### Task 1: Terminology & Data Types Migration ("Устройства" -> "Флот", `assignedProxyId`, `allowUserProxySwitch`)

**Files:**
- Modify: `src/types.ts:74-90, 116-153`
- Modify: `src/views/dashboardView.ts`
- Modify: `public/dashboard.js`
- Test: `test/fleetNamingAndTypes.test.ts`

**Interfaces:**
- Produces: `ExtensionInstance.assignedProxyId?: string`, `ExtensionInstance.appliedProxyName?: string`, `ExtensionBuildConfig.defaultProxyId?: string`, `ExtensionBuildConfig.allowUserProxySwitch?: boolean`.

- [ ] **Step 1: Write failing test in `test/fleetNamingAndTypes.test.ts`**

```typescript
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { renderDashboardHtml } from "../src/views/dashboardView.js";

test("Task 1: dashboard view and i18n use Флот / Fleet terminology", () => {
  const html = renderDashboardHtml();
  assert.ok(html.includes("Флот"), "dashboard HTML must contain 'Флот'");
  assert.ok(html.includes("tab-instances") || html.includes("tab-fleet"), "must contain fleet tab navigation");

  const js = fs.readFileSync(path.resolve("public/dashboard.js"), "utf8");
  assert.ok(js.includes("Флот") || js.includes("Fleet"), "dashboard.js i18n must reference Fleet");
});

test("Task 1: ExtensionInstance and ExtensionBuildConfig support multi-proxy fields", () => {
  const typesSrc = fs.readFileSync(path.resolve("src/types.ts"), "utf8");
  assert.ok(typesSrc.includes("assignedProxyId?: string"), "ExtensionInstance must include assignedProxyId");
  assert.ok(typesSrc.includes("appliedProxyName?: string"), "ExtensionInstance must include appliedProxyName");
  assert.ok(typesSrc.includes("allowUserProxySwitch?: boolean"), "ExtensionBuildConfig must include allowUserProxySwitch");
  assert.ok(typesSrc.includes("defaultProxyId?: string"), "ExtensionBuildConfig must include defaultProxyId");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/fleetNamingAndTypes.test.ts`  
Expected: FAIL (missing fields in `src/types.ts`, and "Устройства" currently present)

- [ ] **Step 3: Update `src/types.ts`, `src/views/dashboardView.ts`, and `public/dashboard.js`**

1. In `src/types.ts`:
```typescript
export interface ExtensionInstance {
  instanceId: string;
  ip: string;
  version: string;
  extensionId?: string;
  userAgent?: string;
  lastSync: string;
  syncCount: number;
  status: "ONLINE" | "STALE" | "OFFLINE";
  activeProxyMode?: string;
  group?: string;
  assignedProfileId?: string;
  appliedProfileName?: string;
  assignedProxyId?: string;
  appliedProxyName?: string;
  tokenHash?: string;
  enrolledAt?: string;
  revoked?: boolean;
}

export interface ExtensionBuildConfig {
  // ...
  defaultProxyId?: string;
  allowUserProxySwitch?: boolean;
  // ...
}
```
2. In `src/views/dashboardView.ts` and `public/dashboard.js`:
- Replace navigation tab label with `💻 Флот`.
- Replace title with `Флот корпоративной сети`.
- Replace subtitle with `Централизованное управление инстансами расширения, профилями и прокси-нодами`.
- Update English i18n dictionary to "Fleet".

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/fleetNamingAndTypes.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/views/dashboardView.ts public/dashboard.js test/fleetNamingAndTypes.test.ts
git commit -m "feat(fleet): migrate naming to Fleet and extend data types with proxy fields"
```

---

### Task 2: Instance Proxy Storage & Centralized Assignment API

**Files:**
- Modify: `src/instances.ts`
- Modify: `src/routes/instancesRoutes.ts`
- Test: `test/fleetProxyAssignment.test.ts`

**Interfaces:**
- Produces: `assignInstanceProxy(instanceId: string, proxyId?: string): void`
- Produces: `POST /api/instances/assign-proxy` endpoint: `{ instanceId: string, proxyId?: string } -> { ok: true, instanceId, assignedProxyId }`

- [ ] **Step 1: Write failing test in `test/fleetProxyAssignment.test.ts`**

```typescript
import { test } from "node:test";
import assert from "node:assert";
import { registerHeartbeat, assignInstanceProxy, getActiveInstances } from "../src/instances.js";
import { createProxy, getAllProxies } from "../src/proxies.js";

test("Task 2: assignInstanceProxy binds proxy to instance and reflects in getActiveInstances", () => {
  const node = createProxy({
    host: "198.51.100.25",
    port: 10808,
    protocol: "socks5",
    name: "Helsinki VLESS Node",
    tag: "fin-vless",
    type: "manual",
  });

  const instId = "test-inst-" + Date.now();
  registerHeartbeat({
    instanceId: instId,
    ip: "127.0.0.1",
    version: "1.0.0",
  });

  assignInstanceProxy(instId, node.id);

  const instances = getActiveInstances();
  const found = instances.find((i) => i.instanceId === instId);
  assert.ok(found, "instance must exist in active instances");
  assert.strictEqual(found.assignedProxyId, node.id);
  assert.strictEqual(found.appliedProxyName, "Helsinki VLESS Node");

  // Unassign proxy (fallback to default)
  assignInstanceProxy(instId, undefined);
  const unassigned = getActiveInstances().find((i) => i.instanceId === instId);
  assert.strictEqual(unassigned?.assignedProxyId, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/fleetProxyAssignment.test.ts`  
Expected: FAIL (`assignInstanceProxy` is not defined)

- [ ] **Step 3: Implement `assignInstanceProxy` and `POST /api/instances/assign-proxy`**

1. In `src/instances.ts`:
- Extend `persistentMeta` interface with `assignedProxyId?: string`.
- Implement and export `assignInstanceProxy(instanceId: string, proxyId?: string)`:
  ```typescript
  export function assignInstanceProxy(instanceId: string, proxyId?: string) {
    const cleanId = assertSafeInstanceId(instanceId);
    if (!persistentMeta[cleanId]) {
      persistentMeta[cleanId] = {};
    }
    persistentMeta[cleanId].assignedProxyId = proxyId ? String(proxyId).trim() : undefined;
    saveInstancesMeta();

    const existing = instancesMap.get(cleanId);
    if (existing) {
      existing.assignedProxyId = persistentMeta[cleanId].assignedProxyId;
      if (existing.assignedProxyId) {
        const node = getProxyById(existing.assignedProxyId);
        existing.appliedProxyName = node ? (node.name || `${node.host}:${node.port}`) : "По умолчанию";
      } else {
        existing.appliedProxyName = "По умолчанию";
      }
    }
  }
  ```
- In `registerHeartbeat`, resolve `assignedProxyId` from `meta` or `existing`, lookup `getProxyById(assignedProxyId)` and populate `appliedProxyName`.
2. In `src/routes/instancesRoutes.ts`:
- Add route `router.post("/api/instances/assign-proxy", ...)`:
  ```typescript
  router.post("/api/instances/assign-proxy", (req: Request, res: Response) => {
    const { instanceId, proxyId } = req.body || {};
    if (!instanceId) {
      return res.status(400).json({ error: "instanceId is required" });
    }
    try {
      assignInstanceProxy(String(instanceId), proxyId ? String(proxyId) : undefined);
      recordAudit({
        ip: getClientIp(req),
        endpoint: "/api/instances/assign-proxy",
        status: 200,
        result: "CONFIG_UPDATED",
        details: `Assigned proxy ${proxyId || "default"} to instance ${instanceId}`,
      });
      res.json({ ok: true, instanceId, assignedProxyId: proxyId || null });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });
  ```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/fleetProxyAssignment.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/instances.ts src/routes/instancesRoutes.ts test/fleetProxyAssignment.test.ts
git commit -m "feat(fleet): implement instance proxy assignment storage and API"
```

---

### Task 3: Dynamic Sync & Tailored PAC Route

**Files:**
- Modify: `src/routes/credsRoutes.ts`
- Test: `test/syncMultiProxy.test.ts`

**Interfaces:**
- Consumes: `assignInstanceProxy`, `getProxyById`, `getAllProxies`, `getActiveProxy`
- Produces: `/api/sync` payload with `availableProxies`, `activeProxyId`, `allowUserProxySwitch`, tailored `creds` and `config`.
- Produces: `/proxy.pac` resolving proxy node by `proxyId` parameter.

- [ ] **Step 1: Write failing test in `test/syncMultiProxy.test.ts`**

```typescript
import { test } from "node:test";
import assert from "node:assert";
import express from "express";
import http from "node:http";
import { createCredsRouter } from "../src/routes/credsRoutes.js";
import { createProxy } from "../src/proxies.js";
import { assignInstanceProxy } from "../src/instances.js";

test("Task 3: /api/sync delivers assigned proxy node config, creds, and availableProxies list", async () => {
  const node = createProxy({
    host: "203.0.113.88",
    port: 10809,
    protocol: "http",
    name: "Stockholm HTTP Node",
    tag: "se-node",
    username: "se_user",
    password: "se_password",
    type: "manual",
  });

  const app = express();
  app.use(createCredsRouter());
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;

  const instId = "inst-sync-" + Date.now();
  assignInstanceProxy(instId, node.id);

  const res = await fetch(`http://127.0.0.1:${port}/api/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Ext-Token": process.env.EXT_AUTH_TOKEN || "test-ext-token",
      "X-Instance-Id": instId,
    },
    body: JSON.stringify({ instanceId: instId, version: "1.0.0" }),
  });

  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.activeProxyId, node.id);
  assert.strictEqual(data.config.host, "203.0.113.88");
  assert.strictEqual(data.config.port, 10809);
  assert.strictEqual(data.creds.user, "se_user");
  assert.strictEqual(data.creds.pass, "se_password");
  assert.ok(Array.isArray(data.availableProxies), "must return availableProxies array");
  assert.ok(data.availableProxies.some((p: any) => p.id === node.id));

  server.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/syncMultiProxy.test.ts`  
Expected: FAIL (`activeProxyId` or `availableProxies` missing)

- [ ] **Step 3: Update `src/routes/credsRoutes.ts`**

1. In `/api/sync`:
- Extract `selectedProxyId` from request body (`req.body.selectedProxyId`).
- If `selectedProxyId` is provided and `instanceId` is set, call `assignInstanceProxy(instanceId, selectedProxyId)`.
- Lookup instance's `assignedProxyId`:
  - If present, `const effectiveNode = getProxyById(assignedProxyId)`.
  - Fallback: `const effectiveNode = getActiveProxy()`.
- Use `effectiveNode` to set:
  - `effectiveCreds`: `{ user: effectiveNode.username || currentCreds.user, pass: effectiveNode.password || currentCreds.pass }`.
  - `effectiveConfig`: `{ protocol: effectiveNode.protocol, host: effectiveNode.host, port: effectiveNode.port, ... }`.
- Fetch `availableProxies = getAllProxies(true).map(p => ({ id: p.id, name: p.name || p.host, tag: p.tag, protocol: p.protocol, host: p.host, port: p.port }))`.
- Include `proxyId=${effectiveNode.id}` into HMAC signed `pacUrl`.
- Return `activeProxyId: effectiveNode.id`, `allowUserProxySwitch: bldCfg.allowUserProxySwitch !== false`, `availableProxies`, `creds: effectiveCreds`, `config: effectiveConfig`.
2. In `/proxy.pac`:
- Read `req.query.proxyId`. If provided, find node via `getProxyById(proxyId)`.
- If found, format PAC proxy return directive: `PROXY host:port`, `SOCKS5 host:port`, or `HTTPS host:port` according to node protocol.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/syncMultiProxy.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/credsRoutes.ts test/syncMultiProxy.test.ts
git commit -m "feat(sync): tailor proxy configuration, creds, and pac per instance node"
```

---

### Task 4: Dashboard Fleet Management UI (Proxy Selection per Instance)

**Files:**
- Modify: `src/views/dashboardView.ts`
- Modify: `public/dashboard.js`
- Test: `test/dashboardFleetUi.test.ts`

**Interfaces:**
- Produces: Fleet table with column "Прокси-сервер" and `<select class="select-instance-proxy" data-instance-id="...">`
- Produces: Interactive change handler calling `POST /api/instances/assign-proxy`

- [ ] **Step 1: Write failing test in `test/dashboardFleetUi.test.ts`**

```typescript
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { renderDashboardHtml } from "../src/views/dashboardView.js";

test("Task 4: Fleet table includes Proxy Server column and dashboard.js handles assignment", () => {
  const html = renderDashboardHtml();
  assert.ok(html.includes("Прокси-сервер") || html.includes("Прокси-нода"), "table header must include Proxy column");

  const js = fs.readFileSync(path.resolve("public/dashboard.js"), "utf8");
  assert.ok(js.includes("/api/instances/assign-proxy"), "dashboard.js must post to /api/instances/assign-proxy");
  assert.ok(js.includes("select-instance-proxy"), "dashboard.js must bind select-instance-proxy");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/dashboardFleetUi.test.ts`  
Expected: FAIL

- [ ] **Step 3: Update `src/views/dashboardView.ts` and `public/dashboard.js`**

1. In `src/views/dashboardView.ts`:
- In the Fleet instances table (`#instancesTable`), add `<th>` for "Прокси-сервер".
2. In `public/dashboard.js`:
- In `renderInstancesTable(instances)`:
  - Render a `<select class="form-select form-select-sm select-instance-proxy" data-instance-id="${escapeHtml(inst.instanceId)}">`.
  - Populate with `<option value="">По умолчанию (${defaultProxyName})</option>` and all nodes from `cachedProxies`.
  - Set `value = inst.assignedProxyId || ""`.
- Add event delegation on `.select-instance-proxy`:
  - When changed, extract `instanceId` and `proxyId = this.value`.
  - Send `POST /api/instances/assign-proxy` with JSON `{ instanceId, proxyId }`.
  - Show success toast ("Прокси для инстанса обновлен").
  - Refresh instances list via `loadInstances()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/dashboardFleetUi.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/views/dashboardView.ts public/dashboard.js test/dashboardFleetUi.test.ts
git commit -m "feat(dashboard): add interactive proxy node assignment in fleet table"
```

---

### Task 5: Extension Studio Default Proxy & Permission Toggle

**Files:**
- Modify: `src/views/dashboardView.ts`
- Modify: `public/dashboard.js`
- Modify: `src/packager.ts`
- Test: `test/studioProxySelection.test.ts`

**Interfaces:**
- Produces: `#builderDefaultProxyId` select in Extension Studio.
- Produces: `#builderAllowUserProxySwitch` toggle in Extension Studio.
- Produces: `generateExtensionFiles` with `defaultProxyId` and `allowUserProxySwitch` populated.

- [ ] **Step 1: Write failing test in `test/studioProxySelection.test.ts`**

```typescript
import { test } from "node:test";
import assert from "node:assert";
import { generateExtensionFiles } from "../src/packager.js";

test("Task 5: Extension Studio embeds defaultProxyId and allowUserProxySwitch", () => {
  const files = generateExtensionFiles({
    name: "Test Ext",
    shortName: "TE",
    version: "1.0.0",
    defaultProxyId: "node-fin-01",
    allowUserProxySwitch: true,
  });

  assert.ok(files["background.js"], "must generate background.js");
  // Background or config embeds defaultProxyId / allowUserProxySwitch
  assert.ok(files["background.js"].includes("node-fin-01") || files["manifest.json"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/studioProxySelection.test.ts`  
Expected: FAIL

- [ ] **Step 3: Update `src/views/dashboardView.ts`, `public/dashboard.js`, and `src/packager.ts`**

1. In `src/views/dashboardView.ts`:
- In Extension Studio, add select `#builderDefaultProxyId` ("Прокси по умолчанию для сборки").
- Add checkbox `#builderAllowUserProxySwitch` ("Разрешить пользователю переключать прокси в расширении").
2. In `public/dashboard.js`:
- Populate `#builderDefaultProxyId` from `cachedProxies`.
- Include `defaultProxyId` and `allowUserProxySwitch` in `getBuilderConfigPayload()`.
- Populate inputs in `loadBuilderConfig()`.
3. In `src/packager.ts`:
- In `renderBackgroundJs`, inject default proxy ID and user switch permission into background placeholder variables.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/studioProxySelection.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/views/dashboardView.ts public/dashboard.js src/packager.ts test/studioProxySelection.test.ts
git commit -m "feat(studio): add default proxy selector and allowUserProxySwitch toggle"
```

---

### Task 6: Extension Popup Proxy Switcher & Background Sync

**Files:**
- Modify: `src/templates/popupHtmlTemplate.ts`
- Modify: `src/templates/popupJsTemplate.ts`
- Modify: `src/templates/backgroundTemplate.ts`
- Modify: `extension/popup.html`
- Modify: `extension/popup.js`
- Modify: `extension/background.js`
- Test: `test/popupProxySwitcher.test.ts`

**Interfaces:**
- Produces: `#cardProxySelector` and `<select id="selectActiveProxy">` in Routing tab.
- Produces: Background listener for `SET_ACTIVE_PROXY` action.
- Produces: Bidirectional sync sending `selectedProxyId` to `/api/sync`.

- [ ] **Step 1: Write failing test in `test/popupProxySwitcher.test.ts`**

```typescript
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { renderPopupHtml } from "../src/templates/popupHtmlTemplate.js";

test("Task 6: popup.html contains proxy selector card on routing tab", () => {
  const html = renderPopupHtml();
  assert.ok(html.includes("selectActiveProxy"), "popup HTML must include #selectActiveProxy select");
  assert.ok(html.includes("cardProxySelector"), "popup HTML must include #cardProxySelector container");
});

test("Task 6: popup.js and background.js handle SET_ACTIVE_PROXY action", () => {
  const popupJs = fs.readFileSync(path.resolve("extension/popup.js"), "utf8");
  assert.ok(popupJs.includes("selectActiveProxy"), "popup.js must bind selectActiveProxy");
  assert.ok(popupJs.includes("SET_ACTIVE_PROXY"), "popup.js must send SET_ACTIVE_PROXY");

  const bgJs = fs.readFileSync(path.resolve("extension/background.js"), "utf8");
  assert.ok(bgJs.includes("SET_ACTIVE_PROXY"), "background.js must handle SET_ACTIVE_PROXY");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/popupProxySwitcher.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement popup UI, popup controller, and background handling**

1. In `src/templates/popupHtmlTemplate.ts`:
- On `#tab-routing`, immediately above `#cardCorporateRules`, add:
```html
<div class="card" id="cardProxySelector" style="margin-bottom: 12px;">
  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
    <span style="font-weight: 600; font-size: 12px; color: var(--text);">🌐 Прокси-сервер</span>
    <span id="activeProxyProtocolBadge" class="badge badge-action-proxy" style="font-size: 10px;">HTTP</span>
  </div>
  <select id="selectActiveProxy" class="form-select" style="width: 100%; margin-bottom: 0;">
    <option value="">Загрузка доступных прокси...</option>
  </select>
</div>
```
2. In `src/templates/popupJsTemplate.ts` and `extension/popup.js`:
- In `applyPopupState(state)`:
  - If `state.allowUserProxySwitch === false`, hide `#cardProxySelector` (`display = 'none'`).
  - Otherwise, render `display = 'block'`.
  - Populate `#selectActiveProxy` with `state.availableProxies`.
  - Set `selectActiveProxy.value = state.activeProxyId || ""`.
  - Update `#activeProxyProtocolBadge` to current protocol.
- On change on `#selectActiveProxy`:
  - Send message `{ action: "SET_ACTIVE_PROXY", proxyId: this.value }` to background.
  - Trigger optimistic status update.
3. In `src/templates/backgroundTemplate.ts` and `extension/background.js`:
- Add handler for `SET_ACTIVE_PROXY`:
  - Sets `currentProxyState.activeProxyId = msg.proxyId`.
  - Saves to `chrome.storage.local.set({ pecActiveProxyId: msg.proxyId })`.
  - Calls `syncWithServer(true)` with `selectedProxyId: msg.proxyId`.
  - Responds with updated state.
- In `syncWithServer(forceRefresh)`:
  - Include `selectedProxyId: currentProxyState.activeProxyId` in body of `/api/sync`.
  - Read `availableProxies`, `activeProxyId`, `allowUserProxySwitch` from server response.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/popupProxySwitcher.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/templates/popupHtmlTemplate.ts src/templates/popupJsTemplate.ts src/templates/backgroundTemplate.ts extension/popup.html extension/popup.js extension/background.js test/popupProxySwitcher.test.ts
git commit -m "feat(extension): implement client proxy switcher dropdown and bidirectional sync"
```

---

### Task 7: Full Integration, Static Parity & Build Verification

**Files:**
- Run: `npm run sync:templates`
- Run: `npx tsx --test test/purity.test.ts`
- Run: `npm run lint`
- Run: `npm test`
- Run: `npm run build`

- [ ] **Step 1: Synchronize templates**

Run: `npm run sync:templates`  
Expected: Output `[sync:templates] Successfully synchronized extension templates to extension/*`

- [ ] **Step 2: Run purity tests**

Run: `npx tsx --test test/purity.test.ts`  
Expected: 23+ tests passing, 0 failures, 1:1 parity intact.

- [ ] **Step 3: Run TypeScript linter**

Run: `npm run lint`  
Expected: 0 errors.

- [ ] **Step 4: Run full test suite**

Run: `npm test`  
Expected: All 275+ tests pass with 0 failures.

- [ ] **Step 5: Run production build**

Run: `npm run build`  
Expected: Exit code 0, `dist/server.cjs` created.

- [ ] **Step 6: Commit and Push**

```bash
git add .
git commit -m "chore(release): complete fleet multi-proxy management & client switcher overhaul"
git push origin main
```
