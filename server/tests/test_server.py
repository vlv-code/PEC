"""
Юнит-тесты для серверной части (app.py и rotate.py).
Поддерживает запуск как через pytest, так и через стандартный модуль unittest.
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock

# Моки для внешних зависимостей, если они не установлены в среде выполнения
try:
    from fastapi import FastAPI, Header, HTTPException, Request
except ImportError:
    class HTTPException(Exception):
        def __init__(self, status_code: int, detail: str = ""):
            self.status_code = status_code
            self.detail = detail

    def mock_decorator(*args, **kwargs):
        def wrapper(fn):
            return fn
        return wrapper

    class MockFastAPI:
        def __init__(self, *args, **kwargs):
            pass
        def get(self, *args, **kwargs):
            return mock_decorator(*args, **kwargs)

    fastapi_mock = MagicMock()
    fastapi_mock.HTTPException = HTTPException
    fastapi_mock.FastAPI = MockFastAPI
    fastapi_mock.Header = lambda default=None: default
    fastapi_mock.Request = MagicMock()
    sys.modules["fastapi"] = fastapi_mock

if "requests" not in sys.modules:
    try:
        import requests
    except ImportError:
        sys.modules["requests"] = MagicMock()

if "urllib3" not in sys.modules:
    try:
        import urllib3
    except ImportError:
        sys.modules["urllib3"] = MagicMock()

# Добавление корневой папки server в путь импорта
SERVER_DIR = Path(__file__).resolve().parent.parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

os.environ["EXT_SHARED_TOKEN"] = "test-secret-token"
os.environ["XUI_PANEL_URL"] = "http://localhost:2053"
os.environ["XUI_ADMIN_USER"] = "admin"
os.environ["XUI_ADMIN_PASS"] = "pass"

import app
import rotate


class TestServerComponents(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.creds_file = Path(self.temp_dir.name) / "current_creds.json"
        app.CREDS_STORE = self.creds_file
        rotate.CREDS_STORE = self.creds_file

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_rotate_as_dict(self):
        self.assertEqual(rotate._as_dict('{"foo": "bar"}'), {"foo": "bar"})
        self.assertEqual(rotate._as_dict({"foo": "bar"}), {"foo": "bar"})

    def test_app_timing_safe_token(self):
        import secrets
        self.assertTrue(secrets.compare_digest("test-secret-token", app.EXT_SHARED_TOKEN))
        self.assertFalse(secrets.compare_digest("wrong-token", app.EXT_SHARED_TOKEN))

    def test_app_load_creds_missing(self):
        with self.assertRaises(app.HTTPException) as cm:
            class DummyRequest:
                headers = {"x-real-ip": "1.2.3.4"}
                client = None
            app.get_creds(DummyRequest(), x_ext_token="test-secret-token")
        self.assertEqual(cm.exception.status_code, 503)

    def test_app_load_creds_corrupted(self):
        self.creds_file.write_text("{broken json", encoding="utf-8")
        with self.assertRaises(app.HTTPException) as cm:
            class DummyRequest:
                headers = {"x-real-ip": "1.2.3.4"}
                client = None
            app.get_creds(DummyRequest(), x_ext_token="test-secret-token")
        self.assertEqual(cm.exception.status_code, 503)

    def test_app_load_creds_malformed_fields(self):
        self.creds_file.write_text(json.dumps({"some_key": "some_value"}), encoding="utf-8")
        with self.assertRaises(app.HTTPException) as cm:
            class DummyRequest:
                headers = {"x-real-ip": "1.2.3.4"}
                client = None
            app.get_creds(DummyRequest(), x_ext_token="test-secret-token")
        self.assertEqual(cm.exception.status_code, 503)

    def test_app_load_creds_success(self):
        self.creds_file.write_text(json.dumps({"user": "user1", "pass": "secret123"}), encoding="utf-8")
        class DummyRequest:
            headers = {"x-real-ip": "10.0.0.5"}
            client = None
        res = app.get_creds(DummyRequest(), x_ext_token="test-secret-token")
        self.assertEqual(res, {"user": "user1", "pass": "secret123"})

    def test_app_token_rejected(self):
        class DummyRequest:
            headers = {}
            client = None
        with self.assertRaises(app.HTTPException) as cm:
            app.get_creds(DummyRequest(), x_ext_token="invalid")
        self.assertEqual(cm.exception.status_code, 403)

    def test_app_client_none_ip_fallback(self):
        self.creds_file.write_text(json.dumps({"user": "user1", "pass": "secret123"}), encoding="utf-8")
        class DummyRequest:
            headers = {}
            client = None
        res = app.get_creds(DummyRequest(), x_ext_token="test-secret-token")
        self.assertEqual(res, {"user": "user1", "pass": "secret123"})

    def test_atomic_write_safety(self):
        username = "proxyuser"
        new_password = "newpass123"
        self.creds_file.parent.mkdir(parents=True, exist_ok=True)
        temp_file = self.creds_file.with_name(f"{self.creds_file.name}.tmp")
        temp_file.write_text(json.dumps({"user": username, "pass": new_password}), encoding="utf-8")
        try:
            temp_file.chmod(0o600)
        except OSError:
            pass
        temp_file.replace(self.creds_file)

        # Проверка целостности файла
        self.assertTrue(self.creds_file.exists())
        data = json.loads(self.creds_file.read_text(encoding="utf-8"))
        self.assertEqual(data["user"], "proxyuser")
        self.assertEqual(data["pass"], "newpass123")

    def test_app_security_headers(self):
        self.creds_file.write_text(json.dumps({"user": "user1", "pass": "secret123"}), encoding="utf-8")
        class DummyRequest:
            headers = {"x-real-ip": "10.0.0.5"}
            client = None
        class DummyResponse:
            headers = {}
        resp = DummyResponse()
        app.get_creds(DummyRequest(), response=resp, x_ext_token="test-secret-token")
        self.assertIn("no-store", resp.headers.get("Cache-Control", ""))
        self.assertEqual(resp.headers.get("X-Content-Type-Options"), "nosniff")

    def test_pack_utils(self):
        # Импорт вспомогательных функций из extension/scripts/pack.py
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "extension" / "scripts"))
        import pack

        self.assertEqual(pack.encode_len(10), b"\n")
        self.assertEqual(pack.encode_len(200), b"\x81\xc8")
        self.assertEqual(pack.encode_len(300), b"\x82\x01\x2c")

        xml = pack.generate_updates_xml("abcdefghijklmnopabcdefghijklmnop", "1.0.0", "https://example.com/ext.crx")
        self.assertIn("appid='abcdefghijklmnopabcdefghijklmnop'", xml)
        self.assertIn("version='1.0.0'", xml)


if __name__ == "__main__":
    unittest.main()
