# PEC Native Client

Universal high-performance transparent proxy client for **Windows** and **Linux** enterprise environments. Part of the **Proxy Extension Corporate (PEC)** platform.

PEC Native Client routes process-level network traffic (TCP and UDP) through corporate SOCKS5 and HTTP proxy endpoints with zero configuration required in target applications.

---

## Architecture Overview

PEC Native Client employs a dual-architecture model optimized for enterprise security, privilege separation, and low-latency throughput.

```
                      +-----------------------------+
                      |       PEC Central Server    |
                      |  (Configs, Profiles, Auth) |
                      +--------------+--------------+
                                     | Sync / Deploy
                                     v
+------------------------------------+------------------------------------+
|                         CLIENT WORKSTATION                              |
|                                                                         |
|   [ Non-Privileged User Space ]                                         |
|   +-----------------------+     +-----------------------+               |
|   |  PEC-App (Win32/ImGui)|     |   PEC-CLI (Headless)  |               |
|   |  DirectX 11 Dark UI   |     |   Automated Scenarios |               |
|   +-----------+-----------+     +-----------+-----------+               |
|               |                             |                           |
|               +--------------+--------------+                           |
|                              | IPC (Named Pipes / UNIX Domain Sockets)  |
|                              v                                          |
|   [ Privileged Engine Service ]                                         |
|   +-----------------------------------------------------+               |
|   |  PECAppSvc (Windows Service: LocalSystem)           |               |
|   |  pec-client (Linux Daemon: systemd)                 |               |
|   +--------------------------+--------------------------+               |
|                              |                                          |
|   [ Kernel Interception Layer ]                                         |
|   +--------------------------+--------------------------+               |
|   |  Windows: WinDivert      |  Linux: eBPF / cgroups   |               |
|   |  Packet capture driver   |  sock_ops / sock_addr    |               |
|   +--------------------------+--------------------------+               |
+-------------------------------------------------------------------------+
```

### Windows Client Architecture

1. **Kernel Packet Interception (`WinDivert`)**: Captures inbound and outbound TCP/UDP traffic matching active rule profiles without modifying LSP (Layered Service Providers) or causing WFP (Windows Filtering Platform) filter conflicts.
2. **Core Relay Engine (`PECAppCore.dll`)**: High-throughput multi-threaded relay engine that transparently handles SOCKS5/HTTP handshakes, DNS resolution redirection, UDP relay encapsulation, and connection tracking.
3. **Privileged Windows Service (`PECAppSvc.exe`)**:
   - Runs as `LocalSystem` with hardened SDDL permissions (`SVC_SDDL`).
   - Manages WinDivert driver lifecycle, eliminating the need to run user-facing GUI apps with administrative elevation.
   - Provides authenticated IPC over named pipes with access limited to `SYSTEM`, `Administrators`, and members of the dedicated `PEC-App Users` local security group.
4. **Desktop GUI (`PEC-App.exe`)**:
   - Built with DirectX 11 / Dear ImGui and native Win32 controls for instantaneous startup, sub-10 MB memory footprint, and low CPU usage.
   - Real-time connection log viewer, proxy latency test tool, interactive rule editor, and system tray management.
5. **Command-Line Interface (`PEC-CLI.exe`)**:
   - Headless client for scripting, automated deployment pipelines, and remote terminal sessions.
6. **Enterprise Standalone Installer (`PEC-App-Setup.exe`)**:
   - Native C installer supporting interactive wizard mode and unattended silent installation (`/S`).
   - Hardened process execution (`CreateProcessW` application path validation), ACL initialization via `icacls`, and uninstaller registration.

### Linux Client Architecture

1. **eBPF Socket Steering (`proxybridge.bpf.c`)**:
   - Uses `BPF_PROG_TYPE_SOCK_OPS` and `BPF_PROG_TYPE_CGROUP_SOCK_ADDR` for kernel-level socket redirection.
   - Eliminates iptables/nftables overhead and packet duplication.
2. **Daemon Service (`pec-client`)**:
   - Managed via `systemd` (`pec-client.service`).
   - Attaches eBPF programs to the root cgroup, monitoring network flows and redirecting matched sockets to the local proxy relay.
3. **CLI & GTK GUI**:
   - Complete command-line control alongside a lightweight GTK3 desktop interface.

---

## Directory Structure

```
client/
├── Windows/
│   ├── Makefile.msvc             # NMake build script for MSVC
│   ├── compile.ps1               # Automated PowerShell build script
│   ├── cli/                      # PEC-CLI source & resources
│   ├── gui/                      # PEC-App GUI (Win32 & ImGui DX11)
│   ├── installer/                # PEC-App-Setup standalone installer
│   └── src/                      # Core DLL & Service source
│       ├── service/              # PECAppSvc Windows Service
│       ├── pb_relay.c            # TCP/UDP connection relay & worker threads
│       └── ProxyBridge.c         # Core packet interception entrypoint
└── Linux/
    ├── Makefile                  # Linux build system
    ├── cli/                      # Linux CLI client
    ├── gui/                      # Linux GTK GUI
    └── src/
        ├── bpf/                  # eBPF kernel programs
        └── pb_bpf.c              # eBPF loader & userspace daemon
```

