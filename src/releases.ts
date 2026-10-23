import fs from "node:fs";
import path from "node:path";
import { ReleaseItem, ReleasesMetaStore } from "./types.js";
import { readJsonStore, writeJsonAtomic } from "./jsonStore.js";
import { getReleasesMetaPath, getReleasesDir } from "./storage.js";

function getUpdatesDir(): string {
  return path.resolve(process.env.PEC_UPDATES_DIR || "./dist/updates");
}

let cachedStore: ReleasesMetaStore | null = null;

function loadStore(): ReleasesMetaStore {
  const filePath = getReleasesMetaPath();
  const data = readJsonStore<ReleasesMetaStore>(filePath);
  if (data && Array.isArray(data.releases)) {
    cachedStore = data;
    return data;
  }
  const empty: ReleasesMetaStore = { releases: [] };
  cachedStore = empty;
  return empty;
}

function persistStore(store: ReleasesMetaStore): void {
  const filePath = getReleasesMetaPath();
  writeJsonAtomic(filePath, store);
  cachedStore = store;
}

export function getAllReleases(): ReleasesMetaStore {
  return loadStore();
}

export function resetReleasesStore(): void {
  cachedStore = { releases: [] };
  const filePath = getReleasesMetaPath();
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {}
}

export function getActiveRelease(type: "extension" | "app"): ReleaseItem | undefined {
  const store = loadStore();
  const activeVer = type === "extension" ? store.activeExtensionVersion : store.activeAppVersion;
  if (!activeVer) return undefined;
  return store.releases.find((r) => r.type === type && r.version === activeVer && r.isActive);
}

export function recordRelease(item: Omit<ReleaseItem, "id" | "isActive"> & { isActive?: boolean }): ReleaseItem {
  const store = loadStore();
  const cleanVersion = String(item.version || "").trim();
  const cleanType = item.type;
  const relId = `rel_${cleanType}_${cleanVersion.replace(/[^a-zA-Z0-9]/g, "_")}`;

  const currentActiveVer = cleanType === "extension" ? store.activeExtensionVersion : store.activeAppVersion;
  const shouldBeActive = item.isActive === true || (!currentActiveVer && item.isActive !== false);

  if (shouldBeActive) {
    if (cleanType === "extension") {
      store.activeExtensionVersion = cleanVersion;
    } else {
      store.activeAppVersion = cleanVersion;
    }
  }

  const existingIndex = store.releases.findIndex((r) => r.type === cleanType && r.version === cleanVersion);

  const newRelease: ReleaseItem = {
    id: existingIndex >= 0 ? store.releases[existingIndex].id : relId,
    type: cleanType,
    version: cleanVersion,
    builtAt: item.builtAt || new Date().toISOString(),
    sha256: item.sha256 || "",
    fileName: item.fileName,
    filePath: item.filePath,
    isActive: shouldBeActive,
    notes: item.notes,
    size: item.size,
  };

  if (existingIndex >= 0) {
    store.releases[existingIndex] = newRelease;
  } else {
    store.releases.unshift(newRelease);
  }

  // Synchronize isActive flags across all releases of this type
  const targetActiveVer = cleanType === "extension" ? store.activeExtensionVersion : store.activeAppVersion;
  for (const r of store.releases) {
    if (r.type === cleanType) {
      r.isActive = r.version === targetActiveVer;
    }
  }

  persistStore(store);
  return newRelease;
}

export function setActiveRelease(type: "extension" | "app", version: string): { ok: boolean; activeVersion: string } {
  const store = loadStore();
  const cleanVersion = String(version || "").trim();
  const targetRelease = store.releases.find((r) => r.type === type && r.version === cleanVersion);

  if (!targetRelease) {
    throw new Error(`Release not found: ${type} ${cleanVersion}`);
  }

  if (type === "extension") {
    store.activeExtensionVersion = cleanVersion;
  } else {
    store.activeAppVersion = cleanVersion;
  }

  for (const r of store.releases) {
    if (r.type === type) {
      r.isActive = r.version === cleanVersion;
    }
  }

  persistStore(store);

  // Mirror active files to updates directory for public serving
  const updatesDir = getUpdatesDir();
  try {
    fs.mkdirSync(updatesDir, { recursive: true });

    if (type === "extension") {
      if (fs.existsSync(targetRelease.filePath)) {
        fs.copyFileSync(targetRelease.filePath, path.join(updatesDir, "pec-extension.crx"));
        fs.copyFileSync(targetRelease.filePath, path.join(updatesDir, "extension.crx"));
      }
      const relDir = path.dirname(targetRelease.filePath);
      const extCrxSrc = path.join(relDir, "extension.crx");
      if (fs.existsSync(extCrxSrc)) {
        fs.copyFileSync(extCrxSrc, path.join(updatesDir, "extension.crx"));
      }
      const xmlSrc = path.join(relDir, "updates.xml");
      if (fs.existsSync(xmlSrc)) {
        fs.copyFileSync(xmlSrc, path.join(updatesDir, "updates.xml"));
      }
      const manifestSrc = path.join(relDir, "manifest.json");
      if (fs.existsSync(manifestSrc)) {
        fs.copyFileSync(manifestSrc, path.join(updatesDir, "manifest.json"));
      }
    } else if (type === "app") {
      if (fs.existsSync(targetRelease.filePath)) {
        fs.copyFileSync(targetRelease.filePath, path.join(updatesDir, "pec-client-windows-x64.zip"));
      }
      const relDir = path.dirname(targetRelease.filePath);
      const linuxSrc = path.join(relDir, "pec-client-linux-x64.tar.gz");
      if (fs.existsSync(linuxSrc)) {
        fs.copyFileSync(linuxSrc, path.join(updatesDir, "pec-client-linux-x64.tar.gz"));
      }
      const profileSrc = path.join(relDir, "pec_profile.pbprofile");
      if (fs.existsSync(profileSrc)) {
        fs.copyFileSync(profileSrc, path.join(updatesDir, "pec_profile.pbprofile"));
      }
    }
  } catch (err) {
    console.warn(`[releases] Warning: failed mirroring active release files to updates dir:`, err);
  }

  return { ok: true, activeVersion: cleanVersion };
}

export function deleteRelease(type: "extension" | "app", version: string): boolean {
  const store = loadStore();
  const cleanVersion = String(version || "").trim();
  const activeVer = type === "extension" ? store.activeExtensionVersion : store.activeAppVersion;

  if (activeVer === cleanVersion) {
    throw new Error(`Cannot delete active release: ${type} ${cleanVersion}`);
  }

  const idx = store.releases.findIndex((r) => r.type === type && r.version === cleanVersion);
  if (idx < 0) {
    return false;
  }

  const removed = store.releases.splice(idx, 1)[0];

  try {
    if (removed.filePath && fs.existsSync(removed.filePath)) {
      const relDir = path.dirname(removed.filePath);
      const releasesDir = path.resolve(getReleasesDir());
      const resolvedRelDir = path.resolve(relDir);
      // Ensure resolvedRelDir is strictly inside releasesDir and not releasesDir itself
      if (
        resolvedRelDir.startsWith(releasesDir + path.sep) &&
        resolvedRelDir !== releasesDir
      ) {
        fs.rmSync(resolvedRelDir, { recursive: true, force: true });
      }
    }
  } catch {}

  persistStore(store);
  return true;
}
