// setup.c - PEC-App Native Standalone Installer & Uninstaller
//
// Standalone Win32 executable providing both interactive GUI and unattended/silent (/S)
// enterprise installation for PEC-App transparent proxy client.
// Registers PECAppSvc system service with proper SDDL permissions, creates Start Menu
// shortcuts, and configures Windows Add/Remove Programs registration.

#define WIN32_LEAN_AND_MEAN
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#ifndef _CRT_SECURE_NO_WARNINGS
#define _CRT_SECURE_NO_WARNINGS
#endif
#define _WIN32_WINNT 0x0601

#include <initguid.h>
#include <windows.h>
#include <commctrl.h>
#include <shellapi.h>
#include <shlobj.h>
#include <sddl.h>
#include <stdio.h>
#include <stdlib.h>

#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")
#pragma comment(lib, "comctl32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "uuid.lib")

#define APP_NAME       L"PEC-App"
#ifndef APP_VERSION
#define APP_VERSION    L"2.2.0"
#endif
#define APP_PUBLISHER  L"PEC Team"
#define SVC_NAME       L"PECAppSvc"
#define SVC_DISPLAY    L"PEC-App Service"
#define SVC_DESC       L"Privileged traffic-redirection engine for PEC-App."
#define SVC_SDDL       L"D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWLOCRRC;;;IU)(A;;CCLCSWLOCRRC;;;SU)"
#define UNINST_KEY     L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PEC-App"

// Control IDs
#define IDC_TITLE      101
#define IDC_STATUS     102
#define IDC_PROGRESS   103
#define IDC_BTN_ACTION 104
#define IDC_CHK_RUN    105

static HINSTANCE g_hInst = NULL;
static HWND      g_hMain = NULL;
static HWND      g_hStatus = NULL;
static HWND      g_hProgress = NULL;
static HWND      g_hBtnAction = NULL;
static HWND      g_hChkRun = NULL;
static HFONT     g_hFontTitle = NULL;
static HFONT     g_hFontNormal = NULL;

static BOOL      g_silent = FALSE;
static BOOL      g_uninstall = FALSE;
static BOOL      g_noRun = FALSE;
static BOOL      g_completed = FALSE;
static wchar_t   g_installDir[MAX_PATH] = {0};

static void SetStatus(const wchar_t* text, int progress)
{
    if (g_hStatus && IsWindow(g_hStatus)) {
        SetWindowTextW(g_hStatus, text);
    }
    if (g_hProgress && IsWindow(g_hProgress) && progress >= 0) {
        SendMessageW(g_hProgress, PBM_SETPOS, (WPARAM)progress, 0);
    }
}

static BOOL ExecWait(const wchar_t* cmd, const wchar_t* workDir, DWORD* outExit)
{
    if (!cmd || !*cmd) return FALSE;

    STARTUPINFOW si;
    PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;
    ZeroMemory(&pi, sizeof(pi));

    wchar_t cmdBuf[2048];
    wcsncpy_s(cmdBuf, 2048, cmd, _TRUNCATE);
    cmdBuf[2047] = L'\0';

    wchar_t appBuf[MAX_PATH];
    const wchar_t* lpApp = NULL;

    const wchar_t* p = cmd;
    while (*p == L' ' || *p == L'\t') p++;

    // Harden CreateProcessW against relative path hijacking:
    // If cmd starts with a quoted executable path "...", extract it into appBuf and pass as lpApplicationName.
    if (*p == L'"') {
        const wchar_t* endQuote = wcschr(p + 1, L'"');
        if (endQuote) {
            size_t len = (size_t)(endQuote - (p + 1));
            if (len > 0 && len < MAX_PATH) {
                wcsncpy_s(appBuf, MAX_PATH, p + 1, len);
                appBuf[len] = L'\0';
                // Only pass lpApplicationName directly if it contains directory separators,
                // or safely resolve it via SearchPathW to prevent unintentional current-directory execution.
                if (wcschr(appBuf, L'\\') != NULL || wcschr(appBuf, L'/') != NULL || wcschr(appBuf, L':') != NULL) {
                    lpApp = appBuf;
                } else {
                    wchar_t resolved[MAX_PATH];
                    if (SearchPathW(NULL, appBuf, L".exe", MAX_PATH, resolved, NULL) > 0) {
                        wcsncpy_s(appBuf, MAX_PATH, resolved, _TRUNCATE);
                        lpApp = appBuf;
                    }
                }
            }
        }
    }

    BOOL ok = CreateProcessW(lpApp, cmdBuf, NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, workDir, &si, &pi);
    if (!ok) return FALSE;

    WaitForSingleObject(pi.hProcess, 30000);
    DWORD code = 0;
    GetExitCodeProcess(pi.hProcess, &code);
    if (outExit) *outExit = code;

    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);
    return (code == 0);
}

