import "./loadEnv.js";
import fs from "node:fs";
import path from "node:path";

export function getDataDir(): string {
  const dir = path.resolve(process.env.DATA_DIR || "./data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getProxiesStorePath(): string {
  return path.resolve(process.env.PROXIES_STORE_PATH || path.join(getDataDir(), "proxies.json"));
}

export function getCredsStorePath(): string {
  return path.resolve(process.env.CREDS_STORE || path.join(getDataDir(), "current_creds.json"));
}

export function getProxyConfigPath(): string {
  return path.resolve(process.env.PROXY_CONFIG_PATH || path.join(getDataDir(), "proxy_config.json"));
}

export function getRoutingProfilesPath(): string {
  return path.resolve(process.env.ROUTING_PROFILES_PATH || path.join(getDataDir(), "routing_profiles.json"));
}

export function getInstancesMetaPath(): string {
  return path.resolve(process.env.INSTANCES_META_PATH || path.join(getDataDir(), "instances_meta.json"));
}

export function getRotationConfigPath(): string {
  return path.resolve(process.env.ROTATION_CONFIG_PATH || path.join(getDataDir(), "rotation_config.json"));
}

export function getRotationHistoryPath(): string {
  return path.resolve(process.env.ROTATION_HISTORY_PATH || path.join(getDataDir(), "rotation_history.json"));
}

export function getDashboardAuthPath(): string {
  return path.resolve(process.env.DASHBOARD_AUTH_PATH || path.join(getDataDir(), "dashboard_auth.json"));
}

export function getBuilderConfigPath(): string {
  return path.resolve(process.env.BUILDER_CONFIG || path.join(getDataDir(), "extension_build_config.json"));
}
