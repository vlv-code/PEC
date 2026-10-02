import { ensureKeyExists, getPublicKeySpkiDer, calculateExtensionId } from "../src/packager.js";

const key = ensureKeyExists();
const spkiDer = getPublicKeySpkiDer(key);
const extensionId = calculateExtensionId(spkiDer);
const serverBaseUrl = (process.env.PEC_SERVER_URL || process.env.PUBLIC_BASE_URL || "https://update.example.com").replace(/\/+$/, "");
const updateXmlUrl = `${serverBaseUrl}/updates/updates.xml`;
const gpoForcelistEntry = `${extensionId};${updateXmlUrl}`;

console.log("══════════════════════════════════════════════════════════════════════════");
console.log("  PEC Extension Signing & Deployment Identity");
console.log("══════════════════════════════════════════════════════════════════════════");
console.log(`Extension ID:         ${extensionId}`);
console.log(`Updates XML appid:    ${extensionId}`);
console.log(`Update XML URL:       ${updateXmlUrl}`);
console.log(`GPO ExtensionInstallForcelist entry:`);
console.log(`  ${gpoForcelistEntry}`);
console.log("══════════════════════════════════════════════════════════════════════════");
