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
