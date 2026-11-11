import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const testDir = path.resolve("test");
const testFiles = fs
  .readdirSync(testDir)
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => path.join("test", f));

const tsxCli = require.resolve("tsx/cli");
const args = [
  tsxCli,
  "--test",
  "--test-concurrency=1",
  ...process.argv.slice(2),
  ...testFiles,
];

const res = spawnSync(process.execPath, args, {
  stdio: "inherit",
  env: process.env,
});

process.exit(res.status ?? (res.error ? 1 : 0));
