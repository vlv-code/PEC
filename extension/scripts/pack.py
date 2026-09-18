#!/usr/bin/env python3
"""
Утилита упаковки расширения Chrome в .crx и генерации updates.xml для GPO.

Возможности:
1. Поиск исполняемого файла Chrome/Chromium на Windows и Linux.
2. Упаковка расширения с использованием постоянного закрытого ключа (.pem),
   что гарантирует неизменность Extension ID при выпуске новых версий.
3. Точный расчет 32-символьного Extension ID (алгоритм Google Chrome).
4. Автоматическая генерация update-манифеста updates.xml.
5. Вывод готовых строк для политик GPO:
   - ExtensionInstallForcelist
   - ExtensionSettings (managed storage для extToken).
"""

import argparse
import base64
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


def find_chrome() -> str | None:
    """Поиск браузера Chrome или Chromium в стандартных путях ОС."""
    env_bin = os.environ.get("CHROME_BIN")
    if env_bin and shutil.which(env_bin):
        return env_bin

    if sys.platform.startswith("win"):
        candidates = [
            Path(os.environ.get("PROGRAMFILES", "C:\\Program Files")) / "Google/Chrome/Application/chrome.exe",
            Path(os.environ.get("PROGRAMFILES(X86)", "C:\\Program Files (x86)")) / "Google/Chrome/Application/chrome.exe",
            Path(os.environ.get("LOCALAPPDATA", "")) / "Google/Chrome/Application/chrome.exe",
        ]
        for c in candidates:
            if c.is_file():
                return str(c)
    else:
        for bin_name in ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]:
            path = shutil.which(bin_name)
            if path:
                return path

    return None


def encode_len(length: int) -> bytes:
    """Кодирование длины в ASN.1 DER."""
    if length < 128:
        return bytes([length])
    elif length < 256:
        return bytes([0x81, length])
    else:
        return bytes([0x82, (length >> 8) & 0xFF, length & 0xFF])


def calculate_extension_id_from_pem(pem_path: Path) -> str:
    """Расчет Extension ID из закрытого ключа RSA (.pem) формата PKCS#1 или PKCS#8."""
    content = pem_path.read_text(encoding="utf-8")
    lines = [line.strip() for line in content.splitlines() if not line.startswith("-----")]
    der = base64.b64decode("".join(lines))

    # Определение смещения RSA ключа в зависимости от формата (PKCS#1 vs PKCS#8)
    if "BEGIN PRIVATE KEY" in content:
        # PKCS#8: поиск алгоритма RSA (1.2.840.113549.1.1.1) и внутреннего OCTET STRING
        rsa_oid = b"\x2a\x86\x48\x86\xf7\x0d\x01\x01\x01"
        oid_idx = der.find(rsa_oid)
        if oid_idx == -1:
            raise ValueError("Не найден RSA OID в ключе PKCS#8")
        octet_idx = der.find(b"\x04", oid_idx)
        rsa_der_idx = der.find(b"\x30\x82", octet_idx)
        if rsa_der_idx == -1:
            rsa_der_idx = der.find(b"\x30\x81", octet_idx)
        idx = rsa_der_idx
    else:
        # PKCS#1: RSAPrivateKey начинается с начала
        idx = 0

    # Пропуск заголовка последовательности SEQUENCE
    if der[idx] != 0x30:
        raise ValueError("Некорректный заголовок ASN.1 SEQUENCE")
    idx += 1
    if der[idx] == 0x82:
        idx += 3
    elif der[idx] == 0x81:
        idx += 2
    else:
        idx += 1

    # Пропуск версии INTEGER (обычно 0x02, 0x01, 0x00)
    if der[idx] != 0x02:
        raise ValueError("Ожидался тег ASN.1 INTEGER для версии")
    idx += 2 + der[idx + 1]

    # Извлечение модуля n (INTEGER)
    if der[idx] != 0x02:
        raise ValueError("Ожидался тег ASN.1 INTEGER для модуля n")
    n_start = idx
    idx += 1
    if der[idx] == 0x82:
        n_len = (der[idx + 1] << 8) | der[idx + 2]
        idx += 3
    elif der[idx] == 0x81:
        n_len = der[idx + 1]
        idx += 2
    else:
        n_len = der[idx]
        idx += 1
    idx += n_len
    n_end = idx

    # Извлечение экспоненты e (INTEGER)
    if der[idx] != 0x02:
        raise ValueError("Ожидался тег ASN.1 INTEGER для экспоненты e")
    e_start = idx
    idx += 1
    if der[idx] == 0x82:
        e_len = (der[idx + 1] << 8) | der[idx + 2]
        idx += 3
    elif der[idx] == 0x81:
        e_len = der[idx + 1]
        idx += 2
    else:
        e_len = der[idx]
        idx += 1
    idx += e_len
    e_end = idx

    # Сборка структуры SubjectPublicKeyInfo (SPKI)
    rsa_pubkey = b"\x30" + encode_len((n_end - n_start) + (e_end - e_start)) + der[n_start:e_end]
    algo_id = b"\x30\r\x06\t*\x86H\x86\xf7\r\x01\x01\x01\x05\x00"
    bit_string = b"\x03" + encode_len(len(rsa_pubkey) + 1) + b"\x00" + rsa_pubkey
    spki = b"\x30" + encode_len(len(algo_id) + len(bit_string)) + algo_id + bit_string

    # SHA256 от SPKI, первые 128 бит (16 байт), преобразование нибблов в символы [a-p]
    digest = hashlib.sha256(spki).digest()[:16]
    return "".join(chr(ord("a") + (b >> 4)) + chr(ord("a") + (b & 0x0F)) for b in digest)


