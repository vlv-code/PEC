// ui/pec_sync.h - background server sync & local extension pairing for PEC-App.
#ifndef PB_UI_PEC_SYNC_H
#define PB_UI_PEC_SYNC_H

#ifndef _CRT_RAND_S
#define _CRT_RAND_S
#endif

#ifndef APP_VERSION_STR
#define APP_VERSION_STR "2.2.0"
#endif

#ifndef PEC_APP_VERSION
#define PEC_APP_VERSION L"2.2.0"
#endif

static void PecParseVersion(const wchar_t* s, int out[3])
{
    out[0] = out[1] = out[2] = 0;
    int i = 0;
    while (*s && (*s < L'0' || *s > L'9')) s++; // skip 'v' etc.
    while (*s && i < 3)
    {
        if (*s >= L'0' && *s <= L'9')
        {
            int n = 0;
            while (*s >= L'0' && *s <= L'9') { n = n * 10 + (*s - L'0'); s++; }
            out[i++] = n;
        }
        else if (*s == L'.') s++;
        else break;
    }
}

static int PecCompareVersion(const int a[3], const int b[3])
{
    for (int i = 0; i < 3; i++)
    {
        if (a[i] != b[i]) return (a[i] < b[i]) ? -1 : 1;
    }
    return 0;
}

#include <winsock2.h>
#include <ws2tcpip.h>
#include <winhttp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "../profile/json.h"

#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "winhttp.lib")

#ifndef PB_UPD_INFO_DEFINED
#define PB_UPD_INFO_DEFINED
typedef struct {
    BOOL    available;
    wchar_t latest[32];
    wchar_t download[512];
    wchar_t notes[512];
    wchar_t date[32];
    wchar_t sha256[65];
} UpdInfo;
#endif

#define PEC_LOOPBACK_PORT 20809

typedef struct {
    int     paired;
    wchar_t instanceId[128];
    wchar_t version[32];
    wchar_t browser[64];
    DWORD   lastAnnounceTick;
} PecPairedExtension;

static PecPairedExtension g_pairedExt = { 0 };
static CRITICAL_SECTION   g_syncLock;
static HANDLE             g_hSyncWakeEvent = NULL;
static HANDLE             g_hSyncThread = NULL;
static HANDLE             g_hLoopbackThread = NULL;
static SOCKET             g_loopbackSocket = INVALID_SOCKET;
static volatile BOOL      g_syncRunning = FALSE;
static volatile BOOL      g_syncEverSucceeded = FALSE;
static volatile BOOL      g_isSyncing = FALSE;
static volatile DWORD     g_lastSyncError = 0;
static volatile DWORD     g_lastSyncTick = 0;
static SYSTEMTIME         g_lastSyncTime = { 0 };
static wchar_t            g_lastSyncStatusStr[128] = L"Ожидание синхронизации...";
static HWND               g_hSyncMainWnd = NULL;
static wchar_t            g_appInstanceId[128] = { 0 };
static wchar_t            g_selectedProxyHost[128] = { 0 };
static int                g_selectedProxyPort = 0;

static void PecSyncTriggerNow(void)
{
    if (g_hSyncWakeEvent) SetEvent(g_hSyncWakeEvent);
}

static void PecSyncSetSelectedProxy(const wchar_t* host, int port)
{
    EnterCriticalSection(&g_syncLock);
    if (host) lstrcpynW(g_selectedProxyHost, host, 128); else g_selectedProxyHost[0] = 0;
    g_selectedProxyPort = port;
    LeaveCriticalSection(&g_syncLock);
    if (g_hSyncWakeEvent) SetEvent(g_hSyncWakeEvent);
}

static void PecGetOrGenInstanceId(wchar_t* out, int cch)
{
    wchar_t path[MAX_PATH];
    wchar_t appdata[MAX_PATH];
    if (!GetEnvironmentVariableW(L"APPDATA", appdata, MAX_PATH)) appdata[0] = 0;
    _snwprintf_s(path, MAX_PATH, _TRUNCATE, L"%s\\PEC-App\\instance_id.txt", appdata);

    HANDLE h = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (h != INVALID_HANDLE_VALUE)
    {
        char buf[128] = { 0 };
        DWORD read = 0;
        ReadFile(h, buf, 127, &read, NULL);
        CloseHandle(h);
        while (read > 0 && (buf[read - 1] == '\r' || buf[read - 1] == '\n' || buf[read - 1] == ' '))
            buf[--read] = 0;
        if (read > 0)
        {
            MultiByteToWideChar(CP_UTF8, 0, buf, -1, out, cch);
            return;
        }
    }

    // Generate pseudo-random instance ID
    DWORD t = GetTickCount();
    DWORD p = GetCurrentProcessId();
    unsigned int r1 = 0, r2 = 0;
    if (rand_s(&r1) != 0) {
        r1 = (unsigned int)GetTickCount() ^ (unsigned int)GetCurrentProcessId();
    }
    if (rand_s(&r2) != 0) {
        r2 = (unsigned int)GetCurrentThreadId() ^ 0x5A5A5A5A;
    }
    _snwprintf_s(out, cch, _TRUNCATE, L"pec-win-%08x%04x%04x", t, (p & 0xFFFF), (r1 ^ r2) & 0xFFFF);

    wchar_t dir[MAX_PATH];
    _snwprintf_s(dir, MAX_PATH, _TRUNCATE, L"%s\\PEC-App", appdata);
    CreateDirectoryW(dir, NULL);

    HANDLE hw = CreateFileW(path, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hw != INVALID_HANDLE_VALUE)
    {
        char buf[128];
        int len = WideCharToMultiByte(CP_UTF8, 0, out, -1, buf, sizeof(buf), NULL, NULL);
        DWORD written = 0;
        if (len > 0) WriteFile(hw, buf, len - 1, &written, NULL);
        CloseHandle(hw);
    }
}

