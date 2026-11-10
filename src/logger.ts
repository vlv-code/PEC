/**
 * Lightweight, zero-dependency logging module for PEC.
 * Supports:
 * - Formats: JSON for production (NODE_ENV=production), human-readable text for dev/test.
 * - Log levels: debug (0), info (1), warn (2), error (3), controlled via LOG_LEVEL env var.
 * - Automatic recursive sanitization of sensitive fields (token, password, cookie, secret, adminPass, xuiPass, etc.).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHTS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const SENSITIVE_KEY_PATTERN =
  /(?:token|password|passwd|pass$|adminPass|xuiPass|clientPass|secret|cookie|auth|authorization|admin_token|ext_shared_token|key\.pem|private_key|credential)/i;

/**
 * Recursively sanitizes data by redacting sensitive keys and masking credential patterns in strings.
 */
export function sanitizeLogValue(val: unknown, seen = new WeakSet<object>()): unknown {
  if (val === null || val === undefined) {
    return val;
  }

  if (typeof val === "string") {
    let sanitized = val
      // 1. Mask URL Basic Auth: https://user:password@host:port
      .replace(/(https?:\/\/)([^:\s\/]+):([^@\s\/]+)@/gi, "$1$2:[REDACTED]@")
      // 2. Mask key-value credentials in strings (e.g. adminPass="secret", token: "xyz")
      .replace(
        /((?:adminPass|xuiPass|clientPass|password|passwd|secret|token|x-admin-token|x-ext-token|x-fleet-token)\s*[:=]\s*["']?)[^"',\s&}]+/gi,
        "$1[REDACTED]"
      )
      // 3. Mask query parameters
      .replace(/([?&](?:token|password|secret|auth|adminToken)=)[^&]+/gi, "$1[REDACTED]")
      // 4. Mask Bearer authorization tokens
      .replace(/(Bearer\s+)[A-Za-z0-9_\-.]+/gi, "$1[REDACTED]");

    // 5. Dynamic exact token redaction from active environment variables
    const adminToken = (process.env.ADMIN_TOKEN || "").trim();
    if (adminToken.length >= 8 && sanitized.includes(adminToken)) {
      sanitized = sanitized.split(adminToken).join("[REDACTED]");
    }
    const extToken = (process.env.EXT_SHARED_TOKEN || "").trim();
    if (
      extToken.length >= 8 &&
      extToken !== "corp-proxy-secret-token-change-me" &&
      sanitized.includes(extToken)
    ) {
      sanitized = sanitized.split(extToken).join("[REDACTED]");
    }

    return sanitized;
  }

  if (typeof val !== "object") {
    return val;
  }

  if (seen.has(val)) {
    return "[Circular]";
  }
  seen.add(val);

  if (Array.isArray(val)) {
    return val.map((item) => sanitizeLogValue(item, seen));
  }

  if (val instanceof Error) {
    return {
      name: val.name,
      message: sanitizeLogValue(val.message, seen),
      stack: sanitizeLogValue(val.stack, seen),
    };
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, propVal] of Object.entries(val as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = sanitizeLogValue(propVal, seen);
    }
  }
  return sanitized;
}

class Logger {
  private currentLevel: LogLevel = "info";

  constructor() {
    this.refreshLevelFromEnv();
  }

  public refreshLevelFromEnv(): void {
    const envLevel = (process.env.LOG_LEVEL || "").trim().toLowerCase();
    if (envLevel in LEVEL_WEIGHTS) {
      this.currentLevel = envLevel as LogLevel;
    } else if (process.env.NODE_ENV === "test") {
      this.currentLevel = "warn";
    } else {
      this.currentLevel = "info";
    }
  }

  public getLevel(): LogLevel {
    const envLevel = (process.env.LOG_LEVEL || "").trim().toLowerCase();
    if (envLevel in LEVEL_WEIGHTS) {
      return envLevel as LogLevel;
    }
    return this.currentLevel;
  }

  public setLevel(level: LogLevel): void {
    if (level in LEVEL_WEIGHTS) {
      this.currentLevel = level;
    }
  }

  public isEnabled(level: LogLevel): boolean {
    const effectiveLevel = this.getLevel();
    return LEVEL_WEIGHTS[level] >= LEVEL_WEIGHTS[effectiveLevel];
  }

  private write(level: LogLevel, message: string, ...args: unknown[]): void {
    if (!this.isEnabled(level)) {
      return;
    }

    const isProd = process.env.NODE_ENV === "production" || process.env.LOG_FORMAT === "json";
    const ts = new Date().toISOString();
    const sanitizedArgs = args.map((arg) => sanitizeLogValue(arg));
    const sanitizedMessage = typeof message === "string" ? (sanitizeLogValue(message) as string) : String(message);

    if (isProd) {
      const entry: Record<string, unknown> = {
        timestamp: ts,
        time: ts,
        level,
        message: sanitizedMessage,
        msg: sanitizedMessage,
      };

      if (
        sanitizedArgs.length === 1 &&
        typeof sanitizedArgs[0] === "object" &&
        sanitizedArgs[0] !== null &&
        !Array.isArray(sanitizedArgs[0])
      ) {
        Object.assign(entry, sanitizedArgs[0]);
      } else if (sanitizedArgs.length > 0) {
        entry.meta = sanitizedArgs;
      }

      const jsonLine = JSON.stringify(entry) + "\n";
      if (level === "error") {
        process.stderr.write(jsonLine);
      } else {
        process.stdout.write(jsonLine);
      }
    } else {
      const formattedPrefix = `${ts} [${level.toUpperCase()}] ${sanitizedMessage}`;
      if (level === "error") {
        console.error(formattedPrefix, ...sanitizedArgs);
      } else if (level === "warn") {
        console.warn(formattedPrefix, ...sanitizedArgs);
      } else {
        console.log(formattedPrefix, ...sanitizedArgs);
      }
    }
  }

  public debug(message: string, ...args: unknown[]): void {
    this.write("debug", message, ...args);
  }

  public info(message: string, ...args: unknown[]): void {
    this.write("info", message, ...args);
  }

  public warn(message: string, ...args: unknown[]): void {
    this.write("warn", message, ...args);
  }

  public error(message: string, ...args: unknown[]): void {
    this.write("error", message, ...args);
  }

  public sanitize(val: unknown): unknown {
    return sanitizeLogValue(val);
  }
}

export const logger = new Logger();
export default logger;
