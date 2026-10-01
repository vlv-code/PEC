import { Router, Request, Response } from "express";
import { getRotationConfig, updateRotationConfig, getRotationConfigPublic } from "../scheduler.js";
import { getProxyConfig, updateProxyConfig } from "../instances.js";

/**
 * Normalizes and preserves rotAdminPass / adminPass when updating rotation/proxy config:
 * If rotAdminPass is an empty string ("") or undefined in the request body,
 * the existing rotAdminPass / adminPass from current storage is preserved instead of wiped out.
 */
export function preservePasswordOnConfigUpdate(
  body: any,
  currentStorage: { adminPass?: string; rotAdminPass?: string } = getRotationConfig()
): any {
  const currentPass = currentStorage.rotAdminPass || currentStorage.adminPass || "";
  const sanitized = { ...body };

  if ("rotAdminPass" in sanitized) {
    if (sanitized.rotAdminPass === "" || sanitized.rotAdminPass === undefined) {
      sanitized.rotAdminPass = currentPass;
      sanitized.adminPass = currentPass;
    } else {
      sanitized.adminPass = sanitized.rotAdminPass;
    }
  } else if ("adminPass" in sanitized) {
    if (sanitized.adminPass === "" || sanitized.adminPass === undefined) {
      sanitized.adminPass = currentPass;
      sanitized.rotAdminPass = currentPass;
    } else {
      sanitized.rotAdminPass = sanitized.adminPass;
    }
  }

  return sanitized;
}

export function updateRotationConfigWithPreservation(body: any) {
  const sanitized = preservePasswordOnConfigUpdate(body);
  return updateRotationConfig(sanitized);
}

export function createConfigRouter(): Router {
  const router = Router();

  router.get("/api/config", (_req: Request, res: Response) => {
    res.json(getProxyConfig());
  });

  router.post("/api/config", (req: Request, res: Response) => {
    try {
      const sanitized = preservePasswordOnConfigUpdate(req.body);
      const updated = updateProxyConfig(sanitized);
      res.json(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  router.get("/api/rotation/config", (_req: Request, res: Response) => {
    const pub = getRotationConfigPublic();
    res.json({
      config: {
        ...pub,
        rotAdminPass: pub.adminPass,
      },
    });
  });

  router.post("/api/rotation/config", (req: Request, res: Response) => {
    try {
      const updated = updateRotationConfigWithPreservation(req.body);
      const masked = updated.adminPass ? "********" : "";
      res.json({ ...updated, adminPass: masked, rotAdminPass: masked });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  return router;
}