static void TerminateExistingProcesses(void)
{
    wchar_t sysDir[MAX_PATH];
    GetSystemDirectoryW(sysDir, MAX_PATH);
    wchar_t cmd[1024];
    _snwprintf_s(cmd, 1024, _TRUNCATE, L"\"%ls\\taskkill.exe\" /F /IM PEC-App.exe /IM ProxyBridge.exe /IM PEC-CLI.exe /IM pbcli.exe", sysDir);
    ExecWait(cmd, NULL, NULL);
    Sleep(500);
}

static void StopAndRemoveServices(void)
{
    SC_HANDLE hSCM = OpenSCManagerW(NULL, NULL, SC_MANAGER_ALL_ACCESS);
    if (!hSCM) return;

    const wchar_t* services[] = { L"PECAppSvc", L"ProxyBridgeSvc", L"WinDivert" };
    for (int i = 0; i < 3; i++) {
        SC_HANDLE hSvc = OpenServiceW(hSCM, services[i], SERVICE_ALL_ACCESS);
        if (hSvc) {
            SERVICE_STATUS ss;
            ControlService(hSvc, SERVICE_CONTROL_STOP, &ss);
            DeleteService(hSvc);
            CloseServiceHandle(hSvc);
        }
    }
    CloseServiceHandle(hSCM);
    Sleep(1000);
}

static BOOL CreateShortcut(const wchar_t* shortcutPath, const wchar_t* targetPath, const wchar_t* workDir, const wchar_t* desc)
{
    IShellLinkW* psl = NULL;
    HRESULT hr = CoCreateInstance(&CLSID_ShellLink, NULL, CLSCTX_INPROC_SERVER, &IID_IShellLinkW, (void**)&psl);
    if (SUCCEEDED(hr)) {
        psl->lpVtbl->SetPath(psl, targetPath);
        psl->lpVtbl->SetWorkingDirectory(psl, workDir);
        psl->lpVtbl->SetDescription(psl, desc);
        psl->lpVtbl->SetIconLocation(psl, targetPath, 0);

        IPersistFile* ppf = NULL;
        hr = psl->lpVtbl->QueryInterface(psl, &IID_IPersistFile, (void**)&ppf);
        if (SUCCEEDED(hr)) {
            hr = ppf->lpVtbl->Save(ppf, shortcutPath, TRUE);
            ppf->lpVtbl->Release(ppf);
        }
        psl->lpVtbl->Release(psl);
    }
    return SUCCEEDED(hr);
}

