PEC-App Windows Templates
======================================
This directory holds pre-compiled base binaries for the Windows client:
- PEC-App.exe (Win32 GUI Client)
- PEC-CLI.exe (Command-line interface)
- PECAppSvc.exe (Windows Background Service)
- PECAppCore.dll (Packet redirection engine)
- WinDivert.dll (Packet redirection library)
- WinDivert64.sys (WinDivert kernel driver)
- PEC-App-Setup.exe (Standalone Installer)

During dynamic packaging by src/appPackager.ts, these binaries are bundled
alongside the generated pec_profile.pbprofile and deploy-pec-app.ps1 script.
