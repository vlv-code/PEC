import { packageExtension } from "../src/packager.js";

/**
 * Generate the extension distribution package without starting the HTTP
 * server (CI release packaging). The base URL only affects updates.xml's
 * codebase hint; operators get the real URL from their deployment.
 */
const port = process.env.PORT || "3000";
const result = packageExtension(`http://localhost:${port}`);
console.log(`[pack] Extension packaged: v${result.version} (${result.uiMode || "custom"})`);
