import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express, { Request, Response } from "express";
import { renderInstallCmd, renderUninstallCmd, escapeCmdArg } from "../src/appPackager.js";
import { createAppBuilderRouter } from "../src/routes/appBuilderRoutes.js";
import { packageExtension, renderBackgroundJs, saveBuildConfig, SEMVER_REGEX } from "../src/packager.js";
import { BACKGROUND_TEMPLATE } from "../src/templates/backgroundTemplate.js";
import { getReleasesDir } from "../src/storage.js";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const TEST_ADMIN_TOKEN = "test-admin-secret-token";

function setupApp() {
  const app = express();
  app.use(express.json());
  const router = createAppBuilderRouter(
    () => "fleet-token",
    () => TEST_ADMIN_TOKEN
  );
  app.use(router);
  return app;
}

async function withTestServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = setupApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    return await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// -----------------------------------------------------------------------------
// H-3: App Name Escaping & Validation
// -----------------------------------------------------------------------------

test("H-3: escapeCmdArg strips cmd injection characters and parentheses", () => {
  assert.equal(typeof escapeCmdArg, "function");
  const dangerous = 'My Corp (v2) & calc.exe | notepad.exe && echo "pwned" ^ < > %PATH% !VAR!';
  const escaped = escapeCmdArg(dangerous);
  assert.equal(escaped.includes("&"), false);
  assert.equal(escaped.includes("|"), false);
  assert.equal(escaped.includes("<"), false);
  assert.equal(escaped.includes(">"), false);
  assert.equal(escaped.includes("^"), false);
  assert.equal(escaped.includes('"'), false);
  assert.equal(escaped.includes("%"), false);
  assert.equal(escaped.includes("!"), false);
  assert.equal(escaped.includes("("), false);
  assert.equal(escaped.includes(")"), false);
  assert.equal(escapeCmdArg("&&&"), "");
  assert.equal(escapeCmdArg("   "), "");
  assert.equal(escapeCmdArg(undefined as any), "");
});

test("H-3: renderInstallCmd and renderUninstallCmd escape special characters and parentheses in cfg.name", () => {
  const dangerousConfig = {
    name: 'Corp (Prod) & calc.exe & echo "hack"',
    version: "1.0.0",
  } as any;

  const installScript = renderInstallCmd(dangerousConfig);
  assert.equal(installScript.includes("& calc.exe"), false);
  assert.equal(installScript.includes('"hack"'), false);
  assert.equal(installScript.includes("(Prod)"), false);
  assert.match(installScript, /\[Corp\s+Prod\s+calc\.exe\s+echo\s+hack\]/);

  const uninstallScript = renderUninstallCmd(dangerousConfig);
  assert.equal(uninstallScript.includes("& calc.exe"), false);
  assert.equal(uninstallScript.includes('"hack"'), false);
  assert.equal(uninstallScript.includes("(Prod)"), false);
  assert.match(uninstallScript, /\[Corp\s+Prod\s+calc\.exe\s+echo\s+hack\]/);

  // Fallback to PEC-App when name consists entirely of stripped characters or is empty
  const emptyConfig = { name: "&&& ||| ()", version: "1.0.0" } as any;
  assert.match(renderInstallCmd(emptyConfig), /echo\s+PEC-App 1-Click/);
  assert.match(renderUninstallCmd(emptyConfig), /echo\s+PEC-App 1-Click/);

  // Safe against null/empty cfg object
  assert.match(renderInstallCmd({} as any), /echo\s+PEC-App 1-Click/);
  assert.match(renderUninstallCmd({} as any), /echo\s+PEC-App 1-Click/);
});