---

## Building from Source

### Windows (MSVC)

#### Prerequisites
- Windows 10/11 or Windows Server 2016+ (x64)
- Microsoft Visual Studio 2022 (or Build Tools) with C++ Desktop Development
- WinDivert 2.2.2-A SDK (extracted to `C:\WinDivert-2.2.2-A`)

#### Build using NMake
Open **x64 Native Tools Command Prompt for VS 2022**:

```cmd
cd client\Windows
nmake -f Makefile.msvc
```

To specify a custom WinDivert SDK path:
```cmd
nmake -f Makefile.msvc WINDIVERT_DIR=D:\Libraries\WinDivert-2.2.2-A
```

#### Build using PowerShell
```powershell
cd client\Windows
.\compile.ps1 -Compiler msvc -NoSign
```

#### Artifacts Produced
- `PECAppCore.dll` (Core proxy interception engine)
- `PEC-App.exe` (Desktop GUI)
- `PEC-CLI.exe` (Headless CLI)
- `PECAppSvc.exe` (LocalSystem Windows service)
- `PEC-App-Setup.exe` (Standalone enterprise installer)

---

### Linux

#### Prerequisites
- Linux Kernel 5.8+ (with eBPF & BTF support enabled)
- Clang / LLVM (>= 11)
- `libbpf-dev`
- `build-essential` (GCC, make)
- `pkg-config`

#### Build
```bash
cd client/Linux
make
```

To build with GTK GUI support:
```bash
make GUI=1
```

---

## Service Management

### Windows Service (`PECAppSvc`)

The Windows service can be registered and managed using `PECAppSvc.exe` or standard Windows service management utilities:

```cmd
:: Install and register service
PECAppSvc.exe --install

:: Configure local user permissions and ACLs
PECAppSvc.exe --setup-users

:: Start / Stop service
sc.exe start PECAppSvc
sc.exe stop PECAppSvc

:: Query service status
sc.exe query PECAppSvc

:: Uninstall service
PECAppSvc.exe --uninstall
```

### Unattended / Silent Installation

For enterprise Active Directory / GPO deployments:

```cmd
PEC-App-Setup.exe /S
```

To silently uninstall:
```cmd
"C:\Program Files\PEC-App\Uninstall.exe" /S
```

### Linux Service (`pec-client`)

```bash
# Enable and start systemd daemon
sudo systemctl enable --now pec-client

# Check service status
sudo systemctl status pec-client

# View runtime journal logs
sudo journalctl -u pec-client -f
```

---

## Profile & Routing Configuration

PEC Native Client profiles are stored in JSON format (`pec_profile.pbprofile`). Profiles define proxy servers and process routing rules:

```json
{
  "version": "2.1.0",
  "proxy_configs": [
    {
      "id": 1,
      "name": "Corporate SOCKS5",
      "type": "socks5",
      "host": "proxy.corp.internal",
      "port": 1080,
      "auth_enabled": true,
      "username": "pec_agent",
      "password": "secret_password",
      "dns_resolve": true
    }
  ],
  "rules": [
    {
      "id": 1,
      "name": "Direct LAN Traffic",
      "applications": "*",
      "target_hosts": "10.0.0.0/8;172.16.0.0/12;192.168.0.0/16",
      "target_ports": "*",
      "protocol": "BOTH",
      "action": "DIRECT",
      "enabled": true
    },
    {
      "id": 2,
      "name": "Route Browsers through Corporate Proxy",
      "applications": "chrome.exe;msedge.exe;firefox.exe",
      "target_hosts": "*",
      "target_ports": "80;443;8080",
      "protocol": "TCP",
      "action": "PROXY",
      "proxy_config_id": 1,
      "enabled": true
    }
  ]
}
```

### Action Types
- `PROXY`: Diverts matching traffic through the designated proxy configuration.
- `DIRECT`: Bypasses proxy tunnels, transmitting directly via standard system routing.
- `BLOCK`: Drops matching packets immediately at the kernel layer.

---

## Security & Hardening Features

- **Privilege Separation**: GUI runs as standard unprivileged user; kernel drivers are controlled exclusively by the isolated `PECAppSvc` service.
- **ASLR & DEP / CFG**: All binaries compiled with `/DYNAMICBASE`, `/HIGHENTROPYVA`, `/NXCOMPAT`, `/guard:cf`, and `/CETCOMPAT`.
- **Path Hijacking Prevention**: Installer uses canonical `CreateProcessW` parameter splitting with explicit `lpApplicationName` and strict buffer boundaries.
- **Zero Third-Party Tracking**: Fully self-contained without external dependencies or analytics reporting.
