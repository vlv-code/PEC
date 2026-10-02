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
  tokenHash?: string;
  enrolledAt?: string;
  revoked?: boolean;
}

export interface RotationConfig {
  enabled: boolean;
  intervalMinutes: number;
  panelUrl: string;
  adminUser: string;
  adminPass: string;
  inboundRemark: string;
  inboundTag?: string;
  insecureSkipVerify: boolean;
  lastRotatedAt?: string;
  nextRotationAt?: string;
  lastStatus?: string;
  lastError?: string;
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
  token?: string;
  locale?: "ru" | "en";
  uiMode?: "popup" | "stealth";
  presetTemplate?: "self-service-pro" | "enterprise-invisible";
  presetStyle?: "cyber-blue" | "dark-obsidian" | "emerald-sentinel" | "sunset-amber" | "minimal-light";
  uiLayout?: "console" | "terminal";
  colorPalette?: "cyber" | "obsidian" | "nord" | "emerald" | "light";
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
}

export interface ProxyNode {
  id: string;                      // Unique ID (crypto.randomBytes(4).toString("hex") or uuid)
  tag: string;                     // Inbound tag or manual custom tag
  name: string;                    // Friendly display name
  type: "3x-ui" | "manual";        // Source type
  protocol: "socks5" | "http" | "https";
  host: string;                    // Proxy IP or FQDN
  port: number;                    // Listen port (1-65535)
  username?: string;               // Auth username
  password?: string;               // Auth password
  isActive: boolean;               // If true, feeds PAC and active creds
  lastSync?: string;               // ISO timestamp of last sync / rotation
  status?: "OK" | "ERROR" | "IDLE";
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}
