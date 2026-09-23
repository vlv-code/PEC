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
} from "../packager.js";
import { recordAudit, getClientIp, getBaseUrl } from "../audit.js";

export function createBuilderRouter(getFleetToken: () => string, getAdminToken?: () => string): Router {
  const router = Router();

  const warnIfAdminTokenInArtifact = (token: string): void => {
    const adminToken = getAdminToken?.();
    if (adminToken && token && token === adminToken) {
      console.error("[SECURITY WARNING] defaultToken must never equal ADMIN_TOKEN - artifacts (CRX/GPO) ship the fleet token publicly.");
    }
  };

  router.get("/api/builder/config", (_req: Request, res: Response) => {
    res.json(getBuildConfig());
  });

  router.post("/api/builder/config", (req: Request, res: Response) => {
    const updated = saveBuildConfig(req.body);
    warnIfAdminTokenInArtifact(updated.defaultToken);
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
        const saved = saveBuildConfig(req.body);
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
    const gpo = generateGpoConfig(info.extensionId, baseUrl, token);
    res.json({ ...info, baseUrl, gpo });
  });

  router.get("/api/extension/download-zip", (req: Request, res: Response) => {
    const zipPath = path.resolve("./dist/updates/extension.zip");
    if (!fs.existsSync(zipPath)) {
      packageExtension(getBaseUrl(req));
    }
    res.download(zipPath, "corp-proxy-extension.zip");
  });

  return router;
}