test("H-3: appBuilderRoutes rejects invalid app names, trims version, and accepts valid names", async () => {
  await withTestServer(async (baseUrl) => {
    // 1. Invalid names: command injection characters
    const resBadChar = await fetch(`${baseUrl}/api/app-builder/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "PEC & calc.exe" }),
    });
    assert.equal(resBadChar.status, 400);
    const bodyBadChar = await resBadChar.json();
    assert.equal(bodyBadChar.ok, false);

    // 2. Invalid name: empty string
    const resEmpty = await fetch(`${baseUrl}/api/app-builder/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    assert.equal(resEmpty.status, 400);

    // 3. Invalid name: too long (>64 chars)
    const resLong = await fetch(`${baseUrl}/api/app-builder/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "A".repeat(65) }),
    });
    assert.equal(resLong.status, 400);

    // 4. Valid name: alphanumeric with spaces, dots, dashes, underscores up to 64 chars
    const resValid = await fetch(`${baseUrl}/api/app-builder/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "PEC-App_Corp.Client 2.0" }),
    });
    assert.equal(resValid.status, 200);
    const bodyValid = await resValid.json();
    assert.equal(bodyValid.name, "PEC-App_Corp.Client 2.0");

    // 5. Version with surrounding whitespace gets trimmed before saving
    const resVerTrim = await fetch(`${baseUrl}/api/app-builder/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: " 2.3.4 " }),
    });
    assert.equal(resVerTrim.status, 200);
    const bodyVerTrim = await resVerTrim.json();
    assert.equal(bodyVerTrim.version, "2.3.4");
  });
});

// -----------------------------------------------------------------------------
// H-4: allowUserBypass Propagation & SET_ENABLED Gating
// -----------------------------------------------------------------------------

test("H-4: renderBackgroundJs replaces PEC_ALLOW_MANUAL_BYPASS with false when allowUserBypass is false", () => {
  const renderedFalse = renderBackgroundJs({ allowUserBypass: false });
  assert.match(renderedFalse, /const PEC_ALLOW_MANUAL_BYPASS = false;/);
  assert.equal(renderedFalse.includes("/* __PEC_ALLOW_MANUAL_BYPASS__ */"), false);

  const renderedTrue = renderBackgroundJs({ allowUserBypass: true });
  assert.match(renderedTrue, /const PEC_ALLOW_MANUAL_BYPASS = true;/);
  assert.equal(renderedTrue.includes("/* __PEC_ALLOW_MANUAL_BYPASS__ */"), false);
});

test("H-4: backgroundTemplate and extension/background.js gate SET_ENABLED when !PEC_ALLOW_MANUAL_BYPASS", () => {
  const templateSrc = BACKGROUND_TEMPLATE;
  const extBgPath = path.resolve("./extension/background.js");
  const extSrc = fs.readFileSync(extBgPath, "utf-8");

  // Check both template and extension have the policy check and error message
  assert.match(templateSrc, /Manual proxy bypass is disabled by policy/);
  assert.match(extSrc, /Manual proxy bypass is disabled by policy/);

  // Behavior test using VM to simulate the message handler in background script
  function runSetEnabledAction(bypassAllowed: boolean, msg: Record<string, any>, initialState = { enabled: true }) {
    let response: any = null;
    const sendResponse = (r: any) => { response = r; };

    const sandbox: any = {
      PEC_ALLOW_MANUAL_BYPASS: bypassAllowed,
      currentProxyState: { ...initialState },
      persistProxyState: () => {},
      applyProxySettings: async () => {},
      updateActiveTabBadge: () => {},
      logEvent: () => {},
      chrome: {
        storage: {
          local: {
            set: async () => {},
          },
        },
      },
      msg,
      sendResponse,
    };

    // Extract the complete SET_ENABLED block from extension/background.js
    const startIndex = extSrc.indexOf('if (action === "SET_ENABLED") {');
    const endIndex = extSrc.indexOf('if (action === "GET_LOGS") {');
    assert.ok(startIndex !== -1 && endIndex !== -1, "Could not locate SET_ENABLED handler block");
    const handlerBlock = extSrc.slice(startIndex, endIndex);
    const setEnabledCode = `(function() {\n  const action = msg.action || msg.type;\n  ${handlerBlock}\n})()`;

    vm.createContext(sandbox);
    vm.runInContext(setEnabledCode, sandbox);
    return { response, state: sandbox.currentProxyState };
  }

  // 1. Explicit disable: { action: "SET_ENABLED", enabled: false }
  const blockedExplicit = runSetEnabledAction(false, { action: "SET_ENABLED", enabled: false });
  assert.equal(blockedExplicit.response?.ok, false);
  assert.equal(blockedExplicit.response?.error, "Manual proxy bypass is disabled by policy");
  assert.equal(blockedExplicit.state.enabled, true); // state remains enabled

  // 2. String false: { action: "SET_ENABLED", enabled: "false" }
  const blockedStringFalse = runSetEnabledAction(false, { action: "SET_ENABLED", enabled: "false" });
  assert.equal(blockedStringFalse.response?.ok, false);
  assert.equal(blockedStringFalse.response?.error, "Manual proxy bypass is disabled by policy");
  assert.equal(blockedStringFalse.state.enabled, true);

  // 3. Toggle path: omitted msg.enabled when current state is enabled -> attempts to disable -> blocked!
  const blockedToggle = runSetEnabledAction(false, { action: "SET_ENABLED" }, { enabled: true });
  assert.equal(blockedToggle.response?.ok, false);
  assert.equal(blockedToggle.response?.error, "Manual proxy bypass is disabled by policy");
  assert.equal(blockedToggle.state.enabled, true);

  // 4. Using msg.type instead of msg.action
  const blockedType = runSetEnabledAction(false, { type: "SET_ENABLED", enabled: false });
  assert.equal(blockedType.response?.ok, false);
  assert.equal(blockedType.response?.error, "Manual proxy bypass is disabled by policy");

  // 5. Enabling proxy when disabled: { action: "SET_ENABLED", enabled: true } -> allowed!
  const allowedEnable = runSetEnabledAction(false, { action: "SET_ENABLED", enabled: true }, { enabled: false });
  assert.notEqual(allowedEnable.response?.error, "Manual proxy bypass is disabled by policy");
  assert.equal(allowedEnable.state.enabled, true);

  // 6. Toggle from disabled to enabled: omitted msg.enabled when current state is disabled -> allowed!
  const allowedToggleOn = runSetEnabledAction(false, { action: "SET_ENABLED" }, { enabled: false });
  assert.notEqual(allowedToggleOn.response?.error, "Manual proxy bypass is disabled by policy");
  assert.equal(allowedToggleOn.state.enabled, true);

  // 7. When bypass is allowed, disabling proxy succeeds
  const allowed = runSetEnabledAction(true, { action: "SET_ENABLED", enabled: false });
  assert.notEqual(allowed.response?.error, "Manual proxy bypass is disabled by policy");
});

// -----------------------------------------------------------------------------
// M-10: Path Traversal in Version Validation
// -----------------------------------------------------------------------------

test("M-10: SEMVER_REGEX is exported and validates semver format correctly", () => {
  assert.ok(SEMVER_REGEX instanceof RegExp);
  assert.equal(SEMVER_REGEX.test("1.0.0"), true);
  assert.equal(SEMVER_REGEX.test("2.1.4-beta.1"), true);
  assert.equal(SEMVER_REGEX.test("../../etc/passwd"), false);
  assert.equal(SEMVER_REGEX.test("..\\..\\evil"), false);
  assert.equal(SEMVER_REGEX.test("1.0"), false);
  assert.equal(SEMVER_REGEX.test("v1.0.0"), false);
});

test("M-10: packageExtension rejects path traversal in version and sanitizes whitespace", () => {
  // Test directory traversal in version
  saveBuildConfig({ version: "../../evil_dir" });
  assert.throws(
    () => {
      packageExtension();
    },
    (err: any) => {
      return /invalid version format/i.test(err?.message || "");
    }
  );

  // Test whitespace-padded version is sanitized to clean version without creating space-padded dir
  saveBuildConfig({ version: " 1.4.1 " });
  const result = packageExtension();
  assert.equal(result.version, "1.4.1");

  const releasesDir = path.join(getReleasesDir(), "extensions");
  const entries = fs.readdirSync(releasesDir);
  assert.equal(entries.includes(" 1.4.1 "), false, "Must not create directory with leading/trailing spaces");
  assert.equal(entries.includes("1.4.1"), true, "Must create clean semver directory");

  // Clean up test release
  try {
    fs.rmSync(path.join(releasesDir, "1.4.1"), { recursive: true, force: true });
  } catch {}

  // Restore valid default version
  saveBuildConfig({ version: "1.0.0" });
});
