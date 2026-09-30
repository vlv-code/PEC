# Corp Proxy Auth — Chrome Extension (Manifest V3)

Расширение Google Chrome (Manifest V3) для автоматической аутентификации пользователей корпоративной Active Directory группы на прокси-сервере (Xray / 3x-ui).

Расширение перехватывает запросы Basic-Auth от прокси (`details.isProxy === true`), получает актуальные учетные данные с мини-сервера и прозрачно передает их браузеру.

---

> [!IMPORTANT]
> **ВНИМАНИЕ РАЗРАБОТЧИКАМ:** Каталог `extension/` является **исходным шаблоном сборки (build template)**, а не готовым к использованию расширением. В файлах каталога содержатся плейсхолдеры конфигурации (`DEFAULT_SERVER_BASE`, токены и интервалы синхронизации).
> **НЕ загружайте каталог `extension/` напрямую в Chrome!** Для загрузки распакованного расширения используйте сгенерированный каталог `dist/unpacked/`.

---

## Особенности реализации

- **Разрешение `webRequestAuthProvider`**: использует официальный enterprise API Manifest V3 для асинхронной авторизации в прокси без блокировки основного веб-трафика.
- **In-Memory кэширование**: учетные данные хранятся только в оперативной памяти фонового процесса с временем жизни (TTL = 5 минут). На диск пароли не записываются.
- **Дедупликация запросов (Anti-Thundering Herd)**: при открытии тяжелой страницы с десятками параллельных запросов расширение объединяет их в единый сетевой вызов к мини-серверу.
- **Защита от зацикливания**: встроен предохранитель (`MAX_AUTH_ATTEMPTS = 2`) — если учетные данные не подошли даже после принудительного обновления, запрос отменяется, предотвращая зависание вкладки.
- **Отсутствие утечек памяти**: все идентификаторы запросов очищаются по событиям `onCompleted` и `onErrorOccurred`.

---

## Шаблонизация и сборка

`background.js` в этом каталоге — **исходный шаблон**. При сборке пакета (через веб-конструктор Extension Studio, при старте сервера или через `npm run build`) упаковщик подставляет вместо плейсхолдеров актуальные значения конфигурации сборки и генерирует готовую к работе папку **`dist/unpacked/`**, а также артефакты `dist/updates/extension.zip` и `dist/updates/extension.crx`:

| Плейсхолдер | Поле конфигурации | Описание |
| :--- | :--- | :--- |
| `DEFAULT_SERVER_BASE` | `defaultServerUrl` | Базовый URL сервера синхронизации PEC |
| `DEFAULT_EXT_TOKEN` | `defaultToken` | Общий токен доступа расширений к `/api/sync` |
| `SYNC_INTERVAL_MIN` | `syncIntervalMinutes` | Периодичность проверки обновлений (минуты) |
| `BYPASS_TIMEOUT_MIN` | `bypassAutoTimeoutMinutes` | Таймаут ручного обхода (минуты) |
| `BADGE_ENABLED` | `badgeIndicator` | Индикатор состояния на иконке |
| `TARGET_GROUP` | `targetGroup` | Целевая группа флота по умолчанию |

Файлы в `extension/` всегда сохраняют шаблонный вид. Значения, доставленные через GPO managed storage (`extToken`, `credsUrl`, `syncUrl`, `targetGroup`), имеют наивысший приоритет над зашитыми при сборке.

Ручные правки файлов в Studio (кнопка Save в редакторе кода) сохраняются в конфигурации и применяются при повторной сборке.

---

## Структура каталога

```text
extension/                 # Исходные шаблоны для сборщика
├── background.js         # Service Worker (шаблон)
├── managed_schema.json   # Схема Managed Storage для доставки настроек через GPO
├── manifest.json         # Манифест Manifest V3
├── popup.html            # Шаблон интерфейса всплывающего окна
├── popup.js              # Логика всплывающего окна
├── icon.png              # Иконка расширения (PNG, требование Chrome MV3)
├── icon.svg              # Векторный исходник иконки (не попадает в пакет)
├── updates.xml.example   # Пример манифеста обновлений для веб-сервера
└── README.md             # Данное руководство для разработчиков

dist/                      # Результаты сборки (генерируются автоматически)
├── unpacked/             # ГОТОВОЕ распакованное расширение для загрузки в Chrome
└── updates/              # Готовые пакеты extension.crx, extension.zip, updates.xml
```

