import "./loadEnv.js";
import fs from "node:fs";
import { Client } from "ldapts";
import { writeJsonAtomic } from "./jsonStore.js";
import { getAdCachePath } from "./storage.js";
import { logger } from "./logger.js";

export interface AdSyncConfig {
  enabled: boolean;
  ldapUrl: string;
  bindDn: string;
  bindPassword: string;
  searchBase: string;
  requiredGroupDn: string;
  syncIntervalSec: number;
  rejectUnknownUsers: boolean;
  tlsRejectUnauthorized: boolean;
}

export interface AdCacheData {
  updatedAt: string;
  groupDn: string;
  count: number;
  allowedUsers: string[];
}

export function escapeLdapFilter(str: string): string {
  return str
    .replace(/\\/g, "\\5c")
    .replace(/\*/g, "\\2a")
    .replace(/\(/g, "\\28")
    .replace(/\)/g, "\\29")
    .replace(/\0/g, "\\00");
}

export function loadAdConfig(): AdSyncConfig {
  return {
    enabled: process.env.AD_ENABLED === "true",
    ldapUrl: process.env.AD_LDAP_URL || "ldaps://127.0.0.1:636",
    bindDn: process.env.AD_BIND_DN || "",
    bindPassword: process.env.AD_BIND_PASSWORD || "",
    searchBase: process.env.AD_SEARCH_BASE || "",
    requiredGroupDn: process.env.AD_REQUIRED_GROUP_DN || "",
    syncIntervalSec: Math.max(
      5,
      parseInt(process.env.AD_SYNC_INTERVAL_SEC || "300", 10) || 300
    ),
    rejectUnknownUsers: process.env.AD_REJECT_UNKNOWN_USERS === "true",
    tlsRejectUnauthorized: process.env.AD_TLS_REJECT_UNAUTHORIZED !== "false",
  };
}

export class AdSyncService {
  private config: AdSyncConfig;
  private timer: NodeJS.Timeout | null = null;
  private allowedUsersSet = new Set<string>();
  private lastSyncAt?: string;
  private lastSyncError?: string;
  private isSyncing = false;

  constructor(cfg?: Partial<AdSyncConfig>) {
    this.config = {
      ...loadAdConfig(),
      ...cfg,
    };
    this.loadCacheFromDisk();
  }

  public getConfig(): AdSyncConfig {
    return { ...this.config };
  }

  public updateConfig(updates: Partial<AdSyncConfig>): void {
    this.config = {
      ...this.config,
      ...updates,
    };
  }

  private loadCacheFromDisk(): void {
    try {
      const cachePath = getAdCachePath();
      if (fs.existsSync(cachePath)) {
        const raw = fs.readFileSync(cachePath, "utf-8");
        const data: AdCacheData = JSON.parse(raw);
        if (Array.isArray(data.allowedUsers)) {
          for (const u of data.allowedUsers) {
            if (typeof u === "string") {
              this.allowedUsersSet.add(u.trim().toLowerCase());
            }
          }
          this.lastSyncAt = data.updatedAt;
          logger.info(`[adSync] Loaded ${this.allowedUsersSet.size} allowed users from cache: ${cachePath}`);
        }
      }
    } catch (err) {
      logger.warn("[adSync] Failed to read initial cache from disk:", err);
    }
  }

