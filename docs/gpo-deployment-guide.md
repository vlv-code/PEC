# Руководство по корпоративному развертыванию PEC через Active Directory GPO

Данное руководство предназначено для системных администраторов Active Directory и инженеров информационной безопасности. В нём пошагово описано, как настроить централизованное распространение и управление браузерным расширением PEC (Proxy Extension Corp) на рабочих станциях и многопользовательских терминальных серверах (RDS / Citrix).

---

## 1. Архитектура и ключевые принципы

Основным рекомендованным способом развертывания (Tier-1) является **нативный импорт Group Policy Preferences (Registry.xml)** через оснастку GPMC без необходимости выполнения скриптов при входе пользователя в систему.

```mermaid
flowchart TD
    AD["Active Directory Domain Controller\n(GPO: User Preferences Registry.xml)"] -->|Репликация через SysVol| WS["Рабочие станции (Windows 10/11)\nи Терминальные серверы (RDS)"]
    
    subgraph Client["Клиентский сеанс пользователя (GPP CSE)"]
        WS -->|Item-Level Targeting: SEC-Proxy-Users| GPP["Group Policy Preferences\n(Нативная обработка реестра)"]
        GPP -->|Запись политик в HKCU\n(removePolicy=1)| REG["Реестр HKCU\\Software\\Policies\n(Chrome, Edge, Yandex, Opera)\ndomainUser = %USERDOMAIN%\\%USERNAME%"]
        REG -->|Старт браузера| BROWSER["Chromium Браузер\n(Enterprise Managed)"]
    end
    
    subgraph PEC["Серверная инфраструктура PEC"]
        NGINX["Nginx Reverse Proxy\n(HTTPS Trusted CA)"]
        PEC_SRV["PEC Mini-Server Backend\n(:3000 / Zero-Trust AD Sync)"]
        DC["Active Directory / LDAP\n(dc01.corp.local:636)"]
        NGINX --> PEC_SRV
        PEC_SRV <-->|LDAPS опрос SEC-Proxy-Users\nкаждые 300 сек| DC
    end
    
    BROWSER -->|"1. GET /updates/updates.xml"| NGINX
    BROWSER -->|"2. Download extension.crx"| NGINX
    BROWSER -->|"3. POST /api/sync & /creds\n(domainUser + fleetToken)"| NGINX
    PEC_SRV -->|Zero-Trust Kill-Switch\n(Проверка членства в AD)| BROWSER
    BROWSER -->|"4. Авторизованный туннель"| PROXY["Upstream Прокси 1 и 2\n(Xray / 3x-ui / SOCKS5)"]
```

### Основные принципы безопасности:
1. **Нативная GPO без сторонних интерпретаторов (Tier-1 GPP Registry.xml):**
   Распространение параметров выполняется штатным механизмом Windows Group Policy Preferences. Не требуется включать исполнение PowerShell-скриптов в политиках ExecutionPolicy или настраивать Logon-скрипты.
2. **Сквозная доменная идентификация (Zero-Trust Identity Mapping):**
   В ветку управляемых политик браузера записывается строковый параметр `domainUser = "%USERDOMAIN%\%USERNAME%"`. При входе пользователя подсистема Windows автоматически раскрывает доменные переменные окружения (например, `CORP\ivanov`). Расширение считывает `domainUser` из `chrome.storage.managed` и передает его в запросах к серверу для сверки с Active Directory.
3. **Автоматический отзыв прав через `removePolicy="1"`:**
   Все элементы в манифесте `Registry.xml` сформированы с флагом **«Remove this item when it is no longer applied»** (`removePolicy="1"`). Если администратор исключает пользователя из группы `SEC-Proxy-Users`, клиентская служба Group Policy Preferences при следующем цикле `gpupdate` автоматически удаляет записи расширения из реестра `HKCU`.
