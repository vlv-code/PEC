// main_imgui.cpp - Modern Native DirectX 11 GUI for PEC-App via Dear ImGui
// Features: Cyber Blue Dark Theme, Real-Time Connection Streaming, Rules Manager,
// System Tray Integration, Profile Persistence, and PECAppCore Engine Hooks.

#ifndef _CRT_RAND_S
#define _CRT_RAND_S
#endif

#define _CRT_SECURE_NO_WARNINGS
#ifndef _TRUNCATE
#define _TRUNCATE ((size_t)-1)
#endif
#ifndef ARRAYSIZE
#define ARRAYSIZE(a) (sizeof(a)/sizeof((a)[0]))
#endif
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
#include <tlhelp32.h>

#include <string>
#include <vector>
#include <deque>
#include <chrono>
#include <memory>
#include <algorithm>
#include <mutex>
#include <cstdio>
#include <cstring>
#include <cmath>

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
#include "loc/loc.h"

#if defined(__has_include)
#if __has_include("res/version_gen.h")
#include "res/version_gen.h"
#elif __has_include("version_gen.h")
#include "version_gen.h"
#endif
#endif

extern "C" {
#include "profile/profile.h"
#include "api/pb_api.h"
#include "api/pb_ipc.h"
#include "ui/startup.h"
}

#ifndef DWMWA_USE_IMMERSIVE_DARK_MODE
#define DWMWA_USE_IMMERSIVE_DARK_MODE 20
#endif

#define WM_APP_TRAY           (WM_APP + 3)
#define WM_APP_UPDATE         (WM_APP + 8)
#define WM_APP_RELOAD_PROFILE (WM_APP + 9)
#ifndef APP_VERSION_STR
#define APP_VERSION_STR "2.2.0"
#endif
#ifndef APP_VERSION_W
#define APP_VERSION_W L"2.2.0"
#endif
#define APP_TITLE_A "PEC-App v" APP_VERSION_STR
#define APP_TITLE_W L"PEC-App v" APP_VERSION_W

static PBApi            g_api = {};
static PBProfile        g_profile = {};
static CRITICAL_SECTION g_profileCs;
static wchar_t          g_activeProfile[PB_NAME_MAX] = L"Default";

extern "C" {
#include "ui/pec_sync.h"
}

// -----------------------------------------------------------------------------
// Forward declarations & Startup Helpers
// -----------------------------------------------------------------------------
extern IMGUI_IMPL_API LRESULT ImGui_ImplWin32_WndProcHandler(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam);
LRESULT WINAPI WndProc(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam);
static void UpdateTitle(HWND hWnd);

static inline bool GetAutostartWithWindows() {
    return StartupIsEnabled() != FALSE;
}

static inline void SetAutostartWithWindows(bool enable) {
    StartupSet(enable ? TRUE : FALSE);
}

static void SaveWindowGeometry(HWND hWnd) {
    RECT wr;
    if (GetWindowRect(hWnd, &wr)) {
        HKEY k;
        if (RegCreateKeyExW(HKEY_CURRENT_USER, L"Software\\PEC-App", 0, NULL, 0, KEY_SET_VALUE, NULL, &k, NULL) == ERROR_SUCCESS) {
            int x = wr.left, y = wr.top, w = wr.right - wr.left, h = wr.bottom - wr.top;
            RegSetValueExW(k, L"WinX", 0, REG_DWORD, (const BYTE*)&x, sizeof(DWORD));
            RegSetValueExW(k, L"WinY", 0, REG_DWORD, (const BYTE*)&y, sizeof(DWORD));
            RegSetValueExW(k, L"WinW", 0, REG_DWORD, (const BYTE*)&w, sizeof(DWORD));
            RegSetValueExW(k, L"WinH", 0, REG_DWORD, (const BYTE*)&h, sizeof(DWORD));
            RegCloseKey(k);
        }
    }
}

static BOOL LoadWindowGeometry(int& x, int& y, int& w, int& h) {
    HKEY k;
    if (RegOpenKeyExW(HKEY_CURRENT_USER, L"Software\\PEC-App", 0, KEY_QUERY_VALUE, &k) == ERROR_SUCCESS) {
        DWORD dwX = 0, dwY = 0, dwW = 0, dwH = 0, sz = sizeof(DWORD);
        if (RegQueryValueExW(k, L"WinX", NULL, NULL, (BYTE*)&dwX, &sz) == ERROR_SUCCESS &&
            RegQueryValueExW(k, L"WinY", NULL, NULL, (BYTE*)&dwY, &sz) == ERROR_SUCCESS &&
            RegQueryValueExW(k, L"WinW", NULL, NULL, (BYTE*)&dwW, &sz) == ERROR_SUCCESS &&
            RegQueryValueExW(k, L"WinH", NULL, NULL, (BYTE*)&dwH, &sz) == ERROR_SUCCESS)
        {
            if (dwW >= 400 && dwH >= 300) {
                x = (int)dwX; y = (int)dwY; w = (int)dwW; h = (int)dwH;
                RegCloseKey(k);
                return TRUE;
            }
        }
        RegCloseKey(k);
    }
    return FALSE;
}

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

// Case-insensitive substring search without heap allocations
static bool StrContainsCaseInsensitive(const char* haystack, const char* needle_lower, size_t needle_len)
{
    if (!needle_len) return true;
    if (!haystack || !*haystack) return false;
    for (const char* h = haystack; *h; ++h) {
        size_t i = 0;
        while (i < needle_len && h[i] != '\0') {
            unsigned char c1 = (unsigned char)h[i];
            char c1_lower = (c1 >= 'A' && c1 <= 'Z') ? (char)(c1 + 32) : (char)c1;
            if (c1_lower != needle_lower[i]) break;
            ++i;
        }
        if (i == needle_len) return true;
    }
    return false;
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
static float g_dpiScale = 1.0f;
static float g_baseDpiScale = 1.0f;
static int   g_activeTab = 0;
static bool  g_focusSearch = false;


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

static thread_local bool s_inLogAdd = false;
static thread_local bool s_inAppLogBridge = false;

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

    if (!s_inAppLogBridge) {
        s_inLogAdd = true;
        CheckAndRotateAppLog();
        PB_WriteAppLog("ENGINE: %s", message ? message : "");
        s_inLogAdd = false;
    }
}

static void OnAppLogUiBridge(const char* msg, int level)
{
    if (s_inLogAdd) return;
    s_inAppLogBridge = true;
    LogAdd(msg, level);
    s_inAppLogBridge = false;
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
    UpdateTitle(g_hWnd);
    char buf[128];
    snprintf(buf, sizeof(buf), T(S_LOG_PROXY_STATE), enabled ? T(S_STATUS_ACTIVE) : T(S_STATUS_PAUSED));
    LogAdd(buf);
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

    PecSyncSetSelectedProxy(g_profile.cfg[0].host, _wtoi(g_profile.cfg[0].port));
    UnapplyProfile();
    ApplyConfigs();
    ApplyRules();
    SaveProfile();
    UpdateTitle(g_hWnd);

    char buf[256];
    snprintf(buf, sizeof(buf), T(S_LOG_PROXY_SWITCHED), proxyName.c_str());
    LogAdd(buf);
}


static void UpdateTitle(HWND hWnd)
{
    if (!hWnd) return;
    wchar_t t[256];
    const wchar_t* engState = !g_engineStarted ? L" [ENGINE: ERROR]" : (g_proxyEnabled ? L"" : TW(S_TITLE_PAUSED));
    ProfileLock lock;
    if (g_profile.cfgCount > 0 && g_profile.cfg[0].host[0])
    {
        _snwprintf_s(t, 256, _TRUNCATE, L"%ls - %ls [%ls: %ls:%ls]%ls",
                     APP_TITLE_W, g_activeProfile,
                     g_profile.cfg[0].name[0] ? g_profile.cfg[0].name : g_profile.cfg[0].type,
                     g_profile.cfg[0].host, g_profile.cfg[0].port,
                     engState);
    }
    else
    {
        _snwprintf_s(t, 256, _TRUNCATE, L"%ls - %ls%ls", APP_TITLE_W, g_activeProfile, engState);
    }
    SetWindowTextW(hWnd, t);
}

static void OpenLogsFolder()
{
    wchar_t logDir[MAX_PATH];
    PB_GetLogsDir(logDir, MAX_PATH);
    ShellExecuteW(nullptr, L"open", logDir, nullptr, nullptr, SW_SHOWNORMAL);
}

[[maybe_unused]] static void OpenLogFile()
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
    wchar_t fullTip[128];
    if (wcsstr(tip, L"PEC-App") == nullptr) {
        _snwprintf_s(fullTip, 128, _TRUNCATE, L"PEC-App - %ls", tip);
    } else {
        lstrcpynW(fullTip, tip, 128);
    }
    wcsncpy(g_trayData.szTip, fullTip, 127);
    Shell_NotifyIconW(NIM_MODIFY, &g_trayData);
}

