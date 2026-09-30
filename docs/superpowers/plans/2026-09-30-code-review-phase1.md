# Phase 1: Build & Package Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate silent build misconfigurations by enforcing explicit server URLs in release packaging, adding runtime placeholder guards to the service worker, centralizing popup templates with diagnostics logs, and prioritizing environment fleet tokens.

**Architecture:** 
1. Make `scripts/pack-extension.ts` fail fast if no server URL is provided and update GitHub Actions release workflow.
2. Add a top-level fail-fast assertion in `background.js` and `BACKGROUND_TEMPLATE` to alert developers if raw `extension/` is loaded into Chrome.
3. Centralize `POPUP_HTML_TEMPLATE` and `POPUP_JS_TEMPLATE` in `src/extensionTemplates.ts` with complete diagnostics log terminal support, replacing duplicate templates in `src/packager.ts`.
4. Guarantee that `process.env.EXT_SHARED_TOKEN` overrides any stale saved token in `extension_build_config.json` during packaging.

**Tech Stack:** TypeScript, Node.js 20, Chrome MV3 Extension APIs, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-30-code-review-resolution-design.md`

## Global Constraints
- All tests must pass: `npm test`.
- TypeScript build must succeed: `npm run build`.
- No regression in existing 111 tests.
- Maintain full backward compatibility for Chrome MV3.
- Commit each task independently.

---

### Task 1: T1 (C1) - Mandatory Server URL in pack-extension & Release Workflow

**Files:**
- Modify: `scripts/pack-extension.ts`
- Modify: `.github/workflows/release.yml`
- Modify: `README.md`
- Test: `test/builder.test.ts`

**Interfaces:**
- Consumes: `packageExtension(baseUrl)` from `src/packager.ts`
- Produces: Command-line exit code 1 if `PEC_SERVER_URL` or `PUBLIC_BASE_URL` is omitted

- [ ] **Step 1: Write test verifying pack-extension requires a server URL**
Add a test in `test/builder.test.ts` verifying that `scripts/pack-extension.ts` fails with exit code 1 and error message when neither `PEC_SERVER_URL` nor `PUBLIC_BASE_URL` is set, and succeeds when provided.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx tsx --test test/builder.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement mandatory server URL check in scripts/pack-extension.ts**
```ts
import { packageExtension } from "../src/packager.js";

const serverUrl = (process.env.PEC_SERVER_URL || process.env.PUBLIC_BASE_URL || "").trim();

if (!serverUrl) {
  console.error(
    "[pack] FATAL: целевой сервер не задан — в расширение будет зашит нерабочий адрес.\n" +
    "Укажите его явно:\n" +
    "  PEC_SERVER_URL=https://pec.example.corp npm run pack:extension"
  );
  process.exit(1);
}

const result = packageExtension(serverUrl);
console.log(`[pack] Extension packaged: v${result.version} (${result.uiMode || "custom"}) -> ${serverUrl}`);
```

- [ ] **Step 4: Update .github/workflows/release.yml**
In `release.yml`:
Pass `PEC_SERVER_URL=http://localhost:3000 npm run pack:extension` in verification, and rename the evaluation copy in `release-assets/` to `pec-extension-LOCALHOST-EVAL-v${VERSION}.zip`.

- [ ] **Step 5: Run tests and verify exit code**
Run: `npx tsx --test test/builder.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**
```bash
git add scripts/pack-extension.ts .github/workflows/release.yml test/builder.test.ts README.md
git commit -m "fix(pack): require explicit server URL in pack-extension and label evaluation release asset"
```

---

### Task 2: T2 (C1-b) - Template Placeholder Fail-Fast Guard in Service Worker

**Files:**
- Modify: `extension/background.js:18-35`
- Modify: `src/extensionTemplates.ts:25-45`
- Modify: `README.md`
- Test: `test/purity.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_SERVER_BASE` constant
- Produces: `console.error` diagnostic if placeholder `__PEC_` remains unsubstituted

- [ ] **Step 1: Write test for placeholder detection**
Add test in `test/purity.test.ts` asserting that evaluating `extension/background.js` logs a fatal error message when `DEFAULT_SERVER_BASE` contains `"__PEC_"`.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx tsx --test test/purity.test.ts`
Expected: FAIL

