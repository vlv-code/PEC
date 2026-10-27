#!/usr/bin/env bash
# ==============================================================================
# PEC - Proxy Extension Corp
# Сценарий установки и регистрации службы Linux systemd
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
    echo -e "${RED}[x] Пожалуйста, запустите скрипт с правами root (sudo)${NC}"
    exit 1
fi

echo -e "${BLUE}================================================================${NC}"
echo -e "${GREEN}   PEC - Proxy Extension Corp: Установка systemd службы${NC}"
echo -e "${BLUE}================================================================${NC}"

# Проверка наличия curl
if ! command -v curl &>/dev/null; then
    echo -e "${YELLOW}[!] curl не найден. Устанавливаем curl...${NC}"
    if command -v apt-get &>/dev/null; then
        apt-get update && apt-get install -y curl
    elif command -v dnf &>/dev/null; then
        dnf install -y curl
    elif command -v yum &>/dev/null; then
        yum install -y curl
    fi
fi

# Проверка Node.js
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}[WARNING] Node.js не найден. Внимание: загрузка и выполнение внешнего скрипта настройки репозитория (deb.nodesource.com / rpm.nodesource.com).${NC}"
    echo -e "${YELLOW}[!] В производственной среде рекомендуется предварительно устанавливать Node.js из официальных подписанных пакетов дистрибутива.${NC}"
    if command -v apt-get &>/dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs
    elif command -v dnf &>/dev/null; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
        dnf install -y nodejs
    elif command -v yum &>/dev/null; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
        yum install -y nodejs
    else
        echo -e "${RED}[x] Неподдерживаемый пакетный менеджер. Установите Node.js 20+ вручную.${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}[✔] Node.js уже установлен: $(node --version)${NC}"
fi

# Создание системной группы и пользователя
if ! getent group pecuser &>/dev/null; then
    groupadd -r pecuser 2>/dev/null || groupadd pecuser 2>/dev/null || true
fi

if ! id "pecuser" &>/dev/null; then
    echo -e "${GREEN}[*] Создание системного пользователя pecuser...${NC}"
    useradd -r -g pecuser -s /bin/false pecuser 2>/dev/null || useradd -r -s /bin/false pecuser
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="/opt/pec-proxy-server"
mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/extension" "$INSTALL_DIR/dist/updates" "$INSTALL_DIR/dist/releases"

echo -e "${GREEN}[*] Копирование файлов в $INSTALL_DIR...${NC}"
if [ -d "$SCRIPT_DIR/src" ]; then
    cp -a "$SCRIPT_DIR/." "$INSTALL_DIR/"
else
    cp -a ./. "$INSTALL_DIR/"
fi

cd "$INSTALL_DIR"
# Полные зависимости (esbuild/typescript нужны для npm run build)
npm ci || npm install

# Сборка бандла: npm start запускает dist/server.cjs, без сборки сервис
# уходит в рестарт-луп (Restart=always + отсутствие dist/).
npm run build
# После сборки dev-зависимости больше не нужны
npm prune --omit=dev

# Установка прав доступа
chown -R pecuser:pecuser "$INSTALL_DIR"
chmod 750 "$INSTALL_DIR"

# Создание защищенного файла переменных окружения (Audit H-2)
mkdir -p /etc/pec-server
chmod 750 /etc/pec-server
chown pecuser:pecuser /etc/pec-server

generate_token() {
    if command -v openssl &>/dev/null; then
        openssl rand -hex 32
    elif [ -r /dev/urandom ]; then
        od -An -tx1 -N32 /dev/urandom | tr -d ' \n'
    elif command -v node &>/dev/null; then
        node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))'
    else
        head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
    fi
}

if [ ! -f /etc/pec-server/pec-server.env ]; then
    # Генерация безопасных токенов (fleet и admin - разные!)
    SECURE_TOKEN=$(generate_token)
    ADMIN_SEC_TOKEN=$(generate_token)
    cat <<EOF > /etc/pec-server/pec-server.env
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
EXT_SHARED_TOKEN=$SECURE_TOKEN
ADMIN_TOKEN=$ADMIN_SEC_TOKEN
CREDS_STORE=$INSTALL_DIR/data/current_creds.json
EOF
    chmod 0600 /etc/pec-server/pec-server.env
    chown pecuser:pecuser /etc/pec-server/pec-server.env
    echo -e "${GREEN}[+] Сгенерирован новый файл переменных окружения /etc/pec-server/pec-server.env (права 0600)${NC}"
else
    echo -e "${GREEN}[*] Сохраняем существующий файл переменных окружения /etc/pec-server/pec-server.env${NC}"
    chmod 0600 /etc/pec-server/pec-server.env
    chown pecuser:pecuser /etc/pec-server/pec-server.env
fi

NPM_BIN="$(command -v npm || echo /usr/bin/npm)"

# Установка systemd unit
cat <<EOF > /etc/systemd/system/pec-server.service
[Unit]
Description=PEC - Proxy Extension Corp Enterprise Server
Documentation=https://github.com/corp/pec-proxy-extension-corp
After=network.target

[Service]
Type=simple
User=pecuser
Group=pecuser
WorkingDirectory=$INSTALL_DIR
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOST=0.0.0.0
EnvironmentFile=/etc/pec-server/pec-server.env
Environment=CREDS_STORE=$INSTALL_DIR/data/current_creds.json
ExecStart=$NPM_BIN start
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=pec-proxy-server

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=$INSTALL_DIR/data $INSTALL_DIR/extension $INSTALL_DIR/dist/updates $INSTALL_DIR/dist/releases

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now pec-server.service

echo -e "${BLUE}================================================================${NC}"
echo -e "${GREEN}✔ Служба pec-server успешно запущена и добавлена в автозагрузку!${NC}"
echo -e "${YELLOW}[*] Токены (ADMIN_TOKEN, EXT_SHARED_TOKEN) сохранены в /etc/pec-server/pec-server.env (права доступа 0600).${NC}"
echo -e "${YELLOW}[*] Для безопасного просмотра токенов выполните: sudo cat /etc/pec-server/pec-server.env${NC}"
echo -e "Статус службы:   systemctl status pec-server"
echo -e "Просмотр логов:   journalctl -u pec-server -f"
echo -e "Веб-интерфейс:    http://127.0.0.1:3000"
echo -e "${YELLOW}[!] ВНИМАНИЕ: Для продуктивной среды настройте обратный прокси с HTTPS (см. deploy/nginx-proxy.conf).${NC}"
echo -e "${BLUE}================================================================${NC}"
