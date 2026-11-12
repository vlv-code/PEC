import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Client } from "ldapts";
import {
  AdSyncService,
  escapeLdapFilter,
  isDomainUserAllowed,
  loadAdConfig,
} from "../src/adSync.js";
import { sanitizeLogValue } from "../src/logger.js";
import { periodicAdSyncTask, stopScheduler } from "../src/scheduler.js";
import { getAdCachePath, getDataDir } from "../src/storage.js";

test("adSync: loads configuration defaults and honors environment variables", () => {
  const origEnabled = process.env.AD_ENABLED;
  const origUrl = process.env.AD_LDAP_URL;
  const origReject = process.env.AD_REJECT_UNKNOWN_USERS;

  try {
    process.env.AD_ENABLED = "true";
    process.env.AD_LDAP_URL = "ldaps://dc.example.corp:636";
    process.env.AD_REJECT_UNKNOWN_USERS = "true";

    const cfg = loadAdConfig();
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.ldapUrl, "ldaps://dc.example.corp:636");
    assert.equal(cfg.rejectUnknownUsers, true);
  } finally {
    process.env.AD_ENABLED = origEnabled;
    process.env.AD_LDAP_URL = origUrl;
    process.env.AD_REJECT_UNKNOWN_USERS = origReject;
  }
});

test("adSync: escapeLdapFilter properly escapes special LDAP characters", () => {
  assert.equal(escapeLdapFilter("normal_group"), "normal_group");
  assert.equal(escapeLdapFilter("CN=Admin*Group (Tier 1)\\Special"), "CN=Admin\\2aGroup \\28Tier 1\\29\\5cSpecial");
});

test("adSync: isDomainUserAllowed allows all users when AD_ENABLED !== 'true'", () => {
  const svc = new AdSyncService({ enabled: false });
  assert.equal(svc.isUserAllowed("CORP\\alice"), true);
  assert.equal(svc.isUserAllowed("bob"), true);
  assert.equal(svc.isUserAllowed(""), true);
  assert.equal(svc.isUserAllowed(undefined), true);
  assert.equal(svc.isUserAllowed(null), true);
});

test("adSync: fast in-memory matching supports domain prefixes, UPNs, and case-insensitivity", () => {
  const svc = new AdSyncService({
    enabled: true,
    rejectUnknownUsers: true,
  });

  svc.setMockAllowedUsers(["john.doe", "alice.smith", "admin_ops@corp.local"]);

  // Direct match
  assert.equal(svc.isUserAllowed("john.doe"), true);
  assert.equal(svc.isUserAllowed("JOHN.DOE"), true);

  // Domain prefix (DOMAIN\username)
  assert.equal(svc.isUserAllowed("CORP\\john.doe"), true);
  assert.equal(svc.isUserAllowed("corp.local\\john.doe"), true);
  assert.equal(svc.isUserAllowed("CORP\\ALICE.SMITH"), true);

  // UPN (username@domain)
  assert.equal(svc.isUserAllowed("admin_ops@corp.local"), true);
  assert.equal(svc.isUserAllowed("ADMIN_OPS@CORP.LOCAL"), true);
  assert.equal(svc.isUserAllowed("john.doe@corp.local"), true); // prefix matches allowed sAMAccountName

  // Unknown or unauthorized users
  assert.equal(svc.isUserAllowed("CORP\\mallory"), false);
  assert.equal(svc.isUserAllowed("hacker"), false);
  assert.equal(svc.isUserAllowed(""), false);
  assert.equal(svc.isUserAllowed(undefined), false);
});

