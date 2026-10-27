# Contributing to PEC Native Client

Thank you for your interest in contributing to the **PEC Native Client** (part of the **Proxy Extension Corporate (PEC)** platform).

All general project contribution standards, code style, and PR requirements are defined in the root contributing guide:

👉 **[Root Contributing Guide (CONTRIBUTING.md)](../CONTRIBUTING.md)**

---

## Architecture & Subsystems

PEC Native Client consists of two native platform implementations:

1. **Windows Subsystem (`client/Windows/`)**:
   - **`PECAppCore.dll`**: Core packet interception and multi-threaded SOCKS5/HTTP relay engine.
   - **`PECAppSvc.exe`**: Privileged Windows Service (`LocalSystem`) managing the `WinDivert` driver and IPC named pipes.
   - **`PEC-App.exe`**: Hardware-accelerated desktop GUI built with **DirectX 11 & Dear ImGui** (Dark Cyber Blue theme, Russian localization, connection monitor, real-time log inspector).
   - **`PEC-CLI.exe`**: Headless CLI tool for automation and terminal sessions.
   - **`PEC-App-Setup.exe`**: Native C standalone installer.

2. **Linux Subsystem (`client/Linux/`)**:
   - **`libproxybridge.so`**: Core shared library.
   - **`proxybridge.bpf.c`**: eBPF kernel programs (`sock_ops`, `cgroup_sock_addr`) for kernel-level socket redirection.
   - **`pec-client` / `ProxyBridge`**: Command-line interface and daemon.
   - **`deploy/pec-app-linux.service`**: Systemd unit for headless gateway/server deployments.

---

## Building from Source

### Windows Client Build Requirements
- **Visual Studio 2022** (or Build Tools) with C/C++ x64 workload.
- **Windows SDK** (Windows 10/11 SDK).
- **WinDivert SDK 2.2.2-A** extracted to `C:\WinDivert-2.2.2-A` (or configured via environment).

To build native Windows binaries:
```cmd
cd client\Windows
nmake -f Makefile.msvc
```

Or using the automated PowerShell build helper:
```powershell
.\compile.ps1
```

### Linux Client Build Requirements
- `gcc`, `make`, `pkg-config`
- `libelf-dev`, `zlib1g-dev`, `libgtk-3-dev` (optional, for GTK3 GUI)
- Linux kernel 5.8+ with eBPF and cgroups v2 enabled

To build Linux binaries:
```bash
cd client/Linux
make
```

---

## Submitting Pull Requests

1. Fork and create your branch from `main`:
   ```bash
   git checkout -b feature/client-enhancement
   ```
2. Verify all checks pass before submitting:
   ```bash
   npm run lint
   npm test
   npm run build
   ```
3. Submit your pull request at **[vlv-code/PEC Pull Requests](https://github.com/vlv-code/PEC/pulls)** following the PR template.