static BOOL ExtractEmbeddedPayload(const wchar_t* destDir)
{
    HRSRC hRsrc = FindResourceW(NULL, MAKEINTRESOURCEW(101), RT_RCDATA);
    if (!hRsrc) return FALSE;

    HGLOBAL hGlob = LoadResource(NULL, hRsrc);
    if (!hGlob) return FALSE;

    DWORD size = SizeofResource(NULL, hRsrc);
    const void* data = LockResource(hGlob);
    if (!data || size < 100) return FALSE;

    wchar_t tempZip[MAX_PATH];
    GetTempPathW(MAX_PATH, tempZip);
    lstrcatW(tempZip, L"pec_payload.zip");

    HANDLE hFile = CreateFileW(tempZip, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hFile == INVALID_HANDLE_VALUE) return FALSE;

    DWORD written = 0;
    WriteFile(hFile, data, size, &written, NULL);
    CloseHandle(hFile);

    wchar_t sysDir[MAX_PATH];
    GetSystemDirectoryW(sysDir, MAX_PATH);

    wchar_t tarPath[MAX_PATH];
    _snwprintf_s(tarPath, MAX_PATH, _TRUNCATE, L"%ls\\tar.exe", sysDir);

    wchar_t psPath[MAX_PATH];
    _snwprintf_s(psPath, MAX_PATH, _TRUNCATE, L"%ls\\WindowsPowerShell\\v1.0\\powershell.exe", sysDir);

    wchar_t cmd[2048];
    _snwprintf_s(cmd, 2048, _TRUNCATE, L"\"%ls\" -xf \"%ls\" -C \"%ls\"", tarPath, tempZip, destDir);
    DWORD exitCode = 1;
    BOOL ok = ExecWait(cmd, NULL, &exitCode);
    if (!ok || exitCode != 0) {
        _snwprintf_s(cmd, 2048, _TRUNCATE, L"\"%ls\" -NoProfile -Command \"Expand-Archive -LiteralPath '%ls' -DestinationPath '%ls' -Force\"", psPath, tempZip, destDir);
        ok = ExecWait(cmd, NULL, &exitCode);
    }

    DeleteFileW(tempZip);
    return ok;
}

static void CopyFromSourceFolder(const wchar_t* srcDir, const wchar_t* destDir)
{
    const wchar_t* files[] = {
        L"PEC-App.exe", L"PEC-CLI.exe", L"PECAppSvc.exe", L"PECAppCore.dll",
        L"ProxyBridgeCore.dll", L"ProxyBridge.exe", L"pbcli.exe", L"ProxyBridgeSvc.exe",
        L"WinDivert.dll", L"WinDivert64.sys", L"pec_profile.pbprofile",
        L"Install.cmd", L"Uninstall.cmd", L"deploy-pec-app.ps1", L"verify-pec-app.ps1",
        L"README.txt"
    };

    for (size_t i = 0; i < sizeof(files) / sizeof(files[0]); i++) {
        wchar_t srcPath[MAX_PATH], destPath[MAX_PATH];
        wsprintfW(srcPath, L"%ls\\%ls", srcDir, files[i]);
        wsprintfW(destPath, L"%ls\\%ls", destDir, files[i]);
        if (GetFileAttributesW(srcPath) != INVALID_FILE_ATTRIBUTES) {
            CopyFileW(srcPath, destPath, FALSE);
        }
    }
}

static BOOL RegisterService(const wchar_t* installDir)
{
    wchar_t svcExe[MAX_PATH];
    wsprintfW(svcExe, L"%ls\\PECAppSvc.exe", installDir);
    if (GetFileAttributesW(svcExe) == INVALID_FILE_ATTRIBUTES) {
        wsprintfW(svcExe, L"%ls\\ProxyBridgeSvc.exe", installDir);
    }

    SC_HANDLE hSCM = OpenSCManagerW(NULL, NULL, SC_MANAGER_ALL_ACCESS);
    if (!hSCM) return FALSE;

    wchar_t binPathQuote[MAX_PATH + 4];
    wsprintfW(binPathQuote, L"\"%ls\"", svcExe);

    SC_HANDLE hSvc = CreateServiceW(
        hSCM, SVC_NAME, SVC_DISPLAY,
        SERVICE_ALL_ACCESS, SERVICE_WIN32_OWN_PROCESS,
        SERVICE_AUTO_START, SERVICE_ERROR_NORMAL,
        binPathQuote, NULL, NULL, NULL, NULL, NULL
    );

    if (!hSvc) {
        hSvc = OpenServiceW(hSCM, SVC_NAME, SERVICE_ALL_ACCESS);
    }

    if (hSvc) {
        SERVICE_DESCRIPTIONW sd;
        sd.lpDescription = (LPWSTR)SVC_DESC;
        ChangeServiceConfig2W(hSvc, SERVICE_CONFIG_DESCRIPTION, &sd);

        PSECURITY_DESCRIPTOR pSD = NULL;
        if (ConvertStringSecurityDescriptorToSecurityDescriptorW(SVC_SDDL, SDDL_REVISION_1, &pSD, NULL)) {
            SetServiceObjectSecurity(hSvc, DACL_SECURITY_INFORMATION, pSD);
            LocalFree(pSD);
        }

        CloseServiceHandle(hSvc);
    }
    CloseServiceHandle(hSCM);

    // Run --setup-users to ensure PEC-App Users group exists
    wchar_t setupCmd[MAX_PATH + 32];
    wsprintfW(setupCmd, L"\"%ls\" --setup-users", svcExe);
    ExecWait(setupCmd, installDir, NULL);

    // Start service
    hSCM = OpenSCManagerW(NULL, NULL, SC_MANAGER_ALL_ACCESS);
    if (hSCM) {
        hSvc = OpenServiceW(hSCM, SVC_NAME, SERVICE_START);
        if (hSvc) {
            StartServiceW(hSvc, 0, NULL);
            CloseServiceHandle(hSvc);
        }
        CloseServiceHandle(hSCM);
    }

    return TRUE;
}

