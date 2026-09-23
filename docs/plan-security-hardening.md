# План: разделение fleet/admin токенов + hardening-правки

> Документ самодостаточный: выполняется без дополнительного контекста.
> Репозиторий: PEC (Proxy Extension Corp) — Express/TypeScript-сервер, управляющий
> корпоративным прокси-флотом через Chrome MV3-расширения (PAC, CRX3, GPO, 3x-ui).
> Node 20+, тесты: `tsx --test test/*.test.ts`, «lint» = `tsc --noEmit` (ESLint нет).
> Все команды выполнять из корня репозитория. После каждого шага должны быть зелёными:
> `npm run lint && npm test && npm run build`.

---

## Часть 1. Разделить fleet-токен и admin-токен (главная задача)

### 1.0. Проблема (почему меняем)

Сейчас существует один секрет `EXT_SHARED_TOKEN` (`server.ts:56-57`), который одновременно:

- аутентифицирует расширения флота (`X-Ext-Token` на `/api/sync`, `/creds` — `src/routes/credsRoutes.ts:34,76`);
- открывает **все админ-API** (`/api/*` gate в `server.ts:91-98`, включая `POST /api/builder/file` — правка кода расширения, раскатываемого на весь флот);
- запекается в публично скачиваемый без авторизации артефакт `/updates/extension.crx` (строковая подстановка `defaultToken` в `background.js` при упаковке — `src/extensionTemplates.ts:459`, `src/packager.ts:904-905`);
- пишется в реестр рабочих станций через GPO `.reg` (`generateGpoConfig` — `src/packager.ts:112-147`, вызывается с тем же токеном из `src/routes/builderRoutes.ts:78-81`).

Следствие: любой, кто скачал CRX или открыл реестр на любой рабочей станции (включая
рядовых сотрудников), получает полный админ-доступ к системе.

### 1.1. Целевая схема

| | Fleet-токен | Admin-токен |
|---|---|---|
| Env-переменная | `EXT_SHARED_TOKEN` (существующая) | `ADMIN_TOKEN` (новая) |
| HTTP-заголовок | `X-Ext-Token` (без изменений) | `X-Admin-Token` (новый) |
| Кому выдаётся | браузерные расширения (baked в CRX + GPO `extToken`) | только операторы/дашборд |
| Что открывает | `POST /api/sync`, `GET /creds` | все остальные `/api/*` |
| Где допустим в артефактах | да (теперь это низкие привилегии) | нигде и никогда |

Правила разделения строгие, без пересечений:

- `/creds` и `/api/sync` принимают **только** fleet-токен (admin-токен там не работает).
- Все остальные `/api/*` (кроме публичных `/api/ip-echo`, `/api/sync`) принимают **только** admin-токен.
- `/proxy.pac`, `/healthz`, `/updates/*` остаются публичными (PAC браузеры без заголовков не запрашивают — не трогать).
- Код расширения (`extension/background.js`, `extension/managed_schema.json`) **не меняется**:
  он уже читает `chrome.storage.managed.extToken || FALLBACK_TOKEN` (`background.js:64-72`),
  в обеих ролях теперь будет fleet-токен.

### 1.2. Bootstrap `ADMIN_TOKEN` (server.ts)

В `server.ts`, рядом с чтением `EXT_SHARED_TOKEN` (строки 56-58):

1. Прочитать `ADMIN_TOKEN`.
2. Если не задан **и** `NODE_ENV=production` — `console.error` с внятным текстом и `process.exit(1)` (fail fast; compose и так требует переменные через `${VAR:?}`).
3. Если не задан в dev-режиме — сгенерировать эпизодический `crypto.randomBytes(24).toString("base64url")`, напечатать в консоль один раз с пометкой «только для разработки, перезапуск сменит токен». Это уже знакомый кодовой базе паттерн (`ensureCredsStore` в `src/rotate.ts:17-25`).
4. Предупреждение о дефолтном fleet-токене (существующее, `server.ts:182-184`) остаётся; добавить аналогичное для отсутствующего `ADMIN_TOKEN`.

### 1.3. Middleware (src/middleware/security.ts)

`createTokenAuthMiddleware` (`security.ts:138-157`) обобщить параметром имени заголовка:

```ts
createTokenAuthMiddleware(getToken: () => string, headerName = "x-ext-token")
```

Логику (timing-safe сравнение, audit-запись 401) не менять. Для admin-инстанса
передать `"x-admin-token"`.

