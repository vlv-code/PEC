import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

test("client and template directories exist with proper placeholders", () => {
  const root = process.cwd();
  assert.strictEqual(fs.existsSync(path.join(root, "client")), true, "client dir must exist");
  assert.strictEqual(fs.existsSync(path.join(root, "dist", "templates", "app", "windows")), true, "windows templates dir must exist");
  assert.strictEqual(fs.existsSync(path.join(root, "dist", "templates", "app", "linux")), true, "linux templates dir must exist");
  assert.strictEqual(fs.existsSync(path.join(root, "client", "README.md")), true, "client/README.md must exist");
  assert.strictEqual(fs.existsSync(path.join(root, "dist", "templates", "app", "windows", "README.txt")), true, "windows README.txt must exist");
  assert.strictEqual(fs.existsSync(path.join(root, "dist", "templates", "app", "linux", "README.txt")), true, "linux README.txt must exist");
});
