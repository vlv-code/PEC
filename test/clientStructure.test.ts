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
