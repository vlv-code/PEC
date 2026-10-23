!define PRODUCT_NAME "PEC-App"
!define PRODUCT_VERSION "2.1.0"
!define PRODUCT_PUBLISHER "PEC Team"
!define PRODUCT_WEB_SITE "https://pec.local"
!define PRODUCT_UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"
!define PRODUCT_UNINST_ROOT_KEY "HKLM"

Unicode True

; Version Information
VIProductVersion "2.1.0.0"
VIAddVersionKey "ProductName" "${PRODUCT_NAME}"
VIAddVersionKey "ProductVersion" "${PRODUCT_VERSION}"
VIAddVersionKey "CompanyName" "${PRODUCT_PUBLISHER}"
VIAddVersionKey "LegalCopyright" "Copyright (c) 2026 ${PRODUCT_PUBLISHER}"
VIAddVersionKey "FileDescription" "${PRODUCT_NAME} Setup"
VIAddVersionKey "FileVersion" "${PRODUCT_VERSION}"
VIAddVersionKey "Comments" "PEC-App Transparent Proxy Client"

!include "MUI2.nsh"

SetCompressor /SOLID lzma
SetCompressorDictSize 64

Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "PEC-App-Setup-${PRODUCT_VERSION}.exe"
InstallDir "$PROGRAMFILES64\${PRODUCT_NAME}"
InstallDirRegKey HKLM "${PRODUCT_UNINST_KEY}" "InstallLocation"
RequestExecutionLevel admin

!define MUI_ABORTWARNING
!define MUI_ICON "..\gui\res\logo.ico"
!define MUI_UNICON "..\gui\res\logo.ico"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\..\\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES

; Finish page offers to launch ProxyBridge - checkbox is checked by default.
; The installer runs elevated, and a program it starts directly would inherit administrator rights. ProxyBridge is
; meant to run as a normal user (the engine service does the privileged work), so launch it through Explorer, which
; starts it with the signed-in user's normal rights.
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchAppAsUser
!define MUI_FINISHPAGE_RUN_TEXT "Run PEC-App now"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Function LaunchAppAsUser
  IfFileExists "$INSTDIR\PEC-App.exe" 0 +3
    Exec '"$WINDIR\explorer.exe" "$INSTDIR\PEC-App.exe"'
    Return
  Exec '"$WINDIR\explorer.exe" "$INSTDIR\ProxyBridge.exe"'
FunctionEnd

