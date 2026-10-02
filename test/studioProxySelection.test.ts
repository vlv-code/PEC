import { test } from "node:test";
import assert from "node:assert";
import { generateExtensionFiles } from "../src/packager.js";

test("Task 5: Extension Studio embeds defaultProxyId and allowUserProxySwitch", () => {
  const files = generateExtensionFiles({
    name: "Test Ext",
    shortName: "TE",
    version: "1.0.0",
    defaultProxyId: "node-fin-01",
    allowUserProxySwitch: true,
  });

  assert.ok(files["background.js"], "must generate background.js");
  // Background or config embeds defaultProxyId / allowUserProxySwitch
  assert.ok(typeof files["background.js"] === "string" && files["background.js"].includes("node-fin-01"));
  assert.ok(typeof files["background.js"] === "string" && files["background.js"].includes("const ALLOW_USER_PROXY_SWITCH = true;"));

  const filesDisabled = generateExtensionFiles({
    name: "Test Ext 2",
    shortName: "TE2",
    version: "1.0.0",
    defaultProxyId: "",
    allowUserProxySwitch: false,
  });
  assert.ok(typeof filesDisabled["background.js"] === "string" && filesDisabled["background.js"].includes("const ALLOW_USER_PROXY_SWITCH = false;"));
});
