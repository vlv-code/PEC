import express, { Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  getProxyConfig,
  updateProxyConfig,
  registerHeartbeat,
  getActiveInstances,
  assignInstanceProfile,
} from "./src/instances.js";
import {
  ensureKeyExists,
  getBuildInfo,
  packageExtension,
  getBuildConfig,
  saveBuildConfig,
  generateExtensionFiles,
  getExtensionSourceFiles,
  saveExtensionSourceFile,
  updateManifestVersion,
  generateGpoConfig,
} from "./src/packager.js";
import {
  getAllProfiles,
  getProfileById,
  saveProfile,
  deleteProfile,
  resolveProfileForInstance,
  generatePacScript,
  GEO_PRESETS,
} from "./src/routing.js";
import {
  getRotationConfig,
  updateRotationConfig,
  runManualRotation,
  getRotationHistory,
  startScheduler,
} from "./src/scheduler.js";
import { test3xuiConnection, readCurrentCreds, atomicWriteCreds, getCredsStorePath } from "./src/rotate.js";

const app = express();
const PORT = 3000;
const HOST = "0.0.0.0";

app.use(express.json({ limit: "5mb" }));

// Enable CORS for Chrome Extensions, Cloud Run iframes, and local tooling
app.use((req: Request, res: Response, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, HEAD");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Ext-Token, X-Requested-With, Accept, Origin");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

const DEFAULT_TOKEN = "corp-proxy-secret-token-change-me";
const EXT_SHARED_TOKEN = process.env.EXT_SHARED_TOKEN || DEFAULT_TOKEN;
const CREDS_STORE = getCredsStorePath();

// Ensure initial credentials exist
if (!fs.existsSync(CREDS_STORE)) {
  console.log(`[mini-server] Initializing default credentials at ${CREDS_STORE}`);
  atomicWriteCreds(CREDS_STORE, {
    user: "corp-user",
    pass: "InitialRotatingProxyPass2026!",
  });
}

// Ensure RSA key and initial extension package exist
try {
  ensureKeyExists();
  packageExtension(`http://localhost:${PORT}`);
  console.log("[mini-server] Initial extension package ready.");
} catch (err) {
  console.warn("[mini-server] Initial packaging notice:", err);
}

// Start background rotation scheduler
startScheduler();

// In-memory access audit logs
interface AuditLogEntry {
  id: string;
  timestamp: string;
  ip: string;
  endpoint: string;
  status: number;
  result: "SERVED" | "SYNCED" | "REJECTED_TOKEN" | "STORE_ERROR" | "HEALTH_CHECK" | "ROTATED" | "CONFIG_UPDATED" | "BUILD_SUCCESS";
  details?: string;
}

const auditLogs: AuditLogEntry[] = [];

function recordAudit(entry: Omit<AuditLogEntry, "id" | "timestamp">) {
  const logItem: AuditLogEntry = {
    id: crypto.randomBytes(4).toString("hex"),
    timestamp: new Date().toISOString(),
    ...entry,
  };
  auditLogs.unshift(logItem);
  if (auditLogs.length > 50) auditLogs.pop();
}

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string") return realIp;
  return req.socket.remoteAddress || req.ip || "unknown";
}

function timingSafeCompare(a: string | undefined, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function getBaseUrl(req: Request): string {
  const host = req.get("host") || `localhost:${PORT}`;
  const proto = req.get("x-forwarded-proto") || req.protocol || "http";
  return `${proto}://${host}`;
}

// ---------------------------------------------------------------------------
// 1. Core Endpoints (/healthz, /creds, /api/sync, /proxy.pac)
// ---------------------------------------------------------------------------

app.get("/healthz", (req: Request, res: Response) => {
  const ip = getClientIp(req);
  recordAudit({ ip, endpoint: "/healthz", status: 200, result: "HEALTH_CHECK" });
  res.json({ ok: true });
});

app.get("/creds", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const clientHost = getClientIp(req);
  const xExtTokenHeader = req.headers["x-ext-token"];
  const xExtToken = Array.isArray(xExtTokenHeader) ? xExtTokenHeader[0] : xExtTokenHeader;

  if (!EXT_SHARED_TOKEN || !timingSafeCompare(xExtToken, EXT_SHARED_TOKEN)) {
    recordAudit({
      ip: clientHost,
      endpoint: "/creds",
      status: 403,
      result: "REJECTED_TOKEN",
      details: "Invalid or missing X-Ext-Token",
    });
    return res.status(403).json({ detail: "Forbidden" });
  }

  const creds = readCurrentCreds();
  if (!creds) {
    recordAudit({
      ip: clientHost,
      endpoint: "/creds",
      status: 503,
      result: "STORE_ERROR",
      details: "Credentials store unreadable",
    });
    return res.status(503).json({ detail: "Credentials store error" });
  }

  recordAudit({
    ip: clientHost,
    endpoint: "/creds",
    status: 200,
    result: "SERVED",
    details: `Served user: ${creds.user}`,
  });

  return res.json({ user: creds.user, pass: creds.pass });
});

app.post("/api/sync", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  const clientHost = getClientIp(req);
  const xExtTokenHeader = req.headers["x-ext-token"];
  const xExtToken = Array.isArray(xExtTokenHeader) ? xExtTokenHeader[0] : xExtTokenHeader;

  if (!EXT_SHARED_TOKEN || !timingSafeCompare(xExtToken, EXT_SHARED_TOKEN)) {
    recordAudit({
      ip: clientHost,
      endpoint: "/api/sync",
      status: 403,
      result: "REJECTED_TOKEN",
      details: "Invalid or missing X-Ext-Token",
    });
    return res.status(403).json({ detail: "Forbidden" });
  }

  const { instanceId, version, extensionId, activeProxyMode, group } = req.body || {};
  const currentCreds = readCurrentCreds();
  const proxyConfig = getProxyConfig();

  let assignedProfile = resolveProfileForInstance(instanceId, group);

  if (instanceId) {
    const inst = registerHeartbeat({
      instanceId: String(instanceId),
      ip: clientHost,
      version: String(version || "1.0.0"),
      extensionId: extensionId ? String(extensionId) : undefined,
      userAgent: req.headers["user-agent"],
      activeProxyMode: activeProxyMode ? String(activeProxyMode) : undefined,
      group: group ? String(group) : undefined,
    });
    if (inst.assignedProfileId) {
      const p = getProfileById(inst.assignedProfileId);
      if (p) assignedProfile = p;
    }
  }

  // Generate tailored PAC URL for this instance or profile
  const pacUrl = `${getBaseUrl(req)}/proxy.pac?profileId=${assignedProfile.id}`;

  recordAudit({
    ip: clientHost,
    endpoint: "/api/sync",
    status: 200,
    result: "SYNCED",
    details: `Instance: ${instanceId || "anon"}, Profile: ${assignedProfile.name}`,
  });

  return res.json({
    ok: true,
    serverTime: new Date().toISOString(),
    creds: currentCreds ? { user: currentCreds.user, pass: currentCreds.pass } : null,
    profileId: assignedProfile.id,
    profileName: assignedProfile.name,
    config: {
      ...proxyConfig,
      pacUrl,
    },
  });
});

app.get("/proxy.pac", (req: Request, res: Response) => {
  const proxyConfig = getProxyConfig();
  const profileId = typeof req.query.profileId === "string" ? req.query.profileId : undefined;
  const instanceId = typeof req.query.instanceId === "string" ? req.query.instanceId : undefined;
  const group = typeof req.query.group === "string" ? req.query.group : undefined;

  let profile = profileId ? getProfileById(profileId) : undefined;
  if (!profile) {
    profile = resolveProfileForInstance(instanceId, group);
  }

  const pacContent = generatePacScript(profile, proxyConfig);
  res.setHeader("Content-Type", "application/x-ns-proxy-autoconfig");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.send(pacContent);
});

// ---------------------------------------------------------------------------
// 2. Routing Profiles & GeoPresets Management
// ---------------------------------------------------------------------------

app.get("/api/routing/presets", (_req: Request, res: Response) => {
  res.json(GEO_PRESETS);
});

app.get("/api/routing/profiles", (_req: Request, res: Response) => {
  res.json(getAllProfiles());
});

