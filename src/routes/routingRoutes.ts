import crypto from "node:crypto";
import { Router, Request, Response } from "express";
import { GEO_PRESETS, getAllProfiles, saveProfile, deleteProfile } from "../routing.js";
import { getRoutingPresets, saveRoutingPresets } from "../storage.js";
import { RoutingPresetItem } from "../types.js";
import { parseGeoSite, parseGeoIp, parsePlaintextList } from "../geodata/datParser.js";
import { validateSafeEndpointUrl } from "../rotate.js";
import { recordAudit, getClientIp } from "../audit.js";

async function downloadBodyWithLimit(response: globalThis.Response, maxSize: number): Promise<Buffer> {
  const clHeader = response.headers.get("content-length");
  if (clHeader) {
    const cl = parseInt(clHeader, 10);
    if (!isNaN(cl) && cl > maxSize) {
      throw new Error(`Downloaded file exceeds limit of ${Math.round(maxSize / (1024 * 1024))}MB`);
    }
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const ab = await response.arrayBuffer();
    const buf = Buffer.from(ab);
    if (buf.length > maxSize) {
      throw new Error(`Downloaded file exceeds limit of ${Math.round(maxSize / (1024 * 1024))}MB`);
    }
    return buf;
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      totalBytes += value.length;
      if (totalBytes > maxSize) {
        try { reader.cancel(); } catch {}
        throw new Error(`Downloaded file exceeds limit of ${Math.round(maxSize / (1024 * 1024))}MB`);
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks);
}

function parseGeodataBuffer(
  buffer: Buffer,
  filenameOrUrl: string,
  requestedType?: "domain" | "cidr",
  tag?: string
): { entries: string[]; inferredType: "domain" | "cidr" } {
  const lowerName = filenameOrUrl.toLowerCase();
  const isDat = lowerName.endsWith(".dat") || buffer.includes(0x00);
  const targetTag = (tag || "RU").toUpperCase();

  if (isDat) {
    if (requestedType === "cidr" || lowerName.includes("geoip")) {
      const ipMap = parseGeoIp(buffer);
      const entry = ipMap.get(targetTag);
      if (!entry) {
        throw new Error(`Tag '${targetTag}' not found in GeoIP file`);
      }
      const entries = entry.cidrs.map((c) => `${c.ip}/${c.prefix}`);
      return { entries, inferredType: "cidr" };
    } else {
      const siteMap = parseGeoSite(buffer);
      const entry = siteMap.get(targetTag);
      if (!entry) {
        throw new Error(`Tag '${targetTag}' not found in GeoSite file`);
      }
      const entries = entry.domains.map((d) => d.value);
      return { entries, inferredType: "domain" };
    }
  } else {
    const text = buffer.toString("utf-8");
    const entries = parsePlaintextList(text);
    const inferredType = requestedType || (entries.some((e) => e.includes("/")) ? "cidr" : "domain");
    return { entries, inferredType };
  }
}

export function createRoutingRouter(): Router {
  const router = Router();

  // Presets CRUD
  router.get("/api/routing/presets", (_req: Request, res: Response) => {
    const presets = getRoutingPresets();
    const result = presets.map((p) => {
      const entries = p.entries || p.domains || [];
      return {
        ...p,
        entries,
        entriesCount: entries.length,
      };
    });
    res.json(result);
  });

  router.get("/api/routing/presets/:id", (req: Request, res: Response) => {
    const presets = getRoutingPresets();
    const preset = presets.find((p) => p.id === req.params.id);
    if (!preset) {
      return res.status(404).json({ error: "Preset not found" });
    }
    const entries = preset.entries || preset.domains || [];
    res.json({
      ...preset,
      entries,
      entriesCount: entries.length,
    });
  });

  router.post("/api/routing/presets", (req: Request, res: Response) => {
    try {
      const { id, name, category, description, type, source, entries, domains } = req.body;
      if (!id || typeof id !== "string" || !id.trim()) {
        return res.status(400).json({ error: "id is required" });
      }
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "name is required" });
      }
      const rawEntries = entries !== undefined ? entries : domains;
      if (rawEntries === undefined || rawEntries === null) {
        return res.status(400).json({ error: "entries are required" });
      }
      let cleanEntries: string[] = [];
      if (Array.isArray(rawEntries)) {
        cleanEntries = rawEntries.map(String).map((s) => s.trim()).filter(Boolean);
      } else if (typeof rawEntries === "string") {
        cleanEntries = parsePlaintextList(rawEntries);
      }
      if (cleanEntries.length === 0) {
        return res.status(400).json({ error: "entries cannot be empty" });
      }

      const cleanId = id.trim();
      const presets = getRoutingPresets();
      const existingIdx = presets.findIndex((p) => p.id === cleanId);
      if (
        (existingIdx >= 0 && presets[existingIdx].source === "builtin") ||
        GEO_PRESETS.some((gp) => gp.id === cleanId)
      ) {
        return res.status(400).json({ error: "Cannot overwrite builtin preset" });
      }

      const presetItem: RoutingPresetItem = {
        id: cleanId,
        name: name.trim(),
        category: category || (existingIdx >= 0 ? presets[existingIdx].category : "custom"),
        description:
          description !== undefined
            ? String(description).trim()
            : existingIdx >= 0
              ? presets[existingIdx].description
              : "",
        type: type === "cidr" ? "cidr" : "domain",
        source: source || (existingIdx >= 0 ? presets[existingIdx].source : "file"),
        sourceUrl: req.body.sourceUrl || (existingIdx >= 0 ? presets[existingIdx].sourceUrl : undefined),
        sourceTag: req.body.sourceTag || (existingIdx >= 0 ? presets[existingIdx].sourceTag : undefined),
        lastUpdated: new Date().toISOString(),
        entries: cleanEntries,
        domains: cleanEntries,
      };

      if (existingIdx >= 0) {
        presets[existingIdx] = presetItem;
      } else {
        presets.push(presetItem);
      }
      saveRoutingPresets(presets);

      recordAudit({
        ip: getClientIp(req),
        endpoint: "/api/routing/presets",
        status: 200,
        result: "CONFIG_UPDATED",
        details: `Preset: ${presetItem.name} (${presetItem.id}, ${cleanEntries.length} entries)`,
      });

      res.json({ ok: true, preset: { ...presetItem, entriesCount: cleanEntries.length } });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  router.delete("/api/routing/presets/:id", (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      const presets = getRoutingPresets();
      const idx = presets.findIndex((p) => p.id === id);
      if (idx < 0) {
        return res.status(404).json({ error: "Preset not found" });
      }
      const target = presets[idx];
      if (target.source === "builtin" || GEO_PRESETS.some((gp) => gp.id === id)) {
        return res.status(400).json({ error: "Cannot delete builtin preset" });
      }
      presets.splice(idx, 1);
      saveRoutingPresets(presets);

      recordAudit({
        ip: getClientIp(req),
        endpoint: `/api/routing/presets/${id}`,
        status: 200,
        result: "CONFIG_UPDATED",
        details: `Deleted preset: ${target.name} (${target.id})`,
      });

      res.json({ ok: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  router.post("/api/routing/presets/import-url", async (req: Request, res: Response) => {
    try {
      const { url, tag, name, description, type } = req.body;
      if (!url || typeof url !== "string" || !url.trim()) {
        return res.status(400).json({ error: "url is required" });
      }

      const safeCheck = validateSafeEndpointUrl(url.trim());
      if (!safeCheck.valid) {
        return res.status(400).json({ error: "SSRF validation failed: target is forbidden" });
      }

      let response: globalThis.Response;
      try {
        response = await fetch(url.trim(), {
          redirect: "manual",
          signal: AbortSignal.timeout(10000),
        });
      } catch (fetchErr: any) {
        return res.status(400).json({ error: `Failed to fetch URL: ${fetchErr?.message || fetchErr}` });
      }

      if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
        return res.status(400).json({ error: "HTTP redirects are forbidden for security reasons" });
      }

      if (!response.ok) {
        return res.status(400).json({ error: `Remote server returned HTTP ${response.status}` });
      }

      const MAX_SIZE = 20 * 1024 * 1024; // 20MB
      const buffer = await downloadBodyWithLimit(response, MAX_SIZE);

      const { entries, inferredType } = parseGeodataBuffer(buffer, url, type, tag);
      let parsedUrlPath = "";
      try {
        parsedUrlPath = new URL(url).pathname.split("/").pop() || "";
      } catch {
        // ignore
      }
      const cleanName = name || (tag ? `GeoData ${tag}` : parsedUrlPath || "Imported Preset");
      const id = req.body.id || `preset:${crypto.randomBytes(4).toString("hex")}`;

      const preset: RoutingPresetItem = {
        id,
        name: cleanName,
        category: req.body.category || "custom",
        description: description || `Imported from ${url}`,
        type: type || inferredType,
        source: "remote",
        sourceUrl: url.trim(),
        sourceTag: tag,
        lastUpdated: new Date().toISOString(),
        entries,
        domains: entries,
      };

      const presets = getRoutingPresets();
      const existingIdx = presets.findIndex((p) => p.id === preset.id);
      if (existingIdx >= 0) {
        presets[existingIdx] = preset;
      } else {
        presets.push(preset);
      }
      saveRoutingPresets(presets);

      recordAudit({
        ip: getClientIp(req),
        endpoint: "/api/routing/presets/import-url",
        status: 200,
        result: "CONFIG_UPDATED",
        details: `Imported ${entries.length} entries from ${url} as ${preset.name}`,
      });

      res.json({ ok: true, preset: { ...preset, entriesCount: entries.length } });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  router.post("/api/routing/presets/import-file", (req: Request, res: Response) => {
    try {
      const { filename, content, tag, name, description, type } = req.body;
      if (!filename || typeof filename !== "string") {
        return res.status(400).json({ error: "filename is required" });
      }
      if (content === undefined || content === null) {
        return res.status(400).json({ error: "content is required" });
      }

      let buf: Buffer;
      if (filename.toLowerCase().endsWith(".dat")) {
        buf = Buffer.from(content, "base64");
      } else {
        const contentStr = String(content);
        if (
          !contentStr.includes("\n") &&
          !contentStr.includes("\r") &&
          /^[A-Za-z0-9+/=]+$/.test(contentStr.trim()) &&
          contentStr.trim().length > 16
        ) {
          try {
            const decoded = Buffer.from(contentStr, "base64");
            const decodedStr = decoded.toString("utf-8");
            if (decodedStr.includes("\n") || decodedStr.includes(".")) {
              buf = decoded;
            } else {
              buf = Buffer.from(contentStr, "utf-8");
            }
          } catch {
            buf = Buffer.from(contentStr, "utf-8");
          }
        } else {
          buf = Buffer.from(contentStr, "utf-8");
        }
      }

      const { entries, inferredType } = parseGeodataBuffer(buf, filename, type, tag);
      const cleanName = name || filename;
      const id = req.body.id || `preset:${crypto.randomBytes(4).toString("hex")}`;

      const preset: RoutingPresetItem = {
        id,
        name: cleanName,
        category: req.body.category || "custom",
        description: description || `Imported from ${filename}`,
        type: type || inferredType,
        source: "file",
        sourceTag: tag,
        lastUpdated: new Date().toISOString(),
        entries,
        domains: entries,
      };

      const presets = getRoutingPresets();
      const existingIdx = presets.findIndex((p) => p.id === preset.id);
      if (existingIdx >= 0) {
        presets[existingIdx] = preset;
      } else {
        presets.push(preset);
      }
      saveRoutingPresets(presets);

      recordAudit({
        ip: getClientIp(req),
        endpoint: "/api/routing/presets/import-file",
        status: 200,
        result: "CONFIG_UPDATED",
        details: `Imported ${entries.length} entries from file ${filename} as ${preset.name}`,
      });

      res.json({ ok: true, preset: { ...preset, entriesCount: entries.length } });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  router.post("/api/routing/presets/:id/refresh", async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      const presets = getRoutingPresets();
      const preset = presets.find((p) => p.id === id);
      if (!preset) {
        return res.status(404).json({ error: "Preset not found" });
      }
      if (!preset.sourceUrl) {
        return res.status(400).json({ error: "Preset has no sourceUrl to refresh" });
      }

      const safeCheck = validateSafeEndpointUrl(preset.sourceUrl);
      if (!safeCheck.valid) {
        return res.status(400).json({ error: "SSRF validation failed: target is forbidden" });
      }

      let response: globalThis.Response;
      try {
        response = await fetch(preset.sourceUrl, {
          redirect: "manual",
          signal: AbortSignal.timeout(10000),
        });
      } catch (fetchErr: any) {
        return res.status(400).json({ error: `Failed to refresh URL: ${fetchErr?.message || fetchErr}` });
      }

      if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
        return res.status(400).json({ error: "HTTP redirects are forbidden for security reasons" });
      }

      if (!response.ok) {
        return res.status(400).json({ error: `Remote server returned HTTP ${response.status}` });
      }

      const MAX_SIZE = 20 * 1024 * 1024;
      const buffer = await downloadBodyWithLimit(response, MAX_SIZE);

      const { entries } = parseGeodataBuffer(buffer, preset.sourceUrl, preset.type, preset.sourceTag);
      preset.entries = entries;
      preset.domains = entries;
      preset.lastUpdated = new Date().toISOString();

      saveRoutingPresets(presets);

      recordAudit({
        ip: getClientIp(req),
        endpoint: `/api/routing/presets/${id}/refresh`,
        status: 200,
        result: "CONFIG_UPDATED",
        details: `Refreshed preset ${preset.name} (${entries.length} entries)`,
      });

      res.json({ ok: true, preset: { ...preset, entriesCount: entries.length } });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  // Profiles CRUD
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
