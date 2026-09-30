# Routing Matrix, Geodata (.dat) Subsystem, Popup Geometry & Studio Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the routing matrix and profile editor with Protobuf `.dat` / `.txt` geodata imports, rule priority reordering, duplicate protection, and geobase inspection; fix popup geometry asymmetry and implement smart domain normalization in PAC; modernize Extension Studio constructor preview with flexible dynamic sizing and complete Chrome API mocks.

**Architecture:** 
1. Build pure TypeScript Protobuf wire format decoder in `src/geodata/datParser.ts` to parse `geosite.dat` and `geoip.dat` without external binary tools.
2. Provide presets storage in `src/storage.ts` and CRUD/import API in `src/routes/routingRoutes.ts` with SSRF validation.
3. Enhance PAC generator in `src/routing.ts` and `src/extensionPureLogic.ts` / `extension/background.js` to support smart domain normalization (`*.ru`, `.ru`, bare domains) and rule hierarchy evaluation.
4. Update popup UI in `extension/popup.html` and `src/extensionTemplates.ts` with 3 equal columns (`display: grid`), concise `"📊 Инфо"` tab, and symmetrical paddings.
5. Upgrade Extension Studio in `public/dashboard.css` and `public/dashboard.js` with responsive `.popup-frame-box`, complete `chrome.storage.local` / `chrome.tabs` mock, rule reordering (`▲`/`▼`), and geobase inspector modal.

**Tech Stack:** TypeScript, Node.js (`tsx --test`), Chrome MV3 Extension APIs, Express.js, Protobuf wire format decoding, Vanilla CSS & HTML.

**Spec:** `docs/superpowers/specs/2026-10-01-routing-matrix-geodata-studio-overhaul-design.md`

## Global Constraints
- Chrome MV3 Strict CSP: No inline event handlers (`onclick=...`) in popup HTML or extension pages. All events attached in `popup.js`.
- Chrome PAC 7-bit ASCII compliance: `pacScript.data` must only contain characters `<= 127`. Punycode conversion for internationalized/Cyrillic domains.
- 1:1 Parity: `extension/popup.html` <-> `renderPopupHtml` in `src/extensionTemplates.ts`; `extension/background.js` <-> `BACKGROUND_TEMPLATE` in `src/extensionTemplates.ts`.
- Zero placeholders (`TODO`, `TBD`), comprehensive tests for every component.
- SSRF Protection: All remote URLs imported via backend must be checked with `validateSafeEndpointUrl`.

---

### Task 1: Popup Geometry & Symmetrical Padding + Smart PAC Domain Normalization

**Files:**
- Modify: `extension/popup.html:184-225,580-588`
- Modify: `src/extensionTemplates.ts:310-360,650-660`
- Modify: `src/extensionPureLogic.ts:40-79`
- Modify: `extension/background.js:680-725`
- Test: `test/popupStructure.test.ts`
- Test: `test/domainNormalization.test.ts`

**Interfaces:**
- Consumes: `injectUserRulesIntoPac(pacText, userRules, proxyServer)`
- Produces: Normalized PAC JavaScript matchers:
  - `*.domain.com` or `.domain.com` -> `(shExpMatch(host, "*.domain.com") || host === "domain.com")`
  - Bare domain `domain.com` -> `(host === "domain.com" || dnsDomainIs(host, ".domain.com") || shExpMatch(host, "*.domain.com"))`
  - Wildcards with interior asterisks -> `shExpMatch(host, "${pattern}")`

- [ ] **Step 1: Write the failing test for domain normalization and popup structure**

Create `test/domainNormalization.test.ts`:
```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { injectUserRulesIntoPac } from "../src/extensionPureLogic.js";

test("injectUserRulesIntoPac handles smart domain normalization", () => {
  const basePac = `function FindProxyForURL(url, host) { return "DIRECT"; }`;
  const userRules = [
    { pattern: "yandex.ru", action: "PROXY", enabled: true },
    { pattern: "*.google.com", action: "PROXY", enabled: true },
    { pattern: ".bing.com", action: "DIRECT", enabled: true },
    { pattern: "192.168.1.1", action: "DIRECT", enabled: true },
  ];
  const proxyServer = "proxy.corp:8080";
  const result = injectUserRulesIntoPac(basePac, userRules, proxyServer);

  // Bare domain should match exact host, subdomains via dnsDomainIs and shExpMatch
  assert.ok(
    result.includes('host === "yandex.ru" || dnsDomainIs(host, ".yandex.ru") || shExpMatch(host, "*.yandex.ru")'),
    "Bare domain should generate multi-clause host check"
  );
  // Wildcard *.google.com should match *.google.com and apex google.com
  assert.ok(
    result.includes('shExpMatch(host, "*.google.com") || host === "google.com"'),
    "Wildcard *. domain should match apex domain too"
  );
  // Dot-prefix .bing.com should be normalized like *.bing.com
  assert.ok(
    result.includes('shExpMatch(host, "*.bing.com") || host === "bing.com"'),
    "Dot prefix domain should match *.bing.com and apex bing.com"
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/domainNormalization.test.ts`
Expected: FAIL (clause matching logic not yet present).

