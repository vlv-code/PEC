#!/usr/bin/env bash
# ==============================================================================
# PEC - Proxy Extension Corp
# Сценарий автоматической установки сервера через Docker & Docker Compose
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}================================================================${NC}"
echo -e "${GREEN}   PEC - Proxy Extension Corp: Установка через Docker${NC}"
echo -e "${BLUE}================================================================${NC}"

# Проверка наличия Docker
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}[!] Docker не найден. Устанавливаем официальный Docker Engine...${NC}"
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
fi

# Проверка Compose
if ! docker compose version &> /dev/null; then
    echo -e "${YELLOW}[!] Устанавливаем Docker Compose plugin...${NC}"
    apt-get update && apt-get install -y docker-compose-plugin || yum install -y docker-compose-plugin
fi

INSTALL_DIR="/opt/pec-proxy-server"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

echo -e "${GREEN}[*] Копирование конфигурации в $INSTALL_DIR...${NC}"
cp -f /app/docker-compose.yml "$INSTALL_DIR/docker-compose.yml" 2>/dev/null || true
cp -f /app/Dockerfile "$INSTALL_DIR/Dockerfile" 2>/dev/null || true

# Генерация безопасных токенов, если они не заданы
if [ ! -f "$INSTALL_DIR/.env" ]; then
    SECURE_TOKEN=$(openssl rand -hex 24)
    ADMIN_SEC_TOKEN=$(openssl rand -hex 24)
    cat <<EOF > "$INSTALL_DIR/.env"
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
EXT_SHARED_TOKEN=${SECURE_TOKEN}
ADMIN_TOKEN=${ADMIN_SEC_TOKEN}
EOF
    echo -e "${GREEN}[+] Сгенерирован защищенный токен расширения:${NC} ${YELLOW}${SECURE_TOKEN}${NC}"
    echo -e "${GREEN}[+] Сгенерирован админ-токен:${NC} ${YELLOW}${ADMIN_SEC_TOKEN}${NC}"
fi

echo -e "${GREEN}[*] Сборка и запуск контейнеров...${NC}"
docker compose up -d --build

echo -e "${BLUE}================================================================${NC}"
echo -e "${GREEN}✔ PEC - Proxy Extension Corp успешно запущен в Docker!${NC}"
echo -e "Панель управления: http://$(hostname -I | awk '{print $1}'):3000"
echo -e "Healthcheck:      http://$(hostname -I | awk '{print $1}'):3000/healthz"
echo -e "PAC Скрипт:       http://$(hostname -I | awk '{print $1}'):3000/proxy.pac"
echo -e "${BLUE}================================================================${NC}"
