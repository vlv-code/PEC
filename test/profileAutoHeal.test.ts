import test from "node:test";
import assert from "node:assert/strict";
import { autoHealProfiles, getAllProfiles } from "../src/routing.js";
import { RoutingProfile } from "../src/types.js";

test("autoHealProfiles injects r_ip_check into profile_default_split if missing", () => {
  const mockProfiles: RoutingProfile[] = [
    {
      id: "profile_default_split",
      name: "Direct by Default",
      description: "Test description",
      defaultPolicy: "direct",
      isDefault: true,
      targetScope: "all",
      rules: [
        {
          id: "r1",
          name: "Bypass Corporate Intranet",
          targetType: "preset",
          pattern: "preset:corporate_internal",
          action: "direct",
          enabled: true,
        },
        {
          id: "r2",
          name: "Route AI Services to Proxy",
          targetType: "preset",
          pattern: "preset:ai_services",
          action: "proxy",
          enabled: true,
        },
      ],
      updatedAt: new Date().toISOString(),
    },
  ];

  const changed = autoHealProfiles(mockProfiles);
  assert.equal(changed, true, "Should report profiles were modified");

  const split = mockProfiles.find((p) => p.id === "profile_default_split");
  assert.ok(split, "profile_default_split must exist");
  const ipCheckRule = split.rules.find((r) => r.pattern === "preset:ip_check");
  assert.ok(ipCheckRule, "r_ip_check must be added");
  assert.equal(ipCheckRule.action, "proxy");
  assert.equal(ipCheckRule.enabled, true);

  // Calling it again should be idempotent
  const secondRunChanged = autoHealProfiles(mockProfiles);
  assert.equal(secondRunChanged, false, "Should not modify when already present");
  const count = split.rules.filter((r) => r.pattern === "preset:ip_check").length;
  assert.equal(count, 1, "Should not duplicate rule");
});

test("getAllProfiles includes preset:ip_check in default split profile", () => {
  const all = getAllProfiles();
  const split = all.find((p) => p.id === "profile_default_split");
  assert.ok(split, "profile_default_split must exist in loaded profiles");
  const hasIpCheck = split.rules.some((r) => r.pattern === "preset:ip_check");
  assert.ok(hasIpCheck, "Default split profile must contain preset:ip_check rule");
});
