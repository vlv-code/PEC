import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { createBuilderRouter } from "../src/routes/builderRoutes.js";
import { createAppBuilderRouter, validateProcessRules, isValidDomainPattern } from "../src/routes/appBuilderRoutes.js";
import { getBuildConfig, saveBuildConfig, SEMVER_REGEX } from "../src/packager.js";
import { getAppBuildConfig, saveAppBuildConfig, buildAppProfile } from "../src/appPackager.js";
import { TEST_TOKEN, TEST_ADMIN_TOKEN } from "./helpers/setup.js";

function setupBuilderServer() {
  const app = express();
  app.use(express.json());
  app.use(createBuilderRouter(() => TEST_TOKEN, () => TEST_ADMIN_TOKEN));
  return app;
}

function setupAppBuilderServer() {
  const app = express();
  app.use(express.json());
  app.use(createAppBuilderRouter(() => TEST_TOKEN, () => TEST_ADMIN_TOKEN));
  return app;
}

async function withServer<T>(app: express.Express, fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    return await fn(baseUrl);
  } finally {
    if (typeof (server as any).closeAllConnections === "function") {
      (server as any).closeAllConnections();
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// =============================================================================
// P-01: Strict SemVer Validation in builderRoutes.ts (POST /api/builder/config)
// =============================================================================

test("P-01: SEMVER_REGEX strictly matches SemVer 2.0.0 specification", () => {
  // Valid SemVer 2.0.0
  assert.equal(SEMVER_REGEX.test("1.0.0"), true);
  assert.equal(SEMVER_REGEX.test("0.0.0"), true);
  assert.equal(SEMVER_REGEX.test("1.2.3"), true);
  assert.equal(SEMVER_REGEX.test("2.0.0-rc.1"), true);
  assert.equal(SEMVER_REGEX.test("1.0.0-beta-1"), true); // Hyphens allowed in pre-release
  assert.equal(SEMVER_REGEX.test("1.0.0-alpha.1"), true);
  assert.equal(SEMVER_REGEX.test("1.0.0+build.1"), true); // Build metadata
  assert.equal(SEMVER_REGEX.test("1.0.0-rc.1+build.123"), true); // Both pre-release and build

  // Invalid SemVer: leading zeroes forbidden by SemVer 2.0.0 Section 2
  assert.equal(SEMVER_REGEX.test("01.0.0"), false);
  assert.equal(SEMVER_REGEX.test("1.02.0"), false);
  assert.equal(SEMVER_REGEX.test("1.0.03"), false);

  // Invalid SemVer: empty or invalid pre-release / build segments
  assert.equal(SEMVER_REGEX.test("1.0.0-.."), false);
  assert.equal(SEMVER_REGEX.test("1.0.0-01"), false); // Leading zero in numeric pre-release
  assert.equal(SEMVER_REGEX.test("1.0.0-"), false);
  assert.equal(SEMVER_REGEX.test("1.0.0+"), false);
  assert.equal(SEMVER_REGEX.test("1.0.0+build..1"), false);

  // Invalid SemVer: path traversal, command injection, malformed segments
  assert.equal(SEMVER_REGEX.test("../../etc/passwd"), false);
  assert.equal(SEMVER_REGEX.test("..\\..\\evil"), false);
  assert.equal(SEMVER_REGEX.test("1.0"), false);
  assert.equal(SEMVER_REGEX.test("1"), false);
  assert.equal(SEMVER_REGEX.test("v1.0.0"), false);
  assert.equal(SEMVER_REGEX.test("1.0.0.0"), false);
});

test("P-01: POST /api/builder/config accepts valid SemVer versions and trims whitespace", async () => {
  await withServer(setupBuilderServer(), async (baseUrl) => {
    // 1. Standard semver
    const res1 = await fetch(`${baseUrl}/api/builder/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: "1.2.3" }),
    });
    assert.equal(res1.status, 200);
    const body1 = await res1.json();
    assert.equal(body1.version, "1.2.3");
    assert.equal(getBuildConfig().version, "1.2.3");

    // 2. Semver with pre-release tag
    const res2 = await fetch(`${baseUrl}/api/builder/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: "2.0.0-rc.1" }),
    });
    assert.equal(res2.status, 200);
    const body2 = await res2.json();
    assert.equal(body2.version, "2.0.0-rc.1");

    // 3. Semver with pre-release containing hyphen
    const res3 = await fetch(`${baseUrl}/api/builder/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: "1.0.0-beta-1" }),
    });
    assert.equal(res3.status, 200);
    const body3 = await res3.json();
    assert.equal(body3.version, "1.0.0-beta-1");

    // 4. Semver with build metadata
    const res4 = await fetch(`${baseUrl}/api/builder/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: "1.0.0+build.1" }),
    });
    assert.equal(res4.status, 200);
    const body4 = await res4.json();
    assert.equal(body4.version, "1.0.0+build.1");

    // 5. Semver with surrounding whitespace is trimmed
    const res5 = await fetch(`${baseUrl}/api/builder/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: "  3.4.5  " }),
    });
    assert.equal(res5.status, 200);
    const body5 = await res5.json();
    assert.equal(body5.version, "3.4.5");
    assert.equal(getBuildConfig().version, "3.4.5");
  });
});

test("P-01: POST /api/builder/config rejects invalid version formats with 400 Bad Request", async () => {
  await withServer(setupBuilderServer(), async (baseUrl) => {
    const invalidVersions = [
      "../../etc/passwd",        // Path traversal
      "..\\..\\windows\\system",  // Windows path traversal
      "1.0",                     // Missing patch
      "1",                       // Single number
      "v1.0.0",                  // Leading 'v'
      "1.0.0.0",                 // Four segments
      "",                        // Empty string
      "   ",                     // Whitespace only
      "1.0.0; rm -rf /",         // Command injection
      "1.0.0 & calc.exe",        // Windows cmd injection
      "beta-1.0.0",              // Non-numeric prefix
      "01.0.0",                  // Leading zero in major (SemVer 2.0.0 violation)
      "1.02.0",                  // Leading zero in minor
      "1.0.03",                  // Leading zero in patch
      "1.0.0-..",                // Empty pre-release segment
      "1.0.0-01",                // Leading zero in numeric pre-release segment
      "1.0.0-",                  // Empty pre-release tag
      "1.0.0+",                  // Empty build metadata tag
    ];

    for (const badVer of invalidVersions) {
      const res = await fetch(`${baseUrl}/api/builder/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: badVer }),
      });
      assert.equal(res.status, 400, `Expected 400 for version '${badVer}'`);
      const body = await res.json();
      assert.equal(body.ok, false);
      assert.match(body.error, /must follow semver/i);
    }
  });
});

