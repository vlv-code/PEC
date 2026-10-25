import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { BACKGROUND_TEMPLATE } from "../src/templates/backgroundTemplate.js";
import { renderDashboardHtml } from "../src/views/dashboardView.js";

test("background.js and template implement Omaha auto-update check and reload listener", () => {
  const bgJs = fs.readFileSync("extension/background.js", "utf8");

  // Check BACKGROUND_TEMPLATE
  assert.ok(BACKGROUND_TEMPLATE.includes("chrome.runtime.onUpdateAvailable"), "BACKGROUND_TEMPLATE must listen to onUpdateAvailable");
  assert.ok(BACKGROUND_TEMPLATE.includes("chrome.runtime.reload()"), "BACKGROUND_TEMPLATE must reload when onUpdateAvailable fires");
  assert.ok(BACKGROUND_TEMPLATE.includes("chrome.runtime.requestUpdateCheck"), "BACKGROUND_TEMPLATE must call requestUpdateCheck");
  assert.ok(BACKGROUND_TEMPLATE.includes("checkForExtensionUpdates(true)"), "BACKGROUND_TEMPLATE must check updates on FORCE_SYNC");
  assert.ok(BACKGROUND_TEMPLATE.includes("checkForExtensionUpdates(false)"), "BACKGROUND_TEMPLATE must check updates on startup");

  // Check extension/background.js file
  assert.ok(bgJs.includes("chrome.runtime.onUpdateAvailable"), "extension/background.js must listen to onUpdateAvailable");
  assert.ok(bgJs.includes("chrome.runtime.reload()"), "extension/background.js must reload when onUpdateAvailable fires");
  assert.ok(bgJs.includes("chrome.runtime.requestUpdateCheck"), "extension/background.js must call requestUpdateCheck");
  assert.ok(bgJs.includes("checkForExtensionUpdates(true)"), "extension/background.js must check updates on FORCE_SYNC");
});

test("dashboardView renders modalEditRule with all required form controls", () => {
  const html = renderDashboardHtml({ csrfToken: "csrf-test" });

  assert.ok(html.includes('id="modalEditRule"'), "modalEditRule must be present in dashboardView");
  assert.ok(html.includes('id="editRuleIndex"'), "editRuleIndex hidden input must be present");
  assert.ok(html.includes('id="editRuleName"'), "editRuleName input must be present");
  assert.ok(html.includes('id="editRulePattern"'), "editRulePattern input must be present");
  assert.ok(html.includes('id="editRuleAction"'), "editRuleAction select must be present");
  assert.ok(html.includes('id="btnSaveEditedRule"'), "btnSaveEditedRule button must be present");
  assert.ok(html.includes('id="btnCancelEditRule"'), "btnCancelEditRule button must be present");
});

test("dashboard.js implements rule editing UI and handlers", () => {
  const js = fs.readFileSync("public/dashboard.js", "utf8");

  // Check translations
  assert.ok(js.includes("titleEditRule: 'Edit Routing Rule'"), "EN dictionary must include titleEditRule");
  assert.ok(js.includes("titleEditRule: 'Редактировать правило маршрутизации'"), "RU dictionary must include titleEditRule");

  // Check renderRules has edit button
  assert.ok(js.includes("btn-edit-rule"), "renderRules must render .btn-edit-rule");
  assert.ok(js.includes("openEditRuleModal"), "dashboard.js must define openEditRuleModal");
  assert.ok(js.includes("closeEditRuleModal"), "dashboard.js must define closeEditRuleModal");
  assert.ok(js.includes("saveEditedRule"), "dashboard.js must define saveEditedRule");

  // Test functional logic of openEditRuleModal and saveEditedRule
  const domElements: Record<string, any> = {
    modalEditRule: { style: { display: "none" } },
    editRuleIndex: { value: "" },
    editRuleName: { value: "" },
    editRulePattern: { value: "" },
    editRuleAction: { value: "" },
    editRuleError: { style: { display: "none" }, textContent: "" },
    rulesTableBody: { innerHTML: "" },
  };

  const currentProfile = {
    id: "prof_test",
    name: "Test Profile",
    rules: [
      { id: "r1", name: "Old Rule", pattern: "old.example.com", action: "direct", enabled: true, targetType: "wildcard" },
      { id: "r2", name: "Preset Rule", pattern: "preset:ai", action: "proxy", enabled: true, targetType: "preset" },
    ],
  };

  let unsavedRouting = false;
  const setUnsavedRouting = (v: boolean) => { unsavedRouting = v; };
  const toast = () => {};
  const esc = (s: string) => s;
  const currentLang = "ru";

  const win: any = {};
  const doc = {
    getElementById: (id: string) => domElements[id] || { value: "", style: {} },
    addEventListener: () => {},
  };

  // Extract functions
  const fnsCode = js.substring(js.indexOf("function openEditRuleModal"), js.indexOf("function addPresetRule"));
  const context = new Function(
    "currentProfile",
    "document",
    "currentLang",
    "setUnsavedRouting",
    "toast",
    "renderRules",
    `${fnsCode}; return { openEditRuleModal, closeEditRuleModal, saveEditedRule };`
  )(currentProfile, doc, currentLang, setUnsavedRouting, toast, () => {});

  const { openEditRuleModal: openFn, saveEditedRule: saveFn } = context;

  // 1. Open edit modal for rule index 0
  openFn(0);
  assert.equal(domElements.editRuleIndex.value, "0");
  assert.equal(domElements.editRuleName.value, "Old Rule");
  assert.equal(domElements.editRulePattern.value, "old.example.com");
  assert.equal(domElements.editRuleAction.value, "direct");
  assert.equal(domElements.modalEditRule.style.display, "flex");

  // 2. Modify values in DOM
  domElements.editRuleName.value = "Updated Domain Rule";
  domElements.editRulePattern.value = "new.example.com, api.new.com";
  domElements.editRuleAction.value = "proxy";

  // 3. Save edited rule
  saveFn();
  assert.equal(currentProfile.rules[0].name, "Updated Domain Rule");
  assert.equal(currentProfile.rules[0].pattern, "new.example.com, api.new.com");
  assert.equal(currentProfile.rules[0].action, "proxy");
  assert.equal(currentProfile.rules[0].targetType, "wildcard");
  assert.equal(unsavedRouting, true, "setUnsavedRouting must be marked true");
  assert.equal(domElements.modalEditRule.style.display, "none", "modal must be closed after save");
});
