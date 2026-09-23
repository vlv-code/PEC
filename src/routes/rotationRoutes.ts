import { Router, Request, Response } from "express";
import {
  getRotationConfig,
  getRotationConfigPublic,
  getRotationHistory,
  updateRotationConfig,
  runManualRotation,
} from "../scheduler.js";
import { test3xuiConnection } from "../rotate.js";
import { recordAudit, getClientIp } from "../audit.js";
import { createRateLimiter } from "../middleware/security.js";

export function createRotationRouter(): Router {
  const router = Router();

  const testLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 15,
    message: "Rate limit exceeded for 3x-ui connection test.",
  });

  router.get("/api/rotation/config", (_req: Request, res: Response) => {
    res.json({
      config: getRotationConfigPublic(),
      history: getRotationHistory().slice(0, 10),
    });
  });

  router.post("/api/rotation/config", (req: Request, res: Response) => {
    const updated = updateRotationConfig(req.body);
    res.json(updated);
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

  return router;
}