- [ ] **Step 3: Implement smart domain normalization and update popup geometry**

In `src/extensionPureLogic.ts` (and identically in `extension/background.js` and `BACKGROUND_TEMPLATE`):
```typescript
export function injectUserRulesIntoPac(
  pacText: string,
  userRules: Array<{ pattern: string; action: string; enabled: boolean }>,
  proxyServer: string
): string {
  if (!pacText || typeof pacText !== "string") return pacText;
  if (!Array.isArray(userRules) || userRules.length === 0) return pacText;

  const activeRules = userRules.filter((r) => r && r.enabled && r.pattern && typeof r.pattern === "string" && r.pattern.trim());
  if (activeRules.length === 0) return pacText;

  let ruleLines = "  // === USER OVERRIDES BEGIN ===\n";
  for (const r of activeRules) {
    let rawPattern = r.pattern.trim();
    // Sanitize pattern: strip newlines, quotes and backslashes
    let cleanPattern = rawPattern.replace(/["\\\r\n]/g, "");
    if (!cleanPattern) continue;

    const actionStr = r.action === "PROXY"
      ? (proxyServer ? `PROXY ${proxyServer}` : "DIRECT")
      : "DIRECT";

    let condition = "";
    if (cleanPattern.startsWith("*.")) {
      const apex = cleanPattern.slice(2);
      condition = `shExpMatch(host, "${cleanPattern}") || host === "${apex}"`;
    } else if (cleanPattern.startsWith(".")) {
      const apex = cleanPattern.slice(1);
      condition = `shExpMatch(host, "*.${apex}") || host === "${apex}"`;
    } else if (!cleanPattern.includes("*") && !cleanPattern.includes("/")) {
      condition = `host === "${cleanPattern}" || dnsDomainIs(host, ".${cleanPattern}") || shExpMatch(host, "*.${cleanPattern}")`;
    } else {
      condition = `shExpMatch(host, "${cleanPattern}")`;
    }

    ruleLines += `  if (${condition}) { return "${actionStr}"; }\n`;
  }
  ruleLines += "  // === USER OVERRIDES END ===\n";

  const targetIdx = pacText.indexOf("function FindProxyForURL(url, host) {");
  if (targetIdx !== -1) {
    const insertPos = targetIdx + "function FindProxyForURL(url, host) {".length;
    return pacText.slice(0, insertPos) + "\n" + ruleLines + pacText.slice(insertPos);
  }
  const match = pacText.match(/function\s+FindProxyForURL\s*\([^)]*\)\s*\{/);
  if (match && typeof match.index === "number") {
    const insertPos = match.index + match[0].length;
    return pacText.slice(0, insertPos) + "\n" + ruleLines + pacText.slice(insertPos);
  }
  return pacText;
}
```

In `extension/popup.html` and `src/extensionTemplates.ts`:
- Change `.tabs`:
```css
    .tabs {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
      margin-bottom: 12px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 6px;
    }
```
- Change tab 3 button label:
`<button class="tab-btn" id="tab-btn-diag" data-tab="tab-content-diag">📊 Инфо</button>`
- Standardize card padding:
`.card { padding: 12px 14px; }`

Update `test/popupStructure.test.ts` to assert tab 3 button contains `"📊 Инфо"` and `.tabs` has `grid-template-columns: repeat(3, 1fr)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/domainNormalization.test.ts test/popupStructure.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/popup.html src/extensionTemplates.ts src/extensionPureLogic.ts extension/background.js test/domainNormalization.test.ts test/popupStructure.test.ts
git commit -m "fix(popup): symmetrical 3-column tabs, rename info tab, and smart PAC domain normalization"
```

---

### Task 2: Extension Studio Constructor Flexible Frame & Live Preview Fixes