def calculate_extension_id_from_crx(crx_path: Path) -> str:
    """Извлечение Extension ID напрямую из CRX3 заголовка."""
    with crx_path.open("rb") as f:
        magic = f.read(4)
        if magic != b"Cr24":
            raise ValueError("Файл не является валидным CRX-пакетом Chrome")
        _ = int.from_bytes(f.read(4), "little")  # version
        header_len = int.from_bytes(f.read(4), "little")
        header = f.read(header_len)

    # Поиск последовательности алгоритма RSA
    idx = header.find(b"0\r\x06\t*\x86H\x86\xf7\r\x01\x01\x01\x05\x00")
    if idx == -1:
        raise ValueError("Не удалось обнаружить публичный ключ в заголовке CRX")
    spki_start = idx - 4 if header[idx - 4] == 0x30 else idx - 3
    spki = header[spki_start : spki_start + 294]
    digest = hashlib.sha256(spki).digest()[:16]
    return "".join(chr(ord("a") + (b >> 4)) + chr(ord("a") + (b & 0x0F)) for b in digest)


def generate_updates_xml(extension_id: str, version: str, codebase_url: str) -> str:
    """Генерация update manifest (updates.xml) для Chrome enterprise update."""
    return f"""<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='{extension_id}'>
    <updatecheck codebase='{codebase_url}' version='{version}' />
  </app>
</gupdate>
"""


