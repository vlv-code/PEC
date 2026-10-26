import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import { recordAudit, getAuditLogs } from "../src/audit.js";

test("M-19: recordAudit ignores /healthz and HEALTH_CHECK entries", () => {
  // Record an administrative action
  recordAudit({
    ip: "10.0.0.1",
    endpoint: "/api/routing/profiles",
    status: 200,
    result: "CONFIG_UPDATED",
    details: "Admin updated routing profile",
  });

  const beforeLogs = getAuditLogs();
  const initialAdminEntry = beforeLogs.find((l) => l.result === "CONFIG_UPDATED" && l.details === "Admin updated routing profile");
  assert.ok(initialAdminEntry, "Administrative entry must be recorded in audit log");

  // Attempt to record /healthz endpoint
  recordAudit({
    ip: "127.0.0.1",
    endpoint: "/healthz",
    status: 200,
    result: "HEALTH_CHECK",
  });

  // Attempt to record entry with result HEALTH_CHECK
  recordAudit({
    ip: "10.0.0.2",
    endpoint: "/api/system/status",
    status: 200,
    result: "HEALTH_CHECK",
  });

  // Attempt to record entry with endpoint /healthz but different status
  recordAudit({
    ip: "10.0.0.3",
    endpoint: "/healthz",
    status: 500,
    result: "STORE_ERROR",
  });

  const afterLogs = getAuditLogs();
  const healthCheckEntries = afterLogs.filter((l) => l.endpoint === "/healthz" || l.result === "HEALTH_CHECK");
  assert.strictEqual(healthCheckEntries.length, 0, "No health check entries should be stored in audit logs");

  // Verify that 150 health check probes do not evict the administrative entry
  for (let i = 0; i < 150; i++) {
    recordAudit({
      ip: "127.0.0.1",
      endpoint: "/healthz",
      status: 200,
      result: "HEALTH_CHECK",
    });
  }

  const logsAfterFlooding = getAuditLogs();
  const preservedEntry = logsAfterFlooding.find((l) => l.result === "CONFIG_UPDATED" && l.details === "Admin updated routing profile");
  assert.ok(preservedEntry, "Administrative entry must NOT be evicted by /healthz or HEALTH_CHECK probes");
});