4. **Мгновенный серверный Kill-Switch (Active Directory Sync):**
   Сервер PEC периодически опрашивает контроллер домена по LDAPS. Если учетная запись пользователя заблокирована в домене или исключена из группы `AD_REQUIRED_GROUP_DN`, сервер возвращает статус **403 Forbidden** на запросы `/api/sync` и `/creds`, немедленно аннулирует выданные токены инстанса и принудительно отключает туннелирование (перевод в прямой режим DIRECT).
5. **Изоляция пользователей на терминальных серверах (RDS / Citrix):**
   Политики принудительной установки и настройки применяются исключительно в ветку **текущего пользователя (`HKCU\Software\Policies\...`)**, а не в `HKLM`. Это исключает утечку конфигураций между сеансами разных пользователей на общем сервере.
6. **Гигиена секретов:**
   В GPO передается только низкопривилегированный **`EXT_SHARED_TOKEN`** (fleet-токен). Административный токен управления `ADMIN_TOKEN` изолирован на сервере.

---

## 2. Предварительные требования

1. **Сервер PEC за Nginx с доверенным TLS-сертификатом:**
   Браузеры Chromium блокируют установку `.crx` из внешних источников, если SSL-сертификат является недоверенным. Сертификат Nginx должен быть выпущен корпоративным CA домена или доверенным публичным УЦ.
2. **MIME-типы в Nginx:**
   Убедитесь, что в конфигурации Nginx отдаются правильные MIME-типы:
   ```nginx
   types {
       application/x-chrome-extension crx;
       application/xml xml;
   }
   ```
3. **Группа безопасности в Active Directory:**
   В оснастке `dsa.msc` создайте глобальную группу безопасности (например, `SEC-Proxy-Users`) и включите в неё авторизованных пользователей.
4. **Служебная учетная запись LDAP (для AD Kill-Switch):**
   Для включения серверной проверки в `.env` настройте параметры `AD_ENABLED=true`, `AD_LDAP_URL` и `AD_BIND_DN` с правами чтения группы `SEC-Proxy-Users`.

---

## 3. Сценарий 1 (Tier-1, Рекомендуемый): Нативное развертывание через Group Policy Preferences (Registry.xml)

Этот сценарий является основным корпоративным стандартом: он использует встроенный в Windows механизм Group Policy Preferences, не зависит от политики выполнения скриптов PowerShell и обеспечивает чистый жизненный цикл удаления политик.

### Шаг 1. Получение манифеста Registry.xml
1. В веб-панели PEC откройте вкладку **«GPO Deployment»**.
2. В блоке загрузки нажмите кнопку **«Скачать GPP Registry.xml»** (или выгрузите `Registry.xml` из состава полного GPO Pack).

### Шаг 2. Создание объекта GPO в GPMC
1. Откройте консоль **Group Policy Management** (`gpmc.msc`).
2. Создайте новый объект групповой политики, например: `PEC-Corp-Proxy-Preferences`.
3. Привяжите GPO к подразделению (OU) с пользователями или к корню домена.

### Шаг 3. Импорт элементов Registry.xml в политику
Вы можете разместить сгенерированный файл конфигурации в хранилище политики:
1. В консоли GPMC нажмите правой кнопкой мыши по созданной GPO → **Edit** (Редактировать).
2. Разверните узел:  
   `User Configuration (Конфигурация пользователя) → Preferences (Настройки) → Windows Settings (Параметры Windows) → Registry (Реестр)`.
