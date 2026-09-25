import { Router, Request, Response } from "express";
import {
  getAllProxies,
  getProxyById,
  createProxy,
  updateProxy,
  deleteProxy,
  setActiveProxy,
} from "../proxies.js";
import { getRotationConfig } from "../scheduler.js";
import { sync3xuiInboundByTag } from "../rotate.js";
import { recordAudit, getClientIp } from "../audit.js";
import { ProxyNode } from "../types.js";

function maskPassword<T extends { password?: string }>(node: T): T {
  return {
    ...node,
    password: node.password ? "********" : "",
  };
}

export function createProxiesRouter(): Router {
  const router = Router();

  // GET /api/proxies - list all proxies (passwords masked)
  router.get("/api/proxies", (_req: Request, res: Response) => {
    res.json(getAllProxies(true));
  });

  // POST /api/proxies - create manual or 3x-ui proxy
  router.post("/api/proxies", async (req: Request, res: Response) => {
    try {
      const { type, tag, name, protocol, host, port, username, password, isActive } = req.body || {};

      if (type !== undefined && type !== "manual" && type !== "3x-ui") {
        return res.status(400).json({ error: "Invalid proxy type: must be 'manual' or '3x-ui'" });
      }

      if (type === "3x-ui") {
        if (!tag || typeof tag !== "string" || !tag.trim()) {
          return res.status(400).json({ error: "tag is required for 3x-ui proxy" });
        }

        const rotConfig = getRotationConfig();
        if (!rotConfig.panelUrl) {
          return res.status(400).json({ error: "3x-ui panel URL is not configured in rotation settings" });
        }

        const syncResult = await sync3xuiInboundByTag({
          panelUrl: rotConfig.panelUrl,
          adminUser: rotConfig.adminUser,
          adminPass: rotConfig.adminPass,
          tag: tag.trim(),
          rotatePassword: false,
        });

        if (!syncResult.ok) {
          return res.status(400).json({ error: syncResult.message || "Failed to sync inbound from 3x-ui" });
        }

        let finalHost = host ? String(host).trim() : "";
        if (!finalHost) {
          try {
            finalHost = new URL(rotConfig.panelUrl).hostname;
          } catch {
            finalHost = "127.0.0.1";
          }
        }

        const created = createProxy({
          tag: tag.trim(),
          name: name ? String(name).trim() : syncResult.remark || tag.trim(),
          type: "3x-ui",
          protocol: syncResult.protocol || "socks5",
          host: finalHost,
          port: syncResult.port || 10808,
          username: syncResult.username,
          password: syncResult.password,
          isActive: isActive !== undefined ? Boolean(isActive) : undefined,
          lastSync: new Date().toISOString(),
          status: "OK",
        });

        recordAudit({
          ip: getClientIp(req),
          endpoint: "/api/proxies",
          status: 201,
          result: "PROXY_CREATED",
          details: `Created 3x-ui proxy: ${created.tag} (${created.protocol}://${created.host}:${created.port})`,
        });

        return res.status(201).json(maskPassword(created));
      } else {
        // manual proxy
        if (!tag || !protocol || !host || port === undefined || port === null || port === "") {
          return res.status(400).json({ error: "tag, protocol, host, and port are required for manual proxy" });
        }

        const created = createProxy({
          tag: String(tag).trim(),
          name: name ? String(name).trim() : undefined,
          type: "manual",
          protocol,
          host: String(host).trim(),
          port,
          username: username !== undefined ? String(username) : undefined,
          password: password !== undefined ? String(password) : undefined,
          isActive: isActive !== undefined ? Boolean(isActive) : undefined,
        });

        recordAudit({
          ip: getClientIp(req),
          endpoint: "/api/proxies",
          status: 201,
          result: "PROXY_CREATED",
          details: `Created manual proxy: ${created.tag} (${created.protocol}://${created.host}:${created.port})`,
        });

        return res.status(201).json(maskPassword(created));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(400).json({ error: msg });
    }
  });

  // PUT /api/proxies/:id - update existing proxy
  router.put("/api/proxies/:id", (req: Request, res: Response) => {
    try {
      const updated = updateProxy(req.params.id, req.body);
      recordAudit({
        ip: getClientIp(req),
        endpoint: `/api/proxies/${req.params.id}`,
        status: 200,
        result: "PROXY_UPDATED",
        details: `Updated proxy: ${updated.tag} (${updated.id})`,
      });
      return res.json(maskPassword(updated));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Proxy not found")) {
        return res.status(404).json({ error: msg });
      }
      return res.status(400).json({ error: msg });
    }
  });

  // DELETE /api/proxies/:id - delete proxy
  router.delete("/api/proxies/:id", (req: Request, res: Response) => {
    const removed = deleteProxy(req.params.id);
    if (removed) {
      recordAudit({
        ip: getClientIp(req),
        endpoint: `/api/proxies/${req.params.id}`,
        status: 200,
        result: "PROXY_DELETED",
        details: `Deleted proxy: ${req.params.id}`,
      });
    }
    return res.json({ ok: true, removed });
  });

  // POST /api/proxies/:id/activate - activate proxy
  router.post("/api/proxies/:id/activate", (req: Request, res: Response) => {
    try {
      const activated = setActiveProxy(req.params.id);
      recordAudit({
        ip: getClientIp(req),
        endpoint: `/api/proxies/${req.params.id}/activate`,
        status: 200,
        result: "PROXY_ACTIVATED",
        details: `Activated proxy: ${activated.tag} (${activated.id})`,
      });
      return res.json({ ok: true, activeProxy: maskPassword(activated) });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Proxy not found")) {
        return res.status(404).json({ error: msg });
      }
      return res.status(400).json({ error: msg });
    }
  });

  // POST /api/proxies/:id/sync - sync 3x-ui proxy inbound
  router.post("/api/proxies/:id/sync", async (req: Request, res: Response) => {
    try {
      const proxy = getProxyById(req.params.id);
      if (!proxy) {
        return res.status(404).json({ error: "Proxy not found" });
      }
      if (proxy.type !== "3x-ui") {
        return res.status(400).json({ error: "Only 3x-ui proxy nodes can be synced" });
      }

      const rotConfig = getRotationConfig();
      if (!rotConfig.panelUrl) {
        return res.status(400).json({ error: "3x-ui panel URL is not configured in rotation settings" });
      }

      const rotatePassword =
        req.body?.rotatePassword !== undefined ? Boolean(req.body.rotatePassword) : true;

      const syncResult = await sync3xuiInboundByTag({
        panelUrl: rotConfig.panelUrl,
        adminUser: rotConfig.adminUser,
        adminPass: rotConfig.adminPass,
        tag: proxy.tag,
        rotatePassword,
      });

      if (!syncResult.ok) {
        updateProxy(proxy.id, {
          status: "ERROR",
          errorMessage: syncResult.message,
          lastSync: new Date().toISOString(),
        });
        return res.status(400).json({ ok: false, error: syncResult.message });
      }

      const updates: Partial<ProxyNode> = {
        status: "OK",
        errorMessage: undefined,
        lastSync: new Date().toISOString(),
      };
      if (syncResult.password !== undefined) updates.password = syncResult.password;
      if (syncResult.username !== undefined) updates.username = syncResult.username;
      if (syncResult.port !== undefined) updates.port = syncResult.port;
      if (syncResult.protocol !== undefined) updates.protocol = syncResult.protocol;

      const updated = updateProxy(proxy.id, updates);

      return res.json({
        ok: true,
        proxy: maskPassword(updated),
        message: syncResult.message || "Proxy synchronized successfully",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ ok: false, error: msg });
    }
  });

  // POST /api/3xui/inbound-lookup - lookup inbound details by tag
  router.post("/api/3xui/inbound-lookup", async (req: Request, res: Response) => {
    try {
      const tag = req.body?.tag;
      if (!tag || typeof tag !== "string" || !tag.trim()) {
        return res.status(400).json({ error: "tag is required" });
      }

      const rotConfig = getRotationConfig();
      if (!rotConfig.panelUrl) {
        return res.status(400).json({ error: "3x-ui panel URL is not configured in rotation settings" });
      }

      const syncResult = await sync3xuiInboundByTag({
        panelUrl: rotConfig.panelUrl,
        adminUser: rotConfig.adminUser,
        adminPass: rotConfig.adminPass,
        tag: tag.trim(),
        rotatePassword: false,
      });

      if (!syncResult.ok) {
        return res.status(400).json({ ok: false, error: syncResult.message });
      }

      return res.json({
        ok: true,
        inbound: {
          tag: syncResult.tag || tag.trim(),
          protocol: syncResult.protocol,
          port: syncResult.port,
          username: syncResult.username,
          hasPassword: Boolean(syncResult.password),
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ ok: false, error: msg });
    }
  });

  return router;
}
