import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

test("Task 1.1: README.md contains Enterprise Threat Model & Architectural Boundaries alert", () => {
  const readme = fs.readFileSync("README.md", "utf-8").replace(/\r\n/g, "\n");
  const expectedEnglishAlert = `> [!IMPORTANT]
> **Enterprise Threat Model & Architectural Boundaries**
> PEC is strictly designed for on-premise deployment in closed corporate intranets and enterprise VPNs. Chrome extensions and desktop clients are distributed via Active Directory Group Policies (GPO: ExtensionInstallForcelist, Registry). Security is enforced through perimeter network isolation, AD Security Filtering, and dynamic credential rotation — not via client-side secret obfuscation.`;

  assert.ok(
    readme.includes(expectedEnglishAlert),
    "README.md must contain the exact Enterprise Threat Model alert block"
  );
  // Verify it appears near the top (within the first 500 characters)
  const alertIndex = readme.indexOf(expectedEnglishAlert);
  assert.ok(alertIndex !== -1 && alertIndex < 500, "Alert block must be located at the top of README.md");
});

test("Task 1.1: README.ru.md contains Russian Enterprise Threat Model alert", () => {
  const readmeRu = fs.readFileSync("README.ru.md", "utf-8").replace(/\r\n/g, "\n");
  const expectedRussianAlert = `> [!IMPORTANT]
> **Корпоративная модель угроз и архитектурные границы**
> PEC разработан строго для on-premise развертывания в закрытых корпоративных интрасетях и корпоративных VPN. Расширения Chrome и десктопные клиенты доставляются через групповые политики Active Directory (GPO: ExtensionInstallForcelist, реестр). Безопасность обеспечивается сетевой изоляцией периметра, фильтрацией безопасности AD и динамической ротацией учетных данных, а не сокрытием секретов на стороне клиента.`;

  assert.ok(
    readmeRu.includes(expectedRussianAlert),
    "README.ru.md must contain the exact Russian Threat Model alert block"
  );
  const alertIndex = readmeRu.indexOf(expectedRussianAlert);
  assert.ok(alertIndex !== -1 && alertIndex < 500, "Alert block must be located at the top of README.ru.md");
});

test("Task 1.1: SECURITY.md contains Enterprise Threat Model & Architectural Scope documenting all 5 rejected audit items", () => {
  const sec = fs.readFileSync("SECURITY.md", "utf-8");
  assert.ok(
    sec.includes("## Enterprise Threat Model & Architectural Scope"),
    "SECURITY.md must include the dedicated scope section"
  );

  // 1. Client mTLS / eliminating shared fleet token in MV3 extension
  assert.ok(
    sec.includes("Client mTLS") || sec.includes("mTLS"),
    "Must document client mTLS rejection"
  );
  assert.ok(
    sec.includes("Chrome MV3") || sec.includes("MV3"),
    "Must document MV3 client-side secret extraction rationale"
  );

  // 2. Cloud HSM / EV Code Signing certificates
  assert.ok(
    sec.includes("Cloud HSM") || sec.includes("EV Code Signing"),
    "Must document Cloud HSM / EV code signing rejection"
  );
  assert.ok(
    sec.includes("Active Directory Certificate Services") || sec.includes("AD CS"),
    "Must document internal enterprise CA / AD CS rationale"
  );

  // 3. D-Bus/Polkit architecture for Linux GTK GUI
  assert.ok(
    sec.includes("D-Bus") && sec.includes("Polkit"),
    "Must document D-Bus / Polkit rejection"
  );
  assert.ok(
    sec.includes("headless systemd") || sec.includes("pec-app-linux.service"),
    "Must document headless systemd daemon rationale"
  );

  // 4. Ban on HKCU GPO registry scope
  assert.ok(
    sec.includes("HKCU") && sec.includes("HKLM"),
    "Must document HKCU vs HKLM GPO scope rationale"
  );
  assert.ok(
    sec.includes("User GPO") || sec.includes("-Scope User"),
    "Must document support for non-admin user-level deployments"
  );

  // 5. Russian translation of C-client driver/socket logs
  assert.ok(
    sec.includes("WinDivert") || sec.includes("SIEM"),
    "Must document C-client log English standard rationale"
  );
});