**Files:**
- Modify: `public/dashboard.css:770-795`
- Modify: `public/dashboard.js:1780-1915`
- Test: `test/constructorIntegration.test.ts`

**Interfaces:**
- Consumes: Iframe `postMessage({ type: 'PREVIEW_RESIZE', width: number, height: number })`
- Produces: Dynamically sized preview frame; full `window.chrome.storage.local` and `window.chrome.tabs.query` simulator mocks.

- [ ] **Step 1: Write the failing test for Constructor Preview features**

Modify `test/constructorIntegration.test.ts` to add assertions:
```typescript
test("dashboard.js mockScript includes full chrome.storage.local and chrome.tabs mocks", () => {
  const dashboardJs = fs.readFileSync(path.join(process.cwd(), "public", "dashboard.js"), "utf-8");
  assert.ok(dashboardJs.includes("storage: {"), "mockScript must mock chrome.storage");
  assert.ok(dashboardJs.includes("tabs: {"), "mockScript must mock chrome.tabs");
  assert.ok(dashboardJs.includes("PREVIEW_RESIZE"), "mockScript must notify parent of resize");
  assert.ok(dashboardJs.includes("msg.type === \"SET_ENABLED\""), "mockScript must support msg.type in runtime.sendMessage");
});

test("dashboard.css has flexible popup-frame-box", () => {
  const dashboardCss = fs.readFileSync(path.join(process.cwd(), "public", "dashboard.css"), "utf-8");
  assert.ok(dashboardCss.includes("width: fit-content"), "popup-frame-box must be flexible width");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/constructorIntegration.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement flexible container and complete simulator mocks**

In `public/dashboard.css`:
```css
    .popup-frame-box {
      width: fit-content;
      max-width: 100%;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: #0b1120;
      overflow: hidden;
      box-shadow: 0 20px 45px rgba(0, 0, 0, 0.7);
      transition: width 0.2s ease, height 0.2s ease;
    }
    .popup-frame-box iframe {
      width: 380px;
      height: 580px;
      border: none;
      display: block;
      transition: width 0.2s ease, height 0.2s ease;
    }
```

In `public/dashboard.js`:
- In `mockScript`:
  - Implement `window.chrome.storage = { local: { get: ..., set: ... } }` backed by an in-memory storage dictionary.
  - Implement `window.chrome.tabs = { query: function(q, cb) { var res = [{ id: 1, url: "https://yandex.ru/search", active: true }]; if (cb) cb(res); return Promise.resolve(res); } }`.
  - In `sendMessage`: support both `msg.type` and `msg.action` for:
    - `GET_STATUS`: returns `window.__simState`
    - `SET_ENABLED`: updates `window.__simState.online = msg.enabled`, returns state
    - `BYPASS_TOGGLE`: toggles bypass, returns state
    - `SYNC_NOW`: returns `{ ok: true, profile: "Direct by Default" }`
    - `GET_USER_RULES`: returns user rules from mock storage
    - `SAVE_USER_RULES`: stores rules in mock storage, returns `{ ok: true }`
    - `GET_LOGS`: returns sample ring logs
  - In `__postPreviewHeight`:
    ```javascript
    function __postPreviewSize() {
      try {
        var w = Math.max(380, document.body ? document.body.scrollWidth : 380);
        var h = Math.max(
          document.documentElement ? document.documentElement.scrollHeight : 0,
          document.body ? document.body.scrollHeight : 0
        );
        window.parent.postMessage({ type: "PREVIEW_RESIZE", width: w, height: h }, "*");
      } catch (e) {}
    }
    ```
- In parent `dashboard.js`:
  - In `window.addEventListener('message')`:
    ```javascript
    if (e.data && e.data.type === 'PREVIEW_RESIZE') {
      const h = Math.max(180, Math.min(850, Math.round(e.data.height)));
      pf.style.height = h + 'px';
      if (typeof e.data.width === 'number') {
        const w = Math.max(380, Math.min(500, Math.round(e.data.width)));
        pf.style.width = w + 'px';
      }
    }
    ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/constructorIntegration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/dashboard.css public/dashboard.js test/constructorIntegration.test.ts
