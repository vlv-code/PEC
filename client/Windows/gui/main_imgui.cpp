// main_imgui.cpp - Modern Native DirectX 11 GUI for PEC-App via Dear ImGui
// Features: Cyber Blue Dark Theme, Real-Time Connection Streaming, Rules Manager,
// System Tray Integration, Profile Persistence, and PECAppCore Engine Hooks.

#define _CRT_SECURE_NO_WARNINGS
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif

#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <d3d11.h>
#include <dxgi.h>
#include <dwmapi.h>
#include <shellapi.h>
#include <shlwapi.h>
#include <commctrl.h>

#include <string>
#include <vector>
#include <deque>
#include <chrono>
#include <thread>
#include <algorithm>
#include <mutex>
#include <cstdio>
#include <cstring>

#if defined(_MSC_VER) || defined(__clang__)
#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "dxgi.lib")
#pragma comment(lib, "d3dcompiler.lib")
#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")
#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "winhttp.lib")
#pragma comment(lib, "comctl32.lib")
#endif

#include "imgui/imgui.h"
#include "imgui/imgui_internal.h"
#include "imgui/backends/imgui_impl_win32.h"
#include "imgui/backends/imgui_impl_dx11.h"

#include "pec_imgui_theme.h"
#include "res/resource.h"

extern "C" {
#include "profile/profile.h"
#include "api/pb_api.h"
#include "api/pb_ipc.h"
}

#ifndef DWMWA_USE_IMMERSIVE_DARK_MODE
#define DWMWA_USE_IMMERSIVE_DARK_MODE 20
#endif

#define WM_APP_TRAY           (WM_APP + 3)
#define WM_APP_UPDATE         (WM_APP + 8)
#define WM_APP_RELOAD_PROFILE (WM_APP + 9)
#define APP_TITLE_A "PEC-App v2.2.0"
#define APP_TITLE_W L"PEC-App v2.2.0"

static PBApi            g_api = {};
static PBProfile        g_profile = {};
static CRITICAL_SECTION g_profileCs;
static wchar_t          g_activeProfile[PB_NAME_MAX] = L"Default";

extern "C" {
#include "ui/pec_sync.h"
}

// -----------------------------------------------------------------------------
// Forward declarations
// -----------------------------------------------------------------------------
extern IMGUI_IMPL_API LRESULT ImGui_ImplWin32_WndProcHandler(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam);
LRESULT WINAPI WndProc(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam);

// -----------------------------------------------------------------------------
// DirectX 11 Data & Helpers
// -----------------------------------------------------------------------------
static ID3D11Device*           g_pd3dDevice = nullptr;
static ID3D11DeviceContext*     g_pd3dDeviceContext = nullptr;
static IDXGISwapChain*          g_pSwapChain = nullptr;
static ID3D11RenderTargetView*  g_mainRenderTargetView = nullptr;

static void CreateRenderTarget();
static void CleanupRenderTarget();

static bool CreateDeviceD3D(HWND hWnd)
{
    DXGI_SWAP_CHAIN_DESC sd;
    ZeroMemory(&sd, sizeof(sd));
    sd.BufferCount = 2;
    sd.BufferDesc.Width = 0;
    sd.BufferDesc.Height = 0;
    sd.BufferDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
    sd.BufferDesc.RefreshRate.Numerator = 60;
    sd.BufferDesc.RefreshRate.Denominator = 1;
    sd.Flags = DXGI_SWAP_CHAIN_FLAG_ALLOW_MODE_SWITCH;
    sd.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    sd.OutputWindow = hWnd;
    sd.SampleDesc.Count = 1;
    sd.SampleDesc.Quality = 0;
    sd.Windowed = TRUE;
    sd.SwapEffect = DXGI_SWAP_EFFECT_DISCARD;

    UINT createDeviceFlags = 0;
    D3D_FEATURE_LEVEL featureLevel;
    const D3D_FEATURE_LEVEL featureLevelArray[2] = {
        D3D_FEATURE_LEVEL_11_0,
        D3D_FEATURE_LEVEL_10_0,
    };

    HRESULT hr = D3D11CreateDeviceAndSwapChain(
        nullptr,
        D3D_DRIVER_TYPE_HARDWARE,
        nullptr,
        createDeviceFlags,
        featureLevelArray,
        2,
        D3D11_SDK_VERSION,
        &sd,
        &g_pSwapChain,
        &g_pd3dDevice,
        &featureLevel,
        &g_pd3dDeviceContext);

    if (hr != S_OK) {
        hr = D3D11CreateDeviceAndSwapChain(
            nullptr,
            D3D_DRIVER_TYPE_WARP,
            nullptr,
            createDeviceFlags,
            featureLevelArray,
            2,
            D3D11_SDK_VERSION,
            &sd,
            &g_pSwapChain,
            &g_pd3dDevice,
            &featureLevel,
            &g_pd3dDeviceContext);
    }

    if (hr != S_OK) return false;

    CreateRenderTarget();
    return (g_mainRenderTargetView != nullptr);
}

static void CreateRenderTarget()
{
    if (!g_pSwapChain || !g_pd3dDevice) return;
    ID3D11Texture2D* pBackBuffer = nullptr;
    g_pSwapChain->GetBuffer(0, IID_PPV_ARGS(&pBackBuffer));
    if (pBackBuffer) {
        g_pd3dDevice->CreateRenderTargetView(pBackBuffer, nullptr, &g_mainRenderTargetView);
        pBackBuffer->Release();
    }
}

static void CleanupRenderTarget()
{
    if (g_pd3dDeviceContext) {
        g_pd3dDeviceContext->OMSetRenderTargets(0, nullptr, nullptr);
    }
    if (g_mainRenderTargetView) {
        g_mainRenderTargetView->Release();
        g_mainRenderTargetView = nullptr;
    }
}

static void CleanupDeviceD3D()
{
    CleanupRenderTarget();
    if (g_pSwapChain) { g_pSwapChain->Release(); g_pSwapChain = nullptr; }
    if (g_pd3dDeviceContext) { g_pd3dDeviceContext->Release(); g_pd3dDeviceContext = nullptr; }
    if (g_pd3dDevice) { g_pd3dDevice->Release(); g_pd3dDevice = nullptr; }
}

// -----------------------------------------------------------------------------
// UTF-8 / UTF-16 Conversion Helpers
// -----------------------------------------------------------------------------
static std::string WToUtf8(const wchar_t* w)
{
    if (!w || !*w) return "";
    int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
    if (n <= 1) return "";
    std::string s(n - 1, 0);
    WideCharToMultiByte(CP_UTF8, 0, w, -1, &s[0], n, nullptr, nullptr);
    return s;
}

static std::wstring Utf8ToW(const char* s)
{
    if (!s || !*s) return L"";
    int n = MultiByteToWideChar(CP_UTF8, 0, s, -1, nullptr, 0);
    if (n <= 1) return L"";
    std::wstring w(n - 1, 0);
    MultiByteToWideChar(CP_UTF8, 0, s, -1, &w[0], n);
    return w;
}

static void CopyWToUtf8(const wchar_t* src, char* dst, size_t dstSize)
{
    if (!dst || dstSize == 0) return;
    dst[0] = '\0';
    if (!src) return;
    WideCharToMultiByte(CP_UTF8, 0, src, -1, dst, (int)dstSize, nullptr, nullptr);
    dst[dstSize - 1] = '\0';
}

static void CopyUtf8ToW(const char* src, wchar_t* dst, size_t dstCount)
{
    if (!dst || dstCount == 0) return;
    dst[0] = L'\0';
    if (!src) return;
    MultiByteToWideChar(CP_UTF8, 0, src, -1, dst, (int)dstCount);
    dst[dstCount - 1] = L'\0';
}

static void W2Ux(const wchar_t* w, char* out, int cch)
{
    if (cch <= 0) return;
    out[0] = 0;
    if (!WideCharToMultiByte(CP_UTF8, 0, w ? w : L"", -1, out, cch, NULL, NULL)) out[0] = 0;
}

// -----------------------------------------------------------------------------
// Global Application State
// -----------------------------------------------------------------------------
static HWND             g_hWnd = nullptr;
static NOTIFYICONDATAW  g_trayData = {};
static bool             g_trayAdded = false;
static bool             g_reallyExit = false;
static bool             g_closeToTray = true;
static bool             g_proxyEnabled = true;
static bool             g_engineStarted = false;
static bool             g_connLogging = true;
static bool             g_proxiedOnly = false;
static UINT             g_wmTaskbarCreated = 0;

// -----------------------------------------------------------------------------
// Live Connection Stream Ring Buffer (Tab 2)
// -----------------------------------------------------------------------------
struct ConnEntry {
    char time[16];
    char process[64];
    DWORD pid;
    char hostIp[128];
    unsigned short port;
    char action[16];   // "DIRECT", "PROXY", "BLOCK"
    char proxy[64];    // proxy server name
    char status[32];   // "Active", "Direct", "Blocked"
    bool isDirect;
    bool isBlock;
};

static constexpr size_t MAX_CONN_ENTRIES = 2000;
struct ConnRingBuffer {
    ConnEntry entries[MAX_CONN_ENTRIES];
    size_t head = 0;
    size_t count = 0;
    CRITICAL_SECTION cs;

    void Init() { InitializeCriticalSection(&cs); }
    void Destroy() { DeleteCriticalSection(&cs); }

    void Push(const ConnEntry& entry) {
        EnterCriticalSection(&cs);
        entries[head] = entry;
        head = (head + 1) % MAX_CONN_ENTRIES;
        if (count < MAX_CONN_ENTRIES) count++;
        LeaveCriticalSection(&cs);
    }

    void Clear() {
        EnterCriticalSection(&cs);
        head = 0;
        count = 0;
        LeaveCriticalSection(&cs);
    }

    void GetSnapshot(std::vector<ConnEntry>& out) {
        EnterCriticalSection(&cs);
        out.resize(count);
        if (count > 0) {
            size_t start = (head + MAX_CONN_ENTRIES - count) % MAX_CONN_ENTRIES;
            for (size_t i = 0; i < count; i++) {
                out[i] = entries[(start + i) % MAX_CONN_ENTRIES];
            }
        }
        LeaveCriticalSection(&cs);
    }
};
static ConnRingBuffer g_connBuffer;

// -----------------------------------------------------------------------------
// Engine Diagnostic Log Buffer (Tab 3)
// -----------------------------------------------------------------------------
struct LogEntry {
    char time[16];
    std::string message;
    int level; // 0=info, 1=warn, 2=error
};
static constexpr size_t MAX_LOG_ENTRIES = 2000;
static std::deque<LogEntry> g_logEntries;
static CRITICAL_SECTION g_logCs;

static void CheckAndRotateAppLog()
{
    wchar_t logPath[MAX_PATH];
    PB_GetLogFilePath(logPath, MAX_PATH);
    WIN32_FILE_ATTRIBUTE_DATA fad;
    if (GetFileAttributesExW(logPath, GetFileExInfoStandard, &fad)) {
        LARGE_INTEGER size;
        size.HighPart = fad.nFileSizeHigh;
        size.LowPart = fad.nFileSizeLow;
        const LONGLONG MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB
        if (size.QuadPart >= MAX_LOG_SIZE) {
            wchar_t rotPath[MAX_PATH];
            _snwprintf_s(rotPath, MAX_PATH, _TRUNCATE, L"%ls.1", logPath);
            DeleteFileW(rotPath);
            MoveFileExW(logPath, rotPath, MOVEFILE_REPLACE_EXISTING);
        }
    }
}

static void LogAdd(const char* message, int level = 0)
{
    SYSTEMTIME st;
    GetLocalTime(&st);
    char ts[16];
    snprintf(ts, sizeof(ts), "%02d:%02d:%02d", st.wHour, st.wMinute, st.wSecond);

    EnterCriticalSection(&g_logCs);
    if (g_logEntries.size() >= MAX_LOG_ENTRIES) {
        g_logEntries.pop_front();
    }
    g_logEntries.push_back({ "", message ? message : "", level });
    snprintf(g_logEntries.back().time, sizeof(g_logEntries.back().time), "%s", ts);
    LeaveCriticalSection(&g_logCs);

    CheckAndRotateAppLog();
    PB_WriteAppLog("ENGINE: %s", message ? message : "");
}

// -----------------------------------------------------------------------------
// DLL Callbacks from PECAppCore
// -----------------------------------------------------------------------------
static void PBLogCb(const char* message)
{
    if (!message) return;
    int level = 0;
    if (strstr(message, "error") || strstr(message, "FAIL") || strstr(message, "Error")) level = 2;
    else if (strstr(message, "warn") || strstr(message, "WARN")) level = 1;
    LogAdd(message, level);
}

