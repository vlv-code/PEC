import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getAppBuildConfigPath, getAppBuildInfoPath, getDataDir } from "../src/storage.js";

test("app storage paths resolve within DATA_DIR when unset", () => {
  const origConfig = process.env.APP_BUILD_CONFIG;
  const origInfo = process.env.APP_BUILD_INFO;
  try {
    delete process.env.APP_BUILD_CONFIG;
    delete process.env.APP_BUILD_INFO;

    const configPath = getAppBuildConfigPath();
    const infoPath = getAppBuildInfoPath();
    assert.match(configPath, /app_build_config\.json$/);
    assert.match(infoPath, /app_build_info\.json$/);

    const dataDir = getDataDir();
    assert.strictEqual(path.dirname(configPath), dataDir);
    assert.strictEqual(path.dirname(infoPath), dataDir);
  } finally {
    if (origConfig !== undefined) process.env.APP_BUILD_CONFIG = origConfig;
    if (origInfo !== undefined) process.env.APP_BUILD_INFO = origInfo;
  }
});

test("app storage paths honor explicit environment variable overrides", () => {
  const origConfig = process.env.APP_BUILD_CONFIG;
  const origInfo = process.env.APP_BUILD_INFO;
  const customConfig = path.join(os.tmpdir(), "custom_app_config.json");
  const customInfo = path.join(os.tmpdir(), "custom_app_info.json");

  try {
    process.env.APP_BUILD_CONFIG = customConfig;
    process.env.APP_BUILD_INFO = customInfo;

    assert.strictEqual(getAppBuildConfigPath(), path.resolve(customConfig));
    assert.strictEqual(getAppBuildInfoPath(), path.resolve(customInfo));
  } finally {
    if (origConfig !== undefined) {
      process.env.APP_BUILD_CONFIG = origConfig;
    } else {
      delete process.env.APP_BUILD_CONFIG;
    }
    if (origInfo !== undefined) {
      process.env.APP_BUILD_INFO = origInfo;
    } else {
      delete process.env.APP_BUILD_INFO;
    }
  }
});
