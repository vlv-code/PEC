# proxy-extension-corp

[![CI Status](https://github.com/corp/proxy-extension-corp/actions/workflows/ci.yml/badge.svg)](https://github.com/corp/proxy-extension-corp/actions)
[![Python](https://img.shields.io/badge/python-3.10%2B-blue.svg)](https://www.python.org/)
[![Chrome Extension](https://img.shields.io/badge/manifest-v3-green.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Готовое корпоративное решение для **избирательного доступа к прокси через членство в Active Directory группе**.

Вместо тяжелого стека со Squid, NTLM/Kerberos и расшифровкой SSL, система использует связку **Active Directory GPO + Chrome Extension (MV3) + Xray (3x-ui) + ротация паролей**.

---

## Архитектура решения

```text
Пользователь (Windows, Chrome)
  │
  │  PAC-файл (раздаётся всем через GPO; домены из списка → PROXY/HTTPS xray-host:10809, иначе DIRECT)
  ▼
Xray / 3x-ui (http-inbound :10809)
  │  Basic-Auth — логин/пароль автоматически подставляет расширение через onAuthRequired
  │  пароль ротируется мини-сервером ежедневно через API 3x-ui
  ▼
Remnawave outbound (ключи подписки, routing по inboundTag)
  ▼
Интернет

┌──────────────────────────────────────────────┐     ┌──────────────────────────────────────────────┐
│        Chrome Extension (extension/)         │     │             Mini-Server (server/)            │
│  — Доставляется через GPO группе AD          │────>│  — FastAPI эндпоинт /creds                   │
│  — Дедупликация параллельных запросов        │     │  — Nginx (TLS + корпоративные подсети)       │
│  — Защита от зацикливания 407                │     │  — Ежедневная атомарная ротация пароля       │
│  — In-memory кэширование без записи на диск  │     │  — Хостинг обновлений /updates/ (.crx)       │
└──────────────────────────────────────────────┘     └──────────────────────────────────────────────┘
```

---

## Преимущества подхода

- **Zero-Friction для пользователя**: сайты из списка открываются прозрачно, без единого окна ввода логина и пароля.
- **Простое управление доступом через AD**: достаточно добавить пользователя в доменную группу `SEC-Proxy-VPN` — расширение установится автоматически при следующем входе. При удалении из группы расширение удаляется, и доступ прекращается.
- **Защита от утечки пароля**: пароль прокси ротируется ежедневно через API 3x-ui. Даже если сотрудник перехватит текущий пароль, он станет недействительным в течение суток.
- **Безопасность сетевого уровня**: расширение поддерживает схему `HTTPS xray-host:10809; DIRECT` (Secure Web Proxy), защищая учетные данные от перехвата в корпоративной сети.

---

## Структура репозитория

| Каталог / Файл | Описание |
|---|---|
| [`extension/`](extension/) | Исходный код Chrome Extension (Manifest V3), схема GPO и утилита упаковки `.crx` |
| ├── [`manifest.json`](extension/manifest.json) | Манифест расширения с разрешениями `webRequestAuthProvider` и `storage` |
| ├── [`background.js`](extension/background.js) | Service Worker: обработка `onAuthRequired`, дедупликация и кэш |
| ├── [`managed_schema.json`](extension/managed_schema.json) | Описание параметров политики для оснастки GPO |
| └── [`scripts/pack.py`](extension/scripts/pack.py) | Скрипт сборки `.crx` и генерации `updates.xml` для GPO |
| [`server/`](server/) | Серверная часть: раздача кредов и скрипт ротации пароля |
| ├── [`app.py`](server/app.py) | Легковесный FastAPI-сервер для отдачи учетных данных расширению |
| ├── [`rotate.py`](server/rotate.py) | Скрипт ежедневной ротации пароля инбаунда в 3x-ui |
| ├── [`nginx.conf.example`](server/nginx.conf.example) | Конфигурация Nginx: TLS, ограничение подсетей и хостинг `.crx` |
| └── [`systemd/`](server/systemd/) | Готовые systemd-сервисы и таймер ротации |
| [`docs/`](docs/) | Подробная техническая документация и пошаговый план внедрения |
| └── [`architecture-plan.md`](docs/architecture-plan.md) | Полный план внедрения, настройка GPO, PAC-файла и Xray |

---

## Быстрый старт

### 1. Серверная часть
Подробная инструкция доступна в [server/README.md](server/README.md).

```bash
# Клонирование и установка зависимостей
sudo mkdir -p /opt/mini-server
sudo cp -r server/* /opt/mini-server/
cd /opt/mini-server
python3 -m venv venv
./venv/bin/pip install -r requirements.txt

# Настройка переменных окружения
cp env.example env && chmod 600 env
# Заполнить EXT_SHARED_TOKEN и доступы к 3x-ui API

# Запуск сервиса и таймера ротации
sudo cp systemd/* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mini-server.service rotate-xray-pass.timer
```

### 2. Сборка расширения для GPO
Подробная инструкция доступна в [extension/README.md](extension/README.md).

```bash
# Сборка пакета .crx и генерация updates.xml
python extension/scripts/pack.py --base-url https://mini-server.ic.local/updates
```

Команда автоматически:
1. Создаст постоянный ключ `extension/key.pem` (сохраните его!).
2. Соберет пакет `.crx` в папку `dist/`.
3. Рассчитает постоянный **Extension ID** и сформирует `dist/updates.xml`.
4. Выведет готовые строки для оснастки управления групповыми политиками Active Directory (GPO).

### 3. Развертывание через Active Directory (GPO)
1. В GPO настройте политику `ExtensionInstallForcelist`:
   ```text
   <extension_id>;https://mini-server.ic.local/updates/updates.xml
   ```
2. В политике `ExtensionSettings` передайте JSON с общим токеном `extToken`:
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
3. Примените Security Filtering на доменную группу `SEC-Proxy-VPN`.

---

## Тестирование и верификация

Запуск полного набора юнит-тестов сервера:

```bash
python server/tests/test_server.py
```

Проверка синтаксиса расширения:

```bash
node -c extension/background.js
```

---

## Безопасность

Подробное описание модели угроз и правил безопасной эксплуатации приведено в [SECURITY.md](SECURITY.md).

---

## Лицензия

Проект распространяется под лицензией [MIT](LICENSE).
