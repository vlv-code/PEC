import test from "node:test";
import assert from "node:assert/strict";
import { renderDashboardHtml } from "../src/views/dashboardView.js";

test("Domain 3 A11y: 100% of <label> tags in renderDashboardHtml have a valid for attribute pointing to an element ID", () => {
  const html = renderDashboardHtml({});

  const labelTags = html.match(/<label\b[^>]*>/gi) || [];
  assert.ok(labelTags.length > 50, `Expected many label tags, found ${labelTags.length}`);

  const missingFor: string[] = [];
  const missingTarget: string[] = [];

  for (const label of labelTags) {
    const forMatch = label.match(/\bfor=[\"']([^\"']+)[\"']/i);
    if (!forMatch) {
      missingFor.push(label);
      continue;
    }
    const targetId = forMatch[1];
    const hasElementWithId = new RegExp(`id=[\"']${targetId}[\"']`, "i").test(html);
    if (!hasElementWithId) {
      missingTarget.push(`Label for="${targetId}" -> target id not found in HTML`);
    }
  }

  assert.equal(
    missingFor.length,
    0,
    `Found ${missingFor.length} <label> tags missing 'for' attribute:\n` + missingFor.slice(0, 10).join("\n")
  );

  assert.equal(
    missingTarget.length,
    0,
    `Found ${missingTarget.length} labels pointing to non-existent IDs:\n` + missingTarget.slice(0, 10).join("\n")
  );
});

test("Domain 3 i18n: navigation tabs have default Russian labels with preserved data-i18n", () => {
  const html = renderDashboardHtml({});

  const expectedTabs = [
    { id: "tabBtnRouting", i18n: "tabBtnRouting", text: "Маршрутизация и геобазы" },
    { id: "tabBtnProxySettings", i18n: "tabBtnProxySettings", text: "Настройки прокси" },
    { id: "tabBtnBuilder", i18n: "tabBtnBuilder", text: "Конструктор расширения" },
    { id: "tabBtnGpo", i18n: "tabBtnGpo", text: "Развертывание GPO" },
    { id: "tabBtnLogs", i18n: "tabBtnLogs", text: "Аудит и тестирование" },
  ];

  for (const tab of expectedTabs) {
    const buttonRegex = new RegExp(
      `<button[^>]*id=[\"']${tab.id}[\"'][^>]*data-i18n=[\"']${tab.i18n}[\"'][^>]*>([\\s\\S]*?)<\\/button>`,
      "i"
    );
    const match = html.match(buttonRegex);
    assert.ok(match, `Navigation button #${tab.id} with data-i18n="${tab.i18n}" must exist`);
    assert.ok(
      match[1].includes(tab.text),
      `Button #${tab.id} must contain Russian text "${tab.text}", found: "${match[1].trim()}"`
    );
  }
});

test("Domain 3 Grid Classes: inline grids and hardcoded colors replaced with CSS contract classes", () => {
  const html = renderDashboardHtml({});

  // Contract classes must be present
  assert.ok(html.includes("grid-routing-matrix-header"), "must use grid-routing-matrix-header");
  assert.ok(html.includes("grid-routing-rule-form"), "must use grid-routing-rule-form");
  assert.ok(html.includes("grid-builder-columns"), "must use grid-builder-columns");
  assert.ok(html.includes("grid-form-2col"), "must use grid-form-2col");
  assert.ok(html.includes("grid-form-3col"), "must use grid-form-3col");
  assert.ok(html.includes("grid-preview-traffic-row"), "must use grid-preview-traffic-row");

  // Old inline style grids must be eliminated
  assert.doesNotMatch(html, /grid-template-columns:\s*2fr 1fr 1fr/i);
  assert.doesNotMatch(html, /grid-template-columns:\s*2fr 3fr 1fr auto/i);
  assert.doesNotMatch(html, /grid-template-columns:\s*1\.25fr 1fr/i);
  assert.doesNotMatch(html, /grid-template-columns:\s*50px 70px 1fr 50px/i);

  // Hardcoded #94a3b8 should not appear in inline styles
  assert.doesNotMatch(html, /style=[\"'][^\"']*#94a3b8/i);
});
