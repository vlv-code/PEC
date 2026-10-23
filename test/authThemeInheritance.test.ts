import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { renderDashboardHtml } from "../src/views/dashboardView.js";

test("authScreen uses CSS variables and dynamic theme classes instead of hardcoded hex styles", () => {
  const html = renderDashboardHtml({});
  
  // 1. Initial body attributes
  assert.ok(
    html.includes('data-layout="console"') && html.includes('data-theme="cyber"'),
    "body should have default data-layout and data-theme attributes"
  );

  // 2. Auth screen backdrop and card modal classes
  assert.ok(
    html.includes('id="authScreen" class="auth-screen-backdrop"'),
    "authScreen must have auth-screen-backdrop class"
  );
  assert.ok(
    html.includes('class="auth-card-modal"'),
    "auth modal must have auth-card-modal class"
  );

  // 3. Inputs inside authScreen must use auth-input class
  assert.ok(
    html.includes('id="authTokenInput" class="auth-input"'),
    "authTokenInput must use auth-input class"
  );
  assert.ok(
    html.includes('id="loginUsernameInput" class="auth-input"'),
    "loginUsernameInput must use auth-input class"
  );

  // 4. CSS file defines theme inheritance and layout rules
  const css = fs.readFileSync(path.resolve("public/dashboard.css"), "utf8");
  assert.ok(css.includes(".auth-screen-backdrop"), "CSS must define .auth-screen-backdrop");
  assert.ok(css.includes(".auth-card-modal"), "CSS must define .auth-card-modal");
  assert.ok(css.includes('body[data-layout="terminal"] .auth-card-modal'), "CSS must define terminal layout override for auth card");
});

