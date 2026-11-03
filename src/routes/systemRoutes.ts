import { Router, Request, Response } from "express";
import { readCurrentCredsAsync } from "../rotate.js";
import { getRotationConfig } from "../scheduler.js";
import { getActiveInstances, getProxyConfig } from "../instances.js";
import { getAllProfiles } from "../routing.js";
import { recordAudit, getClientIp, getAuditLogs } from "../audit.js";
import { getActiveProxy } from "../proxies.js";
import { getAppVersion } from "../version.js";
import { isNewerVersion } from "../utils/semver.js";

async function fetchGithubReleasesAtom(owner: string, repo: string, currentVersion: string, proxyUrl?: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const fetchOpts: any = {
      headers: {
        "User-Agent": `CorpProxy-ReleaseChecker/${currentVersion}`,
        Accept: "application/atom+xml, text/xml, */*",
      },
      signal: controller.signal,
    };
    if (proxyUrl) {
      try {
        const { ProxyAgent } = await import("undici");
        fetchOpts.dispatcher = new ProxyAgent(proxyUrl);
      } catch {}
    }
    const atomRes = await fetch(`https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases.atom`, fetchOpts);
    if (!atomRes.ok) return null;
    const xml = await atomRes.text();
    const rawEntries = xml.split("<entry>").slice(1);
    if (!rawEntries.length) return [];
    return rawEntries.map((e, idx) => {
      const titleMatch = e.match(/<title>(.*?)<\/title>/s);
      const updatedMatch = e.match(/<updated>(.*?)<\/updated>/s);
      const linkMatch = e.match(/<link[^>]+href="([^"]+)"/s);
      const idMatch = e.match(/<id>.*?Release\/(\d+)<\/id>/s);
      const title = titleMatch ? titleMatch[1].trim() : "";
      const tagMatch = title.match(/v?\d+\.\d+(\.\d+)?/);
      const tag = tagMatch ? tagMatch[0] : title;
      const cleanVer = tag.replace(/^v/, "");
      return {
        id: idMatch ? parseInt(idMatch[1], 10) : idx + 1,
        name: title,
        tag: tag,
        cleanVersion: cleanVer,
        body: "",
        draft: false,
        prerelease: false,
        htmlUrl: linkMatch ? linkMatch[1] : `https://github.com/${owner}/${repo}/releases`,
        publishedAt: updatedMatch ? updatedMatch[1] : new Date().toISOString(),
        zipballUrl: `https://github.com/${owner}/${repo}/archive/refs/tags/${tag}.zip`,
        tarballUrl: `https://github.com/${owner}/${repo}/archive/refs/tags/${tag}.tar.gz`,
        assets: [],
      };
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function createSystemRouter(options: {
  port: number;
  getFleetToken: () => string;
  defaultFleetToken: string;
  adminTokenConfigured: boolean;
  credsStorePath: string;
}): Router {
  const router = Router();
  const currentVersion = getAppVersion();

  router.get("/healthz", (req: Request, res: Response) => {
    const ip = getClientIp(req);
    recordAudit({ ip, endpoint: "/healthz", status: 200, result: "HEALTH_CHECK" });
    res.json({ ok: true });
  });

  const handleIpEcho = (req: Request, res: Response) => {
    const clientIp = getClientIp(req);
    res.json({
      ip: clientIp,
      clientIp: clientIp,
      note: "Egress IP as observed by the PEC server",
      timestamp: new Date().toISOString(),
    });
  };

  router.get("/api/ip-echo", handleIpEcho);
  router.get("/ip-echo", handleIpEcho);

  router.get("/api/status", async (_req: Request, res: Response) => {
    try {
      const currentCreds = await readCurrentCredsAsync();
      const rotConfig = getRotationConfig();
      const instances = getActiveInstances();
      const profilesList = getAllProfiles();
      const fleetToken = options.getFleetToken();

      res.json({
        app: "Corp Proxy Auth Mini-Server & Extension Studio",
        version: currentVersion,
        status: "online",
        port: options.port,
        tokenConfigured: Boolean(fleetToken),
        fleetDefaultTokenInUse: fleetToken === options.defaultFleetToken,
        adminTokenConfigured: options.adminTokenConfigured,
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  const handleGithubReleases = async (req: Request, res: Response) => {
    const repoParam = (req.query.repo as string) || process.env.UPDATE_CHECK_REPO || "vlv-code/PEC";
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
      const timeout = setTimeout(() => controller.abort(), 8000);
      const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || process.env.ALL_PROXY;

      const fetchHeaders: Record<string, string> = {
        "User-Agent": `CorpProxy-ReleaseChecker/${currentVersion}`,
        Accept: "application/vnd.github.v3+json",
      };
      const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      if (ghToken) {
        fetchHeaders["Authorization"] = `Bearer ${ghToken}`;
      }

      const fetchOpts: any = {
        headers: fetchHeaders,
        signal: controller.signal,
      };

      if (proxyUrl) {
        try {
          const { ProxyAgent } = await import("undici");
          fetchOpts.dispatcher = new ProxyAgent(proxyUrl);
        } catch {}
      }

      let releases: any[] | null = null;
      let apiStatus = 200;
      let apiStatusText = "OK";

      try {
        const ghRes = await fetch(
          `https://api.github.com/repos/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}/releases`,
          fetchOpts
        ).finally(() => clearTimeout(timeout));

        apiStatus = ghRes.status;
        apiStatusText = ghRes.statusText;

        if (ghRes.ok) {
          const rawReleases = await ghRes.json();
          if (Array.isArray(rawReleases)) {
            releases = rawReleases
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
          }
        }
      } catch (apiErr) {
        // Network or timeout reaching GitHub REST API
      }

      // If GitHub REST API was rate limited (403/429) or failed, fall back to public releases.atom feed
      if (!releases) {
        releases = await fetchGithubReleasesAtom(parts[0], parts[1], currentVersion, proxyUrl);
      }

      if (!releases) {
        return res.status(apiStatus && apiStatus !== 200 ? apiStatus : 502).json({
          ok: false,
          repo: repoClean,
          currentVersion,
          error: `GitHub API error: ${apiStatus} ${apiStatusText}`,
        });
      }

      const latestRelease = releases[0] || null;
      const hasUpdate = Boolean(latestRelease && isNewerVersion(latestRelease.cleanVersion, currentVersion));

      res.json({
        ok: true,
        repo: repoClean,
        currentVersion,
        hasUpdate,
        latestRelease,
        releases,
      });
    } catch (err: any) {
      try {
        const parts = repoClean.split("/");
        const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || process.env.ALL_PROXY;
        const atomReleases = await fetchGithubReleasesAtom(parts[0], parts[1], currentVersion, proxyUrl);
        if (atomReleases) {
          const latestRelease = atomReleases[0] || null;
          const hasUpdate = Boolean(latestRelease && isNewerVersion(latestRelease.cleanVersion, currentVersion));
          return res.json({
            ok: true,
            repo: repoClean,
            currentVersion,
            hasUpdate,
            latestRelease,
            releases: atomReleases,
          });
        }
      } catch {}

      res.status(500).json({
        ok: false,
        repo: repoClean,
        currentVersion,
        error: `Network error connecting to GitHub: ${err?.message || err}`,
      });
    }
  };

  router.get("/api/github/releases", handleGithubReleases);
  router.get("/api/releases/github", handleGithubReleases);

  return router;
}

export const createSystemRoutes = createSystemRouter;
