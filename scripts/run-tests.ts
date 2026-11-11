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
const patchScript = path.resolve("scripts/patch-node20.cjs").replace(/\\/g, "/");

const userArgs = process.argv.slice(2);
const hasExplicitFiles = userArgs.some(
  (arg) => !arg.startsWith("-") && (arg.endsWith(".ts") || arg.endsWith(".js"))
);
const filesToRun = hasExplicitFiles ? [] : testFiles;

const prevNodeOptions = process.env.NODE_OPTIONS || "";
const requireOption = `--require ${patchScript.includes(" ") ? `"${patchScript}"` : patchScript}`;
const nodeOptions = prevNodeOptions
  ? `${prevNodeOptions} ${requireOption}`
  : requireOption;

const args = [
  "--require",
  patchScript,
  tsxCli,
  "--test",
  "--test-concurrency=1",
  ...userArgs,
  ...filesToRun,
];

const res = spawnSync(process.execPath, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_OPTIONS: nodeOptions,
  },
});

process.exit(res.status ?? (res.error ? 1 : 0));