static void PBConnCb(const char* proc, DWORD pid, const char* ip, unsigned short port, const char* info)
{
    if (!g_connLogging) return;

    bool isDirect = (info && _strnicmp(info, "Direct", 6) == 0);
    bool isBlock  = (info && _strnicmp(info, "Block",  5) == 0);

    if (g_proxiedOnly && isDirect) return;

    // Filter out OS daemon background noise going direct
    if (isDirect && proc) {
        if (_stricmp(proc, "lsass.exe") == 0 ||
            _stricmp(proc, "svchost.exe") == 0 ||
            _stricmp(proc, "WmiPrvSE.exe") == 0 ||
            _stricmp(proc, "services.exe") == 0 ||
            _stricmp(proc, "System") == 0 ||
            _stricmp(proc, "spoolsv.exe") == 0 ||
            _stricmp(proc, "SearchIndexer.exe") == 0 ||
            _stricmp(proc, "smss.exe") == 0 ||
            _stricmp(proc, "csrss.exe") == 0)
        {
            return;
        }
    }

    ConnEntry e;
    SYSTEMTIME st;
    GetLocalTime(&st);
    snprintf(e.time, sizeof(e.time), "%02d:%02d:%02d", st.wHour, st.wMinute, st.wSecond);
    snprintf(e.process, sizeof(e.process), "%s", proc ? proc : "Unknown");
    e.pid = pid;
    snprintf(e.hostIp, sizeof(e.hostIp), "%s:%u", ip ? ip : "?", port);
    e.port = port;
    e.isDirect = isDirect;
    e.isBlock  = isBlock;

    if (isDirect) {
        snprintf(e.action, sizeof(e.action), "DIRECT");
        snprintf(e.proxy, sizeof(e.proxy), "-");
        snprintf(e.status, sizeof(e.status), "Direct");
    } else if (isBlock) {
        snprintf(e.action, sizeof(e.action), "BLOCK");
        snprintf(e.proxy, sizeof(e.proxy), "-");
        snprintf(e.status, sizeof(e.status), "Blocked");
    } else {
        snprintf(e.action, sizeof(e.action), "PROXY");
        snprintf(e.proxy, sizeof(e.proxy), "%s", info ? info : "Proxy");
        snprintf(e.status, sizeof(e.status), "Active");
    }

    g_connBuffer.Push(e);
    EnterCriticalSection(&g_profileCs);
    bool logEvery = g_profile.logEveryConnection != 0;
    LeaveCriticalSection(&g_profileCs);

    if (!isDirect || logEvery) {
        CheckAndRotateAppLog();
        PB_WriteAppLog("CONN: %s [PID %lu] -> %s:%u (%s)", proc ? proc : "?", pid, ip ? ip : "?", port, info ? info : "Direct");
    }
}

// -----------------------------------------------------------------------------
// Engine & Profile Integration Helpers
// -----------------------------------------------------------------------------
typedef struct {
    char proc[PB_APPS_MAX * 3 + 4];
    char ports[128 * 3 + 4];
    char ips[PB_HOSTS_MAX * 3 + 4];
    char doms[PB_HOSTS_MAX * 3 + 4];
} EngineStr;

static EngineStr* EngineStrings(const PBRule* r)
{
    EngineStr* s = (EngineStr*)malloc(sizeof(*s));
    if (!s) return nullptr;
    size_t n = wcslen(r->hosts) + 2;
    wchar_t* wi = (wchar_t*)malloc(n * sizeof(wchar_t));
    wchar_t* wd = (wchar_t*)malloc(n * sizeof(wchar_t));
    if (!wi || !wd) { free(s); free(wi); free(wd); return nullptr; }
    PB_HostsSplit(r->hosts, wi, n, wd, n);
    W2Ux(r->proc, s->proc, sizeof(s->proc));
    W2Ux(r->ports, s->ports, sizeof(s->ports));
    W2Ux(wi, s->ips, sizeof(s->ips));
    W2Ux(wd, s->doms, sizeof(s->doms));
    free(wi);
    free(wd);
    return s;
}

static int ProtoIdx(const wchar_t* s)  { if (!_wcsicmp(s, L"UDP")) return 1; if (!_wcsicmp(s, L"BOTH")) return 2; return 0; }
static int ActionIdx(const wchar_t* s) { if (!_wcsicmp(s, L"DIRECT")) return 1; if (!_wcsicmp(s, L"BLOCK")) return 2; return 0; }

struct ProfileLock {
    ProfileLock()  { EnterCriticalSection(&g_profileCs); }
    ~ProfileLock() { LeaveCriticalSection(&g_profileCs); }
    ProfileLock(const ProfileLock&) = delete;
    ProfileLock& operator=(const ProfileLock&) = delete;
};

static UINT32 ResolveNativeCfg(UINT32 storedId)
{
    ProfileLock lock;
    for (int i = 0; i < g_profile.cfgCount; i++) {
        if (g_profile.cfg[i].storedId == storedId) return g_profile.cfg[i].nativeId;
    }
    return 0; // 0 => engine routes via first available config
}

static void SaveProfile()
{
    ProfileLock lock;
    PB_ProfileSave(g_activeProfile, &g_profile);

    wchar_t exeDir[MAX_PATH];
    GetModuleFileNameW(nullptr, exeDir, MAX_PATH);
    wchar_t* last = wcsrchr(exeDir, L'\\');
    if (last) *last = 0; else exeDir[0] = 0;
    if (exeDir[0]) {
        wchar_t cand[MAX_PATH];
        _snwprintf_s(cand, MAX_PATH, _TRUNCATE, L"%s\\pec_profile.pbprofile", exeDir);
        if (GetFileAttributesW(cand) != INVALID_FILE_ATTRIBUTES) {
            PB_ProfileSave(cand, &g_profile);
        }
    }
}

static void UnapplyRules()
{
    ProfileLock lock;
    if (g_api.DeleteRule) {
        for (int i = 0; i < g_profile.ruleCount; i++) {
            if (g_profile.rule[i].nativeId) {
                g_api.DeleteRule(g_profile.rule[i].nativeId);
                g_profile.rule[i].nativeId = 0;
            }
        }
    }
}

static void ApplyConfigs()
{
    if (!g_api.AddProxyConfig) return;
    ProfileLock lock;
    for (int i = 0; i < g_profile.cfgCount; i++) {
        PBConfig* c = &g_profile.cfg[i];
        int type = (_wcsicmp(c->type, L"HTTP") == 0) ? PB_PROXY_HTTP : PB_PROXY_SOCKS5;
        char h[256], u[256], p[256];
        W2Ux(c->host, h, sizeof(h));
        W2Ux(c->user, u, sizeof(u));
        W2Ux(c->pass, p, sizeof(p));
        c->nativeId = g_api.AddProxyConfig((PBProxyType)type, h, (unsigned short)_wtoi(c->port), u, p, c->sendDomain ? TRUE : FALSE);
        if (c->storedId == 0) {
            c->storedId = PB_AllocConfigId(&g_profile);
        }
    }
}

static void ApplyRules()
{
    if (!g_api.AddRule) return;
    ProfileLock lock;
    for (int i = 0; i < g_profile.ruleCount; i++) {
        PBRule* r = &g_profile.rule[i];
        EngineStr* s = EngineStrings(r);
        if (!s) continue;
        r->nativeId = g_api.AddRule(s->proc, s->ips, s->ports, s->doms,
                                    (PBRuleProtocol)ProtoIdx(r->proto),
                                    (PBRuleAction)ActionIdx(r->action),
                                    ResolveNativeCfg(r->cfgStoredId),
                                    r->localhost != 0);
        if (r->nativeId && !r->enabled && g_api.DisableRule) {
            g_api.DisableRule(r->nativeId);
        }
        free(s);
    }
}

static UINT32 EngineAddRule(PBRule* r)
{
    if (!g_api.AddRule) return 0;
    ProfileLock lock;
    EngineStr* s = EngineStrings(r);
    if (!s) return 0;
    UINT32 id = g_api.AddRule(s->proc, s->ips, s->ports, s->doms,
                              (PBRuleProtocol)ProtoIdx(r->proto),
                              (PBRuleAction)ActionIdx(r->action),
                              ResolveNativeCfg(r->cfgStoredId),
                              r->localhost != 0);
    r->nativeId = id;
    if (id && !r->enabled && g_api.DisableRule) {
        g_api.DisableRule(id);
    }
    free(s);
    return id;
}

static void EngineEditRule(PBRule* r)
{
    if (!g_api.EditRule || !r->nativeId) return;
    ProfileLock lock;
    EngineStr* s = EngineStrings(r);
    if (!s) return;
    g_api.EditRule(r->nativeId, s->proc, s->ips, s->ports, s->doms,
                   (PBRuleProtocol)ProtoIdx(r->proto),
                   (PBRuleAction)ActionIdx(r->action),
                   ResolveNativeCfg(r->cfgStoredId),
                   r->localhost != 0);
    if (r->enabled) {
        if (g_api.EnableRule) g_api.EnableRule(r->nativeId);
    } else {
        if (g_api.DisableRule) g_api.DisableRule(r->nativeId);
    }
    free(s);
}

static void UnapplyProfile()
{
    ProfileLock lock;
    if (g_api.DeleteRule) {
        for (int i = 0; i < g_profile.ruleCount; i++) {
            if (g_profile.rule[i].nativeId) {
                g_api.DeleteRule(g_profile.rule[i].nativeId);
                g_profile.rule[i].nativeId = 0;
            }
        }
    }
    if (g_api.DeleteProxyConfig) {
        for (int i = 0; i < g_profile.cfgCount; i++) {
            if (g_profile.cfg[i].nativeId) {
                g_api.DeleteProxyConfig(g_profile.cfg[i].nativeId);
                g_profile.cfg[i].nativeId = 0;
            }
        }
    }
}

static void SetProxyEnabled(bool enabled)
{
    g_proxyEnabled = enabled;
    if (g_api.SetEnabled) {
        g_api.SetEnabled(enabled ? TRUE : FALSE);
    }
    LogAdd(enabled ? "Статус прокси переключен: ВКЛЮЧЕН" : "Статус прокси переключен: ПРИОСТАНОВЛЕН");
}

static void SwitchActiveProxy(int cfgIndex)
{
    std::string proxyName;
    {
        ProfileLock lock;
        if (cfgIndex <= 0 || cfgIndex >= g_profile.cfgCount) return;

        // Swap cfgIndex with cfg[0] to make it primary
        PBConfig temp = g_profile.cfg[0];
        g_profile.cfg[0] = g_profile.cfg[cfgIndex];
        g_profile.cfg[cfgIndex] = temp;
        proxyName = WToUtf8(g_profile.cfg[0].name[0] ? g_profile.cfg[0].name : g_profile.cfg[0].host);
    }

    UnapplyProfile();
    ApplyConfigs();
    ApplyRules();
    SaveProfile();

    char buf[256];
    snprintf(buf, sizeof(buf), "Основной прокси переключен на: %s", proxyName.c_str());
    LogAdd(buf);
}

static void OpenLogsFolder()
{
    wchar_t logDir[MAX_PATH];
    PB_GetLogsDir(logDir, MAX_PATH);
    ShellExecuteW(nullptr, L"open", logDir, nullptr, nullptr, SW_SHOWNORMAL);
}

static void OpenLogFile()
{
    wchar_t logFile[MAX_PATH];
    PB_GetLogFilePath(logFile, MAX_PATH);
    ShellExecuteW(nullptr, L"open", logFile, nullptr, nullptr, SW_SHOWNORMAL);
}

// -----------------------------------------------------------------------------
// System Tray Helpers
// -----------------------------------------------------------------------------
static void TrayAdd(HWND hWnd)
{
    ZeroMemory(&g_trayData, sizeof(g_trayData));
    g_trayData.cbSize = sizeof(g_trayData);
    g_trayData.hWnd = hWnd;
    g_trayData.uID = 1;
    g_trayData.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
    g_trayData.uCallbackMessage = WM_APP_TRAY;
    g_trayData.hIcon = (HICON)LoadImageW(GetModuleHandleW(nullptr), MAKEINTRESOURCEW(IDI_APPICON), IMAGE_ICON, 16, 16, LR_DEFAULTSIZE);
    if (!g_trayData.hIcon) {
        g_trayData.hIcon = LoadIconW(nullptr, IDI_APPLICATION);
    }
    wcsncpy(g_trayData.szTip, L"PEC-App - Прокси активен", 127);
    Shell_NotifyIconW(NIM_ADD, &g_trayData);
    g_trayAdded = true;
}

static void TrayUpdateTip(const wchar_t* tip)
{
    if (!g_trayAdded) return;
    wcsncpy(g_trayData.szTip, tip, 127);
    Shell_NotifyIconW(NIM_MODIFY, &g_trayData);
}

static void TrayRemove()
{
    if (g_trayAdded) {
        Shell_NotifyIconW(NIM_DELETE, &g_trayData);
        if (g_trayData.hIcon) DestroyIcon(g_trayData.hIcon);
        g_trayAdded = false;
    }
}

// -----------------------------------------------------------------------------
// Asynchronous Proxy Latency Checker (Tab 4)
// -----------------------------------------------------------------------------
struct ProxyLatencyState {
    bool testing = false;
    int  ms = -1;
    char status[64] = "Не проверен";
};
static ProxyLatencyState g_proxyLatencies[PB_MAX_CFG];

