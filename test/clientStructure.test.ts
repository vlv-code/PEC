import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

test("client and template directories exist with proper placeholders", () => {
  const root = process.cwd();
  assert.strictEqual(fs.existsSync(path.join(root, "client")), true, "client dir must exist");
  const winDir = path.join(root, "templates", "app", "windows");
  const linuxDir = path.join(root, "templates", "app", "linux");
  assert.strictEqual(fs.existsSync(winDir), true, "windows templates dir must exist");
  assert.strictEqual(fs.existsSync(linuxDir), true, "linux templates dir must exist");
  assert.strictEqual(fs.existsSync(path.join(root, "client", "README.md")), true, "client/README.md must exist");
  assert.strictEqual(fs.existsSync(path.join(winDir, "README.txt")), true, "windows README.txt must exist");
  assert.strictEqual(fs.existsSync(path.join(linuxDir, "README.txt")), true, "linux README.txt must exist");
});

test("CLI main.c implements corporate update check (Д-6) and explicit --update-github fallback (R-5)", () => {
  const root = process.cwd();
  const mainCPath = path.join(root, "client", "Windows", "cli", "main.c");
  assert.strictEqual(fs.existsSync(mainCPath), true, "main.c must exist");
  const content = fs.readFileSync(mainCPath, "utf-8");

  // Option --update-github exists in CLI args
  assert.match(content, /--update-github/, "main.c must support --update-github flag");

  // Help text mentions corporate PEC server for --update and public GitHub for --update-github
  assert.match(content, /--update\s+Check corporate PEC server for updates/i, "Help text must document corporate --update");
  assert.match(content, /--update-github\s+Check public GitHub repository for updates/i, "Help text must document --update-github");

  // Corporate update endpoint check (/api/releases/latest or /api/app/sync)
  assert.match(content, /\/api\/releases\/latest/, "main.c must query corporate server release endpoint");

  // Corporate server URL lookup (via --server, PecSync.serverUrl, or APPDATA profile)
  assert.match(content, /--server/, "main.c must support --server parameter for corporate server URL");
  assert.match(content, /PecSync/i, "main.c must check PecSync config for corporate serverUrl");
  assert.match(content, /APPDATA.*PEC-App/i, "main.c must check APPDATA standard profile location");
});

test("Windows GUI implements clipboard log copying, PB_WriteAppLog UI bridge, TLS 1.2/1.3, and server auto-heal", () => {
  const root = process.cwd();
  const mainImguiPath = path.join(root, "client", "Windows", "gui", "main_imgui.cpp");
  const profileCPath = path.join(root, "client", "Windows", "gui", "profile", "profile.c");
  const profileHPath = path.join(root, "client", "Windows", "gui", "profile", "profile.h");
  const pecSyncPath = path.join(root, "client", "Windows", "gui", "ui", "pec_sync.h");

  assert.strictEqual(fs.existsSync(mainImguiPath), true, "main_imgui.cpp must exist");
  assert.strictEqual(fs.existsSync(profileCPath), true, "profile.c must exist");
  assert.strictEqual(fs.existsSync(profileHPath), true, "profile.h must exist");
  assert.strictEqual(fs.existsSync(pecSyncPath), true, "pec_sync.h must exist");

  const imguiContent = fs.readFileSync(mainImguiPath, "utf-8");
  const profileCContent = fs.readFileSync(profileCPath, "utf-8");
  const profileHContent = fs.readFileSync(profileHPath, "utf-8");
  const pecSyncContent = fs.readFileSync(pecSyncPath, "utf-8");

  // 1. Clipboard copy button in 'Журнал работы'
  assert.match(imguiContent, /Скопировать весь лог##copylogall/, "main_imgui.cpp must have copy log button");
  assert.match(imguiContent, /SetClipboardText/, "main_imgui.cpp must set clipboard text for logs");

  // 2. UI log bridge
  assert.match(profileHContent, /PB_SetAppLogUiCallback/, "profile.h must declare PB_SetAppLogUiCallback");
  assert.match(profileCContent, /PB_SetAppLogUiCallback/, "profile.c must implement PB_SetAppLogUiCallback");
  assert.match(imguiContent, /PB_SetAppLogUiCallback/, "main_imgui.cpp must register PB_SetAppLogUiCallback");

  // 3. Server URL Auto-Heal
  assert.match(imguiContent, /http:\/\/127\.0\.0\.1:3000/, "main_imgui.cpp must check for default localhost URL in profile");
  assert.match(imguiContent, /https:\/\//, "main_imgui.cpp must verify remote HTTPS URL from candidate profile");

  // 4. Modern TLS protocols and error translation in pec_sync.h
  assert.match(pecSyncContent, /WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_2/, "pec_sync.h must configure TLS 1.2");
  assert.match(pecSyncContent, /WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_3/, "pec_sync.h must configure TLS 1.3");
  assert.match(pecSyncContent, /WINHTTP_OPTION_SECURE_PROTOCOLS/, "pec_sync.h must set WINHTTP_OPTION_SECURE_PROTOCOLS");
  assert.match(pecSyncContent, /ERROR_WINHTTP_CANNOT_CONNECT/, "pec_sync.h must translate error 12029");
  assert.match(pecSyncContent, /ERROR_WINHTTP_NAME_NOT_RESOLVED/, "pec_sync.h must translate error 12007");
  assert.match(pecSyncContent, /ERROR_WINHTTP_SECURE_INVALID_CA/, "pec_sync.h must translate error 12045");
  assert.match(pecSyncContent, /ERROR_WINHTTP_SECURE_CERT_CN_INVALID/, "pec_sync.h must translate error 12038");
  assert.match(pecSyncContent, /ERROR_WINHTTP_SECURE_FAILURE/, "pec_sync.h must translate error 12175");
});
