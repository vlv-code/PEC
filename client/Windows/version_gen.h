#ifndef VERSION_GEN_H
#define VERSION_GEN_H

#define PB_VER_MAJOR 1
#define PB_VER_MINOR 0
#define PB_VER_PATCH 8
#define PB_VER_BUILD 0
#define PB_VER_STR "1.0.8"
#define PB_VER_STRW L"1.0.8"

#define APP_VER_MAJOR 1
#define APP_VER_MINOR 0
#define APP_VER_PATCH 8
#define APP_VER_BUILD 0
#define APP_VERSION_STR "1.0.8.0"
#define APP_VERSION_STRW L"1.0.8.0"
#define APP_VERSION_W L"1.0.8"
#define APP_VERSION_NARROW "1.0.8"
#define VERSION "1.0.8"
#define VERSION_W L"1.0.8"

#ifndef APP_VERSION
#define APP_VERSION L"1.0.8"
#endif

#ifndef PEC_DEFAULT_SERVER_URL
#define PEC_DEFAULT_SERVER_URL "https://update.example.com"
#define PEC_DEFAULT_SERVER_URL_W L"https://update.example.com"
#endif

#ifndef PEC_DEFAULT_FLEET_TOKEN
#define PEC_DEFAULT_FLEET_TOKEN "corp-proxy-secret-token-change-me"
#define PEC_DEFAULT_FLEET_TOKEN_W L"corp-proxy-secret-token-change-me"
#endif

#endif // VERSION_GEN_H