static void TestProxyLatencyAsync(int cfgIdx)
{
    std::string host, port;
    {
        ProfileLock lock;
        if (cfgIdx < 0 || cfgIdx >= g_profile.cfgCount) return;
        if (g_proxyLatencies[cfgIdx].testing) return;
        g_proxyLatencies[cfgIdx].testing = true;
        snprintf(g_proxyLatencies[cfgIdx].status, sizeof(g_proxyLatencies[cfgIdx].status), "Проверка...");

        host = WToUtf8(g_profile.cfg[cfgIdx].host);
        port = WToUtf8(g_profile.cfg[cfgIdx].port);
    }

    std::thread([cfgIdx, host, port]() {
        struct addrinfo hints = {};
        hints.ai_family = AF_UNSPEC;
        hints.ai_socktype = SOCK_STREAM;
        hints.ai_protocol = IPPROTO_TCP;
        struct addrinfo* res = nullptr;

        auto start = std::chrono::high_resolution_clock::now();
        int rc = getaddrinfo(host.c_str(), port.c_str(), &hints, &res);
        if (rc != 0 || !res) {
            snprintf(g_proxyLatencies[cfgIdx].status, sizeof(g_proxyLatencies[cfgIdx].status), "DNS ошибка");
            g_proxyLatencies[cfgIdx].testing = false;
            return;
        }

        SOCKET s = socket(res->ai_family, res->ai_socktype, res->ai_protocol);
        if (s == INVALID_SOCKET) {
            freeaddrinfo(res);
            snprintf(g_proxyLatencies[cfgIdx].status, sizeof(g_proxyLatencies[cfgIdx].status), "Socket ошибка");
            g_proxyLatencies[cfgIdx].testing = false;
            return;
        }

        u_long mode = 1;
        ioctlsocket(s, FIONBIO, &mode);
        connect(s, res->ai_addr, (int)res->ai_addrlen);

        fd_set writeSet;
        FD_ZERO(&writeSet);
        FD_SET(s, &writeSet);
        timeval tv;
        tv.tv_sec = 3;
        tv.tv_usec = 0;

        int sel = select(0, nullptr, &writeSet, nullptr, &tv);
        auto end = std::chrono::high_resolution_clock::now();
        auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(end - start).count();

        if (sel > 0 && FD_ISSET(s, &writeSet)) {
            int err = 0;
            int errLen = sizeof(err);
            getsockopt(s, SOL_SOCKET, SO_ERROR, (char*)&err, &errLen);
            if (err == 0) {
                g_proxyLatencies[cfgIdx].ms = (int)ms;
                snprintf(g_proxyLatencies[cfgIdx].status, sizeof(g_proxyLatencies[cfgIdx].status), "%d ms (OK)", (int)ms);
            } else {
                snprintf(g_proxyLatencies[cfgIdx].status, sizeof(g_proxyLatencies[cfgIdx].status), "Ошибка соединения");
            }
        } else {
            snprintf(g_proxyLatencies[cfgIdx].status, sizeof(g_proxyLatencies[cfgIdx].status), "Таймаут (3с)");
        }

        closesocket(s);
        freeaddrinfo(res);
        g_proxyLatencies[cfgIdx].testing = false;
    }).detach();
}

// -----------------------------------------------------------------------------
// UI Helpers & Component Renderers
// -----------------------------------------------------------------------------
static void RenderPill(const char* text, ImVec4 bg, ImVec4 textCol = ImVec4(1.0f, 1.0f, 1.0f, 1.0f))
{
    ImVec2 p = ImGui::GetCursorScreenPos();
    ImVec2 textSize = ImGui::CalcTextSize(text);
    float padX = 8.0f;
    float padY = 3.0f;
    ImVec2 bbMin = p;
    ImVec2 bbMax = ImVec2(p.x + textSize.x + padX * 2, p.y + textSize.y + padY * 2);

    ImDrawList* drawList = ImGui::GetWindowDrawList();
    drawList->AddRectFilled(bbMin, bbMax, ImGui::GetColorU32(bg), 4.0f);
    drawList->AddText(ImVec2(p.x + padX, p.y + padY), ImGui::GetColorU32(textCol), text);

    ImGui::Dummy(ImVec2(textSize.x + padX * 2, textSize.y + padY * 2));
}

// Modal State: Rule Add/Edit
static bool g_openRuleModal = false;
static bool g_isEditRule = false;
static int  g_editRuleIdx = -1;
static char g_rmName[128] = "";
static char g_rmProc[PB_APPS_MAX * 2] = "";
static char g_rmHosts[PB_HOSTS_MAX * 2] = "";
static char g_rmPorts[128] = "";
static int  g_rmProto = 0;   // 0=TCP, 1=UDP, 2=BOTH
static int  g_rmAction = 0;  // 0=PROXY, 1=DIRECT, 2=BLOCK
static int  g_rmProxyCfgIdx = 0;
static bool g_rmEnabled = true;
static bool g_rmLocalhost = false;

static void OpenRuleModal(int ruleIdx = -1)
{
    ProfileLock lock;
    g_editRuleIdx = ruleIdx;
    g_isEditRule = (ruleIdx >= 0 && ruleIdx < g_profile.ruleCount);
    if (g_isEditRule) {
        PBRule* r = &g_profile.rule[ruleIdx];
        CopyWToUtf8(r->name, g_rmName, sizeof(g_rmName));
        CopyWToUtf8(r->proc, g_rmProc, sizeof(g_rmProc));
        CopyWToUtf8(r->hosts, g_rmHosts, sizeof(g_rmHosts));
        CopyWToUtf8(r->ports, g_rmPorts, sizeof(g_rmPorts));
        g_rmProto = ProtoIdx(r->proto);
        g_rmAction = ActionIdx(r->action);
        g_rmEnabled = r->enabled != 0;
        g_rmLocalhost = r->localhost != 0;
        g_rmProxyCfgIdx = 0;
        for (int i = 0; i < g_profile.cfgCount; i++) {
            if (g_profile.cfg[i].storedId == r->cfgStoredId) {
                g_rmProxyCfgIdx = i;
                break;
            }
        }
    } else {
        snprintf(g_rmName, sizeof(g_rmName), "Правило %d", g_profile.ruleCount + 1);
        snprintf(g_rmProc, sizeof(g_rmProc), "curl.exe; git.exe; node.exe");
        snprintf(g_rmHosts, sizeof(g_rmHosts), "*");
        snprintf(g_rmPorts, sizeof(g_rmPorts), "*");
        g_rmProto = 0;
        g_rmAction = 0;
        g_rmProxyCfgIdx = 0;
        g_rmEnabled = true;
        g_rmLocalhost = false;
    }
    g_openRuleModal = true;
}

// Modal State: Proxy Add/Edit
static bool g_openProxyModal = false;
static bool g_isEditProxy = false;
static int  g_editProxyIdx = -1;
static char g_pmName[128] = "";
static int  g_pmType = 0; // 0=SOCKS5, 1=HTTP
static char g_pmHost[128] = "";
static char g_pmPort[16] = "";
static char g_pmUser[128] = "";
static char g_pmPass[128] = "";
static bool g_pmSendDomain = true;

static void OpenProxyModal(int cfgIdx = -1)
{
    ProfileLock lock;
    g_editProxyIdx = cfgIdx;
    g_isEditProxy = (cfgIdx >= 0 && cfgIdx < g_profile.cfgCount);
    if (g_isEditProxy) {
        PBConfig* c = &g_profile.cfg[cfgIdx];
        CopyWToUtf8(c->name, g_pmName, sizeof(g_pmName));
        CopyWToUtf8(c->host, g_pmHost, sizeof(g_pmHost));
        CopyWToUtf8(c->port, g_pmPort, sizeof(g_pmPort));
        CopyWToUtf8(c->user, g_pmUser, sizeof(g_pmUser));
        CopyWToUtf8(c->pass, g_pmPass, sizeof(g_pmPass));
        g_pmType = (_wcsicmp(c->type, L"HTTP") == 0) ? 1 : 0;
        g_pmSendDomain = c->sendDomain != 0;
    } else {
        snprintf(g_pmName, sizeof(g_pmName), "Прокси %d", g_profile.cfgCount + 1);
        snprintf(g_pmHost, sizeof(g_pmHost), "proxy.corp.ru");
        snprintf(g_pmPort, sizeof(g_pmPort), "1080");
        g_pmUser[0] = 0;
        g_pmPass[0] = 0;
        g_pmType = 0;
        g_pmSendDomain = true;
    }
    g_openProxyModal = true;
}

// -----------------------------------------------------------------------------
// Shield Logo & Top Header Banner
// -----------------------------------------------------------------------------
static void RenderShieldBadge(float size = 28.0f)
{
    ImDrawList* drawList = ImGui::GetWindowDrawList();
    ImVec2 pos = ImGui::GetCursorScreenPos();
    float s = size / 128.0f;

    auto SX = [pos, s](float x) { return pos.x + x * s; };
    auto SY = [pos, s](float y) { return pos.y + y * s; };

    // 1. Background squircle matching extension/icon.svg (rect 4,4 to 124,124 rx=28)
    ImU32 bgCol = ImGui::ColorConvertFloat4ToU32(PecTheme::CardBg);
    ImU32 borderCol = ImGui::ColorConvertFloat4ToU32(PecTheme::HoverAccent);
    drawList->AddRectFilled(ImVec2(SX(4.0f), SY(4.0f)), ImVec2(SX(124.0f), SY(124.0f)), bgCol, 28.0f * s);
    drawList->AddRect(ImVec2(SX(4.0f), SY(4.0f)), ImVec2(SX(124.0f), SY(124.0f)), borderCol, 28.0f * s, 0, 1.8f * s);

    // 2. Corporate Shield (M64 21 L100 37 C100 73 82 96 64 107 C46 96 28 73 28 37 Z)
    ImVec2 shieldPts[] = {
        ImVec2(SX(64.0f),  SY(21.0f)),
        ImVec2(SX(100.0f), SY(37.0f)),
        ImVec2(SX(100.0f), SY(58.0f)),
        ImVec2(SX(92.0f),  SY(78.0f)),
        ImVec2(SX(80.0f),  SY(94.0f)),
        ImVec2(SX(64.0f),  SY(107.0f)),
        ImVec2(SX(48.0f),  SY(94.0f)),
        ImVec2(SX(36.0f),  SY(78.0f)),
        ImVec2(SX(28.0f),  SY(58.0f)),
        ImVec2(SX(28.0f),  SY(37.0f))
    };
    ImU32 shieldFill = ImGui::ColorConvertFloat4ToU32(ImVec4(PecTheme::CanvasBg.x, PecTheme::CanvasBg.y, PecTheme::CanvasBg.z, 0.92f));
    ImU32 shieldStroke = ImGui::ColorConvertFloat4ToU32(PecTheme::PrimaryAccent);
    drawList->AddConvexPolyFilled(shieldPts, 10, shieldFill);
    drawList->AddPolyline(shieldPts, 10, shieldStroke, ImDrawFlags_Closed, 2.2f * s);

    // 3. Directional Chevrons
    // Top chevron: M46 54 L64 37 L82 54
    ImVec2 chev1[] = { ImVec2(SX(46.0f), SY(54.0f)), ImVec2(SX(64.0f), SY(37.0f)), ImVec2(SX(82.0f), SY(54.0f)) };
    ImU32 chevCol = ImGui::ColorConvertFloat4ToU32(PecTheme::HoverAccent);
    drawList->AddPolyline(chev1, 3, chevCol, 0, 2.8f * s);

    // Bottom chevron: M46 71 L64 54 L82 71
    ImVec2 chev2[] = { ImVec2(SX(46.0f), SY(71.0f)), ImVec2(SX(64.0f), SY(54.0f)), ImVec2(SX(82.0f), SY(71.0f)) };
    drawList->AddPolyline(chev2, 3, chevCol, 0, 2.8f * s);

    // 4. Central Proxy Nexus Point
    // Connector line from (64, 73) to (64, 80)
    drawList->AddLine(ImVec2(SX(64.0f), SY(73.0f)), ImVec2(SX(64.0f), SY(80.0f)), chevCol, 2.0f * s);

    // Green Nexus dot at (64, 86)
    ImU32 greenCol = ImGui::ColorConvertFloat4ToU32(PecTheme::SuccessColor);
    drawList->AddCircleFilled(ImVec2(SX(64.0f), SY(86.0f)), 5.5f * s, greenCol);
    drawList->AddCircleFilled(ImVec2(SX(64.0f), SY(86.0f)), 2.2f * s, IM_COL32(255, 255, 255, 255));

    ImGui::Dummy(ImVec2(size, size));
}