test("adSync: comprehensive normalization of DOMAIN\\user, user@domain.com, and user variants", () => {
  const svc = new AdSyncService({
    enabled: true,
    rejectUnknownUsers: true,
  });

  svc.setMockAllowedUsers(["alice.smith", "bob_ops"]);

  // 1. Bare user
  assert.equal(svc.isUserAllowed("alice.smith"), true);
  assert.equal(svc.isUserAllowed("bob_ops"), true);

  // 2. NetBIOS domain format (DOMAIN\user)
  assert.equal(svc.isUserAllowed("CORP\\alice.smith"), true);
  assert.equal(svc.isUserAllowed("DEV\\bob_ops"), true);

  // 3. FQDN domain prefix (domain.local\user)
  assert.equal(svc.isUserAllowed("corp.example.local\\alice.smith"), true);
  assert.equal(svc.isUserAllowed("sub.prod.network\\bob_ops"), true);

  // 4. UPN format (user@domain.com)
  assert.equal(svc.isUserAllowed("alice.smith@corp.example.com"), true);
  assert.equal(svc.isUserAllowed("bob_ops@internal.net"), true);

  // 5. Case-insensitivity across all formats
  assert.equal(svc.isUserAllowed("cOrP\\AlIcE.sMiTh"), true);
  assert.equal(svc.isUserAllowed("ALICE.SMITH@CORP.EXAMPLE.COM"), true);
  assert.equal(svc.isUserAllowed("BOB_OPS"), true);

  // 6. Trimming whitespace
  assert.equal(svc.isUserAllowed("  CORP\\alice.smith  "), true);
  assert.equal(svc.isUserAllowed("  alice.smith@corp.com  "), true);
  assert.equal(svc.isUserAllowed("\tbob_ops\n"), true);

  // 7. Non-matching users
  assert.equal(svc.isUserAllowed("CORP\\charlie"), false);
  assert.equal(svc.isUserAllowed("charlie@corp.com"), false);
  assert.equal(svc.isUserAllowed("charlie"), false);
});

test("adSync: filters userAccountControl bitmask (active vs disabled accounts)", async () => {
  const origBind = Client.prototype.bind;
  const origSearch = Client.prototype.search;
  const origUnbind = Client.prototype.unbind;

  try {
    Client.prototype.bind = async function () {};
    Client.prototype.unbind = async function () {};
    Client.prototype.search = async function () {
      return {
        searchEntries: [
          // Active users (bit 2 is 0)
          { sAMAccountName: "alice.active", userAccountControl: 512 }, // NORMAL_ACCOUNT
          {
            sAMAccountName: "bob.noexpire",
            userPrincipalName: "bob.noexpire@corp.local",
            userAccountControl: 66048, // NORMAL_ACCOUNT | DONT_EXPIRE_PASSWORD
          },
          { sAMAccountName: "charlie.string_uac", userAccountControl: "512" }, // String format
          // Disabled users (bit 2 is 1 -> ACCOUNTDISABLE = 0x0002)
          { sAMAccountName: "dave.disabled", userAccountControl: 514 }, // NORMAL_ACCOUNT | ACCOUNTDISABLE
          { sAMAccountName: "eve.dis_noexpire", userAccountControl: 66050 }, // DONT_EXPIRE_PASSWORD | ACCOUNTDISABLE
          { sAMAccountName: "frank.just_disabled", userAccountControl: 2 }, // ACCOUNTDISABLE
          { sAMAccountName: "grace.string_disabled", userAccountControl: "514" }, // String disabled
        ],
      } as any;
    };

    const svc = new AdSyncService({
      enabled: true,
      ldapUrl: "ldaps://fake-dc.corp:636",
      rejectUnknownUsers: true,
    });

    const result = await svc.sync();
    assert.equal(result.success, true);

    // Active accounts MUST be allowed
    assert.equal(svc.isUserAllowed("alice.active"), true);
    assert.equal(svc.isUserAllowed("CORP\\alice.active"), true);
    assert.equal(svc.isUserAllowed("bob.noexpire"), true);
    assert.equal(svc.isUserAllowed("bob.noexpire@corp.local"), true);
    assert.equal(svc.isUserAllowed("charlie.string_uac"), true);

    // Disabled accounts MUST be rejected (skipped during sync)
    assert.equal(svc.isUserAllowed("dave.disabled"), false);
    assert.equal(svc.isUserAllowed("CORP\\dave.disabled"), false);
    assert.equal(svc.isUserAllowed("eve.dis_noexpire"), false);
    assert.equal(svc.isUserAllowed("frank.just_disabled"), false);
    assert.equal(svc.isUserAllowed("grace.string_disabled"), false);
  } finally {
    Client.prototype.bind = origBind;
    Client.prototype.search = origSearch;
    Client.prototype.unbind = origUnbind;
  }
});

