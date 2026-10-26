# PEC - Proxy Extension Corp

🌐 **Documentation Language:** **English** | [Русский](README.ru.md)

> [!IMPORTANT]
> **Enterprise Threat Model & Architectural Boundaries**
> PEC is strictly designed for on-premise deployment in closed corporate intranets and enterprise VPNs. Chrome extensions and desktop clients are distributed via Active Directory Group Policies (GPO: ExtensionInstallForcelist, Registry). Security is enforced through perimeter network isolation, AD Security Filtering, and dynamic credential rotation — not via client-side secret obfuscation.

[![CI](https://github.com/vlv-code/PEC/actions/workflows/ci.yml/badge.svg)](https://github.com/vlv-code/PEC/actions/workflows/ci.yml)
[![Release](https://img.shields.io/badge/release-v1.0.0-blue.svg)](https://github.com/vlv-code/PEC/releases)
[![Node.js](https://img.shields.io/badge/node.js-%3E%3D20-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/docker-ready-2496ED.svg)](Dockerfile)
[![Chrome Extension](https://img.shields.io/badge/chrome%20extension-MV3-brightgreen.svg)](https://developer.chrome.com/docs/extensions/mv3/)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

**PEC - Proxy Extension Corp** is an enterprise solution for central proxy fleet management, browser extension construction & packaging (Chrome Manifest V3), Windows Active Directory GPO distribution, and automated credential rotation with Xray / 3x-ui panels.

---

## 🌟 Key Features

1. **PEC-App Native Desktop Client (Windows & Linux)**:
   - Modern hardware-accelerated GUI built with **DirectX 11 & Dear ImGui**, Cyber Blue dark theme, vector corporate branding, and Russian/English localization.
   - Built-in multi-proxy switcher, routing rules inspector, and live connection stream viewer.
   - Automatic UAC elevation on startup, native Windows service daemon (`PECAppSvc`), and standalone installer (`PEC-App-Setup.exe`).
   - Native Linux client: CLI tool, background daemon, automated `deploy.sh` script, and systemd service unit.

2. **Desktop & Extension Loopback Pairing**:
   - Zero-config automatic discovery and pairing between the Chrome browser extension and local desktop client over localhost loopback.
   - Centralized telemetry, proxy synchronization, and unified fallback state.

3. **Extension Constructor Studio & GPO Deployment**:
   - Compiles and signs `.CRX` extension packages on-the-fly using 2048-bit RSA keys.
   - Generates enterprise `updates.xml` manifests for silent Google Chrome auto-updates.
   - Production-tested Active Directory GPO deployment: Group Policy Preferences (Registry) configuration for Google Chrome, Microsoft Edge, and Yandex Browser (`normal_installed` with safeguard against internal security layer deactivation), automated `.reg` files, PowerShell deployment/diagnostic scripts (`deploy-pec-gpo.ps1`, `verify-pec-gpo.ps1`), and GPMC guides.
   - Three operational UI modes: **Self-Service Pro** (full diagnostic & temporary bypass controls), **Kiosk / Restricted** (read-only popup), and **Stealth Agent** (invisible background worker).
   - Real-time interactive preview sandbox with instant state simulation (Online, Bypassed, Offline, Re-auth).

4. **Selective Routing & GeoBases (Smart PAC Engine)**:
   - Dynamic Proxy Auto-Configuration (PAC) generation with support for Direct-default or Proxy-default tunneling.
   - High-performance binary geodata parsing for `geosite.dat` and `geoip.dat`.
   - Built-in geo & service presets: Corporate Intranet, AI Tools (ChatGPT, Claude, Gemini), Social Media, Video Streaming, and Ad/Telemetry Sinkholing.
   - Strict PAC script injection sanitization for domain masks, proxy hostnames, and ports.

5. **App Studio & Release Rollback Manager**:
   - Web-based constructor in the dashboard to generate and customize native client profiles (`.pbprofile`), packaging scripts, and deployment policies.
   - One-click version rollback manager with SHA-256 integrity validation and fleet version enforcement.

6. **Automated 3x-ui / Xray Credential Rotation**:
   - Automated inbound password rotation on configurable schedules (15m, 1h, 6h, 24h).
   - Atomic disk writes for credential storage with corruption auto-recovery.
   - SSRF protection prohibiting loopback and cloud metadata endpoint access (`169.254.169.254`).

7. **Fleet Telemetry & Global Controls**:
   - Central heartbeat sync (`POST /api/sync`) tracking extension and desktop client instances, client IP, egress geo, and versioning.
   - In-memory LRU protection preventing DoS and memory exhaustion.
   - Emergency **Global Kill-Switch** allowing administrators to immediately revert the entire fleet to direct internet routing.

8. **Hardened Architecture & Security**:
   - Segmented CORS restricting administrative API access to Chrome extension origins and same-host.
   - In-memory sliding-window rate limiting for `/creds`, `/api/sync`, and 3x-ui connection tests.
   - Security response headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, etc.).
   - Visual and console security warnings when running with the default shared token.

---

## 🏗 Architecture & Code Structure

The repository provides a unified full-stack ecosystem:

```text
├── server.ts                  # Server entry point, app configuration, static files & routes
├── .env.example               # Template documenting all environment variables
├── client/                    # Native Desktop Client (PEC-App)
│   ├── Windows/               # DirectX 11 / Dear ImGui GUI, service, CLI, and NSIS installer
│   └── Linux/                 # Linux CLI, daemon, and systemd deployment scripts
├── src/
│   ├── middleware/
│   │   └── security.ts        # Security headers, segmented CORS, sliding-window rate limiters
│   ├── routes/
│   │   ├── credsRoutes.ts     # /creds, /api/sync, /proxy.pac (rate-limited & token-verified)
│   │   ├── appBuilderRoutes.ts# /api/app-builder/* (desktop client compilation & profiles)
│   │   ├── appSyncRoutes.ts   # /api/app/* (desktop client registration & pairing)
│   │   ├── releasesRoutes.ts  # /api/releases/* (release downloads & rollback management)
│   │   ├── routingRoutes.ts   # /api/routing/* (profiles and presets)
│   │   ├── instancesRoutes.ts # /api/instances/*, /api/config
│   │   ├── builderRoutes.ts   # /api/builder/*, /api/extension/*
│   │   ├── rotationRoutes.ts  # /api/rotation/*, /api/3xui/test (SSRF-protected)
│   │   └── systemRoutes.ts    # /healthz, /api/status, /api/github/releases
│   ├── views/
│   │   └── dashboardView.ts   # Management console HTML template & styling
│   ├── appPackager.ts         # Desktop installer packaging, profile and PowerShell script builder
│   ├── releases.ts            # Release manager, rollback engine, and hash verifier
│   ├── instances.ts           # Active fleet instance registry with LRU capacity protection
│   ├── packager.ts            # Chrome CRX packager, RSA signer, and GPO generator
│   ├── rotate.ts              # Atomic credential storage, 3x-ui integration, SSRF validator
│   ├── routing.ts             # Smart PAC generator, presets, geodata parser
│   └── scheduler.ts           # Cron rotation scheduler
├── extension/                 # Chrome Manifest V3 extension source template (do not load directly!)
└── dist/
    ├── unpacked/              # Built ready-to-load unpacked Chrome extension
    ├── updates/               # Packed CRX, ZIP, updates.xml
    ├── templates/app/         # Compiled desktop client binaries and templates
    └── server.cjs             # Compiled production Node.js server bundle
```

---

## ⚙️ Configuration (.env)

Copy `.env.example` to `.env` and customize your settings:

```bash
cp .env.example .env
```

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | Port for the HTTP server to listen on |
| `HOST` | `0.0.0.0` | Network interface binding |
| `PUBLIC_BASE_URL` | *(empty)* | Public URL baked into updates.xml / GPO artifacts; prevents Host-header poisoning. **Required in production** (validated: bare origin, no path/trailing slash) |
| `TRUST_PROXY` | `false` | Client IP resolution: `false` (direct exposure, X-Forwarded-For ignored), `1` (one reverse-proxy hop), `true` (trust all - trusted networks only) |
| `EXT_SHARED_TOKEN` | `corp-proxy-secret-token-change-me` | **Critical:** Fleet token required by Chrome extensions and desktop clients in `X-Ext-Token` / `X-Fleet-Token` (low privilege - baked into CRX/GPO artifacts) |
| `ADMIN_TOKEN` | *(none; required in production)* | **Critical:** Admin token for ALL management APIs (`X-Admin-Token`). Must be distinct from `EXT_SHARED_TOKEN`; never baked into artifacts |
| `ADMIN_USERNAME` | `admin` | Dashboard login username (bootstrap) |
| `ADMIN_PASSWORD` | *(falls back to `ADMIN_TOKEN`)* | Initial dashboard login password; change it in the dashboard settings — credentials persist as a scrypt hash in `DASHBOARD_AUTH_PATH` |
| `PAC_REQUIRE_SIGNATURE` | `false` | Enforce cryptographic HMAC-SHA256 signature verification on `/proxy.pac` requests |
| `PAC_SIGNING_SECRET` | *(falls back to `EXT_SHARED_TOKEN`)* | Secret HMAC key used for signing and verifying `/proxy.pac` requests |
| `PEC_PRIVATE_KEY_PATH` | *(empty)* | Path to RSA private key PEM file for signing CRX packages (defaults to auto-generating `extension/key.pem`) |
| `PEC_PRIVATE_KEY_PEM` | *(empty)* | Inline RSA private key PEM string for signing CRX packages (container environment alternative) |
| `DATA_DIR` | `./data` | Base directory for runtime persistent state files |
| `CREDS_STORE` | `./data/current_creds.json` | Path to persistent credentials JSON store |
| `DASHBOARD_AUTH_PATH` | `./data/dashboard_auth.json` | Path to the dashboard credential store (scrypt-hashed, never plaintext) |
| `PROXY_CONFIG_PATH` | `./data/proxy_config.json` | Path to saved proxy host, port, and bypass config |
| `ROUTING_PROFILES_PATH` | `./data/routing_profiles.json` | Path to routing profiles store |
| `INSTANCES_META_PATH` | `./data/instances_meta.json` | Path to connected client instances metadata store |
| `ROTATION_CONFIG_PATH` | `./data/rotation_config.json` | Path to rotation scheduler config |
| `ROTATION_HISTORY_PATH` | `./data/rotation_history.json` | Path to rotation history audit log |
| `BUILDER_CONFIG` | `./data/extension_build_config.json` | Path to extension build configuration store |
| `PROXY_HOST` | `10.0.0.1` | Default proxy host IP or domain name |
| `PROXY_PORT` | `10809` | Default proxy port |
| `ROTATION_INTERVAL_MIN` | `1440` | Default interval for proxy credential rotation in minutes (24 hours) |
| `XUI_PANEL_URL` | `https://3xui-host:2053/basepath` | Base URL of the 3x-ui management panel |
| `XUI_ADMIN_USER` | `admin` | Admin username for 3x-ui panel login |
| `XUI_ADMIN_PASS` | `change-me` | Admin password for 3x-ui panel login |
| `XUI_INBOUND_REMARK` | `squid-in` | Remark of the inbound proxy to rotate |
| `UPDATE_CHECK_REPO` | `vlv-code/PEC` | GitHub repository used for version update checks |

> ⚠️ **Security Notice:** Always change `EXT_SHARED_TOKEN` and set a distinct `ADMIN_TOKEN` before deploying to a production or public environment! The dashboard login password and the management APIs authenticate with `ADMIN_TOKEN`, not with the fleet token.
>
> **Deployment note - single process only.** PEC keeps all runtime state in one process
> (in-memory instance registry, routing profiles, rotation timer) mirrored to local JSON stores.
> Run **one** server process against a state directory: multiple replicas or PM2 cluster mode
> will corrupt shared stores and split in-memory state. Horizontal scaling would require an
> external shared store first. Persistent writes are atomic (tmp + rename), and PAC CIDR
> rules match only literal-IP hosts (hostnames resolving into private ranges must be covered
> by domain rules like `*.corp.local`) - see SECURITY.md.
>

---

## 🚀 Installation & Deployment

### Option 1: Standalone Node.js (Quick Local Run)

Prerequisites: Node.js 20+ installed.

```bash
# 1. Clone the repository
git clone https://github.com/vlv-code/PEC.git
cd PEC

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
nano .env   # set your EXT_SHARED_TOKEN and ADMIN_TOKEN

# 4. Start in development mode (with hot reload)
npm run dev

# Or build and run production bundle
npm run build            # Builds server bundle (alias for build:server)
npm run build:server     # Build production server bundle (dist/server.cjs)
npm run build:extension  # Build and package Chrome extension (e.g. npm run build:extension -- https://proxy.corp.example)
npm start
```

Access the dashboard at `http://localhost:3000`.

---

### Option 2: Docker Compose (Recommended for Production)

```bash
# 1. Configure your environment
cp .env.example .env
nano .env

# 2. Build and launch container in background
docker compose up -d --build

# 3. Monitor container logs
docker compose logs -f pec-server
```

---

### Option 3: Linux systemd Service (Ubuntu / Debian / CentOS)

Run the included automated setup script:

```bash
sudo bash deploy/install-systemd.sh
```

Service controls:
```bash
sudo systemctl status pec-server
sudo journalctl -u pec-server -f
sudo systemctl restart pec-server
```

---

### Option 4: Nginx Reverse Proxy with SSL

Deploy the hardened configuration template:

```bash
sudo cp deploy/nginx-proxy.conf /etc/nginx/sites-available/pec-proxy.conf
sudo ln -s /etc/nginx/sites-available/pec-proxy.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 🔒 Security Hardening

- **Dashboard Login & Sessions**: on first entry the dashboard shows a login screen (username + password). Credentials are verified server-side against a scrypt-hashed store and exchanged for an **HttpOnly, SameSite=Strict session cookie** (8-hour sliding TTL) — the browser never stores any admin secret. The login and password can be changed in the dashboard settings (popover → «Сменить логин / пароль», current password required, other sessions revoked on save). Logout revokes the session immediately; login attempts are rate limited (10/min).
- **Admin API Authentication**: every management endpoint (`/api/builder/*`, `/api/routing/*`, `/api/rotation/*`, `/api/instances/*`, `/api/config`, `/api/status`) accepts either the `X-Admin-Token` bearer header (scripts/automation) or a valid dashboard session cookie. The token is never embedded in the HTML.
- **CSRF Defense**: cookie-authenticated API calls must carry the `X-Requested-With: pec-dashboard` marker header; cross-site requests can silently attach cookies but cannot set custom headers without a CORS preflight, which the server never grants.
- **Timing-Attack Resistance**: both tokens and the login password are compared through SHA-256 digests in constant time (no length leak).
- **SSRF Defense**: The 3x-ui testing endpoint, scheduled rotations and saved panel URLs reject non-HTTP schemes and cloud metadata IP ranges (`169.254.169.254`, `metadata.google.internal`).
- **PAC Injection Defense**: Dynamic PAC script generator sanitizes proxy hostnames and port numbers, stripping dangerous characters (`"`, `;`, whitespace).
- **Rate Limiting**: Sliding-window rate limiters protect `/creds` (60/min), `/api/sync` (120/min), and 3x-ui connection tests (15/min).
- **Fleet Registry Protection**: Maximum instance limit (2000 items) with automatic LRU eviction protects against memory exhaustion attacks.
- **Multi-Profile & Instance Identity (`instanceToken`) Persistence**: The browser extension intentionally persists `instanceToken` in `chrome.storage.local`. This preserves a stable client instance identity across browser restarts, OS reboots, and Manifest V3 background service worker recycles. Without persistence, each worker wakeup or browser restart would create a new instance record on the server, causing uncontrolled instance sprawl and churn in the server registry (`instances.ts`). This architecture is secure because: (1) `instanceToken` is an opaque, low-privilege telemetry handle used only for heartbeat synchronization (`POST /api/sync`) and conveys no administrative access; (2) `chrome.storage.local` is fully sandboxed per-extension by Chromium; (3) the server enforces an LRU capacity bound (`MAX_INSTANCES = 2000`).
- **Least Privilege**: Docker containers and systemd services run under an isolated unprivileged user `pecuser`.

---

## 🧪 Testing & Verification

```bash
# TypeScript compilation check
npm run lint

# Automated test suite
npm test

# Production build bundle
npm run build
```

---

## 🧩 Extension Packaging & Testing

### Packaging via CLI
To package the extension from the command line:
```bash
# Specify target server URL (mandatory)
PEC_SERVER_URL=https://pec.example.corp npm run pack:extension
```
The packaged ZIP and CRX artifacts are generated in `dist/updates/`, and the ready-to-load unpacked directory is in `dist/unpacked/`.

> [!WARNING]
> Always load **`dist/unpacked/`** in `chrome://extensions` (Developer mode -> "Load unpacked").
> **Never load the raw `extension/` directory directly**: it contains unsubstituted build placeholders (`__PEC_SERVER_BASE__`) and cannot connect to your server.

---

## 📄 License & Third-Party Components
 
Distributed under the GNU Affero General Public License v3 (AGPL-3.0). See [LICENSE](LICENSE) for details.

### Third-Party Components

| Component | License | Author / Origin |
|---|---|---|
| **WinDivert** (v2.2.2-A) | LGPL-3.0-or-later | [Basil / reqable](https://github.com/reqable/WinDivert) |
| **Dear ImGui** (v1.91.5) | MIT | [Omar Cornut](https://github.com/ocornut/imgui) |
| **ProxyBridge** (PECAppCore) | MIT | [InterceptSuite / Sourav Kalal](https://github.com/InterceptSuite/ProxyBridge) |

- **PECAppCore Derivation**: The Windows/Linux native client routing and packet interception engine (`client/Windows/src` and `client/Linux/src`) derives from the open-source **ProxyBridge** project (MIT License, Copyright (c) 2024 InterceptSuite / Sourav Kalal). It has been substantially modified, hardened, and integrated for corporate fleet deployment, with automated compilation and packaging via the server's native App Studio. See [`client/Windows/src/NOTICE.md`](client/Windows/src/NOTICE.md).
- Full license texts and legal notices are located in [`assets/licenses/THIRD-PARTY-NOTICES.txt`](assets/licenses/THIRD-PARTY-NOTICES.txt).
