import { Router, Request, Response } from "express";
import { getActiveInstances, assignInstanceProfile, deleteInstance, getProxyConfig, updateProxyConfig } from "../instances.js";
import { recordAudit, getClientIp } from "../audit.js";

export function createInstancesRouter(): Router {
  const router = Router();

  router.get("/api/instances", (_req: Request, res: Response) => {
    const list = getActiveInstances();
    res.json({
      total: list.length,
      online: list.filter((i) => i.status === "ONLINE").length,
      instances: list,
    });
  });

  router.post("/api/instances/assign-profile", (req: Request, res: Response) => {
    const { instanceId, profileId, group } = req.body || {};
    if (!instanceId) {
      return res.status(400).json({ error: "instanceId is required" });
    }
    try {
      assignInstanceProfile(
        String(instanceId),
        profileId ? String(profileId) : undefined,
        group ? String(group) : undefined
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(400).json({ error: msg });
    }
    res.json({ ok: true });
  });

  router.delete("/api/instances/:id", (req: Request, res: Response) => {
    const removed = deleteInstance(req.params.id);
    recordAudit({
      ip: getClientIp(req),
      endpoint: "/api/instances/:id",
      status: 200,
      result: "CONFIG_UPDATED",
      details: `Instance ${req.params.id} ${removed ? "removed" : "not found (no-op)"}`,
    });
    res.json({ ok: true, removed });
  });

  router.get("/api/config", (_req: Request, res: Response) => {
    res.json(getProxyConfig());
  });

  router.post("/api/config", (req: Request, res: Response) => {
    try {
      const updated = updateProxyConfig(req.body);
      recordAudit({
        ip: getClientIp(req),
        endpoint: "/api/config",
        status: 200,
        result: "CONFIG_UPDATED",
        details: `Protocol: ${updated.protocol}, Host: ${updated.host}:${updated.port}, Enabled: ${updated.enabled}`,
      });
      res.json(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  return router;
}