static void RenderHeader()
{
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(10.0f, 6.0f));

    // Shield Logo Icon + App Title
    RenderShieldBadge(28.0f);
    ImGui::SameLine(0, 8.0f);

    ImGui::AlignTextToFramePadding();
    ImGui::TextColored(PecTheme::TextPrimary, "PEC-App");
    ImGui::SameLine();
    RenderPill(u8"v2.2.0", PecTheme::CardBg, PecTheme::TextMuted);

    ImGui::SameLine(0, 16.0f);
    if (g_pairedExt.paired) {
        RenderPill(u8"🌐 Спарено с расширением", ImVec4(0.08f, 0.28f, 0.18f, 1.0f), ImVec4(0.3f, 0.9f, 0.5f, 1.0f));
        if (ImGui::IsItemHovered()) {
            ImGui::SetTooltip(u8"Расширение активно в браузере (версия %ls, %ls)\nСинхронизация работает по порту 20809",
                g_pairedExt.version[0] ? g_pairedExt.version : L"1.0.0",
                g_pairedExt.browser[0] ? g_pairedExt.browser : L"chromium");
        }
    } else {
        RenderPill(u8"🌐 Ожидание расширения", PecTheme::CardBg, PecTheme::TextMuted);
        if (ImGui::IsItemHovered()) {
            ImGui::SetTooltip(u8"Локальный порт 20809 слушается.\nДля спаривания убедитесь, что в браузере запущено расширение PEC v1.0.0+.");
        }
    }

    // PEC Server Sync Status Indicator & Force Sync
    ImGui::SameLine(0, 10.0f);
    char syncTimeStr[64] = "";
    if (g_lastSyncTime.wYear > 0) {
        snprintf(syncTimeStr, sizeof(syncTimeStr), "%02d:%02d:%02d",
            g_lastSyncTime.wHour, g_lastSyncTime.wMinute, g_lastSyncTime.wSecond);
    }

    if (g_isSyncing) {
        RenderPill(u8"● Сервер: Синхронизация...", ImVec4(0.08f, 0.20f, 0.35f, 1.0f), PecTheme::HoverAccent);
    } else if (g_syncEverSucceeded) {
        char pillText[96];
        snprintf(pillText, sizeof(pillText), u8"● Сервер PEC (%s)", syncTimeStr[0] ? syncTimeStr : u8"ОК");
        RenderPill(pillText, ImVec4(0.08f, 0.28f, 0.18f, 1.0f), PecTheme::SuccessDirect);
        if (ImGui::IsItemHovered()) {
            ImGui::SetTooltip(u8"Синхронизация с сервером PEC активна\nПоследний обмен: %s\nСтатус: %ls\nСервер: %ls",
                syncTimeStr[0] ? syncTimeStr : u8"Недавно",
                g_lastSyncStatusStr,
                g_profile.pecSync.serverUrl[0] ? g_profile.pecSync.serverUrl : L"—");
        }
    } else if (g_lastSyncError != 0) {
        RenderPill(u8"● Сервер: Ошибка связи", ImVec4(0.35f, 0.10f, 0.10f, 1.0f), PecTheme::DangerRed);
        if (ImGui::IsItemHovered()) {
            ImGui::SetTooltip(u8"Ошибка связи с сервером PEC (код %lu)\n%ls\nСервер: %ls",
                g_lastSyncError,
                g_lastSyncStatusStr,
                g_profile.pecSync.serverUrl[0] ? g_profile.pecSync.serverUrl : L"—");
        }
    } else {
        RenderPill(u8"● Сервер: Ожидание", PecTheme::CardBg, PecTheme::TextMuted);
        if (ImGui::IsItemHovered()) {
            ImGui::SetTooltip(u8"Синхронизация с сервером PEC\n%ls", g_lastSyncStatusStr);
        }
    }

    ImGui::SameLine(0, 6.0f);
    if (ImGui::Button(u8"🔄##forcesyncheader")) {
        PecSyncTriggerNow();
    }
    if (ImGui::IsItemHovered()) {
        ImGui::SetTooltip(u8"Синхронизировать конфигурацию с сервером PEC сейчас");
    }

    // Status Toggle Button placed in the far right corner
    float btnWidth = 180.0f;
    float rightOffset = ImGui::GetWindowWidth() - btnWidth - 16.0f;
    if (rightOffset > ImGui::GetCursorPosX()) ImGui::SameLine(rightOffset);
    else ImGui::SameLine();

    if (g_proxyEnabled) {
        ImGui::PushStyleColor(ImGuiCol_Button, PecTheme::SuccessDirect);
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.1f, 0.8f, 0.55f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.05f, 0.65f, 0.45f, 1.0f));
        if (ImGui::Button(u8"● Прокси активен##statbtn", ImVec2(btnWidth, 0))) {
            SetProxyEnabled(false);
            TrayUpdateTip(L"PEC-App - Приостановлен");
        }
        ImGui::PopStyleColor(3);
        if (ImGui::IsItemHovered()) {
            ImGui::SetTooltip(u8"Трафик перехватывается согласно правилам маршрутизации.\nНажмите, чтобы временно приостановить работу.");
        }
    } else {
        ImGui::PushStyleColor(ImGuiCol_Button, PecTheme::WarningAlert);
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(1.0f, 0.7f, 0.1f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.85f, 0.55f, 0.02f, 1.0f));
        if (ImGui::Button(u8"⏸ Приостановлен##statbtn", ImVec2(btnWidth, 0))) {
            SetProxyEnabled(true);
            TrayUpdateTip(L"PEC-App - Прокси активен");
        }
        ImGui::PopStyleColor(3);
        if (ImGui::IsItemHovered()) {
            ImGui::SetTooltip(u8"Проксирование приостановлено (весь трафик направляется напрямую).\nНажмите, чтобы включить.");
        }
    }

    ImGui::PopStyleVar();
}

// -----------------------------------------------------------------------------
// Tab 1: Routing Rules Manager
// -----------------------------------------------------------------------------
static int  g_selectedRuleIdx = 0;
static char g_ruleSearch[128] = "";