### 1.4. Разводка в server.ts

- `adminAuth = createTokenAuthMiddleware(() => ADMIN_TOKEN, "x-admin-token")` — gate на `/api` (`server.ts:91-98`) меняет источник токена, структура gate не меняется.
- `createCredsRouter(() => EXT_SHARED_TOKEN)` — без изменений (fleet).
- `createBuilderRouter(...)` (`server.ts:119`) — теперь принимает **fleet**-геттер (см. 1.5).
- `createSystemRouter({ getSharedToken ... })` (`server.ts:121-128`) — использует токен только для `tokenConfigured`/`defaultTokenInUse` в `/api/status`; добавить поля `adminTokenConfigured: boolean` и оставить `fleetDefaultTokenInUse` для fleet-токена.

### 1.5. builderRoutes + packager: в артефакты только fleet-токен

- `src/routes/builderRoutes.ts:15` — параметр `getSharedToken` переименовать в `getFleetToken` (используется единственное место: `/api/extension/info`, строки 78-81, → `generateGpoConfig(info.extensionId, baseUrl, fleetToken)`).
- `src/packager.ts`:
  - `DEFAULT_BUILD_CONFIG.defaultToken` (строка 38) больше не хардкод-литерал по умолчанию: инициализировать значением `process.env.EXT_SHARED_TOKEN || "corp-proxy-secret-token-change-me"`. Это заодно чинит дрейф «выставил env, а в CRX остался литерал».
  - В `saveBuildConfig` (строки 56-64) добавить предупреждение в консоль, если сохраняемый `defaultToken` совпадает с текущим `ADMIN_TOKEN` (передавать admin-токен в packager не нужно — достаточно колбэка-геттера через параметр или отдельной проверки в роуте).
- Проверить, что `POST /api/builder/build` и стартовая упаковка (`server.ts:70`) нигде не подмешивают admin-токен.

### 1.6. Дашборд (src/views/dashboardView.ts)

- `adminFetch` (строки 1599-1603): заголовок `'X-Ext-Token'` → `'X-Admin-Token'`.
- Подписи полей ввода токена: строки 1510, 2072 (en), 2311 (ru) — текст «X-Ext-Token Header Value» → «X-Admin-Token Header Value».
- Ключ sessionStorage `ADMIN_TOKEN_KEY` можно оставить как есть (в HTML токен не попадал и не должен — это уже так).
- Тексты логин-модалки: уточнить, что вводится **админ**-токен, а не токен расширения.

### 1.7. Деплой и конфиги

- `.env.example`: добавить `ADMIN_TOKEN=` с комментарием (обязателен в prod; отдельно от `EXT_SHARED_TOKEN`, не должен совпадать с ним; добавить и в таблицу в `README.md`/`README.ru.md`).
- `docker-compose.yml` и `docker-compose.prod.yml`: `- ADMIN_TOKEN=${ADMIN_TOKEN:?Set ADMIN_TOKEN in .env}` (по образцу `EXT_SHARED_TOKEN`, `docker-compose.prod.yml:16`).
- `deploy/install-systemd.sh`, `deploy/install-standalone.sh`, `deploy/install-docker.sh`: добавить запрос/подстановку `ADMIN_TOKEN` (в скриптах сейчас обрабатывается только `EXT_SHARED_TOKEN` — найти по grep).
- `deploy/pec-server.service` / EnvironmentFile — проверить, что `.env` подхватывается целиком (сейчас да, отдельная правка не нужна, если токен в `.env`).
- `CHANGELOG.md`: запись о **breaking change** — админ-API теперь требует `X-Admin-Token` вместо `X-Ext-Token`; старые скрипты, дергавшие админку флит-токеном, сломаются намеренно.
- `SECURITY.md` и README (раздел Security Hardening): описать двухтокенную модель и угрозную модель артефактов (в CRX/GPO лежит низкопривилегированный fleet-токен).

### 1.8. Тесты

Обновить затронутые: `test/security.test.ts` (middleware), `test/http.test.ts` (матрица доступа), `test/dashboard.test.ts` (заголовок в шаблоне), при необходимости `test/purity.test.ts`/`test/crx3.test.ts`.

Добавить обязательные новые кейсы:

