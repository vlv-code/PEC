import fs from "node:fs";
import path from "node:path";
import { BACKGROUND_TEMPLATE, MANAGED_SCHEMA_TEMPLATE } from "../src/extensionTemplates.js";

const rootDir = process.cwd();
const bgPath = path.join(rootDir, "extension", "background.js");
const schemaPath = path.join(rootDir, "extension", "managed_schema.json");

fs.writeFileSync(bgPath, BACKGROUND_TEMPLATE, "utf-8");
fs.writeFileSync(schemaPath, MANAGED_SCHEMA_TEMPLATE, "utf-8");

console.log("[sync:templates] Successfully synchronized extension templates to extension/background.js and extension/managed_schema.json");
