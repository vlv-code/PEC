# Design Spec: Fleet Multi-Proxy Management & Client Proxy Switcher

**Date:** 2026-10-02  
**Status:** Approved  
**Topic:** Fleet Multi-Proxy Assignment, Dynamic PAC Routing & Client Proxy Switcher  

---

## 1. Overview & Objectives

In enterprise deployments, different browser instances within the corporate fleet often require different egress proxies (e.g. geographically separated nodes, dedicated IP pools, or specialized protocol endpoints).

This design introduces:
1. **Fleet Terminology Alignment**: Rename "Устройства / Devices" back to **"Флот / Fleet"** across all navigation, views, headers, and localized strings.
2. **Centralized Instance-to-Proxy Binding**: Admin can assign a specific proxy node from the proxy registry (`proxies.json`) to any individual instance in the Fleet table, falling back to the server's default active proxy if unassigned.
3. **Multi-Proxy Support in Extension Studio**: During extension package generation, admin can pick a default proxy node and toggle whether end-users have permission to switch proxies (`allowUserProxySwitch`).
4. **Dynamic PAC & Credential Customization**: `/api/sync` and `/proxy.pac` serve tailored proxy host, port, protocol, and node credentials per instance.
5. **Client Popup Proxy Switcher**: On the "Роутинг" tab above corporate rules, show a proxy server dropdown list populated from available nodes. Switching updates the extension instantly and syncs the selection back to the dashboard Fleet table.

---

## 2. Terminology & UI Navigation

All visible user-facing strings and identifiers:
- Navigation Tab: `💻 Флот` (DOM id: `tab-instances`, aliased to `tab-fleet`)
- Page Title: `Флот корпоративной сети` / `Corporate Network Fleet`
- Subtitle: `Централизованное управление инстансами расширения, профилями и прокси-нодами`
- Table Header: `Зарегистрированные инстансы флота` / `Registered Fleet Instances`
- i18n dictionaries: update Russian and English keys accordingly.

---

## 3. Data Model & Storage

### 3.1 Type Definitions (`src/types.ts`)
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
  assignedProxyId?: string;     // <-- New: ID of assigned ProxyNode from proxies registry
  appliedProxyName?: string;    // <-- New: Friendly name of effective proxy
  tokenHash?: string;
  enrolledAt?: string;
  revoked?: boolean;
}

export interface ExtensionBuildConfig {
  // ... existing fields ...
  defaultProxyId?: string;        // <-- Selected default proxy node from registry
  allowUserProxySwitch?: boolean; // <-- If false, hide/lock switcher in popup (default: true)
}
```

### 3.2 Persistent Metadata (`src/instances.ts`)
`persistentMeta` on disk (`instances_meta.json`) stores:
```typescript
interface InstanceMetaEntry {
  group?: string;
  assignedProfileId?: string;
  assignedProxyId?: string; // <-- New
  tokenHash?: string;
  enrolledAt?: string;
  revoked?: boolean;
}
```
- `assignInstanceProxy(instanceId: string, proxyId?: string)`: Sets or clears `assignedProxyId` for `instanceId` and saves atomically.
- `registerHeartbeat`: Accepts optional `selectedProxyId?: string`. If provided and permitted, updates `persistentMeta[instanceId].assignedProxyId`.
- Resolves `appliedProxyName`: If `assignedProxyId` exists and corresponds to a node in `proxies.json`, uses `node.name || node.host:node.port`; otherwise `"По умолчанию"` (Default).

---

## 4. Backend APIs & Synchronization Protocol

### 4.1 Fleet Proxy Assignment API (`src/routes/instancesRoutes.ts`)
- **`POST /api/instances/assign-proxy`**
  - Body: `{ instanceId: string, proxyId?: string }`
  - Validates `instanceId`. If `proxyId` provided, validates that the node exists in `proxies.json` (or clears if empty).
  - Calls `assignInstanceProxy(instanceId, proxyId)`.
  - Records audit log.
  - Returns: `{ ok: true, instanceId, assignedProxyId: proxyId || null }`.

### 4.2 Dynamic Synchronization (`POST /api/sync` in `src/routes/credsRoutes.ts`)
- Request Body adds: `{ selectedProxyId?: string }`.
- Processing:
  1. If `selectedProxyId` is passed, check if `bldCfg.allowUserProxySwitch !== false`. If allowed, persist via `assignInstanceProxy(instanceId, selectedProxyId)`.
  2. Resolve effective `ProxyNode`:
     - If `assignedProxyId` is set, look up via `getProxyById(assignedProxyId)`.
     - Fallback: `getActiveProxy()` from `src/proxies.ts`.
     - Final fallback: `getProxyConfig()` default values.
  3. Resolve credentials for effective node:
     - If node has `username` and `password`, use them.
     - Else fallback to `readCurrentCredsAsync()`.
  4. Generate HMAC-signed PAC URL:
     - Incorporates `proxyId` query param: `pacUrl = .../proxy.pac?profileId=...&proxyId=...&exp=...&sig=...`.
  5. Assemble response payload:
     ```json
     {
       "ok": true,
       "profileId": "...",
       "profileName": "...",
       "activeProxyId": "node-123",
       "allowUserProxySwitch": true,
       "availableProxies": [
         { "id": "node-1", "name": "Finland VLESS", "protocol": "socks5", "host": "1.2.3.4", "port": 10808 },
         { "id": "node-2", "name": "Germany HTTP", "protocol": "http", "host": "5.6.7.8", "port": 10809 }
       ],
       "creds": { "user": "node_user", "pass": "node_pass" },
       "config": {
         "protocol": "socks5",
         "host": "1.2.3.4",
         "port": 10808,
         "pacUrl": "..."
       }
     }
     ```

### 4.3 Tailored PAC Generation (`GET /proxy.pac` in `src/routes/credsRoutes.ts`)
- Reads optional `proxyId` from query string (verified by signature or profile resolution).
- If `proxyId` matches a valid `ProxyNode`, formats the return directive:
  - `SOCKS5 <host>:<port>` for socks5.
  - `HTTPS <host>:<port>` for https.
  - `PROXY <host>:<port>` for http.
- Falls back to server default proxy if unspecified.

---

## 5. Dashboard Fleet UI (`public/dashboard.js` & `src/views/dashboardView.ts`)

1. **Navigation & Labels**:
   - Change label to "💻 Флот".
   - Subtitle: "Управление инстансами и распределение прокси".
2. **Fleet Table Extension**:
   - Column `Прокси-нода` between `Профиль` and `Статус`.
   - Each row renders a `<select class="form-select form-select-sm select-instance-proxy" data-instance-id="...">`:
     - Option `<option value="">По умолчанию (${defaultProxyName})</option>`.
     - Options `<option value="${p.id}">${p.name} (${p.protocol.toUpperCase()} ${p.host}:${p.port})</option>`.
     - Pre-selects `inst.assignedProxyId || ""`.
   - On change: triggers `POST /api/instances/assign-proxy`, shows success toast, and updates instance row in real-time.

---

## 6. Extension Popup UI & Controller

### 6.1 Layout (`src/templates/popupHtmlTemplate.ts`)
- In `#tab-routing`: Above `#cardCorporateRules`, render:
  ```html
  <div class="card" id="cardProxySelector" style="margin-bottom: 12px;">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
      <span style="font-weight: 600; font-size: 12px; color: var(--text);">🌐 Прокси-сервер</span>
      <span id="activeProxyProtocolBadge" class="badge badge-action-proxy" style="font-size: 10px;">HTTP</span>
    </div>
    <select id="selectActiveProxy" class="form-select" style="width: 100%; margin-bottom: 0;">
      <!-- Populated dynamically -->
    </select>
  </div>
  ```

