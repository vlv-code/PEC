# Proxy Settings Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a unified Proxy Settings Hub with data persistence across container rebuilds, multi-proxy registry table (manual & 3x-ui), inbound sync by tag, and active proxy PAC routing.

**Architecture:** Centralized `DATA_DIR` persistence layer, a new `proxies.ts` manager for multi-proxy nodes (`manual` and `3x-ui`), refactored 3x-ui inbound resolution matching on `tag` (extracting port, protocol, and auth accounts), PAC generation pointing to the active proxy node, and an interactive UI table in the renamed "Proxy Settings" dashboard tab.

**Tech Stack:** TypeScript, Node.js (Express), Docker/Docker Compose, Jest/Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-25-proxy-settings-hub-design.md`

## Global Constraints

- DATA_DIR defaults to `./data` in development and `/app/data` in production container.
- All JSON writes must be atomic via `writeJsonAtomic` / temp file swap.
- Never expose plaintext passwords over `GET /api/proxies` (mask with `********`).
- 3x-ui inbounds must be matched by `inbound.tag === targetTag`.
- Never commit private company domains or credentials to git.

---

### Task 1: Centralized Storage & Persistence (`src/storage.ts` & Docker)

**Files:**
- Create: `src/storage.ts`
- Modify: `Dockerfile`
- Test: `test/storage.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export function getDataDir(): string;
  export function getProxiesStorePath(): string;
  export function getCredsStorePath(): string;
  export function getProxyConfigPath(): string;
  export function getRoutingProfilesPath(): string;
  export function getInstancesMetaPath(): string;
  export function getRotationConfigPath(): string;
  export function getRotationHistoryPath(): string;
  export function getDashboardAuthPath(): string;
  export function getBuilderConfigPath(): string;
  ```

- [ ] **Step 1: Write the failing test**
Create `test/storage.test.ts`:
```typescript
import fs from "node:fs";
import path from "node:path";
import {
  getDataDir,
  getProxiesStorePath,
  getCredsStorePath,
  getRotationConfigPath,
} from "../src/storage.js";

