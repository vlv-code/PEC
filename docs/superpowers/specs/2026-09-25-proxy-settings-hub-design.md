# Design Spec: Proxy Settings Hub, Tag-Based 3x-ui Sync & Multi-Proxy Management

- Date: 2026-09-25
- Status: Approved
- Scope: Backend Storage & Persistence, 3x-ui Tag-Based Integration, Multi-Proxy Node Registry, UI Redesign ("Proxy Settings" Tab).

---

## 1. Objectives & Requirements

1. **Volume & State Persistence**:
   - Prevent any loss of 3x-ui credentials, proxy nodes, profiles, or metadata during Docker container reboots and image rebuilds.
   - Centralize storage in `DATA_DIR` (`./data/` locally, `/app/data/` in container).
   - Ensure `Dockerfile` declares `VOLUME ["/app/data"]` and defaults `DATA_DIR=/app/data`.
2. **Proxy Settings Tab (renamed from "3x-ui API & Scheduler")**:
   - Rename navigation tab and pane to "Proxy Settings" / "Настройки прокси".
   - Houses both:
     - 3x-ui Panel connection settings (Panel URL, admin username, admin password, rotation interval).
     - Multi-Proxy Registry table with manual entry and 3x-ui tag-based sync.
3. **Inbound Identification by `tag` in 3x-ui**:
   - Query `/panel/api/inbounds/list` and match by `inbound.tag === targetTag`.
   - Extract port (`inbound.port`), protocol (`socks` -> `socks5`, `http` -> `http`, tls -> `https`), and credentials (`settings.accounts[0].user`, `settings.accounts[0].pass`).
   - Host defaults to the hostname from `panelUrl`, editable by user.
4. **Manual Proxy Entry**:
   - Allow adding proxies without 3x-ui (Tag/Name, Protocol, Host, Port, optional Username, optional Password).
   - Functions statically without automatic rotation.
5. **Multi-Proxy Table & Active Proxy Resolution**:
   - Store all proxies in `data/proxies.json`.
   - Table columns: `Active`, `Tag / Name`, `Type` (3x-ui / Manual), `Protocol`, `Host : Port`, `User`, `Status`, `Actions` (Set Active, Edit, Delete, Sync/Rotate).
   - One proxy is designated as `isActive: true`.
   - PAC script (`/proxy.pac`) uses the active proxy's protocol, host, and port.
   - Credentials store (`/creds`, `/api/sync`) delivers the active proxy's username & password to browser extensions.

---

## 2. Architecture & Data Structures

### 2.1 Centralized Storage (`src/storage.ts`)
- `DATA_DIR`: `process.env.DATA_DIR || path.resolve(process.cwd(), "data")`.
- Path helpers:
  - `getProxiesStorePath()` -> `DATA_DIR/proxies.json`
  - `getRotationConfigPath()` -> `DATA_DIR/rotation_config.json`
  - `getCredsStorePath()` -> `DATA_DIR/current_creds.json`
  - `getProxyConfigPath()` -> `DATA_DIR/proxy_config.json`
  - `getRoutingProfilesPath()` -> `DATA_DIR/routing_profiles.json`
  - `getInstancesMetaPath()` -> `DATA_DIR/instances_meta.json`
- Directory auto-creation via `fs.mkdirSync(DATA_DIR, { recursive: true })` on startup.

### 2.2 Proxy Node Schema (`src/types.ts`)
```typescript
export interface ProxyNode {
  id: string;                      // Unique ID
  tag: string;                     // Inbound tag or manual custom tag
  name: string;                    // Friendly display name
  type: "3x-ui" | "manual";        // Source type
  protocol: "socks5" | "http" | "https";
  host: string;                    // Proxy IP or FQDN
  port: number;                    // Listen port (1-65535)
  username?: string;               // Auth username
  password?: string;               // Auth password (masked in API responses)
  isActive: boolean;               // If true, feeds PAC and active creds
  lastSync?: string;               // ISO timestamp of last sync / rotation
  status?: "OK" | "ERROR" | "IDLE";
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}
```

