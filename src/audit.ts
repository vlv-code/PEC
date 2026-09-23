import { Request } from "express";
import crypto from "node:crypto";

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  ip: string;
  endpoint: string;
  status: number;
  result:
    | "SERVED"
    | "SYNCED"
    | "REJECTED_TOKEN"
    | "STORE_ERROR"
    | "HEALTH_CHECK"
    | "ROTATED"
    | "CONFIG_UPDATED"
    | "BUILD_SUCCESS"
    | "RATE_LIMITED";
  details?: string;
}

const auditLogs: AuditLogEntry[] = [];
const MAX_AUDIT_LOGS = 100;

export function recordAudit(entry: Omit<AuditLogEntry, "id" | "timestamp">): void {
  const logItem: AuditLogEntry = {
    id: crypto.randomBytes(4).toString("hex"),
    timestamp: new Date().toISOString(),
    ...entry,
  };
  auditLogs.unshift(logItem);
  if (auditLogs.length > MAX_AUDIT_LOGS) {
    auditLogs.pop();
  }
}

export function getAuditLogs(): AuditLogEntry[] {
  return [...auditLogs];
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string") {
    return realIp;
  }
  return req.socket.remoteAddress || req.ip || "unknown";
}

export function getBaseUrl(req: Request): string {
  const host = req.get("host") || "localhost:3000";
  const proto = req.get("x-forwarded-proto") || req.protocol || "http";
  return `${proto}://${host}`;
}