Section "MainSection" SEC01
  ; A running PEC-App or ProxyBridge locks the files we need to overwrite. Detect it and ask
  ; the user before closing it, instead of killing it silently.
  nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq PEC-App.exe" /NH | findstr /I "PEC-App.exe"'
  Pop $0   ; findstr exit code: 0 = a matching process is running
  Pop $1   ; captured output (unused)
  StrCmp $0 "0" install_prompt_kill 0
  nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq ProxyBridge.exe" /NH | findstr /I "ProxyBridge.exe"'
  Pop $0
  Pop $1
  StrCmp $0 "0" install_prompt_kill install_proceed

  install_prompt_kill:
    MessageBox MB_YESNO|MB_ICONQUESTION "PEC-App is currently running and must be closed to continue the installation.$\n$\nClose PEC-App now and continue?$\n$\nYes  -  close PEC-App and install$\nNo   -  cancel and close the installer" IDYES install_kill IDNO install_abort
    install_abort:
      Quit
    install_kill:
      nsExec::ExecToLog 'taskkill /F /IM PEC-App.exe'
      nsExec::ExecToLog 'taskkill /F /IM PEC-CLI.exe'
      nsExec::ExecToLog 'taskkill /F /IM pbcli.exe'
      nsExec::ExecToLog 'taskkill /F /IM ProxyBridge.exe'
      nsExec::ExecToLog 'taskkill /F /IM ProxyBridge_CLI.exe'
      Sleep 1500
  install_proceed:

  ; Stop the engine services first (they hold ProxyBridgeCore.dll / WinDivert64.sys open), then
  ; remove legacy elevated logon tasks older versions created.
  nsExec::ExecToLog 'sc stop PECAppSvc'
  nsExec::ExecToLog 'sc stop ProxyBridgeSvc'
  Sleep 1500
  nsExec::ExecToLog 'schtasks /Delete /F /TN "PEC-App"'
  nsExec::ExecToLog 'schtasks /Delete /F /TN "ProxyBridge"'

  ; Stop and unload the WinDivert driver so WinDivert64.sys can be replaced.
  nsExec::ExecToLog 'sc stop WinDivert'
  nsExec::ExecToLog 'sc delete WinDivert'
  DeleteRegKey HKLM "SYSTEM\CurrentControlSet\Services\WinDivert"

  ; Brief pause to let the OS release all file handles.
  Sleep 1000

  SetOutPath "$INSTDIR"
  SetOverwrite on

  File /nonfatal "..\output\PEC-App.exe"
  File /nonfatal "..\output\ProxyBridge.exe"
  File /nonfatal "..\output\PEC-CLI.exe"
  File /nonfatal "..\output\pbcli.exe"
  File /nonfatal "..\output\ProxyBridge_CLI.exe"
  File /nonfatal "..\output\ProxyBridgeCore.dll"
  File /nonfatal "..\output\PECAppSvc.exe"
  File /nonfatal "..\output\ProxyBridgeSvc.exe"
  File /nonfatal "..\output\WinDivert.dll"
  File /nonfatal "..\output\WinDivert64.sys"

  ; Ensure both PEC-App.exe and ProxyBridge.exe exist in $INSTDIR for compatibility
  IfFileExists "$INSTDIR\PEC-App.exe" 0 +3
    IfFileExists "$INSTDIR\ProxyBridge.exe" +2 0
      CopyFiles /SILENT "$INSTDIR\PEC-App.exe" "$INSTDIR\ProxyBridge.exe"
  IfFileExists "$INSTDIR\ProxyBridge.exe" 0 +3
    IfFileExists "$INSTDIR\PEC-App.exe" +2 0
      CopyFiles /SILENT "$INSTDIR\ProxyBridge.exe" "$INSTDIR\PEC-App.exe"

  ; Ensure CLI aliases exist
  IfFileExists "$INSTDIR\PEC-CLI.exe" 0 +4
    IfFileExists "$INSTDIR\pbcli.exe" +2 0
      CopyFiles /SILENT "$INSTDIR\PEC-CLI.exe" "$INSTDIR\pbcli.exe"
    IfFileExists "$INSTDIR\ProxyBridge_CLI.exe" +2 0
      CopyFiles /SILENT "$INSTDIR\PEC-CLI.exe" "$INSTDIR\ProxyBridge_CLI.exe"
  IfFileExists "$INSTDIR\ProxyBridge_CLI.exe" 0 +4
    IfFileExists "$INSTDIR\PEC-CLI.exe" +2 0
      CopyFiles /SILENT "$INSTDIR\ProxyBridge_CLI.exe" "$INSTDIR\PEC-CLI.exe"
    IfFileExists "$INSTDIR\pbcli.exe" +2 0
      CopyFiles /SILENT "$INSTDIR\ProxyBridge_CLI.exe" "$INSTDIR\pbcli.exe"

  ; Ensure Service aliases exist
  IfFileExists "$INSTDIR\PECAppSvc.exe" 0 +3
    IfFileExists "$INSTDIR\ProxyBridgeSvc.exe" +2 0
      CopyFiles /SILENT "$INSTDIR\PECAppSvc.exe" "$INSTDIR\ProxyBridgeSvc.exe"
  IfFileExists "$INSTDIR\ProxyBridgeSvc.exe" 0 +3
    IfFileExists "$INSTDIR\PECAppSvc.exe" +2 0
      CopyFiles /SILENT "$INSTDIR\ProxyBridgeSvc.exe" "$INSTDIR\PECAppSvc.exe"

  ; The service runs as SYSTEM from this folder, so ordinary users must never be able to modify it
  ; (a folder chosen outside Program Files, e.g. D:\Tools, is usually writable by every user).
  ; SYSTEM and Administrators: full control; Users: read/execute. SIDs, so it works on any language.
  nsExec::ExecToLog 'icacls "$INSTDIR" /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-32-545:(OI)(CI)RX"'

  ; Remove leftover native libraries from old GUI if any
  Delete "$INSTDIR\av_libglesv2.dll"
  Delete "$INSTDIR\libHarfBuzzSharp.dll"
  Delete "$INSTDIR\libSkiaSharp.dll"

  ; Register the engine service once. It runs as LocalSystem and starts with Windows, so the
  ; PEC-App itself never needs administrator rights. The service ACL lets interactive
  ; users start it (never stop or reconfigure it), in case it was stopped.
  nsExec::ExecToLog 'sc delete PECAppSvc'
  nsExec::ExecToLog 'sc delete ProxyBridgeSvc'
  ; Remove the inbound firewall rules the engine added for its relay (one per executable).
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name=all program="$INSTDIR\PECAppSvc.exe"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name=all program="$INSTDIR\ProxyBridgeSvc.exe"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name=all program="$INSTDIR\PEC-App.exe"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name=all program="$INSTDIR\ProxyBridge.exe"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name=all program="$INSTDIR\PEC-CLI.exe"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name=all program="$INSTDIR\ProxyBridge_CLI.exe"'
  nsExec::ExecToLog 'sc create PECAppSvc binPath= "\"$INSTDIR\PECAppSvc.exe\"" start= auto DisplayName= "PEC-App Service"'
  nsExec::ExecToLog 'sc description PECAppSvc "Privileged traffic-redirection engine for PEC-App. Lets the PEC-App run without administrator rights."'
  nsExec::ExecToLog 'sc sdset PECAppSvc "D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWLOCRRC;;;IU)(A;;CCLCSWLOCRRC;;;SU)"'
  ; Local group that may drive the service; the signed-in user is added to it.
  IfFileExists "$INSTDIR\PECAppSvc.exe" 0 +3
    nsExec::ExecToLog '"$INSTDIR\PECAppSvc.exe" --setup-users'
    Goto +2
    nsExec::ExecToLog '"$INSTDIR\ProxyBridgeSvc.exe" --setup-users'
  nsExec::ExecToLog 'sc start PECAppSvc'

  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  IfFileExists "$INSTDIR\PEC-App.exe" 0 +3
    CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\PEC-App.exe"
    Goto +2
    CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\ProxyBridge.exe"

  IfFileExists "$INSTDIR\PEC-App.exe" 0 +3
    CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\PEC-App.exe"
    Goto +2
    CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\ProxyBridge.exe"

  ; Add to PATH using EnVar plugin
  EnVar::SetHKLM
  EnVar::AddValue "PATH" "$INSTDIR"
  Pop $0

  ; Broadcast environment change
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
SectionEnd