def main():
    parser = argparse.ArgumentParser(description="Сборщик Chrome Extension (.crx) и манифеста GPO")
    parser.add_argument(
        "--src",
        type=Path,
        default=Path(__file__).resolve().parent.parent,
        help="Путь к директории расширения (по умолчанию: extension/)",
    )
    parser.add_argument(
        "--key",
        type=Path,
        default=None,
        help="Путь к закрытому ключу .pem (по умолчанию: <src>/key.pem)",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("dist"),
        help="Директория для сборки артефактов (по умолчанию: dist/)",
    )
    parser.add_argument(
        "--base-url",
        type=str,
        default="https://mini-server.ic.local/updates",
        help="Базовый URL хостинга обновлений (по умолчанию: https://mini-server.ic.local/updates)",
    )
    parser.add_argument(
        "--chrome-bin",
        type=str,
        default=None,
        help="Явный путь к бинарнику Chrome/Chromium",
    )
    args = parser.parse_args()

    src_dir = args.src.resolve()
    manifest_file = src_dir / "manifest.json"
    if not manifest_file.is_file():
        print(f"ОШИБКА: Файл манифеста не найден: {manifest_file}", file=sys.stderr)
        sys.exit(1)

    manifest_data = json.loads(manifest_file.read_text(encoding="utf-8"))
    version = manifest_data.get("version", "1.0.0")
    name_slug = manifest_data.get("name", "corp-proxy-auth").lower().replace(" ", "-")

    key_path = args.key.resolve() if args.key else src_dir / "key.pem"
    chrome_bin = args.chrome_bin or find_chrome()
    if not chrome_bin:
        print("ОШИБКА: Не удалось обнаружить Chrome/Chromium на системе. Укажите --chrome-bin.", file=sys.stderr)
        sys.exit(1)

    out_dir = args.out_dir.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"=== Сборка Chrome Extension [{name_slug} v{version}] ===")
    print(f"Исходники:      {src_dir}")
    print(f"Закрытый ключ:  {key_path}")
    print(f"Бинарник Chrome:{chrome_bin}")

    # Формирование аргументов запуска Chrome
    cmd = [chrome_bin, f"--pack-extension={src_dir}"]
    if key_path.is_file():
        cmd.append(f"--pack-extension-key={key_path}")

    # Запуск Chrome для создания CRX
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"ОШИБКА при запуске Chrome: {res.stderr}", file=sys.stderr)
        sys.exit(res.returncode)

    # Chrome создает <src_dir>.crx и при первом запуске <src_dir>.pem рядом с исходниками
    default_crx = src_dir.parent / f"{src_dir.name}.crx"
    default_pem = src_dir.parent / f"{src_dir.name}.pem"

    # Если ключ был сгенерирован автоматически, перемещаем его в key_path
    if not key_path.is_file() and default_pem.is_file():
        shutil.move(str(default_pem), str(key_path))
        print(f"[!] Создан новый закрытый ключ: {key_path}")
        print("    СОХРАНИТЕ ЕГО! При потере ключа Extension ID изменится, и GPO перестанет работать.")

    if not default_crx.is_file():
        print(f"ОШИБКА: Ожидаемый файл .crx не был создан: {default_crx}", file=sys.stderr)
        sys.exit(1)

    # Итоговые файлы в out_dir
    target_crx = out_dir / f"{name_slug}-{version}.crx"
    shutil.move(str(default_crx), str(target_crx))

    # Вычисление Extension ID
    try:
        ext_id = calculate_extension_id_from_pem(key_path)
    except Exception as e:
        # Резервный вариант — чтение из заголовка CRX
        ext_id = calculate_extension_id_from_crx(target_crx)

    # Генерация updates.xml
    codebase_url = f"{args.base_url.rstrip('/')}/{target_crx.name}"
    updates_xml = generate_updates_xml(ext_id, version, codebase_url)
    updates_file = out_dir / "updates.xml"
    updates_file.write_text(updates_xml, encoding="utf-8")

    update_url = f"{args.base_url.rstrip('/')}/updates.xml"

    print("\n Сборка успешно завершена:")
    print(f"  CRX пакет:    {target_crx}")
    print(f"  Update XML:   {updates_file}")
    print(f"  Extension ID: {ext_id}")

    print("\n" + "=" * 70)
    print(" ДАННЫЕ ДЛЯ НАСТРОЙКИ GROUP POLICY (GPO):")
    print("=" * 70)
    print("\n1. Политика: ExtensionInstallForcelist")
    print(f"   Значение: {ext_id};{update_url}")

    print("\n2. Политика: ExtensionSettings (JSON для этого Extension ID)")
    gpo_settings = {
        ext_id: {
            "installation_mode": "force_installed",
            "update_url": update_url,
            "extToken": "YOUR_EXT_SHARED_TOKEN_HERE",
            "credsUrl": "https://mini-server.ic.local/creds",
        }
    }
    print(json.dumps(gpo_settings, indent=2))
    print("=" * 70 + "\n")


if __name__ == "__main__":
    main()