static void RenderRulesTab()
{
    ProfileLock lock;
    // Search input & match counter
    ImGui::PushItemWidth(320.0f);
    ImGui::InputTextWithHint("##rulesearch", u8"Поиск правил (процесс, домен, порт)...", g_ruleSearch, sizeof(g_ruleSearch));
    ImGui::PopItemWidth();

    ImGui::SameLine();
    if (ImGui::Button(u8"Очистить##clrrulesearch")) {
        g_ruleSearch[0] = 0;
    }

    // Filter match count
    int matchCount = 0;
    std::string searchLower = g_ruleSearch;
    std::transform(searchLower.begin(), searchLower.end(), searchLower.begin(), ::tolower);

    for (int i = 0; i < g_profile.ruleCount; i++) {
        std::string proc = WToUtf8(g_profile.rule[i].proc);
        std::string hosts = WToUtf8(g_profile.rule[i].hosts);
        std::string ports = WToUtf8(g_profile.rule[i].ports);
        std::string name = WToUtf8(g_profile.rule[i].name);
        std::string all = proc + " " + hosts + " " + ports + " " + name;
        std::transform(all.begin(), all.end(), all.begin(), ::tolower);
        if (searchLower.empty() || all.find(searchLower) != std::string::npos) {
            matchCount++;
        }
    }

    ImGui::SameLine(0, 16.0f);
    ImGui::TextColored(PecTheme::TextMuted, u8"Показано: %d из %d правил", matchCount, g_profile.ruleCount);

    ImGui::Spacing();

    // Toolbar Buttons
    if (ImGui::Button(u8"+ Добавить правило")) {
        OpenRuleModal(-1);
    }
    ImGui::SameLine();
    if (ImGui::Button(u8"▲ Вверх") && g_selectedRuleIdx > 0 && g_selectedRuleIdx < g_profile.ruleCount) {
        PBRule temp = g_profile.rule[g_selectedRuleIdx];
        g_profile.rule[g_selectedRuleIdx] = g_profile.rule[g_selectedRuleIdx - 1];
        g_profile.rule[g_selectedRuleIdx - 1] = temp;
        g_selectedRuleIdx--;
        UnapplyRules();
        ApplyRules();
        SaveProfile();
    }
    ImGui::SameLine();
    if (ImGui::Button(u8"▼ Вниз") && g_selectedRuleIdx >= 0 && g_selectedRuleIdx < g_profile.ruleCount - 1) {
        PBRule temp = g_profile.rule[g_selectedRuleIdx];
        g_profile.rule[g_selectedRuleIdx] = g_profile.rule[g_selectedRuleIdx + 1];
        g_profile.rule[g_selectedRuleIdx + 1] = temp;
        g_selectedRuleIdx++;
        UnapplyRules();
        ApplyRules();
        SaveProfile();
    }
    ImGui::SameLine();
    if (ImGui::Button(u8"Удалить") && g_selectedRuleIdx >= 0 && g_selectedRuleIdx < g_profile.ruleCount) {
        if (g_profile.rule[g_selectedRuleIdx].nativeId && g_api.DeleteRule) {
            g_api.DeleteRule(g_profile.rule[g_selectedRuleIdx].nativeId);
            g_profile.rule[g_selectedRuleIdx].nativeId = 0;
        }
        for (int i = g_selectedRuleIdx; i < g_profile.ruleCount - 1; i++) {
            g_profile.rule[i] = g_profile.rule[i + 1];
        }
        g_profile.ruleCount--;
        if (g_selectedRuleIdx >= g_profile.ruleCount) g_selectedRuleIdx = g_profile.ruleCount - 1;
        UnapplyRules();
        ApplyRules();
        SaveProfile();
    }
    ImGui::SameLine();
    if (ImGui::Button(u8"Клонировать") && g_selectedRuleIdx >= 0 && g_selectedRuleIdx < g_profile.ruleCount && g_profile.ruleCount < PB_MAX_RULE) {
        PBRule clone = g_profile.rule[g_selectedRuleIdx];
        clone.nativeId = 0;
        _snwprintf_s(clone.name, 128, _TRUNCATE, L"%s (копия)", g_profile.rule[g_selectedRuleIdx].name);
        g_profile.rule[g_profile.ruleCount] = clone;
        EngineAddRule(&g_profile.rule[g_profile.ruleCount]);
        g_profile.ruleCount++;
        g_selectedRuleIdx = g_profile.ruleCount - 1;
        SaveProfile();
    }

    ImGui::Spacing();

    // Rules Table
    ImGuiTableFlags tableFlags = ImGuiTableFlags_RowBg | ImGuiTableFlags_BordersInnerV | ImGuiTableFlags_BordersOuterH |
                                 ImGuiTableFlags_ScrollY | ImGuiTableFlags_Resizable;
    float availY = ImGui::GetContentRegionAvail().y - 10.0f;

    if (ImGui::BeginTable("RulesTable", 5, tableFlags, ImVec2(0.0f, availY))) {
        ImGui::TableSetupColumn("#", ImGuiTableColumnFlags_WidthFixed, 32.0f);
        ImGui::TableSetupColumn("##actions", ImGuiTableColumnFlags_WidthFixed, 80.0f);
        ImGui::TableSetupColumn(u8"Правило", ImGuiTableColumnFlags_WidthStretch, 2.5f);
        ImGui::TableSetupColumn(u8"Действие", ImGuiTableColumnFlags_WidthFixed, 85.0f);
        ImGui::TableSetupColumn(u8"Прокси-сервер", ImGuiTableColumnFlags_WidthStretch, 1.5f);
        ImGui::TableHeadersRow();

        for (int i = 0; i < g_profile.ruleCount; i++) {
            PBRule* r = &g_profile.rule[i];
            std::string proc = WToUtf8(r->proc);
            std::string hosts = WToUtf8(r->hosts);
            std::string ports = WToUtf8(r->ports);
            std::string name = WToUtf8(r->name);
            std::string all = proc + " " + hosts + " " + ports + " " + name;
            std::transform(all.begin(), all.end(), all.begin(), ::tolower);
            if (!searchLower.empty() && all.find(searchLower) == std::string::npos) {
                continue;
            }

            ImGui::TableNextRow();

            // Column 0: Row number
            ImGui::TableSetColumnIndex(0);
            ImGui::TextColored(PecTheme::TextMuted, "%d", i + 1);

            // Column 1: Functional buttons on the LEFT: Checkbox toggle (no text) + Pencil edit icon
            ImGui::TableSetColumnIndex(1);
            char chkId[32];
            snprintf(chkId, sizeof(chkId), "##chk%d", i);
            bool en = (r->enabled != 0);
            if (ImGui::Checkbox(chkId, &en)) {
                r->enabled = en ? 1 : 0;
                if (r->nativeId) {
                    if (r->enabled) {
                        if (g_api.EnableRule) g_api.EnableRule(r->nativeId);
                    } else {
                        if (g_api.DisableRule) g_api.DisableRule(r->nativeId);
                    }
                }
                SaveProfile();
            }
            if (ImGui::IsItemHovered()) {
                ImGui::SetTooltip(en ? u8"Правило включено (нажмите для выключения)" : u8"Правило выключено (нажмите для включения)");
            }

            ImGui::SameLine(0, 8.0f);
            char editBtn[32];
            snprintf(editBtn, sizeof(editBtn), u8"✎##editrule%d", i);
            if (ImGui::Button(editBtn, ImVec2(28.0f, 22.0f))) {
                g_selectedRuleIdx = i;
                OpenRuleModal(i);
            }
            if (ImGui::IsItemHovered()) {
                ImGui::SetTooltip(u8"Редактировать правило");
            }

            // Column 2: Rule Target / Name with clean row selection
            ImGui::TableSetColumnIndex(2);
            std::string displayRule = (!name.empty() && name != "PEC-App Rule" && name != "*")
                                      ? name
                                      : (!proc.empty() ? proc : hosts);
            if (displayRule.empty()) displayRule = "*";

            bool isSelected = (g_selectedRuleIdx == i);
            if (ImGui::Selectable(displayRule.c_str(), isSelected, ImGuiSelectableFlags_AllowDoubleClick)) {
                g_selectedRuleIdx = i;
                if (ImGui::IsMouseDoubleClicked(0)) {
                    OpenRuleModal(i);
                }
            }
            if (ImGui::IsItemHovered()) {
                std::string tip = "Название: " + (name.empty() ? "(по умолчанию)" : name) +
                                  "\nПроцессы: " + (proc.empty() ? "*" : proc) +
                                  "\nДомены / Порты: " + (hosts.empty() ? "*" : hosts) + " : " + (ports.empty() ? "*" : ports);
                ImGui::SetTooltip("%s", tip.c_str());
            }

            // Column 3: Action Pill
            ImGui::TableSetColumnIndex(3);
            if (_wcsicmp(r->action, L"DIRECT") == 0) {
                RenderPill("DIRECT", PecTheme::SuccessDirect);
            } else if (_wcsicmp(r->action, L"BLOCK") == 0) {
                RenderPill("BLOCK", PecTheme::DangerRed);
            } else {
                RenderPill("PROXY", PecTheme::PrimaryAccent);
            }
            if (ImGui::IsItemHovered()) {
                if (_wcsicmp(r->action, L"DIRECT") == 0) ImGui::SetTooltip(u8"Трафик направляется напрямую в обход прокси");
                else if (_wcsicmp(r->action, L"BLOCK") == 0) ImGui::SetTooltip(u8"Трафик блокируется сетевым драйвером");
                else ImGui::SetTooltip(u8"Трафик перенаправляется через назначенный прокси");
            }

            // Column 4: Proxy name
            ImGui::TableSetColumnIndex(4);
            std::string proxyLabel = "По умолчанию";
            for (int k = 0; k < g_profile.cfgCount; k++) {
                if (g_profile.cfg[k].storedId == r->cfgStoredId) {
                    proxyLabel = WToUtf8(g_profile.cfg[k].name[0] ? g_profile.cfg[k].name : g_profile.cfg[k].host);
                    break;
                }
            }
            ImGui::TextUnformatted(proxyLabel.c_str());
        }
        ImGui::EndTable();
    }

    // Modal Dialog: Add / Edit Rule
    const char* ruleModalTitle = g_isEditRule ? u8"Редактирование правила###RuleModalPopup" : u8"Новое правило маршрутизации###RuleModalPopup";
    if (g_openRuleModal) {
        ImGui::OpenPopup(ruleModalTitle);
        g_openRuleModal = false;
    }

    if (ImGui::BeginPopupModal(ruleModalTitle, nullptr, ImGuiWindowFlags_AlwaysAutoResize)) {
        ImGui::Spacing();

        ImGui::Text(u8"Название:");
        ImGui::InputText("##rmName", g_rmName, sizeof(g_rmName));

        ImGui::Text(u8"Процессы (через точку с запятой, * = все):");
        ImGui::InputText("##rmProc", g_rmProc, sizeof(g_rmProc));

        // Preset process buttons
        ImGui::TextColored(PecTheme::TextMuted, u8"Быстрые пресеты:");
        const char* presets[] = { "curl.exe", "git.exe", "node.exe", "docker.exe", "chrome.exe", "msedge.exe" };
        for (int p = 0; p < 6; p++) {
            if (p > 0) ImGui::SameLine();
            char pbtn[32];
            snprintf(pbtn, sizeof(pbtn), "+ %s", presets[p]);
            if (ImGui::Button(pbtn)) {
                if (strcmp(g_rmProc, "*") == 0 || g_rmProc[0] == 0) {
                    strncpy(g_rmProc, presets[p], sizeof(g_rmProc) - 1);
                    g_rmProc[sizeof(g_rmProc) - 1] = 0;
                } else if (strstr(g_rmProc, presets[p]) == nullptr) {
                    if (strlen(g_rmProc) > 0 && g_rmProc[strlen(g_rmProc) - 1] != ';') {
                        strncat(g_rmProc, "; ", sizeof(g_rmProc) - strlen(g_rmProc) - 1);
                    }
                    strncat(g_rmProc, presets[p], sizeof(g_rmProc) - strlen(g_rmProc) - 1);
                }
            }
        }

        ImGui::Spacing();
        ImGui::Text(u8"Целевые домены и IP-адреса (* = любые):");
        ImGui::InputText("##rmHosts", g_rmHosts, sizeof(g_rmHosts));

        ImGui::Text(u8"Порты (например: 80, 443, 8000-8999 или *):");
        ImGui::InputText("##rmPorts", g_rmPorts, sizeof(g_rmPorts));

        ImGui::Spacing();
        ImGui::Text(u8"Протокол:");
        const char* protoItems[] = { "TCP", "UDP", "BOTH" };
        ImGui::Combo("##rmProto", &g_rmProto, protoItems, IM_ARRAYSIZE(protoItems));

        ImGui::Text(u8"Действие:");
        const char* actionItems[] = { "PROXY (Через прокси)", "DIRECT (Напрямую)", "BLOCK (Блокировать)" };
        ImGui::Combo("##rmAction", &g_rmAction, actionItems, IM_ARRAYSIZE(actionItems));

        if (g_rmAction == 0 && g_profile.cfgCount > 0) {
            ImGui::Text(u8"Прокси-сервер:");
            std::vector<std::string> cfgNames;
            for (int c = 0; c < g_profile.cfgCount; c++) {
                cfgNames.push_back(WToUtf8(g_profile.cfg[c].name[0] ? g_profile.cfg[c].name : g_profile.cfg[c].host));
            }
            std::vector<const char*> cfgPtrs;
            for (auto& s : cfgNames) cfgPtrs.push_back(s.c_str());
            ImGui::Combo("##rmProxyCfg", &g_rmProxyCfgIdx, cfgPtrs.data(), (int)cfgPtrs.size());
        }

        ImGui::Spacing();
        ImGui::Checkbox(u8"Правило включено", &g_rmEnabled);
        ImGui::Checkbox(u8"Перехватывать localhost (127.x / ::1)", &g_rmLocalhost);

        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();

        if (ImGui::Button(u8"Сохранить##saverule", ImVec2(120, 0))) {
            PBRule* target = nullptr;
            if (g_isEditRule && g_editRuleIdx >= 0 && g_editRuleIdx < g_profile.ruleCount) {
                target = &g_profile.rule[g_editRuleIdx];
            } else if (g_profile.ruleCount < PB_MAX_RULE) {
                target = &g_profile.rule[g_profile.ruleCount++];
                ZeroMemory(target, sizeof(*target));
            }

            if (target) {
                CopyUtf8ToW(g_rmName, target->name, 128);
                CopyUtf8ToW(g_rmProc, target->proc, PB_APPS_MAX);
                CopyUtf8ToW(g_rmHosts, target->hosts, PB_HOSTS_MAX);
                CopyUtf8ToW(g_rmPorts, target->ports, 128);
                const wchar_t* pNames[] = { L"TCP", L"UDP", L"BOTH" };
                const wchar_t* aNames[] = { L"PROXY", L"DIRECT", L"BLOCK" };
                wcsncpy(target->proto, pNames[g_rmProto], 7);
                wcsncpy(target->action, aNames[g_rmAction], 15);
                target->enabled = g_rmEnabled ? 1 : 0;
                target->localhost = g_rmLocalhost ? 1 : 0;
                if (g_rmAction == 0 && g_rmProxyCfgIdx >= 0 && g_rmProxyCfgIdx < g_profile.cfgCount) {
                    target->cfgStoredId = g_profile.cfg[g_rmProxyCfgIdx].storedId;
                } else {
                    target->cfgStoredId = 0;
                }

                if (g_isEditRule) {
                    EngineEditRule(target);
                } else {
                    EngineAddRule(target);
                }
                SaveProfile();
            }
            ImGui::CloseCurrentPopup();
        }

        ImGui::SameLine();
        if (ImGui::Button(u8"Отмена##cancelrule", ImVec2(120, 0))) {
            ImGui::CloseCurrentPopup();
        }
        ImGui::EndPopup();
    }
}

// -----------------------------------------------------------------------------
// Tab 2: Live Connection Stream (60 FPS Ring Buffer)
// -----------------------------------------------------------------------------
static char g_connSearch[128] = "";
static bool g_connAutoScroll = true;

static void RenderConnectionsTab()
{
    // Search input
    ImGui::PushItemWidth(300.0f);
    ImGui::InputTextWithHint("##connsearch", u8"Фильтр (процесс, хост)...", g_connSearch, sizeof(g_connSearch));
    ImGui::PopItemWidth();

    ImGui::SameLine();
    if (ImGui::Button(u8"Очистить поиск##clrconnsearch")) {
        g_connSearch[0] = 0;
    }

    ImGui::SameLine(0, 16.0f);
    ImGui::Checkbox(u8"Автопрокрутка", &g_connAutoScroll);

    ImGui::SameLine();
    ImGui::Checkbox(u8"Только проксированные", &g_proxiedOnly);

    ImGui::SameLine();
    if (ImGui::Button(u8"Очистить журнал##clearconnlog")) {
        g_connBuffer.Clear();
        if (g_api.ClearConnectionLogs) g_api.ClearConnectionLogs();
    }

    std::vector<ConnEntry> snapshot;
    g_connBuffer.GetSnapshot(snapshot);

    ImGui::SameLine(0, 16.0f);
    ImGui::TextColored(PecTheme::TextMuted, u8"Соединений: %zu", snapshot.size());

    ImGui::Spacing();

    // Table
    ImGuiTableFlags tableFlags = ImGuiTableFlags_RowBg | ImGuiTableFlags_BordersInnerV | ImGuiTableFlags_BordersOuterH |
                                 ImGuiTableFlags_ScrollY | ImGuiTableFlags_Resizable;
    float availY = ImGui::GetContentRegionAvail().y - 10.0f;

    std::string searchLower = g_connSearch;
    std::transform(searchLower.begin(), searchLower.end(), searchLower.begin(), ::tolower);

    if (ImGui::BeginTable("ConnStreamTable", 6, tableFlags, ImVec2(0.0f, availY))) {
        ImGui::TableSetupColumn(u8"Время", ImGuiTableColumnFlags_WidthFixed, 75.0f);
        ImGui::TableSetupColumn(u8"Процесс", ImGuiTableColumnFlags_WidthFixed, 140.0f);
        ImGui::TableSetupColumn(u8"Хост / IP", ImGuiTableColumnFlags_WidthStretch, 2.0f);
        ImGui::TableSetupColumn(u8"Действие", ImGuiTableColumnFlags_WidthFixed, 85.0f);
        ImGui::TableSetupColumn(u8"Прокси-сервер", ImGuiTableColumnFlags_WidthStretch, 1.2f);
        ImGui::TableSetupColumn(u8"Статус", ImGuiTableColumnFlags_WidthFixed, 75.0f);
        ImGui::TableHeadersRow();

        for (size_t i = 0; i < snapshot.size(); i++) {
            const ConnEntry& e = snapshot[i];
            if (!searchLower.empty()) {
                std::string all = std::string(e.process) + " " + e.hostIp + " " + e.proxy;
                std::transform(all.begin(), all.end(), all.begin(), ::tolower);
                if (all.find(searchLower) == std::string::npos) continue;
            }

            ImGui::TableNextRow();

            // Time
            ImGui::TableSetColumnIndex(0);
            ImGui::TextColored(PecTheme::TextMuted, "%s", e.time);

            // Process
            ImGui::TableSetColumnIndex(1);
            char procStr[128];
            snprintf(procStr, sizeof(procStr), "%s [%lu]", e.process, e.pid);
            ImGui::TextUnformatted(procStr);

            // Host / IP
            ImGui::TableSetColumnIndex(2);
            ImGui::TextUnformatted(e.hostIp);

            // Action Pill
            ImGui::TableSetColumnIndex(3);
            if (e.isDirect) {
                RenderPill("DIRECT", PecTheme::SuccessDirect);
            } else if (e.isBlock) {
                RenderPill("BLOCK", PecTheme::DangerRed);
            } else {
                RenderPill("PROXY", PecTheme::PrimaryAccent);
            }

            // Proxy
            ImGui::TableSetColumnIndex(4);
            ImGui::TextUnformatted(e.proxy);

            // Status
            ImGui::TableSetColumnIndex(5);
            ImGui::TextColored(e.isDirect ? PecTheme::TextMuted : PecTheme::HoverAccent, "%s", e.status);
        }

        if (g_connAutoScroll) {
            ImGui::SetScrollHereY(1.0f);
            ImGui::SetScrollY(ImGui::GetScrollMaxY());
        }

        ImGui::EndTable();
    }
}