static void RegisterUninstallInfo(const wchar_t* installDir)
{
    HKEY hKey;
    if (RegCreateKeyExW(HKEY_LOCAL_MACHINE, UNINST_KEY, 0, NULL, 0, KEY_WRITE, NULL, &hKey, NULL) == ERROR_SUCCESS) {
        wchar_t uninstPath[MAX_PATH + 32];
        wsprintfW(uninstPath, L"\"%ls\\Uninstall.exe\" /uninstall", installDir);

        wchar_t iconPath[MAX_PATH + 16];
        wsprintfW(iconPath, L"\"%ls\\PEC-App.exe\",0", installDir);

        DWORD dwordOne = 1;
        RegSetValueExW(hKey, L"DisplayName", 0, REG_SZ, (const BYTE*)APP_NAME, (DWORD)(wcslen(APP_NAME) + 1) * sizeof(wchar_t));
        RegSetValueExW(hKey, L"DisplayVersion", 0, REG_SZ, (const BYTE*)APP_VERSION, (DWORD)(wcslen(APP_VERSION) + 1) * sizeof(wchar_t));
        RegSetValueExW(hKey, L"Publisher", 0, REG_SZ, (const BYTE*)APP_PUBLISHER, (DWORD)(wcslen(APP_PUBLISHER) + 1) * sizeof(wchar_t));
        RegSetValueExW(hKey, L"InstallLocation", 0, REG_SZ, (const BYTE*)installDir, (DWORD)(wcslen(installDir) + 1) * sizeof(wchar_t));
        RegSetValueExW(hKey, L"UninstallString", 0, REG_SZ, (const BYTE*)uninstPath, (DWORD)(wcslen(uninstPath) + 1) * sizeof(wchar_t));
        RegSetValueExW(hKey, L"DisplayIcon", 0, REG_SZ, (const BYTE*)iconPath, (DWORD)(wcslen(iconPath) + 1) * sizeof(wchar_t));
        RegSetValueExW(hKey, L"NoModify", 0, REG_DWORD, (const BYTE*)&dwordOne, sizeof(DWORD));
        RegSetValueExW(hKey, L"NoRepair", 0, REG_DWORD, (const BYTE*)&dwordOne, sizeof(DWORD));

        RegCloseKey(hKey);
    }
}

