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
    | "RATE_LIMITED"
    | "LOGIN_OK"
    | "LOGIN_FAILED"
    | "LOGOUT";
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
  // Express resolves req.ip according to the "trust proxy" setting:
  // - trust proxy off  -> socket address (spoofed X-Forwarded-For is ignored)
  // - trust proxy set  -> the client address as reported by the trusted proxy hop
  // Always use this helper; never parse X-Forwarded-For manually.
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function getBaseUrl(req: Request): string {
  // Explicitly configured public base URL wins: prevents Host-header poisoning
  // of generated artifacts (updates.xml codebase, GPO URLs) when the server is
  // reachable through a reverse proxy or untrusted networks.
  const configured = process.env.PUBLIC_BASE_URL;
  if (configured && configured.trim()) {
    return configured.trim().replace(/\/+$/, "");
  }
  const host = req.get("host") || "localhost:3000";
  const proto = req.get("x-forwarded-proto") || req.protocol || "http";
  return `${proto}://${host}`;
}
