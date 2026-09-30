# Implementation Plan: Phase 3 - Proxy Health & Fallback Safety (T6, T7)

## Goal
Detect unreachable proxy servers proactively via TCP probing, inform the client extension so it can display an `ERR` badge and warn the user, prevent inactive placeholder `10.0.0.1` defaults from masquerading as valid proxies, and provide an optional `failClosed` mode on routing profiles to prevent IP leakage when a proxy is down.

## Proposed Changes

### Task 1: T6 (C3) - Active Proxy TCP Probe & Health Check
- **File:** `src/proxies.ts`
  - Implement `probeProxyTcp(host: string, port: number, timeoutMs = 1500): Promise<boolean>` using `net.Socket`.
  - Cache results for 10-15 seconds to avoid flooding the proxy on rapid sync requests.
  - In `initProxiesStore()`: if `PROXY_HOST` env is empty or equals default `10.0.0.1`, set initial proxy `enabled: false` (or mark placeholder status) so fresh installs do not pretend `10.0.0.1` is an active proxy.
- **File:** `src/routes/credsRoutes.ts`
  - In `/api/sync`: run `probeProxyTcp(proxyConfig.host, proxyConfig.port)` (or check cache) and return `proxyReachable: boolean` in JSON response.
- **File:** `extension/background.js` & `src/extensionTemplates.ts`
  - In `syncWithServer()`: capture `proxyReachable: payload.proxyReachable !== false`.
  - If `payload.proxyReachable === false`, set badge to `"ERR"` (red `#ef4444`) and log `[corp-proxy][WARN] Configured proxy server is unreachable`.
- **TDD:**
  - Test TCP probe in `test/proxies.test.ts` (or `test/http.test.ts`): with a listening mock TCP server, probe returns true; with closed port, returns false.
  - Test `/api/sync` payload contains `proxyReachable` boolean.
  - Test `background.js` sets `"ERR"` badge when `proxyReachable === false`.

### Task 2: T7 (C3 opt) - Optional `failClosed` on Routing Profiles
- **File:** `src/types.ts`
  - Add `failClosed?: boolean` to `RoutingProfile`.
- **File:** `src/routing.ts`
  - In `generatePacScript()`:
    - If `profile.failClosed` is true, generated proxy directives omit `; DIRECT` fallback (e.g. `return "PROXY " + proxyHost + ":" + proxyPort;` or if action is proxy, strictly enforce proxy without direct leakage).
    - If `profile.failClosed` is false or omitted, maintain current behavior with safe fallback.
- **File:** `src/views/dashboardView.ts` & `public/dashboard.js`
  - Add `profFailClosed` checkbox in profile edit card:
    "Fail-Closed: запретить прямой доступ (DIRECT) при падении прокси".
  - In `public/dashboard.js`: bind `profFailClosed` in `renderProfile` and `saveCurrentProfile`.
- **TDD:**
  - Add test in `test/routing.test.ts` asserting that a profile with `failClosed: true` generates PAC scripts without `DIRECT` fallback for proxy rules.

## Verification
- `npx tsx --test test/*.test.ts`
- `npm run build`
