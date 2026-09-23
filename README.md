# PEC - Proxy Extension Corp

🌐 **Documentation Language:** **English** | [Русский](README.ru.md)

[![CI](https://github.com/vlv-code/PEC/actions/workflows/ci.yml/badge.svg)](https://github.com/vlv-code/PEC/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node.js-%3E%3D20-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/docker-ready-2496ED.svg)](Dockerfile)
[![Chrome Extension](https://img.shields.io/badge/chrome%20extension-MV3-brightgreen.svg)](https://developer.chrome.com/docs/extensions/mv3/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**PEC - Proxy Extension Corp** is an enterprise solution for central proxy fleet management, browser extension construction & packaging (Chrome Manifest V3), Windows Active Directory GPO distribution, and automated credential rotation with Xray / 3x-ui panels.

---

## 🌟 Key Features

1. **Extension Constructor Studio & Live Preview**:
   - Compiles and signs `.CRX` extension packages on-the-fly using 2048-bit RSA keys.
   - Generates enterprise `updates.xml` manifests for silent Google Chrome auto-updates.
   - Three operational UI modes: **Self-Service Pro** (full diagnostic & temporary bypass controls), **Kiosk / Restricted** (read-only popup), and **Stealth Agent** (invisible background worker).
   - Real-time interactive preview sandbox with instant state simulation (Online, Bypassed, Offline, Re-auth).

2. **Selective Routing & GeoBases (Smart PAC Engine)**:
   - Dynamic Proxy Auto-Configuration (PAC) generation with support for Direct-default or Proxy-default tunneling.
   - Built-in geo & service presets: Corporate Intranet, AI Tools (ChatGPT, Claude, Gemini), Social Media, Video Streaming, and Ad/Telemetry Sinkholing.
   - Strict PAC script injection sanitization for domain masks, proxy hostnames, and ports.

3. **Automated 3x-ui / Xray Credential Rotation**:
   - Automated inbound password rotation on configurable schedules (15m, 1h, 6h, 24h).
   - Atomic disk writes for credential storage with corruption auto-recovery.
   - SSRF protection prohibiting loopback and cloud metadata endpoint access (`169.254.169.254`).

4. **Fleet Telemetry & Global Controls**:
   - Central heartbeat sync (`POST /api/sync`) tracking extension instances, client IP, egress geo, and versioning.
   - In-memory LRU protection preventing DoS and memory exhaustion.
   - Emergency **Global Kill-Switch** allowing administrators to immediately revert the entire fleet to direct internet routing.

5. **Hardened Architecture & Security**:
   - Segmented CORS restricting administrative API access to Chrome extension origins and same-host.
   - In-memory sliding-window rate limiting for `/creds`, `/api/sync`, and 3x-ui connection tests.
   - Security response headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, etc.).
   - Visual and console security warnings when running with the default shared token.

---

## 🏗 Architecture & Code Structure

The backend has a modular, maintainable structure:

```text
├── server.ts                  # Server entry point, app configuration, static files & routes
├── .env                       # Active environment configuration
├── .env.example               # Template documenting all environment variables
├── src/
│   ├── middleware/
│   │   └── security.ts        # Security headers, segmented CORS, sliding-window rate limiters
│   ├── routes/
│   │   ├── credsRoutes.ts     # /creds, /api/sync, /proxy.pac (rate-limited & token-verified)
│   │   ├── routingRoutes.ts   # /api/routing/* (profiles and presets)
│   │   ├── instancesRoutes.ts # /api/instances/*, /api/config
│   │   ├── builderRoutes.ts   # /api/builder/*, /api/extension/*
│   │   ├── rotationRoutes.ts  # /api/rotation/*, /api/3xui/test (SSRF-protected)
│   │   └── systemRoutes.ts    # /healthz, /api/status, /api/github/releases
│   ├── views/
│   │   └── dashboardView.ts   # Management console HTML template & styling
│   ├── audit.ts               # In-memory access logging and IP detection
│   ├── instances.ts           # Active fleet instance registry with LRU capacity protection
│   ├── packager.ts            # Chrome CRX packager, RSA signer, and GPO generator
│   ├── rotate.ts              # Atomic credential storage, 3x-ui integration, SSRF validator
│   ├── routing.ts             # Smart PAC generator, presets, domain expansion
│   ├── scheduler.ts           # Cron rotation scheduler
│   └── types.ts               # Shared TypeScript data models
└── extension/                 # Chrome Manifest V3 extension source template
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
| `EXT_SHARED_TOKEN` | `corp-proxy-secret-token-change-me` | **Critical:** Fleet token required by Chrome extensions in `X-Ext-Token` (low privilege - baked into CRX/GPO artifacts) |
| `ADMIN_TOKEN` | *(none; required in production)* | **Critical:** Admin token for ALL management APIs (`X-Admin-Token`). Must be distinct from `EXT_SHARED_TOKEN`; never baked into artifacts |
| `ADMIN_USERNAME` | `admin` | Dashboard login username (bootstrap) |
| `ADMIN_PASSWORD` | *(falls back to `ADMIN_TOKEN`)* | Initial dashboard login password; change it in the dashboard settings — credentials persist as a scrypt hash in `DASHBOARD_AUTH_PATH` |
| `DASHBOARD_AUTH_PATH` | `./dashboard_auth.json` | Path to the dashboard credential store (scrypt-hashed, never plaintext) |
| `CREDS_STORE` | `./current_creds.json` | Path to persistent credentials JSON store |
| `PROXY_CONFIG_PATH` | `./proxy_config.json` | Path to saved proxy host, port, and bypass config |
| `PROXY_HOST` | `10.0.0.1` | Default proxy host IP or domain name |
| `PROXY_PORT` | `10809` | Default proxy port |
| `XUI_PANEL_URL` | `https://3xui-host:2053/basepath` | Base URL of the 3x-ui management panel |
| `XUI_ADMIN_USER` | `admin` | Admin username for 3x-ui panel login |
| `XUI_ADMIN_PASS` | `change-me` | Admin password for 3x-ui panel login |
| `XUI_INBOUND_REMARK` | `squid-in` | Remark of the inbound proxy to rotate |
| `TRUST_PROXY` | `false` | Client IP resolution: `false` (direct exposure, X-Forwarded-For ignored), `1` (one reverse-proxy hop), `true` (trust all - trusted networks only) |
| `PUBLIC_BASE_URL` | *(empty)* | Public URL baked into updates.xml / GPO artifacts; prevents Host-header poisoning. **Required in production** (validated: bare origin, no path/trailing slash) |
| `ROTATION_CONFIG_PATH` | `./rotation_config.json` | Path to rotation scheduler config |
| `ROUTING_PROFILES_PATH` | `./routing_profiles.json` | Path to routing profiles store |

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
npm run build
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

## 📄 License

Distributed under the MIT License. See [LICENSE](LICENSE) for details.