### 2.3 API Endpoints
- `GET /api/proxies`: Returns list of proxy nodes (with passwords masked as `true`/`false` or `********`).
- `POST /api/proxies`: Creates a new proxy node (type `3x-ui` or `manual`). If `3x-ui`, queries panel by `tag` and populates details.
- `PUT /api/proxies/:id`: Updates an existing proxy node.
- `DELETE /api/proxies/:id`: Removes a proxy node.
- `POST /api/proxies/:id/activate`: Sets the specified proxy as active, updating `proxy_config.json` and `current_creds.json`.
- `POST /api/proxies/:id/sync`: Performs immediate 3x-ui sync and password rotation for that specific inbound.
- `GET /api/rotation/config` & `POST /api/rotation/config`: Retained for global 3x-ui panel credentials and scheduler configuration.

---

## 3. PAC & Extension Sync Integration

1. When a proxy is created, edited, or activated:
   - If marked active, `updateProxyConfig({ protocol: p.protocol, host: p.host, port: p.port })` is called.
   - If the proxy has credentials, `atomicWriteCreds` updates `current_creds.json` with `{ user: p.username, pass: p.password }`.
2. `/proxy.pac`:
   - Uses the active proxy's protocol, host, and port to emit directives:
     - `SOCKS5 <host>:<port>; DIRECT`
     - `PROXY <host>:<port>; DIRECT`
     - `HTTPS <host>:<port>; DIRECT`
3. Browser extension heartbeat `/api/sync` and `/creds`:
   - Returns the active proxy credentials so Chrome extension proxy authentication handler logs in seamlessly.

---

## 4. UI / UX Design (`src/views/dashboardView.ts` & `public/dashboard.js`)

1. Navigation tab renamed to **Proxy Settings** (RU: **Настройки прокси**).
2. Panel 1: **3x-ui Panel Connection**
   - Inputs: Panel URL, Admin User, Admin Pass, Rotation Interval (min), Insecure TLS checkbox.
   - Buttons: "Test Connection", "Save Panel Settings".
3. Panel 2: **Proxy Upstream Registry & Table**
   - Top action buttons:
     - `+ Add from 3x-ui by Tag` (opens modal with Tag input, Panel query preview, Host override).
     - `+ Add Manual Proxy` (opens modal with Tag, Protocol, Host, Port, Username, Password).
   - Table:
     - Columns: `Active` (radio / badge), `Tag / Name`, `Type`, `Protocol`, `Host : Port`, `User`, `Status`, `Actions`.
     - Action buttons: `Set Active` (`Сделать активным`), `Edit` (`Редактировать`), `Delete` (`Удалить`), and for 3x-ui: `Sync & Rotate` (`Синхронизировать`).
   - Active PAC Directive Badge at bottom showing current rule:
     e.g., `SOCKS5 10.0.0.1:10808; DIRECT`.

---

## 5. Security & Validation

1. **SSRF Guard**: Safe endpoint validation on 3x-ui Panel URL.
2. **Password Masking**: Client never receives raw passwords via `GET /api/proxies`.
3. **Atomic File Writes**: All writes to `data/*.json` use `writeJsonAtomic` / temp file swap to avoid corruption.
4. **Input Sanitization**: Hostnames validated with `/^[a-zA-Z0-9.-]+$/`, ports clamped to `1..65535`.
5. **Audit Logging**: All proxy node additions, updates, activations, deletions, and sync events logged to `audit.log`.

---

## 6. Verification Plan

1. Unit tests:
   - Proxy registry CRUD, activation, and persistence.
   - 3x-ui tag lookup and parsing of `socks`/`http` inbounds.
   - PAC generation reflecting the active proxy node.
2. Build verification: `npm run build` succeeds, packaging `dist/server.cjs`.
3. End-to-end check: Test manual proxy creation, activation, PAC directive rendering, and mock 3x-ui tag rotation.
