import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import { registerHeartbeat, assignInstanceProfile, deleteInstance, getActiveInstances } from "../src/instances.js";

test("instance IDs cannot pollute the prototype chain", () => {
  assert.throws(() => registerHeartbeat({ instanceId: "__proto__", ip: "1.2.3.4", version: "1.0.0" }), /Forbidden|Invalid instanceId/);
  assert.throws(() => registerHeartbeat({ instanceId: "constructor", ip: "1.2.3.4", version: "1.0.0" }), /Forbidden|Invalid instanceId/);
  assert.throws(() => registerHeartbeat({ instanceId: "prototype", ip: "1.2.3.4", version: "1.0.0" }), /Forbidden|Invalid instanceId/);
  assert.throws(() => assignInstanceProfile("__proto__", "prof_x"), /Forbidden|Invalid instanceId/);

  // prototype untouched
  const meta: Record<string, unknown> = {};
  assert.strictEqual(({} as any).polluted, undefined);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(meta, "__proto__"), false);
});

test("instances can be deleted from the registry (diagnostics cleanup)", () => {
  registerHeartbeat({ instanceId: "inst_cleanup_me", ip: "10.0.0.9", version: "1.0.0" });
  assert.ok(getActiveInstances().some((i) => i.instanceId === "inst_cleanup_me"));

  const removed = deleteInstance("inst_cleanup_me");
  assert.strictEqual(removed, true);
  assert.ok(!getActiveInstances().some((i) => i.instanceId === "inst_cleanup_me"));

  const removedAgain = deleteInstance("inst_cleanup_me");
  assert.strictEqual(removedAgain, false);
  assert.strictEqual(deleteInstance("__proto__"), false);
});

test("profile assignment persists and resolves the applied profile name", () => {
  registerHeartbeat({ instanceId: "inst_assign_target", ip: "10.1.1.1", version: "1.0.0", group: "Grunts" });
  assignInstanceProfile("inst_assign_target", "profile_default_split", "SEC-Proxy-VPN-VIP");

  const inst = registerHeartbeat({ instanceId: "inst_assign_target", ip: "10.1.1.1", version: "1.0.0" });
  assert.strictEqual(inst.assignedProfileId, "profile_default_split");
  assert.strictEqual(inst.group, "SEC-Proxy-VPN-VIP");
  assert.ok(inst.appliedProfileName);
});

test("LRU eviction is order-based and drops the least recently synced instance", () => {
  // fill with fresh IDs; earliest inserted must be evicted first
  const first = "inst_lru_first";
  registerHeartbeat({ instanceId: first, ip: "10.0.0.1", version: "1.0.0" });
  for (let i = 0; i < 2500; i++) {
    registerHeartbeat({ instanceId: `inst_lru_bulk_${i}`, ip: "10.0.0.2", version: "1.0.0" });
  }
  const active = getActiveInstances();
  assert.ok(active.length <= 2000, `registry must stay capped, got ${active.length}`);
  assert.ok(!active.some((i) => i.instanceId === first), "oldest entry must be evicted");
  assert.ok(active.some((i) => i.instanceId === "inst_lru_bulk_2499"), "newest entry must survive");
});

test("routingMode defaults to 'pac', can be updated to 'fixed', and validates input", async () => {
  const { getProxyConfig, updateProxyConfig } = await import("../src/instances.js");
  const cfg = getProxyConfig();
  assert.strictEqual(cfg.routingMode, "pac");

  const updated = updateProxyConfig({ routingMode: "fixed" });
  assert.strictEqual(updated.routingMode, "fixed");
  assert.strictEqual(getProxyConfig().routingMode, "fixed");

  // Extension background logic check:
  // const usePac = (config.protocol === "pac" || (config.pacUrl && config.routingMode !== "fixed"));
  const fixedConfig = getProxyConfig();
  const usePacWithFixed = (fixedConfig.protocol === "pac" || (Boolean(fixedConfig.pacUrl) && fixedConfig.routingMode !== "fixed"));
  assert.strictEqual(usePacWithFixed, false, "when routingMode is fixed, usePac must evaluate to false (fixed_servers)");

  assert.throws(() => updateProxyConfig({ routingMode: "invalid" as any }), /Invalid routingMode/);

  // revert back to pac
  updateProxyConfig({ routingMode: "pac" });
  assert.strictEqual(getProxyConfig().routingMode, "pac");
  const pacConfig = getProxyConfig();
  const usePacWithPac = (pacConfig.protocol === "pac" || (Boolean(pacConfig.pacUrl) && pacConfig.routingMode !== "fixed"));
  assert.strictEqual(usePacWithPac, true, "when routingMode is pac, usePac must evaluate to true (pac_script)");
});

