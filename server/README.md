# Mini-Server & Password Rotator

Серверная часть инфраструктуры избирательного прокси-доступа:
1. **`app.py`**: Легковесный сервис на FastAPI, выдающий актуальные учетные данные для авторизации в Xray HTTP-инбаунде по эндпоинту `/creds`.
2. **`rotate.py`**: Скрипт ежедневной ротации пароля инбаунда через REST API панели 3x-ui.

---

## Архитектура и безопасность

- **Защита от Timing Attacks**: проверка заголовка `X-Ext-Token` выполняется в константное время через `secrets.compare_digest`.
- **Атомарная запись кэша**: скрипт ротации формирует временный файл `.tmp` с правами `0600` и выполняет атомарную подмену (`os.replace`), исключая сбои `JSONDecodeError` в `app.py`.
- **Таймауты и строгая валидация**: все сетевые запросы к 3x-ui имеют таймауты (`XUI_TIMEOUT`) и проверяют статус `success` в теле ответа.
- **Поддержка внутреннего CA**: опция `XUI_INSECURE_SKIP_VERIFY` позволяет работать с самоподписанными сертификатами 3x-ui.

---

## Структура каталога

```text
server/
├── app.py                     # FastAPI приложение (эндпоинты /creds, /healthz)
├── rotate.py                  # Скрипт ротации паролей через 3x-ui API
├── requirements.txt           # Зависимости Python
├── env.example                # Шаблон конфигурационных переменных
├── nginx.conf.example         # Пример конфигурации Nginx (TLS + подсети + /updates/)
├── systemd/                   # Юниты systemd
│   ├── mini-server.service    # Сервис запуска uvicorn
│   ├── rotate-xray-pass.service # Сервис однократного запуска rotate.py
│   └── rotate-xray-pass.timer # Таймер ежедневного запуска ротации
└── tests/
    └── test_server.py         # Юнит-тесты логики сервера
```

---

## Развертывание на сервере

### 1. Подготовка окружения

Рекомендуется разворачивать сервис на том же хосте, где установлена панель 3x-ui.

```bash
# 1. Создание системного пользователя
sudo useradd -r -s /bin/false -d /opt/mini-server mini-server

# 2. Копирование файлов в /opt/mini-server
sudo mkdir -p /opt/mini-server/updates
sudo cp -r server/* /opt/mini-server/
sudo chown -R mini-server:mini-server /opt/mini-server

# 3. Создание виртуального окружения Python
sudo -u mini-server python3 -m venv /opt/mini-server/venv
sudo -u mini-server /opt/mini-server/venv/bin/pip install -r /opt/mini-server/requirements.txt
```

### 2. Настройка переменных окружения

Скопируйте `env.example` в `/opt/mini-server/env`:

```bash
sudo cp /opt/mini-server/env.example /opt/mini-server/env
sudo chmod 600 /opt/mini-server/env
sudo chown mini-server:mini-server /opt/mini-server/env
```

Заполните параметры в `/opt/mini-server/env`:
```ini
# Общий токен авторизации расширения (передается в GPO ExtensionSettings)
EXT_SHARED_TOKEN=сгенерируйте_длинный_случайный_токен

# Путь к локальному хранилищу текущих учетных данных
CREDS_STORE=/opt/mini-server/current_creds.json

# Доступ к API 3x-ui
XUI_PANEL_URL=https://127.0.0.1:2053/basepath
XUI_ADMIN_USER=admin
XUI_ADMIN_PASS=ваш_пароль_администратора
XUI_INBOUND_REMARK=squid-in
XUI_TIMEOUT=10
XUI_INSECURE_SKIP_VERIFY=true
```

### 3. Настройка Nginx

Используйте `nginx.conf.example` как основу для конфигурации виртуального хоста.
Nginx обеспечивает:
- TLS-терминацию (нужен валидный внутренний сертификат).
- Сетевой фильтр (`allow` корпоративных подсетей, `deny all`).
- Раздачу пакетов обновлений расширения из `/opt/mini-server/updates/`.
- Проксирование запросов к uvicorn на `127.0.0.1:8443`.

### 4. Запуск через systemd

```bash
# Копирование юнитов
sudo cp /opt/mini-server/systemd/* /etc/systemd/system/
sudo systemctl daemon-reload

# Включение и запуск сервиса и таймера ротации
sudo systemctl enable --now mini-server.service
sudo systemctl enable --now rotate-xray-pass.timer

# Первый ручной запуск ротации
sudo -u mini-server /opt/mini-server/venv/bin/python /opt/mini-server/rotate.py
```

---

## Тестирование

Запуск тестов локально или в CI:

```bash
python server/tests/test_server.py
```

---

## Мониторинг и логирование

Просмотр логов сервисов:
```bash
# Логи мини-сервера
journalctl -u mini-server -f

# Логи последней ротации пароля
journalctl -u rotate-xray-pass.service --no-pager

# Проверка расписания следующей ротации
systemctl list-timers rotate-xray-pass.timer
```
