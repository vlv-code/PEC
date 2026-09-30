# Implementation Plan: Phase 2 - Routing Visibility & Diagnostics (T5, T10, T13)

## Goal
Make proxy routing mode (Selective vs Tunnel) explicit and transparent across the server sync API, extension runtime state, extension popup UI, and administrative dashboard, and improve sync error diagnostics.

## Proposed Changes

### Task 1: T10 (M1) - Log HTTP error status on `/api/sync` before `/creds` fallback
- **File:** `extension/background.js` & `src/extensionTemplates.ts` (`BACKGROUND_TEMPLATE`)
- **TDD:**
  - Write test in `test/purity.test.ts`: test that when `/api/sync` responds with HTTP 401, background.js writes a WARN log containing `HTTP 401`.
  - Implement log:
    ```javascript
    if (!resSync.ok) {
      log('warn', `Sync endpoint /api/sync returned HTTP ${resSync.status} ${resSync.statusText || ''}. Falling back to /creds`);
      throw new Error(`HTTP ${resSync.status}`);
    }
    ```
  - Verify test passes.

### Task 2: T5 (C2) - Expose `profileDefaultPolicy` in `/api/sync`, extension state, and Dashboard
- **File:** `src/routes/credsRoutes.ts`
  - In `/api/sync` route:
    Fetch active profile via `getRoutingProfile(creds.activeProfileId)` or default profile.
    Include `profileDefaultPolicy: activeProfile ? activeProfile.defaultPolicy : "direct"` in the JSON response.
- **File:** `extension/background.js` & `src/extensionTemplates.ts`
  - In `syncProxyConfig()`:
    Extract `profileDefaultPolicy: data.profileDefaultPolicy || "direct"`.
    Store in `currentProxyState.profileDefaultPolicy` and persist in `chrome.storage.local`.
    Return it in `GET_STATUS` message response.
- **File:** `src/dashboardView.ts` & `public/dashboard.js`
  - Verify and ensure routing profile default policy is clearly editable and visible in routing profiles management tab.
- **TDD:**
  - Add test in `test/http.test.ts` verifying `/api/sync` returns `profileDefaultPolicy` for the active profile.
  - Add test in `test/purity.test.ts` verifying `background.js` parses and stores `profileDefaultPolicy`.

### Task 3: T13 (M4) - Clear routing mode indicator in popup UI
- **File:** `extension/popup.html`, `extension/popup.js`, `src/extensionTemplates.ts`
  - Update `updateStatusUI(status)`:
    Calculate mode label:
    - If `status.bypassActive`: `"Прямой (Bypass)"`
    - If `status.mode === 'pac_script'`:
      `status.profileDefaultPolicy === 'proxy' ? "PAC (туннель)" : "PAC (селективный)"`
    - If `status.mode === 'fixed_servers'`: `"Fixed Proxy"`
    - Else: `status.mode`
    Show explanatory subtitle or tooltip in popup status card.
- **TDD:**
  - Add tests in `test/purity.test.ts` verifying popup template renders the routing mode indicator helper and labels.

## Verification
- `npx tsx --test test/*.test.ts`
- `npm run build`