static void TrayShowBalloon(const wchar_t* title, const wchar_t* msg)
{
    if (!g_trayAdded) return;
    NOTIFYICONDATAW nid = g_trayData;
    nid.uFlags |= NIF_INFO;
    lstrcpynW(nid.szInfoTitle, title, 64);
    lstrcpynW(nid.szInfo, msg, 256);
    nid.dwInfoFlags = NIIF_INFO;
    nid.uTimeout = 5000;
    Shell_NotifyIconW(NIM_MODIFY, &nid);
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
static CRITICAL_SECTION  g_latencyCs;
struct LatencyLock {
    LatencyLock()  { EnterCriticalSection(&g_latencyCs); }
    ~LatencyLock() { LeaveCriticalSection(&g_latencyCs); }
};

struct LatencyTestArgs {
    int cfgIdx;
    std::string host;
    std::string port;
};

static DWORD WINAPI LatencyTestThreadProc(LPVOID param)
{
    std::unique_ptr<LatencyTestArgs> args(static_cast<LatencyTestArgs*>(param));
    int cfgIdx = args->cfgIdx;
    std::string host = args->host;
    std::string port = args->port;

    struct addrinfo hints = {};
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;
    hints.ai_protocol = IPPROTO_TCP;
    struct addrinfo* res = nullptr;

    auto start = std::chrono::high_resolution_clock::now();
    int rc = getaddrinfo(host.c_str(), port.c_str(), &hints, &res);
    if (rc != 0 || !res) {
        {
            LatencyLock lock;
            snprintf(g_proxyLatencies[cfgIdx].status, sizeof(g_proxyLatencies[cfgIdx].status), "DNS ошибка");
            g_proxyLatencies[cfgIdx].testing = false;
        }
        return 0;
    }

    SOCKET s = socket(res->ai_family, res->ai_socktype, res->ai_protocol);
    if (s == INVALID_SOCKET) {
        freeaddrinfo(res);
        {
            LatencyLock lock;
            snprintf(g_proxyLatencies[cfgIdx].status, sizeof(g_proxyLatencies[cfgIdx].status), "Socket ошибка");
            g_proxyLatencies[cfgIdx].testing = false;
        }
        return 0;
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

    {
        LatencyLock lock;
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
        g_proxyLatencies[cfgIdx].testing = false;
    }

    closesocket(s);
    freeaddrinfo(res);
    return 0;
}

static void TestProxyLatencyAsync(int cfgIdx)
{
    auto* args = new LatencyTestArgs();
    {
        ProfileLock lock;
        if (cfgIdx < 0 || cfgIdx >= g_profile.cfgCount) {
            delete args;
            return;
        }
        {
            LatencyLock latLock;
            if (g_proxyLatencies[cfgIdx].testing) {
                delete args;
                return;
            }
            g_proxyLatencies[cfgIdx].testing = true;
            snprintf(g_proxyLatencies[cfgIdx].status, sizeof(g_proxyLatencies[cfgIdx].status), "Проверка...");
        }

        args->cfgIdx = cfgIdx;
        args->host = WToUtf8(g_profile.cfg[cfgIdx].host);
        args->port = WToUtf8(g_profile.cfg[cfgIdx].port);
    }

    HANDLE hThread = CreateThread(nullptr, 0, LatencyTestThreadProc, args, 0, nullptr);
    if (hThread) {
        CloseHandle(hThread);
    } else {
        LatencyLock latLock;
        g_proxyLatencies[cfgIdx].testing = false;
        delete args;
    }
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

// -----------------------------------------------------------------------------
// Vector Country Flag & Action Icon Buttons
// -----------------------------------------------------------------------------
static bool RenderFlagButton(const char* id, int langIndex, bool active)
{
    ImVec2 btnSize(30.0f, 24.0f);
    ImVec2 pos = ImGui::GetCursorScreenPos();

    if (active) {
        ImGui::PushStyleColor(ImGuiCol_Button, PecTheme::CardBg);
        ImGui::PushStyleColor(ImGuiCol_Border, PecTheme::HoverAccent);
    } else {
        ImGui::PushStyleColor(ImGuiCol_Button, PecTheme::FrameBg);
        ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0, 0, 0, 0));
    }
    ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, active ? 1.5f : 0.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 4.0f);

    bool clicked = ImGui::Button(id, btnSize);
    bool hovered = ImGui::IsItemHovered();

    ImGui::PopStyleVar(2);
    ImGui::PopStyleColor(2);

    if (hovered) {
        ImGui::SetTooltip(langIndex == 0 ? "Русский (RU)" : "English (EN)");
    }

    float flagW = 20.0f;
    float flagH = 13.0f;
    float fx = pos.x + (btnSize.x - flagW) * 0.5f;
    float fy = pos.y + (btnSize.y - flagH) * 0.5f;
    ImVec2 fmin(fx, fy);
    ImVec2 fmax(fx + flagW, fy + flagH);

    ImDrawList* drawList = ImGui::GetWindowDrawList();
    drawList->PushClipRect(fmin, fmax, true);

    if (langIndex == 0) {
        // Russian Flag (White, Blue, Red horizontal tricolor)
        float stripeH = flagH / 3.0f;
        drawList->AddRectFilled(ImVec2(fx, fy), ImVec2(fx + flagW, fy + stripeH), IM_COL32(255, 255, 255, 255));
        drawList->AddRectFilled(ImVec2(fx, fy + stripeH), ImVec2(fx + flagW, fy + stripeH * 2.0f), IM_COL32(0, 57, 166, 255));
        drawList->AddRectFilled(ImVec2(fx, fy + stripeH * 2.0f), ImVec2(fx + flagW, fy + flagH), IM_COL32(213, 43, 30, 255));
    } else {
        // UK Flag / Union Jack (Blue base, White/Red diagonals, White/Red cross)
        drawList->AddRectFilled(fmin, fmax, IM_COL32(1, 33, 105, 255));
        drawList->AddLine(ImVec2(fx, fy), ImVec2(fx + flagW, fy + flagH), IM_COL32(255, 255, 255, 255), 3.0f);
        drawList->AddLine(ImVec2(fx, fy + flagH), ImVec2(fx + flagW, fy), IM_COL32(255, 255, 255, 255), 3.0f);
        drawList->AddLine(ImVec2(fx, fy), ImVec2(fx + flagW, fy + flagH), IM_COL32(200, 16, 46, 255), 1.2f);
        drawList->AddLine(ImVec2(fx, fy + flagH), ImVec2(fx + flagW, fy), IM_COL32(200, 16, 46, 255), 1.2f);
        float cx = fx + flagW * 0.5f;
        float cy = fy + flagH * 0.5f;
        drawList->AddRectFilled(ImVec2(fx, cy - 2.5f), ImVec2(fx + flagW, cy + 2.5f), IM_COL32(255, 255, 255, 255));
        drawList->AddRectFilled(ImVec2(cx - 2.5f, fy), ImVec2(cx + 2.5f, fy + flagH), IM_COL32(255, 255, 255, 255));
        drawList->AddRectFilled(ImVec2(fx, cy - 1.2f), ImVec2(fx + flagW, cy + 1.2f), IM_COL32(200, 16, 46, 255));
        drawList->AddRectFilled(ImVec2(cx - 1.2f, fy), ImVec2(cx + 2.5f, fy + flagH), IM_COL32(200, 16, 46, 255));
    }

    drawList->PopClipRect();
    drawList->AddRect(fmin, fmax, IM_COL32(0, 0, 0, 70), 1.0f);

    return clicked;
}

static bool RenderSyncButton(const char* id, const char* tooltip)
{
    ImVec2 btnSize(28.0f, 26.0f);
    ImVec2 pos = ImGui::GetCursorScreenPos();

    ImGui::PushStyleColor(ImGuiCol_Button, PecTheme::FrameBg);
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, PecTheme::CardBg);
    ImGui::PushStyleColor(ImGuiCol_ButtonActive, PecTheme::HoverAccent);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 4.0f);

    bool clicked = ImGui::Button(id, btnSize);
    bool hovered = ImGui::IsItemHovered();
    bool active = ImGui::IsItemActive();

    ImGui::PopStyleVar();
    ImGui::PopStyleColor(3);

    if (tooltip && hovered) {
        ImGui::SetTooltip("%s", tooltip);
    }

    ImDrawList* drawList = ImGui::GetWindowDrawList();
    float cx = pos.x + btnSize.x * 0.5f;
    float cy = pos.y + btnSize.y * 0.5f;
    float r = 5.5f;

    ImU32 iconCol = ImGui::ColorConvertFloat4ToU32(
        active ? ImVec4(1.0f, 1.0f, 1.0f, 1.0f) :
        (hovered ? PecTheme::HoverAccent : PecTheme::TextPrimary)
    );

    float baseAngle = g_isSyncing ? ((float)ImGui::GetTime() * 8.0f) : 0.0f;
    const float PI = 3.1415926535f;

    // Arc 1 (Top-Right)
    float a1_start = baseAngle + 0.25f * PI;
    float a1_end   = baseAngle + 1.05f * PI;
    drawList->PathArcTo(ImVec2(cx, cy), r, a1_start, a1_end, 12);
    drawList->PathStroke(iconCol, 0, 1.8f);

    float tip1_x = cx + r * cosf(a1_end);
    float tip1_y = cy + r * sinf(a1_end);
    float dir1_x = -sinf(a1_end);
    float dir1_y =  cosf(a1_end);
    float norm1_x = -dir1_y;
    float norm1_y =  dir1_x;
    ImVec2 tri1_p0(tip1_x + dir1_x * 1.5f, tip1_y + dir1_y * 1.5f);
    ImVec2 tri1_p1(tip1_x - dir1_x * 3.5f + norm1_x * 3.0f, tip1_y - dir1_y * 3.5f + norm1_y * 3.0f);
    ImVec2 tri1_p2(tip1_x - dir1_x * 3.5f - norm1_x * 3.0f, tip1_y - dir1_y * 3.5f - norm1_y * 3.0f);
    drawList->AddTriangleFilled(tri1_p0, tri1_p1, tri1_p2, iconCol);

    // Arc 2 (Bottom-Left)
    float a2_start = baseAngle + 1.25f * PI;
    float a2_end   = baseAngle + 2.05f * PI;
    drawList->PathArcTo(ImVec2(cx, cy), r, a2_start, a2_end, 12);
    drawList->PathStroke(iconCol, 0, 1.8f);

    float tip2_x = cx + r * cosf(a2_end);
    float tip2_y = cy + r * sinf(a2_end);
    float dir2_x = -sinf(a2_end);
    float dir2_y =  cosf(a2_end);
    float norm2_x = -dir2_y;
    float norm2_y =  dir2_x;
    ImVec2 tri2_p0(tip2_x + dir2_x * 1.5f, tip2_y + dir2_y * 1.5f);
    ImVec2 tri2_p1(tip2_x - dir2_x * 3.5f + norm2_x * 3.0f, tip2_y - dir2_y * 3.5f + norm2_y * 3.0f);
    ImVec2 tri2_p2(tip2_x - dir2_x * 3.5f - norm2_x * 3.0f, tip2_y - dir2_y * 3.5f - norm2_y * 3.0f);
    drawList->AddTriangleFilled(tri2_p0, tri2_p1, tri2_p2, iconCol);

    return clicked;
}

// Dynamic toolbar button flow helpers (wrap to next row if window is narrow)
static void FlowSameLine(float nextItemWidth, float spacing = -1.0f)
{
    float sp = (spacing >= 0.0f) ? spacing : ImGui::GetStyle().ItemSpacing.x;
    if (ImGui::GetContentRegionAvail().x >= nextItemWidth + sp) {
        if (spacing >= 0.0f) ImGui::SameLine(0, spacing);
        else ImGui::SameLine();
    }
}

static void FlowButtonSameLine(const char* label, float spacing = -1.0f)
{
    float w = ImGui::CalcTextSize(label).x + ImGui::GetStyle().FramePadding.x * 2.0f;
    FlowSameLine(w, spacing);
}