  public async sync(): Promise<{ success: boolean; count: number; error?: string }> {
    if (!this.config.enabled) {
      return { success: true, count: this.allowedUsersSet.size };
    }

    if (this.isSyncing) {
      return { success: true, count: this.allowedUsersSet.size };
    }

    this.isSyncing = true;
    if (!this.config.tlsRejectUnauthorized) {
      logger.warn(
        "[SECURITY WARNING] Active Directory LDAPS certificate validation is disabled (AD_TLS_REJECT_UNAUTHORIZED=false). This allows man-in-the-middle attacks!"
      );
    }
    let client: Client | null = null;
    try {
      client = new Client({
        url: this.config.ldapUrl,
        tlsOptions: {
          rejectUnauthorized: this.config.tlsRejectUnauthorized,
        },
        timeout: 10000,
        connectTimeout: 10000,
      });

      await client.bind(this.config.bindDn, this.config.bindPassword);

      let filter = "(&(objectCategory=person)(objectClass=user))";
      if (this.config.requiredGroupDn && this.config.requiredGroupDn.trim()) {
        const groupDn = this.config.requiredGroupDn.trim();
        filter = `(&(objectCategory=person)(objectClass=user)(memberOf:1.2.840.113556.1.4.1941:=${escapeLdapFilter(groupDn)}))`;
      }

      const searchResults = await client.search(this.config.searchBase || "", {
        scope: "sub",
        filter,
        attributes: [
          "sAMAccountName",
          "userPrincipalName",
          "userAccountControl",
          "mail",
          "displayName",
        ],
      });

      const newSet = new Set<string>();
      const userList: string[] = [];

      for (const entry of searchResults.searchEntries) {
        // userAccountControl check: ACCOUNTDISABLE = 2 (0x0002)
        const uacRaw = (entry as any).userAccountControl;
        const uac = typeof uacRaw === "number" ? uacRaw : parseInt(String(uacRaw || "0"), 10);
        if ((uac & 2) !== 0) {
          // Account is disabled in AD, skip
          continue;
        }

        const sam = (entry as any).sAMAccountName;
        const upn = (entry as any).userPrincipalName;
        const mail = (entry as any).mail;

        if (sam && typeof sam === "string") {
          const cleanSam = sam.trim().toLowerCase();
          newSet.add(cleanSam);
          userList.push(cleanSam);
        }

        if (upn && typeof upn === "string") {
          const cleanUpn = upn.trim().toLowerCase();
          newSet.add(cleanUpn);
          if (!userList.includes(cleanUpn)) {
            userList.push(cleanUpn);
          }
        }

        if (mail && typeof mail === "string") {
          const cleanMail = mail.trim().toLowerCase();
          newSet.add(cleanMail);
        }
      }

      this.allowedUsersSet = newSet;
      this.lastSyncAt = new Date().toISOString();
      this.lastSyncError = undefined;

      const cacheData: AdCacheData = {
        updatedAt: this.lastSyncAt,
        groupDn: this.config.requiredGroupDn,
        count: this.allowedUsersSet.size,
        allowedUsers: userList,
      };

      try {
        writeJsonAtomic(getAdCachePath(), cacheData);
      } catch (e) {
        logger.warn("[adSync] Could not write ad_cache.json atomically:", e);
      }

      logger.info(`[adSync] AD sync complete: ${this.allowedUsersSet.size} active users allowed.`);
      return { success: true, count: this.allowedUsersSet.size };
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastSyncError = msg;
      logger.error("[adSync] Active Directory sync failure (keeping previous cache active):", msg);
      // Fault tolerance: do NOT wipe out existing cache upon DC failure
      return { success: false, count: this.allowedUsersSet.size, error: msg };
    } finally {
      if (client) {
        try {
          await client.unbind();
        } catch {}
      }
      this.isSyncing = false;
    }
  }

  public isUserAllowed(user?: string | null): boolean {
    if (!this.config.enabled) {
      return true;
    }

    if (!user || typeof user !== "string" || user.trim() === "") {
      return !this.config.rejectUnknownUsers;
    }

    const clean = user.trim().toLowerCase();

    // 1. Direct match (e.g. sAMAccountName, full UPN, email)
    if (this.allowedUsersSet.has(clean)) {
      return true;
    }

    // 2. DOMAIN\username format -> match username
    if (clean.includes("\\")) {
      const parts = clean.split("\\");
      const nameOnly = parts[parts.length - 1];
      if (this.allowedUsersSet.has(nameOnly)) {
        return true;
      }
    }

    // 3. username@domain format -> match username
    if (clean.includes("@")) {
      const nameOnly = clean.split("@")[0];
      if (this.allowedUsersSet.has(nameOnly)) {
        return true;
      }
    }

    return false;
  }

  public startPeriodicSync(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (!this.config.enabled) {
      logger.info("[adSync] Active Directory sync is disabled (AD_ENABLED != true).");
      return;
    }

    if (!this.config.tlsRejectUnauthorized) {
      logger.warn(
        "[SECURITY WARNING] Active Directory LDAPS certificate validation is disabled (AD_TLS_REJECT_UNAUTHORIZED=false). This allows man-in-the-middle attacks!"
      );
    }
    logger.info(
      `[adSync] Starting periodic AD sync (interval=${this.config.syncIntervalSec}s, url=${this.config.ldapUrl})`
    );

    // Initial background trigger
    this.sync().catch((err) => {
      logger.warn("[adSync] Initial sync error:", err);
    });

    const intervalMs = this.config.syncIntervalSec * 1000;
    this.timer = setInterval(() => {
      this.sync().catch((err) => {
        logger.error("[adSync] Periodic sync error:", err);
      });
    }, intervalMs);

    this.timer.unref?.();
  }

  public stopPeriodicSync(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info("[adSync] Stopped periodic AD sync.");
    }
  }

  public getAllowedUsersCount(): number {
    return this.allowedUsersSet.size;
  }

  public getLastSyncInfo() {
    return {
      lastSyncAt: this.lastSyncAt,
      lastSyncError: this.lastSyncError,
      usersCount: this.allowedUsersSet.size,
      enabled: this.config.enabled,
    };
  }

  public setMockAllowedUsers(users: string[]): void {
    this.allowedUsersSet = new Set(users.map((u) => u.trim().toLowerCase()));
  }
}

export const adSyncService = new AdSyncService();

export function isDomainUserAllowed(user?: string | null): boolean {
  return adSyncService.isUserAllowed(user);
}

export function startAdSync(): void {
  adSyncService.startPeriodicSync();
}

export function stopAdSync(): void {
  adSyncService.stopPeriodicSync();
}

export function triggerAdSync(): Promise<{ success: boolean; count: number; error?: string }> {
  return adSyncService.sync();
}
