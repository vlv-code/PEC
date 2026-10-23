import "./helpers/setup.js";
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { renderBackgroundJs, BACKGROUND_TEMPLATE } from "../src/templates/backgroundTemplate.js";
import { createManifestObject } from "../src/packager.js";

test("Extension Pairing: background template includes loopback announceToLocalApp", () => {
  const rendered = renderBackgroundJs({
    defaultServerUrl: "http://localhost:3000",
  });

  assert.ok(
    rendered.includes("127.0.0.1:20809/announce"),
    "background.js must target loopback endpoint 127.0.0.1:20809/announce"
  );
  assert.ok(
    rendered.includes("announceToLocalApp"),
    "background.js must define announceToLocalApp function"
  );
  assert.ok(
    rendered.includes("AbortSignal.timeout(1500)"),
    "announceToLocalApp must use 1500ms timeout"
  );
  assert.ok(
    rendered.includes("detectBrowserFamily"),
    "background.js must detect browser family"
  );

  assert.ok(
    BACKGROUND_TEMPLATE.includes("announceToLocalApp"),
    "BACKGROUND_TEMPLATE must contain announceToLocalApp"
  );
});

test("Extension Pairing: manifest contains http://127.0.0.1/* host permissions", () => {
  const manifestObj = createManifestObject({
    name: "PEC Corp",
    shortName: "PEC",
    version: "2.0.0",
  });

  const hostPerms = manifestObj.host_permissions as string[];
  assert.ok(Array.isArray(hostPerms), "host_permissions must be an array");
  assert.ok(
    hostPerms.includes("http://127.0.0.1/*"),
    "host_permissions must explicitly include http://127.0.0.1/*"
  );

  const manifestFile = JSON.parse(
    fs.readFileSync(path.resolve("./extension/manifest.json"), "utf-8")
  );
  assert.ok(
    manifestFile.host_permissions.includes("http://127.0.0.1/*"),
    "extension/manifest.json must include http://127.0.0.1/*"
  );
});
