export interface ProxyCredentials {
  user: string;
  pass: string;
  updatedAt?: string;
}

export type ProxyProtocol = "http" | "https" | "socks5" | "pac" | "direct";

export type RoutingAction = "proxy" | "direct" | "block";
export type RuleTargetType = "domain" | "wildcard" | "cidr" | "preset";

export interface RoutingRule {
  id: string;
  name: string;
  targetType: RuleTargetType;
  pattern: string; // e.g. "*.openai.com", "10.0.0.0/8", "preset:ai_services"
  action: RoutingAction;
  enabled: boolean;
  notes?: string;
}

export interface GeoPreset {
  id: string;
  name: string;
  category: "ai" | "social" | "ru" | "internal" | "security" | "diagnostics";
  description: string;
  domains: string[];
}

export interface RoutingPresetItem {
  id: string;
  name: string;
  category: string;
  description: string;
  type: "domain" | "cidr";
  source: "builtin" | "remote" | "file";
  sourceUrl?: string;
  sourceTag?: string;
  lastUpdated?: string;
  domains?: string[];
  entries: string[];
}


export interface RoutingProfile {
  id: string;
  name: string;
  description: string;
  defaultPolicy: "direct" | "proxy"; // "direct": bypass all by default, proxy only matching. "proxy": tunnel all, direct only exceptions.
  failClosed?: boolean; // When true, omit '; DIRECT' fallback to prevent IP leak when proxy is down
  rules: RoutingRule[];
  targetScope: "all" | "group" | "instances";
  targetGroup?: string;
  targetInstanceIds?: string[];
  isDefault?: boolean;
  updatedAt: string;
}

export interface ProxyConfiguration {
  enabled: boolean;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  bypassList: string[];
  pacScript: string;
  pacUrl: string;
  syncIntervalMs: number;
  killSwitch: boolean;
  activeProfileId?: string;
  routingMode?: "pac" | "fixed";
  updatedAt: string;
}

export interface ExtensionInstance {
  instanceId: string;
  ip: string;
  version: string;
  extensionId?: string;
  userAgent?: string;
  lastSync: string;
  syncCount: number;
  status: "ONLINE" | "STALE" | "OFFLINE";
  activeProxyMode?: string;
  group?: string;
  assignedProfileId?: string;
  appliedProfileName?: string;
  assignedProxyId?: string;
  appliedProxyName?: string;
  tokenHash?: string;
  enrolledAt?: string;
  revoked?: boolean;
  username?: string;
  pairedAppId?: string;
  pairedHostname?: string;
  verifiedByApp?: boolean;
}

export interface RotationConfig {
  enabled: boolean;
  intervalMinutes: number;
  panelUrl: string;
  adminUser: string;
  adminPass: string;
  inboundRemark: string;
  inboundTag?: string;
  panelId?: string;
  insecureSkipVerify: boolean;
  lastRotatedAt?: string;
  nextRotationAt?: string;
  lastStatus?: string;
  lastError?: string;
}