static DWORD WINAPI InstallThread(LPVOID lpParam)
{
    (void)lpParam;
    CoInitialize(NULL);

    SetStatus(L"Stopping running processes...", 10);
    TerminateExistingProcesses();

    SetStatus(L"Preparing service and directories...", 25);
    StopAndRemoveServices();

    CreateDirectoryW(g_installDir, NULL);

    // Secure destination directory ACL
    wchar_t sysDir[MAX_PATH];
    GetSystemDirectoryW(sysDir, MAX_PATH);
    wchar_t icaclsCmd[1024];
    _snwprintf_s(icaclsCmd, 1024, _TRUNCATE, L"\"%ls\\icacls.exe\" \"%ls\" /inheritance:r /grant:r \"*S-1-5-18:(OI)(CI)F\" \"*S-1-5-32-544:(OI)(CI)F\" \"*S-1-5-32-545:(OI)(CI)RX\"", sysDir, g_installDir);
    ExecWait(icaclsCmd, NULL, NULL);

    SetStatus(L"Extracting PEC-App files...", 45);
    BOOL unpacked = ExtractEmbeddedPayload(g_installDir);
    if (!unpacked) {
        wchar_t myDir[MAX_PATH];
        GetModuleFileNameW(NULL, myDir, MAX_PATH);
        for (DWORD i = (DWORD)wcslen(myDir); i > 0; i--) { if (myDir[i - 1] == L'\\') { myDir[i] = 0; break; } }
        CopyFromSourceFolder(myDir, g_installDir);
    }

    // Save copy of installer as uninstaller
    wchar_t myPath[MAX_PATH], uninstExe[MAX_PATH];
    GetModuleFileNameW(NULL, myPath, MAX_PATH);
    wsprintfW(uninstExe, L"%ls\\Uninstall.exe", g_installDir);
    CopyFileW(myPath, uninstExe, FALSE);

    SetStatus(L"Registering Windows service (PECAppSvc)...", 70);
    RegisterService(g_installDir);

    SetStatus(L"Creating shortcuts & registering uninstaller...", 85);
    wchar_t smDir[MAX_PATH];
    if (SHGetFolderPathW(NULL, CSIDL_COMMON_PROGRAMS, NULL, 0, smDir) == S_OK) {
        lstrcatW(smDir, L"\\PEC-App");
        CreateDirectoryW(smDir, NULL);
        wchar_t lnkPath[MAX_PATH], targetExe[MAX_PATH];
        wsprintfW(lnkPath, L"%ls\\PEC-App.lnk", smDir);
        wsprintfW(targetExe, L"%ls\\PEC-App.exe", g_installDir);
        CreateShortcut(lnkPath, targetExe, g_installDir, L"PEC-App Transparent Proxy Client");
    }

    RegisterUninstallInfo(g_installDir);

    SetStatus(L"Installation successfully completed!", 100);
    g_completed = TRUE;

    if (g_hBtnAction && IsWindow(g_hBtnAction)) {
        SetWindowTextW(g_hBtnAction, L"Finish");
        EnableWindow(g_hBtnAction, TRUE);
    }

    if (g_silent) {
        if (!g_noRun) {
            wchar_t winDir[MAX_PATH];
            GetWindowsDirectoryW(winDir, MAX_PATH);
            wchar_t runCmd[MAX_PATH + 32];
            _snwprintf_s(runCmd, MAX_PATH + 32, _TRUNCATE, L"\"%ls\\explorer.exe\" \"%ls\\PEC-App.exe\"", winDir, g_installDir);
            ExecWait(runCmd, NULL, NULL);
        }
        PostQuitMessage(0);
    }

    CoUninitialize();
    return 0;
}

static DWORD WINAPI UninstallThread(LPVOID lpParam)
{
    (void)lpParam;
    SetStatus(L"Stopping processes...", 15);
    TerminateExistingProcesses();

    SetStatus(L"Removing Windows service...", 35);
    StopAndRemoveServices();

    SetStatus(L"Removing shortcuts and registry entries...", 60);
    wchar_t smDir[MAX_PATH];
    if (SHGetFolderPathW(NULL, CSIDL_COMMON_PROGRAMS, NULL, 0, smDir) == S_OK) {
        wchar_t lnkPath[MAX_PATH];
        wsprintfW(lnkPath, L"%ls\\PEC-App\\PEC-App.lnk", smDir);
        DeleteFileW(lnkPath);
        wsprintfW(lnkPath, L"%ls\\PEC-App", smDir);
        RemoveDirectoryW(lnkPath);
    }

    RegDeleteKeyW(HKEY_LOCAL_MACHINE, UNINST_KEY);

    SetStatus(L"Removing installed files...", 85);
    const wchar_t* files[] = {
        L"PEC-App.exe", L"PEC-CLI.exe", L"PECAppSvc.exe", L"PECAppCore.dll",
        L"ProxyBridgeCore.dll", L"ProxyBridge.exe", L"pbcli.exe", L"ProxyBridgeSvc.exe",
        L"WinDivert.dll", L"WinDivert64.sys", L"pec_profile.pbprofile",
        L"Install.cmd", L"Uninstall.cmd", L"deploy-pec-app.ps1", L"verify-pec-app.ps1",
        L"README.txt", L"Uninstall.exe"
    };

    for (size_t i = 0; i < sizeof(files) / sizeof(files[0]); i++) {
        wchar_t path[MAX_PATH];
        wsprintfW(path, L"%ls\\%ls", g_installDir, files[i]);
        DeleteFileW(path);
    }
    RemoveDirectoryW(g_installDir);

    SetStatus(L"PEC-App uninstallation complete.", 100);
    g_completed = TRUE;

    if (g_hBtnAction && IsWindow(g_hBtnAction)) {
        SetWindowTextW(g_hBtnAction, L"Close");
        EnableWindow(g_hBtnAction, TRUE);
    }

    if (g_silent) {
        PostQuitMessage(0);
    }

    return 0;
}