// -----------------------------------------------------------------------------
// Tab 3: Diagnostic Engine Logs
// -----------------------------------------------------------------------------
static char g_logSearch[128] = "";
static bool g_logAutoScroll = true;

static void RenderEngineLogsTab()
{
    // Search input
    ImGui::PushItemWidth(260.0f);
    ImGui::InputTextWithHint("##englogsearch", u8"Поиск в логах...", g_logSearch, sizeof(g_logSearch));
    ImGui::PopItemWidth();

    ImGui::SameLine();
    if (ImGui::Button(u8"Очистить поиск##clrlogsearch")) {
        g_logSearch[0] = 0;
    }

    ImGui::SameLine();
    ImGui::Checkbox(u8"Автопрокрутка##logautoscroll", &g_logAutoScroll);

    ImGui::SameLine();
    if (ImGui::Button(u8"Очистить лог##clrlog")) {
        EnterCriticalSection(&g_logCs);
        g_logEntries.clear();
        LeaveCriticalSection(&g_logCs);
    }

    ImGui::SameLine();
    if (ImGui::Button(u8"📂 Папка с логами##openfolderlog")) {
        OpenLogsFolder();
    }

    ImGui::SameLine();
    if (ImGui::Button(u8"📄 Открыть pec-app.log##openfilelog")) {
        OpenLogFile();
    }

    ImGui::Spacing();

    // Scrollable log view
    float availY = ImGui::GetContentRegionAvail().y - 10.0f;
    ImGui::BeginChild("EngineLogsScrollRegion", ImVec2(0.0f, availY), true, ImGuiWindowFlags_HorizontalScrollbar);

    EnterCriticalSection(&g_logCs);
    std::string searchLower = g_logSearch;
    std::transform(searchLower.begin(), searchLower.end(), searchLower.begin(), ::tolower);

    for (const auto& entry : g_logEntries) {
        if (!searchLower.empty()) {
            std::string msgLower = entry.message;
            std::transform(msgLower.begin(), msgLower.end(), msgLower.begin(), ::tolower);
            if (msgLower.find(searchLower) == std::string::npos) continue;
        }

        ImGui::TextColored(PecTheme::TextMuted, "[%s] ", entry.time);
        ImGui::SameLine();

        if (entry.level == 2) {
            ImGui::TextColored(PecTheme::DangerRed, "%s", entry.message.c_str());
        } else if (entry.level == 1) {
            ImGui::TextColored(PecTheme::WarningAlert, "%s", entry.message.c_str());
        } else {
            ImGui::TextColored(PecTheme::TextPrimary, "%s", entry.message.c_str());
        }
    }
    LeaveCriticalSection(&g_logCs);

    if (g_logAutoScroll) {
        ImGui::SetScrollHereY(1.0f);
    }

    ImGui::EndChild();
}

// -----------------------------------------------------------------------------
// Tab 4: Proxy Servers Manager
// -----------------------------------------------------------------------------
static int g_selectedProxyIdx = 0;

static void RenderProxiesTab()
{
    ProfileLock lock;
    // Toolbar buttons
    if (ImGui::Button(u8"+ Добавить прокси")) {
        OpenProxyModal(-1);
    }
    ImGui::SameLine();
    if (ImGui::Button(u8"Удалить##delproxy") && g_selectedProxyIdx >= 0 && g_selectedProxyIdx < g_profile.cfgCount) {
        if (g_profile.cfgCount > 1) {
            UINT32 delStoredId = g_profile.cfg[g_selectedProxyIdx].storedId;
            if (g_profile.cfg[g_selectedProxyIdx].nativeId && g_api.DeleteProxyConfig) {
                g_api.DeleteProxyConfig(g_profile.cfg[g_selectedProxyIdx].nativeId);
            }
            for (int i = g_selectedProxyIdx; i < g_profile.cfgCount - 1; i++) {
                g_profile.cfg[i] = g_profile.cfg[i + 1];
            }
            g_profile.cfgCount--;
            if (g_selectedProxyIdx >= g_profile.cfgCount) g_selectedProxyIdx = g_profile.cfgCount - 1;

            for (int r = 0; r < g_profile.ruleCount; r++) {
                if (g_profile.rule[r].cfgStoredId == delStoredId) {
                    g_profile.rule[r].cfgStoredId = 0;
                }
            }

            UnapplyProfile();
            ApplyConfigs();
            ApplyRules();
            SaveProfile();
        }
    }
    ImGui::SameLine();
    if (ImGui::Button(u8"⚡ Проверить задержку")) {
        for (int i = 0; i < g_profile.cfgCount; i++) {
            TestProxyLatencyAsync(i);
        }
    }
    ImGui::SameLine();
    if (ImGui::Button(u8"🔄 Синхронизировать с сервером")) {
        PecSyncTriggerNow();
    }
    if (ImGui::IsItemHovered()) {
        ImGui::SetTooltip(u8"Запросить актуальный список корпоративных прокси-узлов с сервера PEC");
    }

    ImGui::Spacing();

    // Table of proxies
    ImGuiTableFlags tableFlags = ImGuiTableFlags_RowBg | ImGuiTableFlags_BordersInnerV | ImGuiTableFlags_BordersOuterH |
                                 ImGuiTableFlags_ScrollY | ImGuiTableFlags_Resizable;
    float availY = ImGui::GetContentRegionAvail().y - 10.0f;

    if (ImGui::BeginTable("ProxiesTable", 8, tableFlags, ImVec2(0.0f, availY))) {
        ImGui::TableSetupColumn("#", ImGuiTableColumnFlags_WidthFixed, 32.0f);
        ImGui::TableSetupColumn("##actions", ImGuiTableColumnFlags_WidthFixed, 80.0f);
        ImGui::TableSetupColumn(u8"Название", ImGuiTableColumnFlags_WidthStretch, 1.5f);
        ImGui::TableSetupColumn(u8"Тип", ImGuiTableColumnFlags_WidthFixed, 75.0f);
        ImGui::TableSetupColumn(u8"Адрес (Хост : Порт)", ImGuiTableColumnFlags_WidthStretch, 2.0f);
        ImGui::TableSetupColumn(u8"Авторизация", ImGuiTableColumnFlags_WidthStretch, 1.2f);
        ImGui::TableSetupColumn(u8"DNS", ImGuiTableColumnFlags_WidthFixed, 85.0f);
        ImGui::TableSetupColumn(u8"Задержка / Пинг", ImGuiTableColumnFlags_WidthFixed, 140.0f);
        ImGui::TableHeadersRow();

        for (int i = 0; i < g_profile.cfgCount; i++) {
            PBConfig* c = &g_profile.cfg[i];
            ImGui::TableNextRow();

            // Column 0: Row index
            ImGui::TableSetColumnIndex(0);
            ImGui::TextColored(PecTheme::TextMuted, "%d", i + 1);

            // Column 1: Action buttons on the LEFT: Default proxy checkbox + Pencil edit icon
            ImGui::TableSetColumnIndex(1);
            char chkId[32];
            snprintf(chkId, sizeof(chkId), "##defchk%d", i);
            bool isDefault = (i == 0);
            if (ImGui::Checkbox(chkId, &isDefault)) {
                if (i != 0 && isDefault) {
                    SwitchActiveProxy(i);
                }
            }
            if (ImGui::IsItemHovered()) {
                ImGui::SetTooltip(isDefault ? u8"Этот прокси выбран по умолчанию"
                                            : u8"Нажмите, чтобы сделать этот прокси используемым по умолчанию");
            }

            ImGui::SameLine(0, 8.0f);
            char editBtn[32];
            snprintf(editBtn, sizeof(editBtn), u8"✎##editproxy%d", i);
            if (ImGui::Button(editBtn, ImVec2(28.0f, 22.0f))) {
                g_selectedProxyIdx = i;
                OpenProxyModal(i);
            }
            if (ImGui::IsItemHovered()) {
                ImGui::SetTooltip(u8"Редактировать параметры прокси");
            }

            // Column 2: Name & row selection (no SpanAllColumns, prevents click capture bugs)
            ImGui::TableSetColumnIndex(2);
            std::string nameStr = WToUtf8(c->name[0] ? c->name : c->type);
            bool isSelected = (g_selectedProxyIdx == i);
            if (ImGui::Selectable(nameStr.c_str(), isSelected, ImGuiSelectableFlags_AllowDoubleClick)) {
                g_selectedProxyIdx = i;
                if (ImGui::IsMouseDoubleClicked(0)) {
                    OpenProxyModal(i);
                }
            }
            if (ImGui::IsItemHovered()) {
                ImGui::SetTooltip(u8"Дважды щелкните для редактирования прокси");
            }

            // Column 3: Type Pill
            ImGui::TableSetColumnIndex(3);
            RenderPill(WToUtf8(c->type).c_str(), PecTheme::PrimaryAccent);

            // Column 4: Host : Port
            ImGui::TableSetColumnIndex(4);
            std::string endpoint = WToUtf8(c->host) + ":" + WToUtf8(c->port);
            ImGui::TextUnformatted(endpoint.c_str());

            // Column 5: Authentication
            ImGui::TableSetColumnIndex(5);
            std::string auth = c->user[0] ? WToUtf8(c->user) : u8"Без пароля";
            ImGui::TextUnformatted(auth.c_str());

            // Column 6: DNS
            ImGui::TableSetColumnIndex(6);
            ImGui::TextColored(c->sendDomain ? PecTheme::SuccessDirect : PecTheme::TextMuted,
                               c->sendDomain ? u8"Удаленный" : u8"Локальный");

            // Column 7: Latency / Ping status
            ImGui::TableSetColumnIndex(7);
            if (g_proxyLatencies[i].testing) {
                ImGui::TextColored(PecTheme::HoverAccent, u8"Проверка...");
            } else if (g_proxyLatencies[i].ms >= 0) {
                ImGui::TextColored(PecTheme::SuccessDirect, "%s", g_proxyLatencies[i].status);
            } else {
                ImGui::TextColored(PecTheme::TextMuted, "%s", g_proxyLatencies[i].status);
            }
        }
        ImGui::EndTable();
    }

    // Modal: Add / Edit Proxy
    const char* proxyModalTitle = g_isEditProxy ? u8"Редактирование прокси###ProxyModalPopup" : u8"Новый прокси-сервер###ProxyModalPopup";
    if (g_openProxyModal) {
        ImGui::OpenPopup(proxyModalTitle);
        g_openProxyModal = false;
    }

    if (ImGui::BeginPopupModal(proxyModalTitle, nullptr, ImGuiWindowFlags_AlwaysAutoResize)) {
        ImGui::Spacing();

        ImGui::Text(u8"Название (метка):");
        ImGui::InputText("##pmName", g_pmName, sizeof(g_pmName));

        ImGui::Text(u8"Тип протокола:");
        const char* typeItems[] = { "SOCKS5", "HTTP" };
        ImGui::Combo("##pmType", &g_pmType, typeItems, IM_ARRAYSIZE(typeItems));

        ImGui::Text(u8"Адрес хоста (IP или домен):");
        ImGui::InputText("##pmHost", g_pmHost, sizeof(g_pmHost));

        ImGui::Text(u8"Порт:");
        ImGui::InputText("##pmPort", g_pmPort, sizeof(g_pmPort));

        ImGui::Spacing();
        ImGui::Text(u8"Имя пользователя (если требуется):");
        ImGui::InputText("##pmUser", g_pmUser, sizeof(g_pmUser));

        ImGui::Text(u8"Пароль:");
        ImGui::InputText("##pmPass", g_pmPass, sizeof(g_pmPass), ImGuiInputTextFlags_Password);

        ImGui::Spacing();
        ImGui::Checkbox(u8"Разрешать DNS через прокси (Send Domain)", &g_pmSendDomain);

        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();

        if (ImGui::Button(u8"Сохранить##saveproxy", ImVec2(120, 0))) {
            PBConfig* target = nullptr;
            if (g_isEditProxy && g_editProxyIdx >= 0 && g_editProxyIdx < g_profile.cfgCount) {
                target = &g_profile.cfg[g_editProxyIdx];
            } else if (g_profile.cfgCount < PB_MAX_CFG) {
                target = &g_profile.cfg[g_profile.cfgCount++];
                ZeroMemory(target, sizeof(*target));
                target->storedId = PB_AllocConfigId(&g_profile);
            }

            if (target) {
                CopyUtf8ToW(g_pmName, target->name, 128);
                CopyUtf8ToW(g_pmHost, target->host, 128);
                CopyUtf8ToW(g_pmPort, target->port, 16);
                CopyUtf8ToW(g_pmUser, target->user, 128);
                CopyUtf8ToW(g_pmPass, target->pass, 128);
                wcsncpy(target->type, g_pmType == 1 ? L"HTTP" : L"SOCKS5", 15);
                target->sendDomain = g_pmSendDomain ? 1 : 0;

                UnapplyProfile();
                ApplyConfigs();
                ApplyRules();
                SaveProfile();
            }
            ImGui::CloseCurrentPopup();
        }

        ImGui::SameLine();
        if (ImGui::Button(u8"Отмена##cancelproxy", ImVec2(120, 0))) {
            ImGui::CloseCurrentPopup();
        }
        ImGui::EndPopup();
    }
}

