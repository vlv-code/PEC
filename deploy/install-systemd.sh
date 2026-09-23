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

if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}[x] Пожалуйста, запустите скрипт с правами root (sudo)${NC}"
    exit 1
fi

echo -e "${BLUE}================================================================${NC}"
echo -e "${GREEN}   PEC - Proxy Extension Corp: Установка systemd службы${NC}"
echo -e "${BLUE}================================================================${NC}"

# Проверка Node.js
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}[!] Node.js не найден. Устанавливаем Node.js 20 LTS...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs || yum install -y nodejs
fi

# Создание системного пользователя
if ! id "pecuser" &>/dev/null; then
    echo -e "${GREEN}[*] Создание системного пользователя pecuser...${NC}"
    useradd -r -s /bin/false pecuser
fi

INSTALL_DIR="/opt/pec-proxy-server"
mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/extension" "$INSTALL_DIR/dist/updates"

echo -e "${GREEN}[*] Копирование файлов в $INSTALL_DIR...${NC}"
cp -ru ./* "$INSTALL_DIR/"

cd "$INSTALL_DIR"
# Полные зависимости (esbuild/typescript нужны для npm run build)
npm ci || npm install

# Сборка бандла: npm start запускает dist/server.cjs, без сборки сервис
# уходит в рестарт-луп (Restart=always + отсутствие dist/).
npm run build
# После сборки dev-зависимости больше не нужны
npm prune --omit=dev

# Генерация безопасного токена
SECURE_TOKEN=$(openssl rand -hex 24)

# Установка прав доступа
chown -R pecuser:pecuser "$INSTALL_DIR"
chmod 750 "$INSTALL_DIR"

# Установка systemd unit
cat <<EOF > /etc/systemd/system/pec-server.service
[Unit]
Description=PEC - Proxy Extension Corp Enterprise Server
After=network.target

[Service]
Type=simple
User=pecuser
Group=pecuser
WorkingDirectory=$INSTALL_DIR
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOST=0.0.0.0
Environment=EXT_SHARED_TOKEN=$SECURE_TOKEN
Environment=CREDS_STORE=$INSTALL_DIR/data/current_creds.json
ExecStart=$(which npm) start
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=pec-proxy-server

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now pec-server.service

echo -e "${BLUE}================================================================${NC}"
echo -e "${GREEN}✔ Служба pec-server успешно запущена и добавлена в автозагрузку!${NC}"
echo -e "Токен расширения: ${YELLOW}${SECURE_TOKEN}${NC}"
echo -e "Статус службы:   systemctl status pec-server"
echo -e "Просмотр логов:   journalctl -u pec-server -f"
echo -e "Веб-интерфейс:    http://127.0.0.1:3000"
echo -e "${BLUE}================================================================${NC}"