export interface Panel3xuiConfig {
  id: string;
  name: string;
  panelUrl: string;
  adminUser: string;
  adminPass: string;
  insecureTls?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface RotationHistoryItem {
  id: string;
  timestamp: string;
  source: "3x-ui" | "standalone-atomic" | "manual";
  user: string;
  success: boolean;
  error?: string;
}

export interface ExtensionBuildConfig {
  name: string;
  shortName: string;
  version: string;
  description?: string;
  serverUrl?: string;
  updateUrl?: string;
  token?: string;
  locale?: "ru" | "en";
  uiMode?: "popup" | "stealth";
  presetTemplate?: "self-service-pro" | "enterprise-invisible";
  presetStyle?: "cyber-blue" | "dark-obsidian" | "nordic-arctic" | "emerald-secops" | "enterprise-light" | "emerald-sentinel" | "sunset-amber" | "minimal-light";
  uiLayout?: "console" | "terminal";
  colorPalette?: "cyber" | "obsidian" | "nord" | "emerald" | "amber" | "light";
  defaultThemeMode?: "dark" | "light";
  themeColor?: string;
  themeBackground?: string;
  themeCard?: string;
  iconEmoji?: string;
  customIconDataUrl?: string;
  iconType?: "shield" | "lock" | "globe" | "bolt" | "server" | "key";
  webRtcProtection?: boolean;
  dnsLeakProtection?: boolean;
  badgeIndicator?: boolean;
  allowUserBypass?: boolean;
  bypassAutoTimeoutMinutes?: number;
  showIpGeoChecker?: boolean;
  showSupportButton?: boolean;
  supportUrl?: string;
  pingTestUrl?: string;
  syncIntervalMinutes?: number;
  defaultServerUrl?: string;
  defaultToken?: string;
  targetProfileId?: string;
  defaultProxyId?: string;
  allowUserProxySwitch?: boolean;
  autoConfigureProxy?: boolean;
  targetGroup?: string;
  /** Source files manually edited in the Studio; regeneration never clobbers them. */
  overriddenFiles?: string[];
}

export interface ExtensionBuildInfo {
  extensionId: string;
  version: string;
  name: string;
  hasPrivateKey: boolean;
  crxExists: boolean;
  zipExists: boolean;
  updatesXmlExists: boolean;
  unpackedExists?: boolean;
  unpackedPath?: string;
  lastPackTime?: string;
  uiMode?: "stealth" | "popup";
  zipPath?: string;
  crxPath?: string;
  xmlPath?: string;
  buildLog?: string[];
  codeSigningStatus?: {
    isSigned: boolean;
    subject?: string;
    issuer?: string;
    type?: string;
  };
}

export interface ProxyCheckResult {
  id: string;
  status: "ONLINE" | "OFFLINE" | "ERROR" | "TIMEOUT";
  latencyMs: number;
  egressIp?: string;
  geoCountry?: string;
  checkedAt: string;
  error?: string;
}

export interface ProxyNode {
  id: string;                      // Unique ID (crypto.randomBytes(4).toString("hex") or uuid)
  tag: string;                     // Inbound tag or manual custom tag
  name: string;                    // Friendly display name
  type: "3x-ui" | "manual";        // Source type
  panelId?: string;                // Reference to Panel3xuiConfig.id
  protocol: "socks5" | "http" | "https";
  host: string;                    // Proxy IP or FQDN
  port: number;                    // Listen port (1-65535)
  username?: string;               // Auth username
  password?: string;               // Auth password
  isActive: boolean;               // If true, feeds PAC and active creds
  enabled?: boolean;                // If false, node is disabled
  lastSync?: string;               // ISO timestamp of last sync / rotation
  status?: "OK" | "ERROR" | "IDLE" | "ONLINE" | "OFFLINE" | "TIMEOUT" | "CHECKING";
  latencyMs?: number;
  egressIp?: string;
  geoCountry?: string;
  lastCheck?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppProcessRule {
  id: string;
  processName: string;   // e.g. "chrome.exe", "curl.exe", "*"
  targetDomains?: string;// e.g. "*.youtube.com; *.instagram.com; *.corp.local"
  targetHosts?: string;  // e.g. "github.com; *.google.com; 192.168.*.*"
  targetPorts?: string;  // e.g. "80; 443; 8080"
  protocol: "tcp" | "udp" | "both";
  action: "proxy" | "direct" | "block";
}

export interface AppBuildConfig {
  name: string;
  shortName: string;
  version: string;
  description: string;
  presetStyle: "cyber-blue" | "dark-obsidian" | "nordic-arctic" | "emerald-secops" | "enterprise-light" | "emerald-sentinel" | "sunset-amber" | "minimal-light";
  uiLayout?: "console" | "terminal";
  defaultThemeMode: "dark" | "light";
  themeColor: string;
  themeBackground: string;
  themeCard: string;
  iconType: "shield" | "lock" | "globe" | "server" | "key";
  customIconDataUrl?: string;
  defaultServerUrl: string;
  defaultToken: string;
  syncIntervalMinutes: number;
  autoStartWithWindows: boolean;
  startMinimizedToTray: boolean;
  installAsService: boolean;
  trafficLogging: boolean;
  defaultProxyId: string;
  inheritRoutingProfileId?: string;
  processRules: AppProcessRule[];
  updatedAt?: string;
}

export interface AppBuildInfo {
  version: string;
  builtAt: string;
  windowsPackageUrl: string;
  windowsPackageSize: number;
  windowsPackageSha256: string;
  windowsInstallerUrl?: string;
  windowsInstallerSize?: number;
  windowsInstallerSha256?: string;
  windowsMsiUrl?: string;
  windowsMsiSize?: number;
  windowsMsiSha256?: string;
  linuxPackageUrl: string;
  linuxPackageSize: number;
  linuxPackageSha256: string;
  profilePath: string;
  buildLog?: string[];
  codeSigningStatus?: {
    isSigned: boolean;
    subject?: string;
    issuer?: string;
    type?: string;
  };
}

export interface DesktopInstance {
  appInstanceId: string;
  hostname: string;
  username: string;
  os?: string;
  version: string;
  clientType?: string;
  ip: string;
  lastSync: string;
  status: "ONLINE" | "STALE" | "OFFLINE";
  assignedProxyId?: string;
  appliedProxyName?: string;
  pairedExtension?: {
    instanceId: string;
    browser?: string;
  };
}

export interface ReleaseItem {
  id: string;
  type: "extension" | "app";
  version: string;
  builtAt: string;
  sha256: string;
  fileName: string;
  filePath: string;
  isActive: boolean;
  notes?: string;
  size?: number;
}

export interface ReleasesMetaStore {
  activeExtensionVersion?: string;
  activeAppVersion?: string;
  releases: ReleaseItem[];
}