static void PecLoadInstanceToken(wchar_t* out, int cch)
{
    if (!out || cch <= 0) return;
    out[0] = 0;
    wchar_t path[MAX_PATH];
    wchar_t appdata[MAX_PATH];
    if (!GetEnvironmentVariableW(L"APPDATA", appdata, MAX_PATH)) appdata[0] = 0;
    _snwprintf_s(path, MAX_PATH, _TRUNCATE, L"%s\\PEC-App\\instance_token.txt", appdata);

    HANDLE h = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (h != INVALID_HANDLE_VALUE)
    {
        char buf[256] = { 0 };
        DWORD read = 0;
        ReadFile(h, buf, 255, &read, NULL);
        CloseHandle(h);
        while (read > 0 && (buf[read - 1] == '\r' || buf[read - 1] == '\n' || buf[read - 1] == ' '))
            buf[--read] = 0;
        if (read > 0)
        {
            MultiByteToWideChar(CP_UTF8, 0, buf, -1, out, cch);
        }
    }
}

static void PecSaveInstanceToken(const wchar_t* token)
{
    if (!token || token[0] == 0) return;
    wchar_t appdata[MAX_PATH];
    if (!GetEnvironmentVariableW(L"APPDATA", appdata, MAX_PATH)) appdata[0] = 0;
    wchar_t dir[MAX_PATH];
    _snwprintf_s(dir, MAX_PATH, _TRUNCATE, L"%s\\PEC-App", appdata);
    CreateDirectoryW(dir, NULL);

    wchar_t path[MAX_PATH];
    _snwprintf_s(path, MAX_PATH, _TRUNCATE, L"%s\\PEC-App\\instance_token.txt", appdata);
    HANDLE hw = CreateFileW(path, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hw != INVALID_HANDLE_VALUE)
    {
        char buf[256] = { 0 };
        int len = WideCharToMultiByte(CP_UTF8, 0, token, -1, buf, sizeof(buf), NULL, NULL);
        DWORD written = 0;
        if (len > 0) WriteFile(hw, buf, len - 1, &written, NULL);
        CloseHandle(hw);
    }
}

static void PecJsonEscapeString(const char* src, char* dst, size_t dstSize)
{
    if (!dst || dstSize == 0) return;
    size_t di = 0;
    for (size_t si = 0; src && src[si] && di + 1 < dstSize; si++)
    {
        char c = src[si];
        if (c == '\\' || c == '"')
        {
            if (di + 2 >= dstSize) break;
            dst[di++] = '\\';
            dst[di++] = c;
        }
        else if (c == '\r')
        {
            if (di + 2 >= dstSize) break;
            dst[di++] = '\\';
            dst[di++] = 'r';
        }
        else if (c == '\n')
        {
            if (di + 2 >= dstSize) break;
            dst[di++] = '\\';
            dst[di++] = 'n';
        }
        else if (c == '\t')
        {
            if (di + 2 >= dstSize) break;
            dst[di++] = '\\';
            dst[di++] = 't';
        }
        else if ((unsigned char)c >= 0x20)
        {
            dst[di++] = c;
        }
    }
    dst[di] = '\0';
}

static const char* PecFindHttpHeader(const char* buf, const char* name, size_t nameLen)
{
    if (!buf || !name || nameLen == 0) return NULL;
    if (_strnicmp(buf, name, nameLen) == 0 && (buf[nameLen] == ':' || buf[nameLen] == ' ' || buf[nameLen] == '\t'))
        return buf;
    const char* p = buf;
    while ((p = strstr(p, "\r\n")) != NULL)
    {
        p += 2;
        if (_strnicmp(p, name, nameLen) == 0 && (p[nameLen] == ':' || p[nameLen] == ' ' || p[nameLen] == '\t'))
            return p;
    }
    return NULL;
}

#ifndef WM_APP_RELOAD_PROFILE
#define WM_APP_RELOAD_PROFILE (WM_APP + 9)
#endif

