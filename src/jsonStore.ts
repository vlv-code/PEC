import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Atomic JSON persistence for all server state stores.
 *
 * A plain fs.writeFileSync leaves a truncated file on disk when the process
 * dies mid-write (SIGKILL, OOM, container restart). Reads are wrapped in
 * try/catch, so a torn store would silently reset to defaults - e.g. the
 * rotation schedule vanishing without any error. Writing to a temp file and
 * renaming (same directory, same filesystem) makes the switch atomic.
 */
export function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tempFile = path.join(dir, `${path.basename(filePath)}.tmp.${crypto.randomBytes(4).toString("hex")}`);
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(tempFile, filePath);
}

/**
 * Read a JSON store; on a parse/read failure preserve the broken file next
 * to itself as <name>.corrupt-<timestamp> (for post-mortem) and return null
 * so the caller falls back to defaults. A missing file is not an error.
 */
export function readJsonStore<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch (err) {
    console.error(`[store] Unreadable JSON store at ${filePath}:`, err);
    try {
      const corruptPath = `${filePath}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      fs.copyFileSync(filePath, corruptPath);
      console.error(`[store] Broken store preserved as ${corruptPath}`);
    } catch {
      // best-effort only - the file may not exist at all
    }
    return null;
  }
}
