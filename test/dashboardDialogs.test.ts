import "./helpers/setup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { setupDashboardDom } from "./helpers/dashboardDom.js";

const dashboardJsPath = path.resolve("public/dashboard.js");
const dashboardCssPath = path.resolve("public/dashboard.css");

test("D-DIALOG-01: public/dashboard.js defines window.pecConfirm and window.pecPrompt", () => {
  const js = fs.readFileSync(dashboardJsPath, "utf8");
  assert.match(js, /function\s+pecConfirm\b|window\.pecConfirm\s*=/);
  assert.match(js, /function\s+pecPrompt\b|window\.pecPrompt\s*=/);
  assert.match(js, /window\.pecConfirm\s*=\s*pecConfirm/);
  assert.match(js, /window\.pecPrompt\s*=\s*pecPrompt/);
});

test("D-DIALOG-02: public/dashboard.js contains no unmediated alert(), confirm(), prompt() calls", () => {
  const rawJs = fs.readFileSync(dashboardJsPath, "utf8");
  // Strip comments and strings/templates to isolate executable invocations
  const stripped = rawJs.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");

  // Match alert(, confirm(, prompt(, window.alert(, window.confirm(, window.prompt(
  const invocationRegex = /(?:^|[^\w$.])(window\.)?(alert|confirm|prompt)\s*\(/g;
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = invocationRegex.exec(stripped)) !== null) {
    matches.push(m[0].trim());
  }

  assert.deepEqual(
    matches,
    [],
    `Found unmediated browser dialog calls in dashboard.js: ${matches.join(", ")}`
  );
});

test("D-DIALOG-03: public/dashboard.css defines .pec-dialog styles and theme/layout adapters", () => {
  const css = fs.readFileSync(dashboardCssPath, "utf8");
  assert.ok(css.includes(".pec-dialog"), "dashboard.css must define .pec-dialog");
  assert.ok(css.includes(".pec-dialog::backdrop") || css.includes(".pec-dialog:backdrop"), "dashboard.css must define backdrop styling");
  assert.ok(css.includes('data-layout="terminal"') && css.includes(".pec-dialog"), "terminal layout must style .pec-dialog (radius 0)");
  assert.ok(css.includes('data-layout="console"') && css.includes(".pec-dialog"), "console layout must style .pec-dialog");
});

test("D-DIALOG-04: pecConfirm and pecPrompt create <dialog id='pecModalDialog'> with ARIA and resolve correctly", async () => {
  const env = setupDashboardDom({ autoEval: true });
  try {
    const win = env.window;
    assert.equal(typeof win.pecConfirm, "function", "window.pecConfirm must be a function");
    assert.equal(typeof win.pecPrompt, "function", "window.pecPrompt must be a function");

    // 1. Test pecConfirm - Confirm action
    const confirmPromise = win.pecConfirm("Are you sure you want to test?", {
      title: "Test Confirm",
      isDanger: true,
      confirmText: "Yes, proceed",
      cancelText: "No, cancel",
    });

    const dialog = env.document.getElementById("pecModalDialog") as HTMLElement;
    assert.ok(dialog, "<dialog id='pecModalDialog'> must be created in the DOM");
    assert.equal(dialog.getAttribute("role"), "dialog");
    assert.equal(dialog.getAttribute("aria-modal"), "true");

    const titleEl = env.document.getElementById("pecDialogTitle");
    assert.ok(titleEl && titleEl.textContent?.includes("Test Confirm"), "Title must be set");

    const messageEl = env.document.getElementById("pecDialogMessage");
    assert.ok(messageEl && messageEl.textContent?.includes("Are you sure you want to test?"), "Message must be set");

    const confirmBtn = env.document.getElementById("pecDialogConfirmBtn") as HTMLButtonElement;
    assert.ok(confirmBtn && confirmBtn.classList.contains("btn-danger"), "Confirm button must have btn-danger for isDanger");
    assert.equal(confirmBtn.textContent, "Yes, proceed");

    const cancelBtn = env.document.getElementById("pecDialogCancelBtn") as HTMLButtonElement;
    assert.equal(cancelBtn.textContent, "No, cancel");

    // Click confirm
    confirmBtn.click();
    const confirmResult = await confirmPromise;
    assert.equal(confirmResult, true, "Confirm click must resolve to true");

    // 2. Test pecConfirm - Cancel action
    const cancelPromise = win.pecConfirm("Another question?");
    const cancelBtn2 = env.document.getElementById("pecDialogCancelBtn") as HTMLButtonElement;
    cancelBtn2.click();
    const cancelResult = await cancelPromise;
    assert.equal(cancelResult, false, "Cancel click must resolve to false");

    // 3. Test pecConfirm - Escape key
    const escapePromise = win.pecConfirm("Escape question?");
    const escEvent = new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    dialog.dispatchEvent(escEvent);
    const escapeResult = await escapePromise;
    assert.equal(escapeResult, false, "Escape must resolve to false");

    // 4. Test pecPrompt - Input submit
    const promptPromise = win.pecPrompt("Please input profile name:", "Default Profile", {
      title: "New Profile",
      placeholder: "Profile name...",
    });
    const promptInput = env.document.getElementById("pecDialogInput") as HTMLInputElement;
    assert.ok(promptInput, "Prompt input must exist");
    assert.equal(promptInput.value, "Default Profile", "Prompt input must have defaultValue");

    promptInput.value = "Updated Profile";
    const promptConfirmBtn = env.document.getElementById("pecDialogConfirmBtn") as HTMLButtonElement;
    promptConfirmBtn.click();
    const promptResult = await promptPromise;
    assert.equal(promptResult, "Updated Profile", "Prompt confirm must resolve to input value");

    // 5. Test pecPrompt - Cancel action
    const promptCancelPromise = win.pecPrompt("Prompt cancel test:", "Initial");
    const promptCancelBtn = env.document.getElementById("pecDialogCancelBtn") as HTMLButtonElement;
    promptCancelBtn.click();
    const promptCancelResult = await promptCancelPromise;
    assert.equal(promptCancelResult, null, "Prompt cancel must resolve to null");
  } finally {
    env.teardown();
  }
});
