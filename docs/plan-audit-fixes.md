# План: правки по результатам внешнего аудита (проверенные пункты)

> Документ самодостаточный: выполняется без дополнительного контекста.
> Репозиторий: PEC (Proxy Extension Corp) — Express/TypeScript-сервер, управляющий
> корпоративным прокси-флотом через Chrome MV3-расширения (PAC, CRX3, GPO, 3x-ui).
> Node 20+; тесты `npm test` (tsx --test); «lint» = `npm run lint` (tsc --noEmit).
> Каждый пункт заканчивается зелёными `npm run lint && npm test && npm run build`.
> Пункты упорядочены по приоритету. Источник: внешний аудит; каждое утверждение
> проверено по коду — неверные пункты аудита в план не включены.

---

## P1-1. Персистентный instanceId расширения (MV3 lifecycle bug)

**Файл:** `src/extensionTemplates.ts` (шаблон `BACKGROUND_TEMPLATE`; строка 64 — генерация,
строка ~238 — единственное использование в теле `syncWithServer`).

**Проблема.** `let ephemeralInstanceId = "inst_" + Math.random()...` — переменная уровня
модуля service worker. MV3-воркер выгружается после ~30 c простоя и при каждом пробуждении
исполняет скрипт заново → новый ID. Один браузер за день регистрируется на сервере сотнями
разных ID: реестр инстансов (MAX_INSTANCES = 2000, `src/instances.ts`) превращается в churn,
пер-инстансная привязка профилей (`targetInstanceIds`) и телеметрия не работают.

**Правка.** В шаблоне заменить модульную переменную на асинхронный хелпер с сохранением в
`chrome.storage.local`:

```js
let cachedInstanceId = null;
async function getInstanceId() {
  if (cachedInstanceId) return cachedInstanceId;
  try {
    const stored = await chrome.storage.local.get(["pecInstanceId"]);
    if (stored && stored.pecInstanceId) {
      cachedInstanceId = stored.pecInstanceId;
      return cachedInstanceId;
    }
  } catch (e) {}
  const newId = "inst_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 10);
  cachedInstanceId = newId;
  try { await chrome.storage.local.set({ pecInstanceId: newId }); } catch (e) {}
  return newId;
}
```

В теле синка (`syncWithServer`, там где `instanceId: ephemeralInstanceId`) —
`instanceId: await getInstanceId(),` (функция уже async, возможен гонками пренебречь:
единый контекст воркера).

**Важно:** `extension/background.js` на диске — сгенерированная копия шаблона (перегенерируется
при старте/сборке). После правки шаблона запустить сервер/`npm run build`, чтобы tracked-копия
обновилась, и закоммитить обе. Тест: `test/purity.test.ts` («rendered background.js parses»)
должен остаться зелёным; добавить assert, что отрендеренный JS содержит `pecInstanceId` и
`chrome.storage.local`.

## P1-2. Мьютекс ротации (race condition)

**Файл:** `src/scheduler.ts`, `runManualRotation` (строки 94-110).

**Проблема.** Блокировки нет. Параллельные вызовы (двойной клик «Rotate Now», ручной вызов +
таймер) параллельно логинятся и обновляют inbound на 3x-ui и дважды пишут локальный стор.
При крестовом чередовании локальный пароль ≠ пароль на панели — десинхронизация флота.

**Правка.** Singleton-in-flight (паттерн уже используется в клиенте — `syncPromise`):

```ts
let rotationInFlight: Promise<RotationHistoryItem> | null = null;

export function runManualRotation(): Promise<RotationHistoryItem> {
  if (rotationInFlight) return rotationInFlight;
  rotationInFlight = doRunManualRotation().finally(() => { rotationInFlight = null; });
  return rotationInFlight;
}
```

Существующее тело переименовать в `doRunManualRotation` (внутреннее), логику не менять.
Тест (`test/rotation.test.ts`): два konkurrentных вызова `runManualRotation()` на медленной
мок-панели → `executeRotation`-цепочка (login) выполняется ровно один раз; второй вызов
возвращает тот же результат.

## P1-3. Единая атомарная запись JSON (`writeJsonAtomic`)

