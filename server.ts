import express, { Request, Response, NextFunction } from "express";
import fs from "node:fs";
import path from "node:path";
import { ensureKeyExists, packageExtension } from "./src/packager.js";
import { startScheduler } from "./src/scheduler.js";
import { atomicWriteCreds, ensureCredsStore, getCredsStorePath } from "./src/rotate.js";
import { securityHeadersMiddleware, safeCorsMiddleware, createTokenAuthMiddleware } from "./src/middleware/security.js";
import { createCredsRouter } from "./src/routes/credsRoutes.js";
import { createRoutingRouter } from "./src/routes/routingRoutes.js";
import { createInstancesRouter } from "./src/routes/instancesRoutes.js";
import { createBuilderRouter } from "./src/routes/builderRoutes.js";
import { createRotationRouter } from "./src/routes/rotationRoutes.js";
import { createSystemRouter } from "./src/routes/systemRoutes.js";
import { renderDashboardHtml } from "./src/views/dashboardView.js";

// Load environment variables from .env if present
if (fs.existsSync(".env")) {
  try {
    if (typeof process.loadEnvFile === "function") {
      process.loadEnvFile(".env");
    } else {
      const envLines = fs.readFileSync(".env", "utf-8").split("\n");
      for (const line of envLines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
          const [key, ...rest] = trimmed.split("=");
          const val = rest.join("=").trim().replace(/^['"](.*)['"]$/, "$1");
          if (!process.env[key.trim()]) {
            process.env[key.trim()] = val;
          }
        }
      }
    }
  } catch (err) {
    console.warn("[env] Notice: Could not parse .env file:", err);
  }
}

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";

// Trust proxy configuration: controls how Express resolves client IPs from
// X-Forwarded-For. Leave disabled (default) unless the server runs behind a
// reverse proxy such as nginx - otherwise clients can spoof their IP and
// bypass rate limits. Valid values: false | true | <number of trusted hops>.
const TRUST_PROXY_RAW = (process.env.TRUST_PROXY || "false").trim();
let trustProxySetting: boolean | number = false;
if (TRUST_PROXY_RAW === "true") {
  trustProxySetting = true;
} else if (/^\d+$/.test(TRUST_PROXY_RAW) && TRUST_PROXY_RAW !== "0") {
  trustProxySetting = parseInt(TRUST_PROXY_RAW, 10);
}
app.set("trust proxy", trustProxySetting);

const DEFAULT_TOKEN = "corp-proxy-secret-token-change-me";
const EXT_SHARED_TOKEN = process.env.EXT_SHARED_TOKEN || DEFAULT_TOKEN;
const isDefaultTokenInUse = EXT_SHARED_TOKEN === DEFAULT_TOKEN;
const CREDS_STORE = getCredsStorePath();

// Initialize initial credentials if not found (random password, never hardcoded)
if (!fs.existsSync(CREDS_STORE)) {
  console.log(`[pec-server] Initializing credentials storage at ${CREDS_STORE}`);
  ensureCredsStore(CREDS_STORE);
}

// Ensure RSA private/public key and base extension distribution package exist
try {
  ensureKeyExists();
  packageExtension(`http://localhost:${PORT}`);
  console.log("[pec-server] Initial Chrome Extension package generated.");
} catch (err) {
  console.warn("[pec-server] Initial packaging notice:", err);
}

// Start background rotation scheduler
startScheduler();

// Security Middleware: Headers & CORS
app.use(securityHeadersMiddleware);
app.use(safeCorsMiddleware);
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

// Authentication gate for management APIs.
// Every /api/* route except the explicit allowlist below requires a valid
// X-Ext-Token header. /api/sync stays public at the routing layer because it
// carries its own token verification and sliding-window rate limiter (the
// extension fleet authenticates there); /api/ip-echo is a diagnostic echo
// endpoint used by extension popups.
const adminAuth = createTokenAuthMiddleware(() => EXT_SHARED_TOKEN);
const PUBLIC_API_PATHS = new Set(["/ip-echo", "/sync"]);
app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  if (PUBLIC_API_PATHS.has(req.path)) {
    return next();
  }
  return adminAuth(req, res, next);
});

// Chrome Extension distribution updates
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

// Mount Modular Routers
app.use(createCredsRouter(() => EXT_SHARED_TOKEN));
app.use(createRoutingRouter());
app.use(createInstancesRouter());
app.use(createBuilderRouter(() => EXT_SHARED_TOKEN));
app.use(createRotationRouter());
app.use(
  createSystemRouter({
    port: PORT,
    getSharedToken: () => EXT_SHARED_TOKEN,
    defaultToken: DEFAULT_TOKEN,
    credsStorePath: CREDS_STORE,
  })
);

// Management Dashboard UI
app.get("/", (req: Request, res: Response) => {
  if (req.headers.accept?.includes("application/json") && !req.headers.accept?.includes("text/html")) {
    return res.json({
      title: "Corp Proxy Auth & Extension Studio",
      version: "1.3.1",
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
        "GET /api/status",
        "GET /api/github/releases",
      ],
    });
  }

  const html = renderDashboardHtml({
    isDefaultTokenInUse,
    port: PORT,
  });
  // Content-Security-Policy: blocks loading of external scripts/styles and
  // neutralizes whole classes of injected-content attacks. 'unsafe-inline' is
  // required because the dashboard ships a single inline <script> block; all
  // dynamic values are additionally HTML-escaped at render time.
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; " +
      "base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
  );
  res.type("html").send(html);
});

app.listen(PORT, HOST, () => {
  console.log(`[pec-server] PEC Proxy Server running on http://${HOST}:${PORT}`);
  if (isDefaultTokenInUse) {
    console.warn(`[SECURITY WARNING] The default authentication token is in use! Please configure EXT_SHARED_TOKEN in .env for production safety.`);
  }
});

export default app;