// ── Winsock HTTP Loopback Server on 127.0.0.1:20809 ──────────────────────────
static DWORD WINAPI PecLoopbackThreadProc(LPVOID param)
{
    (void)param;
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return 1;

    g_loopbackSocket = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (g_loopbackSocket == INVALID_SOCKET) { WSACleanup(); return 1; }

    BOOL opt = TRUE;
    setsockopt(g_loopbackSocket, SOL_SOCKET, SO_REUSEADDR, (const char*)&opt, sizeof(opt));

    struct sockaddr_in sin;
    ZeroMemory(&sin, sizeof(sin));
    sin.sin_family = AF_INET;
    sin.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    sin.sin_port = htons(PEC_LOOPBACK_PORT);

    if (bind(g_loopbackSocket, (struct sockaddr*)&sin, sizeof(sin)) == SOCKET_ERROR)
    {
        closesocket(g_loopbackSocket);
        g_loopbackSocket = INVALID_SOCKET;
        WSACleanup();
        return 1;
    }

    if (listen(g_loopbackSocket, 5) == SOCKET_ERROR)
    {
        closesocket(g_loopbackSocket);
        g_loopbackSocket = INVALID_SOCKET;
        WSACleanup();
        return 1;
    }

    while (g_syncRunning)
    {
        fd_set fds;
        FD_ZERO(&fds);
        FD_SET(g_loopbackSocket, &fds);
        struct timeval tv = { 1, 0 }; // 1 sec timeout for clean loop exit
        int sel = select(0, &fds, NULL, NULL, &tv);
        if (sel <= 0) continue;

        struct sockaddr_in clientAddr;
        int clientLen = sizeof(clientAddr);
        SOCKET cs = accept(g_loopbackSocket, (struct sockaddr*)&clientAddr, &clientLen);
        if (cs == INVALID_SOCKET) continue;

        // Ensure connections come strictly from loopback (127.0.0.0/8)
        if ((ntohl(clientAddr.sin_addr.s_addr) & 0xFF000000) != 0x7F000000)
        {
            closesocket(cs);
            continue;
        }

        // Set socket timeout
        DWORD timeoutMs = 2500;
        setsockopt(cs, SOL_SOCKET, SO_RCVTIMEO, (const char*)&timeoutMs, sizeof(timeoutMs));

        char reqBuf[4096] = { 0 };
        int recvd = recv(cs, reqBuf, sizeof(reqBuf) - 1, 0);
        if (recvd > 0)
        {
            reqBuf[recvd] = 0;

            // Handle potential multi-packet body for POST
            char* body = strstr(reqBuf, "\r\n\r\n");
            if (body && _strnicmp(reqBuf, "POST", 4) == 0)
            {
                body += 4;
                char* clHdr = strstr(reqBuf, "Content-Length:");
                if (!clHdr) clHdr = strstr(reqBuf, "content-length:");
                if (clHdr)
                {
                    int cl = atoi(clHdr + 15);
                    int curBody = (int)strlen(body);
                    while (curBody < cl && recvd < (int)(sizeof(reqBuf) - 1))
                    {
                        int more = recv(cs, reqBuf + recvd, (int)sizeof(reqBuf) - 1 - recvd, 0);
                        if (more <= 0) break;
                        recvd += more;
                        reqBuf[recvd] = 0;
                        curBody += more;
                    }
                }
            }

            // 1. Validate Host header to defeat DNS rebinding attacks
            char hostVal[128] = { 0 };
            const char* hostHdr = PecFindHttpHeader(reqBuf, "Host", 4);
            if (hostHdr)
            {
                const char* valStart = strchr(hostHdr, ':');
                if (valStart)
                {
                    valStart++;
                    while (*valStart == ' ' || *valStart == '\t') valStart++;
                    const char* valEnd = strpbrk(valStart, "\r\n");
                    size_t valLen = valEnd ? (size_t)(valEnd - valStart) : strlen(valStart);
                    while (valLen > 0 && (valStart[valLen - 1] == ' ' || valStart[valLen - 1] == '\t'))
                        valLen--;
                    if (valLen < sizeof(hostVal))
                    {
                        memcpy(hostVal, valStart, valLen);
                        hostVal[valLen] = '\0';
                    }
                }
            }

            BOOL hostOk = (hostVal[0] != '\0') &&
                          (_stricmp(hostVal, "127.0.0.1:20809") == 0 ||
                           _stricmp(hostVal, "localhost:20809") == 0 ||
                           _stricmp(hostVal, "127.0.0.1") == 0 ||
                           _stricmp(hostVal, "localhost") == 0 ||
                           _stricmp(hostVal, "localhost.:20809") == 0 ||
                           _stricmp(hostVal, "localhost.") == 0 ||
                           _stricmp(hostVal, "[::1]:20809") == 0 ||
                           _stricmp(hostVal, "[::1]") == 0);

            if (!hostOk)
            {
                const char* badHostResp =
                    "HTTP/1.1 403 Forbidden\r\n"
                    "Content-Type: text/plain\r\n"
                    "Connection: close\r\n\r\n"
                    "Forbidden: Invalid Host header (DNS-rebinding protection)\n";
                send(cs, badHostResp, (int)strlen(badHostResp), 0);
                closesocket(cs);
                continue;
            }

            // 2. Validate Origin header and restrict CORS
            char originVal[256] = { 0 };
            const char* origHdr = PecFindHttpHeader(reqBuf, "Origin", 6);
            if (origHdr)
            {
                const char* valStart = strchr(origHdr, ':');
                if (valStart)
                {
                    valStart++;
                    while (*valStart == ' ' || *valStart == '\t') valStart++;
                    const char* valEnd = strpbrk(valStart, "\r\n");
                    size_t valLen = valEnd ? (size_t)(valEnd - valStart) : strlen(valStart);
                    while (valLen > 0 && (valStart[valLen - 1] == ' ' || valStart[valLen - 1] == '\t'))
                        valLen--;
                    if (valLen < sizeof(originVal))
                    {
                        memcpy(originVal, valStart, valLen);
                        originVal[valLen] = '\0';
                    }
                }
            }

            BOOL originAllowed = FALSE;
            if (originVal[0] == '\0')
            {
                // Direct loopback or non-browser client without Origin header
                originAllowed = TRUE;
            }
            else if (_strnicmp(originVal, "chrome-extension://", 19) == 0 ||
                     _strnicmp(originVal, "moz-extension://", 16) == 0 ||
                     _strnicmp(originVal, "edge-extension://", 17) == 0)
            {
                originAllowed = TRUE;
            }
            else if (_strnicmp(originVal, "http://127.0.0.1", 16) == 0 && (originVal[16] == '\0' || originVal[16] == ':'))
            {
                originAllowed = TRUE;
            }
            else if (_strnicmp(originVal, "http://localhost", 16) == 0 && (originVal[16] == '\0' || originVal[16] == ':'))
            {
                originAllowed = TRUE;
            }
            else if (_strnicmp(originVal, "https://127.0.0.1", 17) == 0 && (originVal[17] == '\0' || originVal[17] == ':'))
            {
                originAllowed = TRUE;
            }
            else if (_strnicmp(originVal, "https://localhost", 17) == 0 && (originVal[17] == '\0' || originVal[17] == ':'))
            {
                originAllowed = TRUE;
            }

            if (!originAllowed)
            {
                const char* badOrigResp =
                    "HTTP/1.1 403 Forbidden\r\n"
                    "Content-Type: text/plain\r\n"
                    "Connection: close\r\n\r\n"
                    "Forbidden: CORS origin not allowed\n";
                send(cs, badOrigResp, (int)strlen(badOrigResp), 0);
                closesocket(cs);
                continue;
            }

            const char* allowOrigin = originVal[0] ? originVal : "http://127.0.0.1:20809";

            if (_strnicmp(reqBuf, "OPTIONS", 7) == 0)
            {
                char resp[512];
                _snprintf_s(resp, sizeof(resp), _TRUNCATE,
                    "HTTP/1.1 204 No Content\r\n"
                    "Access-Control-Allow-Origin: %s\r\n"
                    "Access-Control-Allow-Methods: POST, GET, OPTIONS\r\n"
                    "Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With\r\n"
                    "Access-Control-Max-Age: 86400\r\n"
                    "Vary: Origin\r\n"
                    "Content-Length: 0\r\n"
                    "Connection: close\r\n\r\n",
                    allowOrigin);
                send(cs, resp, (int)strlen(resp), 0);
            }
            else if (_strnicmp(reqBuf, "POST /announce", 14) == 0)
            {
                if (body)
                {
                    JVal* root = json_parse(body, (DWORD)strlen(body));
                    if (root && root->type == J_OBJ)
                    {
                        const char* inst = json_str(root, "instanceId", "");
                        const char* ver  = json_str(root, "version", "");
                        const char* brw  = json_str(root, "browser", "chromium");

                        EnterCriticalSection(&g_syncLock);
                        g_pairedExt.paired = 1;
                        MultiByteToWideChar(CP_UTF8, 0, inst, -1, g_pairedExt.instanceId, 128);
                        MultiByteToWideChar(CP_UTF8, 0, ver,  -1, g_pairedExt.version, 32);
                        MultiByteToWideChar(CP_UTF8, 0, brw,  -1, g_pairedExt.browser, 64);
                        g_pairedExt.lastAnnounceTick = GetTickCount();
                        LeaveCriticalSection(&g_syncLock);

                        PB_WriteAppLog("PecSync: Расширение браузера спарено (версия: %s, браузер: %s)", ver, brw);

                        json_free(root);

                        // Wake up sync thread immediately to report the pairing
                        if (g_hSyncWakeEvent) SetEvent(g_hSyncWakeEvent);
                    }
                }

                char resp[512];
                _snprintf_s(resp, sizeof(resp), _TRUNCATE,
                    "HTTP/1.1 200 OK\r\n"
                    "Content-Type: application/json\r\n"
                    "Access-Control-Allow-Origin: %s\r\n"
                    "Access-Control-Allow-Methods: POST, GET, OPTIONS\r\n"
                    "Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With\r\n"
                    "Vary: Origin\r\n"
                    "Content-Length: 11\r\n"
                    "Connection: close\r\n\r\n"
                    "{\"ok\":true}",
                    allowOrigin);
                send(cs, resp, (int)strlen(resp), 0);
            }
            else if (_strnicmp(reqBuf, "GET /status", 11) == 0 || _strnicmp(reqBuf, "GET /announce", 13) == 0)
            {
                char respBody[256];
                EnterCriticalSection(&g_syncLock);
                _snprintf_s(respBody, sizeof(respBody), _TRUNCATE,
                    "{\"ok\":true,\"app\":\"PEC-App\",\"version\":\"" APP_VERSION_STR "\",\"paired\":%s}",
                    g_pairedExt.paired ? "true" : "false");
                LeaveCriticalSection(&g_syncLock);
                char resp[512];
                _snprintf_s(resp, sizeof(resp), _TRUNCATE,
                    "HTTP/1.1 200 OK\r\n"
                    "Content-Type: application/json\r\n"
                    "Access-Control-Allow-Origin: %s\r\n"
                    "Vary: Origin\r\n"
                    "Content-Length: %d\r\n"
                    "Connection: close\r\n\r\n%s",
                    allowOrigin,
                    (int)strlen(respBody), respBody);
                send(cs, resp, (int)strlen(resp), 0);
            }
            else
            {
                const char* resp = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                send(cs, resp, (int)strlen(resp), 0);
            }
        }
        closesocket(cs);
    }

    if (g_loopbackSocket != INVALID_SOCKET)
    {
        closesocket(g_loopbackSocket);
        g_loopbackSocket = INVALID_SOCKET;
    }
    WSACleanup();
    return 0;
}