### 6.2 Controller Logic (`src/templates/popupJsTemplate.ts` & `extension/popup.js`)
- In `applyPopupState(state)`:
  - If `state.allowUserProxySwitch === false`, hide `#cardProxySelector`.
  - Populate `#selectActiveProxy` with `state.availableProxies`.
  - Set selected option to `state.activeProxyId`.
  - Update `#activeProxyProtocolBadge` to match selected node's protocol.
- On change on `#selectActiveProxy`:
  - Read selected `proxyId`.
  - Send message `{ action: "SET_ACTIVE_PROXY", proxyId }` to `background.js`.
  - Update UI optimistically and trigger immediate server sync.

### 6.3 Background Synchronization (`src/templates/backgroundTemplate.ts` & `extension/background.js`)
- Store `currentProxyState.activeProxyId` and `currentProxyState.availableProxies`.
- In `syncWithServer(forceRefresh)`:
  - Include `selectedProxyId: currentProxyState.activeProxyId` in POST body.
  - On response, update `currentProxyState.activeProxyId`, `currentProxyState.availableProxies`, `currentProxyState.allowUserProxySwitch`.
  - Apply new proxy credentials and network configuration seamlessly.

---

## 7. Extension Studio Constructor

- In `src/views/dashboardView.ts` (Interface & Archetypes / Routing sections):
  - Add select: `Прокси по умолчанию для сборки` (`#builderDefaultProxyId`).
  - Add toggle: `Разрешить пользователям расширения переключать прокси` (`#builderAllowUserProxySwitch`).
- In `public/dashboard.js`:
  - Populate `#builderDefaultProxyId` from `/api/proxies`.
  - Save to builder config payload.
- In `src/packager.ts`:
  - Embed `defaultProxyId` and `allowUserProxySwitch` into packaged build output.

---

## 8. Verification & Quality Gates

1. **Unit & API Tests**:
   - `test/fleetMultiProxy.test.ts`: Test `assignInstanceProxy`, `POST /api/instances/assign-proxy`, `/api/sync` proxy delivery and credentials resolution.
   - Test PAC URL generation with node-specific proxy.
2. **DOM & Template Tests**:
   - Assert Fleet table renders proxy selector.
   - Assert Extension popup renders `#cardProxySelector` and handles `allowUserProxySwitch: false`.
3. **Purity & Parity**:
   - `npx tsx --test test/purity.test.ts` passes (1:1 parity between `extension/` and templates, 0 inline event handlers, 7-bit ASCII PAC).
   - `npm test` all tests pass.
   - `npm run build` succeeds cleanly.
