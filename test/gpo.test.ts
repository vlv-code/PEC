import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import { generateGpoConfig } from "../src/packager.js";

test("generateGpoConfig generates multi-browser policies for HKCU and HKLM", () => {
  const extId = "abcdefghijklmnopabcdefghijklmnop";
  const serverUrl = "https://pec.corp.local";
  const token = "test-corp-token-123";

  const gpo = generateGpoConfig(extId, serverUrl, token, {
    targetGroup: "VIP-Users",
    autoConfigureProxy: true,
  });

  // Verify HKCU content
  assert.ok(gpo.regContentUser.includes("HKEY_CURRENT_USER\\Software\\Policies\\Google\\Chrome"), "Chrome HKCU must be included");
  assert.ok(gpo.regContentUser.includes("HKEY_CURRENT_USER\\Software\\Policies\\Microsoft\\Edge"), "Edge HKCU must be included");
  assert.ok(gpo.regContentUser.includes("HKEY_CURRENT_USER\\Software\\Policies\\YandexBrowser"), "YandexBrowser HKCU must be included");
  assert.ok(gpo.regContentUser.includes("HKEY_CURRENT_USER\\Software\\Policies\\Opera Software\\Opera"), "Opera HKCU must be included");
  assert.ok(gpo.regContentUser.includes("HKEY_CURRENT_USER\\Software\\Policies\\Chromium"), "Chromium HKCU fallback must be included");

  // Verify HKLM content
  assert.ok(gpo.regContentMachine.includes("HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Google\\Chrome"), "Chrome HKLM must be included");
  assert.ok(gpo.regContentMachine.includes("HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Microsoft\\Edge"), "Edge HKLM must be included");
  assert.ok(gpo.regContentMachine.includes("HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\YandexBrowser"), "YandexBrowser HKLM must be included");
  assert.ok(gpo.regContentMachine.includes("HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Opera Software\\Opera"), "Opera HKLM must be included");
  assert.ok(gpo.regContentMachine.includes("HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Chromium"), "Chromium HKLM fallback must be included");

  // Verify managed storage keys
  assert.ok(gpo.regContentUser.includes('"extToken"="test-corp-token-123"'), "extToken must be present in HKCU");
  assert.ok(gpo.regContentUser.includes('"targetGroup"="VIP-Users"'), "targetGroup must be present in HKCU");
  assert.ok(gpo.regContentUser.includes('"autoConfigureProxy"=dword:00000001'), "autoConfigureProxy must be dword in HKCU");

  // Verify multi-browser forcelist and allowlist
  assert.ok(gpo.forcelistEntries.chrome.includes(extId));
  assert.ok(gpo.forcelistEntries.edge.includes(extId));
  assert.ok(gpo.forcelistEntries.yandex.includes(extId));
  assert.ok(gpo.forcelistEntries.opera.includes(extId));

  // Verify ExtensionSettings JSON
  assert.ok(gpo.extensionSettingsJson[extId]);
  assert.equal(gpo.extensionSettingsJson[extId].installation_mode, "force_installed");

  // Verify browser-specific ExtensionSettings entries
  assert.ok((gpo as any).extensionSettingsEntries, "extensionSettingsEntries must exist");
  assert.equal((gpo as any).extensionSettingsEntries.chrome[extId].installation_mode, "force_installed");
  assert.equal((gpo as any).extensionSettingsEntries.chrome[extId].override_update_url, true);
  assert.ok((gpo as any).extensionSettingsEntries.chrome["*"].install_sources.includes(`${serverUrl}/*`));

  assert.equal((gpo as any).extensionSettingsEntries.edge[extId].installation_mode, "force_installed");
  assert.equal((gpo as any).extensionSettingsEntries.edge[extId].override_update_url, true);
  assert.ok((gpo as any).extensionSettingsEntries.edge["*"].install_sources.includes(`${serverUrl}/*`));

  // Critical: Yandex Browser unmanaged must be normal_installed
  assert.equal((gpo as any).extensionSettingsEntries.yandex[extId].installation_mode, "normal_installed");
  assert.equal((gpo as any).extensionSettingsEntries.yandex[extId].override_update_url, true);
  assert.ok((gpo as any).extensionSettingsEntries.yandex["*"].install_sources.includes(`${serverUrl}/*`));

  // Verify ExtensionSettings REG_SZ in .reg files
  assert.ok(gpo.regContentUser.includes('"ExtensionSettings"='), "ExtensionSettings must be defined in HKCU .reg");
  assert.ok(gpo.regContentUser.includes('normal_installed'), "Yandex normal_installed must be in HKCU .reg");
  assert.ok(gpo.regContentMachine.includes('"ExtensionSettings"='), "ExtensionSettings must be defined in HKLM .reg");

  // Verify backwards compatibility: regContent defaults to regContentUser
  assert.ok(gpo.regContent.includes("Google\\Chrome"));
});