describe("Storage module", () => {
  it("resolves data directory and creates it if missing", () => {
    const dir = getDataDir();
    expect(typeof dir).toBe("string");
    expect(fs.existsSync(dir)).toBe(true);
  });

  it("points json stores inside data directory", () => {
    const dir = getDataDir();
    expect(getProxiesStorePath()).toBe(path.join(dir, "proxies.json"));
    expect(getCredsStorePath()).toBe(path.join(dir, "current_creds.json"));
    expect(getRotationConfigPath()).toBe(path.join(dir, "rotation_config.json"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test test/storage.test.ts`
Expected: FAIL ("Cannot find module '../src/storage.js'")

- [ ] **Step 3: Implement `src/storage.ts` and update `Dockerfile`**
Create `src/storage.ts`:
```typescript
import path from "node:path";
import fs from "node:fs";

export function getDataDir(): string {
  const dir = path.resolve(process.env.DATA_DIR || "./data");
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
  }
  return dir;
}

export function getProxiesStorePath(): string {
  return path.resolve(process.env.PROXIES_STORE_PATH || path.join(getDataDir(), "proxies.json"));
}

export function getCredsStorePath(): string {
  return path.resolve(process.env.CREDS_STORE || path.join(getDataDir(), "current_creds.json"));
}

export function getProxyConfigPath(): string {
  return path.resolve(process.env.PROXY_CONFIG_PATH || path.join(getDataDir(), "proxy_config.json"));
}

export function getRoutingProfilesPath(): string {
  return path.resolve(process.env.ROUTING_PROFILES_PATH || path.join(getDataDir(), "routing_profiles.json"));
}

export function getInstancesMetaPath(): string {
  return path.resolve(process.env.INSTANCES_META_PATH || path.join(getDataDir(), "instances_meta.json"));
}

export function getRotationConfigPath(): string {
  return path.resolve(process.env.ROTATION_CONFIG_PATH || path.join(getDataDir(), "rotation_config.json"));
}

export function getRotationHistoryPath(): string {
  return path.resolve(process.env.ROTATION_HISTORY_PATH || path.join(getDataDir(), "rotation_history.json"));
}

export function getDashboardAuthPath(): string {
  return path.resolve(process.env.DASHBOARD_AUTH_PATH || path.join(getDataDir(), "dashboard_auth.json"));
}

export function getBuilderConfigPath(): string {
  return path.resolve(process.env.BUILDER_CONFIG || path.join(getDataDir(), "extension_build_config.json"));
}
```

In `Dockerfile`:
Add `ENV DATA_DIR=/app/data` and `VOLUME ["/app/data"]`.

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test test/storage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/storage.ts test/storage.test.ts Dockerfile
git commit -m "feat: add centralized storage module with guaranteed persistence"
```

---

### Task 2: Multi-Proxy Repository & Model (`src/types.ts` & `src/proxies.ts`)

**Files:**
- Modify: `src/types.ts`
- Create: `src/proxies.ts`
- Test: `test/proxies.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface ProxyNode {
    id: string;
    tag: string;
    name: string;
    type: "3x-ui" | "manual";
    protocol: "socks5" | "http" | "https";
    host: string;
    port: number;
    username?: string;
    password?: string;
    isActive: boolean;
    lastSync?: string;
    status?: "OK" | "ERROR" | "IDLE";
    errorMessage?: string;
    createdAt: string;
    updatedAt: string;
  }

  export function getAllProxies(): ProxyNode[];
  export function getProxyById(id: string): ProxyNode | undefined;
  export function getActiveProxy(): ProxyNode | undefined;
  export function createProxy(data: Partial<ProxyNode>): ProxyNode;
  export function updateProxy(id: string, updates: Partial<ProxyNode>): ProxyNode;
  export function deleteProxy(id: string): boolean;
  export function setActiveProxy(id: string): ProxyNode;
  ```

- [ ] **Step 1: Write the failing test**
Create `test/proxies.test.ts`:
```typescript
import {
  getAllProxies,
  createProxy,
  updateProxy,
  deleteProxy,
  setActiveProxy,
  getActiveProxy,
} from "../src/proxies.js";

describe("Proxy Repository", () => {
  it("creates, updates, activates, and deletes a proxy node", () => {
    const node = createProxy({
      tag: "test-socks",
      name: "Test Socks",
      type: "manual",
      protocol: "socks5",
      host: "10.0.0.1",
      port: 10808,
      username: "user1",
      password: "pass1",
    });

    expect(node.id).toBeDefined();
    expect(node.tag).toBe("test-socks");

    setActiveProxy(node.id);
    expect(getActiveProxy()?.id).toBe(node.id);

    const updated = updateProxy(node.id, { name: "Updated Name" });
    expect(updated.name).toBe("Updated Name");

    const removed = deleteProxy(node.id);
    expect(removed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test test/proxies.test.ts`
Expected: FAIL ("Cannot find module '../src/proxies.js'")

- [ ] **Step 3: Implement `src/proxies.ts` & update `src/types.ts`**
Add `ProxyNode` interface to `src/types.ts`.
Create `src/proxies.ts` with atomic JSON persistence to `getProxiesStorePath()`.
When a proxy is created or set active:
- Set `isActive = true` on the target proxy and `isActive = false` on all other proxies.
- Update `updateProxyConfig({ protocol: node.protocol, host: node.host, port: node.port })`.
- If credentials exist, call `atomicWriteCreds` to keep `/creds` in sync.

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test test/proxies.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/types.ts src/proxies.ts test/proxies.test.ts
git commit -m "feat: add multi-proxy repository and data model"
```

---

### Task 3: 3x-ui Inbound Sync by `tag` (`src/rotate.ts`)

**Files:**
- Modify: `src/rotate.ts`
- Modify: `src/scheduler.ts`
- Test: `test/rotation.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export async function sync3xuiInboundByTag(params: {
    panelUrl: string;
    adminUser: string;
    adminPass: string;
    tag: string;
    rotatePassword?: boolean;
    timeoutSec?: number;
  }): Promise<{
    ok: boolean;
    inboundId?: number;
    tag?: string;
    protocol?: "socks5" | "http" | "https";
    port?: number;
    username?: string;
    password?: string;
    message: string;
  }>;
  ```

- [ ] **Step 1: Write the failing test**
Update `test/rotation.test.ts` to test searching inbounds by `tag` (extracting protocol, port, accounts).

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test test/rotation.test.ts`
Expected: FAIL ("sync3xuiInboundByTag is not a function")

- [ ] **Step 3: Implement `sync3xuiInboundByTag` in `src/rotate.ts`**
- Connects to 3x-ui panel via `panelLogin`.
- Fetches `/panel/api/inbounds/list`.
- Searches `inbounds.find((i) => i.tag === params.tag)`.
- If found:
  - Protocol parsed: `i.protocol === "socks"` -> `"socks5"`, `i.protocol === "http"` -> `"http"`. If TLS streamSettings -> `"https"`.
  - Port: `i.port`.
  - Parses `settings` (JSON): reads `accounts[0].user` and `accounts[0].pass`.
  - If `rotatePassword === true`: generates new random password, sets `accounts[0].pass`, calls `/panel/api/inbounds/update/:id`.
- Returns extracted connection and auth data.

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test test/rotation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/rotate.ts src/scheduler.ts test/rotation.test.ts
git commit -m "feat: implement 3x-ui inbound resolution and rotation by tag"
```

---

### Task 4: REST API for Proxies Management (`src/routes/proxiesRoutes.ts` & `src/server.ts`)

**Files:**
- Create: `src/routes/proxiesRoutes.ts`
- Modify: `src/server.ts`
- Test: `test/proxiesRoutes.test.ts`

**Interfaces:**
- Produces Express router with endpoints:
  - `GET /api/proxies`: List of proxy nodes (masked passwords).
  - `POST /api/proxies`: Add manual or 3x-ui proxy.
  - `PUT /api/proxies/:id`: Edit proxy details.
  - `DELETE /api/proxies/:id`: Delete proxy.
  - `POST /api/proxies/:id/activate`: Set as active proxy.
  - `POST /api/proxies/:id/sync`: Query/rotate 3x-ui inbound.
  - `POST /api/3xui/inbound-lookup`: Query 3x-ui for details of an inbound by `tag`.

- [ ] **Step 1: Write the failing test**
Create `test/proxiesRoutes.test.ts`:
```typescript
import request from "supertest";
import express from "express";
import { createProxiesRouter } from "../src/routes/proxiesRoutes.js";

const app = express();
app.use(express.json());
app.use(createProxiesRouter());

describe("Proxies API Routes", () => {
  it("GET /api/proxies returns list", async () => {
    const res = await request(app).get("/api/proxies");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test test/proxiesRoutes.test.ts`
Expected: FAIL ("Cannot find module '../src/routes/proxiesRoutes.js'")

- [ ] **Step 3: Implement `src/routes/proxiesRoutes.ts` and mount in `src/server.ts`**
- Mount router at `/api/proxies` in `src/server.ts`.
- Include audit logging for all changes via `recordAudit`.

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test test/proxiesRoutes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/routes/proxiesRoutes.ts src/server.ts test/proxiesRoutes.test.ts
git commit -m "feat: add proxies API routes for CRUD and activation"
```

---

### Task 5: UI Implementation - "Proxy Settings" Tab & Multi-Proxy Table

**Files:**
- Modify: `src/views/dashboardView.ts`
- Modify: `public/dashboard.js`
- Test: Manual browser check & DOM element presence tests

**Interfaces:**
- UI Elements:
  - Tab button renamed: `Настройки прокси / Proxy Settings` (`#tabBtnRotation` -> `#tabBtnProxySettings`).
  - Container `#tab-proxy-settings`:
    - 3x-ui Panel Configuration Card.
    - Proxies Table Card:
      - Buttons: `+ Добавить по тегу из 3x-ui`, `+ Добавить вручную`.
      - Table `#proxiesTable`: headers `Активен`, `Тег / Имя`, `Тип`, `Протокол`, `Хост : Порт`, `Логин`, `Статус`, `Действия`.
      - Modals: `#modalAdd3xuiProxy`, `#modalManualProxy`.
    - Live Active PAC Directive banner.

- [ ] **Step 1: Update `src/views/dashboardView.ts`**
- Update navigation tab label and container id to `#tab-proxy-settings`.
- Render 3x-ui connection card and Proxy Registry table with action buttons.
- Add modals for "Add from 3x-ui" and "Add / Edit Manual Proxy".

- [ ] **Step 2: Update `public/dashboard.js`**
- Add localization strings in `I18N.ru` and `I18N.en`.
- Implement `fetchProxies()`, `renderProxiesTable(list)`, `openAdd3xuiModal()`, `openManualProxyModal()`, `saveManualProxy()`, `sync3xuiProxy(id)`, `activateProxy(id)`, `deleteProxy(id)`.
- Hook `fetchProxies()` into `refreshAll()`.

- [ ] **Step 3: Build & Lint check**
Run: `npm run lint` and `npm run build`
Expected: 0 errors.

- [ ] **Step 4: Commit**
```bash
git add src/views/dashboardView.ts public/dashboard.js
git commit -m "feat: redesign proxy settings tab with multi-proxy management table"
```

---

### Task 6: PAC Script & Fleet Credential Sync Verification

**Files:**
- Modify: `src/routing.ts`
- Modify: `src/instances.ts`
- Test: `test/pac.test.ts`

- [ ] **Step 1: Write test for active proxy PAC generation**
Verify that changing active proxy changes `generatePacScript` output.

- [ ] **Step 2: Run test to verify it passes**
Run: `npm test test/pac.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**
```bash
git add src/routing.ts src/instances.ts test/pac.test.ts
git commit -m "feat: ensure PAC generator and fleet sync reflect active proxy node"
```

---

### Task 7: Full System Verification & Git Push

- [ ] **Step 1: Run complete test suite**
Run: `npm test`
Expected: All tests pass.

- [ ] **Step 2: Run build**
Run: `npm run build`
Expected: Clean build with updated `dist/server.cjs`.

- [ ] **Step 3: Push changes to GitHub main**
Run: `git push origin main`
Expected: Successfully pushed to `origin/main`.