---

## Локальное тестирование в браузере

1. Соберите проект:
   - Либо запустите сервер (`npm start` или `npm run dev`) и нажмите кнопку **«Собрать .CRX»** или **«Скачать .ZIP»** в Extension Studio,
   - Либо выполните сборку через консоль.
   - В результате появится каталог `dist/unpacked/` с подставленными значениями конфигурации.
2. Откройте Google Chrome и перейдите на страницу `chrome://extensions`.
3. Включите **Режим разработчика** (Developer mode) в правом верхнем углу.
4. Нажмите кнопку **Загрузить распакованное расширение** (Load unpacked) и выберите каталог **`dist/unpacked/`** (НЕ `extension/`!).
5. Для задания тестового токена и URL мини-сервера через GPO/реестр Windows:
   - Ветка: `HKCU\Software\Policies\Google\Chrome\3rdparty\extensions\<extension_id>\policy`
   - Строковый параметр `extToken`: ваш токен расширения
   - Строковый параметр `syncUrl`: URL эндпоинта `/api/sync`

---

## Сборка пакета `.crx` для развертывания через GPO

Для доставки расширения через Group Policy требуется упаковать его в формат `.crx` с **постоянным закрытым ключом**, чтобы `extension_id` не менялся между обновлениями.

### Сборка через TypeScript CLI (`npm run build:extension` / `pack-extension.ts`)

Запустите утилиту сборки из корня репозитория, передав целевой URL сервера:

```bash
# Через npm script
npm run build:extension -- https://mini-server.example.corp

# Или напрямую через tsx
npx tsx scripts/pack-extension.ts https://mini-server.example.corp
```

**Что делает утилита:**
1. Проверяет корректность переданного URL сервера (требует реальный адрес, защищает от пустых значений).
2. Генерирует закрытый RSA-ключ `extension/key.pem` (при первом запуске). **Сохраните этот ключ в защищенном месте!**
3. Рассчитывает точный 32-символьный **Extension ID** по открытому ключу (SPKI).
4. Генерирует готовое к загрузке распакованное расширение в `dist/unpacked/`.
5. Собирает подписанный пакет `dist/updates/extension.crx` (формат CRX3).
6. Формирует zip-архив `dist/updates/extension.zip` и манифест обновлений `dist/updates/updates.xml`.
7. Генерирует готовые файлы групповых политик GPO (`dist/updates/chrome_policy.reg`) и JSON для вставки в GPMC.

---

## Развертывание через Active Directory GPO

1. Скопируйте файлы из `dist/` на корпоративный веб-сервер (или в директорию мини-сервера `/opt/mini-server/updates/`).
2. В редакторе управления групповыми политиками создайте GPO с **Security Filtering** на целевую группу (например, `SEC-Proxy-VPN`).
3. Перейдите в раздел:
   *Конфигурация пользователя → Административные шаблоны → Google Chrome → Расширения*
4. Настройте политики:
   - **Configure the list of force-installed apps and extensions** (`ExtensionInstallForcelist`):
     ```text
     <extension_id>;https://mini-server.example.corp/updates/updates.xml
     ```
   - **Extension management settings** (`ExtensionSettings`) — задайте JSON:
     ```json
     {
       "<extension_id>": {
         "installation_mode": "force_installed",
         "update_url": "https://mini-server.example.corp/updates/updates.xml",
         "extToken": "YOUR_EXT_SHARED_TOKEN_HERE",
         "credsUrl": "https://mini-server.example.corp/creds"
       }
     }
     ```
5. Пользователи из группы получат расширение автоматически при следующем перезапуске браузера.
