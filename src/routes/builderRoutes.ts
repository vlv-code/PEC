import { Router, Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import {
  getBuildConfig,
  saveBuildConfig,
  generateExtensionFiles,
  getExtensionSourceFiles,
  saveExtensionSourceFile,
  packageExtension,
  getBuildInfo,
  generateGpoConfig,
  generateGpoDeploymentPack,
  isPackageStale,
} from "../packager.js";
import { recordAudit, getClientIp, getBaseUrl } from "../audit.js";
import { createRateLimiter } from "../middleware/security.js";
import type { ExtensionBuildConfig } from "../types.js";

const ALLOWED_BUILD_CONFIG_KEYS: ReadonlySet<string> = new Set([
  "name",
  "shortName",
  "version",
  "description",
  "serverUrl",
  "updateUrl",
  "token",
  "locale",
  "uiMode",
  "presetTemplate",
  "presetStyle",
  "uiLayout",
  "colorPalette",
  "defaultThemeMode",
  "themeColor",
  "themeBackground",
  "themeCard",
  "iconEmoji",
  "customIconDataUrl",
  "iconType",
  "webRtcProtection",
  "dnsLeakProtection",
  "badgeIndicator",
  "allowUserBypass",
  "bypassAutoTimeoutMinutes",
  "showIpGeoChecker",
  "showSupportButton",
  "supportUrl",
  "pingTestUrl",
  "syncIntervalMinutes",
  "defaultServerUrl",
  "defaultToken",
  "targetProfileId",
  "defaultProxyId",
  "allowUserProxySwitch",
  "autoConfigureProxy",
  "targetGroup",
  "overriddenFiles",
]);

function filterBuildConfig(input: any): Partial<ExtensionBuildConfig> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const filtered: Record<string, any> = {};
  for (const key of Object.keys(input)) {
    if (ALLOWED_BUILD_CONFIG_KEYS.has(key)) {
      filtered[key] = input[key];
    }
  }
  return filtered;
}

export function createBuilderRouter(getFleetToken: () => string, getAdminToken?: () => string): Router {
  const router = Router();

  const warnIfAdminTokenInArtifact = (token?: string): void => {
    const adminToken = getAdminToken?.();
    if (adminToken && token && token === adminToken) {
      console.error("[SECURITY WARNING] defaultToken must never equal ADMIN_TOKEN - artifacts (CRX/GPO) ship the fleet token publicly.");
    }
  };

  router.get("/api/builder/config", (_req: Request, res: Response) => {
    res.json(getBuildConfig());
  });

  router.post("/api/builder/config", (req: Request, res: Response) => {
    const adminToken = getAdminToken?.();
    if (adminToken && req.body?.defaultToken && req.body.defaultToken === adminToken) {
      return res.status(400).json({
        error: "defaultToken must never equal ADMIN_TOKEN - artifacts (CRX/GPO) ship the fleet token publicly.",
      });
    }
    const cleanConfig = filterBuildConfig(req.body);
    const updated = saveBuildConfig(cleanConfig);
    generateExtensionFiles(updated);
    res.json(updated);
  });

  router.post("/api/builder/regenerate", (_req: Request, res: Response) => {
    const cfg = getBuildConfig();
    generateExtensionFiles(cfg, { force: true });
    res.json({ ok: true, files: getExtensionSourceFiles() });
  });

  router.get("/api/builder/files", (_req: Request, res: Response) => {
    res.json(getExtensionSourceFiles());
  });

  router.post("/api/builder/file", (req: Request, res: Response) => {
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

  router.post("/api/builder/build", (req: Request, res: Response) => {
    try {
      if (req.body && Object.keys(req.body).length > 0) {
        const cleanConfig = filterBuildConfig(req.body);
        const saved = saveBuildConfig(cleanConfig);
        warnIfAdminTokenInArtifact(saved.defaultToken);
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

  router.get("/api/extension/info", (req: Request, res: Response) => {
    const baseUrl = getBaseUrl(req);
    const info = getBuildInfo(baseUrl);
    const token = getFleetToken();
    const cfg = getBuildConfig();
    const gpo = generateGpoConfig(info.extensionId, baseUrl, token, {
      targetGroup: cfg.targetGroup,
      autoConfigureProxy: cfg.autoConfigureProxy,
      updateUrl: cfg.updateUrl,
    });
    res.json({ ...info, baseUrl, gpo });
  });

  router.get("/api/builder/gpo-pack", (req: Request, res: Response) => {
    try {
      const baseUrl = getBaseUrl(req);
      const token = getFleetToken();
      const pack = generateGpoDeploymentPack(baseUrl, token);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", 'attachment; filename="pec-gpo-deployment-pack.zip"');
      res.send(pack.zipBuffer);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.get("/api/builder/reg", (req: Request, res: Response) => {
    try {
      const scope = (req.query.scope === "machine" ? "machine" : "user") as "user" | "machine";
      const baseUrl = getBaseUrl(req);
      const info = getBuildInfo(baseUrl);
      const token = getFleetToken();
      const cfg = getBuildConfig();
      const gpo = generateGpoConfig(info.extensionId, baseUrl, token, {
        scope,
        targetGroup: cfg.targetGroup,
        autoConfigureProxy: cfg.autoConfigureProxy,
      });
      const content = scope === "machine" ? gpo.regContentMachine : gpo.regContentUser;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="pec-policy-${scope}.reg"`);
      res.send(content);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.get("/api/builder/script/:name", (req: Request, res: Response) => {
    try {
      const name = (req.params.name || "").toLowerCase();
      const baseUrl = getBaseUrl(req);
      const info = getBuildInfo(baseUrl);
      const token = getFleetToken();
      const cfg = getBuildConfig();
      const gpo = generateGpoConfig(info.extensionId, baseUrl, token, {
        targetGroup: cfg.targetGroup,
        autoConfigureProxy: cfg.autoConfigureProxy,
      });

      if (name.startsWith("deploy")) {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="deploy-pec-gpo.ps1"');
        return res.send(gpo.deployScript);
      }
      if (name.startsWith("verify")) {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="verify-pec-gpo.ps1"');
        return res.send(gpo.verifyScript);
      }
      res.status(404).json({ error: "Unknown script. Valid: deploy.ps1, verify.ps1" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  const downloadLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 10,
    message: "Rate limit exceeded for extension download.",
  });

  router.get("/api/extension/download-zip", downloadLimiter, (req: Request, res: Response) => {
    const updatesDir = path.resolve(process.env.PEC_UPDATES_DIR || "./dist/updates");
    const zipPath = path.join(updatesDir, "extension.zip");
    if (!fs.existsSync(zipPath) || isPackageStale()) {
      packageExtension(getBaseUrl(req));
    }
    res.download(zipPath, "corp-proxy-extension.zip");
  });

  return router;
}