static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam)
{
    switch (msg) {
    case WM_CREATE: {
        HFONT hFontDef = (HFONT)GetStockObject(DEFAULT_GUI_FONT);
        LOGFONTW lf;
        GetObjectW(hFontDef, sizeof(lf), &lf);

        lstrcpyW(lf.lfFaceName, L"Segoe UI");
        lf.lfHeight = -18;
        lf.lfWeight = FW_BOLD;
        g_hFontTitle = CreateFontIndirectW(&lf);

        lf.lfHeight = -13;
        lf.lfWeight = FW_NORMAL;
        g_hFontNormal = CreateFontIndirectW(&lf);

        HWND hTitle = CreateWindowW(L"STATIC",
            g_uninstall ? L"Uninstalling PEC-App" : L"Installing PEC-App v" APP_VERSION,
            WS_CHILD | WS_VISIBLE, 24, 20, 420, 26, hwnd, (HMENU)IDC_TITLE, g_hInst, NULL);
        SendMessageW(hTitle, WM_SETFONT, (WPARAM)g_hFontTitle, TRUE);

        g_hStatus = CreateWindowW(L"STATIC", L"Initializing setup pipeline...",
            WS_CHILD | WS_VISIBLE, 24, 56, 420, 20, hwnd, (HMENU)IDC_STATUS, g_hInst, NULL);
        SendMessageW(g_hStatus, WM_SETFONT, (WPARAM)g_hFontNormal, TRUE);

        g_hProgress = CreateWindowExW(0, PROGRESS_CLASSW, NULL,
            WS_CHILD | WS_VISIBLE | PBS_SMOOTH, 24, 86, 436, 22, hwnd, (HMENU)IDC_PROGRESS, g_hInst, NULL);
        SendMessageW(g_hProgress, PBM_SETRANGE32, 0, 100);
        SendMessageW(g_hProgress, PBM_SETPOS, 5, 0);

        if (!g_uninstall) {
            g_hChkRun = CreateWindowW(L"BUTTON", L"Launch PEC-App upon completion",
                WS_CHILD | WS_VISIBLE | BS_AUTOCHECKBOX, 24, 122, 280, 22, hwnd, (HMENU)IDC_CHK_RUN, g_hInst, NULL);
            SendMessageW(g_hChkRun, WM_SETFONT, (WPARAM)g_hFontNormal, TRUE);
            SendMessageW(g_hChkRun, BM_SETCHECK, BST_CHECKED, 0);
        }

        g_hBtnAction = CreateWindowW(L"BUTTON", L"Installing...",
            WS_CHILD | WS_VISIBLE | WS_DISABLED | BS_DEFPUSHBUTTON, 360, 130, 100, 28, hwnd, (HMENU)IDC_BTN_ACTION, g_hInst, NULL);
        SendMessageW(g_hBtnAction, WM_SETFONT, (WPARAM)g_hFontNormal, TRUE);

        HANDLE hThread = CreateThread(NULL, 0, g_uninstall ? UninstallThread : InstallThread, NULL, 0, NULL);
        if (hThread) CloseHandle(hThread);
        return 0;
    }

    case WM_COMMAND: {
        int id = LOWORD(wParam);
        if (id == IDC_BTN_ACTION && g_completed) {
            if (!g_uninstall && g_hChkRun && SendMessageW(g_hChkRun, BM_GETCHECK, 0, 0) == BST_CHECKED) {
                wchar_t winDir[MAX_PATH];
                GetWindowsDirectoryW(winDir, MAX_PATH);
                wchar_t runCmd[MAX_PATH + 32];
                _snwprintf_s(runCmd, MAX_PATH + 32, _TRUNCATE, L"\"%ls\\explorer.exe\" \"%ls\\PEC-App.exe\"", winDir, g_installDir);
                ExecWait(runCmd, NULL, NULL);
            }
            DestroyWindow(hwnd);
            return 0;
        }
        break;
    }

    case WM_DESTROY:
        if (g_hFontTitle) DeleteObject(g_hFontTitle);
        if (g_hFontNormal) DeleteObject(g_hFontNormal);
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

int WINAPI wWinMain(HINSTANCE hInst, HINSTANCE hPrev, PWSTR cmdLine, int nCmdShow)
{
    (void)hPrev;
    g_hInst = hInst;

    INITCOMMONCONTROLSEX icex;
    icex.dwSize = sizeof(icex);
    icex.dwICC = ICC_PROGRESS_CLASS | ICC_STANDARD_CLASSES;
    InitCommonControlsEx(&icex);

    // Default install dir: %ProgramFiles%\PEC-App
    if (SHGetFolderPathW(NULL, CSIDL_PROGRAM_FILES, NULL, 0, g_installDir) != S_OK) {
        lstrcpyW(g_installDir, L"C:\\Program Files");
    }
    lstrcatW(g_installDir, L"\\PEC-App");

    if (cmdLine) {
        if (wcsstr(cmdLine, L"/S") || wcsstr(cmdLine, L"/s") || wcsstr(cmdLine, L"/silent") || wcsstr(cmdLine, L"/q")) {
            g_silent = TRUE;
        }
        if (wcsstr(cmdLine, L"/uninstall") || wcsstr(cmdLine, L"/u")) {
            g_uninstall = TRUE;
        }
        if (wcsstr(cmdLine, L"/norun")) {
            g_noRun = TRUE;
        }
    }

    if (g_silent) {
        HANDLE hThread = CreateThread(NULL, 0, g_uninstall ? UninstallThread : InstallThread, NULL, 0, NULL);
        if (hThread) {
            WaitForSingleObject(hThread, 60000);
            CloseHandle(hThread);
        }
        return 0;
    }

    WNDCLASSEXW wc;
    ZeroMemory(&wc, sizeof(wc));
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInst;
    wc.hIcon = LoadIconW(hInst, MAKEINTRESOURCEW(100));
    wc.hCursor = LoadCursorW(NULL, IDC_ARROW);
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    wc.lpszClassName = L"PECAppSetupClass";

    RegisterClassExW(&wc);

    int width = 500;
    int height = 210;
    int x = (GetSystemMetrics(SM_CXSCREEN) - width) / 2;
    int y = (GetSystemMetrics(SM_CYSCREEN) - height) / 2;

    g_hMain = CreateWindowExW(
        WS_EX_DLGMODALFRAME | WS_EX_TOPMOST,
        wc.lpszClassName,
        g_uninstall ? L"PEC-App Uninstaller" : L"PEC-App Setup v" APP_VERSION,
        WS_POPUP | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX | WS_VISIBLE,
        x, y, width, height, NULL, NULL, hInst, NULL
    );

    ShowWindow(g_hMain, nCmdShow);
    UpdateWindow(g_hMain);

    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    return (int)msg.wParam;
}

#if defined(__GNUC__)
int WINAPI WinMain(HINSTANCE hInst, HINSTANCE hPrev, LPSTR lpCmdLine, int nShowCmd)
{
    (void)lpCmdLine;
    return wWinMain(hInst, hPrev, GetCommandLineW(), nShowCmd);
}
#endif
