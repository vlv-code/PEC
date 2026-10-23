/**
 * GPO Templates: PowerShell deployment and diagnostics scripts + AD GPMC Readme
 */

export function renderDeployGpoScript(
  extensionId: string,
  serverUrl: string,
  token: string,
  targetGroup: string = ""
): string {
  const safeExtId = extensionId.replace(/["`$]/g, "");
  const safeServerUrl = serverUrl.replace(/["`$]/g, "").replace(/\/+$/, "");
  const safeToken = token.replace(/["`$]/g, "");
  const safeTargetGroup = targetGroup.replace(/["`$]/g, "");

  return `<#
.SYNOPSIS
    PEC - Corporate Proxy Extension GPO Deployment Script
.DESCRIPTION
    Automates deployment and configuration of the PEC Chrome/Edge/Yandex/Opera extension
    via Active Directory GPO (Logon script, Startup script, or manual execution).
    Safe: will not overwrite existing corporate extensions in ExtensionInstallForcelist.
    Supports AD security group filtering and multi-user RDS/Terminal Server environments.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)]
    [string]$ServerUrl = "${safeServerUrl}",

    [Parameter(Mandatory=$false)]
    [string]$Token = "${safeToken}",

    [Parameter(Mandatory=$false)]
    [string]$TargetGroup = "${safeTargetGroup}",

    [Parameter(Mandatory=$false)]
    [ValidateSet("User", "Machine")]
    [string]$Scope = "User",

    [Parameter(Mandatory=$false)]
    [string]$RequireAdGroup = "",

    [Parameter(Mandatory=$false)]
    [switch]$Uninstall,

    [Parameter(Mandatory=$false)]
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$ExtensionId = "${safeExtId}"
$UpdateUrl = "$($ServerUrl.TrimEnd('/'))/updates/updates.xml"
$CredsUrl = "$($ServerUrl.TrimEnd('/'))/creds"
$SyncUrl = "$($ServerUrl.TrimEnd('/'))/api/sync"
$ForcelistValue = "$ExtensionId;$UpdateUrl"

function Write-PecLog([string]$Message, [string]$Level = "INFO") {
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $color = switch ($Level) {
        "SUCCESS" { "Green" }
        "WARN"    { "Yellow" }
        "ERROR"   { "Red" }
        default   { "Cyan" }
    }
    Write-Host "[$timestamp] [PEC-GPO] [$Level] $Message" -ForegroundColor $color
}

# --- 1. Check Active Directory Group Membership (if required) ---
if (-not [string]::IsNullOrWhiteSpace($RequireAdGroup)) {
    Write-PecLog "Checking membership for user '$env:USERNAME' in required AD group '$RequireAdGroup'..."
    $isMember = $false

    try {
        $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
        $groupNames = @()
        foreach ($group in $identity.Groups) {
            try {
                $groupNames += $group.Translate([System.Security.Principal.NTAccount]).Value
            } catch {}
        }

        if ($groupNames.Count -eq 0) {
            $whoami = whoami /groups /fo csv | ConvertFrom-Csv
            $groupNames += $whoami.'Group Name'
        }

        foreach ($gn in $groupNames) {
            if ($gn -like "*$RequireAdGroup*") {
                $isMember = $true
                break
            }
        }
    } catch {
        Write-PecLog "Could not resolve AD groups via token: $_" "WARN"
    }

    if (-not $isMember) {
        Write-PecLog "User '$env:USERNAME' is NOT a member of required group '$RequireAdGroup'." "WARN"
        Write-PecLog "Revoking/cleaning up PEC extension policies from user profile..."
        $Uninstall = $true
    } else {
        Write-PecLog "User '$env:USERNAME' is a verified member of '$RequireAdGroup'." "SUCCESS"
    }
}

# --- 2. Determine Registry Root ---
$regRoot = if ($Scope -eq "Machine") { "HKLM:\\SOFTWARE\\Policies" } else { "HKCU:\\Software\\Policies" }

$browsers = @(
    @{ Name = "Google Chrome"; Key = "Google\\Chrome" },
    @{ Name = "Microsoft Edge"; Key = "Microsoft\\Edge" },
    @{ Name = "Yandex Browser"; Key = "YandexBrowser" },
    @{ Name = "Opera"; Key = "Opera Software\\Opera" },
    @{ Name = "Chromium (Generic)"; Key = "Chromium" }
)

# --- 3. Process Each Browser ---
foreach ($b in $browsers) {
    $browserBase = Join-Path $regRoot $b.Key
    $forcelistPath = Join-Path $browserBase "ExtensionInstallForcelist"
    $allowlistPath = Join-Path $browserBase "ExtensionInstallAllowlist"
    $policyPath = Join-Path (Join-Path (Join-Path $browserBase "3rdparty") "extensions") (Join-Path $ExtensionId "policy")

    if ($Uninstall) {
        Write-PecLog "[$($b.Name)] Removing PEC policies..."

        # Remove from Forcelist
        if (Test-Path $forcelistPath) {
            $props = (Get-ItemProperty -Path $forcelistPath).PSObject.Properties
            foreach ($p in $props) {
                if ($p.Value -like "$ExtensionId*") {
                    Remove-ItemProperty -Path $forcelistPath -Name $p.Name -ErrorAction SilentlyContinue
                    Write-PecLog "[$($b.Name)] Removed from ExtensionInstallForcelist (index $($p.Name))." "SUCCESS"
                }
            }
        }

        # Remove from Allowlist
        if (Test-Path $allowlistPath) {
            $props = (Get-ItemProperty -Path $allowlistPath).PSObject.Properties
            foreach ($p in $props) {
                if ($p.Value -eq $ExtensionId) {
                    Remove-ItemProperty -Path $allowlistPath -Name $p.Name -ErrorAction SilentlyContinue
                    Write-PecLog "[$($b.Name)] Removed from ExtensionInstallAllowlist (index $($p.Name))." "SUCCESS"
                }
            }
        }

        # Remove managed storage
        $extBase = Join-Path (Join-Path (Join-Path $browserBase "3rdparty") "extensions") $ExtensionId
        if (Test-Path $extBase) {
            Remove-Item -Path $extBase -Recurse -Force -ErrorAction SilentlyContinue
            Write-PecLog "[$($b.Name)] Removed managed policy keys." "SUCCESS"
        }

        # Remove ExtensionSettings
        Remove-ItemProperty -Path $browserBase -Name "ExtensionSettings" -ErrorAction SilentlyContinue
        continue
    }

    Write-PecLog "[$($b.Name)] Applying PEC enterprise policies ($Scope scope)..."

    # Ensure parent keys exist
    if (-not (Test-Path $forcelistPath)) { New-Item -Path $forcelistPath -Force | Out-Null }
    if (-not (Test-Path $allowlistPath)) { New-Item -Path $allowlistPath -Force | Out-Null }
    if (-not (Test-Path $policyPath)) { New-Item -Path $policyPath -Force | Out-Null }

    # Safe index assignment in ExtensionInstallForcelist (avoid collisions)
    $forcelistProps = (Get-ItemProperty -Path $forcelistPath).PSObject.Properties
    $existingIndex = $null
    $maxIndex = 0

    foreach ($p in $forcelistProps) {
        if ($p.Name -match '^\d+$') {
            $idx = [int]$p.Name
            if ($idx -gt $maxIndex) { $maxIndex = $idx }
        }
        if ($p.Value -like "$ExtensionId*") {
            $existingIndex = $p.Name
        }
    }

    $targetIndex = if ($existingIndex) { $existingIndex } else { [string]($maxIndex + 1) }
    Set-ItemProperty -Path $forcelistPath -Name $targetIndex -Value $ForcelistValue -Type String
    Write-PecLog "[$($b.Name)] Forcelist entry set at index '$targetIndex'." "SUCCESS"

    # Safe index assignment in ExtensionInstallAllowlist
    $allowlistProps = (Get-ItemProperty -Path $allowlistPath).PSObject.Properties
    $allowIndex = $null
    $maxAllow = 0

    foreach ($p in $allowlistProps) {
        if ($p.Name -match '^\d+$') {
            $idx = [int]$p.Name
            if ($idx -gt $maxAllow) { $maxAllow = $idx }
        }
        if ($p.Value -eq $ExtensionId) {
            $allowIndex = $p.Name
        }
    }

    $targetAllow = if ($allowIndex) { $allowIndex } else { [string]($maxAllow + 1) }
    Set-ItemProperty -Path $allowlistPath -Name $targetAllow -Value $ExtensionId -Type String
    Write-PecLog "[$($b.Name)] Allowlist entry set at index '$targetAllow'." "SUCCESS"

    # Modern ExtensionSettings (REG_SZ) with browser-specific installation mode
    # Note: Unmanaged Yandex Browser requires normal_installed; force_installed is blocked by Yandex security layer.
    $installMode = if ($b.Key -like "*Yandex*") { "normal_installed" } else { "force_installed" }
    $extSettingsVal = '{"*":{"install_sources":["' + $ServerUrl.TrimEnd('/') + '/*"]},"' + $ExtensionId + '":{"installation_mode":"' + $installMode + '","update_url":"' + $UpdateUrl + '","override_update_url":true}}'
    Set-ItemProperty -Path $browserBase -Name "ExtensionSettings" -Value $extSettingsVal -Type String
    Write-PecLog "[$($b.Name)] ExtensionSettings applied (mode: $installMode, override_update_url: true)." "SUCCESS"

    # Managed Storage configuration (chrome.storage.managed)
    Set-ItemProperty -Path $policyPath -Name "extToken" -Value $Token -Type String
    Set-ItemProperty -Path $policyPath -Name "syncUrl" -Value $SyncUrl -Type String
    Set-ItemProperty -Path $policyPath -Name "credsUrl" -Value $CredsUrl -Type String
    Set-ItemProperty -Path $policyPath -Name "autoConfigureProxy" -Value 1 -Type DWord
    if (-not [string]::IsNullOrWhiteSpace($TargetGroup)) {
        Set-ItemProperty -Path $policyPath -Name "targetGroup" -Value $TargetGroup -Type String
    }
    Write-PecLog "[$($b.Name)] Managed configuration applied (Token, Sync, Creds)." "SUCCESS"
}

Write-PecLog "All PEC policies successfully configured. Restart browser or reload policies to activate." "SUCCESS"
`;
}

export function renderVerifyGpoScript(
  extensionId: string,
  serverUrl: string,
  token: string
): string {
  const safeExtId = extensionId.replace(/["`$]/g, "");
  const safeServerUrl = serverUrl.replace(/["`$]/g, "").replace(/\/+$/, "");

  return `<#
.SYNOPSIS
    PEC - Corporate Proxy Extension Deployment Diagnostic Tool
.DESCRIPTION
    Verifies network reachability to PEC behind Nginx, tests TLS certificate validity,
    audits browser policies in registry (HKCU/HKLM), and verifies extension profile installation.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)]
    [string]$ServerUrl = "${safeServerUrl}",

    [Parameter(Mandatory=$false)]
    [string]$ExtensionId = "${safeExtId}"
)

$ErrorActionPreference = "Continue"

function Write-CheckResult([string]$TestName, [string]$Status, [string]$Details = "") {
    $color = switch ($Status) {
        "PASS" { "Green" }
        "WARN" { "Yellow" }
        "FAIL" { "Red" }
        default { "White" }
    }
    Write-Host "[$Status] " -ForegroundColor $color -NoNewline
    Write-Host "$TestName" -NoNewline
    if ($Details) {
        Write-Host " - $Details" -ForegroundColor Gray
    } else {
        Write-Host ""
    }
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " PEC Extension Corporate GPO Deployment Diagnostics" -ForegroundColor Cyan
Write-Host " Target Server: $ServerUrl" -ForegroundColor Cyan
Write-Host " Extension ID : $ExtensionId" -ForegroundColor Cyan
Write-Host " Date/Time    : $(Get-Date)" -ForegroundColor Cyan
Write-Host " User / Host  : $env:USERDOMAIN\\$env:USERNAME on $env:COMPUTERNAME" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# --- 1. Network & TLS Probes ---
Write-Host "--- 1. Network & TLS Certificate Verification ---" -ForegroundColor White

# 1.1 Healthz Endpoint
try {
    $healthUrl = "$($ServerUrl.TrimEnd('/'))/healthz"
    $req = [System.Net.HttpWebRequest]::Create($healthUrl)
    $req.Timeout = 8000
    $resp = $req.GetResponse()
    $statusCode = [int]$resp.StatusCode
    $resp.Close()

    if ($statusCode -eq 200) {
        Write-CheckResult "PEC Server Reachability (/healthz)" "PASS" "HTTP 200 OK"
    } else {
        Write-CheckResult "PEC Server Reachability (/healthz)" "WARN" "Returned HTTP $statusCode"
    }
} catch [System.Net.WebException] {
    $status = $_.Exception.Status
    if ($_.Exception.Message -like "*trust*" -or $_.Exception.Message -like "*certificate*") {
        Write-CheckResult "TLS Certificate Validation" "FAIL" "Certificate trust failure: $($_.Exception.Message)"
    } else {
        Write-CheckResult "PEC Server Reachability (/healthz)" "FAIL" "Cannot connect: $($_.Exception.Message)"
    }
} catch {
    Write-CheckResult "PEC Server Reachability (/healthz)" "FAIL" "$_"
}

# 1.2 Updates.xml check
try {
    $xmlUrl = "$($ServerUrl.TrimEnd('/'))/updates/updates.xml"
    $xmlReq = [System.Net.HttpWebRequest]::Create($xmlUrl)
    $xmlReq.Timeout = 8000
    $xmlResp = $xmlReq.GetResponse()
    $sr = New-Object System.IO.StreamReader($xmlResp.GetResponseStream())
    $xmlContent = $sr.ReadToEnd()
    $sr.Close()
    $xmlResp.Close()

    if ($xmlContent -like "*$ExtensionId*") {
        Write-CheckResult "Update Manifest (/updates/updates.xml)" "PASS" "Found valid XML containing appid='$ExtensionId'"
    } else {
        Write-CheckResult "Update Manifest (/updates/updates.xml)" "WARN" "XML returned but appid='$ExtensionId' not found"
    }
} catch {
    Write-CheckResult "Update Manifest (/updates/updates.xml)" "FAIL" "Failed to retrieve: $($_.Exception.Message)"
}

# 1.3 CRX download test (HEAD or short read)
try {
    $crxUrl = "$($ServerUrl.TrimEnd('/'))/updates/extension.crx"
    $crxReq = [System.Net.HttpWebRequest]::Create($crxUrl)
    $crxReq.Method = "HEAD"
    $crxReq.Timeout = 8000
    $crxResp = $crxReq.GetResponse()
    $contentType = $crxResp.ContentType
    $contentLen = $crxResp.ContentLength
    $crxResp.Close()

    if ($contentType -like "*chrome-extension*" -or $contentType -like "*octet-stream*") {
        Write-CheckResult "CRX Binary Download (/updates/extension.crx)" "PASS" "Content-Type: $contentType, Size: $([math]::Round($contentLen / 1KB, 1)) KB"
    } else {
        Write-CheckResult "CRX Binary Download (/updates/extension.crx)" "WARN" "Unexpected Content-Type '$contentType' from Nginx"
    }
} catch {
    Write-CheckResult "CRX Binary Download (/updates/extension.crx)" "FAIL" "Cannot fetch CRX: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "--- 2. Windows Registry Policy Verification ---" -ForegroundColor White

$browsers = @(
    @{ Name = "Google Chrome"; Key = "Google\\Chrome" },
    @{ Name = "Microsoft Edge"; Key = "Microsoft\\Edge" },
    @{ Name = "Yandex Browser"; Key = "YandexBrowser" },
    @{ Name = "Opera"; Key = "Opera Software\\Opera" }
)

foreach ($b in $browsers) {
    $foundScope = $null
    $hasForcelist = $false
    $hasToken = $false
    $hasSettings = $false
    $settingsVal = $null

    foreach ($scopeRoot in @("HKCU:\\Software\\Policies", "HKLM:\\SOFTWARE\\Policies")) {
        $base = Join-Path $scopeRoot $b.Key
        $forcePath = Join-Path $base "ExtensionInstallForcelist"
        $polPath = Join-Path (Join-Path (Join-Path $base "3rdparty") "extensions") (Join-Path $ExtensionId "policy")

        if (Test-Path $forcePath) {
            $props = (Get-ItemProperty -Path $forcePath).PSObject.Properties
            foreach ($p in $props) {
                if ($p.Value -like "$ExtensionId*") {
                    $hasForcelist = $true
                    $foundScope = if ($scopeRoot -like "HKCU*") { "HKCU" } else { "HKLM" }
                    break
                }
            }
        }

        if (Test-Path $polPath) {
            $val = (Get-ItemProperty -Path $polPath -ErrorAction SilentlyContinue).extToken
            if ($val) { $hasToken = $true }
        }

        $rawSettings = (Get-ItemProperty -Path $base -ErrorAction SilentlyContinue).ExtensionSettings
        if ($rawSettings) {
            $hasSettings = $true
            $settingsVal = $rawSettings
            if (-not $foundScope) {
                $foundScope = if ($scopeRoot -like "HKCU*") { "HKCU" } else { "HKLM" }
            }
        }
    }

    if ($b.Name -like "*Yandex*" -and $settingsVal -like "*force_installed*") {
        Write-CheckResult "$($b.Name) Enterprise Policies" "WARN" "force_installed detected in unmanaged Yandex Browser! Extension may be deactivated by Yandex internal security. Change to normal_installed."
    } elseif (($hasForcelist -and $hasToken) -or $hasSettings) {
        $details = if ($hasSettings -and $hasForcelist) { "Forcelist + ExtensionSettings ($foundScope)" } elseif ($hasSettings) { "ExtensionSettings ($foundScope)" } else { "Forcelist + Managed Storage ($foundScope)" }
        Write-CheckResult "$($b.Name) Enterprise Policies" "PASS" "Configured in $details"
    } elseif ($hasForcelist) {
        Write-CheckResult "$($b.Name) Enterprise Policies" "WARN" "ExtensionInstallForcelist present in $foundScope, but 3rdparty token policy missing!"
    } else {
        Write-CheckResult "$($b.Name) Enterprise Policies" "WARN" "No policies found in HKCU or HKLM"
    }
}

Write-Host ""
Write-Host "--- 3. Local Browser Profile Installation Status ---" -ForegroundColor White

$profilePaths = @(
    @{ Browser = "Google Chrome"; Path = "$env:LOCALAPPDATA\\Google\\Chrome\\User Data\\Default\\Extensions\\$ExtensionId" },
    @{ Browser = "Microsoft Edge"; Path = "$env:LOCALAPPDATA\\Microsoft\\Edge\\User Data\\Default\\Extensions\\$ExtensionId" },
    @{ Browser = "Yandex Browser"; Path = "$env:LOCALAPPDATA\\Yandex\\YandexBrowser\\User Data\\Default\\Extensions\\$ExtensionId" },
    @{ Browser = "Opera"; Path = "$env:APPDATA\\Opera Software\\Opera Stable\\Extensions\\$ExtensionId" }
)

foreach ($p in $profilePaths) {
    if (Test-Path $p.Path) {
        $versions = Get-ChildItem -Path $p.Path -Directory | Select-Object -ExpandProperty Name
        Write-CheckResult "$($p.Browser) Installed Extension" "PASS" "Found version(s): $($versions -join ', ')"
    } else {
        Write-CheckResult "$($p.Browser) Installed Extension" "WARN" "Not yet downloaded to local profile. Restart browser or click 'Reload policies' in browser://policy."
    }
}

Write-Host ""
Write-Host "Diagnostics complete." -ForegroundColor Cyan
`;
}

export function renderGpoReadme(
  extensionId: string,
  serverUrl: string
): string {
  const safeServerUrl = serverUrl.replace(/\/+$/, "");

  const chromeSettingsVal = JSON.stringify({
    "*": {
      install_sources: [`${safeServerUrl}/*`],
    },
    [extensionId]: {
      installation_mode: "force_installed",
      update_url: `${safeServerUrl}/updates/updates.xml`,
      override_update_url: true,
    },
  });

  const edgeSettingsVal = JSON.stringify({
    "*": {
      install_sources: [`${safeServerUrl}/*`],
    },
    [extensionId]: {
      installation_mode: "force_installed",
      update_url: `${safeServerUrl}/updates/updates.xml`,
      override_update_url: true,
    },
  });

  const yandexSettingsVal = JSON.stringify({
    "*": {
      install_sources: [`${safeServerUrl}/*`],
    },
    [extensionId]: {
      installation_mode: "normal_installed",
      update_url: `${safeServerUrl}/updates/updates.xml`,
      override_update_url: true,
    },
  });

  return `# PEC Corporate GPO Deployment Package

Данный пакет содержит все необходимые конфигурации и файлы для централизованного развертывания браузерного расширения **PEC (Proxy Extension Corp)** через групповые политики Active Directory.

- **Extension ID:** \`${extensionId}\`
- **Server URL:** \`${safeServerUrl}\`
- **Целевые браузеры:** Google Chrome, Microsoft Edge, Яндекс.Браузер, Opera

---

## Содержимое пакета

1. **\`extension-settings-chrome.json\`** — боевой JSON параметр \`ExtensionSettings\` для Google Chrome (\`force_installed\`).
2. **\`extension-settings-edge.json\`** — боевой JSON параметр \`ExtensionSettings\` для Microsoft Edge (\`force_installed\`).
3. **\`extension-settings-yandex.json\`** — боевой JSON параметр \`ExtensionSettings\` для Яндекс.Браузера (\`normal_installed\`).
4. **\`extension-settings.json\`** — базовый JSON параметр \`ExtensionSettings\` (для обратной совместимости).
5. **\`pec-policy-user-hkcu.reg\`** — файл реестра текущего пользователя (\`HKCU\`) с готовыми разделами \`ExtensionSettings\`, \`ExtensionInstallForcelist\`, \`ExtensionInstallAllowlist\` и managed policy.
6. **\`pec-policy-machine-hklm.reg\`** — файл реестра для всего компьютера (\`HKLM\`).
7. **\`deploy-pec-gpo.ps1\`** — автоматизированный PowerShell-скрипт развертывания с защитой от затирания сторонних расширений.
8. **\`verify-pec-gpo.ps1\`** — диагностический скрипт проверки сетевой доступности, TLS-сертификата Nginx и политик в реестре.

---

## Основной способ развертывания по умолчанию (Проверен в боевой среде)

Конфигурация протестирована в боевой корпоративной инфраструктуре Active Directory и является **стандартом развертывания по умолчанию**.

### 1. Топология размещения и привязки GPO

1. Откройте консоль **Group Policy Management** (\`gpmc.msc\`).
2. Создайте объект групповой политики (GPO), например: \`PEC-Proxy-Extension-Deployment\`.
3. **Привязка к OU:** Свяжите объект GPO с **OU, содержащим целевые ПК (компьютеры сотрудников)**.
4. **Фильтры безопасности (Security Filtering):**
   - В разделе *Security Filtering* добавьте вашу целевую группу безопасности пользователей/компьютеров Active Directory (например, \`CORP\\Proxy-Allowed-Users\` или \`CORP\\Proxy-Target-PCs\`).
5. ⚠️ **КРИТИЧЕСКИ ВАЖНО В ДЕЛЕГИРОВАНИИ (Delegation):**
   - Перейдите на вкладку **Delegation (Делегирование)** созданного объекта GPO.
   - Нажмите **Add (Добавить)** и ОБЯЗАТЕЛЬНО укажите группу **\`Authenticated Users\`** (в русскоязычной Windows — **«Прошедшие проверку»**) с разрешением **«Read» (Чтение)**.
   > **Почему это обязательно?**  
   > В соответствии с бюллетенем безопасности Microsoft **MS16-072 (KB3163622)**, групповые политики пользователя считываются клиентской рабочей станцией в контексте учетной записи компьютера. Если у \`Authenticated Users\` отсутствует право на чтение объекта GPO, при применении фильтрации безопасности компьютер не сможет прочесть файлы политики из SYSVOL, и параметры реестра пользователя **не применятся**.

6. **Режим замыкания (Loopback Processing) для OU компьютеров:**
   - Так как политика привязана к OU с ПК, откройте редактор GPO:
   - \`Конфигурация компьютера → Политики → Административные шаблоны → Система → Групповая политика\`
   - Включите: **«Режим обработки пользовательской групповой политики замыкания»** (\`Configure user Group Policy loopback processing mode\`) = **Включено (Объединение / Merge)**.

---

### 2. Размещение параметров в редакторе GPO

В редакторе объекта групповой политики перейдите по пути:
\`Конфигурация пользователя (включено) → Настройка → Конфигурация Windows → Реестр\`  
*(User Configuration → Preferences → Windows Settings → Registry)*

Создайте 3 элемента реестра для каждого поддерживаемого браузера:

#### Элемент 1: Google Chrome
- **Вкладка «Общие» (General):**
  - **Действие:** \`Заменить\` *(Replace)*
  - **Куст:** \`HKEY_CURRENT_USER\`
  - **Путь к разделу:** \`Software\\Policies\\Google\\Chrome\`
  - **Имя параметра:** \`ExtensionSettings\`
  - **Тип параметра:** \`REG_SZ\`
  - **Значение:**
    \`\`\`json
    ${chromeSettingsVal}
    \`\`\`
- **Вкладка «Общие параметры» (Common):**
  - Остановить обработку элементов при ошибке: **Нет**
  - Запуск в контексте безопасности текущего пользователя: **Нет**
  - Удалить этот элемент, если он больше не применяется: **Нет**
  - Применить один раз и не применять повторно: **Нет**

#### Элемент 2: Microsoft Edge
- **Вкладка «Общие» (General):**
  - **Действие:** \`Заменить\` *(Replace)*
  - **Куст:** \`HKEY_CURRENT_USER\`
  - **Путь к разделу:** \`Software\\Policies\\Microsoft\\Edge\`
  - **Имя параметра:** \`ExtensionSettings\`
  - **Тип параметра:** \`REG_SZ\`
  - **Значение:**
    \`\`\`json
    ${edgeSettingsVal}
    \`\`\`
- **Вкладка «Общие параметры» (Common):**
  - Остановить обработку элементов при ошибке: **Нет**
  - Запуск в контексте безопасности текущего пользователя: **Нет**
  - Удалить этот элемент, если он больше не применяется: **Нет**
  - Применить один раз и не применять повторно: **Нет**

#### Элемент 3: Яндекс.Браузер
- **Вкладка «Общие» (General):**
  - **Действие:** \`Заменить\` *(Replace)*
  - **Куст:** \`HKEY_CURRENT_USER\`
  - **Путь к разделу:** \`Software\\Policies\\YandexBrowser\`
  - **Имя параметра:** \`ExtensionSettings\`
  - **Тип параметра:** \`REG_SZ\`
  - **Значение:**
    \`\`\`json
    ${yandexSettingsVal}
    \`\`\`
- **Вкладка «Общие параметры» (Common):**
  - Остановить обработку элементов при ошибке: **Нет**
  - Запуск в контексте безопасности текущего пользователя: **Нет**
  - Удалить этот элемент, если он больше не применяется: **Нет**
  - Применить один раз и не применять повторно: **Нет**

---

### ⚠️ Критическое замечание по Яндекс.Браузеру

> **ВНИМАНИЕ:**  
> Если используемая редакция Яндекс.Браузера **не управляется через корпоративную консоль администрирования Яндекса**, режим установки \`force_installed\` ставить **НЕЛЬЗЯ**!  
> В потребительских или неуправляемых через консоль версиях Яндекс.Браузера встроенная прослойка безопасности принудительно деактивирует и блокирует расширение, если для него задан \`force_installed\` из внешнего источника.  
> Для Яндекс.Браузера обязательно используйте режим **\`normal_installed\`** — расширение будет установлено и регулярно обновляться по адресу \`update_url\`, не вызывая срабатывания защитных механизмов браузера.

---

## Альтернативный вариант: Быстрое развертывание через Logon-скрипт

1. В GPMC откройте GPO на редактирование.
2. Перейдите в \`Конфигурация пользователя → Политики → Конфигурация Windows → Сценарии (вход/выход) → Вход в систему\`.
3. Вкладка **PowerShell Scripts** → кнопка **Добавить** → скопируйте файл \`deploy-pec-gpo.ps1\`.
4. (Опционально) В поле параметров укажите: \`-RequireAdGroup "CORP\\Proxy-Allowed-Users"\`.

---

## Проверка и диагностика на рабочих местах

На целевом компьютере пользователя выполните в PowerShell:
\`\`\`powershell
gpupdate /force
.\\verify-pec-gpo.ps1
\`\`\`

Для проверки применения политик непосредственно в браузере:
- **Chrome:** \`chrome://policy\` → кнопка *«Перезагрузить политики»*
- **Edge:** \`edge://policy\` → кнопка *«Перезагрузить политики»*
- **Яндекс.Браузер:** \`browser://policy\` → кнопка *«Перезагрузить политики»*
`;
}