3. Откройте каталог политики в проводнике:
   `\\<domain>\sysvol\<domain>\Policies\<GPO-GUID>\User\Preferences\Registry\`
4. Скопируйте файл `Registry.xml` в указанную директорию.
5. Вернитесь в консоль редактора GPO и нажмите **F5 (Обновить)**. В окне отобразятся преднастроенные элементы для всех поддерживаемых браузеров:
   - **Google Chrome:** `Software\Policies\Google\Chrome`
   - **Microsoft Edge:** `Software\Policies\Microsoft\Edge`
   - **Яндекс.Браузер:** `Software\Policies\YandexBrowser`
   - **Opera:** `Software\Policies\Opera Software\Opera`

### Шаг 4. Настройка нацеливания на группу (Item-Level Targeting) и флага removePolicy
Каждый элемент в `Registry.xml` настроен на безопасное применение:
1. Откройте свойства любого созданного элемента реестра и перейдите на вкладку **Common (Общие)**.
2. Убедитесь, что активен флаг: **«Remove this item when it is no longer applied»** (Удалить элемент, если он больше не применяется, атрибут `removePolicy="1"`). Это гарантирует очистку реестра при выходе пользователя из группы.
3. Отметьте опцию **Item-level targeting (Нацеливание на уровень элемента)** и нажмите **Targeting...**:
   - Нажмите **New Item → Security Group**.
   - Укажите доменную группу: `SEC-Proxy-Users`.
   - Убедитесь, что выбрана опция *«User in group»*.

### Шаг 5. Сквозная передача доменного имени (domainUser)
В секции Managed Storage для каждого браузера (`3rdparty\extensions\<ID>\policy`) формируется ключ:
- **Имя параметра:** `domainUser`
- **Тип:** `REG_SZ`
- **Значение:** `%USERDOMAIN%\%USERNAME%`

Операционная система Windows при обработке Preferences в сеансе пользователя автоматически заменяет переменные на актуальные значения (например, `CORP\j.doe`). Браузерное расширение считывает этот параметр и передает его в заголовках синхронизации, обеспечивая сквозной аудит и Zero-Trust валидацию в Active Directory.

---

## 4. Особенности для терминальных серверов (RDS / Citrix)

Если сотрудники работают на многопользовательских терминальных серверах (Remote Desktop Session Host):
1. Терминальные серверы обычно сгруппированы в отдельном `OU=Terminal-Servers`.
2. Чтобы настройки пользователя из Preferences гарантированно применялись внутри изолированных сессий RDP, включите **Режим замыкания пользовательской политики (Loopback Processing)**:
   - В GPMC откройте политику терминальных серверов и перейдите в:  
     `Computer Configuration → Policies → Administrative Templates → System → Group Policy`.
   - Откройте параметр: **Configure user Group Policy loopback processing mode** (Настроить режим обработки замыкания пользовательской групповой политики).
   - Установите статус: **Enabled** (Включено).
   - Выберите режим: **Merge** (Объединение).

При входе пользователя на терминальный сервер служба Windows GPP CSE применит настройки реестра исключительно в ветку `HKEY_CURRENT_USER` его изолированного сеанса.

---

## 5. Сценарий 2 (Вспомогательный): Локальное развертывание и стенды без GPMC (deploy-pec-gpo.ps1)

> [!NOTE]
> Скрипт `deploy-pec-gpo.ps1` является **вспомогательной утилитой** и предназначен для локального тестирования, настройки автономных рабочих мест, подготовки эталонных образов (VDI Gold Image) или развертывания в средах, где администратор не имеет прямого доступа к GPMC.

Скрипт автоматически определяет установленные браузеры, динамически вычисляет следующий свободный индекс в `ExtensionInstallForcelist` (исключая конфликты с DLP/антивирусами) и записывает политики в реестр.

### Использование скрипта:
Запуск в пользовательской сессии PowerShell (права администратора не требуются, так как запись идет в HKCU):
```powershell
# Стандартное применение с проверкой членства в доменной группе:
.\deploy-pec-gpo.ps1 -RequireAdGroup "SEC-Proxy-Users"

# Принудительное развертывание без проверки доменной группы (тестовый стенд):
.\deploy-pec-gpo.ps1 -Force

