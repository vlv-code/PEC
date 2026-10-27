#!/usr/bin/env bash
# ==============================================================================
# PEC - Proxy Extension Corp
# Автоматический скрипт быстрого запуска (Standalone / PM2 / NPM)
# ==============================================================================

set -euo pipefail

echo "================================================================"
echo "   PEC - Proxy Extension Corp: Standalone запуск"
echo "================================================================"

# Проверка зависимостей
command -v node >/dev/null 2>&1 || { echo "Требуется Node.js >= 18. Установите Node.js."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "Требуется npm. Установите npm."; exit 1; }

generate_token() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 32
    else
        node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))'
    fi
}

# Проверка и генерация .env при отсутствии
if [ ! -f .env ]; then
    echo "[*] Файл .env не найден. Генерация случайных токенов безопасности..."
    EXT_TOKEN=$(generate_token)
    ADM_TOKEN=$(generate_token)
    cat <<EOF > .env
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
EXT_SHARED_TOKEN=${EXT_TOKEN}
ADMIN_TOKEN=${ADM_TOKEN}
DATA_DIR=./data
EOF
    chmod 0600 .env
    echo "[+] Создан файл .env (права доступа 0600)."
    echo "[*] Токены сохранены в .env. Для просмотра: cat .env"
fi

echo "[1/3] Установка зависимостей..."
npm ci

echo "[2/3] Сборка интерфейса..."
npm run build

echo "[3/3] Запуск сервера..."
export NODE_ENV=production
export PORT=${PORT:-3000}
export HOST=${HOST:-127.0.0.1}

if command -v pm2 >/dev/null 2>&1; then
    echo "Запуск через PM2..."
    pm2 start "npm start" --name "pec-proxy-server"
    pm2 save
else
    echo "Запуск напрямую..."
    npm start
fi