1. Fleet-токен на админ-роуте (`/api/status`) → 401.
2. Admin-токен на админ-роуте → 200.
3. Admin-токен на `/creds` и на `/api/sync` → 403 (строгая изоляция).
4. Fleet-токен на `/creds` и `/api/sync` → 200 (как раньше).
5. `NODE_ENV=production` без `ADMIN_TOKEN` → процесс завершается с ошибкой (можно вынести bootstrap в тестируемую функцию).
6. Отрендеренный `background.js` (после `renderBackgroundJs`) и GPO `.reg` содержат fleet-токен и **не содержат** admin-токен.

### 1.9. Ручная приёмка (после запуска `npm run dev`)

```bash
FLEET=<значение EXT_SHARED_TOKEN>; ADMIN=<значение ADMIN_TOKEN>
# 1) fleet на админке -> 401
curl -si -H "X-Ext-Token: $FLEET" http://localhost:3000/api/status | head -1
# 2) admin на админке -> 200
curl -si -H "X-Admin-Token: $ADMIN" http://localhost:3000/api/status | head -1
# 3) admin на /creds -> 403 ; fleet на /creds -> 200
curl -si -H "X-Admin-Token: $ADMIN" http://localhost:3000/creds | head -1
curl -si -H "X-Ext-Token: $FLEET"  http://localhost:3000/creds | head -1
# 4) в публичном артефакте нет админ-токена
curl -s http://localhost:3000/updates/extension.zip -o /tmp/ext.zip
unzip -p /tmp/ext.zip background.js | grep -F "$ADMIN"   # пусто
unzip -p /tmp/ext.zip background.js | grep -F "$FLEET"   # есть
```

Дашборд: вход с admin-токеном работает, вкладки открываются; экспорт GPO из
`/api/extension/info` содержит fleet-токен.

---

## Часть 2. Быстрые фиксы (мелкие, отдельными коммитами)

### 2.1. Sandbox для превью в Studio

`src/views/dashboardView.ts:1277` — на элемент `<iframe id="previewFrame">` добавить
`sandbox="allow-scripts"` (исполнение скриптов превью остаётся, но origin становится
opaque: доступ к `sessionStorage` дашборда и к его origin невозможен).
`srcdoc` присваивается на строках 3055-3060 — там правок не нужно.
Опционально усилить слушатель `window.addEventListener('message', ...)` (строка ~3063):
проверять `e.source === document.getElementById('previewFrame').contentWindow`.
Тест: в `test/dashboard.test.ts` добавить assert, что шаблон содержит
`iframe id="previewFrame"` с атрибутом `sandbox="allow-scripts"`.

### 2.2. XSS: имя релиза GitHub

`src/views/dashboardView.ts:1815` — `${data.latestRelease.name || ('v' + data.latestRelease.version)}`
обернуть в `esc(...)` (функция `esc` уже используется соседним блоком списка релизов,
строки 1832-1835). Тест: рендер с `name: '<img src=x onerror=alert(1)>'` экранируется.

### 2.3. try/catch на `/api/3xui/test`

`src/routes/rotationRoutes.ts:57-68` — обернуть handler в try/catch, на ошибку отвечать
`res.status(500).json({ ok: false, error: msg })` (по образцу соседнего
`/api/rotation/rotate-now`, строки 40-56). Express 4 async-реджекты не ловит — сейчас
любой вылет за пределами внутренней проверки роняет процесс.
Опционально: в `server.ts` добавить страховку
`process.on("unhandledRejection", (r) => console.error("[unhandledRejection]", r))`.

### 2.4. Bump esbuild

`package.json`, devDependencies: `"esbuild": "^0.24.0"` → `"^0.28.0"` (минимально `^0.25.0`;
закрывает GHSA-67mh-4wv8-2f99 — уязвим dev-сервер esbuild, в прод-образ не попадает,
но CVE лучше закрыть). Затем `npm install` (обновится `package-lock.json`), проверить
`npm run build` (используемые флаги `--bundle --platform=node --format=cjs --packages=external --outfile`
в 0.25+ не менялись) и `npm test`.

---

## Часть 3. Конфиг-харднинг

### 3.1. PUBLIC_BASE_URL: валидация и обязательность в prod

Сейчас при незаданном `PUBLIC_BASE_URL` базовый URL выводится из Host-заголовка
(`src/audit.ts:50-63`) — `pacUrl` (ответ `/api/sync`) и `codebase` в `updates.xml`
отравляемы. Правки:

- `server.ts` (startup): если `PUBLIC_BASE_URL` задан — валидировать строгим форматом
  origin (`/^https?:\/\/[a-z0-9.\-]+(:\d{1,5})?$/i`, без пути и слэша в конце);
  невалидный → `console.error` + `process.exit(1)`. Если не задан — однократное громкое
  `console.warn`: «артефакты будут строиться из Host-заголовка; задайте PUBLIC_BASE_URL».
- `docker-compose.prod.yml`: сделать обязательным `- PUBLIC_BASE_URL=${PUBLIC_BASE_URL:?...}`.
- `.env.example` и таблица в README: пометить как обязательный для prod.

### 3.2. /proxy.pac — задокументировать принятый риск

Код не менять (PAC браузеры запрашивают без заголовков, аутентификация невозможна).

- `SECURITY.md`: раздел «Public PAC endpoint» — эндпоинт раскрывает хост/порт прокси и
  политику маршрутизации любому, имеющему сетевой доступ; митигируется сегментацией сети.
- `deploy/nginx-proxy.conf`: добавить закомментированный пример allow/deny для
  `location /proxy.pac` и `location /updates/` ( corporate CIDR).

---

## Часть 4. Чистка репозитория

1. `git rm -r server/` — закоммиченные остатки Python-версии (`server/README.md`,
   `server/nginx.conf.example`, `server/systemd/*`). Функционально заменены `deploy/`.
2. Обновить устаревшие упоминания Python/`server/` в документации:
   - `CONTRIBUTING.md:32-35` — команды `python -m py_compile server/app.py ...` и
     `python server/tests/test_server.py` заменить на `npm run lint` и `npm test`;
   - `.github/pull_request_template.md:13` — чекбокс про `python server/tests/test_server.py`
     заменить на `npm test`;
   - `docs/architecture-plan.md:28,68,162` — ссылки на `server/` заменить на актуальную
     структуру (`server.ts`, `src/...`), nginx-шаблон — на `deploy/nginx-proxy.conf`.
3. Локальный незакоммиченный мусор (в git их нет, `.gitignore` уже покрывает) — удалить с
   диска: `server/__pycache__/`, `extension/scripts/__pycache__/`, `dist/`
   (`dist/` перегенерируется при старте сервера, `server.ts:70`).
4. `metadata.json` — служебный файл AI-редактора (описание проекта, `majorCapabilities`).
   Если командой не используется — `git rm metadata.json`; если используется — оставить
   как есть. По умолчанию: спросить владельца, не удалять молча.

---

## Порядок выполнения и коммиты

Предлагаемая последовательность (каждый коммит — зелёные lint/test/build):

1. `feat(security): split fleet and admin tokens` — части 1.2–1.8 + деплой/доки 1.7.
2. `fix(dashboard): sandbox the studio preview iframe and escape release names` — 2.1, 2.2.
3. `fix(rotation): catch async errors on the 3x-ui test endpoint` — 2.3.
4. `chore(deps): bump esbuild to 0.28` — 2.4.
5. `fix(config): validate PUBLIC_BASE_URL, require it in prod compose` — 3.1 + 3.2 (доки).
6. `chore(repo): remove legacy Python server dir and stale docs references` — часть 4.

## Критерии приёмки (итогово)

- [ ] Матрица доступов 1.9 проходит вручную; автотесты 1.8 зелёные.
- [ ] В `/updates/extension.zip` (публичный артефакт) отсутствует admin-токен.
- [ ] GPO-экспорт содержит fleet-токен; дашборд работает с `X-Admin-Token`.
- [ ] `NODE_ENV=production` без `ADMIN_TOKEN` не стартует; compose без переменных не стартует.
- [ ] Превью в Studio работает в sandbox (вкладки, симулятор состояний, postMessage).
- [ ] `npm audit` не показывает GHSA-67mh-4wv8-2f99.
- [ ] `server/` удалён; в CONTRIBUTING/PR-шаблоне/architecture-plan нет Python-команд.
- [ ] `npm run lint && npm test && npm run build` зелёные; CI на GitHub зелёный.

## Ограничения (не сломать)

- Не добавлять авторизацию на `/proxy.pac`, `/healthz`, `/updates/*`, `/api/ip-echo`.
- Не менять протокол расширения: `managed_schema.json` и `background.js` по коду не
  трогаем (только комментарии при необходимости) — расширения в поле продолжат работать.
- Сравнение токенов остаётся timing-safe (SHA-256 + `timingSafeEqual`).
- Rate limiters и audit-логика не меняются, кроме источника/имени заголовка токена.