test("adSync: rejectUnknownUsers=false permits empty domainUser while still enforcing allowed list for known users", () => {
  const svc = new AdSyncService({
    enabled: true,
    rejectUnknownUsers: false,
  });

  svc.setMockAllowedUsers(["john.doe"]);

  // Allowed member
  assert.equal(svc.isUserAllowed("CORP\\john.doe"), true);

  // Unknown member is rejected even when rejectUnknownUsers=false
  assert.equal(svc.isUserAllowed("CORP\\unauthorized_user"), false);

  // Devices/extensions without domainUser are permitted when rejectUnknownUsers=false
  assert.equal(svc.isUserAllowed(""), true);
  assert.equal(svc.isUserAllowed(undefined), true);
});

test("adSync: fault tolerance preserves existing cache when Domain Controller is unreachable", async () => {
  const svc = new AdSyncService({
    enabled: true,
    ldapUrl: "ldaps://127.0.0.1:19999", // non-existent port
    bindDn: "CN=svc,DC=corp",
    bindPassword: "pass",
    searchBase: "DC=corp",
    requiredGroupDn: "CN=ProxyGroup,DC=corp",
  });

  // Pre-seed in-memory allowed users
  svc.setMockAllowedUsers(["persisted.user"]);
  assert.equal(svc.isUserAllowed("persisted.user"), true);

  // Trigger sync against dead server
  const result = await svc.sync();

  assert.equal(result.success, false);
  assert.ok(result.error);

  // In-memory cache must NOT be purged
  assert.equal(svc.isUserAllowed("CORP\\persisted.user"), true);
  assert.equal(svc.getAllowedUsersCount(), 1);
});

test("adSync: loads cached users from data/ad_cache.json on service initialization", () => {
  const cachePath = getAdCachePath();
  const dir = path.dirname(cachePath);
  fs.mkdirSync(dir, { recursive: true });

  const testCache = {
    updatedAt: new Date().toISOString(),
    groupDn: "CN=TestGroup,DC=corp",
    count: 2,
    allowedUsers: ["cached.user1", "cached.user2"],
  };

  fs.writeFileSync(cachePath, JSON.stringify(testCache), "utf-8");

  const svc = new AdSyncService({ enabled: true, rejectUnknownUsers: true });

  assert.equal(svc.isUserAllowed("CORP\\cached.user1"), true);
  assert.equal(svc.isUserAllowed("cached.user2"), true);
  assert.equal(svc.isUserAllowed("cached.user3"), false);
});

test("logger: sanitizes AD_BIND_PASSWORD and adBindPassword keys", () => {
  const origPass = process.env.AD_BIND_PASSWORD;
  try {
    process.env.AD_BIND_PASSWORD = "SuperSecretAdPassword123!";

    // 1. String redaction
    const logStr = "Connecting with pass SuperSecretAdPassword123! to LDAPS";
    const sanitizedStr = sanitizeLogValue(logStr);
    assert.ok(!String(sanitizedStr).includes("SuperSecretAdPassword123!"));
    assert.ok(String(sanitizedStr).includes("[REDACTED]"));

    // 2. Object key redaction
    const logObj = {
      ad_bind_password: "SuperSecretAdPassword123!",
      adBindPassword: "AnotherSecretPassword",
      bindPassword: "ThirdSecretPassword",
    };
    const sanitizedObj = sanitizeLogValue(logObj) as any;
    assert.equal(sanitizedObj.ad_bind_password, "[REDACTED]");
    assert.equal(sanitizedObj.adBindPassword, "[REDACTED]");
    assert.equal(sanitizedObj.bindPassword, "[REDACTED]");
  } finally {
    process.env.AD_BIND_PASSWORD = origPass;
  }
});

test("scheduler: periodicAdSyncTask starts and stopScheduler cleanly stops periodic AD sync", () => {
  // Should not throw or crash
  assert.doesNotThrow(() => {
    periodicAdSyncTask();
  });
  assert.doesNotThrow(() => {
    stopScheduler();
  });
});