**Файлы — точки записи:** `src/instances.ts:62` (proxy config), `src/instances.ts:109`
(instances meta), `src/routing.ts:199` (profiles), `src/scheduler.ts:71-72` (rotation config +
history), `src/packager.ts:61` (build config).

**Проблема.** Прямой `fs.writeFileSync`: при SIGKILL/OOM/перезагрузке контейнера в момент
записи на диске остаётся оборванный файл. Ущерб — тихая потеря данных (чтения обёрнуты в
try/catch, сервер стартует со сбросом к дефолтам — например, молча откатится конфиг ротации),
не простой, но фикс обязателен.

**Правка.** Вынести обобщение существующего `atomicWriteCreds` (`src/rotate.ts:47-61`) в
экспортируемую утилиту `writeJsonAtomic(filePath, data)` (tmp-файл со случайным суффиксом +
`fs.renameSync`; режим 0o600 оставить). Применить во всех пяти точках вместо прямого
`writeFileSync`. НЕ трогать: запись бинарных артефактов (`packager.ts` zip/crx/xml),
`key.pem`, файлы исходников расширения (`packager.ts:306,997`) — они перегенерируемые,
расширение диффа не нужно.

Опционально (сделать, если просто): при провале `JSON.parse` на загрузке — сохранять битый
файл рядом как `<name>.corrupt-<timestamp>` перед откатом к дефолтам, чтобы облегчить разбор.

Тест: unit на `writeJsonAtomic` (tmp не остаётся, целевой файл перезаписывается атомарно);
`test/purity.test.ts` («store purity») должен остаться зелёным.

---

## P2-1. PAC: guard перед `isInNet` (синхронный DNS на каждый запрос)

**Файл:** `src/routing.ts`, генератор `generatePacScript`, строки ~335-355 (строка 345 —
`checks.push(`isInNet(host, "${ip}", "${maskToSubnet(maskNum)}")`)`).

**Проблема.** Правило r1 дефолтного профиля (`preset:corporate_internal` с CIDR 10/8,
172.16/12, 192.168/16) выполняется для КАЖДОГО запроса. `isInNet(host, ...)` с доменным
именем заставляет браузер делать синхронный DNS-резолв — фризы UI при медленном/недоступном
корпоративном DNS.

**Правка.** В генераторе отделить CIDR-чеки от доменных. Если у правила есть CIDR-чеки,
обёртывать их guard'ом «host — IP-литерал»:

```js
// эмитировать в PAC:
if (domainChecks.length || cidrChecks.length) {
  codeLines.push(`  if (\n    ${domainChecks.join(" ||\n    ") || "false"}` +
    (cidrChecks.length
      ? ` || (/^\\d{1,3}(\\.\\d{1,3}){3}$/.test(host) && (${cidrChecks.join(" || ")}))`
      : "") + `\n  ) { ... }`);
}
```

**Зафиксированное изменение семантики** (описать комментарием в коде и в README/SECURITY):
доменные имена, резолвящиеся в RFC1918, больше не матчатся CIDR-правилами — интранет-хосты
должны покрываться доменными правилами (`*.corp.local` и т.п.), literal-IP URL продолжают
матчиться. Тест (`test/pac.test.ts`): сгенерированный PAC содержит IP-guard вокруг `isInNet`;
существующие семантические тесты поправить под новое поведение.

## P2-2. Google Fonts vs CSP дашборда

**Файлы:** `src/views/dashboardView.ts:15-17` (`<link>` на fonts.googleapis.com /
fonts.gstatic.com), `server.ts:216-219` (CSP: `style-src 'self' 'unsafe-inline'; font-src 'self'`).

**Проблема.** CSP блокирует внешние шрифты — ссылки мертвы, дашборд давно рендерится
системными шрифтами; в изолированной корпоративной сети без интернета они бы и так висели.

