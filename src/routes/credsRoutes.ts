import express, { Router, Request, Response } from "express";
import { getProxyConfig, registerHeartbeat } from "../instances.js";
import { probeProxyTcp } from "../proxies.js";
import { resolveProfileForInstance, getProfileById, generatePacScript } from "../routing.js";
import { readCurrentCredsAsync } from "../rotate.js";
import { getBuildConfig } from "../packager.js";
import { recordAudit, getClientIp, getBaseUrl } from "../audit.js";
import { createRateLimiter, timingSafeEqualString } from "../middleware/security.js";
import { signPacUrlParams, verifyPacUrlParams } from "../pacSigner.js";

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
  router.post("/api/sync", express.json({ limit: "16kb" }), syncLimiter, async (req: Request, res: Response) => {
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

    // Generate tailored PAC URL for this instance or profile (HMAC signed)
    const pacSecret = process.env.PAC_SIGNING_SECRET || getSharedToken() || "pec-pac-secret";
    const { exp, sig } = signPacUrlParams(assignedProfile.id, pacSecret, 86400);
    const pacUrl = `${getBaseUrl(req)}/proxy.pac?profileId=${encodeURIComponent(assignedProfile.id)}&exp=${exp}&sig=${sig}`;

    recordAudit({
      ip: clientHost,
      endpoint: "/api/sync",
      status: 200,
      result: "SYNCED",
      details: `Instance: ${instanceId || "anon"}, Profile: ${assignedProfile.name}`,
    });

    const probeTimeout = process.env.NODE_ENV === "test" ? 300 : 1500;
    const proxyReachable = await probeProxyTcp(proxyConfig.host, proxyConfig.port, probeTimeout);

    const bldCfg = getBuildConfig();
    return res.json({
      ok: true,
      serverTime: new Date().toISOString(),
      creds: currentCreds ? { user: currentCreds.user, pass: currentCreds.pass } : null,
      profileId: assignedProfile.id,
      profileName: assignedProfile.name,
      profileDefaultPolicy: assignedProfile.defaultPolicy || "direct",
      proxyReachable,
      uiLayout: bldCfg.uiLayout || "console",
      colorPalette: bldCfg.colorPalette || "cyber",
      config: {
        ...proxyConfig,
        pacUrl,
        uiLayout: bldCfg.uiLayout || "console",
        colorPalette: bldCfg.colorPalette || "cyber",
      },
    });
  });

  // GET /proxy.pac
  router.get("/proxy.pac", (req: Request, res: Response) => {
    const clientHost = getClientIp(req);
    const proxyConfig = getProxyConfig();
    const profileId = typeof req.query.profileId === "string" ? req.query.profileId : undefined;
    const instanceId = typeof req.query.instanceId === "string" ? req.query.instanceId : undefined;
    const group = typeof req.query.group === "string" ? req.query.group : undefined;

    let profile = profileId ? getProfileById(profileId) : undefined;
    if (!profile) {
      profile = resolveProfileForInstance(instanceId, group);
    }

    const requireSig = process.env.PAC_REQUIRE_SIGNATURE === "1" || process.env.PAC_REQUIRE_SIGNATURE === "true";
    if (requireSig) {
      const expParam = typeof req.query.exp === "string" ? req.query.exp : "";
      const sigParam = typeof req.query.sig === "string" ? req.query.sig : "";
      const effectiveProfileId = profile?.id || profileId || "";
      const pacSecret = process.env.PAC_SIGNING_SECRET || getSharedToken() || "pec-pac-secret";
      const verifyResult = verifyPacUrlParams(effectiveProfileId, expParam, sigParam, pacSecret);
      if (!verifyResult.valid) {
        recordAudit({
          ip: clientHost,
          endpoint: "/proxy.pac",
          status: 403,
          result: "REJECTED_TOKEN",
          details: `PAC signature rejected: ${verifyResult.reason}`,
        });
        return res.status(403).json({ ok: false, error: `PAC signature verification failed: ${verifyResult.reason}` });
      }
    }

    const pacContent = generatePacScript(profile, proxyConfig);
    res.setHeader("Content-Type", "application/x-ns-proxy-autoconfig");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.send(pacContent);
  });

  return router;
}
