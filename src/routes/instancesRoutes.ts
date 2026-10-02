import { Router, Request, Response } from "express";
import { getActiveInstances, assignInstanceProfile, assignInstanceProxy, deleteInstance, revokeInstanceToken, getProxyConfig, updateProxyConfig } from "../instances.js";
import { getProxyById } from "../proxies.js";
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

  router.post("/api/instances/assign-proxy", (req: Request, res: Response) => {
    const { instanceId, proxyId } = req.body || {};
    if (!instanceId) {
      return res.status(400).json({ error: "instanceId is required" });
    }
    try {
      let cleanProxyId: string | undefined = undefined;
      if (proxyId !== undefined && proxyId !== null) {
        const trimmed = String(proxyId).trim();
        if (trimmed !== "" && trimmed !== "default") {
          const node = getProxyById(trimmed);
          if (!node) {
            return res.status(400).json({ error: "Proxy node not found" });
          }
          cleanProxyId = node.id;
        }
      }
      assignInstanceProxy(String(instanceId), cleanProxyId);
      recordAudit({
        ip: getClientIp(req),
        endpoint: "/api/instances/assign-proxy",
        status: 200,
        result: "CONFIG_UPDATED",
        details: `Assigned proxy ${cleanProxyId || "default"} to instance ${instanceId}`,
      });
      res.json({ ok: true, instanceId: String(instanceId), assignedProxyId: cleanProxyId || null });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
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

  router.post("/api/instances/:id/revoke-token", (req: Request, res: Response) => {
    const revoked = revokeInstanceToken(req.params.id);
    recordAudit({
      ip: getClientIp(req),
      endpoint: "/api/instances/:id/revoke-token",
      status: 200,
      result: "CONFIG_UPDATED",
      details: `Instance ${req.params.id} token revoked: ${revoked}`,
    });
    res.json({ ok: true, revoked });
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