# Полный отзыв и удаление всех настроек расширения:
.\deploy-pec-gpo.ps1 -Uninstall
```

Скрипт также поддерживает запуск через классический механизм **GPO Logon Scripts** (`User Configuration → Policies → Windows Settings → Scripts → Logon`), если использование Group Policy Preferences по каким-либо причинам ограничено корпоративными стандартами.

---

## 6. Проверка и диагностика на рабочих местах

### Автоматическая проверка через `verify-pec-gpo.ps1`
Запустите диагностический скрипт из архива на клиентском компьютере в PowerShell:
```powershell
.\verify-pec-gpo.ps1
```
Скрипт проверит доступность сервера, корректность манифеста `updates.xml`, скачивание `.crx` и наличие ключей реестра:
```text
============================================================
 PEC Extension Corporate GPO Deployment Diagnostics
 Target Server: https://pec.corp.local
 Extension ID : abcdefghijklmnopabcdefghijklmnop
============================================================

--- 1. Network & TLS Certificate Verification ---
[PASS] PEC Server Reachability (/healthz) - HTTP 200 OK
[PASS] Update Manifest (/updates/updates.xml) - Found valid XML containing appid
[PASS] CRX Binary Download (/updates/extension.crx) - Content-Type: application/x-chrome-extension, Size: 48.5 KB

--- 2. Windows Registry Policy Verification ---
[PASS] Google Chrome Enterprise Policies - Configured in HKCU (Forcelist + Managed Storage)
[PASS] Microsoft Edge Enterprise Policies - Configured in HKCU (Forcelist + Managed Storage)
[PASS] Yandex Browser Enterprise Policies - Configured in HKCU (Forcelist + Managed Storage)
[PASS] Opera Enterprise Policies - Configured in HKCU (Forcelist + Managed Storage)
[PASS] Domain User Policy Injection - '%USERDOMAIN%\%USERNAME%' defined in managed policy

--- 3. Local Browser Profile Installation Status ---
[PASS] Google Chrome Installed Extension - Found version(s): 0.9.0
```

### Ручная проверка в браузерах:
1. Примените групповые политики на компьютере:
   ```cmd
   gpupdate /force
   ```
2. Откройте браузер и перейдите на страницу политик:
   - **Google Chrome:** `chrome://policy`
   - **Microsoft Edge:** `edge://policy`
   - **Яндекс.Браузер:** `browser://policy`
   - **Opera:** `opera://policy`
3. Нажмите кнопку **«Перезагрузить политики» (Reload policies)**.
4. В таблице политик должны отображаться:
   - `ExtensionInstallForcelist` со статусом **OK**.
   - В блоке управляемых расширений: параметры `domainUser`, `extToken`, `syncUrl`, `credsUrl`.

---

## 7. Траблшутинг (Частые вопросы)

| Симптом | Причина | Решение |
| :--- | :--- | :--- |
| Браузер не скачивает расширение из `updates.xml` | Недоверенный TLS-сертификат на Nginx | Убедитесь, что корневой сертификат корпоративного CA установлен в хранилище *«Доверенные корневые центры сертификации»* Windows. |
| Расширение установилось, но не подключается к прокси | Отсутствуют настройки в `3rdparty\extensions` | Проверьте наличие ветки `Software\Policies\<Browser>\3rdparty\extensions\<ID>\policy` и параметр `extToken`. |
| Сервер возвращает HTTP 403 Forbidden на `/api/sync` или `/creds` | Сработал Active Directory Kill-Switch | Убедитесь, что пользователь входит в группу `AD_REQUIRED_GROUP_DN`, учетная запись не заблокирована в AD, и в реестре передается корректный `domainUser`. |
| Политика не применилась к пользователю на RDS | Не включен Loopback Processing | Включите *Loopback Processing Mode = Merge* на OU терминальных серверов в GPMC. |
| При исключении пользователя из группы расширение остаётся в браузере | В GPP не был включен флаг `removePolicy="1"` | В свойствах элементов реестра в GPMC (вкладка Common) отметьте чекбокс *«Remove this item when it is no longer applied»*. |
| Изменился ID расширения после обновления сервера | Был утерян закрытый RSA-ключ | Убедитесь, что файл `extension/key.pem` сохранен в постоянном хранилище (или задан через переменную `PEC_PRIVATE_KEY_PEM`). |
