import { Router, Request, Response } from "express";
import { readCurrentCreds } from "../rotate.js";
import { getRotationConfig } from "../scheduler.js";
import { getActiveInstances, getProxyConfig } from "../instances.js";
import { getAllProfiles } from "../routing.js";
import { recordAudit, getClientIp, getAuditLogs } from "../audit.js";

export function createSystemRouter(options: {
  port: number;
  getSharedToken: () => string;
  defaultToken: string;
  credsStorePath: string;
}): Router {
  const router = Router();
  const currentVersion = "1.3.0";

  router.get("/healthz", (req: Request, res: Response) => {
    const ip = getClientIp(req);
    recordAudit({ ip, endpoint: "/healthz", status: 200, result: "HEALTH_CHECK" });
    res.json({ ok: true });
  });

  router.get("/api/ip-echo", (req: Request, res: Response) => {
    res.json({
      ip: getClientIp(req),
      note: "Egress IP as observed by the PEC server",
      timestamp: new Date().toISOString(),
    });
  });

  router.get("/api/status", (_req: Request, res: Response) => {
    const currentCreds = readCurrentCreds();
    const rotConfig = getRotationConfig();
    const instances = getActiveInstances();
    const profilesList = getAllProfiles();
    const token = options.getSharedToken();

    res.json({
      app: "Corp Proxy Auth Mini-Server & Extension Studio",
      version: currentVersion,
      status: "online",
      port: options.port,
      tokenConfigured: Boolean(token),
      defaultTokenInUse: token === options.defaultToken,
      credsStorePath: options.credsStorePath,
      currentUser: currentCreds?.user || "none",
      credsUpdatedAt: currentCreds?.updatedAt || null,
      activeInstancesCount: instances.filter((i) => i.status === "ONLINE").length,
      totalInstancesCount: instances.length,
      profilesCount: profilesList.length,
      killSwitch: getProxyConfig().killSwitch || false,
      nextRotationAt: rotConfig.nextRotationAt || null,
      rotationIntervalMinutes: rotConfig.intervalMinutes,
      rotationEnabled: rotConfig.enabled,
      auditLogs: getAuditLogs().slice(0, 20),
    });
  });

  router.get("/api/github/releases", async (req: Request, res: Response) => {
    const repoParam = (req.query.repo as string) || "balukabalukasa/pec-proxy-corp";
    const repoClean = repoParam.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").trim();

    try {
      // Strict repo format validation (owner/repo)
      if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repoClean)) {
        return res.status(400).json({
          ok: false,
          repo: repoClean,
          currentVersion,
          error: "Invalid repository format. Please specify 'owner/repo'.",
        });
      }

      const parts = repoClean.split("/");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const ghRes = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}/releases`,
        {
          headers: {
            "User-Agent": `CorpProxy-ReleaseChecker/${currentVersion}`,
            Accept: "application/vnd.github.v3+json",
          },
          signal: controller.signal,
        }
      ).finally(() => clearTimeout(timeout));

      if (!ghRes.ok) {
        const errText = await ghRes.text();
        return res.status(ghRes.status).json({
          ok: false,
          repo: repoClean,
          currentVersion,
          error: `GitHub API error: ${ghRes.status} ${ghRes.statusText}`,
          details: errText.slice(0, 200),
        });
      }

      const rawReleases = await ghRes.json();
      if (!Array.isArray(rawReleases)) {
        return res.json({
          ok: true,
          repo: repoClean,
          currentVersion,
          hasUpdate: false,
          releases: [],
          latestRelease: null,
        });
      }

      const releases = rawReleases
        .map((r: any) => {
          const tag = r.tag_name || "";
          const cleanVer = tag.replace(/^v/, "");
          return {
            id: r.id,
            name: r.name || tag,
            tag: tag,
            cleanVersion: cleanVer,
            body: r.body || "",
            draft: Boolean(r.draft),
            prerelease: Boolean(r.prerelease),
            htmlUrl: r.html_url,
            publishedAt: r.published_at || r.created_at,
            zipballUrl: r.zipball_url,
            tarballUrl: r.tarball_url,
            assets: (r.assets || []).map((a: any) => ({
              name: a.name,
              size: a.size,
              downloadUrl: a.browser_download_url,
            })),
          };
        })
        .filter((r) => !r.draft);

      const latestRelease = releases[0] || null;
      let hasUpdate = false;
      if (latestRelease) {
        const latestVer = latestRelease.cleanVersion;
        const [lMaj = 0, lMin = 0, lPat = 0] = latestVer.split(".").map((n: string) => parseInt(n, 10) || 0);
        const [cMaj = 0, cMin = 0, cPat = 0] = currentVersion.split(".").map((n: string) => parseInt(n, 10) || 0);
        if (lMaj > cMaj || (lMaj === cMaj && lMin > cMin) || (lMaj === cMaj && lMin === cMin && lPat > cPat)) {
          hasUpdate = true;
        }
      }

      res.json({
        ok: true,
        repo: repoClean,
        currentVersion,
        hasUpdate,
        latestRelease,
        releases,
      });
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        repo: repoClean,
        currentVersion,
        error: `Network error connecting to GitHub: ${err?.message || err}`,
      });
    }
  });

  return router;
}
