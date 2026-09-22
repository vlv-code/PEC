#!/usr/bin/env node
/**
 * Extension packaging and GPO helper in Node.js.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function generateUpdatesXml(extensionId, version, codebaseUrl) {
  return `<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='${extensionId}'>
    <updatecheck codebase='${codebaseUrl}' version='${version}' />
  </app>
</gupdate>
`;
}

export function calculateExtensionIdFromSpki(spkiBuffer) {
  const hash = crypto.createHash("sha256").update(spkiBuffer).digest().subarray(0, 16);
  let id = "";
  for (let i = 0; i < hash.length; i++) {
    const b = hash[i];
    id += String.fromCharCode(97 + (b >> 4));
    id += String.fromCharCode(97 + (b & 0x0f));
  }
  return id;
}

if (process.argv[1] && process.argv[1].endsWith("pack.js")) {
  console.log("Corp Proxy Extension pack utility (Node.js)");
  const manifestPath = path.resolve("./extension/manifest.json");
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    console.log(`Manifest: ${manifest.name} v${manifest.version}`);
  }
}
