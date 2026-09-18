"""
Ротация пароля Xray HTTP-инбаунда через 3x-ui API.
Запускается по systemd timer (см. systemd/rotate-xray-pass.timer).

Важно про формат settings для HTTP/SOCKS-инбаунда в 3x-ui/Xray:
аккаунты лежат под ключом "accounts" (список {"user":..., "pass":...}),
а не "users" — это ключ, который используют VMess/VLESS/Trojan под "clients".

"settings" на разных версиях панели приходит то JSON-строкой, то уже
распарсенным объектом (начиная примерно с 3.7.0) — обрабатываем оба случая,
но при записи обратно всегда кладём JSON-строку, как ожидает /update.
"""

import json
import logging
import os
import secrets
import sys
from pathlib import Path

import requests
import urllib3

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger("rotate")

PANEL = os.environ["XUI_PANEL_URL"]  # https://3xui-host:2053/basepath
XUI_USER = os.environ["XUI_ADMIN_USER"]
XUI_PASS = os.environ["XUI_ADMIN_PASS"]
INBOUND_REMARK = os.environ.get("XUI_INBOUND_REMARK", "squid-in")
CREDS_STORE = Path(os.environ.get("CREDS_STORE", "/opt/mini-server/current_creds.json")).expanduser()
DEFAULT_TIMEOUT = int(os.environ.get("XUI_TIMEOUT", "10"))
XUI_INSECURE_SKIP_VERIFY = (
    os.environ.get("XUI_INSECURE_SKIP_VERIFY", "false").lower() in ("true", "1", "yes")
)


def get_session() -> requests.Session:
    s = requests.Session()
    if XUI_INSECURE_SKIP_VERIFY:
        s.verify = False
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    r = s.post(
        f"{PANEL}/login",
        json={"username": XUI_USER, "password": XUI_PASS},
        timeout=DEFAULT_TIMEOUT,
    )
    r.raise_for_status()

    # 3x-ui может возвращать HTTP 200 даже при ошибке входа
    try:
        data = r.json()
        if not data.get("success", False):
            raise RuntimeError(f"3x-ui login rejected: {data.get('msg', 'Unknown error')}")
    except (ValueError, KeyError) as e:
        log.warning("Не удалось распарсить JSON ответа /login, полагаемся на HTTP статус: %s", e)

    return s


def _as_dict(settings) -> dict:
    return json.loads(settings) if isinstance(settings, str) else settings


def rotate() -> None:
    with get_session() as s:
        res = s.get(f"{PANEL}/panel/api/inbounds/list", timeout=DEFAULT_TIMEOUT)
        res.raise_for_status()
        inbounds = res.json().get("obj", [])

        target = next((i for i in inbounds if i.get("remark") == INBOUND_REMARK), None)
        if not target:
            available = [i.get("remark") for i in inbounds]
            log.error("Инбаунд '%s' не найден в 3x-ui. Доступные: %s", INBOUND_REMARK, available)
            sys.exit(1)

        settings = _as_dict(target["settings"])
        if not settings.get("accounts"):
            log.error("У инбаунда '%s' отсутствует ключ 'accounts' в settings", INBOUND_REMARK)
            sys.exit(1)

        new_password = secrets.token_urlsafe(16)
        username = settings["accounts"][0]["user"]
        settings["accounts"][0]["pass"] = new_password
        target["settings"] = json.dumps(settings)

        r = s.post(
            f"{PANEL}/panel/api/inbounds/update/{target['id']}",
            json=target,
            timeout=DEFAULT_TIMEOUT,
        )
        r.raise_for_status()

        # не доверять 200 OK — перечитать и сверить (задокументированный баг,
        # issue #3083 в трекере MHSanaei/3x-ui: апдейт может не записаться в БД)
        refreshed_res = s.get(f"{PANEL}/panel/api/inbounds/list", timeout=DEFAULT_TIMEOUT)
        refreshed_res.raise_for_status()
        refreshed = refreshed_res.json().get("obj", [])

        check = next((i for i in refreshed if i.get("id") == target["id"]), None)
        if not check:
            log.error("Целевой инбаунд пропал после обновления")
            sys.exit(1)

        actual = _as_dict(check["settings"])["accounts"][0]["pass"]
        if actual != new_password:
            log.error("3x-ui не сохранил новый пароль, оставляю старый в сторе нетронутым")
            sys.exit(1)

        # Атомарная запись через временный файл: исключает ситуацию,
        # когда app.py читает полупустой файл в момент вызова write_text
        CREDS_STORE.parent.mkdir(parents=True, exist_ok=True)
        temp_file = CREDS_STORE.with_name(f"{CREDS_STORE.name}.tmp")
        temp_file.write_text(json.dumps({"user": username, "pass": new_password}), encoding="utf-8")
        try:
            temp_file.chmod(0o600)
        except OSError:
            pass
        temp_file.replace(CREDS_STORE)

        log.info("rotated ok, user=%s", username)


if __name__ == "__main__":
    rotate()