test("Task 2.5: dead CI workflows in client/.github/ are completely removed", () => {
  const clientWorkflowsDir = path.join(process.cwd(), "client", ".github", "workflows");
  assert.strictEqual(
    fs.existsSync(clientWorkflowsDir),
    false,
    "client/.github/workflows/ must be completely removed"
  );

  const rootWorkflowsDir = path.join(process.cwd(), ".github", "workflows");
  assert.strictEqual(
    fs.existsSync(rootWorkflowsDir),
    true,
    "root .github/workflows/ must still exist"
  );
  assert.strictEqual(
    fs.existsSync(path.join(rootWorkflowsDir, "ci.yml")),
    true,
    "root .github/workflows/ci.yml must exist"
  );
});

test("Task 3.4: deploy/pec-app-linux.service has valid headless systemd unit configuration", () => {
  const serviceFile = path.join(process.cwd(), "deploy", "pec-app-linux.service");
  assert.strictEqual(fs.existsSync(serviceFile), true, "deploy/pec-app-linux.service must exist");

  const content = fs.readFileSync(serviceFile, "utf-8");
  assert.ok(content.includes("[Unit]"), "Must have [Unit] section");
  assert.ok(content.includes("[Service]"), "Must have [Service] section");
  assert.ok(content.includes("[Install]"), "Must have [Install] section");

  assert.ok(
    content.includes("ExecStart=/usr/local/bin/ProxyBridge --profile /etc/proxybridge/pec_profile.pbprofile"),
    "ExecStart must point to ProxyBridge with --profile /etc/proxybridge/pec_profile.pbprofile"
  );
  assert.ok(
    content.includes("WorkingDirectory=/etc/proxybridge"),
    "WorkingDirectory must be /etc/proxybridge"
  );
  assert.ok(content.includes("Restart=always"), "Must have Restart=always");
  assert.ok(content.includes("RestartSec=5"), "Must have RestartSec=5");
  assert.ok(content.includes("User=root"), "Must run as root for eBPF operations");
  assert.ok(content.includes("LimitNOFILE=65536"), "Must set file descriptor limit");
  assert.ok(content.includes("ProtectSystem=full"), "Must set ProtectSystem=full");
  assert.ok(content.includes("PrivateTmp=true"), "Must set PrivateTmp=true");
  assert.ok(content.includes("WantedBy=multi-user.target"), "Must be WantedBy multi-user.target");
});

test("Task 3.4: Dockerfile implements multi-stage build keeping compilers out of production image", () => {
  const dockerfile = fs.readFileSync("Dockerfile", "utf-8");

  // Multi-stage check
  assert.ok(dockerfile.includes("AS builder"), "Dockerfile must define builder stage");
  assert.ok(dockerfile.includes("AS runner"), "Dockerfile must define runner stage");

  // Check builder stage installs MinGW toolchain
  const builderPart = dockerfile.split("FROM node:20-alpine AS runner")[0];
  const runnerPart = dockerfile.split("FROM node:20-alpine AS runner")[1];

  assert.ok(
    builderPart.includes("mingw-w64-gcc"),
    "Builder stage must contain MinGW-w64 toolchain"
  );

  // Check runner stage does NOT install compilers
  assert.ok(
    !runnerPart.includes("mingw-w64-gcc"),
    "Runner stage must NOT install MinGW-w64 compilers"
  );
  assert.ok(
    !runnerPart.includes("g++"),
    "Runner stage must NOT install g++"
  );

  // Check runner does NOT copy raw client sources
  assert.ok(
    !runnerPart.includes("COPY --from=builder /app/client ./client") &&
    !runnerPart.includes("COPY --from=builder --chown=pecuser:pecgroup /app/client ./client"),
    "Runner stage must NOT copy raw client C sources"
  );

  // Check runner creates necessary non-root directories
  assert.ok(
    runnerPart.includes("/app/dist/updates") && runnerPart.includes("/app/dist/releases"),
    "Runner stage must prepare /app/dist/updates and /app/dist/releases"
  );
});
