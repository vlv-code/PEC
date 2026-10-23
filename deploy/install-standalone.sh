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

echo "[1/3] Установка зависимостей..."
npm install

echo "[2/3] Сборка интерфейса..."
npm run build

echo "[3/3] Запуск сервера..."
export NODE_ENV=production
export PORT=${PORT:-3000}
export HOST=${HOST:-0.0.0.0}

if command -v pm2 >/dev/null 2>&1; then
    echo "Запуск через PM2..."
    pm2 start "npm start" --name "pec-proxy-server"
    pm2 save
else
    echo "Запуск напрямую..."
    npm start
fi