static void FlowCheckboxSameLine(const char* label, float spacing = -1.0f)
{
    float w = ImGui::GetFrameHeight() + ImGui::GetStyle().ItemInnerSpacing.x + ImGui::CalcTextSize(label).x;
    FlowSameLine(w, spacing);
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
    RenderPill("v" APP_VERSION_STR, PecTheme::CardBg, PecTheme::TextMuted);

    ImGui::SameLine(0, 16.0f);
    if (g_pairedExt.paired) {
        RenderPill(T(S_STATUS_PAIRED), ImVec4(0.08f, 0.28f, 0.18f, 1.0f), ImVec4(0.3f, 0.9f, 0.5f, 1.0f));
        if (ImGui::IsItemHovered()) {
            ImGui::SetTooltip(T(S_TOOLTIP_EXT_ACTIVE),
                g_pairedExt.version[0] ? g_pairedExt.version : L"1.0.0",
                g_pairedExt.browser[0] ? g_pairedExt.browser : L"chromium");
        }
    } else {
        RenderPill(T(S_STATUS_WAIT_EXT), PecTheme::CardBg, PecTheme::TextMuted);
        if (ImGui::IsItemHovered()) {
            ImGui::SetTooltip("%s", T(S_TOOLTIP_EXT_WAIT));
        }
    }

    // PEC Server Sync Status Indicator (thread-safe reading, WIN-07)
    wchar_t syncStatusSnapshot[128] = { 0 };
    PecSyncGetStatusStr(syncStatusSnapshot, 128);

    ImGui::SameLine(0, 10.0f);
    char syncTimeStr[64] = "";
    if (g_lastSyncTime.wYear > 0) {
        snprintf(syncTimeStr, sizeof(syncTimeStr), "%02d:%02d:%02d",
            g_lastSyncTime.wHour, g_lastSyncTime.wMinute, g_lastSyncTime.wSecond);
    }

    if (g_isSyncing) {
        RenderPill(T(S_STATUS_SYNCING), ImVec4(0.08f, 0.20f, 0.35f, 1.0f), PecTheme::HoverAccent);
    } else if (g_syncEverSucceeded) {
        char pillText[96];
        snprintf(pillText, sizeof(pillText), "%s (%s)", T(S_STATUS_SYNC_OK), syncTimeStr[0] ? syncTimeStr : "OK");
        RenderPill(pillText, ImVec4(0.08f, 0.28f, 0.18f, 1.0f), PecTheme::SuccessDirect);
        if (ImGui::IsItemHovered()) {
            ImGui::SetTooltip(T(S_TOOLTIP_SYNC_OK),
                syncTimeStr[0] ? syncTimeStr : "OK",
                syncStatusSnapshot,
                g_profile.pecSync.serverUrl[0] ? g_profile.pecSync.serverUrl : L"—");
        }
    } else if (g_lastSyncError != 0) {
        RenderPill(T(S_STATUS_SYNC_ERR), ImVec4(0.35f, 0.10f, 0.10f, 1.0f), PecTheme::DangerRed);
        if (ImGui::IsItemHovered()) {
            ImGui::SetTooltip(T(S_TOOLTIP_SYNC_ERR),
                g_lastSyncError,
                syncStatusSnapshot,
                g_profile.pecSync.serverUrl[0] ? g_profile.pecSync.serverUrl : L"—");
        }
    } else {
        RenderPill(T(S_STATUS_SYNC_WAIT), PecTheme::CardBg, PecTheme::TextMuted);
        if (ImGui::IsItemHovered()) {
            ImGui::SetTooltip(T(S_TOOLTIP_SYNC_WAIT), syncStatusSnapshot);
        }
    }

    // Right group: [RU] [EN] [Sync Button] [Status Toggle Button]
    float btnWidth = 180.0f;
    float syncBtnWidth = 28.0f;
    float flagBtnWidth = 28.0f;
    float gap = 8.0f;
    float totalRightWidth = (flagBtnWidth * 2.0f + 4.0f) + gap + syncBtnWidth + gap + btnWidth;
    float rightOffset = ImGui::GetWindowWidth() - totalRightWidth - 16.0f;
    if (rightOffset > ImGui::GetCursorPosX()) ImGui::SameLine(rightOffset);
    else ImGui::SameLine(0, 10.0f);

    // Language Selector with country flags (RU & EN only) placed immediately to the left of sync button
    if (RenderFlagButton("##btnLangRU", 0, g_lang == 0)) {
        g_lang = 0;
        ProfileLock lk;
        lstrcpynW(g_profile.language, L"ru", 8);
        SaveProfile();
        UpdateTitle(g_hWnd);
    }
    ImGui::SameLine(0, 4.0f);
    if (RenderFlagButton("##btnLangEN", 1, g_lang == 1)) {
        g_lang = 1;
        ProfileLock lk;
        lstrcpynW(g_profile.language, L"en", 8);
        SaveProfile();
        UpdateTitle(g_hWnd);
    }

    ImGui::SameLine(0, gap);

    if (RenderSyncButton("##forcesyncheader", T(S_TOOLTIP_SYNC_BTN))) {
        PecSyncTriggerNow();
    }

    ImGui::SameLine(0, gap);

    char statBtnText[64];
    if (g_proxyEnabled) {
        snprintf(statBtnText, sizeof(statBtnText), "● %s##statbtn", T(S_STATUS_ACTIVE));
        ImGui::PushStyleColor(ImGuiCol_Button, PecTheme::SuccessDirect);
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.1f, 0.8f, 0.55f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.05f, 0.65f, 0.45f, 1.0f));
        if (ImGui::Button(statBtnText, ImVec2(btnWidth, 0))) {
            SetProxyEnabled(false);
            TrayUpdateTip(TW(S_STATUS_PAUSED));
        }
        ImGui::PopStyleColor(3);
        if (ImGui::IsItemHovered()) {
            ImGui::SetTooltip("%s", T(S_TOOLTIP_TRAFFIC_ACTIVE));
        }
    } else {
        snprintf(statBtnText, sizeof(statBtnText), "⏸ %s##statbtn", T(S_STATUS_PAUSED));
        ImGui::PushStyleColor(ImGuiCol_Button, PecTheme::WarningAlert);
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(1.0f, 0.7f, 0.1f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.85f, 0.55f, 0.02f, 1.0f));
        if (ImGui::Button(statBtnText, ImVec2(btnWidth, 0))) {
            SetProxyEnabled(true);
            TrayUpdateTip(TW(S_STATUS_ACTIVE));
        }
        ImGui::PopStyleColor(3);
        if (ImGui::IsItemHovered()) {
            ImGui::SetTooltip("%s", T(S_TOOLTIP_TRAFFIC_PAUSED));
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
    const float SEARCH_INPUT_WIDTH = 200.0f;

    // Search input & match counter
    ImGui::PushItemWidth(SEARCH_INPUT_WIDTH);
    if (g_focusSearch) {
        ImGui::SetKeyboardFocusHere();
        g_focusSearch = false;
    }
    ImGui::InputTextWithHint("##rulesearch", T(S_RULES_SEARCH), g_ruleSearch, sizeof(g_ruleSearch));
    ImGui::PopItemWidth();

    FlowButtonSameLine(T(S_BTN_CLEARSEARCH));
    if (ImGui::Button(T(S_BTN_CLEARSEARCH))) {
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

    FlowSameLine(60.0f, 16.0f);
    ImGui::AlignTextToFramePadding();
    ImGui::TextColored(PecTheme::TextMuted, "%d / %d", matchCount, g_profile.ruleCount);

    ImGui::Spacing();

    // Toolbar Buttons (dynamic flow: wraps to second row when window is narrow)
    char addRuleBtn[64];
    snprintf(addRuleBtn, sizeof(addRuleBtn), "+ %s", T(S_BTN_ADDRULE));
    if (ImGui::Button(addRuleBtn)) {
        OpenRuleModal(-1);
    }

    // Disable ▲/▼ when search filter is active (WIN-14)
    bool searchActive = (g_ruleSearch[0] != 0);
    FlowButtonSameLine(u8"▲");
    ImGui::BeginDisabled(searchActive || g_selectedRuleIdx <= 0 || g_selectedRuleIdx >= g_profile.ruleCount);
    if (ImGui::Button(u8"▲") && g_selectedRuleIdx > 0 && g_selectedRuleIdx < g_profile.ruleCount) {
        PBRule temp = g_profile.rule[g_selectedRuleIdx];
        g_profile.rule[g_selectedRuleIdx] = g_profile.rule[g_selectedRuleIdx - 1];
        g_profile.rule[g_selectedRuleIdx - 1] = temp;
        g_selectedRuleIdx--;
        UnapplyRules();
        ApplyRules();
        SaveProfile();
    }
    ImGui::EndDisabled();

    FlowButtonSameLine(u8"▼");
    ImGui::BeginDisabled(searchActive || g_selectedRuleIdx < 0 || g_selectedRuleIdx >= g_profile.ruleCount - 1);
    if (ImGui::Button(u8"▼") && g_selectedRuleIdx >= 0 && g_selectedRuleIdx < g_profile.ruleCount - 1) {
        PBRule temp = g_profile.rule[g_selectedRuleIdx];
        g_profile.rule[g_selectedRuleIdx] = g_profile.rule[g_selectedRuleIdx + 1];
        g_profile.rule[g_selectedRuleIdx + 1] = temp;
        g_selectedRuleIdx++;
        UnapplyRules();
        ApplyRules();
        SaveProfile();
    }
    ImGui::EndDisabled();

    // Delete rule with confirmation (WIN-03)
    FlowButtonSameLine(T(S_BTN_REMOVE));
    ImGui::BeginDisabled(g_selectedRuleIdx < 0 || g_selectedRuleIdx >= g_profile.ruleCount);
    if (ImGui::Button(T(S_BTN_REMOVE))) {
        ImGui::OpenPopup("DeleteRuleConfirm");
    }
    ImGui::EndDisabled();

    FlowButtonSameLine(T(S_BTN_CLONE));
    if (ImGui::Button(T(S_BTN_CLONE)) && g_selectedRuleIdx >= 0 && g_selectedRuleIdx < g_profile.ruleCount && g_profile.ruleCount < PB_MAX_RULE) {
        PBRule clone = g_profile.rule[g_selectedRuleIdx];
        clone.nativeId = 0;
        clone.isCorporate = 0;
        _snwprintf_s(clone.name, 128, _TRUNCATE, L"%s (copy)", g_profile.rule[g_selectedRuleIdx].name);
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

    if (ImGui::BeginTable("RulesTable", 4, tableFlags, ImVec2(0.0f, availY))) {
        ImGui::TableSetupColumn("#", ImGuiTableColumnFlags_WidthFixed, 100.0f);
        ImGui::TableSetupColumn(T(S_COL_NAME), ImGuiTableColumnFlags_WidthStretch, 2.5f);
        ImGui::TableSetupColumn(T(S_COL_ACTION), ImGuiTableColumnFlags_WidthFixed, 85.0f);
        ImGui::TableSetupColumn(T(S_COL_CFG), ImGuiTableColumnFlags_WidthStretch, 1.5f);
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
            float rowCtrlH = ImGui::GetFrameHeight();

            // Column 0: Row number + Checkbox toggle + Pencil edit icon in a single aligned column
            ImGui::TableSetColumnIndex(0);
            ImGui::AlignTextToFramePadding();
            ImGui::TextColored(PecTheme::TextMuted, "%d", i + 1);

            ImGui::SameLine(0, 8.0f);
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

            ImGui::SameLine(0, 6.0f);
            char editBtn[32];
            snprintf(editBtn, sizeof(editBtn), u8"✎##editrule%d", i);
            if (ImGui::Button(editBtn, ImVec2(rowCtrlH, rowCtrlH))) {
                g_selectedRuleIdx = i;
                OpenRuleModal(i);
            }
            if (ImGui::IsItemHovered()) {
                ImGui::SetTooltip(u8"Редактировать правило");
            }

            // Column 1: Rule Target / Name with corporate / custom indicator
            ImGui::TableSetColumnIndex(1);
            if (r->isCorporate) {
                ImGui::TextColored(PecTheme::PrimaryAccent, "[%s]", T(S_TAG_CORP));
            } else {
                ImGui::TextColored(PecTheme::SuccessDirect, "[%s]", T(S_TAG_USER));
            }
            ImGui::SameLine(0, 6.0f);

            std::string displayRule = (!name.empty() && name != "PEC-App Rule" && name != "*")
                                      ? name
                                      : (!proc.empty() ? proc : hosts);
            if (displayRule.empty()) displayRule = "*";

            char selId[256];
            snprintf(selId, sizeof(selId), "%s##rulesel%d", displayRule.c_str(), i);
            bool isSelected = (g_selectedRuleIdx == i);
            if (ImGui::Selectable(selId, isSelected, ImGuiSelectableFlags_AllowDoubleClick)) {
                g_selectedRuleIdx = i;
                if (ImGui::IsMouseDoubleClicked(0)) {
                    OpenRuleModal(i);
                }
            }
            if (ImGui::IsItemHovered()) {
                std::string kind = r->isCorporate ? u8"Корпоративное правило (управляется сервером)" : u8"Пользовательское правило (локальное)";
                std::string tip = kind +
                                  "\nНазвание: " + (name.empty() ? "(по умолчанию)" : name) +
                                  "\nПроцессы: " + (proc.empty() ? "*" : proc) +
                                  "\nДомены / Порты: " + (hosts.empty() ? "*" : hosts) + " : " + (ports.empty() ? "*" : ports);
                ImGui::SetTooltip("%s", tip.c_str());
            }

            // Column 2: Action Pill
            ImGui::TableSetColumnIndex(2);
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

            // Column 3: Proxy name
            ImGui::TableSetColumnIndex(3);
            std::string proxyLabel = T(S_L_DEFAULT);
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


    if (ImGui::BeginPopupModal("DeleteRuleConfirm", nullptr, ImGuiWindowFlags_AlwaysAutoResize)) {
        ImGui::Text("%s", T(S_CONFIRM_DEL_RULE_MSG));
        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();
        if (ImGui::Button(T(S_BTN_DELETE), ImVec2(100, 0)) || ImGui::IsKeyPressed(ImGuiKey_Enter)) {
            if (g_selectedRuleIdx >= 0 && g_selectedRuleIdx < g_profile.ruleCount) {
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
            ImGui::CloseCurrentPopup();
        }
        ImGui::SameLine();
        if (ImGui::Button(T(S_BTN_CANCEL), ImVec2(100, 0)) || ImGui::IsKeyPressed(ImGuiKey_Escape)) {
            ImGui::CloseCurrentPopup();
        }
        ImGui::EndPopup();
    }

    // Modal Dialog: Add / Edit Rule
    char ruleModalTitle[128];
    snprintf(ruleModalTitle, sizeof(ruleModalTitle), "%s###RuleModalPopup", g_isEditRule ? T(S_DLG_RULE_EDIT) : T(S_DLG_RULE_NEW));
    if (g_openRuleModal) {
        ImGui::OpenPopup(ruleModalTitle);
        g_openRuleModal = false;
    }

    if (ImGui::BeginPopupModal(ruleModalTitle, nullptr, ImGuiWindowFlags_AlwaysAutoResize)) {
        ImGui::Spacing();

        if (g_isEditRule && g_editRuleIdx >= 0 && g_editRuleIdx < g_profile.ruleCount) {
            if (g_profile.rule[g_editRuleIdx].isCorporate) {
                ImGui::TextColored(PecTheme::PrimaryAccent, "%s", T(S_INFO_CORP_RULE));
            } else {
                ImGui::TextColored(PecTheme::SuccessDirect, "%s", T(S_INFO_USER_RULE));
            }
            ImGui::Spacing();
        }

        ImGui::Text("%s", T(S_L_NAME));
        ImGui::InputText("##rmName", g_rmName, sizeof(g_rmName));

        ImGui::Text("%s", T(S_COL_APPS));
        ImGui::InputText("##rmProc", g_rmProc, sizeof(g_rmProc));

        // Preset process buttons
        ImGui::TextColored(PecTheme::TextMuted, "%s", T(S_PRESETS_HINT));
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
        ImGui::Text("%s", T(S_L_HOSTS));
        ImGui::InputText("##rmHosts", g_rmHosts, sizeof(g_rmHosts));

        ImGui::Text("%s", T(S_L_PORTS));
        ImGui::InputText("##rmPorts", g_rmPorts, sizeof(g_rmPorts));

        ImGui::Spacing();
        ImGui::Text("%s", T(S_L_PROTO));
        const char* protoItems[] = { "TCP", "UDP", "BOTH" };
        ImGui::Combo("##rmProto", &g_rmProto, protoItems, IM_ARRAYSIZE(protoItems));

        ImGui::Text("%s", T(S_L_ACTION));
        const char* actionItems[] = { "PROXY (Через прокси)", "DIRECT (Напрямую)", "BLOCK (Блокировать)" };
        ImGui::Combo("##rmAction", &g_rmAction, actionItems, IM_ARRAYSIZE(actionItems));

        if (g_rmAction == 0 && g_profile.cfgCount > 0) {
            ImGui::Text("%s", T(S_L_CFGID));
            std::vector<std::string> cfgNames;
            for (int c = 0; c < g_profile.cfgCount; c++) {
                cfgNames.push_back(WToUtf8(g_profile.cfg[c].name[0] ? g_profile.cfg[c].name : g_profile.cfg[c].host));
            }
            std::vector<const char*> cfgPtrs;
            for (auto& s : cfgNames) cfgPtrs.push_back(s.c_str());
            ImGui::Combo("##rmProxyCfg", &g_rmProxyCfgIdx, cfgPtrs.data(), (int)cfgPtrs.size());
        }

        ImGui::Spacing();
        ImGui::Checkbox(T(S_CHK_ENABLE), &g_rmEnabled);
        ImGui::Checkbox(T(S_CHK_LOCALHOST), &g_rmLocalhost);

        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();

        char saveRuleBtn[64], cancelRuleBtn[64];
        snprintf(saveRuleBtn, sizeof(saveRuleBtn), "%s##saverule", T(S_BTN_SAVE));
        snprintf(cancelRuleBtn, sizeof(cancelRuleBtn), "%s##cancelrule", T(S_BTN_CANCEL));

        if (ImGui::IsKeyPressed(ImGuiKey_Escape)) {
            ImGui::CloseCurrentPopup();
        }
        if (ImGui::Button(saveRuleBtn, ImVec2(120, 0)) || ImGui::IsKeyPressed(ImGuiKey_Enter)) {
            PBRule* target = nullptr;
            if (g_isEditRule && g_editRuleIdx >= 0 && g_editRuleIdx < g_profile.ruleCount) {
                target = &g_profile.rule[g_editRuleIdx];
            } else if (g_profile.ruleCount < PB_MAX_RULE) {
                target = &g_profile.rule[g_profile.ruleCount++];
                ZeroMemory(target, sizeof(*target));
                target->isCorporate = 0;
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
        if (ImGui::Button(cancelRuleBtn, ImVec2(120, 0))) {
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
    const float SEARCH_INPUT_WIDTH = 200.0f;
    ImGui::PushItemWidth(SEARCH_INPUT_WIDTH);
    if (g_focusSearch) {
        ImGui::SetKeyboardFocusHere();
        g_focusSearch = false;
    }
    ImGui::InputTextWithHint("##connsearch", T(S_SEARCH_CUE), g_connSearch, sizeof(g_connSearch));
    ImGui::PopItemWidth();

    FlowButtonSameLine(T(S_BTN_CLEARSEARCH));
    if (ImGui::Button(T(S_BTN_CLEARSEARCH))) {
        g_connSearch[0] = 0;
    }

    FlowCheckboxSameLine(T(S_CHK_AUTOSCROLL), 16.0f);
    ImGui::Checkbox(T(S_CHK_AUTOSCROLL), &g_connAutoScroll);

    FlowCheckboxSameLine(T(S_M_PROXIED_ONLY));
    ImGui::Checkbox(T(S_M_PROXIED_ONLY), &g_proxiedOnly);

    FlowButtonSameLine(T(S_BTN_CLEARLOGS));
    if (ImGui::Button(T(S_BTN_CLEARLOGS))) {
        g_connBuffer.Clear();
        if (g_api.ClearConnectionLogs) g_api.ClearConnectionLogs();
    }

    std::vector<ConnEntry> snapshot;
    g_connBuffer.GetSnapshot(snapshot);

    // Compute lowercase search query once before row iteration
    char searchLower[sizeof(g_connSearch)];
    size_t needleLen = 0;
    for (size_t i = 0; g_connSearch[i] && i < sizeof(searchLower) - 1; ++i) {
        unsigned char c = (unsigned char)g_connSearch[i];
        searchLower[i] = (c >= 'A' && c <= 'Z') ? (char)(c + 32) : (char)c;
        needleLen++;
    }
    searchLower[needleLen] = '\0';

    // Collect visible row indices without per-row heap allocations
    std::vector<size_t> visibleIndices;
    visibleIndices.reserve(snapshot.size());
    for (size_t i = 0; i < snapshot.size(); ++i) {
        const ConnEntry& e = snapshot[i];
        if (g_proxiedOnly && e.isDirect) continue;
        if (needleLen > 0) {
            if (!StrContainsCaseInsensitive(e.process, searchLower, needleLen) &&
                !StrContainsCaseInsensitive(e.hostIp, searchLower, needleLen) &&
                !StrContainsCaseInsensitive(e.proxy, searchLower, needleLen)) {
                continue;
            }
        }
        visibleIndices.push_back(i);
    }

    FlowSameLine(60.0f, 16.0f);
    ImGui::AlignTextToFramePadding();
    ImGui::TextColored(PecTheme::TextMuted, "%zu / %zu", visibleIndices.size(), snapshot.size());

    ImGui::Spacing();

    // Table
    ImGuiTableFlags tableFlags = ImGuiTableFlags_RowBg | ImGuiTableFlags_BordersInnerV | ImGuiTableFlags_BordersOuterH |
                                 ImGuiTableFlags_ScrollY | ImGuiTableFlags_Resizable;
    float availY = ImGui::GetContentRegionAvail().y - 10.0f;

    if (ImGui::BeginTable("ConnStreamTable", 6, tableFlags, ImVec2(0.0f, availY))) {
        ImGui::TableSetupColumn(T(S_COL_TIME), ImGuiTableColumnFlags_WidthFixed, 75.0f);
        ImGui::TableSetupColumn(T(S_COL_PROCESS), ImGuiTableColumnFlags_WidthFixed, 140.0f);
        ImGui::TableSetupColumn(T(S_COL_HOSTS), ImGuiTableColumnFlags_WidthStretch, 2.0f);
        ImGui::TableSetupColumn(T(S_COL_ACTION), ImGuiTableColumnFlags_WidthFixed, 85.0f);
        ImGui::TableSetupColumn(T(S_COL_CFG), ImGuiTableColumnFlags_WidthStretch, 1.2f);
        ImGui::TableSetupColumn(T(S_COL_STATUS), ImGuiTableColumnFlags_WidthFixed, 75.0f);
        ImGui::TableHeadersRow();

        ImGuiListClipper clipper;
        clipper.Begin((int)visibleIndices.size());
        while (clipper.Step()) {
            for (int row_i = clipper.DisplayStart; row_i < clipper.DisplayEnd; row_i++) {
                const ConnEntry& e = snapshot[visibleIndices[row_i]];
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

                // Context menu for row (WIN-13)
                char rowPopupId[32];
                snprintf(rowPopupId, sizeof(rowPopupId), "ConnRowCtx_%d", row_i);
                if (ImGui::BeginPopupContextItem(rowPopupId)) {
                    if (ImGui::MenuItem(T(S_MENU_COPY_ROW))) {
                        char clipBuf[512];
                        snprintf(clipBuf, sizeof(clipBuf), "%s\t%s\t%s\t%s\t%s\t%s",
                            e.time, e.process, e.hostIp, e.action, e.proxy, e.status);
                        ImGui::SetClipboardText(clipBuf);
                    }
                    if (ImGui::MenuItem(T(S_MENU_COPY_HOST))) {
                        ImGui::SetClipboardText(e.hostIp);
                    }
                    if (ImGui::MenuItem(T(S_MENU_COPY_PROC))) {
                        ImGui::SetClipboardText(e.process);
                    }
                    ImGui::EndPopup();
                }
            }
        }

        if (g_connAutoScroll) {
            ImGui::SetScrollHereY(1.0f);
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
    const float SEARCH_INPUT_WIDTH = 200.0f;
    ImGui::PushItemWidth(SEARCH_INPUT_WIDTH);
    if (g_focusSearch) {
        ImGui::SetKeyboardFocusHere();
        g_focusSearch = false;
    }
    ImGui::InputTextWithHint("##englogsearch", T(S_SEARCH_CUE), g_logSearch, sizeof(g_logSearch));
    ImGui::PopItemWidth();

    FlowButtonSameLine(T(S_BTN_CLEARSEARCH));
    if (ImGui::Button(T(S_BTN_CLEARSEARCH))) {
        g_logSearch[0] = 0;
    }

    FlowCheckboxSameLine(T(S_CHK_AUTOSCROLL));
    ImGui::Checkbox(T(S_CHK_AUTOSCROLL), &g_logAutoScroll);

    FlowButtonSameLine(T(S_BTN_CLEARLOGS));
    if (ImGui::Button(T(S_BTN_CLEARLOGS))) {
        EnterCriticalSection(&g_logCs);
        g_logEntries.clear();
        LeaveCriticalSection(&g_logCs);
    }

    FlowButtonSameLine(T(S_LOG_FOLDER));
    if (ImGui::Button(T(S_LOG_FOLDER))) {
        OpenLogsFolder();
    }

    char copyAllBtnLabel[128];
    // Button label: Скопировать лог##copylogall
    snprintf(copyAllBtnLabel, sizeof(copyAllBtnLabel), "%s##copylogall", T(S_LOG_COPY_ALL));
    FlowButtonSameLine(copyAllBtnLabel);
    if (ImGui::Button(copyAllBtnLabel)) {
        EnterCriticalSection(&g_logCs);
        std::string allLogs;
        for (const auto& entry : g_logEntries) {
            allLogs += "[";
            allLogs += entry.time;
            allLogs += "] ";
            allLogs += entry.message;
            allLogs += "\r\n";
        }
        LeaveCriticalSection(&g_logCs);
        ImGui::SetClipboardText(allLogs.c_str());
    }

    ImGui::Spacing();

    // Scrollable log view
    float availY = ImGui::GetContentRegionAvail().y - 10.0f;
    ImGui::BeginChild("EngineLogsScrollRegion", ImVec2(0.0f, availY), true, ImGuiWindowFlags_HorizontalScrollbar);

    // Compute lowercase search query once before log iteration
    char searchLower[sizeof(g_logSearch)];
    size_t needleLen = 0;
    for (size_t i = 0; g_logSearch[i] && i < sizeof(searchLower) - 1; ++i) {
        unsigned char c = (unsigned char)g_logSearch[i];
        searchLower[i] = (c >= 'A' && c <= 'Z') ? (char)(c + 32) : (char)c;
        needleLen++;
    }
    searchLower[needleLen] = '\0';

    EnterCriticalSection(&g_logCs);
    std::vector<size_t> visibleLogIndices;
    visibleLogIndices.reserve(g_logEntries.size());
    for (size_t i = 0; i < g_logEntries.size(); ++i) {
        const auto& entry = g_logEntries[i];
        if (needleLen > 0) {
            if (!StrContainsCaseInsensitive(entry.message.c_str(), searchLower, needleLen)) {
                continue;
            }
        }
        visibleLogIndices.push_back(i);
    }

    ImGuiListClipper clipper;
    clipper.Begin((int)visibleLogIndices.size());
    while (clipper.Step()) {
        for (int i = clipper.DisplayStart; i < clipper.DisplayEnd; ++i) {
            const auto& entry = g_logEntries[visibleLogIndices[i]];
            ImGui::TextColored(PecTheme::TextMuted, "[%s] ", entry.time);
            ImGui::SameLine();

            if (entry.level == 2) {
                ImGui::TextColored(PecTheme::DangerRed, "%s", entry.message.c_str());
            } else if (entry.level == 1) {
                ImGui::TextColored(PecTheme::WarningAlert, "%s", entry.message.c_str());
            } else {
                ImGui::TextColored(PecTheme::TextPrimary, "%s", entry.message.c_str());
            }

            char logPopupId[32];
            snprintf(logPopupId, sizeof(logPopupId), "LogLineCtx_%d", i);
            if (ImGui::BeginPopupContextItem(logPopupId)) {
                if (ImGui::MenuItem(T(S_MENU_COPY_LINE))) {
                    char clipBuf[512];
                    snprintf(clipBuf, sizeof(clipBuf), "[%s] %s", entry.time, entry.message.c_str());
                    ImGui::SetClipboardText(clipBuf);
                }
                if (ImGui::MenuItem(T(S_LOG_COPY_ALL))) {
                    std::string allLogs;
                    for (const auto& el : g_logEntries) {
                        allLogs += "["; allLogs += el.time; allLogs += "] ";
                        allLogs += el.message; allLogs += "\r\n";
                    }
                    ImGui::SetClipboardText(allLogs.c_str());
                }
                ImGui::EndPopup();
            }
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
    char addPrx[64], delPrx[64], testPrx[64];
    snprintf(addPrx, sizeof(addPrx), "+ %s", T(S_BTN_ADD));
    snprintf(delPrx, sizeof(delPrx), "%s##delproxy", T(S_BTN_DELETE));
    snprintf(testPrx, sizeof(testPrx), "⚡ %s", T(S_BTN_TEST));

    if (ImGui::Button(addPrx)) {
        OpenProxyModal(-1);
    }
    FlowButtonSameLine(delPrx);
    bool canDeleteProxy = (g_profile.cfgCount > 1);
    ImGui::BeginDisabled(!canDeleteProxy || g_selectedProxyIdx < 0 || g_selectedProxyIdx >= g_profile.cfgCount);
    if (ImGui::Button(delPrx)) {
        ImGui::OpenPopup("DeleteProxyConfirm");
    }
    ImGui::EndDisabled();
    if (!canDeleteProxy && ImGui::IsItemHovered(ImGuiHoveredFlags_AllowWhenDisabled)) {
        ImGui::SetTooltip("%s", T(S_ERR_LAST_PROXY));
    }

    FlowButtonSameLine(testPrx);
    if (ImGui::Button(testPrx)) {
        for (int i = 0; i < g_profile.cfgCount; i++) {
            TestProxyLatencyAsync(i);
        }
    }

    ImGui::Spacing();

    // Table of proxies
    ImGuiTableFlags tableFlags = ImGuiTableFlags_RowBg | ImGuiTableFlags_BordersInnerV | ImGuiTableFlags_BordersOuterH |
                                 ImGuiTableFlags_ScrollY | ImGuiTableFlags_Resizable;
    float availY = ImGui::GetContentRegionAvail().y - 10.0f;

    if (ImGui::BeginTable("ProxiesTable", 7, tableFlags, ImVec2(0.0f, availY))) {
        ImGui::TableSetupColumn("#", ImGuiTableColumnFlags_WidthFixed, 100.0f);
        ImGui::TableSetupColumn(T(S_COL_NAME), ImGuiTableColumnFlags_WidthStretch, 1.5f);
        ImGui::TableSetupColumn(T(S_COL_TYPE), ImGuiTableColumnFlags_WidthFixed, 75.0f);
        ImGui::TableSetupColumn(T(S_COL_ADDR), ImGuiTableColumnFlags_WidthStretch, 2.0f);
        ImGui::TableSetupColumn(T(S_G_AUTH), ImGuiTableColumnFlags_WidthStretch, 1.2f);
        ImGui::TableSetupColumn(T(S_CHK_SENDDOMAIN), ImGuiTableColumnFlags_WidthFixed, 85.0f);
        ImGui::TableSetupColumn(T(S_COL_STATUS), ImGuiTableColumnFlags_WidthFixed, 140.0f);
        ImGui::TableHeadersRow();

        for (int i = 0; i < g_profile.cfgCount; i++) {
            PBConfig* c = &g_profile.cfg[i];
            ImGui::TableNextRow();
            float rowCtrlH = ImGui::GetFrameHeight();

            // Column 0: Row index + Default proxy toggle + Pencil edit icon in a single aligned column
            ImGui::TableSetColumnIndex(0);
            ImGui::AlignTextToFramePadding();
            ImGui::TextColored(PecTheme::TextMuted, "%d", i + 1);

            ImGui::SameLine(0, 8.0f);
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

            ImGui::SameLine(0, 6.0f);
            char editBtn[32];
            snprintf(editBtn, sizeof(editBtn), u8"✎##editproxy%d", i);
            if (ImGui::Button(editBtn, ImVec2(rowCtrlH, rowCtrlH))) {
                g_selectedProxyIdx = i;
                OpenProxyModal(i);
            }
            if (ImGui::IsItemHovered()) {
                ImGui::SetTooltip(u8"Редактировать параметры прокси");
            }

            // Column 1: Name & row selection (no SpanAllColumns, prevents click capture bugs)
            ImGui::TableSetColumnIndex(1);
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

            // Column 2: Type Pill
            ImGui::TableSetColumnIndex(2);
            RenderPill(WToUtf8(c->type).c_str(), PecTheme::PrimaryAccent);

            // Column 3: Host : Port
            ImGui::TableSetColumnIndex(3);
            std::string endpoint = WToUtf8(c->host) + ":" + WToUtf8(c->port);
            ImGui::TextUnformatted(endpoint.c_str());

            // Column 4: Authentication
            ImGui::TableSetColumnIndex(4);
            std::string auth = c->user[0] ? WToUtf8(c->user) : T(S_L_NOPASS);
            ImGui::TextUnformatted(auth.c_str());

            // Column 5: DNS
            ImGui::TableSetColumnIndex(5);
            ImGui::TextColored(c->sendDomain ? PecTheme::SuccessDirect : PecTheme::TextMuted,
                               c->sendDomain ? T(S_L_REMOTE) : T(S_L_LOCAL));

            // Column 6: Latency / Ping status
            ImGui::TableSetColumnIndex(6);
            ProxyLatencyState lat;
            {
                LatencyLock latLock;
                lat = g_proxyLatencies[i];
            }
            if (lat.testing) {
                ImGui::TextColored(PecTheme::HoverAccent, "%s", T(S_LAT_CHECKING));
            } else if (lat.ms >= 0) {
                ImGui::TextColored(PecTheme::SuccessDirect, "%s", lat.status);
            } else {
                ImGui::TextColored(PecTheme::TextMuted, "%s", lat.status);
            }
        }
        ImGui::EndTable();
    }


    if (ImGui::BeginPopupModal("DeleteProxyConfirm", nullptr, ImGuiWindowFlags_AlwaysAutoResize)) {
        ImGui::Text("%s", T(S_CONFIRM_DEL_PROXY_MSG));
        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();
        if (ImGui::Button(T(S_BTN_DELETE), ImVec2(100, 0)) || ImGui::IsKeyPressed(ImGuiKey_Enter)) {
            if (g_selectedProxyIdx >= 0 && g_selectedProxyIdx < g_profile.cfgCount && g_profile.cfgCount > 1) {
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
            ImGui::CloseCurrentPopup();
        }
        ImGui::SameLine();
        if (ImGui::Button(T(S_BTN_CANCEL), ImVec2(100, 0)) || ImGui::IsKeyPressed(ImGuiKey_Escape)) {
            ImGui::CloseCurrentPopup();
        }
        ImGui::EndPopup();
    }

    // Modal: Add / Edit Proxy
    char proxyModalTitle[128];
    snprintf(proxyModalTitle, sizeof(proxyModalTitle), "%s###ProxyModalPopup", g_isEditProxy ? T(S_DLG_PROXY_EDIT) : T(S_DLG_PROXY_NEW));
    if (g_openProxyModal) {
        ImGui::OpenPopup(proxyModalTitle);
        g_openProxyModal = false;
    }

    if (ImGui::BeginPopupModal(proxyModalTitle, nullptr, ImGuiWindowFlags_AlwaysAutoResize)) {
        ImGui::Spacing();

        ImGui::Text("%s", T(S_L_NAME));
        ImGui::InputText("##pmName", g_pmName, sizeof(g_pmName));

        ImGui::Text("%s", T(S_L_TYPE));
        const char* typeItems[] = { "SOCKS5", "HTTP" };
        ImGui::Combo("##pmType", &g_pmType, typeItems, IM_ARRAYSIZE(typeItems));

        ImGui::Text("%s", T(S_L_HOST));
        bool hostEmpty = (g_pmHost[0] == 0);
        if (hostEmpty) ImGui::PushStyleColor(ImGuiCol_Border, PecTheme::DangerRed);
        ImGui::InputText("##pmHost", g_pmHost, sizeof(g_pmHost));
        if (hostEmpty) {
            ImGui::PopStyleColor();
            ImGui::TextColored(PecTheme::DangerRed, "%s", T(S_ERR_HOST_REQ));
        }

        ImGui::Text("%s", T(S_L_PORT));
        int portVal = atoi(g_pmPort);
        bool portInvalid = (portVal < 1 || portVal > 65535);
        if (portInvalid) ImGui::PushStyleColor(ImGuiCol_Border, PecTheme::DangerRed);
        ImGui::InputText("##pmPort", g_pmPort, sizeof(g_pmPort), ImGuiInputTextFlags_CharsDecimal);
        if (portInvalid) {
            ImGui::PopStyleColor();
            ImGui::TextColored(PecTheme::DangerRed, "%s", T(S_ERR_PORT_RANGE));
        }

        bool formValid = (!hostEmpty && !portInvalid);

        ImGui::Spacing();
        ImGui::Text("%s", T(S_L_USER));
        ImGui::InputText("##pmUser", g_pmUser, sizeof(g_pmUser));

        ImGui::Text("%s", T(S_L_PASS));
        ImGui::InputText("##pmPass", g_pmPass, sizeof(g_pmPass), ImGuiInputTextFlags_Password);

        ImGui::Spacing();
        ImGui::Checkbox(T(S_CHK_SENDDOMAIN), &g_pmSendDomain);

        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();

        char saveBtn[64], cancelBtn[64];
        snprintf(saveBtn, sizeof(saveBtn), "%s##saveproxy", T(S_BTN_SAVE));
        snprintf(cancelBtn, sizeof(cancelBtn), "%s##cancelproxy", T(S_BTN_CANCEL));

        if (ImGui::IsKeyPressed(ImGuiKey_Escape)) {
            ImGui::CloseCurrentPopup();
        }

        ImGui::BeginDisabled(!formValid);
        bool triggerSaveProxy = ImGui::Button(saveBtn, ImVec2(120, 0)) || (formValid && ImGui::IsKeyPressed(ImGuiKey_Enter));
        ImGui::EndDisabled();

        if (triggerSaveProxy && formValid) {
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
        if (ImGui::Button(cancelBtn, ImVec2(120, 0))) {
            ImGui::CloseCurrentPopup();
        }
        ImGui::EndPopup();
    }
}

// -----------------------------------------------------------------------------

static void RenderSettingsTab()
{
    ImGui::Spacing();
    ImGui::TextColored(PecTheme::PrimaryAccent, "%s", T(S_SET_TITLE));
    ImGui::Separator();
    ImGui::Spacing();

    // Autostart with Windows
    bool autostart = GetAutostartWithWindows();
    if (ImGui::Checkbox(T(S_SET_AUTOSTART), &autostart)) {
        SetAutostartWithWindows(autostart);
    }

    // Close to Tray
    if (ImGui::Checkbox(T(S_SET_CLOSE_TRAY), &g_closeToTray)) {
        ProfileLock lock;
        g_profile.closeToTray = g_closeToTray ? 1 : 0;
        SaveProfile();
    }

    // Traffic Logging
    if (ImGui::Checkbox(T(S_SET_TRAFFIC_LOG), &g_connLogging)) {
        ProfileLock lock;
        g_profile.trafficLogging = g_connLogging ? 1 : 0;
        if (g_api.SetTrafficLoggingEnabled) g_api.SetTrafficLoggingEnabled(g_connLogging ? TRUE : FALSE);
        SaveProfile();
    }

    // Log every repeat connection
    bool logEvery = (g_profile.logEveryConnection != 0);
    if (ImGui::Checkbox(T(S_SET_LOG_EVERY), &logEvery)) {
        ProfileLock lock;
        g_profile.logEveryConnection = logEvery ? 1 : 0;
        SaveProfile();
    }

    ImGui::Spacing();
    ImGui::Separator();
    ImGui::Spacing();

    // Server Sync Configuration
    ImGui::TextColored(PecTheme::TextPrimary, "%s", T(S_STATUS_SYNC_OK));
    char srvUrlBuf[512] = "";
    char fltTokBuf[256] = "";
    WideCharToMultiByte(CP_UTF8, 0, g_profile.pecSync.serverUrl, -1, srvUrlBuf, sizeof(srvUrlBuf), nullptr, nullptr);
    WideCharToMultiByte(CP_UTF8, 0, g_profile.pecSync.fleetToken, -1, fltTokBuf, sizeof(fltTokBuf), nullptr, nullptr);

    ImGui::Text("Server URL:");
    if (ImGui::InputText("##settingsServerUrl", srvUrlBuf, sizeof(srvUrlBuf))) {
        ProfileLock lock;
        CopyUtf8ToW(srvUrlBuf, g_profile.pecSync.serverUrl, 512);
        g_profile.pecSync.enabled = (srvUrlBuf[0] != 0);
        SaveProfile();
    }

    ImGui::Text("Fleet Token:");
    if (ImGui::InputText("##settingsFleetToken", fltTokBuf, sizeof(fltTokBuf), ImGuiInputTextFlags_Password)) {
        ProfileLock lock;
        CopyUtf8ToW(fltTokBuf, g_profile.pecSync.fleetToken, 256);
        SaveProfile();
    }

    ImGui::Spacing();
    if (ImGui::Button(T(S_BTN_SYNC_SERVER), ImVec2(240, 0))) {
        PecSyncTriggerNow();
    }
}

// Main Tabs Dispatcher
// -----------------------------------------------------------------------------
static void RenderTabs()
{
    if (ImGui::BeginTabBar("PECTabBar", ImGuiTabBarFlags_None)) {
        char tabServers[128], tabRules[128], tabConn[128], tabLogs[128], tabSettings[128];
        snprintf(tabServers, sizeof(tabServers), "%s###tab_servers", T(S_TAB_SERVERS));
        snprintf(tabRules,   sizeof(tabRules),   "%s###tab_rules",   T(S_TAB_RULES));
        snprintf(tabConn,    sizeof(tabConn),    "%s###tab_conn",    T(S_TAB_CONN));
        snprintf(tabLogs,    sizeof(tabLogs),    "%s###tab_logs",    T(S_TAB_ACT));
        snprintf(tabSettings,sizeof(tabSettings),"%s###tab_settings",T(S_TAB_SETTINGS));

        ImGuiTabItemFlags tabFlags[5] = {};
        if (g_activeTab >= 0 && g_activeTab < 5) {
            tabFlags[g_activeTab] = ImGuiTabItemFlags_SetSelected;
            g_activeTab = -1;
        }

        if (ImGui::BeginTabItem(tabServers, nullptr, tabFlags[0])) {
            RenderProxiesTab();
            ImGui::EndTabItem();
        }
        if (ImGui::BeginTabItem(tabRules, nullptr, tabFlags[1])) {
            RenderRulesTab();
            ImGui::EndTabItem();
        }
        if (ImGui::BeginTabItem(tabConn, nullptr, tabFlags[2])) {
            RenderConnectionsTab();
            ImGui::EndTabItem();
        }
        if (ImGui::BeginTabItem(tabLogs, nullptr, tabFlags[3])) {
            RenderEngineLogsTab();
            ImGui::EndTabItem();
        }
        if (ImGui::BeginTabItem(tabSettings, nullptr, tabFlags[4])) {
            RenderSettingsTab();
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
    case WM_GETMINMAXINFO: {
        MINMAXINFO* mmi = (MINMAXINFO*)lParam;
        float scale = g_dpiScale > 0.1f ? g_dpiScale : 1.0f;
        mmi->ptMinTrackSize.x = (LONG)(720 * scale);
        mmi->ptMinTrackSize.y = (LONG)(480 * scale);
        return 0;
    }

    case WM_DPICHANGED: {
        RECT* const prcNewWindow = (RECT*)lParam;
        SetWindowPos(hWnd, nullptr,
            prcNewWindow->left, prcNewWindow->top,
            prcNewWindow->right - prcNewWindow->left,
            prcNewWindow->bottom - prcNewWindow->top,
            SWP_NOZORDER | SWP_NOACTIVATE);
        float newDpi = (float)LOWORD(wParam);
        float newScale = newDpi / 96.0f;
        if (newScale <= 0.1f) newScale = 1.0f;
        if (fabs(newScale - g_dpiScale) > 0.01f) {
            float relativeScale = newScale / g_dpiScale;
            ImGui::GetStyle().ScaleAllSizes(relativeScale);
            ImGui::GetIO().FontGlobalScale = newScale / g_baseDpiScale;
            g_dpiScale = newScale;
        }
        return 0;
    }

    case WM_SIZE:
        if (g_pd3dDevice != nullptr && wParam != SIZE_MINIMIZED) {
            CleanupRenderTarget();
            g_pSwapChain->ResizeBuffers(0, (UINT)LOWORD(lParam), (UINT)HIWORD(lParam), DXGI_FORMAT_UNKNOWN, 0);
            CreateRenderTarget();
        }
        return 0;

    case WM_SYSCOMMAND:
        if ((wParam & 0xFFF0) == SC_CLOSE && !g_reallyExit) {
            if (g_closeToTray) {
                ShowWindow(hWnd, SW_HIDE);
                return 0;
            } else {
                g_reallyExit = true;
                SaveWindowGeometry(hWnd);
                DestroyWindow(hWnd);
                return 0;
            }
        }
        break;

    case WM_CLOSE:
        if (!g_reallyExit) {
            if (g_closeToTray) {
                ShowWindow(hWnd, SW_HIDE);
                return 0;
            } else {
                g_reallyExit = true;
                SaveWindowGeometry(hWnd);
                DestroyWindow(hWnd);
                return 0;
            }
        }
        SaveWindowGeometry(hWnd);
        DestroyWindow(hWnd);
        return 0;

    case WM_APP_UPDATE: {
        UpdInfo* info = (UpdInfo*)lParam;
        BOOL ok = (wParam & 1) != 0;
        if (info) {
            if (ok && info->available) {
                wchar_t bmsg[512];
                _snwprintf_s(bmsg, 512, _TRUNCATE, L"Доступна новая версия PEC-App v%ls.\nСкачать сейчас?", info->latest);
                TrayShowBalloon(APP_TITLE_W, bmsg);
                if (MessageBoxW(hWnd, bmsg, L"Обновление PEC-App", MB_YESNO | MB_ICONINFORMATION) == IDYES) {
                    if (info->download[0]) {
                        ShellExecuteW(nullptr, L"open", info->download, nullptr, nullptr, SW_SHOWNORMAL);
                    }
                }
            }
            free(info);
        }
        return 0;
    }

    case WM_APP_TRAY:
        if (lParam == WM_LBUTTONUP || lParam == WM_LBUTTONDBLCLK) {
            ShowWindow(hWnd, SW_RESTORE);
            SetForegroundWindow(hWnd);
        } else if (lParam == WM_RBUTTONUP) {
            HMENU hMenu = CreatePopupMenu();
            AppendMenuW(hMenu, MF_STRING, IDM_TRAY_SHOW, TW(S_TRAY_SHOW));
            wchar_t trayStat[128];
            _snwprintf_s(trayStat, 128, _TRUNCATE, L"%ls: %ls", TW(S_COL_STATUS), g_proxyEnabled ? TW(S_STATUS_ACTIVE) : TW(S_STATUS_PAUSED));
            AppendMenuW(hMenu, MF_STRING, IDM_PROXY_ENABLE, trayStat);
            AppendMenuW(hMenu, MF_STRING, IDM_OPEN_LOGS, TW(S_LOG_FOLDER));
            AppendMenuW(hMenu, MF_SEPARATOR, 0, nullptr);
            AppendMenuW(hMenu, MF_STRING, IDM_TRAY_EXIT, TW(S_TRAY_EXIT));

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
static HANDLE g_hSingleInstanceMutex = nullptr;

static BOOL ConnectEngine(void)
{
    PB_WriteAppLog("ConnectEngine: Attempting IPC connection to PECAppSvc service...");
    int rc = PB_LoadService(&g_api);
    if (rc == PB_IPC_OK) {
        PB_WriteAppLog("ConnectEngine: Connected to PECAppSvc service.");
        LogAdd("Подключено к системной службе PECAppSvc.");
        return TRUE;
    }

    PB_WriteAppLog("ConnectEngine: Service IPC returned code %d.", rc);

    if (rc == PB_IPC_BUSY)
    {
        PB_WriteAppLog("ConnectEngine: Service is busy with another client.");
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
        PB_WriteAppLog("[ERROR] ConnectEngine: Service version mismatch.");
        MessageBoxW(NULL,
            L"Установленная служба PEC-App не совпадает по версии с данной программой.\nЗапустите установщик PEC-App заново.",
            APP_TITLE_W, MB_OK | MB_ICONERROR);
        return FALSE;
    }

    if (rc == PB_IPC_DENIED)
    {
        PB_WriteAppLog("[WARN] ConnectEngine: Access to PECAppSvc denied for current account.");
        if (MessageBoxW(NULL,
            L"Данная учетная запись не имеет доступа к службе PEC-App.\nЗапустить от имени администратора?",
            APP_TITLE_W, MB_YESNO | MB_ICONWARNING) != IDYES)
            return FALSE;
    }

    // No service running: portable standalone mode
    if (!IsElevated())
    {
        if (wcsstr(GetCommandLineW(), L"--elevated-child") != nullptr) {
            PB_WriteAppLog("[ERROR] ConnectEngine: Process was spawned as --elevated-child, but still lacks elevated administrator token.");
            MessageBoxW(NULL,
                L"Не удалось получить права администратора для автономного режима маршрутизации.\nЗапустите PEC-App от имени администратора вручную или установите системную службу.",
                APP_TITLE_W, MB_OK | MB_ICONERROR);
            return FALSE;
        }

        PB_WriteAppLog("ConnectEngine: Unprivileged standalone instance. Initiating UAC self-elevation...");
        wchar_t exe[MAX_PATH];
        GetModuleFileNameW(NULL, exe, MAX_PATH);

        // Crucial fix: release single-instance mutex so elevated child process does not collide
        if (g_hSingleInstanceMutex) {
            CloseHandle(g_hSingleInstanceMutex);
            g_hSingleInstanceMutex = nullptr;
            PB_WriteAppLog("ConnectEngine: Released single-instance mutex prior to spawning elevated child.");
        }

        // Pass --elevated-child and any other parameters
        const wchar_t* cmdLine = GetCommandLineW();
        const wchar_t* args = cmdLine;
        if (args && *args == L'\"') {
            args++;
            while (*args && *args != L'\"') args++;
            if (*args == L'\"') args++;
        } else if (args) {
            while (*args && *args != L' ') args++;
        }
        while (args && (*args == L' ' || *args == L'\t')) args++;

        wchar_t childParams[1024];
        if (args && args[0]) {
            _snwprintf_s(childParams, 1024, _TRUNCATE, L"--elevated-child %s", args);
        } else {
            _snwprintf_s(childParams, 1024, _TRUNCATE, L"--elevated-child");
        }

        SHELLEXECUTEINFOW sei;
        ZeroMemory(&sei, sizeof(sei));
        sei.cbSize = sizeof(sei);
        sei.fMask = SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
        sei.lpVerb = L"runas";
        sei.lpFile = exe;
        sei.lpParameters = childParams;
        sei.nShow = SW_SHOWNORMAL;
        if (ShellExecuteExW(&sei)) {
            PB_WriteAppLog("ConnectEngine: Elevated child process successfully spawned (PID in child). Terminating unprivileged parent.");
            return FALSE;
        }

        DWORD err = GetLastError();
        PB_WriteAppLog("ConnectEngine: ShellExecuteExW(runas) failed (error %lu).", err);
        if (err == ERROR_CANCELLED) {
            MessageBoxW(NULL,
                L"Для работы маршрутизации в автономном (портативном) режиме требуются права администратора.\n\nЗапустите PEC-App от имени администратора или установите службу через PEC-App-Setup.exe.",
                APP_TITLE_W, MB_OK | MB_ICONWARNING);
        } else {
            wchar_t errMsg[512];
            _snwprintf_s(errMsg, 512, _TRUNCATE,
                L"Не удалось запустить процесс с правами администратора (код ошибки: %lu).\nПопробуйте запустить программу через 'Запуск от имени администратора'.",
                err);
            MessageBoxW(NULL, errMsg, APP_TITLE_W, MB_OK | MB_ICONERROR);
        }
        return FALSE;
    }

    PB_WriteAppLog("ConnectEngine: Elevated standalone mode. Calling PB_LoadDirect...");
    if (!PB_LoadDirect(&g_api))
    {
        const wchar_t* detail = PB_GetLastErrorMsg();
        PB_WriteAppLog("[FATAL] ConnectEngine: PB_LoadDirect failed: %ls", detail ? detail : L"");
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

    PB_WriteAppLog("ConnectEngine: PB_LoadDirect loaded PECAppCore successfully.");
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

    // Early diagnostics logging
    CheckAndRotateAppLog();
    PB_WriteAppLog("=== PEC-App ImGui GUI starting (PID: %lu, Elevated: %s, CmdLine: %ls) ===",
        GetCurrentProcessId(), IsElevated() ? "YES" : "NO", GetCommandLineW());

    bool isElevatedChild = (wcsstr(GetCommandLineW(), L"--elevated-child") != nullptr);

    // Single instance named mutex check (WIN-20)
    g_hSingleInstanceMutex = CreateMutexW(nullptr, FALSE, L"Local\\PECApp_SingleInstance_Mutex");
    if (GetLastError() == ERROR_ALREADY_EXISTS && isElevatedChild) {
        PB_WriteAppLog("Elevated child detected; waiting for unprivileged parent to exit and release mutex...");
        for (int retry = 0; retry < 60; retry++) {
            Sleep(50);
            if (g_hSingleInstanceMutex) CloseHandle(g_hSingleInstanceMutex);
            g_hSingleInstanceMutex = CreateMutexW(nullptr, FALSE, L"Local\\PECApp_SingleInstance_Mutex");
            if (GetLastError() != ERROR_ALREADY_EXISTS) {
                PB_WriteAppLog("Acquired single-instance mutex after %d ms.", (retry + 1) * 50);
                break;
            }
        }
    }

    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        HWND existing = nullptr;
        for (int r = 0; r < 10; r++) {
            existing = FindWindowW(L"PECAppImGuiMainWnd", nullptr);
            if (!existing) existing = FindWindowW(L"PECAppNativeMainWnd", nullptr);
            if (existing) break;
            Sleep(50);
        }
        if (existing) {
            PB_WriteAppLog("Single instance: existing window %p found. Bringing to foreground and exiting.", existing);
            ShowWindow(existing, SW_RESTORE);
            SetForegroundWindow(existing);
            if (g_hSingleInstanceMutex) { CloseHandle(g_hSingleInstanceMutex); g_hSingleInstanceMutex = nullptr; }
            return 0;
        }
        PB_WriteAppLog("[WARN] Single instance mutex held, but no active window found.");
        if (!isElevatedChild) {
            MessageBoxW(NULL,
                L"Другой экземпляр PEC-App уже запущен или завершает работу.\nЕсли окно программы не отображается, проверьте Диспетчер задач.",
                APP_TITLE_W, MB_OK | MB_ICONWARNING);
            if (g_hSingleInstanceMutex) { CloseHandle(g_hSingleInstanceMutex); g_hSingleInstanceMutex = nullptr; }
            return 0;
        }
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
    InitializeCriticalSection(&g_latencyCs);
    PB_SetAppLogUiCallback(OnAppLogUiBridge);

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
        wchar_t appdataProfile[MAX_PATH];
        appdataPath[0] = 0;
        appdataProfile[0] = 0;
        if (GetEnvironmentVariableW(L"APPDATA", appdata, MAX_PATH)) {
            _snwprintf_s(appdataPath, MAX_PATH, _TRUNCATE, L"%s\\PEC-App\\profiles\\Default.pbprofile", appdata);
            _snwprintf_s(appdataProfile, MAX_PATH, _TRUNCATE, L"%s\\PEC-App\\profiles\\pec_profile.pbprofile", appdata);
        }

        bool shouldLoadCand = false;
        WIN32_FILE_ATTRIBUTE_DATA candAttr, appdataAttr;
        bool candExists = (GetFileAttributesExW(cand, GetFileExInfoStandard, &candAttr) != 0);
        bool appdataExists = (appdataPath[0] && GetFileAttributesExW(appdataPath, GetFileExInfoStandard, &appdataAttr) != 0);
        if (!appdataExists && appdataProfile[0] && GetFileAttributesExW(appdataProfile, GetFileExInfoStandard, &appdataAttr) != 0) {
            appdataExists = true;
            lstrcpyW(appdataPath, appdataProfile);
        }

        if (candExists) {
            if (!appdataExists || (g_profile.cfgCount == 0 && g_profile.ruleCount == 0)) {
                shouldLoadCand = true;
            } else {
                // If candidate profile sitting next to binary has different theme, server, or newer timestamp, adopt it
                PBProfile* pCandProf = (PBProfile*)calloc(1, sizeof(PBProfile));
                if (pCandProf) {
                    PB_ProfileLoad(cand, pCandProf);
                    if ((pCandProf->theme.hasTheme && (
                            !g_profile.theme.hasTheme ||
                            wcscmp(pCandProf->theme.preset, g_profile.theme.preset) != 0 ||
                            wcscmp(pCandProf->theme.mode, g_profile.theme.mode) != 0 ||
                            pCandProf->theme.primary != g_profile.theme.primary ||
                            pCandProf->theme.background != g_profile.theme.background)) ||
                        (pCandProf->pecSync.serverUrl[0] != 0 && wcscmp(pCandProf->pecSync.serverUrl, g_profile.pecSync.serverUrl) != 0) ||
                        (CompareFileTime(&candAttr.ftLastWriteTime, &appdataAttr.ftLastWriteTime) > 0)) {
                        shouldLoadCand = true;
                    }
                    free(pCandProf);
                }
            }
        }

        if (shouldLoadCand) {
            PB_ProfileLoad(cand, &g_profile);
            lstrcpynW(g_activeProfile, L"Default", PB_NAME_MAX);
            PB_SetActiveProfile(g_activeProfile);
            PB_ProfileSave(g_activeProfile, &g_profile);
            PB_ProfileSave(L"pec_profile", &g_profile);
        } else if (!appdataExists) {
            PB_ProfileDefaults(&g_profile, g_activeProfile);
        }

        // 1. Command line override: --server <url>
        const wchar_t* cmdLine = GetCommandLineW();
        if (cmdLine) {
            const wchar_t* srvArg = wcsstr(cmdLine, L"--server");
            if (!srvArg) srvArg = wcsstr(cmdLine, L"-server");
            if (srvArg) {
                srvArg += (srvArg[1] == L'-' ? 8 : 7);
                while (*srvArg == L' ' || *srvArg == L'=' || *srvArg == L'\"') srvArg++;
                wchar_t cliUrl[512] = { 0 };
                int ci = 0;
                while (*srvArg && *srvArg != L' ' && *srvArg != L'\"' && ci < 511) {
                    cliUrl[ci++] = *srvArg++;
                }
                cliUrl[ci] = 0;
                if (ci > 0) {
                    lstrcpynW(g_profile.pecSync.serverUrl, cliUrl, 512);
                    g_profile.pecSync.enabled = 1;
                    PB_ProfileSave(g_activeProfile, &g_profile);
                }
            }
        }

        // 2. Server URL Auto-Heal: Check candidate profile in application folder
        bool isLocalOrEmpty = (g_profile.pecSync.serverUrl[0] == 0 ||
                               wcscmp(g_profile.pecSync.serverUrl, L"http://127.0.0.1:3000") == 0);
        if (isLocalOrEmpty && candExists) {
            PBProfile* candProf = (PBProfile*)calloc(1, sizeof(PBProfile));
            if (candProf) {
                PB_ProfileLoad(cand, candProf);
                bool candHasUrl = (candProf->pecSync.serverUrl[0] != 0 &&
                                   wcscmp(candProf->pecSync.serverUrl, L"http://127.0.0.1:3000") != 0 &&
                                   (wcsncmp(candProf->pecSync.serverUrl, L"https://", 8) == 0 ||
                                    wcsncmp(candProf->pecSync.serverUrl, L"http://", 7) == 0));
                if (candHasUrl) {
                    lstrcpynW(g_profile.pecSync.serverUrl, candProf->pecSync.serverUrl, 512);
                    lstrcpynW(g_profile.pecSync.fleetToken, candProf->pecSync.fleetToken, 256);
                    g_profile.pecSync.intervalMinutes = candProf->pecSync.intervalMinutes;
                    g_profile.pecSync.enabled = 1;
                    if (candProf->theme.hasTheme) {
                        g_profile.theme = candProf->theme;
                    }
                    PB_ProfileSave(g_activeProfile, &g_profile);
                }
                free(candProf);
            }
        }

        // 3. Registry Fallback: MSI / GPO writes to HKLM\Software\PEC-App
        isLocalOrEmpty = (g_profile.pecSync.serverUrl[0] == 0 ||
                          wcscmp(g_profile.pecSync.serverUrl, L"http://127.0.0.1:3000") == 0);
        if (isLocalOrEmpty) {
            HKEY hReg = NULL;
            if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"Software\\PEC-App", 0, KEY_READ, &hReg) == ERROR_SUCCESS ||
                RegOpenKeyExW(HKEY_CURRENT_USER, L"Software\\PEC-App", 0, KEY_READ, &hReg) == ERROR_SUCCESS) {
                wchar_t regUrl[512] = { 0 };
                DWORD regUrlSize = sizeof(regUrl);
                if (RegQueryValueExW(hReg, L"ServerUrl", NULL, NULL, (LPBYTE)regUrl, &regUrlSize) == ERROR_SUCCESS && regUrl[0] != 0) {
                    lstrcpynW(g_profile.pecSync.serverUrl, regUrl, 512);
                    wchar_t regTok[256] = { 0 };
                    DWORD regTokSize = sizeof(regTok);
                    if (RegQueryValueExW(hReg, L"FleetToken", NULL, NULL, (LPBYTE)regTok, &regTokSize) == ERROR_SUCCESS && regTok[0] != 0) {
                        lstrcpynW(g_profile.pecSync.fleetToken, regTok, 256);
                    }
                    g_profile.pecSync.enabled = 1;
                    PB_ProfileSave(g_activeProfile, &g_profile);
                }
                RegCloseKey(hReg);
            }
        }

        // 4. Primary Bootstrap Data (clean first run without dummy example.com errors, WIN-09)
#if defined(PEC_DEFAULT_SERVER_URL_W)
        isLocalOrEmpty = (g_profile.pecSync.serverUrl[0] == 0);
        if (isLocalOrEmpty && PEC_DEFAULT_SERVER_URL_W[0] != 0 &&
            wcsstr(PEC_DEFAULT_SERVER_URL_W, L"example.com") == nullptr &&
            wcscmp(PEC_DEFAULT_SERVER_URL_W, L"http://127.0.0.1:3000") != 0) {
            lstrcpynW(g_profile.pecSync.serverUrl, PEC_DEFAULT_SERVER_URL_W, 512);
#if defined(PEC_DEFAULT_FLEET_TOKEN_W)
            if (wcsstr(PEC_DEFAULT_FLEET_TOKEN_W, L"test-admin-token") == nullptr) {
                lstrcpynW(g_profile.pecSync.fleetToken, PEC_DEFAULT_FLEET_TOKEN_W, 256);
            }
#endif
            g_profile.pecSync.intervalMinutes = 15;
            g_profile.pecSync.enabled = 1;
            PB_ProfileSave(g_activeProfile, &g_profile);
        }
#endif

        g_connLogging = g_profile.trafficLogging != 0;
        g_closeToTray = g_profile.closeToTray != 0;

        // Initialize UI language with strict profile priority (WIN-05)
        LANGID lid = PRIMARYLANGID(GetUserDefaultUILanguage());
        if (_wcsicmp(g_profile.language, L"zh") == 0) g_lang = 2;
        else if (_wcsicmp(g_profile.language, L"en") == 0) g_lang = 1;
        else if (_wcsicmp(g_profile.language, L"ru") == 0) g_lang = 0;
        else {
            if (lid == LANG_CHINESE) g_lang = 2;
            else if (lid == LANG_RUSSIAN || lid == LANG_BELARUSIAN || lid == LANG_UKRAINIAN) g_lang = 0;
            else g_lang = 1;
        }
        InitLocU8();
    }

    // Connect to engine (service IPC or elevated portable mode)
    if (!ConnectEngine()) {
        g_connBuffer.Destroy();
        DeleteCriticalSection(&g_logCs);
        DeleteCriticalSection(&g_profileCs);
        DeleteCriticalSection(&g_latencyCs);
        WSACleanup();
        if (g_hSingleInstanceMutex) { CloseHandle(g_hSingleInstanceMutex); g_hSingleInstanceMutex = nullptr; }
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

    PB_WriteAppLog("=== PEC-App ImGui GUI engine initialized (ActiveProfile: %ls) ===", g_activeProfile);

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

    // Initial window dimensions (restored from profile/registry or 1040x680 default, WIN-11)
    int winW = 1040;
    int winH = 680;
    int posX = (GetSystemMetrics(SM_CXSCREEN) - winW) / 2;
    int posY = (GetSystemMetrics(SM_CYSCREEN) - winH) / 2;
    if (!LoadWindowGeometry(posX, posY, winW, winH)) {
        RECT wa;
        if (SystemParametersInfoW(SPI_GETWORKAREA, 0, &wa, 0)) {
            int maxW = (wa.right - wa.left) * 9 / 10;
            int maxH = (wa.bottom - wa.top) * 9 / 10;
            if (winW > maxW) winW = maxW;
            if (winH > maxH) winH = maxH;
        }
    }

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
        if (g_hSingleInstanceMutex) { CloseHandle(g_hSingleInstanceMutex); g_hSingleInstanceMutex = nullptr; }
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
        DeleteCriticalSection(&g_latencyCs);
        WSACleanup();
        if (g_hSingleInstanceMutex) { CloseHandle(g_hSingleInstanceMutex); g_hSingleInstanceMutex = nullptr; }
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

    // Query DPI and apply High-DPI style and font scaling
    float dpiScale = 1.0f;
    HMODULE hUser32 = GetModuleHandleW(L"user32.dll");
    if (hUser32) {
        typedef UINT (WINAPI* PFN_GetDpiForWindow)(HWND);
        PFN_GetDpiForWindow pfnGetDpiForWindow = (PFN_GetDpiForWindow)GetProcAddress(hUser32, "GetDpiForWindow");
        if (pfnGetDpiForWindow) {
            UINT dpi = pfnGetDpiForWindow(g_hWnd);
            if (dpi > 0) dpiScale = (float)dpi / 96.0f;
        }
    }
    if (dpiScale <= 0.1f) dpiScale = 1.0f;

    g_dpiScale = dpiScale;
    g_baseDpiScale = dpiScale;
    ImGuiStyle& style = ImGui::GetStyle();
    style.ScaleAllSizes(dpiScale);
    float baseFontSize = 16.0f * dpiScale;

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
        0x4E00, 0x9FFF, // CJK Unified Ideographs (Chinese/Japanese/Korean)
        0
    };

    ImFontGlyphRangesBuilder builder;
    builder.AddRanges(io.Fonts->GetGlyphRangesDefault());
    builder.AddRanges(io.Fonts->GetGlyphRangesCyrillic());
    builder.AddRanges(io.Fonts->GetGlyphRangesChineseSimplifiedCommon());
    builder.AddRanges(extraGlyphs);
    builder.AddText(u8"●⏸▲▼🔀📡📋🛡📂⚙✓✗✏✎🔄");
    ImVector<ImWchar> glyphRanges;
    builder.BuildRanges(&glyphRanges);

    ImFontConfig fontCfg;
    fontCfg.OversampleH = 2;
    fontCfg.OversampleV = 2;

    if (GetFileAttributesA(fontPath) != INVALID_FILE_ATTRIBUTES) {
        io.Fonts->AddFontFromFileTTF(fontPath, baseFontSize, &fontCfg, glyphRanges.Data);
    } else {
        io.Fonts->AddFontDefault();
    }

    // Merge Microsoft YaHei for Chinese CJK glyphs
    char yaheiPath[MAX_PATH];
    snprintf(yaheiPath, sizeof(yaheiPath), "%s\\Fonts\\msyh.ttc", winDir);
    if (GetFileAttributesA(yaheiPath) != INVALID_FILE_ATTRIBUTES) {
        ImFontConfig yaheiCfg;
        yaheiCfg.MergeMode = true;
        yaheiCfg.OversampleH = 1;
        yaheiCfg.OversampleV = 1;
        static const ImWchar cjkRanges[] = {
            0x4E00, 0x9FFF,
            0
        };
        io.Fonts->AddFontFromFileTTF(yaheiPath, baseFontSize, &yaheiCfg, cjkRanges);
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
        io.Fonts->AddFontFromFileTTF(symFontPath, baseFontSize, &symCfg, symRanges);
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

    PB_SetAppLogUiCallback(nullptr);
    g_connBuffer.Destroy();
    DeleteCriticalSection(&g_logCs);
    DeleteCriticalSection(&g_profileCs);
    DeleteCriticalSection(&g_latencyCs);
    WSACleanup();
    if (g_hSingleInstanceMutex) { CloseHandle(g_hSingleInstanceMutex); g_hSingleInstanceMutex = nullptr; }

    return 0;
}

#if defined(__GNUC__)
int WINAPI WinMain(HINSTANCE hInst, HINSTANCE hPrev, LPSTR lpCmdLine, int nShowCmd)
{
    (void)lpCmdLine;
    return wWinMain(hInst, hPrev, GetCommandLineW(), nShowCmd);
}
#endif
