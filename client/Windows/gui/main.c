// ProxyBridge GUI.
//
// Drives ProxyBridgeCore.dll and reads/writes %APPDATA%\ProxyBridge settings.json +
// *.pbprofile files.
//
// Threading: DLL log/connection callbacks fire on native threads; each formats a line and
// PostMessage()s a heap wide-string to the UI thread, which appends it and frees it.

#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif

#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <windowsx.h>
#include <tlhelp32.h>
#include <commctrl.h>
#include <commdlg.h>
#include <dwmapi.h>
#include <uxtheme.h>
#include <stdio.h>
#include <stdlib.h>
#include "res/resource.h"
#include "api/pb_api.h"
#include "api/pb_ipc.h"
#include "profile/profile.h"
#include "loc/loc.h"

#pragma comment(lib, "comctl32.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "comdlg32.lib")
#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "uxtheme.lib")

// dynamic theme
static COLORREF g_colBg      = RGB(0x0B, 0x11, 0x20);   // window / edit background (default Cyber Blue)
static COLORREF g_colPanel   = RGB(0x13, 0x1D, 0x36);   // panel / card background
static COLORREF g_colText    = RGB(0xD4, 0xD4, 0xD4);
static COLORREF g_colDim     = RGB(0x8A, 0x8A, 0x8A);
static COLORREF g_colTab     = RGB(0x1A, 0x24, 0x3F);   // inactive tab
static COLORREF g_colTabSel  = RGB(0x0B, 0x11, 0x20);   // active tab
static COLORREF g_colTabHot  = RGB(0x22, 0x32, 0x54);   // hovered tab
static COLORREF g_colAccent  = RGB(0x02, 0x84, 0xC7);   // primary accent
static COLORREF g_colMenu    = RGB(0x13, 0x1D, 0x36);
static COLORREF g_colMenuHot = RGB(0x1E, 0x2C, 0x4C);
static COLORREF g_colLine    = RGB(0x2E, 0x3B, 0x55);
#define C_WARN    RGB(0xD7, 0xA5, 0x22)   // amber hint for the UDP note

#define C_BG      g_colBg
#define C_PANEL   g_colPanel
#define C_TEXT    g_colText
#define C_DIM     g_colDim
#define C_TAB     g_colTab
#define C_TABSEL  g_colTabSel
#define C_TABHOT  g_colTabHot
#define C_ACCENT  g_colAccent
#define C_MENU    g_colMenu
#define C_MENUHOT g_colMenuHot
#define C_LINE    g_colLine

static HBRUSH g_brBg, g_brPanel, g_brTab, g_brTabSel, g_brTabHot, g_brAccent, g_brMenu, g_brMenuHot;
static int    g_tabHot = -1;   // hovered tab index (owner-draw)

// Undocumented immersive-menu messages (as used by Windows Terminal's dark-mode shim).
#define WM_UAHDRAWMENU     0x0091
#define WM_UAHDRAWMENUITEM 0x0092
typedef union { struct { DWORD cx, cy; } rgsizeBar[2]; struct { DWORD cx, cy; } rgsizePopup[4]; } UAHMENUITEMMETRICS;
typedef struct { DWORD rgcx[4]; DWORD fUpdateMaxWidths : 2; } UAHMENUPOPUPMETRICS;
typedef struct { HMENU hmenu; HDC hdc; DWORD dwFlags; } UAHMENU;
typedef struct { int iPosition; UAHMENUITEMMETRICS umim; UAHMENUPOPUPMETRICS umpm; } UAHMENUITEM;
typedef struct { DRAWITEMSTRUCT dis; UAHMENU um; UAHMENUITEM umi; } UAHDRAWMENUITEM;

// uxtheme.dll dark-mode ordinals (1903+). Loaded dynamically.
typedef enum { APPMODE_DEFAULT, APPMODE_ALLOWDARK, APPMODE_FORCEDARK, APPMODE_FORCELIGHT, APPMODE_MAX } PreferredAppMode;
typedef PreferredAppMode (WINAPI *fnSetPreferredAppMode)(PreferredAppMode);
typedef BOOL (WINAPI *fnAllowDarkModeForWindow)(HWND, BOOL);
typedef void (WINAPI *fnFlushMenuThemes)(void);

#define WM_APP_LOG   (WM_APP + 1)
#define WM_APP_CONN  (WM_APP + 2)
#define WM_APP_TRAY  (WM_APP + 3)
#define WM_APP_TESTLINE (WM_APP + 4)   // proxy-checker worker -> one log line
#define WM_APP_TESTDONE (WM_APP + 5)   // proxy-checker worker -> testing finished
#define WM_APP_RELOAD_PROFILE (WM_APP + 9)

#define APP_TITLE     L"PEC-App"
#define WND_CLASS     L"PECAppNativeMainWnd"
#define MAX_LOG_CHARS 60000

// globals
static PBApi     g_api;
static HWND      g_hMain, g_hBanner, g_hTab, g_hConnLog, g_hActLog;
static HWND      g_hConnSearch, g_hConnClear, g_hConnLogs, g_hActSearch, g_hActClear, g_hActLogs;
static HWND      g_hRulesList, g_hRulesSearch, g_hRulesCount;
static HWND      g_hRulesAdd, g_hRulesEdit, g_hRulesDel, g_hRulesClone, g_hRulesUp, g_hRulesDown;
static HWND      g_hSrvList, g_hSrvActive, g_hSrvTest, g_hSrvAdd, g_hSrvEdit, g_hSrvDel;
static HFONT     g_hIcon;                 // Segoe MDL2 Assets glyph font for the menu-bar icons
static HFONT     g_hMenuFont;             // menu-bar font (owner-drawn top items => taller bar)
#define MENUBAR_EXTRA 12                  // extra height added to the menu row
#define IDC_CONN_SEARCH 3001
#define IDC_CONN_CLEAR  3002
#define IDC_ACT_SEARCH  3003
#define IDC_ACT_CLEAR   3004
#define IDC_CONN_LOGS   3005
#define IDC_ACT_LOGS    3006

// Per-log line store so the search box can filter without losing lines. New lines append to
// the edit only when they match the active filter; changing the filter re-renders from here.
#define LOG_MAX_LINES 4000
#define LOG_PEND_MAX  8000
typedef struct {
    HWND     edit;
    wchar_t* lines[LOG_MAX_LINES];
    int      count;
    wchar_t  filter[128];
    wchar_t* pend[LOG_PEND_MAX];   // queued by native callback threads, drained by the UI timer
    int      pendCount;
    CRITICAL_SECTION lock;
} LogStore;
static LogStore g_connStore, g_actStore;
#define TIMER_LOG 1                // batched log-flush timer
static int g_idleTicks = 0;        // consecutive idle flushes (for working-set trim)
static HFONT     g_hMono, g_hUi;

// Text scale. g_dpi is the system DPI (the app is system-DPI aware, so nothing is scaled for
// us); g_zoom is the user's extra text-size percentage (Settings > Text Size, Ctrl+wheel,
// Ctrl +/-/0). Fonts and the main-window layout metrics go through Sc() so the UI stays
// readable on high-DPI screens and can be enlarged on any screen.
static int g_dpi = 96, g_zoom = 100;
static int Sc(int px) { return MulDiv(px, g_dpi * g_zoom, 96 * 100); }
static HINSTANCE g_hInst;
static NOTIFYICONDATAW g_tray;
static BOOL      g_trayAdded = FALSE;
static UINT      g_wmTaskbarCreated = 0;   // shell broadcast when the taskbar reappear
static BOOL      g_reallyExit = FALSE;
static BOOL      g_started = FALSE;

static PBProfile g_profile;
static wchar_t   g_activeProfile[PB_NAME_MAX] = L"Default";
static BOOL      g_trafficLog = TRUE, g_closeToTray = TRUE;
static BOOL      g_proxyEnabled = TRUE;   // main switch; not saved: ProxyBridge always starts enabled
static BOOL      g_startup = FALSE;   // "Run at Startup" (schtasks logon task)
static BOOL      g_logEvery = FALSE;   // log every new connection (no de-duplication); saved per profile
static BOOL      g_proxiedOnly = FALSE; // show all connections by default (toggleable via settings menu)
static BOOL      g_autoClear = TRUE;  // auto-clear logs past a line threshold to save memory
#define AUTO_CLEAR_LINES 500
static PBFilter  g_flt[PB_MAX_FILTER];  // connection-log filter snapshot (read by native cb)
static int       g_fltCount = 0;

static wchar_t   g_profNames[64][PB_NAME_MAX];
static int       g_profCount = 0;
static wchar_t   g_nameResult[PB_NAME_MAX];
static HMENU     g_switchMenu = NULL;   // the Profile > Switch submenu (rebuilt on demand)

// small helpers
static void W2Ux(const wchar_t* w, char* out, int cch)
{
    if (cch <= 0) return;
    out[0] = 0;
    if (!WideCharToMultiByte(CP_UTF8, 0, w ? w : L"", -1, out, cch, NULL, NULL)) out[0] = 0;   // too small: empty, never unterminated
}

static wchar_t* U2Wdup(const char* s)
{
    if (!s) s = "";
    int n = MultiByteToWideChar(CP_UTF8, 0, s, -1, NULL, 0);
    wchar_t* w = (wchar_t*)malloc((size_t)n * sizeof(wchar_t));
    if (w) MultiByteToWideChar(CP_UTF8, 0, s, -1, w, n);
    return w;
}

static int ProtoIdx(const wchar_t* s)  { if (!_wcsicmp(s, L"UDP")) return 1; if (!_wcsicmp(s, L"BOTH")) return 2; return 0; }
static int ActionIdx(const wchar_t* s) { if (!_wcsicmp(s, L"DIRECT")) return 1; if (!_wcsicmp(s, L"BLOCK")) return 2; return 0; }
static const wchar_t* ProtoName(int i)  { return i == 1 ? L"UDP" : i == 2 ? L"BOTH" : L"TCP"; }

// log panel + connection filters (split out)
#include "ui/logview.h"

// forward decls
static void ApplyProfileTheme(const PBTheme* t, HWND hwnd);
static void PecSyncNotifyConfigChange(void);
static void SaveActive(void);
static UINT32 ResolveNativeCfg(UINT32 storedId);
static void ApplyConfigs(void);
static void ApplyRules(void);
static void UnapplyProfile(void);
static void SwitchToProfile(const wchar_t* name);
static void RebuildProfileMenu(HWND hwnd);
static void UpdateTitle(void);
static void SyncMenuChecks(HWND hwnd);
static void BuildMainMenu(HWND hwnd);
static void ApplyZoom(HWND hwnd);
static void RelocalizeUI(HWND hwnd);
static UINT32 EngineAddRule(PBRule* r);
static void EngineEditRule(PBRule* r);
static void RefreshRulesList(HWND lv);
static void RefreshServerList(HWND lv);
INT_PTR CALLBACK ServersDlgProc(HWND, UINT, WPARAM, LPARAM);
INT_PTR CALLBACK ServerEditDlgProc(HWND, UINT, WPARAM, LPARAM);
INT_PTR CALLBACK RulesDlgProc(HWND, UINT, WPARAM, LPARAM);
INT_PTR CALLBACK RuleEditDlgProc(HWND, UINT, WPARAM, LPARAM);
INT_PTR CALLBACK FiltersDlgProc(HWND, UINT, WPARAM, LPARAM);
INT_PTR CALLBACK FilterEditDlgProc(HWND, UINT, WPARAM, LPARAM);
INT_PTR CALLBACK NameDlgProc(HWND, UINT, WPARAM, LPARAM);
INT_PTR CALLBACK AboutDlgProc(HWND, UINT, WPARAM, LPARAM);

// DLL callbacks (native thread)
static void PBLogCb(const char* message)
{
    if (!g_hMain) return;
    wchar_t* body = U2Wdup(message);
    if (!body) return;
    wchar_t ts[16]; GetTimePrefix(ts, 16);
    size_t n = wcslen(ts) + wcslen(body) + 3;
    wchar_t* line = (wchar_t*)malloc(n * sizeof(wchar_t));
    if (line) { _snwprintf_s(line, n, _TRUNCATE, L"%s%s\r\n", ts, body); LogStoreQueue(&g_actStore, line); }
    free(body);
    PB_WriteAppLog("ENGINE: %s", message ? message : "");
}

