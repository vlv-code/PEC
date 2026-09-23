# Corp Proxy Auth — Chrome Extension (Manifest V3)

Расширение Google Chrome (Manifest V3) для автоматической аутентификации пользователей корпоративной Active Directory группы на прокси-сервере (Xray / 3x-ui).

Расширение перехватывает запросы Basic-Auth от прокси (`details.isProxy === true`), получает актуальные учетные данные с мини-сервера и прозрачно передает их браузеру.

---

## Особенности реализации

- **Разрешение `webRequestAuthProvider`**: использует официальный enterprise API Manifest V3 для асинхронной авторизации в прокси без блокировки основного веб-трафика.
- **In-Memory кэширование**: учетные данные хранятся только в оперативной памяти фонового процесса с временем жизни (TTL = 5 минут). На диск пароли не записываются.
- **Дедупликация запросов (Anti-Thundering Herd)**: при открытии тяжелой страницы с десятками параллельных запросов расширение объединяет их в единый сетевой вызов к мини-серверу.
- **Защита от зацикливания**: встроен предохранитель (`MAX_AUTH_ATTEMPTS = 2`) — если учетные данные не подошли даже после принудительного обновления, запрос отменяется, предотвращая зависание вкладки.
- **Отсутствие утечек памяти**: все идентификаторы запросов очищаются по событиям `onCompleted` и `onErrorOccurred`.

---

## Шаблонизация background.js

`background.js` в этом каталоге — **исходный шаблон**. При сборке пакета (кнопка Build в Studio или `packageExtension`) упаковщик подставляет вместо плейсхолдеров значения из конфигурации сборки:

| Плейсхолдер | Поле конфигурации | Значение по умолчанию |
| :--- | :--- | :--- |
| `__PEC_SERVER_BASE__` | `defaultServerUrl` | `https://mini-server.ic.local` |
| `__PEC_DEFAULT_TOKEN__` | `defaultToken` | `corp-proxy-secret-token-change-me` |
| `__PEC_SYNC_INTERVAL_MIN__` | `syncIntervalMinutes` | `15` |
| `__PEC_BYPASS_TIMEOUT_MIN__` | `bypassAutoTimeoutMinutes` | `15` |
| `__PEC_BADGE_ENABLED__` | `badgeIndicator` | `true` |
| `__PEC_TARGET_GROUP__` | — | `Default Fleet` |

Файл на диске всегда сохраняет плейсхолдеры — подстановка происходит только внутри собираемого ZIP. Значения, доставленные через GPO managed storage (`extToken`, `credsUrl`, `syncUrl`, `targetGroup`), имеют приоритет над зашитыми при сборке.

Ручные правки файлов в Studio (кнопка Save в редакторе кода) защищены: повторная генерация не перезаписывает их, пока не нажата кнопка «Regenerate templates».

---

## Структура каталога

```text
extension/
├── background.js         # Service Worker расширения
├── managed_schema.json   # Схема Managed Storage для доставки настроек через GPO
├── manifest.json         # Манифест Manifest V3
├── updates.xml.example   # Пример манифеста обновлений для веб-сервера
├── scripts/
│   └── pack.py           # Скрипт сборки .crx и генерации updates.xml
└── README.md             # Данное руководство
```

---

## Локальное тестирование

1. Откройте Google Chrome и перейдите на страницу `chrome://extensions`.
2. Включите **Режим разработчика** (Developer mode) в правом верхнем углу.
3. Нажмите кнопку **Загрузить распакованное расширение** (Load unpacked) и выберите каталог `extension/`.
4. Для задания тестового токена и URL мини-сервера создайте ключ в реестре Windows:
   - Ветка: `HKCU\Software\Policies\Google\Chrome\3rdparty\extensions\<extension_id>\policy`
   - Строковый параметр `extToken`: ваш тестовый токен.
   - Строковый параметр `credsUrl`: `https://mini-server.ic.local/creds`.

---

## Сборка пакета `.crx` для развертывания через GPO

Для доставки расширения через Group Policy требуется упаковать его в формат `.crx` с **постоянным закрытым ключом**, чтобы `extension_id` не менялся между обновлениями.

### Сборка через `pack.py`

Запустите утилиту сборки из корня репозитория:

```bash
python extension/scripts/pack.py --base-url https://mini-server.ic.local/updates
```

**Что делает утилита:**
1. Находит установленный браузер Chrome/Chromium.
2. Генерирует закрытый ключ `extension/key.pem` (при первом запуске). **Сохраните этот ключ в защищенном месте!**
3. Собирает пакет `dist/corp-proxy-auth-<version>.crx`.
4. Рассчитывает точный 32-символьный **Extension ID** по алгоритму Chrome.
5. Формирует манифест `dist/updates.xml`.
6. Выводит готовые строки для вставки в оснастку управления групповыми политиками (GPMC).

---

## Развертывание через Active Directory GPO

1. Скопируйте файлы из `dist/` на корпоративный веб-сервер (или в директорию мини-сервера `/opt/mini-server/updates/`).
2. В редакторе управления групповыми политиками создайте GPO с **Security Filtering** на целевую группу (например, `SEC-Proxy-VPN`).
3. Перейдите в раздел:
   *Конфигурация пользователя → Административные шаблоны → Google Chrome → Расширения*
4. Настройте политики:
   - **Configure the list of force-installed apps and extensions** (`ExtensionInstallForcelist`):
     ```text
     <extension_id>;https://mini-server.ic.local/updates/updates.xml
     ```
   - **Extension management settings** (`ExtensionSettings`) — задайте JSON:
     ```json
     {
       "<extension_id>": {
         "installation_mode": "force_installed",
         "update_url": "https://mini-server.ic.local/updates/updates.xml",
         "extToken": "YOUR_EXT_SHARED_TOKEN_HERE",
         "credsUrl": "https://mini-server.ic.local/creds"
       }
     }
     ```
5. Пользователи из группы получат расширение автоматически при следующем перезапуске браузера.