test("P-01: POST /api/builder/config rejects non-string version types", async () => {
  await withServer(setupBuilderServer(), async (baseUrl) => {
    const nonStringTypes = [
      null,
      123,
      true,
      false,
      {},
      ["1.0.0"],
    ];

    for (const val of nonStringTypes) {
      const res = await fetch(`${baseUrl}/api/builder/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: val }),
      });
      assert.equal(res.status, 400, `Expected 400 for non-string version '${JSON.stringify(val)}'`);
      const body = await res.json();
      assert.equal(body.ok, false);
      assert.match(body.error, /must follow semver/i);
    }
  });
});

test("P-01: POST /api/builder/config allows updating other fields without changing version", async () => {
  await withServer(setupBuilderServer(), async (baseUrl) => {
    saveBuildConfig({ version: "1.0.0", name: "Initial Name" });

    const res = await fetch(`${baseUrl}/api/builder/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated Corporate Name", syncIntervalMinutes: 30 }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.name, "Updated Corporate Name");
    assert.equal(body.version, "1.0.0");
    assert.equal(getBuildConfig().version, "1.0.0");
  });
});

test("P-01: POST /api/builder/build also validates and rejects invalid version", async () => {
  await withServer(setupBuilderServer(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/builder/build`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: "../../evil_path" }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /must follow semver/i);
  });
});

// =============================================================================
// D-04: targetDomains Preservation and Validation in appBuilderRoutes.ts
// =============================================================================

test("D-04: isValidDomainPattern validates RFC 1123 domains, ports, and wildcards strictly", () => {
  // Valid patterns
  assert.equal(isValidDomainPattern("*"), true);
  assert.equal(isValidDomainPattern("*.youtube.com"), true);
  assert.equal(isValidDomainPattern(".sub.test.corp"), true);
  assert.equal(isValidDomainPattern("example.com"), true);
  assert.equal(isValidDomainPattern("x.com"), true);
  assert.equal(isValidDomainPattern("example.com:8080"), true);
  assert.equal(isValidDomainPattern("example.com:443"), true);
  assert.equal(isValidDomainPattern("example.com:65535"), true);
  assert.equal(isValidDomainPattern("*.яндекс.рф"), true);
  assert.equal(isValidDomainPattern("_sip._tcp.internal"), true);
  assert.equal(isValidDomainPattern("192.168.1.1"), true);

  // Embedded wildcards (rejected)
  assert.equal(isValidDomainPattern("foo*bar.com"), false);
  assert.equal(isValidDomainPattern("*.*"), false);
  assert.equal(isValidDomainPattern("***"), false);
  assert.equal(isValidDomainPattern("*.**"), false);
  assert.equal(isValidDomainPattern("*."), false);

  // Hyphen violations (rejected)
  assert.equal(isValidDomainPattern("-example.com"), false);
  assert.equal(isValidDomainPattern("example-.com"), false);
  assert.equal(isValidDomainPattern("---.---"), false);

  // Port violations (rejected)
  assert.equal(isValidDomainPattern("example.com:0"), false);
  assert.equal(isValidDomainPattern("example.com:65536"), false);
  assert.equal(isValidDomainPattern("example.com:99999"), false);
  assert.equal(isValidDomainPattern("example.com:"), false);

  // Empty labels / consecutive dots (rejected)
  assert.equal(isValidDomainPattern("evil..com"), false);
  assert.equal(isValidDomainPattern(".evil..com"), false);

  // Injection and paths (rejected)
  assert.equal(isValidDomainPattern("../../etc/passwd"), false);
  assert.equal(isValidDomainPattern("http://example.com"), false);
  assert.equal(isValidDomainPattern("https://example.com"), false);
  assert.equal(isValidDomainPattern("example.com/path"), false);
  assert.equal(isValidDomainPattern("& calc.exe"), false);
  assert.equal(isValidDomainPattern("<script>"), false);
});

test("D-04: validateProcessRules preserves valid targetDomains formats", () => {
  const rules = [
    {
      id: "r1",
      processName: "chrome.exe",
      targetDomains: "*.youtube.com; *.googlevideo.com; *.ytimg.com",
      targetHosts: "*",
      targetPorts: "80; 443",
      protocol: "tcp",
      action: "proxy",
    },
    {
      id: "r2",
      processName: "curl.exe",
      targetDomains: "*",
      protocol: "tcp",
      action: "proxy",
    },
    {
      id: "r3",
      processName: "*",
      targetDomains: "*.corp; *.local; *.internal",
      protocol: "both",
      action: "direct",
    },
    {
      id: "r4",
      processName: "firefox.exe",
      targetDomains: "example.com:8080; .sub.test.corp; *.яндекс.рф; _sip._tcp.internal",
      protocol: "tcp",
      action: "proxy",
    },
    {
      id: "r5",
      processName: "git.exe",
      targetDomains: "  github.com ;  gitlab.corp.local  ",
      protocol: "tcp",
      action: "proxy",
    },
    {
      id: "r6",
      processName: "tool.exe",
      targetDomains: "",
      protocol: "tcp",
      action: "direct",
    },
  ];

  const validated = validateProcessRules(rules);

  assert.equal(validated.length, 6);
  assert.equal(validated[0].targetDomains, "*.youtube.com; *.googlevideo.com; *.ytimg.com");
  assert.equal(validated[1].targetDomains, "*");
  assert.equal(validated[2].targetDomains, "*.corp; *.local; *.internal");
  assert.equal(validated[3].targetDomains, "example.com:8080; .sub.test.corp; *.яндекс.рф; _sip._tcp.internal");
  assert.equal(validated[4].targetDomains, "github.com ;  gitlab.corp.local");
  assert.equal(validated[5].targetDomains, "");
});

test("D-04: validateProcessRules leaves targetDomains undefined when omitted", () => {
  const rules = [
    {
      id: "r1",
      processName: "curl.exe",
      targetHosts: "github.com; 10.0.0.1",
      protocol: "tcp",
      action: "proxy",
    },
  ];

  const validated = validateProcessRules(rules);
  assert.equal(validated.length, 1);
  assert.equal(validated[0].targetDomains, undefined);
});

test("D-04: validateProcessRules rejects invalid targetDomains with descriptive errors", () => {
  const testInvalid = (invalidTargetDomains: any, expectedMatch: RegExp) => {
    assert.throws(
      () => {
        validateProcessRules([
          {
            id: "bad_rule",
            processName: "test.exe",
            targetDomains: invalidTargetDomains,
            protocol: "tcp",
            action: "proxy",
          },
        ]);
      },
      expectedMatch
    );
  };

  // 1. Non-string types
  testInvalid(12345, /must be a string/i);
  testInvalid(null, /must be a string/i);
  testInvalid(true, /must be a string/i);
  testInvalid(["domain.com"], /must be a string/i);
  testInvalid({ domain: "evil.com" }, /must be a string/i);

  // 2. Command and shell injection
  testInvalid("*.youtube.com; & calc.exe", /invalid domain pattern/i);
  testInvalid("*.youtube.com; $(whoami)", /invalid domain pattern/i);
  testInvalid("*.youtube.com; `id`", /invalid domain pattern/i);
  testInvalid("*.youtube.com; | nc -l 4444", /invalid domain pattern/i);

  // 3. XSS and HTML payloads
  testInvalid("<script>alert('xss')</script>", /invalid domain pattern/i);
  testInvalid("domain.com<img src=x onerror=alert(1)>", /invalid domain pattern/i);

  // 4. Path traversal and URL schemes
  testInvalid("../../etc/passwd", /invalid domain pattern/i);
  testInvalid("http://example.com", /invalid domain pattern/i);
  testInvalid("https://example.com", /invalid domain pattern/i);
  testInvalid("example.com/api/test", /invalid domain pattern/i);

  // 5. Control characters and newlines
  testInvalid("example.com\nevil.com", /contains forbidden control characters/i);
  testInvalid("example.com\r\nevil.com", /contains forbidden control characters/i);
  testInvalid("example.com\0evil.com", /contains forbidden control characters/i);

  // 6. Excessive length (>2048 chars)
  testInvalid("a".repeat(2049), /exceeds maximum length/i);

  // 7. Semicolons only without domain entries
  testInvalid(";;;", /contains no valid domain entries/i);
  testInvalid("  ;  ;  ", /contains no valid domain entries/i);

  // 8. Consecutive dots or spaces inside domain label
  testInvalid("evil..com", /invalid domain pattern/i);
  testInvalid("evil com.local", /invalid domain pattern/i);

  // 9. Embedded wildcards (P-01 / D-04 security attack)
  testInvalid("foo*bar.com", /invalid domain pattern/i);
  testInvalid("*.*", /invalid domain pattern/i);
  testInvalid("***", /invalid domain pattern/i);

  // 10. Hyphen boundary violations
  testInvalid("-example.com", /invalid domain pattern/i);
  testInvalid("example-.com", /invalid domain pattern/i);
  testInvalid("---.---", /invalid domain pattern/i);

  // 11. Invalid port boundaries
  testInvalid("example.com:0", /invalid domain pattern/i);
  testInvalid("example.com:65536", /invalid domain pattern/i);
  testInvalid("example.com:99999", /invalid domain pattern/i);
});

test("D-04: POST /api/app-builder/config saves and preserves targetDomains in processRules", async () => {
  await withServer(setupAppBuilderServer(), async (baseUrl) => {
    const rules = [
      {
        id: "rule_video",
        processName: "chrome.exe",
        targetDomains: "*.youtube.com; *.googlevideo.com",
        targetHosts: "*",
        targetPorts: "443",
        protocol: "tcp",
        action: "proxy",
      },
      {
        id: "rule_corp",
        processName: "*",
        targetDomains: "*.corp.internal",
        targetHosts: "10.0.0.0/8",
        targetPorts: "*",
        protocol: "both",
        action: "direct",
      },
    ];

    const postRes = await fetch(`${baseUrl}/api/app-builder/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ processRules: rules }),
    });

    assert.equal(postRes.status, 200);
    const postBody = await postRes.json();
    assert.equal(postBody.ok, true);
    assert.equal(postBody.processRules.length, 2);
    assert.equal(postBody.processRules[0].targetDomains, "*.youtube.com; *.googlevideo.com");
    assert.equal(postBody.processRules[1].targetDomains, "*.corp.internal");

    // Verify persisted config on disk retains targetDomains
    const saved = getAppBuildConfig();
    assert.equal(saved.processRules[0].targetDomains, "*.youtube.com; *.googlevideo.com");
    assert.equal(saved.processRules[1].targetDomains, "*.corp.internal");

    // Verify GET endpoint returns targetDomains
    const getRes = await fetch(`${baseUrl}/api/app-builder/config`);
    assert.equal(getRes.status, 200);
    const getBody = await getRes.json();
    assert.equal(getBody.processRules[0].targetDomains, "*.youtube.com; *.googlevideo.com");
    assert.equal(getBody.processRules[1].targetDomains, "*.corp.internal");
  });
});