**Правка (выбранное решение — убрать внешнюю зависимость, CSP не менять):**
- удалить строки 15-17 (`preconnect` x2 + `stylesheet`);
- в CSS-переменных/`font-family` заменить `"Plus Jakarta Sans", ...` на системный стек
  (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`), `JetBrains Mono` —
  на `ui-monospace, SFMono-Regular, Consolas, monospace` (найти по grep в файле).

Тест (`test/dashboard.test.ts`): шаблон не содержит `fonts.googleapis.com` / `fonts.gstatic.com`.

## P2-3. Дедупликация force-синка (лавина 407)

**Файл:** `src/extensionTemplates.ts`, `syncWithServer` (строки 205-310), колбэк
`onAuthRequired` (строки 314-341; `forceRefresh = attempts > 1` на строке 332).

**Проблема.** Дедупликация есть только для не-force пути (строка 211:
`if (!forceRefresh && syncPromise)`). При массовых 407-ретраях после ротации пароля каждый
ретрай со `forceRefresh=true` стартует собственный fetch к `/api/sync` → возможен само-429 от
`syncLimiter` (120/min).

**Правка.** Force-путь тоже должен переиспользовать летящий запрос, а не плодить новые:

```js
if (forceRefresh && syncPromise) {
  await syncPromise.catch(() => {});        // дождаться текущего ин-флайт
  const fresh = memoryCredsCache && (Date.now() - memoryCredsCache.fetchedAt < 2000);
  if (fresh) return memoryCredsCache;       // только что обновились — нового запроса не надо
}
```

(поставить ПЕРЕД сбросом кэша/перезаписью `syncPromise`; существующую логику
`if (!forceRefresh && syncPromise) return syncPromise;` оставить). Итог: N параллельных
ретраев схлопываются в ≤2 последовательных запроса. Тест: purity-парсер остаётся зелёным;
юнит-тест опционален (клиентский код в шаблоне).

---

## P3-1. Безопасная сериализация в `renderBackgroundJs`

**Файл:** `src/extensionTemplates.ts:448-464`.

**Проблема.** Подстановка в строковые литералы шаблона (`const FALLBACK_TOKEN = "__PEC_DEFAULT_TOKEN__";`)
простым `.replace` — значение с `"`/`\`/переводом строки разрывает литерал. Post-token-split
это admin-only (не эскалация), но фикс — гигиена.

**Правка.** Заменять плейсхолдер ВМЕСТЕ с обрамляющими кавычками на `JSON.stringify`:

```ts
.replace(/"__PEC_SERVER_BASE__"/g, JSON.stringify(serverBase))
.replace(/"__PEC_DEFAULT_TOKEN__"/g, JSON.stringify(String(cfg.defaultToken || "")))
.replace(/"__PEC_TARGET_GROUP__"/g, JSON.stringify(String(cfg.targetGroup || "Default Fleet")))
```

и в `BACKGROUND_TEMPLATE` убедиться, что плейсхолдеры стоят внутри кавычек (для указанных
трёх — так и есть; числовые плейсхолдеры не трогать). Тест (`test/crx3.test.ts` или purity):
рендер с `defaultToken = '"; evil(); "'` → результат парсится как JS и содержит payload
инертной строкой.

## P3-2. Экранирование значений в `.reg` (GPO)

**Файл:** `src/packager.ts`, `generateGpoConfig` (строки 112-147).

**Проблема.** `token`, `credsUrl`, `syncUrl`, `forcelistEntry` вставляются в текст `.reg`
без экранирования; `"` или `\` ломают файл реестра.

**Правка.** Хелпер `regEscape = (s: string) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]/g, " ")`
и применить ко всем четырём значениям. Тест: `generateGpoConfig` с токеном `a"b\c` →
односторчные значения, `.reg` валиден.

## P3-3. SSRF-hardening на 3x-ui fetch'ах

**Файл:** `src/rotate.ts` — `validateSafeEndpointUrl` (63-84), `test3xuiConnection` (~102-125),
`executeRotation` (~180-225).

**Проверено заранее (не «чинить» лишнего):** Node WHATWG-URL сам канонизирует десятичную и
hex-нотацию IP (`http://2852039166/` → hostname `169.254.169.254`), существующая проверка их
ловит. Loopback/localhost НЕ блокировать — colocated-деплой сервера и 3x-ui на одной машине
легитимен (см. docs/architecture-plan.md).

