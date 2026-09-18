"""
Мини-сервер: раздаёт текущие credentials для Xray HTTP-инбаунда через /creds.

Работает за nginx (TLS-терминация + сетевой allow/deny — см. nginx.conf.example).
Здесь — второй, независимый слой проверки: токен расширения + логирование.

AD-членство отдельно не проверяется: гейт — на уровне GPO/security filtering,
которым размечено само наличие расширения у пользователя (см. PLAN.md, раздел 3).
"""

import json
import logging
import os
import secrets
import time
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Request, Response

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger("mini-server")

app = FastAPI(title="Corp Proxy Mini-Server", version="1.1.0")

EXT_SHARED_TOKEN = os.environ.get("EXT_SHARED_TOKEN", "")
if not EXT_SHARED_TOKEN:
    log.warning("EXT_SHARED_TOKEN не задан в переменных окружения!")

CREDS_STORE = Path(os.environ.get("CREDS_STORE", "/opt/mini-server/current_creds.json")).expanduser()


def load_current_creds() -> dict:
    with CREDS_STORE.open("r", encoding="utf-8") as f:
        return json.load(f)


@app.get("/creds")
def get_creds(
    request: Request,
    response: Response = None,
    x_ext_token: str | None = Header(default=None),
):
    # Запрет кэширования чувствительных учетных данных любыми прокси
    if response is not None:
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, private"
        response.headers["Pragma"] = "no-cache"
        response.headers["X-Content-Type-Options"] = "nosniff"

    # nginx подставляет реальный IP клиента в X-Real-IP (proxy_pass — см. nginx.conf.example)
    client_host = request.client.host if request.client else "unknown"
    src = request.headers.get("x-real-ip", client_host)

    # Защита от timing-attack при сравнении токена
    if not EXT_SHARED_TOKEN or not secrets.compare_digest(x_ext_token or "", EXT_SHARED_TOKEN):
        log.warning("rejected src=%s reason=token", src)
        raise HTTPException(status_code=403, detail="Forbidden")

    try:
        creds = load_current_creds()
        if not isinstance(creds, dict) or "user" not in creds or "pass" not in creds:
            raise ValueError("Malformed credentials content")
    except FileNotFoundError:
        log.error("creds store missing — ротация (rotate.py) ещё не запускалась?")
        raise HTTPException(status_code=503, detail="Credentials not initialized")
    except (json.JSONDecodeError, ValueError) as e:
        log.error("creds store corrupted or unreadable: %s", e)
        raise HTTPException(status_code=503, detail="Credentials store error")

    log.info("served src=%s ts=%s", src, int(time.time()))
    return {"user": creds["user"], "pass": creds["pass"]}


@app.get("/healthz")
def healthz():
    return {"ok": True}
