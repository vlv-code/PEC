/**
 * In-memory Prometheus metrics registry for PEC fleet synchronization and security operations.
 */

import { getActiveInstances, getActiveDesktopInstances } from "./instances.js";

interface RotationMetricKey {
  source: string;
  status: "success" | "failure";
}

const rotationCounters = new Map<string, number>();
const rateLimitCounters = new Map<string, number>();

// Initialize default rotation keys
rotationCounters.set("3x-ui:success", 0);
rotationCounters.set("3x-ui:failure", 0);
rotationCounters.set("standalone:success", 0);
rotationCounters.set("standalone:failure", 0);

export function recordRotation(source: string, status: "success" | "failure"): void {
  const cleanSource = (source || "unknown").trim().toLowerCase();
  const key = `${cleanSource}:${status}`;
  const current = rotationCounters.get(key) || 0;
  rotationCounters.set(key, current + 1);
}

export function recordRateLimitBlock(endpoint?: string): void {
  const cleanEndpoint = (endpoint || "unknown").trim();
  const key = cleanEndpoint || "default";
  const current = rateLimitCounters.get(key) || 0;
  rateLimitCounters.set(key, current + 1);
}

export function resetMetricsForTest(): void {
  rotationCounters.clear();
  rotationCounters.set("3x-ui:success", 0);
  rotationCounters.set("3x-ui:failure", 0);
  rotationCounters.set("standalone:success", 0);
  rotationCounters.set("standalone:failure", 0);
  rateLimitCounters.clear();
}

export function getMetricsSnapshot() {
  let extensionCount = 0;
  let desktopCount = 0;
  try {
    extensionCount = getActiveInstances().length;
    desktopCount = getActiveDesktopInstances().length;
  } catch {}

  return {
    fleet: {
      extension: extensionCount,
      desktop: desktopCount,
      total: extensionCount + desktopCount,
    },
    rotations: Object.fromEntries(rotationCounters.entries()),
    rateLimitBlocks: Object.fromEntries(rateLimitCounters.entries()),
    uptimeSec: Math.floor(process.uptime()),
  };
}

export function renderPrometheusMetrics(): string {
  const lines: string[] = [];
  const snapshot = getMetricsSnapshot();

  // 1. Fleet active instances
  lines.push("# HELP pec_fleet_active_instances Number of active fleet client instances");
  lines.push("# TYPE pec_fleet_active_instances gauge");
  lines.push(`pec_fleet_active_instances{type="extension"} ${snapshot.fleet.extension}`);
  lines.push(`pec_fleet_active_instances{type="desktop"} ${snapshot.fleet.desktop}`);
  lines.push(`pec_fleet_active_instances{type="total"} ${snapshot.fleet.total}`);
  lines.push("");

  // 2. Rotations
  lines.push("# HELP pec_rotation_total Total credential rotation attempts by source and status");
  lines.push("# TYPE pec_rotation_total counter");
  for (const [key, count] of Object.entries(snapshot.rotations)) {
    const [source, status] = key.split(":");
    lines.push(`pec_rotation_total{source="${source}",status="${status}"} ${count}`);
  }
  lines.push("");

  // 3. Rate limiter blocks
  lines.push("# HELP pec_rate_limit_blocks_total Total requests blocked by rate limiters");
  lines.push("# TYPE pec_rate_limit_blocks_total counter");
  if (Object.keys(snapshot.rateLimitBlocks).length === 0) {
    lines.push('pec_rate_limit_blocks_total{endpoint="none"} 0');
  } else {
    for (const [endpoint, count] of Object.entries(snapshot.rateLimitBlocks)) {
      lines.push(`pec_rate_limit_blocks_total{endpoint="${endpoint}"} ${count}`);
    }
  }
  lines.push("");

  // 4. Process uptime
  lines.push("# HELP pec_process_uptime_seconds Server process uptime in seconds");
  lines.push("# TYPE pec_process_uptime_seconds gauge");
  lines.push(`pec_process_uptime_seconds ${snapshot.uptimeSec}`);
  lines.push("");

  return lines.join("\n");
}
