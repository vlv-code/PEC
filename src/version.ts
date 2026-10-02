import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let cachedVersion: string | null = null;

export function getAppVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const pkgPath = path.resolve(process.cwd(), "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg && typeof pkg.version === "string" && pkg.version) {
        const v: string = pkg.version;
        cachedVersion = v;
        return v;
      }
    }
  } catch {}
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const fallbackPath = path.resolve(currentDir, "../package.json");
    if (fs.existsSync(fallbackPath)) {
      const pkg = JSON.parse(fs.readFileSync(fallbackPath, "utf-8"));
      if (pkg && typeof pkg.version === "string" && pkg.version) {
        const v: string = pkg.version;
        cachedVersion = v;
        return v;
      }
    }
  } catch {}
  cachedVersion = "1.4.0";
  return "1.4.0";
}
