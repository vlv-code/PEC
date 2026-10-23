import { Router, Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import {
  getAppBuildConfig,
  saveAppBuildConfig,
  buildAppProfile,
  renderAppDeployPs1,
  renderAppVerifyPs1,
  packageApp,
  getAppUpdatesDir,
  getTemplatesAppDir,
  buildAppBinaries,
} from "../appPackager.js";
import { recordAudit, getClientIp, getBaseUrl } from "../audit.js";
import { createRateLimiter } from "../middleware/security.js";
import { getAppBuildInfoPath, getReleasesDir } from "../storage.js";
import type { AppProcessRule } from "../types.js";
import { getCertificateStatus, saveCertificate, deleteCertificate } from "../codeSigner.js";

const VALID_PROTOCOLS = new Set(["tcp", "udp", "both"]);
const VALID_ACTIONS = new Set(["proxy", "direct", "block"]);

function validateProcessRules(rules: unknown): AppProcessRule[] {
  if (!Array.isArray(rules)) {
    throw new Error("processRules must be an array");
  }

  return rules.map((r, i) => {
    if (!r || typeof r !== "object") {
      throw new Error(`Rule at index ${i} is not a valid object`);
    }

    const proto = String((r as any).protocol || "tcp").toLowerCase();
    if (!VALID_PROTOCOLS.has(proto)) {
      throw new Error(`Invalid protocol '${proto}' in rule ${i}. Allowed: tcp, udp, both`);
    }

    const action = String((r as any).action || "proxy").toLowerCase();
    if (!VALID_ACTIONS.has(action)) {
      throw new Error(`Invalid action '${action}' in rule ${i}. Allowed: proxy, direct, block`);
    }

    return {
      id: String((r as any).id || `rule_${i + 1}`),
      processName: String((r as any).processName || "*"),
      targetHosts: String((r as any).targetHosts || "*"),
      targetPorts: String((r as any).targetPorts || "*"),
      protocol: proto as "tcp" | "udp" | "both",
      action: action as "proxy" | "direct" | "block",
    };
  });
}

export function createAppBuilderRouter(
  _getFleetToken: () => string,
  getAdminToken?: () => string
): Router {
  const router = Router();

  const downloadLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 10,
    message: "Rate limit exceeded for app package download.",
  });

  router.get("/api/app-builder/config", (_req: Request, res: Response) => {
    res.json(getAppBuildConfig());
  });

  router.post("/api/app-builder/config", (req: Request, res: Response) => {
    try {
      const adminToken = getAdminToken?.();
      if (adminToken && req.body?.defaultToken && req.body.defaultToken === adminToken) {
        return res.status(400).json({
          error: "defaultToken must never equal ADMIN_TOKEN - client artifacts ship the fleet token publicly.",
        });
      }

      const updates: any = { ...req.body };
      if (updates.processRules !== undefined) {
        updates.processRules = validateProcessRules(updates.processRules);
      }

      const updated = saveAppBuildConfig(updates);
      res.json({ ok: true, ...updated });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  router.get("/api/app-builder/info", (_req: Request, res: Response) => {
    try {
      const infoPath = getAppBuildInfoPath();
      if (fs.existsSync(infoPath)) {
        const info = JSON.parse(fs.readFileSync(infoPath, "utf-8"));
        return res.json({ ok: true, info, result: info });
      }
      res.json({ ok: true, info: null, result: null });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  router.post("/api/app-builder/build", (req: Request, res: Response) => {
    try {
      if (req.body && Object.keys(req.body).length > 0) {
        const updates: any = { ...req.body };
        if (updates.processRules !== undefined) {
          updates.processRules = validateProcessRules(updates.processRules);
        }
        saveAppBuildConfig(updates);
      }

      const baseUrl = getBaseUrl(req);
      const result = packageApp(baseUrl);

      recordAudit({
        ip: getClientIp(req),
        endpoint: "/api/app-builder/build",
        status: 200,
        result: "BUILD_SUCCESS",
        details: `Packaged app v${result.version}`,
      });

      res.json({ ok: true, result, info: result });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  router.post("/api/app-builder/build-binaries", (req: Request, res: Response) => {
    try {
      const result = buildAppBinaries();
      recordAudit({
        ip: getClientIp(req),
        endpoint: "/api/app-builder/build-binaries",
        status: result.ok ? 200 : 500,
        result: result.ok ? "BUILD_SUCCESS" : "STORE_ERROR",
        details: result.message,
      });

      if (!result.ok) {
        return res.status(500).json(result);
      }
      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[appBuilderRoutes] build-binaries exception:", msg);
      recordAudit({
        ip: getClientIp(req),
        endpoint: "/api/app-builder/build-binaries",
        status: 500,
        result: "STORE_ERROR",
        details: msg,
      });
      res.status(500).json({ ok: false, error: msg });
    }
  });

  router.get("/api/app-builder/profile", (req: Request, res: Response) => {
    try {
      const cfg = getAppBuildConfig();
      const baseUrl = getBaseUrl(req);
      const profile = buildAppProfile(cfg, baseUrl);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="pec_profile.pbprofile"');
      res.send(JSON.stringify(profile, null, 2));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.get("/api/app-builder/certificate", (_req: Request, res: Response) => {
    try {
      const status = getCertificateStatus();
      res.json({ ok: true, certificate: status });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  router.post("/api/app-builder/certificate", (req: Request, res: Response) => {
    try {
      const { pfxBase64, password, type, timestampUrl } = req.body || {};
      if (!pfxBase64 || typeof pfxBase64 !== "string") {
        return res.status(400).json({ ok: false, error: "pfxBase64 is required (base64 string)" });
      }
      const buffer = Buffer.from(pfxBase64, "base64");
      if (buffer.length === 0) {
        return res.status(400).json({ ok: false, error: "Empty certificate buffer" });
      }
      const cert = saveCertificate(
        buffer,
        password || "",
        type === "internal" ? "internal" : "commercial",
        timestampUrl
      );
      recordAudit({
        ip: getClientIp(req),
        endpoint: "/api/app-builder/certificate",
        status: 200,
        result: "CONFIG_UPDATED",
        details: `Saved ${cert.type} certificate: ${cert.subject || "unknown"}`,
      });
      res.json({ ok: true, certificate: cert });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  router.delete("/api/app-builder/certificate", (req: Request, res: Response) => {
    try {
      deleteCertificate();
      recordAudit({
        ip: getClientIp(req),
        endpoint: "/api/app-builder/certificate",
        status: 200,
        result: "CONFIG_UPDATED",
        details: "Deleted code signing certificate",
      });
      res.json({ ok: true, certificate: getCertificateStatus() });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  router.get("/api/app-builder/download/:platform", downloadLimiter, (req: Request, res: Response) => {
    try {
      const platform = (req.params.platform || "").toLowerCase();
      const updatesDir = getAppUpdatesDir();
      const cfg = getAppBuildConfig();
      const ver = cfg.version || "2.1.0";
      const releasesDir = path.join(getReleasesDir(), "apps", ver);

      if (platform === "msi" || platform === "windows-msi") {
        const findMsi = () => [
          path.join(releasesDir, `PEC-App-${ver}.msi`),
          path.join(releasesDir, "PEC-App.msi"),
          path.join(updatesDir, `PEC-App-${ver}.msi`),
          path.join(updatesDir, "PEC-App.msi"),
          path.join(getTemplatesAppDir(), "windows", `PEC-App-${ver}.msi`),
          path.join(getTemplatesAppDir(), "windows", "PEC-App.msi"),
        ].find((p) => fs.existsSync(p) && fs.statSync(p).size > 10);

        let msiPath = findMsi();
        if (!msiPath) {
          packageApp(getBaseUrl(req));
          msiPath = findMsi();
        }

        if (msiPath) {
          return res.download(msiPath, `PEC-App-${ver}.msi`);
        }
        return res.status(404).json({
          error: "MSI package not found. Ensure msitools (wixl) is installed in Docker or WiX Toolset on Windows.",
        });
      }

      if (platform === "windows") {
        const findZip = () => [
          path.join(releasesDir, "PEC-App-windows-x64.zip"),
          path.join(releasesDir, "pec-client-windows-x64.zip"),
          path.join(updatesDir, "PEC-App-windows-x64.zip"),
          path.join(updatesDir, "pec-client-windows-x64.zip"),
        ].find((p) => fs.existsSync(p));

        let zipPath = findZip();
        if (!zipPath) {
          packageApp(getBaseUrl(req));
          zipPath = findZip();
        }
        return res.download(zipPath || path.join(releasesDir, "PEC-App-windows-x64.zip"), "pec-client-windows-x64.zip");
      }

      if (platform === "installer" || platform === "setup" || platform === "exe" || platform === "windows-installer") {
        const findSetup = () => [
          path.join(releasesDir, `PEC-App-Setup-${ver}.exe`),
          path.join(releasesDir, "PEC-App-Setup.exe"),
          path.join(updatesDir, `PEC-App-Setup-${ver}.exe`),
          path.join(updatesDir, "PEC-App-Setup.exe"),
          path.join(getTemplatesAppDir(), "windows", `PEC-App-Setup-${ver}.exe`),
          path.join(getTemplatesAppDir(), "windows", "PEC-App-Setup.exe"),
          path.resolve("./client/Windows/installer", `PEC-App-Setup-${ver}.exe`),
          path.resolve("./client/Windows/installer", "PEC-App-Setup.exe"),
        ].find((p) => fs.existsSync(p) && fs.statSync(p).size > 1000);

        let setupPath = findSetup();
        if (!setupPath) {
          packageApp(getBaseUrl(req));
          setupPath = findSetup();
        }

        if (setupPath) {
          return res.download(setupPath, `PEC-App-Setup-${ver}.exe`);
        }
        const zipPath = [
          path.join(releasesDir, "PEC-App-windows-x64.zip"),
          path.join(releasesDir, "pec-client-windows-x64.zip"),
          path.join(updatesDir, "pec-client-windows-x64.zip"),
        ].find((p) => fs.existsSync(p));
        return res.download(zipPath || path.join(releasesDir, "PEC-App-windows-x64.zip"), "pec-client-windows-x64.zip");
      }

      if (platform === "linux") {
        const findTar = () => [
          path.join(releasesDir, "pec-client-linux-x64.tar.gz"),
          path.join(updatesDir, "pec-client-linux-x64.tar.gz"),
        ].find((p) => fs.existsSync(p));

        let tarPath = findTar();
        if (!tarPath) {
          packageApp(getBaseUrl(req));
          tarPath = findTar();
        }
        res.setHeader("Content-Type", "application/gzip");
        res.setHeader("Content-Disposition", 'attachment; filename="pec-client-linux-x64.tar.gz"');
        return res.sendFile(path.resolve(tarPath || path.join(releasesDir, "pec-client-linux-x64.tar.gz")));
      }

      res.status(404).json({ error: "Unknown platform. Valid platforms: windows, linux, msi, installer" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.get("/api/app-builder/scripts/:type", (req: Request, res: Response) => {
    try {
      const type = (req.params.type || "").toLowerCase();
      const cfg = getAppBuildConfig();
      const baseUrl = getBaseUrl(req);

      if (type.startsWith("deploy")) {
        const script = renderAppDeployPs1(cfg, baseUrl);
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="deploy-pec-app.ps1"');
        return res.send(script);
      }

      if (type.startsWith("verify")) {
        const script = renderAppVerifyPs1(cfg);
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="verify-pec-app.ps1"');
        return res.send(script);
      }

      res.status(404).json({ error: "Unknown script type. Valid: deploy, verify" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
