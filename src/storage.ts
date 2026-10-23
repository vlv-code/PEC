import "./loadEnv.js";
import fs from "node:fs";
import path from "node:path";
import type { RoutingPresetItem } from "./types.js";
import { readJsonStore, writeJsonAtomic } from "./jsonStore.js";
import { GEO_PRESETS } from "./defaultPresets.js";


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

export function get3xuiPanelsPath(): string {
  return path.resolve(process.env.PANELS_3XUI_PATH || path.join(getDataDir(), "panels_3xui.json"));
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

export function getAppBuildConfigPath(): string {
  return path.resolve(process.env.APP_BUILD_CONFIG || path.join(getDataDir(), "app_build_config.json"));
}

export function getAppBuildInfoPath(): string {
  return path.resolve(process.env.APP_BUILD_INFO || path.join(getDataDir(), "app_build_info.json"));
}

export function getReleasesMetaPath(): string {
  return path.resolve(process.env.RELEASES_META_PATH || path.join(getDataDir(), "releases_meta.json"));
}

export function getReleasesDir(): string {
  return path.resolve(process.env.PEC_RELEASES_DIR || "./dist/releases");
}

let cachedRoutingPresetsPath: string | null = null;
let cachedRoutingPresets: RoutingPresetItem[] | null = null;

export function clearRoutingPresetsCache(): void {
  cachedRoutingPresetsPath = null;
  cachedRoutingPresets = null;
}

export function getRoutingPresetsPath(): string {
  return path.resolve(process.env.ROUTING_PRESETS_PATH || path.join(getDataDir(), "routing_presets.json"));
}

export function saveRoutingPresets(items: RoutingPresetItem[]): void {
  const filePath = getRoutingPresetsPath();
  cachedRoutingPresetsPath = filePath;
  cachedRoutingPresets = items;
  writeJsonAtomic(filePath, items);
}

export function getRoutingPresets(): RoutingPresetItem[] {
  const filePath = getRoutingPresetsPath();
  if (cachedRoutingPresets && cachedRoutingPresetsPath === filePath) {
    return cachedRoutingPresets;
  }
  const loaded = readJsonStore<RoutingPresetItem[]>(filePath);
  if (Array.isArray(loaded) && loaded.length > 0) {
    let updated = false;
    for (const geo of GEO_PRESETS || []) {
      const existing = loaded.find((item) => item.id === geo.id && item.source === "builtin");
      if (existing) {
        const existingDomains = existing.domains || [];
        const existingEntries = existing.entries || [];
        const missingDomains = geo.domains.filter(
          (d) => !existingDomains.includes(d) && !existingEntries.includes(d)
        );
        if (missingDomains.length > 0) {
          existing.domains = Array.from(new Set([...existingDomains, ...geo.domains]));
          existing.entries = Array.from(new Set([...existingEntries, ...geo.domains]));
          updated = true;
        }
      }
    }
    if (updated) {
      try {
        saveRoutingPresets(loaded);
      } catch (err) {
        console.error("[storage] Failed to update builtin routing presets:", err);
      }
    }
    cachedRoutingPresetsPath = filePath;
    cachedRoutingPresets = loaded;
    return loaded;
  }
  const seeded: RoutingPresetItem[] = (GEO_PRESETS || []).map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    description: p.description,
    type: p.id === "preset:corporate_internal" ? "cidr" : "domain",
    source: "builtin",
    domains: [...p.domains],
    entries: [...p.domains],
    lastUpdated: new Date().toISOString(),
  }));
  try {
    saveRoutingPresets(seeded);
  } catch (err) {
    console.error("[storage] Failed to save default routing presets:", err);
  }
  cachedRoutingPresetsPath = filePath;
  cachedRoutingPresets = seeded;
  return seeded;
}

