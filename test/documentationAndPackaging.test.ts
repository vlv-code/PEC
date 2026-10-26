import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Domain 4.1: All variables from .env.example are documented in README.md and README.ru.md", () => {
  const envExample = fs.readFileSync(".env.example", "utf-8");
  const readmeEn = fs.readFileSync("README.md", "utf-8");
  const readmeRu = fs.readFileSync("README.ru.md", "utf-8");

  const envLines = envExample
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  const envKeys: { key: string; val: string }[] = [];
  for (const line of envLines) {
    const eqIdx = line.indexOf("=");
    if (eqIdx !== -1) {
      envKeys.push({
        key: line.slice(0, eqIdx).trim(),
        val: line.slice(eqIdx + 1).trim(),
      });
    }
  }

  assert.ok(envKeys.length >= 26, `Must have at least 26 variables in .env.example (found ${envKeys.length})`);

  for (const { key, val } of envKeys) {
    assert.ok(
      readmeEn.includes(`\`${key}\``),
      `README.md must document environment variable \`${key}\``
    );
    assert.ok(
      readmeRu.includes(`\`${key}\``),
      `README.ru.md must document environment variable \`${key}\``
    );

    // If .env.example specifies a non-empty default path, verify accurate path documentation
    if (val.startsWith("./data/")) {
      assert.ok(
        readmeEn.includes(`\`${val}\``),
        `README.md must document accurate path \`${val}\` for \`${key}\``
      );
      assert.ok(
        readmeRu.includes(`\`${val}\``),
        `README.ru.md must document accurate path \`${val}\` for \`${key}\``
      );
    }
  }
});

test("Domain 4.2: README.ru.md contains packaging section matching English README.md", () => {
  const readmeRu = fs.readFileSync("README.ru.md", "utf-8");

  assert.ok(
    readmeRu.includes("## 🧩 Упаковка и тестирование расширения"),
    "README.ru.md must contain the packaging section heading"
  );
  assert.ok(
    readmeRu.includes("npm run pack:extension"),
    "README.ru.md must explain npm run pack:extension"
  );
  assert.ok(
    readmeRu.includes("dist/updates/") && readmeRu.includes("dist/unpacked/"),
    "README.ru.md must mention output directories dist/updates/ and dist/unpacked/"
  );
  assert.ok(
    readmeRu.includes("Никогда не загружайте исходный каталог `extension/` напрямую") ||
    readmeRu.includes("`extension/`"),
    "README.ru.md must warn not to load raw extension/ directory directly"
  );
});

test("Domain 4.3: Root SECURITY.md has correct supported versions and Linux config directory", () => {
  const sec = fs.readFileSync("SECURITY.md", "utf-8");

  // Supported versions
  assert.ok(
    sec.includes("| Server | 1.x | Да |") || sec.includes("| Server | 1.x |"),
    "SECURITY.md must support Server 1.x"
  );
  assert.ok(
    sec.includes("| Extension | 1.x | Да |") || sec.includes("| Extension | 1.x |"),
    "SECURITY.md must support Extension 1.x"
  );
  assert.ok(
    sec.includes("| Windows Client | 2.x | Да |") || sec.includes("| Windows Client | 2.x |"),
    "SECURITY.md must support Windows Client 2.x"
  );
  assert.ok(
    sec.includes("| Linux Client | 2.x | Да |") || sec.includes("| Linux Client | 2.x |"),
    "SECURITY.md must support Linux Client 2.x"
  );

  // Linux config path
  assert.ok(
    sec.includes("/etc/proxybridge"),
    "SECURITY.md must reference /etc/proxybridge"
  );
  assert.ok(
    !sec.includes("/etc/pec-client"),
    "SECURITY.md must not reference old /etc/pec-client path"
  );
});

test("Domain 4.4: extension/updates.xml.example uses canonical PEC branding and URLs", () => {
  const xmlExample = fs.readFileSync("extension/updates.xml.example", "utf-8");

  assert.ok(
    xmlExample.includes("pec-extension.crx"),
    "updates.xml.example must reference pec-extension.crx"
  );
  assert.ok(
    xmlExample.includes("pec.example.corp"),
    "updates.xml.example must reference pec.example.corp"
  );
  assert.ok(
    !xmlExample.includes("corp-proxy-auth"),
    "updates.xml.example must not reference corp-proxy-auth"
  );
  assert.ok(
    !xmlExample.includes("update.example.com"),
    "updates.xml.example must not reference update.example.com"
  );
});

test("Domain 4.5: .gitattributes declares binary attributes for native binaries and drivers", () => {
  const gitattrPath = path.resolve(".gitattributes");
  assert.ok(fs.existsSync(gitattrPath), ".gitattributes must exist at root");

  const content = fs.readFileSync(gitattrPath, "utf-8");

  assert.ok(
    content.includes("templates/app/windows/** binary"),
    ".gitattributes must declare templates/app/windows/** binary"
  );
  assert.ok(
    content.includes("*.exe binary"),
    ".gitattributes must declare *.exe binary"
  );
  assert.ok(
    content.includes("*.dll binary"),
    ".gitattributes must declare *.dll binary"
  );
  assert.ok(
    content.includes("*.sys binary"),
    ".gitattributes must declare *.sys binary"
  );
});
