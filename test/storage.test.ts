import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  getDataDir,
  getProxiesStorePath,
  getCredsStorePath,
  getProxyConfigPath,
  getRoutingProfilesPath,
  getInstancesMetaPath,
  getRotationConfigPath,
  getRotationHistoryPath,
  getDashboardAuthPath,
  getBuilderConfigPath,
} from "../src/storage.js";

test("getDataDir returns resolved DATA_DIR and ensures directory exists", () => {
  const originalDataDir = process.env.DATA_DIR;
  const tempDir = path.join(os.tmpdir(), `pec-test-datadir-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    process.env.DATA_DIR = tempDir;
    assert.strictEqual(fs.existsSync(tempDir), false);

    const dir = getDataDir();
    assert.strictEqual(dir, path.resolve(tempDir));
    assert.strictEqual(fs.existsSync(tempDir), true);
  } finally {
    if (originalDataDir !== undefined) {
      process.env.DATA_DIR = originalDataDir;
    } else {
      delete process.env.DATA_DIR;
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test("getDataDir defaults to ./data when DATA_DIR is unset", () => {
  const originalDataDir = process.env.DATA_DIR;
  try {
    delete process.env.DATA_DIR;
    const expected = path.resolve("./data");
    const dir = getDataDir();
    assert.strictEqual(dir, expected);
    assert.strictEqual(fs.existsSync(dir), true);
  } finally {
    if (originalDataDir !== undefined) {
      process.env.DATA_DIR = originalDataDir;
    }
  }
});

test("store path helpers return default paths inside getDataDir when env vars are unset", () => {
  const originalEnv = { ...process.env };
  const tempDir = path.join(os.tmpdir(), `pec-test-stores-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  try {
    process.env.DATA_DIR = tempDir;
    delete process.env.PROXIES_STORE_PATH;
    delete process.env.CREDS_STORE;
    delete process.env.PROXY_CONFIG_PATH;
    delete process.env.ROUTING_PROFILES_PATH;
    delete process.env.INSTANCES_META_PATH;
    delete process.env.ROTATION_CONFIG_PATH;
    delete process.env.ROTATION_HISTORY_PATH;
    delete process.env.DASHBOARD_AUTH_PATH;
    delete process.env.BUILDER_CONFIG;

    const dataDir = getDataDir();
    assert.strictEqual(getProxiesStorePath(), path.join(dataDir, "proxies.json"));
    assert.strictEqual(getCredsStorePath(), path.join(dataDir, "current_creds.json"));
    assert.strictEqual(getProxyConfigPath(), path.join(dataDir, "proxy_config.json"));
    assert.strictEqual(getRoutingProfilesPath(), path.join(dataDir, "routing_profiles.json"));
    assert.strictEqual(getInstancesMetaPath(), path.join(dataDir, "instances_meta.json"));
    assert.strictEqual(getRotationConfigPath(), path.join(dataDir, "rotation_config.json"));
    assert.strictEqual(getRotationHistoryPath(), path.join(dataDir, "rotation_history.json"));
    assert.strictEqual(getDashboardAuthPath(), path.join(dataDir, "dashboard_auth.json"));
    assert.strictEqual(getBuilderConfigPath(), path.join(dataDir, "extension_build_config.json"));
  } finally {
    process.env = originalEnv;
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

test("store path helpers honor explicit environment variable overrides", () => {
  const originalEnv = { ...process.env };
  const tempDir = path.join(os.tmpdir(), `pec-test-custom-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  try {
    process.env.DATA_DIR = tempDir;
    process.env.PROXIES_STORE_PATH = path.join(tempDir, "custom-proxies.json");
    process.env.CREDS_STORE = path.join(tempDir, "custom-creds.json");
    process.env.PROXY_CONFIG_PATH = path.join(tempDir, "custom-proxy-config.json");
    process.env.ROUTING_PROFILES_PATH = path.join(tempDir, "custom-profiles.json");
    process.env.INSTANCES_META_PATH = path.join(tempDir, "custom-instances.json");
    process.env.ROTATION_CONFIG_PATH = path.join(tempDir, "custom-rotation.json");
    process.env.ROTATION_HISTORY_PATH = path.join(tempDir, "custom-history.json");
    process.env.DASHBOARD_AUTH_PATH = path.join(tempDir, "custom-auth.json");
    process.env.BUILDER_CONFIG = path.join(tempDir, "custom-builder.json");

    assert.strictEqual(getProxiesStorePath(), path.resolve(process.env.PROXIES_STORE_PATH));
    assert.strictEqual(getCredsStorePath(), path.resolve(process.env.CREDS_STORE));
    assert.strictEqual(getProxyConfigPath(), path.resolve(process.env.PROXY_CONFIG_PATH));
    assert.strictEqual(getRoutingProfilesPath(), path.resolve(process.env.ROUTING_PROFILES_PATH));
    assert.strictEqual(getInstancesMetaPath(), path.resolve(process.env.INSTANCES_META_PATH));
    assert.strictEqual(getRotationConfigPath(), path.resolve(process.env.ROTATION_CONFIG_PATH));
    assert.strictEqual(getRotationHistoryPath(), path.resolve(process.env.ROTATION_HISTORY_PATH));
    assert.strictEqual(getDashboardAuthPath(), path.resolve(process.env.DASHBOARD_AUTH_PATH));
    assert.strictEqual(getBuilderConfigPath(), path.resolve(process.env.BUILDER_CONFIG));
  } finally {
    process.env = originalEnv;
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});