git commit -m "feat(constructor): flexible popup frame preview and complete chrome runtime/storage/tabs mock"
```

---

### Task 3: Pure Protobuf `.dat` Parser & Geodata Subsystem

**Files:**
- Create: `src/geodata/datParser.ts`
- Test: `test/geodatParser.test.ts`

**Interfaces:**
- Produces:
  - `parseGeoSite(buffer: Buffer): Map<string, { tag: string; domains: Array<{ type: string; value: string }> }>`
  - `parseGeoIp(buffer: Buffer): Map<string, { countryCode: string; cidrs: Array<{ ip: string; prefix: number }> }>`
  - `parsePlaintextList(content: string): string[]`

- [ ] **Step 1: Write the failing test for Protobuf parser**

Create `test/geodatParser.test.ts`:
```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { parseGeoSite, parseGeoIp, parsePlaintextList } from "../src/geodata/datParser.js";

// Helper to write a protobuf varint into a buffer
function encodeVarint(val: number): Buffer {
  const bytes = [];
  while (val > 0x7f) {
    bytes.push((val & 0x7f) | 0x80);
    val >>>= 7;
  }
  bytes.push(val & 0x7f);
  return Buffer.from(bytes);
}

// Helper to encode length-delimited field (tag wire_type 2)
function encodeLengthDelimited(fieldNum: number, data: Buffer): Buffer {
  const tag = (fieldNum << 3) | 2;
  return Buffer.concat([encodeVarint(tag), encodeVarint(data.length), data]);
}

test("parsePlaintextList trims, ignores comments and empty lines", () => {
  const text = `
    # Comment
    yandex.ru
    *.google.com # inline comment
    
    192.168.1.0/24
  `;
  const result = parsePlaintextList(text);
  assert.deepEqual(result, ["yandex.ru", "*.google.com", "192.168.1.0/24"]);
});

test("parseGeoSite correctly parses synthesized GeoSiteList protobuf buffer", () => {
  // Domain message: tag 1 = type (varint), tag 2 = value (string)
  const domainVal = Buffer.from("example.com", "utf-8");
  const domainMsg = Buffer.concat([
    encodeVarint((1 << 3) | 0), // type = Plain (0)
    encodeVarint(0),
    encodeLengthDelimited(2, domainVal),
  ]);

  // GeoSite message: tag 1 = country_code (string), tag 2 = domain (Domain message)
  const countryVal = Buffer.from("RU", "utf-8");
  const geoSiteMsg = Buffer.concat([
    encodeLengthDelimited(1, countryVal),
    encodeLengthDelimited(2, domainMsg),
  ]);

  // GeoSiteList: repeated GeoSite entry = 1
  const geoSiteList = encodeLengthDelimited(1, geoSiteMsg);

  const parsed = parseGeoSite(geoSiteList);
  assert.ok(parsed.has("RU"), "Must contain RU tag");
  const ruSite = parsed.get("RU")!;
  assert.equal(ruSite.tag, "RU");
  assert.equal(ruSite.domains.length, 1);
  assert.equal(ruSite.domains[0].value, "example.com");
});

