# Архитектура и план внедрения: избирательный прокси-доступ через AD-группу

> **Примечание (актуализация).** Документ изначально описывал Python-версию мини-сервера (`server/app.py`, FastAPI). Сервер переписан на TypeScript: точка входа `server.ts`, модули в `src/` (Express), деплой — `Dockerfile`, `docker-compose*.yml` и скрипты `deploy/`. Команды Python/venv ниже заменены на актуальные.

Данный документ описывает архитектуру, порядок развертывания и эксплуатационные требования для системы избирательного доступа к корпоративному VPN-прокси через связку Active Directory (GPO), Google Chrome Extension (Manifest V3) и Xray/3x-ui.

---

## 1. Архитектура решения

```
Пользователь (Windows, Chrome)
  │
  │  PAC (раздаётся всем через GPO; домены из списка → PROXY/HTTPS xray-host:10809, иначе DIRECT)
  ▼
Xray / 3x-ui (http-inbound :10809)
  │  Basic-Auth — логин/пароль автоматически подставляет расширение через onAuthRequired
  │  пароль ротируется мини-сервером ежедневно через 3x-ui API
  ▼
Remnawave outbound (ключи подписки, routing по inboundTag)
  ▼
Интернет

Расширение Chrome (extension/)
  — Устанавливается принудительно через GPO (ExtensionInstallForcelist).
  — Security Filtering на группу SEC-Proxy-VPN (доступ имеют только члены группы).
  — Раз в TTL (5 мин) или при первом 407 обращается к мини-серверу за актуальными credentials.
  — Защищено от шторма запросов (дедупликация промисов) и зацикливания авторизации (лимит попыток).

Мини-сервер PEC (server.ts + src/, Node.js/Express) [colocated с 3x-ui]
  — /creds и /api/sync: отдают текущий логин/пароль и PAC-конфиг; проверка fleet-токена (X-Ext-Token) с защитой от timing attacks. Management-API защищены отдельным админ-токеном (X-Admin-Token).
  — /updates/: раздача собранного пакета расширения (.crx) и update-манифеста (updates.xml).
  — Защищён Nginx (TLS-терминация + allow/deny по корпоративным подсетям).
  — Встроенный планировщик (src/scheduler.ts): по расписанию генерирует новый пароль, обновляет 3x-ui через API,
    сверяет результат и атомарно записывает хранилище (src/rotate.ts).
```

Squid в архитектуру не входит: фильтрацию доменов осуществляет PAC-файл, разграничение доступа по AD — GPO-scoped расширение.

---

## 2. Пошаговый план внедрения

### Этап 1. Xray / 3x-ui
1. Создать `http`-инбаунд в панели 3x-ui:
   - Слушать на интерфейсе, доступном из корпоративных подсетей (например, порт `10809`).
   - Начальные учетные данные в `accounts` — любые (будут перезаписаны скриптом ротации при первом запуске).
2. Настроить Routing / Outbound на Remnawave-балансировщик по тегу инбаунда.
3. Настроить сетевой экран: открыть порт инбаунда только для доверенных корпоративных диапазонов IP.
4. **Рекомендация по шифрованию учетных данных (Secure Web Proxy):**
   - По умолчанию схема `PROXY host:port` передает заголовок `Proxy-Authorization: Basic ...` в открытом виде по локальной сети.
   - Для предотвращения сниффинга пароля в корпоративном сегменте переведите HTTP-инбаунд на TLS и в PAC-файле используйте схему `HTTPS xray-host:10809; DIRECT`. Chrome поддерживает Secure Web Proxy и предварительно поднимает шифрованный TLS-туннель до прокси.

### Этап 2. Развертывание мини-сервера и ротации
1. Развернуть сервер одним из способов:
   - Docker: `deploy/install-docker.sh` (или вручную `docker compose up -d --build`);
   - systemd: `sudo bash deploy/install-systemd.sh` — скрипт ставит Node.js 20, собирает `dist/server.cjs`, регистрирует службу и генерирует `EXT_SHARED_TOKEN` + `ADMIN_TOKEN`.
2. Конфигурация берется из `.env` (шаблон — `.env.example`): задайте `EXT_SHARED_TOKEN`, `ADMIN_TOKEN`, `PUBLIC_BASE_URL`, доступы к 3x-ui API.
3. Nginx настраивается по шаблону `deploy/nginx-proxy.conf` (TLS-терминация, allow/deny, rate limiting).
4. Прогнать ротацию вручную через дашборд (`POST /api/rotation/rotate-now`) и убедиться, что `current_creds.json` создан с правами 0600, а пароль инбаунда в панели 3x-ui обновился.

### Этап 3. Упаковка расширения и доставка через GPO
1. **Упаковка расширения в .crx:**
   - Запустить сервер (`npm run build && npm start` или Docker) — при старте он сам соберет и подпишет пакет:
   - Сервер создаст постоянный закрытый ключ `extension/key.pem` (сохраните том для сборки последующих версий!), сформирует CRX3-пакет, рассчитает постоянный **Extension ID** и сгенерирует `dist/updates/updates.xml`.
   - Артефакты раздаются прямо сервером (`/updates/*`); в Docker держите том `pec_updates`.