// ── Background HTTP Sync Worker (POST /api/app/sync) ─────────────────────────
static DWORD WINAPI PecSyncThreadProc(LPVOID param)
{
    (void)param;
    while (g_syncRunning)
    {
        if (g_profile.pecSync.serverUrl[0] != 0)
        {
            URL_COMPONENTS uc;
            wchar_t host[256] = { 0 };
            wchar_t path[2048] = { 0 };
            ZeroMemory(&uc, sizeof(uc));
            uc.dwStructSize = sizeof(uc);
            uc.lpszHostName = host;
            uc.dwHostNameLength = 255;
            uc.lpszUrlPath = path;
            uc.dwUrlPathLength = 2047;

            if (WinHttpCrackUrl(g_profile.pecSync.serverUrl, 0, 0, &uc))
            {
                BOOL isHttps = (uc.nScheme == INTERNET_SCHEME_HTTPS);
                BOOL isLoopback = (_wcsicmp(host, L"localhost") == 0 || _wcsicmp(host, L"127.0.0.1") == 0 ||
                                   _wcsicmp(host, L"::1") == 0 || _wcsicmp(host, L"[::1]") == 0);
                if (!isHttps && !isLoopback)
                {
                    g_lastSyncError = ERROR_ACCESS_DENIED;
                    _snwprintf_s(g_lastSyncStatusStr, 128, _TRUNCATE, L"Ошибка: требуется HTTPS для удаленного сервера");
                    PB_WriteAppLog("PecSync: Insecure HTTP rejected for remote host %ls (HTTPS required)", host);
                }
                else
                {
                    HINTERNET hSession = WinHttpOpen(L"PEC-App-SyncClient/2.1",
                        WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);

                    if (hSession)
                    {
                    HINTERNET hConnect = WinHttpConnect(hSession, host, uc.nPort, 0);
                    if (hConnect)
                    {
                        size_t pl = wcslen(path);
                        while (pl > 0 && path[pl - 1] == L'/') {
                            path[--pl] = 0;
                        }
                        wchar_t fullPath[2048] = { 0 };
                        if (wcsstr(path, L"/api/app/sync"))
                        {
                            _snwprintf_s(fullPath, 2048, _TRUNCATE, L"%s", path);
                        }
                        else
                        {
                            _snwprintf_s(fullPath, 2048, _TRUNCATE, L"%s/api/app/sync", path);
                        }
                        if (fullPath[0] != L'/')
                        {
                            wchar_t temp[2048];
                            _snwprintf_s(temp, 2048, _TRUNCATE, L"/%s", fullPath);
                            lstrcpynW(fullPath, temp, 2048);
                        }

                        HINTERNET hRequest = WinHttpOpenRequest(hConnect, L"POST", fullPath, NULL,
                            WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, isHttps ? WINHTTP_FLAG_SECURE : 0);

                        if (hRequest)
                        {
                            // Build headers: use instanceToken if available (enrolled), otherwise fleetToken
                            wchar_t tokenBuf[256] = { 0 };
                            if (g_profile.pecSync.instanceToken[0] != 0)
                            {
                                lstrcpynW(tokenBuf, g_profile.pecSync.instanceToken, 256);
                            }
                            else
                            {
                                PecLoadInstanceToken(tokenBuf, 256);
                                if (tokenBuf[0] != 0)
                                {
                                    lstrcpynW(g_profile.pecSync.instanceToken, tokenBuf, 256);
                                }
                            }

                            wchar_t hdrs[512];
                            if (tokenBuf[0] != 0)
                            {
                                _snwprintf_s(hdrs, 512, _TRUNCATE,
                                    L"Content-Type: application/json\r\nx-instance-token: %ls\r\n",
                                    tokenBuf);
                            }
                            else
                            {
                                _snwprintf_s(hdrs, 512, _TRUNCATE,
                                    L"Content-Type: application/json\r\nx-fleet-token: %ls\r\n",
                                    g_profile.pecSync.fleetToken);
                            }

                            // Collect machine info
                            wchar_t username[128] = { 0 }; DWORD uLen = 128;
                            GetUserNameW(username, &uLen);
                            wchar_t hostname[128] = { 0 }; DWORD hLen = 128;
                            GetComputerNameW(hostname, &hLen);

                            char uBuf[256] = { 0 }, hBuf[256] = { 0 }, instBuf[256] = { 0 };
                            WideCharToMultiByte(CP_UTF8, 0, username, -1, uBuf, sizeof(uBuf), NULL, NULL);
                            WideCharToMultiByte(CP_UTF8, 0, hostname, -1, hBuf, sizeof(hBuf), NULL, NULL);
                            WideCharToMultiByte(CP_UTF8, 0, g_appInstanceId, -1, instBuf, sizeof(instBuf), NULL, NULL);

                            char uEsc[512] = { 0 }, hEsc[512] = { 0 }, instEsc[512] = { 0 };
                            PecJsonEscapeString(uBuf, uEsc, sizeof(uEsc));
                            PecJsonEscapeString(hBuf, hEsc, sizeof(hEsc));
                            PecJsonEscapeString(instBuf, instEsc, sizeof(instEsc));

                            char jsonBody[4096];
                            char selHostUtf8[256] = { 0 };
                            char selHostEsc[512] = { 0 };
                            int selPort = 0;
                            EnterCriticalSection(&g_syncLock);
                            if (g_selectedProxyHost[0] && g_selectedProxyPort > 0)
                            {
                                WideCharToMultiByte(CP_UTF8, 0, g_selectedProxyHost, -1, selHostUtf8, sizeof(selHostUtf8), NULL, NULL);
                                PecJsonEscapeString(selHostUtf8, selHostEsc, sizeof(selHostEsc));
                                selPort = g_selectedProxyPort;
                            }
                            if (g_pairedExt.paired)
                            {
                                char pInst[128] = { 0 }, pVer[64] = { 0 }, pBrw[64] = { 0 };
                                WideCharToMultiByte(CP_UTF8, 0, g_pairedExt.instanceId, -1, pInst, sizeof(pInst), NULL, NULL);
                                WideCharToMultiByte(CP_UTF8, 0, g_pairedExt.version, -1, pVer, sizeof(pVer), NULL, NULL);
                                WideCharToMultiByte(CP_UTF8, 0, g_pairedExt.browser, -1, pBrw, sizeof(pBrw), NULL, NULL);

                                char pInstEsc[256] = { 0 }, pVerEsc[128] = { 0 }, pBrwEsc[128] = { 0 };
                                PecJsonEscapeString(pInst, pInstEsc, sizeof(pInstEsc));
                                PecJsonEscapeString(pVer, pVerEsc, sizeof(pVerEsc));
                                PecJsonEscapeString(pBrw, pBrwEsc, sizeof(pBrwEsc));

                                if (selPort > 0)
                                {
                                    _snprintf_s(jsonBody, sizeof(jsonBody), _TRUNCATE,
                                        "{\"appInstanceId\":\"%s\",\"hostname\":\"%s\",\"username\":\"%s\","
                                        "\"version\":\"" APP_VERSION_STR "\",\"os\":\"windows-x64\",\"clientType\":\"desktop-gui\","
                                        "\"selectedProxyHost\":\"%s\",\"selectedProxyPort\":%d,"
                                        "\"pairedExtension\":{\"instanceId\":\"%s\",\"version\":\"%s\",\"browser\":\"%s\"}}",
                                        instEsc, hEsc, uEsc, selHostEsc, selPort, pInstEsc, pVerEsc, pBrwEsc);
                                }
                                else
                                {
                                    _snprintf_s(jsonBody, sizeof(jsonBody), _TRUNCATE,
                                        "{\"appInstanceId\":\"%s\",\"hostname\":\"%s\",\"username\":\"%s\","
                                        "\"version\":\"" APP_VERSION_STR "\",\"os\":\"windows-x64\",\"clientType\":\"desktop-gui\","
                                        "\"pairedExtension\":{\"instanceId\":\"%s\",\"version\":\"%s\",\"browser\":\"%s\"}}",
                                        instEsc, hEsc, uEsc, pInstEsc, pVerEsc, pBrwEsc);
                                }
                            }
                            else
                            {
                                if (selPort > 0)
                                {
                                    _snprintf_s(jsonBody, sizeof(jsonBody), _TRUNCATE,
                                        "{\"appInstanceId\":\"%s\",\"hostname\":\"%s\",\"username\":\"%s\","
                                        "\"version\":\"" APP_VERSION_STR "\",\"os\":\"windows-x64\",\"clientType\":\"desktop-gui\","
                                        "\"selectedProxyHost\":\"%s\",\"selectedProxyPort\":%d}",
                                        instEsc, hEsc, uEsc, selHostEsc, selPort);
                                }
                                else
                                {
                                    _snprintf_s(jsonBody, sizeof(jsonBody), _TRUNCATE,
                                        "{\"appInstanceId\":\"%s\",\"hostname\":\"%s\",\"username\":\"%s\","
                                        "\"version\":\"" APP_VERSION_STR "\",\"os\":\"windows-x64\",\"clientType\":\"desktop-gui\"}",
                                        instEsc, hEsc, uEsc);
                                }
                            }
                            LeaveCriticalSection(&g_syncLock);

                            DWORD bodyLen = (DWORD)strlen(jsonBody);
                            g_isSyncing = TRUE;
                            if (WinHttpSendRequest(hRequest, hdrs, (DWORD)wcslen(hdrs), jsonBody, bodyLen, bodyLen, 0) &&
                                WinHttpReceiveResponse(hRequest, NULL))
                            {
                                DWORD status = 0, statusSize = sizeof(status);
                                WinHttpQueryHeaders(hRequest, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                                    WINHTTP_HEADER_NAME_BY_INDEX, &status, &statusSize, WINHTTP_NO_HEADER_INDEX);

                                if (status == 200)
                                {
                                    g_syncEverSucceeded = TRUE;
                                    g_lastSyncError = 0;
                                    g_lastSyncTick = GetTickCount();
                                    GetLocalTime((SYSTEMTIME*)&g_lastSyncTime);
                                    _snwprintf_s(g_lastSyncStatusStr, 128, _TRUNCATE, L"Синхронизировано (%ls)", host);
                                    PB_WriteAppLog("PecSync: Синхронизация с сервером %ls выполнена успешно (HTTP 200)", host);
                                    DWORD avail = 0;
                                    char* rBuf = NULL;
                                    DWORD rLen = 0;
                                    while (WinHttpQueryDataAvailable(hRequest, &avail) && avail > 0)
                                    {
                                        if (rLen + avail > 256 * 1024) break;
                                        char* nb = (char*)realloc(rBuf, rLen + avail + 1);
                                        if (!nb) break;
                                        rBuf = nb;
                                        DWORD read = 0;
                                        if (WinHttpReadData(hRequest, rBuf + rLen, avail, &read) && read > 0)
                                            rLen += read;
                                        else break;
                                    }
                                    if (rBuf)
                                    {
                                        rBuf[rLen] = 0;
                                        JVal* respRoot = json_parse(rBuf, rLen);
                                        if (respRoot && respRoot->type == J_OBJ)
                                        {
                                            const char* issuedTok = json_str(respRoot, "instanceToken", NULL);
                                            if (issuedTok && issuedTok[0] != 0)
                                            {
                                                wchar_t wTok[256] = { 0 };
                                                MultiByteToWideChar(CP_UTF8, 0, issuedTok, -1, wTok, 256);
                                                lstrcpynW(g_profile.pecSync.instanceToken, wTok, 256);
                                                PecSaveInstanceToken(wTok);
                                                PB_ProfileSave(g_activeProfile, &g_profile);
                                            }

                                            JVal* actProxy = json_get(respRoot, "activeProxy");
                                            if (actProxy && actProxy->type == J_OBJ)
                                            {
                                                const char* nHost = json_str(actProxy, "host", "");
                                                long nPort = json_long(actProxy, "port", 0);
                                                const char* nUser = json_str(actProxy, "user", "");
                                                const char* nPass = json_str(actProxy, "pass", "");
                                                const char* nProto = json_str(actProxy, "protocol", "socks5");

                                                wchar_t wHost[128], wPort[16], wUser[128], wPass[128], wProto[16];
                                                MultiByteToWideChar(CP_UTF8, 0, nHost, -1, wHost, 128);
                                                _snwprintf_s(wPort, 16, _TRUNCATE, L"%ld", nPort);
                                                MultiByteToWideChar(CP_UTF8, 0, nUser, -1, wUser, 128);
                                                MultiByteToWideChar(CP_UTF8, 0, nPass, -1, wPass, 128);
                                                MultiByteToWideChar(CP_UTF8, 0, nProto, -1, wProto, 16);

                                                BOOL needsUpdate = FALSE;
                                                JVal* avList = json_get(respRoot, "availableProxies");
                                                if (avList && avList->type == J_ARR && avList->child)
                                                {
                                                    PBConfig newConfigs[PB_MAX_CFG];
                                                    int newCount = 0;
                                                    ZeroMemory(newConfigs, sizeof(newConfigs));

                                                    // Active proxy goes to slot 0 if valid
                                                    if (wHost[0] && _wtoi(wPort) > 0)
                                                    {
                                                        newConfigs[0].storedId = 1;
                                                        const char* aName = json_str(actProxy, "name", "Corporate Proxy");
                                                        MultiByteToWideChar(CP_UTF8, 0, aName, -1, newConfigs[0].name, 128);
                                                        lstrcpynW(newConfigs[0].host, wHost, 128);
                                                        lstrcpynW(newConfigs[0].port, wPort, 16);
                                                        lstrcpynW(newConfigs[0].user, wUser, 128);
                                                        lstrcpynW(newConfigs[0].pass, wPass, 128);
                                                        lstrcpynW(newConfigs[0].type, wProto, 16);
                                                        newConfigs[0].sendDomain = 1;
                                                        newCount = 1;
                                                    }

                                                    for (JVal* c = avList->child; c && newCount < PB_MAX_CFG; c = c->next)
                                                    {
                                                        if (c->type != J_OBJ) continue;
                                                        const char* chHost = json_str(c, "host", "");
                                                        long chPort = json_long(c, "port", 0);
                                                        const char* chUser = json_str(c, "user", "");
                                                        const char* chPass = json_str(c, "pass", "");
                                                        const char* chProto = json_str(c, "protocol", "socks5");
                                                        const char* chName = json_str(c, "name", "Proxy Node");

                                                        if (!chHost[0] || chPort <= 0) continue;

                                                        wchar_t wh[128], wp[16];
                                                        MultiByteToWideChar(CP_UTF8, 0, chHost, -1, wh, 128);
                                                        _snwprintf_s(wp, 16, _TRUNCATE, L"%ld", chPort);

                                                        // Skip if matches newConfigs[0]
                                                        if (newCount > 0 && wcscmp(newConfigs[0].host, wh) == 0 && wcscmp(newConfigs[0].port, wp) == 0)
                                                            continue;

                                                        PBConfig* cf = &newConfigs[newCount];
                                                        cf->storedId = (UINT32)(newCount + 1);
                                                        cf->sendDomain = 1;
                                                        MultiByteToWideChar(CP_UTF8, 0, chName, -1, cf->name, 128);
                                                        lstrcpynW(cf->host, wh, 128);
                                                        lstrcpynW(cf->port, wp, 16);
                                                        MultiByteToWideChar(CP_UTF8, 0, chUser, -1, cf->user, 128);
                                                        MultiByteToWideChar(CP_UTF8, 0, chPass, -1, cf->pass, 128);
                                                        MultiByteToWideChar(CP_UTF8, 0, chProto, -1, cf->type, 16);
                                                        newCount++;
                                                    }

                                                    if (newCount > 0)
                                                    {
                                                        if (g_profile.cfgCount != newCount)
                                                        {
                                                            needsUpdate = TRUE;
                                                        }
                                                        else
                                                        {
                                                            for (int i = 0; i < newCount; i++)
                                                            {
                                                                if (wcscmp(g_profile.cfg[i].host, newConfigs[i].host) != 0 ||
                                                                    wcscmp(g_profile.cfg[i].port, newConfigs[i].port) != 0 ||
                                                                    wcscmp(g_profile.cfg[i].user, newConfigs[i].user) != 0 ||
                                                                    wcscmp(g_profile.cfg[i].pass, newConfigs[i].pass) != 0 ||
                                                                    _wcsicmp(g_profile.cfg[i].type, newConfigs[i].type) != 0 ||
                                                                    wcscmp(g_profile.cfg[i].name, newConfigs[i].name) != 0)
                                                                {
                                                                    needsUpdate = TRUE;
                                                                    break;
                                                                }
                                                            }
                                                        }
                                                        if (needsUpdate)
                                                        {
                                                            g_profile.cfgCount = newCount;
                                                            for (int i = 0; i < newCount; i++)
                                                                g_profile.cfg[i] = newConfigs[i];
                                                            PB_ProfileSave(g_activeProfile, &g_profile);
                                                            if (g_hSyncMainWnd)
                                                            {
                                                                PostMessageW(g_hSyncMainWnd, WM_APP_RELOAD_PROFILE, 0, 0);
                                                            }
                                                        }
                                                    }
                                                }
                                                else
                                                {
                                                    if (g_profile.cfgCount == 0)
                                                    {
                                                        g_profile.cfgCount = 1;
                                                        g_profile.cfg[0].storedId = 1;
                                                        lstrcpynW(g_profile.cfg[0].name, L"Corporate Node", 64);
                                                        g_profile.cfg[0].sendDomain = 1;
                                                        needsUpdate = TRUE;
                                                    }
                                                    else if (wcscmp(g_profile.cfg[0].host, wHost) != 0 ||
                                                             wcscmp(g_profile.cfg[0].port, wPort) != 0 ||
                                                             wcscmp(g_profile.cfg[0].user, wUser) != 0 ||
                                                             wcscmp(g_profile.cfg[0].pass, wPass) != 0 ||
                                                             _wcsicmp(g_profile.cfg[0].type, wProto) != 0)
                                                    {
                                                        needsUpdate = TRUE;
                                                    }

                                                    if (needsUpdate)
                                                    {
                                                        lstrcpynW(g_profile.cfg[0].host, wHost, 128);
                                                        lstrcpynW(g_profile.cfg[0].port, wPort, 16);
                                                        lstrcpynW(g_profile.cfg[0].user, wUser, 128);
                                                        lstrcpynW(g_profile.cfg[0].pass, wPass, 128);
                                                        lstrcpynW(g_profile.cfg[0].type, wProto, 16);
                                                        PB_ProfileSave(g_activeProfile, &g_profile);
                                                        if (g_hSyncMainWnd)
                                                        {
                                                            PostMessageW(g_hSyncMainWnd, WM_APP_RELOAD_PROFILE, 0, 0);
                                                        }
                                                    }
                                                }
                                            }

                                            JVal* upd = json_get(respRoot, "update");
                                            if (upd && upd->type == J_OBJ)
                                            {
                                                int hasUpd = json_bool(upd, "hasUpdate", 0);
                                                const char* latestVer = json_str(upd, "latestVersion", "");
                                                const char* dlUrl = json_str(upd, "downloadUrl", "");
                                                if (hasUpd && latestVer[0] != 0 && g_hSyncMainWnd)
                                                {
                                                    wchar_t wLatest[32] = { 0 };
                                                    MultiByteToWideChar(CP_UTF8, 0, latestVer, -1, wLatest, 32);

                                                    int curVer[3] = { 0 }, latVer[3] = { 0 };
                                                    PecParseVersion(PEC_APP_VERSION, curVer);
                                                    PecParseVersion(wLatest, latVer);

                                                    if (PecCompareVersion(latVer, curVer) <= 0)
                                                    {
                                                        PB_WriteAppLog("PecSync: Update offer ignored: version not newer (latest: %ls, current: %ls)", wLatest, PEC_APP_VERSION);
                                                    }
                                                    else
                                                    {
                                                        UpdInfo* info = (UpdInfo*)calloc(1, sizeof(UpdInfo));
                                                        if (info)
                                                        {
                                                            info->available = TRUE;
                                                            lstrcpynW(info->latest, wLatest, 32);
                                                            MultiByteToWideChar(CP_UTF8, 0, dlUrl, -1, info->download, 512);
                                                            const char* sha = json_str(upd, "sha256", "");
                                                            if (sha && sha[0] != 0)
                                                            {
                                                                MultiByteToWideChar(CP_UTF8, 0, sha, -1, info->sha256, 65);
                                                            }
                                                            PostMessageW(g_hSyncMainWnd, WM_APP_UPDATE, 1, (LPARAM)info);
                                                        }
                                                    }
                                                }
                                            }
                                            json_free(respRoot);
                                        }
                                        free(rBuf);
                                    }
                                }
                                else
                                {
                                    g_lastSyncError = status;
                                    _snwprintf_s(g_lastSyncStatusStr, 128, _TRUNCATE, L"Ошибка Fleet: HTTP %lu", status);
                                    PB_WriteAppLog("PecSync: Сервер вернул ошибку HTTP %lu (URL: %ls)", status, g_profile.pecSync.serverUrl);
                                }
                            }
                            else
                            {
                                DWORD err = GetLastError();
                                g_lastSyncError = err;
                                _snwprintf_s(g_lastSyncStatusStr, 128, _TRUNCATE, L"Ошибка отправки (код %lu)", err);
                                PB_WriteAppLog("PecSync: Ошибка отправки запроса на %ls (WinHttp err %lu)", host, err);
                            }
                            WinHttpCloseHandle(hRequest);
                            g_isSyncing = FALSE;
                        }
                        else
                        {
                            DWORD err = GetLastError();
                            g_lastSyncError = err;
                            _snwprintf_s(g_lastSyncStatusStr, 128, _TRUNCATE, L"Сбой запроса (код %lu)", err);
                            PB_WriteAppLog("PecSync: WinHttpOpenRequest failed for %ls (err %lu)", fullPath, err);
                        }
                        WinHttpCloseHandle(hConnect);
                    }
                    else
                    {
                        DWORD err = GetLastError();
                        g_lastSyncError = err;
                        _snwprintf_s(g_lastSyncStatusStr, 128, _TRUNCATE, L"Сбой подключения (%ls:%d)", host, uc.nPort);
                        PB_WriteAppLog("PecSync: Не удалось подключиться к серверу %ls:%d (WinHttp error %lu)", host, uc.nPort, err);
                    }
                    WinHttpCloseHandle(hSession);
                }
                else
                {
                    DWORD err = GetLastError();
                    g_lastSyncError = err;
                    PB_WriteAppLog("PecSync: WinHttpOpen failed (err %lu)", err);
                }
                }
            }
            else
            {
                PB_WriteAppLog("PecSync: Неверный формат serverUrl (%ls)", g_profile.pecSync.serverUrl);
            }
        }
        else
        {
            PB_WriteAppLog("PecSync: serverUrl не настроен в профиле (pecSync.serverUrl пуст)");
        }

        DWORD intervalMin = g_profile.pecSync.intervalMinutes;
        if (intervalMin <= 0) intervalMin = 15;
        DWORD waitMs = (!g_syncEverSucceeded) ? 15000 : (intervalMin * 60 * 1000);

        WaitForSingleObject(g_hSyncWakeEvent, waitMs);
        ResetEvent(g_hSyncWakeEvent);
    }
    return 0;
}