// -----------------------------------------------------------------------------
// Main Tabs Dispatcher
// -----------------------------------------------------------------------------
static void RenderTabs()
{
    if (ImGui::BeginTabBar("PECTabBar", ImGuiTabBarFlags_None)) {
        if (ImGui::BeginTabItem(u8"🛡 Прокси-серверы")) {
            RenderProxiesTab();
            ImGui::EndTabItem();
        }
        if (ImGui::BeginTabItem(u8"🔀 Таблица маршрутизации")) {
            RenderRulesTab();
            ImGui::EndTabItem();
        }
        if (ImGui::BeginTabItem(u8"📡 Журнал соединений")) {
            RenderConnectionsTab();
            ImGui::EndTabItem();
        }
        if (ImGui::BeginTabItem(u8"📋 Журнал работы")) {
            RenderEngineLogsTab();
            ImGui::EndTabItem();
        }
        ImGui::EndTabBar();
    }
}

// -----------------------------------------------------------------------------
// Win32 Window Procedure
// -----------------------------------------------------------------------------
LRESULT WINAPI WndProc(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam)
{
    if (ImGui_ImplWin32_WndProcHandler(hWnd, msg, wParam, lParam))
        return true;

    if (msg == g_wmTaskbarCreated && g_wmTaskbarCreated != 0) {
        TrayAdd(hWnd);
        return 0;
    }

    switch (msg)
    {
    case WM_SIZE:
        if (g_pd3dDevice != nullptr && wParam != SIZE_MINIMIZED) {
            CleanupRenderTarget();
            g_pSwapChain->ResizeBuffers(0, (UINT)LOWORD(lParam), (UINT)HIWORD(lParam), DXGI_FORMAT_UNKNOWN, 0);
            CreateRenderTarget();
        }
        return 0;

    case WM_SYSCOMMAND:
        if ((wParam & 0xFFF0) == SC_CLOSE && !g_reallyExit) {
            ShowWindow(hWnd, SW_HIDE);
            return 0;
        }
        break;

    case WM_CLOSE:
        if (!g_reallyExit) {
            ShowWindow(hWnd, SW_HIDE);
            return 0;
        }
        DestroyWindow(hWnd);
        return 0;

    case WM_APP_TRAY:
        if (lParam == WM_LBUTTONUP || lParam == WM_LBUTTONDBLCLK) {
            ShowWindow(hWnd, SW_RESTORE);
            SetForegroundWindow(hWnd);
        } else if (lParam == WM_RBUTTONUP) {
            HMENU hMenu = CreatePopupMenu();
            AppendMenuW(hMenu, MF_STRING, IDM_TRAY_SHOW, L"Открыть PEC-App");
            AppendMenuW(hMenu, MF_STRING, IDM_PROXY_ENABLE, g_proxyEnabled ? L"Статус: Прокси активен" : L"Статус: Приостановлен");
            AppendMenuW(hMenu, MF_STRING, IDM_OPEN_LOGS, L"📂 Папка с логами");
            AppendMenuW(hMenu, MF_SEPARATOR, 0, nullptr);
            AppendMenuW(hMenu, MF_STRING, IDM_TRAY_EXIT, L"Выход");

            POINT pt;
            GetCursorPos(&pt);
            SetForegroundWindow(hWnd);
            TrackPopupMenu(hMenu, TPM_RIGHTBUTTON, pt.x, pt.y, 0, hWnd, nullptr);
            PostMessageW(hWnd, WM_NULL, 0, 0);
            DestroyMenu(hMenu);
        }
        return 0;

    case WM_APP_RELOAD_PROFILE:
    {
        {
            ProfileLock lock;
            PB_ProfileLoad(g_activeProfile, &g_profile);
            ApplyProfileTheme(&g_profile);
        }
        UnapplyProfile();
        ApplyConfigs();
        ApplyRules();
        LogAdd("Конфигурация обновлена с сервера.");
        return 0;
    }

    case WM_COMMAND:
        switch (LOWORD(wParam))
        {
        case IDM_TRAY_SHOW:
            ShowWindow(hWnd, SW_RESTORE);
            SetForegroundWindow(hWnd);
            return 0;
        case IDM_PROXY_ENABLE:
            SetProxyEnabled(!g_proxyEnabled);
            TrayUpdateTip(g_proxyEnabled ? L"PEC-App - Прокси активен" : L"PEC-App - Приостановлен");
            return 0;
        case IDM_OPEN_LOGS:
            OpenLogsFolder();
            return 0;
        case IDM_TRAY_EXIT:
            g_reallyExit = true;
            DestroyWindow(hWnd);
            return 0;
        }
        break;

    case WM_DESTROY:
        TrayRemove();
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(hWnd, msg, wParam, lParam);
}

// -----------------------------------------------------------------------------
// Engine Connection & Elevation Handling
// -----------------------------------------------------------------------------
static BOOL IsElevated(void)
{
    BOOL elevated = FALSE;
    HANDLE tok = NULL;
    if (OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &tok))
    {
        TOKEN_ELEVATION te;
        DWORD n = 0;
        if (GetTokenInformation(tok, TokenElevation, &te, sizeof(te), &n)) {
            elevated = (te.TokenIsElevated != 0);
        }
        CloseHandle(tok);
    }
    return elevated;
}

static BOOL g_isAutostart = FALSE;

static BOOL ConnectEngine(void)
{
    int rc = PB_LoadService(&g_api);
    if (rc == PB_IPC_OK) {
        LogAdd("Подключено к системной службе PECAppSvc.");
        return TRUE;
    }

    if (rc == PB_IPC_BUSY)
    {
        if (g_isAutostart) {
            LogAdd("PECAppSvc занят при автозапуске, тихий выход.");
            return FALSE;
        }
        MessageBoxW(NULL,
            L"Другое окно PEC-App уже подключено к службе PEC-App.\nЗакройте его и повторите попытку.",
            APP_TITLE_W, MB_OK | MB_ICONWARNING);
        return FALSE;
    }
    if (rc == PB_IPC_BAD_VERSION)
    {
        MessageBoxW(NULL,
            L"Установленная служба PEC-App не совпадает по версии с данной программой.\nЗапустите установщик PEC-App заново.",
            APP_TITLE_W, MB_OK | MB_ICONERROR);
        return FALSE;
    }

    if (rc == PB_IPC_DENIED)
    {
        if (MessageBoxW(NULL,
            L"Данная учетная запись не имеет доступа к службе PEC-App.\nЗапустить от имени администратора?",
            APP_TITLE_W, MB_YESNO | MB_ICONWARNING) != IDYES)
            return FALSE;
    }

    // No service running: portable standalone mode
    if (!IsElevated())
    {
        wchar_t exe[MAX_PATH];
        GetModuleFileNameW(NULL, exe, MAX_PATH);
        SHELLEXECUTEINFOW sei;
        ZeroMemory(&sei, sizeof(sei));
        sei.cbSize = sizeof(sei);
        sei.lpVerb = L"runas";
        sei.lpFile = exe;
        sei.nShow = SW_SHOWNORMAL;
        if (ShellExecuteExW(&sei)) {
            // Elevated copy started; exit this unprivileged process
            return FALSE;
        }
        // UAC canceled by user
        MessageBoxW(NULL,
            L"Для работы маршрутизации в автономном (портативном) режиме требуются права администратора.",
            APP_TITLE_W, MB_OK | MB_ICONWARNING);
        return FALSE;
    }

    if (!PB_LoadDirect(&g_api))
    {
        const wchar_t* detail = PB_GetLastErrorMsg();
        wchar_t msg[1024];
        if (detail && detail[0]) {
            _snwprintf_s(msg, 1024, _TRUNCATE,
                L"Не удалось загрузить PECAppCore.dll:\n\n%s\n\nУбедитесь, что файлы PECAppCore.dll и WinDivert.dll находятся в одной папке с PEC-App.exe.",
                detail);
        } else {
            _snwprintf_s(msg, 1024, _TRUNCATE,
                L"Не удалось загрузить PECAppCore.dll.\nУбедитесь, что файлы PECAppCore.dll и WinDivert.dll находятся в одной папке с PEC-App.exe.");
        }
        MessageBoxW(NULL, msg, APP_TITLE_W, MB_OK | MB_ICONERROR);
        return FALSE;
    }

    LogAdd("Маршрутизатор PECAppCore загружен (автономный режим администратора).");
    return TRUE;
}

