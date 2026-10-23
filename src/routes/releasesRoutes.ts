import { Router, Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { getReleasesDir } from "../storage.js";
import {
  getAllReleases,
  setActiveRelease,
  deleteRelease,
} from "../releases.js";
import { createRateLimiter, createTokenAuthMiddleware, timingSafeEqualString } from "../middleware/security.js";

export function createReleasesRouter(
  getAdminToken?: () => string,
  cookieAuth?: (req: Request) => boolean,
  getFleetToken?: () => string
): Router {
  const router = Router();

  const limiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 120,
    message: "Too many release manager requests.",
  });
  router.use("/api/releases", limiter);

  const adminAuthMiddleware = getAdminToken
    ? createTokenAuthMiddleware(getAdminToken, "x-admin-token", cookieAuth)
    : (_req: Request, _res: Response, next: () => void) => next();

  const getHeaderString = (val: string | string[] | undefined): string => {
    if (Array.isArray(val)) return (val[0] || "").split(",")[0].trim();
    if (typeof val === "string") return val.split(",")[0].trim();
    return "";
  };

  const downloadAuthMiddleware = (req: Request, res: Response, next: () => void) => {
    if (cookieAuth && cookieAuth(req)) {
      return next();
    }
    const adminToken = getAdminToken ? getAdminToken() : (process.env.ADMIN_TOKEN || "");
    const headerAdmin = getHeaderString(req.headers["x-admin-token"]);
    if (adminToken && headerAdmin && timingSafeEqualString(headerAdmin, adminToken)) {
      return next();
    }
    const rawType = String(req.params.type || "").toLowerCase();
    // Allow X-Fleet-Token only for extension downloads. Desktop app and MSI packages require admin credentials.
    if (rawType === "extension") {
      const fleetToken = getFleetToken ? getFleetToken() : (process.env.EXT_SHARED_TOKEN || process.env.FLEET_TOKEN || "");
      const headerFleet = getHeaderString(req.headers["x-fleet-token"] || req.headers["x-ext-token"]);
      if (fleetToken && headerFleet && timingSafeEqualString(headerFleet, fleetToken)) {
        return next();
      }
    }
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  };

  router.get("/api/releases", adminAuthMiddleware, (_req: Request, res: Response) => {
    const store = getAllReleases();
    res.json({
      ok: true,
      activeExtensionVersion: store.activeExtensionVersion,
      activeAppVersion: store.activeAppVersion,
      releases: store.releases,
    });
  });

  router.post("/api/releases/set-active", adminAuthMiddleware, (req: Request, res: Response) => {
    try {
      const { type, version } = req.body || {};
      if (type !== "extension" && type !== "app" && type !== "msi") {
        return res.status(400).json({ ok: false, error: "Invalid type: must be 'extension', 'app', or 'msi'" });
      }
      if (!version || typeof version !== "string") {
        return res.status(400).json({ ok: false, error: "version is required and must be a string" });
      }

      const result = setActiveRelease(type, version.trim());
      res.json({
        ok: true,
        activeVersion: result.activeVersion,
        message: `Active ${type} version switched to ${result.activeVersion}`,
      });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err.message || "Failed to set active release" });
    }
  });

  router.delete("/api/releases/:type/:version", adminAuthMiddleware, (req: Request, res: Response) => {
    try {
      const { type, version } = req.params;
      if (type !== "extension" && type !== "app") {
        return res.status(400).json({ ok: false, error: "Invalid type: must be 'extension' or 'app'" });
      }
      if (!version) {
        return res.status(400).json({ ok: false, error: "version is required" });
      }

      const removed = deleteRelease(type, version.trim());
      if (!removed) {
        return res.status(404).json({ ok: false, error: "Release not found" });
      }
      res.json({ ok: true, removed: true });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err.message || "Failed to delete release" });
    }
  });

  router.get("/api/releases/download/:type/:version", downloadAuthMiddleware, (req: Request, res: Response) => {
    try {
      const rawType = String(req.params.type || "").toLowerCase();
      const version = String(req.params.version || "").trim();
      if (rawType !== "extension" && rawType !== "app" && rawType !== "msi") {
        return res.status(400).json({ ok: false, error: "Invalid type: must be 'extension', 'app', or 'msi'" });
      }
      if (!version) {
        return res.status(400).json({ ok: false, error: "version is required" });
      }

      if (rawType === "msi") {
        const msiCandidates = [
          path.join(getReleasesDir(), "apps", version, `PEC-App-${version}.msi`),
          path.join(getReleasesDir(), "apps", version, "PEC-App.msi"),
        ];
        const msiPath = msiCandidates.find((p) => fs.existsSync(p));
        if (!msiPath) {
          return res.status(404).json({ ok: false, error: "MSI release file not found" });
        }
        return res.download(path.resolve(msiPath), `PEC-App-${version}.msi`);
      }
      const type = rawType as "extension" | "app";
      const store = getAllReleases();
      const release = store.releases.find((r) => r.type === type && r.version === version);
      if (!release) {
        return res.status(404).json({ ok: false, error: "Release not found" });
      }

      if (!fs.existsSync(release.filePath)) {
        return res.status(404).json({ ok: false, error: "Release file not found on disk" });
      }

      const filename = release.fileName || path.basename(release.filePath);
      res.download(path.resolve(release.filePath), filename);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || "Failed to download release" });
    }
  });

  return router;
}
