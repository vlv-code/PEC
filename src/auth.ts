import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./jsonStore.js";

/**
 * Server-side admin sessions and dashboard credentials.
 *
 * The dashboard never holds any admin secret in the browser: the operator
 * logs in once with a username + password and receives an HttpOnly session
 * cookie. Credentials persist in a JSON store as a scrypt hash (never
 * plaintext) and can be changed from the dashboard settings; sessions live
 * in process memory (consistent with the documented single-process
 * architecture) with a sliding TTL - a server restart simply requires
 * logging in again, and logout revokes immediately.
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
  username: string;
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

export function createAdminSession(ip: string, username: string): { id: string; expiresAt: number } {
  const id = crypto.randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(id, { id, createdAt: Date.now(), expiresAt, ip, username });
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

export function getSessionUsername(id: string | undefined | null): string | null {
  if (!id) return null;
  const session = sessions.get(id);
  if (!session || Date.now() > session.expiresAt) return null;
  return session.username;
}

/** Test hygiene: drop every session. */
export function clearAllSessions(): void {
  sessions.clear();
}

/**
 * Revoke every session except the given one - used after a credential
 * change so a stolen cookie somewhere else dies immediately, while the
 * operator performing the change stays logged in.
 */
export function clearAllSessionsExcept(keepId: string | undefined | null): void {
  for (const id of sessions.keys()) {
    if (id !== keepId) {
      sessions.delete(id);
    }
  }
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

// ---------------------------------------------------------------------------
// Dashboard credentials (username + password hash)
//
// Stored as scrypt("salt$hash") in a JSON file - never plaintext. Bootstrapped
// once from ADMIN_USERNAME / ADMIN_PASSWORD (or the admin token as fallback
// password) and then changeable from the dashboard settings.
// ---------------------------------------------------------------------------

const AUTH_STORE_PATH = path.resolve(process.env.DASHBOARD_AUTH_PATH || "./dashboard_auth.json");

/** Where the credential store lives (exported for ops tooling and tests). */
export function getDashboardAuthStorePath(): string {
  return AUTH_STORE_PATH;
}
const SCRYPT_KEYLEN = 64;

interface DashboardCredentials {
  username: string;
  passwordHash: string; // "scrypt$<saltHex>$<hashHex>"
  updatedAt: string;
}

let credentials: DashboardCredentials | null = null;

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function verifyPasswordHash(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const actual = crypto.scryptSync(password, salt, expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function persistCredentials(): void {
  if (!credentials) return;
  writeJsonAtomic(AUTH_STORE_PATH, credentials);
}

/**
 * Load the credential store, creating it on first run. The bootstrap
 * password comes from ADMIN_PASSWORD or falls back to the admin token so a
 * fresh deployment needs no extra configuration; the operator is expected
 * to change it in the dashboard settings.
 */
export function initDashboardCredentials(bootstrap: { username: string; fallbackPassword: string }): { usingFallbackPassword: boolean } {
  try {
    if (fs.existsSync(AUTH_STORE_PATH)) {
      const data = JSON.parse(fs.readFileSync(AUTH_STORE_PATH, "utf-8"));
      if (data && typeof data.username === "string" && typeof data.passwordHash === "string") {
        credentials = data;
        return { usingFallbackPassword: false };
      }
    }
  } catch (err) {
    console.warn("[auth] dashboard_auth.json unreadable - re-bootstrapping credentials:", err);
  }

  const username = bootstrap.username;
  const password = process.env.ADMIN_PASSWORD || bootstrap.fallbackPassword;
  const usingFallbackPassword = !process.env.ADMIN_PASSWORD;
  credentials = {
    username,
    passwordHash: hashPassword(password),
    updatedAt: new Date().toISOString(),
  };
  persistCredentials();
  return { usingFallbackPassword };
}

/**
 * Verify a login attempt. Both comparisons are timing-safe and the generic
 * failure does not reveal whether the username or the password was wrong.
 */
export function verifyDashboardCredentials(username: string, password: string): boolean {
  if (!credentials || !username || !password) return false;
  const userOk = timingSafeEqualStrings(username.trim().toLowerCase(), credentials.username);
  if (!userOk) return false;
  return verifyPasswordHash(password, credentials.passwordHash);
}

export function getDashboardUsername(): string {
  return credentials?.username || "admin";
}

/** Change credentials (dashboard settings). Undefined fields stay as-is. */
export function updateDashboardCredentials(update: { username?: string; password?: string }): { username: string } {
  if (!credentials) {
    throw new Error("Credentials are not initialized");
  }
  if (update.username !== undefined) {
    credentials.username = update.username.trim().toLowerCase();
  }
  if (update.password !== undefined) {
    credentials.passwordHash = hashPassword(update.password);
  }
  credentials.updatedAt = new Date().toISOString();
  persistCredentials();
  return { username: credentials.username };
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = crypto.createHash("sha256").update(a, "utf-8").digest();
  const bufB = crypto.createHash("sha256").update(b, "utf-8").digest();
  return crypto.timingSafeEqual(bufA, bufB);
}
