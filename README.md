# PEC - Proxy Extension Corp

[![Release](https://img.shields.io/badge/release-v1.3.0-blue.svg)](https://github.com/corp/pec-proxy-extension-corp/releases)
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
   - Интерактивный интерактивный предпросмотр (**Live Extension Interactive Preview**) с переключением вкладок и реактивным симулятором состояний (**Simulated Extension State**).

2. **Маршрутизация и Гео-базы (Smart PAC Generator)**:
   - Профили маршрутизации: выборочный прокси (DIRECT по умолчанию) или полный туннель (PROXY по умолчанию).
   - Встроенные гео-базы и категории: Корпоративный интранет, AI-сервисы (ChatGPT, Claude, Gemini), Социальные сети, Стриминговые платформы, Блокировка рекламы/телеметрии.
   - Поддержка масок доменов (`*.corp.internal`), регулярных выражений и IP/CIDR правил (`10.0.0.0/8`, `192.168.0.0/16`).
   - Защита от PAC script injection с валидацией входных паттернов.

3. **Автоматическая ротация учетных данных 3x-ui / Xray**:
   - Автоматическая смена паролей в инбаунде 3x-ui по расписанию (15 мин, 1 час, 6 часов, 24 часа).
   - Атомарная запись учетных данных на диск с защитой от повреждения хранилища.
   - Защита от перебора: Rate-limiting и криптостойкое сравнение токенов (`crypto.timingSafeEqual`).

4. **Централизованный флот устройств (Fleet Management)**:
   - Регистрация подключенных инстансов расширения через heartbeat (`POST /api/sync`).
   - Мониторинг версий, IP-адресов, времени отклика и назначение профилей маршрутизации группам устройств.
   - Аварийный рубильник (**Global Kill-Switch**), моментально переводящий весь парк устройств в прямой режим.

5. **Готовые сценарии установки**:
   - 🐳 **Docker & Docker Compose**: изолированный production multi-stage образ с постоянными томами.
   - 🐧 **Linux systemd служба**: автоматический скрипт установки для Ubuntu / Debian / RHEL с запуском от непривилегированного пользователя `pecuser`.
   - 🛡️ **Nginx Reverse Proxy & SSL**: конфигурация с поддержкой WebSocket, защитой заголовков и кешированием PAC/CRX.
   - 🏢 **Active Directory GPO**: генерация готовых файлов реестра Windows (`.reg`) и JSON-схемы политик `ExtensionInstallForcelist`.

---

## 🏗 Архитектура решения

```text
  Клиентские компьютеры (Windows / macOS / Linux)
  ├── Браузер Google Chrome с расширением PEC (MV3)
  │    ├── Автоподстановка логина и пароля через onAuthRequired
  │    ├── Периодический опрос /api/sync для получения актуальных настроек
  │    └── Применение PAC-скрипта (локальная избирательная маршрутизация)
  │
  ▼
  PEC Server (:3000 / :443 HTTPS через Nginx)
  ├── GET /proxy.pac          ── Динамический PAC-скрипт с правилами профиля
  ├── GET /creds              ── Безопасная выдача логина/пароля (защита токеном)
  ├── POST /api/sync          ── Heartbeat флота и телеметрия инстансов
  ├── GET /updates/extension.crx ── Раздача подписанного пакета расширения
  └── Планировщик ротации     ── Обращается к API 3x-ui и обновляет пароль
        │
        ▼
  Шлюз Xray / 3x-ui (:10808/:10809) ──> Внешний интернет / Корпоративные ресурсы
```

---

## 🚀 Сценарии развертывания

### Вариант 1: Docker Compose (Рекомендуемый)

```bash
# Клонирование репозитория
git clone https://github.com/corp/pec-proxy-extension-corp.git
cd pec-proxy-extension-corp

# Запуск в фоновом режиме
docker compose up -d --build

# Проверка статуса
docker compose ps
docker compose logs -f pec-server
```

Панель управления будет доступна по адресу `http://<IP_СЕРВЕРА>:3000`.

### Вариант 2: Linux systemd служба (Ubuntu / Debian / CentOS)

```bash
sudo bash deploy/install-systemd.sh
```

Скрипт автоматически:
- Установит зависимости Node.js 20 LTS;
- Создаст системного пользователя `pecuser`;
- Разместит сервис в `/opt/pec-proxy-server`;
- Создаст безопасный токен и зарегистрирует systemd unit `pec-server.service`;
- Запустит службу в автозагрузке.

Управление службой:
```bash
sudo systemctl status pec-server
sudo journalctl -u pec-server -f
sudo systemctl restart pec-server
```

### Вариант 3: Реверс-прокси Nginx + SSL

Скопируйте конфигурацию из `deploy/nginx-proxy.conf` в `/etc/nginx/sites-available/pec-proxy.conf`, укажите домен и сертификаты Let's Encrypt:
```bash
sudo cp deploy/nginx-proxy.conf /etc/nginx/sites-available/pec-proxy.conf
sudo ln -s /etc/nginx/sites-available/pec-proxy.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 🔒 Безопасность

- **Защита от перебора токена**: Сравнение корпоративного токена `X-Ext-Token` выполняется в постоянном времени с помощью `crypto.timingSafeEqual`, предотвращая тайминг-атаки.
- **Санитайзинг PAC-скрипта**: Все домены, маски и IP-диапазоны очищаются от управляющих символов и кавычек перед конструированием функции `FindProxyForURL`.
- **Изоляция окружения**: Dockerfile использует non-root пользователя `pecuser` (UID 1001), а systemd служба защищена параметрами `NoNewPrivileges=true`, `ProtectSystem=full`, `PrivateTmp=true`.
- **Защита данных**: Приватные ключи подписи (`key.pem`) и файлы сессий пользователей исключены из системы контроля версий через `.gitignore`.

---

## 🧪 Тестирование и Сборка

```bash
# Проверка типов TypeScript
npm run lint

# Запуск набора модульных тестов
npm test

# Сборка production бандла
npm run build
```

---

## 📄 Лицензия

Проект распространяется под лицензией MIT. Подробнее см. в файле [LICENSE](LICENSE).
