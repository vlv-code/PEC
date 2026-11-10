import test from "node:test";
import assert from "node:assert/strict";
import { logger, sanitizeLogValue } from "../src/logger.js";

test("logger.sanitize: masks sensitive keys in objects", () => {
  const sensitiveObj = {
    username: "alice",
    token: "secret_token_12345",
    admin_token: "super_secret_admin",
    ext_shared_token: "fleet_token_999",
    password: "Password123!",
    adminPass: "3xuiAdminPass123",
    xuiPass: "xuiSecretPass456",
    clientPass: "clientSecret789",
    credential: "cert_credential_data",
    nested: {
      cookie: "session_id=abcdef",
      regularField: "hello",
      apiSecret: "xyz987",
    },
  };

  const sanitized = sanitizeLogValue(sensitiveObj) as Record<string, any>;
  assert.equal(sanitized.username, "alice");
  assert.equal(sanitized.token, "[REDACTED]");
  assert.equal(sanitized.admin_token, "[REDACTED]");
  assert.equal(sanitized.ext_shared_token, "[REDACTED]");
  assert.equal(sanitized.password, "[REDACTED]");
  assert.equal(sanitized.adminPass, "[REDACTED]");
  assert.equal(sanitized.xuiPass, "[REDACTED]");
  assert.equal(sanitized.clientPass, "[REDACTED]");
  assert.equal(sanitized.credential, "[REDACTED]");
  assert.equal(sanitized.nested.cookie, "[REDACTED]");
  assert.equal(sanitized.nested.regularField, "hello");
  assert.equal(sanitized.nested.apiSecret, "[REDACTED]");
});

test("logger.sanitize: handles circular references safely", () => {
  const circularObj: Record<string, any> = { name: "loop" };
  circularObj.self = circularObj;

  const sanitized = sanitizeLogValue(circularObj) as Record<string, any>;
  assert.equal(sanitized.name, "loop");
  assert.equal(sanitized.self, "[Circular]");
});

test("logger.sanitize: masks URL Basic Auth, token patterns and env tokens in strings", () => {
  // Basic Auth URLs
  const urlString = "Connecting to 3x-ui at https://admin_user:SuperSecretPassword123@10.0.0.1:2053/panel";
  assert.equal(
    sanitizeLogValue(urlString),
    "Connecting to 3x-ui at https://admin_user:[REDACTED]@10.0.0.1:2053/panel"
  );

  // Key-value credentials in strings
  const kvString = 'config: adminPass="SuperXuiSecret" xuiPass: "Secret2" clientPass=\'Secret3\'';
  const sanitizedKv = sanitizeLogValue(kvString) as string;
  assert.ok(!sanitizedKv.includes("SuperXuiSecret"));
  assert.ok(!sanitizedKv.includes("Secret2"));
  assert.ok(!sanitizedKv.includes("Secret3"));
  assert.ok(sanitizedKv.includes('adminPass="[REDACTED]"'));

  // Query parameters & Bearer
  const strWithToken = "GET /api/sync?token=sensitive_token_abc&profile=1";
  assert.equal(sanitizeLogValue(strWithToken), "GET /api/sync?token=[REDACTED]&profile=1");

  const strWithBearer = "Authorization: Bearer my_jwt_token_here";
  assert.equal(sanitizeLogValue(strWithBearer), "Authorization: Bearer [REDACTED]");

  // Dynamic environment variable masking
  const prevAdminToken = process.env.ADMIN_TOKEN;
  const prevFleetToken = process.env.EXT_SHARED_TOKEN;
  try {
    process.env.ADMIN_TOKEN = "custom_super_admin_secret_998877";
    process.env.EXT_SHARED_TOKEN = "custom_fleet_secret_112233";

    const logWithDirectTokens = "Failure authenticating with custom_super_admin_secret_998877 and fleet custom_fleet_secret_112233";
    const sanitizedDirect = sanitizeLogValue(logWithDirectTokens) as string;
    assert.ok(!sanitizedDirect.includes("custom_super_admin_secret_998877"));
    assert.ok(!sanitizedDirect.includes("custom_fleet_secret_112233"));
    assert.equal(sanitizedDirect, "Failure authenticating with [REDACTED] and fleet [REDACTED]");
  } finally {
    process.env.ADMIN_TOKEN = prevAdminToken;
    process.env.EXT_SHARED_TOKEN = prevFleetToken;
  }
});

test("logger levels: respects setLevel and level weights", () => {
  const originalLevel = logger.getLevel();

  try {
    logger.setLevel("error");
    assert.equal(logger.isEnabled("debug"), false);
    assert.equal(logger.isEnabled("info"), false);
    assert.equal(logger.isEnabled("warn"), false);
    assert.equal(logger.isEnabled("error"), true);

    logger.setLevel("debug");
    assert.equal(logger.isEnabled("debug"), true);
    assert.equal(logger.isEnabled("info"), true);
    assert.equal(logger.isEnabled("warn"), true);
    assert.equal(logger.isEnabled("error"), true);
  } finally {
    logger.setLevel(originalLevel);
  }
});

test("logger JSON output: outputs valid JSON in production mode with redacted credentials", () => {
  const prevEnv = process.env.NODE_ENV;
  const stdoutWrites: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  try {
    process.env.NODE_ENV = "production";
    logger.setLevel("info");

    (process.stdout as any).write = (chunk: string | Buffer) => {
      stdoutWrites.push(String(chunk));
      return true;
    };

    logger.info("Test production log entry", {
      clientIp: "127.0.0.1",
      token: "secret_123",
      adminPass: "3xui_pass_secret",
    });

    assert.equal(stdoutWrites.length, 1);
    const parsed = JSON.parse(stdoutWrites[0]);
    assert.equal(parsed.level, "info");
    assert.equal(parsed.message, "Test production log entry");
    assert.equal(parsed.msg, "Test production log entry");
    assert.ok(parsed.time);
    assert.equal(parsed.clientIp, "127.0.0.1");
    assert.equal(parsed.token, "[REDACTED]");
    assert.equal(parsed.adminPass, "[REDACTED]");
    assert.ok(parsed.timestamp);
  } finally {
    process.env.NODE_ENV = prevEnv;
    process.stdout.write = originalWrite;
  }
});

