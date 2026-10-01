import test from "node:test";
import assert from "node:assert/strict";
import { renderDashboardHtml } from "../src/views/dashboardView.js";

test("Geobase Inspector and Import Presets modals are top-level under body and not inside modalProxyForm", () => {
  const html = renderDashboardHtml({ isDefaultTokenInUse: false, port: 8080 });
  
  // modalProxyForm closing tag must occur before modalGeobaseInspector
  const proxyFormIndex = html.indexOf('id="modalProxyForm"');
  const geobaseInspectorIndex = html.indexOf('id="modalGeobaseInspector"');
  const importPresetsIndex = html.indexOf('id="modalImportPresets"');

  assert.ok(proxyFormIndex !== -1, "modalProxyForm exists");
  assert.ok(geobaseInspectorIndex !== -1, "modalGeobaseInspector exists");
  assert.ok(importPresetsIndex !== -1, "modalImportPresets exists");

  // Extract snippet between proxyForm and geobaseInspector to confirm proxyForm is closed
  const proxyFormSnippet = html.slice(proxyFormIndex, geobaseInspectorIndex);
  // Must contain closing div for modal-content and modal-overlay
  assert.ok(proxyFormSnippet.includes('</form>'), "Proxy form has closed form tag");
  assert.ok(proxyFormSnippet.includes('</div>\n  </div>') || proxyFormSnippet.includes('</div></div>'), "Proxy form closes dialog and overlay");

  // Also verify geobase inspector is closed before import presets
  const geobaseSnippet = html.slice(geobaseInspectorIndex, importPresetsIndex);
  assert.ok(geobaseSnippet.includes('</div>\n  </div>') || geobaseSnippet.includes('</div></div>'), "Geobase inspector closes dialog and overlay");
});

test("renderDashboardHtml works with empty options", () => {
  const html = renderDashboardHtml({});
  assert.ok(html.includes('id="modalProxyForm"'));
  assert.ok(html.includes('id="modalGeobaseInspector"'));
  assert.ok(html.includes('id="modalImportPresets"'));
});