2. **Настройка Active Directory Group Policy (GPO):**
   - Создать новую GPO: `Policy-Chrome-CorpProxyAuth`.
   - **Security Filtering:**
     - Удалить группу `Authenticated Users` из применения политики.
     - Добавить доменную группу пользователей `SEC-Proxy-VPN` (разрешения: *Read* + *Apply Group Policy*).
     - Добавить группу `Domain Computers` (только разрешение *Read* для чтения настроек компьютерами).
   - **Параметры политики:**
     - Путь: *User Configuration → Administrative Templates → Google Chrome → Extensions*
     - Политика: **Configure the list of force-installed apps and extensions** (`ExtensionInstallForcelist`):
       ```text
       <extension_id>;https://mini-server.ic.local/updates/updates.xml
       ```
     - Политика: **Extension management settings** (`ExtensionSettings`) — JSON конфигурация:
       ```json
       {
         "<extension_id>": {
           "installation_mode": "force_installed",
           "update_url": "https://mini-server.ic.local/updates/updates.xml",
           "extToken": "<ВАШ_EXT_SHARED_TOKEN_ИЗ_ENV>",
           "credsUrl": "https://mini-server.ic.local/creds"
         }
       }
       ```
   - Применить политику: `gpupdate /force` на тестовой рабочей станции. Проверить в браузере `chrome://policy`.

### Этап 4. PAC-файл
1. Сформировать PAC-файл:
   ```javascript
   function FindProxyForURL(url, host) {
       // Использование строковых сопоставлений исключает локальные утечки DNS
       if (dnsDomainIs(host, "blocked-domain1.com") ||
           dnsDomainIs(host, "blocked-domain2.org") ||
           shExpMatch(host, "*.target-internal.net")) {
           return "HTTPS xray-host:10809; PROXY xray-host:10809; DIRECT";
       }
       return "DIRECT";
   }
   ```
2. Раздать PAC-файл всем сотрудникам компании через существующий механизм (GPO ProxyPacUrl или GPP Registry `AutoConfigURL`).

### Этап 5. Сквозное тестирование
1. **Пользователь в группе `SEC-Proxy-VPN`:**
   - Расширение устанавливается автоматически.
   - Сайты из PAC-файла открываются прозрачно, без запроса логина и пароля в окне браузера.
2. **Пользователь вне группы:**
   - Расширение отсутствует.
   - При попытке перехода на сайт из списка браузер выдает системное окно ввода пароля Basic-Auth (без знания пароля доступ закрыт).
3. **Исключение из группы:**
   - Пользователь удаляется из AD-группы `SEC-Proxy-VPN`.
   - После обновления политик GPO и перезапуска Chrome расширение удаляется, доступ прекращается.
4. **Ротация пароля:**
   - При плановой ротации (таймер systemd) расширение при следующем обращении к прокси получает 407, мгновенно сбрасывает кэш, запрашивает новый пароль у `/creds` и продолжает работу без разрыва пользовательских сессий.

---

## 3. Файловая структура проекта

```
proxy_extention_corp/
├── docs/
│   └── architecture-plan.md       # Данный документ
├── extension/                     # Модуль расширения Chrome (Manifest V3)
│   ├── background.js              # Service worker с обработкой onAuthRequired
│   ├── managed_schema.json        # Описание политик GPO для chrome.storage.managed
│   ├── manifest.json              # Манифест расширения
│   ├── updates.xml.example        # Пример update manifest
│   └── README.md                  # Инструкция по сборке и установке расширения
├── server.ts                      # Точка входа Express-сервера
├── src/                           # Серверные модули (TypeScript)
│   ├── routes/                    # Роуты: creds, builder, rotation, instances, system
│   ├── middleware/security.ts     # CORS, security headers, токен-аутентификация, rate limiting
│   ├── packager.ts                # CRX3-упаковщик, подпись RSA, генератор GPO
│   ├── rotate.ts                  # Атомарное хранилище кредов, интеграция 3x-ui, SSRF-валидатор
│   ├── routing.ts                 # Генератор PAC, пресеты, расширение доменов
│   ├── scheduler.ts               # Планировщик ротации
│   └── views/dashboardView.ts     # HTML дашборда управления
├── deploy/                        # Скрипты установки: Docker, systemd, standalone; nginx-шаблон
├── test/                          # node:test интеграционные и модульные тесты
├── .editorconfig                  # Настройки форматирования кода
├── .gitignore                     # Правила игнорирования Git
├── CONTRIBUTING.md                # Правила участия в разработке
├── LICENSE                        # Лицензия MIT
├── README.md                      # Главное описание проекта
└── SECURITY.md                    # Политика безопасности и модель угроз
```
