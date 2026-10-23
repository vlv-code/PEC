import fs from "node:fs";

/**
 * Side-effect module: loads .env into process.env.
 *
 * MUST be the first import of every module that reads environment variables
 * at module-load time (scheduler, auth, packager, instances, routing...).
 * ES module bodies evaluate before the importing module's body, so previously
 * server.ts loaded .env only AFTER scheduler.ts had already baked placeholder
 * 3x-ui credentials into its default rotation config - .env values were
 * silently ignored on any deployment without a saved rotation_config.json.
 */
if (fs.existsSync(".env")) {
  try {
    if (typeof process.loadEnvFile === "function") {
      process.loadEnvFile(".env");
    } else {
      const envLines = fs.readFileSync(".env", "utf-8").split("\n");
      for (const line of envLines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
          const [key, ...rest] = trimmed.split("=");
          const val = rest.join("=").trim().replace(/^['"](.*)['"]$/, "$1");
          if (!process.env[key.trim()]) {
            process.env[key.trim()] = val;
          }
        }
      }
    }
  } catch (err) {
    console.warn("[env] Notice: Could not parse .env file:", err);
  }
}