app.post("/api/routing/profiles", (req: Request, res: Response) => {
  try {
    const saved = saveProfile(req.body);
    recordAudit({
      ip: getClientIp(req),
      endpoint: "/api/routing/profiles",
      status: 200,
      result: "CONFIG_UPDATED",
      details: `Profile: ${saved.name} (Policy: ${saved.defaultPolicy})`,
    });
    res.json(saved);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

app.delete("/api/routing/profiles/:id", (req: Request, res: Response) => {
  try {
    const ok = deleteProfile(req.params.id);
    res.json({ ok });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// 3. Instance Fleet & Profile Assignment
// ---------------------------------------------------------------------------

app.get("/api/instances", (_req: Request, res: Response) => {
  const list = getActiveInstances();
  res.json({
    total: list.length,
    online: list.filter((i) => i.status === "ONLINE").length,
    instances: list,
  });
});

app.post("/api/instances/assign-profile", (req: Request, res: Response) => {
  const { instanceId, profileId, group } = req.body || {};
  if (!instanceId) {
    return res.status(400).json({ error: "instanceId is required" });
  }
  assignInstanceProfile(String(instanceId), profileId ? String(profileId) : undefined, group ? String(group) : undefined);
  res.json({ ok: true });
});

app.get("/api/config", (_req: Request, res: Response) => {
  res.json(getProxyConfig());
});

app.post("/api/config", (req: Request, res: Response) => {
  const updated = updateProxyConfig(req.body);
  recordAudit({
    ip: getClientIp(req),
    endpoint: "/api/config",
    status: 200,
    result: "CONFIG_UPDATED",
    details: `Protocol: ${updated.protocol}, Host: ${updated.host}:${updated.port}, Enabled: ${updated.enabled}`,
  });
  res.json(updated);
});

// ---------------------------------------------------------------------------
// 4. Extension Constructor Studio & Source Editor
// ---------------------------------------------------------------------------

app.get("/api/ip-echo", (req: Request, res: Response) => {
  res.json({
    ip: getClientIp(req),
    country: "Fleet Intranet / Cloud NAT",
    city: "Primary Gateway",
    protocol: "HTTPS",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/builder/config", (_req: Request, res: Response) => {
  res.json(getBuildConfig());
});

app.post("/api/builder/config", (req: Request, res: Response) => {
  const updated = saveBuildConfig(req.body);
  generateExtensionFiles(updated);
  res.json(updated);
});

app.post("/api/builder/regenerate", (_req: Request, res: Response) => {
  const cfg = getBuildConfig();
  generateExtensionFiles(cfg);
  res.json({ ok: true, files: getExtensionSourceFiles() });
});

app.get("/api/builder/files", (_req: Request, res: Response) => {
  res.json(getExtensionSourceFiles());
});

app.post("/api/builder/file", (req: Request, res: Response) => {
  try {
    const { fileName, content } = req.body || {};
    if (!fileName || typeof content !== "string") {
      return res.status(400).json({ error: "fileName and content are required" });
    }
    saveExtensionSourceFile(String(fileName), content);
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

app.post("/api/builder/build", (req: Request, res: Response) => {
  try {
    if (req.body && Object.keys(req.body).length > 0) {
      saveBuildConfig(req.body);
    }
    const baseUrl = getBaseUrl(req);
    const result = packageExtension(baseUrl);

    recordAudit({
      ip: getClientIp(req),
      endpoint: "/api/builder/build",
      status: 200,
      result: "BUILD_SUCCESS",
      details: `Packaged v${result.version} (${result.uiMode || "custom"})`,
    });

    res.json({ ok: true, result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

// Extension distribution & updates
app.use(
  "/updates",
  express.static(path.resolve("./dist/updates"), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".crx")) {
        res.setHeader("Content-Type", "application/x-chrome-extension");
        res.setHeader("Content-Disposition", 'attachment; filename="extension.crx"');
      } else if (filePath.endsWith(".xml")) {
        res.setHeader("Content-Type", "application/xml; charset=utf-8");
      }
    },
  })
);

app.get("/api/extension/info", (req: Request, res: Response) => {
  const baseUrl = getBaseUrl(req);
  const info = getBuildInfo(baseUrl);
  const gpo = generateGpoConfig(info.extensionId, baseUrl, EXT_SHARED_TOKEN);
  res.json({ ...info, baseUrl, gpo });
});

app.get("/api/extension/download-zip", (req: Request, res: Response) => {
  const zipPath = path.resolve("./dist/updates/extension.zip");
  if (!fs.existsSync(zipPath)) {
    packageExtension(getBaseUrl(req));
  }
  res.download(zipPath, "corp-proxy-extension.zip");
});

// ---------------------------------------------------------------------------
// 5. 3x-ui Password Rotation & API Timings
// ---------------------------------------------------------------------------

app.get("/api/rotation/config", (_req: Request, res: Response) => {
  res.json({
    config: getRotationConfig(),
    history: getRotationHistory().slice(0, 10),
  });
});

app.post("/api/rotation/config", (req: Request, res: Response) => {
  const updated = updateRotationConfig(req.body);
  res.json(updated);
});

app.post("/api/rotation/rotate-now", async (req: Request, res: Response) => {
  try {
    const result = await runManualRotation();
    recordAudit({
      ip: getClientIp(req),
      endpoint: "/api/rotation/rotate-now",
      status: 200,
      result: "ROTATED",
      details: `Source: ${result.source}, User: ${result.user}`,
    });
    res.json({ ok: true, result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: msg });
  }
});

app.post("/api/3xui/test", async (req: Request, res: Response) => {
  const current = getRotationConfig();
  const testConfig = {
    panelUrl: req.body?.panelUrl || current.panelUrl,
    adminUser: req.body?.adminUser || current.adminUser,
    adminPass: req.body?.adminPass !== undefined ? req.body.adminPass : current.adminPass,
    inboundRemark: req.body?.inboundRemark || current.inboundRemark,
    timeoutSec: 7,
  };
  const result = await test3xuiConnection(testConfig);
  res.json(result);
});

app.get("/api/status", (_req: Request, res: Response) => {
  const currentCreds = readCurrentCreds();
  const rotConfig = getRotationConfig();
  const instances = getActiveInstances();
  const profilesList = getAllProfiles();

  res.json({
    app: "Corp Proxy Auth Mini-Server & Extension Studio",
    version: "1.3.0",
    status: "online",
    port: PORT,
    tokenConfigured: Boolean(EXT_SHARED_TOKEN),
    defaultTokenInUse: EXT_SHARED_TOKEN === DEFAULT_TOKEN,
    credsStorePath: CREDS_STORE,
    currentUser: currentCreds?.user || "none",
    credsUpdatedAt: currentCreds?.updatedAt || null,
    activeInstancesCount: instances.filter((i) => i.status === "ONLINE").length,
    totalInstancesCount: instances.length,
    profilesCount: profilesList.length,
    nextRotationAt: rotConfig.nextRotationAt || null,
    rotationIntervalMinutes: rotConfig.intervalMinutes,
    rotationEnabled: rotConfig.enabled,
    auditLogs: auditLogs.slice(0, 20),
  });
});

// ---------------------------------------------------------------------------
// 6. Modern Full Management Dashboard UI
// ---------------------------------------------------------------------------

app.get("/", (req: Request, res: Response) => {
  if (req.headers.accept?.includes("application/json") && !req.headers.accept?.includes("text/html")) {
    return res.json({
      title: "Corp Proxy Auth & Extension Studio",
      version: "1.3.0",
      description: "Mini-server managing selective routing, GeoBases, extension constructor studio, GPO distribution, and 3x-ui rotation.",
      endpoints: [
        "GET /healthz",
        "GET /creds",
        "POST /api/sync",
        "GET /proxy.pac",
        "GET /updates/updates.xml",
        "GET /updates/extension.crx",
        "GET /api/routing/profiles",
        "POST /api/routing/profiles",
        "GET /api/routing/presets",
        "GET /api/builder/config",
        "POST /api/builder/build",
        "GET /api/builder/files",
        "POST /api/builder/file",
        "GET /api/instances",
        "POST /api/instances/assign-profile",
        "GET /api/rotation/config",
        "POST /api/rotation/config",
        "POST /api/rotation/rotate-now",
        "POST /api/3xui/test",
      ],
    });
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Corp Proxy Fleet & Extension Studio</title>
  <meta name="description" content="Central manager for selective proxy routing, GeoBases, extension constructor studio, and 3x-ui rotating authentication." />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090e1a;
      --card-bg: #111a2e;
      --card-inner: #0b1120;
      --border: #1e2c4a;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #38bdf8;
      --primary-hover: #0284c7;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --purple: #c084fc;
      --mono: 'JetBrains Mono', monospace;
      --sans: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--sans);
      line-height: 1.5;
      padding: 20px;
      min-height: 100vh;
    }
    .container { max-width: 1280px; margin: 0 auto; }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 18px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
      gap: 12px;
    }
    .badge-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(16, 185, 129, 0.15);
      color: var(--success);
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .badge-status .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--success);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }

    /* Tabs */
    .tabs-nav {
      display: flex;
      gap: 6px;
      margin-bottom: 20px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 10px;
      overflow-x: auto;
    }
    .tab-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-muted);
      padding: 8px 16px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: all 0.15s ease;
      white-space: nowrap;
    }
    .tab-btn:hover { color: var(--text); background: rgba(255, 255, 255, 0.05); }
    .tab-btn.active {
      color: var(--primary);
      background: var(--card-bg);
      border-color: var(--border);
    }

    .tab-pane { display: none; }
    .tab-pane.active { display: block; }

    /* Layout & Cards */
    .grid-2 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
      gap: 20px;
      margin-bottom: 20px;
    }
    .grid-3 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
      margin-bottom: 20px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;
    }
    .card h2 {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: var(--primary);
    }
    .stat-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      font-size: 13px;
    }
    .stat-row:last-child { border-bottom: none; }
    .stat-label { color: var(--text-muted); }
    .stat-value { font-family: var(--mono); font-size: 13px; }

    code, pre {
      font-family: var(--mono);
      background: var(--card-inner);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 12px;
    }
    pre {
      padding: 12px;
      overflow-x: auto;
      border: 1px solid var(--border);
      border-radius: 8px;
      margin: 8px 0;
    }

    /* Form Controls */
    label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      margin-bottom: 5px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    input[type="text"], input[type="password"], input[type="number"], select, textarea {
      width: 100%;
      background: var(--card-inner);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 9px 12px;
      border-radius: 8px;
      font-family: var(--mono);
      font-size: 13px;
      margin-bottom: 14px;
    }
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: var(--primary);
    }

    button, .btn {
      background: var(--primary);
      color: #090e1a;
      border: none;
      padding: 8px 16px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
      text-decoration: none;
    }
    button:hover, .btn:hover { background: var(--primary-hover); color: white; }
    button.btn-secondary, .btn-secondary { background: #1e293b; color: var(--text); border: 1px solid var(--border); }
    button.btn-secondary:hover { background: #334155; }
    button.btn-danger, .btn-danger { background: #dc2626; color: white; }
    button.btn-danger:hover { background: #b91c1c; }
    button.btn-success, .btn-success { background: #10b981; color: #0b1120; }
    button.btn-success:hover { background: #059669; color: white; }

    /* Tables */
    .table-container { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 9px 12px; text-align: left; border-bottom: 1px solid var(--border); }
    th { color: var(--text-muted); font-weight: 600; font-size: 12px; }

    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      font-family: var(--mono);
    }
    .badge-online { background: rgba(16, 185, 129, 0.2); color: var(--success); }
    .badge-stale { background: rgba(245, 158, 11, 0.2); color: var(--warning); }
    .badge-offline { background: rgba(239, 68, 68, 0.2); color: var(--danger); }
    .badge-action-proxy { background: rgba(56, 189, 248, 0.2); color: var(--primary); }
    .badge-action-direct { background: rgba(16, 185, 129, 0.2); color: var(--success); }
    .badge-action-block { background: rgba(239, 68, 68, 0.2); color: var(--danger); }

    .banner {
      background: rgba(56, 189, 248, 0.08);
      border: 1px solid rgba(56, 189, 248, 0.2);
      border-radius: 10px;
      padding: 12px 18px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }

    .preset-card {
      background: var(--card-inner);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .preset-card h4 { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 4px; }
    .preset-card p { font-size: 11px; color: var(--text-muted); margin-bottom: 8px; }

    /* Chrome Mockup & Live Extension Sandbox */
    .browser-mock {
      background: #1e293b;
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.45);
    }
    .browser-top {
      background: #0f172a;
      padding: 8px 12px;
      display: flex;
      align-items: center;
      gap: 10px;
      border-bottom: 1px solid var(--border);
    }
    .browser-dots { display: flex; gap: 6px; }
    .browser-dot { width: 10px; height: 10px; border-radius: 50%; }
    .dot-red { background: #ef4444; }
    .dot-yellow { background: #f59e0b; }
    .dot-green { background: #10b981; }
    .browser-address-bar {
      flex: 1;
      background: #1e293b;
      border-radius: 6px;
      padding: 4px 10px;
      font-size: 11px;
      font-family: var(--mono);
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 6px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .browser-ext-icon {
      position: relative;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.1);
      transition: all 0.15s;
    }
    .browser-ext-icon:hover { background: rgba(255, 255, 255, 0.15); }
    .browser-ext-badge {
      position: absolute;
      bottom: -3px;
      right: -3px;
      background: #10b981;
      color: #0b1120;
      font-size: 8px;
      font-weight: 800;
      padding: 1px 3px;
      border-radius: 3px;
      line-height: 1;
      font-family: var(--mono);
    }
    .preview-canvas {
      background: radial-gradient(circle at 50% 20%, #1e293b, #090e1a);
      min-height: 530px;
      padding: 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      position: relative;
    }
    .popup-frame-box {
      width: 350px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: #0b1120;
      overflow: hidden;
      box-shadow: 0 20px 45px rgba(0, 0, 0, 0.7);
      transition: all 0.2s ease;
    }
    .popup-frame-box iframe {
      width: 100%;
      height: 470px;
      border: none;
      display: block;
    }
    .preset-chip {
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      border: 1px solid var(--border);
      background: var(--card-inner);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s;
      color: var(--text);
    }
    .preset-chip:hover { border-color: var(--primary); background: rgba(56, 189, 248, 0.1); }
    .preset-chip.active { border-color: var(--primary); background: rgba(56, 189, 248, 0.2); color: var(--primary); }
    .color-swatch {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      display: inline-block;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1 style="font-size: 22px; font-weight: 700;">PEC - Proxy Extension Corp</h1>
        <p style="font-size: 14px; color: var(--text-muted);">
          Корпоративное управление прокси &bull; Конструктор расширений &bull; Ротация 3x-ui &bull; GPO развертывание &bull; Docker
        </p>
      </div>
      <div style="display: flex; align-items: center; gap: 10px;">
        <span class="badge-status">
          <span class="dot"></span>
          <span>Шлюз активен</span>
        </span>
        <button onclick="refreshAll()" class="btn-secondary" style="font-size: 12px;">Обновить данные</button>
      </div>
    </header>

    <!-- Top quick overview banner -->
    <div class="banner">
      <div>
        <strong>Подключено устройств:</strong> <span id="hdrFleetCount">0 активных</span> &bull; 
        <strong>Текущий пользователь:</strong> <code id="hdrUser">corp-user</code> &bull; 
        <strong>Активный профиль PAC:</strong> <span id="hdrActiveProfile" style="color: var(--primary);">Direct Default</span> &bull;
        <strong>Следующая ротация:</strong> <span id="hdrNextRot">Расчет...</span>
      </div>
      <div style="display: flex; gap: 8px;">
        <button onclick="manualRotate()" style="font-size: 12px; padding: 6px 12px;">Ротировать пароль сейчас</button>
        <button id="btnKillSwitch" onclick="toggleKillSwitch()" class="btn-secondary" style="font-size: 12px; padding: 6px 12px;">Kill-Switch: ВЫКЛ</button>
      </div>
    </div>

    <!-- Navigation Tabs -->
    <div class="tabs-nav">
      <button class="tab-btn active" onclick="switchTab('routing')">Маршрутизация и Гео-базы</button>
      <button class="tab-btn" onclick="switchTab('builder')">Конструктор и Live Preview</button>
      <button class="tab-btn" onclick="switchTab('fleet')">Флот устройств</button>
      <button class="tab-btn" onclick="switchTab('gpo')">GPO & Реестр Windows</button>
      <button class="tab-btn" onclick="switchTab('rotation')">Ротация паролей 3x-ui</button>
      <button class="tab-btn" onclick="switchTab('deploy')">Сценарии установки & Docker</button>
      <button class="tab-btn" onclick="switchTab('logs')">Аудит и Тестер API</button>
    </div>

    <!-- ==================== TAB 1: ROUTING & GEOBASES ==================== -->
    <div id="tab-routing" class="tab-pane active">
      <div class="card">
        <h2>
          <span>Routing Profiles & Geo-Rules Matrix</span>
          <div style="display: flex; gap: 8px;">
            <select id="profileSelect" onchange="loadSelectedProfile()" style="margin-bottom: 0; font-size: 13px; width: auto;">
              <option value="">Loading profiles...</option>
            </select>
            <button onclick="createNewProfile()" class="btn-secondary" style="font-size: 12px;">+ New Profile</button>
          </div>
        </h2>

        <!-- Profile Metadata & Default Policy -->
        <div style="background: var(--card-inner); padding: 16px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 16px;">
          <div style="display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 14px; margin-bottom: 12px;">
            <div>
              <label>Profile Name</label>
              <input type="text" id="profName" style="margin-bottom: 0;" />
            </div>
            <div>
              <label>Default Traffic Policy</label>
              <select id="profDefaultPolicy" style="margin-bottom: 0;">
                <option value="direct">DIRECT by Default (Selective Proxy)</option>
                <option value="proxy">PROXY by Default (Full Tunnel)</option>
              </select>
            </div>
            <div>
              <label>Deployment Target Scope</label>
              <select id="profTargetScope" style="margin-bottom: 0;">
                <option value="all">All Fleet (Global Default)</option>
                <option value="group">Target AD / Fleet Group</option>
                <option value="instances">Specific Selected Instances</option>
              </select>
            </div>
          </div>

          <div id="groupTargetRow" style="display: none; margin-bottom: 10px;">
            <label>Target Group Name</label>
            <input type="text" id="profTargetGroup" placeholder="e.g. SEC-Proxy-VPN-VIP or Dev-Team" style="margin-bottom: 0;" />
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
            <p style="font-size: 12px; color: var(--text-muted);" id="profDesc">
              Routing policy applied to matching browser instances.
            </p>
            <div style="display: flex; gap: 8px;">
              <button onclick="saveCurrentProfile()">Save Routing Profile</button>
              <button onclick="deleteCurrentProfile()" class="btn-danger" style="font-size: 12px;">Delete Profile</button>
              <a id="btnPacPreview" href="/proxy.pac" target="_blank" class="btn-secondary" style="font-size: 12px;">View PAC Script</a>
            </div>
          </div>
        </div>

        <!-- Quick Add GeoBase Presets -->
        <h3 style="font-size: 14px; font-weight: 600; margin-bottom: 10px; color: var(--text);">
          Quick Add GeoBase & Domain Bundles
        </h3>
        <div class="grid-3" id="presetsContainer">
          <!-- Dynamically populated -->
        </div>

        <!-- Custom Rule Adder -->
        <div style="background: var(--card-inner); padding: 14px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 16px;">
          <h4 style="font-size: 13px; font-weight: 600; margin-bottom: 10px;">Add Custom Domain / Subnet Rule</h4>
          <div style="display: grid; grid-template-columns: 2fr 3fr 1fr auto; gap: 10px; align-items: flex-end;">
            <div>
              <label>Rule Name</label>
              <input type="text" id="newRuleName" placeholder="My Custom Rule" style="margin-bottom: 0;" />
            </div>
            <div>
              <label>Pattern (comma separated domains or CIDRs)</label>
              <input type="text" id="newRulePattern" placeholder="*.example.com, target-domain.org, 10.50.0.0/16" style="margin-bottom: 0;" />
            </div>
            <div>
              <label>Action</label>
              <select id="newRuleAction" style="margin-bottom: 0;">
                <option value="proxy">PROXY</option>
                <option value="direct">DIRECT</option>
                <option value="block">BLOCK (Sinkhole)</option>
              </select>
            </div>
            <div>
              <button onclick="addCustomRule()" style="height: 38px;">+ Add Rule</button>
            </div>
          </div>
        </div>

        <!-- Active Rules Table -->
        <h3 style="font-size: 14px; font-weight: 600; margin-bottom: 10px; color: var(--text);">
          Active Profile Rules Hierarchy (Evaluated Top-to-Bottom)
        </h3>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Rule Name</th>
                <th>Pattern / Preset</th>
                <th>Action</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="rulesTableBody">
              <tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No rules defined for this profile.</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ==================== TAB 2: EXTENSION CONSTRUCTOR STUDIO ==================== -->
    <div id="tab-builder" class="tab-pane">
      <div style="display: grid; grid-template-columns: 1.25fr 1fr; gap: 16px; margin-bottom: 16px;">
        
        <!-- Left Column: Visual, Preset & Feature Customizer -->
        <div class="card" style="margin-bottom: 0;">
          <h2>
            <span>Extension Constructor & Customizer</span>
            <span class="badge badge-action-proxy" id="bldPresetBadge">Self-Service Pro</span>
          </h2>
          <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 14px;">
            Configure functional archetypes, visual styles, security leak guards, and user capabilities:
          </p>

          <!-- 1. Archetype Presets -->
          <div style="background: var(--card-inner); padding: 12px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 14px;">
            <label style="margin-bottom: 8px;">1. Functional Archetype Presets</label>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <button type="button" class="preset-chip active" id="chip-self-service" onclick="applyTemplatePreset('self-service-pro')">
                <span>👤</span>
                <span>Self-Service Pro</span>
              </button>
              <button type="button" class="preset-chip" id="chip-kiosk" onclick="applyTemplatePreset('kiosk-restricted')">
                <span>🔒</span>
                <span>Kiosk / Restricted</span>
              </button>
              <button type="button" class="preset-chip" id="chip-stealth" onclick="applyTemplatePreset('enterprise-invisible')">
                <span>👻</span>
                <span>Stealth Agent</span>
              </button>
            </div>
            <p id="presetDescText" style="font-size: 11px; color: var(--text-muted); margin-top: 6px;">
              Self-Service Pro: Interactive popup with connection details, routing overview, manual sync, and temporary user bypass.
            </p>
          </div>

          <!-- 2. Theme & Visual Style Presets -->
          <div style="background: var(--card-inner); padding: 12px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 14px;">
            <label style="margin-bottom: 8px;">2. Theme & Color Palettes</label>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <button type="button" class="preset-chip active" id="chip-style-cyber-blue" onclick="applyStylePreset('cyber-blue')">
                <span class="color-swatch" style="background: #0284c7;"></span>
                <span>Cyber Blue</span>
              </button>
              <button type="button" class="preset-chip" id="chip-style-dark-obsidian" onclick="applyStylePreset('dark-obsidian')">
                <span class="color-swatch" style="background: #a855f7;"></span>
                <span>Dark Obsidian</span>
              </button>
              <button type="button" class="preset-chip" id="chip-style-emerald-sentinel" onclick="applyStylePreset('emerald-sentinel')">
                <span class="color-swatch" style="background: #10b981;"></span>
                <span>Emerald Sentinel</span>
              </button>
              <button type="button" class="preset-chip" id="chip-style-sunset-amber" onclick="applyStylePreset('sunset-amber')">
                <span class="color-swatch" style="background: #f59e0b;"></span>
                <span>Sunset Amber</span>
              </button>
              <button type="button" class="preset-chip" id="chip-style-minimal-light" onclick="applyStylePreset('minimal-light')">
                <span class="color-swatch" style="background: #2563eb;"></span>
                <span>Minimal Light</span>
              </button>
            </div>
          </div>

          <!-- 3. Identity & Branding -->
          <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 10px;">
            <div>
              <label>Extension Name</label>
              <input type="text" id="bldName" oninput="onConfigChangeLive()" placeholder="Corp Proxy Auth & Sync" />
            </div>
            <div>
              <label>Short Name</label>
              <input type="text" id="bldShortName" oninput="onConfigChangeLive()" placeholder="CorpProxy" />
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
            <div>
              <label>Version</label>
              <input type="text" id="bldVersion" oninput="onConfigChangeLive()" placeholder="1.2.0" />
            </div>
            <div>
              <label>UI Mode</label>
              <select id="bldUiMode" onchange="onConfigChangeLive()">
                <option value="popup">Interactive Popup UI</option>
                <option value="stealth">Silent / Stealth Enterprise Worker</option>
              </select>
            </div>
            <div>
              <label>Vector Icon Type</label>
              <select id="bldIconType" onchange="onConfigChangeLive()">
                <option value="shield">🛡️ Shield Security</option>
                <option value="lock">🔒 Lock Encrypted</option>
                <option value="globe">🌐 Global Network</option>
                <option value="bolt">⚡ Lightning Bolt</option>
                <option value="server">🖥️ Gateway Server</option>
                <option value="key">🔑 Auth Token Key</option>
              </select>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
            <div>
              <label>Brand Theme Color</label>
              <input type="text" id="bldThemeColor" oninput="onConfigChangeLive()" placeholder="#0284c7" />
            </div>
            <div>
              <label>Icon Emoji</label>
              <input type="text" id="bldEmoji" oninput="onConfigChangeLive()" placeholder="🛡️" />
            </div>
            <div>
              <label>Sync Interval</label>
              <select id="bldSyncInterval" onchange="onConfigChangeLive()">
                <option value="5">Every 5 minutes</option>
                <option value="15" selected>Every 15 minutes</option>
                <option value="30">Every 30 minutes</option>
                <option value="60">Every 1 hour</option>
              </select>
            </div>
          </div>

          <label>Enterprise Description</label>
          <input type="text" id="bldDesc" oninput="onConfigChangeLive()" placeholder="Enterprise Chrome extension for automatic proxy synchronization" />

          <!-- 4. Security & User Feature Policies -->
          <div style="background: var(--card-inner); padding: 12px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 14px;">
            <label style="margin-bottom: 8px;">Security & Leak Prevention Policies</label>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px;">
              <label style="display: flex; align-items: center; gap: 8px; text-transform: none; color: var(--text); font-weight: normal; cursor: pointer;">
                <input type="checkbox" id="bldWebRtc" checked onchange="onConfigChangeLive()" style="width: auto; margin-bottom: 0;" />
                <span>WebRTC IP Shield (no UDP leak)</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; text-transform: none; color: var(--text); font-weight: normal; cursor: pointer;">
                <input type="checkbox" id="bldDnsGuard" checked onchange="onConfigChangeLive()" style="width: auto; margin-bottom: 0;" />
                <span>DNS Leak Guard</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; text-transform: none; color: var(--text); font-weight: normal; cursor: pointer;">
                <input type="checkbox" id="bldBadge" checked onchange="onConfigChangeLive()" style="width: auto; margin-bottom: 0;" />
                <span>Live Status Badge on Icon</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; text-transform: none; color: var(--text); font-weight: normal; cursor: pointer;">
                <input type="checkbox" id="bldAutoProxy" checked onchange="onConfigChangeLive()" style="width: auto; margin-bottom: 0;" />
                <span>Dynamic Proxy Enforcement</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; text-transform: none; color: var(--text); font-weight: normal; cursor: pointer;">
                <input type="checkbox" id="bldAllowBypass" checked onchange="onConfigChangeLive()" style="width: auto; margin-bottom: 0;" />
                <span>Allow Temporary User Bypass</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; text-transform: none; color: var(--text); font-weight: normal; cursor: pointer;">
                <input type="checkbox" id="bldIpGeo" checked onchange="onConfigChangeLive()" style="width: auto; margin-bottom: 0;" />
                <span>Show Egress IP / Geo Verifier</span>
              </label>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 10px; margin-top: 10px;">
              <div>
                <label style="font-size: 11px;">Bypass Auto-Timeout</label>
                <select id="bldBypassTimeout" onchange="onConfigChangeLive()" style="margin-bottom: 0; font-size: 12px;">
                  <option value="10">10 minutes</option>
                  <option value="15" selected>15 minutes</option>
                  <option value="30">30 minutes</option>
                  <option value="60">60 minutes</option>
                </select>
              </div>
              <div>
                <label style="font-size: 11px;">IT Helpdesk Contact</label>
                <input type="text" id="bldSupportUrl" oninput="onConfigChangeLive()" placeholder="mailto:it-support@corp.local" style="margin-bottom: 0; font-size: 12px;" />
              </div>
            </div>
          </div>

          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            <button onclick="buildAndPackExtension()" class="btn-success">Compile, Sign & Pack CRX</button>
            <button onclick="saveBuilderConfigOnly(true)" class="btn-secondary">Save Config Only</button>
            <button onclick="regenerateTemplatesFromConfig()" class="btn-secondary" style="margin-left: auto;">Reset to Clean Template</button>
          </div>
        </div>

        <!-- Right Column: Live Interactive Chrome Extension Preview Sandbox -->
        <div class="card" style="margin-bottom: 0; display: flex; flex-direction: column;">
          <h2>
            <span>Live Extension Interactive Preview</span>
            <span class="badge badge-online" id="previewSyncStatus">Synced</span>
          </h2>
          <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 12px;">
            Full runtime sandbox mirroring real Chrome popup, icons, badge states, and events in real time:
          </p>

          <!-- Browser Mockup Frame -->
          <div class="browser-mock">
            <div class="browser-top">
              <div class="browser-dots">
                <span class="browser-dot dot-red"></span>
                <span class="browser-dot dot-yellow"></span>
                <span class="browser-dot dot-green"></span>
              </div>
              <div class="browser-address-bar">
                <span>🔒</span>
                <span>https://company-intranet.corp/internal-app</span>
              </div>
              <!-- Chrome extension icon with live badge -->
              <div class="browser-ext-icon" id="browserExtIcon" onclick="togglePopupPreviewVisibility()" title="Click to inspect extension popup">
                <span id="browserIconGlyph">🛡️</span>
                <span class="browser-ext-badge" id="browserBadge">PRX</span>
              </div>
            </div>

            <!-- Preview Canvas -->
            <div class="preview-canvas">
              <!-- Popup Window Box -->
              <div class="popup-frame-box" id="popupFrameBox">
                <iframe id="previewFrame" style="width: 100%; height: 100%; border: none;"></iframe>
              </div>

              <!-- Stealth Mode Fallback Card -->
              <div id="stealthNotice" style="display: none; background: #0f172a; border: 1px solid var(--border); border-radius: 8px; padding: 24px; text-align: center; max-width: 320px;">
                <div style="font-size: 38px; margin-bottom: 10px;">👻</div>
                <h4 style="font-size: 15px; margin-bottom: 6px;">Stealth Mode Enabled</h4>
                <p style="font-size: 12px; color: var(--text-muted); line-height: 1.5;">
                  The extension runs silently as an enterprise background service worker without a popup window. Traffic is routed dynamically via PAC policy.
                </p>
                <div style="margin-top: 14px;">
                  <span class="badge badge-action-proxy">Icon Badge: Active</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Interactive Simulator Controls -->
          <div style="background: var(--card-inner); padding: 10px; border-radius: 8px; border: 1px solid var(--border); margin-top: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span style="font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">Simulated Extension State</span>
              <span id="simStateLabel" style="font-size: 11px; color: var(--success); font-weight: 600;">State: Online / Routing Active</span>
            </div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              <button type="button" class="btn-secondary" onclick="simulateState('active')" style="font-size: 11px; padding: 4px 8px;">Online Proxy</button>
              <button type="button" class="btn-secondary" onclick="simulateState('bypass')" style="font-size: 11px; padding: 4px 8px;">Bypassed</button>
              <button type="button" class="btn-secondary" onclick="simulateState('offline')" style="font-size: 11px; padding: 4px 8px;">Offline Fallback</button>
              <button type="button" class="btn-secondary" onclick="simulateState('error407')" style="font-size: 11px; padding: 4px 8px;">Re-Authenticating</button>
            </div>
          </div>

        </div>
      </div>

      <!-- Bottom Full-Width Section: Source Code Internals Editor -->
      <div class="card">
        <h2>
          <span>Extension Source Code Internals</span>
          <div style="display: flex; gap: 10px; align-items: center;">
            <span style="font-size: 12px; color: var(--text-muted);">Active File:</span>
            <select id="codeFileSelect" onchange="loadFileContent()" style="margin-bottom: 0; font-size: 12px; width: auto;">
              <option value="popup.html">popup.html (Popup Markup & CSS)</option>
              <option value="popup.js">popup.js (Popup Script & Events)</option>
              <option value="manifest.json">manifest.json (Permissions & Actions)</option>
              <option value="background.js">background.js (Proxy Service Worker)</option>
              <option value="icon.svg">icon.svg (Vector Icon)</option>
              <option value="managed_schema.json">managed_schema.json (GPO Policy Schema)</option>
            </select>
          </div>
        </h2>
        <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 10px;">
          Live Code Editor: Edits in <code>popup.html</code> or <code>popup.js</code> update the Interactive Preview instantly.
        </p>

        <textarea id="codeEditor" oninput="onCodeEditorLiveChange()" style="width: 100%; height: 320px; font-family: var(--mono); font-size: 12px; margin-bottom: 10px; white-space: pre; line-height: 1.4;"></textarea>

        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
          <span id="codeStatus" style="font-size: 12px; color: var(--text-muted);">Ready</span>
          <div style="display: flex; gap: 8px;">
            <button onclick="saveCurrentCodeFile()" class="btn-secondary" style="font-size: 12px;">Save File Edits & Apply</button>
            <a href="/updates/extension.crx" class="btn" style="font-size: 12px;">Download .CRX</a>
            <a href="/api/extension/download-zip" class="btn-secondary" style="font-size: 12px;">Download .ZIP</a>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== TAB 3: FLEET & TARGET ASSIGNMENT ==================== -->
    <div id="tab-fleet" class="tab-pane">
      <div class="card">
        <h2>
          <span>Connected Extension Instances</span>
          <span id="badgeFleetOnline" class="badge badge-online">0 online</span>
        </h2>
        <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 14px;">
          Assign specific profiles or groups to instances, or monitor live sync activity:
        </p>

        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Instance ID</th>
                <th>IP Address</th>
                <th>Version</th>
                <th>Fleet Group</th>
                <th>Assigned Profile</th>
                <th>Syncs</th>
                <th>Status</th>
                <th>Assign</th>
              </tr>
            </thead>
            <tbody id="fleetTableBody">
              <tr><td colspan="8" style="text-align: center; color: var(--text-muted);">No active instances connected yet.</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ==================== TAB 4: GPO DEPLOYMENT ==================== -->
    <div id="tab-gpo" class="tab-pane">
      <div class="grid-2">
        <div class="card">
          <h2>Extension Identifiers & Package Info</h2>
          <div class="stat-row">
            <span class="stat-label">Calculated Extension ID</span>
            <span class="stat-value" id="dispExtId" style="color: var(--primary);">Loading...</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Manifest Version</span>
            <span class="stat-value" id="dispExtVer">1.2.0</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">RSA Private Key</span>
            <span class="stat-value" style="color: var(--success);">2048-bit RSA (extension/key.pem)</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Auto-Update Manifest</span>
            <span class="stat-value"><a href="/updates/updates.xml" target="_blank" style="color: var(--primary);">/updates/updates.xml</a></span>
          </div>
          <div style="margin-top: 16px;">
            <a href="/updates/extension.crx" class="btn" style="font-size: 13px;">Download .CRX Package</a>
            <a href="/api/extension/download-zip" class="btn-secondary" style="font-size: 13px; margin-left: 8px;">Download .ZIP</a>
          </div>
        </div>

        <div class="card">
          <h2>Active Directory GPO Settings</h2>
          <label>1. ExtensionInstallForcelist Entry</label>
          <pre id="gpoForcelist">Loading...</pre>

          <label style="margin-top: 10px;">2. ExtensionSettings (JSON)</label>
          <pre id="gpoSettings" style="max-height: 140px;">Loading...</pre>

          <div style="margin-top: 10px;">
            <button onclick="downloadRegFile()" class="btn-secondary" style="font-size: 12px;">Download Windows .REG Policy File</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== TAB 5: 3X-UI ROTATION ==================== -->
    <div id="tab-rotation" class="tab-pane">
      <div class="grid-2">
        <div class="card">
          <h2>3x-ui API Credentials & Timing Scheduler</h2>
          <label>3x-ui Panel URL</label>
          <input type="text" id="rotPanelUrl" placeholder="https://3xui-host:2053/basepath" />

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div>
              <label>Admin Username</label>
              <input type="text" id="rotAdminUser" placeholder="admin" />
            </div>
            <div>
              <label>Admin Password</label>
              <input type="password" id="rotAdminPass" placeholder="••••••••" />
            </div>
          </div>

          <label>Target Inbound Remark</label>
          <input type="text" id="rotRemark" placeholder="squid-in" />

          <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 10px;">
            <div>
              <label>Rotation Interval</label>
              <select id="rotInterval">
                <option value="15">Every 15 minutes</option>
                <option value="60">Every 1 hour</option>
                <option value="360">Every 6 hours</option>
                <option value="720">Every 12 hours</option>
                <option value="1440" selected>Every 24 hours (Daily)</option>
              </select>
            </div>
            <div>
              <label>Scheduler</label>
              <select id="rotEnabled">
                <option value="true">Enabled (Auto)</option>
                <option value="false">Disabled</option>
              </select>
            </div>
          </div>

          <div style="display: flex; gap: 8px; margin-top: 10px;">
            <button onclick="saveRotationConfig()">Save Scheduler Settings</button>
            <button onclick="test3xui()" class="btn-secondary">Test 3x-ui Connection</button>
          </div>
          <div id="test3xuiResult" style="margin-top: 10px; font-size: 12px; font-family: var(--mono); color: var(--text-muted);"></div>
        </div>

        <div class="card">
          <h2>Rotation Status & History</h2>
          <div class="stat-row">
            <span class="stat-label">Scheduler Status</span>
            <span class="stat-value" id="rotStatusText">Idle</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Next Scheduled Run</span>
            <span class="stat-value" id="rotNextRun">-</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Last Rotated At</span>
            <span class="stat-value" id="rotLastRun">-</span>
          </div>

          <div style="margin-top: 16px;">
            <label>Recent Password Rotations</label>
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Source</th>
                    <th>User</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody id="rotHistoryTable">
                  <tr><td colspan="4" style="color: var(--text-muted); text-align: center;">No rotation events yet</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== TAB: DEPLOYMENT & DOCKER SCENARIOS ==================== -->
    <div id="tab-deploy" class="tab-pane">
      <div class="card">
        <h2>
          <span>Сценарии установки и развертывания сервера</span>
          <span class="badge badge-online">Production Ready</span>
        </h2>
        <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 16px;">
          Выберите подходящий вариант для вашей инфраструктуры: от изолированного контейнера Docker до корпоративной службы Linux systemd или проксирования через Nginx с SSL.
        </p>

        <!-- Scenario Switcher Buttons -->
        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 18px;">
          <button type="button" class="btn-secondary active" id="btnScenDocker" onclick="selectDeployScenario('docker')">🐳 Docker & Compose</button>
          <button type="button" class="btn-secondary" id="btnScenSystemd" onclick="selectDeployScenario('systemd')">🐧 Linux Systemd Service</button>
          <button type="button" class="btn-secondary" id="btnScenNginx" onclick="selectDeployScenario('nginx')">🛡️ Nginx + SSL (HTTPS)</button>
          <button type="button" class="btn-secondary" id="btnScenStandalone" onclick="selectDeployScenario('standalone')">⚡ Standalone / PM2</button>
          <button type="button" class="btn-secondary" id="btnScenGpo" onclick="selectDeployScenario('gpo')">🏢 Active Directory / GPO</button>
        </div>

        <!-- Scenario 1: Docker & Docker Compose -->
        <div id="scen-docker" class="deploy-scenario-pane">
          <div style="background: var(--card-inner); padding: 16px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 16px;">
            <h3 style="font-size: 15px; margin-bottom: 8px; color: var(--primary);">Вариант 1: Запуск через Docker и Docker Compose (Рекомендуемый)</h3>
            <p style="font-size: 13px; color: var(--text-muted); line-height: 1.5; margin-bottom: 12px;">
              Полностью изолированный multi-stage контейнер на базе Alpine Linux. Автоматически сохраняет ротируемые пароли, скомпилированные .CRX расширения и PAC-скрипты в постоянных томах (Docker Volumes).
            </p>
            <label>Быстрый запуск одной командой:</label>
            <pre style="background: #090d16; padding: 12px; border-radius: 6px; font-family: var(--mono); font-size: 12px; color: #38bdf8;">docker compose up -d --build</pre>
            
            <label style="margin-top: 12px;">Конфигурационный файл docker-compose.yml:</label>
            <pre style="max-height: 220px; overflow-y: auto; background: #090d16; padding: 12px; border-radius: 6px; font-family: var(--mono); font-size: 11px; line-height: 1.4;">services:
  pec-server:
    build: .
    image: pec-proxy-extension-corp:latest
    container_name: pec-proxy-server
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - HOST=0.0.0.0
      - EXT_SHARED_TOKEN=\${EXT_SHARED_TOKEN:-corp-proxy-secret-token-change-me}
    volumes:
      - pec_data:/app/data
      - pec_extension:/app/extension
      - pec_updates:/app/dist/updates
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  pec_data:
  pec_extension:
  pec_updates:</pre>

            <div style="display: flex; gap: 8px; margin-top: 14px;">
              <a href="/Dockerfile" download class="btn-secondary" style="font-size: 12px;">Скачать Dockerfile</a>
              <a href="/docker-compose.yml" download class="btn-secondary" style="font-size: 12px;">Скачать docker-compose.yml</a>
            </div>
          </div>
        </div>

        <!-- Scenario 2: Linux systemd Service -->
        <div id="scen-systemd" class="deploy-scenario-pane" style="display: none;">
          <div style="background: var(--card-inner); padding: 16px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 16px;">
            <h3 style="font-size: 15px; margin-bottom: 8px; color: var(--primary);">Вариант 2: Установка как системная служба Linux (systemd)</h3>
            <p style="font-size: 13px; color: var(--text-muted); line-height: 1.5; margin-bottom: 12px;">
              Идеально для выделенных виртуальных машин (Ubuntu 20.04/22.04/24.04, Debian 11/12, RHEL 8/9). Создает системного непривилегированного пользователя <code>pecuser</code>, настраивает автозапуск и журналирование через journald.
            </p>
            <label>Автоматическая установка через скрипт:</label>
            <pre style="background: #090d16; padding: 12px; border-radius: 6px; font-family: var(--mono); font-size: 12px; color: #38bdf8;">sudo bash deploy/install-systemd.sh</pre>

            <label style="margin-top: 12px;">Файл службы /etc/systemd/system/pec-server.service:</label>
            <pre style="max-height: 200px; overflow-y: auto; background: #090d16; padding: 12px; border-radius: 6px; font-family: var(--mono); font-size: 11px; line-height: 1.4;">[Unit]
Description=PEC - Proxy Extension Corp Enterprise Server
After=network.target

[Service]
Type=simple
User=pecuser
Group=pecuser
WorkingDirectory=/opt/pec-proxy-server
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOST=0.0.0.0
Environment=EXT_SHARED_TOKEN=corp-proxy-secret-token-change-me
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target</pre>

            <label style="margin-top: 12px;">Команды управления службой:</label>
            <pre style="background: #090d16; padding: 10px; border-radius: 6px; font-family: var(--mono); font-size: 11px;"># Проверка статуса
sudo systemctl status pec-server

# Просмотр логов в реальном времени
sudo journalctl -u pec-server -f

# Перезапуск службы
sudo systemctl restart pec-server</pre>
          </div>
        </div>

        <!-- Scenario 3: Nginx + SSL -->
        <div id="scen-nginx" class="deploy-scenario-pane" style="display: none;">
          <div style="background: var(--card-inner); padding: 16px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 16px;">
            <h3 style="font-size: 15px; margin-bottom: 8px; color: var(--primary);">Вариант 3: Реверс-прокси Nginx с SSL-сертификатом и защитой от перебора</h3>
            <p style="font-size: 13px; color: var(--text-muted); line-height: 1.5; margin-bottom: 12px;">
              Обеспечивает шифрование трафика по HTTPS (требуется для безопасной доставки учетных данных в расширения), кеширование PAC-файлов и ограничение запросов (Rate Limiting) к эндпоинтам авторизации.
            </p>
            <label>Конфигурация Nginx (/etc/nginx/sites-available/pec-proxy.conf):</label>
            <pre style="max-height: 220px; overflow-y: auto; background: #090d16; padding: 12px; border-radius: 6px; font-family: var(--mono); font-size: 11px; line-height: 1.4;"># Ограничение частоты запросов для защиты эндпоинта учетных данных
limit_req_zone $binary_remote_addr zone=pec_api_limit:10m rate=30r/m;

server {
    listen 80;
    server_name proxy.corp.local;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name proxy.corp.local;

    ssl_certificate /etc/letsencrypt/live/proxy.corp.local/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/proxy.corp.local/privkey.pem;

    # PAC-файл с автообновлением
    location /proxy.pac {
        proxy_pass http://127.0.0.1:3000;
        types { application/x-ns-proxy-autoconfig pac; }
        expires 60s;
    }

    # Защищенный обмен токенами
    location ~ ^/(creds|api/sync) {
        limit_req zone=pec_api_limit burst=10 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}</pre>
          </div>
        </div>

        <!-- Scenario 4: Standalone / PM2 -->
        <div id="scen-standalone" class="deploy-scenario-pane" style="display: none;">
          <div style="background: var(--card-inner); padding: 16px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 16px;">
            <h3 style="font-size: 15px; margin-bottom: 8px; color: var(--primary);">Вариант 4: Автономный запуск через Node.js и PM2</h3>
            <p style="font-size: 13px; color: var(--text-muted); line-height: 1.5; margin-bottom: 12px;">
              Быстрый запуск для тестирования, разработки или легких окружений без Docker.
            </p>
            <pre style="background: #090d16; padding: 12px; border-radius: 6px; font-family: var(--mono); font-size: 12px; color: #38bdf8;"># 1. Установка зависимостей и сборка
npm install
npm run build

# 2. Запуск через PM2 с автоматическим рестартом при сбоях
npm install -g pm2
pm2 start "npm start" --name "pec-proxy-server"
pm2 save
pm2 startup</pre>
          </div>
        </div>

        <!-- Scenario 5: Active Directory GPO -->
        <div id="scen-gpo" class="deploy-scenario-pane" style="display: none;">
          <div style="background: var(--card-inner); padding: 16px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 16px;">
            <h3 style="font-size: 15px; margin-bottom: 8px; color: var(--primary);">Вариант 5: Развертывание расширения через Active Directory GPO</h3>
            <p style="font-size: 13px; color: var(--text-muted); line-height: 1.5; margin-bottom: 12px;">
              Политика <code>ExtensionInstallForcelist</code> автоматически принудительно устанавливает скомпилированный .CRX на компьютеры пользователей домена Windows без возможности ручного удаления сотрудником.
            </p>
            <label>Ключ реестра Windows (HKLM\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist):</label>
            <pre id="scenGpoForcelistText" style="background: #090d16; padding: 10px; border-radius: 6px; font-family: var(--mono); font-size: 11px;">[Загрузка идентификатора...]</pre>
            <div style="margin-top: 12px;">
              <button onclick="downloadRegFile()" class="btn" style="font-size: 12px;">Скачать файл реестра (.REG)</button>
            </div>
          </div>
        </div>

      </div>
    </div>

    <!-- ==================== TAB 6: AUDIT & TESTER ==================== -->
    <div id="tab-logs" class="tab-pane">
      <div class="grid-2">
        <div class="card">
          <h2>Interactive /creds Tester</h2>
          <label>X-Ext-Token Header Value</label>
          <input type="text" id="testTokenInput" value="${EXT_SHARED_TOKEN}" />
          <div style="display: flex; gap: 8px; margin-bottom: 12px;">
            <button onclick="testCredsEndpoint()">Send GET /creds</button>
            <button class="btn-secondary" onclick="document.getElementById('testTokenInput').value = 'wrong-token'; testCredsEndpoint();">Test Invalid Token</button>
          </div>
          <pre id="testCredsOutput" style="min-height: 100px;">// Click to test /creds</pre>
        </div>

        <div class="card">
          <h2>Interactive /api/sync Tester</h2>
          <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 10px;">
            Simulate a Chrome extension heartbeat sync:
          </p>
          <button onclick="testSyncEndpoint()">Send POST /api/sync</button>
          <pre id="testSyncOutput" style="min-height: 100px; margin-top: 12px;">// Click to test sync</pre>
        </div>
      </div>

      <div class="card">
        <h2>Access & Security Audit Logs</h2>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>IP Address</th>
                <th>Endpoint</th>
                <th>Status</th>
                <th>Result</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody id="auditTableBody">
              <tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Loading logs...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

  </div>

  <script>
    window.addEventListener('unhandledrejection', function(event) {
      if (event.reason && (event.reason.name === 'TypeError' || String(event.reason).includes('fetch') || String(event.reason).includes('Failed to fetch'))) {
        console.warn('Network request error safely handled:', event.reason);
        event.preventDefault();
      }
    });

    let globalGpo = null;
    let globalKillSwitch = false;
    let allProfiles = [];
    let currentProfile = null;
    let extensionFiles = {};

    function switchTab(name) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      
      const pane = document.getElementById('tab-' + name);
      if (pane) pane.classList.add('active');
      
      const btn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.getAttribute('onclick').includes(name));
      if (btn) btn.classList.add('active');
    }

    // ----------------- Routing & Profiles -----------------
    async function loadPresets() {
      try {
        const res = await fetch('/api/routing/presets');
        const presets = await res.json();
        const container = document.getElementById('presetsContainer');
        
        container.innerHTML = presets.map(p => \`
          <div class="preset-card">
            <div>
              <h4>\${p.name}</h4>
              <p>\${p.description} (\${p.domains.length} patterns)</p>
            </div>
            <div style="display: flex; gap: 6px; margin-top: 6px;">
              <button onclick="addPresetRule('\${p.id}', '\${p.name}', 'proxy')" class="btn-secondary" style="font-size: 11px; padding: 4px 8px;">+ Proxy</button>
              <button onclick="addPresetRule('\${p.id}', '\${p.name}', 'direct')" class="btn-secondary" style="font-size: 11px; padding: 4px 8px;">+ Direct</button>
              <button onclick="addPresetRule('\${p.id}', '\${p.name}', 'block')" class="btn-danger" style="font-size: 11px; padding: 4px 8px;">+ Block</button>
            </div>
          </div>
        \`).join('');
      } catch (e) {
        console.error(e);
      }
    }

    async function loadProfiles() {
      try {
        const res = await fetch('/api/routing/profiles');
        allProfiles = await res.json();
        const sel = document.getElementById('profileSelect');
        
        sel.innerHTML = allProfiles.map(p => 
          \`<option value="\${p.id}">\${p.name} (\${p.defaultPolicy.toUpperCase()} default)\${p.isDefault ? ' [DEFAULT]' : ''}</option>\`
        ).join('');

        if (allProfiles.length > 0) {
          currentProfile = allProfiles[0];
          renderProfile(currentProfile);
          document.getElementById('hdrActiveProfile').textContent = currentProfile.name;
        }
      } catch (e) {
        console.error(e);
      }
    }

    function loadSelectedProfile() {
      const id = document.getElementById('profileSelect').value;
      const found = allProfiles.find(p => p.id === id);
      if (found) {
        currentProfile = found;
        renderProfile(currentProfile);
      }
    }

    function renderProfile(p) {
      document.getElementById('profName').value = p.name || '';
      document.getElementById('profDefaultPolicy').value = p.defaultPolicy || 'direct';
      document.getElementById('profTargetScope').value = p.targetScope || 'all';
      document.getElementById('profTargetGroup').value = p.targetGroup || '';
      document.getElementById('profDesc').textContent = p.description || 'Configured routing rules.';
      
      const groupRow = document.getElementById('groupTargetRow');
      groupRow.style.display = p.targetScope === 'group' ? 'block' : 'none';

      document.getElementById('btnPacPreview').href = '/proxy.pac?profileId=' + p.id;
      renderRules(p.rules || []);
    }

    document.getElementById('profTargetScope').addEventListener('change', (e) => {
      document.getElementById('groupTargetRow').style.display = e.target.value === 'group' ? 'block' : 'none';
    });

    function renderRules(rules) {
      const tbody = document.getElementById('rulesTableBody');
      if (!rules || !rules.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No rules defined for this profile. Use buttons above to add presets or custom rules.</td></tr>';
        return;
      }

      tbody.innerHTML = rules.map((r, idx) => {
        let badge = 'badge-action-proxy';
        if (r.action === 'direct') badge = 'badge-action-direct';
        else if (r.action === 'block') badge = 'badge-action-block';

        return \`<tr>
          <td>
            <input type="checkbox" \${r.enabled ? 'checked' : ''} onchange="toggleRuleEnabled(\${idx})" style="margin: 0;" />
          </td>
          <td><strong>\${r.name}</strong></td>
          <td><code>\${r.pattern}</code></td>
          <td><span class="badge \${badge}">\${r.action.toUpperCase()}</span></td>
          <td>
            <button onclick="removeRule(\${idx})" class="btn-danger" style="font-size: 11px; padding: 3px 8px;">Delete</button>
          </td>
        </tr>\`;
      }).join('');
    }

    function toggleRuleEnabled(idx) {
      if (currentProfile && currentProfile.rules[idx]) {
        currentProfile.rules[idx].enabled = !currentProfile.rules[idx].enabled;
        renderRules(currentProfile.rules);
      }
    }

    function removeRule(idx) {
      if (currentProfile && currentProfile.rules[idx]) {
        currentProfile.rules.splice(idx, 1);
        renderRules(currentProfile.rules);
      }
    }

    function addPresetRule(presetId, presetName, action) {
      if (!currentProfile) return;
      currentProfile.rules.push({
        id: 'r_' + Math.random().toString(36).substring(2, 8),
        name: presetName,
        targetType: 'preset',
        pattern: presetId,
        action: action,
        enabled: true
      });
      renderRules(currentProfile.rules);
    }

    function addCustomRule() {
      if (!currentProfile) return;
      const name = document.getElementById('newRuleName').value.trim();
      const pattern = document.getElementById('newRulePattern').value.trim();
      const action = document.getElementById('newRuleAction').value;

      if (!name || !pattern) {
        alert('Please specify rule name and pattern');
        return;
      }

      currentProfile.rules.push({
        id: 'r_' + Math.random().toString(36).substring(2, 8),
        name: name,
        targetType: pattern.includes('/') ? 'cidr' : 'wildcard',
        pattern: pattern,
        action: action,
        enabled: true
      });

      document.getElementById('newRuleName').value = '';
      document.getElementById('newRulePattern').value = '';
      renderRules(currentProfile.rules);
    }

    async function saveCurrentProfile() {
      if (!currentProfile) return;
      currentProfile.name = document.getElementById('profName').value.trim();
      currentProfile.defaultPolicy = document.getElementById('profDefaultPolicy').value;
      currentProfile.targetScope = document.getElementById('profTargetScope').value;
      currentProfile.targetGroup = document.getElementById('profTargetGroup').value.trim();

      try {
        const res = await fetch('/api/routing/profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(currentProfile)
        });
        if (res.ok) {
          alert('Routing profile saved! Deployed to matching fleet instances.');
          loadProfiles();
        }
      } catch (e) {
        alert('Error saving profile: ' + e);
      }
    }

    function createNewProfile() {
      const name = prompt('Enter name for the new Routing Profile:', 'New Department Profile');
      if (!name) return;
      const newP = {
        id: 'prof_' + Math.random().toString(36).substring(2, 8),
        name: name,
        description: 'Custom routing profile',
        defaultPolicy: 'direct',
        targetScope: 'all',
        rules: []
      };
      allProfiles.push(newP);
      currentProfile = newP;
      
      const sel = document.getElementById('profileSelect');
      const opt = document.createElement('option');
      opt.value = newP.id;
      opt.textContent = newP.name;
      opt.selected = true;
      sel.appendChild(opt);

      renderProfile(newP);
    }

    async function deleteCurrentProfile() {
      if (!currentProfile) return;
      if (!confirm('Are you sure you want to delete profile "' + currentProfile.name + '"?')) return;
      try {
        const res = await fetch('/api/routing/profiles/' + currentProfile.id, { method: 'DELETE' });
        const data = await res.json();
        if (data.ok) {
          alert('Profile deleted');
          loadProfiles();
        } else {
          alert('Delete error: ' + (data.error || 'Failed'));
        }
      } catch (e) {
        alert('Error: ' + e);
      }
    }

    // ----------------- Extension Constructor Studio & Live Sandbox -----------------
    let liveSimState = {
      online: true,
      bypassActive: false,
      protocol: 'socks5',
      host: 'xray-gateway.corp.local',
      port: 10808,
      profileName: 'Corporate AI + Intranet Policy',
      appliedProfileId: 'prof_default',
      exitIp: '198.51.100.42',
      ipLocation: 'Frankfurt, DE (Corp Direct Egress)',
      lastSyncTime: new Date().toLocaleTimeString(),
      status: 'Active'
    };

    let builderDebounceTimer = null;
    let codeEditorDebounceTimer = null;
    let activeTemplatePreset = 'self-service-pro';
    let activeStylePreset = 'cyber-blue';

    async function loadBuilderConfig() {
      try {
        const res = await fetch('/api/builder/config');
        const cfg = await res.json();
        
        document.getElementById('bldName').value = cfg.name || 'Corp Proxy Auth & Sync';
        document.getElementById('bldShortName').value = cfg.shortName || 'CorpProxy';
        document.getElementById('bldVersion').value = cfg.version || '1.2.0';
        document.getElementById('bldUiMode').value = cfg.uiMode || 'popup';
        document.getElementById('bldIconType').value = cfg.iconType || 'shield';
        document.getElementById('bldThemeColor').value = cfg.themeColor || '#0284c7';
        document.getElementById('bldEmoji').value = cfg.iconEmoji || '🛡️';
        document.getElementById('bldDesc').value = cfg.description || 'Enterprise Chrome extension for automatic proxy synchronization';
        document.getElementById('bldSyncInterval').value = cfg.syncIntervalMinutes || 15;
        document.getElementById('bldWebRtc').checked = cfg.webRtcProtection !== false;
        document.getElementById('bldDnsGuard').checked = cfg.dnsLeakProtection !== false;
        document.getElementById('bldBadge').checked = cfg.badgeIndicator !== false;
        document.getElementById('bldAutoProxy').checked = cfg.autoConfigureProxy !== false;
        document.getElementById('bldAllowBypass').checked = cfg.allowUserBypass !== false;
        document.getElementById('bldIpGeo').checked = cfg.showIpGeoCheck !== false;
        document.getElementById('bldBypassTimeout').value = cfg.bypassTimeoutMinutes || 15;
        document.getElementById('bldSupportUrl').value = cfg.supportUrl || 'mailto:it-support@corp.local';

        if (cfg.presetTemplate) {
          highlightTemplateChip(cfg.presetTemplate);
        }
        if (cfg.presetStyle) {
          highlightStyleChip(cfg.presetStyle);
        }

        updateLivePreview();
      } catch (e) {
        console.error(e);
      }
    }

    function highlightTemplateChip(preset) {
      activeTemplatePreset = preset;
      ['chip-self-service', 'chip-kiosk', 'chip-stealth'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
      });
      const badge = document.getElementById('bldPresetBadge');
      const desc = document.getElementById('presetDescText');

      if (preset === 'self-service-pro') {
        const el = document.getElementById('chip-self-service');
        if (el) el.classList.add('active');
        if (badge) badge.textContent = 'Self-Service Pro';
        if (desc) desc.textContent = 'Self-Service Pro: Interactive popup with full connection metrics, routing inspection, manual force sync, and user temporary bypass.';
      } else if (preset === 'kiosk-restricted') {
        const el = document.getElementById('chip-kiosk');
        if (el) el.classList.add('active');
        if (badge) badge.textContent = 'Kiosk / Restricted';
        if (desc) desc.textContent = 'Kiosk / Restricted: Read-only popup view without bypass controls or sensitive host exposure. Locked for managed kiosks and students.';
      } else if (preset === 'enterprise-invisible') {
        const el = document.getElementById('chip-stealth');
        if (el) el.classList.add('active');
        if (badge) badge.textContent = 'Stealth Agent';
        if (desc) desc.textContent = 'Stealth Agent: Runs silently in the background without any popup UI, enforcing corporate PAC policies quietly.';
      }
    }

    function highlightStyleChip(style) {
      activeStylePreset = style;
      ['chip-style-cyber-blue', 'chip-style-dark-obsidian', 'chip-style-emerald-sentinel', 'chip-style-sunset-amber', 'chip-style-minimal-light'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
      });
      const target = document.getElementById('chip-style-' + style);
      if (target) target.classList.add('active');
    }

    async function applyTemplatePreset(preset) {
      highlightTemplateChip(preset);

      if (preset === 'self-service-pro') {
        document.getElementById('bldUiMode').value = 'popup';
        document.getElementById('bldAllowBypass').checked = true;
        document.getElementById('bldIpGeo').checked = true;
        document.getElementById('bldBadge').checked = true;
      } else if (preset === 'kiosk-restricted') {
        document.getElementById('bldUiMode').value = 'popup';
        document.getElementById('bldAllowBypass').checked = false;
        document.getElementById('bldIpGeo').checked = false;
        document.getElementById('bldBadge').checked = true;
      } else if (preset === 'enterprise-invisible') {
        document.getElementById('bldUiMode').value = 'stealth';
        document.getElementById('bldAllowBypass').checked = false;
        document.getElementById('bldBadge').checked = true;
      }

      await saveBuilderConfigOnly(false);
      await regenerateTemplatesFromConfig();
    }

    async function applyStylePreset(style) {
      highlightStyleChip(style);
      const colorMap = {
        'cyber-blue': '#0284c7',
        'dark-obsidian': '#a855f7',
        'emerald-sentinel': '#10b981',
        'sunset-amber': '#f59e0b',
        'minimal-light': '#2563eb'
      };
      if (colorMap[style]) {
        document.getElementById('bldThemeColor').value = colorMap[style];
      }
      await saveBuilderConfigOnly(false);
      await regenerateTemplatesFromConfig();
    }

    function onConfigChangeLive() {
      clearTimeout(builderDebounceTimer);
      builderDebounceTimer = setTimeout(async () => {
        await saveBuilderConfigOnly(false);
        await regenerateTemplatesFromConfig();
      }, 500);
    }

    async function regenerateTemplatesFromConfig() {
      try {
        const res = await fetch('/api/builder/regenerate', { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
          await loadExtensionFiles();
          updateLivePreview();
        }
      } catch (e) {
        console.error('Regenerate error:', e);
      }
    }

    function onCodeEditorLiveChange() {
      const fileName = document.getElementById('codeFileSelect').value;
      const content = document.getElementById('codeEditor').value;
      extensionFiles[fileName] = content;
      
      clearTimeout(codeEditorDebounceTimer);
      codeEditorDebounceTimer = setTimeout(() => {
        updateLivePreview();
      }, 250);
    }

    function pushSimStateToIframe() {
      const iframe = document.getElementById('previewFrame');
      if (iframe && iframe.contentWindow) {
        try {
          iframe.contentWindow.postMessage({ type: 'UPDATE_SIM_STATE', state: liveSimState }, '*');
        } catch (e) {}
      }
    }

    function simulateState(stateType) {
      const label = document.getElementById('simStateLabel');
      if (stateType === 'active') {
        liveSimState.online = true;
        liveSimState.bypassActive = false;
        liveSimState.status = 'Active';
        if (label) {
          label.textContent = 'Состояние: Активен / Прокси работает';
          label.style.color = 'var(--success)';
        }
      } else if (stateType === 'bypass') {
        liveSimState.online = true;
        liveSimState.bypassActive = true;
        liveSimState.status = 'Bypassed';
        if (label) {
          label.textContent = 'Состояние: Временный прямой обход';
          label.style.color = 'var(--warning)';
        }
      } else if (stateType === 'offline') {
        liveSimState.online = false;
        liveSimState.bypassActive = false;
        liveSimState.status = 'Direct Fallback';
        if (label) {
          label.textContent = 'Состояние: Офлайн / Прямой трафик';
          label.style.color = 'var(--danger)';
        }
      } else if (stateType === 'error407') {
        liveSimState.online = true;
        liveSimState.bypassActive = false;
        liveSimState.status = 'Syncing...';
        if (label) {
          label.textContent = 'Состояние: Переаутентификация / Синхронизация';
          label.style.color = 'var(--primary)';
        }
      }

      const badgeEl = document.getElementById('browserBadge');
      if (badgeEl) {
        if (liveSimState.bypassActive) {
          badgeEl.textContent = 'BYP';
          badgeEl.style.background = '#f59e0b';
          badgeEl.style.color = '#000';
        } else if (!liveSimState.online) {
          badgeEl.textContent = 'OFF';
          badgeEl.style.background = '#ef4444';
          badgeEl.style.color = '#fff';
        } else {
          badgeEl.textContent = 'PRX';
          badgeEl.style.background = '#10b981';
          badgeEl.style.color = '#000';
        }
      }

      pushSimStateToIframe();
    }

    function toggleSimBypass() {
      liveSimState.bypassActive = !liveSimState.bypassActive;
      liveSimState.status = liveSimState.bypassActive ? 'Bypassed' : 'Active';
      const label = document.getElementById('simStateLabel');
      if (label) {
        if (liveSimState.bypassActive) {
          label.textContent = 'Состояние: Временный прямой обход';
          label.style.color = 'var(--warning)';
        } else {
          label.textContent = 'Состояние: Активен / Прокси работает';
          label.style.color = 'var(--success)';
        }
      }
      const badgeEl = document.getElementById('browserBadge');
      if (badgeEl) {
        if (liveSimState.bypassActive) {
          badgeEl.textContent = 'BYP';
          badgeEl.style.background = '#f59e0b';
          badgeEl.style.color = '#000';
        } else if (!liveSimState.online) {
          badgeEl.textContent = 'OFF';
          badgeEl.style.background = '#ef4444';
          badgeEl.style.color = '#fff';
        } else {
          badgeEl.textContent = 'PRX';
          badgeEl.style.background = '#10b981';
          badgeEl.style.color = '#000';
        }
      }
      pushSimStateToIframe();
    }

    function togglePopupPreviewVisibility() {
      const popupBox = document.getElementById('popupFrameBox');
      if (popupBox.style.display === 'none') {
        popupBox.style.display = 'block';
      } else {
        popupBox.style.display = 'none';
      }
    }

    function updateLivePreview() {
      const uiMode = document.getElementById('bldUiMode').value;
      const previewBox = document.getElementById('popupFrameBox');
      const stealthNotice = document.getElementById('stealthNotice');
      const badgeEl = document.getElementById('browserBadge');
      const iconGlyphEl = document.getElementById('browserIconGlyph');
      const themeColor = document.getElementById('bldThemeColor').value || '#0284c7';
      const iconEmoji = document.getElementById('bldEmoji').value || '🛡️';

      if (iconGlyphEl) iconGlyphEl.textContent = iconEmoji;

      if (badgeEl) {
        if (liveSimState.bypassActive) {
          badgeEl.textContent = 'BYP';
          badgeEl.style.background = '#f59e0b';
          badgeEl.style.color = '#000';
        } else if (!liveSimState.online) {
          badgeEl.textContent = 'OFF';
          badgeEl.style.background = '#ef4444';
          badgeEl.style.color = '#fff';
        } else {
          badgeEl.textContent = 'PRX';
          badgeEl.style.background = '#10b981';
          badgeEl.style.color = '#000';
        }
      }

      if (uiMode === 'stealth') {
        if (previewBox) previewBox.style.display = 'none';
        if (stealthNotice) stealthNotice.style.display = 'block';
        return;
      } else {
        if (previewBox) previewBox.style.display = 'block';
        if (stealthNotice) stealthNotice.style.display = 'none';
      }

      let htmlContent = extensionFiles['popup.html'] || '<div style="color:#fff;padding:20px;">No popup.html generated</div>';
      let jsContent = extensionFiles['popup.js'] || '';

      const currentFileName = document.getElementById('codeFileSelect').value;
      if (currentFileName === 'popup.html') {
        htmlContent = document.getElementById('codeEditor').value;
      } else if (currentFileName === 'popup.js') {
        jsContent = document.getElementById('codeEditor').value;
      }

      const scriptOpen = '<' + 'script>';
      const scriptClose = '<' + '/script>';

      const mockScript = scriptOpen +
        'window.__simState = ' + JSON.stringify(liveSimState) + ';' +
        'window.switchPopupTab = function(tabId) {' +
          'if (!tabId) return;' +
          'var tabs = document.querySelectorAll(".tab-btn");' +
          'for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove("active");' +
          'var contents = document.querySelectorAll(".tab-content");' +
          'for (var j = 0; j < contents.length; j++) contents[j].classList.remove("active");' +
          'var btn = document.querySelector(\'.tab-btn[data-tab="\' + tabId + \'"]\');' +
          'if (btn) btn.classList.add("active");' +
          'var tgt = document.getElementById(tabId);' +
          'if (tgt) tgt.classList.add("active");' +
        '};' +
        'window.chrome = {' +
          'runtime: {' +
            'lastError: null,' +
            'sendMessage: function(msg, cb) {' +
              'if (!msg) return;' +
              'if (msg.action === "GET_STATUS") {' +
                'if (cb) cb(window.__simState || ' + JSON.stringify(liveSimState) + ');' +
              '} else if (msg.action === "FORCE_SYNC") {' +
                'setTimeout(function() {' +
                  'if (cb) cb({ ok: true, syncedAt: new Date().toLocaleTimeString() });' +
                '}, 400);' +
              '} else if (msg.action === "TOGGLE_BYPASS") {' +
                'window.parent.postMessage({ type: "SIM_TOGGLE_BYPASS" }, "*");' +
                'if (cb) cb({ ok: true });' +
              '}' +
            '}' +
          '}' +
        '};' +
        'window.addEventListener("message", function(e) {' +
          'if (e.data && e.data.type === "UPDATE_SIM_STATE") {' +
            'window.__simState = e.data.state;' +
            'if (typeof window.applyPopupState === "function") {' +
              'window.applyPopupState(e.data.state);' +
            '} else {' +
              'var st = document.getElementById("statusText");' +
              'var bg = document.getElementById("badge");' +
              'var btn = document.getElementById("btnToggleBypass");' +
              'if (st) st.textContent = e.data.state.bypassActive ? "Обход" : (e.data.state.online ? "Активен" : "Отключен");' +
              'if (bg) bg.className = e.data.state.bypassActive ? "status-badge bypass" : (e.data.state.online ? "status-badge" : "status-badge offline");' +
              'if (btn) btn.textContent = e.data.state.bypassActive ? "Включить прокси" : "Временно отключить";' +
            '}' +
          '}' +
        '});' +
        'document.addEventListener("click", function(ev) {' +
          'var tab = ev.target.closest(".tab-btn");' +
          'if (tab && tab.dataset && tab.dataset.tab) {' +
            'ev.preventDefault();' +
            'window.switchPopupTab(tab.dataset.tab);' +
          '}' +
        '});' +
        'window.addEventListener("unhandledrejection", function(e) { e.preventDefault(); });' +
        'var _origFetch = window.fetch;' +
        'window.fetch = function(url, opts) {' +
          'if (typeof url === "string" && url.includes("/api/ip-echo")) {' +
            'return Promise.resolve(new Response(JSON.stringify({' +
              'ip: (window.__simState && window.__simState.exitIp) || "198.51.100.42",' +
              'country: (window.__simState && window.__simState.ipLocation) || "Frankfurt, DE",' +
              'city: "Direct Egress",' +
              'protocol: "HTTPS"' +
            '}), { status: 200, headers: { "Content-Type": "application/json" } }));' +
          '}' +
          'return _origFetch ? _origFetch(url, opts).catch(function() { return new Response("{}", { status: 200 }); }) : Promise.resolve(new Response("{}", { status: 200 }));' +
        '};' +
        scriptClose;

      let doc = htmlContent;
      const popupScriptRegex = new RegExp('<' + 'script\\s+src="popup\\.js">' + '<' + '/script>', 'i');
      if (doc.includes('popup.js')) {
        doc = doc.replace(popupScriptRegex, mockScript + scriptOpen + jsContent + scriptClose);
      } else {
        doc = mockScript + doc + scriptOpen + jsContent + scriptClose;
      }

      const iframe = document.getElementById('previewFrame');
      if (iframe) {
        iframe.onload = function() {
          pushSimStateToIframe();
        };
        iframe.srcdoc = doc;
      }
    }

    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'SIM_TOGGLE_BYPASS') {
        toggleSimBypass();
      }
    });

    async function loadExtensionFiles() {
      try {
        const res = await fetch('/api/builder/files');
        extensionFiles = await res.json();
        loadFileContent();
        updateLivePreview();
      } catch (e) {
        console.error(e);
      }
    }

    function loadFileContent() {
      const fileName = document.getElementById('codeFileSelect').value;
      const editor = document.getElementById('codeEditor');
      editor.value = extensionFiles[fileName] || '// File not found or empty';
      document.getElementById('codeStatus').textContent = 'Viewing ' + fileName;
      updateLivePreview();
    }

    async function saveCurrentCodeFile() {
      const fileName = document.getElementById('codeFileSelect').value;
      const content = document.getElementById('codeEditor').value;
      try {
        const res = await fetch('/api/builder/file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName, content })
        });
        if (res.ok) {
          extensionFiles[fileName] = content;
          document.getElementById('codeStatus').textContent = 'Saved ' + fileName + ' at ' + new Date().toLocaleTimeString();
          updateLivePreview();
        }
      } catch (e) {
        alert('Error saving file: ' + e);
      }
    }

    async function saveBuilderConfigOnly(showAlert = true) {
      const payload = {
        name: document.getElementById('bldName').value.trim(),
        shortName: document.getElementById('bldShortName').value.trim(),
        version: document.getElementById('bldVersion').value.trim(),
        uiMode: document.getElementById('bldUiMode').value,
        iconType: document.getElementById('bldIconType').value,
        themeColor: document.getElementById('bldThemeColor').value.trim(),
        iconEmoji: document.getElementById('bldEmoji').value.trim(),
        description: document.getElementById('bldDesc').value.trim(),
        syncIntervalMinutes: parseInt(document.getElementById('bldSyncInterval').value, 10) || 15,
        webRtcProtection: document.getElementById('bldWebRtc').checked,
        dnsLeakProtection: document.getElementById('bldDnsGuard').checked,
        badgeIndicator: document.getElementById('bldBadge').checked,
        autoConfigureProxy: document.getElementById('bldAutoProxy').checked,
        allowUserBypass: document.getElementById('bldAllowBypass').checked,
        showIpGeoCheck: document.getElementById('bldIpGeo').checked,
        bypassTimeoutMinutes: parseInt(document.getElementById('bldBypassTimeout').value, 10) || 15,
        supportUrl: document.getElementById('bldSupportUrl').value.trim(),
        presetTemplate: activeTemplatePreset,
        presetStyle: activeStylePreset,
      };

      try {
        const res = await fetch('/api/builder/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          if (showAlert) alert('Constructor configuration saved and extension files re-rendered!');
        }
      } catch (e) {
        if (showAlert) alert('Error saving config: ' + e);
      }
    }

    async function buildAndPackExtension() {
      await saveBuilderConfigOnly(false);
      try {
        const res = await fetch('/api/builder/build', { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
          alert('Extension package built successfully! .CRX signed, .ZIP created, and updates.xml regenerated.');
          fetchExtensionInfo();
          await loadExtensionFiles();
        } else {
          alert('Build error: ' + (data.error || 'Failed'));
        }
      } catch (e) {
        alert('Error building extension: ' + e);
      }
    }

    // ----------------- Fleet & Instances -----------------
    async function fetchFleet() {
      try {
        const res = await fetch('/api/instances');
        const data = await res.json();
        document.getElementById('badgeFleetOnline').textContent = data.online + ' online';

        const tbody = document.getElementById('fleetTableBody');
        if (!data.instances || !data.instances.length) {
          tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">No instances connected yet. Extensions sync via <code>/api/sync</code> every 5 min.</td></tr>';
          return;
        }

        const profileOptions = allProfiles.map(p => \`<option value="\${p.id}">\${p.name}</option>\`).join('');

        tbody.innerHTML = data.instances.map(inst => {
          let badge = 'badge-online';
          if (inst.status === 'STALE') badge = 'badge-stale';
          else if (inst.status === 'OFFLINE') badge = 'badge-offline';

          return \`<tr>
            <td><code>\${inst.instanceId}</code></td>
            <td style="font-family: var(--mono);">\${inst.ip}</td>
            <td>v\${inst.version}</td>
            <td><code>\${inst.group || 'Default Fleet'}</code></td>
            <td><span class="badge badge-action-proxy">\${inst.appliedProfileName || 'Default'}</span></td>
            <td>\${inst.syncCount}</td>
            <td><span class="badge \${badge}">\${inst.status}</span></td>
            <td>
              <select onchange="assignProfileToInstance('\${inst.instanceId}', this.value)" style="margin-bottom: 0; font-size: 11px; padding: 3px 6px;">
                <option value="">Default (Auto)</option>
                \${profileOptions}
              </select>
            </td>
          </tr>\`;
        }).join('');
      } catch (e) {
        console.error(e);
      }
    }

    async function assignProfileToInstance(instanceId, profileId) {
      try {
        await fetch('/api/instances/assign-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instanceId, profileId })
        });
        fetchFleet();
      } catch (e) {
        alert('Assignment error: ' + e);
      }
    }

    function selectDeployScenario(scen) {
      ['docker', 'systemd', 'nginx', 'standalone', 'gpo'].forEach(s => {
        const pane = document.getElementById('scen-' + s);
        if (pane) pane.style.display = s === scen ? 'block' : 'none';
        const btn = document.getElementById('btnScen' + s.charAt(0).toUpperCase() + s.slice(1));
        if (btn) {
          if (s === scen) btn.classList.add('active');
          else btn.classList.remove('active');
        }
      });
    }

    // ----------------- Extension Info & GPO -----------------
    async function fetchExtensionInfo() {
      try {
        const res = await fetch('/api/extension/info');
        const data = await res.json();
        document.getElementById('dispExtId').textContent = data.extensionId;
        document.getElementById('dispExtVer').textContent = data.version;

        globalGpo = data.gpo;
        if (data.gpo) {
          document.getElementById('gpoForcelist').textContent = data.gpo.forcelistEntry;
          document.getElementById('gpoSettings').textContent = JSON.stringify(data.gpo.extensionSettingsJson, null, 2);
          const scenGpo = document.getElementById('scenGpoForcelistText');
          if (scenGpo) scenGpo.textContent = data.gpo.forcelistEntry;
        }
      } catch (e) {
        console.error(e);
      }
    }

    function downloadRegFile() {
      if (!globalGpo || !globalGpo.regContent) return;
      const blob = new Blob([globalGpo.regContent], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'corp-proxy-policy.reg';
      a.click();
    }

    // ----------------- System Status & Kill-Switch -----------------
    async function fetchStatus() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        
        document.getElementById('hdrUser').textContent = data.currentUser || 'none';
        document.getElementById('hdrFleetCount').textContent = data.activeInstancesCount + ' active (' + data.totalInstancesCount + ' total)';
        
        if (data.nextRotationAt) {
          const diffMin = Math.round((new Date(data.nextRotationAt).getTime() - Date.now()) / 60000);
          document.getElementById('hdrNextRot').textContent = (diffMin > 0 ? 'in ' + diffMin + 'm' : 'imminent') + ' (' + new Date(data.nextRotationAt).toLocaleTimeString() + ')';
        } else {
          document.getElementById('hdrNextRot').textContent = 'Disabled';
        }

        renderAuditLogs(data.auditLogs || []);
      } catch (err) {
        console.error(err);
      }
    }

    async function toggleKillSwitch() {
      globalKillSwitch = !globalKillSwitch;
      try {
        await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ killSwitch: globalKillSwitch })
        });
        const ksBtn = document.getElementById('btnKillSwitch');
        if (globalKillSwitch) {
          ksBtn.textContent = 'Kill-Switch: ACTIVE (DIRECT)';
          ksBtn.classList.remove('btn-secondary');
          ksBtn.classList.add('btn-danger');
        } else {
          ksBtn.textContent = 'Kill-Switch: OFF';
          ksBtn.classList.remove('btn-danger');
          ksBtn.classList.add('btn-secondary');
        }
      } catch (e) {
        alert('Kill-switch error: ' + e);
      }
    }

    // ----------------- 3x-ui Rotation -----------------
    async function fetchRotationConfig() {
      try {
        const res = await fetch('/api/rotation/config');
        const data = await res.json();
        const cfg = data.config;
        
        document.getElementById('rotPanelUrl').value = cfg.panelUrl || '';
        document.getElementById('rotAdminUser').value = cfg.adminUser || '';
        document.getElementById('rotRemark').value = cfg.inboundRemark || '';
        document.getElementById('rotInterval').value = String(cfg.intervalMinutes || 1440);
        document.getElementById('rotEnabled').value = String(cfg.enabled);
        
        document.getElementById('rotStatusText').textContent = cfg.lastStatus || 'Idle';
        document.getElementById('rotNextRun').textContent = cfg.nextRotationAt ? new Date(cfg.nextRotationAt).toLocaleString() : 'Disabled';
        document.getElementById('rotLastRun').textContent = cfg.lastRotatedAt ? new Date(cfg.lastRotatedAt).toLocaleString() : 'None';

        renderRotationHistory(data.history || []);
      } catch (e) {
        console.error(e);
      }
    }

    async function saveRotationConfig() {
      const payload = {
        panelUrl: document.getElementById('rotPanelUrl').value.trim(),
        adminUser: document.getElementById('rotAdminUser').value.trim(),
        inboundRemark: document.getElementById('rotRemark').value.trim(),
        intervalMinutes: parseInt(document.getElementById('rotInterval').value, 10),
        enabled: document.getElementById('rotEnabled').value === 'true',
      };
      const pass = document.getElementById('rotAdminPass').value;
      if (pass) payload.adminPass = pass;

      try {
        const res = await fetch('/api/rotation/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          alert('Rotation schedule updated!');
          fetchRotationConfig();
          fetchStatus();
        }
      } catch (e) {
        alert('Error saving rotation settings: ' + e);
      }
    }

    async function test3xui() {
      const out = document.getElementById('test3xuiResult');
      out.textContent = 'Testing connection to 3x-ui API...';
      const payload = {
        panelUrl: document.getElementById('rotPanelUrl').value.trim(),
        adminUser: document.getElementById('rotAdminUser').value.trim(),
        adminPass: document.getElementById('rotAdminPass').value,
        inboundRemark: document.getElementById('rotRemark').value.trim()
      };

      try {
        const res = await fetch('/api/3xui/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        out.textContent = (data.ok ? '✅ ' : '❌ ') + data.message;
        out.style.color = data.ok ? 'var(--success)' : 'var(--danger)';
      } catch (e) {
        out.textContent = 'Connection test failed: ' + e;
        out.style.color = 'var(--danger)';
      }
    }

    async function manualRotate() {
      if (!confirm('Rotate proxy credentials immediately?')) return;
      try {
        const res = await fetch('/api/rotation/rotate-now', { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
          alert('Rotated! New user: ' + data.result.user + ' (source: ' + data.result.source + ')');
          refreshAll();
        } else {
          alert('Rotation error: ' + data.error);
        }
      } catch (e) {
        alert('Failed: ' + e);
      }
    }

    function renderRotationHistory(history) {
      const tbody = document.getElementById('rotHistoryTable');
      if (!history.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="color: var(--text-muted); text-align: center;">No rotation events yet</td></tr>';
        return;
      }
      tbody.innerHTML = history.map(item => \`<tr>
        <td style="font-family: var(--mono); font-size: 12px;">\${new Date(item.timestamp).toLocaleTimeString()}</td>
        <td><code>\${item.source}</code></td>
        <td>\${item.user}</td>
        <td><span class="badge \${item.success ? 'badge-online' : 'badge-offline'}">\${item.success ? 'SUCCESS' : 'FAILED'}</span></td>
      </tr>\`).join('');
    }

    function renderAuditLogs(logs) {
      const tbody = document.getElementById('auditTableBody');
      if (!logs.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No requests recorded</td></tr>';
        return;
      }
      tbody.innerHTML = logs.map(l => {
        let badge = 'badge-online';
        if (l.result === 'REJECTED_TOKEN' || l.result === 'STORE_ERROR') badge = 'badge-offline';
        else if (l.result === 'HEALTH_CHECK') badge = 'badge-action-proxy';
        
        return \`<tr>
          <td style="font-family: var(--mono); font-size: 12px;">\${new Date(l.timestamp).toLocaleTimeString()}</td>
          <td style="font-family: var(--mono);">\${l.ip}</td>
          <td><code>\${l.endpoint}</code></td>
          <td style="font-family: var(--mono);">\${l.status}</td>
          <td><span class="badge \${badge}">\${l.result}</span></td>
          <td style="color: var(--text-muted); font-size: 12px;">\${l.details || '-'}</td>
        </tr>\`;
      }).join('');
    }

    async function testCredsEndpoint() {
      const token = document.getElementById('testTokenInput').value;
      const out = document.getElementById('testCredsOutput');
      out.textContent = 'Executing GET /creds...';
      try {
        const start = performance.now();
        const res = await fetch('/creds', {
          headers: token ? { 'X-Ext-Token': token } : {}
        });
        const elapsed = Math.round(performance.now() - start);
        const json = await res.json().catch(() => ({}));
        out.textContent = \`HTTP \${res.status} \${res.statusText} (\${elapsed}ms)\n\n\${JSON.stringify(json, null, 2)}\`;
        fetchStatus();
      } catch (e) {
        out.textContent = 'Request failed: ' + e;
      }
    }

    async function testSyncEndpoint() {
      const out = document.getElementById('testSyncOutput');
      out.textContent = 'Executing POST /api/sync...';
      const token = document.getElementById('testTokenInput').value;
      try {
        const res = await fetch('/api/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'X-Ext-Token': token } : {})
          },
          body: JSON.stringify({
            instanceId: 'test-simulated-worker',
            version: '1.2.0',
            activeProxyMode: 'http'
          })
        });
        const json = await res.json();
        out.textContent = JSON.stringify(json, null, 2);
        fetchFleet();
        fetchStatus();
      } catch (e) {
        out.textContent = 'Sync test failed: ' + e;
      }
    }

    function refreshAll() {
      fetchStatus();
      loadPresets();
      loadProfiles();
      loadBuilderConfig();
      loadExtensionFiles();
      fetchFleet();
      fetchExtensionInfo();
      fetchRotationConfig();
    }

    refreshAll();
    setInterval(fetchFleet, 5000);
    setInterval(fetchStatus, 10000);
  </script>
</body>
</html>`;

  res.send(html);
});

app.listen(PORT, HOST, () => {
  console.log(`[mini-server] Server running on http://${HOST}:${PORT}`);
});

export default app;