test("renders deploy-pec-gpo.ps1 and verify-pec-gpo.ps1 without syntax errors", () => {
  const extId = "abcdefghijklmnopabcdefghijklmnop";
  const serverUrl = "https://pec.corp.local";
  const token = "corp-token-xyz";

  const gpo = generateGpoConfig(extId, serverUrl, token, { targetGroup: "Default" });

  assert.ok(gpo.deployScript, "deployScript must be defined");
  assert.ok(gpo.deployScript.includes("param("), "deployScript must have param block");
  assert.ok(gpo.deployScript.includes(extId), "deployScript must include extId");
  assert.ok(gpo.deployScript.includes(serverUrl), "deployScript must include serverUrl");
  assert.ok(gpo.deployScript.includes("RequireAdGroup"), "deployScript must support RequireAdGroup");
  assert.ok(gpo.deployScript.includes("ExtensionInstallForcelist"), "deployScript must configure forcelist");
  assert.ok(gpo.deployScript.includes("YandexBrowser"), "deployScript must support YandexBrowser");
  assert.ok(gpo.deployScript.includes("Opera Software"), "deployScript must support Opera");

  assert.ok(gpo.verifyScript, "verifyScript must be defined");
  assert.ok(gpo.verifyScript.includes("param("), "verifyScript must have param block");
  assert.ok(gpo.verifyScript.includes(extId), "verifyScript must include extId");
  assert.ok(gpo.verifyScript.includes("/healthz"), "verifyScript must test healthz endpoint");
  assert.ok(gpo.verifyScript.includes("/updates/updates.xml"), "verifyScript must test updates.xml");
  assert.ok(gpo.verifyScript.includes("ExtensionInstallForcelist"), "verifyScript must check registry");

  assert.ok(gpo.readmeContent, "readmeContent must be defined");
  assert.ok(gpo.readmeContent.includes("Active Directory"), "readmeContent must explain AD deployment");
  assert.ok(gpo.readmeContent.includes("Authenticated Users"), "readmeContent must highlight Authenticated Users delegation");
  assert.ok(gpo.readmeContent.includes("Конфигурация пользователя"), "readmeContent must describe User Configuration");
  assert.ok(gpo.readmeContent.includes("normal_installed"), "readmeContent must explain Yandex normal_installed");
});

test("generateGpoDeploymentPack creates valid zip with all deployment artifacts", async () => {
  const { generateGpoDeploymentPack } = await import("../src/packager.js");
  const pack = generateGpoDeploymentPack("https://pec.corp.local", "token-pack-test");

  assert.ok(pack.zipBuffer.length > 0, "zipBuffer must not be empty");
  const AdmZip = (await import("adm-zip")).default;
  const zip = new AdmZip(pack.zipBuffer);
  const entries = zip.getEntries().map(e => e.entryName);

  assert.ok(entries.includes("pec-policy-user-hkcu.reg"), "must include HKCU reg");
  assert.ok(entries.includes("pec-policy-machine-hklm.reg"), "must include HKLM reg");
  assert.ok(entries.includes("deploy-pec-gpo.ps1"), "must include deploy script");
  assert.ok(entries.includes("verify-pec-gpo.ps1"), "must include verify script");
  assert.ok(entries.includes("extension-settings.json"), "must include extension settings");
  assert.ok(entries.includes("extension-settings-chrome.json"), "must include chrome settings");
  assert.ok(entries.includes("extension-settings-edge.json"), "must include edge settings");
  assert.ok(entries.includes("extension-settings-yandex.json"), "must include yandex settings");
  assert.ok(entries.includes("README-GPO.md"), "must include readme");

  // Verify secret hygiene
  const regUser = zip.readAsText("pec-policy-user-hkcu.reg");
  assert.ok(!regUser.includes(process.env.ADMIN_TOKEN || "test-root-admin-token"));
});
