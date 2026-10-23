import fs from "node:fs";
import path from "node:path";
import { BACKGROUND_TEMPLATE, MANAGED_SCHEMA_TEMPLATE, renderPopupHtml, renderPopupJs } from "../src/extensionTemplates.js";

const rootDir = process.cwd();
const bgPath = path.join(rootDir, "extension", "background.js");
const schemaPath = path.join(rootDir, "extension", "managed_schema.json");
const popupHtmlPath = path.join(rootDir, "extension", "popup.html");
const popupJsPath = path.join(rootDir, "extension", "popup.js");

fs.writeFileSync(bgPath, BACKGROUND_TEMPLATE, "utf-8");
fs.writeFileSync(schemaPath, MANAGED_SCHEMA_TEMPLATE, "utf-8");
fs.writeFileSync(popupHtmlPath, renderPopupHtml(), "utf-8");
fs.writeFileSync(popupJsPath, renderPopupJs(), "utf-8");

console.log("[sync:templates] Successfully synchronized extension templates to extension/*");

