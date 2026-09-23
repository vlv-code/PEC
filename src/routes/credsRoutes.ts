import { Router, Request, Response } from "express";
import { getProxyConfig, registerHeartbeat } from "../instances.js";
import { resolveProfileForInstance, getProfileById, generatePacScript } from "../routing.js";
import { readCurrentCredsAsync } from "../rotate.js";
import { recordAudit, getClientIp, getBaseUrl } from "../audit.js";
import { createRateLimiter, timingSafeEqualString } from "../middleware/security.js";

export function createCredsRouter(getSharedToken: () => string): Router {
  const router = Router();

  const credsLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 60,
    message: "Rate limit exceeded for credentials endpoint.",
  });

  const syncLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 120,
    message: "Rate limit exceeded for extension heartbeat sync.",
  });

  // GET /creds
  router.get("/creds", credsLimiter, async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");

    const clientHost = getClientIp(req);
    const xExtTokenHeader = req.headers["x-ext-token"];
    const xExtToken = Array.isArray(xExtTokenHeader) ? xExtTokenHeader[0] : xExtTokenHeader;
    const token = getSharedToken();

    if (!token || !xExtToken || !timingSafeEqualString(xExtToken, token)) {
      recordAudit({
        ip: clientHost,
        endpoint: "/creds",
        status: 403,
        result: "REJECTED_TOKEN",
        details: "Invalid or missing X-Ext-Token",
      });
      return res.status(403).json({ detail: "Forbidden" });
    }

    const creds = await readCurrentCredsAsync();
    if (!creds) {
      recordAudit({
        ip: clientHost,
        endpoint: "/creds",
        status: 503,
        result: "STORE_ERROR",
        details: "Credentials store unreadable",
      });
      return res.status(503).json({ detail: "Credentials store error" });
    }

    recordAudit({
      ip: clientHost,
      endpoint: "/creds",
      status: 200,
      result: "SERVED",
      details: `Served user: ${creds.user}`,
    });

    return res.json({ user: creds.user, pass: creds.pass });
  });

  // POST /api/sync
  router.post("/api/sync", syncLimiter, async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    const clientHost = getClientIp(req);
    const xExtTokenHeader = req.headers["x-ext-token"];
    const xExtToken = Array.isArray(xExtTokenHeader) ? xExtTokenHeader[0] : xExtTokenHeader;
    const token = getSharedToken();

    if (!token || !xExtToken || !timingSafeEqualString(xExtToken, token)) {
      recordAudit({
        ip: clientHost,
        endpoint: "/api/sync",
        status: 403,
        result: "REJECTED_TOKEN",
        details: "Invalid or missing X-Ext-Token",
      });
      return res.status(403).json({ detail: "Forbidden" });
    }

    const { instanceId, version, extensionId, activeProxyMode, group } = req.body || {};
    const currentCreds = await readCurrentCredsAsync();
    const proxyConfig = getProxyConfig();

    let assignedProfile = resolveProfileForInstance(instanceId, group);

    if (instanceId) {
      try {
        const inst = registerHeartbeat({
          instanceId: String(instanceId),
          ip: clientHost,
          version: String(version || "1.0.0"),
          extensionId: extensionId ? String(extensionId) : undefined,
          userAgent: req.headers["user-agent"],
          activeProxyMode: activeProxyMode ? String(activeProxyMode) : undefined,
          group: group ? String(group) : undefined,
        });
        if (inst.assignedProfileId) {
          const p = getProfileById(inst.assignedProfileId);
          if (p) assignedProfile = p;
        }
      } catch (err) {
        console.warn("[sync] Heartbeat register warning:", err);
      }
    }

    // Generate tailored PAC URL for this instance or profile
    const pacUrl = `${getBaseUrl(req)}/proxy.pac?profileId=${assignedProfile.id}`;

    recordAudit({
      ip: clientHost,
      endpoint: "/api/sync",
      status: 200,
      result: "SYNCED",
      details: `Instance: ${instanceId || "anon"}, Profile: ${assignedProfile.name}`,
    });

    return res.json({
      ok: true,
      serverTime: new Date().toISOString(),
      creds: currentCreds ? { user: currentCreds.user, pass: currentCreds.pass } : null,
      profileId: assignedProfile.id,
      profileName: assignedProfile.name,
      config: {
        ...proxyConfig,
        pacUrl,
      },
    });
  });

  // GET /proxy.pac
  router.get("/proxy.pac", (req: Request, res: Response) => {
    const proxyConfig = getProxyConfig();
    const profileId = typeof req.query.profileId === "string" ? req.query.profileId : undefined;
    const instanceId = typeof req.query.instanceId === "string" ? req.query.instanceId : undefined;
    const group = typeof req.query.group === "string" ? req.query.group : undefined;

    let profile = profileId ? getProfileById(profileId) : undefined;
    if (!profile) {
      profile = resolveProfileForInstance(instanceId, group);
    }

    const pacContent = generatePacScript(profile, proxyConfig);
    res.setHeader("Content-Type", "application/x-ns-proxy-autoconfig");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.send(pacContent);
  });

  return router;
}