test("D-04: POST /api/app-builder/config returns 400 when processRules have invalid targetDomains", async () => {
  await withServer(setupAppBuilderServer(), async (baseUrl) => {
    const badRes = await fetch(`${baseUrl}/api/app-builder/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        processRules: [
          {
            id: "bad_rule",
            processName: "curl.exe",
            targetDomains: "evil.com & calc.exe",
            protocol: "tcp",
            action: "proxy",
          },
        ],
      }),
    });

    assert.equal(badRes.status, 400);
    const body = await badRes.json();
    assert.match(body.error, /invalid domain pattern/i);
  });
});

test("D-04: buildAppProfile correctly populates TargetDomains from preserved processRules", () => {
  const cfg = {
    ...getAppBuildConfig(),
    processRules: [
      {
        id: "rule_domain_proxy",
        processName: "chrome.exe",
        targetDomains: "*.youtube.com; *.instagram.com",
        targetHosts: "*",
        targetPorts: "443",
        protocol: "tcp" as const,
        action: "proxy" as const,
      },
    ],
  };

  const profile = buildAppProfile(cfg, "https://pec.example.corp") as any;
  const rule = profile.ProxyRules[0];

  assert.equal(rule.TargetDomains, "*.youtube.com; *.instagram.com");
  assert.equal(rule.ProcessName, "chrome.exe");
  assert.equal(rule.Protocol, "TCP");
  assert.equal(rule.Action, "PROXY");
});
