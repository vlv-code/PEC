import crypto from "node:crypto";

/**
 * Server-side admin sessions for the management dashboard.
 *
 * The dashboard never holds the admin token in the browser: the operator
 * logs in once with the admin password and receives an HttpOnly session
 * cookie. Sessions live in process memory (consistent with the documented
 * single-process architecture) with a sliding TTL - a server restart simply
 * requires logging in again, and logout revokes immediately.
 */

export const SESSION_COOKIE_NAME = "pec_admin_session";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours, sliding

export const CSRF_HEADER_NAME = "x-requested-with";
export const CSRF_HEADER_VALUE = "pec-dashboard";

interface AdminSession {
  id: string;
  createdAt: number;
  expiresAt: number;
  ip: string;
}

const sessions = new Map<string, AdminSession>();

// Periodic cleanup of expired sessions (does not keep the process alive).
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions.entries()) {
    if (now > s.expiresAt) {
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000);
cleanup.unref?.();

export function createAdminSession(ip: string): { id: string; expiresAt: number } {
  const id = crypto.randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(id, { id, createdAt: Date.now(), expiresAt, ip });
  return { id, expiresAt };
}

/**
 * Validate a session id and slide its expiry forward (active operators stay
 * logged in; idle sessions die after SESSION_TTL_MS).
 */
export function validateAdminSession(id: string | undefined | null): boolean {
  if (!id) return false;
  const session = sessions.get(id);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    sessions.delete(id);
    return false;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return true;
}

export function revokeAdminSession(id: string | undefined | null): boolean {
  if (!id) return false;
  return sessions.delete(id);
}

export function getSessionExpiry(id: string | undefined | null): number | null {
  if (!id || !sessions.has(id)) return null;
  const session = sessions.get(id)!;
  return Date.now() > session.expiresAt ? null : session.expiresAt;
}

/** Test hygiene: drop every session. */
export function clearAllSessions(): void {
  sessions.clear();
}

/** Minimal cookie parser (no external dependency). */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  }
  return out;
}

/** Build the Set-Cookie value for a fresh session (HttpOnly, CSRF-safe). */
export function buildSessionCookie(id: string, secure: boolean): string {
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
  const flags = `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}`;
  return `${SESSION_COOKIE_NAME}=${id}; ${flags}${secure ? "; Secure" : ""}`;
}

/** Cookie value that expires the session client-side. */
export function buildLogoutCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

/** True when the request came over TLS (directly or via a trusted proxy). */
export function requestIsSecure(req: { secure?: boolean; headers: Record<string, unknown> }): boolean {
  const proto = String(req.headers["x-forwarded-proto"] || "");
  return Boolean(req.secure) || proto.split(",")[0].trim() === "https";
}
