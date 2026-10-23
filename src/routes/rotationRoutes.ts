import { Router, Request, Response } from "express";
import {
  getRotationConfig,
  getRotationConfigPublic,
  getRotationHistory,
  updateRotationConfig,
  runManualRotation,
} from "../scheduler.js";
import {
  test3xuiConnection,
  getAll3xuiPanels,
  get3xuiPanelById,
  save3xuiPanel,
  delete3xuiPanel,
  fetch3xuiInbounds,
} from "../rotate.js";
import { recordAudit, getClientIp } from "../audit.js";
import { createRateLimiter } from "../middleware/security.js";

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

export function createRotationRouter(): Router {
  const router = Router();

  const testLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 15,
    message: "Rate limit exceeded for 3x-ui connection test.",
  });

  // ----------------- 3X-UI PANELS REGISTRY -----------------

  router.get("/api/3xui/panels", (_req: Request, res: Response) => {
    try {
      const panels = getAll3xuiPanels(true);
      res.json(panels);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.post("/api/3xui/panels", (req: Request, res: Response) => {
    try {
      const { name, panelUrl, adminUser, adminPass, insecureTls } = req.body || {};
      if (!name || !panelUrl || !adminUser) {
        return res.status(400).json({ error: "Missing required fields: name, panelUrl, adminUser" });
      }
      const saved = save3xuiPanel({ name, panelUrl, adminUser, adminPass, insecureTls });
      res.json({ ...saved, adminPass: "••••••••" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  router.put("/api/3xui/panels/:id", (req: Request, res: Response) => {
    try {
      const { name, panelUrl, adminUser, adminPass, insecureTls } = req.body || {};
      const saved = save3xuiPanel({
        id: req.params.id,
        name,
        panelUrl,
        adminUser,
        adminPass,
        insecureTls,
      });
      res.json({ ...saved, adminPass: "••••••••" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  router.delete("/api/3xui/panels/:id", (req: Request, res: Response) => {
    try {
      const ok = delete3xuiPanel(req.params.id);
      res.json({ ok });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.post("/api/3xui/panels/:id/test", testLimiter, async (req: Request, res: Response) => {
    try {
      const panel = get3xuiPanelById(req.params.id);
      if (!panel) return res.status(404).json({ ok: false, message: "Panel not found" });
      const result = await test3xuiConnection({
        panelUrl: panel.panelUrl,
        adminUser: panel.adminUser,
        adminPass: panel.adminPass,
        timeoutSec: 8,
      });
      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  router.get("/api/3xui/panels/:id/inbounds", async (req: Request, res: Response) => {
    try {
      const inbounds = await fetch3xuiInbounds(req.params.id);
      res.json(inbounds);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.get("/api/rotation/config", (_req: Request, res: Response) => {
    const pub = getRotationConfigPublic();
    res.json({
      config: {
        ...pub,
        rotAdminPass: pub.adminPass,
      },
      history: getRotationHistory().slice(0, 10),
    });
  });

  router.post("/api/rotation/config", (req: Request, res: Response) => {
    try {
      const updated = updateRotationConfigWithPreservation(req.body);
      // never echo the real admin password back to the client
      const masked = updated.adminPass ? "********" : "";
      res.json({ ...updated, adminPass: masked, rotAdminPass: masked });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  router.post("/api/rotation/rotate-now", async (req: Request, res: Response) => {
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

  router.post("/api/3xui/test", testLimiter, async (req: Request, res: Response) => {
    try {
      const current = getRotationConfig();
      const testConfig = {
        panelUrl: req.body?.panelUrl || current.panelUrl,
        adminUser: req.body?.adminUser || current.adminUser,
        adminPass:
          req.body?.adminPass !== undefined && req.body.adminPass !== ""
            ? req.body.adminPass
            : current.adminPass,
        inboundRemark: req.body?.inboundRemark || current.inboundRemark,
        timeoutSec: 7,
      };
      const result = await test3xuiConnection(testConfig);
      res.json(result);
    } catch (err: unknown) {
      // Express 4 does not catch async rejections - without this handler an
      // unexpected failure inside the tester would crash the whole process.
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  return router;
}
