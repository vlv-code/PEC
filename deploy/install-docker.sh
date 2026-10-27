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

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
    echo -e "${RED}[x] Пожалуйста, запустите скрипт с правами root (sudo)${NC}"
    exit 1
fi

echo -e "${BLUE}================================================================${NC}"
echo -e "${GREEN}   PEC - Proxy Extension Corp: Установка через Docker${NC}"
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

# Проверка наличия Docker
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}[WARNING] Docker не найден. Внимание: запуск стороннего скрипта установки (https://get.docker.com).${NC}"
    echo -e "${YELLOW}[!] Для производственной среды рекомендуется предварительная ручная установка из официальных подписанных репозиториев ОС.${NC}"
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
else
    echo -e "${GREEN}[✔] Docker уже установлен: $(docker --version)${NC}"
fi

# Проверка Compose
if ! docker compose version &> /dev/null; then
    echo -e "${YELLOW}[!] Устанавливаем Docker Compose plugin...${NC}"
    if command -v apt-get &>/dev/null; then
        apt-get update && apt-get install -y docker-compose-plugin
    elif command -v dnf &>/dev/null; then
        dnf install -y docker-compose-plugin
    elif command -v yum &>/dev/null; then
        yum install -y docker-compose-plugin
    fi
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="/opt/pec-proxy-server"
mkdir -p "$INSTALL_DIR" "$INSTALL_DIR/data" "$INSTALL_DIR/extension" "$INSTALL_DIR/dist/updates" "$INSTALL_DIR/dist/releases"

echo -e "${GREEN}[*] Копирование конфигурации и исходных файлов в $INSTALL_DIR...${NC}"
if [ -d "$SCRIPT_DIR/src" ]; then
    cp -a "$SCRIPT_DIR/." "$INSTALL_DIR/"
else
    cp -a ./. "$INSTALL_DIR/"
fi
cd "$INSTALL_DIR"

# Функция генерации безопасных токенов
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

# Генерация безопасных токенов, если они не заданы
if [ ! -f "$INSTALL_DIR/.env" ]; then
    SECURE_TOKEN=$(generate_token)
    ADMIN_SEC_TOKEN=$(generate_token)
    cat <<EOF > "$INSTALL_DIR/.env"
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
DATA_DIR=/app/data
EXT_SHARED_TOKEN=${SECURE_TOKEN}
ADMIN_TOKEN=${ADMIN_SEC_TOKEN}
XUI_PANEL_URL=
XUI_ADMIN_USER=admin
XUI_ADMIN_PASS=
XUI_INBOUND_REMARK=squid-in
EOF
    chmod 0600 "$INSTALL_DIR/.env"
    echo -e "${GREEN}[+] Сгенерирован защищенный файл переменных окружения:${NC} ${YELLOW}$INSTALL_DIR/.env${NC} (права 0600)"
else
    echo -e "${GREEN}[*] Сохраняем существующий файл переменных окружения $INSTALL_DIR/.env${NC}"
    chmod 0600 "$INSTALL_DIR/.env"
fi
echo -e "${YELLOW}[*] Токены (ADMIN_TOKEN, EXT_SHARED_TOKEN) сохранены в $INSTALL_DIR/.env (права доступа 0600).${NC}"
echo -e "${YELLOW}[*] Для безопасного просмотра выполните: sudo cat $INSTALL_DIR/.env${NC}"

echo -e "${GREEN}[*] Сборка и запуск контейнеров...${NC}"
docker compose up -d --build

echo -e "${BLUE}================================================================${NC}"
echo -e "${GREEN}✔ PEC - Proxy Extension Corp успешно запущен в Docker!${NC}"
echo -e "Локальный доступ: http://127.0.0.1:3000"
echo -e "Healthcheck:      http://127.0.0.1:3000/healthz"
echo -e "PAC Скрипт:       http://127.0.0.1:3000/proxy.pac"
echo -e "${YELLOW}[!] ВНИМАНИЕ: Сервис привязан к 127.0.0.1.${NC}"
echo -e "${YELLOW}[!] Доступ к панели по открытому протоколу HTTP без TLS небезопасен!${NC}"
echo -e "${YELLOW}[!] Для продуктивной среды настройте обратный прокси с HTTPS (см. deploy/nginx-proxy.conf).${NC}"
echo -e "${BLUE}================================================================${NC}"