static void PBConnCb(const char* proc, DWORD pid, const char* ip, unsigned short port, const char* info)
{
    if (!g_hMain || !g_trafficLog) return;

    BOOL isDirect = (info && _strnicmp(info, "Direct", 6) == 0);
    if (g_proxiedOnly && isDirect) return;

    // Filter OS background daemons going direct
    if (isDirect && proc)
    {
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

    wchar_t *wp = U2Wdup(proc), *wi = U2Wdup(ip), *wf = U2Wdup(info);
    // Connection-log filters: derive protocol/action from the proxy_info and drop non-matches.
    if (g_fltCount > 0)
    {
        wchar_t wport[16]; _snwprintf_s(wport, 16, _TRUNCATE, L"%u", port);
        const wchar_t* proto  = (info && strstr(info, "(UDP)")) ? L"UDP" : L"TCP";
        const wchar_t* action = (info && _strnicmp(info, "Direct", 6) == 0) ? L"Direct"
                              : (info && _strnicmp(info, "Block",  5) == 0) ? L"Blocked" : L"Proxy";
        if (!PassesLogFilters(wp ? wp : L"", wi ? wi : L"", wport, proto, action))
        { free(wp); free(wi); free(wf); return; }
    }
    wchar_t ts[16]; GetTimePrefix(ts, 16);
    size_t n = 64 + (wp ? wcslen(wp) : 0) + (wi ? wcslen(wi) : 0) + (wf ? wcslen(wf) : 0);
    wchar_t* line = (wchar_t*)malloc(n * sizeof(wchar_t));
    if (line)
    {
        _snwprintf_s(line, n, _TRUNCATE, L"%s%s (PID:%lu) -> %s:%u  via %s\r\n",
                   ts, wp ? wp : L"?", pid, wi ? wi : L"?", port, wf ? wf : L"?");
        LogStoreQueue(&g_connStore, line);
    }
    PB_WriteAppLog("CONN: %s [PID %lu] -> %s:%u (%s)", proc ? proc : "?", pid, ip ? ip : "?", port, info ? info : "Direct");
    free(wp); free(wi); free(wf);
}

// profile apply / persist
static void SaveActive(void) { PB_ProfileSave(g_activeProfile, &g_profile); }

static UINT32 ResolveNativeCfg(UINT32 storedId)
{
    for (int i = 0; i < g_profile.cfgCount; i++)
        if (g_profile.cfg[i].storedId == storedId) return g_profile.cfg[i].nativeId;
    return 0; // 0 => DLL uses first available config
}

static void ApplyConfigs(void)
{
    for (int i = 0; i < g_profile.cfgCount; i++)
    {
        PBConfig* c = &g_profile.cfg[i];
        int type = (_wcsicmp(c->type, L"HTTP") == 0) ? PB_PROXY_HTTP : PB_PROXY_SOCKS5;
        char h[256], u[256], p[256];
        W2Ux(c->host, h, sizeof(h)); W2Ux(c->user, u, sizeof(u)); W2Ux(c->pass, p, sizeof(p));
        c->nativeId = g_api.AddProxyConfig((PBProxyType)type, h, (unsigned short)_wtoi(c->port), u, p, c->sendDomain ? TRUE : FALSE);
        if (c->storedId == 0) c->storedId = PB_AllocConfigId(&g_profile);
    }
}

// The UTF-8 strings of one rule, in a single heap block (worst case 3 bytes per UTF-16 unit, so nothing is
// ever cut). The GUI keeps IPs and domain names in one list; the engine takes them as two.
typedef struct { char proc[PB_APPS_MAX * 3 + 4]; char ports[128 * 3 + 4]; char ips[PB_HOSTS_MAX * 3 + 4]; char doms[PB_HOSTS_MAX * 3 + 4]; } EngineStr;

static EngineStr* EngineStrings(const PBRule* r)
{
    EngineStr* s = (EngineStr*)malloc(sizeof(*s));
    size_t n = wcslen(r->hosts) + 2;
    wchar_t* wi = (wchar_t*)malloc(n * sizeof(wchar_t));
    wchar_t* wd = (wchar_t*)malloc(n * sizeof(wchar_t));
    if (!s || !wi || !wd) { free(s); free(wi); free(wd); return NULL; }
    PB_HostsSplit(r->hosts, wi, n, wd, n);
    W2Ux(r->proc, s->proc, sizeof(s->proc)); W2Ux(r->ports, s->ports, sizeof(s->ports));
    W2Ux(wi, s->ips, sizeof(s->ips)); W2Ux(wd, s->doms, sizeof(s->doms));
    free(wi); free(wd);
    return s;
}

static void ApplyRules(void)
{
    for (int i = 0; i < g_profile.ruleCount; i++)
    {
        PBRule* r = &g_profile.rule[i];
        EngineStr* s = EngineStrings(r);
        if (!s) continue;
        r->nativeId = g_api.AddRule(s->proc, s->ips, s->ports, s->doms,
                                    (PBRuleProtocol)ProtoIdx(r->proto), (PBRuleAction)ActionIdx(r->action),
                                    ResolveNativeCfg(r->cfgStoredId), r->localhost != 0);
        if (r->nativeId && !r->enabled) g_api.DisableRule(r->nativeId);
        free(s);
    }
}

// Add one rule to the engine, returning its (stable) native id. Enable state applied too.
static UINT32 EngineAddRule(PBRule* r)
{
    EngineStr* s = EngineStrings(r);
    if (!s) return 0;
    UINT32 id = g_api.AddRule(s->proc, s->ips, s->ports, s->doms,
                              (PBRuleProtocol)ProtoIdx(r->proto), (PBRuleAction)ActionIdx(r->action),
                              ResolveNativeCfg(r->cfgStoredId), r->localhost != 0);
    if (id && !r->enabled) g_api.DisableRule(id);
    free(s);
    return id;
}
// Edit an existing rule in place - keeps the same native id and list position.
static void EngineEditRule(PBRule* r)
{
    EngineStr* s = EngineStrings(r);
    if (!s) return;
    g_api.EditRule(r->nativeId, s->proc, s->ips, s->ports, s->doms,
                   (PBRuleProtocol)ProtoIdx(r->proto), (PBRuleAction)ActionIdx(r->action),
                   ResolveNativeCfg(r->cfgStoredId), r->localhost != 0);
    if (r->enabled) g_api.EnableRule(r->nativeId); else g_api.DisableRule(r->nativeId);
    free(s);
}

static void UnapplyProfile(void)
{
    for (int i = 0; i < g_profile.ruleCount; i++) if (g_profile.rule[i].nativeId) g_api.DeleteRule(g_profile.rule[i].nativeId);
    for (int i = 0; i < g_profile.cfgCount; i++) if (g_profile.cfg[i].nativeId) g_api.DeleteProxyConfig(g_profile.cfg[i].nativeId);
}

static void SwitchToProfile(const wchar_t* name)
{
    UnapplyProfile();
    PB_SetActiveProfile(name);
    lstrcpynW(g_activeProfile, name, PB_NAME_MAX);
    PB_ProfileLoad(name, &g_profile);
    ApplyProfileTheme(&g_profile.theme, g_hMain);
    PecSyncNotifyConfigChange();
    g_trafficLog = g_profile.trafficLogging;
    g_closeToTray = g_profile.closeToTray;
    g_autoClear = g_profile.autoClearLogs;
    g_logEvery = g_profile.logEveryConnection != 0;
    if (g_profile.fontZoom != g_zoom) { g_zoom = g_profile.fontZoom; ApplyZoom(g_hMain); }
    ApplyFilterSnapshot();
    g_api.SetTrafficLoggingEnabled(g_trafficLog);
    if (g_api.SetLogEveryConnection) g_api.SetLogEveryConnection(g_logEvery);
    ApplyConfigs();
    ApplyRules();
    SyncMenuChecks(g_hMain);
    RebuildProfileMenu(g_hMain);
    UpdateTitle();
    if (g_hRulesList) RefreshRulesList(g_hRulesList);
    if (g_hSrvList)   RefreshServerList(g_hSrvList);
    if (g_hBanner) InvalidateRect(g_hBanner, NULL, TRUE);
}

static void UpdateTitle(void)
{
    wchar_t t[256];
    if (g_profile.cfgCount > 0 && g_profile.cfg[0].host[0])
    {
        _snwprintf_s(t, 256, _TRUNCATE, L"%s - %s [%s: %s:%s]%s",
                     APP_TITLE, g_activeProfile,
                     g_profile.cfg[0].name[0] ? g_profile.cfg[0].name : g_profile.cfg[0].type,
                     g_profile.cfg[0].host, g_profile.cfg[0].port,
                     g_proxyEnabled ? L"" : T(S_TITLE_PAUSED));
    }
    else
    {
        _snwprintf_s(t, 256, _TRUNCATE, L"%s - %s%s", APP_TITLE, g_activeProfile, g_proxyEnabled ? L"" : T(S_TITLE_PAUSED));
    }
    SetWindowTextW(g_hMain, t);
    if (g_hBanner) InvalidateRect(g_hBanner, NULL, TRUE);
}

// Add an owner-drawn top-level menu item (so the menu row can be taller). The label pointer
// (a stable T() string) is kept as item data (for WM_DRAWITEM) and as the string (so Alt
// mnemonics still work).
static void AppendTopMenu(HMENU bar, HMENU sub, const wchar_t* label)
{
    MENUITEMINFOW mii; ZeroMemory(&mii, sizeof(mii)); mii.cbSize = sizeof(mii);
    mii.fMask = MIIM_FTYPE | MIIM_SUBMENU | MIIM_DATA | MIIM_STRING;
    mii.fType = MFT_OWNERDRAW;
    mii.hSubMenu = sub;
    mii.dwItemData = (ULONG_PTR)label;
    mii.dwTypeData = (LPWSTR)label;
    mii.cch = (UINT)lstrlenW(label);
    InsertMenuItemW(bar, GetMenuItemCount(bar), TRUE, &mii);
}

// Builds the whole menu bar from the string table so a language switch can rebuild it live.
static void BuildMainMenu(HWND hwnd)
{
    HMENU bar = CreateMenu();

    HMENU proxy = CreatePopupMenu();
    AppendMenuW(proxy, MF_STRING, IDM_PROXY_ENABLE,   T(S_M_ENABLE));       // main on/off switch
    AppendMenuW(proxy, MF_SEPARATOR, 0, NULL);
    if (g_profile.cfgCount > 1)
    {
        HMENU proxyNodes = CreatePopupMenu();
        for (int i = 0; i < (int)g_profile.cfgCount; i++)
        {
            wchar_t itemText[256];
            _snwprintf_s(itemText, 256, _TRUNCATE, L"%s (%s:%s)",
                g_profile.cfg[i].name[0] ? g_profile.cfg[i].name : g_profile.cfg[i].type,
                g_profile.cfg[i].host, g_profile.cfg[i].port);
            UINT flags = MF_STRING | ((i == 0) ? MF_CHECKED : MF_UNCHECKED);
            AppendMenuW(proxyNodes, flags, IDM_PROXY_NODE_BASE + i, itemText);
        }
        AppendMenuW(proxy, MF_POPUP, (UINT_PTR)proxyNodes, T(S_M_PROXY_SELECT));
        AppendMenuW(proxy, MF_SEPARATOR, 0, NULL);
    }
    AppendMenuW(proxy, MF_STRING, IDM_PROXY_SETTINGS, T(S_M_PROXY_SETTINGS));
    AppendMenuW(proxy, MF_STRING, IDM_PROXY_RULES,    T(S_M_PROXY_RULES));
    AppendMenuW(proxy, MF_STRING, IDM_LOG_FILTERS,    T(S_M_LOGFILTERS));
    AppendTopMenu(bar, proxy, T(S_M_PROXY));

    HMENU profile = CreatePopupMenu();
    AppendMenuW(profile, MF_STRING, IDM_PROFILE_NEW,    T(S_M_NEWPROFILE));
    AppendMenuW(profile, MF_STRING, IDM_PROFILE_RENAME, T(S_M_RENAME));
    AppendMenuW(profile, MF_STRING, IDM_PROFILE_DELETE, T(S_M_DELPROFILE));
    AppendMenuW(profile, MF_SEPARATOR, 0, NULL);
    AppendMenuW(profile, MF_STRING, IDM_PROFILE_IMPORT, T(S_M_IMPORT));
    AppendMenuW(profile, MF_STRING, IDM_PROFILE_EXPORT, T(S_M_EXPORT));
    AppendMenuW(profile, MF_SEPARATOR, 0, NULL);
    g_switchMenu = CreatePopupMenu();
    AppendMenuW(profile, MF_POPUP, (UINT_PTR)g_switchMenu, T(S_M_SWITCH));
    AppendTopMenu(bar, profile, T(S_M_PROFILE));

    HMENU settings = CreatePopupMenu();
    AppendMenuW(settings, MF_STRING, IDM_SET_TRAFFICLOG,  T(S_M_TRAFFIC));
    AppendMenuW(settings, MF_STRING | (g_proxiedOnly ? MF_CHECKED : MF_UNCHECKED), IDM_SET_PROXIED_ONLY, T(S_M_PROXIED_ONLY));
    AppendMenuW(settings, MF_STRING, IDM_SET_CLOSETOTRAY, T(S_M_TRAY));
    AppendMenuW(settings, MF_STRING, IDM_SET_STARTUP,     T(S_M_STARTUP));
    AppendMenuW(settings, MF_STRING, IDM_SET_AUTOCLEAR,   T(S_M_AUTOCLEAR));
    AppendMenuW(settings, MF_STRING, IDM_SET_LOGALL,      T(S_M_LOGALL));
    AppendMenuW(settings, MF_STRING, IDM_OPEN_LOGS,        T(S_M_OPEN_LOGS));
    AppendMenuW(settings, MF_SEPARATOR, 0, NULL);
    AppendMenuW(settings, MF_STRING, IDM_ZOOM_IN,    T(S_M_ZOOM_IN));
    AppendMenuW(settings, MF_STRING, IDM_ZOOM_OUT,   T(S_M_ZOOM_OUT));
    AppendMenuW(settings, MF_STRING, IDM_ZOOM_RESET, T(S_M_ZOOM_RESET));
    AppendMenuW(settings, MF_SEPARATOR, 0, NULL);
    HMENU lang = CreatePopupMenu();
    AppendMenuW(lang, MF_STRING, IDM_LANG_RU, T(S_M_LANG_RU));
    AppendMenuW(lang, MF_STRING, IDM_LANG_EN, T(S_M_LANG_EN));
    AppendMenuW(lang, MF_STRING, IDM_LANG_ZH, T(S_M_LANG_ZH));
    AppendMenuW(settings, MF_POPUP, (UINT_PTR)lang, T(S_M_LANG));
    AppendTopMenu(bar, settings, T(S_M_SETTINGS));

    HMENU help = CreatePopupMenu();
    AppendMenuW(help, MF_STRING, IDM_HELP_DOCS,   T(S_M_DOCS));
    AppendMenuW(help, MF_STRING, IDM_HELP_UPDATE, T(S_M_UPDATE));
    AppendMenuW(help, MF_SEPARATOR, 0, NULL);
    AppendMenuW(help, MF_STRING, IDM_HELP_ABOUT,  T(S_M_ABOUT));
    AppendTopMenu(bar, help, T(S_M_HELP));

    HMENU old = GetMenu(hwnd);
    SetMenu(hwnd, bar);
    if (old) DestroyMenu(old);
}

static void RebuildProfileMenu(HWND hwnd)
{
    if (!g_switchMenu) return;
    while (GetMenuItemCount(g_switchMenu) > 0) DeleteMenu(g_switchMenu, 0, MF_BYPOSITION);
    g_profCount = PB_ProfileList(g_profNames, 64);
    for (int i = 0; i < g_profCount; i++)
    {
        UINT flags = MF_STRING | (_wcsicmp(g_profNames[i], g_activeProfile) == 0 ? MF_CHECKED : 0);
        AppendMenuW(g_switchMenu, flags, (UINT_PTR)(IDM_PROFILE_SWITCH_BASE + i), g_profNames[i]);
    }
    if (g_profCount == 0) AppendMenuW(g_switchMenu, MF_STRING | MF_GRAYED, IDM_PROFILE_SWITCH_BASE, L"-");
    DrawMenuBar(hwnd);
}

// Rebuild everything that carries text after a language change.
static void RelocalizeUI(HWND hwnd)
{
    BuildMainMenu(hwnd);
    RebuildProfileMenu(hwnd);
    SyncMenuChecks(hwnd);
    TCITEMW ti; ti.mask = TCIF_TEXT;
    ti.pszText = (LPWSTR)T(S_TAB_RULES);   TabCtrl_SetItem(g_hTab, 0, &ti);
    ti.pszText = (LPWSTR)T(S_TAB_SERVERS); TabCtrl_SetItem(g_hTab, 1, &ti);
    ti.pszText = (LPWSTR)T(S_TAB_CONN);    TabCtrl_SetItem(g_hTab, 2, &ti);
    ti.pszText = (LPWSTR)T(S_TAB_ACT);     TabCtrl_SetItem(g_hTab, 3, &ti);

    if (g_hRulesAdd) {
        SetWindowTextW(g_hRulesAdd,   T(S_BTN_ADDDOTS));
        SetWindowTextW(g_hRulesEdit,  T(S_BTN_EDITDOTS));
        SetWindowTextW(g_hRulesDel,   T(S_BTN_REMOVE));
        SetWindowTextW(g_hRulesClone, T(S_BTN_CLONE));
        SetWindowTextW(g_hRulesUp,    T(S_BTN_UP));
        SetWindowTextW(g_hRulesDown,  T(S_BTN_DOWN));
        SendMessageW(g_hRulesSearch,  EM_SETCUEBANNER, TRUE, (LPARAM)T(S_RULES_SEARCH));
    }
    if (g_hSrvActive) {
        SetWindowTextW(g_hSrvActive, T(S_BTN_SETACTIVE));
        SetWindowTextW(g_hSrvTest,   T(S_BTN_TEST));
        SetWindowTextW(g_hSrvAdd,    T(S_BTN_ADDDOTS));
        SetWindowTextW(g_hSrvEdit,   T(S_BTN_EDITDOTS));
        SetWindowTextW(g_hSrvDel,    T(S_BTN_REMOVE));
    }

    SetWindowTextW(g_hConnClear, T(S_BTN_CLEARLOGS));
    SetWindowTextW(g_hActClear,  T(S_BTN_CLEARLOGS));
    if (g_hConnLogs) SetWindowTextW(g_hConnLogs, T(S_BTN_LOGS));
    if (g_hActLogs)  SetWindowTextW(g_hActLogs,  T(S_BTN_LOGS));
    SendMessageW(g_hConnSearch, EM_SETCUEBANNER, TRUE, (LPARAM)T(S_SEARCH_CUE));
    SendMessageW(g_hActSearch,  EM_SETCUEBANNER, TRUE, (LPARAM)T(S_SEARCH_CUE));
    InvalidateRect(g_hTab, NULL, TRUE);
    UpdateTitle();
    DrawMenuBar(hwnd);
}

// single-instance + Run at Startup (split out)
#include "ui/startup.h"

// tray / layout / menu-checks
static void TrayAdd(HWND hwnd)
{
    ZeroMemory(&g_tray, sizeof(g_tray));
    g_tray.cbSize = sizeof(g_tray);
    g_tray.hWnd = hwnd; g_tray.uID = 1;
    g_tray.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
    g_tray.uCallbackMessage = WM_APP_TRAY;
    g_tray.hIcon = (HICON)LoadImageW(g_hInst, MAKEINTRESOURCEW(IDI_APPICON), IMAGE_ICON,
                                     GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), 0);
    lstrcpynW(g_tray.szTip, APP_TITLE, ARRAYSIZE(g_tray.szTip));
    // NIM_ADD fails if the shell's tray is not ready yet
    // broadcast re-adds the icon once the taskbar actually appears
    g_trayAdded = Shell_NotifyIconW(NIM_ADD, &g_tray);
}
static void TrayUpdateTip(void)
{
    if (!g_trayAdded) return;
    _snwprintf_s(g_tray.szTip, ARRAYSIZE(g_tray.szTip), _TRUNCATE, L"%s%s", APP_TITLE, g_proxyEnabled ? L"" : T(S_TITLE_PAUSED));
    g_tray.uFlags = NIF_TIP;
    Shell_NotifyIconW(NIM_MODIFY, &g_tray);
    g_tray.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
}
static void TrayShowBalloon(const wchar_t* title, const wchar_t* msg)
{
    if (!g_trayAdded) return;
    NOTIFYICONDATAW nid;
    ZeroMemory(&nid, sizeof(nid));
    nid.cbSize = sizeof(nid);
    nid.hWnd = g_tray.hWnd;
    nid.uID = g_tray.uID;
    nid.uFlags = NIF_INFO;
    nid.dwInfoFlags = NIIF_INFO;
    lstrcpynW(nid.szInfoTitle, title ? title : APP_TITLE, ARRAYSIZE(nid.szInfoTitle));
    lstrcpynW(nid.szInfo, msg ? msg : L"", ARRAYSIZE(nid.szInfo));
    Shell_NotifyIconW(NIM_MODIFY, &nid);
}
static void TrayRemove(void) { if (g_trayAdded) { Shell_NotifyIconW(NIM_DELETE, &g_tray); g_trayAdded = FALSE; } }
static void ShowMainWindow(HWND hwnd) { ShowWindow(hwnd, SW_SHOW); ShowWindow(hwnd, SW_RESTORE); SetForegroundWindow(hwnd); }

