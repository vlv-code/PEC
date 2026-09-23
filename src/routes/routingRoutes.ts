import { Router, Request, Response } from "express";
import { GEO_PRESETS, getAllProfiles, saveProfile, deleteProfile } from "../routing.js";
import { recordAudit, getClientIp } from "../audit.js";

export function createRoutingRouter(): Router {
  const router = Router();

  router.get("/api/routing/presets", (_req: Request, res: Response) => {
    res.json(GEO_PRESETS);
  });

  router.get("/api/routing/profiles", (_req: Request, res: Response) => {
    res.json(getAllProfiles());
  });

  router.post("/api/routing/profiles", (req: Request, res: Response) => {
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

  router.delete("/api/routing/profiles/:id", (req: Request, res: Response) => {
    try {
      const ok = deleteProfile(req.params.id);
      res.json({ ok });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  return router;
}