test("parseGeoIp correctly parses synthesized GeoIPList protobuf buffer", () => {
  // CIDR message: tag 1 = ip (bytes 4 bytes for IPv4), tag 2 = prefix (varint)
  const ipBytes = Buffer.from([192, 168, 1, 0]);
  const cidrMsg = Buffer.concat([
    encodeLengthDelimited(1, ipBytes),
    encodeVarint((2 << 3) | 0), // prefix tag
    encodeVarint(24),
  ]);

  // GeoIP message: tag 1 = country_code (string), tag 2 = cidr (CIDR message)
  const countryVal = Buffer.from("RU", "utf-8");
  const geoIpMsg = Buffer.concat([
    encodeLengthDelimited(1, countryVal),
    encodeLengthDelimited(2, cidrMsg),
  ]);

  const geoIpList = encodeLengthDelimited(1, geoIpMsg);
  const parsed = parseGeoIp(geoIpList);
  assert.ok(parsed.has("RU"), "Must contain RU country code");
  const ruIp = parsed.get("RU")!;
  assert.equal(ruIp.cidrs.length, 1);
  assert.equal(ruIp.cidrs[0].ip, "192.168.1.0");
  assert.equal(ruIp.cidrs[0].prefix, 24);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/geodatParser.test.ts`
Expected: FAIL (module `src/geodata/datParser.ts` does not exist yet).

- [ ] **Step 3: Implement `src/geodata/datParser.ts`**

Create `src/geodata/datParser.ts`:
- Pure Protobuf wire-format parser implementing wire types 0 (varint) and 2 (length-delimited).
- Implements `parseGeoSite`, extracting `country_code` and domains (Plain, Regex, RootDomain, Full).
- Implements `parseGeoIp`, extracting `country_code` and IPv4/IPv6 CIDRs.
- Implements `parsePlaintextList`, extracting domain / IP / CIDR entries.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/geodatParser.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/geodata/datParser.ts test/geodatParser.test.ts
git commit -m "feat(geodata): pure typescript protobuf parser for geosite.dat and geoip.dat"
```

---

### Task 4: Presets Dynamic Storage & Backend CRUD API

**Files:**
- Modify: `src/storage.ts`
- Modify: `src/types.ts`
- Modify: `src/routing.ts`
- Modify: `src/routes/routingRoutes.ts`
- Test: `test/presetsApi.test.ts`

**Interfaces:**
- Consumes: `parseGeoSite`, `parseGeoIp`, `parsePlaintextList`, `validateSafeEndpointUrl`
- Produces:
  - `GET /api/routing/presets`: list of presets
  - `GET /api/routing/presets/:id`: preset details with entries
  - `POST /api/routing/presets`: create/update preset
  - `DELETE /api/routing/presets/:id`: delete preset
  - `POST /api/routing/presets/import-url`: import remote URL (.dat / .txt) with SSRF check
  - `POST /api/routing/presets/import-file`: import uploaded file
  - `POST /api/routing/presets/:id/refresh`: re-download preset

- [ ] **Step 1: Write the failing test for presets API**

Create `test/presetsApi.test.ts`:
```typescript
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { createRoutingRoutes } from "../src/routes/routingRoutes.js";
import { getRoutingPresets } from "../src/storage.js";

test("routingRoutes provides CRUD for presets", async () => {
  const app = express();
  app.use(express.json());
  const mockOptions = {
    requireAdmin: (_req: any, _res: any, next: any) => next(),
    auditSink: () => {},
  };
  app.use(createRoutingRoutes(mockOptions as any));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;

  try {
    // 1. GET /api/routing/presets
    const res = await fetch(`http://127.0.0.1:${port}/api/routing/presets`);
    assert.equal(res.status, 200);
    const presets = await res.json();
    assert.ok(Array.isArray(presets), "Must return array of presets");
    assert.ok(presets.length >= 5, "Builtin presets must be initialized");

    // 2. POST /api/routing/presets (create custom preset)
    const createRes = await fetch(`http://127.0.0.1:${port}/api/routing/presets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "preset:custom_test",
        name: "Custom Test Preset",
        category: "custom",
        description: "Test description",
        type: "domain",
        entries: ["test1.com", "test2.com"],
      }),
    });
    assert.equal(createRes.status, 200);

    // 3. GET /api/routing/presets/preset:custom_test
    const singleRes = await fetch(`http://127.0.0.1:${port}/api/routing/presets/preset:custom_test`);
    assert.equal(singleRes.status, 200);
    const single = await singleRes.json();
    assert.equal(single.name, "Custom Test Preset");
    assert.deepEqual(single.entries, ["test1.com", "test2.com"]);

    // 4. SSRF protection on import-url
    const ssrfRes = await fetch(`http://127.0.0.1:${port}/api/routing/presets/import-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "http://169.254.169.254/latest/meta-data" }),
    });
    assert.equal(ssrfRes.status, 400, "SSRF target must be blocked with 400");
  } finally {
    server.close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/presetsApi.test.ts`
Expected: FAIL (routes not implemented).

- [ ] **Step 3: Implement storage and routes**

In `src/types.ts`:
- Define `RoutingPresetItem` interface.

In `src/storage.ts`:
- Add `getRoutingPresetsPath()`.
- Add `getRoutingPresets()` and `saveRoutingPresets(items)`.

In `src/routing.ts`:
- Update `expandRuleDomains` to load dynamic presets from storage.

In `src/routes/routingRoutes.ts`:
- Add CRUD handlers:
  - `GET /api/routing/presets`
  - `GET /api/routing/presets/:id`
  - `POST /api/routing/presets`
  - `DELETE /api/routing/presets/:id`
  - `POST /api/routing/presets/import-url` (using `validateSafeEndpointUrl`)
  - `POST /api/routing/presets/import-file`
  - `POST /api/routing/presets/:id/refresh`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/presetsApi.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/storage.ts src/routing.ts src/routes/routingRoutes.ts test/presetsApi.test.ts
git commit -m "feat(routing): dynamic presets storage, CRUD and SSRF-safe URL/file import API"
```

---

### Task 5: Routing Profiles UI Overhaul (Reordering, Duplicate Badging, Inspector Modal)

**Files:**
- Modify: `public/dashboard.css`
- Modify: `src/views/dashboardView.ts`
- Modify: `public/dashboard.js`
- Test: `test/routingHierarchy.test.ts`

**Interfaces:**
- Consumes: `/api/routing/presets`, `/api/routing/profiles`
- Produces:
  - Rule reordering (`▲`/`▼`) updating priority in profile.
  - Geobase Inspector Modal with search, selection, and cherry-picking to profile.
  - Responsive `.presets-grid`.
  - Duplicate preset protection with badge `In Profile: PROXY`.
  - Unsaved modifications indicator.

- [ ] **Step 1: Write the failing test for rule reordering and inspector UI**

Create `test/routingHierarchy.test.ts`:
```typescript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generatePacScript } from "../src/routing.js";
import { RoutingProfile, ProxyConfiguration } from "../src/types.js";

test("generatePacScript evaluates rules in exact array order (top-to-bottom hierarchy)", () => {
  const profile: RoutingProfile = {
    id: "test_hierarchy",
    name: "Hierarchy Test",
    description: "Testing rule priority order",
    defaultPolicy: "DIRECT",
    isDefault: false,
    rules: [
      { id: "rule1", name: "Block rule", targetType: "custom", pattern: "special.corp", action: "BLOCK", enabled: true },
      { id: "rule2", name: "Proxy rule", targetType: "custom", pattern: "*.corp", action: "PROXY", enabled: true },
    ],
  };
  const proxyConfig: ProxyConfiguration = { enabled: true, host: "proxy.corp", port: 10809, protocol: "http" };

  const pacText = generatePacScript(profile, proxyConfig);
  const blockIdx = pacText.indexOf("special.corp");
  const proxyIdx = pacText.indexOf("*.corp");

  assert.ok(blockIdx !== -1 && proxyIdx !== -1);
  assert.ok(blockIdx < proxyIdx, "First rule must appear before second rule in PAC script");
});

test("dashboardView includes reorder buttons and presets inspector markup", () => {
  const dashboardView = fs.readFileSync(path.join(process.cwd(), "src", "views", "dashboardView.ts"), "utf-8");
  assert.ok(dashboardView.includes("btn-reorder-up"), "Must include rule reorder up button");
  assert.ok(dashboardView.includes("btn-reorder-down"), "Must include rule reorder down button");
  assert.ok(dashboardView.includes("modalGeobaseInspector"), "Must include modal geobase inspector markup");
  assert.ok(dashboardView.includes("presets-grid"), "Must include responsive presets grid class");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/routingHierarchy.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement UI, CSS, and JS for Routing Profiles**

In `public/dashboard.css`:
- Add `.presets-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }`.
- Add `.btn-reorder-up`, `.btn-reorder-down` styling.
- Add `.modal-overlay`, `.inspector-table`, `.unsaved-badge` styling.

In `src/views/dashboardView.ts`:
- Add `▲` and `▼` action buttons in the rules table.
- Wrap preset cards into `.presets-grid`.
- Add Inspector Modal dialog markup.
- Add Import Modal dialog markup.

In `public/dashboard.js`:
- Add `moveRuleUp(index)` and `moveRuleDown(index)` functions.
- Add duplicate preset badge logic `In Profile: [ACTION]`.
- Add `openGeobaseInspector(presetId)`: fetches preset entries, renders searchable table with checkboxes.
- Add `addSelectedToProfile()` cherry-picking handler.
- Add unsaved changes dirty check flag.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/routingHierarchy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/dashboard.css src/views/dashboardView.ts public/dashboard.js test/routingHierarchy.test.ts
git commit -m "feat(dashboard): routing rules reordering, geobase inspector modal, and duplicate preset prevention"
```

---

### Task 6: Full Integration, Purity Verification & Build

**Files:**
- Test: `test/purity.test.ts`
- All project files

**Interfaces:**
- Full test suite, 0 TypeScript compile errors, 0 CSP violations, 1:1 template parity.

- [ ] **Step 1: Run purity tests**

Run: `npx tsx --test test/purity.test.ts`
Expected: PASS (all 22+ purity assertions pass).

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: PASS (all 155+ tests pass with 0 failures).

- [ ] **Step 3: Run TypeScript production build**

Run: `npm run build`
Expected: PASS with exit code 0.

- [ ] **Step 4: Commit and push**

```bash
git add .
git commit -m "chore: full integration verification, purity checks, and production build"
git push origin main
```