// Creates the three main-window fonts at the current DPI * zoom. Existing handles are left
// alone so the caller can swap them onto the controls first and delete the old ones after.
static void MakeFonts(void)
{
    g_hUi   = CreateFontW(-Sc(16), 0, 0, 0, FW_NORMAL, 0, 0, 0, DEFAULT_CHARSET,
                          OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
                          DEFAULT_PITCH | FF_DONTCARE, L"Segoe UI");
    g_hMono = CreateFontW(-Sc(16), 0, 0, 0, FW_NORMAL, 0, 0, 0, DEFAULT_CHARSET,
                          OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                          FIXED_PITCH | FF_MODERN, L"Consolas");
    g_hIcon = CreateFontW(-Sc(18), 0, 0, 0, FW_NORMAL, 0, 0, 0, DEFAULT_CHARSET,
                          OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
                          DEFAULT_PITCH | FF_DONTCARE, L"Segoe MDL2 Assets");
}

static void SelectTab(int idx);

static LRESULT CALLBACK BannerSubclass(HWND h, UINT m, WPARAM w, LPARAM l, UINT_PTR uId, DWORD_PTR dwRef)
{
    if (m == WM_ERASEBKGND) return 1;
    if (m == WM_SIZE)
    {
        InvalidateRect(h, NULL, TRUE);
        return 0;
    }
    if (m == WM_PAINT)
    {
        PAINTSTRUCT ps;
        HDC dc = BeginPaint(h, &ps);
        RECT rc; GetClientRect(h, &rc);
        if (rc.right <= 0 || rc.bottom <= 0) { EndPaint(h, &ps); return 0; }

        HDC memDC = CreateCompatibleDC(dc);
        HBITMAP memBM = CreateCompatibleBitmap(dc, rc.right, rc.bottom);
        HBITMAP oldBM = (HBITMAP)SelectObject(memDC, memBM);

        FillRect(memDC, &rc, g_brPanel ? g_brPanel : (HBRUSH)GetStockObject(BLACK_BRUSH));

        RECT btm = rc; btm.top = btm.bottom - 1;
        HBRUSH brLine = CreateSolidBrush(C_LINE);
        FillRect(memDC, &btm, brLine);
        DeleteObject(brLine);

        SetBkMode(memDC, TRANSPARENT);
        HFONT of = (HFONT)SelectObject(memDC, g_hUi);

        COLORREF dotColor = g_proxyEnabled ? ((g_profile.cfgCount > 0) ? RGB(0x10, 0xB9, 0x81) : RGB(0x94, 0xA3, 0xB8))
                                           : RGB(0xF5, 0x9E, 0x0B);
        HBRUSH brDot = CreateSolidBrush(dotColor);
        HBRUSH oldBr = (HBRUSH)SelectObject(memDC, brDot);
        HPEN oldPen = (HPEN)SelectObject(memDC, GetStockObject(NULL_PEN));
        int dotSize = Sc(8);
        int dotY = (rc.bottom - dotSize) / 2;
        Ellipse(memDC, Sc(12), dotY, Sc(12) + dotSize, dotY + dotSize);
        SelectObject(memDC, oldBr);
        SelectObject(memDC, oldPen);
        DeleteObject(brDot);

        const wchar_t* st = g_proxyEnabled ? ((g_profile.cfgCount > 0) ? T(S_STATUS_ACTIVE) : T(S_STATUS_DIRECT))
                                           : T(S_STATUS_PAUSED);
        SetTextColor(memDC, g_proxyEnabled ? ((g_profile.cfgCount > 0) ? RGB(0xF1, 0xF5, 0xF9) : RGB(0x94, 0xA3, 0xB8))
                                        : RGB(0xF5, 0x9E, 0x0B));
        RECT rText = { Sc(26), 0, Sc(240), rc.bottom };
        DrawTextW(memDC, st, -1, &rText, DT_LEFT | DT_VCENTER | DT_SINGLELINE);

        if (g_profile.cfgCount > 0 && g_profile.cfg[0].host[0])
        {
            wchar_t pill[128];
            _snwprintf_s(pill, 128, _TRUNCATE, L"🌐 %s (%s:%s)%s",
                         g_profile.cfg[0].name[0] ? g_profile.cfg[0].name : g_profile.cfg[0].type,
                         g_profile.cfg[0].host, g_profile.cfg[0].port,
                         (g_profile.cfgCount > 1) ? L" ▾" : L"");
            RECT rPill = { rc.right - Sc(380), Sc(3), rc.right - Sc(130), rc.bottom - Sc(3) };
            HBRUSH brPill = CreateSolidBrush(C_MENUHOT);
            FillRect(memDC, &rPill, brPill);
            DeleteObject(brPill);
            FrameRect(memDC, &rPill, g_brAccent);
            SetTextColor(memDC, C_ACCENT);
            DrawTextW(memDC, pill, -1, &rPill, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
        }

        wchar_t rp[64];
        _snwprintf_s(rp, 64, _TRUNCATE, T(S_STATUS_RULES), g_profile.ruleCount);
        RECT rRules = { rc.right - Sc(120), Sc(3), rc.right - Sc(10), rc.bottom - Sc(3) };
        HBRUSH brRules = CreateSolidBrush(C_MENUHOT);
        FillRect(memDC, &rRules, brRules);
        DeleteObject(brRules);
        HBRUSH brL = CreateSolidBrush(C_LINE);
        FrameRect(memDC, &rRules, brL);
        DeleteObject(brL);
        SetTextColor(memDC, C_TEXT);
        DrawTextW(memDC, rp, -1, &rRules, DT_CENTER | DT_VCENTER | DT_SINGLELINE);

        SelectObject(memDC, of);

        BitBlt(dc, 0, 0, rc.right, rc.bottom, memDC, 0, 0, SRCCOPY);
        SelectObject(memDC, oldBM);
        DeleteObject(memBM);
        DeleteDC(memDC);

        EndPaint(h, &ps);
        return 0;
    }
    if (m == WM_LBUTTONDOWN)
    {
        RECT rc; GetClientRect(h, &rc);
        int x = GET_X_LPARAM(l);
        HWND mainHwnd = (HWND)dwRef;
        if (x >= rc.right - Sc(120))
        {
            if (g_hTab) { TabCtrl_SetCurSel(g_hTab, 0); SelectTab(0); }
            return 0;
        }
        else if (x >= rc.right - Sc(380))
        {
            if (g_hTab) { TabCtrl_SetCurSel(g_hTab, 1); SelectTab(1); }
            return 0;
        }
        else if (x <= Sc(240))
        {
            SendMessageW(mainHwnd, WM_COMMAND, IDM_PROXY_ENABLE, 0);
            return 0;
        }
    }
    if (m == WM_SETCURSOR)
    {
        SetCursor(LoadCursor(NULL, IDC_HAND));
        return TRUE;
    }
    return DefSubclassProc(h, m, w, l);
}

static void LayoutMain(HWND hwnd);
static void DrawMenuBar2(HWND hwnd);
static void SaveActive(void);

// Applies g_zoom: new fonts onto every control, relayout, then free the old fonts.
static void ApplyZoom(HWND hwnd)
{
    HFONT oUi = g_hUi, oMono = g_hMono, oIcon = g_hIcon;
    MakeFonts();
    SendMessageW(g_hTab,        WM_SETFONT, (WPARAM)g_hUi,   TRUE);
    SendMessageW(g_hConnLog,    WM_SETFONT, (WPARAM)g_hMono, TRUE);
    SendMessageW(g_hActLog,     WM_SETFONT, (WPARAM)g_hMono, TRUE);
    SendMessageW(g_hConnSearch, WM_SETFONT, (WPARAM)g_hUi,   TRUE);
    SendMessageW(g_hActSearch,  WM_SETFONT, (WPARAM)g_hUi,   TRUE);
    SendMessageW(g_hConnClear,  WM_SETFONT, (WPARAM)g_hUi,   TRUE);
    SendMessageW(g_hActClear,   WM_SETFONT, (WPARAM)g_hUi,   TRUE);
    if (oUi)   DeleteObject(oUi);
    if (oMono) DeleteObject(oMono);
    if (oIcon) DeleteObject(oIcon);
    LayoutMain(hwnd);
    InvalidateRect(hwnd, NULL, TRUE);
    RedrawWindow(hwnd, NULL, NULL, RDW_FRAME | RDW_INVALIDATE | RDW_ALLCHILDREN);
    DrawMenuBar2(hwnd);
}

// pct: absolute percentage, clamped to 60..300.
static void SetZoom(HWND hwnd, int pct)
{
    if (pct < 60) pct = 60;
    if (pct > 300) pct = 300;
    if (pct == g_zoom) return;
    g_zoom = pct;
    g_profile.fontZoom = pct;
    ApplyZoom(hwnd);
    SaveActive();
}

// Ctrl + mouse wheel / Ctrl + '+' '-' '0' on the log boxes and search fields.
static LRESULT CALLBACK ZoomSubclass(HWND h, UINT m, WPARAM w, LPARAM l, UINT_PTR id, DWORD_PTR ref)
{
    (void)id;
    HWND main = (HWND)ref;
    if (m == WM_MOUSEWHEEL && (GET_KEYSTATE_WPARAM(w) & MK_CONTROL))
    {
        int d = GET_WHEEL_DELTA_WPARAM(w);
        if (d != 0) SetZoom(main, g_zoom + (d > 0 ? 10 : -10));
        return 0;
    }
    if (m == WM_KEYDOWN && (GetKeyState(VK_CONTROL) & 0x8000))
    {
        if (w == VK_ADD || w == VK_OEM_PLUS)       { SetZoom(main, g_zoom + 10); return 0; }
        if (w == VK_SUBTRACT || w == VK_OEM_MINUS) { SetZoom(main, g_zoom - 10); return 0; }
        if (w == L'0' || w == VK_NUMPAD0)          { SetZoom(main, 100);         return 0; }
    }
    if (m == WM_SETCURSOR)
    {
        SetCursor(LoadCursor(NULL, IDC_HAND));
        return TRUE;
    }
    return DefSubclassProc(h, m, w, l);
}

static void SyncMenuChecks(HWND hwnd)
{
    HMENU m = GetMenu(hwnd);
    CheckMenuItem(m, IDM_PROXY_ENABLE,    MF_BYCOMMAND | (g_proxyEnabled ? MF_CHECKED : MF_UNCHECKED));
    CheckMenuItem(m, IDM_SET_TRAFFICLOG,  MF_BYCOMMAND | (g_trafficLog ? MF_CHECKED : MF_UNCHECKED));
    CheckMenuItem(m, IDM_SET_PROXIED_ONLY, MF_BYCOMMAND | (g_proxiedOnly ? MF_CHECKED : MF_UNCHECKED));
    CheckMenuItem(m, IDM_SET_CLOSETOTRAY, MF_BYCOMMAND | (g_closeToTray? MF_CHECKED : MF_UNCHECKED));
    CheckMenuItem(m, IDM_SET_STARTUP,     MF_BYCOMMAND | (g_startup    ? MF_CHECKED : MF_UNCHECKED));
    CheckMenuItem(m, IDM_SET_AUTOCLEAR,   MF_BYCOMMAND | (g_autoClear  ? MF_CHECKED : MF_UNCHECKED));
    CheckMenuItem(m, IDM_SET_LOGALL,      MF_BYCOMMAND | (g_logEvery   ? MF_CHECKED : MF_UNCHECKED));
    CheckMenuItem(m, IDM_LANG_RU, MF_BYCOMMAND | (g_lang == 0 ? MF_CHECKED : MF_UNCHECKED));
    CheckMenuItem(m, IDM_LANG_EN, MF_BYCOMMAND | (g_lang == 1 ? MF_CHECKED : MF_UNCHECKED));
    CheckMenuItem(m, IDM_LANG_ZH, MF_BYCOMMAND | (g_lang == 2 ? MF_CHECKED : MF_UNCHECKED));
}

// file dialogs
static BOOL PickFile(HWND owner, BOOL save, wchar_t* path, int cch)
{
    OPENFILENAMEW ofn; ZeroMemory(&ofn, sizeof(ofn));
    path[0] = 0;
    ofn.lStructSize = sizeof(ofn);
    ofn.hwndOwner = owner;
    ofn.lpstrFilter = L"PEC-App Profile (*.pbprofile)\0*.pbprofile\0All Files\0*.*\0";
    ofn.lpstrFile = path; ofn.nMaxFile = cch;
    ofn.lpstrDefExt = L"pbprofile";
    ofn.Flags = save ? (OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST)
                     : (OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST);
    return save ? GetSaveFileNameW(&ofn) : GetOpenFileNameW(&ofn);
}

// dark theme helpers (split out)
#include "ui/theme.h"
// update checker (split out)
#include "ui/update.h"
// background sync & extension loopback pairing (split out)
#include "ui/pec_sync.h"
// all dialogs (split out)
#include "ui/dialogs.h"

// --- Main Window Action Handlers for Rules and Servers ---
static void MainRuleAdd(HWND hwnd)
{
    if (g_profile.ruleCount >= PB_MAX_RULE) {
        MessageBoxW(hwnd, L"Rule limit reached.", APP_TITLE, MB_OK);
        return;
    }
    PBRule r; ZeroMemory(&r, sizeof(r));
    lstrcpynW(r.name, L"PEC-App Rule", 128);
    lstrcpynW(r.proc, L"*", 256);
    lstrcpynW(r.hosts, L"*", PB_HOSTS_MAX);
    lstrcpynW(r.ports, L"*", 128);
    lstrcpynW(r.proto, L"BOTH", 8);
    lstrcpynW(r.action, L"PROXY", 16);
    r.cfgStoredId = (g_profile.cfgCount > 0) ? g_profile.cfg[0].storedId : 0;
    r.enabled = 1;
    if (DialogBoxParamW(g_hInst, MAKEINTRESOURCEW(IDD_RULE), hwnd, RuleEditDlgProc, (LPARAM)&r) == 1)
    {
        UINT32 id = EngineAddRule(&r);
        if (id)
        {
            r.nativeId = id;
            g_profile.rule[g_profile.ruleCount++] = r;
            SaveActive();
            if (g_rlWordN > 0 && !RuleMatchesFilter(&r)) SetWindowTextW(g_hRulesSearch, L"");
            RefreshRulesList(g_hRulesList);
            SelectRuleIndex(g_hRulesList, g_profile.ruleCount - 1);
            if (g_hBanner) InvalidateRect(g_hBanner, NULL, TRUE);
        }
        else MessageBoxW(hwnd, T(S_ERR_ADDRULE), APP_TITLE, MB_OK | MB_ICONERROR);
    }
}

static void MainRuleEdit(HWND hwnd)
{
    int sel = SelectedRuleIndex(g_hRulesList);
    if (sel < 0 || sel >= g_profile.ruleCount) return;
    PBRule r = g_profile.rule[sel];
    if (DialogBoxParamW(g_hInst, MAKEINTRESOURCEW(IDD_RULE), hwnd, RuleEditDlgProc, (LPARAM)&r) == 1)
    {
        r.nativeId = g_profile.rule[sel].nativeId;
        g_profile.rule[sel] = r;
        EngineEditRule(&g_profile.rule[sel]);
        SaveActive();
        RefreshRulesList(g_hRulesList);
        SelectRuleIndex(g_hRulesList, sel);
        if (g_hBanner) InvalidateRect(g_hBanner, NULL, TRUE);
    }
}

static void MainRuleDelete(HWND hwnd)
{
    (void)hwnd;
    int sel = SelectedRuleIndex(g_hRulesList);
    if (sel < 0 || sel >= g_profile.ruleCount) return;
    if (g_profile.rule[sel].nativeId) g_api.DeleteRule(g_profile.rule[sel].nativeId);
    for (int i = sel; i < g_profile.ruleCount - 1; i++) g_profile.rule[i] = g_profile.rule[i + 1];
    g_profile.ruleCount--;
    SaveActive();
    RefreshRulesList(g_hRulesList);
    if (g_hBanner) InvalidateRect(g_hBanner, NULL, TRUE);
}

static void MainRuleClone(HWND hwnd)
{
    (void)hwnd;
    int sel = SelectedRuleIndex(g_hRulesList);
    if (sel < 0 || sel >= g_profile.ruleCount || g_profile.ruleCount >= PB_MAX_RULE) return;
    PBRule cl = g_profile.rule[sel];
    cl.nativeId = 0;
    if (cl.name[0]) {
        wchar_t copyName[128];
        _snwprintf_s(copyName, 128, _TRUNCATE, L"%s (Copy)", cl.name);
        lstrcpynW(cl.name, copyName, PB_NAME_MAX);
    }
    UINT32 id = EngineAddRule(&cl);
    if (id)
    {
        cl.nativeId = id;
        int at = g_profile.ruleCount++;
        g_profile.rule[at] = cl;
        SaveActive();
        RefreshRulesList(g_hRulesList);
        SelectRuleIndex(g_hRulesList, at);
        if (g_hBanner) InvalidateRect(g_hBanner, NULL, TRUE);
    }
}

static void MainRuleMove(int dir)
{
    int sel = SelectedRuleIndex(g_hRulesList);
    if (sel < 0) return;
    int target = sel + dir;
    if (target < 0 || target >= g_profile.ruleCount) return;
    SwapRules(g_hRulesList, sel, target);
}

static void MainServerSetActive(void)
{
    int sel = ListView_GetNextItem(g_hSrvList, -1, LVNI_SELECTED);
    if (sel <= 0 || sel >= g_profile.cfgCount) return;

    UINT32 oldPrimaryStoredId = g_profile.cfg[0].storedId;
    UINT32 newPrimaryStoredId = g_profile.cfg[sel].storedId;

    PBConfig tmp = g_profile.cfg[0];
    g_profile.cfg[0] = g_profile.cfg[sel];
    g_profile.cfg[sel] = tmp;

    // Repoint default/primary rules to the new primary config ID
    for (int i = 0; i < g_profile.ruleCount; i++)
    {
        if (g_profile.rule[i].cfgStoredId == oldPrimaryStoredId || g_profile.rule[i].cfgStoredId == 0)
        {
            if (_wcsicmp(g_profile.rule[i].action, L"PROXY") == 0)
            {
                g_profile.rule[i].cfgStoredId = newPrimaryStoredId;
            }
        }
    }

    // Save and notify sync client
    PecSyncSetSelectedProxy(g_profile.cfg[0].host, _wtoi(g_profile.cfg[0].port));
    PB_WriteAppLog("User switched primary proxy to [%ws] %ws:%ws",
        g_profile.cfg[0].name, g_profile.cfg[0].host, g_profile.cfg[0].port);

    PB_ProfileSave(g_activeProfile, &g_profile);
    SwitchToProfile(g_activeProfile);
    RefreshServerList(g_hSrvList);
    ListView_SetItemState(g_hSrvList, 0, LVIS_SELECTED | LVIS_FOCUSED, LVIS_SELECTED | LVIS_FOCUSED);
    if (g_hBanner) InvalidateRect(g_hBanner, NULL, TRUE);
}

static void MainServerTest(HWND hwnd)
{
    int sel = ListView_GetNextItem(g_hSrvList, -1, LVNI_SELECTED);
    if (sel < 0 || sel >= g_profile.cfgCount) sel = 0;
    if (g_profile.cfgCount == 0) return;
    DialogBoxParamW(g_hInst, MAKEINTRESOURCEW(IDD_CHECKER), hwnd, CheckerDlgProc,
                    (LPARAM)(UINT_PTR)g_profile.cfg[sel].nativeId);
}

static void MainServerAdd(HWND hwnd)
{
    if (g_profile.cfgCount >= PB_MAX_CFG) {
        MessageBoxW(hwnd, L"Config limit reached.", APP_TITLE, MB_OK);
        return;
    }
    PBConfig c; ZeroMemory(&c, sizeof(c));
    lstrcpynW(c.name, L"Corporate Proxy", 128);
    lstrcpynW(c.type, L"SOCKS5", 16);
    lstrcpynW(c.port, L"1080", 16);
    c.sendDomain = 1;
    if (DialogBoxParamW(g_hInst, MAKEINTRESOURCEW(IDD_SERVER), hwnd, ServerEditDlgProc, (LPARAM)&c) == 1)
    {
        char h[256], u[256], p[256];
        W2Ux(c.host, h, sizeof(h)); W2Ux(c.user, u, sizeof(u)); W2Ux(c.pass, p, sizeof(p));
        UINT32 id = g_api.AddProxyConfig((_wcsicmp(c.type, L"HTTP") == 0) ? PB_PROXY_HTTP : PB_PROXY_SOCKS5,
                                         h, (unsigned short)_wtoi(c.port), u, p, c.sendDomain ? TRUE : FALSE);
        if (id > 0)
        {
            c.nativeId = id;
            c.storedId = PB_AllocConfigId(&g_profile);
            g_profile.cfg[g_profile.cfgCount++] = c;
            SaveActive();
            RefreshServerList(g_hSrvList);
            RefreshRulesList(g_hRulesList);
            BuildMainMenu(hwnd);
            UpdateTitle();
            if (g_hBanner) InvalidateRect(g_hBanner, NULL, TRUE);
        }
        else MessageBoxW(hwnd, T(S_ERR_ADDCFG), APP_TITLE, MB_OK | MB_ICONERROR);
    }
}

static void MainServerEdit(HWND hwnd)
{
    int sel = ListView_GetNextItem(g_hSrvList, -1, LVNI_SELECTED);
    if (sel < 0 || sel >= g_profile.cfgCount) return;
    PBConfig c = g_profile.cfg[sel];
    if (DialogBoxParamW(g_hInst, MAKEINTRESOURCEW(IDD_SERVER), hwnd, ServerEditDlgProc, (LPARAM)&c) == 1)
    {
        g_profile.cfg[sel] = c;
        char h[256], u[256], p[256];
        W2Ux(c.host, h, sizeof(h)); W2Ux(c.user, u, sizeof(u)); W2Ux(c.pass, p, sizeof(p));
        g_api.EditProxyConfig(c.nativeId, (_wcsicmp(c.type, L"HTTP") == 0) ? PB_PROXY_HTTP : PB_PROXY_SOCKS5,
                              h, (unsigned short)_wtoi(c.port), u, p, c.sendDomain ? TRUE : FALSE);
        SaveActive();
        RefreshServerList(g_hSrvList);
        RefreshRulesList(g_hRulesList);
        BuildMainMenu(hwnd);
        UpdateTitle();
        if (g_hBanner) InvalidateRect(g_hBanner, NULL, TRUE);
        ListView_SetItemState(g_hSrvList, sel, LVIS_SELECTED | LVIS_FOCUSED, LVIS_SELECTED | LVIS_FOCUSED);
    }
}

static void MainServerDelete(HWND hwnd)
{
    (void)hwnd;
    int sel = ListView_GetNextItem(g_hSrvList, -1, LVNI_SELECTED);
    if (sel < 0 || sel >= g_profile.cfgCount) return;
    g_api.DeleteProxyConfig(g_profile.cfg[sel].nativeId);
    for (int i = sel; i < g_profile.cfgCount - 1; i++) g_profile.cfg[i] = g_profile.cfg[i + 1];
    g_profile.cfgCount--;
    SaveActive();
    RefreshServerList(g_hSrvList);
    RefreshRulesList(g_hRulesList);
    BuildMainMenu(hwnd);
    UpdateTitle();
    if (g_hBanner) InvalidateRect(g_hBanner, NULL, TRUE);
}

static LRESULT CALLBACK DarkButtonSubProc(HWND h, UINT m, WPARAM w, LPARAM l, UINT_PTR id, DWORD_PTR ref)
{
    (void)id; (void)ref;
    switch (m)
    {
    case WM_ERASEBKGND:
        return 1;
    case WM_MOUSEMOVE:
    {
        if (!GetPropW(h, L"Hot"))
        {
            SetPropW(h, L"Hot", (HANDLE)1);
            InvalidateRect(h, NULL, FALSE);
            TRACKMOUSEEVENT tme = { sizeof(tme), TME_LEAVE, h, 0 };
            TrackMouseEvent(&tme);
        }
        break;
    }
    case WM_MOUSELEAVE:
    {
        RemovePropW(h, L"Hot");
        InvalidateRect(h, NULL, FALSE);
        break;
    }
    case WM_PAINT:
    {
        PAINTSTRUCT ps;
        HDC dc = BeginPaint(h, &ps);
        RECT rc; GetClientRect(h, &rc);

        BOOL pushed = (SendMessageW(h, BM_GETSTATE, 0, 0) & BST_PUSHED) != 0;
        BOOL hot = (GetPropW(h, L"Hot") != NULL);
        BOOL isPrimary = (h == g_hSrvActive || h == g_hRulesAdd);

        COLORREF bg, border, textCol;
        if (pushed)
        {
            bg = RGB(0x02, 0x84, 0xC7); // sky-600
            border = RGB(0x38, 0xBD, 0xF8); // sky-400
            textCol = RGB(0xFF, 0xFF, 0xFF);
        }
        else if (isPrimary)
        {
            bg = hot ? RGB(0x03, 0x69, 0xA1) : RGB(0x0F, 0x3A, 0x5D);
            border = hot ? RGB(0x38, 0xBD, 0xF8) : RGB(0x02, 0x84, 0xC7);
            textCol = RGB(0xFF, 0xFF, 0xFF);
        }
        else
        {
            bg = hot ? RGB(0x1E, 0x29, 0x3B) : RGB(0x13, 0x1D, 0x36);
            border = hot ? RGB(0x3B, 0x82, 0xF6) : RGB(0x2E, 0x3B, 0x55);
            textCol = hot ? RGB(0xF8, 0xFA, 0xFC) : RGB(0xCB, 0xD5, 0xE1);
        }

        HBRUSH br = CreateSolidBrush(bg);
        HPEN pen = CreatePen(PS_SOLID, 1, border);
        HBRUSH obr = (HBRUSH)SelectObject(dc, br);
        HPEN open = (HPEN)SelectObject(dc, pen);

        RoundRect(dc, rc.left, rc.top, rc.right - 1, rc.bottom - 1, Sc(6), Sc(6));

        SelectObject(dc, obr);
        SelectObject(dc, open);
        DeleteObject(br);
        DeleteObject(pen);

        wchar_t txt[128] = { 0 };
        GetWindowTextW(h, txt, 128);
        HFONT f = (HFONT)SendMessageW(h, WM_GETFONT, 0, 0);
        HFONT of = f ? (HFONT)SelectObject(dc, f) : NULL;
        SetBkMode(dc, TRANSPARENT);
        SetTextColor(dc, textCol);
        DrawTextW(dc, txt, -1, &rc, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
        if (of) SelectObject(dc, of);

        EndPaint(h, &ps);
        return 0;
    }
    }
    return DefSubclassProc(h, m, w, l);
}

static void LayoutMain(HWND hwnd)
{
    RECT rc; GetClientRect(hwnd, &rc);
    int bannerH = Sc(28);
    if (g_hBanner) {
        MoveWindow(g_hBanner, 0, 0, rc.right, bannerH, TRUE);
        InvalidateRect(g_hBanner, NULL, TRUE);
    }
    int tabTop = bannerH + Sc(4), tabH = Sc(32);
    MoveWindow(g_hTab, 0, tabTop, rc.right, tabH, TRUE);
    int top = tabTop + tabH + Sc(4);
    int barH = Sc(30);
    int logTop = top + barH + 4;
    int logH = rc.bottom - logTop - 4; if (logH < 0) logH = 0;

    // --- Tab 0: Rules layout ---
    int rBtnY = top - 1;
    int btnH = barH - 2;
    int curX = 4;
    MoveWindow(g_hRulesAdd,   curX, rBtnY, Sc(120), btnH, TRUE); curX += Sc(120) + Sc(4);
    MoveWindow(g_hRulesEdit,  curX, rBtnY, Sc(95),  btnH, TRUE); curX += Sc(95) + Sc(4);
    MoveWindow(g_hRulesDel,   curX, rBtnY, Sc(85),  btnH, TRUE); curX += Sc(85) + Sc(4);
    MoveWindow(g_hRulesClone, curX, rBtnY, Sc(110), btnH, TRUE); curX += Sc(110) + Sc(4);
    MoveWindow(g_hRulesUp,    curX, rBtnY, Sc(75),  btnH, TRUE); curX += Sc(75) + Sc(4);
    MoveWindow(g_hRulesDown,  curX, rBtnY, Sc(75),  btnH, TRUE); curX += Sc(75) + Sc(10);

    int countW = Sc(130);
    int searchW = rc.right - 4 - curX - countW - Sc(6);
    if (searchW < Sc(120)) searchW = Sc(120);
    MoveWindow(g_hRulesSearch, curX, top, searchW, barH - 6, TRUE);
    MoveWindow(g_hRulesCount,  curX + searchW + Sc(6), top + Sc(4), countW, barH - 8, TRUE);
    MoveWindow(g_hRulesList,   2, logTop, rc.right - 4, logH, TRUE);
    if (g_hRulesList && IsWindowVisible(g_hRulesList)) FillColumns(g_hRulesList, 8);

    // --- Tab 1: Proxies layout ---
    curX = 4;
    MoveWindow(g_hSrvActive, curX, rBtnY, Sc(160), btnH, TRUE); curX += Sc(160) + Sc(4);
    MoveWindow(g_hSrvTest,   curX, rBtnY, Sc(110), btnH, TRUE); curX += Sc(110) + Sc(4);
    MoveWindow(g_hSrvAdd,    curX, rBtnY, Sc(110), btnH, TRUE); curX += Sc(110) + Sc(4);
    MoveWindow(g_hSrvEdit,   curX, rBtnY, Sc(95),  btnH, TRUE); curX += Sc(95) + Sc(4);
    MoveWindow(g_hSrvDel,    curX, rBtnY, Sc(85),  btnH, TRUE);
    MoveWindow(g_hSrvList,   2, logTop, rc.right - 4, logH, TRUE);
    if (g_hSrvList && IsWindowVisible(g_hSrvList)) FillColumns(g_hSrvList, 5);

    // --- Tabs 2 & 3: Logs layout ---
    int logsW = Sc(90), clearW = Sc(120), gap = Sc(6);
    int logSearchW = rc.right - 4 - clearW - gap - logsW - gap - 4;
    if (logSearchW < Sc(100)) logSearchW = Sc(100);
    MoveWindow(g_hConnSearch, 4, top, logSearchW, barH - 6, TRUE);
    MoveWindow(g_hActSearch,  4, top, logSearchW, barH - 6, TRUE);
    MoveWindow(g_hConnClear,  4 + logSearchW + gap, top - 1, clearW, barH - 2, TRUE);
    MoveWindow(g_hActClear,   4 + logSearchW + gap, top - 1, clearW, barH - 2, TRUE);
    MoveWindow(g_hConnLogs,   4 + logSearchW + gap + clearW + gap, top - 1, logsW, barH - 2, TRUE);
    MoveWindow(g_hActLogs,    4 + logSearchW + gap + clearW + gap, top - 1, logsW, barH - 2, TRUE);
    MoveWindow(g_hConnLog, 2, logTop, rc.right - 4, logH, TRUE);
    MoveWindow(g_hActLog,  2, logTop, rc.right - 4, logH, TRUE);
    InvalidateRect(hwnd, NULL, TRUE);
}

static void SelectTab(int idx)
{
    int r = (idx == 0) ? SW_SHOW : SW_HIDE;
    int s = (idx == 1) ? SW_SHOW : SW_HIDE;
    int c = (idx == 2) ? SW_SHOW : SW_HIDE;
    int a = (idx == 3) ? SW_SHOW : SW_HIDE;

    ShowWindow(g_hRulesList,   r);
    ShowWindow(g_hRulesSearch, r);
    ShowWindow(g_hRulesCount,  r);
    ShowWindow(g_hRulesAdd,    r);
    ShowWindow(g_hRulesEdit,   r);
    ShowWindow(g_hRulesDel,    r);
    ShowWindow(g_hRulesClone,  r);
    ShowWindow(g_hRulesUp,     r);
    ShowWindow(g_hRulesDown,   r);
    if (r == SW_SHOW) {
        RefreshRulesList(g_hRulesList);
        FillColumns(g_hRulesList, 8);
    }

    ShowWindow(g_hSrvList,   s);
    ShowWindow(g_hSrvActive, s);
    ShowWindow(g_hSrvTest,   s);
    ShowWindow(g_hSrvAdd,    s);
    ShowWindow(g_hSrvEdit,   s);
    ShowWindow(g_hSrvDel,    s);
    if (s == SW_SHOW) {
        RefreshServerList(g_hSrvList);
        FillColumns(g_hSrvList, 5);
    }

    ShowWindow(g_hConnLog,    c);
    ShowWindow(g_hConnSearch, c);
    ShowWindow(g_hConnClear,  c);
    ShowWindow(g_hConnLogs,   c);

    ShowWindow(g_hActLog,     a);
    ShowWindow(g_hActSearch,  a);
    ShowWindow(g_hActClear,   a);
    ShowWindow(g_hActLogs,    a);
}

// Fully paints the (non-client, owner-drawn) menu bar dark: fills the bar, redraws each
// top-item label, and draws the two quick-access glyph icons right after the last item.
// Records the icon rects for hit-testing. Called on WM_NCPAINT / WM_NCACTIVATE / WM_SIZE.
static void DrawMenuBar2(HWND hwnd)
{
    if (!g_hMenuFont) return;
    HMENU bar = GetMenu(hwnd);
    MENUBARINFO mbi; mbi.cbSize = sizeof(mbi);
    if (!bar || !GetMenuBarInfo(hwnd, OBJID_MENU, 0, &mbi)) return;
    RECT wr; GetWindowRect(hwnd, &wr);
    RECT br = mbi.rcBar; OffsetRect(&br, -wr.left, -wr.top);
    int barH = br.bottom - br.top;
    if (barH <= 0) return;

    HDC dc = GetWindowDC(hwnd);
    FillRect(dc, &br, g_brMenu);                       // whole bar dark

    HFONT of = (HFONT)SelectObject(dc, g_hMenuFont);
    SetBkMode(dc, TRANSPARENT);
    int count = GetMenuItemCount(bar);
    int lastRight = br.left + 8;
    for (int i = 0; i < count; i++)
    {
        RECT ir; if (!GetMenuItemRect(hwnd, bar, i, &ir)) continue;
        OffsetRect(&ir, -wr.left, -wr.top);
        wchar_t txt[64] = {0};
        MENUITEMINFOW mii; mii.cbSize = sizeof(mii); mii.fMask = MIIM_STRING;
        mii.dwTypeData = txt; mii.cch = 64;
        GetMenuItemInfoW(bar, i, TRUE, &mii);
        SetTextColor(dc, C_TEXT);
        DrawTextW(dc, txt, -1, &ir, DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_HIDEPREFIX);
        if (ir.right > lastRight) lastRight = ir.right;
    }

    SelectObject(dc, of);
    ReleaseDC(hwnd, dc);
}

// main window proc
static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp)
{
    if (msg == g_wmTaskbarCreated && g_wmTaskbarCreated) { TrayAdd(hwnd); return 0; }

    switch (msg)
    {
    case WM_CREATE:
    {
        g_wmTaskbarCreated = RegisterWindowMessageW(L"TaskbarCreated");
        ChangeWindowMessageFilterEx(hwnd, g_wmTaskbarCreated, MSGFLT_ALLOW, NULL);
        MakeFonts();
        g_hBanner = CreateWindowExW(0, L"STATIC", NULL,
                                    WS_CHILD | WS_VISIBLE | SS_NOTIFY,
                                    0, 0, 0, 0, hwnd, (HMENU)IDC_STATUS_BANNER, g_hInst, NULL);
        SetWindowSubclass(g_hBanner, BannerSubclass, 9, (DWORD_PTR)hwnd);
        g_hTab = CreateWindowExW(0, WC_TABCONTROLW, NULL,
                                 WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS | TCS_OWNERDRAWFIXED,
                                 0, 0, 0, 0, hwnd, NULL, g_hInst, NULL);
        SendMessageW(g_hTab, WM_SETFONT, (WPARAM)g_hUi, TRUE);
        TCITEMW ti; ti.mask = TCIF_TEXT;
        ti.pszText = (LPWSTR)T(S_TAB_RULES);   TabCtrl_InsertItem(g_hTab, 0, &ti);
        ti.pszText = (LPWSTR)T(S_TAB_SERVERS); TabCtrl_InsertItem(g_hTab, 1, &ti);
        ti.pszText = (LPWSTR)T(S_TAB_CONN);    TabCtrl_InsertItem(g_hTab, 2, &ti);
        ti.pszText = (LPWSTR)T(S_TAB_ACT);     TabCtrl_InsertItem(g_hTab, 3, &ti);

        DWORD ss = WS_CHILD | ES_AUTOHSCROLL;
        DWORD bs = WS_CHILD | BS_PUSHBUTTON | WS_TABSTOP;

        // --- Tab 0: Rules controls ---
        g_hRulesList = CreateWindowExW(0, WC_LISTVIEWW, NULL,
                                      WS_CHILD | WS_VISIBLE | WS_BORDER | LVS_REPORT | LVS_SINGLESEL | LVS_SHOWSELALWAYS,
                                      0, 0, 0, 0, hwnd, (HMENU)IDC_MAIN_RULES_LIST, g_hInst, NULL);
        InitRulesList(g_hRulesList);
        SetWindowSubclass(g_hRulesList, RuleListProc, 5, 0);

        g_hRulesSearch = CreateWindowExW(0, L"EDIT", NULL, ss | WS_VISIBLE, 0, 0, 0, 0, hwnd, (HMENU)IDC_MAIN_RULES_SEARCH, g_hInst, NULL);
        SendMessageW(g_hRulesSearch, WM_SETFONT, (WPARAM)g_hUi, TRUE);
        SendMessageW(g_hRulesSearch, EM_SETCUEBANNER, TRUE, (LPARAM)T(S_RULES_SEARCH));
        SetWindowSubclass(g_hRulesSearch, RuleSearchProc, 4, 0);

        g_hRulesAdd   = CreateWindowExW(0, L"BUTTON", T(S_BTN_ADDDOTS),  bs | WS_VISIBLE, 0, 0, 0, 0, hwnd, (HMENU)IDC_MAIN_RULES_ADD,   g_hInst, NULL);
        g_hRulesEdit  = CreateWindowExW(0, L"BUTTON", T(S_BTN_EDITDOTS), bs | WS_VISIBLE, 0, 0, 0, 0, hwnd, (HMENU)IDC_MAIN_RULES_EDIT,  g_hInst, NULL);
        g_hRulesDel   = CreateWindowExW(0, L"BUTTON", T(S_BTN_REMOVE),   bs | WS_VISIBLE, 0, 0, 0, 0, hwnd, (HMENU)IDC_MAIN_RULES_DEL,   g_hInst, NULL);
        g_hRulesClone = CreateWindowExW(0, L"BUTTON", T(S_BTN_CLONE),    bs | WS_VISIBLE, 0, 0, 0, 0, hwnd, (HMENU)IDC_MAIN_RULES_CLONE, g_hInst, NULL);
        g_hRulesUp    = CreateWindowExW(0, L"BUTTON", T(S_BTN_UP),       bs | WS_VISIBLE, 0, 0, 0, 0, hwnd, (HMENU)IDC_MAIN_RULES_UP,    g_hInst, NULL);
        g_hRulesDown  = CreateWindowExW(0, L"BUTTON", T(S_BTN_DOWN),     bs | WS_VISIBLE, 0, 0, 0, 0, hwnd, (HMENU)IDC_MAIN_RULES_DOWN,  g_hInst, NULL);
        g_hRulesCount = CreateWindowExW(0, L"STATIC", L"", WS_CHILD | WS_VISIBLE | SS_LEFT | SS_CENTERIMAGE, 0, 0, 0, 0, hwnd, (HMENU)IDC_MAIN_RULES_COUNT, g_hInst, NULL);

        SendMessageW(g_hRulesAdd,   WM_SETFONT, (WPARAM)g_hUi, TRUE);
        SendMessageW(g_hRulesEdit,  WM_SETFONT, (WPARAM)g_hUi, TRUE);
        SendMessageW(g_hRulesDel,   WM_SETFONT, (WPARAM)g_hUi, TRUE);
        SendMessageW(g_hRulesClone, WM_SETFONT, (WPARAM)g_hUi, TRUE);
        SendMessageW(g_hRulesUp,    WM_SETFONT, (WPARAM)g_hUi, TRUE);
        SendMessageW(g_hRulesDown,  WM_SETFONT, (WPARAM)g_hUi, TRUE);
        SendMessageW(g_hRulesCount, WM_SETFONT, (WPARAM)g_hUi, TRUE);

        // --- Tab 1: Proxies controls ---
        g_hSrvList = CreateWindowExW(0, WC_LISTVIEWW, NULL,
                                    WS_CHILD | WS_BORDER | LVS_REPORT | LVS_SINGLESEL | LVS_SHOWSELALWAYS,
                                    0, 0, 0, 0, hwnd, (HMENU)IDC_MAIN_SRV_LIST, g_hInst, NULL);
        InitServerList(g_hSrvList);

        g_hSrvActive = CreateWindowExW(0, L"BUTTON", T(S_BTN_SETACTIVE), bs, 0, 0, 0, 0, hwnd, (HMENU)IDC_MAIN_SRV_ACTIVE, g_hInst, NULL);
        g_hSrvTest   = CreateWindowExW(0, L"BUTTON", T(S_BTN_TEST),      bs, 0, 0, 0, 0, hwnd, (HMENU)IDC_MAIN_SRV_TEST,   g_hInst, NULL);
        g_hSrvAdd    = CreateWindowExW(0, L"BUTTON", T(S_BTN_ADDDOTS),   bs, 0, 0, 0, 0, hwnd, (HMENU)IDC_MAIN_SRV_ADD,    g_hInst, NULL);
        g_hSrvEdit   = CreateWindowExW(0, L"BUTTON", T(S_BTN_EDITDOTS),  bs, 0, 0, 0, 0, hwnd, (HMENU)IDC_MAIN_SRV_EDIT,   g_hInst, NULL);
        g_hSrvDel    = CreateWindowExW(0, L"BUTTON", T(S_BTN_REMOVE),    bs, 0, 0, 0, 0, hwnd, (HMENU)IDC_MAIN_SRV_DEL,    g_hInst, NULL);

        SendMessageW(g_hSrvActive, WM_SETFONT, (WPARAM)g_hUi, TRUE);
        SendMessageW(g_hSrvTest,   WM_SETFONT, (WPARAM)g_hUi, TRUE);
        SendMessageW(g_hSrvAdd,    WM_SETFONT, (WPARAM)g_hUi, TRUE);
        SendMessageW(g_hSrvEdit,   WM_SETFONT, (WPARAM)g_hUi, TRUE);
        SendMessageW(g_hSrvDel,    WM_SETFONT, (WPARAM)g_hUi, TRUE);

        // --- Tabs 2 & 3: Logs controls ---
        DWORD es = WS_CHILD | ES_MULTILINE | ES_READONLY | ES_AUTOVSCROLL | WS_VSCROLL | WS_BORDER;
        g_hConnLog = CreateWindowExW(0, L"EDIT", NULL, es, 0, 0, 0, 0, hwnd, NULL, g_hInst, NULL);
        g_hActLog  = CreateWindowExW(0, L"EDIT", NULL, es, 0, 0, 0, 0, hwnd, NULL, g_hInst, NULL);
        SendMessageW(g_hConnLog, WM_SETFONT, (WPARAM)g_hMono, TRUE);
        SendMessageW(g_hActLog,  WM_SETFONT, (WPARAM)g_hMono, TRUE);
        SendMessageW(g_hConnLog, EM_SETLIMITTEXT, MAX_LOG_CHARS * 2, 0);
        SendMessageW(g_hActLog,  EM_SETLIMITTEXT, MAX_LOG_CHARS * 2, 0);

        g_hConnSearch = CreateWindowExW(0, L"EDIT", NULL, ss, 0,0,0,0, hwnd, (HMENU)IDC_CONN_SEARCH, g_hInst, NULL);
        g_hActSearch  = CreateWindowExW(0, L"EDIT", NULL, ss, 0,0,0,0, hwnd, (HMENU)IDC_ACT_SEARCH,  g_hInst, NULL);
        g_hConnClear  = CreateWindowExW(0, L"BUTTON", T(S_BTN_CLEARLOGS), bs, 0,0,0,0, hwnd, (HMENU)IDC_CONN_CLEAR, g_hInst, NULL);
        g_hActClear   = CreateWindowExW(0, L"BUTTON", T(S_BTN_CLEARLOGS), bs, 0,0,0,0, hwnd, (HMENU)IDC_ACT_CLEAR,  g_hInst, NULL);
        g_hConnLogs   = CreateWindowExW(0, L"BUTTON", T(S_BTN_LOGS),      bs, 0,0,0,0, hwnd, (HMENU)IDC_CONN_LOGS,  g_hInst, NULL);
        g_hActLogs    = CreateWindowExW(0, L"BUTTON", T(S_BTN_LOGS),      bs, 0,0,0,0, hwnd, (HMENU)IDC_ACT_LOGS,   g_hInst, NULL);
        SendMessageW(g_hConnSearch, WM_SETFONT, (WPARAM)g_hUi, TRUE);
        SendMessageW(g_hActSearch,  WM_SETFONT, (WPARAM)g_hUi, TRUE);
        SendMessageW(g_hConnClear,  WM_SETFONT, (WPARAM)g_hUi, TRUE);
        SendMessageW(g_hActClear,   WM_SETFONT, (WPARAM)g_hUi, TRUE);
        SendMessageW(g_hConnLogs,   WM_SETFONT, (WPARAM)g_hUi, TRUE);
        SendMessageW(g_hActLogs,    WM_SETFONT, (WPARAM)g_hUi, TRUE);
        SendMessageW(g_hConnSearch, EM_SETCUEBANNER, TRUE, (LPARAM)T(S_SEARCH_CUE));
        SendMessageW(g_hActSearch,  EM_SETCUEBANNER, TRUE, (LPARAM)T(S_SEARCH_CUE));
        SetWindowSubclass(g_hConnLog,    ZoomSubclass, 1, (DWORD_PTR)hwnd);
        SetWindowSubclass(g_hActLog,     ZoomSubclass, 1, (DWORD_PTR)hwnd);
        SetWindowSubclass(g_hConnSearch, ZoomSubclass, 1, (DWORD_PTR)hwnd);
        SetWindowSubclass(g_hActSearch,  ZoomSubclass, 1, (DWORD_PTR)hwnd);
        LogStoreInit(&g_connStore, g_hConnLog);
        LogStoreInit(&g_actStore,  g_hActLog);
        SetTimer(hwnd, TIMER_LOG, 200, NULL);   // batch log updates ~5x/sec

        NONCLIENTMETRICSW ncm; ncm.cbSize = sizeof(ncm);
        if (SystemParametersInfoW(SPI_GETNONCLIENTMETRICS, sizeof(ncm), &ncm, 0))
            g_hMenuFont = CreateFontIndirectW(&ncm.lfMenuFont);

        InitDarkMode(hwnd);
        SetWindowTheme(g_hConnLog, L"DarkMode_Explorer", NULL);
        SetWindowTheme(g_hActLog,  L"DarkMode_Explorer", NULL);
        SetWindowTheme(g_hTab,     L"DarkMode_Explorer", NULL);
        SetWindowSubclass(g_hTab, TabSubProc, 1, 0);

        HWND allBtns[] = {
            g_hRulesAdd, g_hRulesEdit, g_hRulesDel, g_hRulesClone, g_hRulesUp, g_hRulesDown,
            g_hSrvActive, g_hSrvTest, g_hSrvAdd, g_hSrvEdit, g_hSrvDel,
            g_hConnClear, g_hActClear, g_hConnLogs, g_hActLogs
        };
        for (int i = 0; i < (int)(sizeof(allBtns)/sizeof(allBtns[0])); i++) {
            if (allBtns[i]) SetWindowSubclass(allBtns[i], DarkButtonSubProc, 10, 0);
        }

        LayoutMain(hwnd);
        SelectTab(0);
        return 0;
    }
    case WM_SIZE:  LayoutMain(hwnd); DrawMenuBar2(hwnd); return 0;
    case WM_ERASEBKGND:
    {
        HDC dc = (HDC)wp;
        RECT rc; GetClientRect(hwnd, &rc);
        FillRect(dc, &rc, g_brBg);
        return 1;
    }
    case WM_PAINT:
    {
        PAINTSTRUCT ps;
        HDC dc = BeginPaint(hwnd, &ps);
        RECT rc; GetClientRect(hwnd, &rc);
        FillRect(dc, &ps.rcPaint, g_brBg);

        int bannerH = Sc(28);
        int tabTop = bannerH + Sc(4), tabH = Sc(32);
        int top = tabTop + tabH + Sc(4);
        int barH = Sc(30);

        RECT tbRc = { 0, top - 3, rc.right, top + barH + 3 };
        FillRect(dc, &tbRc, g_brPanel);

        HPEN pen = CreatePen(PS_SOLID, 1, g_colLine);
        HPEN op = (HPEN)SelectObject(dc, pen);
        MoveToEx(dc, 0, tbRc.top, NULL); LineTo(dc, rc.right, tbRc.top);
        MoveToEx(dc, 0, tbRc.bottom, NULL); LineTo(dc, rc.right, tbRc.bottom);
        SelectObject(dc, op);
        DeleteObject(pen);

        EndPaint(hwnd, &ps);
        return 0;
    }
    case WM_MOUSEWHEEL:
        if (GET_KEYSTATE_WPARAM(wp) & MK_CONTROL)
        {
            int d = GET_WHEEL_DELTA_WPARAM(wp);
            if (d != 0) SetZoom(hwnd, g_zoom + (d > 0 ? 10 : -10));
            return 0;
        }
        break;
    case WM_CTLCOLOREDIT:
    {
        HDC dc = (HDC)wp;
        SetTextColor(dc, RGB(0xF8, 0xFA, 0xFC));
        SetBkColor(dc, g_colPanel);
        return (LRESULT)g_brPanel;
    }
    case WM_CTLCOLORLISTBOX:
    case WM_CTLCOLORBTN:
    case WM_CTLCOLORSTATIC:
    {
        HDC dc = (HDC)wp;
        SetTextColor(dc, C_TEXT);
        SetBkColor(dc, C_BG);
        return (LRESULT)g_brBg;
    }
    case WM_MEASUREITEM:
    {
        MEASUREITEMSTRUCT* mis = (MEASUREITEMSTRUCT*)lp;
        if (mis->CtlType == ODT_MENU)
        {
            const wchar_t* s = (const wchar_t*)mis->itemData;
            wchar_t clean[64]; int j = 0;                 // measure visible text (drop '&')
            for (const wchar_t* p = s; p && *p && j < 63; p++) if (*p != L'&') clean[j++] = *p;
            clean[j] = 0;
            HDC dc = GetDC(hwnd);
            HFONT of = (HFONT)SelectObject(dc, g_hMenuFont ? g_hMenuFont : g_hUi);
            SIZE sz = {0}; GetTextExtentPoint32W(dc, clean, j, &sz);
            TEXTMETRICW tm; GetTextMetricsW(dc, &tm);
            SelectObject(dc, of); ReleaseDC(hwnd, dc);
            mis->itemWidth  = sz.cx + 16;                 // tight, normal-looking padding
            mis->itemHeight = tm.tmHeight + MENUBAR_EXTRA; // taller row
            return TRUE;
        }
        break;
    }
    case WM_DRAWITEM:
    {
        LPDRAWITEMSTRUCT d = (LPDRAWITEMSTRUCT)lp;
        if (d->CtlType == ODT_MENU)   // hover state while a top menu is highlighted
        {
            const wchar_t* txt = (const wchar_t*)d->itemData;
            BOOL hot = (d->itemState & (ODS_SELECTED | ODS_HOTLIGHT)) != 0;
            FillRect(d->hDC, &d->rcItem, hot ? g_brMenuHot : g_brMenu);
            SetBkMode(d->hDC, TRANSPARENT);
            SetTextColor(d->hDC, C_TEXT);
            HFONT of = (HFONT)SelectObject(d->hDC, g_hMenuFont ? g_hMenuFont : g_hUi);
            UINT f = DT_CENTER | DT_VCENTER | DT_SINGLELINE;
            if (d->itemState & ODS_NOACCEL) f |= DT_HIDEPREFIX;
            DrawTextW(d->hDC, txt ? txt : L"", -1, &d->rcItem, f);
            SelectObject(d->hDC, of);
            return TRUE;
        }
        if (d->CtlType == ODT_TAB || d->hwndItem == g_hTab)
        {
            BOOL sel = (d->itemState & ODS_SELECTED) != 0;
            BOOL hot = ((int)d->itemID == g_tabHot);
            FillRect(d->hDC, &d->rcItem, sel ? g_brTabSel : (hot ? g_brTabHot : g_brBg));
            if (sel)
            {
                RECT bar = d->rcItem; bar.top = bar.bottom - 3;
                FillRect(d->hDC, &bar, g_brAccent);
            }
            wchar_t txt[64] = {0};
            TCITEMW ti; ti.mask = TCIF_TEXT; ti.pszText = txt; ti.cchTextMax = 64;
            TabCtrl_GetItem(g_hTab, d->itemID, &ti);
            SetBkMode(d->hDC, TRANSPARENT);
            SetTextColor(d->hDC, sel ? C_TEXT : C_DIM);
            DrawTextW(d->hDC, txt, -1, &d->rcItem, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
            return TRUE;
        }
        return 0;
    }
    case WM_UAHDRAWMENU:
    {
        UAHMENU* pum = (UAHMENU*)lp;
        MENUBARINFO mbi; mbi.cbSize = sizeof(mbi);
        GetMenuBarInfo(hwnd, OBJID_MENU, 0, &mbi);
        RECT wr; GetWindowRect(hwnd, &wr);
        RECT r = mbi.rcBar; OffsetRect(&r, -wr.left, -wr.top);
        FillRect(pum->hdc, &r, g_brMenu);
        return TRUE;
    }
    case WM_UAHDRAWMENUITEM:
    {
        UAHDRAWMENUITEM* pmi = (UAHDRAWMENUITEM*)lp;
        wchar_t txt[128] = {0};
        MENUITEMINFOW mii; mii.cbSize = sizeof(mii);
        mii.fMask = MIIM_STRING; mii.dwTypeData = txt; mii.cch = 128;
        GetMenuItemInfoW(pmi->um.hmenu, (UINT)pmi->umi.iPosition, TRUE, &mii);
        BOOL hot = (pmi->dis.itemState & (ODS_HOTLIGHT | ODS_SELECTED)) != 0;
        FillRect(pmi->um.hdc, &pmi->dis.rcItem, hot ? g_brMenuHot : g_brMenu);
        SetBkMode(pmi->um.hdc, TRANSPARENT);
        SetTextColor(pmi->um.hdc,
                     (pmi->dis.itemState & (ODS_GRAYED | ODS_DISABLED)) ? C_DIM : C_TEXT);
        DrawTextW(pmi->um.hdc, txt, -1, &pmi->dis.rcItem, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
        return TRUE;
    }
    case WM_NCACTIVATE:
    case WM_NCPAINT:
    {
        LRESULT r = DefWindowProcW(hwnd, msg, wp, lp);
        PaintMenuBottomLine(hwnd);
        DrawMenuBar2(hwnd);
        return r;
    }
    case WM_NOTIFY:
    {
        LPNMHDR nh = (LPNMHDR)lp;
        if (nh->hwndFrom == g_hTab && nh->code == TCN_SELCHANGE)
        {
            SelectTab(TabCtrl_GetCurSel(g_hTab));
            return 0;
        }
        if (nh->idFrom == IDC_MAIN_RULES_LIST)
        {
            if (nh->code == NM_DBLCLK) { MainRuleEdit(hwnd); return 0; }
            if (nh->code == LVN_ITEMCHANGED && !g_rulesRefreshing)
            {
                NMLISTVIEW* nlv = (NMLISTVIEW*)lp;
                if ((nlv->uChanged & LVIF_STATE) && (nlv->uNewState & LVIS_STATEIMAGEMASK) &&
                    nlv->iItem >= 0 && nlv->iItem < g_rlMapN)
                {
                    int ri = g_rlMap[nlv->iItem];
                    BOOL checked = ListView_GetCheckState(g_hRulesList, nlv->iItem);
                    PBRule* r = &g_profile.rule[ri];
                    if ((BOOL)r->enabled != checked)
                    {
                        r->enabled = checked ? 1 : 0;
                        if (r->enabled) g_api.EnableRule(r->nativeId); else g_api.DisableRule(r->nativeId);
                        SaveActive();
                    }
                }
            }
            return 0;
        }
        if (nh->idFrom == IDC_MAIN_SRV_LIST)
        {
            if (nh->code == NM_DBLCLK) {
                int sel = ListView_GetNextItem(g_hSrvList, -1, LVNI_SELECTED);
                if (sel > 0) MainServerSetActive();
                else if (sel == 0) MainServerEdit(hwnd);
                return 0;
            }
            return 0;
        }
        return 0;
    }
    case WM_TIMER:
        if (wp == TIMER_LOG)
        {
            int processed = LogStoreFlush(&g_connStore) + LogStoreFlush(&g_actStore);
            // When traffic has been idle for a couple of seconds, hand freed pages back to the
            // OS so memory drops after a burst instead of staying pinned in the working set.
            if (processed == 0) { if (++g_idleTicks == 10) SetProcessWorkingSetSize(GetCurrentProcess(), (SIZE_T)-1, (SIZE_T)-1); }
            else g_idleTicks = 0;
        }
        return 0;
    case WM_APP_UPDATE:
    {
        UpdInfo* info = (UpdInfo*)lp;
        BOOL ok = (wp & 1) != 0, manual = (wp & 2) != 0;
        if (info)
        {
            if (ok && info->available)
            {
                wchar_t bmsg[128];
                _snwprintf_s(bmsg, 128, _TRUNCATE, L"Update available: PEC-App v%s", info->latest);
                TrayShowBalloon(APP_TITLE, bmsg);
                if (IsWindowVisible(hwnd))
                    DialogBoxParamW(g_hInst, MAKEINTRESOURCEW(IDD_UPDATE), hwnd, UpdateDlgProc, (LPARAM)info);
            }
            else if (manual)
                MessageBoxW(hwnd, ok ? T(S_UPD_LATEST) : T(S_UPD_ERR), T(S_UPD_TITLE), MB_OK | MB_ICONINFORMATION);
            free(info);
        }
        return 0;
    }
    case WM_APP_RELOAD_PROFILE:
        SwitchToProfile(g_activeProfile);
        return 0;
    case WM_APP_TRAY:
        if (LOWORD(lp) == WM_LBUTTONDBLCLK) ShowMainWindow(hwnd);
        else if (LOWORD(lp) == WM_RBUTTONUP)
        {
            POINT pt; GetCursorPos(&pt);
            HMENU pm = CreatePopupMenu();
            AppendMenuW(pm, MF_STRING, IDM_TRAY_SHOW, T(S_TRAY_SHOW));
            AppendMenuW(pm, MF_STRING | (g_proxyEnabled ? MF_CHECKED : MF_UNCHECKED), IDM_PROXY_ENABLE, T(S_M_ENABLE));
            AppendMenuW(pm, MF_SEPARATOR, 0, NULL);
            AppendMenuW(pm, MF_STRING, IDM_TRAY_EXIT, T(S_TRAY_EXIT));
            SetForegroundWindow(hwnd);
            TrackPopupMenu(pm, TPM_RIGHTBUTTON, pt.x, pt.y, 0, hwnd, NULL);
            DestroyMenu(pm);
        }
        return 0;

    case WM_COMMAND:
    {
        WORD id = LOWORD(wp);
        if (id >= IDM_PROXY_NODE_BASE && id < IDM_PROXY_NODE_BASE + PB_MAX_CFG)
        {
            int targetIdx = id - IDM_PROXY_NODE_BASE;
            if (targetIdx > 0 && targetIdx < (int)g_profile.cfgCount)
            {
                PBConfig tmp = g_profile.cfg[0];
                g_profile.cfg[0] = g_profile.cfg[targetIdx];
                g_profile.cfg[targetIdx] = tmp;
                PB_ProfileSave(g_activeProfile, &g_profile);
                SwitchToProfile(g_activeProfile);
            }
            return 0;
        }
        if (id >= IDM_PROFILE_SWITCH_BASE && id < IDM_PROFILE_SWITCH_BASE + g_profCount)
        {
            int i = id - IDM_PROFILE_SWITCH_BASE;
            if (_wcsicmp(g_profNames[i], g_activeProfile) != 0) SwitchToProfile(g_profNames[i]);
            return 0;
        }
        switch (id)
        {
        case IDM_PROXY_SETTINGS:
            if (g_hTab) { TabCtrl_SetCurSel(g_hTab, 1); SelectTab(1); }
            return 0;
        case IDM_PROXY_RULES:
            if (g_hTab) { TabCtrl_SetCurSel(g_hTab, 0); SelectTab(0); }
            return 0;
        case IDC_MAIN_RULES_SEARCH:
            if (HIWORD(wp) == EN_CHANGE)
            {
                wchar_t text[256];
                GetWindowTextW(g_hRulesSearch, text, ARRAYSIZE(text));
                int keep = SelectedRuleIndex(g_hRulesList);
                RulesSetFilterText(text);
                RefreshRulesList(g_hRulesList);
                SelectRuleIndex(g_hRulesList, keep);
            }
            return 0;
        case IDC_MAIN_RULES_ADD:   MainRuleAdd(hwnd);    return 0;
        case IDC_MAIN_RULES_EDIT:  MainRuleEdit(hwnd);   return 0;
        case IDC_MAIN_RULES_DEL:   MainRuleDelete(hwnd); return 0;
        case IDC_MAIN_RULES_CLONE: MainRuleClone(hwnd);  return 0;
        case IDC_MAIN_RULES_UP:    MainRuleMove(-1);     return 0;
        case IDC_MAIN_RULES_DOWN:  MainRuleMove(+1);     return 0;

        case IDC_MAIN_SRV_ACTIVE:  MainServerSetActive();  return 0;
        case IDC_MAIN_SRV_TEST:    MainServerTest(hwnd);   return 0;
        case IDC_MAIN_SRV_ADD:     MainServerAdd(hwnd);    return 0;
        case IDC_MAIN_SRV_EDIT:    MainServerEdit(hwnd);   return 0;
        case IDC_MAIN_SRV_DEL:     MainServerDelete(hwnd); return 0;
        case IDM_OPEN_LOGS:
        case IDC_CONN_LOGS:
        case IDC_ACT_LOGS:
        {
            wchar_t ld[MAX_PATH];
            PB_GetLogsDir(ld, MAX_PATH);
            ShellExecuteW(hwnd, L"open", ld, NULL, NULL, SW_SHOWNORMAL);
            return 0;
        }
        case IDM_PROXY_ENABLE:
            g_proxyEnabled = !g_proxyEnabled;
            g_api.SetEnabled(g_proxyEnabled);
            UpdateTitle(); TrayUpdateTip(); SyncMenuChecks(hwnd);
            return 0;
        case IDM_SET_TRAFFICLOG:
            g_trafficLog = !g_trafficLog; g_profile.trafficLogging = g_trafficLog;
            g_api.SetTrafficLoggingEnabled(g_trafficLog); SaveActive(); SyncMenuChecks(hwnd); return 0;
        case IDM_SET_PROXIED_ONLY:
            g_proxiedOnly = !g_proxiedOnly;
            SyncMenuChecks(hwnd); return 0;
        case IDM_SET_CLOSETOTRAY:
            g_closeToTray = !g_closeToTray; g_profile.closeToTray = g_closeToTray;
            SaveActive(); SyncMenuChecks(hwnd); return 0;
        case IDM_SET_STARTUP:
            g_startup = !g_startup; StartupSet(g_startup);
            g_startup = StartupIsEnabled();   // reflect the real state
            SyncMenuChecks(hwnd); return 0;
        case IDM_SET_LOGALL:
            g_logEvery = !g_logEvery; g_profile.logEveryConnection = g_logEvery;
            if (g_api.SetLogEveryConnection) g_api.SetLogEveryConnection(g_logEvery);
            SaveActive(); SyncMenuChecks(hwnd); return 0;
        case IDM_SET_AUTOCLEAR:
            g_autoClear = !g_autoClear; g_profile.autoClearLogs = g_autoClear;
            SaveActive(); SyncMenuChecks(hwnd); return 0;
        case IDM_ZOOM_IN:    SetZoom(hwnd, g_zoom + 10); return 0;
        case IDM_ZOOM_OUT:   SetZoom(hwnd, g_zoom - 10); return 0;
        case IDM_ZOOM_RESET: SetZoom(hwnd, 100);         return 0;
        case IDM_LOG_FILTERS:
            if (DialogBoxW(g_hInst, MAKEINTRESOURCEW(IDD_FILTERS), hwnd, FiltersDlgProc))
            {
                ApplyFilterSnapshot(); SaveActive();
                LogStoreClear(&g_connStore);   // re-populate under the new filter set
            }
            return 0;
        case IDM_PROFILE_RENAME:
            if (_wcsicmp(g_activeProfile, L"Default") == 0)
            { MessageBoxW(hwnd, T(S_INFO_NORENAMEDEFAULT), APP_TITLE, MB_OK | MB_ICONINFORMATION); return 0; }
            if (DialogBoxW(g_hInst, MAKEINTRESOURCEW(IDD_NAME), hwnd, NameDlgProc) && g_nameResult[0])
            {
                for (wchar_t* q = g_nameResult; *q; q++) if (wcschr(L"<>:\"/\\|?*", *q)) *q = L'_';
                if (_wcsicmp(g_nameResult, g_activeProfile) != 0)
                {
                    if (PB_ProfileRename(g_activeProfile, g_nameResult))
                    { lstrcpynW(g_activeProfile, g_nameResult, PB_NAME_MAX); RebuildProfileMenu(hwnd); UpdateTitle(); }
                    else MessageBoxW(hwnd, T(S_ERR_IMPORT), APP_TITLE, MB_OK | MB_ICONERROR);
                }
            }
            return 0;
        case IDM_LANG_RU: g_lang = 0; lstrcpynW(g_profile.language, L"ru", 8); SaveActive(); RelocalizeUI(hwnd); return 0;
        case IDM_LANG_EN: g_lang = 1; lstrcpynW(g_profile.language, L"en", 8); SaveActive(); RelocalizeUI(hwnd); return 0;
        case IDM_LANG_ZH: g_lang = 2; lstrcpynW(g_profile.language, L"zh", 8); SaveActive(); RelocalizeUI(hwnd); return 0;
        case IDC_CONN_CLEAR: LogStoreClear(&g_connStore); if (g_api.ClearConnectionLogs) g_api.ClearConnectionLogs(); return 0;
        case IDC_ACT_CLEAR:  LogStoreClear(&g_actStore); return 0;
        case IDC_CONN_SEARCH:
            if (HIWORD(wp) == EN_CHANGE)
            { GetWindowTextW(g_hConnSearch, g_connStore.filter, 128); LogStoreRebuild(&g_connStore); }
            return 0;
        case IDC_ACT_SEARCH:
            if (HIWORD(wp) == EN_CHANGE)
            { GetWindowTextW(g_hActSearch, g_actStore.filter, 128); LogStoreRebuild(&g_actStore); }
            return 0;
        case IDM_PROFILE_NEW:
            if (DialogBoxW(g_hInst, MAKEINTRESOURCEW(IDD_NAME), hwnd, NameDlgProc) && g_nameResult[0])
            {
                for (wchar_t* q = g_nameResult; *q; q++) if (wcschr(L"<>:\"/\\|?*", *q)) *q = L'_';
                PBProfile* np = (PBProfile*)malloc(sizeof(PBProfile));  // too big for the stack
                if (np) { PB_ProfileDefaults(np, g_nameResult); PB_ProfileSave(g_nameResult, np); free(np); }
                SwitchToProfile(g_nameResult);
            }
            return 0;
        case IDM_PROFILE_DELETE:
            if (_wcsicmp(g_activeProfile, L"Default") == 0)
            { MessageBoxW(hwnd, T(S_INFO_NODELDEFAULT), APP_TITLE, MB_OK | MB_ICONINFORMATION); return 0; }
            {
                wchar_t toDel[PB_NAME_MAX]; lstrcpynW(toDel, g_activeProfile, PB_NAME_MAX);
                SwitchToProfile(L"Default");
                PB_ProfileDelete(toDel);
                RebuildProfileMenu(hwnd);
            }
            return 0;
        case IDM_PROFILE_IMPORT:
        {
            wchar_t src[MAX_PATH];
            if (PickFile(hwnd, FALSE, src, MAX_PATH))
            {
                wchar_t assigned[PB_NAME_MAX];
                if (PB_ProfileImport(src, assigned, PB_NAME_MAX)) SwitchToProfile(assigned);
                else MessageBoxW(hwnd, T(S_ERR_IMPORT), APP_TITLE, MB_OK | MB_ICONERROR);
            }
            return 0;
        }
        case IDM_PROFILE_EXPORT:
        {
            wchar_t dst[MAX_PATH];
            if (PickFile(hwnd, TRUE, dst, MAX_PATH))
            {
                if (!PB_ProfileExport(g_activeProfile, dst))
                    MessageBoxW(hwnd, T(S_ERR_EXPORT), APP_TITLE, MB_OK | MB_ICONERROR);
            }
            return 0;
        }
        case IDM_HELP_DOCS:
            ShellExecuteW(hwnd, L"open", L"https://github.com/vlv-code/PEC#readme", NULL, NULL, SW_SHOWNORMAL);
            return 0;
        case IDM_HELP_UPDATE:
            UpdStartCheck(hwnd, TRUE);   // manual: also reports "up to date" / errors
            return 0;
        case IDM_HELP_ABOUT:
            DialogBoxW(g_hInst, MAKEINTRESOURCEW(IDD_ABOUT), hwnd, AboutDlgProc);
            return 0;
        case IDM_TRAY_SHOW: ShowMainWindow(hwnd); return 0;
        case IDM_TRAY_EXIT: g_reallyExit = TRUE; DestroyWindow(hwnd); return 0;
        }
        return 0;
    }

    case WM_CLOSE:
        if (g_closeToTray && !g_reallyExit) { ShowWindow(hwnd, SW_HIDE); return 0; }
        DestroyWindow(hwnd);
        return 0;
    case WM_DESTROY:
        PecSyncStop();
        if (g_api.Stop) g_api.Stop();
        TrayRemove();
        KillTimer(hwnd, TIMER_LOG);
        LogStoreFree(&g_connStore);    // release buffered + pending log lines + the lock
        LogStoreFree(&g_actStore);
        if (g_hMono) DeleteObject(g_hMono);
        if (g_hUi)   DeleteObject(g_hUi);
        if (g_hIcon) DeleteObject(g_hIcon);
        if (g_hMenuFont) DeleteObject(g_hMenuFont);
        if (g_brBg)     DeleteObject(g_brBg);
        if (g_brPanel)  DeleteObject(g_brPanel);
        if (g_brTab)    DeleteObject(g_brTab);
        if (g_brTabSel) DeleteObject(g_brTabSel);
        if (g_brTabHot) DeleteObject(g_brTabHot);
        if (g_brAccent) DeleteObject(g_brAccent);
        if (g_brMenu)   DeleteObject(g_brMenu);
        if (g_brMenuHot)DeleteObject(g_brMenuHot);
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

// Connects to the engine. Normal path: the ProxyBridgeSvc service (installed once by setup)
// so this process stays unprivileged. Fallback for a portable/unzipped copy with no service:
// load ProxyBridgeCore.dll in-process, which needs elevation - relaunch elevated once.
static BOOL IsElevated(void)
{
    BOOL elevated = FALSE; HANDLE tok = NULL;
    if (OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &tok))
    {
        TOKEN_ELEVATION te; DWORD n = 0;
        if (GetTokenInformation(tok, TokenElevation, &te, sizeof(te), &n)) elevated = te.TokenIsElevated != 0;
        CloseHandle(tok);
    }
    return elevated;
}

static BOOL ConnectEngine(void)
{
    int rc = PB_LoadService(&g_api);
    if (rc == PB_IPC_OK) return TRUE;

    if (rc == PB_IPC_BUSY)
    {
        MessageBoxW(NULL, L"Another PEC-App window (possibly in a different user session) is already "
                          L"connected to the PEC-App service.\nClose it and try again.",
                    APP_TITLE, MB_OK | MB_ICONWARNING);
        return FALSE;
    }
    if (rc == PB_IPC_BAD_VERSION)
    {
        MessageBoxW(NULL, L"The installed PEC-App service is a different version than this program.\n"
                          L"Re-run the PEC-App installer.", APP_TITLE, MB_OK | MB_ICONERROR);
        return FALSE;
    }

    if (rc == PB_IPC_DENIED)
    {
        // The service refuses this account. Offer the elevated stand-alone mode as a fallback.
        if (MessageBoxW(NULL, L"This account is not allowed to use the PEC-App service.\n"
                              L"Ask an administrator to add you to the \"PEC-App Users\" group, then sign out and in.\n"
                              L"Run as administrator instead?",
                        APP_TITLE, MB_YESNO | MB_ICONWARNING) != IDYES)
            return FALSE;
    }

    // No service: portable mode.
    if (!IsElevated())
    {
        wchar_t exe[MAX_PATH]; GetModuleFileNameW(NULL, exe, MAX_PATH);
        SHELLEXECUTEINFOW sei; ZeroMemory(&sei, sizeof(sei));
        sei.cbSize = sizeof(sei); sei.lpVerb = L"runas"; sei.lpFile = exe; sei.nShow = SW_SHOWNORMAL;
        ShellExecuteExW(&sei);   // on UAC cancel just exit
        return FALSE;
    }
    if (!PB_LoadDirect(&g_api))
    {
        const wchar_t* detail = PB_GetLastErrorMsg();
        wchar_t msg[1024];
        if (detail && detail[0]) {
            wsprintfW(msg, L"%ls", detail);
        } else {
            wsprintfW(msg, L"Could not load PECAppCore.dll.\nMake sure it is in the same folder as this executable.");
        }
        MessageBoxW(NULL, msg, APP_TITLE, MB_OK | MB_ICONERROR);
        return FALSE;
    }
    return TRUE;
}

// entry point
int WINAPI wWinMain(HINSTANCE hInst, HINSTANCE hPrev, PWSTR cmd, int show)
{
    (void)hPrev;
    g_hInst = hInst;
    BOOL startMinimized = (cmd && wcsstr(cmd, L"--minimized") != NULL);

    {
        HDC sdc = GetDC(NULL);
        if (sdc) { int d = GetDeviceCaps(sdc, LOGPIXELSY); if (d >= 96) g_dpi = d; ReleaseDC(NULL, sdc); }
    }
    INITCOMMONCONTROLSEX icc = { sizeof(icc), ICC_TAB_CLASSES | ICC_LISTVIEW_CLASSES | ICC_BAR_CLASSES | ICC_STANDARD_CLASSES | ICC_LINK_CLASS | ICC_PROGRESS_CLASS };
    InitCommonControlsEx(&icc);

    // Parse command line for -profile <path> or --profile <path>
    wchar_t profileArg[MAX_PATH] = {0};
    if (cmd && cmd[0])
    {
        const wchar_t* p = wcsstr(cmd, L"-profile");
        if (!p) p = wcsstr(cmd, L"--profile");
        if (p)
        {
            p += (p[1] == L'-' ? 9 : 8);
            while (*p == L' ' || *p == L'=' || *p == L'\t') p++;
            if (*p == L'\"')
            {
                p++;
                int i = 0;
                while (*p && *p != L'\"' && i < MAX_PATH - 1) profileArg[i++] = *p++;
                profileArg[i] = 0;
            }
            else
            {
                int i = 0;
                while (*p && *p != L' ' && *p != L'\t' && i < MAX_PATH - 1) profileArg[i++] = *p++;
                profileArg[i] = 0;
            }
        }
        else
        {
            const wchar_t* ext = wcsstr(cmd, L".pbprofile");
            if (ext)
            {
                const wchar_t* start = cmd;
                while (*start == L' ' || *start == L'\"') start++;
                int i = 0;
                while (start < ext + 10 && i < MAX_PATH - 1) profileArg[i++] = *start++;
                profileArg[i] = 0;
            }
        }
    }

    PB_GetActiveProfile(g_activeProfile, PB_NAME_MAX);
    if (profileArg[0])
    {
        PB_ProfileLoad(profileArg, &g_profile);
        lstrcpynW(g_activeProfile, L"PEC-Default", PB_NAME_MAX);
        PB_SetActiveProfile(g_activeProfile);
        PB_ProfileSave(g_activeProfile, &g_profile);
    }
    else
    {
        PB_ProfileLoad(g_activeProfile, &g_profile);
        if (g_profile.cfgCount == 0 && g_profile.ruleCount == 0)
        {
            wchar_t exeDir[MAX_PATH];
            GetModuleFileNameW(NULL, exeDir, MAX_PATH);
            wchar_t* last = wcsrchr(exeDir, L'\\');
            if (last) *last = 0; else exeDir[0] = 0;
            if (exeDir[0])
            {
                wchar_t cand[MAX_PATH];
                _snwprintf_s(cand, MAX_PATH, _TRUNCATE, L"%s\\pec_profile.pbprofile", exeDir);
                if (GetFileAttributesW(cand) == INVALID_FILE_ATTRIBUTES)
                {
                    _snwprintf_s(cand, MAX_PATH, _TRUNCATE, L"%s\\Default.pbprofile", exeDir);
                }
                if (GetFileAttributesW(cand) != INVALID_FILE_ATTRIBUTES)
                {
                    PB_ProfileLoad(cand, &g_profile);
                    lstrcpynW(g_activeProfile, L"PEC-Default", PB_NAME_MAX);
                    PB_SetActiveProfile(g_activeProfile);
                    PB_ProfileSave(g_activeProfile, &g_profile);
                    PB_ProfileSave(L"Default", &g_profile);
                }
            }
        }
    }

    g_trafficLog  = g_profile.trafficLogging;
    g_closeToTray = g_profile.closeToTray;
    g_zoom        = g_profile.fontZoom;
    {
        LANGID lid = PRIMARYLANGID(GetUserDefaultUILanguage());
        if (_wcsicmp(g_profile.language, L"zh") == 0 || (g_profile.language[0] == 0 && lid == LANG_CHINESE)) g_lang = 2;
        else if (_wcsicmp(g_profile.language, L"en") == 0 && lid != LANG_RUSSIAN) g_lang = 1;
        else g_lang = 0; // Default to Russian for PEC
    }

    // Refuse to start if another GUI or the CLI is already running - they'd both drive the
    // same engine (the service accepts one client at a time) and the same relay ports.
    if (AnotherInstanceRunning())
    {
        MessageBoxW(NULL, T(S_ERR_RUNNING), APP_TITLE, MB_OK | MB_ICONWARNING);
        return 0;
    }

    if (!ConnectEngine())
        return 1;

    PB_WriteAppLog("=== PEC-App GUI v2.1.0 started (ActiveProfile: %ws) ===", g_activeProfile);

    g_autoClear   = g_profile.autoClearLogs;
    g_logEvery    = g_profile.logEveryConnection != 0;
    g_startup     = StartupIsEnabled();
    ApplyFilterSnapshot();

    ApplyProfileTheme(&g_profile.theme, NULL);
    CreateDarkBrushes();   // needed for the window class background below

    WNDCLASSEXW wc; ZeroMemory(&wc, sizeof(wc));
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInst;
    wc.hIcon = (HICON)LoadImageW(hInst, MAKEINTRESOURCEW(IDI_APPICON), IMAGE_ICON, 0, 0, LR_DEFAULTSIZE);
    wc.hIconSm = wc.hIcon;
    wc.hCursor = LoadCursorW(NULL, IDC_ARROW);
    wc.hbrBackground = g_brBg;
    wc.lpszClassName = WND_CLASS;
    wc.lpszMenuName = NULL;   // menu is built programmatically (localizable)
    if (!RegisterClassExW(&wc)) return 1;

    // Default window size scales with the system DPI (1200x820 at 100%) but never exceeds the
    // work area, so it is not a postage stamp on a 3072x1920 screen or off-screen on a small one.
    int winW = MulDiv(1200, g_dpi, 96), winH = MulDiv(820, g_dpi, 96);
    {
        RECT wa;
        if (SystemParametersInfoW(SPI_GETWORKAREA, 0, &wa, 0))
        {
            int maxW = (wa.right - wa.left) * 9 / 10, maxH = (wa.bottom - wa.top) * 9 / 10;
            if (winW > maxW) winW = maxW;
            if (winH > maxH) winH = maxH;
        }
    }
    g_hMain = CreateWindowExW(0, WND_CLASS, APP_TITLE, WS_OVERLAPPEDWINDOW,
                              CW_USEDEFAULT, CW_USEDEFAULT, winW, winH, NULL, NULL, hInst, NULL);
    if (!g_hMain) return 1;

    // Center on the working area of the monitor the window landed on (CW_USEDEFAULT places
    // it top-left otherwise).
    {
        RECT wr; GetWindowRect(g_hMain, &wr);
        int ww = wr.right - wr.left, wh = wr.bottom - wr.top;
        HMONITOR mon = MonitorFromWindow(g_hMain, MONITOR_DEFAULTTONEAREST);
        MONITORINFO mi; mi.cbSize = sizeof(mi);
        if (GetMonitorInfoW(mon, &mi))
        {
            int x = mi.rcWork.left + (mi.rcWork.right - mi.rcWork.left - ww) / 2;
            int y = mi.rcWork.top  + (mi.rcWork.bottom - mi.rcWork.top - wh) / 2;
            SetWindowPos(g_hMain, NULL, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
        }
    }

    BuildMainMenu(g_hMain);
    DrawMenuBar(g_hMain);
    TrayAdd(g_hMain);
    SyncMenuChecks(g_hMain);
    RebuildProfileMenu(g_hMain);
    UpdateTitle();

    // Wire callbacks + toggles, add configs (before Start so the UDP relay starts), start,
    // then add rules.
    g_api.SetTrafficLoggingEnabled(g_trafficLog);
    if (g_api.SetLogEveryConnection) g_api.SetLogEveryConnection(g_logEvery);
    g_api.SetEnabled(g_proxyEnabled);
    g_api.SetLogCallback(PBLogCb);
    g_api.SetConnectionCallback(PBConnCb);
    ApplyConfigs();
    g_started = g_api.Start();
    if (g_started) { ApplyRules(); LogStoreAdd(&g_actStore, T(S_STARTED)); }
    else LogStoreAdd(&g_actStore, T(S_STARTFAIL));

    if (startMinimized) ShowWindow(g_hMain, SW_HIDE);   // launched by the logon task
    else { ShowWindow(g_hMain, show); UpdateWindow(g_hMain); }

    // Silent update check on startup (opt-out via the notification's "Don't Ask Again").
    if (PB_GetCheckUpdates()) UpdStartCheck(g_hMain, FALSE);

    PecSyncStart(g_hMain);

    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0) > 0)
    {
        if (IsDialogMessageW(g_hMain, &msg)) continue;
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    PecSyncStop();
    return (int)msg.wParam;
}

#if defined(__GNUC__)
int WINAPI WinMain(HINSTANCE hInst, HINSTANCE hPrev, LPSTR lpCmdLine, int nShowCmd)
{
    (void)lpCmdLine;
    return wWinMain(hInst, hPrev, GetCommandLineW(), nShowCmd);
}
#endif
