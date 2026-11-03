import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import express, { Request, Response, NextFunction } from "express";
import { fileURLToPath } from "node:url";
import { renderDashboardHtml } from "../src/views/dashboardView.js";
import { createAppBuilderRouter } from "../src/routes/appBuilderRoutes.js";
import { createTokenAuthMiddleware } from "../src/middleware/security.js";
import { getAppBuildConfig } from "../src/appPackager.js";
import { TEST_TOKEN, TEST_ADMIN_TOKEN } from "./helpers/setup.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function setupApp() {
  const app = express();
  app.use(express.json());
  const adminAuth = createTokenAuthMiddleware(() => TEST_ADMIN_TOKEN, "x-admin-token");
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    return adminAuth(req, res, next);
  });
  const router = createAppBuilderRouter(
    () => TEST_TOKEN,
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

test("Dashboard Theme Modes & Corporate Sync UI elements exist", () => {
  const html = renderDashboardHtml({});

  // Brand header icon
  assert.ok(html.includes('id="dashboardBrandIcon"'), 'dashboardBrandIcon must exist');

  // Customization popover: Light / Dark Mode Switcher
  assert.ok(html.includes('id="optModeDarkCard"'), 'optModeDarkCard must exist');
  assert.ok(html.includes('id="optModeLightCard"'), 'optModeLightCard must exist');
  assert.ok(html.includes('setServerThemeMode(\'dark\')'), 'Dark mode click handler must exist');
  assert.ok(html.includes('setServerThemeMode(\'light\')'), 'Light mode click handler must exist');

  // Global Brand Icon & Sync Checkbox
  assert.ok(html.includes('id="globalBrandIconSelect"'), 'globalBrandIconSelect must exist');
  assert.ok(html.includes('id="chkSyncThemeWithApps"'), 'chkSyncThemeWithApps must exist');
  assert.ok(html.includes('toggleSyncThemeWithApps(this.checked)'), 'toggleSyncThemeWithApps call must exist');

  // Lock banners in constructors
  assert.ok(html.includes('id="builderThemeLockedNotice"'), 'builderThemeLockedNotice must exist');
  assert.ok(html.includes('id="builderThemeCardContainer"'), 'builderThemeCardContainer must exist');
  assert.ok(html.includes('id="appThemeLockedNotice"'), 'appThemeLockedNotice must exist');
  assert.ok(html.includes('id="appThemeCardContainer"'), 'appThemeCardContainer must exist');

  // App Studio server sync interval setting
  assert.ok(html.includes('id="appSyncIntervalMinutes"'), 'appSyncIntervalMinutes must exist in App Studio');
});

test("CSS styles for light theme mode and lock state are defined", () => {
  const css = fs.readFileSync(path.join(__dirname, "../public/dashboard.css"), "utf-8");

  assert.ok(css.includes('body[data-theme-mode="light"]'), 'CSS must define body[data-theme-mode="light"]');
  assert.ok(css.includes('.theme-sync-lock-banner'), 'CSS must define .theme-sync-lock-banner');
  assert.ok(css.includes('.locked-by-sync'), 'CSS must define .locked-by-sync');
  assert.ok(css.includes('max-height: calc(100vh - 80px)'), 'Popover must have max-height constraint');
});

test("dashboard.js exports and functions for theme mode and sync are defined", () => {
  const js = fs.readFileSync(path.join(__dirname, "../public/dashboard.js"), "utf-8");

  assert.ok(js.includes('function setServerThemeMode('), 'setServerThemeMode function must exist');
  assert.ok(js.includes('function setGlobalBrandIcon('), 'setGlobalBrandIcon function must exist');
  assert.ok(js.includes('function toggleSyncThemeWithApps('), 'toggleSyncThemeWithApps function must exist');
  assert.ok(js.includes('function applyThemeSyncToConstructors('), 'applyThemeSyncToConstructors function must exist');
  assert.ok(js.includes('window.setServerThemeMode = setServerThemeMode'), 'window export for setServerThemeMode must exist');
  assert.ok(js.includes('window.setGlobalBrandIcon = setGlobalBrandIcon'), 'window export for setGlobalBrandIcon must exist');
  assert.ok(js.includes('window.toggleSyncThemeWithApps = toggleSyncThemeWithApps'), 'window export for toggleSyncThemeWithApps must exist');
  assert.ok(js.includes('window.applyThemeSyncToConstructors = applyThemeSyncToConstructors'), 'window export for applyThemeSyncToConstructors must exist');
});

test("appBuilderRoutes: validates and persists syncIntervalMinutes", async () => {
  await withTestServer(async (baseUrl) => {
    // 1. Rejects non-numeric syncIntervalMinutes
    const badRes = await fetch(`${baseUrl}/api/app-builder/config`, {
      method: "POST",
      headers: {
        "x-admin-token": TEST_ADMIN_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        syncIntervalMinutes: -5,
      }),
    });
    assert.equal(badRes.status, 400);

    // 2. Rejects > 1440
    const tooHighRes = await fetch(`${baseUrl}/api/app-builder/config`, {
      method: "POST",
      headers: {
        "x-admin-token": TEST_ADMIN_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        syncIntervalMinutes: 2000,
      }),
    });
    assert.equal(tooHighRes.status, 400);

    // 3. Valid syncIntervalMinutes
    const validRes = await fetch(`${baseUrl}/api/app-builder/config`, {
      method: "POST",
      headers: {
        "x-admin-token": TEST_ADMIN_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        syncIntervalMinutes: 30,
      }),
    });
    assert.equal(validRes.status, 200);
    const body = await validRes.json();
    assert.equal(body.ok, true);
    assert.equal(body.syncIntervalMinutes, 30);

    // Verify persisted
    const cfg = getAppBuildConfig();
    assert.equal(cfg.syncIntervalMinutes, 30);
  });
});