// ── Public Lifecycle Control ─────────────────────────────────────────────────
static void PecSyncStart(HWND hwndMain)
{
    g_hSyncMainWnd = hwndMain;
    InitializeCriticalSection(&g_syncLock);
    PecGetOrGenInstanceId(g_appInstanceId, 128);

    g_syncRunning = TRUE;
    g_hSyncWakeEvent = CreateEventW(NULL, TRUE, FALSE, NULL);

    g_hLoopbackThread = CreateThread(NULL, 0, PecLoopbackThreadProc, NULL, 0, NULL);
    g_hSyncThread = CreateThread(NULL, 0, PecSyncThreadProc, NULL, 0, NULL);
}

static void PecSyncStop(void)
{
    g_syncRunning = FALSE;
    if (g_hSyncWakeEvent) SetEvent(g_hSyncWakeEvent);

    if (g_loopbackSocket != INVALID_SOCKET)
    {
        closesocket(g_loopbackSocket);
        g_loopbackSocket = INVALID_SOCKET;
    }

    if (g_hSyncThread)
    {
        WaitForSingleObject(g_hSyncThread, 1500);
        CloseHandle(g_hSyncThread);
        g_hSyncThread = NULL;
    }

    if (g_hLoopbackThread)
    {
        WaitForSingleObject(g_hLoopbackThread, 1500);
        CloseHandle(g_hLoopbackThread);
        g_hLoopbackThread = NULL;
    }

    if (g_hSyncWakeEvent)
    {
        CloseHandle(g_hSyncWakeEvent);
        g_hSyncWakeEvent = NULL;
    }

    DeleteCriticalSection(&g_syncLock);
}

static void PecSyncNotifyConfigChange(void)
{
    if (g_hSyncWakeEvent) SetEvent(g_hSyncWakeEvent);
}

#endif // PB_UI_PEC_SYNC_H
