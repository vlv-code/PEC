# Security Policy - PEC Native Client

## Supported Versions

PEC Native Client (Windows & Linux) follows the central release lifecycle of the **Proxy Extension Corporate (PEC)** platform. We actively maintain and provide security fixes for the following client versions:

| Component | Supported Versions | Security Support |
|-----------|--------------------|------------------|
| PEC-App Windows Client (`PEC-App.exe`, `PECAppSvc.exe`, `PECAppCore.dll`) | 2.x, 1.x | :white_check_mark: Active |
| PEC Linux Client (`pec-client`, eBPF / cgroups daemon) | 2.x | :white_check_mark: Active |
| Upstream ProxyBridge / Legacy builds (< 2.0.0) | < 2.0.0 | :x: Unsupported / End of Life |

---

## Central Security Policy

PEC Native Client is an integrated component of the enterprise PEC platform. The authoritative enterprise security policy, trust model, token permissions matrix, and enterprise threat model are maintained centrally in the project root:

👉 **[Root Security Policy (SECURITY.md)](../SECURITY.md)**

Please consult the root security policy for complete details regarding:
- Active Directory & GPO authorization models.
- Management-API dual-token isolation (`ADMIN_TOKEN` vs `EXT_SHARED_TOKEN` / `fleetToken`).
- Token permission matrix for `/creds`, `/api/sync`, `/api/app/sync`, and release downloads.
- Enterprise Threat Model & Architectural Scope (including platform architectural boundaries and rationale).

---

## Reporting a Vulnerability

We take the security and integrity of PEC Native Client seriously. If you identify a potential security vulnerability in PEC Native Client or associated services:

### 🔒 Please DO NOT:
- Open public GitHub issues or discussions for security vulnerabilities.
- Disclose details publicly or share with third parties before remediation.

### ✅ Please DO:
1. **Report privately via GitHub Private Vulnerability Reporting:**
   - Navigate to the repository **Security** tab.
   - Click **Report a vulnerability** under Private Vulnerability Reporting.
   - Provide a detailed advisory draft with steps to reproduce and proof-of-concept where applicable.
2. **Enterprise Internal Reporting:**
   - Corporate deployments should report directly to designated internal enterprise security administrators in accordance with the corporate incident response procedure described in the root [SECURITY.md](../SECURITY.md).

### What to Include in Your Report:
- **Component & Platform**: Operating system (Windows / Linux), client architecture (x64 / ARM64), and exact binary version.
- **Vulnerability Category**: Local privilege escalation, memory safety, IPC unauthorized access, relay bypass, denial of service, etc.
- **Step-by-Step Reproduction**: Detailed reproduction steps and minimal proof-of-concept (PoC).
- **Impact Assessment**: Technical impact and attack vector prerequisites.

---

## PEC Native Client Security Architecture & Hardening

PEC Native Client implements strict enterprise hardening and privilege separation:

1. **Privilege Separation**:
   - The user interface (`PEC-App.exe`) and command-line tool (`pec-cli`) run under the unprivileged user context.
   - Privileged packet redirection and driver management are isolated inside a dedicated system service (`PECAppSvc` on Windows running as `LocalSystem`, or `pec-client` systemd daemon on Linux running under root).
   - Communication between the unprivileged UI/CLI and privileged engine uses local-only IPC with strict access controls.

2. **Windows Service Hardening (SDDL)**:
   - The `PECAppSvc` Windows service is secured with a strict Security Descriptor (`(A;;CCLCSWLOCRRC;;;IU)`), preventing standard interactive users (`IU`) from arbitrarily stopping, starting, or modifying the service binary configuration.

3. **Credential & Profile Protection**:
   - Static profile files (`pec_profile.pbprofile`, `Default.pbprofile`) and distribution packages do **not** store plaintext proxy passwords (`Password: ""`).
   - Dynamic credentials and routing rules are securely fetched into client memory at runtime via `POST /api/app/sync` using the low-privileged `fleetToken` / `instanceId` registration.
   - Local relay bindings (`127.0.0.1`) strictly listen on loopback addresses and are not exposed over external network interfaces.

4. **Compiler & Binary Defenses**:
   - Client binaries are compiled with modern exploit mitigation flags:
     - ASLR (`/DYNAMICBASE`, `/HIGHENTROPYVA`)
     - DEP / NX (`/NXCOMPAT`)
     - Control Flow Guard (`/guard:cf`)
     - Shadow Stack / CET Compatibility (`/CETCOMPAT`)
   - Secure process launching uses canonical path validation to prevent DLL and path hijacking.

---

**Last Updated:** October 2026