// -----------------------------------------------------------------------------
// Application Entry Point
// -----------------------------------------------------------------------------
int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPWSTR lpCmdLine, int nShowCmd)
{
    (void)hPrevInstance;
    (void)lpCmdLine;

    // Single instance mutex check
    HANDLE hMutex = CreateMutexW(nullptr, FALSE, L"Local\\PECApp_SingleInstance_Mutex_ImGui");
    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        HWND existing = FindWindowW(L"PECAppImGuiMainWnd", nullptr);
        if (existing) {
            ShowWindow(existing, SW_RESTORE);
            SetForegroundWindow(existing);
            if (hMutex) CloseHandle(hMutex);
            return 0;
        }
        // If no GUI window exists, proceed to initialize so the app is always accessible
    }

    // Check for --minimized or -autostart switch in command line
    if (wcsstr(GetCommandLineW(), L"-autostart") != nullptr ||
        wcsstr(GetCommandLineW(), L"--autostart") != nullptr ||
        wcsstr(GetCommandLineW(), L"--minimized") != nullptr ||
        wcsstr(GetCommandLineW(), L"-minimized") != nullptr ||
        wcsstr(GetCommandLineW(), L"/minimized") != nullptr) {
        g_isAutostart = TRUE;
        nShowCmd = SW_HIDE;
    }

    WSADATA wsaData;
    WSAStartup(MAKEWORD(2, 2), &wsaData);

    g_connBuffer.Init();
    InitializeCriticalSection(&g_logCs);
    InitializeCriticalSection(&g_profileCs);

    // Profile Initialization
    {
        ProfileLock lock;
        PB_GetActiveProfile(g_activeProfile, PB_NAME_MAX);
        PB_ProfileLoad(g_activeProfile, &g_profile);

        wchar_t exeDir[MAX_PATH];
        GetModuleFileNameW(nullptr, exeDir, MAX_PATH);
        wchar_t* last = wcsrchr(exeDir, L'\\');
        if (last) *last = 0; else exeDir[0] = 0;

        wchar_t cand[MAX_PATH];
        _snwprintf_s(cand, MAX_PATH, _TRUNCATE, L"%s\\pec_profile.pbprofile", exeDir);

        wchar_t appdata[MAX_PATH];
        wchar_t appdataPath[MAX_PATH];
        if (GetEnvironmentVariableW(L"APPDATA", appdata, MAX_PATH)) {
            _snwprintf_s(appdataPath, MAX_PATH, _TRUNCATE, L"%s\\PEC-App\\profiles\\Default.pbprofile", appdata);
        } else {
            appdataPath[0] = 0;
        }

        bool shouldLoadCand = false;
        WIN32_FILE_ATTRIBUTE_DATA candAttr, appdataAttr;
        bool candExists = (GetFileAttributesExW(cand, GetFileExInfoStandard, &candAttr) != 0);
        bool appdataExists = (appdataPath[0] && GetFileAttributesExW(appdataPath, GetFileExInfoStandard, &appdataAttr) != 0);

        if (candExists) {
            if (!appdataExists || (g_profile.cfgCount == 0 && g_profile.ruleCount == 0)) {
                shouldLoadCand = true;
            } else {
                // Compare write times: if cand is newer than appdata, the admin repackaged or deployed an updated config!
                if (CompareFileTime(&candAttr.ftLastWriteTime, &appdataAttr.ftLastWriteTime) > 0) {
                    shouldLoadCand = true;
                }
            }
        }

        if (shouldLoadCand) {
            PB_ProfileLoad(cand, &g_profile);
            lstrcpynW(g_activeProfile, L"Default", PB_NAME_MAX);
            PB_SetActiveProfile(g_activeProfile);
            PB_ProfileSave(g_activeProfile, &g_profile);
        } else if (!appdataExists) {
            PB_ProfileDefaults(&g_profile, g_activeProfile);
        }

        // Ensure PecSync has a valid serverUrl and fleetToken. If empty in current profile,
        // attempt to load them from pec_profile.pbprofile in exe directory or default to local server.
        if (g_profile.pecSync.serverUrl[0] == 0 && candExists) {
            PBProfile* candProf = (PBProfile*)calloc(1, sizeof(PBProfile));
            if (candProf) {
                PB_ProfileLoad(cand, candProf);
                if (candProf->pecSync.serverUrl[0] != 0) {
                    lstrcpynW(g_profile.pecSync.serverUrl, candProf->pecSync.serverUrl, 512);
                    lstrcpynW(g_profile.pecSync.fleetToken, candProf->pecSync.fleetToken, 256);
                    g_profile.pecSync.intervalMinutes = candProf->pecSync.intervalMinutes;
                    g_profile.pecSync.enabled = 1;
                }
                if (candProf->theme.hasTheme) {
                    g_profile.theme = candProf->theme;
                }
                PB_ProfileSave(g_activeProfile, &g_profile);
                free(candProf);
            }
        }
        if (g_profile.pecSync.serverUrl[0] == 0) {
            lstrcpynW(g_profile.pecSync.serverUrl, L"http://127.0.0.1:3000", 512);
            lstrcpynW(g_profile.pecSync.fleetToken, L"corp-proxy-secret-token-change-me", 256);
            g_profile.pecSync.intervalMinutes = 15;
            g_profile.pecSync.enabled = 1;
            PB_ProfileSave(g_activeProfile, &g_profile);
        }

        g_connLogging = g_profile.trafficLogging != 0;
        g_closeToTray = g_profile.closeToTray != 0;
    }

    // Connect to engine (service IPC or elevated portable mode)
    if (!ConnectEngine()) {
        g_connBuffer.Destroy();
        DeleteCriticalSection(&g_logCs);
        DeleteCriticalSection(&g_profileCs);
        WSACleanup();
        if (hMutex) CloseHandle(hMutex);
        return 0;
    }

    g_api.SetTrafficLoggingEnabled(g_connLogging ? TRUE : FALSE);
    {
        EnterCriticalSection(&g_profileCs);
        bool logEvery = (g_profile.logEveryConnection != 0);
        LeaveCriticalSection(&g_profileCs);
        if (g_api.SetLogEveryConnection) g_api.SetLogEveryConnection(logEvery ? TRUE : FALSE);
    }
    g_api.SetEnabled(g_proxyEnabled ? TRUE : FALSE);
    g_api.SetLogCallback(PBLogCb);
    g_api.SetConnectionCallback(PBConnCb);
    ApplyConfigs();
    g_engineStarted = (g_api.Start() == TRUE);
    if (g_engineStarted) {
        ApplyRules();
        LogAdd("Маршрутизатор PECAppCore успешно запущен.");
    } else {
        LogAdd("Не удалось запустить службу маршрутизации PECAppCore.", 2);
    }

    CheckAndRotateAppLog();
    PB_WriteAppLog("=== PEC-App ImGui GUI started (ActiveProfile: %ws) ===", g_activeProfile);

    // Register Win32 Window Class
    WNDCLASSEXW wc;
    ZeroMemory(&wc, sizeof(wc));
    wc.cbSize = sizeof(wc);
    wc.style = CS_CLASSDC;
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInstance;
    HICON hIconBig = (HICON)LoadImageW(hInstance, MAKEINTRESOURCEW(IDI_APPICON), IMAGE_ICON, GetSystemMetrics(SM_CXICON), GetSystemMetrics(SM_CYICON), LR_DEFAULTCOLOR);
    HICON hIconSmall = (HICON)LoadImageW(hInstance, MAKEINTRESOURCEW(IDI_APPICON), IMAGE_ICON, GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), LR_DEFAULTCOLOR);
    if (!hIconBig) hIconBig = LoadIconW(nullptr, IDI_APPLICATION);
    if (!hIconSmall) hIconSmall = hIconBig;
    wc.hIcon = hIconBig;
    wc.hIconSm = hIconSmall;
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.lpszClassName = L"PECAppImGuiMainWnd";
    RegisterClassExW(&wc);

    // Initial window dimensions (980x640 scaled to work area)
    int winW = 1040;
    int winH = 680;
    RECT wa;
    if (SystemParametersInfoW(SPI_GETWORKAREA, 0, &wa, 0)) {
        int maxW = (wa.right - wa.left) * 9 / 10;
        int maxH = (wa.bottom - wa.top) * 9 / 10;
        if (winW > maxW) winW = maxW;
        if (winH > maxH) winH = maxH;
    }
    int posX = (GetSystemMetrics(SM_CXSCREEN) - winW) / 2;
    int posY = (GetSystemMetrics(SM_CYSCREEN) - winH) / 2;

    g_hWnd = CreateWindowExW(
        0,
        wc.lpszClassName,
        APP_TITLE_W,
        WS_OVERLAPPEDWINDOW,
        posX, posY, winW, winH,
        nullptr, nullptr, wc.hInstance, nullptr);

    if (!g_hWnd) {
        UnregisterClassW(wc.lpszClassName, wc.hInstance);
        MessageBoxW(NULL, L"Не удалось создать окно PEC-App (CreateWindowExW failed).", APP_TITLE_W, MB_OK | MB_ICONERROR);
        g_connBuffer.Destroy();
        DeleteCriticalSection(&g_logCs);
        DeleteCriticalSection(&g_profileCs);
        WSACleanup();
        if (hMutex) CloseHandle(hMutex);
        return 1;
    }

    SendMessageW(g_hWnd, WM_SETICON, ICON_BIG, (LPARAM)hIconBig);
    SendMessageW(g_hWnd, WM_SETICON, ICON_SMALL, (LPARAM)hIconSmall);

    // Set Dark DWM Titlebar
    BOOL darkMode = TRUE;
    DwmSetWindowAttribute(g_hWnd, DWMWA_USE_IMMERSIVE_DARK_MODE, &darkMode, sizeof(darkMode));
    DwmSetWindowAttribute(g_hWnd, 19, &darkMode, sizeof(darkMode));

    // Register TaskbarCreated notification
    g_wmTaskbarCreated = RegisterWindowMessageW(L"TaskbarCreated");

    // Initialize DirectX 11
    if (!CreateDeviceD3D(g_hWnd)) {
        CleanupDeviceD3D();
        UnregisterClassW(wc.lpszClassName, wc.hInstance);
        MessageBoxW(NULL, L"Не удалось инициализировать графическую подсистему DirectX 11.\nУбедитесь, что в системе установлен DirectX 11 и обновлен видеодрайвер.", APP_TITLE_W, MB_OK | MB_ICONERROR);
        g_connBuffer.Destroy();
        DeleteCriticalSection(&g_logCs);
        DeleteCriticalSection(&g_profileCs);
        WSACleanup();
        if (hMutex) CloseHandle(hMutex);
        return 1;
    }

    // Setup Dear ImGui Context
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;

    // Apply Profile Theme (dynamically configured from App Studio Constructor)
    {
        ProfileLock lock;
        ApplyProfileTheme(&g_profile);
    }

    // Setup ImGui Backends
    ImGui_ImplWin32_Init(g_hWnd);
    ImGui_ImplDX11_Init(g_pd3dDevice, g_pd3dDeviceContext);

    // Load Segoe UI / Tahoma font with Cyrillic & Symbol glyph ranges
    char winDir[MAX_PATH];
    GetWindowsDirectoryA(winDir, MAX_PATH);
    char fontPath[MAX_PATH];
    snprintf(fontPath, sizeof(fontPath), "%s\\Fonts\\segoeui.ttf", winDir);
    if (GetFileAttributesA(fontPath) == INVALID_FILE_ATTRIBUTES) {
        snprintf(fontPath, sizeof(fontPath), "%s\\Fonts\\tahoma.ttf", winDir);
    }

    static const ImWchar extraGlyphs[] = {
        0x25A0, 0x25FF, // Geometric shapes (●, ▲, ▼, etc.)
        0x2300, 0x23FF, // Miscellaneous Technical (⏸, etc.)
        0x2190, 0x21FF, // Arrows
        0x2700, 0x27BF, // Dingbats (✏ 0x270F, ✎ 0x270E, etc.)
        0
    };

    ImFontGlyphRangesBuilder builder;
    builder.AddRanges(io.Fonts->GetGlyphRangesDefault());
    builder.AddRanges(io.Fonts->GetGlyphRangesCyrillic());
    builder.AddRanges(extraGlyphs);
    builder.AddText(u8"●⏸▲▼🔀📡📋🛡📂⚙✓✗✏✎🔄");
    ImVector<ImWchar> glyphRanges;
    builder.BuildRanges(&glyphRanges);

    ImFontConfig fontCfg;
    fontCfg.OversampleH = 2;
    fontCfg.OversampleV = 2;

    if (GetFileAttributesA(fontPath) != INVALID_FILE_ATTRIBUTES) {
        io.Fonts->AddFontFromFileTTF(fontPath, 16.0f, &fontCfg, glyphRanges.Data);
    } else {
        io.Fonts->AddFontDefault();
    }

    // Merge Segoe UI Symbol for Unicode emojis/pictographs (🔀, 📡, 📋, 🛡, 📂, etc.)
    char symFontPath[MAX_PATH];
    snprintf(symFontPath, sizeof(symFontPath), "%s\\Fonts\\seguisym.ttf", winDir);
    if (GetFileAttributesA(symFontPath) != INVALID_FILE_ATTRIBUTES) {
        ImFontConfig symCfg;
        symCfg.MergeMode = true;
        symCfg.OversampleH = 2;
        symCfg.OversampleV = 2;
        static const ImWchar symRanges[] = {
            0x2000, 0x2BFF,   // Symbols, arrows, geometric shapes, technical
            0x1F000, 0x1FAFF, // Supplemental symbols, pictographs, emojis
            0
        };
        io.Fonts->AddFontFromFileTTF(symFontPath, 16.0f, &symCfg, symRanges);
    }
    io.Fonts->Build();

    // Add System Tray Icon
    TrayAdd(g_hWnd);

    // Show Native Window
    ShowWindow(g_hWnd, nShowCmd);
    UpdateWindow(g_hWnd);

    // Start background telemetry sync & local extension pairing listener
    PecSyncStart(g_hWnd);

    // Main 60 FPS Render Loop
    bool done = false;
    while (!done)
    {
        MSG msg;
        while (PeekMessageW(&msg, nullptr, 0U, 0U, PM_REMOVE))
        {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
            if (msg.message == WM_QUIT)
                done = true;
        }
        if (done) break;

        // Skip rendering when minimized to tray
        if (IsIconic(g_hWnd) || !IsWindowVisible(g_hWnd)) {
            Sleep(16);
            continue;
        }

        // Start ImGui frame
        ImGui_ImplDX11_NewFrame();
        ImGui_ImplWin32_NewFrame();
        ImGui::NewFrame();

        // Host Viewport Window (full client area)
        ImGuiViewport* viewport = ImGui::GetMainViewport();
        ImGui::SetNextWindowPos(viewport->WorkPos);
        ImGui::SetNextWindowSize(viewport->WorkSize);

        ImGuiWindowFlags hostFlags = ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoCollapse |
                                     ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove |
                                     ImGuiWindowFlags_NoBringToFrontOnFocus | ImGuiWindowFlags_NoNavFocus;

        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 0.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(16.0f, 14.0f));

        ImGui::Begin("PECAppHost", nullptr, hostFlags);
        ImGui::PopStyleVar(3);

        RenderHeader();
        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();
        RenderTabs();

        ImGui::End();

        // Rendering to DirectX 11 Backbuffer
        ImGui::Render();
        const float clearColor[4] = {
            PecTheme::CanvasBg.x,
            PecTheme::CanvasBg.y,
            PecTheme::CanvasBg.z,
            PecTheme::CanvasBg.w
        };
        g_pd3dDeviceContext->OMSetRenderTargets(1, &g_mainRenderTargetView, nullptr);
        g_pd3dDeviceContext->ClearRenderTargetView(g_mainRenderTargetView, clearColor);
        ImGui_ImplDX11_RenderDrawData(ImGui::GetDrawData());

        // Present with VSync (60 FPS)
        g_pSwapChain->Present(1, 0);
    }

    // Cleanup & Shutdown
    PecSyncStop();
    UnapplyProfile();
    if (g_api.Stop) g_api.Stop();
    PB_UnloadDirect(&g_api);

    ImGui_ImplDX11_Shutdown();
    ImGui_ImplWin32_Shutdown();
    ImGui::DestroyContext();

    CleanupDeviceD3D();
    DestroyWindow(g_hWnd);
    UnregisterClassW(wc.lpszClassName, wc.hInstance);

    g_connBuffer.Destroy();
    DeleteCriticalSection(&g_logCs);
    DeleteCriticalSection(&g_profileCs);
    WSACleanup();
    if (hMutex) CloseHandle(hMutex);

    return 0;
}

#if defined(__GNUC__)
int WINAPI WinMain(HINSTANCE hInst, HINSTANCE hPrev, LPSTR lpCmdLine, int nShowCmd)
{
    (void)lpCmdLine;
    return wWinMain(hInst, hPrev, GetCommandLineW(), nShowCmd);
}
#endif