Section -Post
  WriteUninstaller "$INSTDIR\uninst.exe"
  WriteRegStr HKLM "${PRODUCT_UNINST_KEY}" "DisplayName" "$(^Name)"
  WriteRegStr HKLM "${PRODUCT_UNINST_KEY}" "UninstallString" "$INSTDIR\uninst.exe"
  IfFileExists "$INSTDIR\PEC-App.exe" 0 +3
    WriteRegStr HKLM "${PRODUCT_UNINST_KEY}" "DisplayIcon" "$INSTDIR\PEC-App.exe"
    Goto +2
    WriteRegStr HKLM "${PRODUCT_UNINST_KEY}" "DisplayIcon" "$INSTDIR\ProxyBridge.exe"
  WriteRegStr HKLM "${PRODUCT_UNINST_KEY}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKLM "${PRODUCT_UNINST_KEY}" "URLInfoAbout" "${PRODUCT_WEB_SITE}"
  WriteRegStr HKLM "${PRODUCT_UNINST_KEY}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKLM "${PRODUCT_UNINST_KEY}" "InstallLocation" "$INSTDIR"
SectionEnd

Section Uninstall
  ; If PEC-App or ProxyBridge is running, its files stay locked and can only be removed after a
  ; reboot. Detect it and offer to close it so the uninstall can complete now.
  nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq PEC-App.exe" /NH | findstr /I "PEC-App.exe"'
  Pop $0   ; findstr exit code: 0 = a matching process is running
  Pop $1   ; captured output (unused)
  StrCmp $0 "0" uninst_prompt_kill 0
  nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq ProxyBridge.exe" /NH | findstr /I "ProxyBridge.exe"'
  Pop $0
  Pop $1
  StrCmp $0 "0" uninst_prompt_kill uninst_proceed
  uninst_prompt_kill:
    MessageBox MB_YESNO|MB_ICONQUESTION "PEC-App is currently running.$\n$\nClose it and continue the uninstall?$\n$\nYes  -  close PEC-App and remove all files now$\nNo   -  continue without closing (some files may be removed only after a reboot)" IDYES uninst_kill IDNO uninst_proceed
    uninst_kill:
      nsExec::ExecToLog 'taskkill /F /IM PEC-App.exe'
      nsExec::ExecToLog 'taskkill /F /IM PEC-CLI.exe'
      nsExec::ExecToLog 'taskkill /F /IM pbcli.exe'
      nsExec::ExecToLog 'taskkill /F /IM ProxyBridge.exe'
      nsExec::ExecToLog 'taskkill /F /IM ProxyBridge_CLI.exe'
      Sleep 1500
  uninst_proceed:

  ; Remove engine services, and legacy logon tasks
  nsExec::ExecToLog 'sc stop PECAppSvc'
  nsExec::ExecToLog 'sc stop ProxyBridgeSvc'
  Sleep 1500
  nsExec::ExecToLog 'sc delete PECAppSvc'
  nsExec::ExecToLog 'sc delete ProxyBridgeSvc'
  nsExec::ExecToLog 'net localgroup "PEC-App Users" /delete'
  nsExec::ExecToLog 'net localgroup "ProxyBridge Users" /delete'
  DeleteRegKey HKLM "SOFTWARE\PEC-App\AllowedSids"
  DeleteRegKey /ifempty HKLM "SOFTWARE\PEC-App"
  DeleteRegKey HKLM "SOFTWARE\ProxyBridge\AllowedSids"
  DeleteRegKey /ifempty HKLM "SOFTWARE\ProxyBridge"
  nsExec::ExecToLog 'schtasks /Delete /F /TN "PEC-App"'
  nsExec::ExecToLog 'schtasks /Delete /F /TN "ProxyBridge"'
  ; The per-user Run entry is removed for the account running the uninstaller
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "PEC-App"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ProxyBridge"

  ; Stop the WinDivert driver first so WinDivert64.sys isn't held open.
  nsExec::ExecToLog 'sc stop WinDivert'
  nsExec::ExecToLog 'sc delete WinDivert'
  DeleteRegKey HKLM "SYSTEM\CurrentControlSet\Services\WinDivert"
  Sleep 500

  Delete "$INSTDIR\PEC-App.exe"
  Delete "$INSTDIR\ProxyBridge.exe"
  Delete "$INSTDIR\PEC-CLI.exe"
  Delete "$INSTDIR\ProxyBridge_CLI.exe"
  Delete "$INSTDIR\pbcli.exe"
  Delete "$INSTDIR\ProxyBridgeCore.dll"
  Delete "$INSTDIR\PECAppSvc.exe"
  Delete "$INSTDIR\ProxyBridgeSvc.exe"
  Delete "$INSTDIR\WinDivert.dll"
  Delete "$INSTDIR\WinDivert64.sys"
  Delete "$INSTDIR\uninst.exe"

  Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  RMDir "$SMPROGRAMS\${PRODUCT_NAME}"
  RMDir "$INSTDIR"

  ; Remove from PATH using EnVar plugin
  EnVar::SetHKLM
  EnVar::DeleteValue "PATH" "$INSTDIR"
  Pop $0

  ; Broadcast environment change
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000

  DeleteRegKey ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}"
  SetAutoClose true
SectionEnd
