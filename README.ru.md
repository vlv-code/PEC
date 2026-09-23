# PEC - Proxy Extension Corp

🌐 **Язык документации:** [English](README.md) | **Русский**

[![Node.js](https://img.shields.io/badge/node.js-%3E%3D20-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/docker-ready-2496ED.svg)](Dockerfile)
[![Chrome Extension](https://img.shields.io/badge/chrome%20extension-MV3-brightgreen.svg)](https://developer.chrome.com/docs/extensions/mv3/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**PEC - Proxy Extension Corp** — корпоративная система безопасного управления прокси, сборки и кастомизации браузерных расширений (Chrome Manifest V3), распространения через Active Directory GPO и автоматической ротации учетных данных в панелях Xray / 3x-ui.

---

## 🌟 Ключевые возможности

1. **Конструктор и сборщик расширений (Extension Studio)**:
   - Автоматическая компиляция и подпись `.CRX` пакета 2048-битным RSA ключом.
   - Генерация файла автоматического обновления `updates.xml` для корпоративного развертывания.
   - Три пресета интерфейса: **Self-Service Pro** (полный UI с диагностикой и кнопкой временного обхода), **Kiosk / Restricted** (read-only попап для киосков и учебных классов), **Stealth Agent** (невидимая фоновая служба).
   - Выбор цветовых стилей (Cyber Blue, Obsidian, Emerald, Sunset, Minimal Light) и векторных иконок.
   - Интерактивный интерактивный предпросмотр (**Live Extension Interactive Preview**) с переключением вкладок и реактивным симулятором состояний.

2. **Маршрутизация и Гео-базы (Smart PAC Generator)**:
   - Профили маршрутизации: выборочный прокси (DIRECT по умолчанию) или полный туннель (PROXY по умолчанию).
   - Встроенные гео-базы и категории: Корпоративный интранет, AI-сервисы (ChatGPT, Claude, Gemini), Социальные сети, Стриминговые платформы, Блокировка рекламы/телеметрии.
   - Защита от PAC script injection с валидацией паттернов, хостов и портов.

3. **Автоматическая ротация учетных данных 3x-ui / Xray**:
   - Автоматическая смена паролей в инбаунде 3x-ui по расписанию (15 мин, 1 час, 6 часов, 24 часа).
   - Атомарная запись учетных данных на диск с защитой от повреждения хранилища.
   - Встроенная SSRF-защита: блокировка обращений к метаданным облаков (`169.254.169.254`) и невалидным протоколам.

4. **Централизованный флот устройств (Fleet Management)**:
   - Регистрация подключенных инстансов расширения через heartbeat (`POST /api/sync`).
   - Защита от исчерпания памяти и DoS-атак на реестр устройств (LRU-очистка при достижении лимита).
   - Аварийный рубильник (**Global Kill-Switch**), моментально переводящий весь парк устройств в прямой режим.

5. **Безопасность и отказоустойчивость**:
   - Сегментированная политика CORS (доступ к API только для Chrome-расширений и локального хоста).
   - Встроенный rate-limiting для чувствительных эндпоинтов (`/creds`, `/api/sync`, `/api/3xui/test`).
   - Набор стандартных защитных HTTP-заголовков (`nosniff`, `SAMEORIGIN`, `strict-origin-when-cross-origin`).
   - Предупреждающий баннер в панели и консоли при работе с дефолтным токеном.

---

## 🏗 Архитектура и структура модулей

Серверная часть разбита на независимые модули:

```text
├── server.ts                  # Точка входа Express, подключение middleware, роутов и статики
├── .env                       # Активный файл переменных окружения
├── .env.example               # Шаблон всех поддерживаемых переменных
├── src/
│   ├── middleware/
│   │   └── security.ts        # Заголовки безопасности, CORS и sliding-window rate-limiter
│   ├── routes/
│   │   ├── credsRoutes.ts     # /creds, /api/sync, /proxy.pac (проверка токена и лимитов)
│   │   ├── routingRoutes.ts   # /api/routing/* (профили и пресеты маршрутизации)
│   │   ├── instancesRoutes.ts # /api/instances/*, /api/config
│   │   ├── builderRoutes.ts   # /api/builder/*, /api/extension/*
│   │   ├── rotationRoutes.ts  # /api/rotation/*, /api/3xui/test (с защитой от SSRF)
│   │   └── systemRoutes.ts    # /healthz, /api/status, /api/github/releases
│   ├── views/
│   │   └── dashboardView.ts   # HTML-шаблон и оформление веб-панели
│   ├── audit.ts               # Журнал аудита доступа и определение IP
│   ├── instances.ts           # Реестр инстансов с защитой от переполнения памяти (LRU)
│   ├── packager.ts            # Сборщик CRX, подпись RSA, генератор GPO политик
│   ├── rotate.ts              # Атомарное хранилище кредов, 3x-ui API и SSRF-валидатор
│   ├── routing.ts             # Генератор PAC-скриптов, гео-пресеты
│   ├── scheduler.ts           # Фоновый планировщик ротации паролей
│   └── types.ts               # Общие типы данных TypeScript
└── extension/                 # Исходный код расширения Chrome Manifest V3
```

---

## ⚙️ Настройка конфигурации (.env)

Скопируйте пример файла конфигурации:

```bash
cp .env.example .env
```

| Переменная | Значение по умолчанию | Описание |
| :--- | :--- | :--- |
| `PORT` | `3000` | Порт, на котором запускается веб-сервер |
| `HOST` | `0.0.0.0` | Сетевой интерфейс прослушивания |
| `EXT_SHARED_TOKEN` | `corp-proxy-secret-token-change-me` | **Важно:** Fleet-токен расширений (заголовок `X-Ext-Token`), низкие привилегии — зашивается в CRX/GPO-артефакты |
| `ADMIN_TOKEN` | *(нет; обязателен в prod)* | **Важно:** Админ-токен для ВСЕХ management-API (`X-Admin-Token`). Должен отличаться от `EXT_SHARED_TOKEN`; никогда не попадает в артефакты |
| `PUBLIC_BASE_URL` | *(пусто)* | Публичный URL сервера в updates.xml / GPO-артефактах; защищает от Host-header poisoning. **Обязателен в prod** (валидация: только origin, без пути и слэша) |
| `CREDS_STORE` | `./current_creds.json` | Путь к файлу актуальных учетных данных |
| `PROXY_CONFIG_PATH` | `./proxy_config.json` | Путь к сохраненным параметрам прокси |
| `PROXY_HOST` | `10.0.0.1` | Хост/IP корпоративного прокси |
| `PROXY_PORT` | `10809` | Порт корпоративного прокси |
| `XUI_PANEL_URL` | `https://3xui-host:2053/basepath` | URL панели 3x-ui |
| `XUI_ADMIN_USER` | `admin` | Логин администратора 3x-ui |
| `XUI_ADMIN_PASS` | `change-me` | Пароль администратора 3x-ui |
| `XUI_INBOUND_REMARK` | `squid-in` | Примечание (Remark) целевого инбаунда |

> ⚠️ **Предупреждение по безопасности:** Обязательно замените `EXT_SHARED_TOKEN` и задайте отдельный `ADMIN_TOKEN` перед запуском в рабочей среде! Дашборд и management-API авторизуются через `ADMIN_TOKEN` (заголовок `X-Admin-Token`), а не через fleet-токен.
>
> **Примечание к деплою - только один процесс.** PEC держит всё runtime-состояние в одном
> процессе (реестр инстансов, профили маршрутизации, таймер ротации) с зеркалом в локальные JSON-сторы.
> Запускайте **один** процесс сервера на каталог состояния: несколько реплик или PM2 cluster
> повредят общие сторы и разъедят in-memory состояние. Горизонтальное масштабирование потребует
> сначала внешнего общего хранилища. Персистентные записи атомарны (tmp + rename), а CIDR-правила PAC
> матчят только host-литералы IP (домены, резолвящиеся в приватные диапазоны, покрывайте
> доменными правилами вида `*.corp.local`) — см. SECURITY.md.
>

---

## 🚀 Сценарии развертывания

### Вариант 1: Локальный запуск через Node.js (Standalone)

Требования: установленный Node.js версии 20+.

```bash
# 1. Клонирование репозитория
git clone https://github.com/vlv-code/PEC.git
cd PEC

# 2. Установка зависимостей
npm install

# 3. Настройка файла .env
cp .env.example .env
nano .env   # укажите уникальные EXT_SHARED_TOKEN и ADMIN_TOKEN

# 4. Запуск в режиме разработки
npm run dev

# Либо компиляция и production-запуск
npm run build
npm start
```

Панель управления доступна по адресу `http://localhost:3000`.

---

### Вариант 2: Запуск в Docker Compose (Рекомендуется для серверов)

```bash
# 1. Настройка окружения
cp .env.example .env
nano .env

# 2. Сборка и запуск контейнера
docker compose up -d --build

# 3. Просмотр логов
docker compose logs -f pec-server
```

---

### Вариант 3: Служба Linux systemd (Ubuntu / Debian / CentOS)

Используйте автоматический скрипт:

```bash
sudo bash deploy/install-systemd.sh
```

Управление сервисом:
```bash
sudo systemctl status pec-server
sudo journalctl -u pec-server -f
sudo systemctl restart pec-server
```

---

### Вариант 4: Реверс-прокси Nginx + SSL

```bash
sudo cp deploy/nginx-proxy.conf /etc/nginx/sites-available/pec-proxy.conf
sudo ln -s /etc/nginx/sites-available/pec-proxy.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 🔒 Механизмы безопасности

- **Защита от атак по времени**: Значение токена `X-Ext-Token` проверяется через `crypto.timingSafeEqual`.
- **Защита от SSRF**: Проверка подключения к 3x-ui запрещает обращения к адресам облачных метаданных (`169.254.169.254`, `metadata.google.internal`) и небезопасным схемам (`file://`, `ftp://`).
- **Санитайзинг PAC-скрипта**: Все имена узлов, порты и доменные маски очищаются от кавычек, спецсимволов и переводов строк.
- **Ограничение частоты запросов**: Встроенные rate-limiter'ы защищают `/creds` (60 запр/мин), `/api/sync` (120 запр/мин) и `/api/3xui/test` (15 запр/мин).
- **Защита памяти реестра инстансов**: Автоматическое LRU-вытеснение устаревших записей при достижении лимита в 2000 устройств.
- **Непривилегированный пользователь**: Контейнеры Docker и сервис systemd запускаются от пользователя `pecuser`.

---

## 🧪 Тестирование и Сборка

```bash
# Проверка типов TypeScript
npm run lint

# Запуск модульных тестов (13 тестов, включая тесты безопасности)
npm test

# Сборка production бандла
npm run build
```

---

## 📄 Лицензия

Распространяется под лицензией MIT. Подробности в файле [LICENSE](LICENSE).