test("logger JSON structure: validates presence of level, time, and msg fields", () => {
  const prevEnv = process.env.NODE_ENV;
  const stdoutWrites: string[] = [];
  const stderrWrites: string[] = [];
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);

  try {
    process.env.NODE_ENV = "production";
    logger.setLevel("debug");

    (process.stdout as any).write = (chunk: string | Buffer) => {
      stdoutWrites.push(String(chunk));
      return true;
    };
    (process.stderr as any).write = (chunk: string | Buffer) => {
      stderrWrites.push(String(chunk));
      return true;
    };

    // 1. Info level output
    logger.info("Fleet instance connected", { instanceId: "inst-42", fleet: "corp" });
    assert.equal(stdoutWrites.length, 1);
    const infoEntry = JSON.parse(stdoutWrites[0]);

    assert.equal(typeof infoEntry, "object", "JSON log line must be an object");
    assert.equal(infoEntry.level, "info", "level must be 'info'");
    assert.ok(typeof infoEntry.time === "string" && infoEntry.time.length > 0, "time must be a valid timestamp string");
    assert.equal(infoEntry.msg, "Fleet instance connected", "msg must match log message");
    assert.equal(infoEntry.instanceId, "inst-42");
    assert.equal(infoEntry.fleet, "corp");

    // 2. Error level output
    logger.error("Upstream proxy failure", { proxyHost: "192.168.1.100", port: 10809 });
    assert.equal(stderrWrites.length, 1);
    const errorEntry = JSON.parse(stderrWrites[0]);

    assert.equal(errorEntry.level, "error", "level must be 'error'");
    assert.ok(typeof errorEntry.time === "string" && errorEntry.time.length > 0, "time must be a valid timestamp string");
    assert.equal(errorEntry.msg, "Upstream proxy failure", "msg must match log message");
    assert.equal(errorEntry.proxyHost, "192.168.1.100");
    assert.equal(errorEntry.port, 10809);
  } finally {
    process.env.NODE_ENV = prevEnv;
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
  }
});

test("logger LOG_LEVEL filtering: dynamically filters messages based on LOG_LEVEL environment variable", () => {
  const prevEnv = process.env.NODE_ENV;
  const prevLogLevel = process.env.LOG_LEVEL;
  const stdoutWrites: string[] = [];
  const stderrWrites: string[] = [];
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);

  try {
    process.env.NODE_ENV = "production";

    (process.stdout as any).write = (chunk: string | Buffer) => {
      stdoutWrites.push(String(chunk));
      return true;
    };
    (process.stderr as any).write = (chunk: string | Buffer) => {
      stderrWrites.push(String(chunk));
      return true;
    };

    // 1. LOG_LEVEL = error: only error logs emitted
    process.env.LOG_LEVEL = "error";
    stdoutWrites.length = 0;
    stderrWrites.length = 0;

    logger.debug("Debug msg under error level");
    logger.info("Info msg under error level");
    logger.warn("Warn msg under error level");
    assert.equal(stdoutWrites.length, 0, "debug, info, warn must be filtered out when LOG_LEVEL=error");
    assert.equal(stderrWrites.length, 0, "no stderr writes before error call");

    logger.error("Critical failure under error level");
    assert.equal(stderrWrites.length, 1, "error message must be emitted when LOG_LEVEL=error");
    assert.equal(JSON.parse(stderrWrites[0]).msg, "Critical failure under error level");

    // 2. LOG_LEVEL = warn: warn and error emitted, debug and info filtered
    process.env.LOG_LEVEL = "warn";
    stdoutWrites.length = 0;
    stderrWrites.length = 0;

    logger.debug("Debug msg under warn level");
    logger.info("Info msg under warn level");
    assert.equal(stdoutWrites.length, 0, "debug and info must be filtered out when LOG_LEVEL=warn");

    logger.warn("Warning msg under warn level");
    assert.equal(stdoutWrites.length, 1, "warn must be emitted when LOG_LEVEL=warn");
    assert.equal(JSON.parse(stdoutWrites[0]).msg, "Warning msg under warn level");

    logger.error("Error msg under warn level");
    assert.equal(stderrWrites.length, 1, "error must be emitted when LOG_LEVEL=warn");

    // 3. LOG_LEVEL = info: info, warn, error emitted, debug filtered
    process.env.LOG_LEVEL = "info";
    stdoutWrites.length = 0;
    stderrWrites.length = 0;

    logger.debug("Debug msg under info level");
    assert.equal(stdoutWrites.length, 0, "debug must be filtered out when LOG_LEVEL=info");

    logger.info("Info msg under info level");
    assert.equal(stdoutWrites.length, 1, "info must be emitted when LOG_LEVEL=info");

    // 4. LOG_LEVEL = debug: all levels emitted
    process.env.LOG_LEVEL = "debug";
    stdoutWrites.length = 0;
    stderrWrites.length = 0;

    logger.debug("Debug msg under debug level");
    assert.equal(stdoutWrites.length, 1, "debug must be emitted when LOG_LEVEL=debug");
    assert.equal(JSON.parse(stdoutWrites[0]).msg, "Debug msg under debug level");
  } finally {
    process.env.NODE_ENV = prevEnv;
    process.env.LOG_LEVEL = prevLogLevel;
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
  }
});