**Правка:**
1. Все fetch'и к панели (login, inbounds/list, inbounds/update — в обеих функциях): добавить
   `redirect: "manual"`; ответ с 3xx считать ошибкой («panel returned redirect — refused»).
2. В `validateSafeEndpointUrl` добавить блокировку IPv6-форм метаданных/linky-local:
   hostname вида `[fd00:ec2::254]`, `[fe80::…]` (Node оставляет скобки в `.hostname`;
   проверять после снятия скобок префиксы `fd00:ec2:` и `fe80:`).

DNS-пиннинг (резолв и проверка IP до запроса) — НЕ делать, вне объёма. Тест
(`test/rotation.test.ts`): `validateSafeEndpointUrl` отклоняет `http://[fd00:ec2::254]/`;
мок-сервер, отвечающий 302 → `test3xuiConnection` возвращает `ok: false`.

---

## D-1. Документация (без правок кода)

- README.md / README.ru.md (раздел Architecture или отдельная заметка): сервер —
  single-process, состояние в памяти одного процесса (инстансы, профили, таймер ротации);
  запуск нескольких реплик/PM2-cluster против общих сторов запрещён — потребуется внешний стор.
- README/SECURITY: заметка про изменение семантики CIDR-правил из P2-1.
- Опционально: заметка о синхронном fs I/O на hot path как осознанном компромиссе текущих
  масштабов.

---

## Порядок коммитов

1. `fix(extension): persist instanceId across service worker restarts` — P1-1
2. `fix(rotation): serialize concurrent rotations with an in-flight lock` — P1-2
3. `fix(store): atomic JSON writes for all persistent state` — P1-3
4. `fix(pac): guard isInNet behind IP-literal check to avoid sync DNS` — P2-1
5. `fix(dashboard): drop external Google Fonts (blocked by CSP)` — P2-2
6. `fix(extension): deduplicate forced syncs during 407 storms` — P2-3
7. `fix(builder): JSON.stringify template substitutions; escape .reg values` — P3-1 + P3-2
8. `fix(rotation): refuse redirects and IPv6 metadata in panel fetches` — P3-3
9. `docs: single-process limitation, PAC CIDR semantics` — D-1

## Критерии приёмки

- [ ] Расширение после перезапуска браузера/воркера синкается с тем же instanceId
      (в реестре инстансов одна запись на браузер, churn исчез).
- [ ] Двойной «Rotate Now» / вызов впритык к таймеру → одна ротация, стор и панель совпадают.
- [ ] Все персистентные JSON пишутся через tmp+rename; `kill -9` во время записи не портит
      состояние (проверить вручную хотя бы на rotation_config.json).
- [ ] Сгенерированный PAC содержит IP-guard вокруг `isInNet`; тесты PAC зелёные.
- [ ] В дашборде нет запросов к fonts.googleapis.com (DevTools Network чист).
- [ ] `defaultToken` с кавычками/слэшами не ломает рендер background.js.
- [ ] `.reg` с спецсимволами в токене импортируется без ошибок.
- [ ] Панель, отвечающая 302, и `http://[fd00:ec2::254]/` отклоняются с `ok: false`.
- [ ] `npm run lint && npm test && npm run build` зелёные; CI зелёный.

## Ограничения (не сломать)

- Токенная модель (fleet `X-Ext-Token` / admin `X-Admin-Token`) не меняется.
- `/proxy.pac`, `/healthz`, `/updates/*`, `/api/ip-echo` остаются публичными; rate limiters
  и audit-логика — без изменений.
- Loopback/localhost в `validateSafeEndpointUrl` НЕ блокировать (легитимный colocated-деплой).
- Протокол managed storage расширения (`extToken`, `credsUrl`, `syncUrl`, `targetGroup`)
  не менять — полевые расширения должны продолжить синк без переустановки.
- Числовые плейсхолдеры `__PEC_SYNC_INTERVAL_MIN__` и др. рендерятся как раньше (не JSON'ить).
- Не рефакторить `dashboardView.ts` на SPA и не переводить fs I/O на async — вне объёма.
