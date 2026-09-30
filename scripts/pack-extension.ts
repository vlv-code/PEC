import { packageExtension } from "../src/packager.js";

const serverUrl = (process.env.PEC_SERVER_URL || process.env.PUBLIC_BASE_URL || "").trim();

if (!serverUrl) {
  console.error(
    "[pack] FATAL: целевой сервер не задан — в расширение будет зашит нерабочий адрес.\n" +
    "Укажите его явно:\n" +
    "  PEC_SERVER_URL=https://pec.example.corp npm run pack:extension"
  );
  process.exit(1);
}

const result = packageExtension(serverUrl);
console.log(`[pack] Extension packaged: v${result.version} (${result.uiMode || "custom"}) -> ${serverUrl}`);