- [ ] **Step 3: Add guard in extension/background.js and src/extensionTemplates.ts**
```javascript
// Fail fast on un-substituted build placeholders (loaded extension/ instead of dist/unpacked)
if (DEFAULT_SERVER_BASE.indexOf("__PEC_") !== -1) {
  console.error(
    "[corp-proxy] FATAL: server URL placeholder was not substituted. " +
    "You probably loaded the raw extension/ template directory instead of the " +
    "built dist/unpacked/ output. Proxy sync is DISABLED."
  );
}
```

- [ ] **Step 4: Document in README.md**
Add prominent notice in `README.md` warning developers to load `dist/unpacked/` in `chrome://extensions` and never `extension/`.

- [ ] **Step 5: Run tests and verify**
Run: `npx tsx --test test/purity.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**
```bash
git add extension/background.js src/extensionTemplates.ts README.md test/purity.test.ts
git commit -m "fix(extension): add fail-fast guard for unsubstituted build placeholders"
```

---

### Task 3: T3 & T4 (C4) - Centralize Popup Templates & Log Terminal

**Files:**
- Modify: `src/extensionTemplates.ts`
- Modify: `src/packager.ts`
- Modify: `extension/popup.html`
- Modify: `extension/popup.js`
- Test: `test/purity.test.ts`

**Interfaces:**
- Produces: `renderPopupHtml(cfg: ExtensionBuildConfig)` and `renderPopupJs(cfg: ExtensionBuildConfig)` in `src/extensionTemplates.ts`
- Consumes: `renderPopupHtml`, `renderPopupJs` in `src/packager.ts`

- [ ] **Step 1: Write test verifying packaged popup includes log terminal and hooks**
In `test/purity.test.ts`, assert that `packageExtension()` produces `dist/unpacked/popup.html` containing `id="logContainer"` and `dist/unpacked/popup.js` containing `__pecLoadLogs`.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx tsx --test test/purity.test.ts`
Expected: FAIL

- [ ] **Step 3: Move and enrich popup templates in src/extensionTemplates.ts**
Define `renderPopupHtml(cfg)` and `renderPopupJs(cfg)` in `src/extensionTemplates.ts`, incorporating the diagnostics log terminal from `extension/popup.html` and handlers from `extension/popup.js`.

- [ ] **Step 4: Update src/packager.ts to use centralized templates**
Import `renderPopupHtml` and `renderPopupJs` in `src/packager.ts` and delegate `generateExtensionFiles` to them.

- [ ] **Step 5: Run tests and verify**
Run: `npx tsx --test test/purity.test.ts`
Expected: PASS (12/12)

- [ ] **Step 6: Commit**
```bash
git add src/extensionTemplates.ts src/packager.ts extension/popup.html extension/popup.js test/purity.test.ts
git commit -m "fix(builder): centralize popup templates in extensionTemplates with diagnostics log terminal"
```

---

### Task 4: T9 (H2) - Dynamic EXT_SHARED_TOKEN Precedence in Packager

**Files:**
- Modify: `src/packager.ts:1040-1065`
- Test: `test/builder.test.ts`

**Interfaces:**
- Consumes: `process.env.EXT_SHARED_TOKEN`
- Produces: Guaranteed override in `buildConfigToPack.defaultToken`

- [ ] **Step 1: Write test asserting EXT_SHARED_TOKEN overrides saved build config**
In `test/builder.test.ts`, test that if `data/extension_build_config.json` has `defaultToken: "stale-token"`, but `process.env.EXT_SHARED_TOKEN` is `"fresh-env-token"`, the packaged `background.js` contains `"fresh-env-token"`.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx tsx --test test/builder.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement environment token override in src/packager.ts**
```ts
  const buildConfigToPack: ExtensionBuildConfig = {
    ...currentBuildConfig,
    defaultServerUrl: effectiveBaseUrl,
    defaultToken: process.env.EXT_SHARED_TOKEN || currentBuildConfig.defaultToken,
  };

  if (process.env.EXT_SHARED_TOKEN && currentBuildConfig.defaultToken && currentBuildConfig.defaultToken !== process.env.EXT_SHARED_TOKEN) {
    console.warn(
      "[packager] Saved build-config defaultToken differs from EXT_SHARED_TOKEN - overriding with env value."
    );
  }
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx tsx --test test/builder.test.ts`
Expected: PASS

- [ ] **Step 5: Run full verification suite**
Run: `npm test && npm run build`
Expected: ALL PASS

- [ ] **Step 6: Commit**
```bash
git add src/packager.ts test/builder.test.ts
git commit -m "fix(packager): ensure EXT_SHARED_TOKEN environment variable overrides saved config"
```
